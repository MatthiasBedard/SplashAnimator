import type { Vector } from './index';
import { expandSelection, inScope } from './groups';
export type PaintPart = 'fill' | 'stroke';
/** Stored paint identity, independent of geometry and object transforms. */
export function paintKey(s: Vector, part: PaintPart): string | undefined {
  const opacity = s.opacity ?? 1;
  if (part === 'stroke') {
    if (!s.strokeWidth || s.kind === 'brush') return;
    return JSON.stringify([
      s.stroke.toLowerCase(),
      s.strokeWidth,
      s.strokeCap ?? 'round',
      s.strokeJoin ?? 'round',
      opacity,
    ]);
  }
  if (
    s.fillEnabled === false ||
    !(s.closed || ['rectangle', 'ellipse', 'polygon', 'brush', 'text'].includes(s.kind))
  )
    return;
  if (s.bitmap) return JSON.stringify([opacity, s.bitmap]);
  const g = s.gradient;
  return JSON.stringify(
    g
      ? [
          opacity,
          g.kind,
          g.transform ?? [1, 0, 0, 1],
          g.from.x,
          g.from.y,
          g.to.x,
          g.to.y,
          g.stops.map((stop) => [stop.offset, stop.color.toLowerCase(), stop.opacity ?? 1]),
        ]
      : [opacity, s.fill.toLowerCase()],
  );
}
export function selectMatchingPaint(
  shapes: Vector[],
  source: Vector,
  part: PaintPart,
  scope: string[],
): string[] {
  const key = paintKey(source, part);
  if (key === undefined || !inScope(source, scope)) return [];
  const matches = shapes
    .filter((s) => inScope(s, scope) && paintKey(s, part) === key)
    .map((s) => s.id);
  return expandSelection(shapes, matches, scope);
}
