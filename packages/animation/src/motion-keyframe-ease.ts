import type { MotionEase } from '../../document/src/motion-ease';
import { splitSimpleMotionEase } from './motion-spans';

/** Ordinary keyframe insertion reauthors the adjacent segments. Prefer exact
 * timing restriction; otherwise retain the saved easing on each new segment.
 * Dedicated preserved-split commands keep their existing rejection behavior. */
export function keyframeSplitEases(
  ease: MotionEase,
  fraction: number,
  reauthor: boolean,
): [MotionEase, MotionEase] {
  if (!reauthor) return splitSimpleMotionEase(ease, fraction);
  try {
    return splitSimpleMotionEase(ease, fraction);
  } catch {
    return [structuredClone(ease), structuredClone(ease)];
  }
}
