import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project, MotionSpanOptions } from '../../packages/document/src';
import { readFile } from 'node:fs/promises';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';

async function setup(page: Page, mode = 'plain') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const p = mode === 'movie' ? livePresentationFixture('movie') : liveSplitFixture();
  delete p.layers[0].liveMotionSpans;
  p.layers[0].name = 'Main';
  p.layers[0].drawingMode = mode === 'merge' ? 'merge' : 'object';
  p.fps = 1;
  if (mode === 'strokeColor') {
    for (const [i, key] of p.layers[0].keys.slice(0, 2).entries())
      Object.assign(key.shapes[0], { strokeWidth: 6, stroke: i ? '#ffffff' : '#000000' });
  }
  if (mode === 'gradientKeys') for (const key of p.layers[0].keys.slice(0,2))
    key.shapes[0].gradient={kind:'linear',from:{x:5,y:0},to:{x:15,y:0},stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]};
  if (mode === 'paint') {
    p.layers[0].keys[0].shapes[0].fill = '#000000';
    p.layers[0].keys[1].shapes[0].fill = '#808080';
  }
  if (mode === 'primitives') p.layers[0].keys[1].shapes[0].width = 30;
  if (mode === 'affine' || mode === 'reflected')
    for (const key of p.layers[0].keys.slice(0, 2))
      Object.assign(key.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [mode === 'reflected' ? -1.5 : 1.5, 0.2, 0.3, 1],
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
          ],
        ],
      });
  if (mode === 'pivots' || mode === 'defaults') {
    if (mode === 'pivots') p.layers[0].keys[0].shapes[0].pivot = { x: 1, y: 2 };
    p.layers[0].keys[1].shapes[0].pivot = { x: 9, y: 10 };
  }
  if (mode === 'multiple')
    for (const key of p.layers[0].keys.slice(0, 2))
      key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'second', y: 55 });
  if (mode === 'two' || mode === 'laterBad' || mode === 'inactive' || mode === 'disjoint') {
    p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
    if (mode === 'laterBad') p.layers[1].keys[1].shapes[0].kind = 'ellipse';
    if (mode === 'inactive') p.layers[0].locked = true;
    if (mode === 'disjoint') {
      p.duration = 20;
      const later = p.layers[1];
      later.keys = [
        { frame: 0, shapes: [] },
        { frame: 8, shapes: [{ ...structuredClone(later.keys[0].shapes[0]), x: 20 }] },
        { frame: 16, shapes: [{ ...structuredClone(later.keys[1].shapes[0]), x: 100 }] },
        { frame: 18, shapes: [] },
      ];
    }
  }
  if (mode === 'interior')
    p.layers[0].keys.splice(1, 0, {
      frame: 4,
      shapes: [{ ...structuredClone(p.layers[0].keys[0].shapes[0]), x: 40 }],
    });
  if (mode === 'locked') p.layers[0].locked = true;
  if (mode === 'hidden') p.layers[0].visible = false;
  if (mode === 'group')
    for (const key of p.layers[0].keys.slice(0, 2)) key.shapes[0].groups = ['group'];
  if (mode === 'blank') p.layers[0].keys[1].shapes = [];
  if (mode === 'baked') createBasicMotionSpan(p, [p.layers[0].id], 0, 8, 'linear');
  if (mode === 'overlap')
    p.layers[0].liveMotionSpans = [{ id: 'existing', start: 0, end: 8, ease: 'linear' }];
  if (mode === 'opacity')
    p.opacityBindings = [
      {
        layerId: 'track',
        shapeId: 'art',
        start: 0,
        end: 8,
        keys: [
          { frame: 0, opacity: 1 },
          { frame: 8, opacity: 0.5 },
        ],
      },
    ];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-create-seed')) {
      sessionStorage.setItem('live-create-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  const open = async () => {
    const command = page.getByRole('button', { name: 'Create live tween…', exact: true });
    if (!(await command.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await command.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Create live tween', exact: true });
  await expect(d).toBeVisible();
  return {
    p,
    d,
    errors,
    open,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function create(page: Page) {
  const d = page.getByRole('dialog', { name: 'Create live tween', exact: true });
  await d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  await expect(d).toBeHidden();
}
async function go(page: Page, n: number) {
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
}
async function undo(page: Page, redo = false) {
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}
async function stagePixel(page: Page, project: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (p.x - p.project.width / 2) * devicePixelRatio,
            c.height / 2 + (p.y - p.project.height / 2) * devicePixelRatio,
            1,
            1,
          ).data,
      );
    },
    { project, x, y },
  );
}

