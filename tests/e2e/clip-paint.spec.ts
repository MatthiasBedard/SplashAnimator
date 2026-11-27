import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { hit, worldPoint } from '../../packages/geometry/src';

const recovery = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as Project | undefined);
const recoveredShapes = async (page: Page) => (await recovery(page))?.layers[0].keys[0].shapes ?? [];

test('partial Cut and Delete keep remote fill curves and exact history', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 280;
  project.layers[0].drawingMode = 'merge';
  const ellipse: Vector = {
    id: 'ellipse', kind: 'ellipse', x: 40, y: 40, width: 160, height: 160,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const neighbor: Vector = { ...ellipse, id: 'protected', x: 245, fill: '#0000ff', kind: 'rectangle' };
  project.layers[0].keys[0].shapes = [ellipse, neighbor];
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => recoveredShapes(page);
  const pixels = () => stage.evaluate(n => {
    const c = n as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[185, 120], [163, 65], [45, 120], [270, 120]].map(([x, y]) => Array.from(ctx.getImageData(
      c.width / 2 + (x - 200) * devicePixelRatio,
      c.height / 2 + (y - 140) * devicePixelRatio, 1, 1,
    ).data));
  });
  const selectRegion = async (left: number, top: number, right: number, bottom: number) => {
    const box = (await stage.boundingBox())!;
    for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]])
      await page.mouse.click(box.x + box.width / 2 - 200 + x, box.y + box.height / 2 - 140 + y);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Cut paint region', exact: true })).toBeEnabled();
  };
  const handles = (shape: Vector) => {
    const anchor = shape.contours?.flat().find(node => Math.abs(worldPoint(shape, node).x - 40) < 1e-7);
    expect(anchor?.in).toBeDefined();
    expect(anchor?.out).toBeDefined();
    return [worldPoint(shape, anchor!.in!), worldPoint(shape, anchor!.out!)];
  };
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255], blue = [0, 0, 255, 255];
  await expect.poll(pixels).toEqual([red, red, red, blue]);
  const before = await read();
  await selectRegion(172, 80, 210, 154);
  await stage.press('Control+x');
  await expect.poll(async () => (await read())[0].kind).toBe('polygon');
  const cut = await read();
  const cutHandles = handles(cut[0]);
  expect(cut[1]).toEqual(neighbor);
  await expect.poll(pixels).toEqual([white, red, red, blue]);
  await selectRegion(151, 45, 176, 74);
  await stage.press('Delete');
  await expect.poll(read).not.toEqual(cut);
  const deleted = await read();
  expect(handles(deleted[0])).toEqual(cutHandles);
  expect(deleted[1]).toEqual(neighbor);
  await expect.poll(pixels).toEqual([white, white, red, blue]);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(deleted);
  await stage.press('Control+v');
  await expect.poll(read).not.toEqual(deleted);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(deleted);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('merge lasso copies without edits, cuts paint, pastes and restores with undo', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read(),
    original = before[0];
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  const region = async () => {
    for (const [x, y] of [
      [400, 150],
      [550, 150],
      [550, 350],
      [400, 350],
    ])
      await page.mouse.click(b.x + x, b.y + y);
    await page.keyboard.press('Enter');
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  };
  await region();
  expect(await read()).toEqual(before);
  await page.getByRole('button', { name: 'Copy paint region', exact: true }).click();
  await expect(page.getByText('Copied paint region', { exact: true })).toBeVisible();
  expect(await read()).toEqual(before);
  await stage.focus();
  await page.keyboard.press('Control+x');
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(before)).toBe(true);
  const cut = await read();
  expect(
    cut.some((s) =>
      hit(s, { x: original.x + original.width * 0.25, y: original.y + original.height * 0.5 }, 0),
    ),
  ).toBe(true);
  expect(
    cut.some((s) =>
      hit(s, { x: original.x + original.width * 0.75, y: original.y + original.height * 0.5 }, 0),
    ),
  ).toBe(false);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(cut)).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(cut);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await region();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Cut paint region', exact: true })).toBeDisabled();
  expect(await read()).toEqual(before);
  await region();
  await page.keyboard.press('Delete');
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(before)).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('whole object cut and paste preserve the clipboard across undo', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByLabel('Drawing mode').selectOption('object');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+x');
  expect(await read()).toEqual([]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+v');
  expect((await read()).length).toBe(2);
});

