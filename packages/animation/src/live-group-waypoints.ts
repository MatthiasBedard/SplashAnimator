import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export interface LiveGroupWaypointOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly groupId: string;
  readonly groupShapeIds: readonly string[];
  readonly shapeId: string;
  readonly waypointIndex: number;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
  readonly point: Readonly<Point>;
}
type Scope = { identity(): Project; current(): void; source(): Project; snapshot(): Project };
type RecordData = {
  scope: Scope;
  layerId: string;
  spanId: string;
  groupId: string;
  groupShapeIds: readonly string[];
  shapeId: string;
  waypointIndex: number;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
type RootRecordData = Omit<RecordData, 'waypointIndex' | 'point'> & { waypoints: readonly Point[] };
const owners = new WeakMap<LiveGroupWaypointOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, group: string) => JSON.stringify([layer, span, group]);
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const value = reader();
  if (!value || typeof value !== 'object')
    throw Error('Choose original live group waypoint source data.');
  const fields = ['project', 'revision', 'frame'].map((k) =>
    Object.getOwnPropertyDescriptor(value, k),
  );
  if (fields.some((d) => !d || !('value' in d)))
    throw Error('Live group waypoint source requires original data fields.');
  const [project, revision, frame] = fields.map((d) => d!.value);
  validateLiveMotionData(project);
  if (
    !project ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    frame >= project.duration
  )
    throw Error('Invalid live group waypoint source/frame/revision.');
  return { project, revision, frame };
}
/** Original complete outer-group references to existing stored shared slots.
 * The ordered first start-member supplies the document origin. Editing a slot
 * changes shared span offsets for every group/loose root, not a subgroup route.
 * Root waypoints and group cubic controls retain their separate brands/scope. */
export function captureLiveGroupWaypoints(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original live group waypoint source reader.');
  const first = read(readSource),
    stamp = selectionTrajectoryStamp(first.project),
    frame = first.frame,
    revision = first.revision;
  let source: Project | undefined = first.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    dead = false,
    reading = false;
  const records = new Map<string, RootRecordData>(),
    qualified = new Set<string>();
  function dispose() {
    dead = true;
    source = undefined;
    snapshot = undefined;
    reader = undefined;
    records.clear();
    qualified.clear();
  }
  function current() {
    if (dead || !reader || !source)
      throw Error('Live group waypoint capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live group waypoint source cannot reenter.');
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
        throw Error('Live group waypoint original source/frame/revision changed.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  const scope: Scope = {
    identity: () => {
      if (dead || !source) throw Error('Live group waypoint capture is stale or disposed.');
      return source;
    },
    current,
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
    for (const layer of snapshot.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const span of layer.liveMotionSpans ?? []) {
        if (
          frame < span.start ||
          frame > span.end ||
          !span.path ||
          span.rotation?.rigidGroups !== true ||
          span.path.waypoints === undefined
        )
          continue;
        const start = layer.keys.find((k) => k.frame === span.start)!;
        const ids = Object.freeze(start.shapes.map((s) => s.id));
        // Store one group record and share the original route/complete IDs.
        // Slot ownership is resolved lazily, never groups times waypoint count.
        const groups = new Map<string, typeof start.shapes>();
        for (const shape of start.shapes) {
          const id = shape.groups?.[0];
          if (!id) continue;
          const members = groups.get(id) ?? [];
          members.push(shape);
          groups.set(id, members);
        }
        for (const [groupId, members] of groups) {
          const shape = members[0];
          records.set(key(layer.id, span.id, groupId), {
            scope,
            layerId: layer.id,
            spanId: span.id,
            groupId,
            groupShapeIds: Object.freeze(members.map((s) => s.id)),
            shapeId: shape.id,
            origin: { x: shape.x, y: shape.y },
            shapeIds: ids,
            waypoints: span.path.waypoints,
          });
        }
      }
    }
    current();
    return {
      get choices() {
        current();
        const hints = [...records.values()].map((r) => ({
            layerId: r.layerId,
            spanId: r.spanId,
            groupId: r.groupId,
            shapeId: r.shapeId,
            waypointCount: r.waypoints.length,
          })),
          expected = selectionTrajectoryStamp(hints),
          output = structuredClone(hints);
        current();
        if (selectionTrajectoryStamp(output) !== expected)
          throw Error('Live group waypoint public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        groupId: string,
        waypointIndex: number,
      ): LiveGroupWaypointOwner {
        current();
        if (
          ![layerId, spanId, groupId].every((v) => typeof v === 'string' && v.length > 0) ||
          !Number.isSafeInteger(waypointIndex) ||
          waypointIndex < 0
        )
          throw Error('Choose original string identities and an existing stored waypoint index.');
        const root = records.get(key(layerId, spanId, groupId));
        if (!root || waypointIndex >= root.waypoints.length)
          throw Error('Choose an existing original waypoint on a visible unlocked outer group.');
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
          groupId: root.groupId,
          groupShapeIds: root.groupShapeIds,
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
        const handle: LiveGroupWaypointOwner = Object.freeze({
          layerId,
          spanId,
          groupId,
          groupShapeIds: record.groupShapeIds,
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
export type LiveGroupWaypointRequest = { owner: LiveGroupWaypointOwner; target: Point };
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored origins, never relative to proposed/current poses. */
export function prepareLiveGroupWaypointPositions(
  requests: readonly LiveGroupWaypointRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveMotionData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live group waypoint controls.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid live group waypoint control request.');
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
      const handle = own.value as LiveGroupWaypointOwner,
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
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((k) => k !== 'validate')
  )
    throw Error('Invalid live group waypoint control admission.');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
  if (
    descriptor &&
    (!('value' in descriptor) ||
      (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
  )
    throw Error('Choose an original admission callback data field.');
  const validate = descriptor?.value as (() => void) | undefined;
  const scope = rows[0].record.scope,
    source = scope.identity(),
    previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Live group waypoint control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    const admitCallback = () => {
      const now = Object.getOwnPropertyDescriptor(options, 'validate');
      if (
        Reflect.ownKeys(options).some((k) => k !== 'validate') ||
        !!now !== !!descriptor ||
        (now && (!('value' in now) || now.value !== validate))
      )
        throw Error('Live group waypoint admission callback changed.');
    };
    const current = () => {
      admitCallback();
      const value = validate?.() as unknown;
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw Error('Live group waypoint admission must be synchronous.');
      }
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error('Live group waypoint requests changed, reentered or crossed capture scopes.');
      scope.current();
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Live group waypoint requests changed after source admission.');
    };
    current();
    const selected = new Set<string>(),
      data = scope.snapshot(),
      updates = new Map<string, UpdateLiveMotionRequest>();
    for (const row of rows) {
      const r = row.record,
        token = JSON.stringify([r.layerId, r.spanId]),
        slot = JSON.stringify([r.layerId, r.spanId, r.waypointIndex]);
      // Different group hints share each stored slot. Alias requests must not
      // silently overwrite one another; distinct slots compose in one update.
      if (selected.has(slot)) throw Error('Choose each original shared waypoint slot once.');
      selected.add(slot);
      const span = data.layers
          .find((l) => l.id === r.layerId)!
          .liveMotionSpans!.find((s) => s.id === r.spanId)!,
        x = row.target.x - r.origin.x,
        y = row.target.y - r.origin.y;
      if (![x, y].every(Number.isFinite))
        throw Error('Live group waypoint target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Live group waypoint target is unchanged.');
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
    current();
    if (selectionTrajectoryStamp(candidate) !== expected)
      throw Error('Live group waypoint complete candidate changed during final admission.');
    return candidate;
  } finally {
    preparing.delete(source);
  }
}
