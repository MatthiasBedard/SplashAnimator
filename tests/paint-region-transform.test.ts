import type { PaintRegion } from '../packages/geometry/src/paint-region';
import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { clipPaint } from '../packages/geometry/src/clip-paint';
import { combinePaintRegion } from '../packages/geometry/src/clip-paint';
import {
  paintRegionBounds,
  transformPaintRegion,
  preparePaintRegionTransform,
} from '../packages/geometry/src/paint-region-transform';
import { around, mapPoint, type Matrix } from '../packages/geometry/src/affine';
import { mergeVectors, vectorPolygons, contains } from '../packages/geometry/src/merge';
const rect: Vector = {
  id: 'paint',
  kind: 'rectangle',
  x: 40,
  y: 50,
  width: 120,
  height: 80,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
};
const line: Vector = {
  ...rect,
  id: 'line',
  kind: 'line',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  fillEnabled: false,
  stroke: '#000000',
  strokeWidth: 4,
  points: [
    { x: 20, y: 80 },
    { x: 220, y: 80 },
  ],
};
const mask = () =>
  combinePaintRegion({
    current: [],
    polygon: [
      { x: 80, y: 40 },
      { x: 180, y: 40 },
      { x: 180, y: 110 },
      { x: 80, y: 110 },
    ],
    mode: 'replace',
  });
for (const op of [
  around({ x: 130, y: 75 }, 1.5, 0, 0, 0.75),
  around({ x: 130, y: 75 }, 0, 1, -1, 0),
  around({ x: 80, y: 110 }, 1, 0, 0.4, 1),
  around({ x: 130, y: 75 }, -1, 0, 0, 1),
] as Matrix[])
  it(`transforms clipped fill and stroke paint with fixed outside ownership (${op.slice(0, 4)})`, () => {
    const source = [rect, line],
      region = mask(),
      eligible = source.map((s) => s.id),
      before = structuredClone(source),
      inside = clipPaint(source, { region, eligible, keep: 'inside' }),
      outside = clipPaint(source, { region, eligible, keep: 'outside' }),
      parts = structuredClone([inside, outside, region]);
    const prepared = preparePaintRegionTransform(inside, outside, region, op),
      result = mergeVectors(prepared.artwork);
    const expected = [...prepared.artwork]
        .reverse()
        .map((s) => ({ fill: s.fill, polygons: vectorPolygons(s) })),
      actual = result.map((s) => ({ fill: s.fill, polygons: vectorPolygons(s) }));
    for (let x = 15.123; x < 235; x += 8)
      for (let y = 10.321; y < 155; y += 7) {
        const point = { x, y };
        expect(actual.find((s) => contains(s.polygons, point))?.fill).toBe(
          expected.find((s) => contains(s.polygons, point))?.fill,
        );
      }
    expect(source).toEqual(before);
    expect([inside, outside, region]).toEqual(parts);
    expect(prepared.artwork.slice(0, outside.length)).toEqual(outside);
    expect(prepared.artwork[0]).not.toBe(outside[0]);
    const original = region[0][0][0],
      q = mapPoint(op, { x: original[0], y: original[1] });
    expect(prepared.selection[0][0][0]).toEqual([q.x, q.y]);
  });
it('preserves contour/hole ordering and closure through reflection and rotation', () => {
  const region: PaintRegion = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [2, 4],
          [4, 4],
          [4, 2],
          [2, 2],
        ],
      ],
    ],
    before = structuredClone(region),
    op: Matrix = [-1, 0.2, 0.3, 1, 40, 20];
  const out = transformPaintRegion(region, op);
  expect(out[0]).toHaveLength(2);
  expect(out[0][0]).toHaveLength(5);
  expect(out[0][0][0]).toEqual(out[0][0].at(-1));
  expect(region).toEqual(before);
  expect(paintRegionBounds([])).toBeNull();
  expect(paintRegionBounds(mask())).toEqual({ left: 80, right: 180, top: 40, bottom: 110 });
});
for (const bad of [
  [1, 0, 0, 1, NaN, 0],
  [1, 0, 0, 1, Infinity, 0],
  [1, 0, 0, 0, 0, 0],
  [1e308, 0, 0, 1e308, 0, 0],
])
  it(`rejects invalid or overflowing affine data atomically ${bad}`, () => {
    const region = mask(),
      source = [rect],
      before = structuredClone([source, region]);
    expect(() => preparePaintRegionTransform(source, [], region, bad as Matrix)).toThrow();
    expect([source, region]).toEqual(before);
  });
it('rejects a later piece outside the original transform limits without changing any member', () => {
  const source = [rect, { ...rect, id: 'large', x: 99999 }],
    before = structuredClone(source);
  expect(() => preparePaintRegionTransform(source, [], mask(), [1, 0, 0, 1, 20, 0])).toThrow();
  expect(source).toEqual(before);
});

it('rejects original nonfinite paint fields before a clone can normalize them', () => {
  const source = [{ ...rect, opacity: NaN }];
  expect(() => preparePaintRegionTransform(source, [], mask(), [1, 0, 0, 1, 10, 0])).toThrow();
  expect(source[0].opacity).toBeNaN();
});
it('rejects original getters without reading them or modifying any artwork', () => {
  const s = { ...rect };
  let reads = 0;
  Object.defineProperty(s, 'opacity', {
    enumerable: true,
    get() {
      reads++;
      return 0.5;
    },
  });
  expect(() => preparePaintRegionTransform([s], [], mask(), [1, 0, 0, 1, 10, 0])).toThrow();
  expect(reads).toBe(0);
});
