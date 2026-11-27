import { clone, id, type BezierNode, type Point, type Vector } from '@splash/document';
import { inversePoint, mapPoint, matrix } from './affine';
import { boundsIndex, type Bounds } from './bounds-index';
import { lineCubicCutTimes } from './curve-snap';
import { splitCubic, type Cubic } from './curve-fit';
import { normalizeVector, pathCommands } from './drawing';
import type { PaintRegion } from './paint-region';
import clipping from './paint-clipping';
import { strokePolygons, worldStrokePolygons } from './strokes';
import { cutCollapsedStrokeLine } from './collapsed-stroke-cut';

type Span = [Point, Point] | Cubic;
const margin = 64 * Number.EPSILON;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const bounds = (points: readonly Point[]): Bounds => ({
  left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
  top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
});

export function isEditableInk(shape: Vector): boolean {
  return !!shape.strokeWidth && !shape.contours && (!shape.closed || shape.fillEnabled === false) &&
    (shape.kind === 'line' || shape.kind === 'path' || shape.kind === 'bezier');
}

/** Extend a mask by the stroke's local radius while retaining its affine basis. */
export function expandStrokeMask(shape: Vector, region: PaintRegion): PaintRegion {
  const basis = matrix(shape);
  const clearance = shape.strokeCap === 'square' ? Math.SQRT2 : 1;
  const expanded = region.flatMap(polygon => polygon.flatMap(ring => {
    const points = ring.map(([x, y]) => inversePoint(basis, { x, y }));
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
      throw Error('Stroke cut requires finite geometry.');
    const band: Vector = {
      id: shape.id, kind: 'path', x: 0, y: 0, width: 0, height: 0,
      rotation: shape.rotation, transform: shape.transform,
      points, closed: true, fillEnabled: false, fill: shape.fill, stroke: shape.stroke,
      strokeWidth: shape.strokeWidth * clearance,
    };
    return strokePolygons(band).map(part => part.map(boundary => boundary.map(([x, y]): [number, number] => {
      const point = mapPoint(basis, { x, y });
      return [point.x, point.y];
    })));
  }));
  return [...region, ...expanded];
}

export function prepareStrokeSelection(region: PaintRegion, regionBounds: Bounds, allowEdge = true) {
  const cut = prepareStrokeCut(region);
  const hasHoles = allowEdge && region.some(polygon => polygon.length > 1);
  let projectedPolygons: Set<string> | undefined;
  return (shape: Vector, keep: 'inside' | 'outside'): Vector[] => {
    const runs = cut(shape, keep);
    if (!allowEdge || (keep === 'inside' ? runs[0] === shape : !runs.length)) return runs;
    let paint: PaintRegion | undefined;
    const points = shape.kind === 'bezier' && shape.nodes?.length ? shape.nodes : shape.points;
    if (hasHoles && points.length > 1) {
      const basis = matrix(shape);
      const endsInside = [points[0], points.at(-1)!].every(anchor => {
        const { x, y } = mapPoint(basis, anchor);
        return x >= regionBounds.left && x <= regionBounds.right && y >= regionBounds.top && y <= regionBounds.bottom;
      });
      // A retained footprint can carry the original miter or bevel sweep's
      // own hairline gaps. Exact projected polygons prove ownership of the
      // complete stroke without erasing a newly authored cut.
      if (endsInside) {
        paint = worldStrokePolygons(shape);
        if (paint.length && paint.length <= region.length) {
          projectedPolygons ??= new Set(region.map(projectedPolygonKey));
          if (paint.every(polygon => projectedPolygons!.has(projectedPolygonKey(polygon))))
            return keep === 'inside' ? [shape] : [];
        }
      }
    }
    const missedCenterline = keep === 'inside' ? runs.length === 0 : runs[0] === shape;
    if (!missedCenterline || !clipping.intersection(paint ?? worldStrokePolygons(shape), region).length)
      return runs;
    return prepareStrokeCut(expandStrokeMask(shape, region))(shape, keep);
  };
}

/** Compare every coordinate exactly. The intersection sweep can reverse or
 * rotate affine rings and reorder holes without changing the footprint. */
