import type { Point, Vector } from '@splash/document';
import { matrix } from './affine';
import { brushNib } from './pressure';

/** Rendering-only reduction. Original pressure/tilt/twist samples remain editable.
 * For fixed nibs with linear pressure, center error + radius error bounds the
 * swept ellipse error. The affine norm keeps tolerance in document coordinates.
 */
export function simplifyBrushSamples(s: Vector, tolerance = 0.025): Point[] {
  const b = s.brush;
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid brush tolerance');
  if (
    s.points.length < 3 ||
    b?.tilt ||
    b?.twist ||
    (b?.pressure !== false && (b?.response ?? 1) !== 1)
  )
    return s.points;
  const m = matrix(s);
  const limit = tolerance / Math.max(1, Math.hypot(m[0], m[1], m[2], m[3]));
  const radii = s.points.map((p) => brushNib(s, p).rx);
  const keep = new Uint8Array(s.points.length);
  keep[0] = keep[keep.length - 1] = 1;
  const stack: [number, number][] = [[0, s.points.length - 1]];
  // Adversarial zigzags can make RDP quadratic. Fall back without dropping data.
  let work = 0;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = s.points[start],
      z = s.points[end];
    const dx = z.x - a.x,
      dy = z.y - a.y,
      length2 = dx * dx + dy * dy;
    let worst = limit,
      split = -1;
    for (let i = start + 1; i < end; i++) {
      if (++work > 1000000) return s.points;
      const p = s.points[i];
      const t = length2
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
        : 0;
      const error =
        Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) +
        Math.abs(radii[i] - (radii[start] + t * (radii[end] - radii[start])));
      if (error > worst) {
        worst = error;
        split = i;
      }
    }
    if (split >= 0) {
      keep[split] = 1;
      stack.push([start, split], [split, end]);
    }
  }
  return s.points.filter((_, i) => keep[i]);
}
