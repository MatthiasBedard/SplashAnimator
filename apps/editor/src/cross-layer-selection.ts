import {
  keyAt,
  validateProject,
  type Project,
  type Point,
  type Vector,
} from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { expandSelection } from '../../../packages/document/src/groups';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { multiFrameId } from '../../../packages/animation/src/multi-frame';
import { createLiveMotionSpanSampler } from '../../../packages/animation/src/live-motion';
import { compileMovieClockPlan } from '../../../packages/animation/src/movie-clock-plan';
import { refreshChangedBasicMotionSpans } from '../../../packages/animation/src/motion-spans';
import {
  lassoContains,
  lassoContainsBoundaries,
  combineSelection,
  type SelectionMode,
} from '../../../packages/geometry/src/lasso';
import { transformVectors, type Matrix } from '../../../packages/geometry/src/affine';
import { connectedMergeIndices, mergeControlBounds, mergeDrawingComponent } from '../../../packages/geometry/src/merge';
import { containsPoint, worldPaths } from '../../../packages/geometry/src/drawing';
import { evenOddPaint, intersectPaint, nonzeroPaint } from '../../../packages/geometry/src/paint-clipping';
import { regionContains, type PaintRegion } from '../../../packages/geometry/src/paint-region';

type MaskBounds = ReturnType<typeof mergeControlBounds>;
type ClipMask = { bounds: MaskBounds; region?: PaintRegion };
type MaskFootprint = Vector | PaintRegion | { kind: 'curve'; inner: Point[]; outer: Vector };
type MemberMask = ClipMask & { footprints?: Map<string, MaskFootprint | null> };

function containedByMask(shapes: Vector[], mask: MaskBounds) {
  return shapes.every(shape => {
    if (shape.kind === 'symbol' || shape.kind === 'text' || shape.kind === 'brush') return false;
    const { left, top, right, bottom } = mergeControlBounds(shape);
    return [left, top, right, bottom].every(Number.isFinite) &&
      left > mask.left && top > mask.top && right < mask.right && bottom < mask.bottom;
  });
}

function clippedRectangle(shape: Vector, mask: MaskBounds): Vector | undefined {
  if (
    shape.kind !== 'rectangle' || shape.rotation ||
    shape.cornerRadius || shape.contours || shape.fillEnabled === false || shape.gradient ||
    shape.bitmap || shape.strokeWidth || (shape.opacity ?? 1) !== 1 ||
    (shape.transform && (shape.transform[1] || shape.transform[2]))
  ) return;
  return clippedBox(shape, mask);
}

function clippedBox(shape: Vector, mask: MaskBounds): Vector | undefined {
  const bounds = mergeControlBounds(shape),
    x = Math.max(bounds.left, mask.left),
    y = Math.max(bounds.top, mask.top),
    width = Math.min(bounds.right, mask.right) - x,
    height = Math.min(bounds.bottom, mask.bottom) - y;
  if (!(width > 0 && height > 0)) return;
  return { ...shape, x, y, width, height, transform: undefined };
}

function insideMask(point: Point, mask: MaskBounds) {
  return point.x >= mask.left && point.x < mask.right &&
    point.y >= mask.top && point.y < mask.bottom;
}

function solidFill(shape: Vector) {
  return shape.fillEnabled !== false && !shape.gradient && !shape.bitmap &&
    !shape.strokeWidth && (shape.opacity ?? 1) === 1;
}

function straightPolygon(shape: Vector) {
  return shape.kind === 'polygon' &&
    !shape.contours?.some(ring => ring.some(node => node.in || node.out));
}

function worldPaint(shape: Vector) {
  const paths = worldPaths(shape);
  const rings = paths.map(ring => ring.map(({ x, y }): [number, number] => [x, y]));
  if (rings.some(ring => ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))))
    throw Error('Mask coordinates must be finite.');
  const paint = shape.fillRule === 'evenodd'
    ? evenOddPaint(rings.map(ring => [ring]))
    : nonzeroPaint(rings);
  return { paths, paint };
}

