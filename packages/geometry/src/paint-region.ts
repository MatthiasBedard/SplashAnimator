import type { MultiPolygon } from 'polygon-clipping';
import type { Point } from '@splash/document';
export type PaintRegion = MultiPolygon;
export type RegionOperation = {
  current: PaintRegion;
  polygon: Point[];
  mode: 'replace' | 'add' | 'subtract' | 'intersect';
};
export function translateRegion(region: PaintRegion, offset: Point): PaintRegion {
  return region.map((p) => p.map((r) => r.map(([x, y]) => [x + offset.x, y + offset.y])));
}
function ringContains(ring: PaintRegion[number][number], x: number, y: number): boolean {
  // Use the same half-open ray crossing as containsPoint on the existing tuples.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j], ay = a[1], by = b[1];
    if ((ay > y) !== (by > y) && x < ((b[0] - a[0]) * (y - ay)) / (by - ay) + a[0])
      inside = !inside;
  }
  return inside;
}

export function regionContains(region: PaintRegion, { x, y }: Point): boolean {
  for (const polygon of region) {
    if (!ringContains(polygon[0], x, y)) continue;
    let hole = 1;
    while (hole < polygon.length && !ringContains(polygon[hole], x, y)) hole++;
    if (hole === polygon.length) return true;
  }
  return false;
}
