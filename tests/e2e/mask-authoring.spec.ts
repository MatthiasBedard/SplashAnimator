import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  newProject,
  newLayer,
  validateProject,
  type Project,
  type Vector,
} from '../../packages/document/src';
import { prepareMaskLayer, prepareMaskMember } from '../../packages/document/src/mask-authoring';
import { exportHTML } from '../../packages/export-web/src';
import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';

function rectangle(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y,
    width,
    height,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    rotation: 0,
    points: [],
  };
}
function fixture() {
  const p = newProject();
  p.width = 240;
  p.height = 200;
  p.duration = 6;
  p.layers = ['Extra', 'Paint', 'Mask'].map((name) => {
    const l = newLayer(name);
    l.id = name;
    return l;
  });
  p.layers[0].keys[0].shapes = [rectangle('blue', 20, 80, 150, 100, '#0000ff')];
  p.layers[1].keys[0].shapes = [rectangle('red', 0, 0, 150, 100, '#ff0000')];
  p.layers[2].keys[0].shapes = [rectangle('green', 50, 50, 50, 60, '#00ff00')];
  return validateProject(p);
}
const row = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Layer row ' + name, exact: true });
async function setup(page: Page, p = fixture()) {
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
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
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const sample = (points: [number, number][]) =>
    canvas.evaluate((n, { p, points }) => {
      const c = n as HTMLCanvasElement,
        ctx = c.getContext('2d')!,
        d = devicePixelRatio;
      return points.map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round(c.width / 2 + (x - p.width / 2) * d),
            Math.round(c.height / 2 + (y - p.height / 2) * d),
            1,
            1,
          ).data,
        ),
      );
    }, { p, points });
  const pixels = () => sample([[70, 70], [70, 90], [30, 90], [70, 130]]);
  return { p, canvas, read, pixels, sample };
}
async function context(page: Page, name: string) {
  await row(page, name).locator('button.layer-name').click({ button: 'right' });
}
async function convert(page: Page, name = 'Mask') {
  await context(page, name);
  await page.getByRole('menuitem', { name: 'Convert to mask layer', exact: true }).click();
}
async function properties(page: Page, name = 'Mask') {
  await context(page, name);
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Layer properties', exact: true });
}
async function drag(page: Page, source: string, target: string) {
  const a = row(page, source),
    b = row(page, target);
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await a.dispatchEvent('dragstart', { dataTransfer: dt });
  await b.dispatchEvent('dragover', { dataTransfer: dt });
  await b.dispatchEvent('drop', { dataTransfer: dt });
  await a.dispatchEvent('dragend', { dataTransfer: dt });
}
const white = [255, 255, 255, 255],
  red = [255, 0, 0, 255],
  blue = [0, 0, 255, 255],
  green = [0, 255, 0, 255];

test('context conversion defaults to the next row, masks pixels and preserves exact Undo/Redo/recovery', async ({
  page,
}) => {
  const f = await setup(page);
  await expect.poll(f.pixels).toEqual([green, green, red, blue]);
  await convert(page);
  const q = prepareMaskLayer(f.p, 'Mask', true);
  await expect.poll(f.read).toEqual(q);
  await expect.poll(f.pixels).toEqual([red, red, blue, blue]);
  await expect(row(page, 'Paint')).toHaveClass(/masked-layer/);
  await expect(row(page, 'Mask')).toHaveClass(/mask-layer/);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect(row(page, 'Mask')).toHaveClass(/mask-layer/);
  const dialog = await properties(page);
  await expect(dialog.getByLabel('Layer properties type', { exact: true })).toHaveValue('true');
  await dialog
    .getByLabel('Layer properties type', { exact: true })
    .selectOption({ label: 'Normal' });
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  await expect.poll(f.read).toEqual(f.p);
});

