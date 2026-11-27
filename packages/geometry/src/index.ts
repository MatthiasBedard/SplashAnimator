import type { Point, Vector } from '@splash/document';
import { brushDabs, containsPoint, flattenCommands, pathCommands, windingNumber } from './drawing';
export * from './drawing';
export * from './pencil';
export * from './layout';
export * from './affine';
import { matrix, mapPoint, inversePoint } from './affine';
export function localPoint(s: Vector, p: Point): Point {
  return inversePoint(matrix(s), p);
}
export function worldPoint(s: Vector, p: Point): Point {
  return mapPoint(matrix(s), p);
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
export function hitPart(s: Vector, p: Point, tolerance = 5): 'fill' | 'stroke' | null {
  const q = localPoint(s, p);
  if (s.kind === 'text' || s.kind === 'symbol')
    return q.x >= 0 && q.y >= 0 && q.x <= s.width && q.y <= s.height ? 'fill' : null;
  if (s.kind === 'brush') {
    if (s.fillEnabled === false) return null;
    for (const d of brushDabs(s)) {
      const x = (q.x - d.x) * Math.cos(d.angle) + (q.y - d.y) * Math.sin(d.angle),
        y = -(q.x - d.x) * Math.sin(d.angle) + (q.y - d.y) * Math.cos(d.angle);
      if ((x / (d.rx + tolerance)) ** 2 + (y / (d.ry + tolerance)) ** 2 <= 1) return 'fill';
    }
    return null;
  }
  const paths = flattenCommands(pathCommands(s));
  if (
    s.strokeWidth &&
    paths.some((points) =>
      points.some(
        (b, i) => i && segmentDistance(q, points[i - 1], b) <= tolerance + s.strokeWidth / 2,
      ),
    )
  )
    return 'stroke';
  if (
    s.fillEnabled !== false &&
    (['rectangle', 'ellipse', 'polygon'].includes(s.kind) || s.closed) &&
    (s.fillRule === 'evenodd'
      ? paths.reduce((inside, points) => inside !== containsPoint(points, q), false)
      : paths.reduce((winding, points) => winding + windingNumber(points, q), 0) !== 0)
  )
    return 'fill';
  return null;
}
export function hit(s: Vector, p: Point, tolerance = 5): boolean {
  return hitPart(s, p, tolerance) !== null;
}
/** Split editable centerlines against an eraser capsule, interpolating pressure at each cut. */
export function eraseStroke(s: Vector, from: Point, to: Point, radius: number): Vector[] {
  if (!['path', 'line', 'brush'].includes(s.kind)) return [s];
  const points = s.points.length
    ? s.points
    : [
        { x: 0, y: 0 },
        { x: s.width, y: s.height },
      ];
  const a = localPoint(s, from),
    b = localPoint(s, to),
    runs: Point[][] = [];
  let run: Point[] = [],
    erased = false;
  const inside = (p: Point) => segmentDistance(p, a, b) <= radius;
  const interpolate = (p: Point, q: Point, t: number): Point => ({
    ...p,
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
    pressure: (p.pressure ?? 1) + ((q.pressure ?? 1) - (p.pressure ?? 1)) * t,
    tiltX: (p.tiltX ?? 0) + ((q.tiltX ?? 0) - (p.tiltX ?? 0)) * t,
    tiltY: (p.tiltY ?? 0) + ((q.tiltY ?? 0) - (p.tiltY ?? 0)) * t,
  });
  const samples: Point[] = points.length ? [points[0]] : [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i],
      count = Math.min(
        4096,
        Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / Math.max(0.5, radius / 4))),
      );
    for (let j = 1; j <= count; j++) samples.push(interpolate(p, q, j / count));
  }
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i],
      cut = inside(p);
    erased ||= cut;
    if (i && cut !== inside(samples[i - 1])) {
      let lo = 0,
        hi = 1;
      const previous = samples[i - 1],
        previousInside = inside(previous);
      for (let j = 0; j < 20; j++) {
        const t = (lo + hi) / 2;
        if (inside(interpolate(previous, p, t)) === previousInside) lo = t;
        else hi = t;
      }
      const edge = interpolate(previous, p, (lo + hi) / 2);
      if (cut) {
        run.push(edge);
        if (run.length) runs.push(run);
        run = [];
      } else run.push(edge);
    }
    if (!cut) run.push(p);
  }
  if (run.length) runs.push(run);
  if (!erased) return [s];
  return runs
    .filter((r) => r.length >= (s.kind === 'brush' ? 1 : 2))
    .map((r, i) => ({
      ...s,
      id: i ? crypto.randomUUID() : s.id,
      kind: s.kind === 'line' ? 'path' : s.kind,
      points: r,
    }));
}
