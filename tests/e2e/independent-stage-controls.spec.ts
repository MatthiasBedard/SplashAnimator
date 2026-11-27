import { test, expect, type Page } from '@playwright/test';
import { liveRotationFixture } from '../live-motion-rotation-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';
function fixture(basis = 'plain') {
  const { p } = liveRotationFixture('rigid', basis, true);
  p.width = 400;
  const l = p.layers[0];
  l.name = 'Route';
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  for (const k of l.keys.slice(0, 2))
    for (const s of k.shapes) {
      s.opacity = 1;
      s.fill = s.id === 'loose' ? '#0000ff' : s.groups?.[0] === 'second' ? '#00ff00' : '#ff0000';
    }
  l.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  l.liveMotionSpans![0].groupPaths = ['outer', 'second'].map((groupId) => ({
    groupId,
    composition: 'additive',
    path: { startX: 25, startY: -40, endX: -25, endY: -40 },
  }));
  return p;
}
async function setup(page: Page, p = fixture(), at = 4) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('independent-stage-seeded')) return;
    sessionStorage.setItem('independent-stage-seeded', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.focus();
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit independent group curve controls\u2026', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Independent group curve controls', exact: true });
  await expect(panel).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const numeric = async (x: number, y: number) => {
    await panel.getByLabel('Independent group curve document X', { exact: true }).fill(String(x));
    await panel.getByLabel('Independent group curve document Y', { exact: true }).fill(String(y));
  };
  const preview = async () => {
    await panel
      .getByRole('button', { name: 'Preview independent group curve control', exact: true })
      .click();
    await expect(panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
      'Unapplied',
    );
  };
  const commit = async () => {
    await panel
      .getByRole('button', { name: 'Commit independent group curve control', exact: true })
      .click();
  };
  const pixel = (x: number, y: number) =>
    page.getByLabel('Drawing stage', { exact: true }).evaluate(
      (n, { x, y, p }) => {
        const c = n as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
              Math.round(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      },
      { x, y, p },
    );
  return { p, panel, read, numeric, preview, commit, pixel, timeline, errors };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    for (const role of ['start', 'end'])
      test(`independent ${group}/${role}/${basis} numeric preview and commit retain current pose and other groups`, async ({
        page,
      }) => {
        const f = await setup(page, fixture(basis));
        await f.panel
          .getByLabel('Independent group curve control', { exact: true })
          .selectOption({ label: `track / live / ${group} / ${role}` });
        const x = Number(
            await f.panel
              .getByLabel('Independent group curve document X', { exact: true })
              .inputValue(),
          ),
          y = Number(
            await f.panel
              .getByLabel('Independent group curve document Y', { exact: true })
              .inputValue(),
          );
        await f.numeric(x + 20, y + 20);
        await f.preview();
        expect(await f.read()).toEqual(f.p);
        await expect(f.panel.getByLabel('Drag live group curve controls')).toHaveCount(0);
        await expect(f.panel.getByLabel('Author live group curve on release')).toHaveCount(0);
        const u = basis === 'plain' ? 3 : basis === 'reflected' ? -4.5 : 7.5,
          v = basis === 'plain' ? 3 : 9.75,
          gx = group === 'outer' ? 40 : 200,
          gy = group === 'outer' ? 28 : 128,
          color = group === 'outer' ? [255, 0, 0, 255] : [0, 255, 0, 255];
        await expect.poll(() => f.pixel(gx + 7.5 + u, gy + 7.5 + v)).toEqual(color);
        const ox = group === 'outer' ? 200 : 40,
          oy = group === 'outer' ? 128 : 28,
          other = group === 'outer' ? [0, 255, 0, 255] : [255, 0, 0, 255];
        await expect.poll(() => f.pixel(ox + u, oy + v)).toEqual(other);
        await f.commit();
        await expect(f.panel).toBeHidden();
        const q = structuredClone(f.p),
          bank = q.layers[0].liveMotionSpans![0].groupPaths!.find((b) => b.groupId === group)!.path;
        if (role === 'start') {
          bank.startX += 20;
          bank.startY += 20;
        } else {
          bank.endX += 20;
          bank.endY += 20;
        }
        await expect.poll(f.read).toEqual(q);
        await expect.poll(() => f.pixel(gx + 7.5 + u, gy + 7.5 + v)).toEqual(color);
        await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
          `${group} / ${role}`,
        );
        await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
          '2 artwork members',
        );
        await expect(page.getByLabel('Live stage status', { exact: true })).toContainText(
          'read-only',
        );
        await f.timeline.focus();
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
        await page.getByLabel('Drawing stage', { exact: true }).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(q);
        expect(f.errors).toEqual([]);
      });
