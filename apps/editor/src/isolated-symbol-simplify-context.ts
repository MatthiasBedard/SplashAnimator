import {
  symbolSimplifyArtwork,
  withSymbolSimplifyArtwork,
  snapshotSymbolSimplifyLocation,
} from '../../../packages/geometry/src/symbol-simplify-artwork';
import { validateProject, type Project, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../../packages/animation/src/selection-trajectory';
import { assertSymbolSimplifyDetached as detached } from '../../../packages/geometry/src/symbol-simplify-owner';
import type { StaticSymbolSimplifyContext } from './symbol-simplify-context';

export type IsolatedSymbolSimplifySource = {
  artwork: Vector[];
  source: object;
  session: object;
  past: object;
  future: object;
  symbolId: string;
  group: string;
  selected: string;
  revision: number;
  context: string;
  eligible: boolean;
};
/** Restore one group boundary without changing optional fields or turning a
 * property-order-only rewrite into an artwork edit/history entry. */
export function replaceIsolatedSymbolGroup(
  parent: Vector[],
  group: string,
  artwork: Vector[],
): Vector[] {
  validateLiveGraphicData({ parent, group, artwork });
  const signature = stamp(parent),
    input = stamp(artwork),
    first = parent.findIndex((s) => s.groups?.[0] === group);
  if (first < 0) throw Error('The original isolated group no longer exists.');
  const copies = structuredClone(artwork);
  detached(artwork, copies);
  validateLiveGraphicData(copies);
  if (stamp(parent) !== signature || stamp(artwork) !== input || stamp(copies) !== input)
    throw Error('Isolated replacement source changed.');
  const originals = new Map(parent.map((s) => [s.id, s]));
  const grouped = copies.map((s) => {
    const next = { ...s, groups: [group, ...(s.groups ?? [])] },
      original = originals.get(s.id);
    if (!original || original.groups?.[0] !== group) return next;
    const keys = Object.keys(original).filter((key) => Object.hasOwn(next, key));
    return Object.fromEntries(
      [...keys, ...Object.keys(next).filter((key) => !Object.hasOwn(original, key))].map((key) => [
        key,
        (next as unknown as Record<string, unknown>)[key],
      ]),
    ) as unknown as Vector;
  });
  const result = parent.filter((s) => s.groups?.[0] !== group);
  result.splice(first, 0, ...grouped);
  return result;
}
/** Compose one original parent group into the complete enclosing static draft.
 * The full Project owns worker validation; returned local artwork owns neither
 * ancestry nor unrelated members. This facade never writes drafts/history. */
export function captureIsolatedSymbolSimplifyContext(
  read: () => IsolatedSymbolSimplifySource,
  artwork: Vector[],
  prepare: (artwork: Vector[]) => StaticSymbolSimplifyContext,
): StaticSymbolSimplifyContext {
  let reading = false,
    checking = false,
    dead = false;
  function source() {
    if (dead || reading) {
      dead = true;
      throw Error('Isolated simplification source reentered.');
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
        throw Error('Invalid isolated context.');
      const fields = Object.getOwnPropertyDescriptors(value),
        keys = [
          'artwork',
          'source',
          'session',
          'past',
          'future',
          'symbolId',
          'group',
          'selected',
          'revision',
          'context',
          'eligible',
        ];
      if (
        Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key)) ||
        keys.some((key) => !fields[key]?.enumerable || !('value' in fields[key]))
      )
        throw Error('Original isolated context requires data fields.');
      validateLiveGraphicData(value.artwork);
      if (
        dead ||
        !Array.isArray(value.artwork) ||
        value.eligible !== true ||
        !value.source ||
        !value.session ||
        !value.past ||
        !value.future ||
        ![value.source, value.session, value.past, value.future].every(
          (v) => typeof v === 'object',
        ) ||
        typeof value.symbolId !== 'string' ||
        !value.symbolId ||
        typeof value.group !== 'string' ||
        !value.group ||
        typeof value.selected !== 'string' ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.context !== 'string'
      )
        throw Error('Choose the original isolated static-symbol group.');
      return { ...value };
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      reading = false;
    }
  }
  validateLiveGraphicData(artwork);
  const first = source(),
    signature = stamp(first.artwork),
    input = stamp(artwork);
  const parent: {
    context?: StaticSymbolSimplifyContext;
    signature?: string;
    validate?: () => void;
  } = {};
  function prepared(data: Vector[]) {
    const value = prepare(data);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw Error('Invalid enclosing context.');
    const fields = Object.getOwnPropertyDescriptors(value);
    if (
      !fields.project ||
      !fields.validate ||
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== 'string' ||
          !['project', 'validate', 'ancestry', 'extract', 'location'].includes(key),
      ) ||
      Object.values(fields).some((field) => !field.enumerable || !('value' in field)) ||
      typeof fields.validate.value !== 'function'
    )
      throw Error('Enclosing context requires original data fields.');
    validateLiveGraphicData(value.project);
    validateProject(value.project);
    validateLiveGraphicData({ ancestry: value.ancestry, location: value.location });
    detached(first.artwork, value.project);
    detached(artwork, value.project);
    return value;
  }
  function current() {
    if (dead || checking) {
      dead = true;
      throw Error('Isolated simplification admission reentered.');
    }
    checking = true;
    try {
      function original() {
        const live = source();
        validateLiveGraphicData(artwork);
        if (
          live.source !== first.source ||
          live.session !== first.session ||
          live.past !== first.past ||
          live.future !== first.future ||
          live.symbolId !== first.symbolId ||
          live.group !== first.group ||
          live.selected !== first.selected ||
          live.revision !== first.revision ||
          live.context !== first.context ||
          stamp(live.artwork) !== signature ||
          stamp(first.artwork) !== signature ||
          stamp(artwork) !== input
        )
          throw Error('Original isolated artwork or context changed. Cancel and reopen the group.');
      }
      original();
      const admission = parent.validate?.() as unknown;
      if (admission && typeof (admission as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(admission).catch(() => {});
        throw Error('Isolated enclosing admission must be synchronous.');
      }
      original();
      if (dead || (parent.context && stamp(parent.context.project) !== parent.signature))
        throw Error('Prepared enclosing artwork changed.');
    } catch (cause) {
      dead = true;
      throw cause;
    } finally {
      checking = false;
    }
  }
  current();
  // Validate the complete original parent, including data replaced by this edit.
  const original = prepared(first.artwork);
  const originalAdmission = original.validate() as unknown;
  if (originalAdmission && typeof (originalAdmission as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(originalAdmission).catch(() => {});
    throw Error('Isolated enclosing admission must be synchronous.');
  }
  current();
  const next = replaceIsolatedSymbolGroup(first.artwork, first.group, artwork);
  current();
  const enclosing = prepared(next);
  parent.context = enclosing;
  const descriptor = Object.getOwnPropertyDescriptor(enclosing, 'validate');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function')
    throw Error('Choose original synchronous enclosing admission.');
  parent.validate = descriptor.value;
  validateLiveGraphicData(enclosing.project);
  validateProject(enclosing.project);
  const enclosingStamp = stamp(enclosing.project);
  parent.signature = enclosingStamp;
  validateLiveGraphicData({ ancestry: enclosing.ancestry });
  if (
    stamp([original.ancestry, original.location]) !==
    stamp([enclosing.ancestry, enclosing.location])
  )
    throw Error('Parent isolation boundary changed.');
  const ancestry = Object.freeze([...(enclosing.ancestry ?? []), first.group]);
  if (ancestry.length > 32 || new Set(ancestry).size !== ancestry.length)
    throw Error('Invalid original isolation ancestry.');
  const definition = enclosing.project.symbols?.find((s) => s.id === first.symbolId);
  if (!definition || (!enclosing.location && (definition.timeline || definition.buttonStates)))
    throw Error('Choose original static Library or owned frame artwork.');
  const location = enclosing.location
    ? Object.freeze(snapshotSymbolSimplifyLocation(enclosing.location))
    : undefined;
  const originalArtwork = symbolSimplifyArtwork(definition, location);
  const inside = (s: Vector) => ancestry.every((id, i) => s.groups?.[i] === id);
  const members = originalArtwork.filter(inside),
    ids = members.map((s) => s.id),
    byId = new Map(members.map((s) => [s.id, s]));
  if (!members.length && artwork.length) throw Error('Original isolated membership changed.');
  const stripped = (s: Vector) => {
    const expected = stamp(s),
      copy = structuredClone(s);
    detached(s, copy);
    validateLiveGraphicData(copy);
    if (stamp(s) !== expected || stamp(copy) !== expected)
      throw Error('Isolated artwork clone changed.');
    copy.groups = s.groups!.slice(ancestry.length);
    if (!copy.groups.length) delete copy.groups;
    return copy;
  };
  if (stamp(members.map(stripped)) !== input)
    throw Error('Enclosing candidate changed isolated artwork.');
  current();
  return Object.freeze({
    project: enclosing.project,
    ancestry,
    ...(location ? { location } : {}),
    validate: current,
    extract(candidate: Project): Vector[] {
      current();
      validateLiveGraphicData(candidate);
      validateProject(candidate);
      const expected = stamp(candidate),
        copy = structuredClone(candidate);
      detached(candidate, copy);
      detached(first.artwork, copy);
      detached(artwork, copy);
      detached(enclosing.project, copy);
      current();
      validateLiveGraphicData(copy);
      validateProject(copy);
      if (stamp(copy) !== expected) throw Error('Returned candidate clone changed.');
      const edited = copy.symbols?.find((s) => s.id === first.symbolId);
      if (!edited) throw Error('Original isolated definition disappeared.');
      const editedArtwork = symbolSimplifyArtwork(edited, location);
      if (stamp(editedArtwork.map((s) => s.id)) !== stamp(originalArtwork.map((s) => s.id)))
        throw Error('Returned isolated identities changed.');
      const reduced = editedArtwork.filter(inside);
      if (
        stamp(reduced.map((s) => s.id)) !== stamp(ids) ||
        reduced.some((s, i) => stamp(s.groups) !== stamp(members[i].groups))
      )
        throw Error('Returned isolated ancestry changed.');
      const restored = editedArtwork.map((s) => (inside(s) ? structuredClone(byId.get(s.id)!) : s));
      copy.symbols = copy.symbols!.map((s) =>
        s.id === first.symbolId ? withSymbolSimplifyArtwork(s, restored, location) : s,
      );
      if (stamp(copy) !== enclosingStamp) throw Error('Unrelated enclosing artwork changed.');
      const output = reduced.map(stripped),
        resultStamp = stamp(output);
      validateLiveGraphicData(output);
      detached(candidate, output);
      detached(first.artwork, output);
      detached(artwork, output);
      current();
      if (stamp(candidate) !== expected || stamp(output) !== resultStamp)
        throw Error('Returned isolated copy changed.');
      return output;
    },
  });
}
