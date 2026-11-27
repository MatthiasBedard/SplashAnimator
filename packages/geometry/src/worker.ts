import { mergeSelectedArtwork, mergeEditedPieces } from './merge-selection';
import { canMergeDroppedStroke, prepareMovedStrokeMerges } from './stroke-drop';
import { prepareSmoothSelection, type SmoothSelection } from './smooth-selection';
import { prepareWorkerPencilDrawing, type PencilDrawing } from './pencil-drawing';
import { prepareWorkerBrushPaint, type BrushCommit, type BrushCommitPhase } from './brush-commit';
import { prepareContourFits } from './contour-fit';
import { paintRegionBounds } from './paint-region-transform';
import { withSelectionClipping } from './paint-clipping';
import type { PaintRegion, RegionOperation } from './paint-region';
import { combinePaintRegion, prepareEditorPaintSelection, preparePaintDrop, clipPaint, splitPaintSelection, deletePaintRegion, type PaintClip, type PaintDrop } from './clip-paint';
import { hasVectorFill, mayIntersectPaint, mergeVectors, mergeDrawingVectors, mergeControlBounds } from './merge';
import { planarMergeLayer, planarBucket } from './planar-merge';
import { validateDetachedLiveGraphicData } from '../../document/src/live-motion';
import { partitionInkOverPaint, partitionJoinedPaint } from './ink-paint-cut';
import { planVacatedInkHealing } from './join-recolored-fills';
import { prepareEraseDrawing, type VectorEraseRequest } from './erase';
import { hit } from './index';
import { prepareWorkerShapeDrawing, type ShapeDrawing } from './shape-drawing';
import { traceBitmapRaster, type BitmapTraceRaster } from './bitmap-trace';
import type { Vector, Point } from '@splash/document';
import { strokeToFill } from './strokes';
import { connectedPaint } from './connected';
import { connectedStrokeSelection } from './connected-strokes';
import { brushPaint, type BrushPaintMode } from './brush-paint';
import {
  prepareSymbolSimplifyRequest,
  type SymbolSimplifyRequest,
} from './symbol-simplify-request';
const initializedAt = performance.timeOrigin + performance.now();

