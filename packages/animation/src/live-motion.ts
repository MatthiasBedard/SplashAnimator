import { validateGroupMotionPaths } from '../../document/src/motion-group-paths';
import { freezeSnapshot } from '../../document/src/immutable-snapshot';
import {
  keyAt,
  validateProject,
  type Project,
  type Keyframe,
  type LiveMotionSpan,
} from '../../document/src';
import { validatePositionEaseArray, allIntervalTimingFields, validateLiveMotionData, validateLiveGraphicData, validateGradientColorTracks, validateLiveNumericKeys, liveNumericChannels, validateLiveColorKeys, liveColorChannels } from '../../document/src/live-motion';
import { validateMotionRotation } from '../../document/src/motion-rotation';
import { validateMotionEase } from '../../document/src/motion-ease';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
import { createMotionFrameSampler, type MotionFrameSampler } from './motion-frames';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { compileMovieClockPlan } from './movie-clock-plan';

function hasMovieTrees(project: Project) {
  return project.layers.some((l) =>
    l.liveMotionSpans?.some((s) => s.symbolContinuity === 'movie-trees' || s.nestedGraphicMovies !== undefined),
  );
}
function outsideLiveRecipes(project: Project) {
  return selectionTrajectoryStamp({
    ...project,
    layers: project.layers.map((l) => ({ ...l, liveMotionSpans: undefined })),
  });
}

