import {
  admitSymbolProgramArtwork,
  prepareSymbolProgramArtwork,
  subscribeSymbolProgramDisposal,
  type SymbolArtworkPose,
  type SymbolArtworkViewport,
} from '../../../packages/scripting/src/symbol-program';
import { id } from '../../../packages/document/src';
import { captureDynamicTextValues } from '../../../packages/document/src/dynamic-text';
import { cloneScriptState, type ScriptState } from '../../../packages/scripting/src/timeline';
import {
  advanceScriptButtonHover,
  copyScriptButtonHover,
  type ScriptButtonHoverCheckpoint,
  type ScriptButtonHoverInput,
} from '../../../packages/scripting/src/button-input';
import type { PresentationPose, PresentationButtonState } from '../../../packages/export-web/src';
import {
  renderScriptArtwork,
  queryScriptArtworkTargets,
  type ScriptArtworkTarget,
} from './script-artwork';

import { hiddenPlacementKeys, hiddenPlacementsKey, lastHiddenButtons } from '../../../packages/scripting/src/stage-visibility';

import { applyStagePresentation, placementTransformsKey, readPlacementTransforms } from '../../../packages/scripting/src/stage-transform';

import { spawnedGraphicsKey } from '../../../packages/scripting/src/stage-spawn';

type Point = { x: number; y: number };
type QueryOptions = { signal?: AbortSignal; timeoutMs?: number };
type RenderOptions = QueryOptions & { textValues?: unknown; hiddenPlacements?: unknown; placementTransforms?: unknown; spawnedGraphics?: unknown };
type TextValues = Readonly<Record<string, string>>;
function renderText(options: RenderOptions, fallback?: TextValues): unknown {
  const field = Object.getOwnPropertyDescriptor(options, 'textValues');
  if (!field) return fallback;
  if (!field.enumerable || !('value' in field)) throw Error('Dynamic text requires an explicit data value.');
  return field.value;
}
function renderVisibility(options: RenderOptions, fallback?: readonly string[]) {
  const field = Object.getOwnPropertyDescriptor(options, 'hiddenPlacements');
  if (!field) return fallback;
  if (!field.enumerable || !('value' in field)) throw Error('Visibility requires an explicit data value.');
  return hiddenPlacementKeys(field.value);
}
type TransformEntries = ReturnType<typeof readPlacementTransforms>;
function renderTransforms(options: RenderOptions, fallback?: TransformEntries) {
  const field = Object.getOwnPropertyDescriptor(options, 'placementTransforms');
  if (!field) return fallback;
  if (!field.enumerable || !('value' in field)) throw Error('Transforms require an explicit data value.');
  return readPlacementTransforms(field.value);
}
function renderSpawns(options: RenderOptions, fallback?: ScriptState[string]) {
  const field = Object.getOwnPropertyDescriptor(options, 'spawnedGraphics');
  if (!field) return fallback;
  if (!field.enumerable || !('value' in field)) throw Error('Spawned graphics require an explicit data value.');
  return field.value === undefined ? undefined : cloneScriptState({spawns:field.value}).spawns;
}
type VisualState = 'up' | 'over' | 'down';
export interface SymbolArtworkVisualPreparation {
  snapshot: () => {
    namespace: string;
    definitionId: string;
    fromImageId: string;
    state: VisualState;
    frame: number;
    tick: number;
    poseCount: number;
  };
}
interface VisualOwner {
  prepare: (
    image: Blob,
    query: SymbolArtworkTargetQuery,
    index: number,
    state: VisualState,
    next: SymbolArtworkPose,
  ) => SymbolArtworkVisualPreparation;
  render: (preparation: object, options: RenderOptions) => Promise<Blob>;
}
export interface SymbolArtworkContinuation {
  snapshot: () => {
    namespace: string;
    definitionId: string;
    fromImageId: string;
    frame: number;
    tick: number;
    appendedPoseCount: number;
    poseCount: number;
  };
}
interface ContinuationOwner {
  prepare: (image: Blob, next: readonly SymbolArtworkPose[]) => SymbolArtworkContinuation;
  render: (preparation: object, options: RenderOptions) => Promise<Blob>;
}
const continuationOwners = new WeakMap<object, ContinuationOwner>();
function continuationHandle(
  data: ReturnType<SymbolArtworkContinuation['snapshot']>,
  admit: () => void,
): SymbolArtworkContinuation {
  return Object.freeze({
    snapshot() {
      admit();
      const result = { ...data };
      admit();
      return result;
    },
  });
}
/** Explicit continuation retains only the privately completed visual state. */
export function prepareSymbolScriptArtworkContinuation(
  provider: object,
  image: Blob,
  next: readonly SymbolArtworkPose[],
) {
  const owner = continuationOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.prepare(image, next);
}
export function renderSymbolScriptArtworkContinuation(
  provider: object,
  preparation: object,
  options: RenderOptions = {},
) {
  const owner = continuationOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.render(preparation, options);
}
export interface SymbolArtworkPressPreparation {
  snapshot: () => {
    namespace: string;
    definitionId: string;
    fromImageId: string;
    frame: number;
    tick: number;
    poseCount: number;
    pressed: boolean;
    hovered: boolean;
    state: VisualState;
  };
}
type PressInput = Pick<ScriptButtonHoverInput, 'type' | 'pointerId' | 'button'>;
interface PressOwner {
  prepare: (
    image: Blob,
    query: SymbolArtworkTargetQuery,
    index: number,
    input: PressInput,
    next: SymbolArtworkPose,
  ) => SymbolArtworkPressPreparation;
  render: (preparation: object, options: RenderOptions) => Promise<Blob>;
}
const pressOwners = new WeakMap<object, PressOwner>();
function pressHandle(
  data: ReturnType<SymbolArtworkPressPreparation['snapshot']>,
  admit: () => void,
): SymbolArtworkPressPreparation {
  return Object.freeze({
    snapshot() {
      admit();
      const result = { ...data };
      admit();
      return result;
    },
  });
}
/** Pointer press ownership comes from the original private hit, never public target IDs. */
export function prepareSymbolScriptArtworkPress(
  provider: object,
  image: Blob,
  query: SymbolArtworkTargetQuery,
  index: number,
  input: PressInput,
  next: SymbolArtworkPose,
) {
  const owner = pressOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.prepare(image, query, index, input, next);
}
export function renderSymbolScriptArtworkPress(
  provider: object,
  preparation: object,
  options: RenderOptions = {},
) {
  const owner = pressOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.render(preparation, options);
}
const emptyPress = (): ScriptButtonHoverCheckpoint => ({
  version: 1,
  press: { version: 1, pressed: null },
  hover: null,
});
export interface SymbolArtworkDelivery {
  input: () => ScriptState;
  snapshot: () => {
    namespace: string;
    definitionId: string;
    fromImageId: string;
    frame: number;
    tick: number;
    pressed: boolean;
    hovered: boolean;
    state: VisualState;
    activates: boolean;
  };
}
type DeliveryRenderOptions = RenderOptions & { validateInput?: () => void };
interface DeliveryOwner {
  prepare: (
    image: Blob,
    query: SymbolArtworkTargetQuery,
    index: number,
    input: PressInput,
  ) => SymbolArtworkDelivery;
  render: (
    delivery: object,
    next: SymbolArtworkPose,
    options: DeliveryRenderOptions,
  ) => Promise<Blob>;
}
const deliveryOwners = new WeakMap<object, DeliveryOwner>();
function deliveryHandle(
  data: ReturnType<SymbolArtworkDelivery['snapshot']>,
  input: ScriptState,
  read: <T>(fn: () => T) => T,
): SymbolArtworkDelivery {
  return Object.freeze({
    input() {
      return read(() => cloneScriptState(input));
    },
    snapshot() {
      return read(() => ({ ...data }));
    },
  });
}
/** Qualification precedes body execution; only this capability can publish its result. */
export function prepareSymbolScriptArtworkDelivery(
  provider: object,
  image: Blob,
  query: SymbolArtworkTargetQuery,
  index: number,
  input: PressInput,
) {
  const owner = deliveryOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.prepare(image, query, index, input);
}
export function renderSymbolScriptArtworkDelivery(
  provider: object,
  delivery: object,
  next: SymbolArtworkPose,
  options: DeliveryRenderOptions = {},
) {
  const owner = deliveryOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.render(delivery, next, options);
}
export interface SymbolArtworkHistory {
  snapshot: () => {
    namespace: string;
    definitionId: string;
    capturedImageId: string;
    frame: number;
    tick: number;
    poseCount: number;
    visualPoseCount: number;
  };
}
interface HistoryOwner {
  capture: (image: Blob) => SymbolArtworkHistory;
  restore: (history: object, options: QueryOptions) => Promise<Blob>;
}
const historyOwners = new WeakMap<object, HistoryOwner>();
function historyHandle(
  data: ReturnType<SymbolArtworkHistory['snapshot']>,
  admit: () => void,
): SymbolArtworkHistory {
  return Object.freeze({
    snapshot() {
      admit();
      const result = { ...data };
      admit();
      return result;
    },
  });
}

