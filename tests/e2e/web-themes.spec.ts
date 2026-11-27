import { expect, test, type Page } from './editor-test';

async function openThemes(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Preferences…', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: 'Themes', exact: true }).click();
  return preferences;
}

test('the browser uses bundled themes and restores the saved appearance', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html');
  let preferences = await openThemes(page);
  let theme = preferences.getByRole('combobox', { name: 'Theme' });
  await expect(theme.getByRole('option')).toHaveText(['Dark', 'Light']);
  await expect(preferences.getByRole('button', { name: 'Choose folder…' })).toHaveCount(0);
  await expect(theme).toHaveValue('');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await theme.selectOption('Light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('.drawing-options')).toHaveCSS('background-color', 'rgb(247, 249, 252)');
  await expect(page.locator('.inspector-tabs')).toHaveCSS('background-color', 'rgb(247, 249, 252)');
  await expect(page.locator('.inspector .property-grid label').filter({ hasText: /^Width$/ }))
    .toHaveCSS('color', 'rgb(64, 91, 122)');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveCSS('color', 'rgb(32, 47, 68)');
  const rulerPixel = (selector: string, x: number) => page.locator(selector).evaluate(
    (canvas: HTMLCanvasElement, x) => Array.from(canvas.getContext('2d')!.getImageData(x, 1, 1, 1).data), x,
  );
  await expect.poll(() => rulerPixel('#drawing-stage', 2)).toEqual([226, 234, 244, 255]);
  await expect.poll(() => rulerPixel('canvas[aria-label="Timeline frames"]', 100)).toEqual([225, 233, 244, 255]);

  await expect(preferences.getByText('Changes apply immediately.')).toHaveCSS('color', 'rgb(64, 91, 122)');
  await preferences.getByRole('tab', { name: 'Code Editor', exact: true }).click();
  await expect(preferences.getByText(/^When detection is enabled/)).toHaveCSS('color', 'rgb(64, 91, 122)');
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await exportDialog.getByLabel('Export format').selectOption('mp4');
  await expect(exportDialog.getByText(/^Current frame:/)).toHaveCSS('color', 'rgb(64, 91, 122)');
  await expect(exportDialog.getByText(/^1 makes every frame independent/)).toHaveCSS('color', 'rgb(64, 91, 122)');
  await exportDialog.getByRole('button', { name: 'Close export', exact: true }).click();

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About Splash Animator' });
  await expect(about.getByText(/^Splash Animator is a 2D vector animation editor/)).toHaveCSS('color', 'rgb(64, 91, 122)');
  await expect(about.getByText('Owned by', { exact: true })).toHaveCSS('color', 'rgb(64, 91, 122)');

  await page.reload();
  preferences = await openThemes(page);
  theme = preferences.getByRole('combobox', { name: 'Theme' });
  await expect(theme).toHaveValue('Light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await theme.selectOption('');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect.poll(() => rulerPixel('#drawing-stage', 2)).toEqual([45, 48, 56, 255]);
  await expect.poll(() => rulerPixel('canvas[aria-label="Timeline frames"]', 100)).toEqual([40, 43, 51, 255]);
});

test('the floating, docked, and pop-out Script Editor follow the browser theme', async ({ page }) => {
  await page.goto('/');
  const preferences = await openThemes(page);
  await preferences.getByRole('combobox', { name: 'Theme' }).selectOption('Light');
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Script Editor', exact: true }).click();
  const titlebar = page.getByRole('button', { name: 'Move script editor window' });
  await page.mouse.move(1, 1);
  await expect(titlebar).toHaveCSS('background-color', 'rgb(230, 236, 244)');
  await expect(titlebar).toHaveCSS('color', 'rgb(32, 47, 68)');
  await titlebar.hover();
  await expect(titlebar).toHaveCSS('background-color', 'rgb(229, 237, 248)');
  await expect(titlebar).toHaveCSS('color', 'rgb(32, 47, 68)');

  const panel = page.locator('.script-panel:visible');
  await panel.getByLabel('Script editor location').selectOption('canvas');
  await expect(titlebar).toHaveCount(0);
  await expect(panel).toHaveCSS('background-color', 'rgb(247, 249, 252)');
  await expect(panel.locator('.monaco-editor.vs')).toBeVisible();

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    panel.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const detached = popup.locator('.script-panel:visible');
  await expect(detached).toHaveCSS('background-color', 'rgb(247, 249, 252)');
  await expect(detached.locator('.monaco-editor.vs')).toBeVisible();

  const reopened = await openThemes(page);
  await reopened.getByRole('combobox', { name: 'Theme' }).selectOption('');
  await expect(detached).toHaveCSS('background-color', 'rgb(37, 40, 48)');
  await expect(detached.locator('.monaco-editor.vs-dark')).toBeVisible();

  await popup.emulateMedia({ forcedColors: 'active' });
  await expect(detached.locator('.monaco-editor.hc-black')).toBeVisible();
  await reopened.getByRole('combobox', { name: 'Theme' }).selectOption('Light');
  await expect(detached.locator('.monaco-editor.hc-light')).toBeVisible();
  await popup.close();
});
