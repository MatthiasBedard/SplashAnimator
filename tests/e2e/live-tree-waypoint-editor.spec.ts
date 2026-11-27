import { test, expect, type Page } from '@playwright/test';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import type { Project } from '../../packages/document/src';
import { liveTreeFixture, createLiveMovieTrees } from '../live-tree-edit-fixture';
import { treeSplitFixture } from '../live-tree-split-fixture';
function fixture(mode = 'straight', basis = 'plain', first = 1) {
  const { p, span } = liveTreeFixture(first, basis);
  p.width = 260;
  p.height = 190;
  p.duration = 12;
  p.fps = 10;
  for (const d of p.symbols!) {
    d.width = 20;
    d.height = 20;
    for (const key of [{ shapes: d.shapes }, ...(d.timeline?.keys ?? [])])
      for (const a of key.shapes) {
        a.width = 20;
        a.height = 20;
        if (a.kind !== 'symbol') {
          a.x = 0;
          a.fill = '#ff0000';
        }
      }
  }
  const blueLeaf = structuredClone(p.symbols![1]);
  blueLeaf.id = 'blue-leaf';
  blueLeaf.name = 'Blue leaf';
  for (const key of [{ shapes: blueLeaf.shapes }, ...(blueLeaf.timeline?.keys ?? [])])
    for (const a of key.shapes) a.fill = '#0000ff';
  const blue = structuredClone(p.symbols![0]);
  blue.id = 'blue-graphic';
  blue.name = 'Blue root';
  blue.shapes[0].symbolId = blueLeaf.id;
  p.symbols!.push(blue, blueLeaf);
  const a = structuredClone(p.layers[0].keys[1].shapes[0]),
    b = structuredClone(p.layers[0].keys[2].shapes[0]);
  for (const [root, x] of [
    [a, 8],
    [b, 88],
  ] as const) {
    root.id = 'art';
    root.x = x;
    root.y = 12;
    root.rotation = basis === 'plain' ? 0 : 25;
    root.width = 20;
    root.height = 20;
  }
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        a,
        { ...structuredClone(a), id: 'other', symbolId: blue.id, x: a.x + 40, y: a.y + 30 },
      ],
    },
    {
      frame: 8,
      shapes: [
        b,
        { ...structuredClone(b), id: 'other', symbolId: blue.id, x: b.x + 40, y: b.y + 30 },
      ],
    },
    { frame: 10, shapes: [] },
  ];
  span.start = 0;
  span.end = 8;
  span.path = {
    startX: 3,
    startY: 7,
    endX: -2,
    endY: 6,
    waypoints: [
      { x: 20, y: 30 },
      { x: 60, y: 30 },
    ],
  };
  const path = span.path;
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
  p.frameScripts = [
    { frame: 0, source: "throw new Error('Numeric nested waypoint previews stay script-free')" },
  ];
  return createLiveMovieTrees(p, span);
}
async function setup(page: Page, p = fixture(), at = 4) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (window === window.top && !sessionStorage.getItem('tree-waypoint-editor-seed')) {
      sessionStorage.setItem('tree-waypoint-editor-seed', '1');
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
    .getByRole('button', { name: 'Edit live nested movie waypoint positions…', exact: true })
    .click();
  const panel = page.getByRole('region', {
      name: 'Live nested movie waypoint positions',
      exact: true,
    }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, panel, canvas, errors, read };
}
async function numeric(page: Page, x = 38, y = 52) {
  await page.getByLabel('Live nested movie waypoint document X', { exact: true }).fill(String(x));
  await page.getByLabel('Live nested movie waypoint document Y', { exact: true }).fill(String(y));
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
      test(`numeric live nested movie waypoint ${basis}/${root}/${number} previews independent pixels and commits exact history`, async ({
        page,
      }) => {
        const p = fixture('straight', basis),
          f = await setup(page, p);
        await expect(
          page.getByLabel('Live nested movie waypoint root').locator('option'),
        ).toHaveCount(2);
        await page
          .getByLabel('Live nested movie waypoint root')
          .selectOption(root === 'art' ? '0' : '1');
        await page.getByLabel('Live nested movie waypoint number').fill(String(number));
        const x = (number === 1 ? 28 : 68) + (root === 'other' ? 40 : 0),
          y = 42 + (root === 'other' ? 30 : 0);
        await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue(
          String(x),
        );
        await expect(page.getByLabel('Live nested movie waypoint document Y')).toHaveValue(
          String(y),
        );
        await numeric(page, x + 10, y + 10);
        await page
          .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
          .click();
        await expect(page.getByLabel('Live nested movie waypoint status')).toContainText(
          'Unapplied',
        );
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
        await page
          .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
          .click();
        await expect(f.panel).toBeHidden();
        expect(await f.read()).toEqual(expected);
        await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
        await undoRedo(page, f, expected);
        expect(f.errors).toEqual([]);
      });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  test(`numeric live nested movie waypoint preserves ${mode} routing and independent sampled pixels`, async ({
    page,
  }) => {
    const p = fixture(mode),
      f = await setup(page, p);
    await numeric(page);
    await page
      .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
      .click();
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
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
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    await expect(f.panel).toBeHidden();
    expect(await f.read()).toEqual(expected);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });
test('numeric live nested movie waypoint direct commit needs no preview and survives JSON recovery reopen', async ({
  page,
}) => {
  const f = await setup(page);
  await numeric(page);
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
  test(`numeric live nested movie waypoint raw ${axis} rejects NaN and permits fresh corrected commit`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel(`Live nested movie waypoint document ${axis}`).fill('');
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await numeric(page);
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    await expect(f.panel).toBeHidden();
    expect((await f.read()).layers[0].liveMotionSpans![0].path!.waypoints![0]).toEqual({
      x: 30,
      y: 40,
    });
    expect(f.errors).toEqual([]);
  });
for (const number of ['0', '1.5', '99', ''])
  test(`numeric live nested movie waypoint number ${number || 'missing'} rejects without truncation or publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.getByLabel('Live nested movie waypoint number').fill(number);
    await expect(
      page.getByRole('button', { name: 'Commit live nested movie waypoint', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live nested movie waypoint number').fill('1');
    await numeric(page);
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    await expect(f.panel).toBeHidden();
    expect((await f.read()).layers[0].liveMotionSpans![0].path!.waypoints![0]).toEqual({
      x: 30,
      y: 40,
    });
    expect(f.errors).toEqual([]);
  });
test('numeric live nested movie waypoint no-op and stationary tangent failure retain plain recovery', async ({
  page,
}) => {
  const f = await setup(page, fixture('tangent'));
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await numeric(page, 8, 12);
  await page
    .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
    .click();
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText(
    /stationary|tangent|direction/i,
  );
  expect(await f.read()).toEqual(f.p);
  await numeric(page);
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
  await expect(f.panel).toBeHidden();
  expect((await f.read()).layers[0].liveMotionSpans![0].path!.tangent).toBe(true);
  expect(f.errors).toEqual([]);
});
for (const first of [0, 1, 9998])
  test(`numeric nested waypoints retain stopped prepared child pose with first offset ${first}`, async ({
    page,
  }) => {
    const p = fixture('straight', 'plain', first),
      leaf = p.symbols![1];
    for (const key of [{ frame: 0, shapes: leaf.shapes }, ...(leaf.timeline?.keys ?? [])])
      for (const a of key.shapes) {
        a.x = key.frame * 10;
        a.width = 4;
        a.height = 4;
      }
    const f = await setup(page, p);
    await page.getByLabel('Live nested movie waypoint remembered children').check();
    await numeric(page);
    await page
      .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
      .click();
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
    await expect.poll(() => pixel(page, p, 65, 49)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => pixel(page, p, 60, 44)).toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(p);
    const expected = structuredClone(p);
    (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
      x: 30,
      y: 40,
    };
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    await expect(f.panel).toBeHidden();
    expect(await f.read()).toEqual(expected);
    expect((await f.read()).symbols).toEqual(p.symbols);
    await undoRedo(page, f, expected);
    expect(f.errors).toEqual([]);
  });

test('numeric live nested movie waypoint owns later-track membership and preserves the earlier track', async ({
  page,
}) => {
  const p = fixture(),
    later = structuredClone(p.layers[0]);
  later.id = 'later';
  later.name = 'Later waypoints';
  p.layers.push(later);
  const f = await setup(page, p);
  await page.getByLabel('Live nested movie waypoint root').selectOption('2');
  await numeric(page);
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
    .click();
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
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
  await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('38');
  await f.canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('discarded');
  await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('38');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const action of ['target', 'index', 'root', 'frame', 'close', 'source'] as const)
  test(`stale preview ${action} invalidates waypoint feedback without curve history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await numeric(page);
    await page
      .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
      .click();
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
    if (action === 'target')
      await page.getByLabel('Live nested movie waypoint document X').fill('48');
    if (action === 'index') await page.getByLabel('Live nested movie waypoint number').fill('2');
    if (action === 'root')
      await page.getByLabel('Live nested movie waypoint root').selectOption('1');
    if (action === 'frame')
      await page.getByRole('button', { name: 'Next frame', exact: true }).click();
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live nested movie waypoint positions', exact: true })
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
    else
      await expect(page.getByLabel('Live nested movie waypoint status')).not.toContainText(
        'Unapplied',
      );
    expect(await f.read()).toEqual(expected);
    if (action === 'target')
      await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('48');
    if (action === 'index')
      await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('68');
    if (action === 'root')
      await expect(page.getByLabel('Live nested movie waypoint document Y')).toHaveValue('72');
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
                input('Live nested movie waypoint document X', '999');
                input('Live nested movie waypoint document X', '38');
              }
              if (action === 'index-restored') {
                input('Live nested movie waypoint number', '2');
                input('Live nested movie waypoint number', '1');
                input('Live nested movie waypoint document X', '38');
                input('Live nested movie waypoint document Y', '52');
              }
              if (action === 'root-restored') {
                input('Live nested movie waypoint root', '1', 'change');
                input('Live nested movie waypoint root', '0', 'change');
                input('Live nested movie waypoint document X', '38');
                input('Live nested movie waypoint document Y', '52');
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
                        ? 'Close live nested movie waypoint positions'
                        : 'Commit live nested movie waypoint'),
                  )!
                  .click();
            }
            return out;
          }) as typeof stringify;
        },
        { phase, action },
      );
      await page
        .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
        .click();
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
        await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('38');
        await expect(page.getByLabel('Live nested movie waypoint document Y')).toHaveValue('52');
        await page
          .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
          .click();
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
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { waypointFinalHit: boolean }).waypointFinalHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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
    await page
      .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { waypointFontHeld: boolean }).waypointFontHeld),
      )
      .toBe(true);
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Preparing');
    expect(await f.read()).toEqual(f.p);
    if (action === 'target')
      await page.getByLabel('Live nested movie waypoint document X').fill('48');
    else
      await page
        .getByRole('button', { name: 'Close live nested movie waypoint positions', exact: true })
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
      await expect(page.getByLabel('Live nested movie waypoint status')).not.toContainText(
        'Unapplied',
      );
    else {
      await expect(f.panel).toBeHidden();
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page
        .getByRole('button', { name: 'Edit live nested movie waypoint positions…', exact: true })
        .click();
    }
    await numeric(page, 48, 52);
    await page
      .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
      .click();
    await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
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
    .getByRole('button', { name: 'Close live nested movie waypoint positions', exact: true })
    .click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit nested movie curve controls…', exact: true })
    .click();
  await page.getByLabel('Drag nested movie curve controls', { exact: true }).check();
  await page.getByLabel('Author nested movie curve on release', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Close nested movie curve controls', exact: true })
    .click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit live nested movie waypoint positions…', exact: true })
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
  await expect(page.getByLabel('Live nested movie waypoint document X')).toHaveValue('38');
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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

for (const bridge of ['loop', 'once', 'single'] as const)
  test(`nested waypoint numeric ${bridge} intermediary keeps blank reentry clocks under a paused root`, async ({
    page,
  }) => {
    const p = treeSplitFixture('reflected', bridge);
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
    const f = await setup(page, p, 4);
    await numeric(page, 190, 140);
    await page
      .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
      .click();
    const out = await f.read(),
      want = structuredClone(p);
    (want.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
      x: 30,
      y: 40,
    };
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
        part = Math.min(2, Math.floor(t * 3)),
        u = t * 3 - part,
        points = [
          { x: 160, y: 100 },
          { x: 190, y: 140 },
          { x: 220, y: 130 },
          { x: 180, y: 140 },
        ],
        angle = (t * Math.PI) / 2,
        px = points[part].x * (1 - u) + points[part + 1].x * u,
        py = points[part].y * (1 - u) + points[part + 1].y * u,
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

test('final nested waypoint clock-library corruption after recovery serialization rejects and preserves fresh history', async ({
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
        candidate.symbols![0].timeline!.duration++;
      }
      return out;
    }) as typeof stringify;
  });
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { waypointFinalHit: boolean }).waypointFinalHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
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

