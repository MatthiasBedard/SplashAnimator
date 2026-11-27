import { boundsIndex, overlaps, type Bounds } from './bounds-index';
import { mergedStrokeNodes } from './stroke-curves';
import { restoreBucketCurves, restorePaintCurves } from './paint-curves';
import { partitionInkOverPaint, type InkPaintRetry } from './ink-paint-cut';
import { hasRestorableFillCurves } from './clip-fill-curves';
import { checkPaintEdgeProvenance, PaintCurveLossError } from './paint-edge-provenance';
import type { CurveTrace } from './drawing';
import type { MultiPolygon, Polygon } from 'polygon-clipping';
import clipping, {
  integerBrushSweepUnion,
  evenOddPaint,
  nonzeroPaint,
  PAINT_GRID_STEP,
} from './paint-clipping';
import { clone, id, type Point, type Vector } from '@splash/document';
import { containsPoint, worldPaths, normalizeVector, pathCommands } from './drawing';
import { matrix, mapPoint, inversePoint } from './affine';
import { polygonVectors } from './strokes';

// Straight-edge planar arrangement. Curves are flattened at a documented 0.25px tolerance.
// All heavy intersection work runs in a worker in the editor; this pure module is fixture-testable.
const EPS = 1e-7;
export class NarrowArrangementFaceError extends Error {
  constructor() {
    super('Arrangement face is too narrow to resolve at this document origin.');
  }
}
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
// Translate before multiplying: world-coordinate shoelace products can cancel
// a small valid ring entirely when its document origin is large.
const area = (ring: Point[], absoluteFan = false) => {
  if (ring.length < 3) return 0;
  const origin = ring[0];
  let sum = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    const triangle = cross(subtract(ring[i], origin), subtract(ring[i + 1], origin));
    sum += absoluteFan ? Math.abs(triangle) : triangle;
  }
  return sum / 2;
};
const coordinates = (ring: Point[]) => ring.map((p) => [p.x, p.y] as [number, number]);
const paintKey = (s: Vector) =>
  `${s.fill}:${s.opacity ?? 1}:${s.paintBrightness ?? 0}:${JSON.stringify(s.bitmap ? { paint: s.bitmap, matrix: matrix(s) } : undefined)}:${JSON.stringify(s.gradient ? { paint: s.gradient, matrix: matrix(s) } : undefined)}`;
const world = (s: Vector, p: Point): Point => {
  return mapPoint(matrix(s), p);
};
export function worldGradient(s: Vector) {
  return s.gradient
    ? {
        ...s.gradient,
        from: world(s, s.gradient.from),
        to: world(s, s.gradient.to),
        stops: s.gradient.stops.map((p) => ({ ...p })),
      }
    : undefined;
}
type Fill = { shape: Vector; polygons: MultiPolygon };
type Segment = {
  a: Point;
  b: Point;
  cuts: number[];
  stroke?: Vector;
  order: number;
  curve?: CurveTrace;
};
type Vertex = { point: Point; outgoing: number[] };
type Edge = {
  from: number;
  to: number;
  twin: number;
  next: number;
  face: number;
  stroke?: Vector;
  order: number;
  curve?: CurveTrace;
};
type Face = {
  ring: Point[];
  area: number;
  sample: Point;
  fill?: Fill;
  holes: Point[][];
  parent: number;
};

export function hasVectorFill(s: Vector): boolean {
  return s.kind !== 'text' && s.fillEnabled !== false &&
    !!(s.closed || s.contours || ['rectangle', 'ellipse', 'polygon', 'brush'].includes(s.kind));
}
export function vectorPolygons(s: Vector, tolerance = 0.25): MultiPolygon {
  if (!hasVectorFill(s)) return [];
  return fillPolygons(s, worldPaths(s, tolerance));
}
function fillPolygons(s: Vector, paths: Point[][]): MultiPolygon {
  // Opposite lobes can cancel signed area while retaining visible paint.
  // The absolute triangle fan is only a conservative input-area bound; the
  // clipping kernel resolves actual fill and arrangement faces retain signed area.
  const rings = paths.filter((r) => r.length >= 4 && area(r, true) > EPS);
  if (!rings.length) return [];
  // Even-odd membership depends on all rings, not on the presence of handles.
  // Removing the final curve handle must not turn an island into a hole.
  if ((s.contours || s.kind !== 'brush') && s.fillRule === 'evenodd')
    return evenOddPaint(rings.map((ring) => [coordinates(ring)]));
  if (s.contours) return nonzeroPaint(rings.map(coordinates) as Polygon);
  // Brush dabs are overlapping exteriors, never holes.
  const polygons = rings.map((r) => [coordinates(r)] as Polygon);
  if (s.kind === 'brush') return integerBrushSweepUnion(polygons);
  let result: MultiPolygon = [];
  for (let start = 0; start < polygons.length; start += 128)
    result = clipping.union(result, ...polygons.slice(start, start + 128));
  return result;
}

/** One release's original sweep and finish consume the same flattened nibs.
 * Keep them private to the supplied, already detached Brush. */
