import type { VectorEraseRequest, VectorEraseResult } from '../../../packages/geometry/src/erase';
import type { BrushCommit, BrushPreparation, BrushRootReference } from '../../../packages/geometry/src/brush-commit';
import type { BitmapTracePaint, BitmapTraceRaster } from '../../../packages/geometry/src/bitmap-trace';
import type { preparePencilDrawing, PencilWorkerReply } from '../../../packages/geometry/src/pencil-drawing';
import { validateDetachedLiveGraphicData } from '../../../packages/document/src/live-motion';
import type { prepareShapeDrawing, ShapeDrawing } from '../../../packages/geometry/src/shape-drawing';
import { canMergeDroppedStroke, type StrokeDropMerge } from '../../../packages/geometry/src/stroke-drop';
import { mergeControlBounds } from '../../../packages/geometry/src/merge';
import { boundsIndex } from '../../../packages/geometry/src/bounds-index';
import type { InkPaintReplacement } from '../../../packages/geometry/src/ink-paint-cut';
import {
  snapshotSymbolSimplifyRequest,
  admitSymbolSimplifyResult,
  type SymbolSimplifyRequest,
  type SymbolSimplifyResult,
} from '../../../packages/geometry/src/symbol-simplify-request';
import { assertSymbolSimplifyDetached } from '../../../packages/geometry/src/symbol-simplify-owner';
import { selectionTrajectoryStamp as symbolSimplifyStamp } from '../../../packages/animation/src/selection-trajectory';
/** Background preparation only; caller retains live draft/enclosing publication. */
export async function simplifySymbolArtworkInWorker(
  request: SymbolSimplifyRequest,
  signal?: AbortSignal,
): Promise<SymbolSimplifyResult> {
  if (signal?.aborted) throw new DOMException('Geometry operation cancelled.', 'AbortError');
  const input = snapshotSymbolSimplifyRequest(request);
  const expected = symbolSimplifyStamp(input),
    payload = structuredClone(input);
  assertSymbolSimplifyDetached(input, payload);
  if (symbolSimplifyStamp(input) !== expected || symbolSimplifyStamp(payload) !== expected)
    throw Error('Symbol worker request changed after cloning.');
  const result = await geometryRequest<SymbolSimplifyResult>(
    { id: 1, shapes: [], symbolSimplify: payload },
    signal,
  );
  if (signal?.aborted) throw new DOMException('Geometry operation cancelled.', 'AbortError');
  if (symbolSimplifyStamp(input) !== expected) throw Error('Symbol worker request changed.');
  return admitSymbolSimplifyResult(input, result);
}
import type { prepareContourFits } from '../../../packages/geometry/src/contour-fit';
import type { PaintRegion, RegionOperation } from '../../../packages/geometry/src/paint-region';
import { canJoinOverlayFills, type PaintDrop, type PaintClip, type deletePaintRegion, type prepareEditorPaintSelection } from '../../../packages/geometry/src/clip-paint';
import type { Vector, Point } from '../../../packages/document/src';
import type { BrushPaintMode } from '../../../packages/geometry/src/brush-paint';
import type {
  SmoothSelection,
  prepareSmoothSelection,
} from '../../../packages/geometry/src/smooth-selection';
export function smoothSelectionInWorker(shapes: Vector[], request: SmoothSelection, signal?: AbortSignal) {
  return geometryRequest<ReturnType<typeof prepareSmoothSelection>>({
    id: 1,
    shapes,
    smoothSelection: request,
  }, signal);
}

export function traceBitmapInWorker(raster: BitmapTraceRaster, signal: AbortSignal) {
  return geometryRequest<BitmapTracePaint[]>({ id: 1, bitmapTrace: raster }, signal);
}
// Vite resolves the worker entry separately from the editor bundle. Callers
// still own the source artwork and decide whether a reply is current enough to apply.
function createGeometryWorker() {
  return new Worker(
    new URL('../../../packages/geometry/src/worker.ts', import.meta.url),
    { type: 'module' },
  );
}

/** Each editor may initialize one idle worker during capture, before sending any artwork. */
export function createDrawingWorkerPreparation() {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function take() {
    clearTimeout(timer);
    timer = undefined;
    const ready = worker;
    worker = undefined;
    if (ready) ready.onerror = null;
    return ready;
  }
  function cancel() {
    take()?.terminate();
  }
  function start() {
    if (timer !== undefined || worker) return;
    // Give the initial mark a chance to paint before starting background work.
    timer = setTimeout(() => {
      timer = undefined;
      try {
        worker = createGeometryWorker();
      } catch {
        // Ordinary release still gets its own attempt and reports any failure.
        return;
      }
      worker.onerror = cancel;
      timer = setTimeout(cancel, 15000);
    }, 0);
  }
  return { start, take, cancel };
}

