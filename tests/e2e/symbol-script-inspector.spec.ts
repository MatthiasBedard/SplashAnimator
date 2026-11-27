import { sourceEditor, fillSource, expectSource } from './monaco-source';
import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { exportHTML } from '../../packages/export-web/src';
import {encodePcm16Wav} from '../../packages/audio/src/wav-encode';
function fixture() {
  const project = newProject();
  project.width = 200;
  project.height = 100;
  project.duration = 6;
  project.fps = 30;
  project.frameScripts = [{ frame: 0, source: 'throw new Error("main must not run");' }];
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 10,
    rotation: 15,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  project.symbols = [
    {
      id: 'local',
      name: 'Inspector',
      width: 40,
      height: 30,
      shapes: [
        art,
        {
          ...art,
          id: 'nested',
          kind: 'symbol',
          symbolId: 'child',
          symbolPlayback: { mode: 'movie', firstFrame: 1 },
        },
      ],
      timeline: {
        duration: 3,
        keys: [],
        frameScripts: [
          { frame: 0, source: 'state.n=1; timeline.gotoAndStop(2);' },
          {
            frame: 2,
            source:
              'state.n=(state.n as number)+1;\nif(input.fail===true)throw new Error("local failure");\nif(typeof input.value==="number")state.value=input.value;\ntimeline.stop();',
          },
        ],
      },
    },
    {
      id: 'child',
      name: 'Child',
      width: 20,
      height: 10,
      shapes: [{ ...art, id: 'child-art' }],
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
      timeline: {
        duration: 2,
        keys: [],
        frameScripts: [{ frame: 0, source: 'throw new Error("child must not run");' }],
      },
    },
  ];
  project.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          ...art,
          id: 'instance',
          kind: 'symbol',
          symbolId: 'local',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
          x: 40,
          y: 20,
        },
      ],
    },
  ];
  return project;
}
async function setup(page: Page, project = fixture()) {
  const errors: string[] = [],
    workers: { closed: boolean }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('worker', (worker) => {
    const item = { closed: false };
    workers.push(item);
    worker.on('close', () => (item.closed = true));
  });
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('option', { name: 'Library item Inspector', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Symbol timeline', exact: true }),
    panel = dialog.getByRole('region', { name: 'Local timeline script inspector', exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
  const open = async () => {
    await dialog
      .getByRole('button', { name: 'Inspect local timeline scripts', exact: true })
      .click();
    await expect(
      panel.getByRole('heading', { name: 'Inspect local timeline scripts', exact: true }),
    ).toBeVisible();
  };
  const prepare = async () => {
    await panel.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Ready. No scripts have run.');
  };
  const state = () =>
    panel
      .getByLabel('Script preview state', { exact: true })
      .textContent()
      .then((value) => JSON.parse(value!));
  return { dialog, panel, read, open, prepare, state, errors, workers };
}

test('source breakpoint selects a saved local frame and opens its own symbol source',async({page})=>{
  const project=fixture();
  project.symbols![0].timeline!.frameScripts![1].source='state.route="local third";\nstate.visits=Number(state.visits ?? 0)+1;\ntimeline.stop();';
  const f=await setup(page,project);
  await f.open();
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true});
  const status=f.panel.getByRole('status'),source=f.panel.getByLabel('Breakpoint source',{exact:true});
  await expect(source.locator('option')).toHaveText(['Current frame','Local frame 1','Local frame 3']);
  await source.selectOption({label:'Local frame 3'});
  await f.panel.getByLabel('Breakpoint line').fill('2');
  await f.panel.getByLabel('Render detached artwork').check();
  await f.prepare();
  const image=f.panel.getByAltText('Local script preview artwork',{exact:true});
  const initialImage=await image.getAttribute('src');
  await button('Debug script tick').click();
  await expect(status).toHaveText('Paused before local frame 3, line 2, column 1.');
  await expect(f.panel.getByLabel('Paused script state')).toContainText('"route": "local third"');
  await expect.poll(f.state).toEqual({});
  await expect(image).toHaveAttribute('src',initialImage!);
  await button('Continue script').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect.poll(f.state).toEqual({route:'local third',visits:1});
  await expect(f.panel.getByLabel('Retained script seek inputs')).toContainText('1 seek inputs');
  await button('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 1 ticks and 1 seek inputs');
  await source.selectOption({label:'Local frame 1'});
  await button('Open breakpoint source').click();
  await expect(f.panel).toHaveCount(0);
  const editor=f.dialog.getByRole('region',{name:'Local frame source editor',exact:true});
  await expect(editor.getByRole('heading')).toHaveText('TypeScript for symbol frame 1');
  await expectSource(sourceEditor(editor),project.symbols![0].timeline!.frameScripts![0].source);
  await expect(page.getByRole('dialog',{name:'Edit frame source',exact:true})).toHaveCount(0);
  expect(await f.read()).toEqual(project);
});

test('named lookup in a symbol resolves the local placement and excludes the parent',async({page})=>{
  const project=fixture(),parent=project.layers[0].keys[0].shapes[0],local=project.symbols![0];
  parent.instanceName='Parent';local.shapes[1].instanceName='Actor';
  local.timeline!.frameScripts![0].source="const item=stage?.getInstance('Actor','@base');state.id=item?.id??'';state.symbol=item?.symbolId??'';state.parent=!!stage?.getInstance('Parent');";
  const actor=local.shapes[1];
  local.timeline!.keys=[{frame:1,shapes:[actor,{...actor,id:'duplicate'}]}];
  local.timeline!.frameScripts!.push({frame:1,source:"state.partial=true; stage?.getInstance('Actor');"});
  local.timeline!.frameScripts!.sort((a,b)=>a.frame-b.frame);
  const f=await setup(page,project);await f.open();await f.prepare();
  await f.panel.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect.poll(f.state).toEqual({id:'nested',symbol:'child',parent:false});
  await f.panel.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect(f.panel.getByRole('status')).toContainText('Ambiguous placement name');
  expect(await f.state()).toEqual({id:'nested',symbol:'child',parent:false});
  expect(await f.read()).toEqual(project);
});
test('symbol script reads its own captured stage dimensions and layer count',async({page})=>{
  const project=fixture(),definition=project.symbols![0];
  definition.timeline!.frameScripts![0].source='if(stage)state.info=[stage.width,stage.height,stage.layerCount];';
  const f=await setup(page,project);await f.open();await f.prepare();
  await f.panel.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect.poll(f.state).toEqual({info:[definition.width,definition.height,1+(definition.timeline!.layers?.length??0)]});
  expect(await f.read()).toEqual(project);
});
test('symbol script preview resolves its own saved label independently of the scene and child', async ({ page }) => {
  const project = fixture();
  project.frameLabels = [{ frame: 1, name: 'Reveal' }];
  const local = project.symbols![0].timeline!;
  local.frameLabels = [{ frame: 2, name: 'Reveal' }];
  local.frameScripts![0].source = 'state.n=1;timeline.gotoAndPlay("Reveal");';
  project.symbols![1].timeline!.frameLabels = [{ frame: 0, name: 'Reveal' }];
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  const step = f.panel.getByRole('button', { name: 'Step script tick', exact: true });
  await step.click();
  await expect(f.panel.getByText(/Local frame 3 · Tick 1 · Playing/)).toBeVisible();
  expect(await f.state()).toEqual({ n: 1 });
  await step.click();
  await expect(f.panel.getByText(/Local frame 3 · Tick 2 · Stopped/)).toBeVisible();
  expect(await f.state()).toEqual({ n: 2 });
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

function imageFixture() {
  const project = fixture(),
    local = project.symbols![0],
    child = project.symbols![1],
    art = { ...local.shapes[0], rotation: 0, width: 20, height: 20 };
  local.width = 100;
  local.height = 60;
  local.shapes = [art];
  local.timeline!.keys = [{ frame: 2, shapes: [{ ...art, x: 20, fill: '#00ff00' }] }];
  local.timeline!.layers = [
    {
      id: 'movies',
      name: 'Movies',
      visible: true,
      locked: false,
      keys: [
        {
          frame: 0,
          shapes: [
            {
              ...art,
              id: 'nested',
              kind: 'symbol',
              symbolId: child.id,
              x: 50,
              symbolPlayback: { mode: 'movie', firstFrame: 1 },
            },
          ],
        },
      ],
    },
  ];
  delete child.buttonStates;
  child.width = child.height = 20;
  child.shapes = [{ ...art, id: 'm', fill: '#0000ff' }];
  child.timeline!.duration = 3;
  child.timeline!.keys = [
    { frame: 1, shapes: [{ ...child.shapes[0], fill: '#ffff00' }] },
    { frame: 2, shapes: [{ ...child.shapes[0], fill: '#ff00ff' }] },
  ];
  return project;
}
function pointerFixture() {
  const project = fixture();
  project.symbols![1].timeline!.duration = 3;
  project.symbols![1].buttonStates!.down = 2;
  project.symbols![1].timeline!.keys = [
    { frame: 1, shapes: [{ ...project.symbols![1].shapes[0], fill: '#00ff00' }] },
    { frame: 2, shapes: [{ ...project.symbols![1].shapes[0], fill: '#0000ff' }] },
  ];
  project.symbols![0].width = 100;
  project.symbols![0].height = 60;
  project.symbols![0].timeline!.frameScripts = [
    {
      frame: 0,
      source:
        'if(typeof input.type==="string"){state.last=JSON.parse(JSON.stringify(input));state.types=(typeof state.types==="string"?state.types:"")+String(input.type)+",";state.events=(typeof state.events==="number"?state.events:0)+1;}timeline.stop();',
    },
  ];
  return project;
}
async function pointerSetup(page: Page) {
  const project = pointerFixture(),
    f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.prepare();
  await f.panel.getByLabel('Capture pointers on artwork', { exact: true }).check();
  const image = f.panel.getByAltText('Local script preview artwork', { exact: true });
  await image.evaluate((node) => {
    const image = node as HTMLImageElement;
    image.style.width = '200px';
    image.style.height = '90px';
  });
  await image.scrollIntoViewIfNeeded();
  return { ...f, project, image };
}
async function hoverSetup(
  page: Page,
  project = pointerFixture(),
  press = false,
  activation = false,
) {
  const f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.panel
    .getByLabel(
      press ? 'Preview delivered local press states' : 'Preview delivered local hover states',
      { exact: true },
    )
    .check();
  if (activation)
    await f.panel.getByLabel('Deliver qualified local button activation', { exact: true }).check();
  await f.prepare();
  await f.panel.getByLabel('Capture pointers on artwork', { exact: true }).check();
  await f.panel.getByLabel('Capture hover movement for new pointers', { exact: true }).check();
  const image = f.panel.getByAltText('Local script preview artwork', { exact: true });
  await image.evaluate((node) => {
    const img = node as HTMLImageElement;
    img.style.width = '200px';
    img.style.height = '90px';
  });
  await image.scrollIntoViewIfNeeded();
  const host = f.panel.getByRole('application', {
    name: 'Local script pointer target',
    exact: true,
  });
  const capture = async (type = 'pointermove', x = 5, y = 6) => {
    await image.evaluate(
      (node, { type, x, y }) => {
        const box = node.getBoundingClientRect(),
          image = node as HTMLImageElement;
        node.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 19,
            pointerType: 'mouse',
            button: -1,
            buttons: 0,
            clientX: box.x + (x / image.naturalWidth) * box.width,
            clientY: box.y + (y / image.naturalHeight) * box.height,
          }),
        );
      },
      { type, x, y },
    );
  };
  const deliver = () =>
    f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  const clear = () =>
    f.panel.getByRole('button', { name: 'Clear queued pointers', exact: true }).click();
  return { ...f, project, image, host, capture, deliver, clear };
}
async function pressSetup(page: Page, project = pointerFixture(), activation = false) {
  const f = await hoverSetup(page, project, true, activation);
  await f.panel.getByLabel('Capture hover movement for new pointers', { exact: true }).uncheck();
  const pointer = async (
    type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointermove' | 'pointerleave',
    pointerId = 19,
    button = 0,
    x = 5,
    y = 6,
  ) =>
    f.image.evaluate(
      (node, e) => {
        const img = node as HTMLImageElement,
          b = node.getBoundingClientRect();
        node.dispatchEvent(
          new PointerEvent(e.type, {
            bubbles: true,
            pointerId: e.pointerId,
            pointerType: 'mouse',
            button: e.button,
            buttons: e.type === 'pointerdown' ? 1 : 0,
            clientX: b.x + (e.x / img.naturalWidth) * b.width,
            clientY: b.y + (e.y / img.naturalHeight) * b.height,
          }),
        );
      },
      { type, pointerId, button, x, y },
    );
  const next = async (
    type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointermove' | 'pointerleave',
    pointerId = 19,
    button = 0,
    x = 5,
    y = 6,
  ) => {
    await f.panel.getByLabel('Capture pointers on artwork', { exact: true }).check();
    await pointer(type, pointerId, button, x, y);
    await f.deliver();
    await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  };
  return { ...f, pointer, next };
}
function activationFixture() {
  const project = pointerFixture(),
    base = project.symbols![0].timeline!.frameScripts![0].source;
  const source =
    'if(input.type==="pointerup"&&input.buttonActivation&&state.fail===true)throw new Error("activation body failed");if(input.setFail===true)state.fail=true;if(input.setFail===false)state.fail=false;' +
    base +
    'if(input.buttonActivation){state.activation=JSON.parse(JSON.stringify(input.buttonActivation));state.activations=(typeof state.activations==="number"?state.activations:0)+1;}';
  project.symbols![0].timeline!.frameScripts = [
    { frame: 0, source },
    { frame: 1, source },
    { frame: 2, source },
  ];
  return project;
}
test('local activation qualifies matching release before a seeking body and preserves checkpoint replay reset input history', async ({
  page,
}) => {
  const project = activationFixture(),
    local = project.symbols![0];
  local.timeline!.frameScripts = local.timeline!.frameScripts!.map((entry) => ({
    ...entry,
    source:
      entry.source +
      'if(input.type==="pointerdown")timeline.gotoAndStop(2);if(input.buttonActivation)timeline.gotoAndStop(1);',
  }));
  const f = await pressSetup(page, project, true);
  await f.next('pointerdown');
  const pressed = await f.state();
  expect(pressed.last.buttonActivation).toBeNull();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.next('pointerup');
  const released = await f.state();
  expect(released.activations).toBe(1);
  expect(released.activation).toMatchObject({ symbolId: 'child', name: 'Child' });
  expect(released.last).toMatchObject({
    type: 'pointerup',
    targetFrame: 2,
    targetTick: 1,
    targetScope: 'symbol-local',
  });
  expect(released.activation).toEqual(released.last.buttonActivation);
  expect(JSON.parse(released.activation.instanceId)[0]).toBe(released.last.targetNamespace);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 2 ticks');
  expect(await f.state()).toEqual(released);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual(pressed);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.next('pointerup');
  const retry = await f.state();
  expect(retry.activation).toEqual(released.activation);
  expect(retry.last.targetImageId).not.toBe(released.last.targetImageId);
  await f.panel.getByRole('button', { name: 'Reset script preview', exact: true }).click();
  await expect.poll(f.state).toEqual({});
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
for (const mode of ['outside', 'foreign', 'secondary', 'cancel', 'no-press'] as const)
  test(`local activation ${mode} cannot fabricate matching release metadata`, async ({ page }) => {
    const f = await pressSetup(page, activationFixture(), true);
    if (mode !== 'no-press') await f.next('pointerdown');
    await f.next(
      mode === 'cancel' ? 'pointercancel' : 'pointerup',
      mode === 'foreign' ? 20 : 19,
      mode === 'secondary' ? 2 : mode === 'cancel' ? -1 : 0,
      mode === 'outside' ? 90 : 5,
      6,
    );
    expect((await f.state()).last.buttonActivation).toBeNull();
    expect((await f.state()).activations).toBeUndefined();
    if (mode === 'foreign' || mode === 'secondary') {
      expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
      await f.next('pointerup');
      expect((await f.state()).activations).toBe(1);
    }
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
for (const fault of ['query', 'render'] as const)
  test(`local activation ${fault} failure retains qualified release pointer image history and retries`, async ({
    page,
  }) => {
    const f = await pressSetup(page, activationFixture(), true);
    await f.next('pointerdown');
    const before = await f.state(),
      url = await f.image.getAttribute('src');
    await f.pointer('pointerup');
    let requests = 0;
    const route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, (r) => {
      requests++;
      return requests === (fault === 'query' ? 1 : 2) ? r.abort('failed') : r.continue();
    });
    await f.deliver();
    await expect(f.panel.getByRole('status')).toContainText('failed');
    expect(requests).toBe(fault === 'query' ? 1 : 2);
    expect(await f.state()).toEqual(before);
    expect(await f.image.getAttribute('src')).toBe(url);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
    await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
      '1 pointer events',
    );
    await page.context().unroute(route);
    await f.deliver();
    await expect.poll(async () => (await f.state()).activations).toBe(1);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
test('local activation failed body retains press and queue; private checkpoint recovery permits a fresh release', async ({
  page,
}) => {
  const f = await pressSetup(page, activationFixture(), true);
  await f.next('pointerdown');
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"setFail":true}');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).fail).toBe(true);
  const before = await f.state(),
    url = await f.image.getAttribute('src');
  await f.pointer('pointerup');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('activation body failed');
  expect(await f.state()).toEqual(before);
  expect(await f.image.getAttribute('src')).toBe(url);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Checkpoint restored');
  await f.next('pointerup');
  expect((await f.state()).activations).toBe(1);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
test('local activation stale queued release does not activate and original-image recapture succeeds', async ({
  page,
}) => {
  const f = await pressSetup(page, activationFixture(), true);
  await f.pointer('pointerdown');
  await f.pointer('pointerup');
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  const before = await f.state();
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual(before);
  expect((await f.state()).activations).toBeUndefined();
  await f.clear();
  await f.next('pointerup');
  expect((await f.state()).activations).toBe(1);
  expect(await f.read()).toEqual(f.project);
});

for (const fault of ['cancel', 'close', 'context'] as const)
  test(`local activation ${fault} during qualified release publication preserves completed data and cleans jobs`, async ({
    page,
  }) => {
    const f = await pressSetup(page, activationFixture(), true);
    await f.next('pointerdown');
    const before = await f.state();
    await f.pointer('pointerup');
    const url = await f.image.getAttribute('src');
    let requests = 0,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, async (r) => {
      requests++;
      if (requests === 2) await held;
      await r.continue().catch(() => {});
    });
    try {
      await f.deliver();
      await expect.poll(() => requests).toBe(2);
      if (fault === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      } else if (fault === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      else {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText('changed');
      }
      if (fault !== 'close') {
        expect(await f.state()).toEqual(before);
        expect(await f.image.getAttribute('src')).toBe(url);
        await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
          '1 pointer events',
        );
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(f.project);
    } finally {
      release();
      await page.context().unroute(route);
    }
    if (fault === 'cancel') {
      await f.deliver();
      await expect.poll(async () => (await f.state()).events).toBe(2);
      expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
      expect((await f.state()).activations).toBe(1);
    }
    expect(f.errors).toEqual([]);
  });
test('local activation late displayed-image substitution rejects completed output and permits original-image retry', async ({
  page,
}) => {
  const f = await pressSetup(page, activationFixture(), true);
  await f.next('pointerdown');
  const before = await f.state(),
    url = await f.image.getAttribute('src');
  await f.pointer('pointerup');
  let requests = 0,
    release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
  await page.context().route(route, async (r) => {
    requests++;
    if (requests === 2) await held;
    await r.continue().catch(() => {});
  });
  try {
    await f.deliver();
    await expect.poll(() => requests).toBe(2);
    await f.image.evaluate(
      (node) =>
        ((node as HTMLImageElement).src =
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>',
          )),
    );
    release();
    await expect(f.panel.getByRole('status')).toContainText('displayed image changed');
    expect(await f.state()).toEqual(before);
    await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
      '1 pointer events',
    );
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {
    release();
    await page.context().unroute(route);
  }
  await f.image.evaluate(async (node, url) => {
    const img = node as HTMLImageElement;
    img.src = url!;
    await img.decode();
  }, url);
  await f.deliver();
  await expect.poll(async () => (await f.state()).activations).toBe(1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
test('local activation targets nested child before button ancestry without executing descendant bodies', async ({
  page,
}) => {
  const project = activationFixture(),
    child = project.symbols![1],
    outer = structuredClone(child);
  outer.id = 'activation-outer';
  outer.name = 'Outer';
  outer.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  outer.shapes = [
    { ...child.shapes[0], id: 'inner-button', kind: 'symbol', symbolId: child.id, rotation: 0 },
  ];
  outer.timeline!.keys = [];
  project.symbols!.push(outer);
  project.symbols![0].shapes.find((s) => s.kind === 'symbol')!.symbolId = outer.id;
  const f = await pressSetup(page, project, true);
  await f.next('pointerdown');
  await f.next('pointerup');
  expect((await f.state()).activation).toMatchObject({ symbolId: 'child', name: 'Child' });
  expect((await f.state()).activations).toBe(1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local activation cannot release an expired button lifetime after authored absence and reentry', async ({
  page,
}) => {
  const project = activationFixture(),
    local = project.symbols![0],
    shapes = structuredClone(local.shapes);
  local.timeline!.keys = [
    { frame: 1, shapes: [] },
    { frame: 2, shapes },
  ];
  local.timeline!.frameScripts = local.timeline!.frameScripts!.map((entry) => ({
    ...entry,
    source:
      entry.source +
      'if(input.type==="pointerdown")timeline.gotoAndStop(1);if(typeof input.go==="number")timeline.gotoAndStop(input.go);',
  }));
  const f = await pressSetup(page, project, true);
  await f.next('pointerdown');
  const down = await f.state();
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"go":2}');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  await f.next('pointerup');
  const up = await f.state();
  expect(up.last.buttonTarget.lifetime).toBeGreaterThan(down.last.buttonTarget.lifetime);
  expect(up.last.buttonActivation).toBeNull();
  expect(up.activations).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local press native primary capture shows Down until current-image outside release with hover capture off', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await expect(
    f.panel.getByLabel('Include button target for new pointers', { exact: true }),
  ).not.toBeChecked();
  await expect(
    f.panel.getByLabel('Capture hover movement for new pointers', { exact: true }),
  ).not.toBeChecked();
  await f.image.scrollIntoViewIfNeeded();
  const box = (await f.image.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 9);
  await page.mouse.down();
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.state()).toEqual({});
  await f.panel
    .getByRole('button', { name: 'Deliver next pointer and step', exact: true })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await f.state()).last).toMatchObject({
    type: 'pointerdown',
    x: 5,
    y: 6,
    buttonTarget: { symbolId: 'child' },
  });
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await page.mouse.move(box.x + box.width + 30, box.y + 20);
  await page.mouse.up();
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(2);
  expect((await f.state()).last.x).toBeGreaterThan(100);
  expect((await f.state()).last.buttonTarget).toBeNull();
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
for (const action of [
  'release',
  'outside',
  'cancel',
  'foreign-up',
  'foreign-cancel',
  'secondary-up',
  'secondary-down',
] as const)
  test(`local press ${action} preserves original pointer ownership and non-activation`, async ({
    page,
  }) => {
    const f = await pressSetup(page);
    await f.next('pointerdown');
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
    await f.next(
      action === 'cancel' || action === 'foreign-cancel'
        ? 'pointercancel'
        : action === 'secondary-down'
          ? 'pointerdown'
          : 'pointerup',
      action.startsWith('foreign') ? 20 : 19,
      action.startsWith('secondary') ? 2 : action.includes('cancel') ? -1 : 0,
      action === 'outside' ? 90 : 5,
      6,
    );
    expect((await f.state()).last.buttonActivation).toBeUndefined();
    expect((await imagePixels(f.panel)).pixels[0]).toEqual(
      action === 'release'
        ? [0, 255, 0, 255]
        : action === 'outside' || action === 'cancel'
          ? [255, 0, 0, 255]
          : [0, 0, 255, 255],
    );
    if (action.startsWith('foreign') || action.startsWith('secondary')) {
      await f.next('pointerup');
      expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    }
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
test('local press checkpoint replay and reset retain private ownership without activation data', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.next('pointerdown');
  const first = await f.state();
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Run 10 script ticks', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 10 script ticks');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 11 ticks');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.next('pointerup');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual(first);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await expect(
    f.panel.getByLabel('Capture pointers on artwork', { exact: true }),
  ).not.toBeChecked();
  await f.next('pointerup', 20);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.next('pointerup', 19);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Reset script preview', exact: true }).click();
  await expect.poll(f.state).toEqual({});
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
test('local press leave and reentry retain the owned pointer while updating hover', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.panel.getByLabel('Capture hover movement for new pointers', { exact: true }).check();
  await f.next('pointerdown');
  await f.next('pointerleave', 19, -1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  await f.next('pointermove', 20, -1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  await f.next('pointermove', 19, -1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.next('pointerup');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
for (const fault of ['query', 'render'] as const)
  test(`local press ${fault} failure cannot publish pointer ownership and fresh retry succeeds`, async ({
    page,
  }) => {
    const f = await pressSetup(page);
    await f.pointer('pointerdown');
    const url = await f.image.getAttribute('src');
    let requests = 0;
    const route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, (r) => {
      requests++;
      return requests === (fault === 'query' ? 1 : 2) ? r.abort('failed') : r.continue();
    });
    await f.deliver();
    await expect(f.panel.getByRole('status')).toContainText('failed');
    expect(requests).toBe(fault === 'query' ? 1 : 2);
    expect(await f.state()).toEqual({});
    expect(await f.image.getAttribute('src')).toBe(url);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
    await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
      '1 pointer events',
    );
    await page.context().unroute(route);
    await f.deliver();
    await expect.poll(async () => (await f.state()).events).toBe(1);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
    await f.next('pointerup');
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
test('local press stale captured release cannot clear the newly completed Down image', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.pointer('pointerdown');
  await f.pointer('pointerup');
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  const before = await f.state(),
    url = await f.image.getAttribute('src');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual(before);
  expect(await f.image.getAttribute('src')).toBe(url);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.clear();
  await f.next('pointercancel', 19, -1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.project);
});

for (const fault of ['cancel', 'close', 'context'] as const)
  test(`local press ${fault} during detached visual preparation preserves completed data and cleans jobs`, async ({
    page,
  }) => {
    const f = await pressSetup(page);
    await f.pointer('pointerdown');
    const url = await f.image.getAttribute('src');
    let requests = 0,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, async (r) => {
      requests++;
      if (requests === 2) await held;
      await r.continue().catch(() => {});
    });
    try {
      await f.deliver();
      await expect.poll(() => requests).toBe(2);
      if (fault === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      } else if (fault === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      else {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText('changed');
      }
      if (fault !== 'close') {
        expect(await f.state()).toEqual({});
        expect(await f.image.getAttribute('src')).toBe(url);
        await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
          '1 pointer events',
        );
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(f.project);
    } finally {
      release();
      await page.context().unroute(route);
    }
    if (fault === 'cancel') {
      await f.deliver();
      await expect.poll(async () => (await f.state()).events).toBe(1);
      expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
    }
    expect(f.errors).toEqual([]);
  });
test('local press script failure leaves image runtime and queued press unchanged', async ({
  page,
}) => {
  const project = pointerFixture();
  project.symbols![0].timeline!.frameScripts![0].source =
    'if(input.type==="pointerdown")throw new Error("press body failed");' +
    project.symbols![0].timeline!.frameScripts![0].source;
  const f = await pressSetup(page, project);
  await f.pointer('pointerdown');
  const url = await f.image.getAttribute('src');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('press body failed');
  expect(await f.state()).toEqual({});
  expect(await f.image.getAttribute('src')).toBe(url);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual({});
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local press restored Down movie phase and pointer ownership continue independently of stopped bodies', async ({
  page,
}) => {
  const project = pointerFixture(),
    child = project.symbols![1],
    art = { ...child.shapes[0], rotation: 0, width: 20, height: 20 },
    movie: Vector = {
      ...art,
      id: 'press-movie',
      kind: 'symbol',
      symbolId: 'press-clock',
      symbolPlayback: { mode: 'movie', firstFrame: 0 },
    };
  child.timeline!.keys.find((k) => k.frame === 2)!.shapes = [movie];
  project.symbols!.push({
    id: 'press-clock',
    name: 'Press clock',
    width: 20,
    height: 20,
    shapes: [{ ...art, fill: '#0000ff' }],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#ffff00' }] }] },
  });
  const f = await pressSetup(page, project);
  await f.next('pointerdown');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 255, 0, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 2 ticks');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 255, 0, 255]);
  await f.next('pointerup');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Checkpoint restored');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.next('pointerup', 20);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 255, 0, 255]);
  await f.next('pointerup', 19);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local press public JSON target metadata cannot authorize Down or activation', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill(
    JSON.stringify({
      type: 'pointerdown',
      pointerId: 19,
      button: 0,
      buttonTarget: {
        token: 'forged',
        instanceId: 'forged',
        symbolId: 'child',
        name: 'Child',
        lifetime: 1,
      },
    }),
  );
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  await f.next('pointerdown');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
test('local press public image substitution rejects ownership and restoring the original image permits retry', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.pointer('pointerdown');
  const url = await f.image.getAttribute('src');
  await f.image.evaluate(
    (node) =>
      ((node as HTMLImageElement).src =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>',
        )),
  );
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual({});
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.image.evaluate(async (node, url) => {
    const img = node as HTMLImageElement;
    img.src = url!;
    await img.decode();
  }, url);
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});

test('local press failed release retains the accepted Down pointer image and queued release until retry', async ({
  page,
}) => {
  const f = await pressSetup(page);
  await f.next('pointerdown');
  const before = await f.state(),
    url = await f.image.getAttribute('src');
  await f.pointer('pointerup');
  let requests = 0;
  const route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
  await page.context().route(route, (r) => {
    requests++;
    return requests === 2 ? r.abort('failed') : r.continue();
  });
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('failed');
  expect(requests).toBe(2);
  expect(await f.state()).toEqual(before);
  expect(await f.image.getAttribute('src')).toBe(url);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await page.context().unroute(route);
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(2);
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});

test('local dynamic text updates with owned hover, checkpoint and replay', async ({ page }) => {
  const project = pointerFixture(), local = project.symbols![0];
  const caption: Vector = {
    id: 'caption', kind: 'text', x: 25, y: 24, width: 70, height: 15, rotation: 0,
    fill: '#800000', stroke: '#000000', strokeWidth: 0, points: [],
    text: { content: 'Original', dynamicBinding: 'caption', input: true, font: 'monospace',
      size: 12, bold: false, italic: false, align: 'left' },
  };
  local.shapes.push(caption);
  local.timeline!.frameScripts = [{ frame: 0, source: [
    'if(input.type==="pointermove")splashText.set("caption","Original\\nUPDATED");',
    'if(input.bad===true){splashText.set("caption","Unpublished");splashText.setForInstance("missing","caption","Rejected");}',
    'timeline.stop();',
  ].join('\n') }];
  project.width = 260;
  const [first] = project.layers[0].keys[0].shapes;
  project.layers[0].keys[0].shapes = [
    { ...first, rotation: 0, width: local.width, height: local.height },
    { ...first, id: 'second', x: 150, rotation: 0, width: local.width, height: local.height },
  ];
  const f = await hoverSetup(page, project);
  const lineInk = () => f.image.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(25, 39, 65, 12).data.filter((v, i) => i % 4 === 1 && v < 120).length;
  });
  expect(await lineInk()).toBe(0);
  await f.capture();
  await f.deliver();
  await expect.poll(lineInk).toBeGreaterThan(80);
  const updated = await lineInk();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  const button = (name: string) => f.panel.getByRole('button', { name, exact: true });
  await button('Capture script checkpoint').click();
  await button('Step script tick').click();
  await expect(f.panel.getByRole('status')).toHaveText('Completed 1 script tick.');
  expect(await lineInk()).toBe(updated);
  const retained = await f.image.getAttribute('src'), state = await f.state();
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"bad":true}');
  await button('Send input and step').click();
  await expect(f.panel.getByRole('status')).toContainText('Dynamic text instance name is missing: missing');
  await expect(f.image).toHaveAttribute('src', retained!);
  expect(await f.state()).toEqual(state);
  await button('Reset script preview').click();
  await expect.poll(lineInk).toBe(0);
  await button('Restore script checkpoint').click();
  await expect.poll(lineInk).toBe(updated);
  await button('Replay retained script history').click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 1 ticks');
  expect(await lineInk()).toBe(updated);
  const field = f.panel.getByRole('textbox', { name: 'Text input caption', exact: true });
  await expect(field).toHaveAttribute('data-script-stage-input', '');
  await field.fill('Local input');
  await button('Deliver caption and step').click();
  await expect.poll(async () => (await f.state()).$splashText.caption).toBe('Local input');
  expect(await lineInk()).toBe(0);
  expect(await f.read()).toEqual(project);

  const exported = await page.context().newPage();
  await exported.setContent(exportHTML(project, 0));
  const canvas = exported.locator('canvas');
  await expect(canvas).toHaveAttribute('data-capture', 'ready');
  const exportedInk = await canvas.evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext('2d')!;
    return [65, 175].flatMap(x => [44, 59].map(y =>
      ctx.getImageData(x, y, 65, 12).data.filter((v, i) => i % 4 === 1 && v < 120).length));
  });
  expect(exportedInk[0]).toBeGreaterThan(50);
  expect(exportedInk[2]).toBe(exportedInk[0]);
  expect([exportedInk[1], exportedInk[3]]).toEqual([0, 0]);
  await exported.close();
});

test('local opt-in native scaled hover paints Over only on delivery and continues through ticks checkpoint replay reset', async ({
  page,
}) => {
  const f = await hoverSetup(page),
    box = (await f.image.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 9);
  await expect(f.panel.getByLabel('Next pointer input', { exact: true })).toContainText(
    'pointermove',
  );
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.state()).toEqual({});
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  const first = await f.state();
  expect(first.last).toMatchObject({
    type: 'pointermove',
    x: 5,
    y: 6,
    targetScope: 'symbol-local',
    buttonTarget: { symbolId: 'child' },
  });
  expect(first.last.buttonActivation).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Run 10 script ticks', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 10 script ticks');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual(first);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Reset script preview', exact: true }).click();
  await expect.poll(f.state).toEqual({});
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
for (const kind of ['miss', 'leave', 'down', 'up', 'cancel'] as const)
  test(`local hover ${kind} preserves explicit non-activation semantics`, async ({ page }) => {
    const f = await hoverSetup(page);
    await f.capture();
    await f.deliver();
    await expect.poll(async () => (await f.state()).events).toBe(1);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    if (
      (await f.panel.getByLabel('Queued pointer inputs', { exact: true }).textContent()) !==
      '0 pointer events queued (maximum 64).'
    )
      await f.clear();
    await f.capture(
      kind === 'miss'
        ? 'pointermove'
        : kind === 'leave'
          ? 'pointerleave'
          : kind === 'down'
            ? 'pointerdown'
            : kind === 'up'
              ? 'pointerup'
              : 'pointercancel',
      kind === 'miss' ? 90 : 5,
      6,
    );
    await f.deliver();
    await expect.poll(async () => (await f.state()).events).toBe(2);
    expect((await f.state()).last.buttonActivation).toBeUndefined();
    expect((await imagePixels(f.panel)).pixels[0]).toEqual(
      kind === 'miss' || kind === 'leave' ? [255, 0, 0, 255] : [0, 255, 0, 255],
    );
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
for (const fault of ['query', 'render'] as const)
  test(`local hover ${fault} failure retains original image queue runtime and retries`, async ({
    page,
  }) => {
    const f = await hoverSetup(page);
    await f.capture();
    const image = await f.image.getAttribute('src'),
      pixels = await imagePixels(f.panel),
      queued = await f.panel.getByLabel('Queued pointer inputs', { exact: true }).textContent();
    let started = 0;
    const route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, (r) => {
      started++;
      return started === (fault === 'query' ? 1 : 2) ? r.abort('failed') : r.continue();
    });
    await f.deliver();
    await expect(f.panel.getByRole('status')).toContainText('failed');
    expect(started).toBe(fault === 'query' ? 1 : 2);
    expect(await f.state()).toEqual({});
    expect(await f.image.getAttribute('src')).toBe(image);
    expect(await imagePixels(f.panel)).toEqual(pixels);
    expect(await f.panel.getByLabel('Queued pointer inputs', { exact: true }).textContent()).toBe(
      queued,
    );
    await page.context().unroute(route);
    await f.deliver();
    await expect.poll(async () => (await f.state()).events).toBe(1);
    expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    expect(await f.read()).toEqual(f.project);
    expect(f.errors).toEqual([]);
  });
test('local hover script failure cannot publish state image or consume the queued movement', async ({
  page,
}) => {
  const project = pointerFixture();
  project.symbols![0].timeline!.frameScripts![0].source =
    'if(input.type==="pointermove")throw new Error("hover body failed");' +
    project.symbols![0].timeline!.frameScripts![0].source;
  const f = await hoverSetup(page, project);
  await f.capture();
  const url = await f.image.getAttribute('src'),
    pixels = await imagePixels(f.panel);
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('hover body failed');
  expect(await f.state()).toEqual({});
  expect(await f.image.getAttribute('src')).toBe(url);
  expect(await imagePixels(f.panel)).toEqual(pixels);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual({});
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local hover continued and restored movie state phases advance independently on stopped local ticks', async ({
  page,
}) => {
  const project = pointerFixture(),
    child = project.symbols![1],
    art = { ...child.shapes[0], rotation: 0, width: 20, height: 20 },
    movie: Vector = {
      ...art,
      id: 'state-movie',
      kind: 'symbol',
      symbolId: 'hover-clock',
      symbolPlayback: { mode: 'movie', firstFrame: 0 },
    };
  child.timeline!.keys[0].shapes = [movie];
  project.symbols!.push({
    id: 'hover-clock',
    name: 'Hover clock',
    width: 20,
    height: 20,
    shapes: [{ ...art, fill: '#00ff00' }],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
  });
  const f = await hoverSetup(page, project);
  await f.capture();
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 2 ticks');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Checkpoint restored');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('Completed 1 script tick');
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
for (const fault of ['cancel', 'close', 'context'] as const)
  test(`local hover ${fault} during detached visual preparation preserves completed data and cleans jobs`, async ({
    page,
  }) => {
    const f = await hoverSetup(page);
    await f.capture();
    const url = await f.image.getAttribute('src');
    let requests = 0,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      route = /\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/;
    await page.context().route(route, async (r) => {
      requests++;
      if (requests === 2) await held;
      await r.continue().catch(() => {});
    });
    try {
      await f.deliver();
      await expect.poll(() => requests).toBe(2);
      if (fault === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      } else if (fault === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      else {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText('changed');
      }
      if (fault !== 'close') {
        expect(await f.state()).toEqual({});
        expect(await f.image.getAttribute('src')).toBe(url);
        await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
          '1 pointer events',
        );
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(f.project);
    } finally {
      release();
      await page.context().unroute(route);
    }
    if (fault === 'cancel') {
      await f.deliver();
      await expect.poll(async () => (await f.state()).events).toBe(1);
      expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
    }
    expect(f.errors).toEqual([]);
  });
test('local hover targets nested children before their button ancestors without dispatching descendant sources', async ({
  page,
}) => {
  const project = pointerFixture(),
    child = project.symbols![1],
    outer = structuredClone(child);
  outer.id = 'outer-button';
  outer.name = 'Outer';
  outer.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  outer.shapes = [
    { ...child.shapes[0], id: 'inner-button', kind: 'symbol', symbolId: child.id, rotation: 0 },
  ];
  outer.timeline!.keys = [];
  project.symbols!.push(outer);
  project.symbols![0].shapes.find((s) => s.kind === 'symbol')!.symbolId = outer.id;
  const f = await hoverSetup(page, project);
  await f.capture();
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await f.state()).last.buttonTarget).toMatchObject({ symbolId: 'child', name: 'Child' });
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local hover reflected frozen Hit selects outside visible Up and clears on a visible-art miss', async ({
  page,
}) => {
  const project = pointerFixture(),
    local = project.symbols![0],
    child = project.symbols![1],
    art = { ...child.shapes[0], rotation: 0, width: 20, height: 20 };
  child.shapes = [{ ...art, fill: '#ff0000' }];
  child.buttonStates!.hit = 3;
  child.timeline!.duration = 4;
  child.timeline!.keys = [
    { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
    { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
    { frame: 3, shapes: [{ ...art, x: 20 }] },
  ];
  const instance = local.shapes.find((s) => s.kind === 'symbol')!;
  local.shapes = [{ ...instance, x: 50, y: 10, rotation: 0, transform: [-1, 0, 0, 1] }];
  const f = await hoverSetup(page, project),
    sample = () =>
      f.image.evaluate(async (node) => {
        const img = node as HTMLImageElement;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(35, 15, 1, 1).data);
      });
  expect(await sample()).toEqual([255, 0, 0, 255]);
  await f.capture('pointermove', 25, 15);
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await f.state()).last.buttonTarget).toMatchObject({ symbolId: 'child' });
  expect(await sample()).toEqual([0, 255, 0, 255]);
  if (
    (await f.panel.getByLabel('Queued pointer inputs', { exact: true }).textContent())!.startsWith(
      '1 ',
    )
  )
    await f.clear();
  await f.capture('pointermove', 35, 15);
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(2);
  expect((await f.state()).last.buttonTarget).toBeNull();
  expect(await sample()).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local hover stale queued targets reject after a successful visual image update', async ({
  page,
}) => {
  const f = await hoverSetup(page);
  await f.capture();
  await f.capture('pointermove', 90, 6);
  await f.deliver();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  const before = await f.state(),
    url = await f.image.getAttribute('src');
  await f.deliver();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual(before);
  expect(await f.image.getAttribute('src')).toBe(url);
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([0, 255, 0, 255]);
  expect(await f.read()).toEqual(f.project);
});

