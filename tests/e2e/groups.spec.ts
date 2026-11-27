import { test, expect } from '@playwright/test';
test('nested group isolation scopes drawing, select-all and erasure to direct members', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  async function draw(x: number) {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(b.x + x, b.y + 180);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 70, b.y + 250);
    await page.mouse.up();
  }
  await draw(250);
  await draw(350);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await draw(450);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByRole('button', { name: 'Edit group', exact: true }).click();
  await page.mouse.click(b.x + 275, b.y + 210);
  await page.getByRole('button', { name: 'Edit group', exact: true }).click();
  await expect(page.getByLabel('Group editing depth')).toHaveText('Group level 2');
  await draw(550);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.getByText(/1 object at frame 1/)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/4 objects at frame 1/)).toBeVisible();
  // Undo exits isolation; whole-object erasure must not reach into a protected group.
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser mode').selectOption('objects');
  await page.mouse.click(b.x + 275, b.y + 210);
  await expect(page.getByText(/4 objects at frame 1/)).toBeVisible();
});
test('groups persist, isolate member edits, move together, duplicate independently and undo ungrouping', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  for (const x of [250, 420]) {
    await page.mouse.move(b.x + x, b.y + 180);
    await page.mouse.down();
    await page.mouse.move(b.x + x + 100, b.y + 280);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect(page.getByText('GROUP SELECTION', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+s');
  const name = `Groups-${Date.now()}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /Open .spl folder/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(b.x + 290, b.y + 220);
  await expect(page.getByText('2 vectors selected.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit group', exact: true }).click();
  await expect(page.getByLabel('Group editing depth')).toHaveText('Group level 1');
  await page.mouse.click(b.x + 290, b.y + 220);
  await page.getByLabel('Selected fill').fill('#ff0000');
  await page.getByRole('button', { name: 'Exit group', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+d');
  await expect(page.getByText(/4 objects at frame 1/)).toBeVisible();
  await page.keyboard.press('Control+Shift+g');
  await expect(page.getByText('GROUP SELECTION', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await page.mouse.click(b.x + 310, b.y + 240);
  await expect(page.getByText('2 vectors selected.', { exact: false })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByText(/2 objects at frame 1/)).toBeVisible();
});
