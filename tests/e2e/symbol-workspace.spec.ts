import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload, readWebExport } from './web-export-files';
import { exportHTML } from '../../packages/export-web/src';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { promises as fs } from 'node:fs';
import {
  newProject,
  newLayer,
  symbolLayers,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
import { symbolSimplifyFixture } from '../symbol-simplify-fixture';
import { symbolSimplifyFrameFixture } from '../symbol-simplify-frame-fixture';
import { prepareSymbolSimplifyRequest } from '../../packages/geometry/src/symbol-simplify-request';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
const errors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => expect(errors.get(page) ?? []).toEqual([]));

async function clickFrame(workspace: Locator, at: number, track = '@base') {
  const canvas = workspace.getByLabel('Timeline frames', { exact: true }),
    box = (await canvas.boundingBox())!,
    row = (await workspace.locator(`[data-symbol-layer="${track}"]`).boundingBox())!;
  await canvas.click({ position: { x: at * 18 + 8, y: row.y + row.height / 2 - box.y } });
}

async function setup(
  page: Page,
  movie = false,
  reflected = false,
  nested = false,
  references = false,
  extraLayer: boolean | number = false,
  baseTween = false,
  playbackChildren = false,
  placement?: 'rotated' | 'stretched' | 'skewed' | 'surrounding-masks' | 'mask-target' | 'mask-source' | 'grouped' | 'grouped-child' | 'gradient-skew' | 'node-skew' | 'attached-skew' | 'width-skew' | 'button' | 'library-cycle' | 'library-bitmap' | 'library-bitmap-fill' | 'editable-clipboard' | 'library-child' | 'magnified' | 'reduced' | 'oversized' | 'local-mask' | 'local-mask-members',
  denseMask = false,
) {
  const issues: string[] = [];
  errors.set(page, issues);
  page.on('pageerror', (e) => issues.push(String(e)));
  const p = newProject();
  if (placement === 'library-bitmap' || placement === 'library-bitmap-fill') {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 20;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 20, 20);
      return canvas.toDataURL('image/png');
    });
    p.assets.push({ id: 'tiles', path: 'assets/bitmaps/tiles.json', bitmap: { width: 20, height: 20, dataUrl, name: 'tiles.png' } });
  }
  p.width = 500;
  p.height = 300;
  p.duration = 16;
  p.layers[0].drawingMode = 'object';
  const art: Vector = {
    id: 'leaf',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 60,
    height: 40,
    rotation: 0,
    opacity: 1,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  if (placement === 'editable-clipboard') art.groups = ['portable-group'];
  if (placement === 'library-bitmap-fill') Object.assign(art, {
    kind: 'polygon', closed: true, fillRule: 'evenodd', contours: [
      [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }],
      [{ x: 20, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 20, y: 30 }],
    ],
  });
  const definition: SymbolDefinition = {
    id: 'clip',
    name: movie ? 'My movie' : 'My graphic',
    width: 100,
    height: 80,
    shapes: [art],
    ...(movie
      ? {
          defaultPlayback: 'movie' as const,
          timeline: {
            duration: 8,
            keys: [{ frame: 4, shapes: [{ ...structuredClone(art), fill: '#0000ff' }] }],
          },
        }
      : {}),
  };
  p.symbols = [definition];
  if (placement === 'button') {
    definition.name = 'My button';
    definition.buttonStates = { up: 1, over: 3, down: 5, hit: 7 };
    definition.timeline = { duration: 8, keys: [
      { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
      { frame: 3, shapes: [{ ...art, fill: '#0000ff' }] },
      { frame: 5, shapes: [{ ...art, fill: '#ff00ff' }] },
      { frame: 7, shapes: [{ ...art, fill: '#ffff00' }] },
    ] };
  }
  if (playbackChildren) {
    p.fps = 10;
    definition.timeline ??= {
      duration: 8,
      keys: [{ frame: 4, shapes: [{ ...art, fill: '#0000ff' }] }],
    };
    const child: SymbolDefinition = {
      id: 'animated-child',
      name: 'Animated child',
      width: 24,
      height: 24,
      shapes: [{ ...art, width: 24, height: 24, fill: '#ff0000' }],
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [{ ...art, width: 24, height: 24, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...art, width: 24, height: 24, fill: '#0000ff' }] },
        ],
      },
    };
    const graphic = symbolInstance(child, 68, 0);
    graphic.id = 'graphic-child';
    graphic.symbolPlayback = { mode: 'once', firstFrame: 0 };
    const clip = symbolInstance(child, 68, 34);
    clip.id = 'movie-child';
    clip.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    definition.timeline.layers = [
      {
        id: 'kids',
        name: 'Children',
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [graphic, clip] }],
      },
    ];
    p.symbols.push(child);
  }
  if (nested) {
    const child: SymbolDefinition = {
      id: 'child',
      name: 'Child',
      width: 60,
      height: 40,
      shapes: [structuredClone(art)],
    };
    p.symbols.push(child);
    const instance = symbolInstance(child, 5, 5);
    instance.id = 'nested';
    definition.shapes = [instance];
    if (placement === 'library-child') {
      child.shapes[0].groups = ['ink'];
      definition.shapes.push({ ...art, id: 'sibling', x: 72, y: 10, width: 20, height: 20, fill: '#00ff00' });
    }
    if (placement === 'grouped-child') {
      instance.groups = ['inside'];
      definition.shapes.push({ ...art, id: 'sibling', x: 72, y: 4, width: 20, height: 15, groups: ['inside'] });
    }
  }
  if (placement === 'library-cycle') p.symbols.push({
    id: 'wrapper', name: 'Wrap parent', width: 100, height: 80, shapes: [symbolInstance(definition, 0, 0)],
  });
  const first = symbolInstance(definition, reflected ? 200 : 100, 80);
  first.id = 'first';
  if (placement === 'oversized') {
    Object.assign(definition, { width: 12000, height: 400 });
    definition.shapes[0] = { ...art, x: 11000, y: 0, width: 900, height: 400, groups: ['ink'] };
    Object.assign(first, { x: -10900, width: 12000, height: 400 });
  }
  if (placement === 'reduced') {
    Object.assign(definition, { width: 2000, height: 1000 });
    definition.shapes[0] = { ...art, width: 1200, height: 800, groups: ['ink'] };
    Object.assign(first, { width: 80, height: 40 });
  }
  if (placement === 'magnified') {
    Object.assign(first, { x: 248, y: 148, width: 150, height: 160 });
    definition.shapes[0].groups = ['ink'];
  }
  if (reflected) first.transform = [-1, 0, 0, 1];
  if (placement === 'rotated') {
    first.rotation = 90;
    first.width *= 1.25;
    first.height *= 1.25;
  }
  if (placement === 'stretched') {
    first.width *= 1.25;
    first.height *= 0.5;
  }
  if (placement === 'skewed' || placement === 'gradient-skew' || placement === 'node-skew' || placement === 'attached-skew' || placement === 'width-skew') first.transform = [1.25, 0, 0.5, 0.5];
  if (placement === 'width-skew') {
    const brush: Vector = { ...art, kind: 'brush', strokeWidth: 40, fill: '#222222',
      brush: { pressure: true, minimum: 0.2, tilt: false, aspect: 1, angle: 90 },
      points: [{ x: 0, y: 20, pressure: 1 }, { x: 32, y: 20, pressure: 1 }, { x: 56, y: 20, pressure: 1 }],
    };
    definition.shapes = [brush];
    definition.timeline!.keys[0].shapes = [{ ...structuredClone(brush), fill: '#0000ff' }];
  }
  if (placement === 'attached-skew') {
    definition.shapes = [
      { ...art, kind: 'polygon', closed: true, fillRule: 'evenodd', contours: [
        [{ x: 0, y: 8 }, { x: 55, y: 8 }, { x: 55, y: 36 }, { x: 0, y: 36 }],
      ] },
      { ...art, id: 'stroke', kind: 'bezier', fillEnabled: false, stroke: '#223344', strokeWidth: 20,
        nodes: [{ x: 0, y: 8 }, { x: 55, y: 8 }] },
    ];
  }
  if (placement === 'node-skew') {
    definition.shapes[0] = { ...art, kind: 'bezier', closed: true, nodes: [
      { x: 0, y: 8, out: { x: 17, y: 8 } },
      { x: 55, y: 8, in: { x: 38, y: 8 } },
      { x: 55, y: 36 }, { x: 0, y: 36 },
    ] };
  }
  if (placement === 'gradient-skew') {
    definition.shapes[0] = { ...art, gradient: {
      kind: 'linear', from: { x: 0, y: 20 }, to: { x: 60, y: 20 },
      stops: [{ color: '#ff0000', offset: 0 }, { color: '#00ff00', offset: 0.5, opacity: 0.5 }, { color: '#0000ff', offset: 1 }],
    } };
  }
  const second = symbolInstance(definition, 300, 80);
  second.id = 'second';
  if (placement === 'local-mask') second.opacity = 0.5;
  p.layers[0].keys[0].shapes = [
    { ...art, id: 'background', x: 350, y: 180, fill: '#00ff00', width: 40, height: 40 },
    first,
    second,
  ];
  if (placement === 'grouped') {
    first.groups = ['isolated'];
    p.layers[0].keys[0].shapes[0].groups = ['isolated'];
  }
  if (references)
    p.layers[0].keys[0].shapes.push(
      { ...art, id: 'left-reference', x: -140, y: 120, width: 30, height: 30, fill: '#00ff00' },
      { ...art, id: 'right-reference', x: 690, y: 90, width: 30, height: 30, fill: '#ffff00' },
    );
  if (placement === 'surrounding-masks') {
    const group = (id: string, x: number, y: number, fill: string) => {
      const target = newLayer(id + ' paint'), mask = newLayer(id + ' mask');
      target.keys[0].shapes = [{ ...art, id: id + '-paint', x, y, fill }];
      mask.keys[0].shapes = [{ ...art, id: id + '-mask', x, y, width: 30 }];
      return { layers: [target, mask], binding: { maskLayerId: mask.id, layerIds: [target.id] } };
    };
    const below = group('Below', 20, 30, '#0000ff'), above = group('Above', 230, 80, '#00ff00');
    p.layers = [...below.layers, ...p.layers, ...above.layers];
    p.layerMasks = [below.binding, above.binding];
  }
  if (placement === 'mask-target') {
    const mask = newLayer('Instance mask');
    mask.keys[0].shapes = [{ ...art, id: 'instance-mask', x: 100, y: 80, width: 35, height: 75 }];
    if (denseMask) Object.assign(mask.keys[0].shapes[0], {
      kind: 'polygon', closed: true, contours: [[...Array.from({ length: 5000 }, (_, i) => ({
        x: i % 2 ? 0.2 : 0, y: 75 * i / 4999,
      })), { x: 35, y: 75 }, { x: 35, y: 0 }]], fillRule: 'evenodd',
    });
    p.layerMasks = [{ maskLayerId: mask.id, layerIds: [p.layers[0].id] }];
    p.layers.push(mask);
  }
  if (placement === 'mask-source') {
    const mask = newLayer('Instance mask');
    mask.keys[0].shapes = [first];
    p.layers[0].keys[0].shapes = [{ ...art, id: 'member', x: 100, y: 80, width: 100, height: 80, fill: '#00ff00' }];
    p.layerMasks = [{ maskLayerId: mask.id, layerIds: [p.layers[0].id] }];
    p.layers.push(mask);
  }
  if (extraLayer) {
    definition.timeline ??= { duration: 8, keys: [] };
    definition.timeline.layers = [
      {
        id: 'upper',
        name: 'Upper',
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [{ ...art, id: 'upper-art', fill: '#ff8800', x: placement?.startsWith('local-mask') ? 30 : 70 }] }],
      },
    ];
    if (typeof extraLayer === 'number')
      for (let n = 1; n < extraLayer; n++)
        definition.timeline.layers.push({
          id: `track-${n}`, name: `Track ${n}`, visible: true, locked: false,
          keys: [{ frame: 0, shapes: [] }],
        });
  }
  if (placement === 'local-mask-members') definition.timeline!.layers!.push({
    id: 'green', name: 'Green', visible: true, locked: false,
    keys: [{ frame: 0, shapes: [{ ...art, id: 'green-art', width: 45, fill: '#00ff00' }] }],
  });
  if (baseTween) {
    const layers = symbolLayers(definition);
    createBasicMotionSpan({ layers, duration: 8 }, ['@base'], 0, 4, 'linear', { paint: true });
    definition.timeline!.keys = layers[0].keys.slice(1);
    definition.timeline!.motionSpans = layers[0].motionSpans;
  }
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('symbol-workspace-seeded')) return;
    sessionStorage.setItem('symbol-workspace-seeded', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true }),
    workspace = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const screen = async (x: number, y: number) => {
    const b = (await stage.boundingBox())!;
    return { x: b.x + b.width / 2 + x - 250, y: b.y + b.height / 2 + y - 150 };
  };
  const pixel = async (canvas: ReturnType<Page['getByLabel']>, point: { x: number; y: number }) =>
    canvas.evaluate((c: HTMLCanvasElement, p) => {
      const b = c.getBoundingClientRect();
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.floor(((p.x - b.x) * c.width) / b.width),
            Math.floor(((p.y - b.y) * c.height) / b.height),
            1,
            1,
          ).data,
      );
    }, point);
  const open = async (kind: 'stage' | 'library' | 'context' = 'library', shared = false) => {
    if (kind === 'stage') {
      const q = await screen(reflected ? 190 : 110, 90);
      await page.mouse.dblclick(q.x, q.y);
    } else {
      const row = page.getByRole('option', {
        name: `Library item ${definition.name}`,
        exact: true,
      });
      await row.scrollIntoViewIfNeeded();
      if (kind === 'context') {
        await row.click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      } else await row.dblclick();
    }
    const sceneEditor = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
    await expect(sceneEditor.or(workspace)).toBeVisible();
    if (shared) {
      await expect(sceneEditor).toBeVisible();
      return;
    }
    if (await sceneEditor.isVisible())
      await sceneEditor.getByRole('button', { name: 'Advanced symbol timeline tools…' }).click();
    await expect(workspace).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(workspace.getByLabel('Symbol artwork preview', { exact: true })).toBeVisible();
  };
  const fill = async (color: string) =>
    workspace.getByLabel('Symbol artwork fill', { exact: true }).evaluate((el, color) => {
      const i = el as HTMLInputElement;
      i.value = color;
      i.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
  const frame = (at: number) => clickFrame(workspace, at);
  const save = () =>
    workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  return { p, definition, stage, workspace, read, screen, pixel, open, fill, frame, save };
}

test('symbol layer mask clips both scene instances and survives local and scene history', async ({ page }) => {
  const f = await setup(page, false, false, false, false, true, false, false, 'local-mask');
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255], orange = [255, 136, 0, 255];
  const sample = async (x: number) => f.pixel(f.stage, await f.screen(x, 95));
  const halfRed = (rgba: number[]) => rgba[0] === 255 && Math.abs(rgba[1] - 127.5) <= 1.5 &&
    rgba[1] === rgba[2] && rgba[3] === 255;
  await f.open('stage', true);
  const row = page.getByRole('group', { name: 'Layer row Upper', exact: true }).locator('button.layer-name');
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Convert to mask layer', exact: true }).click();
  await expect.poll(() => sample(145)).toEqual(red);
  await expect.poll(() => sample(115)).toEqual(white);
  await f.stage.press('Control+z');
  await expect.poll(() => sample(145)).toEqual(orange);
  await f.stage.press('Control+Shift+z');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  for (const x of [100, 300]) {
    await expect.poll(() => sample(x + 15)).toEqual(white);
    if (x === 100) await expect.poll(() => sample(x + 45)).toEqual(red);
    else await expect.poll(async () => halfRed(await sample(x + 45))).toBe(true);
    await expect.poll(() => sample(x + 75)).toEqual(white);
  }
  const expected = structuredClone(f.p);
  expected.schemaVersion = 60;
  expected.symbols![0].timeline!.layerMasks = [{ maskLayerId: 'upper', layerIds: ['@base'] }];
  await expect.poll(f.read).toEqual(expected);
  await f.stage.press('Control+Enter');
  await expect(page.getByText('Canvas2D fallback', { exact: true })).toBeVisible();
  const preview = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  const previewPixels = () => preview.evaluate((c: HTMLCanvasElement) => [115, 145, 175, 345].map(x =>
    Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data)));
  await expect.poll(async () => (await previewPixels()).slice(0, 3)).toEqual([white, red, white]);
  expect(halfRed((await previewPixels())[3])).toBe(true);
  await page.keyboard.press('Escape');
  const standalone = await page.context().newPage();
  await standalone.setContent(exportHTML(expected, 'sequence'));
  const capture = standalone.locator('canvas');
  await expect(capture).toHaveAttribute('data-capture', 'waiting');
  const pngPixels = await capture.evaluate(async (canvas: HTMLCanvasElement) => {
    canvas.dispatchEvent(new Event('capture-next'));
    if (canvas.dataset.capture !== 'ready') throw Error('Sequence frame was not rendered');
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG failed')), 'image/png'));
    const image = await createImageBitmap(blob);
    try {
      const copy = document.createElement('canvas');
      copy.width = image.width;
      copy.height = image.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [115, 145, 175, 345].map(x => Array.from(ctx.getImageData(x, 95, 1, 1).data));
    } finally { image.close(); }
  });
  expect(pngPixels.slice(0, 3)).toEqual([white, red, white]);
  expect(halfRed(pngPixels[3])).toBe(true);
  await standalone.goto('about:blank');
  await standalone.setContent(exportHTML(expected));
  const htmlPixels = () => standalone.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
    [115, 145, 175, 345].map(x => Array.from(canvas.getContext('2d')!.getImageData(x, 95, 1, 1).data)));
  await expect.poll(async () => (await htmlPixels()).slice(0, 3)).toEqual([white, red, white]);
  expect(halfRed((await htmlPixels())[3])).toBe(true);
  await standalone.close();
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await f.open('library', true);
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  await expect(page.getByLabel('Layer properties type')).toHaveValue('true');
});

test('movie-local masks advance in raster exports and beside an interactive button', async ({ page }) => {
  const { p, definition } = await setup(page, true, false, false, false, true, false, false, 'local-mask');
  p.schemaVersion = 60;
  definition.timeline!.layerMasks = [{ maskLayerId: 'upper', layerIds: ['@base'] }];
  const mask = definition.timeline!.layers![0].keys[0].shapes[0];
  definition.timeline!.layers![0].keys.push({ frame: 4, shapes: [{ ...mask, x: 0, width: 20 }] });
  const button = { ...structuredClone(definition), id: 'unused-button', name: 'Unused button',
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 } };
  delete button.defaultPlayback;
  delete button.timeline!.layerMasks;
  p.symbols!.push(button);
  const renderer = await page.context().newPage();
  await renderer.setContent(exportHTML(p, 'sequence'));
  const canvas = renderer.locator('canvas');
  await expect(canvas).toHaveAttribute('data-capture', 'waiting');
  const samples = await canvas.evaluate((c: HTMLCanvasElement) => Array.from({ length: 5 }, () => {
    c.dispatchEvent(new Event('capture-next'));
    if (c.dataset.capture !== 'ready') throw Error('Failed to capture movie frame');
    return [115, 145].map(x => Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data));
  }));
  const white = [255, 255, 255, 255];
  expect(samples.slice(0, 4)).toEqual(Array(4).fill([white, [255, 0, 0, 255]]));
  expect(samples[4]).toEqual([[0, 0, 255, 255], white]);
  await renderer.close();
  p.layers[0].keys[0].shapes.push({ ...p.layers[0].keys[0].shapes.find(shape => shape.kind === 'symbol')!, id: 'placed-button', symbolId: button.id,
    symbolPlayback: { mode: 'single', firstFrame: 0 } });
  const placed = p.layers[0].keys[0].shapes.at(-1)!;
  placed.x = 10;
  const artwork = button.shapes[0];
  button.timeline!.keys = [
    { frame: 1, shapes: [{ ...artwork, fill: '#ff00ff' }] },
    { frame: 2, shapes: [{ ...artwork, fill: '#00ffff' }] },
    { frame: 3, shapes: [artwork] },
  ];
  const mixed = await page.context().newPage();
  await mixed.setContent(exportHTML(p));
  const movie = mixed.locator('canvas');
  const color = (x: number) => movie.evaluate((c: HTMLCanvasElement, x) =>
    Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data), x);
  await expect.poll(() => color(20)).toEqual([255, 0, 0, 255]);
  const box = (await movie.boundingBox())!;
  await mixed.mouse.move(box.x + 20 * box.width / p.width, box.y + 95 * box.height / p.height);
  await expect.poll(() => color(20)).toEqual([255, 0, 255, 255]);
  await mixed.mouse.down();
  await expect.poll(() => color(20)).toEqual([0, 255, 255, 255]);
  await mixed.mouse.up();
  await expect(movie).toHaveAttribute('data-activations', '1');
  const maskPair = () => movie.evaluate((c: HTMLCanvasElement) =>
    [115, 145].map(x => Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data)));
  await expect.poll(maskPair, { intervals: [30, 50] }).toEqual([white, [255, 0, 0, 255]]);
  await expect.poll(maskPair, { intervals: [30, 50] }).toEqual([[0, 0, 255, 255], white]);
  await mixed.close();
  button.timeline!.layerMasks = structuredClone(definition.timeline!.layerMasks);
  const upper = button.timeline!.layers![0];
  upper.keys.splice(1, 0, { frame: 3, shapes: [
    { ...mask, x: 40, width: 12 },
    { ...mask, id: 'transparent-hit-source', x: 30, width: 6, opacity: 0 },
  ] });
  let files: Map<string, Buffer> | undefined;
  if (process.env.SPLASH_TEST_LICENSE) {
    await page.addInitScript(project => {
      if (window === window.top && location.hostname === '127.0.0.1')
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }, p);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const [file] = await Promise.all([page.waitForEvent('download'),
      exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }))]);
    files = await readWebDownload(file);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const [png] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click()]);
    const data = await fs.readFile((await png.path())!);
    const up = await page.evaluate(async bytes => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + bytes;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = image.width;
      copy.height = image.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [20, 54].map(x => Array.from(ctx.getImageData(x, 95, 1, 1).data));
    }, data.toString('base64'));
    expect(up).toEqual([white, [255, 0, 0, 255]]);
  }
  const masked = await page.context().newPage();
  if (files) await openWebExport(masked, files);
  else await masked.setContent(exportHTML(p));
  const panel = masked.locator('canvas');
  const px = (x: number) => panel.evaluate((c: HTMLCanvasElement, x) =>
    Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data), x);
  await expect.poll(() => px(54)).toEqual([255, 0, 0, 255]);
  expect(await px(20)).toEqual(white);
  const bounds = (await panel.boundingBox())!;
  const at = (x: number) => masked.mouse.move(bounds.x + x * bounds.width / p.width, bounds.y + 95 * bounds.height / p.height);
  for (const outside of [20, 43, 75]) {
    await at(outside);
    await masked.mouse.down();
    await masked.mouse.up();
    await expect(panel).toHaveAttribute('data-activations', '0');
  }
  await at(54);
  await expect.poll(() => px(54)).toEqual([255, 0, 255, 255]);
  await masked.mouse.down();
  await expect.poll(() => px(54)).toEqual([0, 255, 255, 255]);
  expect(await px(20)).toEqual(white);
  await masked.mouse.up();
  await expect(panel).toHaveAttribute('data-activations', '1');
  await masked.goto('about:blank');
  await masked.setContent(exportHTML(p, 0));
  await expect(panel).toHaveAttribute('data-capture', 'ready');
  expect(await px(20)).toEqual(white);
  expect(await px(54)).toEqual([255, 0, 0, 255]);
  await masked.close();
  if (process.env.SPLASH_TEST_LICENSE) {
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+Enter');
    const dialog = page.getByRole('dialog', { name: 'Test movie' });
    await expect(dialog.getByText('Canvas2D fallback', { exact: true })).toBeVisible();
    const preview = dialog.locator('canvas');
    const color = (x: number) => preview.evaluate((c: HTMLCanvasElement, x) =>
      Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data), x);
    await expect.poll(() => color(54)).toEqual([255,0,0,255]);
    expect(await color(20)).toEqual(white);
    await expect(dialog).toContainText('Button test:');
    const click = async (x: number) => {
      const rect = (await preview.boundingBox())!;
      await page.mouse.click(rect.x + x*rect.width/p.width, rect.y + 95*rect.height/p.height);
    };
    for (const outside of [20, 43, 75]) await click(outside);
    await expect(dialog).toContainText(/Activations:\s*0/);
    await click(54);
    await expect(dialog).toContainText(/Activations:\s*1/);
    await page.keyboard.press('Escape');
  }
});

