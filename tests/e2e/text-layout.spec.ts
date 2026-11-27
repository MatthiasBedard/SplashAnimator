import { exportHtmlFromShortcut } from './export-settings';
import { test, expect } from '@playwright/test';
import { openWebExport, readWebDownload } from './web-export-files';
import type { Project } from '../../packages/document/src';
test('text spacing changes exported ink bounds and remains undoable', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 300, b.y + 180);
  await page.getByLabel('Text content').fill('MMMM\nMMMM');
  await page.getByLabel('Text content').press('Tab');
  await page.getByLabel('Selected fill').fill('#000000');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  async function ink() {
    const d = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const files = await readWebDownload(await d),
      out = await page.context().newPage();
    await openWebExport(out, files);
    const result = await out.locator('canvas').evaluate((c) => {
      const canvas = c as HTMLCanvasElement,
        data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let l = canvas.width,
        r = 0,
        t = canvas.height,
        b = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) {
            l = Math.min(l, x);
            r = Math.max(r, x);
            t = Math.min(t, y);
            b = Math.max(b, y);
          }
        }
      return { width: r - l, height: b - t };
    });
    await out.close();
    return result;
  }
  const before = await ink();
  await page.getByLabel('Custom font family').fill('Arial, sans-serif');
  await page.getByLabel('Custom font family').press('Tab');
  await page.getByLabel('Text line spacing').fill('240');
  await page.getByLabel('Text line spacing').press('Tab');
  await page.getByLabel('Text letter spacing').fill('10');
  await page.getByLabel('Text letter spacing').press('Tab');
  const edited = await read(),
    after = await ink();
  expect(edited.schemaVersion).toBe(59);
  expect(after.width).toBeGreaterThan(before.width + 20);
  expect(after.height).toBeGreaterThan(before.height + 20);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect((await read()).layers[0].keys[0].shapes[0].text?.letterSpacing).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(edited);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Text wrap width').fill('80');
  await page.getByLabel('Text wrap width').press('Tab');
  const wrapped = await read(),
    wrappedInk = await ink();
  expect(wrapped.layers[0].keys[0].shapes[0].text!.content).toBe('MMMM\nMMMM');
  expect(wrapped.layers[0].keys[0].shapes[0].width).toBe(80);
  expect(wrappedInk.width).toBeLessThan(after.width * 0.7);
  expect(wrappedInk.height).toBeGreaterThan(after.height * 1.5);
  await page.getByLabel('Shape W', { exact: true }).fill('160');
  await canvas.focus();
  const scaledInk = await ink();
  expect(scaledInk.width).toBeGreaterThan(wrappedInk.width * 1.8);
  expect(Math.abs(scaledInk.height - wrappedInk.height)).toBeLessThanOrEqual(1);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(wrapped);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(edited);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const rich of [false, true])
  test(`transformed ${rich ? 'rich' : 'plain'} text gradients preserve glyphs and export the independent paint basis`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const canvas = page.getByLabel('Drawing stage'),
      b = (await canvas.boundingBox())!;
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.mouse.click(b.x + 300, b.y + 180);
    const canvasInput = page.getByLabel('Edit text on canvas', { exact: true });
    await expect(canvasInput).toBeFocused();
    await page.keyboard.insertText('MMMM MMMM');
    await canvasInput.press('Escape');
    await expect(canvasInput).toHaveCount(0);
    await page.getByLabel('Text size', { exact: true }).fill('80');
    await page.getByLabel('Text size', { exact: true }).press('Tab');
    await page.getByLabel('Text wrap width').fill('260');
    await page.getByLabel('Text wrap width').press('Tab');
    await page.getByLabel('Text alignment').selectOption('center');
    await page.getByLabel('Shape W', { exact: true }).fill('390');
    await canvas.focus();
    await page.getByLabel('Selected fill').fill('#000000');
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes[0],
      );
    if (rich) {
      await page.getByLabel('Text content').evaluate((el) => {
        const t = el as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(0, 2);
        t.dispatchEvent(new Event('select', { bubbles: true }));
      });
      await page.getByText('Selected text formatting', { exact: true }).click();
      await page.getByRole('button', { name: 'Italic selection', exact: true }).click();
      await page.getByLabel('Range size', { exact: true }).fill('60');
      await page.getByRole('button', { name: 'Apply range size', exact: true }).click();
    }
    let out = await page.context().newPage();
    async function exportText() {
      await out.close();
      out = await page.context().newPage();
      const d = page.waitForEvent('download');
      await exportHtmlFromShortcut(page);
      await openWebExport(out, await readWebDownload(await d));
    }
    await exportText();
    const samples = await out.locator('canvas').evaluate((c) => {
      const canvas = c as HTMLCanvasElement,
        data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const points: { x: number; y: number }[] = [];
      for (let y = 0; y < canvas.height; y += 3)
        for (let x = 0; x < canvas.width; x += 3) {
          const i = (y * canvas.width + x) * 4;
          if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) points.push({ x, y });
        }
      return points;
    });
    expect(samples.length).toBeGreaterThan(200);
    await page.getByLabel('Fill type').selectOption('radial');
    await page.getByLabel('Gradient color 1').fill('#ff0000');
    await page.getByLabel('Gradient color 2').fill('#0000ff');
    const before = await read();
    await page.getByText('Gradient transform', { exact: true }).click();
    await page.getByLabel('Gradient aspect', { exact: true }).fill('50');
    await page.getByLabel('Gradient skew', { exact: true }).fill('30');
    await page.getByRole('button', { name: 'Apply gradient shape', exact: true }).click();
    const shape = await read();
    expect(shape.gradient!.transform).toEqual([1, 0, Math.tan(Math.PI / 6), 0.5]);
    expect({ ...shape, gradient: before.gradient }).toEqual(before);
    await exportText();
    const result = await out.locator('canvas').evaluate(
      (element, { samples, shape }) => {
        const ctx = (element as HTMLCanvasElement).getContext('2d')!,
          g = shape.gradient!,
          [a, b, c, d] = g.transform!,
          det = a * d - b * c,
          r = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y);
        let error = 0,
          missing = 0;
        for (const p of samples) {
          const pixel = ctx.getImageData(p.x, p.y, 1, 1).data,
            dx = p.x + 0.5 - shape.x - g.from.x,
            dy = p.y + 0.5 - shape.y - g.from.y;
          const t = Math.min(1, Math.hypot((d * dx - c * dy) / det, (a * dy - b * dx) / det) / r);
          error += Math.abs(pixel[0] - 255 * (1 - t)) + Math.abs(pixel[2] - 255 * t);
          if (pixel[1] > 3) missing++;
        }
        return { error: error / samples.length, missing };
      },
      { samples, shape },
    );
    expect(result.missing).toBe(0);
    expect(result.error).toBeLessThan(3);
    if (rich) {
      const output = await out.locator('canvas').evaluate((node: HTMLCanvasElement, points) => ({
        width: node.width,
        height: node.height,
        colors: points.map(p => Array.from(node.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data)),
      }), samples);
      const stageError = await canvas.evaluate((node: HTMLCanvasElement, { points, output }) => {
        const ctx = node.getContext('2d')!;
        const left = Math.round((node.width - output.width) / 2);
        const top = Math.round((node.height - output.height) / 2);
        return points.reduce((sum, p, i) => {
          const actual = ctx.getImageData(left + p.x, top + p.y, 1, 1).data;
          return sum + [...actual].reduce((err, channel, j) => err + Math.abs(channel - output.colors[i][j]), 0);
        }, 0) / points.length;
      }, { points: samples, output });
      expect(stageError).toBeLessThan(7);
      await canvas.press('Control+Enter');
      const movie = page.getByRole('dialog', { name: 'Test movie' });
      await expect(movie.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
      await expect.poll(async () => {
        const png = (await movie.locator('canvas').screenshot()).toString('base64');
        return out.evaluate(async ({ png, points, output }) => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + png;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = output.width;
          canvas.height = output.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          return points.reduce((sum, p, i) => {
            const actual = ctx.getImageData(p.x, p.y, 1, 1).data;
            return sum + [...actual].reduce((err, channel, j) => err + Math.abs(channel - output.colors[i][j]), 0);
          }, 0) / points.length;
        }, { png, points: samples, output });
      }).toBeLessThan(12);
      await movie.getByRole('button', { name: 'Close ×' }).click();
    }
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(shape);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await out.close();
  });

