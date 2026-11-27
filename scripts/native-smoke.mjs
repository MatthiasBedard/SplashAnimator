import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const binary = process.argv[2];
if (!binary) throw new Error('Pass the native-smoke executable path.');
const keyboard = process.argv[3] === '--keyboard';
const penGap = process.argv[3] === '--pen-gap';
const penEraser = process.argv[3] === '--pen-eraser';
const pen = process.argv[3] === '--pen' || penGap || penEraser;
const clipboard = process.argv[3] === '--script-clipboard';
const ime = process.argv[3] === '--script-ime';
const anthyIme = ime && process.argv[4] === '--ibus-anthy';
const dockedIme = anthyIme && process.argv[5] === '--docked';
const speech = process.argv[3] === '--script-speech';
const requireSaveAnnouncement = speech && process.argv[5] === '--require-save-announcement';
const picker = process.argv[3] === '--project-picker';
const saveAs = process.argv[3] === '--project-save-as';
const htmlExport = process.argv[3] === '--project-export';
const recovery = process.argv[3] === '--project-recovery';
if ((keyboard || pen || clipboard || ime || speech || picker || saveAs || htmlExport || recovery) && (process.platform !== 'linux' || !process.env.DISPLAY))
  throw new Error('Run input checks on an isolated Linux X11 display.');
const execute = promisify(execFile);

const profile = await mkdtemp(join(tmpdir(), 'splash-native-smoke-'));
const receipt = join(profile, 'receipt.txt');

async function prepareProject() {
  const folder = join(profile, 'Portal test.spl');
  const contents = {
    'project.json': { format: 'splash-directory', schemaVersion: 59, revision: 'picker',
      savedAt: '2026-11-21T00:00:00Z', document: { id: 'portal-fixture', name: 'Portal test',
        schemaVersion: 59, width: 400, height: 300, fps: 24, duration: 1, background: '#ffffff', assets: [] },
      scene: 'scenes/main.json', timeline: 'timelines/main.json', vectors: 'vectors/main.json' },
    'scenes/main.json': { id: 'main', name: 'Scene 1', timeline: 'timelines/main.json' },
    'timelines/main.json': [{ id: 'ink', name: 'Ink', visible: true, locked: false, drawingMode: 'object',
      keys: [{ frame: 0, ref: 'ink:0' }] }],
    'vectors/main.json': { 'ink:0': [{ id: 'art', kind: 'rectangle', x: 150, y: 100,
      width: 100, height: 100, rotation: 0, points: [], stroke: '#000000', strokeWidth: 0, fill: '#ff0000' }] },
  };
  if (recovery) {
    const art = { ...contents['vectors/main.json']['ink:0'][0],
      id: 'inner-art', x: 0, y: 0, width: 30, height: 30, fill: '#e63122' };
    const instance = (symbol, id, x, y) => ({
      ...art, kind: 'symbol', id, symbolId: symbol.id, width: symbol.width, height: symbol.height, x, y,
    });
    const inner = { id: 'inner', name: 'Nested artwork', width: 110, height: 55, shapes: [art],
      timeline: { duration: 8, keys: [{ frame: 6, shapes: [{ ...art, x: 65 }] }] } };
    const outer = { id: 'outer', name: 'Outer artwork', width: 140, height: 70,
      shapes: [instance(inner, 'inner-instance', 10, 10)] };
    const bitmapPath = 'assets/bitmaps/native-bitmap.json';
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXYxDffvE/AAUnAp8XkzxAAAAAAElFTkSuQmCC';
    contents[bitmapPath] = { dataUrl };
    Object.assign(contents['project.json'].document, { duration: 10, symbols: [inner, outer],
      assets: [{ id: 'native-bitmap', path: bitmapPath, bitmap: { name: 'Native bitmap', width: 1, height: 1 } }] });
    contents['vectors/main.json']['ink:0'].push(instance(outer, 'outer-instance', 32, 203), {
      ...art, id: 'bitmap-placement', x: 295, y: 190, width: 45, height: 45,
      bitmap: { assetId: 'native-bitmap', x: 0, y: 0, width: 45, height: 45 },
    });
  }
  for (const directory of ['scenes', 'timelines', 'vectors', '.splash/autosaves', 'assets/bitmaps'])
    await mkdir(join(folder, directory), { recursive: true });
  for (const [path, value] of Object.entries(contents)) await writeFile(join(folder, path), JSON.stringify(value));
  return { folder, contents };
}

