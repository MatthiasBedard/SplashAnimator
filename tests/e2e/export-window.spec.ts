import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newProject, validateProject } from '../../packages/document/src';
import { prepareCreateLiveMotionSpans } from '../../packages/animation/src/live-motion';
import { encodePcm16Wav } from '../../packages/audio/src/wav-encode';
import { exportHTML } from '../../packages/export-web/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { encodeEmbeddedFont } from '../../packages/document/src/embedded-font';
import { pathToFileURL } from 'node:url';
import { extractWebDownload, openWebExport, readWebDownload, readWebExport } from './web-export-files';
import { exportHtmlFromShortcut, openHtmlShortcut } from './export-settings';

test('single-frame export publishes all seven file formats and keeps supported backgrounds transparent', async ({ page }) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export single frame…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog.getByLabel('Export format')).toHaveValue('still');
  await expect(dialog.getByLabel('Single frame number')).toHaveValue('1');

  for (const format of ['png', 'gif', 'jpg', 'bmp', 'tiff', 'svg', 'eps'] as const) {
    if (!(await dialog.isVisible())) await f.open();
    const transparency = dialog.getByRole('checkbox', { name: 'Transparent background', exact: true });
    await dialog.getByLabel('Single frame number').fill('3');
    await dialog.getByLabel('Single frame file type').selectOption(format);
    const clear = format !== 'jpg' && format !== 'bmp';
    if (clear) await transparency.check();
    else await expect(transparency).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export frame…', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`-frame-3\\.${format}$`));
    const bytes = await readFile((await download.path())!);
    if (format === 'tiff') {
      expect(bytes.readUInt32LE(0)).toBe(0x002a4949);
      const ifd = bytes.readUInt32LE(4), fields = new Map<number, number>();
      for (let index = 0; index < bytes.readUInt16LE(ifd); index++) {
        const entry = ifd + 2 + index * 12;
        fields.set(bytes.readUInt16LE(entry), bytes.readUInt32LE(entry + 8));
      }
      expect(fields.get(338)).toBe(2);
      expect(bytes[fields.get(273)! + 3]).toBe(0);
    } else if (format === 'eps') {
      expect(bytes.toString()).toContain('%%BoundingBox: 0 0 100 80');
      expect(bytes.toString()).toContain('[1 0 0 1 35 10] concat');
      expect(bytes.toString()).not.toContain('rectfill');
    } else {
      if (format === 'svg') expect(bytes.toString()).toContain('<path');
      const mime = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', bmp: 'image/bmp', svg: 'image/svg+xml' }[format]!;
      const result = await page.evaluate(async ({ encoded, mime }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          size: [image.width, image.height],
          background: context.getImageData(5, 5, 1, 1).data[3],
          foreground: Array.from(context.getImageData(45, 20, 1, 1).data),
        };
      }, { encoded: bytes.toString('base64'), mime });
      expect(result.size).toEqual([100, 80]);
      expect(result.background).toBe(clear ? 0 : 255);
      expect(result.foreground[0]).toBeGreaterThan(245);
      expect(result.foreground[1]).toBeLessThan(10);
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

test('desktop single-frame export hands encoded output to its save chooser and can retry cancellation', async ({ page }) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  await page.addInitScript(license => {
    const output: Record<string, string>[] = [];
    Reflect.set(window, 'stillOutput', output);
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      invoke(command: string, args?: { request: Record<string, string> }) {
        if (command === 'read_license') return Promise.resolve(license);
        if (command === 'project_operation' && args?.request.op === 'export-still') {
          output.push(args.request);
          return Promise.resolve(output.length === 1 ? null : '/export/Untitled-frame-1.png');
        }
        return Promise.resolve(null);
      },
    });
  }, token);
  const f = await setup(page);
  const dialog = await f.open();
  await dialog.getByLabel('Export format').selectOption('still');
  const action = dialog.getByRole('button', { name: 'Export frame…', exact: true });
  await action.click();
  await expect(dialog.getByRole('status')).toHaveText('Single-frame export cancelled.');
  await expect(action).toBeFocused();
  await action.press('Enter');
  await expect(dialog).toHaveCount(0);
  const requests = await page.evaluate(() => Reflect.get(window, 'stillOutput') as Record<string, string>[]);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[1]).toMatchObject({ project: 'Untitled-frame-1.png', path: 'png' });
  expect(Buffer.from(requests[1].content, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('HTML shortcuts open settings and the exported canvas follows the selected sizing', async ({ page }) => {
  const f = await setup(page);
  const file = page.getByRole('button', { name: 'File', exact: true });
  const toolbar = page.getByRole('button', { name: '↗ Export HTML', exact: true });
  const downloads: unknown[] = [];
  page.on('download', download => downloads.push(download));

  const initial = await f.open();
  await initial.getByLabel('Export format').selectOption('png');
  await expect(initial.getByLabel('Export end frame')).toHaveValue('3');
  await initial.getByLabel('Export end frame').fill('2');
  await page.keyboard.press('Escape');

  const fromToolbar = await openHtmlShortcut(page);
  await expect(fromToolbar.getByLabel('Export end frame')).toHaveValue('3');
  await expect(fromToolbar.getByLabel('HTML canvas size')).toHaveValue('fit');
  expect(downloads).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(toolbar).toBeFocused();

  for (const [sizing, large, small] of [
    ['fit', { width: 375, height: 300 }, { width: 75, height: 60 }],
    ['shrink', { width: 100, height: 80 }, { width: 75, height: 60 }],
    ['actual', { width: 100, height: 80 }, { width: 100, height: 80 }],
  ] as const) {
    await file.click();
    const dialog = await openHtmlShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
    await dialog.getByLabel('HTML canvas size').selectOption(sizing);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', {
        name: sizing === 'actual' ? 'Export remembered HTML animation…' : 'Export HTML animation…',
        exact: true,
      }).click(),
    ]);
    await expect(dialog).toHaveCount(0);
    await expect(file).toBeFocused();
    const viewer = await page.context().newPage();
    await viewer.setViewportSize({ width: 500, height: 300 });
    await openWebExport(viewer, await readWebDownload(download));
    const canvas = viewer.locator('canvas');
    const bounds = () => canvas.evaluate(node => {
      const { width, height } = node.getBoundingClientRect();
      return { width, height };
    });
    await expect.poll(bounds).toEqual(large);
    await viewer.setViewportSize({ width: 80, height: 60 });
    await expect.poll(bounds).toEqual(small);
    await expect(canvas).toHaveAttribute('width', '100');
    await expect(canvas).toHaveAttribute('height', '80');
    await viewer.close();
  }
  expect(downloads).toHaveLength(3);
});

