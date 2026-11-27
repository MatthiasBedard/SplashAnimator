import { validateProject, type Project, type LiveMotionSpan } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import type { MotionPath } from '../../document/src/motion-path';
import { createMotionPathSampler } from './motion-path';
import { motionProgress } from './motion-frames';
import {
  captureLiveMotionTimeline,
  type LiveMotionSource,
  type LiveMotionTrack,
} from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { prepareIndependentGroupPath } from './independent-group-path';

/** Transient opt-in bank. This is not yet a persisted recipe or an editor command.
 * Each route is relative to its original outer-group leader. Its deviation from
 * linear endpoint travel is added to the existing shared span trajectory. */
export interface IndependentGroupTrajectory {
  layerId: string;
  spanId: string;
  groupId: string;
  composition: 'additive';
  path: MotionPath;
}
type Plan = {
  binding: IndependentGroupTrajectory;
  span: LiveMotionSpan;
  ids: string[];
  dx: number;
  dy: number;
  route: ReturnType<typeof createMotionPathSampler>;
};
const preparing = new WeakMap<Project, { invalid: boolean }>();
function pair(reader: () => LiveMotionSource): LiveMotionSource {
  const value = reader();
  if (!value || typeof value !== 'object')
    throw Error('Choose original group trajectory source data.');
  const p = Object.getOwnPropertyDescriptor(value, 'project');
  const r = Object.getOwnPropertyDescriptor(value, 'revision');
  if (
    !p?.enumerable ||
    !r?.enumerable ||
    !('value' in p) ||
    !('value' in r) ||
    !p.value ||
    !Number.isSafeInteger(r.value) ||
    r.value < 0
  )
    throw Error('Choose original group trajectory source/revision data fields.');
  return { project: p.value, revision: r.value };
}
function compile(project: Project, binding: IndependentGroupTrajectory): Plan {
  if (
    !['layerId', 'spanId', 'groupId', 'composition', 'path'].every((k) =>
      Object.hasOwn(binding, k),
    ) ||
    Reflect.ownKeys(binding).some(
      (k) => !['layerId', 'spanId', 'groupId', 'composition', 'path'].includes(k as string),
    ) ||
    !['layerId', 'spanId', 'groupId'].every(
      (k) => typeof binding[k as 'layerId'] === 'string' && !!binding[k as 'layerId'],
    ) ||
    binding.composition !== 'additive' ||
    !Object.hasOwn(binding, 'path')
  )
    throw Error('Choose an explicit original group route with additive composition.');
  const layer = project.layers.find((l) => l.id === binding.layerId);
  const span = layer?.liveMotionSpans?.find((s) => s.id === binding.spanId);
  if (!layer || !span) throw Error('Choose an original independent group recipe.');
  if (span.groupPaths?.some((p) => p.groupId === binding.groupId))
    throw Error('This original group already owns a persisted independent route.');
  const plan = prepareIndependentGroupPath(layer, span, {
    groupId: binding.groupId,
    composition: binding.composition,
    path: binding.path,
  });
  return { binding, span, ...plan };
}

/** Prepare every requested group before returning an evaluator. Source/library
 * revision ownership stays live; controls and outputs are detached. Sampling is
 * atomic across all tracks and never writes keys, recipes, history or recovery.
 * This first translation-only kernel deliberately retains existing orbit guards. */
