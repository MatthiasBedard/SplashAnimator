import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';
import { readFile } from 'node:fs/promises';

async function setup(page: Page, mode = 'plain') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const p = mode === 'movie' ? livePresentationFixture('movie') : liveSplitFixture();
  p.layers[0].name = 'Main';
  if (mode === 'merge') p.layers[0].drawingMode = 'merge';
  p.fps = 1;
  if (mode === 'bad') p.layers[0].keys[1].shapes[0].width = 50;
  if (mode === 'multiple')
    for (const k of p.layers[0].keys.slice(0, 2))
      k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'second', y: 55 });
  if (mode === 'remaining') {
    p.duration = 20;
    p.layers[0].keys[2] = {
      frame: 16,
      shapes: [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 120 }],
    };
    p.layers[0].keys.push({ frame: 18, shapes: [] });
    p.layers[0].liveMotionSpans!.push({ id: 'next', start: 8, end: 16, ease: 'in-out' });
  }
  if (['two', 'mixed', 'inactive', 'locked', 'hidden', 'laterBad'].includes(mode)) {
    p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
    if (mode === 'inactive') p.layers[0].locked = true;
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
  }
  for (const layer of p.layers.filter((l) => l.liveMotionSpans?.length)) {
    const span = layer.liveMotionSpans![0];
    Object.assign(span, {
      ease: 'in',
      options: { paint: true },
      opacityEase: 'linear',
      paintEase: 'linear',
    });
    for (const [i, k] of layer.keys.filter((k) => k.shapes.length).entries())
      Object.assign(k.shapes[0], { opacity: i ? 1 : 0.2, fill: i ? '#808080' : '#000000' });
  }
  const span = p.layers[0].liveMotionSpans![0];
  if (mode === 'absent') {
    delete span.opacityEase;
    delete span.paintEase;
  }
  if (mode === 'noPaint') {
    delete span.paintEase;
    delete span.options;
    p.layers[0].keys[1].shapes[0].fill = '#000000';
  }
  if (mode === 'disable') p.layers[0].keys[1].shapes[0].fill = '#000000';
  if (mode === 'mixed') {
    p.layers[1].liveMotionSpans![0].opacityEase = 'out';
    p.layers[1].liveMotionSpans![0].paintEase = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 };
  }
  if (mode === 'laterBad') p.layers[1].keys[1].shapes[0].width = 50;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-channel-ui-seed')) {
      sessionStorage.setItem('live-channel-ui-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const open = async () => {
    const cmd = page.getByRole('button', { name: 'Edit live tween…', exact: true });
    if (!(await cmd.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await cmd.click();
    await expect(page.getByRole('dialog', { name: 'Edit live tween', exact: true })).toBeVisible();
  };
  return {
    p,
    errors,
    open,
    d: page.getByRole('dialog', { name: 'Edit live tween', exact: true }),
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function apply(page: Page) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(d).toBeHidden();
}
async function undo(page: Page, redo = false) {
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}
async function go(page: Page, n: number) {
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return [
        ...c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * devicePixelRatio,
            c.height / 2 + (y - p.height / 2) * devicePixelRatio,
            1,
            1,
          ).data,
      ];
    },
    { p, x, y },
  );
}

