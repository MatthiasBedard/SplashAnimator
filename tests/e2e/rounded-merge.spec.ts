import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { pathCommands } from '../../packages/geometry/src/drawing';
import { hitPart, worldPoint } from '../../packages/geometry/src';

const read = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
const curves = (s: Vector) => pathCommands(s).filter((c) => c[0] === 'C').length;
const count = (s: Vector) => s.contours?.flat().length ?? s.nodes?.length ??
  new Set(pathCommands(s).flatMap(command => command[0] === 'Z' ? [] : [command.slice(-2).join(',')])).size;
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    box = (await canvas.boundingBox())!;
  const p = await read(page);
  const at = (v: [number, number]) => ({
    x: box.x + (box.width - p.width) / 2 + v[0],
    y: box.y + (box.height - p.height) / 2 + v[1],
  });
  await page.mouse.move(at(from).x, at(from).y);
  await page.mouse.down();
  await page.mouse.move(at(to).x, at(to).y, { steps: 8 });
  await page.mouse.up();
}
async function setup(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Drawing mode', { exact: true })).toHaveValue('merge');
  // Creating a layer also makes the empty document recoverable for readbacks.
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Rounded rectangle', exact: true }).click();
  await page.getByLabel('Corner radius', { exact: true }).fill('24');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
}

