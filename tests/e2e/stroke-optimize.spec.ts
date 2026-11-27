import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  preparePencilDrawing,
  type PencilDrawing,
} from '../../packages/geometry/src/pencil-drawing';
import { commitBrushPaint, type BrushCommit } from '../../packages/geometry/src/brush-commit';
import { matrix, mapPoint } from '../../packages/geometry/src/affine';
import { normalizeVector } from '../../packages/geometry/src/drawing';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

type Packet = { shapes: Vector[]; pencil?: PencilDrawing; brushCommit?: BrushCommit };
const count = (s: Vector) => s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
const geometry = (shapes: Vector[]) =>
  shapes.map((s) => {
    const result: Partial<Vector> = structuredClone(s);
    delete result.id;
    return result;
  });
const read = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
const packets = (page: Page) =>
  page.evaluate(() => (window as unknown as { inkPackets: Packet[] }).inkPackets);
async function setup(
  page: Page,
  tool: 'Pencil' | 'Brush',
  symbol = false,
  held = false,
  seed?: Vector[],
) {
  const p = newProject();
  p.layers[0].drawingMode = tool === 'Pencil' ? 'object' : 'merge';
  if (seed && !symbol) p.layers[0].keys[0].shapes = structuredClone(seed);
  if (symbol)
    p.symbols = [
      {
        id: 'art',
        name: 'Optimize ink',
        width: 100,
        height: 100,
        shapes: seed
          ? structuredClone(seed)
          : [
              {
                id: 'base',
                kind: 'rectangle',
                x: 5,
                y: 5,
                width: 5,
                height: 5,
                rotation: 0,
                fill: '#0000ff',
                stroke: '#000000',
                strokeWidth: 0,
                points: [],
              },
            ],
      },
    ];
  if (held) await holdGeometry(page);
  await page.addInitScript((p) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
    const NativeWorker = Worker;
    Object.assign(window, { inkPackets: [], finishedInk: 0 });
    window.Worker = class extends NativeWorker {
      ink = false;
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const packet = message as Packet;
        if (packet.pencil || packet.brushCommit) {
          this.ink = true;
          (window as unknown as { inkPackets: Packet[] }).inkPackets.push(structuredClone(packet));
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
      terminate() {
        if (this.ink) {
          this.ink = false;
          (window as unknown as { finishedInk: number }).finishedInk++;
        }
        super.terminate();
      }
    };
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  if (symbol) {
    await page
      .getByRole('option', { name: 'Library item Optimize ink', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Symbol canvas tool').selectOption(tool.toLowerCase());
    if (tool === 'Pencil') {
      await page.getByLabel('Symbol pencil smoothing', { exact: true }).selectOption('raw');
      await page.getByLabel('New symbol line color').fill('#ff0000');
      await page.getByLabel('New symbol line width').fill('2');
    } else {
      await page.getByText('Smooth symbol brush', { exact: true }).uncheck();
      await page.getByLabel('New symbol drawing fill').fill('#ff0000');
    }
  } else {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    if (tool === 'Pencil') {
      await page.getByLabel('Separate Pencil objects', { exact: true }).check();
      await page.getByLabel('Pencil simplify amount', { exact: true }).fill('0');
      await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
    } else {
      await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
      await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    }
  }
  const canvas = page.getByLabel(symbol ? 'Symbol artwork preview' : 'Drawing stage', {
    exact: true,
  });
  const option = page.getByLabel(
    symbol ? `Symbol ${tool.toLowerCase()} optimize` : `${tool} optimize`,
    { exact: true },
  );
  async function draw(mid?: () => Promise<void>, offset = 0) {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    const point = (i: number) =>
      symbol
        ? {
            x: b.x + ((20 + (15 + i * 0.5) * 2.9) * b.width) / 540 + offset,
            y: b.y + ((20 + (55 + Math.sin(i / 65) * 10) * 2.9) * b.height) / 330,
          }
        : { x: b.x + 100 + i * 1.5 + offset, y: b.y + 140 + Math.sin(i / 65) * 25 };
    const a = point(0);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 120; i++) {
      const q = point(i);
      await page.mouse.move(q.x, q.y);
      if (i === 60 && mid) await mid();
    }
    await page.mouse.up();
  }
  return { p, canvas, option, draw };
}

test('Optimize defaults on beside both smoothing controls, mirrors Properties and remains independent per tool', async ({
  page,
}) => {
  const f = await setup(page, 'Pencil');
  await expect(f.option).toBeChecked();
  await expect(f.option).toBeInViewport();
  await f.option.uncheck();
  await expect(page.getByLabel('Pencil optimize in Properties', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(page.getByLabel('Brush optimize', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Brush optimize', { exact: true })).toBeInViewport();
  await page.getByLabel('Brush optimize in Properties', { exact: true }).uncheck();
  await expect(page.getByLabel('Brush optimize', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await expect(f.option).not.toBeChecked();
  expect(await read(page)).toEqual(f.p);
});

for (const tool of ['Pencil', 'Brush'] as const)
  for (const optimize of [true, false])
    test(`${tool} Optimize ${optimize} reaches the worker, preserves visible ink and one exact history step`, async ({
      page,
    }) => {
      const f = await setup(page, tool);
      await expect(f.option).toBeChecked();
      await f.option.setChecked(optimize);
      await f.draw();
      await expect
        .poll(async () => (await read(page)).layers[0].keys[0].shapes.length)
        .toBeGreaterThan(0);
      const out = await read(page),
        packet = (await packets(page))[0];
      expect((packet.pencil ?? packet.brushCommit)!.optimize).toBe(optimize);
      const expected = packet.pencil
        ? preparePencilDrawing(packet.shapes, packet.pencil).shape
        : undefined;
      if (expected) expect(out.layers[0].keys[0].shapes).toEqual([expected]);
      else
        expect(geometry(out.layers[0].keys[0].shapes)).toEqual(
          geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)),
        );
      if (optimize) {
        const plain = packet.pencil
          ? [preparePencilDrawing(packet.shapes, { ...packet.pencil, optimize: false }).shape]
          : commitBrushPaint(packet.shapes, { ...packet.brushCommit!, optimize: false });
        expect(out.layers[0].keys[0].shapes.reduce((n, s) => n + count(s), 0)).toBeLessThan(
          plain.reduce((n, s) => n + count(s), 0),
        );
        expect(
          out.layers[0].keys[0].shapes.some((s) =>
            (s.nodes ?? s.contours?.flat() ?? []).some((n) => n.in || n.out),
          ),
        ).toBe(true);
      }
      await expect
        .poll(() =>
          f.canvas.evaluate((c: HTMLCanvasElement) => {
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            let red = 0;
            for (let i = 0; i < d.length; i += 4)
              if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
            return red;
          }),
        )
        .toBeGreaterThan(100);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(() => read(page)).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => read(page)).toEqual(out);
    });

for (const tool of ['Pencil', 'Brush'] as const)
  test(`symbol ${tool} keeps pending ink, recovers a failed optimization and discards late cancelled results`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const f = await setup(page, tool, true, true);
    await f.draw();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await read(page)).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        f.canvas.evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
          return red;
        }),
      )
      .toBeGreaterThan(100);
    await releaseGeometry(page, true);
    await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
    await expect(
      page.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await f.draw();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    await releaseGeometry(page);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { finishedInk: number }).finishedInk))
      .toBe(2);
    await expect(
      page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    ).toHaveCount(0);
    expect(await read(page)).toEqual(f.p);
    expect(errors).toEqual([]);
  });

