import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { connectedLines, connectedWorldNodes } from '../connected-anchor-fixture';

async function setup(page: Page, symbol = false, object = false) {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = object ? 'object' : 'merge';
  const artwork = connectedLines(!object);
  if (object) for (const s of artwork) s.drawingMode = 'object';
  if (symbol)
    p.symbols = [
      { id: 'joined', name: 'Joined strokes', width: 400, height: 300, shapes: artwork },
    ];
  else p.layers[0].keys[0].shapes = artwork;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  if (symbol) {
    await page
      .getByRole('option', { name: 'Library item Joined strokes', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pos = async (x: number, y: number) => {
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + b.width / 2 - 200 + x,
      y: b.y + b.height / 2 - 150 + y,
    };
  };
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n, p) => {
        const c = n as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          x = ((r.width / 2 - 200 + p.x) * c.width) / r.width,
          y = ((r.height / 2 - 150 + p.y) * c.height) / r.height;
        return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data);
      },
      { x, y },
    );
  const drag = async (
    x: number,
    y: number,
    dx: number,
    dy: number,
    during?: () => Promise<void>,
    cancel = false,
  ) => {
    await canvas.scrollIntoViewIfNeeded();
    const a = await pos(x, y);
    await canvas.evaluate((n: HTMLCanvasElement) => {
      n.addEventListener(
        'pointerdown',
        (e) => {
          (n as HTMLElement).dataset.from = JSON.stringify([e.clientX, e.clientY]);
        },
        { once: true },
      );
      n.addEventListener(
        'pointerup',
        (e) => {
          (n as HTMLElement).dataset.to = JSON.stringify([e.clientX, e.clientY]);
        },
        { once: true },
      );
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(
      a.x + dx,
      a.y + dy,
      { steps: 5 },
    );
    if (during) await during();
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    const delivered = await canvas.evaluate((n) => ({
      a: JSON.parse((n as HTMLElement).dataset.from!),
      b: JSON.parse((n as HTMLElement).dataset.to!),
    }));
    return {
      x: delivered.b[0] - delivered.a[0],
      y: delivered.b[1] - delivered.a[1],
    };
  };
  return { p, artwork, canvas, read, pixel, drag, errors };
}
function expectJoined(
  before: ReturnType<typeof connectedLines>,
  after: ReturnType<typeof connectedLines>,
  dx: number,
  dy: number,
) {
  expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
  let joined = 0;
  for (const source of before) {
    const old = connectedWorldNodes(source),
      next = connectedWorldNodes(after.find((s) => s.id === source.id)!);
    expect(next).toHaveLength(old.length);
    old.forEach((n, i) => {
      const atJoin = Math.hypot(n.x - 200, n.y - 120) < 1e-7;
      if (atJoin) joined++;
      for (const role of ['anchor', 'in', 'out'] as const) {
        const a = role === 'anchor' ? n : n[role],
          b = role === 'anchor' ? next[i] : next[i][role];
        if (!a) {
          expect(b).toBeUndefined();
          continue;
        }
        expect(b).toBeDefined();
        expect(b!.x).toBeCloseTo(a.x + (atJoin ? dx : 0), 7);
        expect(b!.y).toBeCloseTo(a.y + (atJoin ? dy : 0), 7);
      }
    });
  }
  expect(joined).toBeGreaterThanOrEqual(3);
}
test('main joined stroke anchors stay connected through drag, nudge and history', async ({
  page,
}) => {
  const f = await setup(page),
    delta = await f.drag(200, 120, 30, -30, async () => {
      await expect.poll(() => f.pixel(200, 120)).toEqual([255, 255, 255, 255]);
      expect(await f.read()).toEqual(f.p);
    });
  const out = await f.read();
  expectJoined(f.artwork, out.layers[0].keys[0].shapes, delta.x, delta.y);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  const nudged = await f.read();
  expectJoined(f.artwork, nudged.layers[0].keys[0].shapes, delta.x + 1, delta.y);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(out);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  expect(f.errors).toEqual([]);
});

test('Selection moves one merged line while the other branches follow only at the junction', async ({
  page,
}) => {
  const f = await setup(page, false, false);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const preview = async () => {
    await expect.poll(() => f.pixel(200, 120)).toEqual([255, 255, 255, 255]);
    expect(f.errors).toEqual([]);
    expect(await f.read()).toEqual(f.p);
  };
  await f.drag(130, 110, 25, -25, preview, true);
  await expect.poll(f.read).toEqual(f.p);
  const blank = await f.canvas.boundingBox();
  await page.mouse.click(blank!.x + blank!.width / 2, blank!.y + blank!.height / 2 + 90);
  const delta = await f.drag(130, 110, 25, -25, preview);
  await expect.poll(f.read).not.toEqual(f.p);
  const moved = await f.read();
  const checkJunction = (project: Project, dx: number, dy: number) => {
    const nodes = project.layers[0].keys[0].shapes.flatMap(connectedWorldNodes);
    const has = (x: number, y: number) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 1e-7);
    expect(nodes.filter((n) => Math.hypot(n.x - 200 - dx, n.y - 120 - dy) < 1e-7)).toHaveLength(3);
    expect(has(60 + dx, 120 + dy)).toBe(true);
    expect(has(300, 120)).toBe(true);
    expect(has(200, 200)).toBe(true);
    expect(has(200, 120)).toBe(false);
  };
  checkJunction(moved, delta.x, delta.y);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(f.read).not.toEqual(moved);
  checkJunction(await f.read(), delta.x + 1, delta.y);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(moved);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(moved);
});