for (const mode of ['merge', 'object'] as const)
  test(`moving overpaint away preserves the expected lower fill in ${mode} drawing`, async ({ page }) => {
    const project = newProject();
    project.width = 400;
    project.height = 300;
    project.layers[0].drawingMode = mode;
    await page.addInitScript(source => localStorage.setItem('splash-recovery-v1',
      JSON.stringify({ project: source, folder: null, manifest: null })), project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByLabel('Drawing mode', { exact: true }).selectOption(mode);
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const fill = page.getByLabel('Drawing fill', { exact: true });
    await fill.fill('#ff0000');
    await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
    await draw(page, [80, 100], [200, 180]);
    await expect.poll(async () => (await read(page)).layers[0].keys[0].shapes.length).toBe(1);
    const original = (await read(page)).layers[0].keys[0].shapes[0];
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await expect(page.getByLabel('Separate brush objects', { exact: true })).toBeChecked({ checked: mode === 'object' });
    await page.getByLabel('Brush size', { exact: true }).fill('24');
    await page.getByLabel('Brush simplify amount', { exact: true }).fill('50');
    await fill.fill('#0000ff');
    await draw(page, [140, 74], [140, 210]);
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    const pixel = (x: number, y: number) => canvas.evaluate((el, { x, y }) => {
      const c = el as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(c.width / 2 + (x - 200) * devicePixelRatio,
        c.height / 2 + (y - 150) * devicePixelRatio, 1, 1).data];
    }, { x, y });
    const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
    await expect.poll(async () => (await read(page)).layers[0].keys[0].shapes.length).toBe(mode === 'merge' ? 3 : 2);
    await canvas.press('Escape');
    await expect.poll(() => pixel(140, 145)).toEqual(blue);
    const overlapped = await read(page);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await draw(page, [140, 90], [290, 90]);
    await expect.poll(() => read(page)).not.toEqual(overlapped);
    await canvas.press('Escape');
    await expect.poll(() => pixel(140, 145)).toEqual(mode === 'merge' ? white : red);
    await expect.poll(() => pixel(290, 145)).toEqual(blue);
    await expect.poll(() => pixel(105, 145)).toEqual(red);
    const artwork = (await read(page)).layers[0].keys[0].shapes;
    const lower = artwork.filter(shape => shape.fill === '#ff0000');
    if (mode === 'object') expect(lower).toEqual([original]);
    else expect(lower).toHaveLength(2);
    await canvas.press('Control+z');
    await expect.poll(() => read(page)).toEqual(overlapped);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('Line splits Pencil and fills-only Eraser preserves the split ink', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(source => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: source, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const selectTool = (name: string) => page.getByRole('button', { name, exact: true }).click();
  const width = page.getByLabel('Drawing stroke width', { exact: true });
  const artwork = async () => (await read(page)).layers[0].keys[0].shapes;
  const owner = (shapes: Vector[], x: number, y: number, part: 'fill' | 'stroke') =>
    shapes.find(shape => hitPart(shape, { x, y }, 0) === part)?.id;
  await selectTool('Rectangle');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  await width.fill('0');
  await draw(page, [80, 100], [200, 180]);
  await expect.poll(artwork).toHaveLength(1);
  await selectTool('Pencil');
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#000000');
  await width.fill('2');
  await draw(page, [60, 145], [220, 145]);
  await expect.poll(async () => owner(await artwork(), 100, 145, 'stroke')).toBeDefined();
  const pencil = await artwork();
  await selectTool('Line');
  await width.fill('2');
  await draw(page, [140, 74], [140, 210]);

  const pencilSides = (shapes: Vector[]) => [100, 165].map(x => owner(shapes, x, 145, 'stroke'));
  expect(new Set(pencilSides(pencil)).size).toBe(1);
  await expect.poll(async () => owner(await artwork(), 140, 90, 'stroke')).toBeDefined();
  const crossed = await artwork();
  expect(new Set(pencilSides(crossed).filter(Boolean)).size).toBe(2);
  expect(owner(crossed, 140, 195, 'stroke')).toBeDefined();
  expect(owner(crossed, 100, 125, 'fill')).toBeDefined();
  expect(owner(crossed, 165, 125, 'fill')).toBeDefined();
  await selectTool('Eraser');
  await page.getByLabel('Eraser diameter', { exact: true }).fill('12');
  await page.getByLabel('Eraser mode', { exact: true }).selectOption('fills');
  await draw(page, [100, 106], [100, 148]);
  await expect.poll(async () => owner(await artwork(), 100, 125, 'fill')).toBeUndefined();
  const erased = await artwork();
  expect(new Set(pencilSides(erased).filter(Boolean)).size).toBe(2);
  // The eraser can introduce fill boundaries along the Pencil centerline.
  // Verify complete ink coverage and the original line crossing in both states.
  for (const shapes of [crossed, erased]) {
    const ink = shapes.filter(shape => shape.strokeWidth > 0);
    expect(ink.every(shape => shape.kind === 'path' && shape.fillEnabled === false &&
      shape.stroke === '#000000' && shape.strokeWidth === 2 && shape.points.length === 2)).toBe(true);
    const endpoints = ink.map(shape => shape.points.map(point => worldPoint(shape, point)));
    for (const [axis, fixedAxis, fixed, from, to, intersection] of [
      ['x', 'y', 145, 60, 220, 140], ['y', 'x', 140, 74, 210, 145],
    ] as const) {
      const runs = endpoints.filter(points => points.every(point => point[fixedAxis] === fixed))
        .map(points => points.map(point => point[axis]).sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0]);
      expect(runs[0][0]).toBe(from);
      expect(runs.at(-1)![1]).toBe(to);
      expect(runs.some(([, end]) => end === intersection)).toBe(true);
      for (let i = 1; i < runs.length; i++) expect(runs[i][0]).toBe(runs[i - 1][1]);
    }
  }
  expect(owner(erased, 165, 125, 'fill')).toBeDefined();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const fillPixels = () => stage.evaluate(el => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    return [100, 165].map(x => [...ctx.getImageData(canvas.width / 2 + (x - 200) * devicePixelRatio,
      canvas.height / 2 - 25 * devicePixelRatio, 1, 1).data]);
  });
  await expect.poll(fillPixels).toEqual([[255, 255, 255, 255], [255, 0, 0, 255]]);
  await stage.press('Control+z');
  await expect.poll(artwork).toEqual(crossed);
  await stage.press('Control+Shift+z');
  await expect.poll(artwork).toEqual(erased);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Bucket joins a directly drawn inset fill and Subselection keeps the edited Pencil endpoint', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(source => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: source, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const selectTool = (name: string) => page.getByRole('button', { name, exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const artwork = async () => (await read(page)).layers[0].keys[0].shapes;
  const fill = page.getByLabel('Drawing fill', { exact: true });
  const width = page.getByLabel('Drawing stroke width', { exact: true });
  const click = async (x: number, y: number) => {
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + (box.width - 400) / 2 + x, box.y + (box.height - 300) / 2 + y);
  };
  const colors = async () => {
    const shapes = await artwork();
    return [105, 140].map(x => shapes.find(shape => hitPart(shape, { x, y: 140 }, 0) === 'fill')?.fill);
  };
  await selectTool('Rectangle');
  await width.fill('0');
  await fill.fill('#ff0000');
  await draw(page, [80, 100], [200, 180]);
  await expect.poll(artwork).toHaveLength(1);
  await fill.fill('#0000ff');
  await draw(page, [125, 125], [155, 155]);
  await expect.poll(colors).toEqual(['#ff0000', '#0000ff']);
  const inset = await artwork();
  await selectTool('Paint bucket');
  await fill.fill('#ff0000');
  await click(140, 140);
  await expect.poll(artwork).toHaveLength(1);
  expect(await colors()).toEqual(['#ff0000', '#ff0000']);
  const joined = await artwork();
  expect(joined[0].contours?.length ?? 1).toBe(1);
  await stage.press('Control+z');
  await expect.poll(artwork).toEqual(inset);
  await stage.press('Control+Shift+z');
  await expect.poll(artwork).toEqual(joined);

  await selectTool('Pencil');
  await width.fill('2');
  await draw(page, [60, 145], [220, 145]);
  const inkAt = async (x: number) => (await artwork()).find(shape => hitPart(shape, { x, y: 145 }, 0) === 'stroke');
  await expect.poll(() => inkAt(65)).toBeDefined();
  const drawn = await artwork();
  const editedId = (await inkAt(65))!.id;
  await selectTool('Subselection');
  await click(65, 145);
  await draw(page, [60, 145], [52, 145]);
  await expect.poll(() => inkAt(54)).toBeDefined();
  const edited = await artwork();
  const pencil = edited.find(shape => shape.id === editedId)!;
  const commands = pathCommands(pencil);
  const start = commands[0];
  if (start[0] !== 'M') throw new Error('Expected the Pencil path to start with a move command');
  expect(worldPoint(pencil, { x: start[1], y: start[2] })).toEqual({ x: 52, y: 145 });
  expect(edited.filter(shape => shape.id !== editedId)).toEqual(drawn.filter(shape => shape.id !== editedId));
  await expect(page.getByLabel('Shape X', { exact: true })).toBeVisible();
  await stage.press('Control+z');
  await expect.poll(artwork).toEqual(drawn);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const tool of ['Rectangle', 'Brush'] as const)
  test(`${tool} removes covered lines by default and the toggle preserves them`, async ({ page }) => {
    const p = newProject();
    p.width = 500;
    p.height = 300;
    p.layers[0].drawingMode = 'merge';
    p.layers[0].keys[0].shapes = [{
      id: 'line', kind: 'path', x: 80, y: 140, width: 240, height: 0,
      rotation: 0, fill: '#000000', fillEnabled: false, stroke: '#000000', strokeWidth: 6,
      points: [{ x: 0, y: 0 }, { x: 240, y: 0 }],
    }];
    await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
      JSON.stringify({ project, folder: null, manifest: null })), p);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: tool, exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    if (tool === 'Brush') await page.getByLabel('Brush size', { exact: true }).fill('44');
    else await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
    const option = page.getByRole('checkbox', { name: 'Remove covered lines', exact: true });
    await expect(option).toBeChecked();
    const marks = async () => {
      const artwork = (await read(page)).layers[0].keys[0].shapes;
      return [110, 200, 290].map(x => artwork.some(s => hitPart(s, { x, y: 140 }, 0) === 'stroke'));
    };
    const paint = () => tool === 'Brush' ? draw(page, [200, 105], [200, 175]) : draw(page, [160, 100], [240, 180]);
    await paint();
    await expect.poll(marks).toEqual([true, false, true]);
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await stage.press('Control+z');
    await expect.poll(() => read(page)).toEqual(p);
    await option.uncheck();
    await paint();
    await expect.poll(() => read(page)).not.toEqual(p);
    expect(await marks()).toEqual([true, true, true]);
  });

