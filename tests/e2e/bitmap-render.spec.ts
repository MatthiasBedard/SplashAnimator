import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { openLibraryRecord } from './library-helpers';
import { newProject } from '../../packages/document/src';
import { bitmapHandle, type BitmapHandle } from '../../packages/geometry/src/bitmap';
import { test, expect } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
for (const mode of ['object', 'merge'])
  test(`bitmap placement, resize, export and undo in ${mode} layers`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Drawing mode').selectOption(mode);
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 16);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(8, 0, 8, 16);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
      name: 'tiles.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    await openLibraryRecord(page);
    await expect(page.getByRole('img', { name: 'tiles.png', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Place bitmap on stage', exact: true }).click();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    await expect.poll(async () => (await read()).length).toBe(1);
    await page.getByRole('option',{name:'Library item tiles.png',exact:true}).click({button:'right'});
    await expect(page.getByRole('menuitem',{name:'Delete',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');
    const stage = page.getByLabel('Drawing stage');
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByLabel('Shape W', { exact: true }).fill('160');
    await page.getByLabel('Shape W', { exact: true }).press('Tab');
    await expect.poll(async () => (await read())[0].width).toBeCloseTo(160);
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByLabel('Shape H', { exact: true }).fill('80');
    await page.getByLabel('Shape H', { exact: true }).press('Tab');
    await expect.poll(async () => (await read())[0].height).toBeCloseTo(80);
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByText('Bitmap paint transform', { exact: true }).click();
    await page.getByLabel('Bitmap paint move X', { exact: true }).fill('160');
    await page.getByLabel('Bitmap paint move Y', { exact: true }).fill('80');
    await page.getByLabel('Bitmap paint rotation', { exact: true }).fill('180');
    await page.getByRole('button', { name: 'Apply bitmap paint transform', exact: true }).click();
    await expect.poll(async () => (await read())[0].bitmap?.transform?.[0]).toBeCloseTo(-1);
    expect((await read())[0].width).toBeCloseTo(160);
    const s = (await read())[0],
      red = worldPoint(s, { x: 120, y: 40 }),
      blue = worldPoint(s, { x: 40, y: 40 });
    const download = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const d = await download;
    const files = await readWebDownload(d);
    const out = await page.context().newPage();
    await openWebExport(out, files);
    const pixel = (p: { x: number; y: number }) =>
      out
        .locator('canvas')
        .evaluate(
          (el, p) =>
            Array.from(
              (el as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data,
            ),
          p,
        );
    await expect.poll(() => pixel(red)).toEqual([255, 0, 0, 255]);
    expect(await pixel(blue)).toEqual([0, 0, 255, 255]);
    await page.bringToFront();
    await stage.focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
    const png = await page
      .getByRole('dialog', { name: 'Test movie' })
      .locator('canvas')
      .screenshot();
    const redPixels = await out.evaluate(async (encoded) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + encoded;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const p = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] > 245 && p[i + 1] < 10 && p[i + 2] < 10) count++;
      return count;
    }, png.toString('base64'));
    expect(redPixels).toBeGreaterThan(50);
    await page.keyboard.press('Escape');
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect((await read())[0].bitmap?.transform).toBeUndefined();
    await page.keyboard.press('Control+z');
    expect((await read())[0].height).toBeCloseTo(16);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await out.close();
  });

test('bitmap fill clips to vector contours and toggles native repeat', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 16, 16);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'green.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  const bitmap = page.getByRole('option', { name: 'Library item green.png', exact: true });
  await expect(bitmap).toBeVisible();
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Oval', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 460, b.y + 360);
  await page.mouse.up();
  await bitmap.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply bitmap fill', exact: true }).click();
  const s = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0]
        .shapes[0],
  );
  const center = worldPoint(s, { x: s.width / 2, y: s.height / 2 }),
    corner = worldPoint(s, { x: 1, y: 1 });
  const pixels = async () => {
    const event = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const d = await event;
    const out = await page.context().newPage();
    await openWebExport(out, await readWebDownload(d));
    const read = (p: { x: number; y: number }) =>
      out
        .locator('canvas')
        .evaluate(
          (c, p) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data,
            ),
          p,
        );
    await expect.poll(() => read(corner)).toEqual([255, 255, 255, 255]);
    const result = await read(center);
    await out.close();
    return result;
  };
  await expect.poll(pixels).toEqual([0, 255, 0, 255]);
  await page.getByRole('button', { name: 'Reset bitmap to native size', exact: true }).click();
  await expect.poll(pixels).toEqual([255, 255, 255, 255]);
  await page.getByLabel('Repeat bitmap fill', { exact: true }).check();
  await expect.poll(pixels).toEqual([0, 255, 0, 255]);
});

