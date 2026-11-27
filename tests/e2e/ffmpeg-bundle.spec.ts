import { openExportSettings } from './export-settings';
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { newLayer, newProject, type Vector } from '../../packages/document/src';
import { encodeEmbeddedFont } from '../../packages/document/src/embedded-font';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { pcm16WavFixture } from '../wav-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';

test('desktop FFmpeg panel cancels an encoding and publishes a fresh completed job', async ({ page }) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  await page.addInitScript((license) => {
    const calls: string[] = [];
    let chooseCount = 0;
    let rejectNativeWork: (() => void) | undefined;
    Reflect.set(window, 'ffmpegTestCalls', calls);
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      invoke: async (command: string, args?: { id?: string; format?: string }) => {
        if (command === 'read_license') return license;
        if (!command.startsWith('ffmpeg_')) return null;
        calls.push(command + (args?.id !== undefined ? ':' + args.id : ''));
        if (command === 'ffmpeg_choose') {
          chooseCount++;
          const format = chooseCount >= 3 ? 'hevc' : 'matroska';
          if (args?.format !== format) throw Error('Wrong selected desktop format');
          return { id: String(chooseCount), frameCount: 2, width: 120, height: 80, audioChannels: chooseCount >= 2 ? 2 : null,
            format: chooseCount === 3 ? 'matroska' : format };
        }
        if ((command === 'ffmpeg_encode' && args?.id === '1') ||
            (command === 'ffmpeg_publish' && args?.id === '2'))
          return new Promise<void>((_, reject) => { rejectNativeWork = () => reject(Error('Cancelled by host')); });
        if (command === 'ffmpeg_cancel') rejectNativeWork?.();
      },
    });
  }, token);
  const { p, read } = await setup(page);
  const exporter = await openExportSettings(page);
  await exporter.getByLabel('Export format').selectOption('ffmpeg');
  const launch = exporter.getByRole('button', { name: 'Encode extracted FFmpeg input bundle…', exact: true });
  await launch.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Encode FFmpeg input bundle', exact: true });
  const format = dialog.getByLabel('Desktop video format');
  const start = dialog.getByRole('button', { name: 'Choose files and encode…', exact: true });
  await expect(format).toHaveValue('matroska');
  await expect(format).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toContainText('Encoding 2 frames');
  await expect(format).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel encoding', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('FFmpeg export cancelled.');
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Saving the complete Matroska file…');
  await expect(dialog.getByRole('button', { name: 'Cancel save', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('FFmpeg export cancelled.');
  await format.selectOption('hevc');
  await expect(dialog.getByText('HEVC fills transparent areas with white.', { exact: false })).toBeVisible();
  await start.click();
  await expect(dialog.getByRole('alert')).toHaveText(/output format changed/);
  await start.click();
  await expect(dialog.getByRole('status')).toHaveText('Saved 2 frames as HEVC MP4 with stereo PCM audio.');
  await expect(start).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(launch).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'ffmpegTestCalls'))).toEqual([
    'ffmpeg_choose', 'ffmpeg_encode:1', 'ffmpeg_cancel:1',
    'ffmpeg_choose', 'ffmpeg_encode:2', 'ffmpeg_publish:2', 'ffmpeg_cancel:2',
    'ffmpeg_choose', 'ffmpeg_cancel:3',
    'ffmpeg_choose', 'ffmpeg_encode:4', 'ffmpeg_publish:4',
  ]);
  expect(await read()).toEqual(p);
});

test('desktop timeline stages exact selected PNG pixels and discards cancelled or stale captures', async ({ page }) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  await page.addInitScript((license) => {
    const calls: string[] = [];
    const frames: { frame: number; bytes: Uint8Array }[] = [];
    let runs = 0;
    let release: (() => void) | undefined;
    Reflect.set(window, 'desktopCapture', { calls, frames });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      invoke: async (command: string, args: unknown, options?: { headers: Record<string, string> }) => {
        if (command === 'read_license') return license;
        if (!command.startsWith('ffmpeg_')) return null;
        calls.push(command);
        if (command === 'ffmpeg_choose_capture') {
          const { video, format } = args as { video: { firstNumber: number; frameCount: number; width: number; height: number }; format: string };
          if (video.firstNumber !== 3 || video.frameCount !== 3) throw Error('Wrong capture range');
          return { ...video, id: String(++runs), audioChannels: null, format };
        }
        if (command === 'ffmpeg_push_frame') {
          if (!(args instanceof ArrayBuffer) || options?.headers['x-splash-job'] !== String(runs))
            throw Error('Wrong frame ownership or data');
          if (runs === 1 || runs === 3) return new Promise<void>((resolve) => { release = resolve; });
          frames.push({ frame: Number(options.headers['x-splash-frame']), bytes: new Uint8Array(args) });
        }
        if (command === 'ffmpeg_cancel') release?.();
      },
    });
    window.addEventListener('releaseCapture', () => release?.());
  }, token);
  const { p, read, errors } = await setup(page, false, false, (project) => {
    const art = project.symbols![0].shapes[0];
    project.layers[0].keys[1].shapes = [{ ...art, id: 'far-corner', x: 100, y: 50, width: 20, height: 20 }];
    project.layers[0].keys.splice(2, 0, { frame: 3, shapes: [] });
  });
  const exportDialog = await openExportSettings(page);
  await exportDialog.getByLabel('Export format').selectOption('ffmpeg');
  await exportDialog.getByLabel('Export start frame').fill('3');
  await exportDialog.getByLabel('Export end frame').fill('5');
  await exportDialog.getByLabel('Transparent PNG background').check();
  await exportDialog.getByLabel('PNG export scale').selectOption('0.5');
  await exportDialog.getByRole('button', { name: 'Encode selected desktop range…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Encode desktop timeline', exact: true });
  const start = dialog.getByRole('button', { name: 'Choose files and encode…', exact: true });
  await start.click();
  const calls = () => page.evaluate(() => Reflect.get(window, 'desktopCapture').calls as string[]);
  await expect.poll(calls).toEqual(['ffmpeg_choose_capture', 'ffmpeg_push_frame']);
  await dialog.getByRole('button', { name: 'Cancel encoding' }).click();
  await expect(dialog.getByRole('status')).toHaveText('FFmpeg export cancelled.');
  await start.click();
  await expect(dialog.getByRole('status')).toHaveText('Saved 3 frames as lossless Matroska.');
  expect(await calls()).toEqual([
    'ffmpeg_choose_capture', 'ffmpeg_push_frame', 'ffmpeg_cancel', 'ffmpeg_choose_capture',
    'ffmpeg_push_frame', 'ffmpeg_push_frame', 'ffmpeg_push_frame', 'ffmpeg_encode', 'ffmpeg_publish',
  ]);
  const poses = await page.evaluate(async () => {
    const captured = Reflect.get(window, 'desktopCapture').frames as { frame: number; bytes: Uint8Array<ArrayBuffer> }[];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const poses = [];
    for (const { frame, bytes } of captured) {
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      poses.push({ frame, size: [image.width, image.height], art: [...context.getImageData(10, 10, 1, 1).data],
        button: [...context.getImageData(35, 10, 1, 1).data],
        corner: [...context.getImageData(55, 30, 1, 1).data] });
      image.close();
    }
    return poses;
  });
  expect(poses).toEqual([
    { frame: 3, size: [60, 40], art: [0, 0, 0, 0], button: [0, 0, 255, 255], corner: [255, 0, 0, 255] },
    { frame: 4, size: [60, 40], art: [0, 0, 0, 0], button: [255, 0, 0, 255], corner: [0, 0, 0, 0] },
    { frame: 5, size: [60, 40], art: [255, 0, 0, 255], button: [0, 255, 0, 255], corner: [0, 0, 0, 0] },
  ]);
  await start.click();
  await expect.poll(async () => (await calls()).slice(-2)).toEqual(['ffmpeg_choose_capture', 'ffmpeg_push_frame']);
  await page.getByTitle('Last frame', { exact: true }).dispatchEvent('click');
  await page.evaluate(() => window.dispatchEvent(new Event('releaseCapture')));
  await expect(dialog.getByRole('alert')).toContainText('Desktop export source changed');
  expect((await calls()).slice(-3)).toEqual(['ffmpeg_choose_capture', 'ffmpeg_push_frame', 'ffmpeg_cancel']);
  expect(await read()).toEqual(p);
  expect(errors).toEqual([]);
});

