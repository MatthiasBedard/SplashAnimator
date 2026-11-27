import {
  clone,
  keyAt,
  symbolLayers,
  type SymbolDefinition,
  type Project,
  type Vector,
} from '../../document/src';
import { matrix, multiply, transformVectors, type Matrix } from './affine';
import { expandSymbols } from './symbols';
export type SymbolEditContext = {
  initialFrame: number;
  artworkFrame: number;
  matrix: Matrix;
  under: Vector[];
  over: Vector[];
  underOutline?: (string | null)[];
  overOutline?: (string | null)[];
  referenceLayers?: {
    root: string;
    under: (string | null)[];
    over: (string | null)[];
  };
  width: number;
  height: number;
  background: string;
  opacity: number;
};
/** Snapshot a root instance and its surrounding visible stage paint. */
export function symbolEditContext(
  project: Project,
  layerId: string,
  instanceId: string,
  frame: number,
): SymbolEditContext {
  const layer = project.layers.find((l) => l.id === layerId);
  const instance = layer && keyAt(layer, frame).shapes.find((s) => s.id === instanceId);
  const definition = project.symbols?.find((d) => d.id === instance?.symbolId);
  if (!layer?.visible || layer.locked || instance?.kind !== 'symbol' || !definition)
    throw new Error('Choose a symbol instance on an editable visible layer.');
  const under: Vector[] = [],
    over: Vector[] = [];
  const underOutline: (string | null)[] = [],
    overOutline: (string | null)[] = [];
  const referenceLayers: SymbolEditContext['referenceLayers'] = project.layerMasks?.length
    ? { root: layerId, under: [], over: [] }
    : undefined;
  let passed = false;
  for (const l of project.layers.filter((l) => l.visible)) {
    const key = keyAt(l, frame);
    for (const s of key.shapes) {
      if (l.id === layerId && s.id === instanceId) {
        passed = true;
        continue;
      }
      const expanded = expandSymbols(project, [s], frame - key.frame);
      (passed ? over : under).push(...expanded);
      (passed ? overOutline : underOutline).push(
        ...expanded.map(() => (l.outline ? (l.outlineColor ?? '#00a6b8') : null)),
      );
      if (referenceLayers) {
        const owners = passed ? referenceLayers.over : referenceLayers.under;
        for (let i = 0; i < expanded.length; i++) owners.push(l.id);
      }
    }
  }
  const duration = definition.timeline?.duration ?? 1;
  const start = Math.min(instance.symbolPlayback?.firstFrame ?? 0, duration - 1);
  const elapsed =
    instance.symbolPlayback?.mode === 'movie'
      ? 0
      : Math.max(0, Math.floor(frame) - keyAt(layer, frame).frame);
  const initialFrame =
    instance.symbolPlayback?.mode === 'single'
      ? start
      : instance.symbolPlayback?.mode === 'once'
        ? Math.min(start + elapsed, duration - 1)
        : (start + elapsed) % duration;
  return clone({
    initialFrame: definition.buttonStates?.up ?? initialFrame,
    artworkFrame: 0,
    matrix: multiply(matrix(instance), [
      instance.width / definition.width,
      0,
      0,
      instance.height / definition.height,
      0,
      0,
    ]),
    under,
    over,
    underOutline,
    overOutline,
    ...(referenceLayers ? { referenceLayers } : {}),
    width: project.width,
    height: project.height,
    background: project.background,
    opacity: instance.opacity ?? 1,
  });
}

function extendReferenceLayers(context: SymbolEditContext, under: Vector[], over: Vector[]) {
  const refs = context.referenceLayers;
  return refs ? {
    referenceLayers: {
      root: refs.root,
      under: [...refs.under, ...under.map(() => null)],
      over: [...over.map(() => null), ...refs.over],
    },
  } : {};
}

