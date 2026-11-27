import { describe, expect, it } from 'vitest';
import {
  alignVectors,
  distributeVectors,
  distributeGaps,
  objectBounds,
} from '../packages/geometry/src';
import type { Vector } from '../packages/document/src';
const box = (x: number, y: number, width = 100, rotation = 0): Vector => ({
  id: crypto.randomUUID(),
  kind: 'rectangle',
  x,
  y,
  width,
  height: 50,
  rotation,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
describe('alignment and distribution', () => {
  it('aligns rotated authoring boxes without changing their geometry or stacking order', () => {
    const shapes = [box(10, 20), box(200, 70, 100, 90)];
    const ids = shapes.map((s) => s.id);
    alignVectors(shapes, 'left');
    expect(objectBounds(shapes[0]).left).toBeCloseTo(10);
    expect(objectBounds(shapes[1]).left).toBeCloseTo(10);
    expect(shapes[1].x).toBeCloseTo(60);
    expect(shapes[1].rotation).toBe(90);
    expect(shapes.map((s) => s.id)).toEqual(ids);
    alignVectors(shapes, 'bottom');
    expect(objectBounds(shapes[0]).bottom).toBeCloseTo(objectBounds(shapes[1]).bottom);
  });
  it('centers an object on stage using its rotated bounds', () => {
    const shape = box(-500, -300, 100, 90);
    const stage = { left: 0, top: 0, right: 960, bottom: 540 };
    alignVectors([shape], 'center', stage);
    alignVectors([shape], 'middle', stage);
    const bounds = objectBounds(shape);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(480);
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(270);
  });
  it('distributes centers with unequal widths and preserves outer endpoints and z-order', () => {
    const shapes = [box(450, 10, 100), box(0, 70, 100), box(100, 100, 200)];
    const ids = shapes.map((s) => s.id);
    distributeVectors(shapes, 'x');
    expect(shapes.map((s) => s.x + s.width / 2)).toEqual([500, 50, 275]);
    expect(shapes.map((s) => s.id)).toEqual(ids);
    expect(shapes.map((s) => s.y)).toEqual([10, 70, 100]);
  });
});

describe('equal gaps', () => {
  it('spaces unequal widths without changing endpoints or stacking order', () => {
    const shapes = [box(400, 0, 100), box(0, 20, 50), box(80, 40, 150)];
    const ids = shapes.map((s) => s.id);
    distributeGaps(shapes, 'x');
    expect(shapes.map((s) => s.x)).toEqual([400, 0, 150]);
    expect(shapes.map((s) => s.id)).toEqual(ids);
    expect(shapes.map((s) => s.y)).toEqual([0, 20, 40]);
  });
  it('moves nested groups rigidly using affine bounds vertically', () => {
    const shapes = [box(0, 0), box(20, 80), box(60, 90), box(0, 400)];
    shapes[1].groups = ['outer', 'inner'];
    shapes[2].groups = ['outer', 'inner'];
    shapes[1].transform = [1, 0.5, 0.3, 2];
    const before = shapes.map(objectBounds);
    const separation = shapes[2].y - shapes[1].y;
    distributeGaps(shapes, 'y');
    const after = shapes.map(objectBounds);
    expect(Math.min(after[1].top, after[2].top) - after[0].bottom).toBeCloseTo(
      after[3].top - Math.max(after[1].bottom, after[2].bottom),
    );
    expect(shapes[2].y - shapes[1].y).toBe(separation);
    expect(after[0]).toEqual(before[0]);
    expect(after[3]).toEqual(before[3]);
    expect(shapes[1].transform).toEqual([1, 0.5, 0.3, 2]);
  });
  it('supports signed overlap and ignores fewer than three units', () => {
    const shapes = [box(0, 0, 100), box(20, 0, 100), box(80, 0, 100)];
    distributeGaps(shapes, 'x');
    expect(shapes[1].x).toBe(40);
    shapes[0].groups = ['g'];
    shapes[1].groups = ['g'];
    const before = structuredClone(shapes);
    distributeGaps(shapes, 'x');
    expect(shapes).toEqual(before);
  });
});

describe('group layout', () => {
  it('aligns affine group bounds to the stage without flattening members', () => {
    const shapes = [box(20, 30, 100, 30), box(160, 80, 50)];
    shapes.forEach((s) => (s.groups = ['g']));
    shapes[0].transform = [1, 0.2, 0.4, 1];
    const before = structuredClone(shapes);
    alignVectors(shapes, 'center', { left: 0, top: 0, right: 960, bottom: 540 });
    const bounds = shapes.map(objectBounds);
    expect(
      (Math.min(...bounds.map((b) => b.left)) + Math.max(...bounds.map((b) => b.right))) / 2,
    ).toBeCloseTo(480);
    expect(shapes[1].x - shapes[0].x).toBeCloseTo(before[1].x - before[0].x);
    expect(shapes.map((s) => s.y)).toEqual(before.map((s) => s.y));
    expect(shapes[0].transform).toEqual(before[0].transform);
  });
  it('aligns nested units at isolation depth and spaces their centers', () => {
    const shapes = [box(0, 0, 20), box(40, 10, 20), box(100, 100, 40), box(400, 300, 80)];
    shapes.forEach((s, i) => (s.groups = i < 2 ? ['outer', 'inner'] : ['outer']));
    const before = structuredClone(shapes);
    distributeVectors(shapes, 'x');
    expect(shapes).toEqual(before);
    distributeVectors(shapes, 'x', 1);
    expect(shapes[2].x + 20).toBeCloseTo((30 + 440) / 2);
    expect(shapes.slice(0, 2)).toEqual(before.slice(0, 2));
    alignVectors(shapes, 'top', undefined, 1);
    expect(shapes.map((s) => s.y)).toEqual([0, 10, 0, 0]);
  });
});
