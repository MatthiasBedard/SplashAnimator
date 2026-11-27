import type { BezierNode, Point, Vector } from '@splash/document';
import { matrix } from './affine';
import { splitCubic, type Cubic } from './curve-fit';

export const STROKE_DISSOLVE_ERROR = 0.25;

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const length = (p: Point) => Math.hypot(p.x, p.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const controls = (a: BezierNode, b: BezierNode): Cubic => [a, a.out ?? a, b.in ?? b, b];

/** Certify both full source spans against the replacement in relative stage space. */
export function prepareDissolveJoin(shape: Vector, a: BezierNode, join: BezierNode, b: BezierNode) {
  if (!join.in || !join.out) return;
  const [m0, m1, m2, m3, x, y] = matrix(shape), det = m0 * m3 - m1 * m2;
  if (![m0, m1, m2, m3, x, y, det].every(Number.isFinite) || det === 0) return;
  const stageDifference = (p: Point, origin: Point): Point => {
    const d = subtract(p, origin);
    return { x: m0 * d.x + m2 * d.y, y: m1 * d.x + m3 * d.y };
  };
  const chord = stageDifference(b, a), span = length(chord);
  const incoming = stageDifference(join, join.in), outgoing = stageDifference(join.out, join);
  const left = length(incoming), right = length(outgoing);
  const epsilon = 64 * Number.EPSILON * Math.max(span, left, right);
  if (![span, left, right].every(l => Number.isFinite(l) && l > epsilon)) return;
  const u = { x: incoming.x / left, y: incoming.y / left };
  const v = { x: outgoing.x / right, y: outgoing.y / right };
  if (dot(u, v) <= 0 || Math.abs(u.x * v.y - u.y * v.x) > 1e-8) return;
  const t = left / (left + right);
  if (!Number.isFinite(t) || t < 1e-6 || t > 1 - 1e-6) return;
  const endControl = (endpoint: Point, handle: Point | undefined, ratio: number): Point => ({
    x: endpoint.x + ((handle?.x ?? endpoint.x) - endpoint.x) / ratio,
    y: endpoint.y + ((handle?.y ?? endpoint.y) - endpoint.y) / ratio,
  });
  const c1 = endControl(a, a.out, t), c2 = endControl(b, b.in, 1 - t);
  if (![c1.x, c1.y, c2.x, c2.y].every(n => Number.isFinite(n) && Math.abs(n) <= 100000))
    return;
  const relative = (c: Cubic) => c.map(point => stageDifference(point, a)) as Cubic;
  const original = [relative(controls(a, join)), relative(controls(join, b))];
  const replacement = relative([a, c1, c2, b]);
  const axis = { x: chord.x / span, y: chord.y / span };
  const monotone = (curve: Cubic) => curve.every(finite) &&
    curve.slice(1).every((p, i) => {
      const advance = dot(subtract(p, curve[i]), axis);
      return same(p, curve[i]) || (Number.isFinite(advance) && advance > epsilon);
    });
  if (![...original, replacement].every(monotone)) return;
  const halves = splitCubic(replacement, t);
  if (!original.every((curve, side) => curve.every((p, i) =>
    length(subtract(p, halves[side][i])) <= STROKE_DISSOLVE_ERROR))) return;
  return { c1, c2, epsilon, axis, stageDifference };
}

/** Strict endpoint planes isolate the open stroke edit from the rest of the path. */
export function dissolveStrokeAnchor(shape: Vector, index: number): boolean {
  const nodes = shape.nodes;
  if (shape.kind !== 'bezier' || shape.closed || shape.contours || shape.fillEnabled !== false ||
      !nodes || !Number.isSafeInteger(index) || index <= 0 || index >= nodes.length - 1)
    return false;
  const a = nodes[index - 1], b = nodes[index + 1];
  const join = prepareDissolveJoin(shape, a, nodes[index], b);
  if (!join) return false;
  const { c1, c2, epsilon, axis, stageDifference } = join;
  for (let edge = 0; edge < nodes.length - 1; edge++) {
    if (edge === index - 1 || edge === index) continue;
    const before = edge < index - 1, endpoint = before ? a : b;
    const adjacent = before ? edge === index - 2 : edge === index + 1;
    const sign = before ? -1 : 1;
    if (!controls(nodes[edge], nodes[edge + 1]).every(point => {
      const d = stageDifference(point, endpoint);
      const advance = sign * dot(d, axis);
      return Number.isFinite(advance) && ((adjacent && same(point, endpoint)) || advance > epsilon);
    }))
      return false;
  }
  if (a.out) a.out = c1;
  if (b.in) b.in = c2;
  nodes.splice(index, 1);
  return true;
}
