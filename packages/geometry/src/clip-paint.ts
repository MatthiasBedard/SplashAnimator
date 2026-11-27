import type { MultiPolygon } from 'polygon-clipping';
import { clone, id, type Point, type Vector } from '@splash/document';
import { paintRegionBounds } from './paint-region-transform';
import { hasVectorFill, mayIntersectPaint, mergeControlBounds, vectorPolygons } from './merge';
import { boundsIndex, overlaps, type Bounds } from './bounds-index';
import { CurveSubdivisionLimitError } from './drawing';
import clipping, { boundedSelectionFault, evenOddPaint, UnresolvedPaintContour, PAINT_GRID_STEP, withSelectionClipping } from './paint-clipping';
import { polygonVectors, worldStrokePolygons } from './strokes';
import { regionContains, type PaintRegion, type RegionOperation } from './paint-region';
import { hasRestorableFillCurves, OVERLAY_CURVE_TOLERANCE, restoreClippedFillCurves } from './clip-fill-curves';
import { restorePaintCurves } from './paint-curves';
import { isEditableInk, prepareStrokeSelection } from './stroke-cut';
import { inversePoint, mapPoint, matrix } from './affine';
import { overlappingRectangleOutline, prepareIndependentPaintCuts, prepareSharedPaintStack, prepareSharedRectangleCut } from './shared-paint-cut';
import { joinOverlayFills, joinRecoloredFills, paintSeparation, prepareMatchingFillJoins } from './join-recolored-fills';
import { checkPaintEdgeProvenance, PAINT_EDGE_WORK_LIMIT, PaintCurveLossError } from './paint-edge-provenance';
export type PaintClip = {
  polygon?: Point[];
  region?: PaintRegion;
  keep: 'inside' | 'outside';
  eligible: string[];
  /** Authoring transforms retain fully selected strokes instead of outlining them. */
  preserveStrokes?: boolean;
  /** Keep original curved spans on a cut or deleted region's surviving fill. */
  preserveOutsideFillCurves?: boolean;
  /** A drop that only cuts a fill leaves its untouched editable outline intact. */
  preserveOutsideStroke?: boolean;
};
type CurvedSelection = { inside: Vector[]; outside: Vector[] };
export function combinePaintRegion({ current, polygon, mode }: RegionOperation): PaintRegion {
  validateRegion(current);
  const incoming = polygonRegion(polygon);
  const result =
    mode === 'replace'
      ? incoming
      : mode === 'add'
        ? clipping.union(current, incoming)
        : mode === 'subtract'
          ? clipping.difference(current, incoming)
          : clipping.intersection(current, incoming);
  validateRegion(result);
  return result;
}
/** A completed paint selection owns only intersected artwork, not the empty
 * margins of its marquee/lasso. Reuse the same fill/stroke polygons as edits. */
export function selectPaintRegion(
  shapes: Vector[],
  request: RegionOperation,
  eligible: string[],
): PaintRegion {
  return preparePaintSelection(shapes, request, eligible).footprint;
}
export function preparePaintSelection(shapes: Vector[], request: RegionOperation, eligible: string[]) {
  return withSelectionClipping(() => {
    const mask = combinePaintRegion(request);
    return { mask, footprint: paintSelectionFootprint(shapes, mask, eligible) };
  });
}
/** An editor replacement marquee can retain original roots whenever every
 * unresolved or hit drawing is proven fully enclosed. */
