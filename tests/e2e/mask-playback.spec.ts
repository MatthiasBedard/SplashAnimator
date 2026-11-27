import { test, expect, type Page } from '@playwright/test';
import { newLayer, validateProject, type Project } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { layerPresentationMaskFixture } from '../layer-presentation-fixture';
import { maskResourceFixture } from '../mask-resources-fixture';

type PlaybackProbe = {
  timers: { id: number; delay: number; cancelled: boolean; fired: boolean; run: () => void }[];
  fire: (index: number, late: boolean) => void;
  canvases: HTMLCanvasElement[];
  decodes: number;
  closes: number;
  loads: number;
  held: boolean;
  release: () => void;
  advanceTime: () => void;
};
async function setup(page: Page, mode = 'button') {
  let p = layerPresentationMaskFixture();
  const leaf = p.symbols![0];
  if (mode === 'graphic' || mode === 'rootMovie') {
    p.layers[1].keys[0].shapes = [
      {
        ...symbolInstance(leaf, 0, 0),
        id: 'mask-root',
        opacity: 0.5,
        symbolPlayback: { mode: mode === 'graphic' ? 'loop' : 'movie', firstFrame: 0 },
      },
    ];
    if (mode === 'graphic') p.duration = 3;
  }
  if (mode === 'siblings')
    p.layers[1].keys[0].shapes.push({
      ...symbolInstance(leaf, 40, 0),
      id: 'sibling',
      opacity: 0.5,
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    });
  if (mode === 'reentry') {
    p.duration = 4;
    p.layers[1].keys.push(
      { frame: 1, shapes: [] },
      { frame: 3, shapes: structuredClone(p.layers[1].keys[0].shapes) },
    );
  }
  if (mode === 'holes')
    for (const shape of [leaf.shapes[0], ...leaf.timeline!.keys.flatMap((k) => k.shapes)]) {
      shape.kind = 'polygon';
      shape.fillRule = 'evenodd';
      shape.points = [];
      shape.contours = [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 40 },
          { x: 0, y: 40 },
        ],
        [
          { x: 5, y: 10 },
          { x: 15, y: 10 },
          { x: 15, y: 30 },
          { x: 5, y: 30 },
        ],
      ];
    }
  if (mode === 'bitmap') {
    const url = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 20, 30);
      return c.toDataURL();
    });
    p = maskResourceFixture(url);
  }
  p.fps = 2;
  p.layers.push({ ...newLayer('Other mask'), id: 'other', keys: [{ frame: 0, shapes: [] }] });
  validateProject(p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('mask-play-seed')) {
      sessionStorage.setItem('mask-play-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layer mask…', exact: true }).click();
  await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
  await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
}
async function instrument(page: Page, hold: 'none' | 'image' | 'font' = 'none', manual = true) {
  await page.evaluate(
    ({ hold, manual }) => {
      const timers: PlaybackProbe['timers'] = [],
        canvases: HTMLCanvasElement[] = [],
        set = window.setTimeout.bind(window),
        clear = window.clearTimeout.bind(window),
        create = document.createElement.bind(document),
        decode = createImageBitmap,
        load = document.fonts.load.bind(document.fonts),
        now = performance.now.bind(performance);
      let next = -1,
        release!: () => void,
        first = true,
        offset = 0;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const probe: PlaybackProbe = {
        timers,
        canvases,
        decodes: 0,
        closes: 0,
        loads: 0,
        held: false,
        release,
        advanceTime: () => {
          offset += 5_000;
        },
        fire: (index, late) => {
          const t = timers[index];
          if (!t) throw Error('Missing playback task');
          if (!late && (t.cancelled || t.fired)) throw Error('Task is no longer scheduled');
          t.fired = true;
          t.run();
        },
      };
      // Hold only the compiled playback successor callback, not app readiness,
      // recovery or test deadlines. The real control still owns every tick/job.
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (
          typeof handler === 'function' &&
          /['"]step['"]/.test(Function.prototype.toString.call(handler))
        ) {
          const t = {
            id: manual ? next-- : 0,
            delay: delay ?? 0,
            cancelled: false,
            fired: false,
            run: () => Reflect.apply(handler, window, args),
          };
          if (!manual)
            t.id = set(() => {
              t.fired = true;
              t.run();
            }, delay);
          timers.push(t);
          return t.id;
        }
        return set(handler, delay, ...args);
      }) as typeof setTimeout;
      window.clearTimeout = (id) => {
        const t = timers.find((t) => t.id === id);
        if (t) t.cancelled = true;
        clear(id);
      };
      performance.now = () => now() + offset;
      document.createElement = ((...args: Parameters<typeof document.createElement>) => {
        const e = create(...args);
        if (args[0] === 'canvas') canvases.push(e as HTMLCanvasElement);
        return e;
      }) as typeof document.createElement;
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        probe.decodes++;
        const image = await decode(...args),
          close = image.close.bind(image);
        image.close = () => {
          probe.closes++;
          close();
        };
        if (first && hold === 'image') {
          first = false;
          probe.held = true;
          await gate;
        }
        return image;
      }) as typeof createImageBitmap;
      document.fonts.load = async (...args) => {
        probe.loads++;
        const result = await load(...args);
        if (first && hold === 'font') {
          first = false;
          probe.held = true;
          await gate;
        }
        return result;
      };
      Object.assign(window, { maskPlay: probe });
    },
    { hold, manual },
  );
}
async function stats(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { maskPlay: PlaybackProbe }).maskPlay;
    return {
      timers: p.timers.map(({ id, delay, cancelled, fired }) => ({ id, delay, cancelled, fired })),
      decodes: p.decodes,
      closes: p.closes,
      loads: p.loads,
    };
  });
}
async function fire(page: Page, index: number, late = false) {
  await page.evaluate(
    ({ index, late }) =>
      (window as unknown as { maskPlay: PlaybackProbe }).maskPlay.fire(index, late),
    { index, late },
  );
}
async function tick(page: Page, n: number) {
  await expect(page.getByLabel('Mask presentation tick', { exact: true })).toContainText(
    `Tick ${n} ·`,
  );
}
async function shown(page: Page) {
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
}
async function pixels(page: Page, xs = [5, 25, 45, 65]) {
  return page
    .locator('canvas[aria-label="Layer mask preview"]')
    .evaluate(
      (c: HTMLCanvasElement, xs) =>
        xs.map((x) => Array.from(c.getContext('2d')!.getImageData(x, 20, 1, 1).data)),
      xs,
    );
}
async function play(page: Page) {
  await page.getByRole('button', { name: 'Play mask preview', exact: true }).click();
}
async function retired(page: Page) {
  const sizes = await page.evaluate(() =>
    (window as unknown as { maskPlay: PlaybackProbe }).maskPlay.canvases.map((c) => [
      c.width,
      c.height,
    ]),
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes).toEqual(Array(sizes.length).fill([0, 0]));
}
const blue = [0, 0, 255, 255],
  half = [128, 0, 127, 255];

