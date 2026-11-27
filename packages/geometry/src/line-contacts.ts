import type { Point } from '@splash/document';
import type { Cubic } from './curve-fit';
import { paintCoordinateUnits } from './paint-winding';

// Round an exact rational to one binary64 coordinate. All pairs meeting at
// the same crossing must produce the same vertex, irrespective of direction.
function quotient(n: bigint, d: bigint, shift = 0): number {
  if (n === 0n) return 0;
  const sign = n < 0n === d < 0n ? 1 : -1;
  if (n < 0n) n = -n;
  if (d < 0n) d = -d;
  if (!shift && n <= 9007199254740991n && d <= 9007199254740991n)
    return (sign * Number(n)) / Number(d);
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? n < d << BigInt(exponent) : n << BigInt(-exponent) < d) exponent--;
  const unit = Math.max(-1074, exponent + shift - 52);
  if (shift >= unit) n <<= BigInt(shift - unit);
  else d <<= BigInt(unit - shift);
  let mantissa = n / d;
  const twiceRemainder = 2n * (n % d);
  if (twiceRemainder > d || (twiceRemainder === d && mantissa & 1n)) mantissa++;
  return sign * Number(mantissa) * 2 ** unit;
}

/** Recover a binary64 coordinate only when its integer units round-trip. */
export function exactCoordinateFromUnits(units: bigint): number | undefined {
  const value = quotient(units, 1n, -1074);
  if (Number.isFinite(value) && paintCoordinateUnits(value) === units) return value;
}

/** Straight Pencil edges include mouse samples exactly at T and X junctions.
 * Compute incidence before rounding either segment's cut parameter. */
export function lineContacts(a: Point, b: Point, c: Point, d: Point) {
  const points = [a, b, c, d];
  const integral = points.every((p) => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y));
  const units = integral ? BigInt : paintCoordinateUnits;
  const exact = points.map((p) => ({ x: units(p.x), y: units(p.y) }));
  const [start, end, otherStart, otherEnd] = exact;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const otherDx = otherEnd.x - otherStart.x,
    otherDy = otherEnd.y - otherStart.y;
  const offsetX = otherStart.x - start.x,
    offsetY = otherStart.y - start.y;
  const denominator = dx * otherDy - dy * otherDx;
  if (!denominator) {
    if (offsetX * dy !== offsetY * dx) return [];
    // Both ends of a shared interval are existing vertices. Partitioning
    // there gives the two traversals exactly the same undirected edge.
    const axis = dx === 0n ? 'y' : 'x';
    const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
    if (low > high) return [];
    return (low === high ? [low] : [low, high]).map((coordinate) => {
      const i = points.findIndex((p) => p[axis] === coordinate);
      const value = exact[i][axis];
      return {
        t: quotient(value - start[axis], end[axis] - start[axis]),
        u: quotient(value - otherStart[axis], otherEnd[axis] - otherStart[axis]),
        point: points[i],
      };
    });
  }
  const numeratorT = offsetX * otherDy - offsetY * otherDx,
    numeratorU = offsetX * dy - offsetY * dx;
  const within = (n: bigint) =>
    denominator > 0n ? n >= 0n && n <= denominator : n <= 0n && n >= denominator;
  if (!within(numeratorT) || !within(numeratorU)) return [];
  const shift = integral ? 0 : -1074;
  const point =
    numeratorT === 0n
      ? a
      : numeratorT === denominator
        ? b
        : numeratorU === 0n
          ? c
          : numeratorU === denominator
            ? d
            : {
                x: quotient(start.x * denominator + dx * numeratorT, denominator, shift),
                y: quotient(start.y * denominator + dy * numeratorT, denominator, shift),
              };
  return [{ t: quotient(numeratorT, denominator), u: quotient(numeratorU, denominator), point }];
}

