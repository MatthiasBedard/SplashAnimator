import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { exportHTML } from '../../packages/export-web/src';
import { encodeEmbeddedFont } from '../../packages/document/src/embedded-font';

async function setup(page: Page, rich = false, reflected = false, mixedSize = false,
  frameScripts?: Project['frameScripts'], prepare?: (project: Project, text: Vector) => void) {
  const issues: string[] = [];
  page.on('pageerror', (e) => issues.push(e.stack ?? String(e)));
  const p = newProject();
  if (frameScripts) p.frameScripts = frameScripts;
  p.width = 600;
  p.height = 400;
  p.layers[0].drawingMode = 'object';
  const text: Vector = {
    id: 'words',
    kind: 'text',
    x: reflected ? 350 : 100,
    y: 100,
    width: 240,
    height: 38.4,
    rotation: 0,
    fill: '#e00000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    text: {
      content: 'Hello world',
      font: 'monospace',
      size: 32,
      bold: false,
      italic: false,
      align: 'left',
      ...(rich
        ? {
            runs: [
              {
                start: 6,
                end: 11,
                style: { italic: true, color: '#0000ff', ...(mixedSize ? { size: 24 } : {}) },
              },
            ],
          }
        : {}),
    },
    ...(reflected ? { transform: [-1, 0.1, 0.2, 1] as [number, number, number, number] } : {}),
  };
  p.layers[0].keys[0].shapes = [
    text,
    {
      id: 'untouched',
      kind: 'rectangle',
      x: 450,
      y: 250,
      width: 40,
      height: 40,
      rotation: 0,
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  p.layers[0].keys.push({ frame: 20, shapes: [{ ...structuredClone(text), id: 'later' }] });
  prepare?.(p, text);
  await page.addInitScript(
    (p) => {
      if (!localStorage.getItem('splash-recovery-v1')) localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    },
    p,
  );
  await page.goto('/');
  await recoverTextFixture(page);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const point = async (x: number, y: number) => {
    const b = (await stage.boundingBox())!;
    return { x: b.x + b.width / 2 + x - 300, y: b.y + b.height / 2 + y - 200 };
  };
  const click = async (x: number, y: number, double = false) => {
    const q = await point(x, y);
    if (double) await page.mouse.dblclick(q.x, q.y);
    else await page.mouse.click(q.x, q.y);
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const editor = page.getByLabel('Edit text on canvas', { exact: true });
  async function done() {
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    expect(issues).toEqual([]);
  }
  return { p, text, stage, point, click, read, editor, done, issues };
}

for (const styled of [false, true])
test(`wrapped mixed-direction text selects and replaces the visible digits (${styled ? 'styled' : 'plain'})`, async ({ page, context }) => {
  const first = 'prefix prefix prefix', second = 'abc אבג 123';
  const content = first + ' ' + second;
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    Object.assign(shape, { width: 400, height: 76.8 });
    Object.assign(shape.text!, { content, wrapWidth: 400, direction: 'ltr' });
    if (styled) {
      const start = content.indexOf('אבג');
      shape.text!.runs = [{ start, end: start + 3, style: { color: '#000080' } }];
    }
  });
  const digits = await page.evaluate((value) => {
    const line = document.createElement('span');
    line.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;font:32px monospace;direction:ltr';
    line.textContent = value;
    document.body.append(line);
    const origin = line.getBoundingClientRect().left;
    const start = value.indexOf('123');
    const positions = [0, 1].map(index => {
      const range = document.createRange();
      range.setStart(line.firstChild!, start + index);
      range.setEnd(line.firstChild!, start + index + 1);
      const rect = range.getBoundingClientRect();
      return [rect.left - origin, rect.width];
    });
    line.remove();
    return positions;
  }, second);
  expect(digits[0][0]).toBeLessThan(100); // The numbers are visually before the Hebrew run.
  await f.click(120, 110, true);
  await expect(f.editor).toBeFocused();
  const a = await f.point(100 + digits[0][0] + digits[0][1] * 0.2, 151);
  const b = await f.point(100 + digits[1][0] + digits[1][1] * 0.8, 151);
  const selection = () => f.editor.evaluate((node: HTMLTextAreaElement) =>
    [node.selectionStart, node.selectionEnd, node.value.slice(node.selectionStart, node.selectionEnd)]);
  await page.mouse.click(b.x, b.y);
  const index = content.indexOf('123');
  await expect.poll(selection).toEqual([index + 2, index + 2, '']);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(selection).toEqual([index, index + 2, '12']);
  await page.keyboard.insertText('9');
  await f.done();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].text!.content)
    .toBe(first + ' abc אבג 93');
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  if (styled) {
    const area = { x: 100, y: 130, width: 395, height: 50 };
    const stageInk = await f.stage.evaluate((node: HTMLCanvasElement, box) =>
      Array.from(node.getContext('2d')!.getImageData(
        Math.round(node.width / 2 - 300 + box.x), Math.round(node.height / 2 - 200 + box.y),
        box.width, box.height,
      ).data), area);
    expect(stageInk.some((value, i) => i % 4 === 2 && value === 128)).toBe(true);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
    const out = await context.newPage();
    await openWebExport(out, await readWebDownload(await download));
    const standalone = () => out.locator('canvas').evaluate((node: HTMLCanvasElement, box) =>
      Array.from(node.getContext('2d')!.getImageData(box.x, box.y, box.width, box.height).data), area);
    await expect.poll(async () => (await standalone()).every((value, index) => value === stageInk[index])).toBe(true);
    await out.close();
  }
});

test('mixed-size punctuation preserves signed ink and stable line boxes in editing and output', async ({ page, context }) => {
  const content = '"A\n_\nG';
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    Object.assign(shape, { width: 220, height: 192 });
    Object.assign(shape.text!, {
      content, align: 'center', wrapWidth: 220, lineHeight: 1,
      runs: [
        { start: 0, end: 1, style: { bold: true, size: 60, color: '#0000ff' } },
        { start: 3, end: 4, style: { italic: true, size: 44, color: '#008000' } },
      ],
    });
  });
  const crop = { x: 100, y: 100, width: 220, height: 185 };
  const reference = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = '32px monospace';
    const base = ctx.measureText('Mg');
    const lines = [
      [{ text: '"', font: 'bold 60px monospace', color: '#0000ff' }, { text: 'A', font: '32px monospace', color: '#e00000' }],
      [{ text: '_', font: 'italic 44px monospace', color: '#008000' }],
      [{ text: 'G', font: '32px monospace', color: '#e00000' }],
    ];
    let top = 0;
    const ink = [];
    for (const line of lines) {
      const spans = line.map(run => {
        ctx.font = run.font;
        return { ...run, metrics: ctx.measureText(run.text) };
      });
      const ascent = Math.max(base.fontBoundingBoxAscent, ...spans.flatMap(({ metrics }) =>
        [metrics.fontBoundingBoxAscent, metrics.actualBoundingBoxAscent]));
      const descent = Math.max(base.fontBoundingBoxDescent, ...spans.flatMap(({ metrics }) =>
        [metrics.fontBoundingBoxDescent, metrics.actualBoundingBoxDescent]));
      let x = (width - spans.reduce((sum, span) => sum + span.metrics.width, 0)) / 2;
      for (const span of spans) {
        ctx.font = span.font;
        ctx.fillStyle = span.color;
        ctx.fillText(span.text, x, top + ascent);
        x += span.metrics.width;
        ink.push([span.metrics.actualBoundingBoxAscent, span.metrics.actualBoundingBoxDescent]);
      }
      top += ascent + descent;
    }
    return { pixels: Array.from(ctx.getImageData(0, 0, width, height).data), height: top, ink };
  }, crop);
  expect(reference.ink[0][1]).toBeLessThan(0);
  expect(reference.ink[2][0]).toBeLessThan(0);
  const stagePixels = () => f.stage.evaluate((node: HTMLCanvasElement, box) => {
    const x = Math.round(node.width / 2 - 300 + box.x);
    const y = Math.round(node.height / 2 - 200 + box.y);
    return Array.from(node.getContext('2d')!.getImageData(x, y, box.width, box.height).data);
  }, crop);
  const sameInk = (actual: number[]) => actual.every((value, index) => value === reference.pixels[index]);
  await expect.poll(async () => sameInk(await stagePixels())).toBe(true);

  await f.click(155, 125, true);
  await expect(f.editor).toBeFocused();
  await f.editor.press('Control+End');
  await page.keyboard.insertText('!');
  await f.done();
  const changed = (await f.read()).layers[0].keys[0].shapes[0];
  expect(changed.text!.content).toBe(content + '!');
  expect(changed.text!.runs).toEqual(f.text.text!.runs);
  expect(changed.height).toBe(reference.height);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
  const out = await context.newPage();
  await openWebExport(out, await readWebDownload(await download));
  const outputPixels = () => out.locator('canvas').evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(box.x, box.y, box.width, box.height).data), crop);
  await expect.poll(async () => sameInk(await outputPixels())).toBe(true);

  await f.stage.press('Control+Enter');
  const movie = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  await expect(movie).toBeVisible();
  await expect.poll(async () => {
    const png = (await movie.screenshot()).toString('base64');
    return out.evaluate(async ({ png, box, expected }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, 600, 400);
      const actual = ctx.getImageData(box.x, box.y, box.width, box.height).data;
      let common = 0, total = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const a = Math.min(actual[i], actual[i + 1], actual[i + 2]) < 120;
        const b = Math.min(expected[i], expected[i + 1], expected[i + 2]) < 120;
        if (a && b) common++;
        if (a || b) total++;
      }
      return common / total;
    }, { png, box: crop, expected: reference.pixels });
  }).toBeGreaterThan(0.95);
  expect(f.issues).toEqual([]);
  await out.close();
});