export function prepareBrushSweep(brush: Vector) {
  if (brush.kind !== 'brush') throw new Error('Expected a brush stroke.');
  let paths: Point[][] | undefined;
  const sample = () => (paths ??= worldPaths(brush));
  return {
    sample: (): readonly (readonly Point[])[] => sample(),
    merge() {
      if (brush.contours) return mergeVectors([brush]);
      validateMergePaint([brush]);
      if (!hasVectorFill(brush)) return [];
      return polygonVectors(brush, fillPolygons(brush, sample()), true)
        .map(s => ({...s,id:id(),drawingMode:'merge' as const}));
    },
  };
}
export const contains = (polygons: MultiPolygon, p: Point) =>
  polygons.some(
    (poly) =>
      containsPoint(
        poly[0].map(([x, y]) => ({ x, y })),
        p,
      ) &&
      !poly.slice(1).some((r) =>
        containsPoint(
          r.map(([x, y]) => ({ x, y })),
          p,
        ),
      ),
  );

function coversStrokeInterior(polygons: MultiPolygon, p: Point) {
  if (!contains(polygons, p)) return false;
  // Shared outlines survive. Intersections already split the stroke, so only
  // spans strictly inside the new paint are eligible for removal.
  return !polygons.some(poly => poly.some(ring => ring.some(([x, y], i) => {
    if (!i) return false;
    const [a, b] = ring[i - 1], dx = x - a, dy = y - b;
    const length = Math.hypot(dx, dy);
    if (!length || p.x < Math.min(x, a) - EPS || p.x > Math.max(x, a) + EPS ||
        p.y < Math.min(y, b) - EPS || p.y > Math.max(y, b) + EPS) return false;
    return Math.abs((p.x - a) * (dy / length) - (p.y - b) * (dx / length)) <= EPS;
  })));
}

// Strict progress along one axis proves an open stroke cannot intersect itself.
// This permits exact curve retention only when its padded control hull is also
// disjoint from all other artwork. Loops/reversals still use the arrangement.
function simpleOpenStroke(s: Vector): boolean {
  if (
    s.drawingMode !== 'merge' ||
    !['path', 'bezier', 'line'].includes(s.kind) ||
    s.closed ||
    s.contours ||
    s.groups?.length ||
    s.fillEnabled !== false ||
    !Number.isFinite(s.strokeWidth) ||
    s.strokeWidth <= 0
  )
    return false;
  const commands = pathCommands(s),
    m = matrix(s);
  if (
    !m.every(Number.isFinite) ||
    !Number.isFinite(m[0] * m[3] - m[1] * m[2]) ||
    m[0] * m[3] - m[1] * m[2] === 0 ||
    commands.length < 2 ||
    commands[0][0] !== 'M' ||
    commands.slice(1).some((c) => c[0] !== 'L' && c[0] !== 'C')
  )
    return false;
  const start = commands[0];
  if (start[0] !== 'M') return false;
  return (['x', 'y'] as const).some((axis) => {
    let last = mapPoint(m, { x: start[1], y: start[2] })[axis],
      direction = 0;
    if (!Number.isFinite(last)) return false;
    for (const c of commands.slice(1)) {
      if (c[0] !== 'C' && c[0] !== 'L') return false;
      const points =
        c[0] === 'C'
          ? [
              { x: c[1], y: c[2] },
              { x: c[3], y: c[4] },
              { x: c[5], y: c[6] },
            ]
          : [{ x: c[1], y: c[2] }];
      const values = points.map((p) => mapPoint(m, p)[axis]),
        end = values.at(-1)!;
      if (!values.every(Number.isFinite) || end === last) return false;
      const sign = Math.sign(end - last);
      if (direction && sign !== direction) return false;
      direction = sign;
      for (const value of values) {
        if ((value - last) * direction < 0) return false;
        last = value;
      }
    }
    return true;
  });
}

export function strokeControlPadding(s: Vector, m = matrix(s)) {
  // Bound local joins and caps using the outline kernel's four-radius
  // miter limit, then conservatively enlarge the radius in world space.
  const reach = Math.max(s.strokeJoin === 'miter' ? 4 : 1, s.strokeCap === 'square' ? Math.SQRT2 : 1);
  return (Math.abs(s.strokeWidth) / 2) * reach * Math.hypot(m[0], m[1], m[2], m[3]);
}

/** Conservative world control hull, including the existing stroke reach. */
export function mergeControlBounds(s: Vector) {
  const m = matrix(s),
    b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const include = (x: number, y: number) => {
    const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
    b.left = Math.min(b.left, px);
    b.right = Math.max(b.right, px);
    b.top = Math.min(b.top, py);
    b.bottom = Math.max(b.bottom, py);
  };
  if (s.contours && s.kind !== 'symbol') {
    // Each closed command ring has exactly these anchors and controls in its
    // hull. Read them without allocating a second copy as path commands.
    for (const ring of s.contours) for (const node of ring) {
      include(node.x, node.y);
      if (node.in) include(node.in.x, node.in.y);
      if (node.out) include(node.out.x, node.out.y);
    }
  } else {
    for (const c of pathCommands(s)) {
      if (c[0] === 'Z') continue;
      include(c[1], c[2]);
      if (c[0] === 'C') {
        include(c[3], c[4]);
        include(c[5], c[6]);
      }
    }
  }
  if (s.strokeWidth && s.kind !== 'brush') {
    const padding = strokeControlPadding(s, m);
    b.left -= padding;
    b.right += padding;
    b.top -= padding;
    b.bottom += padding;
  }
  return b;
}

