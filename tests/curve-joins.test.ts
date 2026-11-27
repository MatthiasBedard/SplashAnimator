import { expect, it } from 'vitest';
import { measureCurveJoins, smoothCurveJoins } from '../packages/geometry/src/curve-joins';
import { fitPolyline, type Cubic } from '../packages/geometry/src/curve-fit';
const line = (x: number, y: number, u: number, v: number): Cubic => [
  { x, y },
  { x, y },
  { x: u, y: v },
  { x: u, y: v },
];
it('distinguishes collinear joins, reversals and intentional corners with collapsed handles', () => {
  expect(
    measureCurveJoins([line(0, 0, 10, 0), line(10, 0, 20, 0)], new Set(), false).maxDegrees,
  ).toBe(0);
  expect(
    measureCurveJoins([line(0, 0, 10, 0), line(10, 0, 0, 0)], new Set(), false).maxDegrees,
  ).toBe(180);
  const turn = [line(0, 0, 10, 0), line(10, 0, 10, 10)];
  expect(measureCurveJoins(turn, new Set(), false).discontinuities).toBe(1);
  expect(measureCurveJoins(turn, new Set([1]), false)).toMatchObject({
    maxDegrees: 0,
    intentionalCorners: 1,
  });
});
it('includes the closed seam and reports undefined tangents', () => {
  const curves = [line(0, 0, 10, 0), line(10, 0, 0, 0)];
  expect(measureCurveJoins(curves, new Set(), true).discontinuities).toBe(2);
  expect(measureCurveJoins([line(0, 0, 0, 0)], new Set(), true).degenerate).toBe(1);
});
it('marks original sharp corners including the closing seam rather than artificial fit splits', () => {
  const square = fitPolyline(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    0.1,
    true,
  );
  expect(square.joins).toEqual({
    maxDegrees: 0,
    discontinuities: 0,
    degenerate: 0,
    intentionalCorners: 4,
    issues: [],
  });
  const ring = Array.from({ length: 128 }, (_, i) => ({
    x: 100 * Math.cos((i * Math.PI) / 64),
    y: 100 * Math.sin((i * Math.PI) / 64),
  }));
  const fit = fitPolyline(ring, 0.25, true);
  expect(fit.joins.intentionalCorners).toBe(0);
  expect(Number.isFinite(fit.joins.maxDegrees)).toBe(true);
});

it('aligns handles only inside the shared displacement budget and leaves corners untouched', () => {
  const curves: Cubic[] = [
    [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 7, y: -0.2 },
      { x: 10, y: 0 },
    ],
    [
      { x: 10, y: 0 },
      { x: 13, y: -0.2 },
      { x: 17, y: 0 },
      { x: 20, y: 0 },
    ],
  ];
  const before = JSON.stringify(curves);
  const smooth = smoothCurveJoins(curves, [0.1, 0.1], new Set(), false, 0.4);
  expect(measureCurveJoins(smooth.curves, new Set(), false).maxDegrees).toBeLessThan(0.00001);
  expect(smooth.maxError).toBeLessThanOrEqual(0.4);
  const partial = smoothCurveJoins(curves, [0.1, 0.1], new Set(), false, 0.11);
  expect(partial.maxError).toBeLessThanOrEqual(0.11);
  const angle = measureCurveJoins(partial.curves, new Set(), false).maxDegrees;
  expect(angle).toBeGreaterThan(1);
  expect(angle).toBeLessThan(measureCurveJoins(curves, new Set(), false).maxDegrees);
  partial.curves.forEach((curve, i) =>
    curve.forEach((p, k) => {
      expect(Math.hypot(p.x - curves[i][k].x, p.y - curves[i][k].y)).toBeLessThanOrEqual(0.01);
    }),
  );
  expect(smoothCurveJoins(curves, [0.1, 0.1], new Set(), false, 0.1).curves).toEqual(curves);
  expect(smoothCurveJoins(curves, [0, 0], new Set([1]), false, 1).curves).toEqual(curves);
  expect(JSON.stringify(curves)).toBe(before);
});

it('rechecks smoothed circle spans against original segments without relaxing tolerance', () => {
  for (const radius of [40, 90]) {
    const points = Array.from({ length: 64 }, (_, i) => ({
      x: radius * Math.cos((i * Math.PI) / 32),
      y: radius * Math.sin((i * Math.PI) / 32),
    }));
    const fit = fitPolyline(points, 0.25, true);
    expect(fit.maxError).toBeLessThanOrEqual(0.25);
    console.log('Source-certified joins', radius, fit.joins);
    expect(fit.joins.maxDegrees).toBeLessThan(4);
  }
});

