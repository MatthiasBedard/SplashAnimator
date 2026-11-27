import type { Vector } from '@splash/document';

/** Opacity has its own timing channel in the shared sampler. Blend is discrete
 * and inherits the source until the exact destination key. */
export function sampleSymbolEffects(
  result: Vector,
  from: Vector,
  to: Vector,
  progress: number,
  mixColor: (from: string, to: string, progress: number) => string,
) {
  const mix = (a: number, b: number) => a + (b - a) * progress;
  if (from.instanceBlur !== undefined || to.instanceBlur !== undefined) {
    const radius = Math.round(mix(from.instanceBlur ?? 0, to.instanceBlur ?? 0));
    if (radius) result.instanceBlur = radius;
    else delete result.instanceBlur;
  }
  const a = from.instanceTint, b = to.instanceTint;
  if (a || b) {
    result.instanceTint = {
      color: a && b && a.color !== b.color ? mixColor(a.color, b.color, progress) : (a ?? b)!.color,
      amount: mix(a?.amount ?? 0, b?.amount ?? 0),
    };
  }
}
