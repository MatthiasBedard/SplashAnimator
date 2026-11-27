import { test, expect } from '@playwright/test';
import { newProject, id, type Project, type Vector } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';

test('dissolve removes a smooth nonredundant stroke anchor and retains selection and history', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [{
    id: 'stroke', kind: 'bezier', x: 130, y: 120, width: 120, height: 24,
    rotation: 0, fill: '#000000', fillEnabled: false, stroke: '#ff0000', strokeWidth: 4,
    points: [], nodes: [
      { x: 0, y: 0, out: { x: 10, y: 15 } },
      { x: 60, y: 22.625, in: { x: 35, y: 22.625 }, out: { x: 85, y: 22.625 } },
      { x: 120, y: 0, in: { x: 110, y: 15 } },
    ],
  }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.press('Control+a');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 10, box.y + box.height / 2 + 2.625);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dissolve = page.getByRole('button', { name: 'Dissolve anchor', exact: true });
  await dissolve.click();
  const expected = structuredClone(p);
  expected.layers[0].keys[0].shapes[0].nodes = [
    { x: 0, y: 0, out: { x: 20, y: 30 } },
    { x: 120, y: 0, in: { x: 100, y: 30 } },
  ];
  await expect.poll(read).toEqual(expected);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue from endpoint', exact: true })).toBeEnabled();
  await dissolve.click();
  expect(await read()).toEqual(expected);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(expected);
});

test('dissolve removes a smooth closed contour seam and preserves the hole and selected neighbor', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [{
    id: 'fill', kind: 'polygon', x: 130, y: 170, width: 120, height: 103,
    rotation: 0, fill: '#ff0000', fillRule: 'evenodd', stroke: '#000000', strokeWidth: 0,
    points: [], contours: [[
      { x: 60, y: 22.625, in: { x: 35, y: 22.625 }, out: { x: 85, y: 22.625 } },
      { x: 120, y: 0, in: { x: 110, y: 15 } },
      { x: 120, y: -80 }, { x: 0, y: -80 }, { x: 0, y: 0, out: { x: 10, y: 15 } },
    ], [
      { x: 20, y: -60 }, { x: 40, y: -60 }, { x: 40, y: -35 }, { x: 20, y: -35 },
    ]],
  }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.press('Control+a');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 10, box.y + box.height / 2 + 52.625);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Dissolve anchor', exact: true }).click();
  const expected = structuredClone(p), ring = expected.layers[0].keys[0].shapes[0].contours![0];
  ring.shift();
  ring[0].in = { x: 100, y: 30 };
  ring[3].out = { x: 20, y: 30 };
  await expect.poll(read).toEqual(expected);
  await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
  const pixels = await stage.evaluate(n => {
    const c = n as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[160, 120], [180, 120]].map(([x, y]) => Array.from(ctx.getImageData(
      c.width / 2 + (x - 200) * devicePixelRatio,
      c.height / 2 + (y - 140) * devicePixelRatio, 1, 1).data));
  });
  expect(pixels).toEqual([[255, 255, 255, 255], [255, 0, 0, 255]]);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(expected);
});

