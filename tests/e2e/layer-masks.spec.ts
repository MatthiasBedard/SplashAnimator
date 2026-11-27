import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import {
  newProject,
  newLayer,
  validateProject,
  type Project,
  type Vector,
} from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import type { LayerMask } from '../../packages/document/src/layer-masks';
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'mask-test-oracle-export',
        enforce: 'pre',
        transform(source, id) {
          if (id.replaceAll('\\', '/').endsWith('/apps/editor/src/export-masked-png.ts'))
            return source + '\nexport {exportPNGFrame as legacyPNG};';
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'apps/editor/src/export-masked-png.ts',
        formats: ['iife'],
        name: 'MaskCapture',
        fileName: () => 'mask-capture.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((r) => r.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected a self-contained mask capture bundle.');
  code = chunks[0].code;
});
const rect = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  opacity = 1,
): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y,
  width,
  height,
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
    ...rect('mask-art', 0, 0, 40, 30, '#ffffff', 0.5),
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
  if (mode === 'black') mask.fill = '#000000';
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
    };
    const parent = {
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
    const art = { ...mask, opacity: 1 };
    const button = {
      id: 'button',
      name: 'Button',
      width: 40,
      height: 30,
      shapes: [rect('wrong', 0, 0, 1, 1, '#000000')],
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [art] },
          { frame: 2, shapes: [] },
          { frame: 3, shapes: [] },
        ],
      },
      buttonStates: { up: 1, over: 0, down: 2, hit: 3 },
    };
    p.symbols = [button];
    mask = { ...symbolInstance(button, 0, 0), opacity: 0.5 };
  }
  p.layers = [
    ['under', [rect('base', 0, 0, 40, 30, '#0000ff')]],
    ['red', [rect('red', 2, 2, 26, 26, '#ff0000', 0.5)]],
    ['green', [rect('green', 12, 2, 26, 26, '#00ff00', 0.5)]],
    ['mask', [mask]],
    ['over', [rect('top', 34, 0, 6, 30, '#ffff00')]],
  ].map(([id, shapes]) => ({
    ...newLayer(id as string),
    id: id as string,
    keys: [{ frame: 0, shapes: shapes as Vector[] }],
  }));
  if (mode === 'hidden') p.layers[3].visible = false;
  if (mode === 'empty') p.layers[3].keys.push({ frame: 2, shapes: [] });
  validateProject(p);
  return p;
}
async function setup(page: Page) {
  await page.goto('/');
  await page.addScriptTag({ content: code });
}
async function pixels(
  page: Page,
  p: Project,
  plan: LayerMask[],
  frame = 0,
  scale = 1,
  transparent = false,
) {
  return page.evaluate(
    async ({ p, plan, frame, scale, transparent }) => {
      const api = (
        window as unknown as {
          MaskCapture: typeof import('../../apps/editor/src/export-masked-png');
        }
      ).MaskCapture;
      const before = JSON.stringify(p),
        blob = await api.exportMaskedPNGFrame(p, frame, plan, { scale, transparent });
      const image = await createImageBitmap(blob),
        c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      c.getContext('2d')!.drawImage(image, 0, 0);
      image.close();
      const sample = (x: number, y: number) => [
        ...c.getContext('2d')!.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1)
          .data,
      ];
      return {
        points: [
          [8, 8],
          [20, 8],
          [16, 12],
          [3, 8],
          [35, 8],
        ].map(([x, y]) => sample(x, y)),
        same: JSON.stringify(p) === before,
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
        width: c.width,
        height: c.height,
      };
    },
    { p, plan, frame, scale, transparent },
  );
}
const plan = [{ maskLayerId: 'mask', layerIds: ['red', 'green'] }];
for (const mode of ['plain', 'black', 'nested', 'button', 'hidden', 'empty'])
  for (const scale of [1, 2])
    test(`transient mask alpha/group order/holes ${mode} scale ${scale}`, async ({ page }) => {
      await setup(page);
      const p = fixture(mode),
        result = await pixels(page, p, plan, mode === 'empty' ? 2 : 0, scale);
      const expected =
        mode === 'hidden' || mode === 'empty'
          ? [
              [0, 0, 255, 255],
              [0, 0, 255, 255],
            ]
          : [
              [64, 0, 191, 255],
              [32, 64, 159, 255],
            ];
      expected.forEach((color, i) =>
        color.forEach((value, j) =>
          expect(Math.abs(result.points[i][j] - value)).toBeLessThanOrEqual(1),
        ),
      );
      expect(result.points[2]).toEqual([0, 0, 255, 255]);
      expect(result.points[3]).toEqual([0, 0, 255, 255]);
      expect(result.points[4]).toEqual([255, 255, 0, 255]);
      expect(result.same).toBe(true);
      expect(result.iframes).toBe(0);
      expect([result.width, result.height]).toEqual([40 * scale, 30 * scale]);
    });
