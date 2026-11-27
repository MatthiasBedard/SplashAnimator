import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newProject, type Project } from '../../packages/document/src';
import { createDirectory, NodeDirectoryStore } from '../../packages/document/src/node-store';
import { loadProject, saveProject } from '../../packages/document/src/storage';

test('new tabs preserve independent timeline, clipboard, history and recovery', async ({ page }) => {
  const alpha = newProject('Alpha');
  alpha.width = 160;
  alpha.height = 100;
  alpha.duration = 8;
  alpha.layers[0].drawingMode = 'object';
  alpha.layers[0].keys[0].shapes = [{
    id: 'square', kind: 'rectangle', x: 35, y: 35, width: 15, height: 15, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'object',
  }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, alpha);
  const open = async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const splash = page.getByRole('button', { name: 'Open editor', exact: true });
    const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
    await expect(splash.or(recover)).toBeVisible();
    if (await splash.isVisible()) await splash.click();
    await recover.click();
  };
  const recoveries = async () => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('splash-recovery-v1')!);
    return { project: saved.project as Project, others: (saved.documents ?? []) as { project: Project }[] };
  });
  const file = () => page.getByRole('button', { name: 'File', exact: true }).click();
  const edit = async (op: 'Copy' | 'Paste' | 'Undo') => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: new RegExp('^' + op + ' ') }).first().click();
  };
  const tabs = page.getByRole('navigation', { name: 'Open documents' });
  const first = tabs.getByRole('button', { name: 'Switch to Alpha', exact: true });
  const second = tabs.getByRole('button', { name: 'Switch to Untitled', exact: true });
  await open();
  await page.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 45, y: 40 } });
  const frame = page.getByLabel('Go to frame', { exact: true });
  await expect(frame).toHaveValue('3');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 38, box.y + box.height / 2 - 8);
  await edit('Copy');
  await file();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toHaveAttribute('aria-current', 'page');
  await expect(frame).toHaveCount(0);

  let finish! : () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let requestSeen! : () => void;
  const seen = new Promise<void>(resolve => { requestSeen = resolve; });
  await page.route('**/api/projects', async route => {
    if (route.request().postDataJSON()?.op !== 'list') return route.continue();
    requestSeen();
    await pending;
    await route.fulfill({ json: { result: [] } });
  });
  await file();
  await page.getByRole('button', { name: /^Open \.spl folder/ }).click();
  await seen;
  try { await expect(first).toBeDisabled(); }
  finally { finish(); }
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(first).toBeEnabled();

  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const beta = (await recoveries()).project;
  expect(beta.name).toBe('Untitled');
  expect(beta.layers).toHaveLength(2);
  expect(beta.layers.flatMap(layer => layer.keys[0].shapes)).toEqual([]);
  await first.click();
  await expect(first).toHaveAttribute('aria-current', 'page');
  await expect(frame).toHaveValue('3');
  await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('35');
  await edit('Paste');
  const updated = (await recoveries()).project;
  expect(updated.name).toBe('Alpha');
  expect(updated.layers[0].keys[0].shapes).toHaveLength(2);
  await edit('Undo');
  const restored = await recoveries();
  expect(restored.project).toEqual(alpha);
  expect(restored.others).toEqual([{ project: beta, folder: null, manifest: null }]);
  await open();
  await expect(page.getByText('Recovery available: Untitled', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect(second).toHaveAttribute('aria-current', 'page');
  expect((await recoveries()).project).toEqual(beta);
  await first.click();
  expect((await recoveries()).project).toEqual(alpha);
});

