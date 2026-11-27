import { exportHtmlFromShortcut } from './export-settings';
import { readFile } from 'node:fs/promises';
import { expect, test } from './editor-test';

test.use({ keepStartupScreen: true });

test('unlicensed startup explains restrictions and lets users configure exports and open Register', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/projects', async route => {
    writes++;
    await route.abort();
  });
  await page.goto('/');
  const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
  await expect(splash.getByText('No valid license', { exact: true })).toBeVisible();
  await expect(splash.getByText('Saving and exporting disabled')).toBeVisible();
  await splash.getByRole('button', { name: 'Open editor' }).click();
  await expect(page.getByRole('button', { name: '↗ Export HTML' })).toHaveCount(0);
  const prompt = page.getByRole('button', { name: 'Register Splash Animator', exact: true });
  await expect(prompt).toHaveCSS('background-color', 'rgb(180, 35, 50)');
  await prompt.click();
  const licensing = page.getByRole('dialog', { name: 'Register Splash Animator' });
  const purchase = licensing.getByRole('link', { name: 'Purchase a license at splashanimator.com' });
  const closeRegister = licensing.getByRole('button', { name: 'Close Register' });
  await page.keyboard.press('Shift+Tab');
  await expect(closeRegister).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(purchase).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeRegister).toBeFocused();
  await expect(purchase).toHaveAttribute('href', 'https://splashanimator.com');
  await expect(purchase).toHaveCSS('background-color', 'rgb(180, 35, 50)');
  const viewport = page.viewportSize()!;
  for (const width of [viewport.width, 360]) {
    await page.setViewportSize({ width, height: viewport.height });
    const footer = (await licensing.locator('footer').boundingBox())!;
    const link = (await purchase.boundingBox())!;
    expect(link.x + link.width).toBeCloseTo(footer.x + footer.width, 0);
    expect(link.y + link.height).toBeCloseTo(footer.y + footer.height, 0);
  }
  await page.setViewportSize(viewport);
  await licensing.getByRole('button', { name: 'Close Register' }).click();
  await expect(prompt).toBeFocused();
  const fileMenu = page.getByRole('button', { name: 'File', exact: true });
  await fileMenu.click();
  await expect(page.getByRole('button', { name: /^Save Ctrl S$/ })).toBeDisabled();
  const exporter = page.getByRole('dialog', { name: 'Export', exact: true });
  const format = exporter.getByLabel('Export format');
  const registerToExport = exporter.getByRole('button', { name: 'Register to export', exact: true });
  for (const [command, preselection] of [
    ['Export HTML animation…', 'html'], ['Export single frame…', 'still'], ['Export current frame PNG…', 'still'],
  ]) {
    await page.getByRole('button', { name: command, exact: true }).click();
    await expect(format).toHaveValue(preselection);
    await expect(registerToExport).toBeEnabled();
    if (command === 'Export current frame PNG…') {
      await expect(exporter.getByLabel('Single frame file type')).toHaveValue('png');
    }
    await exporter.getByRole('button', { name: 'Close export' }).click();
    await expect(fileMenu).toBeFocused();
    await fileMenu.click();
  }
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  await format.selectOption('all');
  await expect(exporter.getByRole('button', { name: /^(Export |Save |Encode )/ })).toHaveCount(0);
  await format.selectOption('html');
  const canvasSize = exporter.getByLabel('HTML canvas size');
  await canvasSize.selectOption('actual');
  await expect(registerToExport).toHaveCSS('background-color', 'rgb(180, 35, 50)');
  await registerToExport.press('Enter');
  await expect(licensing.getByLabel('Signed license code')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(registerToExport).toBeFocused();
  await expect(canvasSize).toHaveValue('actual');
  await exporter.getByRole('button', { name: 'Close export' }).click();
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+s');
  await expect(page.getByRole('alert')).toContainText('valid license with save permission');
  expect(writes).toBe(0);

  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About Splash Animator' });
  const closeAbout = about.getByRole('button', { name: 'Close About' });
  const aboutRegister = about.getByRole('button', { name: 'Register…', exact: true });
  await expect(closeAbout).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(aboutRegister).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeAbout).toBeFocused();
  await expect(about.getByRole('heading', { name: 'Licensing' })).toBeVisible();
  await expect(about.getByText('Unlicensed', { exact: true })).toHaveCSS('color', 'rgb(255, 133, 133)');
  await expect(about.getByRole('region', { name: 'Licensing' })).toHaveText('Licensing Unlicensed');
  await expect(about.getByLabel('Signed license code')).toHaveCount(0);
  await aboutRegister.press('Enter');
  const register = page.getByRole('dialog', { name: 'Register Splash Animator' });
  await expect(register.getByLabel('Signed license code')).toBeFocused();
  await expect(register.getByText('No valid license.', { exact: false })).toBeVisible();
  await expect(about).toHaveCount(0);
  await register.getByLabel('Signed license code').press('Escape');
  await expect(register).toHaveCount(0);
  await expect(help).toBeFocused();
});

