import { validateLiveGraphicData } from '../../document/src/live-motion';
import { motionInteriorBaseline } from './motion-ownership';
import { projectDistributedMotion } from './motion-spans';
import { clone, id, validateProject, type Project } from '@splash/document';
export function removeRootLayer(project: Project, layerId: string) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer || layer.locked || project.layers.length < 2)
    throw new Error('Choose an unlocked layer and keep at least one layer.');
  const layers = project.layers.filter((item) => item !== layer);
  if (project.opacityBindings !== undefined || project.layerMasks !== undefined) {
    validateProject(project);
    const candidate = { ...project, layers };
    if (project.opacityBindings !== undefined) {
      const remaining = project.opacityBindings.filter((binding) => binding.layerId !== layerId);
      if (remaining.length !== project.opacityBindings.length) {
        if (remaining.length) candidate.opacityBindings = remaining;
        else delete candidate.opacityBindings;
      }
    }
    if (project.layerMasks !== undefined) {
      const remaining = project.layerMasks
        .filter((mask) => mask.maskLayerId !== layerId)
        .map((mask) => ({ ...mask, layerIds: mask.layerIds.filter((id) => id !== layerId) }))
        .filter((mask) => mask.layerIds.length);
      if (remaining.length) candidate.layerMasks = remaining;
      else if (project.layerMasks.length) delete candidate.layerMasks;
    }
    validateProject(candidate);
    if (candidate.opacityBindings !== undefined)
      project.opacityBindings = candidate.opacityBindings;
    else delete project.opacityBindings;
    if (candidate.layerMasks !== undefined) project.layerMasks = candidate.layerMasks;
    else delete project.layerMasks;
  }
  project.layers = layers;
}

/** Duplicate artwork identities consistently across all exposures. The caller validates
 * the enclosing project or symbol before publishing the returned track. */
export function copyLayerArtwork(source: Project['layers'][number]) {
  const layer = clone(source),
    ids = new Map<string, string>(),
    groups = new Map<string, string>();
  const fresh = (map: Map<string, string>, old: string) => {
    if (!map.has(old)) map.set(old, id());
    return map.get(old)!;
  };
  layer.id = id();
  layer.name = (layer.name.slice(0, 75) + ' copy').slice(0, 80);
  layer.locked = false;
  for (const key of layer.keys)
    for (const shape of key.shapes) {
      shape.id = fresh(ids, shape.id);
      if (shape.groups) shape.groups = shape.groups.map((g) => fresh(groups, g));
    }
  // Only rebase an interior that still matches the source recipe's ownership record.
  // Spans are ordered and disjoint, so the cursor visits each key at most once.
  let cursor = 0;
  for (const span of layer.motionSpans ?? []) {
    while (cursor < source.keys.length && source.keys[cursor].frame <= span.start) cursor++;
    const first = cursor;
    while (cursor < source.keys.length && source.keys[cursor].frame < span.end) cursor++;
    if (span.baseline === motionInteriorBaseline(source.keys.slice(first, cursor)))
      span.baseline = JSON.stringify(layer.keys.slice(first, cursor));
  }
  return { layer, ids, groups };
}

