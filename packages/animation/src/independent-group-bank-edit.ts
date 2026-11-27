import { validateMotionEase, type MotionEase } from '../../document/src/motion-ease';
import { validateProject, type Project } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import {
  validateGroupMotionPaths,
  type GroupMotionPath,
} from '../../document/src/motion-group-paths';
import type { MotionPath } from '../../document/src/motion-path';
import { prepareIndependentGroupPath } from './independent-group-path';
import { selectionTrajectoryStamp } from './selection-trajectory';
export interface IndependentCubicPoints {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}
/** Pure original-snapshot header preparation. The enclosing editor must freshly
 * admit source/input/history and the complete all-track candidate before writing. */
export function independentGroupBankChange(
  project: Project,
  layerId: string,
  spanId: string,
  groupId: string,
  action: 'set' | 'remove' | 'timing',
  points?: IndependentCubicPoints,
  ease?: MotionEase,
): readonly GroupMotionPath[] | undefined {
  validateLiveGraphicData(project);
  validateLiveGraphicData(ease);
  validateLiveGraphicData(points);
  validateProject(project);
  if (
    ![layerId, spanId, groupId].every((id) => typeof id === 'string' && !!id) ||
    !['set', 'remove', 'timing'].includes(action)
  )
    throw Error('Choose an original group bank and explicit action.');
  if (action === 'set') {
    if (
      !points ||
      Reflect.ownKeys(points).some(
        (k) => !['startX', 'startY', 'endX', 'endY'].includes(k as string),
      ) ||
      !['startX', 'startY', 'endX', 'endY'].every(
        (k) =>
          Object.hasOwn(points, k) && Number.isFinite(points[k as keyof IndependentCubicPoints]),
      )
    )
      throw Error('Choose four finite original document control coordinates.');
  }
  if (ease !== undefined) validateMotionEase(ease);
  const timingStamp = selectionTrajectoryStamp(ease);
  const pointStamp = selectionTrajectoryStamp(points),
    captured = points
      ? { startX: points.startX, startY: points.startY, endX: points.endX, endY: points.endY }
      : undefined;
  const stamp = selectionTrajectoryStamp(project),
    layer = project.layers.find((l) => l.id === layerId),
    span = layer?.liveMotionSpans?.find((s) => s.id === spanId);
  if (!layer?.visible || layer.locked || !span || span.rotation?.rigidGroups !== true)
    throw Error('Choose an original visible unlocked outer-group recipe.');
  const original = span.groupPaths ?? [],
    bank = structuredClone(original) as GroupMotionPath[];
  validateGroupMotionPaths(bank);
  if (
    selectionTrajectoryStamp(bank) !== selectionTrajectoryStamp(original) ||
    selectionTrajectoryStamp(project) !== stamp
  )
    throw Error('Independent bank source or clone changed.');
  validateLiveGraphicData(ease);
  validateLiveGraphicData(points);
  if (selectionTrajectoryStamp(points) !== pointStamp)
    throw Error('Independent group control coordinates changed.');
  const index = bank.findIndex((row) => row.groupId === groupId);
  if (action === 'remove') {
    if (index < 0) throw Error('Choose an existing independent group route to remove.');
    bank.splice(index, 1);
  } else if (action === 'timing') {
    const row = bank[index];
    if (!row?.path.waypoints || row.path.distance || span.path || ease === undefined || points !== undefined)
      throw Error('Choose an existing equal-time group waypoint route without a shared path.');
    if (selectionTrajectoryStamp(row.ease ?? 'linear') === timingStamp)
      throw Error('Independent group route timing is unchanged.');
    if (ease === 'linear') delete row.ease;
    else row.ease = structuredClone(ease);
    prepareIndependentGroupPath(layer, span, row);
  } else {
    const first = layer.keys.find((k) => k.frame === span.start)!.shapes,
      last = layer.keys.find((k) => k.frame === span.end)!.shapes,
      i = first.findIndex((s) => s.groups?.[0] === groupId);
    if (i < 0) throw Error('Choose an existing original outer group.');
    const old = bank[index],
      path: Partial<MotionPath> =
        old?.path.waypoints === undefined
          ? { ...old?.path }
          : { ...(old.path.distance !== undefined ? { distance: old.path.distance } : {}) };
    for (const field of ['startX', 'startY', 'endX', 'endY'] as const) {
      const origin = field.startsWith('start') ? first[i] : last[i],
        axis = field.endsWith('X') ? 'x' : 'y',
        previous = old?.path[field];
      path[field] =
        previous !== undefined && captured![field] === origin[axis] + previous
          ? previous
          : captured![field] - origin[axis];
    }
    const timing = ease ?? old?.ease;
    const row: GroupMotionPath = {
      ...(timing && (timing !== 'linear' || old?.spanClockOffset) ? {ease:structuredClone(timing)} : {}),
      ...(old?.spanClockOffset ? {spanClockOffset:old.spanClockOffset} : {}),
      groupId,
      composition: 'additive',
      path: path as GroupMotionPath['path'],
    };
    if(old?.restrictedArc && ['startX','startY','endX','endY'].every(field=>
      path[field as keyof IndependentCubicPoints]===old.path[field as keyof IndependentCubicPoints])) {
      if (selectionTrajectoryStamp(old.ease) === selectionTrajectoryStamp(row.ease))
        throw Error('Independent group route is unchanged.');
      row.restrictedArc = old.restrictedArc;
    }
    prepareIndependentGroupPath(layer, span, row);
    if (index < 0) bank.push(row);
    else bank[index] = row;
    if (selectionTrajectoryStamp(bank) === selectionTrajectoryStamp(original))
      throw Error('Independent group route is unchanged.');
  }
  validateGroupMotionPaths(bank);
  validateLiveGraphicData(ease);
  validateLiveGraphicData(points);
  if (
    selectionTrajectoryStamp(ease) !== timingStamp ||
    selectionTrajectoryStamp(points) !== pointStamp ||
    selectionTrajectoryStamp(project) !== stamp
  )
    throw Error('Independent group bank source changed.');
  return bank.length ? bank : undefined;
}