/** One transaction per worker: failure/timeout cannot leave a partially modified document. */
export async function brushInWorker(
  shapes: Vector[],
  brushCommit: BrushCommit,
  preparedWorker?: Worker,
  brushDisplayPadding?: number,
  retainRoots = false,
): Promise<BrushPreparation> {
  const response = await geometryRequest<Omit<BrushPreparation, 'shapes' | 'unchangedRoots'> & {
    shapes: (Vector | number)[];
  }>({ id: 1, shapes, brushCommit, brushDisplayPadding,
    ...(retainRoots ? { brushRetainRoots: true } : {}) }, undefined, preparedWorker);
  if (!Array.isArray(response?.shapes)) throw Error('Geometry worker returned invalid Brush artwork.');
  const { shapes: slots, retainedOverlap, damage } = response;
  if (!slots.some(shape => typeof shape === 'number'))
    return { shapes: slots as Vector[], retainedOverlap, damage };
  if (!retainRoots || retainedOverlap) throw Error('Geometry worker returned unexpected Brush references.');
  const unchangedRoots: BrushRootReference[] = [], ids = new Set<string>();
  let previous = -1;
  const rebuilt = Array.from(slots, (slot, output) => {
    let shape: Vector;
    if (typeof slot === 'number') {
      if (!Number.isSafeInteger(slot) || slot <= previous || slot >= shapes.length)
        throw Error('Geometry worker returned invalid Brush references.');
      previous = slot;
      unchangedRoots.push({ input: slot, output });
      shape = shapes[slot];
    } else shape = slot;
    if (typeof shape?.id !== 'string' || ids.has(shape.id))
      throw Error('Geometry worker returned invalid Brush artwork.');
    ids.add(shape.id);
    return shape;
  });
  return { shapes: rebuilt, damage, unchangedRoots };
}
export async function pencilInWorker(
  shapes: Vector[],
  stroke: Vector,
  mode: 'ink' | 'smooth' | 'straight',
  merge: boolean,
  smoothing?: number,
  optimize?: boolean,
  symbol?: boolean,
  preparedWorker?: Worker,
): Promise<ReturnType<typeof preparePencilDrawing>> {
  const expectedId = stroke.id;
  const result = await geometryRequest<PencilWorkerReply>({
    id: 1,
    shapes,
    pencil: {
      stroke,
      mode,
      merge,
      ...(smoothing === undefined ? {} : { smoothing }),
      ...(optimize === undefined ? {} : { optimize }),
      ...(symbol === undefined ? {} : { symbol }),
    },
  }, undefined, preparedWorker);
  if (result?.shape?.id !== expectedId) throw Error('Geometry worker returned invalid Pencil artwork.');
  if (result.retainedOverlap === true) {
    const shape = result.shape;
    if (!merge || 'shapes' in result || shape.closed || shape.contours ||
        (shape.kind !== 'path' && shape.kind !== 'bezier') ||
        !Array.isArray(shape.points) ||
        (shape.kind === 'path' ? shape.points.length < 2 : !Array.isArray(shape.nodes) || shape.nodes.length < 2) ||
        shape.drawingMode !== 'merge' || shape.fillEnabled !== false ||
        !Number.isFinite(shape.width) || !Number.isFinite(shape.height) ||
        shape.width < 0 || shape.height < 0 || shape.width + shape.height <= 2 ||
        shapes.some(root => root.id === expectedId))
      throw Error('Geometry worker returned invalid Pencil recovery artwork.');
    validateDetachedLiveGraphicData(shape);
    return { shape, shapes: [...shapes, shape], retainedOverlap: true };
  }
  if ('retainedOverlap' in result || !Array.isArray(result.shapes))
    throw Error('Geometry worker returned invalid Pencil artwork.');
  return result;
}
export async function mergeSelectedArtworkInWorker(
  shapes: Vector[],
  selected: string[],
  preserveStrokeCurves: boolean,
  signal?: AbortSignal,
  movedArtwork?: string[],
  dropEligible?: string[],
): Promise<
  ReturnType<typeof import('../../../packages/geometry/src/merge-selection').mergeSelectedArtwork> & {preservedDestination?:boolean}
