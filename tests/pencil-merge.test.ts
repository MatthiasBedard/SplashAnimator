import { it, expect } from 'vitest';
import { clone, MAX_VECTOR_POINTS, type Vector } from '../packages/document/src';
import { preparePencilDrawing, prepareWorkerPencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing, prepareWorkerShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { smoothPencilStroke } from '../packages/geometry/src/pencil';
import { mergeVectors } from '../packages/geometry/src/merge';
import { connectedPaint } from '../packages/geometry/src/connected';

function stroke(): Vector {
  return {
    id: 'new',
    kind: 'path',
    x: 30,
    y: 50,
    width: 200,
    height: 30,
    rotation: 0,
    fill: '#000000',
    stroke: '#ff0000',
    strokeWidth: 3,
    points: Array.from({ length: 81 }, (_, i) => ({
      x: i * 2.5,
      y: Math.sin(i / 12) * 12 + (i % 2 ? 0.3 : -0.3),
      pressure: i / 80,
    })),
  };
}

it('keeps Pencil and shape worker preparation equivalent on merged and isolated artwork', () => {
  const previous = preparePencilDrawing([], { stroke: stroke(), mode: 'smooth', merge: true }).shape;
  previous.y = -200;
  const input = [previous];
  const original = structuredClone(input);
  for (const merge of [true, false]) {
    const pencil = { stroke: { ...stroke(), id: 'incoming' }, mode: 'smooth', merge } as const;
    const shape = { shape: { ...stroke(), id: 'primitive', kind: 'ellipse', points: [] } as Vector, merge };
    const ink = prepareWorkerPencilDrawing(structuredClone(input), pencil);
    expect(ink).toEqual(preparePencilDrawing(input, pencil));
    if (merge) expect(ink.shapes?.[0]).toEqual(previous);
    const worker = prepareWorkerShapeDrawing(structuredClone(input), shape);
    const normal = prepareShapeDrawing(input, shape);
    const compare = (result: typeof worker) => ({ ...result,
      shapes: result.shapes.map(s => s.id === previous.id || s.id === shape.shape.id ? s : { ...s, id: 'new piece' }),
    });
    expect(compare(worker)).toEqual(compare(normal));
  }
  expect(input).toEqual(original);
});

it('rejects nonfinite and sparse original artwork on the worker route before rebuilding', () => {
  const incoming = { ...stroke(), id: 'incoming' };
  for (const previous of [
    { ...stroke(), points: [{ x: NaN, y: 0 }] },
    { ...stroke(), points: Array(3) },
  ]) {
    expect(() => prepareWorkerPencilDrawing([previous], { stroke: incoming, mode: 'ink', merge: true })).toThrow();
    expect(() => prepareWorkerShapeDrawing([previous], { shape: incoming, merge: true })).toThrow();
  }
});

it('turns dense input into a compact unfilled editable curve with exact endpoints and smooth tangent directions', () => {
  const input = stroke(),
    before = clone(input),
    result = preparePencilDrawing([], { stroke: input, mode: 'smooth', merge: true });
  expect(input).toEqual(before);
  expect(result.shapes).toEqual([result.shape]);
  const s = result.shapes[0];
  expect(s.kind).toBe('bezier');
  expect(s.fillEnabled).toBe(false);
  expect(s.drawingMode).toBe('merge');
  expect(s.nodes!.length).toBeLessThan(20);
  expect(s.nodes!.length).toBeGreaterThan(2);
  for (const [n, i] of [
    [s.nodes![0], 0],
    [s.nodes!.at(-1)!, 80],
  ] as const) {
    expect(n.x + s.x).toBeCloseTo(input.points[i].x + input.x, 10);
    expect(n.y + s.y).toBeCloseTo(input.points[i].y + input.y, 10);
    expect(n.pressure).toBe(input.points[i].pressure);
  }
  for (const n of s.nodes!.slice(1, -1)) {
    const ax = n.x - n.in!.x,
      ay = n.y - n.in!.y,
      bx = n.out!.x - n.x,
      by = n.out!.y - n.y;
    expect((ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by)).toBeGreaterThan(
      Math.cos(Math.PI / 180),
    );
  }
  for (let i = 1; i < s.nodes!.length; i++) {
    const a = s.nodes![i - 1],
      b = s.nodes![i];
    expect(a.out!.x).toBeGreaterThanOrEqual(a.x);
    expect(a.out!.x).toBeLessThanOrEqual(b.in!.x);
    expect(b.in!.x).toBeLessThanOrEqual(b.x);
  }
});
for (const transform of [
  [1, 0, 0, 1],
  [-2, 0.25, 0.5, 3],
  [2, 0.25, 0.5, 3],
] as const)
  it(`retains disjoint previously merged curves and metadata exactly under ${transform}`, () => {
    const old = preparePencilDrawing([], { stroke: stroke(), mode: 'smooth', merge: true }).shape;
    old.id = 'old';
    old.transform = [...transform];
    old.y = -200;
    const before = clone(old),
      fresh = stroke();
    fresh.y = 400;
    const result = preparePencilDrawing([old], { stroke: fresh, mode: 'smooth', merge: true });
    expect(result.shapes.find((s) => s.id === 'old')).toEqual(before);
    expect(old).toEqual(before);
    expect(result.shapes.at(-1)!.kind).toBe('bezier');
  });
it('crossing strokes become a shared intersection network, not two whole objects', () => {
  const a = stroke();
  a.points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  a.x = 0;
  a.y = 0;
  const first = preparePencilDrawing([], { stroke: a, mode: 'smooth', merge: true }).shapes;
  const b = clone(a);
  b.id = 'vertical';
  b.x = 50;
  b.y = -50;
  b.points = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ];
  const result = preparePencilDrawing(first, { stroke: b, mode: 'smooth', merge: true });
  expect(result.shapes).toHaveLength(4);
  expect(connectedPaint(result.shapes, result.shapes[0].id)).toHaveLength(4);
  expect(
    result.shapes.every((s) => s.id !== a.id && s.id !== b.id && s.fillEnabled === false),
  ).toBe(true);
  expect(
    result.shapes.every((s) =>
      (s.nodes ?? s.points).some((p) => p.x + s.x === 50 && p.y + s.y === 0),
    ),
  ).toBe(true);
});
for (const nodes of [
  [
    { x: 0, y: 0, out: { x: 50, y: 50 } },
    { x: 50, y: 0, in: { x: 0, y: 50 }, out: { x: 0, y: -50 } },
    { x: 0, y: 0, in: { x: 50, y: -50 } },
  ],
  [
    { x: 0, y: 0, out: { x: 50, y: 0 } },
    { x: 20, y: 0, in: { x: -30, y: 0 } },
  ],
])
  it('loops and reversing control hulls retain the existing arrangement path', () => {
    const curve: Vector = {
      ...stroke(),
      kind: 'bezier',
      points: [],
      nodes,
      fillEnabled: false,
      drawingMode: 'merge',
    };
    const legacy = clone(curve);
    delete legacy.drawingMode;
    const strip = (items: Vector[]) => items.map(({ id: _id, ...s }) => s);
    expect(strip(mergeVectors([curve]))).toEqual(strip(mergeVectors([legacy])));
  });