for (const script of ['Arabic', 'Latin'] as const)
test(`${script} color ranges preserve native joined ink through editing, Test Movie and HTML`, async ({ page, context }) => {
  const rtl = script === 'Arabic';
  const content = rtl ? 'سلام' : 'AV';
  const size = rtl ? 60 : 72;
  const split = rtl ? 2 : 1;
  const wrapWidth = rtl ? 91 : 93;
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    Object.assign(shape, { width: 160, height: 80 });
    Object.assign(shape.text!, {
      content, font: 'Arial', size, direction: rtl ? 'rtl' : 'ltr', lineHeight: 1, wrapWidth,
      runs: [{ start: split, end: content.length, style: { color: '#0000ff' } }],
    });
  });
  const crop = { x: 100, y: 100, width: 160, height: 80 };
  const reference = await page.evaluate(({ content, crop, rtl, size, split }) => {
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.textAlign = 'left';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.font = `${size}px Arial`;
    const native = ctx.measureText(content);
    ctx.fillStyle = '#000';
    ctx.fillText(content, 0, Math.max(native.fontBoundingBoxAscent, native.actualBoundingBoxAscent));
    const pixels = Array.from(ctx.getImageData(0, 0, crop.width, crop.height).data);
    const nativeText = document.createElement('bdi');
    nativeText.dir = ctx.direction;
    nativeText.style.cssText = `position:fixed;display:inline-block;font:${size}px Arial;white-space:pre`;
    nativeText.textContent = content;
    document.body.append(nativeText);
    const box = nativeText.getBoundingClientRect();
    const range = new Range();
    range.setStart(nativeText.firstChild!, split);
    range.collapse(true);
    const boundary = (range.getBoundingClientRect().left - box.left) / box.width;
    nativeText.remove();
    const colors = ctx.createLinearGradient(0, 0, native.width, 0);
    const left = rtl ? '#0000ff' : '#e00000';
    const right = rtl ? '#e00000' : '#0000ff';
    colors.addColorStop(0, left);
    colors.addColorStop(boundary, left);
    colors.addColorStop(boundary, right);
    colors.addColorStop(1, right);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.fillStyle = colors;
    ctx.fillText(content, 0, Math.max(native.fontBoundingBoxAscent, native.actualBoundingBoxAscent));
    return {
      pixels,
      colored: Array.from(ctx.getImageData(0, 0, crop.width, crop.height).data),
      boundary: boundary * native.width,
      width: native.width,
      separate: ctx.measureText(content.slice(0, split)).width + ctx.measureText(content.slice(split)).width,
    };
  }, { content, crop, rtl, size, split });
  expect(reference.width).toBeLessThan(wrapWidth);
  expect(reference.separate).toBeGreaterThan(wrapWidth);
  const stagePixels = () => f.stage.evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 300 + box.x), Math.round(node.height / 2 - 200 + box.y),
      box.width, box.height,
    ).data), crop);
  const sameInk = (pixels: number[]) => {
    // Blue and red both have a zero green channel, so green measures the
    // entire silhouette even where the color changes in a joined glyph.
    return pixels.every((value, index) => index % 4 !== 1 ||
      (value < 120) === (reference.pixels[index] < 120));
  };
  await expect.poll(async () => sameInk(await stagePixels())).toBe(true);
  const pixels = await stagePixels();
  expect(pixels.every((value, index) => Math.abs(value - reference.colored[index]) <= 1)).toBe(true);
  expect(pixels.some((value, index) => index % 4 === 0 && value === 224 && pixels[index + 2] === 0)).toBe(true);
  expect(pixels.some((value, index) => index % 4 === 0 && value === 0 && pixels[index + 2] === 255)).toBe(true);

  await f.click(155, 130, true);
  await expect(f.editor).toBeFocused();
  await f.click(crop.x + reference.boundary, crop.y + 30);
  expect(await f.editor.evaluate((node: HTMLTextAreaElement) =>
    [node.selectionStart, node.selectionEnd])).toEqual([split, split]);
  await f.click(crop.x + (rtl ? reference.width - 1 : 1), crop.y + 30);
  await f.editor.press(rtl ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
  const caret = await f.editor.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]);
  expect(caret).toEqual([0, 1]);
  const replacement = rtl ? 'م' : 'W';
  await page.keyboard.insertText(replacement);
  await f.done();
  const edited = (await f.read()).layers[0].keys[0].shapes[0].text!;
  expect(edited.content).toBe(replacement + content.slice(1));
  expect(edited.runs).toEqual(f.text.text!.runs);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
  const out = await context.newPage();
  await openWebExport(out, await readWebDownload(await download));
  const output = () => out.locator('canvas').evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(box.x, box.y, box.width, box.height).data), crop);
  await expect.poll(async () => {
    const exported = await output();
    return sameInk(exported) && exported.every((value, index) => Math.abs(value - pixels[index]) <= 1);
  }).toBe(true);

  await f.stage.press('Control+Enter');
  const movie = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  await expect(movie).toBeVisible();
  await expect.poll(async () => {
    const png = (await movie.screenshot()).toString('base64');
    return out.evaluate(async ({ png, crop, expected, colored, boundary, rtl }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, 600, 400);
      const actual = ctx.getImageData(crop.x, crop.y, crop.width, crop.height).data;
      let common = 0, total = 0, nativeBlue = 0, movieBlue = 0;
      for (let i = 1; i < actual.length; i += 4) {
        const a = actual[i] < 120, b = expected[i] < 120;
        if (a && b) common++;
        if (a || b) total++;
        const x = ((i - 1) / 4) % crop.width;
        const sample = !rtl || (x > boundary - 6 && x < boundary - 2);
        if (sample && colored[i] < 40 && colored[i + 1] > 220) {
          nativeBlue++;
          if (actual[i + 1] > actual[i - 1] + 80) movieBlue++;
        }
      }
      return common / total > 0.95 && nativeBlue > 15 && movieBlue / nativeBlue > 0.9;
    }, { png, crop, expected: reference.pixels, colored: reference.colored, boundary: reference.boundary, rtl });
  }).toBe(true);
  expect(f.issues).toEqual([]);
  await out.close();
});

test('Indic fallback preserves conjuncts during mixed-style wrapping, editing and output', async ({ page, context }) => {
  const content = 'क्षितिज';
  const conjunct = 'क्षि';
  const font = 'Missing Splash Indic Fixture, Mangal, sans-serif';
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    Object.assign(shape, { width: 83, height: 160 });
    Object.assign(shape.text!, {
      content, font, size: 48, wrapWidth: 83, lineHeight: 1,
      runs: [{ start: 0, end: conjunct.length, style: { size: 58, color: '#0000ff' } }],
    });
  });
  const box = { x: 100, y: 100, width: 105, height: 145 };
  const reference = await page.evaluate(({ content, conjunct, box }) => {
    const node = document.createElement('canvas');
    node.width = box.width;
    node.height = box.height;
    const ctx = node.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, node.width, node.height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = 'ltr';
    ctx.font = '48px Mangal, sans-serif';
    const base = ctx.measureText('Mg');
    const suffix = ctx.measureText(content.slice(conjunct.length));
    const second = [...new Intl.Segmenter('hi', { granularity: 'grapheme' })
      .segment(content.slice(conjunct.length))][0].segment;
    const secondWidth = ctx.measureText(second).width;
    ctx.font = '58px Mangal, sans-serif';
    const first = ctx.measureText(conjunct);
    const ascent = Math.max(base.fontBoundingBoxAscent, first.fontBoundingBoxAscent, first.actualBoundingBoxAscent);
    const descent = Math.max(base.fontBoundingBoxDescent, first.fontBoundingBoxDescent, first.actualBoundingBoxDescent);
    ctx.fillStyle = '#0000ff';
    ctx.fillText(conjunct, 0, ascent);
    ctx.font = '48px Mangal, sans-serif';
    ctx.fillStyle = '#e00000';
    ctx.fillText(content.slice(conjunct.length), 0, ascent + descent +
      Math.max(base.fontBoundingBoxAscent, suffix.actualBoundingBoxAscent));
    return {
      pixels: Array.from(ctx.getImageData(0, 0, node.width, node.height).data),
      firstWidth: first.width, suffixWidth: suffix.width,
      together: first.width + secondWidth,
    };
  }, { content, conjunct, box });
  expect(reference.firstWidth).toBeLessThan(83);
  expect(reference.suffixWidth).toBeLessThan(83);
  expect(reference.together).toBeGreaterThan(83);
  const samePixels = (pixels: number[]) => pixels.every((value, index) =>
    Math.abs(value - reference.pixels[index]) <= 1);
  await expect.poll(async () => samePixels(await f.stage.evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 300 + box.x), Math.round(node.height / 2 - 200 + box.y),
      box.width, box.height,
    ).data), box))).toBe(true);

  await f.click(box.x + 10, box.y + 30, true);
  await expect(f.editor).toBeFocused();
  await f.editor.press('Control+Home');
  await f.editor.press('Shift+ArrowRight');
  expect(await f.editor.evaluate((node: HTMLTextAreaElement) =>
    [node.selectionStart, node.selectionEnd])).toEqual([0, conjunct.length]);
  await page.keyboard.insertText('कि');
  await f.done();
  const edited = (await f.read()).layers[0].keys[0].shapes[0].text!;
  expect(edited.content).toBe('कितिज');
  expect(edited.font).toBe(font);
  expect(edited.runs).toEqual([{ start: 0, end: 'कि'.length, style: { size: 58, color: '#0000ff' } }]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
  const out = await context.newPage();
  await openWebExport(out, await readWebDownload(await download));
  await expect.poll(async () => samePixels(await out.locator('canvas').evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(box.x, box.y, box.width, box.height).data), box)))
    .toBe(true);
  await f.stage.press('Control+Enter');
  const movie = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  await expect(movie).toBeVisible();
  await expect.poll(async () => {
    const png = (await movie.screenshot()).toString('base64');
    return out.evaluate(async ({ png, box, reference }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, 600, 400);
      const actual = ctx.getImageData(box.x, box.y, box.width, box.height).data;
      let common = 0, total = 0, colors = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const a = actual[i + 1] < 120, b = reference.pixels[i + 1] < 120;
        if (a || b) total++;
        if (a && b) {
          common++;
          if ((actual[i] > actual[i + 2]) === (reference.pixels[i] > reference.pixels[i + 2])) colors++;
        }
      }
      return common / total > 0.95 && colors / common > 0.99;
    }, { png, box, reference });
  }).toBe(true);
  expect(f.issues).toEqual([]);
  await out.close();
});

