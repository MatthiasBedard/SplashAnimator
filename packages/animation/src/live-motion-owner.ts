import { validateProject, type Project } from '../../document/src';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { captureLiveMotionTimeline, type LiveMotionTrack } from './live-motion';
import { splitLiveMotionLayer } from './live-motion-split';
import { selectionTrajectoryStamp } from './selection-trajectory';

export type LiveAuthoringSource = { project: Project; revision: number; frame: number };
export interface LiveRootOwner {
  readonly layerId: string;
  readonly shapeId: string;
  readonly spanId: string;
  readonly start: number;
  readonly end: number;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
}
type PrivateCapture = {
  current(): void;
  source(): Project;
  snapshot(): Project;
  scene(): LiveMotionTrack[];
  frame: number;
  revision: number;
  stamp: string;
};
type PrivateOwner = { capture: PrivateCapture; layerId: string; shapeId: string; spanId: string };
const owners = new WeakMap<LiveRootOwner, PrivateOwner>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const value = reader();
  if (!value || typeof value !== 'object') throw Error('Invalid live root source.');
  const fields = ['project', 'revision', 'frame'].map((name) =>
    Object.getOwnPropertyDescriptor(value, name),
  );
  if (fields.some((field) => !field || !('value' in field)))
    throw Error('Live root source requires original data fields.');
  const [p, r, f] = fields.map((field) => field!.value);
  validateLiveMotionData(p);
  if (
    !p ||
    !Number.isSafeInteger(r) ||
    r < 0 ||
    !Number.isSafeInteger(f) ||
    f < 0 ||
    f >= p.duration
  )
    throw Error('Invalid live root project/revision/frame.');
  return { project: p as Project, revision: r as number, frame: f as number };
}
/** Private complete-root membership. Public scenes, choices and returned owner
 * metadata are hints only; only original handles can prepare a sparse junction. */
