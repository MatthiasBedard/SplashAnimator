import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { validateProject, type Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
type API = typeof import('../live-motion-presentation-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-motion-presentation-fixture.ts',
        formats: ['iife'],
        name: 'LivePresentation',
        fileName: () => 'live.js',
      },
    },
  });

  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live presentation bundle');
  code = chunks[0].code;
});

async function setup(page: Page, mode = 'plain') {
  const p = livePresentationFixture(mode === 'movie' || mode === 'button' ? mode : 'graphic'),
    errors: string[] = [];
  if (mode === 'childrenBad') p.symbols![0].timeline!.keys[0].shapes[0].x = 23;
  if (mode === 'locked') p.layers[0].locked = true;
  if (mode === 'hidden') p.layers[0].visible = false;
  const span = p.layers[0].liveMotionSpans![0];
  if (mode === 'bounds') span.path = { startX: 0, startY: 30000000, endX: 0, endY: 30000000 };
  if (mode === 'channels') {
    span.ease = 'in';
    span.opacityEase = 'linear';
    span.paintEase = 'out';
    span.options = { paint: true };
  }
  if (mode === 'affine' || mode === 'reflected' || mode === 'compound')
    span.options = { affine: true, nodes: mode === 'compound' };
  if (mode === 'primitive') span.options = { primitives: true };
  const dataUrl =
    mode === 'bitmap'
      ? await page.evaluate(() => {
          const c = document.createElement('canvas');
          c.width = 2;
          c.height = 2;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(0, 0, 2, 2);
          return c.toDataURL();
        })
      : '';
  if (dataUrl)
    p.assets = [
      {
        id: 'green',
        path: 'assets/bitmaps/green.json',
        bitmap: { name: 'Green', width: 2, height: 2, dataUrl },
      },
    ];
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const s = key.shapes[0];
    if (mode === 'channels') {
      s.opacity = key.frame ? 1 : 0.2;
      s.fill = key.frame ? '#0000ff' : '#ff0000';
    }
    if (mode === 'affine' || mode === 'reflected' || mode === 'compound')
      s.transform = [mode === 'affine' ? 1 : -1, 0.25, 0.5, 1.5];
    if (mode === 'compound') {
      s.kind = 'polygon';
      s.fillRule = 'evenodd';
      s.contours = [
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
      ];
    }
    if (mode === 'primitive' && key.frame) s.width = 40;
    if (mode === 'bitmap') s.bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
    if (mode === 'text') {
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
  }
  validateProject(p);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-preview-seed')) {
      sessionStorage.setItem('live-preview-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
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
  await page.getByRole('button', { name: 'Preview live timeline…', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Preview live timeline', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Live preview frame', { exact: true }).fill('3');
}

test('live timeline preview renders and clears a pose with contained keyboard focus', async ({ page }) => {
  const f = await setup(page, 'plain');
  const control = page.getByRole('button', { name: 'Control', exact: true });
  await control.click();
  await page.getByRole('button', { name: 'Preview live timeline…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview live timeline', exact: true });
  const frame = dialog.getByLabel('Live preview frame');
  const close = dialog.getByRole('button', { name: 'Close dialog' });
  const render = dialog.getByRole('button', { name: 'Render live pose' });
  const clear = dialog.getByRole('button', { name: 'Clear live preview' });
  await expect(frame).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(render).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await frame.press('ArrowUp');
  await frame.press('ArrowUp');
  await expect(frame).toHaveValue('3');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(render).toBeFocused();
  await trackURLs(page);
  await page.keyboard.press('Enter');
  const pose = dialog.getByRole('img', { name: 'Live motion pose' });
  await expect(pose).toBeVisible();
  await expect.poll(() => pose.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(160);
  expect(await pixels(page)).toEqual([white, red, white, blue, white]);
  await page.keyboard.press('Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(render).toBeFocused();
  await closedResources(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(control).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
async function render(page: Page) {
  await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: 'Live motion pose', exact: true })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(160);
}
async function pixels(
  page: Page,
  points = [
    [5, 5],
    [45, 5],
    [85, 5],
    [25, 45],
    [45, 45],
  ],
) {
  return page
    .getByRole('img', { name: 'Live motion pose', exact: true })
    .evaluate((img: HTMLImageElement, points) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    }, points);
}
async function trackURLs(page: Page) {
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL),
      made: string[] = [],
      retired: string[] = [];
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      made.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      retired.push(url);
      revoke(url);
    };
    Object.assign(window, { liveURLs: () => ({ made, retired }) });
  });
}
async function closedResources(page: Page) {
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  const urls = await page.evaluate(() =>
    (window as unknown as { liveURLs: () => { made: string[]; retired: string[] } }).liveURLs(),
  );
  expect([...urls.retired].sort()).toEqual([...urls.made].sort());
}
const white = [255, 255, 255, 255],
  red = [255, 0, 0, 255],
  blue = [0, 0, 255, 255];
