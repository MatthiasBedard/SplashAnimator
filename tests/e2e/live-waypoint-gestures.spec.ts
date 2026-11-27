import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
function fixture(mode = 'straight', basis = 'plain') {
  const p = liveSplitFixture((_p, s) => {
    s.path = {
      startX: 3,
      startY: 7,
      endX: -2,
      endY: 6,
      waypoints: [
        { x: 20, y: 30 },
        { x: 60, y: 30 },
      ],
    };
  });
  p.width = 260;
  p.height = 190;
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
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes.push({
      ...structuredClone(key.shapes[0]),
      id: 'other',
      x: key.shapes[0].x + 40,
      y: key.shapes[0].y + 30,
      fill: '#0000ff',
    });
    if (basis !== 'plain')
      for (const a of key.shapes)
        Object.assign(a, {
          rotation: 25,
          transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          pivot: { x: -100, y: 200 },
        });
  }
  if (basis !== 'plain') p.layers[0].liveMotionSpans![0].options = { affine: true };
  return p;
}
async function setup(page: Page, p = fixture(), at = 4) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (window === window.top && !sessionStorage.getItem('waypoint-gesture-seed')) {
      sessionStorage.setItem('waypoint-gesture-seed', '1');
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
  await page.getByRole('button', { name: 'Edit live waypoint positions…', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Live waypoint positions', exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, canvas, errors, read };
}
async function numeric(page: Page, x = 38, y = 52) {
  await page.getByLabel('Live waypoint document X', { exact: true }).fill(String(x));
  await page.getByLabel('Live waypoint document Y', { exact: true }).fill(String(y));
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
  await expect(page.getByLabel('Live waypoint status', { exact: true })).toContainText('Unapplied');
}
async function useAndCommit(page: Page, f: Awaited<ReturnType<typeof setup>>, index = 0, root = 0) {
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Use waypoint draft target', exact: true }).click();
  const x = Number(await page.getByLabel('Live waypoint document X', { exact: true }).inputValue()),
    y = Number(await page.getByLabel('Live waypoint document Y', { exact: true }).inputValue());
  const expected = structuredClone(f.p),
    origin = f.p.layers[0].keys[0].shapes[root];
  expected.layers[0].liveMotionSpans![0].path!.waypoints =
    expected.layers[0].liveMotionSpans![0].path!.waypoints!.map((q, i) =>
      i === index ? { x: x - origin.x, y: y - origin.y } : q,
    );
  await page.getByRole('button', { name: 'Commit live waypoint', exact: true }).click();
  await expect(f.panel).toHaveCount(0);
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
  return { x, y, expected };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const index of [0, 1])
      test(`waypoint drag ${basis}/root${root}/slot${index} stays unapplied until Use draft and Commit`, async ({
        page,
      }) => {
        const f = await setup(page, fixture('straight', basis));
        await expect(page.getByLabel('Drag live waypoints', { exact: true })).not.toBeChecked();
        if (root) await page.getByLabel('Live waypoint root', { exact: true }).selectOption('1');
        if (index) await page.getByLabel('Live waypoint number', { exact: true }).fill('2');
        const x = 28 + 40 * root + 40 * index,
          y = 42 + 30 * root;
        await page.getByLabel('Drag live waypoints', { exact: true }).check();
        await drag(page, f.p, x, y);
        await expect(page.getByLabel('Live waypoint document X', { exact: true })).toHaveValue(
          String(x),
        );
        await expect(page.getByLabel('Live waypoint document Y', { exact: true })).toHaveValue(
          String(y),
        );
        const out = await useAndCommit(page, f, index, root);
        expect(out.x).toBeCloseTo(x + 20, 5);
        expect(out.y).toBeCloseTo(y + 10, 5);
      });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  test(`waypoint ${mode} canvas draft preserves route metadata and one Undo edit`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(mode));
    await page.getByLabel('Drag live waypoints').check();
    await drag(page, f.p);
    await useAndCommit(page, f);
  });
