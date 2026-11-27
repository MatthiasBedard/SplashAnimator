import { requireOwnedMotionInterior } from './motion-ownership';
import { copyLayerArtwork, distributeLayerArtwork } from './layers';
import {
  keyEveryFrame,
  copyLayerFrames,
  placeMotionFrameClip,
  cutLayerFrames,
  editLayerFrameRanges,
  pasteLayerFrames,
  retimeLayerFrameRanges,
  type FrameClip,
} from './timeline';
import {
  assertSymbolHasArtwork,
  clone,
  newProject,
  validateProject,
  type Project,
  id,
  keyAt,
  symbolLayers,
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Layer,
  type SymbolDefinition,
} from '../../document/src';

/** Fresh IDs are consistent across exposures, preserving instance continuity within the new track. */
function copyKeys(keys: Layer['keys']): Layer['keys'] {
  const shapes = new Map<string, string>(),
    groups = new Map<string, string>();
  const identity = (map: Map<string, string>, old: string) => {
    if (!map.has(old)) map.set(old, id());
    return map.get(old)!;
  };
  return clone(keys).map((key) => ({
    ...key,
    shapes: key.shapes.map((shape) => ({
      ...shape,
      id: identity(shapes, shape.id),
      ...(shape.groups ? { groups: shape.groups.map((g) => identity(groups, g)) } : {}),
    })),
  }));
}
function writable(definition: SymbolDefinition, layerId: string): Layer {
  const layer = symbolLayers(definition).find((l) => l.id === layerId);
  if (!layer || layer.locked || !layer.visible)
    throw new Error('Choose a visible unlocked symbol layer.');
  return layer;
}
function setKeys(definition: SymbolDefinition, layerId: string, keys: Layer['keys']) {
  if (layerId === '@base') {
    definition.shapes = keys[0].shapes;
    definition.timeline!.keys = keys.slice(1);
  } else definition.timeline!.layers!.find((l) => l.id === layerId)!.keys = keys;
}

/** Copy a held exposure or relocate a noninitial key without overwriting another key. */
export function transferSymbolKey(
  definition: SymbolDefinition,
  source: number,
  target: number,
  move = false,
  layerId = '@base',
  destinationLayerId = layerId,
): SymbolDefinition {
  const duration = definition.timeline?.duration ?? 1;
  if (!Number.isInteger(source) || source < 0 || source >= duration)
    throw new Error('Choose a frame within the symbol timeline.');
  if (!Number.isInteger(target) || target < 1 || target >= 10000)
    throw new Error('Destination must be frame 2 through 10000.');
  const from = writable(definition, layerId),
    to = writable(definition, destinationLayerId);
  const same = layerId === destinationLayerId;
  if ((same && target === source) || to.keys.some((k) => k.frame === target))
    throw new Error('Destination already contains a keyframe.');
  if (move && (!source || !from.keys.some((k) => k.frame === source)))
    throw new Error('Only a noninitial keyframe can be moved.');
  const held = keyAt(from, source).shapes;
  const result = clone(definition);
  result.timeline = {
    ...result.timeline,
    duration: Math.max(duration, target + 1),
    keys: result.timeline?.keys ?? [],
  };
  const inserted = same ? clone(held) : copyKeys([{ frame: target, shapes: held }])[0].shapes;
  if (move && !same) setKeys(result, layerId, clone(from.keys.filter((k) => k.frame !== source)));
  setKeys(
    result,
    destinationLayerId,
    [
      ...clone(to.keys.filter((k) => !(same && move && k.frame === source))),
      { frame: target, shapes: inserted },
    ].sort((a, b) => a.frame - b.frame),
  );
  return result;
}

function currentSymbolLibrary(definition: SymbolDefinition, symbols: SymbolDefinition[]) {
  return symbols.some(symbol => symbol.id === definition.id)
    ? symbols.map(symbol => symbol.id === definition.id ? definition : symbol)
    : [...symbols, definition];
}

function symbolArtworkCount(symbol: SymbolDefinition) {
  return symbolArtworks(symbol).reduce((count, shapes) => count + shapes.length, 0);
}

