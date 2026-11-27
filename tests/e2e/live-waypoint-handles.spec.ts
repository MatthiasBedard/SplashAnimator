import { test, expect, type Page } from '@playwright/test';
import type { Project } from '../../packages/document/src';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
function fixture(mode = 'custom', basis = 'plain') {
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
  path.curvedWaypoints = true;
  if (mode.includes('distance')) path.distance = true;
  {
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
    if (window === window.top && !sessionStorage.getItem('waypoint-handle-seed')) {
      sessionStorage.setItem('waypoint-handle-seed', '1');
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
  await page.getByRole('button', { name: 'Edit live waypoint handles…', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Live waypoint handle positions', exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, canvas, errors, read };
}
async function numeric(page: Page, x = 48, y = 52) {
  await page.getByLabel('Live waypoint handle document X', { exact: true }).fill(String(x));
  await page.getByLabel('Live waypoint handle document Y', { exact: true }).fill(String(y));
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

function expected(
  p: Project,
  q = { x: 48, y: 52 },
  root = 0,
  number = 1,
  role = 'outgoing',
  layer = 0,
) {
  const out = structuredClone(p),
    l = out.layers[layer],
    path = l.liveMotionSpans![0].path!,
    a = l.keys.find((k) => k.frame === l.liveMotionSpans![0].start)!.shapes[root],
    offset = path.waypoints![number - 1],
    v = { x: q.x - a.x - offset.x, y: q.y - a.y - offset.y };
  if (role === 'incoming') (path.waypointIncoming as { x: number; y: number }[])[number - 1] = v;
  else (path.waypointTangents as { x: number; y: number }[])[number] = v;
  return out;
}
async function preview(page: Page) {
  await page.getByRole('button', { name: 'Preview live waypoint handle', exact: true }).click();
  await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
}
async function commit(page: Page, f: Awaited<ReturnType<typeof setup>>, out = expected(f.p)) {
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(out);
  if (out.layers[0].keys[0].shapes.length > 1)
    await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  await undoRedo(page, f, out);
  expect(f.errors).toEqual([]);
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'other'])
    for (const number of [1, 2])
      for (const role of ['incoming', 'outgoing'])
        test(`numeric waypoint handle ${basis}/${root}/${number}/${role} retains independent control and curve pixels`, async ({
          page,
        }) => {
          const p = fixture('custom', basis),
            f = await setup(page, p),
            r = root === 'art' ? 0 : 1;
          await page.getByLabel('Live waypoint handle root').selectOption(String(r));
          await page.getByLabel('Live waypoint handle number').fill(String(number));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const path = p.layers[0].liveMotionSpans![0].path!,
            a = p.layers[0].keys[0].shapes[r],
            w = path.waypoints![number - 1],
            h =
              role === 'incoming'
                ? path.waypointIncoming![number - 1]
                : path.waypointTangents![number],
            x = a.x + w.x + h.x,
            y = a.y + w.y + h.y;
          await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue(String(x));
          await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue(String(y));
          const q = { x: x + 10, y: y + 5 };
          await numeric(page, q.x, q.y);
          await preview(page);
          const out = expected(p, q, r, number, role),
            pose = reference(out.layers[0].liveMotionSpans![0].path!),
            theta = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
            bx = basis === 'plain' ? 10 : (basis === 'reflected' ? -2 : 2) * 10 + 5,
            by = basis === 'plain' ? 10 : 32.5;
          await expect
            .poll(() =>
              pixel(
                page,
                p,
                pose.x + (r ? 40 : 0) + Math.cos(theta) * bx - Math.sin(theta) * by,
                pose.y + (r ? 30 : 0) + Math.sin(theta) * bx + Math.cos(theta) * by,
              ),
            )
            .toEqual(r ? [0, 0, 255, 255] : [255, 0, 0, 255]);
          expect(await f.read()).toEqual(p);
          await commit(page, f, out);
        });
for (const mode of ['custom-distance', 'custom-tangent', 'custom-distance-tangent'])
  test(`numeric waypoint handle ${mode} preserves independent sampled pixels and metadata`, async ({
    page,
  }) => {
    const p = fixture(mode),
      f = await setup(page, p);
    await numeric(page);
    await preview(page);
    const out = expected(p),
      pose = reference(out.layers[0].liveMotionSpans![0].path!);
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
    await commit(page, f, out);
  });
test('numeric waypoint handle direct commit reopens saved controls without normalization', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await commit(page, f);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live waypoint handles…', exact: true }).click();
  await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('48');
  await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('52');
});
for (const axis of ['X', 'Y'])
  test(`numeric waypoint handle raw ${axis} rejects NaN with recovery`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle document ' + axis).fill('');
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText(/finite|choose/i);
    expect(await f.read()).toEqual(f.p);
    await numeric(page);
    await commit(page, f);
  });
for (const number of ['0', '3', '1.5'])
  test(`numeric waypoint handle invalid index ${number} cannot truncate or publish`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle number').fill(number);
    await expect(
      page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live waypoint handle number').fill('1');
    await numeric(page);
    await commit(page, f);
  });
test('numeric waypoint handle keeps no-op and opted-in tangent bearing rejection with valid recovery', async ({
  page,
}) => {
  const f = await setup(page, fixture('custom-tangent'));
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  await expect(page.getByLabel('Live waypoint handle status')).toContainText(/unchanged/);
  await numeric(page, 48, 60);
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  await expect(page.getByLabel('Live waypoint handle status')).toContainText(/join|tangent/);
  expect(await f.read()).toEqual(f.p);
  await numeric(page);
  await commit(page, f);
});
test('numeric waypoint handle prepared remembered children change only presentation and preserve library', async ({
  page,
}) => {
  const p = fixture();
  const lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live waypoint handle remembered children').check();
  await numeric(page);
  await preview(page);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  await commit(page, f);
  expect((await f.read()).symbols).toEqual(p.symbols);
});
test('numeric waypoint handle owns later-track complete membership and preserves earlier source', async ({
  page,
}) => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  const f = await setup(page, p);
  await page.getByLabel('Live waypoint handle root').selectOption('2');
  await numeric(page);
  await commit(page, f, expected(p, { x: 48, y: 52 }, 0, 1, 'outgoing', 1));
});
test('numeric waypoint handle canvas gestures stay nonauthoring and Escape discards only preview', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await preview(page);
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.move(b.x + 80, b.y + 80);
  await page.mouse.down();
  await page.mouse.move(b.x + 130, b.y + 90, { steps: 4 });
  await page.mouse.up();
  expect(await f.canvas.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Live waypoint handle status')).toContainText('discarded');
  await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('48');
  await commit(page, f);
});
for (const action of ['target', 'root', 'index', 'role', 'frame', 'source', 'close'])
  test(`numeric waypoint handle stale ${action} invalidates proposal before publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page);
    await preview(page);
    if (action === 'target') await page.getByLabel('Live waypoint handle document X').fill('58');
    if (action === 'root') await page.getByLabel('Live waypoint handle root').selectOption('1');
    if (action === 'index') await page.getByLabel('Live waypoint handle number').fill('2');
    if (action === 'role')
      await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    if (action === 'frame')
      await page.getByRole('button', { name: 'Next frame', exact: true }).click();
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
        .click();
    if (action === 'source')
      await page.getByLabel('Layer name', { exact: true }).evaluate((n) => {
        (n as HTMLInputElement).value = 'Independent handle source';
        n.dispatchEvent(new Event('change', { bubbles: true }));
      });
    const out = structuredClone(f.p);
    if (action === 'source') out.layers[0].name = 'Independent handle source';
    expect(await f.read()).toEqual(out);
    if (['frame', 'source', 'close'].includes(action)) await expect(f.panel).toBeHidden();
    else
      await expect(page.getByLabel('Live waypoint handle status')).not.toContainText('Unapplied');
    expect(f.errors).toEqual([]);
  });
for (const phase of ['candidate', 'recovery'] as const)
  for (const action of [
    'target-restored',
    'index-restored',
    'root-restored',
    'role-restored',
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
            if (
              wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]
                ?.x === 20
            )
              seen = true;
            if (
              !hit &&
              inClick &&
              (phase === 'candidate'
                ? candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
                  20
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
                input('Live waypoint handle document X', '999');
                input('Live waypoint handle document X', '48');
              }
              if (action === 'index-restored') {
                input('Live waypoint handle number', '2');
                input('Live waypoint handle number', '1');
                input('Live waypoint handle document X', '48');
                input('Live waypoint handle document Y', '52');
              }
              if (action === 'root-restored') {
                input('Live waypoint handle root', '1', 'change');
                input('Live waypoint handle root', '0', 'change');
                input('Live waypoint handle document X', '48');
                input('Live waypoint handle document Y', '52');
              }
              if (action === 'role-restored') {
                input('Live waypoint handle role', 'incoming', 'change');
                input('Live waypoint handle role', 'outgoing', 'change');
                input('Live waypoint handle document X', '48');
                input('Live waypoint handle document Y', '52');
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
                        ? 'Close live waypoint handle positions'
                        : 'Commit live waypoint handle'),
                  )!
                  .click();
            }
            return out;
          }) as typeof stringify;
        },
        { phase, action },
      );
      await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
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
        await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('48');
        await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('52');
        await page
          .getByRole('button', { name: 'Commit live waypoint handle', exact: true })
          .click();
        await expect(f.panel).toBeHidden();
        const retry = structuredClone(f.p);
        (
          retry.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[]
        )[1] = {
          x: 20,
          y: 10,
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
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(f.p);
  (expected.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[])[1] =
    {
      x: -108,
      y: 10,
    };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});
for (const getterField of ['waypointIndex', 'role'])
  test(`cloned waypoint ${getterField} input accessors reject with zero reads and allow a fresh numeric retry`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page);
    await page.evaluate((getterField) => {
      const native = structuredClone;
      let hit = false;
      Object.assign(window, { waypointGetterReads: 0, waypointGetterHit: false });
      window.structuredClone = <T>(value: T): T => {
        const out = native(value),
          raw = out as { pick?: { waypointIndex?: number }; target?: { x?: number } };
        if (!hit && raw?.pick?.waypointIndex === 0 && raw.target?.x === 48) {
          hit = true;
          Object.assign(window, { waypointGetterHit: true });
          Object.defineProperty(raw.pick, getterField, {
            enumerable: true,
            get() {
              (window as unknown as { waypointGetterReads: number }).waypointGetterReads++;
              return 0;
            },
          });
        }
        return out;
      };
    }, getterField);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
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
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(f.panel).toBeHidden();
    const expected = structuredClone(f.p);
    (
      expected.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[]
    )[1] = {
      x: 20,
      y: 10,
    };
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });
for (const corruption of ['geometry', 'prototype', 'library'])
  test(`final waypoint ${corruption} candidate corruption after recovery serialization rejects and preserves fresh history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page);
    await page.evaluate((corruption) => {
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
        if (
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 20
        )
          seen = true;
        if (
          !hit &&
          inClick &&
          seen &&
          candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 20
        ) {
          hit = true;
          Object.assign(window, { waypointFinalHit: true });
          if (corruption === 'geometry') candidate.layers[0].keys[0].shapes[0].x = 999;
          else if (corruption === 'prototype')
            Object.setPrototypeOf(candidate.layers[0].keys[0].shapes[0], { forged: true });
          else
            candidate.symbols = [
              {
                id: 'forged',
                name: 'Forged',
                width: 1,
                height: 1,
                shapes: [{ ...candidate.layers[0].keys[0].shapes[0] }],
              },
            ];
        }
        return out;
      }) as typeof stringify;
    }, corruption);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { waypointFinalHit: boolean }).waypointFinalHit,
      ),
    ).toBe(true);
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(f.panel).toBeHidden();
    const expected = structuredClone(f.p);
    (
      expected.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[]
    )[1] = {
      x: 20,
      y: 10,
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
    await page.getByRole('button', { name: 'Preview live waypoint handle', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { waypointFontHeld: boolean }).waypointFontHeld),
      )
      .toBe(true);
    await expect(page.getByLabel('Live waypoint handle status')).toContainText('Preparing');
    expect(await f.read()).toEqual(f.p);
    if (action === 'target') await page.getByLabel('Live waypoint handle document X').fill('58');
    else
      await page
        .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
        .click();
    await page.evaluate(() => {
      (window as unknown as { waypointFontRelease: () => void }).waypointFontRelease();
    });
    await f.canvas.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    expect(await f.read()).toEqual(f.p);
    const source = reference(f.p.layers[0].liveMotionSpans![0].path!);
    await expect
      .poll(() => pixel(page, f.p, source.x + 10, source.y + 10))
      .toEqual([255, 0, 0, 255]);
    if (action === 'target')
      await expect(page.getByLabel('Live waypoint handle status')).not.toContainText('Unapplied');
    else {
      await expect(f.panel).toBeHidden();
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page.getByRole('button', { name: 'Edit live waypoint handles…', exact: true }).click();
    }
    await numeric(page, 48, 52);
    await page.getByRole('button', { name: 'Preview live waypoint handle', exact: true }).click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(f.panel).toBeHidden();
    const expected = structuredClone(f.p);
    (
      expected.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[]
    )[1] = {
      x: 20,
      y: 10,
    };
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });

for (const mode of ['automatic', 'mirrored'])
  test(`numeric waypoint handle ${mode} paths cannot silently materialize independent handles`, async ({
    page,
  }) => {
    const p = fixture();
    delete p.layers[0].liveMotionSpans![0].path!.waypointIncoming;
    if (mode === 'automatic') delete p.layers[0].liveMotionSpans![0].path!.waypointTangents;
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByLabel('Timeline frames', { exact: true }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit live waypoint handles…', exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
    ).toEqual(p);
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
    .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live curve controls…', exact: true }).click();
  await page.getByLabel('Drag live curve controls', { exact: true }).check();
  await page.getByLabel('Author live curve on release', { exact: true }).check();
  await page.getByRole('button', { name: 'Close live curve controls', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live waypoint handles…', exact: true }).click();
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
  await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('48');
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  await expect(f.panel).toBeHidden();
  const expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[])[1] =
    {
      x: 20,
      y: 10,
    };
  expect(await f.read()).toEqual(expected);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});

test('numeric waypoint handle raw history snapshot rejects getters before history transport and permits retry', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page.evaluate(() => {
    const native = structuredClone;
    let inClick = false,
      edited = false,
      hit = false;
    Object.assign(window, { handleBeforeHit: false, handleBeforeReads: 0 });
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
    window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
      const out = Reflect.apply(native, window, [value, ...rest]),
        q = out as Project,
        x = q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x;
      if (inClick && x === 20) edited = true;
      if (inClick && edited && x === 10 && !hit) {
        hit = true;
        Object.assign(window, { handleBeforeHit: true });
        Object.defineProperty(q.layers[0].keys[0].shapes[0], 'width', {
          enumerable: true,
          get() {
            (window as unknown as { handleBeforeReads: number }).handleBeforeReads++;
            return 20;
          },
        });
      }
      return out;
    }) as typeof native;
  });
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { handleBeforeHit: boolean }).handleBeforeHit),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { handleBeforeReads: number }).handleBeforeReads,
    ),
  ).toBe(0);
  expect(await f.read()).toEqual(f.p);
  await commit(page, f);
});

test('numeric waypoint handle original stems and proposal markers follow private role ownership', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await preview(page);
  await expect.poll(() => pixel(page, f.p, 48, 52)).toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Live waypoint handle role').selectOption('incoming');
  await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('8');
  await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('32');
  await expect.poll(() => pixel(page, f.p, 48, 52)).toEqual([255, 0, 0, 255]);
  const marker = () =>
    f.canvas.evaluate((node, p) => {
      const c = node as HTMLCanvasElement,
        d = devicePixelRatio,
        ctx = c.getContext('2d')!,
        data = ctx.getImageData(
          c.width / 2 + (3 - p.width / 2) * d,
          c.height / 2 + (27 - p.height / 2) * d,
          10 * d,
          10 * d,
        ).data;
      let cyan = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i] < 30 &&
          data[i + 1] > 90 &&
          data[i + 1] < 170 &&
          data[i + 2] > 140 &&
          data[i + 2] < 210
        )
          cyan++;
      return cyan;
    }, f.p);
  await expect.poll(marker).toBeGreaterThan(8);
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 18, 37);
  await commit(page, f, expected(f.p, { x: 18, y: 37 }, 0, 1, 'incoming'));
});

for (const basis of ['plain', 'affine', 'reflected'])
  test(`numeric waypoint handle aligned compound ${basis} retains topology and actual pixels`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('78');
    await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('82');
    await numeric(page, 88, 87);
    await preview(page);
    const out = expected(p, { x: 88, y: 87 }, 1, 2, 'incoming'),
      pose = reference(out.layers[0].liveMotionSpans![0].path!),
      angle = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
      bx = basis === 'plain' ? 2 : (basis === 'reflected' ? -2 : 2) * 2 + 1,
      by = basis === 'plain' ? 2 : 6.5;
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + Math.cos(angle) * bx - Math.sin(angle) * by,
          pose.y + Math.sin(angle) * bx + Math.cos(angle) * by,
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await commit(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });

async function handlePoint(page: Page, p: Project, x: number, y: number) {
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
async function handleCapture(page: Page) {
  return page
    .getByLabel('Drawing stage', { exact: true })
    .evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1));
}
async function handleDrag(
  page: Page,
  p: Project,
  x: number,
  y: number,
  dx = 20,
  dy = 10,
  shift = false,
) {
  const a = await handlePoint(page, p, x, y),
    b = await handlePoint(page, p, x + dx, y + dy);
  await page.mouse.move(a.x + 2, a.y - 1);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 2, b.y - 1, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  expect(await handleCapture(page)).toBe(false);
  await expect(page.getByLabel('Live waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const slot of [1, 2])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`canvas waypoint handle ${basis}/${root}/${slot}/${role} drafts then explicitly commits exact controls`, async ({
          page,
        }) => {
          const p = fixture('custom', basis),
            f = await setup(page, p);
          await expect(
            page.getByLabel('Drag live waypoint handles', { exact: true }),
          ).not.toBeChecked();
          await page.getByLabel('Live waypoint handle root').selectOption(String(root));
          await page.getByLabel('Live waypoint handle number').fill(String(slot));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
            y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue());
          await page.getByLabel('Drag live waypoint handles', { exact: true }).check();
          await handleDrag(page, p, x, y);
          await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue(String(x));
          await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue(String(y));
          expect(await f.read()).toEqual(p);
          const out = expected(p, { x: x + 20, y: y + 10 }, root, slot, role),
            pose = reference(out.layers[0].liveMotionSpans![0].path!);
          await expect
            .poll(() =>
              f.canvas.evaluate(
                (node, { p, pose, basis, root }) => {
                  const c = node as HTMLCanvasElement,
                    ctx = c.getContext('2d')!,
                    d = devicePixelRatio,
                    theta = basis === 'plain' ? 0 : (25 * Math.PI) / 180;
                  let hits = 0;
                  for (const lx of [4, 8, 12, 16])
                    for (const ly of [4, 8, 12, 16]) {
                      const bx =
                          basis === 'plain' ? lx : (basis === 'reflected' ? -2 : 2) * lx + 0.5 * ly,
                        by = basis === 'plain' ? ly : 0.25 * lx + 3 * ly;
                      const x = pose.x + root * 40 + Math.cos(theta) * bx - Math.sin(theta) * by,
                        y = pose.y + root * 30 + Math.sin(theta) * bx + Math.cos(theta) * by;
                      const pixel = ctx.getImageData(
                        c.width / 2 + (x - p.width / 2) * d,
                        c.height / 2 + (y - p.height / 2) * d,
                        1,
                        1,
                      ).data;
                      if (
                        pixel[0] === (root ? 0 : 255) &&
                        pixel[1] === 0 &&
                        pixel[2] === (root ? 255 : 0) &&
                        pixel[3] === 255
                      )
                        hits++;
                    }
                  return hits;
                },
                { p, pose, basis, root },
              ),
            )
            .toBeGreaterThan(2);
          await page
            .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
            .click();
          await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue(
            String(x + 20),
          );
          await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue(
            String(y + 10),
          );
          await commit(page, f, out);
        });
for (const action of ['escape', 'loss', 'policy', 'zero', 'return'] as const)
  test(`canvas waypoint handle ${action} cleans native capture and restores independent numeric preview`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page, 48, 52);
    await preview(page);
    await page.getByLabel('Drag live waypoint handles', { exact: true }).check();
    const a = await handlePoint(page, f.p, 38, 47),
      b = await handlePoint(page, f.p, 58, 57);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await handleCapture(page)).toBe(true);
    if (action !== 'zero') await page.mouse.move(b.x, b.y, { steps: 5 });
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'policy')
      await page.getByLabel('Drag live waypoint handles').evaluate((c) => {
        const i = c as HTMLInputElement;
        i.checked = false;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    if (action === 'return') await page.mouse.move(a.x, a.y, { steps: 5 });
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('48');
    await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('52');
    await commit(page, f);
  });
