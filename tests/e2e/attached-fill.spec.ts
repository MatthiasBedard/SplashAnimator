import { expect, test, type Page } from '@playwright/test';
import {
  newProject,
  validateProject,
  type SymbolDefinition,
  type Project,
  type Vector,
  type BezierNode,
} from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { mergeVectors } from '../../packages/geometry/src/merge';
import { worldPaths } from '../../packages/geometry/src/drawing';
import { matrix, mapPoint } from '../../packages/geometry/src/affine';
import { splitCubic, type Cubic } from '../../packages/geometry/src/curve-fit';
import { recoloredBrushFixture } from '../recolored-brush-fixture';

async function setup(
  page: Page,
  mode: 'merge' | 'object' = 'merge',
  curved = false,
  merged = false,
  customArtwork?: Vector[],
) {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = mode;
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
      curved
        ? worldPaths({ ...line, x: 0, y: 0 }, 0.25)[0].concat([
            { x: 200, y: 100 },
            { x: 0, y: 100 },
          ])
        : [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 100 },
            { x: 0, y: 100 },
          ],
    ],
  };
  p.layers[0].keys[0].shapes = customArtwork ?? (merged
    ? mergeVectors(
        [
          {
            ...structuredClone(line),
            closed: true,
            fillEnabled: true,
            fill: '#ff0000',
            nodes: [
              { x: 0, y: 0 },
              { x: 200, y: 0 },
              { x: 200, y: 100 },
              { x: 0, y: 100 },
            ],
          },
        ],
        undefined,
        true,
      )
    : [fill, line]);
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
    const b = (await canvas.boundingBox())!;
    return { x: b.x + b.width / 2 - 200 + x, y: b.y + b.height / 2 - 150 + y };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (
    x: number,
    y: number,
    dx: number,
    dy: number,
    cancel: boolean | 'return' = false,
    during?: () => Promise<void>,
  ) => {
    const a = await pos(x, y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + dx, a.y + dy, { steps: 5 });
    if (during) await during();
    if (cancel === true) await page.keyboard.press('Escape');
    if (cancel === 'return') await page.mouse.move(a.x, a.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole('alert')).toHaveCount(0);
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
  const select = async () => {
    const q = await pos(40, 60);
    await page.mouse.click(q.x, q.y);
  };
  return { p, canvas, pos, read, drag, pixel, select };
}
const count = (s: Vector) => s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
const worldNodes = (s: Vector) =>
  ((s.contours?.flat() ?? s.nodes ?? s.points) as BezierNode[]).map((n) => ({
    ...mapPoint(matrix(s), n),
    ...(n.in ? { in: mapPoint(matrix(s), n.in) } : {}),
    ...(n.out ? { out: mapPoint(matrix(s), n.out) } : {}),
  }));

function brushSeam() {
  const { shapes, foreground } = recoloredBrushFixture();
  const background = shapes[0];
  const curves = (shape: Vector): Cubic[] => {
    const ring = worldNodes(shape);
    return ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      return [a, a.out ?? a, b.in ?? b, b];
    });
  };
  const same = (a: Cubic, b: Cubic) => a.every((p, i) =>
    Math.hypot(p.x - b[3 - i].x, p.y - b[3 - i].y) < 1e-8);
  const under = curves(background);
  const seam = curves(foreground).filter(curve => under.some(edge => same(curve, edge)))
    .sort((a, b) => Math.abs(b[0].x - b[3].x) - Math.abs(a[0].x - a[3].x))[0];
  expect(seam).toBeDefined();
  const point = splitCubic(seam, 0.5)[0][3];
  return { shapes, foreground, background, curves, same, seam, point };
}

