import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { compileMovieClockPlan } from './movie-clock-plan';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export interface LiveMovieTreeWaypointOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly shapeId: string;
  readonly waypointIndex: number;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
  readonly point: Readonly<Point>;
}
type Scope = {
  identity(): Project;
  current(): void;
  source(): Project;
  snapshot(): Project;
  topology(): string;
};
type RecordData = {
  scope: Scope;
  layerId: string;
  spanId: string;
  shapeId: string;
  waypointIndex: number;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
type RootRecordData = Omit<RecordData, 'waypointIndex' | 'point'> & { waypoints: readonly Point[] };
const owners = new WeakMap<LiveMovieTreeWaypointOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, shape: string) => JSON.stringify([layer, span, shape]);
const sourceReads = new WeakMap<() => LiveAuthoringSource, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const previous = sourceReads.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Original nested movie waypoint source cannot reenter.');
  }
  const entry = { invalid: false };
  sourceReads.set(reader, entry);
  let value: LiveAuthoringSource;
  try {
    value = reader();
    if (entry.invalid) throw Error('Original nested movie waypoint source reentered.');
  } finally {
    sourceReads.delete(reader);
  }
  if (!value || typeof value !== 'object')
    throw Error('Choose original nested movie waypoint source data.');
  const fields = ['project', 'revision', 'frame'].map((k) =>
    Object.getOwnPropertyDescriptor(value, k),
  );
  if (fields.some((d) => !d?.enumerable || !('value' in d)))
    throw Error('Nested movie waypoint source requires original data fields.');
  const [project, revision, frame] = fields.map((d) => d!.value);
  validateLiveGraphicData(project);
  if (
    !project ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    frame >= project.duration
  )
    throw Error('Invalid nested movie waypoint source/frame/revision.');
  return { project, revision, frame };
}
/** Original symbol-root references to existing shared stored slots in admitted
 * movie-tree spans. Start-root origins and compiled clock topology remain private;
 * changing a slot edits the shared route, not a descendant's independent clock. */
