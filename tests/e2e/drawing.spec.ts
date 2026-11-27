import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from '../../packages/document/src';

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
test('real browser pen events render pressure widths and persist them through save/reopen/export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('48');
  const box = (await page.getByLabel('Drawing stage').boundingBox())!,
    x = box.x + 350,
    y = box.y + 220;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'pen',
    force: 0.15,
    tiltX: 20,
    tiltY: 10,
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x + i * 20,
      y,
      button: 'left',
      buttons: 1,
      pointerType: 'pen',
      force: i < 5 ? 0.15 : 0.9,
      tiltX: 20,
      tiltY: 10,
    });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x + 200,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'pen',
    force: 0,
  });
  const thickness = await page.getByLabel('Drawing stage').evaluate(
    (c, pt) => {
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      const count = (x: number) => {
        const pixels = ctx.getImageData(x, pt.y - 40, 1, 80).data;
        let n = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 190 && pixels[i + 1] < 160 && pixels[i + 2] > 180) n++;
        return n;
      };
      return { low: count(pt.x + 30), high: count(pt.x + 170) };
    },
    { x: 350, y: 220 },
  );
  expect(thickness.low).toBeGreaterThan(2);
  expect(thickness.high).toBeGreaterThan(thickness.low * 2);
  // Raster feedback precedes asynchronous vector publication; Undo must own the committed stroke.
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/0 objects at frame 1/)).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+s');
  const name = `Pressure-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  const root = path.resolve(process.env.SPLASH_PROJECTS || '.e2e-projects', name + '.spl'),
    manifest = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'));
  expect(manifest.schemaVersion).toBe(59);
  const vectors = JSON.parse(await fs.readFile(path.join(root, manifest.vectors), 'utf8'));
  const shape = Object.values(vectors)[0] as {
    kind: string;
    points: { pressure: number; tiltX: number }[];
  }[];
  expect(shape[0].kind).toBe('brush');
  expect(shape[0].points[0].pressure).toBeCloseTo(0.15);
  expect(shape[0].points.at(-1)!.pressure).toBeCloseTo(0.9);
  expect(shape[0].points[0].tiltX).toBe(20);
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('dialog', { name: 'Open project' })).toBeHidden();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Selected stroke pressure')).toBeChecked();
  const downloaded = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const file = await downloaded,
    files = await readWebDownload(file);
  const exported = await page.context().newPage();
  exported.on('pageerror', (e) => errors.push(e.message));
  await openWebExport(exported, files);
  await expect(exported.locator('canvas')).toBeVisible();
  await expect
    .poll(() =>
      exported.locator('canvas').evaluate((c) => {
        const ctx = (c as HTMLCanvasElement).getContext('2d')!,
          data = ctx.getImageData(0, 0, 960, 540).data;
        let colored = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 190 && data[i + 1] < 160 && data[i + 2] > 180) colored++;
        return colored;
      }),
    )
    .toBeGreaterThan(1500);
  expect(errors).toEqual([]);
  await cdp.detach();
  await exported.close();
});

test('Bézier anchors and handles remain editable, with a single undo per node drag', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Drawing mode', exact: true }).selectOption('object');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.mouse.click(b.x + 320, b.y + 220);
  await drag(page, { x: b.x + 450, y: b.y + 150 }, { x: b.x + 490, y: b.y + 150 });
  await page.mouse.click(b.x + 570, b.y + 250);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const before = await read();
  await drag(page, { x: b.x + 450, y: b.y + 150 }, { x: b.x + 450, y: b.y + 110 });
  const after = await read();
  expect(after.layers[0].keys[0].shapes).not.toEqual(before.layers[0].keys[0].shapes);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('rounded shapes, text, bucket, eyedropper, eraser and cancellation perform real edits', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Drawing mode', exact: true }).selectOption('object');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByRole('button', { name: 'Rounded rectangle', exact: true }).click();
  await drag(page, { x: b.x + 320, y: b.y + 160 }, { x: b.x + 490, y: b.y + 280 });
  await expect(page.getByLabel('Selected corner radius')).toHaveValue('20');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff2200');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await page.mouse.click(b.x + 400, b.y + 220);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes[0].fill).toBe('#ff2200');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#000000');
  await page.getByRole('button', { name: 'Eyedropper', exact: true }).click();
  await page.mouse.click(b.x + 400, b.y + 220);
  await expect(page.getByLabel('Drawing fill', { exact: true })).toHaveValue('#ff2200');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(b.x + 550, b.y + 180);
  const text = page.getByLabel('Edit text on canvas', { exact: true });
  await text.fill('Editable type');
  await text.press('Tab');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.at(-1)?.text?.content).toBe('Editable type');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser mode').selectOption('objects');
  await page.mouse.click(b.x + 400, b.y + 220);
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/2 objects at frame 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page
    .getByLabel('Drawing stage')
    .evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => c.setAttribute('data-test-pointer', String((e as PointerEvent).pointerId)),
        { once: true },
      ),
    );
  await page.mouse.move(b.x + 300, b.y + 320);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + 390);
  await page.getByLabel('Drawing stage').evaluate((c) =>
    c.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: Number(c.getAttribute('data-test-pointer')),
        bubbles: true,
      }),
    ),
  );
  await page.mouse.up();
  await expect(page.getByText(/2 objects at frame 1/)).toBeVisible();
});
test('merge mode joins fills, cuts nested regions, and keeps the cut after deleting the top color', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, { x: b.x + 300, y: b.y + 140 }, { x: b.x + 500, y: b.y + 340 });
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await drag(page, { x: b.x + 400, y: b.y + 140 }, { x: b.x + 600, y: b.y + 340 });
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#22cc88');
  await drag(page, { x: b.x + 400, y: b.y + 190 }, { x: b.x + 500, y: b.y + 280 });
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(page.getByText(/2 objects at frame 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(b.x + 450, b.y + 235);
  await expect(page.getByLabel('Selected fill')).toHaveValue('#22cc88');
  await page.keyboard.press('Delete');
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  const pixel = await page
    .getByLabel('Drawing stage')
    .evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(450, 235, 1, 1).data),
    );
  expect(pixel).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/2 objects at frame 1/)).toBeVisible();
});
test('filled-vector eraser produces a genuine transparent cut and undo restores it', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, { x: b.x + 300, y: b.y + 150 }, { x: b.x + 550, y: b.y + 350 });
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser diameter').fill('60');
  await page.mouse.click(b.x + 420, b.y + 240);
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await page.mouse.move(b.x + 50, b.y + 50);
  const pixel = () =>
    page
      .getByLabel('Drawing stage')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(420, 240, 1, 1).data),
      );
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+z');
  await expect.poll(pixel).toEqual([109, 94, 252, 255]);
});
