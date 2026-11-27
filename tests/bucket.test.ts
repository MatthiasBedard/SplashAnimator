import { describe, it, expect } from 'vitest';
import { id, clone, type Vector } from '../packages/document/src';
import { mergeVectors } from '../packages/geometry/src/merge';
import { hit, transformVectors, around } from '../packages/geometry/src';
const path = (points: { x: number; y: number }[]): Vector => ({
  id: id(),
  kind: 'path',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#00ff00',
  stroke: '#000000',
  strokeWidth: 2,
  fillEnabled: false,
  points,
});
const box = (size = 100) =>
  path([
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
    { x: 0, y: 0 },
  ]);
const fill = (shapes: Vector[], x = 50, y = 50, gap = 0) =>
  mergeVectors(shapes, {
    paint: { ...box(), fillEnabled: true, strokeWidth: 0 },
    point: { x, y },
    gap,
  });
describe('bucket enclosure discovery', () => {
  it('fills a closed stroke outline without modifying it and rejects the outside', () => {
    const s = box(),
      before = clone(s),
      result = fill([s]);
    expect(result).toHaveLength(1);
    expect(hit(result[0], { x: 50, y: 50 }, 0)).toBe(true);
    expect(s).toEqual(before);
    expect(fill([s], 150, 50)).toHaveLength(0);
  });
  it('bridges only gaps within the selected stage-space tolerance', () => {
    const s = box();
    s.points.at(-1)!.y = 8;
    expect(fill([s])).toHaveLength(0);
    expect(fill([s], 50, 50, 7)).toHaveLength(0);
    expect(fill([s], 50, 50, 8)).toHaveLength(1);
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0, 0, 2));
    expect(fill([s], 50, 50, 8)).toHaveLength(0);
    expect(fill([s], 50, 50, 16)).toHaveLength(1);
  });
  it('keeps inner islands as holes and selects only the clicked face', () => {
    const outer = box(),
      inner = box(20);
    inner.x = 40;
    inner.y = 40;
    const result = fill([outer, inner], 20, 20);
    expect(result).toHaveLength(1);
    expect(hit(result[0], { x: 50, y: 50 }, 0)).toBe(false);
    expect(fill([outer, inner], 50, 50)).toHaveLength(1);
  });
  it('respects internal stroke dividers and ignores text boundaries', () => {
    const s = box(),
      divider = path([
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ]);
    const result = fill([s, divider], 25, 50);
    expect(result).toHaveLength(1);
    expect(hit(result[0], { x: 75, y: 50 }, 0)).toBe(false);
    expect(fill([{ ...s, kind: 'text' }])).toHaveLength(0);
  });
});

it.each([0, -108])(
  'closes the requested gap among thousands of distant open endpoints (offset %s)',
  (offset) => {
    const outline = box();
    outline.points.at(-1)!.y = 8;
    outline.x = offset;
    outline.y = offset;
    const shapes = [
      outline,
      ...Array.from({ length: 1500 }, (_, i) =>
        path([
          { x: 1000 + i * 100, y: 1000 },
          { x: 1020 + i * 100, y: 1000 },
        ]),
      ),
    ];
    const before = clone(shapes);
    expect(fill(shapes, offset + 50, offset + 50, 7)).toHaveLength(0);
    const result = fill(shapes, offset + 50, offset + 50, 8);
    expect(result).toHaveLength(1);
    expect(hit(result[0], { x: offset + 50, y: offset + 50 }, 0)).toBe(true);
    expect(hit(result[0], { x: offset + 150, y: offset + 50 }, 0)).toBe(false);
    expect(shapes).toEqual(before);
  },
);

it('rejects invalid gap tolerances before discovery without mutating source paint', () => {
  const input = [box()];
  const before = clone(input);
  for (const gap of [NaN, Infinity, -Infinity, -1, 40.001]) {
    expect(() => fill(input, 50, 50, gap)).toThrow('Bucket gap');
    expect(input).toEqual(before);
  }
  expect(fill(input, 50, 50, 0)).toHaveLength(1);
  expect(fill(input, 50, 50, 40)).toHaveLength(1);
});

it('rejects nonfinite Bucket locations without modifying source artwork', () => {
  const input = [box()],
    before = clone(input);
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(() => fill(input, value, 50)).toThrow('Bucket point');
    expect(() => fill(input, 50, value)).toThrow('Bucket point');
    expect(input).toEqual(before);
  }
});

it('selects only the clicked nested enclosure among many distant closed outlines', () => {
  const shapes = Array.from({ length: 180 }, (_, i) =>
    [100, 60, 20].map((size) => {
      const s = box(size);
      s.x = i * 150 + (100 - size) / 2;
      s.y = (100 - size) / 2;
      return s;
    }),
  ).flat();
  const before = clone(shapes);
  for (const index of [0, 79, 179]) {
    const x = index * 150;
    const outer = fill(shapes, x + 10, 10);
    expect(outer).toHaveLength(1);
    expect(hit(outer[0], { x: x + 10, y: 10 }, 0)).toBe(true);
    expect(hit(outer[0], { x: x + 30, y: 30 }, 0)).toBe(false);
    const inner = fill(shapes, x + 50, 50);
    expect(inner).toHaveLength(1);
    expect(hit(inner[0], { x: x + 50, y: 50 }, 0)).toBe(true);
    expect(hit(inner[0], { x: x + 30, y: 30 }, 0)).toBe(false);
  }
  expect(fill(shapes, 125, 50)).toEqual([]);
  expect(shapes).toEqual(before);
});