export type LiveMotionRequest = { layerId: string; span: LiveMotionSpan };
export type RemoveLiveMotionRequest = { layerId: string; spanId: string };
export type UpdateLiveMotionRequest = {
  layerId: string;
  spanId: string;
  changes: Partial<
    Pick<
      LiveMotionSpan,
      'sxKeyEases' | 'syKeyEases' | 'shearKeyEases' | 'strokeKeyEases' | 'fillKeyEases' | 'rotationKeyEases' | 'opacityKeyEases' | 'xKeyEases' | 'yKeyEases' | 'ease' | 'options' | 'opacityEase' | 'paintEase' | 'path' | 'guide' | 'rotation' | 'groupPaths' | 'gradientColorTracks' | 'shearKeys' | 'rotationKeys' | 'scaleXKeys' | 'scaleYKeys' | 'opacityKeys' | 'xKeys' | 'yKeys' | 'strokeColorKeys' | 'fillColorKeys'
    >
  >;
};
type Admission = { validate?: () => void };
const preparing = new WeakMap<Project, { invalid: boolean }>();
function sync(validate: Admission['validate']) {
  const value = validate?.() as unknown;
  if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw Error('Live motion admission must be synchronous.');
  }
}
/** Sample a sparse recipe without adding keys or changing its stored endpoints. */
export function createLiveMotionSpanSampler(project: Project, layerId: string, span: LiveMotionSpan) {
  // Locks/visibility govern commands, not read-only presentation. No source write.
  const sampler = createMotionFrameSampler(
    {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible: true, locked: false } : layer,
      ),
    },
    layerId,
    span,
  );
  try {
    const layer = project.layers.find((layer) => layer.id === layerId)!;
    for (const frame of [span.start, span.end])
      if (
        (span.symbolContinuity !== undefined ? selectionTrajectoryStamp : JSON.stringify)(
          sampler.sample(frame),
        ) !==
        (span.symbolContinuity !== undefined ? selectionTrajectoryStamp : JSON.stringify)(
          layer.keys.find((key) => key.frame === frame)!.shapes,
        )
      )
        throw Error('Live motion endpoint capture changed.');
    return sampler;
  } catch (cause) {
    sampler.dispose();
    throw cause;
  }
}
// A caller may validate ownership while preparing a detached candidate. Reject
// reentrant preparation so that its admission check cannot validate stale state.
function prepare<T>(
  project: Project,
  requests: readonly T[],
  options: Admission,
  edit: (candidate: Project, requests: readonly T[]) => void,
): Project {
  const previous = preparing.get(project);
  if (previous) {
    previous.invalid = true;
    throw Error('Live motion preparation cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(project, entry);
  try {
    const sourceStamp = selectionTrajectoryStamp(project),
      inputStamp = selectionTrajectoryStamp(requests);
    validateLiveMotionData(requests);
    for (const request of Array.isArray(requests) ? requests : [])
      for (const field of ['span', 'changes']) {
        const row = Object.getOwnPropertyDescriptor(request, field);
        if (row && 'value' in row && row.value && typeof row.value === 'object') {
          for (const {field} of liveColorChannels) {
            if (!(field in row.value)) continue;
            const keys=Object.getOwnPropertyDescriptor(row.value,field);
            if (!keys?.enumerable || !('value' in keys)) throw Error('Color keys require original own data.');
            if (keys.value !== undefined) validateLiveColorKeys(keys.value,project.duration);
          }
          for(const field of allIntervalTimingFields){
            if(!(field in row.value))continue;
            const timing=Object.getOwnPropertyDescriptor(row.value,field);
            if(!timing?.enumerable || !('value' in timing))throw Error('Position timing requires original data.');
            if(timing.value!==undefined)validatePositionEaseArray(timing.value);
          }
          for (const {field} of liveNumericChannels) {
            if (!(field in row.value)) continue;
            const keys=Object.getOwnPropertyDescriptor(row.value,field);
            if (!keys?.enumerable || !('value' in keys)) throw Error('Position keys require original own data.');
            if (keys.value !== undefined) validateLiveNumericKeys(keys.value,project.duration,field);
          }
          if ('gradientColorTracks' in row.value) {
            const d=Object.getOwnPropertyDescriptor(row.value,'gradientColorTracks');
            if (!d?.enumerable || !('value' in d)) throw Error('Gradient keys require original data.');
            if (d.value !== undefined) validateGradientColorTracks(d.value,project.duration);
          }
          if ('guide' in row.value) {
            validateLiveGraphicData(project);
            validateLiveGraphicData(row.value);
            if (!Object.hasOwn(row.value, 'guide')) throw Error('Choose an original guide binding.');
          }
          const bank = Object.getOwnPropertyDescriptor(row.value, 'groupPaths');
          if (
            (!bank && 'groupPaths' in row.value) ||
            (bank && (!bank.enumerable || !('value' in bank)))
          )
            throw Error('Independent group update requires original bank data.');
          if (bank?.value !== undefined) validateGroupMotionPaths(bank.value);
        }
      }
    if (!Array.isArray(requests) || !requests.length)
      throw Error('Choose one or more live motion requests.');
    if (Array.isArray(requests))
      for (const key of Reflect.ownKeys(requests)) {
        const row = Object.getOwnPropertyDescriptor(requests, key),
          request = row && 'value' in row ? row.value : undefined;
        if (!request || typeof request !== 'object') continue;
        const field = Object.getOwnPropertyDescriptor(request, 'span'),
          span = field && 'value' in field ? field.value : undefined;
        if (span && typeof span === 'object' && ('symbolContinuity' in span || 'nestedGraphicMovies' in span)) {
          validateLiveGraphicData(project);
          validateLiveGraphicData(requests);
          const mode = Object.getOwnPropertyDescriptor(span, 'symbolContinuity');
          if (!mode?.enumerable || !('value' in mode))
            throw Error('Choose original graphic continuity data.');
        }
      }

    const nestedRequests =
      hasMovieTrees(project) ||
      requests.some((request) => {
        if (!request || typeof request !== 'object') return false;
        const field = Object.getOwnPropertyDescriptor(request, 'span');
        return !!field && 'value' in field && (field.value?.symbolContinuity === 'movie-trees' || field.value?.nestedGraphicMovies !== undefined);
      });
    if (nestedRequests) validateLiveGraphicData(requests);
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate')
    )
      throw Error('Invalid live motion admission.');
    const ownValidate = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      nestedRequests &&
      ((ownValidate && (!ownValidate.enumerable || !('value' in ownValidate))) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
    )
      throw Error('Nested movie admission requires original callback data.');
    const validate = nestedRequests
      ? (ownValidate?.value as Admission['validate'])
      : options.validate;
    if (validate !== undefined && typeof validate !== 'function')
      throw Error('Invalid live motion admission.');
    const current = () => {
      sync(validate);
      if (
        entry.invalid ||
        selectionTrajectoryStamp(project) !== sourceStamp ||
        selectionTrajectoryStamp(requests) !== inputStamp
      )
        throw Error('Live motion source or request changed.');
    };
    current();
    validateProject(project);
    current();
    const candidate = structuredClone(project),
      captured = structuredClone(requests);
    current();
    if (
      selectionTrajectoryStamp(candidate) !== sourceStamp ||
      selectionTrajectoryStamp(captured) !== inputStamp
    )
      throw Error('Live motion source or request clone changed.');
    // Transported plain-live data needs the same accessor/nonfinite admission
    // before command edits or ordinary artwork validation can read it.
    validateLiveMotionData(candidate);
    validateLiveMotionData(captured);
    edit(candidate, captured);
    validateLiveMotionData(candidate);
    const candidateStamp = selectionTrajectoryStamp(candidate);
    validateProject(candidate);
    if (nestedRequests) validateLiveGraphicData(project);
    const trees = hasMovieTrees(project) || hasMovieTrees(candidate);
    if (trees && selectionTrajectoryStamp(captured) !== inputStamp)
      throw Error('Captured nested movie requests changed during preparation.');
    const topology = trees ? selectionTrajectoryStamp(compileMovieClockPlan(project)) : undefined;
    if (
      trees &&
      (outsideLiveRecipes(candidate) !== outsideLiveRecipes(project) ||
        selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== topology)
    )
      throw Error('Nested movie preparation changed original artwork, library or clock lifetimes.');
    current();
    const output = structuredClone(candidate);
    validateLiveMotionData(output);
    validateProject(output);
    if (trees) validateLiveGraphicData(project);
    if (
      trees &&
      (outsideLiveRecipes(output) !== outsideLiveRecipes(project) ||
        selectionTrajectoryStamp(compileMovieClockPlan(output)) !== topology)
    )
      throw Error('Nested movie output changed original artwork, library or clock lifetimes.');
    current();
    if (trees)
      for (const value of [project, requests, captured, candidate, output])
        validateLiveGraphicData(value);
    if (
      selectionTrajectoryStamp(candidate) !== candidateStamp ||
      selectionTrajectoryStamp(output) !== candidateStamp ||
      (trees && selectionTrajectoryStamp(captured) !== inputStamp)
    )
      throw Error('Live motion candidate changed during admission.');
    return output;
  } finally {
    preparing.delete(project);
  }
}
/** Detached all-request admission. Stores only explicit recipes and authored
 * endpoint keys. Does not mutate a source, create history or certify every
 * integer frame by allocating a baked span. Sampling retains numeric admission. */
export function prepareCreateLiveMotionSpans(
  project: Project,
  requests: readonly LiveMotionRequest[],
  options: Admission = {},
): Project {
  return prepare(project, requests, options, (candidate, captured) => {
    const added: LiveMotionRequest[] = [];
    for (const request of captured) {
      if (!request || Reflect.ownKeys(request).some((k) => k !== 'layerId' && k !== 'span'))
        throw Error('Invalid live motion request.');
      const layer = candidate.layers.find((l) => l.id === request.layerId);
      if (!layer || !layer.visible || layer.locked)
        throw Error('Choose visible unlocked root live motion tracks.');
      layer.liveMotionSpans = [...(layer.liveMotionSpans ?? []), request.span].sort(
        (a, b) => a.start - b.start,
      );
      added.push(request);
    }
    validateProject(candidate);
    const plans: MotionFrameSampler[] = [];
    try {
      for (const request of added) plans.push(createLiveMotionSpanSampler(candidate, request.layerId, request.span));
    } finally {
      for (const sampler of plans) sampler.dispose();
    }
  });
}
/** Removing a recipe leaves every authored key and all other data exact. Incompatible
 * endpoint geometry is not sampled, so a structurally valid failed recipe can recover. */
export function prepareRemoveLiveMotionSpans(
  project: Project,
  requests: readonly RemoveLiveMotionRequest[],
  options: Admission = {},
): Project {
  return prepare(project, requests, options, (candidate, captured) => {
    const seen = new Set<string>();
    for (const request of captured) {
      if (!request || Reflect.ownKeys(request).some((k) => k !== 'layerId' && k !== 'spanId'))
        throw Error('Invalid live motion removal.');
      const token = JSON.stringify([request.layerId, request.spanId]),
        layer = candidate.layers.find((l) => l.id === request.layerId);
      if (
        seen.has(token) ||
        !layer ||
        !layer.visible ||
        layer.locked ||
        !layer.liveMotionSpans?.some((span) => span.id === request.spanId)
      )
        throw Error(
          'Choose a distinct existing live motion span on a visible unlocked root track.',
        );
      seen.add(token);
      const remaining = layer.liveMotionSpans.filter((span) => span.id !== request.spanId);
      if (remaining.length) layer.liveMotionSpans = remaining;
      else delete layer.liveMotionSpans;
    }
  });
}
/** Update only explicit easing/channel/options/path/rotation fields on original recipes.
 * A supplied rotation is a complete explicit header, not a partial flag merge.
 * Omitted fields retain their exact values; undefined removes an optional field.
 * Removed channel easings inherit geometry progress. Every changed recipe is
 * compiled before the detached candidate can return.
 * Authored keys, identity/boundaries and unrequested recipe fields are never rewritten. */
export function prepareUpdateLiveMotionSpans(
  project: Project,
  requests: readonly UpdateLiveMotionRequest[],
  options: Admission = {},
): Project {
  // Transport must not erase nonenumerable original request fields before the
  // detached request is compared or its allowed settings are checked.
  validateLiveMotionData(requests);
  const enumerableData = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Reflect.ownKeys(value)) {
      const field = Object.getOwnPropertyDescriptor(value, key)!;
      if (!field.enumerable && !(Array.isArray(value) && key === 'length'))
        throw Error('Live motion updates require enumerable original request data.');
      enumerableData(field.value);
    }
  };
  enumerableData(requests);
  if (Array.isArray(requests))
    for (const request of requests) {
      if (!request || typeof request !== 'object') continue;
      const changesField = Object.getOwnPropertyDescriptor(request, 'changes');
      if (!changesField || !('value' in changesField))
        throw Error('Live motion updates require original own changes data.');
      const changes = changesField.value as UpdateLiveMotionRequest['changes'];
      if (!changes || typeof changes !== 'object') continue;
      if (Object.hasOwn(changes, 'rotation') && changes.rotation !== undefined) {
        const rotation = changes.rotation;
        const fields = [
          'direction',
          'turns',
          'rigidGroups',
          'groupDepth',
          'uniformGroupScale',
          'axisGroupScale',
          'axisGroupShear',
          'savedGroupPivots',
          'rigidPivot',
        ];
        if (
          !rotation ||
          typeof rotation !== 'object' ||
          Array.isArray(rotation) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(rotation)) ||
          !Object.hasOwn(rotation, 'direction') ||
          !Object.hasOwn(rotation, 'turns') ||
          Reflect.ownKeys(rotation).some((k) => !fields.includes(k as string)) ||
          fields.some(
            (k) => !Object.hasOwn(rotation, k) && (k in rotation || k in Object.prototype),
          )
        )
          throw Error(
            'Choose a complete original live rotation header with supported own data fields.',
          );
        validateMotionRotation(rotation);
        if (
          rotation.rigidPivot !== undefined ||
          (rotation.rigidGroups && (rotation.groupDepth ?? 0) !== 0)
        )
          throw Error('Live group pivot or inner-depth continuity requires separate admission.');
      }
      if (Object.hasOwn(changes, 'path') && changes.path !== undefined) {
        const path = changes.path;
        const plain = (value: unknown): value is Record<string, unknown> =>
          !!value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          [Object.prototype, null].includes(Object.getPrototypeOf(value));
        if (
          !plain(path) ||
          !['startX', 'startY', 'endX', 'endY'].every((k) => Object.hasOwn(path, k)) ||
          Reflect.ownKeys(path).some(
            (k) =>
              ![
                'startX',
                'startY',
                'endX',
                'endY',
                'waypoints',
                'curvedWaypoints',
                'waypointTangents',
                'waypointIncoming',
                'distance',
                'tangent',
                'headingOffset',
                'headingOffsetEnd',
              ].includes(k as string),
          )
        )
          throw Error('Choose original live trajectory data and supported path fields.');
        for (const field of ['waypoints', 'waypointTangents', 'waypointIncoming'] as const) {
          const points = path[field];
          if (points === undefined) continue;
          if (
            !Array.isArray(points) ||
            Object.getPrototypeOf(points) !== Array.prototype ||
            Reflect.ownKeys(points).some(
              (k) =>
                k !== 'length' &&
                (typeof k !== 'string' ||
                  String(Number(k)) !== k ||
                  !Number.isSafeInteger(Number(k)) ||
                  Number(k) < 0 ||
                  Number(k) >= points.length),
            )
          )
            throw Error('Choose original trajectory point arrays.');
          for (const point of points)
            if (
              !plain(point) ||
              !Object.hasOwn(point, 'x') ||
              !Object.hasOwn(point, 'y') ||
              Reflect.ownKeys(point).some((k) => k !== 'x' && k !== 'y')
            )
              throw Error('Choose finite original trajectory point data.');
        }
        validateMotionPath(path as unknown as MotionPath);
      }
      for (const channel of ['opacityEase', 'paintEase'] as const)
        if (Object.hasOwn(changes, channel)) {
          const value = changes[channel];
          if (
            value &&
            typeof value === 'object' &&
            Reflect.ownKeys(value).some(
              (k) => !['kind', 'x1', 'y1', 'x2', 'y2'].includes(k as string),
            )
          )
            throw Error('Unknown live motion channel easing control.');
          if (value !== undefined) validateMotionEase(value);
        }
    }
  // Unlike serializable request data, the enclosing admission is a function. Capture
  // its own descriptor once without evaluating a getter or normalizing it in a clone.
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some((k) => k !== 'validate')
  )
    throw Error('Invalid live motion update admission.');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
  if (
    descriptor &&
    (!('value' in descriptor) ||
      (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
  )
    throw Error('Live motion update admission requires an original callback data field.');
  const validate = descriptor?.value as Admission['validate'];
  return prepare(project, requests, { validate }, (candidate, captured) => {
    const seen = new Set<string>(),
      updated: LiveMotionRequest[] = [];
    for (const request of captured) {
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Reflect.ownKeys(request).some(
          (k) => !['layerId', 'spanId', 'changes'].includes(k as string),
        )
      )
        throw Error('Invalid live motion update request.');
      const { changes } = request;
      if (
        !changes ||
        typeof changes !== 'object' ||
        Array.isArray(changes) ||
        !Reflect.ownKeys(changes).length ||
        Reflect.ownKeys(changes).some(
          (k) =>
            k !== 'ease' &&
            k !== 'options' &&
            k !== 'opacityEase' &&
            k !== 'paintEase' &&
            k !== 'path' && k !== 'guide' &&
            k !== 'groupPaths' &&
            k !== 'sxKeyEases' && k !== 'syKeyEases' && k !== 'shearKeyEases' && k !== 'fillKeyEases' && k !== 'strokeKeyEases' && k !== 'opacityKeyEases' && k !== 'rotationKeyEases' && k !== 'xKeyEases' && k !== 'yKeyEases' && k !== 'gradientColorTracks' && k !== 'shearKeys' && k !== 'rotationKeys' && k !== 'scaleXKeys' && k !== 'scaleYKeys' && k !== 'opacityKeys' && k !== 'xKeys' && k !== 'yKeys' && k !== 'strokeColorKeys' && k !== 'fillColorKeys' &&
            k !== 'rotation',
        )
      )
        throw Error('Choose explicit live motion easing or options changes.');
      const token = JSON.stringify([request.layerId, request.spanId]),
        layer = candidate.layers.find((l) => l.id === request.layerId),
        span = layer?.liveMotionSpans?.find((s) => s.id === request.spanId);
      if (seen.has(token) || !layer || !layer.visible || layer.locked || !span)
        throw Error('Choose distinct existing live motion spans on visible unlocked root tracks.');
      seen.add(token);
      if (Object.hasOwn(changes, 'ease')) span.ease = changes.ease!;
      for (const channel of ['opacityEase', 'paintEase'] as const)
        if (Object.hasOwn(changes, channel)) {
          if (changes[channel] === undefined) delete span[channel];
          else span[channel] = changes[channel];
        }
      if (Object.hasOwn(changes, 'options')) {
        if ((span.gradientColorTracks?.length || changes.gradientColorTracks?.length) &&
            !(Object.hasOwn(changes,'gradientColorTracks') && !changes.gradientColorTracks?.length) &&
            JSON.stringify(span.options?.gradientStops ?? false)!==JSON.stringify(changes.options?.gradientStops ?? false))
          throw Error('Clear gradient color tracks before changing stop correspondence.');
        if (changes.options === undefined) delete span.options;
        else span.options = changes.options;
      }
      if (Object.hasOwn(changes, 'path')) {
        if (changes.path === undefined) delete span.path;
        else span.path = changes.path;
      }
      if (Object.hasOwn(changes, 'guide')) {
        if (changes.guide === undefined) delete span.guide;
        else span.guide = changes.guide;
      }
      if (Object.hasOwn(changes, 'groupPaths')) {
        if (changes.groupPaths === undefined) delete span.groupPaths;
        else span.groupPaths = changes.groupPaths;
      }
      for (const {field} of liveColorChannels) {
        if (!Object.hasOwn(changes,field)) continue;
        if (changes[field] === undefined) delete span[field];
        else span[field] = changes[field];
      }
      for (const {field} of liveNumericChannels) {
        if (!Object.hasOwn(changes,field)) continue;
        if (changes[field] === undefined) delete span[field];
        else span[field] = changes[field];
      }
      for(const field of allIntervalTimingFields){
        if(!Object.hasOwn(changes,field))continue;
        if(changes[field]===undefined)delete span[field];else span[field]=changes[field];
      }
      if (Object.hasOwn(changes,'gradientColorTracks')) {
        if (changes.gradientColorTracks === undefined) delete span.gradientColorTracks;
        else span.gradientColorTracks=changes.gradientColorTracks;
      }
      if (Object.hasOwn(changes, 'rotation')) {
        if (changes.rotation === undefined) delete span.rotation;
        else span.rotation = changes.rotation;
      }
      updated.push({ layerId: layer.id, span });
    }
    validateProject(candidate);
    const plans: MotionFrameSampler[] = [];
    try {
      for (const request of updated) plans.push(createLiveMotionSpanSampler(candidate, request.layerId, request.span));
    } finally {
      for (const sampler of plans) sampler.dispose();
    }
  });
}
export type LiveMotionSource = { project: Project; revision: number };
export type LiveMotionTrack = { layerId: string; key: Keyframe; sampled: boolean; spanId?: string };
function readPair(reader: () => LiveMotionSource): LiveMotionSource {
  const value = reader();
  if (!value || typeof value !== 'object') throw Error('Invalid live motion source.');
  const p = Object.getOwnPropertyDescriptor(value, 'project'),
    r = Object.getOwnPropertyDescriptor(value, 'revision');
  if (
    !p ||
    !r ||
    !('value' in p) ||
    !('value' in r) ||
    !p.value ||
    !Number.isSafeInteger(r.value) ||
    r.value < 0
  )
    throw Error('Live motion requires an original project and exact revision data fields.');
  return { project: p.value as Project, revision: r.value as number };
}
/** One privately owned immutable source capture. A fresh capture sees edited
 * endpoints immediately, without Refresh or stored interior keys. Source edits,
 * revision changes, reentry and late disposal reject rather than replay stale poses.
 * This opt-in root API does not alter ordinary stage/export evaluation. */
