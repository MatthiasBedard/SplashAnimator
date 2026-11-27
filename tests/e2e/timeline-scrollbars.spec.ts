import { test, expect } from '@playwright/test';
import { newProject } from '../../packages/document/src';
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('wheel zoom keeps the pointed-at frame and moves keyframes at the new scale', async ({ page }) => {
  const project = newProject();
  project.duration = 200;
  project.layers[0].keys.push({ frame: 30, shapes: [] }, { frame: 36, shapes: [] });
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const frames = page.getByLabel('Timeline frames', { exact: true });
  const rail = page.getByLabel('Timeline scroll', { exact: true });
  const playhead = page.locator('.frame-readout');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  const box = (await frames.boundingBox())!;
  await rail.evaluate(element => { element.scrollLeft = 20 * 18; });
  await expect(rail).toHaveAttribute('aria-valuenow', '20');
  await page.mouse.move(box.x + 181, box.y + 10);
  await page.mouse.wheel(0, -100);
  await expect(rail).toHaveAttribute('aria-valuenow', '23');
  await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBe(23 * 24);
  expect(await frames.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!;
    return [22, 23, 24].map(x =>
      ctx.getImageData(Math.floor(x * devicePixelRatio), Math.floor(28 * devicePixelRatio), 1, 1).data[3]);
  })).toEqual([255, 0, 255]);
  await expect(playhead).toHaveText('Frame 1 / 200');
  await page.mouse.click(box.x + 181, box.y + 10);
  await expect(playhead).toHaveText('Frame 31 / 200');
  await page.mouse.click(box.x + 205, box.y + 10);
  await expect(playhead).toHaveText('Frame 32 / 200');
  expect(await read()).toEqual(project);

  await page.mouse.click(box.x + 181, box.y + 39);
  await page.mouse.move(box.x + 181, box.y + 39);
  await page.mouse.down();
  await page.mouse.wheel(0, -100);
  await expect(rail).toHaveAttribute('aria-valuenow', '23');
  await page.mouse.move(box.x + 229, box.y + 39, { steps: 4 });
  await page.mouse.up();
  const moved = structuredClone(project);
  moved.layers[0].keys[1].frame = 32;
  await expect.poll(read).toEqual(moved);
  await frames.press('Control+z');
  await expect.poll(read).toEqual(project);
  await page.mouse.move(box.x + 181, box.y + 10);
  await page.mouse.wheel(0, 100);
  await expect(rail).toHaveAttribute('aria-valuenow', '20');
  await page.mouse.click(box.x + 181, box.y + 10);
  await expect(playhead).toHaveText('Frame 31 / 200');
});

test('keyboard scene layer navigation scrolls only at the visible row boundaries', async ({ page }) => {
  const project = newProject();
  project.duration = 12;
  const layer = project.layers[0];
  project.layers = Array.from({ length: 20 }, (_, i) => ({
    ...structuredClone(layer), id: `layer-${i}`, name: `Track ${i}`,
  }));
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const scroll = page.getByLabel('Timeline layer scroll', { exact: true });
  const rows = page.locator('.layer-list .layer-row');
  await expect(rows.first()).toHaveAttribute('data-context-id', 'layer-19');
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  expect(count).toBeLessThan(19);
  await rows.first().locator('button.layer-name').click();
  for (let row = 1; row < count; row++) {
    await timeline.press('ArrowDown');
    await expect(timeline).toHaveAccessibleDescription(new RegExp(`Layer Track ${19 - row}\\.`));
    await expect(scroll).toHaveAccessibleDescription('First visible layer row 1');
  }
  const target = 19 - count;
  await timeline.press('ArrowDown');
  await expect(scroll).toHaveAccessibleDescription('First visible layer row 2');
  await expect(rows.last()).toHaveAttribute('data-context-id', `layer-${target}`);
  for (let row = 1; row < count; row++) {
    await timeline.press('ArrowUp');
    await expect(scroll).toHaveAccessibleDescription('First visible layer row 2');
  }
  await timeline.press('ArrowUp');
  await expect(scroll).toHaveAccessibleDescription('First visible layer row 1');
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 12.*Layer Track 19\./);
  await expect(timeline).toBeFocused();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  expect(await read()).toEqual(project);
  await timeline.press('ArrowRight');
  await timeline.press('F6');
  const edited = structuredClone(project);
  edited.layers[19].keys.push({ frame: 1, shapes: [] });
  await expect.poll(read).toEqual(edited);
  await timeline.press('Control+z');
  await expect.poll(read).toEqual(project);
});