test('Escape restores the original pose while authoritative numeric values remain unapplied', async ({
  page,
}) => {
  const f = await setup(page);
  await f.numeric(45, 0);
  await f.preview();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => f.pixel(43, 31)).toEqual([255, 0, 0, 255]);
  await expect(
    f.panel.getByLabel('Independent group curve document X', { exact: true }),
  ).toHaveValue('45');
  expect(await f.read()).toEqual(f.p);
  await f.commit();
  await expect(f.panel).toBeHidden();
  expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(45);
});
test('numeric control edits invalidate old previews and direct Commit freshly prepares the new target', async ({
  page,
}) => {
  const f = await setup(page);
  await f.numeric(45, 0);
  await f.preview();
  await f.numeric(35, -10);
  await expect.poll(() => f.pixel(43, 31)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  await f.commit();
  const bank = (await f.read()).layers[0].liveMotionSpans![0].groupPaths![0].path;
  expect(bank.startX).toBe(35);
  expect(bank.startY).toBe(-30);
});
test('Close discards proposed poses and native stage movements cannot author independent controls', async ({
  page,
}) => {
  const f = await setup(page);
  await f.numeric(45, 0);
  await f.preview();
  const c = page.getByLabel('Drawing stage', { exact: true }),
    b = (await c.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2 - 155, b.y + b.height / 2 - 120);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 100, b.y + b.height / 2 - 80);
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await expect(
    f.panel.getByLabel('Independent group curve document X', { exact: true }),
  ).toHaveValue('45');
  await f.panel
    .getByRole('button', { name: 'Close independent group curve controls', exact: true })
    .click();
  await expect.poll(() => f.pixel(43, 31)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
});
test('prepared remembered children coexist with independent group previews without library writes', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  for (const k of p.layers[0].keys.slice(0, 2)) {
    k.shapes[0].groups = ['outer'];
    k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'member', x: k.shapes[0].x + 30 });
  }
  const s = p.layers[0].liveMotionSpans![0];
  s.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  s.path = { startX: 0, startY: 20, endX: 0, endY: 20 };
  s.groupPaths = [
    { groupId: 'outer', composition: 'additive', path: { startX: 0, startY: 0, endX: 0, endY: 0 } },
  ];
  const f = await setup(page, p, 2);
  await f.panel.getByLabel('Independent group curve remembered children', { exact: true }).check();
  await f.numeric(20, 10);
  await f.preview();
  await expect.poll(() => f.pixel(25, 45)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(35, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(55, 25)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

for (const action of [
  'candidate',
  'source',
  'target-restored',
  'pick-restored',
  'reentry',
] as const)
  test(`independent final recovery ${action} rejects stale publication and preserves atomic history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.numeric(45, 0);
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      Object.assign(window, { independentFinalHit: false });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          wrapper = args[0] as { project?: Project };
        const w = window as unknown as { independentFinalHit: boolean };
        if (
          !w.independentFinalHit &&
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0]?.path.startX === 45
        ) {
          w.independentFinalHit = true;
          if (action === 'candidate') wrapper.project.layers[0].keys[0].shapes[0].x++;
          if (action === 'source') {
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate independent source edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'target-restored') {
            const el = document.querySelector(
              '[aria-label="Independent group curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '45']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'pick-restored') {
            const el = document.querySelector(
              '[aria-label="Independent group curve control"]',
            ) as HTMLSelectElement;
            const before = el.value;
            for (const value of ['1', before]) {
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (action === 'reentry')
            [...document.querySelectorAll('button')]
              .find((e) => e.textContent?.trim() === 'Commit independent group curve control')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await f.commit();
    expect(
      await page.evaluate(
        () => (window as unknown as { independentFinalHit: boolean }).independentFinalHit,
      ),
    ).toBe(true);
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate independent source edit';
    expect(await f.read()).toEqual(expected);
    if (action !== 'source') {
      await f.numeric(45, 0);
      await f.commit();
      await expect(f.panel).toBeHidden();
      const q = structuredClone(f.p);
      q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
      q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
      expect(await f.read()).toEqual(q);
    }
    await page.getByTitle('First frame', { exact: true }).click();
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const role of ['start', 'end'])
  test(`independent ${role} empty numeric target rejects and corrected input recovers`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.panel
      .getByLabel('Independent group curve control', { exact: true })
      .selectOption({ label: `track / live / outer / ${role}` });
    await f.panel.getByLabel('Independent group curve document X', { exact: true }).fill('');
    await f.commit();
    await expect(
      f.panel.getByLabel('Independent group curve status', { exact: true }),
    ).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await f.numeric(45, 0);
    await f.commit();
    await expect(f.panel).toBeHidden();
    const q = structuredClone(f.p),
      path = q.layers[0].liveMotionSpans![0].groupPaths![0].path;
    if (role === 'start') {
      path.startX = 45;
      path.startY = -20;
    } else {
      path.endX = -35;
      path.endY = -36;
    }
    expect(await f.read()).toEqual(q);
    expect(f.errors).toEqual([]);
  });
test('independent unchanged control rejects without history and fresh direct commit recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await f.commit();
  await expect(f.panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
    'unchanged',
  );
  expect(await f.read()).toEqual(f.p);
  await f.numeric(45, 0);
  await f.commit();
  await expect(f.panel).toBeHidden();
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const action of ['frame', 'source'] as const)
  test(`independent numeric proposal loses ownership after actual ${action} change`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.numeric(45, 0);
    await f.preview();
    if (action === 'frame') {
      await f.timeline.focus();
      await page.keyboard.press('ArrowRight');
    } else
      await page.getByLabel('Layer name', { exact: true }).evaluate((el) => {
        (el as HTMLInputElement).value = 'Separate route source';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await expect(f.panel).toBeHidden();
    const q = structuredClone(f.p);
    if (action === 'source') q.layers[0].name = 'Separate route source';
    expect(await f.read()).toEqual(q);
    expect(f.errors).toEqual([]);
  });

test('independent original group and role changes discard old poses before fresh target preparation', async ({
  page,
}) => {
  const f = await setup(page);
  await f.numeric(45, 0);
  await f.preview();
  await f.panel
    .getByLabel('Independent group curve control', { exact: true })
    .selectOption({ label: 'track / live / second / end' });
  await expect.poll(() => f.pixel(43, 31)).toEqual([255, 0, 0, 255]);
  await expect(
    f.panel.getByLabel('Independent group curve document X', { exact: true }),
  ).toHaveValue('215');
  await expect(
    f.panel.getByLabel('Independent group curve document Y', { exact: true }),
  ).toHaveValue('96');
  await f.numeric(235, 116);
  await f.commit();
  const q = structuredClone(f.p);
  q.layers[0].liveMotionSpans![0].groupPaths![1].path.endX = -5;
  q.layers[0].liveMotionSpans![0].groupPaths![1].path.endY = -20;
  expect(await f.read()).toEqual(q);
  expect(f.errors).toEqual([]);
});
test('independent later-track numeric authoring preserves earlier tracks and JSON reopening', async ({
  page,
}) => {
  const p = fixture(),
    extra = structuredClone(p.layers[0]);
  extra.id = 'later';
  extra.name = 'Later';
  p.layers[0].visible = false;
  p.layers.push(extra);
  const f = await setup(page, p);
  await f.panel
    .getByLabel('Independent group curve control', { exact: true })
    .selectOption({ label: 'later / live / outer / start' });
  await f.numeric(45, 0);
  await f.preview();
  await expect.poll(() => f.pixel(50, 38)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  await f.commit();
  const q = structuredClone(p);
  q.layers[1].liveMotionSpans![0].groupPaths![0].path.startX = 45;
  q.layers[1].liveMotionSpans![0].groupPaths![0].path.startY = -20;
  expect(await f.read()).toEqual(q);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(f.read).toEqual(q);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit independent group curve controls\u2026', exact: true })
    .click();
  await page
    .getByLabel('Independent group curve control', { exact: true })
    .selectOption({ label: 'later / live / outer / start' });
  await expect(page.getByLabel('Independent group curve document X', { exact: true })).toHaveValue(
    '45',
  );
  await expect(page.getByLabel('Independent group curve document Y', { exact: true })).toHaveValue(
    '0',
  );
  expect(f.errors).toEqual([]);
});
test('independent numeric edit retains explicit distance timing and shared waypoint metadata', async ({
  page,
}) => {
  const p = fixture(),
    s = p.layers[0].liveMotionSpans![0];
  s.groupPaths![0].path.distance = true;
  s.path = { startX: 0, startY: 40, endX: 0, endY: 40, waypoints: [{ x: 0, y: 30 }] };
  const f = await setup(page, p);
  await f.numeric(45, 0);
  await f.commit();
  const q = structuredClone(p);
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
  await expect.poll(f.read).toEqual(q);
  expect(f.errors).toEqual([]);
});

for (const at of [0, 8])
  test(`independent endpoint frame ${at} retains exactly the authored group's editable selection`, async ({
    page,
  }) => {
    const f = await setup(page, fixture(), at);
    await f.numeric(45, 0);
    await f.commit();
    const q = structuredClone(f.p);
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
    expect(await f.read()).toEqual(q);
    await expect(
      page.getByText('2 vectors selected. Drag or use arrow keys to move together.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
      'outer / start',
    );
    await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
      '2 artwork members',
    );
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
    expect(f.errors).toEqual([]);
  });

