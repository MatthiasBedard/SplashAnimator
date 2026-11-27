import { MAX_VECTOR_POINTS, clone, type Vector, type BezierNode } from '../../document/src';
import { normalizeVector, smoothPoints } from './drawing';
import { simplifyPath } from './path-edit';
import { matrix, mapPoint } from './affine';

/** Finish only newly captured open ink. Legacy callers keep every anchor;
 * reduced authoring keeps significant anchors, endpoints and their pen metadata. */
export function smoothPencilStroke(source: Vector, reduceAnchors = false, amount = 1): Vector {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 4 ||
    source.kind !== 'path' ||
    source.closed ||
    source.contours ||
    !Array.isArray(source.points) ||
    source.points.length < 2 ||
    source.points.length > MAX_VECTOR_POINTS ||
    source.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw Error('Invalid Pencil stroke for smoothing.');
  let points = amount === 1 ? smoothPoints(source.points) : source.points.map((p) => ({ ...p }));
  // The main 0–200% control maps to at most four bounded smoothing passes.
  if (amount !== 1)
    for (let remaining = amount; remaining > 0; remaining -= 1) {
      const filtered = smoothPoints(points),
        blend = Math.min(1, remaining);
      points =
        blend === 1
          ? filtered
          : points.map((p, i) => ({
              ...p,
              x: p.x + (filtered[i].x - p.x) * blend,
              y: p.y + (filtered[i].y - p.y) * blend,
            }));
    }
  if (reduceAnchors && amount > 0 && points.length > 2) {
    // Reduce only this new stroke, in document space. Extreme coordinate ranges
    // retain the original complete curve rather than risking lossy arithmetic.
    const m = matrix(source);
    if (
      points.every((p) => {
        const q = mapPoint(m, p);
        return (
          Number.isFinite(q.x) &&
          Number.isFinite(q.y) &&
          Math.abs(q.x) <= 1e12 &&
          Math.abs(q.y) <= 1e12
        );
      })
    ) {
      const path = { ...clone(source), points };
      try {
        simplifyPath(path, 0.75 * amount);
        points = path.points;
      } catch (cause) {
        // An exhausted optional simplification keeps every smoothed anchor.
        if (!(cause instanceof Error) || !cause.message.startsWith('Path is too complex'))
          throw cause;
      }
    }
  }
  const nodes: BezierNode[] = points.map((p, i) => {
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 1)],
      divisor = i === 0 || i === points.length - 1 ? 3 : 6;
    let dx = (after.x - before.x) / divisor,
      dy = (after.y - before.y) / divisor;
    if (reduceAnchors && i > 0 && i < points.length - 1) {
      // Sparse anchors can have unequal spacing. Limit the common tangent
      // length so short spans do not acquire backwards handles or loops.
      let scale = 1;
      for (const axis of ['x', 'y'] as const) {
        const left = p[axis] - before[axis],
          right = after[axis] - p[axis],
          delta = axis === 'x' ? dx : dy;
        if (delta && ((left > 0 && right > 0) || (left < 0 && right < 0)))
          scale = Math.min(
            scale,
            Math.abs(left) / 3 / Math.abs(delta),
            Math.abs(right) / 3 / Math.abs(delta),
          );
      }
      dx *= scale;
      dy *= scale;
    }
    return {
      ...p,
      ...(i ? { in: { x: p.x - dx, y: p.y - dy } } : {}),
      ...(i < points.length - 1 ? { out: { x: p.x + dx, y: p.y + dy } } : {}),
    };
  });
  if (
    nodes.some((n) =>
      [n, n.in, n.out].some((p) => p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))),
    )
  )
    throw Error('Pencil smoothing exceeds finite geometry.');
  const result = { ...clone(source), kind: 'bezier' as const, points: [], nodes };
  normalizeVector(result);
  if (
    ![result.x, result.y, result.width, result.height].every(Number.isFinite) ||
    nodes.some((n) =>
      [n, n.in, n.out].some((p) => p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))),
    )
  )
    throw Error('Pencil smoothing exceeds finite geometry.');
  return result;
}
