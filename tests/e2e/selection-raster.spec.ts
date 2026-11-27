import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { newLayer, validateProject, type Project, type SymbolDefinition } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { addDenseTimeline, denseDrawingProject } from './dense-drawing-project';
type StrokeWork = {
  tool: 'Brush' | 'Pencil';
  artwork: number;
  released: number;
  posted: number;
  completed?: number;
  published?: number;
  terminated?: boolean;
  publicationSerializations?: number;
};
async function setup(
  page: Page,
  partial = false,
  mask = false,
  offscreen = false,
  crowd = false,
  guide?: number,
  layered = false,
  prepare?: (project: Project) => void,
) {
  if (partial) await holdGeometry(page);
  if (layered) await page.addInitScript(() => {
    const workers: StrokeWork[] = [];
    let released = 0;
    let serializations = 0;
    let beforePublication = 0;
    let recoveryEncodings = 0;
    const stringify = JSON.stringify;
    JSON.stringify = function (value: unknown, ...args: unknown[]) {
      if (value && typeof value === 'object' && 'layers' in value) serializations++;
      if (value && typeof value === 'object' && 'project' in value) recoveryEncodings++;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    } as typeof JSON.stringify;
    window.addEventListener('pointerup', event => {
      if ((event.target as HTMLElement)?.id === 'drawing-stage') released = performance.now();
    }, true);
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      sample?: StrokeWork;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', () => {
          if (this.sample) {
            this.sample.completed = performance.now();
            beforePublication = serializations;
          }
        });
      }
      postMessage(message: { brushCommit?: unknown; pencil?: unknown; shapes?: unknown[] }, options: Transferable[] | StructuredSerializeOptions = []) {
        if (message.brushCommit || message.pencil) {
          this.sample = { tool: message.brushCommit ? 'Brush' : 'Pencil',
            artwork: message.shapes?.length ?? 0, released, posted: performance.now() };
          workers.push(this.sample);
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate() {
        if (this.sample) this.sample.terminated = true;
        super.terminate();
      }
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      const latest = workers.at(-1);
      if (key === 'splash-recovery-v1' && latest?.completed !== undefined && latest.published === undefined) {
        latest.published = performance.now();
        latest.publicationSerializations = serializations - beforePublication;
      }
    };
    Object.assign(window, { strokeWork: () => workers, recoveryEncodings: () => recoveryEncodings });
  });
  const p = denseDrawingProject(partial, crowd, layered);
  const ink = p.layers[0].keys[0].shapes[1];
  if (offscreen) p.layers[0].keys[0].shapes[1].x = -500;
  if (guide !== undefined) p.guides = [{ id: 'snap-guide', axis: 'x', position: guide }];
  if (partial) p.layers[0].keys[0].shapes.shift();
  if (mask) {
    const layer = structuredClone(p.layers[0]);
    layer.id = 'mask';
    layer.name = 'Mask';
    layer.keys = [
      {
        frame: 0,
        shapes: [
          {
            ...ink,
            id: 'mask-shape',
            kind: 'rectangle',
            x: 0,
            y: 0,
            width: 280,
            height: 360,
            points: [],
            fill: '#ffffff',
          },
        ],
      },
    ];
    p.layers.push(layer);
    p.layerMasks = [{ maskLayerId: 'mask', layerIds: [p.layers[0].id] }];
  }
  prepare?.(p);
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1')) localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
    let fills = 0,
      heavy = 0,
      images = 0,
      membership = 0,
      crowdBounds = 0,
      captureMs = 0,
      captureStart = 0,
      captureSerializations = 0,
      captureHeavy = 0,
      firstMove: number | undefined,
      movementToDrawMs: number | null = null;
    window.addEventListener(
      'pointerdown',
      (event) => {
        if ((event.target as HTMLElement)?.getAttribute('aria-label') === 'Drawing stage') {
          captureStart = performance.now();
          captureHeavy = heavy;
          firstMove = undefined;
          movementToDrawMs = null;
        }
      },
      true,
    );
    window.addEventListener('pointermove', event => {
      if (event.buttons === 1 && (event.target as HTMLElement)?.id === 'drawing-stage')
        firstMove ??= performance.now();
    }, true);
    window.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement)?.getAttribute('aria-label') === 'Drawing stage') {
        captureMs = performance.now() - captureStart;
        captureSerializations = heavy - captureHeavy;
      }
    });
    const includes = Array.prototype.includes,
      cos = Math.cos;
    Array.prototype.includes = function (...args: unknown[]) {
      if (this.length === 1203 && typeof this[0] === 'string') membership++;
      return Reflect.apply(includes, this, args);
    };
    Math.cos = function (angle: number) {
      if (angle === (7 * Math.PI) / 180) crowdBounds++;
      return cos(angle);
    };
    const fill = CanvasRenderingContext2D.prototype.fill,
      draw = CanvasRenderingContext2D.prototype.drawImage,
      stringify = JSON.stringify;
    CanvasRenderingContext2D.prototype.fill = function (...args: unknown[]) {
      if (args[0] instanceof Path2D) fills++;
      return Reflect.apply(fill, this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      images++;
      if (firstMove !== undefined && this.canvas.id === 'drawing-stage' && movementToDrawMs === null)
        movementToDrawMs = performance.now() - firstMove;
      return Reflect.apply(draw, this, args);
    };
    JSON.stringify = function (value: unknown, ...args: unknown[]) {
      if (
        value &&
        typeof value === 'object' &&
        ('layers' in value ||
          (Array.isArray(value) && value.some((v) => Array.isArray(v) && v.length >= 1000)))
      )
        heavy++;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    } as typeof JSON.stringify;
    Object.assign(window, {
      rasterCounts: () => ({ fills, heavy, images, membership, crowdBounds, captureMs, captureSerializations, movementToDrawMs }),
    });
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const screen = (x: number, y: number) =>
    canvas.evaluate(
      (n, { x, y, p }) => {
        const c = n as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          w = c.width / devicePixelRatio,
          h = c.height / devicePixelRatio;
        return {
          x: r.x + (((w - p.width) / 2 + x) * r.width) / w,
          y: r.y + (((h - p.height) / 2 + y) * r.height) / h,
        };
      },
      { x, y, p },
    );
  const move = async (x: number, y: number) => {
    const q = await screen(x, y);
    await page.mouse.move(q.x, q.y);
  };
  const settle = () =>
    canvas.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const counts = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          rasterCounts: () => {
            fills: number;
            heavy: number;
            images: number;
            membership: number;
            crowdBounds: number;
            captureMs: number;
            captureSerializations: number;
            movementToDrawMs: number | null;
          };
        }
      ).rasterCounts(),
    );
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n, { x, y, p }) => {
        const c = n as HTMLCanvasElement,
          d = devicePixelRatio;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - p.width / 2) * d),
              Math.round(c.height / 2 + (y - p.height / 2) * d),
              1,
              1,
            ).data,
        );
      },
      { x, y, p },
    );
  if (partial) {
    await move(20, 20);
    await page.mouse.down();
    await move(180, 200);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
    await releaseGeometry(page);
    await expect(
      page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
    ).toBeVisible();
  } else {
    await move(120, 125);
    await page.mouse.click((await screen(120, 125)).x, (await screen(120, 125)).y);
  }
  return { p, canvas, screen, move, read, counts, settle, pixel };
}
for (const operation of ['move', 'scale', 'rotate', 'skew'] as const)
  test(`dense ordinary ${operation} reuses raster paths and keeps the vector source untouched until release`, async ({
    page,
  }) => {
    const f = await setup(page);
    const start =
      operation === 'move'
        ? { x: 120, y: 125 }
        : operation === 'scale'
          ? { x: 240, y: 210 }
          : operation === 'rotate'
            ? { x: 252, y: 58 }
            : { x: 120, y: 70 };
    await f.move(start.x, start.y);
    await page.mouse.down();
    await f.move(start.x + 12, start.y + 12);
    await f.settle();
    const a = await f.counts();
    for (let i = 1; i <= 12; i++) await f.move(start.x + 12 + i, start.y + 12 + i);
    await f.settle();
    const b = await f.counts();
    expect(b.fills).toBe(a.fills);
    expect(b.heavy).toBe(a.heavy);
    expect(b.images).toBeGreaterThan(a.images);
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    await expect.poll(f.read).not.toEqual(f.p);
    const q = await f.read(),
      changed = q.layers[0].keys[0].shapes.find((s) => s.id === 'dense')!;
    expect(changed.points).toEqual(f.p.layers[0].keys[0].shapes[1].points);
    expect(q.layers[0].keys[0].shapes.filter((s) => s.id !== 'dense')).toEqual(
      f.p.layers[0].keys[0].shapes.filter((s) => s.id !== 'dense'),
    );
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });
for (const operation of ['move', 'scale', 'move at a tween key'] as const)
  test(`masked movie clip ${operation} reuses its raster and retains authored symbol data`, async ({ page }) => {
    const f = await setup(page, false, false, false, false, undefined, false, project => {
      project.schemaVersion = 60;
      const base = {
        id: 'paint', kind: 'rectangle' as const, x: 0, y: 0, width: 160, height: 140,
        rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
      };
      const dense = Array.from({ length: 180 }, (_, i) => ({
        ...base, id: 'detail-'+i, x: i % 18 * 5, y: Math.floor(i / 18)*4,
        width: 3, height: 3, fill: '#ff9000',
      }));
      const mask = newLayer('Clip mask');
      mask.keys[0].shapes = [{ ...base, id: 'clip', width: 100, fill: '#ffffff' }];
      const definition: SymbolDefinition = {
        id: 'cached-movie', name: 'Cached movie', width: 160, height: 140,
        shapes: [{ ...base, fill: '#0000ff' }, ...dense],
        timeline: { duration: 2, keys: [{ frame: 1, shapes: [base, ...dense] }],
          layers: [mask], layerMasks: [{ maskLayerId: mask.id, layerIds: ['@base'] }] },
      };
      project.symbols = [definition];
      project.layers[0].keys[0].shapes = [{
        ...symbolInstance(definition, 80, 70), id: 'moving-movie',
        symbolPlayback: { mode: 'movie', firstFrame: 1 },
        instanceTint: { color: '#00ff00', amount: 1 },
      }];
      if (operation === 'move at a tween key') {
        const track = project.layers[0];
        track.keys.push({ frame: 8, shapes: [{ ...track.keys[0].shapes[0], x: 104 }] });
        track.liveMotionSpans = [{
          id: 'movie-tween', start: 0, end: 8, ease: 'linear', symbolContinuity: 'movies',
        }];
      }
      validateProject(project);
    });
    expect(await f.pixel(120, 125)).toEqual([0, 255, 0, 255]);
    expect(await f.pixel(205, 125)).toEqual([255, 255, 255, 255]);
    const start = operation === 'scale' ? { x: 240, y: 210 } : { x: 120, y: 125 };
    await f.move(start.x, start.y);
    await page.mouse.down();
    await f.move(start.x + 12, start.y + 12);
    await f.settle();
    const first = await f.counts();
    for (let i = 1; i <= 12; i++) await f.move(start.x + 12 + i, start.y + 12 + i);
    await f.settle();
    const last = await f.counts();
    expect(last.fills).toBe(first.fills);
    expect(last.images).toBeGreaterThan(first.images);
    expect(await f.read()).toEqual(f.p);
    expect(await f.pixel(154, 148)).toEqual([0, 255, 0, 255]);
    await page.mouse.up();
    await expect.poll(f.read).not.toEqual(f.p);
    const result = await f.read();
    expect(result.symbols).toEqual(f.p.symbols);
    expect(result.layers[0].keys.slice(1)).toEqual(f.p.layers[0].keys.slice(1));
    expect(result.layers[0].liveMotionSpans).toEqual(f.p.layers[0].liveMotionSpans);
    expect(result.layers[0].keys[0].shapes[0]).toMatchObject({
      id: 'moving-movie', kind: 'symbol', symbolId: 'cached-movie',
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    });
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(result);
  });

