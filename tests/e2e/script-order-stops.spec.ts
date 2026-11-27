import { test, expect, type Page } from '@playwright/test';
import { withPendingScriptEngine } from './script-engine';
import { newProject, type FrameLabel } from '../../packages/document/src';
import fs from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';
async function setup(page: Page, sources?: string[], labels?: FrameLabel[], named: boolean | 'animated' = false) {
  const p = newProject();
  p.name = 'Script ordered stops';
  p.duration = 4;
  p.width = 120;
  p.height = 80;
  if(named){
    const art={id:'rect',kind:'rectangle' as const,x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    p.symbols=[{id:'graphic',name:'Graphic',width:20,height:20,shapes:[art]}];
    if(named==='animated')p.symbols[0].timeline={duration:2,keys:[{frame:1,shapes:[{...art,fill:'#00ff00'}]}]};
    const placement={...art,id:'first',kind:'symbol' as const,instanceName:'Actor',symbolId:'graphic'};
    p.layers[0].keys=[{frame:0,shapes:[placement,{...placement,id:'other',instanceName:'Companion',x:50}]},{frame:2,shapes:[{...placement,id:named==='animated'?'first':'replacement'}]},{frame:3,shapes:[]}];
  }
  if (labels) p.frameLabels = labels;
  p.frameScripts = (
    sources ??
    [-2, 0, 2, 4].map(
      (n) => `state.n=${n};state.visits=typeof state.visits==='number'?state.visits+1:1;`,
    )
  ).map((source, frame) => ({ frame, source }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.addInitScript(
    (project) =>
      window.top === window &&
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  return { before, errors };
}
async function open(page: Page, artwork = true) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved scripts…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Preview saved scripts', exact: true });
  if (artwork) await d.getByLabel('Render detached artwork').check();
  await d.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText('Ready. No scripts have run.');
  await d.getByLabel('State condition path', { exact: true }).fill('["n"]');
  return d;
}
test('static placement visibility follows the held exposure and restores checkpoint pixels',async({page})=>{
  const f=await setup(page,[
    "stage?.setVisible('Actor',false);state.visible=stage?.getInstance('Actor')?.visible??true;",
    "stage?.setVisible('Actor',true);timeline.gotoAndStop(0);"
  ],undefined,true);
  const d=await open(page),img=d.getByAltText('Script preview artwork');
  const pixels=()=>img.evaluate(async(el:HTMLImageElement)=>{
    const bmp=await createImageBitmap(await (await fetch(el.src)).blob());
    try {
      const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(bmp,0,0);
      return [10,60].map(x=>Array.from(ctx.getImageData(x,10,1,1).data));
    } finally {bmp.close();}
  });
  const red=[255,0,0,255],white=[255,255,255,255];
  await expect.poll(pixels).toEqual([red,red]);
  const step=d.getByRole('button',{name:'Step script tick',exact:true});
  await step.click();
  await expect.poll(pixels).toEqual([white,red]);
  await expect(d.getByLabel('Script preview state')).toContainText('"visible": false');
  await d.getByRole('button',{name:'Capture script checkpoint',exact:true}).click();
  await step.click();
  await expect.poll(pixels).toEqual([red,red]);
  await d.getByRole('button',{name:'Restore script checkpoint',exact:true}).click();
  await expect.poll(pixels).toEqual([white,red]);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('animated scene visibility holds across ticks and clears on a replacement key',async({page})=>{
  const f=await setup(page,[
    "stage?.setVisible('Actor',false);",
    "state.held=stage?.getInstance('Actor')?.visible??null;",
    "state.replacement=stage?.getInstance('Actor')?.visible??null;timeline.gotoAndStop(2);",
  ],undefined,'animated');
  const d=await open(page),img=d.getByAltText('Script preview artwork');
  const pixels=()=>img.evaluate(async(el:HTMLImageElement)=>{
    await el.decode();
    const c=document.createElement('canvas');c.width=el.naturalWidth;c.height=el.naturalHeight;
    const ctx=c.getContext('2d')!;ctx.drawImage(el,0,0);
    return [10,60].map(x=>Array.from(ctx.getImageData(x,10,1,1).data));
  });
  const red=[255,0,0,255],green=[0,255,0,255],white=[255,255,255,255];
  await expect.poll(pixels).toEqual([red,red]);
  const step=d.getByRole('button',{name:'Step script tick',exact:true});
  await step.click();
  await expect.poll(pixels).toEqual([white,green]);
  await step.click();
  await expect.poll(pixels).toEqual([red,white]);
  await step.click();
  await expect(d.getByLabel('Script preview state')).toContainText('"held": false');
  await expect(d.getByLabel('Script preview state')).toContainText('"replacement": true');
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('a failed visibility command rolls back earlier edits in the script tick',async({page})=>{
  const f=await setup(page,["stage?.setVisible('Actor',false);state.partial=true;stage?.setVisible('missing',false);"],undefined,true);
  const d=await open(page),image=d.getByAltText('Script preview artwork'),before=await image.getAttribute('src');
  await d.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect(d.getByRole('status')).toContainText('Visibility requires a named noninteractive graphic');
  await expect(image).toHaveAttribute('src',before!);
  await expect(d.getByLabel('Script preview state')).toHaveText('{}');
  await expect(d.getByText(/Tick 0 ·/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('a script cannot clear visibility owned by a different exposure',async({page})=>{
  const f=await setup(page,["stage?.setVisible('Actor',false);timeline.gotoAndStop(2);",'',
    "state.partial=true;delete state.$splashHiddenPlacements;"],undefined,true);
  const d=await open(page),step=d.getByRole('button',{name:'Step script tick',exact:true});
  await step.click();await expect(d.getByText(/Frame 3 · Tick 1/)).toBeVisible();
  const before=await d.getByLabel('Script preview state').textContent();
  const image=await d.getByAltText('Script preview artwork').getAttribute('src');
  await step.click();await expect(d.getByRole('status')).toContainText('Unknown script placement visibility target');
  expect(await d.getByLabel('Script preview state').textContent()).toBe(before);
  expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('named scene placements follow held, replacement and blank frames',async({page})=>{
  const script="state.seen=stage?.getInstance('Actor')?.id ?? 'absent';";
  const f=await setup(page,[script,script,script,script],undefined,true);
  const d=await open(page,false),step=d.getByRole('button',{name:'Step script tick',exact:true});
  for(const [i,id] of ['first','first','replacement','absent'].entries()){
    await step.click();
    await expect(d.getByText(new RegExp('Tick '+(i+1)+' ·'))).toBeVisible();
    await expect(d.getByLabel('Script preview state')).toContainText('"seen": "'+id+'"');
  }
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('scene script reads captured stage dimensions and layer count', async ({page}) => {
  const f=await setup(page,['if(stage)state.n=stage.width+stage.height+stage.layerCount;']);
  const d=await open(page,false);
  await d.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 201');
  expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
});
test('scene script preview resolves a saved label and rolls back an unknown label', async ({ page }) => {
  const f = await setup(page, [
    'state.n=1;timeline.gotoAndStop("Reveal");', '',
    'state.n=2;timeline.gotoAndPlay("missing");',
  ], [{ frame: 2, name: 'Reveal' }]);
  const d = await open(page, false);
  const step = d.getByRole('button', { name: 'Step script tick', exact: true });
  await step.click();
  await expect(d.getByText(/Frame 3 · Tick 1 · Stopped/)).toBeVisible();
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  await step.click();
  await expect(d.getByRole('status')).toContainText('Unknown script frame label');
  await expect(d.getByText(/Frame 3 · Tick 1 · Stopped/)).toBeVisible();
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
for (const [comparison, target, value, ticks] of [
  ['lt', '-1', -2, 1],
  ['lte', '-2', -2, 1],
  ['gt', '0', 2, 3],
  ['gte', '2', 2, 3],
] as const)
  test('script inspector numeric ' + comparison + ' stops and replays', async ({ page }) => {
    const f = await setup(page),
      d = await open(page);
    await expect(d.getByLabel('State comparison', { exact: true })).toHaveValue('equals');
    await d.getByLabel('State comparison', { exact: true }).selectOption(comparison);
    await d.getByLabel('State condition value', { exact: true }).fill(target);
    await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
    await expect(d.getByRole('status')).toHaveText(
      `State condition matched at frame ${ticks + 1} after ${ticks} script tick${ticks === 1 ? '' : 's'}.`,
    );
    await expect(d.getByLabel('Script preview state')).toContainText('"n": ' + value);
    await d.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
    await d.getByLabel('Capture keys in target').check();
    await d.getByRole('button', { name: 'Keyboard capture target', exact: true }).press('a');
    await expect(d.getByLabel('Queued keyboard inputs')).toContainText('2 keyboard');
    const image = await d.getByAltText('Script preview artwork').getAttribute('src');
    await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
    await expect(d.getByRole('status')).toHaveText(
      `State condition matched at frame ${ticks + 1} after 0 script ticks.`,
    );
    expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
    await expect(d.getByLabel('Queued keyboard inputs')).toContainText('2 keyboard');
    await d.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect(d.getByRole('status')).toHaveText('Completed 1 script tick.');
    await d.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
    await expect(d.getByRole('status')).toContainText('Checkpoint restored');
    await expect(d.getByLabel('Script preview state')).toContainText('"n": ' + value);
    await d.getByRole('button', { name: 'Replay retained script history', exact: true }).click();
    await expect(d.getByRole('status')).toHaveText(
      `Replay matched ${ticks} ticks and 0 seek inputs.`,
    );
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
    expect(f.errors).toEqual([]);
    await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  });
test('script numeric drafts reject nonnumbers and unknown operators without replacing state or artwork', async ({
  page,
}) => {
  const f = await setup(page),
    d = await open(page),
    image = await d.getByAltText('Script preview artwork').getAttribute('src');
  await d.getByLabel('State comparison', { exact: true }).selectOption('gt');
  for (const value of ['"0"', 'null', 'true', '1e999', '1+1']) {
    await d.getByLabel('State condition value', { exact: true }).fill(value);
    await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
    await expect(d.getByRole('status')).toContainText(
      value === '1+1'
        ? 'JSON primitive'
        : value === '1e999'
          ? 'finite number'
          : 'finite JSON number',
    );
    await expect(d.getByLabel('Script preview state')).toHaveText('{}');
    expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
    await expect(d.getByLabel('State condition value', { exact: true })).toHaveValue(value);
  }
  await d.getByLabel('State condition value', { exact: true }).fill('0');
  await d.getByLabel('State comparison', { exact: true }).evaluate((input) => {
    input.appendChild(new Option('Forged comparison', 'unknown'));
    (input as HTMLSelectElement).value = 'unknown';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('finite JSON number');
  await expect(d.getByLabel('Script preview state')).toHaveText('{}');
  await d.getByLabel('State comparison', { exact: true }).selectOption('gt');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 2');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
test('script numeric stops skip nonnumeric committed values', async ({ page }) => {
  const f = await setup(page, ['state.n="5";', 'state.n=null;', 'state.n=true;', 'state.n=5;']),
    d = await open(page, false);
  await d.getByLabel('State comparison', { exact: true }).selectOption('gt');
  await d.getByLabel('State condition value', { exact: true }).fill('1');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 1 after 4 script ticks.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 5');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
for (const close of [false, true])
  test('script numeric run rejects actual source or close ' + close, async ({ page }) => {
    const f = await setup(
        page,
        Array(4).fill('state.n=2;'),
      ),
      d = await open(page);
    await d.getByLabel('State comparison', { exact: true }).selectOption('gte');
    await d.getByLabel('State condition value', { exact: true }).fill('2');
    const image = await d.getByAltText('Script preview artwork').getAttribute('src');
    await withPendingScriptEngine(page, () => d.getByRole('button', { name: 'Run to state value', exact: true }).click(), async () => {
      if (close) await d.getByLabel('Close dialog', { exact: true }).click();
      else {
        await page.getByLabel('Layer name', { exact: true }).fill('Late numeric source edit', { force: true });
        await page.getByLabel('Layer name', { exact: true }).dispatchEvent('change');
      }
    });
    if (close) {
      await expect(d).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
    } else {
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].name,
        ),
      ).toBe('Late numeric source edit');
      await expect(d.getByRole('status')).toContainText('Saved sources changed');
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue(
        'Late numeric source edit',
      );
      await expect(d.getByLabel('Script preview state')).toHaveText('{}');
      expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
      await d.getByLabel('Close dialog', { exact: true }).click();
    }
    await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
    const baseline = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const retry = await open(page, false);
    await retry.getByLabel('State comparison', { exact: true }).selectOption('gte');
    await retry.getByLabel('State condition value', { exact: true }).fill('2');
    await retry.getByRole('button', { name: 'Run to state value', exact: true }).click();
    await expect(retry.getByRole('status')).toContainText('after 1 script tick.');
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(baseline);
    expect(f.errors).toEqual([]);
  });
test('numeric mixed predicates use real isolated runtime and preserve atomic replay', async ({
  page,
}) => {
  const files = await Promise.all(
      ['timeline', 'isolated-frame', 'session'].map((name) =>
        fs.readFile('packages/scripting/src/' + name + '.ts', 'utf8'),
      ),
    ),
    input =
      files
        .map((source) => source.replace(/^import[^\n]+\n/gm, ''))
        .join('\n')
        .replace(/export /g, '') + '\nObject.assign(window,{createScriptSession});',
    compiled = await transformWithEsbuild(input, 'numeric-session-test.ts', {
      loader: 'ts',
      target: 'es2022',
      minify: true,
    });
  await page.goto('/');
  await page.addScriptTag({ content: compiled.code });
  const result = await page.evaluate(async () => {
    const session = (
        window as unknown as {
          createScriptSession: typeof import('../../packages/scripting/src/session').createScriptSession;
        }
      ).createScriptSession(
        { duration: 4, fps: 24, seed: 8 },
        [
          { frame: 0, source: 'state.n+=2;state.random=runtime.random();' },
          { frame: 1, source: 'state.n+=2;' },
          { frame: 2, source: 'throw Error("later failure");' },
        ],
        { n: 0 },
        'entry',
      ),
      initial = session.checkpoint(),
      options = {
        stopWhenState: [
          { path: ['n'], comparison: 'gte' as const, value: 3 },
          { path: ['n'], equals: 4 },
        ],
        events: [
          { tick: 0, data: { key: 'used' } },
          { tick: 2, data: { key: 'unused' } },
        ],
      };
    const first = await session.runWithPresentation(4, options),
      held = await session.runWithPresentation(
        3,
        options.stopWhenState ? { stopWhenState: options.stopWhenState } : {},
      );
    let failure = '';
    try {
      await session.run(1);
    } catch (e) {
      failure = String(e);
    }
    const after = session.checkpoint();
    session.restore(initial);
    const replay = await session.runWithPresentation(4, options);
    return { first, held, failure, after, replay };
  });
  expect(result.first.stoppedOnState).toEqual([0, 1]);
  expect(result.first.checkpoint.state.n).toBe(4);
  expect(result.first.events).toEqual([{ tick: 0, data: { key: 'used' } }]);
  expect(result.held.presentation).toHaveLength(1);
  expect(result.failure).toContain('later failure');
  expect(result.after).toEqual(result.first.checkpoint);
  expect(result.replay).toEqual(result.first);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
});

test('changed state inspector captures a fresh run baseline and retains checkpoint replay', async ({
  page,
}) => {
  const f = await setup(page, ['state.n=1;', 'state.n=1;', 'state.n=2;', 'state.n=3;']),
    d = await open(page);
  await d.getByLabel('State condition value', { exact: true }).fill('neverEvaluate()');
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await expect(d.getByLabel('State condition value', { exact: true })).toHaveCount(0);
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 2 after 1 script tick.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  await d.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 4 after 2 script ticks.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 2');
  await d.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 4 after 2 script ticks.',
  );
  await d.getByRole('button', { name: 'Replay retained script history', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('Replay matched 3 ticks');
  await d.getByLabel('State comparison', { exact: true }).selectOption('equals');
  await expect(d.getByLabel('State condition value', { exact: true })).toHaveValue(
    'neverEvaluate()',
  );
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
});

test('changed state inspector distinguishes missing null deletion and typed primitives', async ({
  page,
}) => {
  const f = await setup(page, ['state.n=null;', 'delete state.n;', 'state.n=false;', 'state.n=0;']),
    d = await open(page, false);
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  for (const [frame, contains] of [
    [2, '"n": null'],
    [3, '{}'],
    [4, '"n": false'],
    [1, '"n": 0'],
  ] as const) {
    await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
    await expect(d.getByRole('status')).toHaveText(
      `State condition matched at frame ${frame} after 1 script tick.`,
    );
    await expect(d.getByLabel('Script preview state')).toContainText(contains);
  }
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('changed state inspector exhausts its tick budget for an unchanged primitive', async ({
  page,
}) => {
  const f = await setup(page, Array(4).fill('state.n=1;')),
    d = await open(page);
  await d.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await d.getByLabel('Run-to-state tick budget', { exact: true }).fill('2');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'Completed 2 script ticks. Tick budget exhausted before target.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('changed state inspector rejects initial containers without replacing state or artwork', async ({
  page,
}) => {
  const f = await setup(page, [
      'state.n={deep:1};',
      '(state.n as {deep:number}).deep=2;',
      '(state.n as {deep:number}).deep=3;',
      '',
    ]),
    d = await open(page);
  await d.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText('Completed 1 script tick.');
  const state = await d.getByLabel('Script preview state').textContent(),
    image = await d.getByAltText('Script preview artwork').getAttribute('src');
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('initial primitive or missing');
  await expect(d.getByLabel('Script preview state')).toHaveText(state!);
  expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
  await d.getByLabel('State condition path', { exact: true }).fill('["n","deep"]');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 3 after 1 script tick.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"deep": 2');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});

test('changed state inspector rolls back a later script failure and admits a fresh watch', async ({
  page,
}) => {
  const f = await setup(page, ['state.n=1;', 'throw Error("watch rollback");', '', '']),
    d = await open(page);
  const image = await d.getByAltText('Script preview artwork').getAttribute('src');
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await d.getByLabel('State condition path', { exact: true }).fill('["missing"]');
  await d.getByLabel('Run-to-state tick budget', { exact: true }).fill('3');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toContainText('watch rollback');
  await expect(d.getByLabel('Script preview state')).toHaveText('{}');
  expect(await d.getByAltText('Script preview artwork').getAttribute('src')).toBe(image);
  await d.getByLabel('State condition path', { exact: true }).fill('["n"]');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 2 after 1 script tick.',
  );
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
});

test('changed state inspector does not redispatch a stopped entry while watching', async ({
  page,
}) => {
  const f = await setup(page, ['state.n=1;timeline.stop();', '', '', '']),
    d = await open(page, false);
  await d.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'State condition matched at frame 1 after 1 script tick.',
  );
  await d.getByLabel('Run-to-state tick budget', { exact: true }).fill('3');
  await d.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(d.getByRole('status')).toHaveText(
    'Completed 3 script ticks. Tick budget exhausted before target.',
  );
  await expect(d.getByLabel('Script preview state')).toContainText('"n": 1');
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(f.before);
  expect(f.errors).toEqual([]);
});
