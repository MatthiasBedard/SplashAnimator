import { validateProject, type Project } from '../../document/src';
import { freezeSnapshot } from '../../document/src/immutable-snapshot';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { captureLiveMotionTimeline, type LiveMotionSource } from './live-motion';
import { createStageOpacityView } from './stage-opacity';
import { selectionTrajectoryStamp } from './selection-trajectory';

export interface LiveStageFrame {
  readonly frame: number;
  readonly sampledLayerIds: readonly string[];
  /** Detached render data, never an authored project or a source of picks. */
  readonly project: Project;
}
type Options = { validate?: () => void; signal?: AbortSignal };
const readers = new WeakMap<() => LiveMotionSource, { invalid: boolean }>();
function read(reader: () => LiveMotionSource): LiveMotionSource {
  const previous = readers.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Live stage source cannot reenter.');
  }
  const entry = { invalid: false };
  readers.set(reader, entry);
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
      throw Error('Live stage requires original project/revision data fields.');
    validateLiveMotionData(p.value);
    return { project: p.value as Project, revision: r.value as number };
  } finally {
    readers.delete(reader);
  }
}
/** Reusable source-owned root compilation and one private frame cache. It owns
 * no clocks/resources/history. Callers still own native readiness and actual
 * editor-frame admission; public render views never authorize sampled edits. */