function projectedPolygonKey(polygon: PaintRegion[number]) {
  const ringKey = (ring: PaintRegion[number][number]) => {
    const end = ring.at(-1), first = ring[0];
    const length = end && end[0] === first[0] && end[1] === first[1] ? ring.length - 1 : ring.length;
    if (!length) return '';
    const compare = (a: typeof first, b: typeof first) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0];
    let start = 0;
    for (let i = 1; i < length; i++) if (compare(ring[i], ring[start]) < 0) start = i;
    const direction = compare(ring[(start + 1) % length], ring[(start + length - 1) % length]) <= 0 ? 1 : -1;
    const coordinates: string[] = [];
    for (let i = 0; i < length; i++) coordinates.push(ring[(start + direction * i + length) % length].join(','));
    return coordinates.join(':');
  };
  return [polygon[0] ? ringKey(polygon[0]) : '', ...polygon.slice(1).map(ringKey).sort()].join('|');
}

function lineCutTimes([a, b]: [Point, Point], u: Point, v: Point): number[] {
  const dx = b.x - a.x, dy = b.y - a.y, ex = v.x - u.x, ey = v.y - u.y;
  const x = u.x - a.x, y = u.y - a.y, det = cross(dx, dy, ex, ey);
  if (det) {
    const t = cross(x, y, ex, ey) / det, s = cross(x, y, dx, dy) / det;
    return s >= -margin && s <= 1 + margin ? [t] : [];
  }
  if (cross(x, y, dx, dy)) return [];
  return Math.abs(dx) >= Math.abs(dy) ? [x / dx, (v.x - a.x) / dx] : [y / dy, (v.y - a.y) / dy];
}

