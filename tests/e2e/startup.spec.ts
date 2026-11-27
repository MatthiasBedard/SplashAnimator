import { expect, test } from './editor-test';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../apps/editor/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

test.use({ keepStartupScreen: true });

const editorBundle = (url: URL) =>
  url.pathname === '/src/start-editor.ts' || /^\/assets\/start-editor-[\w-]+\.js$/.test(url.pathname);

test('editor help describes current authoring and the explicit script preview', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Open editor', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Build status & shortcuts', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Editor help', exact: true });
  await expect(help.getByRole('heading', { name: 'Default shortcuts' })).toBeVisible();
  await expect(help).toContainText('animate symbols with keyframes and tweens');
  await expect(help).toContainText('Timeline playback, Test Movie and ordinary exports run without frame scripts.');
  await help.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeVisible();
  await expect(page.getByText('M2', { exact: true })).toHaveCount(0);
});

test('Help opens the bundled scripting documentation in a separate window', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Open editor', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const [docs] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Documentation', exact: true }).click(),
  ]);
  await expect(docs.getByRole('heading', { name: 'Splash Animator Documentation' })).toBeVisible();
  await expect(docs.locator('html')).toHaveCSS('color-scheme', 'dark');
  expect(await docs.evaluate(() => window.opener)).toBeNull();
  await docs.getByRole('link', { name: 'Scripting guide and API reference' }).click();
  await docs.getByRole('link', { name: 'Stage and instances' }).click();
  await expect(docs).toHaveURL(/\/docs\/scripting\.html#stage$/);
  await expect(docs.getByText('getTransform(name, layerId?)', { exact: true })).toBeVisible();
  await docs.getByRole('link', { name: 'All documentation' }).click();
  await expect(docs.getByRole('heading', { name: 'Splash Animator Documentation' })).toBeVisible();
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeVisible();
});

