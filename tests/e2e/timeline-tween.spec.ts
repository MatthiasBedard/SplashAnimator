import { test, expect, type Page } from '@playwright/test';
import { newProject, newLayer, type Project } from '../../packages/document/src';

function fixture(single = false, shape = false) {
  const p = newProject();
  p.width = 300;
  p.height = 200;
  p.duration = 12;
  p.fps = 4;
  p.layers[0].name = 'Artwork';
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
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
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    ...(single
      ? []
      : [
          {
            frame: 8,
            shapes: [
              {
                ...structuredClone(art),
                x: 100,
                y: 70,
                ...(shape ? { width: 80, height: 60, fill: '#0000ff' } : {}),
              },
            ],
          },
          { frame: 10, shapes: [] },
        ]),
  ];
  return p;
}
async function setup(page: Page, p: Project) {
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
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const point = async (frame: number, row = 0) => {
    const r = (await timeline.boundingBox())!;
    return { x: r.x + frame * 18 + 9, y: r.y + 25 + row * 28 + 14 };
  };
  const open = async (kind: 'motion' | 'shape', at = 4, row = 0) => {
    const q = await point(at, row);
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page
      .getByRole('button', { name: `Advanced ${kind} tween settings…`, exact: true })
      .click();
    return page.getByRole('dialog', { name: `Convert to ${kind} tween`, exact: true });
  };
  const seek = async (at: number) => {
    const q = await point(at);
    await page.mouse.click(q.x, q.y);
  };
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n, { p, x, y }) => {
        const c = n as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
              Math.round(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { p, x, y },
    );
  return { read, open, canvas, timeline, point, seek, pixel };
}
for (const kind of ['motion', 'shape'] as const)
  test(`advanced settings create a functional sparse ${kind} tween with exact Undo/Redo`, async ({
    page,
  }) => {
    const p = fixture(false, kind === 'shape'),
      f = await setup(page, p);
    const dialog = await f.open(kind);
    const start = dialog.getByLabel('Tween start frame', { exact: true });
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    const create = dialog.getByRole('button', { name: `Create ${kind} tween`, exact: true });
    await expect(start).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
    expect(await f.read()).toEqual(p);
    await f.open(kind);
    await expect(start).toBeFocused();
    await expect(start).toHaveValue('1');
    await expect(dialog.getByLabel('Tween end frame', { exact: true })).toHaveValue('9');
    await create.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(f.canvas).toBeFocused();
    const out = await f.read();
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(out.layers[0].liveMotionSpans).toHaveLength(1);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
    await expect(
      page.getByLabel(`${kind === 'shape' ? 'Shape' : 'Motion'} tween layer`, { exact: true }),
    ).toBeVisible();
    const timelinePixel = (x: number, y: number) =>
      page.getByLabel('Timeline frames', { exact: true }).evaluate(
        (node, { x, y }) => {
          const c = node as HTMLCanvasElement;
          const bounds = c.getBoundingClientRect();
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.floor((x * c.width) / bounds.width),
                Math.floor((y * c.height) / bounds.height),
                1,
                1,
              ).data,
          );
        },
        { x, y },
      );
    const color = kind === 'shape' ? [74, 222, 128, 255] : [96, 165, 250, 255];
    // Entire source/interior/destination cells carry the tween color, not a thin badge.
    for (const at of [0, 3, 8])
      await expect.poll(() => timelinePixel(at * 18 + 3, 31)).toEqual(color);
    await expect.poll(() => timelinePixel(3 * 18 + 9, 42)).toEqual([0, 0, 0, 255]);
    await expect.poll(() => timelinePixel(8 * 18 - 1, 41)).toEqual([0, 0, 0, 255]);
    // The held exposure carries the tween type after its last authored key.
    await expect.poll(() => timelinePixel(9 * 18 + 3, 31)).toEqual(color);
    await f.seek(4);
    await expect
      .poll(() => f.pixel(kind === 'shape' ? 115 : 80, 65))
      .toEqual(kind === 'shape' ? [128, 0, 128, 255] : [255, 0, 0, 255]);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(p);
    await expect.poll(() => timelinePixel(3 * 18 + 3, 31)).not.toEqual(color);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
    await expect.poll(() => timelinePixel(3 * 18 + 3, 31)).toEqual(color);
  });