test('nested waypoint remembered-child regeneration changes presentation pixels without rewriting library or history', async ({
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
  const f = await setup(page, p);
  await numeric(page);
  await page
    .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
    .click();
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 78, 52)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Live nested movie waypoint remembered children').check();
  await page
    .getByRole('button', { name: 'Preview live nested movie waypoint', exact: true })
    .click();
  await expect(page.getByLabel('Live nested movie waypoint status')).toContainText('Unapplied');
  await expect.poll(() => pixel(page, p, 98, 52)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, p, 78, 52)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(p);
  const expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as { x: number; y: number }[])[0] = {
    x: 30,
    y: 40,
  };
  await page
    .getByRole('button', { name: 'Commit live nested movie waypoint', exact: true })
    .click();
  await expect(f.panel).toHaveCount(0);
  expect(await f.read()).toEqual(expected);
  expect((await f.read()).symbols).toEqual(p.symbols);
  await undoRedo(page, f, expected);
  expect(f.errors).toEqual([]);
});

test('pending Brush blocks nested numeric waypoint authoring and retains separate paint history', async ({
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
  const f = await setup(page, p, 4);
  await page
    .getByRole('button', { name: 'Close live nested movie waypoint positions', exact: true })
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
    page.getByRole('button', { name: 'Edit live nested movie waypoint positions…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(p);
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Edit live nested movie waypoint positions…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});
