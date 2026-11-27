import type { SymbolSimplifyLocation } from '../../../packages/geometry/src/symbol-simplify-artwork';
import { validateProject, type Project, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { updateSymbolArtwork } from '../../../packages/geometry/src/symbols';
import { assertSymbolSimplifyDetached } from '../../../packages/geometry/src/symbol-simplify-owner';

export type StaticSymbolSimplifySource = {
  project: Project;
  history: object;
  session: object;
  revision: number;
  symbolId: string;
  context: string;
  eligible: boolean;
};
export type StaticSymbolSimplifyContext = {
  project: Project;
  validate: () => void;
  ancestry?: readonly string[];
  location?: SymbolSimplifyLocation;
  extract?: (project: Project) => Vector[];
};
/** Private original enclosing context for one existing static Library draft. */
export function captureStaticSymbolSimplifyContext(
  read: () => StaticSymbolSimplifySource,
  artwork: Vector[],
): StaticSymbolSimplifyContext {
  let reading = false,
    dead = false;
  const source = () => {
    if (dead || reading) {
      dead = true;
      throw Error('Library simplification context reentered.');
    }
    reading = true;
    try {
      const value = read();
      if (
        dead ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      )
        throw Error('Invalid original Library context.');
      const fields = Object.getOwnPropertyDescriptors(value);
      for (const key of [
        'project',
        'history',
        'session',
        'revision',
        'symbolId',
        'context',
        'eligible',
      ])
        if (!fields[key]?.enumerable || !('value' in fields[key]))
          throw Error('Original Library context requires data fields.');
      validateLiveGraphicData(value.project);
      if (
        value.eligible !== true ||
        typeof value.symbolId !== 'string' ||
        !value.symbolId ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.context !== 'string' ||
        !value.history ||
        !value.session
      )
        throw Error('Choose an existing static Library symbol.');
      return { ...value };
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      reading = false;
    }
  };
  validateLiveGraphicData(artwork);
  const first = source(),
    signature = stamp(first.project),
    input = stamp(artwork);
  validateProject(first.project);
  const definition = first.project.symbols?.find((s) => s.id === first.symbolId);
  if (!definition || definition.timeline || definition.buttonStates)
    throw Error('Choose an existing static Library symbol.');
  function current() {
    const live = source();
    validateLiveGraphicData(artwork);
    if (
      dead ||
      live.project !== first.project ||
      live.history !== first.history ||
      live.session !== first.session ||
      live.revision !== first.revision ||
      live.symbolId !== first.symbolId ||
      live.context !== first.context ||
      stamp(live.project) !== signature ||
      stamp(artwork) !== input
    ) {
      dead = true;
      throw Error('Original Library source changed. Cancel and reopen the symbol.');
    }
  }
  current();
  const candidate = structuredClone(first.project);
  assertSymbolSimplifyDetached(first.project, candidate);
  current();
  updateSymbolArtwork(candidate, first.symbolId, artwork);
  validateLiveGraphicData(candidate);
  validateProject(candidate);
  current();
  const expected = stamp(candidate);
  return {
    project: candidate,
    validate() {
      current();
      validateLiveGraphicData(candidate);
      if (stamp(candidate) !== expected) throw Error('Prepared Library input changed.');
      current();
    },
  };
}
