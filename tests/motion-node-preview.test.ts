import { expect, it } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import {
  prepareMotionNodePreview,
  editMotionNodeHint,
  motionNodeDrawing,
} from '../apps/editor/src/motion-node-preview';

const shape: Vector = {
  id: 'a',
  kind: 'bezier',
  x: 100,
  y: 200,
  rotation: 30,
  width: 100,
  height: 100,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 1,
  points: [],
  nodes: [
    { x: 0, y: 0 },
    { x: 25, y: 0 },
    { x: 50, y: 10 },
    { x: 100, y: 0 },
  ],
};

it('adds sorted visual hints and removes them without mutating artwork or the previous model', () => {
  const before = clone(shape);
  const model = prepareMotionNodePreview(shape, shape, '2:2', true, false, false);
  expect(editMotionNodeHint(model, 0, [1, 1])).toBe('1:1, 2:2');
  expect(model.hints).toEqual([[[2, 2]]]);
  expect(editMotionNodeHint(model, 0, [2, 2], true)).toBe('');
  for (const pair of [
    [1, 2],
    [2, 1],
    [0, 0],
    [3, 3],
    [NaN, 1],
  ] as [number, number][])
    expect(() => editMotionNodeHint(model, 0, pair)).toThrow();
  model.rings[0][0][1].x = 900;
  model.source.nodes![0].x = 800;
  expect(shape).toEqual(before);
});

it('numbers target anchors after contour order, offset and direction and keeps other contour hints', () => {
  const p: Vector = {
    ...shape,
    kind: 'polygon',
    contours: [shape.nodes!, shape.nodes!.map((p) => ({ x: p.x, y: p.y + 100 }))],
  };
  const model = prepareMotionNodePreview(
    p,
    p,
    '; 1:2',
    true,
    false,
    false,
    [1, 0],
    [true, false],
    [1, 0],
  );
  expect(model.rings[1][0].map((p) => [p.x, p.y])).toEqual([
    [25, 100],
    [0, 100],
    [100, 100],
    [50, 110],
  ]);
  expect(editMotionNodeHint(model, 0, [3, 3])).toBe('3:3; 1:2');
  expect(model.hints[1]).toEqual([[1, 2]]);
});

it('previews cubic handles and validates curved distance hints with original missing-handle semantics', () => {
  const p = clone(shape);
  p.nodes![0].out = { x: 0, y: 60 };
  p.nodes![1].in = { x: 25, y: 60 };
  const model = prepareMotionNodePreview(p, p, '', false, true, true);
  expect(editMotionNodeHint(model, 0, [1, 1])).toBe('1:1');
  const drawing = motionNodeDrawing(model.rings[0][0], false);
  expect(drawing.path).toContain('C 20 116 60 116 60 20');
  expect(drawing.anchors[3]).toEqual({ x: 180, y: 20 });
  expect(p.nodes![2].in).toBeUndefined();
  p.nodes![0].out!.x = NaN;
  expect(() => prepareMotionNodePreview(p, p, '', false, true, true)).toThrow();
});

it('rejects unavailable endpoints, conflicting modes and unresolved preview bounds', () => {
  expect(() => prepareMotionNodePreview(undefined, shape, '', true, false, false)).toThrow();
  expect(() => prepareMotionNodePreview(shape, shape, '', true, true, false)).toThrow();
  expect(() => prepareMotionNodePreview(shape, shape, 'bad', true, false, false)).toThrow();
  expect(() =>
    motionNodeDrawing(
      [
        { x: -1e308, y: 0 },
        { x: 1e308, y: 0 },
      ],
      false,
    ),
  ).toThrow();
});

it('projects stage anchors and controls through the complete endpoint affine pose', () => {
  const p = clone(shape);
  p.x = 80;
  p.y = 40;
  p.rotation = 90;
  p.transform = [2, 0, 1, 3];
  p.nodes![0].out = { x: 5, y: 10 };
  const before = clone(p);
  const result = motionNodeDrawing(p.nodes!, false, p);
  // R90 * [2 1; 0 3] gives world (80 - 3*y, 40 + 2*x + y).
  expect(result.anchors[1].x).toBeCloseTo(80, 12);
  expect(result.anchors[1].y).toBeCloseTo(90, 12);
  expect(result.anchors[2].x).toBeCloseTo(50, 12);
  expect(result.anchors[2].y).toBeCloseTo(150, 12);
  expect(result.path).toContain('C 50 60');
  expect(p).toEqual(before);
  p.transform[0] = Infinity;
  expect(() => motionNodeDrawing(p.nodes!, false, p)).toThrow('unresolved');
  p.transform = [1e308, 0, 0, 1];
  expect(() => motionNodeDrawing(p.nodes!, false, p)).toThrow('unresolved');
});

it('retargets one existing pair and preserves both pairs after a conflicting or stale edit', () => {
  const model = prepareMotionNodePreview(shape, shape, '1:1, 2:2', true, false, false);
  expect(() => editMotionNodeHint(model, 0, [1, 2], false, [1, 1])).toThrow();
  expect(() => editMotionNodeHint(model, 0, [1, 1], false, [2, 1])).toThrow(/changed/);
  expect(model.hints).toEqual([[[1,1],[2,2]]]);
});