export function prepareEditorPaintSelection(
  shapes: Vector[], request: RegionOperation, eligible: string[], previousOmissions: readonly string[] = [],
) {
  return withSelectionClipping(() => {
    const mask = combinePaintRegion(request);
    const replace = request.mode === 'replace';
    const oldBounds = request.mode === 'add' ? paintRegionBounds(request.current) : null;
    // An additive edit may leave out a newly reached drawing only when its
    // bounds prove it cannot contribute to the previously selected paint.
    const canOmit = replace ? () => true : request.mode === 'add'
      ? (shape: Vector) => !oldBounds || !mayIntersectPaint(shape, oldBounds)
      : undefined;
    const retainedOmissions = !replace && previousOmissions.length
      ? new Set(previousOmissions) : undefined;
    const { parts, candidates, omitted, cutCandidates } = collectPaintSelection(
      shapes, mask, eligible, canOmit, true, retainedOmissions,
    );
    const recoverWhole = () => {
      if (!replace || !candidates.length) return;
      const encloses = editableEnclosure(mask, paintRegionBounds(mask)!);
      if (encloses && candidates.every(encloses)) return candidates.map(shape => shape.id);
    };
    const whole = omitted.length ? recoverWhole() : undefined;
    if (whole) return { mask, footprint: [], whole };
    try {
      return { mask, cutCandidates, footprint: unionSelectionParts(parts), ...(omitted.length ? { omitted } : {}) };
    } catch (error) {
      if (!(error instanceof UnresolvedPaintContour) && !boundedSelectionFault(error)) throw error;
      const enclosed = omitted.length ? undefined : recoverWhole();
      if (enclosed) return { mask, footprint: [], whole: enclosed };
      // Every part already passed its own clip. Keep these results for bounds
      // and picking. Only the shared outline failed, so edits still use mask.
      const footprint = parts.flat();
      validateRegion(footprint);
      return { mask, cutCandidates, footprint, separate: true, ...(omitted.length ? { omitted } : {}) };
    }
  });
}
function rectangleMask(mask: PaintRegion, bounds: NonNullable<ReturnType<typeof paintRegionBounds>>) {
  const ring = mask[0]?.[0];
  if (mask.length !== 1 || mask[0].length !== 1 || ring?.length !== 5) return false;
  const corners = ring.slice(0, -1);
  return corners.every(([x, y], index) => {
    const [nx, ny] = corners[(index + 1) % corners.length];
    return (x === bounds.left || x === bounds.right) && (y === bounds.top || y === bounds.bottom) &&
      ((x === nx) !== (y === ny)) && corners.findIndex(([cx, cy]) => cx === x && cy === y) === index;
  });
}
const enclosurePadding = 2 * PAINT_GRID_STEP;
function fitsPaddedBounds(hull: Bounds, bounds: Bounds) {
  return Object.values(hull).every(Number.isFinite) &&
    hull.left >= bounds.left + enclosurePadding && hull.top >= bounds.top + enclosurePadding &&
    hull.right <= bounds.right - enclosurePadding && hull.bottom <= bounds.bottom - enclosurePadding;
}
function whollyInsideRectangle(shape: Vector, bounds: Bounds) {
  return fitsPaddedBounds(mergeControlBounds(shape), bounds);
}
function editableEnclosure(mask: PaintRegion, bounds: Bounds) {
  if (rectangleMask(mask, bounds)) return (shape: Vector) => whollyInsideRectangle(shape, bounds);
  // Keep the midpoint classification within the established paint grid range.
  if (Object.values(bounds).some(coordinate => Math.abs(coordinate) > 2 ** 50 * PAINT_GRID_STEP))
    return undefined;
  let boundaryIndex: ReturnType<typeof boundsIndex> | undefined;
  return (shape: Vector) => {
    const hull = mergeControlBounds(shape);
    if (!fitsPaddedBounds(hull, bounds)) return false;
    boundaryIndex ??= boundsIndex(mask.flatMap(polygon => polygon.flatMap(ring =>
      ring.map(([x, y], i) => {
        const [nextX, nextY] = ring[(i + 1) % ring.length];
        return { left: Math.min(x, nextX), right: Math.max(x, nextX),
          top: Math.min(y, nextY), bottom: Math.max(y, nextY) };
      }),
    )));
    // The padded hull is connected. With no boundary touching it, its
    // center classifies the whole hull, including any interior mask holes.
    return !boundaryIndex(hull, enclosurePadding).length && regionContains(mask, {
      x: hull.left / 2 + hull.right / 2,
      y: hull.top / 2 + hull.bottom / 2,
    });
  };
}
function collectPaintSelection(
  shapes: Vector[], mask: PaintRegion, eligible: string[],
  canOmit?: (shape: Vector) => boolean, retainCandidates = false, retainedOmissions?: ReadonlySet<string>,
) {
  const allowed = new Set(eligible), bounds = paintRegionBounds(mask);
  const parts: PaintRegion[] = [];
  const candidates: Vector[] = [];
  const omitted: string[] = [];
  const cutCandidates: string[] = [];
  if (!bounds) return { parts, candidates, omitted, cutCandidates };
  const rectangle = rectangleMask(mask, bounds);
  let cutStroke: ReturnType<typeof prepareStrokeSelection> | undefined;
  for (const shape of shapes) {
    if (!allowed.has(shape.id) || shape.kind === 'text' || !mayIntersectPaint(shape,bounds)) continue;
    if (retainedOmissions?.has(shape.id)) {
      omitted.push(shape.id);
      continue;
    }
    if (retainCandidates) cutCandidates.push(shape.id);
    const first = parts.length;
    try {
      if (retainCandidates && isEditableInk(shape)) {
        cutStroke ??= prepareStrokeSelection(mask, bounds);
        for (const stroke of cutStroke(shape, 'inside')) {
          const paint = worldStrokePolygons(stroke);
          const inside = paint.length ? clipping.intersection(paint, mask) : [];
          if (inside.length) parts.push(inside);
        }
      } else for (const paint of [vectorPolygons(shape), worldStrokePolygons(shape)]) {
        if (!paint.length) continue;
        const box = rectangle ? paintRegionBounds(paint) : null;
        const inside = box && box.left >= bounds.left && box.top >= bounds.top &&
          box.right <= bounds.right && box.bottom <= bounds.bottom ? paint : clipping.intersection(paint, mask);
        if (inside.length) parts.push(inside);
      }
    } catch (error) {
      if (!(error instanceof UnresolvedPaintContour) || !canOmit?.(shape)) throw error;
      parts.length = first;
      omitted.push(shape.id);
      candidates.push(shape);
      continue;
    }
    if (canOmit && parts.length > first) candidates.push(shape);
  }
  return { parts, candidates, omitted, cutCandidates };
}
export function paintSelectionFootprint(shapes: Vector[], mask: PaintRegion, eligible: string[]): PaintRegion {
  return unionSelectionParts(collectPaintSelection(shapes, mask, eligible).parts);
}
function unionSelectionParts(parts: PaintRegion[]): PaintRegion {
  if (!parts.length) return [];
  if (parts.length === 1) {
    validateRegion(parts[0]);
    return parts[0];
  }
  const entries = parts.map(paint => ({ paint, box: paintRegionBounds(paint)! }));
  const components = (items: typeof entries, low: 'left' | 'top', high: 'right' | 'bottom') => {
    items.sort((a, b) => a.box[low] - b.box[low]);
    const groups: (typeof entries)[] = [];
    let end = -Infinity;
    for (const item of items) {
      if (item.box[low] > end + 2 * PAINT_GRID_STEP) groups.push([]);
      groups.at(-1)!.push(item);
      end = Math.max(end, item.box[high]);
    }
    return groups;
  };
  // A gap on either axis separates sweeps. Sorting avoids building a dense
  // pairwise overlap graph when all of the paint is in the same area.
  const selected = components(entries, 'left', 'right').flatMap(column =>
    components(column, 'top', 'bottom').flatMap(row => unionOverlappingParts(row.map(({ paint }) => paint))));
  validateRegion(selected);
  return selected;
}
function unionOverlappingParts(parts: PaintRegion[]): PaintRegion {
  // Balanced batches avoid repeatedly unioning a growing selection for every
  // separate paint object. This bounds call arity, not admitted artwork size.
  while (parts.length > 1) {
    const next: PaintRegion[] = [];
    for (let i = 0; i < parts.length; i += 32) {
      const batch = parts.slice(i, i + 32);
      next.push(clipping.union(batch[0], ...batch.slice(1)));
    }
    parts = next;
  }
  return parts[0] ?? [];
}