async function waitFor(status) {
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    const [stage, x, y] = (await readFile(receipt, 'utf8').catch(() => '')).trimEnd().split('\n');
    if (stage === status) return x === undefined ? [] : [x, y];
    await delay(100);
  }
  throw new Error(`Native editor did not report ${status}.`);
}

async function clickProjectControl(status, args = ['click', '1']) {
  const point = await waitFor(status);
  assert.equal(point.length, 2, `Missing native click coordinates for ${status}.`);
  const window = await editorWindow();
  await execute('xdotool', ['windowfocus', window, 'mousemove', '--window', window, ...point, 'sleep', '0.12', ...args]);
}

async function composeScript() {
  await waitFor('script ime ready');
  const window = await editorWindow(dockedIme ? '^Splash Animator$' : '^Script Editor');
  await execute('xdotool', ['windowfocus', '--sync', window]);
  if (anthyIme) {
    // IBus can resolve the engine on the first focused GTK input context.
    await execute('ibus', ['engine', 'anthy']).catch(() => {});
    assert.equal((await execute('ibus', ['engine'])).stdout.trim(), 'anthy');
  }
  const keys = anthyIme ? ['n', 'i', 'h', 'o', 'n', 'space'] : ['ctrl+shift+u', '3', '0', '4', 'b'];
  await execute('xdotool', ['key', '--delay', '120', ...keys]);
  await waitFor('script ime preedit');
  await execute('xdotool', ['key', 'Return']);
  await waitFor('script ime committed');
  await execute('xdotool', ['key', 'ctrl+s']);
}

async function listenToScriptEditor(log, start) {
  const waitForSpeech = async message => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const trace = (await readFile(log)).subarray(start).toString('utf8');
      if (trace.split('\n').some(line => /SPEECH OUTPUT/i.test(line) && message.test(line))) return;
      await delay(150);
    }
    throw Error(`Orca did not announce ${message}.`);
  };
  const point = await waitFor('script speech ready');
  assert.equal(point.length, 2);
  const window = await editorWindow('^Script Editor');
  await execute('xdotool', ['windowactivate', '--sync', window,
    'mousemove', '--window', window, ...point, 'click', '1']);
  if (requireSaveAnnouncement) {
    // Orca's default desktop profile uses Insert, and a double press keeps focus mode enabled.
    await execute('xdotool', ['key', '--repeat', '2', '--delay', '90', 'Insert+a']);
    await waitForSpeech(/Focus mode/i);
    await execute('xdotool', ['sleep', '0.5', 'key', 'ctrl+a',
      'type', '--delay', '90', '--', 'const unfinished =']);
    await delay(800);
  } else {
    await execute('xdotool', ['key', 'ctrl+m', 'Tab', 'shift+Tab', 'ctrl+m']);
    await waitForSpeech(/Frame source code editor/i);
    await execute('xdotool', ['key', 'ctrl+a', 'type', '--', 'const unfinished =']);
  }
  await execute('xdotool', ['key', 'Escape', 'ctrl+s']);
  await waitFor('script source saved');
  if (requireSaveAnnouncement) {
    console.log('Native Ctrl+S saved the exact source without moving editor focus.');
    await waitForSpeech(/Frame changes applied/i);
  }
  await writeFile(join(profile, 'receipt.speech'), 'Orca speech verified.\n');
}