/** Opaque source-owned trajectories, never serialized public state or rasters. */
export function captureSymbolScriptArtworkHistory(provider: object, image: Blob) {
  const owner = historyOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.capture(image);
}
export function restoreSymbolScriptArtworkHistory(
  provider: object,
  history: object,
  options: QueryOptions = {},
) {
  const owner = historyOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.restore(history, options);
}
const visualOwners = new WeakMap<object, VisualOwner>();
export function prepareSymbolScriptArtworkVisual(
  provider: object,
  image: Blob,
  query: SymbolArtworkTargetQuery,
  index: number,
  state: VisualState,
  next: SymbolArtworkPose,
) {
  const owner = visualOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.prepare(image, query, index, state, next);
}
export function renderSymbolScriptArtworkVisual(
  provider: object,
  preparation: object,
  options: RenderOptions = {},
) {
  const owner = visualOwners.get(provider);
  if (!owner) throw new Error('A qualified symbol artwork provider is required.');
  return owner.render(preparation, options);
}
/** Check data descriptors before fingerprinting; public accessors/toJSON never
 * become target identity or run while a visual request is being prepared. */
function plainStamp(value: unknown): string {
  function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid visual query data.');
    const prototype = Object.getPrototypeOf(value),
      own = Reflect.ownKeys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      own.length !== keys.length ||
      own.some((k) => typeof k !== 'string' || !keys.includes(k))
    )
      throw new Error('Visual query requires original plain data.');
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('Executable visual query data.');
      copy[key] = descriptor.value;
    }
    return copy;
  }
  function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('Invalid visual query array.');
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 64 ||
      Reflect.ownKeys(value).length !== length + 1
    )
      throw new Error('Invalid visual query array.');
    return Array.from({ length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor))
        throw new Error('Executable or sparse visual query data.');
      return descriptor.value;
    });
  }
  const root = record(value, [
    'namespace',
    'definitionId',
    'width',
    'height',
    'imageId',
    'frame',
    'tick',
    'points',
    'targets',
  ]);
  const points = array(root.points).map((value) => {
    const point = record(value, ['x', 'y']);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('Invalid visual query coordinates.');
    return point;
  });
  const targets = array(root.targets).map((value) => {
    if (value === null) return null;
    const target = record(value, ['token', 'instanceId', 'symbolId', 'name', 'lifetime']);
    if (
      ['token', 'instanceId', 'symbolId', 'name'].some((k) => typeof target[k] !== 'string') ||
      !Number.isSafeInteger(target.lifetime) ||
      Number(target.lifetime) < 1
    )
      throw new Error('Invalid visual query target.');
    return target;
  });
  if (
    points.length !== targets.length ||
    ['namespace', 'definitionId', 'imageId'].some((k) => typeof root[k] !== 'string') ||
    ['width', 'height', 'frame', 'tick'].some((k) => !Number.isFinite(root[k]))
  )
    throw new Error('Invalid visual query metadata.');
  return JSON.stringify({ ...root, points, targets });
}
const copyPoses = (poses: readonly PresentationPose[]): PresentationPose[] => {
  if (poses.length < 1 || poses.length > 10001)
    throw new Error('Visual trajectory requires one to 10001 poses.');
  let bytes = 2;
  return poses.map(({ frame, tick, buttonState, hiddenButtons }, index) => {
    const pose = { frame, tick, ...(hiddenButtons !== undefined ? { hiddenButtons: [...hiddenButtons] } : {}), ...(buttonState ? { buttonState: { ...buttonState } } : {}) };
    bytes += new TextEncoder().encode(JSON.stringify(pose)).byteLength + (index ? 1 : 0);
    if (bytes > 64 * 1024 * 1024)
      throw new Error('Visual trajectory exceeds the 64 MiB artwork compiler limit.');
    return pose;
  });
};
export interface SymbolArtworkTargetQuery {
  namespace: string;
  definitionId: string;
  width: number;
  height: number;
  imageId: string;
  frame: number;
  tick: number;
  points: Point[];
  targets: (ScriptArtworkTarget | null)[];
}
const targetOwners = new WeakMap<
  object,
  (
    image: Blob,
    points: readonly Point[],
    options: QueryOptions,
  ) => Promise<SymbolArtworkTargetQuery>
