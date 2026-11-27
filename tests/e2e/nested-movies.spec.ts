import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect } from '@playwright/test';
import { newLayer, newProject, type Project, type SymbolDefinition } from '../../packages/document/src';
import { exportHTML } from '../../packages/export-web/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';

for (const container of ['held graphic', 'mapped button Up', 'offset movie button', 'nested Up button']) {
test(container + ' movies retain independent ages through a blank and reentry on stage, in Test Movie and HTML', async ({ page }) => {
  const p = newProject();
  Object.assign(p, { width: 400, height: 200, duration: 7, fps: 4 });
  const art = { id: 'art', kind: 'rectangle' as const, x: 0, y: 0, width: 40, height: 40,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  const movie = { id: 'color', name: 'Color', width: 40, height: 40, shapes: [art],
    timeline: { duration: 3, keys: ['#00ff00', '#0000ff'].map((fill, i) => ({ frame: i + 1, shapes: [{ ...art, fill }] })) } };
  const child = symbolInstance(movie, 0, 0);
  child.symbolPlayback = { mode: 'movie', firstFrame: 1 };
  const localMovie = container === 'offset movie button' || container === 'nested Up button';
  const button = localMovie || container === 'mapped button Up';
  const graphic: SymbolDefinition = { id: 'held', name: 'Held', width: 40, height: 40, shapes: [child] };
  if (button) {
    graphic.shapes = [{ ...art, fill: '#ffaa00' }];
    graphic.timeline = { duration: 2, keys: [{ frame: 1, shapes: [child] }] };
    graphic.buttonStates = { up: 1, over: 0, down: 0, hit: 0 };
  }
  p.symbols = [graphic, movie];
  const left = symbolInstance(graphic, 100, 80), right = symbolInstance(graphic, 260, 80);
  left.symbolPlayback = right.symbolPlayback = { mode: 'single', firstFrame: 0 };
  const layer = p.layers[0];
  layer.keys = [{ frame: 0, shapes: [left, right] }, { frame: 2, shapes: [left] }, { frame: 4, shapes: [left, right] }];
  if (button) {
    layer.keys = [{ frame: 0, shapes: [left] }];
    const sibling = newLayer('Changing exposure');
    sibling.keys = [{ frame: 0, shapes: [right] }, { frame: 2, shapes: [] },
      { frame: 4, shapes: [right] }, { frame: 5, shapes: [right] }];
    if (localMovie) {
      let buttonInstance = symbolInstance(graphic, 0, 0);
      if (container === 'nested Up button') {
        const outer: SymbolDefinition = { ...graphic, id: 'outer', name: 'Outer',
          timeline: { duration: 2, keys: [{ frame: 1, shapes: [buttonInstance] }] } };
        p.symbols.push(outer);
        buttonInstance = symbolInstance(outer, 0, 0);
      }
      const wrapper: SymbolDefinition = { id: 'wrapper', name: 'Wrapper', width: 40, height: 40, shapes: [buttonInstance],
        timeline: { duration: 7, keys: [{ frame: 2, shapes: [] }, { frame: 4, shapes: [buttonInstance] }, { frame: 5, shapes: [buttonInstance] }] } };
      p.symbols.push(wrapper);
      const clip = symbolInstance(wrapper, 260, 80);
      clip.symbolPlayback = { mode: 'movie', firstFrame: 1 };
      sibling.keys = [{ frame: 0, shapes: [clip] }];
    }
    p.layers.push(sibling);
  }
  const mask = newLayer('Mask');
  mask.keys[0].shapes = [{ ...art, width: 400, height: 200 }];
  p.layers.push(mask);
  p.layerMasks = [{ maskLayerId: mask.id, layerIds: p.layers.slice(0, -1).map(l => l.id) }];
  type TimeWindow = typeof window & { movieMillis: number };
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    const clock = window as TimeWindow;
    clock.movieMillis = 10000;
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => raf(() => fn(clock.movieMillis));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const saved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const colors = ['255,0,0', '0,255,0', '0,0,255'];
  for (const mode of ['stage', 'preview', 'html', 'sequence']) {
    const exported = mode === 'html' || mode === 'sequence';
    const output = exported ? await page.context().newPage() : page;
    const origin = mode === 'stage' ? 10000 : mode === 'preview' ? 20000 : 0;
    if (mode === 'stage') await stage.press('Enter');
    if (mode === 'preview') {
      await page.evaluate(t => { (window as TimeWindow).movieMillis = t; }, origin);
      await stage.press('Control+Enter');
      await expect(page.getByText('Canvas2D fallback', { exact: true })).toBeVisible();
    }
    if (exported) {
      await output.goto('about:blank');
      await output.addInitScript(() => {
        const raf = requestAnimationFrame.bind(window);
        (window as TimeWindow).movieMillis = 0;
        window.requestAnimationFrame = fn => raf(() => fn((window as TimeWindow).movieMillis));
      });
      await output.setContent(exportHTML(p, mode === 'sequence' ? 'sequence' : undefined));
      if (mode === 'sequence') await expect(output.locator('canvas').first()).toHaveAttribute('data-capture', 'waiting');
    }
    const canvas = mode === 'stage' ? stage : mode === 'preview'
      ? page.getByRole('dialog', { name: 'Test movie' }).locator('canvas') : output.locator('canvas').first();
    for (const t of mode === 'sequence' ? [0, 1, 2, 3, 4, 5, 6] : localMovie ? [0, 1, 2, 5, 7, 14] : button ? [0, 1, 2, 4, 6, 8, 14] : [0, 1, 2, 4, 5, 6, 7]) {
      if (mode === 'sequence') {
        await canvas.dispatchEvent('capture-next');
        await expect(canvas).toHaveAttribute('data-frame', String(t));
      }
      // A late paint within the replacement frame must not shift the authored movie by a frame.
      const lateness = mode === 'stage' && t === 5 ? 70 : 0;
      await output.evaluate(ms => { (window as TimeWindow).movieMillis = ms; }, origin + t * 250 + lateness);
      const at = (t + (localMovie ? 1 : 0)) % p.duration;
      const rightAge = button
        ? (at < 2 ? Math.min(t, at) : at < 4 ? null : at === 4 ? 0 : at - 5)
        : (t < 2 ? t : t < 4 ? null : t - 4);
      await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement, centered) => {
        const scale = centered ? node.width / node.getBoundingClientRect().width : 1;
        const ctx = node.getContext('2d')!;
        return [-80, 80].map(dx => Array.from(ctx.getImageData(node.width / 2 + dx * scale, node.height / 2, 1, 1).data).slice(0, 3).join(','));
      }, mode === 'stage'), { message: mode + ' at tick ' + t }).toEqual([
        colors[(1 + t) % 3], rightAge === null ? '255,255,255' : colors[(1 + rightAge) % 3],
      ]);
    }
    if (mode === 'stage') await stage.press('Enter');
    if (mode === 'preview') await page.keyboard.press('Escape');
    if (exported) await output.close();
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(saved);
});
}

