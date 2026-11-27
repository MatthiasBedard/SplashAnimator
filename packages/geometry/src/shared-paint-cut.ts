import { hull, paintClassifier, simpleOrthogonalRing, touchingRingNesting } from './paint-boundary';
import { key, reverse, directionKey, walkInkRings, type Edge } from './ink-face-walk';
import { lineContacts, sameStraightCrossing, uniqueLineCubicContact } from './line-contacts';
import { paintCoordinateUnits } from './paint-winding';
import { id, MAX_VECTOR_POINTS, type BezierNode, type Point, type Vector } from '@splash/document';
import { certifyCompoundContours, certifySimpleCurveWalks } from './compound-fit';
import { splitCubic } from './curve-fit';
import { lineCubicCutTimes } from './curve-snap';
import { containsPoint, crossesHorizontalRay, flattenCommands, normalizeVector, pathCommands, worldPaths, type Command } from './drawing';
import { OVERLAY_CURVE_TOLERANCE } from './clip-fill-curves';
import { boundsIndex, type Bounds } from './bounds-index';
import { transverseCubicContacts } from './cubic-crossings';
import { monotoneAxis, monotoneInterval } from './cubic-interval';
import { mapPoint, matrix } from './affine';
import { isEditableInk } from './stroke-cut';
import { filledInkBasisSources, inkBasisPiece, placeFilledInkPieces, prepareInkBasisWriter, type FilledInkInBasis } from './filled-ink-basis';

type Cut = { t: number; along: number; point: Point; side: number };
const line = (a: Point, b: Point): Edge => ({ curve: [a, a, b, b], cubic: false });
const workLimit = 200000;
const parameterMargin = Number.EPSILON * 128;

function elevatedLine(start: Point, a: Point, b: Point, end: Point) {
  // Smooth Pencil stores a straight two-anchor stroke as a degree-elevated
  // line. Recognize its authored controls without a flatness tolerance.
  return (['x', 'y'] as const).every(axis => {
    const third = (end[axis] - start[axis]) / 3;
    return a[axis] === start[axis] + third && b[axis] === end[axis] - third;
  });
}

function authoredEdges(shape: Vector, x = 0, y = 0, ink = false, recognizeLines = false): Edge[] | undefined {
  if (!ink && (shape.strokeWidth ||
      (shape.contours ? shape.contours.length !== 1 : shape.kind !== 'rectangle' && shape.kind !== 'ellipse' &&
        shape.kind !== 'polygon' && !((shape.kind === 'bezier' || shape.kind === 'path') && shape.closed)))) return;
  const basis = matrix({ ...shape, x, y });
  const at = (a: number, b: number) => mapPoint(basis, { x: a, y: b });
  const edges: Edge[] = [];
  let current: Point | undefined, start: Point | undefined, closed = false;
  for (const command of pathCommands(shape)) {
    if (closed) return;
    if (command[0] === 'M') {
      if (start) return;
      current = start = at(command[1], command[2]);
    } else if (current && start) {
      const next = command[0] === 'Z' ? start :
        command[0] === 'C' ? at(command[5], command[6]) : at(command[1], command[2]);
      if (command[0] === 'C') {
        const a = at(command[1], command[2]), b = at(command[3], command[4]);
        if ((key(a) !== key(current) || key(b) !== key(next)) && !(recognizeLines && elevatedLine(current,a,b,next)))
          edges.push({ curve: [current, a, b, next], cubic: true });
        else if (key(current) !== key(next)) edges.push(line(current, next));
      } else if (key(current) !== key(next)) edges.push(line(current, next));
      current = next;
      if (command[0] === 'Z') closed = true;
    }
  }
  if (ink ? edges.length : closed && edges.length >= 3) return edges;
}

function partition(edge: Edge, cuts: readonly { t: number; point: Point }[], lineParameters = false) {
  const fragments: Edge[] = [];
  let rest = edge.curve, start = 0;
  for (const cut of cuts) {
    if (cut.t - start <= parameterMargin && fragments.length && key(cut.point) === key(rest[0])) continue;
    if (cut.t - start <= parameterMargin || 1 - cut.t <= parameterMargin) return;
    const [a, b] = lineParameters ? [line(rest[0], cut.point).curve, line(cut.point, rest[3]).curve] :
      splitCubic(rest, (cut.t - start) / (1 - start));
    a[3] = b[0] = cut.point;
    fragments.push({ curve: a, cubic: edge.cubic });
    rest = b;
    start = cut.t;
  }
  return [...fragments, { curve: rest, cubic: edge.cubic }];
}

// Proven crossings on an axis-aligned line have ordered world coordinates.
// Two distinct vertices can round to the same unit parameter even though
// both fit in the stored path.
function partitionAxisInk(edge: Edge, cuts: readonly Crossing[], charge: (n: number) => void) {
  const [start, , , end] = edge.curve;
  const axis = start.x === end.x ? 'y' : start.y === end.y ? 'x' : undefined;
  if (!axis) return;
  const fixed = axis === 'x' ? 'y' : 'x';
  const sign = Math.sign(end[axis] - start[axis]);
  if (!sign) return;
  charge(cuts.length);
  const ordered = cuts.map(cut => cut.point).sort((a, b) => sign * (a[axis] - b[axis]));
  const fragments: Edge[] = [];
  let previous = start;
  for (const point of ordered) {
    if (point[fixed] !== start[fixed] || !(sign * (end[axis] - point[axis]) > 0)) return;
    if (point[axis] === previous[axis] && previous !== start) continue;
    if (!(sign * (point[axis] - previous[axis]) > 0)) return;
    fragments.push(line(previous, point));
    previous = point;
  }
  return [...fragments, line(previous, end)];
}

function nodes(edges: Edge[], open = false): BezierNode[] {
  const result: BezierNode[] = edges.map(({ curve, cubic }, i) => {
    const before = edges[(i + edges.length - 1) % edges.length];
    return { x: curve[0].x, y: curve[0].y,
      ...(before.cubic && (i || !open) ? { in: { x: before.curve[2].x, y: before.curve[2].y } } : {}),
      ...(cubic ? { out: { x: curve[1].x, y: curve[1].y } } : {}) };
  });
  if (open) {
    const { curve, cubic } = edges[edges.length - 1];
    result.push({ ...curve[3], ...(cubic && { in: { ...curve[2] } }) });
  }
  return result;
}

function boundaryRings(edges: Edge[]) {
  const neighbors = new Map<string, Edge[]>();
  for (const edge of edges) for (const point of [edge.curve[0], edge.curve[3]]) {
    const vertex = key(point), incident = neighbors.get(vertex) ?? [];
    incident.push(edge);
    neighbors.set(vertex, incident);
  }
  if ([...neighbors.values()].some(incident => incident.length !== 2)) return;
  const remaining = new Set(edges), rings: Edge[][] = [];
  for (const first of edges) {
    if (!remaining.delete(first)) continue;
    const ring = [first], start = key(first.curve[0]);
    let end = key(first.curve[3]);
    while (end !== start) {
      const next = neighbors.get(end)?.find(edge => remaining.has(edge));
      if (!next) return;
      remaining.delete(next);
      const directed = key(next.curve[0]) === end ? next : reverse(next);
      ring.push(directed);
      end = key(directed.curve[3]);
    }
    if (ring.length < 2 || (ring.length === 2 && !ring.some(e => e.cubic))) return;
    rings.push(ring);
  }
  return rings;
}

/** Build a private union of two overlapping, axis-aligned rectangles. The
 * grid uses only their authored sides, even when two sides are one ULP apart. */
export function overlappingRectangleOutline(first: Vector, second: Vector): Vector | undefined {
  const boxes = [first, second].map(shape => ({
    left: shape.x, top: shape.y, right: shape.x + shape.width, bottom: shape.y + shape.height,
  }));
  if ([first, second].some(s => s.kind !== 'rectangle' || s.rotation || s.transform || s.cornerRadius || s.contours) ||
      boxes.some(b => !Object.values(b).every(Number.isFinite) || b.left >= b.right || b.top >= b.bottom))
    return;
  const [a, b] = boxes;
  if (Math.max(a.left, b.left) >= Math.min(a.right, b.right) ||
      Math.max(a.top, b.top) >= Math.min(a.bottom, b.bottom)) return;
  const xs = [...new Set(boxes.flatMap(box => [box.left, box.right]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap(box => [box.top, box.bottom]))].sort((a, b) => a - b);
  const perimeter = new Map<string, Edge>();
  for (let j = 1; j < ys.length; j++) {
    for (let i = 1; i < xs.length; i++) {
      const left = xs[i - 1], right = xs[i], top = ys[j - 1], bottom = ys[j];
      if (!boxes.some(box => box.left <= left && box.right >= right && box.top <= top && box.bottom >= bottom))
        continue;
      const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
      for (const [k, corner] of corners.entries()) {
        const edge = line(corner, corners[(k + 1) % corners.length]);
        if (!perimeter.delete(directionKey(reverse(edge)))) perimeter.set(directionKey(edge), edge);
      }
    }
  }
  const rings = boundaryRings([...perimeter.values()]);
  if (rings?.length !== 1) return;
  const boundary = rings[0], x = xs[0], y = ys[0];
  const outline = boundary.flatMap(({ curve: [point, , , next] }, index) => {
    const previous = boundary[(index + boundary.length - 1) % boundary.length].curve[0];
    return previous.x === point.x && point.x === next.x || previous.y === point.y && point.y === next.y
      ? [] : [point];
  });
  const points = outline.map(p => ({ x: p.x - x, y: p.y - y }));
  if (!points.every((p, i) => x + p.x === outline[i].x && y + p.y === outline[i].y)) return;
  const pivot = second.pivot && { x: second.x + second.pivot.x - x, y: second.y + second.pivot.y - y };
  return { ...second, x, y, width: xs[xs.length - 1] - x, height: ys[ys.length - 1] - y, pivot,
    kind: 'polygon', closed: true, fillRule: 'evenodd', points: [], contours: [points], nodes: undefined };
}

function nearSegment(point: Point, a: Point, b: Point, distance: number) {
  const x = b.x - a.x, y = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * x + (point.y - a.y) * y) / (x * x + y * y || 1)));
  return Math.hypot(point.x - (a.x + x * t), point.y - (a.y + y * t)) <= distance;
}