self.onmessage = (
  event: MessageEvent<{
    id: number;
    shapes: Vector[];
    bitmapTrace?: BitmapTraceRaster;
    symbolSimplify?: SymbolSimplifyRequest;
    region?: RegionOperation;
    regionPaint?: string[];
    regionPaintOmissions?: string[];
    deleteRegion?: { region: PaintRegion; eligible: string[] };
    splitPaintRegion?: { region: PaintRegion; eligible: string[]; preserveOutsideFillCurves: boolean;
      sourceSlots?: { count: number; indices: number[] } };
    pencil?: PencilDrawing;
    preserveStrokeCurves?: boolean;
    selectedArtwork?: string[];
    movedArtwork?: string[];
    editedPieces?: string[];
    planarDrop?: { moved: string[]; eligible: string[]; vacated?: Vector[] };
    destinationMask?: PaintRegion;
    dropEligible?: string[];
    strokeEdit?: boolean;
    keepFillIds?: boolean;
    includeStraightPaint?: boolean;
    joinedPaintInk?: string[];
    joinedPaintStackOrder?: boolean;
    vacatedInk?: { original: Vector[]; eligible: string[] };
    smoothSelection?: SmoothSelection;
    brushCommit?: BrushCommit;
    measureBrush?: true;
    brushDisplayPadding?: number;
    brushRetainRoots?: true;
    shapeDrawing?: ShapeDrawing;
    eraseObjects?: { trail: Point[]; radius: number; eligible: string[] };
    fit?: { selected: string[]; tolerance: number };
    clip?: PaintClip;
    convert?: string[];
    connected?: string;
    strokeSelection?: { seed: string; point: Point; tolerance: number };
    paint?: { brush: Vector; mode: BrushPaintMode; selected: string[] };
    bucket?: { paint: Vector; point: Point; gap: number };
    erase?: VectorEraseRequest;
  }>,
) => {
  const { id, shapes, erase, convert, bucket, connected, paint, clip, region, fit } = event.data;
  try {
    if (event.data.bitmapTrace) {
      self.postMessage({ id, result: traceBitmapRaster(event.data.bitmapTrace) });
      return;
    }
    if (event.data.symbolSimplify) {
      self.postMessage({ id, result: prepareSymbolSimplifyRequest(event.data.symbolSimplify) });
      return;
    }
    if (event.data.strokeSelection) {
      const request = event.data.strokeSelection;
      self.postMessage({
        id,
        result: connectedStrokeSelection(shapes, request.seed, request.point, request.tolerance),
      });
      return;
    }
    if (event.data.smoothSelection) {
      self.postMessage({ id, result: prepareSmoothSelection(shapes, event.data.smoothSelection) });
      return;
    }
    if (event.data.vacatedInk) {
      const { original, eligible } = event.data.vacatedInk;
      const healed = planVacatedInkHealing(shapes, original, new Set(eligible));
      const indices = new Map(shapes.map((shape, index) => [shape, index]));
      self.postMessage({ id, result: healed?.absorbed.size ? {
        artwork: healed.artwork.map(shape => indices.get(shape) ?? shape), absorbed: [...healed.absorbed],
      } : null });
      return;
    }
    if (event.data.joinedPaintInk) {
      self.postMessage({id,result:partitionJoinedPaint(shapes,new Set(event.data.joinedPaintInk),mergeControlBounds,
        event.data.joinedPaintStackOrder)});
      return;
    }
    if (event.data.planarDrop) {
      // Moved raw artwork settles where it lands: it cuts and joins the eligible raw artwork it
      // touches (and where it was) in one planar map of exact curves. Untouched shapes come back
      // as their input index. `null` when the planar merge declines.
      const { moved, eligible, vacated } = event.data.planarDrop;
      const movedIds = new Set(moved), allowed = new Set(eligible);
      const seeds = new Set(shapes.flatMap((shape, i) => movedIds.has(shape.id) ? [i] : []));
      const reach = (vacated ?? []).flatMap(shape => {
        try {
          const b = mergeControlBounds(shape);
          return [b.left, b.right, b.top, b.bottom].every(Number.isFinite) ? [b] : [];
        } catch {
          return [];
        }
      });
      const settled = seeds.size === movedIds.size ? planarMergeLayer(shapes, seeds, {
        eligible: new Set(shapes.flatMap((shape, i) => allowed.has(shape.id) ? [i] : [])), reach,
      }) : undefined;
      let result = null;
      if (settled) {
        try {
          validateDetachedLiveGraphicData(settled.shapes);
          const indices = new Map(shapes.map((shape, i) => [shape, i]));
          const replacements = moved.map(id => [id, settled.pieces
            .filter((_, i) => settled.contributors[i].some(j => shapes[j].id === id)).map(piece => piece.id)] as const);
          result = { artwork: settled.shapes.map(shape => indices.get(shape) ?? shape), replacements };
        } catch {
          result = null;
        }
      }
      self.postMessage({ id, result });
      return;
    }
    if (event.data.editedPieces) {
      const ids = new Set(event.data.editedPieces);
      const bounds=event.data.destinationMask && paintRegionBounds(event.data.destinationMask);
      const clearMargin=!!bounds && shapes.every(shape=>ids.has(shape.id) || !mayIntersectPaint(shape,bounds));
      if (event.data.dropEligible) {
        const allowed = new Set(event.data.dropEligible);
        const ink = ids.size === 1 && event.data.editedPieces.length === 1 && !event.data.keepFillIds
          ? shapes.find(s => ids.has(s.id)) : undefined;
        const partition = ink && partitionInkOverPaint(shapes, ink, mergeControlBounds, allowed, event.data.includeStraightPaint);
        const postInkCut = (owner: Vector, pieces: NonNullable<typeof partition>) => {
          const order = shapes.map((_, i) => i);
          const pieceSets = new Map(pieces.background).set(owner, pieces.strokes);
          self.postMessage({ id, result: {
            artwork: event.data.strokeEdit ? order : [...order.filter(i => shapes[i] !== owner), shapes.indexOf(owner)],
            inkCuts: order.flatMap(source => {
              const pieces = pieceSets.get(shapes[source]);
              return pieces ? [{ source, pieces }] : [];
            }), clearMargin, preservedDestination: false,
          } });
        };
        if (partition && ink && [...partition.background.keys()].some(hasVectorFill)) {
          postInkCut(ink, partition);
          return;
        }
        const { artwork, preservedDestination, absorbedFill, absorbedFills }: PaintDrop = event.data.strokeEdit
          ? { artwork: shapes, preservedDestination: false }
          : preparePaintDrop(shapes, event.data.editedPieces, event.data.dropEligible, !event.data.keepFillIds);
        const indices = new Map(shapes.map((shape, index) => [shape, index]));
        const strokeMerges = prepareMovedStrokeMerges(artwork, ids, allowed);
        if (event.data.strokeEdit && ink && canMergeDroppedStroke(ink) && !strokeMerges.length) {
          // The ordinary stroke merger cannot move a lower stroke across an
          // intervening fill. Split transverse crossings in each owner's slot.
          const inkScope = new Set(shapes.filter(s => allowed.has(s.id) && canMergeDroppedStroke(s)).map(s => s.id));
          const crossings = partitionInkOverPaint(shapes, ink, mergeControlBounds, inkScope, true, true);
          if (crossings?.background.size &&
              (crossings.strokes.length > 1 || [...crossings.background.values()].some(pieces => pieces.length > 1))) {
            postInkCut(ink, crossings);
            return;
          }
        }
        self.postMessage({ id, result: {
          artwork: artwork.map(shape => indices.get(shape) ?? shape), clearMargin, preservedDestination, strokeMerges,
          ...(absorbedFill ? { absorbedFill } : {}),
          ...(absorbedFills ? { absorbedFills } : {}),
        } });
      } else {
        const artwork = mergeEditedPieces(shapes, new Set(shapes.filter(shape => ids.has(shape.id))));
        self.postMessage({ id, result: { artwork, clearMargin } });
      }
      return;
    }
    if (event.data.selectedArtwork) {
      self.postMessage({
        id,
        result: event.data.dropEligible ? {...preparePaintDrop(shapes,event.data.selectedArtwork,event.data.dropEligible),selected:event.data.selectedArtwork} : mergeSelectedArtwork(
          shapes,
          event.data.selectedArtwork,
          event.data.preserveStrokeCurves === true,
          true,
          event.data.movedArtwork,
        ),
      });
      return;
    }
    if (event.data.pencil) {
      self.postMessage({ id, result: prepareWorkerPencilDrawing(shapes, event.data.pencil) });
      return;
    }
    if (event.data.brushCommit) {
      const measuring = event.data.measureBrush === true;
      const geometryStart = measuring ? performance.now() : 0;
      let previous = geometryStart;
      const phases: { phase: BrushCommitPhase; elapsedMs: number }[] | undefined = measuring ? [] : undefined;
      const result = prepareWorkerBrushPaint(shapes, event.data.brushCommit, phases && (phase => {
        const now = performance.now();
        phases.push({ phase, elapsedMs: now - previous });
        previous = now;
      }), event.data.brushDisplayPadding, event.data.brushRetainRoots === true);
      const { unchangedRoots, shapes: rebuilt, ...preparation } = result;
      const reference = unchangedRoots && new Map(unchangedRoots.map(({ input, output }) => [output, input]));
      const response = { ...preparation, shapes: reference ? rebuilt.map((shape, i) => reference.get(i) ?? shape) : rebuilt };
      self.postMessage(measuring ? {
        id, result: response,
        brushTiming: {
          initializedAt,
          geometryStart: performance.timeOrigin + geometryStart,
          geometryEnd: performance.timeOrigin + performance.now(),
          phases,
        },
      } : { id, result: response });
      return;
    }
    if (event.data.shapeDrawing) {
      self.postMessage({ id, result: prepareWorkerShapeDrawing(shapes, event.data.shapeDrawing) });
      return;
    }
    if (event.data.eraseObjects) {
      const { trail, radius, eligible } = event.data.eraseObjects;
      const ids = new Set(eligible);
      const segments = trail.map((to, index) => {
        const from = trail[index - 1] ?? to;
        const count = Math.max(1, Math.min(4096, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius / 2))));
        return { from, dx: to.x - from.x, dy: to.y - from.y, count };
      });
      const result = shapes.filter(shape => !ids.has(shape.id) || !segments.some(({ from, dx, dy, count }) => {
        for (let i = 0; i <= count; i++)
          if (hit(shape, { x: from.x + dx * i / count, y: from.y + dy * i / count }, radius)) return true;
        return false;
      }));
      self.postMessage({ id, result });
      return;
    }
    if (fit) {
      self.postMessage({ id, result: prepareContourFits(shapes, fit.selected, fit.tolerance) });
      return;
    }
    if (region) {
      const result = event.data.regionPaint
        ? prepareEditorPaintSelection(shapes,region,event.data.regionPaint,event.data.regionPaintOmissions)
        : combinePaintRegion(region);
      self.postMessage({ id, result });
      return;
    }
    if (event.data.deleteRegion) {
      const { region, eligible } = event.data.deleteRegion;
      self.postMessage({ id, result: deletePaintRegion(shapes, region, eligible) });
      return;
    }
    if (event.data.splitPaintRegion) {
      const { region, eligible, preserveOutsideFillCurves, sourceSlots } = event.data.splitPaintRegion;
      const { inside, artwork, counts } = splitPaintSelection(shapes, { region, eligible, preserveStrokes: true, preserveOutsideFillCurves });
      if (sourceSlots && inside.length) {
        const originals = new Map(shapes.map((shape, index) => [shape, sourceSlots.indices[index]]));
        const outside: (Vector | number)[] = [];
        let nextSource = 0, piece = 0;
        for (let slot = 0; slot < sourceSlots.count; slot++) {
          if (slot !== sourceSlots.indices[nextSource]) {
            outside.push(slot);
            continue;
          }
          const end = piece + counts[nextSource++];
          while (piece < end) {
            const shape = artwork[piece++];
            outside.push(originals.get(shape) ?? shape);
          }
        }
        self.postMessage({ id, result: { inside, outside } });
        return;
      }
      const originals = new Map(shapes.map((shape, index) => [shape, index]));
      // Unchanged drawings returned by the cut still reference their input object.
      self.postMessage({ id, result: { inside, outside: artwork.map(shape => originals.get(shape) ?? shape) } });
      return;
    }
    if (clip) {
      const result = clip.preserveStrokes ? withSelectionClipping(() => clipPaint(shapes, clip)) : clipPaint(shapes, clip);
      self.postMessage({ id, result });
      return;
    }
    if (paint) {
      self.postMessage({ id, result: brushPaint(shapes, paint.brush, paint.mode, paint.selected) });
      return;
    }
    if (connected) {
      self.postMessage({ id, result: connectedPaint(shapes, connected) });
      return;
    }
    if (bucket) {
      // The exact area the planar map encloses there, or the older enclosure search (which also
      // closes gaps) when it finds none.
      const region = planarBucket(shapes, bucket.paint, bucket.point);
      self.postMessage({ id, result: region ? [region] : mergeVectors(shapes, bucket) });
      return;
    }
    if (convert) {
      self.postMessage({
        id,
        result: shapes.flatMap((s) => (convert.includes(s.id) ? strokeToFill(s) : [s])),
      });
      return;
    }
    if (erase) {
      self.postMessage({ id, result: prepareEraseDrawing(shapes, erase) });
      return;
    }
    // Rebuild the whole layer: one planar map of exact curves, or the older merge if it declines.
    const settled = planarMergeLayer(shapes, new Set(), { all: true });
    if (settled) {
      try {
        validateDetachedLiveGraphicData(settled.shapes);
        self.postMessage({ id, result: settled.shapes });
        return;
      } catch {
        // Use the older merge below.
      }
    }
    self.postMessage({ id, result: mergeDrawingVectors(shapes) });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
