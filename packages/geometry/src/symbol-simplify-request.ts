import { validateProject, type Project, type Vector, type BezierNode } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { selectionTrajectoryStamp as stamp } from '../../animation/src/selection-trajectory';
import { artworkVertices } from './artwork-simplify';
import { copySymbolChildren } from './symbol-artwork';
import {
  symbolSimplifyArtwork,
  withSymbolSimplifyArtwork,
  type SymbolSimplifyLocation,
} from './symbol-simplify-artwork';
import {
  captureSymbolArtworkSimplification,
  prepareSymbolArtworkSimplification,
  assertSymbolSimplifyDetached,
} from './symbol-simplify-owner';

export type SymbolSimplifyRequest = {
  project: Project;
  symbolId: string;
  selected: string[];
  /** Explicit original group boundary; omission preserves complete root units. */
  ancestry?: string[];
  /** Explicit original animated/button layer and stored key; never a sampled pose. */
  location?: SymbolSimplifyLocation;
};
export type SymbolSimplifyResult = ReturnType<typeof prepareSymbolArtworkSimplification>;

/** A detached request snapshot is data, never authority to edit a live draft. */
export function snapshotSymbolSimplifyRequest(
  request: SymbolSimplifyRequest,
): SymbolSimplifyRequest {
  validateLiveGraphicData(request);
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(request)) ||
    Reflect.ownKeys(request).some(
      (k) => !['project', 'symbolId', 'selected', 'ancestry', 'location'].includes(String(k)),
    )
  )
    throw Error('Invalid symbol simplification request.');
  const expected = stamp(request),
    copy = structuredClone(request);
  assertSymbolSimplifyDetached(request, copy);
  validateLiveGraphicData(copy);
  validateProject(copy.project);
  const capture = captureSymbolArtworkSimplification(() => ({
    project: copy.project,
    revision: 0,
  }));
  try {
    if (copy.location !== undefined)
      capture.resolveFrame(copy.symbolId, copy.location, copy.selected, copy.ancestry);
    else if (copy.ancestry !== undefined)
      capture.resolveIsolated(copy.symbolId, copy.ancestry, copy.selected);
    else capture.resolve(copy.symbolId, copy.selected);
  } finally {
    capture.dispose();
  }
  if (stamp(request) !== expected || stamp(copy) !== expected)
    throw Error('Symbol request changed during capture.');
  return copy;
}

/** Worker-side private ownership and full library/aggregate preparation. */
export function prepareSymbolSimplifyRequest(request: SymbolSimplifyRequest): SymbolSimplifyResult {
  const input = snapshotSymbolSimplifyRequest(request);
  const capture = captureSymbolArtworkSimplification(() => ({
    project: input.project,
    revision: 0,
  }));
  try {
    const owner =
      input.location !== undefined
        ? capture.resolveFrame(input.symbolId, input.location, input.selected, input.ancestry)
        : input.ancestry === undefined
          ? capture.resolve(input.symbolId, input.selected)
          : capture.resolveIsolated(input.symbolId, input.ancestry, input.selected);
    return prepareSymbolArtworkSimplification(owner);
  } finally {
    capture.dispose();
  }
}

/** Admit a complete background result against the host's private snapshot.
 * The worker owns fitting/topology certification; the host independently owns
 * complete-library identity, selection, metadata, counts and output detachment.
 * Caller still checks original live source/context before any history write. */
