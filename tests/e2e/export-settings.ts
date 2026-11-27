import { expect, type Locator, type Page } from '@playwright/test';

export async function openHtmlShortcut(
  page: Page,
  shortcut: Locator = page.getByRole('button', { name: '↗ Export HTML', exact: true }),
) {
  await shortcut.click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog.getByLabel('Export format')).toHaveValue('html');
  return dialog;
}

export async function exportHtmlFromShortcut(page: Page, shortcut?: Locator) {
  const dialog = await openHtmlShortcut(page, shortcut);
  await dialog.getByRole('button', { name: 'Export HTML animation…', exact: true }).click();
}

/** Open the central exporter; existing codec tests exercise every legacy setting. */
export async function openExportSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  if (!(await dialog.isVisible())) {
    const command = page.getByRole('button', { name: 'Export…', exact: true });
    if (!(await command.isVisible()))
      await page.getByRole('button', { name: 'File', exact: true }).click();
    await command.click();
    await dialog.waitFor({ state: 'visible' });
  }
  const format = dialog.getByLabel('Export format', { exact: true });
  if (await format.isEnabled()) await format.selectOption('all');
  return dialog;
}

export async function expectExportStatus(page: Page, text: string) {
  await expect
    .poll(async () => {
      const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
      return (await dialog.isVisible())
        ? dialog.getByRole('status').innerText()
        : page.locator('footer.statusbar').innerText();
    })
    .toContain(text);
}