export function duplicateSymbolLayer(
  definition: SymbolDefinition,
  layerId: string,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): { definition: SymbolDefinition; layerId: string } {
  const source = writable(definition, layerId);
  if ((definition.timeline?.layers?.length ?? 0) >= 127)
    throw new Error('Symbol layer limit reached.');
  const library = currentSymbolLibrary(definition, symbols ?? []);
  const count = library.reduce((total, symbol) =>
    total + symbolArtworkCount(symbol), 0);
  if (count + source.keys.reduce((sum, key) => sum + key.shapes.length, 0) > MAX_SYMBOL_ARTWORK)
    throw new Error('Duplication would exceed the project symbol artwork budget.');
  const validateLibrary = symbols !== undefined || !!source.motionSpans?.length;
  const project = { ...newProject(), assets, symbols: library };
  if (validateLibrary) validateProject(project);
  const {layer: copy} = copyLayerArtwork(source);
  const result = clone(definition);
  result.timeline ??= { duration: 1, keys: [] };
  const layers = result.timeline.layers ?? [];
  const index = layerId === '@base' ? 0 : layers.findIndex((l) => l.id === layerId) + 1;
  result.timeline.layers = [...layers.slice(0, index), copy, ...layers.slice(index)];
  if (validateLibrary)
    validateProject({ ...project, symbols: currentSymbolLibrary(result, library) });
  return { definition: result, layerId: copy.id };
}

function range(definition: SymbolDefinition, start: number, end: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= (definition.timeline?.duration ?? 1)
  )
    throw new Error('Choose a frame range within the symbol duration.');
}
export function copySymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
  includeMotion = true,
): FrameClip {
  return copySymbolTracks(definition, [layerId], start, end, symbols, assets, includeMotion).tracks[0].clip;
}
export function clearSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return editSymbolTracks(definition, [layerId], start, end, 'clear', symbols, assets);
}
/** Reverse clipped exposure spans without expanding holds into per-frame keys. */
export function reverseSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return editSymbolTracks(definition, [layerId], start, end, 'reverse', symbols, assets);
}

export function insertSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  at: number,
  clip: FrameClip,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return insertSymbolTracks(definition, at, { tracks: [{ layerId, clip }] }, [layerId], symbols, assets);
}