> {
  const result = await geometryRequest<
    ReturnType<typeof import('../../../packages/geometry/src/merge-selection').mergeSelectedArtwork> & {preservedDestination?:boolean}
  >({ id: 1, shapes, selectedArtwork: selected, preserveStrokeCurves,
    ...(dropEligible ? {dropEligible} : {}),
    ...(movedArtwork === undefined ? {} : { movedArtwork }) }, signal);
  if (!result || !Array.isArray(result.artwork) || !Array.isArray(result.selected))
    throw Error('Geometry worker returned an invalid selection.');
  const outputIds = new Set(result.artwork.map((s) => s.id));
  if (
    new Set(result.selected).size !== result.selected.length ||
    result.selected.some((id) => typeof id !== 'string' || !outputIds.has(id))
  )
    throw Error('Geometry worker returned an invalid selection.');
  return result;
}
/** Empty selection is the deletion path: rebuild remaining paint without picks. */
export async function rebuildCurrentLayerInWorker(
  shapes: Vector[],
  selected: string[],
  preserveStrokeCurves: boolean,
  signal?: AbortSignal,
): Promise<{ artwork: Vector[]; selected: string[] }> {
  if (selected.length)
    return mergeSelectedArtworkInWorker(shapes, selected, preserveStrokeCurves, signal);
  const artwork = await geometryRequest<Vector[]>({ id: 1, shapes, preserveStrokeCurves }, signal);
  if (!Array.isArray(artwork)) throw Error('Geometry worker returned invalid layer artwork.');
  return { artwork, selected: [] };
}
type EditedPaintPieces = { artwork: Vector[]; clearMargin: boolean; preservedDestination?: boolean;
  absorbedFill?: PaintDrop['absorbedFill']; absorbedFills?: PaintDrop['absorbedFills'];
  strokeReplacements?: Map<string,string[]>; fillReplacements?: Map<string,string[]> };

async function healVacatedInk(shapes: Vector[], original: Vector[], moved: Set<string>, dropEligible: string[]) {
  const eligible = new Set(dropEligible), inputs = new Map(shapes.map(shape => [shape.id,shape]));
  const fills = shapes.filter(shape => !moved.has(shape.id) && eligible.has(shape.id) && canJoinOverlayFills(shape,shape));
  if (fills.length < 2) return shapes;
  const nearby = boundsIndex(fills.map(mergeControlBounds));
  const vacated = original.filter(shape => moved.has(shape.id) && inputs.has(shape.id) &&
    JSON.stringify(shape) !== JSON.stringify(inputs.get(shape.id)) && nearby(mergeControlBounds(shape)).length >= 2);
  if (!vacated.length) return shapes;
  const packet = await geometryRequest<{artwork:(Vector|number)[];absorbed:[string,string][]} | null>({
    id:1, shapes, vacatedInk:{original:vacated,eligible:fills.map(shape=>shape.id)},
  });
  if (packet === null) return shapes;
  const invalid = 'Geometry worker returned invalid divider healing.';
  const fillIds = new Set(fills.map(shape=>shape.id));
  if (!Array.isArray(packet?.artwork) || !Array.isArray(packet?.absorbed) || !packet.absorbed.length ||
      packet.artwork.length + packet.absorbed.length !== shapes.length) throw Error(invalid);
  let previous = -1;
  const seen = new Set<string>(), changed = new Map<string,Vector>();
  const artwork = packet.artwork.map(slot => {
    const reference = typeof slot === 'number';
    if (reference && (!Number.isSafeInteger(slot) || slot <= previous || slot >= shapes.length)) throw Error(invalid);
    if (reference) previous = slot;
    const shape = reference ? shapes[slot] : slot;
    if (!shape || seen.has(shape.id)) throw Error(invalid);
    if (!reference) {
      const original = inputs.get(shape.id);
      if (!original || !fillIds.has(shape.id) || !canJoinOverlayFills(shape,original)) throw Error(invalid);
      changed.set(shape.id,shape);
    }
    seen.add(shape.id);
    return shape;
  });
  const removed = new Set<string>(), survivors = new Set<string>();
  for (const pair of packet.absorbed) {
    if (!Array.isArray(pair) || pair.length !== 2) throw Error(invalid);
    const [from, into] = pair, source = inputs.get(from), survivor = changed.get(into);
    if (!source || !fillIds.has(from) || seen.has(from) || removed.has(from) || !survivor ||
        !canJoinOverlayFills(source,survivor)) throw Error(invalid);
    removed.add(from);
    survivors.add(into);
  }
  if (survivors.size !== changed.size) throw Error(invalid);
  return artwork;
}

function matchesInkCutOwner(owner: Vector, piece: Vector) {
  return piece.drawingMode === 'merge' && (canMergeDroppedStroke(owner) ?
    canMergeDroppedStroke(piece) && piece.fillEnabled === false && piece.stroke === owner.stroke &&
      piece.strokeWidth === owner.strokeWidth :
    piece.kind === 'polygon' && !!piece.contours?.length && !piece.strokeWidth &&
      piece.fillEnabled !== false && piece.fill === owner.fill);
}

