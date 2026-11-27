import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { newLayer, newProject, type Vector } from '../../packages/document/src';
test.describe('high-resolution onion skins', () => {
  test.use({ deviceScaleFactor: 2 });
  test('composites nested paint once and preserves its outline across track and key scopes', async ({
    page,
  }) => {
    await checkNestedOnions(page, '/');
  });
});

// Run against a separately launched test executable with its own WebView2 data directory.
test('native WebView2 onion rendering', async ({ playwright }) => {
  const endpoint = process.env.SPLASH_ONION_TEST_CDP;
  test.skip(!endpoint, 'Requires a dedicated native test instance.');
  const browser = await playwright.chromium.connectOverCDP(endpoint!);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    const connection = await browser.newBrowserCDPSession();
    const { targetInfos } = await connection.send('Target.getTargets');
    const editor = targetInfos.find(
      (target) => target.type === 'page' && /^https?:\/\/tauri\.localhost\//.test(target.url),
    );
    if (!editor) throw Error('Missing packaged editor window');
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await session.send('Performance.enable');
    await checkNestedOnions(page, editor.url);
    const { metrics } = await session.send('Performance.getMetrics');
    console.log(
      'WebView2',
      browser.version(),
      'JS heap bytes',
      metrics.find((m) => m.name === 'JSHeapUsedSize')?.value,
    );
  } finally {
    await browser.close();
  }
});