function insertSymbolArtworkFrames(
  definition: SymbolDefinition,
  layerId: string,
  at: number,
  clip: FrameClip,
): SymbolDefinition {
  const duration = definition.timeline?.duration ?? 1;
  if (
    !Number.isInteger(at) ||
    at < 0 ||
    at > duration ||
    !Number.isInteger(clip.duration) ||
    clip.duration < 1 ||
    duration + clip.duration > 10000
  )
    throw new Error('Frame insertion exceeds the symbol duration limit.');
  if (
    !clip.keys.length ||
    clip.keys[0].frame !== 0 ||
    clip.keys.some(
      (k, i) =>
        !Number.isInteger(k.frame) ||
        k.frame < 0 ||
        k.frame >= clip.duration ||
        (i > 0 && k.frame <= clip.keys[i - 1].frame),
    )
  )
    throw new Error('Invalid symbol frame clipboard.');
  const track = writable(definition, layerId),
    result = clone(definition);
  const keys = clone(track.keys).map((k) => ({
    ...k,
    frame: k.frame >= at ? k.frame + clip.duration : k.frame,
  }));
  keys.push(...copyKeys(clip.keys).map((k) => ({ ...k, frame: at + k.frame })));
  if (at < duration && !keys.some((k) => k.frame === at + clip.duration))
    keys.push({ frame: at + clip.duration, shapes: clone(keyAt(track, at).shapes) });
  result.timeline = {
    ...result.timeline,
    duration: duration + clip.duration,
    keys: result.timeline?.keys ?? [],
  };
  setKeys(
    result,
    layerId,
    keys.sort((a, b) => a.frame - b.frame),
  );
  return result;
}
/** Remove time from one track while keeping shared duration and other tracks fixed. */
export function removeSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return editSymbolTracks(definition, [layerId], start, end, 'remove', symbols, assets);
}
export function duplicateSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return editSymbolTracks(definition, [layerId], start, end, 'duplicate', symbols, assets);
}
/** Temporary track-only carrier avoids cloning unrelated artwork for each batch member. */
function isolatedTrack(definition: SymbolDefinition, layerId: string): SymbolDefinition {
  const track = writable(definition, layerId);
  return {
    id: definition.id,
    name: definition.name,
    width: definition.width,
    height: definition.height,
    shapes: layerId === '@base' ? track.keys[0].shapes : [],
    timeline: {
      duration: definition.timeline?.duration ?? 1,
      keys: layerId === '@base' ? track.keys.slice(1) : [],
      layers: layerId === '@base' ? [] : [track],
    },
  };
}
/** Prepare all selected tracks against one duration; no partial edits escape on rejection. */
export function editSymbolTracks(
  definition: SymbolDefinition,
  layerIds: string[],
  start: number,
  end: number,
  action: 'clear' | 'duplicate' | 'remove' | 'reverse' | 'keys',
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  range(definition, start, end);
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose distinct symbol tracks.');
  if (action === 'duplicate') {
    if ((definition.timeline?.duration ?? 1) + end - start + 1 > 10000)
      throw new Error('Frame insertion exceeds the symbol duration limit.');
    const captured = copySymbolTracks(definition, layerIds, start, end, symbols, assets);
    return insertSymbolTracks(definition, end + 1, captured, layerIds, symbols, assets);
  }
  if (action !== 'keys') {
    const targets = layerIds.map(layerId => writable(definition, layerId));
    const project = symbolClipboardProject(definition, symbols ?? [], assets);
    if (action === 'remove') {
      project.frameLabels = definition.timeline?.frameLabels;
      project.frameComments = definition.timeline?.frameComments;
      project.frameScripts = definition.timeline?.frameScripts;
    }
    const validateLibrary = symbols !== undefined || targets.some(track => track.motionSpans?.length);
    if (validateLibrary) validateProject(project);
    else if (symbolArtworkCount(definition) > MAX_SYMBOL_ARTWORK)
      throw new Error('Edit exceeds the symbol artwork budget.');
    if (action === 'reverse' && start === end) return clone(definition);
    editLayerFrameRanges(project, layerIds, start, end, action, definition.id);
    return finishSymbolClipboardEdit(definition, project, validateLibrary);
  }
  const prepared = layerIds.map(layerId => {
    const track = writable(definition, layerId);
    return { layerId, keys: keyEveryFrame(track, start, end) };
  });
  if (prepared.every(({layerId, keys}) =>
    JSON.stringify(keys) === JSON.stringify(writable(definition, layerId).keys)))
    return clone(definition);
  const result = clone(definition),
    duration = definition.timeline?.duration ?? 1;
  result.timeline = {
    ...result.timeline,
    keys: result.timeline?.keys ?? [],
    duration,
  };
  for (const { layerId, keys } of prepared) setKeys(result, layerId, keys);
  return result;
}
/** Retime selected symbol tracks with fixed state mappings and isolated source data. */
export function retimeSymbolTracks(
  definition: SymbolDefinition,
  layerIds: string[],
  start: number,
  end: number,
  length: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  range(definition, start, end);
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose distinct symbol tracks.');
  const duration = definition.timeline?.duration ?? 1;
  if (
    !Number.isInteger(length) ||
    length < 1 ||
    duration + Math.max(0, length - (end - start + 1)) > 10000
  )
    throw new Error('Retimed symbol duration must fit within 10000 frames.');
  const targets = layerIds.map(layerId => writable(definition, layerId));
  if (length === end - start + 1) return clone(definition);
  const project = symbolClipboardProject(definition, symbols ?? [], assets);
  const validateLibrary = symbols !== undefined || targets.some(track => track.motionSpans?.length);
  if (validateLibrary) validateProject(project);
  else if (symbolArtworkCount(definition) > MAX_SYMBOL_ARTWORK)
    throw new Error('Retiming exceeds the symbol artwork budget.');
  retimeLayerFrameRanges(project, layerIds, start, end, length);
  return finishSymbolClipboardEdit(definition, project, validateLibrary);
}

export type SymbolTrackClip = { tracks: { layerId: string; clip: FrameClip }[] };
function symbolClipboardProject(definition: SymbolDefinition, symbols: SymbolDefinition[], assets: Project['assets']) {
  return {
    ...newProject(), duration: definition.timeline?.duration ?? 1, assets,
    symbols: currentSymbolLibrary(definition, symbols),
    layers: symbolLayers(definition).map(layer => ({ ...layer })),
  };
}

function finishSymbolClipboardEdit(definition: SymbolDefinition, project: ReturnType<typeof symbolClipboardProject>, validateLibrary = true) {
  const [base, ...additional] = project.layers;
  assertSymbolHasArtwork(project.layers);
  const timeline = { ...definition.timeline, duration: project.duration, keys: base.keys.slice(1) };
  if (additional.length || definition.timeline?.layers) timeline.layers = additional;
  if (base.motionSpans !== undefined) timeline.motionSpans = base.motionSpans;
  else delete timeline.motionSpans;
  const result = { ...definition, shapes: base.keys[0].shapes, timeline };
  if (base.keys[0].openMotionTween) result.openMotionTween = base.keys[0].openMotionTween;
  else delete result.openMotionTween;
  if (validateLibrary) validateProject({ ...project, symbols: currentSymbolLibrary(result, project.symbols) });
  else if (symbolArtworkCount(result) > MAX_SYMBOL_ARTWORK)
    throw new Error('Edit exceeds the symbol artwork budget.');
  return clone(result);
}

