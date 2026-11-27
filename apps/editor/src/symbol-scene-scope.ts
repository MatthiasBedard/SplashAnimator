import { clone, newProject, symbolLayers, validateProject, type ButtonStates, type Project, type SymbolDefinition } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { inversePoint, transformVectors, type Matrix } from '../../../packages/geometry/src/affine';
import type { SymbolEditContext } from '../../../packages/geometry/src/symbol-context';
import { updateSymbolTimelines } from '../../../packages/geometry/src/symbols';
import { authoringLayerMasks } from './layer-outline';
import { extractEditedSymbolMask, prepareSymbolReferencePass } from './symbol-reference-masks';

type SymbolSceneProject = Project & { symbolSceneButtonStates?: ButtonStates; symbolSceneNestedIds?: string[]; symbolSceneBitmapIds?: string[] };
export const buttonStateRoles = ['up', 'over', 'down', 'hit'] as const;

export function symbolSceneButtonStates(project: Project) {
  return (project as SymbolSceneProject).symbolSceneButtonStates;
}

export function setSymbolSceneButtonFrame(project: Project, role: keyof ButtonStates, frame: number) {
  const states = symbolSceneButtonStates(project);
  if (!states || !buttonStateRoles.includes(role) || !Number.isInteger(frame) || frame < 0 || frame >= project.duration)
    throw Error('Choose a Button state frame within the timeline.');
  states[role] = frame;
}

export function scopedBitmaps(original: Project, edited: SymbolSceneProject): Project['assets'] {
  const ids = edited.symbolSceneBitmapIds;
  if (ids === undefined) return [];
  const added = edited.assets.slice(original.assets.length);
  if (!Array.isArray(ids) || !added.length || ids.length !== added.length ||
      stamp(edited.assets.slice(0, original.assets.length)) !== stamp(original.assets) ||
      added.some((asset, i) => asset.id !== ids[i] || !asset.bitmap?.dataUrl || asset.audio || asset.font))
    throw Error('The symbol draft changes unowned bitmap data.');
  return added;
}

export function addScopedBitmaps(draft: SymbolSceneProject, assets: Project['assets']) {
  if (!assets.length) return;
  draft.assets.push(...clone(assets));
  draft.symbolSceneBitmapIds = [...draft.symbolSceneBitmapIds ?? [], ...assets.map(asset => asset.id)];
}

export function scopedNestedDefinitions(original: Project, edited: Project): SymbolDefinition[] {
  const ids = (edited as SymbolSceneProject).symbolSceneNestedIds;
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || !ids.length) throw Error('Invalid nested symbol draft ownership.');
  const owned = new Set(ids);
  if (owned.size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !edited.symbols?.some(definition => definition.id === id)))
    throw Error('Invalid nested symbol draft ownership.');
  const originalIds = new Set(original.symbols?.map(definition => definition.id));
  const artworkFields = new Set(['shapes', 'timeline', 'buttonStates', 'baseLayer', 'multiFramePivot', 'openMotionTween']);
  const libraryHeader = (p: Project) => (p.symbols ?? []).filter(definition => originalIds.has(definition.id) || !owned.has(definition.id)).map(definition => {
    if (!owned.has(definition.id)) return definition;
    return Object.fromEntries(Object.entries(definition).filter(([key]) => !artworkFields.has(key)));
  });
  if (stamp(libraryHeader(original)) !== stamp(libraryHeader(edited)))
    throw Error('This edit changes unowned library data.');
  return edited.symbols!.filter(definition => owned.has(definition.id));
}

