import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { expectSource, fillSource, sourceEditor } from './monaco-source';

async function recover(page: Page) {
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const button = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(button).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await button.click();
}

test('manages separate scene timelines with keyboard access, undo and recovery', async ({ page }) => {
  const project = newProject();
  project.layers[0].name = 'Opening art';
  project.layers[0].keys[0].shapes.push({
    id: 'opening-rect', kind: 'rectangle', x: 50, y: 60, width: 80, height: 60, points: [], rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0,
  });
  project.frameLabels = [{ frame: 4, name: 'Opening title' }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1')) {
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }
  }, project);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const stored = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const breadcrumb = page.locator('[data-scene-manager]');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const redPixels = () => stage.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && !data[i + 1] && !data[i + 2] && data[i + 3] === 255) count++;
    }
    return count;
  });
  const dialog = page.getByRole('dialog', { name: 'Scenes', exact: true });
  const list = dialog.getByRole('listbox', { name: 'Project scenes' });
  const row = (name: string) => page.getByRole('group', { name: 'Layer row ' + name, exact: true });
  await page.goto('/');
  await recover(page);
  await expect(row('Opening art')).toBeVisible();
  await expect.poll(redPixels).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Scenes…', exact: true }).click();
  await expect(list).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Delete scene', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add scene' }).click();
  await expect(list.getByRole('option', { name: 'Scene 2 (open)' })).toHaveJSProperty('selected', true);
  await dialog.getByLabel('Scene name').fill('Credits');
  await dialog.getByRole('button', { name: 'Rename scene' }).click();
  await dialog.getByRole('button', { name: 'Move up' }).click();
  await expect(list.getByRole('option').first()).toHaveText('Credits (open)');
  await dialog.getByRole('button', { name: 'Close Scenes' }).click();
  await expect(breadcrumb).toHaveText('Credits');
  await expect(row('Opening art')).toHaveCount(0);
  await expect.poll(redPixels).toBe(0);
  await row('Layer 1').locator('button.layer-name').dblclick();
  const rename = page.getByRole('textbox', { name: 'Rename layer', exact: true });
  await rename.fill('Credits art');
  await rename.press('Enter');

  await breadcrumb.press('Enter');
  await list.selectOption({ label: 'Scene 1' });
  await list.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(row('Opening art')).toBeVisible();
  await expect.poll(redPixels).toBeGreaterThan(100);
  expect(await stored()).toMatchObject({ layers: project.layers, frameLabels: project.frameLabels });

  await breadcrumb.click();
  await list.selectOption({ label: 'Credits' });
  await dialog.getByRole('button', { name: 'Delete scene', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm delete' }).click();
  await dialog.getByRole('button', { name: 'Close Scenes' }).click();
  expect((await stored()).scenes!.entries).toHaveLength(1);
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await stored()).scenes!.entries.map(scene => scene.name)).toEqual(['Credits', 'Scene 1']);
  await page.reload();
  await recover(page);
  await expect(row('Opening art')).toBeVisible();
  await breadcrumb.click();
  await list.selectOption({ label: 'Credits' });
  await dialog.getByRole('button', { name: 'Open scene' }).click();
  await expect(row('Credits art')).toBeVisible();
  expect((await stored()).frameLabels).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Scenes and Preferences open without an underlying Editor help window', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  if (await splash.isVisible()) await splash.click();
  const help = page.locator('[aria-label="Editor help"]');
  const launcher = page.locator('[data-scene-manager]');

  await launcher.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Scenes', exact: true })).toBeVisible();
  await expect(help).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(launcher).toBeFocused();

  const file = page.getByRole('button', { name: 'File', exact: true });
  await file.click();
  await page.getByRole('button', { name: 'Preferences…', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await expect(preferences).toBeVisible();
  await expect(help).toHaveCount(0);
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(file).toBeFocused();

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Build status & shortcuts', exact: true }).click();
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(help).toHaveCount(0);
});

test('keeps scene reorder keyboard focus at either end of the list', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  if (await splash.isVisible()) await splash.click();
  const launcher = page.locator('[data-scene-manager]');
  await launcher.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Scenes', exact: true });
  const list = dialog.getByRole('listbox', { name: 'Project scenes' });
  await dialog.getByRole('button', { name: 'Add scene' }).press('Enter');
  await expect(list).toBeFocused();
  const stored = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const initial = await stored();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Move up' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(list).toBeFocused();
  const reordered = await stored();
  expect(reordered.scenes!.entries.map(scene => scene.name)).toEqual(['Scene 2', 'Scene 1']);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Move down' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(list).toBeFocused();
  expect(await stored()).toEqual(initial);
  await page.keyboard.press('Escape');
  await expect(launcher).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect.poll(stored).toEqual(reordered);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(stored).toEqual(initial);
});

test('keeps an incomplete frame source with its scene across consecutive Undo and Redo', async ({ page }) => {
  const first = newProject();
  first.frameScripts = [{ frame: 0, source: '// Opening source' }];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, first);
  await page.goto('/');
  await recover(page);
  const launcher = page.locator('[data-scene-manager]');
  const scenes = page.getByRole('dialog', { name: 'Scenes', exact: true });
  await launcher.press('Enter');
  await scenes.getByRole('button', { name: 'Add scene' }).click();
  await scenes.getByLabel('Scene name').fill('Credits');
  await scenes.getByRole('button', { name: 'Rename scene' }).click();
  await page.keyboard.press('Escape');

  const openSource = async () => {
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  };
  const draft = 'const credits =\n//' + 'é'.repeat(131073);
  const panel = await openSource();
  await fillSource(sourceEditor(panel), draft);
  const stored = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  expect((await stored()).frameScripts).toBeUndefined();

  const undo = async (name: RegExp) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).evaluate((node: HTMLButtonElement) => node.click());
    await page.getByRole('button', { name }).evaluate((node: HTMLButtonElement) => node.click());
  };
  await undo(/^Undo Rename scene/);
  await expect(launcher).toHaveText('Scene 2');
  expect((await stored()).frameScripts).toBeUndefined();
  await undo(/^Undo Add scene/);
  await expect(panel).toHaveCount(0);
  await expect.poll(stored).toEqual(first);
  const original = await openSource();
  await expectSource(sourceEditor(original), '// Opening source');
  await original.getByRole('button', { name: 'Close dialog' }).click();
  await expect(original).toHaveCount(0);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+Shift+z');
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+Shift+z');
  await expect(launcher).toHaveText('Credits');
  expect((await stored()).frameScripts).toBeUndefined();
  const resumed = await openSource();
  const resumedEditor = sourceEditor(resumed);
  await expect.poll(async () => {
    await resumedEditor.press('Control+a');
    return resumedEditor.evaluate((input, expected) => {
      const data = new DataTransfer();
      input.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      return data.getData('text/plain').replace(/\r\n/g, '\n') === expected;
    }, draft);
  }).toBe(true);
  await fillSource(resumedEditor, 'const credits =');
  await resumed.getByRole('button', { name: 'Close dialog' }).click();
  await expect(resumed).toHaveCount(0);
  const saved = await stored();
  expect(saved.frameScripts).toEqual([{ frame: 0, source: 'const credits =' }]);
  expect(saved.scenes!.entries.find(scene => scene.id === 'main')?.data?.frameScripts).toEqual(first.frameScripts);
});
