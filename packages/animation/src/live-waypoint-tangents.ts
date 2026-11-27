import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { compileMovieClockPlan } from './movie-clock-plan';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export type LiveWaypointTangentRole = 'incoming' | 'outgoing';
export interface LiveWaypointTangentOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly shapeId: string;
  readonly waypointIndex: number;
  readonly role: LiveWaypointTangentRole;
  readonly anchor: Readonly<Point>;
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
  role: LiveWaypointTangentRole;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
type RootRecordData = Omit<RecordData, 'waypointIndex' | 'role' | 'point'> & {
  waypoints: readonly Point[];
  outgoing: readonly Point[];
  incoming: readonly Point[];
};
const owners = new WeakMap<LiveWaypointTangentOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, shape: string) => JSON.stringify([layer, span, shape]);
const sourceReads = new WeakMap<() => LiveAuthoringSource, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const previous = sourceReads.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Original explicit waypoint tangent source cannot reenter.');
  }
  const entry = { invalid: false };
  sourceReads.set(reader, entry);
  let value: LiveAuthoringSource;
  try {
    value = reader();
    if (entry.invalid) throw Error('Original explicit waypoint tangent source reentered.');
  } finally {
    sourceReads.delete(reader);
  }
  if (!value || typeof value !== 'object')
    throw Error('Choose original explicit waypoint tangent source data.');
  const fields = ['project', 'revision', 'frame'].map((k) =>
    Object.getOwnPropertyDescriptor(value, k),
  );
  if (fields.some((d) => !d?.enumerable || !('value' in d)))
    throw Error('Explicit waypoint tangent source requires original data fields.');
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
    throw Error('Invalid explicit waypoint tangent source/frame/revision.');
  return { project, revision, frame };
}
/** Existing explicit interior controls on original admitted non-rigid plain live roots.
 * Root/count hints are detached; only private original root/slot/role ownership
 * edits a shared signed control offset. Automatic/implicit controls stay unchanged. */
