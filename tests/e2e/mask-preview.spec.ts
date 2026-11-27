import { test, expect, type Page } from '@playwright/test';
import {
  newProject,
  newLayer,
  validateProject,
  type Project,
  type Vector,
} from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

function rect(id: string, fill: string, x = 0, width = 80, opacity = 1): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y: 0,
    width,
    height: 60,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    opacity,
  };
}
function fixture(mode = 'plain') {
  const p = newProject();
  p.width = 80;
  p.height = 60;
  p.background = '#0000ff';
  p.duration = 8;
  if (mode === 'scripts')
    p.frameScripts = [
      { frame: 0, source: "throw new Error('Mask previews must remain script-free');" },
    ];
  if (mode === 'oversize') {
    p.width = 4097;
    p.height = 4097;
  }
  let mask: Vector = rect('coverage', '#ffffff', 0, 40, 0.5);
  if (mode === 'holes')
    mask = {
      ...mask,
      kind: 'polygon',
      opacity: 1,
      fillRule: 'evenodd',
      points: [],
      contours: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 60 },
          { x: 0, y: 60 },
        ],
        [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 40 },
          { x: 10, y: 40 },
        ],
      ],
    };
  if (mode === 'nested' || mode === 'button' || mode === 'movie') {
    const inner = {
      id: 'inner',
      name: 'Inner',
      width: 80,
      height: 60,
      shapes: [{ ...mask, opacity: 1 }],
    };
    const outer = {
      id: 'outer',
      name: 'Outer',
      width: 80,
      height: 60,
      shapes: [symbolInstance(inner, 0, 0)],
      ...(mode === 'button'
        ? {
            shapes: [rect('outside', '#ffffff', 100, 1)],
            timeline: { duration: 2, keys: [{ frame: 1, shapes: [symbolInstance(inner, 0, 0)] }] },
            buttonStates: { up: 1, over: 0, down: 0, hit: 0 },
          }
        : {}),
    };
    p.symbols = [inner, outer];
    mask = {
      ...symbolInstance(outer, 0, 0),
      opacity: 0.5,
      ...(mode === 'movie' ? { symbolPlayback: { mode: 'movie' as const, firstFrame: 0 } } : {}),
    };
  }
  p.layers = [
    ['target', [rect('red', '#ff0000')]],
    ['second', [rect('green', '#00ff00', 20, 20, 0.5)]],
    ['mask', [mask]],
    ['over', [{ ...rect('over', '#ffff00', 70, 10), height: 10 }]],
  ].map(([id, shapes]) => ({
    ...newLayer(id as string),
    id: id as string,
    keys: [{ frame: 0, shapes: shapes as Vector[] }],
  }));
  if (mode === 'hidden') p.layers[2].visible = false;
  if (mode === 'empty') p.layers[2].keys[0].shapes = [];
  if (mode === 'folders') {
    p.folders = [{ id: 'other', name: 'Other' }];
    p.layers[0].folderId = 'other';
  }
  if (mode === 'opacity')
    p.opacityBindings = [
      {
        layerId: 'mask',
        shapeId: mask.id,
        start: 0,
        end: 7,
        keys: [
          { frame: 0, opacity: 0.25 },
          { frame: 7, opacity: 0.25 },
        ],
      },
    ];
  return p;
}
async function setup(page: Page, mode = 'plain') {
  const p = fixture(mode),
    errors: string[] = [];
  if (mode === 'bitmap') {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 60;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 40, 60);
      return c.toDataURL();
    });
    p.assets = [
      {
        id: 'image',
        path: 'assets/bitmaps/image.json',
        bitmap: { name: 'Mask image', width: 80, height: 60, dataUrl },
      },
    ];
    p.layers[2].keys[0].shapes = [
      {
        ...p.layers[2].keys[0].shapes[0],
        width: 80,
        bitmap: { assetId: 'image', x: 0, y: 0, width: 80, height: 60 },
      },
    ];
  }
  validateProject(p);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('mask-preview-seeded')) {
      sessionStorage.setItem('mask-preview-seeded', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
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
  await expect(page.getByRole('dialog', { name: 'Preview layer mask', exact: true })).toBeVisible();
}
async function choose(page: Page) {
  await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
  await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
}
async function render(page: Page) {
  await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
}

test('closing while bitmap decoding is pending closes the late owned image once', async ({
  page,
}) => {
  const f = await setup(page, 'bitmap');
  await open(page);
  await choose(page);
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    let release!: () => void;
    Object.assign(window, { maskDecoded: false, maskImageCloses: 0 });
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      const result = Reflect.apply(decode, window, args) as Promise<ImageBitmap>;
      return new Promise<ImageBitmap>((resolve, reject) => {
        result.then((image) => {
          const close = image.close.bind(image);
          image.close = () => {
            (window as unknown as { maskImageCloses: number }).maskImageCloses++;
            close();
          };
          release = () => resolve(image);
          Object.assign(window, { maskDecoded: true });
        }, reject);
      });
    }) as typeof createImageBitmap;
    Object.assign(window, {
      releaseMaskImage: () => {
        window.createImageBitmap = decode;
        release();
      },
    });
  });
  await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { maskDecoded: boolean }).maskDecoded))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
  await page.evaluate(() =>
    (window as unknown as { releaseMaskImage: () => void }).releaseMaskImage(),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { maskImageCloses: number }).maskImageCloses),
    )
    .toBe(1);
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await open(page);
  await choose(page);
  await render(page);
  expect(f.errors).toEqual([]);
});
async function pixels(page: Page) {
  return page
    .locator('canvas[aria-label="Layer mask preview"]')
    .evaluate((c: HTMLCanvasElement) =>
      [5, 15, 25, 50, 75].map((x) =>
        Array.from(c.getContext('2d')!.getImageData(x, 20, 1, 1).data),
      ),
    );
}