export function duplicateLayer(project: Project, sourceId: string): string {
  const index = project.layers.findIndex((l) => l.id === sourceId);
  if (index < 0 || project.layers.length >= 1000)
    throw new Error('Layer duplication exceeds limits.');
  const source = project.layers[index];
  const validateCopy = project.opacityBindings !== undefined || !!source.motionSpans?.length;
  if (validateCopy) validateProject(project);
  const { layer, ids } = copyLayerArtwork(source);
  const copiedBindings = (project.opacityBindings ?? [])
    .filter((binding) => binding.layerId === sourceId)
    .map((binding) => {
      const shapeId = ids.get(binding.shapeId);
      if (!shapeId) throw new Error('The copied opacity target is missing.');
      return { ...clone(binding), layerId: layer.id, shapeId };
    });
  const layers = [...project.layers];
  layers.splice(index + 1, 0, layer);
  const candidate = { ...project, layers };
  if (copiedBindings.length)
    candidate.opacityBindings = [...project.opacityBindings!, ...copiedBindings];
  if (validateCopy) validateProject(candidate);
  if (copiedBindings.length) project.opacityBindings = candidate.opacityBindings;
  project.layers = layers;
  return layer.id;
}
export function positionLayer(project: Project, layerId: string, edge: 'top' | 'bottom') {
  const index = project.layers.findIndex((l) => l.id === layerId);
  if (index < 0) throw new Error('Layer missing.');
  const [layer] = project.layers.splice(index, 1);
  if (edge === 'top') project.layers.push(layer);
  else project.layers.unshift(layer);
}
/** Row order is top-to-bottom; stored paint order is bottom-to-top. A mask
 * source moves with its complete member run. Individual members stay in their
 * existing group, and ordinary row-edge drops never implicitly join a mask. */
export function prepareLayerReorder(
  project: Project,
  sourceId: string,
  targetId: string,
  side: 'above' | 'below',
): Project {
  validateLiveGraphicData(project);
  validateProject(project);
  if (side !== 'above' && side !== 'below') throw Error('Choose an original layer insertion edge.');
  const source = project.layers.find((l) => l.id === sourceId),
    target = project.layers.find((l) => l.id === targetId);
  if (!source || !target) throw Error('Choose original source and destination layers.');
  if (source === target) return project;
  const owner = (id: string) =>
    project.layerMasks?.find((m) => m.maskLayerId === id || m.layerIds.includes(id));
  const sourceMask = owner(sourceId),
    targetMask = owner(targetId),
    sourceIsMember = !!sourceMask && sourceMask.maskLayerId !== sourceId;
  if (sourceIsMember && sourceMask !== targetMask)
    throw Error('Keep masked layers inside their mask group when reordering.');
  const ids = new Set(
    sourceMask?.maskLayerId === sourceId ? [...sourceMask.layerIds, sourceId] : [sourceId],
  );
  if (ids.has(targetId)) return project;
  const moving = project.layers.filter((l) => ids.has(l.id));
  if (moving.some((l) => l.locked)) throw Error('Unlock the layer group before reordering.');
  const anchorId =
    targetMask && targetMask !== sourceMask
      ? side === 'above'
        ? targetMask.maskLayerId
        : targetMask.layerIds[0]
      : targetId;
  const remaining = project.layers.filter((l) => !ids.has(l.id)),
    index = remaining.findIndex((l) => l.id === anchorId);
  const members = moving.map((l) => {
    if (l.folderId === target.folderId) return l;
    const moved = { ...l };
    if (target.folderId) moved.folderId = target.folderId;
    else delete moved.folderId;
    return moved;
  });
  const layers = [...remaining];
  layers.splice(index + (side === 'above' ? 1 : 0), 0, ...members);
  if (layers.every((layer, i) => layer === project.layers[i])) return project;
  const next = { ...project, layers };
  if (project.layerMasks) {
    const order = new Map(layers.map((l, i) => [l.id, i]));
    next.layerMasks = project.layerMasks.map((mask) => {
      const sorted = [...mask.layerIds].sort((a, b) => order.get(a)! - order.get(b)!);
      return sorted.every((id, i) => id === mask.layerIds[i])
        ? mask
        : { ...mask, layerIds: sorted };
    });
  }
  validateProject(next);
  return next;
}
export function layerDisplay(
  project: Project,
  activeId: string,
  mode: 'solo' | 'show' | 'lockOthers' | 'unlock',
) {
  if (!project.layers.some((l) => l.id === activeId)) throw new Error('Layer missing.');
  for (const layer of project.layers) {
    if (mode === 'solo') layer.visible = layer.id === activeId;
    if (mode === 'show') layer.visible = true;
    if (mode === 'lockOthers') layer.locked = layer.id !== activeId;
    if (mode === 'unlock') layer.locked = false;
  }
}