async function editorWindow(title = '^Splash Animator$') {
  const { stdout } = await execute('xdotool', ['search', '--onlyvisible', '--name', title]);
  const windows = stdout.trim().split(/\s+/);
  if (windows.length !== 1 || !/^\d+$/.test(windows[0]))
    throw new Error('Expected one Splash Animator window on the isolated display.');
  return windows[0];
}

async function nativeFolderChooser(title) {
  const { stdout } = await execute('xdotool', ['search', '--sync', '--onlyvisible',
    '--name', title], { timeout: 10_000 });
  const chooser = stdout.trim();
  if (!/^\d+$/.test(chooser)) throw Error('Expected one native project chooser.');
  await execute('xdotool', ['windowfocus', chooser]);
  // The portal maps the toplevel before the location entry is ready for input.
  await delay(350);
  return chooser;
}

async function dismissFolderChooser(chooser) {
  await execute('xdotool', ['key', 'Escape']);
  for (let attempt = 0; attempt < 30; attempt++) {
    const exists = await execute('xdotool', ['getwindowname', chooser]).then(() => true, () => false);
    if (!exists) return;
    await delay(100);
  }
  throw Error('The native chooser did not close on Escape.');
}

async function selectFolder(chooser, folder) {
  // Recent files has no current folder. Start from Home before entering a location.
  await execute('xdotool', ['key', 'alt+Home']);
  await delay(350);
  await execute('xdotool', ['key', 'ctrl+l']);
  await delay(250);
  await execute('xdotool', ['type', '--', folder]);
  await delay(250);
  await execute('xdotool', ['key', 'Return']);
  await delay(500);
  if (await execute('xdotool', ['getwindowname', chooser]).then(() => true, () => false)) {
    await execute('xdotool', ['key', 'Return']);
  }
}

async function chooseProjectFolder(folder, { cancelFirst = false, waitUntilReady = true } = {}) {
  if (waitUntilReady) await waitFor('project picker ready');
  const window = await editorWindow();
  const open = async () => {
    await execute('xdotool', ['windowfocus', window, 'key', 'ctrl+o']);
    return nativeFolderChooser('^Open a [.]spl project folder$');
  };
  if (cancelFirst) await dismissFolderChooser(await open());
  await selectFolder(await open(), folder);
}

async function chooseProject() {
  const fixture = await prepareProject();
  await chooseProjectFolder(fixture.folder, { cancelFirst: true });
  await waitFor('project picker verified');
  for (const [path, value] of Object.entries(fixture.contents)) {
    if ((await readFile(join(fixture.folder, path), 'utf8')) !== JSON.stringify(value))
      throw Error('The project chooser modified the saved fixture.');
  }
}

async function projectSnapshot(folder, path) {
  const read = async file => JSON.parse(await readFile(join(folder, file), 'utf8'));
  const manifest = await read(path);
  const { document, scene, timeline, vectors } = manifest;
  const [sceneData, tracks, artwork] = await Promise.all([read(scene), read(timeline), read(vectors)]);
  assert.equal(sceneData.timeline, timeline);
  return { document, scene: { id: sceneData.id, name: sceneData.name }, tracks, artwork };
}

