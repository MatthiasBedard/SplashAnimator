import { expect, it } from 'vitest';
import { fitMotionWaypoints } from '../apps/editor/src/motion-path-fit';
import { createMotionPathSampler, type MotionPath } from '../packages/animation/src/motion-path';

const start = { x: 100, y: 100 },
  end = { x: 200, y: 100 };
const path: MotionPath = {
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  waypoints: [
    { x: 30, y: 0 },
    { x: 30, y: 40 },
  ],
};
it('retains sharp corners, endpoints and detached editable handles when fitting motion paths', () => {
  const before = structuredClone(path);
  const fitted = fitMotionWaypoints(start, end, path, 0.25);
  expect(path).toEqual(before);
  expect(fitted.waypoints).toEqual(path.waypoints);
  const sample = createMotionPathSampler(start, end, fitted);
  expect(sample(0)).toEqual(start);
  expect(sample(1)).toEqual(end);
  expect(sample(0.5).x).toBeCloseTo(130, 10);
  expect(sample(0.5).y).toBeCloseTo(120, 10);
  expect(() => createMotionPathSampler(start, end, { ...fitted, tangent: true })).toThrow(/join/);
  fitted.waypoints![0].x = 999;
  expect(path).toEqual(before);
});
it('reduces collinear samples to one editable cubic and retains distance timing', () => {
  const source = {
    ...path,
    waypoints: Array.from({ length: 20 }, (_, i) => ({ x: (i + 1) * 4, y: 0 })),
    distance: true,
    tangent: true,
  };
  const fitted = fitMotionWaypoints(start, end, source, 0.25);
  expect(fitted.waypoints).toBeUndefined();
  expect(fitted.tangent).toBe(false);
  expect(fitted.distance).toBe(true);
  const sample = createMotionPathSampler(start, end, fitted);
  for (const t of [0, 0.1, 0.5, 0.9, 1]) expect(sample(t).x).toBeCloseTo(100 + 100 * t, 3);
});
it('rejects invalid tolerance, oversized and unsupported input without changing settings', () => {
  const before = structuredClone(path);
  for (const tolerance of [0, -1, NaN, Infinity])
    expect(() => fitMotionWaypoints(start, end, path, tolerance)).toThrow();
  expect(() => fitMotionWaypoints(start, end, { ...path, curvedWaypoints: true }, 0.25)).toThrow(
    /straight/,
  );
  expect(() =>
    fitMotionWaypoints(start, end, { ...path, waypoints: Array(8191).fill({ x: 1, y: 1 }) }, 0.25),
  ).toThrow(/samples/);
  expect(path).toEqual(before);
});

it('fits a sampled arch with bounded independently measured polyline distance', () => {
  const points = Array.from({ length: 61 }, (_, i) => ({
    x: i * 2,
    y: 30 * Math.sin((Math.PI * i) / 60),
  }));
  const source = { ...path, waypoints: points.slice(1, -1) };
  const fitted = fitMotionWaypoints(points[0], points[60], source, 0.25);
  expect((fitted.waypoints?.length ?? 0) + 2).toBeLessThan(points.length);
  const sample = createMotionPathSampler(points[0], points[60], fitted);
  for (let i = 0; i <= 1000; i++) {
    const q = sample(i / 1000);
    let nearest = Infinity;
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1],
        b = points[j],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      nearest = Math.min(nearest, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
    }
    expect(nearest).toBeLessThanOrEqual(0.251);
  }
});
