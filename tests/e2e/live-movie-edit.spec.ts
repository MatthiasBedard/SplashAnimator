import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { liveMovieFixture, createLiveMovies } from '../live-movies-fixture';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, mode = 'one', basis = 'plain', special = '') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const { p, span } = liveMovieFixture(mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1, basis);
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Movie';
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.x += 60;
      s.y += 20;
    }
  const out = createLiveMovies(p, span);
  if (special === 'geometry') out.layers[0].keys[2].shapes[0].width++;
  if (special === 'button') out.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
  if (special === 'nestedMovie' || special === 'nestedButton') {
    const leaf = { ...structuredClone(out.symbols![0]), id: 'leaf' };
    out.symbols!.push(leaf);
    out.symbols![0].shapes = [
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
  if (special === 'locked') out.layers[0].locked = true;
  if (special === 'hidden') out.layers[0].visible = false;
  if (['two', 'laterBad', 'plain', 'group', 'graphic'].includes(special)) {
    const later = structuredClone(out.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad') later.keys[2].shapes[0].width++;
    if (special === 'graphic') {
      later.liveMotionSpans![0].symbolContinuity = 'graphics';
      later.keys[1].shapes[0].symbolPlayback = { mode: 'loop', firstFrame: 1 };
      later.keys[2].shapes[0].symbolPlayback = { mode: 'loop', firstFrame: 4 };
    }
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
    if (!sessionStorage.getItem('movie-edit-seed')) {
      sessionStorage.setItem('movie-edit-seed', 'yes');
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
    row = d.getByLabel('Edit live tween Movie frames 3–11', { exact: true });
  await expect(d.getByLabel('Include movie live tweens')).not.toBeChecked();
  await expect(row).toBeDisabled();
  await d.getByLabel('Include movie live tweens').check();
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
test('edit a movie placement interval and recover a split with the original child clock', async ({page})=>{
  const f = await setup(page);
  const panel = f.d.locator('details').filter({has:page.getByText('X position keys',{exact:true})});
  await panel.locator('summary').click();
  await panel.getByLabel('X key action').selectOption('set');
  await panel.getByLabel('X key frame',{exact:true}).fill('7');
  await panel.getByLabel('X coordinate',{exact:true}).fill('144');
  await f.apply();
  await f.open();
  await f.d.getByLabel('Include movie live tweens').check();
  await f.row.check();
  await panel.locator('summary').click();
  await panel.getByLabel('X interval ending at').selectOption('4');
  await panel.getByLabel('X interval easing',{exact:true}).selectOption('in');
  await f.apply();
  const keyed = await f.read();
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Insert live movie tween key…',exact:true}).click();
  await page.getByLabel('Live movie split frame',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Insert preserved live movie key',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const split = await f.read(), placement = split.layers[0].keys.find(k=>k.frame===4)!.shapes[0];
  expect([placement.x, placement.symbolPlayback]).toEqual([96,{mode:'movie',firstFrame:1}]);
  expect(split.symbols).toEqual(f.p.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(keyed);
  await f.undo(true); await expect.poll(f.read).toEqual(split);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  expect(await f.read()).toEqual(split);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Insert live movie tween key…',exact:true}).click();
  await page.getByLabel('Live movie split frame',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Preview preserved live movie key',exact:true}).click();
  const preview = page.getByRole('img',{name:'Preserved live movie split preview'});
  // Four playback ticks after entry, the five-frame clip wraps to its first red rectangle.
  await expect.poll(()=>preview.evaluate(async el=>{
    const img=el as HTMLImageElement;
    await img.decode();
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!;
    ctx.drawImage(img,0,0);
    return Array.from(ctx.getImageData(144,72,1,1).data);
  })).toEqual([255,0,0,255]);
  expect(f.errors).toEqual([]);
});

for (const mode of ['zero', 'one', 'clamped'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`movie edit ${mode}/${basis} changes geometry timing without changing playback age`, async ({
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
      const clock = mode === 'zero' ? 0 : mode === 'clamped' ? 4 : 1,
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
for (const special of ['geometry', 'button', 'nestedMovie', 'nestedButton', 'locked', 'hidden'])
  test(`movie editing retains ${special} rejection and source recovery`, async ({ page }) => {
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
for (const special of ['two', 'laterBad', 'plain', 'group', 'graphic'])
  test(`movie editing ${special} scopes stays atomic and preserves every marker/header`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special);
    if (special === 'group') await f.d.getByLabel('Include complete group live tweens').check();
    if (special === 'graphic') {
      await expect(
        f.d.getByLabel('Edit live tween Later frames 3–11', { exact: true }),
      ).toBeDisabled();
      await f.d.getByLabel('Include graphic live tweens').check();
    }
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
test('movie editing preserves complete selection and actual exported playback pixels', async ({
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
    test(`movie edit ${hook} rejects actual restored ${action} with fresh retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.timing();
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { movieEditHook: state });
          const fire = (value: unknown) => {
            const p = value as Project;
            if (
              state.hit ||
              p?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity !== 'movies' ||
              p.layers[0].liveMotionSpans[0].ease !== 'in'
            )
              return;
            state.hit = true;
            if (action === 'scope') {
              const e = document.querySelector(
                '[aria-label="Include movie live tweens"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent movie edit';
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
          () => (window as unknown as { movieEditHook: { hit: boolean } }).movieEditHook.hit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Independent movie edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Include movie live tweens').check();
      await f.row.check();
      await f.timing();
      await f.apply();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const action of ['remove', 'replace'])
  test(`movie explicit trajectory ${action} preserves clock metadata and history`, async ({
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
    expect(out.layers[0].liveMotionSpans![0].symbolContinuity).toBe('movies');
    expect(out.layers[0].liveMotionSpans![0].path).toEqual(
      action === 'remove' ? undefined : { startX: 10, startY: 5, endX: 20, endY: 5 },
    );
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const action of ['scope', 'candidate', 'source', 'reentry'])
  test(`movie edit final recovery ${action} respects complete history admission`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.timing();
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { movieEditFinal: state });
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
              '[aria-label="Include movie live tweens"]',
            ) as HTMLInputElement;
            e.click();
            e.click();
          } else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final movie source';
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
        () => (window as unknown as { movieEditFinal: { hit: boolean } }).movieEditFinal.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else {
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Final movie source';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Include movie live tweens').check();
      await f.row.check();
      await f.timing();
      await f.apply();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('movie independent opacity and mixed paint timing do not change movie clocks or geometry ease', async ({
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
        100 + 12 * Math.cos(a) - 2 * Math.sin(a),
        60 + 12 * Math.sin(a) + 2 * Math.cos(a),
      ),
    )
    .toEqual([255, 89, 89, 255]);
  await expect.poll(() => pixel(page, f.p, 204, 34)).toEqual([191, 0, 64, 255]);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('movie scope inclusion and Keep settings cannot add no-op history or bypass opt-out', async ({
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
  await f.d.getByLabel('Include movie live tweens').uncheck();
  await f.d.getByLabel('Include graphic live tweens').check();
  await f.d.getByLabel('Include complete group live tweens').check();
  await expect(f.row).toBeDisabled();
  await f.row.evaluate((el) => {
    const e = el as HTMLInputElement;
    e.disabled = false;
    if (!e.checked) e.click();
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Include movie live tweens').check();
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('group-only header editing cannot silently discard a selected movie record', async ({
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

test('movie Keep preserves saved false options, paths, channels and headers exactly', async ({
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
test('movie parent validation serialization cannot establish a changed candidate baseline', async ({
  page,
}) => {
  const f = await setup(page);
  await f.timing();
  await page.evaluate(() => {
    const stringify = JSON.stringify,
      state = { hit: false, count: 0 };
    Object.assign(window, { movieParentValidation: state });
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const text = stringify(...args),
        q = args[0] as Project;
      if (
        q?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'movies' &&
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
        (window as unknown as { movieParentValidation: { hit: boolean } }).movieParentValidation
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

test('edited movie geometry timing stays separate from actual paused-root Test Movie time', async ({
  page,
}) => {
  const f = await setup(page);
  await f.timing();
  await f.apply();
  const out = await f.read();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await d.getByRole('button', { name: 'Restart live movie', exact: true }).click();
  for (let tick = 1; tick <= 3; tick++) {
    if (tick === 3) await d.getByRole('button', { name: 'Pause live root', exact: true }).click();
    await d.getByRole('button', { name: 'Step live preview', exact: true }).click();
    await expect(d.getByLabel('Live movie position')).toContainText('Tick ' + tick);
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
    const frame = tick === 3 ? 4 : 2 + tick,
      t = ((frame - 2) / 8) ** 2,
      r = (t * Math.PI) / 2,
      local = ((1 + tick) % 5) * 10 + 2,
      x = 80 + 80 * t + Math.cos(r) * local - Math.sin(r) * 2,
      y = 50 + 40 * t + Math.sin(r) * local + Math.cos(r) * 2;
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
  await expect(d.getByLabel('Live movie position')).toContainText('Frame 5');
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(out);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  expect(await f.read()).toEqual(out);
});

test('raw movie update request getters reject without reads and a fresh same-dialog retry succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await f.timing();
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false, reads: 0 };
    Object.assign(window, { movieEditRaw: state });
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (
        !state.hit &&
        Array.isArray(out) &&
        out[0]?.spanId === 'live' &&
        out[0]?.changes?.ease === 'in'
      ) {
        state.hit = true;
        Object.defineProperty(out[0], 'changes', {
          enumerable: true,
          get() {
            state.reads++;
            return { ease: 'in' };
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { movieEditRaw: { hit: boolean; reads: number } }).movieEditRaw,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
