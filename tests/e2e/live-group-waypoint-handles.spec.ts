import { test, expect, type Page } from '@playwright/test';
import { type Project } from '../../packages/document/src';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { liveRotationFixture } from '../live-motion-rotation-fixture';

function fixture(basis = 'plain', mode = 'rigid') {
  const { p } = liveRotationFixture(mode, basis, true);
  p.width = 600;
  p.height = 360;
  p.layers[0].liveMotionSpans![0].path = {
    startX: 3,
    startY: 7,
    endX: -2,
    endY: 6,
    curvedWaypoints: true,
    waypoints: [
      { x: 20, y: 30 },
      { x: 60, y: 30 },
    ],
    waypointTangents: [
      { x: 10, y: 5 },
      { x: 10, y: 5 },
      { x: 15, y: -5 },
      { x: 10, y: -5 },
    ],
    waypointIncoming: [
      { x: -20, y: -10 },
      { x: -30, y: 10 },
    ],
  };
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.opacity = 1;
      s.fill = s.id === 'loose' ? '#0000ff' : s.groups?.[0] === 'second' ? '#00aa00' : '#ff0000';
    }
  return p;
}
async function setup(page: Page, p: Project, at: number) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit live group waypoint handles…', exact: true })
    .click();
  const panel = page.getByRole('region', {
      name: 'Live group waypoint handle positions',
      exact: true,
    }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { panel, canvas, read, errors };
}
async function interiors(page: Page) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate((node) => {
    const c = node as HTMLCanvasElement,
      d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colors = [
      [255, 0, 0],
      [0, 170, 0],
      [0, 0, 255],
    ];
    return colors.map((color) => {
      const samples: { x: number; y: number; color: number[] }[] = [];
      const same = (x: number, y: number) =>
        color.every((v, i) => d[(y * c.width + x) * 4 + i] === v);
      for (let y = 3; y < c.height - 3; y += 2)
        for (let x = 3; x < c.width - 3; x += 2)
          if (same(x, y) && same(x - 2, y) && same(x + 2, y) && same(x, y - 2) && same(x, y + 2))
            samples.push({ x, y, color });
      return samples;
    });
  });
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of [0, 1])
    for (const slot of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`numeric group handle ${basis}/${group}/${slot}/${role} moves every shared root and publishes one complete edit`, async ({
          page,
        }) => {
          const p = fixture(basis),
            at = role === 'incoming' && slot === 0 ? 2 : role === 'outgoing' && slot === 1 ? 6 : 4;
          const f = await setup(page, p, at);
          await page
            .getByLabel('Live group waypoint handle group', { exact: true })
            .selectOption(String(group));
          await page
            .getByLabel('Live group waypoint handle number', { exact: true })
            .fill(String(slot + 1));
          await page
            .getByLabel('Live group waypoint handle role', { exact: true })
            .selectOption(role);
          await expect(f.panel).toContainText('2 group members; 5 artwork items');
          const path = p.layers[0].liveMotionSpans![0].path!,
            origin = p.layers[0].keys[0].shapes[group === 0 ? 0 : 2];
          const offset =
            role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
          const x = origin.x + path.waypoints![slot].x + offset.x,
            y = origin.y + path.waypoints![slot].y + offset.y;
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue(String(x));
          await expect(
            page.getByLabel('Live group waypoint handle document Y', { exact: true }),
          ).toHaveValue(String(y));
          const samples = await interiors(page);
          for (const color of samples) expect(color.length).toBeGreaterThan(3);
          await page
            .getByLabel('Live group waypoint handle document X', { exact: true })
            .fill(String(x + 64));
          await page
            .getByLabel('Live group waypoint handle document Y', { exact: true })
            .fill(String(y - 64));
          await page
            .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
            .click();
          await expect(
            page.getByLabel('Live group waypoint handle status', { exact: true }),
          ).toContainText('Unapplied');
          expect(await f.read()).toEqual(p);
          const delta = at === 4 ? 24 : 27;
          const coverage = await f.canvas.evaluate(
            (node, { samples, delta }) => {
              const c = node as HTMLCanvasElement,
                d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
              return samples.map(
                (points) =>
                  points.filter((p) =>
                    p.color.every(
                      (v, i) => d[((p.y - delta) * c.width + p.x + delta) * 4 + i] === v,
                    ),
                  ).length / points.length,
              );
            },
            { samples, delta },
          );
          for (const ratio of coverage) expect(ratio).toBeGreaterThan(0.6);
          const expected = structuredClone(p),
            updated = expected.layers[0].liveMotionSpans![0].path!;
          const control =
            role === 'incoming'
              ? updated.waypointIncoming![slot]
              : updated.waypointTangents![slot + 1];
          control.x += 64;
          control.y -= 64;
          await page
            .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
            .click();
          await expect(f.panel).toHaveCount(0);
          await expect.poll(f.read).toEqual(expected);
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

for (const mode of ['uniform', 'axes', 'shear', 'both'])
  test(`group handle preserves explicit ${mode} scale settings`, async ({ page }) => {
    const p = fixture('reflected', mode),
      f = await setup(page, p, 4),
      expected = structuredClone(p);
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
    expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
    expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].y = 2;
    await page
      .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
      .click();
    await expect.poll(f.read).toEqual(expected);
  });
test('group handle invalid numeric targets and missing slots never publish', async ({ page }) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('');
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'finite',
  );
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('3');
  await expect(
    page.getByRole('button', { name: 'Commit live group waypoint handle', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('1');
  await expect(
    page.getByRole('button', { name: 'Commit live group waypoint handle', exact: true }),
  ).toBeEnabled();
});
test('numeric group handles block canvas capture and keep target drafts independent', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    b = (await f.canvas.boundingBox())!;
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page.mouse.move(
    b.x + b.width / 2 + 30 - p.width / 2,
    b.y + b.height / 2 + 55 - p.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    b.x + b.width / 2 + 80 - p.width / 2,
    b.y + b.height / 2 + 10 - p.height / 2,
  );
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('48');
});
test('real late source edits retire a group handle preview without promoting it', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await page.getByLabel('Layer name', { exact: true }).evaluate((n) => {
    const input = n as HTMLInputElement;
    input.value = 'Actual source edit';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const expected = structuredClone(p);
  expected.layers[0].name = 'Actual source edit';
  await expect.poll(f.read).toEqual(expected);
  await expect(f.panel).toHaveCount(0);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
});
test('newer numeric input during original group selection is never overwritten', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    Object.assign(window, {
      groupSelectionHook: 0,
      restoreGroupSelectionHook: () => (JSON.stringify = stringify),
    });
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      if (
        !(window as unknown as { groupSelectionHook: number }).groupSelectionHook &&
        (
          document.querySelector(
            '[aria-label="Live group waypoint handle number"]',
          ) as HTMLInputElement
        )?.value === '2'
      ) {
        (window as unknown as { groupSelectionHook: number }).groupSelectionHook++;
        const x = document.querySelector(
          '[aria-label="Live group waypoint handle document X"]',
        ) as HTMLInputElement;
        x.value = '999';
        x.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return stringify(...args);
    }) as typeof JSON.stringify;
  });
  await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('2');
  expect(
    await page.evaluate(
      () => (window as unknown as { groupSelectionHook: number }).groupSelectionHook,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { restoreGroupSelectionHook: () => void }).restoreGroupSelectionHook(),
  );
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('999');
  await expect(
    page.getByRole('button', { name: 'Commit live group waypoint handle', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('1');
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('30');
});
for (const coupling of ['independent', 'aligned'] as const)
  test(`${coupling} group handle prepared children alter presentation without library writes`, async ({
    page,
  }) => {
    const p = fixture(),
      lib = livePresentationFixture('graphic');
    p.symbols = lib.symbols;
    const layer = { ...structuredClone(lib.layers[1]), id: 'children', liveMotionSpans: undefined };
    for (const key of layer.keys)
      for (const s of key.shapes) {
        s.x += 350;
        s.y += 160;
      }
    p.layers.push(layer);
    const f = await setup(page, p, 4);
    await page
      .getByLabel('Live group waypoint handle coupling', { exact: true })
      .selectOption(coupling);
    const pixel = (x: number, y: number) =>
      f.canvas.evaluate(
        (node, { x, y, p }) => {
          const c = node as HTMLCanvasElement,
            d = devicePixelRatio;
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.round((c.width / d / 2 + x - p.width / 2) * d),
                Math.round((c.height / d / 2 + y - p.height / 2) * d),
                1,
                1,
              ).data,
          );
        },
        { x, y, p },
      );
    await expect.poll(() => pixel(415, 205)).toEqual([0, 0, 255, 255]);
    await page
      .getByLabel('Live group waypoint handle remembered children', { exact: true })
      .check();
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page
      .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
      .click();
    await expect(
      page.getByLabel('Live group waypoint handle status', { exact: true }),
    ).toContainText('Unapplied');
    await expect.poll(() => pixel(445, 205)).toEqual([0, 0, 255, 255]);
    expect(await f.read()).toEqual(p);
    await page
      .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
      .click();
    const expected = structuredClone(p);
    expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
    if (coupling === 'aligned') {
      const got = (await f.read()).layers[0].liveMotionSpans![0].path!.waypointIncoming![0];
      const factor = Math.hypot(20, 10) / Math.hypot(28, 5);
      expect(got.x).toBeCloseTo(-28 * factor, 12);
      expect(got.y).toBeCloseTo(-5 * factor, 12);
      Object.assign(expected.layers[0].liveMotionSpans![0].path!.waypointIncoming![0], got);
    }
    await expect.poll(f.read).toEqual(expected);
    expect((await f.read()).symbols).toEqual(p.symbols);
  });

