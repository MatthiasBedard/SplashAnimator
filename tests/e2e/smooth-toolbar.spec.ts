import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { contains, vectorPolygons, mergeVectors } from '../../packages/geometry/src/merge';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { compoundBrushPaint } from '../compound-simplify-fixture';

async function setup(page: Page, kind = 'path', mode: 'merge' | 'object' = 'object', held = false, symbol = false) {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = mode;
  const s: Vector = {
    id: 'art',
    kind: 'path',
    x: 80,
    y: 80,
    width: 180,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: 8,
    fillEnabled: false,
    points: Array.from({ length: 121 }, (_, i) => ({
      x: i * 1.5,
      y: 50 + Math.sin(i / 18) * 20 + (i % 2 ? 2 : -2),
    })),
  };
  if (kind === 'progressive') s.points = Array.from({ length: 301 }, (_, i) => ({
    x: i * .6,
    y: 50 + 25 * Math.sin(i / 25) + 1.5 * Math.sin(i / 2),
  }));
  if (kind === 'brush')
    Object.assign(s, {
      kind,
      fillEnabled: true,
      brush: { pressure: false, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
    });
  if (kind === 'polygon')
    Object.assign(s, {
      kind,
      fillEnabled: true,
      strokeWidth: 0,
      points: [],
      fillRule: 'evenodd',
      contours: [
        Array.from({ length: 120 }, (_, i) => {
          const a = (i / 120) * Math.PI * 2,
            r = 50 + Math.sin(i * 1.7) * 0.15;
          return { x: 60 + Math.cos(a) * r, y: 60 + Math.sin(a) * r };
        }),
      ],
    });
  if (kind === 'partly-curved-paint') Object.assign(s, compoundBrushPaint());
  if (kind === 'dense-paint')
    Object.assign(s, {
      kind: 'polygon',
      drawingMode: 'merge',
      closed: true,
      fillEnabled: true,
      strokeWidth: 0,
      points: [],
      fillRule: 'evenodd',
      contours: [9000, 2500].map((length, ring) =>
        Array.from({ length }, (_, i) => {
          const angle = (i / length) * Math.PI * 2;
          const radius = ring ? 45 : 63;
          return { x: 65 + radius * Math.cos(angle), y: 65 + radius * Math.sin(angle) };
        }),
      ),
    });
  if (kind === 'touching-paint')
    Object.assign(s, {
      kind: 'polygon',
      drawingMode: 'merge',
      closed: true,
      fillEnabled: true,
      strokeWidth: 0,
      points: [],
      fillRule: 'evenodd',
      height: 120,
      contours: [
        [{x:0,y:0},{x:180,y:0},...Array.from({length:10},(_,i)=>({x:180,y:10 + 10*i})),{x:180,y:120},{x:0,y:120}],
        [{x:0,y:60},{x:22,y:36},{x:42,y:60},{x:22,y:84}],
      ],
    });
  if (kind === 'rectangle')
    Object.assign(s, {
      kind,
      fillEnabled: true,
      strokeWidth: 0,
      points: [],
      width: 100,
      height: 100,
    });
  const other: Vector = {
    ...s,
    id: 'other',
    kind: 'rectangle',
    x: 310,
    y: 180,
    width: 40,
    height: 40,
    fillEnabled: true,
    fill: '#0000ff',
    strokeWidth: 0,
    points: [],
    contours: undefined,
    brush: undefined,
  };
  if (kind === 'paint' || kind === 'join') {
    Object.assign(s, {
      kind: 'brush',
      fillEnabled: true,
      strokeWidth: 16,
      brush: { pressure: false, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
    });
    s.points = Array.from({ length: 61 }, (_, i) => ({ x: i * 3, y: 40 + 12 * Math.sin(i / 12) }));
    if (kind === 'join') {
      s.strokeWidth = 10;
      s.points = Array.from({ length: 61 }, (_, i) => ({
        x: i * 3,
        y: 50 + 20 * Math.sin(i / 10),
      }));
    }
  }
  p.layers[0].keys[0].shapes = [
    kind === 'paint' || kind === 'join' ? mergeVectors([s])[0] : s,
    other,
  ];
  if (symbol) {
    const layer = p.layers[0];
    const definition = { id: 'dense-paint', name: 'Dense Paint', width: p.width, height: p.height, shapes: layer.keys[0].shapes };
    p.symbols = [definition];
    layer.drawingMode = 'object';
    layer.keys[0].shapes = [symbolInstance(definition, 0, 0)];
  }
  if (held) await holdGeometry(page);
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
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const smooth = page.getByRole('button', { name: 'Simplify selected artwork', exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const settle = () => expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  async function select() {
    const b = (await canvas.boundingBox())!;
    const x = kind === 'dense-paint' || kind === 'touching-paint' ? 199 : kind === 'polygon' || kind === 'rectangle' ? 140 : 81;
    const y =
      kind === 'dense-paint' || kind === 'touching-paint' ? 145 : kind === 'polygon' || kind === 'rectangle'
        ? 140
        : kind === 'paint'
          ? 120
          : kind === 'join'
            ? 130
            : 128;
    await page.mouse.click(b.x + b.width / 2 - 200 + x, b.y + b.height / 2 - 150 + y);
    await expect(smooth).toBeEnabled();
  }
  async function colors() {
    return canvas.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let red = 0,
        blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 80) red++;
        if (data[i + 2] > 180 && data[i] < 80 && data[i + 1] < 80) blue++;
      }
      return { red, blue };
    });
  }
  return { p, read, canvas, smooth, select, settle, colors };
}

