import type { Page } from '@playwright/test';
import { expect, test } from './editor-test';

test.use({ keepStartupScreen: true });

async function mockUpdater(page: Page, mode: 'available' | 'retry' | 'unconfigured' | 'current' = 'available') {
  await page.addInitScript(mode => {
    const commands: string[] = [];
    const callbacks = new Map<number, (message: unknown) => void>();
    const release = { installed: '1.2.0', latest: '1.3.0', ticket: 'release-ticket', unavailable: null };
    let checks = 0;
    let completeDownload: (() => void) | undefined;
    let completeFirstCheck: (() => void) | undefined;
    Object.assign(window, {
      updateCommands: commands,
      completeDownload: () => completeDownload?.(),
      completeFirstCheck: () => completeFirstCheck?.(),
    });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (callback: (message: unknown) => void) => {
        const id = callbacks.size + 1;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      async invoke(command: string, args?: { ticket: string; progress?: { id: number } }) {
        if (!command.startsWith('desktop_update_')) return null;
        commands.push(command);
        if (command === 'desktop_update_check') {
          checks++;
          if (mode === 'retry' && checks === 1) throw 'Could not check the release feed. Try again in a moment.';
          if (mode === 'unconfigured') {
            return { ...release, latest: null, ticket: null, unavailable: 'This build has no update feed configured.' };
          }
          if (mode === 'current') return { ...release, latest: release.installed, ticket: null };
          if (mode === 'available' && checks === 1) {
            await new Promise<void>(resolve => { completeFirstCheck = resolve; });
          }
          return release;
        }
        if (args?.ticket !== release.ticket) throw 'Unexpected update ticket';
        if (command === 'desktop_update_download') {
          callbacks.get(args.progress!.id)?.({ index: 0, message: { received: 50, total: 100 } });
          await new Promise<void>(resolve => { completeDownload = resolve; });
        }
        return null;
      },
    });
  }, mode);
}

const commands = (page: Page) => page.evaluate(() => Reflect.get(window, 'updateCommands') as string[]);
const openEditor = (page: Page) => page.getByRole('button', { name: 'Open editor', exact: true }).click();
const notice = (page: Page) => page.locator('#startup-screen .splash-update');
async function openUpdate(page: Page) {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Update…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Splash Animator Update' });
}

test('launch stays usable during the desktop check and Help shares that check before installing', async ({ page }) => {
  await mockUpdater(page);
  await page.goto('/');
  await openEditor(page);
  const dialog = await openUpdate(page);
  await expect(dialog.getByRole('status')).toHaveText('Checking for updates…');
  expect(await commands(page)).toEqual(['desktop_update_check']);
  await page.evaluate(() => Reflect.get(window, 'completeFirstCheck')());
  await expect(dialog.getByTestId('installed-version')).toHaveText('1.2.0');
  await expect(dialog.getByTestId('latest-version')).toHaveText('1.3.0');
  await dialog.getByRole('button', { name: 'Download and install' }).click();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '50');
  expect(await commands(page)).toEqual(['desktop_update_check', 'desktop_update_download']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => Reflect.get(window, 'completeDownload')());
  await expect.poll(() => commands(page)).toEqual(['desktop_update_check', 'desktop_update_download', 'desktop_update_install']);
});

test('the splash and editor headers offer a detected desktop update', async ({ page }) => {
  await mockUpdater(page);
  await page.goto('/');
  await expect.poll(() => commands(page)).toEqual(['desktop_update_check']);
  await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeEnabled();
  const updateButton = page.getByRole('button', { name: 'Update Available', exact: true });
  await expect(updateButton).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, 'completeFirstCheck')());
  const label = page.locator('#startup-screen').locator('#version');
  await expect(label).toHaveText('v1.2.0 · Latest v1.3.0');
  await expect(notice(page)).toBeVisible();
  expect(await notice(page).evaluate(node => node.parentElement?.id)).toBe('version');
  await expect(updateButton).toBeEnabled();
  const nextAction = await updateButton.evaluate(button => button.nextElementSibling?.classList.contains('publish'));
  expect(nextAction).toBe(true);
  await updateButton.click();
  const dialog = page.getByRole('dialog', { name: 'Splash Animator Update' });
  await expect(page.locator('#startup-screen')).toHaveCount(0);
  await expect(dialog.getByTestId('latest-version')).toHaveText('1.3.0');
  await dialog.getByRole('button', { name: 'Close Update' }).click();
  await expect(updateButton).toBeFocused();
  await updateButton.click();
  await expect(dialog.getByRole('button', { name: 'Download and install' })).toBeVisible();
});

test('browser startup and Help have no desktop updater', async ({ page }) => {
  await page.goto('/');
  await expect(notice(page)).toHaveCount(0);
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update…', exact: true })).toHaveCount(0);
});

test('unconfigured desktop keeps installed version visible and offers no install', async ({ page }) => {
  await mockUpdater(page, 'unconfigured');
  await page.goto('/');
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  const dialog = await openUpdate(page);
  await expect(dialog.getByTestId('installed-version')).toHaveText('1.2.0');
  await expect(dialog.getByTestId('latest-version')).toHaveText('—');
  await expect(dialog.getByRole('status')).toHaveText('This build has no update feed configured.');
  await expect(dialog.getByRole('button', { name: 'Download and install' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused();
});

test('current desktop release displays the feed version without offering an install', async ({ page }) => {
  await mockUpdater(page, 'current');
  await page.goto('/');
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Update Available', exact: true })).toHaveCount(0);
  const dialog = await openUpdate(page);
  await expect(dialog.getByTestId('latest-version')).toHaveText('1.2.0');
  await expect(dialog.getByRole('status')).toHaveText('No newer release is available.');
  await expect(dialog.getByRole('button', { name: 'Download and install' })).toHaveCount(0);
});

test('a failed desktop splash check can be retried, but unsaved artwork blocks installation', async ({ page }) => {
  await mockUpdater(page, 'retry');
  await page.goto('/');
  await openEditor(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60);
  await page.mouse.up();
  const dialog = await openUpdate(page);
  await expect(dialog.getByTestId('latest-version')).toHaveText('1.3.0');
  await expect(dialog.getByRole('status')).toHaveText('Save your open projects before installing the update.');
  await expect(dialog.getByRole('button', { name: 'Download and install' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => commands(page)).toEqual(Array(3).fill('desktop_update_check'));
});
