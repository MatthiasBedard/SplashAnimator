import type { Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
import { captureCubicDistanceCorrespondence, splitCubicMotionPath } from './motion-path';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { snapshotTrajectoryPath } from './trajectory-input';
import { sameMotionArtwork } from './motion-ownership';

/** Original relative arc tables must restrict to the fresh stored half tables.
 * Compare both piecewise-affine maps on their complete union of breakpoints,
 * not just authored integer frames. The outer command still owns all geometry. */
export function prepareIndependentDistanceRestriction(input: {
  delta: Point;
  middle: Point;
  path: MotionPath;
  progress: number;
}): [MotionPath, MotionPath] {
  validateLiveGraphicData(input);
  const stamp = selectionTrajectoryStamp(input),
    data = structuredClone(input);
  const current = () => {
    validateLiveGraphicData(input);
    validateLiveGraphicData(data);
    if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
      throw Error('Independent distance restriction inputs changed.');
  };
  current();
  const { delta, middle, path, progress } = data;
  validateMotionPath(path);
  snapshotTrajectoryPath(path, 'group');
  if (
    path.distance !== true ||
    path.waypoints !== undefined ||
    path.tangent ||
    !Number.isFinite(progress) ||
    !(progress > 0 && progress < 1)
  )
    throw Error('Choose one original independent distance cubic and an interior split.');
  const capture = (travel: Point, p: MotionPath) =>
    captureCubicDistanceCorrespondence([
      [
        { x: 0, y: 0 },
        { x: p.startX, y: p.startY },
        { x: travel.x + p.endX, y: travel.y + p.endY },
        { x: travel.x, y: travel.y },
      ],
    ]);
  const original = capture(delta, path),
    parameter = original.parameter(progress);
  if (!(parameter > 0 && parameter < 1))
    throw Error('Independent distance cut parameter is unresolved.');
  const restricted = splitCubicMotionPath(
    { x: 0, y: 0 },
    delta,
    { ...path, distance: false },
    parameter,
  );
  const result = restricted.map((p) => ({ ...path, ...p, distance: true })) as [
    MotionPath,
    MotionPath,
  ];
  for (let side = 0; side < 2; side++) {
    const travel = side ? { x: delta.x - middle.x, y: delta.y - middle.y } : middle;
    const sample = capture(travel, result[side]),
      start = side ? progress : 0,
      range = side ? 1 - progress : progress;
    const from = side ? parameter : 0,
      length = side ? 1 - parameter : parameter;
    const admit = (t: number) => {
      const expected = (original.parameter(start + range * t) - from) / length;
      if (!sameMotionArtwork(sample.parameter(t), expected))
        throw Error('Independent distance half cannot retain the original arc correspondence.');
    };
    admit(0);
    admit(1);
    for (const knot of original.knots)
      if (knot.progress > start && knot.progress < start + range)
        admit((knot.progress - start) / range);
    for (const knot of sample.knots) admit(knot.progress);
  }
  current();
  validateLiveGraphicData(result);
  result.forEach(validateMotionPath);
  return result;
}
