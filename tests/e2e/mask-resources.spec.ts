import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../mask-resources-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/mask-resources-fixture.ts',
        formats: ['iife'],
        name: 'MaskResources',
        fileName: () => 'mask-resources.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((r) => r.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one resource API bundle');
  code = chunks[0].code;
});
async function setup(page: Page) {
  await page.goto('/');
  await page.addScriptTag({ content: code });
}

test('native resources deduplicate across IDs/frames/overlapping painters and preserve default pixels', async ({
  page,
}) => {
  await setup(page);
  const r = await page.evaluate(async () => {
    const api = (window as unknown as { MaskResources: API }).MaskResources,
      source = document.createElement('canvas');
    source.width = 40;
    source.height = 30;
    const src = source.getContext('2d')!;
    src.fillStyle = '#ffffff';
    src.fillRect(0, 0, 20, 30);
    const p = api.maskResourceFixture(source.toDataURL()),
      before = JSON.stringify(p),
      masks = [{ maskLayerId: 'mask', layerIds: ['target'] }],
      scenes = [0, 1].map((f) => api.prepareLayerScene(p, f, masks, api.evaluateLayers));
    let decodes = 0,
      closed = 0,
      loads = 0;
    const decode = createImageBitmap,
      load = document.fonts.load.bind(document.fonts);
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      decodes++;
      const image = await decode(...args),
        close = image.close.bind(image);
      image.close = () => {
        closed++;
        close();
      };
      return image;
    }) as typeof createImageBitmap;
    document.fonts.load = (...args) => {
      loads++;
      return load(...args);
    };
    const canvas = () => {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 40, 30);
      return ctx;
    };
    const normal = await api.prepareMaskedLayerPainter(scenes[0]),
      a = canvas();
    normal.paint(a);
    normal.dispose();
    const baseline = Array.from(a.getImageData(0, 0, 40, 30).data);
    const bank = api.createMaskResourceBank(p),
      one = await api.prepareMaskedLayerPainter(scenes[0], { resources: bank }),
      two = await api.prepareMaskedLayerPainter(scenes[1], { resources: bank }),
      b = canvas(),
      c = canvas();
    one.paint(b);
    two.paint(c);
    const data = b.getImageData(0, 0, 40, 30).data,
      same = baseline.every((n, i) => n === data[i]),
      points = [
        Array.from(b.getImageData(5, 15, 1, 1).data),
        Array.from(c.getImageData(5, 15, 1, 1).data),
        Array.from(c.getImageData(25, 15, 1, 1).data),
      ];
    one.dispose();
    const afterOne = closed;
    two.paint(c);
    const active = bank.stats();
    two.dispose();
    const retained = bank.stats();
    bank.dispose();
    const allClosed = closed;
    for (const s of scenes) api.disposeLayerScene(s);
    return {
      same,
      points,
      decodes,
      loads,
      afterOne,
      allClosed,
      active,
      retained,
      sourceSame: before === JSON.stringify(p),
    };
  });
  expect(r.same && r.sourceSame).toBe(true);
  expect(r.points).toEqual([
    [128, 0, 127, 255],
    [0, 0, 255, 255],
    [128, 0, 127, 255],
  ]);
  expect(r.decodes).toBe(2);
  expect(r.loads).toBe(2);
  expect(r.afterOne).toBe(1);
  expect(r.allClosed).toBe(2);
  expect(r.active).toMatchObject({ ready: 1, leases: 1, decodedPixels: 1200, rasterPixels: 4800 });
  expect(r.retained).toMatchObject({ ready: 1, leases: 0, decodedPixels: 1200, rasterPixels: 0 });
});