test('main joined vertex cancellation restores every branch and leaves a fresh drag actionable', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(
    200,
    120,
    30,
    -30,
    async () => {
      await expect.poll(() => f.pixel(200, 120)).toEqual([255, 255, 255, 255]);
      expect(await f.read()).toEqual(f.p);
    },
    true,
  );
  expect(await f.read()).toEqual(f.p);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  const delta = await f.drag(200, 120, -20, 20);
  expectJoined(f.artwork, (await f.read()).layers[0].keys[0].shapes, delta.x, delta.y);
  expect(f.errors).toEqual([]);
});

test('independent object lines keep their separate anchors at a coincident point', async ({
  page,
}) => {
  const f = await setup(page, false, true),
    delta = await f.drag(200, 120, 30, -30),
    out = await f.read();
  let moved = 0,
    unchanged = 0;
  for (const s of f.artwork) {
    const old = connectedWorldNodes(s),
      next = connectedWorldNodes(out.layers[0].keys[0].shapes.find((p) => p.id === s.id)!);
    expect(next).toHaveLength(old.length);
    old.forEach((p, i) => {
      if (p.x !== 200 || p.y !== 120) return;
      if (Math.hypot(next[i].x - p.x - delta.x, next[i].y - p.y - delta.y) < 1e-7) moved++;
      if (next[i].x === p.x && next[i].y === p.y) unchanged++;
    });
  }
  expect(moved).toBe(1);
  expect(unchanged).toBe(2);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('symbol joined vertices retain local cancellation, nudge, Save and document history', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.drag(
    200,
    120,
    30,
    -30,
    async () => {
      await expect.poll(() => f.pixel(200, 135)).toEqual([255, 255, 255, 255]);
      expect(await f.read()).toEqual(f.p);
    },
    true,
  );
  await f.canvas.press('Control+z');
  await expect.poll(() => f.pixel(200, 135)).not.toEqual([255, 255, 255, 255]);
  const delta = await f.drag(200, 120, 30, -30, async () => {
    await expect.poll(() => f.pixel(200, 135)).toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(f.p);
  });
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  expect(await f.read()).toEqual(f.p);
  await f.canvas.press('Control+z');
  await f.canvas.press('Control+z');
  await expect.poll(() => f.pixel(200, 135)).not.toEqual([255, 255, 255, 255]);
  await f.canvas.press('Control+Shift+z');
  await f.canvas.press('Control+Shift+z');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const out = await f.read();
  expectJoined(f.artwork, out.symbols![0].shapes, delta.x + 1, delta.y);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  expect(f.errors).toEqual([]);
});
