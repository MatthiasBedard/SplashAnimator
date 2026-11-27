import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { expectExportStatus, openExportSettings } from './export-settings';

for (const sheet of [false, true]) {
  test(`selected sparse PNG ${sheet ? 'sprite sheet saves transactionally' : 'range ZIP downloads'} with exact pixels and metadata`, async ({
    page,
  }) => {
    const license = process.env.SPLASH_TEST_LICENSE;
    test.skip(!license, 'Run with the isolated licensing fixture.');
    const project = livePresentationFixture('button');
    await page.addInitScript(
      ({ project, license, sheet }) => {
        if (window !== window.top) return;
        localStorage.setItem('splash-license-v1', license!);
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
        const state = {
          hold: true,
          held: false,
          aborts: 0,
          closes: 0,
          handle: undefined as FileSystemFileHandle | undefined,
        };
        Reflect.set(window, 'sparsePngFixture', state);
        if (!sheet) {
          const encode = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (...args) {
            if (state.hold && this.width === 320 && this.height === 160) {
              state.held = true;
              return;
            }
            encode.apply(this, args);
          };
          return;
        }
        Reflect.set(window, 'showSaveFilePicker', async () => {
          const directory = await navigator.storage.getDirectory();
          const handle = await directory.getFileHandle('sparse-png-fixture.zip', { create: true });
          if (!state.handle) {
            const seed = await handle.createWritable();
            await seed.write('previous archive');
            await seed.close();
            state.handle = handle;
          }
          return {
            async createWritable() {
              const stream = await handle.createWritable();
              let release: (() => void) | undefined;
              return {
                async write(part: Blob) {
                  await stream.write(part);
                  if (state.hold) {
                    state.held = true;
                    await new Promise<void>((resolve) => {
                      release = resolve;
                    });
                  }
                },
                async close() {
                  state.closes++;
                  await stream.close();
                },
                async abort() {
                  state.aborts++;
                  await stream.abort();
                  release?.();
                },
              };
            },
          };
        });
      },
      { project, license, sheet },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const settings = await openExportSettings(page);
    await settings.getByLabel('Export format').selectOption('png');
    await settings.getByLabel('Export start frame').fill('2');
    await settings.getByLabel('Export end frame').fill('4');
    await settings.getByRole('button', { name: 'Use frame range', exact: true }).click();
    await settings.getByLabel('Transparent PNG background').check();
    await settings.getByLabel('PNG export scale').selectOption('2');
    if (sheet) {
      await settings.getByLabel('PNG sprite sheet padding').selectOption('2');
      await settings.getByLabel('Trim transparent sprite borders').check();
      await settings.getByLabel('Extend sprite edges into padding').check();
    }
    const run = settings.getByRole('button', {
      name: sheet
        ? 'Save selected PNG sprite sheet ZIP to file…'
        : 'Export selected PNG range ZIP…',
      exact: true,
    });
    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await run.click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'sparsePngFixture').held))
      .toBe(true);
    await settings.getByRole('button', { name: 'Cancel PNG export', exact: true }).click();
    await expectExportStatus(page, 'PNG export cancelled');
    expect(downloads).toBe(0);
    if (sheet)
      expect(
        await page.evaluate(async () => {
          const { handle, aborts, closes } = Reflect.get(window, 'sparsePngFixture');
          return { contents: await (await handle.getFile()).text(), aborts, closes };
        }),
      ).toEqual({ contents: 'previous archive', aborts: 1, closes: 0 });

    await page.evaluate(() => {
      Reflect.get(window, 'sparsePngFixture').hold = false;
    });
    const download = sheet ? undefined : page.waitForEvent('download');
    await run.click();
    await expectExportStatus(page, `${sheet ? 'Saved' : 'Exported'} 3 PNG frames`);
    const bytes = download
      ? Array.from(await readFile((await (await download).path())!))
      : undefined;
    const result = await page.evaluate(
      async ({ bytes, sheet }) => {
        const { handle, aborts, closes } = Reflect.get(window, 'sparsePngFixture');
        const data = bytes
          ? new Uint8Array(bytes)
          : new Uint8Array(await (await handle.getFile()).arrayBuffer());
        const view = new DataView(data.buffer);
        const entries = new Map<string, Uint8Array<ArrayBuffer>>();
        let offset = 0;
        while (view.getUint32(offset, true) === 0x04034b50) {
          const nameLength = view.getUint16(offset + 26, true);
          const extraLength = view.getUint16(offset + 28, true);
          let size = view.getUint32(offset + 18, true);
          const filename = offset + 30;
          const payload = filename + nameLength + extraLength;
          if (size === 0xffffffff)
            size = Number(view.getBigUint64(filename + nameLength + 12, true));
          const name = new TextDecoder().decode(data.subarray(filename, filename + nameLength));
          entries.set(name, data.slice(payload, payload + size));
          offset = payload + size;
        }
        const manifest = JSON.parse(new TextDecoder().decode(entries.get('sequence.json')!));
        const decode = async (name: string) => {
          const image = await createImageBitmap(
            new Blob([entries.get(name)!], { type: 'image/png' }),
          );
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          image.close();
          return {
            size: [canvas.width, canvas.height],
            pixel: (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data),
          };
        };
        const atlas = sheet ? await decode('sheet.png') : undefined;
        const samples = await Promise.all(
          [0, 1, 2].map(async (i) => {
            const image = atlas ?? (await decode(`frame-00000${i + 2}.png`));
            const tile = manifest.tiles?.[i];
            const x = (tile?.x ?? 0) - (tile?.sourceX ?? 0);
            const y = (tile?.y ?? 0) - (tile?.sourceY ?? 0);
            const red = 56 + i * 40;
            return {
              size: image.size,
              red: image.pixel(x + red, y + 20),
              blue: image.pixel(x + [90, 130, 250][i], y + 90),
              clear: image.pixel(x + red, y + 60),
              edge: tile ? image.pixel(x + red, y - 1) : null,
            };
          }),
        );
        if (handle) await (await navigator.storage.getDirectory()).removeEntry(handle.name);
        return {
          names: [...entries.keys()].sort(),
          manifest,
          samples,
          aborts,
          closes,
          trailer: view.getUint32(data.length - 22, true),
        };
      },
      { bytes, sheet },
    );
    expect(result.trailer).toBe(0x06054b50);
    expect(result.names).toEqual(
      sheet
        ? ['sequence.json', 'sheet.png']
        : ['frame-000002.png', 'frame-000003.png', 'frame-000004.png', 'sequence.json'],
    );
    expect(result.manifest).toMatchObject({
      fps: 24,
      frames: 3,
      firstFrame: 2,
      lastFrame: 4,
      timelineFrames: 10,
      width: 320,
      height: 160,
      scale: 2,
      background: 'transparent',
      buttons: 'Up',
    });
    if (sheet) {
      expect(result.manifest).toMatchObject({
        padding: 2,
        trimmed: true,
        extrude: true,
        sheet: 'sheet.png',
      });
      expect(
        result.manifest.tiles.map(
          (tile: { frame: number; sourceX: number; width: number; height: number }) => [
            tile.frame,
            tile.sourceX,
            tile.width,
            tile.height,
          ],
        ),
      ).toEqual([
        [2, 40, 80, 120],
        [3, 80, 80, 120],
        [4, 120, 160, 120],
      ]);
    }
    for (const frame of result.samples)
      expect(frame).toEqual({
        size: sheet ? [result.manifest.sheetWidth, result.manifest.sheetHeight] : [320, 160],
        red: [255, 0, 0, 255],
        blue: [0, 0, 255, 255],
        clear: [0, 0, 0, 0],
        edge: sheet ? [255, 0, 0, 255] : null,
      });
    expect([result.aborts, result.closes, downloads]).toEqual(sheet ? [1, 1, 0] : [0, 0, 1]);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  });
}
