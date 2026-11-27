import { test, expect, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { newProject, type Project, type Vector } from '../../packages/document/src';
async function closeLibraryProperties(page: Page) {
  const close = page.getByRole('button', { name: 'Close library properties', exact: true });
  if (await close.isVisible()) await close.click();
}
async function setup(page: Page, audio = false) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png');
  });
  const p = newProject();
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
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
  p.assets = [
    {
      id: 'b',
      path: 'assets/bitmaps/b.json',
      bitmap: { name: 'Apple', width: 2, height: 2, dataUrl: png },
    },
  ];
  if (audio)
    p.assets.push({
      id: 'sound',
      path: 'assets/audio/sound.wav',
      audio: { name: 'Click', format: 'pcm16-wav', sampleRate: 48000, channels: 1, frames: 4800 },
    });
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('library-test-initialized')) return;
    sessionStorage.setItem('library-test-initialized', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const library = page.locator('#dock-body-library');
  await expect(library).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const items = () =>
    library
      .locator('[data-library-item]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  async function openNew() {
    await library.getByLabel('New library item', { exact: true }).click();
  }
  async function closeProperties() {
    const close = page.getByRole('button', { name: 'Close library properties', exact: true });
    if (await close.isVisible()) await close.click();
  }
  async function item(name: string) {
    await closeProperties();
    const group = library.getByRole('group', { name, exact: true });
    await group.getByRole('option').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Properties…', exact: true }).click();
    return group;
  }
  async function folder(name: string) {
    await library.getByLabel('New folder', { exact: true }).click();
    await library.getByLabel('New library folder name', { exact: true }).fill(name);
    await library.getByRole('button', { name: 'New library folder', exact: true }).click();
    const id = (await read()).libraryFolders!.find((f) => f.name === name)!.id;
    await expect(library.getByLabel('Library folder', { exact: true })).toHaveValue(id);
    if (
      !(await library
        .locator('.library-folder-properties')
        .evaluate((node) => (node as HTMLDetailsElement).open))
    )
      await library.locator('.library-folder-properties summary').click();
    return id;
  }
  async function history(before: Project, after: Project) {
    await closeProperties();
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(after);
  }
  return { p, library, read, items, folder, history, item, openNew };
}
test('Library disclosures and New symbol accept keyboard activation', async ({ page }) => {
  const f = await setup(page);
  const filters = f.library.getByLabel('Library filters', { exact: true });
  await filters.press('Enter');
  await page.keyboard.press('Tab');
  await expect(f.library.getByLabel('Library item type', { exact: true })).toBeFocused();
  await filters.press('Space');
  await expect(f.library.getByLabel('Library item type', { exact: true })).toBeHidden();

  await f.library.getByLabel('New library item', { exact: true }).press('Enter');
  const name = f.library.getByLabel('New symbol name', { exact: true });
  await name.fill('Keyboard draft');
  await f.library.getByRole('button', { name: 'New symbol', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel symbol editing', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  const play = page.getByRole('button', { name: 'Play animation', exact: true });
  await expect(play).toBeVisible();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop playback', exact: true });
  await expect(stop).toBeVisible();
  await stop.press('Enter');
  await expect(play).toBeVisible();
});

test('Library Escape restores disclosure focus without intercepting Scenes dismissal', async ({ page }) => {
  const f = await setup(page);
  const filters = f.library.getByLabel('Library filters', { exact: true });
  const itemType = f.library.getByLabel('Library item type', { exact: true });
  await filters.press('Enter');
  await page.keyboard.press('Tab');
  await expect(itemType).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(itemType).toBeHidden();
  await expect(filters).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(itemType).toBeVisible();
  const scenes = page.locator('[data-scene-manager]');
  await scenes.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Scenes', exact: true });
  await expect(dialog).toBeVisible();
  await expect(itemType).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(scenes).toBeFocused();
  expect(await f.read()).toEqual(f.p);
});

test('one Library combines types, sort/filter/search change only the view and Window has one entry', async ({
  page,
}) => {
  const f = await setup(page);
  expect(await f.items()).toEqual(['Symbol Aardvark', 'Bitmap asset Apple', 'Symbol Zebra']);
  await f.library.getByLabel('Library filters', { exact: true }).click();
  await f.library.getByLabel('Sort library', { exact: true }).selectOption('type');
  expect(await f.items()).toEqual(['Bitmap asset Apple', 'Symbol Aardvark', 'Symbol Zebra']);
  await f.library.getByLabel('Descending library order', { exact: true }).check();
  expect(await f.items()).toEqual(['Symbol Zebra', 'Symbol Aardvark', 'Bitmap asset Apple']);
  await f.library.getByLabel('Library item type', { exact: true }).selectOption('bitmap');
  expect(await f.items()).toEqual(['Bitmap asset Apple']);
  await f.library.getByLabel('Library item type', { exact: true }).selectOption('all');
  await f.library.getByLabel('Search library', { exact: true }).fill('zeb');
  expect(await f.items()).toEqual(['Symbol Zebra']);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(
    page.locator('.window-menu').getByRole('button', { name: 'Library', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator('.window-menu').getByRole('button', { name: /^(Symbol|Bitmap) library$/ }),
  ).toHaveCount(0);
});
test('nested folders organize both item kinds and survive recovery with exact artwork', async ({
  page,
}) => {
  const f = await setup(page),
    parent = await f.folder('Characters'),
    child = await f.folder('Heads');
  await f.library.getByLabel('Library folder', { exact: true }).selectOption('');
  await (
    await f.item('Symbol Aardvark')
  )
    .getByLabel('Symbol library folder', { exact: true })
    .selectOption(child);
  await (
    await f.item('Bitmap asset Apple')
  )
    .getByLabel('Bitmap library folder', { exact: true })
    .selectOption(parent);
  expect(await f.items()).toEqual(['Symbol Zebra']);
  const out = await f.read();
  expect(out.symbols).toEqual(f.p.symbols);
  expect(out.assets).toEqual(f.p.assets);
  expect(out.layers).toEqual(f.p.layers);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(child);
  expect(await f.items()).toEqual(['Symbol Aardvark']);
  await f.library.getByLabel('Search library', { exact: true }).fill('Apple');
  expect(await f.items()).toEqual(['Bitmap asset Apple']);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
  await page.getByLabel('Library folder', { exact: true }).selectOption(child);
  await expect(page.getByRole('group', { name: 'Symbol Aardvark', exact: true })).toBeVisible();
});
test('folder rename, nesting changes and cycle rejection preserve one-step history', async ({
  page,
}) => {
  const f = await setup(page),
    parent = await f.folder('People'),
    child = await f.folder('Faces');
  const before = await f.read();
  await f.library.getByLabel('Library folder name', { exact: true }).fill('Heads');
  await f.library.getByLabel('Library folder name', { exact: true }).press('Tab');
  const after = await f.read();
  expect(after.libraryFolders!.find((f) => f.id === child)!.name).toBe('Heads');
  await f.history(before, after);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(parent);
  await f.library.getByLabel('Library folder parent', { exact: true }).selectOption(child);
  await expect(page.getByRole('alert')).toContainText('cannot contain themselves');
  expect(await f.read()).toEqual(after);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(child);
  await f.library.getByLabel('Library folder parent', { exact: true }).selectOption('');
  expect((await f.read()).libraryFolders!.find((f) => f.id === child)!.parentId).toBeUndefined();
});
test('removing a nonempty folder keeps its artwork and subfolders, with Undo/Redo', async ({
  page,
}) => {
  const f = await setup(page),
    parent = await f.folder('Art'),
    child = await f.folder('Heads');
  await f.library.getByLabel('Library folder', { exact: true }).selectOption('');
  await (
    await f.item('Symbol Aardvark')
  )
    .getByLabel('Symbol library folder', { exact: true })
    .selectOption(parent);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(parent);
  const before = await f.read();
  await f.library.locator('.library-folder-properties summary').click();
  await f.library.getByRole('button', { name: 'Remove library folder', exact: true }).click();
  const after = await f.read();
  expect(after.symbols).toEqual(before.symbols);
  expect(after.assets).toEqual(before.assets);
  expect(after.libraryFolders!.find((f) => f.id === child)!.parentId).toBeUndefined();
  expect(after.libraryItems).toEqual([]);
  await f.history(before, after);
});
test('bitmap import adds to the current folder without changing existing assets', async ({
  page,
}) => {
  const f = await setup(page),
    destination = await f.folder('Textures'),
    before = await f.read();
  await f.library.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: Buffer.from(f.p.assets[0].bitmap!.dataUrl!.split(',')[1], 'base64'),
  });
  await expect.poll(async () => (await f.read()).assets.length).toBe(2);
  const out = await f.read(),
    added = out.assets.find((a) => a.id !== 'b')!;
  expect(out.libraryItems).toContainEqual({ kind: 'bitmap', id: added.id, folderId: destination });
  expect(out.assets[0]).toEqual(f.p.assets[0]);
  await f.history(before, out);
});
const vectorSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60" viewBox="10 20 40 30"><g transform="translate(10 20)" fill="red"><path fill-rule="evenodd" d="M0 0H40V30H0Z M13 10Q20 5 27 10V20H13Z"/><circle cx="35" cy="5" r="3" style="fill: blue"/></g></svg>';

test('the Library imports compressed SVGZ as an editable graphic in the current folder', async ({ page }) => {
  const f = await setup(page), folderId = await f.folder('Vectors'), before = await f.read();
  await f.library.getByLabel('Import bitmap', { exact: true }).setInputFiles({
    name: 'Curves.svgz', mimeType: 'application/gzip', buffer: gzipSync(vectorSvg.replace('<svg ', '<svg transform="translate(3 4)" ')),
  });
  await expect.poll(async () => (await f.read()).symbols?.length).toBe(3);
  const after = await f.read(), symbol = after.symbols!.find(item => item.name === 'Curves')!;
  expect(symbol).toMatchObject({ width: 80, height: 60, shapes: [
    { kind: 'polygon', fill: '#ff0000', fillRule: 'evenodd', x: 3, y: 4, transform: [2, 0, 0, 2] },
    { kind: 'bezier', fill: '#0000ff', closed: true },
  ] });
  expect(symbol.shapes[0].contours?.[1][0].out).toBeDefined();
  expect(symbol.shapes[1].nodes?.some(node => node.in && node.out)).toBe(true);
  expect(symbol.shapes[0].groups).toEqual(symbol.shapes[1].groups);
  expect(after.libraryItems).toContainEqual({ kind: 'symbol', id: symbol.id, folderId });
  expect(after.assets).toEqual(before.assets);
  await f.history(before, after);
});

test('canvas SVG drop preserves colors and holes and rejects active content atomically', async ({ page }) => {
  const f = await setup(page);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const before = await f.read();
  const drop = async (sources: string[]) => {
    const dataTransfer = await page.evaluateHandle(svg => {
      const data = new DataTransfer();
      svg.forEach((source, i) => data.items.add(new File([source], `Artwork-${i}.svg`, { type: 'image/svg+xml' })));
      return data;
    }, sources);
    const box = (await stage.boundingBox())!;
    await stage.dispatchEvent('drop', { dataTransfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await dataTransfer.dispose();
  };
  await drop([vectorSvg, '<svg xmlns="http://www.w3.org/2000/svg"><script>window.svgExecuted = true</script></svg>']);
  await expect(page.getByRole('alert')).toContainText('SVG element <script> is not supported');
  expect(await f.read()).toEqual(before);
  expect(await page.evaluate(() => 'svgExecuted' in window)).toBe(false);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await drop([vectorSvg]);
  await expect.poll(async () => (await f.read()).symbols?.length).toBe(3);
  const after = await f.read(), symbol = after.symbols!.at(-1)!;
  expect(after.layers.flatMap(layer => layer.keys[0].shapes)).toMatchObject([{ kind: 'symbol', symbolId: symbol.id }]);
  expect(after.assets).toEqual(before.assets);
  await stage.press('Escape');
  const pixels = () => stage.evaluate((node: HTMLCanvasElement) => {
    const { width, height } = node;
    const rgba = node.getContext('2d')!.getImageData(0, 0, width, height).data;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i] !== 255 || rgba[i + 1] !== 0 || rgba[i + 2] !== 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left || bottom < top) return [];
    return [[0.1, 1 / 6], [0.5, 0.4], [0.875, 1 / 6]].map(([u, v]) => {
      const x = Math.round(left + (right - left) * u), y = Math.round(top + (bottom - top) * v);
      const i = (y * width + x) * 4;
      return [...rgba.slice(i, i + 4)];
    });
  });
  await expect.poll(pixels).toEqual([[255, 0, 0, 255], [255, 255, 255, 255], [0, 0, 255, 255]]);
  await f.history(before, after);
});

test('new symbol is an unpublished drawing draft until Apply; Cancel and empty Apply do not add artwork', async ({
  page,
}) => {
  const f = await setup(page),
    destination = await f.folder('Props'),
    before = await f.read();
  await f.openNew();
  await f.library.getByLabel('New symbol name', { exact: true }).fill('New prop');
  await f.library.getByRole('button', { name: 'New symbol', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(editor).toBeVisible();
  expect(await f.read()).toEqual(before);
  await editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(before);
  await f.openNew();
  await f.library.getByRole('button', { name: 'New symbol', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(editor).toContainText('initial symbol artwork');
  expect(await f.read()).toEqual(before);
  await editor.getByLabel('Symbol canvas tool', { exact: true }).selectOption('rectangle');
  const canvas = editor.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.65, { steps: 4 });
  await page.mouse.up();
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const out = await f.read(),
    added = out.symbols!.find((s) => s.name === 'New prop')!;
  expect(added.shapes).toHaveLength(1);
  expect(out.layers).toEqual(before.layers);
  expect(out.libraryItems).toContainEqual({ kind: 'symbol', id: added.id, folderId: destination });
  await f.history(before, out);
});

test('old separate library panel preferences migrate to one accessible Library tab', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'splash-panel-layout-v1',
      JSON.stringify({
        version: 1,
        sidebarVisible: true,
        hidden: ['bitmaps'],
        collapsed: [],
        groups: [{ id: 'g1', panels: ['symbols', 'bitmaps', 'layer'], active: 'symbols' }],
      }),
    ),
  );
  const f = await setup(page);
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^(Symbol|Bitmap) library$/ })).toHaveCount(0);
  expect(await f.items()).toHaveLength(3);
  expect(await f.read()).toEqual(f.p);
});