export function cutSymbolTracks(
  definition: SymbolDefinition,
  layerIds: string[],
  start: number,
  end: number,
  symbols: SymbolDefinition[] = [definition],
  assets: Project['assets'] = [],
): { definition: SymbolDefinition; clipboard: SymbolTrackClip } {
  range(definition, start, end);
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose distinct symbol tracks.');
  for (const layerId of layerIds) writable(definition, layerId);
  const project = symbolClipboardProject(definition, symbols, assets);
  validateProject(project);
  const { tracks } = cutLayerFrames(project, layerIds, start, end);
  return { definition: finishSymbolClipboardEdit(definition, project), clipboard: { tracks } };
}

export function copySymbolTracks(
  definition: SymbolDefinition,
  layerIds: string[],
  start: number,
  end: number,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
  includeMotion = true,
): SymbolTrackClip {
  range(definition, start, end);
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose distinct symbol tracks.');
  for (const layerId of layerIds) writable(definition, layerId);
  const project = symbolClipboardProject(definition, symbols ?? [], assets);
  return { tracks: copyLayerFrames(project, layerIds, start, end, includeMotion).tracks };
}
/** Routed insertion: all tracks share one time extension and validate before assembly. */
export function insertSymbolTracks(
  definition: SymbolDefinition,
  at: number,
  clipboard: SymbolTrackClip,
  destinations = clipboard.tracks.map((t) => t.layerId),
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  const tracks = clipboard.tracks,
    length = tracks[0]?.clip.duration;
  if (
    !tracks.length ||
    new Set(tracks.map((t) => t.layerId)).size !== tracks.length ||
    tracks.some((t) => t.clip.duration !== length)
  )
    throw new Error('Invalid symbol track clipboard.');
  if (destinations.length !== tracks.length || new Set(destinations).size !== destinations.length)
    throw new Error('Choose one distinct destination per copied track.');
  const targets = destinations.map(layerId => writable(definition, layerId));
  if (symbols !== undefined || tracks.some(t => t.clip.motionSpans !== undefined) || targets.some(t => t.motionSpans?.length)) {
    const project = symbolClipboardProject(definition, symbols ?? [], assets);
    if (!Number.isSafeInteger(at) || at < 0 || at > project.duration ||
        !Number.isSafeInteger(length) || length < 1 || project.duration + length > 10000)
      throw new Error('Frame insertion exceeds the symbol duration limit.');
    let count = project.symbols.reduce((n,symbol) =>
      n + symbolArtworks(symbol).reduce((sum, shapes) => sum + shapes.length, 0), 0);
    for (const [i, {clip}] of tracks.entries()) {
      count += clip.keys.reduce((sum,key) => sum + key.shapes.length, 0);
      if (at < project.duration && !targets[i].keys.some(key => key.frame === at))
        count += keyAt(targets[i], at).shapes.length;
    }
    if (count > MAX_SYMBOL_ARTWORK) throw new Error('Insertion exceeds the project symbol artwork budget.');
    validateProject(project);
    const clips = tracks.map(({clip}, i) => ({
      ...targets[i], keys: clip.keys, motionSpans: clip.motionSpans,
    }));
    // Admit original clipboard values and recipe ranges before JSON cloning or ID remapping.
    validateProject({ ...project, duration: length, layers: clips });
    const routed = clips.map((layer, i) => {
      for (const span of layer.motionSpans ?? []) requireOwnedMotionInterior(layer, span);
      const copy = copyLayerArtwork(layer).layer;
      return { layerId: destinations[i], clip: {duration:length, keys:copy.keys, motionSpans:copy.motionSpans} };
    });
    pasteLayerFrames(project, at, {projectId:project.id, tracks:routed});
    return finishSymbolClipboardEdit(definition, project);
  }
  const prepared = tracks.map(({ clip }, index) => {
    const layerId = destinations[index];
    const changed = insertSymbolArtworkFrames(isolatedTrack(definition, layerId), layerId, at, clip);
    return { layerId, keys: symbolLayers(changed).find((l) => l.id === layerId)!.keys };
  });
  const result = clone(definition);
  result.timeline = {
    ...result.timeline,
    keys: result.timeline?.keys ?? [],
    duration: (definition.timeline?.duration ?? 1) + length,
  };
  for (const { layerId, keys } of prepared) setKeys(result, layerId, keys);
  return result;
}

