import type { Project, Vector } from './index';
import { validateMotionEase, type MotionEase } from './motion-ease';
/** Absolute zero-based timeline frame. Easing belongs to the outgoing segment. */
export interface OpacityKey {
  frame: number;
  opacity: number;
  ease?: MotionEase | 'hold';
}

/** Inclusive absolute frames. Property key times must be inside this interval. */
export interface RootOpacityBinding {
  layerId: string;
  shapeId: string;
  start: number;
  end: number;
  keys: readonly OpacityKey[];
}

type Plan = {
  start: number;
  end: number;
  kind: Vector['kind'];
  symbolId?: string;
  keys: Required<OpacityKey>[];
};

export function captureOpacityKeys(keys: readonly OpacityKey[], duration: number) {
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 100000)
    throw new Error('Invalid opacity track duration.');
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > duration)
    throw new Error('An opacity track needs one or more distinct frames within its duration.');

  const captured: Required<OpacityKey>[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (
      !Object.prototype.hasOwnProperty.call(keys, i) ||
      !keys[i] ||
      typeof keys[i] !== 'object' ||
      Array.isArray(keys[i])
    )
      throw new Error('Invalid opacity key.');
    const { frame, opacity, ease = 'linear' } = keys[i];
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      frame >= duration ||
      (i > 0 && frame <= captured[i - 1].frame)
    )
      throw new Error(
        'Opacity key frames must be unique, increasing integers inside the timeline.',
      );
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new Error('Opacity must be a finite number between 0 and 1.');
    if (ease !== 'hold') validateMotionEase(ease);
    captured.push({ frame, opacity, ease: typeof ease === 'object' ? { ...ease } : ease });
  }

  return captured;
}

export function prepareRootOpacityBindings(
  project: Pick<Project, 'duration' | 'layers'>,
  bindings: readonly RootOpacityBinding[],
) {
  if (!Array.isArray(bindings)) throw new Error('Expected an array of opacity bindings.');
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  if (layers.size !== project.layers.length) throw new Error('Ambiguous opacity layer identity.');
  const plans = new Map<string, Map<string, Plan[]>>();
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object') throw new Error('Invalid opacity binding.');
    const { layerId, shapeId, start, end, keys } = binding,
      layer = layers.get(layerId);
    if (
      !layer ||
      typeof layerId !== 'string' ||
      !layerId ||
      typeof shapeId !== 'string' ||
      !shapeId
    )
      throw new Error('Missing opacity binding target.');
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= project.duration
    )
      throw new Error('Invalid opacity binding interval.');
    const captured = captureOpacityKeys(keys, project.duration);
    if (keys[0].frame < start || keys[keys.length - 1].frame > end)
      throw new Error('Opacity keys must lie inside their binding interval.');
    let byShape = plans.get(layerId);
    if (!byShape) {
      if (!layer.keys.length || layer.keys[0].frame !== 0)
        throw new Error('Missing initial artwork exposure.');
      for (let i = 0; i < layer.keys.length; i++) {
        const f = layer.keys[i].frame;
        if (
          !Number.isSafeInteger(f) ||
          f < 0 ||
          f >= project.duration ||
          (i > 0 && f <= layer.keys[i - 1].frame)
        )
          throw new Error('Invalid artwork exposure ordering.');
      }
      byShape = new Map();
      plans.set(layerId, byShape);
    }
    let origin: Vector | undefined;
    for (let i = 0; i < layer.keys.length; i++) {
      const key = layer.keys[i];
      if (key.frame > end) break;
      if ((layer.keys[i + 1]?.frame ?? project.duration) <= start) continue;
      const matches = key.shapes.filter((shape) => shape.id === shapeId);
      if (matches.length !== 1)
        throw new Error('Opacity target must exist uniquely throughout its interval.');
      const shape = matches[0];
      if (origin && (origin.kind !== shape.kind || origin.symbolId !== shape.symbolId))
        throw new Error('Opacity target changes identity inside its interval.');
      origin = shape;
    }
    if (!origin) throw new Error('Opacity interval has no artwork.');
    const list = byShape.get(shapeId) ?? [];
    list.push({ start, end, kind: origin.kind, symbolId: origin.symbolId, keys: captured });
    byShape.set(shapeId, list);
  }
  for (const byShape of plans.values())
    for (const list of byShape.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++)
        if (list[i].start <= list[i - 1].end)
          throw new Error('Opacity bindings overlap on the same artwork.');
    }
  return plans;
}
