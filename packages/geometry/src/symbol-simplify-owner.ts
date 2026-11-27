import { validateProject, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../animation/src/selection-trajectory';
import { copySymbolChildren } from './symbol-artwork';
import { prepareSmoothSelection } from './smooth-selection';
import { artworkVertices } from './artwork-simplify';
import {
  snapshotSymbolSimplifyLocation,
  symbolSimplifyArtwork,
  withSymbolSimplifyArtwork,
  type SymbolSimplifyLocation,
} from './symbol-simplify-artwork';

export type SymbolSimplifySource = { project: Project; revision: number };
export type SymbolSimplifyOwner = Readonly<{ symbolId: string; selected: readonly string[] }>;
export type IsolatedSymbolSimplifyOwner = SymbolSimplifyOwner &
  Readonly<{ ancestry: readonly string[] }>;
export type FrameSymbolSimplifyOwner = SymbolSimplifyOwner &
  Readonly<{ location: SymbolSimplifyLocation; ancestry?: readonly string[] }>;

type OwnerRecord = {
  current(): void;
  snapshot(): Project;
  source: Project;
  symbolId: string;
  ids: string[];
  location?: SymbolSimplifyLocation;
};
const owners = new WeakMap<SymbolSimplifyOwner, OwnerRecord>();
const preparing = new WeakMap<Project, { invalid: boolean }>();

function detached(source: unknown, copy: unknown) {
  const originals = new Set<object>();
  function visit(root: unknown, check: boolean) {
    const pending = [root],
      seen = new Set<object>();
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      if (check && originals.has(value))
        throw Error('Symbol simplification requires detached data.');
      if (seen.has(value)) continue;
      seen.add(value);
      if (!check) originals.add(value);
      for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
        if ('value' in d) pending.push(d.value);
    }
  }
  visit(source, false);
  visit(copy, true);
}
export { detached as assertSymbolSimplifyDetached };
function state(value: SymbolSimplifySource) {
  validateLiveGraphicData(value);
  if (!value || !value.project || !Number.isSafeInteger(value.revision) || value.revision < 0)
    throw Error('Choose original symbol artwork and a valid revision.');
}

/** Original static artwork or explicitly owned timeline storage. Complete units own selection;
 * public display geometry never authorizes membership or a replacement. */
