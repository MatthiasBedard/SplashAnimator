import type { Page } from '@playwright/test';
import { expect, test } from './editor-test';

async function openPlugins(page: Page) {
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Plugins…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Plugins' });
}

async function openPluginPreferences(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Preferences/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
  return dialog;
}

test('desktop discovers packages and remembers their enable state per folder', async ({ page }) => {
  await page.addInitScript(() => {
    const scans: (string | null)[] = [];
    Object.assign(window, { pluginScans: scans });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      async invoke(command: string, args?: { folder: string | null }) {
        if (command === 'desktop_plugins_choose_folder') return 'D:/Plugins';
        if (command !== 'desktop_plugins_discover') return null;
        const folder = args?.folder ?? null;
        scans.push(folder);
        return {
          folder: folder ?? 'C:/Example/SplashAnimator/plugins',
          plugins: [{
            id: 'example.tools', name: 'Example Tools', version: '1.2.0',
            description: '<img src="plugin.js">',
          }],
          issues: scans.length === 1 ? ['Duplicate plugin ID: example.duplicate.'] : [],
        };
      },
    });
  });
  await page.goto('/');
  const scans = () => page.evaluate(() => Reflect.get(window, 'pluginScans') as (string | null)[]);
  expect(await scans()).toEqual([]);

  const dialog = await openPlugins(page);
  await expect(dialog.getByRole('status')).toContainText('Found 1 package');
  await expect(dialog.getByText('C:/Example/SplashAnimator/plugins')).toBeVisible();
  await expect(dialog.getByText('<img src="plugin.js">', { exact: true })).toBeVisible();
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByText('Scan issues (1)').click();
  await expect(dialog.getByText('Duplicate plugin ID: example.duplicate.')).toBeVisible();
  const enable = dialog.getByRole('checkbox', { name: 'Enable Example Tools' });
  await expect(enable).not.toBeChecked();
  await enable.check();
  await dialog.getByRole('button', { name: 'Scan again' }).click();
  await expect(dialog.getByText('Scan issues (1)')).toHaveCount(0);
  await expect(enable).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Window', exact: true })).toBeFocused();

  const preferences = await openPluginPreferences(page);
  await preferences.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(preferences.getByText('D:/Plugins')).toBeVisible();
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();

  await openPlugins(page);
  await expect(dialog.getByText('D:/Plugins')).toBeVisible();
  await expect(enable).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Close Plugins' }).click();

  await openPluginPreferences(page);
  await expect(preferences.getByText('D:/Plugins')).toBeVisible();
  await preferences.getByRole('button', { name: 'Use default' }).click();
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();

  await openPlugins(page);
  await expect(enable).toBeChecked();
  await enable.uncheck();
  await dialog.getByRole('button', { name: 'Close Plugins' }).click();
  await openPlugins(page);
  await expect(enable).not.toBeChecked();
  expect(await scans()).toEqual([null, null, 'D:/Plugins', null, null]);
});

test('browser Window leaves desktop plugin discovery unavailable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scenes…', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plugins…', exact: true })).toHaveCount(0);
});
