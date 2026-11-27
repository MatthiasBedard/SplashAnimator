import { describe, expect, it } from 'vitest';
import { alignMotionPathJoins } from '../apps/editor/src/motion-path-align';
import { createMotionPathSampler, type MotionPath } from '../packages/animation/src/motion-path';
const start = { x: 0, y: 0 },
  end = { x: 100, y: 0 };
const path: MotionPath = {
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  waypoints: [{ x: 50, y: 0 }],
  curvedWaypoints: true,
  waypointTangents: [
    { x: 10, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 0 },
  ],
  waypointIncoming: [{ x: 0, y: 20 }],
  distance: true,
};
describe('align motion tangent joins', () => {
  it('preserves independent length and outgoing vectors, enables heading and detaches settings', () => {
    const before = structuredClone(path),
      result = alignMotionPathJoins(start, end, path);
    expect(result.waypointIncoming).toEqual([{ x: -20, y: -0 }]);
    expect(result.waypointTangents).toEqual(path.waypointTangents);
    const sample = createMotionPathSampler(start, end, result);
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      expect(sample(t).x).toBeCloseTo(100 * t, 2);
      expect(sample(t).y).toBe(0);
      expect(sample(t).tangentAngle).toBe(0);
    }
    expect(path).toEqual(before);
    expect(result.waypoints![0]).not.toBe(path.waypoints![0]);
    expect(result.waypointTangents![0]).not.toBe(path.waypointTangents![0]);
  });
  it('rejects zero handles and a stationary segment without changing input', () => {
    for (const bad of [
      { ...path, waypointIncoming: [{ x: 0, y: 0 }] },
      {
        ...path,
        waypointTangents: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ]) {
      const before = structuredClone(bad);
      expect(() => alignMotionPathJoins(start, end, bad)).toThrow();
      expect(bad).toEqual(before);
    }
  });
  it('aligns oblique handles with independent lengths and rejects malformed modes', () => {
    const p = {
      ...path,
      waypoints: [{ x: 30, y: 40 }],
      waypointTangents: [
        { x: 3, y: 4 },
        { x: 6, y: 8 },
        { x: 3, y: 4 },
      ],
      waypointIncoming: [{ x: 5, y: 0 }],
    };
    const result = alignMotionPathJoins(start, { x: 60, y: 80 }, p);
    expect(result.waypointIncoming![0].x).toBeCloseTo(-3, 12);
    expect(result.waypointIncoming![0].y).toBeCloseTo(-4, 12);
    expect(() =>
      alignMotionPathJoins(start, end, { ...path, waypointIncoming: undefined }),
    ).toThrow(/independent/);
    expect(() =>
      alignMotionPathJoins(start, end, { ...path, waypointIncoming: [{ x: NaN, y: 0 }] }),
    ).toThrow(/finite/);
  });
});

it('matches equal-time velocity at multiple oblique joins without changing outgoing handles', () => {
  const p: MotionPath = {
    ...path,
    distance: false,
    waypoints: [
      { x: 30, y: 10 },
      { x: 70, y: -10 },
    ],
    waypointTangents: [
      { x: 5, y: 0 },
      { x: 5, y: 2 },
      { x: 5, y: -2 },
      { x: 5, y: 0 },
    ],
    waypointIncoming: [
      { x: 0, y: 12 },
      { x: 0, y: -15 },
    ],
  };
  const before = structuredClone(p);
  const result = alignMotionPathJoins(start, end, p, true);
  expect(result.waypointIncoming).toEqual([
    { x: -5, y: -2 },
    { x: -5, y: 2 },
  ]);
  expect(result.waypointTangents).toEqual(p.waypointTangents);
  expect(p).toEqual(before);
  const sample = createMotionPathSampler(start, end, result),
    h = 1e-7;
  for (const [t, dy] of [
    [1 / 3, 18],
    [2 / 3, -18],
  ]) {
    const at = sample(t),
      left = sample(t - h),
      right = sample(t + h);
    for (const [axis, derivative] of [
      ['x', 45],
      ['y', dy],
    ] as const) {
      expect((at[axis] - left[axis]) / h).toBeCloseTo(derivative, 3);
      expect((right[axis] - at[axis]) / h).toBeCloseTo(derivative, 3);
    }
  }
  result.waypointTangents![1].x = 99;
  expect(p).toEqual(before);
});
it('preflights matching lengths atomically and retains distance timing', () => {
  const result = alignMotionPathJoins(start, end, path, true);
  expect(result.distance).toBe(true);
  expect(result.tangent).toBe(true);
  const sample = createMotionPathSampler(start, end, result);
  expect(sample(0.25).x).toBeCloseTo(25, 2);
  for (const bad of [
    { ...path, waypointIncoming: [{ x: 0, y: 0 }] },
    {
      ...path,
      waypointTangents: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ]) {
    const before = structuredClone(bad);
    expect(() => alignMotionPathJoins(start, end, bad, true)).toThrow();
    expect(bad).toEqual(before);
  }
});
