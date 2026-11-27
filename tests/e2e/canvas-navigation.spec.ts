import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { objectBounds } from '../../packages/geometry/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { liveSplitFixture } from '../live-motion-split-fixture';

test('freeform canvas resize stays a draft until Accept and keeps artwork through Undo', async ({ page }) => {
  const f = await setup(page);
  const toggle = page.locator('[aria-controls="dock-body-document"]');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const panel = page.locator('#dock-body-document');
  const open = panel.getByRole('button', { name: 'Resize canvas', exact: true });
  const handles = page.getByRole('group', { name: 'Canvas resize handles', exact: true });
  const width = panel.getByLabel('Width', { exact: true });
  const height = panel.getByLabel('Height', { exact: true });
  const drag = async (name: string, x: number, y: number) => {
    const box = (await handles.getByRole('button', { name: `Resize canvas from ${name}`, exact: true }).boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + x, start.y + y, { steps: 3 });
    await page.mouse.up();
  };

  await open.click();
  await expect(handles.getByRole('button')).toHaveCount(8);
  await expect(open).toHaveCount(0);
  const rightHandle = handles.getByRole('button', { name: 'Resize canvas from right', exact: true });
  const unpanned = (await rightHandle.boundingBox())!;
  const stage = (await f.canvas.boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(stage.x + stage.width / 2 + 15, stage.y + stage.height / 2);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await rightHandle.boundingBox())!.x).toBeCloseTo(unpanned.x + 15);
  const right = (await rightHandle.boundingBox())!;
  const outside = () => f.canvas.evaluate((canvas: HTMLCanvasElement, point) => {
    const rect = canvas.getBoundingClientRect();
    return Array.from(canvas.getContext('2d')!.getImageData(
      Math.round((point.x - rect.left) * canvas.width / rect.width),
      Math.round((point.y - rect.top) * canvas.height / rect.height), 1, 1,
    ).data);
  }, { x: right.x + 24, y: right.y + right.height / 2 });
  await expect.poll(outside).toEqual([0, 0, 0, 0]);
  await drag('bottom right', 60, 36);
  await expect(width).toHaveValue('660');
  await expect(height).toHaveValue('396');
  await expect.poll(outside).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(handles).toHaveCount(0);
  await expect(width).toHaveValue('600');
  await expect(height).toHaveValue('360');
  expect(await f.read()).toEqual(f.p);

  await open.click();
  await rightHandle.press('Shift+ArrowRight');
  await expect(width).toHaveValue('610');
  await expect(height).toHaveValue('360');
  await rightHandle.press('Escape');
  await expect(handles).toHaveCount(0);
  await expect(width).toHaveValue('600');
  expect(await f.read()).toEqual(f.p);

  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('0.5');
  await open.click();
  const opposite = handles.getByRole('button', { name: 'Resize canvas from bottom right', exact: true });
  const before = (await opposite.boundingBox())!;
  await drag('top left', -30, -20);
  await expect(width).toHaveValue('660');
  await expect(height).toHaveValue('400');
  const after = (await opposite.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
  await panel.getByRole('button', { name: 'Accept', exact: true }).click();
  const committed = { ...f.p, width: 660, height: 400 };
  expect(await f.read()).toEqual(committed);
  await expect(handles).toHaveCount(0);
  await expect(open).toBeFocused();

  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(committed);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(committed);
  expect(f.errors).toEqual([]);
});

