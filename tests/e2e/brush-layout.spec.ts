import { expect, test } from '@playwright/test';
import { newProject, type Vector } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { symbolInstance } from '../../packages/geometry/src/symbols';

test('Brush starts a worker before release and discards an unused worker on cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    const records: { requests: number; terminated: boolean }[] = [];
    Object.assign(window, { brushWorkers: records });
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      private record?: (typeof records)[number];

      constructor(input: string | URL, options?: WorkerOptions) {
        super(input, options);
        if (/\/worker(?:-|\.ts)/.test(String(input))) {
          this.record = { requests: 0, terminated: false };
          records.push(this.record);
        }
      }

      override postMessage(message: unknown) {
        if (this.record) this.record.requests++;
        super.postMessage(message);
      }

      override terminate() {
        if (this.record) this.record.terminated = true;
        super.terminate();
      }
    };
  });
  await page.goto('/');
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const brush = page.getByRole('button', { name: 'Brush', exact: true });
  await expect(launch.or(brush).first()).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await brush.click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const records = () => page.evaluate(() =>
    (window as unknown as { brushWorkers: { requests: number; terminated: boolean }[] }).brushWorkers);
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const original = await recovery();
  await stage.evaluate(canvas => {
    canvas.addEventListener('pointerdown', event => {
      canvas.dataset.brushPointer = String((event as PointerEvent).pointerId);
    }, { once: true });
  });
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(records).toEqual([{ requests: 0, terminated: false }]);
  await stage.evaluate(canvas => canvas.dispatchEvent(new PointerEvent('pointercancel', {
    bubbles: true, pointerId: Number(canvas.dataset.brushPointer), pointerType: 'mouse',
  })));
  await page.mouse.up();
  await expect.poll(records).toEqual([{ requests: 0, terminated: true }]);
  expect(await recovery()).toBe(original);

  await page.mouse.down();
  await expect.poll(records).toEqual([
    { requests: 0, terminated: true },
    { requests: 0, terminated: false },
  ]);
  await page.mouse.move(box.x + box.width / 2 + 85, box.y + box.height / 2 + 12, { steps: 8 });
  await page.mouse.up();
  await expect.poll(records).toEqual([
    { requests: 0, terminated: true },
    { requests: 1, terminated: true },
  ]);
  await expect.poll(recovery).not.toBe(original);
});