for (const placement of ['scene and symbol','two scene','two symbol'] as const)
test(placement+' masks intersect for selection, Test Movie and exported playback', async ({ page }) => {
  const f = await setup(page, false, false, false, false, true, false, false, 'local-mask');
  const { p, definition } = f, art = definition.shapes[0];
  p.schemaVersion = 60;
  const child: SymbolDefinition = { id: 'button', name: 'Nested button', width: 60, height: 40,
    shapes: [art], buttonStates: { up: 0, over: 1, down: 2, hit: 3 }, timeline: { duration: 4, keys: [
      { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] }, { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
      { frame: 3, shapes: [art] },
    ] } };
  p.symbols!.push(child);
  definition.shapes = [symbolInstance(child, 0, 0)];
  definition.timeline!.layerMasks = [{ maskLayerId: 'upper', layerIds: ['@base'] }];
  Object.assign(definition.timeline!.layers![0].keys[0].shapes[0], { width: 20, opacity: 0.5 });
  p.layers[0].keys[0].shapes = [symbolInstance(definition, 100, 80)];
  const source = newLayer('Outer mask');
  source.keys[0].shapes = [{ ...art, id: 'outer-source', x: 140, y: 80, width: 20, opacity: 0.5 }];
  p.layerMasks = [{ maskLayerId: source.id, layerIds: [p.layers[0].id] }];
  p.layers.push(source);
  if (placement === 'two scene') {
    const inner = newLayer('Inner mask');
    inner.keys[0].shapes = [{ ...art, id: 'inner-source', x: 130, y: 80, width: 20, opacity: 0.5 }];
    for (const mask of [inner,source]) {
      const shape = mask.keys[0].shapes[0];
      shape.height = 20;
      mask.keys[0].shapes.push({...shape,id:shape.id+'-faint',y:100,opacity:0.04});
    }
    p.layers.splice(1,0,inner);
    p.layerMasks = [{ maskLayerId: source.id, layerIds: [inner.id] }, { maskLayerId: inner.id, layerIds: [p.layers[0].id] }];
    p.layers[0].keys[0].shapes = [symbolInstance(child,100,80)];
    p.symbols = [child];
  } else if (placement === 'two symbol') {
    p.layers.pop();
    delete p.layerMasks;
    definition.timeline!.layers!.push({ id: 'outer', name: 'Outer mask', visible: true, locked: false,
      keys: [{ frame: 0, shapes: [{ ...art, id:'outer-source', x:40, width:20, opacity:0.5 }] }] });
    definition.timeline!.layerMasks.push({ maskLayerId:'outer', layerIds:['upper'] });
  }
  await page.addInitScript(project => {
    if (window === window.top && location.hostname === '127.0.0.1')
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const white = [255,255,255,255], overlap = [255,191,191,255];
  const clickStage = async (x: number,y=95) => { const pt = await f.screen(x,y); await page.mouse.click(pt.x,pt.y); };
  const selection = page.getByRole('region', { name: 'Symbol instance', exact: true });
  if (placement === 'two scene') {
    expect(await f.pixel(f.stage,await f.screen(145,110))).toEqual(white);
    await clickStage(145,110);
    await expect(selection).toHaveCount(0);
  }
  for (const x of [135,155,145]) {
    expect(await f.pixel(f.stage, await f.screen(x,95))).toEqual(x === 145 ? overlap : white);
    await clickStage(x);
    await expect(selection).toHaveCount(x === 145 ? 1 : 0);
  }
  await clickStage(220);
  const outline = page.getByRole('button', { name: 'Toggle outline Outer mask' });
  if (placement !== 'two symbol') {
    await outline.click();
    await clickStage(135);
    await expect(selection).toHaveCount(1);
    await outline.click();
    await clickStage(220);
  }
  expect((await f.read()).layerMasks).toEqual(p.layerMasks);
  expect((await f.read()).symbols).toEqual(p.symbols);
  const clickCanvas = async (canvas: Locator, x: number, y=95) => {
    const box = (await canvas.boundingBox())!;
    await canvas.page().mouse.click(box.x + x*box.width/p.width, box.y + y*box.height/p.height);
  };
  const colors = (canvas: Locator) => canvas.evaluate((c: HTMLCanvasElement) =>
    [135,145,155].map(x => Array.from(c.getContext('2d')!.getImageData(x,95,1,1).data)));
  await f.stage.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie' }), movie = dialog.locator('canvas');
  await expect(dialog).toContainText('Button test:');
  await expect.poll(() => colors(movie)).toEqual([white,overlap,white]);
  for (const x of [135,155]) await clickCanvas(movie,x);
  if (placement === 'two scene') await clickCanvas(movie,145,110);
  await expect(dialog).toContainText(/Activations:\s*0/);
  await clickCanvas(movie,145);
  await expect(dialog).toContainText(/Activations:\s*1/);
  await page.keyboard.press('Escape');
  const output = await page.context().newPage(), canvas = output.locator('canvas');
  let files: Map<string, Buffer> | undefined;
  if (process.env.SPLASH_TEST_LICENSE) {
    const download = async (name: string) => {
      await page.getByRole('button', { name: 'File', exact: true }).click();
      const [file] = await Promise.all([page.waitForEvent('download'),
        name === 'Export HTML animation…'
          ? exportHtmlFromShortcut(page, page.getByRole('button', { name, exact: true }))
          : page.getByRole('button', { name, exact: true }).click()]);
      return fs.readFile((await file.path())!);
    };
    files = readWebExport(await download('Export HTML animation…'));
    const png = await download('Export current frame PNG…');
    const pixels = await page.evaluate(async bytes => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + bytes;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [135,145,155].map(x => Array.from(ctx.getImageData(x,95,1,1).data));
    }, png.toString('base64'));
    expect(pixels).toEqual([white,overlap,white]);
  }
  if (files) await openWebExport(output, files);
  else await output.setContent(exportHTML(p));
  await expect.poll(() => colors(canvas)).toEqual([white,overlap,white]);
  for (const x of [135,155]) await clickCanvas(canvas,x);
  if (placement === 'two scene') await clickCanvas(canvas,145,110);
  await expect(canvas).toHaveAttribute('data-activations','0');
  await clickCanvas(canvas,145);
  await expect(canvas).toHaveAttribute('data-activations','1');
  await output.goto('about:blank');
  await output.setContent(exportHTML(p,0));
  await expect(canvas).toHaveAttribute('data-capture','ready');
  expect(await colors(canvas)).toEqual([white,overlap,white]);
  await output.close();
});

for (const mode of ['loop', 'movie'] as const) test('masked '+mode+' ancestry clips nested button input across moving masks and reentry', async ({ page }) => {
  const { p, definition } = await setup(page, false, false, false, false, true, false, false, 'local-mask');
  p.schemaVersion = 60;
  p.fps = 10;
  const art = definition.shapes[0];
  const button: SymbolDefinition = {
    id: 'inner-button', name: 'Inner button', width: 100, height: 80, shapes: [art],
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
    timeline: { duration: 4, keys: [
      { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
      { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
      { frame: 3, shapes: [art] },
    ] },
  };
  p.symbols!.push(button);
  const child = symbolInstance(button, 0, 0);
  definition.shapes = [child];
  definition.timeline!.keys = [{ frame: 3, shapes: [] }, { frame: 4, shapes: [child] }];
  definition.timeline!.layerMasks = [{ maskLayerId: 'upper', layerIds: ['@base'] }];
  const upper = definition.timeline!.layers![0], mask = upper.keys[0].shapes[0];
  upper.keys.push({ frame: 2, shapes: [{ ...mask, x: 0, width: 20 }] });
  p.layers[0].keys[0].shapes = [{ ...symbolInstance(definition, 100, 80), symbolPlayback: { mode, firstFrame: 0 } }];
  p.layers[0].keys[0].shapes.push({ ...symbolInstance(definition, 300, 80), symbolPlayback: { mode, firstFrame: 2 } });
  if (process.env.SPLASH_TEST_LICENSE && mode === 'movie') {
    await page.addInitScript(project => {
      if (window === window.top && location.hostname === '127.0.0.1')
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }, p);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const [png] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click()]);
    const bytes = await fs.readFile((await png.path())!);
    const pixels = await page.evaluate(async data => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [115,145,315,345].map(x => Array.from(ctx.getImageData(x, 95, 1, 1).data));
    }, bytes.toString('base64'));
    expect(pixels).toEqual([[255,255,255,255],[255,0,0,255],[255,0,0,255],[255,255,255,255]]);
  }
  const editor = await page.context().newPage();
  type ClockWindow = Window & { maskMillis: number };
  await editor.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    const clock = window as unknown as ClockWindow;
    clock.maskMillis = 10000;
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(() => callback(clock.maskMillis));
  }, p);
  await editor.goto('/');
  await editor.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await editor.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const saved = await editor.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const stage = editor.getByLabel('Drawing stage', { exact: true });
  const moveClock = (time: number) => editor.evaluate(t => { (window as unknown as ClockWindow).maskMillis = t; }, time);
  const redPixel = [255,0,0], blank = [255,255,255], up = [blank,redPixel,redPixel,blank];
  const readPixels = (node: Locator, centered = false) => node.evaluate((c: HTMLCanvasElement, centered) => {
    const ctx = c.getContext('2d')!, scale = centered ? c.width / c.getBoundingClientRect().width : 1;
    return [115,145,315,345].map(x => Array.from(ctx.getImageData(
      centered ? c.width/2+(x-250)*scale : x, centered ? c.height/2-55*scale : 95, 1, 1).data).slice(0,3));
  }, centered);
  await stage.press('Enter');
  await expect.poll(() => readPixels(stage, true)).toEqual(up);
  await moveClock(10200);
  await expect.poll(() => readPixels(stage, true)).toEqual([redPixel,blank,redPixel,blank]);
  await moveClock(11600);
  await expect.poll(() => readPixels(stage, true)).toEqual(up);
  await stage.press('Enter');
  await moveClock(20000);
  await stage.press('Control+Enter');
  const dialog = editor.getByRole('dialog', { name: 'Test movie' });
  const preview = dialog.locator('canvas');
  await expect.poll(() => readPixels(preview)).toEqual(up);
  const bounds = (await preview.boundingBox())!;
  const aim = (x: number) => editor.mouse.move(bounds.x + x*bounds.width/p.width, bounds.y + 95*bounds.height/p.height);
  await aim(115); await editor.mouse.down(); await editor.mouse.up();
  await expect(dialog).toContainText(/Activations:\s*0/);
  await aim(145);
  await expect.poll(async () => (await readPixels(preview))[1]).toEqual([0,255,0]);
  await editor.mouse.down();
  await expect.poll(async () => (await readPixels(preview))[1]).toEqual([0,0,255]);
  await moveClock(20200);
  await expect.poll(async () => (await readPixels(preview))[1]).toEqual(blank);
  await editor.mouse.up();
  await expect(dialog).toContainText(/Activations:\s*0/);
  await aim(115); await editor.mouse.down();
  await moveClock(20300);
  await expect.poll(async () => (await readPixels(preview))[0]).toEqual(blank);
  await moveClock(20400);
  await expect.poll(async () => (await readPixels(preview))[0]).toEqual(redPixel);
  await editor.mouse.up();
  await expect(dialog).toContainText(/Activations:\s*0/);
  await aim(116); await editor.mouse.down(); await editor.mouse.up();
  await expect(dialog).toContainText(/Activations:\s*1/);
  await editor.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await editor.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(saved);
  await editor.close();
  const out = await page.context().newPage();
  await out.clock.install();
  await out.clock.pauseAt(new Date(Date.now() + 1000));
  await out.setContent(exportHTML(p));
  const canvas = out.locator('canvas');
  const pixel = (x: number) => canvas.evaluate((c: HTMLCanvasElement, x) =>
    Array.from(c.getContext('2d')!.getImageData(x, 95, 1, 1).data), x);
  const box = (await canvas.boundingBox())!;
  const point = (x: number) => out.mouse.move(box.x + x * box.width / p.width, box.y + 95 * box.height / p.height);
  const white = [255,255,255,255], red = [255,0,0,255];
  await out.clock.runFor(32);
  expect(await pixel(115)).toEqual(white);
  expect(await pixel(145)).toEqual(red);
  expect(await pixel(315)).toEqual(red);
  expect(await pixel(345)).toEqual(white);
  await point(115);
  await out.mouse.down(); await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '0');
  await point(145);
  await out.clock.runFor(16);
  expect(await pixel(145)).toEqual([0,255,0,255]);
  await out.mouse.down();
  await out.clock.runFor(16);
  expect(await pixel(145)).toEqual([0,0,255,255]);
  await out.clock.runFor(180);
  expect(await pixel(145)).toEqual(white);
  await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '0');
  await point(115);
  await out.mouse.down();
  await out.clock.runFor(120);
  expect(await pixel(115)).toEqual(white);
  await out.clock.runFor(100);
  expect(await pixel(115)).toEqual(red);
  await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '0');
  await point(116);
  await out.mouse.down(); await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '1');
  const mapped: SymbolDefinition = {
    id: 'mapped', name: 'Parent button', width: 100, height: 80, shapes: [symbolInstance(definition, 0, 0)],
    buttonStates: { up: 0, over: 0, down: 0, hit: 1 },
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [art] }] },
  };
  p.symbols!.push(mapped);
  p.layers[0].keys[0].shapes = [symbolInstance(mapped, 100, 80)];
  await out.goto('about:blank');
  await out.setContent(exportHTML(p));
  await out.clock.runFor(32);
  await canvas.evaluate(c => c.addEventListener('splash-button-activate', event => {
    c.setAttribute('data-chosen', (event as CustomEvent).detail.symbolId);
  }));
  await point(145); await out.clock.runFor(16);
  expect(await pixel(145)).toEqual([0,255,0,255]);
  await out.mouse.down(); await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-chosen', 'inner-button');
  await point(115); await out.mouse.down(); await out.mouse.up();
  await expect(canvas).toHaveAttribute('data-chosen', 'mapped');
  await out.clock.resume();
  if (mode === 'movie') {
    await page.addInitScript(project => {
      if (window === window.top && location.hostname === '127.0.0.1')
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    }, p);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+Enter');
    const movieDialog = page.getByRole('dialog', { name: 'Test movie' });
    await expect(movieDialog.getByText('Canvas2D fallback', { exact: true })).toBeVisible();
    const target = movieDialog.locator('canvas');
    await expect.poll(async () => (await readPixels(target))[1]).toEqual(redPixel);
    const rect = (await target.boundingBox())!;
    for (const [x, name, count] of [[145,'Inner button',1],[115,'Parent button',2]] as const) {
      await page.mouse.click(rect.x + x*rect.width/p.width, rect.y + 95*rect.height/p.height);
      await expect(movieDialog).toContainText('Button test: ' + name);
      await expect(movieDialog).toContainText(new RegExp('Activations:\\s*' + count));
    }
    await page.keyboard.press('Escape');
  }
  await out.close();
});

test('licensed PNG downloads symbol mask artwork authored through Properties and member drag', async ({ page }) => {
  test.skip(!process.env.SPLASH_TEST_LICENSE, 'Run with the matching signed licensing fixture.');
  const f = await setup(page, false, false, false, false, true, false, false, 'local-mask-members');
  await f.open('stage', true);
  const row = (name: string) => page.getByRole('group', { name: 'Layer row ' + name, exact: true });
  await row('Upper').locator('button.layer-name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  await dialog.getByLabel('Layer properties type').selectOption({ label: 'Mask' });
  await dialog.getByRole('button', { name: 'Apply layer properties' }).click();
  await row('Green').dragTo(row('Upper'));
  await row('Upper').locator('button.layer-name').click();
  await f.stage.press('Control+a');
  await f.stage.press('ArrowRight');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].timeline!.layerMasks)
    .toEqual([{ maskLayerId: 'upper', layerIds: ['@base', 'green'] }]);
  await expect.poll(async () => (await f.read()).symbols![0].timeline!.layers!
    .find(layer => layer.id === 'upper')!.keys[0].shapes[0].x).toBe(31);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click()]);
  const bytes = await fs.readFile((await download.path())!);
  const pixels = await page.evaluate(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [130, 135, 155, 175].map(x => Array.from(ctx.getImageData(x, 95, 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([[255,255,255,255], [0,255,0,255], [255,0,0,255], [255,255,255,255]]);
});

for (const shared of [true, false]) {
  test(`dragging from empty cells selects across ${shared ? 'shared' : 'separate'} symbol layers`, async ({ page }) => {
    const f = await setup(page, true, false, false, false, true);
    await f.open('stage', shared);
    const workspace = shared ? page.getByRole('main', { name: 'Symbol editing workspace' }) : f.workspace;
    const grid = workspace.getByLabel('Timeline frames', { exact: true });
    const rect = (await grid.boundingBox())!;
    const x = (at: number) => rect.x + at * 18 + 8;
    const y = (row: number) => rect.y + 39 + row * 28;
    const sample = (at: number, row: number) => grid.evaluate((element, p) => {
      const c = element as HTMLCanvasElement, box = c.getBoundingClientRect();
      return Array.from(c.getContext('2d')!.getImageData(
        Math.floor((p.x - box.left) * c.width / box.width),
        Math.floor((p.y - box.top) * c.height / box.height), 1, 1,
      ).data);
    }, { x: x(at) + 3, y: y(row) - 7 });
    const drag = async (start: number, end: number) => {
      await page.mouse.move(x(start), y(1));
      await page.mouse.down();
      await page.mouse.move(x(end), y(0), { steps: 5 });
      await page.mouse.up();
    };
    const readout = workspace.locator('.frame-readout'), end = f.definition.timeline!.duration;
    await drag(end + 1, end + 5);
    await expect(readout).toHaveText(`Frame 1 / ${end}`);
    for (const row of [0, 1]) await expect.poll(() => sample(end + 3, row)).toEqual([98, 84, 138, 255]);
    await grid.press('Escape');
    await expect.poll(() => sample(end + 3, 1)).toEqual([34, 37, 43, 255]);
    await drag(end + 3, end - 4);
    for (const row of [0, 1]) await expect.poll(() => sample(end + 1, row)).toEqual([98, 84, 138, 255]);
    await expect(readout).toHaveText(`Frame ${end - 3} / ${end}`);
    expect(await f.read()).toEqual(f.p);
  });
}

test('symbol timeline wheel zoom changes frame hit testing', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  const frames = f.workspace.getByLabel('Timeline frames', { exact: true });
  const box = (await frames.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 10);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(box.x + 108, box.y + 40);
  await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 5 / 8');
  await page.mouse.move(box.x + 4, box.y + 10);
  await page.mouse.wheel(0, 100);
  await page.mouse.click(box.x + 108, box.y + 40);
  await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 7 / 8');
  await expect(frames).toHaveAccessibleDescription(/Frame 7 of 8\. Layer .+\. Use Left and Right/);
  await frames.focus();
  await page.keyboard.press('End');
  await expect(frames).toHaveAccessibleDescription(/Frame 8 of 8\. Layer .+/);
  expect(await f.read()).toEqual(f.p);
});

test('symbol instance properties edit only the selected placement', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, true);
  const panel = page.getByRole('region', { name: 'Symbol instance', exact: true });
  const name = panel.getByLabel('Symbol instance name'),
    type = panel.getByLabel('Symbol instance type'),
    playback = panel.getByLabel('Symbol playback', { exact: true }),
    firstFrame = panel.getByLabel('Symbol first frame'),
    swap = panel.getByLabel('Swap symbol'),
    x = panel.getByLabel('Shape X', { exact: true }),
    opacity = panel.getByRole('spinbutton', { name: 'Object opacity', exact: true });
  await expect(panel).toHaveCount(0);
  const point = await f.screen(110, 90);
  await page.mouse.click(point.x, point.y);
  await expect(panel).toBeVisible();
  await expect(type).toHaveValue('movie');
  await expect(playback).toHaveCount(0);
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveCount(0);
  await type.selectOption('graphic');
  await expect(playback).toHaveValue('loop');
  await playback.selectOption('single');
  await firstFrame.fill('2');
  await firstFrame.press('Tab');
  await name.fill('  Lead clip  ');
  await name.press('Tab');
  await expect(name).toHaveValue('Lead clip');
  await x.fill('105');
  await x.press('Tab');
  await opacity.fill('60');
  await opacity.press('Tab');
  const beforeSwap = structuredClone(f.p);
  Object.assign(beforeSwap.layers[0].keys[0].shapes[1], {
    instanceName: 'Lead clip',
    symbolPlayback: { mode: 'single', firstFrame: 1 },
    opacity: 0.6,
    x: 105,
  });
  await expect.poll(f.read).toEqual(beforeSwap);
  await swap.selectOption('animated-child');
  const swapped = structuredClone(beforeSwap);
  swapped.layers[0].keys[0].shapes[1].symbolId = 'animated-child';
  await expect.poll(f.read).toEqual(swapped);
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([102, 255, 102, 255]);
  await expect(name).toHaveValue('Lead clip');
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(beforeSwap);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(swapped);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(f.read).toEqual(swapped);
  const second = await f.screen(310, 90);
  await page.mouse.click(second.x, second.y);
  await expect(name).toHaveValue('');
  await expect(type).toHaveValue('movie');
  await expect(swap).toHaveValue('clip');
});

