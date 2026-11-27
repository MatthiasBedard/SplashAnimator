import floating, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import ClipperLib from 'clipper-lib';
import { boundsIndex } from './bounds-index';
import { joinNonzeroPaintSeam, paintCoordinateUnits, separatedNonzeroPaint } from './paint-winding';

type Geometry = Polygon | MultiPolygon;
// A selection runs synchronously inside its own cancellable geometry worker.
// Charge independent retries for input edges and a conservative upper bound
// on their intersections. Never increase the floating kernel's sweep limit.
let selectionDepth = 0;
let remainingSelectionWork = 0;
const segmentLimit =
  'Infinite loop when passing sweep line over endpoints (too many sweep line segments).';
function sweepStackFailure(error: unknown): boolean {
  return error instanceof RangeError && /Maximum call stack size exceeded/i.test(error.message) &&
    /\b(?:beforeState|afterState|prevInResult)\b/.test(error.stack ?? '');
}
export function boundedSelectionFault(error: unknown): boolean {
  return error instanceof Error && (error.message === segmentLimit || (selectionDepth > 0 && sweepStackFailure(error)));
}
export function withSelectionClipping<T>(select: () => T): T {
  const previous = remainingSelectionWork;
  selectionDepth++;
  remainingSelectionWork = 1_000_000;
  try {
    return select();
  } catch (error) {
    if (boundedSelectionFault(error))
      throw Error(
        'This paint selection has too many intersecting edges to resolve safely. Try a smaller region.',
      );
    throw error;
  } finally {
    remainingSelectionWork = previous;
    selectionDepth--;
  }
}
function admitSelectionRetry(error: unknown, operands: Geometry[]): boolean {
  if (!remainingSelectionWork || !boundedSelectionFault(error))
    return false;
  let edges = 0;
  for (const operand of operands)
    for (const polygon of polygons(operand)) for (const ring of polygon) edges += ring.length;
  if (!edges || edges > remainingSelectionWork) return false;
  let cost = edges + (edges * (edges - 1)) / 2;
  // Large sparse paths can have many edges but few possible intersections.
  // Count overlapping projections without enumerating the pairs.
  for (const axis of [0, 1]) {
    if (cost <= remainingSelectionWork) break;
    const starts: number[] = [],
      ends: number[] = [];
    for (const operand of operands)
      for (const polygon of polygons(operand))
        for (const ring of polygon) {
          let previous = ring.at(-1);
          for (const point of ring) {
            const a = previous![axis],
              b = point[axis];
            if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
            starts.push(Math.min(a, b));
            ends.push(Math.max(a, b));
            previous = point;
          }
        }
    starts.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    let retired = 0,
      bound = edges;
    for (let i = 0; i < starts.length && bound <= remainingSelectionWork; i++) {
      while (ends[retired] < starts[i]) retired++;
      bound += i - retired;
    }
    cost = Math.min(cost, bound);
  }
  if (cost > remainingSelectionWork) return false;
  remainingSelectionWork -= cost;
  return true;
}
// A fixed subpixel grid prevents nearly coincident tangent edges from corrupting
// floating sweep ordering. This is much finer than our 0.25-unit curve flattening.
const SCALE = 4096;
export const PAINT_GRID_STEP = 1 / SCALE;
function polygons(g: Geometry): MultiPolygon {
  if (!g.length) return [];
  return typeof g[0]?.[0]?.[0] === 'number' ? [g as Polygon] : (g as MultiPolygon);
}
// Use the spare precision of a local 25-bit grid on dense selections, where
// adjacent curve samples can be much closer than one ordinary clipping step.
function localContourGrid(first: Geometry, rest: Geometry[]) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const operand of [first, ...rest])
    for (const polygon of polygons(operand))
      for (const ring of polygon)
        for (const [x, y] of ring) {
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            Math.max(Math.abs(x), Math.abs(y)) * SCALE > 2 ** 50
          )
            throw Error('Paint coordinates exceed the supported precision range.');
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
  const span = Math.max(right - left, bottom - top);
  const scale = span > 0 ? 2 ** Math.min(1023, 25 - Math.ceil(Math.log2(span))) : SCALE;
  return { scale, left, top, span };
}
function retrySelectionContours(
  operation: 'union' | 'difference' | 'intersection',
  first: Geometry,
  rest: Geometry[],
  failure: unknown,
  parity = false,
): MultiPolygon {
  const { scale, left, top } = localContourGrid(first, rest);
  try {
    return scale > SCALE
      ? integerContours(operation, first, rest, !parity, scale, left, top, parity)
      : integerContours(operation, first, rest, !parity, SCALE, 0, 0, parity);
  } catch (error) {
    if (parity || !(error instanceof CollapsedPaintContour) || !admitSelectionRetry(failure, [first, ...rest]))
      throw error;
    return rotatedPaint(operation, first, rest, error);
  }
}
export function integerPaint(
  operation: 'union' | 'difference',
  first: Geometry,
  ...rest: Geometry[]
): MultiPolygon {
  return normalizedContours(operation, first, rest);
}

