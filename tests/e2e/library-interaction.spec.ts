import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';

async function setup(page: Page, used = false) {
  const p = newProject(),
    art = {
      id: 'art',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
  p.symbols = [
    { id: 'a', name: 'Aardvark', width: 40, height: 40, shapes: [art] },
    { id: 'z', name: 'Zebra', width: 40, height: 40, shapes: [{ ...art, id: 'z-art' }] },
  ];
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 2);
    return c.toDataURL();
  });
  p.assets = [
    {
      id: 'b',
      path: 'assets/bitmaps/b.json',
      bitmap: { name: 'Apple', width: 2, height: 2, dataUrl: png },
    },
    {
      id: 'sound',
      path: 'assets/audio/sound.wav',
      audio: { name: 'Click', format: 'pcm16-wav', sampleRate: 48000, channels: 1, frames: 4800 },
    },
  ];
  p.libraryFolders = [
    { id: 'ink', name: 'Ink' },
    { id: 'other', name: 'Other' },
  ];
  p.libraryLinks = [
    { kind: 'symbol', id: 'a', name: 'items.Aardvark' },
    { kind: 'bitmap', id: 'b', name: 'items.Apple' },
  ];
  if (used) p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 20, 20)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const library = page.locator('#dock-body-library'),
    list = library.getByRole('listbox', { name: 'Library items', exact: true });
  const row = (name: string) =>
    list.getByRole('option', { name: 'Library item ' + name, exact: true });
  const selected = () =>
    list
      .getByRole('option', { selected: true })
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  async function action(name: string, target = 'Aardvark') {
    await row(target).click({ button: 'right' });
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  return { p, library, list, row, selected, read, action };
}

test('left click only selects and previews; it never opens a disclosure or menu', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').scrollIntoViewIfNeeded();
  const initialTop = (await f.row('Aardvark').boundingBox())!.y;
  await f.row('Aardvark').click();
  await expect(f.row('Aardvark')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(f.library.getByLabel('Symbol name', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      f.library
        .getByLabel('Library preview Aardvark', { exact: true })
        .evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) red++;
          return red;
        }),
    )
    .toBeGreaterThan(500);
  expect((await f.row('Aardvark').boundingBox())!.y).toBeCloseTo(initialTop, 1);
  await page.screenshot({ path: test.info().outputPath('library-selected.png') });
  await f.row('Apple').click();
  await expect(f.library.getByAltText('Library preview Apple')).toBeVisible();
  expect(await f.selected()).toEqual(['Library item Apple']);
  expect(await f.read()).toEqual(f.p);
});
test('Ctrl and Shift select mixed items; right click keeps an existing multiple selection and replaces it for a new item', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').click();
  await f.row('Zebra').click({ modifiers: ['Control'] });
  expect(await f.selected()).toEqual(['Library item Aardvark', 'Library item Zebra']);
  await f.row('Aardvark').click({ button: 'right' });
  expect(await f.selected()).toHaveLength(2);
  await expect(page.getByRole('menuitem', { name: 'Move to folder…', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await f.row('Apple').click({ button: 'right' });
  expect(await f.selected()).toEqual(['Library item Apple']);
  await page.keyboard.press('Escape');
  await f.row('Aardvark').click();
  await f.row('Click').click({ modifiers: ['Shift'] });
  expect(await f.selected()).toEqual([
    'Library item Aardvark',
    'Library item Apple',
    'Library item Click',
  ]);
  await f.row('Apple').click({ modifiers: ['Control'] });
  expect(await f.selected()).toEqual(['Library item Aardvark', 'Library item Click']);
  expect(await f.read()).toEqual(f.p);
});
test('Properties is explicit, Escape closes it, and F2 renames without changing IDs or links', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Properties…', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Library properties Aardvark', exact: true });
  const close = dialog.getByRole('button', { name: 'Close library properties', exact: true });
  const last = dialog.getByRole('button', { name: 'Remove symbol', exact: true });
  await expect(close).toBeFocused();
  await expect(dialog.getByLabel('Symbol name', { exact: true })).toHaveValue('Aardvark');
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(f.row('Aardvark')).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('F2');
  const input = f.library.getByLabel('Rename library item Aardvark', { exact: true });
  await input.fill('Antelope');
  await input.press('Enter');
  await expect(f.row('Antelope')).toBeFocused();
  const out = await f.read();
  expect(out.symbols![0].name).toBe('Antelope');
  expect(out.libraryLinks).toEqual(f.p.libraryLinks);
  expect(out.symbols![0].id).toBe('a');
  await f.row('Antelope').focus();
  await page.keyboard.press('F2');
  await f.library.getByLabel('Rename library item Antelope', { exact: true }).fill('Discard');
  await page.keyboard.press('Escape');
  await expect(f.row('Antelope')).toBeFocused();
  expect(await f.read()).toEqual(out);
  await f.row('Antelope').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});
