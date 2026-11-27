import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { newLayer, type Project } from '../../packages/document/src';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { evaluate } from '../../packages/animation/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
async function setup(page: Page, mode = 'plain') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  let p = liveSplitFixture((p, s) => {
    p.layers[0].name = 'Live';
    p.layers[0].drawingMode = 'object';
    if (mode === 'symbol-root') {
      const definition = {
        id: 'moving-symbol', name: 'Moving symbol', width: 20, height: 20,
        shapes: [{ ...structuredClone(p.layers[0].keys[0].shapes[0]), id: 'child', x: 0, y: 0 }],
      };
      p.symbols = [definition];
      for (const key of p.layers[0].keys.filter(key => key.shapes.length)) {
        const { x, y } = key.shapes[0];
        key.shapes = [{ ...symbolInstance(definition, x, y), id: 'art' }];
      }
      s.symbolContinuity = 'graphics';
    }
    if (mode === 'path') s.path = { startX: 24, startY: 20, endX: -24, endY: 20 };
    if (mode === 'bad') s.path = { startX: 0, startY: 50000000, endX: 0, endY: -50000000 };
    if (mode === 'onion')
      for (const key of p.layers[0].keys.filter((k) => k.shapes.length))
        key.shapes[0].opacity = 0.5;
    if (mode === 'channels') {
      s.options = { paint: true };
      s.paintEase = 'linear';
      p.layers[0].keys[0].shapes[0].fill = '#000000';
      p.layers[0].keys[1].shapes[0].fill = '#808080';
    }
  });
  if (mode === 'independent' || mode === 'foreground') {
    const held = {
      ...structuredClone(p.layers[0]),
      id: 'held',
      name: 'Held',
      liveMotionSpans: undefined,
    };
    held.keys = [
      {
        frame: 0,
        shapes: [
          {
            ...held.keys[0].shapes[0],
            id: 'held-art',
            x: mode === 'foreground' ? 48 : 100,
            fill: '#0000ff',
          },
        ],
      },
    ];
    p.layers.unshift(held);
  }
  if (mode === 'locked') p.layers[0].locked = true;
  if (mode === 'masked') {
    p.layers.push({
      ...newLayer('Mask'), id: 'mask', locked: true,
      keys: [{ frame: 0, shapes: [{
        ...p.layers[0].keys[0].shapes[0], id: 'mask-art', x: 54, y: 0, width: 80, height: 90,
      }] }],
    });
    p.layerMasks = [{ maskLayerId: 'mask', layerIds: ['track'] }];
  }
  if (mode === 'hidden') p.layers[0].visible = false;
  if (mode === 'affine' || mode === 'reflected') {
    p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
    for (const k of p.layers[0].keys.filter((k) => k.shapes.length))
      Object.assign(k.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [mode === 'reflected' ? -1.5 : 1.5, 0.2, 0.4, 1],
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
          ],
        ],
      });
  }
  if (mode === 'bitmap') {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 2, 2);
      return c.toDataURL();
    });
    p.assets = [
      {
        id: 'green',
        path: 'assets/bitmaps/green.json',
        bitmap: { name: 'Green', width: 2, height: 2, dataUrl },
      },
    ];
    for (const k of p.layers[0].keys.filter((k) => k.shapes.length))
      k.shapes[0].bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
  }
  if (mode === 'text')
    for (const k of p.layers[0].keys.filter((k) => k.shapes.length)) {
      const s = k.shapes[0];
      s.kind = 'text';
      s.text = {
        content: 'A',
        font: 'sans-serif',
        size: 18,
        bold: false,
        italic: false,
        align: 'left',
      };
    }
  if (['graphic', 'movie', 'button'].includes(mode)) p = livePresentationFixture(mode);
  if (mode === 'opacity') {
    p = livePresentationFixture();
    p.opacityBindings = [
      {
        layerId: 'graphic',
        shapeId: 'instance',
        start: 1,
        end: 4,
        keys: [
          { frame: 1, opacity: 0.2 },
          { frame: 4, opacity: 0.8 },
        ],
      },
    ];
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-main-seed')) {
      sessionStorage.setItem('live-main-seed', 'yes');
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
async function go(page: Page, n: number) {
  await page.getByTitle('First frame', { exact: true }).click();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.focus();
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
}
async function ready(page: Page) {
  await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (e, { p, x, y }) => {
      const c = e as HTMLCanvasElement,
        dpr = devicePixelRatio;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * dpr,
            c.height / 2 + (y - p.height / 2) * dpr,
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
async function clickPoint(page: Page, p: Project, x: number, y: number) {
  const stage = page.getByLabel('Drawing stage', { exact: true }),
    box = (await stage.boundingBox())!;
  await page.mouse.click(
    box.x + box.width / 2 + x - p.width / 2,
    box.y + box.height / 2 + y - p.height / 2,
  );
}
async function startTweenDrag(page: Page, p: Project, x: number, y: number) {
  const box = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  const from = { x: box.x + box.width / 2 + x - p.width / 2, y: box.y + box.height / 2 + y - p.height / 2 };
  // Turn off snapping for independent document-coordinate assertions.
  await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 22, from.y + 24, { steps: 3 });
  return { from, finish: async () => { await page.mouse.up(); await page.keyboard.up('Alt'); } };
}

for (const { mode, at } of [
  { mode: 'plain', at: 1 },
  { mode: 'plain', at: 4 },
  { mode: 'plain', at: 7 },
  { mode: 'symbol-root', at: 4 },
]) {
  test(`Selection drag creates one live tween key in ${mode} at frame ${at + 1}`, async ({ page }) => {
    const f = await setup(page, mode);
    await go(page, at);
    await ready(page);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    const x = 8 + 10 * at;
    await expect.poll(() => pixel(page, f.p, x + 5, 17)).toEqual([255, 0, 0, 255]);
    const drag = await startTweenDrag(page, f.p, x + 5, 17);
    await expect.poll(() => pixel(page, f.p, x + 27, 41)).toEqual([255, 0, 0, 255]);
    expect(await pixel(page, f.p, x + 5, 17)).toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(f.p);
    await drag.finish();

    await expect.poll(async () => (await f.read()).layers[0].keys.map(key => key.frame)).toEqual([0, at, 8, 10]);
    const edited = await f.read();
    expect(edited.duration).toBe(f.p.duration);
    expect(edited.symbols).toEqual(f.p.symbols);
    const layer = edited.layers[0];
    expect(layer.keys.filter(key => key.frame !== at)).toEqual(f.p.layers[0].keys);
    expect(layer.keys[1].shapes).toEqual([
      {
        ...f.p.layers[0].keys[0].shapes[0], x: x + 22, y: 36,
        ...(mode === 'symbol-root' ? { symbolPlayback: { mode: 'loop', firstFrame: 0 } } : {}),
      },
    ]);
    expect(layer.liveMotionSpans?.map(span => [span.start, span.end])).toEqual(
      [[0, at], [at, 8]].filter(([start, end]) => end - start > 1),
    );
    await expect.poll(() => pixel(page, f.p, x + 27, 41)).toEqual([255, 0, 0, 255]);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(edited);
    expect(f.errors).toEqual([]);
  });
}

test('starting a tween drag and pressing Escape leaves the original frame and history intact', async ({ page }) => {
  const f = await setup(page);
  await go(page, 4);
  await ready(page);
  const drag = await startTweenDrag(page, f.p, 53, 17);
  await expect.poll(() => pixel(page, f.p, 75, 41)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  await drag.finish();
  await expect.poll(() => pixel(page, f.p, 53, 17)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('returning a tween drag to its starting point leaves the original keys intact', async ({ page }) => {
  const f = await setup(page);
  await go(page, 4);
  await ready(page);
  const drag = await startTweenDrag(page, f.p, 53, 17);
  await expect.poll(() => pixel(page, f.p, 75, 41)).toEqual([255, 0, 0, 255]);
  await page.mouse.move(drag.from.x, drag.from.y);
  await drag.finish();
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => pixel(page, f.p, 53, 17)).toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});

test('a locked tween cannot be moved or gain a new key by dragging', async ({ page }) => {
  const f = await setup(page, 'locked');
  await go(page, 4);
  await ready(page);
  const drag = await startTweenDrag(page, f.p, 53, 17);
  await drag.finish();
  expect(await f.read()).toEqual(f.p);
  expect(await pixel(page, f.p, 53, 17)).toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});

test('a masked tween drag starts only on visible artwork and keeps the mask stationary', async ({ page }) => {
  const f = await setup(page, 'masked');
  await go(page, 4);
  await ready(page);
  expect(await pixel(page, f.p, 50, 17)).toEqual([255, 255, 255, 255]);
  expect(await pixel(page, f.p, 58, 17)).toEqual([255, 0, 0, 255]);
  const hidden = await startTweenDrag(page, f.p, 50, 17);
  await hidden.finish();
  expect(await f.read()).toEqual(f.p);
  const visible = await startTweenDrag(page, f.p, 58, 17);
  await expect.poll(() => pixel(page, f.p, 80, 41)).toEqual([255, 0, 0, 255]);
  await visible.finish();
  const edited = await f.read();
  expect(edited.layers[0].keys[1].shapes[0]).toMatchObject({ id: 'art', x: 70, y: 36 });
  expect(edited.layers[1]).toEqual(f.p.layers[1]);
  expect(edited.layerMasks).toEqual(f.p.layerMasks);
  expect(f.errors).toEqual([]);
});

for (const mode of ['plain', 'channels', 'locked'])
  test(`main ${mode} live interior paints real current pixels with exact source and endpoint recovery`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await go(page, 4);
    await ready(page);
    expect(await pixel(page, f.p, 55, 17)).toEqual(
      mode === 'channels' ? [64, 64, 64, 255] : [255, 0, 0, 255],
    );
    expect(await pixel(page, f.p, 15, 17)).toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(f.p);
    await go(page, 8);
    expect(await pixel(page, f.p, 95, 17)).toEqual(
      mode === 'channels' ? [128, 128, 128, 255] : [255, 0, 0, 255],
    );
    await go(page, 10);
    expect(await pixel(page, f.p, 95, 17)).toEqual([255, 255, 255, 255]);
    expect(f.errors).toEqual([]);
  });
for (const tool of ['Selection', 'Brush', 'Rectangle', 'Subselection'])
  test(`sampled root leaves source and history unchanged on ${tool} click`, async ({ page }) => {
    const f = await setup(page);
    await go(page, 4);
    await ready(page);
    await page.getByRole('button', { name: tool, exact: true }).click();
    await clickPoint(page, f.p, 55, 17);
    await page.getByLabel('Drawing stage').focus();
    for (const key of ['Delete', 'Control+v', 'ArrowRight']) await page.keyboard.press(key);
    expect(await f.read()).toEqual(f.p);
    // F6 is the explicitly authorized Insert key command, not an attempted
    // mutation of public sampled artwork. It now promotes this exact pose.
    await page.keyboard.press('F6');
    const inserted = await f.read();
    expect(inserted.layers[0].keys.map(k => k.frame)).toEqual([0, 4, 8, 10]);
    expect(inserted.layers[0].keys[1].shapes[0].x).toBe(48);
    expect(inserted.layers[0].keys.filter(k => k.frame !== 4)).toEqual(f.p.layers[0].keys);
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await go(page, 0);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('independent authored track stays selectable/movable while live foreground cannot be picked through', async ({
  page,
}) => {
  const f = await setup(page, 'independent');
  await go(page, 4);
  await ready(page);
  const box = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.mouse.move(
    box.x + box.width / 2 + 110 - f.p.width / 2,
    box.y + box.height / 2 + 22 - f.p.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 120 - f.p.width / 2,
    box.y + box.height / 2 + 22 - f.p.height / 2,
    { steps: 3 },
  );
  await page.mouse.up();
  const out = await f.read();
  expect(out.layers[0].keys.at(-1)!.shapes[0].x).toBe(110);
  expect(out.layers[1]).toEqual(f.p.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('foreground sampled artwork blocks picking a hidden authored root behind it', async ({
  page,
}) => {
  const f = await setup(page, 'foreground');
  await go(page, 4);
  await ready(page);
  await clickPoint(page, f.p, 55, 17);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Delete');
  expect(await f.read()).toEqual(f.p);
  await expect(page.locator('.inspector-title strong')).toHaveText('Document');
  expect(f.errors).toEqual([]);
});
test('failed sampled geometry stays blank and allows endpoint and later valid-frame recovery', async ({
  page,
}) => {
  const f = await setup(page, 'bad');
  await go(page, 2);
  await expect(page.getByLabel('Live stage status')).toContainText('shape geometry');
  expect(await pixel(page, f.p, 15, 17)).toEqual([255, 255, 255, 255]);
  await go(page, 4);
  await ready(page);
  expect(await pixel(page, f.p, 55, 17)).toEqual([255, 0, 0, 255]);
  await go(page, 0);
  expect(await pixel(page, f.p, 15, 17)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['bitmap', 'text'])
  test(`actual main live ${mode} waits for native resources and paints real root ink`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await go(page, 4);
    await ready(page);
    if (mode === 'bitmap') expect(await pixel(page, f.p, 55, 17)).toEqual([0, 255, 0, 255]);
    else {
      const count = await page.getByLabel('Drawing stage').evaluate((e, p) => {
        const c = e as HTMLCanvasElement,
          ctx = c.getContext('2d')!,
          d = devicePixelRatio,
          bytes = ctx.getImageData(
            c.width / 2 + (48 - p.width / 2) * d,
            c.height / 2 + (5 - p.height / 2) * d,
            30 * d,
            35 * d,
          ).data;
        let ink = 0;
        for (let i = 0; i < bytes.length; i += 4)
          if (bytes[i + 1] < 100 && bytes[i + 2] < 100) ink++;
        return ink;
      }, f.p);
      expect(count).toBeGreaterThan(20);
    }
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const mode of ['graphic', 'movie', 'button'])
  test(`ordinary live painting keeps existing outside ${mode} stage clock origins`, async ({
    page,
  }) => {
    const f = await setup(page, mode),
      blue = evaluate(f.p, 2).find((s) => s.fill === '#0000ff')!;
    await go(page, 2);
    await ready(page);
    expect(await pixel(page, f.p, 45, 5)).toEqual([255, 0, 0, 255]);
    expect(await pixel(page, f.p, blue.x + 5, blue.y + 5)).toEqual([0, 0, 255, 255]);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('fresh endpoint edits immediately update live poses and remain independently undoable', async ({
  page,
}) => {
  const f = await setup(page);
  await go(page, 8);
  await clickPoint(page, f.p, 95, 17);
  await page.getByLabel('Shape X', { exact: true }).fill('128');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await go(page, 4);
  await ready(page);
  expect(await pixel(page, f.p, 75, 17)).toEqual([255, 0, 0, 255]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await ready(page);
  expect(await f.read()).toEqual(f.p);
  expect(await pixel(page, f.p, 55, 17)).toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});
test('explicit sparse insertion turns the displayed live pose into an editable selected key', async ({
  page,
}) => {
  const f = await setup(page);
  await go(page, 4);
  await ready(page);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Insert live tween key…', exact: true }).click();
  await page.getByRole('button', { name: 'Insert preserved live key', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('48');
  await page.getByLabel('Shape X', { exact: true }).fill('58');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await go(page, 2);
  await ready(page);
  expect(await pixel(page, f.p, 40, 17)).toEqual([255, 0, 0, 255]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('hidden live roots do not create held artwork or block another authored track', async ({
  page,
}) => {
  const f = await setup(page, 'hidden');
  await go(page, 4);
  expect(await pixel(page, f.p, 55, 17)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const kind of ['font', 'bitmap'])
  for (const action of ['frame', 'restored', 'source'])
    test(`pending main ${kind} ${action} cannot publish stale pixels and fresh capture recovers`, async ({
      page,
    }) => {
      const f = await setup(page, kind === 'font' ? 'text' : 'bitmap');
      await page.evaluate((kind) => {
        const w = window as unknown as { mainHeld: boolean; mainRelease?: () => void };
        w.mainHeld = false;
        if (kind === 'font') {
          const fonts = document.fonts,
            ready = fonts.ready;
          let released = false;
          const held = new Promise<FontFaceSet>((resolve) => {
            w.mainRelease = () => {
              released = true;
              delete w.mainRelease;
              resolve(fonts);
            };
          });
          Object.defineProperty(fonts, 'ready', {
            configurable: true,
            get() {
              if (released) return ready;
              w.mainHeld = true;
              return held;
            },
          });
        } else {
          const native = window.createImageBitmap;
          let used = false;
          window.createImageBitmap = (async (...args: Parameters<typeof native>) => {
            const image = await (native as (...args: unknown[]) => Promise<ImageBitmap>)(...args);
            if (used) return image;
            used = true;
            w.mainHeld = true;
            return new Promise<ImageBitmap>((resolve) => {
              w.mainRelease = () => {
                delete w.mainRelease;
                resolve(image);
              };
            });
          }) as typeof native;
        }
      }, kind);
      await go(page, 4);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { mainHeld: boolean }).mainHeld))
        .toBe(true);
      if (action === 'source')
        await page
          .getByRole('button', { name: 'Add layer', exact: true })
          .evaluate((e: HTMLButtonElement) => e.click());
      else if (action === 'restored')
        await page.evaluate(() => {
          for (const title of ['Last frame', 'First frame'])
            (document.querySelector('button[title="' + title + '"]') as HTMLButtonElement).click();
        });
      else await page.getByTitle('First frame', { exact: true }).click();
      await page.evaluate(() =>
        (window as unknown as { mainRelease?: () => void }).mainRelease?.(),
      );
      if (action === 'source') {
        await ready(page);
        expect((await f.read()).layers).toHaveLength(f.p.layers.length + 1);
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
        await ready(page);
      } else {
        await expect(page.getByLabel('Live stage status')).toHaveCount(0);
        expect(await pixel(page, f.p, 55, 17)).toEqual([255, 255, 255, 255]);
      }
      await go(page, 4);
      await ready(page);
      if (kind === 'bitmap') expect(await pixel(page, f.p, 55, 17)).toEqual([0, 255, 0, 255]);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const mode of ['affine', 'reflected'])
  test(`main sampled ${mode} compound preserves hole and transformed root pixels`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await go(page, 4);
    await ready(page);
    expect(await pixel(page, f.p, mode === 'reflected' ? 46 : 52, 15)).toEqual([255, 0, 0, 255]);
    expect(await pixel(page, f.p, mode === 'reflected' ? 37 : 67, 24)).toEqual([
      255, 255, 255, 255,
    ]);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('independent opacity channel is composed once without resetting the held graphic age', async ({
  page,
}) => {
  const f = await setup(page, 'opacity');
  await go(page, 2);
  await ready(page);
  expect(await pixel(page, f.p, 25, 45)).toEqual([153, 153, 255, 255]);
  expect(await pixel(page, f.p, 45, 5)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('sampled entry clears stale authored fields/selection and rejects context clipboard edits', async ({
  page,
}) => {
  const f = await setup(page);
  await clickPoint(page, f.p, 15, 17);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
  await go(page, 4);
  await ready(page);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveCount(0);
  await page.getByLabel('Drawing stage').click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+x');
  expect(await f.read()).toEqual(f.p);
  await expect(page.locator('.inspector-title strong')).toHaveText('Document');
  expect(f.errors).toEqual([]);
});
test('pointer-only redraws reuse admitted live frame and decoded bitmap resources', async ({
  page,
}) => {
  const f = await setup(page, 'bitmap');
  await go(page, 4);
  await ready(page);
  await page.evaluate(() => {
    const w = window as unknown as { stageClones: number };
    w.stageClones = 0;
    const native = structuredClone;
    window.structuredClone = <T>(value: T) => {
      w.stageClones++;
      return native(value);
    };
  });
  const box = (await page.getByLabel('Drawing stage').boundingBox())!;
  for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 20 + i * 5, box.y + 20 + i * 2);
  expect(
    await page.evaluate(() => (window as unknown as { stageClones: number }).stageClones),
  ).toBe(0);
  expect(await pixel(page, f.p, 55, 17)).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('ready bitmap bank survives frame changes and closes after source replacement', async ({
  page,
}) => {
  const f = await setup(page, 'bitmap');
  await page.evaluate(() => {
    const w = window as unknown as { stageDecodes: number; stageClosed: number };
    w.stageDecodes = w.stageClosed = 0;
    const native = window.createImageBitmap;
    window.createImageBitmap = (async (...args: Parameters<typeof native>) => {
      const image = await (native as (...args: unknown[]) => Promise<ImageBitmap>)(...args),
        close = image.close.bind(image);
      w.stageDecodes++;
      image.close = () => {
        w.stageClosed++;
        close();
      };
      return image;
    }) as typeof native;
  });
  await go(page, 4);
  await ready(page);
  await go(page, 2);
  await ready(page);
  expect(
    await page.evaluate(() => (window as unknown as { stageDecodes: number }).stageDecodes),
  ).toBe(1);
  await go(page, 8);
  await clickPoint(page, f.p, 95, 17);
  await page.getByLabel('Shape X', { exact: true }).fill('128');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await go(page, 4);
  await ready(page);
  expect(
    await page.evaluate(() => (window as unknown as { stageClosed: number }).stageClosed),
  ).toBeGreaterThanOrEqual(1);
  expect(
    await page.evaluate(() => (window as unknown as { stageDecodes: number }).stageDecodes),
  ).toBe(2);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('range and timeline clipboard edits cannot mutate a sparse track even at an authored endpoint', async ({
  page,
}) => {
  const f = await setup(page);
  await go(page, 6);
  await ready(page);
  const timeline = page.getByLabel('Timeline frames');
  await timeline.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Copy frames', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Select the complete tween, including both endpoints');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Multi-frame X offset', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Move multi-frame artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Key every frame in range', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Move multiple frames', { exact: true }).uncheck();
  await go(page, 0);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('native font readiness timeout leaves no sampled pixels/history and permits a fresh frame retry', async ({
  page,
}) => {
  const f = await setup(page, 'text');
  await page.clock.install();
  await page.evaluate(() => {
    const w = window as unknown as { mainHeld: boolean; mainRelease?: () => void },
      fonts = document.fonts,
      ready = fonts.ready;
    let released = false;
    w.mainHeld = false;
    const held = new Promise<FontFaceSet>((resolve) => {
      w.mainRelease = () => {
        released = true;
        resolve(fonts);
      };
    });
    Object.defineProperty(fonts, 'ready', {
      configurable: true,
      get() {
        if (released) return ready;
        w.mainHeld = true;
        return held;
      },
    });
  });
  await go(page, 4);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { mainHeld: boolean }).mainHeld))
    .toBe(true);
  await page.clock.fastForward(60001);
  await expect(page.getByLabel('Live stage status')).toContainText('timed out');
  expect(await f.read()).toEqual(f.p);
  await page.evaluate(() => (window as unknown as { mainRelease?: () => void }).mainRelease?.());
  await go(page, 0);
  await go(page, 4);
  await ready(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('main original snapshot corruption rejects forged display and actual source edit remains undoable', async ({
  page,
}) => {
  const f = await setup(page);
  await go(page, 8);
  await clickPoint(page, f.p, 95, 17);
  await page.evaluate(() => {
    const w = window as unknown as { mainSnapshotHit: boolean };
    w.mainSnapshotHit = false;
    const clone = structuredClone;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        p = value as unknown as Project;
      if (
        !w.mainSnapshotHit &&
        p?.layers?.[0]?.liveMotionSpans?.length === 1 &&
        p.layers[0].keys.find((k) => k.frame === 8)?.shapes[0]?.x === 128
      ) {
        w.mainSnapshotHit = true;
        (out as unknown as Project).layers[0].keys[0].shapes[0].x += 10;
      }
      return out;
    };
  });
  await page.getByLabel('Shape X', { exact: true }).fill('128');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await go(page, 4);
  await expect(page.getByLabel('Live stage status')).toContainText('snapshot changed');
  expect(
    await page.evaluate(() => (window as unknown as { mainSnapshotHit: boolean }).mainSnapshotHit),
  ).toBe(true);
  expect(await pixel(page, f.p, 75, 17)).toEqual([255, 255, 255, 255]);
  const edited = await f.read();
  expect(edited.layers[0].keys[0]).toEqual(f.p.layers[0].keys[0]);
  expect(edited.layers[0].keys[1].shapes[0].x).toBe(128);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await ready(page);
  expect(await f.read()).toEqual(f.p);
  expect(await pixel(page, f.p, 55, 17)).toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});

test('live roots never use stale stored poses as onion ghosts at authored or sampled frames', async ({
  page,
}) => {
  const f = await setup(page, 'onion'),
    before = await pixel(page, f.p, 15, 17);
  expect(before[0]).toBe(255);
  expect(before[1]).toBeGreaterThan(0);
  expect(before[1]).toBeLessThan(200);
  await page.getByTitle('Toggle onion skin', { exact: true }).click();
  expect(await pixel(page, f.p, 15, 17)).toEqual(before);
  await go(page, 4);
  await ready(page);
  expect(await pixel(page, f.p, 55, 17)).toEqual(before);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
