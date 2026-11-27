import type { prepareContourFits } from '../../packages/geometry/src/contour-fit';
import { test, expect } from '@playwright/test';
test('contour worker returns one complete fitted selection or one error', async ({ page }) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const result = await page.evaluate(async (root) => {
    const worker = new Worker(root + '/packages/geometry/src/worker.ts', { type: 'module' });
    const circle = (r: number) =>
      Array.from({ length: 64 }, (_, i) => ({
        x: r * Math.cos((i * Math.PI) / 32),
        y: r * Math.sin((i * Math.PI) / 32),
      }));
    const shape = {
      id: 'a',
      kind: 'polygon',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      fillRule: 'evenodd',
      contours: [circle(100), circle(50)],
    };
    const request = (id: number, selected: string[]) =>
      new Promise<{ id: number; result?: ReturnType<typeof prepareContourFits>; error?: string }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(Error('worker timeout')), 10000);
          worker.onerror = (e) => {
            clearTimeout(timer);
            reject(Error(e.message));
          };
          worker.onmessage = (e) => {
            clearTimeout(timer);
            resolve(e.data);
          };
          worker.postMessage({ id, shapes: [shape], fit: { selected, tolerance: 0.1 } });
        },
      );
    try {
      const valid = await request(1, ['a']),
        invalid = await request(2, ['missing']);
      return {
        id: valid.id,
        anchors: valid.result!.fits[0].fittedAnchors,
        original: valid.result!.fits[0].sourceAnchors,
        holes: valid.result!.shapes[0].contours!.length,
        invalid,
      };
    } finally {
      worker.terminate();
    }
  }, root);
  expect(result.id).toBe(1);
  expect(result.anchors).toBeLessThan(result.original);
  expect(result.holes).toBe(2);
  expect(result.invalid.id).toBe(2);
  expect(result.invalid.error).toContain('missing');
  expect(result.invalid.result).toBeUndefined();
});

test('editor fitting client can abort then complete a fresh request', async ({ page }) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const result = await page.evaluate(async (root) => {
    const { fitContoursInWorker } = await import(
      /* @vite-ignore */ root + '/apps/editor/src/geometry-worker.ts'
    );
    const c = new AbortController();
    const pending = fitContoursInWorker([], [], 0.1, c.signal).catch((e: Error) => e.name);
    c.abort();
    const cancelled = await pending;
    const next = await fitContoursInWorker(
      [
        {
          id: 'square',
          kind: 'polygon',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#000000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
          fillRule: 'evenodd',
          contours: [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
          ],
        },
      ],
      ['square'],
      0.1,
    );
    return { cancelled, id: next.shapes[0].id, count: next.fits.length };
  }, root);
  expect(result).toEqual({ cancelled: 'AbortError', id: 'square', count: 1 });
});