function clippedFootprint(shape: Vector, mask: ClipMask): MaskFootprint | undefined {
  const rectangle = shape.kind === 'rectangle' && !shape.cornerRadius && !shape.contours;
  if (rectangle && !mask.region) return clippedRectangle(shape, mask.bounds);
  const convexCurve = !mask.region && (shape.kind === 'ellipse' || shape.kind === 'rectangle');
  if (
    (!rectangle && !convexCurve && !straightPolygon(shape)) ||
    !solidFill(shape) ||
    ((rectangle || convexCurve) && (shape.contours || shape.width <= 0 || shape.height <= 0))
  ) return;
  const { left, top, right, bottom } = mask.bounds;
  try {
    const { paths, paint } = worldPaint(shape);
    const clip: PaintRegion | PaintRegion[number] =
      mask.region ?? [[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]];
    const footprint = intersectPaint(paint, clip);
    if (!footprint.length) return;
    if (!convexCurve) return footprint;
    // Chords lie inside these convex fills, even after an affine transform.
    // Independently check an interior witness before admitting movement.
    const inner = paths[0], outer = clippedBox(shape, mask.bounds), rim = footprint[0][0];
    const origin = rim[0];
    const mean = rim.reduce((p, [x, y]) => ({
      x: p.x + (x - origin[0]) / rim.length, y: p.y + (y - origin[1]) / rim.length,
    }), { x: origin[0], y: origin[1] });
    if (outer && mean.x > left && mean.x < right && mean.y > top && mean.y < bottom &&
        containsPoint(inner, mean))
      return { kind: 'curve', inner, outer };
  } catch {
    // An unresolved footprint cannot admit a pick or authorize an edit.
    return;
  }
}

function memberMask(
  project: Project,
  layer: Project['layers'][number],
  frame: number,
): MemberMask | undefined {
  if (layer.outline) return;
  const mask = project.layerMasks?.find(group => group.layerIds.includes(layer.id));
  const source = project.layers.find(track => track.id === mask?.maskLayerId);
  if (!source?.visible) return;
  const member = keyAt(layer, frame), clip = keyAt(source, frame);
  const exposureEnd = layer.keys.find(key => key.frame > member.frame)?.frame ?? project.duration;
  if (clip.frame > member.frame || source.keys.some(key => clip.frame < key.frame && key.frame < exposureEnd) ||
      source.liveMotionSpans?.length || source.motionSpans?.length ||
      project.opacityBindings?.some(binding => binding.layerId === source.id)) return;
  const [shape] = clip.shapes;
  if (clip.shapes.length !== 1 || !solidFill(shape)) return;
  const rectangle = shape.kind === 'rectangle' && !shape.rotation && !shape.transform &&
    !shape.cornerRadius && !shape.contours && shape.width > 0 && shape.height > 0;
  if (!rectangle && !straightPolygon(shape)) return;
  const bounds = mergeControlBounds(shape);
  if (rectangle && containedByMask(member.shapes, bounds)) return { bounds };
  if (layer.drawingMode === 'merge' && !rectangle) return;
  if (layer.liveMotionSpans?.length || layer.motionSpans?.length ||
      project.opacityBindings?.some(binding => binding.layerId === layer.id)) return;
  try {
    const region = rectangle ? undefined : worldPaint(shape).paint;
    if (region && !region.length) return;
    const mask = { bounds, region };
    const footprints = new Map<string, MaskFootprint | null>();
    const incompleteGroups = new Set<string>();
    for (const artwork of member.shapes) {
      const footprint = !region && containedByMask([artwork], bounds)
        ? null
        : clippedFootprint(artwork, mask);
      if (footprint !== undefined) footprints.set(artwork.id, footprint);
      else if (artwork.groups?.length) incompleteGroups.add(artwork.groups[0]);
    }
    for (const artwork of member.shapes)
      if (artwork.groups?.length && incompleteGroups.has(artwork.groups[0]))
        footprints.delete(artwork.id);
    if (footprints.size) return { ...mask, footprints };
  } catch {
    // Keep unresolved mask geometry on its active-layer editing path.
    return;
  }
}

