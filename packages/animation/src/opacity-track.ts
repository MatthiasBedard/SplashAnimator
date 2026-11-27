import { captureOpacityKeys, type OpacityKey } from '../../document/src/opacity-bindings';
export type { OpacityKey } from '../../document/src/opacity-bindings';
import { motionProgress } from './motion-frames';

/** Capture a single opacity channel, independent of artwork exposures.
 * Samples are absolute opacity values; the caller owns target/lifetime mapping.
 * Missing tracks belong to the caller. An explicitly empty track is invalid.
 */
export function createOpacityTrackSampler(keys: readonly OpacityKey[], duration: number) {
  const captured = captureOpacityKeys(keys, duration);
  return (frame: number) => sampleCapturedOpacity(captured, duration, frame);
}

/** Internal evaluation of a validated, detached channel. */
export function sampleCapturedOpacity(
  captured: readonly Required<OpacityKey>[],
  duration: number,
  frame: number,
): number {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= duration)
    throw new Error('Choose an integer opacity sample frame inside the timeline.');
  return interpolateOpacityKeys(captured,frame,motionProgress);
}

/** Standalone interpolation for validated, ordered keys at a valid root frame. */
export function interpolateOpacityKeys(captured:readonly OpacityKey[],frame:number,progress:typeof motionProgress):number {
  const first = captured[0],
    last = captured[captured.length - 1];
  if (frame <= first.frame) return first.opacity;
  if (frame >= last.frame) return last.opacity;
  let lo = 0,
    hi = captured.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (captured[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = captured[lo],
    b = captured[hi];
  if (frame === a.frame || a.ease === 'hold' || a.opacity === b.opacity) return a.opacity;
  const t = progress((frame - a.frame) / (b.frame - a.frame), a.ease ?? 'linear');
  // Use the nearer endpoint to avoid cancellation near the low end of a fade.
  const value =
    t <= 0.5
      ? a.opacity + (b.opacity - a.opacity) * t
      : b.opacity + (a.opacity - b.opacity) * (1 - t);
  if (!Number.isFinite(value))
    throw new Error('Opacity interpolation produced a non-finite value.');
  return Math.max(Math.min(a.opacity, b.opacity), Math.min(Math.max(a.opacity, b.opacity), value));
}