test('Web folder download plays locally and over HTTP with separate media', async ({ page }, testInfo) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  const project = newProject('Folder demo');
  project.width = 64;
  project.height = 48;
  project.duration = 4;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=';
  const font = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const audioPath = 'assets/audio/cue.wav';
  const frames = 4800;
  project.assets = [
    { id: 'pixel', path: 'assets/bitmaps/pixel.json', bitmap: { name: 'Pixel', width: 1, height: 1, dataUrl: 'data:image/png;base64,' + png } },
    { id: 'font', path: 'assets/fonts/codicon.json', font: { name: 'codicon.ttf', family: 'Splash Font Folder Icons', bytes: font.length, dataUrl: encodeEmbeddedFont(font) } },
    { id: 'cue', path: audioPath, audio: { name: 'cue.wav', format: 'pcm16-wav', sampleRate: 48000, frames, channels: 1 } },
  ];
  project.audioClips = [{ id: 'cue-clip', assetId: 'cue', startFrame: 0, offsetSamples: 0, gain: 1 }];
  const rect = { id: 'red', kind: 'rectangle' as const, x: 4, y: 4, width: 25, height: 20,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  project.layers[0].keys[0].shapes = [
    rect,
    { ...rect, id: 'image', x: 34, bitmap: { assetId: 'pixel', x: 0, y: 0, width: 20, height: 20 } },
    { ...rect, id: 'label', kind: 'text', y: 25, text: { content: '\ueabc', font: 'Splash Font Folder Icons', size: 12, align: 'left', bold: false, italic: false } },
  ];
  project.frameScripts = [{ frame: 0, source: 'throw new Error("Guest code must not be packaged");' }];
  validateProject(project);
  await page.addInitScript(({ project, token }) => {
    if (window !== window.top) return;
    localStorage.setItem('splash-license-v1', token!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, token });
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible({ timeout: 30000 });
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByLabel('Export format', { exact: true }).selectOption('html');
  await expect(dialog.getByLabel('HTML output')).toHaveCount(0);
  await dialog.getByLabel('HTML audio format').selectOption('wav');
  await dialog.getByLabel(`WAV for ${audioPath}`).setInputFiles({
    name: 'cue.wav', mimeType: 'audio/wav',
    buffer: Buffer.from(encodePcm16Wav([new Float32Array(frames)], 48000)),
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export HTML animation…', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Folder-demo-web.zip');
  const files = await readWebDownload(download);
  expect(Array.from(files.keys()).sort()).toEqual([
    'assets/audio/soundtrack.wav', 'assets/fonts/font-1.ttf', 'assets/images/image-1.png',
    'data/animation.js', 'data/local-media.js', 'index.html', 'scripts/player.js',
  ]);
  expect(files.get('assets/images/image-1.png')).toEqual(Buffer.from(png, 'base64'));
  expect(files.get('assets/fonts/font-1.ttf')).toEqual(font);
  expect(files.get('assets/audio/soundtrack.wav')?.toString('utf8', 0, 4)).toBe('RIFF');
  expect(files.get('data/animation.js')?.toString()).not.toMatch(/data:|Guest code/);
  const local = await extractWebDownload(download, testInfo.outputPath('web folder'));
  for (const mode of ['local', 'hosted']) {
    const viewer = await page.context().newPage();
    const requests: string[] = [];
    viewer.on('request', request => requests.push(request.url()));
    if (mode === 'local') await viewer.goto(pathToFileURL(local).href);
    else await openWebExport(viewer, files);
    const play = viewer.getByRole('button', { name: 'Play animation' });
    await expect(play).toBeEnabled();
    await play.click();
    await expect.poll(() => viewer.locator('canvas').evaluate(canvas =>
      Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(8, 8, 1, 1).data)
    )).toEqual([255, 0, 0, 255]);
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    expect(requests.some(url => url.endsWith('/data/local-media.js'))).toBe(mode === 'local');
    await viewer.close();
  }
});

test('standalone tween moves shared movie artwork while its local clock keeps running', async ({ page }) => {
  const project = newProject();
  project.width = 150;
  project.height = 50;
  project.duration = 5;
  const red = {
    id: 'art', kind: 'rectangle' as const, x: 0, y: 0, width: 12, height: 12, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const definition = {
    id: 'clip', name: 'Clip', width: 12, height: 12, shapes: [red],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...red, fill: '#0000ff' }] }] },
  };
  project.symbols = [definition];
  const instance = {
    ...symbolInstance(definition, 0, 10),
    symbolPlayback: { mode: 'movie' as const, firstFrame: 1 },
  };
  const layer = project.layers[0];
  layer.keys = [{ frame: 0, shapes: [instance] }, { frame: 4, shapes: [{ ...instance, x: 80 }] }];
  const tween = prepareCreateLiveMotionSpans(project, [{
    layerId: layer.id, span: { id: 'tween', start: 0, end: 4, ease: 'linear', symbolContinuity: 'movies' },
  }]);
  await page.evaluate(() => {
    const queue: FrameRequestCallback[] = [];
    window.requestAnimationFrame = callback => queue.push(callback);
    Reflect.set(window, 'movieFrames', queue);
  });
  await page.setContent(exportHTML(tween));
  await page.waitForFunction(() => Reflect.get(window, 'movieFrames').length > 0);
  for (let frame = 0; frame < 5; frame++) {
    const pixels = await page.evaluate(({ frame, fps }) => {
      const queue = Reflect.get(window, 'movieFrames') as FrameRequestCallback[];
      queue.shift()!(frame ? (frame + 0.01) * 1000 / fps : 0);
      const canvas = document.querySelector('canvas')!;
      return Array.from(canvas.getContext('2d')!.getImageData(5 + frame * 20, 15, 1, 1).data);
    }, { frame, fps: project.fps });
    expect(pixels).toEqual(frame % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
});