for (const phase of ['source', 'candidate'] as const)
  test(`a real discard during private ${phase} preview capture cannot resurrect a group proposal`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page.evaluate((phase) => {
      const native = structuredClone;
      Object.assign(window, { groupDiscardHit: 0 });
      window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
        const out = Reflect.apply(native, window, [value, ...rest]),
          q = out as Project;
        if (
          !(window as unknown as { groupDiscardHit: number }).groupDiscardHit &&
          q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
            (phase === 'source' ? 10 : 28)
        ) {
          (window as unknown as { groupDiscardHit: number }).groupDiscardHit++;
          [...document.querySelectorAll('button')]
            .find((b) => b.textContent === 'Discard live group waypoint handle preview')!
            .click();
        }
        return out;
      }) as typeof native;
    }, phase);
    await page
      .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as unknown as { groupDiscardHit: number }).groupDiscardHit),
    ).toBe(1);
    await f.canvas.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
    await expect(
      page.getByLabel('Live group waypoint handle status', { exact: true }),
    ).toContainText('discarded');
    expect(await f.read()).toEqual(p);
    await page
      .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
      .click();
    await expect(
      page.getByLabel('Live group waypoint handle status', { exact: true }),
    ).toContainText('Unapplied');
  });

for (const action of [
  'geometry',
  'prototype',
  'getter',
  'library',
  'target',
  'target-restored',
  'group-restored',
  'slot-restored',
  'role-restored',
  'frame',
  'frame-restored',
  'close',
  'source',
  'reentry',
] as const)
  test(`complete edited group candidate ${action} rejects before publication and permits recovery`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      let recovered = false;
      Object.assign(window, {
        groupFinalHit: 0,
        groupFinalReads: 0,
        groupFinalRestore: () => (JSON.stringify = stringify),
      });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          candidate = args[0] as Project,
          wrapper = args[0] as { project?: Project };
        if (
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 28
        )
          recovered = true;
        if (
          recovered &&
          !(window as unknown as { groupFinalHit: number }).groupFinalHit &&
          candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 28
        ) {
          (window as unknown as { groupFinalHit: number }).groupFinalHit++;
          const input = (label: string, value: string, event = 'input') => {
            const n = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            n.value = value;
            n.dispatchEvent(new Event(event, { bubbles: true }));
          };
          const button = (name: string) =>
            [...document.querySelectorAll('button')].find((b) => b.textContent === name)!.click();
          if (action === 'geometry') candidate.layers[0].keys[0].shapes[0].x = 999;
          if (action === 'prototype')
            Object.setPrototypeOf(candidate.layers[0].keys[0].shapes[0], { forged: true });
          if (action === 'getter')
            Object.defineProperty(candidate.layers[0].keys[0].shapes[0], 'width', {
              enumerable: true,
              get() {
                (window as unknown as { groupFinalReads: number }).groupFinalReads++;
                return 12;
              },
            });
          if (action === 'library') candidate.symbols![0].shapes[0].width = Infinity;
          if (action === 'target' || action === 'target-restored')
            input('Live group waypoint handle document X', '84');
          if (action === 'target-restored') input('Live group waypoint handle document X', '48');
          if (action === 'group-restored') {
            input('Live group waypoint handle group', '1', 'change');
            input('Live group waypoint handle group', '0', 'change');
          }
          if (action === 'slot-restored') {
            input('Live group waypoint handle number', '2');
            input('Live group waypoint handle number', '1');
          }
          if (action === 'role-restored') {
            input('Live group waypoint handle role', 'incoming', 'change');
            input('Live group waypoint handle role', 'outgoing', 'change');
          }
          if (['group-restored', 'slot-restored', 'role-restored'].includes(action)) {
            input('Live group waypoint handle document X', '48');
            input('Live group waypoint handle document Y', '52');
          }
          if (action === 'frame' || action === 'frame-restored') button('Next frame');
          if (action === 'frame-restored') button('Previous frame');
          if (action === 'close') button('Close live group waypoint handle positions');
          if (action === 'source') input('Layer name', 'Independent final source', 'change');
          if (action === 'reentry') button('Commit live group waypoint handle');
        }
        return out;
      }) as typeof stringify;
    }, action);
    await page
      .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as unknown as { groupFinalHit: number }).groupFinalHit),
    ).toBe(1);
    expect(
      await page.evaluate(() => (window as unknown as { groupFinalReads: number }).groupFinalReads),
    ).toBe(0);
    await page.evaluate(() =>
      (window as unknown as { groupFinalRestore: () => void }).groupFinalRestore(),
    );
    const source = structuredClone(p);
    if (action === 'source') source.layers[0].name = 'Independent final source';
    await expect.poll(f.read).toEqual(source);
    if (['source', 'frame', 'frame-restored', 'close'].includes(action)) {
      await expect(f.panel).toHaveCount(0);
      if (action === 'frame')
        await page.getByRole('button', { name: 'Previous frame', exact: true }).click();
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page
        .getByRole('button', { name: 'Edit live group waypoint handles…', exact: true })
        .click();
    }
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
    await page
      .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
      .click();
    const expected = structuredClone(source);
    expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
    expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].y = 2;
    await expect.poll(f.read).toEqual(expected);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(source);
    if (action === 'source') {
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(p);
    }
  });