for (const radius of [24, 1000])
  for (const stroke of [0, 2])
    test(`merged rounded rectangle saves compact genuine corners and survives history/recovery ${stroke}/${radius}`, async ({
      page,
    }) => {
      await setup(page);
      await page.getByLabel('Corner radius', { exact: true }).fill(String(radius));
      await page.getByLabel('Drawing stroke width', { exact: true }).fill(String(stroke));
      const before = await read(page);
      await draw(page, [100, 100], [300, 240]);
      await expect
        .poll(async () => (await read(page)).layers[1].keys[0].shapes.length)
        .toBe(stroke ? 2 : 1);
      const saved = await read(page),
        artwork = saved.layers[1].keys[0].shapes;
      const fill = artwork.find((s) => s.fillEnabled !== false)!;
      expect(curves(fill)).toBe(4);
      expect(count(fill)).toBe(radius === 24 ? 8 : 6);
      if (stroke) {
        const outline = artwork.find((s) => s.fillEnabled === false)!;
        expect(outline.kind).toBe('bezier');
        expect(count(outline)).toBe(radius === 24 ? 8 : 6);
      }
      const canvas = page.getByLabel('Drawing stage', { exact: true });
      const pixel = (x: number, y: number) =>
        canvas.evaluate(
          (n, { x, y, w, h }) => {
            const c = n as HTMLCanvasElement;
            return Array.from(
              c
                .getContext('2d')!
                .getImageData(
                  Math.round(c.width / 2 + (x - w / 2) * devicePixelRatio),
                  Math.round(c.height / 2 + (y - h / 2) * devicePixelRatio),
                  1,
                  1,
                ).data,
            );
          },
          { x, y, w: saved.width, h: saved.height },
        );
      await expect.poll(() => pixel(150, 140)).toEqual([255, 0, 0, 255]);
      expect(await pixel(102, 102)).toEqual([255, 255, 255, 255]);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(() => read(page)).toEqual(before);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => read(page)).toEqual(saved);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await read(page)).toEqual(saved);
    });

