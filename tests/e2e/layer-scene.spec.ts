import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { newProject, newLayer, type Vector } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'scene-test-api',
        enforce: 'pre',
        transform(code, id) {
          if (id.replaceAll('\\', '/').endsWith('/packages/stage/src/masked-layers.ts'))
            return (
              code +
              `
export {prepareLayerScene,withLayerScene,disposeLayerScene} from '../../animation/src/layer-scene';export {evaluateLayers} from '../../animation/src';export {rootButtons,rootButtonProject} from '../../animation/src/button-preview';`
            );
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'packages/stage/src/masked-layers.ts',
        formats: ['iife'],
        name: 'LayerScene',
        fileName: () => 'layer-scene.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((r) => r.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one layer-scene API bundle');
  code = chunks[0].code;
});
type API = typeof import('../../packages/stage/src/masked-layers') &
  typeof import('../../packages/animation/src/layer-scene') &
  typeof import('../../packages/animation/src') &
  typeof import('../../packages/animation/src/button-preview');
const art = (id: string, fill: string, x = 0, width = 40, opacity = 1): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y: 0,
  width,
  height: 30,
  fill,
  opacity,
  rotation: 0,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture(mode = 'plain') {
  const p = newProject();
  p.width = 40;
  p.height = 30;
  p.duration = 4;
  let mask: Vector = {
    ...art('mask-art', '#ffffff', 0, 40, 0.5),
    kind: 'polygon',
    fillRule: 'evenodd',
    contours: [
      [
        { x: 6, y: 4 },
        { x: 32, y: 4 },
        { x: 32, y: 24 },
        { x: 6, y: 24 },
      ],
      [
        { x: 14, y: 10 },
        { x: 14, y: 14 },
        { x: 18, y: 14 },
        { x: 18, y: 10 },
      ],
    ],
  };
  if (mode === 'reflected') {
    mask.x = 44;
    mask.transform = [-1, 0, 0, 1];
  }
  if (mode === 'affine') {
    mask.x = 2;
    mask.transform = [1, 0, 0.5, 1];
  }
  if (mode === 'nested') {
    const child = {
        id: 'child',
        name: 'Child',
        width: 40,
        height: 30,
        shapes: [{ ...mask, opacity: 1 }],
      },
      parent = {
        id: 'parent',
        name: 'Parent',
        width: 40,
        height: 30,
        shapes: [symbolInstance(child, 0, 0)],
      };
    p.symbols = [child, parent];
    mask = { ...symbolInstance(parent, 0, 0), opacity: 0.5 };
  }
  if (mode === 'button') {
    const child = {
      id: 'button',
      name: 'Button',
      width: 40,
      height: 30,
      shapes: [art('off', '#000000', -100, 1)],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...mask, opacity: 1 }] }] },
      buttonStates: { up: 1, over: 0, down: 0, hit: 0 },
    };
    p.symbols = [child];
    mask = { ...symbolInstance(child, 0, 0), opacity: 0.5 };
  }
  p.layers = [
    ['under', [art('under', '#0000ff')]],
    ['red', [art('red', '#ff0000', 2, 26, 0.5)]],
    ['green', [art('green', '#00ff00', 12, 26, 0.5)]],
    ['mask', [mask]],
    ['over', [art('over', '#ffff00', 34, 6)]],
  ].map(([id, shapes]) => ({
    ...newLayer(id as string),
    id: id as string,
    keys: [{ frame: 0, shapes: shapes as Vector[] }],
  }));
  if (mode === 'hidden') p.layers[3].visible = false;
  if (mode === 'empty') p.layers[3].keys[0].shapes = [];
  if (mode === 'union') p.layers[3].keys[0].shapes.push({ ...mask, id: 'other-mask' });
  return p;
}
const masks = [{ maskLayerId: 'mask', layerIds: ['red', 'green'] }];
async function setup(page: Page) {
  await page.goto('/');
  await page.addScriptTag({ content: code });
}
for (const mode of ['plain', 'nested', 'button', 'hidden', 'empty', 'affine', 'reflected', 'union'])
  for (const scale of [1, 2])
    test(`prepared layer Canvas alpha and same-view reuse ${mode}/${scale}`, async ({ page }) => {
      await setup(page);
      const result = await page.evaluate(
        async ({ p, masks, mode, scale }) => {
          const api = (window as unknown as { LayerScene: API }).LayerScene;
          let resolves = 0;
          const before = JSON.stringify(p);
          const scene = api.prepareLayerScene(p, 0, masks, (snapshot, frame) => {
            resolves++;
            return api.evaluateLayers(
              mode === 'button'
                ? api.rootButtonProject(
                    snapshot,
                    frame,
                    api.rootButtons(snapshot, frame),
                    null,
                    null,
                  )
                : snapshot,
              frame,
            );
          });
          const painter = await api.prepareMaskedLayerPainter(scene),
            c = document.createElement('canvas');
          c.width = 40 * scale;
          c.height = 30 * scale;
          const ctx = c.getContext('2d')!;
          ctx.scale(scale, scale);
          const native = CanvasRenderingContext2D.prototype.clearRect;
          let clears = 0;
          CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas !== c) clears++;
            return native.apply(this, args);
          };
          painter.paint(ctx);
          const first = clears,
            points = [
              [8, 8],
              [20, 8],
              [16, 12],
              [35, 8],
            ].map(([x, y]) => [...ctx.getImageData(x * scale, y * scale, 1, 1).data]);
          native.call(ctx, 0, 0, 40 * scale, 30 * scale);
          painter.paint(ctx);
          const second = clears;
          ctx.setTransform(scale, 0, 0, scale, scale, 0);
          painter.paint(ctx);
          const moved = clears;
          ctx.imageSmoothingEnabled = false;
          painter.paint(ctx);
          const smoothing = clears;
          painter.dispose();
          api.disposeLayerScene(scene);
          CanvasRenderingContext2D.prototype.clearRect = native;
          return {
            points,
            first,
            second,
            moved,
            smoothing,
            resolves,
            disposed: painter.disposed,
            same: JSON.stringify(p) === before,
            iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
          };
        },
        { p: fixture(mode), masks, mode, scale },
      );
      let first = [64, 0, 191, 255],
        second = [32, 64, 159, 255];
      if (mode === 'affine' || mode === 'reflected') first = [0, 0, 255, 255];
      if (mode === 'hidden' || mode === 'empty') first = second = [0, 0, 255, 255];
      if (mode === 'union') {
        // Each intermediate Canvas raster stores 8-bit premultiplied alpha.
        // Two half-alpha fills become192, and192*192/255 rounds to145.
        const half = Math.round(255 * 0.5),
          union = Math.round(half + half * (1 - half / 255));
        const maskedHalf = Math.round((half * union) / 255);
        first = [maskedHalf, 0, 255 - maskedHalf, 255];
        second = [
          Math.round((Math.round(half * (1 - half / 255)) * union) / 255),
          maskedHalf,
          255 - Math.round((union * union) / 255),
          255,
        ];
      }
      [first, second].forEach((expected, i) =>
        expected.forEach((n, j) =>
          expect(Math.abs(result.points[i][j] - n)).toBeLessThanOrEqual(1),
        ),
      );
      if (!['affine', 'reflected'].includes(mode))
        expect(result.points[2]).toEqual([0, 0, 255, 255]);
      expect(result.points[3]).toEqual([255, 255, 0, 255]);
      expect(result.first).toBeGreaterThan(0);
      expect(result.second).toBe(result.first);
      expect(result.moved).toBeGreaterThan(result.second);
      expect(result.smoothing).toBeGreaterThan(result.moved);
      expect(result.resolves).toBe(1);
      expect(result.disposed).toBe(true);
      expect(result.same).toBe(true);
      expect(result.iframes).toBe(0);
    });
