import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { mapPoint, matrix } from '../../packages/geometry/src/affine';
import { mergeDrawingVectors } from '../../packages/geometry/src/merge';

async function setup(page: Page, rounded = false, denseEditable = false) {
  const p = newProject();
  p.width = 600;
  p.height = 360;
  p.layers[0].drawingMode = 'object';
  p.opacityBindings = [];
  const curve: Vector = {
    id: 'editable',
    kind: 'bezier',
    x: 80,
    y: 80,
    width: 180,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: 4,
    fillEnabled: false,
    points: [],
    nodes: [
      { x: 0, y: 60, out: { x: 60, y: 0 } },
      { x: 180, y: 60, in: { x: 120, y: 0 } },
    ],
  };
  const dense: Vector = {
    ...curve,
    id: 'background',
    kind: 'polygon',
    x: 330,
    y: 70,
    width: 150,
    height: 160,
    fill: '#0000ff',
    fillEnabled: true,
    strokeWidth: 0,
    closed: true,
    nodes: undefined,
    points: Array.from({ length: 24000 }, (_, i) => ({
      x: 75 + 75 * Math.cos((i * 2 * Math.PI) / 24000),
      y: 80 + 80 * Math.sin((i * 2 * Math.PI) / 24000),
    })),
  };
  if (denseEditable) {
    curve.height = 0;
    curve.nodes = Array.from({ length: 4096 }, (_, i) => ({ x: (180 * i) / 4095, y: 0 }));
  }
  p.layers[0].keys[0].shapes = [dense, curve];
  if (rounded) {
    p.layers[0].drawingMode = 'merge';
    p.layers[0].keys[0].shapes = [
      dense,
      ...mergeDrawingVectors([
        {
          ...curve,
          kind: 'rectangle',
          nodes: undefined,
          height: 120,
          cornerRadius: 24,
          fillEnabled: true,
        },
      ]),
    ];
  }
  await page.addInitScript((p) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
    let blue = 0,
      heavy = 0,
      images = 0,
      pointer = 0;
    const fill = CanvasRenderingContext2D.prototype.fill,
      stringify = JSON.stringify,
      drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.fill = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      if (this.fillStyle === '#0000ff') blue++;
      return Reflect.apply(fill, this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      images++;
      return Reflect.apply(drawImage, this, args);
    };
    JSON.stringify = function (value: unknown, ...args: unknown[]) {
      if (value && typeof value === 'object' && 'layers' in value) heavy++;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    } as typeof JSON.stringify;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as HTMLElement).getAttribute('aria-label') === 'Drawing stage')
          pointer = e.pointerId;
      },
      true,
    );
    Object.assign(window, { dragWork: () => ({ blue, heavy, images, pointer }) });
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const at = async (x: number, y: number) => {
    const r = (await canvas.boundingBox())!;
    return { x: r.x + (r.width - p.width) / 2 + x, y: r.y + (r.height - p.height) / 2 + y };
  };
  const move = async (x: number, y: number) => {
    const q = await at(x, y);
    await page.mouse.move(q.x, q.y);
  };
  const settle = () =>
    page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const work = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          dragWork: () => { blue: number; heavy: number; images: number; pointer: number };
        }
      ).dragWork(),
    );
  const pixel = async (x: number, y: number) =>
    canvas.evaluate(
      (n, { x, y, w, h }) => {
        const c = n as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - w / 2) * devicePixelRatio),
              Math.round(c.height / 2 + (y - h / 2) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { x, y, w: p.width, h: p.height },
    );
  return { p, canvas, at, move, settle, read, work, pixel };
}

