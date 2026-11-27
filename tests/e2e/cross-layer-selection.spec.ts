import { expect, test, type Page } from '@playwright/test';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { type CrossLayerRebuilder } from '../../apps/editor/src/cross-layer-selection';
import { objectBounds } from '../../packages/geometry/src/layout';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { newProject, newLayer, type Project, type Vector } from '../../packages/document/src';
import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
const rect = (x: number, fill: string, id = 'same'): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y: 70,
  width: 40,
  height: 40,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
async function setup(page: Page, merge: boolean | 'both' = false, overlap = false, groups = false, masked: boolean | 'covered' | 'covered-merge' | 'partial' | 'partial-merge' | 'partial-merge-delete' | 'polygon' | 'curve' | 'polygon-mask' | 'masked-groups' = false, tween: boolean | 'affine' | 'movie' | 'movie-tree' | 'baked' | 'edited-baked' | 'affine-baked' = false) {
  let p = newProject();
  p.width = 400;
  p.height = 280;
  p.duration = 10;
  p.layers = [newLayer('Red'), newLayer('Blue'), newLayer('Hidden'), newLayer('Locked')];
  for (const [i, l] of p.layers.entries()) {
    l.id = 'l' + i;
    l.drawingMode = 'object';
    l.keys = [
      {
        frame: 0,
        shapes: [rect([40, 160, 100, 220][i], ['#ff0000', '#0000ff', '#00ff00', '#aa00aa'][i])],
      },
      { frame: 8, shapes: [] },
    ];
  }
  p.layers[0].keys[0].shapes.push({ ...rect(320, '#ff8800', 'island'), y: 200 });
  p.layers[2].visible = false;
  p.layers[3].locked = true;
  if (masked) {
    p.layers[2].visible = true;
    p.layers[3].locked = false;
    p.layers[3].keys[0].shapes[0] = {
      ...rect(110, '#ffffff'),
      width: 14,
      ...(masked === true ? { cornerRadius: 2 } : { y: 55, height: 80 }),
    };
    if (masked === 'covered' || masked === 'covered-merge')
      p.layers[3].keys[0].shapes[0] = { ...rect(90, '#ffffff'), y: 55, width: 80, height: 80 };
    if (masked === 'covered-merge' || masked === 'partial-merge' || masked === 'partial-merge-delete')
      p.layers[2].drawingMode = 'merge';
    if (masked === 'partial-merge' || masked === 'partial-merge-delete')
      p.layers[2].keys[0].shapes.push({ ...rect(190, '#ff00ff', 'hidden'), y: 170 });
    if (masked === 'partial-merge-delete')
      p.layers[2].keys[0].shapes.splice(1, 0, {
        ...rect(112, '#ffff00', 'peer'), y: 110, width: 8, height: 20,
      });
    if (masked === 'polygon')
      p.layers[2].keys[0].shapes[0] = {
        ...rect(100, '#00ff00'),
        kind: 'polygon',
        fillRule: 'evenodd',
        contours: [
          [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 40 }],
          [{ x: 14, y: 16 }, { x: 20, y: 16 }, { x: 20, y: 24 }, { x: 14, y: 24 }],
        ],
      };
    if (masked === 'curve') p.layers[2].keys[0].shapes[0].kind = 'ellipse';
    if (masked === 'polygon-mask' || masked === 'masked-groups')
      p.layers[3].keys[0].shapes[0] = {
        ...rect(90, '#ffffff'),
        kind: 'polygon', y: 55, width: 80, height: 80,
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 80 }],
      };
    if (masked === 'masked-groups') {
      const shapes = p.layers[2].keys[0].shapes;
      shapes[0].groups = ['paint'];
      shapes.push(
        { ...rect(106, '#ffff00', 'peer'), y: 76, width: 16, height: 20, groups: ['paint'] },
        { ...rect(100, '#aa00aa', 'partial'), y: 59, width: 12, height: 10, groups: ['protected'] },
        { ...rect(148, '#aa00aa', 'hidden'), y: 107, groups: ['protected'] },
      );
    }
    p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  }
  if (merge) p.layers[1].drawingMode = 'merge';
  if (merge === 'both') p.layers[0].drawingMode = 'merge';
  if (overlap) p.layers[0].keys[0].shapes.push({ ...rect(85, '#ff8800', 'occluder') });
  if (groups) {
    p.layers[0].keys[0].shapes[0].groups = ['original-group'];
    p.layers[0].keys[0].shapes.splice(1, 0, {
      ...rect(85, '#ff0000', 'peer'),
      groups: ['original-group'],
    });
    p.layers[1].keys[0].shapes[0].groups = ['original-group'];
  }
  if (tween) p.layers[1].keys[1].shapes = [rect(80, '#0000ff')];
  if (tween === 'baked' || tween === 'edited-baked' || tween === 'affine-baked') {
    createBasicMotionSpan(p, ['l1'], 0, 8, 'linear', { affine: tween !== 'baked' });
    if (tween === 'edited-baked') p.layers[1].keys[5].shapes[0].x++;
  } else if (tween) {
    p = prepareTimelineTween(p, 'l1', {
      start: 0, end: 8, kind: 'motion', symbolize: true,
      ease: 'linear', affine: tween === 'affine', createEndpoints: false,
    });
    if (tween === 'movie' || tween === 'movie-tree') {
      p.fps = 1;
      const definition = p.symbols![0];
      definition.timeline = {
        duration: 3,
        keys: ['#00ff00', '#ffff00'].map((fill, i) => ({
          frame: i + 1, shapes: definition.shapes.map(shape => ({ ...shape, fill })),
        })),
      };
      if (tween === 'movie-tree') {
        const child = { ...structuredClone(definition), id: 'nested', name: 'Nested movie' };
        p.symbols!.push(child);
        const instance = symbolInstance(child, 0, 0);
        instance.symbolPlayback = { mode: 'movie', firstFrame: 1 };
        definition.shapes = [instance];
        definition.timeline = {
          duration: 4,
          keys: [{ frame: 2, shapes: [] }, { frame: 3, shapes: [structuredClone(instance)] }],
        };
      }
      for (const key of p.layers[1].keys)
        key.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: tween === 'movie' ? 1 : 0 };
      p.layers[1].liveMotionSpans![0].symbolContinuity = tween === 'movie' ? 'movies' : 'movie-trees';
    }
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('cross-layer-test-seeded')) {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      sessionStorage.setItem('cross-layer-test-seeded', 'yes');
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: tween ? 9 : 4 * 18 + 9, y: 40 } });
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await expect(page.getByLabel('Selection layers', { exact: true })).toHaveCount(1);
  await page.getByLabel('Selection layers', { exact: true }).selectOption('visible');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    pos = async (x: number, y: number) => {
      const b = (await canvas.boundingBox())!;
      return { x: b.x + b.width / 2 - 200 + x, y: b.y + b.height / 2 - 140 + y };
    },
    pixel = (x: number, y: number) =>
      canvas.evaluate(
        (n: HTMLCanvasElement, p) => {
          const r = n.getBoundingClientRect();
          return Array.from(
            n
              .getContext('2d')!
              .getImageData(
                ((r.width / 2 - 200 + p.x) * n.width) / r.width,
                ((r.height / 2 - 140 + p.y) * n.height) / r.height,
                1,
                1,
              ).data,
          );
        },
        { x, y },
      );
  const drag = async (
    a: { x: number; y: number },
    b: { x: number; y: number },
    during?: () => Promise<void>,
  ) => {
    const start = await pos(a.x, a.y),
      end = await pos(b.x, b.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    if (during) await during();
    await page.mouse.up();
  };
  const pick = async (form: 'box' | 'lasso' = 'box', count = 2) => {
    await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption(form);
    if (form === 'box') await drag({ x: 20, y: 50 }, { x: 280, y: 140 });
    else {
      const a = await pos(20, 50);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (const [x, y] of [
        [280, 50],
        [280, 140],
        [20, 140],
        [20, 50],
      ]) {
        const b = await pos(x, y);
        await page.mouse.move(b.x, b.y, { steps: 4 });
      }
      await page.mouse.up();
    }
    await expect(
      page.getByText(`${count} cross-layer members selected`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('point');
  };
  return { p, canvas, read, pos, pixel, drag, pick, errors };
}
test('cross-layer drag translates a live graphic endpoint and keeps the sparse tween', async ({ page }) => {
  const f = await setup(page, false, false, false, false, true);
  const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await expect.poll(() => f.pixel(88, 106)).toEqual(red);
    await expect.poll(() => f.pixel(208, 106)).toEqual(blue);
    expect(await f.read()).toEqual(f.p);
  });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 2)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const half = async () => {
    await timeline.click({ position: { x: 4 * 18 + 9, y: 10 } });
    await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('5');
  };
  await half();
  await expect.poll(() => f.pixel(165, 100)).toEqual(blue);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await half();
  await expect.poll(() => f.pixel(165, 100)).toEqual(white);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(165, 100)).toEqual(blue);
  expect(f.errors).toEqual([]);
});