>();
/** Only an exact, current PNG returned by this privately branded provider owns hits. */
export function querySymbolScriptArtworkTargets(
  provider: object,
  image: Blob,
  points: readonly Point[],
  options: QueryOptions = {},
) {
  const query = targetOwners.get(provider);
  if (!query) throw new Error('A qualified symbol artwork provider is required.');
  return query(image, points, options);
}

/** Read-only image provider owned by the same private symbol inspection capture.
 * Target queries require separate private provider and current-image admission. */
export function createSymbolScriptArtworkProvider(
  program: object,
  viewport?: SymbolArtworkViewport,
) {
  admitSymbolProgramArtwork(program);
  const view =
    viewport === undefined ? undefined : { width: viewport.width, height: viewport.height };
  const initial = prepareSymbolProgramArtwork(program, [{ frame: 0, tick: 0 }], view);
  const metadata = {
    namespace: initial.namespace,
    definitionId: initial.definitionId,
    width: initial.project.width,
    height: initial.project.height,
  };
  let disposed = false,
    job: AbortController | undefined;
  let latest:
    | { blob: Blob; poses: PresentationPose[]; imageId: string; press: ScriptButtonHoverCheckpoint; textValues?: TextValues; hiddenPlacements?: readonly string[]; placementTransforms?: TransformEntries; spawnedGraphics?: ScriptState[string] }
    | undefined;
  const queryProofs = new WeakMap<
    object,
    { imageId: string; stamp: string; targets: (ScriptArtworkTarget | null)[] }
  >();
  const plans = new WeakMap<
    object,
    { imageId: string; pose: PresentationPose; state: VisualState }
  >();
  const histories = new WeakMap<
    object,
    { poses: PresentationPose[]; press: ScriptButtonHoverCheckpoint; textValues?: TextValues; hiddenPlacements?: readonly string[]; placementTransforms?: TransformEntries; spawnedGraphics?: ScriptState[string] }
  >();
  const pressPlans = new WeakMap<
    object,
    { imageId: string; pose: PresentationPose; press: ScriptButtonHoverCheckpoint }
  >();
  let preparingPress = false,
    pressReentered = false;
  type DeliveryPlan = {
    imageId: string;
    query: SymbolArtworkTargetQuery;
    stamp: string;
    tick: number;
    press: ScriptButtonHoverCheckpoint;
    visual: PresentationButtonState | null;
  };
  const deliveries = new WeakMap<object, DeliveryPlan>();
  let preparingDelivery = false,
    deliveryReentered = false;
  const continuations = new WeakMap<object, { imageId: string; appended: PresentationPose[] }>();
  let preparingContinuation = false,
    continuationReentered = false;
  let capturingHistory = false,
    captureReentered = false,
    restoringHistory = false,
    restoreReentered = false;
  let preparingVisual = false,
    visualReentered = false;
  const admit = () => {
    if (disposed) throw new Error('Symbol artwork provider disposed.');
    admitSymbolProgramArtwork(program);
  };
  const unsubscribe = subscribeSymbolProgramDisposal(program, () => {
    disposed = true;
    latest = undefined;
    job?.abort(new Error('Symbol program closed during artwork rendering.'));
  });
  async function renderOwned(
    poses: readonly SymbolArtworkPose[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
    {
      presentation, validate = admit, press = emptyPress(), readText, readVisibility, readTransforms, readSpawns,
    }: {
      presentation?: readonly PresentationPose[];
      validate?: () => void;
      press?: ScriptButtonHoverCheckpoint;
      readText?: () => unknown;
      readVisibility?: () => readonly string[] | undefined;
      readTransforms?: () => TransformEntries | undefined;
      readSpawns?: () => ScriptState[string] | undefined;
    } = {},
  ): Promise<Blob> {
    validate();
    if (job) throw new Error('Symbol artwork rendering is busy.');
    const controller = new AbortController();
    job = controller;
    let signal: AbortSignal | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort(signal?.reason);
    try {
      const { signal: incoming, timeoutMs = 10000 } = options;
      signal = incoming;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
        throw new Error('Invalid symbol artwork deadline.');
      signal?.throwIfAborted();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(
        () => controller.abort(new Error('Symbol artwork rendering timed out.')),
        timeoutMs,
      );
      const values = captureDynamicTextValues(readText?.());
      const textValues = values && Object.freeze(values);
      const hiddenPlacements = readVisibility?.();
      const placementTransforms = readTransforms?.();
      const spawnedGraphics = readSpawns?.();
      const request = prepareSymbolProgramArtwork(program, poses, view),
        pressState = copyScriptButtonHover(press);
      const frames = copyPoses(presentation ?? request.poses);
      const hiddenButtons = new Set<string>();
      const artwork = applyStagePresentation(request.project, {
        [hiddenPlacementsKey]: hiddenPlacements?.slice() ?? [],
        [placementTransformsKey]: placementTransforms ?? [],
        [spawnedGraphicsKey]: spawnedGraphics ?? [],
      }, hiddenButtons,frames.at(-1));
      const prefix = latest?.poses;
      if (!presentation && prefix && frames.length > prefix.length &&
          prefix.every((pose,index)=>pose.frame===frames[index].frame&&pose.tick===frames[index].tick)) {
        for (let index = 0; index < prefix.length; index++)
          frames[index].hiddenButtons = prefix[index].hiddenButtons;
      }
      // A completed local image publishes the change at its final host pose.
      const last = frames.at(-1)!;
      const previous = lastHiddenButtons(frames, frames.length - 1);
      const hidden = [...hiddenButtons].sort();
      if (JSON.stringify(previous) !== JSON.stringify(hidden)) last.hiddenButtons = hidden;
      else delete last.hiddenButtons;
      if (hiddenButtons.size) {
        if (pressState.press.pressed && hiddenButtons.has(pressState.press.pressed.target.token)) pressState.press.pressed = null;
        if (pressState.hover && hiddenButtons.has(pressState.hover.target.token)) pressState.hover = null;
      }
      const checkedFrames = copyPoses(frames);
      const stamp = JSON.stringify([request, checkedFrames, pressState, textValues, placementTransforms, spawnedGraphics]);
      validate();
      controller.signal.throwIfAborted();
      const blob = textValues
        ? await renderScriptArtwork(artwork, checkedFrames, controller.signal, textValues)
        : await renderScriptArtwork(artwork, checkedFrames, controller.signal);
      controller.signal.throwIfAborted();
      validate();
      if (JSON.stringify([request, checkedFrames, pressState, textValues, placementTransforms, spawnedGraphics]) !== stamp)
        throw new Error('Prepared symbol artwork changed during rendering.');
      if (
        !(blob instanceof Blob) ||
        blob.type !== 'image/png' ||
        !Number.isSafeInteger(blob.size) ||
        blob.size < 1
      )
        throw new Error('Invalid symbol PNG output.');
      const completed = {
        blob,
        poses: checkedFrames,
        imageId: id(),
        press: copyScriptButtonHover(pressState),
        textValues,
        hiddenPlacements,
        placementTransforms,
        spawnedGraphics,
      };
      validate();
      controller.signal.throwIfAborted();
      latest = completed;
      return blob;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      job = undefined;
    }
  }
  const provider = Object.freeze({
    metadata() {
      admit();
      return { ...metadata };
    },
    render(poses: readonly SymbolArtworkPose[], options: RenderOptions = {}) {
      return renderOwned(poses, options, { readText: () => renderText(options), readVisibility: () => renderVisibility(options), readTransforms: () => renderTransforms(options), readSpawns: () => renderSpawns(options) });
    },
    dispose() {
      disposed = true;
      latest = undefined;
      job?.abort(new Error('Symbol artwork provider disposed.'));
      unsubscribe();
    },
  });
  targetOwners.set(provider, async (image, points, options) => {
    admit();
    if (job) throw new Error('Symbol artwork rendering is busy.');
    const original = latest;
    const current = () => {
      admit();
      if (!original || latest !== original || image !== original.blob)
        throw new Error('Symbol artwork image is stale or foreign.');
    };
    current();
    const controller = new AbortController();
    job = controller;
    let signal: AbortSignal | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort(signal?.reason);
    try {
      const { signal: incoming, timeoutMs = 10000 } = options;
      signal = incoming;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
        throw new Error('Invalid symbol artwork query deadline.');
      signal?.throwIfAborted();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(
        () => controller.abort(new Error('Symbol artwork query timed out.')),
        timeoutMs,
      );
      const length = Array.isArray(points) ? points.length : 0;
      if (length < 1 || length > 64)
        throw new Error('Query between one and 64 symbol artwork points.');
      const locations: Point[] = [];
      for (let index = 0; index < length; index++) {
        const point = points[index];
        if (!point || typeof point !== 'object' || Array.isArray(point))
          throw new Error('Invalid symbol artwork query point.');
        const { x, y } = point;
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error('Invalid symbol artwork query coordinates.');
        locations.push({ x, y });
      }
      if (points.length !== length)
        throw new Error('Symbol artwork query points changed during capture.');
      current();
      controller.signal.throwIfAborted();
      const request = prepareSymbolProgramArtwork(
          program,
          original!.poses.map(({ frame, tick }) => ({ frame, tick })),
          view,
        ),
        presentation = copyPoses(original!.poses),
        stamp = JSON.stringify([request, presentation]),
        pointStamp = JSON.stringify(locations),
        last = request.poses.at(-1)!;
      current();
      const result = await queryScriptArtworkTargets(applyStagePresentation(request.project, {
        [hiddenPlacementsKey]: original!.hiddenPlacements?.slice() ?? [],
        [placementTransformsKey]: original!.placementTransforms ?? [],
        [spawnedGraphicsKey]: original!.spawnedGraphics ?? [],
      }, new Set(),presentation.at(-1)), presentation, locations, {
        signal: controller.signal,
        timeoutMs,
        ...(original!.textValues ? { textValues: original!.textValues } : {}),
      });
      controller.signal.throwIfAborted();
      current();
      if (JSON.stringify([request, presentation]) !== stamp)
        throw new Error('Prepared symbol artwork changed during query.');
      if (JSON.stringify(locations) !== pointStamp)
        throw new Error('Symbol artwork query coordinates changed.');
      if (
        !result ||
        result.frame !== last.frame ||
        result.tick !== last.tick ||
        !Array.isArray(result.points) ||
        !Array.isArray(result.targets) ||
        result.points.length !== length ||
        result.targets.length !== length
      )
        throw new Error('Invalid symbol artwork query response.');
      const targets: (ScriptArtworkTarget | null)[] = [];
      const originals: (ScriptArtworkTarget | null)[] = [];
      let bytes = 0;
      for (let index = 0; index < length; index++) {
        const point = result.points[index];
        if (!point || point.x !== locations[index].x || point.y !== locations[index].y)
          throw new Error('Symbol artwork query response points changed.');
        const value = result.targets[index];
        if (value === null) {
          targets.push(null);
          originals.push(null);
          continue;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid symbol artwork target.');
        const { token, instanceId, symbolId, name, lifetime } = value;
        if (
          [token, instanceId, symbolId, name].some((field) => typeof field !== 'string') ||
          !Number.isSafeInteger(lifetime) ||
          lifetime < 1
        )
          throw new Error('Invalid symbol artwork target metadata.');
        const target = {
          token: JSON.stringify([metadata.namespace, token]),
          instanceId: JSON.stringify([metadata.namespace, instanceId]),
          symbolId,
          name,
          lifetime,
        };
        originals.push({ token, instanceId, symbolId, name, lifetime });
        bytes += new TextEncoder().encode(JSON.stringify(target)).byteLength;
        if (bytes > 256 * 1024) throw new Error('Symbol artwork targets exceed 256 KiB.');
        targets.push(target);
      }
      current();
      controller.signal.throwIfAborted();
      const output = {
        ...metadata,
        imageId: original!.imageId,
        frame: last.frame,
        tick: last.tick,
        points: locations.map((p) => ({ ...p })),
        targets,
      };
      queryProofs.set(output, {
        imageId: original!.imageId,
        stamp: plainStamp(output),
        targets: originals,
      });
      current();
      return output;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      job = undefined;
    }
  });
  const currentImage = (imageId: string, image?: Blob) => {
    admit();
    if (!latest || latest.imageId !== imageId || (image !== undefined && latest.blob !== image))
      throw new Error('Visual artwork image is stale or foreign.');
  };
  const visualFrames = (plan: { imageId: string; pose: PresentationPose }) => {
    currentImage(plan.imageId);
    const frames = copyPoses([...latest!.poses, plan.pose]);
    const request = prepareSymbolProgramArtwork(
      program,
      frames.map(({ frame, tick }) => ({ frame, tick })),
      view,
    );
    currentImage(plan.imageId);
    return { frames, request };
  };
  visualOwners.set(provider, {
    prepare(image, query, index, state, next) {
      if (preparingVisual) {
        visualReentered = true;
        throw new Error('Visual preparation reentered.');
      }
      preparingVisual = true;
      visualReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const proof = queryProofs.get(query);
        if (!proof) throw new Error('A qualified current query is required.');
        currentImage(proof.imageId, image);
        if (plainStamp(query) !== proof.stamp) throw new Error('Visual query data changed.');
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= proof.targets.length ||
          !['up', 'over', 'down'].includes(state)
        )
          throw new Error('Invalid visual target or state.');
        if (
          !next ||
          typeof next !== 'object' ||
          Array.isArray(next) ||
          Reflect.ownKeys(next).some((k) => k !== 'frame' && k !== 'tick')
        )
          throw new Error('Visual preparation requires a frame/tick pose.');
        const { frame, tick } = next,
          last = latest!.poses.at(-1)!,
          target = proof.targets[index];
        if (tick !== last.tick + 1)
          throw new Error('Visual preparation must append the next host tick.');
        if (state !== 'up' && !target)
          throw new Error('Visual state requires an original hit target.');
        const buttonState: PresentationButtonState | undefined =
          state === 'up'
            ? undefined
            : {
                instanceId: target!.instanceId,
                symbolId: target!.symbolId,
                lifetime: target!.lifetime,
                state,
              };
        const plan = {
          imageId: proof.imageId,
          pose: { frame, tick, ...(buttonState ? { buttonState } : {}) },
          state,
        };
        const poseCount = visualFrames(plan).frames.length;
        if (plainStamp(query) !== proof.stamp)
          throw new Error('Visual query data changed during preparation.');
        currentImage(proof.imageId, image);
        if (job || visualReentered) throw new Error('Visual preparation reentered.');
        const preparation = Object.freeze({
          snapshot() {
            currentImage(plan.imageId);
            const value = {
              namespace: metadata.namespace,
              definitionId: metadata.definitionId,
              fromImageId: plan.imageId,
              state,
              frame,
              tick,
              poseCount,
            };
            currentImage(plan.imageId);
            return value;
          },
        });
        plans.set(preparation, plan);
        return preparation;
      } finally {
        preparingVisual = false;
      }
    },
    render(preparation, options) {
      admit();
      if (job) throw new Error('Symbol artwork rendering is busy.');
      const plan = plans.get(preparation);
      if (!plan) throw new Error('A qualified visual preparation is required.');
      const { frames, request } = visualFrames(plan);
      return renderOwned(request.poses, options, {
        presentation: frames, validate: () => currentImage(plan.imageId),
        readText: () => renderText(options, latest!.textValues),
        readVisibility: () => renderVisibility(options, latest!.hiddenPlacements),
        readTransforms: () => renderTransforms(options, latest!.placementTransforms),
        readSpawns: () => renderSpawns(options, latest!.spawnedGraphics),
      });
    },
  });
  const continuationFrames = (plan: { imageId: string; appended: PresentationPose[] }) => {
    currentImage(plan.imageId);
    const frames = copyPoses([...latest!.poses, ...plan.appended]);
    const request = prepareSymbolProgramArtwork(
      program,
      frames.map(({ frame, tick }) => ({ frame, tick })),
      view,
    );
    currentImage(plan.imageId);
    return { frames, request };
  };
  continuationOwners.set(provider, {
    prepare(image, next) {
      if (preparingContinuation) {
        continuationReentered = true;
        throw new Error('Visual continuation reentered.');
      }
      preparingContinuation = true;
      continuationReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const imageId = latest?.imageId;
        if (!imageId) throw new Error('A current symbol artwork image is required.');
        currentImage(imageId, image);
        const length = Array.isArray(next) ? next.length : 0;
        if (!Number.isSafeInteger(length) || length < 1 || length > 10001 - latest!.poses.length)
          throw new Error('Visual continuation exceeds one to 10001 total poses.');
        const last = latest!.poses.at(-1)!,
          state = last.buttonState ? { ...last.buttonState } : undefined;
        const appended: PresentationPose[] = [];
        for (let index = 0; index < length; index++) {
          const value = next[index];
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Reflect.ownKeys(value).some((k) => k !== 'frame' && k !== 'tick')
          )
            throw new Error('Visual continuation requires frame/tick poses only.');
          const { frame, tick } = value;
          if (!Number.isSafeInteger(tick) || tick !== last.tick + index + 1)
            throw new Error('Visual continuation must append contiguous host ticks.');
          appended.push({ frame, tick, ...(state ? { buttonState: { ...state } } : {}) });
        }
        if (next.length !== length) throw new Error('Visual continuation changed during capture.');
        currentImage(imageId, image);
        const plan = { imageId, appended },
          poseCount = continuationFrames(plan).frames.length,
          tail = appended.at(-1)!;
        currentImage(imageId, image);
        if (job || continuationReentered)
          throw new Error('Visual continuation changed or reentered.');
        const result = continuationHandle(
          {
            namespace: metadata.namespace,
            definitionId: metadata.definitionId,
            fromImageId: imageId,
            frame: tail.frame,
            tick: tail.tick,
            appendedPoseCount: length,
            poseCount,
          },
          () => currentImage(imageId),
        );
        continuations.set(result, plan);
        return result;
      } finally {
        preparingContinuation = false;
      }
    },
    render(preparation, options) {
      admit();
      if (job) throw new Error('Symbol artwork rendering is busy.');
      const plan = continuations.get(preparation);
      if (!plan) throw new Error('A qualified visual continuation is required.');
      const { frames, request } = continuationFrames(plan);
      return renderOwned(request.poses, options, {
        presentation: frames, validate: () => currentImage(plan.imageId), press: latest!.press,
        readText: () => renderText(options, latest!.textValues),
        readVisibility: () => renderVisibility(options, latest!.hiddenPlacements),
        readTransforms: () => renderTransforms(options, latest!.placementTransforms),
        readSpawns: () => renderSpawns(options, latest!.spawnedGraphics),
      });
    },
  });
  pressOwners.set(provider, {
    prepare(image, query, index, input, next) {
      if (preparingPress) {
        pressReentered = true;
        throw new Error('Visual press preparation reentered.');
      }
      preparingPress = true;
      pressReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const proof = queryProofs.get(query);
        if (!proof) throw new Error('A qualified current query is required.');
        currentImage(proof.imageId, image);
        if (plainStamp(query) !== proof.stamp) throw new Error('Visual query data changed.');
        if (!Number.isSafeInteger(index) || index < 0 || index >= proof.targets.length)
          throw new Error('Invalid press target index.');
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Reflect.ownKeys(input).some((k) => !['type', 'pointerId', 'button'].includes(String(k)))
        )
          throw new Error('Visual press requires pointer fields only.');
        const { type, pointerId, button } = input;
        if (
          !next ||
          typeof next !== 'object' ||
          Array.isArray(next) ||
          Reflect.ownKeys(next).some((k) => k !== 'frame' && k !== 'tick')
        )
          throw new Error('Visual press requires a frame/tick pose.');
        const { frame, tick } = next;
        currentImage(proof.imageId, image);
        if (tick !== latest!.poses.at(-1)!.tick + 1)
          throw new Error('Visual press must append the next host tick.');
        const step = advanceScriptButtonHover(latest!.press, {
          type,
          pointerId,
          button,
          target: proof.targets[index],
        });
        const pose: PresentationPose = {
          frame,
          tick,
          ...(step.visual ? { buttonState: { ...step.visual } } : {}),
        };
        const plan = { imageId: proof.imageId, pose, press: step.checkpoint };
        const poseCount = visualFrames(plan).frames.length;
        if (plainStamp(query) !== proof.stamp)
          throw new Error('Visual query data changed during preparation.');
        currentImage(proof.imageId, image);
        if (job || pressReentered)
          throw new Error('Visual press preparation changed or reentered.');
        const preparation = pressHandle(
          {
            namespace: metadata.namespace,
            definitionId: metadata.definitionId,
            fromImageId: proof.imageId,
            frame,
            tick,
            poseCount,
            pressed: !!step.checkpoint.press.pressed,
            hovered: !!step.checkpoint.hover,
            state: step.visual?.state ?? 'up',
          },
          () => currentImage(proof.imageId),
        );
        pressPlans.set(preparation, plan);
        return preparation;
      } finally {
        preparingPress = false;
      }
    },
    render(preparation, options) {
      admit();
      if (job) throw new Error('Symbol artwork rendering is busy.');
      const plan = pressPlans.get(preparation);
      if (!plan) throw new Error('A qualified visual press preparation is required.');
      const { frames, request } = visualFrames(plan);
      return renderOwned(request.poses, options, {
        presentation: frames, validate: () => currentImage(plan.imageId), press: plan.press,
        readText: () => renderText(options, latest!.textValues),
        readVisibility: () => renderVisibility(options, latest!.hiddenPlacements),
        readTransforms: () => renderTransforms(options, latest!.placementTransforms),
        readSpawns: () => renderSpawns(options, latest!.spawnedGraphics),
      });
    },
  });
  const validateDelivery = (plan: DeliveryPlan) => {
    currentImage(plan.imageId);
    if (plainStamp(plan.query) !== plan.stamp) throw new Error('Delivery query data changed.');
    currentImage(plan.imageId);
  };
  function readDelivery<T>(plan: DeliveryPlan, fn: () => T): T {
    if (preparingDelivery) {
      deliveryReentered = true;
      throw new Error('Local delivery reentered.');
    }
    preparingDelivery = true;
    deliveryReentered = false;
    try {
      if (job) throw new Error('Symbol artwork rendering is busy.');
      validateDelivery(plan);
      const result = fn();
      validateDelivery(plan);
      if (job || deliveryReentered) throw new Error('Local delivery changed or reentered.');
      return result;
    } finally {
      preparingDelivery = false;
    }
  }
  deliveryOwners.set(provider, {
    prepare(image, query, index, input) {
      if (preparingDelivery) {
        deliveryReentered = true;
        throw new Error('Local delivery preparation reentered.');
      }
      preparingDelivery = true;
      deliveryReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const proof = queryProofs.get(query);
        if (!proof) throw new Error('A qualified current query is required.');
        currentImage(proof.imageId, image);
        if (plainStamp(query) !== proof.stamp) throw new Error('Delivery query data changed.');
        if (!Number.isSafeInteger(index) || index < 0 || index >= proof.targets.length)
          throw new Error('Invalid delivery target index.');
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Reflect.ownKeys(input).some((k) => !['type', 'pointerId', 'button'].includes(String(k)))
        )
          throw new Error('Local delivery requires pointer fields only.');
        const { type, pointerId, button } = input;
        currentImage(proof.imageId, image);
        const last = latest!.poses.at(-1)!,
          step = advanceScriptButtonHover(latest!.press, {
            type,
            pointerId,
            button,
            target: proof.targets[index],
          });
        const plan: DeliveryPlan = {
          imageId: proof.imageId,
          query,
          stamp: proof.stamp,
          tick: last.tick,
          press: step.checkpoint,
          visual: step.visual,
        };
        const scoped = (target: ScriptArtworkTarget | null) =>
          target
            ? {
                token: JSON.stringify([metadata.namespace, target.token]),
                instanceId: JSON.stringify([metadata.namespace, target.instanceId]),
                symbolId: target.symbolId,
                name: target.name,
                lifetime: target.lifetime,
              }
            : null;
        const data = cloneScriptState({
          type,
          pointerId,
          button,
          buttonTarget: scoped(proof.targets[index]),
          buttonActivation: scoped(step.activation),
          targetFrame: last.frame,
          targetTick: last.tick,
          targetScope: 'symbol-local',
          targetNamespace: metadata.namespace,
          targetImageId: proof.imageId,
        });
        visualFrames({
          imageId: proof.imageId,
          pose: {
            frame: last.frame,
            tick: last.tick + 1,
            ...(step.visual ? { buttonState: { ...step.visual } } : {}),
          },
        });
        validateDelivery(plan);
        currentImage(proof.imageId, image);
        if (job || deliveryReentered)
          throw new Error('Local delivery preparation changed or reentered.');
        const delivery = deliveryHandle(
          {
            namespace: metadata.namespace,
            definitionId: metadata.definitionId,
            fromImageId: proof.imageId,
            frame: last.frame,
            tick: last.tick,
            pressed: !!step.checkpoint.press.pressed,
            hovered: !!step.checkpoint.hover,
            state: step.visual?.state ?? 'up',
            activates: !!step.activation,
          },
          data,
          (fn) => readDelivery(plan, fn),
        );
        deliveries.set(delivery, plan);
        return delivery;
      } finally {
        preparingDelivery = false;
      }
    },
    render(delivery, next, options) {
      admit();
      if (job) throw new Error('Symbol artwork rendering is busy.');
      const plan = deliveries.get(delivery);
      if (!plan) throw new Error('A qualified local delivery is required.');
      const { frames, request } = readDelivery(plan, () => {
        if (
          !next ||
          typeof next !== 'object' ||
          Array.isArray(next) ||
          Reflect.ownKeys(next).some((k) => k !== 'frame' && k !== 'tick')
        )
          throw new Error('Delivery result requires a frame/tick pose.');
        const { frame, tick } = next;
        if (tick !== plan.tick + 1)
          throw new Error('Delivery result must append the next host tick.');
        return visualFrames({
          imageId: plan.imageId,
          pose: { frame, tick, ...(plan.visual ? { buttonState: { ...plan.visual } } : {}) },
        });
      });
      const validateInput = readDelivery(plan, () => {
        const validator = options.validateInput;
        if (validator !== undefined && typeof validator !== 'function')
          throw new Error('Invalid delivery input admission.');
        return validator;
      });
      const verify = () => {
        const previous = preparingDelivery;
        preparingDelivery = true;
        try {
          if (deliveryReentered) throw new Error('Local delivery admission reentered.');
          validateDelivery(plan);
          const result = validateInput?.() as unknown;
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
            throw new Error('Delivery input admission must be synchronous.');
          }
          validateDelivery(plan);
          if (deliveryReentered) throw new Error('Local delivery admission reentered.');
        } finally {
          preparingDelivery = previous;
        }
      };
      return renderOwned(request.poses, options, {
        presentation: frames, validate: verify, press: plan.press,
        readText: () => renderText(options, latest!.textValues),
        readVisibility: () => renderVisibility(options, latest!.hiddenPlacements),
        readTransforms: () => renderTransforms(options, latest!.placementTransforms),
        readSpawns: () => renderSpawns(options, latest!.spawnedGraphics),
      });
    },
  });
  historyOwners.set(provider, {
    capture(image) {
      if (capturingHistory) {
        captureReentered = true;
        throw new Error('History capture reentered.');
      }
      capturingHistory = true;
      captureReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const capturedImageId = latest?.imageId;
        if (!capturedImageId) throw new Error('A current symbol artwork image is required.');
        currentImage(capturedImageId, image);
        const poses = copyPoses(latest!.poses),
          last = poses.at(-1)!;
        const data = {
          namespace: metadata.namespace,
          definitionId: metadata.definitionId,
          capturedImageId,
          frame: last.frame,
          tick: last.tick,
          poseCount: poses.length,
          visualPoseCount: poses.filter((p) => p.buttonState !== undefined).length,
        };
        currentImage(capturedImageId, image);
        if (job || captureReentered) throw new Error('History capture changed or reentered.');
        const history = historyHandle(data, admit);
        histories.set(history, { poses, press: copyScriptButtonHover(latest!.press), textValues: latest!.textValues, hiddenPlacements: latest!.hiddenPlacements, placementTransforms: latest!.placementTransforms, spawnedGraphics: latest!.spawnedGraphics });
        currentImage(capturedImageId, image);
        if (captureReentered) throw new Error('History capture reentered.');
        return history;
      } finally {
        capturingHistory = false;
      }
    },
    restore(history, options) {
      if (restoringHistory) {
        restoreReentered = true;
        throw new Error('History restoration reentered.');
      }
      restoringHistory = true;
      restoreReentered = false;
      try {
        admit();
        if (job) throw new Error('Symbol artwork rendering is busy.');
        const saved = histories.get(history);
        if (!saved) throw new Error('A qualified symbol artwork history is required.');
        const { poses, press } = saved;
        const baseline = latest?.imageId;
        if (!baseline) throw new Error('A current symbol artwork image is required.');
        currentImage(baseline);
        const validate = () => {
          const previous = restoringHistory;
          restoringHistory = true;
          try {
            if (restoreReentered) throw new Error('History restoration reentered.');
            currentImage(baseline);
            if (restoreReentered) throw new Error('History restoration reentered.');
          } finally {
            restoringHistory = previous;
          }
        };
        return renderOwned(poses.map(({ frame, tick }) => ({ frame, tick })), options, {
          presentation: poses, validate, press, readText: () => saved.textValues, readVisibility: () => saved.hiddenPlacements, readTransforms: () => saved.placementTransforms, readSpawns: () => saved.spawnedGraphics,
        });
      } finally {
        restoringHistory = false;
      }
    },
  });
  return provider;
}