for (const part of ['object', 'anchor', 'tangent', 'edge'] as const)
  test(`dense-scene ${part} dragging reuses original paint and avoids document serialization`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (part !== 'object') {
      await page.getByRole('button', { name: 'Subselection', exact: true }).click();
      await f.move(80, 140);
      await page.mouse.down();
      await page.mouse.up();
    }
    const start = part === 'anchor' ? [80, 140] : part === 'tangent' ? [140, 80] : [170, 95];
    await f.move(start[0], start[1]);
    await page.mouse.down();
    await f.move(start[0] + 10, start[1] + 10);
    await f.settle();
    const a = await f.work();
    const times: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const begin = Date.now();
      await f.move(start[0] + 10 + i, start[1] + 10 + i);
      await f.settle();
      times.push(Date.now() - begin);
    }
    const b = await f.work();
    console.info(
      'dense manipulation work',
      part,
      JSON.stringify({ before: a, after: b, stepMs: times }),
    );
    expect(b.heavy).toBe(a.heavy);
    expect(b.blue).toBe(a.blue);
    expect(b.images).toBeGreaterThan(a.images);
    expect(await f.read()).toEqual(f.p);
    const controls =
      part === 'anchor'
        ? [
            [98, 158],
            [158, 98],
            [200, 80],
            [260, 140],
          ]
        : part === 'tangent'
          ? [
              [80, 140],
              [158, 98],
              [200, 80],
              [260, 140],
            ]
          : undefined;
    const t = part === 'anchor' ? 0.25 : 0.35;
    const paintAt = controls
      ? [0, 1].map((axis) =>
          controls.reduce(
            (sum, p, i) =>
              sum +
              p[axis] *
                [Math.pow(1 - t, 3), 3 * Math.pow(1 - t, 2) * t, 3 * (1 - t) * t * t, t * t * t][i],
            0,
          ),
        )
      : [188, 113];
    let red = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const p = await f.pixel(paintAt[0] + dx, paintAt[1] + dy);
        if (p[0] > 180 && p[1] < 80 && p[2] < 80) red++;
      }
    expect(red).toBeGreaterThan(2);
    expect(await f.pixel(405, 150)).toEqual([0, 0, 255, 255]);
    await page.mouse.up();
    const out = await f.read(),
      edited = out.layers[0].keys[0].shapes[1];
    expect(out.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
    expect(edited.nodes).toHaveLength(2);
    expect(edited).not.toEqual(f.p.layers[0].keys[0].shapes[1]);
    if (part === 'anchor')
      expect(mapPoint(matrix(edited), edited.nodes![0])).toMatchObject({ x: 98, y: 158 });
    if (part === 'tangent')
      expect(mapPoint(matrix(edited), edited.nodes![0].out!)).toMatchObject({ x: 158, y: 98 });
    if (part === 'object') {
      expect(edited.x).toBe(98);
      expect(edited.y).toBe(98);
    }
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });

for (const cancel of ['Escape', 'capture', 'zoom', 'layout', 'return'] as const)
  test(`detached node preview cancels on ${cancel} without publishing edits`, async ({ page }) => {
    const f = await setup(page);
    await page.getByRole('button', { name: 'Subselection', exact: true }).click();
    await f.move(80, 140);
    await page.mouse.down();
    await f.move(110, 165);
    await f.settle();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'capture') {
      const id = (await f.work()).pointer;
      await f.canvas.evaluate((n, id) => (n as HTMLElement).releasePointerCapture(id), id);
    } else if (cancel === 'zoom')
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
    else if (cancel === 'layout') {
      await f.canvas.evaluate((n) => ((n as HTMLElement).style.transform = 'translateX(15px)'));
      await f.move(120, 170);
    } else await f.move(80, 140);
    await page.mouse.up();
    await f.settle();
    expect(await f.read()).toEqual(f.p);
    if (cancel === 'zoom')
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    if (cancel === 'layout')
      await f.canvas.evaluate((n) => ((n as HTMLElement).style.transform = ''));
    await f.move(80, 140);
    await page.mouse.down();
    await f.move(90, 150);
    await page.mouse.up();
    const shape = (await f.read()).layers[0].keys[0].shapes[1];
    expect(mapPoint(matrix(shape), shape.nodes![0])).toMatchObject({ x: 90, y: 150 });
  });