for (const mode of ['movie', 'movie-tree'] as const)
test(`cross-layer drag moves a live ${mode} endpoint and keeps its independent timeline`, async ({ page }) => {
  const f = await setup(page, false, false, false, false, mode);
  const green = [0, 255, 0, 255], yellow = [255, 255, 0, 255], blue = [0, 0, 255, 255],
    white = [255, 255, 255, 255];
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await expect.poll(() => f.pixel(208, 106)).toEqual(green);
    expect(await f.read()).toEqual(f.p);
  });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 2)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);

  await page.getByLabel('Selection layers', { exact: true }).selectOption('active');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Test movie' }).filter({ hasText: 'Ctrl Enter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  const status = dialog.getByLabel('Live movie status'), position = dialog.getByLabel('Live movie position');
  const pixel = (x: number, y: number) => dialog.getByLabel('Live movie interaction', { exact: true })
    .evaluate((canvas: HTMLCanvasElement, p) => Array.from(
      canvas.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data,
    ), { x, y });
  await expect(status).toContainText('Live movie ready');
  await dialog.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restart live movie', exact: true }).click();
  await expect(position).toContainText('Tick 0');
  await expect(status).toContainText('Live movie ready');
  await expect.poll(() => pixel(201, 98)).toEqual(green);
  const frames = mode === 'movie' ? [yellow, blue, green] : [yellow, white, green, yellow];
  for (const [i, color] of frames.entries()) {
    await dialog.getByRole('button', { name: 'Step live preview', exact: true }).click();
    await expect(position).toContainText(`Tick ${i + 1}`);
    await expect(status).toContainText('Live movie ready');
    await expect.poll(() => pixel(201 - (i + 1) * 12, 98)).toEqual(color);
  }
  expect(await f.read()).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer scale of a live graphic endpoint preserves its recipe and sampled playback', async ({ page }) => {
  const f = await setup(page, false, false, false, false, 'affine');
  const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  await f.pick();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 }, async () => {
    await expect.poll(() => f.pixel(230, 120)).toEqual(blue);
    expect(await f.read()).toEqual(f.p);
  });
  const scaled = structuredClone(f.p);
  for (const layer of scaled.layers.slice(0, 2)) {
    const shape = layer.keys[0].shapes[0];
    shape.x = 40 + (shape.x - 40) * 1.25;
    shape.transform = [1.25, 0, 0, 1.5];
  }
  await expect.poll(f.read).toEqual(scaled);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 4 * 18 + 9, y: 10 } });
  await expect.poll(() => f.pixel(175, 100)).toEqual(blue);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(175, 100)).toEqual(white);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(scaled);
  await expect.poll(() => f.pixel(175, 100)).toEqual(blue);
  expect(f.errors).toEqual([]);
});

test('cross-layer scale stays atomic when a live recipe has affine interpolation off', async ({ page }) => {
  const f = await setup(page, false, false, false, false, true);
  await f.pick();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 });
  await expect(page.getByText(/differing only in the enabled motion properties/)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.canvas.press('ArrowRight');
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 2)) layer.keys[0].shapes[0].x++;
  await expect.poll(f.read).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag of a remembered endpoint refreshes the owned baked keys in one edit', async ({ page }) => {
  const f = await setup(page, false, false, false, false, 'baked');
  const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await expect.poll(() => f.pixel(208, 106)).toEqual(blue);
    expect(await f.read()).toEqual(f.p);
  });
  const moved = structuredClone(f.p);
  moved.layers[0].keys[0].shapes[0].x += 20;
  moved.layers[0].keys[0].shapes[0].y += 10;
  const track = moved.layers[1];
  for (const key of track.keys.slice(0, -1)) {
    const weight = 1 - key.frame / 8;
    key.shapes[0].x += 20 * weight;
    key.shapes[0].y += 10 * weight;
  }
  track.motionSpans![0].baseline = JSON.stringify(track.keys.slice(1, -1));
  await expect.poll(f.read).toEqual(moved);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 4 * 18 + 9, y: 10 } });
  await expect.poll(() => f.pixel(165, 100)).toEqual(blue);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(165, 100)).toEqual(white);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(165, 100)).toEqual(blue);
  expect(f.errors).toEqual([]);
});

