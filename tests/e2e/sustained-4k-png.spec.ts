import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newProject, validateProject, type Vector } from '../../packages/document/src';
import { joinBytes, pngChunk, pngHeader, pngSignature } from '../ffmpeg-stage-fixture';
import { expectExportStatus, openExportSettings } from './export-settings';

test('sustained textured 4K PNG save measures memory and preserves files on cancellation', ({
  page,
  browser,
}) => measureSave(page, browser, false));

test('long changing 480-frame PNG save measures memory and preserves files on cancellation', ({
  page,
  browser,
}) => measureSave(page, browser, true));

async function measureSave(page: Page, browser: Browser, changing: boolean) {
  const license = process.env.SPLASH_TEST_LICENSE;
  const diagnoseWithoutWrites = process.env.SPLASH_PROFILE_PNG_NO_FILE === '1';
  test.skip(
    !license || process.platform !== 'win32',
    'Run with the isolated Windows licensing fixture.',
  );
  test.setTimeout(120000);
  const width = changing ? 48 : 384;
  const height = changing ? 27 : 216;
  const raw = new Uint8Array((width * 4 + 1) * height);
  let noise = 19;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * (width * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) {
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        raw[index + c] = noise >>> 24;
      }
      raw[index + 3] = 255;
    }
  const texture = joinBytes(
    pngSignature,
    pngHeader(width, height),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  );
  const project = newProject();
  const scale = changing ? 1 : 2;
  const count = changing ? 480 : 32;
  project.width = changing ? 960 : 1920;
  project.height = changing ? 540 : 1080;
  project.duration = count;
  project.assets = [
    {
      id: 'noise',
      path: 'assets/bitmaps/texture.json',
      bitmap: {
        name: 'Texture',
        width,
        height,
        dataUrl: 'data:image/png;base64,' + Buffer.from(texture).toString('base64'),
      },
    },
  ];
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: project.width,
    height: project.height,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    bitmap: { assetId: 'noise', x: 0, y: 0, width: project.width, height: project.height },
  };
  const marker: Vector = {
    ...art,
    bitmap: undefined,
    id: 'marker',
    x: 40,
    y: 40,
    width: 60,
    height: 60,
    fill: '#ff0000',
  };
  project.layers[0].keys = changing
    ? Array.from({ length: count }, (_, frame) => ({
        frame,
        shapes: [
          art,
          { ...marker, x: marker.x + frame, fill: frame < count / 2 ? '#ff0000' : '#0000ff' },
        ],
      }))
    : [
        { frame: 0, shapes: [art, marker] },
        { frame: 16, shapes: [art, { ...marker, fill: '#0000ff' }] },
      ];
  validateProject(project);
  await page.addInitScript(
    ({ project, license }) => {
      const top = window.top!;
      if (top !== window) {
        const dispatch = EventTarget.prototype.dispatchEvent;
        EventTarget.prototype.dispatchEvent = function (event) {
          const accepted = dispatch.call(this, event);
          if (event.type === 'capture-next') {
            const state = Reflect.get(top, 'sustainedPng');
            state.replaySteps++;
            state.archiveStart = top.performance.now();
          }
          return accepted;
        };
        const encode = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
          const state = Reflect.get(top, 'sustainedPng');
          const started = top.performance.now();
          encode.call(
            this,
            (blob) => {
              state.encodeMs += top.performance.now() - started;
              state.archiveStart = top.performance.now();
              state.encodes++;
              callback(blob);
            },
            ...args,
          );
        };
        return;
      }
      localStorage.setItem('splash-license-v1', license!);
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
      const state = {
        diagnoseWithoutWrites: false,
        hold: true,
        held: false,
        aborts: 0,
        closes: 0,
        frames: 0,
        bytes: 0,
        encodeMs: 0,
        archiveMs: 0,
        writeMs: 0,
        archiveStart: 0,
        payloadPending: false,
        replaySteps: 0,
        encodes: 0,
        bytesInFrame: 0,
        maxWrite: 0,
        retiredCanvases: [] as number[][],
        started: 0,
        finished: 0,
        handle: undefined as FileSystemFileHandle | undefined,
      };
      Reflect.set(window, 'sustainedPng', state);
      const removeElement = Element.prototype.remove;
      Element.prototype.remove = function () {
        if (this instanceof HTMLIFrameElement && this.title === 'PNG frame renderer') {
          const canvas = this.contentDocument?.querySelector('canvas');
          if (canvas) state.retiredCanvases.push([canvas.width, canvas.height]);
        }
        removeElement.call(this);
      };
      Reflect.set(window, 'showSaveFilePicker', async () => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle('sustained-4k-export.zip', {
          create: true,
        });
        if (!state.handle) {
          const seed = await handle.createWritable();
          await seed.write('previous archive');
          await seed.close();
          state.handle = handle;
        }
        Object.assign(state, {
          frames: 0,
          bytes: 0,
          encodeMs: 0,
          archiveMs: 0,
          writeMs: 0,
          archiveStart: 0,
          payloadPending: false,
          replaySteps: 0,
          encodes: 0,
          bytesInFrame: 0,
          maxWrite: 0,
          started: performance.now(),
        });
        return {
          async createWritable() {
            const writable = await handle.createWritable();
            let release: (() => void) | undefined;
            return {
              async write(part: Blob) {
                const start = performance.now();
                const size = part.size;
                const header = state.archiveStart !== 0;
                if (header) {
                  state.archiveMs += start - state.archiveStart;
                  state.archiveStart = 0;
                  state.payloadPending = true;
                }
                if (!state.diagnoseWithoutWrites) await writable.write(part);
                state.maxWrite = Math.max(state.maxWrite, size);
                state.writeMs += performance.now() - start;
                state.bytes += size;
                if (!header && state.payloadPending) {
                  state.payloadPending = false;
                  state.bytesInFrame = size;
                  if (++state.frames === 4 && state.hold) {
                    state.held = true;
                    await new Promise<void>((resolve) => {
                      release = resolve;
                    });
                  }
                }
              },
              async abort() {
                await writable.abort();
                state.aborts++;
                release?.();
              },
              async close() {
                if (state.diagnoseWithoutWrites) await writable.abort();
                else await writable.close();
                state.closes++;
                state.finished = performance.now();
              },
            };
          },
        };
      });
    },
    { project, license },
  );

  await page.goto('/');
  await page
    .getByRole('button', { name: 'Recover changes', exact: true })
    .click({ timeout: 10000 });
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export format').selectOption('png');
  await settings.getByLabel('PNG export scale').selectOption(String(scale));
  const run = settings.getByRole('button', {
    name: 'Save PNG sequence ZIP to file…',
    exact: true,
  });
  await run.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'sustainedPng').held)).toBe(true);
  await settings.getByRole('button', { name: 'Cancel PNG export', exact: true }).click();
  await expectExportStatus(page, 'PNG export cancelled');
  await expect(run).toBeEnabled();
  expect(
    await page.evaluate(async () => {
      const state = Reflect.get(window, 'sustainedPng');
      return [
        state.frames,
        state.bytesInFrame,
        state.aborts,
        state.closes,
        await (await state.handle.getFile()).text(),
      ];
    }),
  ).toEqual([4, expect.any(Number), 1, 0, 'previous archive']);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  await page.evaluate((diagnoseWithoutWrites) => {
    Object.assign(Reflect.get(window, 'sustainedPng'), { hold: false, diagnoseWithoutWrites });
  }, diagnoseWithoutWrites);

  const cdp = await browser.newBrowserCDPSession();
  const processes = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  await cdp.detach();
  const ids = processes.map((process) => process.id).join(',');
  expect(ids).toMatch(/^\d+(,\d+)*$/);
  const sampler = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$ids = ${ids}; while ($true) { $memory = @{}; Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $memory[$_.Id] = $_.PrivateMemorySize64 }; (($ids | ForEach-Object { [long]$memory[$_] }) -join ','); Start-Sleep -Milliseconds 100 }`,
    ],
    { windowsHide: true },
  );
  const samples: number[][] = [];
  let samplesBeforeCollection = 0;
  sampler.stdout.setEncoding('utf8');
  let pending = '';
  sampler.stdout.on('data', (chunk: string) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop()!;
    for (const line of lines) {
      if (!/^\d+(,\d+)*$/.test(line.trim())) continue;
      const values = line.trim().split(',').map(Number);
      if (values.length === processes.length) samples.push(values);
    }
  });
  try {
    await expect.poll(() => samples.length).toBeGreaterThan(1);
    await run.click();
    await expect(settings).toBeHidden({ timeout: 90000 });
    await expectExportStatus(page, `Saved ${count} PNG frames`);
    await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
    await expect.poll(() => samples.length).toBeGreaterThan(5);
    samplesBeforeCollection = samples.length;
    // Test-only collection distinguishes reclaimable Blob allocations from the
    // canvas lifetime. The app never asks the host to collect.
    const pageCdp = await page.context().newCDPSession(page);
    try {
      await pageCdp.send('HeapProfiler.collectGarbage');
      await expect.poll(() => samples.length).toBeGreaterThan(samplesBeforeCollection + 2);
    } finally {
      await pageCdp.detach();
    }
  } finally {
    sampler.kill();
  }
  const result = await page.evaluate(
    async ({ count, scale, firstX, lastX }) => {
      const { handle, ...stats } = Reflect.get(window, 'sustainedPng');
      const file: File = await handle.getFile();
      if (stats.diagnoseWithoutWrites) {
        const previous = await file.text();
        await (await navigator.storage.getDirectory()).removeEntry(handle.name);
        return {
          stats,
          length: stats.bytes,
          names: [],
          pixels: [],
          checksums: [],
          end: 0,
          previous,
        };
      }
      const end = new DataView(await file.slice(file.size - 22).arrayBuffer());
      let offset = 0;
      const names: string[] = [];
      const checksums: number[] = [];
      const pixels = [];
      for (let i = 0; i < end.getUint16(10, true); i++) {
        const header = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
        if (header.getUint32(0, true) !== 0x04034b50) throw Error('Invalid ZIP record.');
        const length = header.getUint16(26, true);
        const nameAndExtra = await file.slice(offset + 30, offset + 30 + length + 20).arrayBuffer();
        names.push(new TextDecoder().decode(new Uint8Array(nameAndExtra, 0, length)));
        if (i > 0) checksums.push(header.getUint32(14, true));
        const size = Number(new DataView(nameAndExtra).getBigUint64(length + 12, true));
        const start = offset + 30 + length + 20;
        if (i === 1 || i === count) {
          const image = await createImageBitmap(file.slice(start, start + size, 'image/png'));
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, i === 1 ? firstX : lastX, 50 * scale, 1, 1, 0, 0, 1, 1);
          pixels.push([image.width, image.height, ...context.getImageData(0, 0, 1, 1).data]);
          image.close();
        }
        offset = start + size;
      }
      await (await navigator.storage.getDirectory()).removeEntry(handle.name);
      return {
        stats,
        length: file.size,
        names,
        pixels,
        checksums,
        end: end.getUint32(0, true),
      };
    },
    {
      count,
      scale,
      firstX: (marker.x + 10) * scale,
      lastX: (marker.x + 10 + (changing ? count - 1 : 0)) * scale,
    },
  );
  if (diagnoseWithoutWrites) expect(result.previous).toBe('previous archive');
  else {
    expect(result.end).toBe(0x06054b50);
    expect(result.names).toEqual([
      'sequence.json',
      ...Array.from({ length: count }, (_, i) => `frame-${String(i + 1).padStart(6, '0')}.png`),
    ]);
    expect(result.pixels).toEqual([
      [project.width * scale, project.height * scale, 255, 0, 0, 255],
      [project.width * scale, project.height * scale, 0, 0, 255, 255],
    ]);
    expect(new Set(result.checksums).size).toBe(changing ? count : 2);
  }
  expect(result.stats).toMatchObject({
    frames: count,
    replaySteps: count,
    encodes: changing ? count : 2,
    aborts: 1,
    closes: 1,
    bytes: result.length,
  });
  expect(result.stats.retiredCanvases).toEqual([
    [0, 0],
    [0, 0],
  ]);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  const memory = (indexes: number[]) => {
    const totals = samples.map((sample) => indexes.reduce((sum, index) => sum + sample[index], 0));
    return {
      start: totals[0],
      peak: Math.max(...totals.slice(0, samplesBeforeCollection)),
      end: totals[samplesBeforeCollection - 1],
      afterTestGC: totals.at(-1),
    };
  };
  console.log(
    JSON.stringify({
      destination: diagnoseWithoutWrites ? 'discarded for measurement' : 'OPFS',
      totalMs: Math.round(result.stats.finished - result.stats.started),
      encodeMs: Math.round(result.stats.encodeMs),
      encodes: result.stats.encodes,
      archiveMs: Math.round(result.stats.archiveMs),
      writeMs: Math.round(result.stats.writeMs),
      browserPrivateBytes: memory(processes.map((_, i) => i)),
      byProcess: Object.fromEntries(
        [...new Set(processes.map((p) => p.type))].map((type) => [
          type,
          memory(processes.flatMap((p, i) => (p.type === type ? [i] : []))),
        ]),
      ),
      samples: samples.length,
      maxWrite: result.stats.maxWrite,
      outputBytes: result.length,
    }),
  );
}
