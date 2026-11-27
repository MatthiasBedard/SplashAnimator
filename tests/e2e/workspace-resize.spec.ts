import { expect, test, type Page } from '@playwright/test';
import { newProject, newLayer, type Project } from '../../packages/document/src';
async function setup(page: Page) {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers = Array.from({ length: 12 }, (_, i) => newLayer('Layer ' + (i + 1)));
  project.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 100,
      height: 80,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('resize-initialized')) return;
    sessionStorage.setItem('resize-initialized', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const prefs = () => page.evaluate(() => localStorage.getItem('splash-panel-layout-v1'));
  const handles = {
    tools: page.getByRole('separator', { name: 'Resize drawing tools', exact: true }),
    inspector: page.getByRole('separator', { name: 'Resize properties sidebar', exact: true }),
    timeline: page.getByRole('separator', { name: 'Resize timeline', exact: true }),
  };
  const panels = {
    tools: page.locator('.tools'),
    inspector: page.locator('.inspector'),
    timeline: page.getByRole('region', { name: 'Timeline', exact: true }),
  };
  async function size(key: keyof typeof panels) {
    const b = (await panels[key].boundingBox())!;
    return key === 'timeline' ? b.height : b.width;
  }
  async function drag(key: keyof typeof panels, dx: number, dy = 0, release = true) {
    const b = (await handles[key].boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
    if (release) await page.mouse.up();
  }
  return { project, read, prefs, handles, panels, size, drag };
}
for (const [key, dx, dy, initial, final] of [
  ['tools', 70, 0, 84, 154],
  ['inspector', -100, 0, 262, 362],
  ['timeline', 0, -112, 267, 379],
] as const)
  test(`${key} divider resizes live, saves only on release and leaves document/Undo untouched`, async ({
    page,
  }) => {
    const f = await setup(page),
      before = await f.prefs();
    expect(await f.size(key)).toBe(initial);
    await f.drag(key, dx, dy, false);
    await expect.poll(() => f.size(key)).toBe(final);
    expect(await f.prefs()).toBe(before);
    expect(await f.read()).toEqual(f.project);
    await page.mouse.up();
    await expect.poll(async () => JSON.parse((await f.prefs())!).sizes[key]).toBe(final);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.project);
    expect(await f.size(key)).toBe(final);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await expect.poll(() => f.size(key)).toBe(final);
    expect(await f.read()).toEqual(f.project);
  });

for (const key of ['tools', 'inspector', 'timeline'] as const)
  for (const reason of ['Escape', 'blur', 'capture loss'])
    test(`${key} ${reason} restores the prior layout and releases native capture`, async ({
      page,
    }) => {
      const f = await setup(page),
        initial = await f.size(key),
        before = await f.prefs();
      await f.handles[key].evaluate((el) =>
        el.addEventListener('gotpointercapture', (e) =>
          el.setAttribute('data-test-pointer', String((e as PointerEvent).pointerId)),
        ),
      );
      await f.drag(
        key,
        key === 'tools' ? 40 : key === 'inspector' ? -40 : 0,
        key === 'timeline' ? -56 : 0,
        false,
      );
      expect(await f.size(key)).not.toBe(initial);
      await expect(f.handles[key]).toHaveAttribute('data-test-pointer', /\d+/);
      if (reason === 'Escape') await page.keyboard.press('Escape');
      else if (reason === 'blur')
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else {
        await f.handles[key].evaluate((el) =>
          el.releasePointerCapture(Number(el.getAttribute('data-test-pointer'))),
        );
        // Chromium delivers pending native capture loss before the next pointer
        // event. Deliver a real movement rather than synthesizing that event.
        const b = (await f.handles[key].boundingBox())!;
        await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2 + 1);
      }
      await expect.poll(() => f.size(key)).toBe(initial);
      await page.mouse.up();
      expect(await f.prefs()).toBe(before);
      expect(await f.read()).toEqual(f.project);
      expect(
        await f.handles[key].evaluate((el) =>
          el.hasPointerCapture(Number(el.getAttribute('data-test-pointer'))),
        ),
      ).toBe(false);
    });