test('cross-layer scale of a remembered endpoint rebuilds its baked poses with the saved affine recipe', async ({ page }) => {
  const f = await setup(page, false, false, false, false, 'affine-baked');
  const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
  await f.pick();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 }, async () => {
    await expect.poll(() => f.pixel(230, 120)).toEqual(blue);
    expect(await f.read()).toEqual(f.p);
  });
  const scaled = structuredClone(f.p);
  scaled.layers[0].keys[0].shapes[0].transform = [1.25, 0, 0, 1.5];
  const track = scaled.layers[1];
  for (const key of track.keys.slice(0, -1)) {
    const t = key.frame / 8;
    const shape = key.shapes[0];
    shape.x = 190 + (80 - 190) * t;
    shape.transform = [1.25 - .25 * t, 0, 0, 1.5 - .5 * t];
  }
  track.motionSpans![0].baseline = JSON.stringify(track.keys.slice(1, -1));
  await expect.poll(f.read).toEqual(scaled);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 4 * 18 + 9, y: 10 } });
  await expect.poll(() => f.pixel(175, 100)).toEqual(blue);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(175, 100)).toEqual(white);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(scaled);
  await expect.poll(() => f.pixel(175, 100)).toEqual(blue);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag keeps all tracks exact when a generated baked key was edited', async ({ page }) => {
  const f = await setup(page, false, false, false, false, 'edited-baked');
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  await expect(page.getByText(/Generated keys changed/)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 });
  await expect(page.getByText(/Generated keys changed/)).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag moves a fully covered mask member with ordinary artwork', async ({ page }) => {
  const f = await setup(page, false, false, false, 'covered');
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(150, 112)).toEqual([0, 255, 0, 255]);
  await f.drag({ x: 80, y: 100 }, { x: 100, y: 110 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag picks only the visible part of a clipped rectangle', async ({ page }) => {
  const f = await setup(page, false, false, false, 'partial');
  const green = [0, 255, 0, 255], white = [255, 255, 255, 255];
  const hidden = await f.pos(135, 90);
  await page.mouse.click(hidden.x, hidden.y);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  const visible = await f.pos(118, 90);
  await page.mouse.click(visible.x, visible.y);
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  const empty = await f.pos(145, 140);
  await page.mouse.click(empty.x, empty.y);
  await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('box');
  await f.drag({ x: 125, y: 65 }, { x: 145, y: 115 });
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  await f.drag({ x: 108, y: 65 }, { x: 125, y: 115 });
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 72, y: 100 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3)) {
    layer.keys[0].shapes[0].x += 12;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(120, 115)).toEqual(green);
  await expect.poll(() => f.pixel(126, 115)).toEqual(white);
  await expect(page.getByText('3 cross-layer members selected', { exact: true })).toBeVisible();
  await f.drag({ x: 72, y: 100 }, { x: 112, y: 100 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(120, 115)).toEqual(white);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag respects the visible footprint and hole of a clipped polygon', async ({ page }) => {
  const f = await setup(page, false, false, false, 'polygon');
  const green = [0, 255, 0, 255], white = [255, 255, 255, 255];
  for (const x of [117, 128]) {
    await expect.poll(() => f.pixel(x, 90)).toEqual(white);
    const point = await f.pos(x, 90);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  }
  const visible = await f.pos(112, 90);
  await expect.poll(() => f.pixel(112, 90)).toEqual(green);
  await page.mouse.click(visible.x, visible.y);
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  const empty = await f.pos(145, 140);
  await page.mouse.click(empty.x, empty.y);
  await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('box');
  await f.drag({ x: 108, y: 72 }, { x: 125, y: 110 });
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 64, y: 108 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3)) {
    layer.keys[0].shapes[0].x += 4;
    layer.keys[0].shapes[0].y += 18;
  }
  await expect.poll(f.read).toEqual(moved);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(() => f.pixel(112, 105)).toEqual(green);
  await expect.poll(() => f.pixel(120, 108)).toEqual(white);
  await expect.poll(() => f.pixel(128, 108)).toEqual(white);
  await f.pick('box', 3);
  await f.drag({ x: 64, y: 108 }, { x: 104, y: 108 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer drag retains a partially clipped ellipse as editable curved artwork', async ({ page }) => {
  const f = await setup(page, false, false, false, 'curve');
  const green = [0, 255, 0, 255], white = [255, 255, 255, 255];
  for (const [x, y] of [[111, 70], [129, 90]]) {
    await expect.poll(() => f.pixel(x, y)).toEqual(white);
    const point = await f.pos(x, y);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  }
  const visible = await f.pos(113, 90);
  await page.mouse.click(visible.x, visible.y);
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  const empty = await f.pos(147, 140);
  await page.mouse.click(empty.x, empty.y);
  await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('box');
  await f.drag({ x: 108, y: 68 }, { x: 126, y: 112 });
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 66, y: 104 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3)) {
    layer.keys[0].shapes[0].x += 6;
    layer.keys[0].shapes[0].y += 14;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(117, 117)).toEqual(green);
  await expect.poll(() => f.pixel(129, 117)).toEqual(white);
  await f.drag({ x: 66, y: 104 }, { x: 106, y: 104 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer movement under a polygon mask uses the visible fill beyond its box', async ({ page }) => {
  const f = await setup(page, false, false, false, 'polygon-mask');
  const green = [0, 255, 0, 255], white = [255, 255, 255, 255];
  const hidden = await f.pos(137, 105);
  await expect.poll(() => f.pixel(137, 105)).toEqual(white);
  await page.mouse.click(hidden.x, hidden.y);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  const visible = await f.pos(114, 90);
  await page.mouse.click(visible.x, visible.y);
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(110, 95)).toEqual(green);
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(128, 90)).toEqual(green);
  await expect.poll(() => f.pixel(110, 95)).toEqual(white);
  await expect.poll(() => f.pixel(147, 90)).toEqual(white);
  await f.drag({ x: 80, y: 100 }, { x: 100, y: 110 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer masked tracks pick complete groups and retain their unselected artwork', async ({ page }) => {
  const f = await setup(page, false, false, false, 'masked-groups');
  const protectedPoint = await f.pos(106, 64);
  await page.mouse.click(protectedPoint.x, protectedPoint.y);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  const visible = await f.pos(114, 90);
  await page.mouse.click(visible.x, visible.y);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.pick('box', 4);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 3))
    for (const shape of layer.keys[0].shapes.slice(0, layer.id === 'l2' ? 2 : 1)) {
      shape.x += 20;
      shape.y += 10;
    }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(128, 90)).toEqual([255, 255, 0, 255]);
  await expect.poll(() => f.pixel(106, 64)).toEqual([170, 0, 170, 255]);
  await expect(page.getByText('4 cross-layer members selected', { exact: true })).toBeVisible();
  await f.drag({ x: 80, y: 100 }, { x: 100, y: 110 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer Delete removes complete visible groups beneath a mask in one history step', async ({ page }) => {
  const f = await setup(page, false, false, false, 'masked-groups');
  await expect.poll(() => f.pixel(114, 90)).toEqual([255, 255, 0, 255]);
  await expect.poll(() => f.pixel(106, 64)).toEqual([170, 0, 170, 255]);
  await f.pick('box', 4);
  const expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes.shift();
  expected.layers[1].keys[0].shapes.shift();
  expected.layers[2].keys[0].shapes.splice(0, 2);
  await f.canvas.press('Delete');
  await expect.poll(f.read).toEqual(expected);
  await expect.poll(() => f.pixel(114, 90)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(106, 64)).toEqual([170, 0, 170, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(114, 90)).toEqual([255, 255, 0, 255]);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('cross-layer selection edits ordinary layers beside a mask group', async ({ page }) => {
  const f = await setup(page, false, false, false, true);
  const inside = [0, 255, 0, 255], outside = [255, 255, 255, 255];
  await expect.poll(() => f.pixel(118, 103)).toEqual(inside);
  await expect.poll(() => f.pixel(105, 103)).toEqual(outside);
  await f.pick();
  const from = { x: 60, y: 90 }, to = { x: 80, y: 100 };
  await f.drag(from, to, async () => {
    await expect.poll(() => f.pixel(95, 115)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(118, 103)).toEqual(inside);
    await page.keyboard.press('Escape');
  });
  expect(await f.read()).toEqual(f.p);
  await f.drag(from, to);
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 2)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(118, 103)).toEqual(inside);
  await expect.poll(() => f.pixel(105, 103)).toEqual(outside);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('visible-layer marquee moves both original exposures while protecting hidden locked and outside artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  expect(await f.read()).toEqual(f.p);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await expect.poll(() => f.pixel(45, 75)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => f.pixel(95, 115)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
  });
  const expected = structuredClone(f.p);
  for (const l of expected.layers.slice(0, 2)) {
    l.keys[0].shapes[0].x += 20;
    l.keys[0].shapes[0].y += 10;
  }
  await expect.poll(f.read).toEqual(expected);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('cross-layer lasso and keyboard nudge delete exactly the original visible picks', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick('lasso');
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const moved = structuredClone(f.p);
  for (const l of moved.layers.slice(0, 2)) l.keys[0].shapes[0].x += 1;
  await expect.poll(f.read).toEqual(moved);
  await page.keyboard.press('Delete');
  const deleted = structuredClone(f.p);
  deleted.layers[0].keys[0].shapes.shift();
  deleted.layers[1].keys[0].shapes = [];
  await expect.poll(f.read).toEqual(deleted);
  expect(f.errors).toEqual([]);
});
test('cross-layer Shift point picking uses original layer-qualified duplicate shape IDs', async ({
  page,
}) => {
  const f = await setup(page);
  let q = await f.pos(60, 90);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.down('Shift');
  q = await f.pos(180, 90);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowDown');
  const expected = structuredClone(f.p);
  for (const l of expected.layers.slice(0, 2)) l.keys[0].shapes[0].y += 1;
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('cross-layer scale handles transform both tracks and render their actual detached artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 }, async () => {
    await expect.poll(() => f.pixel(230, 120)).toEqual([0, 0, 255, 255]);
    expect(await f.read()).toEqual(f.p);
  });
  const expected = structuredClone(f.p);
  for (const l of expected.layers.slice(0, 2)) {
    const s = l.keys[0].shapes[0];
    s.x = 40 + (s.x - 40) * 1.25;
    s.transform = [1.25, 0, 0, 1.5];
  }
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('cross-layer Escape restores complete original artwork and keeps the picks actionable', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await page.keyboard.press('Escape');
  });
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const expected = structuredClone(f.p);
  for (const l of expected.layers.slice(0, 2)) l.keys[0].shapes[0].x += 1;
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('cross-layer rotation uses the shared original pivot and preserves other layers', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  await f.drag({ x: 120, y: 46 }, { x: 164, y: 90 }, async () => {
    await expect.poll(() => f.pixel(110, 20)).toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(f.p);
  });
  const out = await f.read();
  for (const [i, y] of [
    [0, 10],
    [1, 130],
  ]) {
    const s = out.layers[i].keys[0].shapes[0];
    expect(s.x).toBeCloseTo(140, 9);
    expect(s.y).toBeCloseTo(y, 9);
    expect(s.transform![0]).toBeCloseTo(0, 12);
    expect(s.transform![1]).toBeCloseTo(1, 12);
    expect(s.transform![2]).toBeCloseTo(-1, 12);
    expect(s.transform![3]).toBeCloseTo(0, 12);
  }
  expect(out.layers.slice(2)).toEqual(f.p.layers.slice(2));
  expect(out.layers[0].keys[0].shapes[1]).toEqual(f.p.layers[0].keys[0].shapes[1]);
  expect(f.errors).toEqual([]);
});
test('cross-layer changed view cancels captured movement without source or history publication', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  const before = (await f.canvas.boundingBox())!;
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
    await page.setViewportSize({ width: 1380, height: 1000 });
    await expect.poll(async () => (await f.canvas.boundingBox())!.width).not.toBe(before.width);
  });
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const expected = structuredClone(f.p);
  for (const l of expected.layers.slice(0, 2)) l.keys[0].shapes[0].x += 1;
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
for (const mode of ['source', 'restored-policy'] as const)
  test(`cross-layer release rejects actual late ${mode} after detached candidate preparation`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.pick();
    await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 }, async () => {
      await expect.poll(() => f.pixel(95, 115)).toEqual([255, 0, 0, 255]);
      await page.evaluate((mode) => {
        const stringify = JSON.stringify;
        JSON.stringify = ((value: unknown, ...args: unknown[]) => {
          const p = value as Project;
          const out = Reflect.apply(stringify, JSON, [value, ...args]);
          if (p?.layers?.[0]?.keys?.[0]?.shapes?.[0]?.x > 40) {
            JSON.stringify = stringify;
            const canvas = document.querySelector(
              'canvas[aria-label="Drawing stage"]',
            ) as HTMLCanvasElement;
            if (canvas.hasPointerCapture(1)) throw Error('Late edit fired before capture cleanup');
            document.documentElement.dataset.crossLayerHook = 'yes';
            if (mode === 'source')
              (
                document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement
              ).click();
            else {
              const field = document.querySelector(
                'select[aria-label="Cross-layer selection gesture"]',
              ) as HTMLSelectElement;
              for (const v of ['box', 'point']) {
                field.value = v;
                field.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
          return out;
        }) as typeof JSON.stringify;
      }, mode);
    });
    expect(await page.locator('html').getAttribute('data-cross-layer-hook')).toBe('yes');
    if (mode === 'source') {
      const out = await f.read();
      expect(out.layers).toHaveLength(5);
      expect(out.layers.slice(0, 4)).toEqual(f.p.layers);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    } else {
      expect(await f.read()).toEqual(f.p);
      await expect(page.getByLabel('Cross-layer selection gesture', { exact: true })).toHaveValue(
        'point',
      );
      await f.canvas.focus();
      await page.keyboard.press('ArrowRight');
      const expected = structuredClone(f.p);
      for (const l of expected.layers.slice(0, 2)) l.keys[0].shapes[0].x += 1;
      await expect.poll(f.read).toEqual(expected);
    }
    expect(f.errors).toEqual([]);
  });
