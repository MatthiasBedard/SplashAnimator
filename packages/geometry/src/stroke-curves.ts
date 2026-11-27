import type { Point, Vector, BezierNode } from '../../document/src';
import { inversePoint, matrix } from './affine';
import { splitCubic, type Cubic } from './curve-fit';
import type { CurveTrace } from './drawing';

/** Reassemble original cubic intervals across subdivision-only vertices. Actual
 * arrangement junctions remain fixed; this never fits or smooths earlier ink. */
export function mergedStrokeNodes(
  edges: { a: Point; b: Point; curve?: CurveTrace }[],
  source: Vector,
  closed: boolean,
): BezierNode[] | undefined {
  if (!edges.some((e) => e.curve)) return;
  const contiguous = (a: (typeof edges)[number], b: (typeof edges)[number]) =>
    !!a.curve &&
    !!b.curve &&
    a.curve.curve === b.curve.curve &&
    Math.abs(a.curve.end - b.curve.start) <= Number.EPSILON * 64;
  // A closed walk can begin at a subdivision inside a corner. Start at an
  // original interval boundary so its closing seam does not save an extra node.
  if (closed) {
    const start = edges.findIndex(
      (edge, i) => !contiguous(edges[(i + edges.length - 1) % edges.length], edge),
    );
    if (start > 0) edges = [...edges.slice(start), ...edges.slice(0, start)];
  }
  const spans: typeof edges = [];
  for (const edge of edges) {
    const previous = spans.at(-1);
    if (previous?.curve && edge.curve && contiguous(previous, edge)) {
      previous.b = edge.b;
      previous.curve = { ...previous.curve, end: edge.curve.end };
    } else spans.push({ ...edge, curve: edge.curve ? { ...edge.curve } : undefined });
  }
  const m = matrix(source);
  const local = (p: Point) => {
    const q = inversePoint(m, p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
      throw Error('Merged stroke curve exceeds finite geometry.');
    return q;
  };
  const nodes: BezierNode[] = [local(spans[0].a)];
  for (const span of spans) {
    let curve: Cubic;
    if (span.curve) {
      const { start, end } = span.curve,
        low = Math.min(start, end),
        high = Math.max(start, end);
      curve = high === 1 ? span.curve.curve : splitCubic(span.curve.curve, high)[0];
      if (low > 0) curve = splitCubic(curve, low / high)[1];
      if (start > end) curve = [curve[3], curve[2], curve[1], curve[0]];
      // Preserve the original handle offsets while sharing the arrangement's
      // exact intersection anchor, within its existing flattening tolerance.
      curve = [
        span.a,
        { x: span.a.x + (curve[1].x - curve[0].x), y: span.a.y + (curve[1].y - curve[0].y) },
        { x: span.b.x + (curve[2].x - curve[3].x), y: span.b.y + (curve[2].y - curve[3].y) },
        span.b,
      ];
    } else {
      curve = [
        span.a,
        { x: span.a.x + (span.b.x - span.a.x) / 3, y: span.a.y + (span.b.y - span.a.y) / 3 },
        {
          x: span.a.x + (2 * (span.b.x - span.a.x)) / 3,
          y: span.a.y + (2 * (span.b.y - span.a.y)) / 3,
        },
        span.b,
      ];
    }
    nodes.at(-1)!.out = local(curve[1]);
    nodes.push({ ...local(curve[3]), in: local(curve[2]) });
  }
  if (closed) {
    nodes[0].in = nodes.at(-1)!.in;
    nodes.pop();
  }
  return nodes;
}