test('unsaved project close is keyboard-safe and restores document focus', async ({ page }) => {
  const project = newProject('Keyboard Draft');
  await page.addInitScript(project => {
    localStorage.removeItem('splash-license-v1');
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await recovery();
  const navigation = page.getByRole('navigation', { name: 'Open documents', exact: true });
  const close = navigation.getByRole('button', { name: 'Close Keyboard Draft', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Close project', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const discard = dialog.getByRole('button', { name: 'Discard changes', exact: true });
  await close.press('Enter');
  await expect(cancel).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save and close', exact: true })).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(discard).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(close).toBeFocused();
  expect(await recovery()).toBe(before);

  await page.keyboard.press('Enter');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(close).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Switch to Untitled', exact: true })).toBeFocused();
  expect(await recovery()).toBeNull();
});

test('saved folders reuse tabs and close with Cancel, Save, conflict and Discard', async ({ page }, testInfo) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Run with the isolated licensing fixture.');
  const saved = new Map<string, NodeDirectoryStore>();
  await mkdir(testInfo.outputPath('folders'), { recursive: true });
  for (const name of ['Alpha', 'Beta']) {
    const key = name + '.spl', path = testInfo.outputPath('folders', key);
    await createDirectory(path);
    const store = new NodeDirectoryStore(path);
    await saveProject(store, newProject(name), null);
    saved.set(key, store);
  }
  const storeA = saved.get('Alpha.spl')!, storeB = saved.get('Beta.spl')!;
  const originalA = await loadProject(storeA);
  let finishCommit!: () => void, startCommit!: () => void;
  const finish = new Promise<void>(resolve => { finishCommit = resolve; });
  const entered = new Promise<void>(resolve => { startCommit = resolve; });
  await page.route('**/api/projects', async route => {
    const { op, project, path, content, expected } = route.request().postDataJSON();
    try {
      let result: unknown;
      if (op === 'list') result = [...saved.keys()];
      else if (op === 'create' && project === 'Draft.spl') {
        const destination = testInfo.outputPath('folders', project);
        await createDirectory(destination);
        saved.set(project, new NodeDirectoryStore(destination));
        result = project;
      }
      else {
        const store = saved.get(project);
        if (!store) throw Error('Unknown fixture folder.');
        if (op === 'read') result = await store.read(path);
        else if (op === 'exists') result = await store.exists(path);
        else if (op === 'write') { await store.writeNew(path, content); result = true; }
        else if (op === 'commit') {
          if (project === 'Beta.spl' && path === 'project.json') { startCommit(); await finish; }
          await store.commit(path, content, expected);
          result = true;
        } else throw Error('Unexpected fixture operation.');
      }
      await route.fulfill({ json: { result } });
    } catch (cause) { await route.fulfill({ json: { error: String(cause) } }); }
  });
  await page.addInitScript(value => { localStorage.setItem('splash-license-v1', value!); }, license);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const menu = page.getByRole('navigation', { name: 'Application menu', exact: true });
  await expect(splash.or(menu)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  const open = async (folder: string) => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: /^Open \.spl folder/ }).click();
    await page.getByRole('button', { name: new RegExp(folder.replace('.', '\\.')) }).click();
  };
  const tabs = page.getByRole('navigation', { name: 'Open documents', exact: true });
  const tab = (name: string) => tabs.getByRole('button', { name: 'Switch to ' + name, exact: true });
  const close = (name: string) => tabs.getByRole('button', { name: 'Close ' + name, exact: true });
  const prompt = page.getByRole('dialog', { name: 'Close project', exact: true });
  const add = () => page.getByRole('button', { name: 'Add layer', exact: true }).click();
  const activeRecovery = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!));

  await open('Alpha.spl');
  await expect(tab('Alpha')).toHaveAttribute('aria-current', 'page');
  await add();
  const dirtyAlpha = (await activeRecovery()).project;
  await open('Beta.spl');
  await expect(tab('Beta')).toHaveAttribute('aria-current', 'page');
  await add();
  const dirtyBeta = (await activeRecovery()).project;
  await open('Alpha.spl');
  await expect(tab('Alpha')).toHaveCount(1);
  await expect(tab('Alpha')).toHaveAttribute('aria-current', 'page');
  expect((await activeRecovery()).project).toEqual(dirtyAlpha);
  expect((await loadProject(storeA)).manifest).toBe(originalA.manifest);

  await close('Beta').click();
  await expect(prompt.getByRole('heading')).toHaveText('Save changes to Beta?');
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(close('Beta')).toBeFocused();
  await expect(tab('Alpha')).toHaveAttribute('aria-current', 'page');
  await expect(tab('Beta')).toBeVisible();

  await close('Beta').click();
  await prompt.getByRole('button', { name: 'Save and close', exact: true }).click();
  await entered;
  try {
    await expect(tab('Alpha')).toBeDisabled();
    await expect(close('Alpha')).toBeDisabled();
    await expect(tab('Beta')).toHaveAttribute('aria-current', 'page');
  } finally { finishCommit(); }
  await expect(tab('Beta')).toHaveCount(0);
  await expect(tab('Alpha')).toHaveAttribute('aria-current', 'page');
  await expect(tab('Alpha')).toBeFocused();
  expect((await loadProject(storeB)).project).toEqual(dirtyBeta);
  expect((await activeRecovery()).project).toEqual(dirtyAlpha);

  const external = await saveProject(storeA, originalA.project, originalA.manifest);
  await close('Alpha').click();
  await prompt.getByRole('button', { name: 'Save and close', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/changed on disk/i);
  await expect(tab('Alpha')).toHaveAttribute('aria-current', 'page');
  expect((await activeRecovery()).project).toEqual(dirtyAlpha);
  expect((await loadProject(storeA)).manifest).toBe(external);

  await close('Alpha').click();
  await prompt.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(tab('Alpha')).toHaveCount(0);
  await expect(tab('Untitled')).toHaveAttribute('aria-current', 'page');
  await expect(tab('Untitled')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBeNull();
  expect((await loadProject(storeA)).manifest).toBe(external);

  await add();
  const draft = (await activeRecovery()).project;
  await close('Untitled').click();
  await prompt.getByRole('button', { name: 'Save and close', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Draft');
  await page.getByRole('button', { name: 'Save project folder', exact: true }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveCount(0);
  await expect(tab('Untitled')).toHaveAttribute('aria-current', 'page');
  const savedDraft = await loadProject(saved.get('Draft.spl')!);
  expect(savedDraft.project).toEqual({ ...draft, name: 'Draft' });
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBeNull();
});

test('a delayed Brush worker keeps ownership of its original document', async ({ page }) => {
  const source = newProject('Brush source');
  source.width = 300;
  source.height = 200;
  source.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('/worker-') && !String(url).includes('geometry-worker')) return;
        this.addEventListener('message', event => {
          const publish = this.onmessage;
          if (!publish || event.data?.result === undefined) return;
          event.stopImmediatePropagation();
          Reflect.set(window, 'releaseBrushWorker', () => publish.call(this, event));
        }, { once: true });
      }
    };
  }, source);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Open documents', exact: true });
  const brush = tabs.getByRole('button', { name: 'Switch to Brush source', exact: true });
  const other = tabs.getByRole('button', { name: 'Switch to Untitled', exact: true });
  await brush.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x - 80, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 4, { steps: 9 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseBrushWorker'))).toBe('function');
  await expect(other).toBeDisabled();
  await expect(tabs.getByRole('button', { name: 'Close Brush source', exact: true })).toBeDisabled();
  await other.evaluate(button => (button as HTMLButtonElement).click());
  await expect(brush).toHaveAttribute('aria-current', 'page');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!));
  expect((await read()).project).toEqual(source);
  const release = () => page.evaluate(() => Reflect.get(window, 'releaseBrushWorker')());
  await release();
  await expect(other).toBeEnabled();
  const committed = await read();
  expect(committed.project.layers[0].keys[0].shapes).toHaveLength(1);
  await other.click();
  await expect(other).toHaveAttribute('aria-current', 'page');
  expect(await read()).toEqual(committed);
  await brush.click();
  await release();
  expect(await read()).toEqual(committed);
});