test('organized symbols retain editing and timeline workflows, duplicate into their folder and clean up on removal', async ({
  page,
}) => {
  const f = await setup(page),
    folder = await f.folder('Characters');
  await f.library.getByLabel('Library folder', { exact: true }).selectOption('');
  await (
    await f.item('Symbol Aardvark')
  )
    .getByLabel('Symbol library folder', { exact: true })
    .selectOption(folder);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(folder);
  const group = await f.item('Symbol Aardvark');
  const before = await f.read();
  await group.getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await (
    await f.item('Symbol Aardvark')
  )
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Symbol timeline', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(before);
  await (
    await f.item('Symbol Aardvark')
  )
    .getByRole('button', { name: 'Duplicate symbol', exact: true })
    .click();
  const copied = await f.read(),
    copy = copied.symbols!.find((s) => !before.symbols!.some((old) => old.id === s.id))!;
  expect(copied.libraryItems).toContainEqual({ kind: 'symbol', id: copy.id, folderId: folder });
  await (
    await f.item('Symbol ' + copy.name)
  )
    .getByRole('button', { name: 'Remove symbol', exact: true })
    .click();
  const removed = await f.read();
  expect(removed.libraryItems!.some((item) => item.id === copy.id)).toBe(false);
  await f.history(copied, removed);
});
test('compact rows show type/name/link while search, filters and New/Folder popups stay discoverable', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(f.library.getByLabel('Search library', { exact: true })).toBeVisible();
  await expect(f.library.getByLabel('Sort library', { exact: true })).not.toBeVisible();
  await expect(f.library.locator('.library-record-properties:visible')).toHaveCount(0);
  await expect(f.library.getByRole('img', { name: 'Graphic symbol', exact: true })).toHaveCount(2);
  await expect(f.library.getByRole('img', { name: 'Bitmap', exact: true })).toHaveCount(1);
  await f.library.getByLabel('Library filters', { exact: true }).click();
  await expect(f.library.getByLabel('Sort library', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(f.library.getByLabel('Sort library', { exact: true })).not.toBeVisible();
  await f.openNew();
  await expect(
    f.library.getByRole('button', { name: 'New movie clip', exact: true }),
  ).toBeVisible();
  await expect(f.library.getByRole('button', { name: 'New button', exact: true })).toBeVisible();
  await f.library.getByLabel('New folder', { exact: true }).click();
  await expect(f.library.getByLabel('New symbol name', { exact: true })).not.toBeVisible();
  await expect(f.library.getByLabel('New library folder name', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(f.p);
  await f.library.screenshot({ path: 'test-results/library-compact.png' });
});
test('editable stable linkage names are unique, searchable and undoable without renaming artwork', async ({
  page,
}) => {
  const f = await setup(page),
    symbol = await f.item('Symbol Aardvark'),
    before = await f.read();
  await symbol.getByLabel('Link name Aardvark', { exact: true }).fill('characters.Hero');
  await symbol.getByLabel('Link name Aardvark', { exact: true }).press('Tab');
  const linked = await f.read();
  expect(linked.libraryLinks).toContainEqual({ kind: 'symbol', id: 'a', name: 'characters.Hero' });
  expect(linked.symbols).toEqual(before.symbols);
  await f.history(before, linked);
  const bitmap = await f.item('Bitmap asset Apple');
  await bitmap.getByLabel('Link name Apple', { exact: true }).fill('characters.Hero');
  await bitmap.getByLabel('Link name Apple', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('unique');
  expect(await f.read()).toEqual(linked);
  await expect(bitmap.getByLabel('Link name Apple', { exact: true })).toHaveValue('');
  await closeLibraryProperties(page);
  await f.library.getByLabel('Search library', { exact: true }).fill('characters.Hero');
  expect(await f.items()).toEqual(['Symbol Aardvark']);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect((await f.read()).libraryLinks).toEqual(linked.libraryLinks);
});
async function dropFiles(
  page: Page,
  target: ReturnType<Page['locator']>,
  png: string,
  names: string[],
  invalid = false,
) {
  const transfer = await page.evaluateHandle(
    ({ png, names, invalid }) => {
      const data = new DataTransfer(),
        bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      names.forEach((name, i) =>
        data.items.add(
          new File([invalid && i === names.length - 1 ? 'bad data' : bytes], name, {
            type: 'image/png',
          }),
        ),
      );
      return data;
    },
    { png, names, invalid },
  );
  const bounds = (await target.boundingBox())!;
  const event = { dataTransfer: transfer, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 };
  await target.dispatchEvent('dragover', event);
  await target.dispatchEvent('drop', event);
  await transfer.dispose();
}
test('canvas file drop imports and places images on the playhead in one edit', async ({ page }) => {
  const f = await setup(page);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('merge');
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 62, y: 38 } });
  const before = await f.read();
  const png = f.p.assets[0].bitmap!.dataUrl!.split(',')[1];
  await dropFiles(page, stage, png, ['valid.png', 'bad.txt'], true);
  await expect(page.getByRole('alert')).toContainText('Only PNG, JPEG and WebP');
  expect(await f.read()).toEqual(before);
  await dropFiles(page, stage, png, ['placed.png']);
  await expect.poll(async () => (await f.read()).assets.length).toBe(2);
  const after = await f.read(), placed = after.layers[1];
  expect(after.layers[0]).toEqual(before.layers[0]);
  expect(placed.drawingMode).toBe('object');
  expect(placed.keys[0]).toEqual({ frame: 0, shapes: [] });
  expect(placed.keys[1].frame).toBeGreaterThan(0);
  expect(placed.keys[1].shapes).toMatchObject([{ bitmap: { assetId: after.assets[1].id }, width: 2, height: 2 }]);
  await f.history(before, after);
});

test('dragging selected Library artwork onto the canvas copies all items at the drop position', async ({ page }) => {
  const f = await setup(page, true);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const bounds = (await stage.boundingBox())!;
  const symbol = f.library.getByRole('option', { name: 'Library item Aardvark', exact: true });
  const bitmap = f.library.getByRole('option', { name: 'Library item Apple', exact: true });
  await symbol.click();
  await bitmap.click({ modifiers: ['Control'] });
  await f.library.getByRole('option', { name: 'Library item Click', exact: true }).click({ modifiers: ['Control'] });
  const before = await f.read();
  await symbol.dragTo(stage, { targetPosition: { x: bounds.width / 2 - 80, y: bounds.height / 2 - 40 } });
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  const after = await f.read(), artwork = after.layers[0].keys[0].shapes;
  expect(artwork[0]).toMatchObject({ symbolId: 'a' });
  expect(artwork[0].x).toBeCloseTo(380, 0);
  expect(artwork[0].y).toBeCloseTo(210, 0);
  expect(artwork[1]).toMatchObject({ bitmap: { assetId: 'b' } });
  expect(after.assets).toEqual(before.assets);
  expect(after.symbols).toEqual(before.symbols);
  expect(after.audioClips).toMatchObject([{ assetId: 'sound', startFrame: 0 }]);
  await f.history(before, after);
});

test('desktop-style multi-file drops import into the chosen folder atomically with unique links and one Undo', async ({
  page,
}) => {
  const f = await setup(page),
    destination = await f.folder('Dropped'),
    before = await f.read();
  await dropFiles(page, f.library.locator('.library-browser'), f.p.assets[0].bitmap!.dataUrl!.split(',')[1], [
    'tile.png',
    'tile.png',
  ]);
  await expect.poll(async () => (await f.read()).assets.length).toBe(3);
  const after = await f.read();
  expect(after.libraryLinks!.map((link) => link.name)).toEqual(['tile', 'tile_2']);
  expect(after.libraryItems!.filter((item) => item.folderId === destination)).toHaveLength(2);
  expect(after.layers).toEqual(before.layers);
  expect(after.symbols).toEqual(before.symbols);
  await f.history(before, after);
});
test('a malformed later dropped file preserves the entire library and permits a fresh valid drop', async ({
  page,
}) => {
  const f = await setup(page),
    before = await f.read(),
    png = f.p.assets[0].bitmap!.dataUrl!.split(',')[1];
  await dropFiles(page, f.library.locator('.library-browser'), png, ['good.png', 'bad.txt'], true);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await f.read()).toEqual(before);
  await dropFiles(page, f.library.locator('.library-browser'), png, ['retry.png']);
  await expect.poll(async () => (await f.read()).assets.length).toBe(2);
  expect((await f.read()).libraryLinks).toContainEqual(expect.objectContaining({ name: 'retry' }));
});
for (const type of ['movie', 'button'] as const)
  test(`New ${type} creates a typed draft and preserves linkage/insertion behavior`, async ({
    page,
  }) => {
    const f = await setup(page),
      before = await f.read();
    await f.openNew();
    await f.library.getByLabel('New symbol name', { exact: true }).fill('New ' + type);
    await f.library
      .getByRole('button', {
        name: type === 'movie' ? 'New movie clip' : 'New button',
        exact: true,
      })
      .click();
    const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    await expect(editor).toBeVisible();
    expect(await f.read()).toEqual(before);
    await editor.getByLabel('Symbol canvas tool', { exact: true }).selectOption('rectangle');
    const canvas = editor.getByLabel('Symbol artwork preview', { exact: true });
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 3 });
    await page.mouse.up();
    await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const after = await f.read(),
      definition = after.symbols!.find((s) => s.name === 'New ' + type)!;
    expect(after.libraryLinks).toContainEqual({
      kind: 'symbol',
      id: definition.id,
      name: 'New_' + type,
    });
    if (type === 'movie') expect(definition.defaultPlayback).toBe('movie');
    else expect(definition.buttonStates).toEqual({ up: 0, over: 0, down: 0, hit: 0 });
    const group = await f.item('Symbol New ' + type);
    await expect(
      group.getByRole('img', { name: type === 'movie' ? 'Movie clip' : 'Button', exact: true }),
    ).toHaveCount(1);
    await group.getByRole('button', { name: 'Place symbol', exact: true }).click();
    const placed = (await f.read()).layers
      .flatMap((l) => l.keys.flatMap((k) => k.shapes))
      .find((s) => s.symbolId === definition.id)!;
    if (type === 'movie') expect(placed.symbolPlayback).toEqual({ mode: 'movie', firstFrame: 0 });
  });

