import type { Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
import { selectionTrajectoryStamp } from './selection-trajectory';
import { curvedWaypointSegments, splitPreservedMotionPath } from './motion-path';
import { snapshotTrajectoryPath } from './trajectory-input';

type Cubic = [Point, Point, Point, Point];
type Pair = [MotionPath, MotionPath];
export type IndependentPiecewiseRestriction = {
  delta: Point;
  middle: Point;
  bank: MotionPath;
  shared: MotionPath;
  sharedHalves: Pair;
  progress: number;
};
const zero = (): Point => ({ x: 0, y: 0 });
function point(x: number, y: number): Point {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw Error('Independent piecewise controls exceed finite numeric limits.');
  return { x, y };
}
const mix = (a: Point, b: Point, t: number) =>
  point(a.x * (1 - t) + b.x * t, a.y * (1 - t) + b.y * t);
function cut([a, b, c, d]: Cubic, t: number): [Cubic, Cubic] {
  const ab = mix(a, b, t),
    bc = mix(b, c, t),
    cd = mix(c, d, t);
  const abc = mix(ab, bc, t),
    bcd = mix(bc, cd, t),
    middle = mix(abc, bcd, t);
  return [
    [a, ab, abc, middle],
    [middle, bcd, cd, d],
  ];
}
function parametric(path: MotionPath) {
  validateMotionPath(path);
  snapshotTrajectoryPath(path, 'group');
  if (path.distance || path.tangent)
    throw Error(
      'Independent piecewise preparation requires parametric routes without tangent rotation.',
    );
  if (path.curvedWaypoints && (!path.waypointTangents || !path.waypointIncoming))
    throw Error('Independent piecewise curves require explicit outgoing and incoming controls.');
}
function parts(delta: Point, path: MotionPath): Cubic[] {
  parametric(path);
  if (!path.waypoints)
    return [
      [
        zero(),
        point(path.startX, path.startY),
        point(delta.x + path.endX, delta.y + path.endY),
        point(delta.x, delta.y),
      ],
    ];
  if (path.curvedWaypoints)
    return curvedWaypointSegments(
      zero(),
      delta,
      path.waypoints,
      path.waypointTangents,
      path.waypointIncoming,
    );
  const vertices = [zero(), ...path.waypoints, delta];
  return vertices.slice(1).map((end, i) => {
    const start = vertices[i],
      dx = end.x - start.x,
      dy = end.y - start.y;
    if (
      ![dx, dy].every(Number.isFinite) ||
      (dx !== 0 && dx / 3 === 0) ||
      (dy !== 0 && dy / 3 === 0)
    )
      throw Error('Independent straight-piece controls are numerically unresolved.');
    return [
      point(start.x, start.y),
      point(start.x + dx / 3, start.y + dy / 3),
      point(end.x - dx / 3, end.y - dy / 3),
      point(end.x, end.y),
    ];
  });
}
function refineSingle(source: Cubic[], count: number): Cubic[] {
  if (source.length === count) return source;
  if (source.length !== 1)
    throw Error(
      'Independent piecewise routes require matching equal-time segments or one cubic bank.',
    );
  const result: Cubic[] = [];
  let remainder = source[0];
  for (let remaining = count; remaining > 1; remaining--) {
    const [part, rest] = cut(remainder, 1 / remaining);
    result.push(part);
    remainder = rest;
  }
  result.push(remainder);
  return result;
}
function recipe(source: Cubic[], template?: MotionPath): MotionPath {
  if (!source.length) throw Error('Independent piecewise preparation requires resolved segments.');
  const base = template ? { ...template } : { startX: 0, startY: 0, endX: 0, endY: 0 };
  delete base.waypoints;
  delete base.waypointTangents;
  delete base.waypointIncoming;
  if (base.curvedWaypoints) delete base.curvedWaypoints;
  const first = source[0][0],
    last = source[source.length - 1],
    end = last[3];
  let result: MotionPath;
  if (source.length === 1)
    result = {
      ...base,
      startX: source[0][1].x - first.x,
      startY: source[0][1].y - first.y,
      endX: last[2].x - end.x,
      endY: last[2].y - end.y,
    };
  else
    result = {
      ...base,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      curvedWaypoints: true,
      waypoints: source.slice(1).map((s) => point(s[0].x - first.x, s[0].y - first.y)),
      waypointTangents: [
        ...source.map((s) => point(s[1].x - s[0].x, s[1].y - s[0].y)),
        point(end.x - last[2].x, end.y - last[2].y),
      ],
      waypointIncoming: source.slice(0, -1).map((s) => point(s[2].x - s[3].x, s[2].y - s[3].y)),
    };
  validateLiveGraphicData(result);
  validateMotionPath(result);
  return result;
}
/** Detached algebra prerequisite only. It does not broaden live split admission.
 * Total = shared + bank - original linear travel. Each restricted bank subtracts
 * its new shared half and adds its new linear travel, on matching equal-time
 * cubic segments. Existing shared subdivision owns timing/refinement work limits. */
export function prepareIndependentPiecewiseRestriction(
  input: IndependentPiecewiseRestriction,
): Pair {
  validateLiveGraphicData(input);
  const stamp = selectionTrajectoryStamp(input),
    data = structuredClone(input);
  const current = () => {
    validateLiveGraphicData(input);
    validateLiveGraphicData(data);
    if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
      throw Error('Independent piecewise original inputs or snapshot changed.');
  };
  current();
  const { delta, middle, bank, shared, sharedHalves, progress } = data;
  if (
    !Number.isFinite(progress) ||
    !(progress > 0 && progress < 1) ||
    !Array.isArray(sharedHalves) ||
    sharedHalves.length !== 2
  )
    throw Error('Choose an interior independent piecewise split and two original shared halves.');
  point(delta.x, delta.y);
  point(middle.x, middle.y);
  if (bank.waypoints !== undefined && !bank.curvedWaypoints)
    throw Error('Independent piecewise bank inputs require a cubic or explicit curved controls.');
  const sharedParts = parts(delta, shared),
    bankParts = refineSingle(parts(delta, bank), sharedParts.length);
  const total = sharedParts.map(
    (segment, i): Cubic =>
      segment.map((p, j) => {
        const t = (i + j / 3) / sharedParts.length,
          b = bankParts[i][j];
        return point(p.x + b.x - delta.x * t, p.y + b.y - delta.y * t);
      }) as Cubic,
  );
  const restricted = splitPreservedMotionPath(zero(), delta, recipe(total), progress);
  const result: Pair = [sharedHalves[0], sharedHalves[1]];
  for (let side = 0; side < 2; side++) {
    const travel = side ? point(delta.x - middle.x, delta.y - middle.y) : middle;
    const totalParts = parts(travel, restricted[side]),
      baseParts = parts(travel, sharedHalves[side]);
    if (totalParts.length !== baseParts.length)
      throw Error('Independent piecewise shared halves have incompatible timing partitions.');
    const derived = totalParts.map(
      (segment, i): Cubic =>
        segment.map((p, j) => {
          const t = (i + j / 3) / totalParts.length,
            base = baseParts[i][j];
          return point(p.x - base.x + travel.x * t, p.y - base.y + travel.y * t);
        }) as Cubic,
    );
    result[side] = recipe(derived, bank);
  }
  current();
  validateLiveGraphicData(result);
  return result;
}