for (const operation of ['move', 'scale'])
  test(`partial dense paint ${operation} reuses a raster before clipping finishes and through held release`, async ({
    page,
  }) => {
    const f = await setup(page, true);
    const scaling = operation === 'scale';
    await f.move(scaling ? 180 : 125, scaling ? 200 : 120);
    await page.mouse.down();
    await f.move(scaling ? 260 : 225, scaling ? 240 : 120);
    await f.settle();
    const a = await f.counts();
    for (let i = 1; i <= 12; i++) await f.move((scaling ? 260 : 225) + i, scaling ? 240 + i : 120);
    await f.settle();
    const b = await f.counts();
    expect(b.fills).toBe(a.fills);
    expect(b.heavy).toBe(a.heavy);
    expect(b.images).toBeGreaterThan(a.images);
    expect(await f.read()).toEqual(f.p);
    expect(await pendingGeometry(page)).toBe(0);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await f.settle();
    expect(await f.read()).toEqual(f.p);
    await expect.poll(() => f.pixel(250, scaling ? 150 : 130)).toEqual([255, 0, 0, 255]);
    await expect
      .poll(
        async () => {
          await releaseGeometry(page);
          return JSON.stringify(await f.read()) !== JSON.stringify(f.p);
        },
        { timeout: 10000 },
      )
      .toBe(true);
  });