function canvasFixture(basis = 'plain') {
  const p = fixture(basis);
  p.width = 500;
  p.height = 320;
  for (const k of p.layers[0].keys)
    for (const v of k.shapes) {
      v.x += 60;
      v.y += 60;
    }
  return p;
}
async function stagePoint(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (n, { p, x, y }) => {
      const c = n as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        w = c.width / devicePixelRatio,
        h = c.height / devicePixelRatio;
      return {
        x: r.left + ((w / 2 + x - p.width / 2) * r.width) / w,
        y: r.top + ((h / 2 + y - p.height / 2) * r.height) / h,
      };
    },
    { p, x, y },
  );
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    for (const role of ['start', 'end'])
      test(`independent canvas draft ${basis}/${group}/${role} preserves real pixels and exact numeric publication`, async ({
        page,
      }) => {
        const f = await setup(page, canvasFixture(basis));
        await f.panel
          .getByLabel('Independent group curve control', { exact: true })
          .selectOption({ label: `track / live / ${group} / ${role}` });
        const x = Number(
            await f.panel
              .getByLabel('Independent group curve document X', { exact: true })
              .inputValue(),
          ),
          y = Number(
            await f.panel
              .getByLabel('Independent group curve document Y', { exact: true })
              .inputValue(),
          );
        const drag = f.panel.getByLabel('Drag independent group curve controls', { exact: true });
        await expect(drag).not.toBeChecked();
        await drag.check();
        const c = page.getByLabel('Drawing stage', { exact: true }),
          a = await stagePoint(page, f.p, x, y),
          z = await stagePoint(page, f.p, x + 20, y + 20);
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
        await page.mouse.move(z.x + 2, z.y - 1, { steps: 5 });
        await page.mouse.up();
        await expect(
          f.panel.getByLabel('Independent group curve status', { exact: true }),
        ).toContainText('Unapplied');
        expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
        expect(await f.read()).toEqual(f.p);
        await expect(
          f.panel.getByLabel('Independent group curve document X', { exact: true }),
        ).toHaveValue(String(x));
        const u = basis === 'plain' ? 3 : basis === 'reflected' ? -4.5 : 7.5,
          v = basis === 'plain' ? 3 : 9.75,
          gx = group === 'outer' ? 100 : 260,
          gy = group === 'outer' ? 88 : 188,
          color = group === 'outer' ? [255, 0, 0, 255] : [0, 255, 0, 255];
        await expect.poll(() => f.pixel(gx + 7.5 + u, gy + 7.5 + v)).toEqual(color);
        await expect
          .poll(() =>
            f.pixel((group === 'outer' ? 260 : 100) + u, (group === 'outer' ? 188 : 88) + v),
          )
          .toEqual(group === 'outer' ? [0, 255, 0, 255] : [255, 0, 0, 255]);
        await f.panel
          .getByRole('button', { name: 'Use independent group curve draft target', exact: true })
          .click();
        await expect(
          f.panel.getByLabel('Independent group curve document X', { exact: true }),
        ).toHaveValue(String(x + 20));
        await expect(
          f.panel.getByLabel('Independent group curve document Y', { exact: true }),
        ).toHaveValue(String(y + 20));
        await f.commit();
        const q = structuredClone(f.p),
          path = q.layers[0].liveMotionSpans![0].groupPaths!.find((b) => b.groupId === group)!.path;
        if (role === 'start') {
          path.startX += 20;
          path.startY += 20;
        } else {
          path.endX += 20;
          path.endY += 20;
        }
        await expect.poll(f.read).toEqual(q);
        await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
          `${group} / ${role}`,
        );
        await page.getByTitle('First frame', { exact: true }).click();
        await c.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(q);
        expect(f.errors).toEqual([]);
      });
