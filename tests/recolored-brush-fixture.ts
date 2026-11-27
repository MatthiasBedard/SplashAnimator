import { type Vector } from '../packages/document/src';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';

export function recoloredBrushFixture() {
  const base: Vector = { id: 'base', kind: 'rectangle', x: 100, y: 100, width: 145, height: 145,
    rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge', cornerRadius: 24 };
  const brush: Vector = { ...base, id: 'brush', x: 150, y: 135, width: 140, height: 50, kind: 'brush',
    cornerRadius: undefined, fill: '#ff0000', strokeWidth: 30,
    points: [{ x: 0, y: 0 }, { x: 34, y: 10 }, { x: 66, y: 33 }, { x: 105, y: 27 }, { x: 140, y: 21 }],
    brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 } };
  const shapes = commitBrushPaint([base], { brush, amount: 1, merge: true, mode: 'normal', optimize: true,
    selected: [], at: 1 });
  return { shapes, color: base.fill, foreground: shapes.find(shape => shape.fill === brush.fill)! };
}
