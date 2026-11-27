import type { Point } from '@splash/document';
import { splitCubic, type Cubic } from './curve-fit';

const epsilon = 64 * Number.EPSILON;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scaleBy = (p: Point, scale: number): Point => ({ x: p.x * scale, y: p.y * scale });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const magnitude = (p: Point) => Math.hypot(p.x, p.y);
const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const value = (curve: Cubic, t: number) => splitCubic(curve, t)[0][3];
const derivativeControls = (curve: Cubic) => curve.slice(1).map((p, i) => scaleBy(subtract(p, curve[i]), 3));
const derivative = (curve: Cubic, t: number) => {
  const u = 1 - t, [a, b, c] = derivativeControls(curve);
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
};
function overlaps(a: Cubic, b: Cubic) {
  const test = (l: number[], r: number[]) => Math.max(...l) + epsilon >= Math.min(...r) &&
    Math.max(...r) + epsilon >= Math.min(...l);
  for (const axis of ['x', 'y'] as const)
    if (!test(a.map(p => p[axis]), b.map(p => p[axis]))) return false;
  // Endpoint chord normals cheaply separate nearly parallel oblique pieces.
  // The controls bound the actual curve's projection onto any such axis.
  for (const curve of [a, b]) {
    const chord = subtract(curve[3], curve[0]), length = magnitude(chord);
    if (length <= epsilon) continue;
    const axis = scaleBy(chord, 1 / length);
    if (!test(a.map(p => cross(axis, p)), b.map(p => cross(axis, p)))) return false;
  }
  return true;
}

type Interval = { curve: Cubic; low: number; high: number };
function split(interval: Interval): [Interval, Interval] {
  const [a, b] = splitCubic(interval.curve, .5), middle = (interval.low + interval.high) / 2;
  return [{ curve: a, low: interval.low, high: middle }, { curve: b, low: middle, high: interval.high }];
}

function inverseJacobian(a: Cubic, b: Cubic, t: number, u: number) {
  const left = derivative(a, t), right = scaleBy(derivative(b, u), -1);
  const determinant = cross(left, right);
  if (Math.abs(determinant) <= epsilon * Math.max(1, magnitude(left) * magnitude(right))) return;
  return {
    left, right,
    solve: (p: Point): Point => ({ x: cross(p, right) / determinant, y: cross(left, p) / determinant }),
  };
}

function crossingNear(a: Cubic, b: Cubic, first: Interval, second: Interval) {
  let t = (first.low + first.high) / 2, u = (second.low + second.high) / 2;
  for (let step = 0; step < 10; step++) {
    const jacobian = inverseJacobian(a, b, t, u);
    if (!jacobian) return;
    const next = jacobian.solve(subtract(value(a, t), value(b, u)));
    t -= next.x;
    u -= next.y;
    if (!(t > 0 && t < 1 && u > 0 && u < 1)) return;
    if (Math.max(Math.abs(next.x), Math.abs(next.y)) <= epsilon) break;
  }
  if (t < first.low - epsilon || t > first.high + epsilon || u < second.low - epsilon || u > second.high + epsilon) return;
  const jacobian = inverseJacobian(a, b, t, u);
  if (!jacobian) return;
  const point = value(a, t), residual = subtract(point, value(b, u));
  if (magnitude(residual) > epsilon * 4) return;
  const needed = Math.max(t - first.low, first.high - t, u - second.low, second.high - u);
  const radius = Math.min(needed * 1.01, t / 2, (1 - t) / 2, u / 2, (1 - u) / 2);
  if (!(radius > epsilon)) return;

  // For G = identity - J⁻¹(A - B), bound both Jacobian columns over a
  // box around the proposal. A strict contraction mapping into this box
  // certifies an actual unique root and excludes grazing false positives.
  const column = (curve: Cubic, center: number, original: Point, sign: number) => {
    const end = center + radius, start = center - radius;
    const restriction = splitCubic(splitCubic(curve, end)[0], start / end)[1];
    const deltas = derivativeControls(restriction).map(d => jacobian.solve(subtract(
      scaleBy(d, sign / (end - start)), original,
    )));
    return { x: Math.max(...deltas.map(p => Math.abs(p.x))), y: Math.max(...deltas.map(p => Math.abs(p.y))) };
  };
  const L = column(a, t, jacobian.left, 1), R = column(b, u, jacobian.right, -1);
  const offset = jacobian.solve(residual);
  if (!(Math.max(L.x + R.x, L.y + R.y) < .5 && Math.max(Math.abs(offset.x), Math.abs(offset.y)) < radius / 4)) return;
  return { t, u, point, complete: radius >= needed };
}

/** Exact cubic control hulls drive the search. Null denotes exhausted work, so
 * callers can drop the optional snap instead of publishing an order-dependent hit. */
export function cubicCrossings(a: Cubic, b: Cubic, budget = { remaining: 4096 }): Point[] | null {
  return curveContacts(a, b, budget, false)?.map(hit => hit.point) ?? null;
}

/** Geometry-changing cuts require both original parameters and complete
 * coverage of every intersecting hull pair. An uncertain contact declines. */
