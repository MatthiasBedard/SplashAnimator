import { symbolInstance } from '../../packages/geometry/src/symbols';
import { expect, test, type Page } from '@playwright/test';
import { newProject, newLayer, type Vector, type Project } from '../../packages/document/src';
import { readFile } from 'node:fs/promises';
const rect = (id: string, x: number, fill: string): Vector => ({
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
async function setup(
  page: Page,
  merge = false,
  destination = false,
  mismatch = false,
  graphic: boolean | 'movie' | 'movie-transfer' | 'graphic-transfer' | 'button-transfer' = false,
  masked = false,
) {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.duration = 10;
  p.layers = ['Red', 'Blue', 'Hidden', 'Locked'].map((name, i) => ({
    ...newLayer(name),
    id: 'l' + i,
    drawingMode: merge && i < 2 ? ('merge' as const) : ('object' as const),
    visible: i !== 2,
    locked: i === 3,
    keys: [
      {
        frame: 0,
        shapes: [
          rect('same', [40, 160, 100, 220][i], ['#ff0000', '#0000ff', '#00ff00', '#aa00aa'][i]),
        ],
      },
      { frame: mismatch && i === 1 ? 7 : 8, shapes: [] },
    ],
  }));
  p.layers[0].keys[0].shapes.push({ ...rect('island', 320, '#ff8800'), y: 200 });
  if (masked) {
    p.layers[0].keys[0].shapes.splice(1, 0, rect('peer', 80, '#0000ff'));
    p.layers[1].keys[0].shapes = [{ ...rect('mask', 55, '#ffffff'), width: 50 }];
    p.layerMasks = [{ maskLayerId: 'l1', layerIds: ['l0'] }];
  }
  if (destination)
    p.layers.push({
      ...newLayer('Destination'),
      id: 'dest',
      drawingMode: 'object',
      keys: [
        {
          frame: 0,
          shapes: [
            { ...rect('anchor', 290, '#008888'), y: 210, groups: ['existing'] },
            { ...rect('above', 350, '#333333'), y: 210 },
          ],
        },
        { frame: 8, shapes: [] },
      ],
    });
  if (graphic === 'button-transfer') {
    p.fps = 1;
    const ink = { ...rect('ink', 0, '#ff0000'), y: 0 };
    p.symbols = [
      { id: 'front', name: 'Front', width: 40, height: 40, shapes: [ink],
        buttonStates: { up: 0, over: 1, down: 2, hit: 3 }, timeline: { duration: 4, keys: [
          { frame: 1, shapes: [{ ...ink, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...ink, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...ink, width: 20 }] },
        ] } },
      { id: 'back', name: 'Back', width: 40, height: 40, shapes: [{ ...ink, fill: '#ffff00' }],
        buttonStates: { up: 0, over: 0, down: 0, hit: 0 } },
    ];
    const art = p.layers[0].keys[0].shapes;
    art.splice(0, 1);
    art.push(
      { ...symbolInstance(p.symbols[1], 40, 70), id: 'back-instance' },
      { ...symbolInstance(p.symbols[0], 40, 70), id: 'front-instance' },
      rect('peer', 160, '#aa00aa'),
    );
    p.layers[1].keys[0].shapes = [];
  } else if (graphic) {
    const leaf = { ...rect('leaf', 0, '#ff0000'), y: 0 };
    p.symbols = [
      {
        id: 'graphic',
        name: 'Graphic',
        width: 40,
        height: 40,
        shapes: [leaf],
        timeline: {
          duration: 6,
          keys: [
            { frame: 2, shapes: [{ ...leaf, fill: '#0000ff' }] },
            { frame: 4, shapes: [{ ...leaf, fill: '#00ff00' }] },
          ],
        },
      },
    ];
    const instance = symbolInstance(p.symbols[0], 40, 70);
    instance.id = 'same';
    p.layers[0].keys[0].shapes[0] = instance;
    if (graphic === 'movie' || graphic === 'movie-transfer' || graphic === 'graphic-transfer') {
      instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
      p.layers[0].keys[0].shapes.splice(1, 0, rect('peer', 160, '#0000ff'));
      p.layers[1].keys[0].shapes[0].id = 'other';
      p.layers[1].keys[0].shapes[0].x = 305;
      if (graphic === 'movie-transfer' || graphic === 'graphic-transfer') {
        const art = p.layers[0].keys[0].shapes;
        art.unshift(art.pop()!);
        p.layers[1].keys[0].shapes = [];
        if (graphic === 'graphic-transfer') {
          const child = { ...symbolInstance(p.symbols[0], 0, 0), id: 'child',
            symbolPlayback: { mode: 'movie' as const, firstFrame: 0 } };
          const wrapper = { id: 'wrapper', name: 'Wrapper', width: 40, height: 40, shapes: [child],
            timeline: { duration: 8, keys: [{ frame: 2, shapes: [] }, { frame: 3, shapes: [child] }] } };
          p.symbols.push(wrapper);
          art[1] = { ...symbolInstance(wrapper, 40, 70), id: 'same' };
        }
      }
    } else {
      p.layers[1].keys = [
        { frame: 0, shapes: [] },
        { frame: 3, shapes: [rect('same', 160, '#0000ff')] },
        { frame: 7, shapes: [] },
      ];
    }
  }
  const issues: string[] = [];
  page.on('pageerror', (e) => issues.push(String(e)));
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('group-seeded')) return;
    sessionStorage.setItem('group-seeded', 'yes');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 81, y: 40 } });
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByLabel('Selection layers', { exact: true }).selectOption('visible');
  const stage = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    pos = async (x: number, y: number) => {
      const b = (await stage.boundingBox())!;
      return { x: b.x + b.width / 2 - 200 + x, y: b.y + b.height / 2 - 140 + y };
    };
  async function pick() {
    await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('box');
    const a = await pos(20, 50),
      b = await pos(280, 140);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
    await page.getByLabel('Cross-layer selection gesture', { exact: true }).selectOption('point');
  }
  const dialog = page.getByRole('dialog', { name: 'Group artwork across layers', exact: true });
  async function open(entry: 'keyboard' | 'menu' | 'context' = 'keyboard') {
    await stage.focus();
    if (entry === 'keyboard') await page.keyboard.press('Control+g');
    else if (entry === 'menu') {
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: /^Group selection/ }).click();
    } else {
      const q = await pos(60, 90);
      await page.mouse.click(q.x, q.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Group selection…', exact: true }).click();
    }
    await expect(dialog).toBeVisible();
  }
  const pixel = (x: number, y: number) =>
    stage.evaluate(
      (c: HTMLCanvasElement, p) => {
        const r = c.getBoundingClientRect();
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              ((r.width / 2 - 200 + p.x) * c.width) / r.width,
              ((r.height / 2 - 140 + p.y) * c.height) / r.height,
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );
  const group = () =>
    dialog.getByRole('button', { name: 'Group selected artwork', exact: true }).click();
  return { p, issues, stage, read, pos, pick, open, dialog, pixel, group };
}
test('masked objects group and ungroup on their original layer with identical clipped pixels', async ({ page }) => {
  const f = await setup(page, false, false, false, false, true);
  await expect.poll(() => f.pixel(45, 90)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(65, 90)).toEqual([255, 0, 0, 255]);
  await f.pick();
  await f.open();
  const destination = f.dialog.getByRole('combobox', { name: 'Group destination layer' });
  await expect(destination).toHaveValue('l0');
  await expect(destination.locator('option')).toHaveCount(1);
  await f.group();
  await expect(f.dialog).toHaveCount(0);
  const grouped = await f.read(), expected = structuredClone(f.p);
  const group = grouped.layers[0].keys[0].shapes[0].groups![0];
  expect(group).toBeTruthy();
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [group];
  expect(grouped).toEqual(expected);
  await expect.poll(() => f.pixel(45, 90)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(65, 90)).toEqual([255, 0, 0, 255]);
  await f.stage.press('Control+Shift+g');
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [];
  await expect.poll(f.read).toEqual(expected);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(grouped);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(grouped);
  expect(f.issues).toEqual([]);
});

