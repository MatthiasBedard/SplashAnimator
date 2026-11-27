import { expect, test, type Page } from '@playwright/test';
import { newProject, type Vector, type Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { worldPoint } from '../../packages/geometry/src';

function line(id: string, x: number, y: number, dx: number, dy: number): Vector {
  return {
    id,
    kind: 'line',
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 4,
    points: [
      { x: 0, y: 0 },
      { x: dx, y: dy },
    ],
  };
}
async function setup(
  page: Page,
  mode: 'merge' | 'object' = 'object',
  held = false,
  curve = false,
  group = false,
  filledOutline = false,
) {
  if (held) await holdGeometry(page);
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.duration = 4;
  p.layers[0].drawingMode = mode;
  const a = line('a', 60, 70, 100, 0),
    b = { ...line('b', 160, 70, 0, 80), stroke: '#0000ff' },
    c = { ...line('c', 160, 150, 80, 0), stroke: '#00ff00' };
  if (curve)
    Object.assign(a, {
      kind: 'bezier',
      points: [],
      height: 40,
      nodes: [
        { x: 0, y: 0, out: { x: 30, y: -40 } },
        { x: 100, y: 0, in: { x: 70, y: -40 } },
      ],
    });
  p.layers[0].keys[0].shapes = [
    a,
    b,
    c,
    line('island', 300, 70, 60, 0),
    {
      ...line('fill-bridge', 235, 60, 70, 120),
      kind: 'rectangle',
      points: [],
      fillEnabled: true,
      fill: '#ff0000',
      strokeWidth: filledOutline ? 8 : 0,
    },
  ];
  if (filledOutline) p.layers[0].keys[0].shapes.push({
    ...line('separate-fill', 335, 200, 35, 35), kind: 'rectangle', points: [],
    fillEnabled: true, fill: '#00cc00', strokeWidth: 0,
  });
  if (group)
    p.layers[0].keys[0].shapes.push(
      { ...line('g1', 260, 220, 60, 0), groups: ['g'] },
      { ...line('g2', 320, 220, 0, 30), groups: ['g'] },
    );
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
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const screen = async (q: { x: number; y: number }) => {
    const r = (await canvas.boundingBox())!;
    return { x: r.x + r.width / 2 + q.x - 200, y: r.y + r.height / 2 + q.y - 140 };
  };
  async function double(q = { x: 110, y: curve ? 40 : 70 }) {
    const p = await screen(q);
    await page.mouse.dblclick(p.x, p.y);
  }
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const idle = () => expect(page.locator('button.publish')).toBeEnabled();
  return { p, canvas, screen, double, read, idle };
}
test('Shift-click toggles a filled outline beneath its handles while Shift-drag still scales it', async ({ page }) => {
  const f = await setup(page, 'object', false, false, false, true);
  const shapeX = page.getByLabel('Shape X', { exact: true });
  const fill = await f.screen({ x: 252, y: 110 });
  const pivot = await f.screen({ x: 270, y: 120 });
  const corner = await f.screen({ x: 305, y: 180 });
  await page.mouse.click(fill.x, fill.y);
  await expect(shapeX).toHaveValue('235');
  await page.keyboard.down('Shift');
  await page.mouse.click(pivot.x, pivot.y);
  await page.keyboard.up('Shift');
  await expect(shapeX).toHaveCount(0);
  await page.mouse.click(fill.x, fill.y);
  await expect(shapeX).toHaveValue('235');
  await page.keyboard.down('Shift');
  await page.mouse.click(corner.x, corner.y);
  await page.keyboard.up('Shift');
  await expect(shapeX).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);

  await page.mouse.click(fill.x, fill.y);
  await page.keyboard.down('Shift');
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 15, pivot.y + 10);
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(shapeX).toHaveValue('235');
  expect(await f.read()).toEqual(f.p);

  await page.keyboard.down('Shift');
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 35, corner.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => {
    const fill = (await f.read()).layers[0].keys[0].shapes.find(s => s.id === 'fill-bridge')!;
    const corner = worldPoint(fill, { x: 70, y: 120 });
    return [Math.round(corner.x), Math.round(corner.y)];
  }).toEqual([340, 240]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('double-click starts connected paint selection at the clicked fill in a mixed selection', async ({ page }) => {
  const f = await setup(page, 'merge', false, false, false, true);
  const separate = await f.screen({ x: 350, y: 215 });
  const fill = await f.screen({ x: 252, y: 102 });
  await page.mouse.click(separate.x, separate.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(fill.x, fill.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  await f.double({ x: 252, y: 102 });
  await expect(page.getByText(/Selected [2-9] connected paint pieces/, { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.press('Delete');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toHaveLength(1);
  const [island] = (await f.read()).layers[0].keys[0].shapes;
  expect(island).toMatchObject({ fill: '#00cc00', strokeWidth: 0 });
  expect(island.contours?.flat().map(point => worldPoint(island, point))).toEqual([
    { x: 335, y: 200 }, { x: 370, y: 200 }, { x: 370, y: 235 }, { x: 335, y: 235 },
  ]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Escape cancels connected fill selection and leaves a new pick intact', async ({ page }) => {
  const f = await setup(page, 'merge', true, false, false, true);
  const fill = { x: 252, y: 102 };
  await f.double(fill);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Connected paint selection cancelled.', { exact: true })).toBeVisible();
  const island = await f.screen({ x: 348, y: 210 });
  await page.mouse.click(island.x, island.y);
  await releaseGeometry(page);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('335');
  expect(await f.read()).toEqual(f.p);
  await f.double(fill);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect(page.getByText(/Selected [2-9] connected paint pieces/, { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});

for (const mode of ['object', 'merge'] as const)
  test(`${mode}: double-click a line centre selects every attached colored line without fills, islands or artwork history`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.double();
    await expect(page.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
    await f.idle();
    expect(await f.read()).toEqual(f.p);
    await f.canvas.focus();
    await page.keyboard.press('Delete');
    await f.idle();
    const remaining = (await f.read()).layers[0].keys[0].shapes;
    const strokes = remaining.filter((s) => s.strokeWidth > 0),
      points = strokes.flatMap((s) => (s.nodes ?? s.points).map((p) => worldPoint(s, p)));
    expect(strokes.length).toBeGreaterThan(0);
    expect(Math.min(...points.map((p) => p.x))).toBe(300);
    expect(Math.max(...points.map((p) => p.x))).toBe(360);
    expect(points.every((p) => p.y === 70)).toBe(true);
    expect(remaining.some((s) => s.fillEnabled !== false && s.fill === '#ff0000')).toBe(true);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
test('curved Pencil chains are selected without replacing their controls or stroke styles', async ({
  page,
}) => {
  const f = await setup(page, 'merge', false, true);
  await f.double();
  await expect(page.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.idle();
  const moved = await f.read();
  expect(
    moved.layers[0].keys[0].shapes.some((s) => s.kind === 'bezier' && s.nodes?.some((n) => n.out)),
  ).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('double-clicking inside an entered group selects its connected lines without selecting outer artwork', async ({
  page,
}) => {
  const f = await setup(page, 'object', false, false, true);
  await f.double({ x: 275, y: 220 });
  await expect(page.getByRole('button', { name: 'Exit group', exact: true })).toBeVisible();
  await f.double({ x: 290, y: 220 });
  await expect(page.getByText('Selected 2 connected lines', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
test('Escape cancels a pending connected-line request; late results cannot replace a newer pick and a fresh request succeeds', async ({
  page,
}) => {
  const f = await setup(page, 'object', true);
  await f.double();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Escape');
  await f.idle();
  const pick = await f.screen({ x: 310, y: 70 });
  await page.mouse.click(pick.x, pick.y);
  await releaseGeometry(page);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('300');
  expect(await f.read()).toEqual(f.p);
  await f.double();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect(page.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
test('worker failure retains source and supports an unreloaded selection retry', async ({
  page,
}) => {
  const f = await setup(page, 'object', true);
  await f.double();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await f.idle();
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(f.p);
  await f.double();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect(page.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
});
