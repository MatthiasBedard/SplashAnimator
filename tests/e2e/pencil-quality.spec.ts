import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { connectedPaint } from '../../packages/geometry/src/connected';
import { worldPoint } from '../../packages/geometry/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

for (const objects of [false, true])
  test(`Smooth Pencil fits noisy capture and keeps few curve vertices after merging (${objects ? 'object opt-in' : 'default merge'})`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const original = newProject();
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      original,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByLabel('Separate Pencil objects', { exact: true }).setChecked(objects);
    await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
    await page.getByLabel('Drawing stroke width', { exact: true }).fill('3');
    const canvas = page.getByLabel('Drawing stage', { exact: true }),
      box = (await canvas.boundingBox())!;
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page.mouse.move(box.x + 100, box.y + 180);
    await page.mouse.down();
    for (let i = 1; i <= 240; i++)
      await page.mouse.move(
        box.x + 100 + i * 1.5,
        box.y + 180 + Math.sin(i / 38) * 48 + Math.sin(i * 0.8) * 3,
      );
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await read()).toEqual(original);
    await releaseGeometry(page);
    await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(1);
    const first = await read(),
      curve = first.layers[0].keys[0].shapes[0];
    expect(curve.kind).toBe('bezier');
    expect(curve.nodes!.length).toBeLessThanOrEqual(10);
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const c = node as HTMLCanvasElement,
            data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) count++;
          return count;
        }),
      )
      .toBeGreaterThan(300);
    if (!objects) await canvas.screenshot({ path: 'test-results/pencil-quality-smooth.png' });
    await page.getByLabel('Separate Pencil objects', { exact: true }).uncheck();
    await page.mouse.move(box.x + 280, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 280, box.y + 260, { steps: 40 });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await read()).toEqual(first);
    await releaseGeometry(page);
    await expect
      .poll(async () => (await read()).layers[0].keys[0].shapes.length)
      .toBeGreaterThan(2);
    const result = await read(),
      strokes = result.layers[0].keys[0].shapes;
    expect(strokes.filter((s) => s.kind === 'bezier').length).toBeGreaterThanOrEqual(2);
    expect(
      strokes.reduce((n, s) => n + (s.nodes?.length ?? s.points.length), 0),
    ).toBeLessThanOrEqual(18);
    expect(connectedPaint(strokes, strokes[0].id)).toHaveLength(strokes.length);
    if (!objects) await canvas.screenshot({ path: 'test-results/pencil-quality-crossed.png' });
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(first);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(result);
  });

test('subselection edits keep existing merged cubic strokes compact', async ({ page }) => {
  await holdGeometry(page);
  const original = newProject();
  original.layers[0].drawingMode = 'merge';
  original.layers[0].keys[0].shapes = [
    {
      id: 'arch',
      kind: 'bezier',
      x: 200,
      y: 150,
      width: 200,
      height: 80,
      rotation: 0,
      fill: '#000000',
      fillEnabled: false,
      stroke: '#ff0000',
      strokeWidth: 3,
      points: [],
      drawingMode: 'merge',
      nodes: [
        { x: 0, y: 0, out: { x: 200 / 3, y: 80 } },
        { x: 200, y: 0, in: { x: 400 / 3, y: 80 } },
      ],
    },
    {
      id: 'line',
      kind: 'path',
      x: 300,
      y: 100,
      width: 0,
      height: 200,
      rotation: 0,
      fill: '#000000',
      fillEnabled: false,
      stroke: '#ff0000',
      strokeWidth: 3,
      drawingMode: 'merge',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    original,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    box = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.click(
    box.x + box.width / 2 + 200 - original.width / 2,
    box.y + box.height / 2 + 150 - original.height / 2,
  );
  await canvas.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(read).not.toEqual(original);
  expect(await pendingGeometry(page)).toBe(0);
  const result = await read(),
    strokes = result.layers[0].keys[0].shapes;
  expect(strokes).toHaveLength(2);
  expect(strokes[0].kind).toBe('bezier');
  expect(strokes[0].nodes).toHaveLength(2);
  expect(worldPoint(strokes[0], strokes[0].nodes![0])).toMatchObject({ x: 200, y: 149 });
  expect(strokes[1]).toEqual(original.layers[0].keys[0].shapes[1]);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(original);
});