test('audio appears in the unified Library with type, folder, link and one-step timeline placement', async ({
  page,
}) => {
  const f = await setup(page, true),
    folder = await f.folder('Sounds');
  await f.library.getByLabel('Library folder', { exact: true }).selectOption('');
  const record = await f.item('Audio asset Click');
  await record.getByLabel('Link name Click', { exact: true }).fill('sounds.Click');
  await record.getByLabel('Link name Click', { exact: true }).press('Tab');
  await record.getByLabel('Audio library folder', { exact: true }).selectOption(folder);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(folder);
  await f.library.getByLabel('Library filters', { exact: true }).click();
  await f.library.getByLabel('Library item type', { exact: true }).selectOption('audio');
  expect(await f.items()).toEqual(['Audio asset Click']);
  await f.library.getByLabel('Library filters', { exact: true }).click();
  const before = await f.read();
  await f.item('Audio asset Click');
  await record.getByRole('button', { name: 'Place audio on timeline', exact: true }).click();
  const after = await f.read();
  expect(after.audioClips).toEqual([
    expect.objectContaining({ assetId: 'sound', startFrame: 0, offsetSamples: 0, gain: 1 }),
  ]);
  expect(after.layers).toEqual(before.layers);
  expect(after.libraryLinks).toEqual(before.libraryLinks);
  await f.history(before, after);
});

