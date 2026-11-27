import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

async function placeBitmap(page: Page, held = false) {
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
  await expect(splash.or(menu)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 130, 100);
    ctx.clearRect(30, 25, 70, 50);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(130, 0, 70, 50);
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'trace-source.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  });
  const read = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as Project | undefined);
  const item = page.getByRole('option', { name: 'Library item trace-source.png', exact: true });
  await item.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Place bitmap on stage', exact: true }).click();
  if (held) {
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
  }
  await expect.poll(async () => (await read())?.layers[0].keys[0].shapes.length).toBe(1);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const dialog = page.getByRole('dialog', { name: 'Trace bitmap', exact: true });
  const open = async () => {
    await page.getByRole('button', { name: 'Trace bitmap…', exact: true }).click();
    await expect(dialog).toBeVisible();
  };
  return { read, stage, dialog, open };
}

test('traces an imported bitmap with an editable hole, explicit detail and one Apply history step', async ({ page }) => {
  const f = await placeBitmap(page), before = (await f.read())!;
  const pixels = () => f.stage.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return [[15, 15], [65, 50], [170, 20], [180, 80]].map(([x, y]) => Array.from(ctx.getImageData(
      canvas.width / 2 + (x - 100) * devicePixelRatio, canvas.height / 2 + (y - 50) * devicePixelRatio, 1, 1).data));
  });
  const colors = [[255, 0, 0, 255], [255, 255, 255, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
  await expect.poll(pixels).toEqual(colors);
  await f.open();
  const preview = f.dialog.getByLabel('Bitmap trace preview', { exact: true });
  const detail = f.dialog.getByLabel('Trace detail', { exact: true });
  const apply = f.dialog.getByRole('button', { name: 'Apply', exact: true });
  await expect(detail).toBeFocused();
  await expect(apply).toBeDisabled();
  await f.dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(preview).toHaveAttribute('width', '200');
  const previewAlpha = () => preview.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return [ctx.getImageData(15, 15, 1, 1).data[3], ctx.getImageData(65, 50, 1, 1).data[3]];
  });
  await expect.poll(previewAlpha).toEqual([255, 0]);
  await f.dialog.getByLabel('Trace detail', { exact: true }).selectOption('128');
  await expect(apply).toBeDisabled();
  await f.dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(preview).toHaveAttribute('width', '128');
  expect(await f.read()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Trace bitmap…', exact: true })).toBeFocused();
  expect(await f.read()).toEqual(before);
  await f.open();
  await page.keyboard.press('Shift+Tab');
  await expect(f.dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(f.dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(detail).toBeFocused();
  await page.keyboard.press('Tab');
  const previewAction = f.dialog.getByRole('button', { name: 'Preview', exact: true });
  await expect(previewAction).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(apply).toBeEnabled();
  await expect(previewAction).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(apply).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(f.dialog).toHaveCount(0);
  await expect(f.stage).toBeFocused();
  const after = (await f.read())!, artwork = after.layers[0].keys[0].shapes;
  expect(after.assets).toEqual(before.assets);
  expect(after.libraryLinks).toEqual(before.libraryLinks);
  expect(artwork.map(shape => [shape.kind, shape.fill, shape.contours?.map(ring => ring.length), shape.bitmap]))
    .toEqual([['polygon', '#ff0000', [4, 4], undefined], ['polygon', '#0000ff', [4], undefined]]);
  await f.stage.press('Escape');
  await expect.poll(pixels).toEqual(colors);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(after);
});

test('trace worker failure and cancellation leave the bitmap and history intact', async ({ page }) => {
  await holdGeometry(page);
  const f = await placeBitmap(page, true), before = await f.read();
  await f.open();
  const preview = f.dialog.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await expect(f.dialog.getByRole('alert')).toContainText('Simulated merge failure');
  await expect(f.dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await preview.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  const pending = f.dialog.getByRole('button', { name: 'Tracing…', exact: true });
  await expect(pending).toBeFocused();
  await expect(pending).toBeDisabled();
  await page.keyboard.press('Enter');
  expect(await pendingGeometry(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(f.dialog).toHaveCount(0);
  await releaseGeometry(page, true);
  expect(await f.read()).toEqual(before);
  await f.open();
  await preview.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await f.dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(f.read).not.toEqual(before);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.stage.press('Control+z');
  await expect.poll(async () => (await f.read())?.layers[0].keys[0].shapes).toEqual([]);
});

test('a late layer edit invalidates bitmap Apply without consuming history', async ({ page }) => {
  const f = await placeBitmap(page), before = (await f.read())!;
  await f.open();
  await f.dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  const apply = f.dialog.getByRole('button', { name: 'Apply', exact: true });
  await expect(apply).toBeEnabled();
  // Inject a source edit while the modal keeps normal timeline interaction inert.
  await page.getByLabel(`Toggle outline ${before.layers[0].name}`, { exact: true }).dispatchEvent('click');
  const layerEdit = (await f.read())!;
  expect(layerEdit.layers[0].outline).toBe(true);
  await apply.click();
  await expect(f.dialog.getByRole('alert')).toContainText('The original bitmap selection changed');
  expect(await f.read()).toEqual(layerEdit);
  await f.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});