for (const kind of ['source', 'revision', 'view', 'reentry', 'dispose', 'abort', 'fonts'] as const)
  test('prepared Canvas rejects late ' + kind + ' before target publication', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(
      async ({ p, masks, kind }) => {
        const api = (window as unknown as { LayerScene: API }).LayerScene;
        let revision = 0;
        const scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers, {
            validate: () => {
              if (revision) throw Error('revision changed');
            },
          }),
          controller = new AbortController(),
          painter = await api.prepareMaskedLayerPainter(scene, { signal: controller.signal }),
          c = document.createElement('canvas');
        c.width = 40;
        c.height = 30;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#123456';
        ctx.fillRect(0, 0, 40, 30);
        const before = [...ctx.getImageData(0, 0, 40, 30).data];
        const create = document.createElement.bind(document),
          canvases: HTMLCanvasElement[] = [];
        document.createElement = ((name: string, ...args: unknown[]) => {
          const element = create(name, ...(args as []));
          if (name === 'canvas') canvases.push(element as HTMLCanvasElement);
          return element;
        }) as typeof document.createElement;
        let calls = 0,
          error = '';
        try {
          painter.paint(ctx, () => {
            if (++calls === 2) {
              if (kind === 'source') p.background = '#00ff00';
              if (kind === 'revision') revision++;
              if (kind === 'view') ctx.translate(1, 0);
              if (kind === 'reentry')
                try {
                  painter.paint(ctx);
                } catch {
                  /* swallowed */
                }
              if (kind === 'dispose') api.disposeLayerScene(scene);
              if (kind === 'abort') controller.abort();
              if (kind === 'fonts') document.fonts.dispatchEvent(new Event('loading'));
            }
          });
        } catch (cause) {
          error = String(cause);
        }
        document.createElement = create;
        return {
          error,
          canvases: canvases.map((c) => [c.width, c.height]),
          same: JSON.stringify(before) === JSON.stringify([...ctx.getImageData(0, 0, 40, 30).data]),
          disposed: painter.disposed,
          calls,
        };
      },
      { p: fixture(), masks, kind },
    );
    expect(result.error).not.toBe('');
    expect(result.same).toBe(true);
    expect(result.disposed).toBe(true);
    expect(result.calls).toBe(2);
    expect(result.canvases).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });
test('decoded bitmap resources load once, deduplicate, survive view changes and close on dispose', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(
    async ({ p, masks }) => {
      const api = (window as unknown as { LayerScene: API }).LayerScene,
        source = document.createElement('canvas');
      source.width = 40;
      source.height = 30;
      const s = source.getContext('2d')!;
      s.fillStyle = '#ffffff';
      s.fillRect(0, 0, 20, 30);
      p.assets = [
        {
          id: 'image',
          path: 'assets/bitmaps/image.json',
          bitmap: { name: 'Image', width: 40, height: 30, dataUrl: source.toDataURL() },
        },
      ];
      p.layers[3].keys[0].shapes = [
        {
          id: 'bitmap-mask',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 40,
          height: 30,
          fill: '#000000',
          opacity: 0.5,
          stroke: '#000000',
          strokeWidth: 0,
          rotation: 0,
          points: [],
          bitmap: { assetId: 'image', x: 0, y: 0, width: 40, height: 30 },
        },
      ];
      p.assets.push({ ...p.assets[0], id: 'image-copy', path: 'assets/bitmaps/copy.json' });
      p.layers[3].keys[0].shapes.push({
        ...p.layers[3].keys[0].shapes[0],
        id: 'bitmap-copy',
        opacity: 0,
        bitmap: { ...p.layers[3].keys[0].shapes[0].bitmap!, assetId: 'image-copy' },
      });
      const decode = createImageBitmap;
      let decodes = 0,
        closed = 0;
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
      const scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
        painter = await api.prepareMaskedLayerPainter(scene),
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      painter.paint(ctx);
      const pixels = [
        [8, 8],
        [25, 8],
      ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      ctx.clearRect(0, 0, 40, 30);
      painter.paint(ctx);
      ctx.translate(1, 0);
      painter.paint(ctx);
      const active = decodes;
      painter.dispose();
      api.disposeLayerScene(scene);
      window.createImageBitmap = decode;
      return { pixels, active, decodes, closed };
    },
    { p: fixture(), masks },
  );
  expect(result.pixels).toEqual([
    [64, 0, 191, 255],
    [0, 0, 255, 255],
  ]);
  expect(result.active).toBe(1);
  expect(result.decodes).toBe(1);
  expect(result.closed).toBe(1);
});