test('HTML export embeds the selected soundtrack format and follows the audio clock', async ({ page }) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  const project = newProject();
  project.width = 64;
  project.height = 48;
  project.duration = 12;
  project.fps = 10;
  const red = { id: 'art', kind: 'rectangle' as const, x: 8, y: 8, width: 32, height: 30,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  project.layers[0].keys = [{ frame: 0, shapes: [red] }, { frame: 3, shapes: [{ ...red, fill: '#00ff00' }] }];
  project.frameScripts = [{ frame: 3, source: 'globalThis.unexpectedFrameScript = true' }];
  const rate = 48000, frames = rate / 2, path = 'assets/audio/voice.wav';
  project.assets = [{ id: 'voice', path, audio: { name: 'voice.wav', format: 'pcm16-wav', sampleRate: rate, frames, channels: 1 } }];
  project.audioClips = [{ id: 'cue', assetId: 'voice', startFrame: 2, offsetSamples: 0, gain: 1 }];
  const wav = Buffer.from(encodePcm16Wav([Float32Array.from({ length: frames }, (_, i) =>
    0.45 * Math.sin(2 * Math.PI * 440 * i / rate))], rate));
  await page.addInitScript(({ project, token }) => {
    if (window !== window.top) return;
    localStorage.setItem('splash-license-v1', token!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, token });
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  const original = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const lengths = new Map<string, number>();
  for (const format of ['none', 'wav', 'opus']) {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Export…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await dialog.getByLabel('Export format', { exact: true }).selectOption('html');
    const codec = dialog.getByLabel('HTML audio format');
    await expect(codec).toHaveValue('none');
    await codec.selectOption(format);
    const remembered = format === 'opus';
    const save = dialog.getByRole('button', { name: remembered ? 'Export remembered HTML animation…' : 'Export HTML animation…', exact: true });
    if (format !== 'none') {
      await expect(save).toBeDisabled();
      const input = dialog.getByLabel(`WAV for ${path}`);
      if (format === 'wav') {
        await input.setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(48) });
        await save.click();
        await expect(dialog.getByRole('alert')).toContainText(/WAV|RIFF/i);
      }
      await input.setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav });
      if (format === 'wav') {
        await page.evaluate(() => {
          const normal = File.prototype.arrayBuffer;
          File.prototype.arrayBuffer = function () {
            if (this.name !== 'voice.wav') return normal.call(this);
            File.prototype.arrayBuffer = normal;
            return new Promise<ArrayBuffer>(resolve => Object.assign(window, {
              resumeTestAudioRead: () => { void normal.call(this).then(resolve); },
            }));
          };
        });
        await save.click();
        await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'resumeTestAudioRead'))).toBe('function');
        await dialog.getByRole('button', { name: 'Cancel web folder export' }).click();
        await expect(save).toBeEnabled();
        await page.evaluate(() => Reflect.get(window, 'resumeTestAudioRead')());
        await expect(dialog).toBeVisible();
      }
    }
    const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
    const files = await readWebDownload(download);
    const html = files.get('index.html')!.toString();
    expect(files.get('data/animation.js')!.toString()).not.toContain('unexpectedFrameScript');
    if (format === 'none') {
      expect(html).not.toContain('<audio ');
      continue;
    }
    expect(html).toContain(`assets/audio/soundtrack.${format === 'opus' ? 'ogg' : 'wav'}`);
    const viewer = await page.context().newPage();
    await openWebExport(viewer, files);
    const play = viewer.getByRole('button', { name: 'Play animation' });
    await expect(play).toBeEnabled();
    const decoded = await viewer.locator('audio').evaluate(async (media: HTMLAudioElement) => {
      const audio = new OfflineAudioContext(1, 1, 48000);
      const bytes = await (await fetch(media.src)).arrayBuffer();
      const buffer = await audio.decodeAudioData(bytes.slice(0));
      const samples = buffer.getChannelData(0);
      const peak = (lo: number, hi: number) => samples.subarray(lo, hi).reduce((n, v) => Math.max(n, Math.abs(v)), 0);
      return { bytes: bytes.byteLength, frames: buffer.length, silence: peak(0, 4800), tone: peak(12000, 24000), duration: media.duration };
    });
    lengths.set(format, decoded.bytes);
    expect(decoded.frames).toBe(57600);
    expect(Math.abs(decoded.duration - 1.2)).toBeLessThanOrEqual(format === 'opus' ? 0.02 : 1 / rate);
    expect(decoded.silence).toBeLessThan(0.005);
    expect(decoded.tone).toBeGreaterThan(0.3);
    const canvas = viewer.locator('canvas');
    await expect(canvas).toHaveAttribute('data-frame', '0');
    await play.click();
    await expect(canvas).toHaveAttribute('data-frame', /^[4-9]$/);
    await viewer.getByRole('button', { name: 'Pause animation' }).click();
    await expect(canvas).toHaveAttribute('data-audio', 'paused');
    const pose = await viewer.locator('canvas').evaluate((stage: HTMLCanvasElement) => ({
      frame: Number(stage.dataset.frame),
      time: document.querySelector('audio')!.currentTime,
      pixel: Array.from(stage.getContext('2d')!.getImageData(10, 10, 1, 1).data),
    }));
    expect(Math.abs(pose.frame - Math.floor(pose.time * 10))).toBeLessThanOrEqual(1);
    expect(pose.pixel).toEqual([0, 255, 0, 255]);
    await viewer.close();
  }
  expect(lengths.get('opus')!).toBeLessThan(lengths.get('wav')! / 2);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
});