test('repeated whole-stroke Simplify keeps reducing safe spans beside a touching hole', async ({page}) => {
  const f = await setup(page, 'touching-paint', 'merge');
  await f.select();
  const states = [await f.read()];
  const art = (p: Project) => p.layers[0].keys[0].shapes[0];
  const outerCount = (p: Project) => art(p).contours![0].length;
  const blue = (await f.colors()).blue;
  while (outerCount(states.at(-1)!) > 4) {
    const prior = outerCount(states.at(-1)!);
    await f.smooth.click();
    await expect.poll(async ()=>outerCount(await f.read())).toBeLessThan(prior);
    const result = await f.read();
    expect(art(result).contours![1]).toEqual(art(states[0]).contours![1]);
    expect(art(result).contours![0].some(n=>n.out)).toBe(true);
    states.push(result);
  }
  expect(states.length).toBeGreaterThan(3);
  const last = states.at(-1)!;
  expect(outerCount(last)).toBe(4);
  expect((await f.colors()).blue).toBe(blue);
  await f.smooth.click();
  await expect(page.getByText('No more vertices can be safely removed from this selection', {exact:true})).toBeVisible();
  expect(await f.read()).toEqual(last);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(states.at(-2));
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(last);
});

test('Simplify turns a dense merged Brush loop into curves and keeps its hole through Undo and Redo', async ({ page }) => {
  const f = await setup(page, 'dense-paint', 'merge');
  await f.select();
  const initial = (await f.read()).layers[0].keys[0].shapes[0];
  const count = (s: Vector) => s.contours!.reduce((total, ring) => total + ring.length, 0);
  expect(count(initial)).toBe(11500);
  const pixels = await f.colors();
  await f.smooth.click();
  await expect.poll(async () => count((await f.read()).layers[0].keys[0].shapes[0])).toBeLessThan(100);
  const result = await f.read();
  const [curve, other] = result.layers[0].keys[0].shapes;
  expect(curve.contours).toHaveLength(2);
  expect(curve.contours!.every(ring => ring.some(n => n.in && n.out))).toBe(true);
  const paint = vectorPolygons(curve);
  expect(contains(paint, { x: 145, y: 145 })).toBe(false);
  expect(contains(paint, { x: 199, y: 145 })).toBe(true);
  expect(other).toEqual(f.p.layers[0].keys[0].shapes[1]);
  await expect.poll(async () => (await f.colors()).red).toBeGreaterThan(4000);
  expect((await f.colors()).blue).toBe(pixels.blue);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(result);
});

