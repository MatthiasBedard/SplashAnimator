import { test, expect } from '@playwright/test';
import { newLayer, newProject, type Vector, type Project, type SymbolDefinition } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

import { denseNestedTimeline } from './dense-nested-timeline';

test('long nested timeline scrubbing skips full-scene encoding and paints exact graphic exposures', async ({ page }) => {
  test.setTimeout(90_000);
  const p = denseNestedTimeline();
  const raw = JSON.stringify({ project: p, folder: null, manifest: null });
  await page.addInitScript(raw => localStorage.setItem('splash-recovery-v1', raw), raw);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await page.evaluate(() => {
    const ops = { copiedCharacters: 0, draws: 0 };
    Object.assign(window, { nestedScrubOps: ops });
    const stringify = JSON.stringify;
    JSON.stringify = function (value: unknown, ...args: unknown[]) {
      if (Array.isArray(value)) for (const item of value)
        if (typeof item === 'string' && item.length > 100000 && item.startsWith('{"schemaVersion":'))
          ops.copiedCharacters += item.length;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    } as typeof JSON.stringify;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (this.canvas.id === 'drawing-stage') ops.draws++;
      Reflect.apply(draw, this, args);
    };
  });
  const work = () => page.evaluate(() =>
    (window as unknown as { nestedScrubOps: { draws: number; copiedCharacters: number } }).nestedScrubOps);
  const timings: { frame: number; draw: number; readback: number }[] = [];
  const visit = async (at: number, navigate: () => Promise<unknown>) => {
    const before = (await work()).draws;
    const start = performance.now();
    await navigate();
    await expect.poll(async () => (await work()).draws).toBeGreaterThan(before);
    const drawn = performance.now();
    await expect(timeline).toHaveAccessibleDescription(new RegExp(`Frame ${at + 1} of 480`));
    const key = Math.floor(at / 10), local = (at % 10) % 4;
    await expect.poll(() => stage.evaluate((canvas: HTMLCanvasElement, shift) =>
      Array.from(canvas.getContext('2d')!.getImageData(
        Math.round(canvas.width / 2 + (30 + shift - 250) * devicePixelRatio),
        Math.round(canvas.height / 2 + (25 - 135) * devicePixelRatio), 1, 1,
      ).data), key % 4 * 12)).toEqual(
      local === 0 ? [0, 204, 255, 255] : local === 3 ? [255, 204, 0, 255] : [255, 0, 102, 255]);
    timings.push({ frame: at, draw: drawn - start, readback: performance.now() - drawn });
  };
  const box = (await timeline.boundingBox())!;
  await page.mouse.move(box.x + 9, box.y + 10);
  await page.mouse.down();
  for (const at of [3, 16, 7, 24, 11, 2])
    await visit(at, () => page.mouse.move(box.x + at * 18 + 9, box.y + 10));
  await page.mouse.up();
  await visit(479, () => timeline.press('End'));
  await visit(478, () => timeline.press('ArrowLeft'));
  await visit(0, () => timeline.press('Home'));
  const measured = await work();
  console.info('long nested scrub observations', JSON.stringify({ timings, ...measured, size: raw.length }));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(raw);
  expect(measured.copiedCharacters).toBe(0);
});

