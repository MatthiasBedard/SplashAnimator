import { test, expect } from '@playwright/test';
import { newProject, validateProject, type Project } from '../../packages/document/src';

test('empty space below the first layer opens layer actions and can add a layer', async ({ page }) => {
  const project = newProject();
  await page.addInitScript((project) => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
  ), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const list = page.getByRole('group', { name: 'Timeline layers', exact: true });
  const row = list.locator('.layer-row').first();
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + box.height + 5, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add layer', exact: true }).click();
  await expect(list.locator('.layer-row')).toHaveCount(2);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(list.locator('.layer-row')).toHaveCount(1);
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Add layer', exact: true })).toBeEnabled();
});

test('canvas context actions select artwork, undo, navigate and dismiss safely', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [{
    id: 'context-rectangle', kind: 'rectangle',
    x: project.width / 2 - 50, y: project.height / 2 - 40,
    width: 100, height: 80, rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  }];
  validateProject(project);
  await page.addInitScript(
    (project) => localStorage.setItem(
      'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
    ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!,
    x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Fit stage' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(canvas).toBeFocused();
  expect(await read()).toEqual(before);
  await page.mouse.click(x, y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  expect((await read()).layers[0].keys[0].shapes).toHaveLength(2);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.getByLabel('Toggle lock Layer 1').click();
  await page.mouse.click(x, y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.mouse.click(b.x + 20, b.y + 20);
  await expect(menu).toHaveCount(0);
});

test('timeline context menu preserves ranges and inserts at the clicked frame', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Timeline frames'),
    b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + 27, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 81, b.y + 40);
  await page.keyboard.up('Shift');
  await page.mouse.click(b.x + 45, b.y + 40, { button: 'right' });
  await expect(page.getByText('Frames 2–5 · 4 selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(b.x + 153, b.y + 40, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert blank keyframe' }).click();
  const keys = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys,
  );
  expect(keys.map((k: { frame: number }) => k.frame)).toEqual([0, 8]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});

test('a keyboard-selected scene frame range can be picked up and moved by dragging', async ({ page }) => {
  const project = newProject();
  project.duration = 12;
  const shape = {
    id: 'moving', kind: 'rectangle' as const, x: 100, y: 100, width: 30, height: 30,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  project.layers[0].keys.push(
    { frame: 2, shapes: [shape] },
    { frame: 3, shapes: [{ ...shape, fill: '#0000ff' }] },
    { frame: 4, shapes: [] },
  );
  validateProject(project);
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const grid = page.getByLabel('Timeline frames', { exact: true });
  const box = (await grid.boundingBox())!;
  await grid.press('ArrowRight');
  await grid.press('ArrowRight');
  await grid.press('Shift+ArrowRight');
  await expect(grid).toHaveAccessibleDescription(/Frame 4 of 12.*Frames 3 to 4 selected/);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  expect(await read()).toEqual(project);
  await page.mouse.move(box.x + 2 * 18 + 8, box.y + 39);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 * 18 + 8, box.y + 39, { steps: 4 });
  await page.mouse.up();
  const moved = structuredClone(project);
  const [start, red, blue, gap] = moved.layers[0].keys;
  moved.layers[0].keys = [start, gap, { ...red, frame: 6 }, { ...blue, frame: 7 }];
  await expect.poll(read).toEqual(moved);
  await expect(grid).toHaveAccessibleDescription(/Frame 7 of 12.*Frames 7 to 8 selected/);
  await grid.press('Control+z');
  await expect.poll(read).toEqual(project);
});

test('a scene ruler menu with only a disabled command can be dismissed by keyboard', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  await page.addInitScript(
    (project) => localStorage.setItem(
      'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
    ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const timeline = page.getByLabel('Timeline frames');
  const box = (await timeline.boundingBox())!;
  await timeline.focus();
  await page.mouse.click(box.x + 150, box.y + 10, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await expect(menu.getByRole('menuitem', { name: 'Script…' })).toBeDisabled();
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(timeline).toBeFocused();
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 2/);
  const read = () => page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
  );
  expect(await read()).toEqual(project);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F6');
  await expect.poll(async () => (await read()).layers[0].keys.map(key => key.frame)).toEqual([0, 1]);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(project);
});

test('keyboard context menu focus remains visible in forced colors', async ({ page }) => {
  const project = newProject();
  project.duration = 12;
  await page.addInitScript(
    (project) => localStorage.setItem(
      'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
    ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await page.emulateMedia({ forcedColors: 'active' });
  const palette = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'forced-color-adjust:none;background:Highlight;color:HighlightText';
    document.body.append(probe);
    const css = getComputedStyle(probe);
    const colors = { background: css.backgroundColor, text: css.color };
    probe.remove();
    return colors;
  });
  const timeline = page.getByLabel('Timeline frames');
  await timeline.press('ArrowRight');
  await timeline.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  const first = menu.getByRole('menuitem', { name: 'Insert frame', exact: true });
  const key = menu.getByRole('menuitem', { name: 'Insert keyframe', exact: true });
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS('background-color', palette.background);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(key).toBeFocused();
  await expect(key).toHaveCSS('background-color', palette.background);
  await expect(key).toHaveCSS('color', palette.text);
  await expect(key).toHaveCSS('outline-style', 'solid');
  await expect(first).not.toHaveCSS('background-color', palette.background);
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(key).toHaveCSS('background-color', 'rgb(80, 82, 118)');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.keyboard.press('Escape');
  await expect(timeline).toBeFocused();
  const read = () => page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
  );
  expect(await read()).toEqual(project);
  await timeline.press('Shift+F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(key).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await read()).layers[0].keys.map(k => k.frame)).toEqual([0, 1]);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(project);
});

test('layer and folder context actions target the clicked row', async ({ page }) => {
  const p = newProject();
  p.folders = [{ id: 'folder', name: 'Artwork' }];
  p.layers[0].folderId = 'folder';
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await page
    .getByRole('group', { name: 'Layer row Layer 1', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Lock layer', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].locked,
    ),
  ).toBe(true);
  await page
    .getByRole('group', { name: 'Folder row Artwork', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unlock folder layers', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].locked,
    ),
  ).toBe(false);
});

test('bitmap menus support keyboard invocation, rename, placement and reference protection', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d')!.fillRect(0, 0, 16, 16);
    return c.toDataURL().split(',')[1];
  });
  await page
    .getByLabel('Import bitmap', { exact: true })
    .setInputFiles({
      name: 'tile.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes, 'base64'),
    });
  let card = page.getByRole('option', { name: 'Library item tile.png', exact: true });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const input = page.getByLabel('Rename library item tile.png', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('Tile');
  await input.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await input.press('Enter');
  card = page.getByRole('option', { name: 'Library item Tile', exact: true });
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Place bitmap on stage', exact: true }).click();
  await expect(page.getByText('Place bitmap', { exact: true })).toBeVisible();
  await card.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('listbox',{name:'Library items',exact:true})).toBeFocused();
});

test('keyboard canvas menus retain Bezier selection and expose path actions with undo', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: 'curve',
      kind: 'bezier',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 2,
      points: [],
      closed: false,
      nodes: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage');
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Smooth selected anchors', exact: true }),
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Close Bezier path', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys[0].shapes[0]
          .closed,
    ),
  ).toBe(true);
  await page.keyboard.press('Control+z');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});