for (const shift of [false, true])
  test(`independent canvas CSS axes frozen offsets and Shift ${shift}`, async ({ page }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true });
    await c.evaluate((n) => {
      (n as HTMLElement).style.transform = 'scale(.85,.8)';
    });
    await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 115, 50);
    await c.evaluate((n) => {
      const events: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
      Object.assign(window, { independentEvents: events });
      for (const name of ['pointerdown', 'pointerup'])
        n.addEventListener(
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
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    await page.mouse.move(z.x + 2, z.y - 1, { steps: 4 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await expect(
      f.panel.getByLabel('Independent group curve status', { exact: true }),
    ).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    const delta = await c.evaluate((n) => {
      const r = n.getBoundingClientRect(),
        c = n as HTMLCanvasElement,
        e = (
          window as unknown as {
            independentEvents: { down: { x: number; y: number }; up: { x: number; y: number } };
          }
        ).independentEvents;
      return {
        x: ((e.up.x - e.down.x) * (c.width / devicePixelRatio)) / r.width,
        y: ((e.up.y - e.down.y) * (c.height / devicePixelRatio)) / r.height,
      };
    });
    await f.panel
      .getByRole('button', { name: 'Use independent group curve draft target', exact: true })
      .click();
    expect(
      Number(
        await f.panel
          .getByLabel('Independent group curve document X', { exact: true })
          .inputValue(),
      ),
    ).toBe(85 + delta.x);
    expect(
      Number(
        await f.panel
          .getByLabel('Independent group curve document Y', { exact: true })
          .inputValue(),
      ),
    ).toBe(40 + (shift ? 0 : delta.y));
    expect(f.errors).toEqual([]);
  });
for (const action of ['escape', 'lost', 'close', 'policy', 'zero', 'return'] as const)
  test(`independent canvas ${action} restores valid prior numeric presentation without history`, async ({
    page,
  }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true });
    await f.numeric(105, 60);
    await f.preview();
    await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 125, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (action !== 'zero') {
      await page.mouse.move(z.x, z.y, { steps: 4 });
      await expect(
        f.panel.getByLabel('Independent group curve status', { exact: true }),
      ).toContainText('Unapplied');
    }
    if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'lost')
      await c.evaluate((n) => (n as HTMLCanvasElement).releasePointerCapture(1));
    else if (action === 'policy')
      await f.panel
        .getByLabel('Drag independent group curve controls', { exact: true })
        .evaluate((n) => (n as HTMLInputElement).click());
    else if (action === 'close')
      await f.panel
        .getByRole('button', { name: 'Close independent group curve controls', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    else if (action === 'return') await page.mouse.move(a.x, a.y);
    await page.mouse.up();
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    expect(await f.read()).toEqual(f.p);
    if (action !== 'close') {
      await expect.poll(() => f.pixel(110.5, 98.5)).toEqual([255, 0, 0, 255]);
      await expect(
        f.panel.getByLabel('Independent group curve document X', { exact: true }),
      ).toHaveValue('105');
    } else await expect.poll(() => f.pixel(103, 91)).toEqual([255, 0, 0, 255]);
    expect(f.errors).toEqual([]);
  });
for (const phase of ['initial', 'release'])
  test(`independent ${phase} restored gesture policy rejects and permits a source-valid fresh capture`, async ({
    page,
  }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true }),
      check = f.panel.getByLabel('Drag independent group curve controls', { exact: true });
    await check.check();
    await page.evaluate((phase) => {
      const clone = structuredClone;
      Object.assign(window, {
        independentPolicyHit: false,
        independentPolicyArmed: phase === 'initial',
      });
      window.structuredClone = ((...args: Parameters<typeof clone>) => {
        const out = clone(...args),
          p = args[0] as Project,
          w = window as unknown as {
            independentPolicyHit: boolean;
            independentPolicyArmed: boolean;
          };
        if (
          !w.independentPolicyHit &&
          w.independentPolicyArmed &&
          p?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths &&
          (phase === 'initial' ||
            !(
              document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement
            ).hasPointerCapture(1))
        ) {
          w.independentPolicyHit = true;
          const el = document.querySelector(
            '[aria-label="Drag independent group curve controls"]',
          ) as HTMLInputElement;
          el.click();
          el.click();
        }
        return out;
      }) as typeof clone;
    }, phase);
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 105, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (phase === 'release')
      await page.evaluate(() => {
        (window as unknown as { independentPolicyArmed: boolean }).independentPolicyArmed = true;
      });
    await page.mouse.move(z.x, z.y);
    await page.mouse.up();
    expect(
      await page.evaluate(
        () => (window as unknown as { independentPolicyHit: boolean }).independentPolicyHit,
      ),
    ).toBe(true);
    expect(await f.read()).toEqual(f.p);
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 3 });
    await page.mouse.up();
    await expect(
      f.panel.getByLabel('Independent group curve status', { exact: true }),
    ).toContainText('Unapplied');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const phase of ['movement', 'release'])
  for (const action of ['source', 'target', 'policy'] as const)
    test(`independent late ${phase} ${action} after edited bank exists rejects stale canvas output`, async ({
      page,
    }) => {
      const f = await setup(page, canvasFixture()),
        c = page.getByLabel('Drawing stage', { exact: true });
      await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
      await page.evaluate(
        ({ phase, action }) => {
          const clone = structuredClone;
          Object.assign(window, { independentLateHit: false });
          window.structuredClone = ((...args: Parameters<typeof clone>) => {
            const out = clone(...args),
              p = args[0] as Project,
              w = window as unknown as { independentLateHit: boolean };
            const captured = (
              document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement
            ).hasPointerCapture(1);
            if (
              !w.independentLateHit &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0]?.path.startX === 45 &&
              (phase === 'movement' ? captured : !captured)
            ) {
              w.independentLateHit = true;
              if (action === 'source') {
                const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
                el.value = 'Separate late canvas source';
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (action === 'target') {
                const el = document.querySelector(
                  '[aria-label="Independent group curve document X"]',
                ) as HTMLInputElement;
                el.value = '999';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              if (action === 'policy') {
                const el = document.querySelector(
                  '[aria-label="Drag independent group curve controls"]',
                ) as HTMLInputElement;
                el.click();
                el.click();
              }
            }
            return out;
          }) as typeof clone;
        },
        { phase, action },
      );
      const a = await stagePoint(page, f.p, 85, 40),
        z = await stagePoint(page, f.p, 105, 60);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(z.x, z.y);
      if (phase === 'movement')
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as { independentLateHit: boolean }).independentLateHit,
            ),
          )
          .toBe(true);
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { independentLateHit: boolean }).independentLateHit,
        ),
      ).toBe(true);
      expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
      const q = structuredClone(f.p);
      if (action === 'source') q.layers[0].name = 'Separate late canvas source';
      expect(await f.read()).toEqual(q);
      if (action !== 'source') {
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(z.x, z.y, { steps: 3 });
        await page.mouse.up();
        await expect(
          f.panel.getByLabel('Independent group curve status', { exact: true }),
        ).toContainText('Unapplied');
        expect(await f.read()).toEqual(f.p);
      } else {
        await page.getByTitle('First frame', { exact: true }).click();
        await c.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
      }
      expect(f.errors).toEqual([]);
    });