for (const tool of ['Pencil', 'Brush'] as const)
  test(`${tool} captures Optimize at stroke start and retains ink while the worker is pending`, async ({
    page,
  }) => {
    const f = await setup(page, tool, false, true);
    await f.draw(async () =>
      f.option.evaluate((e: HTMLInputElement) => {
        e.checked = false;
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    );
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await read(page)).toEqual(f.p);
    expect(
      ((await packets(page))[0].pencil ?? (await packets(page))[0].brushCommit)!.optimize,
    ).toBe(true);
    await expect(f.option).not.toBeChecked();
    await expect
      .poll(() =>
        f.canvas.evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
          return red;
        }),
      )
      .toBeGreaterThan(100);
    await releaseGeometry(page, true);
    await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
    expect(await read(page)).toEqual(f.p);
    await f.draw();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect
      .poll(async () => (await read(page)).layers[0].keys[0].shapes.length)
      .toBeGreaterThan(0);
    expect(
      ((await packets(page))[1].pencil ?? (await packets(page))[1].brushCommit)!.optimize,
    ).toBe(false);
  });

for (const tool of ['Pencil', 'Brush'] as const)
  for (const optimize of [true, false])
    test(`symbol ${tool} Optimize ${optimize} keeps local/Apply/document history and detached prepared ink`, async ({
      page,
    }) => {
      const f = await setup(page, tool, true);
      await expect(f.option).toBeChecked();
      await f.option.setChecked(optimize);
      await f.draw();
      const dialog = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
      await expect(
        dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole('status').filter({ hasText: 'Finishing symbol stroke' }),
      ).toHaveCount(0);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      expect(await read(page)).toEqual(f.p);
      const packet = (await packets(page))[0];
      expect((packet.pencil ?? packet.brushCommit)!.optimize).toBe(optimize);
      await dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
      await expect(dialog.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
      await dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
      await dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      const out = await read(page),
        shapes = out.symbols![0].shapes;
      if (packet.pencil)
        expect(shapes).toEqual([
          ...f.p.symbols![0].shapes,
          preparePencilDrawing([], packet.pencil).shape,
        ]);
      else
        expect(geometry(shapes)).toEqual(
          geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)),
        );
      if (optimize) {
        const plain = packet.pencil
          ? [
              ...f.p.symbols![0].shapes,
              preparePencilDrawing([], { ...packet.pencil, optimize: false }).shape,
            ]
          : commitBrushPaint(packet.shapes, { ...packet.brushCommit!, optimize: false });
        expect(shapes.reduce((n, s) => n + count(s), 0)).toBeLessThan(
          plain.reduce((n, s) => n + count(s), 0),
        );
      }
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(() => read(page)).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => read(page)).toEqual(out);
    });

