import { validateProject, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { captureLiveMotionTimeline, type LiveMotionTrack } from './live-motion';
import { splitLiveGraphicMotionLayer } from './live-graphic-motion-split';
import { selectionTrajectoryStamp } from './selection-trajectory';

export type LiveAuthoringSource = { project: Project; revision: number; frame: number };
export interface LiveGraphicOwner {
  readonly layerId: string;
  readonly shapeId: string;
  readonly symbolId: string;
  readonly spanId: string;
  readonly start: number;
  readonly end: number;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
}
type PrivateCapture = {
  current(): void;
  identity(): Project;
  source(): Project;
  snapshot(): Project;
  scene(): LiveMotionTrack[];
  frame: number;
  revision: number;
  stamp: string;
};
type PrivateOwner = { capture: PrivateCapture; layerId: string; shapeId: string; spanId: string };
const owners = new WeakMap<LiveGraphicOwner, PrivateOwner>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const value = reader();
  if (!value || typeof value !== 'object') throw Error('Invalid live graphic split source.');
  const fields = ['project', 'revision', 'frame'].map((name) =>
    Object.getOwnPropertyDescriptor(value, name),
  );
  if (fields.some((field) => !field?.enumerable || !('value' in field)))
    throw Error('Live graphic split source requires original data fields.');
  const [p, r, f] = fields.map((field) => field!.value);
  validateLiveGraphicData(p);
  if (
    !p ||
    !Number.isSafeInteger(r) ||
    r < 0 ||
    !Number.isSafeInteger(f) ||
    f < 0 ||
    f >= p.duration
  )
    throw Error('Invalid live graphic split project/revision/frame.');
  return { project: p as Project, revision: r as number, frame: f as number };
}
/** Explicit original graphic references for a whole-span split. Public scenes and
 * hints never own membership; root/group split handles retain separate brands. */
