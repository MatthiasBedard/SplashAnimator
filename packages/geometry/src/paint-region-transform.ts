import { clone, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { mapPoint, type Matrix } from './affine';
import { transformSelectionVectors } from './stroke-transform';
import type { PaintRegion } from './paint-region';
import type { Bounds } from './layout';

export function paintRegionBounds(region: PaintRegion): Bounds | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const polygon of region)
    for (const ring of polygon)
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw Error('Paint region requires finite coordinates.');
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  return left === Infinity ? null : { left, top, right, bottom };
}
export function transformPaintRegion(region: PaintRegion, operation: Matrix): PaintRegion {
  if (
    operation.length !== 6 ||
    !operation.every(Number.isFinite) ||
    !Number.isFinite(operation[0] * operation[3] - operation[1] * operation[2]) ||
    Math.abs(operation[0] * operation[3] - operation[1] * operation[2]) < 1e-10
  )
    throw Error('Invalid paint selection transform.');
  paintRegionBounds(region);
  const output = region.map((p) =>
    p.map((r) =>
      r.map(([x, y]) => {
        const q = mapPoint(operation, { x, y });
        return [q.x, q.y] as [number, number];
      }),
    ),
  );
  paintRegionBounds(output);
  return output;
}
/** Clipping and final merge stay worker-owned. Prepare all selected pieces and
 * the retained selection together before publishing any document artwork. */
export function preparePaintRegionTransform(
  inside: Vector[],
  outside: Vector[],
  region: PaintRegion,
  operation: Matrix,
  unskewedOperation?: Matrix,
) {
  validateLiveGraphicData({ inside, outside, region, operation, ...(unskewedOperation ? { unskewedOperation } : {}) });
  const selection = transformPaintRegion(region, operation),
    moved = clone(inside);
  transformSelectionVectors(moved, operation, unskewedOperation);
  return { artwork: [...clone(outside), ...moved], selection };
}