export function stageScopedNestedDefinitions(original: Project, edited: Project, definitions: readonly SymbolDefinition[], bitmaps: Project['assets'] = []): Project {
  validateLiveGraphicData(edited);
  const previous = scopedNestedDefinitions(original, edited);
  const candidate: SymbolSceneProject = composeScopedSymbolProject(edited, definitions, bitmaps);
  if (bitmaps.length) candidate.symbolSceneBitmapIds = [...(edited as SymbolSceneProject).symbolSceneBitmapIds ?? [], ...bitmaps.map(asset => asset.id)];
  candidate.symbolSceneNestedIds = [...new Set([...previous, ...definitions].map(definition => definition.id))];
  scopedNestedDefinitions(original, candidate);
  return candidate;
}

export function ownScopedSymbolCreation(original: Project, before: Project, candidate: SymbolSceneProject, id: string) {
  if (before.symbols?.some(definition => definition.id === id) || !candidate.symbols?.some(definition => definition.id === id))
    throw Error('The new nested symbol identity changed.');
  const previous = scopedNestedDefinitions(original, before);
  candidate.symbolSceneNestedIds = [...previous.map(definition => definition.id), id];
  scopedNestedDefinitions(original, candidate);
}

/** Compose the full graph before replacing any definition or publishing new library entries. */
export function composeScopedSymbolProject(source: Project, definitions: readonly SymbolDefinition[], bitmaps: Project['assets'] = []): Project {
  validateLiveGraphicData(source);
  validateLiveGraphicData(bitmaps);
  validateLiveGraphicData(definitions);
  const replacements = new Map(definitions.map(definition => [definition.id, definition]));
  if (replacements.size !== definitions.length) throw Error('Duplicate scoped symbol draft.');
  const existing = source.symbols ?? [];
  const existingIds = new Set(existing.map(definition => definition.id));
  const additions = definitions.filter(definition => !existingIds.has(definition.id));
  const symbols = [...existing.map(definition => replacements.get(definition.id) ?? definition), ...additions];
  const schemaVersion = source.schemaVersion === 59 && definitions.some(d => d.timeline?.layerMasks) ? 60 : source.schemaVersion;
  validateProject({ ...source, schemaVersion, assets: [...source.assets, ...bitmaps], symbols });
  const candidate = clone(source);
  candidate.schemaVersion = schemaVersion;
  candidate.assets.push(...clone(bitmaps));
  candidate.symbols = [...(candidate.symbols ?? []), ...clone(additions)];
  updateSymbolTimelines(candidate, definitions.filter(definition => existingIds.has(definition.id)).map(definition => [definition.id, definition]));
  return candidate;
}

function localSymbolLayers(definition: SymbolDefinition) {
  return clone(symbolLayers(definition)).map(layer => ({
    ...layer,
    drawingMode: layer.drawingMode ?? (layer.keys.some(key => key.shapes.some(shape =>
      shape.kind === 'text' || shape.kind === 'symbol' || shape.groups?.length)) ? 'object' as const : 'merge' as const),
  }));
}

export function replaceScopedTimeline(edited: Project, definition: SymbolDefinition): Project {
  validateLiveGraphicData(definition);
  const layers: Project['layers'] = localSymbolLayers(definition);
  const candidate: SymbolSceneProject = clone(edited);
  const modes = new Map(edited.layers.map(layer => [layer.id, layer.drawingMode]));
  const authoredModes = new Map(definition.timeline?.layers?.map(layer => [layer.id, layer.drawingMode]));
  for (const layer of layers)
    if (authoredModes.get(layer.id) === undefined && modes.has(layer.id)) layer.drawingMode = modes.get(layer.id);
  const timeline = definition.timeline;
  if (timeline?.layerMasks) candidate.layerMasks = clone(timeline.layerMasks);
  else delete candidate.layerMasks;
  Object.assign(candidate, {
    layers, duration: timeline?.duration ?? 1, frameScripts: timeline?.frameScripts,
    frameLabels: timeline?.frameLabels, frameComments: timeline?.frameComments,
    multiFramePivot: definition.multiFramePivot, symbolSceneButtonStates: definition.buttonStates,
  });
  return validateProject(candidate);
}