test('two masks on the same timeline compose partial alpha and survive history, recovery and export', async ({ page, context }) => {
  const p = fixture();
  p.layers[1].keys[0].shapes[0].opacity = 0.5;
  p.layers[2].keys[0].shapes[0].opacity = 0.5;
  const f = await setup(page,p);
  await convert(page,'Paint');
  const inner = prepareMaskLayer(p,'Paint',true);
  await expect.poll(f.read).toEqual(inner);
  await convert(page,'Mask');
  const chain = prepareMaskLayer(inner,'Mask',true);
  const colors = [white,[191,191,255,255],white,white];
  await expect.poll(f.read).toEqual(chain);
  await expect.poll(f.pixels).toEqual(colors);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(inner);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(chain);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await expect.poll(f.pixels).toEqual(colors);
  const out = await context.newPage();
  await out.setContent(exportHTML(await f.read()));
  const readPixels = (c: HTMLCanvasElement) => [[70,70],[70,90],[30,90],[70,130]].map(([x,y]) =>
    Array.from(c.getContext('2d')!.getImageData(x,y,1,1).data));
  await expect.poll(() => out.locator('canvas').evaluate(readPixels)).toEqual(colors);
  if (process.env.SPLASH_TEST_LICENSE) {
    await page.getByRole('button',{name:'File',exact:true}).click();
    const [file] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button',{name:'Export current frame PNG…',exact:true}).click()]);
    const bytes = await readFile((await file.path())!);
    await out.goto('about:blank');
    await out.evaluate(async data => {
      const image = new Image();
      image.src = 'data:image/png;base64,'+data;
      await image.decode();
      const c = document.createElement('canvas');
      c.width=image.width; c.height=image.height;
      document.body.append(c);
      c.getContext('2d')!.drawImage(image,0,0);
    },bytes.toString('base64'));
    expect(await out.locator('canvas').evaluate(readPixels)).toEqual(colors);
  }
  await out.close();
});

test('Properties creates a mask and native layer dragging adds many layers to its indented run', async ({
  page,
}) => {
  const f = await setup(page),
    dialog = await properties(page);
  await dialog.getByLabel('Layer properties type', { exact: true }).selectOption({ label: 'Mask' });
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  await row(page, 'Extra').dragTo(row(page, 'Paint'));
  const q = prepareMaskMember(prepareMaskLayer(f.p, 'Mask', true), 'Mask', 'Extra');
  await expect.poll(f.read).toEqual(q);
  await expect.poll(f.pixels).toEqual([red, blue, white, white]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(prepareMaskLayer(f.p, 'Mask', true));
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
  await page.getByRole('button', { name: 'Toggle visibility Mask', exact: true }).click();
  await expect.poll(f.pixels).toEqual([white, white, white, white]);
  await page.getByRole('button', { name: 'Toggle visibility Mask', exact: true }).click();
  await expect.poll(f.pixels).toEqual([red, blue, white, white]);
});

test('mask alpha is applied once to the complete group', async ({
  page,
}) => {
  const p = fixture();
  p.layers[2].keys[0].shapes[0].opacity = 0.5;
  const q = prepareMaskMember(prepareMaskLayer(p, 'Mask', true), 'Mask', 'Extra'),
    f = await setup(page, q);
  await expect.poll(f.pixels).toEqual([[255, 127, 127, 255], [127, 127, 255, 255], white, white]);
  expect(await f.read()).toEqual(q);
});

test('outlining a mask shows its boundary and unclipped members until toggled off', async ({ page }) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra');
  p.layers[2].outlineColor = '#ff00ff';
  const f = await setup(page, p);
  const toggle = page.getByRole('button', { name: 'Toggle outline Mask', exact: true });
  await expect.poll(f.pixels).toEqual([red, blue, white, white]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(f.pixels).toEqual([red, blue, blue, blue]);
  await expect.poll(async () => {
    const edge = await f.sample([[49, 105], [50, 105], [51, 105]]);
    return edge.some(([r, g, b]) => r >= 64 && g === 0 && b === 255);
  }).toBe(true);
  const outlined = structuredClone(p);
  outlined.layers[2].outline = true;
  await expect.poll(f.read).toEqual(outlined);
  await toggle.click();
  await expect.poll(f.pixels).toEqual([red, blue, white, white]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(outlined);
  await expect.poll(f.pixels).toEqual([red, blue, blue, blue]);
});

test('mask outline suspends clipping even with the mask source hidden', async ({ page }) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra');
  p.layers[2].visible = false;
  p.layers[2].outlineColor = '#ff00ff';
  const f = await setup(page, p);
  const outline = page.getByRole('button', { name: 'Toggle outline Mask', exact: true });
  const visibility = page.getByRole('button', { name: 'Toggle visibility Mask', exact: true });
  const boundary = async () => {
    const edge = await f.sample([[49, 105], [50, 105], [51, 105]]);
    return edge.some(([r, g, b]) => r >= 64 && g === 0 && b === 255);
  };
  await expect.poll(f.pixels).toEqual([white, white, white, white]);
  await outline.click();
  await expect.poll(f.pixels).toEqual([red, blue, blue, blue]);
  await expect.poll(boundary).toBe(false);
  await visibility.click();
  await expect.poll(boundary).toBe(true);
  await expect.poll(f.pixels).toEqual([red, blue, blue, blue]);
  await outline.click();
  await expect.poll(f.pixels).toEqual([red, blue, white, white]);
  await expect.poll(async () => (await f.read()).layerMasks).toEqual(p.layerMasks);
});

test('invalid bottom conversion, locked drop and stale drag preserve artwork and history', async ({
  page,
}) => {
  const f = await setup(page);
  await convert(page, 'Extra');
  await expect.poll(f.read).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await convert(page);
  await page.getByRole('button', { name: 'Toggle lock Extra', exact: true }).click();
  const q = await f.read();
  await drag(page, 'Extra', 'Mask');
  await expect.poll(f.read).toEqual(q);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle lock Extra', exact: true }).click();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await row(page, 'Extra').dispatchEvent('dragstart', { dataTransfer: dt });
  await page.getByRole('button', { name: 'Toggle outline Paint', exact: true }).click();
  const before = await f.read();
  await row(page, 'Mask').dispatchEvent('drop', { dataTransfer: dt });
  await expect.poll(f.read).toEqual(before);
});

test('unmasking keeps all artwork and deleting a source releases its former members', async ({
  page,
}) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra'),
    f = await setup(page, p);
  await context(page, 'Mask');
  await page.getByRole('menuitem', { name: 'Convert to normal layer', exact: true }).click();
  const normal = structuredClone(p);
  delete normal.layerMasks;
  await expect.poll(f.read).toEqual(normal);
  await expect.poll(f.pixels).toEqual([green, green, blue, blue]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await row(page, 'Mask').locator('.layer-name').click();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  const removed = structuredClone(normal);
  removed.layers.pop();
  await expect.poll(f.read).toEqual(removed);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
});

test('production HTML export and PNG retain grouped mask clipping', async ({ page, context }) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra');
  p.layers[2].outline = true;
  const f = await setup(page, p);
  await expect.poll(f.pixels).toEqual([red, blue, blue, blue]);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const pending = page.waitForEvent('download');
  await exportHtmlFromShortcut(page, page.getByRole('button', { name: 'Export HTML animation…', exact: true }));
  const files = await readWebDownload(await pending),
    errors: string[] = [];
  const out = await context.newPage();
  out.on('pageerror', (e) => errors.push(String(e)));
  await openWebExport(out, files);
  const read = () =>
    out.locator('canvas').evaluate((n) => {
      const x = (n as HTMLCanvasElement).getContext('2d')!;
      return [
        [70, 70],
        [70, 90],
        [30, 90],
        [70, 130],
      ].map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data));
    });
  await expect.poll(read).toEqual([red, blue, white, white]);
  expect(errors).toEqual([]);
  await out.close();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await png).path())!);
  const pixels = await page.evaluate(
    async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const x = c.getContext('2d')!;
      x.drawImage(image, 0, 0);
      return [
        [70, 70],
        [70, 90],
        [30, 90],
        [70, 130],
      ].map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data));
    },
    'data:image/png;base64,' + bytes.toString('base64'),
  );
  expect(pixels).toEqual([red, blue, white, white]);
  expect(await f.read()).toEqual(p);
});

