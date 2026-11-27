import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { responseSweepSamples } from '../packages/geometry/src/brush-response-sweep';
import { brushNib } from '../packages/geometry/src/pressure';
import { brushDabs, pathCommands } from '../packages/geometry/src/drawing';
import { vectorPolygons, contains } from '../packages/geometry/src/merge';
const stroke = (response = 2): Vector => ({
  id: 'response',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 5000,
  height: 20,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 40,
  brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0, response },
  points: [
    { x: 0, y: 0, pressure: 0 },
    { x: 5000, y: 0, pressure: 1 },
  ],
});
it('bounds soft/firm radius interpolation for rising/falling pressure and affine scaling', () => {
  for (const response of [0.25, 0.5, 2, 4])
    for (const reverse of [false, true])
      for (const scale of [1, 20]) {
        const s = stroke(response);
        s.transform = [scale, 0, 0, scale];
        if (reverse) s.points.reverse();
        const before = JSON.stringify(s),
          points = responseSweepSamples(s)!;
        expect(points[0]).toBe(s.points[0]);
        expect(points.at(-1)).toBe(s.points.at(-1));
        expect(points.length).toBeLessThan(1000);
        for (let i = 1; i < points.length; i++)
          for (let j = 0; j <= 100; j++) {
            const a = points[i - 1],
              b = points[i],
              t = j / 100;
            const actual = brushNib(s, {
              x: 0,
              y: 0,
              pressure: a.pressure! + (b.pressure! - a.pressure!) * t,
            }).rx;
            const interpolated = brushNib(s, a).rx * (1 - t) + brushNib(s, b).rx * t;
            expect(Math.abs(actual - interpolated) * scale).toBeLessThanOrEqual(0.02500001);
          }
        expect(JSON.stringify(s)).toBe(before);
      }
});
it('avoids distance-based stamp growth and preserves a dense reference interior', () => {
  const s = stroke(0.5),
    start = performance.now(),
    dabs = brushDabs(s),
    legacyMs = performance.now() - start;
  const begin = performance.now(),
    commands = pathCommands(s),
    sweepMs = performance.now() - begin;
  console.log('5000-unit soft-pressure stroke', {
    legacyDabs: dabs.length,
    legacyCommands: dabs.length * 6,
    commands: commands.length,
    legacyDabMs: legacyMs,
    sweepMs,
  });
  expect(commands.length).toBeLessThan((dabs.length * 6) / 10);
  const polygon = vectorPolygons(s);
  for (let x = 20; x < 5000; x += 29) {
    const radius = brushNib(s, { x, y: 0, pressure: x / 5000 }).rx;
    expect(contains(polygon, { x, y: Math.max(0, radius - 0.4) })).toBe(true);
  }
});
it('retains stationary pressure peaks and rejects unsupported nibs or exhausted budgets', () => {
  const s = stroke();
  s.points = [
    { x: 0, y: 0, pressure: 0 },
    { x: 0, y: 0, pressure: 1 },
    { x: 0, y: 0, pressure: 0 },
  ];
  expect(contains(vectorPolygons(s), { x: 0, y: 19 })).toBe(true);
  expect(responseSweepSamples({ ...s, brush: { ...s.brush!, twist: true } })).toBeUndefined();
  expect(responseSweepSamples(s, 1e-15)).toBeUndefined();
  expect(() => responseSweepSamples(s, 0)).toThrow('Invalid brush tolerance');
});
