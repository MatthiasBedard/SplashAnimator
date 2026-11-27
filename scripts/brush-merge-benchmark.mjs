import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const server = await createServer({
  configFile: 'apps/editor/vite.config.ts',
  server: { port: 1431, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:1431');
  const measurements = await page.evaluate(
    async (root) => {
      const { mergeVectors, vectorPolygons } = await import(
        root + '/packages/geometry/src/merge.ts'
      );
      const { mergeInWorker } = await import(root + '/apps/editor/src/geometry-worker.ts');
      const results = [];
      for (const scenario of [
        'same-paint-crossing',
        'alternating-crossing',
        'same-paint-disjoint',
      ]) {
        let shapes = [];
        const samples = [];
        let failure;
        for (let i = 0; i < 24; i++) {
          const stroke = {
            id: 'stroke-' + i,
            kind: 'brush',
            x: scenario.endsWith('disjoint') ? (i % 6) * 850 : 0,
            y: scenario.endsWith('disjoint') ? Math.floor(i / 6) * 240 : 0,
            width: 800,
            height: 200,
            rotation: 0,
            fill: scenario.startsWith('alternating') && i % 2 ? '#cc4411' : '#224488',
            stroke: '#000000',
            strokeWidth: 24,
            brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
            points: Array.from({ length: 81 }, (_, j) => ({
              x: 20 + j * 9,
              y: 100 + Math.sin(j / 10 + i * 0.4) * 60,
              pressure: 0.35 + j / 130,
            })),
          };
          try {
            const input = [...shapes, stroke];
            let t = performance.now();
            input.forEach(vectorPolygons);
            const preparationMs = performance.now() - t;
            t = performance.now();
            const direct = mergeVectors(input);
            const geometryMs = performance.now() - t;
            t = performance.now();
            shapes = await mergeInWorker(input);
            const workerMs = performance.now() - t;
            if (!direct.length || !shapes.length) throw Error('Missing merged paint');
            samples.push({
              stroke: i + 1,
              preparationMs,
              geometryMs,
              workerMs,
              shapes: shapes.length,
              anchors: shapes.reduce(
                (n, s) => n + (s.contours?.reduce((m, r) => m + r.length, 0) ?? s.points.length),
                0,
              ),
            });
          } catch (error) {
            failure = { stroke: i + 1, message: String(error), stack: error.stack };
            break;
          }
        }
        const summary = (key) => {
          const values = samples
            .slice(4)
            .map((s) => s[key])
            .sort((a, b) => a - b);
          return {
            p50Ms: values[Math.floor((values.length - 1) * 0.5)] ?? null,
            p95Ms: values[Math.floor((values.length - 1) * 0.95)] ?? null,
            lastMs: samples.at(-1)?.[key] ?? null,
          };
        };
        results.push({
          scenario,
          failure,
          preparation: summary('preparationMs'),
          geometry: summary('geometryMs'),
          worker: summary('workerMs'),
          samples,
        });
      }
      return results;
    },
    '/@fs/' + process.cwd().replaceAll('\\', '/'),
  );
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    browser: browser.version(),
    measurements,
    limitations: [
      '24 synthetic sequential commits per scenario; first four excluded from summaries.',
      'Geometry timing excludes worker startup; worker timing includes startup, imports and message cloning in development.',
      'Not UI history/recovery/redraw, input-to-photon, native or physical stylus qualification. Timings are observations, not acceptance thresholds.',
    ],
  };
  await mkdir('.local-docs/benchmarks', { recursive: true });
  await writeFile(
    '.local-docs/benchmarks/' + (process.argv[2] ?? 'brush-merge') + '.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      { ...report, measurements: measurements.map(({ samples: _samples, ...rest }) => rest) },
      null,
      2,
    ),
  );
  if (measurements.some((result) => result.failure)) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
