import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { newLayer, type SymbolDefinition } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { openExportSettings } from './export-settings';

function entries(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const nameEnd = offset + 30 + bytes.readUInt16LE(offset + 26);
    const start = nameEnd + bytes.readUInt16LE(offset + 28);
    const end = start + bytes.readUInt32LE(offset + 18);
    const name = bytes.toString('utf8', offset + 30, nameEnd);
    expect(files.has(name)).toBe(false);
    files.set(name, bytes.subarray(start, end));
    offset = end;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

test('exports a standalone Windows kit with script-free sparse and nested playback', async ({ page, context }) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  const project = livePresentationFixture('button');
  project.name = 'Stage / Snow & Co';
  project.frameScripts = [{ frame: 0, source: 'globalThis.privateProjectAppScript = true;' }];
  await page.addInitScript(({ project, license }) => {
    if (location.pathname !== '/') return;
    localStorage.setItem('splash-license-v1', license!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, license });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(launch.or(recover)).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await recover.click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export format', { exact: true }).selectOption('windows-app');
  await expect(settings.getByLabel('Export start frame', { exact: true })).toHaveCount(0);
  const pending = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export Windows app build kit…', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Stage-Snow-Co-windows-app.zip');
  const bytes = await readFile((await download.path())!);
  const files = entries(bytes);
  expect([...files.keys()].sort()).toEqual([
    'BUILD.txt', 'Cargo.lock', 'Cargo.toml', 'build.rs', 'icon.ico', 'icon.png',
    'index.html', 'main.rs', 'player.js', 'tauri.conf.json',
  ]);
  const config = JSON.parse(files.get('tauri.conf.json')!.toString());
  expect(config.productName).toBe('Stage Snow & Co');
  expect(config.identifier).toMatch(/^com\.splashanimator\.project-[0-9a-f]{32}$/);
  expect(config.app.windows[0].title).toBe(project.name);
  expect(config.app.withGlobalTauri).toBe(false);
  expect(config.app.security.capabilities).toEqual([]);
  expect(config.bundle.icon).toEqual(['icon.ico', 'icon.png']);
  expect(files.get('icon.ico')!.subarray(0, 4).toString('hex')).toBe('00000100');
  expect(files.get('icon.png')!.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(files.get('BUILD.txt')!.toString()).toContain('cargo build --release --locked');
  expect(files.get('index.html')!.toString()).toContain('<script src="./player.js"></script>');
  expect(files.get('player.js')!.toString()).not.toContain('privateProjectAppScript');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  if (process.env.SPLASH_PROJECT_APP_TEST_ZIP) await writeFile(process.env.SPLASH_PROJECT_APP_TEST_ZIP, bytes);

  const player = await context.newPage();
  const errors: string[] = [];
  player.on('pageerror', error => errors.push(error.message));
  try {
    await player.addInitScript(() => {
      const frames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => frames.push(callback);
      Reflect.set(window, 'projectAppFrames', frames);
    });
    await player.route('**/project-app/**', route => {
      const filename = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const body = files.get(filename);
      if (!body || !['index.html', 'player.js'].includes(filename)) return route.abort();
      return route.fulfill({
        body, contentType: filename === 'index.html' ? 'text/html' : 'text/javascript',
        headers: { 'content-security-policy': config.app.security.csp },
      });
    });
    await player.goto('/project-app/index.html');
    await player.waitForFunction(() => Reflect.get(window, 'projectAppFrames').length > 0);
    const actual = await player.evaluate(() => {
      const frames = Reflect.get(window, 'projectAppFrames') as FrameRequestCallback[];
      const ctx = document.querySelector('canvas')!.getContext('2d')!;
      const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return [0, 1, 2, 3].map(frame => {
        for (const callback of frames.splice(0)) callback(frame === 0 ? 0 : (frame + 0.01) * 1000 / 24);
        return [pixel(frame * 20 + 8, 10), pixel([4, 45, 65, 125][frame], 45)];
      });
    });
    for (const [frame, [root, nested]] of actual.entries()) {
      expect(root).toEqual([255, 0, 0, 255]);
      expect(nested).toEqual(frame === 0 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
    }
    expect(errors).toEqual([]);
  } finally {
    await player.close();
  }
});

test('exports an Android Studio kit with touch playback in portrait and landscape', async ({ page, browser }) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  const project = livePresentationFixture('button');
  project.name = 'Touch & "draw" <demo>';
  const button: SymbolDefinition = {
    id: 'touch-button', name: 'Touch button', width: 20, height: 20,
    shapes: [{ ...project.layers[0].keys[0].shapes[0], id: 'green', fill: '#008000' }],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  project.symbols!.push(button);
  project.layers.unshift({
    ...newLayer('Touch target'),
    keys: [{ frame: 0, shapes: [symbolInstance(button, 120, 5)] }],
  });
  await page.addInitScript(({ project, license }) => {
    localStorage.setItem('splash-license-v1', license!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, license });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(launch.or(recover)).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await recover.click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export format', { exact: true }).selectOption('android-app');
  await expect(settings.getByLabel('Export start frame', { exact: true })).toHaveCount(0);
  const pending = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export Android app build kit…', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Touch-draw-demo-android-app.zip');
  const bytes = await readFile((await download.path())!);
  const files = entries(bytes);
  expect([...files.keys()].sort()).toEqual([
    'BUILD.txt', 'build.gradle', 'project-app.properties', 'settings.gradle',
    'src/main/AndroidManifest.xml', 'src/main/assets/index.html', 'src/main/assets/player.js',
    'src/main/java/com/splashanimator/player/PlayerActivity.java',
    'src/main/res/drawable-nodpi/app_icon.png', 'src/main/res/values/strings.xml',
  ]);
  expect(files.get('project-app.properties')!.toString())
    .toMatch(/^applicationId=com\.splashanimator\.project\.p[0-9a-f]{32}\n$/);
  expect(files.get('src/main/res/values/strings.xml')!.toString())
    .toContain(String.raw`"Touch &amp; \"draw\" &lt;demo&gt;"`);
  expect(files.get('src/main/res/drawable-nodpi/app_icon.png')!.subarray(0, 8).toString('hex'))
    .toBe('89504e470d0a1a0a');
  expect(files.get('BUILD.txt')!.toString()).toContain('gradle assembleDebug');
  expect(files.get('settings.gradle')!.toString())
    .toMatch(/dependencyResolutionManagement\s*\{\s*repositories\s*\{\s*google\(\)/);
  expect(files.get('src/main/AndroidManifest.xml')!.toString()).not.toContain('<uses-permission');
  expect(files.get('src/main/assets/player.js')!.toString()).not.toContain('Live read-only preview must remain script-free');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  if (process.env.SPLASH_ANDROID_APP_TEST_ZIP) await writeFile(process.env.SPLASH_ANDROID_APP_TEST_ZIP, bytes);

  const mobile = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const player = await mobile.newPage();
    const errors: string[] = [];
    player.on('pageerror', error => errors.push(error.message));
    await player.addInitScript(() => {
      const frames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => frames.push(callback);
      Reflect.set(window, 'projectAppFrames', frames);
    });
    await player.route('https://appassets.androidplatform.net/**', route => {
      const filename = new URL(route.request().url()).pathname.slice(1);
      if (filename !== 'index.html' && filename !== 'player.js') return route.abort();
      return route.fulfill({
        body: files.get('src/main/assets/' + filename)!,
        contentType: filename === 'index.html' ? 'text/html' : 'text/javascript',
      });
    });
    await player.goto('https://appassets.androidplatform.net/index.html');
    await player.waitForFunction(() => Reflect.get(window, 'projectAppFrames').length > 0);
    const pixels = await player.evaluate(() => {
      const frames = Reflect.get(window, 'projectAppFrames') as FrameRequestCallback[];
      const ctx = document.querySelector('canvas')!.getContext('2d')!;
      for (const ms of [0, 42]) for (const draw of frames.splice(0)) draw(ms);
      return [[28, 10], [45, 45], [130, 15]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    });
    expect(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [0, 128, 0, 255]]);
    const canvas = player.locator('canvas');
    for (const [width, height] of [[390, 844], [844, 390]]) {
      await player.setViewportSize({ width, height });
      const box = (await canvas.boundingBox())!;
      expect(box.width).toBeCloseTo(Math.min(width, height * 2), 0);
      expect(box.height).toBeCloseTo(box.width / 2, 0);
      await player.touchscreen.tap(box.x + box.width * 130 / 160, box.y + box.height * 15 / 80);
    }
    await expect(canvas).toHaveAttribute('data-activations', '2');
    expect(errors).toEqual([]);
  } finally {
    await mobile.close();
  }
});

test('exports an iPhone and iPad Xcode kit with local touch playback', async ({ page, browser }, testInfo) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  const project = livePresentationFixture('button');
  project.name = 'Studio & <雪> $(OPTION)';
  project.frameScripts = [{ frame: 0, source: 'throw Error("privateIOSAuthoringScript");' }];
  const button: SymbolDefinition = {
    id: 'ios-touch-button', name: 'Touch button', width: 20, height: 20,
    shapes: [{ ...project.layers[0].keys[0].shapes[0], id: 'green', fill: '#008000' }],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  project.symbols!.push(button);
  project.layers.unshift({ ...newLayer('Touch target'), keys: [{ frame: 0, shapes: [symbolInstance(button, 120, 5)] }] });
  await page.addInitScript(({ project, license }) => {
    localStorage.setItem('splash-license-v1', license!);
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, { project, license });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(launch.or(recover)).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await recover.click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settings = await openExportSettings(page);
  await settings.getByLabel('Export format', { exact: true }).selectOption('ios-app');
  await expect(settings.getByLabel('Export start frame', { exact: true })).toHaveCount(0);
  const save = settings.getByRole('button', { name: 'Export iOS app build kit…', exact: true });
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
      if (this.width !== 1024 || this.height !== 1024) return encode.call(this, callback, ...options);
      HTMLCanvasElement.prototype.toBlob = encode;
      setTimeout(() => callback(null), 0);
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await save.click();
  await expect(page.getByText('Error: Could not encode the iOS app icon.', { exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'), save.click(),
  ]);
  expect(download.suggestedFilename()).toBe('Studio-OPTION-ios-app.zip');
  const bytes = await readFile((await download.path())!);
  const files = entries(bytes);
  const icon = 'Assets.xcassets/AppIcon.appiconset/';
  expect([...files.keys()].sort()).toEqual([
    icon + 'AppIcon.png', icon + 'Contents.json', 'Assets.xcassets/Contents.json',
    'BUILD.txt', 'Info.plist', 'SplashPlayer.swift', 'SplashPlayer.xcodeproj/project.pbxproj', 'index.html',
  ]);
  const pbx = files.get('SplashPlayer.xcodeproj/project.pbxproj')!.toString();
  const defined = [...pbx.matchAll(/^\s*([A-F0-9]{24}) = \{/gm)].map(match => match[1]);
  expect([...new Set(pbx.match(/[A-F0-9]{24}(?![a-f0-9])/g))].sort()).toEqual(defined.sort());
  expect(pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.splashanimator\.project\.p[0-9a-f]{32};/g)).toHaveLength(2);
  expect(pbx).toContain('TARGETED_DEVICE_FAMILY = "1,2";');
  expect(files.get('Info.plist')!.toString()).toContain('Studio &amp; &lt;雪&gt; ＄(OPTION)');
  expect(files.get('SplashPlayer.swift')!.toString()).toContain('loadFileURL(animation, allowingReadAccessTo: animation)');
  expect(files.get('BUILD.txt')!.toString()).toContain('CODE_SIGNING_ALLOWED=NO');
  const png = files.get(icon + 'AppIcon.png')!;
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([1024, 1024, 2]);
  const html = files.get('index.html')!;
  expect(html.toString()).toContain("connect-src 'none'");
  expect(html.toString()).not.toMatch(/<script src=|privateIOSAuthoringScript/);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  await writeFile(testInfo.outputPath('ios-app.zip'), bytes);
  const output = testInfo.outputPath('index.html');
  await writeFile(output, html);
  const mobile = await browser.newContext({ offline: true, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const player = await mobile.newPage();
    const errors: string[] = [], requests: string[] = [];
    player.on('pageerror', error => errors.push(error.message));
    player.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await player.addInitScript(() => {
      const frames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => frames.push(callback);
      Reflect.set(window, 'projectAppFrames', frames);
    });
    await player.goto(pathToFileURL(output).href);
    await player.waitForFunction(() => Reflect.get(window, 'projectAppFrames').length > 0);
    const canvas = player.locator('canvas');
    const pixels = await canvas.evaluate((node: HTMLCanvasElement) => {
      const frames = Reflect.get(window, 'projectAppFrames') as FrameRequestCallback[];
      for (const ms of [0, 42]) for (const draw of frames.splice(0)) draw(ms);
      const ctx = node.getContext('2d')!;
      return [[28, 10], [45, 45], [130, 15]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    });
    expect(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [0, 128, 0, 255]]);
    for (const [width, height] of [[390, 844], [844, 390]]) {
      await player.setViewportSize({ width, height });
      const box = (await canvas.boundingBox())!;
      expect(box.width).toBeCloseTo(Math.min(width, height * 2), 0);
      expect(box.height).toBeCloseTo(box.width / 2, 0);
      await player.touchscreen.tap(box.x + box.width * 130 / 160, box.y + box.height * 15 / 80);
    }
    await expect(canvas).toHaveAttribute('data-activations', '2');
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  } finally { await mobile.close(); }
});
