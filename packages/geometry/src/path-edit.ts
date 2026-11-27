import type { Point, Vector } from '@splash/document';
import { matrix, mapPoint } from './affine';
import { convertAnchors } from './nodes';
/** Shared whole-path operations, keeping closed topology and open endpoints. */
export function smoothPath(s: Vector, straight = false) {
  if (s.kind === 'bezier' && s.nodes) {
    convertAnchors(
      s,
      s.nodes.map((_, i) => i),
      straight ? 'corner' : 'smooth',
    );
  } else if (s.kind === 'path' && !s.contours && s.points.length > 1) {
    if (straight) {
      if (!s.closed) s.points = [s.points[0], s.points.at(-1)!];
      return;
    }
    const points = s.points;
    s.points = points.map((p, i) => {
      if (!s.closed && (i === 0 || i === points.length - 1)) return { ...p };
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length];
      return { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
}
function distanceSquared(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
type PathSplit = { distance: number; index: number };
export const PATH_SIMPLIFICATION_WORK_LIMIT = 1000000;

function simplifiedPathPoints(
  source: Point[],
  points: Point[],
  tolerance: number,
  splits?: Map<number, PathSplit>,
  charge?: (work: number) => void,
): Point[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 100)
    throw new Error(
      'Simplification tolerance must be greater than zero and at most 100 stage units.',
    );
  if (points.length < 3) return source;
  const keep = new Set([0, points.length - 1]),
    stack: [[number, number]] = [[0, points.length - 1]];
  let work = 0;
  const threshold = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    // Charge every candidate edge as before, even when its distances are cached.
    work += last - first - 1;
    if (work > PATH_SIMPLIFICATION_WORK_LIMIT)
      throw new Error('Path is too complex to simplify in one operation. Split it first.');
    const key = first * points.length + last;
    let split = splits?.get(key);
    charge?.(split ? 1 : last - first);
    if (!split) {
      let distance = 0, index = -1;
      for (let i = first + 1; i < last; i++) {
        const d = distanceSquared(points[i], points[first], points[last]);
        if (d > distance) {
          distance = d;
          index = i;
        }
      }
      split = { distance, index };
      splits?.set(key, split);
    }
    if (split.distance > threshold) {
      const { index } = split;
      keep.add(index);
      stack.push([first, index], [index, last]);
    }
  }
  return source.filter((_, i) => keep.has(i));
}

/** Reuse the same world coordinates and span distances across Brush fit levels. */
export function preparePathSimplification(source: Point[], basis: ReturnType<typeof matrix>, charge?: (work: number) => void) {
  const points = source.map(p => mapPoint(basis, p));
  const splits = new Map<number, PathSplit>();
  return (tolerance: number) => simplifiedPathPoints(source, points, tolerance, splits, charge);
}

/** Iterative RDP in stage coordinates. No mutation until the bounded calculation succeeds. */
export function simplifyPath(s: Vector, tolerance: number): number {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 100)
    throw new Error(
      'Simplification tolerance must be greater than zero and at most 100 stage units.',
    );
  if (s.kind !== 'path' || s.closed || s.contours || s.points.length < 3) return 0;
  const m = matrix(s);
  const result = simplifiedPathPoints(s.points, s.points.map(p => mapPoint(m, p)), tolerance);
  const removed = s.points.length - result.length;
  s.points = result;
  return removed;
}
