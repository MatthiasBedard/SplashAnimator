import { evaluatedMotionProgress } from '../../document/src/motion-ease';
import type { Layer, LiveMotionSpan } from '../../document/src';
import type { GroupMotionPath } from '../../document/src/motion-group-paths';
import { validateGroupMotionPaths } from '../../document/src/motion-group-paths';
import { createMotionPathSampler } from './motion-path';
import { snapshotTrajectoryPath } from './trajectory-input';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { motionRotationDelta } from './motion-rotation';
import { prepareRestrictedIndependentGroupPath } from './restricted-independent-group-path';
export type IndependentGroupPathPlan = {
  ids: string[];
  dx: number;
  dy: number;
  route: ReturnType<typeof createMotionPathSampler>;
};
export function prepareIndependentGroupPath(
  layer: Layer,
  span: Pick<LiveMotionSpan, 'start' | 'end' | 'rotation' | 'path' | 'symbolContinuity'>,
  binding: GroupMotionPath,
): IndependentGroupPathPlan {
  validateGroupMotionPaths([binding]);
  if (span.path && binding.ease !== undefined && binding.path.waypoints)
    throw Error('Independent waypoint easing requires an absent shared route.');
  if (span.path && binding.ease !== undefined && binding.path.distance)
    throw Error('Independent distance easing requires an absent shared route.');
  if ((span.path?.curvedWaypoints || span.path?.tangent) && binding.ease !== undefined)
    throw Error('Independent group easing requires a shared cubic or straight waypoints without tangent heading.');
  if (
    span.rotation?.rigidGroups !== true ||
    span.rotation.savedGroupPivots ||
    span.rotation.rigidPivot !== undefined ||
    (span.rotation.groupDepth ?? 0) !== 0 ||
    span.path?.tangent
  )
    throw Error(
      'Independent group translation requires an original outer-group recipe without tangent or custom-pivot orbit.',
    );
  const first = layer.keys.find((k) => k.frame === span.start)!.shapes;
  const last = layer.keys.find((k) => k.frame === span.end)!.shapes;
  const indices = first.flatMap((s, i) => (s.groups?.[0] === binding.groupId ? [i] : []));
  if (indices.length < 2) throw Error('Choose one complete original outer group.');
  const a = first[indices[0]],
    b = last[indices[0]],
    dx = b.x - a.x,
    dy = b.y - a.y;
  for (const i of indices) {
    const from = first[i],
      to = last[i];
    if (
      to.kind !== from.kind ||
      (from.kind === 'symbol' && (span.symbolContinuity !== 'graphics' || from.symbolId !== to.symbolId)) ||
      to.id !== from.id ||
      selectionTrajectoryStamp(from.groups) !== selectionTrajectoryStamp(to.groups) ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      to.x - from.x !== dx ||
      to.y - from.y !== dy ||
      motionRotationDelta(from.rotation, to.rotation, span.rotation) !== 0 ||
      selectionTrajectoryStamp(from.transform) !== selectionTrajectoryStamp(to.transform)
    )
      throw Error(
        'Independent group translation requires fixed bases, equal member displacement and matching identities without orbit rotation.',
      );
  }
  const path = snapshotTrajectoryPath(binding.path, 'group');
  if (binding.restrictedArc) {
    const { restrictedArc, ...ordinary } = binding;
    return prepareRestrictedIndependentGroupPath({
      layer,
      span,
      binding: ordinary,
      geometry: {
        ...restrictedArc,
        cubic: [
          { x: 0, y: 0 },
          { x: path.startX, y: path.startY },
          { x: dx + path.endX, y: dy + path.endY },
          { x: dx, y: dy },
        ],
      },
    });
  }
  // Relative coordinates avoid subtracting two large document origins to find
  // a small route deviation. Existing path finite/overflow/work guards apply.
  const origin = {x:0,y:0}, offset = binding.spanClockOffset;
  const route = createMotionPathSampler(origin, { x: dx-(offset?.x ?? 0), y: dy-(offset?.y ?? 0) }, path);
  const correction = offset && createMotionPathSampler(origin, offset, offset);
  const ease = binding.ease;
  return { ids: indices.map((i) => first[i].id), dx, dy, route: ease ? t => {
    const point = route(evaluatedMotionProgress(t, ease));
    if (!correction) return point;
    const delta = correction(t);
    return {x:point.x+delta.x,y:point.y+delta.y};
  } : route };
}
