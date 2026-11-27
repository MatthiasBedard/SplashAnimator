import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { readFile } from 'node:fs/promises';
import { saveProject } from '../../packages/document/src/storage';

async function recoverFromStartup(page: Page) {
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
}

async function setup(page: Page, project: Project = newProject()) {
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await recoverFromStartup(page);
  return () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
}
const body = (page: Page, id: string) => page.locator(`#dock-body-${id}`);
async function windowMenu(page: Page) {
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  return page.locator('.window-menu');
}
async function group(page: Page, title: string, target: string) {
  await page.getByLabel(`Panel options ${title}`, { exact: true }).click();
  await page.getByLabel(`Tab ${title} with`, { exact: true }).selectOption(target);
}

test('Color panel applies and edits palette swatches and remembers the palette', async ({ page }) => {
  await setup(page);
  const panel = body(page, 'color');
  await expect(panel.getByRole('group', { name: 'Palette swatches' }).getByRole('button')).toHaveCount(48);
  await panel.getByRole('button', { name: 'Palette #2389ED', exact: true }).click();
  await expect(page.getByLabel('Drawing fill', { exact: true })).toHaveValue('#2389ed');
  const hex = panel.getByLabel('Paint hex');
  await hex.fill('#156a73');
  await hex.press('Enter');
  await panel.getByRole('button', { name: 'Add current color' }).click();
  await expect(panel.getByRole('button', { name: 'Palette #156A73', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Edit swatches', exact: true }).click();
  await panel.getByRole('button', { name: 'Palette #000000', exact: true }).click();
  const slot = panel.getByLabel('Palette swatch hex');
  await slot.fill('#123456');
  await slot.press('Enter');
  await panel.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect(page.getByLabel('Drawing fill', { exact: true })).toHaveValue('#156a73');
  await page.reload();
  await recoverFromStartup(page);
  await expect(panel.getByRole('button', { name: 'Palette #123456', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Palette #000000', exact: true })).toHaveCount(0);
  const toggle = (await windowMenu(page)).getByRole('button', { name: 'Color', exact: true });
  await toggle.click();
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel.getByRole('button', { name: 'Palette #156A73', exact: true })).toBeVisible();
});

test('Color panel collects artwork swatches and applies them to a selection with Undo', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 320;
  project.background = '#f2dad9';
  const rectangle = { id:'rectangle', kind:'rectangle' as const, drawingMode:'object' as const,
    x:110, y:100, width:100, height:80, rotation:0, fill:'#123b62', stroke:'#306577', strokeWidth:3, points:[] };
  project.layers[0].keys[0].shapes = [rectangle];
  project.layers[0].drawingMode = 'object';
  project.symbols = [{ id:'accent', name:'Accent', width:100, height:80,
    shapes:[{ ...rectangle, id:'accent-fill', fill:'#34b76d' }] }];
  const read = await setup(page, project);
  const panel = body(page, 'color');
  await panel.getByText('Project colors', { exact:true }).click();
  for (const color of ['F2DAD9','123B62','306577','34B76D'])
    await expect(panel.getByRole('button', { name:`Project #${color}`, exact:true })).toBeVisible();
  await page.getByRole('combobox', { name:'Zoom', exact:true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact:true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x+(box.width-400)/2+142, box.y+(box.height-320)/2+130);
  await panel.getByLabel('Color target').selectOption('selection-fill');
  await panel.getByRole('button', { name:'Project #34B76D', exact:true }).click();
  await expect.poll(async()=> (await read()).layers[0].keys[0].shapes[0].fill).toBe('#34b76d');
  const hex = panel.getByLabel('Paint hex');
  await expect(hex).toHaveValue('#34B76D');
  await hex.fill('#4a8fb7');
  await hex.press('Enter');
  await expect(panel.getByRole('button', { name:'Project #4A8FB7', exact:true })).toBeVisible();
  await canvas.press('Control+z');
  await expect.poll(async()=> (await read()).layers[0].keys[0].shapes[0].fill).toBe('#34b76d');
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(project);
});

test('panel options toggle off on the same dots and switch to only one other menu', async ({ page }) => {
  await setup(page);
  const layer = page.getByLabel('Panel options Layer', { exact: true });
  const document = page.getByLabel('Panel options Document settings', { exact: true });
  const open = page.locator('.dock-options-menu:popover-open');

  await layer.click();
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute('id', 'dock-options-layer');
  await layer.click();
  await expect(open).toHaveCount(0);
  await expect(layer.locator('..')).not.toHaveAttribute('open');

  await layer.click();
  await document.click();
  await expect(open).toHaveCount(1);
  await expect(open).toHaveAttribute('id', 'dock-options-document');
  await expect(layer.locator('..')).not.toHaveAttribute('open');
  await document.click();
  await expect(open).toHaveCount(0);
});

for (const side of ['left', 'right'] as const) {
  test(`panel options overlay the canvas from narrow ${side}-docked Properties`, async ({ page }) => {
    await page.setViewportSize({ width: 540, height: 590 });
    await page.addInitScript(side => localStorage.setItem('splash-panel-layout-v1', JSON.stringify({
      version: 1, sidebarVisible: true, sidebarDock: side, hidden: [], collapsed: [], groups: [],
      sizes: { inspector: 180 },
    })), side);
    await setup(page);
    const trigger = page.getByLabel('Panel options Layer', { exact: true });
    const popup = page.locator('#dock-options-layer');
    const chooser = popup.getByLabel('Tab Layer with', { exact: true });
    await expect(trigger).toHaveText('⋯');
    await expect(trigger).toHaveCSS('list-style-type', 'none');
    await trigger.click();
    await expect(popup).toBeVisible();
    const placement = await popup.evaluate(menu => {
      const rect = menu.getBoundingClientRect();
      const sidebar = document.getElementById('properties-sidebar')!.getBoundingClientRect();
      const trigger = menu.parentElement!.querySelector('summary')!.getBoundingClientRect();
      const field = menu.querySelector('select')!.getBoundingClientRect();
      const x = field.left + 4;
      const y = field.top + field.height / 2;
      return {
        inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        opensLeft: Math.abs(rect.right - trigger.right) < 1 && rect.left < trigger.left,
        outsideSidebar: x < sidebar.left,
        pointerHitsField: document.elementFromPoint(x, y) === menu.querySelector('select'),
      };
    });
    expect(placement).toEqual({ inViewport: true, opensLeft: true, outsideSidebar: true, pointerHitsField: true });
    await chooser.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(popup).toBeVisible();
    await page.getByRole('button', { name: 'Collapse Document settings panel', exact: true }).click();
    await expect(popup).toBeHidden();
  });
}

test('component styles keep header controls compact and canvases interactive', async ({ page }) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null })), project);
  await page.goto('/');
  const recovery = page.getByRole('button', { name: 'Recover changes', exact: true });
  const publish = page.getByRole('button', { name: 'Export', exact: true });
  await expect(recovery).toBeVisible();
  const header = (await page.locator('.menubar').boundingBox())!;
  const exportBox = (await publish.boundingBox())!;
  expect(exportBox.width).toBeLessThan(140);
  expect(header.x + header.width - exportBox.x - exportBox.width).toBeLessThan(20);
  expect((await recovery.boundingBox())!.width).toBeLessThan(160);
  await recovery.click();

  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const layers = (await page.getByRole('group', { name: 'Timeline layers', exact: true }).boundingBox())!;
  const frames = (await timeline.boundingBox())!;
  expect(frames.x).toBeGreaterThanOrEqual(layers.x + layers.width - 1);
  expect(frames.y).toBeCloseTo(layers.y);
  await expect(timeline).toHaveCSS('pointer-events', 'auto');

  const stage = page.getByLabel('Drawing stage', { exact: true });
  await expect(stage).toHaveCSS('pointer-events', 'auto');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = (await stage.boundingBox())!;
  const x = canvas.x + canvas.width / 2, y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 35, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project;
    return saved.layers[0].keys[0].shapes.map(shape => shape.kind);
  })).toEqual(['rectangle']);
});

