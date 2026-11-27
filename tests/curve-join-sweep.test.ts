import { fitPolyline, segmentError, type Cubic } from '../packages/geometry/src/curve-fit';
import { expect, it } from 'vitest';
it('keeps sampled ellipse joins and independent curve distances bounded across sampling densities', () => {
  for (const count of [64, 128, 256]) {
    const points = Array.from({ length: count }, (_, i) => ({
      x: 100 * Math.cos((i * 2 * Math.PI) / count),
      y: 60 * Math.sin((i * 2 * Math.PI) / count),
    }));
    const fit = fitPolyline(points, 0.25, true);
    console.log('Ellipse joins', count, fit.joins.maxDegrees, fit.joins.discontinuities, fit.work);
    expect(fit.joins.maxDegrees).toBeLessThan(0.00001);
    expect(fit.maxError).toBeLessThanOrEqual(0.25);
    expect(fit.work).toBeLessThan(10000);
    for (const c of fit.curves)
      for (let step = 0; step <= 32; step++) {
        const t = step / 32,
          u = 1 - t,
          w = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
        const q = {
          x: c.reduce((n, p, i) => n + p.x * w[i], 0),
          y: c.reduce((n, p, i) => n + p.y * w[i], 0),
        };
        let distance = Infinity;
        points.forEach((a, i) => {
          const b = points[(i + 1) % count],
            x = b.x - a.x,
            y = b.y - a.y;
          const v = Math.max(0, Math.min(1, ((q.x - a.x) * x + (q.y - a.y) * y) / (x * x + y * y)));
          distance = Math.min(distance, Math.hypot(q.x - a.x - v * x, q.y - a.y - v * y));
        });
        expect(distance).toBeLessThanOrEqual(0.250001);
      }
  }
});

it('fits translated straight samples without cancellation-driven subdivision', () => {
  for (const offset of [0, 1e6, 1e9, 1e10]) {
    const points = Array.from({ length: 33 }, (_, i) => ({
      x: offset + i * 4,
      y: -offset + i * 2,
    }));
    const before = JSON.stringify(points);
    const fit = fitPolyline(points, 0.00001);
    console.log('Translated line fit', offset, fit.curves.length, fit.maxError, fit.work);
    expect(fit.curves).toHaveLength(1);
    expect(fit.maxError).toBeLessThanOrEqual(0.00001);
    expect(JSON.stringify(points)).toBe(before);
    expect(fit.nodes[0]).toMatchObject(points[0]);
    expect(fit.nodes.at(-1)).toMatchObject(points.at(-1)!);
  }
});

it('certifies identical translated control differences without interpolation cancellation', () => {
  const curve: Cubic = [
    { x: 0, y: 0 },
    { x: 12, y: 24 },
    { x: 40, y: -8 },
    { x: 64, y: 16 },
  ];
  const a = { x: 8, y: 4 },
    b = { x: 48, y: 12 };
  for (const offset of [1e6, 1e9, 1e10]) {
    const shift = (p: { x: number; y: number }) => ({ x: p.x + offset, y: p.y - offset });
    for (const [start, end] of [
      [0, 1],
      [0.1, 0.8],
      [0.25, 0.75],
    ]) {
      expect(segmentError(curve.map(shift) as Cubic, shift(a), shift(b), start, end)).toBeCloseTo(
        segmentError(curve, a, b, start, end),
        12,
      );
    }
  }
});