export function prepareSymbolScene(project: Project, definition: SymbolDefinition, context?: SymbolEditContext) {
  const m = context?.matrix, owners = context?.referenceLayers;
  const masks = project.layerMasks ?? [];
  validateLiveGraphicData(definition);
  const extent = { width: Math.max(1, Math.ceil(definition.width)), height: Math.max(1, Math.ceil(definition.height)) };
  if (![definition.width, definition.height].every(n => Number.isFinite(n) && n >= 0) ||
      !Object.values(extent).every(Number.isSafeInteger) ||
      (m && (!m.every(Number.isFinite) || (masks.length && !owners))))
    return null;
  let stage;
  if (context && m) {
    const [a, b, c, d] = m;
    const scale = Math.hypot(a, b), det = a * d - b * c;
    if (!Number.isFinite(scale) || !Number.isFinite(det) || det === 0) return null;
    // The perpendicular component stays signed to preserve reflections.
    const uniform = a === d && b === -c;
    const aspect = uniform ? 1 : (a / scale * d - b / scale * c) / scale;
    const shear = uniform ? 0 : (a / scale * c + b / scale * d) / scale;
    const origin = inversePoint(m, { x: 0, y: 0 });
    const inverse: Matrix = [d / det, -b / det, -c / det, a / det, origin.x, origin.y];
    if (aspect === 0 || ![aspect, shear, ...inverse].every(Number.isFinite)) return null;
    const reference = clone(context);
    transformVectors(reference.under, inverse);
    transformVectors(reference.over, inverse);
    const activeMasks = authoringLayerMasks(project.layers, masks);
    const root = reference.referenceLayers?.root;
    const editedMask = root && activeMasks.find(mask => mask.maskLayerId === root || mask.layerIds.includes(root));
    const enclosingMask = editedMask ? extractEditedSymbolMask(reference, editedMask) : undefined;
    const otherMasks = editedMask ? activeMasks.filter(mask => mask !== editedMask) : activeMasks;
    stage = {
      ...reference, inverse, scale, aspect, shear, rotation: Math.atan2(b, a) * 180 / Math.PI,
      enclosingMask,
      underPass: reference.referenceLayers && prepareSymbolReferencePass(reference.under, reference.underOutline, reference.referenceLayers.under, otherMasks),
      overPass: reference.referenceLayers && prepareSymbolReferencePass(reference.over, reference.overOutline, reference.referenceLayers.over, otherMasks),
    };
  }
  const local: SymbolSceneProject = newProject(definition.name);
  local.schemaVersion = project.schemaVersion;
  if (definition.timeline?.layerMasks) local.layerMasks = clone(definition.timeline.layerMasks);
  // The shared workspace draws at definition coordinates. Its temporary document still obeys scene limits.
  local.width = Math.min(extent.width, 8192);
  local.height = Math.min(extent.height, 8192);
  local.fps = project.fps;
  local.background = project.background;
  local.duration = definition.timeline?.duration ?? 1;
  if (definition.buttonStates) local.symbolSceneButtonStates = clone(definition.buttonStates);
  local.assets = clone(project.assets);
  if (project.symbols) local.symbols = clone(project.symbols);
  if (project.libraryFolders) local.libraryFolders = clone(project.libraryFolders);
  if (project.libraryLinks) local.libraryLinks = clone(project.libraryLinks);
  if (project.libraryItems) local.libraryItems = clone(project.libraryItems);
  if (definition.timeline?.frameScripts) local.frameScripts = clone(definition.timeline.frameScripts);
  if (definition.timeline?.frameLabels) local.frameLabels = clone(definition.timeline.frameLabels);
  if (definition.timeline?.frameComments) local.frameComments = clone(definition.timeline.frameComments);
  if (definition.multiFramePivot) local.multiFramePivot = clone(definition.multiFramePivot);
  local.layers = localSymbolLayers(definition);
  validateProject(local);
  return { project: local, extent, stage, original: clone(local) };
}

