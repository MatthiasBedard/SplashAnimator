import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector, newLayer } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';

async function setup(
  page: Page,
  mode: 'object' | 'merge' | 'symbol' | 'movie' = 'object',
  end = true,
  one = false,
  shapePaint = false,
  artwork: 'plain' | 'paint' | 'bitmap' = 'plain',
  animatedGraphic = false,
  remembered = false,
) {
  const p = newProject();
  p.width = 300;
  p.height = 200;
  p.duration = one ? 1 : 12;
  p.fps = 4;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  let shapes = [art];
  if (artwork === 'paint')
    shapes = [
      {
        ...art,
        kind: 'polygon',
        fillRule: 'evenodd',
        width: 80,
        height: 60,
        contours: [
          [
            { x: 0, y: 0 },
            { x: 80, y: 0 },
            { x: 80, y: 60 },
            { x: 0, y: 60 },
          ],
          [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 40 },
            { x: 20, y: 40 },
          ],
        ],
        drawingMode: 'merge',
      },
      {
        ...art,
        id: 'pencil',
        kind: 'bezier',
        x: 120,
        width: 60,
        height: 30,
        fillEnabled: false,
        stroke: '#0000ff',
        strokeWidth: 4,
        nodes: [
          { x: 0, y: 0, out: { x: 20, y: 30 } },
          { x: 60, y: 0, in: { x: 40, y: 30 } },
        ],
        drawingMode: 'merge',
      },
    ];
  if (artwork === 'bitmap') {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 2, 2);
      return c.toDataURL();
    });
    p.assets = [
      {
        id: 'bitmap',
        path: 'assets/bitmaps/bitmap.json',
        bitmap: { name: 'Blue', width: 2, height: 2, dataUrl },
      },
    ];
    shapes = [{ ...art, bitmap: { assetId: 'bitmap', x: 0, y: 0, width: 40, height: 40 } }];
  }
  if (mode === 'symbol' || mode === 'movie') {
    const definition = {
      id: 'existing',
      name: 'Existing',
      width: 40,
      height: 40,
      shapes: [{ ...art, x: 0, y: 0 }],
      ...(animatedGraphic ? {
        timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, x: 0, y: 0, fill: '#0000ff' }] }] },
      } : {}),
    };
    p.symbols = [definition];
    const instance = symbolInstance(definition, 20, 30);
    instance.symbolPlayback = { mode: mode === 'movie' ? 'movie' : animatedGraphic ? 'loop' : 'single', firstFrame: 0 };
    shapes = [instance];
  }
  p.layers[0].drawingMode = mode === 'merge' ? 'merge' : 'object';
  p.layers[0].keys = [
    { frame: 0, shapes },
    ...(end && !one
      ? [
          {
            frame: 8,
            shapes: shapes.map((s) => ({
              ...structuredClone(s),
              x: 100,
              y: 70,
              ...(shapePaint ? { width: 80, height: 60, fill: '#0000ff' } : {}),
            })),
          },
          { frame: 10, shapes: [] },
        ]
      : []),
  ];
  p.layers.push(newLayer('Other'));
  if (remembered) createBasicMotionSpan(p, [p.layers[0].id], 0, 8, 'linear');
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
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  async function point(at: number) {
    const b = (await timeline.boundingBox())!;
    return { x: b.x + at * 18 + 9, y: b.y + 25 + 28 + 14 };
  }
  async function seek(at: number) {
    const q = await point(at);
    await page.mouse.click(q.x, q.y);
  }
  async function convert(kind: 'motion' | 'shape', at = 0) {
    const q = await point(at);
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await page.getByRole('menuitem', { name: `Convert to ${kind} tween`, exact: true }).click();
  }
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (c: HTMLCanvasElement, { x, y }) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - 150) * devicePixelRatio),
              Math.round(c.height / 2 + (y - 100) * devicePixelRatio),
              1,
              1,
            ).data,
        ),
      { x, y },
    );
  return { p, timeline, canvas, point, seek, convert, read, pixel };
}

