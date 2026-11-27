import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { createRequire } from 'node:module';
import { newProject, type Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
import { narrowArrangementOutline } from '../narrow-arrangement-fixture';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
let workerCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        'polygon-clipping': createRequire(
          new URL('../../packages/geometry/package.json', import.meta.url),
        ).resolve('polygon-clipping'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/paint-queue-worker-fixture.ts',
        formats: ['iife'],
        name: 'QueueGeometry',
        fileName: () => 'queue.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one self-contained geometry worker');
  workerCode = chunks[0].code;
});
async function setup(page: Page, faults = true) {
  const p = newProject();
  p.width = 500;
  p.height = 400;
  p.layers[0].drawingMode = 'merge';
  p.layers[0].keys[0].shapes = [
    {
      id: 'old',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 200,
      height: 180,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 6,
      points: [],
    },
  ];
  await page.addInitScript(
    ({ p, code, faults }) => {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      if (faults) {
        const NativeWorker = Worker;
        let url: string | undefined;
        Object.assign(window, { queueFaults: 0 });
        window.Worker = class extends NativeWorker {
          constructor(input: string | URL, options?: WorkerOptions) {
            const geometry =
              String(input).includes('geometry-worker') || String(input).includes('/worker-');
            if (geometry)
              url ??= URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
            super(geometry ? url! : input, geometry ? { type: 'classic' } : options);
            this.addEventListener(
              'message',
              (event) => {
                if (event.data?.queueFault) {
                  (window as unknown as { queueFaults: number }).queueFaults++;
                  event.stopImmediatePropagation();
                }
              },
              true,
            );
          }
        };
      }
    },
    { p, code: workerCode, faults },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('25');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  async function draw(y = 180) {
    const b = (await canvas.boundingBox())!;
    const o = { x: b.x + b.width / 2 - 250, y: b.y + b.height / 2 - 200 };
    await page.mouse.move(o.x + 70, o.y + y);
    await page.mouse.down();
    await page.mouse.move(o.x + 350, o.y + y, { steps: 32 });
    await page.mouse.up();
    await expect(page.getByLabel('Timeline', { exact: true })).not.toHaveAttribute('inert', '');
  }
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (node, { x, y }) => {
        const c = node as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - 250) * devicePixelRatio),
              Math.round(c.height / 2 + (y - 200) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );
  return { p, read, draw, canvas, pixel };
}
for (const mode of ['normal', 'behind', 'fills', 'inside', 'selection'])
  test(`Brush ${mode} recovers real worker queue faults, preserves old pixels and keeps drawing`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (mode === 'selection') {
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await f.canvas.focus();
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Brush', exact: true }).click();
    }
    await page.getByLabel('Brush paint mode', { exact: true }).selectOption(mode);
    await f.draw();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { queueFaults: number }).queueFaults),
    ).toBeGreaterThan(0);
    const first = await f.read();
    expect(first).not.toEqual(f.p);
    await expect.poll(() => f.pixel(150, 130)).toEqual([255, 0, 0, 255]);
    // Inside starts in empty paint here, so it paints outside the original fill.
    const greenX = mode === 'behind' || mode === 'inside' ? 80 : 150;
    await expect.poll(() => f.pixel(greenX, 180)).toEqual([0, 255, 0, 255]);
    if (mode === 'selection') {
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await f.canvas.focus();
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Brush', exact: true }).click();
    }
    await f.draw(220);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const second = await f.read();
    expect(second).not.toEqual(first);
    await expect.poll(() => f.pixel(greenX, 220)).toEqual([0, 255, 0, 255]);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(first);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(first);
  });