for (const action of ['target', 'root', 'index', 'role', 'close', 'frame'] as const)
  test(`canvas waypoint handle ${action} invalidates an active capture without publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    const a = await handlePoint(page, f.p, 38, 47),
      b = await handlePoint(page, f.p, 58, 57);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await handleCapture(page)).toBe(true);
    await page.mouse.move(b.x, b.y, { steps: 5 });
    if (action === 'target') await page.getByLabel('Live waypoint handle document X').fill('99');
    if (action === 'root') await page.getByLabel('Live waypoint handle root').selectOption('1');
    if (action === 'index') await page.getByLabel('Live waypoint handle number').fill('2');
    if (action === 'role')
      await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
        .click();
    if (action === 'frame') {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
    }
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const shift of [false, true])
  test(`canvas waypoint handle independent CSS axes preserve offsets and Shift ${shift}`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    await f.canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
    await handleDrag(page, f.p, 38, 47, 20, 10, shift);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
      y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue());
    expect(x).toBeCloseTo(58, 3);
    expect(y).toBeCloseTo(shift ? 47 : 57, 3);
    await commit(page, f, expected(f.p, { x, y }));
  });

test('canvas waypoint handle original/proposed markers retain private pick ownership and a released proposal', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoint handles').check();
  await expect.poll(() => pixel(page, f.p, 38, 47)).toEqual([255, 255, 255, 255]);
  await handleDrag(page, f.p, 38, 47, 40, 20);
  await expect.poll(() => pixel(page, f.p, 78, 67)).toEqual([0, 126, 170, 255]);
  await expect.poll(() => pixel(page, f.p, 38, 47)).toEqual([255, 255, 255, 255]);
  const proposed = await handlePoint(page, f.p, 78, 67);
  await page.mouse.move(proposed.x, proposed.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(false);
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('78');
  await commit(page, f, expected(f.p, { x: 78, y: 67 }));
});
for (const phase of ['initial', 'release'] as const)
  test(`canvas waypoint handle restored policy during ${phase} admission rejects then retries`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    const a = await handlePoint(page, f.p, 38, 47),
      b = await handlePoint(page, f.p, 58, 57);
    if (phase === 'release') {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      expect(await handleCapture(page)).toBe(true);
      await page.mouse.move(b.x, b.y, { steps: 3 });
    }
    await f.canvas.evaluate((node, phase) => {
      const canvas = node as HTMLCanvasElement,
        rect = canvas.getBoundingClientRect;
      let native = false,
        hit = false;
      Object.assign(window, { handlePolicyHit: false });
      canvas.addEventListener(
        phase === 'initial' ? 'pointerdown' : 'pointerup',
        () => {
          native = true;
        },
        { capture: true, once: true },
      );
      canvas.getBoundingClientRect = function () {
        const r = rect.call(this);
        if (native && !hit) {
          hit = true;
          this.getBoundingClientRect = rect;
          Object.assign(window, { handlePolicyHit: true });
          const c = document.querySelector(
            '[aria-label="Drag live waypoint handles"]',
          ) as HTMLInputElement;
          for (const checked of [false, true]) {
            c.checked = checked;
            c.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return r;
      };
    }, phase);
    if (phase === 'initial') {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
    }
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(
      await page.evaluate(
        () => (window as unknown as { handlePolicyHit: boolean }).handlePolicyHit,
      ),
    ).toBe(true);
    expect(await f.read()).toEqual(f.p);
    await handleDrag(page, f.p, 38, 47);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, expected(f.p, { x: 58, y: 57 }));
  });
test('canvas waypoint handle draft prepares remembered child pixels without rewriting the library', async ({
  page,
}) => {
  const p = fixture(),
    lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live waypoint handle remembered children').check();
  await page.getByLabel('Drag live waypoint handles').check();
  await handleDrag(page, p, 38, 47);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f, expected(p, { x: 58, y: 57 }));
  expect((await f.read()).symbols).toEqual(p.symbols);
});
test('canvas waypoint handle tangent-bearing failure retains source and permits radius-only recovery', async ({
  page,
}) => {
  const f = await setup(page, fixture('custom-tangent'));
  await page.getByLabel('Drag live waypoint handles').check();
  const a = await handlePoint(page, f.p, 38, 47),
    b = await handlePoint(page, f.p, 58, 67);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(true);
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  expect(await handleCapture(page)).toBe(false);
  await expect(page.getByLabel('Live waypoint handle status')).toContainText(/join|tangent/);
  expect(await f.read()).toEqual(f.p);
  await handleDrag(page, f.p, 38, 47, 10, 5);
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f);
});

for (const basis of ['plain', 'affine', 'reflected'])
  test(`canvas waypoint handle aligned compound ${basis} retains topology and actual pixels`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('78');
    await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('82');
    await page.getByLabel('Drag live waypoint handles').check();
    await handleDrag(page, p, 78, 82, 10, 5);
    const out = expected(p, { x: 88, y: 87 }, 1, 2, 'incoming'),
      pose = reference(out.layers[0].liveMotionSpans![0].path!),
      angle = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
      bx = basis === 'plain' ? 2 : (basis === 'reflected' ? -2 : 2) * 2 + 1,
      by = basis === 'plain' ? 2 : 6.5;
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + Math.cos(angle) * bx - Math.sin(angle) * by,
          pose.y + Math.sin(angle) * bx + Math.cos(angle) * by,
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });

async function beginHandleRelease(
  page: Page,
  f: Awaited<ReturnType<typeof setup>>,
  x = 38,
  y = 47,
  dx = 20,
  dy = 10,
  shift = false,
) {
  const a = await handlePoint(page, f.p, x, y),
    b = await handlePoint(page, f.p, x + dx, y + dy);
  await page.mouse.move(a.x + 2, a.y - 1);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(true);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
  return {
    a,
    b,
    finish: async () => {
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      expect(await handleCapture(page)).toBe(false);
    },
  };
}
async function authoredHandle(page: Page, f: Awaited<ReturnType<typeof setup>>, out: Project) {
  await expect(f.panel).toBeHidden();
  expect(await f.read()).toEqual(out);
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  await undoRedo(page, f, out);
  expect(f.errors).toEqual([]);
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const slot of [1, 2])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`release waypoint handle ${basis}/${root}/${slot}/${role} authors fresh exact controls and one history step`, async ({
          page,
        }) => {
          const f = await setup(page, fixture('custom', basis));
          await expect(page.getByLabel('Author live waypoint handle on release')).not.toBeChecked();
          await page.getByLabel('Live waypoint handle root').selectOption(String(root));
          await page.getByLabel('Live waypoint handle number').fill(String(slot));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
            y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue());
          await page.getByLabel('Drag live waypoint handles').check();
          await page.getByLabel('Author live waypoint handle on release').check();
          const g = await beginHandleRelease(page, f, x, y);
          expect(await f.read()).toEqual(f.p);
          await g.finish();
          await authoredHandle(page, f, expected(f.p, { x: x + 20, y: y + 10 }, root, slot, role));
        });
for (const phase of ['initial', 'release'] as const)
  for (const policy of ['gesture', 'authoring'] as const)
    test(`release waypoint handle restored ${policy} in ${phase} rejects and recovers fresh opted-out/opted-in`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.getByLabel('Drag live waypoint handles').check();
      await page.getByLabel('Author live waypoint handle on release').check();
      const a = await handlePoint(page, f.p, 38, 47);
      let g: Awaited<ReturnType<typeof beginHandleRelease>> | undefined;
      if (phase === 'release') g = await beginHandleRelease(page, f);
      await f.canvas.evaluate(
        (node, { phase, policy }) => {
          const c = node as HTMLCanvasElement,
            rect = c.getBoundingClientRect;
          let native = false,
            hit = false;
          Object.assign(window, { handleReleasePolicyHit: false });
          c.addEventListener(
            phase === 'initial' ? 'pointerdown' : 'pointerup',
            () => {
              native = true;
            },
            { once: true, capture: true },
          );
          c.getBoundingClientRect = function () {
            const r = rect.call(this);
            if (native && !hit) {
              hit = true;
              this.getBoundingClientRect = rect;
              Object.assign(window, { handleReleasePolicyHit: true });
              const input = document.querySelector(
                `[aria-label="${policy === 'gesture' ? 'Drag live waypoint handles' : 'Author live waypoint handle on release'}"]`,
              ) as HTMLInputElement;
              for (const checked of [false, true]) {
                input.checked = checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return r;
          };
        },
        { phase, policy },
      );
      if (phase === 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        await page.mouse.up();
      } else await g!.finish();
      expect(await handleCapture(page)).toBe(false);
      expect(
        await page.evaluate(
          () => (window as unknown as { handleReleasePolicyHit: boolean }).handleReleasePolicyHit,
        ),
      ).toBe(true);
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author live waypoint handle on release').uncheck();
      await handleDrag(page, f.p, 38, 47);
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author live waypoint handle on release').check();
      const fresh = await beginHandleRelease(page, f);
      await fresh.finish();
      await authoredHandle(page, f, expected(f.p, { x: 58, y: 57 }));
    });
for (const action of [
  'target',
  'source',
  'author-policy',
  'reenter-down',
  'reenter-move',
  'reenter-up',
] as const)
  test(`release waypoint handle late detached ${action} rejects after native cleanup`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    await page.getByLabel('Author live waypoint handle on release').check();
    const g = await beginHandleRelease(page, f);
    await page.evaluate((action) => {
      const native = structuredClone;
      let up = false,
        hit = false;
      Object.assign(window, { handleLateReleaseHit: false, handleLateReleaseClean: false });
      window.addEventListener(
        'pointerup',
        () => {
          up = true;
        },
        { capture: true, once: true },
      );
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          p = out as Project;
        if (
          up &&
          !hit &&
          p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30
        ) {
          hit = true;
          window.structuredClone = native;
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          Object.assign(window, {
            handleLateReleaseHit: true,
            handleLateReleaseClean: !c.hasPointerCapture(1),
          });
          const input = (label: string, value: string, event = 'input') => {
            const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            e.value = value;
            e.dispatchEvent(new Event(event, { bubbles: true }));
          };
          if (action === 'target') {
            input('Live waypoint handle document X', '99');
            input('Live waypoint handle document X', '38');
          }
          if (action === 'source') input('Layer name', 'Late handle source', 'change');
          if (action.startsWith('reenter-'))
            c.dispatchEvent(
              new PointerEvent('pointer' + action.slice(8), {
                pointerId: 1,
                isPrimary: true,
                pointerType: 'mouse',
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
                cancelable: true,
              }),
            );
          if (action === 'author-policy') {
            const c = document.querySelector(
              '[aria-label="Author live waypoint handle on release"]',
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              c.checked = checked;
              c.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return out;
      }) as typeof native;
    }, action);
    await g.finish();
    expect(
      await page.evaluate(
        () => (window as unknown as { handleLateReleaseHit: boolean }).handleLateReleaseHit,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as unknown as { handleLateReleaseClean: boolean }).handleLateReleaseClean,
      ),
    ).toBe(true);
    const out = structuredClone(f.p);
    if (action === 'source') out.layers[0].name = 'Late handle source';
    expect(await f.read()).toEqual(out);
    if (action !== 'source') {
      const retry = await beginHandleRelease(page, f);
      await retry.finish();
      await authoredHandle(page, f, expected(f.p, { x: 58, y: 57 }));
    } else {
      if (await f.panel.isVisible())
        await page
          .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
          .click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    }
  });
for (const action of ['zero', 'return', 'escape', 'loss', 'disabled'] as const)
  test(`release waypoint handle ${action} never publishes`, async ({ page }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    await page.getByLabel('Author live waypoint handle on release').check();
    const a = await handlePoint(page, f.p, 38, 47);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await handleCapture(page)).toBe(true);
    if (action !== 'zero') {
      const b = await handlePoint(page, f.p, 58, 57);
      await page.mouse.move(b.x, b.y, { steps: 3 });
    }
    if (action === 'return') await page.mouse.move(a.x, a.y, { steps: 3 });
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'disabled')
      await page.getByLabel('Author live waypoint handle on release').evaluate((c) => {
        const e = c as HTMLInputElement;
        e.checked = false;
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const action of ['target', 'root', 'index', 'role', 'frame', 'close', 'view'] as const)
  test(`release waypoint handle actual ${action} change rejects stale publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    await page.getByLabel('Author live waypoint handle on release').check();
    const g = await beginHandleRelease(page, f);
    if (action === 'target') await page.getByLabel('Live waypoint handle document X').fill('99');
    if (action === 'root') await page.getByLabel('Live waypoint handle root').selectOption('1');
    if (action === 'index') await page.getByLabel('Live waypoint handle number').fill('2');
    if (action === 'role')
      await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    if (action === 'frame') {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
    }
    if (action === 'close') {
      await page
        .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
        .focus();
      await page.keyboard.press('Enter');
      await expect(f.panel).toBeHidden();
      expect(await handleCapture(page)).toBe(false);
    }
    if (action === 'view')
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'translateX(5px)';
      });
    await g.finish();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const shift of [false, true])
  test(`release waypoint handle CSS/offset/Shift${shift} authors correct document target`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Drag live waypoint handles').check();
    await page.getByLabel('Author live waypoint handle on release').check();
    await f.canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
    const g = await beginHandleRelease(page, f, 38, 47, 20, 10, shift);
    await g.finish();
    const out = await f.read();
    expect(out.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x).toBeCloseTo(30, 3);
    expect(out.layers[0].liveMotionSpans![0].path!.waypointTangents![1].y).toBeCloseTo(
      shift ? 5 : 15,
      3,
    );
    await authoredHandle(page, f, out);
  });

