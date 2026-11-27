import type { MultiPolygon } from 'polygon-clipping';
import clipping from './paint-clipping';
import type { Vector } from '@splash/document';
import { contains, vectorPolygons } from './merge';
import { polygonVectors, worldStrokePolygons } from './strokes';
import { matrix, mapPoint } from './affine';
export type BrushPaintMode = 'normal' | 'behind' | 'fills' | 'selection' | 'inside';
export function brushPaint(
  shapes: Vector[],
  brush: Vector,
  mode: BrushPaintMode,
  selected: string[] = [],
  footprint: Vector[] = [brush],
): Vector[] {
  if (mode === 'normal' || mode === 'behind') return footprint;
  const point = mapPoint(matrix(brush), brush.points[0] ?? { x: 0, y: 0 });
  const candidates = mode === 'selection' ? shapes.filter((s) => selected.includes(s.id)) : shapes;
  let mask: MultiPolygon = [];
  let outside = false;
  if (mode === 'inside') {
    const target = [...candidates].reverse().find((s) => contains(vectorPolygons(s), point));
    if (target) mask = vectorPolygons(target).filter((p) => contains([p], point));
    else {
      outside = true;
      for (const s of shapes) mask = clipping.union(mask, vectorPolygons(s));
    }
  } else {
    for (const s of candidates) {
      const polygons = vectorPolygons(s);
      if (polygons.length) mask = clipping.union(mask, polygons);
    }
  }
  if (!mask.length && mode === 'selection') return [];
  const paint = footprint.reduce<MultiPolygon>(
    (paint, s) => clipping.union(paint, vectorPolygons(s)),
    [],
  );
  let result =
    mode === 'fills'
      ? paint
      : outside
        ? mask.length
          ? clipping.difference(paint, mask)
          : paint
        : clipping.intersection(paint, mask);
  // Preserve visible linework in object mode as well as merge mode.
  for (const s of shapes) {
    const outline = worldStrokePolygons(s);
    if (outline.length && result.length) result = clipping.difference(result, outline);
  }
  return polygonVectors(brush, result, true);
}
