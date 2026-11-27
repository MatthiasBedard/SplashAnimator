import { expect, test, type Page } from '@playwright/test';
import {
  newProject,
  type Project,
  type Vector,
  type BezierNode,
} from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { objectBounds } from '../../packages/geometry/src/layout';
import { mapPoint, matrix, inversePoint } from '../../packages/geometry/src/affine';
const nodes = (s: Vector) =>
  ((s.contours?.flat() ?? s.nodes ?? s.points) as BezierNode[]).map((n) => ({
    ...mapPoint(matrix(s), n),
    ...(n.in ? { in: mapPoint(matrix(s), n.in) } : {}),
    ...(n.out ? { out: mapPoint(matrix(s), n.out) } : {}),
  }));
const count = (s: Vector) => (s.contours?.flat() ?? s.nodes ?? s.points).length;
async function setup(
  page: Page,
  object: boolean | 'unmarked' = false,
  curved = false,
  options: {
    scope?: 'frame' | 'nested' | 'group';
    seam?: boolean;
    basis?: boolean;
    foreground?: boolean;
  } = {},
) {
  const p = newProject();
  p.width = 400;
  p.height = 240;
  const line: Vector = {
    id: 'line',
    kind: 'bezier',
    x: 40,
    y: 60,
    width: 200,
    height: 0,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 4,
    points: [],
    drawingMode: object === 'unmarked' ? undefined : object ? 'object' : 'merge',
    nodes: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
  };
  if (curved) {
    line.nodes![0].out = { x: 60, y: -30 };
    line.nodes![1].in = { x: 140, y: -30 };
  }
  const fill: Vector = {
    ...structuredClone(line),
    id: 'fill',
    kind: 'polygon',
    height: 100,
    fill: '#ff0000',
    fillEnabled: true,
    strokeWidth: 0,
    nodes: undefined,
    closed: true,
    fillRule: 'evenodd',
    contours: [
      [
        { x: 0, y: 0, ...(curved ? { out: { x: 60, y: -30 } } : {}) },
        { x: 200, y: 0, ...(curved ? { in: { x: 140, y: -30 } } : {}) },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
    ],
  };
  if (options.seam) {
    line.closed = true;
    line.height = 100;
    line.nodes = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
  }
  if (options.basis) {
    fill.transform = [2, 0.2, 0.3, 1];
    for (const ring of fill.contours!)
      for (const n of ring) {
        for (const role of ['in', 'out'] as const)
          if (n[role])
            n[role] = inversePoint(matrix(fill), { x: 40 + n[role]!.x, y: 60 + n[role]!.y });
        const q = inversePoint(matrix(fill), { x: 40 + n.x, y: 60 + n.y });
        n.x = q.x;
        n.y = q.y;
      }
  }
  if (options.scope === 'group') {
    fill.groups = ['outer'];
    line.groups = ['outer'];
  }
  p.symbols = [
    {
      id: 'art',
      name: 'Attached art',
      width: 400,
      height: 240,
      shapes: options.foreground ? [line, fill] : [fill, line],
    },
  ];
  if (options.scope === 'frame')
    p.symbols[0].timeline = {
      duration: 8,
      keys: [
        { frame: 4, shapes: structuredClone(p.symbols[0].shapes) },
        { frame: 7, shapes: [] },
      ],
    };
  if (options.scope === 'nested')
    p.symbols.push({
      id: 'parent',
      name: 'Parent',
      width: 400,
      height: 240,
      shapes: [symbolInstance(p.symbols[0], 0, 0)],
    });
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols.at(-1)!, 0, 0)];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  const host = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  if (options.scope === 'nested') {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
    await host
      .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
      .click();
  } else {
    await page
      .getByRole('option', { name: 'Library item Attached art', exact: true })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', {
        name: options.scope === 'frame' ? 'Edit timeline' : 'Edit',
        exact: true,
      })
      .click();
    if (options.scope === 'frame') {
      await timeline.getByLabel('Symbol frame', { exact: true }).fill('5');
      await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
      await timeline
        .getByRole('button', { name: 'Edit symbol frame artwork', exact: true })
        .click();
    }
  }
  let editor = host;
  await host.getByLabel('Symbol artwork item', { exact: true }).selectOption('line');
  if (options.scope === 'group') {
    await host.getByRole('button', { name: 'Edit symbol group in isolation', exact: true }).click();
    editor = page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true });
    await editor.getByLabel('Symbol artwork item', { exact: true }).selectOption('line');
  }
  await editor.getByLabel('Symbol canvas tool', { exact: true }).selectOption('nodes');
  const canvas = editor.getByLabel('Symbol artwork preview', { exact: true }),
    bounds = p.symbols[0].shapes.map(objectBounds),
    left = options.scope === 'nested' ? 0 : Math.min(0, ...bounds.map((b) => b.left)),
    top = options.scope === 'nested' ? 0 : Math.min(0, ...bounds.map((b) => b.top)),
    right = options.scope === 'nested' ? 400 : Math.max(400, ...bounds.map((b) => b.right)),
    bottom = options.scope === 'nested' ? 240 : Math.max(240, ...bounds.map((b) => b.bottom)),
    scale = Math.min(500 / (right - left), 290 / (bottom - top));
  const pos = async (x: number, y: number) => {
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + (x - left) * scale) * b.width) / 540,
      y: b.y + ((20 + (y - top) * scale) * b.height) / 330,
    };
  };
  const drag = async (
    x: number,
    y: number,
    dx: number,
    dy: number,
    cancel: boolean | 'return' = false,
    during?: () => Promise<void>,
  ) => {
    const a = await pos(x, y),
      b = (await canvas.boundingBox())!;
    await canvas.evaluate((n: HTMLCanvasElement) => {
      n.addEventListener(
        'pointerdown',
        (e) => {
          n.dataset.pick = JSON.stringify([e.clientX, e.clientY]);
        },
        { once: true },
      );
      n.addEventListener(
        'pointerup',
        (e) => {
          n.dataset.drop = JSON.stringify([e.clientX, e.clientY]);
        },
        { once: true },
      );
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + (dx * scale * b.width) / 540, a.y + (dy * scale * b.height) / 330, {
      steps: 5,
    });
    if (during) await during();
    if (cancel === true) await page.keyboard.press('Escape');
    if (cancel === 'return') await page.mouse.move(a.x, a.y, { steps: 5 });
    await page.mouse.up();
    const delivered = await canvas.evaluate((n: HTMLCanvasElement) => ({
      start: JSON.parse(n.dataset.pick!),
      end: JSON.parse(n.dataset.drop ?? n.dataset.pick!),
    }));
    return {
      dx: ((delivered.end[0] - delivered.start[0]) * 540) / b.width / scale,
      dy: ((delivered.end[1] - delivered.start[1]) * 330) / b.height / scale,
    };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const apply = async () => {
    await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect(editor).toHaveCount(0);
    if (options.scope === 'group')
      await host.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    if (options.scope === 'frame')
      await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    expect(errors).toEqual([]);
  };
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n: HTMLCanvasElement, p) =>
        Array.from(n.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x: 20 + (x - left) * scale, y: 20 + (y - top) * scale },
    );
  return { p, editor, canvas, drag, read, apply, pixel };
}
test('symbol anchor drag and keyboard nudge carry original merged fill corners with one document history edit', async ({
  page,
}) => {
  const f = await setup(page);
  const delta = await f.drag(40, 60, 10, -10);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(f.editor.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('line');
  expect(await f.read()).toEqual(f.p);
  await f.apply();
  const out = await f.read(),
    shapes = out.symbols![0].shapes;
  for (const shape of shapes) {
    expect(nodes(shape)[0].x).toBeCloseTo(41 + delta.dx, 9);
    expect(nodes(shape)[0].y).toBeCloseTo(60 + delta.dy, 9);
  }
  expect(shapes.map(count)).toEqual(f.p.symbols![0].shapes.map(count));
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('symbol edge bending previews attached paint, retains anchor counts and local Undo Redo', async ({
  page,
}) => {
  const f = await setup(page);
  await expect.poll(() => f.pixel(140, 45)).toEqual([255, 255, 255, 255]);
  await f.drag(140, 60, 0, -30, false, async () => {
    await expect.poll(() => f.pixel(140, 45)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
  });
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect.poll(() => f.pixel(140, 45)).toEqual([255, 255, 255, 255]);
  await f.editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.apply();
  const out = await f.read(),
    [paint, line] = out.symbols![0].shapes;
  expect(nodes(line)[0].out).toBeDefined();
  expect(nodes(paint)[0].out).toEqual(nodes(line)[0].out);
  expect(nodes(paint)[1].in).toEqual(nodes(line)[1].in);
  expect(out.symbols![0].shapes.map(count)).toEqual([4, 2]);
  expect(line.fillEnabled).toBe(false);
  expect(line.strokeWidth).toBe(4);
});
test('symbol tangent movement carries exact attached cubic handles without new anchors', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await f.drag(100, 30, 0, -25, false, async () => {
    await expect.poll(() => f.pixel(140, 32)).toEqual([255, 0, 0, 255]);
  });
  await f.apply();
  const out = await f.read(),
    [paint, line] = out.symbols![0].shapes;
  expect(nodes(line)[0].out).toBeDefined();
  expect(nodes(paint)[0].out).toEqual(nodes(line)[0].out);
  expect(nodes(paint)[1].in).toEqual(nodes(line)[1].in);
  expect(out.symbols![0].shapes.map(count)).toEqual([4, 2]);
});
for (const mode of [true, 'unmarked'] as const)
  test(`symbol independent ${mode} paint stays independent during edge bending`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.drag(140, 60, 0, -30);
    await f.apply();
    const out = await f.read();
    expect(out.symbols![0].shapes[0]).toEqual(f.p.symbols![0].shapes[0]);
    expect(out.symbols![0].shapes[1]).not.toEqual(f.p.symbols![0].shapes[1]);
  });
test('symbol cancellation and exact pointer return restore both objects without local history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(140, 60, 0, -30, true);
  await f.drag(140, 60, 0, -30, 'return');
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.apply();
  expect(await f.read()).toEqual(f.p);
});
test('merged closed symbol seams keep both duplicate endpoints and the fill corner together', async ({
  page,
}) => {
  const f = await setup(page, false, false, { seam: true }),
    delta = await f.drag(40, 60, 10, -10);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.apply();
  const out = await f.read(),
    [paint, line] = out.symbols![0].shapes;
  expect(nodes(line)[0]).toEqual(nodes(line).at(-1));
  expect(nodes(paint)[0].x).toBeCloseTo(41 + delta.dx, 9);
  expect(nodes(paint)[0].y).toBeCloseTo(60 + delta.dy, 9);
  expect(out.symbols![0].shapes.map(count)).toEqual([4, 5]);
});
test('a differently based attached fill retains its own matrix and follows the moved curve', async ({
  page,
}) => {
  const f = await setup(page, false, false, { basis: true });
  await f.drag(140, 60, 0, -30);
  await f.apply();
  const [paint, line] = (await f.read()).symbols![0].shapes;
  expect(paint.transform).toEqual(f.p.symbols![0].shapes[0].transform);
  for (const role of ['out', 'in'] as const) {
    const index = role === 'out' ? 0 : 1;
    expect(nodes(paint)[index][role]!.x).toBeCloseTo(nodes(line)[index][role]!.x, 9);
    expect(nodes(paint)[index][role]!.y).toBeCloseTo(nodes(line)[index][role]!.y, 9);
  }
});
for (const scope of ['frame', 'nested', 'group'] as const)
  test(`${scope} symbol curve edits keep attached paint through enclosing Apply`, async ({
    page,
  }) => {
    const f = await setup(page, false, false, { scope });
    await f.drag(140, 60, 0, -30);
    await f.apply();
    const out = await f.read(),
      art = out.symbols![0],
      before = f.p.symbols![0],
      shapes = scope === 'frame' ? art.timeline!.keys[0].shapes : art.shapes;
    expect(shapes.map(count)).toEqual([4, 2]);
    expect(nodes(shapes[1])[0].out).toBeDefined();
    expect(nodes(shapes[0])[0].out).toEqual(nodes(shapes[1])[0].out);
    if (scope === 'frame') {
      expect(art.shapes).toEqual(before.shapes);
      expect(art.timeline!.keys[1]).toEqual(before.timeline!.keys[1]);
    }
    if (scope === 'nested') expect(out.symbols![1]).toEqual(f.p.symbols![1]);
    if (scope === 'group') expect(shapes.map((s) => s.groups)).toEqual([['outer'], ['outer']]);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
test('foreground paint owns edge pickup above the selected line', async ({ page }) => {
  const f = await setup(page, false, false, { foreground: true });
  await f.drag(140, 62, 0, -30);
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.apply();
  expect(await f.read()).toEqual(f.p);
});

test('cross-artwork anchor mode still follows an unselected attached fill', async ({ page }) => {
  const f = await setup(page);
  await f.editor.getByLabel('Select anchors across symbol artwork', { exact: true }).check();
  const delta = await f.drag(40, 60, 10, -10);
  await f.apply();
  const [paint, line] = (await f.read()).symbols![0].shapes;
  for (const shape of [paint, line]) {
    expect(nodes(shape)[0].x).toBeCloseTo(40 + delta.dx, 9);
    expect(nodes(shape)[0].y).toBeCloseTo(60 + delta.dy, 9);
  }
});
test('changed native view cancels an attached curve preview and releases pointer capture', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(140, 60, 0, -30, false, async () => {
    await f.canvas.evaluate((n: HTMLCanvasElement) => {
      n.style.width = '520px';
      n.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: n.getBoundingClientRect().x + 180,
          clientY: n.getBoundingClientRect().y + 80,
        }),
      );
    });
  });
  await expect(f.editor.getByRole('alert')).toContainText(/context changed/);
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => f.canvas.evaluate((n: HTMLCanvasElement) => n.hasPointerCapture(1)))
    .toBe(false);
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
});

