import type { Point } from '../../../packages/document/src';
import {
  createMotionPathSampler,
  validateMotionPath,
  type MotionPath,
} from '../../../packages/animation/src/motion-path';

/** Align incoming vectors; optionally mirror outgoing lengths for equal-time C1 joins. */
export function alignMotionPathJoins(
  start: Point,
  end: Point,
  path: MotionPath,
  matchLengths = false,
): MotionPath {
  validateMotionPath(path);
  if (!path.waypointIncoming || !path.waypointTangents || !path.waypoints)
    throw new Error('Choose independent incoming curve handles to align joins.');
  const incoming = path.waypointIncoming.map((p, i) => {
    const out = path.waypointTangents![i + 1];
    const length = Math.hypot(p.x, p.y),
      scale = Math.max(Math.abs(out.x), Math.abs(out.y));
    if (!Number.isFinite(length) || length === 0 || scale === 0)
      throw new Error(
        'Join alignment requires nonzero finite incoming and outgoing handle lengths.',
      );
    if (matchLengths) return { x: -out.x, y: -out.y };
    const x = out.x / scale,
      y = out.y / scale,
      unit = Math.hypot(x, y);
    return { x: -(x / unit) * length, y: -(y / unit) * length };
  });
  const result: MotionPath = {
    ...path,
    tangent: true,
    waypoints: path.waypoints.map((p) => ({ ...p })),
    waypointTangents: path.waypointTangents.map((p) => ({ ...p })),
    waypointIncoming: incoming,
  };
  // Whole-path stationary/join and retained distance checks must pass before replacing settings.
  createMotionPathSampler(start, end, result);
  return result;
}
