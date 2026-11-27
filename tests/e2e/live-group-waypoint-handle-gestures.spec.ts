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
function control(p: Project, group = 0, slot = 0, role: 'incoming' | 'outgoing' = 'outgoing') {
  const path = p.layers[0].liveMotionSpans![0].path!,
    origin = p.layers[0].keys[0].shapes[group === 0 ? 0 : 2],
    w = path.waypoints![slot],
    v = role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
  return { x: origin.x + w.x + v.x, y: origin.y + w.y + v.y };
}
async function select(page: Page, group = 0, slot = 0, role: 'incoming' | 'outgoing' = 'outgoing') {
  await page
    .getByLabel('Live group waypoint handle group', { exact: true })
    .selectOption(String(group));
  await page
    .getByLabel('Live group waypoint handle number', { exact: true })
    .fill(String(slot + 1));
  await page.getByLabel('Live group waypoint handle role', { exact: true }).selectOption(role);
}
async function move(
  page: Page,
  p: Project,
  q: { x: number; y: number },
  dx = 64,
  dy = -64,
  release = true,
) {
  const a = await point(page, p, q.x, q.y),
    b = await point(page, p, q.x + dx, q.y + dy);
  await page.mouse.move(a.x + 2, a.y - 1);
  await page.mouse.down();
  expect(await capture(page)).toBe(true);
  await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
  if (release) {
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
  }
}
const status = (page: Page) =>
  page.getByLabel('Live group waypoint handle status', { exact: true });
