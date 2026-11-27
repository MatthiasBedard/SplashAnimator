import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector, type Point } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
import { holdGeometry, pendingGeometry } from './held-worker';

function fixture(
  kind: 'path' | 'bezier' | 'line' | 'compound' = 'path',
  mode: 'merge' | 'object' = 'merge',
  basis = 'plain',
) {
  const p = newProject();
  p.width = 320;
  p.height = 240;
  p.duration = 4;
  p.layers[0].drawingMode = mode;
  const shape: Vector = {
    id: 'ink',
    kind: kind === 'compound' ? 'path' : kind,
    x: 40,
    y: 70,
    width: 200,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 5,
    points: [
      { x: 0, y: 0 },
      { x: 90, y: 40 },
      { x: 200, y: 0 },
    ],
  };
  if (kind === 'line') {
    shape.points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    delete shape.fillEnabled;
  }
  if (kind === 'bezier') {
    shape.points = [];
    shape.nodes = [
      { x: 0, y: 0, out: { x: 30, y: -20 } },
      { x: 90, y: 40, in: { x: 60, y: 40 }, out: { x: 130, y: 40 } },
      { x: 200, y: 0, in: { x: 170, y: -20 } },
    ];
  }
  if (kind === 'compound') {
    shape.points = [];
    shape.height = 120;
    shape.strokeWidth = 0;
    shape.fillEnabled = true;
    shape.contours = [
      [
        { x: 0, y: 0 },
        { x: 180, y: 0 },
        { x: 180, y: 120 },
        { x: 0, y: 120 },
      ],
      [
        { x: 40, y: 40 },
        { x: 40, y: 80 },
        { x: 80, y: 80 },
        { x: 80, y: 40 },
      ],
    ];
  }
  if (basis === 'affine') shape.transform = [1, 0.15, 0.2, 0.9];
  if (basis === 'reflected') {
    shape.x = 270;
    shape.transform = [-1, 0.1, 0.2, 0.9];
  }
  p.layers[0].keys[0].shapes = [shape];
  return p;
}
const anchors = (shape: Vector) => shape.contours?.flat() ?? shape.nodes ?? shape.points;
async function setup(page: Page, p: Project) {
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
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const screen = async (q: Point) => {
    const b = (await canvas.boundingBox())!;
    return { x: b.x + b.width / 2 + q.x - p.width / 2, y: b.y + b.height / 2 + q.y - p.height / 2 };
  };
  const drag = async (a: Point, b: Point) => {
    const from = await screen(a),
      to = await screen(b);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  };
  const pixel = (q: Point) =>
    canvas.evaluate(
      (c, { q, p }) => {
        const n = c as HTMLCanvasElement;
        return Array.from(
          n
            .getContext('2d')!
            .getImageData(
              Math.round(n.width / 2 + (q.x - p.width / 2) * devicePixelRatio),
              Math.round(n.height / 2 + (q.y - p.height / 2) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { q, p },
    );
  const hasAnchor = async (q: Point) => {
    const out = await read();
    return out.layers[0].keys[0].shapes.some((s) =>
      anchors(s).some((n) => {
        const w = worldPoint(s, n);
        return Math.hypot(w.x - q.x, w.y - q.y) < 0.001;
      }),
    );
  };
  return { canvas, screen, drag, pixel, read, hasAnchor };
}

for (const [kind, mode, basis] of [
  ['path', 'merge', 'plain'],
  ['line', 'merge', 'plain'],
  ['bezier', 'merge', 'plain'],
  ['path', 'merge', 'affine'],
  ['bezier', 'merge', 'reflected'],
  ['compound', 'merge', 'plain'],
  ['path', 'object', 'plain'],
  ['bezier', 'object', 'reflected'],
] as const)
  test(`${mode} ${kind} ${basis} keeps its moved anchor selected for another drag until clicking off`, async ({
    page,
  }) => {
    const p = fixture(kind, mode, basis),
      f = await setup(page, p),
      source = p.layers[0].keys[0].shapes[0],
      start = worldPoint(source, anchors(source)[1]),
      target = { x: start.x + 12, y: start.y + 18 };
    await f.drag(start, target);
    await expect.poll(() => f.hasAnchor(target)).toBe(true);
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
    await expect.poll(() => f.pixel(target)).toEqual([146, 117, 255, 255]);
    const next = { x: target.x + 8, y: target.y - 6 };
    await f.drag(target, next);
    await expect.poll(() => f.hasAnchor(next)).toBe(true);
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
    await expect.poll(() => f.pixel(next)).toEqual([146, 117, 255, 255]);
    const moved = await f.read();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => f.hasAnchor(target)).toBe(true);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(moved);
    // Reselect the admitted authored point after history navigation, then click off.
    await f.canvas.focus();
    await page.keyboard.press('Control+a');
    const at = await f.screen(next);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
    const blank = await f.screen({ x: 300, y: 220 });
    await page.mouse.click(blank.x, blank.y);
    await expect(page.getByText('0 anchors selected', { exact: true })).toBeVisible();
    await expect.poll(() => f.pixel(next)).not.toEqual([146, 117, 255, 255]);
    expect(await f.read()).toEqual(moved);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('multiple merged anchors remain selected through release and keyboard nudge', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p),
    s = p.layers[0].keys[0].shapes[0],
    a = worldPoint(s, anchors(s)[0]),
    b = worldPoint(s, anchors(s)[1]);
  const x = await f.screen(a),
    y = await f.screen(b);
  await page.mouse.click(x.x, x.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(y.x, y.y);
  await page.keyboard.up('Shift');
  await f.drag(b, { x: b.x + 10, y: b.y + 15 });
  await expect.poll(() => f.hasAnchor({ x: b.x + 10, y: b.y + 15 })).toBe(true);
  await expect(page.getByText('2 anchors selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => f.hasAnchor({ x: a.x + 11, y: a.y + 15 })).toBe(true);
  await expect.poll(() => f.hasAnchor({ x: b.x + 11, y: b.y + 15 })).toBe(true);
  await expect(page.getByText('2 anchors selected', { exact: true })).toBeVisible();
});

test('existing anchor editing does not queue paint reconstruction and retains selection for another edit', async ({ page }) => {
  await holdGeometry(page);
  const p = fixture(), f = await setup(page, p), s = p.layers[0].keys[0].shapes[0],
    start = worldPoint(s, anchors(s)[1]), target = { x: start.x + 12, y: start.y + 18 };
  await f.drag(start, target);
  await expect.poll(() => f.hasAnchor(target)).toBe(true);
  expect(await pendingGeometry(page)).toBe(0);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  const next = { x: target.x + 4, y: target.y - 6 };
  await f.drag(target, next);
  await expect.poll(() => f.hasAnchor(next)).toBe(true);
  expect(await pendingGeometry(page)).toBe(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.focus(); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
});

test('a merged tangent stays selected while its anchor stays fixed', async ({ page }) => {
  const p = fixture('bezier'),
    f = await setup(page, p),
    s = p.layers[0].keys[0].shapes[0],
    anchor = worldPoint(s, s.nodes![1]),
    start = worldPoint(s, s.nodes![1].out!),
    target = { x: start.x + 10, y: start.y + 12 };
  const hasHandle = async (q: Point) =>
    (await f.read()).layers[0].keys[0].shapes.some((shape) =>
      shape.nodes?.some((n) =>
        [n.in, n.out].some(
          (h) =>
            h && Math.hypot(worldPoint(shape, h).x - q.x, worldPoint(shape, h).y - q.y) < 0.001,
        ),
      ),
    );
  await f.drag(start, target);
  await expect.poll(() => hasHandle(target)).toBe(true);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(anchor)).toEqual([146, 117, 255, 255]);
  const next = { x: target.x + 8, y: target.y - 5 };
  await f.drag(target, next);
  await expect.poll(() => hasHandle(next)).toBe(true);
  await expect.poll(() => f.hasAnchor(anchor)).toBe(true);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
});

test('clicking different artwork replaces the retained point selection without a document edit', async ({
  page,
}) => {
  const p = fixture('path', 'object'),
    other = structuredClone(p.layers[0].keys[0].shapes[0]);
  other.id = 'other';
  other.y = 180;
  other.stroke = '#0000ff';
  other.points = [
    { x: 0, y: 0 },
    { x: 140, y: 0 },
  ];
  p.layers[0].keys[0].shapes.push(other);
  const f = await setup(page, p),
    s = p.layers[0].keys[0].shapes[0],
    start = worldPoint(s, s.points[1]),
    target = { x: start.x + 12, y: start.y + 18 };
  await f.drag(start, target);
  await expect.poll(() => f.hasAnchor(target)).toBe(true);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  const before = await f.read(),
    middle = await f.screen({ x: 100, y: 180 });
  await page.mouse.click(middle.x, middle.y);
  await expect(page.getByText('0 anchors selected', { exact: true })).toBeVisible();
  const at = await f.screen(worldPoint(other, other.points[0]));
  await page.mouse.click(at.x, at.y);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(target)).not.toEqual([146, 117, 255, 255]);
  expect(await f.read()).toEqual(before);
});
