import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector, type Point } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';

function fixture(mode: 'object' | 'merge' = 'object', paint = false) {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.duration = 4;
  p.layers[0].drawingMode = mode;
  const a: Vector = {
    id: 'a',
    kind: 'bezier',
    x: 50,
    y: 60,
    width: 180,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 4,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 20, y: 0 } },
      { x: 80, y: 30, in: { x: 60, y: 30 } },
      { x: 180, y: 0 },
    ],
  };
  const b: Vector = {
    ...structuredClone(a),
    id: 'b',
    x: 50,
    y: 150,
    transform: [1, 0.2, 0.2, 1],
    nodes: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 160, y: 0 },
    ],
  };
  if (paint)
    Object.assign(b, {
      kind: 'polygon',
      nodes: undefined,
      fillEnabled: true,
      fillRule: 'evenodd',
      strokeWidth: 0,
      transform: undefined,
      width: 160,
      height: 60,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 160, y: 60 },
          { x: 0, y: 60 },
        ],
        [
          { x: 40, y: 20 },
          { x: 60, y: 20 },
          { x: 60, y: 40 },
          { x: 40, y: 40 },
        ],
      ],
    });
  const primitive: Vector = {
    ...structuredClone(a),
    id: 'rect',
    kind: 'rectangle',
    x: 270,
    y: 180,
    width: 80,
    height: 60,
    nodes: undefined,
    fillEnabled: true,
    strokeWidth: 0,
  };
  const grouped: Vector = { ...structuredClone(a), id: 'protected', x: 260, y: 60, groups: ['g'] };
  p.layers[0].keys = [
    { frame: 0, shapes: mode === 'merge' ? [a, b, primitive] : [a, b, primitive, grouped] },
  ];
  return p;
}
async function setup(page: Page, p = fixture()) {
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
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = async () => {
      await expect(page.locator('button.publish')).toBeEnabled();
      return page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    };
  const screen = async (q: Point) => {
    const b = (await canvas.boundingBox())!;
    return { x: b.x + b.width / 2 + q.x - 200, y: b.y + b.height / 2 + q.y - 150 };
  };
  async function drag(a: Point, b: Point) {
    const x = await screen(a),
      y = await screen(b);
    await page.mouse.move(x.x, x.y);
    await page.mouse.down();
    await page.mouse.move(y.x, y.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('button.publish')).toBeEnabled();
  }
  async function click(p: Point) {
    const q = await screen(p);
    await page.mouse.click(q.x, q.y);
  }
  const pixel = (p: Point) =>
    canvas.evaluate(
      (c: HTMLCanvasElement, p) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (p.x - 200) * devicePixelRatio),
              Math.round(c.height / 2 + (p.y - 150) * devicePixelRatio),
              1,
              1,
            ).data,
        ),
      p,
    );
  return { p, canvas, read, screen, drag, click, pixel };
}
const nodes = (s: Vector) => s.contours?.flat() ?? s.nodes ?? s.points;
test('Subselection shows vertices and tangent handles without the regular object transform box', async ({
  page,
}) => {
  const f = await setup(page);
  await f.click({ x: 90, y: 75 });
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel({ x: 180, y: 60 })).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel({ x: 47, y: 60 })).not.toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
});
for (const mode of ['object', 'merge'] as const)
  test(`${mode}: box selection from no prior pick moves vertices across two affine paths and retains them after release`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(mode));
    await f.drag({ x: 35, y: 45 }, { x: 145, y: 178 });
    await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
    expect(await f.read()).toEqual(f.p);
    await f.drag({ x: 50, y: 60 }, { x: 70, y: 75 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
    const moved = await f.read();
    for (const original of f.p.layers[0].keys[0].shapes.slice(0, 2)) {
      for (const [i, node] of nodes(original).entries()) {
        const target = worldPoint(original, node),
          expected = { x: target.x + (i < 2 ? 20 : 0), y: target.y + (i < 2 ? 15 : 0) };
        const actual = moved.layers[0].keys[0].shapes.flatMap((s) =>
          nodes(s).map((n) => worldPoint(s, n)),
        );
        expect(
          Math.min(...actual.map((q) => Math.hypot(q.x - expected.x, q.y - expected.y))),
        ).toBeLessThan(0.01);
      }
    }
    await f.canvas.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await f.read();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(moved);
    await f.read();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
test('mixed brush paint contours and Pencil vertices share a box selection and survive merged edits', async ({
  page,
}) => {
  const f = await setup(page, fixture('merge', true));
  await f.drag({ x: 35, y: 45 }, { x: 145, y: 165 });
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  const next = await f.read();
  expect(next.layers[0].keys[0].shapes.some((s) => s.contours?.length === 2)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  await f.read();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(next);
});
test('primitive vertex selection is history-free and only the moved corner becomes editable geometry', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag({ x: 260, y: 170 }, { x: 290, y: 200 });
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const q = await f.read(),
    s = q.layers[0].keys[0].shapes.find((s) => s.id === 'rect')!;
  expect(s.kind).toBe('bezier');
  const actual = nodes(s).map((n) => worldPoint(s, n));
  expect(actual[0]).toEqual({ x: 271, y: 180 });
  expect(actual[1]).toEqual({ x: 350, y: 180 });
  expect(actual[2]).toEqual({ x: 350, y: 240 });
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await f.read();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('area modifiers and Escape preserve selected vertices without artwork history, and grouped artwork is protected', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag({ x: 35, y: 45 }, { x: 145, y: 178 });
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  await page.keyboard.down('Shift');
  await f.drag({ x: 200, y: 175 }, { x: 220, y: 190 });
  await page.keyboard.up('Shift');
  await expect(page.getByText('5 anchors selected', { exact: true })).toBeVisible();
  await page.keyboard.down('Alt');
  await f.drag({ x: 200, y: 175 }, { x: 220, y: 190 });
  await page.keyboard.up('Alt');
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  const a = await f.screen({ x: 250, y: 40 }),
    b = await f.screen({ x: 390, y: 120 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByText('4 anchors selected', { exact: true })).toBeVisible();
  await f.drag({ x: 250, y: 40 }, { x: 390, y: 120 });
  await expect(page.getByText('0 anchors selected', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});