export function crossLayerMaskTracks(project: Project): Set<string> {
  return new Set((project.layerMasks ?? []).flatMap(mask => [mask.maskLayerId, ...mask.layerIds]));
}

/** Current exposures retain their original layer/key namespace. No multi-frame
 * exposure/count cap is applied to ordinary current-frame selection. */
export function currentLayerKeys(project: Project, frame: number) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
    throw Error('Choose an original document frame.');
  const protectedTracks = crossLayerMaskTracks(project);
  return project.layers.flatMap((layer, order) => {
    if (!layer.visible || layer.locked) return [];
    const mask = protectedTracks.has(layer.id) ? memberMask(project, layer, frame) : undefined;
    if (protectedTracks.has(layer.id) && !mask) return [];
    const key = keyAt(layer, frame), footprints = mask?.footprints;
    const visibleKey = footprints
      ? { ...key, shapes: key.shapes.filter(shape => footprints.has(shape.id)) }
      : key;
    return [{ layer, order, key, keys: [visibleKey], mask }];
  });
}

export function currentLayerPointTracks(tracks: ReturnType<typeof currentLayerKeys>, point: Point) {
  return tracks.flatMap<(typeof tracks)[number] & { pointIds?: Set<string> }>(track => {
    const { mask } = track;
    if (!mask?.footprints) return [{ ...track, pointIds: undefined }];
    const pointIds = new Set<string>();
    for (const [id, footprint] of mask.footprints) {
      if (!footprint || (Array.isArray(footprint)
        ? regionContains(footprint, point)
        : footprint.kind === 'curve'
          ? insideMask(point, mask.bounds) && containsPoint(footprint.inner, point)
          : point.x >= footprint.x && point.x < footprint.x + footprint.width &&
            point.y >= footprint.y && point.y < footprint.y + footprint.height))
        pointIds.add(id);
    }
    return pointIds.size ? [{ ...track, pointIds }] : [];
  });
}
export function currentLayerMembers(project: Project, frame: number, selection: string[] | null) {
  const known = new Set<string>(),
    requested = new Set(selection ?? []),
    members: Vector[] = [];
  for (const {
    layer,
    keys: [key],
  } of currentLayerKeys(project, frame)) {
    for (const s of key.shapes) known.add(multiFrameId(layer.id, key.frame, s.id));
    const chosen = key.shapes
        .filter((s) => selection === null || requested.has(multiFrameId(layer.id, key.frame, s.id)))
        .map((s) => s.id),
      ids = new Set(expandSelection(key.shapes, chosen, []));
    members.push(...key.shapes.filter((s) => ids.has(s.id)));
  }
  if (
    selection &&
    (new Set(selection).size !== selection.length || selection.some((id) => !known.has(id)))
  )
    throw Error('Original cross-layer selection changed. Pick artwork again.');
  return members;
}
export function selectCurrentLayers(
  project: Project,
  frame: number,
  ring: Point[],
  previous: string[] | null,
  mode: SelectionMode,
) {
  if (ring.length > 1024 || ring.some((p) => ![p.x, p.y].every(Number.isFinite)))
    throw Error('Selection requires at most 1,024 finite points.');
  currentLayerMembers(project, frame, previous);
  const all: string[] = [],
    hits: string[] = [];
  for (const {
    layer,
    keys: [key],
    mask,
  } of currentLayerKeys(project, frame)) {
    all.push(...key.shapes.map((s) => multiFrameId(layer.id, key.frame, s.id)));
    const picked = key.shapes.filter(shape => {
      const footprint = mask?.footprints?.get(shape.id);
      if (Array.isArray(footprint)) {
        const boundaries = footprint.flatMap(polygon =>
          polygon.map(contour => contour.map(([x, y]) => ({ x, y }))));
        return lassoContainsBoundaries(boundaries, ring);
      }
      return lassoContains(footprint?.kind === 'curve' ? footprint.outer : footprint ?? shape, ring);
    });
    hits.push(
      ...expandSelection(key.shapes, picked.map(s => s.id), [])
        .map((id) => multiFrameId(layer.id, key.frame, id)),
    );
  }
  return combineSelection(previous ?? all, hits, mode);
}
export type CrossLayerChange =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'transform'; matrix: Matrix }
  | { kind: 'delete' };
