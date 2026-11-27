import { exportHtmlFromShortcut } from './export-settings';
import { extractWebDownload, readWebDownload } from './web-export-files';
import { sourceEditor, fillSource, expectSource } from './monaco-source';
import { expect, test, type Page } from '@playwright/test';
import { newProject, type Vector } from '../../packages/document/src';
import { readFile } from 'node:fs/promises';
import { encodePcm16Wav } from '../../packages/audio/src/wav-encode';
import { decodePcm16Wav } from '../../packages/audio/src/wav';
import { NodeDirectoryStore } from '../../packages/document/src/node-store';
import { loadProject } from '../../packages/document/src/storage';
import { pathToFileURL } from 'node:url';

test('explicit script preview runs from the saved integrated authoring project', async ({ page }, testInfo) => {
  const folder = process.env.SPLASH_INTEGRATED_PROJECT;
  const license = process.env.SPLASH_INTEGRATED_LICENSE;
  test.skip(!folder || !license, 'Requires the saved native acceptance project and signed fixture license.');
  const { project, missingAssets } = await loadProject(new NodeDirectoryStore(folder!));
  expect(missingAssets).toEqual([]);
  const outer = project.symbols!.find(symbol => symbol.name === 'Animated container')!;
  const leaf = project.symbols!.find(symbol => symbol.name === 'Painted tile')!;
  expect(outer.timeline?.layers?.some(track => track.motionSpans?.length)).toBe(true);
  const tile = leaf.shapes[0];
  const placement = project.layers[0].keys[0].shapes[0];
  const endpoint = { x: Math.floor(placement.x + tile.x + tile.width / 2 + 120), y: Math.floor(placement.y + tile.y + tile.height / 2) };
  const middle = { x: endpoint.x - 60, y: endpoint.y };
  type ClockWindow = Window & { acceptanceTime?: number };
  await page.addInitScript(({project, license}) => {
    if (window !== window.top) return;
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    localStorage.setItem('splash-license-v1', license);
    const raf = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => callback((window as ClockWindow).acceptanceTime ?? time));
  }, { project, license: await readFile(license!, 'utf8') });
  const control = (name: string) => page.getByRole('button', { name, exact: true });
  await page.goto('/');
  const splash = control('Open editor');
  const recover = control('Recover changes');
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const marker = 'integrated-script-preview';
  await timeline.click({ button: 'right', position: { x: 8, y: 16 } });
  await page.getByRole('menuitem', { name: 'Script…', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await fillSource(sourceEditor(source), `state.acceptance = "${marker}";\ntimeline.gotoAndStop(6);`);
  await source.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect(source.getByRole('status')).toContainText('Frame source applied');
  await source.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const authored = await read();
  expect(JSON.parse(authored!).project).toEqual({
    ...project, frameScripts: [{ frame: 0, source: `state.acceptance = "${marker}";\ntimeline.gotoAndStop(6);` }],
  });

  await stage.press('Enter');
  await expect(timeline).toHaveAccessibleDescription(/Frame [4-6] of 12/);
  await stage.press('Enter');
  await timeline.press('Home');
  const clock = (time?: number) => page.evaluate(time => (window as ClockWindow).acceptanceTime = time, time);
  await clock(20_000);
  await stage.press('Control+Enter');
  const movie = page.getByRole('dialog', { name: 'Test movie', exact: true });
  const movieCanvas = movie.locator('canvas');
  await expect(movieCanvas).toBeVisible();
  const moviePixel = async (point: { x: number; y: number }) => {
    const png = (await movieCanvas.screenshot()).toString('base64');
    return page.evaluate(async ({png, point, width, height}) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(point.x * image.width / width, point.y * image.height / height, 1, 1).data);
    }, { png, point, width: project.width, height: project.height });
  };
  await expect.poll(() => moviePixel({ x: endpoint.x - 120, y: endpoint.y })).toEqual([22, 138, 204, 255]);
  await clock(20_751);
  await expect.poll(() => moviePixel(middle)).toEqual([22, 138, 204, 255]);
  await movie.getByRole('button', { name: 'Close ×', exact: true }).click();
  await clock();
  await control('Control').click();
  await control('Preview saved scripts…').click();
  const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const action = (name: string) => preview.getByRole('button', { name, exact: true });
  await preview.getByLabel('Render detached artwork').check();
  await action('Prepare script preview').click();
  await expect(preview.getByRole('status')).toHaveText('Ready. No scripts have run.');
  await action('Step script tick').click();
  await expect(preview.getByRole('status')).toHaveText('Completed 1 script tick.');
  await expect(preview.getByLabel('Script preview state')).toContainText(marker);
  await expect(preview.getByText(/Frame 7 · Tick 1 · Stopped/)).toBeVisible();
  const image = preview.getByAltText('Script preview artwork');
  await expect.poll(() => image.evaluate(async (image: HTMLImageElement, point) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(point.x, point.y, 1, 1).data);
  }, endpoint)).toEqual([22, 138, 204, 255]);
  await action('Close dialog').click();
  expect(await read()).toBe(authored);

  await control('File').click();
  const [exported] = await Promise.all([
    page.waitForEvent('download'), exportHtmlFromShortcut(page, control('Export HTML animation…')),
  ]);
  const output = await extractWebDownload(exported, testInfo.outputPath('authored-folder'));
  expect((await readWebDownload(exported)).get('data/animation.js')?.toString()).not.toContain(marker);
  const player = await page.context().newPage();
  try {
    await player.addInitScript(() => {
      const raf = requestAnimationFrame.bind(window);
      (window as ClockWindow).acceptanceTime = 10_000;
      window.requestAnimationFrame = callback => raf(time => callback((window as ClockWindow).acceptanceTime ?? time));
    });
    await player.goto(pathToFileURL(output).href);
    const canvas = player.locator('canvas');
    for (const [frame, point] of [[0, { x: endpoint.x - 120, y: endpoint.y }], [3, middle], [6, endpoint]] as const) {
      await player.evaluate(time => (window as ClockWindow).acceptanceTime = time, 10_000 + frame * 250 + 1);
      await expect.poll(() => canvas.evaluate((canvas: HTMLCanvasElement, point) =>
        Array.from(canvas.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data), point)).toEqual([22, 138, 204, 255]);
    }
  } finally {
    await player.close();
  }
  expect(await read()).toBe(authored);
});