function certifyPaintRings(paths: Point[][], rings: Edge[][], charge?: (cost: number) => void) {
  // Both arcs of a lens share both endpoints. Use the face writer's exact
  // midpoint subdivision so each adjacent pair in the proof has one join.
  const curves = rings.map(ring => {
    const lensEdge = ring.length === 2 ? ring.find(edge => edge.cubic) : undefined;
    return ring.flatMap(edge => edge === lensEdge ? splitCubic(edge.curve, .5) : [edge.curve]);
  });
  try {
    return certifyCompoundContours(paths, curves, OVERLAY_CURVE_TOLERANCE, 0, true, 'dense', true);
  } catch (cause) {
    if (charge && cause instanceof Error && cause.message === 'Outline crosses or has insufficient fitting clearance') {
      if (rings.length === 1 && simpleOrthogonalRing(rings[0],charge)) return { parents: [-1], depths: [0] };
      if (rings.length > 1) {
        const certified = touchingRingNesting(rings,curves,charge);
        if (certified) return certified;
      }
    }
    throw cause;
  }
}

function certifiedSamples(shape: Vector, edges: Edge[], x = 0, y = 0) {
  const [samples] = worldPaths({ ...shape, x, y }, OVERLAY_CURVE_TOLERANCE);
  certifyPaintRings([samples], [edges]);
  return samples;
}

function sharedCutResult(source: Vector, cutter: Vector, part: Edge[], boundary: Edge[]) {
  const rings = boundaryRings(boundary);
  if (!rings?.length) return;
  // Intersecting simple closed contours have no enclosed hole in A minus B:
  // every surviving loop bounds a separate selectable component. The
  // no-crossing (enclosed cutter) case is handled separately by the caller.
  const foregroundEdges = new Set(part);
  const faces = rings.map(ring => [ring.some(edge => foregroundEdges.has(edge)) ? ring.reverse().map(reverse) : ring]);
  const written = writePaintFaces(cutter, part, new Map([[source, faces]]), cutter);
  if (written) return { foreground: written.foreground, background: written.background.get(source)! };
}

type CaptureInkBasis = (ink: Edge[][], faces: ReadonlyMap<Vector, Edge[][][]>, outlines: ReadonlyMap<Vector, Edge[][]>) => void;
type PaintBasisPlacement = { origin: Point; originals: ReadonlyMap<Vector, Vector>; charge: (n: number) => void };

function writePaintFaces(cutter: Vector, part: Edge[], faces: Map<Vector, Edge[][][]>, origin: Point,
  inkSpans?: Edge[][], outlines = new Map<Vector, Edge[][]>(), innerRings: Edge[][] = [],
  refinedInk: Point[][] = [], capture?: CaptureInkBasis, placement?: PaintBasisPlacement) {
  // The document requires three anchors for a closed contour. A lens bounded
  // by two arcs needs one exact subdivision, shared with its neighboring face.
  const extra = new Map<string, Edge[]>();
  function admitRing(ring: Edge[]) {
    if (ring.length >= 3) return true;
    if (ring.length !== 2) return false;
    if (ring.some(e => extra.has(directionKey(e)))) return true;
    const edge = ring.find(e => e.cubic);
    if (!edge) return false;
    const halves = splitCubic(edge.curve, .5).map(curve => ({ curve, cubic: true }));
    extra.set(directionKey(edge), halves);
    extra.set(directionKey(reverse(edge)), backwards(halves));
    return true;
  }
  if (!inkSpans && (!admitRing(part) || !innerRings.every(admitRing))) return;
  for (const regions of faces.values()) for (const rings of regions) if (!rings.every(admitRing)) return;
  if (extra.size) {
    const expand = (edges: Edge[]) => edges.flatMap(edge => extra.get(directionKey(edge)) ?? [edge]);
    part = expand(part);
    innerRings = innerRings.map(expand);
    inkSpans = inkSpans?.map(expand);
    for (const [owner, regions] of faces) faces.set(owner, regions.map(rings => rings.map(expand)));
    for (const [owner, spans] of outlines) outlines.set(owner, spans.map(expand));
  }
  const supported = (p: Point) => [p.x, p.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1e7);
  const valid = (ring: Edge[]) => ring.length <= MAX_VECTOR_POINTS && ring.every(edge => edge.curve.every(supported));
  if (!valid(part) || innerRings.length >= 10000 || !innerRings.every(valid) ||
      inkSpans?.some(span => span.length >= MAX_VECTOR_POINTS)) return;
  for (const regions of faces.values()) if (regions.length > 10000 ||
    regions.some(rings => rings.length > 10000 || !rings.every(valid))) return;
  if (capture) {
    if (inkSpans?.length && [...outlines.values()].every(spans => spans.every(span => valid(span) && span.length < MAX_VECTOR_POINTS)))
      capture(inkSpans, faces, outlines);
    return;
  }
  const sharedPoints = new Map<string, { world: Point; slots: { face: Vector; local: Point }[] }>();
  const writers = placement && new Map<Vector, ReturnType<typeof prepareInkBasisWriter>>();
  function face(owner: Vector, rings: Edge[][], faceId: string, open = false) {
    const original = rings.map(ring => nodes(ring, open));
    if (placement && writers) {
      let write = writers.get(owner);
      if (!write) {
        const source = placement.originals.get(owner);
        if (!source) throw Error('Shared paint placement has no source.');
        write = prepareInkBasisWriter(source, placement.origin, open);
        writers.set(owner, write);
      }
      return write(inkBasisPiece(original, placement.origin, placement.charge), faceId).vector;
    }
    // Resolve shared world coordinates once in the cutter's basis, then use
    // the ordinary authoring box for each piece. Selection and transforms use
    // that box even when the stored contour draws correctly without it.
    const world = (p: Point) => ({ x: origin.x + p.x, y: origin.y + p.y });
    const contours = original.map(ring => ring.map(p => ({ ...world(p),
      ...(p.in && { in: world(p.in) }), ...(p.out && { out: world(p.out) }) })));
    const shape: Vector = { ...owner, id: faceId, x: 0, y: 0, rotation: 0, transform: undefined, kind: 'polygon', closed: true,
      drawingMode: 'merge', points: [], nodes: undefined, cornerRadius: undefined, fillRule: 'evenodd',
      contours, pivot: owner.pivot && mapPoint(matrix(owner), owner.pivot) };
    if (open) {
      shape.fillEnabled = false;
      shape.closed = false;
      shape.contours = undefined;
      shape.fillRule = undefined;
      if (rings[0].some(e => e.cubic)) { shape.kind = 'bezier'; shape.nodes = contours[0]; }
      else { shape.kind = 'path'; shape.points = contours[0]; }
    }
    normalizeVector(shape);
    const register = (p: Point, local: Point) => {
      const k = key(p);
      const shared = sharedPoints.get(k);
      const slot = { face: shape, local };
      if (shared) shared.slots.push(slot);
      else sharedPoints.set(k, { world: world(p), slots: [slot] });
    };
    original.forEach((ring, r) => ring.forEach((node, i) => {
      register(node, contours[r][i]);
      if (node.in) register(node.in, contours[r][i].in!);
      if (node.out) register(node.out, contours[r][i].out!);
    }));
    return shape;
  }
  const strokes = inkSpans?.map((span, i) => face(cutter, [span], i ? id() : cutter.id, true));
  const foreground = strokes?.[0] ?? face(cutter, [part, ...innerRings], cutter.id);
  const background = new Map<Vector, Vector[]>();
  for (const [owner, regions] of faces) background.set(owner, regions.map(rings => face(owner, rings, id())));
  for (const [owner, spans] of outlines) {
    if (!spans.every(span => valid(span) && span.length < MAX_VECTOR_POINTS)) return;
    background.set(owner, spans.map(span => face(owner, [span], id(), true)));
  }
  if (placement) return { foreground, background, strokes };
  const artwork = [...(strokes ?? [foreground]), ...Array.from(background.values()).flat()];
  // Different local origins can round the same control to different world
  // values. Only admit a shared value that round-trips in every owning box.
  function shareAxis(axis: 'x' | 'y') {
    for (const { world, slots } of sharedPoints.values()) {
      if (slots.length < 2) continue;
      const first = slots[0].face[axis] + slots[0].local[axis];
      if (slots.every(s => s.face[axis] + s.local[axis] === first)) continue;
      const origins = [...new Set(slots.map(s => s.face[axis]))];
      const coordinate = origins.map(origin => origin + (world[axis] - origin))
        .find(p => origins.every(origin => origin + (p - origin) === p));
      if (coordinate === undefined) return false;
      for (const s of slots) s.local[axis] = coordinate - s.face[axis];
    }
    return true;
  }
  const axes = (['x','y'] as const).filter(axis => !shareAxis(axis));
  if (axes.length) {
    // Across the stage origin two fractional authoring-box origins can have
    // disjoint representable sums: no local coordinates give the same world
    // vertex. Try nearby origins on the floating-point grid. A different
    // phase can keep two adjacent values distinct while preserving the seam.
    const baselines = axes.map(axis => {
      const size: 'width' | 'height' = axis === 'x' ? 'width' : 'height';
      const extent = artwork.reduce((n,s) => Math.max(n,Math.abs(s[axis]),s[size],Math.abs(s[axis]+s[size])),0);
      return { axis, size, unit: 2 ** (Math.ceil(Math.log2(extent)) - 52),
        boxes: artwork.map(s => ({ s, origin: s[axis], length: s[size], pivot: s.pivot?.[axis] })) };
    });
    if (baselines.some(({unit}) => !(unit > 0 && Number.isFinite(unit)))) return;
    const distinct = () => {
      const positions = new Set<string>();
      for (const {slots:[{face,local}]} of sharedPoints.values()) {
        const position = key({x:face.x+local.x,y:face.y+local.y});
        if (positions.has(position)) return false;
        positions.add(position);
      }
      return true;
    };
    const admitted = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].some(phase =>
      baselines.every(({axis,size,unit,boxes}) => {
        for (const {s,origin,length,pivot} of boxes) {
          const aligned = (Math.floor(origin/unit) + phase)*unit, offset = origin-aligned;
          if (length + offset < 0) return false;
          s[axis] = aligned;
          s[size] = length + offset;
          if (s.pivot && pivot !== undefined) s.pivot[axis] = pivot + offset;
        }
        for (const {world,slots} of sharedPoints.values())
          for (const {face,local} of slots) local[axis] = world[axis] - face[axis];
        return shareAxis(axis);
      }) && distinct());
    if (!admitted) return;
  }
  // Normalizing different authoring boxes can shift close shared points.
  // Check that the stored path still crosses the refined junctions in order.
  for (const points of refinedInk) {
    const end = points[points.length - 1];
    const dx = Math.sign(end.x - points[0].x), dy = Math.sign(end.y - points[0].y);
    let previous: Point | undefined;
    for (const point of points) {
      const slot = sharedPoints.get(key(point))?.slots[0];
      if (!slot) return;
      const saved = { x: slot.face.x + slot.local.x, y: slot.face.y + slot.local.y };
      if (previous && (dx * (saved.x - previous.x) < 0 || dy * (saved.y - previous.y) < 0 ||
          saved.x === previous.x && saved.y === previous.y)) return;
      previous = saved;
    }
  }
  if (artwork.some(s => !supported(s) || !supported({x:s.width,y:s.height}) || (s.pivot && !supported(s.pivot)))) return;
  return { foreground, background, strokes };
}

