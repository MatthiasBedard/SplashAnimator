import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import {
  captureLiveMotionAuthoringFrame,
  prepareSplitLiveMotionSpans,
} from '../../packages/animation/src/live-motion-owner';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
async function setup(page: Page, mode = 'plain') {
  const p = liveSplitFixture((p, s) => {
    p.layers[0].name = 'Main';
    p.layers[0].drawingMode = 'object';
    if (['in', 'out', 'in-out'].includes(mode)) s.ease = mode as 'in' | 'out' | 'in-out';
    if (mode === 'compound' || mode === 'reflected') {
      s.options = { nodes: true, affine: true };
      for (const k of p.layers[0].keys.slice(0, 2)) {
        Object.assign(k.shapes[0], {
          kind: 'polygon',
          fillRule: 'evenodd',
          transform: [mode === 'reflected' ? -1 : 1, 0.25, 0.5, 2],
          contours: [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 3, y: 3 },
              { x: 7, y: 3 },
              { x: 5, y: 6 },
            ],
          ],
        });
      }
    }
    if (mode === 'path') s.path = { startX: 24, startY: 32, endX: -24, endY: 32 };
    if (mode === 'channels') {
      s.options = { paint: true };
      s.paintEase = 'linear';
      s.opacityEase = 'out';
      p.layers[0].keys[0].shapes[0].fill = '#000000';
      p.layers[0].keys[1].shapes[0].fill = '#808080';
      p.layers[0].keys[0].shapes[0].opacity = 0.5;
    }
    if (mode === 'multiple')
      for (const k of p.layers[0].keys.slice(0, 2))
        k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'second', y: 55 });
  });
  if (mode === 'two' || mode === 'laterBad') {
    p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
    if (mode === 'laterBad') {
      p.layers[1].liveMotionSpans![0].ease = 'in-out';
      p.layers[1].liveMotionSpans![0].end = 10;
      p.layers[1].keys[1].frame = 10;
      p.layers[1].keys.pop();
    }
  }
  if (mode === 'locked') p.layers[0].locked = true;
  if (mode === 'disjoint') {
    p.duration = 22;
    const later = { ...structuredClone(p.layers[0]), id: 'later', name: 'Later' };
    later.keys = [
      { frame: 0, shapes: [] },
      { ...later.keys[0], frame: 8 },
      { ...later.keys[1], frame: 16 },
      { frame: 20, shapes: [] },
    ];
    later.liveMotionSpans![0].start = 8;
    later.liveMotionSpans![0].end = 16;
    p.layers.push(later);
  }
  if (mode === 'inactive')
    p.layers.unshift({
      ...structuredClone(p.layers[0]),
      id: 'held',
      name: 'Held',
      liveMotionSpans: undefined,
    });
  if (mode === 'absent') delete p.layers[0].liveMotionSpans;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-split-seed')) {
      sessionStorage.setItem('live-split-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function open(page: Page, verifyFocus = false) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Insert live tween key…', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Insert live tween key', exact: true }),
  ).toBeVisible();
  const frame = page.getByLabel('Live split frame', { exact: true });
  if (verifyFocus) await expect(frame).toBeFocused();
  await frame.fill('5');
}
async function insert(page: Page) {
  await page.getByRole('button', { name: 'Insert preserved live key', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
function expected(p: Project, out: Project, ids = ['track']) {
  const capture = captureLiveMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 4 }));
  try {
    return prepareSplitLiveMotionSpans(
      ids.map((layerId) => ({
        owner: capture.resolve(layerId, 'art'),
        rightSpanId: out.layers.find((l) => l.id === layerId)!.liveMotionSpans![1].id,
      })),
    );
  } finally {
    capture.dispose();
  }
}
async function undo(page: Page, redo = false) {
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}
for (const mode of [
  'plain',
  'in',
  'out',
  'in-out',
  'channels',
  'compound',
  'reflected',
  'path',
  'multiple',
  'two',
])
  test(`main ${mode} sparse split retains exact data, selection and one history transaction`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await open(page, mode === 'plain');
    if (mode === 'two') await page.getByLabel('Split live track Later').check();
    if (mode === 'plain') {
      const close = page.getByRole('button', { name: 'Close dialog', exact: true });
      const apply = page.getByRole('button', { name: 'Insert preserved live key', exact: true });
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(apply).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await apply.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
    } else await insert(page);
    const out = await f.read();
    expect(out).toEqual(expected(f.p, out, mode === 'two' ? ['track', 'later'] : ['track']));
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
    if (mode === 'multiple')
      await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
    if (mode === 'plain') await page.keyboard.press('Control+z');
    else await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (mode === 'plain') await page.keyboard.press('Control+Shift+z');
    else await undo(page, true);
    expect(await f.read()).toEqual(out);
    expect(f.errors).toEqual([]);
  });
