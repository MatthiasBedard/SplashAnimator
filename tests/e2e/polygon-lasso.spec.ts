import { test, expect } from '@playwright/test';
import type { Project } from '../../packages/document/src';
test('polygon lasso finishes, removes vertices and cancels without editing artwork', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  for (const x of [200, 500]) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(b.x + x, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 60, b.y + 260);
    await page.mouse.up();
  }
  await expect.poll(async () => (await read()).length).toBe(2);
  const before = await read();
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  for (const [x, y] of [
    [170, 170],
    [300, 170],
    [300, 300],
    [170, 300],
    [600, 400],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  expect(await read()).toEqual(before);
  await page.keyboard.press('ArrowRight');
  const moved = await read();
  expect(moved[0].x).toBe(before[0].x + 1);
  expect(moved[1]).toEqual(before[1]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  for (const [x, y] of [
    [470, 170],
    [590, 170],
    [590, 300],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Finish lasso', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  expect(await read()).toEqual(before);
});

test('lasso add and subtract modifiers preserve the intended selection', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  for (const x of [200, 500]) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(b.x + x, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 60, b.y + 260);
    await page.mouse.up();
  }
  await expect.poll(async () => (await read()).length).toBe(2);
  const before = await read();
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  const outline = async (x: number, modifier?: string) => {
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.click(b.x + x - 20, b.y + 180);
    if (modifier) await page.keyboard.up(modifier);
    for (const [px, py] of [
      [x + 80, 180],
      [x + 80, 280],
      [x - 20, 280],
    ])
      await page.mouse.click(b.x + px, b.y + py);
    await page.keyboard.press('Enter');
  };
  await outline(200);
  await outline(500, 'Shift');
  await page.keyboard.press('ArrowRight');
  let moved = await read();
  expect(moved.map((s, i) => s.x - before[i].x)).toEqual([1, 1]);
  await outline(200, 'Alt');
  await page.keyboard.press('ArrowRight');
  moved = await read();
  expect(moved.map((s, i) => s.x - before[i].x)).toEqual([1, 2]);
});
test('crossing polygon lasso selects both enclosed lobes and preserves artwork history', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  for (const [x, y] of [
    [280, 180],
    [280, 390],
    [400, 280],
  ]) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(b.x + x, b.y + y);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 20, b.y + y + 20);
    await page.mouse.up();
  }
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(3);
  const before = await read();
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  for (const [x, y] of [
    [150, 150],
    [450, 450],
    [150, 450],
    [450, 150],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Enter');
  expect(await read()).toEqual(before);
  await page.keyboard.press('ArrowRight');
  const after = await read();
  expect(
    after.layers[0].keys[0].shapes.map((s, i) => s.x - before.layers[0].keys[0].shapes[i].x),
  ).toEqual([1, 1, 0]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});
