import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { exportHTML } from '../../packages/export-web/src';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { expectExportStatus, openExportSettings } from './export-settings';

const cases = [
  { format: 'gif', live: false, command: 'Export selected GIF range…' },
  { format: 'webm', live: false, command: 'Export selected WebM range…' },
  { format: 'mp4', live: false, command: 'Export selected silent MP4 range…' },
  { format: 'gif', live: true, command: 'Export selected GIF range…' },
  { format: 'webm', live: true, command: 'Export selected WebM range…' },
  { format: 'mp4', live: true, command: 'Export selected silent MP4 range…' },
] as const;

for (const { format, live, command } of cases) {
  test(`${format} selected export decodes the original ${live ? 'sparse' : 'authored'} artwork and Button Up poses`, async ({ page }) => {
    const license = process.env.SPLASH_TEST_LICENSE;
    test.skip(!license, 'Run with the isolated licensing fixture.');
    const source = livePresentationFixture('button');
    const authored = structuredClone(source);
    const layer = authored.layers[0];
    delete layer.liveMotionSpans;
    const shape = layer.keys[0].shapes[0];
    layer.keys.splice(1, 0, ...[1, 2, 3].map(frame => ({
      frame, shapes: [{ ...shape, x: frame * 20 }],
    })));
    const original = live ? source : authored;
    await page.addInitScript(({ project, license, live, format }) => {
      if (window !== window.top) return;
      localStorage.setItem('splash-license-v1', license!);
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
      if (live) {
        const state = { held: false, pending: true, changeBeforeDownload: false, changed: false };
        Reflect.set(window, 'encodedCaptureTest', state);
        if (format === 'gif') {
          const post = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
            if (state.pending && message && typeof message === 'object' && 'kind' in message && message.kind === 'analyze') {
              state.held = true;
              return;
            }
            return Reflect.apply(post, this, [message, options]);
          };
        } else {
          const flush = VideoEncoder.prototype.flush;
          VideoEncoder.prototype.flush = function () {
            if (!state.pending) return flush.call(this);
            state.held = true;
            return new Promise<void>(() => {});
          };
          const createURL = URL.createObjectURL;
          URL.createObjectURL = function (object) {
            const url = createURL.call(this, object);
            if (state.changeBeforeDownload && object instanceof Blob && object.type === 'video/' + format) {
              const bitrate = document.querySelector<HTMLSelectElement>('select[aria-label="Video target bitrate"]');
              if (!bitrate) throw Error('Missing video target bitrate control.');
              bitrate.value = '1000000';
              bitrate.dispatchEvent(new Event('change', { bubbles: true }));
              state.changed = true;
            }
            return url;
          };
        }
      }
    }, { project: original, license, live, format });
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const exporter = await openExportSettings(page);
    await exporter.getByLabel('Export format').selectOption(format);
    await exporter.getByLabel('Export start frame').fill('2');
    await exporter.getByLabel('Export end frame').fill('4');
    await exporter.getByRole('button', { name: 'Use frame range', exact: true }).click();
    if (format === 'gif') await exporter.getByLabel('Transparent GIF background (white matte edges)').check();
    if (live) {
      const label = { gif: 'GIF', webm: 'WebM', mp4: 'MP4' }[format];
      let downloads = 0;
      const countDownloads = () => { downloads++; };
      page.on('download', countDownloads);
      await exporter.getByRole('button', { name: command, exact: true }).click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'encodedCaptureTest').held)).toBe(true);
      await exporter.getByRole('button', { name: `Cancel ${label} export`, exact: true }).click();
      await expectExportStatus(page, `${label} export cancelled`);
      await expect(exporter.getByRole('button', { name: command, exact: true })).toBeEnabled();
      expect(downloads).toBe(0);
      await page.evaluate(() => { Reflect.get(window, 'encodedCaptureTest').pending = false; });
      if (format !== 'gif') {
        await page.evaluate(() => { Reflect.get(window, 'encodedCaptureTest').changeBeforeDownload = true; });
        await exporter.getByRole('button', { name: command, exact: true }).click();
        await expect(exporter.getByRole('alert')).toContainText('Export was not published.');
        expect(await page.evaluate(() => Reflect.get(window, 'encodedCaptureTest').changed)).toBe(true);
        expect(downloads).toBe(0);
        await page.evaluate(() => { Reflect.get(window, 'encodedCaptureTest').changeBeforeDownload = false; });
        await exporter.getByRole('button', { name: 'Dismiss', exact: true }).click();
        await exporter.getByLabel('Video target bitrate', { exact: true }).selectOption('4000000');
      }
      page.off('download', countDownloads);
    }
    const output = page.waitForEvent('download');
    await exporter.getByRole('button', { name: command, exact: true }).click();
    const download = await output;
    const bytes = await readFile((await download.path())!);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    const reference = [1, 2, 3].map(frame => exportHTML(authored, frame, format === 'gif'));
    const result = await page.evaluate(async ({ base64, reference, format, fps }) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const output = document.createElement('canvas');
      output.width = 160;
      output.height = 80;
      const ctx = output.getContext('2d')!;
      const samples = (context: CanvasRenderingContext2D, frame: number) =>
        [[frame * 20 + 8, 10], [4, 10], [[45, 65, 125][frame - 1], 45]]
          .map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
      const expected = [];
      for (const html of reference) {
        const host = document.createElement('iframe');
        try {
          host.hidden = true;
          host.srcdoc = html;
          document.body.append(host);
          for (let retry = 0; retry < 200; retry++) {
            const canvas = host.contentDocument?.querySelector('canvas');
            if (canvas?.dataset.capture === 'ready') {
              expected.push(samples(canvas.getContext('2d')!, expected.length + 1));
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } finally { host.remove(); }
      }
      const decoded = [];
      let duration: number | undefined;
      if (format === 'gif') {
        const Decoder = (window as unknown as { ImageDecoder: new (input: { data: Uint8Array; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
          decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
          close(): void;
        } }).ImageDecoder;
        const decoder = new Decoder({ data: bytes, type: 'image/gif' });
        try {
          await decoder.tracks.ready;
          for (let frame = 0; frame < decoder.tracks.selectedTrack.frameCount; frame++) {
            const { image } = await decoder.decode({ frameIndex: frame });
            try {
              ctx.clearRect(0, 0, 160, 80);
              ctx.drawImage(image, 0, 0);
              decoded.push(samples(ctx, frame + 1));
            } finally { image.close(); }
          }
        } finally { decoder.close(); }
      } else {
        const video = document.createElement('video');
        const url = URL.createObjectURL(new Blob([bytes], { type: 'video/' + format }));
        const once = (name: string) => new Promise<void>((resolve, reject) => {
          video.addEventListener(name, () => resolve(), { once: true });
          video.addEventListener('error', () => reject(Error('Encoded video could not be decoded.')), { once: true });
        });
        try {
          video.muted = true;
          document.body.append(video);
          const metadata = once('loadeddata');
          video.src = url;
          await metadata;
          duration = video.duration;
          // Seek back to frame zero from a different frame so the decoder has
          // submitted a video frame even when initial loadeddata was offscreen.
          for (let frame = 2; frame >= 0; frame--) {
            const seeking = once('seeked');
            // Chromium's fragmented MP4 seek can advance to the next keyframe
            // between samples. Seek the encoded sample at microsecond resolution.
            video.currentTime = format === 'mp4' ? Math.floor(frame / fps * 1e6) / 1e6 : (frame + 0.5) / fps;
            await seeking;
            ctx.drawImage(video, 0, 0);
            decoded[frame] = samples(ctx, frame + 1);
          }
        } finally { video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(url); }
      }
      return { expected, decoded, duration };
    }, { base64: bytes.toString('base64'), reference, format, fps: authored.fps });
    expect(result.expected).toHaveLength(3);
    expect(result.decoded).toHaveLength(3);
    if (format !== 'gif') expect(result.duration).toBeCloseTo(3 / authored.fps, 3);
    for (const [frame, expected] of result.expected.entries()) {
      expect(expected[0]).toEqual([255, 0, 0, 255]);
      expect(expected[1][3]).toBe(format === 'gif' ? 0 : 255);
      expect(expected[2]).toEqual([0, 0, 255, 255]);
      const actual = result.decoded[frame];
      if (format === 'gif') expect(actual).toEqual(expected);
      else for (const [index, channels] of expected.entries())
        for (const [channel, value] of channels.entries())
          expect(Math.abs(actual[index][channel] - value),
            `frame ${frame + 1}, sample ${index + 1}: actual ${actual[index]} expected ${channels}`).toBeLessThanOrEqual(12);
    }
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  });
}
