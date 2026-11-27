import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newProject } from '../../packages/document/src';

const storageKey = 'splash-shortcuts-v1';
async function setup(page: Page) {
  const project = newProject('Shortcut fixture');
  project.layers[0].keys[0].shapes = [{
    id: 'square', kind: 'rectangle', x: 100, y: 100, width: 50, height: 40,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [],
  }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  async function enter() {
    await expect(launch.or(recover).first()).toBeVisible({ timeout: 15_000 });
    if (await launch.isVisible()) await launch.click();
    await recover.click();
  }
  await page.goto('/');
  await enter();
  return { enter, stage: page.getByLabel('Drawing stage', { exact: true }) };
}

test('Edit displays the redo shortcuts and Ctrl+Y restores a real edit', async ({ page }) => {
  const { stage } = await setup(page);
  const artwork = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys[0].shapes,
  );
  const original = await artwork();
  await stage.press('Control+a');
  await stage.press('Delete');
  await expect.poll(artwork).toEqual([]);
  await stage.press('Control+z');
  await expect.poll(artwork).toEqual(original);

  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await edit.click();
  const redo = page.getByRole('button', { name: /^Redo / });
  await expect(redo).toBeEnabled();
  await expect(redo.locator('kbd')).toHaveText('Ctrl Shift Z / Ctrl Y');
  await edit.click();
  await stage.press('Control+y');
  await expect.poll(artwork).toEqual([]);
  await stage.press('Control+z');
  await expect.poll(artwork).toEqual(original);
  await stage.press('Control+Shift+z');
  await expect.poll(artwork).toEqual([]);
});

test('shortcut edits run real commands and round-trip through files without changing the document', async ({ page }) => {
  const { enter, stage } = await setup(page);
  const menu = page.getByRole('button', { name: 'Window', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const select = dialog.getByRole('combobox', { name: 'Command' });
  const unsaved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const prefs = () => page.evaluate(key => localStorage.getItem(key), storageKey);
  async function open() {
    await menu.press('Enter');
    await page.getByRole('button', { name: 'Keyboard Shortcuts…', exact: true }).press('Enter');
    await expect(select).toBeFocused();
  }
  const recording = dialog.getByRole('button', { name: 'Press a shortcut…' });
  async function bind(id: string, key: string) {
    await select.selectOption(id);
    await dialog.getByRole('button', { name: 'Change shortcut' }).click();
    await recording.press(key);
  }
  await open();
  const close = dialog.getByRole('button', { name: 'Close Keyboard Shortcuts', exact: true });
  const reset = dialog.getByRole('button', { name: 'Reset defaults', exact: true });
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(reset).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await select.selectOption('tool:brush');
  const clear = dialog.getByRole('button', { name: 'Clear shortcut', exact: true });
  await clear.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Shortcut removed.');
  await expect(clear).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Change shortcut', exact: true })).toBeFocused();
  await reset.press('Enter');
  const resetPrefs = await prefs();
  await bind('tool:brush', 'v');
  await expect(dialog.getByRole('alert')).toContainText('Selection tool');
  await bind('tool:brush', 'Control+w');
  await expect(dialog.getByRole('alert')).toContainText('reserved');
  await bind('tool:brush', 'Escape');
  await expect(dialog).toBeVisible();
  expect(await prefs()).toBe(resetPrefs);
  await bind('tool:brush', 'u');
  await expect(dialog.getByRole('status')).toHaveText('Shortcut saved.');
  const saved = await prefs();
  expect(JSON.parse(saved!).bindings).toEqual({ 'tool:brush': 'u' });

  const [download] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export shortcuts' }).click(),
  ]);
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toBe(saved);
  const file = dialog.getByLabel('Shortcut mapping file', { exact: true });
  await file.setInputFiles({
    name: 'invalid.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, bindings: { 'tool:brush': 'v' } })),
  });
  await expect(dialog.getByRole('alert')).toContainText('conflicts');
  expect(await prefs()).toBe(saved);
  await dialog.getByRole('button', { name: 'Reset defaults' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Default shortcuts restored.');
  expect(JSON.parse((await prefs())!).bindings).toEqual({});
  await file.setInputFiles({ name: 'splash-shortcuts.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(dialog.getByRole('status')).toHaveText('Shortcuts imported.');
  expect(await prefs()).toBe(saved);
  await select.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('title', 'Brush (U)');

  const librarySearch = page.getByLabel('Search library', { exact: true });
  await librarySearch.press('u');
  await expect(librarySearch).toHaveValue('u');
  await expect(page.getByRole('button', { name: 'Selection', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await stage.press('b');
  await expect(page.getByRole('button', { name: 'Selection', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await stage.press('u');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(unsaved);

  await page.reload();
  await enter();
  await stage.press('u');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Keyboard Shortcuts keeps keyboard focus during a pending shortcut import', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'held-shortcuts.json') return read.call(this);
      return new Promise(resolve => {
        window.addEventListener('release-shortcut-import', () => void read.call(this).then(resolve), { once: true });
      });
    };
  });
  const { stage } = await setup(page);
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const original = await recovery();
  const menu = page.getByRole('button', { name: 'Window', exact: true });
  await menu.press('Enter');
  await page.getByRole('button', { name: 'Keyboard Shortcuts…', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true });
  const importButton = dialog.getByRole('button', { name: 'Import shortcuts…', exact: true });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    importButton.press('Enter'),
  ]);
  try {
    await chooser.setFiles({
      name: 'held-shortcuts.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, bindings: { 'tool:brush': 'u' } })),
    });
    await expect(importButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Export shortcuts', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(importButton).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('Importing shortcuts…');
    await expect(importButton).toHaveAttribute('aria-disabled', 'true');
    const duplicate = page.waitForEvent('filechooser', { timeout: 250 }).catch(() => null);
    await page.keyboard.press('Enter');
    expect(await duplicate).toBeNull();
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event('release-shortcut-import')));
  }
  await expect(dialog.getByRole('status')).toHaveText('Shortcuts imported.');
  await expect(importButton).toBeEnabled();
  await expect(importButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await stage.press('u');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await recovery()).toBe(original);
});

test('default F8 and F9 open the existing symbol conversion and Script Editor', async ({ page }) => {
  const { stage } = await setup(page);
  await stage.press('Control+a');
  await stage.press('F8');
  const convert = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
  await expect(convert).toBeVisible();
  await convert.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stage.press('F9');
  await expect(page.getByRole('dialog', { name: 'Edit frame source', exact: true })).toBeVisible();
});
