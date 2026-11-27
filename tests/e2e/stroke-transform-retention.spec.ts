import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { matrix, mapPoint, worldPoint } from '../../packages/geometry/src';
import { around } from '../../packages/geometry/src/affine';
import { worldStrokePolygons } from '../../packages/geometry/src/strokes';

test('skew places both Pencil endpoints with the selection and keeps round caps', async ({page}) => {
  const f = await setup(page, 'line', 'object', true);
  await page.getByLabel('Transform skew X', {exact:true}).fill('50');
  await page.getByRole('button', {name:'Apply transform',exact:true}).click();
  const [fill, stroke] = (await f.read()).layers[0].keys[0].shapes;
  const op = around({x:150,y:110},1,0,Math.tan(50*Math.PI/180),1);
  const endpoints = f.stroke.points.map(p=>mapPoint(op,worldPoint(f.stroke,p)));
  expect(fill.transform?.[2]).toBeCloseTo(op[2],6);
  stroke.points.forEach((point,index)=>{
    const actual=worldPoint(stroke,point);
    expect(actual.x).toBeCloseTo(endpoints[index].x,6);
    expect(actual.y).toBeCloseTo(endpoints[index].y,6);
  });
  const outline = worldStrokePolygons(stroke).flat(2);
  expect(Math.min(...outline.map(([x])=>x))).toBeCloseTo(endpoints[0].x-3,4);
  expect(Math.max(...outline.map(([x])=>x))).toBeCloseTo(endpoints[1].x+3,4);
  await f.canvas.press('Escape');
  await expect.poll(()=>stagePixel(f.canvas,Math.round(endpoints[0].x),70)).toEqual([0,0,0,255]);
  await expect.poll(()=>stagePixel(f.canvas,Math.round(endpoints[0].x-4),68)).toEqual([255,255,255,255]);
});
function stagePixel(canvas: ReturnType<Page['getByLabel']>, x:number, y:number) {
  return canvas.evaluate((node:HTMLCanvasElement,{x,y})=>
    Array.from(node.getContext('2d')!.getImageData(
      Math.round(node.width/2+(x-180)*devicePixelRatio),
      Math.round(node.height/2+(y-120)*devicePixelRatio),1,1,
    ).data),{x,y});
}
test('scaling a Pencil line moves both anchors and preserves the stroke weight', async ({page}) => {
  const f=await setup(page,'line','object');
  await page.getByLabel('Transform scale Y',{exact:true}).fill('200');
  await page.getByRole('button',{name:'Apply transform',exact:true}).click();
  await expect.poll(f.read).not.toEqual(f.p);
  const line=(await f.read()).layers[0].keys[0].shapes[0];
  expect(line.points.map(point=>worldPoint(line,point))).toEqual([{x:70,y:40},{x:230,y:160}]);
  const outline=worldStrokePolygons(line).flat(2);
  expect(Math.min(...outline.map(([,y])=>y))).toBe(37);
  expect(Math.max(...outline.map(([,y])=>y))).toBe(163);
});