async function verifySaveAs() {
  const fixture = await prepareProject();
  const destination = join(profile, 'Save As destination');
  await mkdir(destination);
  await chooseProjectFolder(fixture.folder);
  await waitFor('project picker verified');
  const window = await editorWindow();
  const chooserTitle = '^Choose parent folder for new [.]spl project$';
  await execute('xdotool', ['windowfocus', window, 'key', 'ctrl+a', 'Right']);
  await waitFor('save as draft ready');
  await execute('xdotool', ['windowfocus', window, 'key', 'ctrl+shift+s']);
  await waitFor('save as name focused');
  await execute('xdotool', ['key', 'ctrl+a', 'type', '--', 'Keyboard copy']);
  await execute('xdotool', ['key', 'Tab']);
  await waitFor('save as submit focused');
  await execute('xdotool', ['key', 'Return']);
  await dismissFolderChooser(await nativeFolderChooser(chooserTitle));
  await writeFile(join(profile, 'receipt.save-as-cancelled'), 'GTK parent chooser closed after Escape.\n');
  await waitFor('save as retry focused');
  assert.deepEqual(await readdir(destination), []);
  for (const [path, value] of Object.entries(fixture.contents))
    assert.equal(await readFile(join(fixture.folder, path), 'utf8'), JSON.stringify(value));

  await execute('xdotool', ['windowfocus', window, 'key', 'Return']);
  await selectFolder(await nativeFolderChooser(chooserTitle), destination);
  await waitFor('save as verified');
  const original = await projectSnapshot(fixture.folder, 'project.json');
  const copy = await projectSnapshot(join(destination, 'Keyboard copy.spl'), 'project.json');
  const expected = structuredClone(original);
  expected.document.name = 'Keyboard copy';
  expected.artwork['ink:0'][0].x += 1;
  assert.deepEqual(copy, expected);
  for (const [path, value] of Object.entries(fixture.contents))
    assert.equal(await readFile(join(fixture.folder, path), 'utf8'), JSON.stringify(value));
}

async function verifyHTMLExport() {
  const fixture = await prepareProject();
  const output = join(profile, 'Keyboard export.html');
  const chooserTitle = '^Export HTML outside the project folder$';
  await chooseProjectFolder(fixture.folder);
  await waitFor('project picker verified');
  const window = await editorWindow();
  await execute('xdotool', ['windowfocus', window, 'key', 'ctrl+a', 'Right']);
  await waitFor('export draft ready');
  async function openQuickExport(status) {
    await execute('xdotool', ['windowfocus', window, 'key', 'F10', ...Array(7).fill('Down')]);
    await waitFor(status);
    await execute('xdotool', ['key', 'Return']);
    return nativeFolderChooser(chooserTitle);
  }
  await dismissFolderChooser(await openQuickExport('export command focused'));
  await writeFile(join(profile, 'receipt.export-cancelled'), 'GTK export chooser closed after Escape.\n');
  await waitFor('export cancellation focused');
  await assert.rejects(readFile(output), { code: 'ENOENT' });

  await openQuickExport('export retry focused');
  await execute('xdotool', ['key', 'ctrl+a']);
  await execute('xdotool', ['type', '--', output]);
  await execute('xdotool', ['key', 'Return']);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await readFile(output, 'utf8').then(() => true, () => false)) break;
    await delay(100);
  }
  const html = await readFile(output, 'utf8');
  await writeFile(join(profile, 'receipt.export-written'), 'Desktop export wrote the output file.\n');
  await waitFor('project export verified');
  assert.match(html, /^<!doctype html>/);
  const data = html.match(/\nconst p=(.+),c=document\.querySelector\('canvas'\)/)?.[1];
  assert.ok(data, 'Missing compiled animation in desktop HTML export.');
  const compiled = JSON.parse(data);
  assert.equal(compiled.layers[0].keys[0].shapes[0].x, 151);
  assert.equal(compiled.layers[0].keys[0].shapes[0].fill, '#ff0000');
  for (const [path, value] of Object.entries(fixture.contents))
    assert.equal(await readFile(join(fixture.folder, path), 'utf8'), JSON.stringify(value));
}

async function installFixtureLicense(data, license) {
  const licenseFolder = join(data, 'studio.splash.animator');
  await mkdir(licenseFolder, { recursive: true });
  await writeFile(join(licenseFolder, 'SplashAnimator.splashlicense'), license, { flag: 'wx' });
}

