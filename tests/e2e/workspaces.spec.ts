import { expect, test } from '@playwright/test';
import { newProject } from '../../packages/document/src';

test('named workspaces restore the dock, panel preferences and sizes across reset and reload', async ({ page }) => {
  const project = newProject('Workspace fixture');
  await page.addInitScript((project) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  async function loadEditor() {
    await expect(launch.or(recover).first()).toBeVisible({ timeout: 15_000 });
    if (await launch.isVisible()) await launch.click();
    await recover.click();
  }
  await page.goto('/');
  await loadEditor();
  const windowMenu = page.getByRole('button', { name: 'Window', exact: true });
  const inspector = page.locator('#properties-sidebar');
  const workArea = page.locator('main.editor > .work-area');
  const separator = page.getByRole('separator', { name: 'Resize properties sidebar', exact: true });
  const timeline = page.getByRole('separator', { name: 'Resize timeline', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  const chooser = dialog.getByRole('combobox', { name: 'Workspace', exact: true });
  async function open() {
    await windowMenu.press('Enter');
    await page.getByRole('button', { name: 'Workspaces…', exact: true }).press('Enter');
    await expect(chooser).toBeFocused();
  }
  const read = (key: string) => page.evaluate(key => localStorage.getItem(key), key);
  const recovery = await read('splash-recovery-v1');
  await open();
  const close = dialog.getByRole('button', { name: 'Close Workspaces', exact: true });
  const save = dialog.getByRole('button', { name: 'Save current layout', exact: true });
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chooser).toBeFocused();
  await dialog.getByRole('button', { name: 'Apply workspace' }).evaluate(button => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'Workspace text must never paste onto the canvas');
    button.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await chooser.selectOption('builtin:Animation');
  await dialog.getByRole('button', { name: 'Apply workspace' }).press('Enter');
  await expect(windowMenu).toBeFocused();
  await expect(timeline).toHaveAttribute('aria-valuenow', '340');
  await open();
  await dialog.getByRole('combobox', { name: 'Properties dock', exact: true }).selectOption('left');
  await chooser.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(windowMenu).toBeFocused();
  const dockedLeft = async () => {
    const [dock, area, divider] = await Promise.all([
      inspector.boundingBox(), workArea.boundingBox(), separator.boundingBox(),
    ]);
    return !!dock && !!area && !!divider && Math.abs(dock.x + dock.width - area.x) < 1 &&
      Math.abs(divider.x + divider.width / 2 - area.x) < 2;
  };
  await expect.poll(dockedLeft).toBe(true);
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + handle.height / 2);
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '330');
  await separator.press('Shift+ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '380');
  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '640');
  await windowMenu.click();
  await page.locator('.window-menu').getByRole('button', { name: /Drawing defaults/ }).click();
  await expect(inspector.locator('#dock-body-defaults')).toBeHidden();
  await windowMenu.click();
  await open();
  await dialog.getByLabel('Workspace name').fill('Character cleanup');
  await dialog.getByRole('button', { name: 'Save current layout' }).press('Enter');
  await expect(dialog.getByRole('status')).toContainText('Saved Character cleanup');
  const layout = JSON.parse((await read('splash-panel-layout-v1'))!);
  expect(layout.sidebarDock).toBe('left');
  expect(layout.hidden).toContain('defaults');
  expect(layout.groups).toHaveLength(1);
  await chooser.press('Escape');

  await windowMenu.click();
  await page.getByRole('button', { name: 'Reset panel layout' }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '262');
  await expect.poll(dockedLeft).toBe(false);
  await expect(inspector.locator('#dock-body-defaults')).toBeVisible();

  await page.reload();
  await loadEditor();
  await page.setViewportSize({ width: 680, height: 630 });
  await open();
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(680);
  await chooser.selectOption('saved:Character cleanup');
  await dialog.getByRole('button', { name: 'Apply workspace' }).press('Enter');
  await expect.poll(dockedLeft).toBe(true);
  // 680 CSS pixels minus the 72-pixel tools and the 320-pixel stage minimum.
  await expect(separator).toHaveAttribute('aria-valuenow', '288');
  await expect(inspector.locator('#dock-body-defaults')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(separator).toHaveAttribute('aria-valuenow', '640');
  await expect(timeline).toHaveAttribute('aria-valuenow', '340');
  expect(JSON.parse((await read('splash-panel-layout-v1'))!)).toEqual(layout);
  expect(await read('splash-recovery-v1')).toBe(recovery);

  await open();
  await chooser.selectOption('saved:Character cleanup');
  await dialog.getByLabel('Workspace name').fill('character Cleanup');
  await dialog.getByRole('button', { name: 'Save current layout' }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('already saved');
  await dialog.getByRole('combobox', { name: 'Properties dock', exact: true }).selectOption('right');
  await dialog.getByRole('button', { name: 'Replace with current layout' }).click();
  await expect(dialog.getByRole('status')).toContainText('Updated Character cleanup');
  expect(JSON.parse((await read('splash-workspaces-v1'))!)[0].layout.sidebarDock).toBe('right');
  await dialog.getByRole('button', { name: 'Remove saved workspace' }).click();
  await expect(chooser).toBeFocused();
  expect(JSON.parse((await read('splash-workspaces-v1'))!)).toEqual([]);
  expect(await read('splash-recovery-v1')).toBe(recovery);
});