test('raw group history before-image getter rejects with zero reads and a fresh retry', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
  await page.evaluate(() => {
    const native = structuredClone;
    let edited = false;
    Object.assign(window, { groupHistoryHit: 0, groupHistoryReads: 0 });
    window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
      const out = Reflect.apply(native, window, [value, ...rest]),
        q = out as Project,
        x = q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x;
      if (x === 28) edited = true;
      if (
        edited &&
        x === 10 &&
        !(window as unknown as { groupHistoryHit: number }).groupHistoryHit
      ) {
        (window as unknown as { groupHistoryHit: number }).groupHistoryHit++;
        Object.defineProperty(q.layers[0].keys[0].shapes[0], 'width', {
          enumerable: true,
          get() {
            (window as unknown as { groupHistoryReads: number }).groupHistoryReads++;
            return 12;
          },
        });
      }
      return out;
    }) as typeof native;
  });
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as unknown as { groupHistoryHit: number }).groupHistoryHit),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { groupHistoryReads: number }).groupHistoryReads,
    ),
  ).toBe(0);
  expect(await f.read()).toEqual(p);
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
  expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].y = 2;
  await expect.poll(f.read).toEqual(expected);
});

test('newer group numeric preview survives older preparation and commits the current original target', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page.evaluate(() => {
    const native = structuredClone;
    Object.assign(window, { groupPreviewReplacement: 0 });
    window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
      const out = Reflect.apply(native, window, [value, ...rest]),
        q = out as Project;
      if (
        !(window as unknown as { groupPreviewReplacement: number }).groupPreviewReplacement &&
        q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 10
      ) {
        (window as unknown as { groupPreviewReplacement: number }).groupPreviewReplacement++;
        const x = document.querySelector(
          '[aria-label="Live group waypoint handle document X"]',
        ) as HTMLInputElement;
        x.value = '84';
        x.dispatchEvent(new Event('input', { bubbles: true }));
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent === 'Preview live group waypoint handle')!
          .click();
      }
      return out;
    }) as typeof native;
  });
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { groupPreviewReplacement: number }).groupPreviewReplacement,
    ),
  ).toBe(1);
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('84');
  await expect
    .poll(() =>
      f.canvas.evaluate((node, p) => {
        const c = node as HTMLCanvasElement,
          d = devicePixelRatio;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (84 - p.width / 2) * d),
              Math.round(c.height / 2 + (55 - p.height / 2) * d),
              1,
              1,
            ).data,
        );
      }, p),
    )
    .toEqual([0, 126, 170, 255]);
  expect(await f.read()).toEqual(p);
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 64;
  await expect.poll(f.read).toEqual(expected);
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of [0, 1])
    for (const slot of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`aligned numeric group ${basis}/${group}/${slot}/${role} preserves original radius and complete history`, async ({
          page,
        }) => {
          const p = fixture(basis);
          // Plain 12x10 fills can sit entirely beneath the selected stem; give the raster oracle independent visible interiors.
          if (basis === 'plain')
            for (const key of p.layers[0].keys)
              for (const shape of key.shapes) {
                shape.width *= 2;
                shape.height *= 2;
              }
          const f = await setup(page, p, 4);
          await page
            .getByLabel('Live group waypoint handle group', { exact: true })
            .selectOption(String(group));
          await page
            .getByLabel('Live group waypoint handle number', { exact: true })
            .fill(String(slot + 1));
          await page
            .getByLabel('Live group waypoint handle role', { exact: true })
            .selectOption(role);
          await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
          await page
            .getByLabel('Author live group waypoint handle on release', { exact: true })
            .check();
          await page
            .getByLabel('Live group waypoint handle coupling', { exact: true })
            .selectOption('aligned');
          await expect(
            page.getByLabel('Drag live group waypoint handles', { exact: true }),
          ).toBeChecked();
          await expect(
            page.getByLabel('Drag live group waypoint handles', { exact: true }),
          ).toBeDisabled();
          await expect(
            page.getByLabel('Author live group waypoint handle on release', { exact: true }),
          ).toBeDisabled();
          const path = p.layers[0].liveMotionSpans![0].path!,
            origin = p.layers[0].keys[0].shapes[group === 0 ? 0 : 2];
          const anchor = {
            x: origin.x + path.waypoints![slot].x,
            y: origin.y + path.waypoints![slot].y,
          };
          const originalPixels = await interiors(page);
          // A perpendicular, exactly representable selected direction independently determines its opposite.
          const selected =
            role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
          const opposite =
            role === 'incoming' ? path.waypointTangents![slot + 1] : path.waypointIncoming![slot];
          const nx = -selected.y * 4,
            ny = selected.x * 4;
          await page
            .getByLabel('Live group waypoint handle document X', { exact: true })
            .fill(String(anchor.x + nx));
          await page
            .getByLabel('Live group waypoint handle document Y', { exact: true })
            .fill(String(anchor.y + ny));
          await page
            .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
            .click();
          await expect(
            page.getByLabel('Live group waypoint handle status', { exact: true }),
          ).toContainText('Unapplied');
          expect(await f.read()).toEqual(p);
          const radiusRatio = Math.hypot(opposite.x, opposite.y) / Math.hypot(nx, ny);
          const activeSelected =
            (slot === 0 && role === 'outgoing') || (slot === 1 && role === 'incoming');
          const dx = 0.375 * (activeSelected ? nx - selected.x : -nx * radiusRatio - opposite.x);
          const dy = 0.375 * (activeSelected ? ny - selected.y : -ny * radiusRatio - opposite.y);
          const coverage = await f.canvas.evaluate(
            (
              node,
              { samples, dx, dy, anchor, selected, opposite, nx, ny, radiusRatio, width, height },
            ) => {
              const c = node as HTMLCanvasElement,
                d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
              const toPixel = (x: number, y: number) => ({
                x: c.width / 2 + x - width / 2,
                y: c.height / 2 + y - height / 2,
              });
              const a = toPixel(anchor.x, anchor.y);
              const ends = [
                selected,
                opposite,
                { x: nx, y: ny },
                { x: -nx * radiusRatio, y: -ny * radiusRatio },
              ].map((v) => toPixel(anchor.x + v.x, anchor.y + v.y));
              const distance = (p: { x: number; y: number }, b: { x: number; y: number }) => {
                const vx = b.x - a.x,
                  vy = b.y - a.y,
                  t = Math.max(
                    0,
                    Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)),
                  );
                return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
              };
              return samples.map((points) => {
                // UI stems/markers cover real ink: only compare independent raster interiors away from their exact geometry.
                const visible = points.filter((p) =>
                  ends.every((b) => distance({ x: p.x + dx, y: p.y + dy }, b) > 6),
                );
                return {
                  count: visible.length,
                  ratio:
                    visible.filter((p) =>
                      p.color.every(
                        (v, i) =>
                          d[(Math.round(p.y + dy) * c.width + Math.round(p.x + dx)) * 4 + i] === v,
                      ),
                    ).length / visible.length,
                };
              });
            },
            {
              samples: originalPixels,
              dx,
              dy,
              anchor,
              selected,
              opposite,
              nx,
              ny,
              radiusRatio,
              width: p.width,
              height: p.height,
            },
          );
          for (const color of coverage) {
            expect(color.count).toBeGreaterThan(3);
            expect(color.ratio).toBeGreaterThan(0.6);
          }
          const samples = await interiors(page);
          for (const color of samples) expect(color.length).toBeGreaterThan(3);
          await page
            .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
            .click();
          const actual = await f.read(),
            expected = structuredClone(p),
            updated = expected.layers[0].liveMotionSpans![0].path!;
          const a =
            role === 'incoming'
              ? updated.waypointIncoming![slot]
              : updated.waypointTangents![slot + 1];
          const b =
            role === 'incoming'
              ? updated.waypointTangents![slot + 1]
              : updated.waypointIncoming![slot];
          a.x = nx;
          a.y = ny;
          // Same radius, perpendicular rotation: no dependency on production pair arithmetic.
          const ratio = Math.hypot(opposite.x, opposite.y) / Math.hypot(nx, ny);
          const got =
            role === 'incoming'
              ? actual.layers[0].liveMotionSpans![0].path!.waypointTangents![slot + 1]
              : actual.layers[0].liveMotionSpans![0].path!.waypointIncoming![slot];
          expect(got.x).toBeCloseTo(-nx * ratio, 12);
          expect(got.y).toBeCloseTo(-ny * ratio, 12);
          expect(Math.hypot(got.x, got.y)).toBeCloseTo(Math.hypot(opposite.x, opposite.y), 12);
          b.x = got.x;
          b.y = got.y;
          expect(actual).toEqual(expected);
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