async function setup(page: Page, live = false) {
  const p = newProject();
  p.width = 100;
  p.height = 80;
  p.duration = 3;
  p.fps = 10;
  p.layers[0].keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 10,
      y: 10,
      width: 30,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  if (live) {
    p.duration = 6;
    p.layers[0].keys.push({ frame: 4, shapes: [{ ...p.layers[0].keys[0].shapes[0], x: 60 }] });
    p.layers = prepareCreateLiveMotionSpans(p, [
      { layerId: p.layers[0].id, span: { id: 'move', start: 0, end: 4, ease: 'linear' } },
    ]).layers;
    p.frameScripts = [{ frame: 2, source: 'globalThis.unexpectedFrameScript = true' }];
  }
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const original = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Export…', exact: true }).click();
    return page.getByRole('dialog', { name: 'Export', exact: true });
  };
  return { p, original, open };
}

test('Export keeps keyboard focus inside and returns it to the invoking command', async ({ page }) => {
  const f = await setup(page);
  const file = page.getByRole('button', { name: 'File', exact: true });
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('F10');
  const open = async () => {
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Export…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
  };
  await open();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  const format = dialog.getByLabel('Export format', { exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(format).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close export', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await format.selectOption('ffmpeg');
  const bundle = dialog.getByRole('button', { name: 'Export FFmpeg input bundle…', exact: true });
  await bundle.press('Enter');
  const details = page.getByRole('dialog', { name: 'Export FFmpeg input bundle', exact: true });
  await expect(details).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const closeBundle = details.getByRole('button', { name: 'Close FFmpeg bundle', exact: true });
  const exportBundle = details.getByRole('button', { name: 'Export FFmpeg input ZIP', exact: true });
  await expect(closeBundle).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(exportBundle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeBundle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(exportBundle).toBeFocused();
  const [zip] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect((await readFile((await zip.path())!)).readUInt32LE(0)).toBe(0x04034b50);
  await expect(exportBundle).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bundle).toBeFocused();
  await expect(format).toHaveValue('ffmpeg');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(file).toBeFocused();
  await open();
  await expect(format).toBeFocused();
  await format.selectOption('html');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export HTML animation…', exact: true }).press('Enter'),
  ]);
  expect(await download.failure()).toBeNull();
  await expect(dialog).toHaveCount(0);
  await expect(file).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

test('desktop HTML chooser cancellation keeps keyboard focus and permits an exact retry', async ({ page }) => {
  const token = process.env.SPLASH_TEST_LICENSE;
  test.skip(!token, 'Run with the isolated licensing test fixture.');
  await page.addInitScript((license) => {
    const exports: { project: string; files: { path: string; text: string }[] }[] = [];
    const pending: ((path: string | null) => void)[] = [];
    Object.assign(window, { htmlExports: exports, completeHtmlExport: (path: string | null) => pending.shift()?.(path) });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      invoke: (command: string, args?: { request: { op: string; project: string; files: typeof exports[number]['files'] } }) => {
        if (command === 'read_license') return Promise.resolve(license);
        if (command !== 'project_operation' || args?.request.op !== 'export-web-folder') return Promise.resolve(null);
        const { project, files } = args.request;
        exports.push({ project, files });
        return new Promise<string | null>(resolve => pending.push(resolve));
      },
    });
  }, token);
  const f = await setup(page, true);
  const file = page.getByRole('button', { name: 'File', exact: true });
  const action = (scope: Page | ReturnType<Page['getByRole']>) =>
    scope.getByRole('button', { name: 'Export HTML animation…', exact: true });
  const requests = () => page.evaluate(() => Reflect.get(window, 'htmlExports') as { project: string; files: { path: string; text: string }[] }[]);
  const complete = (path: string | null) => page.evaluate(path => Reflect.get(window, 'completeHtmlExport')(path), path);
  await expect(page.getByRole('button', { name: '↗ Export HTML', exact: true })).toBeEnabled();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('F10');
  async function quickExport() {
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await expect(action(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Export', exact: true });
    await expect(settings.getByLabel('Export format')).toHaveValue('html');
    return settings;
  }
  const quick = await quickExport();
  expect(await requests()).toHaveLength(0);
  await action(quick).press('Enter');
  await expect.poll(async () => (await requests()).length).toBe(1);
  await complete(null);
  await expect(action(quick)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(file).toBeFocused();
  await action(await quickExport()).press('Enter');
  await expect.poll(async () => (await requests()).length).toBe(2);
  await complete('/export/Untitled-web');
  await expect(page.locator('.status-message')).toContainText('Exported web folder');
  await expect(file).toBeFocused();

  const dialog = await f.open();
  await dialog.getByLabel('Export format').selectOption('html');
  await action(dialog).press('Enter');
  await expect.poll(async () => (await requests()).length).toBe(3);
  await complete(null);
  await expect(action(dialog)).toBeFocused();
  await expect(dialog.getByLabel('Export format')).toHaveValue('html');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await requests()).length).toBe(4);
  await complete('/export/Untitled-web');
  await expect(dialog).toHaveCount(0);
  await expect(file).toBeFocused();

  const [first, ...retries] = await requests();
  expect(first.project).toBe('Untitled-web');
  const data = first.files.find(file => file.path === 'data/animation.js')?.text;
  expect(data).toContain('#ff0000');
  expect(data).not.toContain('unexpectedFrameScript');
  for (const request of retries) expect(request).toEqual(first);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

for (const entry of ['shortcut', 'dialog'] as const) {
  test(`live tween plays in HTML downloaded from the ${entry}`, async ({ page, context }) => {
    const f = await setup(page, true);
    const dialog = entry === 'dialog' ? await f.open() : await openHtmlShortcut(page);
    await dialog.getByLabel('Export format', { exact: true }).selectOption('html');
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export HTML animation…', exact: true }).click();
    const files = await readWebDownload(await downloading);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);

    const player = await context.newPage();
    const errors: string[] = [];
    player.on('pageerror', cause => errors.push(String(cause)));
    await player.addInitScript(() => {
      const frames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => frames.push(callback);
      Object.assign(window, { exportFrames: frames });
    });
    await openWebExport(player, files, true);
    await player.waitForFunction(() =>
      (window as unknown as {exportFrames: FrameRequestCallback[]}).exportFrames.length > 0);
    const pixel = (ms: number, x: number) => player.evaluate(({ ms, x }) => {
      const host = window as unknown as {exportFrames: FrameRequestCallback[]; unexpectedFrameScript?: boolean};
      host.exportFrames.shift()!(ms);
      return {
        rgba: Array.from(document.querySelector('canvas')!.getContext('2d')!.getImageData(x, 15, 1, 1).data),
        scriptRan: host.unexpectedFrameScript ?? false,
      };
    }, { ms, x });
    expect(await pixel(0, 15)).toEqual({ rgba: [255, 0, 0, 255], scriptRan: false });
    expect(await pixel(200, 50)).toEqual({ rgba: [255, 0, 0, 255], scriptRan: false });
    expect(await pixel(400, 70)).toEqual({ rgba: [255, 0, 0, 255], scriptRan: false });
    expect(await pixel(600, 15)).toEqual({ rgba: [255, 0, 0, 255], scriptRan: false });
    expect(errors).toEqual([]);
  });
}

test('File is compact and Export groups every existing format with retained settings and no document changes', async ({
  page,
}) => {
  const f = await setup(page);
  // The compact header must leave all menus and the shortcut usable at the
  // smallest supported app width, without consuming a separate branding row.
  for (const width of [960, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const nav = page.getByRole('navigation', { name: 'Application menu', exact: true });
    const bar = (await nav.boundingBox())!;
    const brand = (await nav
      .getByRole('img', { name: 'Splash Animator', exact: true })
      .boundingBox())!;
    const file = (await nav.getByRole('button', { name: 'File', exact: true }).boundingBox())!;
    const help = (await nav.getByRole('button', { name: 'Help', exact: true }).boundingBox())!;
    const shortcut = nav.getByRole('button', { name: '↗ Export HTML', exact: true });
    const publish = (await shortcut.boundingBox())!;
    expect(bar.y).toBe(0);
    expect(bar.height).toBe(30);
    expect(brand.x + brand.width).toBeLessThanOrEqual(file.x);
    expect(brand.height).toBeLessThanOrEqual(24);
    expect(help.x + help.width).toBeLessThan(publish.x);
    expect(publish.x + publish.width).toBeCloseTo(width - 10, 0);
    expect(publish.height).toBeLessThanOrEqual(24);
    expect((await page.locator('.document-tabs').boundingBox())!.y).toBe(30);
    await expect(shortcut).toBeInViewport();
    await nav.screenshot({ path: test.info().outputPath(`compact-header-${width}.png`) });
  }
  const downloading = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  expect((await readWebDownload(await downloading)).get('index.html')?.toString()).toContain('<canvas');
  // Choose PNG before reopening the general export window.
  await (await f.open()).getByLabel('Export format').selectOption('png');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export…', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Export HTML animation…', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Export current frame PNG…', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('PNG export scale', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true }),
    format = dialog.getByLabel('Export format', { exact: true });
  await expect(format).toHaveValue('png');
  await dialog.getByLabel('PNG export scale', { exact: true }).selectOption('2');
  const formats = [
    ['gif', 'Export GIF animation…'],
    ['html', 'Export HTML animation…'],
    ['webm', 'Export WebM video…'],
    ['mp4', 'Export silent MP4 video…'],
    ['ivf', 'Export IVF video…'],
    ['ffmpeg', 'Export FFmpeg input bundle…'],
    ['png', 'Export PNG sprite sheet ZIP…'],
  ] as const;
  for (const [value, command] of formats) {
    await format.selectOption(value);
    await expect(dialog.getByRole('button', { name: command, exact: true })).toBeVisible();
  }
  await expect(dialog.getByLabel('PNG export scale', { exact: true })).toHaveValue('2');
  await format.selectOption('gif');
  await dialog.getByLabel('Loop GIF forever', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const reopened = await f.open();
  await expect(reopened.getByLabel('Export format', { exact: true })).toHaveValue('gif');
  await expect(reopened.getByLabel('Loop GIF forever', { exact: true })).not.toBeChecked();
  await reopened.getByLabel('Export format', { exact: true }).selectOption('all');
  for (const [, command] of formats)
    await expect(reopened.getByRole('button', { name: command, exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: 'Close export', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

for (const kind of ['png', 'gif', 'html'] as const)
  test(`configured ${kind} export downloads actual output and closes after success`, async ({
    page,
  }) => {
    const f = await setup(page),
      dialog = await f.open();
    await dialog.getByLabel('Export format', { exact: true }).selectOption(kind);
    if (kind === 'png') {
      await dialog.getByLabel('PNG export scale', { exact: true }).selectOption('2');
      await dialog.getByLabel('Transparent PNG background', { exact: true }).check();
    }
    const pending = page.waitForEvent('download');
    await dialog
      .getByRole('button', {
        name:
          kind === 'png'
            ? 'Export current frame PNG…'
            : kind === 'gif'
              ? 'Export GIF animation…'
              : 'Export HTML animation…',
        exact: true,
      })
      .click();
    const download = await pending,
      bytes = await readFile((await download.path())!);
    await expect(dialog).toHaveCount(0);
    if (kind === 'png') {
      expect(bytes.readUInt32BE(16)).toBe(200);
      expect(bytes.readUInt32BE(20)).toBe(160);
      const pixels = await page.evaluate(async (data) => {
        const image = await createImageBitmap(
            await (await fetch('data:image/png;base64,' + data)).blob(),
          ),
          c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        return [
          Array.from(ctx.getImageData(30, 30, 1, 1).data),
          Array.from(ctx.getImageData(190, 150, 1, 1).data),
        ];
      }, bytes.toString('base64'));
      expect(pixels).toEqual([
        [255, 0, 0, 255],
        [0, 0, 0, 0],
      ]);
    } else if (kind === 'gif') {
      expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
      expect(bytes.readUInt16LE(6)).toBe(100);
      expect(bytes.readUInt16LE(8)).toBe(80);
    } else expect(readWebExport(bytes).get('index.html')?.toString()).toContain('<canvas');
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
  });

test('FFmpeg details return to the central export window without losing options', async ({
  page,
}) => {
  const f = await setup(page),
    dialog = await f.open();
  await dialog.getByLabel('Export format', { exact: true }).selectOption('ffmpeg');
  await dialog.getByLabel('PNG export scale', { exact: true }).selectOption('2');
  await dialog.getByRole('button', { name: 'Export FFmpeg input bundle…', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Export FFmpeg input bundle', exact: true });
  await expect(details).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await details.getByRole('button', { name: 'Close FFmpeg bundle', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Export format', { exact: true })).toHaveValue('ffmpeg');
  await expect(dialog.getByLabel('PNG export scale', { exact: true })).toHaveValue('2');
  await dialog.getByRole('button', { name: 'Close export', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

test('export frame controls validate bounds and drive the selected PNG range', async ({ page }) => {
  const f = await setup(page),
    dialog = await f.open();
  await dialog.getByLabel('Export start frame', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Use frame range', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('whole-number frame range');
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByLabel('Export start frame', { exact: true }).fill('2');
  await dialog.getByLabel('Export end frame', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Use frame range', exact: true }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export selected PNG range ZIP…', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  expect(bytes.readUInt16LE(bytes.length - 12)).toBe(3);
  expect(bytes.includes(Buffer.from('frame-000002.png'))).toBe(true);
  expect(bytes.includes(Buffer.from('frame-000003.png'))).toBe(true);
  expect(bytes.includes(Buffer.from('frame-000001.png'))).toBe(false);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.original);
});

test('export window remains usable on a smaller viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  const f = await setup(page),
    dialog = await f.open();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  await page.screenshot({ path: 'test-results/export-window.png' });
  await dialog.getByRole('button', { name: 'Close export', exact: true }).scrollIntoViewIfNeeded();
  await dialog.getByRole('button', { name: 'Close export', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