export function deletePaintRegion(shapes: Vector[], region: PaintRegion, eligible: string[]) {
  return withSelectionClipping(() => {
    const bounds = paintRegionBounds(region);
    const encloses = bounds ? editableEnclosure(region, bounds) : undefined;
    let preserved = 0;
    const artwork = clipArtwork(shapes, { region, eligible, keep: 'outside', preserveStrokes: true,
      preserveOutsideFillCurves: true }, (shape, error) => {
      if (!(error instanceof UnresolvedPaintContour)) throw error;
      // If the entire original control hull and stroke are inside the mask,
      // removal needs no reconstructed contour. A crossing root stays exact.
      if (encloses?.(shape)) return [];
      preserved++;
      return [shape];
    });
    return { artwork, changed: artwork.length !== shapes.length || artwork.some((shape, index) => shape !== shapes[index]),
      ...(preserved ? { preserved } : {}) };
  });
}
function validateRegion(region: PaintRegion) {
  // Validate in place: a combined selection need not allocate a flattened copy
  // or impose a lower total-artwork budget than the document itself.
  for (const polygon of region)
    for (const ring of polygon)
      for (const [x, y] of ring)
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error('Paint region requires finite coordinates.');
}
function polygonRegion(polygon: Point[]): PaintRegion {
  if (polygon.length < 3 || polygon.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Paint region needs at least three finite points.');
  const ring = polygon.map((p) => [p.x, p.y] as [number, number]);
  ring.push([...ring[0]]);
  // Match whole-object lasso parity, including self-crossing/retraced outlines.
  const mask = evenOddPaint([[ring]]);
  if (!mask.length) throw new Error('Paint region has no area.');
  return mask;
}
/** Clip visible paint geometry in stage coordinates without changing source vectors. */
export function clipPaint(shapes: Vector[], clip: PaintClip, sourceCounts?: number[]): Vector[] {
  return clipArtwork(shapes, clip, undefined, sourceCounts);
}

/** Per-source counts retain paint order when the caller skipped disjoint sources. */
export function clipOutsidePaintWithSourceCounts(shapes: Vector[], clip: Omit<PaintClip, 'keep'>) {
  const counts: number[] = [];
  const artwork = clipArtwork(shapes, { ...clip, keep: 'outside' }, undefined, counts);
  return { artwork, counts };
}

/** A single mask owns these partitions. Each side keeps its usual clipping allowance. */
export function splitPaintSelection(shapes: Vector[], clip: Omit<PaintClip, 'keep'>) {
  const partitions = new Map<Vector, CurvedSelection>();
  const counts: number[] = [];
  const inside = withSelectionClipping(() => clipArtwork(shapes, { ...clip, keep: 'inside' },
    undefined, undefined, undefined, undefined, partitions, true));
  const artwork = inside.length ? withSelectionClipping(() => clipArtwork(shapes, { ...clip, keep: 'outside' },
    undefined, counts, undefined, undefined, partitions, true)) : [];
  return { inside, artwork, counts };
}
/** If an exact face walk cannot be certified, both restored halves must still
 * trace to the original curves or to real edges of the selection mask. */
function curvedSelection(source: Vector, fill: MultiPolygon, mask: MultiPolygon, maskShape: Vector): CurvedSelection {
  const exact = prepareSharedPaintStack([source], maskShape, 'selection');
  if (exact && 'selection' in exact) return exact.selection;
  const intersection = clipping.intersection(fill, mask);
  if (!intersection.length) return { inside: [], outside: [source] };
  const difference = clipping.difference(fill, mask);
  if (!difference.length) return { inside: [source], outside: [] };
  const restore = (paint: MultiPolygon) => restorePaintCurves(
    polygonVectors(source, paint, true).map(piece => ({ ...piece, id: id() })), [source]);
  const inside = restore(intersection), outside = restore(difference);
  checkPaintEdgeProvenance([source, maskShape], [...inside, ...outside]);
  return { inside, outside };
}

/** Exact fallback when the restored curves cannot be certified. Both halves
 * come from the same Boolean, so the lifted paint and the paint left behind
 * still meet along the selection edge. */
function polygonSelection(source: Vector, fill: MultiPolygon, mask: MultiPolygon): CurvedSelection {
  const intersection = clipping.intersection(fill, mask);
  if (!intersection.length) return { inside: [], outside: [source] };
  const difference = clipping.difference(fill, mask);
  if (!difference.length) return { inside: [source], outside: [] };
  const pieces = (paint: MultiPolygon) =>
    polygonVectors(source, paint, true).map(piece => ({ ...piece, id: id() }));
  return { inside: pieces(intersection), outside: pieces(difference) };
}

function clipArtwork(
  shapes: Vector[], clip: PaintClip, recover?: (source: Vector, error: unknown) => Vector[],
  sourceCounts?: number[],
  curvedCutters?: ReadonlySet<Vector>,
  enclosedCutter?: Vector,
  shared?: Map<Vector, CurvedSelection>,
  splitUncertifiedCurves = false,
): Vector[] {
  const { keep, eligible, preserveOutsideFillCurves } = clip;
  if (clip.preserveStrokes !== undefined && typeof clip.preserveStrokes !== 'boolean')
    throw Error('Stroke preservation requires an explicit boolean.');
  if (preserveOutsideFillCurves !== undefined && typeof preserveOutsideFillCurves !== 'boolean')
    throw Error('Fill curve preservation requires an explicit boolean.');
  const mask = clip.region ?? polygonRegion(clip.polygon ?? []);
  const bounds=paintRegionBounds(mask);
  if (!bounds) {
    if (sourceCounts) for (let index = 0; index < shapes.length; index++) sourceCounts.push(Number(keep === 'outside'));
    return keep === 'outside' ? shapes : [];
  }
  const retainsEnclosedArtwork = clip.preserveStrokes ? editableEnclosure(mask, bounds) : undefined;
  const eligibleIds = new Set(eligible);
  const owners = new Map<Vector, Vector>();
  let maskVector: Vector | undefined;
  const fineSources = curvedCutters && new Set<Vector>();
  let cutStroke: ReturnType<typeof prepareStrokeSelection> | undefined;
  const fillPieces = (source: Vector, paint: MultiPolygon) => {
    const pieces = polygonVectors(source, paint, true).map(piece => ({ ...piece, id: id() }));
    if (keep === 'outside' && preserveOutsideFillCurves && (curvedCutters?.size || hasRestorableFillCurves(source))) {
      for (const piece of pieces) owners.set(piece, source);
    }
    return pieces;
  };
  const clipShape = (s: Vector) => {
    if (!eligibleIds.has(s.id) || s.kind === 'text' || !mayIntersectPaint(s,bounds)) return keep === 'outside' ? [s] : [];
    if (clip.preserveStrokes && isEditableInk(s)) {
      cutStroke ??= prepareStrokeSelection(mask, bounds, !clip.preserveOutsideStroke);
      const strokes = cutStroke(s, keep);
      return keep === 'inside' && strokes[0] === s ? [clone(s)] : strokes;
    }
    const fill = fineSources ? overlayPolygons(s, fineSources) : vectorPolygons(s),
      stroke = worldStrokePolygons(s);
    if (enclosedCutter && !stroke.length) {
      const exact = replaceEnclosedRectanglePaint(s, fill, enclosedCutter);
      if (exact) return [exact];
    }
    // Once the paint and entire control hull are admitted, keep the editable
    // authored geometry instead of running a Boolean that cannot cut it.
    if ((fill.length || stroke.length) && retainsEnclosedArtwork?.(s))
      return keep === 'inside' ? [clone(s)] : [];
    // A selection cuts the original curves. Use the same subdivision for
    // the lifted piece and the paint left in its original stack slot.
    if (clip.preserveStrokes && !curvedCutters && !s.strokeWidth && hasRestorableFillCurves(s) &&
        s.fillEnabled !== false && !s.gradient && !s.bitmap && s.drawingMode !== 'object') {
      let cut = shared?.get(s);
      if (!cut) {
        maskVector ??= { id: 'selection-mask', kind: 'polygon', closed: true, x: 0, y: 0,
          width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, rotation: 0,
          fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [], fillRule: 'evenodd',
          contours: mask.flatMap(polygon => polygon.map(ring => {
            const last = ring.at(-1);
            const vertices = last && last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0,-1) : ring;
            return vertices.map(([x,y]) => ({x,y}));
          })) };
        try {
          cut = curvedSelection(s, fill, mask, maskVector);
        } catch (error) {
          if (!(error instanceof PaintCurveLossError)) throw error;
          if (recover) throw new UnresolvedPaintContour(error.message);
          // A Move or Cut lifts everything the selection footprint shows.
          // Leaving this whole fill in its slot would strand the selected part
          // at its old position, so cut it along the mask without curves.
          cut = splitUncertifiedCurves ? polygonSelection(s, fill, mask) : { inside: [], outside: [s] };
        }
        shared?.set(s, cut);
      }
      return cut[keep].map(piece => keep === 'inside' && piece === s ? clone(s) : piece);
    }
    const intersection = (paint: MultiPolygon) =>
      paint.length ? clipping.intersection(paint, mask) : [];
    const insideFill = intersection(fill),
      insideStroke = intersection(stroke);
    if (!insideFill.length && !insideStroke.length) return keep === 'outside' ? [s] : [];
    if (keep === 'outside' && clip.preserveOutsideStroke && stroke.length && !insideStroke.length) {
      return [...fillPieces(s, clipping.difference(fill, mask)),
        { ...clone(s), fillEnabled: false, gradient: undefined, bitmap: undefined }];
    }
    if (clip.preserveStrokes && stroke.length && insideStroke.length) {
      // Prove complete painted coverage with the same Boolean kernel used for
      // selection. A centreline/bounds hit cannot justify retaining a stroke:
      // caps, joins and the complete affine width must all be selected.
      const outsideStroke = clipping.difference(stroke, mask);
      if (!outsideStroke.length) {
        const outsideFill = fill.length ? clipping.difference(fill, mask) : [];
        if (!outsideFill.length) return keep === 'inside' ? [clone(s)] : [];
        const fills = fillPieces(s, keep === 'inside' ? insideFill : outsideFill);
        return keep === 'inside'
          ? [...fills, { ...clone(s), fillEnabled: false, gradient: undefined, bitmap: undefined }]
          : fills;
      }
    }
    const part = (paint: MultiPolygon, inside: MultiPolygon) =>
      keep === 'inside' ? inside : paint.length ? clipping.difference(paint, mask) : [];
    return [
      ...fillPieces(s, part(fill, insideFill)),
      ...polygonVectors(
        { ...s, fill: s.stroke, bitmap: undefined, gradient: undefined },
        part(stroke, insideStroke),
        true,
      ).map(piece => ({ ...piece, id: id() })),
    ];
  };
  const clipSource = recover ? (s: Vector) => {
    try { return clipShape(s); }
    catch (error) { return recover(s, error); }
  } : clipShape;
  const artwork = shapes.flatMap(s => {
    const pieces = clipSource(s);
    sourceCounts?.push(pieces.length);
    return pieces;
  });
  return restoreClippedFillCurves(artwork, owners, mask, curvedCutters, fineSources);
}