it('locates problem joins without aliasing points or marking intentional corners', () => {
  const curves = [line(0, 0, 10, 0), line(10, 0, 10, 10)];
  const result = measureCurveJoins(curves, new Set(), false);
  expect(result.issues).toEqual([{ index: 1, point: { x: 10, y: 0 }, degrees: 90 }]);
  result.issues[0].point.x = 99;
  expect(curves[1][0].x).toBe(10);
  expect(measureCurveJoins(curves, new Set([1]), false).issues).toEqual([]);
  expect(measureCurveJoins([line(5, 6, 5, 6)], new Set(), true).issues).toEqual([
    { index: 0, point: { x: 5, y: 6 }, degrees: null },
  ]);
});

it('aligns toward either constrained span without spending its exhausted error budget', () => {
  for (const constrained of [0, 1]) {
    const curves: Cubic[] = [
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 7, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 10, y: 0 },
        { x: 13, y: 0 },
        { x: 17, y: 0 },
        { x: 20, y: 0 },
      ],
    ];
    if (constrained === 0) curves[1][1].y = 0.2;
    else curves[0][2].y = 0.2;
    const errors = constrained === 0 ? [0.3, 0] : [0, 0.3];
    const before = JSON.stringify(curves);
    const result = smoothCurveJoins(curves, errors, new Set(), false, 0.3);
    expect(result.curves[constrained]).toEqual(curves[constrained]);
    expect(measureCurveJoins(result.curves, new Set(), false).maxDegrees).toBeLessThan(0.00001);
    expect(result.maxError).toBeLessThanOrEqual(0.3);
    expect(JSON.stringify(curves)).toBe(before);
  }
});

it('certifies translated editor rings with bounded work and no visible tangent breaks', () => {
  for (const radius of [40, 90]) {
    const points = Array.from({ length: 64 }, (_, i) => ({
      x: 250 + radius * Math.cos((i * Math.PI) / 32),
      y: 180 + radius * Math.sin((i * Math.PI) / 32),
    }));
    const fit = fitPolyline(points, 0.25, true);
    console.log(
      'Editor ring joins',
      radius,
      fit.joins.maxDegrees,
      fit.joins.discontinuities,
      fit.work,
    );
    expect(fit.maxError).toBeLessThanOrEqual(0.25);
    expect(fit.joins.maxDegrees).toBeLessThan(1);
    expect(fit.joins.discontinuities).toBe(0);
    expect(fit.work).toBeLessThan(10000);
  }
});

it('keeps rippled ring fitting within its certified error and work limits', () => {
  for (const amplitude of [2, 5, 10]) {
    const points = Array.from({ length: 64 }, (_, i) => {
      const angle = (i * Math.PI) / 32,
        radius = 90 + amplitude * Math.cos(9 * angle);
      return { x: 250 + radius * Math.cos(angle), y: 180 + radius * Math.sin(angle) };
    });
    const fit = fitPolyline(points, 0.25, true);
    console.log(
      'Ripple joins',
      amplitude,
      fit.joins.discontinuities,
      fit.joins.maxDegrees,
      fit.work,
    );
    expect(fit.maxError).toBeLessThanOrEqual(0.25);
    expect(fit.work).toBeLessThan(10000);
    expect(fit.joins.maxDegrees).toBeLessThan(amplitude === 2 ? 9 : amplitude === 5 ? 20 : 38);
    for (const curve of fit.curves)
      for (let step = 0; step <= 16; step++) {
        const t = step / 16,
          u = 1 - t,
          weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
        const q = {
          x: curve.reduce((sum, p, i) => sum + weights[i] * p.x, 0),
          y: curve.reduce((sum, p, i) => sum + weights[i] * p.y, 0),
        };
        let distance = Infinity;
        points.forEach((a, i) => {
          const b = points[(i + 1) % points.length],
            x = b.x - a.x,
            y = b.y - a.y;
          const fraction = Math.max(
            0,
            Math.min(1, ((q.x - a.x) * x + (q.y - a.y) * y) / (x * x + y * y)),
          );
          distance = Math.min(
            distance,
            Math.hypot(q.x - a.x - fraction * x, q.y - a.y - fraction * y),
          );
        });
        expect(distance).toBeLessThanOrEqual(0.250001);
      }
  }
});