test('partial paint moves numerically and by keyboard with stable gradient pixels and undo', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await stage.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Fill type').selectOption('radial');
  await expect.poll(async () => Boolean((await read())[0].gradient)).toBe(true);
  const before = await read(),
    a = before[0];
  const pixel = (x: number, y: number) =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x, y },
    );
  // Keep the probe inside the paint and clear of its newly fitted transform pivot.
  const color = await pixel(450, 230);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  for (const [x, y] of [
    [400, 150],
    [550, 150],
    [550, 350],
    [400, 350],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Enter');
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  await page.getByLabel('Paint region move X').fill('150');
  await page.getByRole('button', { name: 'Move paint region', exact: true }).click();
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(before)).toBe(true);
  const moved = await read();
  expect(moved.some((s) => hit(s, { x: a.x + a.width * 0.75, y: a.y + a.height * 0.5 }, 0))).toBe(
    false,
  );
  const zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  await expect
    .poll(async () =>
      Math.max(...(await pixel(450 + 150 * zoom, 230)).map((v, i) => Math.abs(v - color[i]))),
    )
    .toBeLessThanOrEqual(2);
  await stage.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(moved)).toBe(true);
  await expect
    .poll(async () =>
      Math.max(
        ...(await pixel(450 + 150 * zoom, 230 + 10 * zoom)).map((v, i) => Math.abs(v - color[i])),
      ),
    )
    .toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(moved);
  await expect(page.getByRole('button', { name: 'Move paint region', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('paste in place retains source coordinates while normal paste offsets', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByLabel('Drawing mode').selectOption('object');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  const a = (await read())[0];
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+Shift+v');
  const pasted = (await read())[1];
  expect(pasted.x).toBe(a.x);
  expect(pasted.y).toBe(a.y);
  expect(pasted.id).not.toBe(a.id);
  await page.keyboard.press('Control+z');
  expect((await read()).length).toBe(1);
  await page.keyboard.press('Control+v');
  const shifted = (await read())[1];
  expect(shifted.x).toBe(a.x + 16);
  expect(shifted.y).toBe(a.y + 16);
});

test('paint region holes survive set operations, drag cancellation and committed movement', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 320);
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read(),
    a = before[0];
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  const region = async (mode: string, x: number, y: number, w: number, h: number) => {
    await page.getByLabel('Lasso selection mode').selectOption(mode);
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ])
      await page.mouse.click(b.x + px, b.y + py);
    await page.keyboard.press('Enter');
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
    await expect(
      page.getByRole('button', { name: 'Move paint region', exact: true }),
    ).toBeEnabled();
  };
  await region('replace', 290, 170, 220, 160);
  await region('subtract', 380, 220, 40, 60);
  await region('add', 550, 180, 40, 40);
  await region('intersect', 290, 170, 220, 160);
  expect(await read()).toEqual(before);
  await page.getByLabel('Drag paint region', { exact: true }).check();
  // Clicking inside the hole must not initiate movement.
  await page.mouse.move(b.x + 400, b.y + 250);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 250);
  await page.mouse.up();
  expect(await read()).toEqual(before);
  await page.mouse.move(b.x + 330, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 570, b.y + 200);
  const pixel = async (x: number, y: number) =>
    stage.evaluate(
      (el, { x, y }) => {
        const c = el as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round((x * c.width) / r.width),
              Math.round((y * c.height) / r.height),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );
  await expect.poll(async () => (await pixel(335, 205)).slice(0, 3)).toEqual([255, 255, 255]);
  await expect.poll(async () => (await pixel(575, 205))[0]).not.toBe(255);
  expect(await read()).toEqual(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(before);
  await expect.poll(async () => (await pixel(335, 205))[0]).not.toBe(255);
  await page.getByLabel('Drag paint region', { exact: true }).uncheck();
  await region('replace', 290, 170, 220, 160);
  await region('subtract', 380, 220, 40, 60);
  await page.getByLabel('Drag paint region', { exact: true }).check();
  await page.mouse.move(b.x + 330, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 570, b.y + 200);
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await read()) !== JSON.stringify(before)).toBe(true);
  const moved = await read(),
    z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  expect(moved.some((s) => hit(s, { x: a.x + a.width * 0.5, y: a.y + a.height * 0.5 }, 0))).toBe(
    true,
  );
  expect(moved.some((s) => hit(s, { x: a.x + a.width * 0.15, y: a.y + a.height * 0.15 }, 0))).toBe(
    false,
  );
  expect(
    moved.some((s) => hit(s, { x: a.x + a.width * 0.5 + 240 / z, y: a.y + a.height * 0.5 }, 0)),
  ).toBe(false);
  expect(
    moved.some((s) => hit(s, { x: a.x + a.width * 0.15 + 240 / z, y: a.y + a.height * 0.15 }, 0)),
  ).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Selection rectangle cuts and drags part of default merged brush paint with cancellation and undo', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () => recoveredShapes(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(page.getByLabel('Brush finish simplify')).toHaveValue('50');
  await expect(page.getByLabel('Separate brush objects', { exact: true })).not.toBeChecked();
  await page.getByLabel('Brush size', { exact: true }).fill('80');
  await page.mouse.move(b.x + 300, b.y + 240);
  await page.mouse.down();
  await page.mouse.move(b.x + 500, b.y + 240, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read();
  const z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  const origin = { x: b.x + (b.width - 960 * z) / 2, y: b.y + (b.height - 540 * z) / 2 };
  const painted = (shapes: typeof before, x: number, y: number) =>
    shapes.some((s) => hit(s, { x: (b.x + x - origin.x) / z, y: (b.y + y - origin.y) / z }, 0));
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(b.x + 400, b.y + 150);
  await page.mouse.down();
  await page.mouse.move(b.x + 550, b.y + 330);
  await page.mouse.up();
  await expect(
    page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
  ).toBeVisible();
  expect(await read()).toEqual(before);
  // A cancelled drag neither cuts the original paint nor creates artwork history.
  await page.mouse.move(b.x + 450, b.y + 240);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 340);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(before);
  // Escape clears the selection too; select the same half again.
  await page.mouse.move(b.x + 400, b.y + 150);
  await page.mouse.down();
  await page.mouse.move(b.x + 550, b.y + 330);
  await page.mouse.up();
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  await page.mouse.move(b.x + 450, b.y + 240);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 340);
  await page.mouse.up();
  await expect.poll(async () => painted(await read(), 450, 340)).toBe(true);
  const moved = await read();
  expect(painted(moved, 350, 240)).toBe(true);
  expect(painted(moved, 450, 240)).toBe(false);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const mode of ['freehand', 'polygon']) {
  test(`dense ${mode} paint selection cuts beyond the former vertex cap with undo`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByLabel('Drawing mode').selectOption('merge');
    await page.getByLabel('Drawing stroke width').fill('0');
    const stage = page.getByLabel('Drawing stage'),
      b = (await stage.boundingBox())!;
    const cx = b.width / 2,
      cy = b.height / 2;
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(b.x + cx - 200, b.y + cy - 200);
    await page.mouse.down();
    await page.mouse.move(b.x + cx + 200, b.y + cy + 200);
    await page.mouse.up();
    const read = () => recoveredShapes(page);
    await expect.poll(async () => (await read()).length).toBe(1);
    const before = await read();
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await page.getByLabel('Lasso mode').selectOption(mode);
    await page.getByLabel('Partial paint region').check();
    await stage.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => {
          (c as HTMLElement).dataset.densePointer = String((e as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    await page.mouse.move(
      b.x + cx + (mode === 'polygon' ? -205 : 180),
      b.y + cy + (mode === 'polygon' ? -205 : 0),
    );
    await page.mouse.down();
    await stage.evaluate((c, mode) => {
      const b = c.getBoundingClientRect(),
        pointerId = Number((c as HTMLElement).dataset.densePointer);
      for (let i = 1; i <= 5000; i++) {
        const angle = (i * 2 * Math.PI) / 5000;
        // Each polygon vertex is a separate click. Release the preceding
        // capture before pressing again with the same native pointer.
        if (mode === 'polygon') c.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0,
        }));
        c.dispatchEvent(
          new PointerEvent(mode === 'polygon' ? 'pointerdown' : 'pointermove', {
            bubbles: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: b.x + b.width / 2 + 180 * Math.cos(angle),
            clientY: b.y + b.height / 2 + 180 * Math.sin(angle),
          }),
        );
      }
    }, mode);
    await page.mouse.up();
    if (mode === 'polygon') await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Copy paint region', exact: true }),
    ).toBeEnabled();
    expect(await read()).toEqual(before);
    await page.getByRole('button', { name: 'Copy paint region', exact: true }).click();
    await expect(page.getByText('Copied paint region', { exact: true })).toBeVisible();
    expect(await read()).toEqual(before);
    await page.getByRole('button', { name: 'Cut paint region', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(before));
    const cut = await read();
    expect(
      cut.reduce((count, s) => count + (s.contours?.flat().length ?? s.points.length), 0),
    ).toBeGreaterThan(4096);
    const center = { x: before[0].x + before[0].width / 2, y: before[0].y + before[0].height / 2 };
    expect(cut.some((s) => hit(s, center, 0))).toBe(false);
    expect(cut.some((s) => hit(s, { x: center.x + 195, y: center.y + 195 }, 0))).toBe(true);
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(cut);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
test('self-crossing partial lasso excludes its even-odd center when cutting paint', async ({
  page,
}) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = async () => (await recovery(page))!;
  await page.getByLabel('Drawing mode').selectOption('merge');
  await page.getByLabel('Drawing stroke width').fill('0');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 150, b.y + 100);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 400);
  await page.mouse.up();
  await expect.poll(async () => (await recoveredShapes(page)).length).toBe(1);
  const before = await read(),
    original = before.layers[0].keys[0].shapes[0];
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await page.getByLabel('Lasso mode').selectOption('polygon');
  await page.getByLabel('Partial paint region').check();
  for (const [x, y] of [
    [0, -10],
    [6, 8],
    [-10, -3],
    [10, -3],
    [-6, 8],
  ])
    await page.mouse.click(b.x + 300 + x * 10, b.y + 250 + y * 10);
  await page.keyboard.press('Enter');
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  expect(await read()).toEqual(before);
  await stage.focus();
  await page.keyboard.press('Control+x');
  await expect.poll(read).not.toEqual(before);
  const after = await read();
  const point = (x: number, y: number) => ({
    x: original.x + (original.width * (x - 150)) / 300,
    y: original.y + (original.height * (y - 100)) / 300,
  });
  const shapes = after.layers[0].keys[0].shapes;
  expect(shapes.some((s) => hit(s, point(300, 250), 0))).toBe(true);
  expect(shapes.some((s) => hit(s, point(300, 180), 0))).toBe(false);
  expect(shapes.some((s) => hit(s, point(430, 370), 0))).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});