async function channel(page: Page, name: 'opacity' | 'paint', mode = 'set', value = 'out') {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByLabel(`Live ${name} easing mode`, { exact: true }).selectOption(mode);
  if (mode === 'set') {
    await d.getByLabel(`Live ${name} easing`, { exact: true }).selectOption(value);
    if (value === 'custom')
      for (const [key, value] of Object.entries({ X1: '0', Y1: '0', X2: '1', Y2: '0' }))
        await d.getByLabel(`Live ${name} easing ${key}`, { exact: true }).fill(value);
  }
}
async function option(page: Page, name: string, value: string) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  if (!(await d.getByLabel(`Edit live option ${name}`, { exact: true }).isVisible()))
    await d.getByText('Interpolation option changes', { exact: true }).click();
  await d.getByLabel(`Edit live option ${name}`, { exact: true }).selectOption(value);
}
const custom = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 } as const;
for (const mode of ['opacity', 'paint', 'both', 'inherit', 'mixed', 'disable'])
  test(`main independent ${mode} timing retains exact metadata, selection, Undo/Redo and pixels`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.open();
    const expected = structuredClone(f.p),
      span = expected.layers[0].liveMotionSpans![0];
    await expect(f.d.getByLabel('Live opacity easing mode', { exact: true })).toHaveValue('keep');
    await expect(f.d.getByLabel('Live paint easing mode', { exact: true })).toHaveValue('keep');
    await expect(f.d.getByText(/Opacity: linear. Paint: linear/)).toBeVisible();
    if (mode === 'opacity' || mode === 'both' || mode === 'mixed') {
      await channel(page, 'opacity');
      span.opacityEase = 'out';
    }
    if (mode === 'paint' || mode === 'both') {
      await channel(page, 'paint', 'set', 'custom');
      span.paintEase = { ...custom };
    }
    if (mode === 'inherit') {
      await channel(page, 'opacity', 'inherit');
      await channel(page, 'paint', 'inherit');
      delete span.opacityEase;
      delete span.paintEase;
    }
    if (mode === 'mixed') {
      await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
      expected.layers[1].liveMotionSpans![0].opacityEase = 'out';
    }
    if (mode === 'disable') {
      await channel(page, 'paint', 'inherit');
      await option(page, 'paint', 'disable');
      delete span.paintEase;
      span.options = { paint: false };
    }
    await apply(page);
    expect(await f.read()).toEqual(expected);
    await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    await undo(page, true);
    expect(await f.read()).toEqual(expected);
    if (['opacity', 'paint', 'both', 'inherit'].includes(mode)) {
      await go(page, 4);
      const value = mode === 'opacity' ? 102 : mode === 'paint' ? 112 : mode === 'both' ? 64 : 166;
      await expect
        .poll(async () => {
          const color = await pixel(page, f.p, 33, 18);
          return color.every((c, i) => Math.abs(c - (i === 3 ? 255 : value)) <= 1);
        })
        .toBe(true);
      expect(await pixel(page, f.p, 53, 18)).toEqual([255, 255, 255, 255]);
    }
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

test('paint channel never enables interpolation implicitly and a fresh explicit option correction succeeds', async ({
  page,
}) => {
  const f = await setup(page, 'noPaint');
  await f.open();
  await channel(page, 'paint');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('explicit paint');
  expect(await f.read()).toEqual(f.p);
  await option(page, 'paint', 'enable');
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].options = { paint: true };
  expected.layers[0].liveMotionSpans![0].paintEase = 'out';
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('inherit on absent channels is a no-op and Keep preserves mixed channels during a geometry change', async ({
  page,
}) => {
  const f = await setup(page, 'absent');
  await f.open();
  await channel(page, 'opacity', 'inherit');
  await channel(page, 'paint', 'inherit');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Change live tween easing', { exact: true }).check();
  await f.d.getByLabel('Edited live tween easing', { exact: true }).selectOption('out');
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].ease = 'out';
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('later incompatible track cannot publish any independent channel and a single-track retry recovers', async ({
  page,
}) => {
  const f = await setup(page, 'laterBad');
  await f.open();
  await channel(page, 'opacity');
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).uncheck();
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].opacityEase = 'out';
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});

for (const name of ['opacity', 'paint'] as const)
  test(`raw ${name} custom controls reject NaN without history and permit correction`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.open();
    await channel(page, name, 'set', 'custom');
    await f.d.getByLabel(`Live ${name} easing X1`, { exact: true }).fill('');
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await channel(page, name);
    await apply(page);
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('independent UI channels drive actual PNG/movie output and later endpoint edits without Refresh', async ({
  page,
}) => {
  const f = await setup(page, 'movie');
  await f.open();
  await channel(page, 'opacity');
  await channel(page, 'paint', 'set', 'custom');
  await apply(page);
  const edited = await f.read(),
    endpoint = structuredClone(edited);
  endpoint.layers[0].keys[0].shapes[0].x = 20;
  // Edit the still-selected authored endpoint before timeline navigation clears selection.
  await page.getByLabel('Shape X', { exact: true }).fill('20');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  expect(await f.read()).toEqual(endpoint);
  await go(page, 2);
  await expect
    .poll(async () => {
      const c = await pixel(page, f.p, 40, 5);
      return c.slice(0, 3).every((v) => Math.abs(v - 64) <= 1);
    })
    .toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  const pixels = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(
        await (await fetch('data:image/png;base64,' + base64)).blob(),
      ),
      c = document.createElement('canvas');
    c.width = 160;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.drawImage(bitmap, 0, 0);
    bitmap.close();
    return [
      [40, 5],
      [65, 45],
    ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
  }, bytes.toString('base64'));
  for (const v of pixels[0].slice(0, 3)) expect(Math.abs(v - 64)).toBeLessThanOrEqual(1);
  expect(pixels[1]).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(endpoint);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const movie = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(movie.getByLabel('Live movie status')).toContainText('Live movie ready');
  const moviePixel = await movie
    .getByLabel('Live movie interaction')
    .evaluate((el) => [
      ...(el as HTMLCanvasElement).getContext('2d')!.getImageData(40, 5, 1, 1).data,
    ]);
  for (const v of moviePixel.slice(0, 3)) expect(Math.abs(v - 64)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(endpoint);
  await go(page, 0);
  await undo(page);
  expect(await f.read()).toEqual(edited);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('cloned independent channel getters reject with zero reads and allow fresh retry', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await channel(page, 'opacity');
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { channelGetterHit: boolean; channelGetterReads: number };
    w.channelGetterHit = false;
    w.channelGetterReads = 0;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (!w.channelGetterHit && Array.isArray(out) && out[0]?.changes) {
        w.channelGetterHit = true;
        Object.defineProperty(out[0].changes, 'opacityEase', {
          enumerable: true,
          get() {
            w.channelGetterReads++;
            return 'out';
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { channelGetterHit: boolean; channelGetterReads: number };
      return [w.channelGetterHit, w.channelGetterReads];
    }),
  ).toEqual([true, 0]);
  expect(await f.read()).toEqual(f.p);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('forged unknown channel mode cannot clear or set original timing', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.d.getByLabel('Live opacity easing mode', { exact: true }).evaluate((el) => {
    const forged = document.createElement('option');
    forged.value = 'forged';
    forged.textContent = 'Forged mode';
    el.append(forged);
    (el as HTMLSelectElement).value = 'forged';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('explicit independent channel mode');
  expect(await f.read()).toEqual(f.p);
  await channel(page, 'opacity');
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Keep retains distinct mixed channel timings while changing geometry ease on both records', async ({
  page,
}) => {
  const f = await setup(page, 'mixed');
  await f.open();
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await f.d.getByLabel('Change live tween easing', { exact: true }).check();
  await f.d.getByLabel('Edited live tween easing', { exact: true }).selectOption('out');
  await apply(page);
  const expected = structuredClone(f.p);
  for (const l of expected.layers) l.liveMotionSpans![0].ease = 'out';
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const hook of ['clone', 'serialize'])
  for (const action of ['opacityMode', 'paintMode', 'opacityCurve', 'paintCurve', 'source'])
    test(`independent ${hook} rejects actual changed-and-restored ${action} without stale publication`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.open();
      await channel(page, 'opacity', 'set', 'custom');
      await channel(page, 'paint', 'set', 'custom');
      await page.evaluate(
        ({ hook, action }) => {
          const w = window as unknown as { channelHookHit: boolean };
          w.channelHookHit = false;
          const fire = (value: unknown) => {
            const p = value as Project;
            if (
              w.channelHookHit ||
              !p?.layers?.[0]?.keys ||
              p.layers[0].liveMotionSpans?.[0]?.opacityEase === 'linear'
            )
              return;
            w.channelHookHit = true;
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Separate channel source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action.endsWith('Mode')) {
              const name = action === 'opacityMode' ? 'opacity' : 'paint',
                e = document.querySelector(
                  `[aria-label="Live ${name} easing mode"]`,
                ) as HTMLSelectElement;
              for (const value of ['keep', 'set']) {
                e.value = value;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } else {
              const name = action === 'opacityCurve' ? 'opacity' : 'paint',
                e = document.querySelector(
                  `[aria-label="Live ${name} easing X1"]`,
                ) as HTMLInputElement;
              for (const value of ['0.1', '0']) {
                e.value = value;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(value: T) => {
              const out = clone(value);
              fire(value);
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
          () => (window as unknown as { channelHookHit: boolean }).channelHookHit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Separate channel source edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      await f.open();
      await channel(page, 'opacity');
      await apply(page);
      const edited = structuredClone(f.p);
      edited.layers[0].liveMotionSpans![0].opacityEase = 'out';
      expect(await f.read()).toEqual(edited);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

for (const action of ['source', 'candidate', 'reentry'])
  test(`final history preparation ${action} cannot publish stale data or duplicate history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.open();
    await channel(page, 'opacity');
    await page.evaluate((action) => {
      const clone = structuredClone,
        stringify = JSON.stringify,
        w = window as unknown as { finalHit: boolean };
      w.finalHit = false;
      let candidate: Project | undefined;
      if (action === 'source')
        JSON.stringify = ((...args: Parameters<typeof stringify>) => {
          const out = stringify(...args),
            p = args[0] as Project;
          if (
            !w.finalHit &&
            p?.layers?.[0]?.id === 'track' &&
            new Error().stack?.includes('prepareRecord')
          ) {
            w.finalHit = true;
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate history edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return out;
        }) as typeof stringify;
      else
        window.structuredClone = <T>(value: T) => {
          const out = clone(value),
            p = out as unknown as Project;
          if (p?.layers?.[0]?.id === 'track') {
            if (
              candidate &&
              candidate.layers[0].liveMotionSpans?.[0]?.opacityEase === 'out' &&
              !w.finalHit
            ) {
              w.finalHit = true;
              if (action === 'candidate') candidate.layers[0].keys[0].shapes[0].x += 100;
              else {
                const el = [...document.querySelectorAll('button')].find(
                  (e) => e.textContent === 'Apply live tween changes',
                )!;
                el.disabled = false;
                el.click();
              }
            } else if (!candidate) candidate = p;
          }
          return out;
        };
    }, action);
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { finalHit: boolean }).finalHit)).toBe(
      true,
    );
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate history edit';
    if (action === 'reentry') expected.layers[0].liveMotionSpans![0].opacityEase = 'out';
    expect(await f.read()).toEqual(expected);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (action !== 'reentry') {
      await f.open();
      await channel(page, 'opacity');
      await apply(page);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });
