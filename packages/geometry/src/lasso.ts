import type { Point, Vector } from '@splash/document';
import { containsPoint } from './drawing';
import { authoringCorners } from './layout';
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const epsilon = 1e-7;
function inside(ring: Point[], p: Point) {
  return (
    containsPoint(ring, p) ||
    ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length],
        d = sub(b, a),
        q = sub(p, a);
      const length = Math.hypot(d.x, d.y);
      if (!length) return Math.hypot(q.x, q.y) <= epsilon;
      const ux = d.x / length,
        uy = d.y / length,
        along = Math.max(0, Math.min(length, q.x * ux + q.y * uy));
      return Math.hypot(q.x - along * ux, q.y - along * uy) <= epsilon;
    })
  );
}
/** Full transformed authoring-box boundary containment, including concave lassos. */
export function lassoContains(s: Vector, ring: Point[]): boolean {
  return lassoContainsBoundaries([authoringCorners(s)], ring);
}

export function lassoContainsBoundaries(boundaries: Point[][], ring: Point[]): boolean {
  if (ring.length < 3) return false;
  // Use an absolute triangle-fan bound: opposite lobes of a crossing lasso
  // can cancel signed area. Actual parity and complete box-edge containment
  // below decide membership. Translate first to retain distant small lassos.
  const area = ring.reduce(
    (sum, a, i) =>
      sum + Math.abs(cross(sub(a, ring[0]), sub(ring[(i + 1) % ring.length], ring[0]))),
    0,
  );
  if (area < epsilon) return false;
  const containsEdge = (corners: Point[], a: Point, i: number) => {
    if (!inside(ring, a)) return false;
    const b = corners[(i + 1) % 4],
      d = sub(b, a),
      length2 = d.x * d.x + d.y * d.y;
    if (length2 < epsilon * epsilon) return true;
    const cuts = [0, 1];
    ring.forEach((p, j) => {
      const q = ring[(j + 1) % ring.length],
        e = sub(q, p),
        offset = sub(p, a),
        denominator = cross(d, e);
      // The determinant is an area, not a document distance. Tiny nonparallel
      // edges still need their actual crossing parameters.
      if (denominator !== 0) {
        const t = cross(offset, e) / denominator,
          u = cross(offset, d) / denominator;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      } else if (Math.abs(cross(offset, d)) / Math.sqrt(length2) <= epsilon) {
        for (const v of [p, q]) {
          const t = ((v.x - a.x) * d.x + (v.y - a.y) * d.y) / length2;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    });
    cuts.sort((x, y) => x - y);
    return cuts.slice(1).every((t, j) => {
      const mid = (t + cuts[j]) / 2;
      return inside(ring, { x: a.x + d.x * mid, y: a.y + d.y * mid });
    });
  };
  return boundaries.every((corners) => corners.every((a, i) => containsEdge(corners, a, i)));
}
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';
export function combineSelection(
  previous: string[],
  hits: string[],
  mode: SelectionMode,
): string[] {
  const found = new Set(hits);
  if (mode === 'add') return [...new Set([...previous, ...hits])];
  if (mode === 'subtract') return previous.filter((id) => !found.has(id));
  if (mode === 'intersect') return previous.filter((id) => found.has(id));
  return hits;
}
