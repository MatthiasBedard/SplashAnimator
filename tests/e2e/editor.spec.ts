import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
async function draw(page: Page, tool = 'Rectangle') {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const stage = await page.getByLabel('Drawing stage').boundingBox();
  if (!stage) throw new Error('Stage missing');
  await page.mouse.move(stage.x + stage.width * 0.35, stage.y + stage.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.55, stage.y + stage.height * 0.6, { steps: 10 });
  await page.mouse.up();
}
test('stage alignment is a single undoable edit and respects layer locks', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  await draw(page);
  const x = await page.getByLabel('Shape X', { exact: true }).inputValue();
  const width = Number(await page.getByLabel('Shape W', { exact: true }).inputValue());
  const panel = page.getByRole('region', { name: 'Align and distribute', exact: true });
  await expect(panel.getByRole('button', { name: 'Align center', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Position and size', exact: true })
    .getByLabel('Align to stage', { exact: true })).toHaveCount(0);
  await panel.getByLabel('Align to stage', { exact: true }).check();
  await panel.getByRole('button', { name: 'Align center', exact: true }).click();
  expect(Number(await page.getByLabel('Shape X', { exact: true }).inputValue())).toBeCloseTo(
    (960 - width) / 2,
    1,
  );
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue(x);
  await page.getByRole('button', { name: 'Toggle lock Layer 1', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveCount(0);
});
test('draw → style → keyframe → save actual folder → reopen → export playback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await draw(page);
  await expect(page.getByLabel('Shape W', { exact: true })).toBeVisible();
  await page.getByLabel('Selected fill').fill('#22cc88');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Selected fill')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Selected fill')).toHaveValue('#22cc88');
  const timeline = await page.getByLabel('Timeline frames').boundingBox();
  if (!timeline) throw new Error('Timeline missing');
  await page.mouse.click(timeline.x + 9 * 18 + 8, timeline.y + 40);
  await page.keyboard.press('F6');
  // Timeline arrows navigate frames; stage focus routes arrows to object nudging.
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('ArrowRight');
  const x = await page.getByLabel('Shape X', { exact: true }).inputValue();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+s');
  const name = `E2E-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  const root = path.resolve('.e2e-projects', `${name}.spl`);
  expect((await fs.stat(root)).isDirectory()).toBe(true);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'));
  expect(manifest.format).toBe('splash-directory');
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('dialog', { name: 'Open project' })).toBeHidden();
  await page.mouse.click(timeline.x + 9 * 18 + 8, timeline.y + 40);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue(x);
  await expect(page.getByLabel('Selected fill')).toHaveValue('#22cc88');
  const downloadPromise = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const download = await downloadPromise;
  const files = await readWebDownload(download);
  expect(files.get('scripts/player.js')?.toString()).toContain('requestAnimationFrame');
  expect(files.get('data/animation.js')?.toString()).toContain('#22cc88');
  const exported = await page.context().newPage();
  await openWebExport(exported, files);
  await expect(exported.locator('canvas')).toBeVisible();
  const center = {
    x:
      Number(await page.getByLabel('Shape X', { exact: true }).inputValue()) +
      Number(await page.getByLabel('Shape W', { exact: true }).inputValue()) / 2,
    y:
      Number(await page.getByLabel('Shape Y', { exact: true }).inputValue()) +
      Number(await page.getByLabel('Shape H', { exact: true }).inputValue()) / 2,
  };
  await expect
    .poll(() =>
      exported
        .locator('canvas')
        .evaluate(
          (c, pt) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(pt.x, pt.y, 1, 1).data,
            ),
          center,
        ),
    )
    .toEqual([34, 204, 136, 255]);
  expect(
    await exported
      .locator('canvas')
      .evaluate((c) => (c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3]),
  ).toBe(255);
  await exported.close();
  expect(errors).toEqual([]);
});
test('locked layers reject drawing; blank keyframes isolate later content; undo restores it', async ({
  page,
}) => {
  await page.goto('/');
  await draw(page, 'Oval');
  await page.getByRole('button', { name: 'Toggle lock Layer 1', exact: true }).click();
  await draw(page);
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Toggle lock Layer 1', exact: true }).click();
  const timeline = await page.getByLabel('Timeline frames').boundingBox();
  await page.mouse.click(timeline!.x + 100, timeline!.y + 40);
  await page.keyboard.press('F7');
  await expect(page.getByText(/0 objects at frame 6/)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/1 object at frame 6/)).toBeVisible();
});
test('unsaved work is offered for recovery after reload', async ({ page }) => {
  await page.goto('/');
  await draw(page);
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Recover changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
});
test('workspace visual regression and preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('default-workspace.png', { animations: 'disabled' });
  await draw(page);
  await expect(page).toHaveScreenshot('selected-object.png', { animations: 'disabled' });
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog', { name: 'Test movie' })).toBeVisible();
  await expect(page.getByText(/WebGL · PixiJS|Canvas2D fallback/)).toBeVisible();
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
});
test('development file bridge rejects cross-origin requests and unsafe project names', async ({
  request,
}) => {
  const foreign = await request.post('/api/projects', {
    headers: { Origin: 'https://untrusted.example' },
    data: { op: 'list' },
  });
  expect(foreign.status()).toBe(400);
  const traversal = await request.post('/api/projects', {
    data: { op: 'create', project: '../outside.spl' },
  });
  expect(traversal.status()).toBe(400);
  const nonJson = await request.post('/api/projects', {
    headers: { 'Content-Type': 'text/plain' },
    data: '{"op":"list"}',
  });
  expect(nonJson.status()).toBe(400);
});
