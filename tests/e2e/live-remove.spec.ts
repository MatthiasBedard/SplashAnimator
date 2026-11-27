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
  if (['two', 'inactive', 'locked', 'hidden'].includes(mode)) {
    p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
    if (mode === 'inactive') p.layers[0].locked = true;
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-remove-seed')) {
      sessionStorage.setItem('live-remove-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await recover(page);
  const open = async () => {
    const cmd = page.getByRole('button', { name: 'Remove live tween…', exact: true });
    if (!(await cmd.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await cmd.click();
    await expect(
      page.getByRole('dialog', { name: 'Remove live tween', exact: true }),
    ).toBeVisible();
  };
  return {
    p,
    errors,
    open,
    d: page.getByRole('dialog', { name: 'Remove live tween', exact: true }),
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function remove(page: Page) {
  const d = page.getByRole('dialog', { name: 'Remove live tween', exact: true });
  await d.getByRole('button', { name: 'Remove live tween', exact: true }).click();
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
for (const mode of [
  'plain',
  'multiple',
  'two',
  'remaining',
  'bad',
  'inactive',
  'locked',
  'hidden',
  'movie',
])
  test(`remove live ${mode} preserves exact authored data and one Undo/Redo transaction`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.open();
    if (mode === 'two')
      await f.d.getByLabel('Remove live tween Later frames 1–9', { exact: true }).check();
    if (mode === 'locked' || mode === 'hidden')
      await expect(
        f.d.getByLabel('Remove live tween Later frames 1–9', { exact: true }),
      ).toBeDisabled();
    await remove(page);
    const out = await f.read(),
      expected = structuredClone(f.p);
    const layers = mode === 'two' ? [0, 1] : mode === 'inactive' ? [1] : [0];
    for (const i of layers) {
      if (mode === 'remaining')
        expected.layers[i].liveMotionSpans = expected.layers[i].liveMotionSpans!.slice(1);
      else delete expected.layers[i].liveMotionSpans;
    }
    expect(out).toEqual(expected);
    if (mode === 'multiple')
      await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
    else
      await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue(
        String(expected.layers[layers[0]].keys[0].shapes[0].x),
      );
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    await undo(page, true);
    expect(await f.read()).toEqual(out);
    if (['plain', 'bad', 'remaining', 'multiple'].includes(mode)) {
      await go(page, 2);
      await expect.poll(() => pixel(page, f.p, 12, 18)).toEqual([255, 0, 0, 255]);
      // This is the old interpolated pose, now absent. The original held artwork is visible.
      expect(await pixel(page, f.p, 40, 18)).not.toEqual([255, 0, 0, 255]);
    }
    await page.reload();
    await recover(page);
    expect(await f.read()).toEqual(out);
    expect(f.errors).toEqual([]);
  });

test('keyboard removal wraps focus and preserves exact artwork with immediate Undo and Redo', async ({ page }) => {
  const f = await setup(page, 'inactive');
  const control = page.getByRole('button', { name: 'Control', exact: true });
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await f.open();
  const choice = f.d.getByRole('checkbox', { name: 'Remove live tween Later frames 1–9', exact: true });
  const close = f.d.getByRole('button', { name: 'Close dialog', exact: true });
  const remove = f.d.getByRole('button', { name: 'Remove live tween', exact: true });
  await expect(choice).toBeFocused();
  await expect(choice).toBeChecked();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(f.d).toHaveCount(0);
  await expect(control).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  await control.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove live tween…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove live tween…', exact: true }).press('Enter');
  await expect(choice).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(f.d).toHaveCount(0);
  await expect(stage).toBeFocused();
  const expected = structuredClone(f.p);
  delete expected.layers[1].liveMotionSpans;
  expect(await f.read()).toEqual(expected);
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  expect(await f.read()).toEqual(expected);
  await page.reload();
  await recover(page);
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('empty choices cannot remove anything and cancel has no history', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.d.getByRole('checkbox').uncheck();
  await expect(f.d.getByRole('button', { name: 'Remove live tween', exact: true })).toBeDisabled();
  // A forged enabled DOM button still cannot authorize an empty request.
  await f.d.getByRole('button', { name: 'Remove live tween', exact: true }).evaluate((el) => {
    (el as HTMLButtonElement).disabled = false;
    (el as HTMLButtonElement).click();
  });
  await expect(f.d.getByRole('status')).toContainText('Error:');
  await page.keyboard.press('Escape');
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const kind of ['missing', 'duplicate', 'getter'])
  test(`later ${kind} request rejects atomically and fresh removal recovers`, async ({ page }) => {
    const f = await setup(page, 'two');
    await f.open();
    await f.d.getByLabel('Remove live tween Later frames 1–9', { exact: true }).check();
    await page.evaluate((kind) => {
      const clone = structuredClone,
        w = window as unknown as { hit: boolean; reads: number };
      w.hit = false;
      w.reads = 0;
      window.structuredClone = <T>(value: T) => {
        const out = clone(value),
          a = out as unknown as { layerId: string; spanId: string }[];
        if (!w.hit && Array.isArray(a) && a[0]?.spanId) {
          w.hit = true;
          if (kind === 'missing') a[1].spanId = 'missing';
          if (kind === 'duplicate') a[1] = { ...a[0] };
          if (kind === 'getter')
            Object.defineProperty(a[1], 'spanId', {
              enumerable: true,
              get() {
                w.reads++;
                return 'live';
              },
            });
        }
        return out;
      };
    }, kind);
    await f.d.getByRole('button', { name: 'Remove live tween', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(
      await page.evaluate(() => {
        const w = window as unknown as { hit: boolean; reads: number };
        return [w.hit, w.reads];
      }),
    ).toEqual([true, 0]);
    expect(await f.read()).toEqual(f.p);
    await remove(page);
    const expected = structuredClone(f.p);
    for (const l of expected.layers) delete l.liveMotionSpans;
    expect(await f.read()).toEqual(expected);
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const hook of ['clone', 'serialize'])
  for (const action of ['tracks', 'source', 'editorFrame', 'tool', 'mode', 'close'])
    test(`live removal ${hook} rejects actual late ${action} and keeps independent history`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.open();
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
          const w = window as unknown as { liveRemoveHookHit: boolean };
          w.liveRemoveHookHit = false;
          const fire = (value: unknown) => {
            const p = value as Project;
            if (w.liveRemoveHookHit || !p?.layers?.[0]?.keys || p.layers[0].liveMotionSpans?.length)
              return;
            w.liveRemoveHookHit = true;
            if (action === 'tracks') {
              const e = document.querySelector(
                '[aria-label="Remove live tween Main frames 1–9"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
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
      await f.d.getByRole('button', { name: 'Remove live tween', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { liveRemoveHookHit: boolean }).liveRemoveHookHit,
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
      await remove(page);
      expect((await f.read()).layers[0].liveMotionSpans).toBeUndefined();
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
            if (candidate && !candidate.layers[0].liveMotionSpans && !w.finalHit) {
              w.finalHit = true;
              if (action === 'candidate') candidate.layers[0].keys[0].shapes[0].x += 100;
              else {
                const el = [...document.querySelectorAll('button')].find(
                  (e) => e.textContent === 'Remove live tween',
                )!;
                el.disabled = false;
                el.click();
              }
            } else if (!candidate) candidate = p;
          }
          return out;
        };
    }, action);
    await f.d.getByRole('button', { name: 'Remove live tween', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { finalHit: boolean }).finalHit)).toBe(
      true,
    );
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate history edit';
    if (action === 'reentry') delete expected.layers[0].liveMotionSpans;
    expect(await f.read()).toEqual(expected);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (action !== 'reentry') {
      await f.open();
      await remove(page);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('forged locked later choice cannot consume the valid first removal', async ({ page }) => {
  const f = await setup(page, 'locked');
  await f.open();
  await f.d.getByLabel('Remove live tween Later frames 1–9', { exact: true }).evaluate((el) => {
    (el as HTMLInputElement).disabled = false;
    (el as HTMLInputElement).click();
  });
  await f.d.getByRole('button', { name: 'Remove live tween', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Remove live tween Later frames 1–9', { exact: true }).evaluate((el) => {
    (el as HTMLInputElement).disabled = false;
    (el as HTMLInputElement).click();
  });
  await remove(page);
  const expected = structuredClone(f.p);
  delete expected.layers[0].liveMotionSpans;
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('actual failed interior can recover to authored pixels without evaluating its invalid recipe', async ({
  page,
}) => {
  const f = await setup(page, 'bad');
  await go(page, 2);
  await expect(page.getByLabel('Live stage status')).toContainText('Error:');
  expect(await pixel(page, f.p, 12, 18)).not.toEqual([255, 0, 0, 255]);
  await f.open();
  await remove(page);
  await go(page, 2);
  await expect.poll(() => pixel(page, f.p, 12, 18)).toEqual([255, 0, 0, 255]);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live stage status')).toContainText('Error:');
  expect(f.errors).toEqual([]);
});

test('pending Brush blocks removal and its completed paint remains separately undoable', async ({
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
  await expect(
    page.getByRole('button', { name: 'Remove live tween…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect(page.getByRole('button', { name: 'Remove live tween…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await remove(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
