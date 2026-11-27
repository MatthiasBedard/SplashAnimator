import type { Layer } from '../../document/src';
import { isImmutableSnapshot } from '../../document/src/immutable-snapshot';
import type { MotionPath } from '../../document/src/motion-path';
import { motionRotationDelta } from './motion-rotation';
import { snapshotTrajectoryPath } from './trajectory-input';
import type { SampledSelectionOwner } from './selection-motion-owner';

/** A stored path moves the entire recipe, not an individual selected unit.
 * Only privately captured original tracks/membership may enter this admission.
 * Controls retain the first original artwork origin, never a union-box origin. */
export function admitSelectionTrajectory(
  layer: Layer,
  owner: SampledSelectionOwner['tracks'][number],
  path?: MotionPath,
) {
  const span = layer.motionSpans?.find((span) => span.id === owner.spanId);
  if (!span || span.start !== owner.start || span.end !== owner.end)
    throw Error('Choose the complete original selection recipe.');
  if (span.path?.tangent || span.rotation?.savedGroupPivots || span.rotation?.rigidPivot)
    throw Error('Selection tangent or custom-pivot trajectories require separate orbit admission.');
  const first = layer.keys.find((key) => key.frame === owner.start)!.shapes;
  const last = layer.keys.find((key) => key.frame === owner.end)!.shapes;
  const membership = (shapes: typeof first) =>
    JSON.stringify(shapes.map((shape) => ({ id: shape.id, groups: shape.groups })));
  const expected = membership(first);
  for (const key of layer.keys.filter(
    (key) => key.frame >= owner.start && key.frame <= owner.end,
  )) {
    if (
      key.shapes.length !== owner.shapeIds.length ||
      key.shapes.some((shape, index) => shape.id !== owner.shapeIds[index]) ||
      membership(key.shapes) !== expected
    )
      throw Error(
        'Shared trajectory requires complete original artwork order and ancestry at every key.',
      );
  }
  const dx = last[0].x - first[0].x,
    dy = last[0].y - first[0].y;
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    first.some(
      (shape, index) =>
        last[index].x - shape.x !== dx ||
        last[index].y - shape.y !== dy ||
        motionRotationDelta(
          shape.rotation,
          last[index].rotation,
          span.rotation ?? { direction: 'shortest', turns: 0 },
        ) !== 0,
    )
  )
    throw Error(
      'Selection translation trajectories require equal endpoint displacement and no orbit rotation.',
    );
  if (
    path &&
    span.path &&
    JSON.stringify(snapshotTrajectoryPath(span.path, 'selection')) === JSON.stringify(path)
  )
    throw Error('Selection trajectory does not change the original recipe.');
}

/** Complete detached data ownership, including saved own-undefined metadata.
 * JSON alone cannot distinguish deleting such a field from preserving it. */
const immutableStamps = new WeakMap<object, string>();
export function selectionTrajectoryStamp(value: unknown): string {
  if (isImmutableSnapshot(value)) {
    const cached = immutableStamps.get(value);
    if (cached !== undefined) return cached;
  }
  const data = (item: unknown): unknown => {
    if (item === null) return ['null'];
    if (typeof item === 'number' && !Number.isFinite(item))
      throw Error('Selection trajectories contain nonfinite original values.');
    if (item && typeof item === 'object') {
      const fields = Object.getOwnPropertyDescriptors(item);
      return [
        Array.isArray(item) ? ['array', item.length] : ['object'],
        Object.keys(item).map((key) => {
          const field = fields[key];
          // A final callback must not install a getter whose execution changes
          // source ownership after the final source read has already passed.
          if (!field || !Object.hasOwn(field, 'value'))
            throw Error('Selection trajectory ownership requires data fields.');
          return [key, data(field.value)];
        }),
      ];
    }
    if (!['undefined', 'string', 'number', 'boolean'].includes(typeof item))
      throw Error('Selection trajectories require serializable original data.');
    return [typeof item, item];
  };
  const stamp = JSON.stringify(data(value));
  if (isImmutableSnapshot(value)) immutableStamps.set(value, stamp);
  return stamp;
}