export function captureSymbolArtworkSimplification(read: () => SymbolSimplifySource) {
  let reading = false,
    dead = false;
  function source() {
    if (dead || reading) {
      dead = true;
      throw Error('Symbol simplification source is stale or reentered.');
    }
    reading = true;
    try {
      const value = read();
      state(value);
      return { project: value.project, revision: value.revision };
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      reading = false;
    }
  }
  const first = source(),
    signature = stamp(first.project);
  validateProject(first.project);
  function current() {
    const live = source();
    if (
      dead ||
      live.project !== first.project ||
      live.revision !== first.revision ||
      stamp(live.project) !== signature
    ) {
      dead = true;
      throw Error('Original symbol library or revision changed.');
    }
  }
  const original = structuredClone(first.project);
  validateLiveGraphicData(original);
  detached(first.project, original);
  if (stamp(original) !== signature) throw Error('Original symbol snapshot changed.');
  current();
  function snapshot() {
    current();
    const copy = structuredClone(original);
    validateLiveGraphicData(copy);
    detached(first.project, copy);
    detached(original, copy);
    current();
    if (stamp(original) !== signature || stamp(copy) !== signature)
      throw Error('Symbol snapshot clone changed.');
    return copy;
  }
  return {
    resolve(symbolId: string, selected: readonly string[]): SymbolSimplifyOwner {
      current();
      validateLiveGraphicData({ symbolId, selected });
      if (
        typeof symbolId !== 'string' ||
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some((id) => typeof id !== 'string' || !id) ||
        new Set(selected).size !== selected.length
      )
        throw Error('Choose distinct original symbol artwork identities.');
      const input = stamp({ symbolId, selected }),
        ids = [...selected];
      const definition = original.symbols?.find((s) => s.id === symbolId);
      if (!definition || definition.timeline || definition.buttonStates)
        throw Error(
          'Choose original static library artwork; timeline and button edits need separate ownership.',
        );
      const members = copySymbolChildren(definition.shapes, ids).map((s) => s.id);
      current();
      if (stamp({ symbolId, selected }) !== input || stamp(original) !== signature)
        throw Error('Original symbol selection changed.');
      const owner = Object.freeze({ symbolId, selected: Object.freeze([...members]) });
      owners.set(owner, { current, snapshot, source: first.project, symbolId, ids: members });
      return owner;
    },
    /** Resolve complete units relative to an existing original group boundary.
     * Fitting still receives the full definition; only privately admitted member
     * IDs are editable. Public stripped/proposed artwork cannot own ancestry. */
    resolveIsolated(
      symbolId: string,
      ancestry: readonly string[],
      selected: readonly string[],
    ): IsolatedSymbolSimplifyOwner {
      validateLiveGraphicData({ symbolId, ancestry, selected });
      if (
        typeof symbolId !== 'string' ||
        !symbolId ||
        !Array.isArray(ancestry) ||
        !ancestry.length ||
        ancestry.length > 32 ||
        ancestry.some((id) => typeof id !== 'string' || !id) ||
        new Set(ancestry).size !== ancestry.length ||
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some((id) => typeof id !== 'string' || !id) ||
        new Set(selected).size !== selected.length
      )
        throw Error('Choose original isolated ancestry and distinct artwork identities.');
      const input = stamp({ symbolId, ancestry, selected }),
        path = [...ancestry],
        ids = [...selected];
      current();
      const definition = original.symbols?.find((s) => s.id === symbolId);
      if (!definition || definition.timeline || definition.buttonStates)
        throw Error('Choose original static library artwork for group isolation.');
      const relative = definition.shapes
        .filter((s) => path.every((id, i) => s.groups?.[i] === id))
        .map((s) => ({ ...s, groups: s.groups!.slice(path.length) }));
      if (!relative.length) throw Error('The original isolated group no longer exists.');
      const members = copySymbolChildren(relative, ids).map((s) => s.id);
      current();
      if (stamp({ symbolId, ancestry, selected }) !== input || stamp(original) !== signature)
        throw Error('Original isolated symbol selection changed.');
      const owner = Object.freeze({
        symbolId,
        ancestry: Object.freeze(path),
        selected: Object.freeze([...members]),
      });
      owners.set(owner, { current, snapshot, source: first.project, symbolId, ids: members });
      return owner;
    },
    /** Explicit original stored-key scope. Default methods remain static-only. */
    resolveFrame(
      symbolId: string,
      location: SymbolSimplifyLocation,
      selected: readonly string[],
      ancestry?: readonly string[],
    ): FrameSymbolSimplifyOwner {
      validateLiveGraphicData({ symbolId, location, selected, ancestry });
      const at = snapshotSymbolSimplifyLocation(location);
      if (
        typeof symbolId !== 'string' ||
        !symbolId ||
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some((id) => typeof id !== 'string' || !id) ||
        new Set(selected).size !== selected.length ||
        (ancestry !== undefined &&
          (!Array.isArray(ancestry) ||
            !ancestry.length ||
            ancestry.length > 32 ||
            ancestry.some((id) => typeof id !== 'string' || !id) ||
            new Set(ancestry).size !== ancestry.length))
      )
        throw Error('Choose distinct original frame artwork and ancestry.');
      const input = stamp({ symbolId, location, selected, ancestry }),
        ids = [...selected],
        path = ancestry === undefined ? undefined : [...ancestry];
      current();
      const definition = original.symbols?.find((s) => s.id === symbolId);
      if (!definition) throw Error('Original symbol frame no longer exists.');
      const artwork = symbolSimplifyArtwork(definition, at);
      const relative = path
        ? artwork
            .filter((s) => path.every((id, i) => s.groups?.[i] === id))
            .map((s) => ({ ...s, groups: s.groups!.slice(path.length) }))
        : artwork;
      const members = copySymbolChildren(relative, ids).map((s) => s.id);
      current();
      if (
        stamp({ symbolId, location, selected, ancestry }) !== input ||
        stamp(original) !== signature
      )
        throw Error('Original symbol frame selection changed.');
      const owner = Object.freeze({
        symbolId,
        location: Object.freeze({ ...at }),
        selected: Object.freeze([...members]),
        ...(path ? { ancestry: Object.freeze([...path]) } : {}),
      });
      owners.set(owner, {
        current,
        snapshot,
        source: first.project,
        symbolId,
        ids: members,
        location: at,
      });
      return owner;
    },
    dispose() {
      dead = true;
    },
  };
}

