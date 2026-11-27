import { test, expect } from '@playwright/test';
import type { Vector } from '../../packages/document/src';
test('cached Canvas paths match uncached pixels through geometry and paint edits', async ({
  page,
}) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const result = await page.evaluate(async (root) => {
    const { renderData, canvasPath, paintCommands } = await import(
      /* @vite-ignore */ root + '/packages/stage/src/render-data.ts'
    );
    const { wrapText } = await import(
      /* @vite-ignore */ root + '/packages/geometry/src/text-layout.ts'
    );
    const a = document.createElement('canvas'),
      b = document.createElement('canvas');
    a.width = b.width = 240;
    a.height = b.height = 180;
    const ca = a.getContext('2d')!,
      cb = b.getContext('2d')!;
    const s: Vector = {
      id: 'pixel',
      kind: 'polygon',
      x: 30,
      y: 30,
      width: 130,
      height: 100,
      rotation: 12,
      transform: [1, 0.1, 0.2, 0.8],
      fill: '#ee2200',
      stroke: '#0022ff',
      strokeWidth: 3,
      fillRule: 'evenodd',
      points: [],
      contours: [
        [
          { x: 0, y: 0 },
          { x: 130, y: 0 },
          { x: 130, y: 100 },
          { x: 0, y: 100 },
        ],
        [
          { x: 30, y: 30 },
          { x: 60, y: 30 },
          { x: 60, y: 60 },
          { x: 30, y: 60 },
        ],
      ],
    };
    const results = [];
    let previous: Path2D | undefined;
    for (let i = 0; i < 5; i++) {
      if (i === 1) {
        s.fill = '#00ee22';
        s.opacity = 0.6;
        s.x += 8;
      }
      if (i === 2) s.contours![0][1].x = 100;
      if (i === 3)
        s.gradient = {
          kind: 'linear',
          from: { x: 0, y: 0 },
          to: { x: 130, y: 80 },
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' },
          ],
        };
      if (i === 4) s.gradient!.transform = [1, 0.3, 0.4, 0.8];
      const data = renderData(s),
        path = canvasPath(data);
      if (i === 1 && path !== previous) throw Error('paint edit rebuilt path');
      if (i === 2 && path === previous) throw Error('geometry edit reused path');
      if (i === 4 && path) throw Error('gradient needs current-path replay');
      ca.clearRect(0, 0, 240, 180);
      cb.clearRect(0, 0, 240, 180);
      paintCommands(ca, data, wrapText, undefined, undefined, path);
      paintCommands(cb, data, wrapText);
      const aa = ca.getImageData(0, 0, 240, 180).data,
        bb = cb.getImageData(0, 0, 240, 180).data;
      results.push(aa.every((v, j) => v === bb[j]));
      previous = path;
    }
    return results;
  }, root);
  expect(result).toEqual([true, true, true, true, true]);
});

test('viewport backdrop reuses pixels, invalidates and recovers from failed paints', async ({
  page,
}) => {
  await page.goto('/');
  const path = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/packages/stage/src/backdrop.ts';
  const result = await page.evaluate(async (path) => {
    const { StageBackdrop } = await import(/* @vite-ignore */ path);
    const cache = new StageBackdrop(),
      canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const ctx = canvas.getContext('2d')!;
    let paints = 0;
    const paint = (c: CanvasRenderingContext2D) => {
      paints++;
      c.fillStyle = '#ff0000';
      c.fillRect(4, 4, 20, 20);
    };
    const draw = (key: string | null, w = 80, sourceKey?: string) => {
      ctx.clearRect(0, 0, 80, 60);
      cache.draw(ctx, w, 60, key, paint, sourceKey);
    };
    ctx.translate(10, 10);
    draw('a');
    draw('a');
    const reused = paints === 1;
    const pixel = Array.from(ctx.getImageData(8, 8, 1, 1).data),
      transform = ctx.getTransform().e;
    draw('b');
    draw('b', 70);
    draw(null, 70);
    draw(null, 70);
    const invalidated = paints === 5;
    let failed = false;
    try {
      cache.draw(ctx, 70, 60, 'failure', () => {
        throw Error('fixture');
      });
    } catch {
      failed = true;
    }
    draw('failure', 70);
    const retried = paints === 6;
    draw('failure', 70, 'document-a');
    draw('failure', 70, 'document-a');
    draw('failure', 70, 'document-b');
    return { reused, pixel, transform, invalidated, failed, retried, sourceInvalidated: paints === 8 };
  }, path);
  expect(result).toEqual({
    reused: true,
    pixel: [255, 0, 0, 255],
    transform: 10,
    invalidated: true,
    failed: true,
    retried: true,
    sourceInvalidated: true,
  });
});