/** Distribute complete exposure histories, keeping each outer group intact and paint order stable. */
function partitionLayerArtwork(source: Project['layers'][number], availableLayers: number) {
  if (!source || source.locked || !source.visible)
    throw new Error('Choose a visible unlocked layer to distribute.');
  const units = new Map<string, { next: Set<string>; incoming: number }>();
  const owners = new Map<string, string>();
  const exposures = source.keys.map((key) => {
    const parts = new Map<string, typeof key.shapes>();
    let previous: string | undefined;
    for (const shape of key.shapes) {
      const unit = shape.groups?.length ? 'group:' + shape.groups[0] : 'shape:' + shape.id;
      if (owners.has(shape.id) && owners.get(shape.id) !== unit)
        throw new Error('Artwork changes groups across keys. Keep it on the original layer.');
      owners.set(shape.id, unit);
      if (!units.has(unit)) units.set(unit, { next: new Set(), incoming: 0 });
      if (previous !== unit) {
        if (parts.has(unit)) throw new Error('Interleaved groups cannot be distributed.');
        if (previous && !units.get(previous)!.next.has(unit)) {
          units.get(previous)!.next.add(unit);
          units.get(unit)!.incoming++;
        }
        parts.set(unit, []);
      }
      parts.get(unit)!.push(shape);
      previous = unit;
    }
    return { frame: key.frame, parts };
  });
  if (units.size < 2) return undefined;
  if (units.size > availableLayers)
    throw new Error('Distributing artwork would exceed the layer capacity.');
  const remaining = new Set(units.keys()),
    order: string[] = [];
  while (remaining.size) {
    const unit = [...remaining].find((name) => units.get(name)!.incoming === 0);
    if (unit === undefined)
      throw new Error(
        'Artwork changes stacking order across keys. Separate layers cannot preserve it.',
      );
    remaining.delete(unit);
    order.push(unit);
    for (const next of units.get(unit)!.next) units.get(next)!.incoming--;
  }
  const layers = order.map((unit, position) => ({
    ...source,
    id: position ? id() : source.id,
    name: (source.name.slice(0, 68) + ' · ' + (position + 1)).slice(0, 80),
    keys: exposures.map(({ frame, parts }) => ({ frame, shapes: clone(parts.get(unit) ?? []) })),
  }));
  const destinations = new Map(order.map((unit, i) => [unit, layers[i].id]));
  return { layers, owners, destinations };
}

export function distributeLayerArtwork(
  project: Project,
  sourceId: string,
  capacity = 1000,
): string[] {
  const index = project.layers.findIndex((layer) => layer.id === sourceId);
  const source = project.layers[index];
  if (!source || source.locked || !source.visible)
    throw new Error('Choose a visible unlocked layer to distribute.');
  const validate = project.opacityBindings !== undefined || !!source.motionSpans?.length;
  const captured = validate ? validateProject(project) : project;
  const partition = partitionLayerArtwork(
    captured.layers[index],
    capacity - project.layers.length + 1,
  );
  if (!partition) return [source.id];
  const { layers, owners, destinations } = partition;
  if (source.motionSpans?.length) projectDistributedMotion(captured, source, layers);
  const nextLayers = [...project.layers];
  nextLayers.splice(index, 1, ...layers);
  const candidate = { ...project, layers: nextLayers };
  if (project.opacityBindings !== undefined) {
    const opacityBindings = project.opacityBindings.map((binding) => {
      if (binding.layerId !== sourceId) return binding;
      const unit = owners.get(binding.shapeId);
      const layerId = unit === undefined ? undefined : destinations.get(unit);
      if (layerId === undefined) throw new Error('Distributed opacity target is missing.');
      return layerId === sourceId ? binding : { ...binding, layerId };
    });
    candidate.opacityBindings = opacityBindings;
  }
  if (validate) validateProject(candidate);
  if (candidate.opacityBindings !== undefined) project.opacityBindings = candidate.opacityBindings;
  project.layers = nextLayers;
  return layers.map((layer) => layer.id);
}