export function captureLiveWaypointTangents(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original explicit waypoint tangent source reader.');
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
      throw Error('Explicit waypoint tangent capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Explicit waypoint tangent source cannot reenter.');
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
        throw Error('Explicit waypoint tangent original source/frame/revision changed.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  const scope: Scope = {
    identity: () => {
      if (dead || !source) throw Error('Explicit waypoint tangent capture is stale or disposed.');
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
    validateLiveGraphicData(snapshot);
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
          span.symbolContinuity !== undefined ||
          span.rotation?.rigidGroups ||
          span.path.curvedWaypoints !== true ||
          span.path.waypoints === undefined ||
          span.path.waypointTangents === undefined ||
          span.path.waypointIncoming === undefined
        )
          continue;
        const start = layer.keys.find((k) => k.frame === span.start)!;
        const ids = Object.freeze(start.shapes.map((s) => s.id));
        // Share each original route/complete ID set across lazy root/slot owners.
        for (const shape of start.shapes)
          records.set(key(layer.id, span.id, shape.id), {
            scope,
            layerId: layer.id,
            spanId: span.id,
            shapeId: shape.id,
            origin: { x: shape.x, y: shape.y },
            shapeIds: ids,
            waypoints: span.path.waypoints,
            outgoing: span.path.waypointTangents,
            incoming: span.path.waypointIncoming,
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
          throw Error('Explicit waypoint tangent public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        shapeId: string,
        waypointIndex: number,
        role: LiveWaypointTangentRole,
      ): LiveWaypointTangentOwner {
        current();
        if (
          ![layerId, spanId, shapeId].every((v) => typeof v === 'string' && v.length > 0) ||
          !Number.isSafeInteger(waypointIndex) ||
          waypointIndex < 0 ||
          (role !== 'incoming' && role !== 'outgoing')
        )
          throw Error('Choose original string identities and an existing stored waypoint index.');
        const root = records.get(key(layerId, spanId, shapeId));
        if (!root || waypointIndex >= root.waypoints.length)
          throw Error(
            'Choose an existing original waypoint on a visible unlocked plain live root with explicit controls.',
          );
        const offset = root.waypoints[waypointIndex],
          anchor = { x: root.origin.x + offset.x, y: root.origin.y + offset.y },
          control =
            role === 'incoming' ? root.incoming[waypointIndex] : root.outgoing[waypointIndex + 1],
          point = { x: anchor.x + control.x, y: anchor.y + control.y };
        if (![anchor.x, anchor.y, point.x, point.y].every(Number.isFinite))
          throw Error('Original waypoint overflows document coordinates.');
        // A retained disposed handle needs only its own identity/point, not
        // the complete stored waypoint array owned by the capture registry.
        const record: RecordData = {
          scope: root.scope,
          layerId: root.layerId,
          spanId: root.spanId,
          shapeId: root.shapeId,
          origin: anchor,
          shapeIds: root.shapeIds,
          waypointIndex,
          role,
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
        const handle: LiveWaypointTangentOwner = Object.freeze({
          layerId,
          spanId,
          shapeId: record.shapeId,
          waypointIndex,
          role,
          anchor: Object.freeze({ ...record.origin }),
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
export type LiveWaypointTangentRequest = { owner: LiveWaypointTangentOwner; target: Point };
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored waypoint anchors, never proposed/current poses. */
export function prepareLiveWaypointTangentPositions(
  requests: readonly LiveWaypointTangentRequest[],
  options: { validate?: () => void } = {},
): Project {
  return prepareTangents(requests, options, false);
}
export type LiveWaypointTangentPairOptions = { coupling: 'aligned'; validate?: () => void };
/** Explicit aligned pair: retain the opposite ORIGINAL signed control radius in
 * document space. Artwork affine bases do not transform shared trajectory data. */
export function prepareLiveWaypointTangentPairs(
  requests: readonly LiveWaypointTangentRequest[],
  options: LiveWaypointTangentPairOptions,
): Project {
  return prepareTangents(requests, options, true);
}
function prepareTangents(
  requests: readonly LiveWaypointTangentRequest[],
  options: { validate?: () => void; coupling?: 'aligned' },
  paired: boolean,
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original explicit waypoint tangent controls.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid explicit waypoint tangent control request.');
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
      const handle = own.value as LiveWaypointTangentOwner,
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
    throw Error('Explicit waypoint tangent control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (paired && rows.some((row) => row.record.scope !== scope))
      throw Error('Paired waypoint controls require one original capture scope.');
    const allowed = paired ? ['validate', 'coupling'] : ['validate'];
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some((k) => !allowed.includes(k as string))
    )
      throw Error('Invalid explicit waypoint tangent control admission.');
    const coupling = paired ? Object.getOwnPropertyDescriptor(options, 'coupling') : undefined;
    if (paired && (!coupling?.enumerable || !('value' in coupling) || coupling.value !== 'aligned'))
      throw Error('Choose explicit aligned waypoint control coupling data.');
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
      const now = Object.getOwnPropertyDescriptor(options, 'validate'),
        pair = paired ? Object.getOwnPropertyDescriptor(options, 'coupling') : undefined;
      if (
        (paired && (!pair?.enumerable || !('value' in pair) || pair.value !== 'aligned')) ||
        Object.getPrototypeOf(options) !== prototype ||
        Reflect.ownKeys(options).some((k) => !allowed.includes(k as string)) ||
        !!now !== !!descriptor ||
        (now && (!('value' in now) || now.value !== validate))
      )
        throw Error('Explicit waypoint tangent admission callback changed.');
    };
    const current = () => {
      admitCallback();
      const value = validate?.() as unknown;
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw Error('Explicit waypoint tangent admission must be synchronous.');
      }
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error(
          'Explicit waypoint tangent requests changed, reentered or crossed capture scopes.',
        );
      scope.current();
      admitCallback();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Explicit waypoint tangent requests changed after source admission.');
    };
    current();
    const selected = new Set<string>(),
      data = scope.snapshot(),
      updates = new Map<string, UpdateLiveMotionRequest>();
    for (const row of rows) {
      const r = row.record,
        token = JSON.stringify([r.layerId, r.spanId]),
        slot = JSON.stringify([r.layerId, r.spanId, r.waypointIndex, r.role]);
      // Different root hints share each stored slot. Alias requests must not
      // silently overwrite one another; distinct slots compose in one update.
      const oppositeRole = r.role === 'incoming' ? 'outgoing' : 'incoming',
        oppositeSlot = paired
          ? JSON.stringify([r.layerId, r.spanId, r.waypointIndex, oppositeRole])
          : '';
      if (selected.has(slot) || (paired && selected.has(oppositeSlot)))
        throw Error('Choose each original shared waypoint slot once.');
      selected.add(slot);
      if (paired) selected.add(oppositeSlot);
      const span = data.layers
          .find((l) => l.id === r.layerId)!
          .liveMotionSpans!.find((s) => s.id === r.spanId)!,
        x = row.target.x - r.origin.x,
        y = row.target.y - r.origin.y;
      if (![x, y].every(Number.isFinite))
        throw Error('Explicit waypoint tangent target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Explicit waypoint tangent target is unchanged.');
      const selectedControl =
        r.role === 'incoming'
          ? span.path!.waypointIncoming![r.waypointIndex]
          : span.path!.waypointTangents![r.waypointIndex + 1];
      if (Reflect.ownKeys(selectedControl).some((key) => key !== 'x' && key !== 'y'))
        throw Error('Choose finite original trajectory point data.');
      let update = updates.get(token);
      if (!update) {
        update = {
          layerId: r.layerId,
          spanId: r.spanId,
          changes: {
            path: {
              ...span.path!,
              waypointTangents: span.path!.waypointTangents!.map((p) => ({ ...p })),
              waypointIncoming: span.path!.waypointIncoming!.map((p) => ({ ...p })),
            },
          },
        };
        updates.set(token, update);
      }
      const put = (role: LiveWaypointTangentRole, point: Point) => {
        if (role === 'incoming')
          (update!.changes.path!.waypointIncoming as Point[])[r.waypointIndex] = point;
        else (update!.changes.path!.waypointTangents as Point[])[r.waypointIndex + 1] = point;
      };
      if (paired) {
        const original =
            r.role === 'incoming'
              ? span.path!.waypointIncoming![r.waypointIndex]
              : span.path!.waypointTangents![r.waypointIndex + 1],
          opposite =
            oppositeRole === 'incoming'
              ? span.path!.waypointIncoming![r.waypointIndex]
              : span.path!.waypointTangents![r.waypointIndex + 1];
        if (!original || !opposite || ![opposite.x, opposite.y].every(Number.isFinite))
          throw Error('Aligned editing requires both original waypoint controls.');
        const scale = Math.max(Math.abs(x), Math.abs(y)),
          radius = Math.hypot(opposite.x, opposite.y);
        if (!(scale > 0) || !Number.isFinite(radius))
          throw Error('Aligned waypoint direction is zero or the original radius overflows.');
        const sx = x / scale,
          sy = y / scale,
          length = Math.hypot(sx, sy),
          ux = sx / length,
          uy = sy / length,
          ox = radius === 0 ? opposite.x : -ux * radius,
          oy = radius === 0 ? opposite.y : -uy * radius,
          nextRadius = Math.hypot(ox, oy);
        if (
          ![ux, uy, ox, oy, r.origin.x + ox, r.origin.y + oy, nextRadius].every(Number.isFinite) ||
          (x !== 0 && ux === 0) ||
          (y !== 0 && uy === 0) ||
          (radius > 0 && ((ux !== 0 && ox === 0) || (uy !== 0 && oy === 0))) ||
          Math.abs(nextRadius - radius) > Number.EPSILON * 8 * radius
        )
          throw Error('Aligned waypoint control radius or direction is numerically unresolved.');
        if (radius > 0) {
          const oppositeScale = Math.max(Math.abs(ox), Math.abs(oy)),
            ax = ox / oppositeScale,
            ay = oy / oppositeScale;
          if (
            sx * ax + sy * ay >= 0 ||
            Math.abs(sx * ay - sy * ax) > Number.EPSILON * 8 * length * Math.hypot(ax, ay)
          )
            throw Error('Aligned waypoint control direction is numerically unresolved.');
        }
        put(r.role, { ...original, x, y });
        put(oppositeRole, { ...opposite, x: ox, y: oy });
      } else put(r.role, { x, y });
    }
    current();
    const candidate = prepareUpdateLiveMotionSpans(data, [...updates.values()], {
      validate: current,
    });
    validateLiveGraphicData(candidate);
    const expected = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
    if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== scope.topology())
      throw Error('Explicit waypoint tangent candidate clock topology changed.');
    current();
    const output = structuredClone(candidate);
    validateLiveGraphicData(output);
    validateProject(output);
    if (selectionTrajectoryStamp(compileMovieClockPlan(output)) !== scope.topology())
      throw Error('Explicit waypoint tangent output clock topology changed.');
    current();
    validateLiveGraphicData(candidate);
    validateLiveGraphicData(output);
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Explicit waypoint tangent complete candidate changed during final admission.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