test('raster dragging preserves front/back order and a fixed layer mask', async ({ page }) => {
  const f = await setup(page, false, true);
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(160, 125);
  await f.settle();
  await expect.poll(() => f.pixel(200, 110)).toEqual([0, 255, 0, 255]);
  await expect.poll(() => f.pixel(250, 130)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(290, 130)).toEqual([255, 255, 255, 255]);
  await page.mouse.up();
  const q = await f.read();
  expect(q.layerMasks).toEqual(f.p.layerMasks);
  expect(q.layers[1]).toEqual(f.p.layers[1]);
});
for (const cancel of ['Escape', 'capture', 'zoom'] as const)
  test(`cached object movement cancels on ${cancel} without losing the selection`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.move(120, 125);
    await page.mouse.down();
    await f.move(180, 125);
    await f.settle();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'capture')
      await f.canvas.evaluate((n) => (n as HTMLElement).releasePointerCapture(1));
    else await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
    await page.mouse.up();
    expect(await f.read()).toEqual(f.p);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  });

test('an unsupported affine deferred release rejects before publication and a fresh drag still succeeds', async ({
  page,
}) => {
  const f = await setup(page),
    start = await f.screen(240, 210);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const event = {
    pointerId: 1,
    buttons: 1,
    button: 0,
    clientX: start.x + 20000001,
    clientY: start.y,
  };
  await f.canvas.dispatchEvent('pointermove', event);
  expect(await f.read()).toEqual(f.p);
  await f.canvas.dispatchEvent('pointerup', event);
  await page.mouse.up();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(150, 125);
  await page.mouse.up();
  await expect.poll(f.read).not.toEqual(f.p);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('moving a selection brings originally off-viewport paint into view without clipping the cached source', async ({
  page,
}) => {
  const f = await setup(page, false, false, true);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(620, 125);
  await f.settle();
  await expect.poll(() => f.pixel(80, 130)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await expect.poll(f.read).not.toEqual(f.p);
  const q = await f.read();
  expect(q.layers[0].keys[0].shapes[1].x).toBe(0);
  expect(q.layers[0].keys[0].shapes[1].points).toEqual(f.p.layers[0].keys[0].shapes[1].points);
});

test('many-object cached dragging avoids repeated ID searches and inactive snapping bounds', async ({
  page,
}) => {
  const f = await setup(page, false, false, false, true);
  expect(await f.pixel(250, 162)).toEqual([0, 0, 255, 255]);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(132, 137);
  await f.settle();
  const a = await f.counts();
  for (let i = 1; i <= 10; i++) await f.move(132 + i, 137 + i);
  await f.settle();
  const b = await f.counts();
  console.info('many-object drag counters', JSON.stringify({ before: a, after: b }));
  expect(a.membership).toBeGreaterThan(0);
  expect(a.crowdBounds).toBeGreaterThan(0);
  expect(b.membership).toBe(a.membership);
  expect(b.crowdBounds).toBe(a.crowdBounds);
  await expect.poll(() => f.pixel(250, 162)).toEqual([255, 0, 0, 255]);
  expect(b.fills).toBe(a.fills);
  expect(b.images).toBeGreaterThan(a.images);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  const q = await f.read();
  expect(q.layers[0].keys[0].shapes).toHaveLength(1203);
  for (let i = 0; i < 1203; i++) {
    const original = f.p.layers[0].keys[0].shapes[i];
    expect(q.layers[0].keys[0].shapes[i]).toEqual({
      ...original,
      x: original.x + 22,
      y: original.y + 22,
    });
  }
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
});

test('repeated dense layered selection drags preserve every pose and Undo', async ({ page }) => {
  const f = await setup(page, false, false, false, true, undefined, true);
  const trace = process.env.SPLASH_DENSE_DRAG_PROFILE;
  const profiler = trace ? await page.context().newCDPSession(page) : undefined;
  await profiler?.send('Profiler.enable');
  const samples: { capture: number; firstVisible: number; drawSubmission: number | null; release: number; captureSerializations: number; releaseSerializations: number }[] = [];
  const initial = f.p.layers[0].keys[0].shapes[1];
  for (let index = 0; index < 6; index++) {
    const delta = index % 2 === 0 ? 32 : -32;
    await f.move(delta > 0 ? 120 : 152, 125);
    if (!index) await profiler?.send('Profiler.start');
    await page.mouse.down();
    const first = performance.now();
    await f.move(delta > 0 ? 152 : 120, 125);
    await expect.poll(() => f.pixel(delta > 0 ? 250 : 95, 140)).toEqual([255, 0, 0, 255]);
    const firstVisible = performance.now() - first;
    if (!index && profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await writeFile(`${trace}-movement.cpuprofile`, JSON.stringify(profile));
      await profiler.send('Profiler.start');
    }
    const beforeRelease = await f.counts();
    expect(beforeRelease.movementToDrawMs).not.toBeNull();
    const release = performance.now();
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[1].x)
      .toBe(initial.x + (delta > 0 ? delta : 0));
    if (!index && profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await writeFile(`${trace}-release.cpuprofile`, JSON.stringify(profile));
      await profiler.detach();
    }
    const afterRelease = await f.counts();
    samples.push({
      capture: beforeRelease.captureMs,
      firstVisible,
      drawSubmission: beforeRelease.movementToDrawMs,
      release: performance.now() - release,
      captureSerializations: beforeRelease.captureSerializations,
      releaseSerializations: afterRelease.heavy - beforeRelease.heavy,
    });
    const exact = structuredClone(f.p);
    exact.layers[0].keys[0].shapes[1].x += delta > 0 ? delta : 0;
    expect(await f.read()).toEqual(exact);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .toBe(JSON.stringify({ project: exact, folder: null, manifest: null }));
  }
  console.info('repeated dense drag observations', JSON.stringify(samples));
  expect(samples.map(sample => sample.captureSerializations)).toEqual(Array(6).fill(0));
  expect(Math.max(...samples.map(sample => sample.releaseSerializations))).toBeLessThan(6);
  await f.canvas.press('Control+z');
  const prior = structuredClone(f.p);
  prior.layers[0].keys[0].shapes[1].x += 32;
  await expect.poll(f.read).toEqual(prior);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('layered Brush and Pencil strokes finish without copying unrelated artwork to workers', async ({ page }) => {
  const f = await setup(page, false, false, false, true, undefined, true);
  const work = () => page.evaluate(() =>
    (window as unknown as { strokeWork: () => StrokeWork[] }).strokeWork(),
  );
  const tools = ['Brush', 'Pencil', 'Brush', 'Pencil'] as const;
  const original = f.p.layers[0].keys[0].shapes;
  const originalIds = new Set(original.map(shape => shape.id));
  const recolor = async (label: string, color: string) => page.getByLabel(label, { exact: true }).fill(color);
  await recolor('Drawing fill', '#ff8800');
  await recolor('Drawing stroke', '#008800');
  for (const [index, tool] of tools.entries()) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    if (tool === 'Brush') {
      await page.getByLabel('Separate brush objects', { exact: true }).check();
      await page.getByLabel('Brush size', { exact: true }).fill('12');
      if (index === 2) await page.getByLabel('Brush paint mode', { exact: true }).selectOption('behind');
    } else await page.getByLabel('Separate Pencil objects', { exact: true }).check();
    const y = 280 + index * 19;
    await f.move(270, y);
    await page.mouse.down();
    for (let x = 280; x <= 330; x += 10) await f.move(x, y);
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length)
      .toBe(original.length + index + 1);
    const published = await f.read();
    const artwork = published.layers[0].keys[0].shapes;
    expect(artwork.filter(shape => originalIds.has(shape.id))).toEqual(original);
    if (index >= 2) expect(artwork[0]).toMatchObject({ kind: 'brush', fill: '#ff8800' });
    if (tool === 'Pencil') expect(artwork.at(-1)).toMatchObject({ kind: 'bezier', stroke: '#008800' });
    expect(published.layers[1]).toEqual(f.p.layers[1]);
    await expect.poll(() => f.pixel(300, y), { message: `${tool} stroke ${index + 1} reaches the stage after publication` })
      .not.toEqual([255, 255, 255, 255]);
    const sample = (await work()).at(-1)!;
    expect(sample.tool).toBe(tool);
    expect(sample.terminated).toBe(true);
    expect(sample.published).toBeGreaterThanOrEqual(sample.completed!);
  }
  const samples = await work();
  expect(samples.map(sample => sample.tool)).toEqual(tools);
  console.info('dense stroke observations', JSON.stringify(samples.map(sample => ({
    tool: sample.tool, artwork: sample.artwork, request: sample.posted - sample.released,
    worker: sample.completed! - sample.posted, publication: sample.published! - sample.completed!,
  }))));
  expect(samples.map(sample => sample.artwork)).toEqual([0, 0, 0, 0]);
  for (let index = 0; index < tools.length; index++) {
    await f.canvas.press('Control+z');
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length)
      .toBe(original.length + tools.length - index - 1);
  }
  expect(await f.read()).toEqual(f.p);
});

test('dense drawing bursts publish independently and release each worker', async ({ page }) => {
  test.setTimeout(90_000);
  const f = await setup(page, false, false, false, true, undefined, true);
  const work = () => page.evaluate(() =>
    (window as unknown as { strokeWork: () => StrokeWork[] }).strokeWork(),
  );
  const original = f.p.layers[0].keys[0].shapes;
  const session = await page.context().newCDPSession(page);
  const heap: number[] = [];
  const sampleHeap = async () => {
    await f.settle();
    await session.send('HeapProfiler.collectGarbage');
    heap.push((await session.send('Runtime.getHeapUsage')).usedSize);
  };
  await sampleHeap();
  for (const [batch, tool] of (['Brush', 'Pencil', 'Brush'] as const).entries()) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    const objects = tool === 'Brush' ? 'Separate brush objects' : 'Separate Pencil objects';
    await page.getByLabel(objects, { exact: true }).check();
    const marks = await Promise.all([0, 1, 2, 3].map(index => f.screen(270, 278 + batch * 24 + index * 5)));
    for (const mark of marks) {
      await page.mouse.move(mark.x, mark.y);
      await page.mouse.down();
      await page.mouse.move(mark.x + 48, mark.y, { steps: 2 });
      await page.mouse.up();
    }
    await expect.poll(async () => (await work()).filter(sample => sample.published !== undefined).length,
      { timeout: 20000 }).toBe((batch + 1) * 4);
    const saved = await f.read();
    expect(saved.layers[0].keys[0].shapes).toHaveLength(original.length + (batch + 1) * 4);
    expect(saved.layers[0].keys[0].shapes.slice(0, original.length)).toEqual(original);
    expect(saved.layers[1]).toEqual(f.p.layers[1]);
    await sampleHeap();
  }
  const samples = await work();
  expect(samples).toHaveLength(12);
  expect(samples.every(sample => sample.terminated)).toBe(true);
  expect(samples.slice(1).every((sample, index) => sample.posted >= samples[index].published!)).toBe(true);
  console.info('dense burst observations', JSON.stringify({ heap, strokes: samples.map(sample => ({
    tool: sample.tool, work: sample.publicationSerializations, publicationMs: sample.published! - sample.completed!,
  })) }));
  expect(samples.map(sample => sample.publicationSerializations)).toEqual(
    ['Brush', 'Pencil', 'Brush'].flatMap(tool => Array(4).fill(tool === 'Brush' ? 2 : 3)),
  );
  const published = await f.read();
  for (let index = 0; index < samples.length; index++) {
    await f.canvas.press('Control+z');
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length)
      .toBe(original.length + samples.length - index - 1);
  }
  expect(await f.read()).toEqual(f.p);
  for (let index = 0; index < samples.length; index++) await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(published);
  await session.detach();
});