/** For a wholly enclosed even-odd cutter, subtraction is parity with its
 * original rings. Retain the smooth boundary verbatim instead of restoring
 * it from rounded Boolean samples. */
function straightRectangle(source: Vector, fill: MultiPolygon) {
  if (source.strokeWidth || (source.kind !== 'rectangle' && source.kind !== 'polygon') ||
      hasRestorableFillCurves(source) ||
      (source.contours ? source.contours.length !== 1 || source.contours[0].length !== 4 : source.kind !== 'rectangle') ||
      source.rotation || source.transform) return;
  const box = paintRegionBounds(fill);
  if (!box || !rectangleMask(fill, box)) return;
  const outer = source.contours?.[0] ?? [{ x: 0, y: 0 }, { x: source.width, y: 0 },
    { x: source.width, y: source.height }, { x: 0, y: source.height }];
  const world = outer.map(node => {
    const { x, y } = mapPoint(matrix(source), node);
    return [x, y] as [number, number];
  });
  if (!rectangleMask([[[...world, world[0]]]], box)) return;
  return { outer, box };
}
function replaceEnclosedRectanglePaint(source: Vector, fill: MultiPolygon, cutter: Vector): Vector | undefined {
  const rectangle = straightRectangle(source, fill);
  if (!rectangle || !cutter.contours?.length || cutter.fillRule !== 'evenodd' ||
      !whollyInsideRectangle(cutter, rectangle.box)) return;
  const from = matrix(cutter), to = matrix(source);
  const local = (p: Point) => inversePoint(to, mapPoint(from, p));
  const holes = cutter.contours.map(ring => ring.map(node => ({
    ...local(node), ...(node.in ? { in: local(node.in) } : {}), ...(node.out ? { out: local(node.out) } : {}),
  })));
  return { ...source, id: id(), kind: 'polygon', points: [], nodes: undefined, closed: true,
    cornerRadius: undefined, fillRule: 'evenodd', contours: [clone(rectangle.outer), ...holes], drawingMode: 'merge' };
}

/** Overlay boundaries need a finer chord near crossings where a complete
 * source interval cannot be recovered. Retain the original subdivision limits. */
function overlayPolygons(shape: Vector, fineSources: Set<Vector>) {
  if (hasRestorableFillCurves(shape)) {
    try {
      const mask = vectorPolygons(shape, OVERLAY_CURVE_TOLERANCE);
      fineSources.add(shape);
      return mask;
    } catch (cause) {
      if (!(cause instanceof CurveSubdivisionLimitError || cause instanceof UnresolvedPaintContour)) throw cause;
    }
  }
  return vectorPolygons(shape);
}

/** Only a moved fill replaces destination paint. An editable stroke overlays it. */
export function dropPaintSelection(shapes: Vector[], moved: string[], eligible: string[]): Vector[] {
  return preparePaintDrop(shapes, moved, eligible).artwork;
}
export type PaintDrop = { artwork: Vector[]; preservedDestination: boolean;
  absorbedFill?: { moving: string; into: string };
  absorbedFills?: { moving: string; into: string }[] };

function canCutSolidOverlayFill(shape: Vector) {
  const opacity = shape.opacity ?? 1;
  return hasVectorFill(shape) && shape.kind !== 'symbol' && shape.strokeWidth === 0 &&
    shape.drawingMode !== 'object' && /^#[\da-f]{6}$/i.test(shape.fill) &&
    Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 && !shape.gradient && !shape.bitmap &&
    !shape.blendMode && !shape.tint && !shape.blurRadius && !shape.groupBlur;
}

export function canJoinOverlayFills(a: Vector, b: Vector) {
  return canCutSolidOverlayFill(a) && canCutSolidOverlayFill(b) &&
    (a.opacity ?? 1) === 1 && (b.opacity ?? 1) === 1 && a.fill.toLowerCase() === b.fill.toLowerCase() &&
    (a.paintBrightness ?? 0) === (b.paintBrightness ?? 0) &&
    (a.groups ?? []).join('\0') === (b.groups ?? []).join('\0');
}

function ordinaryOverlayInk(shape: Vector, top: Vector) {
  return shape.fillEnabled === false && isEditableInk(shape) && shape.drawingMode !== 'object' &&
    (shape.opacity ?? 1) === 1 && !shape.gradient && !shape.bitmap && !shape.blendMode &&
    !shape.tint && !shape.blurRadius && !shape.groupBlur &&
    (shape.groups ?? []).join('\0') === (top.groups ?? []).join('\0');
}

/** Keep reunited material at the highest absorbed destination's stack slot.
 * Moving the lower material past an intervening object must preserve the
 * visible stacking. Other eligible paint above the slot is cut by the drop. */
