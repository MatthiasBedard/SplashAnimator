import { expect, test } from '@playwright/test';
import { newProject, type Point, type Project, type Vector } from '../../packages/document/src';
import { containsPoint, worldPaths } from '../../packages/geometry/src/drawing';
import { mergeControlBounds } from '../../packages/geometry/src/merge';
import { anotherMergeFailFrame } from '../broken-drawing-fixture';

function painted(shapes: Vector[], p: Point) {
  return shapes.filter(s => {
    if (s.strokeWidth || s.fillEnabled === false) return false;
    const b = mergeControlBounds(s);
    return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom &&
      worldPaths(s, .01).reduce((inside, ring) => inside !== containsPoint(ring, p), false);
  });
}

// The blue fill crosses the region edge where its cut curves cannot be
// certified. Its selected part used to stay at the old position on release.
test('moving a paint region lifts a crossing fill whose cut curves cannot be certified', async ({ page }) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the reported another merge fail revision');
  const project = newProject();
  project.width = 960; project.height = 540; project.layers[0].drawingMode = 'merge';
  project.layers[0].keys[0].shapes = saved!;
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'), box = (await canvas.boundingBox())!;
  const at = (p: Point) => [box.x + (box.width - 960) / 2 + p.x, box.y + (box.height - 540) / 2 + p.y] as const;
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Partial paint region', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Drag paint region', exact: true }).check();
  await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
  const [left, top, right, bottom] = [198.3, 176.3, 273.1, 251.1];
  for (const p of [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }])
    await page.mouse.click(...at(p));
  await canvas.press('Enter');
  await expect(page.getByText('Paint region ready: copy, cut or move.')).toBeVisible();
  const before = await read();
  const stray = before.find(s => s.id === 'c7af1829-7c43-4929-b150-9afb16df1407')!;
  const samples: Point[] = [];
  for (let x = left + 2.3; x < right - 2; x += 1.7)
    for (let y = top + 2.1; y < bottom - 2; y += 1.7) if (painted([stray], { x, y }).length) samples.push({ x, y });
  expect(samples.length).toBeGreaterThan(50);
  // Drop the region onto the other drawing, away from its pivot.
  const grab = { x: 212, y: 198 }, offset = { x: 200, y: 60 };
  await page.mouse.move(...at(grab));
  await page.mouse.down();
  for (let step = 1; step <= 8; step++)
    await page.mouse.move(...at({ x: grab.x + offset.x * step / 8, y: grab.y + offset.y * step / 8 }));
  await page.mouse.up();
  await expect.poll(async () => (await read()).some(s => s.id === stray.id)).toBe(false);
  const placed = await read();
  expect(samples.filter(p => painted(placed, p).length)).toEqual([]);
  for (const p of samples)
    expect(painted(placed, { x: p.x + offset.x, y: p.y + offset.y }).at(-1)?.fill).toBe(stray.fill);
  await canvas.press('Escape');
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(placed)).toBe(true);
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  const settled = await read();
  expect(samples.filter(p => painted(settled, p).length)).toEqual([]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});
