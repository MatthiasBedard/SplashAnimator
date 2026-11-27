import {
  clone,
  symbolLayers,
  symbolArtworks,
  id,
  keyAt,
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Vector,
  type SymbolDefinition,
} from '../../document/src';
import { objectBounds } from './layout';
import { projectSceneData } from '../../document/src/scenes';
import { matrix, multiply } from './affine';

export function symbolInstance(definition: SymbolDefinition, x: number, y: number): Vector {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid symbol placement.');
  return {
    id: id(),
    kind: 'symbol',
    symbolId: definition.id,
    ...(definition.defaultPlayback==='movie'?{symbolPlayback:{mode:'movie' as const,firstFrame:0}}:{}),
    x,
    y,
    width: definition.width,
    height: definition.height,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
}
export function symbolFrame(
  definition: SymbolDefinition,
  frame: number,
  playback?: Vector['symbolPlayback'],
): Vector[] {
  return symbolExposures(definition, frame, playback).flatMap((e) => e.shapes);
}
export function symbolLocalFrame(duration: number, frame: number, playback?: Vector['symbolPlayback']) {
  const start = Math.min(playback?.firstFrame ?? 0, duration - 1);
  const elapsed = Math.max(0, Math.floor(frame));
  return playback?.mode === 'single'
    ? start
    : playback?.mode === 'once'
      ? Math.min(start + elapsed, duration - 1)
      : (start + elapsed) % duration;
}
export function symbolExposures(
  definition: SymbolDefinition,
  frame: number,
  playback?: Vector['symbolPlayback'],
) {
  if (!definition.timeline) return definition.baseLayer?.visible===false ? [] : [{ shapes: definition.shapes, age: 0, layerId: '@base' }];
  const f = symbolLocalFrame(definition.timeline.duration, frame, playback);
  return symbolLayers(definition)
    .filter((l) => l.visible)
    .map((layer) => {
      const key = keyAt(layer, f);
      return { shapes: key.shapes, age: f - key.frame, layerId: layer.id };
    });
}
export function hasInstanceBlur(project: Pick<Project,'layers'|'symbols'>) {
  const filtered=(shape:Vector)=>!!shape.groupBlur || (shape.kind==='symbol' && !!(shape.instanceBlur || shape.instanceBlend || shape.instanceTint?.amount));
  return project.layers.some(layer=>layer.keys.some(key=>key.shapes.some(filtered))) ||
    (project.symbols??[]).some(def=>symbolArtworks(def).some(art=>art.some(filtered)));
}
export type SymbolPaintItem = Vector | {
  kind: 'masked-symbol';
  drawingGroup?: true;
  blendMode?: Vector['instanceBlend'];
  tint?: Vector['instanceTint'];
  blurRadius?: number;
  opacity: number;
  masks: NonNullable<Project['layerMasks']>;
  layers: { id: string; visible: boolean; items: SymbolPaintItem[] }[];
};

// A group is a contiguous run in the original paint order. Only combine members
// carrying the same effect and ancestry. The vectors stay available to hit testing.
export function groupDrawingPaint(items: SymbolPaintItem[]): SymbolPaintItem[] {
  if (!items.some(item => item.kind !== 'masked-symbol' && item.groupBlur)) return items;
  const output: SymbolPaintItem[] = [];
  let previous: Vector['groupBlur'], members: SymbolPaintItem[] = [];
  for (const item of items) {
    const effect = item.kind !== 'masked-symbol' && item.groupBlur && (item.groupBlur.radius || item.groupBlur.blendMode || item.groupBlur.tint?.amount) && item.groups?.includes(item.groupBlur.group)
      ? item.groupBlur : undefined;
    if (!effect) output.push(item);
    else {
      if (effect.group !== previous?.group || effect.radius !== previous.radius || effect.blendMode !== previous.blendMode ||
          effect.tint?.amount !== previous.tint?.amount || effect.tint?.color !== previous.tint?.color) {
        members = [];
        output.push({kind:'masked-symbol', drawingGroup:true, opacity:1, blurRadius:effect.radius, blendMode:effect.blendMode, tint:effect.tint?.amount?effect.tint:undefined, masks:[],
          layers:[{id:'drawing-group',visible:true,items:members}]});
      }
      members.push(item);
    }
    previous = effect;
  }
  return output;
}

export function expandSymbols(
  project: Pick<Project, 'symbols'>,
  shapes: Vector[],
  frame = 0,
  movieFrame?: (shape: Vector, buttonOwner?: string) => number,
  preserveMovie?: (shape: Vector) => boolean,
  preserveSymbol?: (shape: Vector, frame: number) => boolean,
  paintItems?: SymbolPaintItem[],
  buttonFrame?: (shape: Vector, container?: SymbolPaintItem[]) => number | undefined,
): Vector[] {
  const definitions = new Map((project.symbols ?? []).map((s) => [s.id, s]));
  const result: Vector[] = [];
  let visited = 0;
  function expand(shapes: Vector[], frame: number, ancestry: string[], items?: SymbolPaintItem[], buttonOwner?: string) {
    for (const source of shapes) {
      if (++visited > 800000) throw new Error('Expanded symbol artwork exceeds the frame limit.');
      if (source.kind !== 'symbol') {
        result.push(source);
        items?.push(source);
        continue;
      }
      if (source.symbolPlayback?.mode === 'movie' && preserveMovie?.(source)) {
        result.push(source);
        items?.push(source);
        continue;
      }
      const definition = definitions.get(source.symbolId!);
      if (!definition) throw new Error('Missing symbol definition.');
      if (ancestry.includes(definition.id) || ancestry.length >= 8)
        throw new Error('Nested symbol cycle or depth limit.');
      if (preserveSymbol?.(source, frame)) {
        result.push(source);
        items?.push(source);
        continue;
      }
      const mapped = definition.buttonStates && buttonFrame?.(source, items);
      const exposures = symbolExposures(
        definition,
        source.symbolPlayback?.mode === 'movie' ? (movieFrame?.(source, buttonOwner) ?? 0) : frame,
        mapped === undefined ? source.symbolPlayback : { mode: 'single', firstFrame: mapped },
      );
      const masks = items && definition.timeline?.layerMasks;
      const blurRadius=items && !definition.buttonStates ? source.instanceBlur : undefined;
      const blendMode=items && !definition.buttonStates ? source.instanceBlend : undefined;
      const tint=items && !definition.buttonStates && source.instanceTint?.amount ? source.instanceTint : undefined;
      const paintedLayers = masks?.length || blurRadius || blendMode || tint ? symbolLayers(definition).map(layer => ({
        id: layer.id, visible: layer.visible, items: [] as SymbolPaintItem[],
      })) : undefined;
      if (paintedLayers) items!.push({ kind: 'masked-symbol', opacity: source.opacity ?? 1, masks:masks??[], ...(blurRadius?{blurRadius}:{}), ...(blendMode?{blendMode}:{}), ...(tint?{tint}:{}), layers: paintedLayers });
      for (const exposure of exposures) {
        const layerItems = paintedLayers?.find(l => l.id === exposure.layerId)?.items ?? items;
        const prefix = source.id + (exposure.layerId === '@base' ? '' : '/' + exposure.layerId);
        const artwork = exposure.shapes;
        if (result.length + artwork.length > 100000)
          throw new Error('Expanded symbol artwork exceeds the frame limit.');
        for (const original of artwork) {
          const child = clone(original),
            m = multiply(
              multiply(matrix(source), [
                definition.width ? source.width / definition.width : 1,
                0,
                0,
                definition.height ? source.height / definition.height : 1,
                0,
                0,
              ]),
              matrix(child),
            );
          child.id = prefix + '/' + child.id;
          child.x = m[4];
          child.y = m[5];
          child.rotation = 0;
          child.transform = [m[0], m[1], m[2], m[3]];
          child.opacity = (child.opacity ?? 1) * (paintedLayers ? 1 : source.opacity ?? 1);
          if(child.groupBlur)child.groupBlur.group=prefix+'/'+child.groupBlur.group;
          child.groups = [
            ...(source.groups ?? []),
            ...(child.groups ?? []).map((g) => prefix + '/' + g),
          ];
          if (child.kind === 'symbol') {
            expand([child], exposure.age, [...ancestry, definition.id], layerItems, mapped === undefined ? buttonOwner : source.id);
          } else {
            result.push(child);
            layerItems?.push(child);
          }
        }
      }
    }
  }
  expand(shapes, frame, [], paintItems);
  return result;
}
/** Flatten fixed graphic poses; retain movie and animated-parent boundaries. */
export function expandStaticButtonContainers(project: Project, shapes: Vector[]): Vector[] {
  const definitions = new Map(project.symbols?.map((d) => [d.id, d]));
  return shapes.flatMap((source) => {
    const definition = definitions.get(source.symbolId!);
    if (
      source.kind !== 'symbol' ||
      !definition ||
      definition.buttonStates ||
      ((definition.timeline?.duration ?? 1) > 1 && source.symbolPlayback?.mode !== 'single') ||
      source.symbolPlayback?.mode === 'movie'
    )
      return [source];
    const ages = new Map<string, number>();
    return expandSymbols(project, [source], 0, undefined, undefined, (child, age) => {
      ages.set(child.id, age);
      const d = definitions.get(child.symbolId!);
      return (
        !!d?.buttonStates ||
        ((d?.timeline?.duration ?? 1) > 1 && child.symbolPlayback?.mode !== 'single') ||
        child.symbolPlayback?.mode === 'movie'
      );
    }).map((child) => {
      const d = definitions.get(child.symbolId!);
      // Detaching a fixed pose must retain the exposure age supplied to graphic children.
      const duration = d?.timeline?.duration ?? 1;
      const first = Math.min(child.symbolPlayback?.firstFrame ?? 0, duration - 1);
      const elapsed = Math.max(0, Math.floor(ages.get(child.id) ?? 0));
      if (
        child.kind === 'symbol' &&
        d?.timeline &&
        !d.buttonStates &&
        child.symbolPlayback?.mode !== 'movie'
      )
        return {
          ...child,
          symbolPlayback: {
            mode: 'single' as const,
            firstFrame:
              child.symbolPlayback?.mode === 'single'
                ? first
                : child.symbolPlayback?.mode === 'once'
                  ? Math.min(first + elapsed, duration - 1)
                  : (first + elapsed) % duration,
          },
        };
      return child;
    });
  });
}

export function convertToSymbol(
  project: Project,
  layerId: string,
  frame: number,
  selected: string[],
  name: string,
): Vector {
  const layer = project.layers.find((l) => l.id === layerId),
    label = name.trim();
  if (!layer || layer.locked || !layer.visible || layer.drawingMode === 'merge')
    throw new Error('Choose a visible unlocked object layer.');
  if (!label || label.length > 200 || (project.symbols?.length ?? 0) >= 128)
    throw new Error('Enter a symbol name (up to 200 characters); library limit is 128.');
  const key = keyAt(layer, frame),
    shapes = key.shapes,
    ids = new Set(selected),
    chosen = shapes.filter((s) => ids.has(s.id));
  if (!chosen.length || chosen.length !== ids.size)
    throw new Error('Select artwork on this layer and frame.');
  const groups = new Set(chosen.flatMap((s) => s.groups ?? []));
  if (shapes.some((s) => !ids.has(s.id) && s.groups?.some((g) => groups.has(g))))
    throw new Error('Select complete groups before creating a symbol.');
  const first = shapes.findIndex((s) => ids.has(s.id));
  if (shapes.slice(first, first + chosen.length).some((s) => !ids.has(s.id)))
    throw new Error('Select consecutive artwork in the paint stack.');
  if (
    (project.symbols ?? []).reduce(
      (sum, s) => sum + symbolArtworks(s).reduce((n, art) => n + art.length, 0),
      0,
    ) +
      chosen.length >
    MAX_SYMBOL_ARTWORK
  )
    throw new Error('Symbol artwork budget exceeded.');
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const shape of chosen) {
    const bounds = objectBounds(shape);
    x = Math.min(x, bounds.left);
    y = Math.min(y, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  }
  const definition: SymbolDefinition = {
    id: id(),
    name: label,
    width: right - x,
    height: bottom - y,
    shapes: clone(chosen),
  };
  definition.shapes.forEach((s) => {
    s.x -= x;
    s.y -= y;
  });
  const library = project.symbols ?? [];
  const symbols = [...library, definition];
  const children = chosen.filter((shape) => shape.kind === 'symbol');
  if (children.length) {
    const definitions = new Map(library.map((symbol) => [symbol.id, symbol]));
    let longestGraphic = 1;
    for (const child of children) {
      const referenced = definitions.get(child.symbolId!);
      if (!referenced) throw new Error('Missing symbol definition.');
      if (!referenced.buttonStates && child.symbolPlayback?.mode !== 'single' && child.symbolPlayback?.mode !== 'movie')
        longestGraphic = Math.max(longestGraphic, referenced.timeline?.duration ?? 1);
    }
    // A static definition sends age zero to graphic children. Keep the original
    // hold on the new timeline so their authored playback advances as before.
    if (longestGraphic > 1) {
      const end = layer.keys.find((candidate) => candidate.frame > key.frame)?.frame ?? project.duration;
      definition.timeline = { duration: Math.min(10000, Math.max(longestGraphic, end - key.frame)), keys: [] };
    }
    // Check the extra dependency boundary before changing the caller's artwork.
    validateProject({ ...project, symbols });
  }
  const instance = symbolInstance(definition, x, y);
  instance.symbolPlayback = { mode: 'loop', firstFrame: 0 };
  project.symbols = symbols;
  shapes.splice(first, chosen.length, instance);
  return instance;
}
export function symbolUsed(project: Project, symbolId: string): boolean {
  return (
    Array.from(projectSceneData(project)).some(scene => scene.layers.some(l =>
      l.keys.some(k => k.shapes.some(s => s.symbolId === symbolId)))) ||
    (project.symbols ?? []).some((d) =>
      symbolArtworks(d).some((art) => art.some((s) => s.symbolId === symbolId)),
    )
  );
}
export function duplicateSymbol(project: Project, symbolId: string): SymbolDefinition {
  const source = project.symbols?.find((s) => s.id === symbolId);
  if (!source) throw new Error('Missing symbol definition.');
  const definition = clone(source);
  definition.id = id();
  definition.name = source.name.slice(0, 195) + ' copy';
  const symbols = [...(project.symbols ?? []), definition];
  validateProject({ ...project, symbols });
  project.symbols = symbols;
  return definition;
}
export function makeSymbolUnique(
  project: Project,
  layerId: string,
  frame: number,
  instanceId: string,
): void {
  const layer = project.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked || !layer.visible || layer.drawingMode === 'merge')
    throw new Error('Choose a visible unlocked object layer.');
  const instance = keyAt(layer, frame).shapes.find((s) => s.id === instanceId);
  if (instance?.kind !== 'symbol') throw new Error('Select a symbol instance.');
  const definition = duplicateSymbol(project, instance.symbolId!);
  instance.symbolId = definition.id;
}
// Replacement retains each instance's placement and box; its new artwork fits that box.
export function replaceSymbolArtwork(
  project: Project,
  symbolId: string,
  layerId: string,
  frame: number,
  selected: string[],
): void {
  const source = project.symbols?.find((s) => s.id === symbolId);
  if (!source) throw new Error('Missing symbol definition.');
  if (source.timeline) throw new Error('Edit animated artwork through the symbol timeline.');
  const draft = clone(project);
  const layer = draft.layers.find((candidate) => candidate.id === layerId);
  if (layer && !layer.locked && layer.visible && layer.drawingMode !== 'merge') {
    const ids = new Set(selected);
    if (keyAt(layer, frame).shapes.some((shape) => ids.has(shape.id) && shape.kind === 'symbol'))
      throw new Error('Replace nested symbols through the symbol artwork editor.');
  }
  // Reuse selection/group/stack checks on a detached project, without consuming a library slot.
  draft.symbols = [];
  const instance = convertToSymbol(draft, layerId, frame, selected, source.name);
  const replacement = draft.symbols!.find((s) => s.id === instance.symbolId)!;
  if (!replacement.width || !replacement.height || !source.width || !source.height)
    throw new Error('Replacement artwork and symbol must have nonzero width and height.');
  replacement.id = source.id;
  if (source.buttonStates) replacement.buttonStates = clone(source.buttonStates);
  if (source.multiFramePivot) replacement.multiFramePivot = clone(source.multiFramePivot);
  if (source.baseLayer) replacement.baseLayer = clone(source.baseLayer);
  if (source.openMotionTween) replacement.openMotionTween = clone(source.openMotionTween);
  const symbols = project.symbols!.map((s) => (s.id === source.id ? replacement : s));
  validateProject({ ...project, symbols });
  project.symbols = symbols;
}
export function breakSymbol(project: Project, instance: Vector, frame = 0): Vector[] {
  if (instance.kind !== 'symbol') throw new Error('Select a symbol instance.');
  const parts = expandSymbols(project, [instance], frame),
    groups = new Map<string, string>();
  return parts.map((s) => ({
    ...s,
    id: id(),
    groups: s.groups?.map((g) => {
      if (!groups.has(g)) groups.set(g, id());
      return groups.get(g)!;
    }),
  }));
}