for (const mode of ['object', 'merge'] as const)
  for (const kind of ['path', 'brush', 'polygon'])
    test(`${mode} selected ${kind} smooths from the bottom color tools with selection and one Undo/Redo`, async ({
      page,
    }) => {
      const f = await setup(page, kind, mode);
      await expect(f.smooth).toBeDisabled();
      const fill = (await page.getByLabel('Drawing fill', { exact: true }).boundingBox())!;
      expect((await f.smooth.boundingBox())!.y).toBeGreaterThan(fill.y);
      await f.select();
      const pixels = await f.colors();
      await f.smooth.click();
      await f.settle();
      await expect
        .poll(async () => (await f.read()).layers[0].keys[0].shapes[0])
        .not.toEqual(f.p.layers[0].keys[0].shapes[0]);
      const out = await f.read(),
        art = out.layers[0].keys[0].shapes[0];
      expect(out.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
      await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ff0000');
      await expect(f.smooth).toBeEnabled();
      if (kind === 'path') expect(art.nodes!.length).toBeLessThan(30);
      if (kind === 'polygon') expect(art.contours![0].length).toBeLessThan(40);
      const after = await f.colors();
      expect(after.red).toBeGreaterThan(100);
      expect(after.blue).toBe(pixels.blue);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(out);
    });

test('repeated Simplify clicks remove vertices with visible counts and separate Undo/Redo records', async ({ page }) => {
  const f = await setup(page, 'progressive'); await f.select();
  const count = (p: Project) => {
    const s = p.layers[0].keys[0].shapes.find((s) => s.id === 'art')!;
    return s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
  };
  const states = [f.p]; const blue = (await f.colors()).blue;
  for (let i = 0; i < 3; i++) {
    const n = count(states.at(-1)!); await f.smooth.click();
    await expect.poll(async () => count(await f.read())).toBeLessThan(n);
    const out = await f.read(), removed = n - count(out);
    await expect(page.getByText(`Removed ${removed} ${removed === 1 ? 'vertex' : 'vertices'} from selection`, { exact: true })).toBeVisible();
    expect(out.layers[0].keys[0].shapes.find((s) => s.id === 'other')).toEqual(f.p.layers[0].keys[0].shapes[1]);
    await expect(f.smooth).toBeEnabled();
    expect((await f.colors()).blue).toBe(blue); expect((await f.colors()).red).toBeGreaterThan(100);
    states.push(out);
  }
  await f.canvas.focus();
  for (let i = 2; i >= 0; i--) { await page.keyboard.press('Control+z'); await expect.poll(f.read).toEqual(states[i]); }
  for (let i = 1; i < states.length; i++) { await page.keyboard.press('Control+Shift+z'); await expect.poll(f.read).toEqual(states[i]); }
});

test('already-smooth primitives do not create history', async ({ page }) => {
  const f = await setup(page, 'rectangle');
  await f.select();
  await f.smooth.click();
  await f.settle();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByText('No more vertices can be safely removed from this selection', { exact: true })).toBeVisible();
});