for (const basis of ['plain', 'affine', 'reflected'])
  test(`release waypoint handle aligned compound ${basis} retains topology and actual pixels`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('78');
    await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('82');
    await page.getByLabel('Drag live waypoint handles').check();
    await page.getByLabel('Author live waypoint handle on release').check();
    const gesture = await beginHandleRelease(page, f, 78, 82, 10, 5);
    const out = expected(p, { x: 88, y: 87 }, 1, 2, 'incoming'),
      pose = reference(out.layers[0].liveMotionSpans![0].path!),
      angle = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
      bx = basis === 'plain' ? 2 : (basis === 'reflected' ? -2 : 2) * 2 + 1,
      by = basis === 'plain' ? 2 : 6.5;
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + Math.cos(angle) * bx - Math.sin(angle) * by,
          pose.y + Math.sin(angle) * bx + Math.cos(angle) * by,
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await gesture.finish();
    await authoredHandle(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });

test('release waypoint handle remembered-child pixels are prepared before one exact publication', async ({
  page,
}) => {
  const p = fixture(),
    lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await page.getByLabel('Live waypoint handle remembered children').check();
  await page.getByLabel('Drag live waypoint handles').check();
  await page.getByLabel('Author live waypoint handle on release').check();
  const g = await beginHandleRelease(page, f);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  await g.finish();
  await authoredHandle(page, f, expected(p, { x: 58, y: 57 }));
  expect((await f.read()).symbols).toEqual(p.symbols);
});

function alignedExpected(
  p: Project,
  q: { x: number; y: number },
  root = 0,
  slot = 1,
  role = 'outgoing',
) {
  const out = expected(p, q, root, slot, role),
    path = p.layers[0].liveMotionSpans![0].path!,
    origin = p.layers[0].keys[0].shapes[root],
    w = path.waypoints![slot - 1],
    dx = q.x - origin.x - w.x,
    dy = q.y - origin.y - w.y,
    scale = Math.max(Math.abs(dx), Math.abs(dy)),
    length = Math.hypot(dx / scale, dy / scale),
    opposite =
      role === 'incoming' ? path.waypointTangents![slot] : path.waypointIncoming![slot - 1],
    radius = Math.hypot(opposite.x, opposite.y),
    next =
      radius === 0
        ? { ...opposite }
        : { x: (-(dx / scale) / length) * radius, y: (-(dy / scale) / length) * radius };
  if (role === 'incoming')
    (out.layers[0].liveMotionSpans![0].path!.waypointTangents as { x: number; y: number }[])[slot] =
      next;
  else
    (out.layers[0].liveMotionSpans![0].path!.waypointIncoming as { x: number; y: number }[])[
      slot - 1
    ] = next;
  return out;
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const slot of [1, 2])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`paired numeric waypoint ${basis}/${root}/${slot}/${role} shows admitted opposite controls and commits exact shared geometry`, async ({
          page,
        }) => {
          const p = fixture('custom', basis),
            f = await setup(page, p);
          await expect(page.getByLabel('Live waypoint handle coupling')).toHaveValue('independent');
          await page.getByLabel('Live waypoint handle root').selectOption(String(root));
          await page.getByLabel('Live waypoint handle number').fill(String(slot));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const a = p.layers[0].keys[0].shapes[root],
            w = p.layers[0].liveMotionSpans![0].path!.waypoints![slot - 1],
            sign = role === 'incoming' ? -1 : 1,
            q = { x: a.x + w.x + 15 * sign, y: a.y + w.y + 20 * sign },
            out = alignedExpected(p, q, root, slot, role),
            path = out.layers[0].liveMotionSpans![0].path!,
            op =
              role === 'incoming' ? path.waypointTangents![slot] : path.waypointIncoming![slot - 1],
            old =
              role === 'incoming'
                ? p.layers[0].liveMotionSpans![0].path!.waypointTangents![slot]
                : p.layers[0].liveMotionSpans![0].path!.waypointIncoming![slot - 1];
          await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
          await numeric(page, q.x, q.y);
          await preview(page);
          expect(await f.read()).toEqual(p);
          await expect.poll(() => pixel(page, p, q.x, q.y)).toEqual([0, 126, 170, 255]);
          const d = Math.hypot(op.x - old.x, op.y - old.y),
            probe = {
              x: a.x + w.x + op.x + (op.x - old.x) / d,
              y: a.y + w.y + op.y + (op.y - old.y) / d,
            };
          await expect.poll(() => pixel(page, p, probe.x, probe.y)).toEqual([0, 126, 170, 255]);
          const pose = reference(path);
          await expect
            .poll(() =>
              f.canvas.evaluate(
                (node, { p, pose, basis, root }) => {
                  const c = node as HTMLCanvasElement,
                    ctx = c.getContext('2d')!,
                    d = devicePixelRatio,
                    t = basis === 'plain' ? 0 : (25 * Math.PI) / 180;
                  let hits = 0;
                  for (const x of [4, 8, 12, 16])
                    for (const y of [4, 8, 12, 16]) {
                      const bx =
                          basis === 'plain' ? x : (basis === 'reflected' ? -2 : 2) * x + 0.5 * y,
                        by = basis === 'plain' ? y : 0.25 * x + 3 * y,
                        px = pose.x + root * 40 + Math.cos(t) * bx - Math.sin(t) * by,
                        py = pose.y + root * 30 + Math.sin(t) * bx + Math.cos(t) * by,
                        pixel = ctx.getImageData(
                          c.width / 2 + (px - p.width / 2) * d,
                          c.height / 2 + (py - p.height / 2) * d,
                          1,
                          1,
                        ).data;
                      if (
                        pixel[0] === (root ? 0 : 255) &&
                        pixel[1] === 0 &&
                        pixel[2] === (root ? 255 : 0) &&
                        pixel[3] === 255
                      )
                        hits++;
                    }
                  return hits;
                },
                { p, pose, basis, root },
              ),
            )
            .toBeGreaterThan(2);
          await commit(page, f, out);
          const saved = (await f.read()).layers[0].liveMotionSpans![0].path!,
            actual =
              role === 'incoming'
                ? saved.waypointTangents![slot]
                : saved.waypointIncoming![slot - 1];
          expect(Math.hypot(actual.x, actual.y)).toBeCloseTo(Math.hypot(old.x, old.y), 12);
        });
for (const mode of ['custom-tangent', 'custom-distance-tangent'])
  test(`paired numeric waypoint ${mode} permits a coupled turn while keeping independent rejection`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(mode));
    await numeric(page, 43, 62);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText(/join|tangent/);
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('43');
    await preview(page);
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
test('paired numeric waypoint blocks retained independent release publication and preserves explicit target authority', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoint handles').check();
  await page.getByLabel('Author live waypoint handle on release').check();
  await numeric(page, 43, 62);
  await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
  await expect(page.getByLabel('Drag live waypoint handles')).toBeChecked();
  await expect(page.getByLabel('Drag live waypoint handles')).toBeEnabled();
  await expect(page.getByLabel('Author live waypoint handle on release')).toBeChecked();
  await expect(page.getByLabel('Author live waypoint handle on release')).toBeDisabled();
  await preview(page);
  const a = await handlePoint(page, f.p, 38, 47),
    b = await handlePoint(page, f.p, 58, 57);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(true);
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await expect(
    page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
  ).toBeEnabled();
  await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
test('paired numeric waypoint changing and restoring mode cancels an active independent authoring capture', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Drag live waypoint handles').check();
  await page.getByLabel('Author live waypoint handle on release').check();
  const g = await beginHandleRelease(page, f);
  await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
  expect(await handleCapture(page)).toBe(false);
  await page.getByLabel('Live waypoint handle coupling').selectOption('independent');
  await g.finish();
  expect(await f.read()).toEqual(f.p);
  const fresh = await beginHandleRelease(page, f);
  await fresh.finish();
  await authoredHandle(page, f, expected(f.p, { x: 58, y: 57 }));
});
test('paired numeric waypoint prepared children preserve the original library and exact history', async ({
  page,
}) => {
  const p = fixture(),
    lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live waypoint handle remembered children').check();
  await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
  await numeric(page, 43, 62);
  await preview(page);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  await commit(page, f, alignedExpected(p, { x: 43, y: 62 }));
  expect((await f.read()).symbols).toEqual(p.symbols);
});
for (const action of ['no-op', 'zero', 'invalid mode'] as const)
  test(`paired numeric waypoint ${action} rejects without geometry loss and permits recovery`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    if (action === 'zero') await numeric(page, 28, 42);
    if (action === 'invalid mode')
      await page.getByLabel('Live waypoint handle coupling').evaluate((c) => {
        const select = c as HTMLSelectElement,
          o = new Option('Forged', 'forged');
        select.add(o);
        select.value = 'forged';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText(
      /unchanged|zero|coupling|aligned|independent/,
    );
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await numeric(page, 43, 62);
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
for (const phase of ['preview', 'commit'] as const)
  for (const action of [
    'mode-restored',
    'target-restored',
    'role-restored',
    'root-restored',
    'index-restored',
    'frame',
    'frame-restored',
    'source',
    'close',
  ] as const)
    test(`paired numeric waypoint late ${phase}/${action} rejects after detached control preparation`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
      await numeric(page, 43, 62);
      await page.evaluate((action) => {
        const native = structuredClone;
        let click = false,
          hit = false;
        Object.assign(window, { pairedNumericLateHit: false });
        window.addEventListener(
          'click',
          () => {
            click = true;
          },
          { once: true, capture: true },
        );
        window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
          const out = Reflect.apply(native, window, [value, ...rest]),
            p = out as Project;
          if (
            click &&
            !hit &&
            p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 15
          ) {
            hit = true;
            window.structuredClone = native;
            Object.assign(window, { pairedNumericLateHit: true });
            const input = (label: string, value: string, event = 'input') => {
              const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
              e.value = value;
              e.dispatchEvent(new Event(event, { bubbles: true }));
            };
            if (action === 'mode-restored') {
              input('Live waypoint handle coupling', 'independent', 'change');
              input('Live waypoint handle coupling', 'aligned', 'change');
            }
            if (action === 'target-restored') {
              input('Live waypoint handle document X', '99');
              input('Live waypoint handle document X', '43');
            }
            if (action === 'role-restored') {
              input('Live waypoint handle role', 'incoming', 'change');
              input('Live waypoint handle role', 'outgoing', 'change');
              input('Live waypoint handle document X', '43');
              input('Live waypoint handle document Y', '62');
            }
            if (action === 'root-restored') {
              input('Live waypoint handle root', '1', 'change');
              input('Live waypoint handle root', '0', 'change');
              input('Live waypoint handle document X', '43');
              input('Live waypoint handle document Y', '62');
            }
            if (action === 'index-restored') {
              input('Live waypoint handle number', '2');
              input('Live waypoint handle number', '1');
              input('Live waypoint handle document X', '43');
              input('Live waypoint handle document Y', '62');
            }
            if (action === 'frame' || action === 'frame-restored') {
              [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'Next frame')!
                .click();
              if (action === 'frame-restored')
                [...document.querySelectorAll('button')]
                  .find((b) => b.textContent === 'Previous frame')!
                  .click();
            }
            if (action === 'source') input('Layer name', 'Paired late source', 'change');
            if (action === 'close')
              [...document.querySelectorAll('button')]
                .find((b) => b.textContent === 'Close live waypoint handle positions')!
                .click();
          }
          return out;
        }) as typeof native;
      }, action);
      await page
        .getByRole('button', {
          name:
            phase === 'preview' ? 'Preview live waypoint handle' : 'Commit live waypoint handle',
          exact: true,
        })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { pairedNumericLateHit: boolean }).pairedNumericLateHit,
        ),
      ).toBe(true);
      const out = structuredClone(f.p);
      if (action === 'source') out.layers[0].name = 'Paired late source';
      expect(await f.read()).toEqual(out);
      if (action === 'frame' || action === 'frame-restored') {
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue(
          action === 'frame' ? '6' : '5',
        );
        await expect(f.panel).toBeHidden();
      }
      if (
        action !== 'source' &&
        action !== 'close' &&
        action !== 'frame' &&
        action !== 'frame-restored'
      ) {
        await numeric(page, 43, 62);
        await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
      }
    });

