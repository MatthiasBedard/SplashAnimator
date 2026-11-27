import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { hitPart } from '../packages/geometry/src';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';

const line: Vector = {
  id: 'line', kind: 'path', x: 0, y: 20, width: 120, height: 0, rotation: 0,
  fill: '#000000', fillEnabled: false, stroke: '#000000', strokeWidth: 2,
  points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
};
const paint: Vector = {
  id: 'paint', kind: 'rectangle', x: 35, y: 5, width: 50, height: 30, rotation: 0,
  fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
};
const hasStroke = (art: Vector[], x: number, y = 20) => art.some(shape => hitPart(shape, { x, y }, 0) === 'stroke');

for (const removeCoveredStrokes of [true, false])
  it(`only removes covered line spans when enabled (${removeCoveredStrokes})`, () => {
    const { shapes } = prepareShapeDrawing([line], { shape: paint, merge: true, removeCoveredStrokes });
    expect(hasStroke(shapes, 20)).toBe(true);
    expect(hasStroke(shapes, 60)).toBe(!removeCoveredStrokes);
    expect(hasStroke(shapes, 100)).toBe(true);
  });

it('removes a fully enclosed open stroke even when it does not cut the fill boundary', () => {
  const short = { ...line, x: 45, width: 30, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }] };
  const { shapes } = prepareShapeDrawing([short], { shape: paint, merge: true, removeCoveredStrokes: true });
  expect(shapes).toHaveLength(1);
  expect(shapes[0].fill).toBe(paint.fill);
  expect(shapes[0].strokeWidth).toBe(0);
});

it('keeps strokes on a shared edge, inside a hole, and under a translucent fill', () => {
  const aligned = { ...line, y: 5 };
  const hole: Vector = { ...paint, kind: 'polygon', fillRule: 'evenodd', closed: true,
    contours: [
      [{x:0,y:0},{x:50,y:0},{x:50,y:30},{x:0,y:30}],
      [{x:15,y:8},{x:35,y:8},{x:35,y:22},{x:15,y:22}],
    ] };
  const draw = (stroke: Vector, shape: Vector) =>
    prepareShapeDrawing([stroke], { shape, merge: true, removeCoveredStrokes: true }).shapes;
  expect(hasStroke(draw(aligned, paint), 60, 5)).toBe(true);
  const withHole = draw(line, hole);
  expect(hasStroke(withHole, 42)).toBe(false);
  expect(hasStroke(withHole, 60)).toBe(true);
  expect(hasStroke(draw(line, { ...paint, opacity: 0.5 }), 60)).toBe(true);
});

it('Normal Brush removes covered spans while Brush Behind preserves them', () => {
  const brush: Vector = { ...paint, kind: 'brush', x: 40, y: 20, width: 40, height: 0, strokeWidth: 12,
    points: [{x:0,y:0},{x:40,y:0}] };
  const draw = (mode: 'normal' | 'behind', at: number) => prepareBrushPaint([line], {
    brush, amount: 0, merge: true, mode, at, selected: [], removeCoveredStrokes: true,
  }).shapes;
  expect(hasStroke(draw('normal', 1), 60)).toBe(false);
  expect(hasStroke(draw('behind', 0), 60)).toBe(true);
});
