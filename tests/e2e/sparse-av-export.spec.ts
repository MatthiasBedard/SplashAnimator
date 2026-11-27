import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { pcm16WavFixture } from '../wav-fixture';
import { openExportSettings } from './export-settings';

const path = 'assets/audio/tone.wav';
const frequency = 443;
const sampleCount = 3200;
const wav = pcm16WavFixture(
  [
    Array.from({ length: sampleCount }, (_, i) =>
      Math.round(8192 * Math.sin((2 * Math.PI * frequency * i) / 8000)),
    ),
  ],
  8000,
);

for (const save of [false, true]) {
  test(`selected sparse WebM with audio ${save ? 'saves transactionally' : 'downloads'} with decoded picture and sound`, async ({
    page,
  }) => {
    const license = process.env.SPLASH_TEST_LICENSE;
    test.skip(!license, 'Run with the isolated licensing fixture.');
    const project = livePresentationFixture('button');
    project.assets = [
      {
        id: 'tone',
        path,
        audio: {
          name: 'Tone',
          format: 'pcm16-wav',
          sampleRate: 8000,
          channels: 1,
          frames: sampleCount,
        },
      },
    ];
    project.audioClips = [
      { id: 'clip', assetId: 'tone', startFrame: 0, offsetSamples: 0, gain: 0.5 },
    ];
    await page.addInitScript(
      ({ project, license }) => {
        if (window !== window.top) return;
        localStorage.setItem('splash-license-v1', license!);
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
      },
      { project, license },
    );
    await page.addInitScript((save) => {
      if (window !== window.top) return;
      const state = {
        hold: true,
        held: false,
        aborts: 0,
        closes: 0,
        handle: undefined as FileSystemFileHandle | undefined,
      };
      Reflect.set(window, 'sparseAvFixture', state);
      if (!save) {
        const flush = VideoEncoder.prototype.flush;
        VideoEncoder.prototype.flush = function () {
          if (!state.hold) return flush.call(this);
          state.held = true;
          return new Promise<void>(() => {});
        };
        return;
      }
      Reflect.set(window, 'showSaveFilePicker', async () => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle('sparse-av-fixture.webm', { create: true });
        if (!state.handle) {
          const seed = await handle.createWritable();
          await seed.write('previous file');
          await seed.close();
          state.handle = handle;
        }
        return {
          async createWritable() {
            const writer = (await handle.createWritable()).getWriter();
            let release: (() => void) | undefined;
            return {
              getWriter: () => ({
                async write(bytes: Uint8Array) {
                  await writer.write(bytes);
                  if (state.hold) {
                    state.held = true;
                    await new Promise<void>((resolve) => {
                      release = resolve;
                    });
                  }
                },
                async abort(reason: unknown) {
                  state.aborts++;
                  await writer.abort(reason);
                  release?.();
                },
                async close() {
                  state.closes++;
                  await writer.close();
                },
                releaseLock: () => writer.releaseLock(),
              }),
            };
          },
        };
      });
    }, save);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));

    const settings = await openExportSettings(page);
    await settings.getByLabel('Export format').selectOption('webm');
    await settings.getByLabel('Export start frame').fill('2');
    await settings.getByLabel('Export end frame').fill('4');
    await settings.getByRole('button', { name: 'Use frame range', exact: true }).click();
    const verb = save ? 'Save' : 'Export';
    await settings
      .getByRole('button', {
        name: `${verb} selected WebM with project audio${save ? ' to file' : ''}…`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: `${verb} WebM with project audio`,
      exact: true,
    });
    await dialog
      .getByLabel('WAV for ' + path)
      .setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav) });
    const run = dialog.getByRole('button', { name: `${verb} WebM with audio`, exact: true });
    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await run.click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'sparseAvFixture').held))
      .toBe(true);
    await dialog
      .getByRole('button', {
        name: `Cancel audio-video ${save ? 'save' : 'encoding'}`,
        exact: true,
      })
      .click();
    await expect(dialog.getByRole('status')).toHaveText('WebM audio export cancelled');
    expect(downloads).toBe(0);
    if (save) {
      expect(
        await page.evaluate(async () => {
          const { handle, aborts, closes } = Reflect.get(window, 'sparseAvFixture');
          return { contents: await (await handle.getFile()).text(), aborts, closes };
        }),
      ).toEqual({ contents: 'previous file', aborts: 1, closes: 0 });
    }
    await page.evaluate(() => {
      Reflect.get(window, 'sparseAvFixture').hold = false;
    });
    const download = save ? undefined : page.waitForEvent('download');
    await run.click();
    await expect(dialog.getByRole('status')).toContainText(
      `${save ? 'Saved' : 'Exported'} 3 WebM frames`,
    );
    const bytes = download
      ? Array.from(await readFile((await (await download).path())!))
      : undefined;
    const result = await page.evaluate(
      async ({ bytes, frequency }) => {
        const { handle, aborts, closes } = Reflect.get(window, 'sparseAvFixture');
        const blob: Blob = bytes
          ? new Blob([new Uint8Array(bytes)], { type: 'video/webm' })
          : await handle.getFile();
        const audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(
          await blob.arrayBuffer(),
        );
        let xy = 0,
          xx = 0,
          yy = 0;
        const data = audio.getChannelData(0);
        for (let i = 600; i < data.length - 400; i++) {
          const reference = 0.125 * Math.sin((2 * Math.PI * frequency * (i + 2000)) / 48000);
          xy += data[i] * reference;
          xx += data[i] ** 2;
          yy += reference ** 2;
        }
        const video = document.createElement('video');
        const url = URL.createObjectURL(blob);
        const once = (name: string) =>
          new Promise<void>((resolve, reject) => {
            video.addEventListener(name, () => resolve(), { once: true });
            video.addEventListener('error', () => reject(Error('WebM could not be decoded.')), {
              once: true,
            });
          });
        try {
          video.muted = true;
          document.body.append(video);
          const loaded = once('loadeddata');
          video.src = url;
          await loaded;
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 80;
          const context = canvas.getContext('2d')!;
          const colors = [];
          for (let i = 2; i >= 0; i--) {
            const seeking = once('seeked');
            video.currentTime = (i + 0.5) / 24;
            await seeking;
            context.drawImage(video, 0, 0);
            colors[i] = [
              Array.from(context.getImageData(28 + i * 20, 10, 1, 1).data),
              Array.from(context.getImageData([45, 65, 125][i], 45, 1, 1).data),
            ];
          }
          return {
            samples: audio.length,
            channels: audio.numberOfChannels,
            correlation: xy / Math.sqrt(xx * yy),
            duration: video.duration,
            colors,
            aborts,
            closes,
          };
        } finally {
          video.removeAttribute('src');
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
          if (handle) await (await navigator.storage.getDirectory()).removeEntry(handle.name);
        }
      },
      { bytes, frequency },
    );
    expect(result.samples).toBe(6000);
    expect(result.channels).toBe(1);
    expect(result.correlation).toBeGreaterThan(0.94);
    expect(result.duration).toBeCloseTo(0.125, 3);
    for (const [red, blue] of result.colors) {
      for (const [actual, expected] of [
        [red, [255, 0, 0, 255]],
        [blue, [0, 0, 255, 255]],
      ])
        expect(
          Math.max(...actual.map((channel, i) => Math.abs(channel - expected[i]))),
        ).toBeLessThanOrEqual(12);
    }
    expect([result.aborts, result.closes, downloads]).toEqual(save ? [1, 1, 0] : [0, 0, 1]);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  });
}
