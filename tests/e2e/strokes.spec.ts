import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
test('worker conversion and affine stroke erasure preserve paint, hollow interiors and undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 570, b.y + 340);
  await page.mouse.up();
  await page.getByLabel('Fill enabled', { exact: true }).uncheck();
  await page.getByLabel('Selected stroke', { exact: true }).fill('#0000ff');
  await page.getByLabel('Stroke width', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByLabel('Transform scale Y', { exact: true }).fill('150');
  await page.getByLabel('Transform skew X', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  const source = (await read())[0],
    zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  const origin = { x: (b.width - 960 * zoom) / 2, y: (b.height - 540 * zoom) / 2 };
  const edge = worldPoint(source, { x: source.width / 2, y: 20 });
  const center = worldPoint(source, { x: source.width / 2, y: source.height / 2 });
  const toPixel = (p: { x: number; y: number }) => ({
    x: origin.x + p.x * zoom,
    y: origin.y + p.y * zoom,
  });
  const pixel = (p: { x: number; y: number }) =>
    canvas.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      toPixel(p),
    );
  await page.getByRole('button', { name: 'Convert stroke to fill', exact: true }).click();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect
    .poll(async () => (await read()).every((s) => s.kind === 'polygon' && s.strokeWidth === 0))
    .toBe(true);
  await expect.poll(() => pixel(edge)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(center)).toEqual([255, 255, 255, 255]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual([source]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser mode').selectOption('strokes');
  await page.getByLabel('Eraser diameter').fill('12');
  const p = toPixel(edge);
  await page.mouse.click(b.x + p.x, b.y + p.y);
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await page.mouse.move(b.x + 40, b.y + 40);
  await expect.poll(() => pixel(edge)).toEqual([255, 255, 255, 255]);
  await expect
    .poll(() => pixel(worldPoint(source, { x: source.width / 2, y: 0 })))
    .toEqual([0, 0, 255, 255]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual([source]);
  await expect.poll(() => pixel(edge)).toEqual([0, 0, 255, 255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const mode of ['object', 'merge'] as const)
  for (const scope of ['contour', 'edge']) {
    test(`stage Ink ${scope} preserves affine compound paint and undo in ${mode} layers`, async ({
      page,
    }) => {
      const p = newProject();
      const art = {
        id: 'compound',
        kind: 'polygon' as const,
        x: 320,
        y: 180,
        width: 100,
        height: 100,
        rotation: 0,
        transform: [-1, 0.2, 0.3, 1] as [number, number, number, number],
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 2,
        points: [],
        fillRule: 'evenodd' as const,
        contours: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
          [
            { x: 20, y: 20 },
            { x: 80, y: 20 },
            { x: 80, y: 80 },
            { x: 20, y: 80 },
          ],
        ],
      };
      p.layers[0].drawingMode = mode;
      p.layers[0].keys[0].shapes = [art];
      await page.addInitScript(
        (project) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project, folder: null, manifest: null }),
          ),
        p,
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
      const before = await read();
      await page.getByRole('button', { name: 'Ink bottle', exact: true }).click();
      await page.getByLabel('Ink paint scope').selectOption(scope);
      await page.getByLabel('Drawing stroke', { exact: true }).fill('#0000ff');
      await page.getByLabel('Drawing stroke width', { exact: true }).fill('6');
      const canvas = page.getByLabel('Drawing stage'),
        b = (await canvas.boundingBox())!;
      const zoom = Number(
        await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue(),
      );
      const q = worldPoint(art, { x: 20, y: 50 });
      await page.mouse.click(
        b.x + (b.width - p.width * zoom) / 2 + q.x * zoom,
        b.y + (b.height - p.height * zoom) / 2 + q.y * zoom,
      );
      await expect
        .poll(async () => (await read()).layers[0].keys[0].shapes.length)
        .toBe(scope === 'edge' ? 4 : 3);
      const after = await read(),
        shapes = after.layers[0].keys[0].shapes;
      expect(shapes[0]).toEqual({ ...art, strokeWidth: 0 });
      expect(shapes[1]).toMatchObject({
        contours: [art.contours[0]],
        stroke: '#000000',
        fillEnabled: false,
      });
      expect(shapes.at(-1)).toMatchObject({
        stroke: '#0000ff',
        strokeWidth: 6,
        fillEnabled: false,
        transform: art.transform,
      });
      if (scope === 'edge')
        expect(shapes.at(-1)!.nodes).toEqual([art.contours[1][3], art.contours[1][0]]);
      else expect(shapes.at(-1)!.contours).toEqual([art.contours[1]]);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
      await page.keyboard.press('Control+Shift+z');
      expect(await read()).toEqual(after);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

for (const mode of ['object', 'merge'] as const)
  test(`stage connected contours preserve barriers and atomic cancellation in ${mode} layers`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const p = newProject();
    p.layers[0].drawingMode = mode;
    const art = {
      id: 'compound',
      kind: 'polygon' as const,
      x: 320,
      y: 180,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
      points: [],
      fillRule: 'evenodd' as const,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
      ],
    };
    const line = {
      id: 'line',
      kind: 'line' as const,
      x: 340,
      y: 230,
      width: 30,
      height: 0,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 2,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
    };
    const barrier = {
      ...line,
      id: 'barrier',
      kind: 'text' as const,
      y: 350,
      height: 20,
      text: {
        content: 'Barrier',
        font: 'Arial',
        size: 12,
        bold: false,
        italic: false,
        align: 'left' as const,
      },
    };
    const beyond = { ...line, id: 'beyond', y: 240 };
    p.layers[0].keys[0].shapes = [art, line, barrier, beyond];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    await page.getByRole('button', { name: 'Ink bottle', exact: true }).click();
    await page.getByLabel('Ink paint scope').selectOption('network');
    await page.getByLabel('Drawing stroke', { exact: true }).fill('#0000ff');
    await page.getByLabel('Drawing stroke width', { exact: true }).fill('6');
    const canvas = page.getByLabel('Drawing stage');
    const zoom = Number(
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue(),
    );
    const click = async () => {
      const b = (await canvas.boundingBox())!;
      await page.mouse.click(
        b.x + (b.width - p.width * zoom) / 2 + 340 * zoom,
        b.y + (b.height - p.height * zoom) / 2 + 215 * zoom,
      );
      await expect.poll(() => pendingGeometry(page)).toBe(1);
    };
    await click();
    expect(await read()).toEqual(before);
    await page.keyboard.press('Escape');
    await releaseGeometry(page);
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    expect(await read()).toEqual(before);
    await click();
    await releaseGeometry(page, true);
    await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
    expect(await read()).toEqual(before);
    await canvas.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    await click();
    await releaseGeometry(page);
    await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(6);
    const after = await read(),
      shapes = after.layers[0].keys[0].shapes;
    expect(shapes[0]).toEqual({ ...art, strokeWidth: 0 });
    expect(shapes[1]).toMatchObject({ contours: [art.contours[0]], stroke: '#000000' });
    expect(shapes[2]).toMatchObject({
      contours: [art.contours[1]],
      stroke: '#0000ff',
      strokeWidth: 6,
    });
    expect(shapes.slice(3)).toEqual([
      { ...line, stroke: '#0000ff', strokeWidth: 6 },
      barrier,
      beyond,
    ]);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(after);
  });