test('text direction kerning and word spacing match explicit Canvas layout and undo', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 280, b.y + 170);
  for (const [label, value] of [
    ['Text content', 'אבג AV AV'],
    ['Text size', '60'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const before = await read();
  await page.getByLabel('Text word spacing', { exact: true }).fill('18');
  await page.getByLabel('Text word spacing', { exact: true }).press('Tab');
  expect((await read()).width).toBeGreaterThan(before.width + 25);
  await page.getByLabel('Text direction', { exact: true }).selectOption('rtl');
  await page.getByLabel('Text kerning', { exact: true }).selectOption('none');
  const s = await read();
  expect(s.text).toMatchObject({ wordSpacing: 18, direction: 'rtl', kerning: 'none' });
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(await download));
  const result = await out.locator('canvas').evaluate((canvas, s) => {
    const actual = canvas as HTMLCanvasElement;
    const ref = document.createElement('canvas');
    ref.width = actual.width;
    ref.height = actual.height;
    const ctx = ref.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ref.width, ref.height);
    const t = s.text!;
    ctx.translate(s.x, s.y);
    ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
    ctx.direction = 'rtl';
    ctx.fontKerning = 'none';
    ctx.wordSpacing = '18px';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = s.fill;
    ctx.fillText(t.content, 0, 0);
    const a = actual.getContext('2d')!.getImageData(0, 0, ref.width, ref.height).data,
      r = ctx.getImageData(0, 0, ref.width, ref.height).data;
    let error = 0,
      ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      error +=
        Math.abs(a[i] - r[i]) + Math.abs(a[i + 1] - r[i + 1]) + Math.abs(a[i + 2] - r[i + 2]);
      if (r[i] < 240) ink++;
    }
    return { error, ink };
  }, s);
  expect(result.ink).toBeGreaterThan(500);
  expect(result.error).toBe(0);
  await out.close();
  await stage.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

