import type { ArtworkNodeHints, ContourOwners, NodeHintContours } from '../../document/src/motion-contour';
import { MAX_VECTOR_POINTS, type BezierNode, type Vector, type Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { inversePoint, mapPoint, matrix } from '../../geometry/src/affine';
import { splitCubic } from '../../geometry/src/curve-fit';
import { mergeControlBounds, vectorPolygons } from '../../geometry/src/merge';
import { pathCommands } from '../../geometry/src/drawing';
import { matchStraightMotionNodes } from './motion-resample';

/** Private sampling geometry only. Authored keys retain their IDs, kinds and
 * geometry. Ordinary paths use native cubic subdivision; sampled Brush objects
 * use the existing Boolean footprint. Matching never rewrites authored keys. */
function validateKind(shape: Vector): void {
  if (
    !['rectangle', 'ellipse', 'polygon', 'bezier', 'path', 'line', 'brush'].includes(shape.kind) ||
    shape.bitmap ||
    shape.groups?.length ||
    (shape.kind !== 'brush' &&
      (shape.brush || shape.points.some((p) => Object.keys(p).some((k) => k !== 'x' && k !== 'y'))))
  )
    throw Error(
      'Shape tweens require ungrouped vector shapes or plain strokes. Break apart instances first.',
    );
}
/** Brush objects are pressure/nib samples, not Bezier contours. Resolve the
 * existing renderer/clipping footprint privately, without changing their keys. */
function outline(shape: Vector): Vector {
  if (shape.kind !== 'brush') return shape;
  const m = matrix(shape),
    s = structuredClone(shape);
  s.kind = 'polygon';
  s.points = [];
  s.closed = true;
  s.fillRule = 'evenodd';
  s.strokeWidth = 0;
  delete s.brush;
  s.contours = vectorPolygons(shape).flatMap((p) =>
    p.map((r) => r.slice(0, -1).map(([x, y]) => inversePoint(m, { x, y }))),
  );
  return s;
}
function contours(shape: Vector): { rings: BezierNode[][]; closed: boolean } {
  validateKind(shape);
  const rings: BezierNode[][] = [];
  let ring: BezierNode[] = [],
    closed: boolean | undefined,
    count = 0;
  const add = (node: BezierNode) => {
    // A closing command temporarily repeats its first anchor. Count authored
    // anchors after removing that endpoint, so exact-capacity rings still fit.
    if (ring.length >= MAX_VECTOR_POINTS + 1)
      throw Error('Shape tween contours exceed the existing vector point limit.');
    ring.push(node);
  };
  const finish = (isClosed: boolean) => {
    if (!ring.length) return;
    if (closed !== undefined && closed !== isClosed)
      throw Error('Shape tween contours require matching closure.');
    closed = isClosed;
    if (isClosed && ring.length > 1) {
      const last = ring[ring.length - 1],
        first = ring[0];
      if (last.x === first.x && last.y === first.y) {
        first.in = last.in;
        ring.pop();
      }
    }
    if (isClosed && ring.length < 3 && ring.some((n) => n.in || n.out)) {
      while (ring.length < 3) ring = splitClosedContour(ring);
    }
    if (ring.length < (isClosed ? 3 : 2))
      throw Error('Shape tween needs a nondegenerate vector contour.');
    count += ring.length;
    if (count > MAX_VECTOR_POINTS)
      throw Error('Shape tween contours exceed the existing vector point limit.');
    rings.push(ring);
    ring = [];
  };
  for (const command of pathCommands(shape)) {
    if (command[0] === 'M') {
      finish(false);
      add({ x: command[1], y: command[2] });
    } else if (command[0] === 'L' || command[0] === 'C') {
      const last = ring[ring.length - 1];
      if (!last) throw Error('Shape tween contour has no starting anchor.');
      if (command[0] === 'C') {
        // Primitive rectangles emit zero-length corner cubics at radius zero.
        if (command.slice(1).every((v, i) => v === (i % 2 ? last.y : last.x))) continue;
        last.out = { x: command[1], y: command[2] };
        add({ x: command[5], y: command[6], in: { x: command[3], y: command[4] } });
      } else if (last.x !== command[1] || last.y !== command[2])
        add({ x: command[1], y: command[2] });
    } else finish(true);
  }
  finish(false);
  if (!rings.length) throw Error('Draw a vector shape at both tween endpoints.');
  if (
    rings.flat().some((p) => [p, p.in, p.out].some((q) => q && ![q.x, q.y].every(Number.isFinite)))
  )
    throw Error('Shape tween contour exceeds numeric limits.');
  return { rings, closed: !!closed };
}

/** Present the same anchor numbering used by shape-mode matching. */
export function shapeHintEndpoint(shape: Vector): Vector {
  validateLiveGraphicData(shape);
  const artwork = outline(shape);
  const { rings, closed } = contours(artwork);
  return closed
    ? { ...artwork, kind: 'polygon', contours: rings, nodes: undefined }
    : { ...artwork, kind: 'bezier', closed, nodes: rings[0], contours: undefined };
}

// The visual editor and sampler share contour ordering, direction and start
// alignment so a displayed anchor always names the same sampled vertex.
function alignChangingContours(a: ReturnType<typeof contours>, b: ReturnType<typeof contours>, commonRule: Vector['fillRule'], owners?: ContourOwners, capture?: [number[], number[]]) {
  if (a.rings.length !== b.rings.length) {
    // Prefer the large enclosing boundary before small holes/islands, even if
    // the authored rings use a different order. Stored endpoint order is exact.
    const ordered = (rings: BezierNode[][], side: number) => {
      const ranked =
      rings
        .map((ring, index) => {
          const b = box([ring]),
            size = Math.hypot(b.right - b.left, b.bottom - b.top);
          if (!Number.isFinite(size)) throw Error('Shape contour extent exceeds numeric limits.');
          return { ring, index, size };
        })
        .sort((a, b) => b.size - a.size || a.index - b.index);
      if (!owners) return ranked.map(r=>r.ring);
      const pinned = new Set(owners.flatMap(pair=>pair ? [pair[side]] : []));
      const automatic = ranked.filter(r=>!pinned.has(r.index));
      let cursor = 0;
      return ranked.map((_, slot) => {
        const pair = owners[slot];
        if (pair && !rings[pair[side]]) throw Error('A hinted contour is missing from its original endpoint.');
        return pair ? rings[pair[side]] : automatic[cursor++].ring;
      });
    };
    const original = [a.rings, b.rings];
    a.rings = ordered(a.rings, 0);
    b.rings = ordered(b.rings, 1);
    if (capture) {
      for (const [side,rings] of [a.rings,b.rings].entries()) {
        const indices = new Map(original[side].map((ring,i)=>[ring,i]));
        capture[side] = rings.map(ring=>indices.get(ring)!);
      }
    }
    if (a.closed && b.closed) {
      const sign = (ring: BezierNode[]) => {
        const origin = ring[0];
        let sum = 0;
        for (let i = 1; i + 1 < ring.length; i++)
          sum +=
            (ring[i].x - origin.x) * (ring[i + 1].y - origin.y) -
            (ring[i].y - origin.y) * (ring[i + 1].x - origin.x);
        if (!Number.isFinite(sum)) throw Error('Shape contour direction exceeds numeric limits.');
        return Math.sign(sum);
      };
      const reverse = (ring: BezierNode[]) =>
        ring
          .slice()
          .reverse()
          .map((n) => ({
            x: n.x,
            y: n.y,
            ...(n.out ? { in: { ...n.out } } : {}),
            ...(n.in ? { out: { ...n.in } } : {}),
          }));
      if (commonRule === 'nonzero' && sign(a.rings[0]) * sign(b.rings[0]) < 0)
        b.rings = b.rings.map(reverse);
      for (let i = 0; i < Math.min(a.rings.length, b.rings.length); i++) {
        const from = a.rings[i];
        let to = b.rings[i];
        if (commonRule === 'evenodd' && sign(from) * sign(to) < 0) to = reverse(to);
        const x = box([from]),
          y = box([to]),
          fraction = (p: number, lo: number, hi: number) =>
            hi === lo ? 0.5 : (p - lo) / (hi - lo),
          u = fraction(from[0].x, x.left, x.right),
          v = fraction(from[0].y, x.top, x.bottom);
        let start = 0,
          best = Infinity;
        for (const [j, n] of to.entries()) {
          const d = Math.hypot(
            fraction(n.x, y.left, y.right) - u,
            fraction(n.y, y.top, y.bottom) - v,
          );
          if (!Number.isFinite(d)) throw Error('Shape contour start exceeds numeric limits.');
          if (d < best) {
            best = d;
            start = j;
          }
        }
        b.rings[i] = [...to.slice(start), ...to.slice(0, start)];
      }
    }
  }
}

export function shapeHintEndpoints(source: Vector, target: Vector, owners?: ContourOwners, capture?: [number[], number[]]): [Vector, Vector] {
  const endpoints: [Vector, Vector] = [shapeHintEndpoint(source), shapeHintEndpoint(target)];
  const [from, to] = endpoints;
  if (!from.contours || !to.contours || from.contours.length === to.contours.length) return endpoints;
  const a = { rings: from.contours, closed: true }, b = { rings: to.contours, closed: true };
  alignChangingContours(a, b, a.rings.length === 1 ? to.fillRule ?? 'nonzero' : from.fillRule ?? 'nonzero', owners, capture);
  const matched = Math.min(a.rings.length, b.rings.length);
  from.contours = a.rings.slice(0, matched);
  to.contours = b.rings.slice(0, matched);
  return endpoints;
}

export function captureContourOwners(source: Vector, target: Vector, hints: NodeHintContours, previous?: ContourOwners): ContourOwners | undefined {
  const indices: [number[], number[]] = [[], []];
  shapeHintEndpoints(source, target, previous, indices);
  if (!indices[0].length) return undefined;
  return hints.map((pairs,i)=>pairs.length ? [indices[0][i],indices[1][i]] as const : null);
}

export function matchShapeTweenArtwork(
  source: Vector,
  target: Vector,
  hints?: readonly (readonly (readonly [number, number])[])[],
  distance = false,
  owners?: ContourOwners,
): [Vector, Vector] {
  validateLiveGraphicData([source, target]);
  validateKind(source);
  validateKind(target);
  source = outline(source);
  target = outline(target);
  const primitive = (s: Vector) => !s.contours && (s.kind === 'rectangle' || s.kind === 'ellipse');
  const fillRule = (s: Vector) => s.fillRule ?? 'nonzero';
  let commonRule = primitive(source) ? fillRule(target) : fillRule(source);
  // Preserve the original primitive interpolation and all its numeric guards.
  if (
    source.kind === target.kind &&
    primitive(source) &&
    primitive(target) &&
    !hints &&
    source.fillEnabled === target.fillEnabled &&
    source.fillRule === target.fillRule &&
    source.drawingMode === target.drawingMode
  ) {
    const pair: [Vector, Vector] = [structuredClone(source), structuredClone(target)];
    pair[1].id = pair[0].id;
    return pair;
  }
  const a = contours(source),
    b = contours(target);
  const closed = a.closed || b.closed;
  if (hints && a.closed !== b.closed)
    throw Error('Update shape hints for the changed contour topology.');
  if (hints && hints.length !== Math.min(a.rings.length, b.rings.length))
    throw Error('Provide one shape hint list per matched contour.');
  if (a.rings.length === 1 && b.rings.length > 1) commonRule = fillRule(target);
  if (owners && (a.rings.length === b.rings.length || owners.length !== Math.min(a.rings.length,b.rings.length)))
    throw Error('Update shape hints for the changed contour topology.');
  alignChangingContours(a, b, commonRule, owners);
  if (closed && a.closed !== b.closed) {
    if (!a.closed) a.rings = a.rings.map(foldOpenContour);
    if (!b.closed) b.rings = b.rings.map(foldOpenContour);
  }
  if (a.rings.length === 1 && b.rings.length > 1) commonRule = fillRule(target);
  const count = Math.max(a.rings.length, b.rings.length);
  const pairs = Array.from({ length: count }, (_, i) => {
    const from = a.rings[i],
      to = b.rings[i];
    const pair = matchStraightMotionNodes(
      { ...source, kind: 'bezier', nodes: from ?? to, closed, contours: undefined },
      { ...target, kind: 'bezier', nodes: to ?? from, closed, contours: undefined },
      hints?.[i] ? [hints[i]] : undefined,
      true,
      distance,
    );
    if (!from) pair[0].nodes = collapseNodes(pair[0].nodes!, birthPoint(to!, b.rings, a.rings));
    if (!to) pair[1].nodes = collapseNodes(pair[1].nodes!, birthPoint(from!, a.rings, b.rings));
    return pair;
  });
  const mixedFill = (source.fillEnabled ?? true) !== (target.fillEnabled ?? true);
  const uniform = (s: Vector) =>
    !s.gradient ||
    (s.gradient.stops.length === 2 &&
      s.gradient.stops[0].color === s.gradient.stops[1].color &&
      (s.gradient.stops[0].opacity ?? 1) === (s.gradient.stops[1].opacity ?? 1));
  const uniformFill =
    (mixedFill || !!source.gradient !== !!target.gradient) && uniform(source) && uniform(target);
  const canonical = (shape: Vector, side: 0 | 1): Vector => {
    const result = structuredClone(shape);
    result.id = source.id;
    result.kind = count > 1 ? 'polygon' : 'bezier';
    result.width = result.height = 0;
    result.points = [];
    delete result.nodes;
    delete result.contours;
    delete result.closed;
    delete result.cornerRadius;
    result.fillRule = commonRule;
    result.fillEnabled = shape.fillEnabled ?? true;
    if (uniformFill) {
      result.fillEnabled = true;
      const opacity = shape.fillEnabled === false ? 0 : (shape.gradient?.stops[0].opacity ?? 1),
        color = shape.gradient?.stops[0].color ?? shape.fill;
      result.gradient = {
        kind: 'linear',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        stops: [
          { offset: 0, color, opacity },
          { offset: 1, color, opacity },
        ],
      };
    }
    // Drawing mode describes authoring, not the geometry of a sampled pose.
    delete result.drawingMode;
    if (count > 1) {
      result.contours = pairs.map((pair) => pair[side].nodes!);
    } else {
      result.nodes = pairs[0][side].nodes;
      result.closed = closed;
    }
    return result;
  };
  const output: [Vector, Vector] = [canonical(source, 0), canonical(target, 1)];
  if ((output[0].contours?.reduce((n, ring) => n + ring.length, 0) ?? 0) > MAX_VECTOR_POINTS)
    throw Error('Matched shape exceeds the existing vector point limit.');
  return output;
}

function splitClosedContour(ring: BezierNode[]): BezierNode[] {
  const result: BezierNode[] = [],
    incoming: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      [left, right] = splitCubic([a, a.out ?? a, b.in ?? b, b], 0.5);
    result.push({ x: a.x, y: a.y, out: { ...left[1] } });
    result.push({ ...left[3], in: { ...left[2] }, out: { ...right[1] } });
    incoming.push(right[2]);
  }
  for (let i = 0; i < ring.length; i++) result[((i + 1) % ring.length) * 2].in = { ...incoming[i] };
  return result;
}