/** Render-only proposals replace original layer/key paths immutably, including
 * aliased original key/shape storage. Proposed scenes never supply pick identity. */
export function previewCurrentLayerChange(
  project: Project,
  frame: number,
  selection: string[],
  request: CrossLayerChange,
  copyVector: (shape: Vector) => Vector = (shape) => structuredClone(shape),
  allowMerge = false,
  foregroundMove = false,
) {
  currentLayerMembers(project, frame, selection);
  const requested = new Set(selection);
  const targets = new Map(
    currentLayerKeys(project, frame).map(({ layer, key: originalKey, keys: [key], mask }) => {
      const ids = new Set(
        expandSelection(
          key.shapes,
          key.shapes
            .filter((s) => requested.has(multiFrameId(layer.id, key.frame, s.id)))
            .map((s) => s.id),
          [],
        ),
      );
      if (ids.size) {
        if (mask && request.kind === 'delete' &&
            project.opacityBindings?.some(binding => binding.layerId === layer.id))
          throw Error('Delete masked opacity-bound artwork from its active layer.');
        if (layer.drawingMode === 'merge' && !allowMerge)
          throw Error(
            'Move merged paint on its active layer. Moving it across layers is not available yet.',
          );
        const live = layer.liveMotionSpans?.filter(span => span.start <= key.frame && key.frame <= span.end);
        const baked = layer.motionSpans?.filter(span => span.start <= key.frame && key.frame <= span.end);
        const endpointBlocked = request.kind === 'delete' ||
          (request.kind === 'move' && !request.x && !request.y) ||
          frame !== key.frame || !!mask || layer.drawingMode === 'merge';
        if (
          baked?.some(span => endpointBlocked || (frame !== span.start && frame !== span.end)) ||
          (live?.length && (endpointBlocked || live.some(span =>
            (span.symbolContinuity === 'movie-trees' || span.symbolContinuity === 'movies') &&
            request.kind !== 'move')))
        )
          throw Error('Selected artwork belongs to a tween. Edit it from its keyframe controls.');
      }
      return [layer.id, { key: originalKey, ids, mask }] as const;
    }),
  );
  const moved: Vector[] = [];
  const layers = project.layers.map((layer) => {
    const target = targets.get(layer.id);
    if (!target?.ids.size) return layer;
    return {
      ...layer,
      keys: layer.keys.map((key) =>
        key !== target.key
          ? key
          : {
              ...key,
              shapes: key.shapes.flatMap((s) => {
                if (!target.ids.has(s.id)) return [s];
                if (request.kind === 'delete') return [];
                const copy = copyVector(s);
                moved.push(copy);
                return [copy];
              }),
            },
      ),
    };
  });
  if (request.kind === 'move') {
    if (![request.x, request.y].every(Number.isFinite)) throw Error('Enter finite movement.');
    for (const s of moved) {
      s.x += request.x;
      s.y += request.y;
      if (![s.x, s.y].every(Number.isFinite)) throw Error('Movement exceeds finite geometry.');
    }
  } else if (request.kind === 'transform') {
    if (request.matrix.length !== 6 || request.matrix.some((n) => !Number.isFinite(n)))
      throw Error('Choose a finite transform.');
    transformVectors(moved, request.matrix);
  } else if (request.kind !== 'delete') throw Error('Choose a supported selection edit.');
  for (const layer of layers) {
    const target = targets.get(layer.id);
    const mask = target?.mask;
    if (foregroundMove && target?.ids.size && request.kind === 'move' && (request.x || request.y) && layer.drawingMode === 'merge')
      keyAt(layer, frame).shapes.sort((a, b) => Number(target.ids.has(a.id)) - Number(target.ids.has(b.id)));
    if (!target?.ids.size || !mask) continue;
    const shapes = keyAt(layer, frame).shapes;
    if (shapes.every(shape => !target.ids.has(shape.id) ||
        (!mask.region && containedByMask([shape], mask.bounds)) ||
        (mask.footprints?.get(shape.id) && clippedFootprint(shape, mask)))) continue;
    throw Error('Keep the cross-layer edit inside the mask.');
  }
  return { ...project, layers };
}

