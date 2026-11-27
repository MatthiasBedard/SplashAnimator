import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

// Synthetic authoring-path smoke benchmark, not physical pen latency or low-end qualification.
const server = await createServer({ configFile: 'apps/editor/vite.config.ts' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const start = performance.now();
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const startupMs = performance.now() - start;
  const pencil = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas[aria-label="Drawing stage"]');
    const bounds = canvas.getBoundingClientRect();
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const begin = performance.now();
      const event = (type, point) =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: 'pen',
          pressure: 0.5,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: bounds.x + 300 + point * 2,
          clientY: bounds.y + 150 + i * 4 + Math.sin(point / 4) * 12,
        });
      // Untrusted synthetic events cannot establish real pointer capture. Provide only the
      // capture operation for this benchmark; production pointer handling is untouched.
      const capture = canvas.setPointerCapture;
      canvas.setPointerCapture = () => {};
      canvas.dispatchEvent(event('pointerdown', 0));
      for (let p = 1; p <= 30; p++) canvas.dispatchEvent(event('pointermove', p));
      canvas.dispatchEvent(event('pointerup', 30));
      canvas.setPointerCapture = capture;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      samples.push(performance.now() - begin);
    }
    return samples;
  });
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Escape');
  await page.getByLabel('Frames', { exact: true }).fill('100000');
  await page.getByLabel('Frames', { exact: true }).press('Tab');
  const timeline = await page.evaluate(async () => {
    const slider = document.querySelector('input[aria-label="Timeline scroll"]');
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const begin = performance.now();
      slider.value = String(i * 3000);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      samples.push(performance.now() - begin);
    }
    return samples;
  });
  const memory = await page.evaluate(() =>
    performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null,
  );
  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      rawMs: values,
    };
  };
  const report = {
    recordedAt: new Date().toISOString(),
    environment: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
      logicalCores: os.cpus().length,
      ramGiB: Math.round(os.totalmem() / 2 ** 30),
      node: process.version,
      browser: browser.version(),
      headless: true,
    },
    limitations: [
      'Warm development-server startup, including navigation and first tool selection; not native cold startup.',
      'Synthetic 30-sample uniform pencil strokes to two requestAnimationFrame callbacks, not physical stylus/brush input-to-photon latency.',
      'Timeline has 100000 frames but only one layer; no claim of 1000-layer qualification.',
      'Chromium JS heap estimate only, not OS resident memory or GPU memory. No low-end-device claim.',
    ],
    startupMs,
    pencilStrokeToTwoAnimationFrames: summarize(pencil),
    timelineScrollToTwoAnimationFrames: summarize(timeline),
    memory,
  };
  await mkdir('.local-docs/benchmarks', { recursive: true });
  await writeFile('.local-docs/benchmarks/local-machine.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        startupMs,
        pencilP95Ms: report.pencilStrokeToTwoAnimationFrames.p95Ms,
        timelineP95Ms: report.timelineScrollToTwoAnimationFrames.p95Ms,
        memory,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