/** Transfer a span into blank time without shifting unrelated keys. */
export function transferSymbolFrames(
  definition: SymbolDefinition,
  layerId: string,
  start: number,
  end: number,
  destinationLayerId: string,
  at: number,
  move = false,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  return transferSymbolTracks(definition, [layerId], start, end, at, move, [destinationLayerId], symbols, assets);
}

/** Snapshot every source, clear moves together, then place routes atomically. */
export function transferSymbolTracks(
  definition: SymbolDefinition,
  layerIds: string[],
  start: number,
  end: number,
  at: number,
  move = false,
  destinations = layerIds,
  symbols?: SymbolDefinition[],
  assets: Project['assets'] = [],
): SymbolDefinition {
  range(definition, start, end);
  const count = end - start + 1,
    duration = definition.timeline?.duration ?? 1;
  if (!Number.isInteger(at) || at < 0 || at + count > 10000)
    throw new Error('Destination range exceeds the symbol duration limit.');
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new Error('Choose distinct symbol tracks.');
  if (destinations.length !== layerIds.length || new Set(destinations).size !== destinations.length)
    throw new Error('Choose one distinct destination per selected track.');
  const targets = destinations.map(layerId => writable(definition, layerId));
  const sources = layerIds.map((layerId, i) => {
    const track = writable(definition, layerId);
    if (layerId === destinations[i] && at <= end && at + count > start)
      throw new Error('Source and destination ranges must not overlap.');
    return track;
  });

  const project = symbolClipboardProject(definition, symbols ?? [], assets);
  const validateLibrary = symbols !== undefined || [...sources, ...targets].some(track => track.motionSpans?.length);
  if (validateLibrary) validateProject(project);
  else if (symbolArtworkCount(definition) > MAX_SYMBOL_ARTWORK)
    throw new Error('Transfer exceeds the symbol artwork budget.');
  const { tracks } = move
    ? cutLayerFrames(project, layerIds, start, end)
    : copyLayerFrames(project, layerIds, start, end);
  project.duration = Math.max(duration, at + count);
  for (const [i, { layerId, clip }] of tracks.entries()) {
    // All sources have been captured, and move sources cleared, before inspecting
    // any destination. Distinct target IDs keep simultaneous swaps independent.
    const target = project.layers.find(layer => layer.id === destinations[i])!;
    let routed = clip;
    if (!move || target.id !== layerId) {
      const { layer } = copyLayerArtwork({ ...sources[i], keys: clip.keys, motionSpans: clip.motionSpans });
      routed = { duration: clip.duration, keys: layer.keys, motionSpans: layer.motionSpans };
    }
    placeMotionFrameClip(project, target, duration, at, routed, !move, 'Destination range');
  }
  return finishSymbolClipboardEdit(definition, project, validateLibrary);
}

/** Distribute one complete symbol track while retaining state mappings. */
export function distributeSymbolArtwork(
  definition: SymbolDefinition,
  layerId: string,
  symbols: SymbolDefinition[] = [definition],
  assets: Project['assets'] = [],
): SymbolDefinition {
  const source = writable(definition, layerId);
  const project = newProject();
  project.duration = definition.timeline?.duration ?? 1;
  project.assets = assets;
  // Preserve original numeric values for the motion ownership check. Distribution
  // prepares private layers and only replaces the adapter's root layer array.
  project.layers = symbolLayers(definition);
  project.symbols = currentSymbolLibrary(definition, symbols);
  const outputIds = distributeLayerArtwork(project, layerId, 128);
  if (outputIds.length < 2) return clone(definition);
  const [base, ...additional] = project.layers;
  assertSymbolHasArtwork(project.layers);
  const result = clone(definition);
  result.shapes = clone(base.keys[0].shapes);
  result.timeline = {
    ...result.timeline,
    duration: project.duration,
    keys: clone(base.keys.slice(1)),
    layers: clone(additional),
  };
  if (base.motionSpans !== undefined) result.timeline.motionSpans = clone(base.motionSpans);
  else delete result.timeline.motionSpans;
  if (source.motionSpans?.length) {
    // Validate the replacement inside its library, including aggregate artwork
    // and expansion budgets, before returning a publishable symbol draft.
    validateProject({ ...project, symbols: project.symbols.map(symbol =>
      symbol.id === definition.id ? result : symbol) });
  }
  return result;
}
