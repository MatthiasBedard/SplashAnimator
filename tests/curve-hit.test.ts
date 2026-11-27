import { it, expect } from 'vitest';
import type { Vector } from '../packages/document/src';
import { hitCurve } from '../packages/geometry/src/curve-hit';
import { insertAnchor } from '../packages/geometry/src/nodes';
import { inversePoint, matrix, mapPoint, type Matrix } from '../packages/geometry/src/affine';
const shape = (): Vector => ({
  id: 'hit',
  kind: 'bezier',
  x: 80,
  y: 60,
  width: 100,
  height: 100,
  rotation: 23,
  transform: [-1.4, 0.2, 0.35, 1.1],
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 20, y: 100 } },
    { x: 100, y: 0, in: { x: 80, y: 100 } },
  ],
});
it('finds affine cubic parameters and splits at the clicked position without source mutation during hit testing', () => {
  for (const t of [0.1, 0.3, 0.5, 0.8]) {
    const s = shape(),
      before = JSON.stringify(s),
      m = matrix(s),
      u = 1 - t;
    const point = mapPoint(m, {
      x: 3 * u * u * t * 20 + 3 * u * t * t * 80 + t * t * t * 100,
      y: 3 * u * t * 100,
    });
    const hit = hitCurve(s, point, 2)!;
    expect(hit.index).toBe(0);
    expect(hit.t).toBeCloseTo(t, 4);
    expect(JSON.stringify(s)).toBe(before);
    const index = insertAnchor(s, hit.index, hit.t)!;
    const actual = mapPoint(m, s.nodes![index]);
    expect(Math.hypot(actual.x - point.x, actual.y - point.y)).toBeLessThan(0.01);
  }
});
it('targets compound closing edges with flat indices and rejects misses and unsupported shapes', () => {
  const s = shape();
  s.kind = 'polygon';
  s.fillRule = 'evenodd';
  s.nodes = undefined;
  s.contours = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 30, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 60 },
      { x: 30, y: 60 },
    ],
  ];
  const point = mapPoint(matrix(s), { x: 30, y: 45 });
  const hit = hitCurve(s, point, 1)!;
  expect(hit.index).toBe(7);
  expect(hit.t).toBeCloseTo(0.5, 4);
  expect(insertAnchor(s, hit.index, hit.t)).toBe(8);
  expect(s.contours[0]).toHaveLength(4);
  expect(s.contours[1]).toHaveLength(5);
  expect(hitCurve(s, { x: 10000, y: 10000 }, 1)).toBeUndefined();
  expect(hitCurve(s, point, NaN)).toBeUndefined();
  s.kind = 'brush';
  expect(hitCurve(s, point, 2)).toBeUndefined();
});

it('measures projected edge distance without changing the authored curve parameter', () => {
  const s = { ...shape(), x: 0, y: 0, rotation: 0, transform: undefined,
    nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const view: Matrix = [1.25, 0, 0.5, 0.5, 100, 80];
  const cursor = { x: 162.5, y: 86 };
  expect(hitCurve(s, inversePoint(view, cursor), 7)).toBeUndefined();
  const hit = hitCurve(s, cursor, 7, view)!;
  expect(hit.index).toBe(0);
  expect(hit.t).toBeCloseTo(0.5, 4);
  expect(hitCurve(s, { ...cursor, y: 87.25 }, 7, view)).toBeUndefined();
  expect(hitCurve(s, cursor, 7, [1, 0, 0, 1, Infinity, 0])).toBeUndefined();
});