test('path simplification preserves endpoints and undo while closed paths keep their seam', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [
    {
      id: id(),
      kind: 'path',
      x: 200,
      y: 150,
      width: 200,
      height: 4,
      rotation: 15,
      transform: [1, 0.1, 0.2, 1],
      fill: '#ff0000',
      fillEnabled: false,
      stroke: '#222222',
      strokeWidth: 4,
      points: Array.from({ length: 21 }, (_, i) => ({ x: i * 10, y: i % 2 ? 0.4 : 0 })),
    },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const stage = page.getByLabel('Drawing stage');
  await stage.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const before = await read();
  await page.getByLabel('Path simplification tolerance').fill('1');
  await page.getByRole('button', { name: 'Simplify path', exact: true }).click();
  const simplified = await read();
  expect(simplified.points.length).toBe(2);
  expect(worldPoint(simplified, simplified.points[0])).toEqual(
    worldPoint(before, before.points[0]),
  );
  const end = worldPoint(simplified, simplified.points[1]),
    old = worldPoint(before, before.points.at(-1)!);
  expect(end.x).toBeCloseTo(old.x);
  expect(end.y).toBeCloseTo(old.y);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Convert to editable path', exact: true }).click();
  await page.getByLabel('Closed path', { exact: true }).check();
  const closed = await read();
  await page.getByRole('button', { name: 'Smooth', exact: true }).click();
  let changed = await read();
  expect(changed.nodes![0].in).toBeDefined();
  expect(changed.nodes!.at(-1)!.out).toBeDefined();
  await page.getByRole('button', { name: 'Straighten', exact: true }).click();
  changed = await read();
  expect(changed.nodes!.length).toBe(closed.nodes!.length);
  expect(changed.closed).toBe(true);
  expect(changed.nodes!.every((n) => !n.in && !n.out)).toBe(true);
  await stage.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(closed);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const increment of [0, 30])
  test(`pen draft corrections preserve curves with angle increment ${increment} and one undo step`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Drawing mode').selectOption('object');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByLabel('Angle increment').selectOption(String(increment));
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    const stage = page.getByLabel('Drawing stage'),
      box = (await stage.boundingBox())!;
    const click = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
    const drag = async (x: number, y: number, dx: number, dy: number) => {
      await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + x + dx, box.y + y + dy);
      await page.mouse.up();
    };
    const read = () =>
      page.evaluate(
        () =>
          (
            JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as
              Project | undefined
          )?.layers[0].keys[0].shapes ?? [],
      );
    await page.keyboard.down('Shift');
    await drag(300, 200, 30, 40);
    await page.keyboard.up('Shift');
    await drag(450, 200, 20, 30);
    await click(450, 200); // Retract outgoing handle, without inserting a duplicate anchor.
    await click(600, 200);
    await page.keyboard.press('Backspace');
    await click(550, 300);
    expect(await read()).toEqual([]);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await read()).length).toBe(1);
    const committed = await read(),
      shape = committed[0],
      nodes = shape.nodes!;
    expect(nodes).toHaveLength(3);
    const first = worldPoint(shape, nodes[0]),
      handle = worldPoint(shape, nodes[0].out!);
    expect(handle.x - first.x).toBeCloseTo(
      50 * Math.cos(((increment ? 60 : 45) * Math.PI) / 180),
      6,
    );
    expect(handle.y - first.y).toBeCloseTo(
      50 * Math.sin(((increment ? 60 : 45) * Math.PI) / 180),
      6,
    );
    expect(nodes[1].out).toBeUndefined();
    expect(nodes[1].in!.x - nodes[1].x).toBeCloseTo(-20, 6);
    expect(nodes[1].in!.y - nodes[1].y).toBeCloseTo(-30, 6);
    expect(worldPoint(shape, nodes[2]).x - first.x).toBeCloseTo(250, 6);
    expect(worldPoint(shape, nodes[2]).y - first.y).toBeCloseTo(100, 6);
    await stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(committed);
    // Removing every draft anchor and cancelling another draft must leave artwork/history alone.
    await click(300, 350);
    await click(400, 350);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await click(300, 400);
    await click(400, 400);
    await page.keyboard.press('Escape');
    expect(await read()).toEqual(committed);
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(committed);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const mode of ['object', 'merge'] as const)
  test(`Alt-click inserts a compound curve anchor with undo in ${mode} mode`, async ({ page }) => {
    const project = newProject();
    project.layers[0].drawingMode = mode;
    const s: Project['layers'][number]['keys'][number]['shapes'][number] = {
      id: 'curve-hit',
      kind: 'polygon',
      fillRule: 'evenodd',
      x: 400,
      y: 200,
      width: 160,
      height: 140,
      rotation: 17,
      transform: [-1.2, 0.2, 0.3, 1],
      fill: '#446688',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      contours: [
        [
          { x: 0, y: 0, out: { x: 40, y: -80 } },
          { x: 160, y: 0, in: { x: 120, y: -80 } },
          { x: 160, y: 140 },
          { x: 0, y: 140 },
        ],
        [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
          { x: 100, y: 100 },
          { x: 60, y: 100 },
        ],
      ],
    };
    project.layers[0].keys[0].shapes = [s];
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const stage = page.getByLabel('Drawing stage'),
      box = (await stage.boundingBox())!;
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Subselection', exact: true }).click();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    const before = await read(),
      p = worldPoint(s, { x: 80, y: -60 });
    const marker = worldPoint(s, s.contours![0][1]);
    await expect
      .poll(() =>
        stage.evaluate(
          (c, p) => {
            const data = (c as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(p.x - 5, p.y - 5, 11, 11).data;
            let purple = 0;
            for (let i = 0; i < data.length; i += 4)
              if (
                data[i] > 120 &&
                data[i + 2] > 200 &&
                data[i + 2] > data[i] + 20 &&
                data[i + 2] > data[i + 1] + 10
              )
                purple++;
            return purple;
          },
          { x: (box.width - 960) / 2 + marker.x, y: (box.height - 540) / 2 + marker.y },
        ),
      )
      .toBeGreaterThan(5);

    await page.keyboard.down('Alt');
    await page.mouse.click(
      box.x + (box.width - 960) / 2 + p.x,
      box.y + (box.height - 540) / 2 + p.y,
    );
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await read())[0].contours![0].length).toBe(5);
    const after = await read(),
      inserted = worldPoint(after[0], after[0].contours![0][1]);
    expect(Math.hypot(inserted.x - p.x, inserted.y - p.y)).toBeLessThan(0.1);
    expect(after[0].contours![0][1].in).toBeDefined();
    expect(after[0].contours![0][1].out).toBeDefined();
    if (mode === 'merge') {
      await stage.focus();
      await page.keyboard.press('ContextMenu');
      await page.getByRole('menuitem', { name: 'Dissolve redundant anchor', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Dissolve anchor', exact: true }).click();
    }
    const dissolved = await read();
    expect(dissolved[0].contours![0]).toHaveLength(4);
    expect(dissolved[0].contours![1]).toEqual(before[0].contours![1]);
    for (let i = 0; i < 4; i++) {
      const a = dissolved[0].contours![0][i],
        b = before[0].contours![0][i];
      expect(a.x).toBeCloseTo(b.x, 7);
      expect(a.y).toBeCloseTo(b.y, 7);
      for (const part of ['in', 'out'] as const)
        if (b[part]) {
          expect(a[part]!.x).toBeCloseTo(b[part]!.x, 7);
          expect(a[part]!.y).toBeCloseTo(b[part]!.y, 7);
        }
    }
    await stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(after);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(dissolved);
    await page.keyboard.press('Control+a');
    const corner = worldPoint(dissolved[0], dissolved[0].contours![0][2]);
    await page.mouse.click(
      box.x + (box.width - 960) / 2 + corner.x,
      box.y + (box.height - 540) / 2 + corner.y,
    );
    await page.getByRole('button', {
      name: mode === 'merge' ? 'Dissolve redundant anchor' : 'Dissolve anchor',
      exact: true,
    }).click();
    expect(await read()).toEqual(dissolved);
    await expect(
      page.getByText(
        'This anchor cannot be removed without changing the curve. Artwork is unchanged.',
        { exact: true },
      ),
    ).toBeVisible();
    await stage.focus();
    await page.keyboard.press('Control+z');
    await stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(after);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('pen hover previews the next curve without storing artwork and Escape clears it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const pixels = () =>
    stage.evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(380, 220, 100, 80).data),
    );
  const read = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const initial = await pixels(),
    recovery = await read();
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 200);
  await page.mouse.up();
  await page.mouse.move(box.x + 500, box.y + 300);
  await expect.poll(pixels).not.toEqual(initial);
  expect(await read()).toBe(recovery);
  await page.keyboard.press('Escape');
  await expect.poll(pixels).toEqual(initial);
  expect(await read()).toBe(recovery);
  // Closing feedback and click handling share the same endpoint choice.
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.mouse.click(box.x + 500, box.y + 200);
  await page.mouse.click(box.x + 500, box.y + 350);
  await page.mouse.move(box.x + 302, box.y + 202);
  expect(await read()).toBe(recovery);
  await page.mouse.click(box.x + 302, box.y + 202);
  await expect
    .poll(
      async () => JSON.parse((await read()) ?? 'null')?.project.layers[0].keys[0].shapes[0]?.closed,
    )
    .toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('scene Pen Ctrl-click finishes an open draft only away from the path', async ({ page }) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  await page.addInitScript((project) => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await pen.click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  const click = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await click(160, 140);
  await click(240, 140);
  const finish = page.getByRole('button', { name: 'Finish path', exact: true });
  await expect(finish).toBeEnabled();
  await page.keyboard.down('Control');
  await click(200, 140);
  await expect(finish).toBeEnabled();
  await page.keyboard.up('Control');
  expect(await read()).toEqual(p);
  // A regular click after releasing Ctrl still adds an anchor to the same draft.
  await click(280, 200);
  await page.keyboard.down('Control');
  await click(345, 265);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes).toHaveLength(1);
  const [path] = (await read()).layers[0].keys[0].shapes;
  expect(path.closed).toBe(false);
  const nodes = path.nodes!.map(n => worldPoint(path, n));
  expect(nodes.map(n => [n.x - nodes[0].x, n.y - nodes[0].y])).toEqual([[0, 0], [80, 0], [120, 60]]);
  await expect(pen).toHaveAttribute('aria-pressed', 'true');
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('scene Pen Shift-click previews and saves a straight segment at the chosen increment', async ({ page }) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByLabel('Angle increment', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  const x = box.x + 160, y = box.y + 150;
  const pixels = () => stage.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.click(x, y);
  await expect(page.getByRole('button', { name: 'Finish path', exact: true })).toBeEnabled();
  await page.mouse.move(x + 90, y + 45);
  const free = await pixels();
  await page.keyboard.down('Shift');
  await expect.poll(async () => (await pixels()) !== free).toBe(true);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await pixels()) === free).toBe(true);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await stage.press('Enter');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes).toHaveLength(1);
  const [path] = (await read()).layers[0].keys[0].shapes;
  expect(path.nodes).toHaveLength(2);
  expect(path.nodes!.every(n => !n.in && !n.out)).toBe(true);
  const [a, b] = path.nodes!.map(n => worldPoint(path, n));
  expect(b.x - a.x).toBeCloseTo(Math.hypot(90, 45) * Math.cos(Math.PI / 6), 8);
  expect(b.y - a.y).toBeCloseTo(Math.hypot(90, 45) / 2, 8);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('idle scene Pen temporarily selects and moves artwork with Ctrl', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [{
    id: 'box', kind: 'rectangle', x: 110, y: 90, width: 80, height: 70,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [],
  }];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await pen.click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.focus();
  const b = (await stage.boundingBox())!;
  const x = b.x + b.width / 2 - 50, y = b.y + b.height / 2 - 25;
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect(stage).toHaveCSS('cursor', 'crosshair');
  await page.keyboard.down('Control');
  await expect(stage).toHaveCSS('cursor', 'default');
  await page.mouse.click(x, y);
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('110');
  expect(await read()).toEqual(p);
  const dragBox = (await stage.boundingBox())!;
  const dragX = dragBox.x + dragBox.width / 2 - 50, dragY = dragBox.y + dragBox.height / 2 - 25;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await expect.poll(() => stage.evaluate((node: HTMLCanvasElement) => node.hasPointerCapture(1))).toBe(true);
  await page.mouse.move(dragX + 15, dragY + 8);
  await page.keyboard.up('Control');
  await page.mouse.move(dragX + 40, dragY + 20);
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes[0].x).toBe(150);
  await expect(pen).toHaveAttribute('aria-pressed', 'true');
  await expect(stage).toHaveCSS('cursor', 'crosshair');
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await page.keyboard.down('Space');
  await page.keyboard.down('Control');
  await expect(stage).toHaveCSS('cursor', 'grab');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(stage).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x + 25, y);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.keyboard.up('Space');
  await expect(stage).toHaveCSS('cursor', 'crosshair');
  expect(await read()).toEqual(p);
});