test('standalone alpha masks are independent of source colors, and hidden sources remain transparent', async ({
  page,
}) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra');
  p.layers.at(-1)!.keys[0].shapes[0].fill = '#000000';
  p.layers.at(-1)!.keys[0].shapes[0].opacity = 0.5;
  await page.goto('/');
  await page.setContent(exportHTML(p));
  const pixels = () =>
    page
      .locator('canvas')
      .evaluate((n) =>
        Array.from((n as HTMLCanvasElement).getContext('2d')!.getImageData(70, 90, 1, 1).data),
      );
  await expect.poll(pixels).toEqual([127, 127, 255, 255]);
  p.layers.at(-1)!.visible = false;
  await page.goto('/');
  await page.setContent(exportHTML(p));
  await expect.poll(pixels).toEqual(white);
});

test('ordinary Test movie uses the same clipped group and leaves the document unchanged', async ({
  page,
}) => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra'),
    f = await setup(page, p);
  await f.canvas.focus();
  await page.keyboard.press('Control+Enter');
  const movie = page.getByLabel('Test movie interaction', { exact: true });
  await expect(movie).toBeVisible();
  const pixels = () =>
    movie.evaluate((n) => {
      const x = (n as HTMLCanvasElement).getContext('2d')!;
      return [
        [70, 70],
        [70, 90],
        [30, 90],
        [70, 130],
      ].map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data));
    });
  await expect.poll(pixels).toEqual([red, blue, white, white]);
  expect(await f.read()).toEqual(p);
});

