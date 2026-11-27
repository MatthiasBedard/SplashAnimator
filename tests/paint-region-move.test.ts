import { it, expect } from 'vitest';
import { mergeVectors, vectorPolygons, contains } from '../packages/geometry/src/merge';
import { clipPaint } from '../packages/geometry/src/clip-paint';
import { worldPaths } from '../packages/geometry/src/drawing';
import { regionMoveArtwork } from './paint-region-move-fixture';
for (const origin of [0, 50000, -50000])
  it(`moves clipped mixed Brush/Pencil paint with preserved ownership at origin ${origin}`, () => {
    for (let seed = 0; seed < (origin === 0 ? 24 : 4); seed++) {
      const { art, polygon, eligible } = regionMoveArtwork(seed, origin),
        before = structuredClone(art),
        inside = clipPaint(art, { polygon, eligible, keep: 'inside' }),
        outside = clipPaint(art, { polygon, eligible, keep: 'outside' }),
        moved = inside.map((s) => ({ ...s, x: s.x + 13.3, y: s.y - 7.7 })),
        input = [...outside, ...moved],
        inputBefore = structuredClone(input),
        output = mergeVectors(input),
        expected = [...input].reverse().map((s) => ({ fill: s.fill, polygons: vectorPolygons(s) })),
        actual = output.map((s) => ({ fill: s.fill, polygons: vectorPolygons(s) }));
      let filled = 0;
      for (let x = 140.123; x < 405; x += 11)
        for (let y = 120.321; y < 205; y += 9) {
          const point = { x: x + origin, y: y + origin },
            owner = expected.find((s) => contains(s.polygons, point)),
            result = actual.find((s) => contains(s.polygons, point));
          expect(result?.fill, `seed ${seed} at ${x},${y}`).toBe(owner?.fill);
          if (owner) filled++;
        }
      expect(filled).toBeGreaterThan(30);
      const pencil = output.filter((s) => s.fillEnabled === false && s.strokeWidth === 2);
      expect(pencil).toHaveLength(1);
      const points = worldPaths(pencil[0])[0];
      expect(points.map((p) => p.y - origin).sort((a, b) => a - b)).toEqual([0, 300]);
      expect(points.every((p) => p.x === 450 + origin)).toBe(true);
      expect(input).toEqual(inputBefore);
      expect(art).toEqual(before);
    }
  }, 20000);

it('still rejects a painted face with no representable interior instead of guessing paint', () => {
  const view = new DataView(new ArrayBuffer(8));
  const step = (n: number, delta: bigint) => {
    view.setFloat64(0, n);
    view.setBigUint64(0, view.getBigUint64(0) + delta);
    return view.getFloat64(0);
  };
  let lo = 50000 + 0.0000005;
  for (let i = 0; i < 4; i++) lo = step(lo, -1n);
  for (let i = 0; i < 8; i++) {
    const hi = step(lo, 1n);
    if (Math.round(lo * 1e6) !== Math.round(hi * 1e6)) {
      const { art } = regionMoveArtwork();
      const fill = {
        ...art[0],
        kind: 'polygon' as const,
        fillRule: undefined,
        x: 0,
        y: lo,
        width: 50000,
        height: hi - lo,
        points: [
          { x: 0, y: 0 },
          { x: 50000, y: 0 },
          { x: 25000, y: hi - lo },
        ],
        contours: undefined,
        strokeWidth: 0,
      };
      const outline = {
        ...fill,
        kind: 'path' as const,
        closed: true,
        fillEnabled: false,
        strokeWidth: 2,
      };
      const input = [outline],
        before = structuredClone(input);
      expect(25000 * (hi - lo)).toBeGreaterThan(1e-7);
      expect(() =>
        mergeVectors(input, { paint: fill, point: { x: 25000, y: lo }, gap: 0 }),
      ).toThrow(/too narrow|interior sample/);
      expect(input).toEqual(before);
      return;
    }
    lo = hi;
  }
  throw Error('Expected adjacent floats across the existing arrangement grid boundary.');
});