for (const mode of [
  'plain',
  'movie',
  'button',
  'locked',
  'hidden',
  'channels',
  'affine',
  'reflected',
  'compound',
  'primitive',
  'bitmap',
  'text',
])
  test(`actual read-only ${mode} live pose renders exact saved data without stage/history writes`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await open(page);
    await trackURLs(page);
    await expect(page.getByLabel('Evaluate remembered child timelines')).not.toBeChecked();
    await render(page);
    if (mode === 'plain' || mode === 'locked')
      expect(await pixels(page)).toEqual([white, red, white, blue, white]);
    if (mode === 'movie' || mode === 'button') {
      expect(
        await pixels(page, [
          [65, 45],
          [95, 45],
        ]),
      ).toEqual([blue, white]);
      await page.getByLabel('Evaluate remembered child timelines').check();
      await render(page);
      expect(
        await pixels(page, [
          [65, 45],
          [95, 45],
        ]),
      ).toEqual([white, blue]);
    }
    if (mode === 'hidden') expect((await pixels(page)).slice(0, 3)).toEqual([white, white, white]);
    if (mode === 'channels')
      expect(
        await pixels(page, [
          [5, 5],
          [25, 5],
          [45, 5],
        ]),
      ).toEqual([white, [140, 102, 217, 255], white]);
    if (mode === 'affine') expect(await pixels(page, [[55, 17]])).toEqual([red]);
    if (mode === 'reflected') expect(await pixels(page, [[35, 17]])).toEqual([red]);
    if (mode === 'compound')
      expect(
        await pixels(page, [
          [42, 16],
          [35, 17],
        ]),
      ).toEqual([red, white]);
    if (mode === 'primitive')
      expect(
        await pixels(page, [
          [45, 5],
          [65, 5],
          [75, 5],
        ]),
      ).toEqual([red, red, white]);
    if (mode === 'bitmap')
      expect(
        await pixels(page, [
          [45, 5],
          [5, 5],
        ]),
      ).toEqual([[0, 255, 0, 255], white]);
    if (mode === 'text') {
      const ink = await page
        .getByRole('img', { name: 'Live motion pose', exact: true })
        .evaluate((img: HTMLImageElement) => {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 80;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(40, 0, 20, 20).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] < 255 || data[i + 1] < 255 || data[i + 2] < 255) count++;
          return count;
        });
      expect(ink).toBeGreaterThan(20);
    }
    expect(await f.read()).toEqual(f.p);
    expect((await f.read()).layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8]);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await closedResources(page);
    await expect(page.getByRole('region', { name: 'Timeline', exact: true })).toContainText(
      'Frame 1 / 10',
    );
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('actual live preview explicitly prepares children, retains holds and never falls back after invalid child preparation', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await trackURLs(page);
  await render(page);
  await page.getByLabel('Evaluate remembered child timelines').check();
  await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(0);
  await render(page);
  expect(await pixels(page)).toEqual([white, red, white, white, blue]);
  await page.getByLabel('Live preview frame', { exact: true }).fill('7');
  await render(page);
  expect(
    await pixels(page, [
      [5, 5],
      [45, 5],
      [85, 5],
    ]),
  ).toEqual([white, white, red]);
  await page.getByRole('button', { name: 'Clear live preview', exact: true }).click();
  await closedResources(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('invalid prepared children reject with blank recovery while unchecked stored poses remain available', async ({
  page,
}) => {
  const f = await setup(page, 'childrenBad');
  await open(page);
  await trackURLs(page);
  await render(page);
  await page.getByLabel('Evaluate remembered child timelines').check();
  await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
  await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText(
    'Generated keys',
  );
  await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(0);
  await page.getByLabel('Evaluate remembered child timelines').uncheck();
  await render(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await closedResources(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const value of ['', '0', '1.5', '11'])
  test(`actual raw frame ${JSON.stringify(value)} rejects without extra history and corrects`, async ({
    page,
  }) => {
    const f = await setup(page);
    await open(page);
    await trackURLs(page);
    await page.getByLabel('Live preview frame', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
    await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText(
      'exact live motion frame',
    );
    await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(0);
    await page.getByLabel('Live preview frame', { exact: true }).fill('3');
    await render(page);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await closedResources(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

async function holdNative(page: Page, kind: 'font' | 'bitmap') {
  await page.evaluate(() => Object.assign(window, { liveHeld: false, liveHoldUsed: false }));
  await page.addInitScript((kind) => {
    if (window === window.parent) return;
    const parent = window.parent as unknown as {
      liveHeld: boolean;
      liveHoldUsed: boolean;
      liveRelease?: () => void;
    };
    if (kind === 'font') {
      if (parent.liveHoldUsed) return;
      const ready = document.fonts.ready;
      let held: Promise<FontFaceSet> | undefined;
      Object.defineProperty(document.fonts, 'ready', {
        configurable: true,
        get: () => {
          if (!held) {
            parent.liveHoldUsed = true;
            parent.liveHeld = true;
            held = new Promise<FontFaceSet>((resolve) => {
              parent.liveRelease = () => {
                parent.liveRelease = undefined;
                delete (document.fonts as unknown as { ready?: Promise<FontFaceSet> }).ready;
                void ready.then(resolve);
              };
            });
          }
          return held;
        },
      });
    } else {
      const ImageConstructor = window.Image,
        src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
      window.Image = function (...args: ConstructorParameters<typeof Image>) {
        const image = new ImageConstructor(...args);
        Object.defineProperty(image, 'src', {
          configurable: true,
          get: () => src.get!.call(image),
          set: (value: string) => {
            if (parent.liveHoldUsed || !value) {
              src.set!.call(image, value);
              return;
            }
            parent.liveHoldUsed = true;
            parent.liveHeld = true;
            parent.liveRelease = () => {
              parent.liveRelease = undefined;
              src.set!.call(image, value);
            };
          },
        });
        return image;
      } as unknown as typeof Image;
    }
  }, kind);
}
for (const kind of ['font', 'bitmap'] as const)
  for (const action of [
    'clear',
    'frame',
    'children',
    'supersede',
    'close',
    'source',
    'editorFrame',
  ])
    test(`actual pending ${kind} ${action} rejects stale native output and permits fresh retry`, async ({
      page,
    }) => {
      const f = await setup(page, kind === 'font' ? 'text' : 'bitmap');
      await open(page);
      await trackURLs(page);
      await holdNative(page, kind);
      await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { liveHeld: boolean }).liveHeld))
        .toBe(true);
      if (action === 'clear')
        await page.getByRole('button', { name: 'Clear live preview', exact: true }).click();
      if (action === 'frame') {
        await page.getByLabel('Live preview frame', { exact: true }).fill('4');
        await page.getByLabel('Live preview frame', { exact: true }).fill('3');
      }
      if (action === 'children') {
        await page.getByLabel('Evaluate remembered child timelines').check();
        await page.getByLabel('Evaluate remembered child timelines').uncheck();
      }
      if (action === 'supersede')
        await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
      if (action === 'close') {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
      }
      if (action === 'editorFrame')
        await page.evaluate(() => {
          for (const title of ['Last frame', 'First frame'])
            (document.querySelector('button[title="' + title + '"]') as HTMLButtonElement).click();
        });
      if (action === 'source')
        await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
          e.value = '#000000';
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      await page.evaluate(() =>
        (window as unknown as { liveRelease?: () => void }).liveRelease?.(),
      );
      if (action !== 'supersede')
        await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(
          0,
        );
      await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
      if (action === 'close' || action === 'source' || action === 'editorFrame') {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        if (action === 'source') {
          expect((await f.read()).background).toBe('#000000');
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
        }
        await open(page);
      }
      await render(page);
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await closedResources(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const action of ['clear', 'frame', 'children', 'supersede', 'close', 'source', 'editorFrame'])
  test(`complete native live PNG rejects late ${action} before visible publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await open(page);
    await trackURLs(page);
    await page.evaluate((action) => {
      const create = URL.createObjectURL;
      let hit = false;
      URL.createObjectURL = function (blob) {
        const url = create.call(URL, blob);
        if (!hit) {
          hit = true;
          Object.assign(window, { liveLateHook: true });
          const button = (name: string) => {
            const b = [...document.querySelectorAll('button')].find(
              (b) => b.textContent?.trim() === name,
            );
            if (!b) throw Error('Missing ' + name);
            b.click();
          };
          if (action === 'clear') button('Clear live preview');
          if (action === 'supersede') button('Render live pose');
          if (action === 'close') button('×');
          if (action === 'frame') {
            const e = document.querySelector(
              '[aria-label="Live preview frame"]',
            ) as HTMLInputElement;
            for (const value of ['4', '3']) {
              e.value = value;
              e.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'children') {
            const e = document.querySelector(
              '[aria-label="Evaluate remembered child timelines"]',
            ) as HTMLInputElement;
            for (const value of [true, false]) {
              e.checked = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (action === 'editorFrame')
            for (const title of ['Last frame', 'First frame'])
              (
                document.querySelector('button[title="' + title + '"]') as HTMLButtonElement
              ).click();
          if (action === 'source') {
            const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#000000';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return url;
      };
    }, action);
    await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { liveLateHook: boolean }).liveLateHook),
      )
      .toBe(true);
    if (action !== 'supersede')
      await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(0);
    if (action === 'close' || action === 'source' || action === 'editorFrame') {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (action === 'source') {
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
      }
      await open(page);
    }
    await render(page);
    expect(await pixels(page)).toEqual([white, red, white, blue, white]);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await closedResources(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const rememberedChildren of [false, true])
  for (const kind of ['graphic', 'movie', 'button'])
    test(`API live pose native PNG pixels preserve held ${kind} origins, children ${rememberedChildren}`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ rememberedChildren, kind }) => {
          const api = (window as unknown as { LivePresentation: API }).LivePresentation,
            p = api.livePresentationFixture(kind),
            before = JSON.stringify(p),
            view = await api.prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), 2, {
              rememberedChildren,
            });
          const bitmap = await createImageBitmap(await api.exportPNGFrame(view, 2)),
            c = document.createElement('canvas');
          c.width = 160;
          c.height = 80;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return {
            pixels: [
              [5, 5],
              [45, 5],
              [85, 5],
              [kind === 'graphic' ? 25 : 65, 45],
              [kind === 'graphic' ? 45 : 95, 45],
            ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)),
            unchanged: JSON.stringify(p) === before,
            keys: p.layers[0].keys.map((k) => k.frame),
            origins: view.layers[1].keys.map((k) => k.frame),
            frames: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
          };
        },
        { rememberedChildren, kind },
      );
      const white = [255, 255, 255, 255],
        blue = [0, 0, 255, 255];
      expect(result.pixels).toEqual([
        white,
        [255, 0, 0, 255],
        white,
        rememberedChildren ? white : blue,
        rememberedChildren ? blue : white,
      ]);
      expect(result.unchanged).toBe(true);
      expect(result.keys).toEqual([0, 4, 8]);
      expect(result.origins).toEqual([0, 1]);
      expect(result.frames).toBe(0);
    });

test('ordinary documents keep live preview disabled without creating recipes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Preview live timeline…', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('dialog', { name: 'Preview live timeline', exact: true }),
  ).toHaveCount(0);
});

test('derived live geometry rejects before native display and preserves exact endpoint recovery', async ({
  page,
}) => {
  const f = await setup(page, 'bounds');
  await open(page);
  await trackURLs(page);
  await page.getByRole('button', { name: 'Render live pose', exact: true }).click();
  await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText(
    'shape geometry',
  );
  await expect(page.getByRole('img', { name: 'Live motion pose', exact: true })).toHaveCount(0);
  await closedResources(page);
  await page.getByLabel('Live preview frame', { exact: true }).fill('1');
  await render(page);
  expect(
    await pixels(page, [
      [5, 5],
      [45, 5],
    ]),
  ).toEqual([red, white]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await closedResources(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('pending Brush excludes live entry, and undoing its finished endpoint edit restores the sparse preview', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Preview live timeline…', exact: true }),
  ).toBeDisabled();
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Preview live timeline…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Preview live timeline…', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await open(page);
  await render(page);
  expect(await pixels(page)).toEqual([white, red, white, blue, white]);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
