import { clone, type BezierNode, type Vector } from '@splash/document';
import { normalizeVector } from './drawing';
import { brushNib, smoothBrushSamples } from './pressure';
import {
  connectedMergeIndices,
  mergeControlBounds,
  mergeDrawingComponent,
  mergeVectors,
  prepareBrushSweep,
  NarrowArrangementFaceError,
} from './merge';
import { prepareBrushFinisher } from './brush-finish';
import { brushPaint, type BrushPaintMode } from './brush-paint';
import { drawnSymbolBrush } from './symbol-artwork';
import { optimizeNewPaint, optimizeNewStroke } from './stroke-optimize';
import { restorePaintCurves, restoreWorkerPaintCurves } from './paint-curves';
import { validateDetachedLiveGraphicData, validateLiveGraphicData } from '../../document/src/live-motion';
import { overlaps, type Bounds } from './bounds-index';
import { canJoinOverlayFills, prepareSolidPaintOverlay } from './clip-paint';
import { checkPaintEdgeProvenance, PaintCurveLossError } from './paint-edge-provenance';
import { fitBrushCenterline } from './brush-centerline';
import { prepareTracedRoundBrush } from './round-brush-fit';
import { prepareBrushContactFit } from './brush-contact-fit';
import { STANDARD_COMPOUND_SAMPLE_LIMIT } from './compound-fit';
import { PAINT_GRID_STEP, UnresolvedPaintContour } from './paint-clipping';
import { splitCubic } from './curve-fit';
import { planarMergeLayer } from './planar-merge';

export type BrushCommit = {
  brush: Vector;
  amount: number;
  merge: boolean;
  mode: BrushPaintMode;
  selected: string[];
  at: number;
  eligible?: string[];
  symbol?: boolean;
  optimize?: boolean;
  removeCoveredStrokes?: boolean;
};

/** Worker-only transaction: finish the new paint before it ever meets old paint. */
export function commitBrushPaint(shapes: Vector[], request: BrushCommit): Vector[] {
  return prepareBrushPaint(shapes, request).shapes;
}

export type BrushCommitPhase = 'footprint' | 'paint' | 'validation' | 'admission' | 'union' | 'restoration';
export type BrushDamage = { bounds: Bounds; artwork: Vector[] };
export type BrushRootReference = { input: number; output: number };
export type BrushPreparation = {
  shapes: Vector[];
  retainedOverlap?: true;
  damage?: BrushDamage;
  unchangedRoots?: BrushRootReference[];
};

export function prepareBrushPaint(
  shapes: Vector[], request: BrushCommit, mark?: (phase: BrushCommitPhase) => void,
  displayPadding?: number, retainRoots?: boolean,
): BrushPreparation {
  return prepareBrushArtwork(shapes, request, mark, displayPadding, retainRoots, false);
}

/** Only the worker message receiver owns natively detached inputs. */
export function prepareWorkerBrushPaint(
  shapes: Vector[], request: BrushCommit, mark?: (phase: BrushCommitPhase) => void,
  displayPadding?: number, retainRoots?: boolean,
): BrushPreparation {
  return prepareBrushArtwork(shapes, request, mark, displayPadding, retainRoots, true);
}