for (const mode of [
  'plain',
  'in',
  'out',
  'in-out',
  'custom',
  'paint',
  'primitives',
  'affine',
  'reflected',
  'pivots',
  'defaults',
  'multiple',
  'two',
  'merge',
])
  test(`create live ${mode} keeps exact keys/options, complete selection and one history transaction`, async ({
    page,
  }) => {
    const f = await setup(page, mode),
      options: MotionSpanOptions = {};
    const createButton = f.d.getByRole('button', { name: 'Create live tween', exact: true });
    if (mode === 'plain') {
      const start = f.d.getByLabel('Live tween start frame', { exact: true });
      const close = f.d.getByRole('button', { name: 'Close dialog', exact: true });
      await expect(start).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(createButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(f.d).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Control', exact: true })).toBeFocused();
      expect(await f.read()).toEqual(f.p);
      await f.open();
      await expect(start).toBeFocused();
    }
    let ease:
      | 'linear'
      | 'in'
      | 'out'
      | 'in-out'
      | { kind: 'cubic'; x1: number; y1: number; x2: number; y2: number } = 'linear';
    if (['in', 'out', 'in-out'].includes(mode)) {
      ease = mode as 'in' | 'out' | 'in-out';
      await f.d.getByLabel('Live tween easing', { exact: true }).selectOption(mode);
    }
    if (mode === 'custom') {
      await f.d.getByLabel('Live tween easing', { exact: true }).selectOption('custom');
      ease = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 1 };
      for (const [key, value] of Object.entries({ X1: '0', Y1: '0', X2: '1', Y2: '1' }))
        await f.d.getByLabel('Live tween easing ' + key, { exact: true }).fill(value);
    }
    if (['paint', 'primitives', 'affine', 'reflected', 'pivots', 'defaults'].includes(mode)) {
      await f.d.getByText('Interpolation options', { exact: true }).click();
      const names =
        mode === 'paint'
          ? ['paint']
          : mode === 'primitives'
            ? ['primitives']
            : mode === 'affine' || mode === 'reflected'
              ? ['affine', 'nodes']
              : mode === 'defaults'
                ? ['affine', 'pivots', 'defaultPivots']
                : ['affine', 'pivots'];
      for (const name of names) {
        await f.d.locator(`input[data-live-option="${name}"]`).check();
        Object.assign(options, { [name]: true });
      }
    }
    if (mode === 'two') await f.d.getByLabel('Create live track Later', { exact: true }).check();
    if (mode === 'plain') {
      await createButton.press('Enter');
      await expect(f.d).toHaveCount(0);
      await expect(page.getByLabel('Drawing stage', { exact: true })).toBeFocused();
    } else await create(page);
    const out = await f.read(),
      expected = structuredClone(f.p);
    for (const id of mode === 'two' ? ['track', 'later'] : ['track']) {
      const layer = out.layers.find((l) => l.id === id)!,
        span = layer.liveMotionSpans![0];
      expect(span.id).toBeTruthy();
      expected.layers.find((l) => l.id === id)!.liveMotionSpans = [
        {
          id: span.id,
          start: 0,
          end: 8,
          ease,
          ...(Object.keys(options).length ? { options } : {}),
        },
      ];
    }
    expect(out).toEqual(expected);
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    if (mode === 'multiple')
      await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
    else if (mode !== 'merge')
      await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
    if (mode === 'plain') await page.keyboard.press('Control+z');
    else await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (mode === 'plain') await page.keyboard.press('Control+Shift+z');
    else await undo(page, true);
    expect(await f.read()).toEqual(out);
    await go(page, 2);
    await expect(page.getByLabel('Live stage status')).toContainText('read-only');
    const x = mode === 'in' ? 13 : mode === 'out' ? 43 : mode === 'in-out' ? 18 : 28;
    expect(
      await stagePixel(
        page,
        f.p,
        mode === 'reflected' ? x - 3 : mode === 'primitives' ? x + 21 : x + 3,
        17,
      ),
    ).toEqual(mode === 'paint' ? [32, 32, 32, 255] : [255, 0, 0, 255]);
    expect(f.errors).toEqual([]);
  });

test('create, reopen and remove an independent live stroke color channel', async ({page}) => {
  const f = await setup(page, 'strokeColor');
  await f.d.getByText('Interpolation options', {exact:true}).click();
  await f.d.locator('input[data-live-option="strokeColor"]').check();
  await create(page);
  const created = await f.read();
  const span = created.layers[0].liveMotionSpans![0];
  expect(created).toEqual({...f.p, layers: [{...f.p.layers[0], liveMotionSpans: [
    {id:span.id, start:0, end:8, ease:'linear', options:{strokeColor:true}}
  ]}]});
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,38,12)).toEqual([64,64,64,255]);
  expect(await stagePixel(page,f.p,38,22)).toEqual([255,0,0,255]);
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Edit live tween',exact:true});
    await dialog.getByText('Interpolation option changes',{exact:true}).click();
    return dialog;
  };
  let dialog = await edit();
  await dialog.getByLabel('Edit live option paint',{exact:true}).selectOption('enable');
  await dialog.getByLabel('Live paint easing mode',{exact:true}).selectOption('set');
  await dialog.getByLabel('Live paint easing',{exact:true}).selectOption('in');
  await dialog.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
  await expect(dialog).toBeHidden();
  await go(page,2);
  expect(await stagePixel(page,f.p,38,12)).toEqual([64,64,64,255]);
  const combined=await f.read();
  dialog=await edit();
  await dialog.getByLabel('Edit live option strokeColor',{exact:true}).selectOption('remove');
  await dialog.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
  await expect(dialog).toBeHidden();
  const removed=structuredClone(combined);
  delete removed.layers[0].liveMotionSpans![0].options!.strokeColor;
  expect(await f.read()).toEqual(removed);
  expect(removed.layers[0].keys).toEqual(f.p.layers[0].keys);
  await go(page,2);
  expect(await stagePixel(page,f.p,38,12)).toEqual([16,16,16,255]);
  await undo(page);
  expect(await f.read()).toEqual(combined);
  await undo(page,true);
  expect(await f.read()).toEqual(removed);
});