function dropUnionOwner(stationary: Vector[], matches: Vector[], eligible: Set<Vector>, incoming: Vector, footprint: Bounds,
  cut?: Map<Vector,Vector[]>) {
  if (!matches.length) return;
  const joined = new Set(matches), matchesAt = boundsIndex(matches.map(mergeControlBounds));
  const slots = stationary.flatMap((s,i)=>joined.has(s) ? [i] : []);
  const first = slots[0], last = slots.at(-1)!;
  const lower = new Set<Vector>();
  let work = 0;
  const separate = paintSeparation(() => {
    if (++work > 200000) throw Error('Paint stacking work limit reached.');
  });
  for (const [i,s] of stationary.entries()) {
    if (joined.has(s)) {
      lower.add(s);
      continue;
    }
    const unknown = s.kind==='symbol' || s.kind==='text' || s.blurRadius || s.groupBlur || s.blendMode;
    if (i>first && i<last) {
      if (unknown) return;
      for (const index of matchesAt(mergeControlBounds(s),2*PAINT_GRID_STEP)) {
        const face = matches[index];
        if (!lower.has(face) || separate(s,face)) continue;
        // Only surviving paint changes stack slots. A cut can remove all
        // overlap here even when the two original interiors crossed.
        const barrierRemainder = cut?.get(s), faceRemainder = cut?.get(face);
        if (!barrierRemainder && !faceRemainder) return;
        if ((barrierRemainder ?? [s]).some(barrier =>
          (faceRemainder ?? [face]).some(piece => !separate(barrier,piece)))) return;
      }
    }
    if (i>last && !eligible.has(s) && (unknown ||
      overlaps(mergeControlBounds(s),footprint,2*PAINT_GRID_STEP) && !separate(s,incoming))) return;
  }
  return stationary[last];
}

export function preparePaintDrop(shapes: Vector[], moved: string[], eligible: string[], joinFills = true): PaintDrop {
  return withSelectionClipping(() => preparePaintDropWithinBudget(shapes,moved,eligible,joinFills));
}

function preparePaintDropWithinBudget(shapes: Vector[], moved: string[], eligible: string[], joinFills: boolean,
  ownerRetryBudget?: { remaining: number }): PaintDrop {
  const ids = new Set(moved), allowed = new Set(eligible);
  const moving = shapes.filter(s => ids.has(s.id)), stationary = shapes.filter(s => !ids.has(s.id));
  if (joinFills && moving.length > 1 && moving.length === moved.length) {
    const joined = prepareGroupPaintDrop(stationary,moving,allowed);
    if (joined) return joined;
  }
  const top = moving[0];
  let certifiedDrop: PaintDrop | undefined;
  if (moving.length === 1 && moved.length === 1 && canJoinOverlayFills(top, top)) {
    const box = mergeControlBounds(top);
    const nearby = stationary.filter(s => allowed.has(s.id) && s.kind !== 'text' && s.kind !== 'symbol' &&
      overlaps(mergeControlBounds(s), box, 2 * PAINT_GRID_STEP));
    const matching = joinFills && nearby.some(s=>canJoinOverlayFills(s,top));
    const ink = nearby.filter(s=>ordinaryOverlayInk(s,top) && !s.rotation && !s.transform && !s.brush);
    const inkSet = new Set(ink);
    if (nearby.length && nearby.every(s => canJoinOverlayFills(s, s) || inkSet.has(s)) &&
        (matching || hasRestorableFillCurves(top) || nearby.some(hasRestorableFillCurves))) {
      const cut = prepareSharedPaintStack(nearby, top, matching ? 'union' : 'paint',
        ink.length ? { removeCoveredInk:true } : undefined);
      // A drop retains the moved object's identity and authoring box.
      // Its uncut cubics describe the same seam as the split intervals.
      if (cut && !matching) return { artwork: [...stationary.flatMap(s => cut.background.get(s) ?? [s]), top], preservedDestination: false };
      if (cut && matching) {
        // A face can share an edge with the incoming fill without losing any
        // area to it. Trace the connected material through both the cut
        // fragments and these original neighbors, respecting surviving ink.
        const candidates = nearby.filter(s=>canJoinOverlayFills(s,top));
        const pieces = candidates.flatMap(s=>cut.background.get(s) ?? [s]);
        const visibleInk = ink.flatMap(s=>cut.background.get(s) ?? [s]);
        const joined = prepareMatchingFillJoins([...pieces,cut.foreground,...visibleInk],[top.id]);
        const remains = (source: Vector) => cut.background.get(source) ?? [source];
        const matches = candidates.filter(s=>cut.background.has(s) || joined.absorbed.has(s.id));
        const complete = matches.every(s=>remains(s).every(p=>joined.absorbed.has(p.id)));
        const owner = complete && dropUnionOwner(stationary,matches,new Set(nearby),top,box,cut.background);
        if (owner) {
          const face = joined.artwork.find(s=>s.id===top.id)!, absorbed = new Set(matches);
          const unified: Vector = {...owner,x:face.x,y:face.y,width:face.width,height:face.height,
            rotation:face.rotation,transform:face.transform,kind:face.kind,closed:face.closed,fillRule:face.fillRule,
            points:face.points,nodes:face.nodes,contours:face.contours,brush:undefined,
            cornerRadius:face.cornerRadius,drawingMode:'merge',
            pivot:owner.pivot && inversePoint(matrix(face),mapPoint(matrix(owner),owner.pivot))};
          return {artwork:stationary.flatMap(s=>s===owner?[unified]:absorbed.has(s)?[]:remains(s)),
            preservedDestination:false,absorbedFill:{moving:top.id,into:owner.id}};
        }
        // The shared pass subtracts the cutter from each paint owner. Keep
        // those cuts if the joined material cannot safely change stack slots.
        if (nearby.length - ink.length > 1)
          certifiedDrop = { artwork:[...stationary.flatMap(remains),top], preservedDestination:false };
      }
    }
  }
  const result = resolvePaintDrop(shapes, moved, eligible, joinFills);
  try {
    checkPaintEdgeProvenance(shapes, result.artwork, ownerRetryBudget);
    return result.preservedDestination && certifiedDrop ? certifiedDrop : result;
  } catch (error) {
    if (!(error instanceof PaintCurveLossError)) throw error;
    // Keep the drop's existing stacking/identity admission for a union,
    // but build its exterior from the same shared curves used on draw.
    const into = result.absorbedFill?.into;
    const owner = into && stationary.find(s => s.id === into);
    if (owner && moving.length === 1) {
      const neighbors = stationary.filter(s => allowed.has(s.id) && canJoinOverlayFills(s, top) &&
        overlaps(mergeControlBounds(s), mergeControlBounds(top), 2 * PAINT_GRID_STEP));
      const shared = prepareSharedPaintStack(neighbors, top, 'union');
      if (shared) {
        const joined = joinRecoloredFills([...neighbors.flatMap(s => shared.background.get(s) ?? [s]), shared.foreground], [top.id]);
        if (joined.length === 1) {
          const artwork = result.artwork.map(s => s.id === into ? { ...joined[0], id: owner.id } : s);
          try { checkPaintEdgeProvenance(shapes, artwork); return { ...result, artwork }; }
          catch (cause) { if (!(cause instanceof PaintCurveLossError)) throw cause; }
        }
      }
    }
    const mixed = prepareMixedCutterDrop(stationary, moving, eligible);
    if (mixed) {
      try {
        checkPaintEdgeProvenance(shapes, mixed, ownerRetryBudget);
        return { artwork: mixed, preservedDestination: false };
      } catch (cause) { if (!(cause instanceof PaintCurveLossError)) throw cause; }
    }
    if (!ownerRetryBudget && moving.length > 1) {
      const independent = retryMixedDropByOwner(stationary, moving, allowed);
      if (independent) {
        try {
          checkPaintEdgeProvenance(shapes, independent.artwork);
          return independent;
        } catch (cause) { if (!(cause instanceof PaintCurveLossError)) throw cause; }
      }
    }
    return certifiedDrop ?? { artwork: [...stationary, ...moving], preservedDestination: true };
  }
}