function fixture(audio = false, remembered = false) {
  const p = newProject();
  p.name = 'FFmpeg source';
  p.width = 120;
  p.height = 80;
  p.duration = 8;
  p.fps = 29.97;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'leaf',
      name: 'Leaf',
      width: 30,
      height: 30,
      shapes: [art],
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        ],
      },
    },
  ];
  const instance: Vector = {
    ...art,
    id: 'instance',
    kind: 'symbol',
    symbolId: 'leaf',
    x: 10,
    y: 10,
    symbolPlayback: { mode: 'movie', firstFrame: 0 },
  };
  p.symbols.push({
    id: 'button',
    name: 'Button',
    width: 30,
    height: 30,
    shapes: [{ ...instance, x: 0, y: 0 }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [art] },
        { frame: 2, shapes: [art] },
      ],
    },
    buttonStates: { up: 0, over: 1, down: 1, hit: 2 },
  });
  p.layers[0].keys = [
    { frame: 0, shapes: [instance] },
    { frame: 2, shapes: [] },
    { frame: 4, shapes: [instance] },
  ];
  p.layers.push({
    id: 'button-track',
    name: 'Button',
    visible: true,
    locked: false,
    keys: [
      {
        frame: 0,
        shapes: [
          {
            ...instance,
            id: 'button-instance',
            symbolId: 'button',
            x: 60,
            symbolPlayback: { mode: 'single', firstFrame: 0 },
          },
        ],
      },
    ],
  });
  if (remembered) {
    p.layers[0].drawingMode = 'object';
    p.layers[0].keys = [
      { frame: 0, shapes: [{ ...art, x: 10, y: 10 }] },
      { frame: 4, shapes: [{ ...art, x: 50, y: 10 }] },
      { frame: 6, shapes: [] },
    ];
    createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear');
  }
  p.frameScripts = [{ frame: 0, source: 'throw new Error("AUTHORED SCRIPT MUST NOT EXECUTE");' }];
  if (audio) {
    p.assets = [
      {
        id: 'tone',
        path: 'assets/audio/tone.wav',
        audio: { name: 'Tone', format: 'pcm16-wav', sampleRate: 48000, channels: 2, frames: 16000 },
      },
    ];
    p.audioClips = [{ id: 'clip', assetId: 'tone', startFrame: 1, offsetSamples: 200, gain: 0.5 }];
  }
  return p;
}
function unzip(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  let at = bytes.readUInt32LE(bytes.length - 6);
  for (let i = 0; i < bytes.readUInt16LE(bytes.length - 12); i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const n = bytes.readUInt16LE(at + 28),
      size = bytes.readUInt32LE(at + 24),
      local = bytes.readUInt32LE(at + 42),
      start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(bytes.subarray(at + 46, at + 46 + n).toString(), bytes.subarray(start, start + size));
    at += 46 + n + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return files;
}
async function recoverFixture(page: Page) {
  await page.goto('/');
  const openEditor = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await openEditor.or(recover).first().waitFor({ state: 'visible' });
  if (await openEditor.isVisible()) await openEditor.click();
  await recover.click();
}
async function setup(page: Page, audio = false, remembered = false, prepare?: (project: ReturnType<typeof fixture>) => void) {
  const p = fixture(audio, remembered),
    errors: string[] = [];
  prepare?.(p);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await recoverFixture(page);
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  return { p, read, errors };
}
async function open(
  page: Page,
  selected = false,
  scale = 1,
  transparent = false,
  remembered = false,
  save = false,
) {
  if (selected) {
    const box = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(box.x + 45, box.y + 40);
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 117, box.y + 40);
    await page.keyboard.up('Shift');
  }
  if (!(await page.getByLabel('PNG export scale', { exact: true }).count()))
    await openExportSettings(page);
  await page.getByLabel('PNG export scale', { exact: true }).selectOption(String(scale));
  if (transparent) await page.getByLabel('Transparent PNG background', { exact: true }).check();
  if (remembered) await page.getByLabel('Use remembered PNG motion', { exact: true }).check();
  await page
    .getByRole('button', {
      name: save
        ? selected
          ? 'Save selected FFmpeg inputs to file…'
          : 'Save FFmpeg input bundle to file…'
        : selected
          ? 'Export selected FFmpeg inputs…'
          : 'Export FFmpeg input bundle…',
      exact: true,
    })
    .click();
  return page.getByRole('dialog', {
    name: `${save ? 'Save' : 'Export'} FFmpeg input bundle`,
    exact: true,
  });
}
for (const selected of [false, true])
  for (const audio of [false, true])
    for (const transparent of [false, true])
      test(`FFmpeg bundle exact inputs selected ${selected} audio ${audio} transparent ${transparent}`, async ({
        page,
      }) => {
        const f = await setup(page, audio),
          scale = selected ? 2 : 1,
          dialog = await open(page, selected, scale, transparent),
          before = await f.read();
        await expect(dialog.getByLabel('Include project audio in FFmpeg bundle')).not.toBeChecked();
        let workers = 0,
          closed = 0;
        page.on('worker', (w) => {
          workers++;
          w.on('close', () => closed++);
        });
        if (audio) {
          await dialog.getByLabel('Include project audio in FFmpeg bundle').check();
          await expect(
            dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }),
          ).toBeDisabled();
          await dialog.getByLabel('FFmpeg WAV for assets/audio/tone.wav').setInputFiles({
            name: 'tone.wav',
            mimeType: 'audio/wav',
            buffer: Buffer.from(
              pcm16WavFixture([Array(16000).fill(10000), Array(16000).fill(-10000)], 48000),
            ),
          });
        }
        const downloading = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe('FFmpeg source-ffmpeg-inputs.zip');
        const files = unzip(await fs.readFile((await download.path())!)),
          job = JSON.parse(files.get('ffmpeg.json')!.toString()),
          start = selected ? 2 : 0,
          end = selected ? 6 : 7;
        expect(job.video).toMatchObject({
          frameCount: end - start + 1,
          firstNumber: start + 1,
          width: 120 * scale,
          height: 80 * scale,
          frameRate: { numerator: 2997, denominator: 100 },
          sourceStartFrame: start,
          sourceEndFrameExclusive: end + 1,
          buttons: 'Up',
          background: transparent ? 'transparent' : f.p.background,
        });
        expect(files.size).toBe(end - start + 3 + (audio ? 1 : 0));
        expect(job.suggestedArguments).toContain('ffv1');
        expect(files.has('sequence.json')).toBe(false);
        expect(
          Buffer.concat([...files.values()]).includes(
            Buffer.from('AUTHORED SCRIPT MUST NOT EXECUTE'),
          ),
        ).toBe(false);
        expect([...files.keys()].some((name) => /\.(js|cmd|bat|sh|html)$/.test(name))).toBe(false);
        for (let index = start; index <= end; index++) {
          const data = files
              .get(`frame-${String(index + 1).padStart(6, '0')}.png`)!
              .toString('base64'),
            pixels = await page.evaluate(
              async ({ data, scale }) => {
                const img = new Image();
                img.src = 'data:image/png;base64,' + data;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width;
                c.height = img.height;
                const ctx = c.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                return {
                  size: [c.width, c.height],
                  art: [...ctx.getImageData(20 * scale, 20 * scale, 1, 1).data],
                  button: [...ctx.getImageData(70 * scale, 20 * scale, 1, 1).data],
                };
              },
              { data, scale },
            );
          const colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
          ];
          expect(pixels).toEqual({
            size: [120 * scale, 80 * scale],
            button: colors[index % 3],
            art:
              index === 2 || index === 3
                ? transparent
                  ? [0, 0, 0, 0]
                  : [255, 255, 255, 255]
                : colors[(index < 2 ? index : index - 4) % 3],
          });
        }
        if (audio) {
          const begin = Math.round((start * 48000) / 29.97),
            finish = Math.round(((end + 1) * 48000) / 29.97),
            wav = files.get('audio.wav')!;
          expect(job.audio).toMatchObject({
            start: begin,
            end: finish,
            frames: finish - begin,
            channels: 2,
            sampleRate: 48000,
          });
          expect(wav.readUInt16LE(22)).toBe(2);
          expect(wav.readUInt32LE(24)).toBe(48000);
          expect(wav.readUInt32LE(40)).toBe((finish - begin) * 4);
          for (let n = 0; n < finish - begin; n++) {
            const active = begin + n >= Math.round(48000 / 29.97);
            expect(wav.readInt16LE(44 + n * 4)).toBe(active ? 5000 : 0);
            expect(wav.readInt16LE(46 + n * 4)).toBe(active ? -5000 : 0);
          }
        } else {
          expect(job.audio).toBeNull();
          expect(files.has('audio.wav')).toBe(false);
        }
        await expect.poll(() => closed).toBe(workers);
        expect(await page.locator('iframe[title="PNG frame renderer"]').count()).toBe(0);
        expect(await f.read()).toEqual(before);
        expect(f.errors).toEqual([]);
      });