for (const basis of ['plain', 'affine', 'reflected'])
  test(`paired numeric waypoint aligned compound ${basis} retains topology and actual pixels`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue('78');
    await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue('82');
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await numeric(page, 88, 87);
    await preview(page);
    const out = alignedExpected(p, { x: 88, y: 87 }, 1, 2, 'incoming'),
      pose = reference(out.layers[0].liveMotionSpans![0].path!),
      angle = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
      bx = basis === 'plain' ? 2 : (basis === 'reflected' ? -2 : 2) * 2 + 1,
      by = basis === 'plain' ? 2 : 6.5;
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + Math.cos(angle) * bx - Math.sin(angle) * by,
          pose.y + Math.sin(angle) * bx + Math.cos(angle) * by,
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await commit(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });

for (const mode of ['changed', 'getter'] as const)
  test(`paired numeric waypoint raw transported ${mode} coupling rejects before ownership and retries`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await numeric(page, 43, 62);
    await page.evaluate((mode) => {
      const native = structuredClone;
      let hit = false;
      Object.assign(window, { pairedRawHit: false, pairedRawReads: 0 });
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          q = out as { coupling?: string; target?: { x: number }; pick?: { role: string } };
        if (
          !hit &&
          q?.coupling === 'aligned' &&
          q.target?.x === 43 &&
          q.pick?.role === 'outgoing'
        ) {
          hit = true;
          window.structuredClone = native;
          Object.assign(window, { pairedRawHit: true });
          if (mode === 'changed') q.coupling = 'independent';
          else
            Object.defineProperty(q, 'coupling', {
              enumerable: true,
              get() {
                (window as unknown as { pairedRawReads: number }).pairedRawReads++;
                return 'aligned';
              },
            });
        }
        return out;
      }) as typeof native;
    }, mode);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { pairedRawHit: boolean }).pairedRawHit),
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as unknown as { pairedRawReads: number }).pairedRawReads),
    ).toBe(0);
    expect(await f.read()).toEqual(f.p);
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
for (const mode of ['getter', 'prototype', 'reentry'] as const)
  test(`paired numeric waypoint raw candidate ${mode} rejects with source-valid retry`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await numeric(page, 43, 62);
    await page.evaluate((mode) => {
      const native = structuredClone;
      let click = false,
        hit = false;
      Object.assign(window, { pairedCandidateHit: false, pairedCandidateReads: 0 });
      window.addEventListener(
        'click',
        () => {
          click = true;
        },
        { capture: true, once: true },
      );
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          q = out as Project;
        if (
          click &&
          !hit &&
          q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 15
        ) {
          hit = true;
          window.structuredClone = native;
          Object.assign(window, { pairedCandidateHit: true });
          if (mode === 'getter')
            Object.defineProperty(q.layers[0].keys[0].shapes[0], 'width', {
              enumerable: true,
              get() {
                (window as unknown as { pairedCandidateReads: number }).pairedCandidateReads++;
                return 20;
              },
            });
          if (mode === 'prototype')
            Object.setPrototypeOf(q.layers[0].keys[0].shapes[0], { forged: true });
          if (mode === 'reentry')
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent === 'Commit live waypoint handle')!
              .click();
        }
        return out;
      }) as typeof native;
    }, mode);
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedCandidateHit: boolean }).pairedCandidateHit,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedCandidateReads: number }).pairedCandidateReads,
      ),
    ).toBe(0);
    expect(await f.read()).toEqual(f.p);
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
test('paired numeric waypoint history source raw getter rejects before transport with zero reads', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
  await numeric(page, 43, 62);
  await page.evaluate(() => {
    const native = structuredClone;
    let armed = false,
      hit = false;
    Object.assign(window, { pairedHistoryHit: false, pairedHistoryReads: 0 });
    window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
      const out = Reflect.apply(native, window, [value, ...rest]),
        q = out as Project,
        x = q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x;
      if (x === 15) armed = true;
      if (armed && !hit && x === 10) {
        hit = true;
        window.structuredClone = native;
        Object.assign(window, { pairedHistoryHit: true });
        Object.defineProperty(q.layers[0].keys[0].shapes[0], 'width', {
          enumerable: true,
          get() {
            (window as unknown as { pairedHistoryReads: number }).pairedHistoryReads++;
            return 20;
          },
        });
      }
      return out;
    }) as typeof native;
  });
  await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { pairedHistoryHit: boolean }).pairedHistoryHit,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { pairedHistoryReads: number }).pairedHistoryReads,
    ),
  ).toBe(0);
  expect(await f.read()).toEqual(f.p);
  await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
for (const axis of ['X', 'Y'] as const)
  test(`paired numeric waypoint empty ${axis} rejects and recovers without dropping controls`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
    await page.getByLabel('Live waypoint handle document ' + axis).fill('');
    await page.getByRole('button', { name: 'Commit live waypoint handle', exact: true }).click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText(/finite/);
    expect(await f.read()).toEqual(f.p);
    await numeric(page, 43, 62);
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });

async function pairedDraft(page: Page) {
  await page.getByLabel('Live waypoint handle coupling').selectOption('aligned');
  await page.getByLabel('Drag live waypoint handles').check();
  await expect(page.getByLabel('Author live waypoint handle on release')).toBeDisabled();
}
async function pairedDraftMarkers(
  page: Page,
  p: Project,
  out: Project,
  q: { x: number; y: number },
  root = 0,
  slot = 1,
  role = 'outgoing',
) {
  await expect.poll(() => pixel(page, p, q.x, q.y)).toEqual([0, 126, 170, 255]);
  const a = p.layers[0].keys[0].shapes[root],
    w = p.layers[0].liveMotionSpans![0].path!.waypoints![slot - 1],
    path = out.layers[0].liveMotionSpans![0].path!,
    op = role === 'incoming' ? path.waypointTangents![slot] : path.waypointIncoming![slot - 1],
    oldPath = p.layers[0].liveMotionSpans![0].path!,
    old =
      role === 'incoming' ? oldPath.waypointTangents![slot] : oldPath.waypointIncoming![slot - 1],
    d = Math.hypot(op.x - old.x, op.y - old.y);
  expect(Math.hypot(op.x, op.y)).toBeCloseTo(Math.hypot(old.x, old.y), 12);
  expect(d).toBeGreaterThan(1);
  const selected =
    role === 'incoming' ? oldPath.waypointIncoming![slot - 1] : oldPath.waypointTangents![slot];
  await expect
    .poll(() => pixel(page, p, a.x + w.x + selected.x, a.y + w.y + selected.y))
    .toEqual([255, 255, 255, 255]);
  await expect
    .poll(() => pixel(page, p, a.x + w.x + old.x, a.y + w.y + old.y))
    .toEqual([255, 255, 255, 255]);
  await expect
    .poll(() =>
      pixel(page, p, a.x + w.x + op.x + (op.x - old.x) / d, a.y + w.y + op.y + (op.y - old.y) / d),
    )
    .toEqual([0, 126, 170, 255]);
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const slot of [1, 2])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`paired canvas waypoint ${basis}/${root}/${slot}/${role} previews both handles and explicitly commits`, async ({
          page,
        }) => {
          const p = fixture('custom', basis),
            f = await setup(page, p);
          await page.getByLabel('Live waypoint handle root').selectOption(String(root));
          await page.getByLabel('Live waypoint handle number').fill(String(slot));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
            y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue()),
            q = { x: x + 5, y: y + 15 },
            out = alignedExpected(p, q, root, slot, role);
          await pairedDraft(page);
          const g = await beginHandleRelease(page, f, x, y, 5, 15);
          await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
          await pairedDraftMarkers(page, p, out, q, root, slot, role);
          expect(await f.read()).toEqual(p);
          await g.finish();
          await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
          await pairedDraftMarkers(page, p, out, q, root, slot, role);
          await expect(page.getByLabel('Live waypoint handle document X')).toHaveValue(String(x));
          await expect(page.getByLabel('Live waypoint handle document Y')).toHaveValue(String(y));
          expect(await f.read()).toEqual(p);
          const pose = reference(out.layers[0].liveMotionSpans![0].path!);
          await expect
            .poll(() =>
              f.canvas.evaluate(
                (node, { p, pose, basis, root }) => {
                  const c = node as HTMLCanvasElement,
                    ctx = c.getContext('2d')!,
                    d = devicePixelRatio,
                    t = basis === 'plain' ? 0 : (25 * Math.PI) / 180;
                  let hits = 0;
                  for (const x of [4, 8, 12, 16])
                    for (const y of [4, 8, 12, 16]) {
                      const bx =
                          basis === 'plain' ? x : (basis === 'reflected' ? -2 : 2) * x + 0.5 * y,
                        by = basis === 'plain' ? y : 0.25 * x + 3 * y,
                        px = pose.x + root * 40 + Math.cos(t) * bx - Math.sin(t) * by,
                        py = pose.y + root * 30 + Math.sin(t) * bx + Math.cos(t) * by,
                        pixel = ctx.getImageData(
                          c.width / 2 + (px - p.width / 2) * d,
                          c.height / 2 + (py - p.height / 2) * d,
                          1,
                          1,
                        ).data;
                      if (
                        pixel[0] === (root ? 0 : 255) &&
                        pixel[1] === 0 &&
                        pixel[2] === (root ? 255 : 0) &&
                        pixel[3] === 255
                      )
                        hits++;
                    }
                  return hits;
                },
                { p, pose, basis, root },
              ),
            )
            .toBeGreaterThan(2);
          await page
            .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
            .click();
          await commit(page, f, out);
          expect(f.errors).toEqual([]);
        });
