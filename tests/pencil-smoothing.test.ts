import { expect, it } from 'vitest';
import { smoothPencilStroke } from '../packages/geometry/src/pencil';
import { pathCommands } from '../packages/geometry/src/drawing';
import { MAX_VECTOR_POINTS, clone, type Vector } from '../packages/document/src';
function stroke(): Vector {
  return {
    id: 'pencil',
    kind: 'path',
    x: 20,
    y: 30,
    width: 40,
    height: 20,
    rotation: 0,
    fill: '#123456',
    fillEnabled: false,
    stroke: '#112233',
    strokeWidth: 3,
    points: [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 10, y: 11, pressure: 0.4 },
      { x: 20, y: -1, pressure: 0.6 },
      { x: 30, y: 10, pressure: 0.8 },
      { x: 40, y: 0, pressure: 1 },
    ],
  };
}
it('creates editable C1 cubic strokes with exact endpoints, preserved paint and detached metadata', () => {
  const source = stroke(),
    before = clone(source),
    result = smoothPencilStroke(source);
  expect(source).toEqual(before);
  expect(result).toMatchObject({
    id: 'pencil',
    kind: 'bezier',
    fillEnabled: false,
    stroke: '#112233',
    strokeWidth: 3,
    points: [],
  });
  expect(result.nodes).toHaveLength(source.points.length);
  const world = (n: { x: number; y: number }) => ({ x: n.x + result.x, y: n.y + result.y });
  expect(world(result.nodes![0])).toEqual({ x: 20, y: 30 });
  expect(world(result.nodes!.at(-1)!)).toEqual({ x: 60, y: 30 });
  expect(result.nodes!.map((p) => p.pressure)).toEqual(source.points.map((p) => p.pressure));
  for (const n of result.nodes!.slice(1, -1)) {
    expect(n.x - n.in!.x).toBeCloseTo(n.out!.x - n.x, 12);
    expect(n.y - n.in!.y).toBeCloseTo(n.out!.y - n.y, 12);
  }
  expect(pathCommands(result).filter((c) => c[0] === 'C')).toHaveLength(4);
  result.nodes![1].x = 1000;
  expect(source).toEqual(before);
});
it('keeps straight two-point input straight and does not resmooth any earlier artwork', () => {
  const source = stroke();
  source.points = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
  ];
  const other = stroke(),
    before = clone(other),
    result = smoothPencilStroke(source);
  expect(result.nodes!.every((n) => n.y === 0)).toBe(true);
  expect(result.nodes![0].out!.x).toBe(10);
  expect(other).toEqual(before);
});
it('retains all 100000 admitted anchors and the complete late tail', () => {
  const source = stroke();
  source.points = Array.from({ length: MAX_VECTOR_POINTS }, (_, i) => ({
    x: i,
    y: (i % 3) / 10,
    pressure: (i % 10) / 10,
  }));
  const result = smoothPencilStroke(source);
  expect(result.nodes).toHaveLength(MAX_VECTOR_POINTS);
  const last = result.nodes!.at(-1)!;
  expect(last.x + result.x).toBe(source.x + source.points.at(-1)!.x);
  expect(last.pressure).toBe(source.points.at(-1)!.pressure);
});
it('rejects invalid, overflowing and over-budget input without mutation', () => {
  for (const points of [
    [{ x: 0, y: 0 }],
    [
      { x: NaN, y: 0 },
      { x: 1, y: 0 },
    ],
    [
      { x: 1e308, y: 0 },
      { x: 1e308, y: 0 },
      { x: 1e308, y: 0 },
    ],
    Array.from({ length: MAX_VECTOR_POINTS + 1 }, () => ({ x: 0, y: 0 })),
  ]) {
    const source = stroke();
    source.points = points;
    const before = structuredClone(source);
    expect(() => smoothPencilStroke(source)).toThrow();
    expect(source).toEqual(before);
  }
});