test('dragging a merged line defers the merge and keeps its position beside a narrow face', async ({ page }) => {
  const p = newProject();
  p.width = 500;
  p.height = 400;
  p.layers[0].drawingMode = 'merge';
  const outline = narrowArrangementOutline(320, 6_000_000);
  const line = {
    ...outline, id: 'move-line', x: 90, y: 270, width: 70, height: 0, closed: false,
    stroke: '#ff0000', strokeWidth: 20, points: [{ x: 0, y: 0 }, { x: 70, y: 0 }],
  };
  p.layers[0].keys[0].shapes = [outline, line];
  await holdGeometry(page);
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2 - 250 + 120;
  const y = bounds.y + bounds.height / 2 - 200 + 270;
  const read = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 54, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const moved = structuredClone(p);
  moved.layers[0].keys[0].shapes[1].y += 54;
  await expect.poll(read).toEqual(moved);
  await expect(page.getByLabel('Shape Y', { exact: true })).toHaveValue('324');
  expect(await pendingGeometry(page)).toBe(0);
  await page.mouse.click(x, y - 50);
  await expect(page.getByLabel('Shape Y', { exact: true })).toHaveCount(0);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preferences…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(read).toEqual(moved);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(moved);
});

for (const tool of ['Brush', 'Pencil'] as const)
  test(`${tool} keeps drawing over an unresolvable mixed outline and preserves Undo`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 500;
    p.height = 400;
    const original = narrowArrangementOutline(320, 6_000_000);
    p.layers[0].drawingMode = 'merge';
    p.layers[0].keys[0].shapes = [original];
    await page.addInitScript((project) => {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
    }, p);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: tool, exact: true }).click();
    // Exercise the arrangement with both narrow edges present. Removing
    // covered lines can safely clip this stroke before arrangement instead.
    if (tool === 'Brush') await page.getByRole('checkbox', { name: 'Remove covered lines' }).uncheck();
    else {
      await page.getByRole('combobox', { name: 'Pencil mode', exact: true }).selectOption('ink');
      await page.getByRole('checkbox', { name: 'Pencil optimize', exact: true }).uncheck();
    }
    await page
      .getByLabel(tool === 'Brush' ? 'Drawing fill' : 'Drawing stroke', { exact: true })
      .fill('#ff0000');
    await page
      .getByLabel(tool === 'Brush' ? 'Brush size' : 'Drawing stroke width', { exact: true })
      .fill('20');
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    const draw = async (y: number) => {
      const b = (await canvas.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2 - 160, b.y + b.height / 2 + y - 200);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 - 96, b.y + b.height / 2 + y - 200, { steps: 10 });
      await page.mouse.up();
    };
    await draw(324);
    await expect(
      page.getByText(`${tool} stroke kept separately. The overlap could not be merged safely.`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect.poll(async () => (await read()).length).toBe(2);
    const first = await read();
    expect(first[0]).toEqual(original);
    expect(first[1]).toMatchObject(
      tool === 'Brush'
        ? { kind: 'polygon', drawingMode: 'merge', fill: '#ff0000' }
        : { fillEnabled: false, drawingMode: 'merge', stroke: '#ff0000' },
    );
    const pixel = () =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 - 128 * devicePixelRatio),
              Math.round(c.height / 2 + 127 * devicePixelRatio),
              1,
              1,
            ).data,
        ),
      );
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await draw(200);
    await expect.poll(async () => (await read()).length).toBe(3);
    expect((await read())[0]).toEqual(original);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(first);
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual([original]);
  });

