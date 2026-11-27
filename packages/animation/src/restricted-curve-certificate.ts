import type { Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
type Interval = { lo: number; hi: number };
type Net = Interval[];
const finite = (value: number) => {
  if (!Number.isFinite(value)) throw Error('Restricted curve certificate exceeds numeric limits.');
  return value;
};
const bound = (lo: number, hi: number): Interval => ({ lo: finite(lo), hi: finite(hi) });
function average(a: Interval, b: Interval): Interval {
  const lo = a.lo * 0.5 + b.lo * 0.5,
    hi = a.hi * 0.5 + b.hi * 0.5;
  const margin =
    Number.EPSILON * Math.max(Math.abs(a.lo), Math.abs(a.hi), Math.abs(b.lo), Math.abs(b.hi));
  return bound(lo - margin, hi + margin);
}
function split(net: Net): [Net, Net] {
  const left = [net[0]],
    right = [net[net.length - 1]];
  let level = net;
  while (level.length > 1) {
    level = level.slice(1).map((p, i) => average(level[i], p));
    left.push(level[0]);
    right.push(level[level.length - 1]);
  }
  return [left, right.reverse()];
}
/** Convex Bernstein hulls bound the complete polynomial difference, including
 * near-zero crossings. Outward margins retain subtraction/subdivision
 * uncertainty. One existing-size work budget is shared by both half nets. */
export function certifyRestrictedCurveGeometry(
  expected: readonly Point[],
  actual: readonly Point[],
  work = { visits: 0 },
): void {
  validateLiveGraphicData(expected);
  validateLiveGraphicData(actual);
  validateLiveGraphicData(work);
  if (
    expected.length !== 4 ||
    actual.length !== 4 ||
    !Number.isSafeInteger(work.visits) ||
    work.visits < 0 ||
    work.visits > 131072
  )
    throw Error('Restricted curve certificate requires original cubic controls and work state.');
  const reference: Net[] = ['x', 'y'].map((axis) =>
    expected.map((p) => {
      const v = finite(p[axis as keyof Point] as number);
      return bound(v, v);
    }),
  );
  certify(reference, actual, work);
}

/** Loose roots and unbanked groups keep their original linear translation.
 * The promoted endpoint is still checked continuously, not just at key frames. */
export function certifyRestrictedLinearGeometry(
  from: Point,
  to: Point,
  middle: Point,
  cut: number,
  work = { visits: 0 },
): void {
  validateLiveGraphicData([from, to, middle, work]);
  if (
    !Number.isFinite(cut) ||
    !(cut > 0 && cut < 1) ||
    !Number.isSafeInteger(work.visits) ||
    work.visits < 0 ||
    work.visits > 131072
  )
    throw Error('Choose an original linear interval and work state.');
  const reference = ['x', 'y'].map((axis) => {
    const a = finite(from[axis as keyof Point] as number),
      b = finite(to[axis as keyof Point] as number);
    const value = a * (1 - cut) + b * cut,
      margin = a === b ? 0 : 4 * Number.EPSILON * (Math.abs(a) * (1 - cut) + Math.abs(b) * cut);
    return [bound(a, a), bound(value - margin, value + margin), bound(b, b)];
  });
  certify(
    reference.map((net) => net.slice(0, 2)),
    [from, middle],
    work,
  );
  certify(
    reference.map((net) => net.slice(1)),
    [middle, to],
    work,
  );
}
function certify(reference: Net[], actual: readonly Point[], work: { visits: number }): void {
  const differences: Net[] = ['x', 'y'].map((axis) =>
    actual.map((p, i) => {
      const net = reference[axis === 'x' ? 0 : 1][i],
        value = finite(p[axis as keyof Point] as number);
      const lo = finite(value - net.hi),
        hi = finite(value - net.lo),
        margin = Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi));
      return bound(lo - margin, hi + margin);
    }),
  );
  function visit(reference: Net[], difference: Net[], depth: number): void {
    if (++work.visits > 131072)
      throw Error('Restricted curve certificate exceeded its work budget.');
    if (
      reference.every((net, axis) => {
        const lo = Math.min(...net.map((v) => v.lo)),
          hi = Math.max(...net.map((v) => v.hi));
        const magnitude = lo > 0 ? lo : hi < 0 ? -hi : 0;
        const error = Math.max(
          ...difference[axis].flatMap((v) => [Math.abs(v.lo), Math.abs(v.hi)]),
        );
        return error <= 32 * Number.EPSILON * Math.max(1, magnitude);
      })
    )
      return;
    if (depth >= 20) throw Error('Restricted curve continuous geometry is numerically unresolved.');
    const a = reference.map(split),
      b = difference.map(split);
    visit(
      a.map((n) => n[0]),
      b.map((n) => n[0]),
      depth + 1,
    );
    visit(
      a.map((n) => n[1]),
      b.map((n) => n[1]),
      depth + 1,
    );
  }
  visit(reference, differences, 0);
}

/** Include the original restriction arithmetic itself, rather than treating a
 * rounded blossom control as an exact original polynomial. */
export function certifyRestrictedOriginalCurve(
  cubic: readonly Point[],
  from: number,
  to: number,
  origin: Point,
  actual: readonly Point[],
  work = { visits: 0 },
): void {
  validateLiveGraphicData(cubic);
  validateLiveGraphicData(origin);
  validateLiveGraphicData(actual);
  validateLiveGraphicData(work);
  if (
    cubic.length !== 4 ||
    actual.length !== 4 ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    !(from >= 0 && from < to && to <= 1) ||
    !Number.isSafeInteger(work.visits) ||
    work.visits < 0 ||
    work.visits > 131072
  )
    throw Error('Choose original restricted cubic data and work state.');
  const product = (a: Interval, b: Interval) => {
    const values = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi].map(finite),
      margin = Number.EPSILON * Math.max(...values.map(Math.abs));
    return bound(Math.min(...values) - margin, Math.max(...values) + margin);
  };
  const add = (a: Interval, b: Interval) => {
    if (a.lo === 0 && a.hi === 0) return b;
    if (b.lo === 0 && b.hi === 0) return a;
    const lo = a.lo + b.lo,
      hi = a.hi + b.hi,
      margin = Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi));
    return bound(lo - margin, hi + margin);
  };
  const mix = (a: Interval, b: Interval, t: number) => {
    if (t === 0) return a;
    if (t === 1) return b;
    if (t === 0.5) return average(a, b);
    const w = 1 - t,
      margin = Number.EPSILON * Math.abs(w);
    return add(product(a, bound(w - margin, w + margin)), product(b, bound(t, t)));
  };
  const reference: Net[] = ['x', 'y'].map((axis) => {
    const source = cubic.map((p) => {
      const value = finite(p[axis as keyof Point] as number);
      return bound(value, value);
    });
    const blossom = (s: number, t: number, u: number) => {
      const a = mix(source[0], source[1], s),
        b = mix(source[1], source[2], s),
        c = mix(source[2], source[3], s);
      return mix(mix(a, b, t), mix(b, c, t), u);
    };
    const coordinate = finite(origin[axis as keyof Point] as number),
      base = bound(coordinate, coordinate);
    return [
      blossom(from, from, from),
      blossom(from, from, to),
      blossom(from, to, to),
      blossom(to, to, to),
    ].map((p) => add(base, p));
  });
  certify(reference, actual, work);
}