test('selected sparse FFmpeg bundle preserves video and PCM after stale preparation and retry', async ({ page }, testInfo) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing test fixture.');
  const project = livePresentationFixture('button');
  const wavPath = 'assets/audio/sparse.wav';
  const bitmap = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 8, 8);
    return canvas.toDataURL();
  });
  const font = await fs.readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const family = 'Splash Font Codec Fixture';
  project.assets.push(
    { id: 'pcm', path: wavPath, audio: { name: 'Stereo PCM', format: 'pcm16-wav', sampleRate: 48000, channels: 2, frames: 5000 } },
    { id: 'codec-bitmap', path: 'assets/bitmaps/codec.json', bitmap: { name: 'Green tile', width: 8, height: 8, dataUrl: bitmap } },
    { id: 'codec-font', path: 'assets/fonts/codec.json', font: { name: 'codicon.ttf', family, bytes: font.length, dataUrl: encodeEmbeddedFont(font) } },
  );
  const tile: Vector = {
    id: 'tile', kind: 'rectangle', x: 0, y: 0, width: 12, height: 12, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const tinted = { id: 'codec-effect', name: 'Tinted tile', width: 12, height: 12, shapes: [tile] };
  project.symbols!.push(tinted);
  const assetLayer = newLayer('Codec assets');
  assetLayer.keys[0].shapes = [
    { ...tile, id: 'bitmap', x: 4, y: 24, bitmap: { assetId: 'codec-bitmap', x: 0, y: 0, width: 12, height: 12 } },
    { ...tile, id: 'glyph', kind: 'text', x: 72, y: 23, width: 38, height: 17, fill: '#ff00ff',
      text: { content: '\ueabc', font: family, size: 15, align: 'left', bold: false, italic: false } },
    { ...symbolInstance(tinted, 126, 24), opacity: 0.5, instanceTint: { color: '#0000ff', amount: 1 } },
  ];
  project.layers.push(assetLayer);
  project.audioClips = [{ id: 'clip', assetId: 'pcm', startFrame: 2, offsetSamples: 100, gain: 0.5 }];
  await page.addInitScript(({ project, license }) => {
    if (window !== window.top) return;
    localStorage.setItem('splash-license-v1', license!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, license });
  await recoverFixture(page);
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export start frame').fill('2');
  await settings.getByLabel('Export end frame').fill('4');
  await settings.getByRole('button', { name: 'Use frame range', exact: true }).click();
  await settings.getByLabel('Transparent PNG background').check();
  await settings.getByRole('button', { name: 'Export selected FFmpeg inputs…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export FFmpeg input bundle' });
  const include = dialog.getByLabel('Include project audio in FFmpeg bundle');
  const tone = Array.from({ length: 5000 }, (_, i) => 1000 + 2 * (i % 32));
  const file = { name: 'sparse.wav', mimeType: 'audio/wav', buffer: Buffer.from(pcm16WavFixture([tone, tone.map(v => -v)], 48000)) };
  await include.check();
  await dialog.getByLabel('FFmpeg WAV for ' + wavPath).setInputFiles(file);
  await page.evaluate(() => {
    const state = { hit: false, encodes: 0 };
    Reflect.set(window, 'sparseFfmpegTest', state);
    const ready = document.fonts.ready;
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      get() {
        Reflect.deleteProperty(document.fonts, 'ready');
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Include project audio in FFmpeg bundle"]');
        if (!input) throw Error('Missing audio control during PNG readiness.');
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        state.hit = true;
        return ready;
      },
    });
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (this.width === 160 && this.height === 80) state.encodes++;
      return encode.apply(this, args);
    };
  });
  let downloads = 0;
  page.on('download', () => { downloads++; });
  const run = dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true });
  await run.click();
  await expect(dialog.getByRole('alert')).toContainText('FFmpeg bundle controls changed');
  expect(await page.evaluate(() => Reflect.get(window, 'sparseFfmpegTest'))).toEqual({ hit: true, encodes: 0 });
  expect(downloads).toBe(0);
  await include.check();
  await dialog.getByLabel('FFmpeg WAV for ' + wavPath).setInputFiles(file);
  const pending = page.waitForEvent('download');
  await run.click();
  const download = await pending;
  const files = unzip(await fs.readFile((await download.path())!));
  const manifest = JSON.parse(files.get('ffmpeg.json')!.toString());
  expect(manifest.video).toMatchObject({
    width: 160, height: 80, frameCount: 3, firstNumber: 2, sourceStartFrame: 1,
    sourceEndFrameExclusive: 4, frameRate: { numerator: 24, denominator: 1 },
    buttons: 'Up', background: 'transparent',
  });
  expect(manifest.audio).toMatchObject({ start: 2000, end: 8000, frames: 6000, sampleRate: 48000, channels: 2 });
  expect([...files.keys()].sort()).toEqual(['README.txt', 'audio.wav', 'ffmpeg.json', 'frame-000002.png', 'frame-000003.png', 'frame-000004.png'].sort());
  const wav = files.get('audio.wav')!;
  expect(wav.readUInt32LE(40)).toBe(6000 * 4);
  for (let i = 0; i < 6000; i++) {
    const expected = i < 2000 ? 0 : tone[i - 2000 + 100] / 2;
    expect(wav.readInt16LE(44 + i * 4)).toBe(expected);
    expect(wav.readInt16LE(46 + i * 4)).toBe(expected === 0 ? 0 : -expected);
  }
  for (let i = 0; i < 3; i++) {
    const bytes = files.get(`frame-00000${i + 2}.png`)!.toString('base64');
    const pixels = await page.evaluate(async ({ bytes, i }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + bytes;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return {
        size: [canvas.width, canvas.height],
        colors: [[28 + i * 20, 10], [[45, 65, 125][i], 45], [4, 10], [10, 30], [132, 30]]
          .map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)),
        glyphPixels: Array.from(context.getImageData(72, 23, 38, 17).data)
          .filter((value, channel, data) => channel % 4 === 0 && value === 255 &&
            data[channel + 1] === 0 && data[channel + 2] === 255 && data[channel + 3] > 128).length,
      };
    }, { bytes, i });
    expect(pixels.size).toEqual([160, 80]);
    expect(pixels.colors).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0], [0, 255, 0, 255], [0, 0, 255, 128]]);
    expect(pixels.glyphPixels).toBeGreaterThan(5);
  }
  expect(downloads).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  const inputs = testInfo.outputPath('codec-inputs');
  await fs.mkdir(inputs, { recursive: true });
  for (const [name, bytes] of files) await fs.writeFile(testInfo.outputPath('codec-inputs', name), bytes);
  await fs.writeFile(testInfo.outputPath('codec-project.json'), JSON.stringify(project));
});

