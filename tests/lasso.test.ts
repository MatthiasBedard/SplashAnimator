import { it, expect } from 'vitest';
import { lassoContains, combineSelection } from '../packages/geometry/src/lasso';
import type { Vector } from '../packages/document/src';
const box: Vector = {
  id: 'a',
  kind: 'rectangle',
  x: 2,
  y: 2,
  width: 6,
  height: 6,
  rotation: 0,
  points: [],
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
};
const ring = (pairs: number[][]) => pairs.map(([x, y]) => ({ x, y }));
it('rejects a box bridging a concave notch despite all corners being inside', () => {
  const notch = ring([
    [0, 0],
    [10, 0],
    [10, 10],
    [6, 10],
    [6, 4],
    [4, 4],
    [4, 10],
    [0, 10],
  ]);
  expect(lassoContains(box, notch)).toBe(false);
  expect(lassoContains({ ...box, width: 1 }, notch)).toBe(true);
});
it('accepts boundary contact, affine boxes and degenerate object dimensions', () => {
  const square = ring([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  expect(lassoContains({ ...box, x: 0, y: 0, width: 10, height: 10 }, square)).toBe(true);
  expect(lassoContains({ ...box, width: 0 }, square)).toBe(true);
  expect(lassoContains({ ...box, transform: [1, 0, 0.5, 1] }, square)).toBe(false);
  expect(
    lassoContains(
      box,
      ring([
        [0, 0],
        [5, 0],
        [10, 0],
      ]),
    ),
  ).toBe(false);
});
it('combines selection IDs without mutating inputs', () => {
  const before = ['a', 'b'];
  const hits = ['b', 'c'];
  expect(combineSelection(before, hits, 'replace')).toEqual(hits);
  expect(combineSelection(before, hits, 'add')).toEqual(['a', 'b', 'c']);
  expect(combineSelection(before, hits, 'subtract')).toEqual(['a']);
  expect(combineSelection(before, hits, 'intersect')).toEqual(['b']);
  expect(before).toEqual(['a', 'b']);
});

it('keeps tiny lasso containment independent of document origin and winding', () => {
  for (const origin of [0, -99900, 99900]) {
    const square = ring([
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ]).map((p) => ({ x: p.x + origin, y: p.y + origin }));
    const shape = { ...box, x: origin + 0.0002, y: origin + 0.0002, width: 0.0006, height: 0.0006 };
    expect(lassoContains(shape, square)).toBe(true);
    expect(lassoContains(shape, [...square].reverse())).toBe(true);
  }
});
it('measures short diagonal boundary contact in document distance', () => {
  const triangle = ring([
    [0, 0],
    [0.001, 0],
    [0, 0.001],
  ]);
  expect(lassoContains({ ...box, x: 0.00052, y: 0.00052, width: 0, height: 0 }, triangle)).toBe(
    false,
  );
  expect(lassoContains({ ...box, x: 0.0005, y: 0.0005, width: 0, height: 0 }, triangle)).toBe(true);
});
it('rejects boxes bridging small concave notches', () => {
  for (const scale of [0.0001, 0.001, 1]) {
    const notch = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [6, 10],
      [6, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ]).map((p) => ({ x: p.x * scale, y: p.y * scale }));
    expect(
      lassoContains(
        { ...box, x: 2 * scale, y: 2 * scale, width: 6 * scale, height: 6 * scale },
        notch,
      ),
    ).toBe(false);
  }
});

it('retains epsilon-near contacts and handles duplicate boundary vertices', () => {
  const triangle = ring([
    [0, 0],
    [0.001, 0],
    [0.001, 0],
    [0, 0.001],
    [0, 0],
  ]);
  for (const delta of [0, 0.00000005, 0.0000002]) {
    const shape = {
      ...box,
      x: 0.0005 + delta / Math.SQRT2,
      y: 0.0005 + delta / Math.SQRT2,
      width: 0,
      height: 0,
    };
    expect(lassoContains(shape, triangle)).toBe(delta <= 1e-7);
  }
  expect(lassoContains({ ...box, x: -0.0000002, y: 0, width: 0, height: 0 }, triangle)).toBe(false);
});

it('splits box edges at the true intersections with narrow slanted notches', () => {
  for (const scale of [1, 0.001, 0.00005]) {
    for (const origin of [0, -50000, 50000]) {
      const notch = ring([
        [0, 0],
        [10, 0],
        [10, 10],
        [7, 10],
        [2.1, 5],
        [2, 5],
        [6.9, 10],
        [0, 10],
      ]).map((p) => ({ x: origin + p.x * scale, y: origin + p.y * scale }));
      const shape = {
        ...box,
        x: origin + 2 * scale,
        y: origin + 2 * scale,
        width: 6 * scale,
        height: 6 * scale,
      };
      expect(lassoContains(shape, notch)).toBe(false);
      expect(lassoContains(shape, [...notch].reverse())).toBe(false);
      expect(lassoContains({ ...shape, x: origin + 0.5 * scale, width: scale }, notch)).toBe(true);
    }
  }
});
it('selects both lobes of zero-signed-area crossing lassos without selecting the outside', () => {
  for (const scale of [0.001, 1, 100])
    for (const origin of [0, -99900, 99900]) {
      const outline = ring([
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ]).map((p) => ({ x: origin + p.x * scale, y: origin + p.y * scale }));
      const shape = (x: number, y: number, width = 1, height = 1) => ({
        ...box,
        x: origin + x * scale,
        y: origin + y * scale,
        width: width * scale,
        height: height * scale,
      });
      const before = structuredClone(outline);
      for (const points of [outline, [...outline].reverse(), [...outline, outline[0]]]) {
        expect(lassoContains(shape(4, 1), points)).toBe(true);
        expect(lassoContains(shape(4, 8), points)).toBe(true);
        expect(lassoContains(shape(1, 4), points)).toBe(false);
        expect(lassoContains(shape(4, 1, 2, 8), points)).toBe(false);
      }
      expect(outline).toEqual(before);
    }
});
it('keeps collinear and below-bound lassos empty and retraced interiors unselected', () => {
  expect(
    lassoContains(
      { ...box, x: 1, y: 0, width: 0, height: 0 },
      ring([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ),
  ).toBe(false);
  expect(
    lassoContains(
      { ...box, x: 0, y: 0, width: 0, height: 0 },
      ring([
        [0, 0],
        [0.00001, 0],
        [0, 0.00001],
      ]),
    ),
  ).toBe(false);
  const square = ring([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]);
  expect(lassoContains(box, [...square, ...square])).toBe(false);
});
