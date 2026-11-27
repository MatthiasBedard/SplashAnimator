import { expect, it } from 'vitest';
import { outlineAlpha } from '../packages/stage/src/onion-outline';

it('retains outside and hole boundaries while clearing opaque and translucent interiors', () => {
  for (const alpha of [255, 128, 32]) {
    const pixels = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 1; y < 8; y++)
      for (let x = 1; x < 8; x++) pixels.set([50, 80, 120, alpha], (y * 9 + x) * 4);
    pixels[(4 * 9 + 4) * 4 + 3] = 0;
    outlineAlpha(pixels, 9, 9);
    const at = (x: number, y: number) => pixels[(y * 9 + x) * 4 + 3];
    expect(at(0, 0)).toBe(0);
    expect(at(1, 4)).toBe(alpha);
    expect(at(4, 3)).toBe(alpha);
    expect(at(4, 4)).toBe(0);
    expect(at(2, 2)).toBe(0);
    expect(Array.from(pixels.slice((4 * 9 + 1) * 4, (4 * 9 + 1) * 4 + 3))).toEqual([50, 80, 120]);
  }
});

it('retains thin strokes, antialiased edges and artwork touching the viewport', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let x = 0; x < 5; x++) pixels[(2 * 5 + x) * 4 + 3] = x === 4 ? 64 : 180;
  const before = pixels.slice();
  outlineAlpha(pixels, 5, 5);
  expect(pixels).toEqual(before);
});
