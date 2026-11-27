import { expect, it, vi } from 'vitest';
import type { Vector } from '../packages/document/src';
import { brushDabs, pathCommands, type Command } from '../packages/geometry/src/drawing';
import { contains, vectorPolygons } from '../packages/geometry/src/merge';
const brush = (): Vector => ({
  id: 'rotate',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 40,
  brush: { pressure: false, minimum: 0.1, tilt: false, twist: true, aspect: 0.2, angle: 0 },
  points: [
    { x: 0, y: 0, twist: 0 },
    { x: 0, y: 0, twist: 90 },
  ],
});
it('fills the swept diagonal during a stationary quarter-turn without rewriting samples', () => {
  const s = brush(),
    before = JSON.stringify(s),
    dabs = brushDabs(s);
  expect(dabs.length).toBe(31);
  const polygon = vectorPolygons(s);
  expect(contains(polygon, { x: 12, y: 12 })).toBe(true);
  expect(contains(polygon, { x: -12, y: 12 })).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});
it('uses shortest-arc twist and samples sparse tilted rotations', () => {
  const s = brush();
  s.points[0].twist = 350;
  s.points[1].twist = 10;
  const dabs = brushDabs(s);
  expect(dabs).toHaveLength(8);
  expect(dabs.every((d) => Math.cos(d.angle) > 0.98)).toBe(true);
  s.brush!.twist = false;
  s.brush!.tilt = true;
  s.points = [
    { x: 0, y: 0, tiltX: 45, tiltY: 0 },
    { x: 1, y: 0, tiltX: 0, tiltY: 45 },
  ];
  expect(brushDabs(s).length).toBeGreaterThanOrEqual(31);
  expect(contains(vectorPolygons(s), { x: 12, y: 12 })).toBe(true);
});
it('drops exact duplicate dabs but retains stationary pressure changes', () => {
  const s = brush();
  s.points = Array.from({ length: 2000 }, () => ({ x: 0, y: 0, twist: 0 }));
  expect(brushDabs(s)).toHaveLength(1);
  s.brush!.pressure = true;
  s.points = [
    { x: 0, y: 0, pressure: 0.2 },
    { x: 0, y: 0, pressure: 1 },
  ];
  expect(brushDabs(s)).toHaveLength(2);
});

it('reuses ellipse trigonometry without changing any rotating-dab control points', () => {
  const s = brush();
  s.brush = { pressure: true, minimum: 0.1, tilt: true, twist: true, aspect: 0.2, angle: 17 };
  s.points = Array.from({ length: 41 }, (_, i) => ({
    x: i * 8,
    y: Math.sin(i / 5) * 30,
    pressure: 0.2 + i / 50,
    tiltX: 30 - i,
    tiltY: i / 2,
    twist: (350 + i * 3) % 360,
  }));
  const before = JSON.stringify(s),
    dabs = brushDabs(s);
  const expected: Command[] = [];
  // Original per-control-point ellipse formula, independent of the optimized helper.
  for (const { x, y, rx, ry, angle } of dabs) {
    const k = 0.5522847498307936;
    const p = (u: number, v: number): [number, number] => [
      x + u * Math.cos(angle) - v * Math.sin(angle),
      y + u * Math.sin(angle) + v * Math.cos(angle),
    ];
    expected.push(
      ['M', ...p(rx, 0)],
      ['C', ...p(rx, k * ry), ...p(k * rx, ry), ...p(0, ry)],
      ['C', ...p(-k * rx, ry), ...p(-rx, k * ry), ...p(-rx, 0)],
      ['C', ...p(-rx, -k * ry), ...p(-k * rx, -ry), ...p(0, -ry)],
      ['C', ...p(k * rx, -ry), ...p(rx, -k * ry), ...p(rx, 0)],
      ['Z'],
    );
  }
  const cos = vi.spyOn(Math, 'cos'),
    sin = vi.spyOn(Math, 'sin');
  try {
    const result = pathCommands(s);
    expect(cos).toHaveBeenCalledTimes(dabs.length);
    expect(sin).toHaveBeenCalledTimes(dabs.length);
    expect(result).toEqual(expected);
  } finally {
    cos.mockRestore();
    sin.mockRestore();
  }
  expect(JSON.stringify(s)).toBe(before);
});
