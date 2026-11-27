import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const server = await createServer({
  configFile: 'apps/editor/vite.config.ts',
  server: { port: 1430, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:1430');
  const root = '/@fs/' + process.cwd().replaceAll('\\', '/');
  const measurements = await page.evaluate(async (root) => {
    const { drawShape } = await import(root + '/packages/stage/src/index.ts');
    const { StageBackdrop } = await import(root + '/packages/stage/src/backdrop.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const results = [];
    for (const count of [20, 120, 400]) {
      const shapes = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        kind: 'polygon',
        x: 20 + (i % 20) * 55,
        y: 20 + Math.floor(i / 20) * 35,
        width: 80,
        height: 35,
        rotation: 0,
        fill: ['#38277f', '#276b85', '#c65555'][i % 3],
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        contours: [
          Array.from({ length: 256 }, (_, j) => {
            const a = (j * Math.PI * 2) / 256;
            return { x: 40 + Math.cos(a) * 38, y: 18 + Math.sin(a) * (12 + Math.sin(a * 7) * 2) };
          }),
        ],
      }));
      const scene = (c) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 1200, 800);
        shapes.forEach((s) => drawShape(c, s));
      };
      const cache = new StageBackdrop();
      const samples = { redraw: [], backdrop: [] };
      for (let i = 0; i < 65; i++)
        for (const mode of i % 2 ? ['backdrop', 'redraw'] : ['redraw', 'backdrop']) {
          const begin = performance.now();
          ctx.clearRect(0, 0, 1200, 800);
          if (mode === 'redraw') scene(ctx);
          else cache.draw(ctx, 1200, 800, 'scene', scene);
          ctx.fillStyle = '#111111';
          ctx.fillRect(10 + i, 10, 20, 4);
          // Readback forces completion; these timings include readback, not display latency.
          ctx.getImageData(0, 0, 1, 1);
          if (i >= 5) samples[mode].push(performance.now() - begin);
        }
      const summary = (values) => {
        values.sort((a, b) => a - b);
        return { p50Ms: values[30], p95Ms: values[57] };
      };
      results.push({
        shapes: count,
        vertices: count * 256,
        redraw: summary(samples.redraw),
        backdrop: summary(samples.backdrop),
      });
    }
    return results;
  }, root);
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    browser: browser.version(),
    measurements,
    limitations: [
      'Headless Chromium, synthetic merged contours; not native, stylus or input-to-photon qualification.',
      '60 measured redraws per mode, five warmups, alternating order; includes one-pixel readback.',
      'Baseline already uses vector command and Path2D caches. Scene image remains unchanged; commit/merge and live draft geometry cost are excluded.',
    ],
  };
  await mkdir('.local-docs/benchmarks', { recursive: true });
  await writeFile('.local-docs/benchmarks/brush-redraw.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