for (const kind of ['motion', 'shape'] as const)
  test(`single-key advanced ${kind} conversion respects the matching-endpoint default`, async ({
    page,
  }) => {
    const p = fixture(true),
      other = newLayer('Other');
    p.layers.push(other);
    const f = await setup(page, p),
      dialog = await f.open(kind, 0, 1);
    await expect(dialog.getByLabel('Tween end frame', { exact: true })).toHaveValue('5');
    await dialog.getByRole('button', { name: `Create ${kind} tween`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const out = await f.read();
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual(kind === 'motion' ? [0] : [0, 4]);
    if (kind === 'motion') expect(out.layers[0].keys[0].openMotionTween).toBeDefined();
    else expect(out.layers[0].keys[1].shapes).toEqual(p.layers[0].keys[0].shapes);
    expect(out.layers[1]).toEqual(other);
    expect(out.duration).toBe(12);
    if (kind === 'motion') {
      await f.canvas.press('Control+z');
      await expect.poll(f.read).toEqual(p);
      const explicit = await f.open(kind, 0, 1);
      await explicit.getByLabel('Create matching tween endpoints', { exact: true }).check();
      await explicit.getByRole('button', { name: 'Create motion tween', exact: true }).click();
      const withEnd = await f.read();
      expect(withEnd.layers[0].keys.map(key => key.frame)).toEqual([0, 4]);
      expect(withEnd.layers[0].keys.every(key => !key.openMotionTween)).toBe(true);
    }
  });
test('converting an existing complete shape tween to motion preserves identity and is reversible', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p),
    first = await f.open('shape');
  await first.getByRole('button', { name: 'Create shape tween', exact: true }).click();
  const shape = await f.read();
  const second = await f.open('motion');
  await second.getByRole('button', { name: 'Create motion tween', exact: true }).click();
  await expect(second).toHaveCount(0);
  const motion = await f.read();
  expect(motion.layers[0].liveMotionSpans![0].id).toBe(shape.layers[0].liveMotionSpans![0].id);
  expect(motion.layers[0].keys).toEqual(p.layers[0].keys);
  expect(motion.layers[0].liveMotionSpans![0].options?.nodes).toBeUndefined();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(shape);
});
for (const mode of ['locked', 'hidden', 'empty'] as const)
  test(`${mode} layer has disabled conversion commands`, async ({ page }) => {
    const p = fixture();
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'empty') p.layers[0].keys[0].shapes = [];
    const f = await setup(page, p),
      q = await f.point(2);
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Convert to motion tween', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: 'Convert to shape tween', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(p);
  });
test('Cancel and authored interior-key rejection never rewrite the original layer', async ({
  page,
}) => {
  const p = fixture();
  p.layers[0].keys.splice(1, 0, { frame: 4, shapes: structuredClone(p.layers[0].keys[0].shapes) });
  const f = await setup(page, p),
    dialog = await f.open('shape', 0);
  await dialog.getByLabel('Tween end frame', { exact: true }).fill('9');
  await dialog.getByRole('button', { name: 'Create shape tween', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('interior keys');
  expect(await f.read()).toEqual(p);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
  expect(await f.read()).toEqual(p);
});
for (const action of ['input', 'source'] as const)
  test(`late ${action} after detached tween creation rejects stale publication`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p),
      dialog = await f.open('shape');
    await page.evaluate((action) => {
      const native = structuredClone;
      Object.assign(window, { tweenHook: 0 });
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          q = out as Project;
        if (
          !(window as unknown as { tweenHook: number }).tweenHook &&
          q?.layers?.[0]?.liveMotionSpans?.[0]?.options?.nodes
        ) {
          (window as unknown as { tweenHook: number }).tweenHook++;
          const input = document.querySelector(
            action === 'input' ? '[aria-label="Tween end frame"]' : '[aria-label="Layer name"]',
          ) as HTMLInputElement;
          input.value = action === 'input' ? '7' : 'User layer edit';
          input.dispatchEvent(
            new Event(action === 'input' ? 'input' : 'change', { bubbles: true }),
          );
        }
        return out;
      }) as typeof native;
    }, action);
    await dialog.getByRole('button', { name: 'Create shape tween', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { tweenHook: number }).tweenHook)).toBe(
      1,
    );
    const expected = structuredClone(p);
    if (action === 'source') expected.layers[0].name = 'User layer edit';
    expect(await f.read()).toEqual(expected);
    await expect(dialog.getByRole('alert')).toBeVisible();
    if (action === 'input') {
      await expect(dialog.getByLabel('Tween end frame', { exact: true })).toHaveValue('7');
      await dialog.getByRole('button', { name: 'Create shape tween', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await f.read()).layers[0].liveMotionSpans![0].end).toBe(6);
    }
  });

