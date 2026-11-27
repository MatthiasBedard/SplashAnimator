import type { BezierNode, Point, Vector } from '../../document/src';

const EPS = 128 * Number.EPSILON;
const mid = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
function split(p: Point[]): [Point[], Point[]] {
  if (p.length === 2) {
    const m = mid(p[0], p[1]);
    return [
      [p[0], m],
      [m, p[1]],
    ];
  }
  const a = mid(p[0], p[1]),
    b = mid(p[1], p[2]),
    c = mid(a, b);
  return [
    [p[0], a, c],
    [c, b, p[2]],
  ];
}
/** Certify the divided difference (C(u)-C(v))/(u-v) stays nonzero.
 * The diagonal equals C'(u), so stationary and unresolved cases also reject.
 */
export function validateMotionCurveSelfContacts(from: Vector, to: Vector): void {
  const work = { visits: 0 };
  if (from.kind === 'polygon' && to.kind === 'polygon' && from.fillRule === 'evenodd' && to.fillRule === 'evenodd') {
    const first = from.contours, last = to.contours;
    if (!Array.isArray(first) || !Array.isArray(last) || !first.length || first.length !== last.length || first.some((ring, i) => !Array.isArray(ring) || !Array.isArray(last[i]) || ring.length < 3 || ring.length !== last[i].length))
      throw new Error('Curve self-contact checking requires matching compound contours.');
    // This certifies each cubic, including closing segments, not contacts between cubics.
    // All rings share the original per-vector work budget.
    for (let i = 0; i < first.length; i++) validateRing(first[i], last[i], true, work);
    return;
  }
  if (
    from.kind !== 'bezier' ||
    to.kind !== 'bezier' ||
    !!from.closed !== !!to.closed ||
    !from.nodes ||
    !to.nodes ||
    from.nodes.length !== to.nodes.length ||
    from.nodes.length < 2
  )
    throw new Error('Curve self-contact checking requires matching Bezier contours.');
  validateRing(from.nodes, to.nodes, !!from.closed, work);
}
function validateRing(first: BezierNode[], last: BezierNode[], closed: boolean, work: { visits: number }): void {
  for (let segment = 0; segment < first.length - (closed ? 0 : 1); segment++) {
    const differences = [first, last].map((nodes) => {
      const a = nodes[segment],
        b = nodes[(segment + 1) % nodes.length];
      const p = [a, a.out ?? a, b.in ?? b, b];
      if (p.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y)))
        throw new Error('Curve self-contact coordinates must be finite.');
      return p.slice(1).map((q, i) => ({ x: q.x - p[i].x, y: q.y - p[i].y }));
    });
    let scale = 0;
    for (const p of differences.flat()) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error('Curve self-contact differences exceed numeric limits.');
      scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
    }
    if (!scale) throw new Error('Curve self-contact or stationary tangent is unresolved.');
    const values = differences.flatMap((d) => {
      d = d.map((p) => ({ x: p.x / scale, y: p.y / scale }));
      // C(u)=a*u^3+b*u^2+c*u+d; quotient=a*(u²+uv+v²)+b*(u+v)+c.
      const a = { x: d[2].x - 2 * d[1].x + d[0].x, y: d[2].y - 2 * d[1].y + d[0].y };
      const b = { x: 3 * (d[1].x - d[0].x), y: 3 * (d[1].y - d[0].y) };
      return Array.from({ length: 9 }, (_, k) => {
        const i = Math.floor(k / 3),
          j = k % 3;
        const quadratic = (i === 2 ? 1 : 0) + (i * j) / 4 + (j === 2 ? 1 : 0);
        return {
          x: a.x * quadratic + (b.x * (i + j)) / 2 + 3 * d[0].x,
          y: a.y * quadratic + (b.y * (i + j)) / 2 + 3 * d[0].y,
        };
      });
    });
    const stack = [{ values, depth: 0 }];
    while (stack.length) {
      if (++work.visits > 200000) throw new Error('Curve self-contact checking exceeded its work budget.');
      const q = stack.pop()!;
      if (
        (['x', 'y'] as const).some(
          (axis) => q.values.every((p) => p[axis] > EPS) || q.values.every((p) => p[axis] < -EPS),
        )
      )
        continue;
      if (q.depth >= 30) throw new Error('Curve self-contact or stationary tangent is unresolved.');
      const left: Point[] = new Array(18),
        right: Point[] = new Array(18),
        lines: number[][] = [];
      const axis = q.depth % 3;
      if (axis === 0) for (let k = 0; k < 9; k++) lines.push([k, k + 9]);
      else
        for (let t = 0; t < 2; t++)
          for (let k = 0; k < 3; k++)
            lines.push(
              Array.from({ length: 3 }, (_, n) => t * 9 + (axis === 1 ? n * 3 + k : k * 3 + n)),
            );
      for (const indices of lines) {
        const [a, b] = split(indices.map((k) => q.values[k]));
        indices.forEach((k, n) => {
          left[k] = a[n];
          right[k] = b[n];
        });
      }
      stack.push({ values: left, depth: q.depth + 1 }, { values: right, depth: q.depth + 1 });
    }
  }
}