/** Brush dab batches are unions of exterior rings under nonzero winding. */
export function integerBrushDabUnion(dabs: MultiPolygon): MultiPolygon {
  return normalizedContours('union', dabs, [], true, true);
}

function sameBrushBatch(first: MultiPolygon, second: MultiPolygon) {
  return first.length === second.length && first.every((outline, index) => {
    const other = second[index];
    return outline.length === 1 && other.length === 1 && outline[0].length === other[0].length &&
      outline[0].every(([x, y], point) =>
        Object.is(x, other[0][point][0]) && Object.is(y, other[0][point][1]));
  });
}

export function integerBrushSweepUnion(dabs: MultiPolygon): MultiPolygon {
  // Bound each local scan to 64 outlines. Keep repeated results in the
  // final input sequence because removing one can change integer intersections.
  const memo = selectionDepth ? undefined : new Map<number, { input: MultiPolygon; output: MultiPolygon }>();
  const chunks: MultiPolygon = [];
  for (let start = 0; start < dabs.length; start += 64) {
    const input = dabs.slice(start, start + 64);
    const firstX = input[0]?.[0]?.[0]?.[0];
    const previous = firstX === undefined ? undefined : memo?.get(firstX);
    if (previous && sameBrushBatch(input, previous.input)) {
      chunks.push(...previous.output);
      continue;
    }
    const output = integerBrushDabUnion(input);
    if (firstX !== undefined) memo?.set(firstX, { input, output });
    chunks.push(...output);
  }
  return integerPaint('union', chunks);
}

/** Resolve authored nonzero contours without reinterpreting later rings as holes. */
export function nonzeroPaint(rings: Polygon): MultiPolygon {
  if (rings.length <= 1) return resolve('union', rings);
  const bounds = rings.map((ring) => {
    const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const [x, y] of ring) {
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
    }
    return box;
  });
  const query = boundsIndex(bounds),
    parents = rings.map((_, i) => i);
  const root = (index: number): number => {
    let result = index;
    while (parents[result] !== result) result = parents[result];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = result;
      index = next;
    }
    return result;
  };
  for (let i = 0; i < rings.length; i++)
    // Keep groups separated even after either kernel's integer fallback rounds.
    for (const j of query(bounds[i], 2 * PAINT_GRID_STEP)) if (j < i) parents[root(i)] = root(j);
  const groups = new Map<number, Polygon>();
  rings.forEach((ring, i) => {
    const key = root(i),
      group = groups.get(key) ?? [];
    group.push(ring);
    groups.set(key, group);
  });
  // A lone ring already has floating-kernel nonzero winding. Only interacting
  // ring bounds need cross-ring winding resolution on the integer grid.
  const result: MultiPolygon = [];
  for (const group of groups.values()) {
    let paint: MultiPolygon;
    try {
      paint = group.length === 1 ? resolve('union', group) :
        selectionDepth ? normalizedContours('union', group, [], false) : integerContours('union', group, [], false);
    } catch (error) {
      if (!selectionDepth || group.length < 2 || !(error instanceof CollapsedPaintContour)) throw error;
      const recovered = recoverNonzeroSelection(group);
      if (!recovered) throw error;
      paint = recovered;
    }
    for (const polygon of paint) result.push(polygon);
  }
  return result;
}
function recoverNonzeroSelection(source: Polygon): MultiPolygon | undefined {
  const pending = source.slice();
  for (;;) {
    const edges = pending.reduce((count, ring) => count + ring.length, 0);
    const cost = edges + edges * (edges - 1) / 2 + pending.length * edges;
    if (cost > remainingSelectionWork) return;
    remainingSelectionWork -= cost;
    const separated = separatedNonzeroPaint(pending);
    if (separated) return separated;

    // Recheck the entire group after each exact cancellation. A local seam
    // proof alone says nothing about the other authored boundary rings.
    const seam = findSelectionSeam(pending);
    if (!seam) return;
    if (pending.length === 2) return seam.joined;
    pending[seam.first] = seam.joined[0][0];
    pending.splice(seam.second, 1);
  }
}
function findSelectionSeam(rings: Polygon) {
  for (let first = 0; first < rings.length; first++)
    for (let second = first + 1; second < rings.length; second++) {
      // Pay for both the edge search and the complete stitched-boundary proof.
      const edges = rings[first].length + rings[second].length + 2;
      const cost = edges * edges + 2 * edges;
      if (cost > remainingSelectionWork) return;
      remainingSelectionWork -= cost;
      const joined = joinNonzeroPaintSeam(rings[first], rings[second]);
      if (joined) return { first, second, joined };
    }
}
export class UnresolvedPaintContour extends Error {}
class CollapsedPaintContour extends UnresolvedPaintContour {}
export class CollapsedIntersectionContour extends CollapsedPaintContour {}