export function captureIndependentGroupTrajectories(
  readSource: () => LiveMotionSource,
  bindings: readonly IndependentGroupTrajectory[] = [],
) {
  if (typeof readSource !== 'function') throw Error('Choose a group trajectory source reader.');
  const initial = pair(readSource),
    original = initial.project;
  const prior = preparing.get(original);
  if (prior) {
    prior.invalid = true;
    throw Error('Independent group trajectory preparation cannot reenter.');
  }
  const state = { invalid: false };
  preparing.set(original, state);
  let timeline: ReturnType<typeof captureLiveMotionTimeline> | undefined;
  let dead = false,
    busy = false;
  let snapshot: Project | undefined;
  let plans: Plan[] = [];
  let sourceStamp: string, inputStamp: string;
  function current() {
    if (dead || state.invalid)
      throw Error('Independent group trajectory capture is stale or disposed.');
    const latest = pair(readSource);
    validateLiveGraphicData(original);
    if (
      latest.project !== original ||
      latest.revision !== initial.revision ||
      selectionTrajectoryStamp(original) !== sourceStamp ||
      dead ||
      state.invalid
    )
      throw Error('Independent group trajectory source changed.');
  }
  function dispose() {
    dead = true;
    timeline?.dispose();
    timeline = undefined;
    snapshot = undefined;
    plans = [];
  }
  try {
    validateLiveGraphicData(original);
    validateLiveGraphicData(bindings);
    if (!Array.isArray(bindings)) throw Error('Choose an original group trajectory bank.');
    sourceStamp = selectionTrajectoryStamp(original);
    inputStamp = selectionTrajectoryStamp(bindings);
    validateProject(original);
    current();
    snapshot = structuredClone(original);
    const captured = structuredClone(bindings);
    current();
    validateLiveGraphicData(snapshot);
    validateLiveGraphicData(captured);
    if (
      selectionTrajectoryStamp(snapshot) !== sourceStamp ||
      selectionTrajectoryStamp(captured) !== inputStamp ||
      selectionTrajectoryStamp(bindings) !== inputStamp
    )
      throw Error('Independent group trajectory source or bank clone changed.');
    timeline = captureLiveMotionTimeline(readSource);
    const seen = new Set<string>();
    for (const binding of captured) {
      const plan = compile(snapshot, binding);
      const token = JSON.stringify([binding.layerId, binding.spanId, binding.groupId]);
      if (seen.has(token))
        throw Error('Choose only one independent route per original group/span.');
      seen.add(token);
      plans.push(plan);
    }
    current();
    if (
      selectionTrajectoryStamp(bindings) !== inputStamp ||
      selectionTrajectoryStamp(snapshot) !== sourceStamp
    )
      throw Error('Independent group trajectory bank or snapshot changed during preparation.');
  } catch (cause) {
    dispose();
    throw cause;
  } finally {
    preparing.delete(original);
  }
  return {
    sample(frame: number): LiveMotionTrack[] {
      if (busy) {
        dead = true;
        throw Error('Independent group trajectory sampling cannot reenter.');
      }
      busy = true;
      try {
        current();
        if (selectionTrajectoryStamp(snapshot) !== sourceStamp)
          throw Error('Independent group snapshot changed.');
        const output = timeline!.sample(frame);
        const tracks = new Map(output.map((track) => [track.layerId, track]));
        const shapes = new Map<
          string,
          Map<string, (typeof output)[number]['key']['shapes'][number]>
        >();
        for (const { binding, span, ids, dx, dy, route } of plans) {
          if (frame <= span.start || frame >= span.end) continue;
          const track = tracks.get(binding.layerId);
          if (!track || track.spanId !== span.id) continue; // Invisible tracks remain invisible.
          let members = shapes.get(binding.layerId);
          if (!members) {
            members = new Map(track.key.shapes.map((shape) => [shape.id, shape]));
            shapes.set(binding.layerId, members);
          }
          const t = motionProgress((frame - span.start) / (span.end - span.start), span.ease),
            p = route(t);
          const x = p.x - dx * t,
            y = p.y - dy * t;
          if (![x, y].every(Number.isFinite))
            throw Error('Independent group trajectory exceeds numeric limits.');
          for (const id of ids) {
            const shape = members.get(id);
            if (!shape) throw Error('Independent group pose membership changed.');
            shape.x += x;
            shape.y += y;
          }
        }
        const stamp = selectionTrajectoryStamp(output),
          candidate = structuredClone(snapshot!);
        validateLiveGraphicData(candidate);
        if (selectionTrajectoryStamp(candidate) !== sourceStamp)
          throw Error('Independent group validation clone changed.');
        for (const layer of candidate.layers) {
          delete layer.liveMotionSpans;
          const track = output.find((t) => t.layerId === layer.id && t.sampled);
          if (track) {
            const key = structuredClone(track.key);
            validateLiveGraphicData(key);
            if (selectionTrajectoryStamp(key) !== selectionTrajectoryStamp(track.key))
              throw Error('Independent group validation pose clone changed.');
            layer.keys = [...layer.keys.filter((k) => k.frame !== frame), key].sort(
              (a, b) => a.frame - b.frame,
            );
          }
        }
        validateProject(candidate);
        current();
        validateLiveGraphicData(output);
        if (selectionTrajectoryStamp(output) !== stamp)
          throw Error('Independent group output changed during admission.');
        return output;
      } catch (cause) {
        dispose();
        throw cause;
      } finally {
        busy = false;
      }
    },
    dispose,
  };
}
