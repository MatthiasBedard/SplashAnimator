import { validateProject, type Project, type Vector } from '../../document/src';
import { freezeSnapshot, isImmutableSnapshot } from '../../document/src/immutable-snapshot';
import { captureLayerMasks, type LayerMask } from '../../document/src/layer-masks';
import { selectionTrajectoryStamp } from './selection-trajectory';
export type LayerArtwork = { layerId: string; shapes: Vector[] };
export type PreparedLayerScene = Readonly<{
  frame: number;
  layerIds: readonly string[];
  maskSourceIds: readonly string[];
}>;
export type LayerSceneData = Readonly<{
  frame: number;
  layers: readonly Readonly<{ layerId: string; visible: boolean; shapes: readonly Vector[] }>[];
  masks: readonly LayerMask[];
  assets: Project['assets'];
}>;
type Entry = {
  data: LayerSceneData;
  sourceStamp: string;
  check: () => void;
  invalid: boolean;
  using: boolean;
};
const scenes = new WeakMap<object, Entry>(),
  preparing = new WeakMap<object, { invalid: boolean }>();
function freeze<T>(data: T): T {
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) freeze(value);
    Object.freeze(data);
  }
  return data;
}
/** Expanded world placements and group namespaces are presentation data, not
 * authored local coordinates/IDs. Validate them without clamping, while reusing
 * document validation for unchanged local geometry, paint, text and resources. */
function localAdmission(shape: Vector): Vector {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (
    ![shape.x, shape.y, shape.rotation].every(finite) ||
    (shape.transform !== undefined &&
      (!Array.isArray(shape.transform) ||
        shape.transform.length !== 4 ||
        !shape.transform.every(finite))) ||
    (shape.pivot !== undefined &&
      (!shape.pivot || !finite(shape.pivot.x) || !finite(shape.pivot.y)))
  )
    throw Error('Resolved world placement must remain finite.');
  if (
    shape.groups !== undefined &&
    (!Array.isArray(shape.groups) ||
      shape.groups.length > 32 ||
      new Set(shape.groups).size !== shape.groups.length ||
      shape.groups.some((id) => typeof id !== 'string' || !id))
  )
    throw Error('Invalid resolved group namespace.');
  return {
    ...shape,
    x: 0,
    y: 0,
    rotation: 0,
    transform: undefined,
    pivot: undefined,
    groups: undefined,
  };
}
function sync(call: (() => void) | undefined) {
  const result = call?.() as unknown;
  if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Layer scene validation must be synchronous.');
  }
}
/** Resolve once through the host's existing layer-aware presentation. Original
 * identities/visibility are private; returned posed artwork never owns them. */
