import { validateProject, type Project } from '../../document/src';
import { validateLiveMotionData } from '../../document/src/live-motion';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { prepareIndependentGroupPath } from './independent-group-path';
import { splitSimpleMotionEase } from './motion-spans';
import { prepareRestrictedIndependentGroupPath } from './restricted-independent-group-path';
import { sameMotionArtwork } from './motion-ownership';
import { motionProgress } from './motion-frames';
import { splitRestrictedArcGeometry, type RestrictedArcGeometry } from './restricted-arc-geometry';
import { captureLiveMotionTimeline, type LiveMotionTrack } from './live-motion';
import {
  splitLiveGroupMotionLayer,
  splitRestrictedArcLiveGroupMotionLayer,
  splitRecursiveRestrictedArcLiveGroupMotionLayer,
} from './live-group-motion-split';
import { selectionTrajectoryStamp } from './selection-trajectory';

export type LiveAuthoringSource = { project: Project; revision: number; frame: number };
export interface LiveGroupOwner {
  readonly layerId: string;
  readonly shapeId: string;
  readonly groupId: string;
  readonly groupShapeIds: readonly string[];
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
type PrivateOwner = { capture: PrivateCapture; layerId: string; groupId: string; spanId: string };
const owners = new WeakMap<LiveGroupOwner, PrivateOwner>();
const preparing = new WeakMap<Project, { invalid: boolean }>();
function requireDetachedTree(source: unknown, copy: unknown) {
  const objects = new Set<object>(),
    pending = [source];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || objects.has(value)) continue;
    objects.add(value);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in d) pending.push(d.value);
  }
  const seen = new Set<object>(),
    copies = [copy];
  while (copies.length) {
    const value = copies.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    if (objects.has(value))
      throw Error('Restricted split clone is not detached from original data.');
    seen.add(value);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
      if ('value' in d) copies.push(d.value);
  }
}
function read(reader: () => LiveAuthoringSource): LiveAuthoringSource {
  const value = reader();
  if (!value || typeof value !== 'object') throw Error('Invalid live group split source.');
  const fields = ['project', 'revision', 'frame'].map((name) =>
    Object.getOwnPropertyDescriptor(value, name),
  );
  if (fields.some((field) => !field || !('value' in field)))
    throw Error('Live group split source requires original data fields.');
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
    throw Error('Invalid live group split project/revision/frame.');
  return { project: p as Project, revision: r as number, frame: f as number };
}
/** Explicit complete-group references for a whole-span split. Public scenes and
 * hints never own membership, and root split handles retain separate brands. */