for (const stroke of [0, 2])
  test(`overlapping new paint retains the original rounded corners ${stroke}`, async ({ page }) => {
    await setup(page);
    await page.getByLabel('Drawing stroke width', { exact: true }).fill(String(stroke));
    await draw(page, [100, 100], [300, 240]);
    await expect
      .poll(async () => (await read(page)).layers[1].keys[0].shapes.length)
      .toBe(stroke ? 2 : 1);
    const before = await read(page);
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
    await draw(page, [260, 140], [350, 190]);
    await expect
      .poll(async () => JSON.stringify(await read(page)))
      .not.toBe(JSON.stringify(before));
    const fills = (await read(page)).layers[1].keys[0].shapes.filter(
      (s) => s.fillEnabled !== false,
    );
    expect(fills.reduce((n, s) => n + curves(s), 0)).toBe(4);
    expect(fills.reduce((n, s) => n + count(s), 0)).toBeLessThanOrEqual(16);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => read(page)).toEqual(before);
  });

test('new documents and layers default to Merge while explicit Object drawing stays available', async ({
  page,
}) => {
  await setup(page);
  const mode = page.getByLabel('Drawing mode', { exact: true });
  await mode.selectOption('object');
  await expect(mode).toHaveValue('object');
  await draw(page, [100, 100], [260, 200]);
  await expect.poll(async () => (await read(page)).layers[1].keys[0].shapes.length).toBe(1);
  const original = await read(page);
  expect(original.layers[1].keys[0].shapes[0].kind).toBe('rectangle');
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await expect(mode).toHaveValue('merge');
  expect((await read(page)).layers[1]).toEqual(original.layers[1]);
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await expect(mode).toHaveValue('merge');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(mode).toHaveValue('merge');
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect((await read(page)).layers[1]).toEqual(original.layers[1]);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(mode).toHaveValue('merge');
});

test('recovered Object mode and old omitted modes are not reinterpreted as Merge', async ({
  page,
}) => {
  const project = newProject();
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const mode = page.getByLabel('Drawing mode', { exact: true });
  await expect(mode).toHaveValue('object');
  expect((await read(page)).layers[0].drawingMode).toBeUndefined();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await expect(mode).toHaveValue('merge');
  expect((await read(page)).layers[0]).toEqual(project.layers[0]);
});
