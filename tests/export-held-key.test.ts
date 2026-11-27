import { expect, it } from 'vitest';
import { createHeldKeySampler } from '../packages/export-web/src/held-key';

it('matches held and blank authored keys across jumps, rewind and repeated loops', () => {
  const keys = [
    { frame: 0, shapes: ['first'] },
    { frame: 3, shapes: [] },
    { frame: 7, shapes: ['return'] },
    { frame: 8, shapes: ['next'] },
  ];
  const sample = createHeldKeySampler(keys);
  for (const frame of [0, 1, 2, 7, 3, 6, 8, 100, 0, 9, 4, 2, 8, 0]) {
    expect(sample(frame)).toBe(keys.filter(k => k.frame <= frame).at(-1));
  }
  expect(keys[1].shapes).toEqual([]);
});

it('bounds key reads on large jumps and avoids rescanning long holds', () => {
  let reads = 0;
  const keys = Array.from({ length: 10000 }, (_, i) => ({
    get frame() { reads++; return i * 100; },
    shapes: [i],
  }));
  const sample = createHeldKeySampler(keys);
  for (const frame of [999999, 0, 510001, 300, 876543]) {
    reads = 0;
    expect(sample(frame)).toBe(keys[Math.floor(frame / 100)]);
    expect(reads).toBeLessThanOrEqual(18);
  }
  reads = 0;
  for (let frame = 876544; frame < 876599; frame++) expect(sample(frame)).toBe(keys[8765]);
  expect(reads).toBe(55);
});
