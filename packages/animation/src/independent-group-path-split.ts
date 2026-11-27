import { evaluatedMotionProgress } from '../../document/src/motion-ease';
import { splitSimpleMotionEase } from './motion-spans';
import type { Layer, LiveMotionSpan, Vector } from '../../document/src';
import {
  validateGroupMotionPaths,
  type GroupMotionPath,
} from '../../document/src/motion-group-paths';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
import { prepareIndependentGroupPath } from './independent-group-path';
import { splitCubicMotionPath, motionPathPosition, splitPreservedMotionPath } from './motion-path';
import { prepareIndependentDistanceRestriction } from './independent-distance-restriction';
import { prepareIndependentPiecewiseRestriction } from './independent-piecewise-restriction';

/** Restrict additive parametric cubics, not their controls independently. The
 * promoted endpoint includes both routes, so each independent half compensates
 * the shared half's new endpoint basis before subtracting its linear travel. */
export function splitIndependentGroupPaths(
  layer: Layer,
  span: LiveMotionSpan,
  middle: Vector[],
  progress: number,
  shared: readonly (MotionPath | undefined)[],
): [readonly GroupMotionPath[] | undefined, readonly GroupMotionPath[] | undefined] {
  const bank = span.groupPaths;
  if (bank === undefined) return [undefined, undefined];
  validateGroupMotionPaths(bank);
  if(bank.some(row=>row.restrictedArc))
    throw Error('Persisted restricted arc subdivision requires complete candidate admission.');
  const halves: [GroupMotionPath[], GroupMotionPath[]] = [[], []];
  const corner = span.path?.waypoints;
  const cornerSplit = corner?.length === 1 && !span.path?.curvedWaypoints && progress === 0.5;
  if (
    bank.length &&
    (span.path?.distance ||
      span.path?.tangent ||
      (span.path?.curvedWaypoints && (!span.path.waypointTangents || !span.path.waypointIncoming)))
  )
    throw Error(
      'Independent group restriction requires parametric cubic or explicit equal-time shared routes.',
    );
  const first = layer.keys.find((k) => k.frame === span.start)!.shapes;
  const last = layer.keys.find((k) => k.frame === span.end)!.shapes;
  for (const binding of bank) {
    if (!span.path && binding.path.waypoints && !binding.path.distance) {
      const {dx,dy} = prepareIndependentGroupPath(layer, span, binding);
      const cut = binding.ease ? evaluatedMotionProgress(progress, binding.ease) : progress;
      const paths = splitPreservedMotionPath({x:0,y:0},{x:dx,y:dy},binding.path,cut);
      const eases = binding.ease && splitSimpleMotionEase(binding.ease,progress);
      for (const side of [0,1] as const) {
        halves[side].push({...binding,path:paths[side],...(eases ? {ease:eases[side]} : {})});
      }
      continue;
    }
    const distance =
      binding.path.distance === true &&
      span.path === undefined &&
      binding.path.waypoints === undefined;
    const piecewise =
      corner !== undefined && (!cornerSplit || binding.path.waypoints !== undefined);
    // Generated piecewise halves keep matching explicit bank partitions.
    // An unrelated authored shared curve with a single cubic bank remains a
    // separate qualification; do not broaden it via the algebra prerequisite.
    if (span.path?.curvedWaypoints && binding.path.waypoints === undefined)
      throw Error(
        'Independent curved shared restriction requires matching explicit bank partitions.',
      );
    if (
      (binding.path.distance && !distance) ||
      binding.path.tangent ||
      (binding.path.waypoints !== undefined && (!piecewise || !binding.path.curvedWaypoints))
    )
      throw Error(
        'Independent group restriction requires parametric cubic or matching explicit bank routes.',
      );
    const plan = prepareIndependentGroupPath(layer, span, binding),
      index = first.findIndex((s) => s.id === plan.ids[0]);
    const a = first[index],
      b = last[index],
      m = middle[index],
      { dx, dy } = plan;
    if (distance && binding.ease)
      throw Error('Choose Keep original group distance timing to preserve the eased distance route.');
    if (binding.ease) {
      const offset = binding.spanClockOffset;
      const origin = {x:0,y:0}, drift = {x:offset?.x ?? 0, y:offset?.y ?? 0};
      const paths = splitCubicMotionPath(origin, {x:dx-drift.x,y:dy-drift.y}, binding.path,
        evaluatedMotionProgress(progress, binding.ease));
      const eases = splitSimpleMotionEase(binding.ease, progress);
      // The uneased component is the shared cubic minus linear leader travel,
      // plus any retained correction. Restrict it separately from the eased path.
      const sharedDeviation = (path:MotionPath | undefined, x:number, y:number) => ({
        startX:path ? path.startX-x/3 : 0, startY:path ? path.startY-y/3 : 0,
        endX:path ? path.endX+x/3 : 0, endY:path ? path.endY+y/3 : 0,
      });
      if (corner && !cornerSplit)
        throw Error('An eased group can split a shared waypoint path at its single equal-time corner.');
      const base = sharedDeviation(cornerSplit ? undefined : span.path,dx,dy);
      const untimed = {startX:base.startX+(offset?.startX ?? 0),startY:base.startY+(offset?.startY ?? 0),
        endX:base.endX+(offset?.endX ?? 0),endY:base.endY+(offset?.endY ?? 0)};
      const mid = motionPathPosition(origin,drift,progress,untimed);
      const parts = splitCubicMotionPath(origin,drift,untimed,progress);
      for (const side of [0,1] as const) {
        const child = sharedDeviation(shared[side],side ? b.x-m.x : m.x-a.x,side ? b.y-m.y : m.y-a.y);
        const part = parts[side];
        // At the corner, shared travel minus linear endpoint travel is a
        // straight displacement on each half, with opposite signs.
        const sign = side ? -1 : 1;
        const cornerX = cornerSplit ? sign*(corner![0].x-dx/2) : 0;
        const cornerY = cornerSplit ? sign*(corner![0].y-dy/2) : 0;
        const remainder = {x:(side ? drift.x-mid.x : mid.x)+cornerX, y:(side ? drift.y-mid.y : mid.y)+cornerY,
          startX:part.startX+cornerX/3-child.startX, startY:part.startY+cornerY/3-child.startY,
          endX:part.endX-cornerX/3-child.endX, endY:part.endY-cornerY/3-child.endY};
        halves[side].push({groupId:binding.groupId,composition:binding.composition,
          path:{...binding.path,...paths[side]},ease:eases[side],
          ...(Object.values(remainder).some(n=>n!==0) ? {spanClockOffset:remainder} : {})});
      }
      continue;
    }
    if (distance) {
      if (shared.some((path) => path !== undefined))
        throw Error('Independent distance restriction requires absent original shared halves.');
      // Bank evaluation already owns a relative arc map. With no shared route,
      // the shared linear pose and the bank's subtracted linear pose cancel.
      const paths = prepareIndependentDistanceRestriction({
        delta: { x: dx, y: dy },
        middle: { x: m.x - a.x, y: m.y - a.y },
        path: binding.path,
        progress,
      });
      for (let side = 0; side < 2; side++) {
        const path = { ...structuredClone(binding.path), ...paths[side] };
        validateMotionPath(path);
        halves[side].push({ groupId: binding.groupId, composition: binding.composition, path });
      }
      continue;
    }
    if (piecewise) {
      if (!shared[0] || !shared[1]) throw Error('Original shared restriction halves are missing.');
      const paths = prepareIndependentPiecewiseRestriction({
        delta: { x: dx, y: dy },
        middle: { x: m.x - a.x, y: m.y - a.y },
        bank: binding.path,
        shared: span.path!,
        sharedHalves: [shared[0], shared[1]],
        progress,
      });
      for (let side = 0; side < 2; side++)
        halves[side].push({
          groupId: binding.groupId,
          composition: binding.composition,
          path: paths[side],
        });
      continue;
    }
    const total: MotionPath = {
      startX: span.path ? span.path.startX + binding.path.startX - dx / 3 : binding.path.startX,
      startY: span.path ? span.path.startY + binding.path.startY - dy / 3 : binding.path.startY,
      endX: span.path ? span.path.endX + binding.path.endX + dx / 3 : binding.path.endX,
      endY: span.path ? span.path.endY + binding.path.endY + dy / 3 : binding.path.endY,
    };
    let restricted: [MotionPath, MotionPath];
    if (cornerSplit) {
      // Restrict the independent cubic first. On each side the original shared
      // path is linear, so add that segment and subtract the original linear
      // leader travel in control space. These are total group routes; the usual
      // shared-half/new-endpoint compensation below derives the bank controls.
      restricted = splitCubicMotionPath({ x: 0, y: 0 }, { x: dx, y: dy }, binding.path, progress);
      const waypoint = corner![0];
      for (let side = 0; side < 2; side++) {
        const x = (side ? dx - waypoint.x : waypoint.x) - dx * 0.5;
        const y = (side ? dy - waypoint.y : waypoint.y) - dy * 0.5;
        const part = restricted[side];
        restricted[side] = {
          ...part,
          startX: part.startX + x / 3,
          startY: part.startY + y / 3,
          endX: part.endX - x / 3,
          endY: part.endY - y / 3,
        };
        validateMotionPath(restricted[side]);
        const base = shared[side];
        if (!base || base.waypoints !== undefined || base.distance || base.tangent)
          throw Error(
            'Independent corner restriction requires original single-cubic shared halves.',
          );
      }
    } else restricted = splitCubicMotionPath({ x: 0, y: 0 }, { x: dx, y: dy }, total, progress);
    for (let side = 0; side < 2; side++) {
      const from = side ? m : a,
        to = side ? b : m,
        part = restricted[side],
        base = shared[side];
      const x = to.x - from.x,
        y = to.y - from.y;
      const path: MotionPath = {
        ...structuredClone(binding.path),
        startX: base ? part.startX - base.startX + x / 3 : part.startX,
        startY: base ? part.startY - base.startY + y / 3 : part.startY,
        endX: base ? part.endX - base.endX - x / 3 : part.endX,
        endY: base ? part.endY - base.endY - y / 3 : part.endY,
      };
      validateMotionPath(path);
      halves[side].push({ groupId: binding.groupId, composition: binding.composition, path });
    }
  }
  halves.forEach(validateGroupMotionPaths);
  return halves;
}
