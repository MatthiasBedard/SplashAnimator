import type { BezierNode, Point, Vector } from '../../document/src';

const EPS = 128 * Number.EPSILON;
const midpoint = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
function split(q: Point[]): [Point[], Point[]] {
  const a = midpoint(q[0], q[1]),
    b = midpoint(q[1], q[2]),
    c = midpoint(a, b);
  return [
    [q[0], a, c],
    [c, b, q[2]],
  ];
}
/** Conservative Bernstein-box certification over curve parameter and tween progress.
 * Failure includes unresolved near-zero derivatives; this is not a topology repair.
 */
export function validateMotionCurveTangents(from: Vector, to: Vector): void {
  const work = { visits: 0 };
  if (from.kind === 'polygon' && to.kind === 'polygon' && from.fillRule === 'evenodd' && to.fillRule === 'evenodd') {
    const first = from.contours, last = to.contours;
    if (!Array.isArray(first) || !Array.isArray(last) || !first.length || first.length !== last.length || first.some((ring, i) => !Array.isArray(ring) || !Array.isArray(last[i]) || ring.length < 3 || ring.length !== last[i].length))
      throw new Error('Curve tangent validation requires matching compound contours.');
    // Compound polygon rings are closed even when the legacy closed flag is absent.
    // One vector owns one work budget, including every ring and closing join.
    for (let i = 0; i < first.length; i++) validateRing(first[i], last[i], true, work);
    return;
  }
  if (
    from.kind !== 'bezier' ||
    to.kind !== 'bezier' ||
    !!from.closed !== !!to.closed ||
    (from.nodes?.length ?? 0) < 2 ||
    (from.nodes?.length ?? 0) !== (to.nodes?.length ?? 0)
  )
    throw new Error('Curve tangent validation requires matching Bezier contours.');
  validateRing(from.nodes!, to.nodes!, !!from.closed, work);
}
function validateRing(firstNodes: BezierNode[], lastNodes: BezierNode[], closed: boolean, work: { visits: number }): void {
  const derivative = (nodes: BezierNode[], i: number) => {
    const a = nodes[i],
      b = nodes[(i + 1) % nodes.length];
    const controls = [a, a.out ?? a, b.in ?? b, b];
    if (controls.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw new Error('Curve tangent coordinates must be finite.');
    return controls.slice(1).map((p, j) => ({ x: p.x - controls[j].x, y: p.y - controls[j].y }));
  };
  const count = closed ? firstNodes.length : firstNodes.length - 1;
  for (let i = 0; i < count; i++) {
    const first = derivative(firstNodes, i),
      last = derivative(lastNodes, i);
    let scale = 0;
    for (const p of [...first, ...last]) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error('Curve tangent differences exceed numeric limits.');
      scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
    }
    if (!scale) throw new Error('Curve tangent is stationary.');
    const normalize = (p: Point) => ({ x: p.x / scale, y: p.y / scale });
    const stack = [{ a: first.map(normalize), b: last.map(normalize), depth: 0 }];
    while (stack.length) {
      if (++work.visits > 200000) throw new Error('Curve tangent validation exceeds its work budget.');
      const patch = stack.pop()!;
      const points = [...patch.a, ...patch.b];
      // A Bernstein curve lies within its control hull at every progress value.
      if (
        ['x', 'y'].some(
          (axis) =>
            points.every((p) => p[axis as 'x' | 'y'] > EPS) ||
            points.every((p) => p[axis as 'x' | 'y'] < -EPS),
        )
      )
        continue;
      if (patch.depth >= 24 || points.every((p) => Math.abs(p.x) <= EPS && Math.abs(p.y) <= EPS))
        throw new Error('Curve tangent may become stationary or is numerically unresolved.');
      if (patch.depth % 2 === 0) {
        const [a0, a1] = split(patch.a),
          [b0, b1] = split(patch.b);
        stack.push(
          { a: a0, b: b0, depth: patch.depth + 1 },
          { a: a1, b: b1, depth: patch.depth + 1 },
        );
      } else {
        const middle = patch.a.map((p, j) => midpoint(p, patch.b[j]));
        stack.push(
          { a: patch.a, b: middle, depth: patch.depth + 1 },
          { a: middle, b: patch.b, depth: patch.depth + 1 },
        );
      }
    }
  }
  // At joins, nonzero segment derivatives can still reverse direction.
  // Their cross and dot products are quadratic Bernstein polynomials in time.
  for (let i = closed ? 0 : 1; i < firstNodes.length - (closed ? 0 : 1); i++) {
    const vectors = [firstNodes[i], lastNodes[i]].flatMap((p) => [
      { x: p.x - (p.in ?? p).x, y: p.y - (p.in ?? p).y },
      { x: (p.out ?? p).x - p.x, y: (p.out ?? p).y - p.y },
    ]);
    // Scale each direction's entire time trajectory independently. Positive constant
    // factors preserve cross/dot signs and linear interpolation; a shared scale
    // incorrectly makes a short neighboring segment look like a zero direction.
    const scales = [0, 1].map((j) =>
      Math.max(
        Math.abs(vectors[j].x),
        Math.abs(vectors[j].y),
        Math.abs(vectors[j + 2].x),
        Math.abs(vectors[j + 2].y),
      ),
    );
    const [a, b, c, d] = vectors.map((p, j) => ({
      x: p.x / scales[j % 2],
      y: p.y / scales[j % 2],
    }));
    const stack = [{ a, b, c, d, depth: 0 }];
    const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
    const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
    while (stack.length) {
      if (++work.visits > 200000) throw new Error('Curve tangent validation exceeds its work budget.');
      const q = stack.pop()!;
      const products = (op: typeof cross) => [
        op(q.a, q.b),
        (op(q.a, q.d) + op(q.c, q.b)) / 2,
        op(q.c, q.d),
      ];
      const crosses = products(cross),
        dots = products(dot);
      if (
        crosses.every((v) => v > EPS) ||
        crosses.every((v) => v < -EPS) ||
        dots.every((v) => v > EPS)
      )
        continue;
      if (
        q.depth >= 24 ||
        (crosses.every((v) => Math.abs(v) <= EPS) && dots.every((v) => v < -EPS))
      )
        throw new Error('Curve join tangents may reverse direction or are numerically unresolved.');
      const incoming = midpoint(q.a, q.c),
        outgoing = midpoint(q.b, q.d);
      stack.push(
        { a: q.a, b: q.b, c: incoming, d: outgoing, depth: q.depth + 1 },
        { a: incoming, b: outgoing, c: q.c, d: q.d, depth: q.depth + 1 },
      );
    }
  }
}