test('public local image substitution cannot authorize a captured target', async ({ page }) => {
  const f = await pointerSetup(page);
  await f.panel.getByLabel('Include button target for new pointers', { exact: true }).check();
  await f.image.scrollIntoViewIfNeeded();
  const box = (await f.image.boundingBox())!,
    url = await f.image.getAttribute('src');
  await page.mouse.click(box.x + 10, box.y + 9);
  await f.image.evaluate((node) => {
    (node as HTMLImageElement).src =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="blue"/></svg>',
      );
  });
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual({});
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '2 pointer events',
  );
  await f.image.evaluate(async (node, url) => {
    const image = node as HTMLImageElement;
    image.src = url!;
    await image.decode();
  }, url);
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await f.state()).last.buttonTarget).toMatchObject({ symbolId: 'child' });
  expect(await f.read()).toEqual(f.project);
});
test('local keyboard and pointer input share explicit FIFO order without synthesizing activation', async ({
  page,
}) => {
  const f = await pointerSetup(page);
  await f.panel.getByLabel('Capture keys in target', { exact: true }).check();
  await f.panel.getByRole('button', { name: 'Keyboard capture target', exact: true }).focus();
  await page.keyboard.press('a');
  await f.image.scrollIntoViewIfNeeded();
  const box = (await f.image.boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 9);
  await expect(f.panel.getByLabel('Captured input order', { exact: true })).toContainText(
    '4 captured events pending. Next: key',
  );
  await expect(
    f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }),
  ).toBeDisabled();
  for (let i = 1; i <= 4; i++) {
    await f.panel
      .getByRole('button', { name: 'Deliver oldest captured input and step', exact: true })
      .click();
    await expect.poll(async () => (await f.state()).events).toBe(i);
  }
  expect((await f.state()).types).toBe('keydown,keyup,pointerdown,pointerup,');
  expect((await f.state()).last.buttonActivation).toBeUndefined();
  expect(await f.read()).toEqual(f.project);
});
test('local pointer queue stops at the existing 64-event limit without executing input', async ({
  page,
}) => {
  const f = await pointerSetup(page),
    box = (await f.image.boundingBox())!;
  for (let i = 0; i < 33; i++) await page.mouse.click(box.x + 10, box.y + 9);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '64 pointer events',
  );
  await expect(
    f.panel.getByLabel('Capture pointers on artwork', { exact: true }),
  ).not.toBeChecked();
  expect(await f.state()).toEqual({});
  expect(await f.read()).toEqual(f.project);
  await f.panel.getByRole('button', { name: 'Clear queued pointers', exact: true }).click();
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '0 pointer events',
  );
});
test('local targeted script failure preserves the image, checkpoint and queued pointer', async ({
  page,
}) => {
  const project = pointerFixture();
  project.symbols![0].timeline!.frameScripts![0].source =
    'if(input.type==="pointerdown")throw new Error("local pointer failure");timeline.stop();';
  const f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.prepare();
  await f.panel.getByLabel('Capture pointers on artwork', { exact: true }).check();
  await f.panel.getByLabel('Include button target for new pointers', { exact: true }).check();
  const image = f.panel.getByAltText('Local script preview artwork');
  await image.scrollIntoViewIfNeeded();
  const box = (await image.boundingBox())!,
    url = await image.getAttribute('src');
  await page.mouse.click(box.x + 5, box.y + 6);
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('local pointer failure');
  expect(await f.state()).toEqual({});
  expect(await image.getAttribute('src')).toBe(url);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '2 pointer events',
  );
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
for (const action of ['cancel', 'close', 'context'] as const)
  test(`local target lookup ${action} retains completed input state and cleans browser jobs`, async ({
    page,
  }) => {
    const f = await pointerSetup(page);
    await f.panel.getByLabel('Include button target for new pointers', { exact: true }).check();
    await f.image.scrollIntoViewIfNeeded();
    const box = (await f.image.boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + 9);
    let started = false,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.context().route('**/*script-artwork-worker*', async (route) => {
      started = true;
      await held;
      await route.continue().catch(() => {});
    });
    try {
      await f.panel
        .getByRole('button', { name: 'Deliver next pointer and step', exact: true })
        .click();
      await expect.poll(() => started).toBe(true);
      if (action === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      }
      if (action === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      if (action === 'context') {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText(/changed/);
      }
      if (action !== 'close') {
        expect(await f.state()).toEqual({});
        await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
          '2 pointer events',
        );
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(f.project);
    } finally {
      release();
      await page.context().unroute('**/*script-artwork-worker*');
    }
  });
test('local pointer targets use scaled qualified images and remain Up with stale-image rejection and replay', async ({
  page,
}) => {
  const f = await pointerSetup(page);
  await f.panel.getByLabel('Include button target for new pointers', { exact: true }).check();
  await expect(f.panel.getByLabel('Capture hover movement for new pointers')).toHaveCount(0);
  await expect(f.panel.getByLabel('Script button press')).toHaveCount(0);
  await f.image.scrollIntoViewIfNeeded();
  const box = (await f.image.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.1);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '2 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  const first = await f.state();
  expect(first.last).toMatchObject({
    type: 'pointerdown',
    x: 5,
    y: 6,
    targetFrame: 0,
    targetTick: 0,
    targetScope: 'symbol-local',
    buttonTarget: { symbolId: 'child', name: 'Child' },
  });
  expect(first.last.buttonActivation).toBeUndefined();
  expect((await imagePixels(f.panel)).pixels[0]).toEqual([255, 0, 0, 255]);
  expect(JSON.parse(first.last.buttonTarget.instanceId)[0]).toBe(first.last.targetNamespace);
  expect(typeof first.last.targetImageId).toBe('string');
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('stale');
  expect(await f.state()).toEqual(first);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '1 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Clear queued pointers', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.image.scrollIntoViewIfNeeded();
  const next = (await f.image.boundingBox())!;
  await page.mouse.click(next.x + next.width * 0.9, next.y + next.height * 0.8);
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(2);
  expect((await f.state()).last.buttonTarget).toBeNull();
  const before = await f.state();
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched');
  expect(await f.state()).toEqual(before);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual(first);
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '0 pointer events',
  );
  expect(await f.read()).toEqual(f.project);
  expect(f.errors).toEqual([]);
});
test('untargeted local pointer queues retain outside coordinates and FIFO delivery across image updates', async ({
  page,
}) => {
  const f = await pointerSetup(page),
    box = (await f.image.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 1.2, box.y + box.height * 1.3);
  await page.mouse.up();
  await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
    '2 pointer events',
  );
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(1);
  expect((await f.state()).last).toMatchObject({ type: 'pointerdown', x: 10, y: 12 });
  await f.panel.getByRole('button', { name: 'Deliver next pointer and step', exact: true }).click();
  await expect.poll(async () => (await f.state()).events).toBe(2);
  expect((await f.state()).last.type).toBe('pointerup');
  expect((await f.state()).last.x).toBeGreaterThan(100);
  expect((await f.state()).last.y).toBeGreaterThan(60);
  expect((await f.state()).last.buttonTarget).toBeUndefined();
  expect(await f.read()).toEqual(f.project);
});
for (const fault of ['query', 'render'] as const)
  test(`local targeted pointer ${fault} failure retains queued input and permits a fresh retry`, async ({
    page,
  }) => {
    const f = await pointerSetup(page);
    await f.panel.getByLabel('Include button target for new pointers', { exact: true }).check();
    await f.image.scrollIntoViewIfNeeded();
    const box = (await f.image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.1);
    const url = await f.image.getAttribute('src');
    let jobs = 0;
    await page.context().route('**/*script-artwork-worker*', async (route) => {
      jobs++;
      if (fault === 'query' || jobs === 2) await route.abort('failed');
      else await route.continue();
    });
    await f.panel
      .getByRole('button', { name: 'Deliver next pointer and step', exact: true })
      .click();
    await expect(f.panel.getByRole('status')).toContainText('failed');
    expect(jobs).toBe(fault === 'query' ? 1 : 2);
    expect(await f.state()).toEqual({});
    await expect(f.panel.getByLabel('Queued pointer inputs', { exact: true })).toContainText(
      '2 pointer events',
    );
    expect(await f.image.getAttribute('src')).toBe(url);
    await page.context().unroute('**/*script-artwork-worker*');
    await f.panel
      .getByRole('button', { name: 'Deliver next pointer and step', exact: true })
      .click();
    await expect.poll(async () => (await f.state()).events).toBe(1);
    expect(await f.read()).toEqual(f.project);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
test('zero-bound local image rejection leaves state-only inspection available', async ({
  page,
}) => {
  const project = imageFixture();
  project.symbols![0].width = 0;
  project.symbols![0].height = 0;
  const f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.panel.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText(/dimensions/);
  await expect(f.panel.getByAltText('Local script preview artwork')).toHaveCount(0);
  await expect(
    f.panel.getByRole('button', { name: 'Step script tick', exact: true }),
  ).toBeDisabled();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).uncheck();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
for (const action of ['cancel', 'close', 'context'] as const)
  test(`local image ${action} during rendering retains completed data and cleans jobs`, async ({
    page,
  }) => {
    const project = imageFixture(),
      f = await setup(page, project);
    await f.open();
    await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
    await f.prepare();
    const image = await f.panel.getByAltText('Local script preview artwork').getAttribute('src');
    let started = false,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.context().route('**/assets/script-artwork-worker-*.js', async (route) => {
      started = true;
      await held;
      await route.continue().catch(() => {});
    });
    try {
      await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
      await expect.poll(() => started).toBe(true);
      if (action === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      }
      if (action === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      if (action === 'context') {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText(/changed/);
      }
      if (action !== 'close') {
        expect(await f.state()).toEqual({});
        expect(await f.panel.getByAltText('Local script preview artwork').getAttribute('src')).toBe(
          image,
        );
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(project);
    } finally {
      release();
      await page.context().unroute('**/assets/script-artwork-worker-*.js');
    }
  });
async function imagePixels(panel: ReturnType<Page['getByRole']>) {
  return panel
    .getByAltText('Local script preview artwork', { exact: true })
    .evaluate(async (node) => {
      const image = node as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: [5, 25, 55].map((x) => Array.from(ctx.getImageData(x, 5, 1, 1).data)),
      };
    });
}
for (const fault of ['cancel', 'close', 'context'] as const)
  test(`local private history ${fault} during checkpoint restoration retains completed presentation and cleans jobs`, async ({
    page,
  }) => {
    const project = imageFixture(),
      f = await setup(page, project);
    await f.open();
    await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
    await f.prepare();
    await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect.poll(f.state).toEqual({ n: 1 });
    await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
    await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect.poll(f.state).toEqual({ n: 2 });
    const image = f.panel.getByAltText('Local script preview artwork'),
      url = await image.getAttribute('src'),
      pixels = await imagePixels(f.panel);
    let started = false,
      release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page
      .context()
      .route(/\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/, async (route) => {
        started = true;
        await held;
        await route.continue().catch(() => {});
      });
    try {
      await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
      await expect.poll(() => started).toBe(true);
      if (fault === 'cancel') {
        await f.panel.getByRole('button', { name: 'Cancel script preview', exact: true }).click();
        await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      } else if (fault === 'close')
        await f.panel
          .getByRole('button', { name: 'Close local script inspector', exact: true })
          .click();
      else {
        await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
        await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
        await expect(f.panel.getByRole('alert')).toContainText('changed');
      }
      if (fault !== 'close') {
        expect(await f.state()).toEqual({ n: 2 });
        expect(await image.getAttribute('src')).toBe(url);
        expect(await imagePixels(f.panel)).toEqual(pixels);
      }
      await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
      await expect(page.locator('iframe')).toHaveCount(0);
      expect(await f.read()).toEqual(project);
    } finally {
      release();
      await page.context().unroute(/\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/);
    }
    if (fault === 'cancel') {
      await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
      await expect.poll(f.state).toEqual({ n: 3 });
      await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
      await expect.poll(f.state).toEqual({ n: 1 });
      expect((await imagePixels(f.panel)).pixels[2]).toEqual([255, 0, 255, 255]);
    }
    expect(f.errors).toEqual([]);
  });

for (const action of [
  'Restore script checkpoint',
  'Reset script preview',
  'Replay retained script history',
] as const)
  test(`local private artwork history ${action} failure preserves runtime image and queued input with retry`, async ({
    page,
  }) => {
    const project = imageFixture(),
      f = await setup(page, project);
    await f.open();
    await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
    await f.prepare();
    await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect.poll(f.state).toEqual({ n: 1 });
    await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
    await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect.poll(f.state).toEqual({ n: 2 });
    await f.panel.getByLabel('Capture keys in target', { exact: true }).check();
    await f.panel.getByRole('button', { name: 'Keyboard capture target', exact: true }).focus();
    await page.keyboard.press('a');
    const queue = f.panel.getByLabel('Queued keyboard inputs', { exact: true }),
      queued = await queue.textContent(),
      pixels = await imagePixels(f.panel),
      image = f.panel.getByAltText('Local script preview artwork'),
      url = await image.getAttribute('src');
    expect(queued).toContain('2 keyboard events');
    await page
      .context()
      .route(/\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/, (route) =>
        route.abort('failed'),
      );
    await f.panel.getByRole('button', { name: action, exact: true }).click();
    await expect(f.panel.getByRole('status')).toContainText('failed');
    expect(await f.state()).toEqual({ n: 2 });
    expect(await imagePixels(f.panel)).toEqual(pixels);
    expect(await image.getAttribute('src')).toBe(url);
    expect(await queue.textContent()).toBe(queued);
    await page.context().unroute(/\/script-artwork-worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/);
    await f.panel.getByRole('button', { name: action, exact: true }).click();
    await expect(f.panel.getByRole('status')).toContainText(
      action === 'Replay retained script history'
        ? 'Replay matched 2 ticks'
        : action === 'Restore script checkpoint'
          ? 'Checkpoint restored'
          : 'Reset to the initial',
    );
    expect(await f.state()).toEqual(
      action === 'Replay retained script history'
        ? { n: 2 }
        : action === 'Restore script checkpoint'
          ? { n: 1 }
          : {},
    );
    expect((await imagePixels(f.panel)).pixels[2]).toEqual(
      action === 'Replay retained script history'
        ? [0, 0, 255, 255]
        : action === 'Restore script checkpoint'
          ? [255, 0, 255, 255]
          : [255, 255, 0, 255],
    );
    expect(await image.getAttribute('src')).not.toBe(url);
    if (action === 'Replay retained script history') expect(await queue.textContent()).toBe(queued);
    else await expect(queue).toContainText('0 keyboard events');
    expect(await f.read()).toEqual(project);
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

test('local image mode steps stopped descendant clocks and preserves checkpoint replay/reset pixels', async ({
  page,
}) => {
  const project = imageFixture(),
    f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.prepare();
  expect(await imagePixels(f.panel)).toEqual({
    width: 100,
    height: 60,
    pixels: [
      [255, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 0, 255],
    ],
  });
  await expect(f.panel.getByLabel('Capture pointers on artwork', { exact: true })).toBeEnabled();
  await expect(f.panel.getByLabel('Script button press', { exact: true })).toHaveCount(0);
  await expect(
    f.panel.getByRole('application', { name: 'Local script pointer target', exact: true }),
  ).toHaveCount(1);
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  expect((await imagePixels(f.panel)).pixels).toEqual([
    [255, 255, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 255, 255],
  ]);
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 2 });
  expect((await imagePixels(f.panel)).pixels[2]).toEqual([0, 0, 255, 255]);
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 2 ticks');
  expect((await imagePixels(f.panel)).pixels[2]).toEqual([0, 0, 255, 255]);
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  expect((await imagePixels(f.panel)).pixels[2]).toEqual([255, 0, 255, 255]);
  await f.panel.getByRole('button', { name: 'Reset script preview', exact: true }).click();
  await expect.poll(f.state).toEqual({});
  expect((await imagePixels(f.panel)).pixels[2]).toEqual([255, 255, 0, 255]);
  expect(await f.read()).toEqual(project);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('local image failure rolls back a tick and failed reprepare retains the previous completed image/state', async ({
  page,
}) => {
  const project = imageFixture(),
    f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork', { exact: true }).check();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  const before = await imagePixels(f.panel),
    url = await f.panel.getByAltText('Local script preview artwork').getAttribute('src');
  await page
    .context()
    .route('**/assets/script-artwork-worker-*.js', (route) => route.abort('failed'));
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"value":7}');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('failed');
  expect(await f.state()).toEqual({ n: 1 });
  expect(await imagePixels(f.panel)).toEqual(before);
  await expect(f.panel.getByLabel('Retained script JSON inputs', { exact: true })).toContainText(
    '0 JSON inputs retained',
  );
  expect(await f.panel.getByAltText('Local script preview artwork').getAttribute('src')).toBe(url);
  await f.panel.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('failed');
  expect(await f.state()).toEqual({ n: 1 });
  expect(await imagePixels(f.panel)).toEqual(before);
  await page.context().unroute('**/assets/script-artwork-worker-*.js');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 2, value: 7 });
  expect((await imagePixels(f.panel)).pixels[2]).toEqual([0, 0, 255, 255]);
  expect(await f.read()).toEqual(project);
  await expect(page.locator('iframe')).toHaveCount(0);
});
test('symbol inspector prepares without execution then steps only local bodies and replays private checkpoints', async ({
  page,
}) => {
  const project = fixture(),
    f = await setup(page, project);
  await f.open();
  expect(f.workers).toHaveLength(0);
  await expect(f.panel.getByLabel('Render detached artwork', { exact: true })).not.toBeChecked();
  await expect(f.panel.getByLabel('Capture pointers on artwork', { exact: true })).toBeDisabled();
  await expect(f.panel.getByLabel('Script button press', { exact: true })).toHaveCount(0);
  await f.prepare();
  expect(await f.state()).toEqual({});
  await expect(page.locator('iframe')).toHaveCount(0);
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await expect(
    f.panel.getByText('Local frame 3 · Tick 1 · Stopped · Entry pending', { exact: true }),
  ).toBeVisible();
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 2 });
  await f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 2 });
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 2 ticks');
  await f.panel.getByRole('button', { name: 'Reset script preview', exact: true }).click();
  await expect.poll(f.state).toEqual({});
  expect(await f.read()).toEqual(project);
  await f.panel.getByRole('button', { name: 'Close local script inspector', exact: true }).click();
  await expect(f.panel).toHaveCount(0);
  await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('local inspector uses local frame and state-stop bounds and preserves explicit JSON history', async ({
  page,
}) => {
  const project = fixture(),
    f = await setup(page, project);
  await f.open();
  await f.prepare();
  await f.panel.getByLabel('Stop at frame', { exact: true }).fill('3');
  await f.panel.getByRole('button', { name: 'Run to script frame', exact: true }).click();
  await expect(f.panel.getByRole('status')).toHaveText('Stopped at frame 3 after 1 script tick.');
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByLabel('Stop at frame', { exact: true }).fill('4');
  await f.panel.getByRole('button', { name: 'Run to script frame', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('within this timeline');
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByLabel('Stop at frame', { exact: true }).fill('3');
  await f.panel.getByLabel('State condition path', { exact: true }).fill('["n"]');
  await f.panel.getByLabel('State comparison', { exact: true }).selectOption('changed');
  await f.panel.getByRole('button', { name: 'Run to state value', exact: true }).click();
  await expect(f.panel.getByRole('status')).toHaveText(
    'State condition matched at frame 3 after 1 script tick.',
  );
  await expect.poll(f.state).toEqual({ n: 2 });
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"value":7}');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 3, value: 7 });
  await expect(f.panel.getByLabel('Retained script JSON inputs', { exact: true })).toContainText(
    '1 JSON inputs',
  );
  await f.panel
    .getByRole('button', { name: 'Replay retained script history', exact: true })
    .click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched 3 ticks');
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local compile diagnostics open the matching local frame and source Apply keeps isolated history', async ({
  page,
}) => {
  const project = fixture();
  project.symbols![0].timeline!.frameScripts![1].source = 'let n: number = "bad";';
  const f = await setup(page, project);
  await f.open();
  await f.panel.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
  await expect(f.panel.getByRole('status')).toHaveText(
    'Fix the saved source diagnostics before running.',
  );
  await f.panel
    .getByRole('button', { name: /Local frame 3, line 1, column/ })
    .first()
    .click();
  await expect(f.panel).toHaveCount(0);
  const editor = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(editor.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  await expectSource(sourceEditor(editor),
    'let n: number = "bad";',
  );
  await fillSource(sourceEditor(editor), 'timeline.stop();');
  await editor.getByRole('button', { name: 'Apply frame source', exact: true }).click();
  expect(await f.read()).toEqual(project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByRole('button', { name: 'Close local script inspector', exact: true }).click();
  await f.dialog.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByTitle('Save symbol changes and return to the scene').click();
  const expected = structuredClone(project);
  expected.symbols![0].timeline!.frameScripts![1].source = 'timeline.stop();';
  expect(await f.read()).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('a heap-limited symbol breakpoint rolls back staged state and its uncommitted seek on allocation failure', async ({ page }) => {
  const project = fixture();
  project.symbols![0].timeline!.frameScripts![1].source = [
    'state.staged = true;',
    'if (input.retry !== true) state.bytes = new Array(600000).join("01234567890123456789012345678901").length;',
    'state.n = Number(state.n) + 1;',
    'timeline.stop();',
  ].join('\n');
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  const control = (name: string) => f.panel.getByRole('button', { name, exact: true });
  const status = f.panel.getByRole('status');
  const workerCount = () => page.workers().filter((worker) => /quickjs-frame-worker(?:[-.])/.test(worker.url())).length;
  await f.panel.getByLabel('Breakpoint source', { exact: true }).selectOption({ label: 'Local frame 3' });
  await control('Debug script tick').click();
  await expect(status).toHaveText('Paused before local frame 3, line 1, column 1.');
  await expect.poll(workerCount).toBe(1);
  await control('Step Over').click();
  await expect(status).toHaveText('Paused before local frame 3, line 2, column 1.');
  await expect(f.panel.getByLabel('Paused script state')).toContainText('"staged": true');
  await expect.poll(f.state).toEqual({});
  await control('Continue script').click();
  await expect(status).toContainText(/out of memory/i);
  await expect.poll(workerCount).toBe(0);
  await expect.poll(f.state).toEqual({});
  await expect(f.panel.getByLabel('Retained script seek inputs')).toContainText('0 seek inputs');
  await control('Step script tick').click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"retry":true}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect.poll(f.state).toEqual({ n: 2, staged: true });
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  expect(await f.read()).toEqual(project);
});

test('heap-limited symbol scripts roll back allocation failure, replay local ticks and open local source', async ({ page }) => {
  const project = fixture();
  const source = [
    'if (input.fail === true) {',
    '  throw new Error("bounded local source failure");',
    '}',
    'if (input.large === true) state.bytes = new Array(600000).join("01234567890123456789012345678901").length;',
    'state.n = Number(state.n) + 1;',
    'state.roll = runtime.random();',
    'timeline.stop();',
  ].join('\r\n');
  project.symbols![0].timeline!.frameScripts![1].source = source;
  const f = await setup(page, project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork').check();
  await f.prepare();
  const control = (name: string) => f.panel.getByRole('button', { name, exact: true });
  const status = f.panel.getByRole('status');
  const input = f.panel.getByLabel('Script input JSON', { exact: true });
  const entries = f.panel.getByLabel('Retained script JSON inputs', { exact: true });
  await expect(control('Debug script tick')).toBeEnabled();
  await control('Step script tick').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  await expect.poll(f.state).toEqual({ n: 1 });
  const artwork = f.panel.getByAltText('Local script preview artwork', { exact: true });
  const image = await artwork.getAttribute('src');
  await input.fill('{"large":true}');
  await control('Send input and step').click();
  await expect(status).toContainText(/out of memory/i);
  await expect.poll(f.state).toEqual({ n: 1 });
  await expect(entries).toContainText('0 JSON inputs');
  await expect(artwork).toHaveAttribute('src', image!);
  await input.fill('{}');
  await control('Send input and step').click();
  await expect(status).toHaveText('Completed 1 script tick.');
  const committed = await f.state();
  expect(committed).toMatchObject({ n: 2, roll: expect.any(Number) });
  await control('Replay retained script history').click();
  await expect(status).toContainText('Replay matched 2 ticks');
  await expect.poll(f.state).toEqual(committed);
  await input.fill('{"fail":true}');
  await control('Send input and step').click();
  await expect(status).toContainText('bounded local source failure (source line 2, column 18; advisory)');
  await expect.poll(f.state).toEqual(committed);
  await expect(entries).toContainText('1 JSON input');
  await control('Edit failing local frame 3 source').click();
  const region = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(region.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  const editor = sourceEditor(region);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('Error(', 'ErrorX'));
  expect(await f.read()).toEqual(project);
});

test('heap-limited symbol execution discards a pending tick when its original workspace changes', async ({ page }) => {
  const project = fixture(), f = await setup(page, project);
  await f.open();
  await f.prepare();
  const step = f.panel.getByRole('button', { name: 'Step script tick', exact: true });
  await step.click();
  await expect.poll(f.state).toEqual({ n: 1 });
  const workerUrl = /quickjs-frame-worker(?:[-.])/;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route(workerUrl, async (route) => {
    requested = true;
    await gate;
    await route.continue().catch(() => {});
  }, { times: 1 });
  try {
    await step.click();
    await expect.poll(() => requested).toBe(true);
    await page.getByRole('region', { name: 'Symbol editing workspace', exact: true })
      .getByRole('button', { name: 'Add symbol layer', exact: true })
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(f.panel.getByRole('alert')).toContainText('The shared symbol draft changed');
  } finally {
    release();
  }
  await expect(step).toBeDisabled();
  await expect.poll(f.state).toEqual({ n: 1 });
  await expect.poll(() => page.workers().filter((worker) => workerUrl.test(worker.url())).length).toBe(0);
  expect(await f.read()).toEqual(project);
});

test('runtime errors in a debug helper open the exact original symbol coordinate', async ({ page }) => {
  const project = fixture();
  const source = [
    '\uFEFFfunction fail(): never {',
    '  state.staged = true;',
    '  throw new Error("mapped local failure");',
    '}',
    'state.result = fail();',
  ].join('\r\n');
  project.symbols![0].timeline!.frameScripts![1].source = source;
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  const button = (name: string) => f.panel.getByRole('button', { name, exact: true });
  const status = f.panel.getByRole('status');
  await f.panel.getByLabel('Breakpoint source', { exact: true }).selectOption({ label: 'Local frame 3' });
  await f.panel.getByLabel('Breakpoint line').fill('5');
  await button('Debug script tick').click();
  await expect(status).toHaveText('Paused before local frame 3, line 5, column 1.');
  await button('Step Into').click();
  await expect(status).toHaveText('Paused before local frame 3, line 2, column 3.');
  await button('Continue script').click();
  await expect(status).toContainText('mapped local failure (source line 3, column 18; advisory)');
  await expect.poll(f.state).toEqual({});
  await button('Edit failing local frame 3 source').click();
  const region = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(region.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  const editor = sourceEditor(region);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('Error(', 'ErrorX'));
  expect(await f.read()).toEqual(project);
});

test('opening a paused callee selects the original symbol frame and stops the uncommitted seek', async ({ page }) => {
  const project = fixture();
  const source = '\uFEFFfunction mul(n: number) {\r\n  return n * 2;\r\n}\r\nstate.result = mul(3);';
  project.symbols![0].timeline!.frameScripts![1].source = source;
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  const button = (name: string) => f.panel.getByRole('button', { name, exact: true });
  await f.panel.getByLabel('Breakpoint source', { exact: true }).selectOption({ label: 'Local frame 3' });
  await f.panel.getByLabel('Breakpoint line').fill('4');
  await button('Debug script tick').click();
  await expect(f.panel.getByRole('status')).toHaveText('Paused before local frame 3, line 4, column 1.');
  await button('Step Into').click();
  await expect(f.panel.getByRole('status')).toHaveText('Paused before local frame 3, line 2, column 3.');
  await button('Stop and open paused source').click();
  await expect(f.panel).toHaveCount(0);
  await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
  const region = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(region.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  const editor = sourceEditor(region);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('X');
  await expectSource(editor, source.replace('return', 'Xeturn'));
  expect(await f.read()).toEqual(project);
});

test('local execution failure retains state and opens the matching failing local source', async ({
  page,
}) => {
  const project = fixture(),
    f = await setup(page, project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Run 10 script ticks', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 2 });
  await f.panel.getByLabel('Script input JSON', { exact: true }).fill('{"fail":true}');
  await f.panel.getByRole('button', { name: 'Send input and step', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText(/Frame 3, tick 10:.*local failure/);
  await expect.poll(f.state).toEqual({ n: 2 });
  await expect(f.panel.getByLabel('Retained script JSON inputs', { exact: true })).toContainText(
    '0 JSON inputs',
  );
  await f.panel
    .getByRole('button', { name: 'Edit failing local frame 3 source', exact: true })
    .click();
  const editor = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(editor.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  await expectSource(sourceEditor(editor),
    project.symbols![0].timeline!.frameScripts![1].source,
  );
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
for (const change of ['frame', 'local history', 'shared symbol workspace'] as const)
  test(`local inspector invalidates on actual ${change} changes without altering saved source`, async ({
    page,
  }) => {
    const project = fixture(),
      f = await setup(page, project);
    if (change === 'local history') {
      await f.dialog.getByLabel('Symbol duration', { exact: true }).fill('4');
      await f.dialog.getByLabel('Symbol duration', { exact: true }).press('Tab');
    }
    await f.open();
    await f.prepare();
    await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
    await expect.poll(f.state).toEqual({ n: 1 });
    if (change === 'frame') {
      await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
      await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
    }
    if (change === 'local history')
      await f.dialog
        .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
        .click();
    if (change === 'shared symbol workspace') {
      await page
        .getByRole('region', { name: 'Symbol editing workspace', exact: true })
        .getByRole('button', { name: 'Add symbol layer', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click());
      await expect(f.panel.getByRole('alert')).toContainText('The shared symbol draft changed');
      await f.panel.getByText('Current local frame source', { exact: true }).click();
      await expect(f.panel.getByRole('button', { name: 'Edit current local frame source', exact: true })).toBeDisabled();
      await expect(f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true })).toHaveCount(0);
    } else {
      await expect(f.panel.getByRole('alert')).toContainText(/changed/);
      await expect(
        f.panel.getByRole('button', { name: 'Step script tick', exact: true }),
      ).toBeDisabled();
    }
    await expect.poll(f.state).toEqual({ n: 1 });
    expect((await f.read()).symbols).toEqual(project.symbols);
    await f.panel
      .getByRole('button', { name: 'Close local script inspector', exact: true })
      .click();
    await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
    expect(f.errors).toEqual([]);
  });
test('current local source navigation ends the inspector and never opens the main source editor', async ({
  page,
}) => {
  const project = fixture(),
    f = await setup(page, project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByText('Current local frame source', { exact: true }).click();
  await expect(f.panel.getByLabel('Current preview frame source', { exact: true })).toHaveText(
    project.symbols![0].timeline!.frameScripts![1].source,
  );
  await f.panel
    .getByRole('button', { name: 'Edit current local frame source', exact: true })
    .click();
  await expect(f.panel).toHaveCount(0);
  const editor = f.dialog.getByRole('region', { name: 'Local frame source editor', exact: true });
  await expect(editor.getByRole('heading')).toHaveText('TypeScript for symbol frame 3');
  await expectSource(sourceEditor(editor),
    project.symbols![0].timeline!.frameScripts![1].source,
  );
  await expect(page.getByRole('dialog', { name: 'Edit frame source', exact: true })).toHaveCount(0);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local inspector reopens with fresh state and no borrowed checkpoint', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByRole('button', { name: 'Capture script checkpoint', exact: true }).click();
  await f.panel.getByRole('button', { name: 'Close local script inspector', exact: true }).click();
  await f.open();
  await expect(
    f.panel.getByRole('button', { name: 'Restore script checkpoint', exact: true }),
  ).toBeDisabled();
  await f.prepare();
  await expect.poll(f.state).toEqual({});
  await expect(
    f.panel.getByText('Local frame 1 · Tick 0 · Playing · Entry pending', { exact: true }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});
for (const action of ['cancel', 'close', 'context'] as const)
  test(`in-flight local inspector ${action} cleans browser workers and retains the last completed state`, async ({
    page,
  }) => {
    const project = fixture();
    project.symbols![0].timeline!.frameScripts = [{ frame: 0, source: 'state.pending = true;\ntimeline.stop();' }];
    const f = await setup(page, project);
    await f.open();
    await f.prepare();
    await f.panel.getByRole('button', { name: 'Debug script tick', exact: true }).click();
    await expect(f.panel.getByRole('status')).toHaveText('Paused before local frame 1, line 1, column 1.');
    await expect.poll(() => page.workers().filter((worker) => /quickjs-frame-worker(?:[-.])/.test(worker.url())).length).toBe(1);
    if (action === 'cancel') {
      await f.panel
        .getByRole('button', { name: 'Cancel script preview', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click());
      await expect(f.panel.getByRole('status')).toContainText(/cancel|Abort/);
      await expect.poll(f.state).toEqual({});
    }
    if (action === 'close')
      await f.panel
        .getByRole('button', { name: 'Close local script inspector', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click());
    if (action === 'context') {
      await f.dialog.getByLabel('Symbol frame', { exact: true }).fill('2');
      await f.dialog.getByLabel('Symbol frame', { exact: true }).press('Tab');
      await expect(f.panel.getByRole('alert')).toContainText(/changed/);
      await expect.poll(f.state).toEqual({});
    }
    await expect(page.locator('iframe[title="Isolated script frame"]')).toHaveCount(0);
    await expect.poll(() => f.workers.filter((w) => !w.closed).length).toBe(0);
    expect(await f.read()).toEqual(project);
    expect(f.errors).toEqual([]);
  });
test('local inspector keyboard capture and explicit delivery stay inside the local timeline', async ({
  page,
}) => {
  const project = fixture();
  project.symbols![0].timeline!.frameScripts![1].source =
    'if(typeof input.key==="string")state.key=input.key; timeline.stop();';
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1 });
  await f.panel.getByLabel('Capture keys in target', { exact: true }).check();
  await f.panel.getByRole('button', { name: 'Keyboard capture target', exact: true }).focus();
  await page.keyboard.press('a');
  await expect(f.panel.getByLabel('Queued keyboard inputs', { exact: true })).toContainText(
    '2 keyboard events',
  );
  await f.panel.getByRole('button', { name: 'Deliver next key and step', exact: true }).click();
  await expect.poll(f.state).toEqual({ n: 1, key: 'a' });
  await expect(f.panel.getByLabel('Queued keyboard inputs', { exact: true })).toContainText(
    '1 keyboard events',
  );
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('local inspector preserves explicit native execution denial', async ({ page }) => {
  const project = fixture(),
    f = await setup(page, project);
  await f.open();
  await page.evaluate(() => Reflect.set(window, '__TAURI_INTERNALS__', {}));
  await f.panel.getByRole('button', { name: 'Prepare script preview', exact: true }).click();
  await expect(f.panel.getByRole('status')).toContainText('not enabled in the native application');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(f.workers).toHaveLength(0);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
test('zero-step local stop rejects a context change queued after the completed checkpoint snapshot', async ({
  page,
}) => {
  const project = fixture();
  project.symbols![0].timeline!.frameScripts = [
    { frame: 0, source: 'state.marker="zero-step-publication"; timeline.stop();' },
  ];
  const f = await setup(page, project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button', { name: 'Step script tick', exact: true }).click();
  await expect.poll(f.state).toEqual({ marker: 'zero-step-publication' });
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    Reflect.set(window, 'zeroScopeReads', 0);
    Reflect.set(window, 'zeroScopeChanged', false);
    JSON.stringify = function (value: unknown, ...rest: unknown[]) {
      if (
        !rest.length &&
        value &&
        typeof value === 'object' &&
        Reflect.get(value, 'marker') === 'zero-step-publication'
      ) {
        const reads = Number(Reflect.get(window, 'zeroScopeReads')) + 1;
        Reflect.set(window, 'zeroScopeReads', reads);
        if (reads === 4)
          queueMicrotask(() => {
            const input = document.querySelector(
              'input[aria-label="Symbol frame"]',
            ) as HTMLInputElement;
            if (!input) throw Error('Missing real local frame input');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              input,
              '2',
            );
            input.dispatchEvent(new Event('change', { bubbles: true }));
            Reflect.set(window, 'zeroScopeChanged', true);
          });
      }
      return Reflect.apply(stringify, JSON, [value, ...rest]);
    } as typeof JSON.stringify;
  });
  await f.panel.getByRole('button', { name: 'Run to script frame', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'zeroScopeChanged'))).toBe(true);
  await expect(f.dialog.getByLabel('Symbol frame', { exact: true })).toHaveValue('2');
  await expect(f.panel.getByRole('status')).toContainText(/changed|invalidated|disposed/);
  await expect(f.panel.getByRole('alert')).toContainText(/changed/);
  await expect.poll(f.state).toEqual({ marker: 'zero-step-publication' });
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('animated local graphic visibility preserves phase and restores checkpoint pixels', async ({page}) => {
  const project = imageFixture();
  const local = project.symbols![0];
  const art = local.shapes[0];
  local.timeline!.duration = 4;
  project.symbols!.push({id:'static',name:'Static',width:20,height:20,shapes:[{...art,id:'static-art'}],timeline:{duration:4,keys:[
    {frame:1,shapes:[{...art,fill:'#00ff00'}]},
    {frame:2,shapes:[{...art,fill:'#0000ff'}]},
    {frame:3,shapes:[{...art,fill:'#ffff00'}]},
  ]}});
  const actor: Vector = {...art,id:'actor',kind:'symbol',symbolId:'static',instanceName:'Actor'};
  local.timeline!.layers![0].keys[0].shapes[0].instanceName = 'Movie';
  local.shapes = [actor,{...actor,id:'peer',x:25,instanceName:'Peer'}];
  local.timeline!.keys = [];
  local.timeline!.frameScripts = [
    {frame:0,source:'stage!.setVisible("Actor",false);state.visible=stage!.getInstance("Actor")!.visible;'},
    {frame:2,source:'stage!.setVisible("Actor",true);state.visible=true;'},
    {frame:3,source:'stage!.setVisible("Actor",false);state.partial=true;stage!.setVisible("Movie",false);'},
  ];
  const f = await setup(page,project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork',{exact:true}).check();
  await f.prepare();
  const step = f.panel.getByRole('button',{name:'Step script tick',exact:true});
  const pixels = async () => (await imagePixels(f.panel)).pixels.slice(0,2);
  const visible = await pixels();
  expect(visible).toEqual([[255,0,0,255],[255,0,0,255]]);
  await step.click();
  await expect.poll(async () => (await f.state()).visible).toBe(false);
  const hidden = await pixels();
  expect(hidden[0]).not.toEqual(visible[0]);
  expect(hidden[1]).toEqual([0,255,0,255]);
  await f.panel.getByRole('button',{name:'Capture script checkpoint',exact:true}).click();
  await step.click();
  await expect.poll(pixels).toEqual([hidden[0],[0,0,255,255]]);
  await step.click();
  const shown = [[255,255,0,255],[255,255,0,255]];
  await expect.poll(pixels).toEqual(shown);
  await step.click();
  await expect(f.panel.getByRole('status')).toContainText('Visibility requires a named noninteractive graphic');
  expect(await f.state()).toEqual({visible:true});
  expect(await pixels()).toEqual(shown);
  await f.panel.getByRole('button',{name:'Restore script checkpoint',exact:true}).click();
  await expect.poll(pixels).toEqual(hidden);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

for(const kind of ['direct','static','animated','fixed','multilayer'] as const)test(`local ${kind==='direct'?'direct':'nested'} button visibility removes hits and retires a hidden press (${kind})`, async ({page}) => {
  const nested=kind!=='direct', fixed=kind==='fixed';
  const multilayer=fixed||kind==='multilayer', animated=kind==='animated'||kind==='multilayer';
  const project=pointerFixture(),local=project.symbols![0];
  const button={...local.shapes[1],instanceName:'Action',rotation:0};
  local.shapes=[button,{...button,id:'companion',instanceName:'Companion',x:25}];
  if(nested){
    const child={...button,id:'child'};
    const childKeys=[{frame:0,shapes:fixed?[]:[child]},{frame:1,shapes:fixed?[child]:[]},{frame:2,shapes:[child]}];
    project.symbols!.push({id:'panel',name:'Panel',width:20,height:10,shapes:multilayer?[]:[child],
      ...(multilayer?{timeline:{duration:3,keys:[],layers:[{
        id:'controls',name:'Controls',visible:true,locked:false,keys:childKeys,
      }]}}:animated?{timeline:{duration:3,keys:childKeys.slice(1)}}:{})});
    local.shapes=[
      {...button,id:'first',symbolId:'panel',instanceName:'First',symbolPlayback:undefined},
      {...button,id:'second',symbolId:'panel',instanceName:'Second',x:25,symbolPlayback:undefined},
    ];
    if(fixed) for(const shape of local.shapes) shape.symbolPlayback={mode:'single',firstFrame:1};
  }
  const setter=nested?'setChildVisible("First","Action",':'setVisible("Action",';
  local.timeline!.frameScripts![0].source=`
    if(input.type==="pointerdown"&&input.buttonTarget&&!state.hiddenOnce){
      stage!.${setter}false); state.hiddenOnce=true; state.press=true;
    }
    if(input.type==="pointerup"){
      state.hit=!!input.buttonTarget; state.activated=!!input.buttonActivation;
    }
    if(input.reveal===true)stage!.${setter}true);
    timeline.stop();
  `;
  if(animated){const source=local.timeline!.frameScripts![0].source;local.timeline!.frameScripts=[0,1,2].map(frame=>({frame,source}));}
  const f=await pressSetup(page,project,true);
  const pixels=async()=>(await imagePixels(f.panel)).pixels.slice(0,2);
  const original=await pixels();
  expect(original).toEqual([[255,0,0,255],[255,0,0,255]]);
  await f.next('pointerdown');
  const hidden=await pixels();
  expect(hidden).toEqual([[255,255,255,255],original[1]]);
  await f.panel.getByRole('button',{name:'Capture script checkpoint',exact:true}).click();
  if(animated){
    await f.panel.getByLabel('Seek target frame').fill('2');
    await f.panel.getByRole('button',{name:'Seek stopped and step',exact:true}).click();
    await expect.poll(pixels).toEqual([[255,255,255,255],[255,255,255,255]]);
    await f.panel.getByLabel('Seek target frame').fill('3');
    await f.panel.getByRole('button',{name:'Seek stopped and step',exact:true}).click();
  }else{
    await f.panel.getByLabel('Script input JSON').fill('{"reveal":true}');
    await f.panel.getByRole('button',{name:'Send input and step',exact:true}).click();
  }
  await expect.poll(pixels).toEqual(original);
  await f.next('pointerup');
  await expect.poll(f.state).toMatchObject({hit:true,activated:false});
  await f.next('pointerdown');
  await f.next('pointerup');
  await expect.poll(f.state).toMatchObject({hit:true,activated:true});
  await f.panel.getByRole('button',{name:'Restore script checkpoint',exact:true}).click();
  await expect.poll(pixels).toEqual(hidden);
  await f.next('pointerup');
  await expect.poll(f.state).toMatchObject({hit:false,activated:false});
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local scripted placement transforms restore a private artwork checkpoint', async ({page}) => {
  const project=imageFixture(),local=project.symbols![0], asset=project.symbols![1];
  asset.timeline=undefined;
  asset.shapes=[{...local.shapes[0],id:'asset-art',x:0,y:0,fill:'#ff0000'}];
  const actor:Vector={...local.shapes[0],id:'actor',kind:'symbol',symbolId:asset.id,instanceName:'Actor'};
  local.shapes=[actor,{...actor,id:'peer',instanceName:'Peer',x:50}];
  local.timeline!.keys=[];
  local.timeline!.layers=[];
  local.timeline!.frameScripts=[{frame:0,source:`
    if (input.reset) {
      stage!.setTransform("Actor",{x:0,y:0,rotation:0});
      stage!.setBasis("Actor",[1,0,0,1]);
    } else if (input.affine) {
      stage!.setTransform("Actor",{x:40,y:0,rotation:0});
      stage!.setBasis("Actor",[-2,0,0.5,1]);
    } else if (input.invalid) {
      stage!.setTransform("Actor",{x:0,y:0,rotation:0});
      stage!.setBasis("Actor",[1,1,1,1]);
    } else stage!.setTransform("Actor",{x:40,y:0,rotation:90});
    state.rotation=stage!.getTransform("Actor")!.rotation;
    state.basis=[...stage!.getBasis("Actor")!];
    timeline.stop();
  `}];
  const f=await setup(page,project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork',{exact:true}).check();
  await f.prepare();
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true});
  const send=async (input: object)=>{
    await f.panel.getByLabel('Script input JSON').fill(JSON.stringify(input));
    await button('Send input and step').click();
  };
  const pixels=async ()=>(await imagePixels(f.panel)).pixels;
  const red=[255,0,0,255];
  const initial=await pixels();
  expect(initial[0]).toEqual(red);
  expect(initial[2]).toEqual(red);
  await button('Step script tick').click();
  await expect.poll(async ()=>(await f.state()).rotation).toBe(90);
  await expect.poll(pixels).toEqual([initial[1],red,red]);
  await send({affine:true});
  await expect.poll(async ()=>(await f.state()).basis).toEqual([-2,0,0.5,1]);
  await expect.poll(pixels).toEqual([red,red,red]);
  await button('Capture script checkpoint').click();
  await send({invalid:true});
  await expect(f.panel.getByRole('status')).toContainText('nonsingular');
  await expect.poll(pixels).toEqual([red,red,red]);
  await send({reset:true});
  await expect.poll(async ()=>(await f.state()).basis).toEqual([1,0,0,1]);
  await expect.poll(pixels).toEqual(initial);
  await button('Restore script checkpoint').click();
  await expect.poll(async ()=>(await f.state()).basis).toEqual([-2,0,0.5,1]);
  await expect.poll(pixels).toEqual([red,red,red]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local scripts create and remove preview-owned graphics through library links', async ({page})=>{
  const project=imageFixture(),local=project.symbols![0],asset=project.symbols![1];
  asset.timeline=undefined;
  asset.shapes=[{...local.shapes[0],id:'asset-art',x:0,y:0,fill:'#ff0000'}];
  project.libraryLinks=[{kind:'symbol',id:asset.id,name:'library.Decal'}];
  local.timeline!.keys=[];
  local.timeline!.layers=[];
  local.timeline!.frameScripts=[{frame:0,source:`
    if (input.remove) stage!.removeSpawned("Preview");
    else stage!.library.spawnGraphic("library.Decal","Preview",{x:20,y:0,rotation:0});
    state.exists=!!stage!.getSpawned("Preview");
    state.linked=stage!.library.get("library.Decal")?.id??null;
    timeline.stop();
  `}];
  const f=await setup(page,project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork',{exact:true}).check();
  await f.prepare();
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true});
  const pixels=async()=>(await imagePixels(f.panel)).pixels;
  const initial=await pixels(),red=[255,0,0,255];
  expect(initial[0]).toEqual(red);
  await button('Step script tick').click();
  await expect.poll(async ()=>(await f.state()).exists).toBe(true);
  await expect.poll(async ()=>(await f.state()).linked).toBe(asset.id);
  await expect.poll(pixels).toEqual([red,red,initial[2]]);
  await button('Capture script checkpoint').click();
  await f.panel.getByLabel('Script input JSON').fill('{"remove":true}');
  await button('Send input and step').click();
  await expect.poll(async ()=>(await f.state()).exists).toBe(false);
  await expect.poll(pixels).toEqual(initial);
  await button('Restore script checkpoint').click();
  await expect.poll(async ()=>(await f.state()).exists).toBe(true);
  await expect.poll(pixels).toEqual([red,red,initial[2]]);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local scripts resolve named graphic children under separate parent copies',async({page})=>{
  const project=imageFixture(),local=project.symbols![0],asset=project.symbols![1];
  asset.timeline=undefined;
  const base=local.shapes[0];
  const child:Vector={...base,id:'tag',kind:'symbol',symbolId:asset.id,instanceName:'Tag'};
  project.symbols!.push({id:'tag-panel',name:'Tag Panel',width:20,height:20,shapes:[child]});
  const first:Vector={...child,id:'first',instanceName:'First',symbolId:'tag-panel'};
  local.shapes=[first,{...first,id:'second',instanceName:'Second',x:25}];
  local.timeline!.keys=[];
  local.timeline!.layers=[];
  local.timeline!.frameScripts=[{frame:0,source:`
    const first=stage!.getChildInstance("First","Tag")!;
    const second=stage!.getChildInstance("Second","Tag")!;
    state.first=first.id;
    state.second=second.id;
    state.owner=second.parentId!;
    state.root=!!stage!.getInstance("Tag");
    timeline.stop();
  `}];
  const f=await setup(page,project);
  await f.open();
  await f.prepare();
  await f.panel.getByRole('button',{name:'Step script tick',exact:true}).click();
  await expect.poll(f.state).toEqual({first:'first/tag',second:'second/tag',owner:'second',root:false});
  await f.panel.getByRole('button',{name:'Replay retained script history',exact:true}).click();
  await expect(f.panel.getByRole('status')).toContainText('Replay matched');
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local linked bitmap preview restores its decoded artwork checkpoint',async({page})=>{
  const image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=12;canvas.height=8;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#00ff00';ctx.fillRect(0,0,12,8);
    return canvas.toDataURL('image/png');
  });
  const project=imageFixture(),local=project.symbols![0];
  project.assets=[{id:'picture',path:'assets/bitmaps/picture.json',bitmap:{name:'Picture',width:12,height:8,dataUrl:image}}];
  project.libraryLinks=[{kind:'bitmap',id:'picture',name:'art.Picture'}];
  local.timeline!.keys=[];
  local.timeline!.layers=[];
  local.timeline!.frameScripts=[{frame:0,source:`
    if (!stage) throw Error("Stage is unavailable.");
    if (input.remove) stage.removeSpawned("Print");
    else stage.library.spawnBitmap("art.Picture","Print",{x:20,y:0,rotation:0});
    state.id=stage.getSpawned("Print")?.assetId??null;
    timeline.stop();
  `}];
  const f=await setup(page,project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork',{exact:true}).check();
  await f.prepare();
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true});
  const pixels=async()=>(await imagePixels(f.panel)).pixels;
  const initial=await pixels(),green=[0,255,0,255];
  const placed=[initial[0],green,initial[2]];
  await button('Step script tick').click();
  await expect.poll(async ()=>(await f.state()).id).toBe('picture');
  await expect.poll(pixels).toEqual(placed);
  await button('Capture script checkpoint').click();
  await f.panel.getByLabel('Script input JSON').fill('{"remove":true}');
  await button('Send input and step').click();
  await expect.poll(async ()=>(await f.state()).id).toBeNull();
  await expect.poll(pixels).toEqual(initial);
  await button('Restore script checkpoint').click();
  await expect.poll(async ()=>(await f.state()).id).toBe('picture');
  await expect.poll(pixels).toEqual(placed);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('linked timeline symbols restart after removal in the local script preview',async({page})=>{
  const project=imageFixture(), local=project.symbols![0], asset=project.symbols![1];
  asset.defaultPlayback='movie';
  asset.timeline!.frameScripts=[{frame:0,source:'throw new Error("Linked descendant scripts must stay idle.");'}];
  project.libraryLinks=[{id:asset.id,kind:'symbol',name:'art.Movie'}];
  local.timeline!.layers=[];
  local.timeline!.keys=[];
  local.timeline!.frameScripts=[{frame:0,source:`
    if (!stage) throw Error("Stage is unavailable.");
    if (input.create) stage.library.spawnGraphic("art.Movie","Clip",{x:20,y:0,rotation:0});
    if (input.remove) stage.removeSpawned("Clip");
    state.id=stage.getSpawned("Clip")?.symbolId??null;
    timeline.stop();
  `}];
  const f=await setup(page,project);
  await f.open();
  await f.panel.getByLabel('Render detached artwork',{exact:true}).check();
  await f.prepare();
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true}),status=f.panel.getByRole('status');
  const send=async(data:object)=>{
    await f.panel.getByLabel('Script input JSON').fill(JSON.stringify(data));
    await button('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  };
  const pixel=async()=>(await imagePixels(f.panel)).pixels[1];
  const blank=await pixel(),blue=[0,0,255,255],yellow=[255,255,0,255];
  await send({create:true});
  await expect.poll(pixel).toEqual(blue);
  await button('Step script tick').click();
  await expect.poll(pixel).toEqual(yellow);
  await button('Capture script checkpoint').click();
  await send({remove:true});
  await expect.poll(pixel).toEqual(blank);
  await send({create:true});
  await expect.poll(pixel).toEqual(blue);
  await button('Restore script checkpoint').click();
  await expect.poll(pixel).toEqual(yellow);
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});

test('local script sound owns its permission, voice and checkpoint',async({page})=>{
  const project=fixture();
  project.assets=[{id:'local-tone',path:'assets/audio/local.wav',
    audio:{name:'Tone',format:'pcm16-wav',sampleRate:12000,channels:1,frames:36000}}];
  project.libraryLinks=[{id:'local-tone',kind:'audio',name:'fx.LocalTone'}];
  project.symbols![0].timeline!.frameScripts=[{frame:0,source:`
    const sound=stage?.sound;
    state.allowed=!!sound;
    if (input.play) sound?.play("fx.LocalTone",1200);
    if (input.pause) sound?.pause();
    if (input.resume) sound?.resume();
    if (typeof input.seek==="number") sound?.seekSamples(input.seek);
    state.position=sound?.positionSamples()??null;
    timeline.stop();
  `}];
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    const Native=window.AudioContext,contexts:AudioContext[]=[],starts:number[]=[],probes:AnalyserNode[]=[];
    Object.assign(window,{localSound:{contexts,starts,probes},AudioContext:class extends Native {
      constructor(){super();contexts.push(this);}
      createBufferSource(){
        const node=super.createBufferSource(),start=node.start.bind(node),probe=this.createAnalyser();
        probes.push(probe);node.connect(probe);
        node.start=(when=0,offset=0,duration?:number)=>{starts.push(offset);start(when,offset,duration);};
        return node;
      }
    }});
  });
  const f=await setup(page,project);
  const button=(name:string)=>f.panel.getByRole('button',{name,exact:true}),status=f.panel.getByRole('status');
  const send=async(data:object)=>{
    await f.panel.getByLabel('Script input JSON').fill(JSON.stringify(data));
    await button('Send input and step').click();
    await expect(status).toHaveText('Completed 1 script tick.');
  };
  const audio=()=>page.evaluate(()=>{
    const {contexts,starts}=Reflect.get(window,'localSound') as {contexts:AudioContext[];starts:number[]};
    return {states:contexts.map(context=>context.state),starts};
  });
  await f.open();
  await f.prepare();
  await send({play:true});
  expect(await f.state()).toEqual({allowed:false,position:null});
  expect(await audio()).toEqual({states:[],starts:[]});
  await button('Close local script inspector').click();
  await f.open();
  await f.panel.getByLabel('Enable scripted sound').check();
  const pcm=Float32Array.from({length:36000},(_,i)=>0.4*Math.sin(i*2*Math.PI*220/12000));
  await f.panel.getByLabel('WAV for fx.LocalTone').setInputFiles({
    name:'local.wav',mimeType:'audio/wav',buffer:Buffer.from(encodePcm16Wav([pcm],12000)),
  });
  await f.panel.getByLabel('Render detached artwork').check();
  await f.prepare();
  await send({play:true});
  expect(await audio()).toEqual({states:['running'],starts:[0.1]});
  await expect.poll(()=>page.evaluate(()=>{
    const {probes}=Reflect.get(window,'localSound') as {probes:AnalyserNode[]};
    const wave=new Float32Array(probes[0].fftSize);
    probes[0].getFloatTimeDomainData(wave);
    return Math.max(...wave);
  })).toBeGreaterThan(0.2);
  await send({pause:true,seek:6000});
  expect((await f.state()).position).toBe(6000);
  await button('Capture script checkpoint').click();
  await send({resume:true});
  expect(await audio()).toEqual({states:['running'],starts:[0.1,0.5]});
  await button('Restore script checkpoint').click();
  await expect(status).toContainText('Checkpoint restored');
  expect((await f.state()).position).toBe(6000);
  expect(await audio()).toEqual({states:['running'],starts:[0.1,0.5]});
  await send({resume:true});
  expect(await audio()).toEqual({states:['running'],starts:[0.1,0.5,0.5]});
  await f.dialog.getByLabel('Symbol frame',{exact:true}).evaluate(input=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2');
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(f.panel.getByRole('alert')).toContainText(/changed|invalidated/);
  await expect.poll(async()=>(await audio()).states).toEqual(['closed']);
  await button('Close local script inspector').click();
  await f.open();
  await expect(f.panel.getByLabel('Enable scripted sound')).not.toBeChecked();
  expect(await f.read()).toEqual(project);
  expect(f.errors).toEqual([]);
});
