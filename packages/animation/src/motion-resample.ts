import { createCubicDistanceCorrespondence } from './motion-path';
import {
  clone,
  MAX_VECTOR_POINTS,
  type BezierNode,
  type Point,
  type Vector,
} from '../../document/src';

export type { MotionNodeMatching as MotionStraightNodes } from '../../document/src/motion-contour';
import type { MotionNodeMatching as MotionStraightNodes } from '../../document/src/motion-contour';
export function parseMotionNodeHints(
  text: string,
  enabled: boolean,
  curves = false,
  distance = false,
): MotionStraightNodes {
  if (distance && !curves)
    throw new Error('Curve distance matching requires curved node matching.');
  if (curves && enabled) throw new Error('Choose either straight or curved node matching.');
  if (!text.trim())
    return curves ? { curves: true, ...(distance ? { distance: true } : {}) } : enabled;
  if (!enabled && !curves) throw new Error('Enable node matching to use node hints.');
  const hints = text.split(';').map((part) => {
    if (!part.trim()) return [];
    return part.split(',').map((pair) => {
      const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(pair);
      if (!match)
        throw new Error(
          'Node hints use source:target interior anchor indices, separated by commas; separate contours with semicolons.',
        );
      const result: [number, number] = [Number(match[1]), Number(match[2])];
      if (!result.every(Number.isSafeInteger))
        throw new Error('Node hint indices must be safe integers.');
      return result;
    });
  });
  return curves ? { hints, curves: true, ...(distance ? { distance: true } : {}) } : { hints };
}

/** Match straight arc-length or curved equal-segment parameter partitions. */
export function matchStraightMotionNodes(
  source: Vector,
  target: Vector,
  hints?: readonly (readonly (readonly [number, number])[])[],
  curves = false,
  distance = false,
  resolvedHints?: (indices: number[]) => void,
): [Vector, Vector] {
  if (source.kind !== target.kind || !['bezier', 'polygon'].includes(source.kind))
    throw new Error('Node matching requires Bezier paths or polygon contours.');
  if (curves && source.kind !== 'bezier')
    throw new Error('Curved node matching requires Bezier paths.');
  const closed = source.kind === 'polygon' || !!source.closed;
  if (source.kind === 'bezier' && !!target.closed !== closed)
    throw new Error('Node matching requires matching closure.');
  const rings = (s: Vector) =>
    s.kind === 'polygon' ? s.contours : s.nodes ? [s.nodes] : undefined;
  const first = rings(source),
    last = rings(target);
  if (!first?.length || !last || first.length !== last.length)
    throw new Error('Node matching requires the same contour count.');
  if (hints !== undefined && (!Array.isArray(hints) || hints.length !== first.length))
    throw new Error('Provide one node hint list per contour.');
  if (distance && !curves)
    throw new Error('Curve distance matching requires curved node matching.');
  const maps = new Map<
    BezierNode[],
    { knots: number[]; parameter: (fraction: number) => number }
  >();
  let count = 0;
  function partition(points: BezierNode[]) {
    if (
      points.length < (closed ? 3 : 2) ||
      points.length > MAX_VECTOR_POINTS ||
      points.some(
        (p) =>
          Object.keys(p).some((k) => !['x', 'y', ...(curves ? ['in', 'out'] : [])].includes(k)) ||
          (curves &&
            [p.in, p.out].some(
              (h) =>
                h !== undefined &&
                (!h ||
                  Object.keys(h).some((k) => k !== 'x' && k !== 'y') ||
                  !Number.isFinite(h.x) ||
                  !Number.isFinite(h.y)),
            )) ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y),
      )
    )
      throw new Error(
        'Node matching requires finite anchors and supported handles without pressure metadata.',
      );
    if (curves) {
      const segments = points.length - (closed ? 0 : 1);
      const knots = Array.from({ length: segments + 1 }, (_, i) => i / segments);
      if (!distance) return knots;
      const cubics = Array.from({ length: segments }, (_, i) => {
        const a = points[i],
          b = points[(i + 1) % points.length];
        return [a, a.out ?? a, b.in ?? b, b] as const;
      });
      const map = createCubicDistanceCorrespondence(cubics);
      const lengths = knots.map(map.fraction);
      if (
        !(map.total > 0) ||
        lengths.some((v, i) => !Number.isFinite(v) || (i > 0 && !(v > lengths[i - 1])))
      )
        throw new Error('Curved contour distances are degenerate or numerically unresolved.');
      maps.set(points, { knots: lengths.slice(), parameter: map.parameter });
      return lengths;
    }
    const distances = [0];
    for (let i = 1; i < points.length + (closed ? 1 : 0); i++) {
      const a = points[i - 1],
        b = points[i % points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y),
        total = distances[i - 1] + length;
      if (!Number.isFinite(total) || !(total > distances[i - 1]))
        throw new Error('Straight contour lengths are degenerate or numerically unresolved.');
      distances.push(total);
    }
    const total = distances[distances.length - 1];
    const knots = distances.map((v) => v / total);
    if (knots.some((v, i) => i > 0 && !(v > knots[i - 1])))
      throw new Error('Straight contour fractions are numerically unresolved.');
    return knots;
  }
  const output: [BezierNode[][], BezierNode[][]] = [[], []];
  first.forEach((ring, r) => {
    const end = last[r],
      a = partition(ring),
      b = partition(end);
    if (hints !== undefined) {
      const pairs = hints[r];
      if (!Array.isArray(pairs)) throw new Error('Node hints require ordered index pairs.');
      const boundaries: (readonly [number, number])[] = [[0, 0]];
      for (const pair of pairs) {
        const previous = boundaries[boundaries.length - 1];
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !Number.isSafeInteger(pair[0]) ||
          !Number.isSafeInteger(pair[1]) ||
          pair[0] <= previous[0] ||
          pair[1] <= previous[1] ||
          pair[0] >= a.length - 1 ||
          pair[1] >= b.length - 1
        )
          throw new Error(
            'Node hints must pair strictly increasing interior anchors. Endpoint pairs are implicit.',
          );
        boundaries.push([pair[0], pair[1]]);
      }
      boundaries.push([a.length - 1, b.length - 1]);
      const original = b.slice();
      for (let i = 1; i < boundaries.length; i++) {
        const [as, bs] = boundaries[i - 1],
          [ae, be] = boundaries[i];
        b[bs] = a[as];
        b[be] = a[ae];
        for (let j = bs + 1; j < be; j++) {
          const t = (original[j] - original[bs]) / (original[be] - original[bs]);
          b[j] = a[as] * (1 - t) + a[ae] * t;
        }
      }
      if (b.some((v, i) => !Number.isFinite(v) || (i > 0 && !(v > b[i - 1]))))
        throw new Error('Hinted contour fractions are numerically unresolved.');
    }
    const merged: number[] = [];
    let i = 0,
      j = 0;
    while (i < a.length || j < b.length) {
      const next = Math.min(a[i] ?? Infinity, b[j] ?? Infinity);
      if (a[i] === next) i++;
      if (b[j] === next) j++;
      if (closed && next === 1) continue;
      if (++count > MAX_VECTOR_POINTS)
        throw new Error('Matched nodes exceed the existing vector point limit.');
      merged.push(next);
    }
    if(resolvedHints){
      const positions=new Map(merged.map((value,index)=>[value,index]));
      const pairs:readonly (readonly [number,number])[]=hints?.[r]??[];
      const indices=pairs.map(([source])=>positions.get(a[source])??-1);
      if(indices.some(index=>index<=0))throw new Error('Matched node hint index is unresolved.');
      resolvedHints(indices);
    }
    function sample(points: BezierNode[], knots: number[]) {
      if (curves)
        return subdivide(points, knots, closed ? [...merged, 1] : merged, closed, maps.get(points));
      let segment = 0;
      return merged.map((u) => {
        while (segment + 1 < knots.length && knots[segment + 1] <= u) segment++;
        if (u === knots[segment]) return { ...points[segment % points.length] };
        const t = (u - knots[segment]) / (knots[segment + 1] - knots[segment]);
        const a = points[segment],
          b = points[(segment + 1) % points.length];
        const point = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t };
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
          throw new Error('Matched straight node exceeds numeric limits.');
        return point;
      });
    }
    output[0].push(sample(ring, a));
    output[1].push(sample(end, b));
  });
  const result: [Vector, Vector] = [clone(source), clone(target)];
  result.forEach((shape, i) => {
    if (shape.kind === 'polygon') shape.contours = output[i];
    else shape.nodes = output[i][0];
  });
  return result;
}

