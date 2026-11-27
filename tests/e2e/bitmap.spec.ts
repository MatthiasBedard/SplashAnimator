import { openLibraryRecord } from './library-helpers';
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { newProject, type Project, type Vector } from '../../packages/document/src';

test('copy selection to system PNG preserves transparency, group pixels and clipboard on a stale pick', async ({
  page, context,
}) => {
  const p = newProject();
  p.width = 600;
  p.height = 400;
  p.layers[0].drawingMode = 'object';
  const dataUrl = await page.evaluate(() => {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 20;
    const ctx = tile.getContext('2d')!;
    ctx.fillStyle = '#00b022';
    ctx.fillRect(0, 0, 20, 20);
    return tile.toDataURL('image/png');
  });
  p.assets.push({
    id: 'sample', path: 'assets/bitmaps/sample.json',
    bitmap: { name: 'Sample.png', width: 20, height: 20, dataUrl },
  });
  const rectangle = (id: string, x: number, fill: string): Vector => ({
    id, kind: 'rectangle', x, y: 100, width: 20, height: 20,
    rotation: 0, fill, stroke: '#000000', strokeWidth: 0, points: [],
  });
  p.layers[0].keys[0].shapes = [
    { ...rectangle('paint', 100, '#e00033'), groups: ['unit'] },
    { ...rectangle('asset', 140, '#ffffff'), groups: ['unit'],
      bitmap: { assetId: 'sample', x: 0, y: 0, width: 20, height: 20 } },
    rectangle('unselected', 200, '#0010ff'),
  ];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.bringToFront();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const view = (await stage.boundingBox())!;
  const pick = (x: number) => page.mouse.click(view.x + view.width / 2 - 300 + x,
    view.y + view.height / 2 - 200 + 109);
  const copy = async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Copy selection as PNG (stage size)', exact: true }).click();
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await pick(109);
  await copy();
  await expect(page.getByText('Copied transparent PNG (stage size)', { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'))!;
    const blob = await item.getType('image/png');
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return {
        size: [image.width, image.height],
        samples: [50, 110, 150, 210].map(x => Array.from(ctx.getImageData(x, 110, 1, 1).data)),
      };
    } finally {
      image.close();
    }
  });
  expect(saved).toEqual({
    size: [600, 400],
    samples: [[0, 0, 0, 0], [224, 0, 51, 255], [0, 176, 34, 255], [0, 0, 0, 0]],
  });
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);

  await page.evaluate(async () => {
    await navigator.clipboard.writeText('keep this clipboard');
    const append = document.body.append.bind(document.body);
    document.body.append = (...nodes) => {
      if (nodes.some(node => node instanceof HTMLIFrameElement && node.title === 'PNG frame renderer')) {
        document.documentElement.dataset.copyPending = 'true';
        document.addEventListener('release-test-render', () => append(...nodes), { once: true });
        return;
      }
      append(...nodes);
    };
  });
  await pick(109);
  await copy();
  await expect(page.locator('html')).toHaveAttribute('data-copy-pending', 'true');
  await pick(209);
  await page.evaluate(() => document.dispatchEvent(new Event('release-test-render')));
  await expect(page.getByRole('alert')).toContainText('PNG copy selection changed');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('keep this clipboard');
  await expect.poll(read).toEqual(p);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
});