for (const [key, arrow, step, defaultSize] of [
  ['tools', 'ArrowRight', 10, 84],
  ['inspector', 'ArrowLeft', 10, 262],
  ['timeline', 'ArrowUp', 10, 267],
] as const)
  test(`${key} keyboard limits and double-click reset are accessible`, async ({ page }) => {
    const f = await setup(page),
      h = f.handles[key];
    await h.focus();
    await h.press(arrow);
    expect(await f.size(key)).toBe(defaultSize + step);
    await h.press('Home');
    expect(await f.size(key)).toBe(Number(await h.getAttribute('aria-valuemin')));
    if (key === 'tools')
      expect(await f.panels.tools.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await h.press('End');
    expect(await f.size(key)).toBe(Number(await h.getAttribute('aria-valuemax')));
    await h.dblclick();
    await expect.poll(() => f.size(key)).toBe(defaultSize);
    expect(await f.read()).toEqual(f.project);
  });

test('a taller timeline reveals and targets additional rows and keeps the playhead draggable', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(page.locator('.layer-list .layer-row')).toHaveCount(6);
  await page.getByLabel('Timeline layer scroll', { exact: true }).evaluate(el => { el.scrollTop=6*28; el.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.layer-list .layer-row').first()).toContainText('Layer 6');
  await f.drag('timeline', 0, -168);
  await expect(page.locator('.layer-list .layer-row')).toHaveCount(12);
  const frames = page.getByLabel('Timeline frames', { exact: true }),
    b = (await frames.boundingBox())!;
  expect(b.height).toBe(361);
  expect(await frames.evaluate((el: HTMLCanvasElement) => el.height / devicePixelRatio)).toBe(361);
  await page.mouse.click(b.x + 9 + 3 * 18, b.y + 25 + 10 * 28 + 14);
  await expect(page.locator('.layer-row.current')).toContainText('Layer 2');
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('4');
  await page.mouse.move(b.x + 9 + 3 * 18, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 9 + 6 * 18, b.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('7');
  expect(await f.read()).toEqual(f.project);
});

test('sidebar hide/show and Window reset preserve saved sizes or restore defaults', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag('inspector', -100);
  await f.drag('tools', 40);
  await f.drag('timeline', 0, -56);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  await expect(f.handles.inspector).toHaveCount(0);
  await page.getByRole('button', { name: 'Show properties sidebar', exact: true }).click();
  expect(await f.size('inspector')).toBe(362);
  await page.getByRole('button', { name: 'Reset panel layout', exact: true }).click();
  await expect.poll(() => f.size('tools')).toBe(84);
  expect(await f.size('inspector')).toBe(262);
  expect(await f.size('timeline')).toBe(267);
  expect(await f.read()).toEqual(f.project);
});

test('smaller windows clamp the display and larger windows recover the saved preference', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag('tools', 100);
  await f.drag('inspector', -300);
  const prefs = await f.prefs(),
    original = await f.size('inspector');
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect.poll(() => f.size('inspector')).toBeLessThan(original);
  expect((await page.locator('.work-area').boundingBox())!.width).toBeGreaterThanOrEqual(320);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => f.size('inspector')).toBe(original);
  expect(await f.prefs()).toBe(prefs);
  expect(await f.read()).toEqual(f.project);
});

test('a window resize during a drag cancels its uncommitted preview', async ({ page }) => {
  const f = await setup(page),
    before = await f.prefs();
  await f.drag('tools', 40, 0, false);
  expect(await f.size('tools')).toBe(124);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => f.size('tools')).toBe(84);
  await page.mouse.up();
  expect(await f.prefs()).toBe(before);
  expect(await f.read()).toEqual(f.project);
});

test('resizing each pane preserves the selected artwork and property controls', async ({
  page,
}) => {
  const f = await setup(page),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2 - 50, b.y + b.height / 2 - 10);
  await expect(page.getByLabel('Object opacity', { exact: true })).toBeVisible();
  await f.drag('tools', 40);
  await f.drag('inspector', -80);
  await f.drag('timeline', 0, -56);
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ff0000');
  expect(await f.read()).toEqual(f.project);
});
