import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
test('merge transforms preserve gradient pixels across rebuilding and undo', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Fill type').selectOption('radial');
  // Merge edits regenerate region identities; explicitly reselect the resulting region.
  await expect.poll(async () => Boolean((await read())[0].gradient)).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const before = await read();
  await page.getByLabel('Transform scale X', { exact: true }).fill('140');
  await page.getByLabel('Transform skew X', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  await expect.poll(async () => Boolean((await read())[0].transform)).toBe(true);
  const s = (await read())[0],
    zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  const q = worldPoint(s, { x: s.width * 0.3, y: s.height * 0.4 });
  const p = {
    x: (b.width - 960 * zoom) / 2 + q.x * zoom,
    y: (b.height - 540 * zoom) / 2 + q.y * zoom,
  };
  const pixel = () =>
    canvas.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      p,
    );
  const paint = await pixel();
  expect(paint.slice(0, 3)).not.toEqual([255, 255, 255]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(pixel).toEqual(paint);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 700, b.y + 380);
  await page.mouse.down();
  await page.mouse.move(b.x + 750, b.y + 420);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(2);
  await expect.poll(pixel).toEqual(paint);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Brush commits onto dense merge paint and linework with undo beyond 4096 edges', async ({
  page,
}) => {
  await page.goto('/');
  const project = newProject();
  project.layers[0].drawingMode = 'merge';
  project.layers[0].keys[0].shapes = [
    {
      id: 'dense-paint',
      kind: 'polygon',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      closed: true,
      drawingMode: 'merge',
      points: Array.from({ length: 6000 }, (_, i) => ({
        x: 100 + 100 * Math.cos((i * 2 * Math.PI) / 6000),
        y: 100 + 100 * Math.sin((i * 2 * Math.PI) / 6000),
      })),
    },
    {
      id: 'crossing-line',
      kind: 'line',
      x: 80,
      y: 200,
      width: 240,
      height: 0,
      rotation: 0,
      fill: '#000000',
      fillEnabled: false,
      stroke: '#000000',
      strokeWidth: 2,
      drawingMode: 'merge',
      points: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
      ],
    },
  ];
  await page.evaluate(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  const before = await read();
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
  await page.getByLabel('Brush size', { exact: true }).fill('30');
  await page.mouse.move(b.x + 400, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 230, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).some((s) => s.fill === '#00ff00')).toBe(true);
  const after = await read();
  expect(after.some((s) => s.strokeWidth === 2)).toBe(true);
  expect(after.some((s) => s.fill === '#ff0000')).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(after);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
