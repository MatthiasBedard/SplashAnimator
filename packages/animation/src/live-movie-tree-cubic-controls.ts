import { validateProject, type Project, type Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { compileMovieClockPlan } from './movie-clock-plan';
import { createMotionFrameSampler } from './motion-frames';
import { prepareUpdateLiveMotionSpans, type UpdateLiveMotionRequest } from './live-motion';
import { selectionTrajectoryStamp } from './selection-trajectory';
import type { LiveAuthoringSource } from './live-motion-owner';

export type LiveMovieTreeCubicRole = 'start' | 'end';
export interface LiveMovieTreeCubicControlOwner {
  readonly layerId: string;
  readonly spanId: string;
  readonly shapeId: string;
  readonly role: LiveMovieTreeCubicRole;
  readonly frame: number;
  readonly revision: number;
  readonly shapeIds: readonly string[];
  readonly point: Readonly<Point>;
}
type Scope = {
  current(): void;
  identity(): Project;
  source(): Project;
  snapshot(): Project;
  topology(): string;
};
type RecordData = {
  scope: Scope;
  layerId: string;
  spanId: string;
  shapeId: string;
  role: LiveMovieTreeCubicRole;
  origin: Point;
  point: Point;
  shapeIds: readonly string[];
};
const owners = new WeakMap<LiveMovieTreeCubicControlOwner, RecordData>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
const key = (layer: string, span: string, shape: string, role: LiveMovieTreeCubicRole) =>
  JSON.stringify([layer, span, shape, role]);
const sourceReads = new WeakMap<() => LiveAuthoringSource, { invalid: boolean }>();
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const previous = sourceReads.get(reader);
  if (previous) {
    previous.invalid = true;
    throw Error('Original nested movie cubic source cannot reenter.');
  }
  const entry = { invalid: false };
  sourceReads.set(reader, entry);
  let value: LiveAuthoringSource;
  try {
    value = reader();
    if (entry.invalid) throw Error('Original nested movie cubic source reentered.');
  } finally {
    sourceReads.delete(reader);
  }
  if (!value || typeof value !== 'object') throw Error('Invalid live nested movie cubic source.');
  const fields = ['project', 'revision', 'frame'].map((name) =>
    Object.getOwnPropertyDescriptor(value, name),
  );
  if (fields.some((field) => !field?.enumerable || !('value' in field)))
    throw Error('Live nested movie cubic source requires original data fields.');
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
    throw Error('Invalid live nested movie cubic project/revision/frame.');
  return { project: p as Project, revision: r as number, frame: f as number };
}
/** Existing nested-movie cubic controls, independent of split-space restrictions.
 * Public coordinates/choices are detached hints; only the original weak-branded
 * movie-root/role handle can prepare complete-recipe trajectory changes. */
