import { describe, it, expect } from 'vitest';
import { newProject, clone, id, validateProject, type Vector } from '../packages/document/src';
import {
  around,
  multiply,
  transformVectors,
  worldPoint,
  localPoint,
  objectBounds,
  normalizeVector,
  hit,
} from '../packages/geometry/src';
import { eraseVectors } from '../packages/geometry/src/erase';
const box = (x = 10, y = 20): Vector => ({
  id: id(),
  kind: 'rectangle',
  x,
  y,
  width: 100,
  height: 50,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
describe('editable affine transforms', () => {
  it('scales rotated group members in stage axes without distorting their relative placement', () => {
    const a = box(),
      b = box(200, 80);
    b.rotation = 30;
    const originals = clone([a, b]);
    const p = { x: 50, y: 50 };
    const operation = around(p, 2, 0, 0, 0.5);
    transformVectors([a, b], operation);
    for (const [i, s] of [a, b].entries()) {
      const old = worldPoint(originals[i], { x: 70, y: 35 }),
        now = worldPoint(s, { x: 70, y: 35 });
      expect(now.x).toBeCloseTo(p.x + (old.x - p.x) * 2);
      expect(now.y).toBeCloseTo(p.y + (old.y - p.y) * 0.5);
      expect(localPoint(s, now).x).toBeCloseTo(70);
      expect(s.width).toBe(100);
    }
  });
  it('combines skew, rotation and negative scaling while retaining nodes, samples and pivot', () => {
    const s = box();
    s.kind = 'bezier';
    s.nodes = [
      { x: 0, y: 0, out: { x: 30, y: 40 } },
      { x: 100, y: 50 },
    ];
    s.pivot = { x: 10, y: 5 };
    const original = clone(s),
      pivot = worldPoint(s, s.pivot);
    transformVectors([s], multiply(around(pivot, 0, 1, -1, 0), around(pivot, -1, 0, 0.5, 1)));
    expect(s.nodes).toEqual(original.nodes);
    expect(worldPoint(s, s.pivot!).x).toBeCloseTo(pivot.x);
    expect(worldPoint(s, s.pivot!).y).toBeCloseTo(pivot.y);
    const bounds = objectBounds(s);
    expect(bounds.right).toBeGreaterThan(bounds.left);
    const p = newProject();
    p.layers[0].keys[0].shapes = [s];
    expect(validateProject(p)).toEqual(p);
  });
  it('hit tests flipped/skewed fills and preserves world geometry and pivots during normalization', () => {
    const s = box();
    transformVectors([s], around({ x: 0, y: 0 }, -2, 0.3, 0.7, 1));
    expect(hit(s, worldPoint(s, { x: 30, y: 20 }), 0)).toBe(true);
    expect(hit(s, worldPoint(s, { x: 200, y: 20 }), 0)).toBe(false);
    s.kind = 'path';
    s.points = [
      { x: -10, y: -20 },
      { x: 100, y: 50 },
    ];
    s.pivot = { x: 3, y: 7 };
    const first = worldPoint(s, s.points[0]),
      pivot = worldPoint(s, s.pivot);
    normalizeVector(s);
    expect(worldPoint(s, s.points[0]).x).toBeCloseTo(first.x);
    expect(worldPoint(s, s.pivot!).y).toBeCloseTo(pivot.y);
  });
  it('rejects singular and excessive transforms without partially changing a selection', () => {
    const shapes = [box(), box(10000)];
    const before = clone(shapes);
    expect(() => transformVectors(shapes, around({ x: 0, y: 0 }, 0, 0, 0, 1))).toThrow();
    expect(shapes).toEqual(before);
    expect(() => transformVectors(shapes, around({ x: 0, y: 0 }, 100, 0, 0, 100))).toThrow();
    expect(shapes).toEqual(before);
    const p = newProject();
    p.layers[0].keys[0].shapes = [{ ...box(), transform: [1, 0, 0, 0] }];
    expect(() => validateProject(p)).toThrow('affine');
  });
  it('erases a world-space hole from a transformed fill without mutating its paint or pivot', () => {
    const s = box();
    s.pivot = { x: 50, y: 25 };
    s.gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0, 0.5, 1));
    const before = clone(s),
      center = worldPoint(s, { x: 50, y: 25 });
    const result = eraseVectors([s], [center], 5, 'fills');
    expect(s).toEqual(before);
    expect(result.some((v) => hit(v, center, 0))).toBe(false);
    expect(result.some((v) => hit(v, worldPoint(s, { x: 20, y: 10 }), 0))).toBe(true);
    expect(result[0].transform).toEqual(s.transform);
  });
});
