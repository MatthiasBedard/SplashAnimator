import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { hitPart, worldPoint } from '../../packages/geometry/src';
async function setup(page: Page, kind = 'line', mode = 'object', tween = false, crossing: boolean | 'same-fill' = false,
  custom?: Vector[]) {
  const p = newProject();
  p.width = 320;
  p.height = 240;
  p.layers[0].drawingMode = mode as 'merge' | 'object';
  const s: Vector = {
    id: 'ink',
    kind: kind as Vector['kind'],
    x: 40,
    y: 60,
    width: 200,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: kind === 'rectangle',
    stroke: '#223344',
    strokeWidth: 4,
    points: [],
  };
  if (kind === 'bezier')
    s.nodes = [
      { x: 0, y: 0, out: { x: 60, y: 30 } },
      { x: 200, y: 40, in: { x: 140, y: 30 } },
    ];
  p.layers[0].keys[0].shapes = [s];
  if (crossing && kind === 'rectangle') {
    s.strokeWidth = 0;
    p.layers[0].keys[0].shapes.unshift({ ...s, id: 'underpaint', x: 80, y: 112,
      width: 130, height: 60, fill: crossing === 'same-fill' ? s.fill : '#0000ff' });
  } else if (crossing) p.layers[0].keys[0].shapes.unshift(
    { ...s, id: 'underpaint', kind: 'rectangle', x: 80, y: 112, width: 130, height: 40,
      strokeWidth: 0, fillEnabled: true },
    { ...s, id: 'crossing', kind: 'line', x: 160, y: 100, width: 0, height: 100 },
  );
  if (custom) p.layers[0].keys[0].shapes = custom;
  if (tween) {
    p.duration = 12;
    p.layers[0].keys.push({ frame: 8, shapes: [{ ...structuredClone(s), x: 60 }] });
    Object.assign(
      p,
      prepareTimelineTween(p, p.layers[0].id, {
        start: 0,
        end: 8,
        kind: 'motion',
        affine: false,
        createEndpoints: false,
        ease: 'linear',
      }),
    );
  }
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
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const pos = async (x: number, y: number) => {
    const r = (await canvas.boundingBox())!;
    return { x: r.x + r.width / 2 - 160 + x, y: r.y + r.height / 2 - 120 + y };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    const a = await pos(x, y),
      b = await pos(x + dx, y + dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  return { p, canvas, pos, read, drag };
}

for (const [tool, material] of [['Subselection', 'Brush paint'], ['Selection', 'a filled shape']] as const)
test(`${tool} bends an attached Pencil edge and splits ${material} on deselect`, async ({ page }) => {
  const ink: Vector = { id: 'divider', kind: 'bezier', x: 40, y: 70, width: 230, height: 0, rotation: 0, fill: '#000000',
    fillEnabled: false, stroke: '#223344', strokeWidth: 4, drawingMode: 'merge', points: [],
    nodes: [{ x: 0, y: 0 }, { x: 230, y: 0 }] };
  const brush: Vector = { ...ink, id: 'brush', kind: 'polygon', x: 110, y: 100, width: 90, height: 65,
    fill: '#0044ff', fillEnabled: true, strokeWidth: 0, nodes: undefined, closed: true, fillRule: 'evenodd',
    contours: [[{ x: 0, y: 0, out: { x: 30, y: -6 } }, { x: 90, y: 0, in: { x: 60, y: -6 } },
      { x: 90, y: 65 }, { x: 0, y: 65 }]] };
  const paint: Vector = material === 'Brush paint' ? brush : { ...brush, kind: 'rectangle', contours: undefined };
  const attached = { ...brush, id: 'attached', x: 40, y: 45, width: 40, height: 25, fill: '#ff4400',
    contours: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }]] };
  const neighbor = { ...brush, id: 'neighbor', x: 216, y: 175, fill: '#22aa33' };
  const f = await setup(page, 'bezier', 'merge', false, false, [paint, attached, neighbor, ink]);
  if (tool === 'Selection') await page.getByRole('button', { name: 'Selection', exact: true }).click();
  else {
    const pick = await f.pos(155, 70);
    await page.mouse.click(pick.x, pick.y);
  }
  await f.drag(155, 70, 0, 65);
  const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
  if (tool === 'Subselection') {
    const pending = await artwork();
    expect(pending.find(shape => shape.id === paint.id)).toEqual(paint);
    expect(pending.find(shape => shape.id === attached.id)).not.toEqual(attached);
    expect(pending.find(shape => shape.id === ink.id)?.nodes).toHaveLength(2);
  }
  const blank = await f.pos(285, 219);
  await page.mouse.click(blank.x, blank.y);
  const blue = async () => (await artwork()).filter(shape => shape.fillEnabled !== false && shape.fill === paint.fill);
  await expect.poll(blue).toHaveLength(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const probes = () => f.canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement, ctx = canvas.getContext('2d')!, scale = devicePixelRatio;
    return [112, 135, 150].map(y => Array.from(ctx.getImageData(canvas.width / 2 - 5 * scale,
      canvas.height / 2 + (y - 120) * scale, 1, 1).data));
  });
  await expect.poll(probes).toEqual([[0, 68, 255, 255], [34, 51, 68, 255], [0, 68, 255, 255]]);
  const [upper, lower] = await blue();
  const owners = (point: { x: number; y: number }) => [upper, lower].find(shape => hitPart(shape, point, 0) === 'fill')?.id;
  expect(new Set([owners({ x: 155, y: 112 }), owners({ x: 155, y: 150 })])).toEqual(new Set([upper.id, lower.id]));
  const merged = await artwork();
  expect(merged.find(shape => shape.id === neighbor.id)).toEqual(neighbor);
  const centerlines = merged.filter(shape => shape.fillEnabled === false);
  expect(centerlines.some(shape => shape.nodes?.some(node => node.in || node.out))).toBe(true);
  expect(centerlines.every(shape => shape.strokeWidth === 4)).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(artwork).toEqual(merged);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const top = await f.pos(155, 112);
  await page.mouse.click(top.x, top.y);
  await f.canvas.press('Delete');
  const bottom = { x: 155, y: 150 };
  await expect.poll(async () => (await blue()).map(shape => shape.id)).toEqual([owners(bottom)]);
  await expect.poll(async () => (await probes()).filter((_, i) => i !== 1))
    .toEqual([[255, 255, 255, 255], [0, 68, 255, 255]]);
});