/** Show the other local tracks in stage space around the editable track. */
export function symbolTrackEditContext(
  context: SymbolEditContext,
  definition: SymbolDefinition,
  layerId: string,
  frame: number,
  symbols: SymbolDefinition[],
): SymbolEditContext {
  const under: Vector[] = [],
    over: Vector[] = [];
  const underOutline: (string | null)[] = [],
    overOutline: (string | null)[] = [];
  let passed = false;
  for (const layer of symbolLayers(definition)) {
    if (layer.id === layerId) {
      passed = true;
      continue;
    }
    if (!layer.visible) continue;
    const key = keyAt(layer, frame);
    const shapes = clone(expandSymbols({ symbols }, key.shapes, frame - key.frame));
    transformVectors(shapes, context.matrix);
    shapes.forEach((s) => {
      s.opacity = (s.opacity ?? 1) * context.opacity;
    });
    (passed ? over : under).push(...shapes);
    (passed ? overOutline : underOutline).push(
      ...shapes.map(() => (layer.outline ? (layer.outlineColor ?? '#00a6b8') : null)),
    );
  }
  return {
    ...context,
    artworkFrame:
      frame -
      keyAt(
        symbolLayers(definition).find((l) => l.id === layerId)!,
        frame,
      ).frame,
    under: [...context.under, ...under],
    over: [...over, ...context.over],
    underOutline: [...(context.underOutline ?? context.under.map(() => null)), ...underOutline],
    overOutline: [...overOutline, ...(context.overOutline ?? context.over.map(() => null))],
    ...extendReferenceLayers(context, under, over),
  };
}

/** Navigate from clean static artwork or a timeline track into a nested instance in stage space. */
export function nestedSymbolEditContext(
  context: SymbolEditContext,
  parent: SymbolDefinition,
  instanceId: string,
  symbols: SymbolDefinition[],
  location?: { layerId: string; frame: number },
): SymbolEditContext {
  if (location) {
    const layer = symbolLayers(parent).find((l) => l.id === location.layerId);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose an editable symbol track.');
    if (
      !Number.isInteger(location.frame) ||
      location.frame < 0 ||
      location.frame >= (parent.timeline?.duration ?? 1)
    )
      throw new Error('Choose a frame inside the symbol timeline.');
    const local = symbolTrackEditContext(
      context,
      parent,
      location.layerId,
      location.frame,
      symbols,
    );
    return nestedSymbolEditContext(
      local,
      { ...parent, timeline: undefined, shapes: keyAt(layer, location.frame).shapes },
      instanceId,
      symbols,
    );
  }
  if (parent.timeline) throw new Error('Apply timeline edits before navigating from the stage.');
  const instance = parent.shapes.find((s) => s.id === instanceId);
  const definition = symbols.find((d) => d.id === instance?.symbolId);
  if (instance?.kind !== 'symbol' || !definition)
    throw new Error('Choose a nested symbol instance.');
  const under: Vector[] = [],
    over: Vector[] = [];
  const underOutline: (string | null)[] = [],
    overOutline: (string | null)[] = [];
  let passed = false;
  for (const s of parent.shapes) {
    if (s.id === instanceId) {
      passed = true;
      continue;
    }
    const shapes = clone(expandSymbols({ symbols }, [s], context.artworkFrame));
    transformVectors(shapes, context.matrix);
    shapes.forEach((s) => {
      s.opacity = (s.opacity ?? 1) * context.opacity;
    });
    (passed ? over : under).push(...shapes);
    (passed ? overOutline : underOutline).push(...shapes.map(() => null));
  }
  const duration = definition.timeline?.duration ?? 1,
    start = Math.min(instance.symbolPlayback?.firstFrame ?? 0, duration - 1);
  const elapsed = instance.symbolPlayback?.mode === 'movie' ? 0 : context.artworkFrame;
  const frame =
    instance.symbolPlayback?.mode === 'single'
      ? start
      : instance.symbolPlayback?.mode === 'once'
        ? Math.min(start + elapsed, duration - 1)
        : (start + elapsed) % duration;
  return {
    ...context,
    initialFrame: definition.buttonStates?.up ?? frame,
    artworkFrame: 0,
    matrix: multiply(
      context.matrix,
      multiply(matrix(instance), [
        instance.width / definition.width,
        0,
        0,
        instance.height / definition.height,
        0,
        0,
      ]),
    ),
    opacity: context.opacity * (instance.opacity ?? 1),
    under: [...context.under, ...under],
    over: [...over, ...context.over],
    underOutline: [...(context.underOutline ?? context.under.map(() => null)), ...underOutline],
    overOutline: [...overOutline, ...(context.overOutline ?? context.over.map(() => null))],
    ...extendReferenceLayers(context, under, over),
  };
}