for (const mode of ['button', 'rootMovie', 'graphic', 'siblings', 'reentry', 'holes'])
  test(`controlled playback ${mode} visits exact ticks/independent poses and pauses/resumes without edits`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await open(page);
    await expect(page.getByRole('button', { name: 'Play mask preview', exact: true })).toHaveCount(
      0,
    );
    await instrument(page);
    await page.getByLabel('Use stepped mask session').check();
    await play(page);
    await shown(page);
    await tick(page, 0);
    const xs = mode === 'holes' ? [2, 10, 22, 30] : undefined;
    expect(await pixels(page, xs)).toEqual(
      mode === 'holes'
        ? [half, blue, blue, blue]
        : mode === 'siblings'
          ? [half, blue, blue, half]
          : [half, blue, blue, blue],
    );
    await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
    await fire(page, 0);
    await shown(page);
    await tick(page, 1);
    expect(await pixels(page, xs)).toEqual(
      mode === 'reentry'
        ? [blue, blue, blue, blue]
        : mode === 'holes'
          ? [blue, blue, half, blue]
          : [blue, half, blue, blue],
    );
    await expect.poll(async () => (await stats(page)).timers.length).toBe(2);
    await page.getByRole('button', { name: 'Pause mask playback', exact: true }).click();
    await fire(page, 1, true);
    await tick(page, 1);
    expect((await stats(page)).timers.length).toBe(2);
    await play(page);
    await shown(page);
    await tick(page, 1);
    await expect.poll(async () => (await stats(page)).timers.length).toBe(3);
    // A cancelled callback delivered after resume cannot clear the new timer.
    await fire(page, 1, true);
    await fire(page, 2);
    await shown(page);
    await tick(page, 2);
    expect(await pixels(page, xs)).toEqual(
      mode === 'siblings' ? [blue, blue, half, blue] : [blue, blue, blue, blue],
    );
    await expect.poll(async () => (await stats(page)).timers.length).toBe(4);
    await fire(page, 3);
    await shown(page);
    await tick(page, 3);
    expect(await pixels(page, xs)).toEqual(
      mode === 'holes'
        ? [half, blue, blue, blue]
        : mode === 'siblings'
          ? [half, blue, blue, half]
          : [half, blue, blue, blue],
    );
    await page.getByRole('button', { name: 'Close dialog' }).click();
    const before = (await stats(page)).timers.length;
    await fire(page, before - 1, true);
    expect((await stats(page)).timers.length).toBe(before);
    await retired(page);
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const action of [
  'render',
  'step',
  'restart',
  'clear',
  'sourceChoice',
  'target',
  'mode',
  'hide',
  'close',
  'document',
])
  test(`scheduled playback stops on ${action} and stale callbacks cannot advance clocks`, async ({
    page,
  }) => {
    const f = await setup(page);
    await open(page);
    await instrument(page);
    await page.getByLabel('Use stepped mask session').check();
    await play(page);
    await shown(page);
    await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
    if (action === 'render' || action === 'step' || action === 'restart') {
      await page
        .getByRole('button', {
          name:
            action === 'render'
              ? 'Render mask preview'
              : action === 'step'
                ? 'Step mask presentation'
                : 'Restart mask session',
          exact: true,
        })
        .click();
      await shown(page);
    }
    if (action === 'clear')
      await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
    if (action === 'sourceChoice') {
      await page.getByLabel('Mask source layer', { exact: true }).selectOption('other');
      await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
      await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
    }
    if (action === 'target') {
      await page.getByLabel('First mask target layer', { exact: true }).selectOption('');
      await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
    }
    if (action === 'mode') {
      await page.getByLabel('Use stepped mask session').uncheck();
      await page.getByLabel('Use stepped mask session').check();
    }
    if (action === 'hide')
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete (document as unknown as { hidden?: boolean }).hidden;
      });
    if (action === 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
    if (action === 'document')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#00ff00';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await fire(page, 0, true);
    expect((await stats(page)).timers.length).toBe(1);
    expect((await stats(page)).timers[0].cancelled).toBe(true);
    if (action === 'close' || action === 'document') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await retired(page);
      if (action === 'document') {
        expect((await f.read()).background).toBe('#00ff00');
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
      }
      await open(page);
      await page.getByLabel('Use stepped mask session').check();
    }
    await expect(
      page.getByRole('button', { name: 'Play mask preview', exact: true }),
    ).toBeVisible();
    await play(page);
    await shown(page);
    await tick(page, action === 'step' ? 1 : 0);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const hold of ['image', 'font'] as const)
  for (const action of ['pause', 'clear', 'mode', 'close', 'document'])
    test(`in-flight ${hold} playback ${action} rejects late output and resumes the sampled tick`, async ({
      page,
    }) => {
      const f = await setup(page, 'bitmap');
      await open(page);
      await instrument(page, hold);
      await page.getByLabel('Use stepped mask session').check();
      await play(page);
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { maskPlay: PlaybackProbe }).maskPlay.held),
        )
        .toBe(true);
      await tick(page, 0);
      expect((await stats(page)).timers).toEqual([]);
      if (action === 'pause')
        await page.getByRole('button', { name: 'Pause mask playback', exact: true }).click();
      if (action === 'clear')
        await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
      if (action === 'mode') {
        await page.getByLabel('Use stepped mask session').uncheck();
        await page.getByLabel('Use stepped mask session').check();
      }
      if (action === 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
      if (action === 'document')
        await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
          e.value = '#00ff00';
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      await page.evaluate(() =>
        (window as unknown as { maskPlay: PlaybackProbe }).maskPlay.release(),
      );
      await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
      expect((await stats(page)).timers).toEqual([]);
      const retiredBank = action === 'clear' || action === 'close' || action === 'document';
      if (hold === 'image' && retiredBank)
        await expect.poll(async () => (await stats(page)).closes).toBe(1);
      if (action === 'close' || action === 'document') {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        if (action === 'document') {
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
        }
        await open(page);
        await page.getByLabel('Use stepped mask session').check();
      }
      await play(page);
      await shown(page);
      await tick(page, 0);
      expect((await stats(page)).decodes).toBe(hold === 'image' && retiredBank ? 2 : 1);
      expect((await stats(page)).loads).toBe(retiredBank ? 2 : 1);
      await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
      await fire(page, 0);
      await shown(page);
      await tick(page, 1);
      expect(await pixels(page, [5, 15, 25, 35])).toEqual([blue, half, half, blue]);
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await retired(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const change of ['pause', 'resume', 'clear', 'mode', 'close', 'document'])
  test(`complete playback raster rejects late ${change} before display or scheduling`, async ({
    page,
  }) => {
    const f = await setup(page, 'bitmap');
    await open(page);
    await instrument(page);
    await page.getByLabel('Use stepped mask session').check();
    await play(page);
    await shown(page);
    await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
    await page.evaluate((change) => {
      const create = document.createElement.bind(document),
        draw = CanvasRenderingContext2D.prototype.drawImage;
      let output: HTMLCanvasElement | undefined,
        hit = false;
      document.createElement = ((...args: Parameters<typeof document.createElement>) => {
        const e = create(...args);
        if (args[0] === 'canvas' && !output) output = e as HTMLCanvasElement;
        return e;
      }) as typeof document.createElement;
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        Reflect.apply(draw, this, args);
        if (hit || this.canvas !== output) return;
        hit = true;
        Object.assign(window, { maskPlayLateHook: true });
        const button = (name: string) => {
          const b = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === name,
          );
          if (!b) throw Error('Missing actual ' + name);
          b.click();
          return b;
        };
        if (change === 'pause' || change === 'resume') {
          const toggle = button('Pause mask playback');
          // Both native events occur before Svelte flushes its button label.
          if (change === 'resume') toggle.click();
        }
        if (change === 'clear') button('Clear mask preview');
        if (change === 'close') button('×');
        if (change === 'mode') {
          const c = document.querySelector(
            '[aria-label="Use stepped mask session"]',
          ) as HTMLInputElement;
          c.checked = false;
          c.dispatchEvent(new Event('change', { bubbles: true }));
          c.checked = true;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (change === 'document') {
          const c = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
          c.value = '#00ff00';
          c.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } as typeof draw;
    }, change);
    await fire(page, 0);
    expect(
      await page.evaluate(
        () => (window as unknown as { maskPlayLateHook: boolean }).maskPlayLateHook,
      ),
    ).toBe(true);
    if (change === 'resume') {
      await shown(page);
      await tick(page, 1);
    } else await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
    await expect
      .poll(async () => (await stats(page)).timers.length)
      .toBe(change === 'resume' ? 2 : 1);
    // Re-delivering the retired callback cannot override a resumed timer/job.
    await fire(page, 0, true);
    expect((await stats(page)).timers.length).toBe(change === 'resume' ? 2 : 1);
    if (change === 'document' || change === 'close') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (change === 'document') {
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
      }
      await open(page);
      await page.getByLabel('Use stepped mask session').check();
    }
    if (change !== 'resume') await play(page);
    await shown(page);
    await tick(page, change === 'mode' || change === 'document' || change === 'close' ? 0 : 1);
    expect(await pixels(page, [5, 15, 25, 35])).toEqual(
      change === 'mode' || change === 'document' || change === 'close'
        ? [half, half, blue, blue]
        : [blue, half, half, blue],
    );
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await retired(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('slow readiness schedules one full new interval, reuses native resources and never catches up', async ({
  page,
}) => {
  const f = await setup(page, 'bitmap');
  await open(page);
  await instrument(page, 'image');
  await page.getByLabel('Use stepped mask session').check();
  await play(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { maskPlay: PlaybackProbe }).maskPlay.held),
    )
    .toBe(true);
  await page.evaluate(() => {
    const p = (window as unknown as { maskPlay: PlaybackProbe }).maskPlay;
    p.advanceTime();
    p.release();
  });
  await shown(page);
  await tick(page, 0);
  await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
  expect((await stats(page)).timers[0].delay).toBe(500);
  await fire(page, 0);
  await shown(page);
  await tick(page, 1);
  expect((await stats(page)).decodes).toBe(1);
  expect((await stats(page)).loads).toBe(1);
  await expect.poll(async () => (await stats(page)).timers.length).toBe(2);
  expect((await stats(page)).timers[1].delay).toBeGreaterThan(0);
  expect((await stats(page)).timers[1].delay).toBeLessThanOrEqual(500);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect((await stats(page)).closes).toBe(1);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('native timer playback advances, pauses without further ticks and keeps cached resources', async ({
  page,
}) => {
  const f = await setup(page, 'bitmap');
  await open(page);
  await instrument(page, 'none', false);
  await page.getByLabel('Use stepped mask session').check();
  await play(page);
  await expect
    .poll(async () => (await stats(page)).timers.filter((t) => t.fired).length)
    .toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Pause mask playback', exact: true }).click();
  const text = await page.getByLabel('Mask presentation tick', { exact: true }).textContent(),
    count = (await stats(page)).timers.length;
  await page.waitForTimeout(650);
  expect(await page.getByLabel('Mask presentation tick', { exact: true }).textContent()).toBe(text);
  expect((await stats(page)).timers.length).toBe(count);
  expect((await stats(page)).decodes).toBe(1);
  expect((await stats(page)).loads).toBe(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await retired(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('reopening playback retires each visibility listener and scheduled callback', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const add = EventTarget.prototype.addEventListener,
      remove = EventTarget.prototype.removeEventListener,
      live = new Set<EventListenerOrEventListenerObject>();
    let added = 0,
      removed = 0;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === document && type === 'visibilitychange' && listener) {
        live.add(listener);
        added++;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this === document && type === 'visibilitychange' && listener) {
        live.delete(listener);
        removed++;
      }
      return remove.call(this, type, listener, options);
    };
    Object.assign(window, { maskVisibilityCounts: () => ({ live: live.size, added, removed }) });
  });
  for (let i = 0; i < 3; i++) {
    await open(page);
    if (!i) await instrument(page);
    await page.getByLabel('Use stepped mask session').check();
    await play(page);
    await shown(page);
    await expect.poll(async () => (await stats(page)).timers.length).toBe(i + 1);
    expect(
      await page.evaluate(() =>
        (window as unknown as { maskVisibilityCounts: () => unknown }).maskVisibilityCounts(),
      ),
    ).toEqual({ live: 1, added: i + 1, removed: i });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(
      await page.evaluate(() =>
        (window as unknown as { maskVisibilityCounts: () => unknown }).maskVisibilityCounts(),
      ),
    ).toEqual({ live: 0, added: i + 1, removed: i + 1 });
    await fire(page, i, true);
    expect((await stats(page)).timers.length).toBe(i + 1);
    await retired(page);
  }
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('pause during detached clock math retains its successful sampled phase for same-tick resume', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await instrument(page);
  await page.getByLabel('Use stepped mask session').check();
  await play(page);
  await shown(page);
  await expect.poll(async () => (await stats(page)).timers.length).toBe(1);
  await page.evaluate(() => {
    const clone = structuredClone;
    let hit = false;
    window.structuredClone = ((value: unknown, ...args: unknown[]) => {
      const result = Reflect.apply(clone, window, [value, ...args]);
      if (
        !hit &&
        value &&
        typeof value === 'object' &&
        'signature' in value &&
        'layers' in value &&
        'frame' in value
      ) {
        hit = true;
        Object.assign(window, { maskPlayMathHook: true });
        const pause = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Pause mask playback',
        );
        if (!pause) throw Error('Missing actual Pause');
        pause.click();
      }
      return result;
    }) as typeof structuredClone;
  });
  await fire(page, 0);
  expect(
    await page.evaluate(
      () => (window as unknown as { maskPlayMathHook: boolean }).maskPlayMathHook,
    ),
  ).toBe(true);
  await tick(page, 1);
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText(
    'sampled tick is retained',
  );
  expect((await stats(page)).timers.length).toBe(1);
  await play(page);
  await shown(page);
  await tick(page, 1);
  expect(await pixels(page)).toEqual([blue, half, blue, blue]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await retired(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