test('Properties stays beside the workspace when the window narrows', async ({ page }) => {
  const read = await setup(page), original = await read();
  const props = page.getByRole('complementary', { name: 'Properties', exact: true });
  await expect(props.getByText(/Vector Document Engine|parity is a work in progress/i)).toHaveCount(0);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const divider = page.getByRole('separator', { name: 'Resize properties sidebar', exact: true });
  const originalWidth = (await props.boundingBox())!.width;
  const prefs = () => page.evaluate(() => localStorage.getItem('splash-panel-layout-v1'));
  const originalPrefs = await prefs();
  await page.setViewportSize({ width: 360, height: 700 });
  await expect.poll(() => stage.evaluate(el => el.clientWidth)).toBeGreaterThan(120);
  const canvas = (await stage.boundingBox())!, sidebar = (await props.boundingBox())!;
  expect(sidebar.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
  expect(sidebar.y).toBeLessThan(canvas.y + canvas.height);
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(360);
  await expect(divider).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await expect(page.getByLabel('Timeline frames', { exact: true })).toBeInViewport();
  expect(await prefs()).toBe(originalPrefs);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await props.boundingBox())!.width).toBe(originalWidth);
  expect(await prefs()).toBe(originalPrefs);
  expect(await read()).toEqual(original);
});