test('interior stroke key edits persist without artwork keys and split at the authored color', async ({page}) => {
  const f = await setup(page,'strokeColor');
  await f.d.getByText('Interpolation options',{exact:true}).click();
  await f.d.locator('input[data-live-option="strokeColor"]').check();
  await create(page);
  const update = async (action:string, color?:string) => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Edit live tween',exact:true});
    await dialog.getByText('Stroke color keys',{exact:true}).click();
    await dialog.getByLabel('Stroke key action').selectOption(action);
    await dialog.getByLabel('Stroke key frame').fill('5');
    if (color) await dialog.getByLabel('Stroke key color').fill(color);
    await dialog.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(dialog).toBeHidden();
  };
  await update('set','#0000ff');
  await update('set','#00ff00');
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0].strokeColorKeys).toEqual([{offset:4,color:'#00ff00'}]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,38,12)).toEqual([0,128,0,255]);
  await update('delete');
  expect((await f.read()).layers[0].liveMotionSpans![0].strokeColorKeys).toBeUndefined();
  await undo(page);
  expect(await f.read()).toEqual(saved);
  await go(page,4);
  await page.keyboard.press('F6');
  const split=await f.read();
  expect(split.layers[0].keys.map(k=>k.frame)).toEqual([0,4,8,10]);
  expect(split.layers[0].keys[1].shapes[0].stroke).toBe('#00ff00');
  await go(page,6);
  expect(await stagePixel(page,f.p,78,12)).toEqual([128,255,128,255]);
});

