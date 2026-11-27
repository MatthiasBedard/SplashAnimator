import type { BasicMotionSpan, Layer, Project } from '@splash/document';
import { createMotionFrameSampler } from './motion-frames';

export function sameMotionArtwork(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b))
    );
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((key) => Object.hasOwn(y, key) && sameMotionArtwork(x[key], y[key]))
  );
}

export function motionInteriorBaseline(keys: Project['layers'][number]['keys']): string {
  return JSON.stringify(keys, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Generated artwork contains a non-finite original value.');
    return value;
  });
}

export function requireOwnedMotionInterior(layer: Pick<Layer, 'keys'>, span: BasicMotionSpan) {
  const { start, end } = span;
  const generated = layer.keys.filter((key) => key.frame > start && key.frame < end);
  // Generated spans own every integer interior frame, in order. Do not accept a
  // rewritten baseline for sparse or duplicated keys as an evaluable span.
  if (
    generated.length !== end - start - 1 ||
    generated.some((key, index) => key.frame !== start + index + 1) ||
    motionInteriorBaseline(generated) !== span.baseline
  )
    throw new Error('Generated keys changed; detach the span to preserve those edits.');
  return generated;
}

export function checkMotionReconstruction(
  project: Pick<Project, 'layers' | 'duration' | 'symbols'>,
  layer: Project['layers'][number],
  span: BasicMotionSpan,
  generated: typeof layer.keys,
  message: string,
) {
  const sampler = createMotionFrameSampler({ ...project, layers: [layer] }, layer.id, span);
  try {
    for (const key of generated)
      if (!sameMotionArtwork(sampler.sample(key.frame), key.shapes)) throw new Error(message);
  } finally {
    sampler.dispose();
  }
}
