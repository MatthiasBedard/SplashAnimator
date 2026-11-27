import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { liveGraphicFixture, createLiveGraphics } from '../live-graphics-fixture';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, mode = 'loop', basis = 'plain', special = '') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const { p, span } = liveGraphicFixture(mode, basis);
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Graphic';
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.x += 60;
      s.y += 20;
    }
  if (special === 'affine-keys') {
    span.options = { affine: true };
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) shape.transform = [2, 0, 0.5, -3];
  }
  const out = createLiveGraphics(p, span);
  if (special === 'clock') out.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
  if (special === 'button') out.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
  if (special === 'locked') out.layers[0].locked = true;
  if (special === 'hidden') out.layers[0].visible = false;
  if (['two', 'laterBad', 'plain', 'group'].includes(special)) {
    const later = structuredClone(out.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad') later.keys[2].shapes[0].width++;
    if (special === 'plain' || special === 'group') {
      delete later.liveMotionSpans![0].symbolContinuity;
      for (const key of later.keys)
        key.shapes = key.shapes.map((s) => ({
          id: 'plain',
          kind: 'rectangle',
          x: s.x,
          y: s.y + 40,
          width: 8,
          height: 8,
          rotation: s.rotation,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        }));
      if (special === 'group') {
        later.liveMotionSpans![0].rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
        for (const key of later.keys)
          if (key.shapes.length) {
            key.shapes[0].groups = ['outer'];
            key.shapes.push({
              ...structuredClone(key.shapes[0]),
              id: 'plain2',
              x: key.shapes[0].x + 15,
            });
          }
        // Keep a fixed group so only the header scope, not a changed orbit, is tested.
        later.keys[2].shapes = structuredClone(later.keys[1].shapes);
      }
    }
    out.layers.push(later);
  }
  if (['mixed', 'channels'].includes(special))
    for (const key of out.layers[0].keys)
      if (key.shapes.length)
        key.shapes.push({
          id: 'plain',
          kind: 'rectangle',
          x: 200,
          y: 30,
          width: 8,
          height: 8,
          rotation: 0,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        });
  if (special === 'path')
    out.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 10, endX: 0, endY: 10 };
  if (special === 'channels') {
    Object.assign(out.layers[0].liveMotionSpans![0], {
      options: { paint: true },
      opacityEase: 'linear',
      paintEase: 'linear',
    });
    for (const key of out.layers[0].keys)
      if (key.shapes.length) {
        key.shapes[0].opacity = key.frame === 2 ? 0.2 : 0.8;
        key.shapes[1].fill = key.frame === 2 ? '#0000ff' : '#ff0000';
      }
  }
  if (special === 'advanced')
    Object.assign(out.layers[0].liveMotionSpans![0], {
      options: { affine: false, paint: false, nodes: false },
      opacityEase: 'out',
      path: { startX: 0, startY: 10, endX: 0, endY: 10, distance: false, tangent: false },
    });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('graphic-edit-seed')) {
      sessionStorage.setItem('graphic-edit-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, out);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const open = async () => {
    const b = page.getByRole('button', { name: 'Edit live tween…', exact: true });
    if (!(await b.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await b.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true }),
    row = d.getByLabel('Edit live tween Graphic frames 3–11', { exact: true });
  await expect(d.getByLabel('Include graphic live tweens')).not.toBeChecked();
  await expect(row).toBeDisabled();
  await d.getByLabel('Include graphic live tweens').check();
  if (!['locked', 'hidden'].includes(special)) await row.check();
  const timing = async () => {
    await d.getByLabel('Change live tween easing', { exact: true }).check();
    await d.getByLabel('Edited live tween easing', { exact: true }).selectOption('in');
  };
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    apply = async () => {
      await d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      await expect(d).toBeHidden();
    },
    undo = async (redo = false) => {
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    };
  return { p: out, d, row, read, apply, undo, open, timing, errors };
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.floor(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
            Math.floor(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`graphic edit ${mode}/${basis} changes geometry timing without changing playback age`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await f.timing();
      await f.apply();
      const out = await f.read();
      const expected = structuredClone(f.p);
      expected.layers[0].liveMotionSpans![0].ease = 'in';
      expect(out).toEqual(expected);
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const clock = mode === 'single' ? 1 : mode === 'once' || mode === 'default' ? 4 : 0,
        b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
        u = b[0] * (clock * 10 + 2) + b[2] * 2,
        v = b[1] * (clock * 10 + 2) + b[3] * 2,
        a = Math.PI / 8;
      await expect
        .poll(() =>
          pixel(
            page,
            f.p,
            100 + Math.cos(a) * u - Math.sin(a) * v,
            60 + Math.sin(a) * u + Math.cos(a) * v,
          ),
        )
        .toEqual([255, 0, 0, 255]);
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      await f.undo(true);
      expect(await f.read()).toEqual(out);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await f.read()).toEqual(out);
      expect(f.errors).toEqual([]);
    });
for (const special of ['clock', 'button', 'locked', 'hidden'])
  test(`graphic editing retains ${special} rejection and source recovery`, async ({ page }) => {
    const f = await setup(page, 'loop', 'plain', special);
    await f.timing();
    if (['locked', 'hidden'].includes(special))
      await f.row.evaluate((el) => {
        const e = el as HTMLInputElement;
        e.disabled = false;
        e.click();
      });
    await f.d
      .getByRole('button', { name: 'Apply live tween changes', exact: true })
      .evaluate((el) => {
        const e = el as HTMLButtonElement;
        e.disabled = false;
        e.click();
      });
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const special of ['two', 'laterBad', 'plain', 'group'])
  test(`graphic editing ${special} scopes stays atomic and preserves every marker/header`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special);
    if (special === 'group') await f.d.getByLabel('Include complete group live tweens').check();
    await f.d.getByLabel('Edit live tween Later frames 3–11', { exact: true }).check();
    await f.timing();
    if (special === 'laterBad') {
      await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      await expect(f.d.getByRole('status')).toContainText('Error:');
      expect(await f.read()).toEqual(f.p);
      await f.d.getByLabel('Edit live tween Later frames 3–11', { exact: true }).uncheck();
    }
    await f.apply();
    const out = await f.read(),
      expected = structuredClone(f.p);
    for (const l of expected.layers)
      if (l.id === 'track' || special !== 'laterBad') l.liveMotionSpans![0].ease = 'in';
    expect(out).toEqual(expected);
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('graphic editing preserves complete selection and actual exported playback pixels', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'mixed');
  await f.timing();
  await f.apply();
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  const pixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const x = c.getContext('2d')!;
    x.drawImage(image, 0, 0);
    return [
      [
        100 + 2 * Math.cos(Math.PI / 8) - 2 * Math.sin(Math.PI / 8),
        60 + 2 * Math.sin(Math.PI / 8) + 2 * Math.cos(Math.PI / 8),
      ],
      [204, 34],
    ].map(([a, b]) => Array.from(x.getImageData(Math.floor(a), Math.floor(b), 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(f.errors).toEqual([]);
});
for (const hook of ['clone', 'serialize'])
  for (const action of ['scope', 'source', 'target', 'close'])
    test(`graphic edit ${hook} rejects actual restored ${action} with fresh retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.timing();
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { graphicEditHook: state });
          const fire = (value: unknown) => {
            const p = value as Project;
            if (
              state.hit ||
              p?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity !== 'graphics' ||
              p.layers[0].liveMotionSpans[0].ease !== 'in'
            )
              return;
            state.hit = true;
            if (action === 'scope') {
              const e = document.querySelector(
                '[aria-label="Include graphic live tweens"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent graphic edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
            else {
              const e = document.querySelector(
                '[aria-label="Edited live tween easing"]',
              ) as HTMLSelectElement;
              for (const v of ['out', 'in']) {
                e.value = v;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(v: T) => {
              const out = clone(v);
              fire(v);
              return out;
            };
          } else {
            const stringify = JSON.stringify;
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args);
              fire(args[0]);
              return out;
            }) as typeof stringify;
          }
        },
        { hook, action },
      );
      await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { graphicEditHook: { hit: boolean } }).graphicEditHook.hit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Independent graphic edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Include graphic live tweens').check();
      await f.row.check();
      await f.timing();
      await f.apply();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const action of ['remove', 'replace'])
  test(`graphic explicit trajectory ${action} preserves clock metadata and history`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', 'path');
    await f.d.getByLabel('Live trajectory mode').selectOption(action);
    if (action === 'replace') {
      for (const [name, value] of [
        ['startX', '10'],
        ['startY', '5'],
        ['endX', '20'],
        ['endY', '5'],
      ])
        await f.d.getByLabel(`Live cubic ${name}`, { exact: true }).fill(value);
    }
    await f.apply();
    const out = await f.read();
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(out.symbols).toEqual(f.p.symbols);
    expect(out.layers[0].liveMotionSpans![0].symbolContinuity).toBe('graphics');
    expect(out.layers[0].liveMotionSpans![0].path).toEqual(
      action === 'remove' ? undefined : { startX: 10, startY: 5, endX: 20, endY: 5 },
    );
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const action of ['scope', 'candidate', 'source', 'reentry'])
  test(`graphic edit final recovery ${action} respects complete history admission`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.timing();
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { graphicEditFinal: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          v = args[0] as { project?: Project; folder?: unknown };
        if (
          !state.hit &&
          Object.hasOwn(v ?? {}, 'folder') &&
          v?.project?.layers?.[0]?.liveMotionSpans?.[0]?.ease === 'in'
        ) {
          state.hit = true;
          if (action === 'candidate') v.project.layers[0].keys[2].shapes[0].x++;
          else if (action === 'scope') {
            const e = document.querySelector(
              '[aria-label="Include graphic live tweens"]',
            ) as HTMLInputElement;
            e.click();
            e.click();
          } else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final graphic source';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else
            Array.from(document.querySelectorAll('button'))
              .find((e) => e.textContent?.trim() === 'Apply live tween changes')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { graphicEditFinal: { hit: boolean } }).graphicEditFinal.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else {
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Final graphic source';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Include graphic live tweens').check();
      await f.row.check();
      await f.timing();
      await f.apply();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('graphic independent opacity and mixed paint timing do not change graphic clocks or geometry ease', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'channels');
  await f.timing();
  for (const channel of ['opacity', 'paint']) {
    await f.d.getByLabel(`Live ${channel} easing mode`).selectOption('set');
    await f.d.getByLabel(`Live ${channel} easing`, { exact: true }).selectOption('out');
  }
  await f.apply();
  const out = await f.read(),
    expected = structuredClone(f.p);
  Object.assign(expected.layers[0].liveMotionSpans![0], {
    ease: 'in',
    opacityEase: 'out',
    paintEase: 'out',
  });
  expect(out).toEqual(expected);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const a = Math.PI / 8;
  await expect
    .poll(() =>
      pixel(
        page,
        f.p,
        100 + 2 * Math.cos(a) - 2 * Math.sin(a),
        60 + 2 * Math.sin(a) + 2 * Math.cos(a),
      ),
    )
    .toEqual([255, 89, 89, 255]);
  await expect.poll(() => pixel(page, f.p, 204, 34)).toEqual([191, 0, 64, 255]);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('graphic scope inclusion and Keep settings cannot add no-op history or bypass opt-out', async ({
  page,
}) => {
  const f = await setup(page);
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).evaluate((e) => {
    (e as HTMLButtonElement).disabled = false;
    (e as HTMLButtonElement).click();
  });
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.timing();
  await f.d.getByLabel('Include graphic live tweens').uncheck();
  await f.row.evaluate((el) => {
    const e = el as HTMLInputElement;
    e.disabled = false;
    if (!e.checked) e.click();
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Include graphic live tweens').check();
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('group-only header editing cannot silently discard a selected graphic record', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'group');
  await f.d.getByLabel('Include complete group live tweens').check();
  await f.d.getByLabel('Edit live tween Later frames 3–11', { exact: true }).check();
  await f.d.getByLabel('Edit live group direction').selectOption('clockwise');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.timing();
  await f.apply();
  const out = await f.read();
  expect(out.layers[0].liveMotionSpans![0].rotation).toBeUndefined();
  expect(out.layers[1].liveMotionSpans![0].rotation!.direction).toBe('clockwise');
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

test('graphic Keep preserves saved false options, paths, channels and headers exactly', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'affine', 'advanced');
  await f.timing();
  await f.apply();
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].ease = 'in';
  expect(await f.read()).toEqual(expected);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('graphic parent validation serialization cannot establish a changed candidate baseline', async ({
  page,
}) => {
  const f = await setup(page);
  await f.timing();
  await page.evaluate(() => {
    const stringify = JSON.stringify,
      state = { hit: false, count: 0 };
    Object.assign(window, { graphicParentValidation: state });
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const text = stringify(...args),
        q = args[0] as Project;
      if (
        q?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'graphics' &&
        q.layers[0].liveMotionSpans[0].ease === 'in'
      ) {
        state.count++;
        if (state.count === 4) {
          state.hit = true;
          q.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
        }
      }
      return text;
    }) as typeof stringify;
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { graphicParentValidation: { hit: boolean } }).graphicParentValidation
          .hit,
    ),
  ).toBe(true);
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('keyed graphic scale and shear preserve the reflected child on recovery and split', async ({page}) => {
  const f = await setup(page, 'loop', 'plain', 'affine-keys');
  for (const [label, value] of [['Horizontal scale','400'], ['Vertical scale','-100'], ['Shear','150']]) {
    await f.d.getByText(label + ' keys', {exact:true}).click();
    const controls = f.d.locator('details').filter({has:page.getByText(label + ' keys', {exact:true})});
    await controls.getByLabel(label + ' key action').selectOption('set');
    await f.d.getByLabel(label + ' key frame', {exact:true}).fill('7');
    await f.d.getByLabel(label + ' (%)', {exact:true}).fill(value);
  }
  await f.apply();
  const keyed = await f.read();
  await f.open();
  await f.d.getByLabel('Include graphic live tweens').check();
  await f.row.check();
  for (const [label, ease] of [['Horizontal scale','in'], ['Vertical scale','out']]) {
    await f.d.getByText(label + ' keys', {exact:true}).click();
    await f.d.getByLabel(label + ' interval ending at').selectOption('4');
    await f.d.getByLabel(label + ' interval easing', {exact:true}).selectOption(ease);
  }
  await f.apply();
  const saved = await f.read();
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  await f.undo(); await expect.poll(f.read).toEqual(keyed);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  await page.reload();
  await page.getByRole('button', {name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox', {name:'Zoom',exact:true}).selectOption('1');
  await page.getByLabel('Timeline frames',{exact:true}).click({position:{x:4*18+8,y:40}});
  const angle = Math.PI/8;
  await expect.poll(() => pixel(page, f.p, 100+82*Math.cos(angle)+3*Math.sin(angle),
    60+82*Math.sin(angle)-3*Math.cos(angle))).toEqual([255,0,0,255]);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/^Insert live graphic tween key/}).click();
  await page.getByLabel('Live graphic split frame',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Insert preserved live graphic key',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const split = await f.read(), placement = split.layers[0].keys.find(k=>k.frame===4)!.shapes[0];
  expect(placement.transform).toEqual([2.5,0,1,-1.5]);
  expect(placement.symbolPlayback!.firstFrame).toBe(3);
  expect(split.symbols).toEqual(f.p.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(saved);
  expect(f.errors).toEqual([]);
});

for (const appearance of [false,true]) test(appearance
  ? 'graphic opacity and custom rotation intervals preserve its child clock'
  : 'graphic X and Y intervals move the placement while its child clock advances',async({page})=>{
  const f=await setup(page);
  const channels=appearance ? [['Opacity','25',' (%)'],['Rotation','480',' (degrees)']] : [['X','144',' coordinate'],['Y','98',' coordinate']];
  const section=appearance?' keys':' position keys';
  for(const [axis,value,suffix] of channels){
    await f.d.getByText(axis+section,{exact:true}).click();
    const controls=f.d.locator('details').filter({has:f.d.page().getByText(axis+section,{exact:true})});
    await controls.getByLabel(axis+' key action').selectOption('set');
    await controls.getByLabel(axis+' key frame',{exact:true}).fill('7');
    await controls.getByLabel(axis+suffix,{exact:true}).fill(value);
  }
  await f.apply();
  const keyed=await f.read();
  await f.open();
  await f.d.getByLabel('Include graphic live tweens').check(); await f.row.check();
  const curve={kind:'cubic',x1:0,y1:1,x2:1,y2:1};
  for(const [axis,ease] of appearance ? [['Opacity','in'],['Rotation','custom']] : [['X','in'],['Y','out']]){
    await f.d.getByText(axis+section,{exact:true}).click();
    await f.d.getByLabel(axis+' interval ending at').selectOption('4');
    await f.d.getByLabel(axis+' interval easing',{exact:true}).selectOption(ease);
    if(ease==='custom') for(const key of ['x1','y1','x2','y2'] as const)
      await f.d.getByLabel(axis+' interval easing '+key.toUpperCase(),{exact:true}).fill(String(curve[key]));
  }
  await f.apply();
  const saved=await f.read(), expected=structuredClone(keyed);
  Object.assign(expected.layers[0].liveMotionSpans![0],appearance ? {opacityKeyEases:['in','linear'],rotationKeyEases:[curve,'linear']} : {xKeyEases:['in','linear'],yKeyEases:['out','linear']});
  expect(saved).toEqual(expected);
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  await f.undo(); await expect.poll(f.read).toEqual(keyed);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const timeline=page.getByLabel('Timeline frames',{exact:true});
  await timeline.click({position:{x:4*18+8,y:40}});
  const angle=appearance?Math.PI/3:Math.PI/8, x=appearance?100:96, y=appearance?60:86;
  await expect.poll(()=>pixel(page,f.p,x+32*Math.cos(angle)-2*Math.sin(angle),y+32*Math.sin(angle)+2*Math.cos(angle))).toEqual(appearance?[255,48,48,255]:[255,0,0,255]);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/^Insert live graphic tween key/}).click();
  await page.getByLabel('Live graphic split frame',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Insert preserved live graphic key',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const split=await f.read(), middle=split.layers[0].keys.find(k=>k.frame===4)!.shapes[0];
  expect([middle.x,middle.y,middle.symbolPlayback!.firstFrame]).toEqual([x,y,3]);
  if(appearance){
    expect(middle.opacity).toBe(0.8125);
    expect(middle.rotation).toBeCloseTo(420,10);
  }
  expect(split.symbols).toEqual(saved.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(saved);
  expect(f.errors).toEqual([]);
});