for (const tool of ['Rectangle', 'Pen'] as const)
  test(`${tool} keeps overlapping shapes editable after a narrow arrangement face`, async ({ page }) => {
    const p = newProject();
    p.width = 500;
    p.height = 400;
    p.layers[0].drawingMode = 'merge';
    const original = narrowArrangementOutline(320, 6_000_000);
    p.layers[0].keys[0].shapes = [original];
    await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
      JSON.stringify({ project, folder: null, manifest: null })), p);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: tool, exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    const read = () => page.evaluate(() =>
      (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
    const draw = async (x: number, y: number) => {
      const b = (await canvas.boundingBox())!;
      const left = b.x + b.width / 2 - 250 + x, top = b.y + b.height / 2 - 200 + y;
      if (tool === 'Pen') {
        for (const [dx, dy] of [[0, 0], [100, 0], [100, 38], [0, 38], [0, 0]])
          await page.mouse.click(left + dx, top + dy);
      } else {
        await page.mouse.move(left, top);
        await page.mouse.down();
        await page.mouse.move(left + 100, top + 38, { steps: 5 });
        await page.mouse.up();
      }
    };
    await draw(90, 308);
    await expect.poll(async () => (await read()).length).toBe(2);
    const first = await read();
    expect(first[0]).toEqual(original);
    expect(first[1]).toMatchObject({ fill: '#ff0000', drawingMode: 'merge' });
    await expect(page.getByText('Shape kept separately because its overlap could not be merged safely.', { exact: true })).toBeVisible();
    const pixel = (x: number, y: number) => canvas.evaluate((c: HTMLCanvasElement, { x, y }) =>
      Array.from(c.getContext('2d')!.getImageData(
        Math.round(c.width / 2 + (x - 250) * devicePixelRatio),
        Math.round(c.height / 2 + (y - 200) * devicePixelRatio), 1, 1,
      ).data), { x, y });
    await expect.poll(() => pixel(110, 335)).toEqual([255, 0, 0, 255]);
    await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
    await draw(130, 314);
    await expect.poll(async () => (await read()).length).toBe(3);
    expect((await read()).slice(0, 2)).toEqual(first);
    await expect.poll(() => pixel(150, 335)).toEqual([0, 255, 0, 255]);
    await draw(90, 220);
    await expect.poll(async () => (await read()).length).toBe(4);
    expect((await read()).slice(0, 2)).toEqual(first);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await canvas.press('Control+z');
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(first);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual([original]);
  });

test('Rounded rectangle clips only covered narrow ink and keeps curved corners', async ({ page }) => {
  const p = newProject();
  p.width = 500;
  p.height = 400;
  p.layers[0].drawingMode = 'merge';
  const original = narrowArrangementOutline(320, 6_000_000);
  p.layers[0].keys[0].shapes = [original];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Rounded rectangle', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Remove covered lines' }).check();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const b = (await canvas.boundingBox())!;
  const x = b.x + b.width / 2 - 250, y = b.y + b.height / 2 - 200;
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await page.mouse.move(x + 90, y + 308);
  await page.mouse.down();
  await page.mouse.move(x + 190, y + 346, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(3);
  const clipped = await read();
  const [right, left, paint] = clipped;
  expect(paint).toMatchObject({ kind: 'polygon', fill: '#ff0000', strokeWidth: 0, drawingMode: 'merge' });
  expect(paint.contours).toHaveLength(1);
  expect(paint.contours![0].filter(point => point.in || point.out).length).toBeGreaterThanOrEqual(4);
  for (const ink of [right, left]) {
    expect(ink).toMatchObject({ kind: 'path', fillEnabled: false, stroke: original.stroke, strokeWidth: original.strokeWidth });
    for (const endpoint of [ink.points[0], ink.points.at(-1)!]) {
      const cut = worldPoint(ink, endpoint);
      expect(cut.y).toBe(original.y);
      expect(paint.contours![0].map(point => worldPoint(paint, point).x)).toContain(cut.x);
    }
  }
  const untouched = original.points.map(point => worldPoint(original, point));
  expect(left.points.map(point => worldPoint(left, point))).toContainEqual(untouched[0]);
  const rightPoints = right.points.map(point => worldPoint(right, point));
  expect(rightPoints).toContainEqual(untouched[1]);
  expect(rightPoints).toContainEqual(untouched[2]);
  const pixel = (x: number, y: number) => canvas.evaluate((node: HTMLCanvasElement, point) =>
    [...node.getContext('2d')!.getImageData(
      Math.round(node.width / 2 + (point.x - 250) * devicePixelRatio),
      Math.round(node.height / 2 + (point.y - 200) * devicePixelRatio), 1, 1).data], { x, y });
  await expect.poll(() => pixel(140, 320)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(70, 320)).toEqual([24, 64, 170, 255]);
  await expect.poll(() => pixel(210, 320)).toEqual([24, 64, 170, 255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([original]);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(clipped);
});
