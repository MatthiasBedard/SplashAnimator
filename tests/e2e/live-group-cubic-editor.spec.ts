import { expect, test, type Page } from '@playwright/test';
import { liveRotationFixture } from '../live-motion-rotation-fixture';
import type { LiveMotionSpan } from '../../packages/document/src';
function groupFixture(change?: (p: Project, span: LiveMotionSpan) => void) {
  const { p } = liveRotationFixture('rigid', 'plain', true);
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x += 8;
      shape.y -= 8;
      shape.opacity = 1;
      shape.width = 20;
      shape.height = 20;
    }
  const span = p.layers[0].liveMotionSpans![0];
  change?.(p, span);
  return p;
}
import type { Project } from '../../packages/document/src';
import { livePresentationFixture } from '../live-motion-presentation-fixture';

async function setup(page: Page, advanced = false, custom?: Project, at = 4, handles = true) {
  const p =
    custom ??
    groupFixture((_p, span) => {
      span.path = {
        startX: 0,
        startY: 40,
        endX: 0,
        endY: 40,
        ...(advanced
          ? { distance: true, tangent: true, headingOffset: 10, headingOffsetEnd: 20 }
          : {}),
      };
    });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-group-cubic-seed')) {
      sessionStorage.setItem('live-group-cubic-seed', '1');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.focus();
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live group curve controls…', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Live group curve controls', exact: true });
  await expect(panel).toBeVisible();
  if (handles)
    await expect(panel.getByLabel('Live group curve document X')).toHaveValue(
      String(p.layers[0].keys[0].shapes[0].x + p.layers[0].liveMotionSpans![0].path!.startX),
    );
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, read, errors, canvas: page.getByLabel('Drawing stage', { exact: true }) };
}
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
  await page.getByLabel('Live group curve document X').fill(String(x));
  await page.getByLabel('Live group curve document Y').fill(String(y));
}

test('main live cubic numeric preview changes real pixels and freshly commits one exact history transaction', async ({
  page,
}) => {
  const f = await setup(page);
  await expect.poll(() => pixel(page, f.p, 50, 46)).toEqual([255, 0, 0, 255]);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, f.p, 50, 46)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, f.p, 66, 58)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  await expect(f.panel).toHaveCount(0);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].path!.startX = 20;
  expected.layers[0].liveMotionSpans![0].path!.startY = 50;
  expect(await f.read()).toEqual(expected);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

for (const scale of [false, true])
  test(`main live cubic drag is history-free with original hits, offsets and CSS scale ${scale}`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (scale)
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.8,.7)';
      });
    await page.getByLabel('Drag live group curve controls').check();
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
    await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
    await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
    expect(await f.read()).toEqual(f.p);
    // Proposed points cannot capture a new drag, and native release is clean.
    const captured = await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1));
    expect(captured).toBe(false);
    await page.getByRole('button', { name: 'Use group curve draft target', exact: true }).click();
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
    expect(Number(await page.getByLabel('Live group curve document X').inputValue())).toBe(
      target.x,
    );
    expect(Number(await page.getByLabel('Live group curve document Y').inputValue())).toBe(
      target.y,
    );
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
      .click();
    const expected = structuredClone(f.p);
    expected.layers[0].liveMotionSpans![0].path!.startX = target.x - 8;
    expected.layers[0].liveMotionSpans![0].path!.startY = target.y - 12;
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

for (const role of ['start', 'end'] as const)
  test(`numeric ${role} controls preserve advanced heading and distance metadata`, async ({
    page,
  }) => {
    const f = await setup(page, true);
    await page
      .getByLabel('Live group curve control', { exact: true })
      .selectOption(role === 'start' ? '0' : '1');
    await numeric(page, role === 'start' ? 28 : 108, 62);
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
      .click();
    const expected = structuredClone(f.p),
      path = expected.layers[0].liveMotionSpans![0].path!;
    if (role === 'start') {
      path.startX = 20;
      path.startY = 50;
    } else {
      path.endX = 20;
      path.endY = 50;
    }
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

test('Escape restores an independent numeric preview and source history stays untouched', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  await page.getByLabel('Drag live group curve controls').check();
  const start = await point(page, f.p, 8, 52),
    end = await point(page, f.p, 38, 72);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live group curve document X')).toHaveValue('28');
  await page.getByRole('button', { name: 'Close live group curve controls', exact: true }).click();
  expect(f.errors).toEqual([]);
});

for (const mode of ['multiple', 'affine', 'reflected'] as const)
  test(`main curve numeric commit preserves complete ${mode} artwork and selections`, async ({
    page,
  }) => {
    const p = groupFixture((_p, s) => {
      s.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
    });
    for (const key of p.layers[0].keys.slice(0, 2))
      for (const shape of key.shapes) {
        if (mode !== 'multiple')
          Object.assign(shape, {
            rotation: shape.rotation + 25,
            transform: [mode === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
            pivot: { x: -100, y: 40 },
          });
      }
    const f = await setup(page, false, p);
    // The additional leader owns the same complete original trajectory.
    await page.getByLabel('Live group curve control', { exact: true }).selectOption('2');
    await numeric(page, 188, 162);
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
      .click();
    const expected = structuredClone(p);
    expected.layers[0].liveMotionSpans![0].path!.startX = 20;
    expected.layers[0].liveMotionSpans![0].path!.startY = 50;
    expect(await f.read()).toEqual(expected);
    await expect(
      page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(f.errors).toEqual([]);
  });

for (const axis of ['X', 'Y'])
  test(`raw curve ${axis} input rejects NaN and permits a corrected fresh commit`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel(`Live group curve document ${axis}`).fill('');
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
      .click();
    await expect(page.getByLabel('Live group curve status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await numeric(page, -100, 62);
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
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
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('unchanged');
  // Distance timing does not change the analytic stationary tangent.
  await numeric(page, 168, 52);
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('tangent');
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
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
              '[aria-label="Live group curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '28']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else if (action === 'pick-restored') {
            const el = document.querySelector(
              '[aria-label="Live group curve control"]',
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
              .find((e) => e.textContent === 'Close live group curve controls')!
              .click();
        }
        return out;
      };
    }, action);
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
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
        .getByRole('button', { name: 'Close live group curve controls', exact: true })
        .click();
    if (action === 'source') {
      await page.getByTitle('First frame', { exact: true }).click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

for (const mode of ['loss', 'cancel', 'target', 'policy', 'frame', 'close'] as const)
  test(`active curve ${mode} cleans native capture without authoring`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live group curve controls').check();
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
          '[aria-label="Live group curve document X"]',
        ) as HTMLInputElement;
        el.value = '37';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (mode === 'policy') {
        const el = document.querySelector(
          '[aria-label="Drag live group curve controls"]',
        ) as HTMLInputElement;
        el.click();
        el.click();
      }
      if (mode === 'frame')
        (document.querySelector('button[title="First frame"]') as HTMLButtonElement).click();
      if (mode === 'close')
        [...document.querySelectorAll('button')]
          .find((e) => e.textContent === 'Close live group curve controls')!
          .click();
    }, mode);
    await page.mouse.up();
    await expect
      .poll(() => f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1)))
      .toBe(false);
    expect(await f.read()).toEqual(f.p);
    if (mode === 'target')
      await expect(page.getByLabel('Live group curve document X')).toHaveValue('37');
    expect(f.errors).toEqual([]);
  });

