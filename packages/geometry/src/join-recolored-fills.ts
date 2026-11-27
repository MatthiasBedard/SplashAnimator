import { clone, MAX_VECTOR_POINTS, type BezierNode, type Point, type Vector } from '@splash/document';
import type { MultiPolygon } from 'polygon-clipping';
import { inversePoint, mapPoint, matrix } from './affine';
import { boundsIndex, overlaps, type Bounds } from './bounds-index';
import { canJoinOverlayFills } from './clip-paint';
import { OVERLAY_CURVE_TOLERANCE } from './clip-fill-curves';
import { splitCubic, type Cubic } from './curve-fit';
import { flattenCommands, pathCommands, normalizeVector } from './drawing';
import { mayIntersectPaint, mergeControlBounds, strokeControlPadding, vectorPolygons } from './merge';
import clipping from './paint-clipping';
import { prepareOverlappingPaintUnion } from './shared-paint-cut';
import { isEditableInk } from './stroke-cut';

import { certifyEdgeInteriors, hull, paintClassifier } from './paint-boundary';

type Edge = { a: Point; b: Point; out?: Point; in?: Point };
const pointKey = (p: Point) => `${p.x},${p.y}`;
const edgeKey = (e: Edge) => [e.a, e.out, e.in, e.b].map(p => p ? pointKey(p) : '').join(':');
const reversed = (e: Edge): Edge => ({ a: e.b, b: e.a, out: e.in, in: e.out });
const bounds = (a: Point, b: Point): Bounds => ({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
  top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });

function outline(shape: Vector, tick: () => void) {
  const m = matrix(shape), edges: Edge[] = [];
  let current: Point | undefined, first: Point | undefined;
  const point = (x: number, y: number) => mapPoint(m, { x, y });
  for (const command of pathCommands(shape)) {
    tick();
    if (command[0] === 'M') current = first = point(command[1], command[2]);
    else if (current && first) {
      const b = command[0] === 'Z' ? first : command[0] === 'C' ? point(command[5], command[6]) : point(command[1], command[2]);
      const e: Edge = { a: current, b };
      if (command[0] === 'C') {
        const out = point(command[1], command[2]), incoming = point(command[3], command[4]);
        if (pointKey(out) !== pointKey(current) || pointKey(incoming) !== pointKey(b)) {
          e.out = out;
          e.in = incoming;
        }
      }
      if (pointKey(current) !== pointKey(b) || e.out) edges.push(e);
      current = b;
    }
  }
  return edges;
}

const alwaysBlocksFillPlacement = (shape: Vector) =>
  shape.kind === 'symbol' || shape.kind === 'text' || shape.blurRadius ||
  shape.groupBlur || shape.blendMode;

/** A surrounding outline's overall bounds cover its interior. Use the
 * individual padded control hulls to prove that no part of its stroke crosses
 * the footprint of a fill changing stack slots. */
function blocksFillPlacement(shape: Vector, moving: Vector, footprint: Bounds, disjoint: DisjointPaint, tick: () => void) {
  if (alwaysBlocksFillPlacement(shape)) return true;
  if (!overlaps(footprint, mergeControlBounds(shape), 0)) return false;
  if (shape.fillEnabled !== false || !shape.strokeWidth || shape.kind === 'brush')
    return !disjoint(shape, moving);
  const edges = outline(shape, tick), padding = strokeControlPadding(shape);
  return !edges.length || !Number.isFinite(padding) || edges.some(edge => {
    tick();
    const points = cubic(edge);
    return overlaps(footprint, {
      left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
    }, padding);
  });
}

/** Partition only straight seams at existing endpoints. Cubic controls and
 * exterior anchors always come from the original outlines. */
function partition(edges: Edge[], other: Edge[], tick: () => void) {
  const points = other.map(e => e.a);
  const lookup = boundsIndex(points.map(p => bounds(p, p)));
  return edges.flatMap(e => {
    tick();
    if (e.out || e.in) return [e];
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const progress = (p: Point) => (p[axis] - e.a[axis]) / (e.b[axis] - e.a[axis]);
    const cuts = new Map<number, Point>([[0, e.a], [1, e.b]]);
    for (const i of lookup(bounds(e.a, e.b))) {
      tick();
      const p = points[i], t = progress(p);
      if (t > 0 && t < 1 && (p.x - e.a.x) * dy === (p.y - e.a.y) * dx) cuts.set(t, p);
    }
    const ordered = [...cuts.keys()].sort((a, b) => a - b);
    return ordered.slice(1).map((t, i) => ({ a: cuts.get(ordered[i])!, b: cuts.get(t)! }));
  });
}

const cubic = (edge: Edge): Cubic => [edge.a, edge.out ?? edge.a, edge.in ?? edge.b, edge.b];
const curveEdge = ([a, out, incoming, b]: Cubic): Edge => ({ a, out, in: incoming, b });

type DisjointPaint = (a: Vector, b: Vector) => boolean;
type OverlayJoin = { incoming: string; footprint: Bounds; budget: { remaining: number } };