for (const symbol of [false, true])
  test(`${symbol ? 'symbol' : 'main'} overlapping optimized Brush strokes keep curves and substantially fewer vertices after merging`, async ({
    page,
  }) => {
    const f = await setup(page, 'Brush', symbol);
    const snapshots: Project[] = [];
    for (let i = 0; i < 3; i++) {
      await f.draw(undefined, i * (symbol ? 20 : 50));
      await expect.poll(() => packets(page).then((p) => p.length)).toBe(i + 1);
      if (symbol)
        await expect(
          page.getByRole('button', { name: 'Undo artwork change', exact: true }),
        ).toBeEnabled();
      else {
        await expect
          .poll(async () => {
            const shapes = (await read(page)).layers[0].keys[0].shapes;
            const packet = (await packets(page))[i];
            return (
              JSON.stringify(geometry(shapes)) ===
              JSON.stringify(geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)))
            );
          })
          .toBe(true);
        snapshots.push(await read(page));
      }
    }
    await expect
      .poll(() =>
        f.canvas.evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4)
            if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
          return red;
        }),
      )
      .toBeGreaterThan(500);
    if (symbol) {
      await page.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      await expect
        .poll(async () => (await read(page)).symbols![0].shapes.length)
        .toBeGreaterThan(1);
    }
    const result = await read(page),
      packet = (await packets(page)).at(-1)!;
    const shapes = symbol ? result.symbols![0].shapes : result.layers[0].keys[0].shapes;
    const plain = commitBrushPaint(packet.shapes, { ...packet.brushCommit!, optimize: false });
    expect(geometry(shapes)).toEqual(
      geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)),
    );
    expect(shapes.reduce((n, s) => n + count(s), 0)).toBeLessThan(
      plain.reduce((n, s) => n + count(s), 0) * 0.5,
    );
    expect(shapes.some((s) => s.contours?.some((r) => r.some((n) => n.in || n.out)))).toBe(true);
    await expect.poll(() => f.canvas.isVisible()).toBe(!symbol);
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => read(page)).toEqual(symbol ? f.p : snapshots[1]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => read(page)).toEqual(result);
  });