function spanPart(span: Span, from: number, to: number): Span {
  if (span.length === 4) {
    const left = to === 1 ? span : splitCubic(span, to)[0];
    return from === 0 ? left : splitCubic(left, from / to)[1];
  }
  const [a, b] = span;
  const at = (t: number) => t === 0 ? a : t === 1 ? b :
    { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return [at(from), at(to)];
}

/** Partition a stroke's centerline, then render the surviving runs with its
 * original width and caps. Original cubics are restricted, never refitted. */
export function prepareStrokeCut(region: PaintRegion) {
  const edges: { a: Point; b: Point; ring: number }[] = [];
  const rings: { polygon: number; outer: boolean }[] = [];
  let right = -Infinity;
  region.forEach((polygon, owner) => polygon.forEach((points, index) => {
    const ring = rings.push({ polygon: owner, outer: index === 0 }) - 1;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i], [nx, ny] = points[(i + 1) % points.length];
      right = Math.max(right, x);
      if (x !== nx || y !== ny) edges.push({ a: { x, y }, b: { x: nx, y: ny }, ring });
    }
  }));
  const index = boundsIndex(edges.map(({ a, b }) => bounds([a, b])));
  let work = 0;
  function query(box: Bounds) {
    const candidates = index(box);
    work += 1 + candidates.length;
    if (work > 1_000_000) throw Error('Stroke cut exceeds the supported intersection work.');
    return candidates;
  }
  function inside(p: Point) {
    if (p.x > right) return false;
    const crossed = new Set<number>(), boundary = new Set<number>();
    for (const i of query({ left: p.x, right, top: p.y, bottom: p.y })) {
      const { a, b, ring } = edges[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      // A centerline following the mask edge stays outside the cut.
      if (p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
          Math.abs(cross(dx, dy, p.x - a.x, p.y - a.y)) <= margin * (dx * dx + dy * dy))
        boundary.add(rings[ring].polygon);
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (dx * (p.y - a.y)) / dy + a.x) {
        if (crossed.has(ring)) crossed.delete(ring);
        else crossed.add(ring);
      }
    }
    const exterior = new Set<number>(), holes = new Set<number>();
    for (const i of crossed) {
      const { polygon, outer } = rings[i];
      (outer ? exterior : holes).add(polygon);
    }
    for (const polygon of exterior) if (!holes.has(polygon) && !boundary.has(polygon)) return true;
    return false;
  }

  return (shape: Vector, keep: 'inside' | 'outside'): Vector[] => {
    const basis = matrix(shape), runs: Span[][] = [];
    const translationOnly = basis[0] === 1 && basis[1] === 0 && basis[2] === 0 && basis[3] === 1;
    const commands = pathCommands(shape);
    let run: Span[] | undefined, first: Point | undefined, last: Point | undefined;
    let firstKept = false, lastKept = false, visited = false, removed = false;
    const split = (span: Span) => {
      if (span.every(point => same(point, span[0]))) return;
      const world = span.map(point => mapPoint(basis, point)) as Span;
      if (world.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
        throw Error('Stroke cut requires finite geometry.');
      const collapsed = world.every(point => same(point, world[0]));
      if (collapsed && !translationOnly) return;
      const candidates = query(bounds(world));
      // A translated, locally nonzero span can round onto one world point.
      // With no boundary box at that point its whole projection cell has
      // one mask owner. Preserve the stored span. Boundary cases must keep
      // the original shape, including spans processed earlier in this cut.
      if (collapsed && candidates.length) {
        if (span.length !== 2 || shape.kind !== 'path' || shape.closed || commands.length !== 2) return false;
        const p = world[0];
        const intervals = cutCollapsedStrokeLine(span, {x:shape.x,y:shape.y},
          candidates.map(i => edges[i]), () => query({left:p.x,right,top:p.y,bottom:p.y}).map(i => edges[i]), rings);
        if (!intervals) return false;
        const pieces: [Point,Point][] = [];
        let current: [Point,Point] | undefined;
        let discarded = false;
        for (const interval of intervals) {
          if (interval.inside === (keep === 'inside')) {
            if (current) current[1] = interval.span[1];
            else pieces.push(current = [...interval.span]);
          } else {
            discarded = true;
            current = undefined;
          }
        }
        if (!discarded) return [shape];
        // Reanchoring at a rounded world endpoint would move a local
        // knot. Keep the original affine basis for both sides of the cut.
        return pieces.map(points => ({
          ...clone(shape), id:id(), points, closed:false, fillEnabled:false,
          width:Math.abs(points[1].x-points[0].x), height:Math.abs(points[1].y-points[0].y),
        }));
      }
      const times = [0, 1];
      for (const i of candidates) {
        const { a, b } = edges[i];
        const hits = world.length === 4 ? lineCubicCutTimes(a, b, world) : lineCutTimes(world, a, b);
        for (const t of hits) if (t > margin && t < 1 - margin) times.push(t);
      }
      times.sort((a, b) => a - b);
      let keptFrom: number | undefined;
      for (let i = 1; i < times.length; i++) {
        const from = times[i - 1], to = times[i];
        if (to - from <= margin) continue;
        const midpoint = spanPart(world, 0, (from + to) / 2).at(-1)!;
        lastKept = inside(midpoint) === (keep === 'inside');
        if (!visited) { firstKept = lastKept; visited = true; }
        if (lastKept) keptFrom ??= from;
        else {
          if (keptFrom !== undefined) append(keptFrom, from);
          keptFrom = undefined;
          run = undefined;
          removed = true;
        }
      }
      if (keptFrom !== undefined) append(keptFrom, 1);
      function append(from: number, to: number) {
        if (!run) runs.push(run = []);
        run.push(spanPart(span, from, to));
      }
    };
    for (const command of commands) {
      if (command[0] === 'M') { first = last = { x: command[1], y: command[2] }; continue; }
      if (!last) continue;
      let next: Point, outcome: false | Vector[] | undefined;
      if (command[0] === 'C') {
        next = { x: command[5], y: command[6] };
        outcome = split([last, { x: command[1], y: command[2] }, { x: command[3], y: command[4] }, next]);
      } else {
        next = command[0] === 'Z' ? first! : { x: command[1], y: command[2] };
        outcome = split([last, next]);
      }
      if (outcome === false) return keep === 'outside' ? [shape] : [];
      if (outcome !== undefined) return outcome;
      last = next;
    }
    if (!removed) return visited || keep === 'outside' ? [shape] : [];
    if (shape.closed && firstKept && lastKept && runs.length > 1)
      runs[0] = [...runs.pop()!, ...runs[0]];
    return runs.map(spans => {
      const piece: Vector = clone({ ...shape, id: id(), points: [], nodes: undefined, closed: false, fillEnabled: false });
      const nodes: BezierNode[] = [{ ...spans[0][0] }];
      for (const span of spans) {
        const end = span[span.length - 1];
        if (span.length === 4 && !same(span[0], span[1])) nodes.at(-1)!.out = { ...span[1] };
        nodes.push({ ...end, ...(span.length === 4 && !same(end, span[2]) ? { in: { ...span[2] } } : {}) });
      }
      if (piece.kind === 'bezier') piece.nodes = nodes;
      else piece.points = nodes;
      normalizeVector(piece);
      return piece;
    });
  };
}