// Reordering two solid faces changes pixels only where their interiors overlap.
// Cut pieces commonly have overlapping boxes and even share whole boundary
// arcs. Prove that each remaining open edge stays outside the opposite face.
export function paintSeparation(tick: () => void): DisjointPaint {
  function boundary(shape: Vector) {
    const edges = outline(shape,tick).map(e => ({curve:cubic(e), cubic:!!(e.in || e.out)}));
    const boxes = edges.map(hull);
    return { edges, boxes, lookup:boundsIndex(boxes), inside:paintClassifier(edges,tick) };
  }
  const cache = new WeakMap<Vector,ReturnType<typeof boundary>>();
  const get = (s: Vector) => {
    let value=cache.get(s);
    if (!value) { value=boundary(s); cache.set(s,value); }
    return value;
  };
  const ordinary = (s:Vector) => s.kind==='polygon' && s.fillRule==='evenodd' &&
    canJoinOverlayFills(s,s) && !!s.contours?.length;
  return (a,b) => {
    if (!ordinary(a) || !ordinary(b)) return false;
    try {
      const first=get(a), second=get(b);
      const sharedLeft = new Set<number>(), sharedRight = new Set<number>();
      for (const [i,{curve:left}] of first.edges.entries()) {
        for (const j of second.lookup(first.boxes[i])) {
          tick();
          const right=second.edges[j].curve;
          const same = (a:Point,b:Point)=>a.x===b.x && a.y===b.y;
          if (left.every((p,k)=>same(p,right[k])) || left.every((p,k)=>same(p,right[3-k]))) {
            sharedLeft.add(i);
            sharedRight.add(j);
            continue;
          }
          // Distinct sides may meet at their ends. Exclude only that
          // known join; curves that cross again fail the same proof.
          certifyEdgeInteriors(left,right,tick);
        }
      }
      // Outside witnesses cannot distinguish the interior of a complete
      // coincident cycle, including a lobe in a self-touching contour.
      const links = new Map<string,string>();
      const root = (point: Point) => {
        const start=pointKey(point);
        let value=start;
        while (links.has(value)) {tick(); value=links.get(value)!;}
        if (value!==start) links.set(start,value);
        return value;
      };
      for (const i of sharedLeft) {
        const curve=first.edges[i].curve;
        const start=root(curve[0]), end=root(curve[3]);
        if (start===end) return false;
        links.set(start,end);
      }
      return first.edges.every((e,i)=>sharedLeft.has(i) || !second.inside(e)) &&
        second.edges.every((e,i)=>sharedRight.has(i) || !first.inside(e));
    } catch {
      return false;
    }
  };
}

/** Clipping can leave one side with just the first portion of the original
 * cubic. Check all subdivided controls and use the saved shorter interval as
 * the shared edge. Nearness alone never admits a seam. */