test('symbol instance swap rejects a circular reference in symbol editing', async ({ page }) => {
  const f = await setup(page, false, false, true);
  await f.open('stage', true);
  const point = await f.screen(110, 90);
  await page.mouse.click(point.x, point.y);
  const panel = page.getByRole('region', { name: 'Symbol instance', exact: true });
  const swap = panel.getByLabel('Swap symbol');
  await expect(swap).toHaveValue('child');
  await swap.selectOption('clip');
  await expect(swap).toHaveValue('child');
  await expect(page.getByText(/cycle/i)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  const name = panel.getByLabel('Symbol instance name');
  await name.fill('Nested placement');
  await name.press('Tab');
  await expect(name).toHaveValue('Nested placement');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].shapes[0].instanceName).toBe('Nested placement');
  expect((await f.read()).layers).toEqual(f.p.layers);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared scene editor keeps the stage, tools and timeline while editing a movie in place', async ({ page }) => {
  const f = await setup(page, true);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const tools = page.getByLabel('Drawing tools', { exact: true });
  for (const el of [f.stage, timeline, tools])
    await el.evaluate(node => node.setAttribute('data-original-scene-element', 'true'));
  const art = await f.screen(130, 100), reference = await f.screen(365, 190);
  await f.open('stage', true);
  for (const el of [f.stage, timeline, tools])
    await expect(el).toHaveAttribute('data-original-scene-element', 'true');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([178, 255, 178, 255]);
  const right = page.getByRole('region', { name: 'Timeline', exact: true });
  await timeline.click({ position: { x: 44, y: 40 } });
  await expect(right.locator('.frame-readout')).toContainText('Frame 3');
  await timeline.press('F6');

  await tools.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser mode').selectOption('objects');
  await page.mouse.click(art.x, art.y);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 255, 255, 255]);
  await expect(page.getByText('Erase merge drawing', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 255, 255, 255]);

  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].timeline!.keys.map(key => [key.frame, key.shapes.length])).toEqual([[2, 0], [4, 1]]);
  expect((await f.read()).layers).toEqual(f.p.layers);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared scene editor edits mapped Button artwork in place and opens at Up from the Library', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'button');
  const art = await f.screen(130, 100), reference = await f.screen(365, 190);
  await f.open('stage', true);
  const scene = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const states = scene.getByRole('group', { name: 'Button states', exact: true });
  const state = (name: string) => states.getByRole('button', { name, exact: true });
  await expect(state('Up')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 255, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([178, 255, 178, 255]);
  await state('Down').click();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 255, 255]);
  await state('Hit').click();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 255, 0, 255]);
  await state('Over').click();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 0, 255, 255]);

  await scene.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Eraser', exact: true }).click();
  await scene.getByLabel('Eraser mode').selectOption('objects');
  await page.mouse.click(art.x, art.y);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 0, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 255, 255, 255]);

  await scene.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const expected = structuredClone(f.p);
  expected.symbols![0].timeline!.keys.find(key => key.frame === 3)!.shapes = [];
  await expect.poll(f.read).toEqual(expected);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await f.open('library', true);
  await expect(state('Up')).toHaveAttribute('aria-pressed', 'true');
  await scene.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);

  await f.open('library');
  await f.workspace.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Button state frames', exact: true })).toBeVisible();
});

test('shared scene editor remaps Button frames with local history and one document save', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'button');
  const art = await f.screen(130, 100);
  await f.open('stage', true);
  const scene = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const input = scene.getByRole('spinbutton', { name: 'Button Up frame', exact: true });
  const jump = scene.getByRole('group', { name: 'Button states', exact: true }).getByRole('button', { name: 'Up', exact: true });
  const setUp = async (value: string) => {
    await input.fill(value);
    await input.press('Tab');
  };
  await expect(input).toHaveValue('2');
  await setUp('9');
  await expect(input).toHaveValue('2');
  await expect(jump).toHaveAttribute('title', 'Frame 2');
  await setUp('4');
  await expect(input).toHaveValue('4');
  await jump.click();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect(input).toHaveValue('2');
  await f.stage.press('Control+Shift+z');
  await expect(input).toHaveValue('4');
  await scene.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);

  await f.open('stage', true);
  await expect(input).toHaveValue('2');
  await setUp('4');
  await scene.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const expected = structuredClone(f.p);
  expected.symbols![0].buttonStates!.up = 3;
  await expect.poll(f.read).toEqual(expected);
  await f.open('stage', true);
  await expect(jump).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 0, 255, 255]);
  await scene.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared scene editor opens from the Library and cancels a drawing without publishing it', async ({ page }) => {
  const f = await setup(page);
  await f.open('library', true);
  const editor = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const tools = editor.getByLabel('Drawing tools', { exact: true });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await editor.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const b = (await f.stage.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2 - 35, b.y + b.height / 2 - 30);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => f.pixel(f.stage, { x: b.x + b.width / 2, y: b.y + b.height / 2 })).toEqual([0, 204, 255, 255]);
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel symbol editing' }).click();
  await expect(editor).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
});

test('shared scene editor plays the local movie timeline and independent nested clips', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, true);
  const art = await f.screen(130, 100);
  const graphic = await f.screen(180, 95), movie = await f.screen(180, 125);
  await f.open('stage', true);
  const grid = page.getByLabel('Timeline frames', { exact: true });
  await grid.click({ position: { x: 62, y: 40 } });
  const readout = page.getByRole('region', { name: 'Timeline', exact: true }).locator('.frame-readout');
  await expect(readout).toContainText('Frame 4');
  await expect(page.getByRole('region', { name: 'Timeline', exact: true }).getByText('0.30 s', { exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 500));
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(readout).toContainText('Frame 4');
  await page.clock.runFor(125);
  await expect(readout).toContainText('Frame 5');
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(f.stage, graphic)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(f.stage, movie)).toEqual([0, 255, 0, 255]);
  await page.getByRole('button', { name: 'Stop playback' }).click();
  expect(await f.read()).toEqual(f.p);
});

test('child of a clean Library parent keeps its placement and faded sibling', async ({ page }) => {
  const f = await setup(page, false, false, true, false, false, false, false, 'library-child');
  await f.open('library', true);
  const bounds = (await f.stage.boundingBox())!;
  const origin = { x: bounds.x + bounds.width / 2 - 50, y: bounds.y + bounds.height / 2 - 40 };
  const child = { x: origin.x + 12, y: origin.y + 12 };
  const sibling = { x: origin.x + 80, y: origin.y + 20 };
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  await expect.poll(() => f.pixel(f.stage, sibling)).toEqual([0, 255, 0, 255]);
  await page.mouse.dblclick(child.x, child.y);
  await expect(crumbs).toContainText('Child');
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, sibling)).toEqual([178, 255, 178, 255]);
  await f.stage.press('Control+a');
  await f.stage.press('ArrowRight');
  await crumbs.getByRole('button', { name: 'My graphic', exact: true }).click();
  await expect(crumbs).not.toContainText('Child');
  await expect.poll(() => f.pixel(f.stage, sibling)).toEqual([0, 255, 0, 255]);
  await f.stage.press('Control+z');
  await f.stage.press('Control+Shift+z');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const expected = structuredClone(f.p);
  expected.symbols![1].shapes[0].x++;
  await expect.poll(f.read).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const entry of ['stage', 'library'] as const) {
  test('oversized definition retains far-edge artwork from ' + entry, async ({ page }) => {
    const f = await setup(page, false, false, false, false, false, false, false, 'oversized');
    await f.open(entry, true);
    await expect(page.getByText('12000 × 400 px', { exact: false }).first()).toBeVisible();
    const b = (await f.stage.boundingBox())!;
    const z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
    const ink = entry === 'stage' ? await f.screen(115, 96) :
      { x: b.x + b.width / 2 + 5500 * z, y: b.y + b.height / 2 };
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 0, 0, 255]);
    await page.mouse.click(ink.x, ink.y);
    await f.stage.press('ArrowRight');
    await f.stage.press('Control+z');
    await f.stage.press('Control+Shift+z');
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const expected = structuredClone(f.p);
    expected.symbols![0].shapes[0].x++;
    await expect.poll(f.read).toEqual(expected);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}

test('reduced instance supports snapped dragging and gradual zoom below five percent', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'reduced');
  await f.open('stage', true);
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await expect(zoom).toHaveValue('0.04');
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await view.click();
  const pick = await f.screen(115, 90), edge = await f.screen(103, 92);
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255];
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(red);
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await page.mouse.move(pick.x + 9, pick.y, { steps: 4 });
  await page.mouse.up();
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(red);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(white);
  await page.mouse.wheel(0, -50);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(0.04 * Math.exp(0.1), 5);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  const moved = saved.symbols![0].shapes[0];
  expect(moved.x).toBeGreaterThanOrEqual(200);
  expect(moved.x).toBeLessThanOrEqual(240);
  expect(moved.x % 20).toBe(0);
  const expected = structuredClone(f.p);
  expected.symbols![0].shapes[0].x = moved.x;
  expect(saved).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('enlarged instance keeps its screen geometry at maximum scene zoom', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'magnified');
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await zoom.selectOption('20');
  const center = await f.screen(250, 150);
  const edge = { x: center.x - 28, y: center.y };
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255];
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(red);
  await page.mouse.dblclick(center.x, center.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace' })).toBeVisible();
  await expect(zoom).toHaveValue('30');
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(red);
  await f.stage.press('Control+a');
  await f.stage.press('ArrowRight');
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(white);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, edge)).toEqual(red);
  await f.stage.press('Control+Shift+z');
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(30 * Math.exp(-0.2));
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect(zoom).toHaveValue('20');
  const expected = structuredClone(f.p);
  expected.symbols![0].shapes[0].x++;
  await expect.poll(f.read).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('nested stage entry keeps the clean parent camera after zoom and pan', async ({ page }) => {
  const f = await setup(page, false, false, true);
  const child = await f.screen(117, 97);
  await f.open('stage', true);
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await page.mouse.move(child.x, child.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
  const parentZoom = await zoom.inputValue();
  const moved = { x: child.x + 90, y: child.y + 30 };
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(moved.x, moved.y, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => f.pixel(f.stage, moved)).toEqual([255, 0, 0, 255]);
  await page.mouse.dblclick(moved.x, moved.y);
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  await expect(crumbs).toContainText('Child');
  await expect(zoom).toHaveValue(parentZoom);
  await expect.poll(() => f.pixel(f.stage, moved)).toEqual([255, 0, 0, 255]);
  await crumbs.getByRole('button', { name: 'My graphic', exact: true }).click();
  await expect(crumbs).not.toContainText('Child');
  await expect(zoom).toHaveValue(parentZoom);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(zoom).toHaveValue('1');
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
});

test('shared scene editor opens a nested graphic in place and returns to the parent through its breadcrumb', async ({ page }) => {
  const f = await setup(page, true, false, true);
  const nested = await f.screen(115, 95);
  await f.open('stage', true);
  await page.mouse.dblclick(nested.x, nested.y);
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  await expect(crumbs).toContainText('Child');
  await expect.poll(() => f.pixel(f.stage, nested)).toEqual([255, 0, 0, 255]);
  await crumbs.getByRole('button', { name: 'My movie', exact: true }).click();
  await expect(crumbs).toContainText('My movie');
  await expect(crumbs).not.toContainText('Child');
  expect(await f.read()).toEqual(f.p);
});
test('shared nested editing opens from a dirty parent and saves both drafts together', async ({ page }) => {
  const f = await setup(page, true, false, true);
  const child = await f.screen(115, 95), ink = await f.screen(178, 136);
  const tools = page.getByLabel('Drawing tools', { exact: true });
  const choose = (name: string) => tools.getByRole('button', { name, exact: true }).click();
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  const openChild = async () => {
    await choose('Selection');
    await page.mouse.dblclick(child.x, child.y);
    await expect(crumbs).toContainText('Child');
    await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([178, 178, 255, 255]);
  };
  await f.open('stage', true);
  await choose('Rectangle');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#0000ff');
  await page.mouse.move(ink.x - 8, ink.y - 8);
  await page.mouse.down();
  await page.mouse.move(ink.x + 8, ink.y + 8, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
  await openChild();
  await crumbs.getByRole('button', { name: 'My movie', exact: true }).click();
  await expect(crumbs).not.toContainText('Child');
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
  const eraseChild = async () => {
    await openChild();
    await choose('Eraser');
    await page.getByLabel('Eraser mode').selectOption('objects');
    await page.mouse.click(child.x, child.y);
    await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 255, 255, 255]);
  };
  await eraseChild();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(crumbs).not.toContainText('Child');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
  await eraseChild();
  const save = page.getByRole('button', { name: 'Save and return to scene', exact: true });
  await save.click();
  await expect(page.getByText(/Keep artwork on at least one frame of the symbol/)).toBeVisible();
  await expect(crumbs).toContainText('Child');
  expect(await f.read()).toEqual(f.p);
  await choose('Rectangle');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
  await page.mouse.move(child.x - 6, child.y - 6);
  await page.mouse.down();
  await page.mouse.move(child.x + 6, child.y + 6, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([0, 255, 0, 255]);
  await save.click();
  await expect.poll(async () => (await f.read()).symbols![1].shapes[0].fill).toBe('#00ff00');
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes[0]).toEqual(f.p.symbols![0].shapes[0]);
  expect(saved.symbols![0].shapes[1]).toMatchObject({ kind: 'rectangle', x: 70, y: 48, width: 16, height: 16, fill: '#0000ff' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared nested Apply returns to the parent with local Undo and deferred scene Save', async ({ page }) => {
  const f = await setup(page, true, false, true);
  const child = await f.screen(115, 95), ink = await f.screen(178, 136);
  const choose = (name: string) => page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name, exact: true }).click();
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  const apply = page.getByRole('button', { name: 'Apply child edits and return to parent', exact: true });
  const cancel = page.getByRole('button', { name: 'Cancel symbol editing', exact: true });
  const draw = async (color: string, point: { x: number; y: number }) => {
    await choose('Rectangle');
    await page.getByLabel('Drawing fill', { exact: true }).fill(color);
    await page.mouse.move(point.x - 7, point.y - 7);
    await page.mouse.down();
    await page.mouse.move(point.x + 7, point.y + 7, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => f.pixel(f.stage, point)).toEqual(color === '#0000ff' ? [0, 0, 255, 255] : [0, 255, 0, 255]);
  };
  const openChild = async () => {
    await choose('Selection');
    await page.mouse.dblclick(child.x, child.y);
    await expect(crumbs).toContainText('Child');
  };
  const editAndApply = async (rejectEmpty: boolean) => {
    await f.open('stage', true);
    await draw('#0000ff', ink);
    await openChild();
    await choose('Eraser');
    await page.getByLabel('Eraser mode').selectOption('objects');
    await page.mouse.click(child.x, child.y);
    await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 255, 255, 255]);
    await expect(apply).toBeVisible();
    if (rejectEmpty) {
      await apply.click();
      await expect(page.getByText(/Keep artwork on at least one frame of the symbol/)).toBeVisible();
      await expect(crumbs).toContainText('Child');
      expect(await f.read()).toEqual(f.p);
      await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
      await expect.poll(() => f.screen(115, 95)).toEqual(child);
    }
    await draw('#00ff00', child);
    await apply.click();
    await expect(crumbs).not.toContainText('Child');
    await expect.poll(() => f.pixel(f.stage, child)).toEqual([0, 255, 0, 255]);
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
    expect(await f.read()).toEqual(f.p);
  };
  await editAndApply(true);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([0, 255, 0, 255]);
  await openChild();
  await expect.poll(() => f.pixel(f.stage, child)).toEqual([0, 255, 0, 255]);
  await cancel.click();
  await cancel.click();
  expect(await f.read()).toEqual(f.p);

  await editAndApply(false);
  await draw('#0000ff', await f.screen(190, 153));
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![1].shapes[0].fill).toBe('#00ff00');
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes[0]).toEqual(f.p.symbols![0].shapes[0]);
  expect(saved.symbols![0].shapes[1]).toMatchObject({ x: 71, y: 49, width: 14, height: 14, fill: '#0000ff' });
  expect(saved.symbols![0].shapes[2]).toMatchObject({ x: 83, y: 66, width: 14, height: 14, fill: '#0000ff' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('advanced timeline edits stay local to a child with its parent draft suspended', async ({ page }) => {
  const f = await setup(page, true, false, true);
  const child = await f.screen(115, 95), ink = await f.screen(178, 136);
  const choose = (name: string) => page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name, exact: true }).click();
  await f.open('stage', true);
  await choose('Rectangle');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#0000ff');
  await page.mouse.move(ink.x - 7, ink.y - 7);
  await page.mouse.down();
  await page.mouse.move(ink.x + 7, ink.y + 7, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 0, 255, 255]);
  await choose('Selection');
  await page.mouse.dblclick(child.x, child.y);
  await expect(page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' })).toContainText('Child');
  const tools = page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const duration = dialog.getByLabel('Symbol duration', { exact: true });
  const setDuration = async () => { await duration.fill('4'); await duration.press('Tab'); };
  await tools.click();
  await setDuration();
  await dialog.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await tools.click();
  await expect(duration).toHaveValue('1');
  await setDuration();
  const frame = dialog.getByLabel('Symbol frame', { exact: true });
  await frame.fill('3');
  await frame.press('Tab');
  await dialog.getByRole('button', { name: 'Insert blank symbol keyframe', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await tools.click();
  await expect(duration).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await f.stage.press('Control+Shift+z');
  await tools.click();
  await expect(duration).toHaveValue('4');
  await dialog.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![1].timeline).toEqual({ duration: 4, keys: [{ frame: 2, shapes: [] }] });
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes[1]).toMatchObject({ x: 71, y: 49, width: 14, height: 14, fill: '#0000ff' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('advanced timeline edits preserve unsaved top-level symbol artwork', async ({ page }) => {
  const f = await setup(page, true);
  const ink = await f.screen(178, 136);
  const color = [0, 204, 255, 255];
  const draw = async () => {
    const drawingTools = page.getByLabel('Drawing tools', { exact: true });
    await drawingTools.getByRole('button', { name: 'Selection', exact: true }).click();
    await f.open('stage', true);
    await page.getByRole('button', { name: 'Add layer', exact: true }).click();
    await page.getByRole('combobox', { name: 'Drawing mode', exact: true }).selectOption('object');
    await drawingTools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
    await page.mouse.move(ink.x - 7, ink.y - 7);
    await page.mouse.down();
    await page.mouse.move(ink.x + 7, ink.y + 7, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual(color);
  };
  await draw();

  const tools = page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const duration = dialog.getByLabel('Symbol duration', { exact: true });
  const open = async (expected: string) => {
    await tools.click();
    await expect(duration).toHaveValue(expected);
  };
  const changeDuration = async () => { await duration.fill('10'); await duration.press('Tab'); };
  const cancel = async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(tools).toBeFocused();
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual(color);
    await expect(page.getByRole('combobox', { name: 'Drawing mode', exact: true })).toHaveValue('object');
  };
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/SymbolTimeline-*.js', async route => {
    requested = true;
    await held;
    await route.continue();
  });
  await tools.click();
  const loading = page.getByRole('dialog', { name: 'Loading symbol tools', exact: true });
  const cancelLoading = loading.getByRole('button', { name: 'Cancel symbol loading', exact: true });
  try {
    await expect(loading).toBeVisible();
    await expect.poll(() => requested).toBe(true);
    await expect(cancelLoading).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancelLoading).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancelLoading).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(loading).toHaveCount(0);
    await expect(tools).toBeFocused();
    expect(await f.read()).toEqual(f.p);
  } finally {
    release();
  }
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
    .some(entry => /\/assets\/SymbolTimeline-.*\.js$/.test(entry.name)))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(color);
  await expect(tools).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(duration).toHaveValue('8');
  await changeDuration();
  await cancel();
  await open('8');
  await changeDuration();
  await dialog.getByRole('button', { name: 'Apply symbol timeline', exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(tools).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await open('8');
  await cancel();
  await f.stage.press('Control+Shift+z');
  await open('10');
  await cancel();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);

  await draw();
  await open('8');
  await changeDuration();
  await dialog.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].timeline?.duration).toBe(10);
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].timeline?.keys).toEqual(f.definition.timeline?.keys);
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  const savedLayer = saved.symbols![0].timeline!.layers![0];
  expect(savedLayer.drawingMode).toBe('object');
  expect(savedLayer.keys[0].shapes[0]).toMatchObject({ kind: 'rectangle', x: 71, y: 49, width: 14, height: 14, fill: '#00ccff' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared symbol conversion stages a new nested graphic until scene Save', async ({ page }) => {
  const f = await setup(page);
  const point = await f.screen(120, 95);
  const workspace = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  const convert = async (createLayer = false) => {
    await f.open('stage', true);
    await page.mouse.click(point.x, point.y);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const action = page.getByRole('button', { name: 'Convert to symbol…', exact: true });
    await expect(action).toBeEnabled();
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
    await dialog.getByLabel('Symbol name', { exact: true }).fill('Nested Artwork');
    const submit = dialog.getByRole('button', { name: 'Convert selection', exact: true });
    if (createLayer) await dialog.getByLabel('Create new layer', { exact: true }).check();
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
  };
  const row = page.getByRole('option', { name: 'Library item Nested Artwork', exact: true });
  await convert(true);
  await expect(row).toHaveCount(1);
  await f.stage.press('Control+z');
  await expect(row).toHaveCount(0);
  await f.stage.press('Control+Shift+z');
  await expect(row).toHaveCount(1);
  await page.mouse.dblclick(point.x, point.y);
  await expect(crumbs).toContainText('Nested Artwork');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
  await workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(crumbs).not.toContainText('Nested Artwork');
  await workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);

  await convert();
  await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols?.length).toBe(2);
  const saved = await f.read(), parent = saved.symbols![0], child = saved.symbols![1];
  expect(saved.layers).toEqual(f.p.layers);
  expect(child).toEqual({ id: child.id, name: 'Nested Artwork', width: 60, height: 40, shapes: f.definition.shapes });
  expect(parent.shapes).toHaveLength(1);
  expect(parent.shapes[0]).toMatchObject({ kind: 'symbol', symbolId: child.id, x: 0, y: 0, width: 60, height: 40, symbolPlayback: { mode: 'loop', firstFrame: 0 } });
  expect(saved.libraryLinks).toContainEqual({ kind: 'symbol', id: child.id, name: 'Nested_Artwork' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared Library placement rejects cyclic symbols and saves a valid instance locally', async ({ page }) => {
  const f = await setup(page, false, false, true, false, false, false, false, 'library-cycle');
  const point = await f.screen(175, 130);
  await f.open('stage', true);
  const place = async (name: string) => {
    const row = page.getByRole('option', { name: `Library item ${name}`, exact: true });
    await row.click({ button: 'right' });
    const action = page.getByRole('menuitem', { name: 'Place symbol', exact: true });
    await expect(action).toBeVisible();
    await action.click();
  };
  for (const name of [f.definition.name, 'Wrap parent']) {
    await place(name);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/cycle/i);
    await alert.getByRole('button', { name: 'Dismiss' }).click();
    expect(await f.read()).toEqual(f.p);
  }
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 255, 255, 255]);
  await place('Child');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].shapes.length).toBe(2);
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols!.slice(1)).toEqual(f.p.symbols!.slice(1));
  expect(saved.symbols![0].shapes[0]).toEqual(f.definition.shapes[0]);
  expect(saved.symbols![0].shapes[1]).toMatchObject({ kind: 'symbol', symbolId: 'child', x: 20, y: 20, width: 60, height: 40 });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared Library bitmap placement keeps the asset and existing artwork through local history', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'library-bitmap');
  const point = await f.screen(155, 125);
  const originalArt = await f.screen(130, 100);
  const workspace = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const bitmap = page.getByRole('option', { name: 'Library item tiles.png', exact: true });
  const place = async () => {
    await f.open('stage', true);
    await bitmap.click({ button: 'right' });
    const menuitem = page.getByRole('menuitem', { name: 'Place bitmap on stage', exact: true });
    await expect(menuitem).toBeVisible();
    await menuitem.click();
    await expect.poll(() => f.pixel(f.stage, point)).toEqual([0, 255, 0, 255]);
    await expect.poll(() => f.pixel(f.stage, originalArt)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
  };
  await place();
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([0, 255, 0, 255]);
  await workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await place();
  await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await f.read()).symbols![0].timeline?.layers?.[0].name).toBe('Bitmaps');
  const saved = await f.read(), definition = saved.symbols![0], layer = definition.timeline!.layers![0];
  expect(saved.assets).toEqual(f.p.assets);
  expect(saved.layers).toEqual(f.p.layers);
  expect(definition.shapes).toEqual(f.definition.shapes);
  expect(layer.drawingMode).toBe('object');
  expect(layer.keys[0].shapes[0]).toMatchObject({ kind: 'rectangle', x: 40, y: 30, width: 20, height: 20, bitmap: { assetId: 'tiles', x: 0, y: 0, width: 20, height: 20 } });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared editable clipboard keeps vectors in local history until Save', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const f = await setup(page, false, false, false, false, false, false, false, 'editable-clipboard');
  await f.open('stage', true);
  await expect(page.getByRole('combobox', { name: 'Drawing mode', exact: true })).toHaveValue('object');
  await f.stage.press('Control+a');
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  const copy = page.getByRole('button', { name: 'Copy editable Splash Artwork JSON', exact: true });
  const paste = page.getByRole('button', { name: 'Paste editable Splash Artwork JSON', exact: true });
  const original = f.p.symbols![0].shapes[0];
  await edit.click();
  await copy.click();
  await expect(page.getByText('Copied editable Splash Artwork JSON', { exact: true })).toBeVisible();
  const clipboard = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(clipboard).toEqual({ format: 'splash-artwork-1', artwork: [original] });
  const moved = { ...original, x: 70 };
  await page.evaluate(text => navigator.clipboard.writeText(text), JSON.stringify({ ...clipboard, artwork: [moved] }));
  const ink = await f.screen(185, 100);
  await edit.click();
  await expect(page.getByRole('button', { name: 'Paste PNG from system clipboard', exact: true })).toBeDisabled();
  await paste.click();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 0, 0, 255]);
  await expect(page.getByRole('region', { name: 'Group selection', exact: true })).toContainText('1 vectors selected');
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  const inserted = saved.symbols![0].shapes[1];
  expect(inserted.id).not.toBe(original.id);
  expect(inserted.groups).toHaveLength(1);
  expect(inserted.groups![0]).not.toBe(original.groups![0]);
  const expected = structuredClone(f.p);
  expected.symbols![0].shapes.push({ ...moved, id: inserted.id, groups: inserted.groups });
  expect(saved).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const format of ['editable Splash Artwork JSON', 'plain text from clipboard']) {
  test(`shared clipboard rejects ${format} that completes after Cancel`, async ({ page }) => {
    const f = await setup(page, false, false, false, false, false, false, false, 'editable-clipboard');
    await f.open('stage', true);
    await page.evaluate(() => {
      document.body.dataset.clipboardRead = 'waiting';
      Object.defineProperty(navigator.clipboard, 'readText', {
        value: () => new Promise<string>(resolve => {
          document.body.dataset.clipboardRead = 'pending';
          document.body.addEventListener('clipboard-fixture-release', () => resolve(document.body.dataset.clipboardPayload!), { once: true });
        }),
      });
    });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: `Paste ${format}`, exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-clipboard-read', 'pending');
    await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    await page.evaluate(({ artwork, plain }) => {
      document.body.dataset.clipboardPayload = plain ? 'Late clipboard text' : JSON.stringify({ format: 'splash-artwork-1', artwork });
      document.body.dispatchEvent(new Event('clipboard-fixture-release'));
    }, { artwork: f.p.symbols![0].shapes, plain: format.startsWith('plain') });
    await expect(page.getByRole('alert')).toContainText('clipboard paste destination changed');
    expect(await f.read()).toEqual(f.p);
  });
}