/** The combined cutter can fail provenance on one destination. Retry only
 * owners near the moved paint. A failed cut never replaces that owner's art. */
function retryMixedDropByOwner(stationary: Vector[], moving: Vector[], allowed: ReadonlySet<string>): PaintDrop | undefined {
  const fills = moving.filter(s => s.kind !== 'symbol' && s.drawingMode !== 'object' && hasVectorFill(s));
  if (fills.length < 2) return;
  const fillBoxes = fills.map(mergeControlBounds), lookup = boundsIndex(fillBoxes);
  const budget = { remaining: PAINT_EDGE_WORK_LIMIT }, padding = 2 * PAINT_GRID_STEP;
  let changed = false, preservedDestination = false;
  const tryCut = (sources: Vector[], cutters: Vector[]): Vector[] | undefined => {
    for (const shape of [...sources, ...cutters])
      budget.remaining -= 1 + (shape.contours?.reduce((count, ring) => count + ring.length, 0) ??
        shape.nodes?.length ?? shape.points.length);
    if (budget.remaining < 0) return;
    const result = preparePaintDropWithinBudget([...sources, ...cutters], cutters.map(s => s.id), sources.map(s => s.id),
      false, budget);
    if (!result.preservedDestination && cutters.every((cutter, i) =>
      result.artwork[result.artwork.length - cutters.length + i] === cutter))
      return result.artwork.slice(0, -cutters.length);
  };
  const remainder = stationary.flatMap(owner => {
    if (!allowed.has(owner.id) || owner.kind === 'text' || owner.kind === 'symbol' || owner.drawingMode === 'object')
      return [owner];
    const indices = lookup(mergeControlBounds(owner), padding).sort((a, b) => a - b);
    if (!indices.length) return [owner];
    let pieces: Vector[] | undefined = tryCut([owner], indices.map(i => fills[i]));
    if (!pieces) {
      pieces = [owner];
      if (indices.length === 1) preservedDestination = true;
      else for (const i of indices) {
        const touching: Vector[] = pieces.filter(piece => overlaps(mergeControlBounds(piece), fillBoxes[i], padding));
        if (!touching.length) continue;
        const cut = tryCut(touching, [fills[i]]);
        if (cut) pieces = [...pieces.filter(piece => !touching.includes(piece)), ...cut];
        else preservedDestination = true;
      }
    }
    if (pieces.length !== 1 || pieces[0] !== owner) changed = true;
    return pieces;
  });
  if (changed) return { artwork: [...remainder, ...moving], preservedDestination };
}

/** The combined polygon mask can lose the exact boundary of a curved mover.
 * Subtract straight cutters together, then use the shared seam for the curve.
 * The selected artwork stays in its original foreground order. */
function prepareMixedCutterDrop(stationary: Vector[], moving: Vector[], eligible: string[]) {
  const fills = moving.filter(s => s.drawingMode !== 'object' && hasVectorFill(s));
  const curved = fills.filter(hasRestorableFillCurves);
  if (curved.length !== 1 || fills.length < 2) return;
  const [cutter] = curved, straight = fills.filter(s => s !== cutter);
  const plain = resolvePaintDrop([...stationary, ...straight], straight.map(s => s.id), eligible, false);
  if (plain.preservedDestination) return;
  const base = plain.artwork.slice(0, -straight.length);
  const allowed = new Set(eligible);
  const protectedIds = new Set(stationary.filter(s => !allowed.has(s.id)).map(s => s.id));
  const cut = preparePaintDropWithinBudget([...base, cutter], [cutter.id],
    base.filter(s => !protectedIds.has(s.id)).map(s => s.id), false);
  if (cut.preservedDestination || cut.artwork.at(-1) !== cutter) return;
  return [...cut.artwork.slice(0, -1), ...moving];
}

/** Resolve each joining fill in foreground order, using the same cut as a
 * single-fill drop. Previously placed floating pieces remain stack barriers.
 * Any remaining paint overwrites the destination together in one operation. */
function prepareGroupPaintDrop(stationary: Vector[], moving: Vector[], allowed: Set<string>): PaintDrop | undefined {
  const targets = stationary.filter(s => allowed.has(s.id) && canJoinOverlayFills(s,s));
  if (!targets.length) return;
  const paint = [...targets,...moving.filter(s=>canJoinOverlayFills(s,s))];
  const boxes = paint.map(mergeControlBounds), lookup = boundsIndex(boxes);
  const joinedMaterial = new Set(targets);
  const originalTargets = new Map(targets.map(s=>[s.id,s]));
  const owners = new Set<string>();
  const protectedIds = new Set(stationary.filter(s=>!allowed.has(s.id)).map(s=>s.id));
  const eligibleIds = (art: Vector[]) => art.filter(s=>!protectedIds.has(s.id)).map(s=>s.id);
  let base = stationary;
  let attemptedJoin = false;
  const retained: Vector[] = [], absorbedFills: NonNullable<PaintDrop['absorbedFills']> = [];
  for (const piece of moving) {
    if (canJoinOverlayFills(piece,piece) && lookup(mergeControlBounds(piece),2*PAINT_GRID_STEP).some(i=>
      joinedMaterial.has(paint[i]) && canJoinOverlayFills(piece,paint[i]))) {
      attemptedJoin = true;
      const step = preparePaintDropWithinBudget([...base,...retained,piece],[piece.id],eligibleIds(base),true);
      const absorption = step.absorbedFill;
      if (absorption && originalTargets.has(absorption.into)) {
        // The worker can remap selected artwork only to admitted original
        // destinations. Earlier retained pieces must still occupy their slots.
        const count = step.artwork.length-retained.length;
        if (count < 0 || retained.some((shape,i)=>step.artwork[count+i]!==shape)) return;
        base = step.artwork.slice(0,count);
        if (owners.size && !(owners.size===1 && owners.has(absorption.into))) {
          const remaining = new Set(base.map(s=>s.id));
          for (const id of owners) if (!remaining.has(id)) {
            // A later piece can bridge two destinations that earlier moves joined.
            if (!canJoinOverlayFills(originalTargets.get(id)!,piece)) return;
            for (const earlier of absorbedFills) if (earlier.into===id) earlier.into=absorption.into;
            owners.delete(id);
          }
        }
        owners.add(absorption.into);
        absorbedFills.push(absorption);
        joinedMaterial.add(piece);
        continue;
      }
    }
    retained.push(piece);
  }
  const remainingPaint = retained.filter(hasVectorFill);
  // One moved fill can use the exact single-cutter route even when its
  // destination has a different color and accompanying ink also moved.
  if (!attemptedJoin && remainingPaint.length !== 1) return;
  if (!absorbedFills.length && remainingPaint.length!==1) return;
  let artwork = [...base,...retained];
  if (remainingPaint.length===1) {
    // Only this fill cuts the stationary layer. The selected ink keeps its
    // stack slot on either side of the fill, including where they overlap.
    const fill = remainingPaint[0];
    const cut = preparePaintDropWithinBudget([...base,fill],[fill.id],eligibleIds(base),false);
    if (cut.preservedDestination || cut.artwork.at(-1)!==fill) return;
    artwork = [...cut.artwork.slice(0,-1),...retained];
  } else if (remainingPaint.length) {
    const rest = preparePaintDropWithinBudget(artwork,retained.map(s=>s.id),eligibleIds(base),false);
    if (rest.preservedDestination) return;
    artwork = rest.artwork;
  }
  const finalIds = new Set(artwork.map(s=>s.id));
  if ([...owners].some(id=>!finalIds.has(id))) return;
  return absorbedFills.length ? {artwork,preservedDestination:false,absorbedFills} : {artwork,preservedDestination:false};
}

