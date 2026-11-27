import type { MotionRotation } from '../../../packages/document/src/motion-rotation';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
export type GroupFlagMode = 'enable' | 'disable' | 'remove';
export type LiveGroupHeaderPatch = {
  direction?: MotionRotation['direction'];
  turns?: number;
  uniformGroupScale?: GroupFlagMode;
  axisGroupScale?: GroupFlagMode;
  axisGroupShear?: GroupFlagMode;
};
/** Copy original group metadata only; dependency/geometry admission remains in
 * the shared detached updater. Unchosen own false/undefined fields stay exact. */
export function liveGroupHeaderChange(
  original: MotionRotation,
  patch: LiveGroupHeaderPatch,
): MotionRotation {
  validateLiveMotionData(original);
  validateLiveMotionData(patch);
  const plain = (v: unknown) =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const sourceFields = [
    'direction',
    'turns',
    'rigidGroups',
    'groupDepth',
    'uniformGroupScale',
    'axisGroupScale',
    'axisGroupShear',
    'savedGroupPivots',
    'rigidPivot',
  ];
  if (!plain(original) || !plain(patch)) throw Error('Choose original group header data.');
  const fields = Object.getOwnPropertyDescriptors(original),
    changes = Object.getOwnPropertyDescriptors(patch);
  if (
    !Object.hasOwn(fields, 'rigidGroups') ||
    fields.rigidGroups!.value !== true ||
    !Object.hasOwn(fields, 'direction') ||
    !Object.hasOwn(fields, 'turns') ||
    Reflect.ownKeys(fields).some((k) => !sourceFields.includes(k as string))
  )
    throw Error('Choose an original complete-group live header.');
  for (const field of Object.values(fields))
    if (!field.enumerable || (field.value !== null && typeof field.value === 'object'))
      throw Error('Choose supported original group header data fields.');
  if (
    !Object.keys(changes).length ||
    Reflect.ownKeys(changes).some(
      (k) =>
        !['direction', 'turns', 'uniformGroupScale', 'axisGroupScale', 'axisGroupShear'].includes(
          k as string,
        ),
    )
  )
    throw Error('Choose explicit supported group header changes.');
  const out = Object.create(Object.getPrototypeOf(original)) as MotionRotation;
  const write = (key: PropertyKey, value: unknown) =>
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  for (const [key, field] of Object.entries(fields)) write(key, field.value);
  for (const [key, field] of Object.entries(changes)) {
    if (!field.enumerable) throw Error('Choose original group header change data.');
    const value = field.value;
    if (key === 'direction') {
      if (!['shortest', 'clockwise', 'counterclockwise'].includes(value))
        throw Error('Choose a supported group rotation direction.');
      write(key, value);
    } else if (key === 'turns') {
      if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * 360))
        throw Error('Choose finite safe whole group turns.');
      write(key, value);
    } else {
      if (!['enable', 'disable', 'remove'].includes(value))
        throw Error('Choose an explicit group scaling mode.');
      if (value === 'remove') Reflect.deleteProperty(out, key);
      else write(key, value === 'enable');
    }
  }
  return out;
}