/** Edit in definition coordinates; retain registration and every instance's mapping. */
export function updateSymbolArtwork(project: Project, symbolId: string, artwork: Vector[]): void {
  const definition = project.symbols?.find((s) => s.id === symbolId);
  if (!definition) throw new Error('Missing symbol definition.');
  const replacement = { ...definition, shapes: clone(artwork) };
  const symbols = project.symbols!.map((s) => (s.id === symbolId ? replacement : s));
  validateProject({ ...project, symbols });
  project.symbols = symbols;
}
export function updateSymbolTimeline(
  project: Project,
  symbolId: string,
  definition: SymbolDefinition,
): void {
  updateSymbolTimelines(project, [[symbolId, definition]]);
}

export function updateSymbolTimelines(project: Project, edits: readonly (readonly [string, SymbolDefinition])[]): void {
  if (!edits.length) return;
  const replacements = new Map<string, SymbolDefinition>();
  for (const [id, definition] of edits) {
    const existing = project.symbols?.find(symbol => symbol.id === id);
    if (!existing) throw new Error('Missing symbol definition.');
    if (replacements.has(id)) throw new Error('Duplicate symbol definition edit.');
    const replacement = {
      ...existing,
      shapes: clone(definition.shapes),
      ...(definition.baseLayer ? { baseLayer: clone(definition.baseLayer) } : {}),
      multiFramePivot: definition.multiFramePivot ? clone(definition.multiFramePivot) : undefined,
      buttonStates: definition.buttonStates ? clone(definition.buttonStates) : undefined,
      timeline: definition.timeline ? clone(definition.timeline) : undefined,
    };
    if (definition.openMotionTween) replacement.openMotionTween = clone(definition.openMotionTween);
    else delete replacement.openMotionTween;
    replacements.set(id, replacement);
  }
  const symbols = (project.symbols ?? []).map(symbol => replacements.get(symbol.id) ?? symbol);
  validateProject({ ...project, symbols });
  project.symbols = symbols;
}