for (const change of ['glyph', 'run', 'faces'])
  test(`native font requests refresh ${change} while images stay reusable`, async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async (change) => {
      const api = (window as unknown as { MaskResources: API }).MaskResources,
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      c.getContext('2d')!.fillRect(0, 0, 40, 30);
      const p = api.maskResourceFixture(c.toDataURL(), change);
      for (const key of p.layers[0].keys) key.shapes.find((shape) => !!shape.text)!.x = 0;
      const masks = [{ maskLayerId: 'mask', layerIds: ['target'] }],
        a = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
        b = api.prepareLayerScene(p, 1, masks, api.evaluateLayers);
      let decodes = 0;
      const decode = createImageBitmap;
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        decodes++;
        return decode(...args);
      }) as typeof createImageBitmap;
      const load = document.fonts.load.bind(document.fonts),
        requests: string[] = [];
      document.fonts.load = (css, text) => {
        requests.push(css + '|' + text);
        return load(css, text);
      };
      const paint = (painter: Awaited<ReturnType<API['prepareMaskedLayerPainter']>>) => {
        const target = document.createElement('canvas');
        target.width = 40;
        target.height = 30;
        const ctx = target.getContext('2d')!;
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 40, 30);
        painter.paint(ctx);
        return ctx.getImageData(0, 0, 40, 30).data;
      };
      const bank = api.createMaskResourceBank(p),
        first = await api.prepareMaskedLayerPainter(a, { resources: bank });
      const firstPixels = paint(first);
      first.dispose();
      let face: FontFace | undefined;
      if (change === 'faces') {
        face = new FontFace('UnusedBankFace', 'local("Arial")');
        document.fonts.add(face);
      }
      const next = await api.prepareMaskedLayerPainter(b, { resources: bank });
      const nextPixels = paint(next),
        cachedRequests = [...requests],
        cachedDecodes = decodes;
      next.dispose();
      const controls: Uint8ClampedArray[] = [];
      for (const scene of [a, b]) {
        const normal = await api.prepareMaskedLayerPainter(scene);
        controls.push(paint(normal));
        normal.dispose();
      }
      const same = [firstPixels, nextPixels].every((pixels, i) =>
        pixels.every((value, j) => value === controls[i][j]),
      );
      const glyphs = [firstPixels, nextPixels].map((pixels) => {
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] < 120 &&
            pixels[i + 1] === 0 &&
            pixels[i + 2] >= 126 &&
            pixels[i + 2] <= 128
          )
            count++;
        return count;
      });
      bank.dispose();
      if (face) document.fonts.delete(face);
      api.disposeLayerScene(a);
      api.disposeLayerScene(b);
      return { requests: cachedRequests, decodes: cachedDecodes, same, glyphs };
    }, change);
    expect(r.same).toBe(true);
    expect(r.glyphs.every((count) => count > 0)).toBe(true);
    expect(r.decodes).toBe(1);
    expect(r.requests).toHaveLength(2);
    if (change === 'glyph') expect(r.requests[1]).toContain('|AC');
    if (change === 'run') expect(r.requests[1]).toContain('bold');
  });

for (const action of ['abort', 'dispose', 'source'])
  test(`native pending decode ${action} keeps ownership and closes once`, async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async (action) => {
      const api = (window as unknown as { MaskResources: API }).MaskResources,
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      c.getContext('2d')!.fillRect(0, 0, 40, 30);
      const p = api.maskResourceFixture(c.toDataURL()),
        scene = api.prepareLayerScene(
          p,
          0,
          [{ maskLayerId: 'mask', layerIds: ['target'] }],
          api.evaluateLayers,
        ),
        bank = api.createMaskResourceBank(p),
        abort = new AbortController();
      let done!: (image: ImageBitmap) => void,
        arrived!: () => void,
        closed = 0,
        decodes = 0;
      const started = new Promise<void>((r) => {
          arrived = r;
        }),
        gate = new Promise<ImageBitmap>((r) => {
          done = r;
        }),
        decode = createImageBitmap;
      let image: ImageBitmap;
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        decodes++;
        image = await decode(...args);
        const close = image.close.bind(image);
        image.close = () => {
          closed++;
          close();
        };
        arrived();
        return gate;
      }) as typeof createImageBitmap;
      const pending = api
        .prepareMaskedLayerPainter(scene, { resources: bank, signal: abort.signal })
        .then(
          (p) => {
            p.dispose();
            return 'ready';
          },
          () => 'rejected',
        );
      await started;
      if (action === 'abort') abort.abort(Error('Cancelled'));
      if (action === 'dispose') bank.dispose();
      if (action === 'source') p.name = 'Changed';
      done(image!);
      const status = await pending;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const beforeClose = closed;
      if (action === 'abort') {
        const retry = await api.prepareMaskedLayerPainter(scene, { resources: bank });
        retry.dispose();
      }
      const cache = bank.stats();
      bank.dispose();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      api.disposeLayerScene(scene);
      return { status, beforeClose, closed, decodes, cache };
    }, action);
    expect(r.status).toBe('rejected');
    expect(r.decodes).toBe(1);
    expect(r.closed).toBe(1);
    expect(r.beforeClose).toBe(action === 'abort' ? 0 : 1);
    expect(r.cache.leases).toBe(0);
    expect(r.cache.ready).toBe(action === 'abort' ? 1 : 0);
  });

