import { MAX_VECTOR_POINTS, type Point, type Vector, type LiveMotionSpan } from '../../document/src';
import { mapPoint, matrix } from '../../geometry/src/affine';
import {
  createMotionPathSampler,
  type MotionPath,
} from './motion-path';

/** Copy an open stage guide; never rescale it or mutate authored artwork. */
export function motionPathFromGuide(
  start: Point,
  end: Point,
  guide: Vector,
  previous: MotionPath,
  follower?: { offset?: Point; tangent?: true },
): MotionPath {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite))
    throw new Error('Tween endpoints must be finite.');
  if (guide.closed || !['path', 'bezier'].includes(guide.kind))
    throw new Error('Choose an open path or Bezier guide.');
  const nodes = guide.kind === 'bezier' ? guide.nodes : guide.points;
  if (!nodes || nodes.length < 2 || nodes.length > MAX_VECTOR_POINTS)
    throw new Error('Guide requires two or more supported path nodes.');
  const m = matrix(guide);
  const world = (p: Point) => {
    const q = mapPoint(m, p);
    if (follower?.offset) {
      q.x += follower.offset.x;
      q.y += follower.offset.y;
    }
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
      throw new Error('Guide coordinates must be finite.');
    return q;
  };
  const vertices = nodes.map(world);
  if (
    Math.hypot(vertices[0].x - start.x, vertices[0].y - start.y) > 1e-6 ||
    Math.hypot(vertices.at(-1)!.x - end.x, vertices.at(-1)!.y - end.y) > 1e-6
  )
    throw new Error('Guide endpoints must match the active tween endpoint origins.');
  const delta = (p: Point, q: Point) => ({ x: p.x - q.x, y: p.y - q.y });
  const segments = vertices.slice(1).map((b, i) => {
    const a = vertices[i],
      left = guide.kind === 'bezier' ? guide.nodes![i].out : undefined,
      right = guide.kind === 'bezier' ? guide.nodes![i + 1].in : undefined;
    return [
      a,
      left
        ? world(left)
        : guide.kind === 'bezier'
          ? a
          : { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
      right
        ? world(right)
        : guide.kind === 'bezier'
          ? b
          : { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
      b,
    ];
  });
  const first = segments[0],
    last = segments.at(-1)!;
  const result: MotionPath = {
    ...previous,
    startX: first[1].x - start.x,
    startY: first[1].y - start.y,
    endX: last[2].x - end.x,
    endY: last[2].y - end.y,
    tangent: follower?.tangent === true,
    waypoints: undefined,
    curvedWaypoints: false,
    waypointTangents: undefined,
    waypointIncoming: undefined,
  };
  if (segments.length > 1) {
    result.waypoints = vertices.slice(1, -1).map((p) => delta(p, start));
    result.curvedWaypoints = guide.kind === 'bezier';
    if (result.curvedWaypoints) {
      result.waypointTangents = [
        ...segments.map((c) => delta(c[1], c[0])),
        delta(last[3], last[2]),
      ];
      result.waypointIncoming = segments.slice(0, -1).map((c) => delta(c[2], c[3]));
    }
  }
  createMotionPathSampler(start, end, result);
  return result;
}

/** Sample the original guide on a restricted progress interval. A promoted key
 * owns its exact pose. Guide edits between keys bend the route around those anchors. */
export function restrictedGuideRoute(guide: Vector, binding: NonNullable<LiveMotionSpan['guide']>,
  from: Point, to: Point) {
  const nodes = guide.kind === 'bezier' ? guide.nodes : guide.points;
  if (!nodes || nodes.length < 2 || !binding.interval) throw Error('Missing guide interval or artwork.');
  const basis = matrix(guide);
  const endpoint = (p: Point) => {
    const q = mapPoint(basis,p);
    return {x:q.x + (binding.offset?.x ?? 0), y:q.y + (binding.offset?.y ?? 0)};
  };
  const start = endpoint(nodes[0]), end = endpoint(nodes[nodes.length-1]);
  const range = {...binding.interval};
  if ((range.start === 0 && Math.hypot(start.x-from.x,start.y-from.y)>1e-6) ||
      (range.end === 1 && Math.hypot(end.x-to.x,end.y-to.y)>1e-6))
    throw Error('Guide endpoints must match the active tween endpoint origins.');
  const path = motionPathFromGuide(start,end,guide,{startX:0,startY:0,endX:0,endY:0},binding);
  const route = createMotionPathSampler(start,end,path);
  const a = route(range.start), b = route(range.end);
  // The promoted base rotations already contain these interior headings.
  const leftHeading = range.start === 0 ? 0 : a.tangentAngle ?? 0;
  const rightHeading = range.end === 1 ? 0 : b.tangentAngle ?? 0;
  return (t: number) => {
    const point = route(range.start + (range.end-range.start)*t);
    return {
      x: point.x + (from.x-a.x)*(1-t) + (to.x-b.x)*t,
      y: point.y + (from.y-a.y)*(1-t) + (to.y-b.y)*t,
      heading: (point.tangentAngle ?? 0) - leftHeading*(1-t) - rightHeading*t,
    };
  };
}
