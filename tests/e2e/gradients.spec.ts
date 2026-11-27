import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
test('multi-stop gradient editing retains stop colors through moves, undo and exported pixels', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 620, b.y + 340);
  await page.mouse.up();
  await page.getByLabel('Fill type').selectOption('linear');
  await page.getByLabel('Gradient color 1').fill('#ff0000');
  await page.getByLabel('Gradient color 2').fill('#0000ff');
  await page.getByRole('button', { name: 'Add gradient stop', exact: true }).click();
  await page.getByLabel('Gradient color 2').fill('#00ff00');
  await page.getByLabel('Gradient position 2').fill('25');
  await page.getByLabel('Gradient position 2').press('Tab');
  const edited = await read();
  await page.screenshot({ path: testInfo.outputPath('gradient-controls.png') });
  expect(edited.gradient!.stops[1]).toEqual({ offset: 0.25, color: '#00ff00' });
  await page.getByRole('button', { name: 'Remove gradient stop 2', exact: true }).click();
  expect((await read()).gradient!.stops).toHaveLength(2);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(edited);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Fill type').selectOption('radial');
  expect((await read()).gradient!.stops).toEqual(edited.gradient!.stops);
  await page.getByLabel('Fill type').selectOption('linear');
  await page.getByLabel('Gradient opacity 2', { exact: true }).fill('50');
  await page.getByLabel('Gradient opacity 2', { exact: true }).press('Tab');
  expect((await read()).gradient!.stops[1].opacity).toBe(0.5);
  const shape = await read(),
    p = worldPoint(shape, { x: shape.width * 0.25, y: shape.height * 0.5 });
  const downloading = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await downloading),
    out = await page.context().newPage();
  await openWebExport(out, files);
  await expect
    .poll(() =>
      out.locator('canvas').evaluate((c, p) => {
        const a = (c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data;
        return a[1] > 245 && a[0] > 115 && a[0] < 140 && a[2] > 115 && a[2] < 140;
      }, p),
    )
    .toBe(true);
  await out.close();
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect((await read()).gradient!.stops[1].opacity).toBeUndefined();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('independent gradient transform preserves shape geometry and undoes', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 550, b.y + 350);
  await page.mouse.up();
  await page.getByLabel('Fill type').selectOption('linear');
  const before = await read();
  await page.getByText('Gradient transform', { exact: true }).click();
  await page.getByLabel('Gradient move X', { exact: true }).fill('10');
  await page.getByLabel('Gradient rotation', { exact: true }).fill('90');
  await page.getByLabel('Gradient scale', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Apply gradient transform', exact: true }).click();
  const after = await read();
  expect({ ...after, gradient: before.gradient }).toEqual(before);
  expect(after.gradient!.from.x).toBeCloseTo(before.gradient!.from.x + 10);
  expect(after.gradient!.to.x).toBeCloseTo(after.gradient!.from.x);
  expect(after.gradient!.to.y - after.gradient!.from.y).toBeCloseTo(
    (before.gradient!.to.x - before.gradient!.from.x) / 2,
  );
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

test('elliptical radial gradient and skew persist, undo and export elliptical pixels', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 620, b.y + 420);
  await page.mouse.up();
  await page.getByLabel('Fill type').selectOption('radial');
  await page.getByLabel('Gradient color 1').fill('#000000');
  await page.getByLabel('Gradient color 2').fill('#ffffff');
  await page.getByText('Gradient transform', { exact: true }).click();
  await page.getByLabel('Gradient aspect', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Apply gradient shape', exact: true }).click();
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const shape = await read();
  expect(shape.gradient!.transform).toEqual([1, 0, 0, 0.5]);
  const downloading = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await downloading),
    out = await page.context().newPage();
  await openWebExport(out, files);
  const center = worldPoint(shape, shape.gradient!.from),
    r = shape.width / 2;
  await expect
    .poll(() =>
      out.locator('canvas').evaluate(
        (c, { center, r }) => {
          const ctx = (c as HTMLCanvasElement).getContext('2d')!;
          const x = ctx.getImageData(center.x + r * 0.4, center.y, 1, 1).data[0],
            y = ctx.getImageData(center.x, center.y + r * 0.2, 1, 1).data[0],
            far = ctx.getImageData(center.x, center.y + r * 0.4, 1, 1).data[0];
          return Math.abs(x - y) < 6 && x > 90 && x < 115 && far > x + 80;
        },
        { center, r },
      ),
    )
    .toBe(true);
  await out.close();
  await page.getByLabel('Gradient skew', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Apply gradient shape', exact: true }).click();
  expect((await read()).gradient!.transform![2]).toBeCloseTo(Math.tan(Math.PI / 6));
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(shape);
});

test('numeric resize preserves skewed radial paint and rejects collapsed dimensions without edits', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 400);
  await page.mouse.up();
  await page.getByLabel('Fill type').selectOption('radial');
  await page.getByLabel('Gradient color 1').fill('#ff0000');
  await page.getByLabel('Gradient color 2').fill('#0000ff');
  await page.getByText('Gradient transform', { exact: true }).click();
  await page.getByLabel('Gradient aspect', { exact: true }).fill('50');
  await page.getByLabel('Gradient skew', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Apply gradient shape', exact: true }).click();
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const before = await read();
  await page.getByLabel('Shape W', { exact: true }).fill(String(before.width * 0.6));
  await canvas.focus();
  await page.getByLabel('Shape H', { exact: true }).fill(String(before.height * 1.3));
  await canvas.focus();
  const after = await read();
  const d = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(await d));
  const error = await out.locator('canvas').evaluate(
    (element, { before, after }) => {
      const ctx = (element as HTMLCanvasElement).getContext('2d')!,
        g = before.gradient!,
        [a, b, c, d] = g.transform!,
        det = a * d - b * c,
        r = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y);
      let error = 0,
        count = 0;
      for (let u = 0.2; u < 0.9; u += 0.1)
        for (let v = 0.2; v < 0.9; v += 0.1) {
          const x = Math.floor(after.x + after.width * u),
            y = Math.floor(after.y + after.height * v),
            pixel = ctx.getImageData(x, y, 1, 1).data;
          const dx = (x + 0.5 - after.x) / 0.6 - g.from.x,
            dy = (y + 0.5 - after.y) / 1.3 - g.from.y,
            t = Math.min(1, Math.hypot((d * dx - c * dy) / det, (a * dy - b * dx) / det) / r);
          error += Math.abs(pixel[0] - 255 * (1 - t)) + Math.abs(pixel[2] - 255 * t);
          count++;
        }
      return error / count;
    },
    { before, after },
  );
  expect(error).toBeLessThan(3);
  await out.close();
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Shape W', { exact: true }).fill('0');
  await canvas.focus();
  await expect(page.getByRole('alert')).toContainText('nonzero');
  expect(await read()).toEqual(before);
});