test('Subselection edits a large shared Brush seam without exhausting boundary work', async ({ page }) => {
  const fine = Array.from({ length: 641 }, (_, i) => ({ x: i / 4, y: i % 2 ? 0.25 : 0 }));
  const seam = [...fine, { x: 210, y: 0 }];
  const paint = (id: string, fill: string, ring: BezierNode[]): Vector => ({
    id, kind: 'polygon', x: 40, y: 120, width: 210, height: 28, rotation: 0,
    fill, fillEnabled: true, stroke: '#000000', strokeWidth: 0, drawingMode: 'merge',
    points: [], closed: true, fillRule: 'evenodd', contours: [ring],
  });
  const blue = paint('blue', '#0088ff', [...seam, { x: 210, y: 28 }, { x: 0, y: 28 }]);
  const red = paint('red', '#ff0000', [...structuredClone(seam).reverse(),
    { x: 0, y: -28, out: { x: 50, y: -40 } }, { x: 210, y: -28, in: { x: 160, y: -40 } }]);
  const f = await setup(page, 'merge', false, false, [blue, red]);
  validateProject(f.p);
  const probe = () => f.pixel(225, 115);
  await expect.poll(probe).toEqual([255, 0, 0, 255]);
  const pick = await f.pos(225, 112);
  await page.mouse.click(pick.x, pick.y);
  await f.drag(225, 119, 0, -12, false, async () => {
    expect(await f.read()).toEqual(f.p);
    await expect.poll(probe).toEqual([0, 136, 255, 255]);
  });
  const changed = await f.read();
  const [afterBlue, afterRed] = changed.layers[0].keys[0].shapes;
  const lower = worldNodes(afterBlue), upper = worldNodes(afterRed);
  expect(lower.slice(0, 640)).toEqual(worldNodes(blue).slice(0, 640));
  expect(upper.slice(2)).toEqual(worldNodes(red).slice(2));
  expect(lower[640].out).toEqual(upper[1].in);
  expect(lower[641].in).toEqual(upper[0].out);
  expect(lower[640].out!.y).toBeLessThan(120);
  expect([count(afterBlue), count(afterRed)]).toEqual([count(blue), count(red)]);
  validateProject(changed);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(changed);
});

for (const edit of ['foreground', 'background'])
test(`Subselection bends both colors along a shared curved Brush seam from the ${edit}`, async ({ page }) => {
  const { shapes, foreground, background, curves, same, seam, point } = brushSeam();
  const f = await setup(page, 'merge', false, false, shapes);
  const direction = edit === 'foreground' ? -1 : 1;
  const red = [255, 0, 0, 255], blue = [0, 136, 255, 255];
  const pick = await f.pos(point.x, point.y + 6 * direction);
  const probe = () => f.pixel(point.x, point.y + 5 * direction);
  await expect.poll(probe).toEqual(direction < 0 ? red : blue);
  await page.mouse.click(pick.x, pick.y);
  await f.drag(point.x, point.y + direction, 0, 12 * direction, false, async () => {
    expect(await f.read()).toEqual(f.p);
    await expect.poll(probe).toEqual(direction < 0 ? blue : red);
  });
  const changed = await f.read();
  const [afterUnder, afterOver] = changed.layers[0].keys[0].shapes;
  expect(afterOver).not.toEqual(foreground);
  expect(afterUnder).not.toEqual(background);
  const newCurve = curves(afterOver).find(edge => Math.hypot(edge[0].x - seam[0].x, edge[0].y - seam[0].y) < 1e-8)!
  expect((newCurve[1].y - seam[1].y) * direction).toBeGreaterThan(0);
  expect(curves(afterUnder).some(edge => same(newCurve, edge))).toBe(true);
  expect([count(afterUnder), count(afterOver)]).toEqual(shapes.map(count));
  if (edit === 'foreground') {
    const apply = page.getByRole('group', { name: 'Active drawing tool options' }).getByRole('button', {name: 'Apply', exact: true });
    await apply.click();
    await expect(apply).toBeDisabled();
  } else {
    const blank = await f.pos(340, 235);
    await page.mouse.click(blank.x, blank.y);
  }
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  expect(await f.read()).toEqual(changed);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(changed);
});