test('FFmpeg remembered bundle preserves original project and generated motion', async ({
  page,
}) => {
  const f = await setup(page, false, true),
    dialog = await open(page, false, 1, false, true),
    before = await f.read(),
    down = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
  const files = unzip(await fs.readFile((await (await down).path())!));
  expect(JSON.parse(files.get('ffmpeg.json')!.toString()).remembered).toBe(true);
  expect(files.has('frame-000005.png')).toBe(true);
  expect(await f.read()).toEqual(before);
  expect(f.errors).toEqual([]);
});

async function instrument(page: Page, mode: string) {
  await page.addInitScript((mode) => {
    const root = window as unknown as Record<string, unknown>,
      clone = structuredClone,
      stringify = JSON.stringify;
    Object.assign(root, { ffMode: mode, ffCalls: 0, ffHook: false, ffRevoked: 0 });
    JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
      const p = value as { name?: string; layers?: unknown[] };
      if (p?.name === 'FFmpeg source' && Array.isArray(p.layers)) {
        try {
          clone(value);
        } catch (e) {
          if ((e as Error).name === 'DataCloneError') {
            root.ffSource = value;
            // Keep the latest actual project proxy after recovery replaces its input.
          }
        }
      }
      return stringify(value, replacer as never, space);
    }) as typeof JSON.stringify;
    const change = () => {
      root.ffHook = true;
      const mode = String(root.ffMode);
      if (mode.endsWith('source')) {
        const p = root.ffSource as ReturnType<typeof newProject>;
        if (!p?.layers?.[0]) throw Error('Missing actual source');
        p.layers[0].name = 'External source edit';
      } else if (mode === 'publish-close')
        (
          document.querySelector('button[aria-label="Close FFmpeg bundle"]') as HTMLButtonElement
        ).click();
      else if (mode.includes('audio')) {
        const input = document.querySelector(
          'input[aria-label="Include project audio in FFmpeg bundle"]',
        ) as HTMLInputElement;
        const before = input.checked;
        input.checked = !before;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (mode.startsWith('restored')) {
          input.checked = before;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        const input = document.querySelector(
          'select[aria-label="PNG export scale"]',
        ) as HTMLSelectElement;
        const before = input.value;
        input.value = '2';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (mode.startsWith('restored')) {
          input.value = before;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const node = create(tag, options);
      if (tag.toLowerCase() === 'iframe')
        node.addEventListener('load', () => {
          const host = node as HTMLIFrameElement;
          if (host.title !== 'PNG frame renderer') return;
          const prototype = (
              host.contentWindow as unknown as { HTMLCanvasElement: typeof HTMLCanvasElement }
            ).HTMLCanvasElement.prototype,
            encode = prototype.toBlob;
          prototype.toBlob = function (callback, type, quality) {
            const n = Number(root.ffCalls) + 1;
            root.ffCalls = n;
            const mode = String(root.ffMode);
            if (n === 2 && ['options', 'restored-options', 'publish-options'].includes(mode)) {
              root.ffWaiting = true;
              root.ffResume = () => {
                if (!mode.startsWith('publish')) change();
                encode.call(this, callback, type, quality);
              };
              return;
            }
            if (
              n === 2 &&
              mode !== 'success' &&
              !mode.startsWith('publish') &&
              mode !== 'deadline'
            ) {
              root.ffHook = true;
              if (mode === 'failure') {
                callback(null);
                return;
              }
              if (mode === 'cancel' || mode === 'close') {
                root.ffLate = () => callback(new Blob(['late'], { type: 'image/png' }));
                return;
              }
              change();
            }
            return encode.call(this, callback, type, quality);
          };
        });
      return node;
    }) as typeof document.createElement;
    const url = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    let ownedURL = '';
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const result = url(blob);
      if (
        blob instanceof Blob &&
        blob.type === 'application/zip' &&
        String(root.ffMode).startsWith('publish')
      ) {
        ownedURL = result;
        change();
      }
      return result;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (value: string) => {
      if (value === ownedURL) root.ffRevoked = Number(root.ffRevoked) + 1;
      revoke(value);
    };
    if (mode === 'deadline') {
      const timeout = setTimeout;
      let armed = true;
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (armed && delay === 60000) {
          armed = false;
          root.ffHook = true;
          return timeout(callback, 20, ...args);
        }
        return timeout(callback, delay, ...args);
      }) as typeof setTimeout;
    }
  }, mode);
}
for (const mode of [
  'failure',
  'cancel',
  'close',
  'source',
  'options',
  'restored-options',
  'audio-options',
  'restored-audio',
  'publish-source',
  'publish-options',
  'publish-close',
  'deadline',
])
  test(
    'FFmpeg bundle rejects late ' + mode + ' without partial output and retries',
    async ({ page }) => {
      await instrument(page, mode);
      const audio = mode.includes('audio'),
        f = await setup(page, audio),
        dialog = await open(page),
        before = await f.read();
      let downloads = 0;
      page.on('download', () => downloads++);
      if (audio) {
        await dialog.getByLabel('Include project audio in FFmpeg bundle').check();
        await dialog.getByLabel('FFmpeg WAV for assets/audio/tone.wav').setInputFiles({
          name: 'tone.wav',
          mimeType: 'audio/wav',
          buffer: Buffer.from(
            pcm16WavFixture([Array(16000).fill(10000), Array(16000).fill(-10000)], 48000),
          ),
        });
      }
      await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
      if (['options', 'restored-options', 'publish-options'].includes(mode)) {
        await expect
          .poll(() =>
            page.evaluate(() => !!(window as unknown as { ffWaiting: boolean }).ffWaiting),
          )
          .toBe(true);
        // The hidden parent retains its controls for the test's deliberate late mutation.
        await expect(page.getByLabel('PNG export scale', { exact: true })).toHaveCount(1);
        await page.evaluate(() => (window as unknown as { ffResume: () => void }).ffResume());
      }
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { ffHook: boolean }).ffHook))
        .toBe(true);
      if (mode === 'cancel') {
        await expect(dialog.getByRole('button', { name: 'Cancel FFmpeg bundle', exact: true })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true })).toBeFocused();
      }
      if (mode === 'close') await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
      if (!['cancel', 'close', 'publish-close'].includes(mode))
        await expect(dialog.getByRole('alert')).toContainText(
          mode === 'failure'
            ? 'encoding failed'
            : mode === 'deadline'
              ? 'timed out'
              : mode.includes('audio')
                ? 'controls changed'
                : 'source or options changed',
        );
      await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
      expect(downloads).toBe(0);
      if (mode.endsWith('source'))
        await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue(
          'External source edit',
        );
      else expect(await f.read()).toEqual(before);
      if (mode.startsWith('publish'))
        expect(
          await page.evaluate(() => (window as unknown as { ffRevoked: number }).ffRevoked),
        ).toBe(1);
      await page.evaluate(() => {
        const root = window as unknown as { ffMode: string; ffCalls: number; ffLate?: () => void };
        root.ffMode = 'success';
        root.ffCalls = 0;
        root.ffLate?.();
      });
      if (await dialog.count())
        await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
      const retry = await open(page);
      const down = page.waitForEvent('download');
      await retry.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
      const result = await down;
      expect(unzip(await fs.readFile((await result.path())!)).has('ffmpeg.json')).toBe(true);
      expect(downloads).toBe(1);
      expect(f.errors).toEqual([]);
    },
  );