function prepareBrushArtwork(
  shapes: Vector[],
  request: BrushCommit,
  mark: ((phase: BrushCommitPhase) => void) | undefined,
  displayPadding: number | undefined,
  retainRoots: boolean | undefined,
  detached: boolean,
): BrushPreparation {
  const optimize = request.optimize === undefined ? false : request.optimize;
  if (typeof optimize !== 'boolean') throw new Error('Invalid brush optimization');
  if (!Number.isFinite(request.amount) || request.amount < 0 || request.amount > 10)
    throw new Error('Invalid brush smoothing');
  const opacity = request.brush.opacity;
  if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1))
    throw new Error('Invalid brush opacity');
  let brush = clone(request.brush);
  if (brush.kind !== 'brush') throw new Error('Expected a brush stroke.');
  if (request.symbol) {
    brush = drawnSymbolBrush(
      brush.id,
      brush.points,
      brush.fill,
      brush.strokeWidth,
      request.amount > 0,
      brush.brush,
    );
    if (opacity !== undefined) brush.opacity = opacity;
  } else {
    brush.points = smoothBrushSamples(brush.points, request.amount);
    normalizeVector(brush);
  }
  if (!request.merge && optimize) brush = optimizeNewStroke(brush);
  const centerline = request.merge && optimize && request.mode === 'normal'
    ? fitBrushCenterline(brush, request.amount) : undefined;
  let fittedFootprint: Vector[] | undefined;
  if (centerline) {
    try {
      const paint = mergeVectors([{...brush, points:centerline}]);
      if (paint.length) fittedFootprint = paint;
    } catch (cause) {
      if (!(cause instanceof UnresolvedPaintContour)) throw cause;
    }
  }
  const originalSweep = prepareBrushSweep(brush);
  const finishCandidate = prepareBrushFinisher({ brush, amount: request.amount }, originalSweep.sample);
  const finish = (sweep: Vector[]) => {
    const paint = finishCandidate(sweep);
    return optimize ? optimizeNewPaint(paint) : paint;
  };
  const initialSweep = request.merge ? fittedFootprint ?? originalSweep.merge() : [brush];
  const tip = brush.brush;
  const outline = initialSweep[0];
  // Only use the original, dense round pressure sweep. The half-unit fit is
  // within the ordinary finishing allowance from 50% Simplify upward.
  const contactFit = request.merge && optimize && request.mode === 'normal' && request.amount >= .5 &&
    !fittedFootprint && !brush.transform && !brush.rotation && tip?.pressure && tip.aspect === 1 &&
    !tip.tilt && !tip.twist && !tip.opacityProfile && initialSweep.length === 1 &&
    outline.contours?.length === 1 && outline.contours[0].length > STANDARD_COMPOUND_SAMPLE_LIMIT
      ? prepareBrushContactFit(outline,.5) : undefined;
  let footprint = request.merge && !contactFit ? finish(initialSweep) : initialSweep;
  // The established fit wins on ordinary strokes. Reserve the extra trace
  // and comparison for dense compound footprints with room for improvement.
  const contours = footprint.length === 1 ? footprint[0].contours : undefined;
  let certified = contactFit;
  let sourceSweep = contactFit ? initialSweep : undefined;
  if (centerline && fittedFootprint?.length === 1 && contours && contours.length > 1) {
    const anchors = contours.reduce((count,ring)=>count+ring.length,0);
    if (anchors >= 320) {
      // A fit can open or close a tiny hole. Certify the trace against the
      // original smoothed samples, not against the fitted centerline sweep.
      try {
        sourceSweep = originalSweep.merge();
      } catch (cause) {
        if (!(cause instanceof UnresolvedPaintContour)) throw cause;
      }
      if (sourceSweep?.length === 1 && sourceSweep[0].contours?.length === contours.length) {
        const spacing = Math.min(.44,brushNib(brush,centerline[0]).rx/6);
        const candidate = prepareTracedRoundBrush(brush,centerline,request.amount,spacing,sourceSweep[0]);
        const tracedAnchors = candidate?.contours?.reduce((count,ring)=>count+ring.length,0);
        if (candidate && tracedAnchors !== undefined && tracedAnchors <= anchors * .8) certified = candidate;
      }
      if (!certified && sourceSweep?.length) footprint = finish(sourceSweep);
    }
  }
  mark?.('footprint');
  const placement = {mark, displayPadding, retainRoots, detached, optimize};
  if (certified && sourceSweep) {
    try {
      const result = prepareBrushPlacement(shapes, request, brush, [certified], placement);
      if (!result.retainedOverlap) return result;
    } catch (cause) {
      if (!(cause instanceof NarrowArrangementFaceError || cause instanceof PaintCurveLossError ||
        cause instanceof UnresolvedPaintContour)) throw cause;
    }
    // Reuse the witness that admitted the fit if placement needs a retry.
    footprint = finish(sourceSweep);
  }
  return prepareBrushPlacement(shapes, request, brush, footprint, placement);
}

function storeFittedBrushRing(ring: BezierNode[]): BezierNode[] {
  if (ring.length !== 2) return ring;
  const index = ring[0].out || ring[1].in ? 0 : 1;
  const start = ring[index], end = ring[1 - index];
  if (!start.out && !end.in) return ring;
  // A short stroke can fit into two closed arcs. Subdivide one arc for the
  // document's three-anchor minimum without refitting or changing the outline.
  const [left, right] = splitCubic([start, start.out ?? start, end.in ?? end, end], 0.5);
  const stored = [...ring];
  stored[index] = { ...start, out: left[1] };
  stored[1 - index] = { ...end, in: right[2] };
  stored.splice(index + 1, 0, { ...left[3], in: left[2], out: right[1] });
  return stored;
}