test('ordinary fill edits retain valid optional metadata through a later cross-layer move', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Selection layers', { exact: true }).selectOption('active');
  const point = await f.pos(60, 90);
  await page.mouse.click(point.x, point.y);
  await page.getByLabel('Selected fill', { exact: true }).evaluate((el) => {
    const field = el as HTMLInputElement;
    field.value = '#ee0000';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const before = await f.read();
  expect(before.layers[0].keys[0].shapes[0].fill).toBe('#ee0000');
  await page.getByLabel('Selection layers', { exact: true }).selectOption('visible');
  await f.pick();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const expected = structuredClone(before);
  for (const l of expected.layers.slice(0, 2)) l.keys[0].shapes[0].x += 1;
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('Edit-menu keeps the active-layer clipboard separate from original-layer paste destinations', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Selection layers', { exact: true }).selectOption('active');
  const point = await f.pos(60, 90);
  await page.mouse.click(point.x, point.y);
  await f.canvas.focus();
  await page.keyboard.press('Control+c');
  await page.getByLabel('Selection layers', { exact: true }).selectOption('visible');
  await f.pick();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste Ctrl V', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Selection layers', { exact: true }).selectOption('active');
  await f.canvas.focus();
  await page.keyboard.press('Control+v');
  const out = await f.read();
  expect(out.layers[0].keys[0].shapes).toHaveLength(3);
  expect(out.layers[0].keys[0].shapes.slice(0, 2)).toEqual(f.p.layers[0].keys[0].shapes);
  expect(out.layers.slice(1)).toEqual(f.p.layers.slice(1));
  expect(f.errors).toEqual([]);
});

type MergeOutput = Awaited<ReturnType<CrossLayerRebuilder>>;
async function holdCrossLayerWorkers(page: Page) {
  await holdGeometry(page);
  await page.addInitScript(() => {
    const Previous = window.Worker,
      outputs: unknown[] = [];
    Object.assign(window, { crossLayerOutputs: outputs });
    window.Worker = class extends Previous {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (e) => {
          if (e.data.result) outputs.push(e.data.result);
        });
      }
    };
  });
}
const outputs = <T = MergeOutput>(page: Page) =>
  page.evaluate(
    () => (window as unknown as { crossLayerOutputs: T[] }).crossLayerOutputs,
  );
