import { expect, it } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { connectedPaint } from '../packages/geometry/src/connected';
import { worldPaths } from '../packages/geometry/src/drawing';

function noisyCurve(): Vector {
  return {
    id: 'curve',
    kind: 'path',
    x: 30,
    y: 50,
    width: 360,
    height: 100,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#ff0000',
    strokeWidth: 3,
    points: Array.from({ length: 241 }, (_, i) => ({
      x: i * 1.5,
      y: Math.sin(i / 38) * 48 + Math.sin(i * 0.8) * 3,
      pressure: i / 240,
    })),
  };
}
it('Smooth fits a noisy 241-sample S stroke to at most ten editable anchors', () => {
  const input = noisyCurve(),
    before = clone(input),
    result = preparePencilDrawing([], { stroke: input, mode: 'smooth', merge: true });
  expect(input).toEqual(before);
  expect(result.shapes).toHaveLength(1);
  expect(result.shapes[0].kind).toBe('bezier');
  expect(result.shapes[0].nodes!.length).toBeLessThanOrEqual(10);
  const s = result.shapes[0],
    points = worldPaths(s, 0.05)
      .flat()
      .filter((p) => p.x > input.x + 20 && p.x < input.x + 340);
  const rms = Math.sqrt(
    points.reduce(
      (sum, p) => sum + (p.y - input.y - Math.sin((p.x - input.x) / 1.5 / 38) * 48) ** 2,
      0,
    ) / points.length,
  );
  expect(rms).toBeLessThan(1.5);
});
it('crossing an existing line retains compact cubic spans and exact connected junctions', () => {
  const input = noisyCurve(),
    vertical: Vector = {
      ...clone(input),
      id: 'cross',
      x: 210,
      y: -50,
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
    };
  const old = preparePencilDrawing([], { stroke: vertical, mode: 'straight', merge: true }).shapes;
  const result = preparePencilDrawing(old, { stroke: input, mode: 'smooth', merge: true }).shapes;
  expect(connectedPaint(result, result[0].id)).toHaveLength(result.length);
  const curves = result.filter((s) => s.kind === 'bezier');
  expect(curves.length).toBeGreaterThanOrEqual(2);
  expect(result.reduce((n, s) => n + (s.nodes?.length ?? s.points.length), 0)).toBeLessThanOrEqual(
    18,
  );
});