/** de Casteljau subdivision preserves cubic geometry, without flattening or length estimation. */
function subdivide(
  points: BezierNode[],
  knots: number[],
  cuts: number[],
  closed: boolean,
  distance?: { knots: number[]; parameter: (fraction: number) => number },
): BezierNode[] {
  type Cubic = [Point, Point, Point, Point];
  const mix = (a: Point, b: Point, t: number): Point => ({
    x: a.x * (1 - t) + b.x * t,
    y: a.y * (1 - t) + b.y * t,
  });
  function split(c: Cubic, t: number): [Cubic, Cubic] {
    const a = mix(c[0], c[1], t),
      b = mix(c[1], c[2], t),
      d = mix(c[2], c[3], t);
    const e = mix(a, b, t),
      f = mix(b, d, t),
      p = mix(e, f, t);
    return [
      [c[0], a, e, p],
      [p, f, d, c[3]],
    ];
  }
  const result: BezierNode[] = [];
  let segment = 0;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1],
      hi = cuts[i];
    while (segment + 1 < knots.length && knots[segment + 1] <= lo) segment++;
    const span = knots[segment + 1] - knots[segment];
    const local = (u: number) => {
      if (u === knots[segment]) return 0;
      if (u === knots[segment + 1]) return 1;
      const t = (u - knots[segment]) / span;
      if (!distance) return t;
      const d = distance.knots[segment] * (1 - t) + distance.knots[segment + 1] * t;
      return distance.parameter(d) * (points.length - (closed ? 0 : 1)) - segment;
    };
    const start = local(lo),
      end = local(hi);
    if (!(start >= 0 && end > start && end <= 1))
      throw new Error('Curved matching interval is numerically unresolved.');
    const a = points[segment],
      b = points[(segment + 1) % points.length];
    let curve: Cubic = [
      { x: a.x, y: a.y },
      { x: (a.out ?? a).x, y: (a.out ?? a).y },
      { x: (b.in ?? b).x, y: (b.in ?? b).y },
      { x: b.x, y: b.y },
    ];
    if (end < 1) curve = split(curve, end)[0];
    if (start > 0) curve = split(curve, start / end)[1];
    if (curve.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw new Error('Matched curve exceeds numeric limits.');
    if (!result.length) result.push({ ...curve[0], in: { ...curve[0] }, out: { ...curve[1] } });
    else result[result.length - 1].out = { ...curve[1] };
    result.push({ ...curve[3], in: { ...curve[2] }, out: { ...curve[3] } });
  }
  if (closed) {
    result[0].in = result[result.length - 1].in;
    result.pop();
  }
  return result;
}