for (const [mode, remembered] of [['symbol', false], ['movie', false], ['symbol', true]] as const) {
  test(`Effects track ${mode} keyframes in a ${remembered ? 'remembered' : 'live'} motion tween`, async ({ page }) => {
    const f = await setup(page, mode, true, false, false, 'plain', false, remembered);
    if (!remembered) await f.convert('motion');
    const add = page.getByLabel('Add effect', { exact: true });
    const opacity = page.getByLabel('Object opacity', { exact: true });
    const tint = page.getByLabel('Instance tint amount', { exact: true });
    const blur = page.getByLabel(mode === 'movie' ? 'Movie clip blur radius' : 'Graphic blur radius', { exact: true });
    const editNumber = async (field: typeof opacity, value: string) => {
      await field.fill(value);
      await field.press('Tab');
    };
    async function editFrame(frame: number, x: number, y: number, amount: string, radius: string) {
      await f.seek(frame);
      const box = (await f.canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2 + x - 150, box.y + box.height / 2 + y - 100);
      await expect(add).toBeEnabled();
      await expect(opacity).toHaveCount(0);
      await expect(tint).toHaveCount(0);
      await expect(blur).toHaveCount(0);
      await add.selectOption('opacity');
      await editNumber(opacity, amount);
      await add.selectOption('tint');
      await page.getByLabel('Instance tint color', { exact: true }).fill('#0000ff');
      await editNumber(tint, amount);
      await add.selectOption('blur');
      await editNumber(blur, radius);
    }
    await editFrame(0, 38, 48, '100', '4');
    await editFrame(8, 115, 87, '20', '12');
    const track = (await f.read()).layers[0];
    const pose = (at: number) => track.keys.find(key => key.frame === at)!.shapes[0];
    expect(pose(0)).toMatchObject({ opacity: 1, instanceTint: { color: '#0000ff', amount: 1 }, instanceBlur: 4 });
    expect(pose(8)).toMatchObject({ opacity: 0.2, instanceTint: { color: '#0000ff', amount: 0.2 }, instanceBlur: 12 });
    if (remembered) expect(pose(4)).toMatchObject({ opacity: 0.6, instanceTint: { color: '#0000ff', amount: 0.6 }, instanceBlur: 8 });
    else expect(track.keys.map(key => key.frame)).toEqual([0, 8, 10]);
    await f.seek(4);
    await expect.poll(() => f.pixel(80, 69)).toEqual([163, 102, 194, 255]);
    await f.seek(8);
    await f.canvas.press('Control+z');
    await expect.poll(async () => (await f.read()).layers[0].keys.find(key => key.frame === 8)!.shapes[0].instanceBlur).toBe(4);
  });
}
test('live symbol blend uses the stage backdrop and switches at the destination key', async ({ page }) => {
  const f = await setup(page, 'symbol');
  await f.convert('motion');
  await f.seek(0);
  const box = (await f.canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 112, box.y + box.height / 2 - 52);
  await page.getByLabel('Add effect', { exact: true }).selectOption('blend');
  await page.getByLabel('Instance blend mode', { exact: true }).selectOption('screen');
  await f.seek(4);
  await expect.poll(() => f.pixel(80, 69)).toEqual([255, 255, 255, 255]);
  await f.seek(8);
  await expect.poll(() => f.pixel(120, 90)).toEqual([255, 0, 0, 255]);
});

for (const mode of ['object', 'merge', 'symbol'] as const)
  test(`one-click ${mode} motion tween has no options, uses one shared symbol, renders motion and has exact history`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.convert('motion');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const q = await f.read(),
      a = q.layers[0].keys[0].shapes[0],
      b = q.layers[0].keys[1].shapes[0];
    expect(q.symbols).toHaveLength(1);
    expect(a.kind).toBe('symbol');
    expect(a.symbolPlayback).toEqual({ mode: mode === 'symbol' ? 'single' : 'loop', firstFrame: 0 });
    expect(b.symbolPlayback).toEqual(a.symbolPlayback);
    expect(a.symbolId).toBe(b.symbolId);
    expect(a.id).toBe(b.id);
    expect(q.layers[0].liveMotionSpans).toHaveLength(1);
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    expect(q.layers[0].keys[2]).toEqual(f.p.layers[0].keys[2]);
    expect(q.layers[1]).toEqual(f.p.layers[1]);
    await expect
      .poll(() =>
        f.timeline.evaluate((c: HTMLCanvasElement) => {
          const b = c.getBoundingClientRect();
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.floor((57 * c.width) / b.width),
                Math.floor((59 * c.height) / b.height),
                1,
                1,
              ).data,
          );
        }),
      )
      .toEqual([96, 165, 250, 255]);
    if (mode === 'symbol') expect(q.symbols).toEqual(f.p.symbols);
    else
      expect(q.libraryLinks).toContainEqual(
        expect.objectContaining({ kind: 'symbol', id: a.symbolId }),
      );
    await f.seek(4);
    await expect.poll(() => f.pixel(80, 65)).toEqual([255, 0, 0, 255]);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });
for (const kind of ['motion', 'shape'] as const)
  test(`single-key ${kind} conversion sets the tween exposure without a popup`, async ({
    page,
  }) => {
    const f = await setup(page, 'object', false);
    await f.convert(kind);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const q = await f.read();
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual(kind === 'motion' ? [0] : [0, 11]);
    expect(q.duration).toBe(12);
    expect(q.layers[1]).toEqual(f.p.layers[1]);
    if (kind === 'shape') {
      expect(q.symbols).toEqual(f.p.symbols);
      expect(q.layers[0].keys[0]).toEqual(f.p.layers[0].keys[0]);
    }
    await f.seek(11);
    await expect.poll(() => f.pixel(35, 45)).toEqual([255, 0, 0, 255]);
    if (kind === 'motion') {
      expect(q.layers[0].liveMotionSpans).toBeUndefined();
      await expect(page.getByLabel('Motion tween layer', { exact: true })).toBeVisible();
      await f.seek(8);
      await f.timeline.press('F6');
      const finished = await f.read();
      expect(finished.layers[0].keys.map(key => key.frame)).toEqual([0, 8]);
      expect(finished.layers[0].liveMotionSpans).toEqual([expect.objectContaining({ start: 0, end: 8 })]);
      const position = page.getByLabel('Shape X', { exact: true });
      await position.fill('100');
      await position.press('Tab');
      await f.seek(4);
      await expect.poll(() => f.pixel(75, 45)).toEqual([255, 0, 0, 255]);
      await f.canvas.press('Control+z');
      await f.canvas.press('Control+z');
      await expect.poll(f.read).toEqual(q);
      const cell = await f.point(5);
      await page.mouse.click(cell.x, cell.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Remove motion tween', exact: true }).click();
      const unmarked = await f.read();
      expect(unmarked.layers[0].keys.map(key => key.frame)).toEqual([0]);
      expect(unmarked.layers[0].keys[0].openMotionTween).toBeUndefined();
    }
  });

test('one-click shape tween renders changing geometry/paint and the green span without symbol conversion', async ({
  page,
}) => {
  const f = await setup(page, 'object', true, false, true);
  await f.convert('shape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const q = await f.read();
  expect(q.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(q.symbols).toEqual(f.p.symbols);
  await f.seek(4);
  await expect.poll(() => f.pixel(85, 65)).toEqual([128, 0, 128, 255]);
  await expect
    .poll(() =>
      f.timeline.evaluate((c: HTMLCanvasElement) => {
        const b = c.getBoundingClientRect();
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.floor((57 * c.width) / b.width),
              Math.floor((59 * c.height) / b.height),
              1,
              1,
            ).data,
        );
      }),
    )
    .toEqual([74, 222, 128, 255]);
});
for (const kind of ['motion', 'shape'] as const)
  test(`one-frame ${kind} conversion uses the expected timeline duration`, async ({ page }) => {
    const f = await setup(page, 'object', false, true);
    await f.convert(kind);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const q = await f.read();
    expect(q.duration).toBe(kind === 'motion' ? 1 : 4);
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual(kind === 'motion' ? [0] : [0, 3]);
    if (kind === 'motion') expect(q.layers[0].liveMotionSpans).toBeUndefined();
    else expect(q.layers[0].liveMotionSpans![0]).toMatchObject({ start: 0, end: 3 });
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });
test('repeating conversion does not create another symbol or history entry', async ({ page }) => {
  const f = await setup(page);
  await f.convert('motion');
  const converted = await f.read();
  await f.convert('motion');
  expect(await f.read()).toEqual(converted);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('deleting frames removes a complete live tween and rejects a partial selection atomically', async ({ page }) => {
  const f = await setup(page);
  await f.convert('motion');
  const before = await f.read();
  const select = async (start: number, end: number) => {
    const a = await f.point(start);
    const b = await f.point(end);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  await select(2, 4);
  await f.timeline.press('Shift+F5');
  await expect(page.getByRole('alert')).toContainText('Select the complete live tween');
  expect(await f.read()).toEqual(before);
  await select(0, 8);
  await f.timeline.press('Shift+F5');
  const after = await f.read();
  expect(after.layers[0].liveMotionSpans).toBeUndefined();
  expect(after.layers[0].keys).toEqual([
    { ...before.layers[0].keys[1], frame: 0 }, { frame: 1, shapes: [] }, { frame: 3, shapes: [] },
  ]);
  expect(after.layers[1]).toEqual(before.layers[1]);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});
test('mixed merged paint and Pencil curves keep visible colors, holes and editable contour/handle data', async ({
  page,
}) => {
  const f = await setup(page, 'merge', false, false, false, 'paint');
  await f.convert('motion');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const q = await f.read();
  expect(q.symbols![0].shapes).toHaveLength(2);
  expect(q.symbols![0].shapes[0].contours).toEqual(f.p.layers[0].keys[0].shapes[0].contours);
  expect(q.symbols![0].shapes[1].nodes).toEqual(f.p.layers[0].keys[0].shapes[1].nodes);
  await expect.poll(() => f.pixel(30, 40)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(50, 60)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(150, 53)).toEqual([0, 0, 255, 255]);
  await expect
    .poll(() =>
      f.canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let blue = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] > 180) blue++;
        return blue;
      }),
    )
    .toBeGreaterThan(50);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
});
test('bitmap artwork converts without replacing the image, its Library asset or its mapping', async ({
  page,
}) => {
  const f = await setup(page, 'object', false, false, false, 'bitmap');
  await expect.poll(() => f.pixel(35, 45)).toEqual([0, 0, 255, 255]);
  await f.convert('motion');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const q = await f.read();
  expect(q.assets).toEqual(f.p.assets);
  expect(q.symbols![0].shapes[0].bitmap).toEqual(f.p.layers[0].keys[0].shapes[0].bitmap);
  await f.seek(11);
  await expect.poll(() => f.pixel(35, 45)).toEqual([0, 0, 255, 255]);
});
for (const at of [1, 4, 7])
  test(`F6 inside an automatically symbolized motion tween retains the shared symbol at frame ${at}`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.convert('motion');
    const before = await f.read();
    await f.seek(at);
    await f.timeline.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const q = await f.read(),
      key = q.layers[0].keys.find((k) => k.frame === at)!;
    expect(key).toBeTruthy();
    expect(key.shapes[0].symbolId).toBe(before.layers[0].keys[0].shapes[0].symbolId);
    expect(q.symbols).toEqual(before.symbols);
    await expect.poll(() => f.pixel(25 + at * 10, 35 + at * 5)).toEqual([255, 0, 0, 255]);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });
test('changing an inserted symbol key updates the real tween on both sides', async ({ page }) => {
  const f = await setup(page);
  await f.convert('motion');
  await f.seek(4);
  await f.timeline.focus();
  await page.keyboard.press('F6');
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2 - 150 + 75, b.y + b.height / 2 - 100 + 65);
  await page.getByLabel('Shape X', { exact: true }).fill('80');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const q = await f.read();
  expect(q.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x).toBe(80);
  await f.seek(2);
  await expect.poll(() => f.pixel(55, 45)).toEqual([255, 0, 0, 255]);
  await f.seek(6);
  await expect.poll(() => f.pixel(95, 65)).toEqual([255, 0, 0, 255]);
});
test('dragging on an automatically converted tween inserts a key and updates both sides', async ({ page }) => {
  const f = await setup(page);
  await f.convert('motion');
  await f.seek(4);
  await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
  const before = await f.read();
  const b = (await f.canvas.boundingBox())!;
  const x = b.x + b.width / 2 - 150 + 75, y = b.y + b.height / 2 - 100 + 65;
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const edited = await f.read();
  expect(edited.layers[0].keys.map(key => key.frame)).toEqual([0, 4, 8, 10]);
  expect(edited.layers[0].keys[1].shapes[0].x).toBe(80);
  expect(edited.layers[0].keys.filter(key => key.frame !== 4)).toEqual(before.layers[0].keys);
  expect(edited.symbols).toEqual(before.symbols);
  await f.seek(2);
  await expect.poll(() => f.pixel(55, 45)).toEqual([255, 0, 0, 255]);
  await f.seek(6);
  await expect.poll(() => f.pixel(95, 65)).toEqual([255, 0, 0, 255]);
});