test('independent original markers own picks while shared and distant proposed markers cannot capture', async ({
  page,
}) => {
  const f = await setup(page, canvasFixture()),
    c = page.getByLabel('Drawing stage', { exact: true });
  await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
  await f.numeric(125, 60);
  await f.preview();
  for (const target of [
    { x: 60, y: 120 },
    { x: 125, y: 60 },
  ]) {
    const a = await stagePoint(page, f.p, target.x, target.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    await page.mouse.up();
  }
  const a = await stagePoint(page, f.p, 85, 40);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('independent canvas foreground artwork on a foreign layer blocks original controls', async ({
  page,
}) => {
  const p = canvasFixture(),
    layer = structuredClone(p.layers[0]);
  layer.id = 'cover';
  layer.name = 'Foreground';
  delete layer.liveMotionSpans;
  layer.keys = [
    {
      frame: 0,
      shapes: [
        {
          ...structuredClone(layer.keys[0].shapes[0]),
          id: 'foreign',
          x: 80,
          y: 35,
          width: 10,
          height: 10,
          groups: undefined,
        },
      ],
    },
  ];
  p.layers.push(layer);
  const f = await setup(page, p),
    c = page.getByLabel('Drawing stage', { exact: true });
  await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
  const a = await stagePoint(page, p, 85, 40);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(f.panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
    'Foreground',
  );
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('independent canvas drafts render prepared remembered children and preserve script-free source', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  p.width = 280;
  p.height = 200;
  for (const k of p.layers[0].keys.slice(0, 2)) {
    k.shapes[0].groups = ['outer'];
    k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'member', x: k.shapes[0].x + 30 });
  }
  for (const layer of p.layers)
    for (const k of layer.keys)
      for (const v of k.shapes) {
        v.x += 60;
        v.y += 60;
      }
  const s = p.layers[0].liveMotionSpans![0];
  s.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  s.path = { startX: 0, startY: 20, endX: 0, endY: 20 };
  s.groupPaths = [
    { groupId: 'outer', composition: 'additive', path: { startX: 0, startY: 0, endX: 0, endY: 0 } },
  ];
  const f = await setup(page, p, 2);
  await f.panel.getByLabel('Independent group curve remembered children', { exact: true }).check();
  await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
  const a = await stagePoint(page, p, 60, 60),
    z = await stagePoint(page, p, 80, 70);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 4 });
  await page.mouse.up();
  await expect(f.panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect.poll(() => f.pixel(85, 105)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(95, 105)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(125, 85)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

async function enableIndependentRelease(f: Awaited<ReturnType<typeof setup>>) {
  await f.panel.getByLabel('Drag independent group curve controls', { exact: true }).check();
  const author = f.panel.getByLabel('Author independent group curve on release', { exact: true });
  await expect(author).not.toBeChecked();
  await author.check();
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    for (const role of ['start', 'end'])
      test(`independent direct release ${basis}/${group}/${role} publishes one exact current-frame group edit`, async ({
        page,
      }) => {
        const f = await setup(page, canvasFixture(basis));
        await f.panel
          .getByLabel('Independent group curve control', { exact: true })
          .selectOption({ label: `track / live / ${group} / ${role}` });
        const x = Number(
            await f.panel
              .getByLabel('Independent group curve document X', { exact: true })
              .inputValue(),
          ),
          y = Number(
            await f.panel
              .getByLabel('Independent group curve document Y', { exact: true })
              .inputValue(),
          );
        await enableIndependentRelease(f);
        const c = page.getByLabel('Drawing stage', { exact: true }),
          a = await stagePoint(page, f.p, x, y),
          z = await stagePoint(page, f.p, x + 20, y + 20);
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
        await page.mouse.move(z.x + 2, z.y - 1, { steps: 4 });
        expect(await f.read()).toEqual(f.p);
        await page.mouse.up();
        await expect(f.panel).toBeHidden();
        expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
        const q = structuredClone(f.p),
          path = q.layers[0].liveMotionSpans![0].groupPaths!.find((v) => v.groupId === group)!.path;
        if (role === 'start') {
          path.startX += 20;
          path.startY += 20;
        } else {
          path.endX += 20;
          path.endY += 20;
        }
        await expect.poll(f.read).toEqual(q);
        const u = basis === 'plain' ? 3 : basis === 'reflected' ? -4.5 : 7.5,
          v = basis === 'plain' ? 3 : 9.75,
          gx = group === 'outer' ? 100 : 260,
          gy = group === 'outer' ? 88 : 188;
        await expect
          .poll(() => f.pixel(gx + 7.5 + u, gy + 7.5 + v))
          .toEqual(group === 'outer' ? [255, 0, 0, 255] : [0, 255, 0, 255]);
        await expect
          .poll(() =>
            f.pixel((group === 'outer' ? 260 : 100) + u, (group === 'outer' ? 188 : 88) + v),
          )
          .toEqual(group === 'outer' ? [0, 255, 0, 255] : [255, 0, 0, 255]);
        await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
          `${group} / ${role}`,
        );
        await expect(page.getByLabel('Live stage status', { exact: true })).toContainText(
          'read-only',
        );
        await page.getByTitle('First frame', { exact: true }).click();
        await c.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(q);
        expect(f.errors).toEqual([]);
      });
for (const shift of [false, true])
  test(`independent direct release CSS axes offsets and Shift ${shift}`, async ({ page }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true });
    await c.evaluate((n) => {
      (n as HTMLElement).style.transform = 'scale(.85,.8)';
    });
    await enableIndependentRelease(f);
    await c.evaluate((n) => {
      const events: { down?: { x: number; y: number }; up?: { x: number; y: number } } = {};
      Object.assign(window, { independentDirectEvents: events });
      for (const name of ['pointerdown', 'pointerup'])
        n.addEventListener(
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
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 115, 50);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    await page.mouse.move(z.x + 2, z.y - 1, { steps: 4 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await expect(f.panel).toBeHidden();
    const delta = await c.evaluate((n) => {
      const r = n.getBoundingClientRect(),
        c = n as HTMLCanvasElement,
        e = (
          window as unknown as {
            independentDirectEvents: {
              down: { x: number; y: number };
              up: { x: number; y: number };
            };
          }
        ).independentDirectEvents;
      return {
        x: ((e.up.x - e.down.x) * (c.width / devicePixelRatio)) / r.width,
        y: ((e.up.y - e.down.y) * (c.height / devicePixelRatio)) / r.height,
      };
    });
    const q = structuredClone(f.p);
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 25 + delta.x;
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -40 + (shift ? 0 : delta.y);
    expect(await f.read()).toEqual(q);
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    expect(f.errors).toEqual([]);
  });
for (const action of ['escape', 'lost', 'zero', 'return', 'close'] as const)
  test(`independent direct release ${action} cannot publish and restores source history`, async ({
    page,
  }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true });
    await enableIndependentRelease(f);
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 105, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (action !== 'zero') await page.mouse.move(z.x, z.y, { steps: 3 });
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'lost')
      await c.evaluate((n) => (n as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'return') await page.mouse.move(a.x, a.y);
    if (action === 'close')
      await f.panel
        .getByRole('button', { name: 'Close independent group curve controls', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    await page.mouse.up();
    expect(await f.read()).toEqual(f.p);
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    expect(f.errors).toEqual([]);
  });

for (const phase of ['initial', 'release'])
  for (const policy of ['author', 'gesture'] as const)
    test(`independent authoring ${phase} restored ${policy} policy rejects then permits fresh draft and authoring`, async ({
      page,
    }) => {
      const f = await setup(page, canvasFixture()),
        c = page.getByLabel('Drawing stage', { exact: true });
      await enableIndependentRelease(f);
      await page.evaluate(
        ({ phase, policy }) => {
          const clone = structuredClone;
          Object.assign(window, {
            independentAuthorHit: false,
            independentAuthorArmed: phase === 'initial',
          });
          window.structuredClone = ((...args: Parameters<typeof clone>) => {
            const out = clone(...args),
              p = args[0] as Project,
              w = window as unknown as {
                independentAuthorHit: boolean;
                independentAuthorArmed: boolean;
              };
            if (
              !w.independentAuthorHit &&
              w.independentAuthorArmed &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths &&
              (phase === 'initial' ||
                !(
                  document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement
                ).hasPointerCapture(1))
            ) {
              w.independentAuthorHit = true;
              const el = document.querySelector(
                `[aria-label="${policy === 'author' ? 'Author independent group curve on release' : 'Drag independent group curve controls'}"]`,
              ) as HTMLInputElement;
              el.click();
              el.click();
            }
            return out;
          }) as typeof clone;
        },
        { phase, policy },
      );
      const a = await stagePoint(page, f.p, 85, 40),
        z = await stagePoint(page, f.p, 105, 60);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      if (phase === 'release')
        await page.evaluate(() => {
          (window as unknown as { independentAuthorArmed: boolean }).independentAuthorArmed = true;
        });
      await page.mouse.move(z.x, z.y);
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { independentAuthorHit: boolean }).independentAuthorHit,
        ),
      ).toBe(true);
      expect(await f.read()).toEqual(f.p);
      expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
      await f.panel
        .getByLabel('Author independent group curve on release', { exact: true })
        .uncheck();
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(z.x, z.y, { steps: 3 });
      await page.mouse.up();
      await expect(
        f.panel.getByLabel('Independent group curve status', { exact: true }),
      ).toContainText('Unapplied');
      expect(await f.read()).toEqual(f.p);
      await f.panel
        .getByLabel('Author independent group curve on release', { exact: true })
        .check();
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(z.x, z.y, { steps: 3 });
      await page.mouse.up();
      await expect(f.panel).toBeHidden();
      const q = structuredClone(f.p);
      q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
      q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
      expect(await f.read()).toEqual(q);
      expect(f.errors).toEqual([]);
    });
for (const phase of ['movement', 'release'])
  for (const action of ['source', 'target', 'author-policy', 'gesture-policy'] as const)
    test(`independent authoring late ${phase} ${action} after edited bank preparation rejects publication`, async ({
      page,
    }) => {
      const f = await setup(page, canvasFixture()),
        c = page.getByLabel('Drawing stage', { exact: true });
      await enableIndependentRelease(f);
      await page.evaluate(
        ({ phase, action }) => {
          const clone = structuredClone;
          Object.assign(window, { independentAuthorLate: false });
          window.structuredClone = ((...args: Parameters<typeof clone>) => {
            const out = clone(...args),
              p = args[0] as Project,
              w = window as unknown as { independentAuthorLate: boolean },
              captured = (
                document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement
              ).hasPointerCapture(1);
            if (
              !w.independentAuthorLate &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0]?.path.startX === 45 &&
              (phase === 'movement' ? captured : !captured)
            ) {
              w.independentAuthorLate = true;
              if (action === 'source') {
                const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
                el.value = 'Separate independent author source';
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (action === 'target') {
                const el = document.querySelector(
                  '[aria-label="Independent group curve document X"]',
                ) as HTMLInputElement;
                el.value = '999';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              if (action === 'author-policy' || action === 'gesture-policy') {
                const el = document.querySelector(
                  `[aria-label="${action === 'author-policy' ? 'Author independent group curve on release' : 'Drag independent group curve controls'}"]`,
                ) as HTMLInputElement;
                el.click();
                el.click();
              }
            }
            return out;
          }) as typeof clone;
        },
        { phase, action },
      );
      const a = await stagePoint(page, f.p, 85, 40),
        z = await stagePoint(page, f.p, 105, 60);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(z.x, z.y);
      if (phase === 'movement')
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as { independentAuthorLate: boolean }).independentAuthorLate,
            ),
          )
          .toBe(true);
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { independentAuthorLate: boolean }).independentAuthorLate,
        ),
      ).toBe(true);
      expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
      const q = structuredClone(f.p);
      if (action === 'source') q.layers[0].name = 'Separate independent author source';
      expect(await f.read()).toEqual(q);
      if (action === 'source') {
        await page.getByTitle('First frame', { exact: true }).click();
        await c.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.p);
      } else {
        await f.panel
          .getByLabel('Author independent group curve on release', { exact: true })
          .uncheck();
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(z.x, z.y, { steps: 3 });
        await page.mouse.up();
        await expect(
          f.panel.getByLabel('Independent group curve status', { exact: true }),
        ).toContainText('Unapplied');
        expect(await f.read()).toEqual(f.p);
        await f.panel
          .getByLabel('Author independent group curve on release', { exact: true })
          .check();
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(z.x, z.y, { steps: 3 });
        await page.mouse.up();
        await expect(f.panel).toBeHidden();
        q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
        q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
        expect(await f.read()).toEqual(q);
      }
      expect(f.errors).toEqual([]);
    });