const use = (page: Page) =>
  page.getByRole('button', { name: 'Use group waypoint handle draft target', exact: true });
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of [0, 1])
    for (const slot of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`group handle draft ${basis}/${group}/${slot}/${role} moves every shared root without release publication`, async ({
          page,
        }) => {
          const p = fixture(basis),
            at = role === 'incoming' && slot === 0 ? 2 : role === 'outgoing' && slot === 1 ? 6 : 4,
            f = await setup(page, p, at),
            q = control(p, group, slot, role);
          await select(page, group, slot, role);
          await expect(
            page.getByLabel('Drag live group waypoint handles', { exact: true }),
          ).not.toBeChecked();
          await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
          const samples = await interiors(page);
          for (const color of samples) expect(color.length).toBeGreaterThan(3);
          await move(page, p, q);
          await expect(status(page)).toContainText('Unapplied');
          expect(await f.read()).toEqual(p);
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue(String(q.x));
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
          for (const v of coverage) expect(v).toBeGreaterThan(0.6);
          await use(page).click();
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue(String(q.x + 64));
          await expect(
            page.getByLabel('Live group waypoint handle document Y', { exact: true }),
          ).toHaveValue(String(q.y - 64));
          const expected = structuredClone(p),
            path = expected.layers[0].liveMotionSpans![0].path!,
            v =
              role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
          v.x += 64;
          v.y -= 64;
          await page
            .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
            .click();
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

for (const action of ['escape', 'loss', 'cancel', 'policy', 'view', 'zero', 'return'] as const)
  test(`group draft ${action} restores a valid independent numeric preview`, async ({ page }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
    await page
      .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
      .click();
    await expect(status(page)).toContainText('Unapplied');
    await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
    const a = await point(page, p, q.x, q.y),
      b = await point(page, p, q.x + 20, q.y + 10);
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (action !== 'zero') {
      await page.mouse.move(b.x + 2, b.y - 1, { steps: 3 });
      await expect(status(page)).toContainText('Unapplied');
    }
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((n) => (n as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'cancel') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (action === 'policy')
      await page.getByLabel('Drag live group waypoint handles', { exact: true }).evaluate((n) => {
        const c = n as HTMLInputElement;
        for (const v of [false, true]) {
          c.checked = v;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    if (action === 'view')
      await f.canvas.evaluate((n) => ((n as HTMLCanvasElement).style.width = '95%'));
    if (action === 'return') await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    await expect(use(page)).toBeEnabled();
    await use(page).click();
    await expect(
      page.getByLabel('Live group waypoint handle document X', { exact: true }),
    ).toHaveValue('48');
    await expect(
      page.getByLabel('Live group waypoint handle document Y', { exact: true }),
    ).toHaveValue(String(q.y));
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });

for (const action of ['target', 'slot', 'role', 'group', 'frame', 'close', 'source'] as const)
  test(`actual ${action} changes retire an active group handle draft`, async ({ page }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
    await move(page, p, control(p), 20, 10, false);
    await expect(status(page)).toContainText('Unapplied');
    if (action === 'target')
      await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('999');
    if (action === 'slot')
      await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('2');
    if (action === 'role')
      await page
        .getByLabel('Live group waypoint handle role', { exact: true })
        .selectOption('incoming');
    if (action === 'group')
      await page.getByLabel('Live group waypoint handle group', { exact: true }).selectOption('1');
    if (action === 'frame') {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
    }
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live group waypoint handle positions', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    const expected = structuredClone(p);
    if (action === 'source') {
      await page.getByLabel('Layer name', { exact: true }).evaluate((n) => {
        const i = n as HTMLInputElement;
        i.value = 'Independent source edit';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expected.layers[0].name = 'Independent source edit';
    }
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    await expect.poll(f.read).toEqual(expected);
    if (['target', 'slot', 'role', 'group'].includes(action)) {
      await expect(use(page)).toBeDisabled();
      if (action === 'target')
        await expect(
          page.getByLabel('Live group waypoint handle document X', { exact: true }),
        ).toHaveValue('999');
    } else await expect(f.panel).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

test('proposed group control points never own capture and fresh original picks still work', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    q = control(p);
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await move(page, p, q);
  await expect(status(page)).toContainText('Unapplied');
  const b = await point(page, p, q.x + 64, q.y - 64);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await expect(use(page)).toBeEnabled();
  expect(await f.read()).toEqual(p);
  await move(page, p, q, 20, 10);
  await expect(status(page)).toContainText('Unapplied');
  await use(page).click();
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue(String(q.x + 20));
  expect(await f.read()).toEqual(p);
});

for (const shift of [false, true])
  test(`group handle draft independent CSS scales and Shift ${shift} retain pointer offsets`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
    await f.canvas.evaluate((n) => {
      const c = n as HTMLCanvasElement;
      c.style.width = '75%';
      c.style.height = '60%';
    });
    const a = await point(page, p, q.x, q.y),
      b = await point(page, p, q.x + 40, q.y + 10);
    await f.canvas.evaluate((n) => {
      const rows: { x: number; y: number }[] = [];
      n.addEventListener('pointermove', (e) => {
        const p = e as PointerEvent;
        rows.push({ x: p.clientX, y: p.clientY });
      });
      Object.assign(window, { groupCssEvents: rows });
    });
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    expect(await capture(page)).toBe(false);
    await expect(status(page)).toContainText('Unapplied');
    const delivered = await f.canvas.evaluate((n) => {
      const c = n as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        rows = (window as unknown as { groupCssEvents: { x: number; y: number }[] }).groupCssEvents,
        a = rows[0],
        b = rows.at(-1)!;
      return {
        count: rows.length,
        dx: ((b.x - a.x) * (c.width / devicePixelRatio)) / r.width,
        dy: ((b.y - a.y) * (c.height / devicePixelRatio)) / r.height,
      };
    });
    expect(delivered.count).toBeGreaterThanOrEqual(5);
    expect(delivered.dx).toBeCloseTo(40, 0);
    await use(page).click();
    expect(
      Number(
        await page
          .getByLabel('Live group waypoint handle document X', { exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(q.x + delivered.dx, 8);
    expect(
      Number(
        await page
          .getByLabel('Live group waypoint handle document Y', { exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(q.y + (shift ? 0 : delivered.dy), 8);
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });
test('group handle canvas prepared children alter presentation without library writes', async ({
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
  await page.getByLabel('Live group waypoint handle remembered children', { exact: true }).check();
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await move(page, p, control(p), 18, 0);
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect.poll(() => pixel(445, 205)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(p);
  await use(page).click();
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
  await expect.poll(f.read).toEqual(expected);
  expect((await f.read()).symbols).toEqual(p.symbols);
});

for (const phase of ['initial', 'movement', 'release'] as const)
  for (const action of ['target', 'policy', 'source'] as const)
    test(`real ${phase} detached ${action} hook rejects stale group handles and permits source-valid retry`, async ({
      page,
    }) => {
      const p = fixture(),
        f = await setup(page, p, 4),
        q = control(p);
      await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
      const a = await point(page, p, q.x, q.y),
        b = await point(page, p, q.x + 20, q.y + 10);
      if (phase !== 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        expect(await capture(page)).toBe(true);
        if (phase === 'release') {
          await page.mouse.move(b.x + 2, b.y - 1);
          await expect(status(page)).toContainText('Unapplied');
        }
      }
      await page.evaluate(
        ({ phase, action }) => {
          const native = structuredClone;
          Object.assign(window, { groupUiHookHit: 0, groupUiHookClean: false });
          let armed = phase !== 'release';
          if (!armed)
            window.addEventListener(
              'pointerup',
              () => {
                armed = true;
              },
              { once: true, capture: true },
            );
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(native, window, [value, ...rest]),
              candidate = out as Project;
            if (
              armed &&
              candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
                (phase === 'initial' ? 10 : 30)
            ) {
              window.structuredClone = native;
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              Object.assign(window, {
                groupUiHookHit: 1,
                groupUiHookClean: !c.hasPointerCapture(1),
              });
              if (action === 'policy') {
                const i = document.querySelector(
                  '[aria-label="Drag live group waypoint handles"]',
                ) as HTMLInputElement;
                for (const v of [false, true]) {
                  i.checked = v;
                  i.dispatchEvent(new Event('change', { bubbles: true }));
                }
              } else {
                const i = document.querySelector(
                  `[aria-label="${action === 'target' ? 'Live group waypoint handle document X' : 'Layer name'}"]`,
                ) as HTMLInputElement;
                i.value = action === 'target' ? '999' : 'Late independent source';
                i.dispatchEvent(
                  new Event(action === 'target' ? 'input' : 'change', { bubbles: true }),
                );
              }
            }
            return out;
          }) as typeof structuredClone;
        },
        { phase, action },
      );
      if (phase === 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
      } else if (phase === 'movement') await page.mouse.move(b.x + 2, b.y - 1);
      await page.mouse.up();
      expect(
        await page.evaluate(() => (window as unknown as { groupUiHookHit: number }).groupUiHookHit),
      ).toBe(1);
      if (phase === 'release')
        expect(
          await page.evaluate(
            () => (window as unknown as { groupUiHookClean: boolean }).groupUiHookClean,
          ),
        ).toBe(true);
      expect(await capture(page)).toBe(false);
      const expected = structuredClone(p);
      if (action === 'source') {
        expected.layers[0].name = 'Late independent source';
        await expect(f.panel).toHaveCount(0);
      } else {
        await expect(use(page)).toBeDisabled();
        if (action === 'target')
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue('999');
        await move(page, p, q, 20, 10);
        await expect(status(page)).toContainText('Unapplied');
        await expect(use(page)).toBeEnabled();
      }
      await expect.poll(f.read).toEqual(expected);
      if (action === 'source') {
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
      }
      expect(f.errors).toEqual([]);
    });

test('original and proposed group handle markers match rendered CSS positions', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    q = control(p);
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await move(page, p, q, 20, 10);
  await expect(status(page)).toContainText('Unapplied');
  const pixels = await f.canvas.evaluate(
    (node, { p, q }) => {
      const c = node as HTMLCanvasElement,
        d = devicePixelRatio,
        ctx = c.getContext('2d')!;
      const read = (x: number, y: number) =>
        Array.from(
          ctx.getImageData(
            Math.round(c.width / 2 + (x - p.width / 2) * d),
            Math.round(c.height / 2 + (y - p.height / 2) * d),
            1,
            1,
          ).data,
        );
      let edge = 0;
      for (let y = -5; y <= 5; y++)
        for (let x = -5; x <= 5; x++) {
          const v = read(q.x + x, q.y + y);
          if (v[0] < 180 && v[1] > v[0] + 25 && v[2] > v[1] + 15) edge++;
        }
      return { original: read(q.x, q.y), proposed: read(q.x + 20, q.y + 10), edge };
    },
    { p, q },
  );
  expect(pixels.original).toEqual([255, 255, 255, 255]);
  expect(pixels.proposed).toEqual([0, 126, 170, 255]);
  expect(pixels.edge).toBeGreaterThan(3);
  await f.canvas.screenshot({ path: 'test-results/group-handle-draft-markers.png' });
  expect(await f.read()).toEqual(p);
});

test('foreign original foreground blocks group handle authoring at a visible marker', async ({
  page,
}) => {
  const p = fixture(),
    front = structuredClone(p.layers[0]);
  front.id = 'foreground';
  front.liveMotionSpans = undefined;
  const shape = structuredClone(front.keys[0].shapes[0]);
  Object.assign(shape, {
    id: 'cover',
    x: 20,
    y: 45,
    width: 20,
    height: 20,
    groups: undefined,
    fill: '#202020',
  });
  front.keys = [{ frame: 0, shapes: [shape] }];
  p.layers.push(front);
  const f = await setup(page, p, 4),
    a = await point(page, p, 30, 55);
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await expect(use(page)).toBeDisabled();
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('middle-button view navigation remains separate from enabled group handle authoring', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  await expect(status(page)).toContainText('Unapplied');
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  const a = await point(page, p, 30, 55);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: 'middle' });
  expect(await capture(page)).toBe(true);
  await page.mouse.move(a.x + 40, a.y + 20);
  await page.mouse.up({ button: 'middle' });
  expect(await capture(page)).toBe(false);
  await use(page).click();
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('48');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

async function aligned(page: Page) {
  await page
    .getByLabel('Live group waypoint handle coupling', { exact: true })
    .selectOption('aligned');
  await expect(
    page.getByLabel('Drag aligned live group waypoint handles', { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel('Drag aligned live group waypoint handles', { exact: true }).check();
}
function assertPair(
  p: Project,
  actual: Project,
  group: number,
  slot: number,
  role: 'incoming' | 'outgoing',
  dx: number,
  dy: number,
) {
  const expected = structuredClone(p),
    old = p.layers[0].liveMotionSpans![0].path!,
    path = expected.layers[0].liveMotionSpans![0].path!,
    out = actual.layers[0].liveMotionSpans![0].path!;
  const selected =
    role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
  const opposite =
    role === 'incoming' ? path.waypointTangents![slot + 1] : path.waypointIncoming![slot];
  const original =
    role === 'incoming' ? old.waypointTangents![slot + 1] : old.waypointIncoming![slot];
  const got = role === 'incoming' ? out.waypointTangents![slot + 1] : out.waypointIncoming![slot];
  selected.x += dx;
  selected.y += dy;
  const ratio = Math.hypot(original.x, original.y) / Math.hypot(selected.x, selected.y);
  expect(got.x).toBeCloseTo(-selected.x * ratio, 12);
  expect(got.y).toBeCloseTo(-selected.y * ratio, 12);
  expect(Math.hypot(got.x, got.y)).toBeCloseTo(Math.hypot(original.x, original.y), 12);
  expect(Object.keys(got)).toEqual(Object.keys(original));
  Object.assign(opposite, got);
  expect(actual).toEqual(expected);
  return expected;
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of [0, 1])
    for (const slot of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        test(`aligned group canvas ${basis}/${group}/${slot}/${role} keeps radius, shared pixels and explicit complete history`, async ({
          page,
        }) => {
          const p = fixture(basis),
            at = role === 'incoming' && slot === 0 ? 2 : role === 'outgoing' && slot === 1 ? 6 : 4,
            f = await setup(page, p, at),
            q = control(p, group, slot, role);
          await select(page, group, slot, role);
          await aligned(page);
          const samples = await interiors(page);
          for (const color of samples) expect(color.length).toBeGreaterThan(3);
          await move(page, p, q);
          await expect(status(page)).toContainText('Unapplied');
          expect(await f.read()).toEqual(p);
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue(String(q.x));
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
          await use(page).click();
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue(String(q.x + 64));
          await expect(
            page.getByLabel('Live group waypoint handle document Y', { exact: true }),
          ).toHaveValue(String(q.y - 64));
          await page
            .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
            .click();
          await expect(f.panel).toHaveCount(0);
          const expected = assertPair(p, await f.read(), group, slot, role, 64, -64);
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
for (const action of ['escape', 'loss', 'cancel', 'policy', 'view', 'zero', 'return'] as const)
  test(`aligned group canvas ${action} restores valid numeric previews independently of gesture policy`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await aligned(page);
    await page
      .getByLabel('Live group waypoint handle document X', { exact: true })
      .fill(String(q.x + 48));
    await page
      .getByLabel('Live group waypoint handle document Y', { exact: true })
      .fill(String(q.y - 48));
    await page
      .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
      .click();
    await expect(status(page)).toContainText('Unapplied');
    await move(page, p, q, 64, -64, false);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((n) => (n as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'cancel')
      await page
        .getByRole('button', { name: 'Discard live group waypoint handle preview', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    if (action === 'policy')
      await page
        .getByLabel('Drag aligned live group waypoint handles', { exact: true })
        .evaluate((n) => {
          const c = n as HTMLInputElement;
          c.checked = false;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        });
    if (action === 'view')
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5');
    if (action === 'zero' || action === 'return') {
      const a = await point(page, p, q.x, q.y);
      await page.mouse.move(a.x + 2, a.y - 1, { steps: 3 });
      if (action === 'zero') await page.keyboard.press('Escape');
    }
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    expect(await f.read()).toEqual(p);
    if (action === 'cancel') await expect(use(page)).toBeDisabled();
    else {
      await expect(use(page)).toBeEnabled();
      await use(page).click();
      await expect(
        page.getByLabel('Live group waypoint handle document X', { exact: true }),
      ).toHaveValue(String(q.x + 48));
    }
    expect(f.errors).toEqual([]);
  });
test('aligned group canvas independent and aligned opt-ins retain separate authority', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    q = control(p);
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await page.getByLabel('Author live group waypoint handle on release', { exact: true }).check();
  await page
    .getByLabel('Live group waypoint handle coupling', { exact: true })
    .selectOption('aligned');
  await expect(
    page.getByLabel('Drag aligned live group waypoint handles', { exact: true }),
  ).not.toBeChecked();
  const a = await point(page, p, q.x, q.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await page.getByLabel('Drag aligned live group waypoint handles', { exact: true }).check();
  await move(page, p, q);
  expect(await f.read()).toEqual(p);
  await expect(use(page)).toBeEnabled();
  await page
    .getByLabel('Live group waypoint handle coupling', { exact: true })
    .selectOption('independent');
  await expect(use(page)).toBeDisabled();
  await expect(page.getByLabel('Drag live group waypoint handles', { exact: true })).toBeChecked();
  await expect(
    page.getByLabel('Author live group waypoint handle on release', { exact: true }),
  ).toBeChecked();
  await page
    .getByLabel('Live group waypoint handle coupling', { exact: true })
    .selectOption('aligned');
  await expect(
    page.getByLabel('Drag aligned live group waypoint handles', { exact: true }),
  ).toBeChecked();
  await move(page, p, q);
  expect(await f.read()).toEqual(p);
  await expect(use(page)).toBeEnabled();
});

for (const phase of ['initial', 'movement', 'release'] as const)
  for (const action of ['target', 'policy', 'source', 'coupling'] as const)
    test(`aligned group canvas real ${phase} detached ${action} hook rejects stale group handles and permits source-valid retry`, async ({
      page,
    }) => {
      const p = fixture(),
        f = await setup(page, p, 4),
        q = control(p);
      await aligned(page);
      const a = await point(page, p, q.x, q.y),
        b = await point(page, p, q.x + 20, q.y + 20);
      if (phase !== 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
        expect(await capture(page)).toBe(true);
        if (phase === 'release') {
          await page.mouse.move(b.x + 2, b.y - 1);
          await expect(status(page)).toContainText('Unapplied');
        }
      }
      await page.evaluate(
        ({ phase, action }) => {
          const native = structuredClone;
          Object.assign(window, { groupUiHookHit: 0, groupUiHookClean: false });
          let armed = phase !== 'release';
          if (!armed)
            window.addEventListener(
              'pointerup',
              () => {
                armed = true;
              },
              { once: true, capture: true },
            );
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(native, window, [value, ...rest]),
              candidate = out as Project;
            if (
              armed &&
              candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
                (phase === 'initial' ? 10 : 30) &&
              (phase === 'initial' ||
                candidate.layers[0].liveMotionSpans![0].path!.waypointIncoming![0].x !== -20)
            ) {
              window.structuredClone = native;
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              Object.assign(window, {
                groupUiHookHit: 1,
                groupUiHookClean: !c.hasPointerCapture(1),
              });
              if (action === 'coupling') {
                const i = document.querySelector(
                  '[aria-label="Live group waypoint handle coupling"]',
                ) as HTMLSelectElement;
                for (const value of ['independent', 'aligned']) {
                  i.value = value;
                  i.dispatchEvent(new Event('change', { bubbles: true }));
                }
              } else if (action === 'policy') {
                const i = document.querySelector(
                  '[aria-label="Drag aligned live group waypoint handles"]',
                ) as HTMLInputElement;
                for (const v of [false, true]) {
                  i.checked = v;
                  i.dispatchEvent(new Event('change', { bubbles: true }));
                }
              } else {
                const i = document.querySelector(
                  `[aria-label="${action === 'target' ? 'Live group waypoint handle document X' : 'Layer name'}"]`,
                ) as HTMLInputElement;
                i.value = action === 'target' ? '999' : 'Late independent source';
                i.dispatchEvent(
                  new Event(action === 'target' ? 'input' : 'change', { bubbles: true }),
                );
              }
            }
            return out;
          }) as typeof structuredClone;
        },
        { phase, action },
      );
      if (phase === 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
      } else if (phase === 'movement') await page.mouse.move(b.x + 2, b.y - 1);
      await page.mouse.up();
      expect(
        await page.evaluate(() => (window as unknown as { groupUiHookHit: number }).groupUiHookHit),
      ).toBe(1);
      if (phase === 'release')
        expect(
          await page.evaluate(
            () => (window as unknown as { groupUiHookClean: boolean }).groupUiHookClean,
          ),
        ).toBe(true);
      expect(await capture(page)).toBe(false);
      const expected = structuredClone(p);
      if (action === 'source') {
        expected.layers[0].name = 'Late independent source';
        await expect(f.panel).toHaveCount(0);
      } else {
        await expect(use(page)).toBeDisabled();
        if (action === 'target')
          await expect(
            page.getByLabel('Live group waypoint handle document X', { exact: true }),
          ).toHaveValue('999');
        await move(page, p, q, 20, 10);
        await expect(status(page)).toContainText('Unapplied');
        await expect(use(page)).toBeEnabled();
      }
      await expect.poll(f.read).toEqual(expected);
      if (action === 'source') {
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(expected);
      }
      expect(f.errors).toEqual([]);
    });

for (const action of ['target', 'slot', 'role', 'group', 'frame', 'close', 'source'] as const)
  test(`aligned group canvas actual ${action} changes retire an active group handle draft`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await aligned(page);
    await move(page, p, control(p), 20, 10, false);
    await expect(status(page)).toContainText('Unapplied');
    if (action === 'target')
      await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('999');
    if (action === 'slot')
      await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('2');
    if (action === 'role')
      await page
        .getByLabel('Live group waypoint handle role', { exact: true })
        .selectOption('incoming');
    if (action === 'group')
      await page.getByLabel('Live group waypoint handle group', { exact: true }).selectOption('1');
    if (action === 'frame') {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
    }
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live group waypoint handle positions', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    const expected = structuredClone(p);
    if (action === 'source') {
      await page.getByLabel('Layer name', { exact: true }).evaluate((n) => {
        const i = n as HTMLInputElement;
        i.value = 'Independent source edit';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expected.layers[0].name = 'Independent source edit';
    }
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    await expect.poll(f.read).toEqual(expected);
    if (['target', 'slot', 'role', 'group'].includes(action)) {
      await expect(use(page)).toBeDisabled();
      if (action === 'target')
        await expect(
          page.getByLabel('Live group waypoint handle document X', { exact: true }),
        ).toHaveValue('999');
    } else await expect(f.panel).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

for (const shift of [false, true])
  test(`aligned group canvas independent CSS scales and Shift ${shift} retain pointer offsets`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await aligned(page);
    await f.canvas.evaluate((n) => {
      const c = n as HTMLCanvasElement;
      c.style.width = '75%';
      c.style.height = '60%';
    });
    const a = await point(page, p, q.x, q.y),
      b = await point(page, p, q.x + 40, q.y + 10);
    await f.canvas.evaluate((n) => {
      const rows: { x: number; y: number }[] = [];
      n.addEventListener('pointermove', (e) => {
        const p = e as PointerEvent;
        rows.push({ x: p.clientX, y: p.clientY });
      });
      Object.assign(window, { groupCssEvents: rows });
    });
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    expect(await capture(page)).toBe(false);
    await expect(status(page)).toContainText('Unapplied');
    const delivered = await f.canvas.evaluate((n) => {
      const c = n as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        rows = (window as unknown as { groupCssEvents: { x: number; y: number }[] }).groupCssEvents,
        a = rows[0],
        b = rows.at(-1)!;
      return {
        count: rows.length,
        dx: ((b.x - a.x) * (c.width / devicePixelRatio)) / r.width,
        dy: ((b.y - a.y) * (c.height / devicePixelRatio)) / r.height,
      };
    });
    expect(delivered.count).toBeGreaterThanOrEqual(5);
    expect(delivered.dx).toBeCloseTo(40, 0);
    await use(page).click();
    expect(
      Number(
        await page
          .getByLabel('Live group waypoint handle document X', { exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(q.x + delivered.dx, 8);
    expect(
      Number(
        await page
          .getByLabel('Live group waypoint handle document Y', { exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(q.y + (shift ? 0 : delivered.dy), 8);
    expect(await f.read()).toEqual(p);
    expect(f.errors).toEqual([]);
  });

test('aligned group canvas prepared children alter presentation without library writes', async ({
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
  await page.getByLabel('Live group waypoint handle remembered children', { exact: true }).check();
  await aligned(page);
  await move(page, p, control(p), 18, 0);
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect.poll(() => pixel(445, 205)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(p);
  await use(page).click();
  await page
    .getByRole('button', { name: 'Commit live group waypoint handle', exact: true })
    .click();
  const expected = assertPair(p, await f.read(), 0, 0, 'outgoing', 18, 0);
  await expect.poll(f.read).toEqual(expected);
  expect((await f.read()).symbols).toEqual(p.symbols);
});

test('aligned group canvas proposed group control points never own capture and fresh original picks still work', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    q = control(p);
  await aligned(page);
  await move(page, p, q);
  await expect(status(page)).toContainText('Unapplied');
  const b = await point(page, p, q.x + 64, q.y - 64);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await expect(use(page)).toBeEnabled();
  expect(await f.read()).toEqual(p);
  await move(page, p, q, 20, 10);
  await expect(status(page)).toContainText('Unapplied');
  await use(page).click();
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue(String(q.x + 20));
  expect(await f.read()).toEqual(p);
});

test('aligned group canvas original and admitted opposite markers match pixels and role-owned hits', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4),
    q = control(p);
  await aligned(page);
  await move(page, p, q);
  await expect(status(page)).toContainText('Unapplied');
  const ratio = Math.hypot(20, 10) / Math.hypot(74, -59),
    points = [
      q,
      { x: 0, y: 40 },
      { x: q.x + 64, y: q.y - 64 },
      { x: 20 - 74 * ratio, y: 50 + 59 * ratio },
    ];
  const pixels = await f.canvas.evaluate(
    (n, { points, p }) => {
      const c = n as HTMLCanvasElement,
        d = devicePixelRatio;
      return points.map((q) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (q.x - p.width / 2) * d),
              Math.round(c.height / 2 + (q.y - p.height / 2) * d),
              1,
              1,
            ).data,
        ),
      );
    },
    { points, p },
  );
  expect(pixels).toEqual([
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [0, 126, 170, 255],
    [0, 126, 170, 255],
  ]);
  const proposed = await point(page, p, points[3].x, points[3].y);
  await page.mouse.move(proposed.x, proposed.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  await expect(use(page)).toBeEnabled();
  await page
    .getByLabel('Live group waypoint handle role', { exact: true })
    .selectOption('incoming');
  await move(page, p, control(p, 0, 0, 'incoming'), 20, -20);
  await expect(use(page)).toBeEnabled();
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});
