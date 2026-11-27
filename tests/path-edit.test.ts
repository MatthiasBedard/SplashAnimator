import { it, expect } from 'vitest';
import { clone, type Point, type Vector } from '../packages/document/src';
import { smoothPath, simplifyPath, preparePathSimplification } from '../packages/geometry/src/path-edit';
import { matrix } from '../packages/geometry/src/affine';
const path = (): Vector => ({
  id: 'p',
  kind: 'path',
  x: 10,
  y: 20,
  width: 100,
  height: 10,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [
    { x: 0, y: 0 },
    { x: 25, y: 0.5 },
    { x: 50, y: 0 },
    { x: 75, y: 0.5 },
    { x: 100, y: 0 },
  ],
});
it('simplification measures error after affine scaling and preserves retained samples', () => {
  const a = path(),
    b = clone(a);
  a.points[0].pressure = 0.3;
  expect(simplifyPath(a, 1)).toBe(3);
  expect(a.points[0].pressure).toBe(0.3);
  b.transform = [1, 0, 0, 10];
  expect(simplifyPath(b, 1)).toBe(0);
});
it('invalid simplification is atomic and closed paths/brushes are excluded', () => {
  const a = path(),
    before = clone(a);
  expect(() => simplifyPath(a, NaN)).toThrow();
  expect(a).toEqual(before);
  a.closed = true;
  expect(simplifyPath(a, 100)).toBe(0);
  expect(a.points).toEqual(before.points);
  a.closed = false;
  a.kind = 'brush';
  expect(simplifyPath(a, 100)).toBe(0);
});
it('closed pencil smoothing wraps the seam and straightening does not collapse it', () => {
  const a = path();
  a.closed = true;
  a.points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  smoothPath(a, true);
  expect(a.points.length).toBe(4);
  smoothPath(a);
  expect(a.points[0]).toEqual({ x: 25, y: 25 });
  expect(a.points[3]).toEqual({ x: 25, y: 75 });
});
it('whole Bezier smoothing wraps closed neighbors and omits unused open handles', () => {
  const a = path();
  a.kind = 'bezier';
  a.closed = true;
  a.nodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  smoothPath(a);
  expect(a.nodes[0].in).toBeDefined();
  expect(a.nodes[0].out).toBeDefined();
  const first = a.nodes[0];
  expect(first.in!.x).toBeCloseTo(0);
  expect(first.out!.x).toBeCloseTo(0);
  a.closed = false;
  smoothPath(a);
  expect(a.nodes[0].in).toBeUndefined();
  expect(a.nodes[2].out).toBeUndefined();
  smoothPath(a, true);
  expect(a.nodes.every((n) => !n.in && !n.out)).toBe(true);
});

it('complex simplification fails before replacing source samples', () => {
  const a = path();
  a.points = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: i % 2 }));
  const original = a.points;
  expect(() => simplifyPath(a, 0.01)).toThrow('too complex');
  expect(a.points).toBe(original);
});

it('reuses original world samples across nonmonotonic fit levels without changing retained points', () => {
  const a = path();
  a.transform = [-0.8, 0.37, 0.18, 1.82];
  a.rotation = 22;
  let reads = 0;
  const original = Array.from({ length: 160 }, (_, i) => ({
    x: i * 2,
    y: Math.sin(i / 4) * 12 + (i % 2) * 0.5,
    pressure: (i % 8) / 8,
  }));
  const tracked: Point[] = original.map(p => ({ ...p, get x() { reads++; return p.x; } }));
  const prepared = preparePathSimplification(tracked, matrix(a));
  const setupReads = reads;
  for (const tolerance of [0.02, 0.25, 2, 0.03, 0.5, 0.02, 100]) {
    const direct = { ...a, points: original };
    simplifyPath(direct, tolerance);
    const cached = prepared(tolerance);
    expect(reads).toBe(setupReads);
    expect(cached.map(p => original[tracked.indexOf(p)])).toEqual(direct.points);
  }
});

it('cached simplification retains the original work limit and recovers for an admissible tolerance', () => {
  const a = path();
  a.points = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: i % 2 }));
  const prepared = preparePathSimplification(a.points, matrix(a));
  expect(() => prepared(0.01)).toThrow('too complex');
  expect(() => prepared(0.01)).toThrow('too complex');
  expect(prepared(2)).toEqual([a.points[0], a.points.at(-1)]);
});
