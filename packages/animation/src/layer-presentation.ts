import type { Project, Vector } from '../../document/src';
import type { RootButton } from './button-preview';
import { evaluateLayers } from './index';
import { selectionTrajectoryStamp } from './selection-trajectory';

export type LayerPresentation = Readonly<{
  frame: number;
  /** Legacy render signature, not authority for source or clock lifetimes. */
  signature: string;
  layers: readonly Readonly<{ layerId: string; shapes: readonly Vector[] }>[];
  buttons: readonly RootButton[];
}>;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function admitPresentationClock(record: Record<string, number>, origins = false) {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw Error('Choose an original presentation clock record.');
  selectionTrajectoryStamp(record);
  if (
    Object.values(record).some(
      (value) =>
        typeof value !== 'number' ||
        value < 0 ||
        !Number.isFinite(value) ||
        (!origins && !Number.isSafeInteger(value)),
    )
  )
    throw Error('Invalid presentation clock position.');
}

/** A render-only detached view, never authority to edit/pick authored artwork or
 * commit/prune clock lifetimes. Hosts still bind actual source/history/clock
 * revisions when passing this presentation to a private prepared layer scene. */
export function detachPresentationData<T>(data: T): T {
  const stamp = selectionTrajectoryStamp(data);
  const detached = structuredClone(data);
  if (selectionTrajectoryStamp(data) !== stamp || selectionTrajectoryStamp(detached) !== stamp)
    throw Error('Resolved presentation changed while being detached.');
  return freeze(detached);
}

export function detachLayerPresentation(
  presented: Project,
  frame: number,
  movieFrames: Record<string, number>,
  buttons: RootButton[],
  signature: string,
): LayerPresentation {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= presented.duration)
    throw Error('Choose an exact presentation frame.');
  const layers = evaluateLayers(presented, frame, movieFrames);
  const ids = new Set(layers.map((layer) => layer.layerId));
  if (
    ids.size !== layers.length ||
    buttons.some((button) => !ids.has(button.layerId)) ||
    new Set(buttons.map((button) => button.token)).size !== buttons.length
  )
    throw Error('Resolved layer/button ownership is ambiguous.');
  const data = { frame, signature, layers, buttons };
  // Admit raw posed numbers/data before cloning; JSON cloning would erase
  // undefined metadata and conceal nonfinite coordinates.
  return detachPresentationData(data);
}

/** Snapshot caller-owned banks once before traversing resolved artwork. Native
 * Map iteration avoids caller iterator hooks; raw finite/data admission precedes
 * cloning, and the original values are checked again afterwards. */
export function capturePresentationBank<T>(bank: Map<string, T> | undefined) {
  if (bank === undefined) return undefined;
  const entries = [...Map.prototype.entries.call(bank)] as [string, T][];
  if (entries.some(([key]) => typeof key !== 'string'))
    throw Error('Invalid presentation bank key.');
  const stamp = selectionTrajectoryStamp(entries);
  const copy = structuredClone(entries);
  if (
    selectionTrajectoryStamp([...Map.prototype.entries.call(bank)]) !== stamp ||
    selectionTrajectoryStamp(copy) !== stamp
  )
    throw Error('Presentation bank changed while being captured.');
  return new Map(copy);
}