test('canvas horizontal arrows match native mixed bidi selection in an RTL field', async ({ page, context }) => {
  const content = 'אב 123 ג';
  const initial = 3;
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    Object.assign(shape.text!, { content, direction: 'rtl', font: 'Arial', size: 32 });
  });
  await f.click(130, 120, true);
  await expect(f.editor).toBeFocused();
  await f.editor.press('Control+Home');
  for (let i = 0; i < initial; i++) await f.editor.press('ArrowLeft');

  const reference = await context.newPage();
  await reference.setContent('<textarea dir="rtl"></textarea>');
  const native = reference.locator('textarea');
  await native.fill(content);
  await native.evaluate((node: HTMLTextAreaElement, offset) => node.setSelectionRange(offset, offset), initial);
  const range = (node: HTMLTextAreaElement) =>
    [node.selectionStart, node.selectionEnd, node.selectionDirection] as const;
  try {
    for (const key of ['Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowLeft']) {
      await native.press(key);
      await f.editor.press(key);
      expect(await f.editor.evaluate(range)).toEqual(await native.evaluate(range));
    }
    const [start, end] = await native.evaluate(range);
    expect(content.slice(start, end)).toBe('12');
    await page.keyboard.insertText('X');
    await f.done();
    expect((await f.read()).layers[0].keys[0].shapes[0].text!.content).toBe('אב X3 ג');
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  } finally {
    await reference.close();
  }
});

test('selected embedded text becomes editable curves with its hole and paint intact', async ({ page }) => {
  const bytes = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const family = 'Splash Font Outline Fixture';
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.assets.push({ id: 'font-outline', path: 'assets/fonts/font-outline.json',
      font: { name: 'codicon.ttf', family, bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) } });
    Object.assign(shape, { width: 192, height: 116, opacity: 0.8 });
    Object.assign(shape.text!, { content: '\ueabc\ueabc', font: family, size: 96 });
  });
  await expect.poll(() => page.evaluate(() => [...document.fonts].some(face => face.family.includes('Outline Fixture')))).toBe(true);
  const pixels = () => f.stage.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 200), Math.round(node.height / 2 - 100), 192, 116,
    ).data;
    return Array.from(data.filter((_, position) => position % 4 === 1), value => value < 150);
  });
  const ink = await pixels();
  expect(ink.filter(Boolean).length).toBeGreaterThan(500);
  expect(ink[48 + 192 * 52]).toBe(false);
  await f.click(145, 145);
  await page.getByRole('button', { name: 'Convert text to outlines', exact: true }).click();
  const readShape = async () => (await f.read()).layers[0].keys[0].shapes[0];
  await expect.poll(async () => (await readShape()).kind).toBe('polygon');
  const converted = await readShape();
  expect(converted).toMatchObject({ id: 'words', fill: '#e00000', opacity: 0.8, fillRule: 'evenodd' });
  expect(converted.text).toBeUndefined();
  expect(converted.contours).toHaveLength(4);
  expect(converted.contours!.every(ring => ring.some(node => node.in && node.out))).toBe(true);
  await f.click(330, 235);
  const outlineInk = await pixels();
  expect(outlineInk[48 + 192 * 52]).toBe(false);
  const overlap = outlineInk.filter((value, index) => value && ink[index]).length;
  const union = outlineInk.filter((value, index) => value || ink[index]).length;
  expect(overlap / union).toBeGreaterThan(0.9);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(readShape).toEqual(converted);
  const node = converted.contours![0][0];
  const start = await f.point(converted.x + node.x, converted.y + node.y);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 7, start.y + 4, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const edited = await readShape();
    return edited.contours!.some(ring => ring.some(point =>
      Math.hypot(edited.x + point.x - converted.x - node.x - 7,
        edited.y + point.y - converted.y - node.y - 4) < 0.01));
  }).toBe(true);
});

test('regular Latin text outlines preserve visible kerning and undo the whole conversion', async ({ page }) => {
  const bytes = process.platform === 'win32'
    ? await readFile(`${process.env.WINDIR ?? 'C:/Windows'}/Fonts/trebuc.ttf`).catch(() => undefined)
    : undefined;
  test.skip(!bytes, 'Uses a locally installed Windows TrueType fixture.');
  if (!bytes) return;
  const family = 'Splash Font Latin Outline Fixture';
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.assets.push({ id: 'latin-outline-font', path: 'assets/fonts/latin-outline-font.json',
      font: { name: 'trebuc.ttf', family, bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) } });
    Object.assign(shape, { width: 300, height: 116, opacity: 0.8 });
    Object.assign(shape.text!, { content: 'AV O', font: family, size: 96, kerning: 'normal', align: 'center' });
  });
  await expect.poll(() => page.evaluate(name => [...document.fonts].some(face =>
    face.family === name && face.status === 'loaded'), family)).toBe(true);
  const adjustment = await f.stage.evaluate((node: HTMLCanvasElement, name) => {
    const ctx = node.getContext('2d')!;
    ctx.save();
    try {
      ctx.font = `96px "${name}"`;
      ctx.fontKerning = 'none';
      const unkerned = ctx.measureText('AV').width;
      ctx.fontKerning = 'normal';
      return ctx.measureText('AV').width - unkerned;
    } finally { ctx.restore(); }
  }, family);
  expect(adjustment).toBeLessThan(-4);
  const pixels = () => f.stage.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 200), Math.round(node.height / 2 - 100), 300, 116,
    ).data;
    return Array.from(data.filter((_, position) => position % 4 === 1), value => value < 150);
  });
  const before = await pixels();
  expect(before.filter(Boolean).length).toBeGreaterThan(1000);
  await f.click(140, 145);
  await page.getByRole('button', { name: 'Convert text to outlines', exact: true }).click();
  const readShape = async () => (await f.read()).layers[0].keys[0].shapes[0];
  await expect.poll(async () => (await readShape()).kind).toBe('polygon');
  const outlined = await readShape();
  expect(outlined).toMatchObject({ id: 'words', x: 100, y: 100, fill: '#e00000', opacity: 0.8, fillRule: 'evenodd' });
  expect(outlined.contours).toHaveLength(5);
  await f.click(415, 235);
  const after = await pixels();
  const intersection = after.filter((value, index) => value && before[index]).length;
  const union = after.filter((value, index) => value || before[index]).length;
  expect(intersection / union).toBeGreaterThan(0.9);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(readShape).toEqual(outlined);
});

test('unsupported system-font text remains exact when outline conversion is rejected', async ({ page }) => {
  const f = await setup(page);
  await f.click(120, 110);
  await page.getByRole('button', { name: 'Convert text to outlines', exact: true }).click();
  await expect(page.getByText(/Choose an embedded project font before outlining text/)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});

test('Test Movie waits for the project fallback while detached PNG loads its own face', async ({ page }) => {
  const bytes = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const family = 'Splash Font Pending Fixture';
  await page.addInitScript(name => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.defineProperty(window, 'releaseFixtureFont', { value: release });
    const load = FontFace.prototype.load;
    FontFace.prototype.load = function () {
      const result = load.call(this);
      return window === top && this.family === name ? result.then(async face => {
        await gate;
        return face;
      }) : result;
    };
  }, family);
  const f = await setup(page, false, false, false, undefined, (project, shape) => {
    project.layers[0].keys.splice(1);
    project.assets.push({ id: 'pending-font', path: 'assets/fonts/pending-font.json',
      font: { name: 'codicon.ttf', family, bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) } });
    Object.assign(shape.text!, { font: `Missing Fixture 8812, ${family}, monospace`, content: '\uea60\uea60\uea60' });
  });
  const crop = [100, 100, 180, 42] as const;
  const stagePixels = () => f.stage.evaluate((node: HTMLCanvasElement, box) =>
    Array.from(node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 300 + box[0]), Math.round(node.height / 2 - 200 + box[1]),
      box[2], box[3],
    ).data), crop);
  const fontPresent = () => page.evaluate(name => [...document.fonts].some(face => face.family === name), family);
  expect(await fontPresent()).toBe(false);
  const fallback = await stagePixels();
  const decode = (png: string) => page.evaluate(async ({ png, box }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return Array.from(ctx.getImageData(...box).data);
  }, { png, box: crop });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const captured = await decode((await readFile((await (await download).path())!)).toString('base64'));
  expect(captured.filter((value, index) => index % 4 === 1 && value < 100).length).toBeGreaterThan(50);
  expect(captured.every((value, index) => value === fallback[index])).toBe(false);
  expect(await fontPresent()).toBe(false);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);

  await f.stage.press('Control+Enter');
  const movie = page.getByRole('dialog', { name: 'Test movie' });
  await expect(movie.getByText('Waiting for project fonts', { exact: true })).toBeVisible();
  await expect(movie.locator('canvas')).toBeHidden();
  await movie.getByRole('button', { name: 'Close ×', exact: true }).click();
  await expect(movie).toHaveCount(0);
  expect(await fontPresent()).toBe(false);
  await f.stage.press('Control+Enter');
  await expect(movie.getByText('Waiting for project fonts', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as Window & { releaseFixtureFont?: () => void }).releaseFixtureFont!());
  await expect(movie.locator('canvas')).toBeVisible();
  await expect.poll(async () => {
    const pixels = await decode((await movie.locator('canvas').screenshot()).toString('base64'));
    let common = 0, total = 0;
    for (let index = 1; index < pixels.length; index += 4) {
      const a = pixels[index] < 120, b = captured[index] < 120;
      if (a && b) common++;
      if (a || b) total++;
    }
    return common / total;
  }).toBeGreaterThan(0.95);
  await movie.getByRole('button', { name: 'Close ×', exact: true }).click();
  await expect.poll(async () => (await stagePixels()).every((value, index) => value === captured[index])).toBe(true);
  expect(await f.read()).toEqual(f.p);
});

async function recoverTextFixture(page: Page) {
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
}