test('source breakpoint selects a saved scene frame and records its seek only on completion',async({page})=>{
  const project=newProject();
  project.duration=4;
  project.frameScripts=[
    {frame:0,source:'state.source="first";\nstate.first=true;'},
    {frame:2,source:'state.source="third";\nstate.visits=Number(state.visits ?? 0)+1;\ntimeline.stop();'},
  ];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status'),source=dialog.getByLabel('Breakpoint source',{exact:true}),line=dialog.getByLabel('Breakpoint line');
  const seeks=dialog.getByLabel('Retained script seek inputs'),committed=dialog.getByLabel('Script preview state');
  await source.selectOption({label:'Frame 1'});
  await line.fill('2');
  await source.selectOption({label:'Frame 3'});
  await expect(line).toHaveValue('1');
  await line.fill('3');
  await source.selectOption({label:'Frame 1'});
  await expect(line).toHaveValue('2');
  await source.selectOption({label:'Frame 3'});
  await expect(line).toHaveValue('3');
  await dialog.getByText('View selected source',{exact:true}).click();
  await expect(dialog.getByLabel('Selected breakpoint source')).toHaveText(project.frameScripts[1].source);
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  const originalImage=await dialog.getByAltText('Script preview artwork').getAttribute('src');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 3, line 3, column 1.');
  await expect(dialog.getByLabel('Paused script state')).toContainText('"source": "third"');
  await expect(dialog.getByText('Frame 1 · Tick 0 · Playing · Entry pending',{exact:true})).toBeVisible();
  await expect(seeks).toContainText('0 seek inputs');
  await expect(source).toBeDisabled();
  await expect(committed).toHaveText('{}');
  await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',originalImage!);
  await control('Cancel script preview').click();
  await expect(status).toContainText(/cancel|abort/i);
  await expect(seeks).toContainText('0 seek inputs');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 3, line 3, column 1.');
  await control('Continue script').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(dialog.getByText('Frame 3 · Tick 1 · Stopped · Entry complete',{exact:true})).toBeVisible();
  await expect(seeks).toContainText('1 seek inputs');
  await expect(committed).toContainText('"visits": 1');
  await expect(committed).not.toContainText('"first"');
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 1 ticks and 1 seek inputs');
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('source breakpoint steps through one saved body and can continue or cancel',async({page})=>{
  const project=newProject();
  project.frameScripts=[{frame:0,source:[
    'let multiplier = 7; const { label } = {label:"safe"}; const opaque = {get secret(){state.getterRead=true; return 99;}};',
    'state.value = 2;',
    '// Break only at an executable statement.',
    '  state.value = scaled(multiplier++);',
    '// Stepping skips this line.',
    'state.completed = Number(state.completed ?? 0) + 1; state.after = Number(state.value) + 1;',
    'timeline.stop();',
    'function scaled(factor:number):number {',
    '  const inner = Number(state.value) * factor;',
    '  return inner;',
    '}',
  ].join('\n')}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status'),committed=dialog.getByLabel('Script preview state');
  const locals=dialog.getByRole('region',{name:'Paused local variables'});
  const line=dialog.getByLabel('Breakpoint line');
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  const originalImage=await dialog.getByAltText('Script preview artwork').getAttribute('src');
  await line.fill('3');
  await control('Debug script tick').click();
  await expect(status).toContainText('first line of an executable top-level statement');
  await expect(committed).toHaveText('{}');
  await line.fill('4');
  async function pause(){
    await control('Debug script tick').click();
    await expect(status).toHaveText('Paused before frame 1, line 4, column 3.');
    await expect(dialog.getByLabel('Paused source line')).toContainText('state.value = scaled(multiplier++);');
    await expect(dialog.getByLabel('Paused script state')).toContainText('"value": 2');
    await expect(committed).toHaveText('{}');
    await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',originalImage!);
    await expect(locals.locator('dd')).toHaveText(['7','"safe"','object']);
  }
  async function step(column:number){
    await control('Step Over').click();
    await expect(status).toHaveText(`Paused before frame 1, line 6, column ${column}.`);
    await expect(committed).toHaveText('{}');
    await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',originalImage!);
    await expect(dialog.getByLabel('Paused script state')).toContainText('"value": 14');
    await expect(locals.locator('dd')).toHaveText(['8','"safe"','object']);
    await expect(locals).not.toContainText('inner');
    await expect(dialog.getByLabel('Paused script state')).not.toContainText('getterRead');
  }
  await pause();
  await step(1);
  await expect(dialog.getByLabel('Paused script state')).not.toContainText('completed');
  await control('Cancel script preview').click();
  await expect(status).toContainText(/cancel|abort/i);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await expect(committed).toHaveText('{}');
  await pause();
  await step(1);
  await step(53);
  await expect(dialog.getByLabel('Paused source line').locator('mark')).toHaveText('state.after = Number(state.value) + 1;');
  await expect(dialog.getByLabel('Paused script state')).toContainText('"completed": 1');
  await expect(dialog.getByLabel('Paused script state')).not.toContainText('"after"');
  await control('Continue script').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(committed).toContainText('"value": 14');
  await expect(committed).toContainText('"completed": 1');
  await expect(committed).toContainText('"after": 15');
  await expect(dialog.getByLabel('Paused script state')).toHaveCount(0);
  await expect(control('Debug script tick')).toBeDisabled();
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 1 ticks');
  await expect(committed).toContainText('"completed": 1');
  await control('Reset script preview').click();
  await expect(status).toHaveText('Reset to the initial preview state.');
  await line.fill('7');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 7, column 1.');
  await control('Step Over').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(committed).toContainText('"completed": 1');
  await control('Reset script preview').click();
  await expect(status).toHaveText('Reset to the initial preview state.');
  await line.fill('4');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 4, column 3.');
  await control('Close dialog').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('source breakpoint steps into a saved function and inspects the caller and callee',async({page})=>{
  const project=newProject();
  project.frameScripts=[{frame:0,source:[
    'let base=10;',
    'state.before=base;',
    'state.value=double(base++);',
    'state.after=base;',
    'timeline.stop();',
    'function double(value:number):number {',
    '  let result=value*2;',
    '  result+=1;',
    '  return result;',
    '}',
  ].join('\n')}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status'),committed=dialog.getByLabel('Script preview state');
  const stack=dialog.getByRole('region',{name:'Call stack'}),locals=dialog.getByRole('region',{name:'Paused local variables'});
  const source=dialog.getByLabel('Paused source line'),staged=dialog.getByLabel('Paused script state');
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  const image=await dialog.getByAltText('Script preview artwork').getAttribute('src');
  await dialog.getByLabel('Breakpoint line').fill('3');
  async function enter(){
    await control('Debug script tick').click();
    await expect(status).toHaveText('Paused before frame 1, line 3, column 1.');
    await expect(locals.locator('dd')).toHaveText(['10']);
    await control('Step Into').click();
    await expect(status).toHaveText('Paused before frame 1, line 7, column 3.');
    await expect(stack.getByRole('button')).toHaveText(['double · Line 7','Frame script · Line 3']);
    await expect(locals.locator('dd')).toHaveText(['10']);
    await expect(staged).not.toContainText('"value"');
    await expect(committed).toHaveText('{}');
  }
  await enter();
  await stack.getByRole('button',{name:'Frame script · Line 3'}).click();
  await expect(source.locator('mark')).toHaveText('state.value=double(base++);');
  await expect(locals.locator('dd')).toHaveText(['11']);
  await control('Cancel script preview').click();
  await expect(status).toContainText(/cancel|abort/i);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',image!);
  await enter();
  await control('Step Over').click();
  await expect(status).toHaveText('Paused before frame 1, line 8, column 3.');
  await expect(locals.locator('dd')).toHaveText(['10','20']);
  await control('Step Out').click();
  await expect(status).toHaveText('Paused before frame 1, line 4, column 1.');
  await expect(stack).toHaveCount(0);
  await expect(staged).toContainText('"value": 21');
  await control('Continue script').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(committed).toContainText('"after": 11');
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 1 ticks');
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('runtime errors in a debug helper open the exact original scene coordinate', async ({ page }) => {
  const project = newProject();
  const source = [
    '\uFEFFstate.result = explode();',
    'function explode(): never {',
    '  state.staged = true;',
    '    throw new Error("mapped scene failure");',
    '}',
  ].join('\r\n');
  project.frameScripts = [{ frame: 0, source }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const mapped = 'mapped scene failure (source line 4, column 20; advisory)';
  await button('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await button('Step script tick').click();
  await expect(status).toContainText(mapped);
  await button('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 1, column 2.');
  await button('Step Into').click();
  await expect(status).toHaveText('Paused before frame 1, line 3, column 3.');
  await button('Continue script').click();
  await expect(status).toContainText(mapped);
  await expect(dialog.getByLabel('Script preview state')).toHaveText('{}');
  await expect(dialog.getByText('Frame 1 · Tick 0 · Playing · Entry pending', { exact: true })).toBeVisible();
  await button('Edit failing frame 1 source').click();
  const editor = sourceEditor(page.getByRole('dialog', { name: 'Edit frame source', exact: true }));
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('Error(', 'ErrorX'));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('opening the paused caller selects its original scene location across Unicode line separators', async ({ page }) => {
  const project = newProject();
  const source = '\uFEFFstate.before = true;\u2028  state.value = twice(2);\u2029function twice(n: number) {\r  return n * 2;\r}';
  project.frameScripts = [{ frame: 0, source }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  await button('Prepare script preview').click();
  await expect(dialog.getByRole('status')).toHaveText('Ready. No scripts have run.');
  await dialog.getByLabel('Breakpoint line').fill('2');
  await button('Debug script tick').click();
  await expect(dialog.getByRole('status')).toHaveText('Paused before frame 1, line 2, column 3.');
  await button('Step Into').click();
  await expect(dialog.getByRole('status')).toHaveText('Paused before frame 1, line 4, column 3.');
  await dialog.getByRole('button', { name: 'Frame script · Line 2', exact: true }).click();
  await button('Stop and open paused source').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  const editor = sourceEditor(page.getByRole('dialog', { name: 'Edit frame source', exact: true }));
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('state.value', 'Xtate.value').replace(/\r/g, '\n'));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('saved debugger locations open current source and reject a program changed by a frame commit', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: 'state.saved = true;\n  timeline.stop();' }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const control = (name: string) => page.getByRole('button', { name, exact: true });
  await control('Control').click();
  await control('Edit current frame source…').click();
  const sourcePanel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const editor = sourceEditor(sourcePanel);
  const draft = 'state.edited = true;\n  timeline.stop();';
  await expect(editor).toBeVisible();
  async function pause() {
    await control('Control').click();
    await control('Preview saved scripts…').click();
    const preview = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
    await preview.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
    await expect(preview.getByRole('status')).toHaveText('Ready. No scripts have run.');
    await preview.getByLabel('Breakpoint line').fill('2');
    await preview.getByRole('button', { name: 'Debug script tick', exact: true }).click();
    await expect(preview.getByRole('status')).toHaveText('Paused before frame 1, line 2, column 3.');
    return preview;
  }
  const openPause = { name: 'Stop and open paused source', exact: true };
  const before = await pause();
  await before.getByRole('button', openPause).click();
  await expectSource(editor, project.frameScripts[0].source);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    sourcePanel.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const detached = popup.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await expectSource(sourceEditor(detached), project.frameScripts[0].source);
  const stale = await pause();
  await fillSource(sourceEditor(detached), draft);
  await detached.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source)).toBe(draft);
  await stale.getByRole('button', openPause).click();
  await expect(stale.getByRole('status')).toContainText('Saved sources changed');
  await stale.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await stale.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await Promise.all([popup.waitForEvent('close'), detached.getByLabel('Script editor location').selectOption('timeline')]);
  await expectSource(sourceEditor(sourcePanel), draft);
  const refreshed = await pause();
  await refreshed.getByRole('button', openPause).click();
  await expectSource(sourceEditor(sourcePanel), draft);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
});

test('oversized script state rolls back a tick and keeps input replay deterministic', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'state.roll = runtime.random();',
    'if (input.large === true) state.payload = new Array(33000).join("é");',
    'if (typeof input.label === "string") state.label = input.label;',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const inputs = dialog.getByLabel('Retained script JSON inputs', { exact: true });
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await input.fill('{"label":"first"}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"label": "first"');
  const before = await state.textContent();
  await input.fill('{"large":true,"label":"rejected"}');
  await control('Send input and step').click();
  await expect(status).toContainText('Script state exceeds 64 KiB.');
  await expect(state).toHaveText(before!);
  await expect(inputs).toContainText('1 JSON input');
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await input.fill('{"label":"retry"}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"label": "retry"');
  await expect(inputs).toContainText('2 JSON inputs');
  const after = await state.textContent();
  expect(after).not.toBe(before);
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  await expect(state).toHaveText(after!);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('the shipped script inspector isolates its paused realm and rejects a late native host', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'const host = globalThis as unknown as Record<string, unknown>;',
    'state.host = ["fetch", "WebSocket", "XMLHttpRequest", "localStorage", "sessionStorage",',
    '  "indexedDB", "document", "Worker", "__TAURI_INTERNALS__", "__TAURI__"].map((name) => typeof host[name]);',
    'state.result = 7;',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  await button('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  const engineWorkers = () => page.workers().filter((worker) => /quickjs-frame-worker(?:[-.])/.test(worker.url()));
  await button('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 1, column 1.');
  await expect.poll(() => engineWorkers().length).toBe(1);
  const iframe = page.locator('iframe[title="Isolated script frame"]');
  await expect(iframe).toHaveCount(0);

  await page.evaluate(() => Reflect.set(window, '__TAURI_INTERNALS__', {}));
  await button('Continue script').click();
  await expect(status).toContainText('not enabled in the native application');
  await expect(dialog.getByLabel('Script preview state', { exact: true })).toHaveText('{}');
  await expect(iframe).toHaveCount(0);
  await expect.poll(() => engineWorkers().length).toBe(0);
  await page.evaluate(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));
  await button('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 1, column 1.');
  await button('Continue script').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(dialog.getByLabel('Script preview state', { exact: true })).toContainText('"result": 7');
  const state = JSON.parse((await dialog.getByLabel('Script preview state', { exact: true }).textContent()) ?? '{}');
  expect(state.host).toEqual(Array(10).fill('undefined'));
  await expect.poll(() => engineWorkers().length).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('source breakpoint stepping stops at the loop limit without committing a tick',async({page})=>{
  const project=newProject();
  project.frameScripts=[{frame:0,source:'state.staged = 1;\nwhile (Number(state.staged) === 1) {}\ntimeline.stop();'}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status');
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 1, column 1.');
  await control('Step Over').click();
  await expect(status).toHaveText('Paused before frame 1, line 2, column 1.');
  await expect(dialog.getByLabel('Paused script state')).toContainText('"staged": 1');
  await control('Step Over').click();
  await expect(status).toContainText('Script loop work limit exceeded.');
  await expect(dialog.getByLabel('Script preview state')).toHaveText('{}');
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 1, column 1.');
  await control('Cancel script preview').click();
  await expect(status).toContainText(/cancel|abort/i);
});

test('a caught loop work error rolls back the tick and allows a deterministic retry', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'let visits = 0;',
    'const limit = typeof input.limit === "number" ? input.limit : 1;',
    'try { for (let i=0; i<limit; i++) visits++; } catch { state.caught = true; }',
    'state.visits = visits;',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await input.fill('{"limit":100001}');
  await control('Send input and step').click();
  await expect(status).toContainText('Script loop work limit exceeded.');
  await expect(state).toHaveText('{}');
  await expect(dialog.getByLabel('Retained script JSON inputs')).toContainText('0 JSON inputs');
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await input.fill('{"limit":100000}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"visits": 100000');
  await expect(state).not.toContainText('caught');
  const committed = await state.textContent();
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 1 ticks');
  await expect(state).toHaveText(committed!);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('authored calls and recursive depth reject the tick and retain deterministic retry', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'function descend(remaining: number): number { return remaining ? 1 + descend(remaining - 1) : 1; }',
    'const limit = typeof input.limit === "number" ? input.limit : 256;',
    'try {',
    '  if (typeof input.callbacks === "number") {',
    '    let visits = 0;',
    '    new Array(input.callbacks + 1).join("x").replace(/./g, () => { visits++; return "x"; });',
    '    state.callbacks = visits;',
    '  }',
    '  else state.depth = descend(limit);',
    '} catch { state.caught = true; }',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  const events = dialog.getByLabel('Retained script JSON inputs');
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await input.fill('{"callbacks":100001}');
  await control('Send input and step').click();
  await expect(status).toContainText('Script function work limit exceeded.');
  await expect(state).toHaveText('{}');
  await expect(events).toContainText('0 JSON inputs');
  await dialog.getByLabel('Breakpoint line').fill('2');
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before frame 1, line 2, column 1.');
  await control('Continue script').click();
  await expect(status).toContainText('Script function nesting limit exceeded.');
  await expect(state).toHaveText('{}');
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  await input.fill('{"callbacks":100000}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"callbacks": 100000');
  await input.fill('{"limit":255}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"depth": 256');
  await expect(state).not.toContainText('caught');
  await expect(events).toContainText('2 JSON inputs');
  const committed = await state.textContent();
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  await expect(state).toHaveText(committed!);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('temporary allocation limits reject a caught failure and permit exact-capacity retry', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'const size = typeof input.size === "number" ? input.size : 1;',
    'try {',
    '  if (input.text === true) {',
    '    const value = "x" as unknown as { repeat(count: number): string };',
    '    state.size = value.repeat(size).length;',
    '  } else state.size = new Array(size).length;',
    '} catch { state.caught = true; }',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  const events = dialog.getByLabel('Retained script JSON inputs');
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  for (const text of [false, true]) {
    await input.fill(JSON.stringify({ size: 1048577, text }));
    await control('Send input and step').click();
    await expect(status).toContainText(text ? 'temporary repeated text allocation limit' : 'temporary array allocation limit');
    await expect(state).toHaveText('{}');
    await expect(events).toContainText('0 JSON inputs');
    await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  }
  for (const text of [false, true]) {
    await input.fill(JSON.stringify({ size: 1048576, text }));
    await control('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
    await expect(state).toContainText('"size": 1048576');
    await expect(state).not.toContainText('caught');
  }
  await expect(events).toContainText('2 JSON inputs');
  const committed = await state.textContent();
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  await expect(state).toHaveText(committed!);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('engine-limited scene preview rejects a temporary heap allocation and replays a successful retry', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: [
    'if (input.large === true) state.bytes = new Array(600000).join("01234567890123456789012345678901").length;',
    'if (input.handle === true) {',
    '  try { state.bytes = new Array(600000).join("01234567890123456789012345678901").length; }',
    '  catch { state.handled = true; }',
    '}',
    'const host = globalThis as unknown as { fetch?: unknown; localStorage?: unknown; __TAURI_INTERNALS__?: unknown };',
    'state.host = [typeof host.fetch, typeof host.localStorage, typeof host.__TAURI_INTERNALS__];',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\n') }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await expect(control('Debug script tick')).toBeEnabled();
  await input.fill('{"large":true}');
  await control('Send input and step').click();
  await expect(status).toContainText(/out of memory/i);
  await expect(state).toHaveText('{}');
  await expect(dialog.getByLabel('Retained script JSON inputs')).toContainText('0 JSON inputs');
  await input.fill('{}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"roll"');
  await expect.poll(async () => JSON.parse((await state.textContent()) ?? '{}').host)
    .toEqual(['undefined', 'undefined', 'undefined']);
  await input.fill('{"handle":true}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect(state).toContainText('"handled": true');
  await expect(state).not.toContainText('"bytes"');
  const committed = await state.textContent();
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  await expect(state).toHaveText(committed!);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('engine-limited preview interrupts work, cancels pending dispatch and maps saved source', async ({ page }) => {
  const project = newProject();
  const source = [
    'if (input.fail === true) {',
    '  throw new Error("engine source failure");',
    '}',
    'if (input.work === true) {',
    '  new Function("let n = 0; while (n < 300000000) n++;")();',
    '}',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\r\n');
  project.frameScripts = [{ frame: 0, source }];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const input = dialog.getByLabel('Script input JSON', { exact: true });
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const events = dialog.getByLabel('Retained script JSON inputs');
  const workerUrl = /quickjs-frame-worker(?:[-.])/;
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route(workerUrl, async (route) => {
    requested = true;
    await gate;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    await input.fill('{}');
    await control('Send input and step').click();
    await expect.poll(() => requested).toBe(true);
    await control('Cancel script preview').click();
    await expect(status).toContainText(/cancel|abort/i);
    await expect(state).toHaveText('{}');
  } finally {
    release();
  }
  await input.fill('{"work":true}');
  await control('Send input and step').click();
  await expect(status).toContainText('Script engine work limit exceeded.');
  await expect(state).toHaveText('{}');
  await expect(events).toContainText('0 JSON inputs');
  await expect.poll(() => page.workers().filter((worker) => workerUrl.test(worker.url())).length).toBe(0);
  await input.fill('{}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  const committed = await state.textContent();
  await input.fill('{"fail":true}');
  await control('Send input and step').click();
  await expect(status).toContainText('engine source failure (source line 2, column 18; advisory)');
  await expect(state).toHaveText(committed!);
  await expect(events).toContainText('1 JSON input');
  await control('Edit failing frame 1 source').click();
  const editor = sourceEditor(page.getByRole('dialog', { name: 'Edit frame source', exact: true }));
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('Error(', 'ErrorX'));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('heap-limited placed scripts preserve Graphic, Movie and Button state and roll back a failed scene seek', async ({ page }) => {
  const project = newProject();
  project.width = 80;
  project.height = 40;
  project.duration = 3;
  const art: Vector = {
    id: 'art', kind: 'rectangle', x: 0, y: 0, width: 18, height: 18, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const marker = 'state.engine = typeof (globalThis as unknown as { fetch?: unknown }).fetch;';
  const body = marker + 'state.visits = Number(state.visits ?? 0) + 1; state.local = timeline.currentFrame;';
  project.symbols = [
    { id: 'graphic', name: 'Graphic', width: 18, height: 18, shapes: [art],
      timeline: { duration: 3, keys: [], frameScripts: [
        { frame: 0, source: body },
        { frame: 1, source: body + 'state.bytes = new Array(600000).join("01234567890123456789012345678901").length;' },
        { frame: 2, source: body },
      ] } },
    { id: 'movie', name: 'Movie', width: 18, height: 18, shapes: [art],
      timeline: { duration: 3, keys: [], frameScripts: [0, 1, 2].map((frame) => ({ frame, source: body })) } },
    { id: 'button', name: 'Button', width: 18, height: 18, shapes: [art],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: { duration: 4, keys: [
        { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 3, shapes: [art] },
      ], frameScripts: [0, 1, 2].map((frame) => ({ frame,
        source: body + 'if (input.buttonActivation) state.activations = Number(state.activations ?? 0) + 1;',
      })).concat({ frame: 3, source: 'throw new Error("Hit must stay idle");' }) } },
  ];
  project.layers[0].keys = [{ frame: 0, shapes: [
    { ...art, id: 'movie-instance', kind: 'symbol', symbolId: 'movie', instanceName: 'Clip', symbolPlayback: { mode: 'movie', firstFrame: 0 } },
    { ...art, id: 'button-instance', kind: 'symbol', symbolId: 'button', instanceName: 'Action', x: 48 },
    { ...art, id: 'graphic-instance', kind: 'symbol', symbolId: 'graphic', instanceName: 'Drawing', x: 24 },
  ] }];
  project.frameScripts = [0, 1, 2].map((frame) => ({ frame, source: marker + 'state.local = timeline.currentFrame; timeline.stop();' }));
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const control = (name: string) => dialog.getByRole('button', { name, exact: true });
  const status = dialog.getByRole('status');
  const artwork = dialog.getByAltText('Script preview artwork', { exact: true });
  const state = dialog.getByLabel('Script preview state', { exact: true });
  const placed = dialog.getByLabel('Placed symbol script states', { exact: true });
  const read = async () => JSON.parse((await placed.textContent())!) as {shapeId:string;frame:number;state:Record<string,unknown>;buttonVisual?:string}[];
  const completed = () => expect(status).toHaveText('Completed 1 script tick.');
  await dialog.getByLabel('Run placed symbol frame scripts').check();
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await dialog.getByLabel('Capture pointers on artwork').check();
  await dialog.getByLabel('Include button target for new pointers').check();
  await control('Step script tick').click();
  await completed();
  const first = await read();
  expect(first).toHaveLength(3);
  expect(first.map((entry) => entry.state.engine)).toEqual(['undefined', 'undefined', 'undefined']);
  expect(first.map((entry) => entry.frame)).toEqual([0, 0, 0]);

  for (const type of ['pointerdown', 'pointerup']) {
    await dialog.getByRole('application', { name: 'Script pointer target' }).evaluate((host, type) => {
      const image = host.querySelector('img')!, bounds = image.getBoundingClientRect();
      host.dispatchEvent(new PointerEvent(type, { pointerId: 23, button: 0, bubbles: true,
        clientX: bounds.left + bounds.width * 55 / image.naturalWidth,
        clientY: bounds.top + bounds.height * 8 / image.naturalHeight,
      }));
    }, type);
    await control('Deliver next pointer and step').click();
    await completed();
  }
  const activated = await read();
  expect(activated.find((entry) => entry.shapeId === 'button-instance')).toMatchObject({
    frame: 1, buttonVisual: 'over', state: { engine: 'undefined', visits: 3, activations: 1 },
  });
  expect(activated.find((entry) => entry.shapeId === 'movie-instance')).toMatchObject({ frame: 2, state: { visits: 3 } });
  const originalImage = await artwork.getAttribute('src'), originalState = await state.textContent();
  await dialog.getByLabel('Seek target frame').fill('2');
  await control('Seek stopped and step').click();
  await expect(status).toContainText(/Graphic graphic-instance, local frame 2:.*out of memory/i);
  expect(await read()).toEqual(activated);
  await expect(state).toHaveText(originalState!);
  await expect(artwork).toHaveAttribute('src', originalImage!);
  await expect(dialog.getByLabel('Retained script seek inputs')).toContainText('0 seek inputs');
  await dialog.getByLabel('Seek target frame').fill('3');
  await control('Seek stopped and step').click();
  await completed();
  const retried = await read();
  expect(retried.find((entry) => entry.shapeId === 'graphic-instance')).toMatchObject({ frame: 2, state: { visits: 2, engine: 'undefined' } });
  expect(retried.find((entry) => entry.shapeId === 'movie-instance')).toMatchObject({ frame: 0, state: { visits: 4, engine: 'undefined' } });
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 4 ticks');
  expect(await read()).toEqual(retried);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

async function openReplayProject(page: Page) {
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await open.or(recover).first().waitFor({ state: 'visible' });
  if (await open.isVisible()) await open.click();
  await recover.click();
}

test('interactive script HTML runs saved input offline in the bounded engine', async ({ page }, testInfo) => {
  test.skip(!process.env.SPLASH_TEST_LICENSE, 'Run with the isolated licensing fixture.');
  const project = newProject();
  project.name = 'Portable script';project.width=40;project.height=24;project.duration=3;
  const art = { id:'sample',kind:'rectangle' as const,x:0,y:0,width:20,height:20,rotation:0,stroke:'#000000',strokeWidth:0,points:[] };
  project.layers[0].keys = ['#ff0000','#00ff00','#0000ff'].map((fill,frame)=>({frame,shapes:[{...art,fill}]}));
  project.frameLabels = [{name:'Done',frame:2}];
  project.frameScripts = [{frame:0,source:`
    const host = globalThis as unknown as { fetch?: unknown; document?: unknown; Worker?: unknown };
    if (typeof host.fetch !== "undefined" || typeof host.document !== "undefined" || typeof host.Worker !== "undefined")
      throw new Error("Host capabilities leaked");
    state.escaped = "</script><img id=escaped-body src=https://example.invalid/>";
    if (input.loop === true) while (true) {}
    const roll = runtime.random();
    if (roll < 0 || roll >= 1) throw new Error("Random sample out of range");
    state.count = typeof state.count === "number" ? state.count + 1 : 1;
    if (state.count === 2 && input.next === true) timeline.gotoAndStop("Done");
    else timeline.stop();
  `}, {frame:1,source:'timeline.stop();'}];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),project);
  await openReplayProject(page);
  const recovery = await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Preview saved scripts'});
  const [download] = await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download interactive script HTML'}).click()]);
  const output = testInfo.outputPath('interactive.html');
  await download.saveAs(output);
  const offline = await page.context().browser()!.newContext({offline:true});
  try {
    const player = await offline.newPage();
    const requests: string[]=[];
    player.on('request',request=>{if(/^https?:/.test(request.url())) requests.push(request.url());});
    await player.goto(pathToFileURL(output).href);
    const status=player.getByRole('status'), canvas=player.locator('canvas');
    const pixels=()=>canvas.evaluate((node:HTMLCanvasElement)=>[...node.getContext('2d')!.getImageData(5,5,1,1).data]);
    await expect(status).toContainText('Ready. Press Play scripts');
    await expect(canvas).toHaveAttribute('data-tick','0');
    expect(await pixels()).toEqual([255,0,0,255]);
    await player.getByRole('button',{name:'Step script',exact:true}).click();
    await expect(status).toHaveText('Frame 1 · Tick 1');
    await expect(player.locator('#escaped-body')).toHaveCount(0);
    const input=player.getByLabel('Script input JSON');
    const send=player.getByRole('button',{name:'Send JSON'});
    await input.fill('{"loop":true}');await send.click();
    await expect(status).toContainText(/work limit|execution timed out/i);
    await expect(canvas).toHaveAttribute('data-tick','1');
    expect(await pixels()).toEqual([255,0,0,255]);
    await input.fill('{"next":true}');await send.click();
    await expect(status).toHaveText('Frame 3 · Tick 2');
    expect(await pixels()).toEqual([0,0,255,255]);
    await player.reload();
    await expect(status).toContainText('Ready. Press Play scripts');
    await player.getByRole('button',{name:'Step script',exact:true}).click();
    await expect(status).toHaveText('Frame 1 · Tick 1');
    await player.getByRole('button',{name:'Play scripts',exact:true}).click();
    await expect(status).toHaveText('Frame 2 · Tick 3');
    await expect(player.getByRole('button',{name:'Play scripts',exact:true})).toBeEnabled();
    expect(await pixels()).toEqual([0,255,0,255]);
    expect(requests).toEqual([]);
  } finally { await offline.close(); }
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('interactive script HTML rejects editor-only APIs before publication', async ({page}) => {
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Run with the isolated licensing fixture.');
  const project=newProject();
  project.frameScripts=[{frame:0,source:'stage?.setVisible("Actor", false);'}];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),project);
  await openReplayProject(page);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts'});
  let downloads=0;page.on('download',()=>downloads++);
  await dialog.getByRole('button',{name:'Download interactive script HTML'}).click();
  await expect(dialog.getByRole('status')).toContainText(/cannot find name 'stage'/i);
  expect(downloads).toBe(0);
});

test('interactive script HTML cancels or rejects missing runtime bytes before publication', async ({page}) => {
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Run with the isolated licensing fixture.');
  const project=newProject();
  project.frameScripts=[{frame:0,source:'timeline.stop();'}];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),project);
  await openReplayProject(page);
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts'});
  const save=dialog.getByRole('button',{name:'Download interactive script HTML'});
  const asset='**/standalone-script-runtime-*.js';
  let runtimeRequested!:()=>void, releaseRuntime!:()=>void;
  const reached=new Promise<void>(resolve=>{runtimeRequested=resolve;});
  const release=new Promise<void>(resolve=>{releaseRuntime=resolve;});
  await page.route(asset,async route=>{
    runtimeRequested();
    await release;
    await route.abort().catch(()=>{});
  });
  let downloads=0;page.on('download',()=>downloads++);
  await save.click();
  await reached;
  await dialog.getByRole('button',{name:'Cancel script preview',exact:true}).click();
  releaseRuntime();
  await page.unroute(asset);
  await expect(dialog.getByRole('status')).toContainText('cancelled');
  expect(downloads).toBe(0);
  await page.route(asset,route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await save.click();
  await expect(dialog.getByRole('status')).toContainText('could not be loaded as JavaScript');
  expect(downloads).toBe(0);
  await page.unroute(asset);
  await Promise.all([page.waitForEvent('download'),save.click()]);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

async function decodeScriptReplayVideo(page: Page, bytes: Buffer, ticks: number[], readAudio = false) {
  return page.evaluate(async ({ bytes, ticks, readAudio }) => {
    const blob = new Blob([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    const wait = (name: string) => new Promise<void>((resolve, reject) => {
      const failed = () => reject(Error('Script replay video could not be decoded.'));
      video.addEventListener('error', failed, { once: true });
      video.addEventListener(name, () => { video.removeEventListener('error', failed); resolve(); }, { once: true });
    });
    try {
      document.body.append(video);
      const loaded = wait('loadeddata');
      video.src = url;
      await loaded;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d')!;
      const pixels = [];
      for (const tick of ticks) {
        const seek = wait('seeked');
        video.currentTime = (tick + 0.5) / 10;
        await seek;
        context.drawImage(video, 0, 0);
        pixels.push([5, 29, 35].filter(x => x < canvas.width)
          .map(x => Array.from(context.getImageData(x, 2, 1, 1).data)));
      }
      const result = { duration: video.duration, pixels };
      if (!readAudio) return result;
      const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const levels = [[800,4000],[5300,9000],[10500,18500],[19800,23300],[24600,28200],[29500,33000]]
        .map(([start,end]) => {
          let dot = 0, weight = 0;
          for(let n=start;n<end;n++){
            const sin=Math.sin(n*2*Math.PI/240);
            dot+=samples[n]*sin;weight+=sin*sin;
          }
          return dot/weight;
        });
      return { ...result, samples: decoded.length, channels: decoded.numberOfChannels, levels };
    } finally {
      video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);
    }
  }, { bytes: bytes.toString('base64'), ticks, readAudio });
}

test('script replay HTML and WebM preserve recorded sound with the visual clock',async({page},testInfo)=>{
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Download requires the licensed browser fixture.');
  const project=newProject();
  project.name='Sound replay';project.width=20;project.height=10;project.duration=2;project.fps=10;
  const art={id:'ink',kind:'rectangle' as const,x:0,y:0,width:20,height:10,rotation:0,stroke:'#000000',strokeWidth:0,points:[],fill:'#ff0000'};
  project.layers[0].keys.push({frame:1,shapes:[art]});
  project.assets=[{id:'tone',path:'assets/audio/tone.wav',audio:{name:'Tone',format:'pcm16-wav',sampleRate:8000,channels:1,frames:4000}}];
  project.libraryLinks=[{id:'tone',kind:'audio',name:'fx.Tone'}];
  project.frameScripts=[{frame:0,source:`
    const sound=stage!.sound!;
    if(input.play===true)sound.play("fx.Tone",800,.5);
    if(input.pause===true)sound.pause();
    if(input.resume===true)sound.resume();
    if(typeof input.seek==="number")sound.seekSamples(input.seek);
    if(input.stop===true){sound.stop();timeline.gotoAndStop(1);}else timeline.stop();
  `}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await openReplayProject(page);
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status');
  await dialog.getByLabel('Render detached artwork').check();
  await dialog.getByLabel('Enable scripted sound').check();
  const samples=Float32Array.from({length:4000},(_,i)=>[0,.5,-.5,.25,-.25][Math.floor(i/800)]*Math.sin(i*2*Math.PI/40));
  await dialog.getByLabel('WAV for fx.Tone').setInputFiles({
    name:'tone.wav',mimeType:'audio/wav',buffer:Buffer.from(encodePcm16Wav([samples],8000)),
  });
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  for(const input of [{play:true},{pause:true},{seek:1600},{resume:true},{seek:2400},{stop:true}]){
    await dialog.getByLabel('Script input JSON').fill(JSON.stringify(input));
    await control('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  }
  // Replacing the picker after Prepare must not alter the committed recording.
  await dialog.getByLabel('WAV for fx.Tone').setInputFiles({
    name:'other.wav',mimeType:'audio/wav',buffer:Buffer.from(encodePcm16Wav([new Float32Array(4000)],8000)),
  });
  let downloads=0;
  page.on('download',()=>downloads++);
  const previewImage=await dialog.getByAltText('Script preview artwork').getAttribute('src');
  await page.evaluate(()=>{
    const prototype=OfflineAudioContext.prototype,render=prototype.startRendering;
    prototype.startRendering=function(){
      prototype.startRendering=render;
      document.body.dataset.replayWave='waiting';
      return new Promise((resolve,reject)=>{
        document.addEventListener('finish-test-wave',()=>{
          render.call(this).then(output=>{
            document.body.dataset.replayWave='finished';
            resolve(output);
          },reject);
        },{once:true});
      });
    };
  });
  await control('Download script replay HTML').click();
  await expect(page.locator('body')).toHaveAttribute('data-replay-wave','waiting');
  await control('Cancel script preview').click();
  await expect(status).toContainText(/cancel|abort/i);
  expect(downloads).toBe(0);
  await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',previewImage!);
  await page.evaluate(()=>document.dispatchEvent(new Event('finish-test-wave')));
  await expect(page.locator('body')).toHaveAttribute('data-replay-wave','finished');
  const [download]=await Promise.all([page.waitForEvent('download'),control('Download script replay HTML').click()]);
  await expect(status).toHaveText('Downloaded script replay HTML with 6 recorded ticks.');
  const html=await readFile((await download.path())!,'utf8');
  expect(html).not.toContain('sound.play("fx.Tone"');
  const encoded=html.match(/data:audio\/wav;base64,([A-Za-z0-9+/=]+)/)?.[1];
  expect(encoded).toBeDefined();
  const wave=decodePcm16Wav(Buffer.from(encoded!,'base64'));
  expect(wave).toMatchObject({sampleRate:8000,frames:5600});
  const pcm=wave.channels[0];
  for(const [start,end,level] of [
    [0,800,0],[800,1600,.25],[1600,3200,0],[3200,4000,-.25],[4000,4800,.125],[4800,5600,0],
  ])expect(pcm.slice(start,end).every((v,i)=>Math.abs(v-level*Math.sin((start+i)*2*Math.PI/40))<.0001)).toBe(true);

  const replay=await page.context().newPage();
  await replay.setContent(html);
  const canvas=replay.locator('canvas'),play=replay.getByRole('button',{name:'Play replay',exact:true});
  await expect(play).toBeEnabled();
  await expect(canvas).toHaveAttribute('data-tick','0');
  expect(await replay.locator('audio').evaluate(audio=>(audio as HTMLAudioElement).paused)).toBe(true);
  await play.click();
  await expect(replay.getByRole('button',{name:'Replay finished'})).toBeDisabled();
  await expect(canvas).toHaveAttribute('data-tick','6');
  await expect(canvas).toHaveAttribute('data-frame','1');
  expect(await canvas.evaluate(canvas=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(4,4,1,1).data))).toEqual([255,0,0,255]);
  await replay.close();
  await page.evaluate(()=>{
    const flush=VideoEncoder.prototype.flush;
    VideoEncoder.prototype.flush=function(){
      VideoEncoder.prototype.flush=flush;
      document.body.dataset.replayVideo='waiting';
      return new Promise<void>(()=>{});
    };
  });
  const exportVideo=control('Download script replay WebM');
  await exportVideo.click();
  await expect(page.locator('body')).toHaveAttribute('data-replay-video','waiting');
  await control('Cancel script preview').click();
  await expect(page.locator('iframe[title="Script artwork renderer"]')).toHaveCount(0);
  await expect(status).toContainText(/cancel|abort/i);
  expect(downloads).toBe(1);
  await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',previewImage!);

  const [video]=await Promise.all([page.waitForEvent('download'),exportVideo.click()]);
  await expect(status).toHaveText('Downloaded script replay WebM with 6 recorded ticks.');
  await video.saveAs(testInfo.outputPath('recorded-replay.webm'));
  const output=await decodeScriptReplayVideo(page,await readFile((await video.path())!),[6,0],true);
  expect(output.duration).toBeCloseTo(.7,2);
  if(!('samples' in output))throw Error('The downloaded video did not return decoded audio.');
  expect(output.samples).toBe(33600);
  expect(output.channels).toBe(1);
  for(const [index,expected] of [0,.25,0,-.25,.125,0].entries())
    expect(Math.abs(output.levels[index]-expected)).toBeLessThan(.035);
  const [[last],[initial]]=output.pixels;
  expect(last.every((sample,channel)=>Math.abs(sample-[255,0,0,255][channel])<=15)).toBe(true);
  expect(initial).toEqual([255,255,255,255]);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('script replay HTML paints spawned Graphics, bitmaps and timeline clocks at committed ticks', async ({page})=>{
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Download requires the licensed browser fixture.');
  const dataUrl=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,4,4);
    return canvas.toDataURL('image/png');
  });
  const project=newProject();
  project.name='Spawn replay';project.width=32;project.height=10;project.duration=3;project.fps=10;
  const art={id:'ink',kind:'rectangle' as const,x:0,y:0,width:4,height:4,rotation:0,stroke:'#000000',strokeWidth:0,points:[],fill:'#ff0000'};
  const timeline={duration:2,keys:[{frame:1,shapes:[{...art,fill:'#0000ff'}]}]};
  project.layers[0].keys[0].shapes=[{...art,fill:'#008000'}];
  project.symbols=[
    {id:'badge',name:'Badge',width:4,height:4,shapes:[art]},
    {id:'graphic',name:'Graphic',width:4,height:4,shapes:[art],timeline},
    {id:'movie',name:'Movie',width:4,height:4,shapes:[art],timeline:{...timeline,
      frameScripts:[{frame:0,source:'throw new Error("Descendant source must stay idle");'}]},defaultPlayback:'movie'},
  ];
  project.assets=[
    {id:'image',path:'assets/bitmaps/image.json',bitmap:{name:'Image',width:4,height:4,dataUrl}},
    {id:'damaged',path:'assets/bitmaps/damaged.json',bitmap:{name:'Damaged',width:4,height:4,dataUrl:dataUrl.slice(0,66)}},
  ];
  project.libraryLinks=[
    {id:'graphic',kind:'symbol',name:'art.Graphic'},
    {id:'movie',kind:'symbol',name:'art.Movie'},
    {id:'image',kind:'bitmap',name:'art.Bitmap'},
    {id:'damaged',kind:'bitmap',name:'art.Damaged'},
  ];
  project.frameScripts=[{frame:0,source:`
    if (!stage) throw Error("Stage is unavailable.");
    if(input.create===true){
      stage.spawnGraphic("Badge","badge",{x:0,y:0,rotation:0});
      stage.library.spawnBitmap("art.Bitmap","Bitmap",{x:7,y:0,rotation:0});
      stage.library.spawnGraphic("art.Graphic","Graphic",{x:14,y:0,rotation:0});
      stage.library.spawnGraphic("art.Movie","Movie",{x:22,y:0,rotation:0});
    }
    if(input.remove===true){
      stage.removeSpawned("Badge");stage.removeSpawned("Bitmap");
      stage.removeSpawned("Graphic");stage.removeSpawned("Movie");
    }
    if(input.armDamage===true){state.damage=1;timeline.gotoAndPlay(1);}
    else timeline.stop();
  `},{frame:1,source:`
    if(state.damage===1){
      stage!.library.spawnBitmap("art.Damaged","Damaged",{x:7,y:0,rotation:0});
      state.damage=2;
      timeline.gotoAndPlay(2);
    }else timeline.stop();
  `},{frame:2,source:`
    if(state.damage===2){
      stage!.removeSpawned("Damaged");
      delete state.damage;
      state.damageWasRemoved=true;
      timeline.gotoAndStop(0);
    }else timeline.stop();
  `}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status');
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  async function send(input:object){
    await dialog.getByLabel('Script input JSON').fill(JSON.stringify(input));
    await control('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  }
  async function seek(frame:number){
    await dialog.getByLabel('Seek target frame').fill(String(frame));
    await control('Seek stopped and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  }
  await send({create:true});
  await send({});
  await seek(2);
  await seek(1);
  await send({remove:true});
  await send({create:true});
  const [download]=await Promise.all([page.waitForEvent('download'),control('Download script replay HTML').click()]);
  await expect(status).toHaveText('Downloaded script replay HTML with 6 recorded ticks.');
  const html=await readFile((await download.path())!,'utf8');
  expect(html).not.toContain('Descendant source must stay idle');
  expect(html).not.toContain('stage.library.spawnBitmap');
  const replay=await page.context().newPage();
  await replay.setContent(html.replace('<script>','<script>window.framesToRun=[];requestAnimationFrame=cb=>{window.framesToRun.push(cb);};'));
  await replay.waitForFunction(()=>((window as Window&{framesToRun?:unknown[]}).framesToRun?.length??0)>0);
  const clear=[255,255,255,255],red=[255,0,0,255],blue=[0,0,255,255],green=[0,128,0,255],pink=[255,0,255,255];
  const empty=[green,clear,clear,clear],created=[red,pink,red,red];
  const poses=[empty,created,[red,pink,red,blue],[red,pink,blue,red],[red,pink,red,blue],empty,created];
  for(const [tick,pixels] of poses.entries()){
    expect(await replay.evaluate(time=>{
      const host=window as Window&{framesToRun?:FrameRequestCallback[]};
      const draw=host.framesToRun?.shift();
      if(!draw)throw Error('Playback frame was not scheduled.');
      draw(time);
      const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
      return [canvas.dataset.tick,...[2,9,16,24].map(x=>Array.from(ctx.getImageData(x,2,1,1).data))];
    },1000+100*tick)).toEqual([String(tick),...pixels]);
  }
  await expect(replay.locator('canvas')).toHaveAttribute('data-capture','ready');
  await replay.close();
  await send({armDamage:true});
  await control('Run 10 script ticks').click();
  await expect(status).toHaveText('Completed 10 script ticks.');
  await expect(dialog.getByLabel('Script preview state')).toContainText('"damageWasRemoved": true');
  const imageBefore=await dialog.getByAltText('Script preview artwork').getAttribute('src');
  const lateDownloads:string[]=[];
  page.on('download',file=>lateDownloads.push(file.suggestedFilename()));
  await control('Download script replay HTML').click();
  await expect(status).toContainText('Script artwork rendering failed.');
  expect(lateDownloads).toEqual([]);
  await expect(dialog.getByAltText('Script preview artwork')).toHaveAttribute('src',imageBefore!);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('script replay HTML restores a reflected animated Graphic across authored exposures', async ({page})=>{
  test.skip(!process.env.SPLASH_TEST_LICENSE,'Download requires the licensed browser fixture.');
  const project=newProject();
  project.name='Transform replay';project.width=42;project.height=16;project.duration=4;project.fps=10;
  const red={id:'color',kind:'rectangle' as const,x:0,y:0,width:4,height:2,rotation:0,stroke:'#000000',strokeWidth:0,points:[],fill:'#ff0000'};
  project.symbols=[
    {id:'art',name:'Actor',width:4,height:2,shapes:[red],
      timeline:{duration:2,keys:[{frame:1,shapes:[{...red,fill:'#0000ff'}]}]}},
    {id:'button',name:'Button',width:4,height:2,shapes:[{...red,fill:'#008000'}],buttonStates:{up:0,over:0,down:0,hit:0}},
  ];
  const actor={...red,id:'actor',kind:'symbol' as const,instanceName:'Actor',symbolId:'art',x:3,y:3};
  const button={...actor,id:'button',instanceName:'Button',symbolId:'button',x:34};
  project.layers[0].keys=[{frame:0,shapes:[actor,button]},{frame:2,shapes:[{...actor,x:8},button]}];
  project.frameScripts=[{frame:0,source:`
    if(input.move===true){
      stage!.setTransform("Actor",{x:20,y:10,rotation:90});
      stage!.setBasis("Actor",[-2,0,0,1]);
    }
    if(input.restore===true){
      stage!.setBasis("Actor",[1,0,0,1]);
      stage!.setTransform("Actor",{x:3,y:3,rotation:0});
    }
    timeline.stop();
  `}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const control=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status');
  await dialog.getByLabel('Render detached artwork').check();
  await control('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  async function send(input:object){
    await dialog.getByLabel('Script input JSON').fill(JSON.stringify(input));
    await control('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  }
  async function seek(frame:number){
    await dialog.getByLabel('Seek target frame').fill(String(frame));
    await control('Seek stopped and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  }
  await send({move:true});
  await seek(2);
  await seek(3);
  await seek(1);
  await send({restore:true});
  await expect(dialog.getByLabel('Script preview state')).not.toContainText('$splashPlacementTransforms');
  const [download]=await Promise.all([page.waitForEvent('download'),control('Download script replay HTML').click()]);
  await expect(status).toHaveText('Downloaded script replay HTML with 5 recorded ticks.');
  const html=await readFile((await download.path())!,'utf8');
  expect(html).not.toContain('setTransform("Actor"');
  const replay=await page.context().newPage();
  await replay.setContent(html.replace('<script>','<script>window.framesToRun=[];requestAnimationFrame=cb=>{window.framesToRun.push(cb);};'));
  await replay.waitForFunction(()=>((window as Window&{framesToRun?:unknown[]}).framesToRun?.length??0)>0);
  const clear=[255,255,255,255], redPixel=[255,0,0,255], bluePixel=[0,0,255,255], green=[0,128,0,255];
  const poses=[
    [redPixel,clear,clear],[clear,redPixel,clear],[clear,bluePixel,clear],
    [clear,clear,redPixel],[clear,redPixel,clear],[redPixel,clear,clear],
  ];
  for(const [tick,pixels] of poses.entries()){
    expect(await replay.evaluate(time=>{
      const host=window as Window&{framesToRun?:FrameRequestCallback[]};
      const draw=host.framesToRun?.shift();
      if(!draw)throw Error('Playback frame was not scheduled.');
      draw(time);
      const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
      return [canvas.dataset.tick,...[[4,4],[19,6],[9,4],[35,4]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data))];
    },1000+100*tick)).toEqual([String(tick),...pixels,green]);
  }
  await expect(replay.locator('canvas')).toHaveAttribute('data-capture','ready');
  await replay.close();
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
});

test('script replay HTML and WebM download the verified scene trajectory and keep ordinary export separate', async ({page},testInfo)=>{
  const project=newProject();
  project.name='Replay proof';project.width=40;project.height=24;project.duration=3;project.fps=10;
  const box={id:'color',kind:'rectangle' as const,x:0,y:0,width:18,height:18,rotation:0,stroke:'#000000',strokeWidth:0,points:[]};
  const small={...box,width:4,height:4,fill:'#ff0000'};
  project.symbols=[
    {id:'art',name:'Art',width:4,height:4,shapes:[small]},
    {id:'button',name:'Signal',width:4,height:4,shapes:[{...small,fill:'#008000'}],
      buttonStates:{up:0,over:1,down:1,hit:1},timeline:{duration:2,keys:[{frame:1,shapes:[{...small,fill:'#0000ff'}]}]}},
  ];
  const instance={...box,id:'instance',kind:'symbol' as const,instanceName:'Action',symbolId:'art',x:28,width:4,height:4,fill:'#ff0000'};
  const signal={...instance,id:'button',instanceName:'Signal',symbolId:'button',x:34};
  project.layers[0].keys=['#ff0000','#00ff00','#0000ff'].map((fill,frame)=>({frame,shapes:[{...box,fill},instance,signal]}));
  project.frameScripts=[{frame:0,source:`state.privateReplayMarker = "source-only"; if(input.jump===true) timeline.gotoAndStop(2);
    else { if(input.hide===true){stage!.setVisible("Action",false);stage!.setVisible("Signal",false);}
      if(input.show===true){stage!.setVisible("Action",true);stage!.setVisible("Signal",true);} timeline.stop(); }`}];
  await page.addInitScript(project=>{if(window===window.top)localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},project);
  await openReplayProject(page);
  const recovery=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved scripts…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preview saved scripts',exact:true});
  const button=(name:string)=>dialog.getByRole('button',{name,exact:true});
  const status=dialog.getByRole('status'),exportReplay=button('Download script replay HTML');
  await dialog.getByLabel('Render detached artwork').check();
  await button('Prepare script preview').click();
  await expect(status).toHaveText('Ready. No scripts have run.');
  await expect(exportReplay).toBeDisabled();
  await button('Step script tick').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  if(!process.env.SPLASH_TEST_LICENSE){
    await expect(exportReplay).toBeDisabled();
    return;
  }
  async function send(input:object){
    await dialog.getByLabel('Script input JSON').fill(JSON.stringify(input));
    await button('Send input and step').click();await expect(status).toHaveText('Completed 1 script tick.');
  }
  await send({jump:true});
  let downloads=0;
  page.on('download',()=>downloads++);
  await page.evaluate(()=>{
    const append=document.body.append;
    document.body.append=function(...nodes){
      const frame=nodes.find((node):node is HTMLIFrameElement=>node instanceof HTMLIFrameElement&&node.title==='Script artwork renderer');
      if(frame){document.body.append=append;frame.onload=null;frame.dataset.pendingReplayExport='true';}
      append.apply(document.body,nodes);
    };
  });
  await exportReplay.click();
  const pending=page.locator('iframe[data-pending-replay-export]');
  await expect(pending).toHaveCount(1);
  await button('Cancel script preview').click();
  await expect(pending).toHaveCount(0);
  await expect(status).toContainText(/cancel|abort/i);
  await expect(dialog.getByText(/Frame 3 · Tick 2/)).toBeVisible();
  expect(downloads).toBe(0);
  const seekFirst=async()=>{
    await dialog.getByLabel('Seek target frame').fill('1');
    await button('Seek stopped and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  };
  await seekFirst();
  await dialog.getByLabel('Capture pointers on artwork').check();
  await dialog.getByLabel('Include button target for new pointers').check();
  await dialog.getByRole('application',{name:'Script pointer target'}).evaluate(host=>{
    const image=host.querySelector('img')!,rect=image.getBoundingClientRect();
    host.dispatchEvent(new PointerEvent('pointerdown',{pointerId:21,button:0,bubbles:true,
      clientX:rect.left+rect.width*35/image.naturalWidth,clientY:rect.top+rect.height*2/image.naturalHeight}));
  });
  await button('Deliver next pointer and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  const press=dialog.getByLabel('Script button press');
  await expect(press).toContainText('Pressed: Signal');
  await send({hide:true});
  await expect(press).toHaveText('No button press active.');
  await send({jump:true});
  await seekFirst();
  await send({show:true});
  await expect(dialog.getByLabel('Script preview state')).not.toContainText('$splashHiddenPlacements');
  const [download]=await Promise.all([page.waitForEvent('download'),exportReplay.click()]);
  expect(download.suggestedFilename()).toBe('Replay proof-script-replay.html');
  const html=await readFile((await download.path())!,'utf8');
  expect(html.includes('privateReplayMarker')).toBe(false);
  await expect(status).toHaveText('Downloaded script replay HTML with 8 recorded ticks.');
  const playback=await page.context().newPage();
  await playback.setContent(html.replace('<script>','<script>window.framesToRun=[];requestAnimationFrame=cb=>{window.framesToRun.push(cb);};'));
  const advance=(time:number)=>playback.evaluate(time=>{
    const host=window as Window&{framesToRun?:FrameRequestCallback[]};
    const draw=host.framesToRun?.shift();
    if(!draw)throw Error('Playback frame was not scheduled.');
    draw(time);
    const canvas=document.querySelector('canvas')!;
    const ctx=canvas.getContext('2d')!;
    return [canvas.dataset.tick,...[5,29,35].map(x=>Array.from(ctx.getImageData(x,2,1,1).data))];
  },time);
  await playback.waitForFunction(()=>((window as Window&{framesToRun?:unknown[]}).framesToRun?.length??0)>0);
  const red=[255,0,0,255],green=[0,128,0,255],blue=[0,0,255,255],white=[255,255,255,255];
  expect(await advance(1000)).toEqual(['0',red,red,green]);
  expect(await advance(1099)).toEqual(['0',red,red,green]);
  expect(await advance(1100)).toEqual(['1',red,red,green]);
  expect(await advance(1200)).toEqual(['2',blue,red,green]);
  expect(await advance(1400)).toEqual(['4',red,red,blue]);
  expect(await advance(1500)).toEqual(['5',red,white,white]);
  expect(await advance(1600)).toEqual(['6',blue,red,green]);
  expect(await advance(1700)).toEqual(['7',red,white,white]);
  expect(await advance(1800)).toEqual(['8',red,red,green]);
  await expect(playback.locator('canvas')).toHaveAttribute('data-capture','ready');
  await playback.close();
  expect(downloads).toBe(1);
  const exportVideo=button('Download script replay WebM');
  const [video]=await Promise.all([page.waitForEvent('download'),exportVideo.click()]);
  expect(video.suggestedFilename()).toBe('Replay proof-script-replay.webm');
  await video.saveAs(testInfo.outputPath('recorded-replay.webm'));
  const decoded=await decodeScriptReplayVideo(page,await readFile((await video.path())!),[8,5,4,2,0]);
  expect(decoded.duration).toBeCloseTo(.9,2);
  for(const [index,colors] of [[red,red,green],[red,white,white],[red,red,blue],[blue,red,green],[red,red,green]].entries())
    for(const [probe,color] of colors.entries())
      expect(decoded.pixels[index][probe].every((sample,channel)=>
        Math.abs(sample-color[channel])<=(color===green&&channel===1?28:15)),JSON.stringify(decoded.pixels)).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
  await button('Reset script preview').click();
  await expect(status).toHaveText('Reset to the initial preview state.');
  await button('Step script tick').click();await expect(status).toHaveText('Completed 1 script tick.');
  await page.evaluate(()=>{
    const create=URL.createObjectURL;
    URL.createObjectURL=function(blob){
      const url=create.call(URL,blob);
      if(blob instanceof Blob&&blob.type==='text/html'){
        URL.createObjectURL=create;
        document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Preview saved scripts"] [aria-label="Close dialog"]')!.click();
      }
      return url;
    };
  });
  await exportReplay.click();
  await expect(dialog).toHaveCount(0);
  expect(downloads).toBe(2);
  const [ordinary]=await Promise.all([page.waitForEvent('download'),exportHtmlFromShortcut(page)]);
  const files=await readWebDownload(ordinary);
  const plain=Array.from(files.values(), file=>file.toString()).join('\n');
  expect(ordinary.suggestedFilename()).toBe('Replay-proof-web.zip');
  expect(plain.includes('privateReplayMarker')).toBe(false);
  expect(plain).not.toContain('let first,next=0,hidden');
});
async function openEditorFromStartup(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: 'Open editor', exact: true });
  const menu = page.getByRole('navigation', { name: 'Application menu' });
  await expect(open.or(menu)).toBeVisible({ timeout: 15_000 });
  if (await open.isVisible()) await open.click();
}

async function setup(page: Page, source: string | null = 'timeline.stop();') {
  const errors: string[] = [],
    workers: { url: string; closed: boolean }[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('worker', (worker) => {
    const item = { url: worker.url(), closed: false };
    workers.push(item);
    worker.on('close', () => (item.closed = true));
  });
  await openEditorFromStartup(page);
  expect(requests.some(url => /source-code-editor|language-worker/.test(url))).toBe(false);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Check frame TypeScript…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Check frame TypeScript', exact: true });
  if (source !== null) await fillSource(sourceEditor(d), source);
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  return { d, before, workers, requests, errors };
}
async function code(page: Page, d: ReturnType<Page['getByRole']>) {
  const input = d.getByRole('textbox', { name: 'Frame source code editor', exact: true });
  await expect(input).toBeVisible();
  return input;
}
test('Monaco is lazy, completes typed timeline capabilities and closes its language worker', async ({
  page,
}) => {
  const f = await setup(page, 'timeline.');
  const input = await code(page, f.d);
  await input.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Space');
  const suggestion = f.d.getByRole('listitem', { name: /gotoAndStop/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await page.keyboard.press('Escape');
  await expectSource(sourceEditor(f.d), 'timeline.gotoAndStop');
  await f.d.getByRole('button', {name:'Close dialog', exact:true}).click();
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  expect(f.workers.some((w) => /language-worker/.test(w.url))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
test('Monaco preserves text through editing and local undo and explicit type checks', async ({
  page,
}) => {
  const f = await setup(page, 'const emoji="😀";\ntimeline.stop();'),
    input = await code(page, f.d);
  await input.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('x');
  await page.keyboard.press('Control+z');
  await expectSource(sourceEditor(f.d),
    'const emoji="😀";\ntimeline.stop();',
  );
  await code(page, f.d);
  await f.d.getByRole('button', { name: 'Check TypeScript', exact: true }).click();
  await expect(f.d.getByRole('status')).toHaveText('No type errors. Source was not executed.');
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
test('Monaco uses authoritative source diagnostics and navigation without executing code', async ({
  page,
}) => {
  const f = await setup(page, 'const n: number=1;\ntimeline.gotoAndStop(false);');
  await code(page, f.d);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toContainText(
    '1 source diagnostic',
  );
  await f.d.getByRole('button', { name: 'Check TypeScript', exact: true }).click();
  await f.d.getByRole('button', { name: /Line 2, column/ }).click();
  const input = f.d.getByRole('textbox', { name: 'Frame source code editor', exact: true });
  await expect(input).toBeFocused();
  await fillSource(sourceEditor(f.d), 'throw Error("source must never run");');
  await code(page, f.d);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toHaveText(
    'Code editor ready. Source was not executed.',
  );
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});

for (const action of ['edit', 'close'] as const)
  test(`Monaco ${action} cancels a pending language worker without stale diagnostics`, async ({
    page,
  }) => {
    await page.route('**/assets/language-worker-*.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: 'while(true){}' }),
    );
    const f = await setup(page, 'timeline.bad();'),
      input = await code(page, f.d);
    await expect.poll(() => f.workers.length).toBe(1);
    if (action === 'edit') {
      await page.unroute('**/assets/language-worker-*.js');
      await input.focus();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText('timeline.stop();');
      await expect(f.d.getByLabel('Code editor status', { exact: true })).toHaveText(
        'Code editor ready. Source was not executed.',
      );
      await expect
        .poll(() => f.workers[0].closed, { message: JSON.stringify(f.workers) })
        .toBe(true);
      await expectSource(sourceEditor(f.d), 'timeline.stop();');
    }
    await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
    expect(f.errors).toEqual([]);
  });

test('Monaco worker failure keeps editable source and permits a fresh reopen', async ({ page }) => {
  await page.route('**/assets/language-worker-*.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'throw Error("worker load failure");' }),
  );
  const f = await setup(page),
    input = await code(page, f.d);
  await expect(input).toBeVisible();
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toContainText(
    'Source language worker failed',
  );
  await page.unroute('**/assets/language-worker-*.js');
  await expectSource(sourceEditor(f.d), 'timeline.stop();');
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Check frame TypeScript…', exact: true }).click();
  await code(page,f.d);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toHaveText(
    'Code editor ready. Source was not executed.',
  );
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('Monaco language deadline terminates a hanging worker while retaining source', async ({
  page,
}) => {
  await page.route('**/assets/language-worker-*.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'while(true){}' }),
  );
  const f = await setup(page);
  await code(page, f.d);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toContainText('timed out', {
    timeout: 7000,
  });
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  await expectSource(sourceEditor(f.d), 'timeline.stop();');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('Monaco coalesces typing into one frame edit on close with exact Undo Redo and reopen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openEditorFromStartup(page);
  const open = async () => {
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const input = await code(page, d);
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const source = 'const n: number = 3;\nstate.n=n; timeline.stop();';
  await input.focus();
  await page.keyboard.insertText(source.slice(0, 20));
  await page.keyboard.insertText(source.slice(20));
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  await d.getByRole('button', { name: 'Close dialog', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  const saved = await read();
  expect(saved.frameScripts).toEqual([{ frame: 0, source }]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await read()).frameScripts).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(saved);
  await open();
  await expectSource(sourceEditor(d), source);
  await code(page, d);
  await d.getByRole('button', { name: 'Remove frame source', exact: true }).click();
  await expect.poll(async () => (await read()).frameScripts).toBeUndefined();
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(saved);
  expect(errors).toEqual([]);
});

test('Monaco preserves saved CRLF source on no-op Apply and subsequent editing', async ({
  page,
}) => {
  const p = newProject(),
    source = 'const emoji="😀";\r\ntimeline.stop();';
  p.frameScripts = [{ frame: 0, source }];
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
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true }),
    before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1')),
    input = await code(page, d);
  await d.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  await input.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nstate.n=1;');
  await d.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  const actual = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source,
  );
  expect(actual).toBe(source + '\r\nstate.n=1;');
});

test('closing while Monaco loads cannot create a late editor or worker', async ({ page }) => {
  let held: import('@playwright/test').Route | undefined;
  await page.route('**/assets/source-code-editor-*.js', async (route) => {
    held = route;
  });
  const f = await setup(page,null);
  await expect.poll(() => !!held).toBe(true);
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await held!.continue();
  await page.waitForLoadState('networkidle');
  expect(f.workers).toHaveLength(0);
  await page.unroute('**/assets/source-code-editor-*.js');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Check frame TypeScript…', exact: true }).click();
  await code(page, f.d);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toHaveText(
    'Code editor ready. Source was not executed.',
  );
  await f.d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  expect(f.errors).toEqual([]);
});

test('Monaco module failure shows a load error without another editor', async ({
  page,
}) => {
  await page.route('**/assets/source-code-editor-*.js', (route) => route.abort());
  const f = await setup(page,null);
  await expect(f.d.getByLabel('Code editor status', { exact: true })).toContainText('Monaco could not load');
  await expect(sourceEditor(f.d)).toHaveCount(0);
  await expect(f.d.getByRole('button', { name: 'Check TypeScript', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('Monaco keeps an oversized frame draft open on close and accepts a corrected retry', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true }),
    before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1')),
    input = await code(page, d),
    source = 'é'.repeat(131073);
  await input.focus();
  await input.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, source);
  await expect(d.getByLabel('Code editor status', { exact: true })).toContainText(
    'Invalid source language request',
  );
  const close = d.getByRole('button', { name: 'Close dialog', exact: true });
  await close.click();
  await expect(d.getByRole('button', { name: 'Discard frame draft and close' })).toBeVisible();
  await expect(d.getByLabel('Frame save status')).toContainText('frame script');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  await expectSource(sourceEditor(d), source);
  await fillSource(sourceEditor(d), 'const unfinished =');
  await close.click();
  await expect(d).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts,
  )).toEqual([{ frame: 0, source: 'const unfinished =' }]);
});

test('Monaco blur save rejects an actual intervening document Undo and retains the draft', async ({
  page,
}) => {
  await page.goto('/');
  const open = async () => {
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await fillSource(sourceEditor(d), 'state.original=true;');
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await open();
  const input = await code(page, d);
  await input.focus();
  await page.keyboard.press('Control+a');
  await page
    .getByRole('button', { name: 'Edit', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page
    .getByRole('button', { name: /^Undo Apply frame source/ })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  await expect.poll(async () => (await read()).frameScripts).toBeUndefined();
  const original = await read();
  await fillSource(sourceEditor(d), 'state.candidate=true;');
  await d.getByRole('button', { name: 'Check TypeScript', exact: true }).focus();
  await expect(d.getByLabel('Frame save status')).toContainText('Frame source changed');
  await expect(d.getByRole('button', { name: 'Apply frame source', exact: true }))
    .toHaveAccessibleDescription(/Frame source changed/);
  expect(await read()).toEqual(original);
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expectSource(sourceEditor(d), 'state.candidate=true;');
  await d.getByRole('button', { name: 'Discard frame draft and close' }).click();
  await expect(d).toHaveCount(0);
  expect(await read()).toEqual(original);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await read()).frameScripts)
    .toEqual([{ frame: 0, source: 'state.original=true;' }]);
});

test('saved script preview confines keyboard focus and delivers captured keys explicitly', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: 'if (typeof input.key === "string") state.key = input.key; timeline.stop();' }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await recovery();
  const control = page.getByRole('button', { name: 'Control', exact: true });
  await control.press('ArrowDown');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Preview saved scripts…', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  await expect(close).not.toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  const tabTo = async (target: typeof close) => {
    for (let i = 0; i < 45 && !await target.evaluate(element => element === document.activeElement); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
  };
  await tabTo(dialog.getByRole('button', { name: 'Prepare script preview', exact: true }));
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Ready. No scripts have run.');
  const state = dialog.getByLabel('Script preview state');
  await expect(state).toHaveText('{}');
  await tabTo(dialog.getByRole('checkbox', { name: 'Capture keys in target' }));
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Keyboard capture target' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Queued keyboard inputs')).toContainText('2 keyboard events');
  await expect(state).toHaveText('{}');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Deliver next key and step' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(state).toContainText('"key": "Escape"');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(control).toBeFocused();
  expect(await recovery()).toBe(before);
});

test('saved frame source check supports keyboard dismissal and diagnostic navigation', async ({ page }) => {
  const project = newProject();
  const source = '// Authored frame\nconst count: number = "bad";';
  project.duration = 2;
  project.frameScripts = [{ frame: 1, source }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await recovery();
  const control = page.getByRole('button', { name: 'Control', exact: true });
  const open = async () => {
    await control.press('ArrowDown');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Check saved frame sources…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
  };
  const dialog = page.getByRole('dialog', { name: 'Check saved frame sources', exact: true });
  const check = dialog.getByRole('button', { name: 'Check all saved sources', exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await open();
  await expect(check).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(check).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(control).toBeFocused();

  let allowCompile!: () => void;
  const compileGate = new Promise<void>(resolve => { allowCompile = resolve; });
  const moduleRequest = /\/compile-program(?:-[^/]+\.js|\.ts)(?:\?|$)/;
  await page.route(moduleRequest, async route => {
    await compileGate;
    await route.continue();
  }, { times: 1 });
  await open();
  try {
    const started = page.waitForRequest(moduleRequest);
    await page.keyboard.press('Enter');
    await started;
    await expect(dialog.getByRole('button', { name: 'Cancel program check', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('status')).toHaveText('Program check cancelled.');
    await expect(check).toBeFocused();
  } finally {
    allowCompile();
  }
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toContainText('Checked 1 of 1 saved bodies.');
  await expect(check).toBeFocused();
  await page.keyboard.press('Tab');
  const diagnostic = dialog.getByRole('button', { name: /^Frame 2, line 2, column / });
  await expect(diagnostic).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const editor = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await expect(editor.getByRole('heading', { name: 'TypeScript for main frame 2' })).toBeVisible();
  await expectSource(sourceEditor(editor), source);
  await expect(sourceEditor(editor)).toBeFocused();
  expect(await recovery()).toBe(before);
});

test('frame save feedback distinguishes pending edits, applied source and diagnostics', async ({
  page,
}) => {
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true }),
    input = await code(page, d),
    source = 'const unfinished: =';
  const feedback = d.getByLabel('Frame save status', { exact: true });
  const check = d.getByRole('button', { name: 'Check TypeScript', exact: true });
  const apply = d.getByRole('button', { name: 'Apply frame source', exact: true });
  await expect(feedback).toBeEmpty();
  await expect(feedback).toHaveAttribute('aria-live', 'polite');
  await feedback.evaluate(node => {
    let updates = 0;
    new MutationObserver(() => node.setAttribute('data-announcement-updates', String(++updates)))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });
  await input.focus();
  await page.keyboard.insertText(source.slice(0, -2));
  await page.keyboard.insertText(source.slice(-2));
  await expect(feedback).toHaveAttribute('data-announcement-updates', '1');
  await expect(d.getByLabel('Code editor status', { exact: true })).toContainText(
    'source diagnostic',
  );
  await expect(feedback).toHaveText('Frame changes pending.');
  await expect(apply).toHaveAccessibleDescription('Frame changes pending.');
  await check.focus();
  await expect(feedback).toHaveText('Frame changes applied.');
  await expect(apply).toHaveAccessibleDescription('Frame changes applied.');
  await check.click();
  await expect(d.getByRole('status')).toContainText('diagnostic');
  await expect(feedback).toHaveText('Frame changes applied.');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts,
    ),
  ).toEqual([{ frame: 0, source }]);
});

test('Monaco keyboard users can indent undo and move focus out of the editor', async ({ page }) => {
  const f = await setup(page),
    input = await code(page, f.d);
  await input.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Tab');
  await expect(f.d.getByRole('button', { name: 'Check TypeScript', exact: true })).toBeFocused();
  await expectSource(sourceEditor(f.d), 'timeline.stop();');
  expect(f.errors).toEqual([]);
});

test('Monaco preserves a source BOM and projects raw diagnostic coordinates onto the model', async ({
  page,
}) => {
  const p = newProject(),
    source = '\uFEFFtimeline.gotoAndStop(false);';
  p.frameScripts = [{ frame: 0, source }];
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
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true }),
    before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await code(page, d);
  await d.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  await d.getByRole('button', { name: 'Check TypeScript', exact: true }).click();
  await d.getByRole('button', { name: /Line 1, column/ }).click();
  await page.keyboard.insertText('X');
  await d.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  const index = source.indexOf('false');
  const actual = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source,
  );
  expect(actual).toBe(source.slice(0, index) + 'X' + source.slice(index + 1));
  expect(actual.charCodeAt(0)).toBe(0xfeff);
});

test('Monaco keeps completed composition in the frame draft until leaving the editor', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: 'state.first = true;\n// ' }];
  await page.addInitScript((project) => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const editor = sourceEditor(panel);
  const apply = panel.getByRole('button', { name: 'Apply frame source', exact: true });
  const check = panel.getByRole('button', { name: 'Check TypeScript', exact: true });
  const workers = () => page.workers().filter((worker) => /language-worker(?:[-.])/.test(worker.url()));
  await editor.press('Control+End');
  await expect.poll(() => workers().length).toBe(1);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await expect(panel.locator('.view-lines:visible')).toContainText('にほん');
    await expect(apply).toBeDisabled();
    await expect(check).toBeDisabled();
    await expect.poll(() => workers().length).toBe(0);
    // Check past the language service's 300 ms debounce while the IME is still open.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(workers()).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    await cdp.send('Input.insertText', { text: '日本語' });
    await expect(apply).toBeEnabled();
    await expect.poll(() => workers().length).toBe(1);
  } finally {
    await cdp.detach();
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  const expected = project.frameScripts[0].source + '日本語';
  await expectSource(editor, expected);
  await panel.getByLabel('Script editor location').selectOption('timeline');
  await expectSource(editor, expected);
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source)).toBe(expected);
  await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => workers().length).toBe(0);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
});

test('script dock tabs expose one keyboard stop and named panels', async ({ page }) => {
  const { d, before } = await setup(page, 'const draft =');
  for (const dock of ['canvas', 'timeline']) {
    await d.getByLabel('Script editor location').selectOption(dock);
    const name = dock === 'canvas' ? 'Canvas' : 'Timeline';
    const tabs = page.getByRole('tablist', { name: dock + ' workspace', exact: true });
    const script = tabs.getByRole('tab', { name: 'Script Editor', exact: true });
    const artwork = tabs.getByRole('tab', { name, exact: true });
    await expect(script).toHaveAttribute('tabindex', '0');
    await expect(artwork).toHaveAttribute('tabindex', '-1');
    await expect(script).toHaveAttribute('aria-controls', dock + '-script-panel');
    await expect(artwork).toHaveAttribute('aria-controls', dock + '-workspace-panel');
    await expect(page.getByRole('tabpanel', { name: 'Script Editor', exact: true })).toBeVisible();
    await script.focus();
    await script.press('Home');
    await expect(artwork).toBeFocused();
    await expect(artwork).toHaveAttribute('aria-selected', 'true');
    await expect(artwork).toHaveAttribute('tabindex', '0');
    await expect(script).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
    await expect(d).toBeHidden();
    await artwork.press('ArrowLeft');
    await expect(script).toBeFocused();
    await expectSource(sourceEditor(d), 'const draft =');
    await script.press('ArrowRight');
    await expect(artwork).toBeFocused();
    await artwork.press('End');
    await expect(script).toBeFocused();
    await expect(script).toHaveAttribute('aria-selected', 'true');
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
});

test('hidden frame editor suspends its worker and keeps Monaco undo', async ({ page }) => {
  const { d } = await setup(page, 'timeline.stop();');
  await d.getByLabel('Script editor location').selectOption('canvas');
  const editor = sourceEditor(d);
  const workers = () => page.workers().filter((worker) => /language-worker(?:[-.])/.test(worker.url()));
  const frameModel = d.locator('.monaco-editor[data-uri*="/frame-"]');
  await fillSource(editor, 'timeline.stop();\nconst draft =');
  await expect.poll(() => workers().length).toBe(1);
  const uri = await frameModel.getAttribute('data-uri');
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await expect(d).toBeHidden();
  await expect.poll(() => workers().length).toBe(0);
  const scriptTab = page.getByRole('tab', { name: 'Script Editor', exact: true });
  await scriptTab.focus();
  await scriptTab.press('Enter');
  await expect(scriptTab).toBeFocused();
  await expect(scriptTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
  await expect.poll(() => workers().length).toBe(1);
  await expect(frameModel).toHaveAttribute('data-uri', uri!);

  await d.getByRole('button', { name: 'New TypeScript file', exact: true }).click();
  await d.getByLabel('New file path').fill('helper');
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(d.getByRole('textbox', { name: 'scripts/helper.ts', exact: true })).toBeVisible();
  await expect.poll(() => workers().length).toBe(0);
  await d.getByRole('tab', { name: 'Scratchpad', exact: true }).click();
  await expect(frameModel).toHaveAttribute('data-uri', uri!);
  await expectSource(editor, 'timeline.stop();\nconst draft =');
  await editor.press('Control+z');
  await expectSource(editor, 'timeline.stop();');
  await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(frameModel).toHaveCount(0);
  await expect.poll(() => workers().length).toBe(0);
});

test('Switching frame targets autosaves each source to its own frame', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 2;
  p.frameScripts = [
    { frame: 0, source: 'state.first=true;' },
    { frame: 1, source: 'state.second=true;' },
  ];
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
  const open = async () => {
    await page
      .getByRole('button', { name: 'Control', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await page
      .getByRole('button', { name: 'Edit current frame source…', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true }),
    input = await code(page, d);
  await input.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('state.updated=true;');
  await page
    .getByTitle('Last frame', { exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await open();
  await expect(d.getByRole('heading', { name: 'TypeScript for main frame 2', exact: true })).toBeVisible();
  await expectSource(sourceEditor(d), 'state.second=true;');

  await d.getByRole('tab',{name:/Frame 1/}).click();
  await expectSource(sourceEditor(d), 'state.updated=true;');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts)).toEqual([
    { frame: 0, source: 'state.updated=true;' },
    { frame: 1, source: 'state.second=true;' },
  ]);
});

test('direct frame source commands preserve composition until the original frame is confirmed', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [{ frame: 0, source: '// first ' }, { frame: 1, source: '// second' }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  // Deliver the menu command before a compositionend event can reach Monaco.
  async function controlCommand(name: string) {
    await page.getByRole('button', { name: 'Control', exact: true }).dispatchEvent('click', { detail: 1 });
    await page.getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  }
  await controlCommand('Edit current frame source…');
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const first = panel.getByRole('heading', { name: 'TypeScript for main frame 1', exact: true });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  await page.getByTitle('Last frame', { exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await sourceEditor(panel).press('Control+End');
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    const apply = panel.getByRole('button', { name: 'Apply frame source', exact: true });
    await expect(apply).toBeDisabled();
    await controlCommand('Edit current frame source…');
    await expect(first).toBeVisible();
    await controlCommand('Check frame TypeScript…');
    await expect(first).toBeVisible();
    await expect(panel.getByText('Finish entering text in the frame editor before switching files.')).toBeVisible();
    await expect(panel.locator('.view-lines:visible')).toContainText('にほん');
    expect(await saved()).toEqual(project.frameScripts);
    await cdp.send('Input.insertText', { text: '日本語' });
    await expect(apply).toBeEnabled();
  } finally { await cdp.detach(); }
  await controlCommand('Edit current frame source…');
  await expect(panel.getByRole('heading', { name: 'TypeScript for main frame 2', exact: true })).toBeVisible();
  await expectSource(sourceEditor(panel), '// second');
  await expect.poll(saved).toEqual([{ frame: 0, source: '// first 日本語' }, project.frameScripts[1]]);
  await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(saved).toEqual(project.frameScripts);
});

test('open script tabs support keyboard navigation, activation and close without changing other frames', async ({ page }) => {
  const p = newProject();
  p.duration = 3;
  p.frameScripts = [0, 1, 2].map(frame => ({ frame, source: '// original frame ' + (frame + 1) }));
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const files = dialog.getByRole('region', { name: 'Frame scripts', exact: true });
  await files.getByRole('button', { name: 'Frame 2', exact: true }).click();
  await files.getByRole('button', { name: 'Frame 3', exact: true }).click();
  const tabList = dialog.getByRole('tablist', { name: 'Open scripts', exact: true });
  const frameOne = tabList.getByRole('tab', { name: 'Frame 1', exact: true });
  const frameTwo = tabList.getByRole('tab', { name: 'Frame 2', exact: true });
  const frameThree = tabList.getByRole('tab', { name: 'Frame 3', exact: true });
  await expect(frameThree).toHaveAttribute('aria-selected', 'true');
  await frameThree.press('ArrowRight');
  await expect(frameOne).toBeFocused();
  await expect(frameThree).toHaveAttribute('aria-selected', 'true');
  await expect(frameOne).toHaveAttribute('tabindex', '0');
  await expect(frameThree).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(frameThree).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(frameTwo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(frameTwo).toHaveAttribute('aria-selected', 'true');
  const pane = dialog.getByRole('tabpanel', { name: 'Frame 2', exact: true });
  await expect(pane).toHaveAttribute('id', (await frameTwo.getAttribute('aria-controls'))!);
  await expect(sourceEditor(pane)).toBeVisible();
  await expect(frameTwo).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sourceEditor(pane)).toBeFocused();
  await fillSource(sourceEditor(pane), '// edited frame 2');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  expect(await read()).toEqual(p.frameScripts);
  await frameThree.focus();
  await page.keyboard.press('Enter');
  await expect(frameThree).toHaveAttribute('aria-selected', 'true');
  await expect.poll(read).toEqual([p.frameScripts![0], { frame: 1, source: '// edited frame 2' }, p.frameScripts![2]]);
  await page.keyboard.press('Delete');
  await expect(frameThree).toHaveCount(0);
  await expect(frameTwo).toBeFocused();
  await expect(frameTwo).toHaveAttribute('aria-selected', 'true');
  await expectSource(sourceEditor(pane), '// edited frame 2');
});

test('a delayed file open keeps unfinished composition in its original frame', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [{ frame: 0, source: '// first' }, { frame: 1, source: '// second ' }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: 'Compose.spl', manifest: null })), project);
  let startRead!: () => void, finishRead!: () => void;
  const readStarted = new Promise<void>(resolve => { startRead = resolve; });
  const allowRead = new Promise<void>(resolve => { finishRead = resolve; });
  await page.route('**/api/projects', async route => {
    const { op } = route.request().postDataJSON();
    if (op === 'read') { startRead(); await allowRead; }
    await route.fulfill({ json: { result: op === 'listScripts' ? ['scripts/slow.ts'] : op === 'read' ? 'const ready = true;' : null } });
  });
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await panel.getByRole('button', { name: 'Frame 2', exact: true }).click();
  const editor = sourceEditor(panel.getByRole('tabpanel'));
  const apply = panel.getByRole('button', { name: 'Apply frame source', exact: true });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  const cdp = await page.context().newCDPSession(page);
  try {
    await panel.getByRole('button', { name: 'slow.ts', exact: true }).click();
    await readStarted;
    await editor.press('Control+End');
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await expect(apply).toBeDisabled();
    finishRead();
    const fileTab = panel.getByRole('tab', { name: 'slow.ts', exact: true });
    await expect(fileTab).toHaveAttribute('aria-selected', 'false');
    await expect(panel.getByText('Finish entering text in the frame editor before switching files.')).toBeVisible();
    await expect(panel.locator('.view-lines:visible')).toContainText('にほん');
    expect(await saved()).toEqual(project.frameScripts);
    await cdp.send('Input.insertText', { text: '日本語' });
    await expect(apply).toBeEnabled();
    await fileTab.click();
    await expect(panel.getByRole('textbox', { name: 'scripts/slow.ts', exact: true })).toBeVisible();
    await expect(panel.getByRole('tabpanel')).toContainText('const ready = true;');
    await expect.poll(saved).toEqual([project.frameScripts[0], { frame: 1, source: '// second 日本語' }]);
  } finally {
    finishRead();
    await cdp.detach();
  }
  await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(saved).toEqual(project.frameScripts);
});

test('opening a slow project file saves the last frame edit and keeps file edits manual', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [0, 1].map(frame => ({ frame, source: `// Frame ${frame + 1}` }));
  const license = process.env.SPLASH_TEST_LICENSE;
  await page.addInitScript(({ project, license }) => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: 'Scripts.spl', manifest: null }));
    if (license) localStorage.setItem('splash-license-v1', license);
  }, { project, license });
  let startRead!: () => void, finishRead!: () => void;
  const readStarted = new Promise<void>(resolve => { startRead = resolve; });
  const allowRead = new Promise<void>(resolve => { finishRead = resolve; });
  const initialFile = 'export const speed = 1;\r\n// Original project file';
  const writes: { expected: string; content: string }[] = [];
  let finishFirstSave!: () => void;
  const allowFirstSave = new Promise<void>(resolve => { finishFirstSave = resolve; });
  await page.route('**/api/projects', async route => {
    const command = route.request().postDataJSON();
    if (command.op === 'read' && command.path === 'scripts/slow.ts') {
      startRead();
      await allowRead;
      await route.fulfill({ json: { result: initialFile } });
    } else if (command.op === 'listScripts') {
      await route.fulfill({ json: { result: ['scripts/slow.ts'] } });
    } else if (command.op === 'commit' && command.path === 'scripts/slow.ts') {
      writes.push({ expected: command.expected, content: command.content });
      if (writes.length === 1) await allowFirstSave;
      await route.fulfill({ json: { result: true } });
    } else {
      await route.fulfill({ json: { result: null } });
    }
  });
  const savedFrames = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await panel.getByRole('button', { name: 'Frame 2', exact: true }).click();
  const frameEditor = sourceEditor(panel.getByRole('tabpanel'));
  await expectSource(frameEditor, '// Frame 2');

  try {
    await panel.getByRole('button', { name: 'slow.ts', exact: true }).click();
    await readStarted;
    await fillSource(frameEditor, '// Edited while the file was loading');
    expect(await savedFrames()).toEqual(project.frameScripts);
  } finally {
    finishRead();
  }
  const fileEditor = panel.getByRole('textbox', { name: 'scripts/slow.ts', exact: true });
  await expect(fileEditor).toBeVisible();
  await expect.poll(savedFrames).toEqual([
    project.frameScripts[0], { frame: 1, source: '// Edited while the file was loading' },
  ]);

  await fileEditor.focus();
  await page.keyboard.press('Control+End');
  const fileDraft = '\r\nexport const draft = true;';
  await page.keyboard.insertText(fileDraft);
  await panel.getByRole('tab', { name: 'Frame 2', exact: true }).click();
  await panel.getByRole('tab', { name: /slow\.ts/ }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('draft');
  const save = panel.getByRole('button', { name: 'Save file', exact: true });
  await expect(save).toBeEnabled();
  expect(writes).toEqual([]);
  await fileEditor.press('Control+s');
  if (license) {
    const shortcutSaved = initialFile + fileDraft;
    const secondSave = shortcutSaved + '\r\n// second save';
    try {
      await expect.poll(() => writes).toEqual([{ expected: initialFile, content: shortcutSaved }]);
      await fileEditor.press('Control+End');
      await page.keyboard.insertText('\r\n// second save');
      await fileEditor.press('Control+s');
      await page.keyboard.insertText('\r\n// still a draft');
    } finally {
      finishFirstSave();
    }
    await expect.poll(() => writes).toEqual([
      { expected: initialFile, content: shortcutSaved },
      { expected: shortcutSaved, content: secondSave },
    ]);
    await save.click();
    await expect.poll(() => writes).toEqual([
      { expected: initialFile, content: shortcutSaved },
      { expected: shortcutSaved, content: secondSave },
      { expected: secondSave, content: secondSave + '\r\n// still a draft' },
    ]);
    await expect(save).toBeDisabled();
  } else {
    await expect(panel.getByRole('status')).toContainText('license');
    expect(writes).toEqual([]);
  }
});

function failNextMonacoMount(page: Page, pathPattern: string) {
  return page.evaluateHandle(async pattern => {
    const resource = performance.getEntriesByType('resource').find(entry =>
      /\/(?:editor\.api-[^/]+|monaco-editor_editor_editor__api)\.js(?:\?|$)/.test(entry.name));
    if (!resource) throw Error('Monaco editor API was not loaded.');
    type Api = typeof import('monaco-editor/editor/editor.api').editor;
    const module = await import(resource.name) as Record<string, unknown>;
    const api = Object.values(module).find((value): value is Api => !!value && typeof value === 'object' &&
      'getModels' in value && 'getEditors' in value && 'onDidCreateModel' in value);
    if (!api) throw Error('Monaco editor registry was unavailable.');
    const matches = new RegExp(pattern);
    let target: ReturnType<Api['getModels']>[number] | undefined;
    const arm = api.onDidCreateModel(model => {
      if (!matches.test(model.uri.path)) return;
      target = model;
      model.updateOptions = () => { throw Error('Injected Monaco model setup failure'); };
      arm.dispose();
    });
    return { read: () => ({ injected: !!target, models: api.getModels().filter(model => model === target).length,
      editors: api.getEditors().filter(editor => editor.getModel() === target).length,
      replacements: api.getModels().filter(model => model !== target && matches.test(model.uri.path)).map(model => model.uri.path) }) };
  }, pathPattern);
}

test('a failed frame code mount releases Monaco resources and retries on the original frame', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [0, 1].map(frame => ({ frame, source: `// Frame ${frame + 1}` }));
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await expectSource(sourceEditor(panel.getByRole('tabpanel')), '// Frame 1');
  const probe = await failNextMonacoMount(page, '^/frame-\\d+\\.ts$');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  await panel.getByRole('button', { name: 'Frame 2', exact: true }).click();
  await expect.poll(() => probe.evaluate(value => value.read())).toMatchObject({ injected: true, models: 0, editors: 0 });
  await expect(panel.getByText('Monaco could not load.', { exact: false })).toBeVisible();
  expect(await saved()).toEqual(project.frameScripts);
  await panel.getByRole('button', { name: 'Retry frame editor', exact: true }).press('Enter');
  const input = sourceEditor(panel.getByRole('tabpanel'));
  await expect(input).toBeFocused();
  await expectSource(input, '// Frame 2');
  const text = '// unfinished frame source\nconst value =';
  await fillSource(input, text);
  await panel.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect.poll(saved).toEqual([project.frameScripts[0], { frame: 1, source: text }]);
  await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => probe.evaluate(value => value.read())).toMatchObject({ models: 0, editors: 0, replacements: [] });
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(saved).toEqual(project.frameScripts);
  await probe.dispose();
});

test('a failed project code mount releases Monaco resources and retries without losing another draft', async ({ page }) => {
  const project = newProject();
  project.frameScripts = [{ frame: 0, source: '// frame source' }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: 'Retry.spl', manifest: null })), project);
  const original = 'export const speed = 1;';
  await page.route('**/api/projects', async route => {
    const { op } = route.request().postDataJSON();
    await route.fulfill({ json: { result: op === 'listScripts' ? ['scripts/keep.ts', 'scripts/retry.ts'] : op === 'read' ? original : null } });
  });
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await panel.getByRole('button', { name: 'keep.ts', exact: true }).click();
  const keep = panel.getByRole('textbox', { name: 'scripts/keep.ts', exact: true });
  await expect(keep).toBeVisible();
  await keep.press('Control+End');
  await page.keyboard.insertText(' // unsaved');

  const probe = await failNextMonacoMount(page, '^/scripts/retry\\.ts$');
  const read = () => probe.evaluate(value => value.read());
  await panel.getByRole('button', { name: 'retry.ts', exact: true }).click();
  await expect.poll(read).toEqual({ injected: true, models: 0, editors: 0, replacements: [] });
  await expect(panel.getByText('Monaco could not load. Your file is still open.')).toBeVisible();
  await panel.getByRole('button', { name: 'Retry code editor', exact: true }).press('Enter');
  const retry = panel.getByRole('textbox', { name: 'scripts/retry.ts', exact: true });
  await expect(retry).toBeFocused();
  await expect(panel.getByRole('tabpanel')).toContainText(original);
  await expect.poll(read).toEqual({ injected: true, models: 0, editors: 0, replacements: ['/scripts/retry.ts'] });
  await retry.press('Control+End');
  await page.keyboard.insertText(' // edited after retry');
  await expect(panel.getByRole('tabpanel')).toContainText('// edited after retry');
  await expect(panel.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
  await Promise.all([
    page.waitForEvent('dialog').then(async dialog => {
      const message = dialog.message();
      await dialog.accept();
      expect(message).toBe('Discard unsaved changes to scripts/retry.ts?');
    }),
    panel.getByRole('button', { name: 'Close scripts/retry.ts', exact: true }).click(),
  ]);
  await expect.poll(read).toEqual({ injected: true, models: 0, editors: 0, replacements: [] });
  await expect(keep).toBeVisible();
  await expect(panel.getByRole('tabpanel')).toContainText('// unsaved');
  await probe.dispose();
});

test('project explorer keeps nested drafts across floating and docking',async({page})=>{
  const p=newProject();
  const files = [
    'scripts/main.ts',
    'scripts/actors/setup.ts',
    ...Array.from({ length: 24 }, (_, i) => `scripts/utility-${i + 1}.ts`),
  ];
  await page.addInitScript(p=>{
    localStorage.removeItem('splash-license-v1');
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:'Code.spl',manifest:null}));
  },p);
  await page.route('**/api/projects',async route=>{
    const q=route.request().postDataJSON();
    const result=q.op==='listScripts'?files:q.op==='read'?(q.path==='project.json'?'{"format":"splash-directory"}':'export const value = 2;'):false;
    await route.fulfill({json:{result}});
  });
  await openEditorFromStartup(page);await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('button',{name:'Window',exact:true}).click();
  await page.getByRole('button',{name:'Script Editor',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Edit frame source'});
  await panel.locator('nav button[title="project.json"]').click();
  await expect(panel.locator('.view-lines:visible')).toContainText('{"format":"splash-directory"}');
  await expect(panel.getByRole('textbox',{name:'project.json',exact:true})).toHaveJSProperty('readOnly',true);
  const explorer=panel.getByRole('complementary',{name:'Project Explorer'});
  const [scripts, frames, data] = await explorer.getByRole('navigation').getByRole('heading').allTextContents();
  expect([scripts, frames, data]).toEqual(['TypeScript files', 'Frame scripts', 'Project data']);
  await expect(explorer.getByRole('region', { name: 'Project data' })).toContainText('project.json');
  const folder=explorer.getByRole('button',{name:'scripts',exact:true});
  const main=explorer.getByRole('button',{name:'main.ts',exact:true});
  const actors=explorer.getByRole('button',{name:'actors',exact:true});
  await expect(folder).toHaveAttribute('aria-expanded','true');
  await folder.click();
  await expect(main).toHaveCount(0);
  await folder.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded','true');
  await folder.press('ArrowRight');
  await expect(actors).toBeFocused();
  await actors.press('ArrowLeft');
  await expect(explorer.getByRole('button',{name:'setup.ts',exact:true})).toHaveCount(0);
  await actors.press('ArrowDown');
  await expect(main).toBeFocused();
  await main.click();
  await expect(main).toHaveAttribute('aria-current','true');
  await expect(panel.locator('.view-lines:visible')).toContainText('value');
  await panel.getByRole('button',{name:'New TypeScript file'}).click();
  const filePath=explorer.getByLabel('New file path');
  await expect(filePath).toBeFocused();
  await filePath.fill('main.ts');
  await explorer.getByRole('button',{name:'Create',exact:true}).click();
  await expect(explorer.getByRole('status')).toContainText('already in use');
  await filePath.fill('main.ts/impossible.ts');
  await filePath.press('Enter');
  await expect(explorer.getByRole('status')).toContainText('file and a folder');
  await filePath.press('Escape');
  await expect(filePath).toHaveCount(0);
  await expect(explorer.getByRole('button',{name:'New TypeScript file'})).toBeFocused();
  await actors.click();
  await explorer.getByRole('button',{name:'New TypeScript file'}).click();
  await expect(filePath).toHaveValue('actors/');
  await filePath.pressSequentially('player');
  await panel.getByRole('button',{name:'Create',exact:true}).click();
  await expect(explorer.getByRole('button',{name:'player.ts',exact:true})).toHaveAttribute('aria-current','true');
  await expect(explorer.getByRole('button',{name:'player.ts',exact:true})).toBeFocused();
  await expect(explorer.getByRole('button',{name:'player.ts',exact:true})).toHaveClass(/\bdraft\b/);
  const input=panel.getByRole('textbox',{name:'scripts/actors/player.ts',exact:true});
  await input.focus();await page.keyboard.insertText('export const speed = 4;');
  await panel.getByRole('tab',{name:'main.ts',exact:true}).click();
  await expect(panel.locator('.view-lines:visible')).toContainText('value');
  await panel.getByRole('tab',{name:/player.ts/}).click();
  await expect(panel.locator('.view-lines:visible')).toContainText('speed');
  await panel.getByLabel('Script editor location').selectOption('timeline');
  await expect(panel.locator('.view-lines:visible')).toContainText('speed');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByRole('tab',{name:/player.ts/})).toContainText('•');
  await input.press('Control+s');
  await expect(panel.getByRole('status')).toContainText('license');
  await panel.getByRole('button',{name:'Save file'}).click();
  await expect(panel.getByRole('status')).toContainText('license');
  await expect(panel.getByRole('tab',{name:/player.ts/})).toContainText('•');
  await panel.getByLabel('Filter project files').fill('player');
  await expect(panel.getByRole('navigation',{name:'Project files'})).not.toContainText('main.ts');
  await actors.click();
  await expect(actors).toHaveAttribute('aria-expanded','false');
  await expect(explorer.getByRole('button',{name:'player.ts',exact:true})).toHaveCount(0);
  await actors.press('ArrowRight');
  await expect(explorer.getByRole('button',{name:'player.ts',exact:true})).toBeVisible();
  await page.getByRole('separator',{name:'Resize timeline',exact:true}).press('Home');
  await explorer.getByRole('button',{name:'New TypeScript file'}).click();
  await expect(filePath).toHaveValue('actors/');
  await expect(panel.getByRole('navigation',{name:'Project files'})).toHaveCount(0);
  await explorer.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(panel.getByLabel('Filter project files')).toHaveValue('player');
  await panel.getByLabel('Filter project files').fill('no-such-file');
  await expect(explorer.getByText('No matching files.')).toBeVisible();
  const divider=panel.getByRole('separator',{name:'Resize Project Explorer'});
  await divider.press('Home');
  await panel.getByLabel('Script editor location').selectOption('floating');
  await expect(panel.getByLabel('Filter project files')).toHaveValue('no-such-file');
  await expect(divider).toHaveAttribute('aria-valuenow','156');
  await page.setViewportSize({width:510,height:465});
  const heading=explorer.getByRole('button',{name:'Project Explorer',exact:true});
  const add=explorer.getByRole('button',{name:'New TypeScript file'});
  const reload=explorer.getByRole('button',{name:'Refresh project files'});
  const [titleBox,addBox,reloadBox]=await Promise.all([heading.boundingBox(),add.boundingBox(),reload.boundingBox()]);
  expect(titleBox!.x).toBeLessThan(addBox!.x);
  expect(addBox!.x).toBeLessThan(reloadBox!.x);
  expect(reloadBox!.x+reloadBox!.width).toBeLessThan(510);
  await heading.click();
  await expect(add).toHaveCount(0);
  await heading.click();
  await expect(add).toBeVisible();
  const handle=(await divider.boundingBox())!;
  const x=handle.x+handle.width/2, y=handle.y+handle.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x-48,y);
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow','204');
  const fileList = explorer.getByRole('navigation', { name: 'Project files' });
  await explorer.getByRole('button', { name: 'Reveal active file' }).click();
  await expect(panel.getByLabel('Filter project files')).toHaveValue('');
  const player = fileList.getByRole('button', { name: 'player.ts', exact: true });
  await expect(player).toBeFocused();
  await expect(fileList.locator('[tabindex="0"]')).toHaveCount(1);
  await panel.getByLabel('Filter project files').press('ArrowDown');
  await expect(player).toBeFocused();
  const lastUtility = fileList.getByRole('button', { name: 'utility-24.ts', exact: true });
  await lastUtility.click();
  expect(await fileList.evaluate((nav) => nav.scrollTop)).toBeGreaterThan(0);
  await expect(lastUtility).toHaveAttribute('aria-current', 'true');
  await expect(add).toBeInViewport();
  await expect(panel.getByRole('tab', { name: 'utility-24.ts', exact: true })).toBeVisible();
  const filter = explorer.getByLabel('Filter project files');
  await filter.fill('utility-13');
  await filter.press('Enter');
  await expect(panel.getByRole('tab', { name: 'utility-13.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(fileList.getByRole('button', { name: 'utility-13.ts', exact: true })).toBeFocused();

  await panel.getByRole('tab', { name: 'utility-24.ts', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(lastUtility).toHaveAttribute('aria-current', 'true');
  await expect(lastUtility).toBeInViewport({ ratio: 1 });
  await panel.getByRole('tab', { name: /player.ts/ }).click();
  await expect(player).toBeInViewport({ ratio: 1 });
  const addUnderActors = explorer.getByRole('button', { name: 'New file in scripts/actors', exact: true });
  await actors.click();
  await expect(actors).toHaveAttribute('aria-expanded', 'false');
  await addUnderActors.click();
  await expect(filePath).toHaveValue('actors/');
  await filePath.press('Escape');
  await expect(addUnderActors).toBeFocused();
  await expect(actors).toHaveAttribute('aria-expanded', 'false');
  await filter.fill('utility-13');

  await page.setViewportSize({ width: 400, height: 465 });
  const view = panel.getByRole('group', { name: 'Script workspace view' });
  const code = view.getByRole('button', { name: 'Code', exact: true });
  const browse = view.getByRole('button', { name: 'Project Explorer', exact: true });
  await expect(code).toHaveAttribute('aria-pressed', 'true');
  await expect(explorer).toBeHidden();
  await expect(divider).toHaveCount(0);
  const editorPane = panel.getByRole('region', { name: 'Code editor', exact: true });
  const workspace = panel.getByRole('region', { name: 'Script workspace', exact: true });
  expect((await editorPane.boundingBox())!.width).toBe((await workspace.boundingBox())!.width);

  await browse.click();
  await expect(editorPane).toBeHidden();
  expect((await explorer.boundingBox())!.width).toBe((await workspace.boundingBox())!.width);
  await expect(filter).toHaveValue('utility-13');
  await filter.fill('player');
  await filter.press('Enter');
  await expect(code).toBeFocused();
  await expect(explorer).toBeHidden();
  await expect(panel.locator('.view-lines:visible')).toContainText('speed');

  await browse.click();
  await add.click();
  await filePath.fill('actors/compact');
  await filePath.press('Enter');
  await expect(code).toBeFocused();
  await expect(panel.getByRole('tab', { name: /compact.ts/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('textbox', { name: 'scripts/actors/compact.ts', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 510, height: 465 });
  await expect(view).toHaveCount(0);
  await expect(divider).toHaveAttribute('aria-valuenow', '204');
  await expect(explorer.getByRole('button', { name: 'compact.ts', exact: true })).toHaveAttribute('aria-current', 'true');
});

test('browser Script Editor pops out and returns live drafts to the workspace', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [
    { frame: 0, source: 'state.first = true;' },
    { frame: 1, source: 'state.second = true;' },
  ];
  await page.addInitScript((project) => {
    if (!location.hash.startsWith('#script-panel='))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const openFrame = async () => {
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  };
  await openFrame();
  const edit = { name: 'Edit frame source', exact: true };
  const main = page.getByRole('dialog', edit);
  const popOut = async () => {
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      main.getByRole('button', { name: 'Pop Out', exact: true }).click(),
    ]);
    const panel = popup.getByRole('dialog', edit);
    await expect(panel).toBeVisible();
    await expect(main).toHaveCount(0);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(panel.getByLabel('Script editor location').locator('option:checked')).toHaveText('Pop-out window');
    return { popup, panel };
  };
  await fillSource(sourceEditor(main), 'state.prepared = true;');
  let { popup, panel } = await popOut();
  await expectSource(sourceEditor(panel), 'state.prepared = true;');
  await panel.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source)).toBe('state.prepared = true;');
  await fillSource(sourceEditor(panel), 'const frameDraft =');
  await panel.getByRole('button', { name: 'New TypeScript file', exact: true }).click();
  await panel.getByLabel('New file path').fill('actors/setup');
  await panel.getByRole('button', { name: 'Create', exact: true }).click();
  const file = panel.getByRole('textbox', { name: 'scripts/actors/setup.ts', exact: true });
  await file.focus();
  await popup.keyboard.insertText('export const speed = 4;');
  await Promise.all([popup.waitForEvent('close'), panel.getByLabel('Script editor location').selectOption('timeline')]);
  await expect(main.getByLabel('Script editor location')).toHaveValue('timeline');
  await expect(main.locator('.view-lines:visible')).toContainText('speed');
  await main.getByRole('tab', { name: 'Frame 1', exact: true }).click();
  await expectSource(sourceEditor(main), 'const frameDraft =');

  ({ popup, panel } = await popOut());
  await fillSource(sourceEditor(panel), 'const closedDraft =');
  await Promise.all([
    popup.waitForEvent('close'),
    popup.evaluate(() => { setTimeout(() => window.close(), 0); }),
  ]);
  await expectSource(sourceEditor(main), 'const closedDraft =');
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source)).toBe('const closedDraft =');

  ({ popup, panel } = await popOut());
  await fillSource(sourceEditor(panel), 'const retargetedDraft =');
  await page.getByTitle('Last frame', { exact: true }).click();
  await Promise.all([popup.waitForEvent('close'), openFrame()]);
  await expectSource(sourceEditor(main), 'state.second = true;');
  await main.getByRole('tab', { name: /^Frame 1(?: •)?$/ }).click();
  await expectSource(sourceEditor(main), 'const retargetedDraft =');
});

test('a requested Script Editor return waits for detached frame composition', async ({ page }) => {
  const project = newProject();
  project.duration = 2;
  project.frameScripts = [{ frame: 0, source: '// first ' }, { frame: 1, source: '// second' }];
  await page.addInitScript(project => {
    if (!location.hash.startsWith('#script-panel='))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const openFrame = async () => {
    await page.getByRole('button', { name: 'Control', exact: true }).dispatchEvent('click', { detail: 1 });
    await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).dispatchEvent('click');
  };
  await openFrame();
  const edit = { name: 'Edit frame source', exact: true };
  const main = page.getByRole('dialog', edit);
  const [popup] = await Promise.all([page.waitForEvent('popup'), main.getByRole('button', { name: 'Pop Out', exact: true }).click()]);
  const panel = popup.getByRole('dialog', edit);
  await page.getByTitle('Last frame', { exact: true }).dispatchEvent('click');
  await popup.bringToFront();
  await sourceEditor(panel).press('Control+End');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts);
  const cdp = await popup.context().newCDPSession(popup);
  try {
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await expect(panel.getByRole('button', { name: 'Apply frame source', exact: true })).toBeDisabled();
    await openFrame();
    await expect(panel.getByText('Finish entering text to return to the workspace.')).toBeVisible();
    await expect(panel.locator('.view-lines:visible')).toContainText('にほん');
    await expect(main).toHaveCount(0);
    expect(await saved()).toEqual(project.frameScripts);
    await Promise.all([popup.waitForEvent('close'), cdp.send('Input.insertText', { text: '日本語' })]);
  } finally { await cdp.detach().catch(() => {}); }
  await expect(main.getByRole('heading', { name: 'TypeScript for main frame 2', exact: true })).toBeVisible();
  await expectSource(sourceEditor(main), '// second');
  await expect.poll(saved).toEqual([{ frame: 0, source: '// first 日本語' }, project.frameScripts[1]]);
  await main.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(saved).toEqual(project.frameScripts);
});

test('an explicit script file save finishing after popup close keeps newer edits as a draft', async ({ page }) => {
  const license = process.env.SPLASH_TEST_LICENSE;
  test.skip(!license, 'Requires a signed fixture license for project file writes.');
  await page.addInitScript(({ project, license }) => {
    if (!location.hash.startsWith('#script-panel='))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: 'Scripts.spl', manifest: null }));
    if (license) localStorage.setItem('splash-license-v1', license);
  }, { project: newProject(), license });
  const path = 'scripts/player.ts';
  const initial = '// Player\r\nexport const speed = 1;';
  const firstSave = initial + '\r\n// Saved in the popup';
  const laterDraft = firstSave + '\r\n// Still a draft';
  let saved = initial;
  const writes: { expected: string; content: string }[] = [];
  let finishWrite!: () => void;
  const allowWrite = new Promise<void>(resolve => { finishWrite = resolve; });
  await page.route('**/api/projects', async route => {
    const command = route.request().postDataJSON();
    if (command.op === 'listScripts') return route.fulfill({ json: { result: [path] } });
    if (command.op === 'read' && command.path === path) return route.fulfill({ json: { result: saved } });
    if (command.op !== 'commit' || command.path !== path) return route.fulfill({ json: { result: null } });
    writes.push({ expected: command.expected, content: command.content });
    if (writes.length === 1) await allowWrite;
    if (command.expected !== saved) return route.fulfill({ json: { error: 'Script changed on disk.' } });
    saved = command.content;
    await route.fulfill({ json: { result: true } });
  });
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const dialog = { name: 'Edit frame source', exact: true };
  const main = page.getByRole('dialog', dialog);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    main.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const panel = popup.getByRole('dialog', dialog);
  await panel.getByRole('button', { name: 'player.ts', exact: true }).click();
  const editor = panel.getByRole('textbox', { name: path, exact: true });
  await editor.press('Control+End');
  await popup.keyboard.insertText('\n// Saved in the popup');
  expect(writes).toEqual([]);
  await editor.press('Control+s');
  try {
    await expect.poll(() => writes).toEqual([{ expected: initial, content: firstSave }]);
    await popup.keyboard.insertText('\n// Still a draft');
    await expect(panel.getByRole('tabpanel')).toContainText('Still a draft');
    await Promise.all([
      popup.waitForEvent('close'),
      popup.evaluate(() => { setTimeout(() => window.close(), 0); }),
    ]);
    await expect(main.getByRole('tabpanel')).toContainText('Still a draft');
    expect(saved).toBe(initial);
  } finally {
    finishWrite();
  }
  await expect.poll(() => saved).toBe(firstSave);
  expect(writes).toEqual([{ expected: initial, content: firstSave }]);
  const save = main.getByRole('button', { name: 'Save file', exact: true });
  await expect(save).toBeEnabled();
  const returnedEditor = main.getByRole('textbox', { name: path, exact: true });
  await returnedEditor.press('Control+End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(save).toBeDisabled();
  await page.keyboard.insertText('\n// Still a draft');
  await save.click();
  await expect.poll(() => saved).toBe(laterDraft);
  expect(writes).toEqual([
    { expected: initial, content: firstSave },
    { expected: firstSave, content: laterDraft },
  ]);
  await expect(save).toBeDisabled();
});

test('a blocked browser popup keeps the Script Editor draft in place', async ({ page }) => {
  const { d, before } = await setup(page, 'const unsaved =');
  await page.evaluate(() => { window.open = () => null; });
  await d.getByRole('button', { name: 'Pop Out', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('browser blocked');
  await expect(d.getByLabel('Script editor location')).toHaveValue('floating');
  await expectSource(sourceEditor(d), 'const unsaved =');
  await d.getByLabel('Script editor location').selectOption('canvas');
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Pop Out Script Editor', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('browser blocked');
  await expect(d.getByLabel('Script editor location')).toHaveValue('canvas');
  await expectSource(sourceEditor(d), 'const unsaved =');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
});

test('browser Script Editor floats always on top and returns its draft on close', async ({ page }) => {
  await openEditorFromStartup(page);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit current frame source…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit frame source', exact: true });
  await fillSource(sourceEditor(d), 'const unsaved =');
  const open = d.getByRole('button', { name: 'Always on Top', exact: true });
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Always-on-top Script Editor', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const api = (window as Window & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture;
    const frame = api?.window?.document.querySelector('iframe');
    return frame?.contentDocument?.querySelector('.view-lines')?.textContent?.replaceAll('\u00a0', ' ');
  })).toContain('const unsaved =');
  await expect(d).toHaveCount(0);
  await page.evaluate(() => {
    const api = (window as Window & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture;
    api?.window?.close();
  });
  await expectSource(sourceEditor(d), 'const unsaved =');

  const draft = 'state.appliedFromWindow = true;';
  await fillSource(sourceEditor(d), draft);
  await open.click();
  await expect.poll(() => page.evaluate(() => {
    const api = (window as Window & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture;
    const doc = api?.window?.document.querySelector('iframe')?.contentDocument;
    const button = Array.from(doc?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === 'Apply frame source');
    return !!button && !button.disabled;
  })).toBe(true);
  await page.evaluate(() => {
    const api = (window as Window & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture;
    const doc = api?.window?.document.querySelector('iframe')?.contentDocument;
    Array.from(doc?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === 'Apply frame source')?.click();
  });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.frameScripts[0].source
  )).toBe(draft);
  await page.evaluate(() => {
    const api = (window as Window & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture;
    const frame = api?.window?.document.querySelector('iframe');
    const dock = frame?.contentDocument?.querySelector<HTMLSelectElement>('[aria-label="Script editor location"]');
    if (!dock) throw new Error('Missing Script Editor location');
    dock.value = 'timeline';
    dock.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(d.getByLabel('Script editor location')).toHaveValue('timeline');
  await expectSource(sourceEditor(d), draft);
});

test('a denied always-on-top window keeps the draft and regular Pop Out available', async ({ page }) => {
  const { d } = await setup(page, 'const retained =');
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  await d.getByRole('button', { name: 'Always on Top', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Try the regular Pop Out');
  await expectSource(sourceEditor(d), 'const retained =');
  await expect(d.getByRole('button', { name: 'Pop Out', exact: true })).toBeEnabled();
});

test('Window menu opens the browser Script Editor directly in a pop-out', async ({ page }) => {
  await openEditorFromStartup(page);
  const command = { name: 'Pop Out Script Editor', exact: true };
  const edit = { name: 'Edit frame source', exact: true };
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', command).click(),
  ]);
  const panel = popup.getByRole('dialog', edit);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', edit)).toHaveCount(0);
  await fillSource(sourceEditor(panel), 'const directPopOutDraft =');

  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', command).click();
  expect(page.context().pages()).toEqual([page, popup]);
  await popup.close();
  await expectSource(sourceEditor(page.getByRole('dialog', edit)), 'const directPopOutDraft =');
});

async function openCodeEditorPreferences(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Preferences…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await dialog.getByRole('tab', { name: 'Code Editor', exact: true }).click();
  return dialog;
}

async function openFrameEditor(page: Page) {
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Script Editor', exact: true }).click();
  return page.getByRole('dialog', { name: 'Edit frame source', exact: true });
}

test('Code Editor preferences persist and apply to frame scripts and project files', async ({ page }) => {
  await openEditorFromStartup(page);
  let preferences = await openCodeEditorPreferences(page);
  await expect(preferences.getByLabel('Indent using')).toHaveValue('spaces');
  await expect(preferences.getByLabel('Indent size')).toHaveValue('2');
  await preferences.getByLabel('Indent size').selectOption('4');
  await preferences.getByLabel('Font size (px)').fill('19');
  await preferences.getByLabel('Wrap long lines').check();
  await preferences.getByLabel('Show line numbers').uncheck();
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();

  const panel = await openFrameEditor(page);
  await panel.getByLabel('Script editor location').selectOption('canvas');
  const frame = sourceEditor(panel);
  await frame.press('Tab');
  await page.keyboard.insertText('const speed = 4;');
  await expectSource(frame, '    const speed = 4;');
  await panel.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  expect(JSON.parse(saved!).project.frameScripts[0].source).toBe('    const speed = 4;');
  const lines = panel.locator('.view-lines:visible');
  await expect(lines).toHaveCSS('font-size', '19px');
  await expect(panel.locator('.line-numbers:visible')).toHaveCount(0);

  preferences = await openCodeEditorPreferences(page);
  await preferences.getByLabel('Indent using').selectOption('tabs');
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();
  await expectSource(frame, '    const speed = 4;');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(saved);

  await panel.getByRole('button', { name: 'New TypeScript file', exact: true }).click();
  await panel.getByLabel('New file path').fill('indent-check');
  await panel.getByRole('button', { name: 'Create', exact: true }).click();
  const file = panel.getByRole('textbox', { name: 'scripts/indent-check.ts', exact: true });
  await file.press('Tab');
  await page.keyboard.insertText('export const speed = 4;');
  await expectSource(file, '\texport const speed = 4;');
  await expect(lines).toHaveCSS('font-size', '19px');

  await page.reload();
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  if (await launch.isVisible()) await launch.click();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  preferences = await openCodeEditorPreferences(page);
  await expect(preferences.getByLabel('Indent using')).toHaveValue('tabs');
  await expect(preferences.getByLabel('Indent size')).toHaveValue('4');
  await expect(preferences.getByLabel('Font size (px)')).toHaveValue('19');
  await expect(preferences.getByLabel('Wrap long lines')).toBeChecked();
  await expect(preferences.getByLabel('Show line numbers')).not.toBeChecked();
});

test('an open Script Editor pop-out receives indentation changes without replacing its buffer', async ({ page }) => {
  await openEditorFromStartup(page);
  const panel = await openFrameEditor(page);
  await fillSource(sourceEditor(panel), 'const draft = 1;\n');
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    panel.getByRole('button', { name: 'Pop Out', exact: true }).click(),
  ]);
  const floating = popup.getByRole('dialog', { name: 'Edit frame source', exact: true });
  const editor = sourceEditor(floating);
  const model = floating.locator('.monaco-editor:visible');
  await expectSource(editor, 'const draft = 1;\n');
  const uri = await model.getAttribute('data-uri');
  const preferences = await openCodeEditorPreferences(page);
  await preferences.getByLabel('Indent using').selectOption('tabs');
  await preferences.getByLabel('Indent size').selectOption('6');
  await preferences.getByLabel('Font size (px)').fill('17');
  await preferences.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(floating.locator('.view-lines:visible')).toHaveCSS('font-size', '17px');
  await expect(model).toHaveAttribute('data-uri', uri!);
  await editor.press('Control+End');
  await editor.press('Tab');
  await popup.keyboard.insertText('const another = 2;');
  await expectSource(editor, 'const draft = 1;\n\tconst another = 2;');

  const existing = 'if (true) {\n    const existing = 3;\n}\n';
  await fillSource(editor, existing);
  const detection = await openCodeEditorPreferences(page);
  await detection.getByLabel('Detect indentation from source').check();
  await detection.getByRole('button', { name: 'Done', exact: true }).click();
  await expectSource(editor, existing);
  await editor.press('Control+End');
  await editor.press('Tab');
  await popup.keyboard.insertText('const detected = 4;');
  await expectSource(editor, existing + '    const detected = 4;');
  await popup.close();
});

test('script editor opens in a movable floating panel by default and can dock', async ({ page }) => {
  const popups: Page[] = [];
  page.on('popup', popup => popups.push(popup));
  await page.goto('/');
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Script Editor', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit frame source' });
  const location = panel.getByLabel('Script editor location');
  const move = page.getByRole('button', { name: 'Move script editor window' });
  await expect(location).toHaveValue('floating');
  const explorer = panel.getByRole('complementary', { name: 'Project Explorer' });
  await explorer.getByRole('button', { name: 'Create a TypeScript file', exact: true }).click();
  await expect(explorer.getByLabel('New file path')).toBeFocused();
  await explorer.getByRole('button', { name: 'Cancel', exact: true }).click();
  const scriptsRoot = explorer.getByRole('button', { name: 'scripts', exact: true });
  await scriptsRoot.focus();
  await scriptsRoot.press('ArrowRight');
  await expect(scriptsRoot).toBeFocused();
  const start = (await move.boundingBox())!;
  await page.mouse.move(start.x + 20, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + start.height / 2 + 30);
  await page.mouse.up();
  expect((await move.boundingBox())!.x).toBeGreaterThanOrEqual(start.x + 39);
  expect((await move.boundingBox())!.y).toBeGreaterThanOrEqual(start.y + 29);
  const moved = (await move.boundingBox())!;
  await page.mouse.move(moved.x + 20, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + 20, 1);
  await page.mouse.up();
  expect((await move.boundingBox())!.y).toBeGreaterThanOrEqual(30);
  await fillSource(sourceEditor(panel), 'state.first=true;');
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Script Editor', exact: true }).click();
  await expectSource(sourceEditor(panel), 'state.first=true;');
  await location.selectOption('canvas');
  await expect(move).toHaveCount(0);
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('tab', { name: 'Script Editor' }).click();
  await expectSource(sourceEditor(panel), 'state.first=true;');
  await location.selectOption('timeline');
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('tab', { name: 'Script Editor' }).click();
  await location.selectOption('floating');
  await expect(move).toBeVisible();
  await fillSource(sourceEditor(panel), 'state.first=true;\nstate.second=true;');
  await panel.getByRole('button', { name: 'Apply frame source' }).click();
  await expect(panel.getByRole('status')).toContainText('Frame source applied');
  await panel.getByRole('button', { name: 'Close dialog' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'Script Editor', exact: true }).click();
  await expect(location).toHaveValue('floating');
  await expectSource(sourceEditor(panel), 'state.first=true;\nstate.second=true;');
  expect(popups).toHaveLength(0);
});