for (const { symbol, overlap } of [
  { symbol: false, overlap: false },
  { symbol: true, overlap: false },
  { symbol: false, overlap: true },
  { symbol: true, overlap: true },
])
  test(`${symbol ? 'symbol' : 'main'} ${overlap ? 'overlapping coloured' : 'independent coloured'} Brush outlines keep optimized curves through overlapping bounds`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const f = await setup(page, 'Brush', symbol);
    await expect(f.option).toBeChecked();
    if (symbol) {
      await page.getByText('Smooth symbol brush', { exact: true }).check();
      await page.getByLabel('Symbol brush size', { exact: true }).fill('6');
    } else {
      await page.getByLabel('Brush simplify amount', { exact: true }).fill('50');
      await page.getByLabel('Brush size', { exact: true }).fill('14');
    }
    const pixel = (x: number, y: number) =>
      f.canvas.evaluate(
        (n, p) => {
          const c = n as HTMLCanvasElement,
            r = c.getBoundingClientRect(),
            x = p.symbol ? 20 + p.x * 2.9 : p.x,
            y = p.symbol ? 20 + p.y * 2.9 : p.y;
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                (x * c.width) / (p.symbol ? 540 : r.width),
                (y * c.height) / (p.symbol ? 330 : r.height),
                1,
                1,
              ).data,
          );
        },
        { x, y, symbol },
      );
    const sample = {
      blue: overlap ? (symbol ? 18 : 210) : symbol ? 82 : 390,
      red: overlap ? (symbol ? 94 : 420) : symbol ? 63 : 335,
      gap: overlap ? (symbol ? 65 : 350) : symbol ? 72 : 360,
      center: overlap ? (symbol ? 61 : 330) : symbol ? 50 : 300,
      y: symbol ? 50 : 220,
    };
    const crossing = symbol
      ? { x: 50 + 1024 / 44, y: 50 + Math.sqrt(1024 - (1024 / 44) ** 2) }
      : { x: 367.5, y: 220 + Math.sqrt(90 ** 2 - 67.5 ** 2) };
    const snapshots: Project[] = [];
    for (const [i, color] of ['#0000ff', '#ff0000'].entries()) {
      await page
        .getByLabel(symbol ? 'New symbol drawing fill' : 'Drawing fill', { exact: true })
        .fill(color);
      await f.canvas.scrollIntoViewIfNeeded();
      const b = (await f.canvas.boundingBox())!,
        radius = symbol ? (i ? (overlap ? 22 : 13) : 32) : i ? (overlap ? 60 : 35) : 90,
        cx = i && overlap ? (symbol ? 72 : 360) : symbol ? 50 : 300,
        cy = symbol ? 50 : 220;
      const point = (step: number) => {
        const angle = (step * Math.PI) / 90,
          x = cx + radius * Math.cos(angle),
          y = cy + radius * Math.sin(angle);
        return {
          x: b.x + (symbol ? ((20 + x * 2.9) * b.width) / 540 : x),
          y: b.y + (symbol ? ((20 + y * 2.9) * b.height) / 330 : y),
        };
      };
      const start = point(0);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let j = 1; j <= 180; j++) {
        const p = point(j);
        await page.mouse.move(p.x, p.y);
      }
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { finishedInk: number }).finishedInk))
        .toBe(i + 1);
      await page.mouse.move(b.x + 5, b.y + 5);
      await expect.poll(() => pixel(sample.blue, sample.y)).toEqual([0, 0, 255, 255]);
      if (i) await expect.poll(() => pixel(sample.red, sample.y)).toEqual([255, 0, 0, 255]);
      if (overlap)
        await expect
          .poll(() => pixel(crossing.x, crossing.y))
          .toEqual(i ? [255, 0, 0, 255] : [0, 0, 255, 255]);
      if (symbol) expect(await read(page)).toEqual(f.p);
      else snapshots.push(await read(page));
    }
    await expect.poll(() => pixel(sample.gap, sample.y)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => pixel(sample.center, sample.y)).toEqual([255, 255, 255, 255]);
    if (symbol) {
      await page.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
      await expect.poll(() => pixel(sample.red, sample.y)).toEqual([255, 255, 255, 255]);
      await expect.poll(() => pixel(sample.blue, sample.y)).toEqual([0, 0, 255, 255]);
      await page.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
      await expect.poll(() => pixel(sample.red, sample.y)).toEqual([255, 0, 0, 255]);
      await page.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    }
    const result = await read(page),
      shapes = symbol ? result.symbols![0].shapes : result.layers[0].keys[0].shapes,
      packet = (await packets(page)).at(-1)!,
      plain = commitBrushPaint(packet.shapes, { ...packet.brushCommit!, optimize: false });
    console.log('Independent coloured Brush anchors:', {
      editor: symbol ? 'symbol' : 'main',
      overlap,
      optimized: shapes.reduce((n, s) => n + count(s), 0),
      tessellated: plain.reduce((n, s) => n + count(s), 0),
    });
    if (!overlap) expect(shapes.reduce((n, s) => n + count(s), 0)).toBeLessThan(80);
    expect(shapes.reduce((n, s) => n + count(s), 0)).toBeLessThan(
      plain.reduce((n, s) => n + count(s), 0) * (overlap ? 0.8 : 0.5),
    );
    for (const color of ['#0000ff', '#ff0000'])
      expect(
        shapes
          .filter((s) => s.fill === color)
          .some((s) => s.contours?.some((r) => r.some((n) => n.in || n.out))),
      ).toBe(true);
    expect(geometry(shapes)).toEqual(
      geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)),
    );
    if (overlap) {
      const old = packet.shapes
        .flatMap((s) =>
          (s.contours ?? [])
            .flat()
            .filter((n) => n.in && n.out)
            .map((n) => ({ s, n, p: mapPoint(matrix(s), n) })),
        )
        .sort((a, b) => a.p.x - b.p.x)[0];
      expect(old).toBeDefined();
      const retained = shapes
        .flatMap((s) => (s.contours ?? []).flat().map((n) => ({ s, n, p: mapPoint(matrix(s), n) })))
        .find((a) => Math.hypot(a.p.x - old.p.x, a.p.y - old.p.y) < 1e-8);
      expect(retained).toBeDefined();
      for (const role of ['in', 'out'] as const) {
        const expected = mapPoint(matrix(old.s), old.n[role]!),
          actual = mapPoint(matrix(retained!.s), retained!.n[role]!);
        expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(1e-8);
      }
    }

    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => read(page)).toEqual(symbol ? f.p : snapshots[0]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => read(page)).toEqual(result);
    expect(errors).toEqual([]);
  });