test('canvas stop dragging preserves opacity, cancels and samples exported paint', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 620, b.y + 380);
  await page.mouse.up();
  await page.getByLabel('Fill type').selectOption('linear');
  await page.getByLabel('Gradient color 1').fill('#ff0000');
  await page.getByLabel('Gradient color 2').fill('#0000ff');
  await page.getByRole('button', { name: 'Add gradient stop', exact: true }).click();
  await page.getByLabel('Gradient color 2').fill('#00ff00');
  await page.getByLabel('Gradient opacity 2', { exact: true }).fill('50');
  await page.getByLabel('Gradient opacity 2', { exact: true }).press('Tab');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const before = await read();
  const z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue()),
    o = { x: b.x + (b.width - 960 * z) / 2, y: b.y + (b.height - 540 * z) / 2 };
  const at = (t: number) =>
    worldPoint(before, {
      x: before.gradient!.from.x + (before.gradient!.to.x - before.gradient!.from.x) * t,
      y: 0,
    });
  const start = at(0.5),
    end = at(0.75);
  await page.getByRole('button', { name: 'Gradient transform', exact: true }).click();
  async function drag() {
    await page.mouse.move(o.x + start.x * z, o.y + start.y * z + 14);
    await page.mouse.down();
    await page.mouse.move(o.x + end.x * z, o.y + end.y * z + 14, { steps: 8 });
  }
  await drag();
  await page.mouse.up();
  const changed = await read();
  expect(changed.gradient!.stops[1].offset).toBeCloseTo(0.75, 2);
  expect(changed.gradient!.stops[1].opacity).toBe(0.5);
  expect({ ...changed, gradient: before.gradient }).toEqual(before);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+a');
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(before);
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await drag();
  await page.mouse.up();
  const p = worldPoint(before, { x: before.width * 0.75, y: before.height * 0.5 });
  const d = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(await d));
  const expected = await out
    .locator('canvas')
    .evaluate(
      (c, p) =>
        Array.from(
          (c as HTMLCanvasElement)
            .getContext('2d')!
            .getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data,
        ).slice(0, 3),
      p,
    );
  await page.getByRole('button', { name: 'Eyedropper', exact: true }).click();
  await page.keyboard.down('Alt');
  await page.mouse.click(o.x + p.x * z, o.y + p.y * z);
  await page.keyboard.up('Alt');
  const color = await page.getByLabel('Drawing fill').inputValue();
  for (let i = 0; i < 3; i++)
    expect(
      Math.abs(parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) - expected[i]),
    ).toBeLessThanOrEqual(3);
  expect(await read()).toEqual(changed);
  await page.getByLabel('Eyedropper source').selectOption('rendered');
  await page.mouse.click(o.x + 30 * z, o.y + 30 * z);
  expect(await page.getByLabel('Drawing fill').inputValue()).toBe('#ffffff');
  expect(await read()).toEqual(changed);
  await out.close();
});