test('sustained mixed editing keeps dense nested playback, history and recovery intact', async ({ page }) => {
  test.skip(!process.env.SPLASH_STRESS, 'Run the two-minute session with SPLASH_STRESS=1.');
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const f = await setup(page, false, false, false, true, undefined, true, addDenseTimeline);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const count = (offset: number) => f.canvas.evaluate((_, expected) => {
    const { project } = JSON.parse(localStorage.getItem('splash-recovery-v1')!) as { project: Project };
    return project.layers[0].keys[0].shapes.length === expected;
  }, f.p.layers[0].keys[0].shapes.length + offset);
  const work = () => page.evaluate(() =>
    (window as unknown as { strokeWork: () => StrokeWork[] }).strokeWork());
  const recoveryEncodings = () => page.evaluate(() =>
    (window as unknown as { recoveryEncodings: () => number }).recoveryEncodings());
  const observer = await page.context().newCDPSession(page);
  const heap: { usedSize: number; totalSize: number; backingStorageSize?: number }[] = [];
  const releases: number[] = [];
  const playback: number[] = [];
  const historyEncodings: number[] = [];
  async function sampleHeap() {
    await f.settle();
    await observer.send('HeapProfiler.collectGarbage');
    heap.push(await observer.send('Runtime.getHeapUsage'));
  }
  await sampleHeap();
  const started = performance.now();
  const versions = [f.p];
  let final = f.p;
  for (let cycle = 0; cycle < 6; cycle++) {
    const began = performance.now();
    await f.canvas.press('Enter');
    await expect(timeline).toHaveAccessibleDescription(/Frame 4\d\d of 480/, { timeout: 25_000 });
    await expect(timeline).toHaveAccessibleDescription(/Frame [1-9]\d? of 480/, { timeout: 12_000 });
    await f.canvas.press('Enter');
    playback.push(performance.now() - began);
    await timeline.press('Home');
    for (const [index, tool] of (['Brush', 'Pencil'] as const).entries()) {
      await page.getByRole('button', { name: tool, exact: true }).click();
      await page.getByLabel(tool === 'Brush' ? 'Separate brush objects' : 'Separate Pencil objects',
        { exact: true }).check();
      const y = 280 + cycle * 11 + index * 5;
      await f.move(275, y);
      await page.mouse.down();
      await f.move(325, y);
      await page.mouse.up();
      await expect.poll(() => count(cycle * 2 + index + 1)).toBe(true);
      versions.push(await f.read());
    }
    const beforeMove = await f.read();
    const ink = beforeMove.layers[0].keys[0].shapes[1];
    const delta = cycle % 2 ? -20 : 20;
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await f.move(ink.x + 42, 125);
    await page.mouse.down();
    await f.move(ink.x + 42 + delta, 125);
    await f.settle();
    const release = performance.now();
    await page.mouse.up();
    const expected = structuredClone(beforeMove);
    expected.layers[0].keys[0].shapes[1].x += delta;
    versions.push(expected);
    await expect.poll(f.read).toEqual(expected);
    releases.push(performance.now() - release);
    const recoveryBeforeHistory = await recoveryEncodings();
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(beforeMove);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected);
    historyEncodings.push(await recoveryEncodings() - recoveryBeforeHistory);
    final = expected;
    if (cycle % 2 === 1) await sampleHeap();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Older Undo history was trimmed.' })).toBeVisible();
  const strokes = await work();
  expect(strokes).toHaveLength(12);
  expect(strokes.every(sample => sample.terminated && sample.published !== undefined)).toBe(true);
  expect(strokes.slice(1).every((sample, index) => sample.posted >= strokes[index].published!)).toBe(true);
  expect(final.layers.slice(1)).toEqual(f.p.layers.slice(1));
  expect(final.symbols).toEqual(f.p.symbols);
  const raw = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  expect(raw).toBe(JSON.stringify({ project: final, folder: null, manifest: null }));
  let oldest = versions.length - 1;
  while (oldest > 0) {
    await f.canvas.press('Control+z');
    const version = JSON.stringify(await f.read());
    if (version === JSON.stringify(versions[oldest])) break;
    expect(version === JSON.stringify(versions[--oldest])).toBe(true);
  }
  const retainedUndoSteps = versions.length - 1 - oldest;
  expect(retainedUndoSteps).toBeGreaterThan(0);
  expect(oldest).toBeGreaterThan(0);
  for (let index = oldest + 1; index < versions.length; index++) {
    await f.canvas.press('Control+Shift+z');
    expect(JSON.stringify(await f.read()) === JSON.stringify(versions[index])).toBe(true);
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(raw);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(final);
  console.info('mixed dense session observations', JSON.stringify({
    elapsed: performance.now() - started, playback, releases, heap, historyEncodings, retainedUndoSteps,
    recoveryBytes: Buffer.byteLength(raw!),
    strokes: strokes.map(sample => ({ work: sample.publicationSerializations, publicationMs: sample.published! - sample.completed! })),
  }));
  expect(historyEncodings).toEqual(Array(6).fill(0));
  expect(pageErrors).toEqual([]);
  await observer.detach();
});

for (const mode of ['guide', 'object', 'grid', 'bypass'] as const)
  test(`cached drag retains ${mode} snapping and complete history`, async ({ page }) => {
    const f = await setup(page, false, false, false, false, mode === 'guide' ? 260 : undefined);
    if (mode !== 'guide') {
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await page
        .getByRole('button', {
          name: mode === 'object' ? 'Snap to objects' : 'Snap to grid',
          exact: true,
        })
        .click();
      await page.getByRole('button', { name: 'View', exact: true }).click();
    }
    await f.move(120, 125);
    await page.mouse.down();
    if (mode === 'bypass') await page.keyboard.down('Alt');
    const dx = mode === 'object' ? 58 : mode === 'guide' ? 19 : 17;
    const dy = mode === 'grid' || mode === 'bypass' ? 13 : 0;
    await f.move(120 + dx, 125 + dy);
    await f.settle();
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    if (mode === 'bypass') await page.keyboard.up('Alt');
    const q = await f.read(),
      expected = structuredClone(f.p);
    expected.layers[0].keys[0].shapes[1].x += mode === 'object' ? 60 : mode === 'bypass' ? 17 : 20;
    expected.layers[0].keys[0].shapes[1].y += mode === 'grid' ? 10 : mode === 'bypass' ? 13 : 0;
    expect(q).toEqual(expected);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });

for (const mode of ['objects', 'grid'] as const)
  test(`many-object ${mode} snapping reuses original geometry during native dragging`, async ({
    page,
  }) => {
    const f = await setup(page, false, false, false, true);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page
      .getByRole('button', {
        name: mode === 'objects' ? 'Snap to objects' : 'Snap to grid',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await f.canvas.focus();
    await page.keyboard.press('Control+a');
    await f.move(120, 125);
    await page.mouse.down();
    await f.move(130, 135);
    await f.settle();
    await expect.poll(() => f.pixel(246, 150)).toEqual([255, 0, 0, 255]);
    const a = await f.counts();
    for (let i = 1; i <= 10; i++) await f.move(130 + i, 135 + i);
    await f.settle();
    const b = await f.counts();
    console.info('active-snap drag counters', mode, JSON.stringify({ before: a, after: b }));
    expect(a.membership).toBeGreaterThan(0);
    expect(a.crowdBounds).toBeGreaterThan(0);
    expect(b.membership).toBe(a.membership);
    expect(b.crowdBounds).toBe(a.crowdBounds);
    expect(b.fills).toBe(a.fills);
    await expect.poll(() => f.pixel(250, 162)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    const q = await f.read();
    for (let i = 0; i < 1203; i++) {
      const original = f.p.layers[0].keys[0].shapes[i];
      expect(q.layers[0].keys[0].shapes[i]).toEqual({
        ...original,
        x: original.x + 20,
        y: original.y + 20,
      });
    }
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });

test('cached object snapping does not reevaluate unselected dense targets', async ({ page }) => {
  const f = await setup(page, false, false, false, true);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(132, 137);
  await f.settle();
  const a = await f.counts();
  for (let i = 1; i <= 10; i++) await f.move(132 + i, 137 + i);
  await f.settle();
  const b = await f.counts();
  console.info('unselected snap target counters', JSON.stringify({ before: a, after: b }));
  expect(a.crowdBounds).toBeGreaterThan(0);
  expect(b.crowdBounds).toBe(a.crowdBounds);
  await expect.poll(() => f.pixel(250, 162)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  const expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes[1].x += 22;
  expected.layers[0].keys[0].shapes[1].y += 22;
  await expect.poll(f.read).toEqual(expected);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const setting of ['guide visibility', 'grid width'] as const)
  test(`cached geometry keeps live ${setting} authoritative`, async ({ page }) => {
    const f = await setup(
      page,
      false,
      false,
      false,
      false,
      setting === 'guide visibility' ? 260 : undefined,
    );
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
    if (setting === 'grid width')
      await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await f.move(120, 125);
    await page.mouse.down();
    await f.move(132, 125);
    await f.settle();
    await page.getByRole('button', { name: 'View', exact: true }).dispatchEvent('click');
    if (setting === 'guide visibility')
      await page.getByRole('button', { name: 'Show guides', exact: true }).dispatchEvent('click');
    else {
      const width = page.getByRole('spinbutton', { name: 'Grid width', exact: true });
      await width.fill('17');
      await width.dispatchEvent('change');
    }
    await page.getByRole('button', { name: 'View', exact: true }).dispatchEvent('click');
    expect(await f.canvas.evaluate((n) => (n as HTMLElement).hasPointerCapture(1))).toBe(true);
    await f.move(139, 125);
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    const expected = structuredClone(f.p);
    expected.layers[0].keys[0].shapes[1].x += setting === 'guide visibility' ? 19 : 22;
    await expect.poll(f.read).toEqual(expected);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('a view change retires snap geometry and a fresh original capture retries', async ({
  page,
}) => {
  const f = await setup(page, false, false, false, true);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(132, 137);
  await f.settle();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  expect(await f.canvas.evaluate((n) => (n as HTMLElement).hasPointerCapture(1))).toBe(false);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(150, 125);
  await page.mouse.up();
  const expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes[1].x += 30;
  await expect.poll(f.read).toEqual(expected);
});

test('a fresh drag snaps to edited source artwork instead of retired targets', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await f.move(120, 125);
  await page.mouse.down();
  await f.move(132, 125);
  await f.settle();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  const front = await f.screen(205, 110);
  await page.mouse.click(front.x, front.y);
  const x = page.getByRole('spinbutton', { name: 'Shape X', exact: true });
  await x.fill('400');
  await x.press('Tab');
  const edited = structuredClone(f.p);
  edited.layers[0].keys[0].shapes[2].x = 400;
  await expect.poll(f.read).toEqual(edited);
  const start = await f.screen(120, 125);
  await page.mouse.click(start.x, start.y);
  await page.mouse.down();
  await f.move(278, 125);
  await page.mouse.up();
  const expected = structuredClone(edited);
  expected.layers[0].keys[0].shapes[1].x += 160;
  await expect.poll(f.read).toEqual(expected);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(edited);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const fail of [false,true])
  test(`a dense paint selection accepts another drag during the pending drop (failure=${fail})`, async ({page}) => {
    const f=await setup(page,true);
    await f.move(125,120); await page.mouse.down();
    await f.move(225,120); await page.mouse.up();
    const overlay=page.getByRole('button',{name:'Drag pending paint selection'});
    await expect(overlay).toBeVisible();
    await f.move(225,120); await page.mouse.down();
    await f.move(325,120);
    await expect.poll(()=>f.pixel(325,120)).toEqual([255,0,0,255]);
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    if(fail){
      await releaseGeometry(page,true);
      await expect(overlay).toHaveCount(0);
      expect(await f.read()).toEqual(f.p);
      await expect.poll(()=>f.pixel(125,120)).toEqual([255,0,0,255]);
      return;
    }
    await f.move(325,120); await page.mouse.down();
    await f.move(405,120); await page.mouse.up();
    await expect.poll(()=>f.pixel(405,120)).toEqual([255,0,0,255]);
    expect(await f.read()).toEqual(f.p);
    await expect.poll(async()=>{
      await releaseGeometry(page);
      return overlay.count();
    },{timeout:15000}).toBe(0);
    await expect.poll(()=>f.pixel(405,120)).toEqual([255,0,0,255]);
    await f.canvas.press('Control+z');
    await expect.poll(()=>f.pixel(325,120)).toEqual([255,0,0,255]);
    await f.canvas.press('Control+z');
    await expect.poll(()=>f.pixel(225,120)).toEqual([255,0,0,255]);
    expect(await f.read()).not.toEqual(f.p);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('Escape cancels only the held re-grab when its preceding paint drop finishes',async({page})=>{
  const f=await setup(page,true);
  await f.move(125,120); await page.mouse.down();
  await f.move(225,120); await page.mouse.up();
  const overlay=page.getByRole('button',{name:'Drag pending paint selection'});
  await expect(overlay).toBeVisible();
  await f.move(225,120); await page.mouse.down();
  await f.move(325,120);
  await expect.poll(()=>f.pixel(325,120)).toEqual([255,0,0,255]);
  // Deliver the source split while the second pointer is held.
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async()=>{await releaseGeometry(page);return overlay.count();}).toBe(0);
  await expect.poll(()=>f.pixel(250,130)).toEqual([255,0,0,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a scaled paint selection can be grabbed at its new edge before the drop finishes', async ({page}) => {
  const f = await setup(page, true);
  await f.move(180, 200);
  await page.mouse.down();
  await f.move(272, 252);
  await page.mouse.up();
  const overlay = page.getByRole('button', {name: 'Drag pending paint selection'});
  await expect(overlay).toBeVisible();
  await expect.poll(() => f.pixel(250, 150)).toEqual([255, 0, 0, 255]);
  expect(await pendingGeometry(page)).toBe(1);
  await f.move(250, 150);
  await page.mouse.down();
  await f.move(400, 150);
  await expect.poll(() => f.pixel(400, 150)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await expect.poll(async () => { await releaseGeometry(page); return overlay.count(); }, {timeout: 15000}).toBe(0);
  await expect.poll(() => f.pixel(400, 150)).toEqual([255, 0, 0, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(() => f.pixel(250, 150)).toEqual([255, 0, 0, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a pending drop can be grabbed again after the canvas layout moves', async ({page}) => {
  const f = await setup(page, true);
  await f.move(125, 120);
  await page.mouse.down();
  await f.move(225, 120);
  await page.mouse.up();
  const overlay = page.getByRole('button', {name: 'Drag pending paint selection'});
  await expect(overlay).toBeVisible();
  await f.canvas.evaluate(canvas => { canvas.style.transform = 'translateX(16px)'; });
  await f.move(225, 120);
  await page.mouse.down();
  await f.move(345, 120);
  await expect.poll(() => f.pixel(345, 120)).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect.poll(async () => { await releaseGeometry(page); return overlay.count(); }, {timeout: 15000}).toBe(0);
  await expect.poll(() => f.pixel(345, 120)).toEqual([255, 0, 0, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(() => f.pixel(225, 120)).toEqual([255, 0, 0, 255]);
});
