import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { encodeEmbeddedFont } from '../../packages/document/src/embedded-font';
import type { SymbolDefinition, Vector } from '../../packages/document/src';

type CaptureAPI = typeof import('../desktop-capture-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, lib: {
      entry: 'tests/desktop-capture-fixture.ts', formats: ['iife'], name: 'DesktopCapture',
    } },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(entry => 'output' in entry ? entry.output : [])
    .filter(entry => entry.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one desktop capture fixture.');
  code = chunks[0].code;
});

for (const mode of ['missing bitmap', 'missing font', 'unrelated damaged bitmap', 'loaded font'] as const) {
  test(`desktop and browser PNG capture agree on ${mode}`, async ({ page }) => {
    const font = mode === 'loaded font' && process.platform === 'win32'
      ? await readFile(`${process.env.WINDIR ?? 'C:/Windows'}/Fonts/trebuc.ttf`).catch(() => undefined)
      : undefined;
    test.skip(mode === 'loaded font' && !font, 'Requires a local embeddable Windows TrueType fixture.');
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async ({ mode, font }) => {
      const api = (window as unknown as { DesktopCapture: CaptureAPI }).DesktopCapture;
      const project = api.newProject();
      project.width = 112;
      project.height = 48;
      project.duration = 1;
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = imageCanvas.height = 8;
      const imageContext = imageCanvas.getContext('2d')!;
      imageContext.fillStyle = '#ff0000';
      imageContext.fillRect(0, 0, 8, 8);
      const dataUrl = imageCanvas.toDataURL();
      project.assets.push({
        id: 'image', path: 'assets/bitmaps/image.json',
        bitmap: { name: 'Red', width: 8, height: 8, dataUrl: mode === 'missing bitmap' ? undefined : dataUrl },
      });
      const art: Vector = {
        id: 'paint', kind: 'rectangle', x: 0, y: 0, width: 24, height: 24, rotation: 0,
        fill: '#ffffff', stroke: '#000000', strokeWidth: 0, points: [],
        bitmap: { assetId: 'image', x: 0, y: 0, width: 24, height: 24 },
      };
      const bitmap = { id: 'bitmap-symbol', name: 'Bitmap', width: 24, height: 24, shapes: [art] };
      const parent = { id: 'nested', name: 'Nested', width: 24, height: 24, shapes: [api.symbolInstance(bitmap, 0, 0)] };
      project.symbols = [bitmap, parent];
      project.layers[0].keys[0].shapes = [api.symbolInstance(parent, 0, 0)];
      if (mode === 'unrelated damaged bitmap')
        project.assets.push({
          id: 'unused', path: 'assets/bitmaps/unused.json',
          bitmap: { name: 'Damaged', width: 8, height: 8, dataUrl: dataUrl.slice(0, 66) },
        });
      if (mode === 'missing font' || mode === 'loaded font') {
        const family = 'Splash Font Desktop Capture Fixture';
        project.assets.push({
          id: 'font', path: 'assets/fonts/font.json',
          font: { name: 'Fixture', family, bytes: font?.bytes ?? 32, dataUrl: font?.dataUrl },
        });
        project.layers[0].keys[0].shapes.push({
          ...art, bitmap: undefined, id: 'words', kind: 'text', x: 30, width: 78, height: 36, fill: '#0000ff',
          text: { content: 'AV O', font: 'sans-serif', size: 22, bold: false, italic: false, align: 'left',
            runs: [{ start: 0, end: 4, style: { font: family } }] },
        });
      }
      const original = JSON.stringify(project);
      const beforeFonts = document.fonts.size;
      const signal = new AbortController().signal;
      const read = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
        try {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
        } finally { bitmap.close(); }
      };
      let delivered = 0, desktop: number[] | undefined, browser: number[] | undefined;
      let desktopError = '', browserError = '';
      try { browser = await read(await api.exportPNGFrame(project, 0, signal, true)); }
      catch (error) { browserError = String(error); }
      try {
        await api.captureDesktopPNGSequence(project, { start: 0, end: 0 }, 1, true, signal, () => {}, async (_f, png) => {
          delivered++;
          desktop = await read(png);
        });
      } catch (error) { desktopError = String(error); }
      return { delivered, desktopError, browserError, equal: JSON.stringify(desktop) === JSON.stringify(browser),
        red: desktop?.slice((4 * project.width + 4) * 4, (4 * project.width + 4) * 4 + 4),
        clear: desktop?.slice(-4), bluePixels: desktop?.filter((value, index) => index % 4 === 2 && value > 128).length,
        intact: JSON.stringify(project) === original, fontCleanup: beforeFonts === document.fonts.size };
    }, { mode, font: font && { bytes: font.length, dataUrl: encodeEmbeddedFont(font) } });
    expect(result.intact && result.fontCleanup).toBe(true);
    if (mode.startsWith('missing')) {
      const reason = mode === 'missing bitmap' ? 'a referenced bitmap asset is missing' : 'a referenced embedded font file is missing';
      expect(result.browserError).toContain(reason);
      expect(result.desktopError).toContain(reason);
      expect(result.delivered).toBe(0);
    } else {
      expect(result.browserError).toBe('');
      expect(result.desktopError).toBe('');
      expect(result.delivered).toBe(1);
      expect(result.equal).toBe(true);
      expect(result.red).toEqual([255, 0, 0, 255]);
      expect(result.clear).toEqual([0, 0, 0, 0]);
      if (mode === 'loaded font') expect(result.bluePixels).toBeGreaterThan(40);
    }
  });
}