test('shared canvas clipboard pastes editable plain text and preserves native input focus', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const f = await setup(page);
  await f.open('stage', true);
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('Native input');
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Native clipboard test');
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('Control+v');
  await expect(page.getByRole('textbox', { name: 'Native clipboard test' })).toHaveValue('Native input');
  await page.getByRole('textbox', { name: 'Native clipboard test' }).evaluate(input => input.remove());
  await page.evaluate(() => navigator.clipboard.writeText('a'.repeat(10001)));
  await f.stage.press('Control+v');
  await expect(page.getByRole('alert')).toContainText('10,000 characters');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  const paste = page.getByRole('button', { name: 'Paste plain text from clipboard', exact: true });
  await page.evaluate(() => navigator.clipboard.writeText('Menu paste'));
  await edit.click();
  await paste.click();
  await expect(page.locator('footer').getByText('Paste clipboard text', { exact: true })).toBeVisible();
  await f.stage.press('Control+z');
  await page.evaluate(() => navigator.clipboard.writeText('First line\r\nSecond line'));
  await f.stage.press('Control+v');
  await expect(page.locator('footer').getByText('Paste clipboard text', { exact: true })).toBeVisible();
  await expect(f.stage).toBeFocused();
  await f.stage.press('Control+z');
  await expect(page.getByText('Clipboard', { exact: true })).toHaveCount(0);
  await f.stage.press('Control+Shift+z');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read(), layers = saved.symbols![0].timeline?.layers;
  expect(layers).toHaveLength(1);
  expect(layers![0]).toMatchObject({ name: 'Clipboard', drawingMode: 'object', keys: [
    { frame: 0, shapes: [{ kind: 'text', text: { content: 'First line\nSecond line' } }] },
  ] });
  expect(saved.symbols![0].shapes).toEqual(f.p.symbols![0].shapes);
  expect(saved.assets).toEqual(f.p.assets);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared symbol rejects a clipboard image read completed after Cancel', async ({ page }) => {
  const f = await setup(page);
  await f.open('stage', true);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'read', {
      value: () => new Promise(resolve => {
        document.body.dataset.imageRead = 'pending';
        document.body.addEventListener('release-image', () => {
          resolve([new ClipboardItem({ 'image/png': new Blob(['stale'], {type: 'image/png'}) })]);
        }, { once: true });
      }),
    });
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Paste image or text from clipboard', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-image-read', 'pending');
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.evaluate(() => document.body.dispatchEvent(new Event('release-image')));
  await expect(page.getByRole('alert')).toContainText('clipboard paste destination changed');
  expect(await f.read()).toEqual(f.p);
});

test('pasted clipboard bitmap and placement share symbol and scene history', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const f = await setup(page);
  await f.open('stage', true);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#33aa22';
    ctx.fillRect(0, 0, 32, 24);
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await f.stage.press('Control+v');
  await expect(page.locator('footer')).toContainText('Paste clipboard image');
  const ink = await f.screen(158, 126);
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([51, 170, 34, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect(page.getByText('Clipboard', { exact: true })).toHaveCount(0);
  await f.stage.press('Control+Shift+z');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.assets).toHaveLength(f.p.assets.length + 1);
  const asset = saved.assets.at(-1)!;
  expect(asset.bitmap?.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(saved.symbols![0].timeline?.layers?.at(-1)?.keys[0].shapes).toMatchObject([
    { kind: 'rectangle', x: 34, y: 28, width: 32, height: 24, bitmap: { assetId: asset.id } },
  ]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const finish of ['save', 'cancel'] as const) {
  test('external raster drop in a shared symbol supports ' + finish, async ({ page }) => {
    const f = await setup(page);
    await f.open('stage', true);
    const drop = await f.screen(180, 130), ink = await f.screen(186, 135);
    async function dropFiles(invalid: boolean) {
      await f.stage.evaluate(async (stage, { drop, invalid }) => {
        const tile = document.createElement('canvas');
        tile.width = tile.height = 20;
        const ctx = tile.getContext('2d')!;
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, 20, 20);
        const blob = await new Promise<Blob>(resolve => tile.toBlob(value => resolve(value!)));
        const data = new DataTransfer();
        data.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
        if (invalid) data.items.add(new File(['invalid image'], 'bad.png', { type: 'image/png' }));
        const init = { dataTransfer: data, clientX: drop.x, clientY: drop.y, bubbles: true, cancelable: true };
        stage.dispatchEvent(new DragEvent('dragover', init));
        stage.dispatchEvent(new DragEvent('drop', init));
      }, { drop, invalid });
    }
    if (finish === 'cancel') {
      await dropFiles(true);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('option', { name: 'Library item drop.png', exact: true })).toHaveCount(0);
      expect(await f.read()).toEqual(f.p);
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    }
    await dropFiles(false);
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 255, 0, 255]);
    expect(await f.read()).toEqual(f.p);
    if (finish === 'cancel') {
      await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      expect(await f.read()).toEqual(f.p);
      return;
    }
    await f.stage.press('Control+z');
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
    await f.stage.press('Control+Shift+z');
    await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 255, 0, 255]);
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const saved = await f.read();
    expect(saved.assets).toHaveLength(1);
    expect(saved.assets[0].bitmap?.name).toBe('drop.png');
    const placed = saved.symbols![0].timeline!.layers![0].keys[0].shapes;
    expect(placed).toMatchObject([{ bitmap: { assetId: saved.assets[0].id } }]);
    expect(placed[0].x).toBeCloseTo(70, 0);
    expect(placed[0].y).toBeCloseTo(40, 0);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}

test('dragging a Library bitmap onto the shared canvas stays local until Save', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'library-bitmap');
  await f.open('stage', true);
  const drop = await f.screen(180, 130);
  const ink = await f.screen(186, 135);
  const bounds = (await f.stage.boundingBox())!;
  await page.getByRole('option', { name: 'Library item tiles.png', exact: true }).dragTo(f.stage, {
    targetPosition: { x: drop.x - bounds.x, y: drop.y - bounds.y },
  });
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 255, 0, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.assets).toEqual(f.p.assets);
  const artwork = saved.symbols![0].timeline?.layers?.[0].keys[0].shapes;
  expect(artwork).toMatchObject([{ bitmap: { assetId: 'tiles' } }]);
  expect(artwork![0].x).toBeCloseTo(70, 0);
  expect(artwork![0].y).toBeCloseTo(40, 0);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared Library bitmap fill preserves compound contours and local history', async ({ page }) => {
  const f = await setup(page, false, false, false, false, false, false, false, 'library-bitmap-fill');
  const paint = await f.screen(111, 91), hole = await f.screen(123, 105);
  await f.open('stage', true);
  const item = page.getByRole('option', { name: 'Library item tiles.png', exact: true });
  const apply = page.getByRole('menuitem', { name: 'Apply bitmap fill', exact: true });
  await item.click({ button: 'right' });
  await expect(apply).toBeDisabled();
  await page.keyboard.press('Escape');
  await f.stage.press('Control+a');
  await item.click({ button: 'right' });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect.poll(() => f.pixel(f.stage, paint)).toEqual([0, 255, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, hole)).toEqual([255, 255, 255, 255]);
  await expect(page.getByLabel('Selected fill', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, paint)).toEqual([255, 0, 0, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, paint)).toEqual([0, 255, 0, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = structuredClone(f.p);
  Object.assign(saved.symbols![0].shapes[0], {
    fillEnabled: true, bitmap: { assetId: 'tiles', x: 0, y: 0, width: 60, height: 40 },
  });
  await expect.poll(f.read).toEqual(saved);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared in-place symbol editing retains the rotated scene camera and local drawing coordinates', async ({ page }) => {
  const f = await setup(page, true);
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  const turn = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  for (let i = 0; i < 6; i++) await turn.click();
  await view.click();
  const canvas = (await f.stage.boundingBox())!;
  const screen = (x: number, y: number) => ({
    x: canvas.x + canvas.width / 2 - (y - 150),
    y: canvas.y + canvas.height / 2 + (x - 250),
  });
  const art = screen(130, 100), reference = screen(365, 190);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await page.mouse.dblclick(art.x, art.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([178, 255, 178, 255]);
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = screen(125, 130), end = screen(145, 148), ink = screen(135, 139);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 25, y: 50, width: 20, height: 18,
  }));
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([0, 255, 0, 255]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.dblclick(art.x, art.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  await view.click();
  await page.getByRole('button', { name: 'Reset stage view rotation', exact: true }).click();
  await view.click();
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.p);
});
for (const placement of ['rotated', 'stretched', 'skewed', 'reflected'] as const) {
test(`a ${placement} instance opens in the shared editor without shifting artwork`, async ({ page }) => {
  const reflected = placement === 'reflected';
  const f = await setup(page, true, reflected, false, false, false, false, false, reflected ? undefined : placement);
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  const turn = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  for (let i = 0; i < 6; i++) await turn.click();
  await view.click();
  const canvas = (await f.stage.boundingBox())!;
  const screen = (x: number, y: number) => ({
    x: canvas.x + canvas.width / 2 - (y - 150),
    y: canvas.y + canvas.height / 2 + (x - 250),
  });
  const local = (x: number, y: number) => {
    if (reflected) return screen(200 - x, 80 + y);
    if (placement === 'rotated') return screen(100 - 1.25 * y, 80 + 1.25 * x);
    return screen(100 + 1.25 * x + (placement === 'skewed' ? 0.5 * y : 0), 80 + 0.5 * y);
  };
  const art = local(24, 20), reference = screen(365, 190);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await page.mouse.dblclick(art.x, art.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  const expanded = local(63, 20);
  await expect.poll(() => f.pixel(f.stage, expanded)).toEqual([255, 255, 255, 255]);
  await page.mouse.move(art.x, art.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => f.pixel(f.stage, expanded)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.mouse.dblclick(art.x, art.y);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([178, 255, 178, 255]);
  if (placement === 'skewed' || reflected) {
    const corner = local(60, 40), target = local(80, 44), changed = local(68, 20);
    await page.mouse.click(art.x, art.y);
    await page.mouse.move(corner.x, corner.y);
    await expect(f.stage).toHaveCSS('cursor', reflected ? 'nwse-resize' : 'ns-resize');
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await expect.poll(() => f.pixel(f.stage, changed)).toEqual([255, 0, 0, 255]);
    await page.mouse.up();
    await expect(page.locator('footer').getByText('Edit merge drawing', { exact: true })).toBeVisible();
    await f.stage.press('Control+z');
    await expect.poll(() => f.pixel(f.stage, changed)).toEqual([255, 255, 255, 255]);
  }
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = local(24, 48), end = local(44, 64), ink = local(34, 56);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 24, y: 48, width: 20, height: 16,
  }));
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await expect.poll(() => f.pixel(f.stage, reference)).toEqual([0, 255, 0, 255]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
}

test('an unmasked instance opens in place with the surrounding groups still clipped', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'surrounding-masks');
  const points = await Promise.all([[35, 50], [65, 50], [245, 100], [275, 100]].map(([x, y]) => f.screen(x, y)));
  const pixels = () => Promise.all(points.map(p => f.pixel(f.stage, p)));
  const white = [255, 255, 255, 255];
  const original = [[0, 0, 255, 255], white, [0, 255, 0, 255], white];
  await expect.poll(pixels).toEqual(original);
  await page.getByRole('group', { name: 'Layer row ' + f.p.layers[2].name, exact: true }).locator('button.layer-name').click();
  await f.open('stage', true);
  const faded = [[178, 178, 255, 255], white, [178, 255, 178, 255], white];
  await expect.poll(pixels).toEqual(faded);
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = await f.screen(125, 130), end = await f.screen(145, 148), ink = await f.screen(135, 139);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(white);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.layerMasks).toEqual(f.p.layerMasks);
  await expect.poll(pixels).toEqual(original);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('masked target symbols edit in place with clipped drawing and reachable handles', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'mask-target');
  const at = (x: number, y: number) => f.screen(x, y);
  const red = await at(125, 100), hidden = await at(145, 100);
  const white = [255, 255, 255, 255], cyan = [0, 204, 255, 255];
  await expect.poll(() => f.pixel(f.stage, red)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, hidden)).toEqual(white);
  await f.open('stage', true);
  await expect.poll(() => f.pixel(f.stage, red)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(f.stage, hidden)).toEqual(white);
  await page.mouse.click(red.x, red.y);
  const corner = await at(160, 120);
  await page.mouse.move(corner.x, corner.y);
  await expect(f.stage).toHaveCSS('cursor', 'nwse-resize');
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = await at(120, 130), end = await at(150, 148);
  const visibleInk = await at(127, 139), clippedInk = await at(142, 139);
  const pixels = () => Promise.all([visibleInk, clippedInk].map(p => f.pixel(f.stage, p)));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect.poll(pixels).toEqual([cyan, white]);
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(pixels).toEqual([cyan, white]);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(pixels).toEqual([white, white]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(pixels).toEqual([cyan, white]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.layerMasks).toEqual(f.p.layerMasks);
  expect(saved.symbols![0].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 20, y: 50, width: 30, height: 18,
  }));
  await expect.poll(pixels).toEqual([cyan, white]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('in-place Brush previews reuse the dense enclosing mask while the stroke grows', async ({ page }) => {
  await page.addInitScript(() => {
    const stats = { paths: 0, replayMs: 0, rejectBlit: false, rejected: 0 };
    Object.assign(window, { denseMaskProbe: stats });
    const lineTo = Path2D.prototype.lineTo;
    const { fill, drawImage } = CanvasRenderingContext2D.prototype;
    const paths = new WeakMap<Path2D, number>();
    const denseCanvases = new WeakSet<HTMLCanvasElement>();
    Path2D.prototype.lineTo = function (x, y) {
      paths.set(this, (paths.get(this) ?? 0) + 1);
      return lineTo.call(this, x, y);
    };
    CanvasRenderingContext2D.prototype.fill = function (this: CanvasRenderingContext2D, ...args: [path?: Path2D | CanvasFillRule, rule?: CanvasFillRule]) {
      const dense = args[0] instanceof Path2D && (paths.get(args[0]) ?? 0) >= 4999;
      const started = dense ? performance.now() : 0;
      const result = Reflect.apply(fill, this, args);
      if (dense) {
        denseCanvases.add(this.canvas);
        stats.paths++;
        stats.replayMs += performance.now() - started;
      }
      return result;
    } as typeof fill;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D['drawImage']>) {
      if (stats.rejectBlit && args[0] instanceof HTMLCanvasElement && denseCanvases.has(args[0])) {
        stats.rejectBlit = false;
        stats.rejected++;
        throw Error('Test mask raster blit failure');
      }
      return Reflect.apply(drawImage, this, args);
    } as typeof drawImage;
  });
  const f = await setup(page, true, false, false, false, false, false, false, 'mask-target', true);
  await f.open('stage', true);
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const at = (x: number, y: number) => f.screen(x, y);
  const white = [255, 255, 255, 255], cyan = [0, 204, 255, 255];
  const start = await at(122, 135), visible = await at(130, 135), hidden = await at(142, 135);
  const pixels = () => Promise.all([visible, hidden].map(p => f.pixel(f.stage, p)));
  const probe = (rejectBlit = false) => page.evaluate(reject => {
    const results = (window as Window & { denseMaskProbe?: {
      paths: number; replayMs: number; rejectBlit: boolean; rejected: number;
    } }).denseMaskProbe!;
    if (reject) results.rejectBlit = true;
    return results;
  }, rejectBlit);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await probe();
  expect(before.paths).toBeGreaterThan(0);
  for (const x of [126, 130, 134, 138, 142, 146]) {
    const step = await at(x, 135);
    await page.mouse.move(step.x, step.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const after = await probe();
  console.log(`Dense mask replay during six live movements: ${after.paths - before.paths} passes, ${Math.round((after.replayMs - before.replayMs) * 100) / 100} ms in instrumented path calls.`);
  expect(after.paths - before.paths).toBe(0);
  await expect.poll(pixels).toEqual([cyan, white]);
  await probe(true);
  const last = await at(149, 135);
  await page.mouse.move(last.x, last.y);
  await expect.poll(async () => (await probe()).rejected).toBe(1);
  await expect.poll(pixels).toEqual([cyan, white]);
  await page.mouse.up();
  await expect.poll(pixels).toEqual([cyan, white]);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.layerMasks).toEqual(f.p.layerMasks);
  expect(saved.symbols).not.toEqual(f.p.symbols);
  await expect.poll(pixels).toEqual([cyan, white]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('mask source symbols edit in place and reveal target paint during the gesture', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'mask-source');
  const visible = await f.screen(125, 100), newReveal = await f.screen(135, 139);
  const white = [255, 255, 255, 255], green = [0, 255, 0, 255], fadedGreen = [178, 255, 178, 255];
  await expect.poll(() => f.pixel(f.stage, visible)).toEqual(green);
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(white);
  await page.getByRole('group', { name: 'Layer row Instance mask', exact: true }).locator('button.layer-name').click();
  await f.open('stage', true);
  await expect.poll(() => f.pixel(f.stage, visible)).toEqual(fadedGreen);
  const gridPoint = await f.screen(140, 135);
  const gridToggle = page.getByTitle('Toggle grid', { exact: true });
  await gridToggle.click();
  await expect.poll(async () => {
    const [r, g, b] = await f.pixel(f.stage, gridPoint);
    return r < 255 && b > g;
  }).toBe(true);
  await gridToggle.click();
  await expect.poll(() => f.pixel(f.stage, gridPoint)).toEqual(white);
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = await f.screen(125, 130), end = await f.screen(145, 148);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(fadedGreen);
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(fadedGreen);
  expect(await f.read()).toEqual(f.p);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(white);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(fadedGreen);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.layerMasks).toEqual(f.p.layerMasks);
  expect(saved.symbols![0].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 25, y: 50, width: 20, height: 18,
  }));
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(green);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(f.stage, newReveal)).toEqual(white);
});