for (const action of ['candidate', 'target-restored', 'reentry'] as const)
  test(`independent authoring final recovery ${action} after native cleanup rejects stale history`, async ({
    page,
  }) => {
    const f = await setup(page, canvasFixture()),
      c = page.getByLabel('Drawing stage', { exact: true });
    await enableIndependentRelease(f);
    await page.evaluate((action) => {
      const stringify = JSON.stringify;
      Object.assign(window, { independentAuthorFinal: false });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          v = args[0] as { project?: Project },
          w = window as unknown as { independentAuthorFinal: boolean };
        if (
          !w.independentAuthorFinal &&
          v?.project?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0]?.path.startX === 45
        ) {
          w.independentAuthorFinal = true;
          if (
            (
              document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement
            ).hasPointerCapture(1)
          )
            throw Error('Release must clean capture before recovery');
          if (action === 'candidate') v.project.layers[0].keys[0].shapes[0].x++;
          if (action === 'target-restored') {
            const el = document.querySelector(
              '[aria-label="Independent group curve document X"]',
            ) as HTMLInputElement;
            for (const value of ['999', '85']) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'reentry') {
            const button = [...document.querySelectorAll('button')].find(
              (e) => e.textContent?.trim() === 'Commit independent group curve control',
            )!;
            button.disabled = false;
            button.addEventListener(
              'click',
              () => Object.assign(window, { independentAuthorReentered: true }),
              { once: true },
            );
            button.click();
          }
        }
        return out;
      }) as typeof stringify;
    }, action);
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 105, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 3 });
    await page.mouse.up();
    expect(
      await page.evaluate(
        () => (window as unknown as { independentAuthorFinal: boolean }).independentAuthorFinal,
      ),
    ).toBe(true);
    if (action === 'reentry')
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { independentAuthorReentered: boolean })
              .independentAuthorReentered,
        ),
      ).toBe(true);
    expect(await f.read()).toEqual(f.p);
    expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 3 });
    await page.mouse.up();
    await expect(f.panel).toBeHidden();
    const q = structuredClone(f.p);
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
    expect(await f.read()).toEqual(q);
    await page.getByTitle('First frame', { exact: true }).click();
    await c.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('independent author preference alone cannot capture and keeps numeric previews and Commit independent', async ({
  page,
}) => {
  const f = await setup(page, canvasFixture()),
    c = page.getByLabel('Drawing stage', { exact: true });
  await f.numeric(105, 60);
  await f.preview();
  const author = f.panel.getByLabel('Author independent group curve on release', { exact: true });
  await author.check();
  await author.uncheck();
  await author.check();
  await expect.poll(() => f.pixel(110.5, 98.5)).toEqual([255, 0, 0, 255]);
  const a = await stagePoint(page, f.p, 85, 40),
    z = await stagePoint(page, f.p, 105, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.move(z.x, z.y);
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await f.commit();
  await expect(f.panel).toBeHidden();
  const q = structuredClone(f.p);
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
  expect(await f.read()).toEqual(q);
  expect(f.errors).toEqual([]);
});
test('independent authoring prepares remembered child pixels before release without library or script changes', async ({
  page,
}) => {
  const p = livePresentationFixture('graphic');
  p.width = 280;
  p.height = 200;
  for (const k of p.layers[0].keys.slice(0, 2)) {
    k.shapes[0].groups = ['outer'];
    k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'member', x: k.shapes[0].x + 30 });
  }
  for (const layer of p.layers)
    for (const k of layer.keys)
      for (const v of k.shapes) {
        v.x += 60;
        v.y += 60;
      }
  const s = p.layers[0].liveMotionSpans![0];
  s.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  s.path = { startX: 0, startY: 20, endX: 0, endY: 20 };
  s.groupPaths = [
    { groupId: 'outer', composition: 'additive', path: { startX: 0, startY: 0, endX: 0, endY: 0 } },
  ];
  const f = await setup(page, p, 2),
    c = page.getByLabel('Drawing stage', { exact: true });
  await f.panel.getByLabel('Independent group curve remembered children', { exact: true }).check();
  await enableIndependentRelease(f);
  const a = await stagePoint(page, p, 60, 60),
    z = await stagePoint(page, p, 80, 70);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 4 });
  await expect(f.panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect.poll(() => f.pixel(85, 105)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.pixel(95, 105)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => f.pixel(125, 85)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
  await page.mouse.up();
  await expect(f.panel).toBeHidden();
  const q = structuredClone(p);
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 20;
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = 10;
  expect(await f.read()).toEqual(q);
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(f.errors).toEqual([]);
});

