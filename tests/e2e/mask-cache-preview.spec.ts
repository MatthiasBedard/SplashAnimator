import { test, expect, type Page } from '@playwright/test';
import { validateProject, type Project } from '../../packages/document/src';
import { maskResourceFixture } from '../mask-resources-fixture';

type Probe = {
  decodes: number;
  closes: number;
  loads: string[];
  held: boolean;
  release: () => void;
  canvases: HTMLCanvasElement[];
};
async function setup(page: Page, style = 'same') {
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 20, 30);
    return c.toDataURL();
  });
  const p = maskResourceFixture(url, style),
    errors: string[] = [];
  validateProject(p);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('mask-cache-seed')) {
      sessionStorage.setItem('mask-cache-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview layer mask…', exact: true }).click();
  await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
  await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
}
async function probe(page: Page, hold: 'none' | 'image' | 'font' = 'none') {
  await page.evaluate((hold) => {
    let release!: () => void,
      first = true;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      stats: Probe = { decodes: 0, closes: 0, loads: [], held: false, release, canvases: [] },
      decode = createImageBitmap,
      load = document.fonts.load.bind(document.fonts),
      create = document.createElement.bind(document);
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      stats.decodes++;
      const image = await decode(...args),
        close = image.close.bind(image);
      image.close = () => {
        stats.closes++;
        close();
      };
      if (hold === 'image' && first) {
        first = false;
        stats.held = true;
        await gate;
      }
      return image;
    }) as typeof createImageBitmap;
    document.fonts.load = async (...args) => {
      stats.loads.push(args.join('|'));
      const result = await load(...args);
      if (hold === 'font' && first) {
        first = false;
        stats.held = true;
        await gate;
      }
      return result;
    };
    document.createElement = ((...args: Parameters<typeof document.createElement>) => {
      const element = create(...args);
      if (args[0] === 'canvas') stats.canvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement;
    Object.assign(window, { maskCacheProbe: stats });
  }, hold);
}
async function counts(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe;
    return { decodes: p.decodes, closes: p.closes, loads: p.loads.length };
  });
}
async function release(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe.release(),
  );
}
async function ready(page: Page, action = 'Render mask preview') {
  await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
}
async function pixels(page: Page) {
  return page
    .locator('canvas[aria-label="Layer mask preview"]')
    .evaluate((c: HTMLCanvasElement) =>
      [5, 15, 25, 35].map((x) => Array.from(c.getContext('2d')!.getImageData(x, 20, 1, 1).data)),
    );
}
async function tick(page: Page, n: number) {
  await expect(page.getByLabel('Mask presentation tick', { exact: true })).toContainText(
    `Tick ${n}`,
  );
}
async function retired(page: Page) {
  const sizes = await page.evaluate(() => {
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!.get!,
      height = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')!.get!;
    return (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe.canvases.map((c) => [
      width.call(c),
      height.call(c),
    ]);
  });
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes).toEqual(Array(sizes.length).fill([0, 0]));
}
const blue = [0, 0, 255, 255],
  half = [128, 0, 127, 255];

