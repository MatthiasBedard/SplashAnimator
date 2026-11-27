import { test, expect, type Page } from '@playwright/test';
import { newLayer, validateProject, type Project } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { layerPresentationMaskFixture } from '../layer-presentation-fixture';

function fixture(mode = 'button') {
  const p = layerPresentationMaskFixture(),
    leaf = p.symbols![0];
  p.layers.splice(1, 0, {
    ...newLayer('Second target'),
    id: 'second',
    keys: [{ frame: 0, shapes: [] }],
  });
  p.layers.push({ ...newLayer('Other source'), id: 'other', keys: [{ frame: 0, shapes: [] }] });
  const mask = p.layers.find((l) => l.id === 'mask')!;
  if (mode === 'movie' || mode === 'graphic' || mode === 'start')
    mask.keys[0].shapes = [
      {
        ...symbolInstance(leaf, 0, 0),
        id: 'movie',
        opacity: 0.5,
        symbolPlayback: { mode: mode === 'movie' ? 'movie' : 'loop', firstFrame: 0 },
      },
    ];
  if (mode === 'graphic' || mode === 'opacity') p.duration = 3;
  if (mode === 'start') p.duration = 5;
  if (mode === 'mixed')
    mask.keys[0].shapes.push({
      ...symbolInstance(leaf, 40, 0),
      id: 'root-movie',
      opacity: 0.5,
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    });
  if (mode === 'opacity')
    p.opacityBindings = [
      {
        layerId: 'mask',
        shapeId: 'button',
        start: 0,
        end: 2,
        keys: [
          { frame: 0, opacity: 0.25 },
          { frame: 1, opacity: 0.75 },
          { frame: 2, opacity: 0.5 },
        ],
      },
    ];
  if (mode === 'reentry') {
    p.duration = 4;
    mask.keys.push(
      { frame: 1, shapes: [] },
      { frame: 3, shapes: structuredClone(mask.keys[0].shapes) },
    );
  }
  if (mode === 'holes')
    for (const key of [{ frame: 0, shapes: leaf.shapes }, ...leaf.timeline!.keys])
      for (const shape of key.shapes) {
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
  if (mode === 'folders') {
    p.folders = [{ id: 'foreign', name: 'Foreign' }];
    p.layers.unshift({
      ...newLayer('Foreign'),
      id: 'foreign',
      folderId: 'foreign',
      keys: [{ frame: 0, shapes: [] }],
    });
  }
  validateProject(p);
  return p;
}
async function setup(page: Page, mode = 'button') {
  const p = fixture(mode),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('mask-session-seed')) {
      sessionStorage.setItem('mask-session-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, read, errors };
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layer mask…', exact: true }).click();
  await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
  await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
}
async function render(page: Page) {
  await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
}
async function step(page: Page) {
  await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
}
const blue = [0, 0, 255, 255],
  half = [128, 0, 127, 255];
async function pixels(page: Page, xs = [5, 25, 45, 65]) {
  return page
    .locator('canvas[aria-label="Layer mask preview"]')
    .evaluate(
      (c: HTMLCanvasElement, xs) =>
        xs.map((x) => Array.from(c.getContext('2d')!.getImageData(x, 20, 1, 1).data)),
      xs,
    );
}
async function tick(page: Page, n: number, frame = 1) {
  await expect(page.getByLabel('Mask presentation tick', { exact: true })).toContainText(
    `Tick ${n} · Frame ${frame}`,
  );
}

for (const mode of ['button', 'movie', 'graphic', 'mixed', 'opacity', 'reentry'])
  test(`actual ${mode} mask session steps exact movies/ages and restarts without edits`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await open(page);
    await expect(page.getByLabel('Use stepped mask session')).not.toBeChecked();
    await page.getByLabel('Use stepped mask session').check();
    await render(page);
    await tick(page, 0);
    expect(await pixels(page)).toEqual(
      mode === 'opacity'
        ? [[64, 0, 191, 255], blue, blue, blue]
        : mode === 'mixed'
          ? [half, blue, blue, half]
          : [half, blue, blue, blue],
    );
    await step(page);
    await tick(page, 1, mode === 'graphic' || mode === 'opacity' || mode === 'reentry' ? 2 : 1);
    const second = await pixels(page);
    expect(second).toEqual(
      mode === 'reentry'
        ? [blue, blue, blue, blue]
        : mode === 'opacity'
          ? [blue, [191, 0, 64, 255], blue, blue]
          : [blue, half, blue, blue],
    );
    await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
    await render(page);
    expect(await pixels(page)).toEqual(second);
    await step(page);
    expect(await pixels(page)).toEqual(
      mode === 'mixed' ? [blue, blue, half, blue] : [blue, blue, blue, blue],
    );
    await step(page);
    expect(await pixels(page)).toEqual(
      mode === 'opacity'
        ? [[64, 0, 191, 255], blue, blue, blue]
        : mode === 'mixed'
          ? [half, blue, blue, half]
          : [half, blue, blue, blue],
    );
    await page.getByRole('button', { name: 'Restart mask session', exact: true }).click();
    await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
    await tick(page, 0);
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('captured editor frame and graphic age stay separate from local presentation ticks', async ({
  page,
}) => {
  const f = await setup(page, 'start');
  await page.getByLabel('Timeline frames').click({ position: { x: 45, y: 40 } });
  await open(page);
  await page.getByLabel('Use stepped mask session').check();
  await render(page);
  await tick(page, 0, 3);
  expect(await pixels(page)).toEqual([blue, blue, blue, blue]);
  await step(page);
  await tick(page, 1, 4);
  expect(await pixels(page)).toEqual([half, blue, blue, blue]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('3');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('moving contour holes retain alpha and fixed default mode remains independent', async ({
  page,
}) => {
  const f = await setup(page, 'holes');
  await open(page);
  await render(page);
  expect(await pixels(page, [2, 10, 22, 30])).toEqual([half, blue, blue, blue]);
  await page.getByLabel('Use stepped mask session').check();
  await render(page);
  await step(page);
  expect(await pixels(page, [2, 10, 22, 30])).toEqual([blue, blue, half, blue]);
  await page.getByLabel('Use stepped mask session').uncheck();
  await render(page);
  expect(await pixels(page, [2, 10, 22, 30])).toEqual([half, blue, blue, blue]);
  await page.getByLabel('Use stepped mask session').check();
  await render(page);
  await tick(page, 0);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

async function holdFonts(page: Page) {
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(document.fonts),
        'ready',
      )!,
      ready = document.fonts.ready;
    let release!: () => void;
    const held = new Promise<FontFaceSet>((r) => {
      release = () => void ready.then(r);
    });
    Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => held });
    Object.assign(window, {
      releaseMaskSessionFonts: () => {
        Object.defineProperty(document.fonts, 'ready', descriptor);
        release();
      },
    });
  });
}
async function releaseFonts(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { releaseMaskSessionFonts: () => void }).releaseMaskSessionFonts(),
  );
}

test('forged cross-folder target rejects before consuming a presentation tick', async ({
  page,
}) => {
  const f = await setup(page, 'folders');
  await open(page);
  await page.getByLabel('Use stepped mask session').check();
  await render(page);
  await tick(page, 0);
  const first = page.getByLabel('First mask target layer', { exact: true });
  await expect(first.locator('option[value="foreign"]')).toHaveCount(0);
  await first.evaluate((e: HTMLSelectElement) => {
    e.add(new Option('Forged foreign choice', 'foreign'));
    e.value = 'foreign';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
  await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText('same folder');
  await tick(page, 0);
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  await first.selectOption('target');
  await step(page);
  await tick(page, 1);
  expect(await pixels(page)).toEqual([blue, half, blue, blue]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('step/render/clear/close dispose every prior raster while keeping a valid cached tick', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await page.getByLabel('Use stepped mask session').check();
  await page.evaluate(() => {
    const create = document.createElement.bind(document),
      canvases: HTMLCanvasElement[] = [];
    document.createElement = ((...args: Parameters<typeof document.createElement>) => {
      const e = create(...args);
      if (args[0] === 'canvas') canvases.push(e as HTMLCanvasElement);
      return e;
    }) as typeof document.createElement;
    Object.assign(window, { maskSessionCanvases: canvases });
  });
  await render(page);
  await step(page);
  await render(page);
  await tick(page, 1);
  const sizes = () =>
    page.evaluate(() =>
      (window as unknown as { maskSessionCanvases: HTMLCanvasElement[] }).maskSessionCanvases.map(
        (c) => [c.width, c.height],
      ),
    );
  expect(await sizes()).toEqual([...Array(8).fill([0, 0]), ...Array(4).fill([80, 40])]);
  await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
  expect(await sizes()).toEqual(Array(12).fill([0, 0]));
  await render(page);
  await tick(page, 1);
  expect(await pixels(page)).toEqual([blue, half, blue, blue]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await sizes()).toEqual(Array(16).fill([0, 0]));
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('choice cancellation after detached clock math retains the actual successful session tick', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await page.getByLabel('Use stepped mask session').check();
  await render(page);
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
        Object.assign(window, { maskMathChoiceHook: true });
        const input = document.querySelector(
          '[aria-label="First mask target layer"]',
        ) as HTMLSelectElement;
        input.value = 'second';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return result;
    }) as typeof structuredClone;
  });
  await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { maskMathChoiceHook: boolean }).maskMathChoiceHook,
    ),
  ).toBe(true);
  await tick(page, 1);
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  await page.getByLabel('First mask target layer').selectOption('target');
  await render(page);
  await tick(page, 1);
  expect(await pixels(page)).toEqual([blue, half, blue, blue]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const change of [
  'clear',
  'source',
  'target',
  'restoredMode',
  'restart',
  'step',
  'close',
  'document',
])
  test(`pending stepped mask rejects ${change} and retries its owned tick`, async ({ page }) => {
    const f = await setup(page);
    await open(page);
    await page.getByLabel('Use stepped mask session').check();
    await render(page);
    await holdFonts(page);
    await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
    await tick(page, 1);
    if (change === 'clear')
      await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
    if (change === 'source') {
      await page.getByLabel('Mask source layer').selectOption('other');
      await page.getByLabel('Mask source layer').selectOption('mask');
      await page.getByLabel('First mask target layer').selectOption('target');
    }
    if (change === 'target') {
      await page.getByLabel('First mask target layer').selectOption('second');
      await page.getByLabel('First mask target layer').selectOption('target');
    }
    if (change === 'restoredMode') {
      await page.getByLabel('Use stepped mask session').uncheck();
      await page.getByLabel('Use stepped mask session').check();
    }
    if (change === 'restart')
      await page.getByRole('button', { name: 'Restart mask session', exact: true }).click();
    if (change === 'step')
      await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
    if (change === 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
    if (change === 'document')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#00ff00';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await releaseFonts(page);
    if (change === 'restart' || change === 'step')
      await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
    else await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
    if (change === 'document') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await f.read()).background).toBe('#00ff00');
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    }
    if (change === 'document' || change === 'close') {
      await open(page);
      await page.getByLabel('Use stepped mask session').check();
    }
    await render(page);
    const expected =
      change === 'restart' ||
      change === 'restoredMode' ||
      change === 'close' ||
      change === 'document'
        ? 0
        : change === 'step'
          ? 2
          : 1;
    await tick(page, expected);
    expect(await pixels(page)).toEqual(
      expected === 0
        ? [half, blue, blue, blue]
        : expected === 1
          ? [blue, half, blue, blue]
          : [blue, blue, blue, blue],
    );
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const change of ['step', 'restart', 'restoredMode', 'close', 'document'])
  test(`complete stepped raster rejects late ${change} before display`, async ({ page }) => {
    const f = await setup(page);
    await open(page);
    await page.getByLabel('Use stepped mask session').check();
    await render(page);
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
        Object.assign(window, { maskSessionLateHook: true });
        const button = (name: string) => {
          const b = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === name,
          );
          if (!b) throw Error('Missing actual ' + name);
          b.click();
        };
        if (change === 'step') button('Step mask presentation');
        if (change === 'restart') button('Restart mask session');
        if (change === 'close') button('×');
        if (change === 'restoredMode') {
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
    await page.getByRole('button', { name: 'Step mask presentation', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { maskSessionLateHook: boolean }).maskSessionLateHook,
      ),
    ).toBe(true);
    if (change === 'step' || change === 'restart') {
      await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
      await tick(page, change === 'step' ? 2 : 0);
      expect(await pixels(page)).toEqual(
        change === 'step' ? [blue, blue, blue, blue] : [half, blue, blue, blue],
      );
    } else await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
    if (change === 'document') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    }
    if (change === 'document' || change === 'close') {
      await open(page);
      await page.getByLabel('Use stepped mask session').check();
    }
    await render(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
