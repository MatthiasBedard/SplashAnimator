import { validateMotionPath, type MotionPath } from './motion-path';
import { validateRestrictedMotionArc, type RestrictedMotionArc } from './motion-restricted-arc';
import { validateMotionEase, type MotionEase } from './motion-ease';
/** One independent translation route per complete original outer group. */
export interface GroupMotionPath {
  groupId: string;
  composition: 'additive';
  path: MotionPath;
  ease?: MotionEase;
  /** Split correction sampled on the span clock; controls are endpoint-relative. */
  spanClockOffset?: Pick<MotionPath,'startX'|'startY'|'endX'|'endY'> & {x:number;y:number};
  restrictedArc?: RestrictedMotionArc;
}
const pathFields = [
  'startX',
  'startY',
  'endX',
  'endY',
  'waypoints',
  'curvedWaypoints',
  'waypointTangents',
  'waypointIncoming',
  'distance',
  'tangent',
  'headingOffset',
  'headingOffsetEnd',
];
/** Preflight original descriptors before clone/JSON or optional-field reads. */
export function validateGroupMotionPaths(
  value: unknown,
): asserts value is readonly GroupMotionPath[] {
  const plain = (v: unknown): v is Record<string, unknown> =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const record = (v: unknown, fields: readonly string[], required: readonly string[]) => {
    if (
      !plain(v) ||
      Reflect.ownKeys(v).some((k) => typeof k !== 'string' || !fields.includes(k)) ||
      required.some((k) => !Object.hasOwn(v, k)) ||
      fields.some((k) => !Object.hasOwn(v, k) && k in v)
    )
      throw Error('Independent group paths require original supported own fields.');
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v)))
      if (!d.enumerable || !('value' in d))
        throw Error('Independent group paths require enumerable original data.');
    return v;
  };
  const array = (v: unknown): unknown[] => {
    if (
      !Array.isArray(v) ||
      Object.getPrototypeOf(v) !== Array.prototype ||
      Reflect.ownKeys(v).some(
        (k) =>
          k !== 'length' &&
          (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length),
      )
    )
      throw Error('Independent group paths require dense original arrays.');
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (!d?.enumerable || !('value' in d))
        throw Error('Independent group paths require dense original data.');
    }
    return v;
  };
  const seen = new Set<string>();
  for (const raw of array(value)) {
    const row = record(
      raw,
      ['groupId', 'composition', 'path', 'restrictedArc', 'ease', 'spanClockOffset'],
      ['groupId', 'composition', 'path'],
    );
    if (
      typeof row.groupId !== 'string' ||
      !row.groupId ||
      seen.has(row.groupId) ||
      row.composition !== 'additive'
    )
      throw Error('Choose one explicit additive path per original group.');
    seen.add(row.groupId);
    const path = record(row.path, pathFields, ['startX', 'startY', 'endX', 'endY']);
    for (const field of ['waypoints', 'waypointTangents', 'waypointIncoming'])
      if (path[field] !== undefined)
        for (const point of array(path[field])) {
          const p = record(point, ['x', 'y'], ['x', 'y']);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
            throw Error('Group route points must be finite.');
        }
    validateMotionPath(path as unknown as MotionPath);
    if (Object.hasOwn(row, 'restrictedArc')) {
      validateRestrictedMotionArc(row.restrictedArc);
      if (path.distance !== true || path.waypoints !== undefined || path.tangent)
        throw Error('Restricted arc timing requires one independent distance cubic.');
    }
    if (Object.hasOwn(row, 'ease')) {
      if (typeof row.ease === 'object')
        record(row.ease, ['kind','x1','y1','x2','y2'], ['kind','x1','y1','x2','y2']);
      validateMotionEase(row.ease as MotionEase);
      if (path.waypoints && path.distance)
        throw Error('Independent waypoint easing requires equal segment timing.');
    }
    if (Object.hasOwn(row, 'spanClockOffset')) {
      const fields = ['x','y','startX','startY','endX','endY'];
      const offset = record(row.spanClockOffset, fields, fields);
      if (!row.ease || path.distance || path.waypoints || !fields.every(field => Number.isFinite(offset[field])))
        throw Error('A split group offset requires finite cubic controls and group timing.');
    }
    if (path.tangent)
      throw Error('Independent tangent group paths require separate orbit admission.');
  }
}