test('nested movie clocks preserve playback ages without resampling an unchanged tick', async ({ page }) => {
  test.setTimeout(90_000);
  const p = denseNestedTimeline();
  p.fps = 25;
  const movie = symbolInstance(p.symbols![0], 0, 0);
  movie.symbolPlayback = { mode: 'movie', firstFrame: 1 };
  const wrapper: SymbolDefinition = {
    id: 'clock-wrapper', name: 'Clock wrapper', width: 10, height: 10, shapes: [movie],
  };
  p.symbols!.push(wrapper);
  const left = { ...symbolInstance(wrapper, 370, 250), id: 'clock-left' };
  const right = { ...symbolInstance(wrapper, 420, 250), id: 'clock-right' };
  const clocks = newLayer('Independent clocks');
  clocks.keys = [
    { frame: 0, shapes: [left] }, { frame: 2, shapes: [left, right] },
    { frame: 4, shapes: [left] }, { frame: 6, shapes: [left, right] },
  ];
  p.layers.push(clocks);
  const raw = JSON.stringify({ project: p, folder: null, manifest: null });
  type ClockProbe = { time: number | null; serializations: number; intervals: number[] };
  await page.addInitScript(raw => {
    localStorage.setItem('splash-recovery-v1', raw);
    const state: ClockProbe = { time: 10000, serializations: 0, intervals: [] };
    Object.assign(window, { denseClock: state });
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => raf(time => fn(state.time ?? time));
    let previous: number | undefined;
    function measure(time: number) {
      if (state.time === null) {
        if (previous !== undefined) state.intervals.push(time - previous);
        previous = time;
      } else previous = undefined;
      raf(measure);
    }
    raf(measure);
    const stringify = JSON.stringify;
    JSON.stringify = function (value: unknown, ...args: unknown[]) {
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          Object.keys(value).some(key => key.includes('/clock-left')))
        state.serializations++;
      return Reflect.apply(stringify, JSON, [value, ...args]);
    } as typeof JSON.stringify;
  }, raw);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const session = await page.context().newCDPSession(page);
  const heap: number[] = [];
  const repeats: number[] = [];
  const sampleHeap = async () => {
    await session.send('HeapProfiler.collectGarbage');
    heap.push((await session.send('Runtime.getHeapUsage')).usedSize);
  };
  const count = () => page.evaluate(() => (window as unknown as { denseClock: ClockProbe }).denseClock.serializations);
  const step = (time: number) => page.evaluate(time => {
    (window as unknown as { denseClock: ClockProbe }).denseClock.time = time;
  }, time);
  const colors = ['0,204,255', '255,0,102', '255,0,102', '255,204,0'];
  const pixels = () => stage.evaluate((canvas: HTMLCanvasElement) => [375, 425].map(x =>
    Array.from(canvas.getContext('2d')!.getImageData(
      Math.round(canvas.width / 2 + (x - 250) * devicePixelRatio),
      Math.round(canvas.height / 2 + (255 - 135) * devicePixelRatio), 1, 1,
    ).data).slice(0, 3).join(',')));
  await sampleHeap();
  for (let cycle = 0; cycle < 3; cycle++) {
    const origin = 10000 + cycle * 30000;
    await timeline.press('End');
    await expect(timeline).toHaveAccessibleDescription(/Frame 480 of 480/);
    await timeline.press('Home');
    await step(origin);
    await stage.press('Enter');
    await expect(page.getByRole('button', { name: 'Stop playback' })).toBeVisible();
    await expect.poll(pixels).toEqual([colors[1], '255,255,255']);
    await expect.poll(count).toBeGreaterThan(0);
    for (const elapsed of [1, 2, 3, 4, 5, 6, 7, 14, 26, 89, 239, 479, 480, 482]) {
      const frame = elapsed % 480;
      await step(origin + elapsed * 40 + 1);
      await expect(timeline).toHaveAccessibleDescription(new RegExp(`Frame ${frame + 1} of 480`));
      const rightAge = frame < 2 || frame === 4 || frame === 5 ? null : frame - (frame < 4 ? 2 : 6);
      await expect.poll(pixels).toEqual([
        colors[(1 + elapsed) % 4], rightAge === null ? '255,255,255' : colors[(1 + rightAge) % 4],
      ]);
    }
    const before = await count();
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
    repeats.push(await count() - before);
    await stage.press('Enter');
    await expect(page.getByRole('button', { name: 'Play animation' })).toBeVisible();
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); });
    await sampleHeap();
  }
  const controlledEncodings = await count();
  await timeline.press('Home');
  await page.evaluate(() => { (window as unknown as { denseClock: ClockProbe }).denseClock.time = null; });
  await stage.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeVisible();
  await expect(timeline).toHaveAccessibleDescription(/Frame 4\d\d of 480/, { timeout: 25_000 });
  await expect(timeline).toHaveAccessibleDescription(/Frame [1-9]\d? of 480/, { timeout: 10_000 });
  await stage.press('Enter');
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeVisible();
  await sampleHeap();
  const intervals = await page.evaluate(() => (window as unknown as { denseClock: ClockProbe }).denseClock.intervals);
  const elapsed = intervals.reduce((sum, interval) => sum + interval, 0);
  expect(elapsed).toBeGreaterThanOrEqual(19_000);
  intervals.sort((a, b) => a - b);
  console.info('nested playback observations', JSON.stringify({
    heap, repeats, controlledEncodings, elapsed, intervals: intervals.length,
    intervalP95: intervals[Math.floor(intervals.length * 0.95)], intervalMax: intervals.at(-1),
  }));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(raw);
  expect(repeats).toEqual([0, 0, 0]);
  await session.detach();
});

test('reactive source admission notices same-JSON own-undefined changes and rejects raw nonfinite data', async ({
  page,
}) => {
  const output = await build({
    configFile: false,
    plugins: [svelte()],
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/reactive-stamp-fixture.svelte.ts',
        name: 'ReactiveStamp',
        formats: ['iife'],
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output])
    .flatMap((o) => ('output' in o ? o.output : []))
    .filter((o) => o.type === 'chunk');
  expect(chunks).toHaveLength(1);
  await page.goto('/');
  await page.addScriptTag({ content: chunks[0].code });
  const result = await page.evaluate(() => {
    const api = (
      window as unknown as { ReactiveStamp: typeof import('../reactive-stamp-fixture.svelte') }
    ).ReactiveStamp;
    const source = api.createReactiveStamp(),
      initial = source.read();
    source.add();
    const added = source.read();
    source.remove();
    const removed = source.read();
    source.move();
    const moved = source.read();
    source.replace();
    const replaced = source.read();
    source.invalid();
    let rejected = false;
    try {
      source.read();
    } catch {
      rejected = true;
    }
    return { initial, added, removed, moved, replaced, rejected };
  });
  expect(result.initial.json).toBe(result.added.json);
  expect(result.initial.lossless).not.toBe(result.added.lossless);
  expect(result.removed.lossless).toBe(result.initial.lossless);
  for (const row of [result.initial, result.added, result.removed, result.moved, result.replaced])
    expect(row.lossless).toBe(row.actual);
  expect(result.rejected).toBe(true);
});

