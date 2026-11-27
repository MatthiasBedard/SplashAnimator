import { expect, test, type Page } from '@playwright/test';
import { liveTreeFixture, createLiveMovieTrees } from '../live-tree-edit-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { treeSplitFixture } from '../live-tree-split-fixture';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
function fixture(basis = 'plain', first = 1, advanced = false) {
  const { p, span } = liveTreeFixture(first, basis);
  const a = structuredClone(p.layers[0].keys[1].shapes),
    b = structuredClone(p.layers[0].keys[2].shapes);
  for (const shape of a) {
    shape.x = 8;
    shape.y = 12;
    shape.rotation = 0;
  }
  for (const shape of b) {
    shape.x = 88;
    shape.y = 12;
    shape.rotation = 0;
  }
  p.width = 320;
  p.height = 240;
  p.fps = 10;
  p.duration = 12;
  p.layers[0].keys = [
    { frame: 0, shapes: a },
    { frame: 8, shapes: b },
    { frame: 10, shapes: [] },
  ];
  span.start = 0;
  span.end = 8;
  span.path = {
    startX: 0,
    startY: 40,
    endX: 0,
    endY: 40,
    ...(advanced ? { distance: true, tangent: true, headingOffset: 10, headingOffsetEnd: 20 } : {}),
  };
  p.frameScripts = [
    { frame: 0, source: "throw new Error('Nested numeric preview must remain script-free')" },
  ];
  return createLiveMovieTrees(p, span);
}
async function setup(page: Page, advanced = false, custom?: Project, at = 4) {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const p = custom ?? fixture('plain', 1, advanced),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('tree-cubic-seed')) {
      sessionStorage.setItem('tree-cubic-seed', 'yes');
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
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit nested movie curve controls…', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Nested movie curve controls', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Nested movie curve document X')).toHaveValue(
    String(
      p.layers
        .find((l) => l.id === 'track')!
        .keys.find(
          (k) => k.frame === p.layers.find((l) => l.id === 'track')!.liveMotionSpans![0].start,
        )!.shapes[0].x + p.layers.find((l) => l.id === 'track')!.liveMotionSpans![0].path!.startX,
    ),
  );
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, read, errors, canvas: page.getByLabel('Drawing stage', { exact: true }) };
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage').evaluate(
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
async function numeric(page: Page, x: number, y: number) {
  await page.getByLabel('Nested movie curve document X').fill(String(x));
  await page.getByLabel('Nested movie curve document Y').fill(String(y));
}

for (const axis of ['X', 'Y'])
  test(`raw curve ${axis} input rejects NaN and permits a corrected fresh commit`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel(`Nested movie curve document ${axis}`).fill('');
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    await expect(page.getByLabel('Nested movie curve status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await numeric(page, -100, 62);
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    const expected = structuredClone(f.p);
    expected.layers[0].liveMotionSpans![0].path!.startX = -108;
    expected.layers[0].liveMotionSpans![0].path!.startY = 50;
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

test('unchanged control cannot add history and stationary guarded targets recover', async ({
  page,
}) => {
  const f = await setup(page, true);
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('unchanged');
  // Distance timing does not change the analytic stationary tangent.
  await numeric(page, 168, 52);
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('tangent');
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  expect((await f.read()).layers[0].liveMotionSpans![0].path).toEqual({
    ...f.p.layers[0].liveMotionSpans![0].path,
    startX: 20,
    startY: 50,
  });
  expect(f.errors).toEqual([]);
});

for (const action of [
  'target-restored',
  'pick-restored',
  'source',
  'frame-restored',
  'close',
] as const)
  test(`late complete curve candidate ${action} cannot publish stale history`, async ({ page }) => {
    const f = await setup(page);
    await numeric(page, 28, 62);
    await page.evaluate((action) => {
      const clone = structuredClone;
      Object.assign(window, { cubicLateHit: false });
      window.structuredClone = <T>(value: T): T => {
        const out = clone(value),
          p = value as Project;
        const w = window as unknown as { cubicLateHit: boolean };
        if (!w.cubicLateHit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) {
          w.cubicLateHit = true;
          if (action === 'target-restored') {
            const el = document.querySelector(
              '[aria-label="Nested movie curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '28']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else if (action === 'pick-restored') {
            const el = document.querySelector(
              '[aria-label="Nested movie curve control"]',
            ) as HTMLSelectElement;
            for (const value of ['1', '0']) {
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (action === 'source') {
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate curve source edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (action === 'frame-restored') {
            for (const title of ['Last frame', 'First frame'])
              (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
            const next = [...document.querySelectorAll('button')].find(
              (e) => e.textContent === 'Next frame',
            )!;
            for (let i = 0; i < 4; i++) next.click();
          } else
            [...document.querySelectorAll('button')]
              .find((e) => e.textContent === 'Close nested movie curve controls')!
              .click();
        }
        return out;
      };
    }, action);
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as unknown as { cubicLateHit: boolean }).cubicLateHit),
    ).toBe(true);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate curve source edit';
    expect(await f.read()).toEqual(expected);
    if (action === 'frame-restored')
      await expect(page.locator('.frame-readout')).toContainText('Frame 5');
    if (await f.panel.count())
      await page
        .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
        .click();
    if (action === 'source') {
      await page.getByTitle('First frame', { exact: true }).click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

for (const action of ['candidate', 'prototype', 'source', 'target-restored', 'reentry'] as const)
  test(`final recovery serialization ${action} retains atomic curve history`, async ({ page }) => {
    const f = await setup(page);
    await numeric(page, 28, 62);
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      Object.assign(window, { cubicFinalHit: false });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          wrapper = args[0] as { project?: Project };
        const w = window as unknown as { cubicFinalHit: boolean };
        if (
          !w.cubicFinalHit &&
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20
        ) {
          w.cubicFinalHit = true;
          if (action === 'candidate') wrapper.project.layers[0].keys[0].shapes[0].x++;
          if (action === 'prototype')
            Object.setPrototypeOf(wrapper.project.layers[0], { late: true });
          if (action === 'source') {
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate final curve edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'target-restored') {
            const el = document.querySelector(
              '[aria-label="Nested movie curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '28']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'reentry')
            [...document.querySelectorAll('button')]
              .find((e) => e.textContent === 'Commit nested movie curve control')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as unknown as { cubicFinalHit: boolean }).cubicFinalHit),
    ).toBe(true);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate final curve edit';
    if (action === 'reentry')
      Object.assign(expected.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
    expect(await f.read()).toEqual(expected);
    if (await f.panel.count())
      await page
        .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
        .click();
    if (action === 'source' || action === 'reentry') {
      await page.getByTitle('First frame', { exact: true }).click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('cloned numeric target accessors reject with zero reads before curve publication', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 28, 62);
  await page.evaluate(() => {
    const clone = structuredClone;
    Object.assign(window, { cubicGetterHit: false, cubicGetterReads: 0 });
    window.structuredClone = <T>(value: T): T => {
      const out = clone(value),
        request = out as unknown as { pick?: { layerId: string }; target?: { x: number } };
      const w = window as unknown as { cubicGetterHit: boolean; cubicGetterReads: number };
      if (!w.cubicGetterHit && request?.pick?.layerId === 'track' && request.target?.x === 28) {
        w.cubicGetterHit = true;
        Object.defineProperty(request.target, 'x', {
          enumerable: true,
          get() {
            w.cubicGetterReads++;
            return 28;
          },
        });
      }
      return out;
    };
  });
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  expect(
    await page.evaluate(() => ({
      hit: (window as unknown as { cubicGetterHit: boolean }).cubicGetterHit,
      reads: (window as unknown as { cubicGetterReads: number }).cubicGetterReads,
    })),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const first of [0, 1, 9998])
    for (const role of ['start', 'end'] as const)
      test(`nested numeric ${basis}/${first}/${role} preview preserves exact keys clocks and one transaction`, async ({
        page,
      }) => {
        const source = fixture(basis, first),
          f = await setup(page, false, source);
        await page
          .getByLabel('Nested movie curve control', { exact: true })
          .selectOption(role === 'start' ? '0' : '1');
        const origin = source.layers[0].keys[role === 'start' ? 0 : 1].shapes[0];
        await numeric(page, origin.x + 20, 62);
        await page
          .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
          .click();
        await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
        const a = basis === 'plain' ? 1 : basis === 'affine' ? 2 : -2,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3,
          x = 55.5 + a * 12 + c * 2,
          y = 45.75 + b * 12 + d * 2;
        await expect.poll(() => pixel(page, source, x, y)).toEqual([255, 0, 0, 255]);
        expect(await f.read()).toEqual(source);
        await page
          .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
          .click();
        await expect(f.panel).toHaveCount(0);
        const out = await f.read(),
          want = structuredClone(source);
        Object.assign(
          want.layers[0].liveMotionSpans![0].path!,
          role === 'start' ? { startX: 20, startY: 50 } : { endX: 20, endY: 50 },
        );
        expect(out).toEqual(want);
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(source);
        await page.keyboard.press('Control+Shift+z');
        expect(await f.read()).toEqual(out);
        await page.reload();
        await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
        expect(await f.read()).toEqual(out);
        expect(f.errors).toEqual([]);
      });

test('numeric nested previews default to gesture opt-out and discarding stays history-free', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(page.getByLabel('Drag nested movie curve controls')).not.toBeChecked();
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  await page
    .getByRole('button', { name: 'Discard nested movie curve preview', exact: true })
    .click();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('28');
  await page
    .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
    .click();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('nested numeric previews evaluate remembered children without changing the original library', async ({
  page,
}) => {
  const p = fixture(),
    ref = livePresentationFixture('movie');
  p.symbols = ref.symbols;
  p.frameScripts = ref.frameScripts;
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.symbolId = 'child';
      shape.width = 160;
      shape.height = 20;
      shape.rotation = 0;
    }
  const f = await setup(page, false, p);
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  // Both stage previews retain the stopped movie first pose. Remembered-child preparation regenerates its stored frame1 from20 to30; it does not advance the authoring clock.
  await page
    .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
    .click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit nested movie curve controls…', exact: true })
    .click();
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  const x = 28.9375,
    y = 38.71875;
  await expect.poll(() => pixel(page, p, x + 25, y + 5)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Nested movie curve remembered children').check();
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, x + 45, y + 5)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, x + 25, y + 5)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('pending Brush blocks nested numeric authoring and retains separate paint history', async ({
  page,
}) => {
  await holdGeometry(page);
  const p = fixture();
  p.layers.unshift({
    ...structuredClone(p.layers[0]),
    id: 'paint',
    name: 'Paint',
    drawingMode: 'merge',
    keys: [{ frame: 0, shapes: [] }],
    liveMotionSpans: undefined,
  });
  const f = await setup(page, false, p, 4);
  await page
    .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
    .click();
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await f.canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit nested movie curve controls…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(p);
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Edit nested movie curve controls…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

for (const bridge of ['loop', 'once', 'single'] as const)
  test(`nested numeric ${bridge} intermediary keeps blank reentry clocks under a paused root`, async ({
    page,
  }) => {
    const p = treeSplitFixture('reflected', bridge);
    p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
    const f = await setup(page, false, p, 4);
    await numeric(page, 180, 150);
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    const out = await f.read(),
      want = structuredClone(p);
    Object.assign(want.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
    expect(out).toEqual(want);
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page
      .getByRole('button', { name: 'Test movie', exact: false })
      .filter({ hasText: 'Ctrl Enter' })
      .click();
    const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
    await d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
    await d.getByRole('button', { name: 'Restart live movie', exact: true }).click();
    let birth = 0,
      was = true;
    for (let tick = 1; tick <= 8; tick++) {
      if (tick === 5) await d.getByRole('button', { name: 'Pause live root', exact: true }).click();
      await d.getByRole('button', { name: 'Step live preview', exact: true }).click();
      await expect(d.getByLabel('Live movie position')).toContainText('Tick ' + tick);
      const parent = (1 + tick) % 5,
        local = bridge === 'single' ? 0 : bridge === 'once' ? Math.min(parent, 3) : parent % 4,
        visible = local !== 2;
      if (visible && !was) birth = tick;
      was = visible;
      const frame = tick >= 5 ? 6 : 2 + tick,
        t = (frame - 2) / 8,
        u = 1 - t,
        angle = (t * Math.PI) / 2,
        px = u * u * u * 160 + 3 * u * u * t * 180 + 3 * u * t * t * 180 + t * t * t * 180,
        py = u * u * u * 100 + 3 * u * u * t * 150 + 3 * u * t * t * 180 + t * t * t * 140,
        x = ((1 + tick - birth) % 3) * 10 + 2,
        a = -2 * x + 1,
        b = 0.25 * x + 6,
        wx = px + Math.cos(angle) * a - Math.sin(angle) * b,
        wy = py + Math.sin(angle) * a + Math.cos(angle) * b;
      expect(
        await d.getByLabel('Live movie interaction', { exact: true }).evaluate(
          (e, { visible, wx, wy }) => {
            const c = e as HTMLCanvasElement,
              ctx = c.getContext('2d')!;
            if (visible)
              return (
                Array.from(ctx.getImageData(Math.floor(wx), Math.floor(wy), 1, 1).data).join(
                  ',',
                ) === '255,0,0,255'
              );
            const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && pixels[i + 3])
                return false;
            return true;
          },
          { visible, wx, wy },
        ),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    expect(await f.read()).toEqual(out);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });

for (const kind of ['members', 'later'] as const)
  test(`nested numeric ${kind} selection uses complete original recipe membership`, async ({
    page,
  }) => {
    const p = fixture();
    if (kind === 'members')
      for (const key of p.layers[0].keys)
        if (key.shapes.length) {
          key.shapes.push({
            ...structuredClone(key.shapes[0]),
            id: 'other',
            x: key.shapes[0].x + 30,
          });
          key.shapes.push({
            ...structuredClone(p.symbols![1].shapes[0]),
            id: 'plain',
            x: 200,
            y: 40,
          });
        }
    if (kind === 'later') {
      const later = structuredClone(p.layers[0]);
      later.id = 'later';
      p.layers.push(later);
    }
    const f = await setup(page, false, p);
    await page.getByLabel('Nested movie curve control', { exact: true }).selectOption('2');
    await numeric(page, 100, 62);
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    const out = await f.read(),
      want = structuredClone(p),
      index = kind === 'later' ? 1 : 0;
    Object.assign(want.layers[index].liveMotionSpans![0].path!, {
      startX: kind === 'later' ? 92 : 62,
      startY: 50,
    });
    expect(out).toEqual(want);
    if (kind === 'members')
      await expect(page.getByText('3 objects', { exact: true })).toBeVisible();
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });

test('legacy root cubic scope stays unavailable for nested movies and explicit numeric controls recover', async ({
  page,
}) => {
  const f = await setup(page);
  await page
    .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
    .click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live curve controls…', exact: true }).click();
  const old = page.getByRole('region', { name: 'Live curve controls', exact: true });
  await expect(old.getByLabel('Live curve status')).toContainText('No original');
  await expect(
    old.getByRole('button', { name: 'Commit live curve control', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await old.getByRole('button', { name: 'Close live curve controls', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit nested movie curve controls…', exact: true })
    .click();
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
async function point(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (c, { p, x, y }) => {
      const canvas = c as HTMLCanvasElement,
        r = c.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 + ((x - p.width / 2) * r.width) / (canvas.width / devicePixelRatio),
        y:
          r.top +
          r.height / 2 +
          ((y - p.height / 2) * r.height) / (canvas.height / devicePixelRatio),
      };
    },
    { p, x, y },
  );
}
for (const scale of [false, true])
  test(`main live cubic drag is history-free with original hits, offsets and CSS scale ${scale}`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (scale)
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.8,.7)';
      });
    await page.getByLabel('Drag nested movie curve controls').check();
    const start = await point(page, f.p, 8, 52),
      end = await point(page, f.p, 28, 62);
    await f.canvas.evaluate((c) => {
      const delivered: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
      Object.assign(window, { cubicDelivered: delivered });
      c.addEventListener(
        'pointerdown',
        (e) => {
          delivered.down = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
        },
        { once: true },
      );
      c.addEventListener(
        'pointerup',
        (e) => {
          delivered.up = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
        },
        { once: true },
      );
    });
    await page.mouse.move(start.x + 2, start.y - 1);
    await page.mouse.down();
    await page.mouse.move(end.x + 2, end.y - 1, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
    await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
    expect(await f.read()).toEqual(f.p);
    // Proposed points cannot capture a new drag, and native release is clean.
    const captured = await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1));
    expect(captured).toBe(false);
    await page
      .getByRole('button', { name: 'Use nested movie curve draft target', exact: true })
      .click();
    const target = await f.canvas.evaluate((c) => {
      const canvas = c as HTMLCanvasElement,
        r = c.getBoundingClientRect();
      const d = (
        window as unknown as {
          cubicDelivered: { down: { x: number; y: number }; up: { x: number; y: number } };
        }
      ).cubicDelivered;
      return {
        x: 8 + ((d.up.x - d.down.x) * (canvas.width / devicePixelRatio)) / r.width,
        y: 52 + ((d.up.y - d.down.y) * (canvas.height / devicePixelRatio)) / r.height,
      };
    });
    expect(Number(await page.getByLabel('Nested movie curve document X').inputValue())).toBe(
      target.x,
    );
    expect(Number(await page.getByLabel('Nested movie curve document Y').inputValue())).toBe(
      target.y,
    );
    await page
      .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
      .click();
    const expected = structuredClone(f.p);
    expected.layers[0].liveMotionSpans![0].path!.startX = target.x - 8;
    expected.layers[0].liveMotionSpans![0].path!.startY = target.y - 12;
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

for (const mode of ['loss', 'cancel', 'target', 'policy', 'frame', 'close'] as const)
  test(`active curve ${mode} cleans native capture without authoring`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag nested movie curve controls').check();
    const start = await point(page, f.p, 8, 52),
      end = await point(page, f.p, 28, 62);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 2 });
    expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      true,
    );
    await page.evaluate((mode) => {
      const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
      if (mode === 'loss') c.releasePointerCapture(1);
      if (mode === 'cancel')
        c.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
      if (mode === 'target') {
        const el = document.querySelector(
          '[aria-label="Nested movie curve document X"]',
        ) as HTMLInputElement;
        el.value = '37';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (mode === 'policy') {
        const el = document.querySelector(
          '[aria-label="Drag nested movie curve controls"]',
        ) as HTMLInputElement;
        el.click();
        el.click();
      }
      if (mode === 'frame')
        (document.querySelector('button[title="First frame"]') as HTMLButtonElement).click();
      if (mode === 'close')
        [...document.querySelectorAll('button')]
          .find((e) => e.textContent === 'Close nested movie curve controls')!
          .click();
    }, mode);
    await page.mouse.up();
    await expect
      .poll(() => f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1)))
      .toBe(false);
    expect(await f.read()).toEqual(f.p);
    if (mode === 'target')
      await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('37');
    expect(f.errors).toEqual([]);
  });

for (const phase of ['initial', 'release'] as const)
  test(`actual ${phase} restored gesture policy rejects captured curve work and permits fresh retry`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag nested movie curve controls').check();
    const start = await point(page, f.p, 8, 52),
      end = await point(page, f.p, 28, 62);
    const hook = async () =>
      page.evaluate((phase) => {
        const clone = structuredClone;
        Object.assign(window, { cubicPolicyHit: false });
        window.structuredClone = <T>(value: T): T => {
          const out = clone(value),
            p = value as Project,
            w = window as unknown as { cubicPolicyHit: boolean };
          const path = p?.layers?.[0]?.liveMotionSpans?.[0]?.path;
          if (!w.cubicPolicyHit && path && (phase === 'initial' || path.startX === 20)) {
            w.cubicPolicyHit = true;
            const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
            if (phase === 'release' && c.hasPointerCapture(1))
              throw Error('release preparation still owns native capture');
            const el = document.querySelector(
              '[aria-label="Drag nested movie curve controls"]',
            ) as HTMLInputElement;
            el.click();
            el.click();
          }
          return out;
        };
      }, phase);
    if (phase === 'initial') await hook();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (phase === 'release') {
      await page.mouse.move(end.x, end.y, { steps: 2 });
      await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
      await hook();
    }
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as unknown as { cubicPolicyHit: boolean }).cubicPolicyHit),
    ).toBe(true);
    expect(await f.read()).toEqual(f.p);
    await expect
      .poll(() => f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1)))
      .toBe(false);
    // Hook runs once; both policies are restored but their revision expired work.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 2 });
    await page.mouse.up();
    await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('actual curve input bursts defer complete-project cloning until the latest display task', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag nested movie curve controls').check();
  const start = await point(page, f.p, 8, 52);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const result = await f.canvas.evaluate(async (c) => {
    const clone = structuredClone;
    let count = 0;
    window.structuredClone = <T>(value: T): T => {
      if ((value as Project)?.layers && (value as Project)?.duration) count++;
      return clone(value);
    };
    const r = c.getBoundingClientRect(),
      canvas = c as HTMLCanvasElement;
    const x = r.left + r.width / 2 + ((8 - 80) * r.width) / (canvas.width / devicePixelRatio),
      y = r.top + r.height / 2 + ((52 - 50) * r.height) / (canvas.height / devicePixelRatio);
    for (let i = 1; i <= 1000; i++) {
      c.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'mouse',
          buttons: 1,
          clientX: x + i * 0.02,
          clientY: y + i * 0.01,
        }),
      );
      await Promise.resolve();
    }
    const beforeFrame = count;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { beforeFrame, afterFrame: count };
  });
  expect(result.beforeFrame).toBe(0);
  expect(result.afterFrame).toBeGreaterThan(0);
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('numeric preview lifetime is independent of gesture preferences', async ({ page }) => {
  const f = await setup(page);
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  await page.getByLabel('Drag nested movie curve controls').check();
  await page.getByLabel('Drag nested movie curve controls').uncheck();
  await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const role of ['start', 'end'] as const)
    test(`nested canvas ${basis}/${role} original hits preserve temporary pixels and explicit commit`, async ({
      page,
    }) => {
      const p = fixture(basis),
        f = await setup(page, false, p);
      await page
        .getByLabel('Nested movie curve control', { exact: true })
        .selectOption(role === 'start' ? '0' : '1');
      await page.getByLabel('Drag nested movie curve controls').check();
      const ox = role === 'start' ? 8 : 88,
        start = await point(page, p, ox, 52),
        end = await point(page, p, ox + 20, 62);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 6 });
      await page.mouse.up();
      await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
      await expect(page.getByLabel('Nested movie curve document X')).toHaveValue(String(ox));
      const a = basis === 'plain' ? 1 : basis === 'affine' ? 2 : -2,
        b = basis === 'plain' ? 0 : 0.25,
        c = basis === 'plain' ? 0 : 0.5,
        d = basis === 'plain' ? 1 : 3;
      await expect
        .poll(() => pixel(page, p, 55.5 + a * 12 + c * 2, 45.75 + b * 12 + d * 2))
        .toEqual([255, 0, 0, 255]);
      expect(await f.read()).toEqual(p);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.move(end.x, end.y);
      await page.mouse.down();
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      expect(await f.read()).toEqual(p);
      await page
        .getByRole('button', { name: 'Use nested movie curve draft target', exact: true })
        .click();
      await expect(page.getByLabel('Nested movie curve document X')).toHaveValue(String(ox + 20));
      await expect(page.getByLabel('Nested movie curve document Y')).toHaveValue('62');
      await page
        .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
        .click();
      const want = structuredClone(p);
      Object.assign(
        want.layers[0].liveMotionSpans![0].path!,
        role === 'start' ? { startX: 20, startY: 50 } : { endX: 20, endY: 50 },
      );
      expect(await f.read()).toEqual(want);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await f.read()).toEqual(p);
      expect(f.errors).toEqual([]);
    });
for (const mode of ['escape', 'return'] as const)
  test(`nested canvas ${mode} restores a valid independent numeric preview`, async ({ page }) => {
    const f = await setup(page);
    await numeric(page, 28, 62);
    await page
      .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
      .click();
    await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
    await page.getByLabel('Drag nested movie curve controls').check();
    const start = await point(page, f.p, 8, 52),
      end = await point(page, f.p, 48, 72);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
    if (mode === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.move(start.x, start.y);
    await page.mouse.up();
    await expect.poll(() => pixel(page, f.p, 67, 47)).toEqual([255, 0, 0, 255]);
    await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('28');
    expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('nested canvas foreground ownership blocks original handles', async ({ page }) => {
  const p = fixture();
  p.layers.push({
    id: 'foreign',
    name: 'Foreign',
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [
      {
        frame: 0,
        shapes: [
          {
            ...structuredClone(p.symbols![1].shapes[0]),
            id: 'cover',
            x: 5,
            y: 49,
            width: 8,
            height: 8,
            fill: '#0000ff',
          },
        ],
      },
    ],
  });
  const f = await setup(page, false, p);
  await page.getByLabel('Drag nested movie curve controls').check();
  const start = await point(page, p, 8, 52);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Foreground');
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

for (const phase of ['initial', 'release'] as const)
  for (const action of ['source', 'target', 'view'] as const)
    test(`nested canvas ${phase} actual ${action} rejection preserves cleanup and fresh retry`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.getByLabel('Drag nested movie curve controls').check();
      const start = await point(page, f.p, 8, 52),
        end = await point(page, f.p, 28, 62);
      const hook = () =>
        page.evaluate(
          ({ phase, action }) => {
            const clone = structuredClone;
            Object.assign(window, { nestedCaptureHit: false });
            window.structuredClone = <T>(v: T) => {
              const out = clone(v),
                p = v as Project,
                w = window as unknown as { nestedCaptureHit: boolean };
              if (
                !w.nestedCaptureHit &&
                p?.layers?.[0]?.liveMotionSpans?.[0]?.path &&
                (phase === 'initial' || p.layers[0].liveMotionSpans[0].path!.startX === 20)
              ) {
                w.nestedCaptureHit = true;
                const c = document.querySelector(
                  '[aria-label="Drawing stage"]',
                ) as HTMLCanvasElement;
                if (phase === 'release' && c.hasPointerCapture(1))
                  throw Error('Release still owns capture');
                if (action === 'source') {
                  const el = document.querySelector(
                    '[aria-label="Layer name"]',
                  ) as HTMLInputElement;
                  el.value = 'Separate nested source edit';
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (action === 'target') {
                  const el = document.querySelector(
                    '[aria-label="Nested movie curve document X"]',
                  ) as HTMLInputElement;
                  for (const value of ['999', '8']) {
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                }
                if (action === 'view') {
                  const old = c.getBoundingClientRect().width;
                  c.style.width = old * 0.9 + 'px';
                  if (c.getBoundingClientRect().width === old) throw Error('View did not change');
                }
              }
              return out;
            };
          },
          { phase, action },
        );
      if (phase === 'initial') await hook();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (phase === 'release') {
        await page.mouse.move(end.x, end.y, { steps: 2 });
        await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
        await hook();
      }
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { nestedCaptureHit: boolean }).nestedCaptureHit,
        ),
      ).toBe(true);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      const want = structuredClone(f.p);
      if (action === 'source') want.layers[0].name = 'Separate nested source edit';
      expect(await f.read()).toEqual(want);
      if (await f.panel.count())
        await page
          .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
          .click();
      if (action === 'source') {
        await page.getByTitle('First frame', { exact: true }).click();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.p);
      }
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page
        .getByRole('button', { name: 'Edit nested movie curve controls…', exact: true })
        .click();
      await page.getByLabel('Drag nested movie curve controls').check();
      const fresh = await point(page, f.p, 8, 52),
        finish = await point(page, f.p, 28, 62);
      await page.mouse.move(fresh.x, fresh.y);
      await page.mouse.down();
      await page.mouse.move(finish.x, finish.y, { steps: 2 });
      await page.mouse.up();
      await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('nested canvas remembered-child drag retains stopped origins and exact library through commit', async ({
  page,
}) => {
  const p = fixture(),
    ref = livePresentationFixture('movie');
  p.symbols = ref.symbols;
  p.frameScripts = ref.frameScripts;
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.symbolId = 'child';
      shape.width = 160;
      shape.height = 20;
      shape.rotation = 0;
    }
  const f = await setup(page, false, p, 2);
  await page.getByLabel('Nested movie curve remembered children').check();
  await page.getByLabel('Drag nested movie curve controls').check();
  const start = await point(page, p, 8, 52),
    end = await point(page, p, 48, 72);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 82.375, 47.9375)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(p);
  await page
    .getByRole('button', { name: 'Use nested movie curve draft target', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  const want = structuredClone(p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, { startX: 40, startY: 60 });
  expect(await f.read()).toEqual(want);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

async function enableRelease(page: Page) {
  await page.getByLabel('Drag nested movie curve controls', { exact: true }).check();
  await page.getByLabel('Author nested movie curve on release', { exact: true }).check();
}
async function releasePositions(
  page: Page,
  p: Project,
  role: 'start' | 'end' = 'start',
  scale = false,
  shift = false,
) {
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  if (scale)
    await canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
  const ox = role === 'start' ? 8 : 88,
    start = await point(page, p, ox, 52),
    end = await point(page, p, ox + 20, 62);
  await canvas.evaluate((c) => {
    const data: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
    Object.assign(window, { nestedReleaseDelivered: data });
    for (const kind of ['pointerdown', 'pointerup'] as const)
      c.addEventListener(
        kind,
        (e) => {
          const p = e as PointerEvent;
          data[kind === 'pointerdown' ? 'down' : 'up'] = { x: p.clientX, y: p.clientY };
        },
        { once: true },
      );
  });
  await page.mouse.move(start.x + 2, start.y - 1);
  await page.mouse.down();
  expect(await canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(end.x + 2, end.y - 1, { steps: 4 });
  return {
    ox,
    start,
    end,
    finish: async () => {
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      return canvas.evaluate(
        (c, { ox, shift }) => {
          const canvas = c as HTMLCanvasElement,
            r = canvas.getBoundingClientRect(),
            d = (
              window as unknown as {
                nestedReleaseDelivered: {
                  down: { x: number; y: number };
                  up: { x: number; y: number };
                };
              }
            ).nestedReleaseDelivered;
          let dx = ((d.up.x - d.down.x) * (canvas.width / devicePixelRatio)) / r.width,
            dy = ((d.up.y - d.down.y) * (canvas.height / devicePixelRatio)) / r.height;
          if (shift) {
            if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          return { x: ox + dx, y: 52 + dy };
        },
        { ox, shift },
      );
    },
  };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const role of ['start', 'end'] as const)
    test(`direct nested release ${basis}/${role} authors one exact persistent edit with native cleanup`, async ({
      page,
    }) => {
      const p = fixture(basis),
        f = await setup(page, false, p);
      await expect(page.getByLabel('Author nested movie curve on release')).not.toBeChecked();
      await page
        .getByLabel('Nested movie curve control', { exact: true })
        .selectOption(role === 'start' ? '0' : '1');
      await enableRelease(page);
      const g = await releasePositions(page, p, role);
      const a = basis === 'plain' ? 1 : basis === 'affine' ? 2 : -2,
        b = basis === 'plain' ? 0 : 0.25,
        c = basis === 'plain' ? 0 : 0.5,
        d = basis === 'plain' ? 1 : 3;
      await expect
        .poll(() => pixel(page, p, 55.5 + a * 12 + c * 2, 45.75 + b * 12 + d * 2))
        .toEqual([255, 0, 0, 255]);
      expect(await f.read()).toEqual(p);
      const target = await g.finish(),
        want = structuredClone(p);
      Object.assign(
        want.layers[0].liveMotionSpans![0].path!,
        role === 'start'
          ? { startX: target.x - g.ox, startY: target.y - 12 }
          : { endX: target.x - g.ox, endY: target.y - 12 },
      );
      await expect(f.panel).toBeHidden();
      expect(await f.read()).toEqual(want);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(want);
      expect(f.errors).toEqual([]);
    });
for (const shift of [false, true])
  test(`direct nested release independent CSS axes/offsets and Shift ${shift}`, async ({
    page,
  }) => {
    const f = await setup(page);
    await enableRelease(page);
    const g = await releasePositions(page, f.p, 'start', true, shift);
    expect(await f.read()).toEqual(f.p);
    const target = await g.finish(),
      want = structuredClone(f.p);
    Object.assign(want.layers[0].liveMotionSpans![0].path!, {
      startX: target.x - 8,
      startY: target.y - 12,
    });
    await expect(f.panel).toBeHidden();
    expect(await f.read()).toEqual(want);
    if (shift) expect(target.y).toBe(52);
    expect(f.errors).toEqual([]);
  });
for (const mode of [
  'zero',
  'return',
  'escape',
  'loss',
  'cancel',
  'foreign',
  'target',
  'pick',
  'frame',
  'close',
  'author policy',
  'gesture policy',
] as const)
  test(`direct nested release ${mode} rejects stale or cancelled native work`, async ({ page }) => {
    const f = await setup(page);
    await enableRelease(page);
    const start = await point(page, f.p, 8, 52),
      end = await point(page, f.p, 28, 62);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    if (mode !== 'zero') await page.mouse.move(end.x, end.y, { steps: 3 });
    if (mode === 'return') await page.mouse.move(start.x, start.y, { steps: 3 });
    if (mode === 'escape') await page.keyboard.press('Escape');
    await page.evaluate((mode) => {
      const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
      if (mode === 'loss') c.releasePointerCapture(1);
      if (mode === 'cancel')
        c.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
      if (mode === 'foreign')
        c.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, pointerId: 99, clientX: 1, clientY: 1 }),
        );
      if (mode === 'target') {
        const el = document.querySelector(
          '[aria-label="Nested movie curve document X"]',
        ) as HTMLInputElement;
        el.value = '999';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (mode === 'pick') {
        const el = document.querySelector(
          '[aria-label="Nested movie curve control"]',
        ) as HTMLSelectElement;
        el.value = '1';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (mode === 'frame')
        (document.querySelector('button[title="First frame"]') as HTMLButtonElement).click();
      if (mode === 'close')
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent === 'Close nested movie curve controls')!
          .click();
      if (mode === 'author policy' || mode === 'gesture policy') {
        const el = document.querySelector(
          `[aria-label="${mode === 'author policy' ? 'Author nested movie curve on release' : 'Drag nested movie curve controls'}"]`,
        ) as HTMLInputElement;
        el.click();
        el.click();
      }
    }, mode);
    if (mode === 'foreign') {
      expect(await f.read()).toEqual(f.p);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        true,
      );
      await page.keyboard.press('Escape');
    }
    await page.mouse.up();
    expect(await f.read()).toEqual(f.p);
    expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    if (mode === 'target')
      await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('999');
    expect(f.errors).toEqual([]);
  });
for (const phase of ['initial', 'release', 'final', 'last'] as const)
  for (const policy of ['author', 'gesture'] as const)
    test(`direct nested release ${phase} restored ${policy} policy rejects and permits draft/author retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await enableRelease(page);
      const start = await point(page, f.p, 8, 52),
        end = await point(page, f.p, 28, 62);
      const hook = () =>
        page.evaluate(
          ({ phase, policy }) => {
            const clone = structuredClone,
              stringify = JSON.stringify;
            let hit = false,
              recoverySeen = false,
              finalReads = 0;
            const act = () => {
              hit = true;
              Object.assign(window, { nestedReleasePolicyHit: true });
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              if (phase !== 'initial' && c.hasPointerCapture(1))
                throw Error('release preparation retained native capture');
              const el = document.querySelector(
                `[aria-label="${policy === 'author' ? 'Author nested movie curve on release' : 'Drag nested movie curve controls'}"]`,
              ) as HTMLInputElement;
              el.click();
              el.click();
            };
            Object.assign(window, { nestedReleasePolicyHit: false });
            if (phase === 'final' || phase === 'last')
              JSON.stringify = ((...args: Parameters<typeof stringify>) => {
                const out = stringify(...args),
                  p = (args[0] as { project?: Project })?.project;
                if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) {
                  if (phase === 'final') act();
                  else recoverySeen = true;
                }
                const direct = args[0] as Project;
                if (
                  !hit &&
                  phase === 'last' &&
                  recoverySeen &&
                  direct?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20 &&
                  ++finalReads === 2
                )
                  act();
                return out;
              }) as typeof stringify;
            else
              window.structuredClone = <T>(value: T) => {
                const out = clone(value),
                  p = value as Project;
                if (
                  !hit &&
                  p?.layers?.[0]?.liveMotionSpans?.[0]?.path &&
                  (phase === 'initial' || p.layers[0].liveMotionSpans[0].path!.startX === 20)
                )
                  act();
                return out;
              };
          },
          { phase, policy },
        );
      if (phase === 'initial') await hook();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (phase !== 'initial') {
        await page.mouse.move(end.x, end.y, { steps: 3 });
        await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
        await hook();
      }
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { nestedReleasePolicyHit: boolean }).nestedReleasePolicyHit,
        ),
      ).toBe(true);
      expect(await f.read()).toEqual(f.p);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.getByLabel('Author nested movie curve on release').uncheck();
      const draft = await releasePositions(page, f.p);
      await draft.finish();
      await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author nested movie curve on release').check();
      const retry = await releasePositions(page, f.p),
        target = await retry.finish(),
        want = structuredClone(f.p);
      Object.assign(want.layers[0].liveMotionSpans![0].path!, {
        startX: target.x - 8,
        startY: target.y - 12,
      });
      await expect(f.panel).toBeHidden();
      expect(await f.read()).toEqual(want);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });
test('direct nested release keeps numeric preview lifetime independent and restores it on Escape', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 48, 72);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await enableRelease(page);
  await releasePositions(page, f.p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('48');
  expect(f.errors).toEqual([]);
});
test('direct nested release preserves prepared remembered-child pixels, exact library and one history edit', async ({
  page,
}) => {
  const p = fixture(),
    ref = livePresentationFixture('movie');
  p.symbols = ref.symbols;
  p.frameScripts = ref.frameScripts;
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.symbolId = 'child';
      shape.width = 160;
      shape.height = 20;
      shape.rotation = 0;
    }
  const f = await setup(page, false, p, 2);
  await page.getByLabel('Nested movie curve remembered children').check();
  await enableRelease(page);
  const start = await point(page, p, 8, 52),
    end = await point(page, p, 48, 72);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await expect.poll(() => pixel(page, p, 82.375, 47.9375)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(p);
  await page.mouse.up();
  const want = structuredClone(p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, { startX: 40, startY: 60 });
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(want);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await f.read()).toEqual(want);
  expect(f.errors).toEqual([]);
});
for (const phase of ['release', 'last'] as const)
  for (const action of ['source', 'target', 'view'] as const)
    test(`direct nested release ${phase} actual ${action} after detached candidate rejects publication`, async ({
      page,
    }) => {
      const f = await setup(page);
      await enableRelease(page);
      const start = await point(page, f.p, 8, 52),
        end = await point(page, f.p, 28, 62);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 3 });
      await expect(page.getByLabel('Nested movie curve status')).toContainText('Unapplied');
      await page.evaluate(
        ({ phase, action }) => {
          const clone = structuredClone,
            stringify = JSON.stringify;
          let hit = false,
            seen = false,
            reads = 0;
          Object.assign(window, { nestedReleaseActualHit: false });
          const act = () => {
            hit = true;
            Object.assign(window, { nestedReleaseActualHit: true });
            const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
            if (c.hasPointerCapture(1))
              throw Error('Native capture still held after detached release preparation');
            if (action === 'source') {
              const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              el.value = 'Independent released source edit';
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'target') {
              const el = document.querySelector(
                '[aria-label="Nested movie curve document X"]',
              ) as HTMLInputElement;
              for (const value of ['999', '8']) {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'view') {
              const width = c.getBoundingClientRect().width;
              c.style.width = width * 0.9 + 'px';
              if (c.getBoundingClientRect().width === width)
                throw Error('Canvas view did not change');
            }
          };
          if (phase === 'release')
            window.structuredClone = <T>(value: T) => {
              const out = clone(value),
                p = value as Project;
              if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) act();
              return out;
            };
          else
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args),
                wrapper = args[0] as { project?: Project },
                p = args[0] as Project;
              if (wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20)
                seen = true;
              if (
                !hit &&
                seen &&
                p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20 &&
                ++reads === 2
              )
                act();
              return out;
            }) as typeof stringify;
        },
        { phase, action },
      );
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { nestedReleaseActualHit: boolean }).nestedReleaseActualHit,
        ),
      ).toBe(true);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      const want = structuredClone(f.p);
      if (action === 'source') want.layers[0].name = 'Independent released source edit';
      expect(await f.read()).toEqual(want);
      if (action === 'source') {
        if (await f.panel.count())
          await page
            .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
            .click();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        expect(await f.read()).toEqual(want);
      } else {
        if (action === 'target')
          await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('8');
        const g = await releasePositions(page, f.p),
          target = await g.finish(),
          authored = structuredClone(f.p);
        Object.assign(authored.layers[0].liveMotionSpans![0].path!, {
          startX: target.x - 8,
          startY: target.y - 12,
        });
        await expect(f.panel).toBeHidden();
        expect(await f.read()).toEqual(authored);
      }
      expect(f.errors).toEqual([]);
    });
test('direct nested release restored author policy during publication restores an independent numeric preview', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 48, 72);
  await page
    .getByRole('button', { name: 'Preview nested movie curve control', exact: true })
    .click();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await enableRelease(page);
  const g = await releasePositions(page, f.p);
  await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let hit = false;
    Object.assign(window, { nestedPriorReleaseHit: false });
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const out = stringify(...args),
        p = (args[0] as { project?: Project })?.project;
      if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) {
        hit = true;
        Object.assign(window, { nestedPriorReleaseHit: true });
        const el = document.querySelector(
          '[aria-label="Author nested movie curve on release"]',
        ) as HTMLInputElement;
        el.click();
        el.click();
      }
      return out;
    }) as typeof stringify;
  });
  await g.finish();
  expect(
    await page.evaluate(
      () => (window as unknown as { nestedPriorReleaseHit: boolean }).nestedPriorReleaseHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await expect(page.getByLabel('Nested movie curve document X')).toHaveValue('48');
  const retry = await releasePositions(page, f.p),
    target = await retry.finish(),
    want = structuredClone(f.p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, {
    startX: target.x - 8,
    startY: target.y - 12,
  });
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(want);
  expect(f.errors).toEqual([]);
});
test('direct nested release retains explicit distance/tangent/heading options and exact authored endpoints', async ({
  page,
}) => {
  const p = fixture('plain', 1, true),
    f = await setup(page, false, p);
  await enableRelease(page);
  const g = await releasePositions(page, p),
    target = await g.finish(),
    want = structuredClone(p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, {
    startX: target.x - 8,
    startY: target.y - 12,
  });
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(want);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});
test('direct nested release author preference alone cannot capture and numeric Commit stays independent', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Author nested movie curve on release').check();
  const start = await point(page, f.p, 8, 52),
    end = await point(page, f.p, 28, 62);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 28, 62);
  await page
    .getByRole('button', { name: 'Commit nested movie curve control', exact: true })
    .click();
  await expect(f.panel).toBeHidden();
  const want = structuredClone(f.p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
  expect(await f.read()).toEqual(want);
  expect(f.errors).toEqual([]);
});
