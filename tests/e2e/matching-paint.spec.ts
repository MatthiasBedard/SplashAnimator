import { test, expect } from '@playwright/test';
import type { Project } from '../../packages/document/src';
test('matching fill and stroke selections drive edits without changing unselected paint', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill(i === 2 ? '#ff0000' : '#00ff00');
    await page.mouse.move(b.x + 200 + i * 130, b.y + 180);
    await page.mouse.down();
    await page.mouse.move(b.x + 280 + i * 130, b.y + 260);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const before = await read();
  for (const part of ['fill', 'stroke']) {
    await page.mouse.click(b.x + 240, b.y + 220);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: `Select matching ${part} paint`, exact: true }).click();
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    const moved = await read();
    expect(moved[0].x).toBe(before[0].x + 1);
    expect(moved[1].x).toBe(before[1].x + 1);
    expect(moved[2].x).toBe(before[2].x + (part === 'stroke' ? 1 : 0));
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});