// Only used after Clipper rejects a ring. Test the original binary64 values
// exactly: rounding a thin triangle or a self-crossing ring to zero area
// cannot prove that it contributes no paint.
function collinearRing(ring: Polygon[number]): boolean {
  const [ax, ay] = ring[0];
  const end = ring.find(([x, y]) => x !== ax || y !== ay);
  if (!end) return true;
  if (end[0] === ax) return ring.every(([x]) => x === ax);
  if (end[1] === ay) return ring.every(([, y]) => y === ay);
  const units = paintCoordinateUnits;
  const x0 = units(ax), y0 = units(ay);
  const dx = units(end[0]) - x0, dy = units(end[1]) - y0;
  return ring.every(([x, y]) => (units(x) - x0) * dy === (units(y) - y0) * dx);
}

// Cancel exact out-and-back edges in original coordinates. A fully retraced
// boundary encloses no paint even when it turns corners or branches.
function fullyRetracedRing(ring: Polygon[number]): boolean {
  const path: Polygon[number] = [];
  const visit = (point: Polygon[number][number]) => {
    const last = path.at(-1), previous = path.at(-2);
    if (last && last[0] === point[0] && last[1] === point[1]) return;
    if (previous && previous[0] === point[0] && previous[1] === point[1]) path.pop();
    else path.push(point);
  };
  for (const point of ring) visit(point);
  visit(ring[0]);
  return path.length === 1;
}