test('canvas zoom preferences apply to the current view, zoom menu, wheel and Fit and persist after reload', async ({ page }) => {
  const f = await setup(page);
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  const openPreferences = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Preferences…', exact: true }).click();
  };
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  const min = preferences.getByLabel('Minimum canvas zoom (%)');
  const max = preferences.getByLabel('Maximum canvas zoom (%)');
  const edit = async (field: typeof min, value: string) => {
    await field.fill(value);
    await field.press('Tab');
  };
  await openPreferences();
  await expect(min).toHaveValue('5');
  await expect(max).toHaveValue('2000');
  await edit(min, '2.5');
  await edit(max, '2500');
  await preferences.getByRole('button', { name: 'Done' }).click();
  await zoom.selectOption('0.025');
  await expect(zoom).toHaveValue('0.025');
  await zoom.selectOption('25');
  await expect(zoom).toHaveValue('25');

  await openPreferences();
  await edit(min, '125');
  await edit(max, '100');
  await expect(max).toHaveValue('125');
  await edit(max, '150');
  await preferences.getByRole('button', { name: 'Done' }).click();
  await expect(zoom).toHaveValue('1.25');
  await expect(zoom.locator('option')).toHaveText(['125%', '150%']);
  await zoom.selectOption('1.5');
  await f.canvas.hover();
  await page.mouse.wheel(0, -100);
  await expect(zoom).toHaveValue('1.5');
  await page.mouse.wheel(0, 100);
  await expect(zoom).toHaveValue('1.25');
  await page.mouse.wheel(0, 100);
  await expect(zoom).toHaveValue('1.25');
  await zoom.selectOption('1.5');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(zoom).toHaveValue('1.25');
  expect(await f.read()).toEqual(f.p);

  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect(zoom).toHaveValue('1.25');
  await openPreferences();
  await expect(min).toHaveValue('125');
  await expect(max).toHaveValue('150');
  expect(f.errors).toEqual([]);
});