/** Reuse the final foreground outline for ordinary paint. Brush can also
 * remove covered portions of independently stored editable ink. */
export function prepareSolidPaintOverlay(shapes: Vector[], top: Vector, brush?: { removeCoveredInk: boolean }): Vector[] | undefined {
  const acceptsInk = (shape: Vector) => !!brush && ordinaryOverlayInk(shape,top);
  if (shapes.at(-1) !== top || !canJoinOverlayFills(top, top) ||
      !shapes.every(shape => canCutSolidOverlayFill(shape) || acceptsInk(shape)))
    return;
  const stationary = shapes.slice(0, -1);
  const retainedInk = new Set(brush && !brush.removeCoveredInk ? stationary.filter(acceptsInk) : []);
  const eligible = stationary.filter(shape => !retainedInk.has(shape)).map(shape => shape.id);
  const result = withSelectionClipping(() => {
    const curved = hasRestorableFillCurves(top);
    const bounds = mergeControlBounds(top);
    const nearby = stationary.filter(s => hasVectorFill(s) && overlaps(mergeControlBounds(s), bounds, 2 * PAINT_GRID_STEP));
    const crossingInk = brush?.removeCoveredInk ? stationary.filter(s => acceptsInk(s) &&
      overlaps(mergeControlBounds(s), bounds, 2 * PAINT_GRID_STEP)) : [];
    if (retainedInk.size && (!nearby.length || nearby.some(s => canJoinOverlayFills(s,top)))) {
      const ink = [...retainedInk].filter(s => overlaps(mergeControlBounds(s),bounds,2*PAINT_GRID_STEP));
      if (ink.length) {
        // Cut the old paint and the new face against the same vertices. Keep
        // Pencil centerlines above the new material in their original order.
        const cut = prepareSharedPaintStack([...nearby,...ink],top,'paint',{removeCoveredInk:false});
        if (!cut?.upperArtwork) return;
        const foreground = cut.upperArtwork;
        const artwork = stationary.flatMap(s => [
          ...(s === ink[0] ? foreground : []), ...(cut.background.get(s) ?? [clone(s)]),
        ]);
        const joined = nearby.some(s => canJoinOverlayFills(s,top))
          ? joinRecoloredFills(artwork,foreground.map(s=>s.id)) : artwork;
        return { artwork:joined, preservedDestination:false, positioned:true };
      }
      if (!nearby.length) return { artwork: [...stationary.map(s=>clone(s)),top], preservedDestination:false, positioned:true };
      return;
    }
    const [lower] = nearby;
    const compound = (top.contours?.length ?? 0) > 1;
    if ((nearby.length || crossingInk.length) && (compound || curved || nearby.some(hasRestorableFillCurves))) {
      try {
        const matching = nearby.some(s => canJoinOverlayFills(s, top));
        // A single enclosed contour leaves one background face. A compound
        // cutter also leaves separately editable islands inside its holes.
        const rectangle = nearby.length === 1 && !compound && curved && !matching && straightRectangle(lower, vectorPolygons(lower));
        // The direct hole writer copies stored even-odd contour nodes. A
        // primitive still needs the shared cutter for its curved outline.
        const enclosed = rectangle && top.contours?.length && top.fillRule === 'evenodd' &&
          whollyInsideRectangle(top, rectangle.box);
        if (crossingInk.length && !enclosed) {
          const cut = prepareSharedPaintStack([...nearby, ...crossingInk], top, matching ? 'union' : 'paint',
            { removeCoveredInk: true });
          if (cut) {
            const artwork = [...stationary.flatMap(s => cut.background.get(s) ?? [s]), cut.foreground];
            return { artwork: matching ? joinRecoloredFills(artwork, [top.id]) : artwork, preservedDestination: false };
          }
        }
        const pair = rectangle && !enclosed && prepareSharedRectangleCut(lower, top, rectangle.box);
        const cut = pair ? { foreground: pair.foreground, background: new Map([[lower, pair.background]]) } :
          !enclosed && prepareSharedPaintStack(nearby, top, matching ? 'union' : 'paint');
        if (cut) {
          const owned = new Set(nearby.map(s => s.id));
          const rest = resolvePaintDrop(shapes, [top.id], eligible.filter(id => !owned.has(id)), false);
          const artwork = rest.artwork.flatMap(s => cut.background.get(s) ?? [s === top ? cut.foreground : s]);
          return { ...rest, artwork: matching ? joinOverlayFills(artwork, top) : artwork };
        }
        // A single Oval span can hit both rectangles at almost the same
        // parameter. Removing their interior overlap first keeps both original
        // exterior sides. These are all the owners in the affected stack.
        if (top.kind === 'ellipse' && !top.contours && stationary.length === 2 && nearby.length === 2 &&
            nearby.every(s => canJoinOverlayFills(s, top))) {
          const outline = overlappingRectangleOutline(nearby[0], nearby[1]);
          if (outline) {
            const joined = prepareSharedPaintStack([outline], top, 'union');
            if (joined?.background.get(outline)?.length === 0)
              return { artwork: [joined.foreground], preservedDestination: false };
          }
        }
      } catch (cause) {
        if (!(cause instanceof UnresolvedPaintContour)) throw cause;
      }
    }
    if (curved) {
      const matching = nearby.some(s => canJoinOverlayFills(s, top));
      const cutOwners = () => {
        if (!nearby.length) return;
        const cuts = prepareIndependentPaintCuts([...nearby, ...crossingInk], top, !!brush?.removeCoveredInk, mergeControlBounds);
        if (!cuts?.size) return;
        const artwork = [...stationary.flatMap(shape => cuts.get(shape) ?? [shape]), top];
        const cutFills = matching ? nearby.flatMap(shape => canJoinOverlayFills(shape, top) ? cuts.get(shape) ?? [] : []) : [];
        return { artwork: matching ? joinOverlayFills(artwork, top, cutFills) : artwork, preservedDestination: false };
      };
      if (!matching) {
        const cut = cutOwners();
        if (cut) return cut;
      }
      try {
        const fallback = resolvePaintDrop(shapes, [top.id], eligible, true, top);
        checkPaintEdgeProvenance(shapes, fallback.artwork);
        if (!fallback.preservedDestination || !matching) return fallback;
      } catch (cause) {
        if (!matching || !(cause instanceof PaintCurveLossError)) throw cause;
        const cut = cutOwners();
        if (cut) return cut;
        throw cause;
      }
      // Distinct crossings can be too close to store on one split foreground
      // outline. Cut each destination in place, then join only proven seams.
      return cutOwners();
    }
  });
  if (!result || result.preservedDestination) return;
  const artwork = result.artwork;
  const firstInk = artwork.findIndex(shape => retainedInk.has(shape));
  if (firstInk >= 0 && !('positioned' in result)) {
    // The fresh fill only occupies the cut-out area. Insert it under retained
    // outlines without moving any of the earlier artwork relative to each other.
    const index = artwork.findIndex(shape => shape.id === top.id);
    const [foreground] = artwork.splice(index, 1);
    artwork.splice(firstInk, 0, foreground);
  }
  return artwork.map(shape => shape === top && shape.drawingMode !== 'merge' ? { ...shape, drawingMode: 'merge' } : shape);
}
function resolvePaintDrop(shapes: Vector[], moved: string[], eligible: string[], joinFills: boolean, authoredCutter?: Vector): PaintDrop {
  let preservedDestination=false;
  const ids = new Set(moved), allowed = new Set(eligible);
  const moving = shapes.filter(s => ids.has(s.id));
  if (!ids.size || moving.length !== ids.size || moved.length !== ids.size)
    throw Error('The original moved artwork changed.');
  const stationary = shapes.filter(s => !ids.has(s.id));
  const fills = moving.filter(s => s.kind !== 'symbol' && s.drawingMode !== 'object' && hasVectorFill(s));
  if (!fills.length) return { artwork:[...stationary, ...moving], preservedDestination };
  const targets = stationary.filter(s => allowed.has(s.id) && s.kind !== 'symbol' &&
    s.kind !== 'text' && s.drawingMode !== 'object');
  if (!targets.length) return { artwork:[...stationary, ...moving], preservedDestination };
  const fillBounds = fills.map(mergeControlBounds);

  // Build each relevant cutter once. Most drops need only one combined subtraction.
  const targetBounds = targets.map(mergeControlBounds);
  const targetIndex = boundsIndex(targetBounds);
  const curvedCutters = new Set<Vector>();
  const masks = fills.map((fill, i) => {
    if (!targetIndex(fillBounds[i], 2 * PAINT_GRID_STEP).length) return [];
    try {
      return overlayPolygons(fill, curvedCutters);
    } catch (error) {
      if (!(error instanceof UnresolvedPaintContour)) throw error;
      preservedDestination = true;
      return [];
    }
  });
  const parts = masks.filter(mask => mask.length);
  function subtract(sources: Vector[], eligibleIds: string[], region: PaintRegion, cutters = curvedCutters,
    enclosedCutter?: Vector) {
    return clipArtwork(sources, { region, eligible: eligibleIds, keep: 'outside',
      preserveStrokes: true, preserveOutsideStroke: true, preserveOutsideFillCurves: true },
      undefined, undefined, cutters, enclosedCutter);
  }
  if(!parts.length)return {artwork:[...stationary,...moving],preservedDestination};
  try {
    const region=parts.length===1?parts[0]:clipping.union(parts.flat());
    const incoming = moving[0];
    if (joinFills && !preservedDestination && moving.length === 1 && fills[0] === incoming) {
      const matches = targetIndex(fillBounds[0], 2 * PAINT_GRID_STEP)
        .filter(index => canJoinOverlayFills(targets[index], incoming)).map(index => targets[index]);
      const joined = new Set(matches);
      const editable = new Set(targets);
      const owner = dropUnionOwner(stationary,matches,editable,incoming,fillBounds[0]);
      if (owner) {
        const traceSources = new Set(curvedCutters);
        const polygons = clipping.union([...region, ...matches.flatMap(shape => overlayPolygons(shape, traceSources))]);
        if (polygons.length === 1) {
          const [outline] = polygonVectors(owner, polygons, true);
          const [unified] = restorePaintCurves([outline], [...matches, incoming], undefined,
            shape => traceSources.has(shape) ? OVERLAY_CURVE_TOLERANCE : 0.25);
          const remaining = subtract(stationary, targets.filter(shape => !joined.has(shape)).map(s => s.id), region);
          return { artwork: remaining.flatMap(shape => shape === owner ? [unified] : joined.has(shape) ? [] : [shape]),
            preservedDestination, absorbedFill: { moving: incoming.id, into: owner.id } };
        }
      }
    }
    const remaining = subtract(stationary, targets.map(s=>s.id), region, curvedCutters, authoredCutter);
    return {artwork:[...remaining,...moving],preservedDestination};
  } catch(error){
    if(!(error instanceof UnresolvedPaintContour))throw error;
  }
  const query=boundsIndex(fillBounds);
  const editable = new Set(targets);
  const remaining = stationary.flatMap(source => {
    if (!editable.has(source)) return [source];
    const indices = query(mergeControlBounds(source), 2 * PAINT_GRID_STEP);
    const cutters = indices.map(index => masks[index]).filter(mask => mask.length);
    if (!cutters.length) return [source];
    try {
      return subtract([source], [source.id], cutters.length === 1 ? cutters[0] : clipping.union(cutters.flat()));
    } catch (error) {
      if (!(error instanceof UnresolvedPaintContour)) throw error;
    }
    if (cutters.length > 1) {
      // Retry separate fills only on the exceptional path. Keep each piece when
      // its own subtraction is uncertain, while applying the certified cuts.
      let pieces = [source];
      for (const index of indices.filter(index => masks[index].length)) pieces = pieces.flatMap(piece => {
        const cutter = masks[index], source = fills[index];
        try { return subtract([piece], [piece.id], cutter, curvedCutters.has(source) ? new Set([source]) : new Set()); }
        catch (error) {
          if (!(error instanceof UnresolvedPaintContour)) throw error;
          preservedDestination=true;
          return [piece];
        }
      });
      return pieces;
    }
    // A failed difference cannot prove that any of this destination disappeared.
    // Preserve it under the drop, and still cut the other destination objects.
    preservedDestination=true;
    return [source];
  });
  return {artwork:[...remaining,...moving],preservedDestination};
}