export function captureLiveMovieTreeWaypoints(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original nested movie waypoint source reader.');
  const first = read(readSource),
    stamp = selectionTrajectoryStamp(first.project),
    frame = first.frame,
    revision = first.revision;
  let source: Project | undefined = first.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    topology = '',
    dead = false,
    reading = false;
  const records = new Map<string, RootRecordData>(),
    qualified = new Set<string>();
  function dispose() {
    dead = true;
    source = undefined;
    snapshot = undefined;
    reader = undefined;
    topology = '';
    records.clear();
    qualified.clear();
  }
  function current() {
    if (dead || !reader || !source)
      throw Error('Nested movie waypoint capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Nested movie waypoint source cannot reenter.');
    }
    reading = true;
    try {
      const next = read(reader);
      if (
        dead ||
        next.project !== source ||
        next.revision !== revision ||
        next.frame !== frame ||
        selectionTrajectoryStamp(source) !== stamp ||
        (snapshot && selectionTrajectoryStamp(snapshot) !== stamp)
      )
        throw Error('Nested movie waypoint original source/frame/revision changed.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  const scope: Scope = {
    identity: () => {
      if (dead || !source) throw Error('Nested movie waypoint capture is stale or disposed.');
      return source;
    },
    current,
    topology: () => topology,
    source: () => {
      current();
      return source!;
    },
    snapshot: () => {
      current();
      return snapshot!;
    },
  };
  try {
    validateProject(source);
    current();
    snapshot = structuredClone(source);
    current();
    topology = selectionTrajectoryStamp(compileMovieClockPlan(snapshot));
    current();
    for (const layer of snapshot.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const span of layer.liveMotionSpans ?? []) {
        if (
          frame < span.start ||
          frame > span.end ||
          !span.path ||
          span.symbolContinuity !== 'movie-trees' ||
          span.rotation?.rigidGroups ||
          span.path.waypoints === undefined
        )
          continue;
        const start = layer.keys.find((k) => k.frame === span.start)!;
        const ids = Object.freeze(start.shapes.map((s) => s.id));
        // Share each original route/complete ID set across lazy root/slot owners.
        for (const shape of start.shapes.filter((s) => s.kind === 'symbol'))
          records.set(key(layer.id, span.id, shape.id), {
            scope,
            layerId: layer.id,
            spanId: span.id,
            shapeId: shape.id,
            origin: { x: shape.x, y: shape.y },
            shapeIds: ids,
            waypoints: span.path.waypoints,
          });
      }
    }
    current();
    return {
      get choices() {
        current();
        const hints = [...records.values()].map((r) => ({
            layerId: r.layerId,
            spanId: r.spanId,
            shapeId: r.shapeId,
            waypointCount: r.waypoints.length,
          })),
          expected = selectionTrajectoryStamp(hints),
          output = structuredClone(hints);
        current();
        if (selectionTrajectoryStamp(output) !== expected)
          throw Error('Nested movie waypoint public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        shapeId: string,
        waypointIndex: number,
      ): LiveMovieTreeWaypointOwner {
        current();
        if (
          ![layerId, spanId, shapeId].every((v) => typeof v === 'string' && v.length > 0) ||
          !Number.isSafeInteger(waypointIndex) ||
          waypointIndex < 0
        )
          throw Error('Choose original string identities and an existing stored waypoint index.');
        const root = records.get(key(layerId, spanId, shapeId));
        if (!root || waypointIndex >= root.waypoints.length)
          throw Error(
            'Choose an existing original waypoint on a visible unlocked nested movie root.',
          );
        const offset = root.waypoints[waypointIndex],
          point = { x: root.origin.x + offset.x, y: root.origin.y + offset.y };
        if (![point.x, point.y].every(Number.isFinite))
          throw Error('Original waypoint overflows document coordinates.');
        // A retained disposed handle needs only its own identity/point, not
        // the complete stored waypoint array owned by the capture registry.
        const record: RecordData = {
          scope: root.scope,
          layerId: root.layerId,
          spanId: root.spanId,
          shapeId: root.shapeId,
          origin: root.origin,
          shapeIds: root.shapeIds,
          waypointIndex,
          point,
        };
        const token = JSON.stringify([layerId, spanId]);
        if (!qualified.has(token)) {
          const data = scope.snapshot(),
            span = data.layers
              .find((l) => l.id === layerId)!
              .liveMotionSpans!.find((s) => s.id === spanId)!;
          const sampler = createMotionFrameSampler(data, layerId, span);
          sampler.dispose();
          current();
          qualified.add(token);
        }
        const handle: LiveMovieTreeWaypointOwner = Object.freeze({
          layerId,
          spanId,
          shapeId: record.shapeId,
          waypointIndex,
          frame,
          revision,
          shapeIds: record.shapeIds,
          point: Object.freeze({ ...record.point }),
        });
        owners.set(handle, record);
        current();
        return handle;
      },
      assertCurrent: current,
      dispose,
    };
  } catch (cause) {
    dispose();
    throw cause;
  }
}
export type LiveMovieTreeWaypointRequest = { owner: LiveMovieTreeWaypointOwner; target: Point };
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored origins, never relative to proposed/current poses. */
export function prepareLiveMovieTreeWaypointPositions(
  requests: readonly LiveMovieTreeWaypointRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original nested movie waypoint controls.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid nested movie waypoint control request.');
      const own = Object.getOwnPropertyDescriptor(r, 'owner'),
        point = Object.getOwnPropertyDescriptor(r, 'target');
      if (
        !own ||
        !point ||
        !own.enumerable ||
        !point.enumerable ||
        !('value' in own) ||
        !('value' in point)
      )
        throw Error('Choose enumerable original waypoint owner/target data fields.');
      const handle = own.value as LiveMovieTreeWaypointOwner,
        record = owners.get(handle),
        target = point.value as Point;
      if (
        !record ||
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        Reflect.ownKeys(target).some((k) => k !== 'x' && k !== 'y')
      )
        throw Error('Choose original private waypoint ownership and document target data.');
      const x = Object.getOwnPropertyDescriptor(target, 'x'),
        y = Object.getOwnPropertyDescriptor(target, 'y');
      if (
        !x ||
        !y ||
        !('value' in x) ||
        !('value' in y) ||
        !x.enumerable ||
        !y.enumerable ||
        ![x.value, y.value].every((v) => typeof v === 'number' && Number.isFinite(v))
      )
        throw Error('Choose finite original document target coordinates.');
      return { record, handle, target: { x: x.value as number, y: y.value as number } };
    });
  const scope = rows[0].record.scope,
    source = scope.identity(),
    previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Nested movie waypoint control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate')
    )
      throw Error('Invalid nested movie waypoint control admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      descriptor &&
      (!('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose an original admission callback data field.');
    const validate = descriptor?.value as (() => void) | undefined,
      prototype = Object.getPrototypeOf(options);

    const admitCallback = () => {
      const now = Object.getOwnPropertyDescriptor(options, 'validate');
      if (
        Object.getPrototypeOf(options) !== prototype ||
        Reflect.ownKeys(options).some((k) => k !== 'validate') ||
        !!now !== !!descriptor ||
        (now && (!('value' in now) || now.value !== validate))
      )
        throw Error('Nested movie waypoint admission callback changed.');
    };
    const current = () => {
      admitCallback();
      const value = validate?.() as unknown;
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw Error('Nested movie waypoint admission must be synchronous.');
      }
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error('Nested movie waypoint requests changed, reentered or crossed capture scopes.');
      scope.current();
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Nested movie waypoint requests changed after source admission.');
    };
    current();
    const selected = new Set<string>(),
      data = scope.snapshot(),
      updates = new Map<string, UpdateLiveMotionRequest>();
    for (const row of rows) {
      const r = row.record,
        token = JSON.stringify([r.layerId, r.spanId]),
        slot = JSON.stringify([r.layerId, r.spanId, r.waypointIndex]);
      // Different root hints share each stored slot. Alias requests must not
      // silently overwrite one another; distinct slots compose in one update.
      if (selected.has(slot)) throw Error('Choose each original shared waypoint slot once.');
      selected.add(slot);
      const span = data.layers
          .find((l) => l.id === r.layerId)!
          .liveMotionSpans!.find((s) => s.id === r.spanId)!,
        x = row.target.x - r.origin.x,
        y = row.target.y - r.origin.y;
      if (![x, y].every(Number.isFinite))
        throw Error('Nested movie waypoint target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Nested movie waypoint target is unchanged.');
      let update = updates.get(token);
      if (!update) {
        update = {
          layerId: r.layerId,
          spanId: r.spanId,
          changes: {
            path: { ...span.path!, waypoints: span.path!.waypoints!.map((p) => ({ ...p })) },
          },
        };
        updates.set(token, update);
      }
      (update.changes.path!.waypoints as Point[])[r.waypointIndex] = { x, y };
    }
    current();
    const candidate = prepareUpdateLiveMotionSpans(data, [...updates.values()], {
      validate: current,
    });
    const expected = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
    if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== scope.topology())
      throw Error('Nested movie waypoint candidate clock topology changed.');
    current();
    const output = structuredClone(candidate);
    validateProject(output);
    if (selectionTrajectoryStamp(compileMovieClockPlan(output)) !== scope.topology())
      throw Error('Nested movie waypoint output clock topology changed.');
    current();
    validateLiveGraphicData(candidate);
    validateLiveGraphicData(output);
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Nested movie waypoint complete candidate changed during final admission.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