test('selected text edits preserve surrounding content, layout history and graphemes', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 280, b.y + 170);
  const input = page.getByLabel('Text content', { exact: true });
  await input.fill('A straße Z');
  await input.press('Tab');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const before = await read();
  const select = async (start: number, end: number) =>
    input.evaluate(
      (el, { start, end }) => {
        const field = el as HTMLTextAreaElement;
        field.focus();
        field.setSelectionRange(start, end);
        field.dispatchEvent(new Event('select', { bubbles: true }));
      },
      { start, end },
    );
  await select(2, 8);
  await page.getByRole('button', { name: 'Uppercase selection', exact: true }).click();
  expect((await read()).text!.content).toBe('A STRASSE Z');
  expect((await read()).width).toBeGreaterThan(before.width);
  await page.getByRole('button', { name: 'Lowercase selection', exact: true }).click();
  expect((await read()).text!.content).toBe('A strasse Z');
  await page.getByRole('button', { name: 'Duplicate selected text', exact: true }).click();
  expect((await read()).text!.content).toBe('A strassestrasse Z');
  await page.getByRole('button', { name: 'Delete selected text', exact: true }).click();
  expect((await read()).text!.content).toBe('A  Z');
  await expect(
    page.getByRole('button', { name: 'Uppercase selection', exact: true }),
  ).toBeDisabled();
  await stage.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+a');
  await input.fill('A👩‍👩‍👧‍👦éZ');
  await input.press('Tab');
  await select(2, 4);
  await page.getByRole('button', { name: 'Delete selected text', exact: true }).click();
  expect((await read()).text!.content).toBe('AéZ');
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect((await read()).text!.content).toBe('A👩‍👩‍👧‍👦éZ');
  await page.keyboard.press('Control+a');
  await expect(
    page.getByRole('button', { name: 'Delete selected text', exact: true }),
  ).toBeDisabled();
});

test('selected range styles render in export and WebGL and survive editing and undo', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 250, b.y + 180);
  const field = page.getByLabel('Text content', { exact: true });
  const canvasInput = page.getByLabel('Edit text on canvas', { exact: true });
  await expect(canvasInput).toBeFocused();
  await page.keyboard.insertText('MMMM small');
  await expect(field).toHaveValue('MMMM small');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await field.evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(0, 4);
    t.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect.poll(() => canvasInput.evaluate((node: HTMLTextAreaElement) => [
    node.selectionStart, node.selectionEnd,
  ])).toEqual([0, 4]);
  await page.getByText('Selected text formatting', { exact: true }).click();
  await page.getByRole('button', { name: 'Bold selection', exact: true }).click();
  await page.getByLabel('Range size', { exact: true }).fill('64');
  await page.getByRole('button', { name: 'Apply range size', exact: true }).click();
  await page.getByLabel('Range color', { exact: true }).fill('#ff0000');
  await page.getByRole('button', { name: 'Apply range color', exact: true }).click();
  await canvasInput.press('Escape');
  await expect(canvasInput).toHaveCount(0);
  await page.getByLabel('Selected fill', { exact: true }).fill('#000000');
  const styled = await read();
  expect(styled.text!.runs).toEqual([
    { start: 0, end: 4, style: { bold: true, size: 64, color: '#ff0000' } },
  ]);
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const out = await page.context().newPage();
  const errors: string[] = [];
  out.on('pageerror', (e) => errors.push(e.message));
  await openWebExport(out, await readWebDownload(await download));
  const ink = () =>
    out.locator('canvas').evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0,
        dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] < 20) red++;
        if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++;
      }
      return { red, dark };
    });
  await expect.poll(async () => (await ink()).red).toBeGreaterThan(500);
  expect((await ink()).dark).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  await stage.focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  const png = await page.getByRole('dialog', { name: 'Test movie' }).locator('canvas').screenshot();
  const red = await out.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] > 240 && p[i + 1] < 20 && p[i + 2] < 20) n++;
    return n;
  }, png.toString('base64'));
  expect(red).toBeGreaterThan(500);
  await page.keyboard.press('Escape');
  await stage.focus();
  await page.keyboard.press('Control+a');
  await field.fill('MMMM small!');
  await field.press('Tab');
  expect((await read()).text!.runs).toEqual(styled.text!.runs);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(styled);
  await page.keyboard.press('Control+a');
  await page.getByText('Selected text formatting', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear all range formatting', exact: true }).click();
  expect((await read()).text!.runs).toEqual([]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(styled);
  await out.close();
});

