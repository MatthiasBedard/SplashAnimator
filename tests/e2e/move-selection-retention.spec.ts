import { test, expect, type Page } from '@playwright/test';
import { newProject, validateProject, type Project, type Point, type Vector } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { worldPaths } from '../../packages/geometry/src/drawing';

const rect = (id = 'art', x = 40, y = 60, fill = '#ff0000'): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y,
  width: 100,
  height: 80,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
async function setup(
  page: Page,
  mode: 'object' | 'merge',
  kind = 'fill',
  multiple = false,
  held = false,
) {
  const p = newProject();
  p.width = 400;
  p.height = 260;
  p.layers[0].drawingMode = mode;
  const art = rect();
  if (kind === 'line' || kind.startsWith('crossing-lines') || kind === 'curve' || kind === 'curve-over-fill') {
    art.kind = kind === 'curve' || kind === 'curve-over-fill' ? 'bezier' : 'path';
    art.y = 80;
    art.fillEnabled = false;
    art.stroke = '#ff0000';
    art.strokeWidth = 6;
    art.points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    if (kind === 'curve' || kind === 'curve-over-fill') {
      art.points = [];
      art.nodes = [
        { x: 0, y: 0, out: { x: 30, y: 10 } },
        { x: 100, y: 0, in: { x: 70, y: -10 } },
      ];
      art.drawingMode = 'merge';
    }
  }
  if (kind === 'symbol') {
    p.symbols = [
      { id: 'symbol', name: 'Art', width: 100, height: 80, shapes: [{ ...rect(), x: 0, y: 0 }] },
    ];
    art.kind = 'symbol';
    art.symbolId = 'symbol';
  }
  p.layers[0].keys[0].shapes = [art];
  if (kind.startsWith('crossing-lines'))
    p.layers[0].keys[0].shapes.push({ ...art, id:'vertical', x:260, y:60, width:0, height:100,
      points:[{x:0,y:0},{x:0,y:100}] });
  if (kind === 'crossing-lines-with-paint')
    p.layers[0].keys[0].shapes.push(rect('remote-paint',45,175,'#0000ff'));
  if (kind === 'curve-over-fill') p.layers[0].keys[0].shapes.push(rect('back',180,60,'#0000ff'));
  if (multiple) p.layers[0].keys[0].shapes.push(rect('second', 220));
  if (kind === 'overlap' || kind === 'bound-overlap')
    p.layers[0].keys[0].shapes.push({ ...rect('above', 130, 60, '#0000ff'), width: 100 });
  if (kind === 'bound-overlap')
    p.opacityBindings = [{ layerId:p.layers[0].id, shapeId:art.id, start:0, end:1,
      keys:[{frame:0,opacity:1},{frame:1,opacity:0.5}] }];
  validateProject(p);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
  const screen = async (q: Point) => {
    const b = (await canvas.boundingBox())!;
    return { x: b.x + b.width / 2 + q.x - 200, y: b.y + b.height / 2 + q.y - 130 };
  };
  const drag = async (a: Point, b: Point) => {
    const x = await screen(a),
      y = await screen(b);
    await page.mouse.move(x.x, x.y);
    await page.mouse.down();
    await page.mouse.move(y.x, y.y, { steps: 5 });
    await page.mouse.up();
    if (!held) await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  };
  const pixel = (q: Point) =>
    canvas.evaluate((c, q) => {
      const n = c as HTMLCanvasElement;
      return Array.from(
        n
          .getContext('2d')!
          .getImageData(
            Math.round(n.width / 2 + (q.x - 200) * devicePixelRatio),
            Math.round(n.height / 2 + (q.y - 130) * devicePixelRatio),
            1,
            1,
          ).data,
      );
    }, q);
  return {
    p,
    canvas,
    read,
    screen,
    drag,
    pixel,
    settle: () => expect(page.locator('main.editor')).not.toHaveAttribute('inert', ''),
  };
}