for (const mode of ['custom-tangent', 'custom-distance-tangent'])
  test(`paired canvas waypoint ${mode} turns both controls without release publication`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(mode));
    await pairedDraft(page);
    await handleDrag(page, f.p, 38, 47, 5, 15);
    expect(await f.read()).toEqual(f.p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
for (const shift of [false, true])
  test(`paired canvas waypoint CSS axes Shift${shift} retain offsets and explicit target`, async ({
    page,
  }) => {
    const f = await setup(page);
    await pairedDraft(page);
    await f.canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
    await handleDrag(page, f.p, 38, 47, 5, 15, shift);
    expect(await f.read()).toEqual(f.p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
      y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue());
    expect(x).toBeCloseTo(shift ? 38 : 43, 3);
    expect(y).toBeCloseTo(62, 3);
    await commit(page, f, alignedExpected(f.p, { x, y }));
  });
for (const action of [
  'escape',
  'loss',
  'cancel',
  'view',
  'gesture-restored',
  'author-restored',
] as const)
  test(`paired canvas waypoint ${action} restores a valid independent numeric prior`, async ({
    page,
  }) => {
    const f = await setup(page);
    await pairedDraft(page);
    await numeric(page, 43, 62);
    await preview(page);
    await pairedDraftMarkers(page, f.p, alignedExpected(f.p, { x: 43, y: 62 }), { x: 43, y: 62 });
    const g = await beginHandleRelease(page, f, 38, 47, 15, 25);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'cancel') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (action === 'view')
      await f.canvas.evaluate((c) => {
        (c as HTMLElement).style.transform = 'scale(.9,.8)';
      });
    if (action === 'gesture-restored' || action === 'author-restored')
      await page
        .getByLabel(
          action === 'gesture-restored'
            ? 'Drag live waypoint handles'
            : 'Author live waypoint handle on release',
        )
        .evaluate((c) => {
          const e = c as HTMLInputElement;
          for (let i = 0; i < 2; i++) {
            e.checked = !e.checked;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
    await g.finish();
    expect(await f.read()).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
    ).toBeEnabled();
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
test('paired canvas waypoint prepared children preserve the library and exact history', async ({
  page,
}) => {
  const p = fixture(),
    lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await pairedDraft(page);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live waypoint handle remembered children').check();
  await handleDrag(page, p, 38, 47, 5, 15);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f, alignedExpected(p, { x: 43, y: 62 }));
  expect((await f.read()).symbols).toEqual(p.symbols);
});
test('paired canvas waypoint proposed controls cannot own a new original pick', async ({
  page,
}) => {
  const f = await setup(page);
  await pairedDraft(page);
  await handleDrag(page, f.p, 38, 47, 40, 30);
  const a = await handlePoint(page, f.p, 78, 77);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(false);
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f, alignedExpected(f.p, { x: 78, y: 77 }));
});
for (const phase of ['movement', 'release'] as const)
  for (const action of [
    'coupling-restored',
    'target-restored',
    'role-restored',
    'root-restored',
    'index-restored',
    'gesture-restored',
    'source',
    'frame',
    'view',
  ] as const)
    test(`paired canvas waypoint late ${phase}/${action} rejects detached paired drafts`, async ({
      page,
    }) => {
      const f = await setup(page);
      await pairedDraft(page);
      const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
      await page.evaluate(
        ({ phase, action }) => {
          const native = structuredClone;
          let ready = phase === 'movement',
            hit = false;
          Object.assign(window, { pairedCanvasLateHit: false, pairedCanvasLateClean: false });
          if (phase === 'release')
            window.addEventListener(
              'pointerup',
              () => {
                ready = true;
              },
              { once: true, capture: true },
            );
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(native, window, [value, ...rest]),
              p = out as Project;
            if (
              ready &&
              !hit &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
                (phase === 'movement' ? 25 : 15)
            ) {
              hit = true;
              window.structuredClone = native;
              const canvas = document.querySelector(
                '[aria-label="Drawing stage"]',
              ) as HTMLCanvasElement;
              Object.assign(window, {
                pairedCanvasLateHit: true,
                pairedCanvasLateClean: !canvas.hasPointerCapture(1),
              });
              const input = (label: string, value: string, event = 'input') => {
                const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
                e.value = value;
                e.dispatchEvent(new Event(event, { bubbles: true }));
              };
              if (action === 'coupling-restored') {
                input('Live waypoint handle coupling', 'independent', 'change');
                input('Live waypoint handle coupling', 'aligned', 'change');
              }
              if (action === 'target-restored') {
                input('Live waypoint handle document X', '99');
                input('Live waypoint handle document X', '38');
              }
              if (action === 'role-restored') {
                input('Live waypoint handle role', 'incoming', 'change');
                input('Live waypoint handle role', 'outgoing', 'change');
              }
              if (action === 'root-restored') {
                input('Live waypoint handle root', '1', 'change');
                input('Live waypoint handle root', '0', 'change');
              }
              if (action === 'index-restored') {
                input('Live waypoint handle number', '2');
                input('Live waypoint handle number', '1');
              }
              if (action === 'gesture-restored') {
                const e = document.querySelector(
                  '[aria-label="Drag live waypoint handles"]',
                ) as HTMLInputElement;
                for (const checked of [false, true]) {
                  e.checked = checked;
                  e.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
              if (action === 'source') input('Layer name', 'Paired draft late source', 'change');
              if (action === 'frame')
                [...document.querySelectorAll('button')]
                  .find((b) => b.textContent === 'Next frame')!
                  .click();
              if (action === 'view') canvas.style.transform = 'scale(.9,.8)';
            }
            return out;
          }) as typeof native;
        },
        { phase, action },
      );
      if (phase === 'movement') {
        const p = await handlePoint(page, f.p, 53, 72);
        await page.mouse.move(p.x + 2, p.y - 1);
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as { pairedCanvasLateHit: boolean }).pairedCanvasLateHit,
            ),
          )
          .toBe(true);
      }
      await g.finish();
      const flags = await page.evaluate(() => ({
        hit: (window as unknown as { pairedCanvasLateHit: boolean }).pairedCanvasLateHit,
        clean: (window as unknown as { pairedCanvasLateClean: boolean }).pairedCanvasLateClean,
      }));
      expect(flags.hit).toBe(true);
      if (phase === 'release') expect(flags.clean).toBe(true);
      const out = structuredClone(f.p);
      if (action === 'source') out.layers[0].name = 'Paired draft late source';
      expect(await f.read()).toEqual(out);
      if (action === 'source' || action === 'frame') await expect(f.panel).toBeHidden();
      else
        await expect(
          page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
        ).toBeDisabled();
      if (action === 'frame') {
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
        await expect(f.panel).toBeHidden();
      }
      if (action !== 'source' && action !== 'frame') {
        await pairedDraft(page);
        await handleDrag(page, f.p, 38, 47, 5, 15);
        expect(await f.read()).toEqual(f.p);
        await page
          .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
          .click();
        const q = {
          x: Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
          y: Number(await page.getByLabel('Live waypoint handle document Y').inputValue()),
        };
        expect(q.x).toBeCloseTo(43, 3);
        expect(q.y).toBeCloseTo(62, 3);
        await commit(page, f, alignedExpected(f.p, q));
      }
      expect(f.errors).toEqual([]);
    });