function prepareBrushPlacement(shapes: Vector[], request: BrushCommit, brush: Vector, footprint: Vector[],
  {mark, displayPadding, retainRoots, detached, optimize}: {
    mark?: (phase: BrushCommitPhase) => void; displayPadding?: number; retainRoots?: boolean;
    detached: boolean; optimize: boolean;
  }): BrushPreparation {
  const eligible = request.eligible
    ? shapes.filter((s) => request.eligible!.includes(s.id))
    : shapes;
  const storedFootprint = footprint.map(shape => shape.contours?.some(ring => ring.length === 2)
    ? { ...shape, contours: shape.contours.map(storeFittedBrushRing) } : shape);
  const pieces = brushPaint(eligible, brush, request.mode, request.selected, storedFootprint);
  mark?.('paint');
  if (!pieces.length) return { shapes };
  const at = Math.max(0, Math.min(shapes.length, request.at));
  const result = [...shapes.slice(0, at), ...pieces, ...shapes.slice(at)];
  if (!request.merge) return { shapes: result };
  (detached ? validateDetachedLiveGraphicData : validateLiveGraphicData)(result);
  mark?.('validation');
  const planar = planarBrushPlacement(shapes, result, at, pieces.length, request,
    { mark, displayPadding, retainRoots, detached });
  if (planar) return planar;
  // Old paint already owns its resolved boundaries. Only rebuild components
  // reached by the new footprint; old contacts elsewhere are not new edits.
  // Use the SAME conservative control/stroke hulls as the merge broad phase.
  const boxes = result.map(mergeControlBounds);
  const incoming = new Set(pieces.map((_, i) => at + i));
  // A single appended footprint with no possible contact cannot affect any
  // old paint or ink. Avoid indexing and rebuilding remote ink components.
  const disjoint = request.mode === 'normal' && pieces.length === 1 && at === shapes.length &&
    boxes.every((box, i) => Number.isFinite(box.left) && Number.isFinite(box.right) &&
      Number.isFinite(box.top) && Number.isFinite(box.bottom) &&
      (i === at || !overlaps(box, boxes[at], 2 * PAINT_GRID_STEP)));
  let admitted = incoming;
  if (!disjoint) {
    const active = new Set(incoming);
    for (const [i, s] of result.entries())
      if (!(
        s.kind === 'polygon' &&
        s.drawingMode === 'merge' &&
        !s.strokeWidth &&
        s.fillEnabled !== false &&
        s.fillRule === 'evenodd' &&
        s.contours?.length
      ))
        active.add(i);
    admitted = connectedMergeIndices(boxes, active);
  }
  mark?.('admission');
  const coveringPaint = request.removeCoveredStrokes && request.mode === 'normal' ? new Set(pieces) : undefined;
  const merge = (candidates: Vector[]) => {
    if (request.mode === 'normal' && pieces.length === 1) {
      // An insertion slot can also put the new fill below one existing
      // face. In that case its upper neighbor owns the cutting boundary.
      const top = candidates.length === 2 && candidates[0] === pieces[0] &&
        canJoinOverlayFills(candidates[1], candidates[1]) ? candidates[1] : pieces[0];
      const overlay = prepareSolidPaintOverlay(candidates, top, { removeCoveredInk: !!coveringPaint });
      if (overlay) {
        mark?.('union');
        mark?.('restoration');
        return overlay;
      }
    }
    const merged = mergeVectors(candidates, undefined, true, undefined, coveringPaint);
    mark?.('union');
    const restored = (detached ? restoreWorkerPaintCurves : restorePaintCurves)(
      merged,
      optimize || request.mode === 'normal' && request.amount > 0
        ? candidates : candidates.filter((s) => !pieces.includes(s)),
    );
    if (request.mode === 'normal') checkPaintEdgeProvenance(candidates, restored);
    mark?.('restoration');
    return restored;
  };
  const rebuild = (indices: ReadonlySet<number>) => {
    let damage: BrushDamage | undefined;
    const unchangedRoots: BrushRootReference[] | undefined = retainRoots && Number.isSafeInteger(at) ? [] : undefined;
    const shapes = mergeDrawingComponent(result, indices, (component) => {
      const artwork = merge(component);
      if (displayPadding === undefined || !Number.isFinite(displayPadding) || displayPadding <= 0)
        return artwork;
      try {
        const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        for (const box of [...Array.from(indices, i => boxes[i]), ...artwork.map(mergeControlBounds)]) {
          bounds.left = Math.min(bounds.left, box.left);
          bounds.right = Math.max(bounds.right, box.right);
          bounds.top = Math.min(bounds.top, box.top);
          bounds.bottom = Math.max(bounds.bottom, box.bottom);
        }
        if (Object.values(bounds).every(Number.isFinite) &&
          !boxes.some((box, i) => !indices.has(i) && overlaps(bounds, box, displayPadding)))
          damage = { bounds, artwork };
      } catch {
        // Artwork admission succeeded. The view can repaint the full scene.
      }
      return artwork;
    }, unchangedRoots && ((i, output) => {
      // All incoming paint slots belong to the rebuilt component.
      unchangedRoots.push({ input: i < at ? i : i - pieces.length, output });
      // The worker sends this slot as an index. Copying the detached artwork
      // here would only allocate geometry that the reply immediately drops.
      return detached ? result[i] : undefined;
    }));
    return { shapes, ...(damage ? { damage } : {}),
      ...(unchangedRoots?.length ? { unchangedRoots } : {}) };
  };
  try {
    return rebuild(admitted);
  } catch (cause) {
    if (!(cause instanceof NarrowArrangementFaceError || cause instanceof PaintCurveLossError)) throw cause;
  }
  const local = connectedMergeIndices(boxes, incoming);
  if (local.size < admitted.size) {
    try {
      return rebuild(local);
    } catch (cause) {
      if (!(cause instanceof NarrowArrangementFaceError || cause instanceof PaintCurveLossError)) throw cause;
    }
  }
  // An unresolvable local arrangement cannot safely replace old artwork. Keep
  // the finished, already paint-mode-clipped stroke at its intended stack slot.
  return {
    shapes: result.map((s, i) => (incoming.has(i) ? { ...s, drawingMode: 'merge' } : clone(s))),
    retainedOverlap: true,
  };
}