test('range spacing changes measured and exported width, inherits base spacing and preserves history', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 240, b.y + 160);
  const canvasInput = page.getByLabel('Edit text on canvas', { exact: true });
  await expect(canvasInput).toBeFocused();
  await page.keyboard.insertText('AV AV tail');
  await canvasInput.press('Escape');
  await expect(canvasInput).toHaveCount(0);
  const input = page.getByLabel('Text content', { exact: true });
  await page.getByLabel('Selected fill', { exact: true }).fill('#000000');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const select = () =>
    input.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      t.focus();
      t.setSelectionRange(0, 5);
      t.dispatchEvent(new Event('select', { bubbles: true }));
    });
  await select();
  await page.getByText('Selected text formatting', { exact: true }).click();
  await page.getByRole('button', { name: 'Bold selection', exact: true }).click();
  const before = await read();
  for (const [label, value] of [
    ['Range letter spacing', '8'],
    ['Range word spacing', '20'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Apply ' + label.toLowerCase(), exact: true }).click();
  }
  await page.getByLabel('Range kerning', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Apply range kerning', exact: true }).click();
  const after = await read();
  expect(after.text!.runs![0].style).toEqual({
    bold: true,
    letterSpacing: 8,
    wordSpacing: 20,
    kerning: 'none',
  });
  expect(after.width).toBeGreaterThan(before.width + 45);
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(await download));
  const difference = await out.locator('canvas').evaluate((el, s) => {
    const canvas = el as HTMLCanvasElement,
      ctx = canvas.getContext('2d')!;
    const ref = document.createElement('canvas');
    ref.width = canvas.width;
    ref.height = canvas.height;
    const c = ref.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, ref.width, ref.height);
    c.fillStyle = '#000000';
    c.textBaseline = 'alphabetic';
    c.font = `bold ${s.text!.size}px ${s.text!.font}`;
    const base = c.measureText('Mg'),
      baseline =
        s.y +
        (base.fontBoundingBoxAscent + base.fontBoundingBoxDescent) * 0.1 +
        base.fontBoundingBoxAscent;
    c.letterSpacing = '8px';
    c.wordSpacing = '20px';
    c.fontKerning = 'none';
    const advance = c.measureText('AV AV').width;
    c.fillText('AV AV', s.x, baseline);
    c.font = `${s.text!.size}px ${s.text!.font}`;
    c.letterSpacing = '0px';
    c.wordSpacing = '0px';
    c.fontKerning = 'auto';
    c.fillText(' tail', s.x + advance, baseline);
    const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      d = c.getImageData(0, 0, canvas.width, canvas.height).data;
    let error = 0,
      ink = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] < 240 || d[i] < 240) {
        error += Math.abs(a[i] - d[i]);
        ink++;
      }
    }
    return { error: error / ink, ink };
  }, after);
  expect(difference.ink).toBeGreaterThan(100);
  expect(difference.error).toBeLessThan(8);
  await out.close();
  await page.getByLabel('Range color', { exact: true }).fill('#aa0000');
  await page.getByRole('button', { name: 'Apply range color', exact: true }).click();
  expect((await read()).text!.runs![0].style.color).toBe('#aa0000');
  await page.getByRole('button', { name: 'Inherit range paint', exact: true }).click();
  expect(await read()).toEqual(after);
  await page.getByRole('button', { name: 'Inherit range spacing', exact: true }).click();
  expect(await read()).toEqual(before);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(after);
  await page.keyboard.press('Control+a');
  await page.getByText('Selected text formatting', { exact: true }).click();
  await select();
  await page.getByRole('button', { name: 'Clear selected formatting', exact: true }).click();
  expect((await read()).text!.runs).toEqual([]);
});