for (const action of ['Preview', 'Commit'])
  for (const mutation of ['coupling', 'target', 'source'])
    test(`aligned numeric group ${action} rejects actual post-control ${mutation} changes`, async ({
      page,
    }) => {
      const p = fixture(),
        f = await setup(page, p, 4);
      await page
        .getByLabel('Live group waypoint handle coupling', { exact: true })
        .selectOption('aligned');
      await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
      await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
      await page.evaluate((mutation) => {
        const native = structuredClone;
        Object.assign(window, { alignedGroupHook: 0 });
        window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
          const out = Reflect.apply(native, window, [value, ...rest]),
            q = out as Project;
          if (
            !(window as unknown as { alignedGroupHook: number }).alignedGroupHook &&
            q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 28
          ) {
            (window as unknown as { alignedGroupHook: number }).alignedGroupHook++;
            if (mutation === 'coupling') {
              const select = document.querySelector(
                '[aria-label="Live group waypoint handle coupling"]',
              ) as HTMLSelectElement;
              select.value = 'independent';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              select.value = 'aligned';
              select.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (mutation === 'target') {
              const x = document.querySelector(
                '[aria-label="Live group waypoint handle document X"]',
              ) as HTMLInputElement;
              x.value = '84';
              x.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              const name = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              name.value = 'Actual late aligned group source';
              name.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          return out;
        }) as typeof native;
      }, mutation);
      await page
        .getByRole('button', { name: `${action} live group waypoint handle`, exact: true })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { alignedGroupHook: number }).alignedGroupHook,
        ),
      ).toBe(1);
      const current = await f.read();
      const unchanged = structuredClone(p);
      if (mutation === 'source') unchanged.layers[0].name = 'Actual late aligned group source';
      expect(current).toEqual(unchanged);
      if (mutation !== 'source') {
        expect(current).toEqual(p);
        await page
          .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
          .click();
        await expect(
          page.getByLabel('Live group waypoint handle status', { exact: true }),
        ).toContainText('Unapplied');
      } else expect(current.layers[0].name).toBe('Actual late aligned group source');
    });

