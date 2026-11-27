import { test, expect, type Page } from '@playwright/test';
import { newProject } from '../../packages/document/src';
test('cell clicks and Shift selection retain their existing timeline behavior', async ({
  page,
}) => {
  const f = await setup(page);
  await page.mouse.click(f.box.x + 2 * 18 + 9, f.box.y + 40);
  await expect(f.frame).toHaveValue('3');
  await page.keyboard.down('Shift');
  await page.mouse.click(f.box.x + 4 * 18 + 9, f.box.y + 40);
  await page.keyboard.up('Shift');
  await expect(page.getByText('Frames 3–5 · 3 selected', { exact: true })).toHaveCount(1);
  await page.keyboard.down('Shift');
  await page.mouse.click(f.box.x + 7 * 18 + 9, f.box.y + 10);
  await page.keyboard.up('Shift');
  await expect(f.frame).toHaveValue('8');
  await expect(page.getByText('Frames 3–8 · 6 selected', { exact: true })).toHaveCount(1);
  expect(await f.read()).toEqual(f.project);
});
async function setup(page: Page, duration = 20) {
  const project = newProject();
  project.duration = duration;
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    box = (await timeline.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  return { timeline, box, project, read, frame: page.getByLabel('Go to frame', { exact: true }) };
}
test('red playhead drags in both directions and ruler click still seeks without authoring edits', async ({
  page,
}) => {
  const f = await setup(page);
  await page.mouse.move(f.box.x + 9, f.box.y + 10);
  await page.mouse.down();
  await page.mouse.move(f.box.x + 9 + 7 * 18, f.box.y + 10, { steps: 7 });
  await expect(f.frame).toHaveValue('8');
  await page.mouse.move(f.box.x + 9 + 2 * 18, f.box.y + 10, { steps: 5 });
  await expect(f.frame).toHaveValue('3');
  await page.mouse.up();
  await f.timeline.evaluate((canvas) => {
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')!,
      ratio = (canvas as HTMLCanvasElement).width / canvas.getBoundingClientRect().width;
    const pixel = ctx.getImageData(
      Math.floor((2 * 18 + 1) * ratio),
      Math.floor(2 * ratio),
      1,
      1,
    ).data;
    if (pixel[0] !== 255 || pixel[1] !== 125 || pixel[2] !== 135)
      throw Error('Red marker did not follow the frame.');
  });
  await page.mouse.click(f.box.x + 9 + 5 * 18, f.box.y + 10);
  await expect(f.frame).toHaveValue('6');
  expect(await f.read()).toEqual(f.project);
});
test('the playhead follows live forced-colors changes and remains visible while navigating frames', async ({ page }) => {
  const f = await setup(page);
  const pixels = (frame: number) => f.timeline.evaluate((element: HTMLCanvasElement, frame) => {
    const ctx = element.getContext('2d')!;
    const ratio = element.width / element.getBoundingClientRect().width;
    const x = (frame - 1) * 18;
    const pixel = (left: number, top: number) =>
      Array.from(ctx.getImageData(Math.floor(left * ratio), Math.floor(top * ratio), 1, 1).data);
    return { head: pixel(x + 15, 4), side: pixel(x + 7.25, 35), line: pixel(x + 8.25, 35) };
  }, frame);
  expect((await pixels(1)).head).toEqual([255, 125, 135, 255]);
  await page.emulateMedia({ forcedColors: 'active' });
  const palette = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'forced-color-adjust:none;background:Highlight;color:HighlightText';
    document.body.append(probe);
    const css = getComputedStyle(probe);
    const rgba = (color: string) => [...color.match(/\d+/g)!.slice(0, 3).map(Number), 255];
    const highlight = rgba(css.backgroundColor), text = rgba(css.color);
    probe.remove();
    return { head: highlight, side: highlight, line: text };
  });
  expect(palette.head).not.toEqual(palette.line);
  await expect.poll(() => pixels(1)).toEqual(palette);
  await f.timeline.press('ArrowRight');
  await expect(f.frame).toHaveValue('2');
  await expect.poll(() => pixels(2)).toEqual(palette);
  await page.mouse.move(f.box.x + 18 + 9, f.box.y + 10);
  await page.mouse.down();
  await page.mouse.move(f.box.x + 54 + 9, f.box.y + 10, { steps: 3 });
  await page.mouse.up();
  await expect(f.frame).toHaveValue('4');
  await expect.poll(() => pixels(4)).toEqual(palette);
  await page.emulateMedia({ forcedColors: 'none' });
  await expect.poll(async () => (await pixels(4)).head).toEqual([255, 125, 135, 255]);
  expect(await f.read()).toEqual(f.project);
});