test('changing the destination while a dropped image decodes rejects the whole pending import and allows retry', async ({
  page,
}) => {
  const f = await setup(page),
    folder = await f.folder('Destination'),
    before = await f.read(),
    png = f.p.assets[0].bitmap!.dataUrl!.split(',')[1];
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseLibraryDecode: () => release(), libraryDecodeStarted: false });
    window.createImageBitmap = (async (...args: Parameters<typeof original>) => {
      Object.assign(window, { libraryDecodeStarted: true });
      await held;
      return original(...args);
    }) as typeof original;
  });
  await dropFiles(page, f.library.locator('.library-browser'), png, ['pending.png']);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { libraryDecodeStarted: boolean }).libraryDecodeStarted,
      ),
    )
    .toBe(true);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption('');
  await page.evaluate(() =>
    (window as unknown as { releaseLibraryDecode: () => void }).releaseLibraryDecode(),
  );
  await expect(page.getByRole('alert')).toContainText('Library changed');
  expect(await f.read()).toEqual(before);
  await f.library.getByLabel('Library folder', { exact: true }).selectOption(folder);
  await dropFiles(page, f.library.locator('.library-browser'), png, ['retry.png']);
  await expect.poll(async () => (await f.read()).assets.length).toBe(2);
  expect((await f.read()).libraryItems).toContainEqual(
    expect.objectContaining({ kind: 'bitmap', folderId: folder }),
  );
});