/** Complete Project candidate only: caller still owns draft/history publication
 * and synchronous admission of any enclosing editor/selection context. */
export function prepareSymbolArtworkSimplification(
  owner: SymbolSimplifyOwner,
  options: { validate?: () => void } = {},
): { project: Project; selected: string[]; removed: number } {
  const found = owners.get(owner);
  if (!found) throw Error('Choose an original private symbol simplification owner.');
  const record: OwnerRecord = found;
  const prior = preparing.get(record.source);
  if (prior) {
    prior.invalid = true;
    throw Error('Symbol simplification cannot reenter.');
  }
  const entry = { invalid: false };
  preparing.set(record.source, entry);
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some((k) => k !== 'validate')
    )
      throw Error('Invalid simplification admission.');
    const field = Object.getOwnPropertyDescriptor(options, 'validate');
    if (
      (!field && 'validate' in options) ||
      (field &&
        (!field.enumerable ||
          !('value' in field) ||
          (field.value !== undefined && typeof field.value !== 'function')))
    )
      throw Error('Choose original synchronous admission data.');
    const validate = field?.value as (() => void) | undefined;
    function current() {
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Simplification admission must be synchronous.');
      }
      if (entry.invalid) throw Error('Symbol simplification reentered.');
      record.current();
      if (entry.invalid) throw Error('Symbol simplification reentered.');
    }
    current();
    const candidate = record.snapshot(),
      definition = candidate.symbols!.find((s) => s.id === record.symbolId)!,
      artwork = symbolSimplifyArtwork(definition, record.location),
      inputStamp = stamp(candidate);
    const selected = [...record.ids];
    const result = prepareSmoothSelection(artwork, { selected, simplify: true });
    const vertices = (shapes: typeof definition.shapes) =>
      shapes.filter((s) => record.ids.includes(s.id)).reduce((n, s) => n + artworkVertices(s), 0);
    if (
      !Number.isSafeInteger(result.removed) ||
      result.removed! < 0 ||
      result.removed !== vertices(artwork) - vertices(result.artwork) ||
      stamp(result.selected) !== stamp(record.ids)
    )
      throw Error('Symbol vertex reduction changed.');
    const removed = result.removed!;
    if (stamp(result.artwork.map((s) => s.id)) !== stamp(artwork.map((s) => s.id)))
      throw Error('Original symbol artwork identities changed.');
    validateLiveGraphicData(result);
    const resultStamp = stamp(result.artwork),
      replacement = structuredClone(result.artwork);
    current();
    validateLiveGraphicData(candidate);
    validateLiveGraphicData(result);
    validateLiveGraphicData(replacement);
    detached(record.source, candidate);
    detached(candidate, replacement);
    detached(result.artwork, replacement);
    if (
      stamp(candidate) !== inputStamp ||
      stamp(result.artwork) !== resultStamp ||
      stamp(replacement) !== resultStamp ||
      stamp(result.selected) !== stamp(record.ids)
    )
      throw Error('Original symbol preparation data changed.');
    // Preserve every unchanged member exactly, including optional-field presence.
    // A no-op must not rewrite the definition via a JSON-normalized copy.
    const reduced = artwork.map((s, i) =>
      record.ids.includes(s.id) && artworkVertices(replacement[i]) < artworkVertices(s)
        ? replacement[i]
        : s,
    );
    if (removed)
      candidate.symbols = candidate.symbols!.map((s) =>
        s.id === record.symbolId ? withSymbolSimplifyArtwork(s, reduced, record.location) : s,
      );
    const data = { project: candidate, selected, removed },
      expected = stamp(data);
    validateProject(candidate);
    current();
    const output = structuredClone(data);
    validateLiveGraphicData(output);
    detached(record.source, output);
    detached(data, output);
    validateProject(output.project);
    current();
    if (stamp(data) !== expected || stamp(output) !== expected)
      throw Error('Symbol candidate changed after cloning.');
    return output;
  } finally {
    preparing.delete(record.source);
  }
}