test('Group Hierarchy fits long destination and anchor labels in Properties', async ({ page }) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  const group = 'long-destination-'.repeat(5), anchor = 'long-anchor-'.repeat(7);
  const moving = {
    id: 'moving', kind: 'rectangle' as const, x: project.width / 2, y: project.height / 2,
    width: 30, height: 30, rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  project.layers[0].keys[0].shapes = [
    moving, { ...moving, id: anchor, x: moving.x + 120, groups: [group] },
  ];
  const read = await setup(page, project);
  const stage = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2 + 8, stage.y + stage.height / 2 + 8);
  await page.setViewportSize({ width: 512, height: 700 });
  const panel = body(page, 'hierarchy');
  await expect(panel).toBeVisible();
  const destination = panel.getByLabel('Destination group', { exact: true });
  await destination.selectOption(JSON.stringify([group]));
  await panel.getByLabel('Group stack placement').selectOption('before');
  const artwork = panel.getByLabel('Group placement anchor');
  await artwork.selectOption(anchor);
  await panel.getByText('Drag or place selected units', { exact: true }).click();
  await expect.poll(() => panel.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return node.scrollWidth > node.clientWidth || [...node.querySelectorAll('select, legend')].some(control =>
      control.getBoundingClientRect().right > bounds.right,
    );
  })).toBe(false);
  await expect(destination).toHaveValue(JSON.stringify([group]));
  await expect(artwork).toHaveValue(anchor);
  expect(await read()).toEqual(project);
});

test('Properties collapses to a right-edge toggle and restores its width', async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 700 });
  const read = await setup(page), original = await read();
  const props = page.getByRole('complementary', { name: 'Properties', exact: true });
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const divider = page.getByRole('separator', { name: 'Resize properties sidebar', exact: true });
  const collapse = props.getByRole('button', { name: 'Collapse Properties sidebar' });
  const expand = props.getByRole('button', { name: 'Expand Properties sidebar' });
  const width = async () => (await props.boundingBox())!.width;
  await expect.poll(width).toBeLessThan(240);
  const expandedWidth = await width(), canvasWidth = (await stage.boundingBox())!.width;
  await collapse.press('Enter');
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#properties-sidebar-body')).toBeHidden();
  await expect(divider).toHaveCount(0);
  await expect.poll(width).toBe(36);
  await expect.poll(async () => (await stage.boundingBox())!.width).toBeGreaterThan(canvasWidth);
  const rail = (await props.boundingBox())!;
  expect(rail.x + rail.width).toBeCloseTo(512);
  await page.reload();
  await recoverFromStartup(page);
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(divider).toBeVisible();
  await expect.poll(width).toBe(expandedWidth);
  expect(await read()).toEqual(original);
});