for (const maskMode of ['none', 'root', 'nested'] as const) {
  test(`desktop and browser selected range preserve nested Button Up clocks with ${maskMode} masking`, async ({ page }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async maskMode => {
      const { newProject, newLayer, symbolInstance, capturePNGSequenceFrames, captureDesktopPNGSequence } =
        (window as unknown as { DesktopCapture: CaptureAPI }).DesktopCapture;
      const project = newProject();
      project.width = 64;
      project.height = 40;
      project.duration = 6;
      project.fps = 29.97;
      const fill = (color: string): Vector => ({
        id: 'paint', kind: 'rectangle', x: 0, y: 0, width: 22, height: 22, rotation: 0,
        fill: color, stroke: '#000000', strokeWidth: 0, points: [],
      });
      const movie: SymbolDefinition = {
        id: 'child-movie', name: 'Child movie', width: 22, height: 22,
        shapes: [fill('#ff0000')], timeline: { duration: 3, keys: [
          { frame: 1, shapes: [fill('#00ff00')] }, { frame: 2, shapes: [fill('#0000ff')] },
        ] },
      };
      const button: SymbolDefinition = {
        id: 'nested-button', name: 'Nested button', width: 22, height: 22,
        shapes: [{ ...symbolInstance(movie, 0, 0), id: 'up-movie', symbolPlayback: { mode: 'movie', firstFrame: 0 } }],
        timeline: { duration: 2, keys: [{ frame: 1, shapes: [fill('#ffff00')] }] },
        buttonStates: { up: 0, over: 1, down: 1, hit: 1 },
      };
      const parent: SymbolDefinition = {
        id: 'parent-movie', name: 'Parent movie', width: 30, height: 30,
        shapes: [{ ...symbolInstance(button, 2, 2), id: 'button-placement' }],
        timeline: { duration: 6, keys: [] },
      };
      project.symbols = [movie, button, parent];
      const placement: Vector = {
        ...symbolInstance(parent, 4, 4), id: 'parent-placement', symbolPlayback: { mode: 'movie', firstFrame: 0 },
        ...(maskMode !== 'none' ? { instanceBlur: 2, instanceTint: { color: '#ff0000', amount: 0.25 } } : {}),
      };
      project.layers[0].keys = [{ frame: 0, shapes: [placement] }, { frame: 3, shapes: [] }, { frame: 4, shapes: [placement] }];
      if (maskMode !== 'none') {
        const mask = newLayer('Mask');
        mask.keys[0].shapes = [{ ...fill('#ffffff'), width: 18, height: 36 }];
        if (maskMode === 'root') {
          project.layers.push(mask);
          project.layerMasks = [{ maskLayerId: mask.id, layerIds: [project.layers[0].id] }];
        } else {
          project.schemaVersion = 60;
          mask.keys[0].shapes[0].width = 14;
          parent.timeline!.layers = [mask];
          parent.timeline!.layerMasks = [{ maskLayerId: mask.id, layerIds: ['@base'] }];
        }
      }
      const source = JSON.stringify(project);
      const browser = new Map<number, Uint8ClampedArray>(), desktop = new Map<number, Uint8ClampedArray>();
      const signal = new AbortController().signal;
      const range = { start: 2, end: 5 };
      const read = async (store: typeof browser, frame: number, blob: Blob) => {
        const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        try {
          ctx.drawImage(bitmap, 0, 0);
          store.set(frame, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        } finally { bitmap.close(); }
      };
      await capturePNGSequenceFrames(project, (frame, blob) => read(browser, frame, blob), signal, range, true);
      await captureDesktopPNGSequence(project, range, 1, true, signal, () => {}, (frame, blob) => read(desktop, frame, blob));
      const at = (data: Uint8ClampedArray, x: number, y: number) => Array.from(data.slice((y * project.width + x) * 4, (y * project.width + x) * 4 + 4));
      const rows = [...browser].map(([frame, reference]) => {
        const actual = desktop.get(frame)!;
        return { frame, same: reference.every((channel, index) => channel === actual[index]),
          browser: at(reference, 12, 12), desktop: at(actual, 12, 12),
          outsideMask: at(actual, 21, 12),
          hasSoftEdge: [4, 5, 6].some(x => { const alpha = at(actual, x, 12)[3]; return alpha > 0 && alpha < 255; }) };
      });
      return { rows, sameSource: JSON.stringify(project) === source };
    }, maskMode);
    expect(result.sameSource).toBe(true);
    expect(result.rows.map(row => row.frame)).toEqual([2, 3, 4, 5]);
    expect(result.rows[1].browser).toEqual([0, 0, 0, 0]);
    expect(result.rows[0].browser[2]).toBeGreaterThan(140);
    expect(result.rows[2].browser[0]).toBeGreaterThan(200);
    expect(result.rows[3].browser[1]).toBeGreaterThan(140);
    if (maskMode !== 'none') {
      expect(result.rows[0].desktop[0]).toBeGreaterThan(30);
      expect(result.rows[0].hasSoftEdge).toBe(true);
    }
    if (maskMode === 'root') for (const row of result.rows) expect(row.outsideMask[3]).toBe(0);
    expect(result.rows.filter(row => !row.same)).toEqual([]);
  });
}

