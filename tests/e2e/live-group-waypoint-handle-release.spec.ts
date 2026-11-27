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
        test(`group handle release ${basis}/${group}/${slot}/${role} moves every shared root and authors one complete edit`, async ({
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
          await expect(
            page.getByLabel('Author live group waypoint handle on release', { exact: true }),
          ).not.toBeChecked();
          await page
            .getByLabel('Author live group waypoint handle on release', { exact: true })
            .check();
          await move(page, p, q, 64, -64, false);
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
          await page.mouse.up();
          expect(await capture(page)).toBe(false);
          const expected = structuredClone(p),
            path = expected.layers[0].liveMotionSpans![0].path!,
            v =
              role === 'incoming' ? path.waypointIncoming![slot] : path.waypointTangents![slot + 1];
          v.x += 64;
          v.y -= 64;
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

const author = (page: Page) =>
  page.getByLabel('Author live group waypoint handle on release', { exact: true });
async function enabled(page: Page) {
  await page.getByLabel('Drag live group waypoint handles', { exact: true }).check();
  await author(page).check();
}
function edited(p: Project, dx = 20, dy = 10) {
  const out = structuredClone(p),
    v = out.layers[0].liveMotionSpans![0].path!.waypointTangents![1];
  v.x += dx;
  v.y += dy;
  return out;
}
async function published(
  page: Page,
  f: Awaited<ReturnType<typeof setup>>,
  p: Project,
  out: Project,
) {
  await expect(f.panel).toHaveCount(0);
  await expect.poll(f.read).toEqual(out);
  await expect(
    page.getByText('5 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  expect(f.errors).toEqual([]);
}
for (const phase of ['initial', 'release'] as const)
  for (const policy of ['gesture', 'authoring'] as const)
    test(`group release restored ${policy} at ${phase} rejects then permits opted-out/restored-authoring retries`, async ({
      page,
    }) => {
      const p = fixture(),
        f = await setup(page, p, 4),
        q = control(p),
        a = await point(page, p, q.x, q.y);
      await enabled(page);
      if (phase === 'release') {
        await move(page, p, q, 20, 10, false);
        await expect(status(page)).toContainText('Unapplied');
      }
      await page.evaluate(
        ({ phase, policy }) => {
          const native = structuredClone;
          let up = phase !== 'release';
          Object.assign(window, { groupReleasePolicyHit: 0, groupReleaseClean: false });
          if (!up)
            window.addEventListener(
              'pointerup',
              () => {
                up = true;
              },
              { once: true, capture: true },
            );
          window.structuredClone = ((value: unknown, ...rest: unknown[]) => {
            const out = Reflect.apply(native, window, [value, ...rest]),
              p = out as Project;
            if (
              up &&
              p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x ===
                (phase === 'initial' ? 10 : 30)
            ) {
              window.structuredClone = native;
              const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
              Object.assign(window, {
                groupReleasePolicyHit: 1,
                groupReleaseClean: !c.hasPointerCapture(1),
              });
              const input = document.querySelector(
                `[aria-label="${policy === 'gesture' ? 'Drag live group waypoint handles' : 'Author live group waypoint handle on release'}"]`,
              ) as HTMLInputElement;
              for (const checked of [false, true]) {
                input.checked = checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return out;
          }) as typeof structuredClone;
        },
        { phase, policy },
      );
      if (phase === 'initial') {
        await page.mouse.move(a.x + 2, a.y - 1);
        await page.mouse.down();
      }
      await page.mouse.up();
      expect(await capture(page)).toBe(false);
      expect(
        await page.evaluate(
          () => (window as unknown as { groupReleasePolicyHit: number }).groupReleasePolicyHit,
        ),
      ).toBe(1);
      if (phase === 'release')
        expect(
          await page.evaluate(
            () => (window as unknown as { groupReleaseClean: boolean }).groupReleaseClean,
          ),
        ).toBe(true);
      expect(await f.read()).toEqual(p);
      await author(page).uncheck();
      await move(page, p, q, 20, 10);
      await expect(status(page)).toContainText('Unapplied');
      expect(await f.read()).toEqual(p);
      await expect(use(page)).toBeEnabled();
      await author(page).check();
      await move(page, p, q, 20, 10);
      await published(page, f, p, edited(p));
    });

for (const action of [
  'target',
  'source',
  'author-policy',
  'reenter-down',
  'reenter-move',
  'reenter-up',
] as const)
  test(`group release late detached ${action} rejects after real native cleanup`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await enabled(page);
    await move(page, p, q, 20, 10, false);
    await expect(status(page)).toContainText('Unapplied');
    await page.evaluate((action) => {
      const native = structuredClone;
      let up = false;
      Object.assign(window, {
        groupReleaseLateHit: 0,
        groupReleaseLateClean: false,
        groupReleaseDelivery: 0,
      });
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
        if (up && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30) {
          window.structuredClone = native;
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          Object.assign(window, {
            groupReleaseLateHit: 1,
            groupReleaseLateClean: !c.hasPointerCapture(1),
          });
          const input = (label: string, value: string, event = 'input') => {
            const i = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            i.value = value;
            i.dispatchEvent(new Event(event, { bubbles: true }));
          };
          if (action === 'target') {
            input('Live group waypoint handle document X', '999');
            input('Live group waypoint handle document X', '30');
          }
          if (action === 'source') input('Layer name', 'Late group source', 'change');
          if (action === 'author-policy') {
            const i = document.querySelector(
              '[aria-label="Author live group waypoint handle on release"]',
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              i.checked = checked;
              i.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (action.startsWith('reenter-')) {
            const name = 'pointer' + action.slice(8);
            c.addEventListener(name, () => Object.assign(window, { groupReleaseDelivery: 1 }), {
              once: true,
            });
            c.dispatchEvent(
              new PointerEvent(name, {
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
        }
        return out;
      }) as typeof structuredClone;
    }, action);
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    const flags = await page.evaluate(() => {
      const w = window as unknown as {
        groupReleaseLateHit: number;
        groupReleaseLateClean: boolean;
        groupReleaseDelivery: number;
      };
      return {
        hit: w.groupReleaseLateHit,
        clean: w.groupReleaseLateClean,
        delivery: w.groupReleaseDelivery,
      };
    });
    expect(flags.hit).toBe(1);
    expect(flags.clean).toBe(true);
    if (action.startsWith('reenter-')) expect(flags.delivery).toBe(1);
    const out = structuredClone(p);
    if (action === 'source') out.layers[0].name = 'Late group source';
    await expect.poll(f.read).toEqual(out);
    if (action === 'source') {
      await expect(f.panel).toHaveCount(0);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(p);
    } else {
      await move(page, p, q, 20, 10);
      await published(page, f, p, edited(p));
    }
    expect(f.errors).toEqual([]);
  });

for (const action of ['zero', 'return', 'escape', 'loss', 'cancel', 'disabled'] as const)
  test(`group release ${action} never authors a document edit`, async ({ page }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await enabled(page);
    const a = await point(page, p, q.x, q.y),
      b = await point(page, p, q.x + 20, q.y + 10);
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (action !== 'zero') {
      await page.mouse.move(b.x + 2, b.y - 1);
      await expect(status(page)).toContainText('Unapplied');
    }
    if (action === 'return') await page.mouse.move(a.x + 2, a.y - 1);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'loss')
      await f.canvas.evaluate((n) => (n as HTMLCanvasElement).releasePointerCapture(1));
    if (action === 'cancel') await f.canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    if (action === 'disabled')
      await author(page).evaluate((n) => {
        const i = n as HTMLInputElement;
        i.checked = false;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    expect(await f.read()).toEqual(p);
    await expect(f.panel).toBeVisible();
    expect(f.errors).toEqual([]);
  });

for (const action of ['target', 'group', 'slot', 'role', 'frame', 'close', 'view'] as const)
  test(`group release actual ${action} change rejects stale publication`, async ({ page }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await enabled(page);
    await move(page, p, control(p), 20, 10, false);
    await expect(status(page)).toContainText('Unapplied');
    if (action === 'target')
      await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('999');
    if (action === 'group')
      await page.getByLabel('Live group waypoint handle group', { exact: true }).selectOption('1');
    if (action === 'slot')
      await page.getByLabel('Live group waypoint handle number', { exact: true }).fill('2');
    if (action === 'role')
      await page
        .getByLabel('Live group waypoint handle role', { exact: true })
        .selectOption('incoming');
    if (action === 'frame') {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      await page.keyboard.press('ArrowRight');
    }
    if (action === 'close')
      await page
        .getByRole('button', { name: 'Close live group waypoint handle positions', exact: true })
        .evaluate((n) => (n as HTMLButtonElement).click());
    if (action === 'view')
      await f.canvas.evaluate((n) => ((n as HTMLCanvasElement).style.width = '95%'));
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    expect(await f.read()).toEqual(p);
    if (action === 'frame' || action === 'close') await expect(f.panel).toHaveCount(0);
    else {
      await expect(f.panel).toBeVisible();
      if (action === 'target')
        await expect(
          page.getByLabel('Live group waypoint handle document X', { exact: true }),
        ).toHaveValue('999');
    }
    expect(f.errors).toEqual([]);
  });

for (const shift of [false, true])
  test(`group release CSS axes and Shift ${shift} retain original pointer offsets`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4),
      q = control(p);
    await enabled(page);
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
        const v = e as PointerEvent;
        rows.push({ x: v.clientX, y: v.clientY });
      });
      Object.assign(window, { groupReleaseCss: rows });
    });
    await page.mouse.move(a.x + 2, a.y - 1);
    await page.mouse.down();
    expect(await capture(page)).toBe(true);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(b.x + 2, b.y - 1, { steps: 4 });
    await expect(status(page)).toContainText('Unapplied');
    expect(await f.read()).toEqual(p);
    const delivered = await f.canvas.evaluate((n) => {
      const c = n as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        rows = (window as unknown as { groupReleaseCss: { x: number; y: number }[] })
          .groupReleaseCss,
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
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    expect(await capture(page)).toBe(false);
    const out = structuredClone(p),
      path = out.layers[0].liveMotionSpans![0].path!,
      v = path.waypointTangents![1],
      w = path.waypoints![0],
      origin = p.layers[0].keys[0].shapes[0];
    v.x = q.x + delivered.dx - (origin.x + w.x);
    v.y = q.y + (shift ? 0 : delivered.dy) - (origin.y + w.y);
    await published(page, f, p, out);
  });

test('group release opting out restores a numeric preview independently of authoring policy', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('48');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  await expect(status(page)).toContainText('Unapplied');
  await enabled(page);
  await move(page, p, control(p), 20, 10, false);
  await expect(status(page)).toContainText('Unapplied');
  await author(page).evaluate((n) => {
    const i = n as HTMLInputElement;
    i.checked = false;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.mouse.up();
  expect(await capture(page)).toBe(false);
  expect(await f.read()).toEqual(p);
  await use(page).click();
  await expect(
    page.getByLabel('Live group waypoint handle document X', { exact: true }),
  ).toHaveValue('48');
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
});

test('group release numeric proposal markers cannot authorize original handle capture', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await page.getByLabel('Live group waypoint handle document X', { exact: true }).fill('94');
  await page
    .getByRole('button', { name: 'Preview live group waypoint handle', exact: true })
    .click();
  await expect(status(page)).toContainText('Unapplied');
  await enabled(page);
  const b = await point(page, p, 94, 55);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(use(page)).toBeEnabled();
  await move(page, p, control(p), 20, 10);
  await published(page, f, p, edited(p));
});

test('group release foreign foreground blocks authoring despite the original marker', async ({
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
  const f = await setup(page, p, 4);
  await enabled(page);
  const a = await point(page, p, 30, 55);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await capture(page)).toBe(false);
  await page.mouse.up();
  expect(await f.read()).toEqual(p);
  await expect(f.panel).toBeVisible();
  expect(f.errors).toEqual([]);
});
test('group release prepared children alter presentation without library writes', async ({
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
  await author(page).check();
  await move(page, p, control(p), 18, 0, false);
  await expect(page.getByLabel('Live group waypoint handle status', { exact: true })).toContainText(
    'Unapplied',
  );
  await expect.poll(() => pixel(445, 205)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(p);
  await page.mouse.up();
  expect(await capture(page)).toBe(false);
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 28;
  await published(page, f, p, expected);
  expect((await f.read()).symbols).toEqual(p.symbols);
});

test('middle view pan with group release enabled never becomes handle publication', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p, 4);
  await enabled(page);
  const a = await point(page, p, 30, 55);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: 'middle' });
  expect(await capture(page)).toBe(true);
  await page.mouse.move(a.x + 40, a.y + 20);
  await page.mouse.up({ button: 'middle' });
  expect(await capture(page)).toBe(false);
  expect(await f.read()).toEqual(p);
  await expect(f.panel).toBeVisible();
  expect(f.errors).toEqual([]);
});

for (const action of ['target', 'source', 'policy'] as const)
  test(`complete edited group release ${action} hook rejects after recovery serialization`, async ({
    page,
  }) => {
    const p = fixture(),
      f = await setup(page, p, 4);
    await enabled(page);
    await move(page, p, control(p), 20, 10, false);
    await expect(status(page)).toContainText('Unapplied');
    await page.evaluate((action) => {
      const native = JSON.stringify;
      let up = false,
        recovery = false;
      Object.assign(window, { groupFinalReleaseHit: 0, groupFinalReleaseClean: false });
      window.addEventListener(
        'pointerup',
        () => {
          up = true;
        },
        { once: true, capture: true },
      );
      JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
        const value = args[0] as Project & { project?: Project };
        if (
          up &&
          value?.project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30
        )
          recovery = true;
        const out = native(...args);
        if (
          up &&
          recovery &&
          value?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30
        ) {
          JSON.stringify = native;
          const c = document.querySelector('[aria-label="Drawing stage"]') as HTMLCanvasElement;
          Object.assign(window, {
            groupFinalReleaseHit: 1,
            groupFinalReleaseClean: !c.hasPointerCapture(1),
          });
          if (action === 'policy') {
            const i = document.querySelector(
              '[aria-label="Author live group waypoint handle on release"]',
            ) as HTMLInputElement;
            for (const checked of [false, true]) {
              i.checked = checked;
              i.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            const label =
                action === 'source' ? 'Layer name' : 'Live group waypoint handle document X',
              i = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
            for (const val of action === 'source' ? ['Final independent source'] : ['999', '30']) {
              i.value = val;
              i.dispatchEvent(
                new Event(action === 'source' ? 'change' : 'input', { bubbles: true }),
              );
            }
          }
        }
        return out;
      }) as typeof JSON.stringify;
    }, action);
    await page.mouse.up();
    expect(await capture(page)).toBe(false);
    const flags = await page.evaluate(() => {
      const w = window as unknown as {
        groupFinalReleaseHit: number;
        groupFinalReleaseClean: boolean;
      };
      return { hit: w.groupFinalReleaseHit, clean: w.groupFinalReleaseClean };
    });
    expect(flags).toEqual({ hit: 1, clean: true });
    const out = structuredClone(p);
    if (action === 'source') out.layers[0].name = 'Final independent source';
    await expect.poll(f.read).toEqual(out);
    if (action === 'source') {
      await expect(f.panel).toHaveCount(0);
      await f.canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(p);
    } else {
      await move(page, p, control(p), 20, 10);
      await published(page, f, p, edited(p));
    }
    expect(f.errors).toEqual([]);
  });
