import { clone, type Point, type Vector } from '@splash/document';
import { inversePoint, mapPoint, matrix } from './affine';
import { boundsIndex } from './bounds-index';
import { splitCubic, type Cubic } from './curve-fit';
import { prepareDissolveJoin, STROKE_DISSOLVE_ERROR } from './dissolve-stroke-anchor';

const difference = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const length = (p: Point) => Math.hypot(p.x, p.y);
const bounds = (points: Point[]) => ({
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  bottom: Math.max(...points.map((p) => p.y)),
});

/** Retire redundant anchors even when a remote tight join blocks a full refit.
 * Both original spans and the replacement must be monotone along the same
 * chord. Their swept control hull must stay clear of every other boundary. */
export function simplifyContourSpans(source: Vector, tolerance: number): Vector | undefined {
  return prepareContourSpans(source, tolerance);
}

/** The explicit command removes exactly the picked anchor. The returned index
 * addresses the surviving previous anchor in the original contour order. */
export function dissolveContourAnchor(source: Vector, selected: number) {
  if (!Number.isSafeInteger(selected) || selected < 0) return;
  const contours = source.kind === 'polygon' && source.fillRule === 'evenodd'
    ? source.contours : undefined;
  const rings = contours ?? (source.kind === 'bezier' && !source.contours && source.closed && source.nodes
    ? [source.nodes] : []);
  let start = 0;
  for (const [ring, nodes] of rings.entries()) {
    const index = selected - start;
    if (index < nodes.length) {
      const artwork = prepareContourSpans(source, STROKE_DISSOLVE_ERROR, { ring, index });
      if (artwork) return { artwork, selected: index ? selected - 1 : start + nodes.length - 2 };
      return;
    }
    start += nodes.length;
  }
}