for (const editor of ['main', 'symbol'] as const)
  for (const shift of [false, true])
    test(`coalesced Brush layout is constant per delivery in ${editor}, Shift ${shift}`, async ({
      page,
    }) => {
      await holdGeometry(page);
      await page.addInitScript(() => {
        const state = {
          active: false,
          reads: 0,
          request: null as { brushCommit: { brush: Vector } } | null,
        };
        Object.assign(window, { brushLayout: state });
        const bounds = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
          if (state.active && this instanceof HTMLCanvasElement) state.reads++;
          return bounds.call(this);
        };
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message: unknown) {
          if ((message as { brushCommit?: unknown }).brushCommit)
            state.request = structuredClone(message) as typeof state.request;
          post.call(this, message);
        };
      });
      if (editor === 'symbol') {
        const project = newProject();
        project.symbols = [
          {
            id: 'layout',
            name: 'Layout',
            width: 100,
            height: 100,
            shapes: [
              {
                id: 'base',
                kind: 'rectangle',
                x: 1,
                y: 1,
                width: 2,
                height: 2,
                rotation: 0,
                fill: '#000000',
                stroke: '#000000',
                strokeWidth: 0,
                points: [],
              },
            ],
          },
        ];
        await page.addInitScript(
          (project) =>
            localStorage.setItem(
              'splash-recovery-v1',
              JSON.stringify({ project, folder: null, manifest: null }),
            ),
          project,
        );
      }
      await page.goto('/');
      if (editor === 'symbol') {
        await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
        await page
          .getByRole('group', { name: 'Symbol Layout', exact: true })
          .getByRole('button', { name: 'Edit symbol artwork', exact: true })
          .click();
        await page.getByLabel('Symbol canvas tool').selectOption('brush');
        await page.getByLabel('Smooth symbol brush', { exact: true }).uncheck();
        await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
      } else {
        await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
        await page.getByRole('button', { name: 'Brush', exact: true }).click();
        await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
        await page.getByLabel('Separate brush objects', { exact: true }).check();
      }
      const canvas = page.getByLabel(
        editor === 'main' ? 'Drawing stage' : 'Symbol artwork preview',
      );
      if (editor === 'symbol')
        await canvas.evaluate((c) => {
          (c as HTMLElement).style.transform = 'scale(.8,.7)';
        });
      await canvas.scrollIntoViewIfNeeded();
      await canvas.evaluate((c) =>
        c.addEventListener(
          'pointerdown',
          (e) => {
            (c as HTMLElement).dataset.layoutPointer = String((e as PointerEvent).pointerId);
            (c as HTMLElement).dataset.layoutStartX = String((e as PointerEvent).clientX);
            (c as HTMLElement).dataset.layoutStartY = String((e as PointerEvent).clientY);
          },
          { once: true },
        ),
      );
      const box = (await canvas.boundingBox())!;
      const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const contact = await canvas.evaluate((c) => ({
        x: Number((c as HTMLElement).dataset.layoutStartX),
        y: Number((c as HTMLElement).dataset.layoutStartY),
      }));
      const result = await canvas.evaluate(
        async (c, { start, shift, editor }) => {
          const state = (window as unknown as { brushLayout: { active: boolean; reads: number } })
            .brushLayout;
          const originalRect = c.getBoundingClientRect(),
            pointerId = Number((c as HTMLElement).dataset.layoutPointer);
          const expected: {
            x: number;
            y: number;
            pressure: number;
            tiltX: number;
            tiltY: number;
            twist: number;
          }[] = [];
          const reads: number[] = [];
          let last!: PointerEvent;
          for (let burst = 0; burst < 30; burst++) {
            // A new delivery must refresh layout, rather than freezing it for
            // the whole stroke. Keep the symbol's independent CSS scaling.
            (c as HTMLElement).style.transform =
              editor === 'symbol'
                ? `translate(${(burst % 2) * 3}px, ${(burst % 2) * 2}px) scale(.8,.7)`
                : `translate(${(burst % 2) * 3}px, ${(burst % 2) * 2}px)`;
            const rect = c.getBoundingClientRect();
            const samples = Array.from({ length: 200 }, (_, j) => {
              const i = burst * 200 + j + 1;
              const dx = 5 + (i % 160) * 0.7,
                dy = i % 2 ? 2 : -2;
              const event = new PointerEvent('pointermove', {
                bubbles: true,
                pointerId,
                pointerType: 'pen',
                buttons: 1,
                shiftKey: shift,
                clientX: start.x + dx,
                clientY: start.y + dy,
                pressure: i % 2 ? 0.25 : 0.75,
                tiltX: i % 2 ? -25 : 30,
                tiltY: 12,
                twist: i % 359,
              });
              const point =
                editor === 'main'
                  ? {
                      x: dx - rect.left + originalRect.left,
                      y: shift ? 0 : dy - rect.top + originalRect.top,
                    }
                  : {
                      x: (((event.clientX - rect.left) * 540) / rect.width - 20) / 2.9,
                      y:
                        ((((shift ? start.y - originalRect.top + rect.top : event.clientY) -
                          rect.top) *
                          330) /
                          rect.height -
                          20) /
                        2.9,
                    };
              expected.push({
                ...point,
                pressure: event.pressure,
                tiltX: event.tiltX,
                tiltY: event.tiltY,
                twist: event.twist,
              });
              return event;
            });
            last = samples.at(-1)!;
            const delivery = new PointerEvent('pointermove', last);
            Object.defineProperty(delivery, 'getCoalescedEvents', { value: () => samples });
            state.reads = 0;
            state.active = true;
            try {
              c.dispatchEvent(delivery);
            } finally {
              state.active = false;
            }
            reads.push(state.reads);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
          c.dispatchEvent(
            new PointerEvent('pointerup', {
              bubbles: true,
              pointerId,
              pointerType: 'pen',
              clientX: last.clientX,
              clientY: last.clientY,
              shiftKey: shift,
            }),
          );
          return {
            reads,
            expected,
            pointerId,
          };
        },
        { start: contact, shift, editor },
      );
      await page.mouse.up();
      expect(result.reads).toEqual(Array(30).fill(1));
      // Native mouseup releases main-stage capture; synthetic dispatch alone
      // does not reproduce that browser-managed pointer lifecycle.
      await expect
        .poll(() =>
          canvas.evaluate(
            (c, id) => (c as HTMLCanvasElement).hasPointerCapture(id),
            result.pointerId,
          ),
        )
        .toBe(false);
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      const brush = await page.evaluate(
        () =>
          (window as unknown as { brushLayout: { request: { brushCommit: { brush: Vector } } } })
            .brushLayout.request.brushCommit.brush,
      );
      expect(brush.points).toHaveLength(6001);
      for (let i = 0; i < result.expected.length; i++) {
        const actual = brush.points[i + 1],
          expected = result.expected[i];
        expect(actual.x).toBeCloseTo(expected.x, 9);
        expect(actual.y).toBeCloseTo(expected.y, 9);
        expect({
          pressure: actual.pressure,
          tiltX: actual.tiltX,
          tiltY: actual.tiltY,
          twist: actual.twist,
        }).toEqual({
          pressure: expected.pressure,
          tiltX: expected.tiltX,
          tiltY: expected.tiltY,
          twist: expected.twist,
        });
      }
      await releaseGeometry(page);
      if (editor === 'main')
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')
                  ?.project.layers.flatMap(
                    (layer: { keys: { shapes: Vector[] }[] }) => layer.keys[0].shapes,
                  )
                  .find((shape: Vector) => shape.kind === 'brush')?.points.length,
            ),
          )
          .toBe(6001);
      else {
        await page.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                JSON.parse(
                  localStorage.getItem('splash-recovery-v1')!,
                ).project.symbols[0].shapes.find((shape: Vector) => shape.kind === 'brush')?.points
                  .length,
            ),
          )
          .toBe(6001);
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
    });

