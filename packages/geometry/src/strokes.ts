import type { MultiPolygon, Polygon } from 'polygon-clipping';
import clipping from './paint-clipping';
import { clone, id, type Point, type Vector } from '@splash/document';
import { flattenCommands, pathCommands, normalizeVector } from './drawing';
import { matrix, mapPoint, inversePoint } from './affine';

/** Expand local stroke paint into polygons before applying the affine basis. */
export function strokePolygons(s: Vector): MultiPolygon {
  if (!s.strokeWidth || s.kind === 'brush' || s.kind === 'text') return [];
  const m = matrix(s);
  const tolerance = 0.1 / Math.max(1, Math.hypot(m[0], m[1], m[2], m[3]));
  const radius = s.strokeWidth / 2,
    polygons: Polygon[] = [];
  const polygon = (points: Point[]) => {
    // Snap trigonometric near-zero noise so tangent disks and bands share exact vertices.
    let ring = points.map(
      (p) => [Math.round(p.x * 1e8) / 1e8, Math.round(p.y * 1e8) / 1e8] as [number, number],
    );
    // Snapping a shallow join or very thin band can merge its two sides.
    // Keep the original vertices when the snapped primitive loses a turn.
    const first = ring[0], next = ring.find(([x, y]) => x !== first[0] || y !== first[1]);
    if (!next || !ring.some(([x, y]) =>
      (x - first[0]) * (next[1] - first[1]) !== (y - first[1]) * (next[0] - first[0]))) {
      ring = points.map(({ x, y }) => [x, y]);
    }
    ring.push([...ring[0]]);
    polygons.push([ring]);
  };
  const disk = (p: Point) => {
    const count = Math.max(
      16,
      Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / radius))),
    );
    if (count > 2048) throw new Error('Stroke cap tolerance is too complex; reduce the transform.');
    polygon(
      Array.from({ length: count }, (_, i) => ({
        x: p.x + radius * Math.cos((i / count) * Math.PI * 2),
        y: p.y + radius * Math.sin((i / count) * Math.PI * 2),
      })),
    );
  };
  for (const raw of flattenCommands(pathCommands(s), tolerance)) {
    const points = raw.filter(
      (p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-8,
    );
    const closed =
      points.length > 2 &&
      Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-8;
    if (closed) points.pop();
    if (points.length < 2) {
      // A nonzero two-knot line below the footprint grid still carries
      // round cap paint. Keep that footprint for selection and erasing.
      if (!s.closed && (s.kind === 'path' || s.kind === 'line') && raw.length === 2 &&
          (raw[0].x !== raw[1].x || raw[0].y !== raw[1].y) && (s.strokeCap ?? 'round') === 'round')
        disk(raw[0]);
      continue;
    }
    const count = closed ? points.length : points.length - 1;
    const directions = Array.from({ length: count }, (_, i) => {
      const a = points[i],
        b = points[(i + 1) % points.length],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    });
    for (let i = 0; i < count; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length],
        d = directions[i],
        n = { x: -d.y * radius, y: d.x * radius };
      const start = !closed && i === 0 && s.strokeCap === 'square' ? radius : 0;
      const end = !closed && i === count - 1 && s.strokeCap === 'square' ? radius : 0;
      polygon([
        { x: a.x - d.x * start + n.x, y: a.y - d.y * start + n.y },
        { x: b.x + d.x * end + n.x, y: b.y + d.y * end + n.y },
        { x: b.x + d.x * end - n.x, y: b.y + d.y * end - n.y },
        { x: a.x - d.x * start - n.x, y: a.y - d.y * start - n.y },
      ]);
    }
    if (!closed && (s.strokeCap ?? 'round') === 'round') {
      disk(points[0]);
      disk(points.at(-1)!);
    }
    for (let i = closed ? 0 : 1; i < (closed ? points.length : points.length - 1); i++) {
      const p = points[i],
        a = directions[(i - 1 + count) % count],
        b = directions[i % count];
      if ((s.strokeJoin ?? 'round') === 'round') {
        disk(p);
        continue;
      }
      // Collinear bands already cover a bevel or miter join, including a
      // reversal. A synthetic triangle here has no interior to union.
      if ((a.x === b.x && a.y === b.y) || (a.x === -b.x && a.y === -b.y)) continue;
      for (const sign of [-1, 1]) {
        const u = { x: p.x - a.y * radius * sign, y: p.y + a.x * radius * sign };
        const v = { x: p.x - b.y * radius * sign, y: p.y + b.x * radius * sign };
        // A shallow turn can have distinct directions but the same represented
        // corner on both bands. Their edges already meet on this side.
        if (u.x === v.x && u.y === v.y) continue;
        const cross = a.x * b.y - a.y * b.x;
        if (s.strokeJoin === 'miter' && Math.abs(cross) > 1e-8) {
          const t = ((v.x - u.x) * b.y - (v.y - u.y) * b.x) / cross;
          const m = { x: u.x + a.x * t, y: u.y + a.y * t };
          if (Math.hypot(m.x - p.x, m.y - p.y) <= radius * 4) {
            polygon([p, u, m, v]);
            continue;
          }
        }
        polygon([p, u, v]);
      }
    }
  }
  let result: MultiPolygon = [];
  for (let i = 0; i < polygons.length; i += 128)
    result = clipping.union(result, ...polygons.slice(i, i + 128));
  return result;
}
export function worldStrokePolygons(s: Vector): MultiPolygon {
  const m = matrix(s);
  return strokePolygons(s).map((p) =>
    p.map((r) =>
      r.map(([x, y]) => {
        const q = mapPoint(m, { x, y });
        return [q.x, q.y];
      }),
    ),
  );
}
/** Recover editable local contours while keeping paint and affine mapping. */
export function polygonVectors(source: Vector, polygons: MultiPolygon, world = false): Vector[] {
  if (source.brush?.opacityProfile && polygons.length)
    throw Error('The remaining paint cannot be flattened with a pressure-opacity profile.');
  const m = matrix(source);
  // Every fragment gets newly built contours. Only the surviving style and
  // authoring metadata need separate copies for each independently editable face.
  const paint = { ...source, points: undefined, nodes: undefined, contours: undefined, brush: undefined };
  return polygons.map((polygon, index) => {
    const s: Vector = {
      ...clone(paint),
      id: index ? id() : source.id,
      kind: 'polygon',
      points: [],
      nodes: undefined,
      brush: undefined,
      closed: true,
      fillEnabled: true,
      strokeWidth: 0,
      fillRule: 'evenodd',
      contours: polygon.map((r) =>
        r.slice(0, -1).map(([x, y]) => (world ? inversePoint(m, { x, y }) : { x, y })),
      ),
    };
    normalizeVector(s);
    return s;
  });
}
export function strokeToFill(s: Vector): Vector[] {
  const polygons = strokePolygons(s);
  if (!polygons.length) return [s];
  const hasFill =
    s.fillEnabled !== false && (['rectangle', 'ellipse', 'polygon'].includes(s.kind) || s.closed);
  const paint: Vector = {
    ...clone(s),
    id: hasFill ? id() : s.id,
    fill: s.stroke,
    bitmap: undefined,
    gradient: undefined,
  };
  return [
    ...(hasFill ? [{ ...clone(s), strokeWidth: 0 }] : []),
    ...polygonVectors(paint, polygons),
  ];
}