export function captureLiveMotionAuthoringFrame(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function') throw Error('Choose a live root source reader.');
  const initial = read(readSource);
  let source: Project | undefined = initial.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    stamp = selectionTrajectoryStamp(source),
    privateScene: LiveMotionTrack[] = [];
  const revision = initial.revision,
    frame = initial.frame;
  let dead = false,
    reading = false,
    sampler: ReturnType<typeof captureLiveMotionTimeline> | undefined;
  const tracks = new Map<string, { spanId: string; start: number; end: number; ids: string[] }>();
  function dispose() {
    dead = true;
    sampler?.dispose();
    sampler = undefined;
    tracks.clear();
    privateScene = [];
    source = undefined;
    snapshot = undefined;
    reader = undefined;
    stamp = '';
  }
  function current() {
    if (dead || !reader || !source) throw Error('Live root capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live root source cannot reenter.');
    }
    reading = true;
    try {
      const latest = read(reader);
      if (
        dead ||
        latest.project !== source ||
        latest.revision !== revision ||
        latest.frame !== frame ||
        selectionTrajectoryStamp(source) !== stamp ||
        (snapshot && selectionTrajectoryStamp(snapshot) !== stamp)
      )
        throw Error('Live root source changed. Capture the frame again.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  try {
    validateProject(source);
    current();
    snapshot = structuredClone(source);
    current();
    sampler = captureLiveMotionTimeline(() => {
      current();
      return { project: snapshot!, revision };
    });
    const scene = sampler.sample(frame),
      expected = selectionTrajectoryStamp(scene);
    privateScene = structuredClone(scene);
    current();
    if (
      selectionTrajectoryStamp(scene) !== expected ||
      selectionTrajectoryStamp(privateScene) !== expected
    )
      throw Error('Live root scene capture changed.');
    for (const pose of privateScene) {
      if (!pose.sampled) continue;
      const layer = snapshot.layers.find((layer) => layer.id === pose.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === pose.spanId)!;
      if (
        layer.locked ||
        !layer.visible ||
        span.symbolContinuity !== undefined ||
        span.rotation?.rigidGroups ||
        frame - span.start < 2 ||
        span.end - frame < 2
      )
        continue;
      const ids = layer.keys
        .find((key) => key.frame === span.start)!
        .shapes.map((shape) => shape.id);
      if (JSON.stringify(ids) !== JSON.stringify(pose.key.shapes.map((shape) => shape.id)))
        throw Error('Live root artwork membership changed.');
      tracks.set(layer.id, { spanId: span.id, start: span.start, end: span.end, ids });
    }
    const captured: PrivateCapture = {
      current,
      source: () => {
        current();
        return source!;
      },
      snapshot: () => {
        current();
        return snapshot!;
      },
      scene: () => privateScene,
      frame,
      revision,
      stamp,
    };
    const detached = <T>(value: T) => {
      current();
      const expected = selectionTrajectoryStamp(value),
        output = structuredClone(value);
      current();
      if (
        selectionTrajectoryStamp(value) !== expected ||
        selectionTrajectoryStamp(output) !== expected
      )
        throw Error('Live root public clone changed.');
      return output;
    };
    return {
      get scene() {
        return detached(privateScene);
      },
      get choices() {
        return detached(
          [...tracks].flatMap(([layerId, track]) =>
            track.ids.map((shapeId) => ({ layerId, shapeId })),
          ),
        );
      },
      resolve(layerId: string, shapeId: string): LiveRootOwner {
        current();
        const track = tracks.get(layerId);
        if (!track || !track.ids.includes(shapeId))
          throw Error(
            'Choose one original sampled live root artwork item with split space on both sides.',
          );
        const handle: LiveRootOwner = Object.freeze({
          layerId,
          shapeId,
          spanId: track.spanId,
          start: track.start,
          end: track.end,
          frame,
          revision,
          shapeIds: Object.freeze([...track.ids]),
        });
        owners.set(handle, { capture: captured, layerId, shapeId, spanId: track.spanId });
        current();
        return handle;
      },
      dispose,
    };
  } catch (cause) {
    dispose();
    throw cause;
  }
}
export type LiveSplitRequest = { owner: LiveRootOwner; rightSpanId: string };
/** One detached all-track transaction. Inserts one complete authored key per
 * selected track, never per-frame keys/baselines. Caller owns history publication. */
export function prepareSplitLiveMotionSpans(
  requests: readonly LiveSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveMotionData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live root split requests.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((request) => {
      if (
        !request ||
        Reflect.ownKeys(request).some((key) => key !== 'owner' && key !== 'rightSpanId')
      )
        throw Error('Invalid sparse split request.');
      const record = owners.get(request.owner);
      if (!record) throw Error('Choose an original private live root owner.');
      if (!request.rightSpanId || typeof request.rightSpanId !== 'string')
        throw Error('Choose a new live span identity.');
      return { record, handle: request.owner, rightSpanId: request.rightSpanId };
    });
  const source = rows[0].record.capture.source(),
    first = rows[0].record.capture;
  const previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Sparse split preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((key) => key !== 'validate')
    )
      throw Error('Invalid sparse split admission.');
    const validate = options.validate;
    if (validate !== undefined && typeof validate !== 'function')
      throw Error('Invalid sparse split admission.');
    function current() {
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Sparse split admission must be synchronous.');
      }
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some(
          (row, i) =>
            requests[i].owner !== row.handle || requests[i].rightSpanId !== row.rightSpanId,
        )
      )
        throw Error('Sparse split requests changed or reentered.');
      for (const { record } of rows) {
        record.capture.current();
        if (
          record.capture.source() !== source ||
          record.capture.revision !== first.revision ||
          record.capture.frame !== first.frame ||
          record.capture.stamp !== first.stamp
        )
          throw Error('Split requests must share one original source/revision/frame.');
      }
    }
    current();
    validateProject(source);
    current();
    const candidate = structuredClone(source);
    if (selectionTrajectoryStamp(candidate) !== first.stamp)
      throw Error('Sparse split source clone changed.');
    const selected = new Set<string>();
    for (const { record, rightSpanId } of rows) {
      if (selected.has(record.layerId)) throw Error('Choose each complete root track once.');
      selected.add(record.layerId);
      const original = record.capture.snapshot(),
        layer = original.layers.find((layer) => layer.id === record.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === record.spanId)!;
      const prepared = splitLiveMotionLayer(original, layer, span, first.frame, rightSpanId);
      const expected = record.capture.scene().find((pose) => pose.layerId === layer.id)!.key.shapes;
      if (
        selectionTrajectoryStamp(prepared.keys.find((key) => key.frame === first.frame)!.shapes) !==
        selectionTrajectoryStamp(expected)
      )
        throw Error('Sparse split promoted geometry changed from the original captured pose.');
      candidate.layers[candidate.layers.findIndex((layer) => layer.id === record.layerId)] =
        prepared;
      current();
    }
    validateProject(candidate);
    const expected = selectionTrajectoryStamp(candidate);
    current();
    const output = structuredClone(candidate);
    validateProject(output);
    current();
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Sparse split complete candidate changed.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