async function setup(
  page: Page,
  kind: 'line' | 'bezier' = 'bezier',
  mode: 'merge' | 'object' = 'merge',
  mixed = false,
  lasso = false,
  extendedCage = false,
  basis?: Vector['transform'],
) {
  const p = newProject();
  p.width = 360;
  p.height = 240;
  p.duration = 4;
  p.layers[0].drawingMode = mode;
  const stroke: Vector = {
    id: 'ink',
    kind,
    x: 70,
    y: 70,
    width: 160,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 6,
    strokeCap: 'round',
    strokeJoin: 'round',
    drawingMode: mode,
    points:
      kind === 'line'
        ? [
            { x: 0, y: 0 },
            { x: 160, y: 60 },
          ]
        : [],
    ...(kind === 'bezier'
      ? {
          nodes: [
            { x: 0, y: 0, out: { x: 50, y: 0 } },
            { x: 160, y: 60, in: { x: 110, y: 60 } },
          ],
        }
      : {}),
  };
  if (basis) {
    stroke.transform = basis;
    stroke.strokeJoin = 'miter';
    if (basis[0] < 0) stroke.x = 230;
  }
  p.layers[0].keys[0].shapes = [
    ...(mixed || extendedCage
      ? [
          {
            ...stroke,
            id: 'paint',
            kind: 'rectangle' as const,
            x: extendedCage ? 45 : 90,
            y: extendedCage ? 45 : 100,
            width: extendedCage ? 20 : 120,
            height: extendedCage ? 20 : 50,
            nodes: undefined,
            points: [],
            fillEnabled: true,
            fill: '#ff0000',
            strokeWidth: 0,
          },
        ]
      : []),
    stroke,
  ];
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
  const read = async () => {
    await expect(page.locator('button.publish')).toBeEnabled();
    return page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
    );
  };
  const screen = async (q: { x: number; y: number }) => {
    const b = (await canvas.boundingBox())!;
    return { x: b.x + b.width / 2 + q.x - 180, y: b.y + b.height / 2 + q.y - 120 };
  };
  async function drag(a: { x: number; y: number }, b: { x: number; y: number }) {
    const x = await screen(a),
      y = await screen(b);
    await page.mouse.move(x.x, x.y);
    await page.mouse.down();
    await page.mouse.move(y.x, y.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('button.publish')).toBeEnabled();
  }
  if (lasso) {
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await page.getByLabel('Lasso mode').selectOption('polygon');
    if (mode === 'merge') await page.getByLabel('Partial paint region').check();
    for (const point of [
      { x: 40, y: 40 },
      { x: 260, y: 40 },
      { x: 260, y: 175 },
      { x: 40, y: 175 },
    ]) {
      const q = await screen(point);
      await page.mouse.click(q.x, q.y);
    }
    await canvas.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await drag({ x: 40, y: 40 }, { x: 260, y: 175 });
  }
  if (mode === 'merge')
    await expect(
      page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
    ).toBeVisible();
  return { p, stroke, canvas, read, screen, drag };
}
async function setSkewPivot(page: Page, axis: 'X' | 'Y') {
  await page.getByText('Transform pivot', { exact: true }).click();
  const coordinate = page.getByLabel(`Pivot ${axis}`, { exact: true });
  await coordinate.fill(axis === 'X' ? '175' : '125');
  await coordinate.press('Tab');
}
test('skewing a box-selected Pencil curve preserves editable stroke geometry', async ({ page }) => {
  const f = await setup(page);
  await setSkewPivot(page, 'Y');
  await page.getByLabel('Transform skew X', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  await expect.poll(f.read).not.toEqual(f.p);
  const q = await f.read(),
    strokes = q.layers[0].keys[0].shapes.filter(
      (s) => s.fillEnabled === false && s.strokeWidth > 0,
    );
  expect(strokes.length).toBeGreaterThan(0);
  expect(strokes.every((s) => s.kind === 'bezier' && !s.contours)).toBe(true);
  expect(strokes[0].stroke).toBe('#000000');
  expect(strokes[0].strokeWidth).toBe(6);
  expect(q.layers[0].keys[0].shapes.every((s) => s.fillEnabled === false)).toBe(true);
  const op = around({ x: 150, y: 125 }, 1, 0, Math.tan((25 * Math.PI) / 180), 1);
  expect(matrix(strokes[0]).slice(0,4)).toEqual(matrix(f.stroke).slice(0,4));
  expect(worldPoint(strokes[0],strokes[0].nodes![0]).x).toBeCloseTo(mapPoint(op,{x:70,y:70}).x,7);
  expect(strokes[0].y).toBe(70);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
});
for (const [kind, mode, mixed, axis, lasso] of [
  ['line', 'merge', false, 'X', false],
  ['bezier', 'object', false, 'Y', false],
  ['bezier', 'merge', true, 'X', false],
  ['bezier', 'merge', false, 'Y', true],
] as const)
  test(`${mode} ${kind} ${mixed ? 'with paint' : 'alone'} retains strokes with ${axis} skew and ${lasso ? 'lasso' : 'box'} selection`, async ({
    page,
  }) => {
    const f = await setup(page, kind, mode, mixed, lasso);
    await setSkewPivot(page, axis === 'X' ? 'Y' : 'X');
    const before = await f.read();
    await page.getByLabel(`Transform skew ${axis}`, { exact: true }).fill('20');
    await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
    await expect.poll(f.read).not.toEqual(before);
    const q = await f.read(),
      art = q.layers[0].keys[0].shapes,
      strokes = art.filter((s) => s.fillEnabled === false && s.strokeWidth > 0);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((s) => s.stroke === '#000000' && s.strokeWidth === 6 && !s.contours)).toBe(
      true,
    );
    expect(
      strokes.every((s) => s.kind === 'bezier' || s.kind === 'path' || s.kind === 'line'),
    ).toBe(true);
    if (kind === 'bezier')
      expect(strokes.some((s) => s.nodes?.some((n) => n.in || n.out))).toBe(true);
    const ink = strokes[0], points = ink.nodes ?? ink.points;
    const a = worldPoint(ink, points[0]), b = worldPoint(ink, points.at(-1)!);
    const shear = Math.tan(20*Math.PI/180);
    expect(matrix(ink).slice(0,4)).toEqual(matrix(f.stroke).slice(0,4));
    expect(b.x-a.x).toBeCloseTo(160+(axis==='X'?60*shear:0),6);
    expect(b.y-a.y).toBeCloseTo(60+(axis==='Y'?160*shear:0),6);
    expect(a.x).toBeCloseTo(70-(axis==='X'?55*shear:0),6);
    expect(a.y).toBeCloseTo(70-(axis==='Y'?105*shear:0),6);
    if (mixed) expect(art.some((s) => s.fillEnabled !== false && s.fill === '#ff0000')).toBe(true);
    else expect(art.every((s) => s.fillEnabled === false)).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(before);
  });