async function checkNestedOnions(page: Page, url: string) {
  const project = newProject();
  project.duration = 25;
  const rect = (id: string, x: number, fill: string): Vector => ({
    id,
    x,
    y: 0,
    width: 80,
    height: 80,
    kind: 'rectangle',
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  const back = rect('blue', 0, '#0000ff'),
    front = rect('red', 40, '#ff0000');
  const nested: Vector = { ...back, id: 'child', kind: 'symbol', symbolId: 'art', width: 120 };
  project.symbols = [
    {
      id: 'art',
      name: 'Artwork',
      width: 120,
      height: 80,
      shapes: [
        back,
        front,
        { ...rect('wash', 0, '#00ffff'), y: 60, width: 16, height: 16, opacity: 0.5 },
      ],
    },
    { id: 'group', name: 'Group', width: 120, height: 80, shapes: [nested] },
  ];
  const placement = { ...nested, id: 'instance', x: 280, y: 190, symbolId: 'group' };
  project.layers[0].keys = [
    { frame: 0, shapes: [placement] },
    { frame: 12, shapes: [] },
    { frame: 13, shapes: [placement] },
  ];
  const other = newLayer('Other');
  other.keys = [
    { frame: 0, shapes: [{ ...rect('green', 500, '#00ff00'), y: 190 }] },
    { frame: 12, shapes: [] },
  ];
  project.layers.unshift(other);
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto(url);
  const open = page.getByRole('button', { name: 'Open editor', exact: true });
  if (url !== '/' || (await open.isVisible())) await open.click();
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const grid = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(grid.x + 12 * 18 + 9, grid.y + 40);
  await page.getByText('Onion skin settings', { exact: true }).click();
  await page.getByLabel('Onion opacity', { exact: true }).fill('50');
  await page.getByLabel('Enable onion skin', { exact: true }).check();
  const pixels = () =>
    page.getByLabel('Drawing stage', { exact: true }).evaluate((el) => {
      const c = el as HTMLCanvasElement,
        d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let red = 0,
        blue = 0,
        green = 0,
        wash = 0,
        deepRed = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (r === 255 && g === b && g >= 126 && g <= 129) red++;
        if (b === 255 && r === g && r >= 126 && r <= 129) blue++;
        if (g === 255 && b === r && r >= 126 && r <= 129) green++;
        if (r >= 126 && r <= 129 && g >= 190 && g <= 193 && b === 255) wash++;
        if (r === 255 && g === b && g < 90) deepRed++;
      }
      return { red, blue, green, wash, deepRed, width: c.width, height: c.height };
    });
  await expect.poll(async () => (await pixels()).green).toBeGreaterThan(500);
  const flat = await pixels();
  expect(flat.width).toBeGreaterThan(1920);
  expect(flat.blue).toBeGreaterThan(500);
  expect(flat.red / (flat.blue + flat.wash)).toBeCloseTo(2, 1);
  expect(flat.wash).toBeGreaterThan(100);
  await page.getByLabel('Onion active layer only').check();
  await page.getByLabel('Onion key exposures only').check();
  await expect.poll(async () => (await pixels()).green).toBe(0);
  expect((await pixels()).red).toBe(flat.red);
  await page.getByLabel('Onion outlines').check();
  await expect.poll(async () => (await pixels()).red).toBeLessThan(flat.red / 5);
  expect((await pixels()).red).toBeGreaterThan(50);
  await page.getByLabel('Onion key exposures only').uncheck();
  await page.getByLabel('Onion frames before', { exact: true }).fill('12');
  const latency = await page
    .getByLabel('Onion frames after', { exact: true })
    .evaluate(async (el) => {
      const input = el as HTMLInputElement;
      const start = performance.now();
      input.value = '12';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      return Math.round(performance.now() - start);
    });
  console.log(
    '24 outline ghosts:',
    flat.width,
    'x',
    flat.height,
    latency,
    'ms to second animation frame',
  );
  expect((await pixels()).deepRed).toBeGreaterThan(50);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(project);
}
test('onion controls render before and after ghosts without changing artwork or export', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 3;
  const shape = (x: number, fill: string): Vector => ({
    id: fill,
    kind: 'rectangle',
    x,
    y: 80,
    width: 80,
    height: 80,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  p.layers[0].keys = [
    { frame: 0, shapes: [shape(80, '#ff0000')] },
    { frame: 1, shapes: [shape(200, '#00ff00')] },
    { frame: 2, shapes: [shape(320, '#0000ff')] },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  const signed = process.env.SPLASH_TEST_LICENSE;
  if (signed) await page.addInitScript(token => localStorage.setItem('splash-license-v1', token), signed);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const timeline = page.getByLabel('Timeline frames');
  const b = (await timeline.boundingBox())!;
  await page.mouse.click(b.x + 27, b.y + 40);
  await page.getByText('Onion skin settings', { exact: true }).click();
  await page.getByLabel('Onion frames after', { exact: true }).fill('1');
  await page.getByLabel('Onion opacity', { exact: true }).fill('50');
  await page.getByLabel('Enable onion skin', { exact: true }).check();
  const colors = () =>
    page.getByLabel('Drawing stage').evaluate((el) => {
      const c = el as HTMLCanvasElement,
        d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let red = 0,
        blue = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 255 && d[i + 1] >= 126 && d[i + 1] <= 129 && d[i + 2] === d[i + 1]) red++;
        if (d[i + 2] === 255 && d[i] >= 126 && d[i] <= 129 && d[i + 1] === d[i]) blue++;
      }
      return { red, blue };
    });
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(500);
  expect((await colors()).blue).toBeGreaterThan(500);
  await page.getByLabel('Onion frames before', { exact: true }).fill('0');
  await expect.poll(async () => (await colors()).red).toBe(0);
  expect((await colors()).blue).toBeGreaterThan(500);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
  const publish = page.getByRole('button', { name: /Export HTML/ });
  if (!signed && await publish.isDisabled()) {
    await test.step.skip('Export pixel comparison requires a signed license fixture', async () => {});
    return;
  }
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page, publish);
  const out = await page.context().newPage();
  await openWebExport(out, await readWebDownload(await download));
  const ghost = await out.locator('canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement,
      d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 2] === 255 && d[i] >= 126 && d[i] <= 129 && d[i + 1] === d[i]) n++;
    return n;
  });
  expect(ghost).toBe(0);
  await out.close();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('timeline keyboard and direct navigation clamp frames, extend ranges and reveal offscreen frames', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 150;
  p.layers[0].keys.push({ frame: 100, shapes: [] });
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const t = page.getByLabel('Timeline frames');
  await t.focus();
  await t.press('ArrowRight');
  await expect(page.locator('.frame-readout')).toContainText('Frame 2');
  await t.press('Shift+ArrowRight');
  await expect(page.getByText('Frames 2–3 · 2 selected', { exact: true })).toBeVisible();
  await t.press('Control+ArrowRight');
  await expect(page.locator('.frame-readout')).toContainText('Frame 101');
  expect(await page.getByLabel('Timeline scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(
    0,
  );
  await t.press('End');
  await expect(page.locator('.frame-readout')).toContainText('Frame 150');
  await t.press('ArrowRight');
  await expect(page.locator('.frame-readout')).toContainText('Frame 150');
  await page.getByLabel('Go to frame', { exact: true }).fill('5');
  await page.getByLabel('Go to frame', { exact: true }).press('Tab');
  await expect(page.locator('.frame-readout')).toContainText('Frame 5');
  await t.focus();
  await t.press('Home');
  await expect(page.locator('.frame-readout')).toContainText('Frame 1');
});