test('Library Edit inside a scene group uses the shared canvas and restores isolation', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'grouped');
  const art = await f.screen(110, 90);
  const depth = page.getByLabel('Group editing depth', { exact: true });
  await page.mouse.dblclick(art.x, art.y);
  await page.mouse.click(art.x, art.y);
  await expect(depth).toHaveText('Group level 1');
  const instance = page.getByRole('button', { name: 'Edit symbol in stage context', exact: true });
  await expect(instance).toBeEnabled();
  for (const save of [false, true]) {
    await f.open(save ? 'context' : 'library', true);
    await expect(depth).toHaveCount(0);
    await f.stage.press('Control+a');
    await f.stage.press('ArrowRight');
    await f.stage.press('Control+z');
    await f.stage.press('Control+Shift+z');
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: save ? 'Save and return to scene' : 'Cancel symbol editing', exact: true }).click();
    await expect(depth).toHaveText('Group level 1');
    await expect(instance).toBeEnabled();
    if (!save) expect(await f.read()).toEqual(f.p);
  }
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes[0].x).toBe(f.definition.shapes[0].x + 1);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a symbol opened inside an isolated scene group returns to that group after Save or Cancel', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'grouped');
  const art = await f.screen(110, 90), ink = await f.screen(135, 139);
  const group = page.getByLabel('Group editing depth', { exact: true });
  const editor = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const white = [255, 255, 255, 255], cyan = [0, 204, 255, 255];
  await page.mouse.dblclick(art.x, art.y);
  await expect(group).toHaveText('Group level 1');
  await f.open('stage', true);
  await expect(group).toHaveCount(0);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(group).toHaveText('Group level 1');
  const editInstance = page.getByRole('button', { name: 'Edit symbol in stage context', exact: true });
  await expect(editInstance).toBeEnabled();
  expect(await f.read()).toEqual(f.p);

  await editInstance.click();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = await f.screen(125, 130), end = await f.screen(145, 148);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(cyan);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(white);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(cyan);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect(group).toHaveText('Group level 1');
  await expect(page.getByRole('button', { name: 'Edit symbol in stage context', exact: true })).toBeEnabled();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 25, y: 50, width: 20, height: 18,
  }));
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(cyan);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a grouped child symbol restores the parent symbol frame, its group and selection', async ({ page }) => {
  const f = await setup(page, true, false, true, false, false, false, false, 'grouped-child');
  const art = await f.screen(115, 95);
  const group = page.getByLabel('Group editing depth', { exact: true });
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  const frame = page.getByRole('region', { name: 'Timeline', exact: true }).locator('.frame-readout');
  const editInstance = page.getByRole('button', { name: 'Edit symbol in stage context', exact: true });
  await f.open('stage', true);
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 44, y: 40 } });
  await expect(frame).toContainText('Frame 3');
  await page.mouse.dblclick(art.x, art.y);
  await expect(group).toHaveText('Group level 1');
  await page.mouse.dblclick(art.x, art.y);
  await expect(crumbs).toContainText('Child');
  await expect(group).toHaveCount(0);
  await expect.poll(() => f.pixel(f.stage, art)).toEqual([255, 0, 0, 255]);
  await crumbs.getByRole('button', { name: 'My movie', exact: true }).click();
  await expect(crumbs).not.toContainText('Child');
  await expect(group).toHaveText('Group level 1');
  await expect(frame).toContainText('Frame 3');
  await expect(editInstance).toBeEnabled();
  expect(await f.read()).toEqual(f.p);

  await editInstance.click();
  await expect(crumbs).toContainText('Child');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  const start = await f.screen(125, 135), end = await f.screen(145, 153), ink = await f.screen(135, 145);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 255, 255, 255]);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([0, 204, 255, 255]);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0]).toEqual(f.p.symbols![0]);
  expect(saved.symbols![1].shapes).toContainEqual(expect.objectContaining({
    fill: '#00ccff', fillEnabled: true, x: 20, y: 50, width: 20, height: 18,
  }));
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Gradient Transform keeps a CSS-sized stop pickup in a skewed in-place symbol', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'gradient-skew');
  const interior = await f.screen(130, 90);
  await page.mouse.dblclick(interior.x, interior.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Gradient transform', exact: true }).click();
  await page.mouse.click(interior.x, interior.y);
  const original = await f.screen(147.5, 104), moved = await f.screen(162.5, 104);
  const green = [0, 255, 0, 255];
  await expect.poll(() => f.pixel(f.stage, original)).toEqual(green);
  const drag = async () => {
    await page.mouse.move(original.x + 3, original.y + 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + 3, moved.y + 2, { steps: 5 });
    await expect.poll(() => f.pixel(f.stage, moved)).toEqual(green);
  };
  await drag();
  await f.stage.press('Escape');
  await page.mouse.up();
  await page.mouse.click(interior.x, interior.y);
  await expect.poll(() => f.pixel(f.stage, original)).toEqual(green);
  await drag();
  await page.mouse.up();
  await expect(page.locator('footer')).toContainText('Edit gradient');
  await f.stage.press('Control+z');
  await page.mouse.click(interior.x, interior.y);
  await expect.poll(() => f.pixel(f.stage, original)).toEqual(green);
  await f.stage.press('Control+Shift+z');
  await page.mouse.click(interior.x, interior.y);
  await expect.poll(() => f.pixel(f.stage, moved)).toEqual(green);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  const before = f.p.symbols![0].shapes[0], changed = saved.symbols![0].shapes[0];
  expect(saved.layers).toEqual(f.p.layers);
  expect(changed).toEqual({ ...before, gradient: {
    ...before.gradient!, stops: before.gradient!.stops.map((stop, i) => i === 1 ? { ...stop, offset: 0.7 } : stop),
  } });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Subselection picks skewed symbol anchors and tangents at CSS distances', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'node-skew');
  const interior = await f.screen(130, 90);
  await page.mouse.dblclick(interior.x, interior.y);
  await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const first = await f.screen(104, 84), out = await f.screen(125.25, 84), movedOut = await f.screen(139.25, 88);
  const movedAnchor = await f.screen(114, 89);
  const cyan = [55, 219, 232, 255], purple = [146, 117, 255, 255];
  const pickFirst = () => page.mouse.click(first.x, first.y);
  await pickFirst();
  await expect.poll(() => f.pixel(f.stage, { x: out.x, y: out.y + 1.5 })).toEqual(cyan);
  const dragFromOffset = async (from: typeof first, to: typeof first) => {
    await page.mouse.move(from.x, from.y + 7);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y + 7, { steps: 5 });
  };
  await dragFromOffset(out, movedOut);
  await expect.poll(() => f.pixel(f.stage, movedOut)).toEqual(cyan);
  await f.stage.press('Escape');
  await page.mouse.up();
  await pickFirst();
  await expect.poll(() => f.pixel(f.stage, out)).toEqual(cyan);
  await dragFromOffset(out, movedOut);
  await expect.poll(() => f.pixel(f.stage, movedOut)).toEqual(cyan);
  await page.mouse.up();
  await dragFromOffset(first, movedAnchor);
  await expect.poll(() => f.pixel(f.stage, movedAnchor)).toEqual(purple);
  await page.mouse.up();
  await f.stage.press('Control+z');
  await pickFirst();
  await expect.poll(() => f.pixel(f.stage, movedOut)).toEqual(cyan);
  await f.stage.press('Control+Shift+z');
  await page.mouse.click(movedAnchor.x, movedAnchor.y);
  await expect.poll(() => f.pixel(f.stage, movedAnchor)).toEqual(purple);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read(), original = f.p.symbols![0].shapes[0];
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toHaveLength(1);
  const changed = saved.symbols![0].shapes[0];
  expect({ ...changed, nodes: original.nodes }).toEqual({ ...original, y: 8, width: 55, height: 28 });
  const [anchor, ...untouched] = changed.nodes!;
  expect(anchor.x + changed.x).toBeCloseTo(4, 10);
  expect(anchor.y + changed.y).toBe(18);
  expect(anchor.out).toEqual({ x: 29, y: 18 });
  expect(untouched).toEqual([{ x: 55, y: 0, in: { x: 38, y: 0 } }, { x: 55, y: 28 }, { x: 0, y: 28 }]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Subselection bends and Alt-inserts on skewed symbol edges from outside the fill', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'node-skew');
  const interior = await f.screen(130, 90), first = await f.screen(104, 84);
  const edge = await f.screen(138.375, 78), ink = await f.screen(138, 81), insert = await f.screen(138.375, 84);
  const editor = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const enter = async () => {
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await page.mouse.dblclick(interior.x, interior.y);
    await expect(editor).toBeVisible();
    await page.getByRole('button', { name: 'Subselection', exact: true }).click();
    await page.mouse.click(first.x, first.y);
  };
  const save = () => page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const white = [255, 255, 255, 255];
  await enter();
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual(white);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y - 8, { steps: 5 });
  await expect.poll(() => f.pixel(f.stage, ink)).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(page.locator('footer')).toContainText('Bend vector edge');
  await save();
  const bent = await f.read(), original = f.p.symbols![0].shapes[0], shape = bent.symbols![0].shapes[0];
  expect(bent.layers).toEqual(f.p.layers);
  expect(shape.id).toBe(original.id);
  expect(shape.nodes).toHaveLength(4);
  const outline = (s: Vector) => s.nodes!.map(n => ({ x: s.x + n.x, y: s.y + n.y }));
  expect(outline(shape)).toEqual(outline(original));
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await enter();
  await page.mouse.move(edge.x, edge.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(() => f.pixel(f.stage, insert)).toEqual([146, 117, 255, 255]);
  await save();
  const inserted = await f.read(), next = inserted.symbols![0].shapes[0];
  expect(inserted.layers).toEqual(f.p.layers);
  expect(next.nodes).toHaveLength(5);
  const points = outline(next);
  expect(points[1].x).toBeCloseTo(27.5, 0);
  expect(points[1].y).toBe(8);
  expect(points.filter((_, index) => index !== 1)).toEqual(outline(original));
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Selection reshapes an off-center attached stroke and fill in a skewed symbol', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'attached-skew');
  await f.open('stage', true);
  const pickup = await f.screen(138.375, 80), reveal = await f.screen(138, 76);
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255];
  await expect.poll(() => f.pixel(f.stage, pickup)).toEqual([34, 51, 68, 255]);
  await expect.poll(() => f.pixel(f.stage, reveal)).toEqual(white);
  const drag = async () => {
    await page.mouse.move(pickup.x, pickup.y);
    await page.mouse.down();
    await page.mouse.move(pickup.x, pickup.y - 15, { steps: 6 });
    await expect.poll(() => f.pixel(f.stage, reveal)).toEqual(red);
  };
  await drag();
  await f.stage.press('Escape');
  await page.mouse.up();
  await expect.poll(() => f.pixel(f.stage, reveal)).toEqual(white);
  await drag();
  await page.mouse.up();
  await expect(page.locator('footer')).toContainText('Bend vector edge');
  await f.stage.press('Control+z');
  await expect.poll(() => f.pixel(f.stage, reveal)).toEqual(white);
  await f.stage.press('Control+Shift+z');
  await expect.poll(() => f.pixel(f.stage, reveal)).toEqual(red);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read(), [fill, stroke] = saved.symbols![0].shapes;
  const [originalFill, originalStroke] = f.p.symbols![0].shapes;
  expect(saved.layers).toEqual(f.p.layers);
  expect({ ...fill, contours: originalFill.contours }).toEqual(originalFill);
  expect({ ...stroke, nodes: originalStroke.nodes }).toEqual(originalStroke);
  expect(fill.contours![0]).toHaveLength(4);
  expect(stroke.nodes).toHaveLength(2);
  expect(fill.contours![0][0].out).toBeDefined();
  expect(fill.contours![0][0].out).toEqual(stroke.nodes![0].out);
  expect(fill.contours![0][1].in).toEqual(stroke.nodes![1].in);
  expect(stroke.nodes!.map(({ x, y }) => ({ x, y }))).toEqual(originalStroke.nodes);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Subselection edits a skewed symbol Brush width from an off-center handle pickup', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'width-skew');
  await f.open('stage', true);
  const center = await f.screen(150, 90), start = await f.screen(160, 100), end = await f.screen(154, 94);
  await page.mouse.click(center.x, center.y);
  await page.getByLabel('Pressure sample', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Edit width on canvas', exact: true }).click();
  const sample = page.getByLabel('Sample pressure', { exact: true });
  const drag = async () => {
    await page.mouse.move(start.x, start.y + 7);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y + 7, { steps: 5 });
    await expect.poll(async () => Number(await sample.inputValue())).toBeCloseTo(25, 1);
  };
  await drag();
  await f.stage.press('Escape');
  await page.mouse.up();
  await page.mouse.click(center.x, center.y);
  await expect(sample).toHaveValue('100');
  await expect.poll(async () => {
    const [r, g, b] = await f.pixel(f.stage, { x: start.x, y: start.y + 3 });
    return r > 200 && g > 190 && b > 240 && b > r + 15;
  }).toBe(true);
  await drag();
  await page.mouse.up();
  await expect(page.locator('footer')).toContainText('Edit brush width');
  await f.stage.press('Control+z');
  await page.mouse.click(center.x, center.y);
  await expect(sample).toHaveValue('100');
  await f.stage.press('Control+Shift+z');
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => Number(await sample.inputValue())).toBeCloseTo(25, 1);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read(), original = f.p.symbols![0], changed = saved.symbols![0];
  expect(saved.layers).toEqual(f.p.layers);
  expect(changed).toEqual({ ...original, shapes: [{
    ...original.shapes[0], points: original.shapes[0].points.map((p, i) => i === 1 ? { ...p, pressure: expect.closeTo(0.25, 8) } : p),
  }] });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Pressure Profile keeps a Brush stroke editable on a symbol Merge Drawing layer', async ({ page }) => {
  const f = await setup(page, true, false, false, false, false, false, false, 'width-skew');
  await f.open('stage', true);
  const center = await f.screen(150, 90);
  const pick = () => page.mouse.click(center.x, center.y);
  await pick();
  await expect(page.getByRole('combobox', { name: 'Drawing mode', exact: true })).toHaveValue('merge');
  const index = page.getByLabel('Pressure sample', { exact: true });
  const sample = page.getByLabel('Sample pressure', { exact: true });
  await index.fill('2');
  await sample.fill('40');
  await sample.press('Tab');
  await expect(page.locator('footer')).toContainText('Edit brush pressure');
  await expect(sample).toHaveValue('40');

  for (const [name, value] of [['start', '0'], ['middle', '50'], ['end', '100']])
    await page.getByLabel(`Profile ${name} pressure`, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Apply pressure profile', exact: true }).click();
  await expect.poll(async () => Number(await sample.inputValue())).toBeCloseTo(400 / 7, 5);
  await page.getByRole('button', { name: 'Reverse pressure profile', exact: true }).click();
  await expect.poll(async () => Number(await sample.inputValue())).toBeCloseTo(300 / 7, 5);
  await page.getByRole('button', { name: 'Uniform pressure', exact: true }).click();
  await expect(sample).toHaveValue('100');

  await f.stage.press('Control+z');
  await pick();
  await expect.poll(async () => Number(await sample.inputValue())).toBeCloseTo(300 / 7, 5);
  await f.stage.press('Control+Shift+z');
  await pick();
  await expect(sample).toHaveValue('100');
  await f.stage.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read(), original = f.p.symbols![0];
  expect(saved).toEqual({ ...f.p, symbols: [{ ...original, shapes: [{
    ...original.shapes[0], points: original.shapes[0].points.map((point, i) => ({
      ...point, pressure: expect.closeTo([1, 3 / 7, 0][i], 8),
    })),
  }] }] });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared nested drawing keeps its explicit layer mode through local history and Save', async ({ page }) => {
  const f = await setup(page, true, false, true);
  const childPoint = await f.screen(115, 95);
  await f.open('stage', true);
  await page.mouse.dblclick(childPoint.x, childPoint.y);
  const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
  await expect(crumbs).toContainText('Child');
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'Drawing mode', exact: true });
  await expect(mode).toHaveValue('merge');
  await mode.selectOption('object');
  await expect(mode).toHaveValue('object');
  await f.stage.press('Control+z');
  await expect(mode).toHaveValue('merge');
  await f.stage.press('Control+Shift+z');
  await expect(mode).toHaveValue('object');
  await mode.selectOption('merge');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0]).toEqual(f.p.symbols![0]);
  const childLayer = saved.symbols![1].timeline!.layers![0];
  expect(childLayer.drawingMode).toBe('merge');
  expect(childLayer.keys).toEqual([{ frame: 0, shapes: [] }]);
  await f.open('stage', true);
  await page.mouse.dblclick(childPoint.x, childPoint.y);
  await page.getByRole('group', { name: 'Layer row Layer 2', exact: true }).locator('.layer-name').click();
  await expect(mode).toHaveValue('merge');
  await page.getByLabel('Drawing tools', { exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ccff');
  await page.mouse.move(childPoint.x + 4, childPoint.y - 5);
  await page.mouse.down();
  await page.mouse.move(childPoint.x + 22, childPoint.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('footer').getByText('Merge drawing', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(f.stage, { x: childPoint.x + 12, y: childPoint.y })).toEqual([0, 204, 255, 255]);
  expect(await f.read()).toEqual(saved);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
for (const movie of [false, true])
  for (const entry of ['stage', 'library'] as const)
    test(`${entry} ${movie ? 'movie' : 'graphic'} opens the canvas and bottom timeline, saves linked content and has one document Undo`, async ({
      page,
    }) => {
      const f = await setup(page, movie);
      const point = await f.screen(110, 90);
      await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
      await f.open(entry);
      const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true }),
        timeline = f.workspace.getByRole('region', { name: 'Symbol timeline', exact: true });
      const c = (await canvas.boundingBox())!,
        t = (await timeline.boundingBox())!;
      expect(c.width).toBeGreaterThan(400);
      expect(t.y).toBeGreaterThan(c.y + c.height - 1);
      await expect(f.workspace.getByLabel('Symbol edit breadcrumbs')).toContainText(
        f.definition.name,
      );
      expect(await f.read()).toEqual(f.p);
      if (entry === 'stage')
        await expect.poll(() => f.pixel(canvas, point)).toEqual([255, 0, 0, 255]);
      await f.fill('#00aaff');
      expect(await f.read()).toEqual(f.p);
      await f.save();
      await expect(f.workspace).toHaveCount(0);
      const out = await f.read(),
        expected = structuredClone(f.p);
      expected.symbols![0].shapes[0].fill = '#00aaff';
      expect(out).toEqual(expected);
      const linked = await f.screen(310, 90);
      await expect.poll(() => f.pixel(f.stage, linked)).toEqual([0, 170, 255, 255]);
      await f.stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(out);
    });
test('reflected stage instance keeps the original screen position and matrix through in-place editing', async ({
  page,
}) => {
  const f = await setup(page, false, true),
    point = await f.screen(190, 90);
  await f.open('stage');
  await expect
    .poll(() => f.pixel(f.workspace.getByLabel('Symbol artwork preview'), point))
    .toEqual([255, 0, 0, 255]);
  await f.fill('#00aaff');
  await f.save();
  expect((await f.read()).layers).toEqual(f.p.layers);
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([0, 170, 255, 255]);
});
test('movie frame changes keep local artwork, local Undo/Redo and Cancel leaves the whole document unchanged', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('context');
  await f.fill('#00aaff');
  await f.frame(4);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#0000ff');
  expect(await f.read()).toEqual(f.p);
  await f.workspace
    .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
    .click();
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#ff0000');
  await f.workspace
    .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
    .click();
  await f.frame(0);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#00aaff');
  await f.workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
});
test('a static symbol can gain a real timeline and editable future key without settings popups', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await f.frame(5);
  await f.workspace.getByRole('button', { name: 'Insert symbol keyframe', exact: true }).click();
  await f.fill('#0000ff');
  await f.frame(0);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#ff0000');
  await f.frame(5);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#0000ff');
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline).toEqual({
    duration: 6,
    keys: [{ frame: 5, shapes: [{ ...f.definition.shapes[0], fill: '#0000ff' }] }],
  });
  expect(out.layers).toEqual(f.p.layers);
});
test('editing two movie keys then using the Scene breadcrumb commits both and survives reload', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open();
  await f.fill('#00aaff');
  await f.frame(4);
  await f.fill('#00ff00');
  await f.workspace
    .getByLabel('Symbol edit breadcrumbs')
    .getByRole('button', { name: 'Scene 1', exact: true })
    .click();
  const out = await f.read();
  expect(out.symbols![0].shapes[0].fill).toBe('#00aaff');
  expect(out.symbols![0].timeline!.keys[0].shapes[0].fill).toBe('#00ff00');
  expect(out.layers).toEqual(f.p.layers);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
  await f.open();
  await f.frame(4);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#00ff00');
});
test('editing held movie content creates the selected key and preserves the original next key', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open();
  await f.frame(2);
  await f.fill('#00aaff');
  await f.frame(4);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#0000ff');
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(out.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([2, 4]);
  expect(out.symbols![0].timeline!.keys[0].shapes[0].fill).toBe('#00aaff');
  expect(out.symbols![0].timeline!.keys[1]).toEqual(f.definition.timeline!.keys[0]);
});
test('new symbol layers accept native canvas drawing and publish once with complete layer history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await f.workspace.getByRole('button', { name: 'Add symbol layer', exact: true }).click();
  await f.workspace.getByLabel('New symbol drawing fill').evaluate((el) => {
    const i = el as HTMLInputElement;
    i.value = '#00ff00';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.workspace
    .getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const c = f.workspace.getByLabel('Symbol artwork preview'),
    b = (await c.boundingBox())!;
  const point = (x: number, y: number) => ({
    x: b.x + ((20 + x * 3.625) * b.width) / 540,
    y: b.y + ((20 + y * 3.625) * b.height) / 330,
  });
  const a = point(15, 15),
    z = point(35, 30);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      c.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 30 && d[i + 1] > 220 && d[i + 2] < 30) n++;
        return n;
      }),
    )
    .toBeGreaterThan(100);
  expect(await f.read()).toEqual(f.p);
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].shapes).toEqual(f.definition.shapes);
  const layers = out.symbols![0].timeline!.layers!;
  expect(layers).toHaveLength(1);
  expect(layers[0].keys[0].shapes).toHaveLength(1);
  expect(layers[0].keys[0].shapes[0].fill).toBe('#00ff00');
  expect(out.layers).toEqual(f.p.layers);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});