export function captureLiveMotionStage(reader: () => LiveMotionSource, options: Options = {}) {
  if (typeof reader !== 'function') throw Error('Choose a live stage source reader.');
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((k) => k !== 'validate' && k !== 'signal')
  )
    throw Error('Invalid live stage admission.');
  const { validate, signal } = options;
  if (
    (validate !== undefined && typeof validate !== 'function') ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    throw Error('Invalid live stage admission.');
  const initial = read(reader),
    revision = initial.revision;
  let sourceReader: (() => LiveMotionSource) | undefined = reader,
    validator = validate,
    abortSignal = signal;
  let source: Project | undefined = initial.project,
    snapshot: Project | undefined,
    stamp = selectionTrajectoryStamp(source),
    dead = false,
    busy = false,
    invalid = false,
    admitting = false,
    epoch = 0;
  let sampler: ReturnType<typeof captureLiveMotionTimeline> | undefined,
    opacity: ReturnType<typeof createStageOpacityView> | undefined;
  let cache: { frame: number; project: Project; stamp: string; sampled: string[] } | undefined;
  const handles = new WeakMap<
    LiveStageFrame,
    { epoch: number; stamp: string; sampled: Set<string> }
  >();
  function dispose() {
    dead = true;
    epoch++;
    cache = undefined;
    sampler?.dispose();
    sampler = undefined;
    opacity = undefined;
    source = undefined;
    sourceReader = undefined;
    validator = undefined;
    abortSignal = undefined;
    snapshot = undefined;
    stamp = '';
  }
  function active() {
    if (dead || invalid || !source || !sourceReader)
      throw Error('Live stage capture is stale or disposed.');
    if (admitting) {
      invalid = true;
      throw Error('Live stage admission cannot reenter.');
    }
    admitting = true;
    try {
      if (abortSignal) AbortSignal.prototype.throwIfAborted.call(abortSignal);
      const result = validator?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Live stage admission must be synchronous.');
      }
      const latest = read(sourceReader);
      if (
        dead ||
        invalid ||
        latest.project !== source ||
        latest.revision !== revision ||
        selectionTrajectoryStamp(source) !== stamp ||
        (snapshot && selectionTrajectoryStamp(snapshot) !== stamp)
      )
        throw Error('Live stage source changed. Capture again.');
      if (abortSignal) AbortSignal.prototype.throwIfAborted.call(abortSignal);
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      admitting = false;
    }
  }
  try {
    active();
    validateProject(source);
    active();
    snapshot = structuredClone(source);
    active();
    if (selectionTrajectoryStamp(snapshot) !== stamp)
      throw Error('Live stage source clone changed.');
    freezeSnapshot(snapshot);
    opacity = snapshot.opacityBindings?.length ? createStageOpacityView(snapshot) : undefined;
    sampler = captureLiveMotionTimeline(() => {
      active();
      return { project: snapshot!, revision };
    });
    active();
  } catch (cause) {
    dispose();
    throw cause;
  }
  function ownedFrame(handle: LiveStageFrame, currentFrame: number) {
    active();
    const owned = handles.get(handle);
    if (
      !owned ||
      owned.epoch !== epoch ||
      !cache ||
      cache.frame !== currentFrame ||
      handle.frame !== currentFrame
    )
      throw Error('Choose the current privately owned live stage frame.');
    if (
      selectionTrajectoryStamp(handle.project) !== owned.stamp ||
      selectionTrajectoryStamp(cache.project) !== cache.stamp
    )
      throw Error('Public live stage artwork changed.');
    return owned;
  }
  return {
    sample(frame: number): LiveStageFrame {
      if (busy) {
        invalid = true;
        throw Error('Live stage sampling cannot reenter.');
      }
      busy = true;
      try {
        active();
        if (!Number.isSafeInteger(frame) || frame < 0 || frame >= snapshot!.duration)
          throw Error('Choose an exact live stage frame.');
        if (!cache || cache.frame !== frame) {
          const poses = sampler!.sample(frame),
            base = opacity?.(frame) ?? snapshot!,
            baseStamp = selectionTrajectoryStamp(base),
            draft = structuredClone(base);
          active();
          if (
            selectionTrajectoryStamp(draft) !== baseStamp ||
            selectionTrajectoryStamp(base) !== baseStamp
          )
            throw Error('Live stage render source clone changed.');
          const sampled: string[] = [];
          for (const layer of draft.layers) {
            delete layer.liveMotionSpans;
            const pose = poses.find((p) => p.layerId === layer.id && p.sampled);
            if (pose) {
              const expected = selectionTrajectoryStamp(pose.key),
                key = structuredClone(pose.key);
              active();
              if (
                selectionTrajectoryStamp(key) !== expected ||
                selectionTrajectoryStamp(pose.key) !== expected
              )
                throw Error('Live stage pose clone changed.');
              layer.keys = [...layer.keys.filter((k) => k.frame !== frame), key].sort(
                (a, b) => a.frame - b.frame,
              );
              sampled.push(layer.id);
            }
          }
          validateProject(draft);
          active();
          freezeSnapshot(draft);
          cache = { frame, project: draft, stamp: selectionTrajectoryStamp(draft), sampled };
        }
        const current = cache,
          output = structuredClone(current.project);
        validateProject(output);
        active();
        if (
          selectionTrajectoryStamp(current.project) !== current.stamp ||
          selectionTrajectoryStamp(output) !== current.stamp
        )
          throw Error('Live stage complete frame clone changed.');
        const handle: LiveStageFrame = Object.freeze({
          frame,
          project: output,
          sampledLayerIds: Object.freeze([...current.sampled]),
        });
        handles.set(handle, {
          epoch: ++epoch,
          stamp: current.stamp,
          sampled: new Set(current.sampled),
        });
        return handle;
      } catch (cause) {
        dispose();
        throw cause;
      } finally {
        busy = false;
      }
    },
    /** Recheck before native output publication, including entirely sampled scenes.
     * The caller supplies its actual current frame and owns input/job revisions. */
    assertFrame(handle: LiveStageFrame, currentFrame: number) {
      ownedFrame(handle, currentFrame);
    },
    /** Gate original authored-root operations, including multi-track operations.
     * Call with the actual current editor frame, never a public proposed value.
     * It does not authorize picking through a sampled foreground root. */
    assertAuthored(handle: LiveStageFrame, currentFrame: number, layerIds: readonly string[]) {
      const owned = ownedFrame(handle, currentFrame);
      validateLiveMotionData(layerIds);
      if (
        !Array.isArray(layerIds) ||
        !layerIds.length ||
        new Set(layerIds).size !== layerIds.length
      )
        throw Error('Choose distinct original authored tracks.');
      const input = selectionTrajectoryStamp(layerIds);
      for (const id of layerIds) {
        const layer = snapshot!.layers.find((l) => l.id === id);
        if (!layer || !layer.visible || layer.locked)
          throw Error('Choose visible unlocked original authored tracks.');
        if (owned.sampled.has(id))
          throw Error('Insert an authored live tween key before editing this sampled track.');
      }
      ownedFrame(handle, currentFrame);
      if (selectionTrajectoryStamp(layerIds) !== input)
        throw Error('Live stage authoring tracks changed.');
    },
    dispose,
  };
}