function partitionCubicSeams(edges: Edge[], other: Edge[], tick: () => void) {
  const byStart = new Map<string, Edge[]>();
  for (const edge of other) {
    tick();
    if (!edge.out && !edge.in) continue;
    for (const direction of [edge, reversed(edge)]) {
      const key = pointKey(direction.a), entries = byStart.get(key);
      if (entries) entries.push(direction);
      else byStart.set(key, [direction]);
    }
  }
  return edges.flatMap(edge => {
    tick();
    if (!edge.out && !edge.in) return [edge];
    const prefix = (source: Edge) => {
      const controls = cubic(source);
      const dx = controls[1].x - source.a.x, dy = controls[1].y - source.a.y;
      const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      let best: { time: number; edge: Edge } | undefined;
      if (dx || dy) for (const candidate of byStart.get(pointKey(source.a)) ?? []) {
        tick();
        const comparison = cubic(candidate);
        const time = (comparison[1][axis] - source.a[axis]) / (controls[1][axis] - source.a[axis]);
        if (!(time > 0 && time < 1) || (best && time <= best.time)) continue;
        const [part] = splitCubic(controls, time);
        const scale = Math.max(1, ...controls.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
        const error = Math.min(1e-8, scale * Number.EPSILON * 64);
        if (part.every((p, i) => Math.hypot(p.x - comparison[i].x, p.y - comparison[i].y) <= error))
          best = { time, edge: candidate };
      }
      return best;
    };
    const start = prefix(edge), end = prefix(reversed(edge));
    if (!start && !end) return [edge];
    const low = start?.time ?? 0, high = end ? 1 - end.time : 1;
    if (!(low < high)) return [edge];
    let controls = cubic(edge);
    if (end) controls = splitCubic(controls, high)[0];
    if (start) controls = splitCubic(controls, low / high)[1];
    const middle = curveEdge(controls);
    if (start) middle.a = start.edge.b;
    if (end) middle.b = end.edge.b;
    return [...(start ? [start.edge] : []), middle, ...(end ? [reversed(end.edge)] : [])];
  });
}

function contourRings(edges: Iterable<Edge>, local: (p: Point) => Point, tick: () => void) {
  const byStart = new Map<string, Edge>();
  for (const edge of edges) {
    const key = pointKey(edge.a);
    if (byStart.has(key)) return;
    byStart.set(key, edge);
  }
  const rings: BezierNode[][] = [];
  while (byStart.size) {
    const start = byStart.values().next().value!;
    const ring: BezierNode[] = [];
    let edge: Edge | undefined = start, incoming: Point | undefined;
    do {
      tick();
      const node = local(edge.a) as BezierNode;
      if (incoming) node.in = local(incoming);
      if (edge.out) node.out = local(edge.out);
      ring.push(node);
      incoming = edge.in;
      byStart.delete(pointKey(edge.a));
      if (pointKey(edge.b) === pointKey(start.a)) break;
      edge = byStart.get(pointKey(edge.b));
    } while (edge);
    if (!edge || ring.length < 3) return;
    if (incoming) ring[0].in = local(incoming);
    rings.push(ring);
  }
  return rings;
}

/** A hole can touch the exterior at a vertex after the intervening face
 * joins its neighbor. Preserve each directed boundary exactly once. */
function joinedRings(exterior: Edge[], tick: () => void) {
  const minimum = { x: Infinity, y: Infinity }, maximum = { x: -Infinity, y: -Infinity };
  const copy = (p: Point) => {
    minimum.x = Math.min(minimum.x, p.x); maximum.x = Math.max(maximum.x, p.x);
    minimum.y = Math.min(minimum.y, p.y); maximum.y = Math.max(maximum.y, p.y);
    return { ...p };
  };
  const direct = contourRings(exterior,copy,tick);
  if (direct) return { rings: direct, minimum, maximum };
  const outgoing = new Map<string,Edge[]>();
  for (const edge of exterior) {
    const key = pointKey(edge.a), list = outgoing.get(key);
    if (list) list.push(edge);
    else outgoing.set(key,[edge]);
  }
  const rings: BezierNode[][] = [];
  while (outgoing.size) {
    let cursor = outgoing.keys().next().value!;
    const path: Edge[] = [], positions = new Map<string,number>();
    while (outgoing.has(cursor)) {
      tick();
      const list = outgoing.get(cursor)!, edge = list.pop()!;
      if (!list.length) outgoing.delete(cursor);
      positions.set(cursor,path.length);
      path.push(edge);
      cursor = pointKey(edge.b);
      const at = positions.get(cursor);
      if (at === undefined) continue;
      const loop = path.splice(at);
      const ring = contourRings(loop,copy,tick);
      if (ring?.length!==1) return;
      rings.push(ring[0]);
      for (const side of loop) positions.delete(pointKey(side.a));
    }
    if (path.length) return;
  }
  return { rings, minimum, maximum };
}

/** Faces from successive cuts can store a shared anchor one rounding step
 * apart in their respective authoring boxes. Require the two reversed cubic
 * handles and the other endpoint to match exactly before stitching the join. */
function cancelRebasedSeams(edges: Edge[], owner: (e: Edge) => Vector, tick: () => void,
  candidatesToRebase: Iterable<Edge> = edges): Edge[] {
  const candidates = new Map<string, Edge[]>(), replacements = new Map<string, Point>();
  const cancelled = new Set<Edge>(), destinations = new Set<string>();
  const roundTrip = (a: number, b: number) =>
    Math.abs(a-b) <= Math.min(1e-10, Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON);
  const key = (p: Point,q: Point) => pointKey(p)+':'+pointKey(q);
  for (const edge of candidatesToRebase) {
    tick();
    if (!edge.in || !edge.out) continue;
    for (const opposite of candidates.get(key(edge.in,edge.out)) ?? []) {
      tick();
      if (cancelled.has(opposite)) continue;
      const first = owner(edge), second = owner(opposite);
      if (first===second || first.transform || second.transform || first.rotation || second.rotation ||
          (first.x===second.x && first.y===second.y)) continue;
      const start = pointKey(edge.a)===pointKey(opposite.b), end = pointKey(edge.b)===pointKey(opposite.a);
      if (!start && !end) continue;
      const from = start ? edge.b : edge.a, to = start ? opposite.a : opposite.b;
      if (!roundTrip(from.x,to.x) || !roundTrip(from.y,to.y) ||
          (from.x!==to.x && first.x===second.x) || (from.y!==to.y && first.y===second.y)) continue;
      if (!start || !end) {
        const source = pointKey(from), target = pointKey(to), prior = replacements.get(source);
        if ((prior && pointKey(prior)!==target) || replacements.has(target) || destinations.has(source)) continue;
        replacements.set(source,to);
        destinations.add(target);
      }
      cancelled.add(opposite);
      cancelled.add(edge);
      break;
    }
    const direction = key(edge.out,edge.in), bucket = candidates.get(direction);
    if (bucket) bucket.push(edge);
    else candidates.set(direction,[edge]);
  }
  if (!cancelled.size) return edges;
  return edges.filter(e=>!cancelled.has(e)).map(edge=>({...edge,
    a:replacements.get(pointKey(edge.a)) ?? edge.a, b:replacements.get(pointKey(edge.b)) ?? edge.b}));
}

/** The sweep can produce a zero-area polygon from a collinear exterior edge.
 * Measure from its own origin and allow only coordinate-roundoff area. */
function hasArea(polygon: MultiPolygon[number], tick: () => void) {
  const ring = polygon[0], [x, y] = ring[0];
  let area = 0, extent = 0, scale = 1;
  for (let i = 1; i < ring.length; i++) {
    tick();
    const [a, b] = ring[i - 1], [c, d] = ring[i];
    area += (a - x) * (d - y) - (c - x) * (b - y);
    extent += Math.abs(c - a) + Math.abs(d - b);
    scale = Math.max(scale, Math.abs(c), Math.abs(d));
  }
  return !Number.isFinite(area + extent) || Math.abs(area) > extent * Math.min(1e-8, scale * Number.EPSILON * 64);
}

function distanceToPath(point: Point, path: Point[], tick: () => void) {
  let distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    tick();
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return distance;
}

function seamExits(seamPoints: Set<string>, edges: Edge[]) {
  const incoming = new Map<string, Edge>();
  for (const edge of edges) if (seamPoints.has(pointKey(edge.b))) incoming.set(pointKey(edge.b), edge);
  return edges.flatMap(edge => {
    const previous = incoming.get(pointKey(edge.a));
    return previous ? [{ point: edge.a, edges: [previous, edge] }] : [];
  });
}

/** A strictly convex straight quadrilateral contains the entire other path
 * when it contains every anchor and control. Keep its original geometry. */
function strictlyContains(outer: Edge[], inner: Edge[], tick: () => void) {
  if (outer.length !== 4 || inner.length < 3 ||
      outer.some((edge, i) => edge.out || edge.in || pointKey(edge.b) !== pointKey(outer[(i + 1) % 4].a))) return false;
  const signedDistance = (edge: Edge, p: Point) => {
    tick();
    const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y;
    const cross = dx * (p.y - edge.a.y) - dy * (p.x - edge.a.x);
    const scale = Math.max(1, Math.abs(edge.a.x), Math.abs(edge.a.y), Math.abs(edge.b.x), Math.abs(edge.b.y),
      Math.abs(p.x), Math.abs(p.y));
    const error = scale * (Math.abs(dx) + Math.abs(dy) + Math.abs(p.x - edge.a.x) +
      Math.abs(p.y - edge.a.y)) * Number.EPSILON * 32;
    return Number.isFinite(cross) && Math.abs(cross) > error ? Math.sign(cross) : 0;
  };
  const side = signedDistance(outer[0], outer[1].b);
  return side !== 0 && outer.every((edge, i) => signedDistance(edge, outer[(i + 1) % 4].b) === side &&
    inner.every(part => [part.a, part.out, part.in, part.b].every(p => !p || signedDistance(edge, p) === side)));
}

function rectangularBounds(edges: Edge[]) {
  if (edges.length !== 4 || edges.some((edge, i) => edge.in || edge.out ||
      ((edge.a.x === edge.b.x) === (edge.a.y === edge.b.y)) ||
      pointKey(edge.b) !== pointKey(edges[(i + 1) % 4].a))) return;
  const corners = edges.map(edge => edge.a);
  const box = bounds(corners[0], corners[2]);
  if (box.left >= box.right || box.top >= box.bottom || new Set(corners.map(pointKey)).size !== 4 ||
      !corners.every(p => (p.x === box.left || p.x === box.right) && (p.y === box.top || p.y === box.bottom))) return;
  return box;
}

/** A resize and a subsequent cut may store the same corner through different
 * affine bases. Admit only a complete rectangular hole and roundoff-sized
 * differences on all four sides. Keep the exact original outer contour. */
function joinRectangularInset(surround: Vector, inset: Edge[], tick: () => void): Vector | undefined {
  if (surround.fillRule !== 'evenodd' || surround.contours?.length !== 2 ||
      surround.contours.some(ring => ring.length !== 4)) return;
  const fitted = rectangularBounds(inset);
  if (!fitted) return;
  const rings = surround.contours.map(ring => rectangularBounds(outline({ ...surround, contours: [ring] }, tick)));
  const same = (a: number, b: number) => Number.isFinite(a + b) &&
    Math.abs(a - b) <= Math.min(1e-8, Math.max(1, Math.abs(a), Math.abs(b)) * Number.EPSILON * 8);
  for (const [index, box] of rings.entries()) {
    const hole = rings[1 - index];
    if (box && hole && box.left < hole.left && hole.right < box.right &&
        box.top < hole.top && hole.bottom < box.bottom &&
        same(hole.left, fitted.left) && same(hole.right, fitted.right) &&
        same(hole.top, fitted.top) && same(hole.bottom, fitted.bottom))
      return { ...surround, contours: [clone(surround.contours[index])] };
  }
}

type SeamAdmission = (edges: Edge[]) => boolean;

/** Saved centerlines and faces may split the same straight divider at different vertices. */
function inkCoverage(shapes: Vector[], nearby: (box: Bounds) => number[], tick: () => void) {
  const groups = new Map<string, { exact: Set<string>; lines: Edge[]; index?: ReturnType<typeof boundsIndex> }>();
  for (const shape of shapes) {
    if (!isEditableInk(shape) || shape.drawingMode === 'object' || !nearby(mergeControlBounds(shape)).length) continue;
    const group = JSON.stringify(shape.groups ?? []);
    const ink = groups.get(group) ?? { exact: new Set<string>(), lines: [] as Edge[] };
    for (const edge of outline(shape, tick)) {
      ink.exact.add(edgeKey(edge));
      ink.exact.add(edgeKey(reversed(edge)));
      if (!edge.in && !edge.out) ink.lines.push(edge);
    }
    groups.set(group, ink);
  }
  return (group: string, edge: Edge) => {
    const ink = groups.get(group);
    if (!ink) return false;
    if (ink.exact.has(edgeKey(edge))) return true;
    if (edge.in || edge.out || !ink.lines.length) return false;
    ink.index ??= boundsIndex(ink.lines.map(e => bounds(e.a, e.b)));
    const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y;
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const onLine = (p: Point) => (p.x-edge.a.x)*dy === (p.y-edge.a.y)*dx;
    const intervals: [number,number][] = [];
    for (const i of ink.index(bounds(edge.a,edge.b))) {
      tick();
      const {a,b} = ink.lines[i];
      if (onLine(a) && onLine(b)) intervals.push([Math.min(a[axis],b[axis]),Math.max(a[axis],b[axis])]);
    }
    let covered = Math.min(edge.a[axis],edge.b[axis]);
    const end = Math.max(edge.a[axis],edge.b[axis]);
    for (const [low,high] of intervals.sort((a,b)=>a[0]-b[0])) {
      if (low > covered) break;
      covered = Math.max(covered,high);
      if (covered >= end) return true;
    }
    return false;
  };
}

function joinPair(a: Vector, b: Vector, tick: () => void, allowContainment: boolean, boundaries: WeakMap<Vector,Edge[]>, admits: SeamAdmission) {
  const first = boundaries.get(a) ?? outline(a, tick), second = boundaries.get(b) ?? outline(b, tick);
  if (allowContainment) {
    const nested = joinRectangularInset(a, second, tick) ?? joinRectangularInset(b, first, tick);
    if (nested) return { shape: { ...nested, id: a.id } };
  }
  const exact = joinPartition(a, b, first, second, false, tick, boundaries, admits);
  if (exact) return { shape: exact };
  if (allowContainment) {
    if (strictlyContains(first, second, tick)) return { shape: a, contained: b.id };
    if (strictlyContains(second, first, tick)) return { shape: { ...b, id: a.id }, contained: a.id };
  }
  const leftSplit = partitionCubicSeams(first, second, tick), rightSplit = partitionCubicSeams(second, first, tick);
  const shape = joinPartition(a, b, leftSplit, rightSplit, true, tick, boundaries, admits);
  if (shape) return { shape };
}

/** Re-express the untouched exterior directly in its final authoring box.
 * Subtracting the seed origin and then normalizing again rounds a shared
 * control twice and can separate it from the Pencil that owns the seam. */
function normalizedJoin(seed: Vector, outline: NonNullable<ReturnType<typeof joinedRings>>, tick: () => void): Vector {
  const { rings: worldRings, minimum, maximum } = outline;
  const basis = matrix(seed);
  const translated = !seed.transform && !seed.rotation;
  const origin = {x:seed.x,y:seed.y}, size = {width:seed.width,height:seed.height};
  if (translated) {
    const points = worldRings.flatMap(r=>r.flatMap(n=>[n,...(n.in?[n.in]:[]),...(n.out?[n.out]:[])]));
    for (const axis of ['x','y'] as const) {
      const lo = minimum[axis], hi = maximum[axis];
      const unit=2**(Math.ceil(Math.log2(Math.max(Math.abs(lo),Math.abs(hi),hi-lo))) - 52);
      const candidates=[lo];
      if (unit>0 && Number.isFinite(unit)) candidates.push(Math.floor(lo/unit)*unit);
      // When a nonnegative origin aligns to the widest spacing in its range,
      // subtracting it is exact. Every coordinate and the origin are multiples
      // of that coordinate's spacing, and the local magnitude only decreases.
      origin[axis]=candidates.find(base=>base === 0 ||
        (base > 0 && Number.isFinite(unit) && unit > 0 && base % unit === 0) ||
        points.every(p=>{ tick(); return base+(p[axis]-base)===p[axis]; })) ?? lo;
      size[axis==='x'?'width':'height']=hi-origin[axis];
    }
  }
  const local = (p: Point) => translated ? {x:p.x-origin.x,y:p.y-origin.y} : inversePoint(basis,p);
  const contours=worldRings.map(ring=>ring.map(n=>({...local(n),
    ...(n.in && {in:local(n.in)}),...(n.out && {out:local(n.out)})})));
  const shape: Vector={...seed,...origin,...size,kind:'polygon',points:[],nodes:undefined,contours,
    closed:true,fillRule:'evenodd',cornerRadius:undefined,drawingMode:'merge',
    pivot:seed.pivot && (translated ? local(mapPoint(basis,seed.pivot)) : {...seed.pivot})};
  if (!translated) normalizeVector(shape);
  return shape;
}

function joinPartition(a: Vector, b: Vector, first: Edge[], second: Edge[], partitioned: boolean,
  tick: () => void, boundaries: WeakMap<Vector,Edge[]>, admits: SeamAdmission): Vector | undefined {
  const left = partition(first, second, tick), right = partition(second, first, tick);
  const keys = new Set(left.map(edgeKey));
  if (keys.size !== left.length || new Set(right.map(edgeKey)).size !== right.length) return;
  // Authored rings may use either global winding. Match the direction of the
  // shared edge to the side that survives the subtraction.
  if (!right.some(e => keys.has(edgeKey(reversed(e))))) {
    if (!right.some(e => keys.has(edgeKey(e)))) return;
    for (let i = 0; i < right.length; i++) right[i] = reversed(right[i]);
  }
  const remain = new Map(left.map(e => [edgeKey(e), e]));
  const seamPoints = new Set<string>();
  const seam: Edge[] = [];
  for (const edge of right) {
    tick();
    if (remain.delete(edgeKey(reversed(edge)))) {
      seam.push(edge);
      seamPoints.add(pointKey(edge.a));
      seamPoints.add(pointKey(edge.b));
    }
    else {
      const key = edgeKey(edge);
      if (remain.has(key)) return;
      remain.set(key, edge);
    }
  }
  if (!seam.length || !admits(seam)) return;
  const leftEdges = new Set(left);
  const exterior = cancelRebasedSeams([...remain.values()],e=>leftEdges.has(e)?a:b,tick);
  const outline = joinedRings(exterior,tick);
  if (!outline) return;

  // The polygon kernel is only a proof. Its sampled vertices never become
  // authored geometry. An interior overlap still belongs to the drawing tools.
  const admittedPolygons = (source: Vector, edges: Edge[]) => {
    if (!partitioned) return vectorPolygons(source);
    // Sample the same subcurves on both sides for the proof. Sampling the
    // whole curve on one side can invent a thin overlap at the internal seam.
    const contours = contourRings(edges, p => ({ ...p }), tick);
    return contours ? vectorPolygons({ ...source, x: 0, y: 0, rotation: 0, transform: undefined,
      kind: 'polygon', contours, fillRule: source.fillRule }, OVERLAY_CURVE_TOLERANCE) : [];
  };
  const pa = admittedPolygons(a, left), pb = admittedPolygons(b, right);
  const exits = partitioned ? seamExits(seamPoints, exterior) : [];
  const sampled = new Map<Edge, Point[]>();
  const near = (edge: Edge, points: Point[]) => {
    let path = sampled.get(edge);
    if (!path) {
      const [a, b, c, d] = cubic(edge);
      path = edge.out || edge.in
        ? flattenCommands([['M', a.x, a.y], ['C', b.x, b.y, c.x, c.y, d.x, d.y]], OVERLAY_CURVE_TOLERANCE / 8, tick)[0]
        : [a, d];
      sampled.set(edge, path);
    }
    return points.every(point => distanceToPath(point, path!, tick) <= OVERLAY_CURVE_TOLERANCE);
  };
  const pointsOf = (polygon: MultiPolygon[number]) => polygon[0].map(([x, y]) => ({ x, y }));
  const meaningfulOverlap = (polygon: MultiPolygon[number]) => {
    if (!hasArea(polygon, tick)) return false;
    if (polygon.length !== 1) return true;
    const points = pointsOf(polygon);
    // A faceted cut can leave a wedge where its shared seam reaches a smooth
    // exterior. Require contact with the exit and proximity to both branches.
    return !exits.some(exit => points.some(p => {
      tick();
      return Math.hypot(p.x - exit.point.x, p.y - exit.point.y) <= OVERLAY_CURVE_TOLERANCE;
    }) && exit.edges.every(edge => near(edge, points)));
  };
  if (!pa.length || !pb.length || clipping.intersection(pa, pb).some(meaningfulOverlap)) return;
  const shape = normalizedJoin(a,outline,tick);
  // Further joins in this edit must see the same world controls as the
  // neighboring faces, including after the growing fill changes local origin.
  boundaries.set(shape, exterior);
  if (partitioned && a.fillRule === 'evenodd' && b.fillRule === 'evenodd') {
    // With disjoint interiors, the union is the XOR of the two original
    // fills. Each cancelled edge contributes twice to the ray parity and
    // every surviving edge contributes once. Keep that exact outline rather
    // than comparing exterior chords from independent polygon sweeps.
    const normalized = matrix(shape);
    const samePosition = (original: Point, point: Point) => {
      tick();
      const p = mapPoint(normalized, point);
      const error = Math.min(1e-8, Math.max(1, Math.abs(original.x), Math.abs(original.y)) * Number.EPSILON * 64);
      return Math.hypot(original.x - p.x, original.y - p.y) <= error;
    };
    return outline.rings.every((ring, i) => ring.every((node, j) => {
      const stored = shape.contours![i][j];
      return samePosition(node, stored) && (!node.in || samePosition(node.in, stored.in!)) &&
        (!node.out || samePosition(node.out, stored.out!));
    })) ? shape : undefined;
  }
  const expected = clipping.union([...pa, ...pb]);
  const actual = vectorPolygons(shape, partitioned ? OVERLAY_CURVE_TOLERANCE : 0.25);
  const changesCoverage = (polygon: MultiPolygon[number]) => hasArea(polygon, tick);
  if (!actual.length || clipping.difference(expected, actual).some(changesCoverage) ||
      clipping.difference(actual, expected).some(changesCoverage)) return;
  return shape;
}

function joinExactFaceComponent(artwork: Vector[], potential: Vector[], seedIndex: number,
  slots: Map<Vector, number>, boxes: Bounds[], lookup: (box: Bounds) => number[],
  permits: (edge: Edge) => boolean, current: (s: Vector) => Vector | undefined, disjoint: DisjointPaint, tick: () => void) {
  // A complete cut can have junctions where three or more faces meet. A
  // pairwise join at such a vertex can have a pinched or disconnected
  // intermediate outline even when the final exterior is a simple ring.
  const seed = potential[seedIndex];
  const ordinary = (s: Vector) => s.kind === 'polygon' && s.fillRule === 'evenodd' &&
    !s.rotation && !s.transform && canJoinOverlayFills(seed, s);
  if (potential.length < 3 || !ordinary(seed)) return;
  const members = new Set([seedIndex]);
  const outlines = new Map<number, Edge[]>();
  const incident = new Map<string, number[]>();
  const interiorCandidates = new Map<number, number[]>();
  for (const index of members) {
    for (const i of lookup(boxes[index])) {
      tick();
      const a = boxes[index], b = boxes[i];
      if (i < index && Math.min(a.right,b.right) > Math.max(a.left,b.left) &&
          Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)) {
        const row = interiorCandidates.get(index);
        if (row) row.push(i);
        else interiorCandidates.set(index, [i]);
      }
      if (outlines.has(i) || current(potential[i]) !== potential[i] || !ordinary(potential[i])) continue;
      const edges = outline(potential[i], tick);
      outlines.set(i, edges);
      for (const edge of edges) {
        const key = edgeKey(edge), neighbors = incident.get(key);
        if (neighbors) neighbors.push(i);
        else incident.set(key, [i]);
      }
    }
    for (const edge of outlines.get(index) ?? []) {
      const neighbors = incident.get(edgeKey(reversed(edge)));
      if (neighbors && permits(edge)) for (const neighbor of neighbors) members.add(neighbor);
    }
  }
  if (members.size < 3) return;
  const samples = new Map<Vector, MultiPolygon>();
  const sampled = (face: Vector) => {
    let polygon = samples.get(face);
    if (!polygon) { polygon = vectorPolygons(face); samples.set(face, polygon); }
    return polygon;
  };
  const exterior = new Map<string, Edge>(), used = new Set<string>(), curved = new Map<Edge,Vector>();
  const target = slots.get(seed)!;
  const joined = new Set([...members].map(i => potential[i]));
  let low = target, high = target;
  const componentBounds = { ...boxes[seedIndex] }, occupied: number[] = [];
  for (const member of members) {
    const slot = slots.get(potential[member])!, box = boxes[member];
    occupied.push(slot);
    low = Math.min(low, slot);
    high = Math.max(high, slot);
    componentBounds.left = Math.min(componentBounds.left, box.left);
    componentBounds.right = Math.max(componentBounds.right, box.right);
    componentBounds.top = Math.min(componentBounds.top, box.top);
    componentBounds.bottom = Math.max(componentBounds.bottom, box.bottom);
  }
  const below: { slot: number; shape: Vector }[] = [], above: typeof below = [];
  if (high - low + 1 !== joined.size) {
    occupied.sort((a,b) => a-b);
    // Visit only gaps between component members. Artwork disjoint from the
    // entire component can never block any member's change of paint order.
    for (let i = 1; i < occupied.length; i++) {
      for (let slot = occupied[i - 1] + 1; slot < occupied[i]; slot++) {
        tick();
        const shape = current(artwork[slot]);
        if (shape && !joined.has(shape) &&
            (alwaysBlocksFillPlacement(shape) || overlaps(componentBounds, mergeControlBounds(shape), 0))) {
          (slot < target ? below : above).push({ slot, shape });
        }
      }
    }
    below.reverse();
  }
  for (const member of members) {
    const face = potential[member], index = slots.get(face)!;
    for (const barrier of index < target ? below : above) {
      if (index < target ? barrier.slot <= index : barrier.slot >= index) break;
      tick();
      if (blocksFillPlacement(barrier.shape, face, boxes[member], disjoint, tick)) return;
    }
    // A shared edge in one contour does not disprove overlap elsewhere.
    for (const i of interiorCandidates.get(member) ?? []) {
      tick();
      const other = potential[i];
      if (!members.has(i)) continue;
      const a = sampled(face), b = sampled(other);
      if (!a.length || !b.length || clipping.intersection(a,b).some(p => hasArea(p,tick))) return;
    }
    for (const edge of outlines.get(member)!) {
      tick();
      const k = edgeKey(edge);
      if (used.has(k)) return;
      used.add(k);
      const reverseKey = edgeKey(reversed(edge)), opposite = exterior.get(reverseKey);
      if (opposite) {
        exterior.delete(reverseKey);
        curved.delete(opposite);
        if (!permits(edge)) return;
      } else {
        exterior.set(k, edge);
        if (edge.in && edge.out) curved.set(edge,face);
      }
    }
  }
  const surviving = cancelRebasedSeams([...exterior.values()], e=>curved.get(e)!,tick,curved.keys());
  const joinedOutline = joinedRings(surviving,tick);
  if (!joinedOutline) return;
  const { rings } = joinedOutline;
  if (!rings?.length || rings.length > 10000 || rings.some(r => r.length > MAX_VECTOR_POINTS)) return;
  const shape = normalizedJoin(seed,joinedOutline,tick);
  return { shape, members: joined, exterior: surviving };
}

