import type { Point } from '@splash/document';
import type { Cubic } from './curve-fit';
const delta = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
const length = (p: Point) => Math.hypot(p.x, p.y);
/** Endpoint limiting directions also handle zero first derivatives. No change to
 * geometry; angles measure geometric tangent continuity, not curvature quality. */
export function measureCurveJoins(curves: Cubic[], corners: Set<number>, closed: boolean) {
  const issues: { index: number; point: Point; degrees: number | null }[] = [];
  let maxDegrees = 0,
    discontinuities = 0,
    degenerate = 0,
    intentionalCorners = 0;
  for (let i = closed ? 0 : 1; i < curves.length; i++) {
    if (corners.has(i)) {
      intentionalCorners++;
      continue;
    }
    const a = curves[(i + curves.length - 1) % curves.length],
      b = curves[i];
    const incoming = [a[2], a[1], a[0]].map((p) => delta(p, a[3])).find((p) => length(p) > 0);
    const outgoing = [b[1], b[2], b[3]].map((p) => delta(b[0], p)).find((p) => length(p) > 0);
    if (!incoming || !outgoing) {
      degenerate++;
      issues.push({ index: i, point: { ...b[0] }, degrees: null });
      continue;
    }
    const dot =
      (incoming.x / length(incoming)) * (outgoing.x / length(outgoing)) +
      (incoming.y / length(incoming)) * (outgoing.y / length(outgoing));
    const degrees = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    maxDegrees = Math.max(maxDegrees, degrees);
    if (degrees > 1) {
      discontinuities++;
      issues.push({ index: i, point: { ...b[0] }, degrees });
    }
  }
  return { maxDegrees, discontinuities, degenerate, intentionalCorners, issues };
}

/** Align a join only when its control displacement plus the original certified
 * error remains within tolerance. The convex hull bounds displacement everywhere,
 * including between samples. A supplied certificate can instead recheck the
 * adjusted span directly against source intervals. Both handle changes are checked. */
export function smoothCurveJoins(
  curves: Cubic[],
  errors: number[],
  corners: Set<number>,
  closed: boolean,
  tolerance: number,
  certify?: (index: number, curve: Cubic) => number,
) {
  const result = curves.map((c) => c.map((p) => ({ ...p })) as Cubic);
  const bound = (i: number, c: Cubic) =>
    certify
      ? certify(i, c)
      : errors[i] +
        Math.max(...c.map((p, k) => Math.hypot(p.x - curves[i][k].x, p.y - curves[i][k].y)));
  for (let i = closed ? 0 : 1; i < result.length; i++) {
    if (corners.has(i)) continue;
    const j = (i + result.length - 1) % result.length;
    if (i === j) continue;
    const a = result[j],
      b = result[i],
      u = delta(a[2], a[3]),
      v = delta(b[0], b[1]),
      lu = length(u),
      lv = length(v);
    if (!lu || !lv) continue;
    // A small fixed search also permits unequal handle lengths and directions
    // nearer the more constrained span, including retaining either original
    // direction when that span has no remaining error budget. No candidate
    // escapes the same certificate.
    let aligned = false;
    for (const weight of [0.5, 0.25, 0.75, 0, 1]) {
      const t = {
        x: (u.x / lu) * (1 - weight) + (v.x / lv) * weight,
        y: (u.y / lu) * (1 - weight) + (v.y / lv) * weight,
      };
      const lt = length(t);
      if (lt < 1e-10) continue;
      let left: Cubic | undefined, right: Cubic | undefined;
      for (const factor of [1, 0.9, 1.1]) {
        if (!left) {
          const candidate = [...a] as Cubic;
          candidate[2] = {
            x: a[3].x - (t.x / lt) * lu * factor,
            y: a[3].y - (t.y / lt) * lu * factor,
          };
          if (bound(j, candidate) <= tolerance) left = candidate;
        }
        if (!right) {
          const candidate = [...b] as Cubic;
          candidate[1] = {
            x: b[0].x + (t.x / lt) * lv * factor,
            y: b[0].y + (t.y / lt) * lv * factor,
          };
          if (bound(i, candidate) <= tolerance) right = candidate;
        }
        if (left && right) break;
      }
      if (left && right) {
        result[j] = left;
        result[i] = right;
        aligned = true;
        break;
      }
    }
    if (!aligned) {
      // Full alignment can exceed a span's budget. Search a bounded fraction of
      // the midpoint adjustment; keep only candidates certified on both sides.
      const t = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv },
        lt = length(t);
      if (lt < 1e-10) continue;
      const targetLeft = { x: a[3].x - (t.x / lt) * lu, y: a[3].y - (t.y / lt) * lu };
      const targetRight = { x: b[0].x + (t.x / lt) * lv, y: b[0].y + (t.y / lt) * lv };
      let low = 0,
        high = 1;
      for (let step = 0; step < 8; step++) {
        const fraction = (low + high) / 2;
        const left = [...a] as Cubic,
          right = [...b] as Cubic;
        left[2] = {
          x: a[2].x + (targetLeft.x - a[2].x) * fraction,
          y: a[2].y + (targetLeft.y - a[2].y) * fraction,
        };
        right[1] = {
          x: b[1].x + (targetRight.x - b[1].x) * fraction,
          y: b[1].y + (targetRight.y - b[1].y) * fraction,
        };
        const leftError = bound(j, left),
          rightError = bound(i, right);
        if (leftError <= tolerance && rightError <= tolerance) {
          low = fraction;
          result[j] = left;
          result[i] = right;
        } else high = fraction;
      }
    }
  }
  return { curves: result, maxError: Math.max(...result.map((c, i) => bound(i, c))) };
}