export function admitSymbolSimplifyResult(
  input: SymbolSimplifyRequest,
  result: SymbolSimplifyResult,
): SymbolSimplifyResult {
  validateLiveGraphicData(input);
  const sourceStamp = stamp(input);
  validateLiveGraphicData(result);
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    Reflect.ownKeys(result).some((k) => !['project', 'selected', 'removed'].includes(String(k))) ||
    !Number.isSafeInteger(result.removed) ||
    result.removed < 0 ||
    !Array.isArray(result.selected)
  )
    throw Error('Invalid symbol simplification response.');
  validateProject(result.project);
  const original = input.project.symbols!.find((s) => s.id === input.symbolId)!;
  if (!original || (!input.location && (original.timeline || original.buttonStates)))
    throw Error('Choose original static artwork or an explicit frame location.');
  const artwork = symbolSimplifyArtwork(original, input.location);
  let selected: string[];
  if (input.ancestry === undefined && input.location === undefined)
    selected = copySymbolChildren(artwork, input.selected).map((s) => s.id);
  else {
    const capture = captureSymbolArtworkSimplification(() => ({
      project: input.project,
      revision: 0,
    }));
    try {
      selected = [
        ...(input.location !== undefined
          ? capture.resolveFrame(input.symbolId, input.location, input.selected, input.ancestry)
          : capture.resolveIsolated(input.symbolId, input.ancestry!, input.selected)
        ).selected,
      ];
    } finally {
      capture.dispose();
    }
  }
  if (stamp(result.selected) !== stamp(selected)) throw Error('Original symbol selection changed.');
  const next = result.project.symbols?.find((s) => s.id === input.symbolId);
  if (!next) throw Error('Original symbol artwork changed.');
  const edited = symbolSimplifyArtwork(next, input.location);
  if (edited.length !== artwork.length) throw Error('Original symbol artwork changed.');
  const restored = structuredClone(result.project);
  assertSymbolSimplifyDetached(result.project, restored);
  assertSymbolSimplifyDetached(input, restored);
  restored.symbols = restored.symbols!.map((s) =>
    s.id === input.symbolId
      ? withSymbolSimplifyArtwork(s, structuredClone(artwork), input.location)
      : s,
  );
  if (stamp(restored) !== stamp(input.project))
    throw Error('Unrelated symbol project data changed.');
  let removed = 0;
  const metadata = (s: Vector) => {
    const { kind, nodes, points, contours, closed, ...rest } = s;
    void kind;
    void nodes;
    void points;
    void contours;
    void closed;
    return rest;
  };
  const closure = (s: Vector) => !!s.contours || !!s.closed || s.kind === 'polygon';
  artwork.forEach((before, i) => {
    const after = edited[i];
    if (stamp(before) === stamp(after)) return;
    if (
      !selected.includes(before.id) ||
      before.id !== after.id ||
      stamp(metadata(before)) !== stamp(metadata(after)) ||
      closure(before) !== closure(after) ||
      !!before.contours !== !!after.contours ||
      (before.contours && before.contours.length !== after.contours!.length)
    )
      throw Error('Original symbol artwork metadata changed.');
    const expectedKind =
      before.kind === 'path' || (before.kind === 'polygon' && !before.contours)
        ? 'bezier'
        : before.kind;
    if (after.kind !== expectedKind) throw Error('Original symbol artwork kind changed.');
    if (before.kind === 'brush' || before.contours) {
      if (
        stamp(after.nodes) !== stamp(before.nodes) ||
        stamp(after.closed) !== stamp(before.closed) ||
        (before.contours && stamp(after.points) !== stamp(before.points))
      )
        throw Error('Inactive symbol geometry changed.');
    } else if (
      after.points.length ||
      after.closed !== (before.kind === 'polygon' ? true : before.closed)
    )
      throw Error('Unexpected symbol curve storage.');
    const reduction = artworkVertices(before) - artworkVertices(after);
    if (reduction <= 0) throw Error('Symbol simplification did not reduce its changed artwork.');
    if (before.kind === 'brush') {
      let cursor = 0;
      for (const p of after.points) {
        while (cursor < before.points.length && stamp(p) !== stamp(before.points[cursor])) cursor++;
        if (cursor === before.points.length) throw Error('Original Brush samples changed.');
        cursor++;
      }
      if (
        stamp(after.points[0]) !== stamp(before.points[0]) ||
        stamp(after.points.at(-1)) !== stamp(before.points.at(-1))
      )
        throw Error('Original Brush endpoints changed.');
    } else if (!closure(before)) {
      const first = before.nodes ?? before.points,
        last = after.nodes ?? after.points;
      for (const index of [0, -1]) {
        const a = { ...first.at(index) } as BezierNode,
          b = { ...last.at(index) } as BezierNode;
        delete a.in;
        delete a.out;
        delete b.in;
        delete b.out;
        if (stamp(a) !== stamp(b)) throw Error('Original line endpoints changed.');
      }
    }
    removed += reduction;
  });
  if (removed !== result.removed) throw Error('Symbol vertex reduction count changed.');
  const expected = stamp(result),
    output = structuredClone(result);
  assertSymbolSimplifyDetached(result, output);
  assertSymbolSimplifyDetached(input, output);
  validateLiveGraphicData(output);
  validateProject(output.project);
  if (stamp(input) !== sourceStamp || stamp(result) !== expected || stamp(output) !== expected)
    throw Error('Symbol response changed after cloning.');
  return output;
}
