import type { Point, Vector } from '../../../packages/document/src';
import type { MotionRotation } from '../../../packages/animation/src/motion-rotation';
import { prepareRigidGroups, rigidGroupPosition } from '../../../packages/animation/src/motion-rigid';
import { createMotionPathSampler, type MotionPath } from '../../../packages/animation/src/motion-path';

/** Bounded geometric preview of the active track's first group leader, without writes. */
export function motionGroupPreview(from: Vector[], to: Vector[], rotation: MotionRotation, path: MotionPath): Point[] {
  if (!rotation.rigidGroups || !from.length || !to.length) return [];
  if (from.length !== to.length || from.length > 10000)
    throw new Error('Group preview requires matching endpoints with at most 10000 artwork objects.');
  const member = prepareRigidGroups(from, to, rotation)[0];
  if (!member || member.leader !== 0) return [];
  const samples = Math.max(64, Math.ceil(Math.abs(member.delta) / 5));
  if (samples > 2048) throw new Error('Group preview exceeds its rotation sampling limit.');
  const sample = createMotionPathSampler(from[0], to[0], path);
  const points: Point[] = [{ x: from[0].x, y: from[0].y }];
  for (let i = 1; i < samples; i++) {
    const t = i / samples, point = rigidGroupPosition(from[0], to[0], member, t, sample(t));
    if (![point.x, point.y].every(Number.isFinite)) throw new Error('Group preview exceeds numeric limits.');
    points.push(point);
  }
  points.push({ x: to[0].x, y: to[0].y });
  return points;
}
