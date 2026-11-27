import { evaluatedMotionProgress } from '../../document/src/motion-ease';
import type { Layer, LiveMotionSpan } from '../../document/src';
import type { GroupMotionPath } from '../../document/src/motion-group-paths';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { prepareIndependentGroupPath, type IndependentGroupPathPlan } from './independent-group-path';
import { createMotionPathSampler } from './motion-path';
import { sameMotionArtwork } from './motion-ownership';
import { bindRestrictedArcGeometry, type RestrictedArcGeometry } from './restricted-arc-geometry';
import { selectionTrajectoryStamp } from './selection-trajectory';

/** Explicit detached compiler only. No schema field, sampler default or Project
 * recipe is admitted by passing this separate geometry argument. */
export function prepareRestrictedIndependentGroupPath(input: {
  layer: Layer;
  span: Pick<LiveMotionSpan, 'start' | 'end' | 'rotation' | 'path'>;
  binding: GroupMotionPath;
  geometry: RestrictedArcGeometry;
}): IndependentGroupPathPlan {
  validateLiveGraphicData(input);
  const fields = ['layer', 'span', 'binding', 'geometry'];
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(input, key))
  )
    throw Error('Restricted group route requires original explicit input fields.');
  const stamp = selectionTrajectoryStamp(input),
    data = structuredClone(input);
  if (data === input) throw Error('Restricted group route requires a detached snapshot.');
  const current = () => {
    validateLiveGraphicData(input);
    validateLiveGraphicData(data);
    if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
      throw Error('Restricted group route source changed during preparation.');
  };
  current();
  const { layer, span, binding, geometry } = data;
  if (
    span.path !== undefined ||
    binding.path.distance !== true ||
    binding.path.waypoints !== undefined ||
    binding.path.tangent
  )
    throw Error(
      'Restricted timing requires one independent distance cubic without a shared route.',
    );
  // Reuse complete-group/basis admission without generating an unused distance
  // table from the half geometry. The explicit original window owns timing.
  const plan = prepareIndependentGroupPath(layer, span, {
    ...binding,
    path: { ...binding.path, distance: false },
  });
  const actual = [
    { x: 0, y: 0 },
    { x: binding.path.startX, y: binding.path.startY },
    { x: plan.dx + binding.path.endX, y: plan.dy + binding.path.endY },
    { x: plan.dx, y: plan.dy },
  ];
  if (!sameMotionArtwork(actual, geometry.cubic))
    throw Error('Restricted group controls or actual member endpoints differ from bound geometry.');
  const bound = bindRestrictedArcGeometry(geometry);
  // Reuse the legacy polynomial evaluator on actual saved controls. Only the
  // parameter map comes from the original cubic/window; never rebuild timing
  // from a half curve. Exact endpoint behavior stays with the legacy evaluator.
  const sample = createMotionPathSampler(
    { x: 0, y: 0 },
    { x: plan.dx, y: plan.dy },
    { ...binding.path, distance: false },
  );
  current();
  return {
    ids: [...plan.ids],
    dx: plan.dx,
    dy: plan.dy,
    route: (progress: number) => sample(bound.parameter(binding.ease ? evaluatedMotionProgress(progress, binding.ease) : progress)),
  };
}
