import { it, expect } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { worldPaths, pathCommands, type CurveTrace } from '../packages/geometry/src/drawing';
import { mergeVectors } from '../packages/geometry/src/merge';
import { splitCubic, type Cubic } from '../packages/geometry/src/curve-fit';
import { mergedStrokeNodes } from '../packages/geometry/src/stroke-curves';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { connectedPaint } from '../packages/geometry/src/connected';

function arch(): Vector {
  return {
    id: 'arch',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    stroke: '#ff0000',
    strokeWidth: 3,
    fill: '#000000',
    fillEnabled: false,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 100 / 3, y: 60 } },
      { x: 100, y: 0, in: { x: 200 / 3, y: 60 } },
    ],
  };
}
for (const transform of [
  [1, 0, 0, 1],
  [-2, 0.25, 0.5, 3],
  [2, 0.25, 0.5, 3],
] as const)
  it(`tracing retains exact old subdivision points and contiguous original parameters under ${transform}`, () => {
    const source = arch();
    source.transform = [...transform];
    source.x = 1000;
    source.y = -300;
    const traces: { point: { x: number; y: number }; trace: CurveTrace }[] = [];
    expect(worldPaths(source, 0.25, (point, trace) => traces.push({ point, trace }))).toEqual(
      worldPaths(source, 0.25),
    );
    expect(traces.length).toBeGreaterThan(4);
    expect(traces[0].trace.start).toBe(0);
    expect(traces.at(-1)!.trace.end).toBe(1);
    for (let i = 0; i < traces.length; i++) {
      const { point, trace } = traces[i],
        end = trace.end === 1 ? trace.curve[3] : splitCubic(trace.curve, trace.end)[0][3];
      expect(point.x).toBeCloseTo(end.x, 10);
      expect(point.y).toBeCloseTo(end.y, 10);
      if (i) {
        expect(trace.start).toBe(traces[i - 1].trace.end);
        expect(trace.curve).toBe(traces[i - 1].trace.curve);
      }
    }
  });
it('curve retention is explicit; the omitted/false merge path stays exact', () => {
  const s = arch(),
    line: Vector = {
      ...clone(s),
      id: 'line',
      kind: 'path',
      nodes: undefined,
      points: [
        { x: 50, y: -20 },
        { x: 50, y: 80 },
      ],
    };
  const strip = (shapes: Vector[]) => shapes.map(({ id: _id, ...shape }) => shape);
  expect(strip(mergeVectors([s, line]))).toEqual(strip(mergeVectors([s, line], undefined, false)));
  expect(mergeVectors([s, line]).every((s) => s.kind === 'path')).toBe(true);
});
it('an analytic half-curve crossing keeps original cubic controls and exact junctions', () => {
  const source = arch(),
    before = clone(source),
    line: Vector = {
      ...clone(source),
      id: 'line',
      kind: 'path',
      nodes: undefined,
      points: [
        { x: 50, y: -20 },
        { x: 50, y: 80 },
      ],
    };
  const result = mergeVectors([source, line], undefined, true);
  expect(source).toEqual(before);
  expect(result).toHaveLength(4);
  expect(connectedPaint(result, result[0].id)).toHaveLength(4);
  const curves = result.filter((s) => s.kind === 'bezier');
  expect(curves).toHaveLength(2);
  expect(curves.every((s) => s.nodes!.length === 2)).toBe(true);
  const root: Cubic = [
    { x: 0, y: 0 },
    { x: 100 / 3, y: 60 },
    { x: 200 / 3, y: 60 },
    { x: 100, y: 0 },
  ];
  const expected = splitCubic(root, 0.5);
  for (const s of curves) {
    const n = s.nodes!,
      m = matrix(s),
      points = [
        mapPoint(m, n[0]),
        mapPoint(m, n[0].out!),
        mapPoint(m, n[1].in!),
        mapPoint(m, n[1]),
      ];
    const e =
      points[0].x < points.at(-1)!.x
        ? points[0].x === 0
          ? expected[0]
          : expected[1]
        : [...(points.at(-1)!.x === 0 ? expected[0] : expected[1])].reverse();
    for (let i = 0; i < 4; i++) {
      expect(points[i].x).toBeCloseTo(e[i].x, 10);
      expect(points[i].y).toBeCloseTo(e[i].y, 10);
    }
  }
});
it('reverse subdivision spans reassemble as one exact reversed cubic', () => {
  const source = arch(),
    curve: Cubic = [
      { x: 0, y: 0 },
      { x: 100 / 3, y: 60 },
      { x: 200 / 3, y: 60 },
      { x: 100, y: 0 },
    ],
    mid = splitCubic(curve, 0.5)[0][3];
  const nodes = mergedStrokeNodes(
    [
      { a: curve[3], b: mid, curve: { curve, start: 1, end: 0.5 } },
      { a: mid, b: curve[0], curve: { curve, start: 0.5, end: 0 } },
    ],
    source,
    false,
  )!;
  expect(nodes).toHaveLength(2);
  expect(nodes[0]).toEqual({ ...curve[3], out: curve[2] });
  expect(nodes[1]).toEqual({ ...curve[0], in: curve[1] });
});
it('closed cubic seam retains its closing handle without a duplicate anchor', () => {
  const source = arch(),
    curve: Cubic = [
      { x: 0, y: 0 },
      { x: 50, y: 60 },
      { x: -50, y: 60 },
      { x: 0, y: 0 },
    ];
  const nodes = mergedStrokeNodes(
    [{ a: curve[0], b: curve[3], curve: { curve, start: 0, end: 1 } }],
    source,
    true,
  )!;
  expect(nodes).toEqual([{ x: 0, y: 0, out: curve[1], in: curve[2] }]);
  expect(pathCommands({ ...source, nodes, closed: true }).at(-1)).toEqual(['Z']);
});