test('system clipboard PNG creates one bitmap transaction and protects the destination', async ({ page, context }) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.bringToFront();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const paste = async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Paste PNG from system clipboard', exact: true }).click();
  };
  const bitmap = () => page.evaluate(async () => {
    const node = document.createElement('canvas');
    node.width = 12;
    node.height = 10;
    const ctx = node.getContext('2d')!;
    ctx.fillStyle = '#e00033';
    ctx.fillRect(0, 0, 12, 10);
    const blob = await new Promise<Blob>((resolve, reject) => node.toBlob(b =>
      b ? resolve(b) : reject(new Error('PNG fixture encode failed.'))));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await bitmap();
  await paste();
  await expect.poll(async () => (await read()).assets.length).toBe(1);
  const pasted = await read();
  const [asset] = pasted.assets;
  expect(asset.bitmap).toMatchObject({ name: 'Clipboard PNG.png', width: 12, height: 10 });
  expect(pasted.layers[0].keys[0].shapes).toMatchObject([{
    x: (p.width - 12) / 2, y: (p.height - 10) / 2, width: 12, height: 10,
    bitmap: { assetId: asset.id, x: 0, y: 0, width: 12, height: 10 },
  }]);
  await stage.click({ position: { x: 250, y: 160 } });
  await expect.poll(() => stage.evaluate((node: HTMLCanvasElement) => Array.from(
    node.getContext('2d')!.getImageData(node.width >> 1, node.height >> 1, 1, 1).data,
  ))).toEqual([224, 0, 51, 255]);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(pasted);

  await page.evaluate(() => navigator.clipboard.writeText('unsupported plain text'));
  await paste();
  await expect(page.getByRole('alert')).toContainText('Copy one PNG');
  await expect.poll(read).toEqual(pasted);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();

  await bitmap();
  const lock = page.getByRole('button', { name: 'Toggle lock ' + p.layers[0].name, exact: true });
  await lock.click();
  const locked = await read();
  await paste();
  await expect(page.getByRole('alert')).toContainText('Choose an unlocked');
  await expect.poll(read).toEqual(locked);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await stage.press('Control+z');
  await expect.poll(read).toEqual(pasted);

  await page.evaluate(() => {
    const read = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = async () => {
      const items = await read();
      await new Promise<void>(resolve => {
        document.documentElement.dataset.clipboardPending = 'true';
        document.addEventListener('release-test-clipboard', () => resolve(), { once: true });
      });
      return items;
    };
  });
  await paste();
  await expect(page.locator('html')).toHaveAttribute('data-clipboard-pending', 'true');
  await lock.click();
  await page.evaluate(() => document.dispatchEvent(new Event('release-test-clipboard')));
  await expect(page.getByRole('alert')).toContainText('destination changed');
  await expect.poll(read).toEqual(locked);
});

test('bitmap library decodes, previews, renames, downloads and restores assets with undo/recovery', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 3;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 4, 3);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes, 'base64'),
  });
  await openLibraryRecord(page);
  const image = page.getByRole('img', { name: 'red.png', exact: true });
  await expect(image).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const p = await read();
  expect(p.assets[0].bitmap!.width).toBe(4);
  expect(p.assets[0].bitmap!.height).toBe(3);
  expect(p.layers[0].keys[0].shapes).toEqual([]);
  await openLibraryRecord(page);
  await page.getByLabel('Bitmap name', { exact: true }).fill('Red tile');
  await page.getByLabel('Bitmap name', { exact: true }).press('Tab');
  expect((await read()).assets[0].bitmap!.name).toBe('Red tile');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download bitmap PNG', exact: true }).click();
  const d = await download;
  const file = await fs.readFile((await d.path())!);
  expect(file.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await openLibraryRecord(page);
  await page.getByRole('button', { name: 'Remove bitmap', exact: true }).click();
  expect((await read()).assets).toEqual([]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect((await read()).assets[0].bitmap!.name).toBe('Red tile');
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await openLibraryRecord(page);
  await expect(page.getByRole('img', { name: 'Red tile', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('bitmap library rejects disguised SVG without changing the project', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByRole('alert')).toContainText('Only PNG, JPEG and WebP');
  await expect(page.getByLabel('Bitmap name', { exact: true })).toHaveCount(0);
});

for (const format of ['jpeg', 'webp'])
  test(`bitmap library normalizes ${format} pixels to PNG`, async ({ page }) => {
    await page.goto('/');
    const bytes = await page.evaluate((format) => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 6;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 6);
      return c.toDataURL('image/' + format).split(',')[1];
    }, format);
    await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
      name: 'tile.' + format,
      mimeType: 'image/' + format,
      buffer: Buffer.from(bytes, 'base64'),
    });
    await openLibraryRecord(page);
    const image = page.getByRole('img', { name: 'tile.' + format, exact: true });
    await expect(image).toBeVisible();
    const pixel = await image.evaluate(async (el) => {
      const img = el as HTMLImageElement;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 6;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(4, 3, 1, 1).data);
    });
    expect(pixel[0]).toBeGreaterThan(245);
    expect(pixel[1]).toBeLessThan(10);
    expect(pixel[3]).toBe(255);
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
  });
