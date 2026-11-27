import type { Project } from '../../../packages/document/src';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../../../packages/animation/src/live-motion-presentation';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { captureDimensions } from '../../../packages/export-web/src';
import { captureMoviePoseClock } from '../../../packages/animation/src/movie-pose-clock';

/** One detached root pose for the existing script-free, integer-replayed PNG
 * renderer. It does not evaluate remembered children or borrow preview clocks. */
export async function prepareLivePNGFrame(
  project: Project,
  frame: number,
  scale: number,
  options: { signal?: AbortSignal; validate?: () => void } = {},
) {
  validateLiveMotionData(project);
  const original = selectionTrajectoryStamp(project);
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((k) => k !== 'signal' && k !== 'validate')
  )
    throw Error('Invalid live PNG admission.');
  const { signal, validate } = options;
  if (
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    (validate !== undefined && typeof validate !== 'function')
  )
    throw Error('Invalid live PNG admission.');
  let checking = false,
    invalid = false;
  function active() {
    if (invalid) throw Error('Live PNG capture is stale. Capture again.');
    if (checking) {
      invalid = true;
      throw Error('Live PNG admission cannot reenter.');
    }
    checking = true;
    try {
      if (signal) AbortSignal.prototype.throwIfAborted.call(signal);
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Live PNG admission must be synchronous.');
      }
      if (invalid || selectionTrajectoryStamp(project) !== original)
        throw Error('Live PNG source changed. Capture again.');
      if (signal) AbortSignal.prototype.throwIfAborted.call(signal);
    } catch (cause) {
      invalid = true;
      throw cause;
    } finally {
      checking = false;
    }
  }
  active();
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
    throw Error('Choose a frame within the existing timeline.');
  captureDimensions(project.width, project.height, scale);
  const view = await prepareLiveMotionFrameCapture(
    () => {
      active();
      return { project, revision: 0 };
    },
    frame,
    { signal, validate: active },
  );
  active();
  // The detached HTML renderer replays its own plan from integer zero. Admit
  // that plan only when it exactly retains the original movie lifetimes.
  const movies = captureMoviePoseClock(() => {
    active();
    return { project, revision: 0 };
  });
  try {
    movies.capture(view);
  } finally {
    movies.dispose();
  }
  active();
  const prepared = selectionTrajectoryStamp(view);
  function check() {
    active();
    if (selectionTrajectoryStamp(view) !== prepared) {
      invalid = true;
      throw Error('Live PNG prepared artwork changed.');
    }
  }
  check();
  return Object.freeze({ project: view, check });
}
