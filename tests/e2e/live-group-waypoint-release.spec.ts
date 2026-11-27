import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { liveRotationFixture } from '../live-motion-rotation-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
function fixture(mode = 'straight', basis = 'plain') {
  const { p } = liveRotationFixture('rigid', basis, true);
  p.width = 300;
  p.height = 240;
  const positions = [
    { x: 8, y: 12 },
    { x: 8, y: 82 },
    { x: 48, y: 42 },
    { x: 48, y: 112 },
    { x: 220, y: 120 },
  ];
  for (const key of p.layers[0].keys.slice(0, 2))
    for (let i = 0; i < key.shapes.length; i++) {
      const a = key.shapes[i],
        origin = positions[i];
      Object.assign(a, {
        x: origin.x + (key.frame === 8 ? 80 : 0),
        y: origin.y,
        width: 20,
        height: 20,
        rotation: basis === 'plain' ? 0 : 25,
        opacity: 1,
        transform:
          basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
        fill: i < 2 ? '#ff0000' : i < 4 ? '#0000ff' : '#008000',
      });
    }
  p.layers[0].liveMotionSpans![0].path = {
    startX: 3,
    startY: 7,
    endX: -2,
    endY: 6,
    waypoints: [
      { x: 20, y: 30 },
      { x: 60, y: 30 },
    ],
  };
  const path = p.layers[0].liveMotionSpans![0].path!;
  if (mode !== 'straight' && mode !== 'distance') path.curvedWaypoints = true;
  if (mode.includes('distance')) path.distance = true;
  if (mode.includes('custom')) {
    path.waypointTangents = [
      { x: 10, y: 5 },
      { x: 10, y: 5 },
      { x: 15, y: -5 },
      { x: 10, y: -5 },
    ];
    path.waypointIncoming = [
      { x: -20, y: -10 },
      { x: -30, y: 10 },
    ];
  }
  if (mode.includes('tangent'))
    Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
  return p;
}
async function setup(page: Page, p = fixture(), at = 4) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (window === window.top && !sessionStorage.getItem('waypoint-release-seed')) {
      sessionStorage.setItem('waypoint-release-seed', '1');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit live group waypoint positions…', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Live group waypoint positions', exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, canvas, errors, read };
}
async function numeric(page: Page, x = 38, y = 52) {
  await page.getByLabel('Live group waypoint document X', { exact: true }).fill(String(x));
  await page.getByLabel('Live group waypoint document Y', { exact: true }).fill(String(y));
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (node, { p, x, y }) => {
      const c = node as HTMLCanvasElement,
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
async function undoRedo(page: Page, f: Awaited<ReturnType<typeof setup>>, expected: Project) {
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
}
async function point(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (node, { p, x, y }) => {
      const c = node as HTMLCanvasElement,
        r = c.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 + ((x - p.width / 2) * r.width) / (c.width / devicePixelRatio),
        y: r.top + r.height / 2 + ((y - p.height / 2) * r.height) / (c.height / devicePixelRatio),
      };
    },
    { p, x, y },
  );
}
async function capture(page: Page) {
  return page
    .getByLabel('Drawing stage', { exact: true })
    .evaluate((node) => (node as HTMLCanvasElement).hasPointerCapture(1));
}
async function drag(page: Page, p: Project, x = 28, y = 42, dx = 20, dy = 10, shift = false) {
  const start = await point(page, p, x, y),
    end = await point(page, p, x + dx, y + dy);
  await page.mouse.move(start.x + 2, start.y - 1);
  await page.mouse.down();
  expect(await capture(page)).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(end.x + 2, end.y - 1, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  expect(await capture(page)).toBe(false);
  await expect(page.getByLabel('Live group waypoint status', { exact: true })).toContainText(
    'Unapplied',
  );
}
async function useAndCommit(page: Page, f: Awaited<ReturnType<typeof setup>>, index = 0, root = 0) {
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Use group waypoint draft target', exact: true }).click();
  const x = Number(
      await page.getByLabel('Live group waypoint document X', { exact: true }).inputValue(),
    ),
    y = Number(
      await page.getByLabel('Live group waypoint document Y', { exact: true }).inputValue(),
    );
  const expected = structuredClone(f.p),
    origin = f.p.layers[0].keys[0].shapes[root * 2];
  expected.layers[0].liveMotionSpans![0].path!.waypoints =
    expected.layers[0].liveMotionSpans![0].path!.waypoints!.map((q, i) =>
      i === index ? { x: x - origin.x, y: y - origin.y } : q,
    );
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toHaveCount(0);
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
  return { x, y, expected };
}
async function enable(page: Page) {
  await page.getByLabel('Drag live group waypoints', { exact: true }).check();
  await page.getByLabel('Author live group waypoint on release', { exact: true }).check();
}
async function begin(page: Page, p: Project, x = 28, y = 42, scale = false, shift = false) {
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  if (scale)
    await canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
  const a = await point(page, p, x, y),
    b = await point(page, p, x + 20, y + 10);
  await canvas.evaluate((c) => {
    const canvas = c as HTMLCanvasElement,
      r = c.getBoundingClientRect();
    const data = {
      width: canvas.width / devicePixelRatio,
      height: canvas.height / devicePixelRatio,
      cssWidth: r.width,
      cssHeight: r.height,
      down: { x: 0, y: 0 },
      up: { x: 0, y: 0 },
    };
    Object.assign(window, { waypointReleaseEvents: data });
    for (const kind of ['pointerdown', 'pointerup'])
      c.addEventListener(
        kind,
        (e) => {
          const q = e as PointerEvent;
          data[kind === 'pointerdown' ? 'down' : 'up'] = { x: q.clientX, y: q.clientY };
        },
        { once: true },
      );
  });
  await page.mouse.move(a.x + 2, a.y - 1);
  await page.mouse.down();
  expect(await capture(page)).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
  return {
    a,
    b,
    finish: async () => {
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      expect(await capture(page)).toBe(false);
      return canvas.evaluate(
        (_c, { x, y, shift }) => {
          const e = (
            window as unknown as {
              waypointReleaseEvents: {
                width: number;
                height: number;
                cssWidth: number;
                cssHeight: number;
                down: { x: number; y: number };
                up: { x: number; y: number };
              };
            }
          ).waypointReleaseEvents;
          let dx = ((e.up.x - e.down.x) * e.width) / e.cssWidth,
            dy = ((e.up.y - e.down.y) * e.height) / e.cssHeight;
          if (shift) {
            if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          return { x: x + dx, y: y + dy };
        },
        { x, y, shift },
      );
    },
  };
}
async function authored(
  page: Page,
  f: Awaited<ReturnType<typeof setup>>,
  target: { x: number; y: number },
  root = 0,
  index = 0,
) {
  await expect(f.panel).toHaveCount(0);
  const expected = structuredClone(f.p),
    origin = f.p.layers[0].keys[0].shapes[root * 2];
  expected.layers[0].liveMotionSpans![0].path!.waypoints =
    expected.layers[0].liveMotionSpans![0].path!.waypoints!.map((q, i) =>
      i === index ? { x: target.x - origin.x, y: target.y - origin.y } : q,
    );
  expect(await f.read()).toEqual(expected);
  if (f.p.layers[0].keys[0].shapes.length > 1)
    await expect(
      page.getByText(
        `${f.p.layers[0].keys[0].shapes.length} vectors selected. Drag or use arrow keys to move together.`,
        { exact: true },
      ),
    ).toBeVisible();
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
  return expected;
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const index of [0, 1])
      test(`direct group waypoint ${basis}/root${root}/slot${index} persists exactly one selected edit`, async ({
        page,
      }) => {
        const f = await setup(page, fixture('straight', basis));
        await expect(page.getByLabel('Author live group waypoint on release')).not.toBeChecked();
        if (root) await page.getByLabel('Live group waypoint group').selectOption('1');
        if (index) await page.getByLabel('Live group waypoint number').fill('2');
        await enable(page);
        const gesture = await begin(page, f.p, 28 + 40 * root + 40 * index, 42 + 30 * root);
        expect(await f.read()).toEqual(f.p);
        const target = await gesture.finish();
        await authored(page, f, target, root, index);
      });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  test(`direct group waypoint ${mode} preserves complete route metadata/history`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(mode));
    await enable(page);
    const g = await begin(page, f.p);
    await authored(page, f, await g.finish());
  });