test('an authorized project font renders in standalone HTML without an installed copy', async ({ page, context }) => {
  const bytes = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const family = 'Splash Font Portable Fixture';
  const f = await setup(page, false, false, false, undefined, (_project, shape) => {
    shape.text!.content = '\uea60\uea60\uea60';
  });
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Embed project font…', exact: true }).click();
    return page.getByRole('dialog', { name: 'Embed project font', exact: true });
  };
  const dialog = await open();
  const file = dialog.getByLabel('TrueType font');
  const embed = dialog.getByRole('button', { name: 'Embed font', exact: true });
  const consent = dialog.getByRole('checkbox');
  await expect(file).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await open();
  await expect(file).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(consent).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(file).toBeFocused();
  const restricted = Buffer.from(bytes);
  const os = Array.from({ length: restricted.readUInt16BE(4) }, (_, i) => 12 + 16 * i)
    .find(i => restricted.toString('ascii', i, i + 4) === 'OS/2')!;
  restricted.writeUInt16BE(2, restricted.readUInt32BE(os + 8) + 8);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  await chooser.setFiles({ name: 'restricted.ttf', mimeType: 'font/ttf', buffer: restricted });
  await expect(embed).toBeDisabled();
  await consent.check();
  await embed.click();
  await expect(dialog.getByRole('alert')).toContainText('permissions');
  await file.setInputFiles({ name: 'portable.ttf', mimeType: 'font/ttf', buffer: bytes });
  await expect(consent).not.toBeChecked();
  const projectFamily = dialog.getByLabel('Project family name');
  await projectFamily.fill('Portable Fixture');
  await page.keyboard.press('Tab');
  await expect(consent).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(embed).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(f.stage).toBeFocused();
  const embedded = (await f.read()).assets[0].font!;
  expect(embedded.family).toBe(family);
  expect(Buffer.from(embedded.dataUrl!.split(',')[1], 'base64').equals(bytes)).toBe(true);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(async () => (await f.read()).assets[0]?.font === undefined).toBe(false);
  await f.click(120, 110);
  await page.getByRole('combobox', { name: 'Text font', exact: true }).selectOption(family);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].text!.font).toBe(family);
  const authored = await f.read();
  await page.reload();
  await recoverTextFixture(page);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  expect(await f.read()).toEqual(authored);
  await expect.poll(() => page.evaluate(() => [...document.fonts].some(face =>
    face.family.includes('Splash Font Portable Fixture') && face.status === 'loaded'))).toBe(true);
  const stageInk = await f.stage.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 200), Math.round(node.height / 2 - 100), 180, 42,
    ).data;
    return Array.from(data.filter((_, index) => index % 4 === 1));
  });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
  const standalone = await readWebDownload(await download);
  const out = await context.newPage();
  await openWebExport(out, standalone);
  const ink = () => out.locator('canvas').evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext('2d')!.getImageData(100, 100, 180, 42).data;
    return Array.from(data.filter((_, index) => index % 4 === 1));
  });
  await expect.poll(async () => (await ink()).filter(value => value < 100).length).toBeGreaterThan(50);
  const portable = await ink();
  expect(stageInk.every((value, index) => value === portable[index]), 'Standalone and editor render the same glyphs').toBe(true);
  const fallback = structuredClone(authored);
  fallback.assets = [];
  await out.goto('about:blank');
  await out.setContent(exportHTML(fallback, 0));
  await expect(out.locator('canvas')).toHaveAttribute('data-capture', 'ready');
  expect((await ink()).every((value, index) => value === portable[index])).toBe(false);
  await out.close();
});

test('installed font discovery reports a retained font stack and uses its explicit fallback', async ({ page, context }) => {
  await context.grantPermissions(['local-fonts']);
  const missing = 'Missing Splash Fixture Family 55091', stack = missing + ', monospace';
  const f = await setup(page, false, false, false, undefined, (project, text) => {
    const shape = { ...structuredClone(text), text: { ...text.text!, font: stack } };
    project.symbols = [{ id: 'font-sample', name: 'Font sample', width: 400, height: 240,
      shapes: [shape], timeline: { duration: 3, keys: [] } }];
  });
  await f.click(120, 110);
  const stackInput = page.getByLabel('Custom font family', { exact: true });
  await stackInput.fill(stack);
  await stackInput.press('Tab');
  await page.getByRole('button', { name: 'Discover installed fonts', exact: true }).click();
  const availability = page.getByLabel('Font availability', { exact: true });
  await expect(availability).toContainText('Unlisted fonts: ' + missing);
  await expect(availability).toContainText('First matching family: monospace.');
  const choices = page.getByRole('combobox', { name: 'Text font', exact: true });
  const discovered = await choices.locator('optgroup[label="Discovered families"] option').evaluateAll(
    options => options.map(option => (option as HTMLOptionElement).value),
  );
  expect(discovered.length).toBeGreaterThan(0);
  const authored = await f.read();
  expect(authored.layers[0].keys[0].shapes[0].text!.font).toBe(stack);
  const ink = () => f.stage.evaluate((node: HTMLCanvasElement) => {
    const scale = devicePixelRatio;
    return Array.from(node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 - 197 * scale),
      Math.round(node.height / 2 - 97 * scale),
      Math.round(211 * scale), Math.round(31 * scale),
    ).data);
  });
  const before = await ink();
  expect(before.filter((v, i) => i % 4 === 1 && v < 100).length).toBeGreaterThan(50);
  await choices.selectOption('monospace');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].text!.font).toBe('monospace');
  await expect.poll(async () => (await ink()).every((value, index) => value === before[index])).toBe(true);
  expect((await f.read()).layers[0].keys[0].shapes[0].width).toBe(authored.layers[0].keys[0].shapes[0].width);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(authored);
  const resolved = structuredClone(authored);
  resolved.layers[0].keys[0].shapes[0].text!.font = 'monospace';
  async function pixels(project: Project) {
    const out = await context.newPage();
    await out.setContent(exportHTML(project, 0));
    const canvas = out.locator('canvas');
    await expect(canvas).toHaveAttribute('data-capture', 'ready');
    const result = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
    await out.close();
    return result;
  }
  expect((await pixels(authored)) === (await pixels(resolved)), 'Named stack renders the same pixels as its generic fallback').toBe(true);
  await f.click(120, 110);
  await choices.selectOption(discovered[0]);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].text!.font).toBe(discovered[0]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(authored);
  await page.getByRole('option', { name: 'Library item Font sample', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
  await expect(workspace.getByLabel('Font availability', { exact: true })).toContainText('First matching family: monospace.');
  await workspace.getByRole('combobox', { name: 'Choose symbol font', exact: true }).selectOption(discovered[0]);
  await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.symbols![0].shapes[0].text!.font).toBe(discovered[0]);
  expect(saved.layers).toEqual(authored.layers);
});

test('denied font discovery keeps the authored stack and generic choices available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'queryLocalFonts', { value: () =>
      Promise.reject(new DOMException('Permission denied by fixture', 'NotAllowedError')) });
  });
  const f = await setup(page);
  await f.click(120, 110);
  await page.getByRole('button', { name: 'Discover installed fonts', exact: true }).click();
  await expect(page.getByLabel('Font availability', { exact: true })).toContainText('Font access was denied.');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('combobox', { name: 'Text font', exact: true }).selectOption('serif');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].text!.font).toBe('serif');
});

test('dynamic text binding survives recovery and typed preview updates only detached artwork', async ({ page }) => {
  const f = await setup(page, true, false, false, [
    { frame: 0, source: 'splashText.set("message", "Hello world\\nBBBB"); timeline.gotoAndStop(1);' },
    { frame: 1, source: 'state.$splashText = 17;' },
  ]);
  const binding = page.getByRole('textbox', { name: 'Dynamic text binding', exact: true });
  await f.click(120, 110);
  await binding.fill('bad name');
  await binding.press('Tab');
  await expect(binding).toHaveValue('');
  expect(await f.read()).toEqual(f.p);
  await binding.fill('message');
  await binding.press('Tab');
  const authored = structuredClone(f.p);
  authored.layers[0].keys[0].shapes[0].text!.dynamicBinding = 'message';
  await expect.poll(f.read).toEqual(authored);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(authored);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await f.click(120, 110);
  await expect(binding).toHaveValue('message');

  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  await preview.getByRole('checkbox', { name: 'Render detached artwork' }).check();
  await preview.getByRole('button', { name: 'Prepare script preview' }).click();
  const image = preview.getByRole('img', { name: 'Script preview artwork' });
  await expect(image).toBeVisible();
  const inkOnNewLine = () => image.evaluate(async (node: HTMLImageElement) => {
    await node.decode();
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(node, 0, 0);
    const pixels = ctx.getImageData(100, 138, 120, 36).data;
    return pixels.filter((v, i) => i % 4 === 1 && v < 120).length;
  });
  expect(await inkOnNewLine()).toBe(0);
  const before = await image.getAttribute('src');
  const step = preview.getByRole('button', { name: 'Step script tick' });
  await step.click();
  await expect(image).not.toHaveAttribute('src', before!);
  expect(await inkOnNewLine()).toBeGreaterThan(100);
  const updated = await image.getAttribute('src');
  await step.click();
  await expect(preview.getByText(/Dynamic text values must be a plain record/)).toBeVisible();
  await expect(image).toHaveAttribute('src', updated!);
  await preview.getByRole('button', { name: 'Replay retained script history' }).click();
  await expect(preview.getByText(/Replay matched 1 ticks/)).toBeVisible();
  expect(await inkOnNewLine()).toBeGreaterThan(100);
  await preview.getByRole('button', { name: 'Reset script preview' }).click();
  await expect.poll(inkOnNewLine).toBe(0);
  expect(await f.read()).toEqual(authored);

  const exported = await page.context().newPage();
  await exported.setContent(exportHTML(authored, 0));
  const canvas = exported.getByLabel('Animation', { exact: true });
  await expect(canvas).toHaveAttribute('data-capture', 'ready');
  const pixels = await canvas.evaluate((node: HTMLCanvasElement) =>
    Array.from(node.getContext('2d')!.getImageData(100, 138, 120, 36).data));
  expect(pixels.every(v => v === 255)).toBe(true);
  await exported.close();
});