test('idle scene Pen adds a curve anchor, converts a smooth point and removes a corner', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = 'object';
  const original: Vector = {
    id: 'curve', kind: 'bezier', x: 80, y: 100, width: 140, height: 110, rotation: 0,
    fill: '#ff0000', fillEnabled: false, stroke: '#ff0000', strokeWidth: 4, points: [],
    nodes: [{ x: 0, y: 0, out: { x: 24, y: -60 } }, { x: 80, y: 0, in: { x: 55, y: -60 } }, { x: 140, y: 50 }],
  };
  p.layers[0].keys[0].shapes = [original, {
    id: 'cover', kind: 'rectangle', x: 180, y: 113, width: 22, height: 24,
    fill: '#0000ff', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [],
  }];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.focus();
  const b = (await stage.boundingBox())!;
  const screen = (x: number, y: number) => [b.x + b.width / 2 + x - 200, b.y + b.height / 2 + y - 150] as const;
  const editAt = async (x: number, y: number) => {
    await page.mouse.move(...screen(x, y));
    await expect(stage).toHaveCSS('cursor', /data:image\/svg\+xml/);
    await page.mouse.click(...screen(x, y));
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const art = async () => (await read()).layers[0].keys[0].shapes[0];
  await page.keyboard.down('Control');
  await page.mouse.click(...screen(120, 55));
  await page.keyboard.up('Control');
  await page.mouse.move(...screen(190, 125));
  await expect(stage).toHaveCSS('cursor', 'crosshair');
  expect(await read()).toEqual(p);
  await editAt(120, 55);
  await expect.poll(async () => (await art()).nodes?.length).toBe(4);
  const inserted = (await art()).nodes!;
  const t = inserted[0].out!.x / 24, s = 1 - t;
  expect(t).toBeGreaterThan(.4);
  expect(t).toBeLessThan(.6);
  expect(inserted[1].x).toBeCloseTo(3 * s * s * t * 24 + 3 * s * t * t * 55 + t ** 3 * 80, 8);
  expect(inserted[1].y).toBeCloseTo(-180 * s * t, 8);
  expect((await art()).id).toBe(original.id);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await page.keyboard.down('Control');
  await page.mouse.click(...screen(120, 55));
  await page.keyboard.up('Control');
  await editAt(160, 100);
  await expect.poll(async () => (await art()).nodes?.[1]).toEqual({ x: 80, y: 0 });
  await editAt(160, 100);
  await expect.poll(async () => (await art()).nodes).toEqual([original.nodes![0], original.nodes![2]]);
  await stage.press('Control+z');
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('zoom keeps pointer and panned viewport anchors fixed without changing artwork', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [
    {
      id: 'zoom-dot',
      kind: 'ellipse',
      x: 240,
      y: 140,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await zoom.selectOption('1');
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const anchor = { x: (box.width - 960) / 2 + 250, y: (box.height - 540) / 2 + 150 };
  const pixel = (p: { x: number; y: number }) =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      p,
    );
  const read = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await read();
  await expect.poll(() => pixel(anchor)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  await page.mouse.click(box.x + anchor.x, box.y + anchor.y);
  await expect(zoom).toHaveValue('1.25');
  await expect.poll(() => pixel(anchor)).toEqual([255, 0, 0, 255]);
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + anchor.x, box.y + anchor.y);
  await page.keyboard.up('Alt');
  await expect(zoom).toHaveValue('1');
  await expect.poll(() => pixel(anchor)).toEqual([255, 0, 0, 255]);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
  await expect.poll(() => pixel(anchor)).toEqual([255, 0, 0, 255]);
  // Put the same dot in the viewport center with Hand, then change toolbar zoom.
  await page.getByRole('button', { name: 'Hand', exact: true }).click();
  await page.mouse.move(box.x + anchor.x, box.y + anchor.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up();
  const center = { x: box.width / 2, y: box.height / 2 };
  await expect.poll(() => pixel(center)).toEqual([255, 0, 0, 255]);
  await zoom.selectOption('2');
  await expect.poll(() => pixel(center)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.mouse.move(box.x + center.x, box.y + center.y);
  await page.mouse.down();
  await stage.evaluate((c) =>
    c.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }),
    ),
  );
  await expect(zoom).toHaveValue('2');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toBe(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const endpoint of [0, 1])
  test(`Pen continues affine open endpoint ${endpoint} with cancellation and one undo step`, async ({
    page,
  }) => {
    const project = newProject();
    project.layers[0].drawingMode = 'object';
    project.layers[0].keys[0].shapes = [
      {
        id: 'continue',
        kind: 'bezier',
        x: 300,
        y: 200,
        width: 180,
        height: 120,
        rotation: 12,
        transform: [1, 0.1, 0.2, 1],
        fill: '#dd0000',
        fillEnabled: false,
        stroke: '#2255ff',
        strokeWidth: 6,
        opacity: 0.5,
        points: [],
        nodes: [
          { x: 0, y: 0, out: { x: 60, y: -70 } },
          { x: 180, y: 80, in: { x: 120, y: 140 } },
        ],
      },
    ];
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const stage = page.getByLabel('Drawing stage'),
      box = (await stage.boundingBox())!,
      origin = { x: box.x + (box.width - 960) / 2, y: box.y + (box.height - 540) / 2 };
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    const before = await read(),
      anchor = worldPoint(before[0], before[0].nodes![endpoint]);
    const begin = async () => {
      await page.getByRole('button', { name: 'Subselection', exact: true }).click();
      await stage.focus();
      await page.keyboard.press('Control+a');
      await page.mouse.click(origin.x + anchor.x, origin.y + anchor.y);
      if (endpoint === 0) {
        await stage.focus();
        await page.keyboard.press('ContextMenu');
        await page.getByRole('menuitem', { name: 'Continue from endpoint', exact: true }).click();
      } else
        await page.getByRole('button', { name: 'Continue from endpoint', exact: true }).click();
      await stage.focus();
    };
    const cue = () =>
      stage.evaluate(
        (c, p) => {
          const data = (c as HTMLCanvasElement)
            .getContext('2d')!
            .getImageData(p.x - 10, p.y - 10, 21, 21).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              data[i] < 50 &&
              data[i + 1] > 90 &&
              data[i + 2] > 100 &&
              Math.abs(data[i + 2] - data[i + 1]) < 45
            )
              count++;
          return count;
        },
        { x: (box.width - 960) / 2 + anchor.x, y: (box.height - 540) / 2 + anchor.y },
      );
    const pickup = async (alt = false) => {
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await stage.focus();
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Pen', exact: true }).click();
      await page.mouse.move(origin.x + anchor.x, origin.y + anchor.y);
      await expect.poll(cue).toBeGreaterThan(30);
      if (alt) {
        await page.keyboard.down('Alt');
        await expect.poll(cue).toBe(0);
        await page.keyboard.up('Alt');
        await expect.poll(cue).toBeGreaterThan(30);
        await page.keyboard.down('Alt');
        await expect.poll(cue).toBe(0);
      }
      await page.mouse.click(origin.x + anchor.x, origin.y + anchor.y);
      if (alt) await page.keyboard.up('Alt');
    };
    const middle = worldPoint(before[0], { x: 90, y: 36.25 });
    const pixels = () =>
      stage.evaluate(
        (c, p) =>
          Array.from(
            (c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x - 2, p.y - 2, 5, 5).data,
          ),
        { x: (box.width - 960) / 2 + middle.x, y: (box.height - 540) / 2 + middle.y },
      );
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    const originalPixels = await pixels();
    await begin();
    await expect.poll(pixels).toEqual(originalPixels);
    expect(await read()).toEqual(before);
    await page.keyboard.press('Enter');
    expect(await read()).toEqual(before);
    await begin();
    const target = { x: anchor.x + (endpoint ? 75 : -75), y: anchor.y + 90 };
    await page.mouse.click(origin.x + target.x, origin.y + target.y);
    expect(await read()).toEqual(before);
    if (endpoint === 0) await page.keyboard.press('Escape');
    else {
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
    }
    expect(await read()).toEqual(before);
    await pickup();
    expect(await read()).toEqual(before);
    await page.mouse.click(origin.x + target.x, origin.y + target.y);
    await page.keyboard.press('Enter');
    const after = await read();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].nodes).toHaveLength(3);
    for (let i = 0; i < 2; i++) {
      const original = before[0].nodes![endpoint ? i : 1 - i],
        actual = after[0].nodes![i],
        a = worldPoint(before[0], original),
        b = worldPoint(after[0], actual);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      const part = i === 0 ? 'out' : 'in';
      const sourcePart = endpoint ? part : part === 'out' ? 'in' : 'out';
      const c = worldPoint(before[0], original[sourcePart]!),
        d = worldPoint(after[0], actual[part]!);
      expect(d.x).toBeCloseTo(c.x, 6);
      expect(d.y).toBeCloseTo(c.y, 6);
    }
    expect(after[0].stroke).toBe(before[0].stroke);
    expect(after[0].opacity).toBe(0.5);
    expect(after[0].fillEnabled).toBe(false);
    const end = worldPoint(after[0], after[0].nodes![2]);
    expect(end.x).toBeCloseTo(target.x, 2);
    expect(end.y).toBeCloseTo(target.y, 2);
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(after);
    await page.keyboard.press('Control+z');
    await pickup(true);
    await page.mouse.click(origin.x + target.x, origin.y + target.y);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await read()).length).toBe(2);
    const separate = await read();
    expect(separate[0]).toEqual(before[0]);
    expect(separate[1].id).not.toBe(before[0].id);
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await begin();
    await page.getByLabel('Toggle lock Layer 1').click();
    await expect(page.getByRole('button', { name: 'Finish path', exact: true })).toBeDisabled();
    expect(await read()).toEqual(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('drawing smoothing controls stay above the canvas and Pen finish smoothing is opt-in and undoable', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
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
  const options = page.getByRole('group', { name: 'Active drawing tool options' });
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(options.getByLabel('Brush simplify amount', { exact: true })).toBeInViewport();
  await expect(options.getByLabel('Brush simplify amount', { exact: true })).toHaveValue('50');
  await options.getByLabel('Brush simplify amount', { exact: true }).fill('80');
  await expect(page.getByLabel('Brush finish simplify', { exact: true })).toHaveValue('80');
  await page.getByLabel('Brush finish simplify', { exact: true }).fill('20');
  await expect(options.getByLabel('Brush simplify slider', { exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await options.getByLabel('Pencil mode', { exact: true }).selectOption('smooth');
  await expect(page.getByLabel('Pencil mode in Properties', { exact: true })).toHaveValue(
    'smooth',
  );
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await expect(options.getByLabel('Smooth anchors on finish', { exact: true })).not.toBeChecked();
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  const draw = async () => {
    const box = (await page.getByLabel('Drawing stage').boundingBox())!;
    for (const [x, y] of [
      [100, 100],
      [160, 160],
      [220, 100],
    ])
      await page.mouse.click(box.x + x, box.y + y);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await read()).length).toBe(1);
  };
  await draw();
  const raw = (await read())[0];
  expect(raw.nodes).toHaveLength(3);
  expect(raw.nodes!.every((n) => !n.in && !n.out)).toBe(true);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual([]);
  await options.getByLabel('Smooth anchors on finish', { exact: true }).check();
  await draw();
  const smooth = (await read())[0];
  expect(smooth.nodes![1].in).toBeDefined();
  expect(smooth.nodes![1].out).toBeDefined();
  for (let i = 0; i < 3; i++) {
    expect(worldPoint(smooth, smooth.nodes![i]).x).toBeCloseTo(worldPoint(raw, raw.nodes![i]).x);
    expect(worldPoint(smooth, smooth.nodes![i]).y).toBeCloseTo(worldPoint(raw, raw.nodes![i]).y);
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  expect((await read())[0]).toEqual(smooth);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