function qualifyLiveEndpointEdits(original: Project, candidate: Project, frame: number) {
  let nested = false;
  for (const [i, layer] of candidate.layers.entries()) {
    const before = original.layers[i];
    if (layer === before || !layer.liveMotionSpans?.length ||
        keyAt(layer, frame) === keyAt(before, frame)) continue;
    for (const span of layer.liveMotionSpans) {
      if (span.start !== frame && span.end !== frame) continue;
      createLiveMotionSpanSampler(candidate, layer.id, span).dispose();
      if (span.symbolContinuity === 'movie-trees') nested = true;
    }
  }
  if (nested) {
    const topology = selectionTrajectoryStamp(compileMovieClockPlan(original));
    checkMovieClockTopology(candidate, topology);
    return topology;
  }
}

function checkMovieClockTopology(project: Project, topology: string) {
  if (selectionTrajectoryStamp(compileMovieClockPlan(project)) !== topology)
    throw Error('Cross-layer movement changed the original nested movie clock topology.');
}

function prepareEndpointEdits(original: Project, candidate: Project, frame: number, request: CrossLayerChange) {
  const refresh = request.kind !== 'delete' &&
    candidate.layers.some((layer, i) => layer !== original.layers[i] &&
      layer.motionSpans?.some(span => span.start === frame || span.end === frame));
  if (refresh) {
    refreshChangedBasicMotionSpans(original, candidate);
    validateProject(candidate);
  }
  if (request.kind !== 'delete') return qualifyLiveEndpointEdits(original, candidate, frame);
}

/** Prepare all original targets on a detached full candidate. The caller retains
 * final actual editor/input/history admission after complete preparation. */
export function prepareCurrentLayerChange(
  project: Project,
  frame: number,
  selection: string[],
  change: CrossLayerChange,
) {
  validateLiveGraphicData(project);
  validateProject(project);
  validateLiveGraphicData(selection);
  validateLiveGraphicData(change);
  const signature = selectionTrajectoryStamp(project),
    ids = [...selection],
    request = structuredClone(change),
    original = structuredClone(project);
  if (selectionTrajectoryStamp(original) !== signature)
    throw Error('Original cross-layer snapshot changed during cloning.');
  const candidate = previewCurrentLayerChange(original, frame, ids, request);
  validateProject(candidate);
  prepareEndpointEdits(original, candidate, frame, request);
  validateLiveGraphicData(project);
  if (selectionTrajectoryStamp(project) !== signature)
    throw Error('Original cross-layer source changed during preparation.');
  return candidate;
}

export type CrossLayerRebuilder = (
  shapes: Vector[],
  selected: string[],
  preserveStrokeCurves: boolean,
  signal?: AbortSignal,
) => Promise<{ artwork: Vector[]; selected: string[] }>;

function validateMaskedMerge(
  mask: MemberMask,
  input: Vector[],
  output: { artwork: Vector[]; selected: string[] },
  deleting: boolean,
) {
  if (!mask.footprints) {
    if (!containedByMask(output.artwork, mask.bounds))
      throw Error('Keep the reconstructed cross-layer edit inside the mask.');
    return;
  }
  const originals = new Map(input.map(shape => [shape.id, shape]));
  const selected = new Set(output.selected);
  for (const shape of output.artwork) {
    if (!selected.has(shape.id) &&
        selectionTrajectoryStamp(shape) === selectionTrajectoryStamp(originals.get(shape.id))) continue;
    if (!containedByMask([shape], mask.bounds) && !clippedFootprint(shape, mask))
      throw Error('Keep the reconstructed cross-layer edit inside the mask.');
  }
  if (!deleting && !selected.size)
    throw Error('Keep the reconstructed selection visible under the mask.');
}