it('reduces a full admitted straight capture without truncating its late endpoint', () => {
  const input = stroke();
  input.points = Array.from({ length: MAX_VECTOR_POINTS }, (_, i) => ({
    x: i,
    y: 0,
    pressure: i / MAX_VECTOR_POINTS,
  }));
  const result = preparePencilDrawing([], { stroke: input, mode: 'smooth', merge: true }).shape;
  expect(result.nodes).toHaveLength(2);
  expect(result.nodes!.at(-1)!.x + result.x).toBe(input.x + MAX_VECTOR_POINTS - 1);
  expect(result.nodes!.at(-1)!.pressure).toBe(input.points.at(-1)!.pressure);
});
it('legacy smoothing remains opt-in compatible and retains every captured anchor', () => {
  const input = stroke();
  expect(smoothPencilStroke(input).nodes).toHaveLength(input.points.length);
  expect(smoothPencilStroke(input, true).nodes!.length).toBeLessThan(input.points.length / 2);
});

it('optional simplification work exhaustion keeps all smoothed anchors instead of rejecting or truncating ink', () => {
  const input = stroke();
  input.points = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: i % 4 < 2 ? 20 : -20 }));
  const original = clone(input),
    legacy = smoothPencilStroke(input),
    reduced = smoothPencilStroke(input, true);
  expect(reduced.nodes).toHaveLength(input.points.length);
  expect(reduced.nodes!.map((n) => [n.x + reduced.x, n.y + reduced.y])).toEqual(
    legacy.nodes!.map((n) => [n.x + legacy.x, n.y + legacy.y]),
  );
  expect(input).toEqual(original);
});
it('large finite translated ink bypasses optional reduction without a new coordinate rejection', () => {
  const input = stroke();
  input.x = 1e13;
  const result = smoothPencilStroke(input, true);
  expect(result.nodes).toHaveLength(input.points.length);
  expect(result.nodes!.at(-1)!.x + result.x).toBe(input.x + 200);
});
it('collinear overlap removes duplicate stroke coverage rather than preserving two objects', () => {
  const first = stroke();
  first.x = 0;
  first.y = 0;
  first.points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const old = preparePencilDrawing([], { stroke: first, mode: 'straight', merge: true }).shapes;
  const second = clone(first);
  second.id = 'overlap';
  second.x = 50;
  const result = preparePencilDrawing(old, {
    stroke: second,
    mode: 'straight',
    merge: true,
  }).shapes;
  expect(connectedPaint(result, result[0].id)).toHaveLength(result.length);
  const length = result.reduce(
    (sum, s) =>
      sum +
      s.points
        .slice(1)
        .reduce((n, p, i) => n + Math.hypot(p.x - s.points[i].x, p.y - s.points[i].y), 0),
    0,
  );
  expect(length).toBe(150);
});
