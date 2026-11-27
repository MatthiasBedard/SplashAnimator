import { objectBounds } from '../../packages/geometry/src/layout';
import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
import { gradientAxis } from '../../packages/geometry/src/gradient';

test('Shift constrains a reflected Subselection tangent to the configured stage angle', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [{
    id: 'curve', kind: 'bezier', x: 210, y: 100, width: 160, height: 80, rotation: 0,
    transform: [-1, .25, .5, 1], fill: '#000000', fillEnabled: false, stroke: '#223344',
    strokeWidth: 4, points: [], nodes: [
      { x: 0, y: 10 },
      { x: 80, y: 40, in: { x: 104, y: 20 }, out: { x: 44, y: 48 } },
      { x: 160, y: 80 },
    ],
  }];
  await page.addInitScript(data => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: data, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  await page.getByLabel('Angle increment', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await view.click();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const b = (await stage.boundingBox())!, x = b.x + b.width / 2 - 200, y = b.y + b.height / 2 - 150;
  const drag = async (alt = false) => {
    await page.mouse.click(x + 150, y + 160);
    await page.mouse.move(x + 190, y + 159);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(x + 181, y + 184);
  };
  const release = async (alt = false) => {
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
  };
  const cue = () => stage.evaluate((canvas: HTMLCanvasElement) => {
    const dpr = devicePixelRatio;
    const data = canvas.getContext('2d')!.getImageData(
      Math.floor(canvas.width / 2 - 8 * dpr) - 3, Math.floor(canvas.height / 2 + 34 * dpr) - 3, 7, 7,
    ).data;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 200 && data[i + 1] < 175 && data[i + 2] > 100 && data[i + 2] < 210) return true;
    return false;
  });
  const before = await read(), initial = before.layers[0].keys[0].shapes[0];
  await drag();
  await expect.poll(cue).toBe(true);
  expect(await read()).toEqual(before);
  await stage.press('Escape');
  await release();
  await expect.poll(cue).toBe(false);
  expect(await read()).toEqual(before);

  const points = (p: Project) => {
    const shape = p.layers[0].keys[0].shapes[0], node = shape.nodes![1];
    return { anchor: worldPoint(shape, node), incoming: worldPoint(shape, node.in!), outgoing: worldPoint(shape, node.out!) };
  };
  const verifyAngle = (p: Project) => {
    const { anchor, outgoing } = points(p), dx = outgoing.x - anchor.x, dy = outgoing.y - anchor.y;
    expect(Math.atan2(dy, dx)).toBeCloseTo(Math.PI / 6, 9);
    expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(31, 24), 1);
    expect(outgoing.x).toBeGreaterThan(182);
    expect(p.layers[0].keys[0].shapes[0].nodes).toHaveLength(initial.nodes!.length);
  };
  await drag();
  await release();
  await expect.poll(read).not.toEqual(before);
  const coupled = await read();
  verifyAngle(coupled);
  const { anchor, incoming } = points(coupled), original = points(before);
  expect(Math.atan2(anchor.y - incoming.y, anchor.x - incoming.x)).toBeCloseTo(Math.PI / 6, 9);
  expect(Math.hypot(anchor.x - incoming.x, anchor.y - incoming.y))
    .toBeCloseTo(Math.hypot(original.anchor.x - original.incoming.x, original.anchor.y - original.incoming.y), 9);
  await expect.poll(cue).toBe(false);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(coupled);
  await stage.press('Control+z');

  await drag(true);
  await expect.poll(cue).toBe(true);
  await release(true);
  await expect.poll(read).not.toEqual(before);
  const independent = await read();
  verifyAngle(independent);
  expect(points(independent).incoming).toEqual(original.incoming);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const kind of ['node', 'gradient', 'axis', 'ellipse'])
  test(`${kind} handles snap on affine artwork with Alt bypass and undo`, async ({ page }) => {
    const isAxis = kind === 'axis' || kind === 'ellipse';
    await page.goto('/');
    await page.getByLabel('Drawing mode').selectOption('object');
    const canvas = page.getByLabel('Drawing stage'),
      b = (await canvas.boundingBox())!;
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes[0],
      );
    if (kind === 'node') {
      await page.getByRole('button', { name: 'Pen', exact: true }).click();
      await page.mouse.click(b.x + 320, b.y + 220);
      await page.mouse.click(b.x + 460, b.y + 160);
      await page.mouse.click(b.x + 570, b.y + 260);
      await page.keyboard.press('Enter');
    } else {
      await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
      await page.mouse.move(b.x + 320, b.y + 180);
      await page.mouse.down();
      await page.mouse.move(b.x + 570, b.y + 340);
      await page.mouse.up();
    }
    await expect.poll(read).toBeDefined();
    if (kind !== 'node') await page.getByLabel('Fill type').selectOption(kind === 'ellipse' ? 'radial' : 'linear');
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await page.getByLabel('Transform skew X', { exact: true }).fill('15');
    await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
    const before = await read(),
      zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
    const origin = { x: b.x + (b.width - 960 * zoom) / 2, y: b.y + (b.height - 540 * zoom) / 2 };
    const start = worldPoint(
      before,
      kind === 'node'
        ? before.nodes![1]
        : isAxis
          ? gradientAxis(before.gradient!)
          : before.gradient!.to,
    );
    const target = {
      x: Math.round((start.x + 40) / 20) * 20,
      y: Math.round((start.y + 40) / 20) * 20,
    };
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page
      .getByRole('button', {
        name: kind === 'node' ? 'Subselection' : 'Gradient transform',
        exact: true,
      })
      .click();
    await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
    await page.mouse.down();
    await page.mouse.move(origin.x + (target.x + 2) * zoom, origin.y + (target.y + 2) * zoom, {
      steps: 10,
    });
    await page.mouse.move(origin.x + (target.x + 3) * zoom, origin.y + (target.y + 3) * zoom);
    await page.mouse.up();
    let s = await read(),
      p = worldPoint(
        s,
        kind === 'node' ? s.nodes![1] : isAxis ? gradientAxis(s.gradient!) : s.gradient!.to,
      );
    expect(p.x).toBeCloseTo(target.x, 0);
    expect(p.y).toBeCloseTo(target.y, 0);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+a');
    await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
    await page.mouse.down();
    await page.mouse.move(origin.x + (target.x + 2) * zoom, origin.y + (target.y + 2) * zoom);
    await page.keyboard.down('Alt');
    await page.mouse.move(origin.x + (target.x + 3) * zoom, origin.y + (target.y + 3) * zoom);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    s = await read();
    p = worldPoint(
      s,
      kind === 'node' ? s.nodes![1] : isAxis ? gradientAxis(s.gradient!) : s.gradient!.to,
    );
    expect(p.x).toBeCloseTo(target.x + 3, 0);
    expect(p.y).toBeCloseTo(target.y + 3, 0);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    if (kind === 'node') {
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
      await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
      await page.getByRole('button', { name: 'View', exact: true }).click();
      const other = worldPoint(before, before.nodes![2]);
      await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
      await page.mouse.down();
      await page.mouse.move(origin.x + (other.x + 3) * zoom, origin.y + (other.y + 35) * zoom);
      await page.mouse.up();
      s = await read();
      expect(worldPoint(s, s.nodes![1]).x).toBeCloseTo(other.x, 0);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    }
    if (isAxis) {
      await page.keyboard.press('Control+a');
      await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
      await page.mouse.down();
      await page.mouse.move(origin.x + target.x * zoom, origin.y + target.y * zoom);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(await read()).toEqual(before);
      await canvas.focus();
      await page.keyboard.press('Control+a');
      await page.mouse.move(origin.x + start.x * zoom, origin.y + start.y * zoom);
      await page.mouse.down();
      await page.mouse.move(origin.x + target.x * zoom, origin.y + target.y * zoom);
      await page.mouse.up();
      const changed = await read();
      expect(changed.gradient!.transform).toBeDefined();
      await page.locator('summary').filter({ hasText: 'Gradient transform' }).click();
      await page.getByRole('button', { name: 'Reset gradient axes', exact: true }).click();
      expect((await read()).gradient!.transform).toEqual([1, 0, 0, 1]);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(changed);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('custom grid spacing and snap distance guide drawing with Alt bypass and reset', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode').selectOption('object');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'),
    box = (await canvas.boundingBox())!;
  const origin = { x: box.x + (box.width - 960) / 2, y: box.y + (box.height - 540) / 2 };
  await page.getByRole('button', { name: 'View', exact: true }).click();
  for (const [name, value] of [
    ['Grid width', '30'],
    ['Grid height', '40'],
    ['Snap distance', '3'],
  ]) {
    await page.getByLabel(name, { exact: true }).fill(value);
    await page.getByLabel(name, { exact: true }).press('Tab');
  }
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const draw = async (x: number, y: number, toX: number, toY: number) => {
    await page.mouse.move(origin.x + x, origin.y + y);
    await page.mouse.down();
    await page.mouse.move(origin.x + toX, origin.y + toY);
    await page.mouse.up();
  };
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await draw(92, 122, 181, 201);
  await expect.poll(async () => (await read()).length).toBe(1);
  const first = await read();
  expect(first[0]).toMatchObject({ x: 90, y: 120, width: 90, height: 80 });
  await page.keyboard.down('Alt');
  await draw(242, 123, 302, 201);
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await read()).length).toBe(2);
  const second = await read();
  expect(second[1]).toMatchObject({ x: 242, y: 123, width: 60, height: 78 });
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(first);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(second);
  await page.getByTitle('Toggle grid', { exact: true }).click();
  const pixel = () =>
    canvas.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x: origin.x - box.x + 30, y: origin.y - box.y + 70 },
    );
  await expect.poll(pixel).not.toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Reset grid settings', exact: true }).click();
  await expect(page.getByLabel('Grid width', { exact: true })).toHaveValue('20');
  await expect(page.getByLabel('Grid height', { exact: true })).toHaveValue('20');
  await expect(page.getByLabel('Snap distance', { exact: true })).toHaveValue('6');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  expect(await read()).toEqual(second);
});