test('captured playhead clamps outside the timeline and stops on release', async ({ page }) => {
  const f = await setup(page);
  await page.mouse.move(f.box.x + 9, f.box.y + 10);
  await page.mouse.down();
  await page.mouse.move(f.box.x - 50, f.box.y - 20);
  await expect(f.frame).toHaveValue('1');
  await page.mouse.move(f.box.x + f.box.width + 50, f.box.y - 20);
  await expect(f.frame).toHaveValue('20');
  await page.mouse.up();
  await page.mouse.move(f.box.x + 9, f.box.y + 10);
  await expect(f.frame).toHaveValue('20');
  expect(await f.read()).toEqual(f.project);
});
test('playhead honors scrolled columns and scrolls continuously at the right edge', async ({
  page,
}) => {
  const f = await setup(page, 200);
  await page.getByLabel('Timeline scroll', { exact: true }).evaluate((node) => {
    node.scrollLeft = 30 * 18;
    node.dispatchEvent(new Event('scroll'));
  });
  await page.mouse.move(f.box.x + 5 * 18 + 9, f.box.y + 10);
  await page.mouse.down();
  await expect(f.frame).toHaveValue('36');
  await page.mouse.move(f.box.x + f.box.width + 20, f.box.y + 10);
  const first = Number(await f.frame.inputValue());
  await expect.poll(async () => Number(await f.frame.inputValue())).toBeGreaterThan(first);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.project);
});
for (const cancel of ['escape', 'capture loss', 'pointer cancel'] as const)
  test(`playhead ${cancel} ends captured scrubbing and ignores foreign pointers`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.mouse.move(f.box.x + 9, f.box.y + 10);
    await page.mouse.down();
    await page.mouse.move(f.box.x + 3 * 18 + 9, f.box.y + 10);
    await expect(f.frame).toHaveValue('4');
    await f.timeline.dispatchEvent('pointermove', {
      pointerId: 99,
      clientX: f.box.x + 9,
      clientY: f.box.y + 10,
    });
    await expect(f.frame).toHaveValue('4');
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'capture loss')
      await f.timeline.evaluate((node) => node.releasePointerCapture(1));
    if (cancel === 'pointer cancel')
      await f.timeline.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.move(f.box.x + 7 * 18 + 9, f.box.y + 10);
    await expect(f.frame).toHaveValue('4');
    await page.mouse.up();
    expect(await f.read()).toEqual(f.project);
  });

test('source publication ends a captured ruler scrub and keeps its own Undo step', async ({ page }) => {
  const f = await setup(page);
  const rulerY = f.box.y + 10;
  await page.mouse.move(f.box.x + 9, rulerY);
  await page.mouse.down();
  await page.mouse.move(f.box.x + 3 * 18 + 9, rulerY);
  await expect(f.frame).toHaveValue('4');
  expect(await f.timeline.evaluate(node => node.hasPointerCapture(1))).toBe(true);
  await page.getByRole('button', { name: 'Add layer', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await f.read()).layers.length).toBe(2);
  await page.mouse.move(f.box.x + 7 * 18 + 9, rulerY);
  await expect(page.getByText('Frame 4 / 20', { exact: true })).toBeVisible();
  expect(await f.timeline.evaluate(node => node.hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await f.timeline.press('Control+z');
  expect(await f.read()).toEqual(f.project);
});