for (const settle of ['Apply', 'deselect'] as const)
  test(`Subselection resolves edited fill overlap on ${settle}`, async ({ page }) => {
    const f = await setup(page, 'rectangle', 'merge', false, true);
    const apply = page.getByRole('group', { name: 'Active drawing tool options' }).getByRole('button', { name: 'Apply', exact: true });
    const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
    const pick = await f.pos(140, 80);
    await page.mouse.click(pick.x, pick.y);
    if (settle === 'Apply') await expect(apply).toBeDisabled();
    await f.drag(140, 100, 0, 49);
    if (settle === 'Apply') await expect(apply).toBeEnabled();
    const bent = await artwork();
    expect(bent[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
    expect(bent[1].nodes).toHaveLength(4);
    if (settle === 'Apply') await apply.click();
    else {
      const blank = await f.pos(260, 185);
      await page.mouse.click(blank.x, blank.y);
    }
    await expect.poll(async () => (await artwork())[0]).not.toEqual(bent[0]);
    const merged = await artwork();
    expect(merged.at(-1)).toEqual(bent[1]);
    expect(merged[0].fill).toBe('#0000ff');
    await expect(apply).toBeDisabled();
    const inspector = page.getByLabel('Shape X', { exact: true });
    if (settle === 'Apply') await expect(inspector).toBeVisible();
    else await expect(inspector).toHaveCount(0);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(artwork).toEqual(merged);
  });

test('Apply keeps the resolved Pencil pieces selected for further editing', async ({ page }) => {
  const f = await setup(page, 'line', 'merge', false, true);
  const pick = await f.pos(140, 80);
  await page.mouse.click(pick.x, pick.y);
  await f.drag(140, 80, 0, 60);
  const apply = page.getByRole('group', { name: 'Active drawing tool options' }).getByRole('button', { name: 'Apply', exact: true });
  await apply.click();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.filter(shape => shape.kind === 'bezier')).toHaveLength(4);
  await expect(apply).toBeDisabled();
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
});

test('Apply keeps same-color paint selected when the edited fill joins its neighbor', async ({ page }) => {
  const f = await setup(page, 'rectangle', 'merge', false, 'same-fill');
  const pick = await f.pos(140, 80);
  await page.mouse.click(pick.x, pick.y);
  await f.drag(140, 100, 0, 49);
  const apply = page.getByRole('group', { name: 'Active drawing tool options' }).getByRole('button', { name: 'Apply', exact: true });
  await apply.click();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.map(shape => shape.id)).toEqual(['underpaint']);
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
});