for (const entry of ['keyboard', 'menu', 'context'] as const)
  test(`${entry} groups complete original layers, retains selection and supports move/ungroup/history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.pick();
    await f.open(entry);
    expect(await f.read()).toEqual(f.p);
    const destination = f.dialog.getByLabel('Group destination layer', { exact: true });
    const submit = f.dialog.getByRole('button', { name: 'Group selected artwork', exact: true });
    if (entry === 'keyboard') {
      await expect(destination).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(f.dialog.getByRole('button', { name: 'Cancel grouping', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(destination).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(f.dialog).toHaveCount(0);
      await expect(f.stage).toBeFocused();
      expect(await f.read()).toEqual(f.p);
      await page.keyboard.press('Control+g');
      await expect(destination).toBeFocused();
    }
    await destination.selectOption('l0');
    if (entry === 'keyboard') await submit.press('Enter');
    else await f.group();
    await expect(f.dialog).toHaveCount(0);
    await expect(f.stage).toBeFocused();
    const grouped = await f.read(),
      art = grouped.layers[0].keys[0].shapes;
    expect(art.map((s) => s.x)).toEqual([40, 160, 320]);
    expect(art[0].groups).toEqual(art[1].groups);
    expect(art[0].groups).toHaveLength(1);
    expect(new Set(art.map((s) => s.id)).size).toBe(3);
    expect(grouped.layers[1].keys[0].shapes).toEqual([]);
    expect(grouped.layers.slice(2)).toEqual(f.p.layers.slice(2));
    expect(grouped.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
    await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(180, 90)).toEqual([0, 0, 255, 255]);
    if (entry === 'keyboard') {
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(grouped);
      await f.pick();
    }
    const a = await f.pos(60, 90),
      b = await f.pos(80, 100);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[1].x).toBe(180);
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(grouped);
    await f.pick();
    await f.stage.focus();
    await page.keyboard.press('Control+Shift+g');
    const ungrouped = await f.read();
    expect(ungrouped.layers[0].keys[0].shapes.slice(0, 2).every((s) => !s.groups?.length)).toBe(
      true,
    );
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(grouped);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(grouped);
    expect(f.issues).toEqual([]);
  });
test('mixed paint groups onto a new bounded object layer without altering source modes or pixels and survives reload', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.pick();
  await f.open();
  await expect(f.dialog.getByLabel('Group destination layer', { exact: true })).toHaveValue('@new');
  await f.group();
  const out = await f.read(),
    layer = out.layers.find((l) => !f.p.layers.some((o) => o.id === l.id))!;
  expect(layer.drawingMode).toBe('object');
  expect(layer.keys.map((k) => [k.frame, k.shapes.length])).toEqual([
    [0, 2],
    [8, 0],
  ]);
  expect(
    out.layers.filter((l) => ['l0', 'l1'].includes(l.id)).every((l) => l.drawingMode === 'merge'),
  ).toBe(true);
  expect(out.duration).toBe(10);
  await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(180, 90)).toEqual([0, 0, 255, 255]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
  expect(f.issues).toEqual([]);
});

test('same-layer Group and Ungroup preserve a movie clock and the original stack', async ({ page }) => {
  const f = await setup(page, false, false, false, 'movie');
  await f.pick();
  await f.open();
  const layer = f.dialog.getByLabel('Group destination layer', { exact: true });
  await layer.selectOption('l1');
  await f.group();
  await expect(f.dialog.getByRole('alert')).toContainText('original stack');
  expect(await f.read()).toEqual(f.p);
  await layer.selectOption('l0');
  await f.group();
  await expect(f.dialog).toHaveCount(0);
  const grouped = await f.read();
  const path = grouped.layers[0].keys[0].shapes[0].groups;
  expect(path).toHaveLength(1);
  const expected = structuredClone(f.p);
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = path;
  expect(grouped).toEqual(expected);
  await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
  const pngPixel = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    const bytes = await readFile((await (await download).path())!);
    return page.evaluate(async encoded => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(60, 90, 1, 1).data);
    }, bytes.toString('base64'));
  };
  expect(await pngPixel()).toEqual([0, 255, 0, 255]);
  await f.stage.press('Control+Shift+g');
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [];
  await expect.poll(f.read).toEqual(expected);
  expect(await pngPixel()).toEqual([0, 255, 0, 255]);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(grouped);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(grouped);
  expect(f.issues).toEqual([]);
});
for (const kind of ['movie', 'graphic'] as const)
test(`a ${kind} with movie playback grouped onto another layer retains its timing and one-step history`, async ({ page }) => {
  const f = await setup(page, false, false, false, kind === 'movie' ? 'movie-transfer' : 'graphic-transfer');
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('l1');
  await f.group();
  await expect(f.dialog).toHaveCount(0);
  const grouped = await f.read(), expected = structuredClone(f.p);
  const moved = expected.layers[0].keys[0].shapes.splice(1);
  const groups = grouped.layers[1].keys[0].shapes[0].groups;
  expect(groups).toHaveLength(1);
  for (const shape of moved) shape.groups = groups;
  expected.layers[1].keys[0].shapes = moved;
  expect(grouped).toEqual(expected);
  const exportedPixel = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    const bytes = await readFile((await (await download).path())!);
    return page.evaluate(async encoded => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(60, 90, 1, 1).data);
    }, bytes.toString('base64'));
  };
  expect(await exportedPixel()).toEqual(kind === 'movie' ? [0, 255, 0, 255] : [255, 0, 0, 255]);
  if (kind === 'graphic') {
    await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 45, y: 40 } });
    expect(await exportedPixel()).toEqual([255, 255, 255, 255]);
  }
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(grouped);
  expect(f.issues).toEqual([]);
});

test('a button grouped onto another layer keeps its Hit priority and pointer states', async ({ page }) => {
  await page.route('**/pixi-*.js', route => route.abort());
  const f = await setup(page, false, false, false, 'button-transfer');
  const front = await f.pos(55, 90);
  await page.mouse.click(front.x, front.y);
  const peer = await f.pos(180, 90);
  await page.keyboard.down('Shift');
  await page.mouse.click(peer.x, peer.y);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 cross-layer members selected', { exact: true })).toBeVisible();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('l1');
  await f.group();
  await expect(f.dialog).toHaveCount(0);
  const grouped = await f.read(), expected = structuredClone(f.p);
  const moved = expected.layers[0].keys[0].shapes.splice(2);
  const groups = grouped.layers[1].keys[0].shapes[0].groups;
  expect(groups).toHaveLength(1);
  for (const shape of moved) shape.groups = groups;
  expected.layers[1].keys[0].shapes = moved;
  expect(grouped).toEqual(expected);
  await f.stage.press('Control+Enter');
  const preview = page.getByLabel('Test movie interaction', { exact: true });
  await expect(preview).toBeVisible();
  const pixel = () => preview.evaluate(n =>
    Array.from((n as HTMLCanvasElement).getContext('2d')!.getImageData(55, 90, 1, 1).data));
  const pointer = async (x: number) => {
    const b = (await preview.boundingBox())!;
    await page.mouse.move(b.x + x * b.width / 400, b.y + 90 * b.height / 280);
  };
  await pointer(75);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await pointer(55);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.mouse.up();
  await expect(page.getByText(/Activations:\s*1/)).toBeVisible();
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(grouped);
  await f.stage.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.stage.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(grouped);
  expect(f.issues).toEqual([]);
});

test('explicit destination group retains its original children, other keys and surrounding stack', async ({
  page,
}) => {
  const f = await setup(page, false, true);
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('dest');
  await f.dialog
    .getByLabel('Group destination group', { exact: true })
    .selectOption('["existing"]');
  await f.group();
  const out = await f.read(),
    target = out.layers.find((l) => l.id === 'dest')!,
    art = target.keys[0].shapes;
  expect(art.map((s) => s.x)).toEqual([290, 40, 160, 350]);
  expect(art[0]).toEqual(f.p.layers.at(-1)!.keys[0].shapes[0]);
  expect(art[1].groups?.[0]).toBe('existing');
  expect(art[1].groups).toEqual(art[2].groups);
  expect(target.keys[1]).toEqual(f.p.layers.at(-1)!.keys[1]);
  expect(f.issues).toEqual([]);
});
test('different current exposure ranges gain only necessary boundaries and preserve outside artwork with one Undo', async ({
  page,
}) => {
  const f = await setup(page, false, false, true);
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('l0');
  await expect(f.dialog).toContainText('frames 1–7');
  await f.group();
  const out = await f.read();
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 7, 8]);
  expect(out.layers[0].keys[1].shapes).toEqual(f.p.layers[0].keys[0].shapes);
  expect(out.layers[0].keys[2]).toEqual(f.p.layers[0].keys[1]);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 7]);
  expect(out.layers[1].keys[1]).toEqual(f.p.layers[1].keys[1]);
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: 7 * 18 + 9, y: 40 } });
  await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => f.pixel(180, 90)).toEqual([255, 255, 255, 255]);
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: 6 * 18 + 9, y: 40 } });
  await expect.poll(() => f.pixel(180, 90)).toEqual([0, 0, 255, 255]);
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: 4 * 18 + 9, y: 40 } });
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.pick();
  await f.open();
  await f.dialog.getByRole('button', { name: 'Cancel grouping', exact: true }).click();
  await expect(f.dialog).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  expect(f.issues).toEqual([]);
});
test('changed-and-restored destination after complete preparation rejects and permits a fresh grouping retry', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('l0');
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { groupHook: number }).groupHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options),
        p = value as Project;
      if (
        p.layers?.[0]?.keys[0]?.shapes[0]?.groups?.length &&
        p.layers[1]?.keys[0]?.shapes.length === 0 &&
        !(window as unknown as { groupHook: number }).groupHook
      ) {
        (window as unknown as { groupHook: number }).groupHook++;
        const el = document.querySelector(
            'select[aria-label="Group destination layer"]',
          ) as HTMLSelectElement,
          prior = el.value;
        el.value = '@new';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = prior;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return out;
    };
  });
  const submit = f.dialog.getByRole('button', { name: 'Group selected artwork', exact: true });
  await submit.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { groupHook: number }).groupHook)).toBe(1);
  expect(await f.read()).toEqual(f.p);
  await expect(f.dialog.getByRole('alert')).toContainText('destination changed');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(f.dialog).toHaveCount(0);
  expect((await f.read()).layers[0].keys[0].shapes[0].groups).toHaveLength(1);
  expect(f.issues).toEqual([]);
});
test('actual late scene edits reject grouped publication and remain independently undoable', async ({
  page,
}) => {
  const f = await setup(page);
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('l0');
  await page.evaluate(() => {
    const native = structuredClone;
    (window as unknown as { groupSourceHook: number }).groupSourceHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const out = native(value, options),
        p = value as Project;
      if (
        p.layers?.[0]?.keys[0]?.shapes[0]?.groups?.length &&
        p.layers[1]?.keys[0]?.shapes.length === 0 &&
        !(window as unknown as { groupSourceHook: number }).groupSourceHook
      ) {
        (window as unknown as { groupSourceHook: number }).groupSourceHook++;
        const el = document.querySelector('input[aria-label="Layer name"]') as HTMLInputElement;
        el.value = 'Separate edit';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return out;
    };
  });
  const sourceLayer = await page.getByLabel('Layer name', { exact: true }).inputValue();
  await f.group();
  expect(
    await page.evaluate(() => (window as unknown as { groupSourceHook: number }).groupSourceHook),
  ).toBe(1);
  await expect(f.dialog.getByRole('alert')).toContainText('source changed');
  const expected = structuredClone(f.p);
  expected.layers.find((l) => l.name === sourceLayer)!.name = 'Separate edit';
  expect(await f.read()).toEqual(expected);
  await f.dialog.getByRole('button', { name: 'Cancel grouping', exact: true }).click();
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.issues).toEqual([]);
});

test('graphic symbol phase remains visible across different-source group boundaries without library edits', async ({
  page,
}) => {
  const f = await setup(page, false, false, false, true);
  await expect.poll(() => f.pixel(60, 90)).toEqual([0, 255, 0, 255]);
  await f.pick();
  await f.open();
  await f.dialog.getByLabel('Group destination layer', { exact: true }).selectOption('@new');
  await expect(f.dialog).toContainText('frames 4–7');
  await page.screenshot({ path: test.info().outputPath('group-destination.png') });
  await f.group();
  await expect.poll(() => f.pixel(60, 90)).toEqual([0, 255, 0, 255]);
  expect((await f.read()).symbols).toEqual(f.p.symbols);
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: 7 * 18 + 9, y: 40 } });
  await expect.poll(() => f.pixel(60, 90)).toEqual([255, 0, 0, 255]);
  await page
    .getByLabel('Timeline frames', { exact: true })
    .click({ position: { x: 3 * 18 + 9, y: 40 } });
  await expect.poll(() => f.pixel(60, 90)).toEqual([0, 0, 255, 255]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.issues).toEqual([]);
});
