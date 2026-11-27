import type { Vector } from '@splash/document';
import { boundsIndex, type Bounds } from './bounds-index';
import { mergeControlBounds, mergeVectors, NarrowArrangementFaceError } from './merge';
import { PAINT_GRID_STEP } from './paint-clipping';
import { isEditableInk } from './stroke-cut';

export type StrokeDropMerge = { sources: number[]; strokes: Vector[] };

export function canMergeDroppedStroke(shape: Vector): boolean {
  return isEditableInk(shape) && shape.drawingMode !== 'object' && !shape.groups?.length &&
    !shape.blendMode && !shape.tint && !shape.blurRadius && !shape.groupBlur;
}

/** Build only the stroke components reached by a drop. Crossing a paint slot
 * in the stack requires a conservative proof that its visible paint stays put. */
export function prepareMovedStrokeMerges(
  artwork: Vector[], moved: ReadonlySet<string>, eligible: ReadonlySet<string>,
): StrokeDropMerge[] {
  const candidates: number[] = [];
  let hasMove = false, hasDestination = false;
  for (const [index, shape] of artwork.entries()) {
    if (!canMergeDroppedStroke(shape)) continue;
    if (moved.has(shape.id)) hasMove = true;
    else if (eligible.has(shape.id)) hasDestination = true;
    else continue;
    candidates.push(index);
  }
  if (!hasMove || !hasDestination) return [];

  const result: StrokeDropMerge[] = [];
  const bounds = candidates.map(index => mergeControlBounds(artwork[index]));
  const lookup = boundsIndex(bounds), visited = new Set<number>();
  const padding = 2 * PAINT_GRID_STEP;
  let paintIndex: ReturnType<typeof boundsIndex> | undefined;
  const unknownPaint = [0];
  const emptyBounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const indexPaint = () => {
    const measured = new Map(candidates.map((index, candidate) => [index, bounds[candidate]]));
    return boundsIndex(artwork.map((shape, index) => {
      const unknown = shape.kind === 'text' || shape.kind === 'symbol' ||
        !!shape.blurRadius || !!shape.groupBlur || !!shape.blendMode;
      unknownPaint.push(unknownPaint[index] + Number(unknown));
      return unknown ? emptyBounds : measured.get(index) ?? mergeControlBounds(shape);
    }));
  };

  for (const [seed, index] of candidates.entries()) {
    if (visited.has(seed) || !moved.has(artwork[index].id)) continue;
    const component = [seed];
    visited.add(seed);
    for (let cursor = 0; cursor < component.length; cursor++) {
      for (const neighbor of lookup(bounds[component[cursor]], padding)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        component.push(neighbor);
      }
    }
    const sources = component.sort((a, b) => a - b).map(member => candidates[member]);
    const shapes = sources.map(member => artwork[member]);
    const moving = new Set(shapes.filter(shape => moved.has(shape.id)));
    if (shapes.length === moving.size) continue;
    const replaced = new Set<Vector>();
    try {
      const strokes = mergeVectors(shapes, undefined, true, undefined, undefined, { moved: moving, replaced });
      if (!strokes.length) continue;
      const indices = sources.filter(member => replaced.has(artwork[member]));
      const first = indices[0], last = indices.at(-1)!;
      if (last - first + 1 > indices.length) {
        paintIndex ??= indexPaint();
        if (unknownPaint[last] !== unknownPaint[first + 1]) continue;
        const affected = new Set(indices);
        const intersectsInterveningPaint = (shape: Vector) =>
          paintIndex!(mergeControlBounds(shape), padding).some(index =>
            index > first && index < last && !affected.has(index));
        if ([...replaced, ...strokes].some(intersectsInterveningPaint)) continue;
      }
      result.push({ sources: indices, strokes });
    } catch (error) {
      if (!(error instanceof NarrowArrangementFaceError)) throw error;
    }
  }
  return result;
}
