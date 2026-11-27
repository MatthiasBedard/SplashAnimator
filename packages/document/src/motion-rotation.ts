export type MotionRotation = {
  direction: 'shortest' | 'clockwise' | 'counterclockwise';
  turns: number;
  rigidGroups?: boolean;
  groupDepth?: number;
  uniformGroupScale?: boolean;
  axisGroupScale?: boolean;
  /** Allow shared orientation-preserving shear, resolved from endpoint bases (single-axis fits take precedence). */
  axisGroupShear?: boolean;
  savedGroupPivots?: boolean;
  rigidPivot?: { x: number; y: number };
};
export function validateMotionRotation(rotation: MotionRotation): void {
  if (
    rotation.axisGroupShear !== undefined &&
    (typeof rotation.axisGroupShear !== 'boolean' ||
      (rotation.axisGroupShear && !rotation.axisGroupScale))
  )
    throw new Error('Group shear requires independent group axis scaling.');
  if (
    rotation.axisGroupScale !== undefined &&
    (typeof rotation.axisGroupScale !== 'boolean' ||
      (rotation.axisGroupScale && (!rotation.rigidGroups || rotation.uniformGroupScale)))
  )
    throw new Error(
      'Independent group axis scaling requires group motion without uniform scaling.',
    );
  if (
    rotation.groupDepth !== undefined &&
    (!rotation.rigidGroups || !Number.isSafeInteger(rotation.groupDepth) || rotation.groupDepth < 0)
  )
    throw new Error('Group nesting level requires group motion and a nonnegative safe integer.');
  if (
    rotation.savedGroupPivots !== undefined &&
    (typeof rotation.savedGroupPivots !== 'boolean' ||
      (rotation.savedGroupPivots && (!rotation.rigidGroups || rotation.rigidPivot !== undefined)))
  )
    throw new Error('Saved group pivots require group motion without a custom pivot offset.');
  if (
    rotation.uniformGroupScale !== undefined &&
    (typeof rotation.uniformGroupScale !== 'boolean' ||
      (rotation.uniformGroupScale && !rotation.rigidGroups))
  )
    throw new Error('Uniform group scaling requires group motion.');
  if (
    rotation.rigidPivot !== undefined &&
    (!rotation.rigidGroups ||
      !rotation.rigidPivot ||
      ![rotation.rigidPivot.x, rotation.rigidPivot.y].every(Number.isFinite))
  )
    throw new Error('A rigid pivot requires rigid groups and finite offset coordinates.');
  if (rotation.rigidGroups !== undefined && typeof rotation.rigidGroups !== 'boolean')
    throw new Error('Choose a supported rigid group motion mode.');
  if (
    !['shortest', 'clockwise', 'counterclockwise'].includes(rotation.direction) ||
    !Number.isSafeInteger(rotation.turns) ||
    rotation.turns < 0 ||
    !Number.isSafeInteger(rotation.turns * 360) ||
    (rotation.direction === 'shortest' && rotation.turns !== 0)
  )
    throw new Error(
      'Choose a rotation direction and a nonnegative whole number of safely representable extra turns. Shortest rotation requires zero extra turns.',
    );
}
