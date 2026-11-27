import { sourceEditor, fillSource, expectSource } from './monaco-source';
import { expect, test } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { frameScriptStarter } from '../../apps/editor/src/script-workspace';

function fixture() {
  const p = newProject();
  p.width = 200;
  p.height = 100;
  p.duration = 4;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 's',
      name: 'Local sources',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: {
        duration: 3,
        keys: [{ frame: 1, shapes: [{ ...art, x: 10 }] }],
        frameScripts: [
          { frame: 0, source: 'throw new Error("symbol sources must stay inactive");' },
          { frame: 2, source: '\uFEFFlet incomplete =\r\n' },
        ],
      },
    },
  ];
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          ...art,
          id: 'instance',
          kind: 'symbol',
          symbolId: 's',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
          x: 40,
          y: 20,
        },
      ],
    },
  ];
  return p;
}

test('timeline Script attaches a starter and saves on blur, tab switch and window exit', async ({ page }) => {
  const project = fixture();
  project.frameScripts = [{ frame: 0, source: 'timeline.stop();' }];
  project.frameLabels = [{ frame: 0, name: 'intro' }, { frame: 1, name: 'beat' }];
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
  ), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (at: number, x: number, y: number) => timeline.evaluate((canvas: HTMLCanvasElement, { at, x, y }) => [
    ...canvas.getContext('2d')!.getImageData(
      Math.round((at * 18 + x) * devicePixelRatio),
      Math.round(y * devicePixelRatio), 1, 1,
    ).data,
  ], { at, x, y });
  const badge = (at: number) => pixel(at, 5, 27);
  const color = [22, 78, 99, 255];
  await expect.poll(() => badge(0)).toEqual(color);
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 4.*Frame script attached/);
  expect(await badge(1)).not.toEqual(color);

  await timeline.click({ button: 'right', position: { x: 27, y: 38 } });
  await expect(page.getByRole('menuitem', { name: 'Script…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await timeline.click({ position: { x: 9, y: 10 } });
  await timeline.click({ button: 'right', position: { x: 27, y: 19 } });
  await page.getByRole('menuitem', { name: 'Script…', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await expect(editor.getByRole('heading', { name: 'TypeScript for main frame 2' })).toBeVisible();
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 4/);
  const explorer = editor.getByRole('region', { name: 'Frame scripts', exact: true });
  const frameTwo = explorer.locator('[data-path="Frames/Frame 2"]');
  await expect(explorer.locator('[data-path="Frames/Frame 1"]')).toBeVisible();
  await expect(frameTwo).toBeVisible();
  await expectSource(sourceEditor(editor), frameScriptStarter);
  await expect.poll(async () => (await read()).frameScripts?.[1]?.source).toBe(frameScriptStarter);
  await expect.poll(() => badge(1)).toEqual(color);
  expect(await pixel(1, 11, 27)).toEqual(color);
  expect(await pixel(1, 8, 26)).not.toEqual(color);
  expect(await pixel(1, 10, 17)).not.toEqual(color);
  expect(await pixel(1, 1, 47)).toEqual([255, 210, 119, 255]);
  await fillSource(sourceEditor(editor), 'state.clicked = true;');
  expect((await read()).frameScripts?.[1]?.source).toBe(frameScriptStarter);
  await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
  await expect.poll(async () => (await read()).frameScripts?.[1]?.source).toBe('state.clicked = true;');

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    editor.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const detached = popup.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const detachedFrame = detached.locator('[data-path="Frames/Frame 2"]');
  await expect(detachedFrame).toBeVisible();
  await expectSource(sourceEditor(detached), 'state.clicked = true;');
  await fillSource(sourceEditor(detached), 'state.clicked = false;');
  expect((await read()).frameScripts?.[1]?.source).toBe('state.clicked = true;');
  await Promise.all([
    popup.waitForEvent('close'),
    detached.getByLabel('Script editor location').selectOption('canvas'),
  ]);
  await expect.poll(async () => (await read()).frameScripts?.[1]?.source).toBe('state.clicked = false;');
  await editor.getByRole('button', { name: 'Remove frame source', exact: true }).click();
  await expect(frameTwo).toHaveCount(0);
  await expect.poll(() => badge(1)).not.toEqual(color);
  await expect(explorer.getByRole('button', { name: 'Local sources', exact: true })).toBeVisible();
  await explorer.getByRole('button', { name: 'Frame 3', exact: true }).click();
  await expectSource(sourceEditor(editor), '\uFEFFlet incomplete =\r\n');
  await fillSource(sourceEditor(editor), 'timeline.play();');
  expect((await read()).symbols?.[0].timeline?.frameScripts?.[1].source).toBe('﻿let incomplete =\r\n');
  await editor.getByRole('tab', { name: 'Frame 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project;
    return { main: saved.frameScripts, symbol: saved.symbols?.[0].timeline?.frameScripts?.[1] };
  })).toEqual({
    main: project.frameScripts,
    symbol: { frame: 2, source: '\uFEFFtimeline.play();' },
  });
  await explorer.getByRole('button', { name: 'Frame 3', exact: true }).click();
  const [separate] = await Promise.all([
    page.waitForEvent('popup'),
    editor.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const separateEditor = separate.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await fillSource(sourceEditor(separateEditor), 'timeline.stop();');
  await Promise.all([separate.waitForEvent('close'), separate.evaluate(() => window.close())]);
  await expect.poll(async () => (await read()).symbols?.[0].timeline?.frameScripts?.[1].source)
    .toBe('\uFEFFtimeline.stop();');
  await expectSource(sourceEditor(editor), 'timeline.stop();');
  await expect(editor.getByRole('tab', { name: /Frame 3/ })).not.toContainText('•');
});
test('root source Apply Undo and recovery preserve complete inactive symbol-local bodies', async ({
  page,
}) => {
  const p = fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('symbol-source-initialized')) {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      sessionStorage.setItem('symbol-source-initialized', 'true');
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await fillSource(sourceEditor(d), 'timeline.stop();');
  await d.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('Frame source applied');
  const saved = await read();
  expect(saved.schemaVersion).toBe(59);
  expect(saved.symbols).toEqual(p.symbols);
  expect(saved.layers).toEqual(p.layers);
  expect(saved.frameScripts).toEqual([{ frame: 0, source: 'timeline.stop();' }]);
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect((await read()).symbols).toEqual(p.symbols);
  expect(errors).toEqual([]);
});
test('symbol artwork edits and remembered movie preview retain inactive local sources', async ({
  page,
}) => {
  const p = fixture(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('symbol-source-initialized')) {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      sessionStorage.setItem('symbol-source-initialized', 'true');
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('option', { name: 'Library item Local sources', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await d.getByLabel('Symbol duration', { exact: true }).fill('4');
  await d.getByLabel('Symbol duration', { exact: true }).press('Tab');
  await d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByTitle('Save symbol changes and return to the scene').click();
  const expected = structuredClone(p);
  expected.symbols![0].timeline!.duration = 4;
  await expect.poll(read).toEqual(expected);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Test remembered movie…', exact: true }).click();
  const movie = page.getByRole('dialog', { name: 'Test movie', exact: true });
  await expect(movie.getByLabel('Test movie interaction', { exact: true })).toBeVisible();
  await movie.getByRole('button', { name: 'Pause remembered movie', exact: true }).click();
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await movie.getByRole('button', { name: 'Close ×', exact: true }).click();
  expect(await read()).toEqual(expected);
  expect(errors).toEqual([]);
});

async function isolated(
  page: import('@playwright/test').Page,
  project = fixture(),
  withHistory = false,
  scriptFrame?: number,
  scriptFromRuler = false,
) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  if (withHistory) await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page
    .getByRole('option', { name: 'Library item Local sources', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  if (scriptFrame === undefined) {
    await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  } else {
    await page.locator('.symbol-workspace').getByLabel('Timeline frames', { exact: true }).click({
      button: 'right',
      position: { x: (scriptFrame - 0.5) * 18, y: scriptFromRuler ? 19 : 38 },
    });
    await page.getByRole('menuitem', { name: 'Script…', exact: true }).click();
  }
  const d = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const at = async (frame: number) => {
    await d.getByLabel('Symbol frame', { exact: true }).fill(String(frame));
    await d.getByLabel('Symbol frame', { exact: true }).press('Tab');
  };
  const open = async () => {
    await d.getByRole('button', { name: 'Edit local frame source', exact: true }).click();
    return d.getByRole('region', { name: 'Local frame source editor', exact: true });
  };
  return { d, read, at, open, errors };
}
test('local source edits own isolated Undo Redo Cancel and one parent Apply transaction', async ({
  page,
}) => {
  const p = fixture(),
    f = await isolated(page, p);
  await f.at(2);
  let editor = await f.open();
  const source = '\uFEFFlet incomplete =\n';
  await fillSource(sourceEditor(editor), source);
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await f.read()).toEqual(p);
  await f.d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  editor = await f.open();
  await expectSource(sourceEditor(editor), '');
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await f.d.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  editor = await f.open();
  await expectSource(sourceEditor(editor), source);
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByTitle('Save symbol changes and return to the scene').click();
  await expect(f.d).toHaveCount(0);
  const saved = await f.read(),
    expected = structuredClone(p);
  expected.symbols![0].timeline!.frameScripts!.splice(1, 0, { frame: 1, source });
  expect(saved).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(saved);
  expect(f.errors).toEqual([]);
});

test('symbol frame context attaches the starter and saves edits in the symbol draft', async ({ page }) => {
  const p = fixture();
  const f = await isolated(page, p, false, 2, true);
  const grid = f.d.getByRole('region', { name: 'Symbol frame grid', exact: true });
  const editor = f.d.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(editor.getByRole('heading', { name: 'TypeScript for symbol frame 2', exact: true })).toBeVisible();
  await expectSource(sourceEditor(editor), frameScriptStarter);
  await expect(grid.locator('[data-symbol-frame="1"]').first()).toHaveAccessibleDescription('Frame script attached');
  const badge = grid.locator('[data-symbol-frame="1"]').first().getByTitle('Frame script', { exact: true });
  await expect(badge).toHaveText('S');
  await expect(grid.getByRole('columnheader', { name: '2', exact: true })).toHaveText('2');
  const position = await badge.evaluate(node => {
    const badgeBounds = node.getBoundingClientRect();
    const cell = node.parentElement!.getBoundingClientRect();
    return { centerOffset: (badgeBounds.left + badgeBounds.width / 2) - (cell.left + cell.width / 2), topInset: badgeBounds.top - cell.top };
  });
  expect(Math.abs(position.centerOffset)).toBeLessThan(1);
  expect(position.topInset).toBeGreaterThan(0);
  expect(position.topInset).toBeLessThan(5);
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await expect(grid.locator('[data-symbol-frame="0"]').first()).toHaveAccessibleDescription('Frame script attached');
  await grid.locator('[data-symbol-frame="1"]').click({ button: 'right' });
  await f.d.getByRole('menuitem', { name: 'Script…', exact: true }).click();
  const list = editor.getByRole('group', { name: 'Frame scripts', exact: true });
  await expect(list.getByRole('button', { name: 'Frame 1', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Frame 2', exact: true })).toBeVisible();
  await fillSource(sourceEditor(editor), 'state.local = true;');
  await expect(editor.getByLabel('Frame save status')).toHaveText('Frame changes pending.');
  await sourceEditor(editor).press('Control+s');
  await expect(editor.getByLabel('Frame save status')).toHaveText('Frame changes saved to the symbol draft.');
  await expect(sourceEditor(editor)).toBeFocused();
  await fillSource(sourceEditor(editor), 'state.local = false;');
  await expect(grid.locator('[data-symbol-frame="1"]').first()).toHaveAccessibleDescription('Frame script attached');
  expect(await f.read()).toEqual(p);
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true })
    .evaluate(button => (button as HTMLButtonElement).click());
  await expect(f.d).toHaveCount(0);
  await page.getByTitle('Save symbol changes and return to the scene').click();
  expect((await f.read()).symbols?.[0].timeline?.frameScripts?.[1])
    .toEqual({ frame: 1, source: 'state.local = false;' });
});

test('Script can attach a first frame body to a static symbol without changing its artwork', async ({ page }) => {
  const p = fixture();
  delete p.symbols![0].timeline;
  p.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'loop', firstFrame: 0 };
  const f = await isolated(page, p, false, 1);
  const editor = f.d.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expectSource(sourceEditor(editor), frameScriptStarter);
  await fillSource(sourceEditor(editor), 'timeline.stop();');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(f.d.locator('[data-symbol-frame="0"]').first()).toHaveAccessibleDescription('Frame script attached');
  expect(await f.read()).toEqual(p);
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByTitle('Save symbol changes and return to the scene').click();
  const definition = (await f.read()).symbols![0];
  expect(definition.shapes).toEqual(p.symbols![0].shapes);
  expect(definition.timeline).toMatchObject({
    duration: 1, keys: [], frameScripts: [{ frame: 0, source: 'timeline.stop();' }],
  });
});
test('local empty source and Remove retain distinct data and Cancel leaves the document exact', async ({
  page,
}) => {
  const p = fixture(),
    f = await isolated(page, p);
  let editor = await f.open();
  await fillSource(sourceEditor(editor), '');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  editor = await f.open();
  await expectSource(sourceEditor(editor), '');
  await editor.getByRole('button', { name: 'Remove frame source', exact: true }).click();
  editor = await f.open();
  await expectSource(sourceEditor(editor), '');
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByTitle('Save symbol changes and return to the scene').click();
  const expected = structuredClone(p);
  expected.symbols![0].timeline!.frameScripts!.shift();
  expect(await f.read()).toEqual(expected);
  await page
    .getByRole('option', { name: 'Library item Local sources', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  editor = await f.open();
  await fillSource(sourceEditor(editor), 'discard me');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await f.d.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('local lazy code editor checks without execution and closes owned workers on Cancel', async ({
  page,
}) => {
  const f = await isolated(page),
    workers: { closed: boolean }[] = [];
  page.on('worker', (worker) => {
    const item = { closed: false };
    workers.push(item);
    worker.on('close', () => (item.closed = true));
  });
  const before = await f.read(),
    editor = await f.open();
  await fillSource(sourceEditor(editor), 'timeline.gotoAndStop(false);');
  await expect(
    editor.getByRole('textbox', { name: 'Frame source code editor', exact: true }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('diagnostic');
  await editor
    .getByRole('button', { name: /Line 1, column/ })
    .first()
    .click();
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await expect.poll(() => workers.filter((w) => !w.closed).length).toBe(0);
  expect(await f.read()).toEqual(before);
  expect(f.errors).toEqual([]);
});
for (const change of ['frame', 'history', 'source'] as const)
  test(`local pending source rejects actual ${change} changes and allows a fresh editor`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await isolated(page, p);
    await f.at(2);
    let editor = await f.open();
    if (change === 'frame') await f.at(3);
    if (change === 'history') {
      await fillSource(sourceEditor(editor), 'temporary');
      await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
      editor = await f.open();
      await f.d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
    }
    if (change === 'source')
      await page
        .locator('button[aria-label="Add layer"]')
        .evaluate((el) => (el as HTMLButtonElement).click());
    await fillSource(sourceEditor(editor), 'stale');
    await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
    await expect(editor.getByLabel('Frame save status')).toContainText(/changed/);
    await expectSource(sourceEditor(editor), 'stale');
    expect((await f.read()).symbols).toEqual(p.symbols);
    await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
    await expectSource(sourceEditor(editor), 'stale');
    await editor.getByRole('button', { name: 'Discard local frame draft', exact: true }).click();
    if (change !== 'source') {
      editor = await f.open();
      await fillSource(sourceEditor(editor), 'fresh');
      await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
      await expect(editor).toHaveCount(0);
    }
    expect(f.errors).toEqual([]);
  });
test('local source budget rejection preserves text on Escape, navigation and parent Apply', async ({
  page,
}) => {
  const p = fixture(),
    used = p.symbols![0].timeline!.frameScripts!.reduce(
      (sum, entry) => sum + new TextEncoder().encode(entry.source).byteLength,
      0,
    );
  p.frameScripts = [{ frame: 0, source: 'x'.repeat(256 * 1024 - used) }];
  const f = await isolated(page, p);
  await f.at(2);
  const editor = await f.open();
  await fillSource(sourceEditor(editor), 'é');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('budget');
  await expectSource(sourceEditor(editor), 'é');
  expect(await f.read()).toEqual(p);
  await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).press('Escape');
  const discard = editor.getByRole('button', { name: 'Discard local frame draft', exact: true });
  await expect(discard).toBeVisible();
  await editor.getByRole('button', { name: 'Frame 1', exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'TypeScript for symbol frame 2' })).toBeVisible();
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expectSource(sourceEditor(editor), 'é');
  expect(await f.read()).toEqual(p);
  await discard.click();
  await expect(editor).toHaveCount(0);
  await f.d.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(p);
});
for (const action of ['text', 'close', 'project'] as const)
  test(`local source rejects ${action} changes after detached source assignment`, async ({
    page,
  }) => {
    const p = fixture();
    if (action === 'close') {
      const localBytes = p.symbols![0].timeline!.frameScripts!.reduce(
        (sum, entry) => sum + new TextEncoder().encode(entry.source).byteLength, 0,
      );
      p.frameScripts = [{ frame: 0, source: 'x'.repeat(256 * 1024 - localBytes - 64) }];
    }
    const f = await isolated(page, p);
    await f.at(2);
    const editor = await f.open();
    if (action === 'close') {
      await fillSource(sourceEditor(editor), 'é'.repeat(64));
      await editor.getByRole('button', { name: 'Close local source editor', exact: true })
        .evaluate(button => (button as HTMLButtonElement).click());
      await expect(editor.getByRole('button', { name: 'Discard local frame draft', exact: true })).toBeVisible();
    }
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      Reflect.set(window, 'localSourceHook', false);
      JSON.stringify = function (value: unknown, ...rest: unknown[]) {
        const candidate = value as Project;
        if (
          !Reflect.get(window, 'localSourceHook') &&
          candidate?.schemaVersion === 59 &&
          candidate.symbols?.some((s) =>
            s.timeline?.frameScripts?.some((e) => e.source === 'late-local-source'),
          )
        ) {
          Reflect.set(window, 'localSourceHook', true);
          if (action === 'text') {
            const input = document.querySelector(
              'section[aria-label="Local frame source editor"] textarea',
            ) as HTMLTextAreaElement;
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', 'new authoritative text');
            input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
          } else {
            const label = action === 'close' ? 'Discard local frame draft' : 'Add layer';
            const button = [...document.querySelectorAll('button')].find(
              (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label,
            );
            button?.click();
          }
        }
        return Reflect.apply(stringify, JSON, [value, ...rest]);
      } as typeof JSON.stringify;
    }, action);
    await fillSource(sourceEditor(editor), 'late-local-source');
    await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
    expect(await page.evaluate(() => Reflect.get(window, 'localSourceHook'))).toBe(true);
    if (action === 'close') {
      await expect(editor).toHaveCount(0);
      const reopened = await f.open();
      await expectSource(sourceEditor(reopened), '');
      await reopened.getByRole('button', { name: 'Close local source editor', exact: true }).click();
    } else if (action === 'project') await expect(editor.getByLabel('Frame save status')).toContainText(/changed|disposed|unavailable/);
    expect((await f.read()).symbols).toEqual(p.symbols);
    if (action === 'project') expect((await f.read()).layers).toHaveLength(p.layers.length + 1);
    if (action === 'text') {
      await expectSource(sourceEditor(editor),
        'late-local-sourcenew authoritative text',
      );
      await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
      await expect(editor).toHaveCount(0);
      const fresh = await f.open();
      await expectSource(sourceEditor(fresh),
        'late-local-sourcenew authoritative text',
      );
      await fresh.getByRole('button', { name: 'Close local source editor', exact: true }).click();
      await f.d.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(p);
    }
    expect(f.errors).toEqual([]);
  });
test('parent Apply rejects a real project edit after complete local-source candidate serialization', async ({
  page,
}) => {
  const p = fixture(),
    f = await isolated(page, p);
  await f.at(2);
  const editor = await f.open();
  await fillSource(sourceEditor(editor), 'parent-late-source');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    Reflect.set(window, 'parentSourceHook', false);
    JSON.stringify = function (value: unknown, ...rest: unknown[]) {
      const candidate = value as Project;
      if (
        !Reflect.get(window, 'parentSourceHook') &&
        candidate?.schemaVersion === 59 &&
        candidate.symbols?.some((s) =>
          s.timeline?.frameScripts?.some((e) => e.source === 'parent-late-source'),
        )
      ) {
        Reflect.set(window, 'parentSourceHook', true);
        [...document.querySelectorAll('button')]
          .find((b) => b.getAttribute('aria-label') === 'Add layer')
          ?.click();
      }
      return Reflect.apply(stringify, JSON, [value, ...rest]);
    } as typeof JSON.stringify;
  });
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'parentSourceHook'))).toBe(true);
  await expect(f.d.getByRole('alert')).toContainText(/changed/);
  const saved = await f.read();
  expect(saved.symbols).toEqual(p.symbols);
  expect(saved.layers).toHaveLength(p.layers.length + 1);
  await f.d.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  expect(f.errors).toEqual([]);
});
test('local no-op code editing preserves authored CRLF and BOM without creating history', async ({
  page,
}) => {
  const p = fixture(),
    f = await isolated(page, p);
  await f.at(3);
  const editor = await f.open();
  await expect(
    editor.getByRole('textbox', { name: 'Frame source code editor', exact: true }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    f.d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await f.d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});
test('local source rejects actual enclosing Undo during detached preparation before props can update', async ({
  page,
}) => {
  const p = fixture(),
    f = await isolated(page, p, true);
  await f.at(2);
  const editor = await f.open();
  expect((await f.read()).layers).toHaveLength(2);
  await page
    .getByRole('button', { name: 'Edit', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent?.trim().startsWith('Undo Add layer') && !b.disabled,
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    Reflect.set(window, 'sourceUndoHook', false);
    JSON.stringify = function (value: unknown, ...rest: unknown[]) {
      const p = value as Project;
      if (
        !Reflect.get(window, 'sourceUndoHook') &&
        p?.schemaVersion === 59 &&
        p.symbols?.some((s) =>
          s.timeline?.frameScripts?.some((e) => e.source === 'undo-source-hook'),
        )
      ) {
        const button = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.trim().startsWith('Undo Add layer'),
        );
        if (!button) throw Error('Missing actual Undo');
        Reflect.set(window, 'sourceUndoHook', true);
        button.click();
      }
      return Reflect.apply(stringify, JSON, [value, ...rest]);
    } as typeof JSON.stringify;
  });
  await fillSource(sourceEditor(editor), 'undo-source-hook');
  await editor.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
  expect(await page.evaluate(() => Reflect.get(window, 'sourceUndoHook'))).toBe(true);
  await expect(editor.getByLabel('Frame save status')).toContainText(/changed/);
  expect(await f.read()).toEqual(p);
  await editor.getByRole('button', { name: 'Close local source editor', exact: true }).click();
  await editor.getByRole('button', { name: 'Discard local frame draft', exact: true }).click();
  await f.d.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await f.read()).layers.length).toBe(2);
  expect((await f.read()).symbols).toEqual(p.symbols);
  expect(f.errors).toEqual([]);
});
