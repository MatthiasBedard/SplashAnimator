import { expect, test } from '@playwright/test';
import { newProject } from '../../packages/document/src';
import { expectSource, fillSource, sourceEditor } from './monaco-source';

test('frame drafts save on Ctrl+S, focus loss and return from a pop-out', async ({ page }) => {
  const project = newProject();
  const original = '// Original frame source';
  project.frameScripts = [{ frame: 0, source: original }];
  await page.addInitScript((project) => {
    if (!location.hash.startsWith('#script-panel='))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(open.or(recover).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await recover.click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const dialog = { name: 'Edit frame source', exact: true };
  const panel = page.getByRole('dialog', dialog);
  const editor = sourceEditor(panel);
  const savedSource = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source);

  const first = 'state.savedWithShortcut = true;';
  await fillSource(editor, first);
  await expect(panel.getByLabel('Frame save status')).toHaveText('Frame changes pending.');
  expect(await savedSource()).toBe(original);
  await editor.press('Control+s');
  await expect.poll(savedSource).toBe(first);
  await expect(editor).toBeFocused();

  const second = 'state.savedOnBlur = true;';
  await fillSource(editor, second);
  expect(await savedSource()).toBe(first);
  await panel.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
  await expect.poll(savedSource).toBe(second);

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    panel.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const detached = popup.getByRole('dialog', dialog);
  const third = 'state.savedBeforeDocking = true;';
  await fillSource(sourceEditor(detached), third);
  expect(await savedSource()).toBe(second);
  await Promise.all([
    popup.waitForEvent('close'),
    detached.getByLabel('Script editor location').selectOption('timeline'),
  ]);
  expect(await savedSource()).toBe(third);
  await expectSource(editor, third);
  await expect(panel.getByLabel('Script editor location')).toHaveValue('timeline');
});
