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
    if (window === window.top && !sessionStorage.getItem('group-waypoint-editor-seed')) {
      sessionStorage.setItem('group-waypoint-editor-seed', '1');
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
// Independent route equations and dense polyline arc length, without production samplers.
function reference(
  path: NonNullable<NonNullable<Project['layers'][number]['liveMotionSpans']>[number]['path']>,
) {
  const points = [{ x: 0, y: 0 }, ...path.waypoints!, { x: 80, y: 0 }];
  const curve = (i: number, u: number) => {
    const a = points[i],
      b = points[i + 1],
      before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 2)];
    if (!path.curvedWaypoints)
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dx: b.x - a.x, dy: b.y - a.y };
    const out = path.waypointTangents?.[i],
      incoming =
        path.waypointIncoming?.[i] ??
        (path.waypointTangents
          ? { x: -path.waypointTangents[i + 1].x, y: -path.waypointTangents[i + 1].y }
          : undefined);
    const c = out
      ? { x: a.x + out.x, y: a.y + out.y }
      : { x: a.x + (b.x - before.x) / 6, y: a.y + (b.y - before.y) / 6 };
    const d = incoming
      ? { x: b.x + incoming.x, y: b.y + incoming.y }
      : { x: b.x - (after.x - a.x) / 6, y: b.y - (after.y - a.y) / 6 };
    const v = 1 - u;
    return {
      x: v * v * v * a.x + 3 * v * v * u * c.x + 3 * v * u * u * d.x + u * u * u * b.x,
      y: v * v * v * a.y + 3 * v * v * u * c.y + 3 * v * u * u * d.y + u * u * u * b.y,
      dx: 3 * v * v * (c.x - a.x) + 6 * v * u * (d.x - c.x) + 3 * u * u * (b.x - d.x),
      dy: 3 * v * v * (c.y - a.y) + 6 * v * u * (d.y - c.y) + 3 * u * u * (b.y - d.y),
    };
  };
  let pose = curve(1, 0.5);
  if (path.distance) {
    const rows: { length: number; i: number; u: number }[] = [{ length: 0, i: 0, u: 0 }];
    let length = 0;
    for (let i = 0; i < 3; i++) {
      let old = curve(i, 0);
      for (let j = 1; j <= 10000; j++) {
        const now = curve(i, j / 10000);
        length += Math.hypot(now.x - old.x, now.y - old.y);
        rows.push({ length, i, u: j / 10000 });
        old = now;
      }
    }
    const at = rows.findIndex((r) => r.length >= length / 2),
      a = rows[at - 1],
      b = rows[at],
      u =
        (a.i === b.i ? a.u : 0) +
        ((b.u - (a.i === b.i ? a.u : 0)) * (length / 2 - a.length)) / (b.length - a.length);
    pose = curve(b.i, u);
  }
  return {
    x: 8 + pose.x,
    y: 12 + pose.y,
    angle: path.tangent ? Math.atan2(pose.dy, pose.dx) + (15 * Math.PI) / 180 : 0,
  };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'other'])
    for (const number of [1, 2])
      test(`numeric live group waypoint ${basis}/${root}/${number} previews independent pixels and commits exact history`, async ({
        page,
      }) => {
        const p = fixture('straight', basis),
          f = await setup(page, p);
        await expect(page.getByLabel('Live group waypoint group').locator('option')).toHaveCount(2);
        await page.getByLabel('Live group waypoint group').selectOption(root === 'art' ? '0' : '1');
        await page.getByLabel('Live group waypoint number').fill(String(number));
        const x = (number === 1 ? 28 : 68) + (root === 'other' ? 40 : 0),
          y = 42 + (root === 'other' ? 30 : 0);
        await expect(page.getByLabel('Live group waypoint document X')).toHaveValue(String(x));
        await expect(page.getByLabel('Live group waypoint document Y')).toHaveValue(String(y));
        await numeric(page, x + 10, y + 10);
        await page
          .getByRole('button', { name: 'Preview live group waypoint', exact: true })
          .click();
        await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
        const expected = structuredClone(p),
          path = expected.layers[0].liveMotionSpans![0].path!;
        (path.waypoints as { x: number; y: number }[])[number - 1] = {
          x: number === 1 ? 30 : 70,
          y: 40,
        };
        const pose = reference(path),
          theta = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
          bx = basis === 'plain' ? 10 : (basis === 'reflected' ? -2 : 2) * 10 + 5,
          by = basis === 'plain' ? 10 : 2.5 + 30;
        await expect
          .poll(() =>
            pixel(
              page,
              p,
              pose.x + (root === 'other' ? 40 : 0) + Math.cos(theta) * bx - Math.sin(theta) * by,
              pose.y + (root === 'other' ? 30 : 0) + Math.sin(theta) * bx + Math.cos(theta) * by,
            ),
          )
          .toEqual(root === 'art' ? [255, 0, 0, 255] : [0, 0, 255, 255]);
        expect(await f.read()).toEqual(p);
        await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
        await expect(f.panel).toBeHidden();
        expect(await f.read()).toEqual(expected);
        await expect(
          page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
            exact: true,
          }),
        ).toBeVisible();
        await undoRedo(page, f, expected);
        expect(f.errors).toEqual([]);
      });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  test(`numeric live group waypoint preserves ${mode} routing and independent sampled pixels`, async ({
    page,
  }) => {
    const p = fixture(mode),
      f = await setup(page, p);
    await numeric(page);
    await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
    await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
    const expected = structuredClone(p),
      path = expected.layers[0].liveMotionSpans![0].path!;
    (path.waypoints as { x: number; y: number }[])[0] = { x: 30, y: 40 };
    const pose = reference(path);
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + 10 * Math.cos(pose.angle) - 10 * Math.sin(pose.angle),
          pose.y + 10 * Math.sin(pose.angle) + 10 * Math.cos(pose.angle),
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    await expect(f.panel).toBeHidden();
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });
test('numeric live group waypoint direct commit needs no preview and survives JSON recovery reopen', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  const expected = structuredClone(f.p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(expected);
  expect(f.errors).toEqual([]);
});
for (const axis of ['X', 'Y'])
  test(`numeric live group waypoint raw ${axis} rejects NaN and permits fresh corrected commit`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel(`Live group waypoint document ${axis}`).fill('');
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    await expect(page.getByLabel('Live group waypoint status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await numeric(page);
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    await expect(f.panel).toBeHidden();
    expect((await f.read()).layers[0].liveMotionSpans![0].path!.waypoints![0]).toEqual({
      x: 30,
      y: 40,
    });
    expect(f.errors).toEqual([]);
  });
for (const number of ['0', '1.5', '99', ''])
  test(`numeric live group waypoint number ${number || 'missing'} rejects without truncation or publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live group waypoint number').fill(number);
    await expect(
      page.getByRole('button', { name: 'Commit live group waypoint', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live group waypoint number').fill('1');
    await numeric(page);
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    await expect(f.panel).toBeHidden();
    expect((await f.read()).layers[0].liveMotionSpans![0].path!.waypoints![0]).toEqual({
      x: 30,
      y: 40,
    });
    expect(f.errors).toEqual([]);
  });
test('numeric live group waypoint no-op and stationary tangent failure retain plain recovery', async ({
  page,
}) => {
  const f = await setup(page, fixture('tangent'));
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 8, 12);
  await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText(
    /stationary|tangent|direction/i,
  );
  expect(await f.read()).toEqual(f.p);
  await numeric(page);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  expect((await f.read()).layers[0].liveMotionSpans![0].path!.tangent).toBe(true);
  expect(f.errors).toEqual([]);
});
test('numeric live group waypoint uses prepared remembered children with unchanged library and authored keys', async ({
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
  await numeric(page, 40, 30);
  await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(page, p, 35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 55, 30)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  const expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 40,
    y: 30,
  };
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
test('numeric live group waypoint owns later-track membership and preserves the earlier track', async ({
  page,
}) => {
  const p = fixture(),
    later = structuredClone(p.layers[0]);
  later.id = 'later';
  later.name = 'Later waypoints';
  p.layers.push(later);
  const f = await setup(page, p);
  await page.getByLabel('Live group waypoint group').selectOption('2');
  await numeric(page);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(p);
  (expected.layers[1].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  expect(await f.read()).toEqual(expected);
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Later waypoints');
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
test('numeric waypoint canvas release stays history-free and Escape discards only its preview', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
  await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
  const a = await f.canvas.evaluate((node, p) => {
    const c = node as HTMLCanvasElement,
      r = c.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 + ((28 - p.width / 2) * r.width) / (c.width / devicePixelRatio),
      y: r.top + r.height / 2 + ((42 - p.height / 2) * r.height) / (c.height / devicePixelRatio),
    };
  }, f.p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.move(a.x + 30, a.y + 20, { steps: 3 });
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('38');
  await f.canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Live group waypoint status')).toContainText('discarded');
  await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('38');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const action of ['target', 'index', 'root', 'frame', 'close', 'source'] as const)
  test(`stale preview ${action} invalidates waypoint feedback without curve history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page);
    await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
    await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
    if (action === 'target') await page.getByLabel('Live group waypoint document X').fill('48');
    if (action === 'index') await page.getByLabel('Live group waypoint number').fill('2');
    if (action === 'root') await page.getByLabel('Live group waypoint group').selectOption('1');
    if (action === 'frame')
      await page.getByRole('button', { name: 'Next frame', exact: true }).click();
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live group waypoint positions', exact: true })
        .click();
    if (action === 'source') {
      // Ordinary properties are intentionally inert during live controls. Invoke
      // the original application edit handler as an out-of-band source change.
      await page.getByLabel('Layer name', { exact: true }).evaluate((node) => {
        (node as HTMLInputElement).value = 'Independent preview source';
        node.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Independent preview source';
    if (['frame', 'close', 'source'].includes(action)) await expect(f.panel).toBeHidden();
    else await expect(page.getByLabel('Live group waypoint status')).not.toContainText('Unapplied');
    expect(await f.read()).toEqual(expected);
    if (action === 'target')
      await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('48');
    if (action === 'index')
      await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('68');
    if (action === 'root')
      await expect(page.getByLabel('Live group waypoint document Y')).toHaveValue('72');
    if (action === 'source') {
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(expected);
    }
    expect(f.errors).toEqual([]);
  });
for (const phase of ['candidate', 'recovery'] as const)
  for (const action of [
    'target-restored',
    'index-restored',
    'root-restored',
    'source',
    'frame',
    'frame-restored',
    'close',
    'reentry',
  ] as const)
    test(`late waypoint ${phase}/${action} rejects before one history transaction`, async ({
      page,
    }) => {
      const f = await setup(page);
      await numeric(page);
      await page.evaluate(
        ({ phase, action }) => {
          const stringify = JSON.stringify;
          let inClick = false,
            seen = false,
            hit = false;
          window.addEventListener(
            'click',
            () => {
              inClick = true;
            },
            { capture: true, once: true },
          );
          window.addEventListener(
            'click',
            () => {
              inClick = false;
            },
            { once: true },
          );
          Object.assign(window, { waypointLateHit: false, waypointLateNative: false });
          JSON.stringify = ((...args: Parameters<typeof stringify>) => {
            const out = stringify(...args),
              wrapper = args[0] as { project?: Project },
              candidate = args[0] as Project;
            if (wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
              seen = true;
            if (
              !hit &&
              inClick &&
              (phase === 'candidate'
                ? candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30
                : seen)
            ) {
              hit = true;
              Object.assign(window, { waypointLateHit: true, waypointLateNative: inClick });
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              if (c.hasPointerCapture(1))
                throw Error('Numeric publication acquired native capture');
              const input = (label: string, value: string, event = 'input') => {
                const el = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
                el.value = value;
                el.dispatchEvent(new Event(event, { bubbles: true }));
              };
              if (action === 'target-restored') {
                input('Live group waypoint document X', '999');
                input('Live group waypoint document X', '38');
              }
              if (action === 'index-restored') {
                input('Live group waypoint number', '2');
                input('Live group waypoint number', '1');
                input('Live group waypoint document X', '38');
                input('Live group waypoint document Y', '52');
              }
              if (action === 'root-restored') {
                input('Live group waypoint group', '1', 'change');
                input('Live group waypoint group', '0', 'change');
                input('Live group waypoint document X', '38');
                input('Live group waypoint document Y', '52');
              }
              if (action === 'source')
                input('Layer name', 'Independent late waypoint source', 'change');
              if (action === 'frame')
                [...document.querySelectorAll('button')]
                  .find((b) => b.textContent === 'Next frame')!
                  .click();
              if (action === 'frame-restored')
                for (const name of ['Next frame', 'Previous frame'])
                  [...document.querySelectorAll('button')]
                    .find((b) => b.textContent === name)!
                    .click();
              if (action === 'close' || action === 'reentry')
                [...document.querySelectorAll('button')]
                  .find(
                    (b) =>
                      b.textContent ===
                      (action === 'close'
                        ? 'Close live group waypoint positions'
                        : 'Commit live group waypoint'),
                  )!
                  .click();
            }
            return out;
          }) as typeof stringify;
        },
        { phase, action },
      );
      await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { waypointLateHit: boolean }).waypointLateHit,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { waypointLateNative: boolean }).waypointLateNative,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Independent late waypoint source';
      expect(await f.read()).toEqual(expected);
      if (action === 'source') {
        await expect(f.panel).toBeHidden();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
      } else if (action === 'frame' || action === 'frame-restored' || action === 'close') {
        await expect(f.panel).toBeHidden();
        if (action === 'frame')
          await expect(page.getByText('Frame 6 / 12', { exact: true })).toBeVisible();
        if (action === 'frame-restored')
          await expect(page.getByText('Frame 5 / 12', { exact: true })).toBeVisible();
      } else {
        await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('38');
        await expect(page.getByLabel('Live group waypoint document Y')).toHaveValue('52');
        await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
        await expect(f.panel).toBeHidden();
        const retry = structuredClone(f.p);
        (retry.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
          x: 30,
          y: 40,
        };
        expect(await f.read()).toEqual(retry);
        await undoRedo(page, f, retry);
      }
      expect(f.errors).toEqual([]);
    });
test('off-view waypoint numeric targets remain unclamped with exact source keys and history', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page, -80, 52);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(f.p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: -88,
    y: 40,
  };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
test('cloned waypoint input accessors reject with zero reads and allow a fresh numeric retry', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page.evaluate(() => {
    const native = structuredClone;
    let hit = false;
    Object.assign(window, { waypointGetterReads: 0, waypointGetterHit: false });
    window.structuredClone = <T>(value: T): T => {
      const out = native(value),
        raw = out as { pick?: { waypointIndex?: number }; target?: { x?: number } };
      if (!hit && raw?.pick?.waypointIndex === 0 && raw.target?.x === 38) {
        hit = true;
        Object.assign(window, { waypointGetterHit: true });
        Object.defineProperty(raw.pick, 'waypointIndex', {
          enumerable: true,
          get() {
            (window as unknown as { waypointGetterReads: number }).waypointGetterReads++;
            return 0;
          },
        });
      }
      return out;
    };
  });
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { waypointGetterHit: boolean }).waypointGetterHit,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { waypointGetterReads: number }).waypointGetterReads,
    ),
  ).toBe(0);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(f.p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
test('final waypoint candidate corruption after recovery serialization rejects and preserves fresh history', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let seen = false,
      hit = false,
      inClick = false;
    Object.assign(window, { waypointFinalHit: false });
    window.addEventListener(
      'click',
      () => {
        inClick = true;
      },
      { capture: true, once: true },
    );
    window.addEventListener(
      'click',
      () => {
        inClick = false;
      },
      { once: true },
    );
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const out = stringify(...args),
        wrapper = args[0] as { project?: Project },
        candidate = args[0] as Project;
      if (wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
        seen = true;
      if (
        !hit &&
        inClick &&
        seen &&
        candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30
      ) {
        hit = true;
        Object.assign(window, { waypointFinalHit: true });
        candidate.layers[0].keys[0].shapes[0].x = 999;
      }
      return out;
    }) as typeof stringify;
  });
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { waypointFinalHit: boolean }).waypointFinalHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(f.p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});

