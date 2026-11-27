import { validateProject, type Project } from '../../document/src';
import { captureLiveMotionTimeline, type LiveMotionSource } from './live-motion';
import { prepareRememberedChildrenCapture } from './motion-capture';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';
import { validateLiveGraphicData } from '../../document/src/live-motion';

const reading = new WeakMap<() => LiveMotionSource, { invalid: boolean }>();
function read(reader: () => LiveMotionSource): LiveMotionSource {
  const previous = reading.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Live presentation source cannot reenter.');
  }
  const entry = { invalid: false };
  reading.set(reader, entry);
  try {
    const value = reader(),
      p = value && Object.getOwnPropertyDescriptor(value, 'project'),
      r = value && Object.getOwnPropertyDescriptor(value, 'revision');
    if (
      entry.invalid ||
      !p ||
      !r ||
      !('value' in p) ||
      !('value' in r) ||
      !p.value ||
      !Number.isSafeInteger(r.value) ||
      r.value < 0
    )
      throw Error('Live presentation requires original project/revision data fields.');
    return { project: p.value as Project, revision: r.value as number };
  } finally {
    reading.delete(reader);
  }
}
type Options = { signal?: AbortSignal; validate?: () => void; rememberedChildren?: boolean };
/** One frame-local detached render project, not authoring ownership or a bake.
 * All original root keys remain exact except the requested live interior pose.
 * Consumers replay ordinary movie/button clocks; this adapter owns none. */
export async function prepareLiveMotionFrameCapture(
  reader: () => LiveMotionSource,
  frame: number,
  options: Options = {},
): Promise<Project> {
  if (typeof reader !== 'function') throw Error('Choose a live presentation source reader.');
  const source = read(reader),
    stamp = selectionTrajectoryStamp(source.project);
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some(
      (k) => !['signal', 'validate', 'rememberedChildren'].includes(k as string),
    )
  )
    throw Error('Invalid live presentation options.');
  const { signal, validate, rememberedChildren = false } = options;
  if (
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    (validate !== undefined && typeof validate !== 'function') ||
    typeof rememberedChildren !== 'boolean'
  )
    throw Error('Invalid live presentation ownership.');
  function active() {
    if (signal) AbortSignal.prototype.throwIfAborted.call(signal);
    const result = validate?.() as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw Error('Live presentation validation must be synchronous.');
    }
    const latest = read(reader);
    if (
      latest.project !== source.project ||
      latest.revision !== source.revision ||
      selectionTrajectoryStamp(latest.project) !== stamp
    )
      throw Error('Live presentation source changed.');
    if (
      source.project.layers.some((l) =>
        l.liveMotionSpans?.some((s) => s.symbolContinuity === 'movie-trees'),
      )
    )
      validateLiveGraphicData(source.project);
    if (signal) AbortSignal.prototype.throwIfAborted.call(signal);
  }
  active();
  const owner = captureLiveMotionTimeline(() => {
    active();
    return source;
  });
  try {
    const poses = owner.sample(frame),
      draft = structuredClone(source.project);
    active();
    if (selectionTrajectoryStamp(draft) !== stamp)
      throw Error('Live presentation source clone changed.');
    for (const layer of draft.layers) {
      delete layer.liveMotionSpans;
      const pose = poses.find((pose) => pose.layerId === layer.id && pose.sampled);
      if (pose) {
        const expected = selectionTrajectoryStamp(pose.key),
          key = structuredClone(pose.key);
        if (
          selectionTrajectoryStamp(key) !== expected ||
          selectionTrajectoryStamp(pose.key) !== expected
        )
          throw Error('Live presentation pose clone changed.');
        layer.keys = [...layer.keys.filter((key) => key.frame !== frame), key].sort(
          (a, b) => a.frame - b.frame,
        );
      }
    }
    validateProject(draft);
    active();
    const rootStamp = selectionTrajectoryStamp({ ...draft, symbols: undefined });
    const prepared = rememberedChildren
      ? await prepareRememberedChildrenCapture(draft, { signal, validate: active })
      : draft;
    active();
    validateProject(prepared);
    active();
    if (selectionTrajectoryStamp({ ...prepared, symbols: undefined }) !== rootStamp)
      throw Error('Live presentation root ownership changed during child preparation.');
    const outputStamp = selectionTrajectoryStamp(prepared),
      output = structuredClone(prepared);
    validateProject(output);
    if (
      source.project.layers.some((l) =>
        l.liveMotionSpans?.some((s) => s.symbolContinuity === 'movie-trees'),
      ) &&
      selectionTrajectoryStamp(compileMovieClockPlan(output)) !==
        selectionTrajectoryStamp(compileMovieClockPlan(source.project))
    )
      throw Error('Nested movie presentation changed original clock lifetimes.');
    active();
    if (
      source.project.layers.some((l) =>
        l.liveMotionSpans?.some((s) => s.symbolContinuity === 'movie-trees'),
      )
    ) {
      validateLiveGraphicData(prepared);
      validateLiveGraphicData(output);
    }
    if (
      selectionTrajectoryStamp(prepared) !== outputStamp ||
      selectionTrajectoryStamp(output) !== outputStamp
    )
      throw Error('Live presentation output changed during admission.');
    return output;
  } finally {
    owner.dispose();
  }
}
