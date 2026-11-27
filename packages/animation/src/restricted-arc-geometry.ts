import type { Point } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { sameMotionArtwork } from './motion-ownership';
import { selectionTrajectoryStamp } from './selection-trajectory';
import {
  openRestrictedArcCorrespondence,
  type RestrictedArcCorrespondence,
} from './restricted-arc-correspondence';

type Cubic = readonly [Point, Point, Point, Point];
/** Staging data only: no MotionPath/document field or sampling opt-in. */
export type RestrictedArcGeometry = {
  descriptor: RestrictedArcCorrespondence;
  origin: Point;
  cubic: Cubic;
};
function point(p: Point): void {
  if (
    !p ||
    Reflect.ownKeys(p).length !== 2 ||
    !Object.hasOwn(p, 'x') ||
    !Object.hasOwn(p, 'y') ||
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y)
  )
    throw Error('Restricted arc geometry requires finite original points.');
}
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x * (1 - t) + b.x * t,
  y: a.y * (1 - t) + b.y * t,
});
function blossom(c: Cubic, a: number, b: number, d: number): Point {
  const p = mix(c[0], c[1], a),
    q = mix(c[1], c[2], a),
    r = mix(c[2], c[3], a);
  const result = mix(mix(p, q, b), mix(q, r, b), d);
  point(result);
  return result;
}
function segment(c: Cubic, a: number, b: number): Cubic {
  return [blossom(c, a, a, a), blossom(c, a, a, b), blossom(c, a, b, b), blossom(c, b, b, b)];
}
function capture<T>(input: T) {
  validateLiveGraphicData(input);
  const stamp = selectionTrajectoryStamp(input),
    data = structuredClone(input);
  if (data === input) throw Error('Restricted arc geometry clone is not detached.');
  const current = () => {
    validateLiveGraphicData(input);
    validateLiveGraphicData(data);
    if (selectionTrajectoryStamp(input) !== stamp || selectionTrajectoryStamp(data) !== stamp)
      throw Error('Restricted arc geometry inputs changed.');
  };
  current();
  return { data, current };
}
/** Bind all actual relative controls and both authored origins to the original
 * cubic's restricted blossom. Public/proposed geometry alone cannot own a group. */
export function bindRestrictedArcGeometry(input: RestrictedArcGeometry) {
  const { data, current } = capture(input);
  if (
    !data ||
    Reflect.ownKeys(data).length !== 3 ||
    Reflect.ownKeys(data).some((k) => !['descriptor', 'origin', 'cubic'].includes(String(k))) ||
    !Array.isArray(data.cubic) ||
    data.cubic.length !== 4
  )
    throw Error('Choose original restricted arc geometry.');
  point(data.origin);
  data.cubic.forEach(point);
  if (data.cubic[0].x !== 0 || data.cubic[0].y !== 0)
    throw Error('Restricted arc controls require an exact zero relative origin.');
  const map = openRestrictedArcCorrespondence(data.descriptor);
  const expected = segment(map.descriptor.cubic, map.first, map.last);
  if (!sameMotionArtwork(data.origin, expected[0]))
    throw Error('Restricted arc authored origin differs from the original cubic.');
  const relative = expected.map((p) => ({ x: p.x - expected[0].x, y: p.y - expected[0].y }));
  relative.forEach(point);
  if (!sameMotionArtwork(data.cubic, relative))
    throw Error('Restricted arc controls or authored endpoint differ from the original cubic.');
  current();
  const privateOrigin = { ...data.origin };
  const privateCubic = data.cubic.map((p) => ({ x: p.x, y: p.y })) as unknown as Cubic;
  const geometry: RestrictedArcGeometry = {
    descriptor: structuredClone(map.descriptor),
    origin: { ...data.origin },
    cubic: data.cubic.map((p) => ({ x: p.x, y: p.y })) as unknown as Cubic,
  };
  const stamp = selectionTrajectoryStamp({
    descriptor: map.descriptor,
    origin: data.origin,
    cubic: data.cubic,
  });
  validateLiveGraphicData(geometry);
  current();
  if (selectionTrajectoryStamp(geometry) !== stamp)
    throw Error('Restricted arc bound geometry clone changed.');
  return {
    geometry,
    parameter: map.parameter,
    fraction: map.fraction,
    sample(progress: number): Point {
      const u = map.parameter(progress),
        p = blossom(privateCubic, u, u, u);
      const result = { x: privateOrigin.x + p.x, y: privateOrigin.y + p.y };
      point(result);
      return result;
    },
  };
}

/** Prepare two detached geometric halves, retaining the actual promoted middle.
 * The caller must independently own that middle and complete group membership. */
export function splitRestrictedArcGeometry(input: {
  geometry: RestrictedArcGeometry;
  progress: number;
  middle: Point;
}): [RestrictedArcGeometry, RestrictedArcGeometry] {
  const { data, current } = capture(input);
  if (
    !data ||
    Reflect.ownKeys(data).length !== 3 ||
    Reflect.ownKeys(data).some((k) => !['geometry', 'progress', 'middle'].includes(String(k))) ||
    !Number.isFinite(data.progress) ||
    !(data.progress > 0 && data.progress < 1)
  )
    throw Error('Choose an original interior restricted arc split.');
  point(data.middle);
  const bound = bindRestrictedArcGeometry(data.geometry),
    map = openRestrictedArcCorrespondence(bound.geometry.descriptor);
  if (!sameMotionArtwork(bound.sample(data.progress), data.middle))
    throw Error('Restricted arc promoted middle differs from the original pose.');
  const u = bound.parameter(data.progress),
    left = segment(data.geometry.cubic, 0, u),
    right = segment(data.geometry.cubic, u, 1);
  const relativeMiddle = {
    x: data.middle.x - data.geometry.origin.x,
    y: data.middle.y - data.geometry.origin.y,
  };
  const output: [RestrictedArcGeometry, RestrictedArcGeometry] = [
    {
      descriptor: map.restrict(0, data.progress),
      origin: { ...data.geometry.origin },
      cubic: [left[0], left[1], left[2], relativeMiddle],
    },
    {
      descriptor: map.restrict(data.progress, 1),
      origin: { ...data.middle },
      cubic: [
        { x: 0, y: 0 },
        ...right.slice(1).map((p) => ({ x: p.x - relativeMiddle.x, y: p.y - relativeMiddle.y })),
      ] as unknown as Cubic,
    },
  ];
  const outputStamp = selectionTrajectoryStamp(output);
  for (const half of output) bindRestrictedArcGeometry(half);
  current();
  validateLiveGraphicData(output);
  if (selectionTrajectoryStamp(output) !== outputStamp)
    throw Error('Restricted arc half geometry changed during admission.');
  return output;
}