for (const phase of ['ready', 'abort', 'source'] as const)
  test('font resource admission waits for actual text requests/' + phase, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(
      async ({ p, masks, phase }) => {
        const api = (window as unknown as { LayerScene: API }).LayerScene;
        p.layers[3].keys[0].shapes = [
          {
            id: 'glyph',
            kind: 'text',
            x: 0,
            y: 0,
            width: 40,
            height: 30,
            fill: '#ffffff',
            opacity: 0.5,
            stroke: '#000000',
            strokeWidth: 0,
            rotation: 0,
            points: [],
            text: {
              content: '█',
              font: 'sans-serif',
              size: 24,
              bold: false,
              italic: false,
              align: 'left',
            },
          },
        ];
        const fonts = document.fonts,
          load = fonts.load;
        let release: (() => void) | undefined,
          calls = 0,
          finished = false;
        fonts.load = function (...args) {
          calls++;
          return new Promise((resolve, reject) => {
            release = () => {
              load.apply(fonts, args).then(resolve, reject);
            };
          });
        };
        const scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
          controller = new AbortController(),
          pending = api
            .prepareMaskedLayerPainter(scene, { signal: controller.signal })
            .then((painter) => {
              finished = true;
              return painter;
            });
        await new Promise((r) => setTimeout(r, 20));
        const premature = finished;
        if (phase === 'abort') controller.abort(Error('font abort'));
        if (phase === 'source') p.background = '#00ff00';
        release!();
        let error = '',
          colored = 0;
        try {
          const painter = await pending,
            c = document.createElement('canvas');
          c.width = 40;
          c.height = 30;
          const ctx = c.getContext('2d')!;
          painter.paint(ctx);
          const pixels = ctx.getImageData(0, 0, 40, 30).data;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] > 0 && pixels[i + 2] > 0 && pixels[i + 1] === 0) colored++;
          painter.dispose();
        } catch (cause) {
          error = String(cause);
        } finally {
          fonts.load = load;
          api.disposeLayerScene(scene);
        }
        return { calls, premature, error, colored };
      },
      { p: fixture(), masks, phase },
    );
    expect(result.calls).toBe(1);
    expect(result.premature).toBe(false);
    if (phase === 'ready') {
      expect(result.error).toBe('');
      expect(result.colored).toBeGreaterThan(20);
    } else expect(result.error).toMatch(phase === 'abort' ? /font abort/ : /changed/);
  });

for (const phase of ['abort', 'source'] as const)
  test(
    'pending painter bitmap ownership rejects ' + phase + ' and closes its late image once',
    async ({ page }) => {
      await setup(page);
      const result = await page.evaluate(
        async ({ p, masks, phase }) => {
          const api = (window as unknown as { LayerScene: API }).LayerScene,
            c = document.createElement('canvas');
          c.width = 40;
          c.height = 30;
          c.getContext('2d')!.fillRect(0, 0, 40, 30);
          p.assets = [
            {
              id: 'image',
              path: 'assets/bitmaps/image.json',
              bitmap: { name: 'Image', width: 40, height: 30, dataUrl: c.toDataURL() },
            },
          ];
          p.layers[3].keys[0].shapes[0].bitmap = {
            assetId: 'image',
            x: 0,
            y: 0,
            width: 40,
            height: 30,
          };
          const scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
            controller = new AbortController(),
            decode = createImageBitmap;
          let closed = 0,
            decoded = 0;
          window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
            const image = await decode(...args),
              close = image.close.bind(image);
            decoded++;
            image.close = () => {
              closed++;
              close();
            };
            if (phase === 'abort') controller.abort(Error('decode abort'));
            else p.background = '#00ff00';
            return image;
          }) as typeof createImageBitmap;
          let error = '';
          try {
            await api.prepareMaskedLayerPainter(scene, { signal: controller.signal });
          } catch (cause) {
            error = String(cause);
          }
          await new Promise((r) => setTimeout(r, 0));
          window.createImageBitmap = decode;
          api.disposeLayerScene(scene);
          return { closed, decoded, error };
        },
        { p: fixture(), masks, phase },
      );
      expect(result.decoded).toBe(1);
      expect(result.closed).toBe(1);
      expect(result.error).toMatch(phase === 'abort' ? /decode abort/ : /changed/);
    },
  );
test('same-view raster cache cannot bypass source invalidation after a successful paint', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(
    async ({ p, masks }) => {
      const api = (window as unknown as { LayerScene: API }).LayerScene,
        scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
        painter = await api.prepareMaskedLayerPainter(scene),
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      painter.paint(ctx);
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 40, 30);
      const before = [...ctx.getImageData(0, 0, 40, 30).data];
      p.layers[1].keys[0].shapes[0].x++;
      let error = '';
      try {
        painter.paint(ctx);
      } catch (cause) {
        error = String(cause);
      }
      api.disposeLayerScene(scene);
      return {
        same: JSON.stringify(before) === JSON.stringify([...ctx.getImageData(0, 0, 40, 30).data]),
        error,
        disposed: painter.disposed,
      };
    },
    { p: fixture(), masks },
  );
  expect(result.error).toMatch(/changed/);
  expect(result.same).toBe(true);
  expect(result.disposed).toBe(true);
});