test('zoom menu, pointer wheel and Zoom tool reach 2000% without changing artwork', async ({
  page,
}) => {
  const p = newProject();
  p.width = 600;
  p.height = 360;
  p.layers[0].keys[0].shapes = [
    {
      id: 'zoom-art',
      kind: 'rectangle',
      x: 298,
      y: 178,
      width: 4,
      height: 4,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const f = await setup(page, p),
    zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await zoom.selectOption('20');
  await expect(zoom).toHaveValue('20');
  const centre = () =>
    f.canvas.evaluate((c: HTMLCanvasElement) =>
      Array.from(
        c.getContext('2d')!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1)
          .data,
      ),
    );
  await expect.poll(centre).toEqual([255, 0, 0, 255]);
  await zoom.selectOption('4');
  const wheelBox = (await f.canvas.boundingBox())!;
  await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(4);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(4, 10);
  await zoom.selectOption('4');
  await f.canvas.evaluate((c) => {
    const r = c.getBoundingClientRect();
    for (let i = 0; i < 15; i++)
      c.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -120,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
        }),
      );
  });
  await expect(zoom).toHaveValue('20');
  await expect.poll(centre).toEqual([255, 0, 0, 255]);
  await zoom.selectOption('16');
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  const rect = (await f.canvas.boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(zoom).toHaveValue('20');
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(zoom).toHaveValue('20');
  await page.keyboard.down('Alt');
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.keyboard.up('Alt');
  await expect(zoom).toHaveValue('16');
  await expect.poll(centre).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

async function setup(page: Page, project?: Project) {
  const p = project ?? newProject();
  if (!project) {
    p.width = 600;
    p.height = 360;
    p.layers[0].keys[0].shapes = [
      {
        id: 'art',
        kind: 'rectangle',
        x: 250,
        y: 190,
        width: 40,
        height: 30,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      },
    ];
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (p) => {
      if (!localStorage.getItem('splash-recovery-v1')) {
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        );
      }
    },
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    h = page.getByRole('scrollbar', { name: 'Canvas horizontal scrollbar', exact: true }),
    v = page.getByRole('scrollbar', { name: 'Canvas vertical scrollbar', exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await canvas.evaluate((c) =>
    c.addEventListener('pointerdown', (e) => {
      (c as HTMLCanvasElement).dataset.pointer = String((e as PointerEvent).pointerId);
    }),
  );
  return { p, canvas, h, v, read, errors };
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (node, { p, x, y }) => {
      const c = node as HTMLCanvasElement,
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
}
test('stage rotation aligns drawing and selection, anchors zoom and resets without history', async ({ page }) => {
  const fixture = newProject();
  fixture.width = 600;
  fixture.height = 360;
  fixture.guides = [{ id: 'rotation-guide', axis: 'x', position: 340 }];
  fixture.layers[0].keys[0].shapes = [
    { id: 'art', kind: 'rectangle', x: 250, y: 190, width: 40, height: 30, rotation: 0,
      fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] },
  ];
  const f = await setup(page, fixture);
  const menu = page.getByRole('button', { name: 'View', exact: true });
  const right = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  const rect = (await f.canvas.boundingBox())!;
  const screen = (x: number, y: number) => ({
    x: rect.x + rect.width / 2 + x,
    y: rect.y + rect.height / 2 + y,
  });
  const centerPixel = (x: number, y: number) => pixel(page, f.p, 300 + x, 180 + y);
  const red = [255, 0, 0, 255];
  await expect.poll(() => centerPixel(-30, 25)).toEqual(red);
  await menu.click();
  for (let i = 0; i < 6; i++) await right.click();
  await menu.click();
  await expect.poll(() => centerPixel(-25, -30)).toEqual(red);
  expect(await f.read()).toEqual(f.p);

  const pivot = screen(-25, -30);
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.wheel(0, -100);
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
  await expect.poll(() => centerPixel(-25, -30)).toEqual(red);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(1, 8);

  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pivot.x + 30, pivot.y - 20);
  await expect.poll(() => centerPixel(5, -50)).toEqual(red);
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => centerPixel(-25, -30)).toEqual(red);
  expect(await f.read()).toEqual(f.p);

  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 45, pivot.y + 70, { steps: 6 });
  await expect.poll(() => centerPixel(29, 48)).toEqual(red);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await expect.poll(async () => {
    const [art] = (await f.read()).layers[0].keys[0].shapes;
    return [art.x, art.y].map(Math.round);
  }).toEqual([320, 145]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const from = screen(-55, 37);
  const to = screen(-78, 83);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const art = (await f.read()).layers[0].keys[0].shapes.find((shape) => shape.id !== 'art');
    return art && [art.x, art.y, art.width, art.height].map(Math.round);
  }).toEqual([340, 235, 43, 23]);

  await menu.click();
  await page.getByRole('button', { name: 'Reset stage view rotation', exact: true }).click();
  await menu.click();
  await expect.poll(() => centerPixel(-30, 25)).toEqual(red);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('rotated rulers create document-axis guides through the pasteboard and Undo', async ({ page }) => {
  const f = await setup(page);
  const menu = page.getByRole('button', { name: 'View', exact: true });
  const right = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  await menu.click();
  for (let i = 0; i < 6; i++) await right.click();
  await menu.click();
  const rect = (await f.canvas.boundingBox())!;
  const drag = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(rect.x + from[0], rect.y + from[1]);
    await page.mouse.down();
    await page.mouse.move(rect.x + to[0], rect.y + to[1], { steps: 6 });
    await page.mouse.up();
  };
  const midX = rect.width / 2;
  const midY = rect.height / 2;
  const guides = async () =>
    (await f.read()).guides?.map(({ axis, position }) => [axis, Math.round(position)]) ?? [];
  const hasColor = (x: number, y: number, kind: 'tick' | 'guide') =>
    f.canvas.evaluate((canvas: HTMLCanvasElement, { x, y, kind }) => {
      const d = devicePixelRatio;
      const pixels = canvas.getContext('2d')!.getImageData(
        Math.round(x * d) - 2, Math.round(y * d) - 2,
        Math.round((kind === 'guide' ? 24 : 4) * d), Math.round(4 * d),
      ).data;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (kind === 'tick' ? r > 140 && g > 140 && b > 140 : r < 48 && g > 96 && b > 112)
          return true;
      }
      return false;
    }, { x, y, kind });
  await expect.poll(() => hasColor(midX + 80, 17, 'tick')).toBe(true);
  await drag([midX + 75, 10], [midX + 75, midY + 60]);
  await expect.poll(guides).toEqual([['x', 360]]);
  await expect.poll(() => hasColor(midX - 230, midY + 60, 'guide')).toBe(true);
  await drag([10, midY], [midX - 40, midY]);
  await expect.poll(guides).toEqual([['x', 360], ['y', 220]]);
  const withBoth = await f.read();

  await page.mouse.move(rect.x + midX + 75, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + midX + 75, rect.y + midY + 100);
  expect(await f.read()).toEqual(withBoth);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await drag([midX + 75, 10], [midX + 90, 10]);
  expect(await f.read()).toEqual(withBoth);

  await drag([midX + 75, midY + 60], [midX + 75, 10]);
  await expect.poll(guides).toEqual([['y', 220]]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(withBoth);
  await f.canvas.press('Control+z');
  await expect.poll(guides).toEqual([['x', 360]]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('a rotated selection handle scales in document coordinates and PNG uses that geometry', async ({ page }) => {
  const f = await setup(page);
  const menu = page.getByRole('button', { name: 'View', exact: true });
  const right = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  await menu.click();
  for (let i = 0; i < 6; i++) await right.click();
  await menu.click();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const rect = (await f.canvas.boundingBox())!;
  const midX = rect.x + rect.width / 2, midY = rect.y + rect.height / 2;
  await page.mouse.click(midX - 25, midY - 30);
  await page.mouse.move(midX - 40, midY - 10);
  await page.mouse.down();
  await page.mouse.move(midX - 60, midY + 10, { steps: 6 });
  await expect.poll(() => pixel(page, f.p, 250, 186)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  await expect.poll(async () => {
    const { left, top, right, bottom } = objectBounds((await f.read()).layers[0].keys[0].shapes[0]);
    return [left, top, right, bottom].map(Math.round);
  }).toEqual([250, 190, 310, 240]);
  const scaled = await f.read();

  await page.getByRole('button', { name: 'File', exact: true }).click();
  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await png).path())!);
  const output = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const sample = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return { size: [canvas.width, canvas.height], pixels: [sample(304, 233), sample(320, 233), sample(250, 186)] };
  }, 'data:image/png;base64,' + bytes.toString('base64'));
  expect(output).toEqual({
    size: [600, 360],
    pixels: [[255, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]],
  });
  expect(await f.read()).toEqual(scaled);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(scaled);
  expect(f.errors).toEqual([]);
});