for (const method of ['deselect', 'Apply', 'Bucket'] as const) {
  test(`shared Brush fill seam still joins after bending and ${method}`, async ({ page }) => {
    const { shapes, foreground, background, point, curves, same, seam } = brushSeam();
    if (method !== 'Bucket') foreground.fill = background.fill;
    const f = await setup(page, 'merge', false, false, shapes);
    const pick = await f.pos(point.x, point.y + 6);
    await page.mouse.click(pick.x, pick.y);
    await f.drag(point.x, point.y + 1, 0, 12);
    const art = async () => (await f.read()).layers[0].keys[0].shapes;
    const bent = await art();
    expect(bent).toHaveLength(2);
    const changedSeam = curves(bent[1]).find(edge => Math.hypot(edge[0].x - seam[0].x, edge[0].y - seam[0].y) < 1e-8)!;
    expect(curves(bent[0]).some(edge => same(changedSeam, edge))).toBe(true);
    if (method === 'Apply') {
      await page.getByRole('group', { name: 'Active drawing tool options' }).getByRole('button', {name: 'Apply', exact: true }).click({timeout: 3000});
    } else if (method === 'deselect') {
      const blank = await f.pos(340, 235);
      await page.mouse.click(blank.x, blank.y);
    } else {
      await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
      await page.getByLabel('Drawing fill', { exact: true }).fill(background.fill);
      const red = await f.pos(280, 155);
      await page.mouse.click(red.x, red.y);
    }
    await expect.poll(async () => (await art()).map(shape => shape.fill)).toEqual([background.fill]);
    const joined = await art();
    expect(joined[0].contours).toHaveLength(1);
    expect(curves(joined[0]).some(edge => same(changedSeam, edge))).toBe(false);
    expect(await f.pixel(120, 120)).toEqual([0, 136, 255, 255]);
    expect(await f.pixel(280, 155)).toEqual([0, 136, 255, 255]);
    if (method === 'Apply') await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
    await f.canvas.press('Control+z');
    if (method === 'Bucket') await expect.poll(art).toEqual(bent);
    else await expect.poll(f.read).toEqual(f.p);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(art).toEqual(joined);
  });
}

