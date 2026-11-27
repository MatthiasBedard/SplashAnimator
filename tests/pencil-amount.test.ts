import { it, expect } from 'vitest';
import { type Vector } from '../packages/document/src';
import { fitPencilStroke } from '../packages/geometry/src/pencil-fit';
import { smoothPencilStroke } from '../packages/geometry/src/pencil';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { worldPoint } from '../packages/geometry/src';

function stroke(): Vector {
  return {
    id: 'new',
    kind: 'path',
    x: 30,
    y: 50,
    width: 300,
    height: 70,
    rotation: 0,
    fill: '#123456',
    fillEnabled: false,
    stroke: '#ff0000',
    strokeWidth: 3,
    points: Array.from({ length: 181 }, (_, i) => ({
      x: i * 1.5,
      y: Math.sin(i / 28) * 35 + Math.sin(i * 1.3) * 3,
      pressure: 0.2 + i / 225,
    })),
  };
}
it('keeps omitted and 50 percent exactly compatible with the existing kernels', () => {
  const s = stroke();
  expect(fitPencilStroke(s, 50)).toEqual(fitPencilStroke(s));
  expect(smoothPencilStroke(s, true, 1)).toEqual(smoothPencilStroke(s, true));
  for (const merge of [false, true])
    expect(preparePencilDrawing([], { stroke: s, mode: 'smooth', merge, smoothing: 50 })).toEqual(
      preparePencilDrawing([], { stroke: s, mode: 'smooth', merge }),
    );
});
it('zero percent is exact unsmoothed Ink output', () => {
  const s = stroke();
  for (const merge of [false, true])
    expect(preparePencilDrawing([], { stroke: s, mode: 'smooth', merge, smoothing: 0 })).toEqual(
      preparePencilDrawing([], { stroke: s, mode: 'ink', merge }),
    );
});
it('increasing smoothing changes the new curve and reduces noisy capture vertices', () => {
  const s = stroke(),
    low = fitPencilStroke(s, 5),
    normal = fitPencilStroke(s, 50),
    high = fitPencilStroke(s, 100);
  expect(low.nodes!.length).toBeGreaterThan(normal.nodes!.length);
  expect(high.nodes!.length).toBeLessThanOrEqual(normal.nodes!.length);
  expect(high).not.toEqual(normal);
});
for (const amount of [1, 25, 50, 75, 100, 150, 200])
  it(`${amount} percent retains contact endpoints, paint and detached input metadata`, () => {
    const s = stroke();
    s.transform = [-1, 0.2, 0.3, 0.8];
    const before = structuredClone(s),
      out = fitPencilStroke(s, amount);
    expect(worldPoint(out, out.nodes![0])).toEqual(worldPoint(s, s.points[0]));
    const end = worldPoint(out, out.nodes!.at(-1)!),
      expected = worldPoint(s, s.points.at(-1)!);
    expect(end.x).toBeCloseTo(expected.x, 10);
    expect(end.y).toBeCloseTo(expected.y, 10);
    expect(out.nodes![0].pressure).toBe(s.points[0].pressure);
    expect(out.nodes!.at(-1)!.pressure).toBe(s.points.at(-1)!.pressure);
    expect(out.stroke).toBe(s.stroke);
    expect(out.strokeWidth).toBe(3);
    expect(s).toEqual(before);
  });
for (const amount of [-1, 201, NaN, Infinity, '50', null])
  it(`rejects invalid raw percentage ${amount}`, () => {
    const s = stroke(),
      before = structuredClone(s);
    expect(() => fitPencilStroke(s, amount as number)).toThrow(/smoothing/);
    expect(() =>
      preparePencilDrawing([], {
        stroke: s,
        mode: 'smooth',
        merge: true,
        smoothing: amount as number,
      }),
    ).toThrow();
    expect(s).toEqual(before);
  });
it('never smooths previous artwork when a stronger new stroke is merged', () => {
  const old = fitPencilStroke(stroke(), 5);
  old.id = 'previous';
  old.drawingMode = 'merge';
  old.y += 250;
  const before = structuredClone(old),
    incoming = stroke();
  const out = preparePencilDrawing([old], {
    stroke: incoming,
    mode: 'smooth',
    merge: true,
    smoothing: 200,
  });
  expect(out.shapes.find((s) => s.id === 'previous')).toEqual(before);
  expect(old).toEqual(before);
  expect(out.shape).toEqual({ ...fitPencilStroke(incoming, 200), drawingMode: 'merge' });
});
it('Off and Straight keep their existing behavior regardless of the retained percentage', () => {
  const s = stroke();
  for (const mode of ['ink', 'straight'] as const)
    for (const smoothing of [0, 25, 100])
      expect(preparePencilDrawing([], { stroke: s, mode, merge: false, smoothing })).toEqual(
        preparePencilDrawing([], { stroke: s, mode, merge: false }),
      );
});

it('200 percent applies stronger incoming simplification than 100 without changing the existing default', () => {
  const s = stroke(),
    before = structuredClone(s),
    normal = fitPencilStroke(s, 100),
    strong = fitPencilStroke(s, 200);
  expect(strong).not.toEqual(normal);
  expect(strong.nodes!.length).toBeLessThanOrEqual(normal.nodes!.length);
  expect(s).toEqual(before);
  expect(() => smoothPencilStroke(s, true, 4.01)).toThrow();
});