test('motion path edits and node hints follow the rotated stage camera', async ({ page }) => {
  const p = newProject();
  p.width = 320;
  p.height = 240;
  p.duration = 6;
  const start: Vector = {
    id: 'motion-ink', kind: 'bezier', x: 100, y: 100, width: 100, height: 50, rotation: 0,
    fill: '#ff0000', fillEnabled: false, stroke: '#ff0000', strokeWidth: 4, points: [],
    nodes: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [start] },
    { frame: 4, shapes: [{ ...start, x: 180, y: 130, nodes: [
      { x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 25, y: 75 },
    ] }] },
  ];
  const f = await setup(page, p);
  const timeline = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(timeline.x + 9, timeline.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(timeline.x + 81, timeline.y + 40);
  await page.keyboard.up('Shift');

  const menu = page.getByRole('button', { name: 'View', exact: true });
  const right = page.getByRole('button', { name: 'Rotate stage view right', exact: true });
  const left = page.getByRole('button', { name: 'Rotate stage view left', exact: true });
  await menu.click();
  for (let i = 0; i < 6; i++) await right.click();
  await menu.click();
  const rotateDuringEdit = async () => {
    await menu.evaluate((el: HTMLButtonElement) => el.click());
    await right.evaluate((el: HTMLButtonElement) => el.click());
    await menu.evaluate((el: HTMLButtonElement) => el.click());
  };
  const center = async (marker: ReturnType<Page['locator']>) => {
    const box = (await marker.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const expectQuarterTurn = async (marker: ReturnType<Page['locator']>, x: number, y: number) => {
    const c = await center(f.canvas);
    const m = await center(marker);
    expect(m.x - c.x).toBeCloseTo(120 - y, 1);
    expect(m.y - c.y).toBeCloseTo(x - 160, 1);
  };
  await page.getByLabel('Motion path', { exact: true }).check();
  const stagePath = page.getByLabel('Edit motion path on stage', { exact: true });
  await stagePath.check();
  const handle = page.getByRole('button', { name: 'Stage motion path start handle', exact: true });
  await expectQuarterTurn(handle, 100, 0);
  const grab = await center(handle);
  await page.mouse.move(grab.x + 2, grab.y - 1);
  await page.mouse.down();
  await page.mouse.move(grab.x - 10, grab.y + 25);
  await page.mouse.up();
  const startX = page.getByLabel('Motion path Start X', { exact: true });
  const startY = page.getByLabel('Motion path Start Y', { exact: true });
  const path = async () => [Number(await startX.inputValue()), Number(await startY.inputValue())];
  await expect.poll(path).toEqual([26, -88]);
  await expectQuarterTurn(handle, 126, 12);

  const moved = await center(handle);
  await page.mouse.move(moved.x, moved.y);
  await page.mouse.down();
  await page.mouse.move(moved.x + 10, moved.y + 20);
  await expect.poll(path).toEqual([46, -98]);
  await rotateDuringEdit();
  await page.mouse.move(moved.x + 12, moved.y + 23);
  await page.mouse.up();
  await expect.poll(path).toEqual([26, -88]);
  expect(await f.read()).toEqual(p);

  const turnBack = async () => {
    await menu.click();
    await left.click();
    await menu.click();
  };
  await turnBack();
  const stageCenter = await center(f.canvas);
  await page.getByLabel('Stage motion path draw freehand', { exact: true }).click();
  await page.mouse.move(stageCenter.x + 10, stageCenter.y - 30);
  await page.mouse.down();
  await page.mouse.move(stageCenter.x - 7, stageCenter.y - 10);
  await page.mouse.up();
  const waypoint = (name: string) => page.getByLabel(`Motion path waypoint ${name}`, { exact: true });
  await expect(waypoint('1 x')).toHaveValue('30');
  await expect(waypoint('1 y')).toHaveValue('10');
  await expect(waypoint('2 x')).toHaveValue('50');
  await expect(waypoint('2 y')).toHaveValue('27');
  await stagePath.uncheck();
  await page.getByLabel('Motion path', { exact: true }).uncheck();
  await page.getByLabel('Motion interpolate curve nodes', { exact: true }).check();
  await page.getByLabel('Motion match straight nodes', { exact: true }).check();
  await page.getByLabel('Edit node hints on stage', { exact: true }).check();
  const source = page.getByRole('button', { name: 'Stage motion source node 1', exact: true });
  await expectQuarterTurn(source.locator('circle'), 150, 100);
  await source.locator('circle').click();
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  await rotateDuringEdit();
  await expect(source).toHaveAttribute('aria-pressed', 'false');
  await turnBack();
  await source.locator('circle').click();
  await page.getByLabel('Stage motion endpoint', { exact: true }).selectOption('1');
  const target = page.getByRole('button', { name: 'Stage motion target node 1', exact: true });
  await expectQuarterTurn(target.locator('circle'), 205, 130);
  await target.locator('circle').click();
  await page.getByRole('button', { name: 'Stage motion add node pair', exact: true }).click();
  await expect(page.getByLabel('Motion node hints', { exact: true })).toHaveValue('1:1');
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Edit node hints on stage', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Generate motion in-betweens', exact: true }).click();
  await expect.poll(async () => (await f.read()).layers[0].keys.map(({ frame }) => frame)).toEqual([0, 1, 2, 3, 4]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('idle scene Pencil and Brush temporarily select while an active Brush stroke keeps capture', async ({ page }) => {
  await holdGeometry(page);
  const f = await setup(page);
  for (const name of ['Pencil', 'Brush']) {
    const tool = page.getByRole('button', { name, exact: true });
    await tool.click();
    await f.canvas.focus();
    const b = (await f.canvas.boundingBox())!;
    const x = b.x + b.width / 2 - 30, y = b.y + b.height / 2 + 25;
    await page.keyboard.down('Control');
    await expect(f.canvas).toHaveCSS('cursor', 'default');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 65, y + 10);
    await page.keyboard.up('Control');
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].x).toBe(315);
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
    expect(await pendingGeometry(page)).toBe(0);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  }
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  const b = (await f.canvas.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2 - 65;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 5);
  await page.keyboard.down('Control');
  await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
  await expect.poll(() => f.canvas.evaluate((node: HTMLCanvasElement) => node.hasPointerCapture(1))).toBe(true);
  await page.mouse.move(x + 75, y + 10);
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.mouse.click(x + 95, y + 45);
  await releaseGeometry(page);
  await expect(f.canvas).toHaveCSS('cursor', 'default');
  await page.keyboard.up('Control');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toHaveLength(2);
  const [art, brush] = (await f.read()).layers[0].keys[0].shapes;
  expect(art).toEqual(f.p.layers[0].keys[0].shapes[0]);
  expect(brush.kind).toBe('brush');
  expect(brush.points[brush.points.length - 1].x - brush.points[0].x).toBeCloseTo(75);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Space pans the focused stage without switching the current drawing tool', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const b = (await f.canvas.boundingBox())!;
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await f.canvas.focus();
  await page.keyboard.down('Space');
  await expect(f.canvas).toHaveCSS('cursor', 'grab');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(f.canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x + 30, y - 25);
  await page.keyboard.up('Space');
  await expect(f.canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x + 60, y - 50);
  await page.mouse.up();
  await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
  await expect.poll(() => pixel(page, f.p, 330, 155)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);

  await page.keyboard.down('Space');
  await page.mouse.move(x + 60, y - 50);
  await page.mouse.down();
  await page.mouse.move(x + 70, y - 60);
  await page.keyboard.press('Escape');
  await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
  expect(await f.canvas.evaluate(c => c.hasPointerCapture(Number(c.dataset.pointer)))).toBe(false);
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await f.read()).toEqual(f.p);

  const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
  await search.fill('ink');
  await search.press('End');
  await search.press('Space');
  await expect(search).toHaveValue('ink ');
  await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
  await page.mouse.move(x - 10, y + 15);
  await page.mouse.down();
  await page.keyboard.down('Space');
  await expect(f.canvas).toHaveCSS('cursor', 'crosshair');
  await page.mouse.move(x + 50, y + 15);
  await page.keyboard.up('Space');
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Space pans the isolated symbol canvas and keeps its drawing tool and artwork', async ({ page }) => {
  const p = newProject();
  p.symbols = [{ id: 'space-hand', name: 'Hand ink', width: 280, height: 180, shapes: [{
    id: 'existing-ink', kind: 'rectangle', x: 100, y: 55, width: 25, height: 20, rotation: 0,
    points: [], fill: '#ff0000', stroke: '#000000', strokeWidth: 0,
  }] }];
  const f = await setup(page, p);
  await page.getByRole('option', { name: 'Library item Hand ink', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const tool = page.getByLabel('Symbol canvas tool', { exact: true });
  await tool.selectOption('brush');
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const colorCenter = () => canvas.evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let count = 0, x = 0, y = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 255)
        continue;
      count++;
      x += (i / 4) % c.width;
      y += Math.floor(i / 4 / c.width);
    }
    return { x: x / count, y: y / count, count };
  });
  const before = await colorCenter();
  expect(before.count).toBeGreaterThan(100);
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect(canvas).toHaveCSS('cursor', 'grab');
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(x + 56, y - 35, { steps: 4 });
  await page.mouse.up();
  await expect(canvas).toHaveCSS('cursor', 'grab');
  const backing = await canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
  await expect.poll(async () => Math.abs((await colorCenter()).x - before.x - 56 * backing.width / rect.width))
    .toBeLessThan(1.5);
  expect(Math.abs((await colorCenter()).y - before.y + 35 * backing.height / rect.height)).toBeLessThan(1.5);
  await tool.focus();
  await expect(canvas).not.toHaveCSS('cursor', 'grab');
  await page.keyboard.up('Space');
  await expect(tool).toHaveValue('brush');
  await expect(page.getByLabel('Symbol artwork item', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(f.read).toEqual(p);
});

for (const tool of ['Pencil', 'Brush', 'Selection', 'Hand'])
  test(`middle-button drag pans with ${tool} without drawing or history`, async ({ page }) => {
    const f = await setup(page);
    await page.getByRole('button', { name: tool, exact: true }).click();
    await expect(f.h).toBeVisible();
    await expect(f.v).toBeVisible();
    const initial = Number(await f.h.getAttribute('aria-valuenow')),
      b = (await f.canvas.boundingBox())!;
    await expect.poll(() => pixel(page, f.p, 270, 205)).toEqual([255, 0, 0, 255]);
    await page.mouse.move(b.x + 200, b.y + 200);
    await page.mouse.down({ button: 'middle' });
    expect(
      await f.canvas.evaluate((c) =>
        (c as HTMLCanvasElement).hasPointerCapture(
          Number((c as HTMLCanvasElement).dataset.pointer),
        ),
      ),
    ).toBe(true);
    await page.mouse.move(b.x + 300, b.y + 160, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => pixel(page, f.p, 370, 165)).toEqual([255, 0, 0, 255]);
    expect(Number(await f.h.getAttribute('aria-valuenow'))).toBeCloseTo(initial - 100, 4);
    expect(
      await f.canvas.evaluate((c) =>
        (c as HTMLCanvasElement).hasPointerCapture(
          Number((c as HTMLCanvasElement).dataset.pointer),
        ),
      ),
    ).toBe(false);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
  });
test('native canvas scrollbars move the view in both axes and keyboard input never moves selected artwork', async ({
  page,
}) => {
  const f = await setup(page);
  const overflow = await f.h.evaluate((n) => ({ width: n.clientWidth, scroll: n.scrollWidth }));
  expect(overflow.scroll).toBeGreaterThan(overflow.width);
  await f.h.evaluate((n) => (n.scrollLeft += 80));
  await f.v.evaluate((n) => (n.scrollTop += 40));
  await expect.poll(() => pixel(page, f.p, 190, 165)).toEqual([255, 0, 0, 255]);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await f.h.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pixel(page, f.p, 140, 158)).toEqual([255, 0, 0, 255]);
  await f.v.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => pixel(page, f.p, 140, 198)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect
    .poll(
      async () =>
        Number(await f.h.getAttribute('aria-valuenow')) -
        Number(await f.h.getAttribute('aria-valuemax')) / 2,
    )
    .toBe(0);
  expect(f.errors).toEqual([]);
});
test('native scrollbar thumb can be dragged with the mouse', async ({ page }) => {
  const f = await setup(page),
    b = (await f.h.boundingBox())!,
    before = Number(await f.h.getAttribute('aria-valuenow'));
  await page.screenshot({ path: 'test-results/canvas-scrollbars.png' });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await f.h.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before + 20);
  expect(await f.read()).toEqual(f.p);
});
for (const reason of ['escape', 'cancel', 'loss', 'blur', 'resize'])
  test(`middle pan cleans native capture on ${reason} and leaves the view usable`, async ({
    page,
  }) => {
    const f = await setup(page),
      b = (await f.canvas.boundingBox())!;
    await page.mouse.move(b.x + 200, b.y + 200);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(b.x + 260, b.y + 180);
    if (reason === 'escape') await page.keyboard.press('Escape');
    else if (reason === 'resize') await page.setViewportSize({ width: 1400, height: 960 });
    else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else
      await f.canvas.evaluate((node, reason) => {
        const c = node as HTMLCanvasElement,
          id = Number(c.dataset.pointer);
        if (reason === 'loss') c.releasePointerCapture(id);
        else c.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: id }));
      }, reason);
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => pixel(page, f.p, 330, 185)).toEqual([255, 0, 0, 255]);
    expect(
      await f.canvas.evaluate((c) =>
        (c as HTMLCanvasElement).hasPointerCapture(
          Number((c as HTMLCanvasElement).dataset.pointer),
        ),
      ),
    ).toBe(false);
    await f.h.evaluate((n) => (n.scrollLeft += 40));
    await expect.poll(() => pixel(page, f.p, 290, 185)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('middle pan works on read-only live tween frames without inserting or editing keys', async ({
  page,
}) => {
  const p = liveSplitFixture(),
    f = await setup(page, p);
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const b = (await f.canvas.boundingBox())!,
    before = Number(await f.h.getAttribute('aria-valuenow'));
  await page.mouse.move(b.x + 200, b.y + 160);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x + 250, b.y + 200);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => Number(await f.h.getAttribute('aria-valuenow'))).toBe(before - 50);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('middle pan and scroll preserve a pending Pencil finish and its original document coordinates', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page);
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Separate Pencil objects', { exact: true }).check();
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.move(b.x + 200, b.y + 230);
  await page.mouse.down();
  await page.mouse.move(b.x + 320, b.y + 230, { steps: 40 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.move(b.x + 200, b.y + 150);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x + 260, b.y + 130);
  await page.mouse.up({ button: 'middle' });
  await f.h.evaluate((n) => (n.scrollLeft += 40));
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  const result = await f.read(),
    s = result.layers[0].keys[0].shapes[1];
  expect(s.kind).toBe('bezier');
  expect(s.x + s.nodes![0].x).toBeCloseTo(f.p.width / 2 + 200 - b.width / 2, 10);
  expect(s.y + s.nodes![0].y).toBeCloseTo(f.p.height / 2 + 230 - b.height / 2, 10);
  expect(result.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
  expect(f.errors).toEqual([]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('middle pan keeps selection and the preceding Undo entry after foreign pointer delivery', async ({ page }) => {
  const f = await setup(page);
  const shapeX = page.getByLabel('Shape X', { exact: true });
  await f.canvas.press('Control+a');
  await expect(shapeX).toHaveValue('250');
  await f.canvas.press('ArrowRight');
  await expect(shapeX).toHaveValue('251');
  const prior = await f.read();
  expect(prior.layers[0].keys[0].shapes[0].x).toBe(251);
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.move(b.x + 200, b.y + 200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x + 230, b.y + 180);
  const beforeForeign = await f.h.getAttribute('aria-valuenow');
  await f.canvas.evaluate(c => {
    for (const [type, buttons] of [['pointermove', 4], ['pointerup', 0]] as const) {
      c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 922,
        clientX: 470, clientY: 390, buttons }));
    }
  });
  expect(await f.h.getAttribute('aria-valuenow')).toBe(beforeForeign);
  expect(await f.canvas.evaluate(c => c.hasPointerCapture(Number(c.dataset.pointer)))).toBe(true);
  await page.mouse.move(b.x + 260, b.y + 160);
  await page.mouse.up({ button: 'middle' });
  expect(await f.canvas.evaluate(c => c.hasPointerCapture(Number(c.dataset.pointer)))).toBe(false);
  await expect(shapeX).toHaveValue('251');
  expect(await f.read()).toEqual(prior);
  await f.canvas.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Brush recovers after capture denial and blur discards an interrupted stroke', async ({ page }) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await f.canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2 - 55;
  await f.canvas.evaluate(node => {
    const nativeCapture = node.setPointerCapture.bind(node);
    node.setPointerCapture = () => {
      node.setPointerCapture = nativeCapture;
      throw new DOMException('Capture denied for this event', 'NotFoundError');
    };
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y, { steps: 5 });
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);

  await page.mouse.move(x, y + 30);
  await page.mouse.down();
  const hasCapture = () => f.canvas.evaluate(node => node.hasPointerCapture(Number(node.dataset.pointer)));
  expect(await hasCapture()).toBe(true);
  await page.mouse.move(x + 65, y + 30, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await hasCapture()).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);

  await page.mouse.move(x, y + 60);
  await page.mouse.down();
  expect(await hasCapture()).toBe(true);
  await page.mouse.move(x + 75, y + 60, { steps: 6 });
  await page.mouse.up();
  expect(await hasCapture()).toBe(false);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  await f.canvas.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