test('nested movies author with undo, run below movie and held graphic parents, and export independently', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 2;
  p.fps = 10;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: { duration: 3, keys: [{ frame: 2, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  const parent = {
    id: 'parent',
    name: 'Parent',
    width: 80,
    height: 60,
    shapes: [child],
    timeline: { duration: 2, keys: [] },
  };
  p.symbols = [parent, leaf];
  const a = symbolInstance(parent, 100, 100),
    b = symbolInstance(parent, 250, 100);
  a.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  a.transform = [1, 0.2, 0.3, 1];
  b.symbolPlayback = { mode: 'single', firstFrame: 0 };
  p.layers[0].keys[0].shapes = [a, b];
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
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Parent', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByLabel('Nested symbol playback').selectOption('movie');
  await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(editor.getByLabel('Nested symbol playback')).toHaveValue('loop');
  await editor.getByLabel('Nested symbol playback').selectOption('movie');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const saved = await read();
  expect(saved.schemaVersion).toBe(59);
  expect(saved.symbols![0].shapes[0].symbolPlayback?.mode).toBe('movie');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect((await read()).symbols![0].shapes[0].symbolPlayback).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  const pixels = async () => {
    const png = (await preview.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [
        [185, 145],
        [275, 120],
      ].map(([x, y]) =>
        Array.from(ctx.getImageData((x * image.width) / 960, (y * image.height) / 540, 1, 1).data),
      );
    }, png);
  };
  await expect.poll(pixels, { intervals: [20] }).toEqual([
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);
  await expect.poll(pixels, { intervals: [20] }).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  await page.keyboard.press('Escape');
  expect(await read()).toEqual(saved);
  const downloadPromise = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await downloadPromise);
  const output = await page.context().newPage();
  await output.addInitScript(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await openWebExport(output, files, true);
  await output.waitForFunction(() => typeof Reflect.get(window, 'next') === 'function');
  await expect
    .poll(() =>
      output.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  for (const [time, color] of [
    [0, [255, 0, 0, 255]],
    [200, [0, 0, 255, 255]],
    [300, [255, 0, 0, 255]],
    [800, [0, 0, 255, 255]],
  ] as const) {
    await output.evaluate(
      (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
      time,
    );
    expect(
      await output.locator('canvas').evaluate((c) =>
        [
          [185, 145],
          [275, 120],
        ].map(([x, y]) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data),
        ),
      ),
    ).toEqual([color, color]);
  }
  await output.close();
});

test('definition preview runs movie clocks in a one-frame range and freezes play-once without edits', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 10;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: { duration: 4, keys: [{ frame: 2, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.symbolPlayback = { mode: 'movie' as const, firstFrame: 0 };
  const parent = {
    id: 'parent',
    name: 'Parent',
    width: 80,
    height: 60,
    shapes: [child],
    timeline: { duration: 6, keys: [] },
  };
  p.symbols = [parent, leaf];
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
  await page
    .getByRole('group', { name: 'Symbol Parent', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const pixels = () =>
    t
      .getByLabel('Symbol timeline preview')
      .evaluate((canvas) =>
        Array.from(
          (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data,
        ),
      );
  await t.getByLabel('Symbol range start', { exact: true }).fill('3');
  await t.getByLabel('Symbol range end', { exact: true }).fill('3');
  await t.getByLabel('Preview selected symbol range', { exact: true }).check();
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect.poll(pixels, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  await expect(t.getByLabel('Symbol frame', { exact: true })).toHaveValue('3');
  await expect.poll(pixels, { intervals: [20] }).toEqual([255, 0, 0, 255]);
  await t.getByRole('button', { name: 'Stop symbol preview', exact: true }).click();
  const stopped = await pixels();
  await page.waitForTimeout(450);
  expect(await pixels()).toEqual(stopped);
  await t.getByLabel('Symbol range end', { exact: true }).fill('6');
  await t.getByLabel('Loop symbol preview', { exact: true }).uncheck();
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect(t.getByRole('button', { name: 'Play symbol preview', exact: true })).toBeVisible();
  await expect(t.getByLabel('Symbol frame', { exact: true })).toHaveValue('6');
  expect(await pixels()).toEqual([0, 0, 255, 255]);
  await page.waitForTimeout(450);
  expect(await pixels()).toEqual([0, 0, 255, 255]);
  await t.getByLabel('Symbol frame', { exact: true }).fill('4');
  await t.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await expect.poll(pixels).toEqual([255, 0, 0, 255]);
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});