test('prepared remembered child pixels coexist with changed live root without altering library or origins', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes[0].groups = ['outer'];
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'member', x: key.shapes[0].x + 30 });
  }
  p.layers[0].liveMotionSpans![0].rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 20, endX: 0, endY: 20 };
  const f = await setup(page, false, p, 2);
  await page.getByLabel('Live group curve remembered children').check();
  await numeric(page, 20, 30);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  // Exposure begins at1. Current authored child endpoint is120, so its
  // regenerated frame1 is30, rather than stored20 or root-relative frame2=60.
  await expect.poll(() => pixel(page, p, 25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, p, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 55, 25)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

for (const phase of ['initial', 'release'] as const)
  test(`actual ${phase} restored gesture policy rejects captured curve work and permits fresh retry`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live group curve controls').check();
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
              '[aria-label="Drag live group curve controls"]',
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
      await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
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
    await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('actual curve input bursts defer complete-project cloning until the latest display task', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live group curve controls').check();
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
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('numeric preview lifetime is independent of gesture preferences', async ({ page }) => {
  const f = await setup(page);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  await page.getByLabel('Drag live group curve controls').check();
  await page.getByLabel('Drag live group curve controls').uncheck();
  await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('foreign foreground artwork blocks an original curve handle', async ({ page }) => {
  const p = groupFixture((_p, s) => {
    s.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  });
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
            ...structuredClone(p.layers[0].keys[0].shapes[0]),
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
  await page.getByLabel('Drag live group curve controls').check();
  const start = await point(page, p, 8, 52);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByLabel('Live group curve status')).toContainText('Foreground');
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

for (const action of ['candidate', 'source', 'target-restored', 'reentry'] as const)
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
          if (action === 'source') {
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate final curve edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'target-restored') {
            const el = document.querySelector(
              '[aria-label="Live group curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '28']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'reentry')
            [...document.querySelectorAll('button')]
              .find((e) => e.textContent === 'Commit live group curve control')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await page
      .getByRole('button', { name: 'Commit live group curve control', exact: true })
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
        .getByRole('button', { name: 'Close live group curve controls', exact: true })
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
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  expect(
    await page.evaluate(() => ({
      hit: (window as unknown as { cubicGetterHit: boolean }).cubicGetterHit,
      reads: (window as unknown as { cubicGetterReads: number }).cubicGetterReads,
    })),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const role of ['start', 'end'] as const)
      test(`group ${mode}/${basis} second-reference ${role} preview and exact commit`, async ({
        page,
      }) => {
        const { p, b, h } = liveRotationFixture(mode, basis, true);
        p.width = 500;
        p.height = 400;
        for (const key of p.layers[0].keys)
          for (const shape of key.shapes) {
            shape.x += 80;
            shape.y += 80;
            shape.opacity = 1;
            if (shape.id === 'b') shape.fill = '#0000ff';
          }
        p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
        const f = await setup(page, false, p);
        await page
          .getByLabel('Live group curve control', { exact: true })
          .selectOption(role === 'start' ? '2' : '3');
        await numeric(page, role === 'start' ? 260 : 340, 250);
        await page
          .getByRole('button', { name: 'Preview live group curve control', exact: true })
          .click();
        await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
        const hm = [(1 + h[0]) / 2, h[1] / 2, h[2] / 2, (1 + h[3]) / 2],
          local = { x: b[0] * 6 + b[2] * 5, y: b[1] * 6 + b[3] * 5 };
        for (const [offset, color] of [
          [0, [255, 0, 0, 255]],
          [40, [0, 0, 255, 255]],
        ] as const) {
          const u = hm[0] * (offset + local.x) + hm[2] * local.y,
            v = hm[1] * (offset + local.x) + hm[3] * local.y;
          await expect
            .poll(() => pixel(page, p, 127.5 + (u - v) / Math.SQRT2, 133.75 + (u + v) / Math.SQRT2))
            .toEqual(color);
        }
        expect(await f.read()).toEqual(p);
        await page
          .getByRole('button', { name: 'Commit live group curve control', exact: true })
          .click();
        const expected = structuredClone(p);
        Object.assign(
          expected.layers[0].liveMotionSpans![0].path!,
          role === 'start' ? { startX: 20, startY: 50 } : { endX: 20, endY: 50 },
        );
        expect(await f.read()).toEqual(expected);
        await expect(
          page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
            exact: true,
          }),
        ).toBeVisible();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
        expect(f.errors).toEqual([]);
      });

for (const basis of ['affine', 'reflected'])
  for (const role of ['start', 'end'] as const)
    test(`native second-group ${basis} ${role} preserves CSS offsets Shift and shared history`, async ({
      page,
    }) => {
      const { p } = liveRotationFixture('both', basis, true);
      p.width = 500;
      p.height = 400;
      for (const key of p.layers[0].keys)
        for (const shape of key.shapes) {
          shape.x += 80;
          shape.y += 80;
        }
      p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
      const f = await setup(page, false, p);
      await page
        .getByLabel('Live group curve control', { exact: true })
        .selectOption(role === 'start' ? '2' : '3');
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.85,.8)';
      });
      await page.getByLabel('Drag live group curve controls').check();
      const original = { x: role === 'start' ? 240 : 320, y: 240 },
        a = await point(page, p, original.x, original.y),
        z = await point(page, p, original.x + 30, original.y + 10);
      await f.canvas.evaluate((c) => {
        const events: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
        Object.assign(window, { groupEvents: events });
        for (const name of ['pointerdown', 'pointerup'])
          c.addEventListener(
            name,
            (e) => {
              events[name === 'pointerdown' ? 'down' : 'up'] = {
                x: (e as PointerEvent).clientX,
                y: (e as PointerEvent).clientY,
              };
            },
            { once: true },
          );
      });
      await page.keyboard.down('Shift');
      await page.mouse.move(a.x + 2, a.y - 1);
      await page.mouse.down();
      await page.mouse.move(z.x + 2, z.y - 1, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
      expect(await f.read()).toEqual(p);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.getByRole('button', { name: 'Use group curve draft target', exact: true }).click();
      const dx = await f.canvas.evaluate((c) => {
        const r = c.getBoundingClientRect(),
          events = (
            window as unknown as { groupEvents: { down: { x: number }; up: { x: number } } }
          ).groupEvents;
        return (
          ((events.up.x - events.down.x) * ((c as HTMLCanvasElement).width / devicePixelRatio)) /
          r.width
        );
      });
      expect(Number(await page.getByLabel('Live group curve document X').inputValue())).toBe(
        original.x + dx,
      );
      expect(Number(await page.getByLabel('Live group curve document Y').inputValue())).toBe(
        original.y,
      );
      await page
        .getByRole('button', { name: 'Commit live group curve control', exact: true })
        .click();
      const expected = structuredClone(p);
      Object.assign(
        expected.layers[0].liveMotionSpans![0].path!,
        role === 'start'
          ? { startX: original.x + dx - original.x, startY: 40 }
          : { endX: original.x + dx - original.x, endY: 40 },
      );
      expect(await f.read()).toEqual(expected);
      expect(f.errors).toEqual([]);
    });

for (const route of ['absent', 'waypoint'])
  test(`unsupported group ${route} route retains authored recovery`, async ({ page }) => {
    const p = groupFixture((_p, s) => {
      s.path = {
        startX: 0,
        startY: 40,
        endX: 0,
        endY: 40,
        ...(route === 'waypoint' ? { waypoints: [{ x: 40, y: 20 }] } : {}),
      };
      if (route === 'absent') delete s.path;
    });
    const f = await setup(page, false, p, 4, false);
    await expect(page.getByLabel('Live group curve status')).toContainText('No original');
    await expect(
      page.getByRole('button', { name: 'Commit live group curve control', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(p);
    await page
      .getByRole('button', { name: 'Close live group curve controls', exact: true })
      .click();
    expect(f.errors).toEqual([]);
  });

test('group curve committed metadata survives JSON recovery reopen', async ({ page }) => {
  const f = await setup(page, true);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  const expected = structuredClone(f.p);
  Object.assign(expected.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
  expect(await f.read()).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});

function releaseFixture(basis = 'plain', advanced = false) {
  const p = groupFixture((_p, span) => {
    span.path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      ...(advanced
        ? { distance: true, tangent: true, headingOffset: 10, headingOffsetEnd: 20 }
        : {}),
    };
  });
  const fills: Record<string, string> = {
    a: '#ff0000',
    b: '#00ff00',
    c: '#0000ff',
    d: '#ff00ff',
    loose: '#000000',
  };
  for (const key of p.layers[0].keys.slice(0, 2))
    for (const shape of key.shapes) {
      shape.fill = fills[shape.id];
      if (basis !== 'plain')
        Object.assign(shape, {
          rotation: shape.rotation + 25,
          transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          pivot: { x: -100, y: 40 },
        });
    }
  return p;
}
async function enableGroupRelease(page: Page) {
  await page.getByLabel('Drag live group curve controls', { exact: true }).check();
  await page.getByLabel('Author live group curve on release', { exact: true }).check();
}
async function groupReleasePositions(
  page: Page,
  p: Project,
  role: 'start' | 'end' = 'start',
  scale = false,
  shift = false,
  groupId = 'outer',
) {
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  if (scale)
    await canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
  const origin = p.layers[0].keys
      .find((k) => k.frame === (role === 'start' ? 0 : 8))!
      .shapes.find((s) => s.groups?.[0] === groupId)!,
    ox = origin.x,
    oy = origin.y + 40,
    start = await point(page, p, ox, oy),
    end = await point(page, p, ox + 20, oy + 10);
  await canvas.evaluate((c) => {
    const data: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
    Object.assign(window, { groupReleaseDelivered: data });
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
    oy,
    start,
    end,
    finish: async () => {
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      return canvas.evaluate(
        (c, { ox, oy, shift }) => {
          const canvas = c as HTMLCanvasElement,
            r = canvas.getBoundingClientRect(),
            d = (
              window as unknown as {
                groupReleaseDelivered: {
                  down: { x: number; y: number };
                  up: { x: number; y: number };
                };
              }
            ).groupReleaseDelivered;
          let dx = ((d.up.x - d.down.x) * (canvas.width / devicePixelRatio)) / r.width,
            dy = ((d.up.y - d.down.y) * (canvas.height / devicePixelRatio)) / r.height;
          if (shift) {
            if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          return { x: ox + dx, y: oy + dy };
        },
        { ox, oy, shift },
      );
    },
  };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const groupId of ['outer', 'second'])
    for (const role of ['start', 'end'] as const)
      test(`direct group release ${basis}/${groupId}/${role} authors one exact persistent edit with native cleanup`, async ({
        page,
      }) => {
        const p = releaseFixture(basis),
          f = await setup(page, false, p);
        await expect(page.getByLabel('Author live group curve on release')).not.toBeChecked();
        await page
          .getByLabel('Live group curve control', { exact: true })
          .selectOption(String((groupId === 'outer' ? 0 : 2) + (role === 'start' ? 0 : 1)));
        await enableGroupRelease(page);
        const g = await groupReleasePositions(page, p, role, false, false, groupId);
        const u = basis === 'reflected' ? 2 : 18,
          v = 3,
          theta = ((basis === 'plain' ? 45 : 70) * Math.PI) / 180,
          bx = basis === 'plain' ? u : (basis === 'reflected' ? -2 : 2) * u + 0.5 * v,
          by = basis === 'plain' ? v : 0.25 * u + 3 * v,
          px =
            55.5 + (groupId === 'second' ? 160 : 0) + Math.cos(theta) * bx - Math.sin(theta) * by,
          py =
            45.75 + (groupId === 'second' ? 100 : 0) + Math.sin(theta) * bx + Math.cos(theta) * by,
          color = groupId === 'outer' ? [255, 0, 0, 255] : [0, 0, 255, 255];
        await expect.poll(() => pixel(page, p, px, py)).toEqual(color);
        expect(await f.read()).toEqual(p);
        const target = await g.finish(),
          want = structuredClone(p);
        Object.assign(
          want.layers[0].liveMotionSpans![0].path!,
          role === 'start'
            ? { startX: target.x - g.ox, startY: target.y - (g.oy - 40) }
            : { endX: target.x - g.ox, endY: target.y - (g.oy - 40) },
        );
        await expect(f.panel).toBeHidden();
        expect(await f.read()).toEqual(want);
        expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
          false,
        );
        await expect(
          page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
            exact: true,
          }),
        ).toBeVisible();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(want);
        expect(f.errors).toEqual([]);
      });
for (const shift of [false, true])
  test(`direct group release independent CSS axes/offsets and Shift ${shift}`, async ({ page }) => {
    const f = await setup(page);
    await enableGroupRelease(page);
    const g = await groupReleasePositions(page, f.p, 'start', true, shift);
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
  test(`direct group release ${mode} rejects stale or cancelled native work`, async ({ page }) => {
    const f = await setup(page);
    await enableGroupRelease(page);
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
          '[aria-label="Live group curve document X"]',
        ) as HTMLInputElement;
        el.value = '999';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (mode === 'pick') {
        const el = document.querySelector(
          '[aria-label="Live group curve control"]',
        ) as HTMLSelectElement;
        el.value = '1';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (mode === 'frame')
        (document.querySelector('button[title="First frame"]') as HTMLButtonElement).click();
      if (mode === 'close')
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent === 'Close live group curve controls')!
          .click();
      if (mode === 'author policy' || mode === 'gesture policy') {
        const el = document.querySelector(
          `[aria-label="${mode === 'author policy' ? 'Author live group curve on release' : 'Drag live group curve controls'}"]`,
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
      await expect(page.getByLabel('Live group curve document X')).toHaveValue('999');
    expect(f.errors).toEqual([]);
  });
for (const phase of ['initial', 'release', 'final', 'last'] as const)
  for (const policy of ['author', 'gesture'] as const)
    test(`direct group release ${phase} restored ${policy} policy rejects and permits draft/author retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await enableGroupRelease(page);
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
              Object.assign(window, { groupReleasePolicyHit: true });
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              if (phase !== 'initial' && c.hasPointerCapture(1))
                throw Error('release preparation retained native capture');
              const el = document.querySelector(
                `[aria-label="${policy === 'author' ? 'Author live group curve on release' : 'Drag live group curve controls'}"]`,
              ) as HTMLInputElement;
              el.click();
              el.click();
            };
            Object.assign(window, { groupReleasePolicyHit: false });
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
                  ++finalReads === 1
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
        await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
        await hook();
      }
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { groupReleasePolicyHit: boolean }).groupReleasePolicyHit,
        ),
      ).toBe(true);
      expect(await f.read()).toEqual(f.p);
      expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.getByLabel('Author live group curve on release').uncheck();
      const draft = await groupReleasePositions(page, f.p);
      await draft.finish();
      await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author live group curve on release').check();
      const retry = await groupReleasePositions(page, f.p),
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
test('direct group release keeps numeric preview lifetime independent and restores it on Escape', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 48, 72);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await enableGroupRelease(page);
  await groupReleasePositions(page, f.p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live group curve document X')).toHaveValue('48');
  expect(f.errors).toEqual([]);
});
for (const phase of ['release', 'last'] as const)
  for (const action of ['source', 'target', 'view'] as const)
    test(`direct group release ${phase} actual ${action} after detached candidate rejects publication`, async ({
      page,
    }) => {
      const f = await setup(page);
      await enableGroupRelease(page);
      const start = await point(page, f.p, 8, 52),
        end = await point(page, f.p, 28, 62);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 3 });
      await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
      await page.evaluate(
        ({ phase, action }) => {
          const clone = structuredClone,
            stringify = JSON.stringify;
          let hit = false,
            seen = false,
            reads = 0;
          Object.assign(window, { groupReleaseActualHit: false });
          const act = () => {
            hit = true;
            Object.assign(window, { groupReleaseActualHit: true });
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
                '[aria-label="Live group curve document X"]',
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
                ++reads === 1
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
          () => (window as unknown as { groupReleaseActualHit: boolean }).groupReleaseActualHit,
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
            .getByRole('button', { name: 'Close live group curve controls', exact: true })
            .click();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        expect(await f.read()).toEqual(want);
      } else {
        if (action === 'target')
          await expect(page.getByLabel('Live group curve document X')).toHaveValue('8');
        const g = await groupReleasePositions(page, f.p),
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
test('direct group release restored author policy during publication restores an independent numeric preview', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, 48, 72);
  await page.getByRole('button', { name: 'Preview live group curve control', exact: true }).click();
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await enableGroupRelease(page);
  const g = await groupReleasePositions(page, f.p);
  await expect.poll(() => pixel(page, f.p, 28, 62)).toEqual([0, 126, 170, 255]);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let hit = false;
    Object.assign(window, { groupPriorReleaseHit: false });
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const out = stringify(...args),
        p = (args[0] as { project?: Project })?.project;
      if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) {
        hit = true;
        Object.assign(window, { groupPriorReleaseHit: true });
        const el = document.querySelector(
          '[aria-label="Author live group curve on release"]',
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
      () => (window as unknown as { groupPriorReleaseHit: boolean }).groupPriorReleaseHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => pixel(page, f.p, 48, 72)).toEqual([0, 126, 170, 255]);
  await expect(page.getByLabel('Live group curve document X')).toHaveValue('48');
  const retry = await groupReleasePositions(page, f.p),
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
test('direct group release retains explicit distance/tangent/heading options and exact authored endpoints', async ({
  page,
}) => {
  const p = releaseFixture('plain', true),
    f = await setup(page, false, p);
  await enableGroupRelease(page);
  const g = await groupReleasePositions(page, p),
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
test('direct group release author preference alone cannot capture and numeric Commit stays independent', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Author live group curve on release').check();
  const start = await point(page, f.p, 8, 52),
    end = await point(page, f.p, 28, 62);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 28, 62);
  await page.getByRole('button', { name: 'Commit live group curve control', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const want = structuredClone(f.p);
  Object.assign(want.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
  expect(await f.read()).toEqual(want);
  expect(f.errors).toEqual([]);
});

test('direct group release prepares remembered children without changing the library', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes[0].groups = ['outer'];
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'member', x: key.shapes[0].x + 30 });
  }
  p.layers[0].liveMotionSpans![0].rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 20, endX: 0, endY: 20 };
  const f = await setup(page, false, p, 2);
  await page.getByLabel('Live group curve remembered children').check();
  await enableGroupRelease(page);
  const a = await point(page, p, 0, 20),
    b = await point(page, p, 20, 30);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, p, 55, 25)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  await page.mouse.up();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(p);
  Object.assign(expected.layers[0].liveMotionSpans![0].path!, { startX: 20, startY: 30 });
  expect(await f.read()).toEqual(expected);
  await expect(
    page.getByText('2 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

test('direct group release authoring cannot pick a covered original control', async ({ page }) => {
  const p = releaseFixture();
  p.layers.push({
    id: 'foreground',
    name: 'Foreground',
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [
      {
        frame: 0,
        shapes: [
          {
            ...structuredClone(p.layers[0].keys[0].shapes[0]),
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
  await enableGroupRelease(page);
  const a = await point(page, p, 8, 52);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await expect(page.getByLabel('Live group curve status')).toContainText('Foreground');
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('direct group release owns the complete later track and preserves the earlier track', async ({
  page,
}) => {
  const p = releaseFixture(),
    later = structuredClone(p.layers[0]);
  later.id = 'later';
  later.name = 'Later group roots';
  later.liveMotionSpans![0].id = 'later-live';
  for (const key of later.keys)
    for (const shape of key.shapes) {
      shape.id += '-later';
      shape.x += 10;
    }
  p.layers.push(later);
  const f = await setup(page, false, p);
  await page.getByLabel('Live group curve control', { exact: true }).selectOption('4');
  await enableGroupRelease(page);
  const a = await point(page, p, 18, 52),
    b = await point(page, p, 38, 62);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
  expect(await f.read()).toEqual(p);
  await page.mouse.up();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(p);
  Object.assign(expected.layers[1].liveMotionSpans![0].path!, { startX: 20, startY: 50 });
  expect(await f.read()).toEqual(expected);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Later group roots');
  await expect(
    page.getByText('5 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

for (const action of ['policy', 'target', 'source'] as const)
  test(`direct group release final input read rejects late restored ${action} after source admission`, async ({
    page,
  }) => {
    const f = await setup(page);
    await enableGroupRelease(page);
    const a = await point(page, f.p, 8, 52),
      b = await point(page, f.p, 28, 62);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        descriptors = Object.getOwnPropertyDescriptors;
      let seen = false,
        reads = 0,
        hit = false;
      Object.assign(window, { groupTailHit: false });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          wrapper = args[0] as { project?: Project };
        if (wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startX === 20) seen = true;
        return out;
      }) as typeof stringify;
      Object.getOwnPropertyDescriptors = ((value: unknown) => {
        const out = descriptors(value),
          raw = value as { pick?: { groupId?: string }; target?: { x?: number; y?: number } };
        if (
          !hit &&
          seen &&
          Reflect.ownKeys(out).length === 2 &&
          raw?.pick?.groupId &&
          raw.target?.x === 28 &&
          raw.target.y === 62 &&
          ++reads === 4
        ) {
          hit = true;
          Object.assign(window, { groupTailHit: true });
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          if (c.hasPointerCapture(1)) throw Error('Final publication still owns native capture');
          if (action === 'policy') {
            const el = document.querySelector(
              '[aria-label="Author live group curve on release"]',
            ) as HTMLInputElement;
            el.click();
            el.click();
          } else if (action === 'target') {
            const el = document.querySelector(
              '[aria-label="Live group curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '8']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else {
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Independent final source edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return out;
      }) as typeof descriptors;
    }, action);
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as unknown as { groupTailHit: boolean }).groupTailHit),
    ).toBe(true);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Independent final source edit';
    expect(await f.read()).toEqual(expected);
    expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    if (action === 'source') {
      if (await f.panel.count())
        await page
          .getByRole('button', { name: 'Close live group curve controls', exact: true })
          .click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(expected);
    } else {
      const g = await groupReleasePositions(page, f.p),
        target = await g.finish(),
        retry = structuredClone(f.p);
      Object.assign(retry.layers[0].liveMotionSpans![0].path!, {
        startX: target.x - 8,
        startY: target.y - 12,
      });
      await expect(f.panel).toBeHidden();
      expect(await f.read()).toEqual(retry);
    }
    expect(f.errors).toEqual([]);
  });
