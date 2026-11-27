import { validateGroupMotionPaths } from '../../document/src/motion-group-paths';
import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export type LiveIndependentCubicRole = 'start' | 'end';
export interface LiveIndependentGroupCubicControlOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly groupId: string;
  readonly shapeId: string;
  readonly groupShapeIds: readonly string[];
  readonly role: LiveIndependentCubicRole;
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
  role: LiveIndependentCubicRole;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
const owners = new WeakMap<LiveIndependentGroupCubicControlOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, shape: string, role: LiveIndependentCubicRole) =>
  JSON.stringify([layer, span, shape, role]);
const sourceReads = new WeakMap<() => LiveAuthoringSource, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const previous = sourceReads.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Independent group cubic source cannot reenter.');
  }
  const entry = { invalid: false };
  sourceReads.set(reader, entry);
  try {
    const value = reader();
    if (entry.invalid) throw Error('Independent group cubic source cannot reenter.');
    if (!value || typeof value !== 'object')
      throw Error('Choose original independent group cubic source data.');
    const fields = ['project', 'revision', 'frame'].map((k) =>
      Object.getOwnPropertyDescriptor(value, k),
    );
    if (fields.some((d) => !d?.enumerable || !('value' in d)))
      throw Error('Independent group cubic source requires original data fields.');
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
      throw Error('Invalid independent group cubic source/frame/revision.');
    return { project, revision, frame };
  } finally {
    sourceReads.delete(reader);
  }
}

/** Original controls on existing independent cubic banks only. The authored
 * group leader supplies its own start/end origin; shared-route controls and
 * current/proposed poses never own these picks. No bank is implicitly created.
 * Root/shared handles retain their separate private brands and scope. */
export function captureLiveIndependentGroupCubicControls(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original independent group cubic source reader.');
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
    if (dead || !reader || !source)
      throw Error('Independent group cubic capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Independent group cubic source cannot reenter.');
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
        throw Error('Independent group cubic original source/frame/revision changed.');
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
    validateLiveGraphicData(snapshot);
    current();
    for (const layer of snapshot.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const span of layer.liveMotionSpans ?? []) {
        if (
          frame < span.start ||
          frame > span.end ||
          !span.groupPaths?.length ||
          span.rotation?.rigidGroups !== true
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
        const banksByGroup = new Map(span.groupPaths.map((binding) => [binding.groupId, binding]));
        for (const [groupId, members] of groups) {
          const bank = banksByGroup.get(groupId);
          if (!bank || bank.path.waypoints !== undefined) continue;
          const shape = members[0],
            groupShapeIds = Object.freeze(members.map((s) => s.id));
          for (const role of ['start', 'end'] as const) {
            const endpoint = role === 'start' ? shape : endById.get(shape.id);
            if (!endpoint) throw Error('Original independent group cubic membership changed.');
            const origin = { x: endpoint.x, y: endpoint.y },
              point = {
                x: origin.x + bank.path[role === 'start' ? 'startX' : 'endX'],
                y: origin.y + bank.path[role === 'start' ? 'startY' : 'endY'],
              };
            if (![point.x, point.y].every(Number.isFinite))
              throw Error(
                'Original independent group cubic control overflows document coordinates.',
              );
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
          throw Error('Independent group cubic public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        groupId: string,
        role: LiveIndependentCubicRole,
      ): LiveIndependentGroupCubicControlOwner {
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
        const handle: LiveIndependentGroupCubicControlOwner = Object.freeze({
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
export type LiveIndependentGroupCubicControlRequest = {
  owner: LiveIndependentGroupCubicControlOwner;
  target: Point;
};
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored origins, never relative to proposed/current poses. */
export function prepareLiveIndependentGroupCubicControlPositions(
  requests: readonly LiveIndependentGroupCubicControlRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original independent group cubic controls.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid independent group cubic control request.');
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
      const handle = own.value as LiveIndependentGroupCubicControlOwner,
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
    throw Error('Independent group cubic control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate') ||
      (!Object.hasOwn(options, 'validate') && 'validate' in options)
    )
      throw Error('Invalid independent group cubic control admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      descriptor &&
      (!descriptor.enumerable ||
        !('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose an original admission callback data field.');
    const validate = descriptor?.value as (() => void) | undefined;
    const current = () => {
      const value = validate?.() as unknown;
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw Error('Independent group cubic admission must be synchronous.');
      }
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error(
          'Independent group cubic requests changed, reentered or crossed capture scopes.',
        );
      scope.current();
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Independent group cubic requests changed after source admission.');
    };
    current();
    const selected = new Set<string>(),
      data = scope.snapshot(),
      updates: UpdateLiveMotionRequest[] = [];
    type Bank = NonNullable<UpdateLiveMotionRequest['changes']['groupPaths']>;
    const banks = new Map<string, Bank>();
    const bankMembers = new Map<string, Map<string, Bank[number]>>();
    const capturedBank = (
      span: NonNullable<Project['layers'][number]['liveMotionSpans']>[number],
      bankKey: string,
    ) => {
      const previous = banks.get(bankKey);
      if (previous) return previous;
      const original = span.groupPaths!,
        expected = selectionTrajectoryStamp(original),
        copy = structuredClone(original);
      validateLiveGraphicData(copy);
      validateGroupMotionPaths(copy);
      if (
        selectionTrajectoryStamp(copy) !== expected ||
        selectionTrajectoryStamp(original) !== expected
      )
        throw Error('Independent group cubic original bank clone changed.');
      bankMembers.set(bankKey, new Map(copy.map((binding) => [binding.groupId, binding])));
      return copy;
    };
    for (const row of rows) {
      const r = row.record,
        token = JSON.stringify([r.layerId, r.spanId, r.groupId]);
      if (selected.has(token)) throw Error('Choose each complete original live trajectory once.');
      selected.add(token);
      const span = data.layers
          .find((l) => l.id === r.layerId)!
          .liveMotionSpans!.find((s) => s.id === r.spanId)!,
        bankKey = JSON.stringify([r.layerId, r.spanId]),
        bank = capturedBank(span, bankKey),
        binding = bankMembers.get(bankKey)!.get(r.groupId)!,
        path = binding.path,
        x = row.target.x - r.origin.x,
        y = row.target.y - r.origin.y;
      if (![x, y].every(Number.isFinite))
        throw Error('Independent group cubic target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Independent group cubic control target is unchanged.');
      // An explicit checked control edit starts a new ordinary distance clock.
      // Reopen/refresh and unrelated bank edits retain their original descriptor.
      delete binding.restrictedArc;
      if (r.role === 'start') {
        path.startX = x;
        path.startY = y;
      } else {
        path.endX = x;
        path.endY = y;
      }
      banks.set(bankKey, bank);
      if (!updates.some((update) => update.layerId === r.layerId && update.spanId === r.spanId))
        updates.push({ layerId: r.layerId, spanId: r.spanId, changes: { groupPaths: bank } });
    }
    current();
    const candidate = prepareUpdateLiveMotionSpans(data, updates, { validate: current });
    const expected = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
    current();
    validateLiveGraphicData(candidate);
    if (selectionTrajectoryStamp(candidate) !== expected)
      throw Error('Independent group cubic complete candidate changed during final admission.');
    return candidate;
  } finally {
    preparing.delete(source);
  }
}