for (const shift of [false, true])
  test(`direct group waypoint independent CSS axes/offsets/Shift ${shift}`, async ({ page }) => {
    const f = await setup(page);
    await enable(page);
    const g = await begin(page, f.p, 28, 42, true, shift);
    await authored(page, f, await g.finish());
  });
for (const action of [
  'zero',
  'return',
  'escape',
  'native',
  'loss',
  'foreign',
  'author policy',
  'gesture policy',
  'view',
] as const)
  test(`direct group waypoint ${action} never publishes stale history`, async ({ page }) => {
    const f = await setup(page);
    await enable(page);
    const a = await point(page, f.p, 28, 42),
      b = await point(page, f.p, 48, 52);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (action !== 'zero') await page.mouse.move(b.x, b.y, { steps: 3 });
    if (action === 'return') await page.mouse.move(a.x, a.y);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'native') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (action === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'foreign') {
      await f.canvas.dispatchEvent('pointerup', { pointerId: 99, clientX: b.x, clientY: b.y });
      expect(await capture(page)).toBe(true);
      await page.keyboard.press('Escape');
    }
    if (action === 'author policy' || action === 'gesture policy')
      await page
        .getByLabel(
          action === 'author policy'
            ? 'Author live group waypoint on release'
            : 'Drag live group waypoints',
        )
        .evaluate((c) => {
          const i = c as HTMLInputElement;
          i.checked = false;
          i.dispatchEvent(new Event('change', { bubbles: true }));
          i.checked = true;
          i.dispatchEvent(new Event('change', { bubbles: true }));
        });
    if (action === 'view')
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.9,.8)';
        window.dispatchEvent(new Event('scroll'));
      });
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Use group waypoint draft target', exact: true }),
    ).toBeDisabled();
    expect(f.errors).toEqual([]);
  });
