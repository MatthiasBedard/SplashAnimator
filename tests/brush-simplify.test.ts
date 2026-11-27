import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { simplifyBrushSamples } from '../packages/geometry/src/brush-simplify';
import { pathCommands } from '../packages/geometry/src/drawing';
const brush = (): Vector => ({
  id: 'stroke',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 1000,
  height: 200,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 24,
  brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
  points: [],
});
it('reduces a dense straight pressure ramp while preserving raw samples and endpoints', () => {
  const s = brush();
  s.points = Array.from({ length: 1200 }, (_, i) => ({
    x: i * 0.7,
    y: i * 0.35,
    pressure: 0.1 + i / 1500,
    tiltX: 3,
    twist: 17,
  }));
  const before = JSON.stringify(s);
  const reduced = simplifyBrushSamples(s);
  expect(reduced).toEqual([s.points[0], s.points.at(-1)]);
  expect(pathCommands(s)).toHaveLength(17);
  expect(JSON.stringify(s)).toBe(before);
});
it('retains pressure peaks, corners, reversals and stationary widening', () => {
  const s = brush();
  s.points = [
    { x: 0, y: 0, pressure: 0.1 },
    { x: 50, y: 0, pressure: 1 },
    { x: 100, y: 0, pressure: 0.1 },
  ];
  expect(simplifyBrushSamples(s)).toHaveLength(3);
  s.points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 0 },
  ];
  expect(simplifyBrushSamples(s)).toHaveLength(4);
  s.points = [
    { x: 0, y: 0, pressure: 0.1 },
    { x: 0, y: 0, pressure: 1 },
    { x: 0, y: 0, pressure: 0.1 },
  ];
  expect(simplifyBrushSamples(s)).toHaveLength(3);
});
it('bounds center and width deviations after affine scaling', () => {
  const s = brush();
  s.points = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 50, y: 0.01, pressure: 0.5 },
    { x: 100, y: 0, pressure: 0.5 },
  ];
  expect(simplifyBrushSamples(s)).toHaveLength(2);
  s.transform = [20, 0, 0, 20];
  expect(simplifyBrushSamples(s)).toHaveLength(3);
  s.transform = undefined;
  s.points[1].y = 0;
  s.points[1].pressure = 0.501;
  expect(simplifyBrushSamples(s)).toHaveLength(2);
  s.transform = [20, 0, 0, 20];
  expect(simplifyBrushSamples(s)).toHaveLength(3);
});
it('retains unsupported nib samples and bounds adversarial processing', () => {
  const s = brush();
  s.points = Array.from({ length: 4000 }, (_, i) => ({ x: i, y: i % 2 ? 100 : 0 }));
  expect(simplifyBrushSamples(s)).toBe(s.points);
  for (const extra of [{ tilt: true }, { twist: true }, { response: 2 }]) {
    const candidate = { ...s, brush: { ...s.brush!, ...extra } };
    expect(simplifyBrushSamples(candidate)).toBe(s.points);
  }
  expect(() => simplifyBrushSamples(s, NaN)).toThrow(/tolerance/);
});
