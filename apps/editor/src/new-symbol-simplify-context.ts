import {
  validateProject,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import {
  moveLibraryItem,
  setLibraryLink,
  suggestLibraryLink,
} from '../../../packages/document/src/library';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { assertSymbolSimplifyDetached as detached } from '../../../packages/geometry/src/symbol-simplify-owner';
import { symbolSimplifyArtwork } from '../../../packages/geometry/src/symbol-simplify-artwork';
import type { StaticSymbolSimplifyContext } from './symbol-simplify-context';

export type NewStaticSymbolSimplifySource = {
  project: Project;
  definition: SymbolDefinition;
  history: object;
  session: object;
  revision: number;
  folder: string;
  context: string;
  eligible: boolean;
};
/** Original unpublished static definition ownership. A complete detached draft
 * supplies worker/library validation, never authority to insert it into a live
 * Project. The caller still owns local/Apply history and final source admission. */
export function captureNewStaticSymbolSimplifyContext(
  read: () => NewStaticSymbolSimplifySource,
  artwork: Vector[],
): StaticSymbolSimplifyContext {
  return captureNewSymbolSimplifyContext(read, artwork, false);
}
/** Explicit initial stored frame of an original blank unpublished movie/button
 * header. Does not authorize held/generated keys or create extra timeline keys. */
export function captureNewFrameSymbolSimplifyContext(
  read: () => NewStaticSymbolSimplifySource,
  artwork: Vector[],
): StaticSymbolSimplifyContext {
  return captureNewSymbolSimplifyContext(read, artwork, true);
}
function captureNewSymbolSimplifyContext(
  read: () => NewStaticSymbolSimplifySource,
  artwork: Vector[],
  initialFrame: boolean,
): StaticSymbolSimplifyContext {
  const location = initialFrame ? Object.freeze({ layerId: '@base', frame: 0 }) : undefined;
  let reading = false,
    dead = false;
  function source() {
    if (reading || dead) {
      dead = true;
      throw Error('New symbol source reentered.');
    }
    reading = true;
    try {
      const value = read(),
        keys = [
          'project',
          'definition',
          'history',
          'session',
          'revision',
          'folder',
          'context',
          'eligible',
        ];
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      )
        throw Error('Invalid original new-symbol context.');
      const fields = Object.getOwnPropertyDescriptors(value);
      if (
        Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key)) ||
        keys.some((key) => !fields[key]?.enumerable || !('value' in fields[key]))
      )
        throw Error('Original new-symbol context requires data fields.');
      validateLiveGraphicData(value.project);
      validateLiveGraphicData(value.definition);
      if (
        dead ||
        value.eligible !== true ||
        !value.history ||
        !value.session ||
        typeof value.history !== 'object' ||
        typeof value.session !== 'object' ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.folder !== 'string' ||
        typeof value.context !== 'string' ||
        !value.definition ||
        typeof value.definition.id !== 'string' ||
        !value.definition.id ||
        !Array.isArray(value.definition.shapes) ||
        value.definition.shapes.length ||
        (initialFrame
          ? (!value.definition.buttonStates &&
              !(value.definition.defaultPlayback === 'movie' && value.definition.timeline)) ||
            !!value.definition.timeline?.keys.length ||
            !!value.definition.timeline?.layers?.length ||
            !!value.definition.timeline?.motionSpans?.length
          : value.definition.timeline !== undefined || value.definition.buttonStates !== undefined)
      )
        throw Error(
          initialFrame
            ? 'Choose the original blank unpublished movie/button initial frame.'
            : 'Choose the original unpublished static-symbol draft.',
        );
      return { ...value };
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      reading = false;
    }
  }
  validateLiveGraphicData(artwork);
  if (!Array.isArray(artwork) || !artwork.length)
    throw Error('Add initial symbol artwork before continuing.');
  const first = source(),
    signature = stamp(first.project),
    definitionStamp = stamp(first.definition),
    input = stamp(artwork);
  validateProject(first.project);
  if (first.project.symbols?.some((s) => s.id === first.definition.id))
    throw Error('The pending symbol identity already exists.');
  function current() {
    const live = source();
    validateLiveGraphicData(artwork);
    if (
      live.project !== first.project ||
      live.definition !== first.definition ||
      live.history !== first.history ||
      live.session !== first.session ||
      live.revision !== first.revision ||
      live.folder !== first.folder ||
      live.context !== first.context ||
      stamp(live.project) !== signature ||
      stamp(live.definition) !== definitionStamp ||
      stamp(artwork) !== input
    ) {
      dead = true;
      throw Error('Original project or pending symbol changed. Cancel and recreate the symbol.');
    }
  }
  current();
  const original = { project: first.project, definition: first.definition, artwork },
    expected = stamp(original),
    copy = structuredClone(original);
  detached(original, copy);
  validateLiveGraphicData(copy);
  current();
  if (stamp(original) !== expected || stamp(copy) !== expected)
    throw Error('New symbol snapshot changed.');
  // Caller artwork/header values may reference members of the original Project.
  // A tuple clone preserves such graph aliases; the pending definition must
  // remain independent of the copied old Library as well as the live source.
  const payload = { definition: copy.definition, artwork: copy.artwork },
    payloadStamp = stamp(payload),
    pending = structuredClone(payload);
  detached(copy, pending);
  validateLiveGraphicData(pending);
  current();
  if (
    stamp(copy) !== expected ||
    stamp(payload) !== payloadStamp ||
    stamp(pending) !== payloadStamp
  )
    throw Error('Pending symbol copy changed.');
  const candidate = copy.project;
  candidate.symbols = [
    ...(candidate.symbols ?? []),
    { ...pending.definition, shapes: pending.artwork },
  ];
  if (first.folder) moveLibraryItem(candidate, 'symbol', first.definition.id, first.folder);
  setLibraryLink(
    candidate,
    'symbol',
    first.definition.id,
    suggestLibraryLink(candidate, first.definition.name),
  );
  validateLiveGraphicData(candidate);
  validateProject(candidate);
  symbolSimplifyArtwork(candidate.symbols!.at(-1)!, location);
  current();
  const candidateStamp = stamp(candidate);
  return Object.freeze({
    project: candidate,
    ...(location ? { location } : {}),
    validate() {
      current();
      validateLiveGraphicData(candidate);
      if (stamp(candidate) !== candidateStamp) throw Error('Prepared pending symbol changed.');
      current();
    },
  });
}
