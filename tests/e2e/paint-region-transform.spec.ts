import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
const red = [255, 0, 0, 255],
  black = [0, 0, 0, 255],
  blue = [0, 0, 255, 255],
  white = [255, 255, 255, 255];
async function setup(page: Page, held = false, lasso = false, mode = 'merge') {
  if (held) await holdGeometry(page);
  const p = newProject();
  p.width = 300;
  p.height = 240;
  p.layers[0].drawingMode = mode === 'object' ? 'object' : 'merge';
  const r: Vector = {
    id: 'paint',
    kind: 'rectangle',
    x: 40,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys[0].shapes = [
    r,
    {
      ...r,
      id: 'line',
      kind: 'line',
      x: 20,
      y: 80,
      width: 200,
      height: 0,
      fillEnabled: false,
      strokeWidth: 4,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    },
    {
      ...r,
      id: 'line-two',
      kind: 'line',
      x: 20,
      y: 95,
      width: 200,
      height: 0,
      fillEnabled: false,
      strokeWidth: 2,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    },
    { ...r, id: 'outside', x: 210, y: 150, width: 50, height: 40, fill: '#0000ff' },
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
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const screen = (pnt: { x: number; y: number }) =>
    canvas.evaluate(
      (n, { p, pnt }) => {
        const c = n as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          w = c.width / devicePixelRatio,
          h = c.height / devicePixelRatio;
        return {
          x: r.x + (((w - p.width) / 2 + pnt.x) * r.width) / w,
          y: r.y + (((h - p.height) / 2 + pnt.y) * r.height) / h,
        };
      },
      { p, pnt },
    );
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n, { p, x, y }) => {
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
      { p, x, y },
    );
  const drag = async (
    a: { x: number; y: number },
    b: { x: number; y: number },
    shift = false,
    release = true,
  ) => {
    const aa = await screen(a),
      bb = await screen(b);
    await page.mouse.move(aa.x, aa.y);
    await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(bb.x, bb.y, { steps: 3 });
    if (release) {
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
    }
  };
  if (lasso) {
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await page.getByLabel('Lasso mode').selectOption('polygon');
    if (mode === 'merge') await page.getByLabel('Partial paint region').check();
    for (const [x, y] of mode === 'object'
      ? [
          [10, 30],
          [230, 30],
          [230, 140],
          [10, 140],
        ]
      : [
          [80, 40],
          [180, 40],
          [180, 110],
          [80, 110],
        ]) {
      const q = await screen({ x, y });
      await page.mouse.click(q.x, q.y);
    }
    await canvas.focus();
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await drag({ x: 80, y: 40 }, { x: 180, y: 110 });
  }
  if (held) {
    await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
    await releaseGeometry(page);
  }
  if (mode === 'merge')
    await expect(
      page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
    ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  return { p, canvas, read, screen, pixel, drag };
}
async function finish(page: Page, read: () => Promise<Project>, before: Project, held = false) {
  await expect
    .poll(
      async () => {
        if (held) await releaseGeometry(page);
        return JSON.stringify(await read()) !== JSON.stringify(before);
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
}
for (const operation of ['scale', 'rotate', 'skew'])
  test(`mixed partial lines and fill expose one working ${operation} cage and retain it after publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    expect(await f.read()).toEqual(f.p);
    if (operation === 'scale') await f.drag({ x: 180, y: 110 }, { x: 220, y: 145 });
    else if (operation === 'rotate') await f.drag({ x: 192, y: 38 }, { x: 172, y: 142 }, true);
    else await f.drag({ x: 110, y: 50 }, { x: 140, y: 50 });
    await finish(page, f.read, f.p);
    await expect.poll(() => f.pixel(50, 70)).toEqual(red);
    await expect.poll(() => f.pixel(230, 170)).toEqual(blue);
    await expect.poll(() => f.pixel(200, 80)).toEqual(black);
    await expect
      .poll(() =>
        operation === 'scale'
          ? f.pixel(175, 70)
          : operation === 'rotate'
            ? f.pixel(145, 35)
            : f.pixel(170, 60),
      )
      .toEqual(red);
    if (operation === 'rotate') await expect.poll(() => f.pixel(130, 35)).toEqual(black);
    if (operation === 'scale') await expect.poll(() => f.pixel(200, 97)).toEqual(black);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    const q = await f.read();
    if (operation === 'scale')
      await page.screenshot({ path: test.info().outputPath('mixed-paint-transform.png') });
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });

test('partial Lasso selections share transform modes and numeric modification controls', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate and skew selection', exact: true }).click();
  await expect(page.getByLabel('Selection transform mode')).toHaveValue('rotate-skew');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Transform rotation', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  await finish(page, f.read, f.p);
  await expect.poll(() => f.pixel(145, 35)).toEqual(red);
  await expect.poll(() => f.pixel(130, 35)).toEqual(black);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
});

test('custom partial-selection pivot is view-only and the rotated cage can immediately be resized again', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag({ x: 132, y: 81 }, { x: 152, y: 101 });
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Transform rotation', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  await finish(page, f.read, f.p);
  // Original north-east handle rotated about the explicitly moved (150,100) pivot.
  const c = Math.SQRT1_2,
    corner = { x: 150 + c * 30 + c * 50, y: 100 + c * 30 - c * 50 },
    point = await f.screen(corner);
  await page.mouse.move(point.x, point.y);
  await expect(f.canvas).toHaveCSS('cursor', /resize/);
  const before = await f.read();
  await f.drag(corner, { x: corner.x + 20, y: corner.y - 10 });
  await finish(page, f.read, before);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
});

test('affine drag previews paint before dispatching clipping on release', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.drag({ x: 192, y: 38 }, { x: 172, y: 142 }, true, false);
  await expect.poll(() => f.pixel(145, 35)).toEqual(red);
  await expect.poll(() => f.pixel(50, 70)).toEqual(red);
  expect(await f.read()).toEqual(f.p);
  expect(await pendingGeometry(page)).toBe(0);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await expect.poll(() => f.pixel(145, 35)).toEqual(red);
  expect(await f.read()).toEqual(f.p);
  await finish(page, f.read, f.p, true);
  await expect.poll(() => f.pixel(145, 35)).toEqual(red);
  await expect.poll(() => f.pixel(230, 170)).toEqual(blue);
});

test('Escape and native capture loss restore a mixed paint selection without document changes', async ({
  page,
}) => {
  const f = await setup(page, true);
  for (const cancel of ['escape', 'capture']) {
    await f.drag({ x: 192, y: 38 }, { x: 172, y: 142 }, true, false);
    if (cancel === 'escape') await page.keyboard.press('Escape');
    else await f.canvas.evaluate((n) => (n as HTMLElement).releasePointerCapture(1));
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await f.read()).toEqual(f.p);
    await expect.poll(() => f.pixel(145, 35)).toEqual(white);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    expect(await pendingGeometry(page)).toBe(0);
  }
});

test('worker failure restores the original paint and handles, and a fresh transform retry succeeds', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.drag({ x: 180, y: 110 }, { x: 220, y: 145 });
  await releaseGeometry(page, true);
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(175, 70)).toEqual(white);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  await f.drag({ x: 180, y: 110 }, { x: 220, y: 145 });
  await finish(page, f.read, f.p, true);
  await expect.poll(() => f.pixel(175, 70)).toEqual(red);
});

test('click, return and a view change preserve the mixed selection and original document', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.drag({ x: 180, y: 110 }, { x: 180, y: 110 });
  expect(await f.read()).toEqual(f.p);
  await f.drag({ x: 180, y: 110 }, { x: 220, y: 145 }, false, false);
  const start = await f.screen({ x: 180, y: 110 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.up();
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.p);
  await f.drag({ x: 180, y: 110 }, { x: 220, y: 145 }, false, false);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
  await page.mouse.up();
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
});

test('whole-object Lasso selections also show and operate the common transform handles', async ({
  page,
}) => {
  const f = await setup(page, false, true, 'object');
  const corner = await f.screen({ x: 220, y: 130 });
  await page.mouse.move(corner.x, corner.y);
  await expect(f.canvas).toHaveCSS('cursor', /resize/);
  await f.drag({ x: 220, y: 130 }, { x: 260, y: 150 });
  await finish(page, f.read, f.p);
  const q = await f.read();
  expect(q.layers[0].keys[0].shapes.find((s) => s.id === 'outside')).toEqual(
    f.p.layers[0].keys[0].shapes.find((s) => s.id === 'outside'),
  );
  await expect.poll(() => f.pixel(180, 140)).toEqual(red);
  await expect.poll(() => f.pixel(230, 170)).toEqual(blue);
});