function maskedMergeReach(shapes: Vector[], seeds: ReadonlySet<number>) {
  const bounds = shapes.map(mergeControlBounds);
  if (bounds.some(b => ![b.left, b.top, b.right, b.bottom].every(Number.isFinite)))
    throw Error('Cannot resolve protected artwork beneath the mask.');
  return connectedMergeIndices(bounds, seeds);
}

export function prepareMaskedMergeComponent(
  mask: MemberMask,
  basis: Vector[],
  ids: string[],
  deleting = false,
) {
  const picks = new Set(ids);
  const component = maskedMergeReach(basis, new Set(basis.flatMap(
    (shape, i) => picks.has(shape.id) ? [i] : [],
  )));
  const { footprints } = mask;
  if (footprints && basis.some((shape, i) => component.has(i) && !footprints.has(shape.id)))
    throw Error('Reconstruction would reach protected artwork beneath the mask.');
  const outside = basis.filter((_, i) => !component.has(i));
  const input = basis.filter((shape, i) => component.has(i) && (!deleting || !picks.has(shape.id)));
  return {
    input,
    restore(output: { artwork: Vector[]; selected: string[] }) {
      validateMaskedMerge(mask, input, output, deleting);
      const { artwork } = output;
      if (deleting && input.length && !artwork.length)
        throw Error('Reconstruction would discard remaining artwork beneath the mask.');
      const known = new Set(artwork.map(shape => shape.id));
      if ((deleting && ids.some(id => known.has(id))) ||
          outside.some(shape => known.has(shape.id)) ||
          (outside.length && maskedMergeReach(
            [...artwork, ...outside], new Set(artwork.map((_, i) => i)),
          ).size !== artwork.length))
        throw Error('Reconstruction would reach protected artwork beneath the mask.');
      return mergeDrawingComponent(basis, component, () => artwork);
    },
  };
}

/** Merge each original layer independently. All work is detached; the caller must
 * re-admit its actual editor/history context immediately before publication. */