/** Split the original curves once and build both fills from those same
 * fragments. This slice handles a simple cutter crossing a straight box.
 * Grazing contacts, corner hits, and unresolved rings use ordinary clipping. */
export function prepareSharedRectangleCut(source: Vector, cutter: Vector,
  world: { left: number; right: number; top: number; bottom: number }) {
  const original = authoredEdges(cutter);
  if (!original?.some(edge => edge.cubic)) return;
  // Compute all intersections in one coordinate system before each output
  // gets its own selection box.
  const left = world.left - cutter.x, right = world.right - cutter.x;
  const top = world.top - cutter.y, bottom = world.bottom - cutter.y;
  const corners = [{ x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom }];
  const sides = corners.map((a, i) => [a, corners[(i + 1) % 4]] as const);
  const epsilon = Math.max(1, Math.abs(left), Math.abs(right), Math.abs(top), Math.abs(bottom)) * Number.EPSILON * 128;
  const insideBox = (p: Point) => left < p.x && p.x < right && top < p.y && p.y < bottom;
  const part: Edge[] = [], inside: Edge[] = [], hits: Cut[][] = sides.map(() => []);
  let work = 0;
  for (const edge of original) {
    const cuts: Cut[] = [];
    for (const [side, [a, b]] of sides.entries()) {
      if (++work > workLimit) return;
      const axis = a.x === b.x ? 'x' : 'y', along = axis === 'x' ? 'y' : 'x';
      if (edge.curve.every(p => p[axis] === a[axis])) return;
      for (const t of lineCubicCutTimes(a, b, edge.curve)) {
        if (t <= parameterMargin || t >= 1 - parameterMargin) return;
        const [before, after] = splitCubic(edge.curve, t), p = before[3];
        const u = (p[along] - a[along]) / (b[along] - a[along]);
        if (!(u > 0 && u < 1) || Math.min(Math.abs(p[along] - a[along]), Math.abs(p[along] - b[along])) <= epsilon ||
            Math.abs(p[axis] - a[axis]) > epsilon || Math.abs(after[1][axis] - before[2][axis]) <= epsilon) return;
        cuts.push({ t, along: u, point: { ...p, [axis]: a[axis] }, side });
      }
    }
    cuts.sort((a, b) => a.t - b.t);
    const fragments = partition(edge, cuts);
    if (!fragments) return;
    for (const fragment of fragments) {
      part.push(fragment);
      if (insideBox(splitCubic(fragment.curve, .5)[0][3])) inside.push(fragment);
    }
    for (const cut of cuts) hits[cut.side].push(cut);
  }
  const crossings = hits.reduce((sum, side) => sum + side.length, 0);
  if (!crossings || crossings % 2) return;
  try {
    const samples = certifiedSamples(cutter, original);
    const border: Edge[] = [];
    for (const [side, [a, b]] of sides.entries()) {
      const points = [a, ...hits[side].sort((a, b) => a.along - b.along).map(hit => hit.point), b];
      for (let j = 1; j < points.length; j++) {
        const p = points[j - 1], q = points[j], midpoint = { x: p.x + (q.x - p.x) / 2, y: p.y + (q.y - p.y) / 2 };
        work += samples.length;
        if (work > workLimit || key(p) === key(q) || samples.some((a, i) =>
          nearSegment(midpoint, a, samples[(i + 1) % samples.length], OVERLAY_CURVE_TOLERANCE * 2))) return;
        if (!containsPoint(samples, midpoint)) border.push(line(p, q));
      }
    }
    return sharedCutResult(source, cutter, part, [...border, ...inside]);
  } catch {
    // Optional curve partitioning cannot discard the original paint on failure.
    return;
  }
}

type Crossing = { t: number; point: Point };
type BoundaryEdge = { edge: Edge; owners: Set<Vector>; cuts: Crossing[]; pieces: Edge[]; contacted?: boolean };
type BoundaryContact = { lower: BoundaryEdge; t: number; u: number; point: Point; exactPoint: boolean };
type FilledInkRetry = {
  candidates: { edge: Edge; contacts: BoundaryContact[] }[];
  replay: boolean;
  refined: boolean;
  capture?: CaptureInkBasis;
  requireRefinement?: boolean;
};

function coincidentCubicCuts(contacts: readonly BoundaryContact[]) {
  const vertices = new Set<string>();
  for (const { lower, t, u, point } of contacts) {
    if (!lower.edge.cubic || !(t > 0 && t < 1 && u > 0 && u < 1)) continue;
    const vertex = key(point);
    if (vertices.has(vertex)) return true;
    vertices.add(vertex);
  }
  return false;
}

function splitCloseStraightInk(edge: Edge, contacts: BoundaryContact[], charge: (n: number) => void,
  allowAxis: boolean) {
  const [start,,,end] = edge.curve;
  const dx = end.x - start.x, dy = end.y - start.y;
  if ((!dx || !dy) && (!allowAxis || !dx && !dy)) return;
  const interior = contacts.filter(c => c.t > 0 && c.t < 1).sort((a,b) => a.t - b.t);
  if (!interior.length || interior[0].t <= parameterMargin ||
      1 - interior[interior.length - 1].t <= parameterMargin) return;
  charge(contacts.length);
  const close = interior.filter((contact,i) =>
    contact.t - (interior[i-1]?.t ?? -Infinity) <= parameterMargin ||
    (interior[i+1]?.t ?? Infinity) - contact.t <= parameterMargin);
  if (!close.length || new Set(close.map(c => c.lower)).size !== close.length) return;
  const replacements = new Map<BoundaryContact, BoundaryContact>();
  for (const contact of close) {
    if (!contact.lower.edge.cubic) {
      if (!contact.exactPoint) return;
      continue;
    }
    if (!(contact.u > 0 && contact.u < 1)) return;
    const exact = uniqueLineCubicContact(start, end, contact.lower.edge.curve, charge);
    if (!exact) return;
    replacements.set(contact, { ...contact, ...exact });
  }
  const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', other = axis === 'x' ? 'y' : 'x';
  const forward = Math.sign(end[axis] - start[axis]), across = Math.sign(end[other] - start[other]);
  const sorted = interior.map(contact => replacements.get(contact) ?? contact)
    .sort((a,b) => forward * (a.point[axis] - b.point[axis]) || across * (a.point[other] - b.point[other]));
  const progresses = (a: Point, b: Point) => {
    const primary = forward * (b[axis] - a[axis]), secondary = across * (b[other] - a[other]);
    return primary >= 0 && secondary >= 0 && (primary > 0 || secondary > 0);
  };
  const points = [start];
  let previous: BoundaryContact | undefined;
  for (const contact of sorted) {
    const point = contact.point;
    if (!across && point[other] !== start[other]) return;
    if (previous && point.x === previous.point.x && point.y === previous.point.y) {
      // A shared rounded point alone does not prove a shared crossing.
      const a = previous.lower.edge, b = contact.lower.edge;
      charge(1);
      if (a.cubic || b.cubic || !sameStraightCrossing(start, end, [a.curve[0], a.curve[3]], [b.curve[0], b.curve[3]]))
        return;
      continue;
    }
    if (!progresses(points[points.length - 1], point)) return;
    points.push(point);
    previous = contact;
  }
  if (!progresses(points[points.length - 1], end)) return;
  points.push(end);
  return { contacts: contacts.map(c => replacements.get(c) ?? c),
    pieces: points.slice(1).map((point,i) => line(points[i], point)), points };
}