export function captureLiveGraphicMotionAuthoringFrame(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function') throw Error('Choose a live graphic split source reader.');
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
  const tracks = new Map<
    string,
    {
      spanId: string;
      start: number;
      end: number;
      ids: readonly string[];
      graphics: Map<string, string>;
    }
  >();
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
    if (dead || !reader || !source) throw Error('Live graphic split capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live graphic split source cannot reenter.');
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
        throw Error('Live graphic split source changed. Capture the frame again.');
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
      throw Error('Live graphic split scene capture changed.');
    for (const pose of privateScene) {
      if (!pose.sampled) continue;
      const layer = snapshot.layers.find((layer) => layer.id === pose.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === pose.spanId)!;
      if (
        layer.locked ||
        !layer.visible ||
        span.symbolContinuity !== 'graphics' ||
        frame - span.start < 2 ||
        span.end - frame < 2
      )
        continue;
      const ids = layer.keys
        .find((key) => key.frame === span.start)!
        .shapes.map((shape) => shape.id);
      if (JSON.stringify(ids) !== JSON.stringify(pose.key.shapes.map((shape) => shape.id)))
        throw Error('Live graphic split artwork membership changed.');
      const graphics = new Map(
        layer.keys
          .find((key) => key.frame === span.start)!
          .shapes.filter((shape) => shape.kind === 'symbol')
          .map((shape) => [shape.id, shape.symbolId!]),
      );
      tracks.set(layer.id, {
        spanId: span.id,
        start: span.start,
        end: span.end,
        ids: Object.freeze(ids),
        graphics,
      });
    }
    const captured: PrivateCapture = {
      current,
      identity: () => {
        if (dead || !source) throw Error('Live graphic split capture is stale or disposed.');
        return source;
      },
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
        throw Error('Live graphic split public clone changed.');
      return output;
    };
    return {
      get scene() {
        return detached(privateScene);
      },
      get choices() {
        return detached(
          [...tracks].flatMap(([layerId, track]) =>
            [...track.graphics].map(([shapeId, symbolId]) => ({
              layerId,
              spanId: track.spanId,
              shapeId,
              symbolId,
            })),
          ),
        );
      },
      resolve(layerId: string, shapeId: string): LiveGraphicOwner {
        current();
        if (![layerId, shapeId].every((v) => typeof v === 'string' && v.length > 0))
          throw Error('Choose original graphic string identities.');
        const track = tracks.get(layerId),
          symbolId = track?.graphics.get(shapeId);
        if (!track || !symbolId)
          throw Error('Choose an original graphic instance with split space on both sides.');
        const handle: LiveGraphicOwner = Object.freeze({
          layerId,
          shapeId,
          symbolId,
          spanId: track.spanId,
          start: track.start,
          end: track.end,
          frame,
          revision,
          shapeIds: track.ids,
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
export type LiveGraphicSplitRequest = { owner: LiveGraphicOwner; rightSpanId: string };
/** One detached all-track transaction. Inserts one complete authored key per
 * selected track, never per-frame keys/baselines. Caller owns history publication. */
export function prepareSplitLiveGraphicMotionSpans(
  requests: readonly LiveGraphicSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live graphic split requests.');
  if (
    Object.getPrototypeOf(requests) !== Array.prototype ||
    Reflect.ownKeys(requests).length !== requests.length + 1 ||
    !Array.from({ length: requests.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(requests, String(i)),
    ).every((d) => d?.enumerable && 'value' in d)
  )
    throw Error('Choose original dense graphic split requests.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((request) => {
      if (
        !request ||
        Reflect.ownKeys(request).some((key) => key !== 'owner' && key !== 'rightSpanId')
      )
        throw Error('Invalid sparse split request.');
      const owner = Object.getOwnPropertyDescriptor(request, 'owner'),
        id = Object.getOwnPropertyDescriptor(request, 'rightSpanId');
      if (!owner?.enumerable || !id?.enumerable || !('value' in owner) || !('value' in id))
        throw Error('Choose original enumerable graphic split owner/identity data.');
      const record = owners.get(owner.value);
      if (!record) throw Error('Choose an original private live graphic split owner.');
      if (!id.value || typeof id.value !== 'string')
        throw Error('Choose a new live span identity.');
      return { record, handle: owner.value as LiveGraphicOwner, rightSpanId: id.value as string };
    });
  const first = rows[0].record.capture,
    source = first.identity();
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
      Reflect.ownKeys(options).some((key) => key !== 'validate') ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))
    )
      throw Error('Invalid sparse split admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (!descriptor && 'validate' in options)
      throw Error('Choose an own graphic split admission field.');
    if (
      descriptor &&
      (!descriptor.enumerable ||
        !('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose a synchronous graphic split admission data field.');
    const validate = descriptor?.value as (() => void) | undefined;
    function current() {
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Sparse split admission must be synchronous.');
      }
      const inputs = () => {
        if (
          entry.invalid ||
          selectionTrajectoryStamp(requests) !== inputStamp ||
          rows.some(
            (row, i) =>
              requests[i].owner !== row.handle ||
              requests[i].rightSpanId !== row.rightSpanId ||
              row.record.capture !== first,
          )
        )
          throw Error('Graphic split requests changed, reentered or crossed capture scopes.');
      };
      inputs();
      first.current();
      if (first.source() !== source) throw Error('Graphic split original source changed.');
      inputs();
    }
    current();
    validateProject(source);
    current();
    const candidate = structuredClone(source);
    if (selectionTrajectoryStamp(candidate) !== first.stamp)
      throw Error('Sparse split source clone changed.');
    const selected = new Set<string>();
    for (const { record, rightSpanId } of rows) {
      if (selected.has(record.layerId)) throw Error('Choose each complete graphic recipe once.');
      selected.add(record.layerId);
      const original = record.capture.snapshot(),
        layer = original.layers.find((layer) => layer.id === record.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === record.spanId)!;
      const prepared = splitLiveGraphicMotionLayer(original, layer, span, first.frame, rightSpanId);
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
    const expected = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
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