export function prepareLayerScene(
  project: Project,
  frame: number,
  request: readonly LayerMask[],
  resolve: (snapshot: Project, frame: number) => readonly LayerArtwork[],
  options: { validate?: () => void } = {},
): PreparedLayerScene {
  const previous = preparing.get(project);
  if (previous) {
    previous.invalid = true;
    throw Error('Layer scene preparation cannot reenter its source.');
  }
  const owner = { invalid: false };
  preparing.set(project, owner);
  try {
    const original = selectionTrajectoryStamp(project);
    if (
      typeof resolve !== 'function' ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate')
    )
      throw Error('Invalid layer scene preparation.');
    const validate = options.validate;
    if (validate !== undefined && typeof validate !== 'function')
      throw Error('Invalid layer scene validation.');
    const current = () => {
      if (owner.invalid || selectionTrajectoryStamp(project) !== original)
        throw Error('Original layer scene changed.');
    };
    const admit = () => {
      current();
      sync(validate);
      current();
    };
    admit();
    validateProject(project);
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= project.duration)
      throw Error('Choose an exact original scene frame.');
    const masks = captureLayerMasks(project.layers, request.length ? request : project.layerMasks ?? []);
    admit();
    const snapshot = structuredClone(project);
    admit();
    if (selectionTrajectoryStamp(snapshot) !== original)
      throw Error('Layer scene source changed during cloning.');
    if (isImmutableSnapshot(project)) freezeSnapshot(snapshot);
    const output = resolve(snapshot, frame);
    admit();
    if (selectionTrajectoryStamp(snapshot) !== original)
      throw Error('Layer resolver changed its original snapshot.');
    if (!Array.isArray(output) || output.length !== snapshot.layers.length) {
      if (output && typeof (output as unknown as PromiseLike<unknown>).then === 'function')
        void Promise.resolve(output).catch(() => {});
      throw Error('Resolve every original layer synchronously.');
    }
    const stamp = selectionTrajectoryStamp(output);
    for (let i = 0; i < output.length; i++) {
      const posed = output[i],
        source = snapshot.layers[i];
      if (
        !posed ||
        Object.keys(posed).length !== 2 ||
        posed.layerId !== source.id ||
        !Array.isArray(posed.shapes) ||
        (!source.visible && posed.shapes.length) ||
        posed.shapes.some((s: Vector) => s.kind === 'symbol')
      )
        throw Error(
          'Resolved scene must retain original layer order, visibility and expanded artwork.',
        );
    }
    const detached = structuredClone(output);
    admit();
    if (selectionTrajectoryStamp(detached) !== stamp)
      throw Error('Resolved layer artwork changed during cloning.');
    validateProject({
      ...snapshot,
      layerMasks: undefined,
      opacityBindings: undefined,
      frameScripts: undefined,
      frameLabels: undefined,
      frameComments: undefined,
      audioClips: undefined,
      symbols: [],
      folders: [],
      duration: 1,
      layers: detached.map((layer, i) => ({
        id: layer.layerId,
        name: snapshot.layers[i].name,
        visible: snapshot.layers[i].visible,
        locked: snapshot.layers[i].locked,
        keys: [{ frame: 0, shapes: layer.shapes.map(localAdmission) }],
      })),
    });
    admit();
    const data = freeze({
      frame,
      layers: detached.map((layer, i) => ({ ...layer, visible: snapshot.layers[i].visible })),
      masks,
      assets: snapshot.assets,
    });
    const handle = freeze({
      frame,
      layerIds: snapshot.layers.map((l) => l.id),
      maskSourceIds: masks.map((m) => m.maskLayerId),
    });
    const entry: Entry = {
      data,
      sourceStamp: original,
      invalid: false,
      using: false,
      check: admit,
    };
    scenes.set(handle, entry);
    admit();
    return handle;
  } finally {
    preparing.delete(project);
  }
}
/** Readonly bridge for trusted renderers. Values are deeply frozen; handles
 * cannot be forged from public scene metadata. No async callback may retain use. */
export function withLayerScene<T>(scene: PreparedLayerScene, read: (data: LayerSceneData) => T): T {
  const entry = scenes.get(scene);
  if (!entry || entry.invalid) throw Error('Layer scene is disposed or stale.');
  if (entry.using) {
    entry.invalid = true;
    throw Error('Layer scene use cannot reenter.');
  }
  entry.using = true;
  const current = () => {
    if (entry.invalid || scenes.get(scene) !== entry)
      throw Error('Layer scene is disposed or stale.');
    entry.check();
    if (entry.invalid || scenes.get(scene) !== entry)
      throw Error('Layer scene is disposed or stale.');
  };
  try {
    current();
    const result = read(entry.data);
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw Error('Layer scene use must be synchronous.');
    }
    current();
    return result;
  } catch (cause) {
    entry.invalid = true;
    throw cause;
  } finally {
    entry.using = false;
  }
}
export function disposeLayerScene(scene: PreparedLayerScene) {
  const entry = scenes.get(scene);
  if (entry) entry.invalid = true;
  scenes.delete(scene);
}
/** Private-source compatibility for resource leases; public copied metadata
 * cannot authorize a different scene, even when its asset IDs happen to match. */
export function layerSceneMatchesSource(scene: PreparedLayerScene, expected: string): boolean {
  return withLayerScene(scene, () => scenes.get(scene)!.sourceStamp === expected);
}