test('prepared presentation forwards independent movie clock values and invalidates their revision without advancing clocks', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(
    async ({ p, masks }) => {
      const api = (window as unknown as { LayerScene: API }).LayerScene;
      const red = p.layers[1].keys[0].shapes[0],
        movie = {
          id: 'movie',
          name: 'Movie',
          width: 40,
          height: 30,
          shapes: [red],
          timeline: { duration: 3, keys: [{ frame: 2, shapes: [{ ...red, x: 20, width: 6 }] }] },
        };
      p.symbols = [movie];
      p.layers[1].keys[0].shapes = [
        {
          id: 'instance',
          kind: 'symbol',
          symbolId: 'movie',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
          x: 0,
          y: 0,
          width: 40,
          height: 30,
          fill: '#000000',
          stroke: '#000000',
          strokeWidth: 0,
          rotation: 0,
          points: [],
        },
      ];
      const clocks = { 'red/instance/movie': 2 };
      let revision = 0;
      const prepare = () => {
        const captured = revision;
        return api.prepareLayerScene(p, 0, masks, (p, f) => api.evaluateLayers(p, f, clocks), {
          validate: () => {
            if (revision !== captured) throw Error('clock revision');
          },
        });
      };
      const scene = prepare(),
        painter = await api.prepareMaskedLayerPainter(scene),
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      painter.paint(ctx);
      const initial = [...ctx.getImageData(8, 8, 1, 1).data],
        retained = clocks['red/instance/movie'];
      clocks['red/instance/movie'] = 0;
      revision++;
      let error = '';
      try {
        painter.paint(ctx);
      } catch (cause) {
        error = String(cause);
      }
      const fresh = prepare(),
        next = await api.prepareMaskedLayerPainter(fresh);
      ctx.clearRect(0, 0, 40, 30);
      next.paint(ctx);
      const later = [...ctx.getImageData(8, 8, 1, 1).data];
      next.dispose();
      api.disposeLayerScene(scene);
      api.disposeLayerScene(fresh);
      return { initial, later, retained, final: clocks['red/instance/movie'], error };
    },
    { p: fixture(), masks },
  );
  expect(result.initial).toEqual([0, 0, 255, 255]);
  expect(result.later).toEqual([64, 0, 191, 255]);
  expect(result.retained).toBe(2);
  expect(result.final).toBe(0);
  expect(result.error).toMatch(/clock revision/);
});

test('panning immutable prepared artwork never repeats whole-geometry signature serialization', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(
    async ({ p, masks }) => {
      const api = (window as unknown as { LayerScene: API }).LayerScene,
        scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
        painter = await api.prepareMaskedLayerPainter(scene),
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      painter.paint(ctx);
      const points = api.withLayerScene(scene, (data) => data.layers[1].shapes[0].points),
        stringify = JSON.stringify;
      let signatures = 0;
      JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        if (Array.isArray(value) && value.includes(points)) signatures++;
        return stringify(value, ...(args as []));
      }) as typeof JSON.stringify;
      for (let i = 1; i <= 20; i++) {
        ctx.setTransform(1, 0, 0, 1, i % 3, 0);
        painter.paint(ctx);
      }
      JSON.stringify = stringify;
      painter.dispose();
      api.disposeLayerScene(scene);
      return signatures;
    },
    { p: fixture(), masks },
  );
  expect(result).toBe(0);
});

test('derived off-view large grouped symbol poses remain valid without normalizing authored metadata', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(
    async ({ p, masks }) => {
      const api = (window as unknown as { LayerScene: API }).LayerScene,
        red = { ...p.layers[1].keys[0].shapes[0], x: 1000, groups: ['inner'] };
      p.symbols = [{ id: 'large', name: 'Large', width: 1, height: 1, shapes: [red] }];
      p.layers[1].keys[0].shapes = [
        {
          id: 'instance',
          kind: 'symbol',
          symbolId: 'large',
          x: 2,
          y: 3,
          width: 1000000,
          height: 1000000,
          rotation: 0,
          fill: '#000000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ];
      const original = JSON.stringify(p),
        scene = api.prepareLayerScene(p, 0, masks, api.evaluateLayers),
        pose = api.withLayerScene(scene, (data) => ({
          x: data.layers[1].shapes[0].x,
          groups: data.layers[1].shapes[0].groups,
        })),
        painter = await api.prepareMaskedLayerPainter(scene),
        c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext('2d')!;
      painter.paint(ctx);
      const pixel = [...ctx.getImageData(8, 8, 1, 1).data];
      painter.dispose();
      api.disposeLayerScene(scene);
      return { pose, pixel, same: JSON.stringify(p) === original };
    },
    { p: fixture(), masks },
  );
  expect(result.pose).toEqual({ x: 1000000002, groups: ['instance/inner'] });
  expect(result.pixel).toEqual([0, 0, 255, 255]);
  expect(result.same).toBe(true);
});