for (const [mode, kind] of [
  ['merge', 'fill'],
  ['merge', 'line'],
  ['merge', 'curve'],
  ['object', 'fill'],
  ['object', 'symbol'],
] as const)
  test(`${mode} ${kind} retains selection for consecutive moves and keyboard nudges`, async ({
    page,
  }) => {
    const f = await setup(page, mode, kind),
      at = { x: 65, y: kind === 'line' || kind === 'curve' ? 80 : 85 };
    await f.drag(at, { x: at.x + 30, y: at.y + 20 });
    const x = page.getByLabel('Shape X', { exact: true });
    await expect(x).toHaveCount(1);
    await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(70, 4);
    const first = await f.read();
    await f.canvas.focus();
    await page.keyboard.press('ArrowRight');
    await f.settle();
    await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(71, 4);
    await f.drag({ x: at.x + 31, y: at.y + 20 }, { x: at.x + 51, y: at.y + 30 });
    await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(91, 4);
    const moved = await f.read();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => JSON.stringify(await f.read())).not.toBe(JSON.stringify(moved));
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(first);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('dragging a Pencil curve onto a fill and off again leaves the original fill intact', async ({page}) => {
  const f = await setup(page,'merge','curve-over-fill');
  await f.drag({x:90,y:80},{x:230,y:80});
  await expect.poll(async()=>(await f.read()).layers[0].keys[0].shapes.at(-1)?.x).toBe(180);
  const over = await f.read();
  expect(over.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[1]);
  await f.drag({x:204,y:83},{x:204,y:183});
  await expect.poll(()=>f.pixel({x:230,y:80})).toEqual([0,0,255,255]);
  const away = await f.read();
  expect(away.layers[0].keys[0].shapes).toEqual([
    f.p.layers[0].keys[0].shapes[1], {...f.p.layers[0].keys[0].shapes[0],x:180,y:180}
  ]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(over);
});

for (const deselect of ['Escape', 'click'] as const)
test(`deselecting a moved Pencil line with ${deselect} merges the crossing with one undo step`, async ({page}) => {
  await holdGeometry(page);
  const f = await setup(page, 'merge', 'crossing-lines', false, true);
  const readStrokes = async () => (await f.read()).layers[0].keys[0].shapes;
  await f.drag({x:90,y:80}, {x:260,y:125});
  const placed = await f.read();
  expect(placed.layers[0].keys[0].shapes).toEqual([
    f.p.layers[0].keys[0].shapes[1], {...f.p.layers[0].keys[0].shapes[0],x:210,y:125},
  ]);
  expect(await pendingGeometry(page)).toBe(0);
  if (deselect === 'Escape') await f.canvas.press('Escape');
  else {
    const blank = await f.screen({x:170,y:180});
    await page.mouse.click(blank.x,blank.y);
  }
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(async () => (await readStrokes()).length).toBe(4);
  const junction = {x:260,y:125};
  const strokes = await readStrokes();
  expect(strokes.every(shape => shape.kind === 'path' && shape.fillEnabled === false && shape.strokeWidth === 6)).toBe(true);
  for (const shape of strokes) {
    const [points] = worldPaths(shape);
    expect([points[0], points.at(-1)]).toContainEqual(junction);
  }
  const merged = await f.read();
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(merged);
});

test('Pencil lines merge on deselection across distant paint in their stack', async ({page}) => {
  const f = await setup(page,'merge','crossing-lines-with-paint');
  const original = f.p.layers[0].keys[0].shapes;
  const readArtwork = async () => (await f.read()).layers[0].keys[0].shapes;
  await f.drag({x:90,y:80},{x:260,y:125});
  const placed = await readArtwork();
  expect(placed.map(shape=>shape.id)).toEqual(['vertical','remote-paint','art']);
  const blank = await f.screen({x:175,y:178});
  await page.mouse.click(blank.x,blank.y);
  await expect.poll(async()=>(await readArtwork()).length).toBe(5);
  const artwork = await readArtwork();
  expect(artwork.at(-1)).toEqual(original[2]);
  for (const stroke of artwork.slice(0,-1)) {
    const [points] = worldPaths(stroke);
    expect([points[0],points.at(-1)]).toContainEqual({x:260,y:125});
  }
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a malformed stroke merge reply keeps both placed lines editable', async ({page}) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          const merge = event.data?.result?.strokeMerges?.[0];
          if (merge) merge.sources[1] = merge.sources[0];
        });
      }
    };
  });
  const f = await setup(page, 'merge', 'crossing-lines');
  await f.drag({x:90,y:80}, {x:260,y:125});
  const placed = await f.read();
  await f.canvas.press('Escape');
  await expect(page.getByRole('alert')).toContainText('invalid paint drop');
  expect(await f.read()).toEqual(placed);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('multiple selected objects remain selected and move together after release', async ({
  page,
}) => {
  const f = await setup(page, 'object', 'fill', true);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.drag({ x: 65, y: 85 }, { x: 95, y: 105 });
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.settle();
  await expect
    .poll(async () => (await f.read()).layers[0].keys[0].shapes.map((s) => s.x))
    .toEqual([71, 251]);
});