test('authored input text delivers native selection and value through an isolated preview', async ({ page }) => {
  const f = await setup(page, false, false, false, [{ frame: 0, source: [
    'if(input.textInput){',
    '  if(input.textInput.value==="reject")throw new Error("Rejected field");',
    '  state.received={...input.textInput};',
    '  state.immutable=Object.isFrozen(input.textInput);',
    '} timeline.stop();',
  ].join('\n') }]);
  await f.click(120, 110);
  const binding = page.getByRole('textbox', { name: 'Dynamic text binding', exact: true });
  await binding.fill('message');
  await binding.press('Tab');
  const option = page.getByRole('checkbox', { name: 'Editable in script preview', exact: true });
  await option.check();
  const authored = structuredClone(f.p);
  Object.assign(authored.layers[0].keys[0].shapes[0].text!, { dynamicBinding: 'message', input: true });
  await expect.poll(f.read).toEqual(authored);
  await f.stage.press('Control+z');
  const dynamic = structuredClone(authored);
  delete dynamic.layers[0].keys[0].shapes[0].text!.input;
  await expect.poll(f.read).toEqual(dynamic);
  await f.click(120, 110);
  await expect(option).not.toBeChecked();
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(authored);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await f.click(120,110);
  await expect(option).toBeChecked();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  await preview.getByRole('checkbox', { name: 'Render detached artwork' }).check();
  await preview.getByRole('button', { name: 'Prepare script preview' }).click();
  const input = preview.getByRole('textbox', { name: 'Text input message', exact: true });
  await expect(input).toHaveValue('Hello world');
  await expect(input).toHaveAttribute('data-script-stage-input', '');
  await preview.getByRole('checkbox', { name: 'Capture pointers on artwork', exact: true }).check();
  await input.click();
  await expect(input).toBeFocused();
  await expect(preview.getByLabel('Queued pointer inputs', { exact: true })).toContainText('0 pointer events');
  await input.press('Control+a');
  const deliver = preview.getByRole('button', { name: 'Deliver message and step', exact: true });
  await input.dispatchEvent('compositionstart', { data: '' });
  await expect(deliver).toBeDisabled();
  await page.keyboard.insertText('Hello world\nUPDATED字');
  await input.dispatchEvent('compositionend', { data: 'UPDATED字' });
  await expect(deliver).toBeEnabled();
  await input.press('Shift+Home');
  await input.press('Control+Enter');
  const state = async () => JSON.parse(await preview.getByLabel('Script preview state').textContent() ?? '{}');
  const expected = { binding: 'message', value: 'Hello world\nUPDATED字', selectionStart: 12,
    selectionEnd: 20, selectionDirection: 'backward' };
  await expect.poll(state).toEqual({ $splashText: { message: expected.value }, received: expected, immutable: true });
  const image = preview.getByRole('img', { name: 'Script preview artwork' });
  const ink = await image.evaluate(async (node: HTMLImageElement) => {
    await node.decode();
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(node, 0, 0);
    return ctx.getImageData(100, 146, 160, 28).data.filter((v, i) => i % 4 === 1 && v < 120).length;
  });
  expect(ink).toBeGreaterThan(100);
  const retained = await image.getAttribute('src');
  await input.fill('reject');
  await deliver.click();
  await expect(preview.getByRole('status')).toContainText('Rejected field');
  await expect(image).toHaveAttribute('src', retained!);
  await expect(input).toHaveValue('reject');
  expect((await state()).received).toEqual(expected);
  await preview.getByRole('button', { name: 'Replay retained script history' }).click();
  await expect(input).toHaveValue(expected.value);
  await preview.getByRole('button', { name: 'Reset script preview' }).click();
  await expect(input).toHaveValue('Hello world');
  expect(await f.read()).toEqual(authored);
});

test('reflected preview input follows actual image scaling and keeps native keyboard focus', async ({ page }) => {
  const f = await setup(page, false, true, false, [{ frame: 0, source: 'timeline.stop();' }],
    (project, field) => {
      project.background = '#202020';
      field.fill = '#ffffff';
      Object.assign(field.text!, { dynamicBinding: 'caption', input: true, bold: true,
        scaleX: 1.2, scaleY: 0.8, lineHeight: 1.35, letterSpacing: 1 });
    });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  await preview.getByRole('checkbox', { name: 'Render detached artwork' }).check();
  await preview.getByRole('button', { name: 'Prepare script preview' }).click();
  const input = preview.getByRole('textbox', { name: 'Text input caption', exact: true });
  const image = preview.getByRole('img', { name: 'Script preview artwork', exact: true });
  await expect(input).toHaveAttribute('data-script-stage-input', '');
  await expect(input).toHaveCSS('font-size', '32px');
  await expect(input).toHaveCSS('font-weight', '700');
  await expect(input).toHaveCSS('letter-spacing', '1px');
  await input.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  const checkBox = async () => {
    const img = (await image.boundingBox())!, field = (await input.boundingBox())!;
    // Authored corners under the fixture's reflected and skewed basis.
    const [left, right, top, bottom] = [110, 357.68, 100, 162.4];
    return Math.max(
      Math.abs(field.x - (img.x + left / 600 * img.width)),
      Math.abs(field.y - (img.y + top / 400 * img.height)),
      Math.abs(field.width - ((right - left) / 600 * img.width)),
      Math.abs(field.height - ((bottom - top) / 400 * img.height)),
    );
  };
  await expect.poll(checkBox).toBeLessThan(0.1);
  await image.evaluate(node => { node.style.width = '270px'; node.style.height = '185px'; });
  await expect.poll(checkBox).toBeLessThan(0.1);
  await expect(input).toBeFocused();
  await input.press('Tab');
  const deliver = preview.getByRole('button', { name: 'Deliver caption and step', exact: true });
  await expect(deliver).toBeFocused();
  await deliver.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.fill('Updated');
  await input.press('Control+Enter');
  await expect(preview.getByRole('status')).toHaveText('Completed 1 script tick.');
  await expect(input).toBeFocused();
  expect(await f.read()).toEqual(f.p);
});

test('scoped dynamic text keeps repeated nested movie artwork independent through replay and reset', async ({ page }) => {
  const f = await setup(page, true, false, false, [
    { frame: 0, source: [
      'splashText.set("message", "Shared");',
      'splashText.setForInstance("left/caption", "message", "Hello world\\nMMMM");',
      'splashText.setForInstance("right", "message", "Hello world\\nBBBB\\nBBBB");',
      'timeline.gotoAndStop(1);',
    ].join('\n') },
    { frame: 1, source: [
      'splashText.setForInstance("left/caption", "message", "Unpublished");',
      'splashText.setForInstance("missing", "message", "Rejected");',
    ].join('\n') },
  ], (project, text) => {
    const leaf = {
      id: 'caption', name: 'Caption', width: 240, height: 120,
      shapes: [{ ...structuredClone(text), x: 0, y: 0, text: { ...text.text!, dynamicBinding: 'message' } }],
      timeline: { duration: 3, keys: [] },
    };
    const nested = symbolInstance(leaf, 0, 0);
    nested.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    const outer = { id: 'container', name: 'Container', width: 240, height: 120,
      shapes: [nested], timeline: { duration: 3, keys: [] } };
    project.symbols = [leaf, outer];
    project.layers[0].keys[0].shapes = [
      { ...symbolInstance(outer, 100, 100), instanceName: 'left/caption',
        symbolPlayback: { mode: 'movie', firstFrame: 0 } },
      { ...symbolInstance(outer, 350, 100), instanceName: 'right' },
    ];
  });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  await preview.getByRole('checkbox', { name: 'Render detached artwork' }).check();
  await preview.getByRole('button', { name: 'Prepare script preview' }).click();
  const image = preview.getByRole('img', { name: 'Script preview artwork' });
  await expect(image).toBeVisible();
  const ink = () => image.evaluate(async (node: HTMLImageElement) => {
    await node.decode();
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(node, 0, 0);
    return [100, 350].flatMap(x => [143, 188].map(y =>
      ctx.getImageData(x, y, 120, 26).data.filter((value, i) => i % 4 === 1 && value < 120).length));
  });
  expect(await ink()).toEqual([0, 0, 0, 0]);
  const step = preview.getByRole('button', { name: 'Step script tick' });
  await step.click();
  await expect(preview.getByText('Completed 1 script tick.', { exact: true })).toBeVisible();
  const independent = await ink();
  expect(independent[0]).toBeGreaterThan(100);
  expect(independent[1]).toBe(0);
  expect(independent[2]).toBeGreaterThan(100);
  expect(independent[3]).toBeGreaterThan(100);
  await preview.getByRole('button', { name: 'Capture script checkpoint' }).click();
  const retained = await image.getAttribute('src');
  await step.click();
  await expect(preview.getByText(/Dynamic text instance name is missing: missing/)).toBeVisible();
  await expect(image).toHaveAttribute('src', retained!);
  await preview.getByRole('button', { name: 'Reset script preview' }).click();
  await expect.poll(ink).toEqual([0, 0, 0, 0]);
  await preview.getByRole('button', { name: 'Restore script checkpoint' }).click();
  await expect.poll(ink).toEqual(independent);
  await preview.getByRole('button', { name: 'Replay retained script history' }).click();
  await expect(preview.getByText(/Replay matched 1 ticks/)).toBeVisible();
  expect(await ink()).toEqual(independent);
  expect(await f.read()).toEqual(f.p);
});