for (const variant of ['polygon', 'brush', 'context'] as const)
  test(`symbol Brush reuses stationary ${variant} artwork across sustained input and invalidates resource changes`, async ({
    page,
  }) => {
    const geometry = variant === 'context' ? 'polygon' : variant;
    const project = newProject();
    const points = Array.from({ length: 2000 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 2000;
      return { x: 10 + 8 * Math.cos(angle), y: 10 + 8 * Math.sin(angle) };
    });
    project.symbols = [
      {
        id: 'cache',
        name: 'Cache',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'old',
            kind: geometry,
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            rotation: 0,
            fill: '#12ab34',
            stroke: '#12ab34',
            strokeWidth: geometry === 'brush' ? 2 : 0,
            closed: true,
            points,
            ...(geometry === 'brush'
              ? { brush: { pressure: true, tilt: false, minimum: 0.1, aspect: 1, angle: 0 } }
              : {}),
          },
        ],
      },
    ];
    if (variant === 'context') {
      project.width = 500;
      project.height = 290;
      const instance = symbolInstance(project.symbols[0], 250, 60);
      instance.width = 200;
      instance.height = 200;
      instance.transform = [-1, 0.2, 0.3, 1];
      instance.opacity = 0.5;
      const base: Vector = {
        id: 'under',
        kind: 'rectangle',
        x: 150,
        y: 150,
        width: 70,
        height: 70,
        rotation: 0,
        fill: '#0000ff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      };
      project.layers[0].keys[0].shapes = [
        base,
        instance,
        { ...base, id: 'over', x: 220, fill: '#ff0000' },
      ];
    }
    await page.addInitScript(
      ({ project, geometry }) => {
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
        const stringify = JSON.stringify;
        const state = { signatures: 0, paints: 0, sourceSerializations: 0, active: false };
        Object.assign(window, { symbolBrushCacheWork: state });
        JSON.stringify = function (value: unknown, ...args: unknown[]) {
          if (
            state.active &&
            Array.isArray(value) &&
            value[0] === geometry &&
            Array.isArray(value[6]) &&
            value[6].length === 2000
          )
            state.signatures++;
          if (state.active && Array.isArray(value) && value.length === 1 && value[0]?.id === 'old')
            state.sourceSerializations++;
          return (stringify as (...a: unknown[]) => string)(value, ...args);
        } as typeof JSON.stringify;
        const fill = CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.fill = function (
          this: CanvasRenderingContext2D,
          ...args: unknown[]
        ) {
          if (state.active && this.fillStyle === '#12ab34') state.paints++;
          return (fill as (...a: unknown[]) => void).apply(this, args);
        } as typeof fill;
      },
      { project, geometry },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    if (variant === 'context') {
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
      const stage = page.getByLabel('Drawing stage');
      const r = (await stage.boundingBox())!;
      await page.mouse.click(r.x + r.width / 2 - 250 + 240, r.y + r.height / 2 - 145 + 90);
      await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
    } else
      await page
        .getByRole('group', { name: 'Symbol Cache', exact: true })
        .getByRole('button', { name: 'Edit symbol artwork', exact: true })
        .click();
    await page.getByLabel('Symbol canvas tool').selectOption('brush');
    const canvas = page.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const original = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => {
          (c as HTMLElement).dataset.cachePointer = String((e as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await page.mouse.down();
    const work = await canvas.evaluate(async (c, inContext) => {
      const state = (
        window as unknown as {
          symbolBrushCacheWork: {
            signatures: number;
            paints: number;
            sourceSerializations: number;
            active: boolean;
          };
        }
      ).symbolBrushCacheWork;
      const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await tick();
      await tick();
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      const patch = inContext ? ([243, 91, 25, 25] as const) : ([25, 25, 55, 55] as const);
      const oldPixels = Array.from(ctx.getImageData(patch[0], patch[1], patch[2], patch[3]).data);
      const oldOver = Array.from(ctx.getImageData(245, 175, 10, 10).data);
      const rect = c.getBoundingClientRect(),
        pointerId = Number((c as HTMLElement).dataset.cachePointer);
      state.active = true;
      state.signatures = 0;
      state.paints = 0;
      state.sourceSerializations = 0;
      for (let batch = 0; batch < 20; batch++) {
        const samples = Array.from(
          { length: 100 },
          (_, j) =>
            new PointerEvent('pointermove', {
              bubbles: true,
              pointerId,
              buttons: 1,
              pointerType: 'mouse',
              clientX: rect.x + rect.width * 0.3 + ((batch * 100 + j) % 120),
              clientY: rect.y + rect.height * 0.6 + (j % 2 ? 2 : -2),
            }),
        );
        const delivered = samples.at(-1)!;
        Object.defineProperty(delivered, 'getCoalescedEvents', { value: () => samples });
        c.dispatchEvent(delivered);
        await tick();
        await tick();
      }
      const stable = {
        signatures: state.signatures,
        paints: state.paints,
        sourceSerializations: state.sourceSerializations,
      };
      const laterPixels = Array.from(ctx.getImageData(patch[0], patch[1], patch[2], patch[3]).data);
      const cachedPixels = Array.from(ctx.getImageData(0, 0, 540, 330).data);
      // Resource completion is independent of new pointer data and must repaint
      // cached text/bitmap artwork rather than retaining the old raster forever.
      document.fonts.dispatchEvent(new Event('loadingdone'));
      await tick();
      const refreshed = { signatures: state.signatures, paints: state.paints };
      const refreshedPixels = Array.from(
        ctx.getImageData(patch[0], patch[1], patch[2], patch[3]).data,
      );
      const uncachedPixels = Array.from(ctx.getImageData(0, 0, 540, 330).data);
      const laterOver = Array.from(ctx.getImageData(245, 175, 10, 10).data);
      state.active = false;
      c.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
      return {
        stable,
        refreshed,
        pixelDifferences: cachedPixels.reduce(
          (n, value, i) => n + (value !== uncachedPixels[i] ? 1 : 0),
          0,
        ),
        oldPixels,
        laterPixels,
        refreshedPixels,
        pointerId,
        oldOver,
        laterOver,
      };
    }, variant === 'context');
    expect(work.stable).toEqual({ signatures: 0, paints: 0, sourceSerializations: 0 });
    expect(work.refreshed.signatures).toBeGreaterThan(0);
    expect(work.refreshed.paints).toBeGreaterThan(0);
    expect(work.laterPixels).toEqual(work.oldPixels);
    expect(work.refreshedPixels).toEqual(work.oldPixels);
    if (variant !== 'context')
      expect(work.oldPixels.some((n, i) => i % 4 === 1 && n === 171)).toBe(true);
    else {
      expect(work.laterOver).not.toEqual(work.oldOver);
      expect(work.pixelDifferences).toBe(0);
      expect(work.oldPixels.some((n, i) => i % 4 === 1 && n !== 255)).toBe(true);
    }
    await page.mouse.up();
    await expect
      .poll(() =>
        canvas.evaluate(
          (c, pointer) => (c as HTMLCanvasElement).hasPointerCapture(pointer),
          work.pointerId,
        ),
      )
      .toBe(false);
    await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const outcome of ['success', 'failure', 'stale', 'close', 'context'] as const)
  test(`released symbol Brush caches source-owned artwork through worker ${outcome}`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const project = newProject();
    const old: Vector = {
      id: 'old',
      kind: 'polygon',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#12ab34',
      stroke: '#000000',
      strokeWidth: 0,
      closed: true,
      points: Array.from({ length: 2000 }, (_, i) => ({
        x: 10 + 8 * Math.cos((i * Math.PI) / 1000),
        y: 10 + 8 * Math.sin((i * Math.PI) / 1000),
      })),
    };
    project.symbols = [
      { id: 'pending-cache', name: 'Pending cache', width: 100, height: 100, shapes: [old] },
    ];
    if (outcome === 'context') {
      project.width = 500;
      project.height = 290;
      const instance = symbolInstance(project.symbols[0], 250, 60);
      instance.width = 200;
      instance.height = 200;
      instance.transform = [-1, 0.2, 0.3, 1];
      instance.opacity = 0.5;
      const base: Vector = {
        id: 'under',
        kind: 'rectangle',
        x: 150,
        y: 150,
        width: 70,
        height: 70,
        rotation: 0,
        fill: '#0000ff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      };
      project.layers[0].keys[0].shapes = [
        base,
        instance,
        { ...base, id: 'over', x: 220, fill: '#ff0000' },
      ];
    }
    await page.addInitScript((project) => {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
      const state = {
        active: false,
        signatures: 0,
        paints: 0,
        sourceSerializations: 0,
        responses: 0,
        request: null as { brushCommit: { brush: Vector } } | null,
      };
      Object.assign(window, { pendingSceneWork: state });
      const stringify = JSON.stringify;
      JSON.stringify = function (value: unknown, ...args: unknown[]) {
        if (state.active && Array.isArray(value)) {
          if (value[0] === 'polygon' && Array.isArray(value[6]) && value[6].length === 2000)
            state.signatures++;
          if (value.length === 1 && value[0]?.id === 'old') state.sourceSerializations++;
        }
        return (stringify as (...args: unknown[]) => string)(value, ...args);
      } as typeof stringify;
      const fill = CanvasRenderingContext2D.prototype.fill;
      CanvasRenderingContext2D.prototype.fill = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        if (state.active && this.fillStyle === '#12ab34') state.paints++;
        return (fill as (...args: unknown[]) => void).apply(this, args);
      } as typeof fill;
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message: unknown) {
        if ((message as { brushCommit?: unknown }).brushCommit)
          state.request = structuredClone(message) as typeof state.request;
        this.addEventListener('message', () => state.responses++, { once: true });
        post.call(this, message);
      };
    }, project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    if (outcome === 'context') {
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
      const r = (await page.getByLabel('Drawing stage').boundingBox())!;
      await page.mouse.click(r.x + r.width / 2 - 10, r.y + r.height / 2 - 55);
      await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
    } else
      await page
        .getByRole('group', { name: 'Symbol Pending cache', exact: true })
        .getByRole('button', { name: 'Edit symbol artwork', exact: true })
        .click();
    await page.getByLabel('Symbol canvas tool').selectOption('brush');
    await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
    await page.getByLabel('Smooth symbol brush', { exact: true }).uncheck();
    await page.getByLabel('New symbol drawing fill', { exact: true }).fill('#ff0000');
    const canvas = page.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const original = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => {
          (c as HTMLElement).dataset.pendingPointer = String((e as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    const r = (await canvas.boundingBox())!;
    await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.5);
    await page.mouse.down();
    await canvas.evaluate((c) => {
      const r = c.getBoundingClientRect(),
        pointerId = Number((c as HTMLElement).dataset.pendingPointer);
      const sample = (i: number, type = 'pointermove') =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: 'mouse',
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: r.x + r.width * (0.3 + (0.4 * i) / 6000),
          clientY: r.y + r.height * 0.5 + (i % 2 ? 3 : 0),
        });
      const move = sample(6000);
      Object.defineProperty(move, 'getCoalescedEvents', {
        value: () => Array.from({ length: 6000 }, (_, i) => sample(i + 1)),
      });
      c.dispatchEvent(move);
      c.dispatchEvent(sample(6000, 'pointerup'));
    });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    const work = await canvas.evaluate(async (c) => {
      const state = (
        window as unknown as {
          pendingSceneWork: {
            active: boolean;
            signatures: number;
            paints: number;
            sourceSerializations: number;
            request: { brushCommit: { brush: Vector } };
          };
        }
      ).pendingSceneWork;
      const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await tick();
      state.active = true;
      state.signatures = state.paints = state.sourceSerializations = 0;
      for (let i = 0; i < 32; i++) await tick();
      const stable = {
        signatures: state.signatures,
        paints: state.paints,
        sourceSerializations: state.sourceSerializations,
      };
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      const before = ctx.getImageData(0, 0, 540, 330).data;
      const tail = Array.from(ctx.getImageData(373, 165, 1, 1).data);
      document.fonts.dispatchEvent(new Event('loadingdone'));
      await tick();
      const after = ctx.getImageData(0, 0, 540, 330).data;
      const refreshed = { signatures: state.signatures, paints: state.paints };
      state.active = false;
      return {
        stable,
        refreshed,
        differences: before.reduce((n, v, i) => n + (v !== after[i] ? 1 : 0), 0),
        tail,
        points: state.request.brushCommit.brush.points.length,
      };
    });
    expect(work.stable).toEqual({ signatures: 0, paints: 0, sourceSerializations: 0 });
    expect(work.refreshed.signatures).toBeGreaterThan(0);
    expect(work.refreshed.paints).toBeGreaterThan(0);
    expect(work.differences).toBe(0);
    expect(work.points).toBe(6001);
    if (outcome !== 'context') expect(work.tail).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
    if (outcome === 'stale') {
      await page.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
      await expect
        .poll(() =>
          canvas.evaluate((c) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(373, 165, 1, 1).data,
            ),
          ),
        )
        .toEqual([255, 255, 255, 255]);
    }
    if (outcome === 'close')
      await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    await releaseGeometry(page, outcome === 'failure');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { pendingSceneWork: { responses: number } }).pendingSceneWork
              .responses,
        ),
      )
      .toBe(1);
    if (outcome === 'close') {
      expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
      await expect(
        page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
      ).toHaveCount(0);
      return;
    }
    await expect(
      page.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeEnabled();
    if (outcome === 'failure') {
      await expect(
        page.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeDisabled();
      await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
      return;
    }
    await page.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await page.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
    );
    expect(saved.layers).toEqual(project.layers);
    expect(saved.symbols[0].shapes[0]).toEqual(
      outcome === 'stale' ? { ...old, fill: '#0000ff' } : old,
    );
    expect(saved.symbols[0].shapes).toHaveLength(outcome === 'stale' ? 1 : 2);
    if (outcome !== 'stale') expect(saved.symbols[0].shapes[1].points).toHaveLength(6001);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
      )
      .toEqual(project);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const mode of ['cancel', 'release', 'resize'] as const)
  test(`main Brush scene serialization stays fixed across sustained frames and ${mode}`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const project = newProject();
    project.id = 'brush-main-cache-project';
    project.width = 500;
    project.height = 290;
    project.layers[0].drawingMode = 'object';
    const old: Vector = {
      id: 'old-main',
      kind: 'polygon',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#12ab34',
      stroke: '#000000',
      strokeWidth: 0,
      closed: true,
      points: Array.from({ length: 2000 }, (_, i) => ({
        x: 10 + 8 * Math.cos((i * Math.PI) / 1000),
        y: 10 + 8 * Math.sin((i * Math.PI) / 1000),
      })),
    };
    project.layers[0].keys[0].shapes = [old];
    await page.addInitScript((project) => {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
      const state = {
        active: false,
        scenes: 0,
        contours: 0,
        source: 0,
        geometry: 0,
        paints: 0,
        request: null as { brushCommit: { brush: Vector } } | null,
      };
      Object.assign(window, { mainBrushSceneWork: state });
      const stringify = JSON.stringify;
      JSON.stringify = function (value: unknown, ...args: unknown[]) {
        if (state.active) {
          if (Array.isArray(value)) {
            if (typeof value[10] === 'string' && value[10].includes('brush-main-cache-project'))
              state.scenes++;
            if (typeof value[8] === 'string' && value[8].includes('brush-main-cache-project'))
              state.contours++;
            if (value[0] === 'polygon' && Array.isArray(value[6]) && value[6].length === 2000)
              state.geometry++;
          } else if ((value as { id?: string } | null)?.id === 'brush-main-cache-project')
            state.source++;
        }
        return (stringify as (...args: unknown[]) => string)(value, ...args);
      } as typeof stringify;
      const fill = CanvasRenderingContext2D.prototype.fill;
      CanvasRenderingContext2D.prototype.fill = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        if (state.active && this.fillStyle === '#12ab34') state.paints++;
        return (fill as (...args: unknown[]) => void).apply(this, args);
      } as typeof fill;
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message: unknown) {
        if ((message as { brushCommit?: unknown }).brushCommit)
          state.request = structuredClone(message) as typeof state.request;
        post.call(this, message);
      };
    }, project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
    await page.getByLabel('Separate brush objects', { exact: true }).check();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    const canvas = page.getByLabel('Drawing stage');
    await canvas.scrollIntoViewIfNeeded();
    const original = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const readOld = () =>
      canvas.evaluate((c) => {
        const target = c as HTMLCanvasElement;
        return Array.from(
          target
            .getContext('2d')!
            .getImageData(target.width / 2 - 250 + 10, target.height / 2 - 145 + 10, 1, 1).data,
        );
      });
    const originalPixel = await readOld();
    expect(originalPixel).toEqual([18, 171, 52, 255]);
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => {
          (c as HTMLElement).dataset.mainScenePointer = String((e as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    const r = (await canvas.boundingBox())!;
    await page.mouse.move(r.x + r.width / 2 - 150, r.y + r.height / 2);
    await page.mouse.down();
    const measure = async (offset: number) =>
      canvas.evaluate(async (c, offset) => {
        const state = (
          window as unknown as {
            mainBrushSceneWork: {
              active: boolean;
              scenes: number;
              contours: number;
              source: number;
              geometry: number;
              paints: number;
            };
          }
        ).mainBrushSceneWork;
        const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await tick();
        await tick();
        state.scenes = state.contours = state.source = state.geometry = state.paints = 0;
        state.active = true;
        const r = c.getBoundingClientRect(),
          pointerId = Number((c as HTMLElement).dataset.mainScenePointer);
        for (let batch = 0; batch < 20; batch++) {
          const samples = Array.from(
            { length: 100 },
            (_, j) =>
              new PointerEvent('pointermove', {
                bubbles: true,
                pointerId,
                pointerType: 'mouse',
                buttons: 1,
                clientX: r.x + r.width / 2 - 150 + ((offset + batch * 100 + j) % 200),
                clientY: r.y + r.height / 2 + (j % 2 ? 3 : -3),
              }),
          );
          const move = samples.at(-1)!;
          Object.defineProperty(move, 'getCoalescedEvents', { value: () => samples });
          c.dispatchEvent(move);
          await tick();
          await tick();
        }
        state.active = false;
        return {
          scenes: state.scenes,
          contours: state.contours,
          source: state.source,
          geometry: state.geometry,
          paints: state.paints,
        };
      }, offset);
    const activeWork = await measure(0);
    let resizedWork: typeof activeWork | undefined;
    if (mode === 'resize') {
      await page.setViewportSize({ width: 1300, height: 900 });
      resizedWork = await measure(2000);
      // Resizing invalidates the viewport bitmap once. The next sustained
      // window must settle without either stale pixels or continued replay.
      expect(resizedWork.scenes).toBe(0);
      expect(resizedWork.contours).toBe(0);
      expect(resizedWork.source).toBe(0);
      expect(resizedWork.geometry).toBeLessThanOrEqual(1);
      expect(resizedWork.paints).toBe(1);
      resizedWork = await measure(4000);
      expect(await readOld()).toEqual(originalPixel);
    }
    if (mode === 'release') {
      await canvas.evaluate((c) => {
        const r = c.getBoundingClientRect(),
          pointerId = Number((c as HTMLElement).dataset.mainScenePointer);
        c.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId,
            pointerType: 'mouse',
            clientX: r.x + r.width / 2 + 49,
            clientY: r.y + r.height / 2 + 3,
          }),
        );
      });
      await page.mouse.up();
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      const pendingWork = await canvas.evaluate(async () => {
        const state = (
          window as unknown as {
            mainBrushSceneWork: {
              active: boolean;
              scenes: number;
              contours: number;
              source: number;
              geometry: number;
              paints: number;
            };
          }
        ).mainBrushSceneWork;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        state.scenes = state.contours = state.source = state.geometry = state.paints = 0;
        state.active = true;
        for (let i = 0; i < 20; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        state.active = false;
        return {
          scenes: state.scenes,
          contours: state.contours,
          source: state.source,
          geometry: state.geometry,
          paints: state.paints,
        };
      });
      expect(pendingWork).toEqual({ scenes: 0, contours: 0, source: 0, geometry: 0, paints: 0 });
      await releaseGeometry(page);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys[0]
                .shapes.length,
          ),
        )
        .toBe(2);
      const saved = await page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
      );
      expect(saved.layers[0].keys[0].shapes[0]).toEqual(old);
      expect(saved.layers[0].keys[0].shapes[1].points).toHaveLength(2001);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
        )
        .toEqual(project);
    } else {
      await canvas.evaluate((c) =>
        c.dispatchEvent(
          new PointerEvent('pointercancel', {
            bubbles: true,
            pointerId: Number((c as HTMLElement).dataset.mainScenePointer),
          }),
        ),
      );
      await page.mouse.up();
      expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(original);
    }
    expect(activeWork).toEqual({ scenes: 0, contours: 0, source: 0, geometry: 0, paints: 0 });
    if (resizedWork) expect(resizedWork).toEqual(activeWork);
    expect(await readOld()).toEqual(originalPixel);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