test('canvas Undo and Redo continue into the symbol timeline history after changing frames', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open();
  await f.fill('#00aaff');
  await f.frame(4);
  await f.workspace.getByLabel('Symbol artwork preview').focus();
  await page.keyboard.press('Control+z');
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#ff0000');
  await f.workspace.getByLabel('Symbol artwork preview').focus();
  await page.keyboard.press('Control+Shift+z');
  await f.frame(0);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#00aaff');
  await f.save();
  expect((await f.read()).symbols![0].shapes[0].fill).toBe('#00aaff');
});
for (const entry of ['stage', 'library'] as const)
  test(`${entry} nested symbols retain breadcrumbs, protect pending edits and update the linked child only`, async ({
    page,
  }) => {
    const f = await setup(page, false, false, true);
    await f.open(entry);
    await f.workspace
      .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
      .click();
    await expect(f.workspace.getByLabel('Symbol edit breadcrumbs')).toContainText('Child');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await f.workspace
      .getByLabel('Symbol edit breadcrumbs')
      .getByRole('button', { name: f.definition.name, exact: true })
      .click();
    await expect(f.workspace.getByLabel('Symbol edit breadcrumbs')).not.toContainText('Child');
    await f.workspace
      .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
      .click();
    await f.fill('#00aaff');
    await f.workspace
      .getByLabel('Symbol edit breadcrumbs')
      .getByRole('button', { name: f.definition.name, exact: true })
      .click();
    await expect(f.workspace.getByRole('alert')).toContainText('Save current symbol edits');
    await expect(f.workspace.getByLabel('Symbol edit breadcrumbs')).toContainText('Child');
    expect(await f.read()).toEqual(f.p);
    await f.save();
    const out = await f.read();
    expect(out.symbols![0]).toEqual(f.definition);
    expect(out.symbols![1].shapes[0].fill).toBe('#00aaff');
    expect(out.layers).toEqual(f.p.layers);
  });
test('source changes while a symbol draft is open reject publication and remain separately undoable', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open();
  await f.fill('#00aaff');
  await page.getByLabel('Layer name', { exact: true }).evaluate((el) => {
    const i = el as HTMLInputElement;
    i.value = 'User scene edit';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.save();
  await expect(f.workspace.locator('.error[role="alert"]')).toContainText('source changed');
  const expected = structuredClone(f.p);
  expected.layers[0].name = 'User scene edit';
  expect(await f.read()).toEqual(expected);
  await f.workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('actual changed artwork during detached frame preparation rejects the stale color and permits a fresh save', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await f.fill('#00aaff');
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { workspaceHook: number }).workspaceHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options);
      const shapes = value as Vector[];
      if (
        Array.isArray(shapes) &&
        shapes[0]?.id === 'leaf' &&
        shapes[0].fill === '#00aaff' &&
        !(window as unknown as { workspaceHook: number }).workspaceHook
      ) {
        (window as unknown as { workspaceHook: number }).workspaceHook++;
        const i = document.querySelector(
          'input[aria-label="Symbol artwork fill"]',
        ) as HTMLInputElement;
        i.value = '#00ff00';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return out;
    };
  });
  await f.save();
  expect(
    await page.evaluate(() => (window as unknown as { workspaceHook: number }).workspaceHook),
  ).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect(f.workspace.getByLabel('Symbol artwork fill')).toHaveValue('#00ff00');
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  expect((await f.read()).symbols![0].shapes[0].fill).toBe('#00ff00');
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('pending brush vector finishing blocks frame navigation without losing the drawing', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, true);
  await f.open();
  await f.workspace
    .getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Brush', exact: true })
    .click();
  const c = f.workspace.getByLabel('Symbol artwork preview'),
    b = (await c.boundingBox())!;
  const a = { x: b.x + (100 * b.width) / 540, y: b.y + (100 * b.height) / 330 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 45, a.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await f.workspace.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(f.workspace.getByRole('button', { name: 'Stop playback', exact: true })).toHaveCount(
    0,
  );
  await f.frame(4);
  await expect(f.workspace.getByRole('alert')).toContainText('Finish or cancel');
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 1 / 8');
  expect(await f.read()).toEqual(f.p);
  const selection = f.workspace
    .getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Selection', exact: true });
  await expect
    .poll(async () => {
      await releaseGeometry(page);
      return selection.isEnabled();
    })
    .toBe(true);
  await selection.click();
  await expect
    .poll(async () => {
      await f.frame(4);
      return await f.workspace.locator('.frame-readout').textContent();
    })
    .toContain('Frame 5 / 8');
  await f.save();
  expect((await f.read()).symbols![0].shapes.length).toBeGreaterThan(1);
});

