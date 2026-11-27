import { expect, test, type Locator, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';

test.use({ hasTouch: true });

const art = {
  id: 'red', kind: 'rectangle' as const, x: 290, y: 170, width: 20, height: 20,
  fill: '#ff0000', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [],
};

async function recover(page: Page) {
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const recovery = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(launch.or(recovery).first()).toBeVisible();
  if (await launch.isVisible()) await launch.tap();
  await recovery.tap();
}

async function setup(page: Page, symbol = false) {
  const project = newProject();
  project.width = 600;
  project.height = 360;
  project.layers[0].keys[0].shapes = symbol ? [] : [art];
  if (symbol) project.symbols = [{
    id: 'touch-symbol', name: 'Touch symbol', width: 600, height: 360, shapes: [art],
  }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1')) {
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }
  }, project);
  await page.goto('/');
  await recover(page);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    ...points: { x: number; y: number }[]
  ) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map((point, id) => ({ ...point, id })),
  });
  return { project, stage, zoom, touch, read };
}

async function openPreferences(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).tap();
  await page.getByRole('button', { name: 'Preferences…', exact: true }).tap();
  return page.getByRole('dialog', { name: 'Preferences', exact: true });
}

async function redArtwork(canvas: Locator) {
  return canvas.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let pixels = 0, totalX = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] || data[i + 2] || data[i + 3] !== 255) continue;
      pixels++;
      totalX += (i / 4) % canvas.width;
    }
    return { pixels, x: totalX / pixels };
  });
}

test('canvas pinches around the moving midpoint and pans with one finger without drawing', async ({ page }) => {
  const f = await setup(page);
  await f.zoom.selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).tap();
  const before = await redArtwork(f.stage);
  expect(before.pixels).toBeGreaterThan(300);
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await f.touch('touchStart', { x: x - 40, y }, { x: x + 40, y });
  await f.touch('touchMove', { x: x - 50, y }, { x: x + 110, y });
  await expect.poll(async () => Number(await f.zoom.inputValue())).toBeCloseTo(2, 2);
  await expect.poll(async () => Math.abs((await redArtwork(f.stage)).x - before.x - 30)).toBeLessThan(3);
  await f.touch('touchMove', { x: x - 10, y }, { x: x + 70, y });
  await f.touch('touchEnd');
  await expect.poll(async () => Number(await f.zoom.inputValue())).toBeCloseTo(1, 2);
  const translated = await redArtwork(f.stage);
  await f.touch('touchStart', { x, y });
  await f.touch('touchMove', { x: x + 35, y });
  await f.touch('touchEnd');
  await expect.poll(async () => Math.abs((await redArtwork(f.stage)).x - translated.x - 35)).toBeLessThan(2);
  expect(await f.read()).toEqual(f.project);
});

