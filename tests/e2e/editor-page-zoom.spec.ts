import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { newProject } from '../../packages/document/src';

test('at 200% browser zoom the canvas and timeline stay usable', async ({ playwright, baseURL }, testInfo) => {
  const extension = testInfo.outputPath('zoom-extension');
  await mkdir(extension, { recursive: true });
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Editor page zoom fixture',
    version: '1.0',
    background: { service_worker: 'worker.js' },
  }));
  await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  const context = await playwright.chromium.launchPersistentContext('', {
    baseURL,
    channel: 'chromium',
    viewport: { width: 1024, height: 768 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 5000 });
    const page = context.pages()[0];
    const project = newProject();
    project.duration = 8;
    project.layers[0].keys[0].shapes = [{
      id: 'zoom-rectangle',
      kind: 'rectangle',
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      rotation: 0,
      fill: '#ee2e32',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    }];
    await page.addInitScript(project => localStorage.setItem(
      'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
    ), project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const prefs = () => page.evaluate(() => localStorage.getItem('splash-panel-layout-v1'));
    const savedWorkspace = await prefs();
    const zoom = (factor: number) => worker.evaluate(async factor => {
      const { tabs } = (globalThis as unknown as { chrome: { tabs: {
        query: (query: { active: true; currentWindow: true }) => Promise<{ id: number }[]>;
        setZoom: (tab: number, factor: number) => Promise<void>;
        getZoom: (tab: number) => Promise<number>;
      } } }).chrome;
      const [tab] = await tabs.query({ active: true, currentWindow: true });
      await tabs.setZoom(tab.id, factor);
      return tabs.getZoom(tab.id);
    }, factor);
    expect(await zoom(2)).toBe(2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(512);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(512);

    const stage = page.getByLabel('Drawing stage', { exact: true });
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    await expect.soft(stage).toBeInViewport({ ratio: 0.95 });
    await expect.soft(timeline).toBeInViewport({ ratio: 0.95 });
    await stage.focus();
    await page.keyboard.press('F10');
    await expect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    const about = page.getByRole('button', { name: 'About', exact: true });
    await expect(about).toBeFocused();
    await expect(about).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(stage).toBeFocused();
    await timeline.focus();
    await page.keyboard.press('ArrowRight');
    await expect(timeline).toHaveAccessibleDescription(/Frame 2 of 8/);
    await expect.soft(timeline).toBeInViewport({ ratio: 0.95 });
    const properties = page.getByRole('complementary', { name: 'Properties' });
    const canvasBox = (await stage.boundingBox())!;
    const panelBox = (await properties.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 1);
    expect(panelBox.y).toBeLessThan(canvasBox.y + canvasBox.height);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(512);
    const settings = properties.getByRole('button', { name: 'Collapse Document settings panel' });
    await settings.focus();
    await expect(settings).toBeFocused();
    await expect(settings).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('separator', { name: 'Resize properties sidebar' })).toBeInViewport();

    const scene = page.locator('[data-scene-manager]');
    await scene.press('Enter');
    const scenes = page.getByRole('dialog', { name: 'Scenes', exact: true });
    const name = 'Opening_' + 'long_title_'.repeat(16);
    await scenes.getByRole('textbox', { name: 'Scene name' }).fill(name);
    await scenes.getByRole('textbox', { name: 'Scene name' }).press('Enter');
    await expect(scenes.getByRole('option')).toHaveText(name + ' (open)');
    await page.keyboard.press('Escape');
    await expect(scene).toBeFocused();
    await expect(scene).toHaveAccessibleName(name);
    await expect(scene).toBeInViewport({ ratio: 0.95 });
    const toolbar = page.locator('.stage-toolbar');
    expect((await scene.boundingBox())!.width).toBeLessThan((await toolbar.boundingBox())!.width / 2);
    await page.keyboard.press('Control+z');
    await expect(scene).toHaveText('Scene 1');

    expect(await zoom(1)).toBe(1);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1024);
    await expect(page.getByRole('separator', { name: 'Resize properties sidebar' })).toBeVisible();
    expect(await prefs()).toBe(savedWorkspace);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project)).toEqual(project);
  } finally {
    await context.close();
  }
});