test('adaptive pressure sweeps render soft and firm widths against the analytic response', async ({
  page,
}) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const widths = await page.evaluate(async (root) => {
    const { drawShape } = await import(/* @vite-ignore */ root + '/packages/stage/src/index.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 1700;
    canvas.height = 150;
    const ctx = canvas.getContext('2d')!;
    const results = [];
    for (const response of [0.25, 0.5, 2, 4]) {
      const s: Vector = {
        id: 'ramp',
        kind: 'brush',
        x: 20,
        y: 75,
        width: 1600,
        height: 0,
        rotation: 0,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 80,
        brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0, response },
        points: [
          { x: 0, y: 0, pressure: 0 },
          { x: 1600, y: 0, pressure: 1 },
        ],
      };
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1700, 150);
      drawShape(ctx, s);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const data = ctx.getImageData(20 + 1600 * fraction, 0, 1, 150).data;
        let width = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) width++;
        results.push({ width, expected: 80 * (0.1 + 0.9 * fraction ** response) });
      }
    }
    return results;
  }, root);
  for (const { width, expected } of widths) expect(Math.abs(width - expected)).toBeLessThan(2);
});

test('stationary narrow-nib rotation paints the swept quadrant', async ({ page }) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const pixels = await page.evaluate(async (root) => {
    const { drawShape } = await import(/* @vite-ignore */ root + '/packages/stage/src/index.ts');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 100);
    const s: Vector = {
      id: 'turn',
      kind: 'brush',
      x: 50,
      y: 50,
      width: 0,
      height: 0,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 40,
      brush: { pressure: false, minimum: 0.1, tilt: false, twist: true, aspect: 0.2, angle: 0 },
      points: [
        { x: 0, y: 0, twist: 0 },
        { x: 0, y: 0, twist: 90 },
      ],
    };
    drawShape(ctx, s);
    return [ctx.getImageData(62, 62, 1, 1).data[0], ctx.getImageData(38, 62, 1, 1).data[0]];
  }, root);
  expect(pixels[0]).toBe(0);
  expect(pixels[1]).toBe(255);
});

test('standalone curve-fit nodes render a compact outline through the existing Canvas renderer', async ({
  page,
}) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const result = await page.evaluate(async (root) => {
    const { fitPolyline } = await import(
      /* @vite-ignore */ root + '/packages/geometry/src/curve-fit.ts'
    );
    const { drawShape } = await import(/* @vite-ignore */ root + '/packages/stage/src/index.ts');
    const points = Array.from({ length: 256 }, (_, i) => ({
      x: 100 + 100 * Math.cos((i * Math.PI) / 128),
      y: 70 + 70 * Math.sin((i * Math.PI) / 128),
    }));
    const fit = fitPolyline(points, 0.25, true),
      a = document.createElement('canvas'),
      b = document.createElement('canvas');
    a.width = b.width = 240;
    a.height = b.height = 180;
    const shape: Vector = {
      id: 'fit',
      kind: 'polygon',
      x: 20,
      y: 20,
      width: 200,
      height: 140,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points,
      closed: true,
    };
    const ca = a.getContext('2d')!,
      cb = b.getContext('2d')!;
    drawShape(ca, shape);
    drawShape(cb, { ...shape, kind: 'bezier', points: [], nodes: fit.nodes });
    const aa = ca.getImageData(0, 0, 240, 180).data,
      bb = cb.getImageData(0, 0, 240, 180).data;
    let different = 0;
    for (let i = 3; i < aa.length; i += 4) if (Math.abs(aa[i] - bb[i]) > 32) different++;
    return { anchors: fit.nodes.length, different, center: cb.getImageData(120, 90, 1, 1).data[3] };
  }, root);
  expect(result.anchors).toBeLessThan(32);
  expect(result.different).toBeLessThan(400);
  expect(result.center).toBe(255);
});

test('standalone compound fitting retains hole and island pixels', async ({ page }) => {
  await page.goto('/');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const result = await page.evaluate(async (root) => {
    const { fitCompoundContours } = await import(
      /* @vite-ignore */ root + '/packages/geometry/src/compound-fit.ts'
    );
    const { paintCommands } = await import(
      /* @vite-ignore */ root + '/packages/stage/src/render-data.ts'
    );
    const { wrapText } = await import(
      /* @vite-ignore */ root + '/packages/geometry/src/text-layout.ts'
    );
    const circle = (r: number) =>
      Array.from({ length: 128 }, (_, i) => ({
        x: r * Math.cos((i * Math.PI) / 64),
        y: r * Math.sin((i * Math.PI) / 64),
      }));
    const fit = fitCompoundContours([circle(100), circle(60).reverse(), circle(25)], 0.1);
    const commands = fit.rings.flatMap(
      (r: {
        curves: [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ][];
      }) => [
        ['M', r.curves[0][0].x, r.curves[0][0].y],
        ...r.curves.map((c) => ['C', c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y]),
        ['Z'],
      ],
    );
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 240, 240);
    paintCommands(
      ctx,
      {
        id: 'compound',
        kind: 'polygon',
        x: 120,
        y: 120,
        width: 200,
        height: 200,
        rotation: 0,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 0,
        fillRule: 'evenodd',
        closed: true,
        commands,
      },
      wrapText,
    );
    return {
      parents: fit.parents,
      pixels: [200, 170, 130, 235].map((x) => ctx.getImageData(x, 120, 1, 1).data[0]),
    };
  }, root);
  expect(result).toEqual({ parents: [-1, 0, 1], pixels: [0, 255, 0, 255] });
});
