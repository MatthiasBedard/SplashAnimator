import { createServer, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// A fresh browser context per scenario: never reads or writes the user's artwork.
const production = process.argv.includes('--production');
const measureWorker = process.argv.includes('--measure-worker');
const growth = process.argv.includes('--growth');
const layered = process.argv.includes('--layered');
if (layered && !growth) throw Error('--layered requires --growth.');
const profileRelease = process.argv.includes('--profile-release');
if (profileRelease && !growth) throw Error('--profile-release requires --growth.');
const reportSuffix = process.argv.find((arg) => arg.startsWith('--report-suffix='))?.slice(16);
if (reportSuffix !== undefined && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(reportSuffix))
  throw new Error('Report suffix must contain 1-80 lowercase letters, digits or hyphens.');
const frontend = process.argv.find(arg => arg.startsWith('--frontend='))?.slice(11);
if (frontend && !production) throw new Error('--frontend requires --production.');
const options = {
  configFile: 'apps/editor/vite.config.ts',
  ...(frontend ? { build: { outDir: path.resolve(frontend) } } : {}),
};
const server = production
  ? await preview({ ...options, preview: { port: 1432, strictPort: true } })
  : await createServer({ ...options, server: { port: 1432, strictPort: true } });
let browser;
const measurements = [];
const strokesPerCluster = 12;
const clusterCount = 8;
function seedLayeredScene() {
  const layer = (id, name, shapes) => ({ id, name, visible: true, locked: false,
    drawingMode: 'merge', keys: [{ frame: 0, shapes }] });
  const backing = layer('backing', 'Backing artwork', Array.from({ length: 120 }, (_, i) => ({
    id: 'backing-' + i, kind: 'polygon', x: 62 + i % 15 * 56, y: 66 + Math.floor(i / 15) * 53,
    width: 18, height: 18, rotation: 0, fill: '#d5dfeb', stroke: '#000000', strokeWidth: 0,
    points: [], fillRule: 'evenodd', drawingMode: 'merge',
    contours: [Array.from({ length: 28 }, (_, j) => {
      const angle = j * 2 * Math.PI / 28;
      const radius = j % 2 === 0 ? 9 : 7;
      return { x: 9 + radius * Math.cos(angle), y: 9 + radius * Math.sin(angle) };
    })],
  })));
  return {
    schemaVersion: 59, id: 'brush-layered-fixture', name: 'Layered Brush benchmark',
    width: 960, height: 540, fps: 24, background: '#ffffff', duration: 48,
    layers: [layer('brush', 'Brush artwork', []), backing], assets: [],
  };
}
function percentiles(values) {
  const lastMs = values.at(-1) ?? null;
  values.sort((a, b) => a - b);
  return {
    p50Ms: values[Math.floor((values.length - 1) * 0.5)] ?? null,
    p95Ms: values[Math.floor((values.length - 1) * 0.95)] ?? null,
    lastMs,
    count: values.length,
  };
}
try {
  if (!production) await server.listen();
  browser = await chromium.launch();
  for (const scenario of growth ? [layered ? 'alternating-layered-clusters' : 'alternating-growing-clusters'] : ['same-paint-crossing', 'alternating-crossing']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const seed = layered ? seedLayeredScene() : undefined;
    if (seed) await page.addInitScript(project => {
      if (!localStorage.getItem('splash-recovery-v1'))
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }, seed);
    const profiler = profileRelease ? await context.newCDPSession(page) : undefined;
    await profiler?.send('Profiler.enable');
    async function dismissSplash(ready) {
      const launch = page.getByRole('button', { name: 'Open editor', exact: true });
      await expect(launch.or(ready).first()).toBeVisible();
      if (await launch.isVisible()) await launch.click();
    }
    const samples = [];
    let failure;
    try {
      await page.goto('http://127.0.0.1:1432');
      const brush = page.getByRole('button', { name: 'Brush', exact: true });
      const recover = page.getByRole('button', { name: 'Recover changes' });
      if (seed) {
        await dismissSplash(recover);
        await recover.click();
      }
      await dismissSplash(brush);
      await brush.click();
      await page.getByLabel('Brush size', { exact: true }).fill('24');
      const stage = page.getByLabel('Drawing stage');
      const box = await stage.boundingBox();
      await page.evaluate(({ measureWorker, growth }) => {
        const probe = { armed: false, current: null, pendingInput: null, preview: [] };
        window.brushProbe = probe;
        document.addEventListener(
          'pointerup',
          (event) => {
            if (!probe.armed || event.target.getAttribute('aria-label') !== 'Drawing stage') return;
            probe.armed = false;
            probe.current = { start: performance.now(), workers: [] };
          },
          true,
        );
        const isStage = canvas => canvas?.getAttribute('aria-label') === 'Drawing stage';
        document.addEventListener('pointermove', event => {
          if ((event.buttons & 1) && isStage(event.target)) probe.pendingInput ??= performance.now();
        }, true);
        const colored = new WeakSet();
        const fill = CanvasRenderingContext2D.prototype.fillRect;
        CanvasRenderingContext2D.prototype.fillRect = function (...args) {
          if (this.globalCompositeOperation === 'source-in') colored.add(this.canvas);
          const sample = probe.current;
          if (growth && sample?.recoveryMs !== undefined && sample.redrawMs === undefined &&
            !isStage(this.canvas) && this.fillStyle === '#ffffff' && args[0] > 0 && args[1] > 0 &&
            this.getTransform().isIdentity) {
            sample.backdropPatchPixels = (sample.backdropPatchPixels ?? 0) + args[2] * args[3];
          }
          return Reflect.apply(fill, this, args);
        };
        const restore = CanvasRenderingContext2D.prototype.restore;
        let brushComposite = false;
        CanvasRenderingContext2D.prototype.restore = function () {
          const result = restore.call(this);
          if (brushComposite && isStage(this.canvas)) {
            probe.preview.push(performance.now() - probe.pendingInput);
            probe.pendingInput = null;
            brushComposite = false;
          }
          return result;
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            // Register before the application's onmessage callback, which commits
            // history/recovery and can flush rendering before later listeners run.
            this.addEventListener(
              'message',
              (event) => {
                if (this.brushTiming) {
                  this.brushTiming.elapsedMs = performance.now() - this.brushTiming.start;
                  if (growth && Array.isArray(event.data?.result?.shapes))
                    this.brushTiming.reusedRoots = event.data.result.shapes.filter(s => typeof s === 'number').length;
                  if (measureWorker) {
                    const timing = event.data?.brushTiming;
                    if (timing) {
                      this.brushTiming.initializationMs = timing.initializedAt - this.brushTiming.createdAt;
                      this.brushTiming.awaitingReadyMs = Math.max(0, timing.initializedAt - this.brushTiming.sentAt);
                      this.brushTiming.requestDeliveryMs = timing.geometryStart - Math.max(timing.initializedAt, this.brushTiming.sentAt);
                      this.brushTiming.geometryMs = timing.geometryEnd - timing.geometryStart;
                      this.brushTiming.phases = timing.phases;
                      this.brushTiming.responseDeliveryMs = performance.timeOrigin + performance.now() - timing.geometryEnd;
                    }
                  }
                }
              },
              { once: true },
            );
            this.createdAt = performance.timeOrigin + performance.now();
          }
          postMessage(...args) {
            const sample = probe.current;
            let measured;
            if (sample && sample.redrawMs === undefined) {
              const worker = { start: performance.now() };
              if (measureWorker && args[0]?.brushCommit) {
                worker.createdAt = this.createdAt;
                worker.sentAt = performance.timeOrigin + worker.start;
                args[0] = { ...args[0], measureBrush: true };
              }
              sample.workers.push(worker);
              this.brushTiming = worker;
              if (growth && args[0]?.brushCommit) measured = worker;
            }
            const result = super.postMessage(...args);
            if (measured) measured.postMessageMs = performance.now() - measured.start;
            return result;
          }
        };
        const save = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          const start = performance.now();
          const result = Reflect.apply(save, this, [key, value]);
          const sample = probe.current;
          if (
            this === localStorage &&
            key === 'splash-recovery-v1' &&
            sample &&
            sample.recoveryMs === undefined
          ) {
            sample.storageWriteMs = performance.now() - start;
            sample.recoveryMs = performance.now() - sample.start;
            sample.recoveryCharacters = value.length;
          }
          return result;
        };
        if (growth) {
          const setTimer = window.setTimeout;
          window.setTimeout = function (callback, delay, ...args) {
            const sample = probe.current;
            // The drawing queue yields with a zero-delay Promise resolver.
            if (sample && !sample.workers.length && !sample.releaseTimer && delay === 0 &&
              typeof callback === 'function' && Function.prototype.toString.call(callback) === 'function () { [native code] }') {
              const timer = sample.releaseTimer = { scheduledMs: performance.now() - sample.start };
              return Reflect.apply(setTimer, this, [function (...values) {
                timer.waitMs = performance.now() - sample.start - timer.scheduledMs;
                return Reflect.apply(callback, this, values);
              }, delay, ...args]);
            }
            return Reflect.apply(setTimer, this, [callback, delay, ...args]);
          };
          const parse = JSON.parse;
          JSON.parse = function (...args) {
            const sample = probe.current;
            if (!sample || sample.workers.length || typeof args[0] !== 'string') return Reflect.apply(parse, JSON, args);
            const start = performance.now(), result = Reflect.apply(parse, JSON, args);
            if (Array.isArray(result?.layers) && typeof result.duration === 'number')
              sample.sourceDecodeMs = (sample.sourceDecodeMs ?? 0) + performance.now() - start;
            return result;
          };
          const stringify = JSON.stringify;
          JSON.stringify = function (...args) {
            const sample = probe.current;
            const value = args[0];
            if (sample?.workers[0]?.elapsedMs !== undefined && sample.recoveryMs === undefined &&
              value && Array.isArray(value.layers) && typeof value.duration === 'number') {
              const start = performance.now();
              const encoded = Reflect.apply(stringify, JSON, args);
              sample.publicationProjectSerializations = (sample.publicationProjectSerializations ?? 0) + 1;
              (sample.publicationEncodingMs ??= []).push(performance.now() - start);
              return encoded;
            }
            return Reflect.apply(stringify, JSON, args);
          };
        }
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          const result = Reflect.apply(draw, this, args);
          if (probe.pendingInput !== null && isStage(this.canvas) && colored.has(args[0])) brushComposite = true;
          const sample = probe.current;
          if (
            sample?.recoveryMs !== undefined &&
            sample.redrawMs === undefined &&
            this.canvas.getAttribute('aria-label') === 'Drawing stage'
          ) {
            sample.redrawMs = performance.now() - sample.start;
          }
          return result;
        };
      }, { measureWorker, growth });
      const read = () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project.layers[0]
              .keys[0].shapes ?? [],
        );
      let previous = [];
      const strokeCount = growth ? strokesPerCluster * clusterCount : 24;
      for (let i = 0; i < strokeCount; i++) {
        previous = await read();
        await page.evaluate(() => {
          window.brushProbe.pendingInput = null;
          window.brushProbe.preview = [];
        });
        await page
          .getByLabel('Drawing fill', { exact: true })
          .fill(scenario.startsWith('alternating') && i % 2 ? '#cc4411' : '#224488');
        const cluster = Math.floor(i / strokesPerCluster);
        const steps = growth ? 24 : 40;
        const left = growth ? box.width * (0.15 + (cluster % 3) * 0.26) : 250;
        const width = growth ? box.width * 0.18 : 400;
        const center = growth ? box.height * (0.23 + Math.floor(cluster / 3) * 0.25) : 240;
        const amplitude = growth ? box.height * 0.045 : 55;
        const pass = growth ? i % strokesPerCluster : i;
        for (let j = 0; j <= steps; j++) {
          await page.mouse.move(box.x + left + j * width / steps, box.y + center + Math.sin(j / 6 + pass * 0.4) * amplitude);
          if (!j) await page.mouse.down();
        }
        await page.evaluate(() => {
          window.brushProbe.armed = true;
          window.brushProbe.current = null;
          window.brushProbe.pendingInput = null;
        });
        const capturing = profiler && i === strokeCount - 1;
        if (capturing) await profiler.send('Profiler.start');
        await page.mouse.up();
        await page.waitForFunction(() => window.brushProbe.current?.redrawMs !== undefined, null, {
          timeout: 20000,
        });
        if (capturing) {
          const { profile } = await profiler.send('Profiler.stop');
          await mkdir('target', { recursive: true });
          await writeFile(
            `target/brush-${reportSuffix ?? 'growth'}-release.cpuprofile`,
            JSON.stringify(profile),
          );
        }
        const sample = await page.evaluate(() => ({ ...window.brushProbe.current, previewMs: window.brushProbe.preview }));
        expect(sample.previewMs.length).toBeGreaterThan(0);
        expect(sample.workers).toHaveLength(1);
        expect(Number.isFinite(sample.workers[0].elapsedMs)).toBe(true);
        if (measureWorker) {
          for (const key of ['initializationMs', 'awaitingReadyMs', 'requestDeliveryMs', 'geometryMs', 'responseDeliveryMs']) {
            expect(Number.isFinite(sample.workers[0][key]), key).toBe(true);
            expect(sample.workers[0][key], key).toBeGreaterThanOrEqual(-1); // Independent browser clock resolution.
          }
          const phases = sample.workers[0].phases;
          expect(phases?.[0]?.phase).toBe('footprint');
          expect(phases.every(({ elapsedMs }) => Number.isFinite(elapsedMs) && elapsedMs >= 0)).toBe(true);
        }
        expect(
          sample.workers[0].start - sample.start + sample.workers[0].elapsedMs,
        ).toBeLessThanOrEqual(sample.recoveryMs);
        expect(sample.redrawMs).toBeGreaterThanOrEqual(sample.recoveryMs);
        const shapes = await read();
        expect(shapes).not.toEqual(previous);
        expect(shapes.length).toBeGreaterThan(0);
        expect(shapes.every((s) => s.kind === 'polygon' && s.strokeWidth === 0)).toBe(true);
        await expect(page.getByRole('alert')).toHaveCount(0);
        samples.push({
          stroke: i + 1,
          ...sample,
          artworkHash: createHash('sha256').update(JSON.stringify(shapes.map(({ id: _id, ...artwork }) => artwork))).digest('hex'),
          shapes: shapes.length,
          anchors: shapes.reduce(
            (n, s) => n + (s.contours?.reduce((m, r) => m + r.length, 0) ?? s.points.length),
            0,
          ),
        });
      }
      if (growth) expect(samples.at(-1).anchors).toBeGreaterThan(samples[strokesPerCluster - 1].anchors * 4);
      const final = await read();
      const backing = () => page.evaluate(() =>
        JSON.parse(localStorage.getItem('splash-recovery-v1')).project.layers[1]);
      if (seed) expect(await backing()).toEqual(seed.layers[1]);
      await stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(previous);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(read).toEqual(final);
      await page.reload();
      await dismissSplash(recover);
      await recover.click();
      await expect.poll(read).toEqual(final);
      // Exercise recovered artwork, rather than only inspecting its storage payload.
      await brush.click();
      const recoveredBox = await stage.boundingBox();
      await page.mouse.move(recoveredBox.x + 270, recoveredBox.y + 340);
      await page.mouse.down();
      await page.mouse.move(recoveredBox.x + 450, recoveredBox.y + 340, { steps: 10 });
      await page.mouse.up();
      await expect.poll(read).not.toEqual(final);
      await stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(final);
      if (seed) expect(await backing()).toEqual(seed.layers[1]);
      await expect(page.getByRole('alert')).toHaveCount(0);
    } catch (error) {
      failure = { stroke: samples.length + 1, message: String(error), stack: error.stack };
    } finally {
      await context.close();
    }
    const summary = (key) => percentiles(samples.slice(4).flatMap(s => s[key]));
    const clusterSummary = (cluster) => {
      const first = cluster * strokesPerCluster;
      const window = samples.slice(first + 4, first + strokesPerCluster);
      return {
        firstStroke: window[0]?.stroke,
        lastStroke: window.at(-1)?.stroke,
        shapes: window.at(-1)?.shapes,
        anchors: window.at(-1)?.anchors,
        backdropPatches: window.filter(s => s.backdropPatchPixels > 0).length,
        publicationProjectSerializations: window.map(s => s.publicationProjectSerializations ?? 0),
        publicationEncoding: Array.from({ length: Math.max(0, ...window.map(s => s.publicationEncodingMs?.length ?? 0)) },
          (_, index) => percentiles(window.flatMap(s => s.publicationEncodingMs?.[index] ?? []))),
        inputToPreview: percentiles(window.flatMap(s => s.previewMs)),
        redraw: percentiles(window.map(s => s.redrawMs)),
        dispatch: percentiles(window.map(s => s.workers[0].start - s.start)),
        releaseTimer: {
          scheduled: percentiles(window.flatMap(s => s.releaseTimer ? [s.releaseTimer.scheduledMs] : [])),
          wait: percentiles(window.flatMap(s => s.releaseTimer?.waitMs !== undefined ? [s.releaseTimer.waitMs] : [])),
        },
        sourceDecode: percentiles(window.flatMap(s => s.sourceDecodeMs !== undefined ? [s.sourceDecodeMs] : [])),
        workerPostMessage: percentiles(window.flatMap(s => s.workers[0].postMessageMs !== undefined ? [s.workers[0].postMessageMs] : [])),
        worker: percentiles(window.map(s => s.workers[0].elapsedMs)),
        publish: percentiles(window.map(s =>
          s.recoveryMs - (s.workers[0].start - s.start + s.workers[0].elapsedMs)
        )),
      };
    };
    measurements.push({
      scenario,
      failure,
      inputToPreview: summary('previewMs'),
      recovery: summary('recoveryMs'),
      redraw: summary('redrawMs'),
      storageWrite: summary('storageWriteMs'),
      ...(growth ? { early: clusterSummary(0), late: clusterSummary(clusterCount - 1) } : {}),
      samples,
    });
  }
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    browser: browser.version(),
    mode: production ? 'production' : 'development',
    measurements,
    limitations: [
      growth
        ? '96 synthetic mouse strokes in eight spatial clusters. Early and late compare the final eight strokes of the first and last clusters. No physical stylus input.'
        : '24 synthetic mouse strokes per scenario; first four excluded from summaries. No physical pressure or stylus input.',
      ...(layered ? ['The second visible layer holds 120 stationary 28-anchor shapes.'] : []),
      'Preview timing is from the first pending captured pointermove to the end of the Brush bitmap composite. Release timing is from capture-phase pointerup to recovery write and first subsequent stage drawImage completion. Both exclude compositor and display latency.',
      'Worker intervals start at postMessage, excluding construction. Storage timing excludes JSON serialization; overall recovery timing includes it. Instrumentation adds overhead.',
      'Single headless run; no acceptance thresholds or native/device/large-project qualification. Undo/redo and recovery followed by another stroke and undo checked after each scenario, outside timing samples.',
      ...(profileRelease ? ['CPU sampling was enabled during the last release.'] : []),
    ],
  };
  await mkdir('.local-docs/benchmarks', { recursive: true });
  await writeFile(
    `.local-docs/benchmarks/brush-editor-${report.mode}${reportSuffix ? `-${reportSuffix}` : ''}.json`,
    JSON.stringify(report, null, 2) + '\n',
    reportSuffix ? { flag: 'wx' } : undefined,
  );
  console.log(
    JSON.stringify(
      { ...report, measurements: measurements.map(({ samples: _samples, ...rest }) => rest) },
      null,
      2,
    ),
  );
  if (measurements.some((m) => m.failure)) process.exitCode = 1;
} finally {
  await browser?.close();
  if (production)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  else await server.close();
}
