import { validateProject, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { captureLiveMotionTimeline, type LiveMotionTrack } from './live-motion';
import { splitLiveMovieTreeMotionLayer } from './live-movie-tree-motion-split';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';

export type LiveAuthoringSource = { project: Project; revision: number; frame: number };
export interface LiveMovieTreeOwner {
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
  topology: string;
};
type PrivateOwner = { capture: PrivateCapture; layerId: string; shapeId: string; spanId: string };
const owners = new WeakMap<LiveMovieTreeOwner, PrivateOwner>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const sourceReads = new WeakMap<() => LiveAuthoringSource, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const previous = sourceReads.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Original nested movie split source cannot reenter.');
  }
  const entry = { invalid: false };
  sourceReads.set(reader, entry);
  let value: LiveAuthoringSource;
  try {
    value = reader();
    if (entry.invalid) throw Error('Original nested movie split source reentered.');
  } finally {
    sourceReads.delete(reader);
  }
  if (!value || typeof value !== 'object') throw Error('Invalid live nested movie split source.');
  const fields = ['project', 'revision', 'frame'].map((name) =>
    Object.getOwnPropertyDescriptor(value, name),
  );
  if (fields.some((field) => !field?.enumerable || !('value' in field)))
    throw Error('Live nested movie split source requires original data fields.');
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
    throw Error('Invalid live nested movie split project/revision/frame.');
  return { project: p as Project, revision: r as number, frame: f as number };
}
/** Explicit original nested movie references for a whole-span split. Public scenes and
 * hints never own membership; root/group split handles retain separate brands. */