export function captureLiveGroupMotionAuthoringFrame(readSource: () => LiveAuthoringSource) {
  if (typeof readSource !== 'function') throw Error('Choose a live group split source reader.');
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
      groups: Map<string, readonly string[]>;
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
    if (dead || !reader || !source) throw Error('Live group split capture is stale or disposed.');
    if (reading) {
      dispose();
      throw Error('Live group split source cannot reenter.');
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
        throw Error('Live group split source changed. Capture the frame again.');
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
      throw Error('Live group split scene capture changed.');
    for (const pose of privateScene) {
      if (!pose.sampled) continue;
      const layer = snapshot.layers.find((layer) => layer.id === pose.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === pose.spanId)!;
      if (
        layer.locked ||
        !layer.visible ||
        span.rotation?.rigidGroups !== true ||
        frame - span.start < 2 ||
        span.end - frame < 2
      )
        continue;
      const ids = layer.keys
        .find((key) => key.frame === span.start)!
        .shapes.map((shape) => shape.id);
      if (JSON.stringify(ids) !== JSON.stringify(pose.key.shapes.map((shape) => shape.id)))
        throw Error('Live group split artwork membership changed.');
      const membership = new Map<string, string[]>();
      for (const shape of layer.keys.find((key) => key.frame === span.start)!.shapes) {
        const groupId = shape.groups?.[0];
        if (!groupId) continue;
        const members = membership.get(groupId) ?? [];
        members.push(shape.id);
        membership.set(groupId, members);
      }
      const groups = new Map([...membership].map(([id, members]) => [id, Object.freeze(members)]));
      tracks.set(layer.id, {
        spanId: span.id,
        start: span.start,
        end: span.end,
        ids: Object.freeze(ids),
        groups,
      });
    }
    const captured: PrivateCapture = {
      current,
      identity: () => {
        if (dead || !source) throw Error('Live group split capture is stale or disposed.');
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
        throw Error('Live group split public clone changed.');
      return output;
    };
    return {
      get scene() {
        return detached(privateScene);
      },
      get choices() {
        return detached(
          [...tracks].flatMap(([layerId, track]) =>
            [...track.groups.keys()].map((groupId) => ({ layerId, spanId: track.spanId, groupId })),
          ),
        );
      },
      resolve(layerId: string, groupId: string): LiveGroupOwner {
        current();
        if (![layerId, groupId].every((v) => typeof v === 'string' && v.length > 0))
          throw Error('Choose original group string identities.');
        const track = tracks.get(layerId),
          group = track?.groups.get(groupId);
        if (!track || !group)
          throw Error('Choose an original complete outer group with split space on both sides.');
        const handle: LiveGroupOwner = Object.freeze({
          layerId,
          shapeId: group[0],
          groupId,
          groupShapeIds: group,
          spanId: track.spanId,
          start: track.start,
          end: track.end,
          frame,
          revision,
          shapeIds: track.ids,
        });
        owners.set(handle, { capture: captured, layerId, groupId, spanId: track.spanId });
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
export type LiveGroupSplitRequest = { owner: LiveGroupOwner; rightSpanId: string };

export type LiveGroupRestrictedArcPreparation = {
  layerId: string;
  spanId: string;
  frame: number;
  shapeIds: string[];
  middle: Project['layers'][number]['keys'][number]['shapes'];
  bindings: {
    groupId: string;
    ids: string[];
    halves: [RestrictedArcGeometry, RestrictedArcGeometry];
  }[];
};

/** Original-owner staging only. This does not return a Project or admit new
 * document fields; schema/sampler/full half-recipe proof remain separate gates. */
export function prepareLiveGroupRestrictedArcGeometry(
  requests: readonly LiveGroupOwner[],
  options: { validate?: () => void } = {},
): LiveGroupRestrictedArcPreparation[] {
  validateLiveGraphicData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original restricted arc owners.');
  const stamp = selectionTrajectoryStamp(requests);
  const rows = requests.map((handle) => {
    const record = owners.get(handle);
    if (!record) throw Error('Choose a private original restricted arc owner.');
    return { handle, record };
  });
  const first = rows[0].record.capture,
    source = first.identity();
  const previous = preparing.get(source);
  if (previous) {
    previous.invalid = true;
    throw Error('Restricted arc preparation cannot reenter.');
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
      throw Error('Invalid restricted arc admission.');
    const descriptor = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      (!descriptor && 'validate' in options) ||
      (descriptor &&
        (!descriptor.enumerable ||
          !('value' in descriptor) ||
          (descriptor.value !== undefined && typeof descriptor.value !== 'function')))
    )
      throw Error('Choose original synchronous arc admission data.');
    const validate = descriptor?.value as (() => void) | undefined;
    function current() {
      const result = validate?.() as unknown;
      if (result !== undefined) {
        if (result instanceof Promise) void result.catch(() => {});
        throw Error('Restricted arc admission must return synchronously without a value.');
      }
      const inputs = () => {
        validateLiveGraphicData(requests);
        if (
          entry.invalid ||
          selectionTrajectoryStamp(requests) !== stamp ||
          rows.some((row, i) => requests[i] !== row.handle || row.record.capture !== first)
        )
          throw Error('Restricted arc requests changed, reentered or crossed private scopes.');
      };
      inputs();
      first.current();
      if (first.source() !== source) throw Error('Restricted arc original source changed.');
      inputs();
    }
    current();
    validateProject(source);
    current();
    const original = first.snapshot(),
      capacity = structuredClone(original);
    if (
      capacity === original ||
      capacity.layers === original.layers ||
      capacity.layers.some((layer, i) => layer === original.layers[i])
    )
      throw Error('Restricted arc capacity clone is not detached.');
    if (selectionTrajectoryStamp(capacity) !== first.stamp)
      throw Error('Restricted arc source clone changed.');
    let capacityStamp = first.stamp;
    const bindingProofs: {
      halves: [RestrictedArcGeometry, RestrictedArcGeometry];
      stamp: string;
    }[] = [];
    const middleProofs: {
      middle: Project['layers'][number]['keys'][number]['shapes'];
      stamp: string;
    }[] = [];
    const sampler = captureLiveMotionTimeline(() => {
      current();
      return { project: original, revision: first.revision };
    });
    let scene: LiveMotionTrack[];
    try {
      scene = sampler.sample(first.frame);
    } finally {
      sampler.dispose();
    }
    current();
    const result: LiveGroupRestrictedArcPreparation[] = [],
      tracks = new Set<string>();
    for (const { record } of rows) {
      if (tracks.has(record.layerId)) throw Error('Choose each original arc track once.');
      tracks.add(record.layerId);
      const layer = original.layers.find((l) => l.id === record.layerId)!;
      const span = layer.liveMotionSpans!.find((s) => s.id === record.spanId)!;
      if (span.groupPaths?.some((bank) => bank.restrictedArc))
        throw Error('Persisted restricted arc staging requires recursive candidate admission.');
      if (
        span.path !== undefined ||
        !span.groupPaths?.some((b) => b.groupId === record.groupId && b.path.distance === true)
      )
        throw Error('Choose an original independent distance group with no shared route.');
      const middle = scene.find((pose) => pose.layerId === layer.id)!.key.shapes;
      const capturedMiddle = record.capture.scene().find((pose) => pose.layerId === layer.id)!.key
        .shapes;
      if (selectionTrajectoryStamp(middle) !== selectionTrajectoryStamp(capturedMiddle))
        throw Error('Restricted arc original promoted pose changed.');
      const from = layer.keys.find((k) => k.frame === span.start)!.shapes;
      const to = layer.keys.find((k) => k.frame === span.end)!.shapes;
      const progress = motionProgress(
        (first.frame - span.start) / (span.end - span.start),
        span.ease,
      );
      const bindings: LiveGroupRestrictedArcPreparation['bindings'] = [];
      for (const bank of span.groupPaths) {
        if (bank.path.distance !== true) continue;
        if (bank.path.waypoints !== undefined || bank.path.tangent)
          throw Error('Restricted arc staging requires single independent distance cubics.');
        const plan = prepareIndependentGroupPath(layer, span, bank);
        const indices = plan.ids.map((id) => from.findIndex((s) => s.id === id)),
          index = indices[0];
        const a = from[index],
          m = middle[index],
          b = to[index];
        if (
          indices.some(
            (i) =>
              middle[i].x - from[i].x !== m.x - a.x ||
              middle[i].y - from[i].y !== m.y - a.y ||
              to[i].x - middle[i].x !== b.x - m.x ||
              to[i].y - middle[i].y !== b.y - m.y,
          )
        )
          throw Error('Restricted arc promoted member displacement is not exact.');
        const cubic: RestrictedArcGeometry['cubic'] = [
          { x: 0, y: 0 },
          { x: bank.path.startX, y: bank.path.startY },
          { x: plan.dx + bank.path.endX, y: plan.dy + bank.path.endY },
          { x: plan.dx, y: plan.dy },
        ];
        const eases = bank.ease && splitSimpleMotionEase(bank.ease, progress);
        const halves = splitRestrictedArcGeometry({
          geometry: {
            descriptor: { version: 1, cubic, from: 0, to: 1 },
            origin: { x: 0, y: 0 },
            cubic,
          },
          progress: bank.ease ? motionProgress(progress, bank.ease) : progress,
          middle: { x: m.x - a.x, y: m.y - a.y },
        });
        const promotedLayer = {
          ...layer,
          keys: [...layer.keys, { frame: first.frame, shapes: middle }].sort(
            (a, b) => a.frame - b.frame,
          ),
        };
        const halfPlans = halves.map((geometry, i) =>
          prepareRestrictedIndependentGroupPath({
            layer: promotedLayer,
            span: { ...span, start: i ? first.frame : span.start, end: i ? span.end : first.frame },
            binding: {
              ...bank,
              ...(eases ? { ease: eases[i] } : {}),
              path: {
                ...bank.path,
                startX: geometry.cubic[1].x,
                startY: geometry.cubic[1].y,
                endX: geometry.cubic[2].x - geometry.cubic[3].x,
                endY: geometry.cubic[2].y - geometry.cubic[3].y,
              },
            },
            geometry,
          }),
        );
        // Check actual additive evaluation for every original integer frame and
        // member. This deliberately uses original global eased progress; it
        // does not admit a new half recipe/easing domain or publish a Project.
        for (let f = span.start; f <= span.end; f++) {
          const global = motionProgress((f - span.start) / (span.end - span.start), span.ease);
          const side = f <= first.frame ? 0 : 1,
            half = halfPlans[side];
          const local = side ? (global - progress) / (1 - progress) : global / progress;
          const originalRoute = plan.route(global),
            restrictedRoute = half.route(local);
          for (const i of indices) {
            const base = side ? middle[i] : from[i],
              end = side ? to[i] : middle[i];
            const candidate = {
              x: base.x + (end.x - base.x) * local + (restrictedRoute.x - half.dx * local),
              y: base.y + (end.y - base.y) * local + (restrictedRoute.y - half.dy * local),
            };
            const expected = {
              x: from[i].x + (to[i].x - from[i].x) * global + (originalRoute.x - plan.dx * global),
              y: from[i].y + (to[i].y - from[i].y) * global + (originalRoute.y - plan.dy * global),
            };
            if (!sameMotionArtwork(candidate, expected))
              throw Error(
                'Restricted group integer route evaluation differs from original artwork.',
              );
          }
        }
        bindingProofs.push({ halves, stamp: selectionTrajectoryStamp(halves) });
        bindings.push({ groupId: bank.groupId, ids: [...plan.ids], halves });
        current();
      }
      const middleStamp = selectionTrajectoryStamp(middle),
        detachedMiddle = structuredClone(middle);
      if (
        selectionTrajectoryStamp(middle) !== middleStamp ||
        selectionTrajectoryStamp(detachedMiddle) !== middleStamp
      )
        throw Error('Restricted arc promoted clone changed.');
      middleProofs.push({ middle: detachedMiddle, stamp: middleStamp });
      result.push({
        layerId: layer.id,
        spanId: span.id,
        frame: first.frame,
        shapeIds: from.map((s) => s.id),
        middle: detachedMiddle,
        bindings,
      });
      // Admission probe only: count the new complete key with original library
      // budgets. Removing this one span avoids pretending unsupported half timing
      // is a schema-valid candidate. The probe is never returned or published.
      const probe = capacity.layers.find((l) => l.id === layer.id)!;
      if (selectionTrajectoryStamp(capacity) !== capacityStamp)
        throw Error('Restricted arc capacity probe changed.');
      probe.keys = [...probe.keys, { frame: first.frame, shapes: detachedMiddle }].sort(
        (a, b) => a.frame - b.frame,
      );
      probe.liveMotionSpans = probe.liveMotionSpans!.filter((s) => s.id !== span.id);
      capacityStamp = selectionTrajectoryStamp(capacity);
      current();
    }
    validateLiveGraphicData(result);
    validateProject(capacity);
    current();
    const proofs = () => {
      if (
        bindingProofs.some((p) => selectionTrajectoryStamp(p.halves) !== p.stamp) ||
        middleProofs.some((p) => selectionTrajectoryStamp(p.middle) !== p.stamp)
      )
        throw Error('Restricted arc private staging geometry changed.');
    };
    proofs();
    const expected = selectionTrajectoryStamp(result),
      output = structuredClone(result);
    validateLiveGraphicData(output);
    validateProject(capacity);
    validateProject(source);
    current();
    proofs();
    if (
      selectionTrajectoryStamp(result) !== expected ||
      selectionTrajectoryStamp(output) !== expected ||
      selectionTrajectoryStamp(capacity) !== capacityStamp
    )
      throw Error('Restricted arc staged output clone changed.');
    return output;
  } finally {
    preparing.delete(source);
  }
}
/** One detached all-track transaction. Inserts one complete authored key per
 * selected track, never per-frame keys/baselines. Caller owns history publication. */
export function prepareSplitLiveGroupMotionSpans(
  requests: readonly LiveGroupSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  return prepareGroupSplit(requests, options, false);
}
/** Original weak-branded complete-group owners and the same final all-track
 * source/library/context admission; returns no history write or publication. */
export function prepareRestrictedArcLiveGroupMotionSpans(
  requests: readonly LiveGroupSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  return prepareGroupSplit(requests, options, true);
}
/** Explicit persisted-source continuation. No UI/default admission is widened;
 * original complete-group ownership and the shared reentry map remain required. */
export function prepareRecursiveRestrictedArcLiveGroupMotionSpans(
  requests: readonly LiveGroupSplitRequest[],
  options: { validate?: () => void } = {},
): Project {
  return prepareGroupSplit(requests, options, true, true);
}
function prepareGroupSplit(
  requests: readonly LiveGroupSplitRequest[],
  options: { validate?: () => void },
  restricted: boolean,
  recursive = false,
): Project {
  validateLiveMotionData(requests);
  if (!Array.isArray(requests) || !requests.length)
    throw Error('Choose original live group split requests.');
  if (
    Object.getPrototypeOf(requests) !== Array.prototype ||
    Reflect.ownKeys(requests).length !== requests.length + 1 ||
    !Array.from({ length: requests.length }, (_, i) =>
      Object.getOwnPropertyDescriptor(requests, String(i)),
    ).every((d) => d?.enumerable && 'value' in d)
  )
    throw Error('Choose original dense group split requests.');
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
        throw Error('Choose original enumerable group split owner/identity data.');
      const record = owners.get(owner.value);
      if (!record) throw Error('Choose an original private live group split owner.');
      if (!id.value || typeof id.value !== 'string')
        throw Error('Choose a new live span identity.');
      return { record, handle: owner.value as LiveGroupOwner, rightSpanId: id.value as string };
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
      throw Error('Choose an own group split admission field.');
    if (
      descriptor &&
      (!descriptor.enumerable ||
        !('value' in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
    )
      throw Error('Choose a synchronous group split admission data field.');
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
          throw Error('Group split requests changed, reentered or crossed capture scopes.');
      };
      inputs();
      first.current();
      if (first.source() !== source) throw Error('Group split original source changed.');
      inputs();
    }
    current();
    validateProject(source);
    current();
    const candidate = structuredClone(source);
    if (restricted) {
      validateLiveGraphicData(candidate);
      requireDetachedTree(source, candidate);
    }
    if (selectionTrajectoryStamp(candidate) !== first.stamp)
      throw Error('Sparse split source clone changed.');
    const selected = new Set<string>();
    for (const { record, rightSpanId } of rows) {
      if (selected.has(record.layerId)) throw Error('Choose each complete group recipe once.');
      selected.add(record.layerId);
      const original = record.capture.snapshot(),
        layer = original.layers.find((layer) => layer.id === record.layerId)!,
        span = layer.liveMotionSpans!.find((span) => span.id === record.spanId)!;
      if (restricted) requireDetachedTree(source, original);
      const prepared = (
        recursive
          ? splitRecursiveRestrictedArcLiveGroupMotionLayer
          : restricted
            ? splitRestrictedArcLiveGroupMotionLayer
            : splitLiveGroupMotionLayer
      )(original, layer, span, first.frame, rightSpanId);
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
    if (restricted) {
      validateLiveGraphicData(output);
      requireDetachedTree(source, output);
      requireDetachedTree(candidate, output);
    }
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