export function captureLiveMotionTimeline(readSource: () => LiveMotionSource) {
  if (typeof readSource !== 'function') throw Error('Choose a live motion source reader.');
  let reader: (() => LiveMotionSource) | undefined = readSource;
  const first = readPair(readSource);
  let source: Project | undefined = first.project,
    revision = first.revision,
    stamp = selectionTrajectoryStamp(source),
    snapshot: Project | undefined;
  let busy = false,
    failed = false,
    disposed = false;
  const plans = new Map<string, Map<string, MotionFrameSampler>>();
  let treeTopology: string | undefined;
  function dispose() {
    disposed = true;
    for (const spans of plans.values()) for (const sampler of spans.values()) sampler.dispose();
    plans.clear();
    source = undefined;
    snapshot = undefined;
    reader = undefined;
    stamp = '';
    revision = -1;
  }
  function current() {
    if (disposed || failed || !reader || !source)
      throw Error('Live motion capture is stale or disposed.');
    const latest = readPair(reader);
    if (
      disposed ||
      failed ||
      latest.project !== source ||
      latest.revision !== revision ||
      selectionTrajectoryStamp(source) !== stamp
    )
      throw Error('Live motion source changed. Capture it again.');
    if (hasMovieTrees(source)) validateLiveGraphicData(source);
  }
  try {
    validateProject(source);
    current();
    snapshot = structuredClone(source);
    current();
    if (selectionTrajectoryStamp(snapshot) !== stamp)
      throw Error('Live motion source clone changed.');
    freezeSnapshot(snapshot);
    if (hasMovieTrees(snapshot))
      treeTopology = selectionTrajectoryStamp(compileMovieClockPlan(snapshot));
    for (const layer of snapshot.layers) {
      const spans = new Map<string, MotionFrameSampler>();
      plans.set(layer.id, spans);
      for (const span of layer.liveMotionSpans ?? [])
        spans.set(span.id, createLiveMotionSpanSampler(snapshot, layer.id, span));
    }
    current();
  } catch (cause) {
    dispose();
    throw cause;
  }
  return {
    sample(frame: number): LiveMotionTrack[] {
      if (busy) {
        failed = true;
        throw Error('Live motion sampling cannot reenter.');
      }
      busy = true;
      try {
        current();
        const data = snapshot!;
        if (!Number.isSafeInteger(frame) || frame < 0 || frame >= data.duration)
          throw Error('Choose an exact live motion frame.');
        const output: LiveMotionTrack[] = data.layers
          .filter((layer) => layer.visible)
          .map((layer) => {
            const span = layer.liveMotionSpans?.find(
              (span) => span.start < frame && frame < span.end,
            );
            return span
              ? {
                  layerId: layer.id,
                  key: { frame, shapes: plans.get(layer.id)!.get(span.id)!.sample(frame) },
                  sampled: true,
                  spanId: span.id,
                }
              : { layerId: layer.id, key: structuredClone(keyAt(layer, frame)), sampled: false };
          });
        const outputStamp = selectionTrajectoryStamp(output),
          candidate = structuredClone(data);
        if (selectionTrajectoryStamp(candidate) !== stamp)
          throw Error('Live motion validation clone changed.');
        // Validate all returned artwork together, without turning the temporary
        // sampled keys into persisted authored interior keys or changing recipes.
        for (const layer of candidate.layers) {
          delete layer.liveMotionSpans;
          const sampled = output.find((track) => track.layerId === layer.id && track.sampled);
          if (sampled) {
            const key = structuredClone(sampled.key);
            if (selectionTrajectoryStamp(key) !== selectionTrajectoryStamp(sampled.key))
              throw Error('Live motion validation artwork changed.');
            layer.keys = [...layer.keys.filter((key) => key.frame !== frame), key].sort(
              (a, b) => a.frame - b.frame,
            );
          }
        }
        validateProject(candidate);
        const treeCandidateStamp =
          treeTopology === undefined ? undefined : selectionTrajectoryStamp(candidate);
        if (
          treeTopology !== undefined &&
          selectionTrajectoryStamp(compileMovieClockPlan(candidate)) !== treeTopology
        )
          throw Error('Nested movie timeline pose changed original clock lifetimes.');
        current();
        if (treeTopology !== undefined) {
          validateLiveGraphicData(candidate);
          validateLiveGraphicData(output);
        }
        if (
          treeCandidateStamp !== undefined &&
          selectionTrajectoryStamp(candidate) !== treeCandidateStamp
        )
          throw Error('Nested movie timeline candidate changed during source admission.');
        if (selectionTrajectoryStamp(output) !== outputStamp)
          throw Error('Live motion output changed during admission.');
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