for (const action of ['source', 'input'] as const)
  test(`late node ${action} after detached candidates and local history preparation cannot publish stale geometry`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.drag(140, 60, 0, -30, false, async () => {
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await page.evaluate((action) => {
        const native = JSON.stringify;
        let matching = 0;
        JSON.stringify = function (value: unknown, ...args: unknown[]) {
          const text = Reflect.apply(native, JSON, [value, ...args]);
          if (
            Array.isArray(value) &&
            value.some((s) => s?.id === 'line' && s.nodes?.[0]?.out) &&
            ++matching === 2
          ) {
            JSON.stringify = native;
            document.documentElement.dataset.nodeLate = 'yes';
            document.documentElement.dataset.nodeLateCapture = String(
              (
                document.querySelector(
                  'canvas[aria-label="Symbol artwork preview"]',
                ) as HTMLCanvasElement
              ).hasPointerCapture(1),
            );
            const input = document.querySelector(
              `input[aria-label="${action === 'source' ? 'Layer name' : 'Symbol artwork x'}"]`,
            ) as HTMLInputElement;
            input.value = action === 'source' ? 'Changed source' : '55';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return text;
        } as typeof JSON.stringify;
      }, action);
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.nodeLate))
      .toBe('yes');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.nodeLateCapture))
      .toBe('false');
    await expect(f.editor.getByRole('alert')).toContainText(/changed/);
    if (action === 'source') {
      const expected = structuredClone(f.p);
      expected.layers[0].name = 'Changed source';
      await expect.poll(f.read).toEqual(expected);
      await expect(
        f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeDisabled();
      await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    } else {
      await expect(f.editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('55');
      await f.apply();
      const expected = structuredClone(f.p);
      expected.symbols![0].shapes[1].x = 55;
      await expect.poll(f.read).toEqual(expected);
    }
  });

test('a selected fill remains attached while only a selected line tangent is moving', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await f.editor.getByLabel('Select anchors across symbol artwork', { exact: true }).check();
  await f.editor.getByRole('button', { name: 'Select all symbol anchors', exact: true }).click();
  await f.drag(100, 30, 0, -25, false, async () => {
    await expect.poll(() => f.pixel(140, 32)).toEqual([255, 0, 0, 255]);
  });
  await f.apply();
  const [paint, line] = (await f.read()).symbols![0].shapes;
  expect(nodes(line)[0].out).toBeDefined();
  expect(nodes(paint)[0].out).toEqual(nodes(line)[0].out);
});