export async function mergeEditedPiecesInWorker(
  shapes: Vector[], editedPieces: string[], destinationMask?: PaintRegion, dropEligible?: string[],
  policy?: {strokeEdit?:boolean; keepFillIds?:boolean; cutEditedInk?:boolean; cutPlacedInk?:boolean; vacatedInk?:Vector[];
    planar?: boolean},
): Promise<EditedPaintPieces> {
  const moved = new Set(editedPieces);
  if (policy?.planar && dropEligible && !policy.keepFillIds && editedPieces.length) {
    const planar = await planarDropInWorker(shapes, editedPieces, dropEligible, policy?.vacatedInk);
    if (planar) return planar;
  }
  const unhealed = shapes;
  if (dropEligible && policy?.vacatedInk?.length && !policy.keepFillIds)
    shapes = await healVacatedInk(shapes, policy.vacatedInk, moved, dropEligible);
  const healed = shapes !== unhealed;
  let base = await prepareEditedPiecesInWorker(shapes,editedPieces,destinationMask,dropEligible,policy,healed || !!policy?.cutPlacedInk);
  const cutPlacedInk = (policy?.cutPlacedInk || healed) && moved.size > 1 && !policy?.keepFillIds;
  const cutEditedInk = policy?.cutEditedInk && !policy.keepFillIds;
  if ((!base.absorbedFills?.length && !cutEditedInk && !cutPlacedInk) || !dropEligible) return base;
  const inkIds = new Set(shapes.filter(s=>moved.has(s.id) && canMergeDroppedStroke(s))
    .flatMap(s=>base.strokeReplacements?.get(s.id) ?? [s.id]));
  if (!inkIds.size) return base;
  const fillIds = new Set(base.absorbedFills?.map(pair=>pair.into));
  const stationaryInk = new Set<string>();
  if (cutPlacedInk) {
    const allowed = new Set([...dropEligible,...editedPieces]);
    const originals = new Set(shapes.map(shape=>shape.id));
    const placedInk = base.artwork.flatMap((shape,index) => inkIds.has(shape.id) ? [{ index, bounds:mergeControlBounds(shape) }] : []);
    const inkAt = boundsIndex(placedInk.map(entry=>entry.bounds));
    for (const [index,shape] of base.artwork.entries()) {
      // An earlier paint cut can replace an admitted destination with fresh
      // pieces. Preserve protected original slots and divide the new faces too.
      if (!allowed.has(shape.id) && originals.has(shape.id)) continue;
      // A carried fill can still need a cut by another member of the drop.
      // Only ink above it in the settled stack can divide that fill.
      if (canJoinOverlayFills(shape,shape) && (!moved.has(shape.id) ||
        inkAt(mergeControlBounds(shape)).some(i=>placedInk[i].index>index))) fillIds.add(shape.id);
      if (!inkIds.has(shape.id) && canMergeDroppedStroke(shape)) stationaryInk.add(shape.id);
    }
  }
  if (cutEditedInk) {
    const eligible = new Set(dropEligible);
    for (const shape of base.artwork) {
      // Edited fills have already followed their captured seams. The final ink
      // still needs to cut stationary paint even when the first pass joined none.
      if (!moved.has(shape.id) && eligible.has(shape.id) && canJoinOverlayFills(shape,shape)) fillIds.add(shape.id);
    }
    // A no-op paint pass may only lift the edited pieces above their original
    // neighbors. Keep their original slots when the ink pass makes a real cut.
    const original = new Set(shapes);
    if (base.artwork.length === shapes.length && base.artwork.every(shape => original.has(shape)))
      base = { ...base, artwork: shapes };
  }
  if (!fillIds.size) return base;
  const scope = base.artwork.filter(s=>fillIds.has(s.id) || inkIds.has(s.id) || stationaryInk.has(s.id));
  const packet = await geometryRequest<InkPaintReplacement[]>({id:1,shapes:scope,joinedPaintInk:[...inkIds],
    joinedPaintStackOrder:cutPlacedInk});
  const invalid = 'Geometry worker returned an invalid paint drop.';
  if (!Array.isArray(packet) || packet.length > scope.length) throw Error(invalid);
  if (!packet.length) return base;
  const seen = new Set([...shapes,...base.artwork].map(s=>s.id)), replacements = new Map<string,Vector[]>();
  for (const entry of packet) {
    const source = entry?.source, owner = scope[source];
    if (!Number.isSafeInteger(source) || !owner || replacements.has(owner.id) ||
        !Array.isArray(entry.pieces) || !entry.pieces.length) throw Error(invalid);
    for (const [i,piece] of entry.pieces.entries()) {
      if (!piece || typeof piece.id !== 'string' || (i ? seen.has(piece.id) : piece.id !== owner.id) ||
          !matchesInkCutOwner(owner,piece) || (fillIds.has(owner.id) && !canJoinOverlayFills(piece,owner)))
        throw Error(invalid);
      seen.add(piece.id);
    }
    replacements.set(owner.id,entry.pieces);
  }
  if (![...replacements.keys()].some(id=>fillIds.has(id)) ||
      ![...replacements.keys()].some(id=>inkIds.has(id))) throw Error(invalid);
  const strokeReplacements = new Map(base.strokeReplacements), fillReplacements = new Map<string,string[]>();
  for (const [id,pieces] of replacements) {
    const owners = fillIds.has(id) ? fillReplacements : strokeReplacements;
    owners.set(id,pieces.map(s=>s.id));
  }
  for (const [id,pieces] of base.strokeReplacements ?? []) {
    strokeReplacements.set(id,pieces.flatMap(p=>replacements.get(p)?.map(s=>s.id) ?? [p]));
  }
  return {...base,artwork:base.artwork.flatMap(s=>replacements.get(s.id) ?? [s]),strokeReplacements,fillReplacements};
}