for (const at of [0, 8])
  test(`independent authoring endpoint ${at} retains complete authored selection and one history step`, async ({
    page,
  }) => {
    const f = await setup(page, canvasFixture(), at),
      c = page.getByLabel('Drawing stage', { exact: true });
    await enableIndependentRelease(f);
    const a = await stagePoint(page, f.p, 85, 40),
      z = await stagePoint(page, f.p, 105, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 3 });
    await page.mouse.up();
    await expect(f.panel).toBeHidden();
    const q = structuredClone(f.p);
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
    expect(await f.read()).toEqual(q);
    await expect(
      page.getByText('2 vectors selected. Drag or use arrow keys to move together.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel('Updated independent route', { exact: true })).toContainText(
      'outer / start',
    );
    await c.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
    expect(f.errors).toEqual([]);
  });
test('independent authoring owns a later track and leaves every earlier track exact', async ({
  page,
}) => {
  const p = canvasFixture(),
    layer = structuredClone(p.layers[0]);
  layer.id = 'later';
  layer.name = 'Later';
  p.layers[0].visible = false;
  p.layers.push(layer);
  const f = await setup(page, p);
  await f.panel
    .getByLabel('Independent group curve control', { exact: true })
    .selectOption({ label: 'later / live / outer / start' });
  await enableIndependentRelease(f);
  const a = await stagePoint(page, p, 85, 40),
    z = await stagePoint(page, p, 105, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 3 });
  await page.mouse.up();
  await expect(f.panel).toBeHidden();
  const q = structuredClone(p);
  q.layers[1].liveMotionSpans![0].groupPaths![0].path.startX = 45;
  q.layers[1].liveMotionSpans![0].groupPaths![0].path.startY = -20;
  expect(await f.read()).toEqual(q);
  await expect.poll(() => f.pixel(110.5, 98.5)).toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});