test('FFmpeg audio remains explicit and missing WAV selection does not become silent output', async ({
  page,
}) => {
  const f = await setup(page, true),
    dialog = await open(page);
  await dialog.getByLabel('Include project audio in FFmpeg bundle').check();
  await expect(
    dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Include project audio in FFmpeg bundle').uncheck();
  const down = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
  const files = unzip(await fs.readFile((await (await down).path())!));
  expect(files.has('audio.wav')).toBe(false);
  expect(JSON.parse(files.get('ffmpeg.json')!.toString()).audio).toBeNull();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('FFmpeg WAV metadata failure rejects before frame capture and accepts corrected files', async ({
  page,
}) => {
  const f = await setup(page, true),
    dialog = await open(page),
    file = dialog.getByLabel('FFmpeg WAV for assets/audio/tone.wav');
  await dialog.getByLabel('Include project audio in FFmpeg bundle').check();
  await file.setInputFiles({
    name: 'wrong.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(pcm16WavFixture([Array(15999).fill(0), Array(15999).fill(0)], 48000)),
  });
  let n = 0;
  page.on('download', () => n++);
  await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('metadata mismatch');
  expect(n).toBe(0);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  await file.setInputFiles({
    name: 'correct.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(pcm16WavFixture([Array(16000).fill(0), Array(16000).fill(0)], 48000)),
  });
  const down = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
  await down;
  expect(n).toBe(1);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

async function saveHarness(page: Page, mode: string) {
  await instrument(page, 'success');
  await page.addInitScript((mode) => {
    const root = window as unknown as Record<string, unknown>;
    const state = {
      mode,
      pickers: 0,
      activation: false,
      opens: 0,
      writes: 0,
      closes: 0,
      aborts: 0,
      abortRequests: 0,
      maximum: 0,
      active: 0,
      concurrency: 0,
      published: [] as number[][],
      phase: '',
    };
    root.ffSave = state;
    if (mode === 'timeout') {
      const timeout = window.setTimeout.bind(window);
      let armed = true;
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (armed && delay === 60000) {
          armed = false;
          return timeout(callback, 500, ...args);
        }
        return timeout(callback, delay, ...args);
      }) as typeof window.setTimeout;
    }
    const source = () => {
      const p = root.ffSource as { layers: { name: string }[] };
      if (!p?.layers[0]) throw Error('Missing actual editor source');
      p.layers[0].name = 'External source edit';
    };
    Object.assign(window, {
      showSaveFilePicker: async () => {
        state.pickers++;
        state.activation = navigator.userActivation.isActive;
        if (state.mode === 'picker-cancel')
          throw new DOMException('Picker cancelled', 'AbortError');
        if (state.mode === 'picker-source') source();
        const create = () => {
          const chunks: number[][] = [];
          const stream = new WritableStream<Uint8Array>({
            async write(chunk) {
              state.writes++;
              state.maximum = Math.max(state.maximum, chunk.byteLength);
              state.active++;
              state.concurrency = Math.max(state.concurrency, state.active);
              chunks.push([...chunk]);
              state.phase = 'write';
              try {
                if (
                  [
                    'pause',
                    'cancel',
                    'close',
                    'png-options',
                    'restored-png',
                    'file-options',
                    'timeout',
                  ].includes(state.mode) &&
                  state.writes === 1
                )
                  await new Promise<void>((r) => {
                    root.ffWriteRelease = r;
                  });
                if (state.mode === 'write-failure') throw Error('Provisional write failed');
                if (
                  state.mode === 'write-source' ||
                  state.mode === 'abort-pause' ||
                  (state.mode === 'final-source' &&
                    new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(
                      0,
                      true,
                    ) === 0x02014b50)
                )
                  source();
                if (['audio-options', 'restored-audio-options'].includes(state.mode)) {
                  const input = document.querySelector(
                      'input[aria-label="Include project audio in FFmpeg bundle"]',
                    ) as HTMLInputElement,
                    before = input.checked;
                  input.checked = !before;
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                  if (state.mode.startsWith('restored')) {
                    input.checked = before;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              } finally {
                state.active--;
              }
            },
            async close() {
              state.closes++;
              state.phase = 'close';
              if (state.mode === 'close-failure') throw Error('Final close failed');
              if (state.mode === 'close-pause')
                await new Promise<void>((r) => {
                  root.ffCloseRelease = r;
                });
              state.published = chunks;
              state.phase = 'saved';
            },
            async abort() {
              state.aborts++;
              state.phase = 'aborted';
              if (state.mode === 'abort-pause')
                await new Promise<void>((r) => {
                  root.ffAbortRelease = r;
                });
              chunks.length = 0;
            },
          });
          const getWriter = stream.getWriter.bind(stream);
          stream.getWriter = () => {
            const writer = getWriter(),
              abort = writer.abort.bind(writer);
            writer.abort = (reason) => {
              state.abortRequests++;
              return abort(reason);
            };
            return writer;
          };
          root.ffWritable = stream;
          return stream;
        };
        return {
          async createWritable() {
            state.opens++;
            state.phase = 'open';
            if (state.mode === 'open-failure') throw Error('Opening failed');
            if (state.mode === 'late-open')
              return new Promise<WritableStream<Uint8Array>>((r) => {
                root.ffOpenRelease = () => r(create());
              });
            return create();
          },
        };
      },
    });
  }, mode);
}
async function supplyFFmpegAudio(dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByLabel('Include project audio in FFmpeg bundle').check();
  await dialog.getByLabel('FFmpeg WAV for assets/audio/tone.wav').setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(
      pcm16WavFixture([Array(16000).fill(10000), Array(16000).fill(-10000)], 48000),
    ),
  });
}
for (const selected of [false, true])
  for (const audio of [false, true])
    test(`FFmpeg file save exact download bytes selected ${selected} audio ${audio}`, async ({
      page,
    }) => {
      await saveHarness(page, 'success');
      const f = await setup(page, audio),
        before = await f.read(),
        dialog = await open(page, selected, selected ? 2 : 1, selected, false, true);
      if (audio) await supplyFFmpegAudio(dialog);
      let downloads = 0;
      page.on('download', () => downloads++);
      await dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('Saved');
      const state = await page.evaluate(
        () =>
          (
            window as unknown as {
              ffSave: {
                published: number[][];
                activation: boolean;
                maximum: number;
                concurrency: number;
                closes: number;
                aborts: number;
              };
            }
          ).ffSave,
      );
      expect(state.activation).toBe(true);
      expect(state.maximum).toBeLessThanOrEqual(65536);
      expect(state.concurrency).toBe(1);
      expect(state.closes).toBe(1);
      expect(state.aborts).toBe(0);
      expect(downloads).toBe(0);
      const saved = Buffer.concat(state.published.map((c) => Buffer.from(c)));
      const entries = unzip(saved),
        manifest = JSON.parse(entries.get('ffmpeg.json')!.toString());
      expect(manifest.video.firstNumber).toBe(selected ? 3 : 1);
      expect(manifest.audio !== null).toBe(audio);
      expect(manifest.video.frameRate).toEqual({ numerator: 2997, denominator: 100 });
      await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
      const downloadDialog = await open(page, selected, selected ? 2 : 1, selected);
      if (audio) await supplyFFmpegAudio(downloadDialog);
      const down = page.waitForEvent('download');
      await downloadDialog
        .getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true })
        .click();
      expect(await fs.readFile((await (await down).path())!)).toEqual(saved);
      expect(await f.read()).toEqual(before);
      expect(f.errors).toEqual([]);
      await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
    });
for (const mode of [
  'picker-cancel',
  'picker-source',
  'open-failure',
  'write-failure',
  'write-source',
  'final-source',
  'audio-options',
  'restored-audio-options',
  'cancel',
  'close',
  'png-options',
  'restored-png',
  'file-options',
  'late-open',
  'close-failure',
  'timeout',
  'abort-pause',
])
  test('FFmpeg file save rejects ' + mode + ' and retries', async ({ page }) => {
    await saveHarness(page, mode);
    const audio = mode === 'file-options',
      f = await setup(page, audio),
      before = await f.read(),
      dialog = await open(page, false, 1, false, false, true);
    if (audio) await supplyFFmpegAudio(dialog);
    let downloads = 0;
    page.on('download', () => downloads++);
    await dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
    if (['cancel', 'close', 'png-options', 'restored-png', 'file-options'].includes(mode)) {
      await expect
        .poll(() =>
          page.evaluate(
            () => typeof (window as unknown as { ffWriteRelease?: unknown }).ffWriteRelease,
          ),
        )
        .toBe('function');
      if (mode === 'cancel')
        await dialog.getByRole('button', { name: 'Cancel FFmpeg bundle', exact: true }).click();
      else if (mode === 'close')
        await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
      else if (mode === 'file-options')
        await dialog.getByLabel('FFmpeg WAV for assets/audio/tone.wav').evaluate((input) => {
          const data = new DataTransfer();
          data.items.add(new File(['changed'], 'changed.wav', { type: 'audio/wav' }));
          (input as HTMLInputElement).files = data.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else {
        await page.getByLabel('PNG export scale', { exact: true }).evaluate((input, restored) => {
          const select = input as HTMLSelectElement,
            before = select.value;
          select.value = '2';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          if (restored) {
            select.value = before;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, mode === 'restored-png');
      }
      await page.evaluate(() =>
        (window as unknown as { ffWriteRelease: () => void }).ffWriteRelease(),
      );
    }
    if (mode === 'timeout') {
      await expect
        .poll(() =>
          page.evaluate(
            () => typeof (window as unknown as { ffWriteRelease?: unknown }).ffWriteRelease,
          ),
        )
        .toBe('function');
      await page.waitForTimeout(700);
      await page.evaluate(() =>
        (window as unknown as { ffWriteRelease: () => void }).ffWriteRelease(),
      );
    }
    if (mode === 'abort-pause') {
      await expect
        .poll(() =>
          page.evaluate(
            () => typeof (window as unknown as { ffAbortRelease?: unknown }).ffAbortRelease,
          ),
        )
        .toBe('function');
      await expect(
        dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { ffSave: { published: number[][]; closes: number } }).ffSave,
        ),
      ).toMatchObject({ published: [], closes: 0 });
      await page.evaluate(() =>
        (window as unknown as { ffAbortRelease: () => void }).ffAbortRelease(),
      );
    }
    if (mode === 'late-open') {
      await expect
        .poll(() =>
          page.evaluate(
            () => typeof (window as unknown as { ffOpenRelease?: unknown }).ffOpenRelease,
          ),
        )
        .toBe('function');
      await dialog.getByRole('button', { name: 'Cancel FFmpeg bundle', exact: true }).click();
      await expect(
        dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }),
      ).toBeVisible();
      await page.evaluate(() =>
        (window as unknown as { ffOpenRelease: () => void }).ffOpenRelease(),
      );
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { ffSave: { aborts: number } }).ffSave.aborts),
        )
        .toBe(1);
    }
    if (!['picker-cancel', 'cancel', 'close', 'late-open'].includes(mode))
      await expect(dialog.getByRole('alert')).toContainText(
        mode.includes('source') || mode.includes('png') || mode === 'abort-pause'
          ? 'source or options changed'
          : mode.includes('options')
            ? 'controls changed'
            : mode === 'timeout'
              ? 'timed out'
              : mode === 'open-failure'
                ? 'Opening failed'
                : mode === 'close-failure'
                  ? 'Final close failed'
                  : 'Provisional write failed',
      );
    await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
    const state = await page.evaluate(
      () =>
        (
          window as unknown as {
            ffSave: {
              published: number[][];
              closes: number;
              aborts: number;
              opens: number;
              abortRequests: number;
            };
          }
        ).ffSave,
    );
    expect(state.published).toEqual([]);
    expect(downloads).toBe(0);
    expect(state.closes).toBe(mode === 'close-failure' ? 1 : 0);
    if (state.opens && mode !== 'open-failure') {
      expect(state.abortRequests).toBe(1);
      expect(
        await page.evaluate(
          () => (window as unknown as { ffWritable: WritableStream<Uint8Array> }).ffWritable.locked,
        ),
      ).toBe(false);
      if (!['write-failure', 'close-failure'].includes(mode)) expect(state.aborts).toBe(1);
    }
    if (mode.includes('source') || mode === 'abort-pause')
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue(
        'External source edit',
      );
    else expect(await f.read()).toEqual(before);
    if (await dialog.count())
      await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
    await page.evaluate(() => {
      const root = window as unknown as { ffSave: { mode: string; writes: number; phase: string } };
      root.ffSave.mode = 'success';
      root.ffSave.writes = 0;
      root.ffSave.phase = '';
    });
    const retry = await open(page, false, 1, false, false, true);
    await retry.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
    await expect(retry.getByRole('status')).toContainText('Saved');
    expect(
      (
        await page.evaluate(
          () => (window as unknown as { ffSave: { published: number[][] } }).ffSave.published,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(f.errors).toEqual([]);
  });
test('FFmpeg file save awaits final close after its cancellation boundary', async ({ page }) => {
  await saveHarness(page, 'close-pause');
  const f = await setup(page),
    before = await f.read(),
    dialog = await open(page, false, 1, false, false, true);
  await dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as unknown as { ffCloseRelease?: unknown }).ffCloseRelease,
      ),
    )
    .toBe('function');
  await expect(
    dialog.getByRole('button', { name: 'Cancel FFmpeg bundle', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText('Finishing file. Saving continues if you close this dialog.', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { ffSave: { aborts: number; published: number[][] } }).ffSave,
    ),
  ).toMatchObject({ aborts: 0, published: [] });
  await page.evaluate(() => (window as unknown as { ffCloseRelease: () => void }).ffCloseRelease());
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { ffSave: { phase: string } }).ffSave.phase),
    )
    .toBe('saved');
  expect(await f.read()).toEqual(before);
  expect(f.errors).toEqual([]);
});