export function finishSymbolScene(definition: SymbolDefinition, original: Project, edited: Project): SymbolDefinition {
  validateLiveGraphicData(edited);
  validateProject(edited);
  const { layers, duration, frameScripts, frameLabels, frameComments, multiFramePivot } = edited;
  const buttonStates = symbolSceneButtonStates(edited);
  if (buttonStates !== undefined && (!buttonStates || Array.isArray(buttonStates) || Object.keys(buttonStates).length !== buttonStateRoles.length ||
      !buttonStateRoles.every(role => Object.hasOwn(buttonStates, role) && Number.isInteger(buttonStates[role]) &&
        buttonStates[role] >= 0 && buttonStates[role] < duration)))
    throw Error('Keep all mapped Button state frames within the timeline.');
  const localFields = new Set(['layers', 'layerMasks', 'duration', 'frameScripts', 'frameLabels', 'frameComments', 'multiFramePivot']);
  const children = scopedNestedDefinitions(original, edited);
  if (children.length) {
    if (original.schemaVersion === 59 && edited.schemaVersion === 60 &&
        children.some(d => d.timeline?.layerMasks)) localFields.add('schemaVersion');
    localFields.add('symbols');
    localFields.add('symbolSceneNestedIds');
  }
  if (scopedBitmaps(original, edited).length) {
    localFields.add('assets');
    localFields.add('symbolSceneBitmapIds');
  }
  localFields.add('symbolSceneButtonStates');
  const header = (p: Project) => Object.fromEntries(Object.entries(p).filter(([key]) => !localFields.has(key)));
  if (stamp(header(edited)) !== stamp(header(original)))
    throw Error('This edit changes scene-level data. Undo it before saving the symbol.');
  const [base, ...additional] = layers;
  if (base.id !== '@base' || layers.some(l => l.folderId !== undefined || l.liveMotionSpans !== undefined) || duration > 10000)
    throw Error('The symbol needs its Artwork base layer, supported layer settings and at most 10,000 frames.');
  const next = clone(definition);
  if (buttonStates) next.buttonStates = clone(buttonStates);
  else delete next.buttonStates;
  next.shapes = clone(base.keys[0].shapes);
  if (base.keys[0].openMotionTween) next.openMotionTween = clone(base.keys[0].openMotionTween);
  else delete next.openMotionTween;
  const { name, visible, locked, outline, outlineColor } = base;
  const metadata = { name, visible, locked, ...(outline !== undefined ? { outline } : {}), ...(outlineColor !== undefined ? { outlineColor } : {}) };
  if (definition.baseLayer || name !== 'Artwork' || !visible || locked || outline !== undefined || outlineColor !== undefined)
    next.baseLayer = metadata;
  if (definition.timeline || duration > 1 || additional.length || base.motionSpans || frameScripts || frameLabels || frameComments) {
    next.timeline = {
      duration, keys: clone(base.keys.slice(1)),
      ...(edited.layerMasks ? { layerMasks: clone(edited.layerMasks) } : {}),
      ...(additional.length || definition.timeline?.layers ? { layers: additional.map(layer => {
        const local = clone(layer);
        if (local.drawingMode === original.layers.find(l => l.id === local.id)?.drawingMode &&
            definition.timeline?.layers?.find(l => l.id === local.id)?.drawingMode === undefined)
          delete local.drawingMode;
        return local;
      }) } : {}),
      ...(base.motionSpans ? { motionSpans: clone(base.motionSpans) } : {}),
      ...(frameScripts ? { frameScripts: clone(frameScripts) } : {}),
      ...(frameLabels ? { frameLabels: clone(frameLabels) } : {}),
      ...(frameComments ? { frameComments: clone(frameComments) } : {}),
    };
  }
  if (multiFramePivot) next.multiFramePivot = clone(multiFramePivot);
  else delete next.multiFramePivot;
  return next;
}