test('aligned numeric group default target and zero direction reject, valid retry and mode recovery preserve preferences', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  const coupling = page.getByLabel('Live group waypoint handle coupling', { exact: true });
  await coupling.selectOption('aligned');
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('20');
  await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('50');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  expect(await f.read()).toEqual(p);
  await expect(
    page.getByLabel('Live group waypoint handle status', { exact: true }),
  ).not.toContainText('Unapplied');
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page.getByLabel('Live group waypoint handle document Y', { exact: true }).fill('52');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await coupling.selectOption('independent');
  await expect(
    page.getByRole('button', { name: 'Use group waypoint handle draft target', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('48');
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  const expected = structuredClone(p);
  Object.assign(expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1], { x: 28, y: 2 });
  await expect.poll(f.read).toEqual(expected);
});

test('aligned numeric group retained drag and release preferences cannot capture or publish', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await page.getByLabel('Author live group waypoint handle on release', { exact: true }).check();
  const coupling = page.getByLabel('Live group waypoint handle coupling', { exact: true });
  await coupling.selectOption('aligned');
  await f.canvas.scrollIntoViewIfNeeded();
  const r = (await f.canvas.boundingBox())!;
  await f.canvas.evaluate((n) =>
    n.addEventListener(
      'pointerdown',
      (e) => Object.assign(window, { alignedPointer: (e as PointerEvent).pointerId }),
      { once: true },
    ),
  );
  await page.mouse.move(
    r.x + r.width / 2 + 30 - p.width / 2,
    r.y + r.height / 2 + 55 - p.height / 2,
  );
  await page.mouse.down();
  expect(
    await page.evaluate(() => (window as unknown as { alignedPointer: number }).alignedPointer),
  ).toBeGreaterThan(0);
  expect(
    await f.canvas.evaluate((n) =>
      n.hasPointerCapture((window as unknown as { alignedPointer: number }).alignedPointer),
    ),
  ).toBe(false);
  await page.mouse.move(
    r.x + r.width / 2 + 90 - p.width / 2,
    r.y + r.height / 2 + 75 - p.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('30');
  await expect(
    page.getByRole('button', { name: 'Use group waypoint handle draft target', exact: true }),
  ).toBeDisabled();
  await coupling.selectOption('independent');
  await expect(page.getByLabel('Drag live group waypoint handles', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Drag live group waypoint handles', { exact: true })).toBeChecked();
  await expect(
    page.getByLabel('Author live group waypoint handle on release', { exact: true }),
  ).toBeChecked();
});
