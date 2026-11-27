import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { worldPoint, mapPoint, matrix } from '../../packages/geometry/src';
import { selectionTransformFrame, framePoint } from '../../apps/editor/src/selection-transform';
const rect = (id = 'a'): Vector => ({
  id,
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
});
async function setup(page: Page, kind = 'plain') {
  const p = newProject();
  p.width = 300;
  p.height = 240;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [rect()];
  if (kind === 'group')
    p.layers[0].keys[0].shapes = [
      { ...rect(), groups: ['g'] },
      { ...rect('b'), x: 185, y: 70, width: 40, height: 30, groups: ['g'] },
    ];
  if (kind === 'merge') p.layers[0].drawingMode = 'merge';
  if (kind === 'affine' || kind === 'reflected') {
    p.layers[0].keys[0].shapes[0].rotation = 18;
    p.layers[0].keys[0].shapes[0].transform = [kind === 'reflected' ? -1.1 : 1.1, 0.2, 0.4, 0.9];
  }
  if (kind === 'compound') {
    Object.assign(p.layers[0].keys[0].shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 80 },
          { x: 0, y: 80 },
        ],
        [
          { x: 40, y: 20 },
          { x: 40, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 20 },
        ],
      ],
    });
  }
  if (kind === 'control-bounds') {
    Object.assign(p.layers[0].keys[0].shapes[0], {
      kind: 'polygon', fillRule: 'evenodd', controlBounds: true,
      contours: [[{x:40,y:20}, {x:160,y:20}, {x:160,y:100}, {x:40,y:100}]],
    });
  }
  if (kind === 'graphic') {
    p.symbols = [
      {
        id: 'def',
        name: 'Graphic',
        width: 120,
        height: 80,
        shapes: [{ ...rect('leaf'), x: 0, y: 0 }],
      },
    ];
    Object.assign(p.layers[0].keys[0].shapes[0], { kind: 'symbol', symbolId: 'def' });
  }
  if (kind === 'live') {
    p.duration = 6;
    p.layers[0].keys.push({ frame: 4, shapes: [{ ...rect(), x: 180 }] });
    Object.assign(
      p,
      prepareTimelineTween(p, p.layers[0].id, {
        start: 0,
        end: 4,
        kind: 'motion',
        affine: false,
        createEndpoints: false,
        ease: 'linear',
      }),
    );
  }
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const screen = async (pnt: { x: number; y: number }) =>
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
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }, shift = false) => {
    const start = await screen(a),
      end = await screen(b);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  return { p, canvas, read, screen, drag };
}
const turn = (p: { x: number; y: number }, c: { x: number; y: number }, a: number) => ({
  x: c.x + Math.cos(a) * (p.x - c.x) - Math.sin(a) * (p.y - c.y),
  y: c.y + Math.sin(a) * (p.x - c.x) + Math.cos(a) * (p.y - c.y),
});

test('selection handles scale the signed control box without rewriting its stored path', async ({page}) => {
  const { p, canvas, read, drag } = await setup(page, 'control-bounds');
  const original = p.layers[0].keys[0].shapes[0];
  await drag({x:200,y:150}, {x:230,y:170});
  const shape = (await read()).layers[0].keys[0].shapes[0];
  expect(shape.controlBounds).toBe(true);
  expect(shape.contours).toEqual(original.contours);
  const first = worldPoint(shape, original.contours![0][0]);
  const opposite = worldPoint(shape, original.contours![0][2]);
  expect(first.x).toBeCloseTo(80, 1);
  expect(first.y).toBeCloseTo(70, 1);
  expect(opposite.x).toBeCloseTo(230, 0);
  expect(opposite.y).toBeCloseTo(170, 0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await canvas.press('Control+Shift+z');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes[0]).toEqual(shape);
});

test('configured Shift skew constrains a reflected cage and shows its angle before release', async ({ page }) => {
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (this.fillStyle === '#ed428b' && text.endsWith('°')) this.canvas.dataset.angleCue = text;
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
  });
  const f = await setup(page, 'reflected'), source = f.p.layers[0].keys[0].shapes[0];
  const frame = selectionTransformFrame([source])!, top = framePoint(frame, 'n');
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  await page.getByLabel('Angle increment', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await view.click();
  await page.getByLabel('Selection transform mode', { exact: true }).selectOption('rotate-skew');
  const middle = source.width / 2, delta = source.height * 1.18;
  const start = await f.screen(top);
  const end = await f.screen(worldPoint(source, { x: middle + delta, y: 0 }));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(end.x, end.y);
  await expect(f.canvas).toHaveAttribute('data-angle-cue', '-60°');
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(f.read).not.toEqual(f.p);
  const after = await f.read(), art = after.layers[0].keys[0].shapes[0];
  const fixed = worldPoint(art, { x: middle, y: source.height });
  const original = framePoint(frame, 's');
  const moved = worldPoint(art, { x: middle, y: 0 });
  const expected = worldPoint(source, { x: middle + source.height * Math.sqrt(3), y: 0 });
  for (const axis of ['x', 'y'] as const) {
    expect(fixed[axis]).toBeCloseTo(original[axis], 9);
    expect(moved[axis]).toBeCloseTo(expected[axis], 9);
  }
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(after);
});

