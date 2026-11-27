import type { Point, Vector } from '@splash/document';
import { matrix } from './affine';
import { brushNib } from './pressure';

/** Linearize a fixed nib's power pressure curve at its analytic maximum error.
 * Endpoints and original samples remain untouched. Undefined requests legacy
 * stamping if a work budget or unsupported nib prevents bounded subdivision.
 */
export function responseSweepSamples(s: Vector, tolerance = 0.025): Point[] | undefined {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid brush tolerance');
  const b = s.brush;
  if (b?.tilt || b?.twist) return;
  const response = b?.pressure ? (b.response ?? 1) : 1;
  if (response === 1 || s.points.length < 2) return s.points;
  const m = matrix(s),
    limit = tolerance / Math.max(1, Math.hypot(m[0], m[1], m[2], m[3]));
  const points: Point[] = [s.points[0]];
  let work = 0;
  for (let i = 1; i < s.points.length; i++) {
    const stack: [Point, Point][] = [[s.points[i - 1], s.points[i]]];
    while (stack.length) {
      if (++work > 50000) return;
      const [a, z] = stack.pop()!;
      const pa = a.pressure ?? 1,
        pz = z.pressure ?? 1;
      // Validated document samples are in [0,1]. Keep the legacy path for
      // callers supplying unvalidated pressure rather than assuming convexity.
      if (pa < 0 || pa > 1 || pz < 0 || pz > 1) return;
      const ra = brushNib(s, a).rx,
        rz = brushNib(s, z).rx;
      const slope = pa === pz ? 0 : (pz ** response - pa ** response) / (pz - pa);
      const critical = (slope / response) ** (1 / (response - 1));
      const t = pa === pz ? 0 : (critical - pa) / (pz - pa);
      if (t > 0 && t < 1) {
        const p = { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t, pressure: critical };
        if (Math.abs(brushNib(s, p).rx - (ra + (rz - ra) * t)) > limit) {
          stack.push([p, z], [a, p]);
          continue;
        }
      }
      points.push(z);
    }
  }
  return points;
}
