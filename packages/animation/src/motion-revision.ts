import type { Project } from '../../document/src';
import { createRememberedMotionSampler } from './motion-spans';

type Timeline = Pick<Project, 'layers' | 'duration' | 'symbols' | 'opacityBindings'>;
export interface MotionRevisionSource {
  project: Timeline;
  /** Advance for every edit, undo, recovery or symbol change, including in-place edits. */
  revision: number;
}

/** One selected range owned by a live source revision. No document writes or scripts.
 * The caller owns revision advancement; this is not a mutation detector. Replacing
 * the project also invalidates the capture. Never fall back to a stale plan on failure.
 */
export function createRevisionMotionSampler(
  readSource: () => MotionRevisionSource,
  ids: readonly string[],
  start: number,
  end: number,
) {
  const selected = [...ids];
  let reader: (() => MotionRevisionSource) | undefined = readSource;
  let captured: MotionRevisionSource | undefined;
  let plan: ReturnType<typeof createRememberedMotionSampler> | undefined;
  let sampling = false;
  let generation = 0;
  function invalidate() {
    generation++;
    plan?.dispose();
    plan = undefined;
    captured = undefined;
  }
  function read(): MotionRevisionSource {
    if (!reader) throw new Error('Revision motion sampler is disposed.');
    const activeReader = reader, activeGeneration = generation;
    const value = activeReader();
    if (reader !== activeReader || generation !== activeGeneration)
      throw new Error('Motion source was invalidated while being read.');
    if (!value || !value.project || !Number.isSafeInteger(value.revision) || value.revision < 0)
      throw new Error('Motion source requires a project and a nonnegative safe integer revision.');
    // Capture the pair, not a caller-owned mutable descriptor.
    return { project: value.project, revision: value.revision };
  }
  function same(a: MotionRevisionSource, b: MotionRevisionSource) {
    return a.project === b.project && a.revision === b.revision;
  }
  return {
    sample(frame: number) {
      if (sampling) throw new Error('Motion sampling cannot reenter its source reader.');
      sampling = true;
      try {
        const source = read();
        if (!captured || !same(captured, source)) {
          invalidate();
          plan = createRememberedMotionSampler(source.project, selected, start, end);
          if (!same(source, read())) throw new Error('Motion source changed during preparation.');
          captured = source;
        }
        const result = plan!.sample(frame);
        if (!same(source, read())) throw new Error('Motion source changed during sampling.');
        return result;
      } catch (error) {
        invalidate();
        throw error;
      } finally {
        sampling = false;
      }
    },
    invalidate,
    dispose() {
      invalidate();
      reader = undefined;
    },
  };
}
