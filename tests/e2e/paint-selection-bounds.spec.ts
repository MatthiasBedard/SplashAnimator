import { expect, test, type Page } from '@playwright/test';
import {
  newProject,
  validateProject,
  type Project,
  type Vector,
  type SymbolDefinition,
} from '../../packages/document/src';
import { contains, vectorPolygons } from '../../packages/geometry/src/merge';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { hit, worldPoint } from '../../packages/geometry/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { compoundBrushPaint } from '../compound-simplify-fixture';
async function setup(page: Page, kind = 'rectangle', hold = false, scope: 'scene' | 'symbol' = 'scene') {
  if (hold) await holdGeometry(page);
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = 'merge';
  const shape: Vector = {
    id: 'paint',
    kind: 'rectangle',
    x: 80,
    y: 90,
    width: 100,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: 0,
    points: [],
  };
  const pencil = kind === 'pencil' || kind === 'pencil-destination';
  if (pencil || kind === 'brush')
    Object.assign(shape, {
      kind: pencil ? 'path' : 'brush',
      y: 110,
      height: 0,
      fillEnabled: kind === 'brush',
      strokeWidth: pencil ? 8 : 12,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
  if (kind === 'brush')
    shape.brush = { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 };
  const symbolLasso = kind === 'mixed-precision-symbol-lasso';
  const pointTouch = kind.endsWith('point-touch-sub-grid');
  const sharedSeam = kind.endsWith('shared-seam-sub-grid');
  if (kind === 'thin-hole' || kind === 'sub-grid-hole' || kind.startsWith('mixed-precision') ||
      kind === 'separated-sub-grid-hole' || sharedSeam || pointTouch) {
    const right = 30 + (kind === 'thin-hole' ? 0.00002 : 0.00000003);
    const crossing = kind === 'sub-grid-hole' || kind.startsWith('mixed-precision');
    const triangular = crossing || pointTouch;
    const top = crossing ? -1 : triangular || sharedSeam ? 0 : 10;
    Object.assign(shape, { kind: 'polygon', fillRule: 'nonzero', contours: [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
      [{ x: 30, y: top }, { x: 30, y: 50 }, { x: right, y: 50 },
        ...(triangular ? [] : [{ x: right, y: top }])],
    ] });
    if (kind === 'multiple-point-touch-sub-grid')
      shape.contours!.push([{ x: 45, y: 0 }, { x: 45, y: 50 }, { x: 45.00000003, y: 50 }]);
    if (kind === 'multiple-shared-seam-sub-grid')
      shape.contours!.push([{ x: 45, y: 0 }, { x: 45, y: 50 }, { x: 45.00000003, y: 50 }, { x: 45.00000003, y: 0 }]);
  }
  p.layers[0].keys[0].shapes = [shape];
  if (kind === 'pencil-destination') {
    p.layers[0].keys[0].shapes.push({
      ...shape, id: 'drop-fill', kind: 'rectangle', x: 120, y: 50, width: 20, height: 25,
      fillEnabled: true, strokeWidth: 0, points: [], fill: '#0000ff',
    });
  }
  if (kind === 'dense-remote-ellipse-cut') {
    Object.assign(shape, { kind: 'ellipse', x: 40, y: 40, width: 160, height: 160 });
    const ring = (y: number) => Array.from({ length: 72000 }, (_, i) => i < 36000
      ? { x: i / 512, y }
      : { x: (71999 - i) / 512, y: y + 8 });
    p.layers[0].keys[0].shapes.push({
      ...shape, id: 'dense-remote', kind: 'polygon', x: 300, y: 110, width: 80, height: 40,
      fill: '#0000ff', fillRule: 'evenodd', contours: [ring(0), ring(20)],
    });
  }
  if (kind === 'enclosed-rounded' || kind === 'enclosed-rounded-dense') {
    shape.cornerRadius = 18;
    p.layers[0].keys[0].shapes.push({
      ...shape, id: 'crossing', x: 160, y: 115, fill: '#0000ff', cornerRadius: 0,
    });
  }
  if (kind === 'enclosed-rounded-dense') {
    p.layers[0].keys[0].shapes.splice(1, 0, {
      ...shape, id: 'remote-dense', kind: 'polygon', x: 300, y: 110, width: 60, height: 60,
      fill: '#00ff00', cornerRadius: 0,
      points: Array.from({ length: 2048 }, (_, i) => {
        const angle = i * 2 * Math.PI / 2048;
        return { x: 30 + 30 * Math.cos(angle), y: 30 + 30 * Math.sin(angle) };
      }),
    });
  }
  if (kind === 'sub-grid-hole')
    p.layers[0].keys[0].shapes.push({ ...structuredClone(shape), id: 'remote', x: 270, fill: '#0000ff' });
  if (kind.startsWith('mixed-precision'))
    p.layers[0].keys[0].shapes.push({ id: 'pencil', kind: 'path', x: 42, y: 125,
      width: 40, height: 0, rotation: 0, fill: '#ff0000', fillEnabled: false,
      stroke: '#0000ff', strokeWidth: 28, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] });
  if (kind === 'mixed-precision-add')
    p.layers[0].keys[0].shapes.push({ ...shape, id: 'addition', kind: 'rectangle', contours: undefined,
      x: 185, y: 120, width: 40, height: 35, fill: '#00aa00' });
  if (symbolLasso) {
    const brush = compoundBrushPaint();
    p.layers[0].keys[0].shapes[1].strokeWidth = 6;
    p.layers[0].keys[0].shapes.push({ ...brush, x: 187, y: 118, transform: [.25, 0, 0, .25], fill: '#00aa00' });
  }
  if (kind === 'mixed') {
    const brush = { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 };
    const strokes = Array.from({length: 40}, (_, i): Vector => ({
      ...shape, id: 'stroke-' + i, kind: i % 2 ? 'brush' : 'path',
      x: 95 + (i % 8) * 12, y: 90 + Math.floor(i / 8) * 12,
      strokeWidth: 3, fillEnabled: i % 2 === 1, ...(i % 2 ? {brush} : {}),
      points: [{x: 0, y: 0}, {x: 25, y: 3}],
    }));
    p.layers[0].keys[0].shapes = [...strokes, {
      ...shape, kind: 'brush', brush, x: 90, y: 150, width: 0.00002, height: 0, strokeWidth: 12,
      points: [{x: 0, y: 0}, {x: 0.00002, y: 0}],
    }];
  }
  if (kind==='mixed-precision-eraser') {
    const art=p.layers[0].keys[0].shapes, ink=art[1];
    ink.width=110;
    ink.strokeWidth=8;
    ink.points[1].x=110;
    art.push({...ink,id:'green-brush',kind:'brush',y:255,fill:'#008800',fillEnabled:true,strokeWidth:16,
      brush:{pressure:false,minimum:1,aspect:1,tilt:false,angle:0}});
    art.push({id:'remote',kind:'rectangle',x:300,y:65,width:35,height:45,rotation:0,
      fill:'#775533',stroke:'#000000',strokeWidth:0,points:[]});
  }
  if (kind === 'dense-mixed-clipboard') {
    p.layers[0].keys[0].shapes = [compoundBrushPaint(), {
      id: 'clipboard-pencil', kind: 'path', x: 100, y: 180, width: 155, height: 0, rotation: 0,
      fill: '#000000', fillEnabled: false, stroke: '#0000ff', strokeWidth: 4,
      points: [{ x: 0, y: 0 }, { x: 155, y: 0 }],
    }, { ...shape, id: 'clipboard-remote', x: 300, y: 180, width: 40, height: 40, fill: '#008800' }];
  }
  if(scope==='symbol') {
    const layer=p.layers[0];
    const def:SymbolDefinition={id:'precision',name:'Precision scene',width:p.width,height:p.height,shapes:layer.keys[0].shapes};
    p.symbols=[def];
    layer.drawingMode='object';
    layer.keys[0].shapes=[symbolInstance(def,0,0)];
  }
  validateProject(p);
  await page.addInitScript(
    ({ project, keepRecovery }) => {
      if (keepRecovery && localStorage.getItem('splash-recovery-v1')) return;
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    },
    { project: p, keepRecovery: kind === 'mixed-precision-eraser' || kind === 'dense-mixed-clipboard' || symbolLasso },
  );
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible({ timeout: 15_000 });
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const point = (x: number, y: number) =>
    canvas.evaluate(
      (n, { p, x, y }) => {
        const c = n as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          w = c.width / devicePixelRatio,
          h = c.height / devicePixelRatio;
        return {
          x: r.x + (((w - p.width) / 2 + x) * r.width) / w,
          y: r.y + (((h - p.height) / 2 + y) * r.height) / h,
        };
      },
      { p, x, y },
    );
  const drag = async (x: number, y: number, x2: number, y2: number) => {
    const a = await point(x, y),
      b = await point(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const ready = () =>
    expect(page.getByText('Paint region ready: copy, cut or move.', { exact: true })).toBeVisible();
  const bounds = (w: number, h: number) => page.getByText(new RegExp(`^Bounds ${w} × ${h}\\.`));
  return { p, canvas, point, drag, read, ready, bounds };
}
test('Pencil runs stay editable after partial moves, covered drops, and erasing', async ({ page }) => {
  const f = await setup(page, 'pencil-destination');
  const edited = async () => (await f.read()).layers[0].keys[0].shapes;
  const ink = async (expected: number) => {
    const shapes = await edited();
    const strokes = shapes.filter(shape => shape.id !== 'drop-fill');
    expect(strokes).toHaveLength(expected);
    for (const stroke of strokes) {
      expect(['line', 'path', 'bezier']).toContain(stroke.kind);
      expect(stroke).toMatchObject({ fillEnabled: false, strokeWidth: 8, stroke: '#ff0000' });
    }
    return strokes;
  };
  const undo = async () => {
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  };
  const painted = (strokes: Vector[], x: number, y: number) => strokes.some(stroke => hit(stroke, { x, y }, 0));

  await f.drag(100, 94, 160, 126);
  await f.ready();
  await f.drag(115, 110, 115, 164);
  await expect.poll(f.read).not.toEqual(f.p);
  const moved = await ink(3);
  expect(painted(moved, 130, 164)).toBe(true);
  expect(painted(moved, 130, 110)).toBe(false);
  await undo();

  await f.drag(130, 60, 130, 110);
  await expect.poll(f.read).not.toEqual(f.p);
  expect(painted(await ink(1), 130, 110)).toBe(true);
  await f.canvas.press('Escape');
  await expect.poll(async () => (await edited()).length).toBe(3);
  expect(painted(await ink(2), 130, 110)).toBe(false);
  expect((await edited()).find(shape => shape.id === 'drop-fill')?.y).toBe(100);
  await undo();

  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await f.drag(130, 88, 130, 134);
  await expect.poll(f.read).not.toEqual(f.p);
  const erased = await ink(2);
  expect(painted(erased, 130, 110)).toBe(false);
  expect(painted(erased, 92, 110)).toBe(true);
  await undo();
});
test('a lasso touching only the painted edge moves an editable Pencil run', async ({ page }) => {
  const f = await setup(page, 'pencil');
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  await page.getByLabel('Drag paint region').check();
  for (const [x, y] of [[100, 112], [160, 112], [160, 125], [100, 125]]) {
    const point = await f.point(x, y);
    await page.mouse.click(point.x, point.y);
  }
  await f.canvas.press('Enter');
  await f.ready();
  expect(await f.read()).toEqual(f.p);
  await f.drag(115, 113, 115, 167);
  await expect.poll(f.read).not.toEqual(f.p);
  const strokes = (await f.read()).layers[0].keys[0].shapes;
  expect(strokes).toHaveLength(3);
  expect(strokes.every(stroke => stroke.kind === 'path' && stroke.strokeWidth === 8 && stroke.fillEnabled === false)).toBe(true);
  expect(strokes.some(stroke => hit(stroke, { x: 130, y: 164 }, 0))).toBe(true);
  expect(strokes.some(stroke => hit(stroke, { x: 130, y: 110 }, 0))).toBe(false);
  expect(strokes.some(stroke => hit(stroke, { x: 90, y: 110 }, 0))).toBe(true);
  const firstMove = await f.read();
  const origin = await f.point(115, 164), destination = await f.point(115, 207);
  const pixel = (x: number, y: number) => f.canvas.evaluate((canvas: HTMLCanvasElement, { x, y, w, h }) =>
    Array.from(canvas.getContext('2d')!.getImageData(
      Math.floor((canvas.width - w * devicePixelRatio) / 2 + x * devicePixelRatio),
      Math.floor((canvas.height - h * devicePixelRatio) / 2 + y * devicePixelRatio), 1, 1,
    ).data), { x, y, w: f.p.width, h: f.p.height });
  const holdMove = async () => {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 3 });
  };
  await holdMove();
  await expect.poll(() => pixel(121, 205)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(121, 164)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(firstMove);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => pixel(121, 164)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(121, 205)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(firstMove);
  await holdMove();
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual(
    strokes.map(stroke => stroke.y === 164 ? { ...stroke, y: 207 } : stroke),
  );
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(firstMove);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('Delete prepares only the surviving artwork and Undo restores the original mixed strokes', async ({ page }) => {
  const f = await setup(page, 'mixed', true);
  await f.drag(60, 70, 145, 165);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await f.ready();
  expect(await f.read()).toEqual(f.p);

  await f.canvas.press('Delete');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect.poll(f.read).not.toEqual(f.p);
  expect(await pendingGeometry(page)).toBe(0);
  const edited = (await f.read()).layers[0].keys[0].shapes;
  expect(edited.find(s => s.id === 'stroke-15')).toEqual(f.p.layers[0].keys[0].shapes[15]);
  const at = (x: number, y: number) => f.canvas.evaluate((element: HTMLCanvasElement, { x, y, w, h }) =>
    Array.from(element.getContext('2d')!.getImageData(
      Math.floor((element.width - w * devicePixelRatio) / 2 + x * devicePixelRatio),
      Math.floor((element.height - h * devicePixelRatio) / 2 + y * devicePixelRatio), 1, 1).data),
  { x, y, w: f.p.width, h: f.p.height });
  await expect.poll(() => at(110, 103)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => at(190, 103)).toEqual([255, 0, 0, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('whole-root precision fallback selects exact editable drawings for Delete and Undo', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(input: string | URL, options?: WorkerOptions) {
        super(input, options);
        this.addEventListener('message', event => {
          const result = event.data?.result;
          if (result?.mask && result.footprint?.length) {
            result.whole = Array.from({ length: 40 }, (_, i) => `stroke-${i}`).concat('paint');
            result.footprint = [];
          }
        });
      }
    };
  });
  const f = await setup(page, 'mixed');
  await f.drag(40, 50, 275, 195);
  await expect(page.getByText('Selected complete drawings.', { exact: false })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.press('Delete');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('overlapping independent footprints preview and move once, with exact Undo', async ({ page }) => {
  // Exercise worker delivery of overlapping, independently clipped polygons.
  // The geometry unit covers the collapse that produces this representation.
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(input: string | URL, options?: WorkerOptions) {
        super(input, options);
        this.addEventListener('message', event => {
          const result = event.data?.result;
          if (result?.mask && result.footprint?.length) {
            result.separate = true;
            result.footprint = [...result.footprint, ...result.footprint];
          }
        });
      }
    };
  });
  const f = await setup(page);
  await f.drag(60, 70, 125, 170);
  await f.ready();
  await expect(f.bounds(45, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  const pixel = (x: number, y: number) => f.canvas.evaluate((node: HTMLCanvasElement, { x, y, w, h }) =>
    Array.from(node.getContext('2d')!.getImageData(
      Math.floor((node.width - w * devicePixelRatio) / 2 + x * devicePixelRatio),
      Math.floor((node.height - h * devicePixelRatio) / 2 + y * devicePixelRatio), 1, 1).data),
  { x, y, w: f.p.width, h: f.p.height });
  const pick = await f.point(92, 105), drop = await f.point(92, 194);
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 3 });
  await expect.poll(() => pixel(92, 194)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(92, 105)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(150, 120)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await expect.poll(f.read).not.toEqual(f.p);
  const afterFirstMove = await f.read();
  const next = await f.point(192, 194);
  await page.mouse.move(drop.x, drop.y);
  await page.mouse.down();
  await page.mouse.move(next.x, next.y, { steps: 3 });
  await expect.poll(() => pixel(192, 194)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(92, 194)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(afterFirstMove);
  await page.mouse.up();
  await expect.poll(f.read).not.toEqual(afterFirstMove);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(afterFirstMove);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a real sub-grid contour can be deleted without rebuilding remote paint', async ({ page }) => {
  const f = await setup(page, 'sub-grid-hole', true);
  const select = async () => {
    await f.drag(45, 60, 240, 190);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect(page.getByText('Selected complete drawings.', { exact: false })).toBeVisible();
  };
  await select();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.press('Delete');
  const remaining = f.p.layers[0].keys[0].shapes.slice(1);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual(remaining);
  expect(await pendingGeometry(page)).toBe(0);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual(remaining);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await select();
  const point = await f.point(90, 115);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual(remaining);
  expect(await pendingGeometry(page)).toBe(0);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('partial Delete keeps the thin nonzero hole and Undo restores the source', async ({ page }) => {
  const f = await setup(page, 'thin-hole');
  await f.drag(60, 70, 105, 165);
  await f.ready();
  const point = await f.point(95, 120);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect.poll(f.read).not.toEqual(f.p);
  const [paint] = (await f.read()).layers[0].keys[0].shapes;
  const remaining = vectorPolygons(paint);
  expect(contains(remaining, { x: 90, y: 120 })).toBe(false);
  expect(contains(remaining, { x: 110.00001, y: 120 })).toBe(false);
  expect(contains(remaining, { x: 110.02, y: 120 })).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a separated sub-grid hole survives moving part of its fill and Undo', async ({ page }) => {
  const f = await setup(page, 'separated-sub-grid-hole');
  await f.drag(200, 70, 130, 165);
  await f.ready();
  await expect(f.bounds(50, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.drag(145, 112, 145, 208);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toHaveLength(2);
  const [outside, moved] = (await f.read()).layers[0].keys[0].shapes.map(shape => vectorPolygons(shape));
  expect(contains(outside, { x: 110.000000015, y: 120 })).toBe(false);
  expect(contains(outside, { x: 110.00001, y: 120 })).toBe(true);
  expect(contains(outside, { x: 150, y: 120 })).toBe(false);
  expect(contains(moved, { x: 150, y: 216 })).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
for (const notchCount of [1, 2]) test(`a partial marquee moves ${notchCount} shared-edge sub-grid notches without filling their gaps`, async ({ page }) => {
  const f = await setup(page, notchCount === 1 ? 'shared-seam-sub-grid' : 'multiple-shared-seam-sub-grid');
  await f.drag(60, 70, 140, 165);
  await f.ready();
  await expect(f.bounds(60, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.drag(95, 115, 95, 211);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toHaveLength(2);
  const [outside, moved] = (await f.read()).layers[0].keys[0].shapes.map(shape => vectorPolygons(shape));
  expect(contains(outside, { x: 150, y: 120 })).toBe(true);
  expect(contains(outside, { x: 95, y: 120 })).toBe(false);
  for (const x of notchCount === 1 ? [110] : [110, 125]) {
    expect(contains(moved, { x: x + 0.000000015, y: 216 })).toBe(false);
    expect(contains(moved, { x: x - 0.01, y: 216 })).toBe(true);
    expect(contains(moved, { x: x + 0.01, y: 216 })).toBe(true);
    expect(contains(moved, { x: x + 0.000000015, y: 240 })).toBe(true);
  }
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
for (const selection of ['marquee', 'lasso'] as const)
test(`a mixed ${selection} keeps the fully enclosed rounded rectangle editable after moving`, async ({ page }) => {
  const f = await setup(page, 'enclosed-rounded');
  if (selection === 'marquee') {
    await f.drag(60, 70, 190, 160);
  } else {
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await page.getByLabel('Lasso mode').selectOption('polygon');
    await page.getByLabel('Partial paint region').check();
    await page.getByLabel('Drag paint region').check();
    for (const [x, y] of [[60, 70], [205, 70], [190, 160], [60, 160]]) {
      const point = await f.point(x, y);
      await page.mouse.click(point.x, point.y);
    }
    await f.canvas.press('Enter');
  }
  await f.ready();
  expect(await f.read()).toEqual(f.p);
  await f.drag(100, 120, 100, 216);
  await expect.poll(f.read).not.toEqual(f.p);
  const artwork = (await f.read()).layers[0].keys[0].shapes;
  expect(artwork.find(shape => shape.id === 'paint')).toEqual({ ...f.p.layers[0].keys[0].shapes[0], y: 186 });
  const blue = artwork.filter(shape => shape.fill === '#0000ff').map(shape => vectorPolygons(shape));
  expect(blue.some(paint => contains(paint, { x: 170, y: 225 }))).toBe(true);
  expect(blue.some(paint => contains(paint, { x: 230, y: 135 }))).toBe(true);
  expect(blue.some(paint => contains(paint, { x: 170, y: 135 }))).toBe(false);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a partial move sends the original artwork once to prepare both sides of the cut', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    const requests: string[] = [];
    Object.assign(window, { paintCutRequests: requests });
    window.Worker = class extends NativeWorker {
      postMessage(message: { clip?: { keep: string }; splitPaintRegion?: unknown; editedPieces?: string[] }, transfer: Transferable[] | StructuredSerializeOptions = []) {
        if (message.clip) requests.push(message.clip.keep);
        if (message.splitPaintRegion) requests.push('split');
        if (message.editedPieces) requests.push('drop');
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  const f = await setup(page, 'enclosed-rounded');
  await f.drag(60, 70, 190, 160);
  await f.ready();
  expect(await f.read()).toEqual(f.p);
  await f.drag(100, 120, 100, 216);
  await expect.poll(f.read).not.toEqual(f.p);
  const requests = () => page.evaluate(
    () => (window as unknown as { paintCutRequests: string[] }).paintCutRequests);
  expect(await requests()).toEqual(['split']);
  await f.canvas.press('Escape');
  await expect.poll(requests).toEqual(['split', 'drop']);
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  const artwork = (await f.read()).layers[0].keys[0].shapes;
  expect(artwork.find(shape => shape.id === 'paint')).toEqual({ ...f.p.layers[0].keys[0].shapes[0], y: 186 });
  const blue = artwork.filter(shape => shape.fill === '#0000ff').map(shape => vectorPolygons(shape));
  expect(blue.some(paint => contains(paint, { x: 170, y: 225 }))).toBe(true);
  expect(blue.some(paint => contains(paint, { x: 230, y: 135 }))).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('partial move worker requests and replies retain dense outside artwork by checked source index', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    const replies: (string | number)[][] = [];
    const requests: { id: string; nodes: number }[][] = [];
    const state = { requests, replies, corrupt: false, pause: false, resume: undefined as (() => void) | undefined };
    Object.assign(window, { paintSplitProbe: state });
    window.Worker = class extends NativeWorker {
      postMessage(message: { splitPaintRegion?: unknown; shapes?: { id: string; points: unknown[] }[] }, transfer: Transferable[] | StructuredSerializeOptions = []) {
        if (message.splitPaintRegion && state.pause) {
          state.pause = false;
          state.resume = () => {
            state.resume = undefined;
            this.postMessage(message, transfer);
          };
          return;
        }
        if (message.splitPaintRegion) requests.push((message.shapes ?? []).map(shape => ({
          id: shape.id, nodes: shape.points.length,
        })));
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          const outside = event.data?.result?.outside;
          if (!Array.isArray(outside) || !Array.isArray(event.data.result.inside)) return;
          replies.push(outside.map(slot => typeof slot === 'number' ? slot : slot.id));
          if (state.corrupt) {
            state.corrupt = false;
            outside.splice(outside.indexOf(1), 1);
          }
        });
      }
    };
  });
  const f = await setup(page, 'enclosed-rounded-dense');
  const select = async () => {
    await f.drag(60, 70, 190, 160);
    await f.ready();
  };
  const move = () => f.drag(100, 120, 100, 216);
  const remote = f.p.layers[0].keys[0].shapes[1];
  await select();
  await move();
  await expect.poll(f.read).not.toEqual(f.p);
  expect(await page.evaluate(() => (window as unknown as {
    paintSplitProbe: { requests: { id: string; nodes: number }[][] };
  }).paintSplitProbe.requests)).toEqual([[{ id: 'paint', nodes: 0 }, { id: 'crossing', nodes: 0 }]]);
  const replies = await page.evaluate(() => (window as unknown as {
    paintSplitProbe: { replies: (string | number)[][] };
  }).paintSplitProbe.replies);
  expect(replies).toHaveLength(1);
  expect(replies[0][0]).toBe(1);
  expect(replies[0].filter(slot => typeof slot === 'number')).toEqual([1]);
  expect(replies[0]).not.toContain('remote-dense');
  const readRemote = async () => (await f.read()).layers[0].keys[0].shapes.find(shape => shape.id === remote.id);
  expect(await readRemote()).toEqual(remote);
  expect((await f.read()).layers[0].keys[0].shapes[0]).toEqual(remote);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await select();
  await page.evaluate(() => {
    (window as unknown as { paintSplitProbe: { corrupt: boolean } }).paintSplitProbe.corrupt = true;
  });
  await move();
  await expect(page.getByRole('alert')).toContainText('invalid paint cut');
  expect(await f.read()).toEqual(f.p);
  await page.evaluate(() => {
    (window as unknown as { paintSplitProbe: { pause: boolean } }).paintSplitProbe.pause = true;
  });
  await move();
  await expect.poll(() => page.evaluate(
    () => !!(window as unknown as { paintSplitProbe: { resume?: () => void } }).paintSplitProbe.resume,
  )).toBe(true);
  await expect(page.getByRole('alert')).toContainText('invalid paint cut');
  expect(await f.read()).toEqual(f.p);
  await page.evaluate(() => {
    (window as unknown as { paintSplitProbe: { resume: () => void } }).paintSplitProbe.resume();
  });
  await expect.poll(f.read).not.toEqual(f.p);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await readRemote()).toEqual(remote);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await select();
  await page.getByLabel('Stage color', { exact: true }).evaluate((input: HTMLInputElement) => {
    input.value = '#ffdead';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const recolored = { ...f.p, background: '#ffdead' };
  await expect.poll(f.read).toEqual(recolored);
  await move();
  await expect.poll(f.read).not.toEqual(recolored);
  expect(await page.evaluate(() => (window as unknown as {
    paintSplitProbe: { requests: { id: string; nodes: number }[][] };
  }).paintSplitProbe.requests.at(-1))).toContainEqual({ id: 'remote-dense', nodes: 2048 });
  expect(await readRemote()).toEqual(remote);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(recolored);
});
test('partial drop replies retain complete unchanged vectors by checked source index', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    const replies: (number | { id: string; nodes: number })[][] = [];
    const state = { replies, corrupt: false };
    Object.assign(window, { paintDropProbe: state });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          const result = event.data?.result;
          if (typeof result?.clearMargin !== 'boolean' || !Array.isArray(result.artwork)) return;
          replies.push(result.artwork.map((slot: number | { id: string; points: unknown[] }) =>
            typeof slot === 'number' ? slot : { id: slot.id, nodes: slot.points.length }));
          if (state.corrupt) {
            state.corrupt = false;
            result.artwork.pop();
          }
        });
      }
    };
  });
  const f = await setup(page, 'enclosed-rounded-dense');
  const [rounded, remote] = f.p.layers[0].keys[0].shapes;
  const select = async () => {
    await f.drag(60, 70, 190, 160);
    await f.ready();
  };
  // The selected rounded rectangle moves right through the surviving blue fill.
  const move = () => f.drag(100, 120, 200, 120);
  await select();
  await move();
  await expect.poll(f.read).not.toEqual(f.p);
  const readReplies = () => page.evaluate(() => (window as unknown as {
    paintDropProbe: { replies: unknown[][] };
  }).paintDropProbe.replies);
  expect(await readReplies()).toHaveLength(0);
  await f.canvas.press('Escape');
  await expect.poll(async () => (await readReplies()).length).toBe(1);
  const replies = await readReplies();
  expect(replies[0][0]).toBe(0);
  expect(replies[0].some(slot => typeof slot === 'object')).toBe(true);
  expect(replies[0].slice(-2).every(slot => typeof slot === 'number')).toBe(true);
  const artwork = (await f.read()).layers[0].keys[0].shapes;
  expect(artwork[0]).toEqual(remote);
  expect(artwork.find(shape => shape.id === rounded.id)).toEqual({ ...rounded, x: 180 });
  const blue = artwork.filter(shape => shape.fill === '#0000ff').map(shape => vectorPolygons(shape));
  expect(blue.some(paint => contains(paint, { x: 205, y: 130 }))).toBe(false);
  expect(blue.some(paint => contains(paint, { x: 235, y: 165 }))).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await select();
  await page.evaluate(() => {
    (window as unknown as { paintDropProbe: { corrupt: boolean } }).paintDropProbe.corrupt = true;
  });
  await move();
  await expect.poll(f.read).not.toEqual(f.p);
  const placed = await f.read();
  await f.canvas.press('Escape');
  await expect(page.getByRole('alert')).toContainText('invalid paint drop');
  expect(await f.read()).toEqual(placed);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a partial Cut keeps surviving ellipse curves beside dense untouched paint', async ({ page }) => {
  test.setTimeout(45000);
  const f = await setup(page, 'dense-remote-ellipse-cut');
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  for (const [x, y] of [[172, 80], [210, 80], [210, 154], [172, 154]]) {
    const point = await f.point(x, y);
    await page.mouse.click(point.x, point.y);
  }
  await f.canvas.press('Enter');
  await f.ready();
  const [, remote] = f.p.layers[0].keys[0].shapes;
  await f.canvas.press('Control+x');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].kind).toBe('polygon');
  const [survivor, untouched] = (await f.read()).layers[0].keys[0].shapes;
  const anchor = survivor.contours?.flat().find(node => {
    const point = worldPoint(survivor, node);
    return point.x === 40 && point.y === 120;
  });
  expect(anchor?.in).toBeDefined();
  expect(anchor?.out).toBeDefined();
  const handles = [worldPoint(survivor, anchor!.in!), worldPoint(survivor, anchor!.out!)];
  for (const handle of handles) {
    expect(handle.x).toBe(40);
    expect(Math.abs(handle.y - 120)).toBeCloseTo(80 * 0.5522847498307936, 8);
  }
  expect(contains(vectorPolygons(survivor), { x: 185, y: 120 })).toBe(false);
  expect(untouched).toEqual(remote);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const action of ['Cut', 'Delete'] as const) {
  test(`shared symbol mixed partial ${action} cancels on Escape and retries through Save and recovery`, async ({ page }) => {
    const f = await setup(page, 'dense-mixed-clipboard', true, 'symbol');
    const workspace = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
    const openSymbol = async () => {
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      const p = await f.point(320, 200);
      await page.mouse.dblclick(p.x, p.y);
      await expect(workspace).toBeVisible();
    };
    const pixel = (x: number, y: number) => f.canvas.evaluate((node, { x, y }) => {
      const c = node as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(
        c.width / 2 + (x - 200) * devicePixelRatio, c.height / 2 + (y - 150) * devicePixelRatio, 1, 1,
      ).data];
    }, { x, y });
    const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
    await openSymbol();
    const source = await f.read();
    await expect.poll(() => pixel(190, 140)).toEqual(red);
    await expect.poll(() => pixel(190, 180)).toEqual(blue);
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
    await page.getByLabel('Partial paint region', { exact: true }).check();
    for (const [x, y] of [[165, 75], [220, 75], [220, 205], [165, 205]]) {
      const p = await f.point(x, y);
      await page.mouse.click(p.x, p.y);
    }
    await f.canvas.press('Enter');
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await f.ready();
    const selectedPixels = await Promise.all([pixel(190, 140), pixel(190, 180)]);

    const key = action === 'Cut' ? 'Control+x' : 'Delete';
    await f.canvas.press(key);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await f.canvas.press('Escape');
    await releaseGeometry(page);
    await expect(workspace).not.toHaveAttribute('inert', '');
    expect(await f.read()).toEqual(source);
    await expect.poll(() => Promise.all([pixel(190, 140), pixel(190, 180)])).toEqual(selectedPixels);
    await expect(page.getByText(`${action} paint region cancelled.`, { exact: true })).toBeVisible();

    await f.canvas.press(key);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect.poll(() => pixel(190, 140)).toEqual(white);
    await expect.poll(() => pixel(190, 180)).toEqual(white);
    await expect.poll(() => pixel(84, 140)).toEqual(red);
    await expect.poll(() => pixel(120, 140)).toEqual(white);
    await expect.poll(() => pixel(240, 180)).toEqual(blue);
    await f.canvas.press('Control+z');
    await expect.poll(() => pixel(190, 140)).toEqual(red);
    await expect.poll(() => pixel(190, 180)).toEqual(blue);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(() => pixel(190, 140)).toEqual(white);
    await expect.poll(() => pixel(190, 180)).toEqual(white);
    expect(await f.read()).toEqual(source);

    await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    await expect(workspace).toHaveCount(0);
    const saved = await f.read();
    const [brush, , remote] = source.symbols![0].shapes;
    const shapes = saved.symbols![0].shapes;
    expect(shapes.find(shape => shape.id === remote.id)).toEqual(remote);
    const ink = shapes.filter(shape => shape.stroke === '#0000ff');
    expect(ink).toHaveLength(2);
    expect(ink.every(shape => shape.kind === 'path' && shape.fillEnabled === false && shape.strokeWidth === 4)).toBe(true);
    const originalAnchor = brush.contours![0].at(-1)!;
    const anchor = (shape: Vector, node: typeof originalAnchor) => ({
      ...worldPoint(shape, node), in: node.in && worldPoint(shape, node.in), out: node.out && worldPoint(shape, node.out),
    });
    const points = shapes.filter(shape => shape.fill === brush.fill)
      .flatMap(shape => shape.contours?.flat().map(node => anchor(shape, node)) ?? []);
    expect(points).toContainEqual(anchor(brush, originalAnchor));
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(source);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(saved);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    expect(await f.read()).toEqual(saved);
    await openSymbol();
    await expect.poll(() => pixel(190, 180)).toEqual(white);
    await expect.poll(() => pixel(240, 180)).toEqual(blue);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

for (const holeCount of [1, 2]) test(`a partial marquee moves ${holeCount} point-touching sub-grid holes with the fill`, async ({ page }) => {
  const f = await setup(page, holeCount === 1 ? 'point-touch-sub-grid' : 'multiple-point-touch-sub-grid');
  await f.drag(60, 70, 140, 165);
  await f.ready();
  await expect(f.bounds(60, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.drag(95, 115, 95, 211);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toHaveLength(2);
  const [outside, moved] = (await f.read()).layers[0].keys[0].shapes.map(shape => vectorPolygons(shape));
  expect(contains(outside, { x: 150, y: 120 })).toBe(true);
  expect(contains(outside, { x: 95, y: 120 })).toBe(false);
  for (const x of holeCount === 1 ? [110] : [110, 125]) {
    expect(contains(moved, { x: x + 0.00000001, y: 216 })).toBe(false);
    expect(contains(moved, { x: x - 0.01, y: 216 })).toBe(true);
    expect(contains(moved, { x: x + 0.01, y: 216 })).toBe(true);
    expect(contains(moved, { x: x + 0.00000001, y: 240 })).toBe(true);
  }
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a lasso selects and moves a complete drawing whose contour is too fine to cut', async ({ page }) => {
  const f = await setup(page, 'sub-grid-hole');
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  await page.getByLabel('Drag paint region').check();
  const select = async () => {
    for (const [x, y] of [[60, 70], [210, 60], [205, 170], [55, 175]]) {
      const point = await f.point(x, y);
      await page.mouse.click(point.x, point.y);
    }
    await f.canvas.press('Enter');
    await expect(page.getByText('Selected complete drawings.', { exact: false })).toBeVisible();
    expect(await f.read()).toEqual(f.p);
  };
  const [thin, remote] = f.p.layers[0].keys[0].shapes;
  await select();
  await f.drag(95, 115, 95, 200);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([
    remote, { ...thin, y: thin.y + 85 },
  ]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await select();
  await f.canvas.press('Delete');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([remote]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('Shift-marquee adds resolvable paint beside a newly reached precision failure', async ({ page }) => {
  const f = await setup(page, 'mixed-precision-add');
  const [thin, , addition] = f.p.layers[0].keys[0].shapes;
  const omission = page.getByText('Some drawings were too fine to cut and were left out.', { exact: false });
  const add = async (left: number, right: number) => {
    await page.keyboard.down('Shift');
    await f.drag(left, 73, right, 165);
    await page.keyboard.up('Shift');
  };
  await f.drag(18, 100, 71, 152);
  await f.ready();
  await add(105, 234);
  await expect(omission).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.drag(44, 125, 44, 210);
  await expect.poll(f.read).not.toEqual(f.p);
  const artwork = (await f.read()).layers[0].keys[0].shapes;
  expect(artwork.find(shape => shape.id === thin.id)).toEqual(thin);
  expect(artwork.find(shape => shape.id === addition.id)).toEqual({ ...addition, y: 205 });
  const blue = artwork.filter(shape => shape.stroke === '#0000ff' && shape.fillEnabled === false);
  expect(blue.some(stroke => hit(stroke, {x:44,y:210}, 0))).toBe(true);
  expect(blue.some(stroke => hit(stroke, {x:44,y:125}, 0))).toBe(false);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  // The next addition should remember the exclusion from the replacement.
  await f.drag(18, 70, 130, 165);
  await expect(omission).toBeVisible();
  await add(184, 234);
  await expect(f.bounds(197, 44)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.drag(44, 125, 44, 210);
  await expect.poll(f.read).not.toEqual(f.p);
  expect((await f.read()).layers[0].keys[0].shapes.find(shape => shape.id === addition.id)).toEqual({ ...addition, y: 205 });
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await f.drag(18, 70, 130, 165);
  await expect(omission).toBeVisible();
  await page.getByLabel('Stage color', { exact: true }).evaluate((input: HTMLInputElement) => {
    input.value = '#ffdead';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const recolored = { ...f.p, background: '#ffdead' };
  await expect.poll(f.read).toEqual(recolored);
  await add(184, 234);
  await expect(page.getByRole('alert')).toContainText('contour collapses');
  expect(await f.read()).toEqual(recolored);
});
for (const mode of ['subtract', 'intersect'] as const) {
  test(`a paint selection can ${mode} after a known precision exclusion`, async ({ page }) => {
    const f = await setup(page, 'mixed-precision-add');
    const [thin, pencil, addition] = f.p.layers[0].keys[0].shapes;
    await f.drag(18, 70, 234, 145);
    await expect(page.getByText('Some drawings were too fine to cut and were left out.', { exact: false })).toBeVisible();
    if (mode === 'intersect') await page.keyboard.down('Shift');
    await page.keyboard.down('Alt');
    if (mode === 'intersect') await f.drag(18, 70, 130, 165);
    else await f.drag(182, 100, 234, 165);
    await page.keyboard.up('Alt');
    if (mode === 'intersect') await page.keyboard.up('Shift');
    await expect(f.bounds(68, 28)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await f.read()).toEqual(f.p);
    await f.drag(44, 125, 44, 210);
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([
      thin, addition, { ...pencil, y: 210 },
    ]);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
}
test('combined symbol lassos keep excluded paint exact and cut only the remaining editable Pencil', async ({ page }) => {
  const f = await setup(page, 'mixed-precision-symbol-lasso', false, 'symbol');
  const workspace = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const openSymbol = async () => {
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    const point = await f.point(211, 132);
    await page.mouse.dblclick(point.x, point.y);
    await expect(workspace).toBeVisible();
  };
  await openSymbol();
  const source = await f.read();
  const [unresolved, pencil, brush] = source.symbols![0].shapes;
  const pixel = (x: number, y: number) => f.canvas.evaluate((node, { x, y }) => {
    const c = node as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(c.width / 2 + (x - 200) * devicePixelRatio,
      c.height / 2 + (y - 150) * devicePixelRatio, 1, 1).data];
  }, { x, y });
  const blue = [0, 0, 255, 255], green = [0, 170, 0, 255], white = [255, 255, 255, 255];
  await expect.poll(() => pixel(56, 125)).toEqual(blue);
  await expect.poll(() => pixel(211, 132)).toEqual(green);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
  await page.getByLabel('Partial paint region', { exact: true }).check();
  const outline = async (mode: string, left: number, top: number, right: number, bottom: number) => {
    await page.getByLabel('Lasso selection mode', { exact: true }).selectOption(mode);
    for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]]) {
      const p = await f.point(x, y);
      await page.mouse.click(p.x, p.y);
    }
    await f.canvas.press('Enter');
  };
  const omission = page.getByText('Some drawings were too fine to cut and were left out.', { exact: false });
  await outline('replace', 18, 100, 72, 151);
  await f.ready();
  const bounds = page.getByText(/^Bounds \d+ × \d+\./);
  const pencilBounds = await bounds.innerText();
  await outline('add', 105, 73, 234, 165);
  await expect(omission).toBeVisible();
  await expect(f.bounds(178, 30)).toBeVisible();
  await outline('subtract', 182, 100, 234, 165);
  await expect(bounds).toHaveText(pencilBounds);
  await expect(omission).toBeVisible();
  await outline('intersect', 48, 111, 64, 139);
  await f.ready();
  await expect(f.bounds(16, 6)).toBeVisible();
  expect(await f.read()).toEqual(source);
  await f.canvas.press('Delete');
  await expect.poll(() => pixel(56, 125)).toEqual(white);
  await expect.poll(() => pixel(73, 125)).toEqual(blue);
  await expect.poll(() => pixel(211, 132)).toEqual(green);
  await f.canvas.press('Control+z');
  await expect.poll(() => pixel(56, 125)).toEqual(blue);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(() => pixel(56, 125)).toEqual(white);
  expect(await f.read()).toEqual(source);
  await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  const saved = await f.read();
  const shapes = saved.symbols![0].shapes;
  expect(shapes.find(s => s.id === unresolved.id)).toEqual(unresolved);
  expect(shapes.find(s => s.id === brush.id)).toEqual(brush);
  const ink = shapes.filter(shape => shape.stroke === pencil.stroke && shape.fillEnabled === false);
  expect(ink).toHaveLength(2);
  expect(ink.every(shape => shape.kind === 'path' && shape.strokeWidth === pencil.strokeWidth && !shape.contours)).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(source);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  expect(await f.read()).toEqual(saved);
  await openSymbol();
  await expect.poll(() => pixel(56, 125)).toEqual(white);
  await expect.poll(() => pixel(211, 132)).toEqual(green);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a crossing precision failure leaves that drawing intact while the selected Pencil can move or be deleted', async ({ page }) => {
  const f = await setup(page, 'mixed-precision');
  const select = async () => {
    await f.drag(20, 70, 130, 165);
    await expect(page.getByText('Some drawings were too fine to cut and were left out.', { exact: false })).toBeVisible();
    expect(await f.read()).toEqual(f.p);
  };
  const [thin, pencil] = f.p.layers[0].keys[0].shapes;
  await select();
  const pickup = await f.point(44, 125), destination = await f.point(44, 210);
  await page.mouse.move(pickup.x, pickup.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 3 });
  const pixel = (x: number, y: number) => f.canvas.evaluate((node: HTMLCanvasElement, { x, y, w, h }) =>
    Array.from(node.getContext('2d')!.getImageData(
      Math.floor((node.width - w * devicePixelRatio) / 2 + x * devicePixelRatio),
      Math.floor((node.height - h * devicePixelRatio) / 2 + y * devicePixelRatio), 1, 1).data),
  { x, y, w: f.p.width, h: f.p.height });
  await expect.poll(() => pixel(44, 210)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(120, 120)).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([thin, { ...pencil, y: 210 }]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await select();
  await f.canvas.press('Delete');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([thin]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('an oversized Selection marquee fits handles to actual artwork and resize retains the fitted cage', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(20, 20, 260, 220);
  await f.ready();
  await expect(f.bounds(100, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  const corner = await f.point(180, 150);
  await page.mouse.move(corner.x, corner.y);
  await expect(f.canvas).toHaveCSS('cursor', /resize/);
  const emptyCorner = await f.point(260, 220);
  await page.mouse.move(emptyCorner.x, emptyCorner.y);
  await expect(f.canvas).not.toHaveCSS('cursor', /resize/);
  await page.screenshot({ path: test.info().outputPath('fitted-selection.png') });
  await f.drag(180, 150, 240, 180);
  await expect.poll(f.read).not.toEqual(f.p);
  await expect(f.bounds(160, 90)).toBeVisible();
  const q = await f.read();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
});
test('a large polygon Lasso also removes empty margins from its transform box', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  for (const [x, y] of [
    [20, 20],
    [260, 20],
    [260, 220],
    [20, 220],
  ]) {
    const q = await f.point(x, y);
    await page.mouse.click(q.x, q.y);
  }
  await f.canvas.focus();
  await page.keyboard.press('Enter');
  await f.ready();
  await expect(f.bounds(100, 60)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
test('a partial selection fits the intersection with the artwork, not the unpainted part of its marquee', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(120, 50, 230, 130);
  await f.ready();
  await expect(f.bounds(60, 40)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
for (const [kind, w, h] of [
  ['pencil', 108, 8],
  ['brush', 112, 12],
] as const)
  test(`${kind} selection fits painted stroke width and caps`, async ({ page }) => {
    const f = await setup(page, kind);
    await f.drag(20, 20, 260, 220);
    await f.ready();
    await expect(f.bounds(w, h)).toBeVisible();
    expect(await f.read()).toEqual(f.p);
  });
test('a marquee containing no paint clears the previous transform box without document edits', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(20, 20, 260, 220);
  await f.ready();
  await expect(f.bounds(100, 60)).toBeVisible();
  await f.drag(250, 40, 310, 80);
  await expect(page.getByText('Paint region is empty.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
});
for (const cancel of ['tool', 'Escape'])
  test(`${cancel} cancels pending selection geometry and a fresh selection can recover`, async ({
    page,
  }) => {
    const f = await setup(page, 'rectangle', true);
    await f.drag(20, 20, 260, 220);
    await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else
      await page
        .getByRole('button', { name: 'Brush', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
    await releaseGeometry(page);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toHaveCount(0);
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await f.drag(20, 20, 260, 220);
    await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
    await releaseGeometry(page);
    await f.ready();
    await expect(f.bounds(100, 60)).toBeVisible();
    expect(await f.read()).toEqual(f.p);
  });

test('a mixed marquee includes a brush with closely spaced samples and remains movable', async ({page}) => {
  const f = await setup(page, 'mixed');
  await f.drag(65, 65, 235, 180);
  await f.ready();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.drag(90, 150, 145, 200);
  await expect.poll(f.read).not.toEqual(f.p);
  const moved = (await f.read()).layers[0].keys[0].shapes.map(shape => vectorPolygons(shape));
  expect(moved.some(paint => contains(paint, {x: 145, y: 200}))).toBe(true);
  expect(moved.some(paint => contains(paint, {x: 90, y: 150}))).toBe(false);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const scope of ['scene','symbol'] as const) {
  test(`Eraser keeps unresolved paint and still cuts Brush and editable Pencil in ${scope}`,async({page})=>{
    const f=await setup(page,'mixed-precision-eraser',false,scope);
    const workspace=page.getByRole('main',{name:'Symbol editing workspace',exact:true});
    const openSymbol=async()=>{
      if(scope!=='symbol') return;
      await page.getByRole('button',{name:'Selection',exact:true}).click();
      const marker=await f.point(315,85);
      await page.mouse.dblclick(marker.x,marker.y);
      await expect(workspace).toBeVisible();
    };
    await openSymbol();
    const source=await f.read();
    const shapes=(p:Project)=>scope==='scene'?p.layers[0].keys[0].shapes:p.symbols![0].shapes;
    const [thin,, ,remote]=shapes(source);
    const pixel=(x:number,y:number)=>f.canvas.evaluate((el,{x,y})=>{
      const c=el as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(Math.floor((c.width-400)/2+x),Math.floor((c.height-300)/2+y),1,1).data];
    },{x,y});
    await f.drag(20,70,130,160);
    await expect(page.getByText('Some drawings were too fine to cut and were left out.',{exact:false})).toBeVisible();
    await f.drag(60,125,60,210);
    await expect.poll(()=>pixel(60,210)).toEqual([0,0,255,255]);
    await expect.poll(()=>pixel(120,120)).toEqual([255,0,0,255]);
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert','');
    if(scope==='scene') await expect.poll(f.read).not.toEqual(source);
    await f.canvas.press('Control+z');
    await expect.poll(()=>pixel(60,125)).toEqual([0,0,255,255]);
    expect(await f.read()).toEqual(source);

    await page.getByRole('button',{name:'Eraser',exact:true}).click();
    await page.getByLabel('Eraser mode',{exact:true}).selectOption('all');
    await page.getByLabel('Eraser diameter',{exact:true}).fill('20');
    await f.drag(115,95,115,275);
    await expect(page.getByText('Kept 1 drawing where the Eraser could not resolve the boundary.',{exact:true})).toBeVisible();
    await expect.poll(()=>pixel(119,113)).toEqual([255,0,0,255]);
    await expect.poll(()=>pixel(115,125)).toEqual([255,0,0,255]);
    await expect.poll(()=>pixel(115,255)).toEqual([255,255,255,255]);
    await expect.poll(()=>pixel(73,125)).toEqual([0,0,255,255]);
    await expect.poll(()=>pixel(73,255)).toEqual([0,136,0,255]);
    if(scope==='symbol'){
      expect(await f.read()).toEqual(source);
      await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
      await expect(workspace).toHaveCount(0);
    }
    const after=await f.read(), artwork=shapes(after);
    expect(artwork.find(s=>s.id===thin.id)).toEqual(thin);
    expect(artwork.find(s=>s.id===remote.id)).toEqual(remote);
    const ink=artwork.filter(s=>s.stroke==='#0000ff'&&s.strokeWidth===8);
    expect(ink).toHaveLength(2);
    expect(ink.every(s=>s.kind==='path'&&s.fillEnabled===false)).toBe(true);
    expect(artwork.filter(s=>s.fill==='#008800'&&s.kind==='polygon')).toHaveLength(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(source);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(after);
    await page.reload();
    await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    expect(await f.read()).toEqual(after);
    await openSymbol();
    await expect.poll(()=>pixel(60,125)).toEqual([0,0,255,255]);
    await expect.poll(()=>pixel(60,255)).toEqual([0,136,0,255]);
    await page.getByRole('button',{name:'Eraser',exact:true}).click();
    await page.getByLabel('Eraser mode',{exact:true}).selectOption('all');
    await page.getByLabel('Eraser diameter',{exact:true}).fill('24');
    await f.drag(60,110,60,275);
    await expect.poll(()=>pixel(60,125)).toEqual([255,255,255,255]);
    await expect.poll(()=>pixel(60,255)).toEqual([255,255,255,255]);
    await expect(page.getByText('Erased the resolved paint. Kept nearby boundaries that were too fine to merge.',{exact:true})).toBeVisible();
    if(scope==='symbol') {
      expect(await f.read()).toEqual(after);
      await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
      await expect(workspace).toHaveCount(0);
    }
    const retried=await f.read(), modified=shapes(retried);
    expect(modified.find(s=>s.id===thin.id)).toEqual(thin);
    expect(modified.find(s=>s.id===remote.id)).toEqual(remote);
    expect(modified.filter(s=>s.stroke==='#0000ff'&&s.strokeWidth===8)).toHaveLength(3);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(after);
    await expect.poll(()=>pixel(60,125)).toEqual([0,0,255,255]);
    await expect.poll(()=>pixel(60,255)).toEqual([0,136,0,255]);
  });
}
