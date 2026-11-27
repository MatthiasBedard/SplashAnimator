import { expect, it } from 'vitest';
import { boundsIndex, type Bounds } from '../packages/geometry/src/bounds-index';
it('matches exhaustive bounds intersections for mixed scales, degenerate bounds and tolerance', () => {
  let seed = 12345;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  const boxes: Bounds[] = Array.from({ length: 2000 }, (_, i) => {
    const left = random() * 20000 - 10000,
      top = random() * 20000 - 10000;
    return {
      left,
      top,
      right: left + (i % 7 ? random() * 300 : 0),
      bottom: top + (i % 11 ? random() * 300 : 0),
    };
  });
  boxes.push({ left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  const before = structuredClone(boxes),
    query = boundsIndex(boxes);
  for (let i = 0; i < 200; i++) {
    const b = boxes[i * 7],
      padding = i % 2 ? 0 : 0.000001;
    const expected = boxes.flatMap((a, index) =>
      a.right + padding >= b.left &&
      b.right + padding >= a.left &&
      a.bottom + padding >= b.top &&
      b.bottom + padding >= a.top
        ? [index]
        : [],
    );
    expect(query(b, padding).sort((a, b) => a - b)).toEqual(expected);
  }
  expect(boxes).toEqual(before);
});
it('preserves boundary contacts and prunes distant entries without an artwork cap', () => {
  const boxes = Array.from({ length: 20000 }, (_, i) => ({
    left: i * 10,
    right: i * 10 + 5,
    top: 0,
    bottom: 5,
  }));
  const query = boundsIndex(boxes);
  expect(query({ left: 5, right: 10, top: 5, bottom: 5 }).sort((a, b) => a - b)).toEqual([0, 1]);
  expect(query({ left: 5 + 5e-7, right: 9, top: 5, bottom: 5 })).toEqual([]);
  expect(query({ left: 5 + 5e-7, right: 9, top: 5, bottom: 5 }, 1e-6)).toEqual([0]);
  expect(query({ left: 199990, right: 199995, top: 0, bottom: 5 })).toEqual([19999]);
  expect(boundsIndex([])({ left: 0, right: 1, top: 0, bottom: 1 })).toEqual([]);
  expect(() => boundsIndex([{ left: 0, right: Infinity, top: 0, bottom: 1 }])).toThrow(/finite/);
});