for (const stepped of [false, true])
  test(`actual ${stepped ? 'stepped' : 'fixed'} previews share resources across retries/choices/modes and clear without rewinding`, async ({
    page,
  }) => {
    const f = await setup(page);
    await open(page);
    await probe(page);
    if (stepped) await page.getByLabel('Use stepped mask session').check();
    await ready(page);
    expect(await pixels(page)).toEqual([half, half, blue, blue]);
    await ready(page);
    if (stepped) {
      await ready(page, 'Step mask presentation');
      await tick(page, 1);
      expect(await pixels(page)).toEqual([blue, half, half, blue]);
      await ready(page);
    }
    await page.getByLabel('First mask target layer', { exact: true }).selectOption('');
    // A retained cache is clearable even when choices removed the last raster.
    await expect(
      page.getByRole('button', { name: 'Clear mask preview', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
    await ready(page);
    expect(await counts(page)).toEqual({ decodes: 1, closes: 0, loads: 1 });
    if (stepped) {
      await ready(page, 'Restart mask session');
      await tick(page, 0);
      await ready(page, 'Step mask presentation');
      await tick(page, 1);
    }
    await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
    expect(await counts(page)).toEqual({ decodes: 1, closes: 1, loads: 1 });
    await retired(page);
    if (stepped) await tick(page, 1);
    await ready(page);
    if (stepped) {
      await tick(page, 1);
      expect(await pixels(page)).toEqual([blue, half, half, blue]);
    }
    expect(await counts(page)).toEqual({ decodes: 2, closes: 1, loads: 2 });
    // Switching presentation mode changes clocks, not original resource ownership.
    await page.getByLabel('Use stepped mask session').setChecked(!stepped);
    await ready(page);
    expect(await pixels(page)).toEqual([half, half, blue, blue]);
    expect(await counts(page)).toEqual({ decodes: 2, closes: 1, loads: 2 });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    expect(await counts(page)).toEqual({ decodes: 2, closes: 2, loads: 2 });
    await retired(page);
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const style of ['glyph', 'run', 'faces'])
  test(`actual stepped ${style} font change loads only new readiness and retains decoded images`, async ({
    page,
  }) => {
    const f = await setup(page, style);
    await open(page);
    await probe(page);
    await page.getByLabel('Use stepped mask session').check();
    await ready(page);
    if (style === 'faces')
      await page.evaluate(async () => {
        const face = new FontFace('MaskCacheExtraFace', 'local("Arial")');
        await face.load();
        document.fonts.add(face);
      });
    await ready(page, 'Step mask presentation');
    await tick(page, 1);
    expect(await pixels(page)).toEqual([blue, half, half, blue]);
    expect(await counts(page)).toEqual({ decodes: 1, closes: 0, loads: 2 });
    const loads = await page.evaluate(
      () => (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe.loads,
    );
    expect(
      loads.some((s) =>
        style === 'glyph'
          ? s.endsWith('|AC')
          : style === 'run'
            ? s.startsWith('bold ')
            : s.endsWith('|AB'),
      ),
    ).toBe(true);
    await ready(page, 'Restart mask session');
    expect(await counts(page)).toEqual({ decodes: 1, closes: 0, loads: 2 });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    expect((await counts(page)).closes).toBe(1);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const hold of ['image', 'font'] as const)
  for (const change of ['target', 'choice', 'mode', 'step', 'restart', 'clear', 'close', 'source'])
    test(`actual pending ${hold} ${change} preserves or retires the original cache and rejects stale display`, async ({
      page,
    }) => {
      const f = await setup(page);
      await open(page);
      await probe(page, hold);
      await page.getByLabel('Use stepped mask session').check();
      await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe.held),
        )
        .toBe(true);
      if (change === 'target') {
        await page.getByLabel('First mask target layer', { exact: true }).selectOption('');
        await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
      }
      if (change === 'choice') {
        await page.getByLabel('Mask source layer', { exact: true }).selectOption('');
        await page.getByLabel('Mask source layer', { exact: true }).selectOption('mask');
        await page.getByLabel('First mask target layer', { exact: true }).selectOption('target');
      }
      if (change === 'mode') {
        await page.getByLabel('Use stepped mask session').uncheck();
        await page.getByLabel('Use stepped mask session').check();
      }
      if (change === 'step' || change === 'restart')
        await page
          .getByRole('button', {
            name: change === 'step' ? 'Step mask presentation' : 'Restart mask session',
            exact: true,
          })
          .click();
      if (change === 'clear')
        await page.getByRole('button', { name: 'Clear mask preview', exact: true }).click();
      if (change === 'close') await page.getByRole('button', { name: 'Close dialog' }).click();
      if (change === 'source')
        await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
          e.value = '#00ff00';
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      await release(page);
      if (change === 'step' || change === 'restart')
        await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toBeVisible();
      else await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
      const discarded = change === 'close' || change === 'source' || change === 'clear';
      if (hold === 'image' && discarded)
        await expect.poll(async () => (await counts(page)).closes).toBe(1);
      if (change === 'source') {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await f.read()).background).toBe('#00ff00');
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
      }
      if (change === 'close' || change === 'source') {
        await open(page);
        await page.getByLabel('Use stepped mask session').check();
      }
      await ready(page);
      await tick(page, change === 'step' ? 1 : 0);
      expect(await pixels(page)).toEqual(
        change === 'step' ? [blue, half, half, blue] : [half, half, blue, blue],
      );
      expect(await counts(page)).toEqual({
        decodes: hold === 'image' && discarded ? 2 : 1,
        closes: hold === 'image' && discarded ? 1 : 0,
        loads: discarded ? 2 : 1,
      });
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await retired(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('shared decoded budget rejects a forged oversized view without allocation, then retries from cache', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await probe(page);
  await page.evaluate(() => {
    const create = document.createElement.bind(document);
    let once = true;
    document.createElement = ((...args: Parameters<typeof document.createElement>) => {
      const e = create(...args);
      if (args[0] === 'canvas' && once) {
        once = false;
        for (const key of ['width', 'height']) {
          const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)!;
          Object.defineProperty(e, key, {
            configurable: true,
            get: () => 4096,
            set: (v) => d.set!.call(e, v),
          });
        }
      }
      return e;
    }) as typeof document.createElement;
    Object.assign(window, {
      restoreMaskCacheCanvas: () => {
        document.createElement = create;
      },
    });
  });
  await page.getByRole('button', { name: 'Render mask preview', exact: true }).click();
  await expect(page.getByRole('dialog').locator('p[role="status"]')).toContainText('64-megapixel');
  await expect(page.locator('canvas[aria-label="Layer mask preview"]')).toHaveCount(0);
  expect(await counts(page)).toEqual({ decodes: 1, closes: 0, loads: 1 });
  expect(
    await page.evaluate(
      () => (window as unknown as { maskCacheProbe: Probe }).maskCacheProbe.canvases.length,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { restoreMaskCacheCanvas: () => void }).restoreMaskCacheCanvas(),
  );
  await ready(page);
  expect(await pixels(page)).toEqual([half, half, blue, blue]);
  expect(await counts(page)).toEqual({ decodes: 1, closes: 0, loads: 1 });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect((await counts(page)).closes).toBe(1);
  await retired(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