test('live tween stage clipping and ordinary key insertion keep the mask intact', async ({
  page,
}) => {
  let p = fixture();
  p.fps = 1;
  p.layers[0].visible = false;
  p.layers[1].keys.push({
    frame: 4,
    shapes: [{ ...structuredClone(p.layers[1].keys[0].shapes[0]), x: 160 }],
  });
  p = prepareMaskLayer(
    prepareTimelineTween(p, 'Paint', {
      start: 0,
      end: 4,
      kind: 'motion',
      affine: false,
      createEndpoints: false,
      ease: 'linear',
    }),
    'Mask',
    true,
  );
  const f = await setup(page, p);
  await row(page, 'Paint').locator('.layer-name').click();
  const frames = page.getByLabel('Timeline frames', { exact: true });
  await frames.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const pixel = (x: number, y: number) =>
    f.canvas.evaluate(
      (n, { x, y, p }) => {
        const c = n as HTMLCanvasElement,
          d = devicePixelRatio;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - p.width / 2) * d),
              Math.round(c.height / 2 + (y - p.height / 2) * d),
              1,
              1,
            ).data,
        );
      },
      { x, y, p },
    );
  await expect.poll(() => pixel(70, 70)).toEqual(white);
  await expect.poll(() => pixel(90, 70)).toEqual(red);
  const outline = page.getByRole('button', { name: 'Toggle outline Mask', exact: true });
  await outline.click();
  await expect.poll(() => pixel(130, 70)).toEqual(red);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await expect.poll(() => pixel(130, 70)).toEqual(white);
  await frames.focus();
  await page.keyboard.press('F6');
  await expect.poll(async () => (await f.read()).layers[1].keys.map((k) => k.frame)).toContain(2);
  const q = await f.read();
  expect(q.layerMasks).toEqual(p.layerMasks);
  expect(q.layers[1].keys[0]).toEqual(p.layers[1].keys[0]);
  expect(q.layers[1].keys.at(-1)).toEqual(p.layers[1].keys.at(-1));
  validateProject(q);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(dialog.getByLabel('Live movie status')).toContainText('Live movie ready');
  await dialog.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  const movie = dialog.getByLabel('Live movie interaction', { exact: true });
  await expect
    .poll(() =>
      movie.evaluate((n) => {
        const c = (n as HTMLCanvasElement).getContext('2d')!;
        return [
          Array.from(c.getImageData(70, 70, 1, 1).data),
          Array.from(c.getImageData(90, 70, 1, 1).data),
        ];
      }),
    )
    .toEqual([white, red]);
  expect(await f.read()).toEqual(p);
});

test('bitmap mask artwork clips a nested graphic without losing saved mask ownership', async ({
  page,
}) => {
  await page.goto('/');
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000000';
    x.fillRect(0, 0, 4, 4);
    return c.toDataURL('image/png');
  });
  const p = fixture();
  p.layers[0].visible = false;
  const art = p.layers[1].keys[0].shapes[0];
  p.symbols = [
    { id: 'graphic', name: 'Graphic', width: 150, height: 100, shapes: [{ ...art, x: 0, y: 0 }] },
  ];
  p.layers[1].keys[0].shapes = [{ ...art, kind: 'symbol', symbolId: 'graphic' }];
  p.assets.push({
    id: 'image',
    path: 'assets/bitmaps/image.json',
    bitmap: { name: 'Mask bitmap', width: 4, height: 4, dataUrl: url },
  });
  p.layers[2].keys[0].shapes[0].bitmap = { assetId: 'image', x: 0, y: 0, width: 50, height: 60 };
  const q = prepareMaskLayer(p, 'Mask', true),
    f = await setup(page, q);
  await expect.poll(f.pixels).toEqual([red, red, white, white]);
  expect(await f.read()).toEqual(q);
  const html = exportHTML(q);
  await page.setContent(html);
  await expect
    .poll(() =>
      page
        .locator('canvas')
        .evaluate((n) =>
          Array.from((n as HTMLCanvasElement).getContext('2d')!.getImageData(70, 70, 1, 1).data),
        ),
    )
    .toEqual(red);
});

test('sampled-stage display keeps the complete saved group clipped without source writes',async({page})=>{
  const p=prepareMaskMember(prepareMaskLayer(fixture(),'Mask',true),'Mask','Extra'),f=await setup(page,p);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  await expect.poll(f.pixels).toEqual([red,blue,white,white]);expect(await f.read()).toEqual(p);
  await page.getByRole('button',{name:'Return to authored stage',exact:true}).click();
  await expect.poll(f.pixels).toEqual([red,blue,white,white]);expect(await f.read()).toEqual(p);
});