/** Return along the same cubic locus rather than closing an open stroke with
 * an invented diagonal. This private zero-area loop can grow into a fill. */
function foldOpenContour(ring: BezierNode[]): BezierNode[] {
  const out = structuredClone(ring);
  for (let i = ring.length - 2; i > 0; i--) {
    const n = ring[i];
    out.push({
      x: n.x,
      y: n.y,
      ...(n.out ? { in: { ...n.out } } : {}),
      ...(n.in ? { out: { ...n.in } } : {}),
    });
  }
  out[0].in = ring[0].out ? { ...ring[0].out } : undefined;
  const last = ring[ring.length - 1];
  out[ring.length - 1].out = last.in ? { ...last.in } : undefined;
  // A two-anchor line needs separate outbound/return segments for closed
  // matching. Split at its existing parameter midpoint without refitting.
  if (out.length === 2) {
    const [a, b] = ring,
      [left, right] = splitCubic([a, a.out ?? a, b.in ?? b, b], 0.5);
    return [
      { ...a, in: { ...left[1] }, out: { ...left[1] } },
      { ...left[3], in: { ...left[2] }, out: { ...right[1] } },
      { ...b, in: { ...right[2] }, out: { ...right[2] } },
      { ...left[3], in: { ...right[1] }, out: { ...left[2] } },
    ];
  }
  return out;
}
function box(rings: BezierNode[][]) {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const ring of rings)
    for (const n of ring) {
      left = Math.min(left, n.x);
      right = Math.max(right, n.x);
      top = Math.min(top, n.y);
      bottom = Math.max(bottom, n.y);
    }
  return { left, right, top, bottom };
}
function birthPoint(ring: BezierNode[], from: BezierNode[][], to: BezierNode[][]): Point {
  const r = box([ring]),
    a = box(from),
    b = box(to),
    p = { x: 0, y: 0 };
  for (const [axis, lo, hi] of [
    ['x', 'left', 'right'],
    ['y', 'top', 'bottom'],
  ] as const) {
    const center = r[lo] / 2 + r[hi] / 2,
      extent = a[hi] - a[lo],
      size = b[hi] - b[lo];
    const fraction = extent ? (center - a[lo]) / extent : 0.5;
    p[axis] = b[lo] + fraction * size;
    if (![extent, size, fraction, p[axis]].every(Number.isFinite))
      throw Error('Shape morph birth point exceeds numeric limits.');
  }
  return p;
}
function collapseNodes(nodes: BezierNode[], p: Point): BezierNode[] {
  return nodes.map((n) => ({
    ...p,
    ...(n.in ? { in: { ...p } } : {}),
    ...(n.out ? { out: { ...p } } : {}),
  }));
}
function collapseArtwork(shape: Vector, origin: Point): Vector {
  const s = structuredClone(shape);
  s.opacity = 0;
  let center: Point;
  if (s.kind === 'rectangle' || s.kind === 'ellipse') {
    const p = mapPoint(matrix(s), { x: s.width / 2, y: s.height / 2 });
    s.x = p.x;
    s.y = p.y;
    s.width = s.height = 0;
    delete s.cornerRadius;
    center = p;
  } else {
    const rings = s.contours ?? [s.nodes!],
      b = box(rings),
      p = { x: b.left / 2 + b.right / 2, y: b.top / 2 + b.bottom / 2 };
    if (s.contours) s.contours = s.contours.map((r) => collapseNodes(r, p));
    else s.nodes = collapseNodes(s.nodes!, p);
    center = mapPoint(matrix(s), p);
  }
  s.x += origin.x - center.x;
  s.y += origin.y - center.y;
  if (![s.x, s.y].every(Number.isFinite)) throw Error('Shape morph origin exceeds numeric limits.');
  return s;
}
function artworkBox(shapes: Vector[]) {
  const result = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const shape of shapes) {
    const b = mergeControlBounds(shape);
    result.left = Math.min(result.left, b.left);
    result.right = Math.max(result.right, b.right);
    result.top = Math.min(result.top, b.top);
    result.bottom = Math.max(result.bottom, b.bottom);
  }
  return result;
}
function artworkBirth(
  shape: Vector,
  from: ReturnType<typeof artworkBox>,
  to: ReturnType<typeof artworkBox>,
): Point {
  const b = mergeControlBounds(shape),
    point = { x: 0, y: 0 };
  for (const [axis, lo, hi] of [
    ['x', 'left', 'right'],
    ['y', 'top', 'bottom'],
  ] as const) {
    const center = b[lo] / 2 + b[hi] / 2,
      size = from[hi] - from[lo],
      span = to[hi] - to[lo],
      fraction = size ? (center - from[lo]) / size : 0.5;
    point[axis] = to[lo] + fraction * span;
    if (![size, span, fraction, point[axis]].every(Number.isFinite))
      throw Error('Shape morph origin exceeds numeric limits.');
  }
  return point;
}
/** Extra raw shapes grow/shrink privately; authored endpoints never gain dummy
 * objects. Existing equal-count ordering and compatible interpolation persist. */