test('script replay HTML renders scoped text changes at their recorded ticks', async ({page})=>{
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Run with the matching signed test license.');
  const f=await setup(page,true,false,false,[{frame:0,source:String.raw`
    if (input.clear) delete state.$splashText;
    else if (input.bad) splashText.setForInstance("missing", "message", "Rejected");
    else {
      splashText.set("message", "Shared");
      splashText.setForInstance("left", "message", "Hello world\nMMMM");
      splashText.setForInstance("right", "message", "Hello world\nBBBB\nBBBB");
    }
    timeline.stop();
  `}],(project,text)=>{
    project.name='Text replay';project.fps=10;
    const definition={id:'caption',name:'Caption',width:240,height:120,
      shapes:[{...text,x:0,y:0,text:{...text.text!,dynamicBinding:'message'}}]};
    project.symbols=[definition];
    project.layers[0].keys=[{frame:0,shapes:[
      {...symbolInstance(definition,100,100),instanceName:'left'},
      {...symbolInstance(definition,350,100),instanceName:'right'},
    ]}];
  });
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const button=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status'),image=dialog.getByAltText('Script preview artwork');
  const ink=()=>image.evaluate(async node=>{
    const img=node as HTMLImageElement;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
    return [100,350].flatMap(x=>[143,188].map(y=>ctx.getImageData(x,y,120,26).data.filter((v,i)=>i%4===1&&v<120).length));
  });
  const send=async(value:object)=>{
    await dialog.getByLabel('Script input JSON').fill(JSON.stringify(value));
    await button('Send input and step').click();
  };
  await dialog.getByLabel('Render detached artwork').check();
  await button('Prepare script preview').click();await expect(status).toHaveText('Ready. No scripts have run.');
  const authored=await ink();expect(authored).toEqual([0,0,0,0]);
  await button('Step script tick').click();await expect(status).toHaveText('Completed 1 script tick.');
  const scoped=await ink();
  expect(scoped[0]).toBeGreaterThan(100);expect(scoped[1]).toBe(0);
  expect(scoped[2]).toBeGreaterThan(100);expect(scoped[3]).toBeGreaterThan(100);
  await button('Capture script checkpoint').click();
  await send({bad:true});await expect(status).toContainText('Dynamic text instance name is missing');
  expect(await ink()).toEqual(scoped);
  await send({clear:true});await expect(status).toHaveText('Completed 1 script tick.');
  expect(await ink()).toEqual(authored);
  await button('Restore script checkpoint').click();await expect(status).toContainText('Checkpoint restored');
  expect(await ink()).toEqual(scoped);
  await send({clear:true});await expect(status).toHaveText('Completed 1 script tick.');
  const [download]=await Promise.all([page.waitForEvent('download'),button('Download script replay HTML').click()]);
  expect(download.suggestedFilename()).toBe('Text replay-script-replay.html');
  const html=await readFile((await download.path())!,'utf8');
  expect(html.includes('Rejected')).toBe(false);
  const playback=await page.context().newPage();
  await playback.setContent(html.replace('<script>','<script>window.framesToRun=[];requestAnimationFrame=cb=>{window.framesToRun.push(cb);};'));
  await playback.waitForFunction(()=>((window as Window&{framesToRun?:unknown[]}).framesToRun?.length??0)>0);
  const advance=(time:number)=>playback.evaluate(time=>{
    const draw=(window as Window&{framesToRun?:FrameRequestCallback[]}).framesToRun?.shift();
    if(!draw)throw Error('Playback frame was not scheduled.');
    draw(time);
    const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
    return [canvas.dataset.tick,[100,350].flatMap(x=>[143,188].map(y=>
      ctx.getImageData(x,y,120,26).data.filter((v,i)=>i%4===1&&v<120).length))];
  },time);
  expect(await advance(1000)).toEqual(['0',authored]);
  expect(await advance(1100)).toEqual(['1',scoped]);
  expect(await advance(1200)).toEqual(['2',authored]);
  await playback.close();
  expect(await f.read()).toEqual(f.p);
});

test('click creates an expanding field with immediate native typing, no placeholder and one Undo', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(100, 200);
  await expect(f.editor).toBeFocused();
  await expect(f.editor).toHaveValue('');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.type('Real text');
  await expect(f.editor).toHaveValue('Real text');
  await expect
    .poll(() =>
      f.stage.evaluate((c: HTMLCanvasElement) => {
        const r = c.getBoundingClientRect(),
          sx = c.width / r.width,
          sy = c.height / r.height,
          data = c
            .getContext('2d')!
            .getImageData(
              Math.round((r.width / 2 - 200) * sx),
              Math.round((r.height / 2) * sy),
              Math.round(200 * sx),
              Math.round(45 * sy),
            ).data;
        let ink = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) ink++;
        return ink;
      }),
    )
    .toBeGreaterThan(150);
  expect(await f.read()).toEqual(f.p);
  await f.done();
  const out = await f.read(),
    created = out.layers[0].keys[0].shapes.at(-1)!;
  expect(created.text?.content).toBe('Real text');
  expect(created.text?.wrapWidth).toBe(0);
  expect(created.width).toBeGreaterThan(40);
  expect(out.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('drag creates a wrapping field and resizing its text handle reflows without scaling glyphs', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const a = await f.point(90, 200),
    b = await f.point(210, 200);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(f.editor).toBeFocused();
  await page.keyboard.type('one two three four five six');
  await f.done();
  const first = await f.read(),
    v = first.layers[0].keys[0].shapes.at(-1)!;
  expect(v.width).toBeCloseTo(120);
  expect(v.height).toBeGreaterThan(60);
  expect(v.text?.scaleX).toBe(1);
  await f.click(100, 210);
  await expect(f.editor).toBeFocused();
  const handle = await f.point(210, 200),
    to = await f.point(350, 200);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await f.done();
  const edited = (await f.read()).layers[0].keys[0].shapes.at(-1)!;
  expect(edited.width).toBeCloseTo(260);
  expect(edited.height).toBeLessThan(v.height);
  expect(edited.text?.size).toBe(v.text?.size);
  expect(edited.text?.scaleX).toBe(1);
});

test('Selection double-click edits an existing object, native word/select-all and local history preserve one document edit', async ({
  page,
}) => {
  const f = await setup(page);
  await f.click(125, 115, true);
  await expect(f.editor).toBeFocused();
  await expect(f.editor).toHaveValue('Hello world');
  const q = await f.point(125, 115);
  await page.mouse.dblclick(q.x, q.y);
  await expect
    .poll(() =>
      f.editor.evaluate((e: HTMLTextAreaElement) => {
        const t = e as HTMLTextAreaElement;
        return t.value.slice(t.selectionStart, t.selectionEnd);
      }),
    )
    .toBe('Hello');
  await page.keyboard.type('Hi');
  await expect(f.editor).toHaveValue('Hi world');
  await page.keyboard.press('Control+z');
  await expect(f.editor).toHaveValue('Hello world');
  await page.keyboard.press('Control+Shift+z');
  await expect(f.editor).toHaveValue('Hi world');
  await f.done();
  const expected = structuredClone(f.p),
    out = await f.read();
  expected.layers[0].keys[0].shapes[0] = out.layers[0].keys[0].shapes[0];
  expect(out).toEqual(expected);
  expect(out.layers[0].keys[0].shapes[0].text?.content).toBe('Hi world');
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('rich text edits preserve unaffected runs, clipboard and Ctrl+B format characters on canvas', async ({
  page,
  context,
}) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await expect(f.editor).toBeFocused();
  await f.editor.press('Home');
  await f.editor.press('Shift+ArrowRight');
  await f.editor.press('Shift+ArrowRight');
  await f.editor.press('Control+b');
  await f.editor.press('End');
  await page.keyboard.type('!');
  await f.done();
  const out = await f.read(),
    t = out.layers[0].keys[0].shapes[0].text!;
  expect(t.content).toBe('Hello world!');
  expect(t.runs).toContainEqual({ start: 0, end: 2, style: { bold: true } });
  expect(t.runs?.some((r) => r.start === 6 && r.style.italic && r.style.color === '#0000ff')).toBe(
    true,
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('Pasted text'));
  await f.click(125, 115);
  await f.editor.press('Control+a');
  await f.editor.press('Control+v');
  await expect(f.editor).toHaveValue('Pasted text');
  await f.done();
});

test('reflected and skewed text keeps its original basis and empty/cancelled fields create no placeholder', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(315, 115);
  await expect(f.editor).toBeFocused();
  await f.editor.press('Control+a');
  await page.keyboard.type('Changed');
  await f.done();
  const out = await f.read(),
    v = out.layers[0].keys[0].shapes[0];
  expect(v.transform).toEqual(f.text.transform);
  expect(v.x).toBe(f.text.x);
  expect(v.y).toBe(f.text.y);
  expect(v.text?.content).toBe('Changed');
  await f.click(80, 260);
  await f.done();
  expect(await f.read()).toEqual(out);
  await f.click(80, 260);
  await page.keyboard.type('cancel this');
  await f.editor.press('Shift+Escape');
  await expect(f.editor).toHaveCount(0);
  expect(await f.read()).toEqual(out);
  expect(f.issues).toEqual([]);
});