function prepareContourSpans(source: Vector, tolerance: number, target?: { ring: number; index: number }): Vector | undefined {
  const localRings = source.contours ?? (target && source.nodes ? [source.nodes] : undefined);
  if (!localRings || source.fillEnabled === false || source.strokeWidth) return;
  const basis = matrix(source);
  const origin = target && localRings[target.ring][(target.index + localRings[target.ring].length - 1) % localRings[target.ring].length];
  if (origin) basis[4] = basis[5] = 0;
  const world = (p: Point) => mapPoint(basis, origin ? difference(p, origin) : p);
  const edges: { ring: number; index: number; curve: Cubic }[] = [];
  let scale = 1;
  const rings = localRings.map((nodes, ring) =>
    nodes.map((a, index) => {
      const b = nodes[(index + 1) % nodes.length];
      const p = world(a), q = world(b);
      const mix = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      const curved = a.out || b.in;
      const curve: Cubic = [
        p,
        curved ? world(a.out ?? a) : mix(1 / 3),
        curved ? world(b.in ?? b) : mix(2 / 3),
        q,
      ];
      for (const point of curve) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
      const edge = { ring, index, curve };
      edges.push(edge);
      return edge;
    }),
  );
  if (!Number.isFinite(scale)) return;
  const epsilon = scale * Number.EPSILON * 64;
  const edgeLookup = boundsIndex(edges.map((edge) => bounds(edge.curve)));
  const candidates = rings.flatMap((ring, ringIndex) => {
    if (ring.length <= 3) return [];
    return ring.flatMap(({ curve: right }, index) => {
      if (target && (target.ring !== ringIndex || target.index !== index)) return [];
      const prev = (index + ring.length - 1) % ring.length;
      const left = ring[prev].curve;
      const a = left[0],
        join = right[0],
        b = right[3];
      const chord = difference(b, a),
        size = length(chord);
      if (size <= epsilon) return [];
      const axis = { x: chord.x / size, y: chord.y / size };
      const increasing = (points: Point[]) =>
        points.slice(1).every((p, i) => dot(difference(p, points[i]), axis) >= 0);
      if (!increasing([...left, ...right.slice(1)])) return [];
      const d = length(difference(join, a)),
        e = length(difference(b, join));
      if (Math.min(d, e) <= epsilon) return [];
      const t = d / (d + e);
      const u = difference(left[1], a),
        v = difference(right[2], b);
      const local = localRings[ringIndex];
      const joined = target && prepareDissolveJoin(source, local[prev], local[index], local[(index + 1) % ring.length]);
      if (target && !joined) return [];
      const out = joined ? joined.c1 : inversePoint(basis, { x: a.x + u.x / t, y: a.y + u.y / t });
      const incoming = joined ? joined.c2 : inversePoint(basis, { x: b.x + v.x / (1 - t), y: b.y + v.y / (1 - t) });
      const replacement: Cubic = [a, world(out), world(incoming), b];
      if (
        !replacement.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
        !increasing(replacement)
      )
        return [];
      // Bound the error for the complete curves using the Bernstein controls
      // of their difference, in coordinates relative to the first anchor.
      const halves = splitCubic(replacement.map((p) => difference(p, a)) as Cubic, t);
      if (
        !target && [left, right].some((c, k) =>
          c.some((p, i) => length(difference(difference(p, a), halves[k][i])) > tolerance),
        )
      )
        return [];
      const hull = [...left, ...right.slice(1), replacement[1], replacement[2]];
      return [
        { ring: ringIndex, index, prev, replacement, hull, box: bounds(hull), axis, out, incoming },
      ];
    });
  });
  if (!candidates.length) return;
  const patchLookup = boundsIndex(candidates.map((patch) => patch.box));
  const accepted = new Set<number>(),
    removed = rings.map(() => 0);
  let remaining = 200000;
  const separated = (a: Point[], b: Point[]) => {
    for (const points of [a, b])
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++) {
          if (--remaining < 0) return false;
          const d = difference(points[j], points[i]),
            size = length(d);
          if (!size) continue;
          const n = { x: -d.y / size, y: d.x / size };
          const project = (p: Point) => dot(difference(p, a[0]), n);
          const A = a.map(project),
            B = b.map(project);
          if (
            Math.max(...A) + epsilon < Math.min(...B) ||
            Math.max(...B) + epsilon < Math.min(...A)
          )
            return true;
        }
    return false;
  };
  const joinsOnly = (a: Point[], b: Point[], anchor: Point) => {
    const directions = (points: Point[]) =>
      points.map((p) => difference(p, anchor)).filter((p) => p.x !== 0 || p.y !== 0);
    const A = directions(a),
      B = directions(b);
    // An angled separator can admit a right-angle seam where the patch
    // chord's normal plane alone places the neighbor on the boundary.
    for (const u of A)
      for (const v of B) {
        if (--remaining < 0) return false;
        const lu = length(u),
          lv = length(v);
        const axis = { x: u.x / lu - v.x / lv, y: u.y / lu - v.y / lv };
        if (A.every((p) => dot(p, axis) > epsilon) && B.every((p) => dot(p, axis) < -epsilon))
          return true;
      }
    return false;
  };
  for (const [i, patch] of candidates.entries()) {
    if (remaining <= 0) break;
    const { ring, index, prev, replacement, hull, box, axis } = patch;
    const n = rings[ring].length;
    if (n - removed[ring] <= 3) continue;
    const nearbyEdges = edgeLookup(box, epsilon);
    remaining -= nearbyEdges.length;
    if (remaining < 0) break;
    const clear = nearbyEdges.every((j) => {
      const edge = edges[j];
      if (edge.ring === ring) {
        if (edge.index === prev || edge.index === index) return true;
        const before = edge.index === (prev + n - 1) % n;
        if (before || edge.index === (index + 1) % n) {
          const anchor = replacement[before ? 0 : 3];
          // Use the chord plane at this endpoint when all controls lie on
          // the correct side. Controls exactly at the anchor are harmless.
          const onSide = (points: Point[], sign: number) =>
            points.every((p) => {
              const d = difference(p, anchor);
              return (d.x === 0 && d.y === 0) || sign * dot(d, axis) > epsilon;
            });
          return (
            (onSide(hull, before ? 1 : -1) && onSide(edge.curve, before ? -1 : 1)) ||
            joinsOnly(hull, edge.curve, anchor)
          );
        }
      }
      return separated(hull, edge.curve);
    });
    if (!clear) continue;
    const nearbyPatches = patchLookup(box, epsilon);
    remaining -= nearbyPatches.length;
    if (remaining < 0) break;
    if (!nearbyPatches.every((j) => !accepted.has(j) || separated(hull, candidates[j].hull)))
      continue;
    accepted.add(i);
    removed[ring]++;
  }
  if (!accepted.size) return;
  const result = clone(source);
  const resultRings = result.contours ?? [result.nodes!];
  const deleted = rings.map(() => new Set<number>());
  for (const i of accepted) {
    const { ring, index, prev, out, incoming } = candidates[i];
    const nodes = resultRings[ring], next = (index + 1) % nodes.length;
    if (!target || nodes[prev].out) nodes[prev].out = out;
    if (!target || nodes[next].in) nodes[next].in = incoming;
    deleted[ring].add(index);
  }
  const reduced = resultRings.map((ring, i) => ring.filter((_, j) => !deleted[i].has(j)));
  if (result.contours) result.contours = reduced;
  else result.nodes = reduced[0];
  return result;
}
