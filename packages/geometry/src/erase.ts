import clipping, { UnresolvedPaintContour, withSelectionClipping } from './paint-clipping';
import { id, clone, type Point, type Vector } from '@splash/document';
import { paintRegionBounds } from './paint-region-transform';
import { mayIntersectPaint, vectorPolygons, contains } from './merge';
import { worldStrokePolygons, polygonVectors } from './strokes';
import { hasRestorableFillCurves, restoreClippedFillCurves } from './clip-fill-curves';
import { expandStrokeMask, isEditableInk, prepareStrokeCut } from './stroke-cut';
import { mergeEditedPieces } from './merge-selection';
import type { PaintRegion } from './paint-region';

/** A stroke eraser removes editable runs at full width. Expand the eraser in
 * the ink's local basis so even an edge hit can cut a run and the new caps
 * don't paint back over the erased center. */
function eraseInk(shape: Vector, region: PaintRegion): Vector[] {
  if (!clipping.intersection(worldStrokePolygons(shape), region).length) return [shape];
  return prepareStrokeCut(expandStrokeMask(shape, region))(shape, 'outside');
}
export type VectorEraseRequest = {
  trail: Point[];
  radius: number;
  mode: 'all' | 'fills' | 'strokes' | 'inside';
  merge: boolean;
  eligible?: string[];
};

export type VectorEraseResult = { artwork: Vector[]; preserved: number; retainedBoundaries?: true };

export function eraseVectors(
  shapes: Vector[], trail: Point[], radius: number, mode: VectorEraseRequest['mode'], eligible?: string[],
): Vector[] {
  return prepareVectorErase(shapes, trail, radius, mode, eligible).artwork;
}

export function prepareVectorErase(
  shapes: Vector[], trail: Point[], radius: number, mode: VectorEraseRequest['mode'], eligible?: string[],
): VectorEraseResult {
  return withSelectionClipping(() => eraseArtwork(shapes, trail, radius, mode, eligible));
}

export function prepareEraseDrawing(shapes: Vector[], request: VectorEraseRequest): VectorEraseResult {
  const { trail, radius, mode, eligible, merge } = request;
  const result = prepareVectorErase(shapes, trail, radius, mode, eligible);
  // A partial erase already has complete replacement pieces in source order.
  // Rebuilding a connected face could reach a protected original outside the cut.
  if (!merge || result.preserved) return result;
  const originals = new Set(shapes);
  const edited = new Set(result.artwork.filter(piece => !originals.has(piece)));
  try {
    return { ...result, artwork: mergeEditedPieces(result.artwork, edited) };
  } catch (cause) {
    if (!(cause instanceof UnresolvedPaintContour)) throw cause;
    return { ...result, retainedBoundaries: true };
  }
}
function eraseArtwork(
  shapes: Vector[], trail: Point[], radius: number, mode: VectorEraseRequest['mode'], eligible?: string[],
): VectorEraseResult {
  if (!trail.length || !Number.isFinite(radius) || radius <= 0 || radius > 100)
    throw new Error('Invalid eraser geometry');
  const cutter: Vector = {
    id: id(),
    kind: 'brush',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: radius * 2,
    points: trail,
    brush: { pressure: false, minimum: 1, aspect: 1, tilt: false, angle: 0 },
  };
  let clip = vectorPolygons(cutter);
  const bounds=paintRegionBounds(clip);
  if (!bounds) return { artwork: shapes, preserved: 0 };
  let target: Vector | undefined;
  const allowed = eligible ? new Set(eligible) : undefined;
  const reached = (s: Vector) => (!allowed || allowed.has(s.id)) && s.kind !== 'text' &&
    mayIntersectPaint(s,bounds);
  if (mode === 'inside') {
    // A finer upper contour can own the starting point. When its owner is
    // uncertain, keep the layer intact instead of erasing through it.
    try {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        if (!reached(shape)) continue;
        const region = vectorPolygons(shape).find(poly => contains([poly], trail[0]));
        if (!region) continue;
        target = shape;
        clip = clipping.intersection(clip, [region]);
        break;
      }
    } catch (cause) {
      if (!(cause instanceof UnresolvedPaintContour)) throw cause;
      return { artwork: shapes, preserved: 1 };
    }
    if (!target) return { artwork: shapes, preserved: 0 };
  }
  const cutFillOwners = new Map<Vector, Vector>();
  const erase = (s: Vector): Vector[] => {
    if ((target && s !== target) || !reached(s) || (mode === 'strokes' && !s.strokeWidth)) return [s];
    if (isEditableInk(s)) {
      if (mode === 'fills' || mode === 'inside') return [s];
      return eraseInk(s, clip);
    }
    const fills = vectorPolygons(s);
    const stroke = mode === 'fills' || mode === 'inside' ? [] : worldStrokePolygons(s);
    const fillChanged =
      mode !== 'strokes' && fills.length > 0 && clipping.intersection(fills, clip).length > 0;
    const strokeChanged = stroke.length > 0 && clipping.intersection(stroke, clip).length > 0;
    if (!fillChanged && !strokeChanged) return [s];
    const result: Vector[] = [];
    const cutFills = fillChanged ? polygonVectors(s, clipping.difference(fills, clip), true) : [];
    if (fillChanged) result.push(...cutFills);
    else if (fills.length)
      result.push({ ...clone(s), strokeWidth: s.kind === 'brush' ? s.strokeWidth : 0 });
    if (strokeChanged) {
      const paint: Vector = {
        ...clone(s),
        id: result.length ? id() : s.id,
        fill: s.stroke,
        bitmap: undefined,
        gradient: undefined,
      };
      result.push(...polygonVectors(paint, clipping.difference(stroke, clip), true));
    } else if (s.kind !== 'brush' && s.strokeWidth > 0)
      result.push({ ...clone(s), id: result.length ? id() : s.id, fillEnabled: false });
    if (cutFills.length && hasRestorableFillCurves(s))
      for (const piece of cutFills) cutFillOwners.set(piece, s);
    return result;
  };
  let preserved = 0;
  const artwork = shapes.flatMap(s => {
    try {
      return erase(s);
    } catch (cause) {
      if (!(cause instanceof UnresolvedPaintContour)) throw cause;
      preserved++;
      return [s];
    }
  });
  return { artwork: restoreClippedFillCurves(artwork, cutFillOwners, clip), preserved };
}
