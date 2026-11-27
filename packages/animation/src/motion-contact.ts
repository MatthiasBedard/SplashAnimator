import type { Point, Vector } from '../../document/src';
import { validateMotionCurveContacts } from './motion-curve-contact';

type Edge = {
  a: Point;
  b: Point;
  endA: Point;
  endB: Point;
  ring: number;
  index: number;
  count: number;
  closed: boolean;
};
const EPS = 128 * Number.EPSILON;
/** Conservative local-space guard for straight edge contacts and adjacent retracing throughout linear node interpolation. */
export function validateMotionContourContacts(from: Vector, to: Vector): void {
  if ([from, to].some((s) => (s.kind === 'bezier' && s.nodes?.some((p) => p.in || p.out)) || (s.kind === 'polygon' && s.fillRule === 'evenodd' && s.contours?.some((ring) => ring.some((p) => p.in || p.out))))) {
    validateMotionCurveContacts(from, to);
    return;
  }
  const rings = (s: Vector): Point[][] => {
    const result =
      s.kind === 'polygon' ? s.contours : s.kind === 'bezier' && s.nodes ? [s.nodes] : undefined;
    if (
      !result?.length ||
      result.some((r) =>
        r.some(
          (p) =>
            Object.keys(p).some((k) => k !== 'x' && k !== 'y') ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y),
        ),
      )
    )
      throw new Error(
        'Contact checking requires plain straight Bezier or polygon contours without handles.',
      );
    return result;
  };
  const first = rings(from),
    last = rings(to),
    closed = from.kind === 'polygon' || !!from.closed;
  if (
    from.kind !== to.kind ||
    closed !== (to.kind === 'polygon' || !!to.closed) ||
    first.length !== last.length ||
    first.some((r, i) => r.length !== last[i].length || r.length < (closed ? 3 : 2))
  )
    throw new Error('Contact checking requires matching straight contours.');
  const edges: Edge[] = [];
  first.forEach((r, ring) => {
    const count = r.length - (closed ? 0 : 1);
    for (let i = 0; i < count; i++)
      edges.push({
        a: r[i],
        b: r[(i + 1) % r.length],
        endA: last[ring][i],
        endB: last[ring][(i + 1) % r.length],
        ring,
        index: i,
        count,
        closed,
      });
  });
  let work = 0;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      if (++work > 200000)
        throw new Error('Contact checking exceeded its 200000 edge-pair work budget.');
      const a = edges[i],
        b = edges[j];
      const consecutive = a.ring === b.ring && b.index === a.index + 1;
      const seam = a.ring === b.ring && closed && a.index === 0 && b.index === a.count - 1;
      const adjacent = consecutive || seam;
      const left = [a.a, a.b, a.endA, a.endB],
        right = [b.a, b.b, b.endA, b.endB];
      if (
        (['x', 'y'] as const).some(
          (axis) =>
            Math.max(...left.map((p) => p[axis])) < Math.min(...right.map((p) => p[axis])) ||
            Math.max(...right.map((p) => p[axis])) < Math.min(...left.map((p) => p[axis])),
        )
      )
        continue;
      // Remove the first vertex's linear motion before normalization. A shared
      // translation must not make small edge directions look numerically collinear.
      const raw = [...left, ...right].map((p, i) => {
        const origin = i % 4 < 2 ? a.a : a.endA;
        return { x: p.x - origin.x, y: p.y - origin.y };
      });
      const scale = Math.max(...raw.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
      if (!Number.isFinite(scale) || scale === 0)
        throw new Error('Straight contour contact is numerically unresolved.');
      const p = raw.map((p) => ({ x: p.x / scale, y: p.y / scale }));
      const mix = (a: Point, b: Point, t: number) => ({
        x: a.x * (1 - t) + b.x * t,
        y: a.y * (1 - t) + b.y * t,
      });
      const at = (t: number) => [
        mix(p[0], p[2], t),
        mix(p[1], p[3], t),
        mix(p[4], p[6], t),
        mix(p[5], p[7], t),
      ];
      const orient = (a: Point, b: Point, c: Point) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const orientations = (t: number) => {
        const [a, b, c, d] = at(t);
        return [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
      };
      const zero = orientations(0),
        half = orientations(0.5),
        one = orientations(1),
        times = [0, 1];
      const add = (t: number) => {
        if (Number.isFinite(t) && t > 0 && t < 1) times.push(t);
      };
      for (let k = 0; k < 4; k++) {
        const c = zero[k],
          a = 2 * (one[k] + c - 2 * half[k]),
          b = one[k] - c - a;
        if (a === 0) {
          if (b !== 0) add(-c / b);
          continue;
        }
        add(-b / (2 * a)); // Also inspect near-tangent extrema, including rounded discriminants.
        const d = b * b - 4 * a * c;
        if (d < 0) continue;
        const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(d));
        if (q === 0) add(-b / (2 * a));
        else {
          add(q / a);
          add(c / q);
        }
      }
      // Collinear edges can overlap only briefly while all orientation polynomials are zero.
      for (const i of [0, 1])
        for (const j of [4, 5])
          for (const axis of ['x', 'y'] as const) {
            const start = p[i][axis] - p[j][axis],
              end = p[i + 2][axis] - p[j + 2][axis];
            if (end !== start) add(-start / (end - start));
          }
      times.sort((a, b) => a - b);
      const probes = times.concat(times.slice(1).map((t, i) => (times[i] + t) / 2));
      for (const t of probes) {
        const [a, b, c, d] = at(t),
          o = orientations(t);
        if (adjacent) {
          // The shared vertex is allowed. Only collinear rays on the same side retrace.
          const shared = consecutive ? b : a,
            left = consecutive ? a : b,
            right = consecutive ? d : c;
          const ux = left.x - shared.x,
            uy = left.y - shared.y,
            vx = right.x - shared.x,
            vy = right.y - shared.y;
          if (Math.abs(ux * vy - uy * vx) <= EPS && ux * vx + uy * vy > 0)
            throw new Error('Adjacent straight contour edges retrace during motion.');
          continue;
        }
        const on = (a: Point, b: Point, p: Point) =>
          p.x >= Math.min(a.x, b.x) - EPS &&
          p.x <= Math.max(a.x, b.x) + EPS &&
          p.y >= Math.min(a.y, b.y) - EPS &&
          p.y <= Math.max(a.y, b.y) + EPS;
        const opposite = (a: number, b: number) => (a > EPS && b < -EPS) || (a < -EPS && b > EPS);
        if (
          (opposite(o[0], o[1]) && opposite(o[2], o[3])) ||
          (Math.abs(o[0]) <= EPS && on(a, b, c)) ||
          (Math.abs(o[1]) <= EPS && on(a, b, d)) ||
          (Math.abs(o[2]) <= EPS && on(c, d, a)) ||
          (Math.abs(o[3]) <= EPS && on(c, d, b))
        )
          throw new Error('Nonadjacent straight contour edges touch or cross during motion.');
      }
    }
}