/** Merge Drawing for a finished Brush footprint: the paint cuts and joins the raw artwork it
 * touches in one planar map of exact curves, in its stack slot (so Paint Behind stays under the
 * drawing). Lines stay over the new paint unless Remove covered lines is on (Paint Fills always
 * leaves them). Untouched artwork keeps its objects and slots. `undefined` when the planar merge
 * declines; the caller then uses the older cutters. */
function planarBrushPlacement(shapes: Vector[], result: Vector[], at: number, count: number, request: BrushCommit,
  { mark, displayPadding, retainRoots, detached }: {
    mark?: (phase: BrushCommitPhase) => void; displayPadding?: number; retainRoots?: boolean; detached: boolean;
  }): BrushPreparation | undefined {
  const seeds = new Set(Array.from({ length: count }, (_, i) => at + i));
  const eligible = request.eligible ? new Set(result.flatMap((s, i) =>
    seeds.has(i) || request.eligible!.includes(s.id) ? [i] : [])) : undefined;
  const keepCoveredLines = !(request.mode === 'normal' && request.removeCoveredStrokes);
  const settled = planarMergeLayer(result, seeds, { keepCoveredLines, eligible, copy: !(detached && retainRoots),
    simpleSeeds: true });
  mark?.('admission');
  if (!settled) return;
  try {
    (detached ? validateDetachedLiveGraphicData : validateLiveGraphicData)(settled.shapes);
  } catch {
    return;
  }
  mark?.('union');
  mark?.('restoration');
  const taken = new Set(settled.taken);
  // Input slot of each root that comes back as it was, and where it ends up (in input order: a
  // root that moved out of order, such as a line kept over the paint, is sent whole).
  const unchangedRoots: BrushRootReference[] | undefined = retainRoots ? [] : undefined;
  if (unchangedRoots) {
    let previous = -1;
    settled.origins.forEach((i, output) => {
      if (i === undefined || seeds.has(i)) return;
      const input = i < at ? i : i - count;
      if (input <= previous) return;
      unchangedRoots.push({ input, output });
      previous = input;
    });
  }
  let damage: BrushDamage | undefined;
  if (displayPadding !== undefined && Number.isFinite(displayPadding) && displayPadding > 0) {
    try {
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      for (const box of [...settled.taken.map(i => mergeControlBounds(result[i])),
        ...settled.pieces.map(mergeControlBounds)]) {
        bounds.left = Math.min(bounds.left, box.left);
        bounds.right = Math.max(bounds.right, box.right);
        bounds.top = Math.min(bounds.top, box.top);
        bounds.bottom = Math.max(bounds.bottom, box.bottom);
      }
      if (Object.values(bounds).every(Number.isFinite) &&
        !result.some((s, i) => !taken.has(i) && overlaps(bounds, mergeControlBounds(s), displayPadding)))
        damage = { bounds, artwork: settled.pieces };
    } catch {
      // The artwork is admitted. The view can repaint the full scene.
    }
  }
  return { shapes: settled.shapes, ...(damage ? { damage } : {}),
    ...(unchangedRoots?.length ? { unchangedRoots } : {}) };
}