/** Moved raw artwork cuts and joins the eligible raw artwork it lands on (and where it was) in
 * one planar map of exact curves. Each moved shape maps to the pieces it ends up on top of.
 * `undefined` when the planar merge declines; the caller then uses the older drop cutters. */
async function planarDropInWorker(shapes: Vector[], moved: string[], eligible: string[],
  vacated?: Vector[]): Promise<EditedPaintPieces | undefined> {
  const result = await geometryRequest<{ artwork: (Vector | number)[];
    replacements: [string, string[]][] } | null>({ id: 1, shapes, planarDrop: { moved, eligible, vacated } });
  if (result === null) return;
  const invalid = 'Geometry worker returned an invalid paint drop.';
  if (!result || !Array.isArray(result.artwork) || !Array.isArray(result.replacements)) throw Error(invalid);
  const movedIds = new Set(moved), allowed = new Set([...eligible, ...moved]);
  const seen = new Set<string>(), kept = new Set<number>();
  let previous = -1;
  const artwork = result.artwork.map(slot => {
    const reference = typeof slot === 'number';
    if (reference && (!Number.isSafeInteger(slot) || slot <= previous || slot >= shapes.length)) throw Error(invalid);
    if (reference) {
      previous = slot;
      kept.add(slot);
    }
    const shape = reference ? shapes[slot] : slot;
    if (typeof shape?.id !== 'string' || seen.has(shape.id)) throw Error(invalid);
    seen.add(shape.id);
    return shape;
  });
  // Only moved and eligible artwork may be rebuilt; everything else must come back as it was.
  if (shapes.some((shape, i) => !kept.has(i) && !allowed.has(shape.id))) throw Error(invalid);
  const strokeReplacements = new Map<string, string[]>();
  for (const entry of result.replacements) {
    if (!Array.isArray(entry) || !movedIds.has(entry[0]) || !Array.isArray(entry[1]) ||
        entry[1].some(id => !seen.has(id))) throw Error(invalid);
    strokeReplacements.set(entry[0], entry[1]);
  }
  validateDetachedLiveGraphicData(artwork);
  return { artwork, clearMargin: false, preservedDestination: false, strokeReplacements };
}

