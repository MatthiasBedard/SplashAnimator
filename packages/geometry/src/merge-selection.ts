import type { Vector } from '../../document/src';
import { CollapsedIntersectionContour } from './paint-clipping';
import { PaintCurveLossError } from './paint-edge-provenance';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import {
  connectedMergeIndices, mergeControlBounds, mergeDrawingComponent,
  mergeVectors, mergeDrawingVectors, NarrowArrangementFaceError,
} from './merge';
import { planarMergeLayer } from './planar-merge';

/** The planar merge of `shapes` around `seeds` (or of every raw shape), validated; `undefined`
 * when it declines. Pieces whose topmost source was in `picked` are reported. */
function planarSettle(shapes: Vector[], seeds: ReadonlySet<number>, all: boolean, picked?: ReadonlySet<string>) {
  const settled = planarMergeLayer(shapes, seeds, { all });
  if (!settled) return;
  try {
    validateLiveGraphicData(settled.shapes);
  } catch {
    return;
  }
  const chosen = new Set<string>();
  if (picked) {
    settled.pieces.forEach((piece, i) => {
      if (settled.contributors[i].some(j => picked.has(shapes[j].id))) chosen.add(piece.id);
    });
    const taken = new Set(settled.taken.map(i => shapes[i]));
    for (const shape of shapes) if (!taken.has(shape) && picked.has(shape.id)) chosen.add(shape.id);
  }
  return { artwork: settled.shapes, chosen };
}

/** Clipping, moving and erasing have already produced the intended editable pieces.
 * If face ownership is unresolvable, keep those pieces in their current stack order. */
export function mergeEditedPieces(shapes: Vector[], edited: ReadonlySet<Vector>): Vector[] {
  validateLiveGraphicData(shapes);
  if (!edited.size) return structuredClone(shapes);
  const seeds = new Set(shapes.flatMap((shape, i) => edited.has(shape) ? [i] : []));
  const planar = planarSettle(shapes, seeds, false);
  if (planar) return structuredClone(planar.artwork);
  const component = connectedMergeIndices(shapes.map(mergeControlBounds), seeds);
  try {
    return component.size === shapes.length ? mergeDrawingVectors(shapes)
      : mergeDrawingComponent(shapes, component, input => mergeDrawingVectors(input));
  } catch (cause) {
    if (!(cause instanceof NarrowArrangementFaceError || cause instanceof CollapsedIntersectionContour || cause instanceof PaintCurveLossError)) throw cause;
    return structuredClone(shapes);
  }
}

/** The normal merge records which rebuilt pieces contain selected source paint.
 * Selection metadata never changes geometry, IDs, order or admission limits. */
export function mergeSelectedArtwork(
  shapes: Vector[],
  selected: string[],
  curves = false,
  paintCurves = false,
  moved?: string[],
): { artwork: Vector[]; selected: string[]; retainedOverlap?: true } {
  if (
    !Array.isArray(selected) ||
    selected.some((id) => typeof id !== 'string') ||
    typeof curves !== 'boolean' ||
    typeof paintCurves !== 'boolean'
  )
    throw Error('Invalid original artwork selection.');
  const original = new Set(selected);
  if (
    !original.size ||
    original.size !== selected.length ||
    shapes.filter((s) => original.has(s.id)).length !== original.size
  )
    throw Error('The original selected artwork changed.');
  const affected = new Set(moved);
  if (moved !== undefined) {
    validateLiveGraphicData([shapes, moved]);
    if (!Array.isArray(moved) || affected.size !== moved.length ||
      shapes.filter(shape => affected.has(shape.id)).length !== affected.size ||
      selected.some(id => !affected.has(id)))
      throw Error('The original moved artwork changed.');
  }
  const merge = (input: Vector[], rebuilt: Set<string>) =>
    (paintCurves ? mergeDrawingVectors : mergeVectors)(input, undefined, curves, { original, rebuilt });
  function selection(artwork: Vector[], rebuilt: ReadonlySet<string>) {
    return { artwork, selected: artwork.filter(shape => rebuilt.has(shape.id)).map(shape => shape.id) };
  }
  // One planar map of exact curves: every raw shape (or what the moved ones reach) cuts and joins.
  {
    // Rebuilding the whole layer has no new shapes: whatever nothing else meets stays as it is.
    const seeds = new Set(moved === undefined ? [] : shapes.flatMap((shape, i) => affected.has(shape.id) ? [i] : []));
    const planar = planarSettle(shapes, seeds, moved === undefined, original);
    if (planar) return { artwork: structuredClone(planar.artwork),
      selected: planar.artwork.filter(shape => planar.chosen.has(shape.id)).map(shape => shape.id) };
  }
  const rebuilt = new Set<string>();
  if (moved === undefined) {
    try { return selection(merge(shapes, rebuilt), rebuilt); }
    catch (cause) {
      if (!(cause instanceof PaintCurveLossError)) throw cause;
      return { ...selection(structuredClone(shapes), original), retainedOverlap: true };
    }
  }
  const seeds = new Set(shapes.flatMap((shape, index) => affected.has(shape.id) ? [index] : []));
  const reached = connectedMergeIndices(shapes.map(mergeControlBounds), seeds);
  try {
    const artwork = reached.size === shapes.length ? merge(shapes, rebuilt)
      : mergeDrawingComponent(shapes, reached, input => merge(input, rebuilt));
    return selection(artwork, rebuilt);
  } catch (cause) {
    if (!(cause instanceof NarrowArrangementFaceError || cause instanceof CollapsedIntersectionContour || cause instanceof PaintCurveLossError)) throw cause;
  }
  // The moved vectors already carry the prepared junction edits and original stack order.
  // Preserve them when the arrangement cannot certify a face.
  return { ...selection(structuredClone(shapes), original), retainedOverlap: true as const };
}