async function releaseLayer(page: Page) {
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
}
async function selectedPair(page: Page, f: Awaited<ReturnType<typeof setup>>) {
  const a = await f.pos(60, 90),
    b = await f.pos(180, 90);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
}
test('masked Merge Drawing paint stays visible while a cross-layer move is reconstructed', async ({ page }) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, false, false, false, 'covered-merge');
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(150, 112)).toEqual([0, 255, 0, 255]);
  await releaseLayer(page);
  await expect(page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true })).toBeDisabled();
  const moved = structuredClone(f.p);
  for (const layer of moved.layers.slice(0, 2)) {
    layer.keys[0].shapes[0].x += 20;
    layer.keys[0].shapes[0].y += 10;
  }
  moved.layers[2].keys[0].shapes = (await outputs(page))[0].artwork;
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(150, 112)).toEqual([0, 255, 0, 255]);
  await expect(page.getByText('3 cross-layer members selected', { exact: true })).toBeVisible();
  await f.drag({ x: 80, y: 100 }, { x: 100, y: 110 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await pendingGeometry(page)).toBe(0);
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('partially clipped Merge Drawing paint moves with other layers and retains hidden paint', async ({ page }) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, false, false, false, 'partial-merge');
  const hidden = await f.pos(136, 90), green = [0, 255, 0, 255], white = [255, 255, 255, 255];
  await page.mouse.click(hidden.x, hidden.y);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  await f.pick('box', 3);
  await f.drag({ x: 60, y: 90 }, { x: 72, y: 100 });
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(120, 115)).toEqual(green);
  await expect.poll(() => f.pixel(148, 115)).toEqual(white);
  await releaseLayer(page);
  await expect(page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true })).toBeDisabled();
  const moved = structuredClone(f.p), reconstruction = (await outputs(page))[0];
  for (const layer of moved.layers.slice(0, 2)) {
    layer.keys[0].shapes[0].x += 12;
    layer.keys[0].shapes[0].y += 10;
  }
  expect(reconstruction.artwork.some(shape => shape.id === 'hidden')).toBe(false);
  moved.layers[2].keys[0].shapes = [...reconstruction.artwork, f.p.layers[2].keys[0].shapes[1]];
  await expect.poll(f.read).toEqual(moved);
  await expect.poll(() => f.pixel(120, 115)).toEqual(green);
  await expect(page.getByText('3 cross-layer members selected', { exact: true })).toBeVisible();
  await f.drag({ x: 72, y: 100 }, { x: 112, y: 100 });
  await expect(page.getByText(/Keep the cross-layer edit inside the mask/)).toBeVisible();
  expect(await pendingGeometry(page)).toBe(0);
  expect(await f.read()).toEqual(moved);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
  expect(f.errors).toEqual([]);
});

