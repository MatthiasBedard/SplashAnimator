import { extractWebDownload } from './web-export-files';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { newLayer, type Project } from '../../packages/document/src';
import { encodeEmbeddedFont } from '../../packages/document/src/embedded-font';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { openExportSettings } from './export-settings';

async function downloadHtml(page: Page, testInfo: TestInfo, project: Project) {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  await page.addInitScript(({ project, license }) => {
    if (window !== window.top) return;
    localStorage.setItem('splash-license-v1', license!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, license });
  await page.goto('/');
  const openEditor = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await openEditor.or(recover).first().waitFor({ state: 'visible' });
  if (await openEditor.isVisible()) await openEditor.click();
  await recover.click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  const pending = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export HTML animation…', exact: true }).click();
  const output = await extractWebDownload(await pending, testInfo.outputPath('standalone-folder'));
  return { output, recovery };
}

test('downloaded sparse HTML plays nested Button Up artwork with scripts inert', async ({ page }, testInfo) => {
  const { output, recovery } = await downloadHtml(page, testInfo, livePresentationFixture('button'));
  const html = await readFile(output, 'utf8');
  expect(html).not.toContain('Live read-only preview must remain script-free');
  const standalone = await page.context().newPage();
  const errors: string[] = [];
  standalone.on('pageerror', error => errors.push(error.message));
  try {
    await standalone.addInitScript(() => {
      const queue: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => queue.push(callback);
      Reflect.set(window, 'standaloneQueue', queue);
    });
    await standalone.goto(pathToFileURL(output).href);
    await expect.poll(() => standalone.evaluate(() => Reflect.get(window, 'standaloneQueue').length))
      .toBeGreaterThan(0);
    const rows = await standalone.evaluate(() => {
      const queue = Reflect.get(window, 'standaloneQueue') as FrameRequestCallback[];
      const canvas = document.querySelector('canvas')!;
      const context = canvas.getContext('2d')!;
      const pixels = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return [0, 1, 2, 3].map(frame => {
        for (const callback of queue.splice(0)) callback(frame === 0 ? 0 : (frame + 0.01) * 1000 / 24);
        return [pixels(frame * 20 + 8, 10), pixels([4, 45, 65, 125][frame], 45)];
      });
    });
    for (const [frame, [root, nested]] of rows.entries()) {
      expect(root).toEqual([255, 0, 0, 255]);
      expect(nested).toEqual(frame === 0 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
    }
    expect(errors).toEqual([]);
  } finally {
    await standalone.close();
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('standalone HTML identifies a rejected embedded font and starts only after assets load', async ({ page }, testInfo) => {
  const project = livePresentationFixture('button');
  const family = 'Splash Font Playback Fixture';
  const bytes = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  project.assets.push({ id: 'playback-font', path: 'assets/fonts/playback.json',
    font: { name: 'codicon.ttf', family, bytes: bytes.length, dataUrl: encodeEmbeddedFont(bytes) } });
  const labelLayer = newLayer('Asset label');
  project.layers.push(labelLayer);
  labelLayer.keys[0].shapes.push({
    id: 'asset-label', kind: 'text', x: 80, y: 4, width: 36, height: 22, rotation: 0,
    fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
    text: { content: '\ueabc', font: family, size: 16, align: 'left', bold: false, italic: false },
  });
  const { output, recovery } = await downloadHtml(page, testInfo, project);
  const failed = await page.context().newPage();
  try {
    await failed.addInitScript(family => {
      const load = FontFace.prototype.load;
      FontFace.prototype.load = function () {
        if (this.family.includes(family)) {
          Reflect.set(window, 'fixtureFontLoadAttempted', true);
          return Promise.reject(new DOMException('Fixture load failed'));
        }
        return load.call(this);
      };
      window.requestAnimationFrame = () => { throw Error('Playback must wait for assets'); };
    }, family);
    await failed.goto(pathToFileURL(output).href);
    await expect.poll(() => failed.evaluate(() => Reflect.get(window, 'fixtureFontLoadAttempted'))).toBe(true);
    await expect.poll(() => failed.getByRole('alert').textContent()).toBe('The embedded font “' + family + '” could not be loaded.');
    await expect.poll(() => failed.locator('canvas').count()).toBe(0);
  } finally { await failed.close(); }

  const reopened = await page.context().newPage();
  try {
    await reopened.goto(pathToFileURL(output).href);
    await expect.poll(() => reopened.evaluate(family =>
      Array.from(document.fonts).some(font => font.family.includes(family) && font.status === 'loaded'), family,
    )).toBe(true);
    await expect.poll(() => reopened.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')!;
      return [8, 28, 48, 68].some(x => {
        const [r, g, b, a] = ctx.getImageData(x, 10, 1, 1).data;
        return r === 255 && g === 0 && b === 0 && a === 255;
      });
    })).toBe(true);
    await expect.poll(() => reopened.getByRole('alert').count()).toBe(0);
  } finally { await reopened.close(); }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});
