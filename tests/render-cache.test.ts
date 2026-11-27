import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { renderData } from '../packages/stage/src/render-data';
import { pathCommands } from '../packages/geometry/src/drawing';
const shape = (): Vector => ({
  id: 'cache',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 20,
  points: [
    { x: 0, y: 0, pressure: 0.4 },
    { x: 100, y: 80, pressure: 1 },
  ],
  brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
});
it('reuses geometry while keeping paint and placement live', () => {
  const s = shape(),
    first = renderData(s);
  s.x = 42;
  s.fill = '#ff0000';
  s.opacity = 0.3;
  const next = renderData(s);
  expect(next.commands).toBe(first.commands);
  expect(next).toMatchObject({ x: 42, fill: '#ff0000', opacity: 0.3 });
  expect(renderData({ ...s }).commands).not.toBe(first.commands);
});
it('invalidates nested sample, nib, affine and contour edits', () => {
  const s = shape();
  for (const edit of [
    () => {
      s.points[0].pressure = 0.8;
    },
    () => {
      s.brush!.aspect = 0.5;
    },
    () => {
      s.transform = [2, 0, 0, 1];
    },
    () => {
      s.contours = [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 20 },
        ],
      ];
    },
    () => {
      s.contours![0][1].x = 30;
    },
  ]) {
    const before = renderData(s).commands;
    edit();
    const after = renderData(s).commands;
    expect(after).not.toBe(before);
    expect(after).toEqual(pathCommands(s));
  }
});
it('invalidates Bezier handle and rounded rectangle edits', () => {
  const s = shape();
  s.kind = 'bezier';
  s.nodes = [
    { x: 0, y: 0, out: { x: 20, y: 0 } },
    { x: 50, y: 50 },
  ];
  const first = renderData(s).commands;
  s.nodes[0].out!.y = 30;
  expect(renderData(s).commands).not.toBe(first);
  s.kind = 'rectangle';
  const rectangle = renderData(s).commands;
  s.cornerRadius = 12;
  expect(renderData(s).commands).not.toBe(rectangle);
});
