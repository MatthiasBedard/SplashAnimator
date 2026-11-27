import { expect, test } from 'vitest';
import { encodeBmp, encodeTiff } from '../packages/export-web/src/still-raster';

const pixels = {
  width: 1,
  height: 2,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 64]),
};

test('BMP stores opaque pixels in bottom-up BGR rows with DWORD padding', () => {
  const bytes = encodeBmp(pixels);
  const header = new DataView(bytes.buffer);
  expect(Array.from(bytes.slice(0, 2))).toEqual([0x42, 0x4d]);
  expect(header.getInt32(22, true)).toBe(2);
  expect(header.getUint16(28, true)).toBe(24);
  expect(Array.from(bytes.slice(header.getUint32(10, true)))).toEqual([255, 0, 0, 0, 0, 0, 255, 0]);
});

test.each([true, false])(
  'TIFF stores straight RGB samples and optional alpha (%s)',
  (transparent) => {
    const bytes = encodeTiff(pixels, transparent);
    const view = new DataView(bytes.buffer);
    expect(Array.from(bytes.slice(0, 4))).toEqual([73, 73, 42, 0]);
    const offset = view.getUint32(4, true);
    const entries = new Map<number, number>();
    for (let index = 0; index < view.getUint16(offset, true); index++) {
      const entry = offset + 2 + index * 12;
      entries.set(view.getUint16(entry, true), view.getUint32(entry + 8, true));
    }
    expect(entries.get(277)).toBe(transparent ? 4 : 3);
    expect(entries.get(338)).toBe(transparent ? 2 : undefined);
    expect(Array.from(bytes.slice(entries.get(273)))).toEqual(
      transparent ? Array.from(pixels.data) : [255, 0, 0, 0, 0, 255],
    );
  },
);