function planFillJoins(artwork: Vector[], seeds: readonly string[], editedOnly: boolean, erasedInk: Vector[] | undefined,
  deferPerimeter: boolean, tick: () => void, overlay?: OverlayJoin) {
  const ids = new Set(seeds);
  const unchanged = { artwork, absorbed: new Map<string, string>(), contained: new Set<string>() };
  if (!ids.size) return unchanged;
  try {
    const colors = new Set(artwork.filter(s => ids.has(s.id) && canJoinOverlayFills(s, s)).map(s => s.fill.toLowerCase()));
    if (!colors.size) return unchanged;
    const potential = artwork.filter(s => (!editedOnly || ids.has(s.id)) &&
      colors.has(s.fill.toLowerCase()) && canJoinOverlayFills(s, s));
    if (potential.length < 2) return unchanged;
    const boxes = potential.map(mergeControlBounds), lookup = boundsIndex(boxes);
    const slots = new Map(artwork.map((s, i) => [s, i]));
    const removed = new Set<Vector>(), updated = new Map<Vector, Vector>();
    const current = (s: Vector) => updated.get(s) ?? (removed.has(s) ? undefined : s);
    const absorbed = new Map<string, string>();
    const contained = new Set<string>();
    const boundaries = new WeakMap<Vector,Edge[]>();
    const disjoint = paintSeparation(tick);
    const remaining = inkCoverage(artwork, lookup, tick), erased = erasedInk && inkCoverage(erasedInk, lookup, tick);
    for (const [seedIndex,seed] of potential.entries()) {
      if (!ids.has(seed.id) || removed.has(seed) || updated.has(seed)) continue;
      let fill = seed, slot = seed;
      const cutRemainder = overlay && seed.id !== overlay.incoming;
      const joinedIds = [seed.id];
      const group = JSON.stringify(seed.groups ?? []);
      const permits = (e: Edge) => !remaining(group,e) && (!erased || erased(group,e));
      const component = !cutRemainder &&
        joinExactFaceComponent(artwork, potential, seedIndex, slots, boxes, lookup, permits, current, disjoint, tick);
      if (component) {
        updated.set(seed, component.shape);
        fill = component.shape;
        boundaries.set(fill, component.exterior);
        for (const member of component.members) if (member !== seed) {
          removed.add(member);
          absorbed.set(member.id, seed.id);
          joinedIds.push(member.id);
        }
        if (component.members.size === potential.length) continue;
      }
      const pendingPerimeter = new Set<Vector>();
      const attempted = new Set<Vector>();
      let next = true;
      while (next) {
        next = false;
        for (const i of lookup(mergeControlBounds(fill)).sort((a, b) => a - b)) {
          tick();
          const candidate = potential[i];
          if (candidate === slot || candidate === seed || attempted.has(candidate) || removed.has(candidate) || updated.has(candidate) ||
              !canJoinOverlayFills(fill, candidate)) continue;
          const admits = (edges: Edge[]) => edges.some(e => {
            tick();
            return permits(e);
          });
          attempted.add(candidate);
          const seam = cutRemainder ? undefined : joinPair(fill, candidate, tick, !editedOnly && !erased, boundaries, admits);
          // Follow matching overlaps beyond the freshly drawn footprint,
          // retaining the same stack-order checks as the seam join below.
          const overlapping = !seam && overlay && overlay.budget.remaining > 0 &&
            !mayIntersectPaint(candidate, overlay.footprint) &&
            prepareOverlappingPaintUnion(candidate, fill, overlay.budget);
          const combined = seam ?? (overlapping ? { shape: overlapping } : undefined);
          if (!combined) continue;
          const start = Math.min(slots.get(slot)!, slots.get(candidate)!);
          const end = Math.max(slots.get(slot)!, slots.get(candidate)!);
          let perimeter: Set<string> | undefined;
          const provisional: Vector[] = [];
          const canCross = (moving:Vector, footprint: Bounds, belowInk: boolean) => !artwork.slice(start + 1, end).some(s => {
            tick();
            const intervening = current(s);
            // Changing order with the very same opaque paint leaves the
            // composite unchanged. Other material and ink must be separated.
            if (!intervening || overlapping && canJoinOverlayFills(intervening, moving) ||
                !blocksFillPlacement(intervening, moving, footprint, disjoint, tick)) return false;
            // A surviving cut outline belongs above the reunited material.
            // Only cross it downwards when its entire centerline is exterior.
            if (belowInk && isEditableInk(intervening)) {
              perimeter ??= new Set((boundaries.get(combined.shape) ?? outline(combined.shape, tick))
                .flatMap(edge => [edgeKey(edge), edgeKey(reversed(edge))]));
              if (outline(intervening, tick).every(edge => perimeter!.has(edgeKey(edge)))) return false;
              if (deferPerimeter) { provisional.push(intervening); return false; }
            }
            return true;
          });
          // Prefer the recolored slot. A small inner fill can instead move to
          // the surround's slot without crossing ink on the outside border.
          const seedBelow = slots.get(slot)! < slots.get(candidate)!;
          let placement: Vector;
          if (canCross(candidate, boxes[i], seedBelow)) placement = slot;
          else {
            provisional.length = 0;
            if (!canCross(fill, mergeControlBounds(fill), !seedBelow)) continue;
            placement = candidate;
          }
          for (const ink of provisional) pendingPerimeter.add(ink);
          if (combined.contained === seed.id) {
            for (const previous of joinedIds) contained.add(previous);
          } else if (combined.contained) contained.add(combined.contained);
          joinedIds.push(candidate.id);
          fill = combined.shape;
          attempted.clear();
          const vacated = placement === slot ? candidate : slot;
          updated.delete(vacated);
          removed.add(vacated);
          absorbed.set(candidate.id, seed.id);
          updated.set(placement, fill);
          slot = placement;
          next = true;
        }
      }
      // A brush can bridge several outlined faces. Each border must survive
      // above the final exterior, even when it belongs to a later neighbor.
      if (pendingPerimeter.size) {
        const perimeter = new Set((boundaries.get(fill) ?? outline(fill, tick))
          .flatMap(edge => [edgeKey(edge), edgeKey(reversed(edge))]));
        for (const ink of pendingPerimeter) {
          if (!outline(ink, tick).every(edge => perimeter.has(edgeKey(edge)))) return;
        }
      }
    }
    return updated.size ? { artwork: artwork.flatMap(s => updated.has(s) ? [updated.get(s)!] : removed.has(s) ? [] : [s]), absorbed, contained }
      : unchanged;
  } catch {
    // The original artwork remains valid if a seam cannot be proven.
    return unchanged;
  }
}