for (const [name, start] of Object.entries({
  nw: { x: 28, y: 38 },
  ne: { x: 172, y: 38 },
  se: { x: 172, y: 142 },
  sw: { x: 28, y: 142 },
}))
  test(`outside ${name} rotation uses the original pivot, follows the cage and retains selection/history`, async ({
    page,
  }) => {
    const f = await setup(page),
      center = { x: 100, y: 90 },
      end = turn(start, center, Math.PI / 2),
      s = await f.screen(start);
    await page.mouse.move(s.x, s.y);
    await expect(f.canvas).toHaveCSS('cursor', /data:image\/svg/);
    await f.drag(start, end, true);
    const q = await f.read(),
      art = q.layers[0].keys[0].shapes[0];
    const expected = turn({ x: 40, y: 50 }, center, Math.PI / 2);
    expect(art.x).toBeCloseTo(expected.x, 6);
    expect(art.y).toBeCloseTo(expected.y, 6);
    expect(art.transform![0]).toBeCloseTo(0, 6);
    expect(art.transform![1]).toBeCloseTo(1, 6);
    await expect
      .poll(() =>
        f.canvas.evaluate((n, p) => {
          const c = n as HTMLCanvasElement,
            d = devicePixelRatio;
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.round(c.width / 2 + (80 - p.width / 2) * d),
                Math.round(c.height / 2 + (40 - p.height / 2) * d),
                1,
                1,
              ).data,
          );
        }, f.p),
      )
      .toEqual([255, 0, 0, 255]);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    const corner = await f.screen(worldPoint(art, { x: 0, y: 0 }));
    await page.mouse.move(corner.x, corner.y);
    await expect(f.canvas).toHaveCSS('cursor', /resize/);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });
for (const [edge, start, end, anchor] of [
  ['top', { x: 70, y: 50 }, { x: 100, y: 50 }, { x: 40, y: 130 }],
  ['bottom', { x: 130, y: 130 }, { x: 160, y: 130 }, { x: 40, y: 50 }],
  ['left', { x: 40, y: 70 }, { x: 40, y: 95 }, { x: 160, y: 50 }],
  ['right', { x: 160, y: 110 }, { x: 160, y: 135 }, { x: 40, y: 50 }],
] as const)
  test(`the ${edge} outline skews directly with its opposite edge fixed`, async ({ page }) => {
    const f = await setup(page);
    await f.drag(start, end);
    const art = (await f.read()).layers[0].keys[0].shapes[0];
    const a = mapPoint(matrix(art), { x: anchor.x - 40, y: anchor.y - 50 });
    expect(a.x).toBeCloseTo(anchor.x, 6);
    expect(a.y).toBeCloseTo(anchor.y, 6);
    const picked = mapPoint(matrix(art), { x: start.x - 40, y: start.y - 50 });
    expect(picked.x).toBeCloseTo(end.x, 6);
    expect(picked.y).toBeCloseTo(end.y, 6);
    expect(art.width).toBe(120);
    expect(art.height).toBe(80);
    await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
test('Rotate and skew mode is view-only, uses corner/side handles directly and remains available in Edit', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate and skew selection', exact: true }).click();
  await expect(page.getByLabel('Selection transform mode')).toHaveValue('rotate-skew');
  expect(await f.read()).toEqual(f.p);
  const start = { x: 160, y: 50 };
  await f.drag(start, turn(start, { x: 100, y: 90 }, Math.PI / 2), true);
  const art = (await f.read()).layers[0].keys[0].shapes[0];
  expect(art.transform![1]).toBeCloseTo(1);
  const n = worldPoint(art, { x: 60, y: 0 }),
    end = { x: n.x, y: n.y + 25 };
  await f.drag(n, end);
  expect((await f.read()).layers[0].keys[0].shapes[0].transform).not.toEqual(art.transform);
  await f.canvas.focus();
  await page.keyboard.press('q');
  await expect(page.getByLabel('Selection transform mode')).toHaveValue('free');
});
for (const kind of ['group', 'affine', 'reflected', 'css', 'compound', 'graphic'])
  test(`native ${kind} rotation retains original geometry and independent pointer mapping`, async ({
    page,
  }) => {
    const f = await setup(page, kind);
    if (kind === 'css')
      await f.canvas.evaluate((n) => {
        (n as HTMLElement).style.width = '600px';
        (n as HTMLElement).style.height = '350px';
      });
    const originals = f.p.layers[0].keys[0].shapes,
      frame = selectionTransformFrame(originals)!,
      c = framePoint(frame, ''),
      corner = framePoint(frame, 'ne'),
      start = { x: corner.x + (corner.x - c.x) * 0.18, y: corner.y + (corner.y - c.y) * 0.18 };
    await f.drag(start, turn(start, c, Math.PI / 4), true);
    const q = await f.read();
    if(kind==='affine')await page.screenshot({path:'test-results/free-transform-affine.png'});
    for (const [i, s] of q.layers[0].keys[0].shapes.entries()) {
      const expected = turn(worldPoint(originals[i], { x: 0, y: 0 }), c, Math.PI / 4),
        actual = worldPoint(s, { x: 0, y: 0 });
      expect(actual.x).toBeCloseTo(expected.x, 5);
      expect(actual.y).toBeCloseTo(expected.y, 5);
      expect(s.width).toBe(originals[i].width);
      expect(s.points).toEqual(originals[i].points);
    }
  });
test('custom pivot dragging preserves offsets, Alt rotates about the opposite corner, and double-click recenters', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag({ x: 102, y: 91 }, { x: 122, y: 111 });
  let q = await f.read();
  const art = q.layers[0].keys[0].shapes[0];
  expect(worldPoint(art, art.pivot!)).toEqual({ x: 120, y: 110 });
  expect(art.x).toBe(40);
  const point = await f.screen({ x: 120, y: 110 });
  await page.mouse.dblclick(point.x, point.y);
  q = await f.read();
  expect(q.layers[0].keys[0].shapes[0].pivot).toBeUndefined();
  await page.keyboard.down('Alt');
  const start = { x: 172, y: 38 },
    opposite = { x: 40, y: 130 };
  await f.drag(start, turn(start, opposite, Math.PI / 2), true);
  await page.keyboard.up('Alt');
  const moved = (await f.read()).layers[0].keys[0].shapes[0],
    fixed = worldPoint(moved, { x: 0, y: 80 });
  expect(fixed.x).toBeCloseTo(opposite.x, 6);
  expect(fixed.y).toBeCloseTo(opposite.y, 6);
});
test('click/return/Escape/native capture loss and view changes cannot publish partial rotation', async ({
  page,
}) => {
  const f = await setup(page),
    a = await f.screen({ x: 172, y: 38 }),
    b = await f.screen({ x: 152, y: 162 });
  await page.mouse.click(a.x, a.y);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  for (const action of ['escape', 'capture', 'view', 'blur']) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'capture')
      await f.canvas.evaluate((c) => (c as HTMLElement).releasePointerCapture(1));
    else if (action === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('0.5');
    await page.mouse.up();
    expect(await f.read(), action).toEqual(f.p);
    if (action === 'view')
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  }
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const moved = (await f.read()).layers[0].keys[0].shapes[0];
  expect(moved.x).toBe(41);
  expect(moved.transform).toBeUndefined();
});