for (const mode of ['zero', 'return'] as const)
  test(`paired canvas waypoint ${mode} keeps original data and no history`, async ({ page }) => {
    const f = await setup(page);
    await pairedDraft(page);
    const a = await handlePoint(page, f.p, 38, 47);
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await handleCapture(page)).toBe(true);
    if (mode === 'return') {
      const b = await handlePoint(page, f.p, 43, 62);
      await page.mouse.move(b.x + 2, b.y - 1);
      await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
      await page.mouse.move(a.x + 2, a.y - 1);
    }
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    await expect(
      page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
    ).toBeDisabled();
    await handleDrag(page, f.p, 38, 47, 5, 15);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
for (const basis of ['plain', 'affine', 'reflected'])
  test(`paired canvas waypoint compound ${basis} preserves correspondence and world artwork`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await pairedDraft(page);
    await handleDrag(page, p, 78, 82, 5, 15);
    const q = { x: 83, y: 97 },
      out = alignedExpected(p, q, 1, 2, 'incoming'),
      pose = reference(out.layers[0].liveMotionSpans![0].path!),
      angle = basis === 'plain' ? 0 : (25 * Math.PI) / 180,
      bx = basis === 'plain' ? 2 : (basis === 'reflected' ? -2 : 2) * 2 + 1,
      by = basis === 'plain' ? 2 : 6.5;
    await pairedDraftMarkers(page, p, out, q, 1, 2, 'incoming');
    await expect
      .poll(() =>
        pixel(
          page,
          p,
          pose.x + Math.cos(angle) * bx - Math.sin(angle) * by,
          pose.y + Math.sin(angle) * bx + Math.cos(angle) * by,
        ),
      )
      .toEqual([255, 0, 0, 255]);
    expect(await f.read()).toEqual(p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });
for (const action of ['coupling', 'target', 'gesture'] as const)
  test(`paired canvas waypoint initial ${action} ownership rejects restored inputs and allows fresh capture`, async ({
    page,
  }) => {
    const f = await setup(page);
    await pairedDraft(page);
    await page.evaluate((action) => {
      const native = structuredClone;
      let ready = false,
        hit = false;
      Object.assign(window, { pairedCanvasInitialHit: false });
      window.addEventListener(
        'pointerdown',
        () => {
          ready = true;
        },
        { capture: true, once: true },
      );
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          p = out as Project;
        if (
          ready &&
          !hit &&
          p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 10
        ) {
          hit = true;
          window.structuredClone = native;
          Object.assign(window, { pairedCanvasInitialHit: true });
          const input = (label: string, value: string, event = 'input') => {
            const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            e.value = value;
            e.dispatchEvent(new Event(event, { bubbles: true }));
          };
          if (action === 'coupling') {
            input('Live waypoint handle coupling', 'independent', 'change');
            input('Live waypoint handle coupling', 'aligned', 'change');
          }
          if (action === 'target') {
            input('Live waypoint handle document X', '99');
            input('Live waypoint handle document X', '38');
          }
          if (action === 'gesture') {
            const e = document.querySelector(
              '[aria-label="Drag live waypoint handles"]',
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              e.checked = checked;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return out;
      }) as typeof native;
    }, action);
    const a = await handlePoint(page, f.p, 38, 47);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedCanvasInitialHit: boolean }).pairedCanvasInitialHit,
      ),
    ).toBe(true);
    expect(await handleCapture(page)).toBe(false);
    await page.mouse.up();
    expect(await f.read()).toEqual(f.p);
    await handleDrag(page, f.p, 38, 47, 5, 15);
    expect(await f.read()).toEqual(f.p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
test('paired canvas waypoint foreign foreground blocks original capture without losing numeric authoring', async ({
  page,
}) => {
  const p = fixture();
  p.layers.push({
    id: 'foreign',
    name: 'Foreign foreground',
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [
      {
        frame: 0,
        shapes: [
          {
            id: 'cover',
            kind: 'rectangle',
            x: 33,
            y: 42,
            width: 10,
            height: 10,
            rotation: 0,
            fill: '#00ff00',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
        ],
      },
    ],
  });
  const f = await setup(page, p);
  await pairedDraft(page);
  const a = await handlePoint(page, p, 38, 47);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await numeric(page, 43, 62);
  await preview(page);
  await commit(page, f, alignedExpected(p, { x: 43, y: 62 }));
  expect(f.errors).toEqual([]);
});
test('paired canvas waypoint zero direction rejects release and permits fresh draft recovery', async ({
  page,
}) => {
  const f = await setup(page);
  await pairedDraft(page);
  const g = await beginHandleRelease(page, f, 38, 47, -10, -5);
  await g.finish();
  await expect(page.getByLabel('Live waypoint handle status')).toContainText(/zero|direction/);
  expect(await f.read()).toEqual(f.p);
  await expect(
    page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }),
  ).toBeDisabled();
  await handleDrag(page, f.p, 38, 47, 5, 15);
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
async function alignedAuthor(page: Page) {
  await pairedDraft(page);
  await page.getByLabel('Author aligned live waypoint handles on release').check();
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of [0, 1])
    for (const slot of [1, 2])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`paired release waypoint ${basis}/${root}/${slot}/${role} authors both controls with one history step`, async ({
          page,
        }) => {
          const f = await setup(page, fixture('custom', basis));
          await expect(
            page.getByLabel('Author aligned live waypoint handles on release'),
          ).not.toBeChecked();
          await expect(
            page.getByLabel('Author aligned live waypoint handles on release'),
          ).toBeDisabled();
          await page.getByLabel('Live waypoint handle root').selectOption(String(root));
          await page.getByLabel('Live waypoint handle number').fill(String(slot));
          await page.getByLabel('Live waypoint handle role').selectOption(role);
          const x = Number(await page.getByLabel('Live waypoint handle document X').inputValue()),
            y = Number(await page.getByLabel('Live waypoint handle document Y').inputValue()),
            q = { x: x + 5, y: y + 15 },
            out = alignedExpected(f.p, q, root, slot, role);
          await alignedAuthor(page);
          await expect(page.getByLabel('Author live waypoint handle on release')).toBeDisabled();
          const g = await beginHandleRelease(page, f, x, y, 5, 15);
          await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
          await pairedDraftMarkers(page, f.p, out, q, root, slot, role);
          expect(await f.read()).toEqual(f.p);
          await g.finish();
          await expect(f.panel).toBeHidden();
          await expect
            .poll(() =>
              f.canvas.evaluate((node, p) => {
                const c = node as HTMLCanvasElement,
                  ctx = c.getContext('2d')!,
                  dpr = devicePixelRatio,
                  first = p.layers[0].keys[0].shapes[0],
                  m = first.transform ?? [1, 0, 0, 1],
                  theta = (first.rotation * Math.PI) / 180;
                let red = 0;
                // Interior samples avoid the authored selection's corner handles.
                for (const x of [4, 8, 12, 16])
                  for (const y of [4, 8, 12, 16]) {
                    const lx = x * m[0] + y * m[2],
                      ly = x * m[1] + y * m[3],
                      px = first.x + Math.cos(theta) * lx - Math.sin(theta) * ly,
                      py = first.y + Math.sin(theta) * lx + Math.cos(theta) * ly,
                      rgba = ctx.getImageData(
                        c.width / 2 + (px - p.width / 2) * dpr,
                        c.height / 2 + (py - p.height / 2) * dpr,
                        1,
                        1,
                      ).data;
                    if (rgba[0] === 255 && rgba[1] === 0 && rgba[2] === 0 && rgba[3] === 255) red++;
                  }
                return red;
              }, f.p),
            )
            .toBeGreaterThan(2);
          await authoredHandle(page, f, out);
          expect((await f.read()).layers[0].keys).toEqual(f.p.layers[0].keys);
        });
for (const phase of ['initial', 'release'] as const)
  for (const policy of ['author', 'gesture', 'coupling'] as const)
    test(`paired release waypoint restored ${policy}/${phase} rejects and allows opted-out/restored retries`, async ({
      page,
    }) => {
      const f = await setup(page);
      await alignedAuthor(page);
      const a = await handlePoint(page, f.p, 38, 47);
      let g: Awaited<ReturnType<typeof beginHandleRelease>> | undefined;
      if (phase === 'release') g = await beginHandleRelease(page, f, 38, 47, 5, 15);
      await f.canvas.evaluate(
        (node, { phase, policy }) => {
          const c = node as HTMLCanvasElement,
            rect = c.getBoundingClientRect;
          let native = false,
            hit = false;
          Object.assign(window, { pairedReleasePolicyHit: false });
          c.addEventListener(
            phase === 'initial' ? 'pointerdown' : 'pointerup',
            () => {
              native = true;
            },
            { capture: true, once: true },
          );
          c.getBoundingClientRect = function () {
            const r = rect.call(this);
            if (native && !hit) {
              hit = true;
              this.getBoundingClientRect = rect;
              Object.assign(window, { pairedReleasePolicyHit: true });
              if (policy === 'coupling') {
                const e = document.querySelector(
                  '[aria-label="Live waypoint handle coupling"]',
                ) as HTMLSelectElement;
                for (const value of ['independent', 'aligned']) {
                  e.value = value;
                  e.dispatchEvent(new Event('change', { bubbles: true }));
                }
              } else {
                const e = document.querySelector(
                  `[aria-label="${policy === 'author' ? 'Author aligned live waypoint handles on release' : 'Drag live waypoint handles'}"]`,
                ) as HTMLInputElement;
                for (const checked of [false, true]) {
                  e.checked = checked;
                  e.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
            }
            return r;
          };
        },
        { phase, policy },
      );
      if (phase === 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        await page.mouse.up();
      } else await g!.finish();
      expect(
        await page.evaluate(
          () => (window as unknown as { pairedReleasePolicyHit: boolean }).pairedReleasePolicyHit,
        ),
      ).toBe(true);
      expect(await handleCapture(page)).toBe(false);
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author aligned live waypoint handles on release').uncheck();
      await handleDrag(page, f.p, 38, 47, 5, 15);
      expect(await f.read()).toEqual(f.p);
      await page.getByLabel('Author aligned live waypoint handles on release').check();
      const fresh = await beginHandleRelease(page, f, 38, 47, 5, 15);
      await fresh.finish();
      await authoredHandle(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
    });
for (const shift of [false, true])
  test(`paired release waypoint CSS Shift${shift} authors delivered targets with frozen offsets`, async ({
    page,
  }) => {
    const f = await setup(page);
    await alignedAuthor(page);
    await f.canvas.evaluate((c) => {
      (c as HTMLElement).style.transform = 'scale(.8,.7)';
    });
    await f.canvas.evaluate((c) => {
      const state = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
      Object.assign(window, { pairedReleaseCSS: state });
      c.addEventListener(
        'pointerdown',
        (e) => {
          const p = e as PointerEvent;
          state.start = { x: p.clientX, y: p.clientY };
        },
        { once: true, capture: true },
      );
      c.addEventListener(
        'pointermove',
        (e) => {
          const p = e as PointerEvent;
          if (p.buttons === 1) state.end = { x: p.clientX, y: p.clientY };
        },
        { capture: true },
      );
    });
    const g = await beginHandleRelease(page, f, 38, 47, 5, 15, shift);
    await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
    // Capture the delivered numeric target through the already-admitted original
    // pointer/view mapping, independently of the final recipe's opposite radius.
    const q = await f.canvas.evaluate(
      (node, { shift }) => {
        const native = (
          window as unknown as {
            pairedReleaseCSS: { start: { x: number; y: number }; end: { x: number; y: number } };
          }
        ).pairedReleaseCSS;
        const c = node as HTMLCanvasElement,
          r = c.getBoundingClientRect();
        let dx = ((native.end.x - native.start.x) * (c.width / devicePixelRatio)) / r.width,
          dy = ((native.end.y - native.start.y) * (c.height / devicePixelRatio)) / r.height;
        if (shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        return { x: 38 + dx, y: 47 + dy };
      },
      { shift },
    );
    expect(q.x).toBeCloseTo(shift ? 38 : 43, 3);
    expect(q.y).toBeCloseTo(62, 3);
    await g.finish();
    await authoredHandle(page, f, alignedExpected(f.p, q));
  });
for (const mode of ['custom-tangent', 'custom-distance-tangent'])
  test(`paired release waypoint ${mode} turns admitted paired bearings`, async ({ page }) => {
    const f = await setup(page, fixture(mode));
    await alignedAuthor(page);
    const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
    await g.finish();
    await authoredHandle(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
for (const action of ['zero', 'return', 'escape', 'loss', 'disabled', 'cancel'] as const)
  test(`paired release waypoint ${action} never publishes and preserves default drafts`, async ({
    page,
  }) => {
    const f = await setup(page);
    await alignedAuthor(page);
    const a = await handlePoint(page, f.p, 38, 47);
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await handleCapture(page)).toBe(true);
    if (action !== 'zero') {
      const b = await handlePoint(page, f.p, 43, 62);
      await page.mouse.move(b.x + 2, b.y - 1);
      await expect(page.getByLabel('Live waypoint handle status')).toContainText('Unapplied');
    }
    if (action === 'return') await page.mouse.move(a.x + 2, a.y - 1);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'cancel') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (action === 'disabled')
      await page.getByLabel('Author aligned live waypoint handles on release').evaluate((c) => {
        const e = c as HTMLInputElement;
        e.checked = false;
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.mouse.up();
    expect(await handleCapture(page)).toBe(false);
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Author aligned live waypoint handles on release').uncheck();
    await handleDrag(page, f.p, 38, 47, 5, 15);
    expect(await f.read()).toEqual(f.p);
    await page
      .getByRole('button', { name: 'Use waypoint handle draft target', exact: true })
      .click();
    await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
  });
test('paired release waypoint prepared children retain the original library and one history edit', async ({
  page,
}) => {
  const p = fixture(),
    lib = livePresentationFixture('graphic');
  p.symbols = lib.symbols;
  p.layers.push({ ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined });
  const f = await setup(page, p);
  await alignedAuthor(page);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live waypoint handle remembered children').check();
  const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
  await expect.poll(() => pixel(page, p, 95, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 65, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  await g.finish();
  await authoredHandle(page, f, alignedExpected(p, { x: 43, y: 62 }));
  expect((await f.read()).symbols).toEqual(p.symbols);
});
test('paired release waypoint retained aligned preference cannot authorize independent drags', async ({
  page,
}) => {
  const f = await setup(page);
  await alignedAuthor(page);
  await page.getByLabel('Live waypoint handle coupling').selectOption('independent');
  await expect(page.getByLabel('Author aligned live waypoint handles on release')).toBeChecked();
  await expect(page.getByLabel('Author aligned live waypoint handles on release')).toBeDisabled();
  await expect(page.getByLabel('Author live waypoint handle on release')).not.toBeChecked();
  await handleDrag(page, f.p, 38, 47, 5, 15);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Use waypoint handle draft target', exact: true }).click();
  await commit(page, f, expected(f.p, { x: 43, y: 62 }));
});
for (const action of [
  'target',
  'role',
  'root',
  'index',
  'source',
  'frame',
  'view',
  'coupling',
  'author-policy',
  'gesture-policy',
  'reenter-down',
  'reenter-move',
  'reenter-up',
] as const)
  test(`paired release waypoint late detached ${action} rejects after native cleanup`, async ({
    page,
  }) => {
    const f = await setup(page);
    await alignedAuthor(page);
    const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
    await page.evaluate((action) => {
      const native = structuredClone;
      let up = false,
        hit = false;
      Object.assign(window, { pairedReleaseLateHit: false, pairedReleaseLateClean: false });
      window.addEventListener(
        'pointerup',
        () => {
          up = true;
        },
        { capture: true, once: true },
      );
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          p = out as Project,
          path = p?.layers?.[0]?.liveMotionSpans?.[0]?.path;
        if (
          up &&
          !hit &&
          path?.waypointTangents?.[1]?.x === 15 &&
          path?.waypointIncoming?.[0]?.x !== -20
        ) {
          hit = true;
          window.structuredClone = native;
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          Object.assign(window, {
            pairedReleaseLateHit: true,
            pairedReleaseLateClean: !c.hasPointerCapture(1),
          });
          const input = (label: string, value: string, event = 'input') => {
            const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            e.value = value;
            e.dispatchEvent(new Event(event, { bubbles: true }));
          };
          if (action === 'target') {
            input('Live waypoint handle document X', '99');
            input('Live waypoint handle document X', '38');
          }
          if (action === 'role') {
            input('Live waypoint handle role', 'incoming', 'change');
            input('Live waypoint handle role', 'outgoing', 'change');
          }
          if (action === 'root') {
            input('Live waypoint handle root', '1', 'change');
            input('Live waypoint handle root', '0', 'change');
          }
          if (action === 'index') {
            input('Live waypoint handle number', '2');
            input('Live waypoint handle number', '1');
          }
          if (action === 'coupling') {
            input('Live waypoint handle coupling', 'independent', 'change');
            input('Live waypoint handle coupling', 'aligned', 'change');
          }
          if (action === 'source') input('Layer name', 'Paired release late source', 'change');
          if (action === 'frame')
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent === 'Next frame')!
              .click();
          if (action === 'view') c.style.transform = 'scale(.9,.8)';
          if (action === 'author-policy' || action === 'gesture-policy') {
            const e = document.querySelector(
              `[aria-label="${action === 'author-policy' ? 'Author aligned live waypoint handles on release' : 'Drag live waypoint handles'}"]`,
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              e.checked = checked;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (action.startsWith('reenter-'))
            c.dispatchEvent(
              new PointerEvent('pointer' + action.slice(8), {
                pointerId: 1,
                isPrimary: true,
                pointerType: 'mouse',
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
                cancelable: true,
              }),
            );
        }
        return out;
      }) as typeof native;
    }, action);
    await g.finish();
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedReleaseLateHit: boolean }).pairedReleaseLateHit,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedReleaseLateClean: boolean }).pairedReleaseLateClean,
      ),
    ).toBe(true);
    const out = structuredClone(f.p);
    if (action === 'source') out.layers[0].name = 'Paired release late source';
    expect(await f.read()).toEqual(out);
    if (action === 'frame') {
      await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      await expect(f.panel).toBeHidden();
    } else if (action === 'source') {
      if (await f.panel.isVisible())
        await page
          .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
          .click();
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
    } else {
      await page.getByLabel('Author aligned live waypoint handles on release').uncheck();
      await handleDrag(page, f.p, 38, 47, 5, 15);
      expect(await f.read()).toEqual(f.p);
      // Numeric fields retain the actual delivered CSS target before the new
      // publication gesture; no ideal-coordinate assumption owns its output.
      await page.getByLabel('Author aligned live waypoint handles on release').check();
      await f.canvas.evaluate((c) => {
        const state = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
        Object.assign(window, { pairedRetryPointer: state });
        c.addEventListener(
          'pointerdown',
          (e) => {
            const p = e as PointerEvent;
            state.start = { x: p.clientX, y: p.clientY };
          },
          { capture: true, once: true },
        );
        c.addEventListener(
          'pointermove',
          (e) => {
            const p = e as PointerEvent;
            if (p.buttons === 1) state.end = { x: p.clientX, y: p.clientY };
          },
          { capture: true },
        );
      });
      const fresh = await beginHandleRelease(page, f, 38, 47, 5, 15);
      const q = await f.canvas.evaluate((node) => {
        const c = node as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          p = (
            window as unknown as {
              pairedRetryPointer: {
                start: { x: number; y: number };
                end: { x: number; y: number };
              };
            }
          ).pairedRetryPointer;
        return {
          x: 38 + ((p.end.x - p.start.x) * (c.width / devicePixelRatio)) / r.width,
          y: 47 + ((p.end.y - p.start.y) * (c.height / devicePixelRatio)) / r.height,
        };
      });
      expect(q.x).toBeCloseTo(43, 3);
      expect(q.y).toBeCloseTo(62, 3);
      await fresh.finish();
      await authoredHandle(page, f, alignedExpected(f.p, q));
    }
    expect(f.errors).toEqual([]);
  });
for (const action of ['author-policy', 'target', 'source'] as const)
  test(`paired release waypoint final recovery ${action} rejects before the history transaction`, async ({
    page,
  }) => {
    const f = await setup(page);
    await alignedAuthor(page);
    const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
    await page.evaluate((action) => {
      const native = JSON.stringify;
      let up = false,
        hit = false;
      Object.assign(window, { pairedRecoveryHit: false, pairedRecoveryClean: false });
      window.addEventListener(
        'pointerup',
        () => {
          up = true;
        },
        { capture: true, once: true },
      );
      JSON.stringify = function (value: unknown, ...rest: unknown[]) {
        const text = Reflect.apply(native, JSON, [value, ...rest]),
          p = (value as { project?: Project })?.project,
          path = p?.layers?.[0]?.liveMotionSpans?.[0]?.path;
        if (
          up &&
          !hit &&
          path?.waypointTangents?.[1]?.x === 15 &&
          path?.waypointIncoming?.[0]?.x !== -20
        ) {
          hit = true;
          JSON.stringify = native;
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          Object.assign(window, {
            pairedRecoveryHit: true,
            pairedRecoveryClean: !c.hasPointerCapture(1),
          });
          if (action === 'author-policy') {
            const e = document.querySelector(
              '[aria-label="Author aligned live waypoint handles on release"]',
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              e.checked = checked;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            const e = document.querySelector(
              `[aria-label="${action === 'target' ? 'Live waypoint handle document X' : 'Layer name'}"]`,
            ) as HTMLInputElement;
            e.value = action === 'target' ? '99' : 'Paired final source';
            e.dispatchEvent(new Event(action === 'target' ? 'input' : 'change', { bubbles: true }));
          }
        }
        return text;
      } as typeof native;
    }, action);
    await g.finish();
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedRecoveryHit: boolean }).pairedRecoveryHit,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as unknown as { pairedRecoveryClean: boolean }).pairedRecoveryClean,
      ),
    ).toBe(true);
    const out = structuredClone(f.p);
    if (action === 'source') out.layers[0].name = 'Paired final source';
    expect(await f.read()).toEqual(out);
    if (action !== 'source') {
      const fresh = await beginHandleRelease(page, f, 38, 47, 5, 15);
      await fresh.finish();
      await authoredHandle(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
    }
  });