test('multiple rebuilt paint pieces stay selected and move together', async ({ page }) => {
  const f = await setup(page, 'merge', 'fill', true);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.drag({ x: 65, y: 85 }, { x: 95, y: 105 });
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.settle();
  await expect.poll(() => f.pixel({ x: 74, y: 100 })).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel({ x: 254, y: 100 })).toEqual([255, 0, 0, 255]);
  const before = await f.read();
  await page.keyboard.press('ArrowRight');
  await f.settle();
  await expect.poll(f.read).not.toEqual(before);
  expect((await f.read()).layers[0].keys[0].shapes.every((s) => s.x >= 72)).toBe(true);
});

test('selection ownership does not transfer to overlapping unselected foreground paint', async ({
  page,
}) => {
  const f = await setup(page, 'merge', 'overlap');
  await f.drag({ x: 65, y: 85 }, { x: 105, y: 85 });
  // The moved red selection ends at x=180. Sample inside the stationary blue
  // artwork, clear of the antialiased selection outline.
  await expect.poll(() => f.pixel({ x: 185, y: 80 })).toEqual([0, 0, 255, 255]);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveCount(1);
  await f.drag({ x: 105, y: 85 }, { x: 135, y: 125 });
  await expect.poll(() => f.pixel({ x: 185, y: 80 })).toEqual([0, 0, 255, 255]);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveCount(1);
});

test('partial paint selection survives successive moves and nudge, and clears on clicking off', async ({
  page,
}) => {
  const f = await setup(page, 'merge');
  await f.drag({ x: 25, y: 45 }, { x: 90, y: 150 });
  await expect(
    page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
  ).toBeVisible();
  await f.drag({ x: 65, y: 90 }, { x: 215, y: 120 });
  await expect.poll(() => f.pixel({ x: 200, y: 130 })).toEqual([255, 0, 0, 255]);
  await f.drag({ x: 215, y: 120 }, { x: 235, y: 135 });
  await expect.poll(() => f.pixel({ x: 214, y: 140 })).toEqual([255, 0, 0, 255]);
  await f.canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await f.settle();
  await expect.poll(() => f.pixel({ x: 214, y: 140 })).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel({ x: 224, y: 140 })).toEqual([255, 0, 0, 255]);
  const before = await f.read();
  const blank = await f.screen({ x: 380, y: 230 });
  await page.mouse.click(blank.x, blank.y);
  await page.keyboard.press('ArrowRight');
  await f.settle();
  expect(await f.read()).toEqual(before);
});

test('a move with an opacity binding keeps the destination intact until deselected', async ({page}) => {
  await holdGeometry(page);
  const f = await setup(page, 'merge', 'bound-overlap', false, true);
  const blue = f.p.layers[0].keys[0].shapes[1];
  await f.drag({x:65,y:85}, {x:105,y:85});
  const placed = await f.read();
  expect(placed.layers[0].keys[0].shapes).toEqual([
    blue, {...f.p.layers[0].keys[0].shapes[0],x:80},
  ]);
  expect(await pendingGeometry(page)).toBe(0);
  await f.canvas.press('Escape');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(f.read).not.toEqual(placed);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('a failed deselection merge keeps the drop and allows the artwork to be moved again', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, 'merge', 'fill', false, true);
  await f.drag({ x: 65, y: 85 }, { x: 95, y: 105 });
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('70');
  const placed = await f.read();
  expect(await pendingGeometry(page)).toBe(0);
  await f.canvas.press('Escape');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(placed);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await f.drag({ x: 95, y: 105 }, { x: 125, y: 125 });
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('100');
  await f.canvas.press('Escape');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await f.settle();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('malformed rebuilt selection cannot publish artwork and leaves the original selection usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    let invalid = true;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const m = message as { id: number; shapes: unknown[]; editedPieces?: string[] };
        if (invalid && m.editedPieces) {
          invalid = false;
          document.documentElement.dataset.badMoveSelection = 'yes';
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent('message', {
                data: { id: m.id, result: { artwork: m.shapes, clearMargin: false, preservedDestination: false } },
              }),
            ),
          );
          return;
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  const f = await setup(page, 'merge');
  await f.drag({ x: 65, y: 85 }, { x: 95, y: 105 });
  const placed = await f.read();
  await f.canvas.press('Escape');
  await expect(page.getByRole('alert')).toContainText('invalid paint drop');
  expect(await page.evaluate(() => document.documentElement.dataset.badMoveSelection)).toBe('yes');
  expect(await f.read()).toEqual(placed);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await f.drag({ x: 95, y: 105 }, { x: 125, y: 125 });
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('100');
});