for (const command of ['keyboard', 'context menu']) {
  test(`clearing a moved motion tween key rejoins the tween using the ${command}`, async ({ page }) => {
    const f = await setup(page);
    await f.convert('motion');
    const original = await f.read();
    await f.seek(4);
    await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
    const b = (await f.canvas.boundingBox())!;
    const x = b.x + b.width / 2 - 150 + 75, y = b.y + b.height / 2 - 100 + 65;
    await page.keyboard.down('Alt');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const moved = await f.read();
    expect(moved.layers[0].keys.map(key => key.frame)).toEqual([0, 4, 8, 10]);
    await f.seek(4);
    if (command === 'keyboard') {
      await f.timeline.focus();
      await page.keyboard.press('Shift+F6');
    } else {
      const p = await f.point(4);
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Remove keyframes', exact: true }).click();
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(f.read).toEqual(original);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(moved);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(original);
  });
}

test('a graphic playback change at a tween key takes effect at that key', async ({ page }) => {
  const f = await setup(page, 'symbol', true, false, false, 'plain', true);
  await f.convert('motion');
  const before = await f.read();
  await f.seek(4);
  await f.timeline.press('F6');
  const split = await f.read();
  const playback = page.getByLabel('Symbol playback', { exact: true });
  await playback.selectOption('single');
  await expect(playback).toHaveValue('single');
  const edited = await f.read();
  expect(edited.layers[0].keys.map(key => key.shapes[0]?.symbolPlayback?.mode))
    .toEqual(['loop', 'single', 'loop', undefined]);
  for (const [frame, color] of [[3, [0, 0, 255, 255]], [4, [255, 0, 0, 255]],
    [5, [255, 0, 0, 255]], [9, [0, 0, 255, 255]]] as const) {
    await f.seek(frame);
    await expect.poll(() => f.pixel(25 + Math.min(frame, 8) * 10, 35 + Math.min(frame, 8) * 5))
      .toEqual([...color]);
  }
  await f.seek(6);
  await f.timeline.press('F6');
  expect((await f.read()).layers[0].keys.map(key => key.frame)).toEqual([0, 4, 6, 8, 10]);
  await f.seek(7);
  await expect.poll(() => f.pixel(95, 70)).toEqual([255, 0, 0, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(edited);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(split);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});
test('a source edit after detached symbol/span creation rejects the entire automatic publication', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const native = structuredClone;
    Object.assign(window, { autoTweenHook: 0 });
    window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
      const result = Reflect.apply(native, window, [value, ...rest]) as Project;
      if (
        !(window as unknown as { autoTweenHook: number }).autoTweenHook &&
        result?.symbols?.some((s) => s.name === 'Tween 1') &&
        result.layers?.[0]?.liveMotionSpans?.length
      ) {
        (window as unknown as { autoTweenHook: number }).autoTweenHook++;
        const input = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
        input.value = 'User layer edit';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return result;
    }) as typeof native;
  });
  await f.convert('motion');
  expect(
    await page.evaluate(() => (window as unknown as { autoTweenHook: number }).autoTweenHook),
  ).toBe(1);
  const expected = structuredClone(f.p);
  expected.layers[0].name = 'User layer edit';
  expect(await f.read()).toEqual(expected);
  await expect(page.getByRole('alert')).toBeVisible();
});