function integerContours(
  operation: 'union' | 'difference' | 'intersection',
  first: Geometry,
  rest: Geometry[],
  normalizeWinding: boolean,
  scale = SCALE,
  originX = 0,
  originY = 0,
  evenOdd = false,
  reuseBrushDabs = false,
): MultiPolygon {
  const clipper = new ClipperLib.Clipper();
  const submittedDabs = reuseBrushDabs ? new Map<number, ClipperLib.Paths>() : undefined;
  let subjectPaths = 0, clipPaths = 0;
  const add = (g: Geometry, kind: ClipperLib.PolyType) => {
    for (const polygon of polygons(g)) {
      polygon.forEach((ring, index) => {
        const path = ring.map(([x, y]) => {
          const X = Math.round((x - originX) * scale),
            Y = Math.round((y - originY) * scale);
          if (
            !Number.isSafeInteger(X) ||
            !Number.isSafeInteger(Y) ||
            Math.max(Math.abs(X), Math.abs(Y)) > 2 ** 50
          )
            throw new Error('Paint coordinates exceed the supported precision range.');
          return { X, Y };
        });
        if (path.length < 3) return;
        // PolyTree preserves holes and nested islands; normalize exterior and
        // hole winding independently of reflection or incoming ring orientation.
        if (normalizeWinding && ClipperLib.Clipper.Orientation(path) !== (index === 0))
          path.reverse();
        // Every coordinate has already passed grid and range validation. Only
        // reuse a complete, same-winding path previously admitted by Clipper.
        const recorded = polygon.length === 1 ? submittedDabs : undefined;
        const previous = recorded?.get(path[0].X);
        if (previous?.some(dab => dab.length === path.length &&
          dab.every((point, i) => point.X === path[i].X && point.Y === path[i].Y))) return;
        if (!clipper.AddPath(path, kind, true)) {
          // An exactly collinear hole or standalone ring has no painted area.
          // A rejected exterior with holes needs whole-polygon validation.
          if (selectionDepth && (index > 0 || polygon.length === 1) &&
              (collinearRing(ring) || fullyRetracedRing(ring))) return;
          if (operation === 'intersection')
            throw new CollapsedIntersectionContour('Intersection paint contour collapses at the supported precision.');
          if (!normalizeWinding)
            throw new CollapsedPaintContour('Nonzero paint contour collapses at the supported precision.');
          if (collinearRing(ring)) throw new UnresolvedPaintContour('Paint contour collapses at the supported precision.');
          throw new CollapsedPaintContour('Paint contour collapses at the supported precision.');
        }
        if (previous) previous.push(path);
        else recorded?.set(path[0].X, [path]);
        if (kind === ClipperLib.PolyType.ptSubject) subjectPaths++;
        else clipPaths++;
      });
    }
  };
  add(first, ClipperLib.PolyType.ptSubject);
  for (const g of rest)
    add(g, operation === 'union' ? ClipperLib.PolyType.ptSubject : ClipperLib.PolyType.ptClip);
  if (selectionDepth && (!subjectPaths || (operation === 'intersection' && !clipPaths))) return [];
  if (operation === 'intersection' && (!first.length || !rest[0]?.length)) return [];
  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    operation === 'union'
      ? ClipperLib.ClipType.ctUnion
      : operation === 'difference'
        ? ClipperLib.ClipType.ctDifference
        : ClipperLib.ClipType.ctIntersection,
    tree,
    evenOdd ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) {
    if (![first, ...rest].some((g) => g.length)) return [];
    throw new Error('Unable to resolve paint contours.');
  }
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map((p) =>
    [p.outer, ...p.holes].map((path) => {
      const ring = path.map(({ X, Y }) => [originX + X / scale, originY + Y / scale] as [number, number]);
      if (ring.length) ring.push([...ring[0]]);
      return ring;
    }),
  );
}
// Recover known sweep-order faults, including failed event-queue removal. The
// vendor's resource-limit errors are not topology faults and must still reject.
function topologyFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    !/queue size too big|too many sweep line segments/i.test(error.message) &&
    (/^Unable to pop\(\) (?:left|right) SweepEvent \[[^\]]+\] from segment #\d+ \[[^\]]+\] -> \[[^\]]+\] from queue\.$/.test(
      error.message,
    ) ||
      /SweepLine|sweep line|Unable to find segment|Unable to complete output ring/i.test(
        error.message,
      ) ||
      (error instanceof TypeError && error.message === "Cannot read properties of null (reading 'length')" &&
        /\b(?:afterState|consume)\b/.test(error.stack ?? '')) ||
      (error instanceof RangeError &&
        /Maximum call stack size exceeded/i.test(error.message) &&
        /(?:enclosingRing|isExteriorRing)/.test(error.stack ?? '')))
  );
}
/** Index nonadjacent edges and test contact/crossing before expanding a ring.
 * A triangle fan modulo two preserves parity even when winding magnitude exceeds one. */
function parityParts(polygon: Polygon): Polygon[] {
  const result: Polygon[] = [];
  for (const original of polygon) {
    const source = original.filter(
      (p, i) => i === 0 || p[0] !== original[i - 1][0] || p[1] !== original[i - 1][1],
    );
    const ring =
      source.length > 1 &&
      source[0][0] === source[source.length - 1][0] &&
      source[0][1] === source[source.length - 1][1]
        ? source.slice(0, -1)
        : source;
    const bounds = ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length];
      return {
        left: Math.min(p[0], q[0]),
        right: Math.max(p[0], q[0]),
        top: Math.min(p[1], q[1]),
        bottom: Math.max(p[1], q[1]),
      };
    });
    const query = boundsIndex(bounds);
    const turn = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const opposite = (a: number, b: number) => a === 0 || b === 0 || a < 0 !== b < 0;
    const mayCross = bounds.some((box, i) =>
      query(box).some((j) => {
        if (j <= i + 1 || (i === 0 && j === ring.length - 1)) return false;
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          c = ring[j],
          d = ring[(j + 1) % ring.length];
        return opposite(turn(a, b, c), turn(a, b, d)) && opposite(turn(c, d, a), turn(c, d, b));
      }),
    );
    if (!mayCross) {
      result.push([source]);
      continue;
    }
    for (let i = 1; i + 1 < ring.length; i++) {
      const a = ring[0],
        b = ring[i],
        c = ring[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross !== 0) result.push([[a, b, c, a]]);
    }
  }
  return result;
}
/** XOR of independent ring polygons, with bounded argument batches. Retain the
 * established difference/union parity path for recognized floating-kernel faults. */