for (const action of ['target', 'index', 'root', 'frame', 'close', 'source'] as const)
  test(`direct group waypoint active ${action} change rejects publication`, async ({ page }) => {
    const f = await setup(page);
    await enable(page);
    await begin(page, f.p);
    if (action === 'target')
      await page.getByLabel('Live group waypoint document X').evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = '100';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    if (action === 'index')
      await page.getByLabel('Live group waypoint number').evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = '2';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    if (action === 'root')
      await page.getByLabel('Live group waypoint group').evaluate((c) => {
        const i = c as HTMLSelectElement;
        i.value = '1';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    if (action === 'frame')
      await page
        .getByRole('button', { name: 'Next frame', exact: true })
        .evaluate((c) => (c as HTMLButtonElement).click());
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live group waypoint positions', exact: true })
        .evaluate((c) => (c as HTMLButtonElement).click());
    if (action === 'source')
      await page.getByLabel('Layer name', { exact: true }).evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = 'Actual release source change';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Actual release source change';
    expect(await f.read()).toEqual(expected);
    if (action === 'target')
      await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('100');
    if (action === 'index')
      await expect(page.getByLabel('Live group waypoint number')).toHaveValue('2');
    if (action === 'root')
      await expect(page.getByLabel('Live group waypoint group')).toHaveValue('1');
    if (action === 'frame')
      await expect(page.getByText('Frame 6 / 12', { exact: true })).toBeVisible();
    if (action === 'close' || action === 'source') await expect(f.panel).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
for (const phase of ['initial', 'release', 'final'] as const)
  for (const action of ['target', 'author policy', 'gesture policy', 'source'] as const)
    test(`direct group waypoint ${phase} actual ${action} change rejects stale authoring and allows fresh retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await enable(page);
      await f.canvas.evaluate(
        (c, { phase, action }) => {
          const clone = structuredClone,
            stringify = JSON.stringify;
          let native = '',
            hit = false,
            prepared = false;
          for (const kind of ['pointerdown', 'pointermove', 'pointerup'])
            c.addEventListener(
              kind,
              () => {
                native = kind;
              },
              true,
            );
          Object.assign(window, {
            waypointReleaseHookHit: false,
            waypointReleaseHookCaptured: true,
          });
          const change = () => {
            hit = true;
            Object.assign(window, {
              waypointReleaseHookHit: true,
              waypointReleaseHookCaptured: (c as HTMLCanvasElement).hasPointerCapture(1),
            });
            if (action === 'target') {
              const i = document.querySelector(
                '[aria-label="Live group waypoint document X"]',
              ) as HTMLInputElement;
              const old = i.value;
              i.value = '200';
              i.dispatchEvent(new Event('input', { bubbles: true }));
              i.value = old;
              i.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (action === 'source') {
              const i = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              i.value = 'Late source survives';
              i.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              const i = document.querySelector(
                `[aria-label="${action === 'author policy' ? 'Author live group waypoint on release' : 'Drag live group waypoints'}"]`,
              ) as HTMLInputElement;
              i.checked = false;
              i.dispatchEvent(new Event('change', { bubbles: true }));
              i.checked = true;
              i.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(clone, window, [value, ...rest]),
              p = value as Project;
            if (
              !hit &&
              phase !== 'final' &&
              native === (phase === 'initial' ? 'pointerdown' : 'pointerup') &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x ===
                (phase === 'initial' ? 20 : 40)
            )
              change();
            return out;
          }) as typeof clone;
          JSON.stringify = ((...args: Parameters<typeof stringify>) => {
            const out = stringify(...args),
              wrapper = args[0] as { project?: Project },
              p = args[0] as Project;
            if (wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 40)
              prepared = true;
            if (
              !hit &&
              phase === 'final' &&
              native === 'pointerup' &&
              prepared &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 40
            )
              change();
            return out;
          }) as typeof stringify;
        },
        { phase, action },
      );
      const a = await point(page, f.p, 28, 42),
        b = await point(page, f.p, 48, 52);
      await page.mouse.move(a.x + 2, a.y - 1);
      await page.mouse.down();
      if (phase === 'initial') expect(await capture(page)).toBe(false);
      else {
        expect(await capture(page)).toBe(true);
        await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
      }
      await page.mouse.up();
      expect(await capture(page)).toBe(false);
      expect(
        await page.evaluate(
          () => (window as unknown as { waypointReleaseHookHit: boolean }).waypointReleaseHookHit,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { waypointReleaseHookCaptured: boolean })
              .waypointReleaseHookCaptured,
        ),
      ).toBe(false);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Late source survives';
      expect(await f.read()).toEqual(expected);
      if (action === 'source') {
        await expect(f.panel).toHaveCount(0);
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
      } else {
        await page.getByLabel('Author live group waypoint on release').uncheck();
        await drag(page, f.p);
        await expect(f.panel).toBeVisible();
        expect(await f.read()).toEqual(f.p);
        await page.getByLabel('Author live group waypoint on release').check();
        const fresh = await begin(page, f.p);
        await authored(page, f, await fresh.finish());
      }
      expect(f.errors).toEqual([]);
    });
test('direct group waypoint remembered children use detached artwork and preserve library/history', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes[0].groups = ['outer'];
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'member', x: key.shapes[0].x + 30 });
  }
  p.layers[0].liveMotionSpans![0].rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  p.layers[0].liveMotionSpans![0].path = {
    startX: 3,
    startY: 7,
    endX: -2,
    endY: 6,
    waypoints: [
      { x: 20, y: 20 },
      { x: 60, y: 20 },
    ],
  };
  const f = await setup(page, p, 2);
  await page.getByLabel('Live group waypoint remembered children').check();
  await enable(page);
  const g = await begin(page, p, 20, 20);
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, p, 55, 30)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  await authored(page, f, await g.finish());
});
test('direct group waypoint opt-out retains Use target and fresh numeric Commit', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live group waypoints').check();
  await drag(page, f.p);
  await useAndCommit(page, f);
});
test('direct group waypoint Escape restores numeric prior with retained release preference', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 38, 52);
  await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  await enable(page);
  await begin(page, f.p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('38');
  await useAndCommit(page, f);
});
test('direct group waypoint stationary-guard rejection keeps source/history and permits fresh authoring', async ({
  page,
}) => {
  const f = await setup(page, fixture('tangent'));
  await enable(page);
  const a = await point(page, f.p, 28, 42),
    b = await point(page, f.p, 8, 12);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByLabel('Live group waypoint status')).toContainText(
    /stationary|tangent|direction/i,
  );
  expect(await f.read()).toEqual(f.p);
  expect(await capture(page)).toBe(false);
  const fresh = await begin(page, f.p);
  await authored(page, f, await fresh.finish());
});

for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  test(`direct group waypoint rotating ${mode} retains complete membership/settings/history`, async ({
    page,
  }) => {
    const { p } = liveRotationFixture(mode, 'reflected', true);
    p.layers[0].liveMotionSpans![0].path = {
      startX: 3,
      startY: 7,
      endX: -2,
      endY: 6,
      waypoints: [
        { x: 20, y: 30 },
        { x: 60, y: 30 },
      ],
    };
    const f = await setup(page, p);
    await enable(page);
    const g = await begin(page, p, 20, 50);
    await authored(page, f, await g.finish());
  });
test('direct group waypoint uses ordered original member rather than a previous marker', async ({
  page,
}) => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes = [key.shapes[1], key.shapes[0], ...key.shapes.slice(2)];
  const f = await setup(page, p);
  await enable(page);
  const old = await point(page, p, 28, 42);
  await page.mouse.move(old.x, old.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  const g = await begin(page, p, 28, 112);
  await authored(page, f, await g.finish());
});
test('group authoring preference alone cannot capture while numeric preview and Commit remain independent', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Author live group waypoint on release').check();
  const a = await point(page, f.p, 28, 42),
    b = await point(page, f.p, 48, 52);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await numeric(page);
  await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  await page.getByLabel('Author live group waypoint on release').uncheck();
  await page.getByLabel('Author live group waypoint on release').check();
  await expect(
    page.getByRole('button', { name: 'Use group waypoint draft target', exact: true }),
  ).toBeEnabled();
  await useAndCommit(page, f);
});
test('direct group waypoint shows detached artwork and original/proposed markers before one edit', async ({
  page,
}) => {
  const f = await setup(page);
  await enable(page);
  const g = await begin(page, f.p);
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, f.p, 75, 53)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(page, f.p, 49, 43)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, f.p, 48, 52)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  await authored(page, f, await g.finish());
});