test('file preferences organize live settings and persist touch, pen, workspace and shortcut changes', async ({ page }) => {
  const f = await setup(page);
  const dialog = await openPreferences(page);
  const category = (name: string) => dialog.getByRole('tab', { name, exact: true });
  await expect(category('General')).toBeFocused();
  await dialog.getByLabel('Zoom with the mouse wheel', { exact: true }).uncheck();
  await dialog.getByLabel('Show rulers', { exact: true }).uncheck();
  await category('Touch').tap();
  await expect(dialog.getByLabel('Pinch to zoom canvas')).toBeChecked();
  await dialog.getByLabel('Pinch to zoom canvas').uncheck();
  await dialog.getByLabel('One finger on canvas').selectOption('tool');
  await category('Pen & Brush').tap();
  await dialog.getByLabel('Pressure controls size').uncheck();
  await dialog.getByLabel('Pressure response').fill('2');
  await category('Pencil').tap();
  await dialog.getByLabel('Pencil simplify (%)').fill('90');
  await category('Workspace').tap();
  await dialog.getByLabel('Properties dock').selectOption('left');
  await category('Keyboard Shortcuts').tap();
  await dialog.getByLabel('Command').selectOption('tool:brush');
  await dialog.getByRole('button', { name: 'Change shortcut', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Press a shortcut…', exact: true }).press('u');
  await expect(dialog.getByRole('status')).toHaveText('Shortcut saved.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
  expect(await f.read()).toEqual(f.project);

  await page.reload();
  await recover(page);
  await f.stage.press('u');
  await expect(page.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const reopened = await openPreferences(page);
  await expect(reopened.getByLabel('Show rulers')).not.toBeChecked();
  await category('Workspace').tap();
  await expect(reopened.getByLabel('Properties dock')).toHaveValue('left');
  await category('Pen & Brush').tap();
  await expect(reopened.getByLabel('Pressure controls size')).not.toBeChecked();
  await expect(reopened.getByLabel('Pressure response')).toHaveValue('2');
  await category('Pencil').tap();
  await expect(reopened.getByLabel('Pencil simplify (%)')).toHaveValue('90');
  await category('Touch').tap();
  await expect(reopened.getByLabel('Pinch to zoom canvas')).not.toBeChecked();
  await expect(reopened.getByLabel('One finger on canvas')).toHaveValue('tool');
  await page.keyboard.press('Escape');
  await expect(reopened).toBeHidden();

  await f.zoom.selectOption('1');
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await expect(f.zoom).toHaveValue('1');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => Number(await f.zoom.inputValue())).toBeGreaterThan(1);
});

test('Preferences categories follow the layout with arrow keys and Tab enters the active page', async ({ page }) => {
  const f = await setup(page);
  const file = page.getByRole('button', { name: 'File', exact: true });
  await file.press('Enter');
  await page.getByRole('button', { name: 'Preferences…', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
  const category = (name: string) => dialog.locator('[data-preference-page]').filter({ hasText: new RegExp('^' + name + '$') });
  await expect(category('General')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(category('Touch')).toBeFocused();
  const tabs = dialog.getByRole('tablist', { name: 'Preference categories' });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  await expect(tabs.getByRole('tab', { name: 'Touch', selected: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const pinch = dialog.getByRole('tabpanel', { name: 'Touch' }).getByLabel('Pinch to zoom canvas');
  await expect(pinch).toBeFocused();
  await page.keyboard.press('Space');
  await expect(pinch).not.toBeChecked();
  await page.keyboard.press('Shift+Tab');
  await expect(category('Touch')).toBeFocused();

  await page.setViewportSize({ width: 400, height: 690 });
  await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
  await page.keyboard.press('End');
  await expect(category('Keyboard Shortcuts')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(category('General')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(category('Keyboard Shortcuts')).toBeFocused();
  await expect(category('Keyboard Shortcuts')).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('tabpanel', { name: 'Keyboard Shortcuts' }).getByLabel('Command')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(file).toBeFocused();

  const reopened = await openPreferences(page);
  await reopened.getByRole('tab', { name: 'Touch', exact: true }).tap();
  await expect(reopened.getByLabel('Pinch to zoom canvas')).not.toBeChecked();
  expect(await f.read()).toEqual(f.project);
});

test('a second finger cancels a tentative tool stroke and the next single-finger stroke can draw', async ({ page }) => {
  const f = await setup(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Touch', exact: true }).tap();
  await dialog.getByLabel('One finger on canvas').selectOption('tool');
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await f.zoom.selectOption('1');
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await f.touch('touchStart', { x: x - 70, y: y - 50 });
  await f.touch('touchMove', { x: x - 40, y: y - 25 });
  await f.touch('touchStart', { x: x - 40, y: y - 25 }, { x: x + 40, y: y - 25 });
  await f.touch('touchMove', { x: x - 80, y: y - 25 }, { x: x + 80, y: y - 25 });
  await f.touch('touchCancel');
  await expect.poll(async () => Number(await f.zoom.inputValue())).toBeCloseTo(2, 2);
  expect(await f.read()).toEqual(f.project);
  await f.touch('touchStart', { x: x - 70, y: y + 30 });
  await f.touch('touchMove', { x: x - 30, y: y + 65 });
  await f.touch('touchEnd');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.project);
});

test('one-finger Ignore keeps the canvas still but leaves two-finger zoom available', async ({ page }) => {
  const f = await setup(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Touch', exact: true }).tap();
  await dialog.getByLabel('One finger on canvas').selectOption('ignore');
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap();
  await f.zoom.selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).tap();
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  const before = await redArtwork(f.stage);
  await f.touch('touchStart', { x: x - 65, y });
  await f.touch('touchMove', { x: x - 40, y });
  expect(await redArtwork(f.stage)).toEqual(before);
  await f.touch('touchStart', { x: x - 40, y }, { x: x + 40, y });
  await f.touch('touchMove', { x: x - 80, y }, { x: x + 80, y });
  await expect.poll(async () => Number(await f.zoom.inputValue())).toBeCloseTo(2, 2);
  await f.touch('touchEnd');
  const pinched = await redArtwork(f.stage);
  await f.touch('touchStart', { x: x - 80, y });
  await f.touch('touchMove', { x: x - 50, y });
  await f.touch('touchEnd');
  expect(await redArtwork(f.stage)).toEqual(pinched);
  expect(await f.read()).toEqual(f.project);
});

test('Pen preferences persist pressure opacity and drive the existing brush controls and new strokes', async ({ page }) => {
  const f = await setup(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Pen & Brush', exact: true }).tap();
  await dialog.getByLabel('Pressure controls opacity').selectOption('initial');
  await dialog.getByLabel('Minimum opacity (%)', { exact: true }).fill('20');
  await dialog.getByLabel('Opacity response', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Done', exact: true }).tap();
  expect(await f.read()).toEqual(f.project);

  await page.reload();
  await recover(page);
  await f.zoom.selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).tap();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  const initial = page.getByLabel('Initial pen pressure controls opacity', { exact: true });
  const continuous = page.getByLabel('Pen pressure varies opacity while drawing', { exact: true });
  await expect(initial).toBeChecked();
  await expect(page.getByLabel('Minimum pressure opacity', { exact: true })).toHaveValue('20');
  await expect(page.getByLabel('Pressure opacity response', { exact: true })).toHaveValue('2');
  await continuous.check();
  await expect(initial).not.toBeChecked();
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2) + 35;
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x - 65, y,
    button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.25 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 65, y,
    buttons: 1, pointerType: 'pen', force: 0.75 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 65, y,
    button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  await pen.detach();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.at(-1)?.brush?.opacityProfile)
    .toEqual({ minimum: 0.2, response: 2 });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.project);
  const reopened = await openPreferences(page);
  await reopened.getByRole('tab', { name: 'Pen & Brush', exact: true }).tap();
  await expect(reopened.getByLabel('Pressure controls opacity')).toHaveValue('continuous');
});

test('pinch zoom also works on a symbol artwork canvas without editing the symbol', async ({ page }) => {
  const f = await setup(page, true);
  await page.getByRole('option', { name: 'Library item Touch symbol', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
  const before = (await redArtwork(canvas)).pixels;
  expect(before).toBeGreaterThan(100);
  await f.touch('touchStart', { x: x - 40, y }, { x: x + 40, y });
  await f.touch('touchMove', { x: x - 75, y }, { x: x + 75, y });
  await f.touch('touchEnd');
  await expect.poll(async () => (await redArtwork(canvas)).pixels).toBeGreaterThan(before * 2);
  expect(await f.read()).toEqual(f.project);
});

test('advanced symbol canvas uses the configured zoom limits for pinch and Fit', async ({ page }) => {
  const f = await setup(page, true);
  const preferences = await openPreferences(page);
  const minimum = preferences.getByLabel('Minimum canvas zoom (%)');
  const maximum = preferences.getByLabel('Maximum canvas zoom (%)');
  await minimum.fill('80');
  await maximum.fill('140');
  await preferences.getByRole('button', { name: 'Done' }).tap();
  await page.getByRole('option', { name: 'Library item Touch symbol', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  const viewControls = page.locator('.embedded-view-controls');
  const zoom = viewControls.getByRole('combobox', { name: 'Zoom', exact: true });
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThanOrEqual(0.8 - 1e-8);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThanOrEqual(1.4 + 1e-8);
  await zoom.selectOption('1');
  const rect = (await canvas.boundingBox())!;
  const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
  await f.touch('touchStart', { x: x - 40, y }, { x: x + 40, y });
  await f.touch('touchMove', { x: x - 75, y }, { x: x + 75, y });
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(1.4, 8);
  await f.touch('touchMove', { x: x - 20, y }, { x: x + 20, y });
  await f.touch('touchEnd');
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(0.8, 8);
  await viewControls.getByRole('button', { name: 'Fit' }).tap();
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThanOrEqual(0.8 - 1e-8);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThanOrEqual(1.4 + 1e-8);
  expect(await f.read()).toEqual(f.project);
});

test('preferences remain reachable on a narrow touch viewport and can disable pinch', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 760 });
  const f = await setup(page);
  const dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Keyboard Shortcuts', exact: true }).tap();
  await expect(dialog.getByLabel('Command')).toBeInViewport();
  await dialog.getByRole('tab', { name: 'Touch', exact: true }).tap();
  await dialog.getByLabel('Pinch to zoom canvas').uncheck();
  const done = dialog.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeInViewport({ ratio: 1 });
  await done.tap();
  const zoom = await f.zoom.inputValue();
  const box = (await f.stage.boundingBox())!;
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await f.touch('touchStart', { x: x - 20, y }, { x: x + 20, y });
  await f.touch('touchMove', { x: x - 40, y }, { x: x + 40, y });
  await f.touch('touchEnd');
  await expect(f.zoom).toHaveValue(zoom);
  expect(await f.read()).toEqual(f.project);
});