test('existing scale handles, top rotation knob and Ctrl-side skew remain available', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag({ x: 160, y: 130 }, { x: 220, y: 170 });
  let art = (await f.read()).layers[0].keys[0].shapes[0];
  expect(art.transform![0]).toBeCloseTo(1.5);
  expect(art.transform![3]).toBeCloseTo(1.5);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await f.drag({ x: 100, y: 26 }, { x: 164, y: 90 }, true);
  art = (await f.read()).layers[0].keys[0].shapes[0];
  expect(art.transform![1]).toBeCloseTo(1);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await page.keyboard.down('Control');
  await f.drag({ x: 100, y: 50 }, { x: 130, y: 50 });
  await page.keyboard.up('Control');
  art = (await f.read()).layers[0].keys[0].shapes[0];
  expect(art.transform![2]).toBeCloseTo(-0.375);
});

test('Undo during an active transform cancels its draft before traversing document history', async ({
  page,
}) => {
  const f = await setup(page);
  await page.keyboard.press('ArrowRight');
  expect((await f.read()).layers[0].keys[0].shapes[0].x).toBe(41);
  const a = await f.screen({ x: 173, y: 38 }),
    b = await f.screen({ x: 153, y: 162 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Control+z');
  await page.mouse.up();
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  const q = await f.read();
  expect(q.layers[0].keys[0].shapes[0].x).toBe(41);
  expect(q.layers[0].keys[0].shapes[0].transform).toBeUndefined();
});

test('whole merged-paint selections use the same handles and retain selection after worker publication', async ({
  page,
}) => {
  const f = await setup(page, 'merge');
  await f.drag({ x: 172, y: 38 }, { x: 152, y: 162 }, true);
  await expect.poll(async () => JSON.stringify(await f.read()) === JSON.stringify(f.p)).toBe(false);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      f.canvas.evaluate((n, p) => {
        const c = n as HTMLCanvasElement,
          d = devicePixelRatio;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (80 - p.width / 2) * d),
              Math.round(c.height / 2 + (40 - p.height / 2) * d),
              1,
              1,
            ).data,
        );
      }, f.p),
    )
    .toEqual([255, 0, 0, 255]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+a');
  await f.drag({ x: 70, y: 50 }, { x: 100, y: 50 });
  await expect.poll(async () => JSON.stringify(await f.read()) === JSON.stringify(f.p)).toBe(false);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
});

test('an incompatible live endpoint rotation rejects before changing artwork or document history', async ({
  page,
}) => {
  const f = await setup(page, 'live');
  await f.drag({ x: 172, y: 38 }, { x: 152, y: 162 }, true);
  await expect(page.getByRole('alert')).toContainText(/affine|matrix|transform|motion/i);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByRole('button', { name: 'Apply transform', exact: true })).toBeVisible();
});