for (const symbol of [false, true])
  for (const optimize of [false, true])
    for (const overlap of [false, true])
      test(`${symbol ? 'symbol' : 'main'} Brush preserves untouched old cubic anchors with new Optimize ${optimize} and ${overlap ? 'actual overlap' : 'nearby disjoint hull overlap'}`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const radius = symbol ? 20 : 60,
          cx = symbol ? 40 : 300,
          cy = symbol ? 50 : 220,
          k = radius * 0.5522847498307936;
        const old: Vector = {
          id: 'original-curved-paint',
          kind: 'polygon',
          x: cx,
          y: cy,
          width: radius * 2,
          height: radius * 2,
          rotation: 0,
          points: [],
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          fillRule: 'evenodd',
          drawingMode: 'merge',
          closed: true,
          contours: [
            [
              { x: radius, y: 0, in: { x: radius, y: -k }, out: { x: radius, y: k } },
              { x: 0, y: radius, in: { x: k, y: radius }, out: { x: -k, y: radius } },
              { x: -radius, y: 0, in: { x: -radius, y: k }, out: { x: -radius, y: -k } },
              { x: 0, y: -radius, in: { x: -k, y: -radius }, out: { x: k, y: -radius } },
            ],
          ],
        };
        normalizeVector(old);
        const f = await setup(page, 'Brush', symbol, false, [old]);
        await f.option.setChecked(optimize);
        await page
          .getByLabel(symbol ? 'Symbol brush size' : 'Brush size', { exact: true })
          .fill(symbol ? '4' : '16');
        await f.canvas.scrollIntoViewIfNeeded();
        const box = (await f.canvas.boundingBox())!;
        const screen = (x: number, y: number) => ({
          x:
            box.x + (symbol ? ((20 + x * 2.9) * box.width) / 540 : (box.width - f.p.width) / 2 + x),
          y:
            box.y +
            (symbol ? ((20 + y * 2.9) * box.height) / 330 : (box.height - f.p.height) / 2 + y),
        });
        const pixel = (x: number, y: number) =>
          f.canvas.evaluate(
            (c: HTMLCanvasElement, q) => {
              const b = c.getBoundingClientRect();
              return Array.from(
                c
                  .getContext('2d')!
                  .getImageData(
                    Math.floor(((q.x - b.x) * c.width) / b.width),
                    Math.floor(((q.y - b.y) * c.height) / b.height),
                    1,
                    1,
                  ).data,
              );
            },
            screen(x, y),
          );
        const x = overlap ? cx - radius / 4 : cx + radius * 0.85,
          y = overlap ? cy - radius : cy - radius * 0.85,
          length = symbol ? 10 : 30;
        await expect.poll(() => pixel(cx, cy)).toEqual([0, 0, 255, 255]);
        const start = screen(x, y);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) {
          const p = screen(x + (length * i) / 20, y);
          await page.mouse.move(p.x, p.y);
        }
        await page.mouse.up();
        await expect
          .poll(() =>
            page.evaluate(() => (window as unknown as { finishedInk: number }).finishedInk),
          )
          .toBe(1);
        await page.mouse.move(box.x + 3, box.y + 3);
        const probe = { x: x + length / 2, y: y - (symbol ? 1 : 3) };
        await expect.poll(() => pixel(probe.x, probe.y)).toEqual([255, 0, 0, 255]);
        await expect.poll(() => pixel(cx, cy)).toEqual([0, 0, 255, 255]);
        if (symbol) {
          expect(await read(page)).toEqual(f.p);
          await page.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
          await expect.poll(() => pixel(probe.x, probe.y)).toEqual([255, 255, 255, 255]);
          await page.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
          await expect.poll(() => pixel(probe.x, probe.y)).toEqual([255, 0, 0, 255]);
          await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
        }
        const result = await read(page),
          shapes = symbol ? result.symbols![0].shapes : result.layers[0].keys[0].shapes,
          packet = (await packets(page)).at(-1)!;
        expect(packet.brushCommit!.optimize).toBe(optimize);
        expect(geometry(shapes)).toEqual(
          geometry(commitBrushPaint(packet.shapes, packet.brushCommit!)),
        );
        const originals = overlap ? [old.contours![0][1]] : old.contours![0];
        for (const n of originals) {
          const p = mapPoint(matrix(old), n),
            retained = shapes
              .filter((s) => s.fill === old.fill)
              .flatMap((s) => s.contours!.flat().map((node) => ({ s, node })))
              .find(
                (q) =>
                  Math.hypot(
                    mapPoint(matrix(q.s), q.node).x - p.x,
                    mapPoint(matrix(q.s), q.node).y - p.y,
                  ) < 1e-8,
              );
          expect(retained).toBeDefined();
          for (const role of ['in', 'out'] as const) {
            expect(retained!.node[role]).toBeDefined();
            const a = mapPoint(matrix(old), n[role]!),
              b = mapPoint(matrix(retained!.s), retained!.node[role]!);
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-8);
          }
        }
        if (!overlap)
          expect(shapes.filter((s) => s.fill === old.fill).reduce((n, s) => n + count(s), 0)).toBe(
            4,
          );
        await page.getByLabel('Drawing stage', { exact: true }).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(() => read(page)).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(() => read(page)).toEqual(result);
        expect(errors).toEqual([]);
      });
