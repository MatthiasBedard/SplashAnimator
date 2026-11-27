import { expect, it } from 'vitest';
import { zoomPan } from '../packages/interaction/src';
it('keeps the same document point beneath a viewport anchor through zoom and inverse zoom', () => {
  const view = { width: 1200, height: 800 },
    pan = { x: 135, y: -70 },
    anchor = { x: 240, y: 310 };
  for (const document of [
    { width: 960, height: 540 },
    { width: 4000, height: 100 },
  ])
    for (const a of [0.05, 0.8, 4])
      for (const b of [0.05, 1, 4]) {
        const result = zoomPan(pan, anchor, view, a, b);
        const point = {
          x: (anchor.x - (view.width - document.width * a) / 2 - pan.x) / a,
          y: (anchor.y - (view.height - document.height * a) / 2 - pan.y) / a,
        };
        expect((view.width - document.width * b) / 2 + result.x + point.x * b).toBeCloseTo(
          anchor.x,
          8,
        );
        expect((view.height - document.height * b) / 2 + result.y + point.y * b).toBeCloseTo(
          anchor.y,
          8,
        );
        const reverse = zoomPan(result, anchor, view, b, a);
        expect(reverse.x).toBeCloseTo(pan.x, 8);
        expect(reverse.y).toBeCloseTo(pan.y, 8);
      }
  expect(zoomPan(pan, { x: 600, y: 400 }, view, 1, 2)).toEqual({ x: 270, y: -140 });
  expect(() => zoomPan(pan, anchor, view, 0, 1)).toThrow();
});