for (const part of ['origin', 'x', 'y'] as BitmapHandle[])
  test(`bitmap ${part} canvas handle supports affine snapping, bypass, cancellation and undo`, async ({
    page,
  }) => {
    await page.goto('/');
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 8);
      return c.toDataURL();
    });
    const project = newProject();
    project.assets = [
      {
        id: 'a',
        path: 'assets/bitmaps/a.json',
        bitmap: { name: 'red', width: 8, height: 8, dataUrl },
      },
    ];
    project.layers[0].keys[0].shapes = [
      {
        id: 's',
        kind: 'rectangle',
        x: 250,
        y: 150,
        width: 160,
        height: 120,
        rotation: 10,
        transform: [1, 0.1, 0.2, 1],
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        bitmap: { assetId: 'a', x: 10, y: 10, width: 100, height: 80 },
      },
    ];
    await page.evaluate(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      project,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const stage = page.getByLabel('Drawing stage');
    await stage.focus();
    await page.keyboard.press('Control+a');
    const before = project.layers[0].keys[0].shapes[0];
    const b = (await stage.boundingBox())!,
      zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
    const origin = { x: b.x + (b.width - 960 * zoom) / 2, y: b.y + (b.height - 540 * zoom) / 2 };
    const start = worldPoint(before, bitmapHandle(before.bitmap!, part));
    const target = {
      x: Math.round((start.x + 30) / 20) * 20,
      y: Math.round((start.y + 30) / 20) * 20,
    };
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Gradient transform', exact: true }).click();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes[0],
      );
    for (const bypass of [false, true]) {
      await stage.focus();
      await page.keyboard.press('Control+a');
      if (bypass) await page.keyboard.down('Alt');
      await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
      await page.mouse.down();
      await page.mouse.move(origin.x + (target.x + 3) * zoom, origin.y + (target.y + 3) * zoom, {
        steps: 5,
      });
      await page.mouse.up();
      if (bypass) await page.keyboard.up('Alt');
      const s = await read(),
        actual = worldPoint(s, bitmapHandle(s.bitmap!, part));
      expect(actual.x).toBeCloseTo(target.x + (bypass ? 3 : 0), 0);
      expect(actual.y).toBeCloseTo(target.y + (bypass ? 3 : 0), 0);
      expect(s.x).toBe(before.x);
      expect(s.transform).toEqual(before.transform);
      await stage.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    }
    await page.keyboard.press('Control+a');
    await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
    await page.mouse.down();
    await page.mouse.move(origin.x + target.x * zoom, origin.y + target.y * zoom);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await read()).toEqual(before);
  });

test('bitmap text fill keeps scaled wrapped glyphs and independently rotates paint with undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode').selectOption('object');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 300, b.y + 180);
  for (const [label, value] of [
    ['Text content', 'MMMM MMMM'],
    ['Text size', '70'],
    ['Text wrap width', '250'],
    ['Shape W', '400'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Tab');
  }
  await page.getByLabel('Selected fill', { exact: true }).fill('#000000');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const shape = await read();
  const exportPage = async () => {
    const d = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const out = await page.context().newPage();
    await openWebExport(out, await readWebDownload(await d));
    return out;
  };
  const baseline = await exportPage();
  const samples = await baseline.locator('canvas').evaluate((c) => {
    const ctx = (c as HTMLCanvasElement).getContext('2d')!,
      samples: { x: number; y: number }[] = [];
    for (let y = 0; y < ctx.canvas.height; y += 3)
      for (let x = 0; x < ctx.canvas.width; x += 3) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[0] === 0 && p[1] === 0 && p[2] === 0) samples.push({ x, y });
      }
    return samples;
  });
  expect(samples.length).toBeGreaterThan(200);
  await baseline.close();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(8, 0, 8, 16);
    return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'text.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await openLibraryRecord(page);
  await expect(page.getByRole('button', { name: 'Apply bitmap fill', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply bitmap fill', exact: true }).click();
  const painted = await read();
  expect(painted.text).toEqual(shape.text);
  await page.getByText('Bitmap paint transform', { exact: true }).click();
  await page.getByLabel('Bitmap paint rotation', { exact: true }).fill('180');
  await page.getByLabel('Bitmap paint move X', { exact: true }).fill(String(painted.width));
  await page.getByLabel('Bitmap paint move Y', { exact: true }).fill(String(painted.height));
  await page.getByRole('button', { name: 'Apply bitmap paint transform', exact: true }).click();
  const out = await exportPage();
  const check = () =>
    out.locator('canvas').evaluate(
      (c, { samples, shape }) => {
        const ctx = (c as HTMLCanvasElement).getContext('2d')!;
        let wrong = 0,
          count = 0;
        for (const p of samples) {
          const x = p.x + 0.5 - shape.x,
            y = p.y + 0.5 - shape.y;
          if (
            x < 20 ||
            x > shape.width - 20 ||
            Math.abs(x - shape.width / 2) < 20 ||
            y < 10 ||
            y > shape.height - 10
          )
            continue;
          const pixel = ctx.getImageData(p.x, p.y, 1, 1).data;
          const red = x > shape.width / 2;
          if (pixel[red ? 0 : 2] < 250 || pixel[1] > 3 || pixel[red ? 2 : 0] > 3) wrong++;
          count++;
        }
        return { wrong, count };
      },
      { samples, shape },
    );
  await expect.poll(async () => (await check()).wrong).toBe(0);
  expect((await check()).count).toBeGreaterThan(100);
  await out.close();
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(painted);
  await page.keyboard.press('Control+z');
  expect((await read()).bitmap).toBeUndefined();
});
