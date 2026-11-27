import { expect, test, type Page } from '@playwright/test';
import { newProject, newLayer, validateProject, type Project } from '../../packages/document/src';
function fixture() {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.duration = 12;
  p.layers = ['Red', 'Blue', 'Green'].map((name, i) => ({
    ...newLayer(name),
    id: name.toLowerCase(),
    drawingMode: 'object' as const,
    keys: [
      {
        frame: 0,
        shapes: [
          {
            id: 'same',
            kind: 'rectangle' as const,
            x: 40,
            y: 50,
            width: 100,
            height: 100,
            rotation: 0,
            fill: ['#ff0000', '#0000ff', '#00ff00'][i],
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
        ],
      },
      { frame: 8, shapes: [] },
    ],
  }));
  return p;
}
async function setup(page: Page, p = fixture()) {
  validateProject(p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  const row = (name: string) => page.getByRole('group', { name: 'Layer row ' + name, exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const pixel = () =>
    canvas.evaluate((n, p) => {
      const c = n as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (80 - p.width / 2) * devicePixelRatio,
            c.height / 2 + (90 - p.height / 2) * devicePixelRatio,
            1,
            1,
          ).data,
      );
    }, p);
  const drag = async (source: string, target: string, side: 'above' | 'below') => {
    const box = (await row(target).boundingBox())!;
    await row(source).dragTo(row(target), {
      sourcePosition: { x: 60, y: 14 },
      targetPosition: { x: 60, y: side === 'above' ? 2 : box.height - 2 },
    });
  };
  return { p, row, read, canvas, pixel, drag, errors };
}
test('native layer dragging reorders the stack, visible paint and complete timelines with one Undo and recovery', async ({
  page,
}) => {
  const f = await setup(page);
  await expect.poll(f.pixel).toEqual([0, 255, 0, 255]);
  await f.drag('Red', 'Green', 'above');
  const expected = { ...f.p, layers: [f.p.layers[1], f.p.layers[2], f.p.layers[0]] };
  await expect.poll(f.read).toEqual(expected);
  await expect.poll(f.pixel).toEqual([255, 0, 0, 255]);
  expect(
    await page
      .locator('.layer-row[data-context="layer"]')
      .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.contextId)),
  ).toEqual(['red', 'green', 'blue']);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Red');
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await expect.poll(f.pixel).toEqual([0, 255, 0, 255]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('insertion preview is history-free, Escape cancels, and a lower-edge drop moves downward', async ({
  page,
}) => {
  const f = await setup(page),
    dt = await page.evaluateHandle(() => new DataTransfer()),
    box = (await f.row('Red').boundingBox())!;
  await f.row('Green').dispatchEvent('dragstart', { dataTransfer: dt });
  await f
    .row('Red')
    .dispatchEvent('dragover', { dataTransfer: dt, clientY: box.y + box.height - 2 });
  await expect(f.row('Red')).toHaveClass(/layer-drop-below/);
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-drop-below')).toHaveCount(0);
  await f.row('Red').dispatchEvent('drop', { dataTransfer: dt, clientY: box.y + box.height - 2 });
  expect(await f.read()).toEqual(f.p);
  await f.drag('Green', 'Red', 'below');
  await expect
    .poll(f.read)
    .toEqual({ ...f.p, layers: [f.p.layers[2], f.p.layers[0], f.p.layers[1]] });
  await expect.poll(f.pixel).toEqual([0, 0, 255, 255]);
  expect(f.errors).toEqual([]);
});
test('row ordering into and out of a folder keeps the original artwork and folder structure', async ({
  page,
}) => {
  const p = fixture();
  p.folders = [{ id: 'art', name: 'Art' }];
  p.layers[1].folderId = 'art';
  const f = await setup(page, p);
  await f.drag('Red', 'Blue', 'above');
  const first = structuredClone(p);
  first.layers = [first.layers[1], { ...first.layers[0], folderId: 'art' }, first.layers[2]];
  await expect.poll(f.read).toEqual(first);
  await f.drag('Red', 'Green', 'below');
  const expected = structuredClone(p);
  expected.layers = [expected.layers[1], expected.layers[0], expected.layers[2]];
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
test('dragging a mask layer edge moves its complete group and retains clipping membership', async ({
  page,
}) => {
  const p = fixture();
  p.layerMasks = [{ maskLayerId: 'green', layerIds: ['blue'] }];
  const f = await setup(page, p);
  await expect.poll(f.pixel).toEqual([0, 0, 255, 255]);
  await f.drag('Green', 'Red', 'below');
  const expected = { ...p, layers: [p.layers[1], p.layers[2], p.layers[0]] };
  await expect.poll(f.read).toEqual(expected);
  await expect.poll(f.pixel).toEqual([255, 0, 0, 255]);
  await expect(f.row('Blue')).toHaveClass(/masked-layer/);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  expect(f.errors).toEqual([]);
});
test('locked and stale layer drops reject without partial edits or overwriting separate changes', async ({
  page,
}) => {
  const p = fixture();
  p.layers[2].locked = true;
  const f = await setup(page, p);
  await f.drag('Green', 'Red', 'below');
  await expect(page.getByRole('alert')).toContainText('Unlock');
  expect(await f.read()).toEqual(p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle lock Green', exact: true }).click();
  const before = await f.read(),
    dt = await page.evaluateHandle(() => new DataTransfer());
  await f.row('Red').dispatchEvent('dragstart', { dataTransfer: dt });
  await page.getByRole('button', { name: 'Toggle outline Blue', exact: true }).click();
  const separate = await f.read();
  expect(separate).not.toEqual(before);
  const b = (await f.row('Green').boundingBox())!;
  await f.row('Green').dispatchEvent('drop', { dataTransfer: dt, clientY: b.y + 2 });
  await expect(page.getByRole('alert')).toContainText('changed');
  expect(await f.read()).toEqual(separate);
  expect(f.errors).toEqual([]);
});
test('held layer dragging scrolls to rows outside the initial timeline viewport', async ({
  page,
}) => {
  const p = fixture();
  p.layers = Array.from({ length: 18 }, (_, i) => ({ ...newLayer('Layer ' + i), id: 'l' + i }));
  const f = await setup(page, p),
    dt = await page.evaluateHandle(() => new DataTransfer());
  await f.row('Layer 17').dispatchEvent('dragstart', { dataTransfer: dt });
  const list = page.locator('.layer-list'),
    b = (await list.boundingBox())!;
  await list.dispatchEvent('dragover', { dataTransfer: dt, clientY: b.y + b.height - 2 });
  await expect(f.row('Layer 0')).toBeVisible();
  const target = (await f.row('Layer 0').boundingBox())!;
  await f
    .row('Layer 0')
    .dispatchEvent('drop', { dataTransfer: dt, clientY: target.y + target.height - 2 });
  const expected = { ...p, layers: [p.layers[17], ...p.layers.slice(0, 17)] };
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
