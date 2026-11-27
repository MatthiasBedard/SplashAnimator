import type { Page } from '@playwright/test';
export async function openLibraryRecord(page: Page, kind = 'bitmap', name?: string) {
  const row = name
    ? page.getByLabel('Library item ' + name, { exact: true })
    : page.locator(`[data-library-item="${kind}"] [role="option"]`).first();
  const close = page.getByRole('button', { name: 'Close library properties', exact: true });
  if (await close.isVisible()) await close.click();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Properties…', exact: true }).click();
}