export function evenOddPaint(rings: Polygon[]): MultiPolygon {
  const parts = rings.flatMap(parityParts);
  let result: MultiPolygon = [];
  try {
    // Reduce bounded batches as a tree so distant rings do not repeatedly enter
    // a growing accumulator. XOR remains the final polygon/hole operation.
    let level: Geometry[] = parts;
    while (level.length) {
      const next: MultiPolygon[] = [];
      for (let start = 0; start < level.length; start += 128)
        next.push(floating.xor(level[start], ...level.slice(start + 1, start + 128)));
      if (next.length === 1) return next[0];
      level = next;
    }
    return [];
  } catch (error) {
    if (admitSelectionRetry(error, rings))
      return retrySelectionContours('union', rings, [], error, true);
    if (boundedSelectionFault(error)) throw error;
    if (!topologyFailure(error)) throw error;
    result = [];
    for (const ring of parts)
      result = resolve(
        'union',
        resolve('difference', result, ring),
        resolve('difference', ring, result),
      );
    return result;
  }
}
function resolve(
  operation: 'union' | 'difference',
  first: Geometry,
  ...rest: Geometry[]
): MultiPolygon {
  try {
    return floating[operation](first, ...rest);
  } catch (error) {
    // Retry topology failures only; validation and unrelated failures remain errors.
    if (admitSelectionRetry(error, [first, ...rest])) return retrySelectionContours(operation, first, rest, error);
    if (boundedSelectionFault(error)) throw error;
    if (!topologyFailure(error)) throw error;
    return integerPaint(operation, first, ...rest);
  }
}
/** Binary intersection: the clip side is one complete polygon/hole set. */
export function intersectPaint(first: Geometry, second: Geometry): MultiPolygon {
  try {
    return floating.intersection(first, second);
  } catch (error) {
    if (admitSelectionRetry(error, [first, second])) return retrySelectionContours('intersection', first, [second], error);
    if (boundedSelectionFault(error)) throw error;
    if (!topologyFailure(error)) throw error;
    return normalizedContours('intersection', first, [second]);
  }
}

function normalizedContours(
  operation: 'union' | 'difference' | 'intersection',
  first: Geometry,
  rest: Geometry[],
  normalizeWinding = true,
  reuseBrushDabs = false,
): MultiPolygon {
  try {
    return integerContours(operation, first, rest, normalizeWinding, SCALE, 0, 0, false,
      reuseBrushDabs && !selectionDepth);
  } catch (cause) {
    if (!(cause instanceof CollapsedPaintContour)) throw cause;
    // Anchor the finer grid at the operand bounds. Keep local coordinates within
    // 25 bits so products of edge differences stay exact JS integers.
    const {scale,left,top,span}=localContourGrid(first,rest);
    if (!span) throw cause;
    if (scale > SCALE) {
      try {
        return integerContours(operation, first, rest, normalizeWinding, scale, left, top);
      } catch (fineError) {
        if (!(fineError instanceof CollapsedPaintContour)) throw fineError;
      }
    }
    if (!normalizeWinding) throw cause;
    return rotatedPaint(operation, first, rest, cause);
  }
}

function rotatedPaint(operation: 'union' | 'difference' | 'intersection', first: Geometry, rest: Geometry[], cause: Error) {
  // Extremely thin artwork may still require floating coordinates. Rotate
  // the sweep direction exactly (swap and negate, with no rounding).
  const rotate = (g: Geometry, inverse = false): MultiPolygon => polygons(g).map(polygon =>
    polygon.map(ring => ring.map(([x, y]) => inverse ? [y, -x] : [-y, x])));
  try {
    const rotated = rest.map(operand => rotate(operand));
    return rotate(floating[operation](rotate(first), ...rotated), true);
  } catch (rotatedError) {
    if (!topologyFailure(rotatedError)) throw rotatedError;
    throw cause;
  }
}

export default {
  intersection: intersectPaint,
  union: (first: Geometry, ...rest: Geometry[]) => resolve('union', first, ...rest),
  difference: (first: Geometry, ...rest: Geometry[]) => resolve('difference', first, ...rest),
};
