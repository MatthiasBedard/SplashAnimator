import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';

async function setup(page: Page, stroke = 0, overlap = false, compound = false) {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = 'merge';
  const curve: Vector = {
    id: 'curve',
    kind: 'bezier',
    closed: true,
    x: 40,
    y: 60,
    width: 200,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: true,
    stroke: '#223344',
    strokeWidth: stroke,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 60, y: -30 } },
      { x: 200, y: 0, in: { x: 140, y: -30 } },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
  };
  const other: Vector = {
    id: 'other',
    kind: 'rectangle',
    x: overlap ? 120 : 300,
    y: overlap ? 105 : 200,
    width: 80,
    height: 70,
    rotation: 0,
    fill: '#0000ff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  if (compound) {
    curve.kind = 'polygon';
    curve.fillRule = 'evenodd';
    delete curve.nodes;
    curve.contours = [
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        { x: 70, y: 30 },
        { x: 70, y: 70 },
        { x: 110, y: 70 },
        { x: 110, y: 30 },
      ],
    ];
  }
  p.layers[0].keys[0].shapes = [curve, other];
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
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const pos = async (x: number, y: number) => {
    const r = (await canvas.boundingBox())!;
    return { x: r.x + r.width / 2 - 200 + x, y: r.y + r.height / 2 - 150 + y };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    const a = await pos(x, y),
      b = await pos(x + dx, y + dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  };
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (e, { x, y }) => {
        const c = e as HTMLCanvasElement,
          d = devicePixelRatio;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(c.width / 2 + (x - 200) * d, c.height / 2 + (y - 150) * d, 1, 1).data,
        );
      },
      { x, y },
    );
  return { p, curve, other, canvas, pos, read, drag, pixel };
}
const anchors = (s: Vector) => s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
for (const variant of ['filled', 'stroked', 'overlap'])
  test(`${variant} curve dragging retains the same authored anchors through repeated release`, async ({
    page,
  }) => {
    const f = await setup(page, variant === 'stroked' ? 4 : 0, variant === 'overlap');
    const at = await f.pos(40, 60);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => f.pixel(140, 27)).toEqual([255, 255, 255, 255]);
    let previousControlY = -30;
    for (const [y, dy] of [
      [37.5, -15],
      [22.5, 10],
    ]) {
      await f.drag(140, y, 0, dy);
      const out = await f.read(),
        artwork = out.layers[0].keys[0].shapes;
      expect(artwork.reduce((n, s) => n + anchors(s), 0)).toBe(4);
      expect(artwork.map((s) => s.id)).toEqual(['curve', 'other']);
      expect(artwork[0].nodes!.map((n) => ({ x: n.x, y: n.y }))).toEqual(
        f.curve.nodes!.map((n) => ({ x: n.x, y: n.y })),
      );
      expect(artwork[1]).toEqual(f.other);
      const controlY = artwork[0].nodes![0].out!.y;
      if (dy < 0) expect(controlY).toBeLessThan(previousControlY);
      else expect(controlY).toBeGreaterThan(previousControlY);
      previousControlY = controlY;
      await expect
        .poll(() => f.pixel(140, 27))
        .toEqual(dy < 0 ? [255, 0, 0, 255] : [255, 255, 255, 255]);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

for (const action of ['anchor', 'tangent'])
  test(`moving an existing ${action} retains curve topology and selection`, async ({ page }) => {
    const f = await setup(page, 4),
      pick = await f.pos(40, 60);
    await page.mouse.click(pick.x, pick.y);
    await f.drag(action === 'anchor' ? 40 : 100, action === 'anchor' ? 60 : 30, 10, 10);
    const out = await f.read(),
      shape = out.layers[0].keys[0].shapes.find((s) => s.id === 'curve')!;
    expect(shape).toBeDefined();
    expect(anchors(shape)).toBe(4);
    expect(out.layers[0].keys[0].shapes[1]).toEqual(f.other);
    const points = shape.nodes!.map((n) => worldPoint(shape, n));
    for (let i = action === 'anchor' ? 1 : 0; i < 4; i++)
      expect(points[i]).toEqual(worldPoint(f.curve, f.curve.nodes![i]));
    if (action === 'anchor') expect(points[0]).toEqual({ x: 50, y: 70 });
    else expect(worldPoint(shape, shape.nodes![0].out!)).toEqual({ x: 110, y: 40 });
    await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('compound paint keeps every ring anchor while a boundary is curved', async ({ page }) => {
  const f = await setup(page, 0, false, true),
    at = await f.pos(40, 60);
  await page.mouse.click(at.x, at.y);
  await f.drag(140, 60, 0, -20);
  const out = await f.read(),
    s = out.layers[0].keys[0].shapes[0];
  expect(s.id).toBe('curve');
  expect(s.contours!.map((r) => r.length)).toEqual([4, 4]);
  expect(s.contours![1]).toEqual(f.curve.contours![1]);
  expect(s.contours![0].map((n) => ({ x: n.x, y: n.y }))).toEqual(f.curve.contours![0]);
  expect(s.contours![0][0].out!.y).toBeLessThan(0);
  expect(out.layers[0].keys[0].shapes[1]).toEqual(f.other);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('keyboard nudging existing filled-curve vertices does not reconstruct paint', async ({
  page,
}) => {
  const f = await setup(page, 4),
    at = await f.pos(40, 60);
  await page.mouse.click(at.x, at.y);
  await f.canvas.focus();
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press('ArrowRight');
    const s = (await f.read()).layers[0].keys[0].shapes[0];
    expect(s.id).toBe('curve');
    expect(s.nodes).toHaveLength(4);
    expect(worldPoint(s, s.nodes![0])).toEqual({ x: 40 + i, y: 60 });
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  }
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('explicit insertion adds one vertex and deletion removes only that vertex', async ({
  page,
}) => {
  const f = await setup(page, 4),
    anchor = await f.pos(40, 60),
    edge = await f.pos(140, 37.5);
  await page.mouse.click(anchor.x, anchor.y);
  await page.keyboard.down('Alt');
  await page.mouse.click(edge.x, edge.y);
  await page.keyboard.up('Alt');
  const inserted = await f.read();
  expect(inserted.layers[0].keys[0].shapes.map((s) => s.id)).toEqual(['curve', 'other']);
  expect(inserted.layers[0].keys[0].shapes[0].nodes).toHaveLength(5);
  await f.canvas.focus();
  await page.keyboard.press('Delete');
  const removed = await f.read();
  expect(removed.layers[0].keys[0].shapes[0].nodes).toHaveLength(4);
  expect(removed.layers[0].keys[0].shapes[1]).toEqual(f.other);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(inserted);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