test('independent authoring cannot capture a foreign foreground original marker', async ({
  page,
}) => {
  const p = canvasFixture(),
    layer = structuredClone(p.layers[0]);
  layer.id = 'cover';
  layer.name = 'Foreground';
  delete layer.liveMotionSpans;
  layer.keys = [
    {
      frame: 0,
      shapes: [
        {
          ...structuredClone(layer.keys[0].shapes[0]),
          id: 'foreign',
          x: 80,
          y: 35,
          width: 10,
          height: 10,
          groups: undefined,
        },
      ],
    },
  ];
  p.layers.push(layer);
  const f = await setup(page, p),
    c = page.getByLabel('Drawing stage', { exact: true });
  await enableIndependentRelease(f);
  const a = await stagePoint(page, p, 85, 40),
    z = await stagePoint(page, p, 105, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y);
  await page.mouse.up();
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(p);
  await expect(f.panel.getByLabel('Independent group curve status', { exact: true })).toContainText(
    'Foreground',
  );
  expect(f.errors).toEqual([]);
});

test('independent authoring restored final policy restores a valid numeric prior and permits fresh Commit', async ({
  page,
}) => {
  const f = await setup(page, canvasFixture()),
    c = page.getByLabel('Drawing stage', { exact: true });
  await f.numeric(105, 60);
  await f.preview();
  await enableIndependentRelease(f);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    Object.assign(window, { independentPriorHit: false });
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const out = stringify(...args),
        v = args[0] as { project?: Project },
        w = window as unknown as { independentPriorHit: boolean };
      if (
        !w.independentPriorHit &&
        v?.project?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0]?.path.startX === 65
      ) {
        w.independentPriorHit = true;
        const el = document.querySelector(
          '[aria-label="Author independent group curve on release"]',
        ) as HTMLInputElement;
        el.click();
        el.click();
      }
      return out;
    }) as typeof stringify;
  });
  const a = await stagePoint(page, f.p, 85, 40),
    z = await stagePoint(page, f.p, 125, 60);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 3 });
  await page.mouse.up();
  expect(await c.evaluate((n) => (n as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(
    await page.evaluate(
      () => (window as unknown as { independentPriorHit: boolean }).independentPriorHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(110.5, 98.5)).toEqual([255, 0, 0, 255]);
  await expect(
    f.panel.getByLabel('Independent group curve document X', { exact: true }),
  ).toHaveValue('105');
  await f.commit();
  await expect(f.panel).toBeHidden();
  const q = structuredClone(f.p);
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 45;
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startY = -20;
  expect(await f.read()).toEqual(q);
  expect(f.errors).toEqual([]);
});