test('dense motion-symbol native scrubbing retains exact poses and reports repeated ownership work', async ({
  page,
}) => {
  test.setTimeout(120000);
  let p = newProject();
  p.width = 500;
  p.height = 240;
  p.duration = 50;
  p.layers[0].drawingMode = 'object';
  const shapes: Vector[] = Array.from({ length: 24 }, (_, i) => ({
    id: `curve${i}`,
    kind: 'bezier',
    x: 40 + (i % 6) * 60,
    y: 40 + Math.floor(i / 6) * 45,
    width: 28,
    height: 28,
    rotation: 0,
    opacity: 1,
    fill: i ? '#ff0000' : '#00aaff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    closed: true,
    nodes: Array.from({ length: 24 }, (_, n) => {
      const a = (n * 2 * Math.PI) / 24,
        x = 14 * Math.cos(a),
        y = 14 * Math.sin(a),
        k = (4 / 3) * Math.tan(Math.PI / 48) * 14;
      return {
        x,
        y,
        mode: 'corner' as const,
        in: { x: x + k * Math.sin(a), y: y - k * Math.cos(a) },
        out: { x: x - k * Math.sin(a), y: y + k * Math.cos(a) },
      };
    }),
  }));
  p.layers[0].keys = [
    { frame: 0, shapes },
    { frame: 48, shapes: shapes.map((s) => ({ ...structuredClone(s), x: s.x + 100 })) },
  ];
  p = prepareTimelineTween(p, p.layers[0].id, {
    start: 0,
    end: 48,
    kind: 'motion',
    symbolize: true,
    affine: false,
    createEndpoints: false,
    ease: 'linear',
  });
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await page.evaluate(() => {
    const clone = structuredClone,
      stringify = JSON.stringify,
      descriptors = Object.getOwnPropertyDescriptors;
    const work = { clones: 0, stamps: 0, descriptors: 0, characters: 0 };
    (window as unknown as { scrubWork: typeof work }).scrubWork = work;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      if ((value as Project)?.layers && (value as Project).duration) work.clones++;
      return clone(value, options);
    };
    JSON.stringify = function (value: unknown, ...rest: unknown[]) {
      const out = Reflect.apply(stringify, JSON, [value, ...rest]) as string;
      if (Array.isArray(value) && Array.isArray(value[0]) && value[0][0] === 'object') {
        work.stamps++;
        work.characters += out.length;
      }
      return out;
    } as typeof JSON.stringify;
    Object.getOwnPropertyDescriptors = function <T>(value: T) {
      work.descriptors++;
      return descriptors(value);
    };
  });
  const b = (await timeline.boundingBox())!,
    times: number[] = [];
  const cpu = await page.context().newCDPSession(page);
  await cpu.send('Profiler.enable');
  await cpu.send('Profiler.start');
  await page.mouse.move(b.x + 9, b.y + 10);
  await page.mouse.down();
  for (const at of [3, 30, 6, 27, 9, 24]) {
    const start = Date.now();
    await page.mouse.move(b.x + at * 18 + 9, b.y + 10);
    await expect(page.locator('.frame-readout')).toContainText(`Frame ${at + 1} / 50`);
    await expect
      .poll(
        () =>
          canvas.evaluate((c: HTMLCanvasElement, at) => {
            const x = 40 + (at * 100) / 48,
              y = 40;
            return Array.from(
              c
                .getContext('2d')!
                .getImageData(
                  Math.round(c.width / 2 + (x - 250) * devicePixelRatio),
                  Math.round(c.height / 2 + (y - 120) * devicePixelRatio),
                  1,
                  1,
                ).data,
            );
          }, at),
        { timeout: 15000 },
      )
      .toEqual([0, 170, 255, 255]);
    times.push(Date.now() - start);
  }
  await page.mouse.up();
  const { profile } = await cpu.send('Profiler.stop');
  const counts = new Map<number, number>();
  for (const id of profile.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const hot = profile.nodes
    .map((n) => ({
      name: n.callFrame.functionName,
      line: n.callFrame.lineNumber,
      col: n.callFrame.columnNumber,
      samples: counts.get(n.id) ?? 0,
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 12);
  console.log(
    'SCRUB_PROFILE',
    JSON.stringify({
      times,
      work: await page.evaluate(() => (window as unknown as { scrubWork: unknown }).scrubWork),
      hot,
    }),
  );
  const work = await page.evaluate(
    () =>
      (
        window as unknown as {
          scrubWork: { stamps: number; descriptors: number; characters: number };
        }
      ).scrubWork,
  );
  // A work bound for this fixed fixture, independent of host wall-clock speed.
  expect(work.stamps).toBeLessThan(150);
  expect(work.descriptors).toBeLessThan(250000);
  expect(work.characters).toBeLessThan(20000000);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
  await cpu.detach();
});