for (const entry of ['library', 'stage'] as const)
  test(`${entry} symbol text edits use the same caret, frame flush and one document history`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 600;
    p.height = 400;
    p.layers[0].drawingMode = 'object';
    const art: Vector = {
      id: 'words',
      kind: 'text',
      x: 30,
      y: 30,
      width: 220,
      height: 38.4,
      rotation: 0,
      fill: '#e00000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      text: {
        content: 'Symbol words',
        font: 'Arial',
        size: 32,
        bold: false,
        italic: false,
        align: 'left',
      },
    };
    p.symbols = [
      {
        id: 'type',
        name: 'Typography',
        width: 400,
        height: 240,
        shapes: [art],
        timeline: {
          duration: 8,
          keys: [
            {
              frame: 4,
              shapes: [{ ...structuredClone(art), text: { ...art.text!, content: 'Later words' } }],
            },
          ],
        },
      },
    ];
    p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 100, 60)];
    const issues: string[] = [];
    page.on('pageerror', (e) => issues.push(e.stack ?? String(e)));
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
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const originalBox = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
    if (entry === 'library')
      await page.getByRole('option', { name: 'Library item Typography', exact: true }).dblclick();
    else {
      const b = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
      await page.mouse.dblclick(b.x + b.width / 2 + 150 - 300, b.y + b.height / 2 + 110 - 200);
    }
    await page.getByRole('button', { name: 'Advanced symbol timeline tools…' }).click();
    const workspace = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
    await expect(workspace).toBeVisible();
    await workspace
      .getByRole('navigation', { name: 'Symbol drawing tools', exact: true })
      .getByRole('button', { name: 'Text', exact: true })
      .click();
    const canvas = workspace.getByLabel('Symbol artwork preview', { exact: true }),
      box = (await canvas.boundingBox())!;
    // Stage entry keeps document registration; Library entry fits 400 x 240.
    const point =
      entry === 'library'
        ? {
            x: box.x + ((20 + 60 * (290 / 240)) * box.width) / 540,
            y: box.y + ((20 + 45 * (290 / 240)) * box.height) / 330,
          }
        : {
            x: originalBox.x + originalBox.width / 2 + 160 - 300,
            y: originalBox.y + originalBox.height / 2 + 105 - 200,
          };
    await page.mouse.click(point.x, point.y);
    const editor = workspace.getByLabel('Edit text on canvas', { exact: true });
    await expect(editor).toBeFocused();
    await editor.press('Control+a');
    await page.keyboard.type('Edited symbol');
    await editor.press('Home');
    await editor.press('Control+b');
    await expect(workspace.getByLabel('Symbol text bold', { exact: true })).toBeChecked();
    await page.keyboard.type('B');
    await expect(workspace.getByLabel('Symbol text size', { exact: true })).toHaveValue('32');
    await workspace
      .getByLabel('Timeline frames', { exact: true })
      .click({ position: { x: 4 * 18 + 8, y: 39 } });
    await expect(editor).toHaveCount(0);
    await expect(workspace.getByLabel('Symbol text content', { exact: true })).toHaveValue(
      'Later words',
    );
    if (entry === 'library') {
      const binding = workspace.getByRole('textbox', { name: 'Symbol dynamic text binding', exact: true });
      await binding.fill('label');
      await binding.press('Tab');
      await expect(binding).toHaveValue('label');
      await workspace.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
      await expect(binding).toHaveValue('');
      await workspace.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
      await expect(binding).toHaveValue('label');
      await workspace.getByRole('checkbox', { name: 'Editable in script preview', exact: true }).check();
    }
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    expect(await read()).toEqual(p);
    await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const out = await read();
    expect(out.symbols![0].shapes.some((s) => s.text?.content === 'BEdited symbol')).toBe(true);
    const expectedKeys = structuredClone(p.symbols[0].timeline!.keys);
    if (entry === 'library') Object.assign(expectedKeys[0].shapes[0].text!, { dynamicBinding: 'label', input: true });
    expect(out.symbols![0].timeline!.keys).toEqual(expectedKeys);
    expect(out.layers).toEqual(p.layers);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(p);
    expect(issues).toEqual([]);
  });

test('canvas text retains exact rendered ink on exit and Properties formats selected characters only', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('Control+a');
  await page.keyboard.type('Canvas text');
  await f.editor.press('Home');
  await f.editor.press('Shift+ArrowRight');
  await f.editor.press('Shift+ArrowRight');
  await page.getByLabel('Text size', { exact: true }).fill('48');
  await page.getByLabel('Text size', { exact: true }).press('Tab');
  await expect(f.editor).toHaveCount(1);
  const ink = () =>
    f.stage.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let count = 0,
        hash = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 150 && data[i + 1] < 50 && data[i + 2] < 50) {
          count++;
          hash = (hash + i) >>> 0;
        }
      return { count, hash };
    });
  await expect.poll(async () => (await ink()).count).toBeGreaterThan(100);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const oldBox = await f.point(340, 100);
  await expect
    .poll(() =>
      f.stage.evaluate((c: HTMLCanvasElement, p) => {
        const r = c.getBoundingClientRect();
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(((p.x - r.left) * c.width) / r.width),
              Math.round(((p.y - r.top) * c.height) / r.height),
              1,
              1,
            ).data,
        );
      }, oldBox),
    )
    .toEqual([255, 255, 255, 255]);
  await page.screenshot({ path: test.info().outputPath('text-editing.png') });
  const before = await ink();
  expect(before.count).toBeGreaterThan(900);
  await f.editor.focus();
  await f.done();
  await expect.poll(ink).toEqual(before);
  const t = (await f.read()).layers[0].keys[0].shapes[0].text!;
  expect(t.size).toBe(32);
  expect(t.runs).toContainEqual({ start: 0, end: 2, style: { size: 48 } });
});

test('Shift-click and backwards keyboard selection retain the original anchor', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('Home');
  await f.editor.press('ArrowRight');
  await f.editor.press('ArrowRight');
  const offset = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = '32px monospace';
    return c.measureText('Hello wo').width;
  });
  const q = await f.point(100 + offset, 115);
  await page.keyboard.down('Shift');
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up('Shift');
  const selected = () =>
    f.editor.evaluate((e: HTMLTextAreaElement) => {
      const t = e as HTMLTextAreaElement;
      return t.value.slice(t.selectionStart, t.selectionEnd);
    });
  await expect.poll(selected).toBe('llo wo');
  await f.editor.press('Home');
  await f.editor.press('End');
  await f.editor.press('Shift+Home');
  await expect.poll(selected).toBe('Hello world');
  await f.editor.press('Shift+Escape');
  expect(await f.read()).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('text handle double-click switches expanding and wrapping modes without changing font scale', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  const handle = await f.point(340, 100);
  await page.mouse.dblclick(handle.x, handle.y);
  await f.done();
  const fixed = (await f.read()).layers[0].keys[0].shapes[0];
  expect(fixed.text?.wrapWidth).toBe(240);
  expect(fixed.text?.size).toBe(32);
  await f.click(125, 115);
  await page.mouse.dblclick(handle.x, handle.y);
  await f.done();
  const extending = (await f.read()).layers[0].keys[0].shapes[0];
  expect(extending.text?.wrapWidth).toBe(0);
  expect(extending.text?.size).toBe(32);
  expect(extending.width).toBeLessThan(240);
});

test('composition blocks navigation until completion and keeps grapheme content', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.evaluate((e: HTMLTextAreaElement) =>
    e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })),
  );
  await f.editor.fill('你好 👩‍💻');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await expect(f.editor).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('composition');
  expect(await f.read()).toEqual(f.p);
  await f.editor.evaluate((e: HTMLTextAreaElement) =>
    e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好 👩‍💻' })),
  );
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].text?.content).toBe('你好 👩‍💻');
});

test('actual source changes keep the text draft unpublished and separately undoable', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('Control+a');
  await page.keyboard.type('Draft survives');
  await page.getByLabel('Layer name', { exact: true }).evaluate((el) => {
    const i = el as HTMLInputElement;
    i.value = 'Independent edit';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.editor.press('Escape');
  await expect(f.editor).toHaveValue('Draft survives');
  await expect(page.getByRole('alert')).toContainText('original text source');
  const expected = structuredClone(f.p);
  expected.layers[0].name = 'Independent edit';
  expect(await f.read()).toEqual(expected);
  await f.editor.press('Shift+Escape');
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('a real input edit during finish cloning rejects stale publication and permits a fresh retry', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('Control+a');
  await page.keyboard.type('Stale text');
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { textHook: number }).textHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options);
      if (
        (value as Vector)?.text?.content === 'Stale text' &&
        !(window as unknown as { textHook: number }).textHook
      ) {
        (window as unknown as { textHook: number }).textHook++;
        const el = document.querySelector(
          'textarea[aria-label="Edit text on canvas"]',
        ) as HTMLTextAreaElement;
        el.value = 'Fresh text';
        el.setSelectionRange(10, 10);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
      return out;
    };
  });
  await f.editor.press('Escape');
  expect(await page.evaluate(() => (window as unknown as { textHook: number }).textHook)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect(f.editor).toHaveValue('Fresh text');
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].text?.content).toBe('Fresh text');
});

test('left text-width reflow preserves the opposite edge under a reflected affine basis', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(315, 115);
  const a = await f.point(350, 100),
    b = await f.point(330, 102);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await f.done();
  const out = await f.read(),
    v = out.layers[0].keys[0].shapes[0];
  expect(v.x).toBeCloseTo(330);
  expect(v.y).toBeCloseTo(102);
  expect(v.width).toBeCloseTo(220);
  expect(v.transform).toEqual(f.text.transform);
  expect(v.text!.size).toBe(32);
  expect(v.x - v.width).toBeCloseTo(110);
  expect(v.y + 0.1 * v.width).toBeCloseTo(124);
  expect(out.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
});

test('returning a width drag and native capture loss restore the exact original without history', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  const a = await f.point(340, 100),
    b = await f.point(400, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.mouse.up();
  await f.done();
  expect(await f.read()).toEqual(f.p);
  await f.click(125, 115);
  const root = page.getByRole('region', { name: 'On-canvas text editing', exact: true });
  await root.evaluate((el) =>
    el.addEventListener(
      'pointerdown',
      (e) => ((el as HTMLElement).dataset.pointer = String((e as PointerEvent).pointerId)),
      { once: true },
    ),
  );
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await root.evaluate((el) =>
    (el as HTMLElement).releasePointerCapture(Number((el as HTMLElement).dataset.pointer)),
  );
  await page.mouse.up();
  await f.done();
  expect(await f.read()).toEqual(f.p);
});

test('an overflowing final width delivery restores the complete original instead of a valid intermediate resize', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  const root = page.getByRole('region', { name: 'On-canvas text editing', exact: true });
  await root.evaluate((el) =>
    el.addEventListener(
      'pointerdown',
      (e) => ((el as HTMLElement).dataset.pointer = String((e as PointerEvent).pointerId)),
      { once: true },
    ),
  );
  const a = await f.point(340, 100),
    b = await f.point(400, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await root.evaluate((el) =>
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: Number((el as HTMLElement).dataset.pointer),
        clientX: 1e9,
        clientY: 100,
        buttons: 1,
        bubbles: true,
      }),
    ),
  );
  await expect(root.getByRole('alert')).toContainText('geometry limits');
  await page.mouse.up();
  await f.done();
  expect(await f.read()).toEqual(f.p);
});