function prepareFillJoins(artwork: Vector[], seeds: readonly string[], editedOnly: boolean, erasedInk?: Vector[],
  overlay?: OverlayJoin) {
  let work = 0;
  const tick = () => { if (++work > 200000) throw Error('Recolor seam work limit reached.'); };
  return planFillJoins(artwork, seeds, editedOnly, erasedInk, true, tick, overlay) ??
    planFillJoins(artwork, seeds, editedOnly, erasedInk, false, tick, overlay)!;
}

export function prepareMatchingFillJoins(artwork: Vector[], seeds: readonly string[], editedOnly = false, erasedInk?: Vector[]) {
  return prepareFillJoins(artwork, seeds, editedOnly, erasedInk);
}

export function joinRecoloredFills(artwork: Vector[], recolored: readonly string[]): Vector[] {
  return prepareMatchingFillJoins(artwork, recolored).artwork;
}

export function joinOverlayFills(artwork: Vector[], incoming: Vector, cutFills: Vector[] = []): Vector[] {
  const seeds = [incoming.id, ...cutFills.map(fill => fill.id)];
  return prepareFillJoins(artwork, seeds, false, undefined,
    { incoming: incoming.id, footprint: mergeControlBounds(incoming), budget: { remaining: 200000 } }).artwork;
}

/** Deleting ink opens only the seams that the deleted centerline owned. */
export function healDeletedInk(artwork: Vector[], deleted: Vector[]) {
  return planVacatedInkHealing(artwork, deleted)?.artwork ?? artwork;
}

/** The relocated ink remains in the stack, so it can still own a seam. */
export function planVacatedInkHealing(artwork: Vector[], deleted: Vector[], eligible?: ReadonlySet<string>) {
  const ink = deleted.filter(s => isEditableInk(s) && s.drawingMode !== 'object');
  if (!ink.length) return;
  const nearby = boundsIndex(ink.map(mergeControlBounds));
  const seeds = artwork.filter(s => (!eligible || eligible.has(s.id)) && canJoinOverlayFills(s,s) &&
    nearby(mergeControlBounds(s)).length).map(s => s.id);
  return prepareMatchingFillJoins(artwork, seeds, !!eligible, ink);
}
