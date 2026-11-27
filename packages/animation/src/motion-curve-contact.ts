import type { BezierNode, Point, Vector } from '../../document/src';

const EPS = 128 * Number.EPSILON;
const mid = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
function halves(points: Point[]): [Point[], Point[]] {
  const left = [points[0]],
    right = [points[points.length - 1]];
  while (points.length > 1) {
    points = points.slice(1).map((p, i) => mid(points[i], p));
    left.push(points[0]);
    right.unshift(points[points.length - 1]);
  }
  return [left, right];
}
/** Bounds A(u,t)-B(v,t) using a degree (3,3,1) Bernstein tensor.
 * Adjacent segments may share their authored endpoint; unresolved boxes reject.
 */
export function validateMotionCurveContacts(from: Vector, to: Vector): void {
  let first: BezierNode[][], last: BezierNode[][], closed: boolean;
  if (from.kind === 'polygon' && to.kind === 'polygon' && from.fillRule === 'evenodd' && to.fillRule === 'evenodd') {
    if (!Array.isArray(from.contours) || !Array.isArray(to.contours) || !from.contours.length || from.contours.length !== to.contours.length || from.contours.some((ring, i) => !Array.isArray(ring) || !Array.isArray(to.contours![i]) || ring.length < 3 || ring.length !== to.contours![i].length))
      throw new Error('Curve contact checking requires matching compound contours.');
    first = from.contours; last = to.contours; closed = true;
  } else {
    if (
      from.kind !== 'bezier' ||
      to.kind !== 'bezier' ||
      !!from.closed !== !!to.closed ||
      !from.nodes ||
      !to.nodes ||
      from.nodes.length !== to.nodes.length ||
      from.nodes.length < (from.closed ? 3 : 2)
    )
      throw new Error('Curve contact checking requires matching Bezier contours.');
    first = [from.nodes!]; last = [to.nodes!]; closed = !!from.closed;
  }
  for (const rings of [first, last])
    for (const nodes of rings)
      for (const p of nodes) {
        if (Object.keys(p).some((k) => !['x', 'y', 'in', 'out'].includes(k)))
          throw new Error('Curve contact checking requires plain Bezier nodes.');
        for (const q of [p, p.in ?? p, p.out ?? p])
          if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
            throw new Error('Curve contact coordinates must be finite.');
      }
  // Only segment identities are enumerated; stored rings and node order remain intact.
  const segments = first.flatMap((nodes, ring) => Array.from({ length: nodes.length - (closed ? 0 : 1) }, (_, index) => ({ ring, index, count: nodes.length - (closed ? 0 : 1) })));
  const controls = (nodes: BezierNode[], i: number) => {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    return [a, a.out ?? a, b.in ?? b, b];
  };
  let work = 0;
  const visit = () => {
    if (++work > 200000)
      throw new Error('Curve contact checking exceeded its 200000 patch work budget.');
  };
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      visit();
      const leftSegment = segments[i], rightSegment = segments[j];
      const sameRing = leftSegment.ring === rightSegment.ring;
      const seam = closed && sameRing && leftSegment.index === 0 && rightSegment.index === leftSegment.count - 1;
      const adjacent = sameRing && (rightSegment.index === leftSegment.index + 1 || !!seam);
      const values = [first, last].flatMap((rings) => {
        // Orient seam pairs so A(1)=B(0), just like ordinary adjacent pairs.
        const aSegment = seam ? rightSegment : leftSegment, bSegment = seam ? leftSegment : rightSegment;
        const a = controls(rings[aSegment.ring], aSegment.index),
          b = controls(rings[bSegment.ring], bSegment.index);
        return a.flatMap((p) => b.map((q) => ({ x: p.x - q.x, y: p.y - q.y })));
      });
      let scale = 0;
      for (const p of values) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
          throw new Error('Curve contact differences exceed numeric limits.');
        scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
      }
      if (!scale) throw new Error('Curve segments touch or are numerically unresolved.');
      const stack = [
        {
          values: values.map((p) => ({ x: p.x / scale, y: p.y / scale })),
          depth: 0,
          join: adjacent,
        },
      ];
      while (stack.length) {
        visit();
        const q = stack.pop()!;
        if (
          (['x', 'y'] as const).some(
            (axis) => q.values.every((p) => p[axis] > EPS) || q.values.every((p) => p[axis] < -EPS),
          )
        )
          continue;
        if (q.join) {
          // A nonnegative Bernstein projection with positive other corners can
          // vanish only at (u=1,v=0). Thus the shared endpoint is the only contact.
          // Include a local bisector so oblique corners need not align with X/Y.
          const normal = [0, 15, 16, 31].reduce(
            (sum, k) => {
              const p = q.values[k],
                length = Math.hypot(p.x, p.y);
              return length ? { x: sum.x + p.x / length, y: sum.y + p.y / length } : sum;
            },
            { x: 0, y: 0 },
          );
          const length = Math.hypot(normal.x, normal.y);
          const normals = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ];
          if (length) normals.push({ x: normal.x / length, y: normal.y / length });
          const corners = [0, 3, 15, 16, 19, 31];
          if (
            normals.some((n) => {
              const v = q.values.map((p) => p.x * n.x + p.y * n.y);
              // A corner's separation margin is angular, not relative to the
              // longest segment. Normalize each corner before projecting so a
              // short, well-separated segment is not mistaken for contact.
              const cornerDirections = corners.map((k) => {
                const p = q.values[k],
                  length = Math.hypot(p.x, p.y);
                return length ? (p.x / length) * n.x + (p.y / length) * n.y : 0;
              });
              return (
                (v.every((x) => x >= 0) && cornerDirections.every((x) => x > EPS)) ||
                (v.every((x) => x <= 0) && cornerDirections.every((x) => x < -EPS))
              );
            })
          )
            continue;
        }
        if (q.depth >= 30) throw new Error('Curve segments touch or are numerically unresolved.');
        const left: Point[] = new Array(32),
          right: Point[] = new Array(32);
        // Index = time * 16 + u * 4 + v. Each subdivision is exact in Bernstein form.
        const axis = q.depth % 3;
        const lines: number[][] = [];
        if (axis === 0) for (let k = 0; k < 16; k++) lines.push([k, k + 16]);
        else
          for (let t = 0; t < 2; t++)
            for (let k = 0; k < 4; k++)
              lines.push(
                Array.from({ length: 4 }, (_, n) => t * 16 + (axis === 1 ? n * 4 + k : k * 4 + n)),
              );
        for (const indices of lines) {
          const [a, b] = halves(indices.map((k) => q.values[k]));
          indices.forEach((k, n) => {
            left[k] = a[n];
            right[k] = b[n];
          });
        }
        stack.push(
          { values: left, depth: q.depth + 1, join: q.join && axis !== 1 },
          { values: right, depth: q.depth + 1, join: q.join && axis !== 2 },
        );
      }
    }
}
