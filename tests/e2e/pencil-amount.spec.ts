import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import type { PencilDrawing } from '../../packages/geometry/src/pencil-drawing';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

async function setup(page: Page, objects = true) {
  const p = newProject();
  p.layers[0].drawingMode = objects ? 'object' : 'merge';
  await page.addInitScript((p) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
    const NativeWorker = Worker;
    Object.assign(window, { pencilPackets: [] });
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const packet = (message as { pencil?: PencilDrawing }).pencil;
        if (packet)
          (window as unknown as { pencilPackets: PencilDrawing[] }).pencilPackets.push(
            structuredClone(packet),
          );
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  // This suite isolates the smoothing percentage's legacy output. Optimization
  // has its own production workflows and can also fit zero-percent raw ink.
  await page.getByLabel('Pencil optimize', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByLabel('Separate Pencil objects', { exact: true }).setChecked(objects);
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    packets = () =>
      page.evaluate(() => (window as unknown as { pencilPackets: PencilDrawing[] }).pencilPackets);
  async function draw(y = 180, mid?: () => Promise<void>) {
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + 100, b.y + y);
    await page.mouse.down();
    for (let i = 1; i <= 120; i++) {
      await page.mouse.move(
        b.x + 100 + i * 2,
        b.y + y + Math.sin(i / 22) * 30 + Math.sin(i * 1.2) * 3,
      );
      if (i === 50 && mid) await mid();
    }
    await page.mouse.up();
  }
  return { p, canvas, read, packets, draw };
}

test('scene Pencil Shift constrains live and committed strokes to the chosen axis', async ({ page }) => {
  const f = await setup(page);
  await page.getByLabel('Pencil mode', { exact: true }).selectOption('ink');
  const bounds = (await f.canvas.boundingBox())!;
  const move = ([x, y]: readonly [number, number]) => page.mouse.move(bounds.x + x, bounds.y + y);
  const redAt = ([x, y]: readonly [number, number]) =>
    f.canvas.evaluate((node, { x, y }) => {
      const canvas = node as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const [r, g, b] = canvas.getContext('2d')!.getImageData(
        Math.round(x * canvas.width / rect.width),
        Math.round(y * canvas.height / rect.height),
        1, 1,
      ).data;
      return r > 160 && g < 100 && b < 100;
    }, { x, y });
  for (const stroke of [
    { start: [120, 130], first: [150, 137], end: [210, 175], preview: [165, 130], axis: 'y' },
    { start: [270, 115], first: [277, 145], end: [315, 205], preview: [270, 160], axis: 'x' },
  ] as const) {
    await page.keyboard.down('Shift');
    await move(stroke.start);
    await page.mouse.down();
    await move(stroke.first);
    await move(stroke.end);
    await expect.poll(() => redAt(stroke.preview)).toBe(true);
    await expect.poll(() => redAt(stroke.end)).toBe(false);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect.poll(f.packets).toHaveLength(stroke.axis === 'y' ? 1 : 2);
    const pencil = (await f.packets()).at(-1)!.stroke;
    expect(pencil.points.map((point) => point[stroke.axis])).toEqual([0, 0, 0]);
  }
  await expect.poll(async () => {
    const shapes = (await f.read()).layers[0].keys[0].shapes;
    return shapes.map(s => [s.width, s.height]);
  }).toEqual([[90, 0], [0, 90]]);
  await f.canvas.press('Control+z');
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Pencil percentage controls mirror each other, retain mode choices and do not edit the document', async ({
  page,
}) => {
  const f = await setup(page),
    options = page.getByRole('group', { name: 'Active drawing tool options' }),
    amount = page.getByLabel('Pencil simplify amount', { exact: true });
  await expect(amount).toHaveValue('50');
  await expect(amount).toHaveAttribute('max', '200');
  await expect(options.getByLabel('Pencil simplify slider', { exact: true })).toHaveAttribute(
    'max',
    '200',
  );
  await expect(page.getByLabel('Pencil finish simplify', { exact: true })).toHaveAttribute(
    'max',
    '200',
  );
  await expect(
    options.getByLabel('Pencil simplify slider', { exact: true }).locator('..'),
  ).toHaveText('Simplify');
  await expect(options.getByLabel('Pencil simplify slider', { exact: true })).toBeInViewport();
  await amount.fill('80');
  await expect(page.getByLabel('Pencil finish simplify', { exact: true })).toHaveValue('80');
  await page.getByLabel('Pencil finish simplify', { exact: true }).fill('25');
  await expect(page.getByLabel('Pencil simplify slider', { exact: true })).toHaveValue('25');
  for (const mode of ['ink', 'straight']) {
    await page.getByLabel('Pencil mode', { exact: true }).selectOption(mode);
    await expect(amount).toBeDisabled();
    await expect(page.getByLabel('Pencil finish simplify', { exact: true })).toBeDisabled();
  }
  await page.getByLabel('Pencil mode', { exact: true }).selectOption('smooth');
  await expect(amount).toBeEnabled();
  await expect(amount).toHaveValue('25');
  expect(await f.read()).toEqual(f.p);
});

