import { connectedPaint } from '../packages/geometry/src/connected';
import { it, expect } from 'vitest';
import { inkContour, inkSegment, contourInkPlan } from '../packages/geometry/src/ink-contour';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import type { Vector } from '../packages/document/src';
const shape: Vector = {
  id: 'p',
  kind: 'polygon',
  x: 20,
  y: 30,
  width: 100,
  height: 100,
  rotation: 25,
  transform: [-1, 0.2, 0.3, 1],
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [],
  fillRule: 'evenodd',
  contours: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 20, y: 20, out: { x: 40, y: 15 } },
      { x: 80, y: 20, in: { x: 60, y: 15 } },
      { x: 80, y: 80 },
      { x: 20, y: 80 },
    ],
  ],
};
it('separates one affine hole stroke while preserving complete fill, curves and source', () => {
  const before = JSON.stringify(shape),
    p = mapPoint(matrix(shape), { x: 20, y: 50 });
  const parts = inkContour(shape, p, '#0000ff', 5)!;
  expect(parts).toHaveLength(3);
  expect(parts[0]).toEqual({ ...shape, strokeWidth: 0 });
  expect(parts[1].contours).toEqual([shape.contours![0]]);
  expect(parts[2].contours).toEqual([shape.contours![1]]);
  expect(parts[2]).toMatchObject({
    stroke: '#0000ff',
    strokeWidth: 5,
    fillEnabled: false,
    transform: shape.transform,
  });
  expect(new Set(parts.map((s) => s.id)).size).toBe(3);
  expect(JSON.stringify(shape)).toBe(before);
});
it('rejects misses/protected artwork and no-ops without splitting', () => {
  expect(inkContour(shape, mapPoint(matrix(shape), { x: 50, y: 50 }), '#0000ff', 5)).toBeNull();
  expect(
    inkContour(
      { ...shape, groups: ['g'] },
      mapPoint(matrix(shape), { x: 20, y: 50 }),
      '#0000ff',
      5,
    ),
  ).toBeNull();
  expect(
    inkContour(shape, mapPoint(matrix(shape), { x: 20, y: 50 }), shape.stroke, shape.strokeWidth),
  ).toBeNull();
});

it('repaints an already separated contour without multiplying objects or changing its identity', () => {
  const point = mapPoint(matrix(shape), { x: 20, y: 50 });
  const separated = inkContour(shape, point, '#0000ff', 5)!.at(-1)!;
  const again = inkContour(separated, point, '#00ff00', 3)!;
  expect(again).toHaveLength(1);
  expect(again[0].id).toBe(separated.id);
  expect(again[0].contours).toEqual(separated.contours);
  expect(separated.stroke).toBe('#0000ff');
});

it('splits a closing hole edge into exact cubic chains and preserves fill and other contours', () => {
  const p = mapPoint(matrix(shape), { x: 20, y: 50 }),
    before = JSON.stringify(shape);
  const parts = inkSegment(shape, p, '#0000ff', 3)!;
  expect(parts).toHaveLength(4);
  expect(parts[0]).toEqual({ ...shape, strokeWidth: 0 });
  expect(parts[1].contours).toEqual([shape.contours![0]]);
  expect(parts[2].nodes).toEqual(shape.contours![1]);
  expect(parts[3].nodes).toEqual([shape.contours![1][3], shape.contours![1][0]]);
  expect(parts[3]).toMatchObject({
    kind: 'bezier',
    stroke: '#0000ff',
    strokeWidth: 3,
    closed: false,
    strokeCap: 'butt',
    fillEnabled: false,
  });
  expect(parts[3].contours).toBeUndefined();
  expect(JSON.stringify(shape)).toBe(before);
  const again = inkSegment(parts[3], p, '#00ff00', 4)!;
  expect(again).toHaveLength(1);
  expect(again[0].id).toBe(parts[3].id);
});
it('preserves both sides when splitting an interior open path edge', () => {
  const path: Vector = {
    ...shape,
    kind: 'bezier',
    strokeCap: 'butt',
    contours: undefined,
    fillEnabled: false,
    nodes: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 0 },
    ],
  };
  const parts = inkSegment(path, mapPoint(matrix(path), { x: 45, y: 0 }), '#0000ff', 4)!;
  expect(parts.map((s) => s.nodes)).toEqual([
    [path.nodes![0], path.nodes![1]],
    [path.nodes![2], path.nodes![3]],
    [path.nodes![1], path.nodes![2]],
  ]);
});

it('retains selected cubic handles and rejects unsupported open cap styles', () => {
  const parts = inkSegment(shape, mapPoint(matrix(shape), { x: 50, y: 16.25 }), '#0000ff', 4)!;
  expect(parts.at(-1)!.nodes).toEqual(shape.contours![1].slice(0, 2));
  const open: Vector = {
    ...shape,
    kind: 'bezier',
    contours: undefined,
    nodes: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    closed: false,
  };
  expect(inkSegment(open, mapPoint(matrix(open), { x: 50, y: 0 }), '#0000ff', 4)).toBeNull();
});

it('connects touching contours without using disconnected boundaries as bridges', () => {
  const compound: Vector = { ...shape, x: 0, y: 0, rotation: 0, transform: undefined };
  const line: Vector = {
    id: 'line',
    kind: 'line',
    x: 20,
    y: 50,
    width: 30,
    height: 0,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
  };
  const art = [compound, line],
    before = JSON.stringify(art);
  const plan = contourInkPlan(art, compound.id, { x: 20, y: 50 });
  const connected = new Set(connectedPaint(plan.strokes, plan.target!).map((s) => s.id));
  expect(connected.size).toBe(2);
  const next = plan.apply(art, connected, '#0000ff', 4);
  expect(next).toHaveLength(4);
  expect(next[0]).toEqual({ ...compound, strokeWidth: 0 });
  expect(next[1].contours).toEqual([compound.contours![0]]);
  expect(next[1].stroke).toBe('#000000');
  expect(next[2].contours).toEqual([compound.contours![1]]);
  expect(next[2].stroke).toBe('#0000ff');
  expect(next[3].stroke).toBe('#0000ff');
  expect(JSON.stringify(art)).toBe(before);
  expect(plan.apply(art, connected, '#000000', 2)).toEqual(art);
});