test('FFmpeg file save remembers motion with exact downloadable bytes', async ({ page }) => {
  await saveHarness(page, 'success');
  const f = await setup(page, false, true),
    before = await f.read(),
    dialog = await open(page, false, 1, false, true, true);
  await dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  const saved = Buffer.concat(
    (
      await page.evaluate(
        () => (window as unknown as { ffSave: { published: number[][] } }).ffSave.published,
      )
    ).map((c) => Buffer.from(c)),
  );
  expect(JSON.parse(unzip(saved).get('ffmpeg.json')!.toString()).remembered).toBe(true);
  await dialog.getByLabel('Close FFmpeg bundle', { exact: true }).click();
  const next = await open(page, false, 1, false, true),
    down = page.waitForEvent('download');
  await next.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true }).click();
  expect(await fs.readFile((await (await down).path())!)).toEqual(saved);
  expect(await f.read()).toEqual(before);
  expect(f.errors).toEqual([]);
});

for (const source of [false, true])
  test('FFmpeg file save actual private filesystem rollback ' + source, async ({ page }) => {
    await instrument(page, 'success');
    await page.addInitScript((source) => {
      const root = window as unknown as Record<string, unknown>;
      root.ffActual = { writes: 0, closes: 0, aborts: 0 };
      Object.assign(window, {
        showSaveFilePicker: async () => {
          const directory = await navigator.storage.getDirectory(),
            name = 'splash-ffmpeg-save-check-' + String(source) + '.zip',
            handle = await directory.getFileHandle(name, { create: true });
          root.ffActualHandle = handle;
          const initial = await handle.createWritable();
          await initial.write('original destination bytes');
          await initial.close();
          return {
            async createWritable() {
              const stream = await handle.createWritable(),
                getWriter = stream.getWriter.bind(stream);
              stream.getWriter = () => {
                const writer = getWriter(),
                  write = writer.write.bind(writer),
                  close = writer.close.bind(writer),
                  abort = writer.abort.bind(writer),
                  state = root.ffActual as { writes: number; closes: number; aborts: number };
                writer.write = async (chunk) => {
                  await write(chunk);
                  state.writes++;
                  if (source)
                    (root.ffSource as { layers: { name: string }[] }).layers[0].name =
                      'External source edit';
                };
                writer.close = async () => {
                  state.closes++;
                  await close();
                };
                writer.abort = async (reason) => {
                  state.aborts++;
                  await abort(reason);
                };
                return writer;
              };
              return stream;
            },
          };
        },
      });
    }, source);
    const f = await setup(page),
      before = await f.read(),
      dialog = await open(page, false, 1, false, false, true);
    await dialog.getByRole('button', { name: 'Save FFmpeg input ZIP', exact: true }).click();
    if (source) await expect(dialog.getByRole('alert')).toContainText('source or options changed');
    else await expect(dialog.getByRole('status')).toContainText('Saved');
    const saved = Buffer.from(
      await page.evaluate(async () => {
        const handle = (window as unknown as { ffActualHandle: FileSystemFileHandle })
          .ffActualHandle;
        const file = await handle.getFile();
        return [...new Uint8Array(await file.arrayBuffer())];
      }),
    );
    if (source) {
      expect(saved.toString()).toBe('original destination bytes');
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue(
        'External source edit',
      );
    } else {
      expect(unzip(saved).has('ffmpeg.json')).toBe(true);
      expect(await f.read()).toEqual(before);
    }
    expect(
      await page.evaluate(() => (window as unknown as { ffActual: unknown }).ffActual),
    ).toMatchObject({ closes: source ? 0 : 1, aborts: source ? 1 : 0 });
    expect(f.errors).toEqual([]);
    await page.evaluate(async (source) => {
      const directory = await navigator.storage.getDirectory();
      await directory.removeEntry('splash-ffmpeg-save-check-' + String(source) + '.zip');
    }, source);
  });
