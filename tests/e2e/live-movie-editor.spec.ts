import { test, expect, type Page } from '@playwright/test';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';

async function setup(page: Page, mode = 'graphic', wait = true, beforeOpen?: () => Promise<void>) {
  await page.setViewportSize({ width: 1400, height: 1100 });
  const p = livePresentationFixture(
    ['movie', 'button', 'interactive', 'foreground'].includes(mode)
      ? mode === 'movie'
        ? 'movie'
        : 'button'
      : 'graphic',
  );
  p.fps = 1;
  if (mode === 'hidden') p.layers[0].visible = false;
  if (mode === 'locked') p.layers[0].locked = true;
  if (mode === 'opacity')
    p.opacityBindings = [
      {
        layerId: 'graphic',
        shapeId: 'instance',
        start: 1,
        end: 4,
        keys: [
          { frame: 1, opacity: 0.2 },
          { frame: 4, opacity: 0.8 },
        ],
      },
    ];
  if (mode === 'bad')
    p.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 50000000,
      endX: 0,
      endY: -50000000,
    };
  if (mode === 'text')
    for (const k of p.layers[0].keys)
      for (const shape of k.shapes) {
        shape.kind = 'text';
        shape.text = {
          content: 'A',
          font: 'sans-serif',
          size: 18,
          bold: false,
          italic: false,
          align: 'left',
        };
      }
  if (mode === 'affine' || mode === 'reflected') {
    p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
    for (const k of p.layers[0].keys)
      for (const shape of k.shapes) {
        shape.kind = 'polygon';
        shape.fillRule = 'evenodd';
        shape.transform = [mode === 'reflected' ? -1 : 1, 0.1, 0.2, 1];
        shape.contours = [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
          ],
        ];
      }
  }
  if (mode === 'bitmap') {
    const url = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 2, 2);
      return c.toDataURL();
    });
    p.assets = [
      {
        id: 'green',
        path: 'assets/bitmaps/green.json',
        bitmap: { name: 'Green', width: 2, height: 2, dataUrl: url },
      },
    ];
    for (const k of p.layers[0].keys)
      for (const shape of k.shapes)
        shape.bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
  }
  if (mode === 'foreground') {
    for (const k of p.layers[0].keys) for (const s of k.shapes) s.y = 40;
    p.layers.reverse();
  }
  if (mode === 'interactive') {
    const button = p.symbols![1],
      shape = p.symbols![0].shapes[0];
    button.timeline = {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...structuredClone(shape), x: 40, fill: '#00ff00' }] },
        { frame: 2, shapes: [{ ...structuredClone(shape), x: 40, fill: '#ffff00' }] },
      ],
    };
    button.buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await beforeOpen?.();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  if (wait) {
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
    await d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
    await d.getByRole('button', { name: 'Restart live movie', exact: true }).click();
    await expect(d.getByLabel('Live movie position')).toContainText('Tick 0');
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
  }
  return {
    p,
    d,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function step(page: Page, n: number) {
  const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await d.getByRole('button', { name: 'Step live preview', exact: true }).click();
  await expect(d.getByLabel('Live movie position')).toContainText(`Tick ${n}`);
  await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
}
async function pixel(page: Page, x: number, y: number) {
  return page
    .getByLabel('Live movie interaction', { exact: true })
    .evaluate(
      (c, pos) =>
        Array.from(
          (c as HTMLCanvasElement).getContext('2d')!.getImageData(pos.x, pos.y, 1, 1).data,
        ),
      { x, y },
    );
}
test('live Test Movie pauses and steps without losing keyboard focus', async ({ page }) => {
  const f = await setup(page, 'movie', false);
  const control = page.getByRole('button', { name: 'Control', exact: true });
  const status = f.d.getByLabel('Live movie status');
  const pause = f.d.getByRole('button', { name: 'Pause preview clocks', exact: true });
  await expect(pause).toBeFocused();
  await page.keyboard.press('Enter');
  const play = f.d.getByRole('button', { name: 'Play preview clocks', exact: true });
  await expect(play).toBeFocused();
  await expect(status).toContainText('Live movie ready');
  await page.keyboard.press('Shift+Tab');
  await expect(f.d.getByLabel('Live movie interaction')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(f.d.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(f.d.getByRole('button', { name: 'Restart live movie' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(f.d.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await f.d.getByRole('button', { name: 'Restart live movie' }).press('Enter');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 0');
  await expect(status).toContainText('Live movie ready');
  const step = f.d.getByRole('button', { name: 'Step live preview' });
  await step.press('Enter');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 1');
  await expect(status).toContainText('Live movie ready');
  await expect(step).toBeFocused();
  expect(await pixel(page, 25, 5)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  await expect(f.d).toHaveCount(0);
  await expect(control).toBeFocused();

  const stage = page.getByLabel('Drawing stage');
  await stage.press('Control+Enter');
  await expect(pause).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(f.d).toHaveCount(0);
  await expect(stage).toBeFocused();
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['graphic', 'movie', 'button'])
  test(`actual Test Movie live roots and ${mode} clocks retain independent paused-root timing`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    expect(await pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
    await step(page, 1);
    expect(await pixel(page, 25, 5)).toEqual([255, 0, 0, 255]);
    expect(await pixel(page, mode === 'graphic' ? 5 : 45, 45)).toEqual([0, 0, 255, 255]);
    await step(page, 2);
    expect(await pixel(page, 45, 5)).toEqual([255, 0, 0, 255]);
    await f.d.getByRole('button', { name: 'Pause live root', exact: true }).click();
    await step(page, 3);
    expect(await pixel(page, 45, 5)).toEqual([255, 0, 0, 255]);
    expect(await pixel(page, mode === 'graphic' ? 25 : 125, 45)).toEqual([0, 0, 255, 255]);
    await expect(f.d.getByLabel('Live movie position')).toContainText('Frame 3');
    await page.keyboard.press('Escape');
    await expect(f.d).toBeHidden();
    await expect(page.getByText('Frame 1 / 10', { exact: true })).toBeVisible();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('actual live button pointer/keyboard states activate without scripts or authored changes', async ({
  page,
}) => {
  const f = await setup(page, 'interactive');
  await step(page, 1);
  const canvas = f.d.getByLabel('Live movie interaction'),
    b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 45) / 160, b.y + (b.height * 45) / 80);
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  expect(await pixel(page, 45, 45)).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('aria-disabled', 'false');
  expect(await pixel(page, 45, 45)).toEqual([255, 255, 0, 255]);
  await page.mouse.up();
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 1');
  await expect(canvas).toHaveAttribute('aria-disabled', 'false');
  await canvas.focus();
  await page.keyboard.down('Enter');
  await expect(canvas).toHaveAttribute('aria-disabled', 'false');
  expect(await pixel(page, 45, 45)).toEqual([255, 255, 0, 255]);
  await page.keyboard.up('Enter');
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 2');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['hidden', 'locked', 'affine', 'reflected', 'bitmap', 'text'])
  test(`actual live movie ${mode} roots retain geometry/resources and source`, async ({ page }) => {
    const f = await setup(page, mode);
    await step(page, 1);
    if (mode === 'text') {
      const ink = await f.d.getByLabel('Live movie interaction').evaluate((c) => {
        const d = (c as HTMLCanvasElement).getContext('2d')!.getImageData(20, 0, 20, 20).data;
        let count = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1] && d[i + 1] < 240) count++;
        return count;
      });
      expect(ink).toBeGreaterThan(5);
    } else if (mode === 'affine' || mode === 'reflected') {
      const sign = mode === 'reflected' ? -1 : 1;
      expect(await pixel(page, 20 + sign * 2 + 1, 2)).toEqual([255, 0, 0, 255]);
      expect(await pixel(page, 20 + sign * 10 + 2, 11)).toEqual([255, 255, 255, 255]);
    } else
      expect(await pixel(page, 25, 5)).toEqual(
        mode === 'hidden'
          ? [255, 255, 255, 255]
          : mode === 'bitmap'
            ? [0, 255, 0, 255]
            : [255, 0, 0, 255],
      );
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('actual foreground movement cancels a captured button and preserves frozen Hit recovery', async ({
  page,
}) => {
  const f = await setup(page, 'foreground');
  await step(page, 1);
  const c = f.d.getByLabel('Live movie interaction'),
    b = (await c.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 45) / 160, b.y + (b.height * 45) / 80);
  await page.mouse.down();
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  await expect
    .poll(() => c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1)))
    .toBe(true);
  // Invoke the actual control without stealing the native pointer/focus.
  await f.d
    .getByRole('button', { name: 'Step live preview', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 2');
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  expect(await pixel(page, 45, 45)).toEqual([255, 0, 0, 255]);
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 0');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('native capture loss and CSS-scaled button input cannot leave a pressed state', async ({
  page,
}) => {
  const f = await setup(page, 'interactive');
  await step(page, 1);
  const c = f.d.getByLabel('Live movie interaction');
  await c.evaluate((el) => {
    (el as HTMLCanvasElement).style.width = '400px';
    (el as HTMLCanvasElement).style.height = '150px';
  });
  await f.d.getByRole('button', { name: 'Render live movie', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  const b = (await c.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 45) / 160, b.y + (b.height * 45) / 80);
  await page.mouse.down();
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  expect(await pixel(page, 45, 45)).toEqual([255, 255, 0, 255]);
  await c.evaluate((el) => (el as HTMLCanvasElement).releasePointerCapture(1));
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  await page.mouse.up();
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 0');
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

async function hold(page: Page, kind: string) {
  await page.evaluate((kind) => {
    const w = window as unknown as { movieHeld: boolean; movieRelease?: () => void };
    w.movieHeld = false;
    if (kind === 'font') {
      const fonts = document.fonts,
        ready = fonts.ready;
      let released = false;
      const pending = new Promise<FontFaceSet>((resolve) => {
        w.movieRelease = () => {
          released = true;
          resolve(fonts);
        };
      });
      Object.defineProperty(fonts, 'ready', {
        configurable: true,
        get() {
          if (released) return ready;
          w.movieHeld = true;
          return pending;
        },
      });
    } else {
      const decode = createImageBitmap;
      let used = false;
      window.createImageBitmap = (async (...args: Parameters<typeof decode>) => {
        const image = await decode(...args);
        if (used) return image;
        used = true;
        w.movieHeld = true;
        return new Promise<ImageBitmap>((resolve) => {
          w.movieRelease = () => resolve(image);
        });
      }) as typeof decode;
    }
  }, kind);
}
async function held(page: Page) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { movieHeld: boolean }).movieHeld))
    .toBe(true);
}
async function release(page: Page) {
  await page.evaluate(() => (window as unknown as { movieRelease?: () => void }).movieRelease?.());
}
for (const kind of ['font', 'bitmap'])
  for (const change of ['close', 'source', 'restored'])
    test(`pending live movie ${kind} rejects actual ${change} and permits fresh reopen`, async ({
      page,
    }) => {
      const f = await setup(page, kind === 'font' ? 'text' : 'bitmap', false, () =>
        hold(page, kind),
      );
      await held(page);
      await expect(f.d.getByLabel('Live movie interaction')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      if (change === 'close') {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
      }
      else if (change === 'source')
        await page
          .getByRole('button', { name: 'Add layer', exact: true, includeHidden: true })
          .evaluate((el) => (el as HTMLButtonElement).click());
      else
        await page.evaluate(() => {
          for (const title of ['Last frame', 'First frame'])
            (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
        });
      await expect(f.d).toBeHidden();
      await release(page);
      if (change === 'source') {
        expect((await f.read()).layers).toHaveLength(f.p.layers.length + 1);
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
      }
      expect(await f.read()).toEqual(f.p);
      await page.getByRole('button', { name: 'Control', exact: true }).click();
      await page
        .getByRole('button', { name: 'Test movie', exact: false })
        .filter({ hasText: 'Ctrl Enter' })
        .click();
      await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('pending restored root policy publishes only a fresh same-tick retry', async ({ page }) => {
  const f = await setup(page, 'text', false, () => hold(page, 'font'));
  await held(page);
  await f.d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await f.d.getByRole('button', { name: 'Pause live root', exact: true }).click();
  await f.d.getByRole('button', { name: 'Play live root', exact: true }).click();
  await release(page);
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 0');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Root playing');
  await step(page, 1);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('native live movie timeout retains its phase and a fresh Render recovers without source edits', async ({
  page,
}) => {
  const f = await setup(page, 'text', false, async () => {
    await page.clock.install();
    await hold(page, 'font');
  });
  await held(page);
  await page.clock.fastForward(60001);
  await expect(f.d.getByLabel('Live movie status')).toContainText('timed out');
  await release(page);
  await f.d.getByRole('button', { name: 'Render live movie', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 0');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('actual live movie opacity composes once while held graphic ages advance', async ({
  page,
}) => {
  const f = await setup(page, 'opacity');
  await step(page, 1);
  await step(page, 2);
  expect(await pixel(page, 25, 45)).toEqual([153, 153, 255, 255]);
  expect(await pixel(page, 45, 5)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('sampling failure remains blank and explicit Restart recovers the original endpoint', async ({
  page,
}) => {
  const f = await setup(page, 'bad');
  await f.d.getByRole('button', { name: 'Step live preview', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('geometry');
  await expect(f.d.getByLabel('Live movie interaction')).toHaveAttribute('aria-disabled', 'true');
  await expect(f.d.getByLabel('Live movie interaction')).toHaveCSS('opacity', '0');
  await f.d.getByRole('button', { name: 'Restart live movie', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 0');
  expect(await pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('actual preview timer keeps independent clips running while root playback is paused', async ({
  page,
}) => {
  const f = await setup(page, 'movie');
  await step(page, 1);
  await step(page, 2);
  await f.d.getByRole('button', { name: 'Pause live root', exact: true }).click();
  await page.clock.install();
  await f.d.getByRole('button', { name: 'Play preview clocks', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await page.clock.fastForward(1001);
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 3');
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  await f.d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await expect(f.d.getByLabel('Live movie position')).toContainText('Frame 3');
  expect(await pixel(page, 45, 5)).toEqual([255, 0, 0, 255]);
  expect(await pixel(page, 125, 45)).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const change of ['source', 'close', 'restored'])
  test(`complete live movie paint rejects actual late ${change} before visible publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate((change) => {
      const w = window as unknown as {
        moviePaintHit: boolean;
        movieWrites: number;
        movieRestore: () => void;
      };
      w.moviePaintHit = false;
      w.movieWrites = 0;
      const fill = CanvasRenderingContext2D.prototype.fillRect,
        draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        fill.apply(this, args);
        if (
          !w.moviePaintHit &&
          this.canvas.width === 160 &&
          this.canvas.height === 80 &&
          this.canvas !== document.querySelector('[aria-label="Live movie interaction"]')
        ) {
          w.moviePaintHit = true;
          if (change === 'source')
            (document.querySelector('[aria-label="Add layer"]') as HTMLButtonElement).click();
          else if (change === 'close')
            (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          else
            for (const title of ['Last frame', 'First frame'])
              (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
        }
      };
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<CanvasRenderingContext2D['drawImage']>
      ) {
        if (
          (this.canvas as HTMLCanvasElement).getAttribute('aria-label') === 'Live movie interaction'
        )
          w.movieWrites++;
        return draw.apply(this, args);
      } as CanvasRenderingContext2D['drawImage'];
      w.movieRestore = () => {
        CanvasRenderingContext2D.prototype.fillRect = fill;
        CanvasRenderingContext2D.prototype.drawImage = draw;
      };
    }, change);
    await f.d.getByRole('button', { name: 'Render live movie', exact: true }).click();
    await expect(f.d).toBeHidden();
    const observed = await page.evaluate(() => {
      const w = window as unknown as {
        moviePaintHit: boolean;
        movieWrites: number;
        movieRestore: () => void;
      };
      w.movieRestore();
      return { hit: w.moviePaintHit, writes: w.movieWrites };
    });
    expect(observed).toEqual({ hit: true, writes: 0 });
    if (change === 'source') {
      expect((await f.read()).layers).toHaveLength(f.p.layers.length + 1);
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    }
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('original Test Movie snapshot corruption rejects before display and a fresh retry recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const w = window as unknown as { movieCloneHit: boolean };
    w.movieCloneHit = false;
    const clone = structuredClone;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        p = out as unknown as Project;
      if (!w.movieCloneHit && p?.layers?.some((l) => l.liveMotionSpans?.length)) {
        w.movieCloneHit = true;
        p.layers.find((l) => l.liveMotionSpans?.length)!.keys[0].shapes[0].x++;
      }
      return out;
    };
  });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  await expect(f.d).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('snapshot changed');
  expect(
    await page.evaluate(() => (window as unknown as { movieCloneHit: boolean }).movieCloneHit),
  ).toBe(true);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('restored root policy during completed vector paint rejects old output and publishes one fresh retry', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      moviePolicyHit: boolean;
      moviePolicyWrites: number;
      moviePolicyRestore: () => void;
    };
    w.moviePolicyHit = false;
    w.moviePolicyWrites = 0;
    const fill = CanvasRenderingContext2D.prototype.fill,
      draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.fill = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<CanvasRenderingContext2D['fill']>
    ) {
      Reflect.apply(fill, this, args);
      if (
        !w.moviePolicyHit &&
        this.canvas.width === 160 &&
        this.canvas.height === 80 &&
        this.fillStyle === '#ff0000' &&
        (this.canvas as HTMLCanvasElement).getAttribute('aria-label') !== 'Live movie interaction'
      ) {
        w.moviePolicyHit = true;
        const control = [...document.querySelectorAll('button')].find(
          (b) => b.textContent === 'Pause live root',
        )!;
        control.click();
        control.click();
      }
    } as CanvasRenderingContext2D['fill'];
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<CanvasRenderingContext2D['drawImage']>
    ) {
      if (
        (this.canvas as HTMLCanvasElement).getAttribute('aria-label') === 'Live movie interaction'
      )
        w.moviePolicyWrites++;
      Reflect.apply(draw, this, args);
    } as CanvasRenderingContext2D['drawImage'];
    w.moviePolicyRestore = () => {
      CanvasRenderingContext2D.prototype.fill = fill;
      CanvasRenderingContext2D.prototype.drawImage = draw;
    };
  });
  await f.d.getByRole('button', { name: 'Render live movie', exact: true }).click();
  await expect(f.d.getByLabel('Live movie status')).toContainText('Live movie ready');
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      moviePolicyHit: boolean;
      moviePolicyWrites: number;
      moviePolicyRestore: () => void;
    };
    w.moviePolicyRestore();
    return { hit: w.moviePolicyHit, writes: w.moviePolicyWrites };
  });
  expect(result).toEqual({ hit: true, writes: 1 });
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 0');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Root playing');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('live button drag outside and back retains native capture and activates on valid release', async ({
  page,
}) => {
  const f = await setup(page, 'interactive');
  await step(page, 1);
  const c = f.d.getByLabel('Live movie interaction'),
    b = (await c.boundingBox())!;
  const inside = { x: b.x + (b.width * 45) / 160, y: b.y + (b.height * 45) / 80 },
    outside = { x: b.x + (b.width * 100) / 160, y: b.y + (b.height * 65) / 80 };
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  await page.mouse.move(outside.x, outside.y);
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
  await page.mouse.move(inside.x, inside.y);
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  await page.mouse.up();
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 1');
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('restored containing-dialog scroll cancels native button capture and preserves same-tick recovery', async ({
  page,
}) => {
  const f = await setup(page, 'interactive');
  await step(page, 1);
  await f.d.evaluate((el) => {
    (el as HTMLElement).style.maxHeight = '450px';
  });
  await f.d
    .getByRole('button', { name: 'Render live movie', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  const c = f.d.getByLabel('Live movie interaction');
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  const b = (await c.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 45) / 160, b.y + (b.height * 45) / 80);
  await page.mouse.down();
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
  const changed = await f.d.evaluate((el) => {
    const d = el as HTMLElement;
    d.scrollTop = 40;
    const moved = d.scrollTop > 0;
    d.dispatchEvent(new Event('scroll'));
    d.scrollTop = 0;
    d.dispatchEvent(new Event('scroll'));
    return moved;
  });
  expect(changed).toBe(true);
  await expect(c).toHaveAttribute('aria-disabled', 'false');
  expect(await c.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await expect(f.d.getByLabel('Live movie buttons')).toContainText('Activations: 0');
  await expect(f.d.getByLabel('Live movie position')).toContainText('Tick 1');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
