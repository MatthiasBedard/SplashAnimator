import type { Point, Vector } from '@splash/document';
import { placeFilledInkPieces } from './filled-ink-basis';
import { prepareFilledInkInBasis } from './shared-paint-cut';

/** Prepare ordinary document vectors with one geometry origin. Callers own
 * candidate validation and publication. */
export function preparePlacedFilledInk(sources: Vector[], cutter: Vector, origin: Point) {
  const cut = prepareFilledInkInBasis(sources, cutter, origin);
  return cut && placeFilledInkPieces(cut, cutter);
}
