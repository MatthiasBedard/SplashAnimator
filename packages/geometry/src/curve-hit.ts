import type { Point, Vector } from '@splash/document';
import { matrix, mapPoint, multiply, type Matrix } from './affine';
type Cubic = [Point, Point, Point, Point];
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
function split(c: Cubic, t: number): [Cubic, Cubic] {
  const a = mix(c[0], c[1], t),
    b = mix(c[1], c[2], t),
    d = mix(c[2], c[3], t),
    e = mix(a, b, t),
    f = mix(b, d, t),
    p = mix(e, f, t);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
}
/** Bounded hit search in stage space, or in the projected coordinates of point
 * and radius. The returned parameter still belongs to the original cubic. */
export function hitCurve(
  s: Vector,
  point: Point,
  radius: number,
  projection?: Matrix,
): { index: number; t: number } | undefined {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return;
  const lists =
    s.kind === 'bezier'
      ? s.nodes
        ? [s.nodes]
        : []
      : s.kind === 'polygon' && s.fillRule === 'evenodd'
        ? (s.contours ?? [])
        : [];
  const basis = matrix(s),
    m = projection ? multiply(projection, basis) : basis,
    tolerance = radius / 32;
  if (projection && !m.every(Number.isFinite)) return;
  let best = radius,
    result: { index: number; t: number } | undefined,
    offset = 0,
    work = 0;
  for (const nodes of lists) {
    const closed = !!s.contours || !!s.closed;
    for (let i = 0; i < nodes.length - (closed ? 0 : 1); i++) {
      const a = nodes[i],
        b = nodes[(i + 1) % nodes.length];
      const original = [a, a.out ?? a, b.in ?? b, b].map((p) => mapPoint(m, p)) as Cubic;
      if (projection && original.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
      const stack = [{ c: original, lo: 0, hi: 1, depth: 0 }];
      while (stack.length) {
        if (++work > 50000) return;
        const { c, lo, hi, depth } = stack.pop()!;
        const xs = c.map((p) => p.x),
          ys = c.map((p) => p.y);
        const dx = Math.max(Math.min(...xs) - point.x, 0, point.x - Math.max(...xs)),
          dy = Math.max(Math.min(...ys) - point.y, 0, point.y - Math.max(...ys));
        if (Math.hypot(dx, dy) > best) continue;
        const vx = c[3].x - c[0].x,
          vy = c[3].y - c[0].y,
          length2 = vx * vx + vy * vy;
        const projection = (p: Point) =>
          length2 ? ((p.x - c[0].x) * vx + (p.y - c[0].y) * vy) / length2 : 0;
        const u = projection(c[1]),
          v = projection(c[2]);
        const deviation = (p: Point, t: number) =>
          Math.hypot(p.x - c[0].x - t * vx, p.y - c[0].y - t * vy);
        if (
          u >= 0 &&
          v >= u &&
          v <= 1 &&
          Math.max(deviation(c[1], u), deviation(c[2], v)) <= tolerance
        ) {
          const distance = (t: number) => {
            const p = split(c, t)[0][3];
            return Math.hypot(p.x - point.x, p.y - point.y);
          };
          let left = 0,
            right = 1;
          for (let j = 0; j < 28; j++) {
            const p = left + (right - left) / 3,
              q = right - (right - left) / 3;
            if (distance(p) < distance(q)) right = q;
            else left = p;
          }
          const t = (left + right) / 2,
            global = lo + (hi - lo) * t,
            d = distance(t);
          if (global > 0.000001 && global < 0.999999 && d < best) {
            best = d;
            result = { index: offset + i, t: global };
          }
        } else {
          if (depth >= 18) return;
          const [left, right] = split(c, 0.5),
            mid = (lo + hi) / 2;
          stack.push(
            { c: right, lo: mid, hi, depth: depth + 1 },
            { c: left, lo, hi: mid, depth: depth + 1 },
          );
        }
      }
    }
    offset += nodes.length;
  }
  return result;
}
