import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { connectedPaint } from '../../packages/geometry/src/connected';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

test('default Pencil produces compact curves and intersects existing strokes as raw merged artwork', async ({
  page,
}) => {
  const original = newProject();
  await page.addInitScript((project) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project, folder: null, manifest: null }),
    );
  }, original);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
  await page.getByLabel('Drawing stroke width', { exact: true }).fill('4');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.move(box.x + 100, box.y + 130);
  await page.mouse.down();
  for (let i = 1; i <= 80; i++)
    await page.mouse.move(
      box.x + 100 + i * 2.5,
      box.y + 130 + Math.sin(i / 12) * 12 + (i % 2 ? 0.3 : -0.3),
    );
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(1);
  const first = await read(),
    curve = first.layers[0].keys[0].shapes[0];
  expect(first.layers[0].drawingMode).toBe('merge');
  expect(curve.kind).toBe('bezier');
  expect(curve.nodes!.length).toBeLessThan(20);
  expect(curve.nodes!.length).toBeGreaterThan(2);
  await page.mouse.move(box.x + 200, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 190, { steps: 40 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBeGreaterThan(2);
  const result = await read(),
    strokes = result.layers[0].keys[0].shapes;
  expect(
    strokes.every((s) => s.drawingMode === 'merge' && !s.groups?.length && s.fillEnabled === false),
  ).toBe(true);
  expect(connectedPaint(strokes, strokes[0].id)).toHaveLength(strokes.length);
  expect(strokes.some((s) => s.id === curve.id)).toBe(false);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(first);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(result);
});

test('explicit Object drawing preserves merged artwork and keeps new crossing objects separate', async ({
  page,
}) => {
  const original = newProject();
  original.layers[0].drawingMode = 'merge';
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
  await expect(page.getByLabel('Drawing mode', { exact: true })).toHaveValue('merge');
  await page.getByLabel('Separate Pencil objects', { exact: true }).check();
  await expect(page.getByLabel('Drawing mode', { exact: true })).toHaveValue('object');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    box = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  for (const vertical of [false, true]) {
    await page.mouse.move(box.x + (vertical ? 200 : 100), box.y + (vertical ? 70 : 130));
    await page.mouse.down();
    await page.mouse.move(box.x + (vertical ? 200 : 300), box.y + (vertical ? 190 : 130), {
      steps: 40,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await read()).layers[1]?.keys[0].shapes.length)
      .toBe(vertical ? 2 : 1);
  }
  const result = await read();
  expect(result.layers).toHaveLength(2);
  expect(result.layers[0]).toEqual(original.layers[0]);
  expect(result.layers[1].drawingMode).not.toBe('merge');
  expect(
    result.layers[1].keys[0].shapes.every((s) => s.kind === 'bezier' && s.fillEnabled === false),
  ).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(original);
});

for (const fail of [false, true])
  test(`default Pencil protects grouped artwork on ${fail ? 'failed' : 'successful'} worker completion`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const original = newProject();
    original.layers[0].keys[0].shapes = [
      {
        id: 'protected',
        kind: 'path',
        x: 0,
        y: 0,
        width: 20,
        height: 10,
        rotation: 0,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 2,
        fillEnabled: false,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ],
        groups: ['group'],
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
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const canvas = page.getByLabel('Drawing stage', { exact: true }),
      box = (await canvas.boundingBox())!;
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page.mouse.move(box.x + 100, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 130, { steps: 40 });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await read()).toEqual(original);
    await releaseGeometry(page, fail);
    if (fail) {
      await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
      expect(await read()).toEqual(original);
    } else {
      await expect.poll(async () => (await read()).layers.length).toBe(2);
      const result = await read();
      expect(result.layers[0]).toEqual(original.layers[0]);
      expect(result.layers[1].drawingMode).toBe('merge');
      expect(result.layers[1].keys[0].shapes[0].kind).toBe('bezier');
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(original);
    }
  });

test('turning Object drawing off merges new strokes with existing compatible Pencil objects', async ({
  page,
}) => {
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
  const objects = page.getByLabel('Separate Pencil objects', { exact: true });
  await objects.check();
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    box = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.move(box.x + 100, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 130, { steps: 40 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(1);
  const first = await read();
  expect(first.layers[0].drawingMode).not.toBe('merge');
  await objects.uncheck();
  await page.mouse.move(box.x + 200, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 190, { steps: 40 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(4);
  const result = await read(),
    shapes = result.layers[0].keys[0].shapes;
  expect(result.layers).toHaveLength(1);
  expect(result.layers[0].drawingMode).toBe('merge');
  expect(connectedPaint(shapes, shapes[0].id)).toHaveLength(4);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(first);
});

test('a default Pencil click does not convert the layer or create a history edit', async ({
  page,
}) => {
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
  await page.getByLabel('Drawing stage', { exact: true }).click({ position: { x: 200, y: 150 } });
  await expect(page.getByText('Pencil stroke too short.', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(original);
});