for (const mode of ['reflected', 'affine'])
  test('mask placement keeps original ' + mode + ' geometry', async ({ page }) => {
    await setup(page);
    const p = fixture(mode);
    const result = await pixels(page, p, plan);
    // The x8,y8 point is outside either transformed outer ring. x20,y8 is
    // inside it and outside the transformed hole; mask alpha is still exactly .5.
    expect(result.points[0]).toEqual([0, 0, 255, 255]);
    [32, 64, 159, 255].forEach((n, i) =>
      expect(Math.abs(result.points[1][i] - n)).toBeLessThanOrEqual(1),
    );
    expect(result.same).toBe(true);
  });
test('transparent mask multiplies combined target alpha once and never paints the source color', async ({
  page,
}) => {
  await setup(page);
  const p = fixture();
  p.layers[0].visible = false;
  p.layers[4].visible = false;
  const result = await pixels(page, p, plan, 0, 1, true);
  expect(result.points[0]).toEqual([255, 0, 0, 64]);
  expect(result.points[1][3]).toBeCloseTo(96, 0);
  expect(result.points[1][0]).toBeGreaterThan(80);
  expect(result.points[1][1]).toBeGreaterThan(165);
  expect(result.points[2]).toEqual([0, 0, 0, 0]);
  expect(result.points[3]).toEqual([0, 0, 0, 0]);
  expect(result.points[4]).toEqual([0, 0, 0, 0]);
});

test('empty mask plan preserves exact legacy PNG bytes and source data', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async (p) => {
    const api = (
      window as unknown as {
        MaskCapture: typeof import('../../apps/editor/src/export-masked-png') & {
          legacyPNG: typeof import('../../apps/editor/src/export-png').exportPNGFrame;
        };
      }
    ).MaskCapture;
    const legacy = await api.legacyPNG(p, 2, undefined, true, 2),
      masked = await api.exportMaskedPNGFrame(p, 2, [], { transparent: true, scale: 2 });
    return {
      legacy: [...new Uint8Array(await legacy.arrayBuffer())],
      masked: [...new Uint8Array(await masked.arrayBuffer())],
      iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
    };
  }, fixture());
  expect(result.masked).toEqual(result.legacy);
  expect(result.iframes).toBe(0);
});
test('bitmap mask decode readiness retains source alpha and transparent pixels', async ({
  page,
}) => {
  await setup(page);
  const p = fixture();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 20, 30);
    return c.toDataURL();
  });
  p.assets.push({
    id: 'mask-image',
    path: 'assets/bitmaps/mask.json',
    bitmap: { name: 'Mask', width: 40, height: 30, dataUrl: data },
  });
  p.layers[3].keys[0].shapes = [
    {
      ...rect('bitmap-mask', 0, 0, 40, 30, '#000000', 0.5),
      bitmap: { assetId: 'mask-image', x: 0, y: 0, width: 40, height: 30 },
    },
  ];
  const result = await pixels(page, p, plan);
  [64, 0, 191, 255].forEach((n, i) =>
    expect(Math.abs(result.points[0][i] - n)).toBeLessThanOrEqual(1),
  );
  expect(result.points[1]).toEqual([0, 0, 255, 255]);
  expect(result.points[4]).toEqual([255, 255, 0, 255]);
  expect(result.same).toBe(true);
  expect(result.iframes).toBe(0);
});
for (const phase of ['decode-source', 'decode-abort', 'encode-source', 'timeout'] as const)
  test('mask complete-output admission and raster cleanup at ' + phase, async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(
      async ({ p, plan, phase }) => {
        const api = (
          window as unknown as {
            MaskCapture: typeof import('../../apps/editor/src/export-masked-png');
          }
        ).MaskCapture;
        const controller = new AbortController(),
          decode = createImageBitmap,
          encode = HTMLCanvasElement.prototype.toBlob,
          create = document.createElement.bind(document);
        const canvases: HTMLCanvasElement[] = [];
        let images = 0,
          closed = 0,
          hook = false;
        document.createElement = ((name: string, ...args: unknown[]) => {
          const result = create(name, ...(args as []));
          if (name === 'canvas') canvases.push(result as HTMLCanvasElement);
          return result;
        }) as typeof document.createElement;
        window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
          const image = await decode(...args);
          images++;
          const close = image.close.bind(image);
          image.close = () => {
            closed++;
            close();
          };
          if (!hook && phase.startsWith('decode-')) {
            hook = true;
            if (phase === 'decode-source') p.background = '#00ff00';
            else controller.abort(Error('late decoder abort'));
          }
          return image;
        }) as typeof createImageBitmap;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
          return encode.call(
            this,
            (blob) => {
              if (!hook && phase === 'encode-source') {
                hook = true;
                p.background = '#00ff00';
              }
              callback(blob);
            },
            ...args,
          );
        };
        if (phase === 'timeout')
          Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
            configurable: true,
            set() {
              hook = true;
            },
          });
        let error = '';
        try {
          await api.exportMaskedPNGFrame(p, 0, plan, {
            signal: controller.signal,
            timeoutMs: phase === 'timeout' ? 50 : 60000,
          });
        } catch (cause) {
          error = String(cause);
        }
        await new Promise((r) => setTimeout(r, 50));
        window.createImageBitmap = decode;
        HTMLCanvasElement.prototype.toBlob = encode;
        document.createElement = create;
        return {
          error,
          hook,
          images,
          closed,
          canvases: canvases.map((c) => [c.width, c.height]),
          iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
          background: p.background,
        };
      },
      { p: fixture(), plan, phase },
    );
    expect(result.hook).toBe(true);
    expect(result.error).toMatch(
      phase === 'timeout' ? /timed out/ : phase === 'decode-abort' ? /abort/ : /changed/,
    );
    expect(result.closed).toBe(result.images);
    expect(result.canvases).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(result.iframes).toBe(0);
    if (phase.endsWith('source')) expect(result.background).toBe('#00ff00');
  });

