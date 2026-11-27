import { expect, it } from 'vitest';
import { traceBitmapRaster } from '../packages/geometry/src/bitmap-trace';

const red = [244, 10, 9, 255], blue = [10, 100, 240, 128], clear = [90, 20, 70, 0];
const raster = (rows: string[]) => ({
  width: rows[0].length, height: rows.length,
  rgba: Uint8ClampedArray.from(rows.flatMap(row => [...row].flatMap(cell => cell === 'r' ? red : cell === 'b' ? blue : clear))),
});

it('traces compact editable color boundaries, a transparent hole and separate islands', () => {
  const input = raster(['rrr.b', 'r.r..', 'rrr.b']), original = input.rgba.slice();
  const [redPaint, bluePaint] = traceBitmapRaster(input);
  expect(redPaint.fill).toBe('#f40a09');
  expect(redPaint.opacity).toBe(1);
  expect(redPaint.contours.map(ring => ring.length)).toEqual([4, 4]);
  expect(bluePaint.fill).toBe('#0a64f0');
  expect(bluePaint.opacity).toBe(128 / 255);
  expect(bluePaint.contours.map(ring => ring.length)).toEqual([4, 4]);
  expect(input.rgba).toEqual(original);
});

it('matches every pixel center for all nonempty three-by-three masks, including diagonal contacts', () => {
  for (let mask = 1; mask < 512; mask++) {
    const input = raster(Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 3 }, (_, x) => (mask & (1 << (y * 3 + x))) ? 'r' : '.').join('')));
    const [{ contours }] = traceBitmapRaster(input);
    for (let cell = 0; cell < 9; cell++) {
      const x = cell % 3 + 0.5, y = Math.floor(cell / 3) + 0.5;
      let inside = false;
      for (const ring of contours) for (const [index, point] of ring.entries()) {
        const next = ring[(index + 1) % ring.length];
        if (point.x > x && point.x === next.x && (point.y > y) !== (next.y > y)) inside = !inside;
      }
      expect(inside).toBe(Boolean(mask & (1 << cell)));
    }
  }
});

it('rejects empty, malformed, oversized and overcomplex rasters', () => {
  expect(() => traceBitmapRaster(raster(['.']))).toThrow(/no visible paint/);
  expect(() => traceBitmapRaster({ ...raster(['r']), width: 513 })).toThrow(/invalid bitmap trace/i);
  expect(() => traceBitmapRaster({ ...raster(['r']), width: 2 })).toThrow(/invalid bitmap trace/i);
  const checker = Array.from({ length: 256 }, (_, y) => (y % 2 ? '.r' : 'r.').repeat(128));
  expect(() => traceBitmapRaster(raster(checker))).toThrow(/lower detail/);
});