/** Compare two transverse line crossings before rounding their coordinates. */
export function sameStraightCrossing(start: Point, end: Point,
  first: readonly [Point, Point], second: readonly [Point, Point]) {
  if (![start, end, ...first, ...second].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  const units = paintCoordinateUnits;
  const originX = units(start.x), originY = units(start.y);
  const dx = units(end.x) - originX, dy = units(end.y) - originY;
  const ratio = ([a, b]: readonly [Point, Point]) => {
    const x = units(a.x), y = units(a.y);
    const vx = units(b.x) - x, vy = units(b.y) - y;
    return { numerator: (x - originX) * vy - (y - originY) * vx, denominator: dx * vy - dy * vx };
  };
  const a = ratio(first), b = ratio(second);
  return a.denominator !== 0n && b.denominator !== 0n &&
    a.numerator * b.denominator === b.numerator * a.denominator;
}

const magnitude = (n: bigint) => n < 0n ? -n : n;

/** Refine a close crossing against the original controls. The signed
 * distances must prove a unique root on the open cubic. */
export function uniqueLineCubicContact(start: Point, end: Point, curve: Cubic, charge: (n: number) => void) {
  if (![start, end, ...curve].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
  const units = paintCoordinateUnits;
  const origin = { x: units(start.x), y: units(start.y) };
  const dx = units(end.x) - origin.x, dy = units(end.y) - origin.y;
  if (!dx && !dy) return;
  const x = curve.map(p => units(p.x)), y = curve.map(p => units(p.y));
  const distances = x.map((value, i) => dx * (y[i] - origin.y) - dy * (value - origin.x));
  // Substitute t = s/(1+s) in the Bernstein polynomial. The resulting
  // power coefficients have the same signs, so one sign variation proves
  // one open-interval root, counted with multiplicity.
  const signs = distances.filter(value => value !== 0n).map(value => value > 0n);
  const variations = signs.slice(1).filter((positive, i) => positive !== signs[i]).length;
  if (!distances[0] || !distances[3] || variations !== 1) return;
  const direction = distances[3] > 0n ? 1n : -1n;

  const denominator = 1n << 96n;
  const square = denominator * denominator, cube = square * denominator;
  const evaluate = ([a, b, c, d]: bigint[], t: bigint) => {
    const s = denominator - t;
    return a * s ** 3n + 3n * b * s * s * t + 3n * c * s * t * t + d * t ** 3n;
  };
  let low = 0n, high = denominator;
  while (high - low > 1n) {
    charge(1);
    const middle = (low + high) / 2n;
    const distance = evaluate(distances, middle);
    if (!distance) {
      low = high = middle;
      break;
    }
    if (distance * direction < 0n) low = middle;
    else high = middle;
  }

  // Enclose each coordinate over the final parameter bracket using the
  // derivative control bound. Both ends must round to the same binary64
  // value. A merely close approximation would weld independent vertices.
  const bracket = (values: bigint[]) => {
    const atLow = evaluate(values, low);
    const derivative = values.slice(1).reduce((largest, value, i) => {
      const difference = magnitude(value - values[i]);
      return difference > largest ? difference : largest;
    }, 0n);
    const radius = 3n * derivative * (high - low) * square;
    return { lower: atLow - radius, upper: atLow + radius };
  };
  const bx = bracket(x), by = bracket(y);
  const useX = magnitude(dx) >= magnitude(dy);
  const along = useX ? bx : by, base = (useX ? origin.x : origin.y) * cube, span = (useX ? dx : dy) * cube;
  const limit = base + span;
  if (span > 0n ? along.lower <= base || along.upper >= limit : along.lower <= limit || along.upper >= base)
    return;
  const u = quotient(low, denominator);
  if (!(u > 0 && u < 1 && u === quotient(high, denominator))) return;
  const point = { x: quotient(bx.lower, cube, -1074), y: quotient(by.lower, cube, -1074) };
  if (Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x === quotient(bx.upper, cube, -1074) && point.y === quotient(by.upper, cube, -1074))
    return { u, point };
}