test('unlicensed startup on desktop keeps PNG and native FFmpeg export settings available', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      invoke: async () => null,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open editor' }).click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();

  const exporter = page.getByRole('dialog', { name: 'Export', exact: true });
  const format = exporter.getByLabel('Export format');
  await expect(format).toHaveValue('still');
  await expect(exporter.getByLabel('Single frame file type')).toHaveValue('png');
  await format.selectOption('ffmpeg');
  await expect(exporter.getByLabel('PNG export scale')).toBeEnabled();
  await expect(exporter.getByRole('button', { name: /^Encode / })).toHaveCount(0);
  await exporter.getByRole('button', { name: 'Register to export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Register Splash Animator' })).toBeVisible();
});

test('registration verifies a signed code, writes a license file, unlocks output and survives reload', async ({ page }) => {
  const signed = process.env.SPLASH_TEST_LICENSE;
  test.skip(!signed, 'Use a test build with its matching signed license fixture.');
  await page.setViewportSize({ width: 1050, height: 720 });
  await page.goto('/');
  const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
  await splash.getByRole('button', { name: 'Open editor' }).click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export HTML animation…', exact: true }).click();
  const exporter = page.getByRole('dialog', { name: 'Export', exact: true });
  const exportFormat = exporter.getByLabel('Export format');
  const canvasSize = exporter.getByLabel('HTML canvas size');
  await canvasSize.selectOption('actual');
  await exporter.getByRole('button', { name: 'Register to export', exact: true }).click();
  const register = page.getByRole('dialog', { name: 'Register Splash Animator' });
  await expect(register.getByLabel('Signed license code')).toBeFocused();
  await expect(register.getByText('Premstream')).toHaveCount(0);
  await register.getByLabel('Signed license code').fill('invalid');
  await register.getByRole('button', { name: 'Register license' }).click();
  await expect(register.getByRole('alert')).toBeVisible();
  await expect(register.getByLabel('Signed license code')).toBeFocused();
  await register.getByLabel('Signed license code').fill(signed!);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    register.getByRole('button', { name: 'Register license' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('SplashAnimator.splashlicense');
  expect(await readFile((await file.path())!, 'utf8')).toBe(signed);
  await expect(register.getByRole('status')).toContainText('License registered.');
  await expect(register.getByRole('button', { name: 'Replace license', exact: true })).toBeFocused();
  const details = register.getByRole('region', { name: 'Licensing' });
  await expect(register.getByText('Single-user license', { exact: true })).toBeVisible();
  const cards = details.locator('.cards > section');
  await expect(cards.locator('dt')).toHaveText([
    'Licensed to', 'Company', 'Email', 'Expires', 'Save and export', 'Commercial use', 'Annual revenue limit',
  ]);
  const desktopCards = await cards.evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
  expect(desktopCards[0]).toBeCloseTo(desktopCards[1]);
  expect(await register.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect(details.getByText('License ID', { exact: true })).toBeHidden();
  await details.getByText('Technical details', { exact: true }).click();
  await expect(details.locator('details dt')).toHaveText(['License ID', 'Issuer', 'Software', 'Issued', 'License version']);
  await expect(details.getByText('License ID', { exact: true })).toBeVisible();
  await details.getByText('Technical details', { exact: true }).click();
  await expect(register.getByLabel('Signed license code')).toHaveCount(0);
  await register.getByRole('button', { name: 'Replace license', exact: true }).click();
  await expect(register.getByLabel('Signed license code')).toBeFocused();
  await register.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
  await expect(register.getByLabel('Signed license code')).toHaveCount(0);
  await page.setViewportSize({ width: 430, height: 720 });
  const narrowCards = await cards.evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
  expect(narrowCards[1]).toBeGreaterThan(narrowCards[0]);
  await page.setViewportSize({ width: 1050, height: 720 });
  await expect(details.getByText('Fixture User', { exact: true })).toBeVisible();
  await expect(details.getByText('Fixture Co', { exact: true })).toBeVisible();
  await register.getByRole('button', { name: 'Close Register' }).click();
  await expect(exportFormat).toBeFocused();
  await expect(canvasSize).toHaveValue('actual');
  await expect(exporter.getByRole('button', { name: 'Export HTML animation…', exact: true })).toBeEnabled();
  await expect(exporter.getByRole('button', { name: 'Register to export', exact: true })).toHaveCount(0);
  await exporter.getByRole('button', { name: 'Close export' }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About Splash Animator' });
  await expect(about.getByText('Fixture User', { exact: true })).toBeVisible();
  await expect(about.getByText('Fixture Co', { exact: true })).toBeVisible();
  const summary = about.getByRole('region', { name: 'Licensing' });
  await expect(summary.locator('dt')).toHaveText(['Licensed to', 'Company', 'Email']);
  await expect(summary.getByText('fixture@example.com', { exact: true })).toBeVisible();
  await about.getByRole('button', { name: 'Close About' }).click();
  const [output] = await Promise.all([
    page.waitForEvent('download'),
    exportHtmlFromShortcut(page),
  ]);
  expect(output.suggestedFilename()).toMatch(/-web\.zip$/);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+s');
  const save = page.getByRole('button', { name: 'Save project folder', exact: true });
  await expect(save).toBeEnabled();
  // The project-file bridge accepts only the normal local editor on port 1420.
  if (new URL(page.url()).port === '1420') {
    const projectName = `License-test-${Date.now()}`;
    await page.getByLabel('Project name').fill(projectName);
    await save.click();
    await expect(page.getByText('Saved to folder', { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(`.e2e-projects/${projectName}.spl/project.json`, 'utf8'));
    expect(saved.format).toBe('splash-directory');
  }
  await page.reload();
  await expect(splash.getByText('Licensed to: Fixture User')).toBeVisible();
  await expect(splash.getByText('Saving and exporting enabled')).toBeVisible();
});

test('Register loads a license file and verifies it on submission', async ({ page }) => {
  const signed = process.env.SPLASH_TEST_LICENSE;
  test.skip(!signed, 'Use a test build with its matching signed license fixture.');
  await page.goto('/');
  const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
  await splash.getByRole('button', { name: 'Open editor' }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Register…', exact: true }).click();
  const register = page.getByRole('dialog', { name: 'Register Splash Animator' });
  const fileInput = register.locator('input[type=file]');
  const loadFile = register.getByRole('button', { name: 'Load license file…' });
  const submit = register.getByRole('button', { name: 'Register license' });
  const filename = 'SplashAnimator.splashlicense';
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), loadFile.click()]);
  await picker.setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await expect(register.getByRole('alert')).toHaveText('The license file is empty.');
  await expect(submit).toBeDisabled();
  await fileInput.setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.alloc(20000) });
  await expect(register.getByRole('alert')).toHaveText('The license file is too large.');
  await fileInput.setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await submit.click();
  await expect(register.getByRole('alert')).toBeVisible();
  await expect(register.getByText('Unlicensed', { exact: true })).toBeVisible();

  await fileInput.setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(`\uFEFF${signed}\r\n`) });
  await expect(register.getByLabel('Signed license code')).toHaveValue(signed!);
  await expect(register.getByText('Unlicensed', { exact: true })).toBeVisible();
  await Promise.all([page.waitForEvent('download'), submit.click()]);
  await expect(register.getByRole('status')).toHaveText('License registered.');
  await expect(register.getByText('Fixture User', { exact: true })).toBeVisible();

  await register.getByRole('button', { name: 'Replace license' }).click();
  await fileInput.setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await submit.click();
  await expect(register.getByRole('alert')).toBeVisible();
  await expect(register.getByText('Fixture User', { exact: true })).toBeVisible();
  await page.reload();
  await expect(splash.getByText('Licensed to: Fixture User')).toBeVisible();
});
