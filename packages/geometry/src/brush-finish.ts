import type { Point, Vector } from '@splash/document';
import { mapPoint, matrix } from './affine';
import { containsPoint, worldPaths } from './drawing';
import { PATH_SIMPLIFICATION_WORK_LIMIT, preparePathSimplification } from './path-edit';
import { prepareSmallerBrushContourFit } from './contour-fit';
import { CURVE_FIT_WORK_LIMIT } from './curve-fit';
import { STANDARD_COMPOUND_SAMPLE_LIMIT } from './compound-fit';

export type BrushFinish = { brush: Vector; amount: number };
const bounds = (paths: readonly (readonly Point[])[]) => {
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const path of paths) for (const p of path) {
    box.left = Math.min(box.left, p.x);
    box.right = Math.max(box.right, p.x);
    box.top = Math.min(box.top, p.y);
    box.bottom = Math.max(box.bottom, p.y);
  }
  return box;
};
const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>, margin = 0) =>
  a.left <= b.right + margin &&
  b.left <= a.right + margin &&
  a.top <= b.bottom + margin &&
  b.top <= a.bottom + margin;

function hasRepeatedVertex(ring: Point[]) {
  const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  let end = ring.length;
  while (end > 1 && samePoint(ring[0], ring[end - 1])) end--;
  const seen = new Set<string>();
  for (let i = 0; i < end; i++) {
    const point = ring[i];
    if (i && samePoint(point, ring[i - 1])) continue;
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
function boundariesNear(a: Vector, b: Vector, margin: number) {
  const edges = (s: Vector) =>
    worldPaths(s, 0.25).flatMap((r) => r.slice(1).map((p, i) => [r[i], p] as const));
  const first = edges(a),
    second = edges(b);
  let work = 0;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const [a, b] of first)
    for (const [c, d] of second) {
      if (++work > 200000) return true;
      const dx = Math.max(
        Math.min(a.x, b.x) - Math.max(c.x, d.x),
        Math.min(c.x, d.x) - Math.max(a.x, b.x),
      );
      const dy = Math.max(
        Math.min(a.y, b.y) - Math.max(c.y, d.y),
        Math.min(c.y, d.y) - Math.max(a.y, b.y),
      );
      if (dx > margin || dy > margin) continue;
      if (
        dx <= 0 &&
        dy <= 0 &&
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0
      )
        return true;
      if (
        Math.min(
          distanceToSegment(a, c, d),
          distanceToSegment(b, c, d),
          distanceToSegment(c, a, b),
          distanceToSegment(d, a, b),
        ) <= margin
      )
        return true;
    }
  return false;
}

/** Fit a prepared paint footprint, not the nib's input samples. Brush commits
 * call this on the new stroke alone, before clipping and merging with old paint.
 * Dense nib polygons
 * need no artificial source-edge clearance: the fitter still rejects source
 * intersections, non-monotone spans, crossing cubic hulls and changed nesting.
 * Nearby bounds trigger a bounded edge-distance check, not automatic rejection.
 * Never independently round a boundary shared with another paint region.
 * A rejected/budget-limited fit leaves that complete compound unchanged.
 */
export function finishBrushPaint(shapes: Vector[], finish: BrushFinish): Vector[] {
  return prepareBrushFinisher(finish)(shapes);
}

/** Every candidate for one release belongs to the same smoothed input. */
export function prepareBrushFinisher(
  finish: BrushFinish, sample: () => readonly (readonly Point[])[] = () => worldPaths(finish.brush),
): (shapes: Vector[]) => Vector[] {
  let area: ReturnType<typeof bounds> | undefined;
  const inputBounds = () => (area ??= bounds(sample()));
  return shapes => finishBrushCandidate(shapes, finish, inputBounds);
}

function finishBrushCandidate(
  shapes: Vector[],
  finish: BrushFinish,
  inputBounds: () => ReturnType<typeof bounds>,
): Vector[] {
  const amount = Math.max(0, Math.min(10, finish.amount));
  if (!Number.isFinite(amount) || !amount || shapes.length > 512) return shapes;
  // The old fixed two-unit cap barely affected a broad nib. Scale the finish
  // allowance with brush size, while bounding movement in document space.
  const maximum = Math.min(8, Math.max(2, Math.abs(finish.brush.strokeWidth) * 0.12));
  const level = amount <= 1 ? Math.max(1, Math.ceil(amount * 20)) : 20 + Math.ceil((amount - 1) * 2);
  const allowanceAt = (step: number) => 0.05 + maximum * (step <= 20 ? step / 20 : 1 + (step - 20) / 2);
  const tolerance = allowanceAt(level);
  const area = inputBounds(),
    boxes = shapes.map(shape => bounds(worldPaths(shape)));
  let remaining = CURVE_FIT_WORK_LIMIT;
  let simplificationWork = PATH_SIMPLIFICATION_WORK_LIMIT;
  const charge = (work: number) => {
    simplificationWork -= work;
    if (simplificationWork < 0) throw Error('Brush path simplification work limit reached.');
  };
  return shapes.map((s, i) => {
    if (
      s.kind !== 'polygon' ||
      s.fill !== finish.brush.fill ||
      s.strokeWidth ||
      s.gradient ||
      s.bitmap ||
      !s.contours?.length ||
      s.contours.some((r) => r.some((n) => n.in || n.out)) ||
      !overlaps(area, boxes[i]) ||
      boxes.some(
        (b, j) =>
          i !== j &&
          overlaps(boxes[i], b, tolerance * 2 + 0.5) &&
          boundariesNear(s, shapes[j], tolerance * 2 + 0.5),
      )
    )
      return s;
    const count = s.contours.reduce((n, r) => n + r.length, 0);
    if (count > remaining || simplificationWork < 0) return s;
    remaining -= count;
    if (s.contours.some(ring => ring.length < 3)) return s;
    let best = s,
      bestCount = count;
    const source = s.contours;
    const basis = matrix(s);
    // The standard fitter receives the reduced rings. For a dense source,
    // also certify the result against the original rings before publishing.
    const originalPaths = count > STANDARD_COMPOUND_SAMPLE_LIMIT
      ? source.map(ring => ring.map(p => mapPoint(basis, p))) : undefined;
    // The existing dense proof rejects a source edge touching a
    // nonadjacent edge. No fitted candidate can change this source fact.
    if (shapes.length === 1 && originalPaths?.some(hasRepeatedVertex)) return s;
    const halves = source.map((ring) => {
      const half = Math.floor(ring.length / 2);
      return [ring.slice(0, half + 1), [...ring.slice(half), ring[0]]]
        .map(points => preparePathSimplification(points, basis, charge));
    });
    const winding = (ring: Point[]) =>
      Math.sign(
        ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return sum + (p.x - ring[0].x) * (q.y - ring[0].y) - (q.x - ring[0].x) * (p.y - ring[0].y);
        }, 0),
      );
    const sourceWinding = source.map(winding);
    // Consider the same cumulative levels as the slider increases. A rejected
    // stronger fit must not replace an accepted simpler contour with more nodes.
    for (let step = 1; step <= level && simplificationWork >= 0; step++) {
      const allowance = allowanceAt(step);
      try {
        const rings = halves.map((ring, index) => {
          const reduced = ring.flatMap(simplify => simplify(allowance / 2).slice(0, -1));
          // A tiny hole or island can simplify down to its chord. Keep that
          // ring intact so it does not veto fitting the rest of the stroke.
          return reduced.length < 3 ? source[index] : reduced;
        });
        if (
          rings.some(
            (r, i) =>
              winding(r) !== sourceWinding[i] ||
              (!originalPaths && rings.some(
                (other, j) =>
                  i !== j &&
                  containsPoint(source[j], source[i][0]) !== containsPoint(other, source[i][0]),
              )),
          )
        )
          continue;
        const fit = prepareSmallerBrushContourFit({ ...s, contours: rings }, allowance / 2, bestCount, originalPaths);
        if (fit) {
          best = fit.shape;
          bestCount = fit.fittedAnchors;
        }
      } catch {
        /* Keep original paint when topology cannot be certified. */
      }
    }
    return best;
  });
}