export function transverseCubicContacts(a: Cubic, b: Cubic, budget: { remaining: number }, includeEnds = false) {
  return curveContacts(a, b, budget, true, includeEnds);
}

// At a known join, exclude only a parameter box in which a plane through
// the anchor strictly separates the open control hulls. The rest of the
// pair still participates in the ordinary crossing search.
function separatedAtJoin(first: Interval, second: Interval, t: number, u: number) {
  if ((t === 0 ? first.low !== 0 : first.high !== 1) ||
      (u === 0 ? second.low !== 0 : second.high !== 1)) return false;
  const origin = first.curve[t === 0 ? 0 : 3];
  const away = (c: Cubic, end: number) => (end === 0 ? c.slice(1) : c.slice(0,3).reverse())
    .map(p => subtract(p,origin)).filter(p => p.x || p.y);
  const left = away(first.curve,t), right = away(second.curve,u);
  if (!left.length || !right.length) return false;
  const axis = subtract(scaleBy(left[0],1/magnitude(left[0])),scaleBy(right[0],1/magnitude(right[0])));
  const dot = (p: Point) => p.x*axis.x + p.y*axis.y;
  return left.every(p => dot(p) > epsilon) && right.every(p => dot(p) < -epsilon);
}

function separatedAtSupport(a: Cubic, b: Cubic, same: (p: Point, q: Point) => boolean) {
  for (const axis of ['x', 'y'] as const) {
    const aMin = Math.min(a[0][axis], a[1][axis], a[2][axis], a[3][axis]);
    const aMax = Math.max(a[0][axis], a[1][axis], a[2][axis], a[3][axis]);
    const bMin = Math.min(b[0][axis], b[1][axis], b[2][axis], b[3][axis]);
    const bMax = Math.max(b[0][axis], b[1][axis], b[2][axis], b[3][axis]);
    if (aMax < bMin || bMax < aMin) return true;
    const plane = aMax === bMin ? aMax : bMax === aMin ? bMax : undefined;
    if (plane === undefined || aMin === aMax || bMin === bMax) continue;
    // Interior Bernstein weights are positive. A nonconstant curve reaches
    // its supporting plane only at the endpoints on that plane.
    if (![a[0], a[3]].some(p => p[axis] === plane && (same(p, b[0]) || same(p, b[3])))) return true;
  }
  return false;
}

function curveContacts(a: Cubic, b: Cubic, budget: { remaining: number }, strict: boolean, includeEnds = false) {
  if (![...a, ...b].every(finite)) return strict ? null : [];
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  if (a.every((p, i) => same(p, b[i])) || a.every((p, i) => same(p, b[3 - i]))) return strict ? null : [];
  const origin = a[0], relative = [...a, ...b].map(p => subtract(p, origin));
  const extent = Math.max(...relative.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
  if (!(extent > 0 && Number.isFinite(extent))) return strict ? null : [];
  if (strict && budget.remaining > 0 && separatedAtSupport(a, b, same)) {
    budget.remaining--;
    return [];
  }
  const normalized = relative.map(p => ({ x: p.x / extent, y: p.y / extent }));
  const left = normalized.slice(0, 4) as Cubic, right = normalized.slice(4) as Cubic;
  const ends = [0, 1] as const;
  const joins = includeEnds ? ends.flatMap(t => ends.flatMap(u => same(a[3*t],b[3*u]) ? [{t,u,point:a[3*t]}] : [])) : [];
  const stack: [Interval, Interval][] = [[{ curve: left, low: 0, high: 1 }, { curve: right, low: 0, high: 1 }]];
  const roots: NonNullable<ReturnType<typeof crossingNear>>[] = [];
  while (stack.length) {
    if (--budget.remaining < 0) return null;
    const [first, second] = stack.pop()!;
    if (!overlaps(first.curve, second.curve)) continue;
    if (joins.some(({t,u}) => separatedAtJoin(first,second,t,u))) continue;
    const width = first.high - first.low, height = second.high - second.low;
    if (Math.max(width, height) <= 1 / 8) {
      const root = crossingNear(left, right, first, second);
      if (root && !roots.some(p => Math.abs(p.t - root.t) <= epsilon * 8 && Math.abs(p.u - root.u) <= epsilon * 8))
        roots.push(root);
      if (root?.complete) continue;
      // A previous stroke can leave a perfectly valid crossing very close
      // to the end of a sub-curve. Its proof box must fit on that sub-curve.
      // Keep refining strict candidates under the same shared work budget.
      if (Math.max(width, height) <= (strict ? 2 ** -32 : 1 / 16384)) {
        if (strict) return null;
        continue;
      }
    }
    if (width >= height) for (const half of split(first)) stack.push([half, second]);
    else for (const half of split(second)) stack.push([first, half]);
  }
  return roots.map(({ t, u, point }) => ({
    t, u, point: { x: origin.x + point.x * extent, y: origin.y + point.y * extent },
  })).filter(hit => finite(hit.point)).concat(joins).sort((p, q) => p.t - q.t || p.u - q.u);
}
