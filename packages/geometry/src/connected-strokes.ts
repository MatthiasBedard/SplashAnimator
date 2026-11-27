import type { Point, Vector } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { connectedPaint } from './connected';
import { contourInkPlan } from './ink-contour';
import { symbolStrokeCandidates } from './symbol-artwork';

/** Read-only network selection. Split contour ownership for traversal so a
 * disconnected ring of one object cannot act as a bridge to another line. */
export function connectedStrokeSelection(
  artwork: Vector[],
  seed: string,
  point: Point,
  tolerance = 2,
): string[] {
  validateLiveGraphicData({ artwork, seed, point, tolerance });
  if (
    typeof seed !== 'string' ||
    !seed ||
    ![point.x, point.y, tolerance].every(Number.isFinite) ||
    tolerance < 0
  )
    throw Error('Invalid connected stroke pick.');
  const finite = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw Error('Connected stroke selection requires finite artwork.');
    if (value && typeof value === 'object') for (const child of Object.values(value)) finite(child);
  };
  finite(artwork);
  if (new Set(artwork.map((s) => s.id)).size !== artwork.length)
    throw Error('Stroke artwork identities must be distinct.');
  const plan = contourInkPlan(symbolStrokeCandidates(artwork, seed), seed, point, tolerance);
  if (!plan.target) return [];
  const connected = connectedPaint(plan.strokes, plan.target);
  return plan.selected(new Set(connected.map((s) => s.id)));
}
