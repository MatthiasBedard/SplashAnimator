import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { objectBounds, worldPoint } from '../../packages/geometry/src';
const read = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
test('group transforms preserve geometry, pivots, save/reopen and exported painted pixels', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  for (const x of [300, 480]) {
    await page.mouse.move(b.x + x, b.y + 180);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 90, b.y + 260);
    await page.mouse.up();
  }
  const before = (await read(page)).layers[0].keys[0].shapes;
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await page.getByText('Transform pivot', { exact: true }).click();
  await page.getByLabel('Pivot X', { exact: true }).fill('400');
  await page.getByLabel('Pivot Y', { exact: true }).fill('250');
  await page.getByLabel('Transform scale X', { exact: true }).fill('140');
  await page.getByLabel('Transform scale Y', { exact: true }).fill('80');
  await page.getByLabel('Transform rotation', { exact: true }).fill('30');
  await page.getByLabel('Transform skew X', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  const transformed = (await read(page)).layers[0].keys[0].shapes;
  await page.screenshot({ path: testInfo.outputPath('group-transform.png') });
  for (const [i, s] of transformed.entries()) {
    expect(s.width).toBe(before[i].width);
    expect(s.height).toBe(before[i].height);
    expect(s.transform).toBeDefined();
    expect(worldPoint(s, s.pivot!).x).toBeCloseTo(400);
    expect(worldPoint(s, s.pivot!).y).toBeCloseTo(250);
  }
  await page.getByRole('button', { name: 'Flip horizontal', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect((await read(page)).layers[0].keys[0].shapes).toEqual(transformed);
  await page.keyboard.press('Control+s');
  const name = `Transforms-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  const center = worldPoint(transformed[0], {
    x: transformed[0].width / 2,
    y: transformed[0].height / 2,
  });
  const downloading = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const download = await downloading;
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(download));
  await expect
    .poll(() =>
      out
        .locator('canvas')
        .evaluate(
          (c, p) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data,
            ),
          center,
        ),
    )
    .toEqual([109, 94, 252, 255]);
  await out.close();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText(/WebGL · PixiJS|Canvas2D fallback/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('transform-preview.png') });
  expect(errors).toEqual([]);
});
test('corner scaling, rotation and pivot handles are reversible without accumulating drag error', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 480, b.y + 320);
  await page.mouse.up();
  const original = (await read(page)).layers[0].keys[0].shapes[0];
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(b.x + 480, b.y + 320);
  await page.mouse.down();
  await page.mouse.move(b.x + 570, b.y + 380);
  await page.mouse.up();
  const scaled = (await read(page)).layers[0].keys[0].shapes[0];
  expect(objectBounds(scaled).right - objectBounds(scaled).left).toBeCloseTo(
    original.width * 1.5,
    0,
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  expect((await read(page)).layers[0].keys[0].shapes[0]).toEqual(original);
  // Rotation handle sits 24 screen pixels above the top edge.
  await page.mouse.move(b.x + 390, b.y + 176);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 474, b.y + 260);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const rotated = (await read(page)).layers[0].keys[0].shapes[0];
  expect(Math.abs(rotated.transform![0])).toBeLessThan(0.01);
  expect(rotated.transform![1]).toBeCloseTo(1);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await page.mouse.move(b.x + 390, b.y + 260);
  await page.mouse.down();
  await page.mouse.move(b.x + 350, b.y + 240);
  await page.mouse.up();
  const pivoted = (await read(page)).layers[0].keys[0].shapes[0];
  expect(pivoted.pivot).toBeDefined();
  expect(pivoted.x).toBe(original.x);
  await page.keyboard.press('Control+z');
  expect((await read(page)).layers[0].keys[0].shapes[0]).toEqual(original);
  await page.keyboard.press('Control+a');
  await page.mouse.move(b.x + 390, b.y + 200);
  await page.mouse.down();
  await page.keyboard.down('Control');
  await page.mouse.move(b.x + 430, b.y + 200);
  await page.mouse.up();
  await page.keyboard.up('Control');
  expect(Math.abs((await read(page)).layers[0].keys[0].shapes[0].transform![2])).toBeGreaterThan(
    0.2,
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await page.mouse.move(b.x + 480, b.y + 320);
  await page.mouse.down();
  await page.mouse.move(b.x + 540, b.y + 380);
  await page.getByLabel('Drawing stage').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  // Commit a harmless selection-independent save-cache edit to inspect the live restored model.
  await page.keyboard.press('ArrowRight');
  const cancelled = (await read(page)).layers[0].keys[0].shapes[0];
  expect(cancelled.transform).toBeUndefined();
  expect(cancelled.x).toBeCloseTo(original.x + 1);
});