export async function prepareMergedCurrentLayerChange(
  project: Project,
  frame: number,
  selection: string[],
  change: CrossLayerChange,
  options: { rebuild: CrossLayerRebuilder; signal?: AbortSignal; admit?: () => void },
): Promise<{ project: Project; selected: string[] }> {
  validateLiveGraphicData(project);
  validateProject(project);
  const signature = selectionTrajectoryStamp(project);
  validateLiveGraphicData(selection);
  validateLiveGraphicData(change);
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
    throw Error('Use original merge options.');
  for (const name of ['rebuild', 'signal', 'admit']) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (descriptor && !('value' in descriptor)) throw Error('Use original merge options.');
  }
  const { rebuild, signal, admit } = options;
  if (typeof rebuild !== 'function' || (admit !== undefined && typeof admit !== 'function'))
    throw Error('Choose a layer reconstruction worker.');
  const current = () => {
    signal?.throwIfAborted();
    validateLiveGraphicData(project);
    if (selectionTrajectoryStamp(project) !== signature)
      throw Error('Original cross-layer source changed during preparation.');
    admit?.();
    signal?.throwIfAborted();
    validateLiveGraphicData(project);
    if (selectionTrajectoryStamp(project) !== signature)
      throw Error('Original cross-layer source changed during admission.');
  };
  const ids = [...selection],
    request = structuredClone(change);
  current();
  const original = structuredClone(project);
  current();
  if (selectionTrajectoryStamp(original) !== signature)
    throw Error('Original cross-layer snapshot changed during cloning.');
  let candidate = previewCurrentLayerChange(original, frame, ids, request, undefined, true);
  validateProject(candidate);
  const requested = new Set(ids),
    plans = currentLayerKeys(original, frame)
      .map(({ layer, key: originalKey, keys: [key], mask }) => ({
        layer: layer.id,
        originalKey,
        merge: layer.drawingMode === 'merge',
        mask,
        ids: expandSelection(
          key.shapes,
          key.shapes
            .filter((s) => requested.has(multiFrameId(layer.id, key.frame, s.id)))
            .map((s) => s.id),
          [],
        ),
      }))
      .filter((plan) => plan.ids.length);
  current();
  // Exact no-ops never regenerate topology or consume worker resources.
  if (selectionTrajectoryStamp(candidate) === signature)
    return {
      project: candidate,
      selected: plans.flatMap((p) => p.ids.map((id) => multiFrameId(p.layer, p.originalKey.frame, id))),
    };
  const topology = prepareEndpointEdits(original, candidate, frame, request);
  const selected: string[] = [];
  const deleting = request.kind === 'delete';
  for (const plan of plans) {
    current();
    if (!plan.merge) {
      if (!deleting)
        selected.push(...plan.ids.map((id) => multiFrameId(plan.layer, plan.originalKey.frame, id)));
      continue;
    }
    const layer = candidate.layers.find((l) => l.id === plan.layer)!,
      key = layer.keys.find((k) => k.frame === plan.originalKey.frame)!;
    const chosen = deleting ? [] : [...plan.ids];
    // The deleted paint is absent from the candidate. Use the original surface
    // to find the remaining objects that could have shared its merge component.
    const maskedDelete = !!plan.mask && deleting;
    const basis = maskedDelete ? plan.originalKey.shapes : key.shapes;
    const component = plan.mask && (plan.mask.footprints || maskedDelete)
      ? prepareMaskedMergeComponent(plan.mask, basis, plan.ids, maskedDelete)
      : undefined;
    const shapes = structuredClone(component?.input ?? key.shapes),
      payload = selectionTrajectoryStamp([shapes, chosen]),
      curves = shapes.some((s) => s.kind === 'bezier' && s.fillEnabled === false);
    current();
    const result = maskedDelete && !shapes.length
      ? { artwork: [], selected: [] }
      : await rebuild(shapes, chosen, curves, signal);
    current();
    if (selectionTrajectoryStamp([shapes, chosen]) !== payload)
      throw Error('Cross-layer worker input changed during preparation.');
    validateLiveGraphicData(result);
    if (!result || !Array.isArray(result.artwork) || !Array.isArray(result.selected))
      throw Error('Geometry worker returned invalid layer artwork.');
    const output = selectionTrajectoryStamp(result),
      detached = structuredClone(result);
    current();
    if (
      selectionTrajectoryStamp(result) !== output ||
      selectionTrajectoryStamp(detached) !== output
    )
      throw Error('Cross-layer worker output changed during preparation.');
    const known = new Set(detached.artwork.map((s) => s.id));
    if (
      new Set(detached.selected).size !== detached.selected.length ||
      detached.selected.some((id) => typeof id !== 'string' || !known.has(id)) ||
      (deleting && detached.selected.length)
    )
      throw Error('Geometry worker returned an invalid layer selection.');
    if (plan.mask && !component) validateMaskedMerge(plan.mask, shapes, detached, deleting);
    const artwork = component ? component.restore(detached) : detached.artwork;
    candidate = {
      ...candidate,
      layers: candidate.layers.map((l) =>
        l.id !== plan.layer
          ? l
          : {
              ...l,
              keys: l.keys.map((k) =>
                k.frame !== key.frame ? k : { ...k, shapes: artwork },
              ),
            },
      ),
    };
    validateProject(candidate);
    selected.push(...detached.selected.map((id) => multiFrameId(plan.layer, key.frame, id)));
    current();
  }
  validateLiveGraphicData(candidate);
  validateProject(candidate);
  const output = selectionTrajectoryStamp(candidate),
    detached = structuredClone(candidate);
  if (topology !== undefined) checkMovieClockTopology(detached, topology);
  current();
  if (
    selectionTrajectoryStamp(candidate) !== output ||
    selectionTrajectoryStamp(detached) !== output
  )
    throw Error('Cross-layer candidate changed during preparation.');
  return { project: detached, selected };
}
