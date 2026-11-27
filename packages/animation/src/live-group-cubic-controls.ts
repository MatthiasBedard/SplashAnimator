import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export type LiveCubicRole = 'start' | 'end';
export interface LiveGroupCubicControlOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly groupId: string;
  readonly shapeId: string;
  readonly groupShapeIds: readonly string[];
  readonly role: LiveCubicRole;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
  readonly point: Readonly<Point>;
}
type Scope = { current(): void; source(): Project; snapshot(): Project };
type RecordData = {
  scope: Scope;
  layerId: string;
  spanId: string;
  groupId: string;
  groupShapeIds: readonly string[];
  shapeId: string;
  role: LiveCubicRole;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
const owners = new WeakMap<LiveGroupCubicControlOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, shape: string, role: LiveCubicRole) =>
  JSON.stringify([layer, span, shape, role]);
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const value = reader();
  if (!value || typeof value !== 'object')
    throw Error('Choose original live group cubic source data.');
  const fields = ['project', 'revision', 'frame'].map((k) =>
    Object.getOwnPropertyDescriptor(value, k),
  );
  if (fields.some((d) => !d || !('value' in d)))
    throw Error('Live group cubic source requires original data fields.');
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
    throw Error('Invalid live group cubic source/frame/revision.');
  return { project, revision, frame };
}
/** Explicit outer-group references for an existing shared single-cubic recipe.
 * Each original first member supplies a document-space control reference. Editing
 * that reference changes the span's shared offsets for all groups/loose artwork,
 * never a separate subgroup path. Public hints cannot own membership or roles.
 * Root controls retain their separate brands and conservative scope. */
export function captureLiveGroupCubicControls(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original live group cubic source reader.');
  const first = read(readSource),
    stamp = selectionTrajectoryStamp(first.project),
    frame = first.frame,
    revision = first.revision;
  let source: Project | undefined = first.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    dead = false,
    reading = false;
  const records = new Map<string, RecordData>(),
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
    if (dead || !reader || !source) throw Error('Live group cubic capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live group cubic source cannot reenter.');
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
        throw Error('Live group cubic original source/frame/revision changed.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  const scope: Scope = {
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
          span.path.waypoints !== undefined
        )
          continue;
        const start = layer.keys.find((k) => k.frame === span.start)!,
          end = layer.keys.find((k) => k.frame === span.end)!;
        const ids = Object.freeze(start.shapes.map((s) => s.id));
        const endById = new Map(end.shapes.map((s) => [s.id, s]));
        const groups = new Map<string, typeof start.shapes>();
        for (const shape of start.shapes) {
          const id = shape.groups?.[0];
          if (!id) continue;
          const members = groups.get(id) ?? [];
          members.push(shape);
          groups.set(id, members);
        }
        for (const [groupId, members] of groups) {
          const shape = members[0],
            groupShapeIds = Object.freeze(members.map((s) => s.id));
          for (const role of ['start', 'end'] as const) {
            const endpoint = role === 'start' ? shape : endById.get(shape.id);
            if (!endpoint) throw Error('Original group cubic membership changed.');
            const origin = { x: endpoint.x, y: endpoint.y },
              point = {
                x: origin.x + span.path[role === 'start' ? 'startX' : 'endX'],
                y: origin.y + span.path[role === 'start' ? 'startY' : 'endY'],
              };
            if (![point.x, point.y].every(Number.isFinite))
              throw Error('Original group cubic control overflows document coordinates.');
            records.set(key(layer.id, span.id, groupId, role), {
              scope,
              layerId: layer.id,
              spanId: span.id,
              groupId,
              shapeId: shape.id,
              groupShapeIds,
              role,
              origin,
              point,
              shapeIds: ids,
            });
          }
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
            role: r.role,
            point: { ...r.point },
          })),
          expected = selectionTrajectoryStamp(hints),
          output = structuredClone(hints);
        current();
        if (selectionTrajectoryStamp(output) !== expected)
          throw Error('Live group cubic public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        groupId: string,
        role: LiveCubicRole,
      ): LiveGroupCubicControlOwner {
        current();
        if (
          ![layerId, spanId, groupId].every((v) => typeof v === 'string' && v.length > 0) ||
          (role !== 'start' && role !== 'end')
        )
          throw Error('Choose original string identities and an existing cubic control role.');
        const record = records.get(key(layerId, spanId, groupId, role));
        if (!record)
          throw Error(
            'Choose an existing original single-cubic control on a visible unlocked complete-group track.',
          );
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
        const handle: LiveGroupCubicControlOwner = Object.freeze({
          layerId,
          spanId,
          groupId,
          shapeId: record.shapeId,
          groupShapeIds: record.groupShapeIds,
          role,
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
export type LiveGroupCubicControlRequest = { owner: LiveGroupCubicControlOwner; target: Point };
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored origins, never relative to proposed/current poses. */
export function prepareLiveGroupCubicControlPositions(
  requests: readonly LiveGroupCubicControlRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveMotionData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live group cubic controls.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid live group cubic control request.');
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
        throw Error('Choose enumerable original cubic owner/target data fields.');
      const handle = own.value as LiveGroupCubicControlOwner,
        record = owners.get(handle),
        target = point.value as Point;
      if (
        !record ||
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        Reflect.ownKeys(target).some((k) => k !== 'x' && k !== 'y')
      )
        throw Error('Choose original private cubic ownership and document target data.');
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
    source = scope.source(),
    previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Live group cubic control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate')
    )
      throw Error('Invalid live group cubic control admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      descriptor &&
      (!('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose an original admission callback data field.');
    const validate = descriptor?.value as (() => void) | undefined;
    const current = () => {
      const value = validate?.() as unknown;
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw Error('Live group cubic admission must be synchronous.');
      }
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error('Live group cubic requests changed, reentered or crossed capture scopes.');
      scope.current();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Live group cubic requests changed after source admission.');
    };
    current();
    const selected = new Set<string>(),
      data = scope.snapshot(),
      updates: UpdateLiveMotionRequest[] = [];
    for (const row of rows) {
      const r = row.record,
        token = JSON.stringify([r.layerId, r.spanId]);
      if (selected.has(token)) throw Error('Choose each complete original live trajectory once.');
      selected.add(token);
      const span = data.layers
          .find((l) => l.id === r.layerId)!
          .liveMotionSpans!.find((s) => s.id === r.spanId)!,
        path = { ...span.path! },
        x = row.target.x - r.origin.x,
        y = row.target.y - r.origin.y;
      if (![x, y].every(Number.isFinite)) throw Error('Live group cubic target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Live group cubic control target is unchanged.');
      if (r.role === 'start') {
        path.startX = x;
        path.startY = y;
      } else {
        path.endX = x;
        path.endY = y;
      }
      updates.push({ layerId: r.layerId, spanId: r.spanId, changes: { path } });
    }
    current();
    const candidate = prepareUpdateLiveMotionSpans(data, updates, { validate: current });
    const expected = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
    current();
    if (selectionTrajectoryStamp(candidate) !== expected)
      throw Error('Live group cubic complete candidate changed during final admission.');
    return candidate;
  } finally {
    preparing.delete(source);
  }
}
