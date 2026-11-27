import { expect, test, type Page } from '@playwright/test';
import { newProject, newLayer, validateProject, type Project } from '../../packages/document/src';
async function setup(page: Page) {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.duration = 12;
  p.layers[0].name = 'Ink';
  p.layers[0].folderId = 'art';
  p.folders = [{ id: 'art', name: 'Art' }];
  p.layers[0].keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 40,
      y: 60,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const other = newLayer('Other');
  other.visible = false;
  other.locked = true;
  p.layers.push(other);
  validateProject(p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const row = (name: string) => page.getByRole('group', { name: 'Layer row ' + name, exact: true });
  const rename = page.getByRole('textbox', { name: 'Rename layer', exact: true });
  return { p, read, row, rename, errors };
}
test('double-click layer name renames in place with selected text, one Undo/Redo and recovery', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Ink').locator('button.layer-name').dblclick();
  await expect(f.rename).toBeFocused();
  await expect(f.rename).toHaveValue('Ink');
  expect(
    await f.rename.evaluate((n: HTMLInputElement) => [n.selectionStart, n.selectionEnd]),
  ).toEqual([0, 3]);
  await expect(f.row('Ink')).toHaveAttribute('draggable', 'false');
  await f.rename.fill('Characters');
  expect(await f.read()).toEqual(f.p);
  await f.rename.press('Enter');
  await expect(f.rename).toHaveCount(0);
  await expect(f.row('Characters').locator('button.layer-name')).toBeFocused();
  const expected = structuredClone(f.p);
  expected.layers[0].name = 'Characters';
  await expect.poll(f.read).toEqual(expected);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Characters');
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect(f.row('Characters')).toBeVisible();
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('F2 renames the focused layer without selecting it first', async ({ page }) => {
  const f = await setup(page);
  const row = (name: string) => f.row(name).locator('button.layer-name');
  await row('Other').press('F2');
  await expect(f.rename).toBeFocused();
  await expect(f.rename).toHaveValue('Other');
  await f.rename.fill('Discarded');
  await f.rename.press('Escape');
  await expect(row('Other')).toBeFocused();

  await page.keyboard.press('F2');
  await f.rename.fill('Backdrop');
  await f.rename.press('Enter');
  await expect(row('Backdrop')).toBeFocused();
  const expected = structuredClone(f.p);
  expected.layers[1].name = 'Backdrop';
  await expect.poll(f.read).toEqual(expected);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Ink');
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('scene layer context menu returns keyboard focus to the invoking control', async ({ page }) => {
  const f = await setup(page);
  const other = f.row('Other').locator('button.layer-name');
  const lock = f.row('Other').getByRole('button', { name: 'Toggle lock Other', exact: true });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await other.press('Shift+F10');
  await expect(menu.getByRole('menuitem', { name: 'Layer properties…', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(other).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await lock.press('ContextMenu');
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Unlock layer', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(lock).toBeFocused();
  const unlocked = structuredClone(f.p);
  unlocked.layers[1].locked = false;
  await expect.poll(f.read).toEqual(unlocked);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Tab and Shift+Tab close the layer context menu and continue from its trigger', async ({ page }) => {
  const f = await setup(page);
  const row = f.row('Other');
  const outline = row.getByRole('button', { name: 'Toggle outline Other', exact: true });
  const visibility = row.getByRole('button', { name: 'Toggle visibility Other', exact: true });
  const lock = row.getByRole('button', { name: 'Toggle lock Other', exact: true });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  const properties = menu.getByRole('menuitem', { name: 'Layer properties…', exact: true });
  await visibility.press('Shift+F10');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(lock).toBeFocused();

  await visibility.press('ContextMenu');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toHaveCount(0);
  await expect(outline).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await page.keyboard.press('Space');
  const outlined = structuredClone(f.p);
  outlined.layers[1].outline = true;
  await expect.poll(f.read).toEqual(outlined);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('forced colors keeps the current layer visible when keyboard focus moves to another layer', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const f = await setup(page);
  const ink = f.row('Ink').locator('button.layer-name'), other = f.row('Other').locator('button.layer-name');
  await other.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(other).toBeFocused();
  await expect(ink).toHaveAttribute('aria-current', 'true');
  await expect(other).not.toHaveAttribute('aria-current', 'true');
  const style = (locator: typeof ink) => locator.evaluate(button => {
    const css = getComputedStyle(button);
    return { background: css.backgroundColor, color: css.color, outline: css.outlineStyle };
  });
  const highlight = await ink.evaluate(button => {
    const probe = button.ownerDocument.createElement('span');
    probe.style.cssText = 'forced-color-adjust:none;background:Highlight;color:HighlightText';
    button.parentElement!.append(probe);
    const css = getComputedStyle(probe), palette = { background: css.backgroundColor, color: css.color };
    probe.remove();
    return palette;
  });
  expect(await style(ink)).toMatchObject(highlight);
  expect((await style(other)).background).not.toBe(highlight.background);
  expect((await style(other)).outline).toBe('solid');
  await other.press('Enter');
  await expect(other).toHaveAttribute('aria-current', 'true');
  await expect(ink).not.toHaveAttribute('aria-current', 'true');
  expect(await style(other)).toMatchObject({ ...highlight, outline: 'solid' });
  expect(await f.read()).toEqual(f.p);
  await f.row('Other').getByRole('button', { name: 'Toggle lock Other', exact: true }).press('Space');
  const unlocked = structuredClone(f.p);
  unlocked.layers[1].locked = false;
  await expect.poll(f.read).toEqual(unlocked);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Escape, unchanged and blank layer names leave no document edits or Undo entry', async ({
  page,
}) => {
  const f = await setup(page);
  for (const [name, key] of [
    ['Cancelled', 'Escape'],
    ['   ', 'Enter'],
    ['Ink', 'Enter'],
  ] as const) {
    await f.row('Ink').locator('button.layer-name').dblclick();
    await f.rename.fill(name);
    await f.rename.press(key);
    await expect(f.rename).toHaveCount(0);
    await expect(f.row('Ink').locator('button.layer-name')).toBeFocused();
    expect(await f.read()).toEqual(f.p);
  }
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Undo / })).toBeDisabled();
  expect(f.errors).toEqual([]);
});
test('blur saves the original layer and locked hidden layer names remain editable without changing their artwork flags', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Ink').locator('button.layer-name').dblclick();
  await f.rename.fill('Foreground');
  await f.row('Other').locator('button.layer-name').click();
  await expect(f.rename).toHaveCount(0);
  const first = structuredClone(f.p);
  first.layers[0].name = 'Foreground';
  await expect.poll(f.read).toEqual(first);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Other');
  await f.row('Other').locator('button.layer-name').dblclick();
  await f.rename.fill('Background');
  await f.rename.press('Enter');
  const expected = structuredClone(first);
  expected.layers[1].name = 'Background';
  await expect.poll(f.read).toEqual(expected);
  await expect(
    f.row('Background').getByRole('button', { name: 'Toggle lock Background', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    f.row('Background').getByRole('button', { name: 'Toggle visibility Background', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(first);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
