import { describe, it, expect } from 'vitest';
import { id, clone, type Vector } from '../packages/document/src';
import { brushPaint } from '../packages/geometry/src/brush-paint';
import { hit, transformVectors, around } from '../packages/geometry/src';
const box = (x = 0): Vector => ({
  id: id(),
  kind: 'rectangle',
  x,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 8,
  points: [],
});
const brush = (): Vector => ({
  ...box(-20),
  kind: 'brush',
  y: 50,
  fill: '#00ff00',
  strokeWidth: 30,
  points: [
    { x: 0, y: 0, pressure: 0.2 },
    { x: 240, y: 0, pressure: 1 },
  ],
  brush: { pressure: true, minimum: 0.1, aspect: 1, tilt: false, angle: 0 },
});
const painted = (shapes: Vector[], x: number, y = 50) => shapes.some((s) => hit(s, { x, y }, 0));
describe('brush paint constraints', () => {
  it('paints fills and empty space while preserving their outlines and source data', () => {
    const shapes = [box(), box(110)],
      b = brush(),
      before = clone(shapes),
      samples = clone(b);
    const out = brushPaint(shapes, b, 'fills');
    expect(painted(out, 50)).toBe(true);
    expect(painted(out, 105)).toBe(true);
    expect(painted(out, 1)).toBe(false);
    expect(painted(out, 170, 60)).toBe(true);
    expect(painted(out, 20, 60)).toBe(false);
    expect(shapes).toEqual(before);
    expect(b).toEqual(samples);
  });
  it('paints only selected fills and does nothing for an empty selection', () => {
    const a = box(),
      b = box(110);
    const out = brushPaint([a, b], brush(), 'selection', [a.id]);
    expect(painted(out, 50)).toBe(true);
    expect(painted(out, 160)).toBe(false);
    expect(brushPaint([a, b], brush(), 'selection')).toEqual([]);
  });
  it('anchors inside paint at the first sample and leaves samples intact in normal/behind modes', () => {
    const a = box(),
      b = box(110),
      stroke = brush();
    stroke.x = 20;
    const out = brushPaint([a, b], stroke, 'inside');
    expect(painted(out, 50)).toBe(true);
    expect(painted(out, 160)).toBe(false);
    const outside = brushPaint([a, b], brush(), 'inside');
    expect(painted(outside, -10)).toBe(true);
    expect(painted(outside, 50)).toBe(false);
    expect(painted(outside, 105)).toBe(true);
    expect(brushPaint([a], stroke, 'normal')[0]).toBe(stroke);
    expect(brushPaint([a], stroke, 'behind')[0]).toBe(stroke);
  });
  it('clips against transformed fills in stage coordinates', () => {
    const a = box();
    transformVectors([a], around({ x: 0, y: 0 }, 1, 0, 0.5, 1));
    const out = brushPaint([a], brush(), 'selection', [a.id]);
    expect(painted(out, 10)).toBe(false);
    expect(painted(out, 50)).toBe(true);
  });
});

it('fills and inside paint can begin on an empty layer', () => {
  for (const mode of ['fills', 'inside'] as const)
    expect(painted(brushPaint([], brush(), mode), 50)).toBe(true);
});