test('Editor Help contains keyboard focus and returns it to the Help menu', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Open editor', exact: true }).click();
  const launcher = page.getByRole('button', { name: 'Help', exact: true });
  const open = page.getByRole('button', { name: 'Build status & shortcuts', exact: true });
  const help = page.getByRole('dialog', { name: 'Editor help', exact: true });
  const close = help.getByRole('button', { name: 'Close dialog', exact: true });
  async function openWithKeyboard() {
    await launcher.press('ArrowUp');
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
  }
  await openWithKeyboard();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await openWithKeyboard();
  await page.keyboard.press('Enter');
  await expect(help).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test('startup stays over the loaded editor until the user opens it', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(editorBundle, async route => {
    await ready;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  const startup = page.locator('#startup-screen');
  const close = startup.getByRole('button', { name: 'Close splash screen' });
  try {
    await expect(startup.getByRole('status')).toHaveText('Starting Splash Animator…');
    await expect(close).toBeHidden();
    await expect(startup.getByRole('progressbar')).toBeVisible();
    await expect(startup.locator('#percent')).toBeVisible();
    await expect(startup).toHaveCSS('background-color', 'rgb(23, 36, 58)');
    await expect(startup).toHaveCSS('backdrop-filter', 'none');
    await expect(startup.getByText(`v${version}`, { exact: true })).toBeVisible();
    await expect(startup.getByText('Checking license…', { exact: true })).toBeVisible();
    await expect(startup.getByText('IMAGINE · CREATE · SHARE', { exact: true })).toBeVisible();
    await expect(startup.getByText('Build 1000 · 64-bit', { exact: true })).toBeVisible();
    await expect(startup.locator('.splash')).toHaveCSS('width', '1050px');
    await expect.poll(() => startup.locator('img.logo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1536);
    expect(await startup.locator('.beach').evaluate(async element => {
      const background = getComputedStyle(element).backgroundImage;
      const photo = new Image();
      photo.src = background.slice(5, -2);
      await photo.decode();
      return photo.naturalWidth;
    })).toBe(718);
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: 'File', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(startup).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('startup.png') });
  } finally {
    release();
  }
  const open = startup.getByRole('button', { name: 'Open editor', exact: true });
  await expect(open).toBeFocused();
  await expect(startup).toHaveCSS('background-color', 'rgba(17, 21, 28, 0.75)');
  await expect(startup).toHaveCSS('backdrop-filter', 'blur(4px)');
  await expect(page.locator('#drawing-stage')).toBeAttached();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');
  await expect(startup.getByRole('status')).toHaveCount(0);
  await expect(startup.getByRole('progressbar')).toHaveCount(0);
  await expect(startup.locator('#percent')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File', exact: true })).toHaveCount(0);
  const file = page.getByRole('button', { name: 'File', exact: true, includeHidden: true });
  const bounds = (await file.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(open).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project', exact: true, includeHidden: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('startup-ready.png') });
  await close.click();
  await expect(startup).toHaveCount(0);
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
});

test('startup retry returns to the splash until the user dismisses it', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(editorBundle, route => route.abort('failed'));
  await page.goto('/');
  const startup = page.locator('#startup-screen');
  await expect(startup.getByRole('alert')).toHaveText('Splash Animator could not start.');
  const close = startup.getByRole('button', { name: 'Close splash screen' });
  await expect(close).toBeHidden();
  await expect(startup).toHaveCSS('background-color', 'rgb(23, 36, 58)');
  await expect(startup).toHaveCSS('backdrop-filter', 'none');
  await expect(startup.getByRole('status')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await page.unroute(editorBundle);
  await startup.getByRole('button', { name: 'Reload editor' }).click();
  await expect(startup.getByRole('button', { name: 'Open editor', exact: true })).toBeFocused();
  const closeBounds = (await close.boundingBox())!;
  const badgeBounds = (await startup.locator('#licenseBadge').boundingBox())!;
  expect(closeBounds.x).toBeGreaterThanOrEqual(badgeBounds.x + badgeBounds.width);
  await page.keyboard.press('Escape');
  await expect(startup).toHaveCount(0);
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeVisible();
});

test('Help can reopen and dismiss the splash without reloading the editor', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
  const open = splash.getByRole('button', { name: 'Open editor', exact: true });
  await open.click();
  await expect(page.getByRole('group', { name: 'Window controls' })).toHaveCount(0);
  await expect(page.locator('[data-tauri-drag-region]')).toHaveCount(0);

  const stage = page.getByLabel('Drawing stage', { exact: true });
  const canvas = await stage.elementHandle();
  const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
  await zoom.selectOption('1');
  const help = page.getByRole('button', { name: 'Help', exact: true });

  for (const dismiss of [() => page.keyboard.press('Escape'), () => open.click(),
    () => splash.getByRole('button', { name: 'Close splash screen' }).click()]) {
    await help.click();
    await page.getByRole('button', { name: 'Show Splash Screen', exact: true }).click();
    await expect(open).toBeFocused();
    await expect(splash.getByRole('status')).toHaveCount(0);
    await expect(splash.getByRole('progressbar')).toHaveCount(0);
    await expect(splash.locator('#percent')).toHaveCount(0);
    await expect(splash).toHaveCSS('backdrop-filter', 'blur(4px)');
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await dismiss();
    await expect(splash).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(zoom).toHaveValue('1');
    expect(await page.evaluate(original => original === document.querySelector('#drawing-stage'), canvas)).toBe(true);
  }
});

test('ready splash keeps its button clear of artwork and its footer inside the card', async ({page})=>{
  await page.goto('/');
  const splash=page.locator('#startup-screen');
  const open=splash.getByRole('button',{name:'Open editor',exact:true});
  await expect(open).toBeVisible();
  for(const [width,height] of [[320,568],[420,640],[667,375],[800,450],[1024,600],[1050,450]]){
    await page.setViewportSize({width,height});
    await expect(open).toHaveCSS('padding','3px 9px');
    const [card,logo,tagline,button,footer]=await Promise.all(
      ['.splash','.logo','.tagline','#startup-open','.footer'].map(async selector=>(await splash.locator(selector).boundingBox())!)
    );
    expect(card.width).toBe(width);
    expect(logo.height).toBe(width<=700?190:240);
    expect(button.y-Math.max(tagline.y+tagline.height,logo.y+logo.height)).toBeGreaterThanOrEqual(11);
    expect(footer.y-button.y-button.height).toBeGreaterThanOrEqual(11);
    expect(footer.y+footer.height).toBeLessThanOrEqual(card.y+card.height);
    await open.click({trial:true});
    const publisher=splash.locator('#publisher');
    await publisher.scrollIntoViewIfNeeded();
    await expect(publisher).toBeInViewport({ratio:1});
  }
});