test('Help opens About with release details and returns focus when dismissed', async ({ page }) => {
  const { version } = JSON.parse(await readFile(new URL('../../apps/editor/src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { version: string };
  const read = await setup(page), original = await read();
  const help = page.getByRole('button', { name: 'Help', exact: true });
  const about = page.getByRole('dialog', { name: 'About Splash Animator', exact: true });
  const show = async () => {
    await help.click();
    await expect(page.getByRole('button', { name: 'Build status & shortcuts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'About', exact: true }).click();
    await expect(about).toBeVisible();
  };
  await show();
  await expect(about.getByText('2D vector animation editor', { exact: false })).toBeVisible();
  await expect(about.getByText(version, { exact: true })).toBeVisible();
  await expect(about.getByText('Premstream', { exact: true })).toBeVisible();
  await expect(about.getByRole('link', { name: 'splashanimator.com' })).toHaveAttribute('href', 'https://splashanimator.com');
  await expect(about.getByText('Link coming soon', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(about).toHaveCount(0);
  await expect(help).toBeFocused();
  await show();
  await about.getByRole('button', { name: 'Close About', exact: true }).click();
  await expect(about).toHaveCount(0);
  await expect(help).toBeFocused();
  expect(await read()).toEqual(original);
});

test('browser Open dialog contains keyboard focus and restores the invoker on Escape', async ({ page }) => {
  const betaProject = newProject('Beta');
  betaProject.width = 420;
  betaProject.height = 300;
  const files = new Map<string, string>();
  await saveProject({
    async read(path) { return files.get(path)!; },
    async exists(path) { return files.has(path); },
    async writeNew(path, content) { files.set(path, content); },
    async commit(path, content) { files.set(path, content); },
  }, betaProject, null);
  let failRead!: () => void;
  const pending = new Promise<void>(resolve => { failRead = resolve; });
  await page.route('**/api/projects', async (route) => {
    const { op, project, path } = route.request().postDataJSON();
    if (op === 'list') return route.fulfill({ json: { result: ['Alpha.spl', 'Beta.spl'] } });
    if (project === 'Beta.spl' && op === 'read' && files.has(path))
      return route.fulfill({ json: { result: files.get(path) } });
    if (project === 'Beta.spl' && op === 'exists')
      return route.fulfill({ json: { result: files.has(path) } });
    await pending;
    return route.fulfill({ json: { error: 'Fixture folder unavailable.' } });
  });
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await expect(stage).toBeFocused();
  await page.keyboard.press('Control+o');
  const dialog = page.getByRole('dialog', { name: 'Open project', exact: true });
  const alpha = dialog.getByRole('button', { name: /Alpha\.spl/ });
  const beta = dialog.getByRole('button', { name: /Beta\.spl/ });
  await expect(alpha).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(beta).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(stage).toBeFocused();

  const file = page.getByRole('button', { name: 'File', exact: true });
  await page.keyboard.press('F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(alpha).toBeFocused();
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await recovery();
  await page.keyboard.press('Enter');
  const progress = dialog.getByRole('status');
  try {
    await expect(alpha).toBeDisabled();
    await expect(progress).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Escape');
    await expect(progress).toBeFocused();
    expect(await recovery()).toBe(before);
  } finally {
    failRead();
  }
  await expect(dialog.getByRole('alert')).toHaveText('Error: Fixture folder unavailable.');
  await expect(alpha).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(file).toBeFocused();

  await page.keyboard.press('Control+o');
  await expect(alpha).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(beta).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(stage).toBeFocused();
  await expect(page.getByRole('button', { name: 'Switch to Beta', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(body(page, 'document').getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('420');
  await expect(body(page, 'document').getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('300');
  expect(await recovery()).toBeNull();
});

test('opening a saved project focuses its recovery offer and Enter restores the exact draft', async ({ page }) => {
  const project = newProject('Recoverable');
  const recovered = structuredClone(project);
  recovered.width = 525;
  recovered.layers[0].name = 'Recovered ink';
  const files = new Map<string, string>();
  const cleanFiles = new Map<string, string>();
  const fixtureStore = (files: Map<string, string>) => ({
    async read(path: string) { return files.get(path)!; },
    async exists(path: string) { return files.has(path); },
    async writeNew(path: string, content: string) { files.set(path, content); },
    async commit(path: string, content: string) {
      const savedAt = path.startsWith('.splash/') ? '2026-11-22T00:00:10Z' : '2026-11-22T00:00:00Z';
      files.set(path, JSON.stringify({ ...JSON.parse(content), savedAt }));
    },
  });
  const store = fixtureStore(files);
  await saveProject(store, project, null);
  await saveProject(store, recovered, null, true);
  await saveProject(fixtureStore(cleanFiles), newProject('Clean'), null);
  const committed = files.get('project.json');
  await page.route('**/api/projects', route => {
    const { op, project, path } = route.request().postDataJSON();
    const source = project === 'Clean.spl' ? cleanFiles : files;
    if (op === 'list') return route.fulfill({ json: { result: ['Recoverable.spl', 'Clean.spl'] } });
    if (op === 'exists') return route.fulfill({ json: { result: source.has(path) } });
    if (op === 'read' && source.has(path)) return route.fulfill({ json: { result: source.get(path) } });
    return route.fulfill({ json: { error: 'Unexpected fixture operation' } });
  });

  await page.goto('/');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await expect(stage).toBeFocused();
  await page.keyboard.press('Control+o');
  const dialog = page.getByRole('dialog', { name: 'Open project', exact: true });
  await expect(dialog.getByRole('button', { name: /Recoverable\.spl/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(recover).toBeFocused();
  await expect(recover).toHaveAccessibleDescription('Recovery available: Recoverable');
  await expect(body(page, 'document').getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('960');
  await page.keyboard.press('Control+o');
  await dialog.getByRole('button', { name: /Clean\.spl/ }).press('Enter');
  await expect(stage).toBeFocused();
  await expect(recover).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to Clean', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+o');
  await dialog.getByRole('button', { name: /Recoverable\.spl/ }).press('Enter');
  await expect(recover).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(recover).toHaveCount(0);
  await expect(stage).toBeFocused();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project)).toEqual(recovered);
  expect(files.get('project.json')).toBe(committed);
});

test('dismissing recovery with Space returns focus to the current stage', async ({ page }) => {
  const draft = newProject('Discardable draft');
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), draft);
  await page.goto('/');
  const banner = page.locator('[data-project-recovery]');
  const recover = banner.getByRole('button', { name: 'Recover changes', exact: true });
  await recover.focus();
  await page.keyboard.press('Tab');
  await expect(banner.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(banner).toHaveCount(0);
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBeNull();
});

test('Window shows/hides every property panel and the entire sidebar without document edits', async ({
  page,
}) => {
  const read = await setup(page),
    original = await read();
  const menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Layer', exact: true }).click();
  await expect(body(page, 'layer')).toBeHidden();
  await menu.getByRole('button', { name: 'Layer', exact: true }).click();
  await expect(body(page, 'layer')).toBeVisible();
  const width = await page
    .getByLabel('Drawing stage', { exact: true })
    .evaluate((n) => n.clientWidth);
  await menu.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  await expect(page.locator('aside.inspector')).toBeHidden();
  await expect
    .poll(() => page.getByLabel('Drawing stage', { exact: true }).evaluate((n) => n.clientWidth))
    .toBeGreaterThan(width);
  await menu.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  await expect(body(page, 'layer')).toBeVisible();
  expect(await read()).toEqual(original);
});

test('collapse preserves mounted fields and changing their values still has exact Undo', async ({
  page,
}) => {
  const read = await setup(page),
    original = await read(),
    input = page.getByLabel('Layer name', { exact: true });
  const handle = await input.elementHandle();
  await page.getByRole('button', { name: 'Collapse Layer panel', exact: true }).click();
  await expect(input).toBeHidden();
  expect(await handle!.evaluate((n) => n.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Collapse Layer panel', exact: true }).click();
  await input.fill('My layer');
  await input.press('Tab');
  await expect.poll(async () => (await read()).layers[0].name).toBe('My layer');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: /^Undo Rename layer/ }).click();
  await expect.poll(read).toEqual(original);
});

test('tab groups switch with pointer and keyboard, preserve DOM and separate again', async ({
  page,
}) => {
  const read = await setup(page),
    original = await read(),
    input = await page.getByLabel('Layer name', { exact: true }).elementHandle();
  await group(page, 'Layer', 'document');
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(body(page, 'document')).toBeHidden();
  await page.getByRole('tab', { name: 'Document settings', exact: true }).click();
  await expect(body(page, 'document')).toBeVisible();
  await expect(body(page, 'layer')).toBeHidden();
  expect(await input!.evaluate((n) => n.isConnected)).toBe(true);
  await page.getByRole('tab', { name: 'Document settings', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toBeFocused();
  await expect(body(page, 'layer')).toBeVisible();
  await page.getByLabel('Panel options Layer', { exact: true }).click();
  await page.getByRole('button', { name: 'Separate panel', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toHaveCount(0);
  await expect(body(page, 'document')).toBeVisible();
  expect(await read()).toEqual(original);
});

test('panel grouping and separation return keyboard focus to the moved panel', async ({ page }) => {
  const read = await setup(page), original = await read();
  const options = page.getByLabel('Panel options Layer', { exact: true });
  const layerInput = await page.getByLabel('Layer name', { exact: true }).elementHandle();
  await options.press('Enter');
  await page.keyboard.press('Tab');
  const chooser = page.getByLabel('Tab Layer with', { exact: true });
  await expect(chooser).toBeFocused();
  await chooser.selectOption('document');
  const layer = page.getByRole('tab', { name: 'Layer', exact: true });
  await expect(layer).toBeFocused();
  await expect(layer).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Document settings', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await options.press('Enter');
  await page.getByRole('button', { name: 'Separate panel', exact: true }).press('Enter');
  await expect(options).toBeFocused();
  await expect(layer).toHaveCount(0);
  await expect(body(page, 'layer')).toBeVisible();
  expect(await layerInput!.evaluate(input => input.isConnected)).toBe(true);
  expect(await read()).toEqual(original);
});

test('multiple groups retain members when a tab moves between groups', async ({ page }) => {
  await setup(page);
  await group(page, 'Layer', 'document');
  await group(page, 'Library', 'defaults');
  await group(page, 'Layer', 'library');
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Drawing defaults', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toBeVisible();
  await expect(body(page, 'document')).toBeVisible();
  await page.getByRole('tab', { name: 'Library', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Layer', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Drawing defaults', exact: true })).toBeFocused();
});

test('preferences survive reload independently of recovery and reset restores all panels', async ({
  page,
}) => {
  const read = await setup(page),
    original = await read();
  await group(page, 'Layer', 'document');
  await page.getByRole('button', { name: 'Collapse Layer panel', exact: true }).click();
  let menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Drawing defaults', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('splash-panel-layout-v1'));
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('splash-panel-layout-v1'))).toBe(saved);
  await expect(body(page, 'layer')).toBeHidden();
  await expect(body(page, 'defaults')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Reset panel layout', exact: true }).click();
  await expect(body(page, 'layer')).toBeVisible();
  await expect(body(page, 'defaults')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(await read()).toEqual(original);
});

test('context panels retain grouping and visibility when switching tools', async ({ page }) => {
  const read = await setup(page),
    original = await read();
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await group(page, 'Brush', 'layer');
  await expect(page.getByRole('tab', { name: 'Brush', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await expect(body(page, 'layer')).toBeVisible();
  await expect(body(page, 'brush')).toHaveCount(0);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Brush', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Brush simplify amount', { exact: true })).toBeVisible();
  expect(await read()).toEqual(original);
});

test('numeric tool drafts survive hide, collapse, tabs and sidebar changes', async ({ page }) => {
  const read = await setup(page),
    original = await read();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const input = page.getByLabel('Pencil finish simplify', { exact: true });
  await input.fill('83');
  const node = await input.elementHandle();
  await group(page, 'Pencil', 'layer');
  await page.getByRole('tab', { name: 'Layer', exact: true }).click();
  await page.getByRole('tab', { name: 'Pencil', exact: true }).click();
  await expect(input).toHaveValue('83');
  await page.getByRole('button', { name: 'Collapse Pencil panel', exact: true }).click();
  const menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  await menu.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  await menu.getByRole('button', { name: 'Expand all panels', exact: true }).click();
  await expect(input).toHaveValue('83');
  expect(await node!.evaluate((n) => n.isConnected)).toBe(true);
  expect(await read()).toEqual(original);
});

test('show all panels recovers hidden headers while respecting tab membership', async ({
  page,
}) => {
  await setup(page);
  await group(page, 'Layer', 'document');
  await page.getByLabel('Panel options Layer', { exact: true }).click();
  await page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await expect(body(page, 'document')).toBeVisible();
  await expect(body(page, 'layer')).toBeHidden();
  const menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Show all panels', exact: true }).click();
  await expect(body(page, 'layer')).toBeVisible();
  await expect(body(page, 'document')).toBeHidden();
});

test('malformed workspace storage recovers without changing the project', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('splash-panel-layout-v1', '{"version":1,"groups":null}'),
  );
  const original = newProject(),
    read = await setup(page, original);
  expect(await read()).toEqual(original);
  await expect(body(page, 'document')).toBeVisible();
  await expect(body(page, 'layer')).toBeVisible();
});

test('tabbed controls retain live sampled read-only admission', async ({ page }) => {
  const original = liveSplitFixture(),
    read = await setup(page, original);
  await group(page, 'Layer', 'document');
  const layer = body(page, 'layer');
  const sidebar = page.locator('#properties-sidebar');
  const footer = page.locator('footer');
  const before = await Promise.all([sidebar.boundingBox(), footer.boundingBox()]);
  expect(before.every(Boolean)).toBe(true);
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(footer.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
  await expect(sidebar.getByLabel('Live stage status', { exact: true })).toHaveCount(0);
  await expect(layer).toHaveAttribute('inert', '');
  expect(await Promise.all([sidebar.boundingBox(), footer.boundingBox()])).toEqual(before);
  await expect(body(page, 'document')).toHaveAttribute('inert', '');
  const menu = await windowMenu(page);
  await menu.getByRole('button', { name: 'Reset panel layout', exact: true }).click();
  await expect(body(page, 'layer')).toHaveAttribute('inert', '');
  await page.getByTitle('First frame', { exact: true }).click();
  await expect(page.getByLabel('Live stage status', { exact: true })).toHaveCount(0);
  expect(await read()).toEqual(original);
});

test('unfinished opacity channel edits remain mounted through grouping, collapse and tab changes', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const read = await setup(page, p);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+a');
  await body(page, 'opacity')
    .getByRole('button', { name: 'Add opacity channel', exact: true })
    .click();
  const field = body(page, 'opacity').getByLabel('Opacity (%)', { exact: true }).first();
  await field.fill('37');
  const handle = await field.elementHandle();
  await group(page, 'Opacity channel', 'layer');
  await page.getByRole('tab', { name: 'Layer', exact: true }).click();
  await expect(field).toBeHidden();
  expect(await handle!.evaluate((n) => n.isConnected)).toBe(true);
  await page.getByRole('tab', { name: 'Opacity channel', exact: true }).click();
  await expect(field).toHaveValue('37');
  await page.getByRole('button', { name: 'Collapse Opacity channel panel', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Opacity channel panel', exact: true }).click();
  await expect(field).toHaveValue('37');
  await page.screenshot({ path: 'test-results/panel-tabs.png' });
  await body(page, 'opacity').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await read()).toEqual(p);
});

test('unavailable preference storage leaves workspace controls usable', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem,
      write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'splash-panel-layout-v1') throw Error('Unavailable');
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'splash-panel-layout-v1') throw Error('Unavailable');
      write.call(this, key, value);
    };
  });
  const read = await setup(page),
    original = await read();
  await group(page, 'Layer', 'document');
  await expect(page.getByRole('tab', { name: 'Layer', exact: true })).toBeVisible();
  expect(await read()).toEqual(original);
});
