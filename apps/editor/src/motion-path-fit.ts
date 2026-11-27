import type { Point } from '../../../packages/document/src';
import { fitPolyline } from '../../../packages/geometry/src/curve-fit';
import {
  createMotionPathSampler,
  type MotionPath,
} from '../../../packages/animation/src/motion-path';

/** Fit the complete authored polyline without changing the caller's draft. */
export function fitMotionWaypoints(
  start: Point,
  end: Point,
  path: MotionPath,
  tolerance: number,
): MotionPath {
  if (!path.waypoints || path.curvedWaypoints)
    throw new Error('Choose a straight waypoint path to fit.');
  const points = [
    start,
    ...path.waypoints.map((p) => ({ x: start.x + p.x, y: start.y + p.y })),
    end,
  ];
  const { curves } = fitPolyline(points, tolerance);
  const first = curves[0],
    last = curves[curves.length - 1];
  const delta = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
  const result: MotionPath = {
    ...path,
    tangent: false,
    startX: first[1].x - start.x,
    startY: first[1].y - start.y,
    endX: last[2].x - end.x,
    endY: last[2].y - end.y,
    waypoints: undefined,
    curvedWaypoints: false,
    waypointTangents: undefined,
    waypointIncoming: undefined,
  };
  if (curves.length > 1) {
    result.waypoints = curves.slice(1).map((c) => delta(c[0], start));
    result.curvedWaypoints = true;
    result.waypointTangents = [...curves.map((c) => delta(c[1], c[0])), delta(last[3], last[2])];
    result.waypointIncoming = curves.slice(0, -1).map((c) => delta(c[2], c[3]));
  }
  // Preflight the retained distance mode before replacing settings.
  createMotionPathSampler(start, end, result);
  return result;
}