for (const action of ['dispose', 'source', 'abort'])
  test(`ready shared painter ${action} rejects cached publication and clears private rasters`, async ({
    page,
  }) => {
    await setup(page);
    const r = await page.evaluate(async (action) => {
      const api = (window as unknown as { MaskResources: API }).MaskResources,
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      c.getContext('2d')!.fillRect(0, 0, 40, 30);
      const p = api.maskResourceFixture(c.toDataURL()),
        scene = api.prepareLayerScene(
          p,
          0,
          [{ maskLayerId: 'mask', layerIds: ['target'] }],
          api.evaluateLayers,
        ),
        bank = api.createMaskResourceBank(p),
        abort = new AbortController(),
        painter = await api.prepareMaskedLayerPainter(scene, {
          resources: bank,
          signal: abort.signal,
        });
      const target = document.createElement('canvas');
      target.width = 40;
      target.height = 30;
      const ctx = target.getContext('2d')!,
        create = document.createElement.bind(document),
        canvases: HTMLCanvasElement[] = [];
      document.createElement = ((...args: Parameters<typeof document.createElement>) => {
        const e = create(...args);
        if (args[0] === 'canvas') canvases.push(e as HTMLCanvasElement);
        return e;
      }) as typeof document.createElement;
      painter.paint(ctx);
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 40, 30);
      const before = ctx.getImageData(0, 0, 40, 30).data;
      if (action === 'dispose') bank.dispose();
      if (action === 'source') p.name = 'Changed';
      if (action === 'abort') abort.abort();
      let rejected = false;
      try {
        painter.paint(ctx);
      } catch {
        rejected = true;
      }
      const after = ctx.getImageData(0, 0, 40, 30).data,
        stats = bank.stats(),
        sizes = canvases.map((c) => [c.width, c.height]);
      bank.dispose();
      api.disposeLayerScene(scene);
      return {
        rejected,
        disposed: painter.disposed,
        unchanged: before.every((n, i) => n === after[i]),
        sizes,
        stats,
      };
    }, action);
    expect(r.rejected && r.disposed && r.unchanged).toBe(true);
    expect(r.sizes).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(r.stats.leases).toBe(0);
    expect(r.stats.ready).toBe(action === 'abort' ? 1 : 0);
  });

test('native malformed decode dimensions reject without poisoning a valid bank', async ({
  page,
}) => {
  await setup(page);
  const r = await page.evaluate(async () => {
    const api = (window as unknown as { MaskResources: API }).MaskResources,
      c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    c.getContext('2d')!.fillRect(0, 0, 40, 30);
    const p = api.maskResourceFixture(c.toDataURL()),
      scene = api.prepareLayerScene(
        p,
        0,
        [{ maskLayerId: 'mask', layerIds: ['target'] }],
        api.evaluateLayers,
      ),
      bank = api.createMaskResourceBank(p),
      decode = createImageBitmap;
    const tiny = document.createElement('canvas');
    tiny.width = tiny.height = 1;
    let closed = 0;
    const wrong = await decode(tiny),
      close = wrong.close.bind(wrong);
    wrong.close = () => {
      closed++;
      close();
    };
    window.createImageBitmap = async () => wrong;
    let rejected = false;
    try {
      await api.prepareMaskedLayerPainter(scene, { resources: bank });
    } catch {
      rejected = true;
    }
    const stats = bank.stats();
    window.createImageBitmap = decode;
    const retry = await api.prepareMaskedLayerPainter(scene, { resources: bank });
    retry.dispose();
    bank.dispose();
    api.disposeLayerScene(scene);
    return { rejected, stats, closed };
  });
  expect(r.rejected).toBe(true);
  expect(r.closed).toBe(1);
  expect(r.stats).toMatchObject({ decodedPixels: 0, leases: 0, ready: 0 });
});