for (const kind of ['polygon', 'paint'])
  test(`repeated Simplify removes more anchors from already fitted ${kind}`, async ({ page }) => {
    const f = await setup(page, kind); await f.select();
    const count = (p: Project) => {
      const s = p.layers[0].keys[0].shapes[0];
      return s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
    };
    let current = f.p;
    for (let i = 0; i < 2; i++) {
      const n = count(current); await f.smooth.click();
      await expect.poll(async () => count(await f.read())).toBeLessThan(n);
      const out = await f.read();
      expect(out.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
      await expect(f.smooth).toBeEnabled(); current = out;
    }
    expect((await f.colors()).red).toBeGreaterThan(100);
    await f.canvas.focus(); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('a worker failure keeps drawing and selection intact and a fresh smoothing retry succeeds', async ({
  page,
}) => {
  const f = await setup(page, 'polygon', 'merge', true);
  await f.select();
  await f.smooth.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page, true);
  await f.settle();
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(f.p);
  await expect(f.smooth).toBeEnabled();
  await f.smooth.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await f.settle();
  await expect.poll(f.read).not.toEqual(f.p);
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ff0000');
});

test('keyboard multi-selection retains all selected objects after a single smoothing transaction', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.smooth.click();
  await f.settle();
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  const out = await f.read();
  expect(out.layers[0].keys[0].shapes).toHaveLength(2);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('actual merged Brush paint becomes editable smooth contours from the toolbar', async ({
  page,
}) => {
  const f = await setup(page, 'paint', 'merge');
  await f.select();
  await f.smooth.click();
  await f.settle();
  const out = await f.read(),
    shape = out.layers[0].keys[0].shapes[0];
  expect(shape.contours!.flat().some((n) => n.in || n.out)).toBe(true);
  expect(out.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ff0000');
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('partial Simplify keeps the unselected curves and hole in dense Brush paint', async ({ page }) => {
  const f = await setup(page, 'partly-curved-paint', 'merge');
  const [source, neighbor] = f.p.layers[0].keys[0].shapes;
  const anchor = source.contours![0].at(-1)!;
  const pixels = () => f.canvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    return [[120, 140], [84, 140], [190, 140], [205, 140], [330, 200]].map(([x, y]) =>
      Array.from(context.getImageData(canvas.width / 2 + (x - 200) * devicePixelRatio,
        canvas.height / 2 + (y - 150) * devicePixelRatio, 1, 1).data));
  });
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255], blue = [0, 0, 255, 255];
  await expect.poll(pixels).toEqual([white, red, red, white, blue]);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
  await page.getByLabel('Partial paint region', { exact: true }).check();
  const b = (await f.canvas.boundingBox())!;
  for (const [x, y] of [[165, 75], [220, 75], [220, 205], [165, 205]])
    await page.mouse.click(b.x + b.width / 2 - 200 + x, b.y + b.height / 2 - 150 + y);
  await page.keyboard.press('Enter');
  await expect(f.smooth).toBeEnabled();
  await f.smooth.click();
  await expect.poll(f.read).not.toEqual(f.p);
  const result = await f.read(), shapes = result.layers[0].keys[0].shapes;
  const boundary = shapes.flatMap(shape => shape.contours?.flat() ?? []);
  expect(source.contours!.flat().length - boundary.length).toBeGreaterThan(300);
  expect(boundary.find(node => node.x === anchor.x && node.y === anchor.y)).toEqual(anchor);
  expect(shapes.find(shape => shape.id === neighbor.id)).toEqual(neighbor);
  await expect(f.smooth).toBeEnabled();
  await f.smooth.click();
  await expect(page.getByText('No more vertices can be safely removed from this selection')).toBeVisible();
  await expect.poll(f.read).toEqual(result);
  await expect(f.smooth).toBeEnabled();
  await f.canvas.press('Escape');
  await expect.poll(pixels).toEqual([white, red, red, white, blue]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(result);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shared symbol partial Simplify keeps the selected paint through local history and Save', async ({ page }) => {
  const f = await setup(page, 'partly-curved-paint', 'merge', false, true);
  const workspace = page.getByRole('main', { name: 'Symbol editing workspace', exact: true });
  const point = async (x: number, y: number) => {
    const b = (await f.canvas.boundingBox())!;
    return { x: b.x + b.width / 2 - 200 + x, y: b.y + b.height / 2 - 150 + y };
  };
  const marker = await point(330, 200);
  await page.mouse.dblclick(marker.x, marker.y);
  await expect(workspace).toBeVisible();
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
  await page.getByLabel('Partial paint region', { exact: true }).check();
  for (const [x, y] of [[165, 75], [220, 75], [220, 205], [165, 205]]) {
    const p = await point(x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await f.smooth.click();
  await expect(page.getByText(/Removed \d+ vertices from selection/)).toBeVisible();
  await f.smooth.click();
  await expect(page.getByText('No more vertices can be safely removed from this selection')).toBeVisible();
  await f.canvas.press('Escape');
  await f.canvas.press('Control+z');
  await f.canvas.press('Control+Shift+z');
  expect(await f.read()).toEqual(f.p);

  await workspace.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  const result = await f.read();
  const [source, neighbor] = f.p.symbols![0].shapes;
  const shapes = result.symbols![0].shapes;
  const boundary = shapes.flatMap(shape => shape.contours?.flat() ?? []);
  expect(source.contours!.flat().length - boundary.length).toBeGreaterThan(300);
  const anchor = source.contours![0].at(-1)!;
  expect(boundary.find(node => node.x === anchor.x && node.y === anchor.y)).toEqual(anchor);
  expect(shapes.find(shape => shape.id === neighbor.id)).toEqual(neighbor);
  const paint = shapes.map(shape => vectorPolygons(shape));
  for (const [x, y, covered] of [[120, 140, false], [84, 140, true], [190, 140, true], [205, 140, false]] as const)
    expect(paint.some(piece => contains(piece, { x, y }))).toBe(covered);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(result);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('partial paint selection smooths only that region and remains one undoable edit', async ({
  page,
}) => {
  const f = await setup(page, 'polygon', 'merge');
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode', { exact: true }).selectOption('polygon');
  await page.getByLabel('Partial paint region', { exact: true }).check();
  const b = (await f.canvas.boundingBox())!;
  for (const [x, y] of [
    [135, 70],
    [210, 70],
    [210, 210],
    [135, 210],
  ])
    await page.mouse.click(b.x + b.width / 2 - 200 + x, b.y + b.height / 2 - 150 + y);
  await page.keyboard.press('Enter');
  await f.settle();
  await expect(f.smooth).toBeEnabled();
  expect(await f.read()).toEqual(f.p);
  await f.smooth.click();
  await f.settle();
  const out = await f.read(),
    shapes = out.layers[0].keys[0].shapes;
  expect(out).not.toEqual(f.p);
  for (let x = 90; x < 134; x += 5)
    for (let y = 90; y < 190; y += 5)
      expect(shapes.some((s) => contains(vectorPolygons(s), { x, y }))).toBe(
        f.p.layers[0].keys[0].shapes.some((s) => contains(vectorPolygons(s), { x, y })),
      );
  expect(shapes.find((s) => s.id === 'other')).toEqual(f.p.layers[0].keys[0].shapes[1]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

for (const mode of ['object', 'merge'] as const)
  test(`Smooth accepts merged paint with the formerly unseparated join in ${mode} mode`, async ({
    page,
  }) => {
    const f = await setup(page, 'join', mode);
    await f.select();
    const before = await f.colors();
    await f.smooth.click();
    await f.settle();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const out = await f.read();
    expect(out).not.toEqual(f.p);
    expect(out.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
    const after = await f.colors();
    expect(after.red).toBeGreaterThan(100);
    expect(after.blue).toBe(before.blue);
    await expect(f.smooth).toBeEnabled();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });

test('mixed selection smooths formerly rejected brush paint and retains the selected primitive',async({page})=>{
 const f=await setup(page,'join');await f.select();await f.canvas.focus();await page.keyboard.press('Control+a');await f.smooth.click();await f.settle();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByText('2 objects',{exact:true})).toBeVisible();const after=await f.read();expect(after).not.toEqual(f.p);expect(after.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
});