for (const kind of ['motion', 'shape'] as const)
  for (const at of [1, 4, 7, 8, 9])
    test(`ordinary keyframe insertion works in ${kind} at frame ${at} with retained artwork and one Undo`, async ({
      page,
    }) => {
      const f = await setup(page, fixture(false, kind === 'shape')),
        dialog = await f.open(kind);
      await dialog.getByRole('button', { name: `Create ${kind} tween`, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await f.seek(at);
      const before = await f.read(),
        x = at <= 8 ? 20 + 10 * at + 5 : 105,
        y = at <= 8 ? 30 + 5 * at + 5 : 75;
      const expected =
        kind === 'motion'
          ? [255, 0, 0, 255]
          : [
              Math.round(255 * (1 - Math.min(at, 8) / 8)),
              0,
              Math.round((255 * Math.min(at, 8)) / 8),
              255,
            ];
      await expect.poll(() => f.pixel(x, y)).toEqual(expected);
      if (at === 4) {
        await f.timeline.focus();
        await page.keyboard.press('F6');
      } else {
        const q = await f.point(at);
        await page.mouse.click(q.x, q.y, { button: 'right' });
        await page
          .getByRole('menuitem', {
            name: at === 7 ? 'Convert to keyframe' : 'Insert keyframe',
            exact: true,
          })
          .click();
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      const after = await f.read();
      expect(after.layers[0].keys.some((k) => k.frame === at)).toBe(true);
      await expect.poll(() => f.pixel(x, y)).toEqual(expected);
      expect(after.layers[0].keys.filter((k) => k.frame !== at)).toEqual(
        before.layers[0].keys.filter((k) => k.frame !== at),
      );
      if (at !== 8) {
        await f.timeline.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(before);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(after);
      } else expect(after).toEqual(before);
    });

test('repeated F6 insertion reaches every tween frame and permits direct editing of the new key', async ({
  page,
}) => {
  const f = await setup(page, fixture()),
    dialog = await f.open('motion');
  await dialog.getByRole('button', { name: 'Create motion tween', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  for (const at of [1, 7, 4, 3, 2, 5, 6]) {
    await f.seek(at);
    await f.timeline.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  const after = await f.read();
  expect(after.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10]);
  await f.seek(4);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  const x = page.getByLabel('Shape X', { exact: true });
  await x.fill('99');
  await x.press('Tab');
  await expect
    .poll(async () => (await f.read()).layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x)
    .toBe(99);
});
for (const action of ['source', 'frame', 'reentry'] as const)
  test(`late ${action} after a complete keyframe candidate rejects stale publication and permits retry`, async ({
    page,
  }) => {
    const f = await setup(page, fixture()),
      dialog = await f.open('motion');
    await dialog.getByRole('button', { name: 'Create motion tween', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await f.seek(4);
    const before = await f.read();
    await page.evaluate((action) => {
      const native = JSON.stringify;
      Object.assign(window, { keyframeHook: 0 });
      JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
        const q = (value as { project?: Project })?.project;
        if (
          !(window as unknown as { keyframeHook: number }).keyframeHook &&
          q?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
          q.layers[0].liveMotionSpans?.length === 2
        ) {
          (window as unknown as { keyframeHook: number }).keyframeHook++;
          if (action === 'source') {
            const input = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            input.value = 'User edit';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else
            document
              .querySelector('[aria-label="Timeline frames"]')!
              .dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: action === 'reentry' ? 'F6' : 'ArrowRight',
                  bubbles: true,
                }),
              );
        }
        return Reflect.apply(native, JSON, [value, ...rest]);
      }) as typeof native;
    }, action);
    await f.timeline.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('alert')).toContainText('changed');
    expect(
      await page.evaluate(() => (window as unknown as { keyframeHook: number }).keyframeHook),
    ).toBe(1);
    const expected = structuredClone(before);
    if (action === 'source') expected.layers[0].name = 'User edit';
    expect(await f.read()).toEqual(expected);
    await f.seek(4);
    await f.timeline.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await f.read()).layers[0].keys.some((k) => k.frame === 4)).toBe(true);
  });

test('edit easing from a held open tween cell without inserting keys or moving the playhead',async ({page})=>{
  const p=fixture(true),key=p.layers[0].keys[0];
  key.openMotionTween={affine:false,ease:'linear'};
  const f=await setup(page,p), point=await f.point(4);
  await page.mouse.click(point.x,point.y,{button:'right'});
  await page.getByRole('menuitem',{name:'Edit motion tween easing',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit motion tween easing',exact:true});
  await expect(dialog.getByLabel('Tween end frame')).toHaveCount(0);
  const easing=dialog.getByLabel('Tween easing',{exact:true});
  await expect(easing).toBeFocused();
  // Applying an unchanged curve returns to the selected cell without a history edit.
  await dialog.getByRole('button',{name:'Apply easing',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(f.timeline).toBeFocused();
  expect(await f.read()).toEqual(p);
  await page.mouse.click(point.x,point.y,{button:'right'});
  await page.getByRole('menuitem',{name:'Edit motion tween easing',exact:true}).click();
  await easing.selectOption('out');
  await dialog.getByRole('button',{name:'Apply easing',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(f.timeline).toBeFocused();
  const expected=structuredClone(p);
  expected.layers[0].keys[0].openMotionTween!.ease='out';
  await expect.poll(f.read).toEqual(expected);
  await expect(page.locator('.frame-readout')).toContainText('Frame 5');
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
});