test('rejected symbol keyboard navigation preserves the frame range while Brush finishes', async ({ page }) => {
  await holdGeometry(page);
  const f = await setup(page, true);
  await f.open();
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('Shift+ArrowRight');
  const range = /Frame 2 of 8.*Frames 1 to 2 selected/;
  await expect(grid).toHaveAccessibleDescription(range);
  const tools = f.workspace.getByRole('navigation', { name: 'Symbol drawing tools' });
  await tools.getByRole('button', { name: 'Brush', exact: true }).click();
  const bounds = (await f.workspace.getByLabel('Symbol artwork preview').boundingBox())!;
  const x = bounds.x + (100 * bounds.width) / 540;
  const y = bounds.y + (100 * bounds.height) / 330;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await expect(grid).toHaveAccessibleDescription(range);
  await grid.press('ArrowRight');
  await expect(f.workspace.getByRole('alert')).toContainText('Finish or cancel');
  await expect(grid).toHaveAccessibleDescription(range);
  expect(await f.read()).toEqual(f.p);

  const selection = tools.getByRole('button', { name: 'Selection', exact: true });
  await expect.poll(async () => {
    await releaseGeometry(page);
    return selection.isEnabled();
  }).toBe(true);
  await selection.click();
  await grid.press('ArrowRight');
  await expect(grid).toHaveAccessibleDescription(/Frame 3 of 8\. Layer Artwork\. Use Left/);
  await f.save();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(saved.symbols![0].timeline?.keys.map(key => key.frame)).toEqual([1, 4]);
  expect(saved.symbols![0].timeline?.keys[0].shapes.length).toBeGreaterThan(1);
  expect(saved.symbols![0].timeline?.keys[1]).toEqual(f.definition.timeline!.keys[0]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('isolated symbol Pen Shift-click saves a diagonal without adding tangent handles', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.workspace.getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Pen', exact: true }).click();
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * .65, y = bounds.y + bounds.height * .31;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 60, y + 35);
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const free = await pixels();
  await page.keyboard.down('Shift');
  await expect.poll(pixels).not.toBe(free);
  await page.mouse.down();
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await canvas.press('Enter');
  await expect(f.workspace.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  expect(await f.read()).toEqual(f.p);
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  const [leaf, path] = (await f.read()).symbols![0].shapes;
  expect(leaf).toEqual(f.definition.shapes[0]);
  expect(path.nodes).toHaveLength(2);
  expect(path.nodes!.every(n => !n.in && !n.out)).toBe(true);
  const [a, b] = path.nodes!;
  expect(b.x - a.x).toBeGreaterThan(0);
  expect(b.x - a.x).toBeCloseTo(b.y - a.y, 8);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('idle isolated symbol Pen adds and removes an anchor with local Undo and Save', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.workspace.getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Pen', exact: true }).click();
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * .65, y = bounds.y + bounds.height * .31;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 60, y);
  await page.mouse.click(x + 85, y + 50);
  await canvas.press('Enter');
  const undo = f.workspace.getByRole('button', { name: 'Undo artwork change', exact: true });
  await expect(undo).toBeEnabled();
  await page.mouse.move(x + 30, y);
  await expect(canvas).toHaveCSS('cursor', /data:image\/svg\+xml/);
  await page.mouse.click(x + 30, y);
  // Undo the split, then remove the original interior corner.
  await undo.click();
  await page.mouse.move(x + 60, y);
  await expect(canvas).toHaveCSS('cursor', /data:image\/svg\+xml/);
  await page.mouse.click(x + 60, y);
  expect(await f.read()).toEqual(f.p);
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  const [leaf, path] = (await f.read()).symbols![0].shapes;
  expect(leaf).toEqual(f.definition.shapes[0]);
  expect(path.nodes).toHaveLength(2);
  expect(path.nodes?.every(n => !n.in && !n.out)).toBe(true);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const toolName of ['Pen', 'Pencil', 'Brush', 'Paint bucket', 'Ink bottle'])
test(`idle isolated symbol ${toolName} temporarily moves a selected object with Command`, async ({ page }) => {
  const f = await setup(page);
  await f.open();
  const tool = f.workspace.getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: toolName, exact: true });
  await tool.click();
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.focus();
  const paintTool = toolName === 'Paint bucket' || toolName === 'Ink bottle';
  const idleCursor = await canvas.evaluate(node => getComputedStyle(node).cursor);
  if (paintTool) expect(idleCursor).toMatch(/data:image\/svg\+xml/);
  const spot = await canvas.evaluate((node: HTMLCanvasElement) => {
    const rect = node.getBoundingClientRect();
    const rgba = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data;
    let left = node.width, right = 0, top = node.height, bottom = 0;
    for (let y = 0; y < node.height; y++) for (let x = 0; x < node.width; x++) {
      const i = (y * node.width + x) * 4;
      if (rgba[i] < 240 || rgba[i + 1] > 20 || rgba[i + 2] > 20 || rgba[i + 3] < 240) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (right <= left || bottom <= top) throw Error('Expected a painted symbol rectangle.');
    return { x: rect.x + (left + right) * rect.width / (2 * node.width),
      y: rect.y + (top + bottom) * rect.height / (2 * node.height) };
  });
  const shapeX = f.workspace.getByLabel('Symbol artwork x', { exact: true });
  await page.keyboard.down('Meta');
  await expect(canvas).toHaveCSS('cursor', 'default');
  await page.mouse.click(spot.x, spot.y);
  await expect(shapeX).toHaveValue('0');
  expect(await f.read()).toEqual(f.p);
  await page.mouse.down();
  await page.mouse.move(spot.x + 10, spot.y + 5);
  await page.keyboard.press('Escape');
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await expect(shapeX).toHaveValue('0');
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 20, spot.y + 10);
  await page.keyboard.up('Meta');
  await expect(canvas).toHaveCSS('cursor', 'default');
  await page.mouse.move(spot.x + 40, spot.y + 20);
  await page.mouse.up();
  await expect(canvas).toHaveCSS('cursor', idleCursor);
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(f.workspace.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  expect(await f.read()).toEqual(f.p);
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  const out = await f.read();
  const [moved] = out.symbols![0].shapes;
  expect(moved.x).toBeGreaterThan(0);
  expect(moved.y).toBeGreaterThan(0);
  expect(out.symbols![0].shapes).toEqual([{ ...f.definition.shapes[0], x: moved.x, y: moved.y }]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('isolated symbol Pen Command-click finishes the draft and preserves one document Undo', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  const pen = f.workspace.getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Pen', exact: true });
  await pen.click();
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.65;
  const y = bounds.y + bounds.height * 0.31;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 60, y);
  const finish = f.workspace.getByRole('button', { name: 'Finish symbol Pen path', exact: true });
  await expect(finish).toBeEnabled();
  await page.keyboard.down('Meta');
  await page.mouse.click(x + 30, y);
  await expect(finish).toBeEnabled();
  await page.mouse.click(x + 90, y + 50);
  await page.keyboard.up('Meta');
  await expect(finish).toBeDisabled();
  await expect(f.workspace.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  expect(await f.read()).toEqual(f.p);
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  const [original, path] = (await f.read()).symbols![0].shapes;
  expect(original).toEqual(f.definition.shapes[0]);
  expect(path.closed).toBe(false);
  expect(path.nodes).toHaveLength(2);
  expect(path.width).toBeGreaterThan(0);
  expect(path.height).toBe(0);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('isolated symbol Pencil keeps the Shift axis through Save and document Undo', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.workspace
    .getByRole('navigation', { name: 'Symbol drawing tools' })
    .getByRole('button', { name: 'Pencil', exact: true })
    .click();
  await f.workspace.getByLabel('Symbol pencil smoothing').selectOption('raw');
  await f.workspace.getByLabel('Symbol pencil optimize').uncheck();
  await f.workspace.getByLabel('Separate Pencil objects', { exact: true }).check();
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.7;
  const y = bounds.y + bounds.height * 0.25;
  await page.keyboard.down('Shift');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y + 24);
  await page.mouse.move(x + 28, y + 85);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => f.pixel(canvas, { x, y: y + 40 })).not.toEqual(
    await f.pixel(canvas, { x: x + 28, y: y + 40 }),
  );
  expect(await f.read()).toEqual(f.p);
  await f.save();
  await expect(f.workspace).toHaveCount(0);
  const out = await f.read();
  const strokes = out.symbols![0].shapes.filter(s => s.id !== 'leaf');
  expect(strokes).toHaveLength(1);
  expect(strokes[0].width).toBe(0);
  expect(strokes[0].height).toBeGreaterThan(10);
  expect(out.symbols![0].shapes[0]).toEqual(f.definition.shapes[0]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const animated of [false, true])
  test(`${animated ? 'timeline-frame' : 'static'} workspace Simplify keeps original ownership and one document publication`, async ({
    page,
  }) => {
    const issues: string[] = [];
    errors.set(page, issues);
    page.on('pageerror', (e) => issues.push(String(e)));
    const request = animated ? symbolSimplifyFrameFixture() : symbolSimplifyFixture();
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      request.project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        ),
      before = await read();
    await page.getByRole('option', { name: 'Library item Original art', exact: true }).dblclick();
    await page.getByRole('button', { name: 'Advanced symbol timeline tools…' }).click();
    const workspace = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
    if (animated) await clickFrame(workspace, 4);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const out = prepareSymbolSimplifyRequest({ ...request, project: before });
    expect(out.removed).toBeGreaterThan(0);
    await workspace
      .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
      .click();
    await expect(
      workspace.getByText(`Removed ${out.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    expect(await read()).toEqual(before);
    await workspace.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await workspace.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    await expect(workspace).toHaveCount(0);
    expect(await read()).toEqual(out.project);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(before);
  });
test('explicit advanced timeline tools keep their changes local until the workspace saves', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open();
  await page.screenshot({ path: test.info().outputPath('symbol-workspace.png') });
  const launcher = f.workspace.getByRole('button', { name: 'Timeline tools…', exact: true });
  await launcher.press('Enter');
  const tools = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const first = tools.getByRole('button', { name: 'Edit local frame source', exact: true });
  const cancel = tools.getByRole('button', { name: 'Cancel symbol timeline', exact: true });
  const duration = tools.getByLabel('Symbol duration', { exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await duration.fill('9');
  await duration.press('Tab');
  await page.keyboard.press('Escape');
  await expect(tools).toHaveCount(0);
  await expect(launcher).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Enter');
  await duration.fill('10');
  await duration.press('Tab');
  await tools.getByRole('button', { name: 'Apply symbol timeline', exact: true }).press('Enter');
  await expect(tools).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(f.workspace.getByLabel('Symbol duration', { exact: true })).toHaveValue('10');
  expect(await f.read()).toEqual(f.p);
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  await timeline.press('Control+z');
  await expect(f.workspace.getByLabel('Symbol duration', { exact: true }))
    .toHaveValue(String(f.p.symbols![0].timeline!.duration));
  await timeline.press('Control+Shift+z');
  await expect(f.workspace.getByLabel('Symbol duration', { exact: true })).toHaveValue('10');
  await f.save();
  const expected = structuredClone(f.p);
  expected.symbols![0].timeline!.duration = 10;
  expect(await f.read()).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const movie of [false, true])
  test(`in-place ${movie ? 'movie' : 'graphic'} keeps every surrounding reference at its original screen position and frozen during scrubbing`, async ({
    page,
  }) => {
    const f = await setup(page, movie, false, false, true);
    const left = await f.screen(-125, 135),
      right = await f.screen(705, 105),
      other = await f.screen(310, 90),
      active = await f.screen(110, 90),
      green = await f.screen(365, 195);
    await expect.poll(() => f.pixel(f.stage, left)).toEqual([0, 255, 0, 255]);
    await expect.poll(() => f.pixel(f.stage, right)).toEqual([255, 255, 0, 255]);
    await f.open('stage');
    const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
    const box = (await canvas.boundingBox())!;
    expect(box.width / box.height).toBeGreaterThan(1.7);
    expect(left.x).toBeGreaterThan(box.x);
    expect(right.x).toBeLessThan(box.x + box.width);
    await expect.poll(() => f.pixel(canvas, active)).toEqual([255, 0, 0, 255]);
    const faded = async (p: { x: number; y: number }) => f.pixel(canvas, p);
    await expect.poll(() => faded(other)).toEqual([255, 178, 178, 255]);
    await expect.poll(() => faded(green)).toEqual([178, 255, 178, 255]);
    const leftColor = await faded(left),
      rightColor = await faded(right);
    expect(leftColor[1]).toBeGreaterThan(leftColor[0] + 50);
    expect(leftColor[0]).toBeGreaterThan(20);
    expect(rightColor[0]).toBeGreaterThan(rightColor[2] + 50);
    if (movie) {
      await f.frame(4);
      await expect
        .poll(() => f.pixel(f.workspace.getByLabel('Symbol artwork preview'), active))
        .toEqual([0, 0, 255, 255]);
      await expect
        .poll(() => f.pixel(f.workspace.getByLabel('Symbol artwork preview'), other))
        .toEqual([255, 178, 178, 255]);
    }
    await page.screenshot({ path: test.info().outputPath('in-place-reference.png') });
    await f.workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    expect(await f.read()).toEqual(f.p);
  });

test('scene and symbol use the same timeline/layer controls with rename, outline, visibility, lock, properties and one document transaction', async ({
  page,
}) => {
  const f = await setup(page, true);
  const main = page.getByRole('region', { name: 'Timeline', exact: true });
  await expect(main).toHaveAttribute('data-timeline-implementation', 'shared');
  await f.open('stage');
  const timeline = f.workspace.getByRole('region', { name: 'Timeline', exact: true });
  await expect(timeline).toHaveAttribute('data-timeline-implementation', 'shared');
  await expect(timeline.getByRole('img', { name: 'Outline', exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'First frame', exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Last frame', exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Move layer up', exact: true })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Move layer down', exact: true })).toBeVisible();
  const horizontal = timeline.getByRole('scrollbar', { name: 'Timeline scroll', exact: true });
  const vertical = timeline.getByRole('scrollbar', { name: 'Timeline layer scroll', exact: true });
  await expect(horizontal).toHaveAttribute('aria-controls', 'symbol-timeline-panel');
  await expect(vertical).toHaveAttribute('aria-controls', 'symbol-timeline-panel');
  await expect(timeline).toHaveAttribute('id', 'symbol-timeline-panel');
  await expect(vertical).toHaveAccessibleDescription('First visible layer row 1');
  await expect(horizontal).toHaveAccessibleDescription('First visible frame 1');
  expect(await f.read()).toEqual(f.p);
  await expect(timeline.getByRole('button', { name: '▱ Artwork', exact: true })).toHaveAttribute('aria-current', 'true');
  await timeline.getByRole('button', { name: '▱ Artwork', exact: true }).press('F2');
  await f.workspace.getByLabel('Rename layer', { exact: true }).fill('Main ink');
  await f.workspace.getByLabel('Rename layer', { exact: true }).press('Enter');
  await expect(timeline.getByRole('button', { name: '▱ Main ink', exact: true })).toHaveAttribute('aria-current', 'true');
  await timeline.getByRole('button', { name: 'Toggle outline Main ink', exact: true }).click();
  await expect(
    timeline.getByRole('button', { name: 'Toggle outline Main ink', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await timeline.getByRole('button', { name: 'Toggle visibility Main ink', exact: true }).click();
  await expect(
    timeline.getByRole('button', { name: 'Toggle visibility Main ink', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await timeline.getByRole('button', { name: 'Toggle visibility Main ink', exact: true }).click();
  await timeline.getByRole('button', { name: 'Toggle lock Main ink', exact: true }).click();
  await timeline.getByRole('button', { name: 'Toggle lock Main ink', exact: true }).click();
  await timeline
    .getByRole('group', { name: 'Layer row Main ink', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Layer outline color', { exact: true }).fill('#ff8800');
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].baseLayer).toEqual({
    name: 'Main ink',
    visible: true,
    locked: false,
    outline: true,
    outlineColor: '#ff8800',
  });
  expect(out.layers).toEqual(f.p.layers);
  expect(out.symbols![0].shapes).toEqual(f.p.symbols![0].shapes);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('keyboard extension keeps the original symbol frame in range when moving left and reversing', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  const cell = (at: number) => timeline.evaluate((canvas: HTMLCanvasElement, at) => {
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(canvas.getContext('2d')!.getImageData(
      Math.floor((at * 18 + 12) * ratio), Math.floor(31 * ratio), 1, 1).data);
  }, at);
  await timeline.press('End');
  const before = await cell(4);
  for (let i = 0; i < 5; i++) await timeline.press('Shift+ArrowLeft');
  await expect(timeline).toHaveAccessibleDescription(/Frame 3 of 8.*Frames 3 to 8 selected\./);
  await timeline.press('Shift+ArrowRight');
  await expect(timeline).toHaveAccessibleDescription(/Frame 4 of 8.*Frames 4 to 8 selected\./);
  await expect.poll(() => cell(4)).not.toEqual(before);
  await expect.poll(() => cell(7)).toEqual([61, 96, 137, 255]);
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Escape');
  await expect(timeline).toBeFocused();
  await expect(timeline).toHaveAccessibleDescription(/Frame 4 of 8/);
  await expect(timeline).not.toHaveAccessibleDescription(/Frames \d+ to \d+ selected/);
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Shift+End');
  await expect(timeline).toHaveAccessibleDescription(/Frames 4 to 8 selected\./);
  await timeline.press('Shift+Home');
  await expect(timeline).toHaveAccessibleDescription(/Frames 1 to 4 selected\./);
  await timeline.press('End');
  for (let i = 0; i < 4; i++) await timeline.press('Shift+ArrowLeft');
  await expect(timeline).toHaveAccessibleDescription(/Frames 4 to 8 selected\./);

  await timeline.press('Shift+F6');
  await timeline.press('ArrowRight');
  await expect(timeline).not.toHaveAccessibleDescription(/Frames \d+ to \d+ selected/);
  await expect(f.workspace.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#ff0000');
  await timeline.press('Control+z');
  await clickFrame(f.workspace, 4);
  await expect(f.workspace.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#0000ff');
  await timeline.press('Control+Shift+z');
  await f.save();
  const after = await f.read();
  expect(after.layers).toEqual(f.p.layers);
  expect(after.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(after.symbols![0].timeline?.keys).toEqual([]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('keyboard symbol layer navigation scrolls only at the visible row boundaries', async ({ page }) => {
  const f = await setup(page, true, false, false, false, 18);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  const scroll = f.workspace.getByLabel('Timeline layer scroll', { exact: true });
  const rows = f.workspace.locator('[data-symbol-layer]');
  await expect(scroll).toHaveAccessibleDescription('First visible layer row 1');
  const count = await rows.count();
  expect(count).toBeGreaterThan(2);
  expect(count).toBeLessThan(17);
  await rows.first().locator('button.layer-name').click();
  for (let n = 1; n < count; n++) {
    await timeline.press('ArrowDown');
    await expect(timeline).toHaveAccessibleDescription(new RegExp(`Layer Track ${17 - n}\\.`));
    await expect(scroll).toHaveAccessibleDescription('First visible layer row 1');
  }
  await timeline.press('ArrowDown');
  await expect(timeline).toHaveAccessibleDescription(new RegExp(`Layer Track ${17 - count}\\.`));
  await expect(scroll).toHaveAccessibleDescription('First visible layer row 2');
  await expect(rows.last()).toHaveAttribute('data-symbol-layer', `track-${17 - count}`);
  for (let n = 1; n < count; n++) {
    await timeline.press('ArrowUp');
    await expect(scroll).toHaveAccessibleDescription('First visible layer row 2');
  }
  await timeline.press('ArrowUp');
  await expect(scroll).toHaveAccessibleDescription('First visible layer row 1');
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 8.*Layer Track 17\./);
  await expect(timeline).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await timeline.press('ArrowRight');
  await timeline.press('F6');
  await f.save();
  const saved = await f.read();
  expect(saved.symbols![0].timeline?.layers).toEqual(
    f.definition.timeline!.layers!.map(layer => layer.id === 'track-17'
      ? { ...layer, keys: [...layer.keys, { frame: 1, shapes: [] }] }
      : layer),
  );
  expect(saved.layers).toEqual(f.p.layers);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a symbol ruler menu with only a disabled command returns keyboard focus on Escape', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  const box = (await timeline.boundingBox())!;
  await timeline.focus();
  await page.mouse.click(box.x + 240, box.y + 10, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await expect(menu.getByRole('menuitem', { name: 'Script…' })).toBeDisabled();
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(timeline).toBeFocused();
  await expect(timeline).toHaveAccessibleDescription(/Frame 1 of 8/);
  expect(await f.read()).toEqual(f.p);
});

test('symbol timeline context menu opens on the keyboard frame and restores focus', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  await timeline.press('ArrowRight');
  await timeline.press('ArrowRight');
  await expect(timeline).toHaveAccessibleDescription(/Frame 3 of 8/);
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  await timeline.press('Shift+F10');
  const insertFrame = menu.getByRole('menuitem', { name: 'Insert frame', exact: true });
  await expect(insertFrame).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(timeline).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await timeline.press('ContextMenu');
  await expect(insertFrame).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Insert keyframe', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(timeline).toBeFocused();
  await expect(timeline).toHaveAccessibleDescription(/Frame 3 of 8/);
  expect(await f.read()).toEqual(f.p);
  await f.save();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(saved.symbols![0].timeline?.keys.map(key => key.frame)).toEqual([2, 4]);
  expect(saved.symbols![0].timeline?.keys[1]).toEqual(f.definition.timeline?.keys[0]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('native symbol playhead scrubbing and frame-context insertion edit the same canvas timeline with local Undo and Cancel', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true }),
    b = (await timeline.boundingBox())!;
  await page.mouse.move(b.x + 8, b.y + 12);
  await page.mouse.down();
  await page.mouse.move(b.x + 4 * 18 + 8, b.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect(f.workspace.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue(
    '#0000ff',
  );
  await timeline.click({ button: 'right', position: { x: 12 * 18 + 8, y: 39 } });
  await page.getByRole('menuitem', { name: 'Insert keyframe', exact: true }).click();
  await f.fill('#00aaff');
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.duration).toBe(13);
  expect(out.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([4, 12]);
  expect(out.symbols![0].timeline!.keys[1].shapes[0].fill).toBe('#00aaff');
  expect(out.layers).toEqual(f.p.layers);
  await f.open('stage');
  await f.workspace.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(out);
});

test('shrinking a keyboard symbol range to its anchor releases the frame grab', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.frame(4);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('Shift+ArrowRight');
  await expect(grid).toHaveAccessibleDescription(/Frames 5 to 6 selected/);
  await grid.press('Shift+ArrowLeft');
  await expect(grid).toHaveAccessibleDescription(/Frame 5 of 8\. Layer Artwork\. Use Left/);
  const box = (await grid.boundingBox())!;
  const drag = async (from: number, to: number) => {
    await page.mouse.move(box.x + from * 18 + 8, box.y + 39);
    await page.mouse.down();
    await page.mouse.move(box.x + to * 18 + 8, box.y + 39, { steps: 4 });
    await page.mouse.up();
  };
  await drag(4, 5);
  await expect(grid).toHaveAccessibleDescription(/Frames 5 to 6 selected/);
  const undo = f.workspace.getByRole('button', { name: 'Undo symbol timeline change' });
  await expect(undo).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await drag(4, 6);
  await expect(undo).toBeEnabled();
  await expect(grid).toHaveAccessibleDescription(/Frames 7 to 8 selected/);
  await f.save();
  const saved = await f.read();
  expect(saved.symbols![0].timeline?.keys).toEqual(
    f.definition.timeline!.keys.map(key => ({ ...key, frame: key.frame + 2 })),
  );
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(saved.layers).toEqual(f.p.layers);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('changing symbol layers by keyboard clears the old frame grab before the next drag', async ({ page }) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  await f.frame(3);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('ArrowUp');
  await grid.press('Shift+ArrowRight');
  await expect(grid).toHaveAccessibleDescription(/Frame 5 of 8.*Layer Upper.*Frames 4 to 5 selected/);
  await grid.press('ArrowDown');
  await expect(grid).toHaveAccessibleDescription(/Frame 5 of 8\. Layer Artwork\. Use Left/);
  const box = (await grid.boundingBox())!;
  const base = (await f.workspace.locator('[data-symbol-layer="@base"]').boundingBox())!;
  const row = base.y + base.height / 2;
  await page.mouse.move(box.x + 4 * 18 + 8, row);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 * 18 + 8, row, { steps: 4 });
  await page.mouse.up();
  await expect(grid).toHaveAccessibleDescription(/Frame 7 of 8.*Layer Artwork.*Frames 5 to 7 selected/);
  await expect(f.workspace.getByRole('button', { name: 'Undo symbol timeline change' })).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await grid.press('Shift+F6');
  await expect(f.workspace.getByRole('button', { name: 'Undo symbol timeline change' })).toBeEnabled();
  await f.save();
  const saved = await f.read();
  expect(saved.symbols![0].timeline?.keys).toEqual([]);
  expect(saved.symbols![0].timeline?.layers).toEqual(f.definition.timeline?.layers);
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(saved.layers).toEqual(f.p.layers);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('symbol frame selection then native movement replaces the destination without phantom keys and remains locally undoable', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.frame(4);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true }),
    b = (await grid.boundingBox())!;
  await page.mouse.move(b.x + 4 * 18 + 8, b.y + 39);
  await page.mouse.down();
  await page.mouse.move(b.x + 6 * 18 + 8, b.y + 39, { steps: 4 });
  await page.mouse.up();
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 7 / 8');
  await f.workspace
    .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
    .click();
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 5 / 8');
  await f.workspace
    .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
    .click();
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 7 / 8');
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([6]);
  expect(out.symbols![0].timeline!.keys[0].shapes).toEqual(f.definition.timeline!.keys[0].shapes);
  expect(out.layers).toEqual(f.p.layers);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('symbol frame blocks move across real layer rows and keep other exposure keys and source artwork', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  await f.frame(4);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true }),
    b = (await grid.boundingBox())!;
  const base = (await f.workspace.locator('[data-symbol-layer="@base"]').boundingBox())!,
    upper = (await f.workspace.locator('[data-symbol-layer="upper"]').boundingBox())!;
  await page.mouse.move(b.x + 4 * 18 + 8, base.y + base.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 6 * 18 + 8, upper.y + upper.height / 2, { steps: 4 });
  await page.mouse.up();
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.keys).toEqual([]);
  expect(out.symbols![0].timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 6]);
  expect(out.symbols![0].timeline!.layers![0].keys[0]).toEqual(
    f.definition.timeline!.layers![0].keys[0],
  );
  expect(out.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(out.layers).toEqual(f.p.layers);
});

for (const crossLayer of [false, true]) {
  test(`moves the first Artwork key ${crossLayer ? 'to another layer' : 'later on the same layer'} and saves`, async ({ page }) => {
    const f = await setup(page, true, false, false, false, crossLayer);
    const point = await f.screen(120, 100);
    await f.open('stage', true);
    const grid = page.getByLabel('Timeline frames', { exact: true });
    const box = (await grid.boundingBox())!;
    const baseY = box.y + 40 + (crossLayer ? 28 : 0);
    await grid.click({ position: { x: 8, y: baseY - box.y } });
    await page.mouse.move(box.x + 8, baseY);
    await page.mouse.down();
    await page.mouse.move(box.x + 2 * 18 + 8, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const baseStart = () => grid.click({ position: { x: 8, y: baseY - box.y } });
    await baseStart();
    await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 255, 255, 255]);
    await grid.press('Control+z');
    await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 0, 0, 255]);
    await grid.press('Control+Shift+z');
    await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 255, 255, 255]);
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const out = await f.read();
    const updated = out.symbols![0];
    expect(updated.shapes).toEqual([]);
    const original = f.definition.timeline!;
    if (crossLayer) {
      expect(updated.timeline!.keys).toEqual(original.keys);
      const [upper] = updated.timeline!.layers!;
      expect(upper.keys.map(key => key.frame)).toEqual([0, 2]);
      expect(upper.keys[1].shapes.map(({ id: _id, ...shape }) => shape))
        .toEqual(f.definition.shapes.map(({ id: _id, ...shape }) => shape));
    } else {
      expect(updated.timeline!.keys).toEqual([{ frame: 2, shapes: f.definition.shapes }, ...original.keys]);
    }
    expect(out.layers).toEqual(f.p.layers);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}

test('symbol workspace copies a complete remembered tween with local Undo and exact Save', async ({ page }) => {
  const f = await setup(page, true, false, false, false, true, true);
  await f.open('stage');
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true }), box = (await grid.boundingBox())!;
  const base = (await f.workspace.locator('[data-symbol-layer="@base"]').boundingBox())!;
  const y = base.y + base.height / 2;
  await page.mouse.move(box.x + 8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 * 18 + 8, y, { steps: 5 });
  await page.mouse.up();
  await grid.press('Control+c');
  await clickFrame(f.workspace, 3, 'upper');
  await grid.press('Control+v');
  await expect(f.workspace.getByRole('alert')).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await grid.press('Control+z');
  await grid.press('Control+Shift+z');
  await f.save();
  const out = (await f.read()).symbols![0], original = f.definition.timeline!, target = out.timeline!.layers![0];
  expect(out.timeline!.duration).toBe(original.duration);
  expect(out.timeline!.keys).toEqual(original.keys);
  expect(out.timeline!.motionSpans).toEqual(original.motionSpans);
  expect(target.keys.map(key => key.frame)).toEqual([0, 3, 4, 5, 6, 7]);
  expect(target.keys[0]).toEqual(original.layers![0].keys[0]);
  expect(target.motionSpans![0]).toMatchObject({ start: 3, end: 7 });
  expect(JSON.parse(target.motionSpans![0].baseline)).toEqual(target.keys.slice(2, -1));
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('keyboard symbol layer properties opens for the focused row and restores focus', async ({ page }) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  const timeline = f.workspace.getByRole('region', { name: 'Timeline', exact: true });
  const layer = (name: string) => timeline.getByRole('group', { name: `Layer row ${name}`, exact: true }).locator('button.layer-name');
  await expect(layer('Artwork')).toHaveAttribute('aria-current', 'true');
  const upper = layer('Upper');
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  const properties = menu.getByRole('menuitem', { name: 'Layer properties…', exact: true });
  await upper.press('Shift+F10');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(upper).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await upper.press('ContextMenu');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  const name = dialog.getByLabel('Layer properties name', { exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Upper');
  await name.fill('Keyboard ink');
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).press('Enter');
  await expect(layer('Keyboard ink')).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await f.save();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].shapes).toEqual(f.definition.shapes);
  expect(saved.symbols![0].timeline?.keys).toEqual(f.definition.timeline?.keys);
  expect(saved.symbols![0].timeline?.layers?.[0]).toMatchObject({ ...f.definition.timeline!.layers![0], name: 'Keyboard ink' });
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('keyboard symbol layer menu opens from a toggle and returns focus to it', async ({ page }) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  const lock = f.workspace.getByRole('button', { name: 'Toggle lock Upper', exact: true });
  const menu = page.getByRole('menu', { name: 'Editing actions' });
  const properties = menu.getByRole('menuitem', { name: 'Layer properties…', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lock.press('Shift+F10');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(lock).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await lock.press('ContextMenu');
  await expect(properties).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  await expect(dialog.getByLabel('Layer properties name', { exact: true })).toHaveValue('Upper');
  await dialog.getByRole('checkbox', { name: 'Layer properties locked', exact: true }).press('Space');
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).press('Enter');
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await f.workspace.getByRole('button', { name: 'Undo symbol timeline change' }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await f.workspace.getByRole('button', { name: 'Redo symbol timeline change' }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  expect(await f.read()).toEqual(f.p);
  await f.save();
  const saved = await f.read();
  expect(saved.layers).toEqual(f.p.layers);
  expect(saved.symbols![0].timeline?.layers).toEqual(
    f.definition.timeline!.layers!.map(layer => layer.name === 'Upper'
      ? { ...layer, locked: true, outline: false, outlineColor: '#00a6b8' }
      : layer),
  );
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a changed-and-restored properties input after complete candidate preparation rejects and allows a fresh retry', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.workspace
    .getByRole('group', { name: 'Layer row Artwork', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  const name = dialog.getByLabel('Layer properties name', { exact: true });
  const type = dialog.getByLabel('Layer properties type', { exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const row = f.workspace.getByRole('group', { name: 'Layer row Artwork', exact: true });
  const rowButton = row.locator('button.layer-name');
  await expect(name).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(type).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(type).toBeFocused();
  await name.fill('Discarded draft');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rowButton).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).press('Enter');
  await expect(name).toHaveValue('Artwork');
  await dialog.getByLabel('Layer outline color', { exact: true }).fill('#ff8800');
  await page.evaluate(() => {
    const native = JSON.stringify;
    Reflect.set(window, 'layerPropsHook', 0);
    JSON.stringify = function (value: unknown, ...rest: unknown[]) {
      const out = Reflect.apply(native, JSON, [value, ...rest]);
      const p = value as Project;
      if (
        !Reflect.get(window, 'layerPropsHook') &&
        p?.symbols?.some((s) => s.baseLayer?.outlineColor === '#ff8800')
      ) {
        Reflect.set(window, 'layerPropsHook', 1);
        const input = document.querySelector(
          'input[aria-label="Layer outline color"]',
        ) as HTMLInputElement;
        input.value = '#00aa00';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = '#ff8800';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return out;
    };
  });
  const apply = dialog.getByRole('button', { name: 'Apply layer properties', exact: true });
  await apply.press('Enter');
  expect(await page.evaluate(() => Reflect.get(window, 'layerPropsHook'))).toBe(1);
  await expect(dialog.getByRole('alert')).toContainText('input changed');
  await expect(apply).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(rowButton).toBeFocused();
  await f.save();
  expect((await f.read()).symbols![0].baseLayer!.outlineColor).toBe('#ff8800');
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Escape cancels a native symbol frame movement and a fresh movement succeeds', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.frame(4);
  const c = f.workspace.getByLabel('Timeline frames', { exact: true }),
    b = (await c.boundingBox())!;
  await page.mouse.move(b.x + 80, b.y + 39);
  await page.mouse.down();
  await page.mouse.move(b.x + 116, b.y + 39, { steps: 3 });
  await c.press('Escape');
  await page.mouse.up();
  await f.save();
  expect(await f.read()).toEqual(f.p);
});


test('custom tool, timeline and undo shortcuts work inside a separate symbol workspace', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('splash-shortcuts-v1', JSON.stringify({
    version: 1, bindings: { 'tool:brush': 'u', keyframe: 'Shift+j', undo: 'Primary+Shift+u' },
  })));
  const f = await setup(page, true);
  await f.open('stage');
  const stage = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  const brush = f.workspace.getByRole('button', { name: 'Brush', exact: true });
  await stage.press('u');
  await expect(brush).toHaveAttribute('aria-pressed', 'true');
  await expect(brush).toHaveAttribute('title', 'Brush (U)');
  expect(await f.read()).toEqual(f.p);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await f.frame(2);
  await grid.press('Shift+j');
  await grid.press('Control+Shift+u');
  await f.save();
  expect(await f.read()).toEqual(f.p);

  await f.open('stage');
  await f.frame(2);
  await grid.press('Shift+j');
  await f.save();
  const project = await f.read();
  expect(project.symbols![0].timeline!.keys.some(key => key.frame === 2)).toBe(true);
});

test('symbol timeline shares F5/F6/F7 and arrow/Home/End navigation with the scene', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.frame(2);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('F6');
  await grid.press('ArrowRight');
  await grid.press('F7');
  await grid.press('F5');
  await grid.press('Home');
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 1 / 9');
  await grid.press('End');
  await expect(f.workspace.locator('.frame-readout')).toContainText('Frame 9 / 9');
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.duration).toBe(9);
  expect(
    out.symbols![0].timeline!.keys.some((k) => k.frame === 2 && k.shapes[0]?.fill === '#ff0000'),
  ).toBe(true);
  expect(
    out.symbols![0].timeline!.keys.some((k) => k.frame === 5 && k.shapes[0]?.fill === '#0000ff'),
  ).toBe(true);
  expect(out.layers).toEqual(f.p.layers);
});

for (const movie of [false, true])
  test(`${movie ? 'movie clip' : 'graphic symbol'} workspace plays local frames and nested clocks from its playhead`, async ({
    page,
  }) => {
    const f = await setup(page, movie, false, false, false, false, false, true);
    const base = await f.screen(120, 95),
      graphic = await f.screen(178, 90),
      clip = await f.screen(178, 124),
      reference = await f.screen(365, 190);
    await f.open('stage');
    await f.frame(3);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 500));
    const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
    const readout = f.workspace.locator('.frame-readout');
    const play = f.workspace.getByRole('button', { name: 'Play animation', exact: true });
    const faded = await f.pixel(canvas, reference);
    await play.click();
    const stop = f.workspace.getByRole('button', { name: 'Stop playback', exact: true });
    await expect(stop).toBeVisible();
    await expect(readout).toHaveText('Frame 4 / 8');
    expect(await f.pixel(canvas, base)).toEqual([255, 0, 0, 255]);
    expect(await f.pixel(canvas, graphic)).toEqual([0, 0, 255, 255]);
    expect(await f.pixel(canvas, clip)).toEqual([255, 0, 0, 255]);
    await page.clock.runFor(125);
    await expect(readout).toHaveText('Frame 5 / 8');
    expect(await f.pixel(canvas, base)).toEqual([0, 0, 255, 255]);
    expect(await f.pixel(canvas, graphic)).toEqual([0, 0, 255, 255]);
    expect(await f.pixel(canvas, clip)).toEqual([0, 255, 0, 255]);
    expect(await f.pixel(canvas, reference)).toEqual(faded);
    await page.clock.runFor(400);
    await expect(readout).toHaveText('Frame 1 / 8');
    expect(await f.pixel(canvas, base)).toEqual([255, 0, 0, 255]);
    await stop.click();
    await page.clock.runFor(400);
    await expect(readout).toHaveText('Frame 1 / 8');
    await play.click();
    await f.frame(4);
    await expect(play).toBeVisible();
    await page.clock.runFor(250);
    await expect(readout).toHaveText('Frame 5 / 8');
    expect(await f.pixel(canvas, base)).toEqual([0, 0, 255, 255]);
    await f.save();
    expect(await f.read()).toEqual(f.p);
  });

for (const movie of [false, true])
  test(`in-place ${movie ? 'movie' : 'symbol'} zooms at the pointer and middle-drags without an edit`, async ({
    page,
  }) => {
    const f = await setup(page, movie);
    const anchor = await f.screen(130, 100);
    await f.open('stage');
    const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
    const zoom = f.workspace.getByRole('combobox', { name: 'Zoom', exact: true });
    await expect.poll(() => f.pixel(canvas, anchor)).toEqual([255, 0, 0, 255]);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1.2);
    await expect.poll(() => f.pixel(canvas, anchor)).toEqual([255, 0, 0, 255]);
    const moved = { x: anchor.x + 50, y: anchor.y + 24 };
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(moved.x, moved.y, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => f.pixel(canvas, moved)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(canvas, anchor)).not.toEqual([255, 0, 0, 255]);
    const scrollbar = f.workspace.getByRole('scrollbar', { name: 'Canvas horizontal scrollbar' });
    const offset = Number(await scrollbar.getAttribute('aria-valuenow'));
    await scrollbar.press('ArrowRight');
    await expect
      .poll(async () => Number(await scrollbar.getAttribute('aria-valuenow')))
      .toBeCloseTo(offset + 40);
    await scrollbar.press('ArrowLeft');
    await expect.poll(() => f.pixel(canvas, moved)).toEqual([255, 0, 0, 255]);
    if (movie) {
      await f.frame(4);
      await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1.2);
      await expect.poll(() => f.pixel(canvas, moved)).toEqual([0, 0, 255, 255]);
    }
    await zoom.selectOption('20');
    await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(20);
    await f.workspace.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThanOrEqual(1);
    await f.save();
    expect(await f.read()).toEqual(f.p);
  });

for (const key of ['F5', 'F6', 'F7'] as const)
  test(`in-place timeline selects empty cells and applies ${key} there without moving the old playhead first`, async ({
    page,
  }) => {
    const f = await setup(page, true);
    await f.open('stage');
    await f.frame(4);
    await clickFrame(f.workspace, 11);
    await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 5 / 8');
    const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
    await grid.press(key);
    await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 12 / 12');
    await f.save();
    const out = await f.read();
    const timeline = out.symbols![0].timeline!;
    expect(timeline.duration).toBe(12);
    expect(timeline.keys[0]).toEqual(f.definition.timeline!.keys[0]);
    expect(timeline.keys.find((k) => k.frame === 11)?.shapes).toEqual(
      key === 'F5' ? undefined : key === 'F6' ? f.definition.timeline!.keys[0].shapes : [],
    );
    expect(out.layers).toEqual(f.p.layers);
  });

test('in-place tools inherit scene defaults and keep the chosen tool and settings across keys', async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('120');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await f.open('stage');
  await f.workspace.getByRole('button', { name: 'Brush', exact: true }).click();
  const amount = f.workspace.getByLabel('Brush simplify amount', { exact: true });
  await expect(amount).toHaveValue('120');
  await expect(f.workspace.getByLabel('Brush lock size to canvas', { exact: true })).toBeChecked();
  await amount.fill('');
  await f.frame(1);
  await expect(amount).toHaveValue('');
  await amount.fill('185');
  await f.frame(2);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('F7');
  await expect(amount).toHaveValue('185');
  await expect(f.workspace.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const a = await f.screen(140, 140);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 45, a.y, { steps: 6 });
  await page.mouse.up();
  await expect(f.workspace.getByText('Finishing symbol stroke...', { exact: true })).toHaveCount(0);
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.keys.find((k) => k.frame === 2)?.shapes[0]).toMatchObject({
    kind: 'polygon',
    fill: '#00ff00',
  });
  expect(out.layers).toEqual(f.p.layers);
});

test('in-place Pencil uses the scene shortcut and splits intersecting lines in Merge mode', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  await f.frame(2);
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.press('F7');
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.press('y');
  await expect(f.workspace.getByRole('button', { name: 'Pencil', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    f.workspace.getByLabel('Separate Pencil objects', { exact: true }),
  ).not.toBeChecked();
  await expect(f.workspace.getByLabel('Pencil simplify amount', { exact: true })).toHaveValue('50');
  const draw = async (x: number, y: number, endX: number, endY: number) => {
    const a = await f.screen(x, y),
      b = await f.screen(endX, endY);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await expect(f.workspace.getByText('Finishing symbol stroke...', { exact: true })).toHaveCount(
      0,
    );
  };
  await draw(126, 141, 182, 141);
  await draw(154, 117, 154, 165);
  await f.save();
  const out = await f.read();
  const shapes = out.symbols![0].timeline!.keys.find((k) => k.frame === 2)!.shapes;
  expect(shapes).toHaveLength(4);
  expect(shapes.every((s) => s.fillEnabled === false && s.drawingMode === 'merge')).toBe(true);
  expect(out.layers).toEqual(f.p.layers);
});

test('symbol frame context converts a future cell without moving the playhead before insertion', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.open('stage');
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.click({ button: 'right', position: { x: 12 * 18 + 8, y: 39 } });
  await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 1 / 8');
  await page.getByRole('menuitem', { name: 'Convert to keyframe', exact: true }).click();
  await expect(f.workspace.locator('.frame-readout')).toHaveText('Frame 13 / 13');
  await f.save();
  const result = await f.read();
  expect(result.symbols![0].timeline!.keys.at(-1)).toEqual({
    frame: 12,
    shapes: f.definition.timeline!.keys[0].shapes,
  });
  expect(result.layers).toEqual(f.p.layers);
});

test('shared symbol frame comments stay local until Save and reopen on their own timeline', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage', true);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.click({ button: 'right', position: { x: 44, y: 40 } });
  await page.getByRole('menuitem', { name: 'Edit frame comment…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit frame comment', exact: true });
  const text = 'Inside the clip\nHold for two frames';
  const field = dialog.getByRole('textbox', { name: 'Frame comment text' });
  await expect(field).toBeFocused();
  await field.fill(text);
  await dialog.getByRole('button', { name: 'Save frame comment' }).click();
  await expect(timeline).toBeFocused();
  const current = page.getByLabel('Current frame comment');
  await expect(current).toHaveAttribute('title', text);
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Control+z');
  await expect(current).toHaveCount(0);
  await timeline.press('Control+Shift+z');
  await expect(current).toHaveAttribute('title', text);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = structuredClone(f.p);
  saved.symbols![0].timeline!.frameComments = [{ frame: 2, text }];
  await expect.poll(f.read).toEqual(saved);
  await f.open('stage', true);
  await timeline.click({ position: { x: 44, y: 40 } });
  await expect(current).toHaveAttribute('title', text);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('shared symbol frame label stays local until Save and is separately undoable', async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage', true);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.click({ button: 'right', position: { x: 44, y: 40 } });
  await page.getByRole('menuitem', { name: 'Edit frame label…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit frame label', exact: true });
  await dialog.getByLabel('Frame label name').fill('Inside');
  await dialog.getByRole('button', { name: 'Save frame label' }).click();
  const label = page.getByLabel('Current frame label', { exact: true });
  await expect(label).toHaveText('Inside');
  expect(await timeline.evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(37, 47, 1, 1).data),
  )).toEqual([255, 210, 119, 255]);
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Control+z');
  await expect(label).toHaveCount(0);
  await timeline.press('Control+Shift+z');
  await expect(label).toHaveText('Inside');
  // Moving a local key onto the label keeps the destination's timeline name.
  const box = (await timeline.boundingBox())!;
  const x = (frame: number) => box.x + 18 * frame + 8;
  const y = box.y + 40;
  await page.mouse.click(x(4), y);
  await page.mouse.move(x(4), y);
  await page.mouse.down();
  await page.mouse.move(x(2), y, { steps: 4 });
  await page.mouse.up();
  await expect(label).toHaveText('Inside');
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Control+z');
  await timeline.click({ position: { x: 44, y: 40 } });
  await expect(label).toHaveText('Inside');
  await timeline.press('Control+Shift+z');
  await expect(label).toHaveText('Inside');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const saved = structuredClone(f.p);
  saved.symbols![0].timeline!.frameLabels = [{ frame: 2, name: 'Inside' }];
  saved.symbols![0].timeline!.keys[0].frame = 2;
  await expect.poll(f.read).toEqual(saved);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const kind of ['motion', 'shape'] as const) {
  test(`converts to a ${kind} tween from the shared symbol timeline`, async ({ page }) => {
    const f = await setup(page, true);
    const stage = await f.screen(120, 100);
    await f.open('stage', true);
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    if (kind === 'shape') {
      await timeline.click({ position: { x: 8, y: 40 } });
      const panel = page.locator('[data-keyframe-properties]');
      await panel.getByRole('button', { name: 'Create shape tween', exact: true }).click();
      await expect(panel.locator('dt:has-text("Tween type") + dd')).toHaveText('Shape tween');
    } else {
      await timeline.click({ button: 'right', position: { x: 8, y: 40 } });
      await page.getByRole('menuitem', { name: `Convert to ${kind} tween`, exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await f.read()).toEqual(f.p);

    const middle = () => timeline.click({ position: { x: 2 * 18 + 8, y: 40 } });
    await middle();
    await expect.poll(() => f.pixel(f.stage, stage)).toEqual([128, 0, 128, 255]);
    await f.stage.press('Control+z');
    await expect.poll(() => f.pixel(f.stage, stage)).toEqual([255, 0, 0, 255]);
    await f.stage.press('Control+Shift+z');
    await middle();
    await expect.poll(() => f.pixel(f.stage, stage)).toEqual([128, 0, 128, 255]);

    await timeline.click({ position: { x: 4 * 18 + 8, y: 40 } });
    await f.stage.press('Control+a');
    const x = page.getByLabel('Shape X', { exact: true });
    await x.fill('40');
    await x.press('Tab');
    await middle();
    const movedPixel = await f.screen(175, 100);
    await expect.poll(() => f.pixel(f.stage, movedPixel)).toEqual([128, 0, 128, 255]);
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const out = await f.read();
    expect(out.layers).toEqual(f.p.layers);
    expect(out.symbols![0].shapes).toEqual(f.definition.shapes);
    expect(out.symbols![0].timeline!.keys.map(key => key.frame)).toEqual([1, 2, 3, 4]);
    expect(out.symbols![0].timeline!.keys[1].shapes[0].x).toBe(20);
    expect(out.symbols![0].timeline!.keys[3].shapes[0].x).toBe(40);
    expect(out.symbols![0].timeline!.motionSpans).toEqual([
      expect.objectContaining({ start: 0, end: 4, autoRefresh: true }),
    ]);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}

test('a symbol motion tween starts without an end and completes when a key is inserted', async ({ page }) => {
  const f = await setup(page);
  await f.open('stage', true);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const marker = (frame: number) => timeline.evaluate((element, at) => {
    const canvas = element as HTMLCanvasElement;
    const dpr = devicePixelRatio;
    return Array.from(canvas.getContext('2d')!.getImageData((at * 18 + 8) * dpr, 40 * dpr, 1, 1).data);
  }, frame);
  const save = () => page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await timeline.click({ button: 'right', position: { x: 8, y: 40 } });
  await page.getByRole('menuitem', { name: 'Convert to motion tween', exact: true }).click();
  await save();
  const opened = await f.read();
  expect(opened.layers).toEqual(f.p.layers);
  expect(opened.symbols![0]).toEqual({
    ...f.definition, openMotionTween: { affine: true, ease: 'linear' },
  });
  await f.open('stage', true);
  await timeline.click({ button: 'right', position: { x: 4 * 18 + 8, y: 40 } });
  await page.getByRole('menuitem', { name: 'Insert keyframe', exact: true }).click();
  // Sample the upper half of each dot, above the tween arrow.
  await expect.poll(() => marker(0)).toEqual([0, 0, 0, 255]);
  for (const at of [1, 2, 3]) await expect.poll(() => marker(at)).toEqual([96, 165, 250, 255]);
  await timeline.click({ button: 'right', position: { x: 2 * 18 + 8, y: 40 } });
  await page.getByRole('menuitem', { name: 'Convert to keyframe', exact: true }).click();
  await timeline.press('Control+ArrowRight');
  await expect(page.locator('.frame-readout')).toContainText('Frame 5 / 5');
  await expect.poll(() => marker(2)).toEqual([0, 0, 0, 255]);
  for (const at of [1, 3]) await expect.poll(() => marker(at)).toEqual([96, 165, 250, 255]);
  await timeline.press('Control+z');
  await expect.poll(() => marker(2)).toEqual([96, 165, 250, 255]);
  await timeline.press('Control+Shift+z');
  const target = await f.screen(170, 100);
  await timeline.click({ position: { x: 2 * 18 + 8, y: 40 } });
  await f.stage.press('Control+a');
  const x = page.getByLabel('Shape X', { exact: true });
  await x.fill('100');
  await x.press('Tab');
  for (const at of [1, 3]) {
    await timeline.click({ position: { x: at * 18 + 8, y: 40 } });
    await expect.poll(() => f.pixel(f.stage, target)).toEqual([255, 0, 0, 255]);
  }
  await save();
  const finished = await f.read();
  expect(finished.symbols![0].openMotionTween).toBeUndefined();
  expect(finished.symbols![0].timeline!.motionSpans).toEqual([
    expect.objectContaining({ start: 0, end: 2, autoRefresh: true }),
    expect.objectContaining({ start: 2, end: 4, autoRefresh: true }),
  ]);
  expect(finished.symbols![0].timeline!.keys.map(key => key.shapes[0].x)).toEqual([50, 100, 50, 0]);
  await f.open('stage', true);
  await timeline.click({ position: { x: 2 * 18 + 8, y: 40 } });
  await timeline.press('Shift+F6');
  await timeline.click({ position: { x: 4 * 18 + 8, y: 40 } });
  await expect.poll(() => marker(2)).toEqual([96, 165, 250, 255]);
  await timeline.press('Control+z');
  await expect.poll(() => marker(2)).toEqual([0, 0, 0, 255]);
  await timeline.click({ button: 'right', position: { x: 2 * 18 + 8, y: 40 } });
  await page.getByRole('menuitem', { name: 'Remove keyframes', exact: true }).click();
  await timeline.click({ position: { x: 1 * 18 + 8, y: 40 } });
  await expect.poll(() => f.pixel(f.stage, target)).toEqual([255, 255, 255, 255]);
  await save();
  const rejoined = await f.read();
  expect(rejoined.symbols![0].timeline!.motionSpans).toEqual([
    expect.objectContaining({ start: 0, end: 4, autoRefresh: true }),
  ]);
  expect(rejoined.symbols![0].timeline!.keys.map(key => key.shapes[0].x)).toEqual([0, 0, 0, 0]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(finished);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(opened);
});

for (const command of ['Shift+F5', 'Delete frames'] as const) {
  test(`${command} shortens a motion tween inside a symbol`, async ({ page }) => {
    const f = await setup(page);
    const junction = command === 'Delete frames';
    const last = junction ? 8 : 4;
    const movedPixel = await f.screen(junction ? 155 : 185, 100);
    await f.open('stage', true);
    const grid = page.getByLabel('Timeline frames', { exact: true });
    const click = (at: number, button: 'left' | 'right' = 'left') =>
      grid.click({ button, position: { x: at * 18 + 8, y: 40 } });
    const menu = (name: string) => page.getByRole('menuitem', { name, exact: true }).click();
    await click(0, 'right');
    await menu('Convert to motion tween');
    await click(last, 'right');
    await menu('Insert keyframe');
    await f.stage.press('Control+a');
    const x = page.getByLabel('Shape X', { exact: true });
    await x.fill('100');
    await x.press('Tab');
    if (junction) {
      await click(4, 'right');
      await menu('Insert keyframe');
      await click(4, 'right');
      await menu('Delete frames');
    } else {
      await click(1);
      await grid.press('Shift+F5');
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    await click(junction ? 4 : 3);
    await expect.poll(() => f.pixel(f.stage, movedPixel)).toEqual([255, 255, 255, 255]);
    await grid.press('Control+z');
    await expect.poll(() => f.pixel(f.stage, movedPixel)).toEqual([255, 0, 0, 255]);
    await grid.press('Control+Shift+z');
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const result = await f.read(), timeline = result.symbols![0].timeline!;
    expect(timeline.duration).toBe(last + 1);
    expect(timeline.motionSpans?.map(span => [span.start, span.end, span.autoRefresh]))
      .toEqual(junction ? [[0, 3, true], [4, 7, true]] : [[0, 3, true]]);
    expect(timeline.keys.map(key => [key.frame, key.shapes[0]?.x])).toEqual(junction ? [
      [1, 12.5], [2, 25], [3, 37.5], [4, 62.5], [5, 75], [6, 87.5], [7, 100], [8, undefined],
    ] : [[1, expect.closeTo(100 / 3)], [2, expect.closeTo(200 / 3)], [3, 100], [4, undefined]]);
    expect(result.layers).toEqual(f.p.layers);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}

for (const action of ['Delete frames', 'Remove keyframes'] as const)
test(`${action} from the symbol context menu keeps the selected range and supports Undo`, async ({ page }) => {
  const f = await setup(page, true);
  await f.open('stage');
  const timeline = f.workspace.getByLabel('Timeline frames', { exact: true });
  const box = (await timeline.boundingBox())!;
  const y = box.y + 39, x = (at: number) => box.x + 18 * at + 8;
  await page.mouse.move(x(2), y);
  await page.mouse.down();
  await page.mouse.move(x(4), y, { steps: 5 });
  await page.mouse.up();
  const remove = async () => {
    await page.mouse.click(x(3), y, { button: 'right' });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await remove();
  expect(await f.read()).toEqual(f.p);
  await timeline.press('Control+z');
  await timeline.press('Control+Shift+z');
  await f.save();
  const expected = structuredClone(f.p);
  const track = expected.symbols![0].timeline!;
  track.keys = action === 'Remove keyframes' ? [] : [{ ...track.keys[0], frame: 2 }, { frame: 5, shapes: [] }];
  await expect.poll(f.read).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('removing a remembered tween from a symbol hold preserves its editable keys', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, false, false, true);
  await f.open('stage');
  const grid = f.workspace.getByLabel('Timeline frames', { exact: true });
  await grid.click({ button: 'right', position: { x: 6 * 18 + 8, y: 39 } });
  const remove = page.getByRole('menuitem', { name: 'Remove motion tween', exact: true });
  await remove.click();
  await f.workspace
    .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
    .click();
  await grid.click({ button: 'right', position: { x: 6 * 18 + 8, y: 39 } });
  await expect(remove).toBeEnabled();
  await remove.click();
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.motionSpans).toBeUndefined();
  expect(out.symbols![0].timeline!.keys).toEqual(f.definition.timeline!.keys);
  expect(out.layers).toEqual(f.p.layers);
});

test('dragging symbol layer rows reorders the original tracks and remains locally undoable', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  await f.workspace.getByRole('button', { name: 'Add symbol layer', exact: true }).click();
  const newer = f.workspace.getByRole('group', { name: 'Layer row Layer 3', exact: true }),
    upper = f.workspace.getByRole('group', { name: 'Layer row Upper', exact: true });
  await newer.dragTo(upper, { targetPosition: { x: 60, y: 22 } });
  await f.workspace
    .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
    .click();
  await f.workspace
    .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
    .click();
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.layers!.map((l) => l.name)).toEqual(['Layer 3', 'Upper']);
  expect(out.symbols![0].timeline!.layers![1]).toEqual(f.definition.timeline!.layers![0]);
  expect(out.layers).toEqual(f.p.layers);
});

test('outline on an unselected symbol layer changes its faded reference while preserving actual published paint', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, false, true),
    point = await f.screen(180, 95);
  await f.open('stage');
  const canvas = f.workspace.getByLabel('Symbol artwork preview', { exact: true });
  await expect.poll(() => f.pixel(canvas, point)).toEqual([255, 219, 178, 255]);
  await f.workspace.getByRole('button', { name: 'Toggle outline Upper', exact: true }).click();
  await expect
    .poll(() => f.pixel(f.workspace.getByLabel('Symbol artwork preview'), point))
    .toEqual([255, 255, 255, 255]);
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.layers![0].outline).toBe(true);
  expect(out.symbols![0].timeline!.layers![0].keys).toEqual(f.definition.timeline!.layers![0].keys);
  await expect.poll(() => f.pixel(f.stage, point)).toEqual([255, 136, 0, 255]);
});

test('saved base-layer visibility affects linked scene instances and HTML output, with exact document Undo', async ({
  page,
}) => {
  const f = await setup(page);
  const at = await f.screen(110, 90);
  await f.open('stage');
  await f.workspace.getByRole('button', { name: 'Toggle visibility Artwork', exact: true }).click();
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].baseLayer!.visible).toBe(false);
  expect(out.symbols![0].shapes).toEqual(f.definition.shapes);
  await expect.poll(() => f.pixel(f.stage, at)).toEqual([255, 255, 255, 255]);
  const pending = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await pending),
    exported = await page.context().newPage();
  await openWebExport(exported, files);
  const pixel = await exported
    .locator('canvas')
    .evaluate((c: HTMLCanvasElement) =>
      Array.from(c.getContext('2d')!.getImageData(110, 90, 1, 1).data),
    );
  expect(pixel).toEqual([255, 255, 255, 255]);
  await exported.close();
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(f.stage, at)).toEqual([255, 0, 0, 255]);
});

test('multi-layer symbol frame Copy and Paste use the selected rows and one local history change', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, false, true);
  await f.open('stage');
  const c = f.workspace.getByLabel('Timeline frames', { exact: true }),
    b = (await c.boundingBox())!,
    top = (await f.workspace.locator('[data-symbol-layer="upper"]').boundingBox())!,
    bottom = (await f.workspace.locator('[data-symbol-layer="@base"]').boundingBox())!;
  await page.mouse.move(b.x + 2 * 18 + 8, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 3 * 18 + 8, bottom.y + bottom.height / 2, { steps: 4 });
  await page.mouse.up();
  await c.press('Control+c');
  await clickFrame(f.workspace, 6, 'upper');
  await c.press('Control+v');
  await expect(f.workspace.locator('[role="alert"]')).toHaveCount(0);
  await f.workspace
    .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
    .click();
  await f.workspace
    .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
    .click();
  await f.save();
  const out = await f.read();
  expect(out.symbols![0].timeline!.duration).toBe(10);
  const base = out.symbols![0].timeline!.keys.find((k) => k.frame === 6)!,
    upper = out.symbols![0].timeline!.layers![0].keys.find((k) => k.frame === 6)!;
  expect(base.shapes[0].fill).toBe('#ff0000');
  expect(upper.shapes[0].fill).toBe('#ff8800');
  expect(out.layers).toEqual(f.p.layers);
});

test('edit an open symbol tween curve in place before its endpoint exists', async ({page}) => {
  const f=await setup(page), timeline=page.getByLabel('Timeline frames',{exact:true});
  await f.open('stage',true);
  const menu=async (at:number,label:string)=>{
    await timeline.click({button:'right',position:{x:at*18+8,y:40}});
    await page.getByRole('menuitem',{name:label,exact:true}).click();
  };
  await menu(0,'Convert to motion tween');
  await menu(0,'Edit motion tween easing');
  const easing=page.getByLabel('Tween easing',{exact:true});
  await easing.selectOption('custom');
  for(const [key,value] of Object.entries({X1:0,Y1:1,X2:1,Y2:1}))
    await page.getByLabel('Tween easing '+key,{exact:true}).fill(String(value));
  await page.getByRole('button',{name:'Apply easing',exact:true}).click();
  await expect(easing).toHaveCount(0);
  await timeline.press('Control+z');
  await menu(0,'Edit motion tween easing');
  await expect(easing).toHaveValue('linear');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await timeline.press('Control+Shift+z');
  const save=()=>page.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  await save();
  const opened=await f.read(), curve={kind:'cubic',x1:0,y1:1,x2:1,y2:1};
  expect(opened.symbols![0]).toEqual({...f.definition,openMotionTween:{affine:true,ease:curve}});
  expect(opened.layers).toEqual(f.p.layers);
  await f.open('stage',true);
  await menu(4,'Insert keyframe');
  await f.stage.press('Control+a');
  const x=page.getByLabel('Shape X',{exact:true});
  await x.fill('80');
  await x.press('Tab');
  await save();
  const saved=await f.read(), def=saved.symbols![0];
  expect(def.timeline!.motionSpans![0].ease).toEqual(curve);
  expect(def.timeline!.keys.find(k=>k.frame===2)!.shapes[0].x).toBeCloseTo(70,8);
  expect(saved.layers).toEqual(f.p.layers);
  await f.open('stage',true);
  await menu(2,'Insert keyframe');
  await save();
  const subdivided=(await f.read()).symbols![0].timeline!;
  expect(subdivided.motionSpans!.map(span=>[span.start,span.end])).toEqual([[0,2],[2,4]]);
  for (const key of def.timeline!.keys) {
    const after=subdivided.keys.find(item=>item.frame===key.frame)!;
    expect(after.shapes[0].x).toBeCloseTo(key.shapes[0].x,8);
  }
});