export function captureLiveMovieTreeCubicControls(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function')
    throw Error('Choose an original nested movie cubic source reader.');
  const first = read(readSource),
    frame = first.frame,
    revision = first.revision;
  let source: Project | undefined = first.project,
    snapshot: Project | undefined,
    reader: (() => LiveAuthoringSource) | undefined = readSource,
    dead = false,
    reading = false,
    stamp = selectionTrajectoryStamp(first.project),
    topology = '';
  const records = new Map<string, RecordData>(),
    qualified = new Set<string>();
  function dispose() {
    dead = true;
    source = undefined;
    snapshot = undefined;
    reader = undefined;
    records.clear();
    qualified.clear();
    stamp = '';
    topology = '';
  }
  function current() {
    if (dead || !reader || !source) throw Error('Nested movie cubic capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Nested movie cubic source cannot reenter.');
    }
    reading = true;
    try {
      const next = read(reader);
      if (snapshot) validateLiveGraphicData(snapshot);
      if (
        dead ||
        next.project !== source ||
        next.revision !== revision ||
        next.frame !== frame ||
        selectionTrajectoryStamp(source) !== stamp ||
        (snapshot && selectionTrajectoryStamp(snapshot) !== stamp)
      )
        throw Error('Nested movie cubic original source/frame/revision changed.');
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      reading = false;
    }
  }
  const scope: Scope = {
    current,
    identity: () => {
      if (dead || !source) throw Error('Nested cubic capture is stale.');
      return source;
    },
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
          span.path.waypoints !== undefined
        )
          continue;
        const start = layer.keys.find((k) => k.frame === span.start)!,
          end = layer.keys.find((k) => k.frame === span.end)!;
        const ids = Object.freeze(start.shapes.map((s) => s.id));
        const endById = new Map(end.shapes.map((s) => [s.id, s]));
        for (const shape of start.shapes.filter((s) => s.kind === 'symbol'))
          for (const role of ['start', 'end'] as const) {
            const endpoint = role === 'start' ? shape : endById.get(shape.id);
            if (!endpoint) throw Error('Original cubic membership changed.');
            const origin = { x: endpoint.x, y: endpoint.y },
              point = {
                x: origin.x + span.path[role === 'start' ? 'startX' : 'endX'],
                y: origin.y + span.path[role === 'start' ? 'startY' : 'endY'],
              };
            if (![point.x, point.y].every(Number.isFinite))
              throw Error('Original cubic control overflows document coordinates.');
            records.set(key(layer.id, span.id, shape.id, role), {
              scope,
              layerId: layer.id,
              spanId: span.id,
              shapeId: shape.id,
              role,
              origin,
              point,
              shapeIds: ids,
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
            shapeId: r.shapeId,
            role: r.role,
            point: { ...r.point },
          })),
          expected = selectionTrajectoryStamp(hints),
          output = structuredClone(hints);
        current();
        validateLiveGraphicData(hints);
        validateLiveGraphicData(output);
        if (selectionTrajectoryStamp(output) !== expected)
          throw Error('Nested movie cubic public hints clone changed.');
        return output;
      },
      resolve(
        layerId: string,
        spanId: string,
        shapeId: string,
        role: LiveMovieTreeCubicRole,
      ): LiveMovieTreeCubicControlOwner {
        current();
        if (
          ![layerId, spanId, shapeId].every((v) => typeof v === 'string' && v.length > 0) ||
          (role !== 'start' && role !== 'end')
        )
          throw Error('Choose original string identities and an existing cubic control role.');
        const record = records.get(key(layerId, spanId, shapeId, role));
        if (!record)
          throw Error(
            'Choose an existing original single-cubic control on a visible unlocked nested movie track.',
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
        const handle: LiveMovieTreeCubicControlOwner = Object.freeze({
          layerId,
          spanId,
          shapeId,
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
export type LiveMovieTreeCubicControlRequest = {
  owner: LiveMovieTreeCubicControlOwner;
  target: Point;
};
/** A history-free, all-request candidate. Targets are document points relative to
 * privately captured authored origins, never relative to proposed/current poses. */
export function prepareLiveMovieTreeCubicControlPositions(
  requests: readonly LiveMovieTreeCubicControlRequest[],
  options: { validate?: () => void } = {},
): Project {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original nested movie cubic controls.');
  if (
    Object.getPrototypeOf(requests) !== Array.prototype ||
    Reflect.ownKeys(requests).length !== requests.length + 1 ||
    !Array.from({ length: requests.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(requests, String(i)),
    ).every((d) => d?.enumerable && 'value' in d)
  )
    throw Error('Choose dense original nested cubic requests.');
  const inputStamp = selectionTrajectoryStamp(requests),
    rows = requests.map((r) => {
      if (!r || Reflect.ownKeys(r).some((k) => k !== 'owner' && k !== 'target'))
        throw Error('Invalid nested movie cubic control request.');
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
      const handle = own.value as LiveMovieTreeCubicControlOwner,
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
    source = scope.identity(),
    previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Nested movie cubic control preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate') ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))
    )
      throw Error('Invalid nested movie cubic control admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (!descriptor && 'validate' in options) throw Error('Choose an own admission field.');
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
        throw Error('Nested movie cubic admission must be synchronous.');
      }
      validateLiveGraphicData(requests);
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle || r.record.scope !== scope)
      )
        throw Error('Nested movie cubic requests changed, reentered or crossed capture scopes.');
      scope.current();
      if (scope.source() !== source) throw Error('Nested cubic original source changed.');
      validateLiveGraphicData(requests);
      if (
        entry.invalid ||
        selectionTrajectoryStamp(requests) !== inputStamp ||
        rows.some((r, i) => requests[i].owner !== r.handle)
      )
        throw Error('Nested movie cubic requests changed after source admission.');
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
      if (![x, y].every(Number.isFinite))
        throw Error('Nested movie cubic target offset overflows.');
      if (row.target.x === r.point.x && row.target.y === r.point.y)
        throw Error('Nested movie cubic control target is unchanged.');
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
    if (selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== scope.topology())
      throw Error('Nested cubic candidate clock topology changed.');
    current();
    const output = structuredClone(candidate);
    validateProject(output);
    if (selectionTrajectoryStamp(compileMovieClockPlan(output)) !== scope.topology())
      throw Error('Nested cubic output clock topology changed.');
    current();
    validateLiveGraphicData(candidate);
    validateLiveGraphicData(output);
    if (
      selectionTrajectoryStamp(candidate) !== expected ||
      selectionTrajectoryStamp(output) !== expected
    )
      throw Error('Nested cubic complete candidate changed.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