test('advanced symbol Subselection saves both colors of the shared curve together', async ({ page }) => {
  const { shapes, foreground, background, curves, same, seam, point } = brushSeam();
  const p = newProject();
  p.symbols = [{ id: 'shared', name: 'Shared paint', width: 400, height: 300, shapes }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('option', { name: 'Library item Shared paint', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  await page.getByLabel('Symbol artwork item', { exact: true }).selectOption(foreground.id);
  await page.getByLabel('Symbol canvas tool', { exact: true }).selectOption('nodes');
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(500 / 400, 290 / 300);
  const x = box.x + (20 + point.x * scale) * box.width / 540;
  const y = box.y + (20 + (point.y - 1) * scale) * box.height / 330;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12 * scale * box.height / 330, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect.poll(async () => (await read()).symbols![0].shapes[0]).not.toEqual(background);
  const [under, over] = (await read()).symbols![0].shapes;
  const newCurve = curves(over).find(edge => Math.hypot(edge[0].x - seam[0].x, edge[0].y - seam[0].y) < 1e-8)!;
  expect(newCurve[1].y).toBeLessThan(seam[1].y);
  expect(curves(under).some(edge => same(newCurve, edge))).toBe(true);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(read).toEqual(p);
});

for (const merged of [false, true])
  test(`Selection reshapes a fresh ${merged ? 'merged enclosure' : 'attached edge'} with its fill`, async ({ page }) => {
    const f = await setup(page, 'merge', false, merged);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await f.drag(140, 60, 0, -40, false, async () => {
      await expect.poll(() => f.pixel(120, 42)).toEqual([255, 0, 0, 255]);
      expect(await f.read()).toEqual(f.p);
    });
    const shapes = (await f.read()).layers[0].keys[0].shapes;
    const stroke = shapes.find(s => s.fillEnabled === false)!;
    const paint = shapes.find(s => s.fillEnabled !== false)!;
    expect(shapes.map(count)).toEqual(f.p.layers[0].keys[0].shapes.map(count));
    const ends = worldNodes(stroke);
    expect(ends[0]).toMatchObject({ x: 40, y: 60 });
    expect(ends[1]).toMatchObject({ x: 240, y: 60 });
    expect(worldNodes(paint)[0].out).toEqual(ends[0].out);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('Selection pulls an attached corner and leaves the opposite corner fixed', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await f.drag(40, 60, -20, -16);
  const shapes = (await f.read()).layers[0].keys[0].shapes;
  expect(worldNodes(shapes[1])).toEqual([{ x: 20, y: 44 }, { x: 240, y: 60 }]);
  expect(worldNodes(shapes[0])).toEqual([{ x: 20, y: 44 }, { x: 240, y: 60 }, { x: 240, y: 160 }, { x: 40, y: 160 }]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Selection can reshape the same edge twice without clicking off first', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await f.drag(140, 60, 0, -40);
  const first = await f.read();
  await f.drag(140, 20, 0, -15);
  await expect.poll(() => f.pixel(140, 12)).toEqual([255, 0, 0, 255]);
  const shapes = (await f.read()).layers[0].keys[0].shapes;
  expect(shapes.map(count)).toEqual([4, 2]);
  expect(worldNodes(shapes[1])[0]).toMatchObject({ x: 40, y: 60 });
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(first);
});

test('Escape cancels a Selection bend without moving the shared fill', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await f.drag(140, 60, 0, -40, true, async () => {
    await expect.poll(() => f.pixel(120, 42)).toEqual([255, 0, 0, 255]);
  });
  await expect.poll(() => f.pixel(120, 42)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
});

test('Selection keeps a touching Object Drawing stroke independent', async ({ page }) => {
  const f = await setup(page, 'object');
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await f.drag(140, 60, 0, -40);
  const [paint, stroke] = (await f.read()).layers[0].keys[0].shapes;
  expect(paint).toEqual(f.p.layers[0].keys[0].shapes[0]);
  expect(worldNodes(stroke)).toEqual([{ x: 40, y: 20 }, { x: 240, y: 20 }]);
});

for (const merged of [false, true])
  test(`bending a ${merged ? 'genuinely merged Pen enclosure' : 'separate attached stroke'} carries its fill during preview and release`, async ({
    page,
  }) => {
    const f = await setup(page, 'merge', false, merged);
    await f.select();
    await expect.poll(() => f.pixel(140, 40)).toEqual([255, 255, 255, 255]);
    await f.drag(140, 60, 0, -40, false, async () => {
      await expect.poll(() => f.pixel(140, 40)).toEqual([255, 0, 0, 255]);
      expect(await f.read()).toEqual(f.p);
    });
    const out = await f.read(),
      shapes = out.layers[0].keys[0].shapes;
    expect(shapes.map((s) => s.id)).toEqual(f.p.layers[0].keys[0].shapes.map((s) => s.id));
    expect(shapes.map(count)).toEqual(f.p.layers[0].keys[0].shapes.map(count));
    await expect.poll(() => f.pixel(140, 40)).toEqual([255, 0, 0, 255]);
    const paint = shapes.find((s) => s.fillEnabled !== false)!,
      stroke = shapes.find((s) => s.fillEnabled === false)!;
    expect(worldNodes(paint)[0].out).toEqual(worldNodes(stroke)[0].out);
    await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });

test('an attached fill stays with repeated tangent/curve changes without adding vertices', async ({
  page,
}) => {
  const f = await setup(page, 'merge', true);
  await f.select();
  await f.drag(100, 30, 0, -25);
  await expect.poll(() => f.pixel(140, 32)).toEqual([255, 0, 0, 255]);
  const first = await f.read();
  expect(first.layers[0].keys[0].shapes.map(count)).toEqual(
    f.p.layers[0].keys[0].shapes.map(count),
  );
  // At t=.5 the first control move shifts the original curve by .375*25.
  await f.drag(140, 37.5 - 25 * 0.375, 0, -15);
  const second = await f.read();
  expect(second.layers[0].keys[0].shapes.map(count)).toEqual(
    f.p.layers[0].keys[0].shapes.map(count),
  );
  expect(second.layers[0].keys[0].shapes[0]).not.toEqual(first.layers[0].keys[0].shapes[0]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(first);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('anchor drag and keyboard nudge move the attached fill corner and retain selection', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  await f.drag(40, 60, 10, -10);
  let out = await f.read();
  expect(worldNodes(out.layers[0].keys[0].shapes[0])[0]).toMatchObject({ x: 50, y: 50 });
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  out = await f.read();
  expect(worldNodes(out.layers[0].keys[0].shapes[0])[0]).toMatchObject({ x: 51, y: 50 });
  expect(worldNodes(out.layers[0].keys[0].shapes[1])[0]).toMatchObject({ x: 51, y: 50 });
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
});

test('Escape and returning to the pickup restore both line and fill without history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  await f.drag(140, 60, 0, -40, true);
  expect(await f.read()).toEqual(f.p);
  await f.drag(140, 60, 0, -30, 'return');
  expect(await f.read()).toEqual(f.p);
  await f.drag(140, 60, 0, -30);
  const a = await f.read();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(a);
});

test('touching independent object-mode artwork does not acquire merge attachments', async ({
  page,
}) => {
  const f = await setup(page, 'object');
  await f.select();
  await f.drag(140, 60, 0, -30);
  const out = await f.read();
  expect(out.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
  await expect.poll(() => f.pixel(140, 40)).toEqual([255, 255, 255, 255]);
});

test('a genuinely merged closed Pen seam moves its duplicate endpoint and fill corner together', async ({
  page,
}) => {
  const f = await setup(page, 'merge', false, true);
  await f.select();
  await f.drag(40, 60, 10, -10);
  const out = await f.read(),
    shapes = out.layers[0].keys[0].shapes;
  const paint = shapes.find((s) => s.fillEnabled !== false)!,
    stroke = shapes.find((s) => s.fillEnabled === false)!;
  expect(shapes.map(count)).toEqual(f.p.layers[0].keys[0].shapes.map(count));
  expect(worldNodes(paint)[0]).toMatchObject({ x: 50, y: 50 });
  expect(worldNodes(stroke)[0]).toMatchObject({ x: 50, y: 50 });
  expect(worldNodes(stroke).at(-1)).toMatchObject({ x: 50, y: 50 });
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const nudged = await f.read(),
    line = nudged.layers[0].keys[0].shapes.find((s) => s.fillEnabled === false)!;
  expect(worldNodes(line)[0]).toMatchObject({ x: 51, y: 50 });
  expect(worldNodes(line).at(-1)).toMatchObject({ x: 51, y: 50 });
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(out);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for(const scope of ['scene','symbol'] as const) {
  test(`Subselection Apply settles an attached Pencil curve once in ${scope}`,async({page})=>{
    const project=newProject();
    project.width=400;
    project.height=300;
    const line:Vector={id:'attached-pencil',kind:'bezier',x:40,y:60,width:200,height:30,rotation:0,
      fill:'#000000',stroke:'#223344',strokeWidth:4,points:[],fillEnabled:false,drawingMode:'merge',
      nodes:[{x:0,y:0,out:{x:60,y:-30}},{x:200,y:0,in:{x:140,y:-30}}]};
    const face:Vector={...line,id:'attached-fill',kind:'polygon',height:100,fill:'#ff0000',fillEnabled:true,
      strokeWidth:0,nodes:undefined,closed:true,fillRule:'evenodd',
      contours:[[...structuredClone(line.nodes!),{x:200,y:100},{x:0,y:100}]]};
    const neighbor:Vector={...face,id:'neighbor',x:302,y:165,width:50,height:35,fill:'#12ab34',
      contours:[[{x:0,y:0,out:{x:16,y:-2}},{x:50,y:0,in:{x:34,y:-2}},{x:50,y:35},{x:0,y:35}]]};
    const original=[face,line,neighbor];
    project.layers[0].drawingMode=scope==='scene'?'merge':'object';
    if(scope==='symbol'){
      const definition:SymbolDefinition={id:'attached-apply',name:'Attached Apply',width:400,height:300,shapes:original};
      project.symbols=[definition];
      project.layers[0].keys[0].shapes=[symbolInstance(definition,0,0)];
    }else project.layers[0].keys[0].shapes=original;
    validateProject(project);
    await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',
      JSON.stringify({project:p,folder:null,manifest:null})),project);
    await page.goto('/');
    await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    const canvas=page.getByLabel('Drawing stage',{exact:true});
    const workspace=page.getByRole('main',{name:'Symbol editing workspace',exact:true});
    const at=async(x:number,y:number)=>{
      const bounds=(await canvas.boundingBox())!;
      return [bounds.x+(bounds.width-400)/2+x,bounds.y+(bounds.height-300)/2+y] as const;
    };
    if(scope==='symbol'){
      await page.mouse.dblclick(...await at(320,184));
      await expect(workspace).toBeVisible();
    }
    await page.getByRole('button',{name:'Subselection',exact:true}).click();
    const paint=()=>canvas.evaluate(el=>{
      const c=el as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData((c.width-400)/2+140,(c.height-300)/2+32,1,1).data];
    });
    const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project));
    const originalProject=await read();
    const red=[255,0,0,255], white=[255,255,255,255];
    const apply=page.getByRole('group',{name:'Active drawing tool options'}).getByRole('button',{name:'Apply',exact:true});
    const bend=async(cancel:boolean)=>{
      await page.mouse.move(...await at(140,37.5));
      await page.mouse.down();
      await page.mouse.move(...await at(140,17.5),{steps:5});
      await expect.poll(paint).toEqual(red);
      if(cancel)await canvas.press('Escape');
      await page.mouse.up();
    };
    await expect.poll(paint).toEqual(white);
    await page.mouse.click(...await at(40,60));
    await bend(true);
    await expect.poll(paint).toEqual(white);
    expect(await read()).toEqual(originalProject);
    await page.mouse.click(...await at(40,60));
    await bend(false);
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(apply).toBeDisabled();
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert','');
    await expect.poll(paint).toEqual(red);
    if(scope==='symbol'){
      expect(await read()).toEqual(originalProject);
      await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
      await expect(workspace).toHaveCount(0);
    }
    const changed=await read(), artwork=scope==='symbol'?changed.symbols![0].shapes:changed.layers[0].keys[0].shapes;
    const savedLine=artwork.find(s=>s.id===line.id)!, savedFace=artwork.find(s=>s.id===face.id)!;
    expect([count(savedLine),count(savedFace)]).toEqual([2,4]);
    const curve=worldNodes(savedLine), fill=worldNodes(savedFace);
    expect(fill.slice(0,2)).toEqual(curve);
    expect(curve[0].out?.y).toBeLessThan(worldNodes(line)[0].out!.y);
    expect(artwork.find(s=>s.id===neighbor.id)).toEqual(neighbor);
    expect(savedLine.strokeWidth).toBe(line.strokeWidth);
    if(scope==='symbol')expect(changed.layers).toEqual(project.layers);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(originalProject);
    await canvas.press('Control+Shift+z');
    await expect.poll(read).toEqual(changed);
  });
}