async function waitForBrushes(folder, path, count) {
  for (let attempt = 0; attempt < 110; attempt++) {
    const saved = await projectSnapshot(folder, path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (saved && Object.values(saved.artwork).flat().filter(shape => shape.kind === 'brush').length === count)
      return saved;
    await delay(250);
  }
  throw Error(`Expected ${count} saved Brush strokes in ${path}.`);
}

async function drawBrush(y) {
  const window = await editorWindow();
  await execute('xdotool', ['windowfocus', window,
    'mousemove', '--window', window, '502', String(y), 'mousedown', '1',
    'sleep', '0.1', 'mousemove', '--window', window, '570', String(y),
    'sleep', '0.1', 'mousemove', '--window', window, '635', String(y),
    'sleep', '0.1', 'mouseup', '1', 'sleep', '0.9']);
}

async function verifyProjectRecovery() {
  const fixture = await prepareProject();
  const license = await readFile(process.argv[4], 'utf8');
  const savedPath = 'project.json';
  const autosavePath = '.splash/autosaves/latest.json';
  const withEditor = async (phase, action) => {
    await rm(receipt, { force: true });
    const data = join(profile, phase, 'data');
    await installFixtureLicense(data, license);
    const app = spawn(resolve(binary), [], { stdio: 'inherit', env: {
      ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: join(profile, phase, 'config'),
      XDG_CACHE_HOME: join(profile, phase, 'cache'), SPLASH_NATIVE_SMOKE_RECEIPT: receipt,
      SPLASH_NATIVE_SMOKE_PROJECT_PICKER: '1', SPLASH_NATIVE_SMOKE_PROJECT_RECOVERY: phase,
    } });
    let stopping = false;
    const exited = new Promise((resolveExit, reject) => {
      app.once('error', reject);
      app.once('exit', (code, signal) => {
        if (stopping) resolveExit(signal);
        else reject(Error(`The native recovery editor exited during ${phase} (${code ?? signal}).`));
      });
    });
    try {
      return await Promise.race([action(), exited]);
    } finally {
      stopping = true;
      app.kill(phase === 'author' ? 'SIGKILL' : 'SIGTERM');
      await exited.catch(() => {});
    }
  };

  const interrupted = await withEditor('author', async () => {
    await chooseProjectFolder(fixture.folder);
    await clickProjectControl('outer artwork point', ['click', '--repeat', '2', '--delay', '90', '1']);
    // GTK groups consecutive clicks at the same point. Let the outer pair end before clicking the child.
    await delay(450);
    await clickProjectControl('inner artwork point', ['click', '--repeat', '2', '--delay', '90', '1']);
    await clickProjectControl('inner first key point', ['click', '3']);
    await clickProjectControl('inner motion tween action');
    await clickProjectControl('return to scene point');
    await waitFor('nested tween authored');
    await execute('xdotool', ['key', 'b']);
    await waitFor('project brush ready');
    await drawBrush(340);
    await execute('xdotool', ['key', 'ctrl+s']);
    const committed = await waitForBrushes(fixture.folder, savedPath, 1);
    assert.deepEqual(Object.values(committed.artwork).flat().find(shape => shape.id === 'art'),
      fixture.contents['vectors/main.json']['ink:0'][0]);
    const originalInner = fixture.contents['project.json'].document.symbols[0];
    const inner = committed.document.symbols.find(symbol => symbol.id === originalInner.id);
    assert.deepEqual(inner.shapes, originalInner.shapes);
    assert.deepEqual(inner.timeline.keys.find(key => key.frame === 6), originalInner.timeline.keys[0]);
    assert.deepEqual(inner.timeline.motionSpans.map(({ start, end }) => [start, end]), [[0, 6]]);
    assert.equal(inner.timeline.keys.find(key => key.frame === 3).shapes[0].x, 32.5);
    assert.deepEqual(committed.document.assets, fixture.contents['project.json'].document.assets);
    await drawBrush(430);
    const snapshot = await waitForBrushes(fixture.folder, autosavePath, 2);
    assert.deepEqual(await projectSnapshot(fixture.folder, savedPath), committed);
    return snapshot;
  });
  await withEditor('reopen', async () => {
    await chooseProjectFolder(fixture.folder);
    await waitFor('project recovery focused');
    await execute('xdotool', ['windowfocus', await editorWindow(), 'key', 'Return']);
    await waitFor('project recovered');
    await execute('xdotool', ['key', 'ctrl+s']);
    assert.deepEqual(await waitForBrushes(fixture.folder, savedPath, 2), interrupted);
    await clickProjectControl('project close point');
    await waitFor('project tab closed');
    await chooseProjectFolder(fixture.folder, { waitUntilReady: false });
    await waitFor('project reopened after close');
    assert.deepEqual(await projectSnapshot(fixture.folder, savedPath), interrupted);
  });
  const bitmapPath = interrupted.document.assets[0].path;
  assert.equal(await readFile(join(fixture.folder, bitmapPath), 'utf8'), JSON.stringify(fixture.contents[bitmapPath]));
  console.log('Native Linux authored the nested tween and saved, reopened and recovered the exact project and bitmap.');
}

async function pasteScript() {
  await waitFor('script clipboard ready');
  const source = '// ' + 'é😀'.repeat(20000) + '\nconst unfinished =';
  const selection = spawn('xclip', ['-selection', 'clipboard', '-in', '-quiet'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const failed = new Promise((_, reject) => selection.once('error', reject));
  try {
    selection.stdin.end(source);
    const paste = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const result = await execute('xclip', ['-selection', 'clipboard', '-out']).catch(() => null);
        if (result?.stdout === source) break;
        if (attempt === 19) throw Error('The isolated X11 clipboard did not own the complete fixture text.');
        await delay(100);
      }
      const window = await editorWindow('^Script Editor');
      await execute('xdotool', ['windowfocus', window, 'key', 'ctrl+a', 'ctrl+v', 'sleep', '0.5', 'key', 'ctrl+s']);
      await waitFor('script clipboard verified');
    };
    await Promise.race([paste(), failed]);
  } finally {
    selection.kill();
  }
}

async function drawPen() {
  await waitFor('pen ready');
  const window = await editorWindow();
  await execute('xdotool', ['windowfocus', window, 'mousemove', '--window', window, '360', '340', 'mousedown', '1',
    'sleep', '0.06', 'mousemove', '--window', window, '420', '340',
    'sleep', '0.06', 'mousemove', '--window', window, '495', penGap ? '360' : '340',
    'sleep', '0.06', 'mousemove', '--window', window, '565', '340', 'sleep', '0.06', 'mouseup', '1']);
  if (penEraser) {
    await waitFor('eraser ready');
    await execute('xdotool', ['mousemove', '--window', window, '460', '340', 'mousedown', '1',
      'sleep', '0.06', 'mouseup', '1']);
    await waitFor('eraser verified');
    await execute('xdotool', ['key', 'ctrl+z']);
    await waitFor('eraser undo verified');
    await execute('xdotool', ['key', 'ctrl+shift+z']);
  }
}

async function pressKeys() {
  await waitFor('stage focused');
  await execute('xdotool', ['windowfocus', await editorWindow(), 'key', 'F10', 'End', 'Down']);
  await waitFor('help action focused');
  await execute('xdotool', ['key', 'Return']);
  await waitFor('about dialog focused');
  await execute('xdotool', ['key', 'Escape']);
  await waitFor('help heading restored');
  await execute('xdotool', ['key', 'Escape']);
  await waitFor('stage restored');
  await execute('xdotool', ['key', 'b']);
  await waitFor('timeline focused');
  await execute('xdotool', ['key', 'Right']);
}

async function verifySmoke() {
  const speechLog = process.argv[4];
  if (speech && !speechLog) throw Error('Pass the isolated Orca debug log for the script speech check.');
  const speechStart = speech ? (await readFile(speechLog)).length : 0;
  const data = join(profile, 'data');
  if (saveAs || htmlExport) await installFixtureLicense(data, await readFile(process.argv[4], 'utf8'));
  const app = spawn(resolve(binary), [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SPLASH_NATIVE_SMOKE_RECEIPT: receipt,
      ...(keyboard ? { SPLASH_NATIVE_SMOKE_KEYBOARD: '1' } : {}),
      ...(pen ? { SPLASH_NATIVE_SMOKE_PEN: penEraser ? 'eraser' : penGap ? 'gap' : '1' } : {}),
      ...(clipboard ? { SPLASH_NATIVE_SMOKE_SCRIPT_CLIPBOARD: '1' } : {}),
      ...(ime ? { SPLASH_NATIVE_SMOKE_IME: anthyIme ? 'anthy' : '1' } : {}),
      ...(dockedIme ? { SPLASH_NATIVE_SMOKE_IME_DOCKED: '1' } : {}),
      ...(speech ? { SPLASH_NATIVE_SMOKE_SCRIPT_SPEECH: requireSaveAnnouncement ? 'save' : '1' } : {}),
      ...(picker ? { SPLASH_NATIVE_SMOKE_PROJECT_PICKER: '1' } : {}),
      ...(saveAs ? { SPLASH_NATIVE_SMOKE_PROJECT_PICKER: 'save-as' } : {}),
      ...(htmlExport ? { SPLASH_NATIVE_SMOKE_PROJECT_PICKER: 'export' } : {}),
      WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'),
      XDG_DATA_HOME: data,
    },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    app.kill();
  }, 55_000);
  let result;
  const exit = new Promise((resolveExit, reject) => {
    app.once('error', reject);
    app.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  try {
    [result] = await Promise.all([exit, picker ? chooseProject() : saveAs ? verifySaveAs() : htmlExport ? verifyHTMLExport() : speech ? listenToScriptEditor(speechLog, speechStart) : ime ? composeScript() : clipboard ? pasteScript() : pen ? drawPen() : keyboard ? pressKeys() : undefined]);
  } catch (error) {
    app.kill();
    await exit.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut)
    throw new Error('Native editor did not finish the startup check within 55 seconds.');
  if (result.code !== 0)
    throw new Error(
      `Native editor did not reach the canvas (exit ${result.code ?? result.signal}).`,
    );
  const expected = picker ? 'project picker verified' : saveAs ? 'save as verified' : htmlExport ? 'project export verified' : speech ? 'script speech verified' : ime ? 'script ime verified' : clipboard ? 'script clipboard verified' : pen ? 'pen verified' : keyboard ? 'keyboard verified' : 'editor ready';
  if ((await readFile(receipt, 'utf8').catch(() => '')) !== `${expected}\n`)
    throw new Error(`Native editor exited without confirming ${expected}.`);
  console.log(picker ? 'Native Linux project chooser cancelled and reopened exact saved artwork.' :
    saveAs ? 'Native Linux keyboard Save As preserved the original, retried after Escape, and saved the exact copy.' :
    htmlExport ? 'Native Linux HTML export restored keyboard focus after Escape and wrote the exact draft on retry.' :
    requireSaveAnnouncement ? 'Orca automatically announced the exact native frame source save.' :
    speech ? 'Orca announced the native Monaco frame editor. Ctrl+S preserved the exact incomplete source.' :
    ime ? `Native Linux Script Editor preserved ${anthyIme ? 'IBus Anthy' : 'GTK Unicode'} preedit and saved the exact composed text.` :
    clipboard ? 'Native Linux Script Editor committed the complete X11 clipboard source.' :
    penEraser ? 'Native Linux WebKit erased the Brush object with an inverted pen packet and verified Undo and Redo.' :
    penGap ? 'Native Linux WebKit retained editable Brush points through a missing packet and a missing pressure axis.' :
    pen ? 'Native Linux WebKit preserved simulated GTK pressure through a complete Brush stroke.' : keyboard
    ? 'Native Linux keyboard verified About, focus return, Brush and timeline navigation.'
    : `Native ${process.platform} WebView loaded the bundled editor, opened the splash and initialized the canvas.`);
}
try {
  await (recovery ? verifyProjectRecovery() : verifySmoke());
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