for (const basis of ['plain', 'affine', 'reflected'])
  test(`paired release waypoint compound ${basis} keeps contours and mappings exact`, async ({
    page,
  }) => {
    const p = fixture('custom', basis),
      span = p.layers[0].liveMotionSpans![0];
    for (const [i, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: i ? rings.reverse() : rings,
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const f = await setup(page, p);
    await page.getByLabel('Live waypoint handle root').selectOption('1');
    await page.getByLabel('Live waypoint handle number').fill('2');
    await page.getByLabel('Live waypoint handle role').selectOption('incoming');
    await alignedAuthor(page);
    const g = await beginHandleRelease(page, f, 78, 82, 5, 15),
      out = alignedExpected(p, { x: 83, y: 97 }, 1, 2, 'incoming');
    await pairedDraftMarkers(page, p, out, { x: 83, y: 97 }, 1, 2, 'incoming');
    await g.finish();
    await authoredHandle(page, f, out);
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
  });
test('paired release waypoint opting out restores an independently owned numeric preview', async ({
  page,
}) => {
  const f = await setup(page);
  await alignedAuthor(page);
  await numeric(page, 43, 62);
  await preview(page);
  const g = await beginHandleRelease(page, f, 38, 47, 15, 25);
  await page.getByLabel('Author aligned live waypoint handles on release').evaluate((c) => {
    const e = c as HTMLInputElement;
    e.checked = false;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await g.finish();
  expect(await f.read()).toEqual(f.p);
  await pairedDraftMarkers(page, f.p, alignedExpected(f.p, { x: 43, y: 62 }), { x: 43, y: 62 });
  await commit(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
test('paired release waypoint original zero opposite stays exact without invented controls', async ({
  page,
}) => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointIncoming![0], { x: 0, y: 0 });
  const f = await setup(page, p);
  await alignedAuthor(page);
  const g = await beginHandleRelease(page, f, 38, 47, 5, 15);
  await g.finish();
  await authoredHandle(page, f, alignedExpected(p, { x: 43, y: 62 }));
  expect((await f.read()).layers[0].liveMotionSpans![0].path!.waypointIncoming![0]).toEqual({
    x: 0,
    y: 0,
  });
});
test('paired release waypoint proposed points never authorize a new capture or publication', async ({
  page,
}) => {
  const f = await setup(page);
  await pairedDraft(page);
  await handleDrag(page, f.p, 38, 47, 40, 30);
  await page.getByLabel('Author aligned live waypoint handles on release').check();
  const a = await handlePoint(page, f.p, 78, 77);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  const fresh = await beginHandleRelease(page, f, 38, 47, 5, 15);
  await fresh.finish();
  await authoredHandle(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
test('paired release waypoint foreground artwork blocks authoring at an original marker', async ({
  page,
}) => {
  const p = fixture();
  p.layers.push({
    id: 'foreign',
    name: 'Foreign foreground',
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [
      {
        frame: 0,
        shapes: [
          {
            id: 'cover',
            kind: 'rectangle',
            x: 33,
            y: 42,
            width: 10,
            height: 10,
            rotation: 0,
            fill: '#00ff00',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
        ],
      },
    ],
  });
  const f = await setup(page, p);
  await alignedAuthor(page);
  const a = await handlePoint(page, p, 38, 47);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await handleCapture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await numeric(page, 43, 62);
  await commit(page, f, alignedExpected(p, { x: 43, y: 62 }));
});
test('paired release waypoint zero direction rejects atomically and allows a fresh original drag', async ({
  page,
}) => {
  const f = await setup(page);
  await alignedAuthor(page);
  const g = await beginHandleRelease(page, f, 38, 47, -10, -5);
  await g.finish();
  await expect(page.getByLabel('Live waypoint handle status')).toContainText(/zero|direction/);
  expect(await f.read()).toEqual(f.p);
  const fresh = await beginHandleRelease(page, f, 38, 47, 5, 15);
  await fresh.finish();
  await authoredHandle(page, f, alignedExpected(f.p, { x: 43, y: 62 }));
});
for (const phase of ['preview', 'commit'] as const)
  test(`numeric waypoint handle selected metadata ${phase} rejects without discarding original recovery`, async ({
    page,
  }) => {
    const p = fixture();
    Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointTangents![1], { pressure: 0.5 });
    const f = await setup(page, p);
    expect(await f.read()).toEqual(p);
    await numeric(page, 43, 62);
    await page
      .getByRole('button', {
        name: phase === 'preview' ? 'Preview live waypoint handle' : 'Commit live waypoint handle',
        exact: true,
      })
      .click();
    await expect(page.getByLabel('Live waypoint handle status')).toContainText(/trajectory point/);
    expect(await f.read()).toEqual(p);
    await expect(f.panel).toBeVisible();
    await page
      .getByRole('button', { name: 'Close live waypoint handle positions', exact: true })
      .click();
    await expect(f.panel).toBeHidden();
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });
