import { expect, it } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { fitPencilStroke } from '../packages/geometry/src/pencil-fit';
import { normalizeVector } from '../packages/geometry/src/drawing';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';

const incoming = (): Vector => ({
  id: 'incoming',
  kind: 'path',
  x: 20,
  y: 30,
  width: 40,
  height: 20,
  rotation: 0,
  fill: '#000000',
  fillEnabled: false,
  stroke: '#ff0000',
  strokeWidth: 4,
  points: [
    { x: 0, y: 0, pressure: 0.3 },
    { x: 10, y: 12 },
    { x: 20, y: -2 },
    { x: 30, y: 10 },
    { x: 40, y: 0, pressure: 0.8 },
  ],
});
for (const mode of ['ink', 'smooth', 'straight'] as const)
  for (const merge of [false, true])
    it(`${mode}/${merge}: worker finishing matches the selected finishing kernel and leaves inputs detached`, () => {
      const stroke = incoming(),
        previous = incoming();
      previous.id = 'previous';
      previous.y = 100;
      const shapes = [previous],
        before = clone({ shapes, stroke });
      let expected = clone(stroke);
      if (mode === 'smooth') expected = fitPencilStroke(expected);
      if (mode === 'straight') expected.points = [expected.points[0], expected.points.at(-1)!];
      if (expected.kind === 'path') normalizeVector(expected);
      if (merge) expected.drawingMode = 'merge';
      const result = preparePencilDrawing(shapes, { stroke, mode, merge });
      expect(result.shape).toEqual(expected);
      // Nothing meets either stroke: Merge Drawing leaves the earlier one exactly as it was and
      // adds the finished stroke as drawn.
      expect(result.shapes).toEqual(merge ? [...shapes, expected] : shapes);
      expect({ shapes, stroke }).toEqual(before);
      result.shape.x = 999;
      result.shapes[0].x = 999;
      expect({ shapes, stroke }).toEqual(before);
    });
it('does not merge a sub-threshold completed stroke', () => {
  const stroke = incoming();
  stroke.points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const previous = incoming();
  previous.id = 'previous';
  const result = preparePencilDrawing([previous], { stroke, mode: 'smooth', merge: true });
  expect(result.shape.width + result.shape.height).toBeLessThanOrEqual(2);
  expect(result.shapes).toEqual([previous]);
});
it('rejects invalid coordinates and overflow without changing earlier artwork', () => {
  for (const points of [
    [
      { x: NaN, y: 0 },
      { x: 1, y: 0 },
    ],
    [
      { x: 1e308, y: 0 },
      { x: -1e308, y: 0 },
    ],
  ]) {
    const stroke = incoming();
    stroke.points = points;
    const shapes = [incoming()],
      before = structuredClone({ stroke, shapes });
    expect(() => preparePencilDrawing(shapes, { stroke, mode: 'smooth', merge: true })).toThrow();
    expect({ stroke, shapes }).toEqual(before);
  }
});
