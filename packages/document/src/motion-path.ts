import type { Point } from './index';

/** Document-space offsets from the start and end origins, respectively. */
export type MotionPath = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Intermediate path vertices as offsets from the start origin. */
  waypoints?: readonly Point[];
  /** Uniform Catmull-Rom cubics through waypoints, with duplicated end vertices. */
  curvedWaypoints?: boolean;
  /** Outgoing control offsets at start, each waypoint, and end; incoming offsets default to negated. */
  waypointTangents?: readonly Point[];
  /** Independent incoming offsets for intermediate waypoints only. */
  waypointIncoming?: readonly Point[];
  distance?: boolean;
  tangent?: boolean;
  /** Lifted heading correction in degrees; tangent cubics and straight/curved waypoint paths, in their timing progress domain. */
  headingOffset?: number;
  /** Optional end correction, linearly interpolated in path progress. Requires headingOffset. */
  headingOffsetEnd?: number;
};
export function validateMotionPath(path: MotionPath): void {
  if ('restrictedArc' in path) throw Error('Restricted arc timing belongs only to an independent group binding.');
  if (![path.startX, path.startY, path.endX, path.endY].every(Number.isFinite))
    throw new Error('Motion path control offsets must be finite numbers.');
  if (path.distance !== undefined && typeof path.distance !== 'boolean')
    throw new Error('Choose a supported motion path distance mode.');
  if (path.tangent !== undefined && typeof path.tangent !== 'boolean')
    throw new Error('Choose a supported motion path tangent mode.');
  if (path.headingOffset !== undefined && (!Number.isFinite(path.headingOffset) || Math.abs(path.headingOffset)>360000 || !path.tangent))
    throw new Error('Tangent heading correction requires a finite bounded angle on a tangent path.');
  if (path.headingOffsetEnd !== undefined && (path.headingOffset === undefined || !Number.isFinite(path.headingOffsetEnd) || Math.abs(path.headingOffsetEnd)>360000))
    throw new Error('End heading correction requires a valid start correction and finite bounded angle.');
  if (path.curvedWaypoints !== undefined && typeof path.curvedWaypoints !== 'boolean')
    throw new Error('Choose a supported waypoint curve mode.');
  if (path.curvedWaypoints && !path.waypoints)
    throw new Error('Curved waypoint mode requires waypoints.');
  if (path.waypointTangents !== undefined) {
    if (
      !path.curvedWaypoints ||
      !path.waypoints ||
      !Array.isArray(path.waypointTangents) ||
      path.waypointTangents.length !== path.waypoints.length + 2 ||
      path.waypointTangents.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      throw new Error(
        'Custom curve handles require one finite offset per vertex on a curved waypoint path.',
      );
  }
  if (
    path.waypointIncoming !== undefined &&
    (!path.waypointTangents ||
      !path.waypoints ||
      !Array.isArray(path.waypointIncoming) ||
      path.waypointIncoming.length !== path.waypoints.length ||
      path.waypointIncoming.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  )
    throw new Error(
      'Independent incoming handles require one finite offset per waypoint and custom curve handles.',
    );
  if (path.waypoints !== undefined) {
    if (
      !Array.isArray(path.waypoints) ||
      !path.waypoints.length ||
      path.waypoints.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      throw new Error('Waypoint paths require finite intermediate offsets.');
  }
}
