import type { Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { createCubicDistanceCorrespondence } from './motion-path';
import { selectionTrajectoryStamp } from './selection-trajectory';

/** Detached storage proposal, not a MotionPath field or document-schema admission.
 * Retain the original relative cubic and an absolute original progress window.
 * Reopening regenerates the original table, never a table over the fitted half. */
export type RestrictedArcCorrespondence = {
  version: 1;
  cubic: readonly [Point, Point, Point, Point];
  from: number;
  to: number;
};

function unit(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw Error('Restricted arc progress must be finite and within zero and one.');
}

export function openRestrictedArcCorrespondence(input: RestrictedArcCorrespondence) {
  validateLiveGraphicData(input);
  const stamp = selectionTrajectoryStamp(input);
  const data = structuredClone(input);
  validateLiveGraphicData(data);
  if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
    throw Error('Restricted arc source changed while being captured.');
  if (
    !data ||
    Reflect.ownKeys(data).length !== 4 ||
    Reflect.ownKeys(data).some(
      (key) => !['version', 'cubic', 'from', 'to'].includes(String(key)),
    ) ||
    data.version !== 1 ||
    !Array.isArray(data.cubic) ||
    data.cubic.length !== 4 ||
    data.cubic.some(
      (point) =>
        !point ||
        Reflect.ownKeys(point).length !== 2 ||
        !Object.hasOwn(point, 'x') ||
        !Object.hasOwn(point, 'y') ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y),
    ) ||
    data.cubic[0].x !== 0 ||
    data.cubic[0].y !== 0
  )
    throw Error('Choose one original relative cubic arc descriptor.');
  unit(data.from);
  unit(data.to);
  if (!(data.from < data.to)) throw Error('Restricted arc window must increase.');
  const { from, to } = data;
  const original = createCubicDistanceCorrespondence([data.cubic]);
  const first = original.parameter(from),
    last = original.parameter(to),
    width = last - first,
    duration = to - from;
  if (!Number.isFinite(width) || !(width > 0))
    throw Error('Restricted arc parameter window is numerically unresolved.');
  const midpoint = from + duration / 2;
  const middleParameter = original.parameter(midpoint);
  if (!(midpoint > from && midpoint < to) || !(middleParameter > first && middleParameter < last))
    throw Error('Restricted arc midpoint is numerically unresolved.');
  const at = (t: number) => (t === 0 ? from : t === 1 ? to : from + duration * t);
  const descriptor = Object.freeze({
    ...data,
    cubic: Object.freeze(data.cubic.map((point) => Object.freeze({ ...point }))),
  }) as Readonly<RestrictedArcCorrespondence>;
  validateLiveGraphicData(input);
  validateLiveGraphicData(data);
  if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
    throw Error('Restricted arc source changed during preparation.');
  return {
    descriptor,
    first,
    last,
    parameter(progress: number): number {
      unit(progress);
      if (progress === 0 || progress === 1) return progress;
      const value = (original.parameter(at(progress)) - first) / width;
      unit(value);
      return value;
    },
    fraction(parameter: number): number {
      unit(parameter);
      if (parameter === 0 || parameter === 1) return parameter;
      const value = (original.fraction(first + width * parameter) - from) / duration;
      unit(value);
      return value;
    },
    restrict(from: number, to: number): Readonly<RestrictedArcCorrespondence> {
      unit(from);
      unit(to);
      if (!(from < to)) throw Error('Restricted arc window must increase.');
      // Store absolute original progress, avoiding tables recompiled from halves.
      return openRestrictedArcCorrespondence({ ...descriptor, from: at(from), to: at(to) })
        .descriptor;
    },
  };
}