for (const mode of ['merge', 'object'] as const)
test(`canvas skew shows normal-width ${mode} Pencil ink at both stages of the gesture`, async ({
  page,
}) => {
  const top = mode === 'merge' ? 67 : 45;
  const bottom = mode === 'merge' ? 133 : 130;
  const f = await setup(page, 'bezier', mode, false, false, mode === 'object');
  const x = mode === 'merge' ? 120 : 138;
  if (mode === 'object') await page.getByLabel('Selection transform mode',{exact:true}).selectOption('rotate-skew');
  const from = await f.screen({ x, y: top }),
    to = await f.screen({ x: x+70, y: top });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (mode === 'object') await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const gestureSkew = around({x:0,y:bottom},1,0,mode==='object' ? -1 : -70/(bottom-top),1);
  const transformedAnchor=mapPoint(gestureSkew,{x:70,y:70});
  await expect.poll(()=>stagePixel(f.canvas,Math.round(transformedAnchor.x),71)).toEqual([0,0,0,255]);
  const capOverhang = async () => Math.min(...(await stagePixel(f.canvas,Math.round(transformedAnchor.x-4),72)).slice(0,3));
  await expect.poll(capOverhang).toBeGreaterThan(245);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  if (mode === 'object') await page.keyboard.up('Shift');
  await expect.poll(f.read).not.toEqual(f.p);
  const q = await f.read(),
    stroke = q.layers[0].keys[0].shapes.find((s) => s.fillEnabled === false && s.strokeWidth > 0)!;
  expect(stroke).toBeDefined();
  expect(stroke.kind).toBe('bezier');
  expect(stroke.nodes).toHaveLength(f.stroke.nodes!.length);
  expect(stroke.strokeWidth).toBe(6);
  expect(matrix(stroke).slice(0,4)).toEqual([1,0,0,1]);
  const a = worldPoint(stroke,stroke.nodes![0]);
  const b = worldPoint(stroke,stroke.nodes![1]);
  expect(a.y).toBe(70);
  expect(b.y).toBe(130);
  expect(a.x).toBeCloseTo(transformedAnchor.x,7);
  expect(b.x).toBeCloseTo(mapPoint(gestureSkew,{x:230,y:130}).x,7);
  await expect.poll(()=>stagePixel(f.canvas,Math.round(transformedAnchor.x),71)).toEqual([0,0,0,255]);
  await expect.poll(capOverhang).toBeGreaterThan(245);
  const outgoing = worldPoint(stroke,stroke.nodes![0].out!);
  const incoming = worldPoint(stroke,stroke.nodes![1].in!);
  expect(outgoing.x).toBeCloseTo(a.x+50, 7);
  expect(outgoing.y).toBe(a.y);
  expect(incoming.x).toBeCloseTo(b.x-50, 7);
  expect(incoming.y).toBe(b.y);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('a skewed merge-layer Pencil curve remains editable with Subselection', async ({ page }) => {
  const f = await setup(page);
  await setSkewPivot(page, 'Y');
  await page.getByLabel('Transform skew X', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  await expect.poll(f.read).not.toEqual(f.p);
  const q = await f.read(),
    stroke = q.layers[0].keys[0].shapes.find(
      (s) => s.kind === 'bezier' && s.fillEnabled === false,
    )!;
  const original = worldPoint(stroke, stroke.nodes![0]),
    pick = await f.screen(original);
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  await page.mouse.click(pick.x, pick.y);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const moved = await f.read(),
    result = moved.layers[0].keys[0].shapes.find(
      (s) => s.kind === 'bezier' && s.fillEnabled === false,
    )!;
  expect(result).toBeDefined();
  expect(result.strokeWidth).toBe(6);
  expect(result.stroke).toBe('#000000');
  expect(worldPoint(result, result.nodes![0]).x - original.x).toBeCloseTo(1, 7);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(q);
});

for (const [basis, createLayer] of [
  [[1, 0.2, 0.4, 1], false],
  [[-1, 0.2, 0.3, 1], true],
] as const) {
  test(`converting a complete lassoed ${createLayer ? 'reflected' : 'affine'} Pencil curve keeps it editable`, async ({ page }) => {
    const f = await setup(page, 'bezier', 'merge', false, true, false, [...basis]);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Convert to symbol…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
    await dialog.getByLabel('Symbol name', { exact: true }).fill('Editable Pencil');
    if (createLayer) await dialog.getByLabel('Create new layer', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const saved = await f.read();
    expect(saved.layers).toHaveLength(createLayer ? 2 : 1);
    const [instance] = saved.layers.flatMap(layer => layer.keys[0].shapes);
    expect(saved.layers.flatMap(layer => layer.keys[0].shapes)).toHaveLength(1);
    expect(instance.kind).toBe('symbol');
    const artwork = saved.symbols!.find(symbol => symbol.id === instance.symbolId)!.shapes;
    expect(artwork).toHaveLength(1);
    const [stroke] = artwork;
    expect(stroke).toMatchObject({ kind: 'bezier', fillEnabled: false, strokeWidth: 6, strokeJoin: 'miter' });
    expect(stroke.nodes).toEqual(f.stroke.nodes);
    expect(matrix(stroke).slice(0, 4)).toEqual(basis);
    for (const node of stroke.nodes!) {
      for (const point of [node, node.in, node.out]) {
        if (!point) continue;
        const actual = mapPoint(matrix(instance), worldPoint(stroke, point));
        const original = worldPoint(f.stroke, point);
        expect(actual.x).toBeCloseTo(original.x, 8);
        expect(actual.y).toBeCloseTo(original.y, 8);
      }
    }
    const middle = worldPoint(f.stroke, { x: 80, y: 30 });
    await f.canvas.press('Escape');
    await expect.poll(() => stagePixel(f.canvas, middle.x, middle.y)).toEqual([0, 0, 0, 255]);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(saved);
  });
}