for (const edit of ['edge', 'tangent'])
test(`editing a Pencil ${edit} merges new curve crossings only on deselection`, async ({ page }) => {
  const f = await setup(page, edit === 'edge' ? 'line' : 'bezier', 'merge', false, true);
  const pick = edit === 'edge' ? await f.pos(140, 80) : await f.pos(40, 60);
  await page.mouse.click(pick.x, pick.y);
  if (edit === 'edge') await f.drag(140, 80, 0, 60);
  else await f.drag(100, 90, 0, 100);
  const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
  const bent = await artwork();
  expect(bent.map(shape => shape.id)).toEqual(['underpaint', 'crossing', 'ink']);
  expect(bent[2].nodes).toHaveLength(2);
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();

  if (edit === 'edge') {
    const blank = await f.pos(270, 180);
    await page.mouse.click(blank.x, blank.y);
  } else await f.canvas.press('Escape');
  await expect.poll(async () => (await artwork()).filter(shape => shape.kind === 'bezier')).toHaveLength(4);
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  const merged = await artwork();
  const paint = merged.filter(shape => shape.fillEnabled !== false && shape.strokeWidth === 0);
  expect(paint).toHaveLength(2);
  for (const point of [{ x: 90, y: 114 }, { x: 195, y: 148 }]) {
    expect(paint.filter(shape => hitPart(shape, point, 0) === 'fill')).toHaveLength(1);
  }
  const straightInk = merged.filter(shape => shape.kind === 'path');
  expect(straightInk).toHaveLength(2);
  const curves = merged.filter(shape => shape.kind === 'bezier');
  const crossingEnds = [];
  for (const curve of curves) {
    expect(curve.nodes?.some(node => node.in || node.out)).toBe(true);
    crossingEnds.push(...(curve.nodes ?? []).map(node => worldPoint(curve, node)).filter(p =>
      Math.abs(p.x - 160) < 0.01 && p.y > 100 && p.y < 200));
  }
  expect(crossingEnds).toHaveLength(2);
  expect(crossingEnds[0].y).toBeCloseTo(crossingEnds[1].y, 3);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(artwork).toEqual(merged);
});

test('deselecting a bent Pencil splits crossing ink across intervening paint', async ({ page }) => {
  const ink: Vector = { id: 'bent', kind: 'bezier', x: 40, y: 70, width: 230, height: 0, rotation: 0,
    fill: '#000000', fillEnabled: false, stroke: '#223344', strokeWidth: 4, drawingMode: 'merge', points: [],
    nodes: [{ x: 0, y: 0 }, { x: 230, y: 0 }] };
  const crossing: Vector = { ...ink, id: 'crossing', kind: 'line', x: 155, y: 98, width: 0, height: 80,
    stroke: '#773300', nodes: undefined, points: [{ x: 0, y: 0 }, { x: 0, y: 80 }] };
  const paint: Vector = { ...ink, id: 'paint', kind: 'rectangle', x: 145, y: 153, width: 30, height: 32,
    fill: '#0044ff', fillEnabled: true, strokeWidth: 0, nodes: undefined };
  const f = await setup(page, 'bezier', 'merge', false, false, [crossing, paint, ink]);
  const read = async () => (await f.read()).layers[0].keys[0].shapes;
  const pick = await f.pos(155, 70);
  await page.mouse.click(pick.x, pick.y);
  await f.drag(155, 70, 0, 65);
  const pending = await read();
  expect(pending.slice(0, 2)).toEqual([crossing, paint]);
  expect(pending[2].nodes).toHaveLength(2);
  const blank = await f.pos(300, 202);
  await page.mouse.click(blank.x, blank.y);
  await expect.poll(async () => (await read()).filter(s => s.strokeWidth === 4 && s.stroke === crossing.stroke)).toHaveLength(2);
  const settled = await read();
  expect(settled.filter(s => s.fillEnabled !== false)).toEqual([paint]);
  expect(settled.map(s => s.id === 'paint' ? 'paint' : s.stroke)).toEqual([
    crossing.stroke, crossing.stroke, 'paint', ink.stroke, ink.stroke,
  ]);
  const curves = settled.filter(s => s.strokeWidth === 4 && s.stroke === ink.stroke);
  expect(curves).toHaveLength(2);
  const ends = curves.flatMap(s => (s.nodes ?? []).map(n => worldPoint(s,n)));
  expect(ends.filter(p => Math.abs(p.x - 155) < 0.001)).toEqual([{ x: 155, y: 135 }, { x: 155, y: 135 }]);
  expect(curves.every(s => s.nodes?.some(n => n.in || n.out))).toBe(true);
  await expect.poll(() => f.canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!, scale = devicePixelRatio;
    return [111, 135, 167].map(y => [...ctx.getImageData(element.width / 2 - 5 * scale,
      element.height / 2 + (y - 120) * scale, 1, 1).data]);
  })).toEqual([[119, 51, 0, 255], [34, 51, 68, 255], [0, 68, 255, 255]]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(settled);
});