test('rotation uses custom angles, restores tool defaults and cancels without changing artwork', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  const shape = {
    id: 'angle-rectangle',
    kind: 'rectangle' as const,
    x: 300,
    y: 180,
    width: 160,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#222222',
    strokeWidth: 0,
    points: [],
  };
  project.layers[0].keys[0].shapes = [shape];
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
  const canvas = page.getByLabel('Drawing stage'),
    box = (await canvas.boundingBox())!;
  const origin = { x: box.x + (box.width - 960) / 2, y: box.y + (box.height - 540) / 2 };
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const before = await read();
  for (const [increment, expected] of [
    [30, 30],
    [0, 45],
  ]) {
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByLabel('Angle increment').selectOption(String(increment));
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const bounds = objectBounds(before),
      cx = (bounds.left + bounds.right) / 2,
      cy = (bounds.top + bounds.bottom) / 2;
    const angle = (38 * Math.PI) / 180;
    const start = { x: bounds.right + 12, y: bounds.top - 12 };
    const dx = start.x - cx, dy = start.y - cy;
    const end = {
      x: cx + Math.cos(angle) * dx - Math.sin(angle) * dy,
      y: cy + Math.sin(angle) * dx + Math.cos(angle) * dy,
    };
    const drag = async () => {
      await canvas.focus();
      await page.keyboard.press('Control+a');
      await page.mouse.move(origin.x + start.x, origin.y + start.y);
      await page.mouse.down();
      await page.keyboard.down('Shift');
      await page.mouse.move(
        origin.x + end.x,
        origin.y + end.y,
      );
    };
    await drag();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await read()).toEqual(before);
    await drag();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const rotated = await read(),
      a = worldPoint(rotated, { x: 0, y: 0 }),
      b = worldPoint(rotated, { x: 1, y: 0 });
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(expected, 6);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(rotated);
    await page.keyboard.press('Control+z');
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('line Shift constraints share drawing angles and preserve length, free drawing and undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode').selectOption('object');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'),
    box = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as
            Project | undefined
        )?.layers[0].keys[0].shapes ?? [],
    );
  for (const [increment, shift, expected] of [
    [30, true, 30],
    [0, true, 45],
    [30, false, 38],
  ] as const) {
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByLabel('Angle increment').selectOption(String(increment));
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box.x + 300, box.y + 200);
    await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(
      box.x + 300 + 100 * Math.cos((38 * Math.PI) / 180),
      box.y + 200 + 100 * Math.sin((38 * Math.PI) / 180),
    );
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await expect.poll(read).toHaveLength(1);
    const committed = await read(),
      line = committed[0];
    const a = worldPoint(line, line.points[0]),
      b = worldPoint(line, line.points[1]);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, 2);
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(expected, 2);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(committed);
    await page.keyboard.press('Control+z');
  }
});
