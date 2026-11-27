import { expect, test, type Locator } from '@playwright/test';
import { newProject } from '../../packages/document/src';

function luminance(color: string) {
  const [red, green, blue] = color.match(/\d+/g)!.slice(0, 3).map(channel => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function contrast(label: Locator) {
  const { foreground, background } = await label.evaluate(element => {
    let parent: Element | null = element;
    while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') {
      parent = parent.parentElement;
    }
    return {
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(parent!).backgroundColor,
    };
  });
  return contrastRatio(foreground, background);
}

function contrastRatio(foreground: string, background: string) {
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

test.use({ viewport: { width: 720, height: 500 }, deviceScaleFactor: 2 });

test('application menus scroll long lists and keep keyboard commands in view', async ({ page }) => {
  const project = newProject();
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();

  for (const name of ['Control', 'Window', 'File', 'Edit', 'View', 'Insert', 'Help']) {
    const trigger = page.getByRole('button', { name, exact: true });
    await trigger.click();
    const dropdown = page.locator(`#application-menu-${name}`);
    await expect(dropdown).toHaveCSS('overflow-y', 'auto');
    await expect(dropdown).toBeInViewport({ ratio: 1 });
    if (name === 'Control') {
      const first = dropdown.getByRole('button', { name: /^Play\b/ });
      const last = dropdown.getByRole('button', { name: 'Edit audio clips...', exact: true });
      const scrollTop = () => dropdown.evaluate(element => element.scrollTop);
      await expect(last).not.toBeInViewport();
      await first.hover();
      await page.mouse.wheel(0, 1200);
      await expect.poll(scrollTop).toBeGreaterThan(0);
      await expect(last).toBeInViewport({ ratio: 1 });
      await trigger.press('ArrowDown');
      await expect(first).toBeFocused();
      await expect(first).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('End');
      await expect(last).toBeFocused();
      await expect(last).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    } else {
      await trigger.click();
    }
    await expect(dropdown).toHaveCount(0);
  }
});

test('compact editor keeps keyboard controls in view and important labels legible', async ({ page }) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [{
    id: 'accessible-rectangle',
    kind: 'rectangle',
    x: 20,
    y: 20,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#ee2e32',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  }];
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
  ), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  const play = page.getByRole('button', { name: 'Play animation', exact: true });
  await expect(page.getByRole('button', { name: 'Register Splash Animator' })).toBeInViewport({ ratio: 1 });
  await expect.soft(page.getByRole('complementary', { name: 'Properties' })).toBeInViewport({ ratio: 0.95 });
  await expect.soft(play).toBeInViewport({ ratio: 1 });
  expect.soft(await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))).toEqual({ width: 720, height: 500 });

  await stage.focus();
  await page.keyboard.press('F10');
  const file = page.getByRole('button', { name: 'File', exact: true });
  await expect(file).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stage).toBeFocused();
  const stageFocus = await stage.evaluate(element => {
    const indicator = getComputedStyle(element.parentElement!, '::after');
    return { style: indicator.borderTopStyle, width: indicator.borderTopWidth, shadow: indicator.boxShadow };
  });
  expect.soft(stageFocus).toMatchObject({ style: 'solid', width: '2px' });
  expect.soft(stageFocus.shadow).toContain('inset');
  const palette = page.getByRole('complementary', { name: 'Drawing tools' });
  const brush = palette.getByRole('button', { name: 'Brush', exact: true });
  await brush.focus();
  await page.keyboard.press('Enter');
  await expect(brush).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fit', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(zoom).toBeFocused();
  await page.keyboard.press('End');
  await expect(zoom).toHaveValue('20');
  await expect(zoom).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('slider', { name: 'Brush simplify slider' })).toBeFocused();
  await expect(play).toBeInViewport({ ratio: 1 });
  const timeline = page.getByRole('region', { name: 'Timeline', exact: true });
  await play.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const keyframe = timeline.getByRole('button', { name: 'Keyframe', exact: true });
  await expect(keyframe).toBeFocused();
  await expect(keyframe).toBeInViewport({ ratio: 0.95 });

  expect.soft(await contrast(page.locator('.document-tab.current .file-type'))).toBeGreaterThanOrEqual(4.5);
  expect.soft(await contrast(page.locator('.frame-readout span'))).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project)).toEqual(project);
});

test('forced colors keeps drawing tool selection distinct from keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ forcedColors: 'active' });
  const project = newProject();
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const tools = page.getByRole('complementary', { name: 'Drawing tools' });
  const selection = tools.getByRole('button', { name: 'Selection', exact: true });
  const rectangle = tools.getByRole('button', { name: 'Rectangle', exact: true });
  const paint = (tool: Locator) => tool.evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor, outline: style.outlineStyle,
      outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  });
  await rectangle.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(rectangle).toBeFocused();
  await expect(selection).toHaveAttribute('aria-pressed', 'true');
  const selected = await paint(selection), focused = await paint(rectangle);
  const palette = await tools.evaluate(element => {
    const sample = element.ownerDocument.createElement('span');
    sample.style.cssText = 'forced-color-adjust:none;background:Highlight;color:HighlightText';
    element.append(sample);
    const style = getComputedStyle(sample);
    const palette = { background: style.backgroundColor, foreground: style.color };
    sample.remove();
    return palette;
  });
  expect(selected).toMatchObject(palette);
  expect(selected.background).not.toBe(focused.background);
  expect(focused.outline).toBe('solid');
  expect(focused.outlineWidth).toBe('2px');
  expect(focused.outlineColor).not.toBe(await tools.evaluate(element => getComputedStyle(element).backgroundColor));
  expect(contrastRatio(selected.foreground, selected.background)).toBeGreaterThanOrEqual(3);
  await rectangle.press('Enter');
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(selection).toHaveAttribute('aria-pressed', 'false');
  expect(await paint(rectangle)).toMatchObject({ background: selected.background, outline: 'solid' });
  expect((await paint(selection)).background).toBe(focused.background);

  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 3 });
  await page.mouse.up();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  await expect.poll(async () => (await saved()).layers[0].keys[0].shapes.length).toBe(1);
  await stage.press('Control+z');
  await expect.poll(saved).toEqual(project);
});
