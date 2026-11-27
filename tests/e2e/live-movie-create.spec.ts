import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { liveMovieFixture } from '../live-movies-fixture';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, mode = 'one', basis = 'plain', special = '') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const { p } = liveMovieFixture(mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1, basis);
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Movie';
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.x += 60;
      s.y += 20;
    }
  const last = p.layers[0].keys[2].shapes[0];
  if (special === 'clock') last.symbolPlayback!.firstFrame = 2;
  if (special === 'graphic')
    for (const key of p.layers[0].keys)
      for (const s of key.shapes) s.symbolPlayback = { mode: 'loop', firstFrame: 1 };
  if (special === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
  if (special === 'nestedMovie' || special === 'nestedButton') {
    const leaf = { ...structuredClone(p.symbols![0]), id: 'leaf' };
    p.symbols!.push(leaf);
    p.symbols![0].shapes = [
      {
        ...symbolInstance(leaf, 0, 0),
        symbolPlayback: {
          mode: special === 'nestedMovie' ? 'movie' : 'loop',
          firstFrame: 0,
        },
      },
    ];
    if (special === 'nestedButton') leaf.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  }
  if (special === 'group')
    for (const key of p.layers[0].keys) for (const s of key.shapes) s.groups = ['outer'];
  if (special === 'identity') last.id = 'other';
  if (special === 'locked') p.layers[0].locked = true;
  if (special === 'hidden') p.layers[0].visible = false;
  if (special === 'two' || special === 'laterBad') {
    const later = structuredClone(p.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad') later.keys[2].shapes[0].width += 1;
    p.layers.push(later);
  }
  if (special === 'mixed')
    for (const key of p.layers[0].keys)
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
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('movie-create-seed')) {
      sessionStorage.setItem('movie-create-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const open = async () => {
    const b = page.getByRole('button', { name: 'Create live tween…', exact: true });
    if (!(await b.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await b.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Create live tween', exact: true });
  await expect(d.getByLabel('Live tween motion mode')).toHaveValue('plain');
  await expect(d.getByRole('button', { name: 'Create live tween', exact: true })).toBeDisabled();
  await d.getByLabel('Live tween motion mode').selectOption('movies');
  await d.getByLabel('Live tween start frame').fill('3');
  await d.getByLabel('Live tween end frame').fill('11');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const commit = async () => {
    await d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    await expect(d).toBeHidden();
  };
  const undo = async (redo = false) => {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  };
  return { p, d, read, commit, undo, open, errors };
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
test('symbol instance playback rejects breaking a live movie endpoint clock', async ({ page }) => {
  const f = await setup(page);
  await f.commit();
  const before = await f.read();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.press('Home');
  await timeline.press('ArrowRight');
  await timeline.press('ArrowRight');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.press('Control+a');
  const panel = page.getByRole('region', { name: 'Symbol instance', exact: true });
  const type = panel.getByLabel('Symbol instance type');
  await expect(type).toHaveValue('movie');
  await type.selectOption('graphic');
  await expect(page.getByText(/identical authored movie offsets/)).toBeVisible();
  await expect(type).toHaveValue('movie');
  expect(await f.read()).toEqual(before);
  expect(f.errors).toEqual([]);
});
for (const mode of ['zero', 'one', 'clamped'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`explicit movie creation ${mode}/${basis} preserves clocks, stage pixels and one history step`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await f.commit();
      const out = await f.read(),
        span = out.layers[0].liveMotionSpans![0];
      expect(out).toEqual({
        ...f.p,
        layers: [
          {
            ...f.p.layers[0],
            liveMotionSpans: [
              { id: span.id, start: 2, end: 10, ease: 'linear', symbolContinuity: 'movies' },
            ],
          },
        ],
      });
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const clock = mode === 'zero' ? 0 : mode === 'clamped' ? 4 : 1,
        b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
        u = b[0] * (clock * 10 + 2) + b[2] * 2,
        v = b[1] * (clock * 10 + 2) + b[3] * 2;
      await expect
        .poll(() => pixel(page, f.p, 120 + (u - v) / Math.SQRT2, 70 + (u + v) / Math.SQRT2))
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
for (const special of [
  'clock',
  'graphic',
  'button',
  'nestedMovie',
  'nestedButton',
  'group',
  'identity',
  'locked',
  'hidden',
])
  test(`movie creation rejects forged ${special} selection without changing source`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special),
      row = f.d.getByLabel('Create live track Movie');
    await expect(
      f.d.getByRole('button', { name: 'Create live tween', exact: true }),
    ).toBeDisabled();
    if (!(await row.isChecked())) await expect(row).toBeDisabled();
    await row.evaluate((el) => {
      const e = el as HTMLInputElement;
      e.disabled = false;
      if (!e.checked) e.click();
    });
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).evaluate((el) => {
      const e = el as HTMLButtonElement;
      e.disabled = false;
      e.click();
    });
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('created movie tween keeps independently advancing native contents while root playback pauses', async ({
  page,
}) => {
  const f = await setup(page);
  await f.commit();
  const out = await f.read();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(dialog.getByLabel('Live movie status')).toContainText('Live movie ready');
  await dialog.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restart live movie', exact: true }).click();
  for (let tick = 1; tick <= 3; tick++) {
    if (tick === 3)
      await dialog.getByRole('button', { name: 'Pause live root', exact: true }).click();
    await dialog.getByRole('button', { name: 'Step live preview', exact: true }).click();
    await expect(dialog.getByLabel('Live movie position')).toContainText('Tick ' + tick);
    await expect(dialog.getByLabel('Live movie status')).toContainText('Live movie ready');
    const frame = tick === 3 ? 4 : 2 + tick,
      t = (frame - 2) / 8,
      r = (t * Math.PI) / 2,
      x = 80 + 80 * t + Math.cos(r) * (((1 + tick) % 5) * 10 + 2) - Math.sin(r) * 2,
      y = 50 + 40 * t + Math.sin(r) * (((1 + tick) % 5) * 10 + 2) + Math.cos(r) * 2;
    expect(
      await page
        .getByLabel('Live movie interaction', { exact: true })
        .evaluate(
          (e, { x, y }) =>
            Array.from(
              (e as HTMLCanvasElement)
                .getContext('2d')!
                .getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
            ),
          { x, y },
        ),
    ).toEqual([255, 0, 0, 255]);
  }
  await expect(dialog.getByLabel('Live movie position')).toContainText('Frame 5');
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(out);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  expect(await f.read()).toEqual(out);
  expect(f.errors).toEqual([]);
});

test('raw captured movie requests reject accessors without reading them and permit a fresh retry', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false, reads: 0 };
    Object.assign(window, { movieRaw: state });
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        v = out as { tracks?: string[]; symbolContinuity?: string };
      if (!state.hit && v?.symbolContinuity === 'movies' && Array.isArray(v.tracks)) {
        state.hit = true;
        Object.defineProperty(v, 'tracks', {
          enumerable: true,
          get() {
            state.reads++;
            return ['track'];
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { movieRaw: { hit: boolean; reads: number } }).movieRaw,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await f.commit();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
for (const special of ['two', 'laterBad'])
  test(`movie ${special} tracks prepare atomically with stable IDs and complete selection`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special);
    await f.d.getByLabel('Create live track Later').check();
    await page.evaluate(() => {
      const state = { ids: [] as string[] },
        clone = structuredClone;
      Object.assign(window, { movieIDs: state });
      window.structuredClone = <T>(v: T) => {
        const out = clone(v);
        if (Array.isArray(v) && v[0]?.span?.symbolContinuity === 'movies')
          state.ids.push(v[0].span.id);
        return out;
      };
    });
    if (special === 'laterBad') {
      await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
      await expect(f.d.getByRole('status')).toContainText('Error:');
      expect(await f.read()).toEqual(f.p);
      await f.d.getByLabel('Create live track Later').uncheck();
    }
    await f.commit();
    const out = await f.read();
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(out.symbols).toEqual(f.p.symbols);
    if (special === 'two')
      expect(out.layers[0].liveMotionSpans![0].id).not.toBe(out.layers[1].liveMotionSpans![0].id);
    else {
      expect(out.layers[1]).toEqual(f.p.layers[1]);
      const ids = await page.evaluate(
        () => (window as unknown as { movieIDs: { ids: string[] } }).movieIDs.ids,
      );
      expect(ids).toEqual([
        out.layers[0].liveMotionSpans![0].id,
        out.layers[0].liveMotionSpans![0].id,
      ]);
    }
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    await f.undo(true);
    expect(await f.read()).toEqual(out);
  });
for (const hook of ['clone', 'serialize'])
  for (const action of ['mode', 'target', 'source', 'close'])
    test(`movie ${hook} rejects actual late ${action} after complete marked candidates exist`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { movieCreateHook: state });
          const fire = (value: unknown) => {
            if (
              state.hit ||
              (value as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity !== 'movies'
            )
              return;
            state.hit = true;
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
            else if (action === 'mode') {
              const e = document.querySelector(
                '[aria-label="Live tween motion mode"]',
              ) as HTMLSelectElement;
              for (const v of ['plain', 'movies']) {
                e.value = v;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } else {
              const e = document.querySelector(
                '[aria-label="Live tween end frame"]',
              ) as HTMLInputElement;
              for (const v of ['10', '11']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
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
      await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { movieCreateHook: { hit: boolean } }).movieCreateHook.hit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Independent source edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Live tween motion mode').selectOption('movies');
      await f.commit();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('movie creation retains complete mixed artwork selection and exports the actual sparse frame', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'mixed');
  await f.d.getByLabel('Live tween motion mode').selectOption('groups');
  await f.d.getByLabel('Live group uniform scaling').check();
  await f.d.getByLabel('Live tween motion mode').selectOption('movies');
  await f.commit();
  const out = await f.read();
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  expect(out.layers[0].liveMotionSpans![0].rotation).toBeUndefined();
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(out.symbols).toEqual(f.p.symbols);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status')).toContainText('read-only');
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
      [120, 70 + Math.SQRT2 * 2],
      [204, 34],
    ].map(([a, b]) => Array.from(x.getImageData(Math.floor(a), Math.floor(b), 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(await f.read()).toEqual(out);
});

for (const action of ['mode', 'source', 'candidate', 'reentry'])
  test(`movie final recovery ${action} cannot bypass complete history staging`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { movieFinal: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          v = args[0] as { project?: Project; folder?: unknown };
        if (
          !state.hit &&
          Object.hasOwn(v ?? {}, 'folder') &&
          v?.project?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'movies'
        ) {
          state.hit = true;
          if (action === 'candidate') v.project.layers[0].keys[2].shapes[0].x++;
          else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final independent edit';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (action === 'mode') {
            const e = document.querySelector(
              '[aria-label="Live tween motion mode"]',
            ) as HTMLSelectElement;
            for (const value of ['plain', 'movies']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else
            Array.from(document.querySelectorAll('button'))
              .find((e) => e.textContent?.trim() === 'Create live tween')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { movieFinal: { hit: boolean } }).movieFinal.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      const out = await f.read();
      expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else {
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Final independent edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Live tween motion mode').selectOption('movies');
      await f.commit();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });
