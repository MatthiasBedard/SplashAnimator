import { clone, type Vector } from '@splash/document';
import { validateDetachedLiveGraphicData, validateLiveGraphicData } from '../../document/src/live-motion';
import { normalizeVector } from './drawing';
import {
  connectedMergeIndices,
  mergeControlBounds,
  mergeDrawingComponent,
  mergeDrawingVectors,
  NarrowArrangementFaceError,
} from './merge';
import { smoothPath } from './path-edit';
import { canJoinOverlayFills, prepareSolidPaintOverlay } from './clip-paint';
import { hasRestorableFillCurves } from './clip-fill-curves';
import { PaintCurveLossError } from './paint-edge-provenance';
import { isEditableInk } from './stroke-cut';
import { prepareSharedPaintStack } from './shared-paint-cut';
import { overlaps, type Bounds } from './bounds-index';
import type { InkPaintRetry } from './ink-paint-cut';
import { planarMergeLayer } from './planar-merge';

export type ShapeDrawing = { shape: Vector; merge: boolean; smoothPen?: boolean; removeCoveredStrokes?: boolean };
type ShapePreparation = { shapes: Vector[]; retainedOverlap?: true };

/** Prepare one newly drawn shape. Earlier artwork is never changed on failure. */
export function prepareShapeDrawing(
  artwork: Vector[],
  request: ShapeDrawing,
): ShapePreparation {
  return prepareShapeArtwork(artwork, request, validateLiveGraphicData);
}

/** Worker messages already own a natively detached copy of the artwork. */
export function prepareWorkerShapeDrawing(artwork: Vector[], request: ShapeDrawing,
  omitRecoveryRoots = false): ShapePreparation {
  return prepareShapeArtwork(artwork, request, validateDetachedLiveGraphicData, omitRecoveryRoots);
}

function prepareShapeArtwork(artwork: Vector[], request: ShapeDrawing,
  validate: (source: unknown) => void, omitRecoveryRoots = false): ShapePreparation {
  validate(artwork);
  validate(request.shape);
  const shape = clone(request.shape);
  if (request.smoothPen !== undefined) {
    if (request.smoothPen) smoothPath(shape);
    normalizeVector(shape);
    validate(shape);
  }
  if (!request.merge) return { shapes: [shape] };

  // Merge Drawing: the new shape cuts and joins the raw artwork it touches in one planar map of
  // exact curves (lines divide paint, paint on top covers what is under it, matching paint
  // joins). The older special-case cutters below remain only for maps the planar merge declines.
  shape.drawingMode = 'merge';
  const settled = planarMergeLayer([...artwork, shape], new Set([artwork.length]),
    { keepCoveredLines: !request.removeCoveredStrokes, copy: validate !== validateDetachedLiveGraphicData });
  if (settled) {
    try {
      validate(settled.shapes);
      return { shapes: settled.shapes };
    } catch {
      // An unusual piece the document would refuse: use the existing path instead.
    }
  }

  const input = [...artwork, shape];
  const boxes = new Map<Vector, Bounds>();
  const bounds = (vector: Vector) => {
    let box = boxes.get(vector);
    if (!box) {
      box = mergeControlBounds(vector);
      boxes.set(vector, box);
    }
    return box;
  };
  const inkRetry: InkPaintRetry = { bounds };
  // A shape-tool gesture authors its fill and border together. Resolve both
  // against the same old boundaries so an existing outline cannot disqualify
  // the fill or leave the border with different intersection coordinates.
  if (shape.strokeWidth > 0 && !shape.rotation && !shape.transform && !shape.groups?.length) {
    const fill = { ...shape, strokeWidth: 0 };
    if (canJoinOverlayFills(fill, fill) && !artwork.some(s => s.kind === 'symbol' || s.kind === 'text')) {
      const box = bounds(shape);
      const nearby = artwork.filter(s => overlaps(bounds(s), box, 0));
      if (nearby.length && (hasRestorableFillCurves(fill) || nearby.some(hasRestorableFillCurves)) &&
          nearby.every(s => !s.groups?.length && (canJoinOverlayFills(s,s) || (isEditableInk(s) &&
            !s.rotation && !s.transform && s.drawingMode !== 'object' && !s.gradient && !s.bitmap &&
            !s.brush && !s.tint && !s.blurRadius && !s.groupBlur && !s.blendMode)))) {
        const cut = prepareSharedPaintStack(nearby, fill, 'paint', { stroke:shape, removeCoveredInk:!!request.removeCoveredStrokes });
        if (cut && 'upperArtwork' in cut && cut.upperArtwork)
          return { shapes: [...artwork.flatMap(s => cut.background.get(s) ?? [clone(s)]), ...cut.upperArtwork] };
      }
    }
  }
  if (canJoinOverlayFills(shape, shape) && (hasRestorableFillCurves(shape) || artwork.some(hasRestorableFillCurves))) {
    shape.drawingMode = 'merge';
    const reached = connectedMergeIndices(input.map(bounds), new Set([artwork.length]));
    try {
      const overlay = prepareSolidPaintOverlay(input.filter((_, i) => reached.has(i)), shape,
        { removeCoveredInk: !!request.removeCoveredStrokes });
      if (overlay) return { shapes: mergeDrawingComponent(input, reached, () => overlay) };
    } catch (cause) {
      if (!(cause instanceof PaintCurveLossError)) throw cause;
    }
  }
  const coveringPaint = request.removeCoveredStrokes ? new Set([shape]) : undefined;
  const merge = (component: Vector[]) => mergeDrawingVectors(component, undefined, true, undefined, coveringPaint, inkRetry);
  try {
    return { shapes: merge(input) };
  } catch (cause) {
    if (!(cause instanceof NarrowArrangementFaceError || cause instanceof PaintCurveLossError)) throw cause;
  }
  const reached = connectedMergeIndices(input.map(bounds), new Set([artwork.length]));
  if (reached.size < input.length) {
    try {
      return { shapes: mergeDrawingComponent(input, reached, merge) };
    } catch (cause) {
      if (!(cause instanceof NarrowArrangementFaceError || cause instanceof PaintCurveLossError)) throw cause;
    }
  }
  // A new drawing can remain editable in its original stack slot without
  // guessing a face interior or removing any existing paint.
  const retained: Vector = { ...shape, drawingMode: 'merge' };
  return { shapes: omitRecoveryRoots ? [retained] : [...clone(artwork), retained], retainedOverlap: true };
}
