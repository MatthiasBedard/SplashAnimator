import { expandSymbols } from '../../geometry/src/symbols';
import {
  keyAt,
  symbolLayers,
  type SymbolDefinition,
  type Layer,
  type Project,
  type Vector,
} from '@splash/document';
/** Sorted key arrays permit bounded lookup without copying/reversing every exposure. */
function differentExposure(layers: Layer[], frame: number) {
  const held = (layer: Layer, at: number) => {
    let low = 0,
      high = layer.keys.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (layer.keys[middle].frame <= at) low = middle;
      else high = middle - 1;
    }
    return layer.keys[low];
  };
  const current = layers.map((layer) => held(layer, frame));
  return (at: number) => layers.some((layer, i) => held(layer, at) !== current[i]);
}
export type OnionOptions = {
  before: number;
  after: number;
  opacity: number;
  fade: boolean;
  keysOnly: boolean;
  layerId?: string;
};
/** Editor-only samples. Never modifies the document or participates in export. */
export function onionSamples(
  project: Project,
  frame: number,
  options: OnionOptions,
): { frame: number; opacity: number; shapes: Vector[] }[] {
  const bounded = (n: number, max: number) =>
    Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
  const before = bounded(options.before, 12),
    after = bounded(options.after, 12),
    opacity = Number.isFinite(options.opacity) ? Math.max(0, Math.min(0.8, options.opacity)) : 0;
  const layers = project.layers.filter(
    (l) => l.visible && (!options.layerId || l.id === options.layerId),
  );
  if (!opacity || !layers.length) return [];
  const different = differentExposure(layers, frame);
  const candidates = options.keysOnly
    ? [...new Set(layers.flatMap((l) => l.keys.map((k) => k.frame)))]
        .sort((a, b) => a - b)
        .filter(different)
    : [];
  const previous = options.keysOnly
    ? candidates
        .filter((f) => f < frame)
        .reverse()
        .slice(0, before)
    : Array.from({ length: before }, (_, i) => frame - i - 1).filter((f) => f >= 0);
  const following = options.keysOnly
    ? candidates.filter((f) => f > frame).slice(0, after)
    : Array.from({ length: after }, (_, i) => frame + i + 1).filter((f) => f < project.duration);
  const samples = (frames: number[]) =>
    frames
      .map((f, i) => ({
        frame: f,
        opacity: opacity / (options.fade ? i + 1 : 1),
        shapes: layers.flatMap((l) => {
          const key = keyAt(l, f);
          return expandSymbols(project, key.shapes, f - key.frame);
        }),
      }))
      .reverse();
  return [...samples(previous), ...samples(following)];
}

/** Symbol-local sample times, excluding the current exposure in key-only mode. */
export function symbolOnionFrames(
  definition: SymbolDefinition,
  frame: number,
  options: OnionOptions,
) {
  const duration = definition.timeline?.duration ?? 1;
  const bounded = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(5, Math.floor(n))) : 0);
  const opacity = Number.isFinite(options.opacity) ? Math.max(0, Math.min(1, options.opacity)) : 0;
  const layers = symbolLayers(definition).filter(
    (l) => l.visible && (!options.layerId || options.layerId === l.id),
  );
  if (!layers.length || !opacity) return [];
  const keys = options.keysOnly
    ? [...new Set(layers.flatMap((l) => l.keys.map((k) => k.frame)))]
        .sort((a, b) => a - b)
        .filter(differentExposure(layers, frame))
    : [];
  const before = options.keysOnly
    ? keys
        .filter((f) => f < frame)
        .reverse()
        .slice(0, bounded(options.before))
    : Array.from({ length: bounded(options.before) }, (_, i) => frame - i - 1).filter(
        (f) => f >= 0,
      );
  const after = options.keysOnly
    ? keys.filter((f) => f > frame).slice(0, bounded(options.after))
    : Array.from({ length: bounded(options.after) }, (_, i) => frame + i + 1).filter(
        (f) => f < duration,
      );
  return [before, after].flatMap((frames) =>
    frames.map((f, i) => ({ frame: f, opacity: opacity / (options.fade ? i + 1 : 1) })).reverse(),
  );
}