test('cross-layer Delete rebuilds only the affected masked Merge Drawing component', async ({ page }) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, false, false, false, 'partial-merge-delete');
  const green = [0, 255, 0, 255], yellow = [255, 255, 0, 255], white = [255, 255, 255, 255];
  await expect.poll(() => f.pixel(118, 85)).toEqual(green);
  const ordinary = await f.pos(60, 90), masked = await f.pos(118, 85);
  await page.mouse.click(ordinary.x, ordinary.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(masked.x, masked.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.press('Delete');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await expect.poll(() => f.pixel(118, 85)).toEqual(white);
  await expect.poll(() => f.pixel(116, 120)).toEqual(yellow);
  expect(await f.read()).toEqual(f.p);
  await releaseLayer(page);
  await expect.poll(async () => (await outputs<Vector[]>(page)).length).toBe(1);
  const [reconstructed] = await outputs<Vector[]>(page);
  expect(reconstructed.map(objectBounds)).toEqual([{ left: 112, top: 110, right: 120, bottom: 130 }]);
  const expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes.shift();
  expected.layers[2].keys[0].shapes = [...reconstructed, f.p.layers[2].keys[0].shapes[2]];
  await expect.poll(f.read).toEqual(expected);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(() => f.pixel(118, 85)).toEqual(green);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('mixed merged and object cross-layer movement keeps release paint visible and publishes once with retained picks', async ({
  page,
}) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, true);
  await f.pick();
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(95, 115)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(205, 115)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(165, 75)).toEqual([255, 255, 255, 255]);
  expect(await f.canvas.evaluate((n) => n.hasPointerCapture(1))).toBe(false);
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].x += 20;
  expected.layers[0].keys[0].shapes[0].y += 10;
  expected.layers[1].keys[0].shapes = (await outputs(page))[0].artwork;
  await expect.poll(f.read).toEqual(expected);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await releaseLayer(page);
  await expect.poll(async () => (await outputs(page)).length).toBe(2);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const second = structuredClone(expected);
  second.layers[0].keys[0].shapes[0].x++;
  second.layers[1].keys[0].shapes = (await outputs(page))[1].artwork;
  await expect.poll(f.read).toEqual(second);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(second);
  expect(f.errors).toEqual([]);
});
test('two merged tracks reconstruct overlap sequentially and remap the selected visible paint atomically', async ({
  page,
}) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, 'both', true);
  await selectedPair(page, f);
  await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
  await releaseLayer(page);
  await expect.poll(async () => (await outputs(page)).length).toBe(1);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(70, 100)).toEqual([255, 0, 0, 255]);
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const result = await outputs(page),
    expected = structuredClone(f.p);
  expected.layers[0].keys[0].shapes = result[0].artwork;
  expected.layers[1].keys[0].shapes = result[1].artwork;
  await expect.poll(f.read).toEqual(expected);
  const selected = result[0].artwork.filter((s) => result[0].selected.includes(s.id));
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every((s) => s.fill === '#ff0000')).toBe(true);
  await expect.poll(() => f.pixel(90, 90)).toEqual([255, 0, 0, 255]);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await releaseLayer(page);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const moved = await f.read();
  expect(moved.layers.slice(2)).toEqual(f.p.layers.slice(2));
  expect(moved.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
  const later = (await outputs(page))[2];
  expect(later.selected.length).toBeGreaterThan(0);
  const before = selected.map(objectBounds),
    after = later.artwork.filter((s) => later.selected.includes(s.id)).map(objectBounds);
  expect(Math.min(...after.map((b) => b.left))).toBeCloseTo(
    Math.min(...before.map((b) => b.left)) + 1,
    9,
  );
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('merged cross-layer scale and Delete retain protected artwork and one-step document history', async ({
  page,
}) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, true);
  await f.pick();
  await f.drag({ x: 200, y: 110 }, { x: 240, y: 130 });
  await expect.poll(() => f.pixel(230, 120)).toEqual([0, 0, 255, 255]);
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const scaled = await f.read();
  expect(scaled.layers[1].keys[0].shapes.map(objectBounds)).toEqual([
    { left: 190, top: 70, right: 240, bottom: 130 },
  ]);
  expect(scaled.layers.slice(2)).toEqual(f.p.layers.slice(2));
  await f.canvas.focus();
  await page.keyboard.press('Delete');
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const deleted = structuredClone(f.p);
  deleted.layers[0].keys[0].shapes.shift();
  deleted.layers[1].keys[0].shapes = [];
  await expect.poll(f.read).toEqual(deleted);
  await expect(page.getByText('0 cross-layer members selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(scaled);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const way of ['Escape', 'button', 'failure', 'policy', 'view'] as const)
  test(`pending cross-layer paint ${way} restores original drawing and permits a fresh edit`, async ({
    page,
  }) => {
    await holdCrossLayerWorkers(page);
    const f = await setup(page, true);
    await f.pick();
    await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await expect.poll(() => f.pixel(95, 115)).toEqual([255, 0, 0, 255]);
    if (way === 'Escape') await page.keyboard.press('Escape');
    if (way === 'button')
      await page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }).click();
    if (way === 'failure') await releaseGeometry(page, true);
    if (way === 'policy')
      await page.getByLabel('Cross-layer selection gesture', { exact: true }).evaluate((el) => {
        const s = el as HTMLSelectElement;
        for (const value of ['box', 'point']) {
          s.value = value;
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    if (way === 'view') {
      const previous = (await f.canvas.boundingBox())!.width;
      await page.setViewportSize({ width: 1380, height: 1000 });
      await expect.poll(async () => (await f.canvas.boundingBox())!.width).not.toBe(previous);
    }
    await expect(
      page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
    if (way === 'view')
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await expect.poll(() => f.pixel(45, 75)).toEqual([255, 0, 0, 255]);
    await releaseGeometry(page);
    await f.canvas.focus();
    await page.keyboard.press('ArrowRight');
    await releaseLayer(page);
    await expect(
      page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
    ).toBeDisabled();
    const out = await f.read();
    expect(out.layers[0].keys[0].shapes[0].x).toBe(41);
    expect(out.layers.slice(2)).toEqual(f.p.layers.slice(2));
    expect(f.errors).toEqual([]);
  });
test('failure on the second merged layer never publishes the completed first layer', async ({
  page,
}) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, 'both');
  await f.pick();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await releaseLayer(page);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page, true);
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(f.p);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  await f.canvas.scrollIntoViewIfNeeded();
  await f.canvas.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await releaseLayer(page);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseLayer(page);
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  const out = await f.read();
  expect(out).not.toEqual(f.p);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['policy', 'source'] as const)
  test(`merged publication rejects actual late ${mode} after all detached worker results exist`, async ({
    page,
  }) => {
    await holdCrossLayerWorkers(page);
    const f = await setup(page, true);
    await f.pick();
    await f.drag({ x: 60, y: 90 }, { x: 80, y: 100 });
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await page.evaluate((mode) => {
      const stringify = JSON.stringify;
      JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        const out = Reflect.apply(stringify, JSON, [value, ...args]),
          p = value as Project;
        if (
          p?.layers?.[0]?.keys?.[0]?.shapes?.[0]?.x === 60 &&
          p.layers[1]?.keys?.[0]?.shapes?.[0]?.kind === 'polygon'
        ) {
          JSON.stringify = stringify;
          const stage = document.querySelector(
            'canvas[aria-label="Drawing stage"]',
          ) as HTMLCanvasElement;
          if (stage.hasPointerCapture(1)) throw Error('Publication ran before capture cleanup');
          document.documentElement.dataset.crossMergeLateHook = 'yes';
          if (mode === 'policy') {
            const field = document.querySelector(
              'select[aria-label="Cross-layer selection gesture"]',
            ) as HTMLSelectElement;
            for (const v of ['box', 'point']) {
              field.value = v;
              field.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            (
              document.querySelector(
                'button[aria-label="Cancel cross-layer edit"]',
              ) as HTMLButtonElement
            ).click();
            (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
          }
        }
        return out;
      }) as typeof JSON.stringify;
    }, mode);
    await releaseLayer(page);
    await expect(page.locator('html')).toHaveAttribute('data-cross-merge-late-hook', 'yes');
    await expect(
      page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
    ).toBeDisabled();
    if (mode === 'source') {
      const out = await f.read();
      expect(out.layers).toHaveLength(5);
      expect(out.layers.slice(0, 4)).toEqual(f.p.layers);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    } else {
      expect(await f.read()).toEqual(f.p);
      await f.canvas.focus();
      await page.keyboard.press('ArrowRight');
      await releaseLayer(page);
      await expect(
        page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
      ).toBeDisabled();
      const out = await f.read();
      expect(out.layers[0].keys[0].shapes[0].x).toBe(41);
    }
    expect(f.errors).toEqual([]);
  });

test('cross-layer clipboard pastes masked Merge Drawing paint without changing hidden artwork', async ({ page }) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, false, false, false, 'partial-merge');
  const white = [255, 255, 255, 255], green = [0, 255, 0, 255];
  await expect.poll(() => f.pixel(120, 120)).toEqual(white);
  await f.pick('box', 3);
  await f.canvas.press('Control+c');
  await f.canvas.press('Control+v');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await releaseLayer(page);
  await expect.poll(async () => (await outputs(page)).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true })).toBeDisabled();
  const [worker] = await outputs(page), expected = structuredClone(f.p), pasted = await f.read();
  expect(worker.artwork.some(s => s.id === 'hidden')).toBe(false);
  for (const [i, layer] of expected.layers.slice(0, 2).entries()) {
    const original = layer.keys[0].shapes[0], copy = pasted.layers[i].keys[0].shapes.at(-1)!;
    expect(copy.id).not.toBe(original.id);
    expect(copy).toEqual({ ...original, id: copy.id, groups: [], x: original.x + 16, y: original.y + 16 });
    layer.keys[0].shapes.push(copy);
  }
  expected.layers[2].keys[0].shapes = [...worker.artwork, f.p.layers[2].keys[0].shapes[1]];
  await expect.poll(f.read).toEqual(expected);
  await expect.poll(() => f.pixel(120, 120)).toEqual(green);
  await expect.poll(() => f.pixel(135, 120)).toEqual(white);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('cross-layer clipboard pastes complete masked groups in place on their original layers', async ({ page }) => {
  const f = await setup(page, false, false, false, 'masked-groups');
  await f.pick('box', 4);
  await f.canvas.press('Control+c');
  expect(await f.read()).toEqual(f.p);
  const deleted = structuredClone(f.p);
  deleted.layers[0].keys[0].shapes.shift();
  deleted.layers[1].keys[0].shapes.shift();
  deleted.layers[2].keys[0].shapes.splice(0, 2);
  await f.canvas.press('Delete');
  await expect.poll(f.read).toEqual(deleted);
  await expect.poll(() => f.pixel(114, 90)).toEqual([255, 255, 255, 255]);
  await f.canvas.press('Control+Shift+v');
  await expect.poll(async () => (await f.read()).layers[2].keys[0].shapes.length).toBe(4);
  const pasted = await f.read(), expected = structuredClone(deleted);
  for (const [index, layer] of expected.layers.slice(0, 3).entries()) {
    const source = f.p.layers[index].keys[0].shapes, count = layer.id === 'l2' ? 2 : 1;
    const copies = pasted.layers[index].keys[0].shapes.slice(layer.keys[0].shapes.length);
    expect(copies).toHaveLength(count);
    for (const [i, copy] of copies.entries()) {
      expect(copy.id).not.toBe(source[i].id);
      expect({ ...copy, id: source[i].id, ...(copy.groups ? { groups: source[i].groups } : {}) })
        .toEqual(source[i]);
    }
    if (layer.id === 'l2') {
      expect(copies[0].groups).toEqual(copies[1].groups);
      expect(copies[0].groups).not.toEqual(source[0].groups);
    }
    layer.keys[0].shapes.push(...copies);
  }
  expect(pasted).toEqual(expected);
  await expect(page.getByText('4 cross-layer members selected', { exact: true })).toBeVisible();
  await expect.poll(() => f.pixel(106, 64)).toEqual([170, 0, 170, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(deleted);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(pasted);
  await expect.poll(() => f.pixel(114, 90)).toEqual([255, 255, 0, 255]);
  expect(f.errors).toEqual([]);
});

test('cross-layer clipboard copies and pastes mixed paint with pixels, retained picks and exact history', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.pick();
  await f.canvas.focus();
  await page.keyboard.press('Control+c');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(3);
  const pasted = await f.read();
  expect(pasted.layers.slice(2)).toEqual(f.p.layers.slice(2));
  for (const [i, l] of pasted.layers.slice(0, 2).entries()) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(l.keys[1]).toEqual(f.p.layers[i].keys[1]);
  }
  expect(pasted.layers[0].keys[0].shapes.slice(0, 2)).toEqual(f.p.layers[0].keys[0].shapes);
  expect(pasted.layers[0].keys[0].shapes[2]).toMatchObject({ x: 56, y: 86, fill: '#ff0000' });
  await expect.poll(() => f.pixel(90, 120)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(210, 120)).toEqual([0, 0, 255, 255]);
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[2].x).toBe(57);
  expect((await f.read()).layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(pasted);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(pasted);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(f.read).toEqual(pasted);
  expect(f.errors).toEqual([]);
});

test('cross-layer clipboard menus and keyboard preserve original groups through paste, duplicate and cut', async ({
  page,
}) => {
  const f = await setup(page, false, false, true);
  await f.pick('box', 3);
  const q = await f.pos(60, 90);
  await page.mouse.click(q.x, q.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Paste in place Ctrl Shift V', exact: true }).click();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(5);
  const pasted = await f.read(),
    red = pasted.layers[0].keys[0].shapes.slice(3),
    blue = pasted.layers[1].keys[0].shapes[1];
  expect(red.map((s) => s.x)).toEqual([40, 85]);
  expect(red[0].groups).toEqual(red[1].groups);
  expect(red[0].groups).not.toEqual(blue.groups);
  expect(red[0].groups).not.toEqual(['original-group']);
  await f.canvas.focus();
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(7);
  const duplicated = await f.read();
  expect(duplicated.layers[0].keys[0].shapes.slice(5).map((s) => s.x)).toEqual([56, 101]);
  await expect(page.getByText('3 cross-layer members selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+x');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(5);
  const cut = await f.read();
  expect(cut.layers[0].keys[0].shapes).toEqual(pasted.layers[0].keys[0].shapes);
  expect(cut.layers.slice(2)).toEqual(f.p.layers.slice(2));
  await page.keyboard.press('Control+Shift+v');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(7);
  const restored = await f.read();
  expect(restored.layers[0].keys[0].shapes.slice(5).map((s) => s.x)).toEqual([56, 101]);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(cut);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(duplicated);
  expect(f.errors).toEqual([]);
});

test('cross-layer clipboard cancellation and failed Cut retain original artwork and the previous clipboard', async ({
  page,
}) => {
  await holdCrossLayerWorkers(page);
  const f = await setup(page, true);
  await f.pick();
  await f.canvas.focus();
  await page.keyboard.press('Control+c');
  await page.getByRole('button', { name: 'Clear cross-layer selection', exact: true }).click();
  const blue = await f.pos(180, 90);
  await page.mouse.click(blue.x, blue.y);
  await expect(page.getByText('1 cross-layer members selected', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Control+x');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
  ).toBeDisabled();
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('Control+x');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
  expect(await f.read()).toEqual(f.p);
  await f.canvas.scrollIntoViewIfNeeded();
  await f.canvas.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await f.canvas.focus();
  await page.keyboard.press('Control+v');
  await releaseLayer(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(3);
  const pasted = await f.read();
  expect(pasted.layers.slice(2)).toEqual(f.p.layers.slice(2));
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  // A completed mixed-layer Cut must publish its new clipboard only after the
  // final paint worker succeeds; Paste in place can then restore both tracks.
  await f.pick();
  await f.canvas.focus();
  await page.keyboard.press('Control+x');
  await releaseLayer(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(1);
  const cut = await f.read();
  expect(cut.layers[0].keys[0].shapes).toEqual([f.p.layers[0].keys[0].shapes[1]]);
  expect(cut.layers[1].keys[0].shapes).toEqual([]);
  expect(cut.layers.slice(2)).toEqual(f.p.layers.slice(2));
  await f.canvas.focus();
  await page.keyboard.press('Control+Shift+v');
  await releaseLayer(page);
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(2);
  await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(180, 90)).toEqual([0, 0, 255, 255]);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(cut);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['policy', 'source'] as const)
  test(`cross-layer clipboard rejects actual late ${mode} after all pasted paint is prepared`, async ({
    page,
  }) => {
    await holdCrossLayerWorkers(page);
    const f = await setup(page, true);
    await f.pick();
    await f.canvas.focus();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await page.evaluate((mode) => {
      const stringify = JSON.stringify;
      JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        const out = Reflect.apply(stringify, JSON, [value, ...args]),
          p = value as Project;
        if (
          p?.layers?.[0]?.keys?.[0]?.shapes.length === 3 &&
          p.layers[0].keys[0].shapes[2].x === 56 &&
          p.layers[1]?.keys?.[0]?.shapes[0]?.kind === 'polygon'
        ) {
          JSON.stringify = stringify;
          document.documentElement.dataset.crossClipboardLate = 'yes';
          if (mode === 'policy') {
            const field = document.querySelector(
              'select[aria-label="Cross-layer selection gesture"]',
            ) as HTMLSelectElement;
            for (const v of ['box', 'point']) {
              field.value = v;
              field.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            (
              document.querySelector(
                'button[aria-label="Cancel cross-layer edit"]',
              ) as HTMLButtonElement
            ).click();
            (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
          }
        }
        return out;
      }) as typeof JSON.stringify;
    }, mode);
    await releaseLayer(page);
    await expect(page.locator('html')).toHaveAttribute('data-cross-clipboard-late', 'yes');
    await expect(
      page.getByRole('button', { name: 'Cancel cross-layer edit', exact: true }),
    ).toBeDisabled();
    if (mode === 'source') {
      const out = await f.read();
      expect(out.layers).toHaveLength(5);
      expect(out.layers.slice(0, 4)).toEqual(f.p.layers);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    } else expect(await f.read()).toEqual(f.p);
    await f.canvas.focus();
    await page.keyboard.press('Control+v');
    await releaseLayer(page);
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes.length).toBe(3);
    expect(f.errors).toEqual([]);
  });