for (const reverse of [false, true])
  test(
    'independent mask groups keep paint order and clear reusable alpha/' + reverse,
    async ({ page }) => {
      await setup(page);
      const p = fixture();
      p.layers.push(
        {
          ...newLayer('Upper paint'),
          id: 'upper',
          keys: [{ frame: 0, shapes: [rect('upper-art', 0, 0, 10, 30, '#ff00ff')] }],
        },
        {
          ...newLayer('Upper mask'),
          id: 'upper-mask',
          keys: [{ frame: 0, shapes: [rect('upper-source', 0, 0, 40, 30, '#000000', 0.5)] }],
        },
      );
      const groups = [...plan, { maskLayerId: 'upper-mask', layerIds: ['upper'] }];
      if (reverse) groups.reverse();
      const result = await pixels(page, p, groups);
      [160, 0, 223, 255].forEach((n, i) =>
        expect(Math.abs(result.points[0][i] - n)).toBeLessThanOrEqual(1),
      );
      [32, 64, 159, 255].forEach((n, i) =>
        expect(Math.abs(result.points[1][i] - n)).toBeLessThanOrEqual(1),
      );
      expect(result.points[4]).toEqual([255, 255, 0, 255]);
      expect(result.same).toBe(true);
      expect(result.iframes).toBe(0);
    },
  );
test('mask source nested movie uses exact replay entry clock and disappearance', async ({
  page,
}) => {
  await setup(page);
  const p = fixture(),
    art = { ...p.layers[3].keys[0].shapes[0], opacity: 1 };
  const movie = {
    id: 'mask-movie',
    name: 'Mask movie',
    width: 40,
    height: 30,
    shapes: [rect('off-view', -100, -100, 1, 1, '#ffffff')],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [art] },
        { frame: 2, shapes: [] },
      ],
    },
  };
  p.symbols = [movie];
  const instance = {
    ...symbolInstance(movie, 0, 0),
    opacity: 0.5,
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  p.layers[3].keys = [
    { frame: 0, shapes: [] },
    { frame: 1, shapes: [instance] },
    { frame: 3, shapes: [] },
  ];
  for (const frame of [0, 1, 2, 3]) {
    const result = await pixels(page, p, plan, frame);
    if (frame === 2) {
      [32, 64, 159, 255].forEach((n, i) =>
        expect(Math.abs(result.points[1][i] - n)).toBeLessThanOrEqual(1),
      );
    } else expect(result.points[1]).toEqual([0, 0, 255, 255]);
    expect(result.iframes).toBe(0);
    expect(result.same).toBe(true);
  }
});

test('component replays retain authored opacity outside saved root binding intervals',async({page})=>{
 await setup(page);const p=fixture();p.opacityBindings=[{layerId:'red',shapeId:'red',start:2,end:3,keys:[{frame:2,opacity:.8}]},{layerId:'mask',shapeId:'mask-art',start:2,end:3,keys:[{frame:2,opacity:.8}]}];
 const result=await pixels(page,p,plan,0);[64,0,191,255].forEach((n,i)=>expect(Math.abs(result.points[0][i]-n)).toBeLessThanOrEqual(1));[32,64,159,255].forEach((n,i)=>expect(Math.abs(result.points[1][i]-n)).toBeLessThanOrEqual(1));expect(result.same).toBe(true);expect(result.iframes).toBe(0);
});