export function mergeDrawingVectors(
  input: Vector[],
  bucket?: { paint: Vector; point: Point; gap: number },
  preserveStrokeCurves = true,
  selection?: { original: ReadonlySet<string>; rebuilt: Set<string> },
  strokeCoveringPaint?: ReadonlySet<Vector>,
  inkRetry?: InkPaintRetry,
): Vector[] {
  const ink = input.at(-1);
  if (!bucket && ink && !hasVectorFill(ink)) {
    const cut = partitionInkOverPaint(input, ink, inkRetry?.bounds ?? mergeControlBounds,
      undefined, false, false, inkRetry);
    if (cut) return input.flatMap(s => {
      const pieces = cut.background.get(s) ?? (s === ink ? cut.strokes : [clone(s)]);
      if (selection?.original.has(s.id)) for (const piece of pieces) selection.rebuilt.add(piece.id);
      return pieces;
    });
    if (inkRetry && (ink.controlBounds || input.some(s =>
      s.controlBounds && overlaps(inkRetry.bounds(s), inkRetry.bounds(ink), 0))))
      throw new PaintCurveLossError();
  }
  const merged = mergeVectors(input, bucket, preserveStrokeCurves, selection, strokeCoveringPaint);
  // Boolean/arrangement subdivision is private working geometry. Restore only
  // certified surviving original cubic intervals, never fit earlier artwork.
  const curvedPaint = input.some(s => s.fillEnabled !== false && hasRestorableFillCurves(s));
  const result = curvedPaint ? restorePaintCurves(merged, input) : merged;
  checkPaintEdgeProvenance(input, result);
  return result;
}

/** A disjoint world control hull rules out paint clipping. Include both polygon
 * grid rounding and local stroke-outline rounding before affine mapping. */
export function mayIntersectPaint(shape: Vector, query: Bounds): boolean {
  const hull = mergeControlBounds(shape);
  if (![hull.left,hull.right,hull.top,hull.bottom].every(Number.isFinite)) return true;
  const m = matrix(shape);
  return overlaps(hull,query,2*PAINT_GRID_STEP + 1e-8*Math.hypot(m[0],m[1],m[2],m[3]));
}

/** Include every shape whose conservative bounds can reach the seed artwork,
 * including the existing clipping fallback's outward rounding reach. */
export function connectedMergeIndices(
  bounds: ReturnType<typeof mergeControlBounds>[],
  seeds: ReadonlySet<number>,
) {
  const found = new Set(seeds);
  const lookup = boundsIndex(bounds);
  const pending = [...found];
  for (let cursor = 0; cursor < pending.length; cursor++)
    for (const i of lookup(bounds[pending[cursor]], 2 * PAINT_GRID_STEP))
      if (!found.has(i)) {
        found.add(i);
        pending.push(i);
      }
  return found;
}

/** Outside artwork is disjoint from the whole rebuilt component. Keep those
 * objects in their existing slots. A worker reference reply can retain an
 * already detached root directly. Other callers receive a copy. */
export function mergeDrawingComponent(
  input: Vector[],
  indices: ReadonlySet<number>,
  merge: (component: Vector[]) => Vector[],
  retain?: (inputIndex: number, outputIndex: number) => Vector | void,
): Vector[] {
  const rebuilt = merge(input.filter((_, i) => indices.has(i)));
  let inserted = false;
  let outputIndex = 0;
  return input.flatMap((shape, i) => {
    if (!indices.has(i)) {
      const retained = retain?.(i, outputIndex);
      outputIndex++;
      return [retained ?? clone(shape)];
    }
    if (inserted) return [];
    inserted = true;
    outputIndex += rebuilt.length;
    return rebuilt;
  });
}

function validateMergePaint(input: Vector[]) {
  if (input.some(s => s.blendMode))
    throw Error('Restore Normal blending before converting the object to merged paint.');
  if (input.some(s=>s.tint)) throw Error('Remove drawing tint before converting the object to merged paint.');
  if (input.some(s => s.blurRadius || s.groupBlur))
    throw Error('Remove drawing blur before converting the object to merged paint.');
  if (input.some(s => s.brush?.opacityProfile))
    throw Error('Stroke opacity profiles require separate Brush objects.');
}

export function mergeVectors(
  input: Vector[],
  bucket?: { paint: Vector; point: Point; gap: number },
  preserveStrokeCurves = false,
  selection?: { original: ReadonlySet<string>; rebuilt: Set<string> },
  strokeCoveringPaint?: ReadonlySet<Vector>,
  strokeDrop?: { moved: ReadonlySet<Vector>; replaced: Set<Vector> },
): Vector[] {
  validateMergePaint(input);
  if (bucket && (!Number.isFinite(bucket.gap) || bucket.gap < 0 || bucket.gap > 40))
    throw new Error('Bucket gap must be between 0 and 40 stage units.');
  if (bucket && ![bucket.point.x, bucket.point.y].every(Number.isFinite))
    throw new Error('Bucket point must have finite coordinates.');
  // A disjoint control hull proves a previously merged fill or simple stroke is untouched. Preserve
  // its exact handles/paint instead of flattening it for an unrelated gesture.
  // Index control hulls so unrelated artwork retains exact curves at any object count.
  const retainable = (s: Vector) =>
    simpleOpenStroke(s) ||
    (!s.strokeWidth &&
      s.fillEnabled !== false &&
      s.fillRule === 'evenodd' &&
      ((s.kind === 'polygon' && !!s.contours?.length && s.drawingMode === 'merge') ||
        s.contours?.some((r) => r.some((n) => n.in || n.out))));
  if (!bucket && !strokeDrop && input.some(retainable) && input.every((s) => s.kind !== 'text')) {
    const bounds = input.map(mergeControlBounds);
    const candidates = boundsIndex(bounds);
    const retained = input.map(
      (s, i) => !!retainable(s) && candidates(bounds[i], EPS).every((j) => j === i),
    );
    if (retained.some(Boolean))
      return [
        // Every removed root is disjoint from every other root. Removing it
        // cannot uncover another isolated root, so proceed to the arrangement.
        ...arrangeMergeVectors(
          input.filter((_, i) => !retained[i]),
          undefined,
          preserveStrokeCurves,
          selection,
          strokeCoveringPaint,
        ),
        ...input
          .filter((_, i) => retained[i])
          .map((s) => {
            const retained = { ...clone(s), drawingMode: 'merge' as const };
            if (selection?.original.has(s.id)) selection.rebuilt.add(retained.id);
            return retained;
          }),
      ];
  }
  return arrangeMergeVectors(input, bucket, preserveStrokeCurves, selection, strokeCoveringPaint, strokeDrop);
}

