import { expect, test } from '@playwright/test';
import { newLayer, newProject, type Vector } from '../../packages/document/src';
import { expectExportStatus, openExportSettings } from './export-settings';

test('late selected 4K PNG range preserves replay, provisional storage and exact decoded pixels', async ({
  page,
}) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  const project = newProject();
  project.duration = 500;
  project.width = 1920;
  project.height = 1080;
  const rect = (id: string, fill: string): Vector => ({
    id,
    kind: 'rectangle',
    x: 100,
    y: 100,
    width: 80,
    height: 80,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  const root = rect('root', '#ff0000');
  project.layers[0].keys = [
    { frame: 0, shapes: [root] },
    { frame: 484, shapes: [{ ...root, x: 250 }] },
  ];
  const blue = { ...rect('child', '#0000ff'), x: 0, y: 0 };
  project.symbols = [
    {
      id: 'child',
      name: 'Child',
      width: 80,
      height: 80,
      shapes: [blue],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...blue, fill: '#00ff00' }] }] },
    },
  ];
  const instance: Vector = {
    ...rect('instance', '#000000'),
    kind: 'symbol',
    symbolId: 'child',
    x: 500,
    symbolPlayback: { mode: 'movie', firstFrame: 1 },
  };
  project.layers.push({
    ...newLayer('Movie'),
    keys: [
      { frame: 0, shapes: [instance] },
      { frame: 477, shapes: [] },
      { frame: 479, shapes: [instance] },
    ],
  });
  project.frameScripts = [
    { frame: 0, source: 'throw Error("Export must not run authored scripts");' },
  ];
  await page.addInitScript(
    ({ project, license }) => {
      const top = window.top!;
      if (window === top) {
        localStorage.setItem('splash-license-v1', license!);
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
        const state = {
          hold: true,
          held: false,
          cancelWarmup: true,
          aborts: 0,
          closes: 0,
          steps: 0,
          encodeCount: 0,
          dispatchMs: 0,
          replayStart: 0,
          firstEncode: 0,
          encodeMs: 0,
          sinkMs: 0,
          started: 0,
          finished: 0,
          heapStart: 0,
          heapPeak: 0,
          heapDone: 0,
          handle: undefined as FileSystemFileHandle | undefined,
        };
        Reflect.set(top, 'highresPngProbe', state);
        const heap = () =>
          (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize ?? 0;
        Reflect.set(top, 'sampleHighresHeap', () => {
          state.heapPeak = Math.max(state.heapPeak, heap());
        });
        Reflect.set(window, 'showSaveFilePicker', async () => {
          const directory = await navigator.storage.getDirectory();
          const handle = await directory.getFileHandle('highres-png-export.zip', { create: true });
          if (!state.handle) {
            const seed = await handle.createWritable();
            await seed.write('previous export');
            await seed.close();
            state.handle = handle;
          }
          state.started = performance.now();
          state.heapStart = state.heapPeak = heap();
          return {
            async createWritable() {
              const stream = await handle.createWritable();
              let release: (() => void) | undefined;
              return {
                async write(part: Blob) {
                  const start = performance.now();
                  await stream.write(part);
                  state.sinkMs += performance.now() - start;
                  if (state.hold && part.size > 10000) {
                    state.held = true;
                    await new Promise<void>((resolve) => {
                      release = resolve;
                    });
                  }
                },
                async close() {
                  await stream.close();
                  state.closes++;
                  state.finished = performance.now();
                  state.heapDone = heap();
                },
                async abort() {
                  await stream.abort();
                  state.aborts++;
                  release?.();
                },
              };
            },
          };
        });
        return;
      }
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (event) {
        if (event.type !== 'capture-next') return dispatch.call(this, event);
        const state = Reflect.get(top, 'highresPngProbe');
        const start = top.performance.now();
        if (++state.steps === 1) state.replayStart = start;
        const result = dispatch.call(this, event);
        state.dispatchMs += top.performance.now() - start;
        if (state.steps % 16 === 0) Reflect.get(top, 'sampleHighresHeap')();
        if (state.cancelWarmup && state.steps === 65)
          top.setTimeout(() => {
            const cancel = Array.from(top.document.querySelectorAll('button')).find(
              (button) => button.textContent?.trim() === 'Cancel PNG export',
            );
            cancel?.click();
          }, 0);
        return result;
      };
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
        const state = Reflect.get(top, 'highresPngProbe');
        const start = top.performance.now();
        if (++state.encodeCount === 1) state.firstEncode = start;
        encode.call(
          this,
          (blob) => {
            state.encodeMs += top.performance.now() - start;
            Reflect.get(top, 'sampleHighresHeap')();
            callback(blob);
          },
          ...options,
        );
      };
    },
    { project, license },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export format').selectOption('png');
  await settings.getByLabel('Export start frame').fill('481');
  await settings.getByLabel('Export end frame').fill('488');
  await settings.getByRole('button', { name: 'Use frame range', exact: true }).click();
  await settings.getByLabel('PNG export scale').selectOption('2');
  const run = settings.getByRole('button', {
    name: 'Save selected PNG range ZIP to file…',
    exact: true,
  });
  await run.click();
  await expectExportStatus(page, 'PNG export cancelled');
    await expect(run).toBeEnabled();
  const warmupCancel = await page.evaluate(async () => {
    const { handle, aborts, steps, encodeCount } = Reflect.get(window, 'highresPngProbe');
    return { contents: await (await handle.getFile()).text(), aborts, steps, encodeCount };
  });
  expect(warmupCancel).toMatchObject({ contents: 'previous export', aborts: 1, encodeCount: 0 });
  expect(warmupCancel.steps).toBeGreaterThanOrEqual(65);
  expect(warmupCancel.steps).toBeLessThanOrEqual(96);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(Reflect.get(window, 'highresPngProbe'), {
      cancelWarmup: false,
      steps: 0,
    }),
  );
  await run.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'highresPngProbe').held), {
      timeout: 30000,
    })
    .toBe(true);
  const cancelledAt = await page.evaluate(() => performance.now());
  await settings.getByRole('button', { name: 'Cancel PNG export', exact: true }).click();
  await expectExportStatus(page, 'PNG export cancelled');
    await expect(run).toBeEnabled();
  const cancelled = await page.evaluate(async (started) => {
    const { handle, aborts, closes } = Reflect.get(window, 'highresPngProbe');
    return {
      contents: await (await handle.getFile()).text(),
      aborts,
      closes,
      elapsed: performance.now() - started,
    };
  }, cancelledAt);
  expect(cancelled).toMatchObject({ contents: 'previous export', aborts: 2, closes: 0 });
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(Reflect.get(window, 'highresPngProbe'), {
      hold: false,
      steps: 0,
      encodeCount: 0,
      dispatchMs: 0,
      replayStart: 0,
      firstEncode: 0,
      encodeMs: 0,
      sinkMs: 0,
    }),
  );
  await run.click();
  await expect(settings).toBeHidden({ timeout: 30000 });
  await expectExportStatus(page, 'Saved 8 PNG frames');
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { handle, ...stats } = Reflect.get(window, 'highresPngProbe');
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const entries = new Map<string, Uint8Array<ArrayBuffer>>();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const filename = offset + 30;
      const start = filename + nameLength + view.getUint16(offset + 28, true);
      const size = Number(view.getBigUint64(filename + nameLength + 12, true));
      entries.set(
        new TextDecoder().decode(bytes.subarray(filename, filename + nameLength)),
        bytes.slice(start, start + size),
      );
      offset = start + size;
    }
    const frames = [];
    // Read one pixel at a time without allocating another full 4K canvas.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const at = (image: ImageBitmap, x: number, y: number) => {
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    for (let i = 0; i < 8; i++) {
      const frame = 481 + i;
      const data = entries.get(`frame-${String(frame).padStart(6, '0')}.png`)!;
      const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      frames.push({
        size: [image.width, image.height],
        root: at(image, i < 4 ? 220 : 520, 220),
        child: at(image, 1020, 220),
      });
      image.close();
    }
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('sequence.json')!));
    await (await navigator.storage.getDirectory()).removeEntry(handle.name);
    return {
      stats,
      frames,
      manifest,
      bytes: bytes.length,
      entries: entries.size,
      end: view.getUint32(bytes.length - 22, true),
    };
  });
  expect(result.end).toBe(0x06054b50);
  expect(result.entries).toBe(9);
  expect(result.manifest).toMatchObject({
    frames: 8,
    firstFrame: 481,
    lastFrame: 488,
    width: 3840,
    height: 2160,
    scale: 2,
    buttons: 'Up',
  });
  expect(result.stats).toMatchObject({ steps: 488, encodeCount: 8, aborts: 2, closes: 1 });
  for (const [i, frame] of result.frames.entries())
    expect(frame).toEqual({
      size: [3840, 2160],
      root: [255, 0, 0, 255],
      child: i % 2 === 0 ? [0, 0, 255, 255] : [0, 255, 0, 255],
    });
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  const s = result.stats;
  console.log(
    JSON.stringify({
      totalMs: Math.round(s.finished - s.started),
      warmupMs: Math.round(s.firstEncode - s.replayStart),
      dispatchMs: Math.round(s.dispatchMs),
      encodeMs: Math.round(s.encodeMs),
      sinkMs: Math.round(s.sinkMs),
      cancelMs: Math.round(cancelled.elapsed),
      heapStart: s.heapStart,
      heapPeak: s.heapPeak,
      heapDone: s.heapDone,
      outputBytes: result.bytes,
      cancelledWarmupSteps: warmupCancel.steps,
    }),
  );
});