test('oversized raw text input is rejected as a whole and a fresh valid edit still succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.fill('x'.repeat(10001));
  await expect(f.editor).toHaveValue('Hello world');
  await expect(page.getByRole('alert')).toContainText('10,000');
  expect(await f.read()).toEqual(f.p);
  await f.editor.fill('Valid retry');
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].text?.content).toBe('Valid retry');
});

test('a real viewport change cancels text resizing and foreign pointer entry cannot replace its owner', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  const root = page.getByRole('region', { name: 'On-canvas text editing', exact: true }),
    a = await f.point(340, 100),
    b = await f.point(400, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.mouse.move(b.x + 1, b.y);
  await expect(root.getByRole('alert')).toContainText('view changed');
  await page.mouse.up();
  await f.done();
  expect(await f.read()).toEqual(f.p);
  await f.click(125, 115);
  const fresh = page.getByRole('region', { name: 'On-canvas text editing', exact: true }),
    start = await f.point(340, 100),
    end = await f.point(400, 100);
  await fresh.evaluate((el) =>
    el.addEventListener(
      'pointerdown',
      (e) => ((el as HTMLElement).dataset.pointer = String((e as PointerEvent).pointerId)),
      { once: true },
    ),
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await fresh.evaluate((el) =>
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: Number((el as HTMLElement).dataset.pointer) + 7,
        isPrimary: false,
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    ),
  );
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].width).toBeCloseTo(300);
});

test('resize capture rejects a real input edit during cloning and keeps the authoritative text', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { captureHook: number }).captureHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options);
      if (
        (value as Vector)?.text?.content === 'Hello world' &&
        !(window as unknown as { captureHook: number }).captureHook
      ) {
        (window as unknown as { captureHook: number }).captureHook++;
        const el = document.querySelector(
          'textarea[aria-label="Edit text on canvas"]',
        ) as HTMLTextAreaElement;
        el.value = 'Authoritative input';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
      return out;
    };
  });
  const a = await f.point(340, 100);
  await page.mouse.click(a.x, a.y);
  expect(
    await page.evaluate(() => (window as unknown as { captureHook: number }).captureHook),
  ).toBe(1);
  await expect(f.editor).toHaveValue('Authoritative input');
  expect(await f.read()).toEqual(f.p);
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].text?.content).toBe('Authoritative input');
});

test('a changed detached text copy is rejected and a fresh finish keeps the actual input', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.fill('Intended text');
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { copyHook: number }).copyHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options);
      if (
        (value as Vector)?.text?.content === 'Intended text' &&
        !(window as unknown as { copyHook: number }).copyHook
      ) {
        (window as unknown as { copyHook: number }).copyHook++;
        (out as Vector).text!.content = 'Unexpected copy';
      }
      return out;
    };
  });
  await f.editor.press('Escape');
  await expect(page.getByRole('alert')).toContainText('copy changed');
  expect(await f.read()).toEqual(f.p);
  await expect(f.editor).toHaveValue('Intended text');
  await f.done();
  expect((await f.read()).layers[0].keys[0].shapes[0].text?.content).toBe('Intended text');
});

test('caret properties style only future typing, read the current characters and retain one document Undo', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('End');
  await page.getByLabel('Text size', { exact: true }).fill('48');
  await page.getByLabel('Text size', { exact: true }).press('Tab');
  await f.editor.focus();
  await page.keyboard.type('X');
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('48');
  await f.editor.press('Control+z');
  await expect(f.editor).toHaveValue('Hello world');
  await f.editor.press('Control+Shift+z');
  await expect(f.editor).toHaveValue('Hello worldX');
  await f.editor.press('Home');
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('32');
  await f.done();
  const out = await f.read(),
    t = out.layers[0].keys[0].shapes[0].text!;
  expect(t.size).toBe(32);
  expect(t.runs).toContainEqual({ start: 11, end: 12, style: { size: 48 } });
  expect(out.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('mixed selection readouts and character color change selected text without losing the range', async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('Control+a');
  expect(
    await page
      .getByLabel('Text italic', { exact: true })
      .evaluate((e: HTMLInputElement) => e.indeterminate),
  ).toBe(true);
  await page.getByLabel('Text color', { exact: true }).fill('#00aa00');
  await f.editor.focus();
  expect(
    await f.editor.evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]),
  ).toEqual([0, 11]);
  await f.editor.press('Home');
  await f.editor.press('Shift+ArrowRight');
  await f.editor.press('Shift+ArrowRight');
  await page.getByLabel('Text size', { exact: true }).fill('48');
  await page.getByLabel('Text size', { exact: true }).press('Tab');
  await f.editor.focus();
  await f.editor.press('Control+a');
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('');
  await f.done();
  const out = await f.read(),
    v = out.layers[0].keys[0].shapes[0];
  expect(v.fill).toBe(f.text.fill);
  expect(v.text!.runs!.every((r) => r.style.color === '#00aa00')).toBe(true);
  expect(v.text!.runs!.some((r) => r.start === 6 && r.style.italic)).toBe(true);
});

test('shorter native replacement inherits the selected characters and local Undo restores their selection', async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('End');
  for (let i = 0; i < 5; i++) await f.editor.press('Shift+ArrowLeft');
  await page.keyboard.type('X');
  await expect(f.editor).toHaveValue('Hello X');
  await expect(page.getByLabel('Text italic', { exact: true })).toBeChecked();
  await f.editor.press('Control+z');
  await expect(f.editor).toHaveValue('Hello world');
  expect(
    await f.editor.evaluate((e: HTMLTextAreaElement) => [
      e.selectionStart,
      e.selectionEnd,
      e.selectionDirection,
    ]),
  ).toEqual([6, 11, 'backward']);
  await f.editor.press('Control+Shift+z');
  await f.done();
  const t = (await f.read()).layers[0].keys[0].shapes[0].text!;
  expect(t.runs).toContainEqual({ start: 6, end: 7, style: { italic: true, color: '#0000ff' } });
});

test('backward mouse selection extends from its original anchor with Shift and triple click selects the paragraph', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  // Match the native painter's actual installed monospace metrics, not a platform font guess.
  const advance = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = '32px monospace';
    return c.measureText('Hello wo').width;
  });
  const prefix = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = '32px monospace';
    return c.measureText('Hel').width;
  });
  const a = await f.point(100 + advance, 118),
    b = await f.point(100 + prefix, 118);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  expect(
    await f.editor.evaluate((e: HTMLTextAreaElement) => [
      e.selectionStart,
      e.selectionEnd,
      e.selectionDirection,
    ]),
  ).toEqual([3, 8, 'backward']);
  await f.editor.press('Shift+ArrowLeft');
  expect(
    await f.editor.evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]),
  ).toEqual([2, 8]);
  const p = await f.point(140, 118);
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  expect(
    await f.editor.evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]),
  ).toEqual([0, 11]);
  await f.editor.press('Shift+Escape');
  expect(await f.read()).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('vertical caret navigation retains its original column across a shorter line', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.fill('abcdefghij\nx\nabcdefghij');
  await f.editor.press('Control+Home');
  for (let i = 0; i < 8; i++) await f.editor.press('ArrowRight');
  await f.editor.press('ArrowDown');
  expect(await f.editor.evaluate((e: HTMLTextAreaElement) => e.selectionStart)).toBe(12);
  await f.editor.press('ArrowDown');
  expect(await f.editor.evaluate((e: HTMLTextAreaElement) => e.selectionStart)).toBe(21);
  await f.editor.press('Shift+Escape');
  expect(await f.read()).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('text handle double click switches width exactly once and Undo restores the original field', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  const h = await f.point(340, 100);
  await page.mouse.dblclick(h.x, h.y);
  await expect(page.getByLabel('Text wrap width', { exact: true })).toHaveValue('240');
  await f.editor.focus();
  await f.editor.press('Control+z');
  await expect(page.getByLabel('Text wrap width', { exact: true })).toHaveValue('0');
  await f.editor.press('Shift+Escape');
  expect(await f.read()).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('invalid pending caret attributes preserve artwork and a fresh valid typing retry succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('End');
  await page.getByLabel('Custom font family', { exact: true }).fill('bad/font');
  await page.getByLabel('Custom font family', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Invalid text run style');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Custom font family', { exact: true }).fill('Arial');
  await page.getByLabel('Custom font family', { exact: true }).press('Tab');
  await f.editor.focus();
  await page.keyboard.type('X');
  await f.done();
  const t = (await f.read()).layers[0].keys[0].shapes[0].text!;
  expect(t.font).toBe('monospace');
  expect(t.runs).toContainEqual({ start: 11, end: 12, style: { font: 'Arial' } });
  expect(f.issues).toEqual([]);
});

test('shortening Content while editing clamps the caret and finishes the exact new field once', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await f.click(125, 115);
  await f.editor.press('End');
  await page.getByLabel('Text content', { exact: true }).fill('Hi');
  await page.getByLabel('Text content', { exact: true }).press('Tab');
  await expect(f.editor).toHaveCount(0);
  const out = await f.read();
  expect(out.layers[0].keys[0].shapes[0].text!.content).toBe('Hi');
  expect(out.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
  expect(f.issues).toEqual([]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Selection-tool font attributes change the entire mixed field while preserving its colors and one Undo', async ({
  page,
}) => {
  const f = await setup(page, true, false, true);
  await f.click(125, 115);
  await page.getByLabel('Text size', { exact: true }).fill('48');
  await page.getByLabel('Text size', { exact: true }).press('Tab');
  const out = await f.read(),
    t = out.layers[0].keys[0].shapes[0].text!;
  expect(t.size).toBe(48);
  expect(t.runs).toEqual([{ start: 6, end: 11, style: { italic: true, color: '#0000ff' } }]);
  await page.getByLabel('Text color', { exact: true }).fill('#00aa00');
  const colored = await f.read();
  expect(colored.layers[0].keys[0].shapes[0].fill).toBe('#00aa00');
  expect(colored.layers[0].keys[0].shapes[0].text!.runs).toEqual([
    { start: 6, end: 11, style: { italic: true } },
  ]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(out);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.issues).toEqual([]);
});