for (const mode of ['object', 'merge'])
  test(`Subselection directly bends a selected line in ${mode} mode and keeps it selected`, async ({
    page,
  }) => {
    const f = await setup(page, 'line', mode),
      q = await f.pos(140, 80);
    await page.mouse.click(q.x, q.y);
    expect(await f.read()).toEqual(f.p);
    await f.drag(140, 80, 0, 40);
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const after = await f.read(),
      shape = after.layers[0].keys[0].shapes[0];
    expect(shape.kind).toBe('bezier');
    expect(shape.nodes![0].out).toBeDefined();
    await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(after);
  });
test('a rectangle edge bends without moving its corner anchors and exposes cyan controls distinct from purple vertices', async ({
  page,
}) => {
  const f = await setup(page, 'rectangle'),
    q = await f.pos(140, 60);
  await page.mouse.click(q.x, q.y);
  await f.drag(140, 60, 0, -30);
  const out = await f.read(),
    s = out.layers[0].keys[0].shapes[0];
  expect(s.kind).toBe('bezier');
  expect(s.nodes).toHaveLength(4);
  expect(s.nodes![0].x).toBe(0);
  expect(s.nodes![1].x).toBe(200);
  expect(s.nodes![0].y).toBe(0);
  expect(s.nodes![1].y).toBe(0);
  expect(s.fill).toBe('#ff0000');
  const colors = await f.canvas.evaluate((node) => {
    const c = node as HTMLCanvasElement,
      d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let cyan = 0,
      purple = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 55 && d[i + 1] === 219 && d[i + 2] === 232) cyan++;
      if (d[i] === 146 && d[i + 1] === 117 && d[i + 2] === 255) purple++;
    }
    return { cyan, purple };
  });
  expect(colors.cyan).toBeGreaterThan(5);
  expect(colors.purple).toBeGreaterThan(5);
});
test('Escape and a drag returning to its starting point leave the original primitive unchanged', async ({
  page,
}) => {
  const f = await setup(page),
    q = await f.pos(140, 80);
  await page.mouse.click(q.x, q.y);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y + 30);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y + 30);
  await page.mouse.move(q.x, q.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
});

test('an existing cubic can be reshaped repeatedly without moving its anchor points', async ({
  page,
}) => {
  const f = await setup(page, 'bezier'),
    q = await f.pos(140, 87.5);
  await page.mouse.click(q.x, q.y);
  await f.drag(140, 87.5, 0, 25);
  await f.drag(140, 112.5, 0, 15);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const s = (await f.read()).layers[0].keys[0].shapes[0];
  expect(s.nodes![0].x).toBe(0);
  expect(s.nodes![0].y).toBe(0);
  expect(s.nodes![1].x).toBe(200);
  expect(s.nodes![1].y).toBe(40);
  expect(s.nodes![0].out!.y).toBeGreaterThan(60);
});

test('an incompatible live tween endpoint rejects the edge conversion without publishing invalid artwork', async ({
  page,
}) => {
  const f = await setup(page, 'rectangle', 'object', true),
    q = await f.pos(140, 60);
  await page.mouse.click(q.x, q.y);
  await f.drag(140, 60, 0, -30);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