test('interior opacity keys fade the live stage and recover, edit and clear independently', async ({page}) => {
  const f = await setup(page);
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  async function setOpacity(percent:string) {
    const d = await edit();
    await d.getByText('Opacity keys',{exact:true}).click();
    await d.getByLabel('Opacity key action').selectOption('set');
    await d.getByLabel('Opacity key frame').fill('3');
    await d.getByLabel('Opacity (%)',{exact:true}).fill(percent);
    await apply(d);
  }
  await setOpacity('0');
  await go(page,2);
  expect(await stagePixel(page,f.p,38,22)).toEqual([255,255,255,255]);
  await setOpacity('50');
  const saved = await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0].opacityKeys).toEqual([{offset:2,value:0.5}]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  const [red,green,blue,alpha]=await stagePixel(page,f.p,38,22);
  expect([red,alpha]).toEqual([255,255]); expect(Math.abs(green-127)).toBeLessThanOrEqual(1); expect(blue).toBe(green);
  const d = await edit();
  await d.getByText('Opacity keys',{exact:true}).click();
  await d.getByRole('button',{name:'Frame 3 · 50%',exact:true}).click();
  await d.getByLabel('Opacity key action').selectOption('delete');
  await apply(d);
  expect(await f.read()).toEqual(original);
  await undo(page); expect(await f.read()).toEqual(saved);
  await undo(page,true); expect(await f.read()).toEqual(original);
});
test('matched gradient stop keys render independently, recover and remove with undo', async ({page}) => {
  const f = await setup(page,'gradientKeys');
  await f.d.getByText('Interpolation options',{exact:true}).click();
  await f.d.locator('input[data-live-option="paint"]').check();
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  async function setColor(stop:number,color:string){
    const d=await edit();
    await d.getByText('Gradient stop color keys',{exact:true}).click();
    await d.getByLabel('Gradient stop',{exact:false}).first().selectOption({index:stop});
    await d.getByLabel('Gradient key action').selectOption('set');
    await d.getByLabel('Gradient key frame').fill(stop===0 ? '3' : '5');
    await d.getByLabel('Gradient key color').fill(color);
    await apply(d);
  }
  await setColor(0,'#00ff00'); await setColor(1,'#ffff00');
  const timing=await edit();
  await timing.getByText('Gradient stop color keys',{exact:true}).click();
  await timing.getByLabel('Gradient stop',{exact:false}).first().selectOption({index:1});
  await timing.getByLabel('Gradient stop interval ending at').selectOption('4');
  await timing.getByLabel('Gradient stop interval easing',{exact:true}).selectOption('in');
  await apply(timing);
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,30,22)).toEqual([0,255,0,255]);
  expect(await stagePixel(page,f.p,46,22)).toEqual([64,64,191,255]);
  await go(page,4);
  expect(await stagePixel(page,f.p,66,22)).toEqual([255,255,0,255]);
  const d=await edit(); await d.getByText('Gradient stop color keys',{exact:true}).click();
  await d.getByRole('button',{name:'Frame 3 · #00ff00',exact:true}).click();
  await d.getByLabel('Gradient key action').selectOption('delete'); await apply(d);
  const cleared=structuredClone(saved); cleared.layers[0].liveMotionSpans![0].gradientColorTracks=cleared.layers[0].liveMotionSpans![0].gradientColorTracks!.slice(1);
  expect(await f.read()).toEqual(cleared);
  await undo(page); expect(await f.read()).toEqual(saved);
  await undo(page,true); expect(await f.read()).toEqual(cleared);
});
test('shear keys skew the artwork in either direction and recover, remove and undo', async ({page}) => {
  const f = await setup(page);
  await f.d.getByText('Interpolation options',{exact:true}).click();
  await f.d.locator('input[data-live-option="affine"]').check();
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  async function setShear(percent:string) {
    const d=await edit();
    await d.getByText('Shear keys',{exact:true}).click();
    await d.getByLabel('Shear key action').selectOption('set');
    await d.getByLabel('Shear key frame').fill('3');
    await d.getByLabel('Shear (%)',{exact:true}).fill(percent);
    await apply(d);
  }
  await setShear('100');
  await go(page,2);
  expect(await stagePixel(page,f.p,55,27)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,30,27)).toEqual([255,255,255,255]);
  await setShear('-100');
  const skew=await edit();
  await skew.getByText('Shear keys',{exact:true}).click();
  await skew.getByLabel('Shear interval ending at').selectOption('2');
  await skew.getByLabel('Shear interval easing',{exact:true}).selectOption('in');
  await apply(skew);
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0].shearKeys).toEqual([{offset:2,value:-1}]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,1);
  expect(await stagePixel(page,f.p,12,27)).toEqual([255,255,255,255]);
  await go(page,2);
  expect(await stagePixel(page,f.p,19,27)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,55,27)).toEqual([255,255,255,255]);
  const d=await edit();
  await d.getByText('Shear keys',{exact:true}).click();
  await d.getByRole('button',{name:'Frame 3 · -100%',exact:true}).click();
  await d.getByLabel('Shear key action').selectOption('delete');
  await apply(d);
  expect(await f.read()).toEqual(original);
  await undo(page); expect(await f.read()).toEqual(saved);
  await undo(page,true); expect(await f.read()).toEqual(original);
});
test('independent affine scale keys resize the live stage, recover and undo', async ({page}) => {
  const f = await setup(page);
  await f.d.getByText('Interpolation options',{exact:true}).click();
  await f.d.locator('input[data-live-option="affine"]').check();
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  const dialog=await edit();
  for(const [label,frame,value] of [['Horizontal scale','3','200'],['Vertical scale','5','50']]){
    await dialog.getByText(label+' keys',{exact:true}).click();
    await dialog.getByLabel(label+' key action').selectOption('set');
    await dialog.getByLabel(label+' key frame').fill(frame);
    await dialog.getByLabel(label+' (%)',{exact:true}).fill(value);
  }
  await apply(dialog);
  const timing=await edit();
  for(const [axis,offset,ease] of [['Horizontal scale','2','in'],['Vertical scale','4','out']]){
    await timing.getByText(axis+' keys',{exact:true}).click();
    await timing.getByLabel(axis+' interval ending at').selectOption(offset);
    await timing.getByLabel(axis+' interval easing',{exact:true}).selectOption(ease);
  }
  await apply(timing);
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0]).toMatchObject({sxKeyEases:['in','linear'],syKeyEases:['out','linear'],scaleXKeys:[{offset:2,value:2}],scaleYKeys:[{offset:4,value:0.5}]});
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,1);
  expect(await stagePixel(page,f.p,41,20)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,45,20)).toEqual([255,255,255,255]);
  await go(page,2);
  expect(await stagePixel(page,f.p,62,20)).toEqual([255,0,0,255]);
  await go(page,4);
  expect(await stagePixel(page,f.p,58,28)).toEqual([255,255,255,255]);
  expect(await stagePixel(page,f.p,58,18)).toEqual([255,0,0,255]);
  const d=await edit();
  await d.getByText('Horizontal scale keys',{exact:true}).click();
  await d.getByLabel('Horizontal scale key action').selectOption('clear');
  await apply(d);
  const cleared=structuredClone(saved);
  delete cleared.layers[0].liveMotionSpans![0].scaleXKeys;
  delete cleared.layers[0].liveMotionSpans![0].sxKeyEases;
  expect(await f.read()).toEqual(cleared);
  await undo(page); expect(await f.read()).toEqual(saved);
  await undo(page,true); expect(await f.read()).toEqual(cleared);
});
test('unwrapped rotation keys turn the stage artwork and recover, edit and undo', async ({page}) => {
  const f = await setup(page);
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  const d=await edit();
  await d.getByText('Rotation keys',{exact:true}).click();
  await d.getByLabel('Rotation key action').selectOption('set');
  await d.getByLabel('Rotation key frame').fill('5');
  await d.getByLabel('Rotation (degrees)',{exact:true}).fill('360');
  await apply(d);
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0].rotationKeys).toEqual([{offset:4,value:360}]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,1);
  expect(await stagePixel(page,f.p,8,22)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,28,22)).toEqual([255,255,255,255]);
  const changed=await edit();
  await changed.getByText('Rotation keys',{exact:true}).click();
  await changed.getByRole('button',{name:'Frame 5 · 360°',exact:true}).click();
  await changed.getByLabel('Rotation (degrees)',{exact:true}).fill('-360');
  await apply(changed);
  await go(page,1);
  expect(await stagePixel(page,f.p,28,6)).toEqual([255,0,0,255]);
  await undo(page); expect(await f.read()).toEqual(saved);
  const clear=await edit();
  await clear.getByText('Rotation keys',{exact:true}).click();
  await clear.getByLabel('Rotation key action').selectOption('clear');
  await apply(clear);
  expect(await f.read()).toEqual(original);
});
test('independent X and Y keys reposition artwork after recovery and undo together', async ({page}) => {
  const f = await setup(page);
  await create(page);
  const original = await f.read();
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  const dialog = await edit();
  for (const [name,frame,value] of [['X','3','70'],['Y','5','42']]) {
    const section = dialog.locator('details').filter({has:page.getByText(name+' position keys',{exact:true})});
    await section.getByText(name+' position keys',{exact:true}).click();
    await section.getByLabel(name+' key action').selectOption('set');
    await section.getByLabel(name+' key frame').fill(frame);
    await section.getByLabel(name+' coordinate').fill(value);
  }
  await apply(dialog);
  const saved = await f.read();
  expect(saved.layers[0].keys).toEqual(original.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0]).toMatchObject({xKeys:[{offset:2,value:70}],yKeys:[{offset:4,value:42}]});
  await undo(page); expect(await f.read()).toEqual(original);
  await undo(page,true); expect(await f.read()).toEqual(saved);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,80,37)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,38,22)).toEqual([255,255,255,255]);
  const reopened = await edit();
  await reopened.getByText('X position keys',{exact:true}).click();
  await reopened.getByRole('button',{name:'Frame 3 · 70',exact:true}).click();
  await reopened.getByLabel('X key action').selectOption('delete');
  await apply(reopened);
  const withoutX = structuredClone(saved);
  delete withoutX.layers[0].liveMotionSpans![0].xKeys;
  expect(await f.read()).toEqual(withoutX);
  await undo(page); expect(await f.read()).toEqual(saved);
});
test('fill and stroke keys coexist at separate times and fill edits recover independently', async ({page}) => {
  const f = await setup(page,'strokeColor');
  await f.d.getByText('Interpolation options',{exact:true}).click();
  for (const field of ['paint','strokeColor']) await f.d.locator(`input[data-live-option="${field}"]`).check();
  await create(page);
  const edit = async () => {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    return page.getByRole('dialog',{name:'Edit live tween',exact:true});
  };
  const apply = async (d: ReturnType<Page['getByRole']>) => {
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  };
  let dialog = await edit();
  for(const [name,frame,color] of [['Fill','3','#3f00c0'],['Stroke','5','#00ff00']]){
    await dialog.getByText(name+' color keys',{exact:true}).click();
    await dialog.getByLabel(name+' key action').selectOption('set');
    await dialog.getByLabel(name+' key frame').fill(frame);
    await dialog.getByLabel(name+' key color').fill(color);
  }
  await apply(dialog);
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0]).toMatchObject({fillColorKeys:[{offset:2,color:'#3f00c0'}],strokeColorKeys:[{offset:4,color:'#00ff00'}]});
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,38,22)).toEqual([63,0,192,255]);
  expect(await stagePixel(page,f.p,38,12)).toEqual([0,128,0,255]);
  await go(page,4);
  expect(await stagePixel(page,f.p,58,22)).toEqual([127,0,128,255]);
  expect(await stagePixel(page,f.p,58,12)).toEqual([0,255,0,255]);
  dialog=await edit();
  await dialog.getByText('Fill color keys',{exact:true}).click();
  await dialog.getByRole('button',{name:'Frame 3 · #3f00c0',exact:true}).click();
  await dialog.getByLabel('Fill key action').selectOption('delete');
  await apply(dialog);
  const expected=structuredClone(saved);
  delete expected.layers[0].liveMotionSpans![0].fillColorKeys;
  expect(await f.read()).toEqual(expected);
  await go(page,4);
  expect(await stagePixel(page,f.p,58,22)).toEqual([255,0,0,255]);
  expect(await stagePixel(page,f.p,58,12)).toEqual([0,255,0,255]);
  await undo(page); expect(await f.read()).toEqual(saved);
  await undo(page,true); expect(await f.read()).toEqual(expected);
});

