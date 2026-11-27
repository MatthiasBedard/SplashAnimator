import { test, expect } from '@playwright/test';
import type { Project } from '../../packages/document/src';
test('ruler guides snap drawing, lock, delete with undo and survive save/reopen', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.move(b.x + 400, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + 220);
  await page.mouse.up();
  const guide = (await read()).guides![0];
  expect(guide.axis).toBe('y');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 350, b.y + 222);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  expect((await read()).layers[0].keys[0].shapes[0].y).toBeCloseTo(guide.position);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Lock guides', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear guides', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lock guides', exact: true }).click();
  await page.getByRole('button', { name: 'Clear guides', exact: true }).click();
  expect((await read()).guides).toEqual([]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect((await read()).guides).toEqual([guide]);
  await page.keyboard.press('Control+s');
  const name = `Guides-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  // Move the persisted guide; undo must recover the original coordinate.
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(b.x + 600, b.y + 220);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 270);
  await page.mouse.up();
  expect((await read()).guides![0].position).toBeGreaterThan(guide.position + 40);
  await page.keyboard.press('Control+z');
  expect((await read()).guides).toEqual([guide]);
});
test('grid snaps primitive endpoints and Alt temporarily bypasses it', async ({ page }) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  const zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  const origin = { x: b.x + (b.width - 960 * zoom) / 2, y: b.y + (b.height - 540 * zoom) / 2 };
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  async function draw() {
    await page.mouse.move(origin.x + 102 * zoom, origin.y + 103 * zoom);
    await page.mouse.down();
    await page.mouse.move(origin.x + 202 * zoom, origin.y + 203 * zoom);
    await page.mouse.up();
  }
  await draw();
  expect(Number(await page.getByLabel('Shape X', { exact: true }).inputValue())).toBeCloseTo(100);
  expect(Number(await page.getByLabel('Shape Y', { exact: true }).inputValue())).toBeCloseTo(100);
  await page.keyboard.down('Alt');
  await draw();
  await page.keyboard.up('Alt');
  expect(Number(await page.getByLabel('Shape X', { exact: true }).inputValue())).toBeCloseTo(
    102,
    0,
  );
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(origin.x + 142 * zoom, origin.y + 143 * zoom);
  await page.mouse.down();
  await page.mouse.move(origin.x + 161 * zoom, origin.y + 162 * zoom);
  expect(Number(await page.getByLabel('Shape X', { exact: true }).inputValue())).toBeCloseTo(
    120,
    0,
  );
  await page.keyboard.down('Alt');
  await page.mouse.move(origin.x + 179 * zoom, origin.y + 180 * zoom);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  // The last position comes from the original gesture, not accumulated snapped deltas.
  expect(Number(await page.getByLabel('Shape X', { exact: true }).inputValue())).toBeCloseTo(
    139,
    0,
  );
});