test('byte-limited Undo retains current artwork and independent tab recovery', async ({ page }) => {
  const alpha = newProject('Large artwork');
  alpha.layers[0].keys[0].shapes = [{
    id: 'keep', kind: 'rectangle', x: 30, y: 30, width: 80, height: 50,
    rotation: 0, fill: '#f00000', stroke: '#000000', strokeWidth: 0, points: [],
  }];
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 735;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    let state = 17;
    for (let i = 0; i < image.data.length; i += 4) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      image.data[i] = state & 255;
      image.data[i + 1] = (state >>> 8) & 255;
      image.data[i + 2] = (state >>> 16) & 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  });
  expect(dataUrl.length).toBeGreaterThan(2_000_000);
  expect(dataUrl.length).toBeLessThan(2_800_001);
  alpha.assets = [{ id: 'large', path: 'assets/bitmaps/large.json',
    bitmap: { name: 'Large bitmap', width: 735, height: 735, dataUrl } }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, alpha);
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  async function open() {
    await page.goto('/');
    await expect(launch.or(recover).first()).toBeVisible({ timeout: 15_000 });
    if (await launch.isVisible()) await launch.click();
    await recover.click();
  }
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!) as {
    project: Project; documents: { project: Project }[];
  });
  await open();
  const add = page.getByRole('button', { name: 'Add layer', exact: true });
  for (let i = 0; i < 10; i++) await add.click();
  const final = (await read()).project;
  expect(final.layers).toHaveLength(11);
  expect(final.layers[0].keys[0].shapes).toEqual(alpha.layers[0].keys[0].shapes);
  expect(final.assets).toEqual(alpha.assets);
  const notice = page.getByRole('status').filter({ hasText: 'Older Undo history was trimmed.' });
  await expect(notice).toBeVisible();

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await add.click();
  const beta = (await read()).project;
  expect(beta.layers).toHaveLength(2);
  const first = page.getByRole('button', { name: 'Switch to Large artwork', exact: true });
  const second = page.getByRole('button', { name: 'Switch to Untitled', exact: true });
  await first.click();
  await expect(notice).toBeVisible();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await stage.press('Control+z');
  expect((await read()).project.layers).toHaveLength(10);
  await stage.press('Control+Shift+z');
  expect((await read()).project).toEqual(final);
  for (let i = 0; i < 10; i++) await stage.press('Control+z');
  const retained = (await read()).project;
  expect(retained.layers.length).toBeGreaterThan(1);
  expect(retained.layers.length).toBeLessThan(11);
  expect(retained.layers[0]).toEqual(alpha.layers[0]);
  expect(retained.assets).toEqual(alpha.assets);
  expect((await read()).documents.map(entry => entry.project)).toEqual([beta]);

  await second.click();
  await stage.press('Control+z');
  expect((await read()).project.layers).toHaveLength(1);
  await first.click();
  expect((await read()).project).toEqual(retained);
  await open();
  expect((await read()).project).toEqual(retained);
});