export function matchShapeTweenFrames(
  source: Vector[],
  target: Vector[],
  hints: Parameters<typeof matchShapeTweenArtwork>[2],
  distance: boolean,
  compatible: (a: Vector, b: Vector) => boolean,
  artworkHints?: readonly ArtworkNodeHints[],
): [Vector, Vector][] {
  validateLiveGraphicData([source, target]);
  for (const s of [...source, ...target]) validateKind(s);
  if (hints && source.length !== target.length)
    throw Error('Update shape hints for the changed artwork topology.');
  const bySource = new Map(artworkHints?.map(entry => [entry.sourceId,entry]));
  if (bySource.size) {
    const indices = new Map(source.map((shape,index) => [shape.id,index]));
    for (const entry of bySource.values()) {
      const index = indices.get(entry.sourceId);
      if (index === undefined || target[index]?.id !== entry.targetId)
        throw Error('Hinted artwork no longer matches its original endpoint pair.');
    }
  }
  const bounds =
    source.length === target.length ? undefined : [artworkBox(source), artworkBox(target)];
  const ids = new Set([...source, ...target].map((s) => s.id));
  return Array.from({ length: Math.max(source.length, target.length) }, (_, i) => {
    const a = source[i],
      b = target[i];
    if (a && b) {
      const end = { ...b, id: a.id };
      const entry = bySource.get(a.id);
      const pairs = entry ? entry.hints ?? undefined : hints;
      return a.kind !== 'brush' && b.kind !== 'brush' && !pairs && compatible(a, end)
        ? [a, end]
        : matchShapeTweenArtwork(a, b, pairs, distance, entry?.contourOwners);
    }
    const actual = a ?? b,
      pair = matchShapeTweenArtwork(actual, actual, undefined, distance);
    let id = actual.id;
    if (!a && source.some((s) => s.id === id)) {
      id = `__shape_morph_${i}`;
      while (ids.has(id)) id += '_';
    }
    ids.add(id);
    pair[0].id = pair[1].id = id;
    // New pieces originate in the other drawing rather than fading in at an
    // unrelated destination. Reverse matching uses the same correspondence.
    if (!a) pair[0] = collapseArtwork(pair[0], artworkBirth(actual, bounds![1], bounds![0]));
    if (!b) pair[1] = collapseArtwork(pair[1], artworkBirth(actual, bounds![0], bounds![1]));
    return pair;
  });
}
