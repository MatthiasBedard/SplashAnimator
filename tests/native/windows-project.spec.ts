import { expect, test, type Page } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  newProject,
  newLayer,
  type Project,
  type SymbolDefinition,
  type Vector,
} from '../../packages/document/src';
import { NodeDirectoryStore } from '../../packages/document/src/node-store';
import { loadProject, saveProject } from '../../packages/document/src/storage';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { addDenseTimeline, denseDrawingProject } from '../e2e/dense-drawing-project';
import { expectSource, fillSource, sourceEditor } from '../e2e/monaco-source';
import { pcm16WavFixture } from '../wav-fixture';

const exec = promisify(execFile);
const binary = process.env.SPLASH_NATIVE_PROJECT_TEST_EXE;
const license = process.env.SPLASH_NATIVE_PROJECT_TEST_LICENSE_FILE;
const fixtureName = 'Native project acceptance';

async function localPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject).listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function selectFolder(owner: number, title: string, folder?: string) {
  await exec(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('tests/native/select-windows-project-folder.ps1'),
      '-OwnerProcess',
      String(owner),
      '-Title',
      title,
      ...(folder === undefined ? ['-Cancel'] : ['-Folder', folder]),
    ],
    { timeout: 20_000 },
  );
}

function fixture(bitmap: string): Project {
  const project = newProject();
  Object.assign(project, { width: 500, height: 300, fps: 18, duration: 10 });
  const art: Vector = {
    id: 'native-art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 45,
    height: 45,
    rotation: 0,
    fill: '#e63122',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const inner: SymbolDefinition = {
    id: 'native-inner',
    name: 'Nested artwork',
    width: 130,
    height: 85,
    shapes: [art],
    timeline: { duration: 8, keys: [{ frame: 6, shapes: [{ ...art, x: 75 }] }] },
  };
  const outer: SymbolDefinition = {
    id: 'native-outer',
    name: 'Outer artwork',
    width: 150,
    height: 100,
    shapes: [symbolInstance(inner, 10, 10)],
  };
  project.symbols = [inner, outer];
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [symbolInstance(outer, 65, 65)];
  project.assets = [
    {
      id: 'native-bitmap',
      path: 'assets/bitmaps/native-bitmap.json',
      bitmap: { name: 'Native bitmap', width: 1, height: 1, dataUrl: bitmap },
    },
  ];
  return project;
}

async function projectSnapshot(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
  );
}

