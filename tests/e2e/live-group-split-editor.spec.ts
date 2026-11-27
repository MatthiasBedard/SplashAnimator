import { build } from 'vite';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { test, expect, type Page } from '@playwright/test';
import { liveRotationFixture } from '../live-motion-rotation-fixture';
import type { LiveMotionSpan } from '../../packages/document/src';
function groupFixture(change?: (p: Project, s: LiveMotionSpan) => void) {
  const { p } = liveRotationFixture('rigid', 'plain', true);
  p.width = 500;
  p.height = 400;
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x += 80;
      shape.y += 80;
    }
  change?.(p, p.layers[0].liveMotionSpans![0]);
  return p;
}
import {
  captureLiveGroupMotionAuthoringFrame,
  prepareSplitLiveGroupMotionSpans,
} from '../../packages/animation/src/live-group-motion-owner';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
async function setup(page: Page, mode = 'plain', custom?: Project) {
  const p =
    custom ??
    groupFixture((p, s) => {
      p.layers[0].name = 'Main';
      p.layers[0].drawingMode = 'object';
      if (['in', 'out', 'in-out'].includes(mode)) s.ease = mode as 'in' | 'out' | 'in-out';
      if (mode === 'compound' || mode === 'reflected') {
        s.options = { paint: true };
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
      if (mode === 'path') {
        s.path = { startX: 24, startY: 32, endX: -24, endY: 32 };
        const a = p.layers[0].keys[0].shapes.at(-1)!,
          b = p.layers[0].keys[1].shapes.at(-1)!;
        b.x = a.x + 80;
        b.y = a.y;
      }
      if (mode === 'channels') {
        s.options = { paint: true };
        s.paintEase = 'linear';
        s.opacityEase = 'out';
        p.layers[0].keys[0].shapes[0].fill = '#000000';
        p.layers[0].keys[1].shapes[0].fill = '#808080';
        p.layers[0].keys[0].shapes[0].opacity = 0.5;
      }
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Insert live group tween key…', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Insert live group tween key', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Live group split frame', { exact: true }).fill('5');
}
async function insert(page: Page) {
  await page.getByRole('button', { name: 'Insert preserved live group key', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
function expected(p: Project, out: Project, ids = ['track']) {
  const capture = captureLiveGroupMotionAuthoringFrame(() => ({
    project: p,
    revision: 0,
    frame: 4,
  }));
  try {
    return prepareSplitLiveGroupMotionSpans(
      ids.map((layerId) => ({
        owner: capture.resolve(layerId, 'outer'),
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
    await open(page);
    if (mode === 'two') await page.getByLabel('Split live group track Later').check();
    await insert(page);
    const out = await f.read();
    expect(out).toEqual(expected(f.p, out, mode === 'two' ? ['track', 'later'] : ['track']));
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
    if (mode === 'multiple')
      await expect(
        page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
          exact: true,
        }),
      ).toBeVisible();
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    await undo(page, true);
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
  await page.getByLabel('Live group split frame').fill('3');
  await insert(page);
  expect((await f.read()).layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 8, 10]);
});
test('later unrepresentable track rejects the whole command and permits a single-track retry', async ({
  page,
}) => {
  const f = await setup(page, 'laterBad');
  await open(page);
  await page.getByLabel('Split live group track Later').check();
  await page.getByRole('button', { name: 'Insert preserved live group key' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Preserved');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Split live group track Later').uncheck();
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
    await page.getByLabel('Live group split frame').fill(value);
    await expect(
      page.getByRole('button', { name: 'Insert preserved live group key' }),
    ).toBeDisabled();
  }
  await page.getByLabel('Live group split frame').fill('5');
  await insert(page);
  expect((await f.read()).layers[0].keys).toHaveLength(4);
  expect(f.errors).toEqual([]);
});
test('closing and Escape leave document and history untouched', async ({ page }) => {
  const f = await setup(page);
  await open(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});
test('locked tracks have no authorized split target', async ({ page }) => {
  const f = await setup(page, 'locked');
  await open(page);
  await expect(page.getByLabel('Split live group track Main')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Insert preserved live group key' }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
});
test('ordinary documents do not enable the sparse command', async ({ page }) => {
  await setup(page, 'absent');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Insert live group tween key…' })).toBeDisabled();
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
                '[aria-label="Live group split frame"]',
              ) as HTMLInputElement;
              for (const v of ['6', '5']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'tracks') {
              const e = document.querySelector(
                '[aria-label="Split live group track Main"]',
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
      await page.getByRole('button', { name: 'Insert preserved live group key' }).click();
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
  await expect(page.getByLabel('Split live group track Main')).toBeChecked();
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
    page.getByRole('button', { name: 'Insert live group tween key…', exact: true }),
  ).toBeDisabled();
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Insert live group tween key…', exact: true }),
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
  await page.getByLabel('Live group split frame').fill('13');
  await page.getByLabel('Split live group track Main').uncheck();
  await page.getByLabel('Split live group track Later').check();
  await insert(page);
  const out = await f.read();
  expect(out.layers[0]).toEqual(f.p.layers[0]);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 8, 12, 16, 20]);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});

async function stagePixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (e, { p, x, y }) => {
      const c = e as HTMLCanvasElement,
        d = devicePixelRatio;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * d,
            c.height / 2 + (y - p.height / 2) * d,
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
async function previewPixel(page: Page, x: number, y: number) {
  return page
    .getByRole('img', { name: 'Preserved live group split preview', exact: true })
    .evaluate(
      (e, { x, y }) => {
        const image = e as HTMLImageElement,
          c = document.createElement('canvas');
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      },
      { x, y },
    );
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`group ${mode}/${basis} preview and insertion preserve independent world pixels`, async ({
      page,
    }) => {
      const { p, b, h } = liveRotationFixture(mode, basis, true);
      p.width = 500;
      p.height = 400;
      p.layers[0].name = 'Main';
      for (const key of p.layers[0].keys)
        for (const shape of key.shapes) {
          shape.x += 80;
          shape.y += 80;
          if (shape.id === 'b') shape.fill = '#0000ff';
        }
      const f = await setup(page, 'plain', p);
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const hm = [(1 + h[0]) / 2, h[1] / 2, h[2] / 2, (1 + h[3]) / 2],
        local = { x: b[0] * 6 + b[2] * 5, y: b[1] * 6 + b[3] * 5 };
      const probes = ([0, 40] as const).map((offset) => {
        const u = hm[0] * (offset + local.x) + hm[2] * local.y,
          v = hm[1] * (offset + local.x) + hm[3] * local.y;
        return {
          x: 120 + (u - v) / Math.SQRT2,
          y: 100 + (u + v) / Math.SQRT2,
          color: offset === 0 ? [255, 64, 64, 255] : [64, 64, 255, 255],
        };
      });
      for (const probe of probes)
        await expect.poll(() => stagePixel(page, p, probe.x, probe.y)).toEqual(probe.color);
      await open(page);
      await page
        .getByRole('button', { name: 'Preview preserved live group key', exact: true })
        .click();
      await expect(
        page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
      ).toBeVisible();
      for (const probe of probes)
        await expect.poll(() => previewPixel(page, probe.x, probe.y)).toEqual(probe.color);
      expect(await f.read()).toEqual(p);
      await insert(page);
      const out = await f.read();
      expect(out).toEqual(expected(p, out));
      for (const probe of probes)
        await expect.poll(() => stagePixel(page, p, probe.x, probe.y)).toEqual(probe.color);
      await expect(
        page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
          exact: true,
        }),
      ).toBeVisible();
      await undo(page);
      expect(await f.read()).toEqual(p);
      await undo(page, true);
      expect(await f.read()).toEqual(out);
      expect(f.errors).toEqual([]);
    });

test('preview never authors and fresh insertion reuses stable per-track right identities', async ({
  page,
}) => {
  const f = await setup(page, 'two');
  await open(page);
  await page.getByLabel('Split live group track Later').check();
  await page.evaluate(() => {
    const clone = structuredClone;
    Object.assign(window, { groupPreviewIds: [] });
    window.structuredClone = <T>(v: T): T => {
      const out = clone(v),
        p = v as Project;
      if (p?.layers?.every((l) => l.liveMotionSpans?.length === 2))
        Object.assign(window, { groupPreviewIds: p.layers.map((l) => l.liveMotionSpans![1].id) });
      return out;
    };
  });
  await page.getByRole('button', { name: 'Preview preserved live group key', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
  ).toBeVisible();
  const ids = await page.evaluate(
    () => (window as unknown as { groupPreviewIds: string[] }).groupPreviewIds,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(await f.read()).toEqual(f.p);
  await insert(page);
  const out = await f.read();
  expect(out.layers.map((l) => l.liveMotionSpans![1].id)).toEqual(ids);
  expect(out).toEqual(expected(f.p, out, ['track', 'later']));
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const action of ['candidate', 'source', 'frame', 'tracks', 'close', 'reentry'])
  test(`final recovery ${action} preserves atomic group insertion history`, async ({ page }) => {
    const f = await setup(page);
    await open(page);
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      Object.assign(window, { groupFinalHit: false });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const text = stringify(...args),
          wrapper = args[0] as { project?: Project },
          w = window as unknown as { groupFinalHit: boolean };
        if (
          !w.groupFinalHit &&
          wrapper?.project?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
          wrapper.project.layers[0].liveMotionSpans?.length === 2
        ) {
          w.groupFinalHit = true;
          if (action === 'candidate') wrapper.project.layers[0].keys[1].shapes[0].x++;
          if (action === 'source') {
            const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#000000';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'frame') {
            const e = document.querySelector(
              '[aria-label="Live group split frame"]',
            ) as HTMLInputElement;
            for (const value of ['6', '5']) {
              e.value = value;
              e.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'tracks') {
            const e = document.querySelector(
              '[aria-label="Split live group track Main"]',
            ) as HTMLInputElement;
            e.click();
            e.click();
          }
          if (action === 'close')
            (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          if (action === 'reentry')
            [...document.querySelectorAll('button')]
              .find((e) => e.textContent === 'Insert preserved live group key')!
              .click();
        }
        return text;
      }) as typeof stringify;
    }, action);
    await page
      .getByRole('button', { name: 'Insert preserved live group key', exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as unknown as { groupFinalHit: boolean }).groupFinalHit),
    ).toBe(true);
    const out = await f.read();
    if (action === 'reentry') expect(out).toEqual(expected(f.p, out));
    else {
      const original = structuredClone(f.p);
      if (action === 'source') original.background = '#000000';
      expect(out).toEqual(original);
    }
    if (await page.getByRole('dialog').count())
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (action === 'source' || action === 'reentry') {
      await undo(page);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });
for (const kind of ['plain', 'locked', 'hidden'])
  test(`forged ${kind} track cannot broaden explicit group insertion`, async ({ page }) => {
    const p = groupFixture();
    p.layers[0].name = 'Main';
    const later = { ...structuredClone(p.layers[0]), id: 'later', name: 'Later' };
    if (kind === 'plain') {
      for (const key of later.keys) for (const shape of key.shapes) delete shape.groups;
      delete later.liveMotionSpans![0].rotation!.rigidGroups;
    }
    if (kind === 'locked') later.locked = true;
    if (kind === 'hidden') later.visible = false;
    p.layers.push(later);
    const f = await setup(page, 'plain', p);
    await open(page);
    await expect(page.getByLabel('Split live group track Later')).toBeDisabled();
    await page.evaluate(() => {
      const e = document.querySelector(
        '[aria-label="Split live group track Later"]',
      ) as HTMLInputElement;
      e.checked = true;
      e.dispatchEvent(new Event('change', { bubbles: true }));
      const button = [...document.querySelectorAll('button')].find(
        (e) => e.textContent === 'Insert preserved live group key',
      )!;
      button.disabled = false;
      button.click();
    });
    expect(await f.read()).toEqual(p);
    await page.evaluate(() => {
      const e = document.querySelector(
        '[aria-label="Split live group track Later"]',
      ) as HTMLInputElement;
      e.checked = false;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await insert(page);
    expect((await f.read()).layers[1]).toEqual(p.layers[1]);
    expect(f.errors).toEqual([]);
  });

test('stale preview output revokes its URL and fresh retries remain history-free', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await page.evaluate(() => {
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    const state = { hit: false, url: '', revoked: [] as string[] };
    Object.assign(window, { groupUrls: state });
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (!state.hit) {
        state.hit = true;
        state.url = url;
        const e = document.querySelector(
          '[aria-label="Live group split frame"]',
        ) as HTMLInputElement;
        for (const value of ['6', '5']) {
          e.value = value;
          e.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.revoked.push(url);
      revoke(url);
    };
  });
  await page.getByRole('button', { name: 'Preview preserved live group key', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (
          window as unknown as { groupUrls: { hit: boolean; url: string; revoked: string[] } }
        ).groupUrls;
        return s.hit && s.revoked.includes(s.url);
      }),
    )
    .toBe(true);
  await expect(
    page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
  ).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Preview preserved live group key', exact: true }).click();
  const image = page.getByRole('img', { name: 'Preserved live group split preview', exact: true });
  await expect(image).toBeVisible();
  const url = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(
    await page.evaluate(
      (url) =>
        (window as unknown as { groupUrls: { revoked: string[] } }).groupUrls.revoked.includes(
          url!,
        ),
      url,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('prepared remembered-child preview preserves exposure origins library and script-free history', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  p.layers[0].name = 'Main';
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes[0].groups = ['outer'];
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'member', x: key.shapes[0].x + 30 });
  }
  Object.assign(p.layers[0].liveMotionSpans![0], {
    rotation: { direction: 'shortest', turns: 0, rigidGroups: true },
    path: { startX: 0, startY: 20, endX: 0, endY: 20 },
  });
  const f = await setup(page, 'plain', p);
  await open(page);
  await page.getByLabel('Live group split frame').fill('3');
  await page.getByLabel('Group split remembered children').check();
  await page.getByRole('button', { name: 'Preview preserved live group key', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
  ).toBeVisible();
  await expect.poll(() => previewPixel(page, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => previewPixel(page, 55, 25)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  await insert(page);
  const out = await f.read(),
    capture = captureLiveGroupMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 2 }));
  try {
    expect(out).toEqual(
      prepareSplitLiveGroupMotionSpans([
        {
          owner: capture.resolve('live', 'outer'),
          rightSpanId: out.layers[0].liveMotionSpans![1].id,
        },
      ]),
    );
  } finally {
    capture.dispose();
  }
  expect(out.layers[1]).toEqual(p.layers[1]);
  expect(out.symbols).toEqual(p.symbols);
  expect(out.frameScripts).toEqual(p.frameScripts);
  await undo(page);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});
test('cloned raw group track accessors reject without reads and a fresh corrected command succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await page.evaluate(() => {
    const clone = structuredClone;
    const state = { hit: false, reads: 0 };
    Object.assign(window, { groupRaw: state });
    window.structuredClone = <T>(v: T): T => {
      const out = clone(v),
        input = out as { target?: number; ids?: string[] };
      if (!state.hit && input.target === 4 && input.ids?.[0] === 'track') {
        state.hit = true;
        Object.defineProperty(input.ids, '0', {
          enumerable: true,
          get() {
            state.reads++;
            return 'track';
          },
        });
      }
      return out;
    };
  });
  await page.getByRole('button', { name: 'Insert preserved live group key', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { groupRaw: { hit: boolean; reads: number } }).groupRaw,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await insert(page);
  const out = await f.read();
  expect(out).toEqual(expected(f.p, out));
  expect(f.errors).toEqual([]);
});
for (const kind of ['nonshared', 'distance'])
  test(`unresolved ${kind} group split rejects and metadata removal remains undoable`, async ({
    page,
  }) => {
    const p = groupFixture();
    p.layers[0].name = 'Main';
    p.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      ...(kind === 'distance' ? { distance: true } : {}),
    };
    if (kind === 'distance') {
      const a = p.layers[0].keys[0].shapes.at(-1)!,
        b = p.layers[0].keys[1].shapes.at(-1)!;
      b.x = a.x + 80;
      b.y = a.y;
    }
    const f = await setup(page, 'plain', p);
    await open(page);
    await page
      .getByRole('button', { name: 'Insert preserved live group key', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      kind === 'nonshared' ? 'displacement' : 'reproduce',
    );
    expect(await f.read()).toEqual(p);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Remove live tween…', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove live tween', exact: true })
      .click();
    const out = await f.read();
    expect(out.layers[0].liveMotionSpans).toBeUndefined();
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(out.symbols).toEqual(p.symbols);
    await undo(page);
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });

test.describe('independent restricted banks', () => {
  let rasterCode: string;
  test.beforeAll(async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: 'tests/group-path-browser-fixture.ts',
          formats: ['iife'],
          name: 'RestrictedBanks',
          fileName: () => 'restricted.js',
        },
      },
    });
    const chunks = (Array.isArray(result) ? result : [result])
      .flatMap((r) => ('output' in r ? r.output : []))
      .filter((o) => o.type === 'chunk');
    if (chunks.length !== 1) throw Error('Expected one restricted bank fixture');
    rasterCode = chunks[0].code;
  });
  for (const mode of ['piecewise', 'distance'])
    for (const basis of ['plain', 'affine', 'reflected'])
      test(`main ${mode}/${basis} bank insertion retains preview stage PNG pixels and exact history`, async ({
        page,
      }) => {
        const { p } = liveRotationFixture('rigid', basis, true);
        p.width = 500;
        p.height = 400;
        p.layers[0].name = 'Main';
        for (const k of p.layers[0].keys)
          for (const s of k.shapes) {
            s.x += 80;
            s.y += 80;
            s.opacity = 1;
            s.fill = s.id === 'b' ? '#0000ff' : s.id === 'c' ? '#00ff00' : '#ff0000';
          }
        const l = p.layers[0];
        l.keys[1].shapes = l.keys[0].shapes.map((s) => ({ ...structuredClone(s), x: s.x + 96 }));
        if (mode === 'piecewise')
          l.liveMotionSpans![0].path = {
            startX: 0,
            startY: 0,
            endX: 0,
            endY: 0,
            waypoints: [
              { x: 17, y: 32 },
              { x: 34, y: -24 },
            ],
          };
        else delete l.liveMotionSpans![0].path;
        l.liveMotionSpans![0].groupPaths = ['outer', 'second'].map((groupId) => ({
          groupId,
          composition: 'additive',
          path: {
            startX: 32,
            startY: mode === 'distance' ? 1 : -24,
            endX: -32,
            endY: mode === 'distance' ? 1 : -24,
            distance: mode === 'distance',
            tangent: false,
          },
        }));
        const f = await setup(page, 'plain', p);
        await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
        await page.getByLabel('Timeline frames', { exact: true }).focus();
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
        const u = basis === 'plain' ? 6 : basis === 'reflected' ? -9.5 : 14.5,
          v = basis === 'plain' ? 5 : 16.5,
          origin = mode === 'distance' ? { x: 128, y: 100.75 } : { x: 105.5, y: 86 },
          probes = [
            { x: origin.x + u, y: origin.y + v, color: [255, 0, 0, 255] },
            { x: origin.x + 40 + u, y: origin.y + v, color: [0, 0, 255, 255] },
          ];
        for (const probe of probes)
          await expect.poll(() => stagePixel(page, p, probe.x, probe.y)).toEqual(probe.color);
        await open(page);
        await page
          .getByRole('button', { name: 'Preview preserved live group key', exact: true })
          .click();
        await expect(
          page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
        ).toBeVisible();
        for (const probe of probes)
          await expect.poll(() => previewPixel(page, probe.x, probe.y)).toEqual(probe.color);
        expect(await f.read()).toEqual(p);
        await insert(page);
        const out = await f.read();
        expect(out).toEqual(expected(p, out));
        for (const probe of probes)
          await expect.poll(() => stagePixel(page, p, probe.x, probe.y)).toEqual(probe.color);
        await page.addScriptTag({ content: rasterCode });
        const pixels = await page.evaluate(
          async ({ original, reopened }) => {
            const api = (
              window as unknown as {
                RestrictedBanks: typeof import('../group-path-browser-fixture');
              }
            ).RestrictedBanks;
            let difference = 0,
              red = 0,
              blue = 0,
              green = 0;
            for (const frame of [3, 5]) {
              const views: Uint8ClampedArray[] = [];
              for (const p of [
                original,
                api.migrateProject(JSON.parse(JSON.stringify(reopened))),
              ]) {
                const bitmap = await createImageBitmap(await api.exportPNGFrame(p, frame)),
                  c = document.createElement('canvas');
                c.width = p.width;
                c.height = p.height;
                const ctx = c.getContext('2d')!;
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                views.push(ctx.getImageData(0, 0, p.width, p.height).data);
              }
              for (let i = 0; i < views[0].length; i += 4) {
                if (views[0].slice(i, i + 4).some((v, j) => v !== views[1][i + j])) difference++;
                const a = views[1];
                if (a[i] > 200 && a[i + 1] < 50 && a[i + 2] < 50) red++;
                if (a[i] < 50 && a[i + 1] < 50 && a[i + 2] > 200) blue++;
                if (a[i] < 50 && a[i + 1] > 200 && a[i + 2] < 50) green++;
              }
            }
            return { difference, red, blue, green };
          },
          { original: p, reopened: out },
        );
        expect(pixels.difference).toBe(0);
        expect(pixels.red).toBeGreaterThan(20);
        expect(pixels.blue).toBeGreaterThan(20);
        expect(pixels.green).toBeGreaterThan(20);
        await page.getByTitle('First frame', { exact: true }).click();
        await undo(page);
        expect(await f.read()).toEqual(p);
        await undo(page, true);
        expect(await f.read()).toEqual(out);
        expect(f.errors).toEqual([]);
      });
  test('uncertified distance preview stays atomic and a fresh checked-track retry has one history transaction', async ({
    page,
  }) => {
    const { p } = liveRotationFixture('rigid', 'plain', true);
    p.width = 500;
    p.height = 400;
    const l = p.layers[0];
    l.name = 'Main';
    for (const k of l.keys)
      for (const s of k.shapes) {
        s.x += 80;
        s.y += 80;
      }
    l.keys[1].shapes = l.keys[0].shapes.map((s) => ({ ...structuredClone(s), x: s.x + 96 }));
    delete l.liveMotionSpans![0].path;
    l.liveMotionSpans![0].groupPaths = ['outer', 'second'].map((groupId) => ({
      groupId,
      composition: 'additive',
      path: { startX: 32, startY: -40, endX: -32, endY: -24, distance: true },
    }));
    const later = { ...structuredClone(l), id: 'later', name: 'Later' };
    for (const bank of later.liveMotionSpans![0].groupPaths!) {
      bank.path.startY = 0;
      bank.path.endY = 0;
    }
    p.layers.push(later);
    const f = await setup(page, 'plain', p);
    await open(page);
    const dialog = page.getByRole('dialog', { name: 'Insert live group tween key', exact: true });
    await page
      .getByRole('button', { name: 'Preview preserved live group key', exact: true })
      .click();
    await expect(dialog.getByRole('status')).toContainText('arc correspondence');
    expect(await f.read()).toEqual(p);
    await expect(
      page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Split live group track Main', { exact: true }).uncheck();
    await page.getByLabel('Split live group track Later', { exact: true }).check();
    await page
      .getByRole('button', { name: 'Preview preserved live group key', exact: true })
      .click();
    await expect(
      page.getByRole('img', { name: 'Preserved live group split preview', exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(p);
    await insert(page);
    const out = await f.read();
    expect(out).toEqual(expected(p, out, ['later']));
    expect(out.layers[0]).toEqual(p.layers[0]);
    await page.getByTitle('First frame', { exact: true }).click();
    await undo(page);
    expect(await f.read()).toEqual(p);
    await undo(page, true);
    expect(await f.read()).toEqual(out);
    expect(f.errors).toEqual([]);
  });
});
