import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { hit } from '../packages/geometry/src';
import { pathCommands } from '../packages/geometry/src/drawing';

const oval: Vector = { id: 'oval', kind: 'ellipse', x: 60, y: 45, width: 140, height: 105,
  fill: '#0088ff', stroke: '#000000', strokeWidth: 3, rotation: 0, points: [], drawingMode: 'merge' };
const line: Vector = { ...oval, kind: 'path', id: 'pencil', fillEnabled: false, stroke: '#aa2200',
  x: 15, y: 86, width: 250, height: 9, points: [{ x: 0, y: 0 }, { x: 250, y: 9 }] };

for (const removeCoveredStrokes of [true, false]) {
  it(`cuts a Pencil line when an outlined ellipse is drawn over it (remove covered lines: ${removeCoveredStrokes})`, () => {
    const result = prepareShapeDrawing([line], { shape: oval, merge: true, removeCoveredStrokes });
    expect(result.retainedOverlap).toBeUndefined();
    const ink = result.shapes.filter(s => s.strokeWidth && s.stroke === line.stroke);
    expect(ink).toHaveLength(removeCoveredStrokes ? 2 : 3);
    const paint = result.shapes.filter(s => !s.strokeWidth);
    expect(paint).toHaveLength(removeCoveredStrokes ? 1 : 2);
    for (const p of [{ x: 125, y: 62 }, { x: 130, y: 130 }]) expect(paint.filter(s => hit(s, p, 0))).toHaveLength(1);
    expect(paint.flatMap(s => pathCommands(s)).filter(c => c[0] === 'C')).toHaveLength(6);
    const border = result.shapes.filter(s => s.strokeWidth && s.stroke === oval.stroke);
    expect(border).toHaveLength(2);
    expect(border.every(s => s.kind === 'bezier' && s.fillEnabled === false)).toBe(true);
  });
  it(`cuts two overlapping outlined ellipses on release (remove covered lines: ${removeCoveredStrokes})`, () => {
    const old = prepareShapeDrawing([], { shape: oval, merge: true }).shapes;
    const next = { ...oval, id: 'top', x: 130, y: 66, fill: '#00aa44', stroke: '#881144' };
    const result = prepareShapeDrawing(old, { shape: next, merge: true, removeCoveredStrokes });
    expect(result.retainedOverlap).toBeUndefined();
    const lower = result.shapes.filter(s => !s.strokeWidth && s.fill === oval.fill);
    const upper = result.shapes.filter(s => !s.strokeWidth && s.fill === next.fill);
    expect(lower).toHaveLength(1);
    expect(hit(lower[0], { x: 159, y: 110 }, 0)).toBe(false);
    expect(upper).toHaveLength(removeCoveredStrokes ? 1 : 2);
    expect(result.shapes.filter(s => s.strokeWidth && s.stroke === oval.stroke)).toHaveLength(removeCoveredStrokes ? 1 : 2);
    expect(result.shapes.filter(s => s.strokeWidth && s.stroke === next.stroke)).toHaveLength(2);
  });
}
