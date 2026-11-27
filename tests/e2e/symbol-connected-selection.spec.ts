import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
const line = (id: string, x: number, y: number, dx: number, dy: number): Vector => ({
  id,
  kind: 'line',
  x,
  y,
  width: Math.abs(dx),
  height: Math.abs(dy),
  rotation: 0,
  points: [
    { x: 0, y: 0 },
    { x: dx, y: dy },
  ],
  fill: '#ff0000',
  fillEnabled: false,
  stroke: '#223344',
  strokeWidth: 4,
});
async function setup(
  page: Page,
  options: { scope?: 'group' | 'frame' | 'nested'; curve?: boolean; barrier?: boolean } = {},
) {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.symbols = [
    {
      id: 'art',
      name: 'Connected art',
      width: 400,
      height: 280,
      shapes: [
        line('a', 60, 70, 100, 0),
        line('b', 160, 70, 0, 80),
        line('c', 160, 150, 80, 0),
        line('island', 300, 70, 60, 0),
        {
          ...line('paint', 240, 60, 80, 100),
          kind: 'rectangle',
          fillEnabled: true,
          strokeWidth: 0,
          points: [],
        },
      ],
    },
  ];
  if (options.curve)
    Object.assign(p.symbols[0].shapes[0], {
      kind: 'bezier',
      points: [],
      height: 40,
      nodes: [
        { x: 0, y: 0, out: { x: 30, y: -40 } },
        { x: 100, y: 0, in: { x: 70, y: -40 } },
      ],
    });
  if (options.barrier)
    p.symbols[0].shapes.splice(1, 0, {
      ...line('protected', 270, 220, 20, 20),
      groups: ['protected-group'],
    });
  if (options.scope === 'group')
    for (const s of p.symbols[0].shapes.slice(0, 3)) s.groups = ['outer'];
  if (options.scope === 'frame')
    p.symbols[0].timeline = {
      duration: 8,
      keys: [
        { frame: 4, shapes: structuredClone(p.symbols[0].shapes) },
        { frame: 7, shapes: [] },
      ],
    };
  if (options.scope === 'nested')
    p.symbols.push({
      id: 'parent',
      name: 'Parent',
      width: 400,
      height: 280,
      shapes: [symbolInstance(p.symbols[0], 0, 0)],
    });
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols.at(-1)!, 0, 0)];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  if (options.scope === 'nested') {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
    await page
      .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
      .click();
  } else {
    await page
      .getByRole('option', { name: 'Library item Connected art', exact: true })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', {
        name: options.scope === 'frame' ? 'Edit timeline' : 'Edit',
        exact: true,
      })
      .click();
    if (options.scope === 'frame') {
      await page.getByLabel('Symbol frame', { exact: true }).fill('5');
      await page.getByLabel('Symbol frame', { exact: true }).press('Tab');
      await page.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
    }
  }
  const host = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  if (options.scope === 'group') {
    await host.getByLabel('Symbol artwork item', { exact: true }).selectOption('a');
    await host.getByRole('button', { name: 'Edit symbol group in isolation', exact: true }).click();
  }
  const editor =
      options.scope === 'group'
        ? page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true })
        : host,
    canvas = editor.getByLabel('Symbol artwork preview', { exact: true });
  const pos = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!,
      scale = 290 / 280;
    return {
      x: b.x + ((20 + x * scale) * b.width) / 540,
      y: b.y + ((20 + y * scale) * b.height) / 330,
    };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const apply = async () => {
    await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    if (options.scope === 'group')
      await host.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    if (options.scope === 'frame')
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  };
  return { p, editor, canvas, pos, read, errors, apply };
}
test('symbol double click selects connected strokes without artwork history', async ({ page }) => {
  const f = await setup(page),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const scope of ['group', 'frame', 'nested'] as const)
  test(`${scope} symbol connected selection carries one keyboard nudge through enclosing Apply`, async ({
    page,
  }) => {
    const f = await setup(page, { scope }),
      p = await f.pos(110, 70);
    await page.mouse.dblclick(p.x, p.y);
    await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('ArrowRight');
    for (const id of ['a', 'b', 'c'])
      await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
    await f.apply();
    const expected = structuredClone(f.p),
      art = expected.symbols![0],
      shapes = scope === 'frame' ? art.timeline!.keys[0].shapes : art.shapes;
    for (const s of shapes.slice(0, 3)) s.x += 1;
    await expect.poll(f.read).toEqual(expected);
    expect(f.errors).toEqual([]);
  });
test('symbol curve connectivity retains original anchors and handles', async ({ page }) => {
  const f = await setup(page, { curve: true }),
    p = await f.pos(110, 40);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.apply();
  const out = await f.read();
  expect(out.symbols![0].shapes[0].nodes).toEqual(f.p.symbols![0].shapes[0].nodes);
  expect(out.symbols![0].shapes.slice(3)).toEqual(f.p.symbols![0].shapes.slice(3));
  for (let i = 0; i < 3; i++)
    expect(out.symbols![0].shapes[i].x).toBe(f.p.symbols![0].shapes[i].x + 1);
});
test('symbol protected stack groups block connected line traversal', async ({ page }) => {
  const f = await setup(page, { barrier: true }),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 1 connected lines', { exact: true })).toBeVisible();
  await expect(f.editor.getByLabel('Move hierarchy unit b', { exact: true })).not.toBeChecked();
  expect(await f.read()).toEqual(f.p);
});
test('symbol connected strokes drag together, retain selection and local/document history', async ({
  page,
}) => {
  const f = await setup(page),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  for (const id of ['a', 'b', 'c'])
    await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  for (const id of ['island', 'paint'])
    await expect(
      f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true }),
    ).not.toBeChecked();
  await f.canvas.scrollIntoViewIfNeeded();
  const a = await f.pos(110, 70);
  await f.canvas.evaluate((node) => {
    for (const name of ['pointerdown', 'pointerup'])
      node.addEventListener(
        name,
        (e) => {
          const event = e as PointerEvent;
          (node as HTMLElement).dataset[name] = JSON.stringify([event.clientX, event.clientY]);
        },
        { once: true },
      );
  });
  const bounds = (await f.canvas.boundingBox())!;
  const oldPixel = () =>
    f.canvas.evaluate((node) =>
      Array.from(
        (node as HTMLCanvasElement)
          .getContext('2d')!
          .getImageData(20 + (110 * 290) / 280, 20 + (70 * 290) / 280, 1, 1).data,
      ),
    );
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 10, { steps: 4 });
  await expect.poll(oldPixel).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.mouse.up();
  const events = await f.canvas.evaluate((node) => ({
      down: JSON.parse((node as HTMLElement).dataset.pointerdown!),
      up: JSON.parse((node as HTMLElement).dataset.pointerup!),
    })),
    local = (p: number[]) => ({
      x: (((p[0] - bounds.x) * 540) / bounds.width - 20) / (290 / 280),
      y: (((p[1] - bounds.y) * 330) / bounds.height - 20) / (290 / 280),
    }),
    dx = local(events.up).x - local(events.down).x,
    dy = local(events.up).y - local(events.down).y;
  for (const id of ['a', 'b', 'c'])
    await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  for (const id of ['a', 'b', 'c'])
    await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  await f.editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const out = await f.read();
  expect(dx).toBeGreaterThan(18);
  expect(dy).toBeGreaterThan(8);
  const expected = structuredClone(f.p);
  for (const s of expected.symbols![0].shapes.slice(0, 3)) {
    s.x += dx;
    s.y += dy;
  }
  expect(out).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  expect(f.errors).toEqual([]);
});
test('symbol connected selection keyboard deletion removes all connected strokes and Undo restores picks', async ({
  page,
}) => {
  const f = await setup(page),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Delete');
  await expect(
    f.editor.getByLabel('Symbol artwork item', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  for (const id of ['a', 'b', 'c'])
    await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
});
test('symbol connected numeric hierarchy transform retains all picks and one local edit', async ({
  page,
}) => {
  const f = await setup(page),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  await f.editor.getByLabel('Symbol group transform dx', { exact: true }).fill('10');
  await f.editor
    .getByRole('button', { name: 'Transform selected hierarchy units', exact: true })
    .click();
  for (const id of ['a', 'b', 'c'])
    await expect(f.editor.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.apply();
  const expected = structuredClone(f.p);
  for (const s of expected.symbols![0].shapes.slice(0, 3)) {
    s.x += 10;
    s.transform = [1, 0, 0, 1];
  }
  await expect.poll(f.read).toEqual(expected);
});
test('symbol connected release rejects a real source edit after detached movement exists', async ({
  page,
}) => {
  const f = await setup(page),
    p = await f.pos(110, 70);
  await page.mouse.dblclick(p.x, p.y);
  await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  const a = await f.pos(110, 70);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 10, { steps: 4 });
  await page.evaluate(() => {
    const clone = structuredClone;
    window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      const out = clone(value, options);
      if (Array.isArray(value) && value.some((s) => s?.id === 'a' && s.x > 70)) {
        window.structuredClone = clone;
        const canvas = document.querySelector(
          'canvas[aria-label="Symbol artwork preview"]',
        ) as HTMLCanvasElement;
        if (canvas.hasPointerCapture(1)) throw Error('Release hook fired before capture cleanup');
        document.documentElement.dataset.connectedReleaseHook = 'yes';
        const field = document.querySelector(
          'input[aria-label="Symbol artwork x"]',
        ) as HTMLInputElement;
        field.value = '61';
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return out;
    }) as typeof structuredClone;
  });
  await page.mouse.up();
  expect(await page.locator('html').getAttribute('data-connected-release-hook')).toBe('yes');
  await expect(f.editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('61');
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.apply();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('symbol connected copy paste and cut use the complete selected network', async ({ page }) => {
  const f = await setup(page);
  const pick = async () => {
    const p = await f.pos(110, 70);
    await page.mouse.dblclick(p.x, p.y);
    await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
  };
  await pick();
  await f.canvas.focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(
    f.editor.getByLabel('Symbol artwork item', { exact: true }).locator('option'),
  ).toHaveCount(8);
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await pick();
  await f.canvas.focus();
  await page.keyboard.press('Control+x');
  await expect(
    f.editor.getByLabel('Symbol artwork item', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await f.apply();
  const expected = structuredClone(f.p);
  expected.symbols![0].shapes = expected.symbols![0].shapes.slice(3);
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});
for (const mode of ['escape', 'source', 'tool', 'failure'] as const)
  test(`symbol connected worker ${mode} leaves artwork unchanged and permits a fresh selection`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const f = await setup(page),
      p = await f.pos(110, 70);
    await page.mouse.dblclick(p.x, p.y);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    if (mode === 'escape') {
      await f.canvas.focus();
      await page.keyboard.press('Escape');
    }
    if (mode === 'source')
      await f.editor.getByLabel('Symbol artwork x', { exact: true }).evaluate((el) => {
        const input = el as HTMLInputElement;
        input.value = '61';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    if (mode === 'tool')
      await f.editor.getByLabel('Symbol canvas tool', { exact: true }).selectOption('nodes');
    await releaseGeometry(page, mode === 'failure');
    await expect(
      f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeEnabled();
    if (mode === 'source') {
      await expect(f.editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('61');
      await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    }
    await f.editor.getByLabel('Symbol canvas tool', { exact: true }).selectOption('select');
    const next = await f.pos(110, 70);
    await page.mouse.dblclick(next.x, next.y);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect(f.editor.getByText('Selected 3 connected lines', { exact: true })).toBeVisible();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