test('desktop captures sparse motion as exact browser PNG poses and stops on cancellation', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: code });
  const result = await page.evaluate(async () => {
    const { livePresentationFixture, captureDesktopPNGSequence, exportPNGFrame } =
      (window as unknown as { DesktopCapture: CaptureAPI }).DesktopCapture;
    const project = livePresentationFixture('button');
    const original = JSON.stringify(project);
    const range = { start: 1, end: 5 };
    const controller = new AbortController();
    const at = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
      try {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      } finally { bitmap.close(); }
    };
    const rows: { frame: number; same: boolean; red: number[] }[] = [];
    await captureDesktopPNGSequence(project, range, 1, true, controller.signal, () => {}, async (frame, png) => {
      const actual = await at(png), reference = await at(await exportPNGFrame(project, frame, controller.signal, true));
      const index = (10 * project.width + Math.min(frame, 4) * 20 + 8) * 4;
      rows.push({ frame, same: reference.every((channel, i) => channel === actual[i]), red: Array.from(actual.slice(index, index + 4)) });
    });
    const cancelled = new AbortController(), delivered: number[] = [];
    let failure = '';
    try {
      await captureDesktopPNGSequence(project, range, 1, true, cancelled.signal, () => {}, async frame => {
        delivered.push(frame);
        cancelled.abort(Error('Cancel after first prepared frame'));
      });
    } catch (error) { failure = String(error); }
    return { rows, delivered, failure, intact: JSON.stringify(project) === original };
  });
  expect(result.rows.map(row => row.frame)).toEqual([1, 2, 3, 4, 5]);
  expect(result.rows.every(row => row.same && row.red.join(',') === '255,0,0,255')).toBe(true);
  expect(result.delivered).toEqual([1]);
  expect(result.failure).toContain('Cancel after first prepared frame');
  expect(result.intact).toBe(true);
});