test('cached rounded-corner editing carries both fill and outline without rebuilding distant paint', async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await f.move(104, 80);
  await page.mouse.down();
  await f.move(114, 90);
  await f.settle();
  const a = await f.work();
  await f.move(124, 95);
  await f.settle();
  const b = await f.work();
  expect(b.heavy).toBe(a.heavy);
  expect(b.blue).toBe(a.blue);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  const out = await f.read();
  expect(out.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
  for (const old of f.p.layers[0].keys[0].shapes.slice(1)) {
    const shape = out.layers[0].keys[0].shapes.find((s) => s.id === old.id)!;
    const before = old.contours?.flat() ?? old.nodes!,
      after = shape.contours?.flat() ?? shape.nodes!;
    expect(after).toHaveLength(8);
    for (const [i, n] of before.entries()) {
      const p = mapPoint(matrix(old), n),
        q = mapPoint(matrix(shape), after[i]);
      const picked = Math.hypot(p.x - 104, p.y - 80) < 1e-7;
      expect(q.x).toBeCloseTo(p.x + (picked ? 20 : 0), 8);
      expect(q.y).toBeCloseTo(p.y + (picked ? 15 : 0), 8);
    }
  }
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('coalesced node moves use the latest release coordinates and preserve native capture cleanup', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await f.move(80, 140);
  await page.mouse.down();
  const pointer = (await f.work()).pointer,
    q = await f.at(110, 160);
  await f.canvas.evaluate(
    (n, { pointer, q }) => {
      for (let i = 0; i < 64; i++)
        n.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: pointer,
            clientX: q.x + i / 64,
            clientY: q.y,
            buttons: 1,
            bubbles: true,
          }),
        );
    },
    { pointer, q },
  );
  await f.settle();
  expect(await f.read()).toEqual(f.p);
  await f.move(120, 170);
  await page.mouse.up();
  const shape = (await f.read()).layers[0].keys[0].shapes[1];
  expect(mapPoint(matrix(shape), shape.nodes![0])).toMatchObject({ x: 120, y: 170 });
  expect(
    await f.canvas.evaluate((n, id) => (n as HTMLElement).hasPointerCapture(id), pointer),
  ).toBe(false);
});

test('editing a 4096-anchor stroke uses a detached pose and preserves every other authored point', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await f.move(80, 80);
  await page.mouse.down();
  await f.move(90, 90);
  await f.settle();
  const a = await f.work();
  for (let i = 1; i <= 4; i++) {
    await f.move(90 + i * 2, 90 + i * 2);
    await f.settle();
  }
  const b = await f.work();
  expect(b.heavy).toBe(a.heavy);
  expect(b.blue).toBe(a.blue);
  expect(await f.pixel(98, 98)).toEqual([146, 117, 255, 255]);
  const red = await f.pixel(92, 92);
  expect(red[0]).toBeGreaterThan(180);
  expect(red[1]).toBeLessThan(80);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  const out = await f.read(),
    shape = out.layers[0].keys[0].shapes[1];
  expect(shape.nodes).toHaveLength(4096);
  for (const [i, node] of shape.nodes!.entries()) {
    const p = mapPoint(matrix(shape), node);
    expect(p.x).toBeCloseTo(i ? 80 + (180 * i) / 4095 : 98, 8);
    expect(p.y).toBeCloseTo(i ? 80 : 98, 8);
  }
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('invalid detached node release preserves the source and a fresh edge drag recovers without shifting its view', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await f.move(80, 140);
  await page.mouse.down();
  const pointer = (await f.work()).pointer,
    q = await f.at(80, 140);
  await f.canvas.evaluate(
    (n, { pointer, q }) => {
      n.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: pointer,
          clientX: q.x + 20000000,
          clientY: q.y,
          buttons: 0,
          bubbles: true,
        }),
      );
    },
    { pointer, q },
  );
  await page.mouse.up();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.move(170, 95);
  await page.mouse.down();
  await f.move(180, 105);
  await f.settle();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByRole('alert')).toBeVisible();
  await f.move(188, 113);
  await page.mouse.up();
  const out = await f.read();
  expect(out).not.toEqual(f.p);
  expect(out.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a new document cancels captured node work before replacing the source', async ({ page }) => {
  const f = await setup(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await f.move(80, 140);
  await page.mouse.down();
  await f.move(100, 160);
  const pointer = (await f.work()).pointer;
  await page
    .getByRole('button', { name: 'File', exact: true })
    .evaluate((n) => (n as HTMLButtonElement).click());
  await page
    .getByRole('button', { name: 'New project', exact: true })
    .evaluate((n) => (n as HTMLButtonElement).click());
  expect(
    await f.canvas.evaluate((n, id) => (n as HTMLElement).hasPointerCapture(id), pointer),
  ).toBe(false);
  await page.mouse.up();
  await f.settle();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const fresh = await f.read();
  expect(fresh.id).not.toBe(f.p.id);
  expect(fresh.layers).toHaveLength(2);
  expect(fresh.layers.every((l) => l.keys[0].shapes.length === 0)).toBe(true);
  await f.settle();
  expect(await f.read()).toEqual(fresh);
});