test('native timeline scrollbars independently scroll columns and synchronized layer rows without document edits', async ({
  page,
}) => {
  const project = newProject();
  project.duration = 200;
  const layer = project.layers[0];
  project.layers = Array.from({ length: 20 }, (_, i) => ({
    ...structuredClone(layer),
    id: `layer-${i}`,
    name: `Track ${i}`,
  }));
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const horizontal = page.getByLabel('Timeline scroll', { exact: true });
  const vertical = page.getByLabel('Timeline layer scroll', { exact: true });
  await expect(horizontal).toHaveAttribute('aria-controls', 'timeline-panel');
  await expect(vertical).toHaveAttribute('aria-controls', 'timeline-panel');
  await expect(horizontal).toHaveAccessibleDescription('First visible frame 1');
  await expect(vertical).toHaveAccessibleDescription('First visible layer row 1');
  await horizontal.press('ArrowRight');
  await expect(horizontal).toHaveAccessibleDescription('First visible frame 2');
  await horizontal.press('Home');
  await expect(horizontal).toHaveAccessibleDescription('First visible frame 1');
  const frames = page.getByLabel('Timeline frames', { exact: true });
  const firstRow = page.locator('.layer-list .layer-row').first();
  await expect(firstRow).toContainText('Track 19');
  expect(
    await horizontal.evaluate((el) => [
      getComputedStyle(el).overflowX,
      el.scrollWidth > el.clientWidth,
    ]),
  ).toEqual(['scroll', true]);
  expect(
    await vertical.evaluate((el) => [
      getComputedStyle(el).overflowY,
      el.scrollHeight > el.clientHeight,
    ]),
  ).toEqual(['scroll', true]);
  const h = (await horizontal.boundingBox())!;
  const v = (await vertical.boundingBox())!;
  const b = (await frames.boundingBox())!;
  expect(h.x).toBe(b.x);
  expect(Math.abs(h.width - b.width)).toBeLessThan(2);
  expect(v.x).toBeCloseTo(b.x + b.width, 0);
  // Drag the actual native thumb, not a synthetic range input.
  await page.mouse.move(h.x + 25, h.y + h.height - 7);
  await page.mouse.down();
  await page.mouse.move(h.x + 180, h.y + h.height - 7, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => horizontal.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(firstRow).toContainText('Track 19');
  const offset = await horizontal.evaluate((el) => Math.round(el.scrollLeft / 18));
  await page.mouse.click(b.x + 9, b.y + 10);
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue(String(offset + 1));
  await page.mouse.move(v.x + v.width - 7, v.y + 25);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width - 7, v.y + 110, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => vertical.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const row = await vertical.evaluate((el) => Math.round(el.scrollTop / 28));
  await expect(firstRow).toContainText(`Track ${19 - row}`);
  expect(await horizontal.evaluate((el) => Math.round(el.scrollLeft / 18))).toBe(offset);
  await page.mouse.click(b.x + 9, b.y + 39);
  await expect(page.locator('.layer-row.current')).toContainText(`Track ${19 - row}`);
  await horizontal.focus();
  await horizontal.press('End');
  await expect
    .poll(() => horizontal.evaluate((el) => el.scrollLeft === el.scrollWidth - el.clientWidth))
    .toBe(true);
  await vertical.focus();
  await vertical.press('End');
  await expect
    .poll(() => vertical.evaluate((el) => el.scrollTop === el.scrollHeight - el.clientHeight))
    .toBe(true);
  await expect(page.locator('.layer-list .layer-row').last()).toContainText('Track 0');
  const lastPage = Number(await vertical.getAttribute('aria-valuemax'));
  await expect(vertical).toHaveAccessibleDescription('First visible layer row ' + (lastPage + 1));
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(project);
});

test('short timelines retain native rails without scrolling or changing frame selection', async ({
  page,
}) => {
  const project = newProject();
  project.duration = 10;
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const h = page.getByLabel('Timeline scroll', { exact: true }),
    v = page.getByLabel('Timeline layer scroll', { exact: true });
  expect(await h.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  expect(await v.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  await h.evaluate((el) => (el.scrollLeft = 1000));
  await v.evaluate((el) => (el.scrollTop = 1000));
  await expect(page.locator('.frame-readout')).toContainText('Frame 1');
});
