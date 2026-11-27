import clipping from './paint-clipping';
import type { Vector, Point } from '@splash/document';
import { vectorPolygons } from './merge';
import { worldStrokePolygons } from './strokes';
import { boundsIndex } from './bounds-index';
const EPS = 1e-6;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y) <= EPS;
  const ux = dx / length,
    uy = dy / length;
  const px = p.x - a.x,
    py = p.y - a.y;
  const along = Math.max(0, Math.min(length, px * ux + py * uy));
  // EPS is a document-space distance, not an area that grows relative to short edges.
  return Math.hypot(px - along * ux, py - along * uy) <= EPS;
};
const opposite = (a: number, b: number) => (a < 0 && b > 0) || (a > 0 && b < 0);
const touches = (a: Point, b: Point, c: Point, d: Point) =>
  on(a, c, d) ||
  on(b, c, d) ||
  on(c, a, b) ||
  on(d, a, b) ||
  (opposite(cross(a, b, c), cross(a, b, d)) && opposite(cross(c, d, a), cross(c, d, b)));
/** Connected painted components, without modifying geometry or identities. */
export function connectedPaint(shapes: Vector[], seed: string): Vector[] {
  const entries = shapes.map((shape) => {
    const polygons = [...vectorPolygons(shape), ...worldStrokePolygons(shape)];
    const segments: [Point, Point][] = [];
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          segments.push([
            { x: ring[i - 1][0], y: ring[i - 1][1] },
            { x: ring[i][0], y: ring[i][1] },
          ]);
        }
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const segment of segments)
      for (const p of segment) {
        bounds.left = Math.min(bounds.left, p.x);
        bounds.right = Math.max(bounds.right, p.x);
        bounds.top = Math.min(bounds.top, p.y);
        bounds.bottom = Math.max(bounds.bottom, p.y);
      }
    return {
      shape,
      polygons,
      segments,
      segmentBounds: segments.map(([a, b]) => ({
        left: Math.min(a.x, b.x),
        right: Math.max(a.x, b.x),
        top: Math.min(a.y, b.y),
        bottom: Math.max(a.y, b.y),
      })),
      ...bounds,
    };
  });
  const start = entries.findIndex((e) => e.shape.id === seed);
  if (start < 0) return [];
  const neighbors = boundsIndex(entries);
  // Build boundary indexes only for pairs whose filled intersection did not establish contact.
  const boundaries = new Map<number, ReturnType<typeof boundsIndex>>();
  function boundaryTouches(a: (typeof entries)[number], j: number): boolean {
    const b = entries[j];
    let query = boundaries.get(j);
    if (!query) {
      query = boundsIndex(b.segmentBounds);
      boundaries.set(j, query);
    }
    return a.segments.some(([p, q], i) =>
      query(a.segmentBounds[i], EPS).some((index) => {
        const [r, s] = b.segments[index];
        return touches(p, q, r, s);
      }),
    );
  }
  const selected = new Set([start]),
    queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const a = entries[queue[i]];
    for (const j of neighbors(a, EPS)) {
      if (selected.has(j)) continue;
      const b = entries[j];
      if (
        a.right + EPS < b.left ||
        b.right + EPS < a.left ||
        a.bottom + EPS < b.top ||
        b.bottom + EPS < a.top
      )
        continue;
      if (clipping.intersection(a.polygons, b.polygons).length || boundaryTouches(a, j)) {
        selected.add(j);
        queue.push(j);
      }
    }
  }
  return shapes.filter((_, i) => selected.has(i));
}