for (const shift of [false, true])
  test(`waypoint independent CSS axes and pointer offsets with Shift ${shift}`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
    await page.getByLabel('Drag live waypoints').check();
    // Delivered coordinates are the oracle for browser subpixel dispatch.
    await f.canvas.evaluate((c) => {
      const events: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
      Object.assign(window, { waypointEvents: events });
      for (const kind of ['pointerdown', 'pointerup'])
        c.addEventListener(
          kind,
          (e) => {
            const q = e as PointerEvent;
            events[kind === 'pointerdown' ? 'down' : 'up'] = { x: q.clientX, y: q.clientY };
          },
          { once: true },
        );
    });
    await drag(page, f.p, 28, 42, 20, 10, shift);
    const target = await f.canvas.evaluate((c) => {
      const r = c.getBoundingClientRect(),
        canvas = c as HTMLCanvasElement,
        e = (
          window as unknown as {
            waypointEvents: { down: { x: number; y: number }; up: { x: number; y: number } };
          }
        ).waypointEvents;
      return {
        x: 28 + ((e.up.x - e.down.x) * (canvas.width / devicePixelRatio)) / r.width,
        y: 42 + ((e.up.y - e.down.y) * (canvas.height / devicePixelRatio)) / r.height,
      };
    });
    const out = await useAndCommit(page, f);
    expect(out.x).toBeCloseTo(target.x, 9);
    expect(out.y).toBeCloseTo(shift ? 42 : target.y, 9);
  });
test('waypoint markers and detached pose pixels change without writing history', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoints').check();
  await expect.poll(() => pixel(page, f.p, 28, 42)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, f.p, 75, 53)).toEqual([255, 255, 255, 255]);
  await drag(page, f.p);
  await expect.poll(() => pixel(page, f.p, 48, 52)).toEqual([0, 126, 170, 255]);
  await expect.poll(() => pixel(page, f.p, 75, 53)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(page, f.p, 49, 43)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  // Distant proposed markers cannot supply original ownership.
  const q = await point(page, f.p, 48, 52);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await useAndCommit(page, f);
});
for (const cancel of [
  'escape',
  'native',
  'loss',
  'policy',
  'view',
  'discard',
  'zero',
  'return',
] as const)
  test(`waypoint ${cancel} cleans native capture and preserves history`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoints').check();
    const a = await point(page, f.p, 28, 42),
      b = await point(page, f.p, 48, 52);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (cancel !== 'zero') await page.mouse.move(b.x, b.y, { steps: 3 });
    if (cancel === 'return') await page.mouse.move(a.x, a.y);
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'native') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (cancel === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (cancel === 'policy')
      await page.getByLabel('Drag live waypoints').evaluate((c) => {
        const input = c as HTMLInputElement;
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    if (cancel === 'view')
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.9,.8)';
        window.dispatchEvent(new Event('scroll'));
      });
    if (cancel === 'discard')
      await page
        .getByRole('button', { name: 'Discard live waypoint preview', exact: true })
        .evaluate((c) => (c as HTMLButtonElement).click());
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    await expect(
      page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const cancel of ['escape', 'policy', 'view'] as const)
  test(`waypoint ${cancel} restores an independent numeric preview and keeps numeric ownership alive`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page, 38, 52);
    await page.getByRole('button', { name: 'Preview live waypoint', exact: true }).click();
    await expect(page.getByLabel('Live waypoint status')).toContainText('Unapplied');
    await page.getByLabel('Drag live waypoints').check();
    const a = await point(page, f.p, 28, 42),
      b = await point(page, f.p, 58, 62);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'policy')
      await page.getByLabel('Drag live waypoints').evaluate((c) => {
        const input = c as HTMLInputElement;
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    if (cancel === 'view')
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.9,.8)';
        window.dispatchEvent(new Event('scroll'));
      });
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    await expect(page.getByLabel('Live waypoint status')).toContainText('Unapplied');
    await page.getByRole('button', { name: 'Use waypoint draft target', exact: true }).click();
    await expect(page.getByLabel('Live waypoint document X')).toHaveValue('38');
    await expect(page.getByLabel('Live waypoint document Y')).toHaveValue('52');
    const expected = structuredClone(f.p);
    expected.layers[0].liveMotionSpans![0].path!.waypoints = [
      { x: 30, y: 40 },
      { x: 60, y: 30 },
    ];
    await page.getByRole('button', { name: 'Commit live waypoint', exact: true }).click();
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });
for (const action of ['target', 'index', 'root', 'frame', 'close', 'source'] as const)
  test(`active waypoint ${action} change rejects stale native release`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoints').check();
    const a = await point(page, f.p, 28, 42),
      b = await point(page, f.p, 48, 52);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    if (action === 'target')
      await page.getByLabel('Live waypoint document X').evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = '100';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    if (action === 'index')
      await page.getByLabel('Live waypoint number').evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = '2';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
    if (action === 'root')
      await page.getByLabel('Live waypoint root').evaluate((c) => {
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
        .getByRole('button', { name: 'Close live waypoint positions', exact: true })
        .evaluate((c) => (c as HTMLButtonElement).click());
    if (action === 'source')
      await page.getByLabel('Layer name', { exact: true }).evaluate((c) => {
        const i = c as HTMLInputElement;
        i.value = 'Actual waypoint source edit';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Actual waypoint source edit';
    expect(await f.read()).toEqual(expected);
    if (action === 'frame')
      await expect(page.getByText('Frame 6 / 12', { exact: true })).toBeVisible();
    if (action === 'target')
      await expect(page.getByLabel('Live waypoint document X')).toHaveValue('100');
    if (action === 'index') await expect(page.getByLabel('Live waypoint number')).toHaveValue('2');
    if (action === 'root') await expect(page.getByLabel('Live waypoint root')).toHaveValue('1');
    if (action !== 'frame' && action !== 'close' && action !== 'source')
      await expect(
        page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
      ).toBeDisabled();
    if (action === 'source') await expect(f.panel).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
for (const phase of ['initial', 'release'] as const)
  for (const action of ['target', 'policy', 'source'] as const)
    test(`waypoint ${phase} actual ${action} hook rejects ownership and keeps history separate`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.getByLabel('Drag live waypoints').check();
      await f.canvas.evaluate(
        (c, { phase, action }) => {
          const clone = window.structuredClone;
          let hit = false,
            native = '';
          for (const kind of ['pointerdown', 'pointermove', 'pointerup'])
            c.addEventListener(
              kind,
              () => {
                native = kind;
              },
              true,
            );
          Object.assign(window, { waypointHookHit: false, waypointHookCaptured: true });
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(clone, window, [value, ...rest]),
              p = value as Project;
            if (
              !hit &&
              native === (phase === 'initial' ? 'pointerdown' : 'pointerup') &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x ===
                (phase === 'initial' ? 20 : 40)
            ) {
              hit = true;
              Object.assign(window, {
                waypointHookHit: true,
                waypointHookCaptured: (c as HTMLCanvasElement).hasPointerCapture(1),
              });
              if (action === 'target') {
                const i = document.querySelector(
                  '[aria-label="Live waypoint document X"]',
                ) as HTMLInputElement;
                const old = i.value;
                i.value = '200';
                i.dispatchEvent(new Event('input', { bubbles: true }));
                i.value = old;
                i.dispatchEvent(new Event('input', { bubbles: true }));
              }
              if (action === 'policy') {
                const i = document.querySelector(
                  '[aria-label="Drag live waypoints"]',
                ) as HTMLInputElement;
                i.checked = false;
                i.dispatchEvent(new Event('change', { bubbles: true }));
                i.checked = true;
                i.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (action === 'source') {
                const i = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
                i.value = 'Hook changed original';
                i.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return out;
          }) as typeof clone;
        },
        { phase, action },
      );
      const a = await point(page, f.p, 28, 42),
        b = await point(page, f.p, 48, 52);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      if (phase === 'release') {
        expect(await capture(page)).toBe(true);
        await page.mouse.move(b.x, b.y, { steps: 3 });
      } else expect(await capture(page)).toBe(false);
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { waypointHookHit: boolean }).waypointHookHit,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { waypointHookCaptured: boolean }).waypointHookCaptured,
        ),
      ).toBe(false);
      expect(await capture(page)).toBe(false);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Hook changed original';
      expect(await f.read()).toEqual(expected);
      if (action !== 'source') {
        await expect(
          page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
        ).toBeDisabled();
        await drag(page, f.p);
        await useAndCommit(page, f);
      } else {
        await expect(f.panel).toHaveCount(0);
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
      }
      expect(f.errors).toEqual([]);
    });
test('waypoint canvas uses prepared remembered children and exact library/history', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
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
  await page.getByLabel('Live waypoint remembered children').check();
  await page.getByLabel('Drag live waypoints').check();
  await drag(page, p, 20, 20, 20, 10);
  await expect.poll(() => pixel(page, p, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, p, 55, 30)).toEqual([255, 0, 0, 255]);
  await useAndCommit(page, f);
});
test('foreground artwork prevents original waypoint capture', async ({ page }) => {
  const p = fixture(),
    front = structuredClone(p.layers[0]);
  front.id = 'foreground';
  delete front.liveMotionSpans;
  front.keys = [
    {
      frame: 0,
      shapes: [
        {
          ...structuredClone(p.layers[0].keys[0].shapes[0]),
          id: 'cover',
          x: 24,
          y: 38,
          width: 10,
          height: 10,
        },
      ],
    },
  ];
  p.layers.push(front);
  const f = await setup(page, p);
  await page.getByLabel('Drag live waypoints').check();
  const a = await point(page, p, 28, 42);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(page.getByLabel('Live waypoint status')).toContainText('Foreground');
  expect(f.errors).toEqual([]);
});
test('pending waypoint gesture render is cancelled by authoritative numeric input and allows a fresh draft', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoints').check();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    const fonts = document.fonts,
      ready = fonts.ready;
    let release!: (f: FontFaceSet) => void;
    const held = new Promise<FontFaceSet>((r) => {
      release = r;
    });
    Object.assign(window, {
      waypointHeld: false,
      releaseWaypointFonts: () => {
        delete (fonts as unknown as { ready?: unknown }).ready;
        void ready.then(() => release(fonts));
      },
    });
    Object.defineProperty(fonts, 'ready', {
      configurable: true,
      get() {
        Object.assign(window, { waypointHeld: true });
        return held;
      },
    });
  });
  const a = await point(page, f.p, 28, 42),
    b = await point(page, f.p, 48, 52);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { waypointHeld: boolean }).waypointHeld))
    .toBe(true);
  await expect(page.getByLabel('Live waypoint status')).toContainText('Preparing');
  await page.getByLabel('Live waypoint document X').fill('100');
  await page.evaluate(() =>
    (window as unknown as { releaseWaypointFonts: () => void }).releaseWaypointFonts(),
  );
  await expect(
    page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Live waypoint document X')).toHaveValue('100');
  expect(await f.read()).toEqual(f.p);
  expect(await capture(page)).toBe(false);
  await drag(page, f.p);
  await useAndCommit(page, f);
});
test('guarded stationary waypoint drag rejects without history and permits a fresh admitted target', async ({
  page,
}) => {
  const f = await setup(page, fixture('tangent'));
  await page.getByLabel('Drag live waypoints').check();
  const a = await point(page, f.p, 28, 42),
    b = await point(page, f.p, 8, 12);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByLabel('Live waypoint status')).toContainText(
    /stationary|tangent|direction/i,
  );
  expect(await f.read()).toEqual(f.p);
  expect(await capture(page)).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
  ).toBeDisabled();
  await drag(page, f.p);
  await useAndCommit(page, f);
});
test('waypoint Commit keeps numeric authority until Use draft is explicitly chosen', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoints').check();
  await drag(page, f.p);
  await page.getByRole('button', { name: 'Commit live waypoint', exact: true }).click();
  await expect(page.getByLabel('Live waypoint status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live waypoint document X')).toHaveValue('28');
  await useAndCommit(page, f);
});
for (const kind of ['touch', 'nonprimary'] as const)
  test(`waypoint native ${kind} entry cannot take capture or publish`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoints').check();
    const q = await point(page, f.p, 28, 42);
    await f.canvas.evaluate(
      (c, { q, kind }) => {
        c.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 99,
            clientX: q.x,
            clientY: q.y,
            button: 0,
            isPrimary: kind !== 'nonprimary',
            pointerType: kind === 'touch' ? 'touch' : 'pen',
          }),
        );
      },
      { q, kind },
    );
    expect(await capture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Use waypoint draft target', exact: true }),
    ).toBeDisabled();
    expect(f.errors).toEqual([]);
  });