export function captureLiveMovieTreeMotionAuthoringFrame(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose a live nested movie split source reader.');
  const initial = read(readSource);
  let source: Project | undefined = initial.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    stamp = selectionTrajectoryStamp(source),
    topology = '',
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
      movies: Map<string, string>;
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
    topology = '';
  }
  function current() {
    if (dead || !reader || !source)
      throw Error('Live nested movie split capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live nested movie split source cannot reenter.');
    }
    reading = true;
    try {
      const latest = read(reader);
      if (snapshot) validateLiveGraphicData(snapshot);
      if (
        dead ||
        latest.project !== source ||
        latest.revision !== revision ||
        latest.frame !== frame ||
        selectionTrajectoryStamp(source) !== stamp ||
        (snapshot && selectionTrajectoryStamp(snapshot) !== stamp)
      )
        throw Error('Live nested movie split source changed. Capture the frame again.');
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
    topology = selectionTrajectoryStamp(compileMovieClockPlan(snapshot));
    current();
    sampler = captureLiveMotionTimeline(() => {
      current();
      return { project: snapshot!, revision };
    });
    const scene = sampler.sample(frame),
      expected = selectionTrajectoryStamp(scene);
    privateScene = structuredClone(scene);
    current();
    validateLiveGraphicData(scene);
    validateLiveGraphicData(privateScene);
    if (
      selectionTrajectoryStamp(scene) !== expected ||
      selectionTrajectoryStamp(privateScene) !== expected
    )
      throw Error('Live nested movie split scene capture changed.');
    for (const pose of privateScene) {
      if (!pose.sampled) continue;
      const layer = snapshot.layers.find((layer) => layer.id === pose.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === pose.spanId)!;
      if (
        layer.locked ||
        !layer.visible ||
        span.symbolContinuity !== 'movie-trees' ||
        frame - span.start < 2 ||
        span.end - frame < 2
      )
        continue;
      const ids = layer.keys
        .find((key) => key.frame === span.start)!
        .shapes.map((shape) => shape.id);
      if (JSON.stringify(ids) !== JSON.stringify(pose.key.shapes.map((shape) => shape.id)))
        throw Error('Live nested movie split artwork membership changed.');
      const movies = new Map(
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
        movies,
      });
    }
    const captured: PrivateCapture = {
      current,
      identity: () => {
        if (dead || !source) throw Error('Live nested movie split capture is stale or disposed.');
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
      get stamp() {
        return stamp;
      },
      get topology() {
        return topology;
      },
    };
    const detached = <T>(value: T) => {
      current();
      validateLiveGraphicData(value);
      const expected = selectionTrajectoryStamp(value),
        output = structuredClone(value);
      current();
      validateLiveGraphicData(value);
      validateLiveGraphicData(output);
      if (
        selectionTrajectoryStamp(value) !== expected ||
        selectionTrajectoryStamp(output) !== expected
      )
        throw Error('Live nested movie split public clone changed.');
      return output;
    };
    return {
      get scene() {
        return detached(privateScene);
      },
      get choices() {
        return detached(
          [...tracks].flatMap(([layerId, track]) =>
            [...track.movies].map(([shapeId, symbolId]) => ({
              layerId,
              spanId: track.spanId,
              shapeId,
              symbolId,
            })),
          ),
        );
      },
      resolve(layerId: string, shapeId: string): LiveMovieTreeOwner {
        current();
        if (![layerId, shapeId].every((v) => typeof v === 'string' && v.length > 0))
          throw Error('Choose original movie string identities.');
        const track = tracks.get(layerId),
          symbolId = track?.movies.get(shapeId);
        if (!track || !symbolId)
          throw Error('Choose an original movie instance with split space on both sides.');
        const handle: LiveMovieTreeOwner = Object.freeze({
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
export type LiveMovieTreeSplitRequest = { owner: LiveMovieTreeOwner; rightSpanId: string };
/** One detached all-track transaction. Inserts one complete authored key per
 * selected track, never per-frame keys/baselines. Caller owns history publication. */
export function prepareSplitLiveMovieTreeMotionSpans(
  requests: readonly LiveMovieTreeSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live nested movie split requests.');
  if (
    Object.getPrototypeOf(requests) !== Array.prototype ||
    Reflect.ownKeys(requests).length !== requests.length + 1 ||
    !Array.from({ length: requests.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(requests, String(i)),
    ).every((d) => d?.enumerable && 'value' in d)
  )
    throw Error('Choose original dense movie split requests.');
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
        throw Error('Choose original enumerable movie split owner/identity data.');
      const record = owners.get(owner.value);
      if (!record) throw Error('Choose an original private live nested movie split owner.');
      if (!id.value || typeof id.value !== 'string')
        throw Error('Choose a new live span identity.');
      return { record, handle: owner.value as LiveMovieTreeOwner, rightSpanId: id.value as string };
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
      throw Error('Choose an own movie split admission field.');
    if (
      descriptor &&
      (!descriptor.enumerable ||
        !('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose a synchronous movie split admission data field.');
    const validate = descriptor?.value as (() => void) | undefined;
    function current() {
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Sparse split admission must be synchronous.');
      }
      const inputs = () => {
        validateLiveGraphicData(requests);
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
          throw Error('Nested movie split requests changed, reentered or crossed capture scopes.');
      };
      inputs();
      first.current();
      if (first.source() !== source) throw Error('Nested movie split original source changed.');
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
      if (selected.has(record.layerId)) throw Error('Choose each complete movie recipe once.');
      selected.add(record.layerId);
      const original = record.capture.snapshot(),
        layer = original.layers.find((layer) => layer.id === record.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === record.spanId)!;
      const prepared = splitLiveMovieTreeMotionLayer(
        original,
        layer,
        span,
        first.frame,
        rightSpanId,
      );
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
    if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== first.topology)
      throw Error('Nested movie split complete candidate changed original clock topology.');
    current();
    const output = structuredClone(candidate);
    validateProject(output);
    if (selectionTrajectoryStamp(compileMovieClockPlan(output)) !== first.topology)
      throw Error('Nested movie split complete output changed original clock topology.');
    current();
    validateLiveGraphicData(candidate);
    validateLiveGraphicData(output);
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
