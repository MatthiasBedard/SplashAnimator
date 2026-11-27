import { validateMotionRotation, type MotionRotation } from '../../document/src/motion-rotation';
export { validateMotionRotation, type MotionRotation } from '../../document/src/motion-rotation';

/** Positive rotation is clockwise in document coordinates (y points down). */
export function motionRotationDelta(from: number, to: number, rotation: MotionRotation): number {
  validateMotionRotation(rotation);
  const clockwise = ((((to % 360) - (from % 360)) % 360) + 360) % 360;
  if (rotation.direction === 'shortest')
    return (((((to % 360) - (from % 360)) % 360) + 540) % 360) - 180;
  if (rotation.direction === 'clockwise') return clockwise + rotation.turns * 360;
  return (clockwise === 0 ? 0 : clockwise - 360) - rotation.turns * 360;
}
