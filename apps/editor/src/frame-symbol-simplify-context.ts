import {
  validateProject,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { assertSymbolSimplifyDetached as detached } from '../../../packages/geometry/src/symbol-simplify-owner';
import {
  snapshotSymbolSimplifyLocation,
  symbolSimplifyArtwork,
  withSymbolSimplifyArtwork,
  type SymbolSimplifyLocation,
} from '../../../packages/geometry/src/symbol-simplify-artwork';
import type { StaticSymbolSimplifyContext } from './symbol-simplify-context';

export type FrameSymbolSimplifySource = {
  project: Project;
  definition: SymbolDefinition;
  history: object;
  session: object;
  revision: number;
  location: SymbolSimplifyLocation;
  context: string;
  eligible: boolean;
};
/** Existing Library timeline/button draft only. Caller's original enclosing
 * callback owns proxy-safe snapshots and actual UI/history/context lifetime. */
export function captureFrameSymbolSimplifyContext(
  read: () => FrameSymbolSimplifySource,
  artwork: Vector[],
): StaticSymbolSimplifyContext {
  let dead = false,
    reading = false,
    checking = false;
  function source() {
    if (dead || reading) {
      dead = true;
      throw Error('Original symbol-frame context reentered.');
    }
    reading = true;
    try {
      const value = read();
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      )
        throw Error('Invalid original frame context.');
      const fields = Object.getOwnPropertyDescriptors(value),
        keys = [
          'project',
          'definition',
          'history',
          'session',
          'revision',
          'location',
          'context',
          'eligible',
        ];
      if (
        Reflect.ownKeys(fields).length !== keys.length ||
        keys.some((key) => !fields[key]?.enumerable || !('value' in fields[key]))
      )
        throw Error('Frame context requires original data fields.');
      validateLiveGraphicData({
        project: value.project,
        definition: value.definition,
        location: value.location,
      });
      if (
        value.eligible !== true ||
        !value.history ||
        typeof value.history !== 'object' ||
        !value.session ||
        typeof value.session !== 'object' ||
        typeof value.context !== 'string' ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0
      )
        throw Error('Choose original existing frame artwork.');
      return { ...value, location: snapshotSymbolSimplifyLocation(value.location) };
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      reading = false;
    }
  }
  validateLiveGraphicData(artwork);
  const first = source(),
    signature = stamp([first.project, first.definition, first.location]),
    input = stamp(artwork);
  validateProject(first.project);
  if (!first.project.symbols?.some((s) => s.id === first.definition.id))
    throw Error('Choose an existing Library definition.');
  symbolSimplifyArtwork(first.definition, first.location);
  function current() {
    if (dead || checking) {
      dead = true;
      throw Error('Frame admission reentered.');
    }
    checking = true;
    try {
      const live = source();
      validateLiveGraphicData(artwork);
      if (
        dead ||
        live.project !== first.project ||
        live.definition !== first.definition ||
        live.history !== first.history ||
        live.session !== first.session ||
        live.revision !== first.revision ||
        live.context !== first.context ||
        stamp([live.project, live.definition, live.location]) !== signature ||
        stamp(artwork) !== input
      )
        throw Error(
          'Original symbol frame/source/history changed. Cancel and reopen frame editing.',
        );
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      checking = false;
    }
  }
  current();
  const project = structuredClone(first.project),
    definition = structuredClone(first.definition),
    edited = structuredClone(artwork);
  validateLiveGraphicData({ project, definition, edited });
  for (const original of [first.project, first.definition, artwork])
    for (const copy of [project, definition, edited]) detached(original, copy);
  current();
  if (
    stamp(project) !== stamp(first.project) ||
    stamp(definition) !== stamp(first.definition) ||
    stamp(edited) !== input
  )
    throw Error('Original frame snapshot changed.');
  // Admit all original local draft data before replacing the selected slot.
  project.symbols = project.symbols!.map((s) => (s.id === definition.id ? definition : s));
  validateProject(project);
  current();
  project.symbols = project.symbols!.map((s) =>
    s.id === definition.id ? withSymbolSimplifyArtwork(s, edited, first.location) : s,
  );
  validateLiveGraphicData(project);
  validateProject(project);
  current();
  const expected = stamp(project),
    location = Object.freeze({ ...first.location });
  const originalArtwork = symbolSimplifyArtwork(
    project.symbols!.find((s) => s.id === definition.id)!,
    location,
  );
  function validate() {
    current();
    validateLiveGraphicData(project);
    if (stamp(project) !== expected) throw Error('Prepared frame input changed.');
    current();
    if (stamp(project) !== expected) throw Error('Prepared frame input changed after admission.');
  }
  return Object.freeze({
    project,
    location,
    validate,
    extract(candidate: Project) {
      validate();
      validateLiveGraphicData(candidate);
      validateProject(candidate);
      const candidateStamp = stamp(candidate),
        copy = structuredClone(candidate);
      detached(candidate, copy);
      detached(project, copy);
      detached(first.project, copy);
      detached(artwork, copy);
      validateLiveGraphicData(copy);
      validateProject(copy);
      validate();
      if (stamp(copy) !== candidateStamp) throw Error('Returned frame clone changed.');
      const next = copy.symbols!.find((s) => s.id === definition.id);
      if (!next) throw Error('Original frame definition disappeared.');
      const reduced = symbolSimplifyArtwork(next, location),
        outputStamp = stamp(reduced),
        output = structuredClone(reduced);
      detached(reduced, output);
      copy.symbols = copy.symbols!.map((s) =>
        s.id === definition.id
          ? withSymbolSimplifyArtwork(s, structuredClone(originalArtwork), location)
          : s,
      );
      if (stamp(copy) !== expected) throw Error('Unrelated frame project data changed.');
      validateLiveGraphicData(output);
      detached(candidate, output);
      detached(project, output);
      detached(artwork, output);
      validate();
      if (
        stamp(candidate) !== candidateStamp ||
        stamp(reduced) !== outputStamp ||
        stamp(output) !== outputStamp
      )
        throw Error('Returned frame data changed after admission.');
      return output;
    },
  });
}