for (const amount of [0, 25, 50, 100, 150, 200])
  test(`${amount} percent reaches the worker and produces editable new ink with exact history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Pencil simplify amount', { exact: true }).fill(String(amount));
    await f.draw();
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
    const out = await f.read(),
      shape = out.layers[0].keys[0].shapes[0];
    expect((await f.packets())[0].smoothing).toBe(amount);
    expect(shape.kind).toBe(amount === 0 ? 'path' : 'bezier');
    if (amount === 0) expect(shape.points.length).toBeGreaterThan(80);
    else if (amount >= 50) expect(shape.nodes!.length).toBeLessThan(12);
    await expect
      .poll(() =>
        f.canvas.evaluate((c) => {
          const n = c as HTMLCanvasElement,
            d = n.getContext('2d')!.getImageData(0, 0, n.width, n.height).data;
          let count = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) count++;
          return count;
        }),
      )
      .toBeGreaterThan(150);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });

test('current stroke freezes mode and percentage at contact, with next settings retained for the next stroke', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Pencil simplify amount', { exact: true }).fill('25');
  await f.draw(180, async () =>
    page.evaluate(() => {
      const amount = document.querySelector(
        '[aria-label="Pencil simplify amount"]',
      ) as HTMLInputElement;
      amount.value = '100';
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      const mode = document.querySelector('[aria-label="Pencil mode"]') as HTMLSelectElement;
      mode.value = 'straight';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }),
  );
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
  expect((await f.packets())[0]).toMatchObject({ mode: 'smooth', smoothing: 25 });
  expect((await f.read()).layers[0].keys[0].shapes[0].kind).toBe('bezier');
  await expect(page.getByLabel('Pencil simplify amount', { exact: true })).toHaveValue('100');
  const before = await f.read();
  await page.getByLabel('Pencil mode', { exact: true }).selectOption('smooth');
  await f.draw(300);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  expect((await f.packets())[1]).toMatchObject({ mode: 'smooth', smoothing: 100 });
  expect((await f.read()).layers[0].keys[0].shapes[0]).toEqual(before.layers[0].keys[0].shapes[0]);
});

test('strong smoothing finishes only incoming merged ink before joining it to earlier Pencil lines', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, false);
  await page.getByLabel('Pencil simplify amount', { exact: true }).fill('25');
  await f.draw(150);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
  const before = await f.read();
  await page.getByLabel('Pencil simplify amount', { exact: true }).fill('100');
  await f.draw(300);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(before);
  await page.getByLabel('Pencil simplify amount', { exact: true }).fill('5');
  await releaseGeometry(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  const prior = before.layers[0].keys[0].shapes[0];
  expect((await f.read()).layers[0].keys[0].shapes.find((s) => s.id === prior.id)).toEqual(prior);
  expect((await f.packets())[1]).toMatchObject({ mode: 'smooth', merge: true, smoothing: 100 });
});

test('invalid percentage rejects before pointer capture or worker dispatch and allows a corrected stroke', async ({
  page,
}) => {
  const f = await setup(page);
  for (const value of ['201', '-1', '']) {
    await page.getByLabel('Pencil simplify amount', { exact: true }).fill(value);
    const b = (await f.canvas.boundingBox())!;
    await page.mouse.click(b.x + 140, b.y + 180);
    await expect(page.getByRole('alert')).toContainText('0 to 200');
    expect(await f.packets()).toHaveLength(0);
    expect(await f.read()).toEqual(f.p);
    await expect.poll(() => f.canvas.evaluate((c) => c.hasPointerCapture(1))).toBe(false);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  }
  await page.getByLabel('Pencil simplify amount', { exact: true }).fill('70');
  await f.draw();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
});

test('Brush Simplify controls cap at 200 percent, mirror Properties and reject invalid contact without changing artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const options = page.getByRole('group', { name: 'Active drawing tool options' }),
    amount = page.getByLabel('Brush simplify amount', { exact: true }),
    properties = page.getByLabel('Brush finish simplify', { exact: true });
  await expect(options.getByText('Simplify', { exact: true })).toBeVisible();
  for (const field of [
    amount,
    properties,
    options.getByLabel('Brush simplify slider', { exact: true }),
  ])
    await expect(field).toHaveAttribute('max', '200');
  await properties.fill('200');
  await expect(amount).toHaveValue('200');
  await expect(options.getByLabel('Brush simplify slider', { exact: true })).toHaveValue('200');
  await amount.fill('201');
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.click(b.x + 140, b.y + 180);
  await expect(page.getByRole('alert')).toContainText('Brush simplify from 0 to 200');
  expect(await f.read()).toEqual(f.p);
  expect(await f.canvas.evaluate((c) => c.hasPointerCapture(1))).toBe(false);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await amount.fill('200');
  await page.mouse.move(b.x + 150, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 215, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
