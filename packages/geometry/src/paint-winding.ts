import type { MultiPolygon, Polygon } from 'polygon-clipping';

const bits = new DataView(new ArrayBuffer(8));
/** Express a finite double in units of Number.MIN_VALUE. */
export function paintCoordinateUnits(value: number): bigint {
  bits.setFloat64(0, Math.abs(value));
  const raw = bits.getBigUint64(0), exponent = raw >> 52n;
  const mantissa = raw & ((1n << 52n) - 1n);
  const magnitude = exponent ? ((1n << 52n) + mantissa) << (exponent - 1n) : mantissa;
  return value < 0 ? -magnitude : magnitude;
}

type Point = [number, number];
type ExactPoint = { point: Point; x: bigint; y: bigint };
const exactPoint = (point: Point): ExactPoint => ({
  point, x: paintCoordinateUnits(point[0]), y: paintCoordinateUnits(point[1]),
});
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const turn = (a: ExactPoint, b: ExactPoint, c: ExactPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const opposite = (a: bigint, b: bigint) => (a < 0n && b > 0n) || (a > 0n && b < 0n);
const between = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
const on = (a: ExactPoint, b: ExactPoint, c: ExactPoint) =>
  between(c.point[0], a.point[0], b.point[0]) && between(c.point[1], a.point[1], b.point[1]);

/** Build nonzero fill from simple boundaries with no crossings. Each pair may
 * share one point. Test containment away from that pair's contact. The caller
 * charges the worst-case edge and containment work before entering. */
export function separatedNonzeroPaint(source: Polygon): MultiPolygon | undefined {
  const edges: { ring: number; at: number; a: ExactPoint; b: ExactPoint }[] = [];
  const rings = source.map((ring, index) => {
    const open = ring.filter((p, i) => !i || !same(p, ring[i - 1]));
    if (open.length > 1 && same(open[0], open[open.length - 1])) open.pop();
    const points = open.map(exactPoint);
    let area = 0n, reverses = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
      area += a.x * b.y - b.x * a.y;
      if (turn(a, b, c) === 0n && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0n)
        reverses = true;
      edges.push({ ring: index, at: i, a, b });
    }
    return { index, points, area: area < 0n ? -area : area, sign: area < 0n ? -1 : 1, reverses };
  });
  if (rings.some(r => !r.area || r.reverses)) return;
  const contacts = new Map<number, Point>();
  const pairKey = (first: number, second: number) =>
    Math.min(first, second) * rings.length + Math.max(first, second);
  for (let i = 0; i < edges.length; i++) {
    const { ring, at, a, b } = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const { ring: other, at: next, a: c, b: d } = edges[j];
      if (ring === other && (next === at + 1 || (!at && next === rings[ring].points.length - 1))) continue;
      if (![0, 1].every(axis => Math.min(a.point[axis], b.point[axis]) <= Math.max(c.point[axis], d.point[axis]) &&
          Math.min(c.point[axis], d.point[axis]) <= Math.max(a.point[axis], b.point[axis]))) continue;
      const ac = turn(a, b, c), ad = turn(a, b, d), ca = turn(c, d, a), cb = turn(c, d, b);
      if (opposite(ac, ad) && opposite(ca, cb)) return;
      if (ac && ad && ca && cb) continue;
      for (const point of [
        !ac && on(a, b, c) ? c.point : undefined,
        !ad && on(a, b, d) ? d.point : undefined,
        !ca && on(c, d, a) ? a.point : undefined,
        !cb && on(c, d, b) ? b.point : undefined,
      ]) {
        if (!point) continue;
        if (ring === other) return;
        const key = pairKey(ring, other), contact = contacts.get(key);
        if (contact && !same(contact, point)) return;
        contacts.set(key, point);
      }
    }
  }
  const contains = (points: ExactPoint[], p: ExactPoint) => {
    let inside = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a.point[1] > p.point[1]) !== (b.point[1] > p.point[1]) &&
          (turn(a, b, p) > 0n) === (b.point[1] > a.point[1])) inside = !inside;
    }
    return inside;
  };
  const ordered = rings.sort((a, b) => a.area > b.area ? -1 : a.area < b.area ? 1 : 0)
    .map(ring => ({ ...ring, winding: 0, owner: undefined as Polygon | undefined }));
  const result: MultiPolygon = [];
  for (let i = 0; i < ordered.length; i++) {
    const ring = ordered[i];
    // A simple closed ring minus one contact point stays connected, so a
    // non-contact vertex determines which side of the other ring it occupies.
    let parent = i - 1;
    while (parent >= 0) {
      const candidate = ordered[parent];
      const contact = contacts.get(pairKey(ring.index, candidate.index));
      const [first, next] = ring.points;
      const sample = contact && same(first.point, contact) ? next : first;
      if (contains(candidate.points, sample)) break;
      parent--;
    }
    const outer = ordered[parent];
    ring.winding = (outer?.winding ?? 0) + ring.sign;
    ring.owner = outer?.owner;
    if (!!ring.winding === !!outer?.winding) continue;
    const boundary = ring.points.map(({ point }): Point => [...point]);
    boundary.push([...boundary[0]]);
    if (ring.winding) {
      ring.owner = [boundary];
      result.push(ring.owner);
    } else {
      ring.owner!.push(boundary);
      ring.owner = undefined;
    }
  }
  return result;
}

/** Cancel one shared interval whose two traversals contribute opposite winding.
 * Publish only if the remaining walks form a certified simple boundary. */
export function joinNonzeroPaintSeam(first: Point[], second: Point[]): MultiPolygon | undefined {
  const rings = [first, second].map(ring => {
    const open = ring.filter((point, i) => !i || !same(point, ring[i - 1]));
    if (open.length > 1 && same(open[0], open[open.length - 1])) open.pop();
    return open.map(exactPoint);
  });
  const [firstRing, secondRing] = rings;
  let seam: { firstIndex: number; secondIndex: number; start: Point; end: Point } | undefined;
  for (let i = 0; i < firstRing.length; i++) {
    const a = firstRing[i], b = firstRing[(i + 1) % firstRing.length];
    const axis = a.point[0] !== b.point[0] ? 0 : 1;
    const direction = a.point[axis] < b.point[axis] ? 1 : -1;
    const before = (p: ExactPoint, q: ExactPoint) => direction * p.point[axis] < direction * q.point[axis];
    for (let j = 0; j < secondRing.length; j++) {
      const c = secondRing[j], d = secondRing[(j + 1) % secondRing.length];
      if (!before(d, c)) continue;
      const start = before(a, d) ? d : a, end = before(b, c) ? b : c;
      if (!before(start, end) || turn(a, b, c) !== 0n || turn(a, b, d) !== 0n) continue;
      if (seam) return;
      seam = { firstIndex: i, secondIndex: j, start: start.point, end: end.point };
    }
  }
  if (!seam) return;
  const remainingWalk = (ring: ExactPoint[], edge: number) =>
    ring.slice(edge + 1).concat(ring.slice(0, edge + 1)).map(({ point }) => point);
  return separatedNonzeroPaint([[
    seam.end, ...remainingWalk(firstRing, seam.firstIndex),
    seam.start, ...remainingWalk(secondRing, seam.secondIndex),
  ]]);
}