function arrangeMergeVectors(
  ...[input, bucket, preserveStrokeCurves, selection, strokeCoveringPaint, strokeDrop]: Parameters<typeof mergeVectors>
): Vector[] {
  const needsSegments = !!bucket || input.some((s) => s.strokeWidth && s.kind !== 'brush');
  const fills: Fill[] = [],
    strokeCovers: { fill: Fill; order: number }[] = [],
    segments: Segment[] = [];
  const add = (
    points: Point[],
    order: number,
    stroke?: Vector,
    traces?: WeakMap<Point, CurveTrace>,
  ) => {
    for (let i = 1; i < points.length; i++)
      if (Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) > EPS)
        segments.push({
          a: points[i - 1],
          b: points[i],
          cuts: [0, 1],
          stroke,
          order,
          curve: traces?.get(points[i]),
        });
  };
  input.forEach((s, order) => {
    if (s.kind === 'text') {
      if (bucket) return;
      throw new Error('Text must stay on an object-drawing layer.');
    }
    const polygons = vectorPolygons(s);
    if (polygons.length) {
      const fill = { shape: s, polygons };
      fills.push(fill);
      if (strokeCoveringPaint?.has(s) && (s.opacity ?? 1) === 1 && !s.gradient && !s.bitmap)
        strokeCovers.push({ fill, order });
      if (needsSegments)
        polygons.forEach((p) =>
          p.forEach((r) =>
            add(
              r.map(([x, y]) => ({ x, y })),
              order,
              bucket?.paint,
            ),
          ),
        );
    }
    if (s.strokeWidth && s.kind !== 'brush') {
      const traces =
        (preserveStrokeCurves && s.kind === 'bezier' && !s.contours && s.fillEnabled === false) ||
        s.kind === 'ellipse' ||
        (s.kind === 'rectangle' && !!s.cornerRadius)
          ? new WeakMap<Point, CurveTrace>()
          : undefined;
      worldPaths(s, 0.25, traces ? (end, trace) => traces.set(end, trace) : undefined).forEach(
        (r) => add(r, order, s, traces),
      );
    }
  });
  // Filled brush paint needs polygon booleans, not the quadratic stroke arrangement.
  if (!bucket && !segments.some((segment) => segment.stroke)) {
    const regions = new Map<
      string,
      { shape: Vector; parts: MultiPolygon[]; selectedParts?: MultiPolygon[] }
    >();
    // Consecutive equal paints can union before occlusion. Do not combine
    // across another paint: that would change which color owns intersections.
    const runs: {
      shape: Vector;
      key: string;
      parts: MultiPolygon[];
      selectedParts?: MultiPolygon[];
    }[] = [];
    for (const fill of [...fills].reverse()) {
      const key = paintKey(fill.shape),
        previous = runs.at(-1);
      if (previous?.key === key) previous.parts.push(fill.polygons);
      else runs.push({ shape: fill.shape, key, parts: [fill.polygons] });
      if (selection?.original.has(fill.shape.id))
        (runs.at(-1)!.selectedParts ??= []).push(fill.polygons);
    }
    const resolved = runs.map((run) => {
      const polygons = run.parts.length === 1 ? run.parts[0] : clipping.union(run.parts.flat());
      const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (const polygon of polygons)
        for (const ring of polygon)
          for (const [x, y] of ring) {
            bounds.left = Math.min(bounds.left, x);
            bounds.right = Math.max(bounds.right, x);
            bounds.top = Math.min(bounds.top, y);
            bounds.bottom = Math.max(bounds.bottom, y);
          }
      return { ...run, polygons, bounds };
    });
    const occluders = boundsIndex(resolved.map((run) => run.bounds));
    for (const [index, run] of resolved.entries()) {
      // Only earlier (higher) runs with overlapping bounds can hide this paint.
      // Actual polygon difference, including holes, remains the final decision.
      const covering = occluders(run.bounds)
        .filter((i) => i < index)
        .sort((a, b) => a - b)
        .flatMap((i) => resolved[i].polygons);
      const visible = covering.length ? clipping.difference(run.polygons, covering) : run.polygons;
      if (!visible.length) continue;
      const existing = regions.get(run.key);
      if (existing) existing.parts.push(visible);
      else regions.set(run.key, { shape: run.shape, parts: [visible] });
      if (run.selectedParts?.length) {
        const selectedPaint =
          run.selectedParts.length === 1
            ? run.selectedParts[0]
            : clipping.union(run.selectedParts.flat());
        const visibleSelected = covering.length
          ? clipping.difference(selectedPaint, covering)
          : selectedPaint;
        if (visibleSelected.length)
          (regions.get(run.key)!.selectedParts ??= []).push(visibleSelected);
      }
    }
    // Resolve each final paint once, after all source-order occlusion is complete.
    // A single MultiPolygon avoids variadic argument limits for many paint runs.
    return [...regions.values()].flatMap(({ shape, parts, selectedParts }) => {
      const polygons = parts.length === 1 ? parts[0] : clipping.union(parts.flat());
      const selectedPolygons = selectedParts?.flat() ?? [];
      const bounds = (polygon: Polygon) => {
        const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const ring of polygon)
          for (const [x, y] of ring) {
            b.left = Math.min(b.left, x);
            b.right = Math.max(b.right, x);
            b.top = Math.min(b.top, y);
            b.bottom = Math.max(b.bottom, y);
          }
        return b;
      };
      const selectedIndex =
        selection && selectedPolygons.length
          ? boundsIndex(selectedPolygons.map(bounds))
          : undefined;
      return polygonVectors(shape, polygons, true).map((s, index) => {
        const result = { ...s, id: id(), drawingMode: 'merge' as const };
        const contributors =
          selectedIndex?.(bounds(polygons[index])).map((i) => selectedPolygons[i]) ?? [];
        if (contributors.length && clipping.intersection([polygons[index]], contributors).length)
          selection?.rebuilt.add(result.id);
        return result;
      });
    });
  }
  if (bucket?.gap) {
    const ends = new Map<string, { point: Point; count: number }>();
    for (const s of segments)
      for (const p of [s.a, s.b]) {
        const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
        const entry = ends.get(key) ?? { point: p, count: 0 };
        entry.count++;
        ends.set(key, entry);
      }
    const loose = [...ends.values()].filter((e) => e.count === 1).map((e) => e.point);
    // A gap-sized spatial grid keeps distant open paths out of the pairing work.
    // Preserve the original nearest-first, source-order tie breaking semantics.
    const cells = new Map<string, number[]>();
    const pairs: { a: number; b: number; distance: number }[] = [];
    for (let b = 0; b < loose.length; b++) {
      const point = loose[b],
        x = Math.floor(point.x / bucket.gap),
        y = Math.floor(point.y / bucket.gap);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          for (const a of cells.get(`${x + dx},${y + dy}`) ?? []) {
            const distance = Math.hypot(loose[a].x - point.x, loose[a].y - point.y);
            if (distance <= bucket.gap) pairs.push({ a, b, distance });
          }
        }
      const key = `${x},${y}`,
        cell = cells.get(key);
      if (cell) cell.push(b);
      else cells.set(key, [b]);
    }
    const used = new Set<number>();
    for (const p of pairs.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b)) {
      if (used.has(p.a) || used.has(p.b)) continue;
      add([loose[p.a], loose[p.b]], input.length, bucket.paint);
      used.add(p.a);
      used.add(p.b);
    }
  }
  // Sweep along the less crowded axis. Only overlapping edge bounds need exact
  // intersection tests; total artwork size is not a reason to reject a stroke.
  const bounds = segments.map((s) => ({
    segment: s,
    dx: s.b.x - s.a.x,
    dy: s.b.y - s.a.y,
    minX: Math.min(s.a.x, s.b.x),
    maxX: Math.max(s.a.x, s.b.x),
    minY: Math.min(s.a.y, s.b.y),
    maxY: Math.max(s.a.y, s.b.y),
  }));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    width = 0,
    height = 0;
  for (const b of bounds) {
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
    width += b.maxX - b.minX;
    height += b.maxY - b.minY;
  }
  const vertical = height / (maxY - minY || 1) < width / (maxX - minX || 1);
  const low = (b: (typeof bounds)[number]) => (vertical ? b.minY : b.minX);
  const high = (b: (typeof bounds)[number]) => (vertical ? b.maxY : b.maxX);
  bounds.sort((a, b) => low(a) - low(b));
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length && low(bounds[j]) <= high(bounds[i]) + EPS; j++) {
      const x = bounds[i],
        y = bounds[j];
      if (
        x.maxX + EPS < y.minX ||
        y.maxX + EPS < x.minX ||
        x.maxY + EPS < y.minY ||
        y.maxY + EPS < x.minY
      )
        continue;
      const a = x.segment,
        b = y.segment;
      const dx = b.a.x - a.a.x,
        dy = b.a.y - a.a.y,
        den = x.dx * y.dy - x.dy * y.dx;
      // The determinant has squared-distance units: comparing it with a
      // document-distance epsilon misclassifies small crossing edges as parallel.
      if (den !== 0) {
        const t = (dx * y.dy - dy * y.dx) / den,
          u = (dx * x.dy - dy * x.dx) / den;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
          a.cuts.push(Math.max(0, Math.min(1, t)));
          b.cuts.push(Math.max(0, Math.min(1, u)));
        }
      } else if (Math.abs(dx * x.dy - dy * x.dx) / Math.hypot(x.dx, x.dy) <= EPS) {
        for (const [target, other] of [
          [a, b],
          [b, a],
        ]) {
          const dir = subtract(target.b, target.a),
            length = dir.x ** 2 + dir.y ** 2;
          for (const p of [other.a, other.b]) {
            const t = ((p.x - target.a.x) * dir.x + (p.y - target.a.y) * dir.y) / length;
            if (t > EPS && t < 1 - EPS) target.cuts.push(t);
          }
        }
      }
    }
  const vertices: Vertex[] = [],
    lookup = new Map<string, number>(),
    edges: Edge[] = [],
    edgeMap = new Map<string, number>();
  const parents = strokeDrop ? input.map((_, i) => i) : [];
  const strokeAtVertex = new Map<number, number>();
  const root = (index: number) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const vertex = (p: Point) => {
    const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length;
      lookup.set(key, index);
      vertices.push({ point: p, outgoing: [] });
    }
    return index;
  };
  for (const s of segments) {
    const cuts = s.cuts.sort((a, b) => a - b);
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const at = (t: number) => vertex({ x: s.a.x + dx * t, y: s.a.y + dy * t });
    let previous = cuts[0], previousVertex = at(previous);
    for (let i = 1; i < cuts.length; i++) {
      const end = cuts[i];
      if (end === previous) continue;
      const start = previous, from = previousVertex, to = at(end);
      // The next interval starts at the vertex this interval just found.
      previous = end;
      previousVertex = to;
      if (from === to) continue;
      if (strokeDrop && s.stroke) {
        for (const point of [from, to]) {
          const other = strokeAtVertex.get(point);
          if (other === undefined) strokeAtVertex.set(point, s.order);
          else parents[root(s.order)] = root(other);
        }
      }
      const curve = s.curve
        ? {
            curve: s.curve.curve,
            start: s.curve.start + (s.curve.end - s.curve.start) * start,
            end: s.curve.start + (s.curve.end - s.curve.start) * end,
          }
        : undefined;
      const reversed = curve
        ? { curve: curve.curve, start: curve.end, end: curve.start }
        : undefined;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`,
        existing = edgeMap.get(key);
      if (existing !== undefined) {
        if (s.stroke && s.order >= edges[existing].order)
          for (const e of [edges[existing], edges[existing + 1]]) {
            e.stroke = s.stroke;
            e.order = s.order;
            e.curve = e.from === from ? curve : reversed;
          }
        continue;
      }
      const index = edges.length;
      edgeMap.set(key, index);
      edges.push(
        {
          from,
          to,
          twin: index + 1,
          next: -1,
          face: -1,
          stroke: s.stroke,
          order: s.stroke ? s.order : -1,
          curve,
        },
        {
          from: to,
          to: from,
          twin: index,
          next: -1,
          face: -1,
          stroke: s.stroke,
          order: s.stroke ? s.order : -1,
          curve: reversed,
        },
      );
      vertices[from].outgoing.push(index);
      vertices[to].outgoing.push(index + 1);
    }
  }
  if (strokeDrop) {
    const moved = new Set<number>(), stationary = new Set<number>();
    input.forEach((s, index) => (strokeDrop.moved.has(s) ? moved : stationary).add(root(index)));
    input.forEach((s, index) => {
      const component = root(index);
      if (moved.has(component) && stationary.has(component)) strokeDrop.replaced.add(s);
    });
    if (!strokeDrop.replaced.size) return [];
  }
  vertices.forEach((v) =>
    v.outgoing.sort((a, b) => {
      const p = vertices[edges[a].to].point,
        q = vertices[edges[b].to].point;
      return (
        Math.atan2(p.y - v.point.y, p.x - v.point.x) - Math.atan2(q.y - v.point.y, q.x - v.point.x)
      );
    }),
  );
  edges.forEach((e) => {
    const out = vertices[e.to].outgoing,
      index = out.indexOf(e.twin);
    e.next = out[(index + out.length - 1) % out.length];
  });
  // Keep each face probe on its own side of every nearby arrangement edge.
  // A fixed normal offset can cross a narrow face and erase or mispaint it.
  const probeEdges = edges
    .filter((_, i) => i % 2 === 0)
    .map((e) => ({
      a: vertices[e.from].point,
      b: vertices[e.to].point,
    }));
  const probeIndex = boundsIndex(
    probeEdges.map(({ a, b }) => ({
      left: Math.min(a.x, b.x),
      right: Math.max(a.x, b.x),
      top: Math.min(a.y, b.y),
      bottom: Math.max(a.y, b.y),
    })),
  );
  const faceSample = (edgeIndex: number): Point | undefined => {
    const edge = edges[edgeIndex],
      a = vertices[edge.from].point,
      b = vertices[edge.to].point;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    const mid = { x: a.x + dx / 2, y: a.y + dy / 2 };
    let offset = Math.min(1e-4, length * 1e-4);
    for (const index of probeIndex(
      { left: mid.x, right: mid.x, top: mid.y, bottom: mid.y },
      offset * 2,
    )) {
      if (index === Math.floor(edgeIndex / 2)) continue;
      const { a: p, b: q } = probeEdges[index];
      const sx = q.x - p.x,
        sy = q.y - p.y,
        size = Math.hypot(sx, sy);
      const ux = sx / size,
        uy = sy / size;
      const along = Math.max(0, Math.min(size, (mid.x - p.x) * ux + (mid.y - p.y) * uy));
      const distance = Math.hypot(mid.x - p.x - along * ux, mid.y - p.y - along * uy);
      offset = Math.min(offset, distance / 4);
    }
    if (!(offset > 0)) return undefined;
    const sample = { x: mid.x - (dy / length) * offset, y: mid.y + (dx / length) * offset };
    const mx = sample.x - mid.x,
      my = sample.y - mid.y;
    // Rounding must not turn a small requested displacement into a jump across
    // a neighboring edge, or leave the sample on/right of its own boundary.
    if (
      Math.hypot(mx, my) > offset * 2 ||
      !((dx / length) * my - (dy / length) * mx > 0) ||
      !((dx / length) * (sample.y - a.y) - (dy / length) * (sample.x - a.x) > 0)
    )
      return undefined;
    return sample;
  };
  // Bounds only prune impossible owners. Resolve actual polygon/hole containment
  // in source order so hierarchy traversal cannot change the topmost paint.
  const fillCandidates = boundsIndex(
    (bucket ? [] : fills).map(({ polygons }) => {
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      for (const polygon of polygons)
        for (const ring of polygon)
          for (const [x, y] of ring) {
            bounds.left = Math.min(bounds.left, x);
            bounds.right = Math.max(bounds.right, x);
            bounds.top = Math.min(bounds.top, y);
            bounds.bottom = Math.max(bounds.bottom, y);
          }
      return bounds;
    }),
  );
  const fillAt = (sample: Point): Fill | undefined => {
    let owner = -1;
    for (const index of fillCandidates({
      left: sample.x,
      right: sample.x,
      top: sample.y,
      bottom: sample.y,
    }))
      if (index > owner && contains(fills[index].polygons, sample)) owner = index;
    return owner < 0 ? undefined : fills[owner];
  };
  const faces: Face[] = [];
  for (let start = 0; start < edges.length; start++) {
    if (edges[start].face !== -1) continue;
    const ring: Point[] = [];
    let current = start;
    do {
      const e = edges[current];
      if (e.face !== -1 && current !== start) throw new Error('Invalid planar arrangement');
      e.face = faces.length;
      ring.push(vertices[e.from].point);
      current = e.next;
    } while (current !== start && ring.length <= edges.length);
    const signedArea = area(ring),
      negligible = Math.abs(signedArea) <= EPS;
    // These faces already contribute neither paint nor holes below. A numerical
    // sliver has no interior ownership to classify; probing it can round back
    // onto its boundary and reject otherwise resolvable surrounding artwork.
    // Keep its edges for stroke traversal and retain strict probes for every
    // face that can actually contribute paint or hole membership.
    let sample: Point | undefined = negligible ? ring[0] : undefined;
    if (!negligible) {
      // A face can have an almost coincident edge beside an ordinary interior.
      // The arbitrary first half-edge need not provide its best interior probe.
      let probe = start;
      do {
        sample = faceSample(probe);
        if (sample) break;
        probe = edges[probe].next;
      } while (probe !== start);
      if (!sample) throw new NarrowArrangementFaceError();
    }
    const fill = negligible
      ? undefined
      : bucket
        ? { shape: bucket.paint, polygons: [] }
        : fillAt(sample!);
    faces.push({ ring, area: signedArea, sample: sample!, fill, holes: [], parent: -1 });
  }
  const facePaintKeys = faces.map((f) => f.fill && paintKey(f.fill.shape));
  const parentCandidates = boundsIndex(
    faces.map((f) => {
      const b = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      if (f.area > EPS && f.fill)
        for (const p of f.ring) {
          b.left = Math.min(b.left, p.x);
          b.right = Math.max(b.right, p.x);
          b.top = Math.min(b.top, p.y);
          b.bottom = Math.max(b.bottom, p.y);
        }
      return b;
    }),
  );
  faces.forEach((f, i) => {
    if (f.area > EPS) f.parent = i;
    else if (f.area < -EPS && f.fill) {
      let parent = -1;
      for (const j of parentCandidates({
        left: f.sample.x,
        right: f.sample.x,
        top: f.sample.y,
        bottom: f.sample.y,
      })) {
        const p = faces[j];
        // Preserve the former stable area sort, including its source-index tie.
        if (
          facePaintKeys[j] === facePaintKeys[i] &&
          (parent < 0 ||
            p.area < faces[parent].area ||
            (p.area === faces[parent].area && j < parent)) &&
          containsPoint(p.ring, f.sample)
        )
          parent = j;
      }
      if (parent >= 0) {
        f.parent = parent;
        faces[parent].holes.push(f.ring);
      }
    }
  });
  if (!bucket && strokeCovers.length) {
    const candidates = boundsIndex(strokeCovers.map(({ fill }) => mergeControlBounds(fill.shape)));
    for (let i = 0; i < edges.length; i += 2) {
      const edge = edges[i], stroke = edge.stroke;
      if (!stroke || stroke.drawingMode === 'object') continue;
      const a = vertices[edge.from].point, b = vertices[edge.to].point;
      const p = { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 };
      if (candidates({ left: p.x, right: p.x, top: p.y, bottom: p.y }).some(index => {
        const { fill, order } = strokeCovers[index];
        return order > edge.order &&
          JSON.stringify(fill.shape.groups ?? []) === JSON.stringify(stroke.groups ?? []) &&
          coversStrokeInterior(fill.polygons, p);
      })) {
        edge.stroke = undefined;
        edges[edge.twin].stroke = undefined;
      }
    }
  }
  const groups = faces.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (groups[root] !== root) root = groups[root];
    // Compress without consuming the JS call stack on long connected chains.
    while (groups[i] !== i) {
      const next = groups[i];
      groups[i] = root;
      i = next;
    }
    return root;
  };
  for (let i = 0; i < edges.length; i += 2) {
    const e = edges[i],
      a = faces[e.face].parent,
      b = faces[edges[e.twin].face].parent;
    if (
      !e.stroke &&
      a >= 0 &&
      b >= 0 &&
      faces[a].fill &&
      faces[b].fill &&
      paintKey(faces[a].fill!.shape) === paintKey(faces[b].fill!.shape)
    )
      groups[find(a)] = find(b);
  }
  const grouped = new Map<number, { shape: Vector; polygons: Polygon[]; selected: boolean }>();
  faces.forEach((f, i) => {
    if (f.area <= EPS || !f.fill) return;
    const key = find(i),
      entry = grouped.get(key) ?? { shape: f.fill.shape, polygons: [], selected: false };
    entry.selected ||= selection?.original.has(f.fill.shape.id) ?? false;
    entry.polygons.push([coordinates(f.ring), ...f.holes.map(coordinates)]);
    grouped.set(key, entry);
  });
  const result: Vector[] = [];
  for (const { shape, polygons, selected } of grouped.values()) {
    // A Bucket click cannot select a group outside all of its exterior bounds.
    // Pad for outward rounding by the integer fallback; final containment remains exact
    // for the normalized polygon/hole output.
    if (
      bucket &&
      !polygons.some(([outer]) => {
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (const [x, y] of outer) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
        return (
          bucket.point.x >= left - PAINT_GRID_STEP &&
          bucket.point.x <= right + PAINT_GRID_STEP &&
          bucket.point.y >= top - PAINT_GRID_STEP &&
          bucket.point.y <= bottom + PAINT_GRID_STEP
        );
      })
    )
      continue;
    // Pass the face collection as one MultiPolygon, avoiding the engine's
    // function-argument limit without capping or chunking connected artwork.
    for (const polygon of clipping.union(polygons)) {
      const [v] = polygonVectors(shape, [polygon], true);
      v.id = id();
      v.drawingMode = 'merge';
      if (selected) selection?.rebuilt.add(v.id);
      result.push(v);
    }
  }
  const used = new Set<number>();
  if (bucket) {
    const faces = result.filter(s => contains(vectorPolygons(s), bucket.point));
    return faces.length && input.some(s => hasRestorableFillCurves(s) || s.kind === 'bezier' && s.strokeWidth)
      ? restoreBucketCurves(faces,input) : faces;
  }
  const sameStrokeBasis = (a: Vector, b: Vector) => {
    const left = matrix(a), right = matrix(b);
    return strokeDrop
      ? left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3]
      : JSON.stringify(left) === JSON.stringify(right);
  };
  const compatible = (a: Vector, b: Vector) =>
    a.stroke === b.stroke &&
    a.strokeWidth === b.strokeWidth &&
    (a.opacity ?? 1) === (b.opacity ?? 1) &&
    (a.paintBrightness ?? 0) === (b.paintBrightness ?? 0) &&
    (strokeDrop ? (a.strokeCap ?? 'round') === (b.strokeCap ?? 'round') : a.strokeCap === b.strokeCap) &&
    (strokeDrop ? (a.strokeJoin ?? 'round') === (b.strokeJoin ?? 'round') : a.strokeJoin === b.strokeJoin) &&
    sameStrokeBasis(a, b);
  for (let start = 0; start < edges.length; start += 2) {
    if (used.has(start) || !edges[start].stroke) continue;
    if (strokeDrop && !strokeDrop.replaced.has(edges[start].stroke!)) continue;
    let eIndex = start;
    const s = edges[start].stroke!;
    // Walk backwards to a junction when possible, then forward to form one selectable stroke span.
    const backwardSeen = new Set<number>();
    while (!backwardSeen.has(eIndex)) {
      backwardSeen.add(eIndex);
      const e = edges[eIndex],
        out = vertices[e.from].outgoing;
      if (out.length !== 2) break;
      const previous = out.find((i) => i !== eIndex);
      if (
        previous === undefined ||
        !edges[previous].stroke ||
        !compatible(s, edges[previous].stroke!)
      )
        break;
      eIndex = edges[previous].twin;
    }
    const points: Point[] = [vertices[edges[eIndex].from].point];
    const walked: { a: Point; b: Point; curve?: CurveTrace }[] = [];
    let selectedStroke = false;
    while (true) {
      const e = edges[eIndex],
        key = eIndex - (eIndex % 2);
      if (used.has(key)) break;
      used.add(key);
      selectedStroke ||= !!e.stroke && (selection?.original.has(e.stroke.id) ?? false);
      walked.push({ a: vertices[e.from].point, b: vertices[e.to].point, curve: e.curve });
      points.push(vertices[e.to].point);
      const out = vertices[e.to].outgoing;
      if (out.length !== 2) break;
      const next = out.find((i) => i !== e.twin);
      if (next === undefined || !edges[next].stroke || !compatible(s, edges[next].stroke!)) break;
      eIndex = next;
    }
    if (points.length > 1) {
      const v: Vector = {
        ...s,
        id: id(),
        kind: 'path',
        points: points.map((p) => inversePoint(matrix(s), p)),
        nodes: undefined,
        contours: undefined,
        closed: Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < EPS,
        fillEnabled: false,
        drawingMode: 'merge',
      };
      const nodes = walked.some((e) => e.curve)
        ? mergedStrokeNodes(walked, s, v.closed ?? false)
        : undefined;
      if (nodes) {
        v.kind = 'bezier';
        v.points = [];
        v.nodes = nodes;
      }
      normalizeVector(v);
      if (selectedStroke) selection?.rebuilt.add(v.id);
      result.push(v);
    }
  }
  return result;
}