test('oversized preview rejects before allocating raster canvases and preserves the document', async ({
  page,
}) => {
  const f = await setup(page, 'oversize');
  await open(page);
  await choose(page);
  await page.evaluate(() => {
    const create = document.createElement.bind(document);
    Object.assign(window, { maskAllocations: 0 });
    document.createElement = ((...args: Parameters<typeof document.createElement>) => {
      if (args[0] === 'canvas')
        (window as unknown as { maskAllocations: number }).maskAllocations++;
      return create(...args);
    }) as typeof document.createElement;
  });
  await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('64-megapixel budget');
  expect(
    await page.evaluate(() => (window as unknown as { maskAllocations: number }).maskAllocations),
  ).toBe(0);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('mask entry preserves pending Brush ownership and is available after worker completion', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const c = page.getByLabel('Drawing stage'),
    box = (await c.boundingBox())!;
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Preview layer mask…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Preview layer mask…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Preview layer mask…', exact: true }).click();
  await choose(page);
  await render(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await c.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of [
  'plain',
  'holes',
  'nested',
  'button',
  'movie',
  'hidden',
  'empty',
  'scripts',
  'bitmap',
])
  test(`actual mask preview ${mode} preserves artwork and history`, async ({ page }) => {
    const f = await setup(page, mode);
    await open(page);
    await choose(page);
    await render(page);
    const out = await pixels(page),
      half = mode !== 'holes' && mode !== 'hidden' && mode !== 'empty';
    expect(out[0]).toEqual(
      mode === 'hidden' || mode === 'empty'
        ? [0, 0, 255, 255]
        : half
          ? [128, 0, 127, 255]
          : [255, 0, 0, 255],
    );
    expect(out[1]).toEqual(
      mode === 'holes' || mode === 'hidden' || mode === 'empty'
        ? [0, 0, 255, 255]
        : [128, 0, 127, 255],
    );
    expect(out[3]).toEqual([0, 0, 255, 255]);
    if (half)
      out[2].forEach((n, i) => expect(Math.abs(n - [64, 64, 127, 255][i])).toBeLessThanOrEqual(1));
    expect(
      await page
        .locator('canvas[aria-label="Layer mask preview"]')
        .evaluate((c: HTMLCanvasElement) =>
          Array.from(c.getContext('2d')!.getImageData(75, 5, 1, 1).data),
        ),
    ).toEqual([255, 255, 0, 255]);
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('saved opacity presentation enters the mask without changing authored opacity', async ({
  page,
}) => {
  const f = await setup(page, 'opacity');
  await open(page);
  await choose(page);
  await render(page);
  expect((await pixels(page))[0]).toEqual([64, 0, 191, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const change of ['clear', 'close'])
  test(`completed preview ${change} releases all four owned canvases`, async ({ page }) => {
    const f = await setup(page);
    await open(page);
    await choose(page);
    await page.evaluate(() => {
      const create = document.createElement.bind(document),
        canvases: HTMLCanvasElement[] = [];
      document.createElement = ((...args: Parameters<typeof document.createElement>) => {
        const e = create(...args);
        if (args[0] === 'canvas') canvases.push(e as HTMLCanvasElement);
        return e;
      }) as typeof document.createElement;
      Object.assign(window, { maskCanvases: canvases });
    });
    await render(page);
    expect(
      await page.evaluate(() =>
        (window as unknown as { maskCanvases: HTMLCanvasElement[] }).maskCanvases.map((c) => [
          c.width,
          c.height,
        ]),
      ),
    ).toEqual([
      [80, 60],
      [80, 60],
      [80, 60],
      [80, 60],
    ]);
    await page
      .getByRole('button', {
        name: change === 'clear' ? 'Clear mask preview' : 'Close dialog',
        exact: true,
      })
      .click();
    expect(
      await page.evaluate(() =>
        (window as unknown as { maskCanvases: HTMLCanvasElement[] }).maskCanvases.map((c) => [
          c.width,
          c.height,
        ]),
      ),
    ).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const change of ['source', 'first', 'restored', 'close', 'document', 'frame', 'restoredFrame'])
  test(`complete detached raster rejects late ${change} before display`, async ({ page }) => {
    const f = await setup(page);
    if (change === 'frame' || change === 'restoredFrame')
      await page.getByLabel('Timeline frames').click({ position: { x: 9, y: 40 } });
    await open(page);
    await choose(page);
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
        Object.assign(window, { maskLateHook: true });
        if (change === 'frame' || change === 'restoredFrame') {
          const next = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Next frame',
          )!;
          next.click();
          if (change === 'restoredFrame')
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent?.trim() === 'Previous frame')!
              .click();
          return;
        }
        if (change === 'close') {
          (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          return;
        }
        if (change === 'document') {
          const input = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
          input.value = '#00ff00';
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        const select = document.querySelector(
          `[aria-label="${change === 'first' ? 'First mask target layer' : 'Mask source layer'}"]`,
        ) as HTMLSelectElement;
        select.value = change === 'first' ? 'second' : 'over';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (change === 'restored') {
          select.value = 'mask';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } as typeof draw;
    }, change);
    await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { maskLateHook?: boolean }).maskLateHook),
    ).toBe(true);
    await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
    if (change === 'document') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await f.read()).background).toBe('#00ff00');
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    } else if (change === 'frame' || change === 'restoredFrame') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue(
        change === 'frame' ? '2' : '1',
      );
    } else if (change !== 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(await f.read()).toEqual(f.p);
    await open(page);
    await choose(page);
    await render(page);
    expect(f.errors).toEqual([]);
  });

test('target runs are explicit and folder-scoped; changes clear completed proposals', async ({
  page,
}) => {
  const f = await setup(page, 'folders');
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview layer mask', exact: true });
  const source = dialog.getByLabel('Mask source layer', { exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(source).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('checkbox', { name: 'Use stepped mask session', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await source.selectOption('mask');
  await expect(
    page.getByLabel('First mask target layer').locator('option[value="target"]'),
  ).toHaveCount(0);
  await page.getByLabel('First mask target layer').selectOption('second');
  const renderAction = dialog.getByRole('button', { name: 'Render mask preview', exact: true });
  await renderAction.press('Enter');
  await expect(renderAction).toBeFocused();
  expect((await pixels(page))[0]).toEqual([255, 0, 0, 255]);
  await page.getByLabel('Mask source layer').selectOption('over');
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const change of ['source', 'first', 'close', 'restart', 'document'])
  test(`pending font readiness rejects ${change} and cleans owned resources`, async ({ page }) => {
    const f = await setup(page);
    await open(page);
    await choose(page);
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(document.fonts),
        'ready',
      )!;
      const ready = document.fonts.ready;
      let release!: () => void;
      const held = new Promise<FontFaceSet>((r) => {
        release = () => void ready.then(r);
      });
      Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => held });
      Object.assign(window, {
        releaseMaskFonts: () => {
          Object.defineProperty(document.fonts, 'ready', original);
          release();
        },
      });
    });
    await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restart mask preview' })).toBeVisible();
    if (change === 'source') await page.getByLabel('Mask source layer').selectOption('over');
    if (change === 'first') await page.getByLabel('First mask target layer').selectOption('second');
    if (change === 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
    if (change === 'restart')
      await page.getByRole('button', { name: 'Restart mask preview' }).click();
    if (change === 'document')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#00ff00';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.evaluate(() =>
      (window as unknown as { releaseMaskFonts: () => void }).releaseMaskFonts(),
    );
    if (change === 'restart')
      await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
    else await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
    if (change === 'document') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await f.read()).background).toBe('#00ff00');
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    } else if (change !== 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(await f.read()).toEqual(f.p);
    await open(page);
    await choose(page);
    await render(page);
    expect(f.errors).toEqual([]);
  });