test('double-clicking the icon edits a symbol while a single click leaves the document and stage selection alone', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.row('Aardvark').getByRole('img').dblclick();
  await expect(
    page.getByRole('main', { name: 'Symbol editing workspace', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
});
test('keyboard navigation, selection shortcuts, keyboard context menu and filter pruning stay inside Library', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').click();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await f.selected()).toEqual(['Library item Aardvark', 'Library item Apple']);
  await page.keyboard.press('Control+a');
  expect(await f.selected()).toHaveLength(4);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await f.library.getByLabel('Search library', { exact: true }).fill('Zebra');
  expect(await f.selected()).toEqual(['Library item Zebra']);
  await f.library.getByLabel('Search library', { exact: true }).fill('');
  await f.row('Zebra').focus();
  await page.keyboard.press('Escape');
  expect(await f.selected()).toEqual([]);
  expect(await f.read()).toEqual(f.p);
});
test('confirming a Library move to the current folder restores keyboard focus', async ({ page }) => {
  const f = await setup(page);
  await f.row('Aardvark').click();
  await f.row('Apple').click({ modifiers: ['Control'] });
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move to folder…', exact: true }).press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Move library items', exact: true });
  await expect(dialog.getByLabel('Move selected library items to folder')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Move items', exact: true }).press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect(f.list).toBeFocused();
  expect(await f.selected()).toEqual(['Library item Aardvark', 'Library item Apple']);
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('End');
  await expect(f.row('Zebra')).toBeFocused();
});

test('bulk folder moves are one transaction with exact Undo/Redo and preserve all artwork and link data', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').click();
  await f.row('Apple').click({ modifiers: ['Control'] });
  await f.action('Move to folder…');
  const dialog = page.getByRole('dialog', { name: 'Move library items', exact: true });
  const folder = dialog.getByLabel('Move selected library items to folder');
  const cancel = dialog.getByRole('button', { name: 'Cancel library move', exact: true });
  await expect(folder).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(folder).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(f.list).toBeFocused();
  expect(await f.selected()).toEqual(['Library item Aardvark', 'Library item Apple']);
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move to folder…', exact: true }).press('Enter');
  await folder.selectOption('ink');
  await dialog.getByRole('button', { name: 'Move items', exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(f.list).toBeFocused();
  const out = await f.read();
  expect(out.libraryItems).toEqual([
    { kind: 'symbol', id: 'a', folderId: 'ink' },
    { kind: 'bitmap', id: 'b', folderId: 'ink' },
  ]);
  expect(out.layers).toEqual(f.p.layers);
  expect(out.symbols).toEqual(f.p.symbols);
  expect(out.assets).toEqual(f.p.assets);
  expect(out.libraryLinks).toEqual(f.p.libraryLinks);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});
test('dragging a selected item to a folder moves the complete selected set and no extra artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Apple').click();
  await f.row('Click').click({ modifiers: ['Control'] });
  await f
    .row('Apple')
    .dragTo(f.library.getByRole('button', { name: 'Open library folder Ink', exact: true }));
  const out = await f.read();
  expect(out.libraryItems).toEqual([
    { kind: 'bitmap', id: 'b', folderId: 'ink' },
    { kind: 'audio', id: 'sound', folderId: 'ink' },
  ]);
  expect(out.assets).toEqual(f.p.assets);
  expect(out.symbols).toEqual(f.p.symbols);
});
test('bulk Duplicate selects new symbols and keeps one history edit and independent IDs/links', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Aardvark').click();
  await f.row('Zebra').click({ modifiers: ['Control'] });
  await f.action('Duplicate');
  const out = await f.read();
  expect(out.symbols).toHaveLength(4);
  expect(new Set(out.symbols!.map((s) => s.id)).size).toBe(4);
  expect(await f.selected()).toHaveLength(2);
  await f.list.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});
test('bulk Delete removes only unused selected items, cleans aliases and restores everything with one Undo', async ({
  page,
}) => {
  const f = await setup(page);
  await f.row('Apple').click();
  await f.row('Click').click({ modifiers: ['Control'] });
  await f.action('Delete', 'Apple');
  const out = await f.read();
  expect(out.assets).toEqual([]);
  await expect(f.list).toBeFocused();
  expect(out.symbols).toEqual(f.p.symbols);
  expect(out.libraryLinks).toEqual([f.p.libraryLinks![0]]);
  await f.list.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});
test('used-item deletion is disabled and Delete cannot delete stage artwork while Library owns focus', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.row('Aardvark').click();
  await f.row('Apple').click({ modifiers: ['Control'] });
  await f.row('Aardvark').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await f.row('Aardvark').focus();
  await page.keyboard.press('Delete');
  expect(await f.read()).toEqual(f.p);
});