async function launchNative(
  chromium: typeof import('@playwright/test').chromium,
  root: string,
  profile: string,
  beforeNavigation?: (page: Page) => Promise<void>,
) {
  const endpoint = `http://127.0.0.1:${await localPort()}`;
  const app = spawn(path.resolve(binary!), [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      SPLASH_NATIVE_PROJECT_SAVE_FOLDER: root,
      SPLASH_NATIVE_PROJECT_OPEN_FOLDER: path.join(root, fixtureName + '.spl'),
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, profile),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${new URL(endpoint).port} --remote-debugging-address=127.0.0.1`,
    },
  });
  const stopped = new Promise<void>((resolve) => {
    app.once('exit', () => resolve());
    app.once('error', () => resolve());
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  async function close(interrupt = false) {
    const killed = app.kill();
    await stopped;
    await browser?.close();
    if (interrupt && !killed)
      throw Error('The fixture editor was already stopped before interruption.');
  }
  try {
    if (!app.pid) throw Error('Unable to launch the native editor.');
    const packaged = (url: string) => /^https?:\/\/tauri\.localhost\//.test(url);
    await expect
      .poll(
        async () => {
          try {
            const targets = (await (await fetch(`${endpoint}/json/list`)).json()) as {
              url: string;
            }[];
            return targets.some((target) => packaged(target.url));
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    const connection = await browser.newBrowserCDPSession();
    const { targetInfos } = await connection.send('Target.getTargets');
    const editor = targetInfos.find((target) => target.type === 'page' && packaged(target.url));
    if (!editor) throw Error('The native WebView did not open the packaged editor.');
    await beforeNavigation?.(page);
    await page.goto(editor.url, { waitUntil: beforeNavigation ? 'commit' : 'load' });
    return { owner: app.pid, page, close, stopped, connection };
  } catch (error) {
    await close();
    throw error;
  }
}

async function openNativeProject(
  { page, owner }: Awaited<ReturnType<typeof launchNative>>,
  folder: string,
) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await Promise.all([
    selectFolder(owner, 'Open a .spl project folder', folder),
    page.getByRole('button', { name: /^Open \.spl folder…/ }).click(),
  ]);
  await expect(
    page.getByRole('button', { name: 'Close ' + fixtureName, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.status-message').first()).toContainText('Opened ' + fixtureName);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
}

function sampleArtwork(page: Page, points: [number, number][]) {
  return page
    .getByLabel('Drawing stage', { exact: true })
    .evaluate((canvas: HTMLCanvasElement, points) => {
      const context = canvas.getContext('2d')!;
      return points.map(([x, y]) =>
        Array.from(
          context.getImageData(
            Math.round(canvas.width / 2 + (x - 250) * devicePixelRatio),
            Math.round(canvas.height / 2 + (y - 150) * devicePixelRatio),
            1,
            1,
          ).data,
        ),
      );
    }, points);
}

test('Windows sustained mixed editing releases the dense document on close', async ({ playwright }, testInfo) => {
  test.skip(process.platform !== 'win32' || !binary || !process.env.SPLASH_NATIVE_STRESS,
    'Requires the packaged editor and SPLASH_NATIVE_STRESS=1.');
  test.setTimeout(300_000);
  const root = testInfo.outputPath('native-profile');
  await mkdir(root, { recursive: true });
  const project = denseDrawingProject(false, true, true);
  project.name = 'Dense native session';
  addDenseTimeline(project);
  const recoveryKey = 'splash-recovery-v1';
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    current = await launchNative(playwright.chromium, root, 'mixed', async page => {
      await page.addInitScript(({ key, project }) => {
        if (!sessionStorage.getItem('dense-seeded')) {
          localStorage.setItem(key, JSON.stringify({ project, folder: null, manifest: null }));
          sessionStorage.setItem('dense-seeded', '1');
        }
      }, { key: recoveryKey, project });
    });
    const { page, owner, connection } = current;
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    let liveWorkers = 0, peakWorkers = 0, closedWorkers = 0;
    page.on('worker', worker => {
      peakWorkers = Math.max(peakWorkers, ++liveWorkers);
      worker.once('close', () => { liveWorkers--; closedWorkers++; });
    });
    const session = await page.context().newCDPSession(page);
    const memory = async () => {
      await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      });
      await session.send('HeapProfiler.collectGarbage');
      const heap = await session.send('Runtime.getHeapUsage');
      const { processInfo } = await connection.send('SystemInfo.getProcessInfo');
      const ids = [...new Set([owner, ...processInfo.map(process => process.id)])];
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress`],
      { timeout: 10_000 });
      const output = JSON.parse(stdout) as { PrivateMemorySize64: number; WorkingSet64: number }[] |
        { PrivateMemorySize64: number; WorkingSet64: number };
      const processes = Array.isArray(output) ? output : [output];
      expect(processes.length).toBeGreaterThan(1);
      return {
        heap: heap.usedSize,
        backing: heap.backingStorageSize,
        privateBytes: processes.reduce((total, process) => total + process.PrivateMemorySize64, 0),
        workingSet: processes.reduce((total, process) => total + process.WorkingSet64, 0),
        processes: processes.length,
      };
    };
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const stage = page.getByLabel('Drawing stage', { exact: true });
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    const move = async (x: number, y: number) => {
      const point = await stage.evaluate((canvas: HTMLCanvasElement, { x, y, width, height }) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + rect.width * (0.5 + (x - width / 2) * devicePixelRatio / canvas.width),
          y: rect.top + rect.height * (0.5 + (y - height / 2) * devicePixelRatio / canvas.height),
        };
      }, { x, y, width: project.width, height: project.height });
      await page.mouse.move(point.x, point.y);
    };
    const started = performance.now();
    const checkpoints = [await memory()];
    const releaseMs: number[] = [];
    let expected = project;
    for (let cycle = 0; cycle < 6; cycle++) {
      await stage.press('Enter');
      await expect(timeline).toHaveAccessibleDescription(/Frame 4\d\d of 480/, { timeout: 26_000 });
      await expect(timeline).toHaveAccessibleDescription(/Frame [1-9]\d? of 480/, { timeout: 14_000 });
      await stage.press('Enter');
      await timeline.press('Home');
      for (const [index, tool] of (['Brush', 'Pencil'] as const).entries()) {
        await page.getByRole('button', { name: tool, exact: true }).click();
        await page.getByLabel(tool === 'Brush' ? 'Separate brush objects' : 'Separate Pencil objects',
          { exact: true }).check();
        const y = 280 + 11 * cycle + 5 * index;
        await move(275, y);
        await page.mouse.down();
        await move(325, y);
        const release = performance.now();
        await page.mouse.up();
        await expect.poll(() => page.evaluate(key => {
          const { project } = JSON.parse(localStorage.getItem(key)!) as { project: Project };
          return project.layers[0].keys[0].shapes.length;
        }, recoveryKey)).toBe(project.layers[0].keys[0].shapes.length + 2 * cycle + index + 1);
        releaseMs.push(performance.now() - release);
      }
      const before = await projectSnapshot(page);
      const ink = before.layers[0].keys[0].shapes[1];
      const dx = cycle % 2 ? -20 : 20;
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await move(ink.x + 42, 125);
      await page.mouse.down();
      await move(ink.x + 42 + dx, 125);
      await page.mouse.up();
      expected = structuredClone(before);
      expected.layers[0].keys[0].shapes[1].x += dx;
      const matches = async (project: Project) =>
        JSON.stringify(await projectSnapshot(page)) === JSON.stringify(project);
      await expect.poll(() => matches(expected)).toBe(true);
      await stage.press('Control+z');
      await expect.poll(() => matches(before)).toBe(true);
      await stage.press('Control+Shift+z');
      await expect.poll(() => matches(expected)).toBe(true);
      if (cycle % 2 === 1) checkpoints.push(await memory());
    }
    const trimNotice = page.getByRole('status').filter({ hasText: 'Older Undo history was trimmed.' });
    await expect(trimNotice).toBeVisible();
    await expect.poll(() => liveWorkers).toBe(0);
    expect({ peakWorkers, closedWorkers }).toEqual({ peakWorkers: 1, closedWorkers: 12 });
    expect(expected.layers.slice(1)).toEqual(project.layers.slice(1));
    expect(expected.symbols).toEqual(project.symbols);
    const beforeClose = await page.evaluate(key => localStorage.getItem(key), recoveryKey);
    expect(beforeClose === JSON.stringify({ project: expected, folder: null, manifest: null })).toBe(true);
    const close = page.getByRole('button', { name: 'Close ' + project.name, exact: true });
    await close.click();
    const prompt = page.getByRole('dialog', { name: 'Close project', exact: true });
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), recoveryKey) === beforeClose).toBe(true);
    await close.click();
    await prompt.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(close).toHaveCount(0);
    await expect(trimNotice).toHaveCount(0);
    await expect(timeline).toHaveAccessibleDescription(new RegExp(`Frame 1 of ${newProject().duration}\\.`));
    expect(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).toBeNull();
    const afterClose = await memory();
    console.info('native dense session observations', JSON.stringify({
      elapsed: performance.now() - started, releaseMs, checkpoints, afterClose, peakWorkers, closedWorkers,
    }));
    expect(afterClose.heap).toBeLessThan(checkpoints.at(-1)!.heap);
    expect(afterClose.backing).toBeLessThan(checkpoints.at(-1)!.backing!);
    expect(pageErrors).toEqual([]);
    await session.detach();
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('native Windows forced colors distinguishes the selected drawing tool from keyboard focus', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the bundled Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-forced-tools-'));
  const project = newProject();
  let app: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    app = await launchNative(playwright.chromium, root, 'forced-tools', async page => {
      await page.addInitScript(project => {
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
      }, project);
    });
    const { page } = app;
    await page.emulateMedia({ forcedColors: 'active' });
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const tools = page.getByRole('complementary', { name: 'Drawing tools' });
    const selection = tools.getByRole('button', { name: 'Selection', exact: true });
    const rectangle = tools.getByRole('button', { name: 'Rectangle', exact: true });
    await rectangle.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(rectangle).toBeFocused();
    const selections = await tools.evaluate(element => {
      const active = getComputedStyle(element.querySelector('[aria-pressed="true"]')!);
      const focus = getComputedStyle(element.querySelector(':focus-visible')!);
      const sample = element.ownerDocument.createElement('span');
      sample.style.cssText = 'forced-color-adjust:none;background:Highlight;color:HighlightText';
      element.append(sample);
      const palette = getComputedStyle(sample);
      const result = {
        highlight: active.backgroundColor === palette.backgroundColor && active.color === palette.color,
        distinct: active.backgroundColor !== focus.backgroundColor,
        outline: focus.outlineStyle, width: focus.outlineWidth,
      };
      sample.remove();
      return result;
    });
    expect(selections).toEqual({ highlight: true, distinct: true, outline: 'solid', width: '2px' });
    await rectangle.press('Enter');
    await expect(selection).toHaveAttribute('aria-pressed', 'false');
    await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
    const accessibility = await page.context().newCDPSession(page);
    try {
      const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
      const tool = nodes.find(node => !node.ignored && node.name?.value === 'Rectangle' &&
        node.properties?.some(property => property.name === 'pressed'));
      expect(tool?.role?.value).toBe('button');
      expect(String(tool?.properties?.find(property => property.name === 'pressed')?.value.value)).toBe('true');
    } finally { await accessibility.detach(); }

    const stage = page.getByLabel('Drawing stage', { exact: true });
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 - 25, box.y + box.height / 2 - 25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 25, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await projectSnapshot(page)).layers[0].keys[0].shapes.length).toBe(1);
    await stage.press('Control+z');
    await expect.poll(() => projectSnapshot(page)).toEqual(project);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('native script title bar commits before closing', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the bundled Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-script-close-'));
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: '// Original' }];
  let app: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    app = await launchNative(playwright.chromium, root, 'script-close', async page => {
      await page.addInitScript(project => {
        if (!location.hash) localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
      }, project);
    });
    const { page, owner } = app;
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    const [floating] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click(),
    ]);
    const dialog = floating.getByRole('dialog', { name: 'Edit frame source', exact: true });
    const oversized = 'é'.repeat(131073);
    await fillSource(sourceEditor(dialog), oversized);
    const feedback = dialog.getByLabel('Frame save status', { exact: true });
    await expect(feedback).toHaveAttribute('aria-live', 'polite');
    await expect(feedback).toHaveText('Frame changes pending.');
    const accessibility = await floating.context().newCDPSession(floating);
    try {
      const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
      expect(nodes.some(node => !node.ignored && node.name?.value === 'Frame changes pending.')).toBe(true);
    } finally { await accessibility.detach(); }
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Discard frame draft and close' })).toBeVisible();
    await expect(feedback).toContainText('Frame changes remain unsaved.');
    expect(await projectSnapshot(page)).toEqual(project);
    const text = 'const pending: number = 42;';
    await fillSource(sourceEditor(dialog), text);
    expect(new URL(floating.url()).origin).toBe(new URL(page.url()).origin);
    expect(await projectSnapshot(page)).toEqual(project);
    // Require the close request to save the draft while the WebView is alive.
    await floating.evaluate(() => {
      for (const name of ['blur', 'focusout', 'pagehide'])
        window.addEventListener(name, event => event.stopImmediatePropagation(), { capture: true });
    });
    const close = floating.waitForEvent('close');
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
      'Add-Type -AssemblyName UIAutomationClient',
      '$root = [Windows.Automation.AutomationElement]::RootElement',
      '$match = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, ' + owner + ')',
      '$panel = $root.FindAll([Windows.Automation.TreeScope]::Children, $match) | Where-Object { $_.Current.Name -like "Script Editor*Splash Animator" }',
      'if (@($panel).Count -ne 1) { throw "Expected exactly one script editor owned by the fixture" }',
      'Add-Type -Name ScriptClose -Namespace SplashTest -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr handle, uint message, System.IntPtr wParam, System.IntPtr lParam);\'',
      '$handle = [IntPtr]$panel.Current.NativeWindowHandle',
      'foreach ($attempt in 1..2) { [void][SplashTest.ScriptClose]::PostMessage($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }',
    ].join('; ')], { timeout: 10_000 });
    await close;
    await expect.poll(() => projectSnapshot(page)).toEqual({ ...project, frameScripts: [{ frame: 0, source: text }] });
    await page.getByRole('dialog', { name: 'Edit frame source', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
    await expect.poll(() => projectSnapshot(page)).toEqual(project);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('native Windows Code Editor preferences reach the open floating editor and canvas dock', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the bundled Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-code-preferences-'));
  const project = newProject();
  const original = 'const draft = 1;\n';
  project.frameScripts = [{ frame: 0, source: original }];
  let app: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    app = await launchNative(playwright.chromium, root, 'code-preferences', async page => {
      await page.addInitScript(project => {
        if (!location.hash) localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
      }, project);
    });
    const { page } = app;
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    const [floating] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click(),
    ]);
    const dialog = floating.getByRole('dialog', { name: 'Edit frame source', exact: true });
    const editor = sourceEditor(dialog);
    const model = dialog.locator('.monaco-editor:visible');
    await expectSource(editor, original);
    const uri = await model.getAttribute('data-uri');
    const before = await projectSnapshot(page);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: 'Preferences…', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await preferences.getByRole('tab', { name: 'Code Editor', exact: true }).click();
    await preferences.getByLabel('Indent using').selectOption('tabs');
    await preferences.getByLabel('Indent size').selectOption('6');
    await preferences.getByLabel('Font size (px)').fill('18');
    await preferences.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog.locator('.view-lines:visible')).toHaveCSS('font-size', '18px');
    await expect(model).toHaveAttribute('data-uri', uri!);
    await expectSource(editor, original);
    expect(await projectSnapshot(page)).toEqual(before);

    await editor.press('Control+End');
    await editor.press('Tab');
    await floating.keyboard.insertText('const floating = 2;');
    const authored = original + '\tconst floating = 2;';
    await expectSource(editor, authored);
    await Promise.all([
      floating.waitForEvent('close'),
      dialog.getByLabel('Script editor location').selectOption('canvas'),
    ]);
    const dock = page.locator('#canvas-script-panel');
    const dockedEditor = sourceEditor(dock);
    await expectSource(dockedEditor, authored);
    await expect(dock.locator('.view-lines:visible')).toHaveCSS('font-size', '18px');
    await dockedEditor.press('Control+End');
    await dockedEditor.press('Enter');
    await page.keyboard.insertText('const docked = 3;');
    const final = authored + '\n\tconst docked = 3;';
    await expectSource(dockedEditor, final);
    await dock.getByRole('button', { name: 'Apply frame source', exact: true }).click();
    await expect.poll(() => projectSnapshot(page))
      .toEqual({ ...before, frameScripts: [{ frame: 0, source: final }] });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows menu bar controls the native window', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the bundled Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-window-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  let releaseEditor!: () => void;
  const editorAllowed = new Promise<void>((resolve) => {
    releaseEditor = resolve;
  });
  try {
    current = await launchNative(playwright.chromium, root, 'window', async (target) => {
      await target.route(
        (url) => /\/assets\/start-editor-[\w-]+\.js$/.test(url.pathname),
        async (route) => {
          await editorAllowed;
          await route.continue();
        },
      );
    });
    const { page, stopped } = current;
    const openEditor = (target: Page) =>
      target
        .getByRole('dialog', { name: 'Splash Animator startup' })
        .getByRole('button', { name: 'Open editor', exact: true })
        .click();
    function state(target: Page, name: 'is_decorated' | 'is_maximized' | 'is_minimized') {
      return target.evaluate((command) => {
        const tauri = window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<boolean> };
        };
        return tauri.__TAURI_INTERNALS__.invoke('plugin:window|' + command);
      }, name);
    }

    const menu = page.getByRole('navigation', { name: 'Application menu' });
    const controls = menu.getByRole('group', { name: 'Window controls' });
    const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
    await expect(splash.getByRole('status')).toHaveText('Starting Splash Animator…');
    for (const name of ['File', 'Edit', 'View', 'Insert', 'Control', 'Window', 'Help']) {
      await expect(menu.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await expect(controls.getByRole('button', { name: 'Minimize window' })).toBeEnabled();
    await expect(controls.getByRole('button', { name: 'Close window' })).toBeEnabled();
    expect(await state(page, 'is_decorated')).toBe(false);

    await controls.getByRole('button', { name: 'Maximize window' }).click();
    await expect.poll(() => state(page, 'is_maximized')).toBe(true);
    await controls.getByRole('button', { name: 'Restore window' }).click();
    await expect.poll(() => state(page, 'is_maximized')).toBe(false);
    await menu.locator('[data-tauri-drag-region]').dblclick();
    await expect.poll(() => state(page, 'is_maximized')).toBe(true);

    releaseEditor();
    await expect(splash.getByRole('button', { name: 'Open editor' })).toBeVisible();
    await expect(splash).toHaveCSS('backdrop-filter', 'blur(4px)');
    await expect(menu).toHaveCSS('backdrop-filter', 'none');
    const menuBounds = (await menu.boundingBox())!;
    const splashBounds = (await splash.boundingBox())!;
    expect(splashBounds.y).toBe(menuBounds.y + menuBounds.height);
    await expect(menu.locator('button.publish')).toBeDisabled();
    await expect(page.locator('#app')).toHaveAttribute('inert', '');

    await openEditor(page);
    await menu.getByRole('button', { name: 'File', exact: true }).click();
    await expect(menu.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
    await menu.getByRole('button', { name: 'Help', exact: true }).click();
    const documentationWindow = page.context().waitForEvent('page');
    await menu.getByRole('button', { name: 'Documentation', exact: true }).click();
    const docs = await documentationWindow;
    await expect(docs.getByRole('heading', { name: 'Splash Animator Documentation' })).toBeVisible();
    await docs.getByRole('link', { name: 'Scripting guide and API reference' }).click();
    await expect(docs.getByRole('heading', { name: 'Scripting in Splash Animator' })).toBeVisible();
    expect(await docs.evaluate(() => window.opener)).toBeNull();
    await page.bringToFront();
    await menu.getByRole('button', { name: 'Help', exact: true }).click();
    await menu.getByRole('button', { name: 'Show Splash Screen', exact: true }).click();
    await expect(splash).toBeVisible();
    await expect(menu.getByRole('button', { name: 'File', exact: true })).toBeDisabled();
    await controls.getByRole('button', { name: 'Close window' }).click();
    await stopped;
    await current.close();

    current = await launchNative(playwright.chromium, root, 'minimize');
    await current.page.getByRole('button', { name: 'Minimize window' }).click();
    const minimizedPage = current.page;
    await expect.poll(() => state(minimizedPage, 'is_minimized')).toBe(true);
  } finally {
    releaseEditor();
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows packaged update dialog starts without a configured release feed', async ({ playwright }, testInfo) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = testInfo.outputPath('updater-profile');
  await mkdir(root, { recursive: true });
  const current = await launchNative(playwright.chromium, root, 'webview');
  try {
    const { page } = current;
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    const help = page.getByRole('button', { name: 'Help', exact: true });
    await help.click();
    await page.getByRole('button', { name: 'Update…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Splash Animator Update' });
    await expect(dialog.getByRole('status')).toHaveText('This build has no update feed configured.');
    const config = JSON.parse(await readFile('apps/editor/src-tauri/tauri.conf.json', 'utf8'));
    await expect(dialog.getByTestId('installed-version')).toHaveText(config.version);
    await expect(dialog.getByRole('button', { name: 'Download and install' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(help).toBeFocused();
  } finally {
    await current.close();
  }
});

test('Windows application menus support keyboard navigation and restore dialog focus', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-menu-keys-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    current = await launchNative(playwright.chromium, root, 'menu-keys');
    const { page } = current;
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(stage).toBeFocused();
    const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
    const file = menu.getByRole('button', { name: 'File', exact: true });
    const help = menu.getByRole('button', { name: 'Help', exact: true });
    await page.keyboard.press('F10');
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(file).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('button', { name: 'New project', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('button', { name: /^Open \.spl folder/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();
    await expect(file).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('ArrowLeft');
    await expect(help).toBeFocused();
    await page.keyboard.press('Space');
    const aboutAction = menu.getByRole('button', { name: 'About', exact: true });
    const registerAction = menu.getByRole('button', { name: 'Register…', exact: true });
    await expect(aboutAction).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(registerAction).toBeFocused();
    await page.keyboard.press('Home');
    await expect(aboutAction).toBeFocused();
    await page.keyboard.press('Enter');
    const about = page.getByRole('dialog', { name: 'About Splash Animator', exact: true });
    await expect(about.getByRole('button', { name: 'Close About', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(about.getByRole('link', { name: 'splashanimator.com', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(about.getByRole('button', { name: 'Register…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const register = page.getByRole('dialog', { name: 'Register Splash Animator', exact: true });
    await expect(register.getByRole('textbox', { name: 'Signed license code', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(register).toHaveCount(0);
    await expect(help).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(stage).toBeFocused();
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows File dialogs keep keyboard focus and return it after cancellation', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary || !license, 'Requires the packaged Windows editor and fixture license.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-file-keys-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    current = await launchNative(playwright.chromium, root, 'file-keys');
    const { page, owner } = current;
    await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await expect(stage).toBeFocused();
    const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
    const file = menu.getByRole('button', { name: 'File', exact: true });
    const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await page.getByRole('button', { name: 'Add layer', exact: true }).click();
    await stage.focus();
    const before = await recovery();
    expect(before).not.toBeNull();
    await page.keyboard.press('F10');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('button', { name: /^Open \.spl folder/ })).toBeFocused();
    await Promise.all([
      selectFolder(owner, 'Open a .spl project folder'),
      page.keyboard.press('Enter'),
    ]);
    await expect(file).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(stage).toBeFocused();

    await menu.getByRole('button', { name: 'Help', exact: true }).click();
    await menu.getByRole('button', { name: 'Register…', exact: true }).click();
    const register = page.getByRole('dialog', { name: 'Register Splash Animator', exact: true });
    const code = register.getByLabel('Signed license code');
    if (await code.isVisible()) {
      await code.fill(await readFile(license!, 'utf8'));
      await register.getByRole('button', { name: 'Register license', exact: true }).click();
      await expect(register.getByRole('status')).toContainText('License registered.');
    }
    await page.keyboard.press('Escape');
    await expect(register).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Help', exact: true })).toBeFocused();
    await page.keyboard.press('F10');
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('button', { name: 'Save As / duplicate…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Project name', exact: true });
    await expect(name).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('Cancelled native save');
    await page.keyboard.press('Tab');
    const save = dialog.getByRole('button', { name: 'Save project folder', exact: true });
    await expect(save).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await Promise.all([
      selectFolder(owner, 'Choose parent folder for new .spl project'),
      page.keyboard.press('Enter'),
    ]);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Cancelled native save');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(file).toBeFocused();
    expect(await recovery()).toBe(before);
    expect(await readdir(root)).not.toContain('Cancelled native save.spl');

    const documents = page.getByRole('navigation', { name: 'Open documents', exact: true });
    const close = documents.getByRole('button', { name: 'Close Untitled', exact: true });
    const prompt = page.getByRole('dialog', { name: 'Close project', exact: true });
    await close.press('Enter');
    await expect(prompt.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(close).toBeFocused();
    expect(await recovery()).toBe(before);
    await page.keyboard.press('Enter');
    await expect(prompt.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(prompt.getByRole('button', { name: 'Discard changes', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveCount(0);
    await expect(documents.getByRole('button', { name: 'Switch to Untitled', exact: true })).toBeFocused();
    expect(await recovery()).toBeNull();
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows Web folder export restores keyboard focus and retries through the native folder chooser', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary || !license, 'Requires the packaged Windows editor and fixture license.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-export-keys-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const folder = path.join(root, fixtureName + '.spl');
    const exportName = fixtureName.replace(/ /g, '-') + '-web';
    const output = path.join(root, exportName);
    const secondParent = path.join(root, 'configured-export');
    await mkdir(secondParent);
    const project = newProject();
    project.name = fixtureName;
    project.layers[0].drawingMode = 'object';
    project.layers[0].keys[0].shapes = [{
      id: 'native-export-art', kind: 'rectangle', x: 150, y: 100, width: 100, height: 100,
      rotation: 0, points: [], fill: '#ff0000', stroke: '#000000', strokeWidth: 0,
    }];
    project.frameScripts = [{ frame: 0, source: 'globalThis.unexpectedNativeExportScript = true;' }];
    await mkdir(folder);
    const store = new NodeDirectoryStore(folder);
    await saveProject(store, project, null);
    const before = await loadProject(store);

    current = await launchNative(playwright.chromium, root, 'export-keys');
    const { page, owner } = current;
    await page.getByRole('button', { name: 'Open editor', exact: true }).press('Enter');
    const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
    await menu.getByRole('button', { name: 'Help', exact: true }).click();
    await menu.getByRole('button', { name: 'Register…', exact: true }).click();
    const register = page.getByRole('dialog', { name: 'Register Splash Animator', exact: true });
    const code = register.getByLabel('Signed license code');
    if (await code.isVisible()) {
      await code.fill(await readFile(license!, 'utf8'));
      await register.getByRole('button', { name: 'Register license', exact: true }).click();
      await expect(register.getByRole('status')).toContainText('License registered.');
    }
    await page.keyboard.press('Escape');
    await expect(register).toHaveCount(0);
    await openNativeProject(current, folder);
    await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await projectSnapshot(page)).layers[0].keys[0].shapes[0].x).toBe(151);
    const draft = await projectSnapshot(page);

    const file = menu.getByRole('button', { name: 'File', exact: true });
    const chooserTitle = `Choose where to create ${exportName}`;
    const settings = page.getByRole('dialog', { name: 'Export', exact: true });
    const exportAction = settings.getByRole('button', { name: 'Export HTML animation…', exact: true });
    const chooseDestination = (parent?: string) => Promise.all([
      selectFolder(owner, chooserTitle, parent),
      page.keyboard.press('Enter'),
    ]);
    async function openQuickExport() {
      await expect(file).toBeFocused();
      await page.keyboard.press('ArrowDown');
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('button', { name: 'Export HTML animation…', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(settings.getByLabel('Export format')).toHaveValue('html');
      await exportAction.focus();
    }
    await page.keyboard.press('F10');
    await openQuickExport();
    await chooseDestination();
    await expect(exportAction).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();
    expect(await readdir(root)).not.toContain(path.basename(output));
    await openQuickExport();
    await chooseDestination(root);
    await expect(file).toBeFocused();
    await expect.poll(async () => readFile(path.join(output, 'index.html'), 'utf8')).toContain('<!doctype html>');
    const quick = await readFile(path.join(output, 'data', 'animation.js'), 'utf8');
    expect(JSON.parse(quick.trim().slice('globalThis.animation = '.length, -1)).layers[0].keys[0].shapes[0])
      .toMatchObject({ x: 151, fill: '#ff0000' });
    expect(quick).not.toContain('unexpectedNativeExportScript');

    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('button', { name: 'Export…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const exporter = page.getByRole('dialog', { name: 'Export', exact: true });
    const format = exporter.getByLabel('Export format', { exact: true });
    const action = exporter.getByRole('button', { name: 'Export HTML animation…', exact: true });
    await expect(format).toBeFocused();
    await format.selectOption('html');
    await action.focus();
    await chooseDestination();
    await expect(action).toBeFocused();
    await expect(format).toHaveValue('html');
    expect(await readdir(secondParent)).not.toContain(exportName);
    await chooseDestination(secondParent);
    await expect(exporter).toHaveCount(0);
    await expect(file).toBeFocused();
    expect(await readFile(path.join(secondParent, exportName, 'data', 'animation.js'), 'utf8')).toBe(quick);
    expect(await projectSnapshot(page)).toEqual(draft);
    expect(await loadProject(store)).toEqual(before);
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows audio import retains keyboard focus and persists WAV, MP3 and Opus assets', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary || !license, 'Requires the packaged Windows editor and fixture license.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-wav-keys-'));
  let app: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const project = newProject(fixtureName), folder = path.join(root, project.name + '.spl');
    await mkdir(folder);
    await saveProject(new NodeDirectoryStore(folder), project, null);
    app = await launchNative(playwright.chromium, root, 'wav-keys');
    const { page } = app;
    await page.getByRole('button', { name: 'Open editor', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Register…', exact: true }).click();
    const registration = page.getByRole('dialog', { name: 'Register Splash Animator', exact: true });
    await registration.getByLabel('Signed license code').fill(await readFile(license!, 'utf8'));
    await registration.getByRole('button', { name: 'Register license', exact: true }).click();
    await expect(registration.getByRole('status')).toContainText('License registered.');
    await page.keyboard.press('Escape');
    await openNativeProject(app, folder);
    const control = page.getByRole('button', { name: 'Control', exact: true });
    const open = async () => {
      await control.click();
      await page.getByRole('button', { name: 'Import audio...', exact: true }).press('Enter');
    };
    const dialog = page.getByRole('dialog', { name: 'Import audio', exact: true });
    const input = dialog.getByLabel('Audio file');
    const action = dialog.getByRole('button', { name: 'Import audio asset', exact: true });
    const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const before = await recovery();
    await open();
    await expect(input).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(control).toBeFocused();
    expect(await recovery()).toBe(before);
    await open();
    await input.setInputFiles({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(44) });
    await action.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('RIFF');
    await expect(action).toBeFocused();
    expect(await recovery()).toBe(before);
    const bytes = Buffer.from(pcm16WavFixture([[0, 16384, -32768]]));
    await input.setInputFiles({ name: 'keyboard.wav', mimeType: 'audio/wav', buffer: bytes });
    await action.press('Enter');
    await expect(dialog.getByRole('status')).toContainText('Audio asset imported.');
    await expect(input).toBeFocused();
    const after = await projectSnapshot(page);
    expect(after.audioClips).toBeUndefined();
    expect(after.assets).toHaveLength(1);
    expect(after.assets[0].audio?.frames).toBe(3);
    expect(await readFile(path.join(folder, after.assets[0].path))).toEqual(bytes);
    await page.keyboard.press('Escape');
    await expect(control).toBeFocused();
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
    await expect.poll(() => projectSnapshot(page)).toEqual(project);
    await open();
    for (const [extension, channels] of [['mp3', 1], ['opus', 2]] as const) {
      const source = await readFile(new URL(`../fixtures/import-tone.${extension}`, import.meta.url));
      await input.setInputFiles({
        name: `keyboard.${extension}`,
        mimeType: extension === 'mp3' ? 'audio/mpeg' : 'audio/ogg',
        buffer: source,
      });
      await action.press('Enter');
      await expect(dialog.getByRole('status')).toContainText('Audio asset imported.');
      const imported = (await projectSnapshot(page)).assets.at(-1)!;
      expect(imported.audio).toMatchObject({
        name: `keyboard.${extension}`, format: 'pcm16-wav', frames: 11520, channels, sampleRate: 48000,
      });
      const wave = await readFile(path.join(folder, imported.path));
      expect(wave.toString('ascii', 0, 12)).toMatch(/^RIFF....WAVE$/s);
      expect(wave.readUInt32LE(40)).toBe(11520 * channels * 2);
    }
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows desktop FFmpeg restores keyboard focus after cancelling its native file picker', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary || !license, 'Requires the packaged Windows editor and fixture license.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-ffmpeg-keys-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    current = await launchNative(playwright.chromium, root, 'ffmpeg-keys');
    const { page, owner } = current;
    await page.getByRole('button', { name: 'Open editor', exact: true }).press('Enter');
    const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
    await menu.getByRole('button', { name: 'Help', exact: true }).click();
    await menu.getByRole('button', { name: 'Register…', exact: true }).click();
    const register = page.getByRole('dialog', { name: 'Register Splash Animator', exact: true });
    const code = register.getByLabel('Signed license code');
    if (await code.isVisible()) {
      await code.fill(await readFile(license!, 'utf8'));
      await register.getByRole('button', { name: 'Register license', exact: true }).click();
      await expect(register.getByRole('status')).toContainText('License registered.');
    }
    await page.keyboard.press('Escape');
    await expect(register).toHaveCount(0);
    await page.getByRole('button', { name: 'Add layer', exact: true }).click();
    const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const before = await recovery();
    expect(before).not.toBeNull();

    const file = menu.getByRole('button', { name: 'File', exact: true });
    await file.click();
    await menu.getByRole('button', { name: 'Export…', exact: true }).press('Enter');
    const exporter = page.getByRole('dialog', { name: 'Export', exact: true });
    await exporter.getByLabel('Export format').selectOption('ffmpeg');
    const launch = exporter.getByRole('button', { name: 'Encode extracted FFmpeg input bundle…', exact: true });
    await launch.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Encode FFmpeg input bundle', exact: true });
    await expect(dialog.getByLabel('Desktop video format')).toBeFocused();
    await page.keyboard.press('Tab');
    const start = dialog.getByRole('button', { name: 'Choose files and encode…', exact: true });
    await expect(start).toBeFocused();
    await Promise.all([
      selectFolder(owner, 'Choose the extracted ffmpeg.json'),
      page.keyboard.press('Enter'),
    ]);
    await expect(dialog.getByRole('status')).toHaveText('FFmpeg export cancelled.');
    await expect(start).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(launch).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();
    expect(await recovery()).toBe(before);
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows accessibility tree exposes timeline navigation and the current position', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-timeline-accessibility-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const project = newProject();
    project.duration = 120;
    project.layers[0].name = 'Artwork';
    project.layers.push(newLayer('Ink'));
    current = await launchNative(playwright.chromium, root, 'timeline-accessibility', async page => {
      await page.addInitScript(project => localStorage.setItem(
        'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
      ), project);
    });
    const { page } = current;
    await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    const status = page.locator('#timeline-panel-position');
    const session = await page.context().newCDPSession(page);
    await session.send('Accessibility.enable');
    async function accessibleNode(selector: string) {
      const { root } = await session.send('DOM.getDocument');
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { nodes } = await session.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      return nodes[0];
    }
    const scrollbar = page.getByRole('scrollbar', { name: 'Timeline scroll', exact: true });
    const scrollbarNode = () => accessibleNode('[role="scrollbar"][aria-label="Timeline scroll"]');
    const positionText = async () => (await scrollbarNode()).description?.value;
    await expect(scrollbar).toHaveAccessibleDescription('First visible frame 1');
    const initialScrollbar = await scrollbarNode();
    expect(initialScrollbar.role?.value).toBe('scrollbar');
    expect(initialScrollbar.properties?.find(property => property.name === 'controls')?.value.relatedNodes)
      .toEqual([expect.objectContaining({ idref: 'timeline-panel' })]);
    await expect.poll(positionText).toBe('First visible frame 1');
    await scrollbar.press('ArrowRight');
    await expect(scrollbar).toBeFocused();
    await expect.poll(positionText).toBe('First visible frame 2');
    expect((await scrollbarNode()).value?.value).toBe(1);
    await scrollbar.press('Home');
    await expect.poll(positionText).toBe('First visible frame 1');
    await timeline.focus();
    await expect(status).toHaveAttribute('aria-live', 'polite');
    const initial = await accessibleNode('canvas[aria-label="Timeline frames"]');
    expect(initial.name?.value).toBe('Timeline frames');
    expect(initial.description?.value).toMatch(/Frame 1 of 120\. Layer Artwork\..*Left and Right.*Up and Down/);
    const live = await accessibleNode('#timeline-panel-position');
    expect(live.role?.value).toBe('status');
    expect(live.properties?.find(property => property.name === 'live')?.value.value).toBe('polite');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await expect(status).toHaveText('Frame 2 of 120. Layer Ink.');
    await expect.poll(async () => (await accessibleNode('canvas[aria-label="Timeline frames"]')).description?.value)
      .toContain('Frame 2 of 120. Layer Ink.');
    await expect(timeline).toBeFocused();

    await page.getByRole('button', { name: 'Play animation', exact: true }).click();
    await timeline.focus();
    await expect(page.getByRole('button', { name: 'Stop playback', exact: true })).toBeVisible();
    await expect(status).toHaveAttribute('aria-live', 'off');
    await expect(status).not.toHaveText('Frame 2 of 120. Layer Ink.');
    await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
    await expect(status).toHaveAttribute('aria-live', 'off');
    await timeline.focus();
    await page.keyboard.press('End');
    await expect(status).toHaveText('Frame 120 of 120. Layer Ink.');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await page.getByRole('button', { name: 'First frame', exact: true }).press('Enter');
    await expect(status).toHaveText('Frame 1 of 120. Layer Ink.');
    await page.getByRole('button', { name: 'Last frame', exact: true }).press('Enter');
    await expect(status).toHaveText('Frame 120 of 120. Layer Ink.');
    await expect(page.getByRole('button', { name: 'Move layer up', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move layer down', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove keyframe', exact: true })).toBeVisible();
    expect(await projectSnapshot(page)).toEqual(project);
    await session.detach();
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows drawing controls work from the keyboard without changing artwork', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-tool-keys-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const project = newProject();
    project.layers[0].drawingMode = 'object';
    project.layers[0].keys[0].shapes = [{
      id: 'keyboard-selection',
      kind: 'rectangle',
      x: 40,
      y: 35,
      width: 60,
      height: 45,
      rotation: 0,
      fill: '#e63122',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    }];
    current = await launchNative(playwright.chromium, root, 'tool-keys', async page => {
      await page.addInitScript(project => localStorage.setItem(
        'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
      ), project);
    });
    const { page } = current;
    await expect(page.getByRole('button', { name: 'Open editor', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await stage.focus();
    await page.keyboard.press('Control+a');
    await expect(page.getByLabel('Selected fill', { exact: true })).toBeVisible();
    const before = await projectSnapshot(page);
    const palette = page.getByRole('complementary', { name: 'Drawing tools', exact: true });
    const brush = palette.getByRole('button', { name: 'Brush', exact: true });
    const pencil = palette.getByRole('button', { name: 'Pencil', exact: true });
    await brush.focus();
    await page.keyboard.press('Enter');
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(pencil).toBeFocused();
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(pencil).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(stage).toBeFocused();
    await page.keyboard.press('b');
    await expect(brush).toHaveAttribute('aria-pressed', 'true');

    const zoom = page.getByRole('combobox', { name: 'Zoom', exact: true });
    await zoom.focus();
    await page.keyboard.press('End');
    await expect(zoom).toHaveValue('20');
    await expect(zoom.getByRole('option', { name: '2000%', exact: true })).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect(zoom).toHaveValue('16');
    await page.keyboard.press('Tab');
    const simplify = page.getByRole('slider', { name: 'Brush simplify slider', exact: true });
    await expect(simplify).toBeFocused();
    const smoothing = Number(await simplify.inputValue());
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Brush simplify amount', exact: true }))
      .toHaveValue(String(smoothing + 1));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const optimize = page.getByRole('checkbox', { name: 'Brush optimize', exact: true });
    await expect(optimize).toBeFocused();
    const optimized = await optimize.isChecked();
    await page.keyboard.press('Space');
    expect(await optimize.isChecked()).toBe(!optimized);
    await page.getByRole('button', { name: 'Fit', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(16);
    await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
    expect(await projectSnapshot(page)).toEqual(before);
    expect(await projectSnapshot(page)).toEqual(project);
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows stage and timeline repaint when only display scale changes', async ({ playwright }) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-display-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    current = await launchNative(playwright.chromium, root, 'display');
    const { page } = current;
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const bounds = (await stage.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2 - 35, bounds.y + bounds.height / 2 - 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 35, bounds.y + bounds.height / 2 + 30, {
      steps: 5,
    });
    await page.mouse.up();

    const display = () => page.evaluate(() => {
      const stage = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Drawing stage"]')!;
      const timeline = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Timeline frames"]')!;
      const pixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
        [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
      return {
        ratio: window.devicePixelRatio,
        client: [innerWidth, innerHeight],
        layout: [stage.clientWidth, stage.clientHeight, timeline.clientWidth, timeline.clientHeight],
        backing: [stage.width, stage.height, timeline.width, timeline.height],
        paint: pixel(stage, Math.floor(stage.width / 2), Math.floor(stage.height / 2)),
        rail: pixel(timeline, Math.round(devicePixelRatio * 12), Math.round(devicePixelRatio * 32)),
      };
    });
    await expect.poll(async () => (await display()).paint).not.toEqual([255, 255, 255, 255]);
    const baseline = await display();
    const webglRenderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    });
    console.log(
      `Native display DPR ${baseline.ratio} · layout ${baseline.layout.join(' × ')} · backing ${baseline.backing.join(' × ')} · WebGL ${webglRenderer}`,
    );
    expect(baseline.paint[3]).toBe(255);
    expect(baseline.rail[3]).toBe(255);
    await expect
      .poll(() => page.evaluate(() => !!localStorage.getItem('splash-recovery-v1')))
      .toBe(true);
    const project = await projectSnapshot(page);
    expect(project.layers[0].keys[0].shapes.map((shape) => shape.kind)).toEqual(['polygon', 'path']);

    const session = await page.context().newCDPSession(page);
    const ratio = baseline.ratio * 2;
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: baseline.client[0],
      height: baseline.client[1],
      deviceScaleFactor: ratio,
      mobile: false,
    });
    await expect.poll(async () => {
      const resized = await display();
      return { ratio: resized.ratio, layout: resized.layout, backing: resized.backing };
    }).toEqual({
      ratio,
      layout: baseline.layout,
      backing: baseline.layout.map((dimension) => Math.round(dimension * ratio)),
    });
    const resized = await display();
    expect(resized.paint).toEqual(baseline.paint);
    expect(resized.rail).toEqual(baseline.rail);
    expect(await projectSnapshot(page)).toEqual(project);

    await session.send('Emulation.clearDeviceMetricsOverride');
    await expect.poll(display).toEqual(baseline);
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows host renders a masked gradient, text and onion skin through editing and Undo', async ({
  playwright,
}) => {
  test.skip(process.platform !== 'win32' || !binary, 'Requires the packaged Windows editor.');
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-render-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const project = newProject();
    Object.assign(project, { width: 500, height: 300, duration: 3 });
    const rect = (
      id: string,
      x: number,
      y: number,
      width: number,
      height: number,
      fill: string,
    ): Vector => ({
      id,
      kind: 'rectangle',
      x,
      y,
      width,
      height,
      fill,
      stroke: '#000000',
      strokeWidth: 0,
      rotation: 0,
      points: [],
    });
    const paint = project.layers[0];
    paint.drawingMode = 'object';
    paint.keys[0].shapes = [
      {
        ...rect('gradient', 50, 55, 200, 90, '#ff0000'),
        gradient: {
          kind: 'linear',
          from: { x: 0, y: 0 },
          to: { x: 200, y: 0 },
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' },
          ],
        },
      },
    ];
    const mask = newLayer('Stencil');
    mask.outline = false;
    mask.keys[0].shapes = [rect('mask', 65, 55, 160, 90, '#ffffff')];
    const ghost = newLayer('Ghost');
    ghost.keys = [
      { frame: 0, shapes: [rect('ghost', 75, 205, 50, 55, '#00ff00')] },
      { frame: 1, shapes: [] },
    ];
    const text = newLayer('Caption');
    text.drawingMode = 'object';
    text.keys[0].shapes = [
      {
        ...rect('caption', 300, 105, 140, 39, '#000000'),
        kind: 'text',
        text: {
          content: 'HH',
          font: 'monospace',
          size: 32,
          bold: false,
          italic: false,
          align: 'left',
        },
      },
    ];
    project.layers.push(mask, ghost, text);
    project.layerMasks = [{ maskLayerId: mask.id, layerIds: [paint.id] }];

    current = await launchNative(playwright.chromium, root, 'host-render', async (page) => {
      await page.addInitScript(
        (project) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project, folder: null, manifest: null }),
          ),
        project,
      );
    });
    const { page } = current;
    await page.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const stage = page.getByLabel('Drawing stage', { exact: true });
    await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 27, y: 12 } });
    await page.getByText('Onion skin settings', { exact: true }).click();
    await page.getByLabel('Onion opacity', { exact: true }).fill('50');
    const onion = page.getByLabel('Enable onion skin', { exact: true });
    await page.getByRole('button', { name: 'Collapse Properties sidebar', exact: true }).click();
    await expect.poll(() => stage.evaluate(canvas => canvas.clientWidth)).toBeGreaterThan(440);
    const white = [255, 255, 255, 255];
    const probes: [number, number][] = [
      [95, 90],
      [200, 90],
      [238, 90],
      [100, 230],
    ];
    await expect.poll(async () => (await sampleArtwork(page, probes))[3]).toEqual(white);
    const original = await sampleArtwork(page, probes);
    expect(original[0][0]).toBeGreaterThan(185);
    expect(original[0][2]).toBeLessThan(70);
    expect(original[1][2]).toBeGreaterThan(180);
    expect(original[1][0]).toBeLessThan(75);
    expect(original[2]).toEqual(white);
    const outline = page.getByRole('button', { name: 'Toggle outline Stencil', exact: true });
    await outline.click();
    await expect.poll(async () => (await sampleArtwork(page, probes))[2][2]).toBeGreaterThan(220);
    await expect.poll(async () => (await sampleArtwork(page, probes))[2][0]).toBeLessThan(30);
    await outline.click();
    await expect.poll(() => sampleArtwork(page, probes)).toEqual(original);

    const toggle = page.getByRole('button', { name: 'Onion skin', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(onion).toBeChecked();
    await expect
      .poll(async () => (await sampleArtwork(page, probes))[3])
      .toEqual([127, 255, 127, 255]);
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(onion).not.toBeChecked();
    await expect.poll(() => sampleArtwork(page, probes)).toEqual(original);
    expect(await projectSnapshot(page)).toEqual(project);

    const textCoverage = () =>
      stage.evaluate((canvas: HTMLCanvasElement) => {
        const scale = devicePixelRatio;
        const data = canvas
          .getContext('2d')!
          .getImageData(
            Math.round(canvas.width / 2 + 45 * scale),
            Math.round(canvas.height / 2 - 44 * scale),
            Math.round(105 * scale),
            Math.round(41 * scale),
          ).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 64 && data[i + 1] < 64 && data[i + 2] < 64) dark++;
        return dark;
      });
    const originalText = await textCoverage();
    expect(originalText).toBeGreaterThan(50);
    await page
      .getByRole('group', { name: 'Layer row Caption', exact: true })
      .locator('button.layer-name')
      .click();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const box = (await stage.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2 + 65, box.y + box.height / 2 - 25);
    const input = page.getByRole('textbox', { name: 'Edit text on canvas', exact: true });
    await expect(input).toHaveValue('HH');
    await input.press('Control+a');
    await page.keyboard.insertText('HHHH');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect.poll(textCoverage).toBeGreaterThan(originalText * 1.7);
    const changed = await projectSnapshot(page);
    expect(changed.layerMasks).toEqual(project.layerMasks);
    expect(changed.layers.slice(0, 3)).toEqual(project.layers.slice(0, 3));
    expect(changed.layers[3].keys[0].shapes[0].text?.content).toBe('HHHH');
    await stage.press('Control+z');
    await expect.poll(() => projectSnapshot(page)).toEqual(project);
    await expect.poll(textCoverage).toBe(originalText);
    const displays = await page.evaluate(async () => {
      const native = (
        window as unknown as Window & {
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const monitors = (await native.invoke('plugin:window|available_monitors')) as Array<{
        size: { width: number; height: number };
        scaleFactor: number;
      }>;
      return {
        current: devicePixelRatio,
        displays: monitors.map(({ size, scaleFactor }) => ({ ...size, scaleFactor })),
      };
    });
    console.log('Native render workflow display scales:', JSON.stringify(displays));
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('Windows authoring saves and exports the drawn nested tween from the reopened project', async ({ playwright }, testInfo) => {
  test.skip(process.platform !== 'win32' || !binary || !license,
    'Requires the isolated signed Windows release build and its fixture license.');
  const root = testInfo.outputPath('integrated-output');
  await mkdir(root, { recursive: true });
  const original = newProject();
  Object.assign(original, { width: 500, height: 300, duration: 12, fps: 4 });
  original.layers[0].drawingMode = 'object';
  const profile = await mkdtemp(path.join(root, 'integrated-webview-'));
  const current = await launchNative(playwright.chromium, root, path.basename(profile), async page => {
    await page.addInitScript(project => {
      if (!sessionStorage.getItem('integrated-seeded')) {
        localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
        sessionStorage.setItem('integrated-seeded', '1');
      }
    }, original);
  });
  try {
    const { page, owner } = current;
    const toolbar = (name: string) => page.getByRole('button', { name, exact: true });
    const stage = page.getByLabel('Drawing stage', { exact: true });
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    await toolbar('Open editor').click();
    await toolbar('Recover changes').click();
    await toolbar('Help').click();
    await toolbar('Register…').click();
    const register = page.getByRole('dialog', { name: 'Register Splash Animator' });
    const code = register.getByLabel('Signed license code');
    if (await code.isVisible()) {
      await code.fill(await readFile(license!, 'utf8'));
      await register.getByRole('button', { name: 'Register license', exact: true }).click();
      await expect(register.getByRole('status')).toContainText('License registered.');
    }
    await register.getByRole('button', { name: 'Close Register', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const point = async (x: number, y: number) => {
      const bounds = (await stage.boundingBox())!;
      return { x: bounds.x + bounds.width / 2 + x - 250, y: bounds.y + bounds.height / 2 + y - 150 };
    };
    const a = await point(70, 80), b = await point(110, 120), center = await point(90, 100);
    const drawTile = async () => {
      await toolbar('Rectangle').click();
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.mouse.up();
      await toolbar('Selection').click();
      await page.mouse.click(center.x, center.y);
    };
    await drawTile();
    await expect.poll(async () => (await projectSnapshot(page)).layers[0].keys[0].shapes.length).toBe(1);
    await page.getByLabel('Selected fill', { exact: true }).fill('#168acc');
    await page.getByLabel('Selected stroke', { exact: true }).fill('#ab300e');
    await page.getByLabel('Stroke width', { exact: true }).fill('6');
    await page.getByLabel('Stroke width', { exact: true }).press('Tab');
    const painted = (await projectSnapshot(page)).layers[0].keys[0].shapes[0];
    expect(painted).toMatchObject({ fill: '#168acc', stroke: '#ab300e', strokeWidth: 6 });
    const framePixels = [[22, 138, 204, 255], [171, 48, 14, 255]];
    const probes: [number, number][] = [
      [Math.floor(painted.x + painted.width / 2), Math.floor(painted.y + painted.height / 2)],
      [Math.round(painted.x + 1), Math.floor(painted.y + painted.height / 2)],
    ];
    const empty = await point(300, 180);
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => sampleArtwork(page, probes)).toEqual(framePixels);
    await page.mouse.click(center.x, center.y);

    const convert = async (name: string) => {
      await toolbar('Edit').click();
      await toolbar('Convert to symbol…').click();
      const dialog = page.getByRole('dialog', { name: 'Convert selection to symbol', exact: true });
      await dialog.getByLabel('Symbol name').fill(name);
      await dialog.getByRole('button', { name: 'Convert selection', exact: true }).click();
      await expect(dialog, `Convert ${name}`).toHaveCount(0).catch(async cause => {
        throw Error(`Conversion for ${name}: ${await dialog.getByRole('alert').allTextContents()}`, { cause });
      });
    };
    await convert('Painted tile');
    await stage.press('Delete');
    await drawTile();
    await convert('Animated container');
    await page.mouse.dblclick(center.x, center.y);
    const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
    await expect(crumbs).toContainText('Animated container');
    await stage.press('Control+a');
    await stage.press('Delete');
    await page.getByRole('option', { name: 'Library item Painted tile', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Place symbol', exact: true }).click();
    await stage.press('Control+a');
    for (const axis of ['X', 'Y']) {
      const field = page.getByLabel(`Shape ${axis}`, { exact: true });
      await field.fill('0');
      await field.press('Tab');
    }
    const frameMenu = async (at: number, label: string) => {
      await timeline.click({ button: 'right', position: { x: at * 18 + 8, y: 40 } });
      await page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    await frameMenu(0, 'Convert to motion tween');
    await frameMenu(6, 'Insert keyframe');
    await stage.press('Control+a');
    const x = page.getByLabel('Shape X', { exact: true });
    const originalX = Number(await x.inputValue());
    await x.fill(String(originalX + 120));
    await x.press('Tab');
    await crumbs.getByRole('button', { name: 'Scene 1', exact: true }).click();
    await expect(crumbs).toHaveCount(0);
    const authored = await projectSnapshot(page);
    const outer = authored.symbols!.find(symbol => symbol.name === 'Animated container')!;
    const leaf = authored.symbols!.find(symbol => symbol.name === 'Painted tile')!;
    const tracks = [
      { keys: [{ frame: 0, shapes: outer.shapes }, ...outer.timeline?.keys ?? []], motionSpans: outer.timeline?.motionSpans },
      ...outer.timeline?.layers ?? [],
    ];
    const animated = tracks.find(track => track.keys.some(key => key.frame === 0 && key.shapes.some(shape => shape.symbolId === leaf.id)));
    expect(animated?.keys[0].shapes[0]).toMatchObject({ kind: 'symbol', symbolId: leaf.id, x: originalX });
    expect(animated?.motionSpans?.map(({ start, end }) => [start, end])).toEqual([[0, 6]]);
    expect(animated?.keys.find(key => key.frame === 3)?.shapes[0].x).toBeCloseTo(originalX + 60);
    expect(leaf.shapes[0]).toMatchObject({ fill: painted.fill, stroke: painted.stroke, strokeWidth: 6 });

    const poses = [0, 3, 6].map(at => ({
      at,
      pixels: [
        ...probes.map(([x, y]): [number, number] => [x + at * 20, y]),
        [probes[0][0] + (at === 0 ? 120 : 0), probes[0][1]] as [number, number],
      ],
    }));
    const posePixels = [...framePixels, [255, 255, 255, 255]];
    const verifyStageFrames = async () => {
      for (const { at, pixels } of poses) {
        await timeline.click({ position: { x: at * 18 + 8, y: 10 } });
        await expect(timeline).toHaveAccessibleDescription(new RegExp(`Frame ${at + 1} of 12`));
        await expect.poll(() => sampleArtwork(page, pixels)).toEqual(posePixels);
      }
    };
    await verifyStageFrames();
    await timeline.press('Home');
    await stage.press('Enter');
    await expect(timeline).toHaveAccessibleDescription(/Frame [4-6] of 12/);
    await stage.press('Enter');
    expect(await projectSnapshot(page)).toEqual(authored);

    await toolbar('File').click();
    await toolbar('Save As / duplicate…').click();
    await page.getByLabel('Project name').fill(fixtureName);
    await Promise.all([
      selectFolder(owner, 'Choose parent folder for new .spl project', root),
      toolbar('Save project folder').click(),
    ]);
    const savedPath = path.join(root, fixtureName + '.spl');
    const store = new NodeDirectoryStore(savedPath);
    await expect.poll(() => store.exists('project.json')).toBe(true);
    const saved = await loadProject(store);
    expect(saved.missingAssets).toEqual([]);
    expect(saved.project).toEqual({ ...authored, name: fixtureName });
    await expect(page.locator('.status-message').first()).toContainText('Saved ');
    await toolbar('Close ' + fixtureName).click();
    await expect(toolbar('Close ' + fixtureName)).toHaveCount(0);
    await openNativeProject(current, savedPath);
    await verifyStageFrames();

    const exportName = fixtureName.replace(/ /g, '-') + '-web';
    const title = `Choose where to create ${exportName}`;
    const output = path.join(root, exportName, 'index.html');
    const exportHTML = async (folder?: string) => {
      const settings = page.getByRole('dialog', { name: 'Export', exact: true });
      if (!(await settings.isVisible())) {
        await toolbar('File').click();
        await toolbar('Export HTML animation…').click();
      }
      await expect(settings.getByLabel('Export format')).toHaveValue('html');
      await Promise.all([
        selectFolder(owner, title, folder),
        settings.getByRole('button', { name: 'Export HTML animation…', exact: true }).click(),
      ]);
    };
    await exportHTML();
    await expect.poll(() => readFile(output).then(() => true, () => false)).toBe(false);
    await exportHTML(root);
    await expect(page.locator('.status-message').first()).toContainText('Exported web folder');
    expect(await loadProject(store)).toEqual(saved);

    const player = await playwright.chromium.launch();
    try {
      const playback = await player.newPage();
      await playback.addInitScript(() => {
        const native = requestAnimationFrame;
        (window as typeof window & { frameTime: number }).frameTime = 1000;
        window.requestAnimationFrame = callback => native(() =>
          callback((window as typeof window & { frameTime: number }).frameTime));
      });
      await playback.goto(pathToFileURL(output).href);
      const canvas = playback.locator('canvas');
      for (const { at, pixels } of poses) {
        await playback.evaluate(at => {
          (window as typeof window & { frameTime: number }).frameTime = 1000 + at * 250 + 1;
        }, at);
        await expect.poll(() => canvas.evaluate((canvas: HTMLCanvasElement, pixels) => {
          const context = canvas.getContext('2d')!;
          return pixels.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
        }, pixels)).toEqual(posePixels);
      }
    } finally {
      await player.close();
    }
  } finally {
    await current.close();
  }
});

test('Windows project folders save, reopen and recover edited nested artwork', async ({
  playwright,
}) => {
  test.skip(
    process.platform !== 'win32' || !binary || !license,
    'Requires the isolated signed Windows release build and its fixture license.',
  );
  const root = await mkdtemp(path.join(tmpdir(), 'splash-native-project-'));
  let current: Awaited<ReturnType<typeof launchNative>> | undefined;
  try {
    const initial = await launchNative(playwright.chromium, root, 'webview');
    current = initial;
    const { page } = initial;
    const stage = page.getByLabel('Drawing stage', { exact: true });
    const splash = page.getByRole('dialog', { name: 'Splash Animator startup' });
    await splash.getByRole('button', { name: 'Open editor', exact: true }).click();
    const bitmap = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#228fe6';
      ctx.fillRect(0, 0, 1, 1);
      return canvas.toDataURL();
    });
    await page.evaluate(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      fixture(bitmap),
    );
    await page.reload();
    await splash.getByRole('button', { name: 'Open editor', exact: true }).click();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();

    const openMenu = (name: string) => page.getByRole('button', { name, exact: true }).click();
    await openMenu('Help');
    await page.getByRole('button', { name: 'Register…', exact: true }).click();
    const register = page.getByRole('dialog', { name: 'Register Splash Animator' });
    const code = register.getByLabel('Signed license code');
    if (await code.isVisible()) {
      await code.fill(await readFile(license!, 'utf8'));
      await register.getByRole('button', { name: 'Register license', exact: true }).click();
      await expect(register.getByRole('status')).toContainText('License registered.');
    }
    await register.getByRole('button', { name: 'Close Register', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');

    async function canvasPoint(x: number, y: number) {
      const box = (await stage.boundingBox())!;
      return { x: box.x + box.width / 2 + x - 250, y: box.y + box.height / 2 + y - 150 };
    }
    const artwork = await canvasPoint(90, 90);
    await page.mouse.dblclick(artwork.x, artwork.y);
    const crumbs = page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' });
    await expect(crumbs).toContainText('Outer artwork');
    await page.mouse.dblclick(artwork.x, artwork.y);
    await expect(crumbs).toContainText('Nested artwork');

    const timeline = page.getByLabel('Timeline frames', { exact: true });
    await timeline.click({ button: 'right', position: { x: 8, y: 40 } });
    await page.getByRole('menuitem', { name: 'Convert to motion tween', exact: true }).click();
    await crumbs.getByRole('button', { name: 'Scene 1', exact: true }).click();
    await expect(crumbs).toHaveCount(0);

    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const from = await canvasPoint(240, 120),
      to = await canvasPoint(305, 175);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const points: [number, number][] = [
      [90, 90],
      [275, 145],
    ];
    const pixels = await sampleArtwork(page, points);
    expect(pixels[0]).toEqual([230, 49, 34, 255]);
    expect(pixels[1]).not.toEqual([255, 255, 255, 255]);
    const edited = await projectSnapshot(page);
    expect(edited.layers[0].keys[0].shapes).toHaveLength(2);
    const nested = edited.symbols?.find((symbol) => symbol.id === 'native-inner');
    expect(nested?.timeline?.motionSpans).toHaveLength(1);

    await openMenu('File');
    await page.getByRole('button', { name: 'Save As / duplicate…', exact: true }).click();
    await page.getByLabel('Project name').fill(fixtureName);
    await Promise.all([
      selectFolder(initial.owner, 'Choose parent folder for new .spl project', root),
      page.getByRole('button', { name: 'Save project folder', exact: true }).click(),
    ]);
    const savedPath = path.join(root, fixtureName + '.spl');
    const store = new NodeDirectoryStore(savedPath);
    await expect.poll(() => store.exists('project.json')).toBe(true);
    const saved = await loadProject(store);
    expect(saved.missingAssets).toEqual([]);
    expect(saved.project).toEqual({ ...edited, name: fixtureName });

    await page.getByRole('button', { name: 'Close ' + fixtureName, exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Close ' + fixtureName, exact: true }),
    ).toHaveCount(0);

    await openNativeProject(initial, savedPath);
    expect(await loadProject(store)).toEqual(saved);
    await expect.poll(() => sampleArtwork(page, points)).toEqual(pixels);

    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    const editable = await canvasPoint(275, 145);
    await page.mouse.click(editable.x, editable.y);
    const fill = page.getByLabel('Selected fill', { exact: true });
    await expect(fill).toBeVisible();
    await fill.fill('#00aa44');
    const unsaved = await projectSnapshot(page);
    const [layer] = saved.project.layers;
    const [key] = layer.keys;
    const [symbol, rectangle] = key.shapes;
    expect(unsaved).toEqual({
      ...saved.project,
      layers: [
        { ...layer, keys: [{ ...key, shapes: [symbol, { ...rectangle, fill: '#00aa44' }] }] },
      ],
    });
    const empty = await canvasPoint(180, 90);
    await page.mouse.click(empty.x, empty.y);
    await expect(fill).toHaveCount(0);
    const unsavedPixels = [pixels[0], [0, 170, 68, 255]];
    await expect.poll(() => sampleArtwork(page, points)).toEqual(unsavedPixels);
    await expect(page.locator('.status-message').first()).toContainText('Recovery snapshot saved', {
      timeout: 25_000,
    });
    const autosaved = await loadProject(store, true);
    expect(autosaved.project).toEqual(unsaved);
    expect(autosaved.missingAssets).toEqual([]);
    expect(await loadProject(store)).toEqual(saved);
    await initial.close(true);
    current = undefined;

    current = await launchNative(playwright.chromium, root, 'fresh-recovery-webview');
    const fresh = current.page;
    await fresh
      .getByRole('dialog', { name: 'Splash Animator startup' })
      .getByRole('button', { name: 'Open editor', exact: true })
      .click();
    const recover = fresh.getByRole('button', { name: 'Recover changes', exact: true });
    await expect(recover).toHaveCount(0);
    await openNativeProject(current, savedPath);
    await expect(recover).toBeVisible();
    await expect.poll(() => sampleArtwork(fresh, points)).toEqual(pixels);
    await recover.click();
    await expect(fresh.locator('.status-message').first()).toContainText('Recovered changes');
    await expect(recover).toHaveCount(0);
    await expect.poll(() => sampleArtwork(fresh, points)).toEqual(unsavedPixels);
    expect(await projectSnapshot(fresh)).toEqual(unsaved);
    expect(await loadProject(store)).toEqual(saved);

    await fresh.getByLabel('Drawing stage', { exact: true }).press('Control+s');
    await expect.poll(async () => (await loadProject(store)).project).toEqual(unsaved);

    const committed = await loadProject(store);
    const originalFolder = path.join(root, 'parked-original.spl');
    const replacementFolder = path.join(root, 'parked-replacement.spl');
    await rename(savedPath, originalFolder);
    await cp(originalFolder, savedPath, { recursive: true, errorOnExist: true, force: false });
    const unrelated = path.join(savedPath, 'unrelated-artwork.txt');
    await writeFile(unrelated, 'replacement artwork', { flag: 'wx' });

    await fresh.getByRole('button', { name: 'Selection', exact: true }).click();
    const freshStage = fresh.getByLabel('Drawing stage', { exact: true });
    const bounds = (await freshStage.boundingBox())!;
    await fresh.mouse.click(bounds.x + bounds.width / 2 + 25, bounds.y + bounds.height / 2 - 5);
    const changedFill = fresh.getByLabel('Selected fill', { exact: true });
    await changedFill.fill('#4444dd');
    const changed = await projectSnapshot(fresh);
    expect(changed.layers[0].keys[0].shapes[1].fill).toBe('#4444dd');

    const rejectedAudio = await fresh.evaluate(async () => {
      const { folder } = JSON.parse(localStorage.getItem('splash-recovery-v1')!);
      const native = (
        window as unknown as Window & {
          __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      try {
        await native.invoke('project_audio_read', {
          owner: { project: folder, path: 'assets/audio/test.wav' },
        });
        return '';
      } catch (error) {
        return String(error);
      }
    });
    expect(rejectedAudio).toContain('Project folder changed on disk');
    await freshStage.press('Control+s');
    await expect(fresh.getByText(/Project folder changed on disk/).first()).toBeVisible();
    expect(await loadProject(store)).toEqual(committed);
    expect(await readFile(unrelated, 'utf8')).toBe('replacement artwork');

    await rename(savedPath, replacementFolder);
    await rename(originalFolder, savedPath);
    await freshStage.press('Control+s');
    await expect.poll(async () => (await loadProject(store)).project).toEqual(changed);

    await rename(savedPath, originalFolder);
    await rename(replacementFolder, savedPath);
    await fresh.getByRole('button', { name: 'Close ' + fixtureName, exact: true }).click();
    await expect(
      fresh.getByRole('button', { name: 'Close ' + fixtureName, exact: true }),
    ).toHaveCount(0);
    await openNativeProject(current, savedPath);
    await expect.poll(() => sampleArtwork(fresh, points)).toEqual(unsavedPixels);
    expect(await loadProject(store)).toEqual(committed);
    const originalStore = new NodeDirectoryStore(originalFolder);
    expect((await loadProject(originalStore)).project).toEqual(changed);
    expect(await readFile(unrelated, 'utf8')).toBe('replacement artwork');

    await fresh.getByRole('button', { name: 'Selection', exact: true }).click();
    const retryBounds = (await freshStage.boundingBox())!;
    await fresh.mouse.click(
      retryBounds.x + retryBounds.width / 2 + 25,
      retryBounds.y + retryBounds.height / 2 - 5,
    );
    await fresh.getByLabel('Selected fill', { exact: true }).fill('#cc3300');
    const retryDraft = await projectSnapshot(fresh);
    expect(retryDraft.layers[0].keys[0].shapes[1].fill).toBe('#cc3300');

    const readerReady = path.join(root, 'manifest-reader-ready');
    const holdManifest = [
      "$ErrorActionPreference = 'Stop'",
      '$file = [IO.File]::Open($env:SPLASH_TEST_MANIFEST, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)',
      "try { [IO.File]::WriteAllText($env:SPLASH_TEST_READER_READY, 'ready'); Start-Sleep -Seconds 45 }",
      'finally { $file.Dispose() }',
    ].join('\n');
    const reader = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(holdManifest, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          SPLASH_TEST_MANIFEST: path.join(savedPath, 'project.json'),
          SPLASH_TEST_READER_READY: readerReady,
        },
      },
    );
    let readerError = '';
    reader.stderr.on('data', (data: Buffer) => {
      readerError = (readerError + data.toString('utf8')).slice(-1000);
    });
    const readerStopped = new Promise<void>((resolve) => {
      reader.once('exit', () => resolve());
      reader.once('error', () => resolve());
    });
    try {
      await expect
        .poll(() => {
          if (reader.exitCode !== null) throw Error('The sharing fixture exited: ' + readerError);
          return readFile(readerReady, 'utf8').catch(() => '');
        })
        .toBe('ready');
      await freshStage.press('Control+s');
      await expect(fresh.getByText(/Cannot replace the saved project file/).first()).toBeVisible();
      expect(await projectSnapshot(fresh)).toEqual(retryDraft);
      expect(await loadProject(store)).toEqual(committed);
      expect(await readFile(unrelated, 'utf8')).toBe('replacement artwork');
    } finally {
      reader.kill();
      await readerStopped;
    }
    await freshStage.press('Control+s');
    await expect.poll(async () => (await loadProject(store)).project).toEqual(retryDraft);
    await expect(fresh.getByText(/Cannot replace the saved project file/)).toHaveCount(0);

    await fresh.getByLabel('Selected fill', { exact: true }).fill('#118899');
    const unstabilized = await projectSnapshot(fresh);
    expect(unstabilized.layers[0].keys[0].shapes[1].fill).toBe('#118899');
    const componentMarker = path.join(savedPath, '.splash', 'native-test-component-failure');
    const beforeComponentFailure = await loadProject(store);
    await writeFile(componentMarker, 'fixture', { flag: 'wx' });
    await freshStage.press('Control+s');
    const componentWarning = fresh.getByText(
      /Fixture refused to publish the staged project component/,
    );
    await expect(componentWarning.first()).toBeVisible();
    expect(await loadProject(store)).toEqual(beforeComponentFailure);
    expect(await projectSnapshot(fresh)).toEqual(unstabilized);
    await unlink(componentMarker);

    const flushMarker = path.join(savedPath, '.splash', 'native-test-flush-failure');
    const saveFromMenu = async () => {
      await fresh.getByRole('button', { name: 'File', exact: true }).click();
      await fresh.getByRole('button', { name: /^Save(?:\s|$)(?!As)/ }).first().click();
    };
    await writeFile(flushMarker, 'fixture', { flag: 'wx' });
    await saveFromMenu();
    const warning = fresh.getByText(
      /The file was written, but disk synchronization could not be confirmed/,
    );
    await expect(warning.first()).toBeVisible();
    await expect(componentWarning).toHaveCount(0);
    const written = await loadProject(store);
    expect(written.project).toEqual(unstabilized);
    await expect
      .poll(() =>
        fresh.evaluate(() => {
          const recovery = JSON.parse(localStorage.getItem('splash-recovery-v1')!);
          return recovery?.manifest;
        }),
      )
      .toBe(written.manifest);
    await unlink(flushMarker);
    await saveFromMenu();
    await expect(warning).toHaveCount(0);
    const synchronized = await loadProject(store);
    expect(synchronized.project).toEqual(unstabilized);
    expect(synchronized.manifest).not.toBe(written.manifest);

    const beginSaveAs = async () => {
      await fresh.getByRole('button', { name: 'File', exact: true }).click();
      await fresh.getByRole('button', { name: 'Save As / duplicate…', exact: true }).click();
    };
    const saveCopy = async (name: string) => {
      await fresh.getByLabel('Project name').fill(name);
      await Promise.all([
        selectFolder(current!.owner, 'Choose parent folder for new .spl project', root),
        fresh.getByRole('button', { name: 'Save project folder', exact: true }).click(),
      ]);
      return new NodeDirectoryStore(path.join(root, name + '.spl'));
    };
    await fresh.getByLabel('Selected fill', { exact: true }).fill('#556677');
    const copyDraft = await projectSnapshot(fresh);
    const copyMarker = path.join(savedPath, '.splash', 'native-test-copy-failure');
    await writeFile(copyMarker, 'fixture', { flag: 'wx' });
    await beginSaveAs();
    const interrupted = await saveCopy('Interrupted copy');
    await expect(fresh.getByText(/fixture interrupted Save As/).first()).toBeVisible();
    expect(await interrupted.exists('project.json')).toBe(false);
    expect(await interrupted.read('unrelated-artwork.txt')).toBe('replacement artwork');
    expect(await loadProject(store)).toEqual(synchronized);
    expect(await projectSnapshot(fresh)).toEqual(copyDraft);

    await unlink(copyMarker);
    const copied = await saveCopy('Recovered copy');
    await expect(fresh.locator('dialog.file-dialog[open]')).toHaveCount(0, { timeout: 15000 });
    await expect(fresh.locator('.status-message').first()).toContainText('Saved Recovered copy.spl');
    expect((await loadProject(copied)).project).toEqual({
      ...copyDraft,
      name: 'Recovered copy',
    });
    expect(await copied.read('unrelated-artwork.txt')).toBe('replacement artwork');
    expect(await loadProject(store)).toEqual(synchronized);
    expect(await readFile(unrelated, 'utf8')).toBe('replacement artwork');

    const beforeReuse = await loadProject(copied);
    const bitmapPath = 'assets/bitmaps/native-bitmap.json';
    const existingBitmap = await copied.read(bitmapPath);
    const reuseMarker = path.join(copied.root, '.splash', 'native-test-reuse-failure');
    await writeFile(reuseMarker, 'fixture', { flag: 'wx' });
    await fresh.getByLabel('Selected fill', { exact: true }).fill('#135786');
    const reuseDraft = await projectSnapshot(fresh);
    expect(reuseDraft.layers[0].keys[0].shapes[1].fill).toBe('#135786');
    await saveFromMenu();
    const reuseWarning = fresh.getByText(/Fixture refused to synchronize the existing bitmap directory/);
    await expect(reuseWarning.first()).toBeVisible();
    expect(await loadProject(copied)).toEqual(beforeReuse);
    expect(await copied.read(bitmapPath)).toBe(existingBitmap);
    expect(await projectSnapshot(fresh)).toEqual(reuseDraft);

    await unlink(reuseMarker);
    await saveFromMenu();
    await expect(reuseWarning).toHaveCount(0);
    const reused = await loadProject(copied);
    expect(reused.project).toEqual(reuseDraft);
    expect(reused.missingAssets).toEqual([]);
    expect(await copied.read(bitmapPath)).toBe(existingBitmap);
  } finally {
    await current?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