async function prepareEditedPiecesInWorker(
  shapes: Vector[], editedPieces: string[], destinationMask?: PaintRegion, dropEligible?: string[],
  { strokeEdit = false, keepFillIds = false }: { strokeEdit?: boolean; keepFillIds?: boolean } = {},
  includeStraightPaint = false,
): Promise<EditedPaintPieces> {
  const request = { id: 1, shapes, editedPieces, destinationMask, dropEligible,
    ...(strokeEdit ? { strokeEdit } : {}), ...(keepFillIds ? { keepFillIds } : {}),
    ...(includeStraightPaint ? { includeStraightPaint } : {}) };
  if (!dropEligible) return geometryRequest<EditedPaintPieces>(request);
  const result = await geometryRequest<Omit<EditedPaintPieces, 'artwork'> & {
    artwork: (Vector | number)[];
    strokeMerges?: StrokeDropMerge[];
    inkCuts?: InkPaintReplacement[];
  }>(request);
  const invalidDrop = 'Geometry worker returned an invalid paint drop.';
  const moved = new Set(editedPieces), moving = shapes.filter(shape => moved.has(shape.id));
  const allowed = new Set(dropEligible);
  const absorbed = result?.absorbedFill;
  const absorbedFills = result?.absorbedFills;
  if (absorbed !== undefined && moving.length !== 1) throw Error(invalidDrop);
  if (absorbedFills !== undefined && (absorbed !== undefined || moving.length < 2 ||
      !Array.isArray(absorbedFills) || !absorbedFills.length || absorbedFills.length > moving.length))
    throw Error(invalidDrop);
  const absorbedIds = new Set<string>(), destinations = new Map<string,Vector>();
  if (absorbed !== undefined || absorbedFills !== undefined) {
    if (strokeEdit || keepFillIds || result.preservedDestination) throw Error(invalidDrop);
    const sources = new Map(shapes.map(shape => [shape.id,shape]));
    for (const entry of absorbedFills ?? [absorbed!]) {
      const fill = sources.get(entry?.moving), target = sources.get(entry?.into);
      if (!fill || !target || !moved.has(fill.id) || absorbedIds.has(fill.id) || moved.has(target.id) ||
          !allowed.has(target.id) || !canJoinOverlayFills(fill,target)) throw Error(invalidDrop);
      absorbedIds.add(fill.id);
      destinations.set(target.id,target);
    }
  }
  const retainedMoving = moving.filter(shape => !absorbedIds.has(shape.id));
  if (!Array.isArray(result?.artwork) || typeof result.clearMargin !== 'boolean' ||
      typeof result.preservedDestination !== 'boolean' || !moving.length ||
      moving.length !== editedPieces.length || result.artwork.length < retainedMoving.length ||
      (strokeEdit && result.artwork.length !== shapes.length))
    throw Error(invalidDrop);
  const stationaryCount = result.artwork.length - retainedMoving.length;
  const seen = new Set<string>();
  let previous = -1;
  const artwork = Array.from(result.artwork, (slot, index) => {
    const reference = typeof slot === 'number';
    if (reference && (!Number.isSafeInteger(slot) || slot < 0 || slot >= shapes.length))
      throw Error(invalidDrop);
    const shape = reference ? shapes[slot] : slot;
    if (typeof shape?.id !== 'string' || seen.has(shape.id)) throw Error(invalidDrop);
    seen.add(shape.id);
    if (strokeEdit) {
      if (slot !== index) throw Error(invalidDrop);
    } else if (index >= stationaryCount) {
      if (!reference || shape !== retainedMoving[index - stationaryCount]) throw Error(invalidDrop);
    } else {
      if (moved.has(shape.id) || (reference && slot <= previous)) throw Error(invalidDrop);
      if (reference) previous = slot;
    }
    const target = destinations.get(shape.id);
    if (target) {
      if (reference || shape === target || !canJoinOverlayFills(shape,target)) throw Error(invalidDrop);
      destinations.delete(shape.id);
    }
    return shape;
  });
  if (destinations.size) throw Error(invalidDrop);
  const merges = result.strokeMerges === undefined ? [] : result.strokeMerges;
  if (!Array.isArray(merges)) throw Error(invalidDrop);
  const metadata = { clearMargin: result.clearMargin, preservedDestination: result.preservedDestination, absorbedFill: absorbed,
    ...(absorbedFills && { absorbedFills }) };
  if (result.inkCuts !== undefined) {
    if (!Array.isArray(result.inkCuts) || merges.length || absorbedIds.size || result.preservedDestination || keepFillIds ||
        moving.length !== 1 || !canMergeDroppedStroke(moving[0]) || artwork.length !== shapes.length ||
        result.artwork.some(slot => typeof slot !== 'number')) throw Error(invalidDrop);
    const replacements = new Map<Vector, Vector[]>(), used = new Set(seen);
    for (const { source, pieces } of result.inkCuts) {
      const owner = shapes[source];
      if (!Number.isSafeInteger(source) || !owner || (owner !== moving[0] && !allowed.has(owner.id)) ||
          replacements.has(owner) || !Array.isArray(pieces) || !pieces.length) throw Error(invalidDrop);
      for (const [index, piece] of pieces.entries()) {
        if (!piece || typeof piece.id !== 'string' ||
            (owner === moving[0] && index === 0 ? piece.id !== owner.id : used.has(piece.id)) ||
            !matchesInkCutOwner(owner,piece))
          throw Error(invalidDrop);
        used.add(piece.id);
      }
      replacements.set(owner, pieces);
    }
    const selected = replacements.get(moving[0]);
    const splitsPaint = [...replacements.keys()].some(s => !canMergeDroppedStroke(s));
    if (!selected || replacements.size < 2 || (!splitsPaint && (!strokeEdit ||
      ![...replacements.values()].some(pieces => pieces.length > 1)))) throw Error(invalidDrop);
    return { ...metadata, artwork: artwork.flatMap(s => replacements.get(s) ?? [s]),
      strokeReplacements: new Map([[moving[0].id, selected.map(s => s.id)]]) };
  }
  if (!merges.length) return { ...metadata, artwork };
  const replacements = new Map<number, Vector[]>();
  const strokeReplacements = new Map<string, string[]>();
  const outputIds = new Set([...seen, ...shapes.map(shape => shape.id)]);
  for (const merge of merges) {
    if (!Array.isArray(merge?.sources) || merge.sources.length < 2 ||
        !Array.isArray(merge.strokes) || !merge.strokes.length)
      throw Error(invalidDrop);
    let first = true, previous = -1, hasMoved = false, hasDestination = false;
    for (const index of merge.sources) {
      if (!Number.isSafeInteger(index) || index <= previous || index >= artwork.length ||
          replacements.has(index) || !canMergeDroppedStroke(artwork[index]))
        throw Error(invalidDrop);
      const id = artwork[index].id;
      if (moved.has(id)) hasMoved = true;
      else if (allowed.has(id)) hasDestination = true;
      else throw Error(invalidDrop);
      replacements.set(index, first ? merge.strokes : []);
      first = false;
      previous = index;
    }
    if (!hasMoved || !hasDestination) throw Error(invalidDrop);
    for (const stroke of merge.strokes) {
      if (typeof stroke?.id !== 'string' || outputIds.has(stroke.id) ||
          stroke.drawingMode !== 'merge' || !canMergeDroppedStroke(stroke))
        throw Error(invalidDrop);
      outputIds.add(stroke.id);
    }
    const ids = merge.strokes.map(stroke => stroke.id);
    for (const index of merge.sources) if (moved.has(artwork[index].id))
      strokeReplacements.set(artwork[index].id, ids);
  }
  return { ...metadata, artwork: artwork.flatMap((shape, index) => replacements.get(index) ?? [shape]), strokeReplacements };
}
export function mergeStrokeCurvesInWorker(shapes: Vector[]): Promise<Vector[]> {
  return geometryRequest({ id: 1, shapes, preserveStrokeCurves: true });
}
export async function connectedStrokesInWorker(
  shapes: Vector[],
  seed: string,
  point: Point,
  tolerance: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await geometryRequest<string[]>(
    { id: 1, shapes, strokeSelection: { seed, point, tolerance } },
    signal,
  );
  const ids = new Set(shapes.map((s) => s.id));
  if (
    !Array.isArray(result) ||
    result.some((id) => typeof id !== 'string' || !ids.has(id)) ||
    new Set(result).size !== result.length
  )
    throw Error('Geometry worker returned an invalid stroke selection.');
  return result;
}
export async function connectedPaintInWorker(
  shapes: Vector[],
  seed: string,
  signal: AbortSignal,
): Promise<string[]> {
  const result = await geometryRequest<Vector[]>({ id: 1, shapes, connected: seed }, signal);
  if (!Array.isArray(result)) throw Error('Geometry worker returned an invalid paint selection.');
  return Array.from(result, (shape) => {
    if (typeof shape?.id !== 'string') throw Error('Geometry worker returned an invalid paint selection.');
    return shape.id;
  });
}
export function mergeInWorker(shapes: Vector[], erase: VectorEraseRequest): Promise<VectorEraseResult>;
export function mergeInWorker(
  shapes: Vector[], erase?: undefined, convert?: string[],
  bucket?: { paint: Vector; point: Point; gap: number }, connected?: string,
  paint?: { brush: Vector; mode: BrushPaintMode; selected: string[] }, clip?: PaintClip,
): Promise<Vector[]>;
export function mergeInWorker(
  shapes: Vector[], erase?: VectorEraseRequest, convert?: string[],
  bucket?: { paint: Vector; point: Point; gap: number }, connected?: string,
  paint?: { brush: Vector; mode: BrushPaintMode; selected: string[] }, clip?: PaintClip,
): Promise<Vector[] | VectorEraseResult> {
  return geometryRequest<Vector[] | VectorEraseResult>({
    id: 1,
    shapes,
    erase,
    convert,
    bucket,
    connected,
    paint,
    clip,
  });
}
export function eraseObjectsInWorker(shapes: Vector[], trail: Point[], radius: number, eligible: string[]) {
  return geometryRequest<Vector[]>({ id: 1, shapes, eraseObjects: { trail, radius, eligible } });
}
export function shapeInWorker(shapes: Vector[], shapeDrawing: ShapeDrawing) {
  return geometryRequest<ReturnType<typeof prepareShapeDrawing>>({ id: 1, shapes, shapeDrawing });
}
export function regionInWorker(region: RegionOperation): Promise<PaintRegion> {
  return geometryRequest<PaintRegion>({ id: 1, shapes: [], region });
}
export function selectPaintRegionInWorker(
  shapes: Vector[],
  region: RegionOperation,
  eligible: string[],
  signal?: AbortSignal,
  regionPaintOmissions?: string[],
): Promise<ReturnType<typeof prepareEditorPaintSelection>> {
  return geometryRequest({ id: 1, shapes, region, regionPaint: eligible, regionPaintOmissions }, signal);
}
export function deletePaintRegionInWorker(shapes: Vector[], region: PaintRegion, eligible: string[], signal?: AbortSignal) {
  return geometryRequest<ReturnType<typeof deletePaintRegion>>({ id: 1, shapes, deleteRegion: { region, eligible } }, signal);
}
export async function splitPaintRegionInWorker(
  shapes: Vector[], region: PaintRegion, eligible: string[], preserveOutsideFillCurves: boolean,
  cutCandidates?: ReadonlySet<string>, signal?: AbortSignal,
) {
  const retained = new Set<number>();
  let input = shapes;
  let sourceSlots: { count: number; indices: number[] } | undefined;
  // Cut restores surviving curves against neighboring artwork as well.
  if (cutCandidates && !preserveOutsideFillCurves) {
    const allowed = new Set(eligible), indices: number[] = [];
    input = shapes.filter((shape, index) => {
      if (!allowed.has(shape.id) || !cutCandidates.has(shape.id)) {
        retained.add(index);
        return false;
      }
      indices.push(index);
      return true;
    });
    if (retained.size) {
      sourceSlots = { count: shapes.length, indices };
      eligible = input.map(shape => shape.id);
    }
  }
  const result = await geometryRequest<{ inside: Vector[]; outside: (Vector | number)[] }>({
    id: 1, shapes: input, splitPaintRegion: { region, eligible, preserveOutsideFillCurves, sourceSlots },
  }, signal);
  if (!Array.isArray(result?.inside) || !Array.isArray(result?.outside))
    throw Error('Geometry worker returned an invalid paint cut.');
  const ids = new Set<string>();
  const admit = (shape: Vector) => {
    if (typeof shape?.id !== 'string' || ids.has(shape.id))
      throw Error('Geometry worker returned an invalid paint cut.');
    ids.add(shape.id);
    return shape;
  };
  const inside = Array.from(result.inside, admit);
  let previous = -1;
  const outside = Array.from(result.outside, slot => {
    if (typeof slot !== 'number') return admit(slot);
    if (!Number.isSafeInteger(slot) || slot <= previous || slot >= shapes.length)
      throw Error('Geometry worker returned an invalid paint cut reference.');
    previous = slot;
    retained.delete(slot);
    return admit(shapes[slot]);
  });
  if (inside.length && retained.size)
    throw Error('Geometry worker returned an invalid paint cut reference.');
  return { inside, outside };
}
export function fitContoursInWorker(
  shapes: Vector[],
  selected: string[],
  tolerance = 0.25,
  signal?: AbortSignal,
): Promise<ReturnType<typeof prepareContourFits>> {
  return geometryRequest({ id: 1, shapes, fit: { selected, tolerance } }, signal);
}
function geometryRequest<T>(request: unknown, signal?: AbortSignal, preparedWorker?: Worker): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('Geometry operation cancelled.', 'AbortError');
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const worker = preparedWorker ?? createGeometryWorker();
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      return true;
    };
    const fail = (error: unknown) => {
      if (finish()) reject(error);
    };
    const cancel = () => fail(aborted());
    const timeout = setTimeout(() => {
      fail(new Error('Geometry operation timed out. Split the artwork across layers.'));
    }, 15000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ id?: number; result?: T; error?: string }>) => {
      if (event.data.id !== 1) return;
      if (!finish()) return;
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result === undefined)
        reject(new Error('Geometry worker returned no result.'));
      else resolve(event.data.result);
    };
    worker.onerror = () =>
      fail(new Error('Geometry worker failed; the original drawing is unchanged.'));
    worker.onmessageerror = () => fail(new Error('Geometry worker response could not be read.'));
    try {
      worker.postMessage(request);
    } catch (error) {
      fail(error);
    }
  });
}
