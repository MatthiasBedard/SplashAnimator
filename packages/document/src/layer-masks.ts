import type { Layer } from './index';

/** Serialized mask ownership uses only original own data, never getters. */
export function validateSavedLayerMasks(project: object, symbolTracks?: Layer[]): void {
  const field = Object.getOwnPropertyDescriptor(project, 'layerMasks');
  if (!field) {
    if ('layerMasks' in project) throw Error('Saved masks require original data.');
    return;
  }
  if (!('value' in field) || !field.enumerable) throw Error('Saved masks require original data.');
  const value = field.value;
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Invalid saved mask list.');
  const own = (obj: object, key: string) => {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || !d.enumerable || !('value' in d)) throw Error('Saved masks require original data.');
    return d.value;
  };
  const masks = Array.from({ length: value.length }, (_, i) => {
    const item = own(value, String(i));
    if (
      !item ||
      typeof item !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(item)) ||
      Reflect.ownKeys(item).length !== 2
    )
      throw Error('Invalid saved mask.');
    const ids = own(item, 'layerIds');
    if (
      !Array.isArray(ids) ||
      Object.getPrototypeOf(ids) !== Array.prototype ||
      Reflect.ownKeys(ids).length !== ids.length + 1
    )
      throw Error('Invalid saved mask members.');
    return {
      maskLayerId: own(item, 'maskLayerId'),
      layerIds: Array.from({ length: ids.length }, (_, i) => own(ids, String(i))),
    };
  });
  captureLayerMasks(symbolTracks ?? own(project, 'layers'), masks);
}

/** Explicit alpha-mask ownership, also serialized by schema58 projects.
 * Layers are bottom-to-top. One source masks the contiguous run immediately
 * beneath it, in the same folder. A nested source represents its entire group.
 */
export type LayerMask = Readonly<{ maskLayerId: string; layerIds: readonly string[] }>;

export function captureLayerMasks(
  layers: readonly Layer[],
  request: readonly LayerMask[],
): readonly LayerMask[] {
  if (!Array.isArray(layers) || !Array.isArray(request))
    throw Error('Choose explicit original layer masks.');
  const count = request.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > layers.length)
    throw Error('Choose explicit original layer masks.');
  const identity = (layer: Layer) => {
    if (!layer || typeof layer !== 'object') throw Error('Missing original mask layer.');
    const id = Object.getOwnPropertyDescriptor(layer, 'id');
    const folder = Object.getOwnPropertyDescriptor(layer, 'folderId');
    if (
      !id ||
      !Object.hasOwn(id, 'value') ||
      typeof id.value !== 'string' ||
      !id.value ||
      (folder &&
        (!Object.hasOwn(folder, 'value') ||
          (folder.value !== undefined && (typeof folder.value !== 'string' || !folder.value))))
    )
      throw Error('Mask layer ownership requires original data identities.');
    return { id: id.value as string, folder: folder?.value as string | undefined };
  };
  const originals = layers.map((layer) => ({ layer, ...identity(layer) }));
  const indices = new Map(originals.map((layer, i) => [layer.id, i]));
  if (indices.size !== originals.length) throw Error('Mask layer identities must be unique.');
  const sources = new Set<string>(),
    targets = new Set<string>(),
    captured: LayerMask[] = [];
  for (let i = 0; i < count; i++) {
    const item = request[i];
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Reflect.ownKeys(item).length !== 2 ||
      !Object.hasOwn(item, 'maskLayerId') ||
      !Object.hasOwn(item, 'layerIds')
    )
      throw Error('A mask request needs only an original source and target layers.');
    const source = item.maskLayerId,
      ids = item.layerIds,
      index = indices.get(source);
    if (
      typeof source !== 'string' ||
      index === undefined ||
      sources.has(source) ||
      !Array.isArray(ids)
    )
      throw Error('Choose a unique original mask above its targets.');
    const length = ids.length,
      selected: string[] = [];
    if (!Number.isSafeInteger(length) || length < 1 || length > index)
      throw Error('Choose a complete nonempty mask target run.');
    for (let j = 0; j < length; j++) {
      const id = ids[j],
        original = originals[index - length + j];
      if (
        typeof id !== 'string' ||
        id !== original.id ||
        targets.has(id) ||
        original.folder !== originals[index].folder
      )
        throw Error(
          'Mask targets must be distinct, contiguous original layers in the same folder.',
        );
      targets.add(id);
      selected.push(id);
    }
    if (ids.length !== length) throw Error('Mask targets changed while being read.');
    sources.add(source);
    captured.push(Object.freeze({ maskLayerId: source, layerIds: Object.freeze(selected) }));
  }
  if (request.length !== count) throw Error('Mask requests changed while being read.');
  if (
    layers.length !== originals.length ||
    originals.some((original, i) => {
      const now = identity(original.layer);
      return (
        layers[i] !== original.layer || now.id !== original.id || now.folder !== original.folder
      );
    })
  )
    throw Error('Original mask layer ownership changed.');
  return Object.freeze(captured);
}

/** Bottom-up passes for validated, contiguous groups. A nested source can only
 * be the first member: any earlier member would also belong to its child group.
 * Compose the child first, then append siblings before applying the parent mask. */
export function maskPaintChains(masks: readonly LayerMask[]) {
  const bySource = new Map(masks.map(mask => [mask.maskLayerId, mask]));
  const members = new Set(masks.flatMap(mask => [...mask.layerIds]));
  const chains = new Map<string, { source: string; members: readonly string[] }[]>();
  for (const root of masks) {
    if (members.has(root.maskLayerId)) continue;
    const passes = [];
    let mask: LayerMask | undefined = root;
    while (mask) {
      const child: LayerMask | undefined = bySource.get(mask.layerIds[0]);
      passes.push({ source: mask.maskLayerId, members: child ? mask.layerIds.slice(1) : mask.layerIds });
      mask = child;
    }
    chains.set(root.maskLayerId, passes.reverse());
  }
  return { chains, members };
}

export function hasMaskChain(masks: readonly LayerMask[] = []) {
  const sources = new Set(masks.map(mask => mask.maskLayerId));
  return masks.some(mask => mask.layerIds.some(id => sources.has(id)));
}

/** Follows validated ownership toward the top of the stack. */
export function maskAncestors(masks: readonly LayerMask[], id: string) {
  const result: string[] = [];
  const owners = new Map<string,string>();
  for (const mask of masks) for (const member of mask.layerIds) owners.set(member, mask.maskLayerId);
  for (let source = owners.get(id); source !== undefined; source = owners.get(source)) result.push(source);
  return result;
}