test('created live tween immediately drives stage, Test Movie and single-frame PNG, then recovers', async ({
  page,
}) => {
  const f = await setup(page, 'movie');
  await create(page);
  const out = await f.read();
  await go(page, 2);
  await expect(page.getByLabel('Live stage status')).toContainText('read-only');
  // Use actual stage geometry to map world pixels, independent of export output.
  const stage = page.getByLabel('Drawing stage');
  expect(await stagePixel(page, f.p, 45, 5)).toEqual([255, 0, 0, 255]);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  const pixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.drawImage(image, 0, 0);
    return [
      [45, 5],
      [65, 45],
    ].map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
  expect(
    await d
      .getByLabel('Live movie interaction')
      .evaluate((el) =>
        Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(45, 5, 1, 1).data),
      ),
  ).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(out);
  await expect(stage).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
  expect(f.errors).toEqual([]);
});

for (const mode of [
  'locked',
  'hidden',
  'blank',
  'group',
  'baked',
  'overlap',
  'opacity',
  'interior',
  'fraction',
  'missing',
  'outside',
])
  test(`live creation rejects ${mode} without deleting keys or adding history`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    if (mode === 'interior' || mode === 'baked')
      await f.d.getByLabel('Live tween end frame').fill('9');
    if (mode === 'fraction') await f.d.getByLabel('Live tween start frame').fill('1.5');
    if (mode === 'missing') await f.d.getByLabel('Live tween start frame').fill('2');
    if (mode === 'outside') await f.d.getByLabel('Live tween end frame').fill('13');
    await expect(
      f.d.getByRole('button', { name: 'Create live tween', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(f.d).toBeHidden();
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('later incompatible track rejects the whole request and fresh single-track retry retains its span ID', async ({
  page,
}) => {
  const f = await setup(page, 'laterBad');
  await f.d.getByLabel('Create live track Later').check();
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { liveCreateIDs: string[] };
    w.liveCreateIDs = [];
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (Array.isArray(value) && value[0]?.layerId === 'track' && value[0]?.span?.id)
        w.liveCreateIDs.push(value[0].span.id);
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Create live track Later').uncheck();
  await create(page);
  const out = await f.read();
  const ids = await page.evaluate(
    () => (window as unknown as { liveCreateIDs: string[] }).liveCreateIDs,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(out.layers[0].liveMotionSpans![0].id).toBe(ids[0]);
  expect(out.layers[1]).toEqual(f.p.layers[1]);
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('forged enabled NaN input rejects before normalization and a fresh valid request recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await f.d.getByLabel('Live tween start frame').fill('');
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).evaluate((el) => {
    (el as HTMLButtonElement).disabled = false;
    (el as HTMLButtonElement).click();
  });
  await expect(f.d.getByRole('status')).toContainText('finite');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Live tween start frame').fill('1');
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const hook of ['clone', 'serialize'])
  for (const action of [
    'frame',
    'tracks',
    'ease',
    'options',
    'source',
    'editorFrame',
    'tool',
    'mode',
    'close',
  ])
    test(`live creation ${hook} rejects actual late ${action} and keeps independent history`, async ({
      page,
    }) => {
      const f = await setup(page);
      if (action === 'options')
        await f.d.getByText('Interpolation options', { exact: true }).click();
      if (action === 'mode') {
        await page
          .getByRole('button', { name: 'Control', exact: true })
          .evaluate((el) => (el as HTMLButtonElement).click());
        await expect(
          page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }),
        ).toBeAttached();
      }
      await page.evaluate(
        ({ hook, action }) => {
          const w = window as unknown as { liveCreateHookHit: boolean };
          w.liveCreateHookHit = false;
          const fire = (value: unknown) => {
            const p = value as Project;
            if (w.liveCreateHookHit || !p?.layers?.[0]?.liveMotionSpans?.length) return;
            w.liveCreateHookHit = true;
            if (action === 'frame') {
              const e = document.querySelector(
                '[aria-label="Live tween end frame"]',
              ) as HTMLInputElement;
              for (const v of ['8', '9']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'tracks' || action === 'options') {
              const e = document.querySelector(
                action === 'tracks'
                  ? '[aria-label="Create live track Main"]'
                  : '[data-live-option="paint"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            }
            if (action === 'ease') {
              const e = document.querySelector(
                '[aria-label="Live tween easing"]',
              ) as HTMLSelectElement;
              for (const v of ['in', 'linear']) {
                e.value = v;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Separate source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'editorFrame')
              for (const title of ['Last frame', 'First frame'])
                (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
            if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
            if (action === 'mode')
              for (let i = 0; i < 2; i++) {
                const e = [...document.querySelectorAll('button')].find(
                  (e) =>
                    e.textContent === 'Show sampled motion on stage' ||
                    e.textContent === 'Return to authored stage',
                );
                if (!e) throw Error('Missing actual sampled mode control');
                e.click();
              }
            if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(value: T) => {
              const out = clone(value);
              fire(value);
              return out;
            };
          } else {
            const stringify = JSON.stringify;
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args);
              fire(args[0]);
              return out;
            }) as typeof stringify;
          }
        },
        { hook, action },
      );
      await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { liveCreateHookHit: boolean }).liveCreateHookHit,
        ),
      ).toBe(true);
      const out = await f.read();
      expect(out.layers[0].liveMotionSpans).toBeUndefined();
      expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
      if (action === 'source') {
        expect(out.layers[0].name).toBe('Separate source edit');
        await expect(f.d).toBeHidden();
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      } else {
        expect(out).toEqual(f.p);
        if (await f.d.isVisible()) await page.keyboard.press('Escape');
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      }
      // Original-value restoration never revives a stale request; a new command does.
      await f.open();
      await create(page);
      expect((await f.read()).layers[0].liveMotionSpans).toHaveLength(1);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('source edit during actual history before-image cloning cannot publish the pending live tween', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const stringify = JSON.stringify,
      w = window as unknown as { liveHistoryHit: boolean };
    w.liveHistoryHit = false;
    JSON.stringify = ((...args: Parameters<typeof stringify>) => {
      const out = stringify(...args),
        p = args[0] as Project;
      if (
        !w.liveHistoryHit &&
        p?.layers?.[0]?.id === 'track' &&
        new Error().stack?.includes('prepareRecord')
      ) {
        w.liveHistoryHit = true;
        const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
        e.value = 'Separate history edit';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return out;
    }) as typeof stringify;
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { liveHistoryHit: boolean }).liveHistoryHit),
  ).toBe(true);
  await expect(f.d).toBeHidden();
  const out = await f.read();
  expect(out.layers[0].name).toBe('Separate history edit');
  expect(out.layers[0].liveMotionSpans).toBeUndefined();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('cloned request accessors reject without invoking getters and allow a fresh retry', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { liveRequestHit: boolean; liveGetterReads: number };
    w.liveRequestHit = false;
    w.liveGetterReads = 0;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        r = out as unknown as { tracks?: string[]; ease?: unknown };
      if (!w.liveRequestHit && r?.tracks?.length) {
        w.liveRequestHit = true;
        Object.defineProperty(r, 'ease', {
          enumerable: true,
          get() {
            w.liveGetterReads++;
            return 'linear';
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { liveRequestHit: boolean; liveGetterReads: number };
      return { hit: w.liveRequestHit, reads: w.liveGetterReads };
    }),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['inactive', 'disjoint'])
  test(`creation ${mode} selects the complete admitted track and its actual authored start key`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    if (mode === 'disjoint') {
      await f.d.getByLabel('Live tween start frame').fill('9');
      await f.d.getByLabel('Live tween end frame').fill('17');
      await f.d.getByLabel('Create live track Main').uncheck();
      await f.d.getByLabel('Create live track Later').check();
    }
    await create(page);
    const out = await f.read();
    expect(out.layers[0]).toEqual(f.p.layers[0]);
    expect(out.layers[1].keys).toEqual(f.p.layers[1].keys);
    expect(out.layers[1].liveMotionSpans![0]).toMatchObject({
      start: mode === 'disjoint' ? 8 : 0,
      end: mode === 'disjoint' ? 16 : 8,
      ease: 'linear',
    });
    await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Later');
    await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue(
      mode === 'disjoint' ? '20' : '8',
    );
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('original creation snapshot corruption rejects before opening and a fresh command recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { creationSnapshotHit: boolean };
    w.creationSnapshotHit = false;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        p = out as unknown as Project;
      if (!w.creationSnapshotHit && p?.layers?.[0]?.id === 'track') {
        w.creationSnapshotHit = true;
        p.layers[0].keys[0].shapes[0].x++;
      }
      return out;
    };
  });
  await f.open();
  await expect(f.d).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('snapshot changed');
  expect(
    await page.evaluate(
      () => (window as unknown as { creationSnapshotHit: boolean }).creationSnapshotHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('candidate mutation during the final before-image clone cannot become authored artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { creationCandidateHit: boolean };
    w.creationCandidateHit = false;
    let candidate: Project | undefined;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value),
        p = out as unknown as Project;
      if (p?.layers?.[0]?.liveMotionSpans?.length) candidate = p;
      else if (candidate && !w.creationCandidateHit && p?.layers?.[0]?.id === 'track') {
        w.creationCandidateHit = true;
        candidate.layers[0].keys[0].shapes[0].x += 100;
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { creationCandidateHit: boolean }).creationCandidateHit,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('pending Brush blocks live creation and its completed paint remains a separate Undo step', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, 'merge');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const b = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  await page.mouse.move(b.x + 250, b.y + 250);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create live tween…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect(page.getByRole('button', { name: 'Create live tween…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await create(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('live position interval easing moves only X between sparse keys and recovers custom timing',async({page})=>{
  const f=await setup(page);await create(page);
  async function open(){
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
    const d=page.getByRole('dialog',{name:'Edit live tween',exact:true});
    await d.getByText('X position keys',{exact:true}).click();return d;
  }
  async function apply(d:ReturnType<Page['getByRole']>){
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
  }
  let d=await open();await d.getByLabel('X key action').selectOption('set');await d.getByLabel('X key frame').fill('5');
  await d.getByLabel('X coordinate').fill('72');await apply(d);
  const linear=await f.read();d=await open();
  await d.getByLabel('X interval ending at',{exact:true}).selectOption('4');
  await d.getByLabel('X interval easing',{exact:true}).selectOption('custom');
  for(const [name,value] of [['X1',1/3],['X2',2/3],['Y1',0],['Y2',0]]){
    await d.getByLabel('X interval easing '+name,{exact:true}).fill(String(value));
  }
  await apply(d);const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(linear.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0].xKeyEases).toEqual([{kind:'cubic',x1:1/3,x2:2/3,y1:0,y2:0},'linear']);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();await go(page,2);
  expect(await stagePixel(page,f.p,21,19)).toEqual([255,0,0,255]);expect(await stagePixel(page,f.p,45,19)).toEqual([255,255,255,255]);
  await go(page,4);expect(await stagePixel(page,f.p,80,19)).toEqual([255,0,0,255]);
  d=await open();await d.getByLabel('X interval ending at',{exact:true}).selectOption('4');
  await expect(d.getByLabel('X interval easing',{exact:true})).toHaveValue('custom');
  await d.getByLabel('X interval easing',{exact:true}).selectOption('linear');await apply(d);
  expect(await f.read()).toEqual(linear);await undo(page);expect(await f.read()).toEqual(saved);
});

test('live opacity and rotation interval curves render independently and recover together',async({page})=>{
  const f=await setup(page);await create(page);
  const dialog=page.getByRole('dialog',{name:'Edit live tween',exact:true});
  async function open(){
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
  }
  async function apply(){
    await dialog.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(dialog).toBeHidden();
  }
  await open();
  for(const [channel,label,value] of [['Opacity','Opacity (%)','0'],['Rotation','Rotation (degrees)','480']]){
    await dialog.getByText(channel+' keys',{exact:true}).click();
    await dialog.getByLabel(channel+' key action').selectOption('set');
    await dialog.getByLabel(channel+' key frame').fill('5');
    await dialog.getByLabel(label,{exact:true}).fill(value);
  }
  await apply();
  const linear=await f.read();
  await open();
  for(const [channel,ease] of [['Opacity','in'],['Rotation','out']]){
    await dialog.getByText(channel+' keys',{exact:true}).click();
    await dialog.getByLabel(channel+' interval ending at').selectOption('4');
    await dialog.getByLabel(channel+' interval easing',{exact:true}).selectOption(ease);
  }
  await apply();
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(linear.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans![0]).toMatchObject({opacityKeyEases:['in','linear'],rotationKeyEases:['out','linear']});
  await undo(page);expect(await f.read()).toEqual(linear);
  await page.keyboard.press('Control+Shift+z');expect(await f.read()).toEqual(saved);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  const [r,g,b,a]=await stagePixel(page,f.p,38,22);
  expect([r,a]).toEqual([255,255]);expect(g).toBeCloseTo(64,-0.5);expect(b).toBe(g);
  await go(page,4);expect(await stagePixel(page,f.p,58,22)).toEqual([255,255,255,255]);
});

test('live solid fill and stroke interval easing survive recovery and render independent colors',async({page})=>{
  const f=await setup(page,'strokeColor');
  await f.d.getByText('Interpolation options',{exact:true}).click();
  for(const field of ['paint','strokeColor']) await f.d.locator('input[data-live-option="'+field+'"]').check();
  await create(page);
  const dialog=page.getByRole('dialog',{name:'Edit live tween',exact:true});
  const edit=async()=>{
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
  };
  const apply=async()=>{
    await dialog.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(dialog).toBeHidden();
  };
  await edit();
  for(const [name,color] of [['Fill','#0000ff'],['Stroke','#00ff00']]){
    await dialog.getByText(name+' color keys',{exact:true}).click();
    await dialog.getByLabel(name+' key action').selectOption('set');
    await dialog.getByLabel(name+' key frame').fill('5');
    await dialog.getByLabel(name+' key color').fill(color);
  }
  await apply();const linear=await f.read();
  await edit();
  for(const [name,ease] of [['Fill','custom'],['Stroke','out']]){
    await dialog.getByText(name+' color keys',{exact:true}).click();
    await dialog.getByLabel(name+' interval ending at').selectOption('4');
    await dialog.getByLabel(name+' interval easing',{exact:true}).selectOption(ease);
    if(ease==='custom')for(const [control,value] of [['X1',1/3],['X2',2/3],['Y1',0],['Y2',0]]){
      await dialog.getByLabel(name+' interval easing '+control,{exact:true}).fill(String(value));
    }
  }
  await apply();const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(linear.layers[0].keys);
  await undo(page);expect(await f.read()).toEqual(linear);
  await undo(page,true);expect(await f.read()).toEqual(saved);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,2);
  expect(await stagePixel(page,f.p,38,22)).toEqual([223,0,32,255]);
  expect(await stagePixel(page,f.p,38,12)).toEqual([0,191,0,255]);
  await go(page,4);
  expect(await stagePixel(page,f.p,58,22)).toEqual([0,0,255,255]);
  expect(await stagePixel(page,f.p,58,12)).toEqual([0,255,0,255]);
});
