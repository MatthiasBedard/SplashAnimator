import { openLibraryRecord } from './library-helpers';
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
test('bitmap folder save and reopen hydrates its immutable payload through the host bridge', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'saved.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes, 'base64'),
  });
  await openLibraryRecord(page);
  await expect(page.getByRole('img', { name: 'saved.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place bitmap on stage', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+s');
  const name = `Bitmap-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  const root = path.resolve(process.env.SPLASH_PROJECTS || '.e2e-projects', name + '.spl');
  const raw = await fs.readFile(path.join(root, 'project.json'), 'utf8');
  const manifest = JSON.parse(raw);
  expect(raw).not.toContain('data:image');
  expect(manifest.schemaVersion).toBe(59);
  const payload = JSON.parse(
    await fs.readFile(path.join(root, manifest.document.assets[0].path), 'utf8'),
  );
  expect(payload.dataUrl).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('dialog', { name: 'Open project' })).toBeHidden();
  await openLibraryRecord(page);
  await expect(page.getByRole('img', { name: 'saved.png', exact: true })).toHaveAttribute(
    'src',
    payload.dataUrl,
  );
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await expect(page.getByLabel('Fill type')).toHaveValue('bitmap');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
