import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { brushDabs, pathCommands } from '../packages/geometry/src/drawing';
import { vectorPolygons, contains } from '../packages/geometry/src/merge';

const stroke = (): Vector => ({
  id: 'sweep',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 800,
  height: 200,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 24,
  brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
  points: Array.from({ length: 41 }, (_, i) => ({
    x: 20 + i * 18,
    y: 100 + Math.sin(i / 5) * 60,
    pressure: 0.3 + i / 60,
  })),
});
function stamped(s: Vector) {
  // Zero-twist samples take the existing dense path without changing the nib.
  const legacy = { ...s, brush: { ...s.brush!, twist: true } };
  return { commands: pathCommands(legacy), result: vectorPolygons(legacy) };
}
it('reduces fixed-nib geometry while retaining the dense reference interior', () => {
  const s = stroke();
  const start = performance.now();
  const old = stamped(s);
  const oldMs = performance.now() - start;
  const nextStart = performance.now();
  const commands = pathCommands(s),
    result = vectorPolygons(s);
  const nextMs = performance.now() - nextStart;
  expect(commands.length).toBeLessThan(old.commands.length / 10);
  expect(result).toHaveLength(1);
  // The continuous sweep contains the sampled stamp reference. Allow the
  // shared quarter-pixel flattening tolerance around its boundary.
  for (const poly of old.result)
    for (const ring of poly)
      for (const [x, y] of ring) {
        expect(
          [
            [0, 0],
            [0.3, 0],
            [-0.3, 0],
            [0, 0.3],
            [0, -0.3],
          ].some(([dx, dy]) => contains(result, { x: x + dx, y: y + dy })),
        ).toBe(true);
      }
  console.log(
    JSON.stringify({
      brushSweep: { oldCommands: old.commands.length, commands: commands.length, oldMs, nextMs },
    }),
  );
});
it('covers exact tangent edges, stationary pressure and contained discs', () => {
  const s = stroke();
  s.points = [
    { x: 0, y: 0, pressure: 1 },
    { x: 100, y: 0, pressure: 1 },
  ];
  const p = vectorPolygons(s);
  expect(contains(p, { x: 50, y: 11.9 })).toBe(true);
  expect(contains(p, { x: 50, y: 12.1 })).toBe(false);
  s.points = [
    { x: 0, y: 0, pressure: 0 },
    { x: 0, y: 0, pressure: 1 },
    { x: 1, y: 0, pressure: 0 },
  ];
  expect(vectorPolygons(s)).toHaveLength(1);
  expect(contains(vectorPolygons(s), { x: 0, y: 11 })).toBe(true);
  expect(
    pathCommands(s)
      .flat()
      .filter((v) => typeof v === 'number')
      .every(Number.isFinite),
  ).toBe(true);
});
it('preserves rotated elliptical nibs and self-crossing strokes', () => {
  const s = stroke();
  s.brush!.aspect = 0.25;
  s.brush!.angle = 90;
  s.points = [
    { x: 0, y: 0, pressure: 1 },
    { x: 100, y: 0, pressure: 1 },
    { x: 0, y: 100, pressure: 1 },
    { x: 100, y: 100, pressure: 1 },
    { x: 0, y: 0, pressure: 1 },
  ];
  const p = vectorPolygons(s);
  expect(p).toHaveLength(1);
  expect(contains(p, { x: 50, y: 50 })).toBe(true);
  expect(contains(p, { x: 50, y: 11 })).toBe(true);
  expect(contains(p, { x: -4, y: 0 })).toBe(false);
});
it('keeps rotating nibs on the existing sampled path', () => {
  for (const patch of [{ tilt: true }, { twist: true }]) {
    const s = stroke();
    Object.assign(s.brush!, patch);
    expect(pathCommands(s).length).toBe(brushDabs(s).length * 6);
  }
});

it('commits dense long strokes without sweep-tree failures', () => {
  for (let seed = 0; seed < 8; seed++) {
    const s = stroke();
    s.points = Array.from({ length: 1200 }, (_, i) => ({
      x: 100 + i * 0.7 + seed / 13,
      y: 220 + (seed % 2 ? Math.sin(i / 30) * 60 : i * 0.35),
      pressure: 1,
    }));
    expect(vectorPolygons(s).length).toBeGreaterThan(0);
  }
});