test('complete split survives recovery without a per-frame bake', async ({ page }) => {
  const f = await setup(page);
  await open(page);
  await insert(page);
  const out = await f.read();
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
  await open(page);
  await page.getByLabel('Live split frame').fill('3');
  await insert(page);
  expect((await f.read()).layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 8, 10]);
});
test('later unrepresentable track rejects the whole command and permits a single-track retry', async ({
  page,
}) => {
  const f = await setup(page, 'laterBad');
  await open(page);
  await page.getByLabel('Split live track Later').check();
  await page.getByRole('button', { name: 'Insert preserved live key' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Preserved');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Split live track Later').uncheck();
  await insert(page);
  const out = await f.read();
  expect(out.layers[1]).toEqual(f.p.layers[1]);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});
test('empty, fractional and endpoint inputs stay disabled and valid correction recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  for (const value of ['', '1', '2', '8', '9', '5.5']) {
    await page.getByLabel('Live split frame').fill(value);
    await expect(page.getByRole('button', { name: 'Insert preserved live key' })).toBeDisabled();
  }
  await page.getByLabel('Live split frame').fill('5');
  await insert(page);
  expect((await f.read()).layers[0].keys).toHaveLength(4);
  expect(f.errors).toEqual([]);
});
test('closing and Escape leave document and history untouched', async ({ page }) => {
  const f = await setup(page);
  await open(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
  await open(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});
test('locked tracks have no authorized split target', async ({ page }) => {
  const f = await setup(page, 'locked');
  await open(page);
  await expect(page.getByLabel('Split live track Main')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Insert preserved live key' })).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
});
test('ordinary documents do not enable the sparse command', async ({ page }) => {
  await setup(page, 'absent');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Insert live tween key…' })).toBeDisabled();
});
for (const hook of ['clone', 'serialize'] as const)
  for (const action of [
    'frame',
    'tracks',
    'source',
    'editorFrame',
    'tool',
    'mode',
    'close',
  ] as const)
    test(`${hook} complete candidate rejects late restored ${action} and preserves history`, async ({
      page,
    }) => {
      const f = await setup(page);
      await open(page);
      if (action === 'mode') {
        await page
          .getByRole('button', { name: 'Control', exact: true })
          .evaluate((e: HTMLButtonElement) => e.click());
        await expect(
          page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }),
        ).toBeAttached();
      }
      await page.evaluate(
        ({ hook, action }) => {
          const win = window as unknown as { splitHookHit: boolean };
          win.splitHookHit = false;
          function fire(value: unknown) {
            const p = value as Project;
            if (
              win.splitHookHit ||
              !p?.layers?.[0]?.keys?.some((k) => k.frame === 4) ||
              p.layers[0].liveMotionSpans?.length !== 2
            )
              return;
            win.splitHookHit = true;
            if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (
                  document.querySelector('[aria-label="' + label + '"]') as HTMLButtonElement
                ).click();
            if (action === 'mode')
              for (let i = 0; i < 2; i++) {
                const e = [...document.querySelectorAll('button')].find(
                  (e) =>
                    e.textContent === 'Show sampled motion on stage' ||
                    e.textContent === 'Return to authored stage',
                );
                if (!e) throw Error('Missing sampled mode control');
                e.click();
              }
            if (action === 'frame') {
              const e = document.querySelector(
                '[aria-label="Live split frame"]',
              ) as HTMLInputElement;
              for (const v of ['6', '5']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'tracks') {
              const e = document.querySelector(
                '[aria-label="Split live track Main"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            }
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
              e.value = '#000000';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'editorFrame')
              for (const title of ['Last frame', 'First frame'])
                (
                  document.querySelector('button[title="' + title + '"]') as HTMLButtonElement
                ).click();
            if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          }
          if (hook === 'clone') {
            const clone = window.structuredClone;
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
      await page.getByRole('button', { name: 'Insert preserved live key' }).click();
      expect(
        await page.evaluate(() => (window as unknown as { splitHookHit: boolean }).splitHookHit),
      ).toBe(true);
      const out = await f.read();
      expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
      expect(out.layers[0].liveMotionSpans).toEqual(f.p.layers[0].liveMotionSpans);
      if (action === 'source') {
        expect(out.background).toBe('#000000');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      } else {
        expect(out).toEqual(f.p);
        if (action === 'frame' || action === 'tracks') await insert(page);
        else {
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await open(page);
          await insert(page);
        }
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      }
      expect(f.errors).toEqual([]);
    });

test('inactive current layer falls back to an actual original live track', async ({ page }) => {
  const f = await setup(page, 'inactive');
  await open(page);
  await expect(page.getByLabel('Split live track Main')).toBeChecked();
  await insert(page);
  const out = await f.read();
  expect(out.layers[0]).toEqual(f.p.layers[0]);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});
test('pending Brush blocks sparse insertion and finished paint has separate history', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Insert live tween key…', exact: true }),
  ).toBeDisabled();
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Insert live tween key…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await open(page);
  await insert(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('disjoint live ranges allow clearing an ineligible checked track before another split', async ({
  page,
}) => {
  const f = await setup(page, 'disjoint');
  await open(page);
  await page.getByLabel('Live split frame').fill('13');
  await page.getByLabel('Split live track Main').uncheck();
  await page.getByLabel('Split live track Later').check();
  await insert(page);
  const out = await f.read();
  expect(out.layers[0]).toEqual(f.p.layers[0]);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 8, 12, 16, 20]);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});