for (const action of ['target', 'close'] as const)
  test(`pending waypoint font readiness ${action} cancels stale feedback and permits fresh preparation`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => {
      const fonts = document.fonts,
        ready = fonts.ready;
      let resolve!: (fonts: FontFaceSet) => void;
      const held = new Promise<FontFaceSet>((done) => {
        resolve = done;
      });
      Object.assign(window, {
        waypointFontHeld: false,
        waypointFontRelease: () => {
          delete (fonts as unknown as { ready?: unknown }).ready;
          void ready.then(() => resolve(fonts));
        },
      });
      Object.defineProperty(fonts, 'ready', {
        configurable: true,
        get() {
          Object.assign(window, { waypointFontHeld: true });
          return held;
        },
      });
    });
    await numeric(page);
    await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { waypointFontHeld: boolean }).waypointFontHeld),
      )
      .toBe(true);
    await expect(page.getByLabel('Live group waypoint status')).toContainText('Preparing');
    expect(await f.read()).toEqual(f.p);
    if (action === 'target') await page.getByLabel('Live group waypoint document X').fill('48');
    else
      await page
        .getByRole('button', { name: 'Close live group waypoint positions', exact: true })
        .click();
    await page.evaluate(() => {
      (window as unknown as { waypointFontRelease: () => void }).waypointFontRelease();
    });
    await f.canvas.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    expect(await f.read()).toEqual(f.p);
    await expect.poll(() => pixel(page, f.p, 49, 43)).toEqual([255, 0, 0, 255]);
    if (action === 'target')
      await expect(page.getByLabel('Live group waypoint status')).not.toContainText('Unapplied');
    else {
      await expect(f.panel).toBeHidden();
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page
        .getByRole('button', { name: 'Edit live group waypoint positions…', exact: true })
        .click();
    }
    await numeric(page, 48, 52);
    await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
    await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    await expect(f.panel).toBeHidden();
    const expected = structuredClone(f.p);
    (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
      x: 40,
      y: 40,
    };
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });

test('retained cubic release preferences cannot authorize numeric waypoint canvas edits', async ({
  page,
}) => {
  const p = fixture(),
    curve = structuredClone(p.layers[0]);
  curve.id = 'curve';
  curve.name = 'Cubic reference';
  curve.liveMotionSpans![0].id = 'cubic';
  curve.liveMotionSpans![0].path = { startX: 20, startY: 30, endX: 20, endY: 30 };
  p.layers.push(curve);
  const f = await setup(page, p);
  await page
    .getByRole('button', { name: 'Close live group waypoint positions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live group curve controls…', exact: true }).click();
  await page.getByLabel('Drag live group curve controls', { exact: true }).check();
  await page.getByLabel('Author live group curve on release', { exact: true }).check();
  await page.getByRole('button', { name: 'Close live group curve controls', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit live group waypoint positions…', exact: true })
    .click();
  await numeric(page);
  const a = await f.canvas.evaluate((node, p) => {
    const c = node as HTMLCanvasElement,
      r = c.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 + ((28 - p.width / 2) * r.width) / (c.width / devicePixelRatio),
      y: r.top + r.height / 2 + ((42 - p.height / 2) * r.height) / (c.height / devicePixelRatio),
    };
  }, p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.move(a.x + 20, a.y + 10, { steps: 3 });
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('38');
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  test(`numeric live group waypoint retains rotating ${mode} settings, complete artwork and one history edit`, async ({
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
    await numeric(page, 30, 60);
    await page.getByRole('button', { name: 'Preview live group waypoint', exact: true }).click();
    await expect(page.getByLabel('Live group waypoint status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(p);
    await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
    const expected = structuredClone(p);
    expected.layers[0].liveMotionSpans![0].path!.waypoints = [
      { x: 30, y: 40 },
      { x: 60, y: 30 },
    ];
    expect(await f.read()).toEqual(expected);
    await expect(
      page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
        exact: true,
      }),
    ).toBeVisible();
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });
test('numeric group waypoint resolves the original ordered first member rather than bounds or sorted IDs', async ({
  page,
}) => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes = [key.shapes[1], key.shapes[0], ...key.shapes.slice(2)];
  const f = await setup(page, p);
  await expect(page.getByLabel('Live group waypoint document X')).toHaveValue('28');
  await expect(page.getByLabel('Live group waypoint document Y')).toHaveValue('112');
  await numeric(page, 38, 122);
  await page.getByRole('button', { name: 'Commit live group waypoint', exact: true }).click();
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypoints = [
    { x: 30, y: 40 },
    { x: 60, y: 30 },
  ];
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
