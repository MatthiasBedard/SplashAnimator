import { validateProject, type Project } from '../../../packages/document/src';
import { createUpButtonPlayback } from '../../../packages/animation/src/up-button-playback';
import { createMovieTreeClock } from '../../../packages/animation/src/movie-tree-clock';
import { createStageOpacityView } from '../../../packages/animation/src/stage-opacity';
import {
  detachPresentationData,
  type LayerPresentation,
} from '../../../packages/animation/src/layer-presentation';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';

export type MaskSessionFrame = Readonly<{
  tick: number;
  frame: number;
  seconds: number;
  position: number;
  presentation: LayerPresentation;
}>;

/** An owned, script-free, explicitly stepped preview. No timers, DOM resources,
 * authored edits or borrowed Test Movie clocks. Same-tick retries reuse the exact
 * successful pose; a failed synchronous clock phase requires explicit Restart. */
export function createMaskPreviewSession(
  project: Project,
  start: number,
  options: { validate?: () => void } = {},
) {
  const stamp = selectionTrajectoryStamp(project);
  validateProject(project);
  if (!Number.isSafeInteger(start) || start < 0 || start >= project.duration)
    throw Error('Choose an exact starting mask frame.');
  let external = options.validate;
  if (external !== undefined && typeof external !== 'function')
    throw Error('Invalid mask session validation.');
  let original: Project | undefined = project,
    runtime: Project | undefined;
  let upButtons: ReturnType<typeof createUpButtonPlayback> | undefined;
  let opacity: ReturnType<typeof createStageOpacityView> | undefined;
  const movies = createMovieTreeClock();
  let cached: MaskSessionFrame | undefined,
    tick = 0,
    disposed = false,
    invalid = false,
    busy = false;
  function check() {
    if (disposed || !original) throw Error('Mask presentation session closed.');
    const result = external?.() as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw Error('Mask session validation must be synchronous.');
    }
    if (selectionTrajectoryStamp(original) !== stamp)
      throw Error('Mask presentation source changed. Reopen the preview.');
    if (busy && invalid) throw Error('Mask session reentered. Restart the session.');
  }
  check();
  runtime = detachPresentationData(project);
  check();
  upButtons = createUpButtonPlayback(runtime, true);
  opacity = createStageOpacityView(runtime);
  check();

  function sample(next: number): MaskSessionFrame {
    const source = runtime!,
      position = start + next,
      seconds = next / source.fps;
    if (
      !Number.isSafeInteger(next) ||
      next < 0 ||
      !Number.isSafeInteger(position) ||
      !Number.isFinite(seconds)
    )
      throw Error('Mask presentation time exceeds the exact tick range.');
    const frame = position % source.duration;
    const frames = movies.sample(source, frame, seconds, position),
      origins = movies.origins();
    const { snapshot, artwork, stateFrames } = upButtons!(frame, position, seconds, frames, origins, opacity);
    // Opacity changes placement alpha, so its private poses replace the original
    // artwork bank while reusing the exact same state clock values/origins.
    const presentation = snapshot.presentation(artwork, stateFrames);
    check();
    if (invalid) throw Error('Mask session reentered. Restart the session.');
    return Object.freeze({ tick: next, frame, seconds, position, presentation });
  }
  function operate(action: 'current' | 'step' | 'restart') {
    if (busy) {
      invalid = true;
      throw Error('Mask session cannot reenter.');
    }
    if (disposed) throw Error('Mask presentation session closed.');
    if (invalid && action !== 'restart')
      throw Error('Restart the mask session after a failed clock phase.');
    busy = true;
    try {
      if (action === 'restart') invalid = false;
      check();
      if (action === 'restart') {
        movies.reset();
        cached = undefined;
        tick = 0;
        upButtons = createUpButtonPlayback(runtime!, true);
      }
      if (!cached) cached = sample(tick);
      if (action === 'step') {
        const next = sample(tick + 1);
        tick = next.tick;
        cached = next;
      }
      check();
      if (invalid) throw Error('Mask session reentered. Restart the session.');
      return cached;
    } catch (cause) {
      invalid = true;
      throw cause;
    } finally {
      busy = false;
    }
  }
  return {
    current: () => operate('current'),
    step: () => operate('step'),
    restart: () => operate('restart'),
    dispose() {
      disposed = true;
      invalid = true;
      cached = undefined;
      runtime = undefined;
      upButtons = undefined;
      opacity = undefined;
      original = undefined;
      external = undefined;
      movies.reset();
    },
  };
}
