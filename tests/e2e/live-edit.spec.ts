import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

async function recover(page: Page) {
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const button = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(button).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await button.click();
}

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
  const span = p.layers[0].liveMotionSpans![0];
  if (mode === 'paint') {
    p.layers[0].keys[0].shapes[0].fill = '#000000';
    p.layers[0].keys[1].shapes[0].fill = '#808080';
  }
  if (mode === 'disable') span.options = { paint: true };
  if (mode === 'removeOption') span.options = { paint: false, affine: false };
  if (mode === 'clear') span.options = { paint: false };
  if (mode === 'mixed') {
    span.options = { paint: false };
    p.layers[1].liveMotionSpans![0].options = { affine: false };
    p.layers[1].liveMotionSpans![0].ease = 'out';
  }
  if (mode === 'laterBad') p.layers[1].keys[1].shapes[0].width = 50;
  if (mode === 'advanced')
    Object.assign(span, {
      options: { paint: true, gradientGeometry: true, gradientStops: { pairs: 'auto' } },
      opacityEase: 'out',
      paintEase: 'linear',
      path: { startX: 0, startY: 0, endX: 0, endY: 0 },
      rotation: { direction: 'clockwise', turns: 0 },
    });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-edit-seed')) {
      sessionStorage.setItem('live-edit-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await recover(page);
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

async function easing(page: Page, value = 'in') {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByLabel('Change live tween easing', { exact: true }).check();
  await d.getByLabel('Edited live tween easing', { exact: true }).selectOption(value);
}

test('edited live timing follows later authored endpoint edits without Refresh or baking', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await easing(page);
  await apply(page);
  const edited = await f.read();
  await page.getByLabel('Shape X', { exact: true }).fill('28');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  const expected = structuredClone(edited);
  expected.layers[0].keys[0].shapes[0].x = 28;
  expect(await f.read()).toEqual(expected);
  await go(page, 4);
  await expect.poll(() => pixel(page, f.p, 48, 18)).toEqual([255, 0, 0, 255]);
  await go(page, 0);
  await undo(page);
  expect(await f.read()).toEqual(edited);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('cloned request getter rejects without reads and a fresh edit recovers', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await easing(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { getterHit: boolean; getterReads: number };
    w.getterHit = false;
    w.getterReads = 0;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (!w.getterHit && Array.isArray(out) && out[0]?.changes) {
        w.getterHit = true;
        Object.defineProperty(out[0].changes, 'ease', {
          enumerable: true,
          get() {
            w.getterReads++;
            return 'in';
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
      const w = window as unknown as { getterHit: boolean; getterReads: number };
      return [w.getterHit, w.getterReads];
    }),
  ).toEqual([true, 0]);
  expect(await f.read()).toEqual(f.p);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('pending Brush cannot enter live editing and completed paint keeps separate history', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, 'merge');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const b = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  await page.mouse.move(b.x + 250, b.y + 250);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit live tween…', exact: true })).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect(page.getByRole('button', { name: 'Edit live tween…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await easing(page);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
async function option(page: Page, name: string, value: string) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  if (!(await d.getByLabel(`Edit live option ${name}`, { exact: true }).isVisible()))
    await d.getByText('Interpolation option changes', { exact: true }).click();
  await d.getByLabel(`Edit live option ${name}`, { exact: true }).selectOption(value);
}
for (const mode of [
  'in',
  'out',
  'in-out',
  'custom',
  'multiple',
  'mixed',
  'remaining',
  'paint',
  'bad',
  'disable',
  'removeOption',
  'clear',
  'advanced',
  'inactive',
])
  test(`edit live ${mode} preserves exact settings, authored selection and one history transaction`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    if (mode === 'in') await page.setViewportSize({ width: 960, height: 620 });
    await f.open();
    const applyButton = f.d.getByRole('button', { name: 'Apply live tween changes', exact: true });
    if (mode === 'in') {
      const recipe = f.d.getByLabel('Edit live tween Main frames 1–9', { exact: true });
      await expect(recipe).toBeFocused();
      await expect(recipe).toBeInViewport();
    }
    const expected = structuredClone(f.p),
      primary = mode === 'inactive' ? 1 : 0;
    const span = expected.layers[primary].liveMotionSpans![0];
    if (mode === 'paint' || mode === 'bad') {
      const name = mode === 'paint' ? 'paint' : 'primitives';
      await option(page, name, 'enable');
      span.options = { [name]: true };
    } else if (mode === 'disable' || mode === 'removeOption') {
      await option(page, 'paint', mode === 'disable' ? 'disable' : 'remove');
      if (mode === 'disable') span.options = { paint: false };
      else delete span.options!.paint;
    } else if (mode === 'clear') {
      await f.d.getByText('Interpolation option changes', { exact: true }).click();
      await f.d.getByLabel('Remove all live tween options', { exact: true }).check();
      delete span.options;
    } else {
      const value = ['out', 'in-out', 'custom'].includes(mode) ? mode : 'in';
      if (mode === 'in') {
        await f.d.getByLabel('Change live tween easing', { exact: true }).press('Space');
        const ease = f.d.getByLabel('Edited live tween easing', { exact: true });
        await ease.press('ArrowDown');
        await expect(ease).toHaveValue('in');
      } else await easing(page, value);
      if (mode === 'custom') {
        for (const [key, value] of Object.entries({ X1: '0', Y1: '0', X2: '1', Y2: '0' }))
          await f.d.getByLabel('Edited live tween easing ' + key, { exact: true }).fill(value);
        span.ease = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 };
      } else span.ease = value as 'in' | 'out' | 'in-out';
      if (mode === 'mixed') {
        await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
        expected.layers[1].liveMotionSpans![0].ease = 'in';
      }
    }
    if (mode === 'in') {
      await applyButton.focus();
      const close = f.d.getByRole('button', { name: 'Close dialog', exact: true });
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(applyButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(f.d).toHaveCount(0);
      await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
    } else await apply(page);
    expect(await f.read()).toEqual(expected);
    if (mode === 'multiple')
      await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
    else await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
    if (mode === 'in') await page.keyboard.press('Control+z');
    else await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (mode === 'in') await page.keyboard.press('Control+Shift+z');
    else await undo(page, true);
    expect(await f.read()).toEqual(expected);
    if (mode === 'in') {
      await page.setViewportSize({ width: 1500, height: 1100 });
      await page.reload();
      await recover(page);
    }
    if (['in', 'out', 'in-out', 'custom', 'paint', 'bad'].includes(mode)) {
      await go(page, 4);
      const x = mode === 'in' ? 33 : mode === 'out' ? 73 : mode === 'custom' ? 23 : 53;
      await expect
        .poll(() => pixel(page, f.p, x, 18))
        .toEqual(mode === 'paint' ? [64, 64, 64, 255] : [255, 0, 0, 255]);
    }
    if (mode !== 'in') {
      await page.reload();
      await recover(page);
    }
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

test('unchanged or empty choices cannot add an edit history item', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  const button = f.d.getByRole('button', { name: 'Apply live tween changes', exact: true });
  await expect(button).toBeDisabled();
  await easing(page, 'linear');
  await button.click();
  await expect(f.d.getByRole('status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await f.d
    .getByRole('checkbox', { name: 'Edit live tween Main frames 1–9', exact: true })
    .uncheck();
  await expect(button).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(f.d).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('removing an already absent option does not materialize empty metadata or history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await option(page, 'paint', 'remove');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await easing(page);
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].ease = 'in';
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('later incompatible selected recipe rejects every edit and fresh single-track retry succeeds', async ({
  page,
}) => {
  const f = await setup(page, 'laterBad');
  await f.open();
  await easing(page);
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).uncheck();
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].ease = 'in';
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('required channel dependencies reject without clearing advanced settings', async ({
  page,
}) => {
  const f = await setup(page, 'advanced');
  await f.open();
  await option(page, 'paint', 'disable');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await option(page, 'paint', 'keep');
  await easing(page);
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].ease = 'in';
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('NaN custom controls reject before normalization and fresh correction recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await easing(page, 'custom');
  await f.d.getByLabel('Edited live tween easing X1', { exact: true }).fill('');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('finite');
  expect(await f.read()).toEqual(f.p);
  await easing(page);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['mixed', 'advanced'])
  test(`option patch preserves untouched ${mode} settings including object-valued stop matching`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.open();
    await option(page, 'strokeWidth', 'enable');
    if (mode === 'mixed')
      await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
    await apply(page);
    const expected = structuredClone(f.p);
    for (const layer of expected.layers)
      if (layer.liveMotionSpans?.length)
        layer.liveMotionSpans[0].options = {
          ...layer.liveMotionSpans[0].options,
          strokeWidth: true,
        };
    expect(await f.read()).toEqual(expected);
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const hook of ['clone', 'serialize'])
  for (const action of [
    'tracks',
    'ease',
    'options',
    'source',
    'editorFrame',
    'tool',
    'mode',
    'close',
  ])
    test(`live editing ${hook} rejects actual late ${action} and keeps independent history`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.open();
      await easing(page);
      if (action === 'options')
        await f.d.getByText('Interpolation option changes', { exact: true }).click();
      if (action === 'mode') {
        await page
          .getByRole('button', { name: 'Control', exact: true })
          .evaluate((el) => (el as HTMLButtonElement).click());
        await expect(
          page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }),
        ).toBeAttached();
      }
      await page.evaluate(
        ({ hook, action }) => {
          const w = window as unknown as { liveEditHookHit: boolean };
          w.liveEditHookHit = false;
          const fire = (value: unknown) => {
            const p = value as Project;
            if (
              w.liveEditHookHit ||
              !p?.layers?.[0]?.keys ||
              p.layers[0].liveMotionSpans?.[0]?.ease !== 'in'
            )
              return;
            w.liveEditHookHit = true;
            if (action === 'tracks') {
              const e = document.querySelector(
                '[aria-label="Edit live tween Main frames 1–9"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            }
            if (action === 'ease' || action === 'options') {
              const e = document.querySelector(
                action === 'ease'
                  ? '[aria-label="Edited live tween easing"]'
                  : '[aria-label="Edit live option paint"]',
              ) as HTMLSelectElement;
              for (const value of action === 'ease' ? ['out', 'in'] : ['enable', 'keep']) {
                e.value = value;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Separate source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'editorFrame')
              for (const title of ['Last frame', 'First frame'])
                (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
            if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
            if (action === 'mode')
              for (let i = 0; i < 2; i++) {
                const e = [...document.querySelectorAll('button')].find(
                  (e) =>
                    e.textContent === 'Show sampled motion on stage' ||
                    e.textContent === 'Return to authored stage',
                );
                if (!e) throw Error('Missing actual sampled mode control');
                e.click();
              }
            if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
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
          () => (window as unknown as { liveEditHookHit: boolean }).liveEditHookHit,
        ),
      ).toBe(true);
      const out = await f.read();
      expect(out.layers[0].liveMotionSpans).toEqual(f.p.layers[0].liveMotionSpans);
      expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
      if (action === 'source') {
        expect(out.layers[0].name).toBe('Separate source edit');
        await expect(f.d).toBeHidden();
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      } else {
        expect(out).toEqual(f.p);
        if (await f.d.isVisible()) await page.keyboard.press('Escape');
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      }
      // Original-value restoration never revives a stale request; a new command does.
      await f.open();
      await easing(page);
      await apply(page);
      expect((await f.read()).layers[0].liveMotionSpans![0].ease).toBe('in');
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
    await easing(page);
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
              candidate.layers[0].liveMotionSpans?.[0]?.ease === 'in' &&
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
    if (action === 'reentry') expected.layers[0].liveMotionSpans![0].ease = 'in';
    expect(await f.read()).toEqual(expected);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (action !== 'reentry') {
      await f.open();
      await easing(page);
      await apply(page);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });
