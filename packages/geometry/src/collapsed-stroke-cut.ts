import type { Point } from '@splash/document';
import { exactCoordinateFromUnits } from './line-contacts';
import { paintCoordinateUnits } from './paint-winding';

type Boundary = { a: Point; b: Point; ring: number };
type Ring = { polygon: number; outer: boolean };
type ExactPoint = { x: bigint; y: bigint };
type Time = { n: bigint; d: bigint };
const units = (p: Point): ExactPoint => ({ x: paintCoordinateUnits(p.x), y: paintCoordinateUnits(p.y) });
const subtract = (a: ExactPoint, b: ExactPoint): ExactPoint => ({ x: a.x-b.x, y: a.y-b.y });
const cross = (a: ExactPoint, b: ExactPoint) => a.x*b.y - a.y*b.x;
const order = (a: Time, b: Time) => a.n*b.d - b.n*a.d;

/** The caller has proved all translated points round into the same world
 * cell. Intersect and classify there without rounding away the local line. */
export function cutCollapsedStrokeLine(
  span: [Point, Point], origin: Point, boundaries: Boundary[], ray: () => Boundary[], rings: Ring[],
) {
  const start = units(span[0]), delta = subtract(units(span[1]), start), offset = units(origin);
  const world = { x: start.x + offset.x, y: start.y + offset.y };
  const times: Time[] = [{ n:0n,d:1n }, { n:1n,d:1n }];
  for (const { a, b } of boundaries) {
    const first = units(a), direction = subtract(units(b), first), from = subtract(first, world);
    const denominator = cross(delta, direction);
    if (!denominator) {
      if (!cross(from, delta)) return;
      continue;
    }
    const sign = denominator < 0n ? -1n : 1n;
    const d = denominator*sign, n = cross(from, direction)*sign, u = cross(from, delta)*sign;
    if (n > 0n && n < d && u >= 0n && u <= d) times.push({ n,d });
  }
  times.sort((a,b) => { const difference = order(a,b); return difference < 0n ? -1 : difference > 0n ? 1 : 0; });
  const unique = times.filter((time,i) => !i || order(time,times[i-1]) !== 0n);
  const intervals: { span: [Point, Point]; inside: boolean }[] = [];
  let a = span[0];
  for (let i = 1; i < unique.length; i++) {
    const from = unique[i-1], to = unique[i];
    const n = from.n*to.d + to.n*from.d, d = 2n*from.d*to.d;
    const point = { x:world.x*d + delta.x*n, y:world.y*d + delta.y*n };
    const crossed = new Set<number>();
    for (const { a, b, ring } of ray()) {
      const signed = (p: Point) => { const exact = units(p); return { x:exact.x*d-point.x, y:exact.y*d-point.y }; };
      const u = signed(a), v = signed(b), turn = cross(u,v);
      if (!turn && u.x*v.x <= 0n && u.y*v.y <= 0n) return;
      if ((u.y > 0n) !== (v.y > 0n) && (turn > 0n) === (v.y > u.y)) {
        if (crossed.has(ring)) crossed.delete(ring);
        else crossed.add(ring);
      }
    }
    const exterior = new Set<number>(), holes = new Set<number>();
    for (const ring of crossed) (rings[ring].outer ? exterior : holes).add(rings[ring].polygon);
    let b = span[1];
    if (i < unique.length-1) {
      const x = start.x*to.d + delta.x*to.n, y = start.y*to.d + delta.y*to.n;
      if (x%to.d || y%to.d) return;
      const exactX = exactCoordinateFromUnits(x/to.d), exactY = exactCoordinateFromUnits(y/to.d);
      if (exactX === undefined || exactY === undefined) return;
      b = { x:exactX,y:exactY };
    }
    intervals.push({ span:[a,b], inside:[...exterior].some(polygon => !holes.has(polygon)) });
    a = b;
  }
  return intervals;
}
