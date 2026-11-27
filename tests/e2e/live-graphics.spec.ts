import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-graphics-browser-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-graphics-browser-fixture.ts',
        formats: ['iife'],
        name: 'LiveGraphics',
        fileName: () => 'graphics.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((c) => c.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one graphic continuity bundle');
  code = chunks[0].code;
});
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`graphic ${mode}/${basis} PNG clocks apply age once through wrap, endpoints and hold`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ mode, basis }) => {
          const api = (window as unknown as { LiveGraphics: API }).LiveGraphics,
            { p, span } = api.liveGraphicFixture(mode, basis);
          p.width = 320;
          p.height = 240;
          for (const key of p.layers[0].keys)
            for (const s of key.shapes) {
              s.x += 60;
              s.y += 20;
            }
          p.frameScripts = [{ frame: 3, source: 'globalThis.graphicScriptRan = true;' }];
          const before = JSON.stringify(p),
            out = api.createLiveGraphics(p, span),
            stored = JSON.stringify(out);
          const frames = [2, 3, 6, 9, 10, 11],
            pixels: number[][] = [];
          let equal = true;
          for (const frame of frames) {
            const blob = await api.exportPNGFrame(out, frame),
              image = await createImageBitmap(blob),
              canvas = document.createElement('canvas');
            canvas.width = p.width;
            canvas.height = p.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            image.close();
            const age = frame - 2,
              first = mode === 'default' ? 0 : 1,
              clock =
                mode === 'single'
                  ? 1
                  : mode === 'once'
                    ? Math.min(first + age, 4)
                    : (first + age) % 5,
              t = Math.min(age / 8, 1),
              angle = (t * Math.PI) / 2,
              b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
              u = b[0] * (clock * 10 + 2) + b[2] * 2,
              v = b[1] * (clock * 10 + 2) + b[3] * 2,
              x = 80 + 80 * t + Math.cos(angle) * u - Math.sin(angle) * v,
              y = 50 + 40 * t + Math.sin(angle) * u + Math.cos(angle) * v;
            pixels.push(Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data));
            if (frame === 6) {
              const again = await api.exportPNGFrame(JSON.parse(stored), frame),
                a = new Uint8Array(await blob.arrayBuffer()),
                b = new Uint8Array(await again.arrayBuffer());
              equal = a.length === b.length && a.every((v, i) => v === b[i]);
            }
          }
          return {
            pixels,
            equal,
            unchanged: JSON.stringify(p) === before && JSON.stringify(out) === stored,
            keys: out.layers[0].keys,
            original: p.layers[0].keys,
            library: JSON.stringify(out.symbols) === JSON.stringify(p.symbols),
            marker: out.layers[0].liveMotionSpans![0].symbolContinuity,
            script: (window as unknown as { graphicScriptRan?: boolean }).graphicScriptRan ?? false,
            iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
          };
        },
        { mode, basis },
      );
      for (const pixel of result.pixels) expect(pixel).toEqual([255, 0, 0, 255]);
      expect(result.keys).toEqual(result.original);
      expect(result).toMatchObject({
        equal: true,
        unchanged: true,
        library: true,
        marker: 'graphics',
        script: false,
        iframes: 0,
      });
      expect(errors).toEqual([]);
    });

for (const holes of [false, true])
  test(`nested graphic exposure ${holes ? 'reentry' : 'hold'} retains child clocks in native PNG`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (holes) => {
      const api = (window as unknown as { LiveGraphics: API }).LiveGraphics,
        { p, span, definition } = api.liveGraphicFixture();
      const child = {
          ...api.symbolInstance(definition, 0, 0),
          id: 'child',
          symbolPlayback: { mode: 'once' as const, firstFrame: 2 },
        },
        wrapper = {
          id: 'wrapper',
          name: 'Wrapper',
          width: 60,
          height: 10,
          shapes: [child],
          timeline: {
            duration: 3,
            keys: holes
              ? [
                  { frame: 1, shapes: [] },
                  { frame: 2, shapes: [structuredClone(child)] },
                ]
              : [],
          },
        };
      p.symbols!.push(wrapper);
      p.width = 320;
      p.height = 240;
      for (const key of p.layers[0].keys)
        for (const root of key.shapes) {
          root.symbolId = 'wrapper';
          root.x += 60;
          root.y += 20;
        }
      p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
      const out = api.createLiveGraphics(p, span),
        before = JSON.stringify(out),
        pixels: number[][] = [];
      for (const frame of [2, 3, 4, 6, 9, 10, 11]) {
        const image = await createImageBitmap(await api.exportPNGFrame(out, frame)),
          canvas = document.createElement('canvas');
        canvas.width = p.width;
        canvas.height = p.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const age = frame - 2,
          phase = (1 + age) % 3,
          clock = holes ? 2 : Math.min(2 + phase, 4),
          t = Math.min(age / 8, 1),
          angle = (t * Math.PI) / 2,
          x = 80 + 80 * t + Math.cos(angle) * (clock * 10 + 2) - Math.sin(angle) * 2,
          y = 50 + 40 * t + Math.sin(angle) * (clock * 10 + 2) + Math.cos(angle) * 2;
        pixels.push(Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data));
      }
      return { pixels, unchanged: JSON.stringify(out) === before };
    }, holes);
    for (const [i, frame] of [2, 3, 4, 6, 9, 10, 11].entries()) {
      const blank = holes && (1 + frame - 2) % 3 === 1;
      expect(result.pixels[i]).toEqual(blank ? [255, 255, 255, 255] : [255, 0, 0, 255]);
    }
    expect(result.unchanged).toBe(true);
  });

test('graphic live recipes remain excluded from generic editing, cubic controls and root insertion', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: code });
  const stored = await page.evaluate(() => {
    const api = (window as unknown as { LiveGraphics: API }).LiveGraphics,
      { p, span } = api.liveGraphicFixture();
    span.path = { startX: 0, startY: 10, endX: 0, endY: 10 };
    const out = api.createLiveGraphics(p, span),
      read = () => ({ project: out, revision: 0, frame: 6 }),
      root = api.captureLiveMotionAuthoringFrame(read),
      cubic = api.captureLiveCubicControls(read);
    if (root.choices.length || cubic.choices.length)
      throw Error('Graphic scope leaked into root authoring');
    root.dispose();
    cubic.dispose();
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: out, folder: null, manifest: null }),
    );
    return JSON.stringify(out);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live tween…', exact: true }).click();
  const row = page.getByRole('checkbox', { name: /Edit live tween .*frames 3–11/ });
  await expect(row).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Include complete group live tweens' }).check();
  await expect(row).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Change live tween easing' }).check();
  await row.evaluate((e) => {
    (e as HTMLInputElement).disabled = false;
    (e as HTMLInputElement).click();
  });
  await page
    .getByRole('button', { name: 'Apply live tween changes', exact: true })
    .evaluate((e) => {
      (e as HTMLButtonElement).disabled = false;
      (e as HTMLButtonElement).click();
    });
  await expect(
    page.getByRole('status').filter({ hasText: 'Choose original visible unlocked' }),
  ).toBeVisible();
  const recovered = await page.evaluate(() =>
    JSON.stringify(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  );
  expect(recovered).toBe(stored);
});
