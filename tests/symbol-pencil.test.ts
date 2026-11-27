import { expect, it } from 'vitest';
import {
  drawnSymbolPencil,
  drawnSymbolBrush,
  symbolBrushMergeStart,
} from '../packages/geometry/src/symbol-artwork';
it('finishes unfilled pencil paths with preserved endpoints and immutable raw samples', () => {
  const samples = [
    { x: 10, y: 20 },
    { x: 20, y: 40 },
    { x: 30, y: 20 },
  ];
  const raw = drawnSymbolPencil('p', samples, 'raw', '#123456', 3);
  const smooth = drawnSymbolPencil('p', samples, 'smooth', '#123456', 3);
  const straight = drawnSymbolPencil('p', samples, 'straight', '#123456', 3);
  const world = (s: typeof raw) =>
    (s.nodes ?? s.points).map((p) => ({ x: s.x + p.x, y: s.y + p.y }));
  expect(world(raw)).toEqual(samples);
  expect(world(smooth)).toEqual([
    { x: 10, y: 20 },
    { x: 20, y: 30 },
    { x: 30, y: 20 },
  ]);
  expect(world(straight)).toEqual([samples[0], samples[2]]);
  expect(raw.fillEnabled).toBe(false);
  expect(raw.stroke).toBe('#123456');
  expect(raw.strokeWidth).toBe(3);
  expect(samples[1]).toEqual({ x: 20, y: 40 });
  expect(() => drawnSymbolPencil('p', samples, 'raw', '#123456', NaN)).toThrow('width');
  expect(() => drawnSymbolPencil('p', [{ x: NaN, y: 0 }, samples[0]], 'raw', '#123456', 3)).toThrow(
    'finite',
  );
  expect(() => drawnSymbolPencil('p', Array(100001).fill(samples[0]), 'raw', '#123456', 3)).toThrow(
    '100000',
  );
});

it('builds bounded circular brush fills and preserves protected stack barriers', () => {
  const samples = [
    { x: 10, y: 20 },
    { x: 30, y: 30 },
    { x: 50, y: 20 },
  ];
  const s = drawnSymbolBrush('b', samples, '#123456', 12, true);
  expect(s.kind).toBe('brush');
  expect(s.fillEnabled).toBe(true);
  expect(s.fill).toBe('#123456');
  expect(s.brush?.pressure).toBe(false);
  expect(samples[1].y).toBe(30);
  expect(drawnSymbolBrush('dot', [samples[0]], '#123456', 12, false).points).toHaveLength(2);
  expect(symbolBrushMergeStart([s, { ...s, id: 'g', groups: ['group'] }, s])).toBe(2);
  expect(() => drawnSymbolBrush('b', samples, '#123456', 0, true)).toThrow();
});

it('retains sampled pen metadata and captured brush settings through symbol normalization and smoothing', () => {
  const samples = [
    { x: 10, y: 20, pressure: 0.2, tiltX: 30, tiltY: -10, twist: 90 },
    { x: 20, y: 35, pressure: 0.8, tiltX: 40, tiltY: -20, twist: 180 },
    { x: 30, y: 20, pressure: 0.8, tiltX: 40, tiltY: -20, twist: 180 },
  ];
  const brush = {
    pressure: true,
    minimum: 0.1,
    response: 2,
    tilt: true,
    twist: true,
    aspect: 0.5,
    angle: 20,
  };
  const original = structuredClone(samples);
  const s = drawnSymbolBrush('pen', samples, '#123456', 20, true, brush);
  expect(s.brush).toEqual(brush);
  expect(
    s.points.map(({ pressure, tiltX, tiltY, twist }) => ({ pressure, tiltX, tiltY, twist })),
  ).toEqual(
    samples.map(({ pressure, tiltX, tiltY, twist }) => ({ pressure, tiltX, tiltY, twist })),
  );
  brush.aspect = 1;
  expect(s.brush!.aspect).toBe(0.5);
  expect(samples).toEqual(original);
});

it('preserves the complete tail and pen metadata of long symbol strokes beyond the former 4096 limit', () => {
  const samples = Array.from({ length: 21000 }, (_, i) => ({
    x: i / 10,
    y: i > 4095 ? i % 17 : 0,
    pressure: (i % 10) / 10,
    tiltX: i % 45,
    twist: i % 360,
  }));
  for (const shape of [
    drawnSymbolPencil('p', samples, 'raw', '#123456', 3),
    drawnSymbolBrush('b', samples, '#123456', 12, false),
  ]) {
    expect(shape.points).toHaveLength(samples.length);
    expect(shape.points.map((p) => ({ ...p, x: shape.x + p.x, y: shape.y + p.y }))).toEqual(
      samples,
    );
    expect(shape.points[15000]).toMatchObject(samples[15000]);
  }
});