function sameCrossedBoundary(a: BoundaryContact, b: BoundaryContact, support: (edge: Edge) => Edge,
  charge: (n: number) => void) {
  if (key(a.point) === key(b.point)) return true;
  if (a.u === 0 || a.u === 1 || b.u === 0 || b.u === 1) return false;
  const first = support(a.lower.edge), second = support(b.lower.edge);
  const scale = Math.max(1, ...[...first.curve, ...second.curve].flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  const epsilon = Number.EPSILON * 16 * scale;
  const close = (p: Point, q: Point) => Math.abs(p.x - q.x) <= epsilon && Math.abs(p.y - q.y) <= epsilon;
  if (!close(a.point, b.point)) return false;
  if (!first.cubic && !second.cubic && (['x','y'] as const).some(axis =>
    [...first.curve, ...second.curve].every(p => p[axis] === first.curve[0][axis]))) return true;
  if (first.cubic !== second.cubic || [...a.lower.owners].some(owner => b.lower.owners.has(owner))) return false;
  const timeMargin = parameterMargin * 8;
  if (Math.abs(a.u - b.u) <= timeMargin && first.curve.every((p,i) => close(p,second.curve[i])) ||
      Math.abs(a.u + b.u - 1) <= timeMargin && first.curve.every((p,i) => close(p,second.curve[3-i]))) return true;
  if (!first.cubic) return false;
  const sharedInterval = (source: Edge, target: Edge, u: number, v: number) => {
    const interval = monotoneInterval(source.curve,target.curve,close,() => charge(1));
    return interval && Math.abs(u - (interval.start + (interval.end-interval.start)*v)) <= timeMargin;
  };
  return sharedInterval(first,second,a.u,b.u) || sharedInterval(second,first,b.u,a.u);
}
const backwards = (ring: Edge[]) => ring.slice().reverse().map(reverse);

function cutRingAtArc(ring: Edge[], start: number, end: number, arc: Edge[]) {
  const ordered = [...ring.slice(start), ...ring.slice(0, start)];
  const cut = (end - start + ring.length) % ring.length;
  return [[...ordered.slice(0, cut), ...backwards(arc)], [...arc, ...ordered.slice(cut)]];
}

function alongLine(edge: Edge, p: Point) {
  const a = edge.curve[0], b = edge.curve[3], dx = b.x-a.x, dy = b.y-a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (p.x-a.x)/dx : (p.y-a.y)/dy;
}

function commonEnd(a: Edge, b: Edge, charge: (n: number) => void, budget: {remaining: number}) {
  for (const i of [0,3] as const) for (const j of [0,3] as const) {
    const p = a.curve[i];
    if (key(p) !== key(b.curve[j])) continue;
    // Opposing caps can have the same tangent. If a coordinate separates
    // their control hulls, each open curve stays strictly on its own side.
    for (const axis of ['x','y'] as const) {
      const left = a.curve.map(q => q[axis]), right = b.curve.map(q => q[axis]);
      const lo = Math.min(...left), hi = Math.max(...left);
      const otherLo = Math.min(...right), otherHi = Math.max(...right);
      if (lo === hi || otherLo === otherHi || !(hi === otherLo || otherHi === lo)) continue;
      const ends = [0,3] as const;
      return ends.flatMap(m => ends.flatMap(n => key(a.curve[m]) === key(b.curve[n])
        ? [{ t:m/3, u:n/3, point:a.curve[m] }] : []));
    }
    const incoming = i === 3 ? a : reverse(a), outgoing = j === 0 ? b : reverse(b);
    const curves = [incoming.curve,outgoing.curve];
    const scale = curves.reduce((max,c) => c.reduce((n,q) => Math.max(n,Math.abs(q.x),Math.abs(q.y)),max),1);
    // Sharing a vertex alone does not exclude retracing or another crossing.
    try {
      certifySimpleCurveWalks([curves],false,scale*Number.EPSILON*64,true,true,(n=1)=>charge(n));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Fitted join cannot be separated') throw error;
      const contacts = transverseCubicContacts(a.curve,b.curve,budget,true);
      if (!contacts) throw error;
      return contacts;
    }
    return [{t:i/3,u:j/3,point:p}];
  }
}

// A cubic whose controls lie in one closed half-plane can touch its
// supporting line only at an endpoint unless it is collinear throughout.
function lineEndpointContacts(lineEdge: Edge, edge: Edge) {
  const [a,,,b] = lineEdge.curve;
  const axis = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
  const sides = axis ? edge.curve.map(p => Math.sign(p[axis] - a[axis])) : (() => {
    const x = paintCoordinateUnits(a.x), y = paintCoordinateUnits(a.y);
    const dx = paintCoordinateUnits(b.x) - x, dy = paintCoordinateUnits(b.y) - y;
    return edge.curve.map(p => {
      const determinant = dx * (paintCoordinateUnits(p.y) - y) - dy * (paintCoordinateUnits(p.x) - x);
      return determinant > 0n ? 1 : determinant < 0n ? -1 : 0;
    });
  })();
  if (sides.every(s => s === 0) || (sides.some(s => s < 0) && sides.some(s => s > 0))) return;
  return ([0, 3] as const).flatMap(i => {
    const point = edge.curve[i], t = alongLine(lineEdge, point);
    return sides[i] === 0 && t >= 0 && t <= 1 ? [{ t, u: i / 3, point }] : [];
  });
}

// A fitted anchor can lie in the middle of a straight edge in either
// drawing order. Keep the endpoint's original coordinates on both edges.
function straightContacts(first: Edge, second: Edge) {
  if (!first.cubic && !second.cubic)
    return lineContacts(first.curve[0], first.curve[3], second.curve[0], second.curve[3]);
  if (!first.cubic) return lineEndpointContacts(first, second);
  if (!second.cubic)
    return lineEndpointContacts(second, first)?.map(({ t, u, point }) => ({ t: u, u: t, point }));
}

// A strictly monotone coordinate has only one intersection with the axis.
// If its midpoint lies there exactly, keep the representable world point
// instead of round-tripping it through the normalized cubic solver.
function axisMidpointContact(straight: Edge, arc: Edge, charge: (n: number) => void) {
  const [a,,,b] = straight.curve;
  const fixed = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
  if (!fixed || !arc.cubic) return;
  const [p, q, r, s] = arc.curve;
  const direction = Math.sign(s[fixed] - p[fixed]);
  if (!(direction * (a[fixed] - p[fixed]) > 0 && direction * (s[fixed] - a[fixed]) > 0) ||
      !arc.curve.slice(1).every((point, i) => direction * (point[fixed] - arc.curve[i][fixed]) >= 0)) return;
  const point = splitCubic(arc.curve, .5)[0][3];
  if (point[fixed] !== a[fixed]) return;
  const t = alongLine(straight, point);
  if (!(t > 0 && t < 1)) return;
  charge(1);
  const exact = (axis: 'x' | 'y') => {
    const units = paintCoordinateUnits;
    return 8n * units(point[axis]) === units(p[axis]) + 3n * (units(q[axis]) + units(r[axis])) + units(s[axis]);
  };
  if (exact('x') && exact('y')) return [{ t, u: .5, point }];
}

// A fitted straight side can still carry cubic handles. Use its chord for
// incidence only when the control polygon advances exactly along the segment.
function straightSupport(edge: Edge) {
  if (!edge.cubic) return edge;
  const [a, b, c, d] = edge.curve;
  if (key(a) === key(d)) return edge;
  const chord = line(a, d);
  const onChord = (p: Point) => {
    if (a.x === d.x) return p.x === a.x;
    if (a.y === d.y) return p.y === a.y;
    const units = paintCoordinateUnits;
    return (units(d.x)-units(a.x))*(units(p.y)-units(a.y)) ===
      (units(d.y)-units(a.y))*(units(p.x)-units(a.x));
  };
  if (!onChord(b) || !onChord(c)) return edge;
  const first = alongLine(edge, b), last = alongLine(edge, c);
  return first >= 0 && first <= last && last <= 1 ? chord : edge;
}

function cutParameter(edge: Edge, support: Edge, t: number, point: Point, fromStraightContact: boolean,
  charge: (n: number) => void) {
  if (!fromStraightContact) return edge.cubic ? t : alongLine(edge, point);
  if (edge === support) return t;
  // The contact used chord distance. Split the authored cubic at the
  // parameter that reaches that distance along its monotone straight side.
  const b = alongLine(edge, edge.curve[1]), c = alongLine(edge, edge.curve[2]);
  let low = 0, high = 1;
  for (let i = 0; i < 54; i++) {
    charge(1);
    const mid = (low + high) / 2, u = 1 - mid;
    const progress = mid*(3*u*u*b + mid*(3*u*c+mid));
    if (progress === t) return mid;
    if (progress < t) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// A previous cut can leave just a subarc of the new outline in the artwork.
// Recover its existing end vertices and controls before intersecting the
// neighboring faces. They all need to refer to exactly the same junction.
function matchPaintSubarcs(edge: Edge, candidates: BoundaryEdge[], charge: (n: number) => void) {
  const box = hull(edge);
  const epsilon = 16 * Number.EPSILON * Math.max(1, ...Object.values(box).map(Math.abs));
  const equal = (p: Point, q: Point) => Math.abs(p.x-q.x) <= epsilon && Math.abs(p.y-q.y) <= epsilon;
  const cuts: Crossing[] = [];
  const shared = new Map<string,Edge>();
  for (const {edge: other} of candidates) {
    charge(1);
    if (!other.cubic || other.curve.some(p => p.x < box.left-epsilon || p.x > box.right+epsilon ||
      p.y < box.top-epsilon || p.y > box.bottom+epsilon)) continue;
    const range = monotoneInterval(edge.curve, other.curve, equal, () => charge(1));
    if (!range) continue;
    const {start,end} = range;
    const span = start < end ? other : reverse(other);
    const low = Math.min(start,end), high = Math.max(start,end);
    // Endpoints already present in the new outline are authoritative.
    if (low === 0 && key(span.curve[0]) !== key(edge.curve[0]) ||
        high === 1 && key(span.curve[3]) !== key(edge.curve[3])) continue;
    if (low > 0) cuts.push({ t:low, point:span.curve[0] });
    if (high < 1) cuts.push({ t:high, point:span.curve[3] });
    shared.set(key(span.curve[0])+':'+key(span.curve[3]), span);
  }
  if (!cuts.length) return [edge];
  const segments = partition(edge, cuts.sort((a,b) => a.t-b.t));
  if (!segments) throw Error('Ambiguous shared paint interval');
  return segments.map(piece => shared.get(key(piece.curve[0])+':'+key(piece.curve[3])) ?? piece);
}

function inkIntervals(edges: Edge[], contacts: Set<string>, closed: boolean) {
  let ordered = edges;
  if (closed) {
    const start = edges.findIndex(e => contacts.has(key(e.curve[0])));
    if (start >= 0) ordered = [...edges.slice(start), ...edges.slice(0, start)];
  }
  const spans: Edge[][] = [];
  for (const edge of ordered) {
    if (!spans.length || contacts.has(key(edge.curve[0]))) spans.push([]);
    spans[spans.length - 1].push(edge);
  }
  return spans;
}

// A previous cut may have left an exterior vertex in the interior of the
// incoming curve. An interior/interior root proof cannot include a root on
// that endpoint. Recover the stored vertex only at a transverse passage
// with incident branches on both sides. Then intersect every subarc again.
function divideAtCrossedVertices(edge: Edge, neighbors: BoundaryEdge[], self: Crossing[], charge: (n: number) => void) {
  const curve = edge.curve, axis = monotoneAxis(curve);
  if (!axis) return;
  const bounds = hull(edge);
  const margin = Math.min(1e-8, 16*Number.EPSILON*Math.max(1,...Object.values(bounds).map(Math.abs)));
  const branches = new Map<string, {point: Point; directions: Point[]}>();
  for (const {edge: neighbor} of neighbors) for (const end of [0,3] as const) {
    charge(1);
    const point = neighbor.curve[end];
    if (point.x < bounds.left-margin || point.x > bounds.right+margin ||
        point.y < bounds.top-margin || point.y > bounds.bottom+margin) continue;
    const k = key(point);
    const adjacent = end ? [...neighbor.curve].reverse() : neighbor.curve;
    const direction = adjacent.find(p => key(p) !== k);
    if (!direction) continue;
    const vertex = branches.get(k);
    if (vertex) vertex.directions.push(direction);
    else branches.set(k,{point,directions:[direction]});
  }
  const cuts = [...self];
  const increasing = curve[3][axis] > curve[0][axis];
  for (const {point,directions} of branches.values()) {
    if (directions.length < 2) continue;
    let lo = 0, hi = 1;
    if (point[axis] <= Math.min(curve[0][axis],curve[3][axis]) ||
        point[axis] >= Math.max(curve[0][axis],curve[3][axis])) continue;
    for (let i=0;i<54;i++) {
      charge(1);
      const middle = (lo+hi)/2;
      const [left] = splitCubic(curve,middle), at = left[3];
      if (Math.abs(at.x-point.x)<=margin && Math.abs(at.y-point.y)<=margin) {
        const t = edge.cubic ? middle : alongLine(edge,point);
        const dx = at.x-left[2].x, dy = at.y-left[2].y;
        const sides = directions.map(p => {
          const a = dx*(p.y-point.y), b = dy*(p.x-point.x);
          return Math.abs(a-b) > (Math.abs(a)+Math.abs(b))*64*Number.EPSILON ? Math.sign(a-b) : 0;
        });
        if (sides.includes(1) && sides.includes(-1)) cuts.push({t,point});
        break;
      }
      if (increasing === (at[axis] < point[axis])) lo=middle;
      else hi=middle;
    }
  }
  if (cuts.length > self.length) return partition(edge,cuts.sort((a,b)=>a.t-b.t),!edge.cubic);
}

function uniqueInkSpans(spans: Edge[][], covered: Set<string>) {
  const result: Edge[][] = [];
  for (const span of spans) {
    let kept: Edge[] | undefined;
    for (const edge of span) {
      if (covered.has(directionKey(edge))) { kept = undefined; continue; }
      covered.add(directionKey(edge));
      covered.add(directionKey(reverse(edge)));
      if (!kept) { kept = []; result.push(kept); }
      kept.push(edge);
    }
  }
  return result;
}

/** Twice the signed area, integrating each original Bézier. A short arc
 * and its chord can bound a real face below the drawing sample tolerance. */
function ringArea(ring: Edge[]) {
  const origin = ring[0].curve[0];
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  let area = 0;
  for (const {curve:[a,b,c,d], cubic} of ring) {
    area += cross(origin,a,d);
    if (cubic) area += 0.3 * (cross(a,b,c) + cross(a,b,d) + 2*cross(a,c,d));
  }
  return area;
}

function groupInkRings(rings: Edge[][], charge: (n: number) => void) {
  const entries = rings.map(ring => {
    const path = flattenCommands([
      ['M', ring[0].curve[0].x, ring[0].curve[0].y],
      ...ring.map(({curve: [, a, b, end], cubic}): Command => cubic ?
        ['C', a.x, a.y, b.x, b.y, end.x, end.y] : ['L', end.x, end.y]), ['Z'],
    ], OVERLAY_CURVE_TOLERANCE)[0];
    charge(path.length);
    return { ring, path, area: ringArea(ring), holes: [] as Edge[][] };
  });
  if (entries.some(entry => !Number.isFinite(entry.area) || !entry.area)) return;
  const holes = entries.filter(entry=>entry.area<0);
  const exteriors = entries.filter(entry => entry.area > 0).sort((a,b) => a.area-b.area);
  if (!holes.length) return exteriors.map(entry => [entry.ring]);
  // Reuse indexes for every hole probe. The original scan charged a
  // complete flattened exterior on every probe, even near distant holes.
  const indexed = exteriors.map(entry=>{
    const sides = entry.path.slice(1).map((point,i)=>[entry.path[i],point] as const);
    const sideLookup = boundsIndex(sides.map(([a,b])=>({
      left:Math.min(a.x,b.x), right:Math.max(a.x,b.x),
      top:Math.min(a.y,b.y), bottom:Math.max(a.y,b.y),
    })));
    return {...entry,sides,sideLookup};
  });
  for (const hole of holes) {
    const owner = indexed.find(({ring,sides,sideLookup,area}) => {
      if (area <= -hole.area) return false;
      for (const edge of hole.ring) {
        const point = splitCubic(edge.curve,.5)[0][3];
        const probe = {left:point.x,right:point.x,top:point.y,bottom:point.y};
        const nearby = sideLookup(probe,2*OVERLAY_CURVE_TOLERANCE);
        charge(1 + nearby.length);
        if (nearby.some(i=>nearSegment(point,...sides[i],2*OVERLAY_CURVE_TOLERANCE))) continue;
        const ray = sideLookup({...probe,left:-Infinity,right:Infinity});
        charge(1 + ray.length);
        return ray.reduce((inside,i)=>inside !== crossesHorizontalRay(sides[i][1],sides[i][0],point),false);
      }
      // An enclosed ink loop produces two walks of the same boundary. Its
      // reverse walk bounds a hole in the surrounding face. Rounded areas
      // can differ even when both walks use exactly the same cubic edges.
      charge(ring.length + hole.ring.length);
      const edges = new Set(ring.map(e => directionKey(reverse(e))));
      const witness = hole.ring.find(e => !edges.has(directionKey(e)));
      return witness ? paintClassifier(ring, charge)(witness) : false;
    });
    if (!owner) return;
    owner.holes.push(hole.ring);
  }
  return exteriors.map(entry => [entry.ring, ...entry.holes]);
}

/** Partition the new outline against the entire paint stack before emitting
 * any face. Old edges shared by two colors also get just one intersection
 * calculation and one subdivision, even if their stored directions differ. */
type IndependentPaintWork = { remaining: number; upper: { rings: Edge[][]; samples: Point[][]; depths: number[];
  inside: (edge: Edge) => boolean } };

function readPaintRings(owner: Vector, ink = false, recognizeLines = false) {
  const paths = owner.contours ? owner.contours.map(ring => ({ ...owner, contours: [ring] })) : [owner];
  return paths.map(path => {
    const edges = authoredEdges(path, owner.x, owner.y, ink, recognizeLines);
    if (!edges) throw Error('Unsupported paint contour');
    return edges;
  });
}

/** Resolve a loaded even-odd face whose two otherwise simple contours cross.
 * The face walk follows original subcurves, with material on the left. */
function splitCrossingPaintRings(rings: Edge[][], samples: Point[][], budget: { remaining: number },
  charge: (n: number) => void) {
  if (rings.length !== 2) return;
  const cuts = new Map<Edge, { t: number; point: Point }[]>();
  const vertices = new Set<string>();
  const [first, second] = rings;
  for (const [i, ring] of rings.entries()) certifyPaintRings([samples[i]], [ring], charge);
  const lookup = boundsIndex(second.map(hull));
  for (const a of first) {
    charge(1);
    for (const j of lookup(hull(a))) {
      charge(1);
      const b = second[j];
      const hits = straightContacts(a, b) ?? transverseCubicContacts(a.curve, b.curve, budget);
      if (!hits) return;
      for (const { t, u, point } of hits) {
        charge(1);
        const vertex = key(point);
        if (vertices.has(vertex) || Math.min(t, u, 1 - t, 1 - u) <= parameterMargin) return;
        vertices.add(vertex);
        for (const [edge, time] of [[a, t], [b, u]] as const) {
          const list = cuts.get(edge) ?? [];
          list.push({ t: time, point });
          cuts.set(edge, list);
        }
      }
    }
  }
  if (!vertices.size || vertices.size % 2) return;

  const oriented: Edge[] = [];
  for (const [i, ring] of rings.entries()) {
    const insideOther = paintClassifier(rings[1 - i], charge);
    const area = ringArea(ring);
    if (!Number.isFinite(area) || !area) return;
    for (const edge of ring) {
      const list = cuts.get(edge) ?? [];
      charge(1 + list.length);
      const parts = partition(edge, list.sort((a, b) => a.t - b.t), !edge.cubic);
      if (!parts) return;
      for (const part of parts) oriented.push((area > 0) !== insideOther(part) ? part : reverse(part));
    }
  }
  const walks = walkInkRings([oriented], [], charge);
  if (!walks?.length || walks.reduce((n, ring) => n + ring.length, 0) !== oriented.length) return;
  return walks;
}

function prepareLowerPaintRings(owner: Vector, budget: { remaining: number }, charge: (n: number) => void) {
  let rings = readPaintRings(owner);
  const samples = worldPaths(owner, OVERLAY_CURVE_TOLERANCE);
  charge(samples.reduce((n, ring) => n + ring.length, 0));
  try {
    return { rings, depths: certifyPaintRings(samples, rings, charge).depths };
  } catch (cause) {
    if (owner.fillRule !== 'evenodd' || !(cause instanceof Error) ||
        cause.message !== 'Outline crosses or has insufficient fitting clearance') throw cause;
    const split = splitCrossingPaintRings(rings, samples, budget, charge);
    if (!split) throw cause;
    rings = split;
    const paths = worldPaths({
      ...owner, x: 0, y: 0, rotation: 0, transform: undefined, kind: 'polygon',
      contours: rings.map(ring => nodes(ring)),
    }, OVERLAY_CURVE_TOLERANCE);
    charge(paths.reduce((n, ring) => n + ring.length, 0));
    return { rings, depths: certifyPaintRings(paths, rings, charge).depths };
  }
}

type PaintCutMode = 'paint' | 'ink' | 'union' | 'selection';
type InkPolicy = { stroke?: Vector; removeCoveredInk: boolean; rejectCoincidentInk?: boolean };

export function prepareSharedPaintStack(sources: Vector[], cutter: Vector, mode: PaintCutMode = 'paint',
  inkPolicy?: InkPolicy): ReturnType<typeof cutPaintStack> {
  if (mode === 'paint' && inkPolicy && !inkPolicy.removeCoveredInk && !inkPolicy.stroke && !inkPolicy.rejectCoincidentInk) {
    const placed = sources.find(owner => owner.controlBounds);
    if (placed) {
      const budget = { remaining: workLimit };
      return preparePlacedPaintOverInk(sources, cutter, { x: placed.x, y: placed.y }, inkPolicy, budget) ??
        cutPaintStack(sources, cutter, mode, inkPolicy, undefined, budget);
    }
  }
  if (mode === 'ink') {
    const placed = sources.find(owner => owner.controlBounds) ?? (cutter.controlBounds ? cutter : undefined);
    if (placed) {
      if (inkPolicy) return;
      const local = cutFilledInkInBasis(sources, cutter, { x: placed.x, y: placed.y }, false);
      const pieces = local && placeFilledInkPieces(local, cutter);
      if (!pieces) return;
      const strokes = pieces.ink.map(piece => piece.vector);
      const background = new Map([...pieces.fills, ...pieces.outlines].map(([owner, replacements]) =>
        [owner, replacements.map(piece => piece.vector)]));
      return { foreground: strokes[0], background, strokes, upperArtwork: undefined };
    }
  }
  if (mode !== 'ink' || inkPolicy || !sources.every(owner => !isEditableInk(owner)))
    return cutPaintStack(sources, cutter, mode, inkPolicy);
  const budget = { remaining: workLimit };
  const retry: FilledInkRetry = { candidates: [], replay: false, refined: false };
  const ordinary = cutPaintStack(sources, cutter, mode, inkPolicy, undefined, budget, retry);
  if (!ordinary || !retry.candidates.length) return ordinary;
  // Keep the already prepared faces if exact roots or their settled storage
  // are uncertain. Charge the proof and any replay to the same cut budget.
  try {
    const charge = (n: number) => {
      if ((budget.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
    };
    if (!retry.candidates.some(({ edge, contacts }) => splitCloseStraightInk(edge, contacts, charge, false))) return ordinary;
  } catch {
    return ordinary;
  }
  retry.replay = true;
  const refined = cutPaintStack(sources, cutter, mode, inkPolicy, undefined, budget, retry);
  return retry.refined && refined ? refined : ordinary;
}

export function prepareOverlappingPaintUnion(lower: Vector, upper: Vector, budget: { remaining: number }) {
  try {
    const charge = (n: number) => {
      if ((budget.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
    };
    const a = readPaintRings(lower).flat(), b = readPaintRings(upper).flat();
    charge(a.length + b.length);
    const reachesInterior = (edges: Edge[], other: Edge[]) => {
      const inside = paintClassifier(other, charge);
      return edges.some(edge => {
        try { return inside(edge); }
        catch (cause) {
          if (!(cause instanceof Error) || cause.message !== 'Ambiguous paint boundary') throw cause;
          return false;
        }
      });
    };
    // A control box covers empty corners and shared seams. Require an
    // interior witness before spending this optional retry on contacts.
    if (!reachesInterior(a, b) && !reachesInterior(b, a)) return;
  } catch {
    return;
  }
  const cut = cutPaintStack([lower], upper, 'union', undefined, undefined, budget);
  if (cut?.background.get(lower)?.length === 0) return cut.foreground;
}

/** Prepare a cut for a caller that can retain the common placement origin.
 * The returned contours are detached working data, not document vectors. */
export function prepareFilledInkInBasis(sources: Vector[], cutter: Vector, origin: Point): FilledInkInBasis | undefined {
  return cutFilledInkInBasis(sources, cutter, origin, true);
}

function cutFilledInkInBasis(sources: Vector[], cutter: Vector, origin: Point,
  requireRefinement: boolean): FilledInkInBasis | undefined {
  const budget = { remaining: workLimit };
  const charge = (n: number) => {
    if ((budget.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
  };
  try {
    const local = filledInkBasisSources(sources, cutter, origin, charge);
    if (!local) return;
    const owners = new Map<Vector, Vector>(local.sources.map((source, index) => [source, sources[index]]));
    let prepared: FilledInkInBasis | undefined;
    const spans = (pieces: Edge[][]) => pieces.map(span => inkBasisPiece([nodes(span, true)], origin, charge));
    const capture: CaptureInkBasis = (ink, faces, outlines) => {
      const fills = new Map([...faces].map(([owner, regions]) => [owners.get(owner)!,
        regions.map(rings => inkBasisPiece(rings.map(ring => nodes(ring)), origin, charge))]));
      prepared = { origin: { x: origin.x, y: origin.y }, fills,
        ink: spans(ink), outlines: new Map([...outlines].map(([owner, pieces]) => [owners.get(owner)!, spans(pieces)])) };
    };
    cutPaintStack(local.sources, local.cutter, 'ink', undefined, undefined, budget,
      { candidates: [], replay: true, refined: false, capture, requireRefinement });
    return prepared;
  } catch {
    return;
  }
}

function preparePlacedPaintOverInk(sources: Vector[], cutter: Vector, origin: Point, policy: InkPolicy,
  budget: { remaining: number }) {
  try {
    const charge = (n: number) => {
      if ((budget.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
    };
    const local = filledInkBasisSources(sources, cutter, origin, charge, true);
    if (!local) return;
    const originals = new Map(local.sources.map((source, i) => [source, sources[i]]));
    originals.set(local.cutter, cutter);
    const placement = { origin, originals, charge };
    const cut = cutPaintStack(local.sources, local.cutter, 'paint', policy, undefined, budget, undefined, placement);
    if (!cut?.upperArtwork) return;
    return { ...cut, background: new Map([...cut.background].map(([owner, pieces]) => [originals.get(owner)!, pieces])) };
  } catch {
    // A marked path can use the shared basis only when every control fits.
    return;
  }
}

function cutPaintStack(sources: Vector[], cutter: Vector, mode: PaintCutMode, inkPolicy?: InkPolicy,
  independent?: IndependentPaintWork, budget = independent ?? { remaining: workLimit }, fillRetry?: FilledInkRetry,
  placement?: PaintBasisPlacement) {
  const openInk = mode === 'ink';
  if (mode === 'selection' && sources.length !== 1) return;
  const border = inkPolicy?.stroke;
  const coverInk = inkPolicy?.removeCoveredInk && !border;
  const compound = (cutter.contours?.length ?? 0) > 1;
  if (!sources.length || compound && (openInk || border || cutter.fillRule !== 'evenodd')) return;
  const charge = (n: number) => {
    if ((budget.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
  };
  try {
    const upperRings = independent?.upper.rings ?? readPaintRings(cutter, openInk, openInk);
    const upper = upperRings.flat();
    const upperSamples = independent?.upper.samples ?? worldPaths(cutter, OVERLAY_CURVE_TOLERANCE);
    let upperDepths: number[] = [];
    const selfCuts = new Map<Edge,Crossing[]>();
    const intersections = new Set<string>();
    if (openInk) {
      // A monotone projection cheaply proves simplicity for ordinary lines.
      // Freehand turns can change direction on every axis and still be simple.
      const a = upper[0].curve[0], b = upper[upper.length - 1].curve[3];
      const projection = (p: Point) => (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
      const progresses = (project: (p: Point) => number) => upper.every(({ curve }) => project(curve[3]) > project(curve[0]) &&
        curve.slice(1).every((p,i) => project(p) >= project(curve[i])));
      if (!progresses(projection) && !(['x','y'] as const).some(axis => progresses(p => Math.sign(b[axis]-a[axis])*p[axis]))) {
        const curves = upper.map(edge => edge.curve);
        const scale = curves.reduce((max, curve) => curve.reduce((n,p) =>
          Math.max(n,Math.abs(p.x),Math.abs(p.y)), max), 1);
        const epsilon = scale * Number.EPSILON * 64;
        const index = boundsIndex(upper.map(hull));
        for (const [i,edge] of upper.entries()) {
          // A span is simple in isolation. Even consecutive spans can meet
          // again past their common endpoint and split the same face.
          if (edge.cubic)
            certifySimpleCurveWalks([[edge.curve]], false, epsilon, true, true, (n=1) => charge(n));
          for (const j of index(hull(edge))) {
            if (j <= i) continue;
            charge(1);
            const other = upper[j];
            const straightPair = !edge.cubic && !other.cubic;
            const hits = straightContacts(edge, other) ?? commonEnd(edge,other,charge,budget) ??
              transverseCubicContacts(edge.curve,other.curve,budget);
            if (!hits) return;
            if (j === i+1 && hits.length === 1) continue;
            for (const {t,u,point} of hits) {
              intersections.add(key(point));
              for (const [span,time] of [[edge,t],[other,u]] as const) {
                const cuts = selfCuts.get(span) ?? [];
                if (time > 0 && time < 1) cuts.push({t:span.cubic || straightPair ? time : alongLine(span,point),point});
                selfCuts.set(span,cuts);
              }
            }
          }
        }
      }
    } else upperDepths = independent?.upper.depths ?? certifyPaintRings(upperSamples, upperRings, charge).depths;
    const insideUpper = independent?.upper.inside ?? paintClassifier(upper, charge);
    const pool: BoundaryEdge[] = [];
    const byDirection = new Map<string, { boundary: BoundaryEdge; reversed: boolean }>();
    const intern = (edge: Edge, owner: Vector) => {
      charge(1);
      const k = directionKey(edge), existing = byDirection.get(k);
      if (existing) { existing.boundary.owners.add(owner); return existing; }
      const boundary: BoundaryEdge = { edge, owners: new Set([owner]), cuts: [], pieces: [] }, ref = { boundary, reversed: false };
      byDirection.set(k, ref);
      byDirection.set(directionKey(reverse(edge)), { boundary, reversed: true });
      pool.push(boundary);
      return ref;
    };
    const outlineRefs = new Map<Vector, ReturnType<typeof intern>[]>();
    const separateInk = openInk || !!inkPolicy;
    const layers = sources.filter(owner => !separateInk || !isEditableInk(owner)).map(owner => {
      if ((owner.contours?.length ?? 0) > 1 && owner.fillRule !== 'evenodd') throw Error('Unsupported compound winding');
      const { rings, depths } = prepareLowerPaintRings(owner, budget, charge);
      const edges = rings.flat();
      const extent = edges.reduce((extent, edge) => {
        const box = hull(edge);
        return {left:Math.min(extent.left,box.left),right:Math.max(extent.right,box.right),
          top:Math.min(extent.top,box.top),bottom:Math.max(extent.bottom,box.bottom)};
      }, {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
      return { owner, depths, extent, inside: paintClassifier(edges, charge, openInk), refs: rings.map(r => r.map(edge => intern(edge,owner))) };
    });
    for (const owner of sources) if (separateInk && isEditableInk(owner)) {
      const edges = authoredEdges(owner, owner.x, owner.y, true, openInk);
      if (!edges) return;
      outlineRefs.set(owner, edges.map(edge => intern(edge,owner)));
    }
    const lookup = boundsIndex(pool.map(({ edge }) => hull(edge)));
    const closedPaint = mode === 'paint' || mode === 'union';
    const supports = new Map<Edge,Edge>();
    const support = (edge: Edge) => {
      if (!closedPaint || !edge.cubic) return edge;
      let value = supports.get(edge);
      if (!value) { value = straightSupport(edge); supports.set(edge, value); }
      return value;
    };
    const contactRings = closedPaint ? upperRings.map(ring => ring.flatMap(edge =>
      support(edge).cubic ? matchPaintSubarcs(edge, lookup(hull(edge)).map(i => pool[i]), charge) : [edge])) : upperRings;
    const parts = upperRings.map((): Edge[] => []);
    const refinedInk: Point[][] = [];
    const contactsFor = (edge: Edge) => {
      const contacts: BoundaryContact[] = [];
      for (const index of lookup(hull(edge))) {
        charge(1);
        const lower = pool[index];
        const a = support(edge), b = support(lower.edge);
        const identical = closedPaint && a.cubic && b.cubic &&
          (directionKey(edge) === directionKey(lower.edge) || directionKey(edge) === directionKey(reverse(lower.edge)));
        const straight = straightContacts(a, b);
        const midpoint = openInk && !layers.length && !a.cubic && !straight ? axisMidpointContact(a, b, charge) : undefined;
        const hits = straight ?? midpoint ?? (identical ? [] : undefined) ??
          (mode !== 'selection' ? commonEnd(edge,lower.edge,charge,budget) : undefined) ??
          transverseCubicContacts(edge.curve, lower.edge.curve, budget);
        if (!hits) return;
        for (const { t, u, point } of hits) {
          contacts.push({lower,point,exactPoint: !a.cubic && !b.cubic || !!midpoint,
            t:t>0 && t<1 ? cutParameter(edge,a,t,point,!!straight,charge) : t,
            u:u>0 && u<1 ? cutParameter(lower.edge,b,u,point,!!straight,charge) : u});
        }
      }
      if (closedPaint && contacts.length > 1) {
        contacts.sort((a,b) => a.t-b.t);
        let first = contacts[0];
        for (const hit of contacts.slice(1)) {
          if (hit.t - first.t <= parameterMargin && hit.t > 0 && hit.t < 1 && first.t > 0 &&
              sameCrossedBoundary(first, hit, support, charge)) {
            hit.t = first.t;
            hit.point = first.point;
          } else first = hit;
        }
      }
      return contacts;
    };
    for (const [i,ring] of contactRings.entries()) for (const original of ring) {
      const self = selfCuts.get(original) ?? [];
      const hits = contactsFor(original);
      const edges = hits ? [original] : openInk && budget.remaining>0 ?
        divideAtCrossedVertices(original,lookup(hull(original)).map(i=>pool[i]),self,charge) : undefined;
      if (!edges) return;
      for (const edge of edges) {
        const contacts = hits ?? contactsFor(edge);
        if (!contacts) return;
        const cuts = hits ? [...self] : [];
        for (const {t,point} of contacts) if (t>0 && t<1) cuts.push({t,point});
        const straightInk = openInk && !edge.cubic && !self.length;
        const ordinary = partition(edge,cuts.sort((a,b)=>a.t-b.t),!edge.cubic) ??
          (straightInk && !layers.length && contacts.every(c => c.exactPoint) ? partitionAxisInk(edge, cuts, charge) : undefined);
        const coalesced = straightInk && (!layers.length || fillRetry) && ordinary &&
          ordinary.length <= cuts.length && coincidentCubicCuts(contacts);
        if (coalesced && layers.length && fillRetry && !fillRetry.replay)
          fillRetry.candidates.push({ edge, contacts });
        // Reopened pieces can retain two axial crossings even when their
        // normalized parameters round to the same number.
        const precise = straightInk && (!ordinary || coalesced && (!layers.length || fillRetry?.replay))
          ? splitCloseStraightInk(edge, contacts, charge, !!fillRetry?.capture && !fillRetry.requireRefinement) : undefined;
        if (coalesced && fillRetry?.capture && !precise) return;
        const pieces = precise?.pieces ?? ordinary;
        if (!pieces) return;
        if (coalesced && precise) {
          refinedInk.push(precise.points);
          if (fillRetry?.replay) fillRetry.refined = true;
        }
        for (const {lower,u,point} of precise?.contacts ?? contacts) {
          intersections.add(key(point));
          lower.contacted = true;
          if (u>0 && u<1) lower.cuts.push({t:u,point});
        }
        for (const piece of pieces) parts[i].push(piece);
      }
    }
    const part = compound ? parts.flat() : parts[0];
    for (const lower of pool) {
      const pieces = partition(lower.edge, lower.cuts.sort((a, b) => a.t - b.t), !lower.edge.cubic);
      if (!pieces) return;
      lower.pieces = pieces;
    }
    const faces = new Map<Vector, Edge[][][]>();
    let joined: Edge[][] | undefined;
    const orientMaterial = (rings: Edge[][], depths: number[], keep?: Set<Edge>) => rings.flatMap((ring, i) => {
      const edges = keep ? ring.filter(edge => keep.has(edge)) : ring;
      return (ringArea(ring) > 0) === (depths[i] % 2 === 0) ? edges : backwards(edges);
    });
    const mask = openInk ? [] : orientMaterial(parts, upperDepths);
    const boundaryKey = (e: Edge) => directionKey(support(e));
    const maskDirections = new Map(mask.map(e => [boundaryKey(e), e]));
    // A midpoint determines membership after intersection splitting. Index
    // these probes once rather than classifying every finished ink segment
    // against every face in a densely subdivided drawing.
    const previousInk = openInk ? [...new Set([...outlineRefs.values()].flat().map(ref => ref.boundary))]
      .flatMap(boundary => boundary.pieces.map(edge => ({ edge, boundary }))) : [];
    const midpointBounds = (edge: Edge) => {
      const {x,y} = splitCubic(edge.curve,.5)[0][3];
      return {left:x, right:x, top:y, bottom:y};
    };
    const previousProbes = boundsIndex(previousInk.map(({edge}) => midpointBounds(edge)));
    const incomingProbes = boundsIndex(part.map(midpointBounds));
    let maskProbes: ReturnType<typeof boundsIndex> | undefined;
    const probePadding = Number.EPSILON * 64 * upper.reduce((scale,edge)=>edge.curve.reduce((max,p)=>
      Math.max(max,Math.abs(p.x),Math.abs(p.y)),scale),1);
    charge(previousInk.length + part.length);
    for (const layer of layers) {
      const { owner, refs } = layer;
      const boundaries = refs.map(r => r.flatMap(({ boundary, reversed }) =>
        reversed ? backwards(boundary.pieces) : boundary.pieces));
      if (mode === 'selection' || !openInk && boundaries.some(r => r.some(e =>
        maskDirections.has(boundaryKey(e)) || maskDirections.has(boundaryKey(reverse(e)))))) {
        const outline = orientMaterial(boundaries, layer.depths);
        const coincident = new Set<string>();
        const selected: Edge[] = [], remainder: Edge[] = [];
        for (const edge of outline) {
          const direct = boundaryKey(edge), back = boundaryKey(reverse(edge));
          const same = maskDirections.has(direct), opposite = maskDirections.has(back);
          if (same || opposite) coincident.add(same ? direct : back);
          const belongsInside = same || (!opposite && insideUpper(edge));
          if (belongsInside) selected.push(edge);
          else remainder.push(opposite && closedPaint ? reverse(maskDirections.get(back)!) : edge);
        }
        if (!maskProbes) { charge(mask.length); maskProbes = boundsIndex(mask.map(midpointBounds)); }
        for (const i of maskProbes(layer.extent,probePadding).sort((a,b)=>a-b)) {
          const edge = mask[i];
          if (coincident.has(boundaryKey(edge)) || !layer.inside(edge)) continue;
          selected.push(edge);
          remainder.push(reverse(edge));
        }
        const regions = (edges: Edge[]) => {
          const rings = boundaryRings(edges);
          return rings && groupInkRings(rings, charge);
        };
        if (mode !== 'selection') {
          if (!selected.length) continue;
          const outside = regions(remainder);
          if (!outside) return;
          faces.set(owner, outside);
          continue;
        }
        if (!selected.length || !remainder.length) return {
          foreground: cutter, background: new Map<Vector,Vector[]>(), strokes: undefined, upperArtwork: undefined,
          selection: { inside: selected.length ? [owner] : [], outside: remainder.length ? [owner] : [] },
        };
        const inside = regions(selected), outside = regions(remainder);
        if (!inside || !outside) return;
        // Both sides inherit the source style. Give each a separate result
        // slot so the writer reconciles their shared coordinates in one pass.
        const outsideOwner = { ...owner };
        faces.set(owner, inside);
        faces.set(outsideOwner, outside);
        const written = writePaintFaces(cutter, parts[0], faces, { x: 0, y: 0 }, undefined, undefined, parts.slice(1));
        if (written) return { ...written, upperArtwork: undefined, selection: {
          inside: written.background.get(owner)!, outside: written.background.get(outsideOwner)!,
        } };
        return;
      }
      if (openInk) {
        const touched = refs.some(r => r.some(ref => ref.boundary.contacted));
        const oriented = boundaries.map((ring, i) =>
          (ringArea(ring) > 0) === (layer.depths[i] % 2 === 0) ? ring : backwards(ring));
        const boundary = new Set(refs.flat().map(ref => ref.boundary));
        const borderKeys = new Set(oriented.flatMap(r=>r.flatMap(e=>[directionKey(e),directionKey(reverse(e))])));
        const box = oriented.flat().reduce((b,e) => {
          const h = hull(e);
          return {left:Math.min(b.left,h.left),right:Math.max(b.right,h.right),
            top:Math.min(b.top,h.top),bottom:Math.max(b.bottom,h.bottom)};
        }, {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
        const interior = incomingProbes(box).map(i => part[i]).filter(e=>!borderKeys.has(directionKey(e)) && layer.inside(e));
        if (!interior.length && !touched) continue;
        for (const i of previousProbes(box)) {
          const ref = previousInk[i];
          if (!boundary.has(ref.boundary) && layer.inside(ref.edge)) interior.push(ref.edge);
        }
        const walks = walkInkRings(oriented,interior,charge);
        const regions = walks && groupInkRings(walks,charge);
        if (!regions) return;
        if (!touched && regions.length === layer.depths.filter(depth => depth % 2 === 0).length) continue;
        faces.set(owner, regions);
        continue;
      }
      const original = boundaries.flat();
      const remaining = original.filter(e => !insideUpper(e));
      const seam = incomingProbes(layer.extent,probePadding).sort((a,b)=>a-b).map(i=>part[i]).filter(layer.inside);
      if (!seam.length && remaining.length === original.length) continue;
      if (mode === 'union' && layers.length === 1 && !border) {
        // Follow only exterior edges, oriented with filled material on the
        // same side. Interior seams of the same color never become objects.
        const hidden = new Set(seam);
        const exterior = boundaryRings([...orientMaterial(boundaries, layer.depths, new Set(remaining)),
          ...orientMaterial(parts, upperDepths, new Set(part.filter(e => !hidden.has(e))))]);
        const regions = exterior && groupInkRings(exterior, charge);
        if (regions?.length === 1) {
          joined = regions[0];
          faces.set(owner, []);
          continue;
        }
      }
      const rings = boundaryRings([...remaining, ...seam]);
      if (!rings && refs.length > 1) {
        // A certified compound face can have a hole touching its exterior
        // at an authored vertex. Keep the material on one side of each edge
        // so the face walk can distinguish the branches at that junction.
        const exterior = orientMaterial(boundaries, layer.depths, new Set(remaining));
        const interior = backwards(orientMaterial(parts, upperDepths, new Set(seam)));
        const walks = walkInkRings([exterior, interior], [], charge);
        const regions = walks && walks.reduce((count, ring) => count + ring.length, 0) === exterior.length + interior.length
          ? groupInkRings(walks, charge) : undefined;
        if (regions?.length) { faces.set(owner, regions); continue; }
      }
      if (!rings) return;
      if (!rings.length) { faces.set(owner, []); continue; }
      if (!compound && refs.length === 1 && refs[0].some(ref => ref.boundary.cuts.length)) {
        // Two certified simple contours with transverse intersections can
        // leave only exterior loops, as in the single-face crossing path.
        const shared = new Set(seam);
        faces.set(owner, rings.map(r => [r.some(e => shared.has(e)) ? backwards(r) : r]));
        continue;
      }
      // Preserve holes with their owning face while keeping disjoint pieces
      // independently selectable. Samples classify topology only.
      const paths = worldPaths({ ...owner, x: 0, y: 0, rotation: 0, transform: undefined, kind: 'polygon', contours: rings.map(r => nodes(r)) }, OVERLAY_CURVE_TOLERANCE);
      charge(paths.reduce((n, r) => n + r.length, 0));
      const { parents, depths } = certifyPaintRings(paths, rings, charge);
      const winding = (r: Point[]) => Math.sign(r.reduce((sum, a, i) => {
        const b = r[(i + 1) % r.length];
        return sum + (a.x - r[0].x) * (b.y - r[0].y) - (a.y - r[0].y) * (b.x - r[0].x);
      }, 0));
      const direction = winding(upperSamples[0]);
      const groups = new Map<number, Edge[][]>();
      const oriented = rings.map((r, i) => winding(paths[i]) === (depths[i] % 2 ? -direction : direction) ? r : backwards(r));
      oriented.forEach((r, i) => { if (!(depths[i] % 2)) groups.set(i, [r]); });
      oriented.forEach((r, i) => { if (depths[i] % 2) groups.get(parents[i])!.push(r); });
      faces.set(owner, [...groups.values()]);
    }
    if (mode === 'paint' && inkPolicy && !border && !coverInk && outlineRefs.size) {
      const oriented = parts.map((ring,i) =>
        (ringArea(ring) > 0) === (upperDepths[i] % 2 === 0) ? ring : backwards(ring));
      const interior: Edge[] = [], outlines = new Map<Vector,Edge[][]>();
      for (const [owner,refs] of outlineRefs) {
        const edges = refs.flatMap(({boundary,reversed}) => reversed ? backwards(boundary.pieces) : boundary.pieces);
        for (const edge of edges) {
          const boundary = maskDirections.has(boundaryKey(edge)) || maskDirections.has(boundaryKey(reverse(edge)));
          if (!boundary && insideUpper(edge)) interior.push(edge);
        }
        if (refs.some(ref => ref.boundary.contacted)) outlines.set(owner,inkIntervals(edges,intersections,!!owner.closed));
      }
      const walks = walkInkRings(oriented,interior,charge);
      const regions = walks && groupInkRings(walks,charge);
      if (!regions?.length) return;
      const [first,...rest] = regions;
      faces.set(cutter,rest);
      const written = writePaintFaces(cutter,first[0],faces,{x:0,y:0},undefined,outlines,first.slice(1),undefined,undefined,placement);
      if (written) return {...written,upperArtwork:[written.foreground,...written.background.get(cutter)!]};
      return;
    }
    if (openInk && !faces.size && !intersections.size) {
      if (fillRetry?.capture && !fillRetry.requireRefinement) fillRetry.capture([part], faces, new Map());
      return { foreground:cutter, background:new Map<Vector,Vector[]>(), strokes:[cutter], upperArtwork:undefined };
    }
    if (faces.size || openInk && intersections.size || coverInk && outlineRefs.size || border && intersections.size) {
      const outlines = new Map<Vector, Edge[][]>();
      const coveredEdges = new Set<string>();
      const strokes = openInk ? uniqueInkSpans(inkIntervals(part,intersections,false),coveredEdges) : undefined;
      if (inkPolicy?.rejectCoincidentInk && strokes &&
          strokes.reduce((n, span) => n + span.length, 0) !== part.length) return;
      const covered: Vector[] = [];
      const foregroundRegions = [joined?.[0] ?? parts[0]];
      for (const [owner, refs] of outlineRefs) {
        const contacted = refs.some(ref => ref.boundary.contacted);
        if (!contacted && (!inkPolicy || inkPolicy.rejectCoincidentInk)) continue;
        const edges = refs.flatMap(({ boundary, reversed }) => reversed ? backwards(boundary.pieces) : boundary.pieces);
        const spans = inkIntervals(edges, intersections, !!owner.closed);
        if (coverInk) {
          // Keep the original centerline up to the very same crossing used
          // by the painted boundary. Ink visible through a hole survives.
          const visible = spans.filter(span => !insideUpper(span[0]));
          if (contacted || visible.length !== spans.length) outlines.set(owner, visible);
          continue;
        }
        if (!border) {
          // New ink owns a coincident interval. Adjacent old strokes keep
          // their original style and stacking order everywhere else.
          if (inkPolicy?.rejectCoincidentInk && edges.some(edge => coveredEdges.has(directionKey(edge)))) return;
          outlines.set(owner,openInk ? spans.filter(span=>!coveredEdges.has(directionKey(span[0]))) : spans);
          continue;
        }
        const outside: Edge[][] = [], kept: Edge[][] = [];
        for (const span of spans) {
          if (!insideUpper(span[0])) { outside.push(span); continue; }
          if (inkPolicy?.removeCoveredInk) continue;
          const a = key(span[0].curve[0]), b = key(span[span.length-1].curve[3]);
          if (a === b) return;
          kept.push(span);
          let divided = false;
          for (const [index, ring] of foregroundRegions.entries()) {
            charge(ring.length);
            const from = ring.findIndex(e => key(e.curve[0]) === a), to = ring.findIndex(e => key(e.curve[0]) === b);
            if (from < 0 || to < 0) continue;
            foregroundRegions.splice(index, 1, ...cutRingAtArc(ring, from, to, span));
            divided = true;
            break;
          }
          if (!divided && intersections.has(a) && intersections.has(b)) return;
        }
        if (!contacted && outside.length === spans.length) continue;
        outlines.set(owner, outside);
        if (kept.length) {
          const above = { ...owner };
          covered.push(above);
          outlines.set(above, kept);
        }
      }
      if (border) {
        if (!intersections.size) return;
        outlines.set(border, inkIntervals(part, intersections, true));
        faces.set(cutter, foregroundRegions.slice(1).map(ring=>[ring]));
      }
      if (!openInk && !faces.size && !outlines.size && !independent) return;
      if (fillRetry?.requireRefinement && !refinedInk.length) return;
      const written = writePaintFaces(cutter, foregroundRegions[0], faces, { x: 0, y: 0 },
        strokes, outlines, (joined ?? parts).slice(1), refinedInk, fillRetry?.capture);
      if (written) return { ...written, upperArtwork: border ? [written.foreground,
        ...(written.background.get(cutter) ?? []), ...covered.flatMap(s => written.background.get(s) ?? []),
        ...(written.background.get(border) ?? [])] : undefined };
      return;
    }
    if (independent) return {foreground:cutter,background:new Map<Vector,Vector[]>(),strokes:undefined,upperArtwork:undefined};
  } catch {
    // Only complete, certified faces can replace the artwork.
    return;
  }
}

/** A closed overpaint can subtract its authored outline from each owner in
 * place. Contacts from other owners need not split that owner's cutter. */
export function prepareIndependentPaintCuts(sources: Vector[], cutter: Vector, removeCoveredInk: boolean,
  bounds: (owner: Vector) => Bounds) {
  try {
    const charge = (n: number) => { if ((work.remaining -= n) < 0) throw Error('Shared paint partition budget reached'); };
    const rings = readPaintRings(cutter), samples = worldPaths(cutter,OVERLAY_CURVE_TOLERANCE), edges = rings.flat();
    const work: IndependentPaintWork = { remaining: workLimit, upper: { rings,samples,depths:[],inside:paintClassifier(edges,charge) } };
    work.upper.depths = certifyPaintRings(samples,rings,charge).depths;
    const lookup = boundsIndex(edges.map(hull));
    const background = new Map<Vector, Vector[]>();
    const boundaryInk: Vector[] = [];
    for (const owner of sources) {
      charge(1);
      const ink = isEditableInk(owner);
      if (ink && !removeCoveredInk) continue;
      const box = bounds(owner);
      if (!lookup(box).length) {
        const p = { x: box.left/2+box.right/2, y: box.top/2+box.bottom/2 };
        if (work.upper.inside(line(p,p))) background.set(owner,[]);
        continue;
      }
      if (ink) { boundaryInk.push(owner); continue; }
      const cut = cutPaintStack([owner],cutter,'paint',undefined,work);
      if (!cut) return;
      const pieces = cut.background.get(owner);
      if (pieces) background.set(owner,pieces);
    }
    if (boundaryInk.length) {
      const inkWork: IndependentPaintWork = { remaining: workLimit, upper: { ...work.upper,
        inside: paintClassifier(edges,n => {
          if ((inkWork.remaining -= n) < 0) throw Error('Shared paint partition budget reached');
        }) } };
      const cut = cutPaintStack(boundaryInk,cutter,'paint',{removeCoveredInk:true},inkWork);
      if (!cut) return;
      for (const [owner,pieces] of cut.background) background.set(owner,pieces);
    }
    return background;
  } catch {
    return;
  }
}
