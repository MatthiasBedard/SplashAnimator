import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
const read = (page: Page) =>
  page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0]
        .shapes,
  );
async function setup(page: Page, mode: string) {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByLabel('Drawing mode').selectOption(mode);
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  for (const [x, color] of [
    [300, '#ff0000'],
    [400, '#0000ff'],
    [650, '#00ff00'],
  ] as const) {
    await page.getByLabel('Drawing fill', { exact: true }).fill(color);
    const previous = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await page.mouse.move(b.x + x, b.y + 180);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 100, b.y + 300);
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .not.toBe(previous);
  }
  return b;
}
for (const mode of ['object', 'merge'])
  test(`inside erasure stays in its starting fill in ${mode} layers`, async ({ page }) => {
    const b = await setup(page, mode),
      canvas = page.getByLabel('Drawing stage'),
      before = await read(page);
    const protectedPaint = before.filter((s) => s.fill !== '#ff0000');
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await page.getByLabel('Eraser mode').selectOption('inside');
    await page.mouse.move(b.x + 330, b.y + 240);
    await page.mouse.down();
    await page.mouse.move(b.x + 540, b.y + 240, { steps: 12 });
    await page.mouse.up();
    const pixel = (x: number) =>
      canvas.evaluate(
        (c, x) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, 240, 1, 1).data),
        x,
      );
    await page.mouse.move(b.x + 20, b.y + 20);
    await expect.poll(() => pixel(350)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => pixel(450)).toEqual([0, 0, 255, 255]);
    expect((await read(page)).filter((s) => s.fill !== '#ff0000')).toEqual(protectedPaint);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read(page)).toEqual(before);
    await page.mouse.move(b.x + 260, b.y + 240);
    await page.mouse.down();
    await page.mouse.move(b.x + 360, b.y + 240);
    await page.mouse.up();
    await page.mouse.move(b.x + 20, b.y + 20);
    await expect.poll(() => pixel(350)).toEqual([255, 0, 0, 255]);
    expect(await read(page)).toEqual(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
test('double-click selects connected merge paint while leaving a separate island alone', async ({
  page,
}) => {
  await setup(page, 'merge');
  const before = await read(page),
    canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.dblclick(b.x + 330, b.y + 220);
  await expect(page.getByText('Selected 2 connected paint pieces', { exact: true })).toBeVisible();
  expect(await read(page)).toEqual(before);
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await read(page)).length).toBe(1);
  expect((await read(page))[0].fill).toBe('#00ff00');
  await page.keyboard.press('Control+z');
  expect(await read(page)).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
