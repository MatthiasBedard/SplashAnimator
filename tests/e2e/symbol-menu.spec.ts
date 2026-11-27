import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';

async function setup(page: Page, merge = false, locked = false, held = false, outside = false, customize?: (project: Project) => void) {
  const p = newProject();
  p.width = 300;
  p.height = 200;
  p.duration = 12;
  p.layers[0].drawingMode = merge ? 'merge' : 'object';
  p.layers[0].locked = locked;
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'red',
          kind: 'rectangle',
          x: 60,
          y: 40,
          width: 100,
          height: 80,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
    { frame: 8, shapes: [] },
  ];
  if (outside) {
    const red = p.layers[0].keys[0].shapes[0];
    p.layers[0].keys[0].shapes = [
      { ...structuredClone(red), id: 'before', x: 10, width: 25, height: 30, fill: '#0000ff' },
      red,
      { ...structuredClone(red), id: 'after', x: 220, width: 25, height: 30, fill: '#00ff00' },
    ];
  }
  if (held) {
    p.layers[0].keys[0].frame = 3;
    p.layers[0].keys.unshift({ frame: 0, shapes: [] });
  }
  customize?.(p);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  if (held)
    await page
      .getByLabel('Timeline frames', { exact: true })
      .click({ position: { x: 5 * 18 + 9, y: 40 } });
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const point = async (x: number, y: number) => {
    const b = (await stage.boundingBox())!;
    return { x: b.x + b.width / 2 + x - 150, y: b.y + b.height / 2 + y - 100 };
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (x: number, y: number) =>
    stage.evaluate(
      (c, { x, y }) => {
        const n = c as HTMLCanvasElement;
        return Array.from(
          n
            .getContext('2d')!
            .getImageData(
              Math.round(n.width / 2 + (x - 150) * devicePixelRatio),
              Math.round(n.height / 2 + (y - 100) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );
  const open = async (surface: 'edit' | 'context', kind: 'symbol' | 'movie clip') => {
    if (surface === 'edit') {
      await stage.focus();
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: `Convert to ${kind}…`, exact: true }).click();
    } else {
      const q = await point(100, 70);
      await page.mouse.click(q.x, q.y, { button: 'right' });
      await page.getByRole('menuitem', { name: `Convert to ${kind}…`, exact: true }).click();
    }
    return page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
  };
  return { p, stage, point, read, pixel, open };
}

for (const [surface, kind] of [['edit', 'symbol'], ['context', 'movie clip']] as const)
  test(`converts a group containing a linked instance to a ${kind} from ${surface}`, async ({ page }) => {
    const f = await setup(page, false, false, false, false, project => {
      const artwork = project.layers[0].keys[0].shapes[0];
      artwork.groups = ['mixed-group'];
      const child = {
        id: 'linked-child', name: 'Linked child', width: 60, height: 50,
        shapes: [{ ...structuredClone(artwork), id: 'blue', groups: [], x: 0, y: 0, width: 60, height: 50, fill: '#0000ff' }],
      };
      project.symbols = [child];
      project.layers[0].keys[0].shapes.push({ ...symbolInstance(child, 175, 45), groups: ['mixed-group'] });
    });
    const dialog = await f.open(surface, kind);
    await dialog.getByLabel('Symbol name', { exact: true }).fill('Mixed group');
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const converted = await f.read();
    expect(converted.layers).toHaveLength(1);
    expect(converted.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
    expect(converted.symbols![0]).toEqual(f.p.symbols![0]);
    expect(converted.symbols![1].shapes).toMatchObject([
      { id: 'red', groups: ['mixed-group'] },
      { id: f.p.layers[0].keys[0].shapes[1].id, symbolId: 'linked-child', groups: ['mixed-group'] },
    ]);
    expect(converted.layers[0].keys[0].shapes).toMatchObject([{
      kind: 'symbol', symbolId: converted.symbols![1].id,
      symbolPlayback: { mode: kind === 'movie clip' ? 'movie' : 'loop', firstFrame: 0 },
    }]);
    await page.mouse.move(1, 1);
    await expect.poll(() => f.pixel(90, 65)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(190, 70)).toEqual([0, 0, 255, 255]);
    await f.stage.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('keyboard symbol conversion confines focus and returns to the stage', async ({ page }) => {
  const f = await setup(page);
  await f.stage.press('Control+a');
  await page.keyboard.press('F8');
  const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Symbol name', exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(name).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(f.stage).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await page.keyboard.press('F8');
  await expect(name).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Keyboard graphic');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(f.stage).toBeFocused();
  const converted = await f.read();
  expect(converted.symbols?.[0].name).toBe('Keyboard graphic');
  expect(converted.layers[0].id).toBe(f.p.layers[0].id);
  expect(converted.layers).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

for (const surface of ['edit', 'context'] as const)
  for (const kind of ['symbol', 'movie clip'] as const)
    test(`${surface} converts selection to ${kind} with unchanged artwork and exact Undo/Redo`, async ({
      page,
    }) => {
      const f = await setup(page),
        dialog = await f.open(surface, kind);
      await expect(dialog.getByLabel('Symbol type', { exact: true })).toHaveValue(
        kind === 'symbol' ? 'graphic' : 'movie',
      );
      await expect(dialog.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
      await dialog.getByLabel('Symbol name', { exact: true }).fill('My artwork');
      await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const converted = await f.read(),
        instance = converted.layers[0].keys[0].shapes[0];
      expect(converted.layers).toHaveLength(1);
      expect(converted.layers[0].id).toBe(f.p.layers[0].id);
      expect(converted.symbols).toHaveLength(1);
      expect(converted.symbols![0].name).toBe('My artwork');
      expect(instance.kind).toBe('symbol');
      expect(instance.symbolPlayback).toEqual({
        mode: kind === 'symbol' ? 'loop' : 'movie',
        firstFrame: 0,
      });
      if (kind === 'symbol')
        await expect(page.getByLabel('Symbol playback', { exact: true })).toHaveValue('loop');
      expect(converted.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
      expect(converted.duration).toBe(12);
      await page.mouse.move(1, 1);
      await expect.poll(() => f.pixel(100, 70)).toEqual([255, 0, 0, 255]);
      await f.stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(converted);
    });

for (const kind of ['symbol', 'movie clip'] as const)
  test(`merged artwork converts to ${kind} on a separate object layer with bounded exposure`, async ({
    page,
  }) => {
    const f = await setup(page, true),
      dialog = await f.open('edit', kind);
    await expect(dialog.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
    await dialog.getByLabel('Create new layer', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const q = await f.read();
    expect(q.layers).toHaveLength(2);
    expect(q.layers[0].drawingMode).toBe('merge');
    expect(q.layers[0].keys[0].shapes).toEqual([]);
    expect(q.layers[1].drawingMode).toBe('object');
    expect(q.layers[1].keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(q.layers[1].keys[1].shapes).toEqual([]);
    await page.mouse.move(1, 1);
    await expect.poll(() => f.pixel(100, 70)).toEqual([255, 0, 0, 255]);
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

for (const createLayer of [false, true])
  test(`partial paint region conversion preserves outside ink with new layer=${createLayer}`, async ({
    page,
  }) => {
    const f = await setup(page, true),
      a = await f.point(35, 25),
      b = await f.point(110, 135);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(
      page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
    ).toBeVisible();
    const q = await f.point(85, 70);
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Convert to movie clip…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
    await expect(dialog.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
    if (createLayer) await dialog.getByLabel('Create new layer', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const out = await f.read();
    expect(out.layers).toHaveLength(createLayer ? 2 : 1);
    expect(out.layers[0].id).toBe(f.p.layers[0].id);
    expect(out.layers[0].drawingMode).toBe(createLayer ? 'merge' : 'object');
    expect(out.layers[createLayer ? 1 : 0].keys[0].shapes.some((s) => s.kind === 'symbol')).toBe(
      true,
    );
    expect(out.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
    expect(out.layers[0].keys[0].shapes.length).toBeGreaterThan(0);
    expect(out.symbols![0].width).toBeCloseTo(50, 6);
    await page.mouse.move(1, 1);
    await expect.poll(() => f.pixel(85, 70)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.pixel(140, 70)).toEqual([255, 0, 0, 255]);
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
  });

test('Cancel and invalid empty name preserve selection artwork', async ({ page }) => {
  const f = await setup(page),
    dialog = await f.open('edit', 'symbol');
  await dialog.getByLabel('Symbol name', { exact: true }).fill(' ');
  await expect(
    dialog.getByRole('button', { name: 'Convert selection', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Create new layer', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  const reopened = await f.open('edit', 'symbol');
  await expect(reopened.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('locked selection cannot convert from either menu', async ({ page }) => {
  const f = await setup(page, false, true);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Convert to symbol…', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  const q = await f.point(100, 70);
  await page.mouse.click(q.x, q.y, { button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Convert to movie clip…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
});

for (const action of ['input', 'source', 'layer policy'] as const)
  test(`late ${action} after detached symbol creation rejects stale publication`, async ({
    page,
  }) => {
    const f = await setup(page),
      dialog = await f.open('edit', 'movie clip'),
      initialName = await dialog.getByLabel('Symbol name', { exact: true }).inputValue();
    await page.evaluate((action) => {
      const native = JSON.stringify,
        descriptors = Object.getOwnPropertyDescriptors;
      let original: Project | undefined;
      Object.getOwnPropertyDescriptors = ((value: unknown) => {
        const q = value as Project;
        if (!original && q?.layers?.[0]?.keys && !q.symbols) original = q;
        return descriptors(value as object);
      }) as typeof descriptors;
      Object.assign(window, { symbolMenuHook: 0 });
      JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
        const q = (value as { project?: Project })?.project;
        if (
          !(window as unknown as { symbolMenuHook: number }).symbolMenuHook &&
          q?.symbols?.length &&
          q.layers?.[0]?.keys?.[0]?.shapes?.[0]?.kind === 'symbol'
        ) {
          (window as unknown as { symbolMenuHook: number }).symbolMenuHook++;
          if (action === 'source') original!.layers[0].name = 'User layer edit';
          else if (action === 'layer policy') {
            const field = document.querySelector(
              '[aria-label="Create new layer"]',
            ) as HTMLInputElement;
            for (const v of [true, false]) {
              field.checked = v;
              field.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            const field = document.querySelector('[aria-label="Symbol name"]') as HTMLInputElement;
            field.value = 'Current name';
            field.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        return Reflect.apply(native, JSON, [value, ...rest]);
      }) as typeof native;
    }, action);
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { symbolMenuHook: number }).symbolMenuHook),
    ).toBe(1);
    const expected = structuredClone(f.p);
    if (action === 'source')
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('User layer edit');
    expect(await f.read()).toEqual(expected);
    if (action !== 'source') {
      await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await f.read()).symbols![0].name).toBe(
        action === 'input' ? 'Current name' : initialName,
      );
      expect((await f.read()).layers).toHaveLength(1);
    }
  });

for (const way of ['cancel', 'placement'] as const)
  test(`${way === 'cancel' ? 'Cancel' : 'Changing and restoring layer placement'} during detached paint extraction cannot publish a symbol`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const NativeWorker = Worker,
        queue: (() => void)[] = [];
      Object.assign(window, {
        holdSymbolClip: false,
        symbolClipPending: () => queue.length,
        releaseSymbolClip: () => queue.splice(0).forEach((f) => f()),
      });
      window.Worker = class extends NativeWorker {
        postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
          const send = () =>
            Array.isArray(transfer)
              ? super.postMessage(message, transfer)
              : super.postMessage(message, transfer);
          if (
            (window as unknown as { holdSymbolClip: boolean }).holdSymbolClip &&
            (message as { clip?: unknown }).clip
          )
            queue.push(send);
          else send();
        }
      };
    });
    const f = await setup(page, true),
      a = await f.point(35, 25),
      b = await f.point(110, 135);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(
      page.getByText('Paint region ready: copy, cut or move.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Convert to symbol…', exact: true }).click();
    await page.evaluate(() => Object.assign(window, { holdSymbolClip: true }));
    const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { symbolClipPending: () => number }).symbolClipPending(),
        ),
      )
      .toBe(1);
    if (way === 'cancel') {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
    } else {
      await dialog.getByLabel('Create new layer', { exact: true }).check();
      await dialog.getByLabel('Create new layer', { exact: true }).uncheck();
    }
    await page.evaluate(() => {
      Object.assign(window, { holdSymbolClip: false });
      (window as unknown as { releaseSymbolClip: () => void }).releaseSymbolClip();
    });
    if (way === 'cancel') {
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Convert to symbol…', exact: true }),
      ).toBeEnabled();
      expect(await f.read()).toEqual(f.p);
    } else {
      await expect(dialog.getByRole('alert')).toContainText('Conversion settings changed');
      expect(await f.read()).toEqual(f.p);
      await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await f.read()).layers).toHaveLength(1);
      await page.mouse.move(1, 1);
      await expect.poll(() => f.pixel(85, 70)).toEqual([255, 0, 0, 255]);
      await expect.poll(() => f.pixel(140, 70)).toEqual([255, 0, 0, 255]);
      await f.stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    }
  });

for (const kind of ['symbol', 'movie clip'] as const)
  test(`paint conversion to ${kind} stays on its original layer by default`, async ({ page }) => {
    const f = await setup(page, true, false, false, true),
      dialog = await f.open('context', kind);
    await expect(dialog.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const q = await f.read();
    expect(q.layers).toHaveLength(1);
    expect(q.layers[0].id).toBe(f.p.layers[0].id);
    expect(q.layers[0].name).toBe(f.p.layers[0].name);
    expect(q.layers[0].drawingMode).toBe('object');
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(q.layers[0].keys[1]).toEqual(f.p.layers[0].keys[1]);
    expect(q.layers[0].keys[0].shapes[1].kind).toBe('symbol');
    expect(q.layers[0].keys[0].shapes[0]).toEqual(f.p.layers[0].keys[0].shapes[0]);
    expect(q.layers[0].keys[0].shapes[2]).toEqual(f.p.layers[0].keys[0].shapes[2]);
    expect(q.layers[0].keys[0].shapes[1].symbolPlayback?.mode ?? 'loop').toBe(
      kind === 'symbol' ? 'loop' : 'movie',
    );
    await page.mouse.move(1, 1);
    await expect.poll(() => f.pixel(100, 70)).toEqual([255, 0, 0, 255]);
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
  });

test('object artwork can opt into a new conversion layer with its original held exposure', async ({
  page,
}) => {
  const f = await setup(page, false, false, true),
    dialog = await f.open('context', 'symbol');
  await expect(dialog.getByLabel('Create new layer', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Create new layer', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const q = await f.read();
  expect(q.layers).toHaveLength(2);
  expect(q.layers[0].id).toBe(f.p.layers[0].id);
  expect(q.layers[0].drawingMode).toBe('object');
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 3, 8]);
  expect(q.layers[0].keys[1].shapes).toEqual([]);
  expect(q.layers[1].keys.map((k) => k.frame)).toEqual([0, 3, 8]);
  expect(q.layers[1].keys[0].shapes).toEqual([]);
  expect(q.layers[1].keys[1].shapes[0].kind).toBe('symbol');
  expect(q.layers[1].keys[2].shapes).toEqual([]);
  await page.mouse.move(1, 1);
  await expect.poll(() => f.pixel(100, 70)).toEqual([255, 0, 0, 255]);
  await f.stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(q);
});
