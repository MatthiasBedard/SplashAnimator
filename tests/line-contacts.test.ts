import { expect, it } from 'vitest';
import { lineContacts } from '../packages/geometry/src/line-contacts';

const p = (x: number, y: number) => ({ x, y });

it('uses one nearest representable point for every traversal of a multiway crossing', () => {
  // Three lines meet at (1/3, 2/3) before the common scale and translation.
  const at = (x: number, y: number) => p(x * 0.125 + 1024, y * 0.125 - 17);
  const lines = [
    [at(0, 0), at(1, 2)],
    [at(0, 1), at(1, 0)],
    [at(-1, 0), at(1, 1)],
  ];
  const expected = p(1024 + 1 / 24, -17 + 1 / 12);
  for (const first of lines)
    for (const second of lines)
      if (first !== second) {
        for (const [a, b] of [first, [...first].reverse()])
          for (const [c, d] of [second, [...second].reverse()]) {
            const hits = lineContacts(a, b, c, d);
            expect(hits).toHaveLength(1);
            expect(hits[0].point).toEqual(expected);
            expect(hits[0].t).toBeGreaterThan(0);
            expect(hits[0].t).toBeLessThan(1);
          }
      }
});

it('splits exactly at a T contact and both ends of a reversed shared interval', () => {
  const a = p(159, 135),
    b = p(152, 135),
    t = p(153, 135);
  expect(lineContacts(a, b, t, p(153, 142))).toEqual([{ t: 6 / 7, u: 0, point: t }]);
  expect(lineContacts(a, b, p(150, 135), p(154, 135))).toEqual([
    { t: 1, u: 1 / 2, point: b },
    { t: 5 / 7, u: 1, point: p(154, 135) },
  ]);
  const gap = 2 ** -40;
  expect(lineContacts(a, b, p(150, 135 + gap), p(154, 135 + gap))).toEqual([]);
});
