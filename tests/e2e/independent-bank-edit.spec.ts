import { test, expect, type Page } from '@playwright/test';
import { createMotionPathSampler } from '../../packages/animation/src/motion-path';
import { liveRotationFixture } from '../live-motion-rotation-fixture';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, basis = 'plain', saved = false, rotating = false, shared: boolean | 'distance' | 'corner' = true, distance = false, waypoint = false) {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  p.width = 400;
  l.name = 'Route';
  if (!rotating)
    l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
      ...structuredClone(s),
      x: s.x + 80,
      y: s.y + 16,
    }));
  for (const key of l.keys.slice(0, 2))
    for (const s of key.shapes) {
      s.opacity = 1;
      s.fill = s.id === 'loose' ? '#0000ff' : s.groups?.[0] === 'second' ? '#00ff00' : '#ff0000';
    }
  if (shared) l.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  if (shared === 'corner') l.liveMotionSpans![0].path!.waypoints=[{x:27,y:44}];
  if (shared === 'distance') l.liveMotionSpans![0].path = {startX:0,startY:90,endX:-60,endY:-15,distance:true};
  if (saved)
    l.liveMotionSpans![0].groupPaths = [
      {
        groupId: 'outer',
        composition: 'additive',
        path: { startX: 25, startY: -40, endX: -25, endY: -40 },
      },
      {
        groupId: 'second',
        composition: 'additive',
        path: { startX: 1, startY: 2, endX: 3, endY: 4 },
      },
    ];
  if (waypoint) l.liveMotionSpans![0].groupPaths![0].path.waypoints=[{x:32,y:32}];
  if (distance) {
    for (const bank of l.liveMotionSpans![0].groupPaths!) bank.path = {startX:16,startY:8,endX:-16,endY:-8,distance:true};
    for (const key of l.keys.slice(0,2))
      for (const id of ['outer','second']) {
        const [a,b] = key.shapes.filter(shape => shape.groups?.[0] === id);
        b.x=a.x; b.y=a.y;
      }
  }
  await page.addInitScript(
    (p) =>
      !localStorage.getItem('splash-recovery-v1') && localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live tween…', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByLabel('Include complete group live tweens').check();
  await d.getByLabel('Edit live tween Route frames 1–9', { exact: true }).check();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const choose = async (group = 'outer', action = 'set') => {
    await d
      .getByLabel('Independent route group', { exact: true })
      .selectOption(JSON.stringify([0, group]));
    await d.getByLabel('Independent route action', { exact: true }).selectOption(action);
  };
  const values = async (group = 'outer') => {
    const x = group === 'outer' ? 0 : 160,
      y = group === 'outer' ? 20 : 120;
    for (const [field, v] of Object.entries({
      startX: x + 25,
      startY: y - 40,
      endX: x + 55,
      endY: y - 24,
    }))
      await d.getByLabel('Independent route ' + field, { exact: true }).fill(String(v));
  };
  const apply = async () => {
    await d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(d).toBeHidden();
  };
  const undo = async (redo = false) => {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  };
  return { p, d, read, choose, values, apply, undo };
}
for (const basis of ['plain', 'affine', 'reflected'])
  test(`sets an independent ${basis} bank through real controls with exact history and pixels`, async ({
    page,
  }) => {
    const f = await setup(page, basis);
    await f.choose();
    await f.values();
    await f.apply();
    const q = structuredClone(f.p);
    q.layers[0].liveMotionSpans![0].groupPaths = [
      {
        groupId: 'outer',
        composition: 'additive',
        path: { startX: 25, startY: -40, endX: -25, endY: -40 },
      },
    ];
    await expect.poll(f.read).toEqual(q);
    const timeline = page.getByLabel('Timeline frames', { exact: true });
    await timeline.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    const probe = (x: number, y: number) =>
      page.getByLabel('Drawing stage', { exact: true }).evaluate(
        (n, { x, y }) => {
          const c = n as HTMLCanvasElement;
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.round(c.width / 2 + (x - 200) * devicePixelRatio),
                Math.round(c.height / 2 + (y - 120) * devicePixelRatio),
                1,
                1,
              ).data,
          );
        },
        { x, y },
      );
    const u = basis === 'plain' ? 3 : basis === 'reflected' ? -4.5 : 7.5,
      v = basis === 'plain' ? 3 : 9.75;
    await expect.poll(() => probe(40 + u, 28 + v)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => probe(200 + u, 158 + v)).toEqual([0, 255, 0, 255]);
    await timeline.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await f.undo();
    await expect.poll(f.read).toEqual(f.p);
    await f.undo(true);
    await expect.poll(f.read).toEqual(q);
  });
test('targets a second original group and retains the other route and all keys', async ({
  page,
}) => {
  const f = await setup(page, 'plain', true);
  await f.choose('second');
  await f.values('second');
  await f.apply();
  const q = structuredClone(f.p);
  q.layers[0].liveMotionSpans![0].groupPaths![1].path = {
    startX: 25,
    startY: -40,
    endX: -25,
    endY: -40,
  };
  await expect.poll(f.read).toEqual(q);
  await f.undo();
  await expect.poll(f.read).toEqual(f.p);
});
test('removes one original route while retaining other banks and Undo/Redo', async ({ page }) => {
  const f = await setup(page, 'plain', true);
  await f.choose('outer', 'remove');
  await f.apply();
  const q = structuredClone(f.p);
  q.layers[0].liveMotionSpans![0].groupPaths = q.layers[0].liveMotionSpans![0].groupPaths!.slice(1);
  await expect.poll(f.read).toEqual(q);
  await f.undo();
  await expect.poll(f.read).toEqual(f.p);
  await f.undo(true);
  await expect.poll(f.read).toEqual(q);
});
test('Keep and Cancel never opt in or write history', async ({ page }) => {
  const f = await setup(page);
  await expect(
    f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }),
  ).toBeDisabled();
  await f.choose();
  await f.values();
  await page.keyboard.press('Escape');
  await expect(f.d).toBeHidden();
  expect(await f.read()).toEqual(f.p);
});
test('empty numeric input rejects and a fresh valid retry succeeds', async ({ page }) => {
  const f = await setup(page);
  await f.choose();
  await f.values();
  await f.d.getByLabel('Independent route startX', { exact: true }).fill('');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Independent route startX', { exact: true }).fill('25');
  await f.apply();
  expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths).toHaveLength(1);
});
for (const mode of ['target', 'pick', 'candidate'])
  test(`rejects actual late ${mode} changes after an edited bank candidate exists`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.choose();
    await f.values();
    await page.evaluate((mode) => {
      const clone = structuredClone;
      Reflect.set(window, 'bankLate', false);
      window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
        const out = options ? clone(value, options) : clone(value),
          q = value as unknown as Project;
        if (
          !Reflect.get(window, 'bankLate') &&
          q?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0].path.startX === 25
        ) {
          Reflect.set(window, 'bankLate', true);
          if (mode === 'candidate') (out as unknown as Project).symbols![0].name += ' forged';
          else {
            const field = document.querySelector(
              mode === 'pick'
                ? 'select[aria-label="Independent route group"]'
                : 'input[aria-label="Independent route endY"]',
            ) as HTMLInputElement | HTMLSelectElement;
            field.value = mode === 'pick' ? JSON.stringify([0, 'second']) : '90';
            field.dispatchEvent(new Event(mode === 'pick' ? 'change' : 'input', { bubbles: true }));
          }
        }
        return out;
      };
    }, mode);
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(f.d).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, 'bankLate'))).toBe(true);
    expect(await f.read()).toEqual(f.p);
    await f.choose();
    await f.values();
    await f.apply();
    expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths).toHaveLength(1);
  });
test('rotating groups reject independent translation activation without losing source', async ({
  page,
}) => {
  const f = await setup(page, 'plain', false, true);
  await f.choose();
  await f.values();
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d).toBeVisible();
  expect(await f.read()).toEqual(f.p);
});

test('unchanged existing cubic rejects without adding history', async ({ page }) => {
  const f = await setup(page, 'plain', true);
  await f.choose();
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Independent route startX', { exact: true }).fill('26');
  await f.apply();
  expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(26);
});
test('removing the final saved bank restores an absent field exactly', async ({ page }) => {
  const f = await setup(page, 'plain', true);
  await f.choose('outer', 'remove');
  await f.apply();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Edit live tween\u2026', exact: true }).click();
  await f.d.getByLabel('Include complete group live tweens').check();
  await f.d.getByLabel('Edit live tween Route frames 1\u20139', { exact: true }).check();
  await f.choose('second', 'remove');
  await f.apply();
  const q = structuredClone(f.p);
  delete q.layers[0].liveMotionSpans![0].groupPaths;
  await expect.poll(f.read).toEqual(q);
  await f.undo();
  expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths!.map((b) => b.groupId)).toEqual([
    'second',
  ]);
});

test('changed-and-restored numeric input during final recovery admission cannot publish', async ({
  page,
}) => {
  const f = await setup(page);
  await f.choose();
  await f.values();
  await page.evaluate(() => {
    const json = JSON.stringify;
    let ready = false;
    Reflect.set(window, 'bankRecoveryHook', false);
    JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
      const row = value as { project?: Project };
      if (row?.project?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0].path.startX === 25)
        ready = true;
      if (
        ready &&
        !Reflect.get(window, 'bankRecoveryHook') &&
        Array.isArray(value) &&
        value.includes('set') && value.some(part => part?.startX === 25 && 'endY' in part)
      ) {
        Reflect.set(window, 'bankRecoveryHook', true);
        const field = document.querySelector(
          'input[aria-label="Independent route endY"]',
        ) as HTMLInputElement;
        const prior = field.value;
        field.value = '90';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.value = prior;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return Reflect.apply(json, JSON, [value, ...rest]);
    }) as typeof JSON.stringify;
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'bankRecoveryHook'))).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await f.apply();
  expect((await f.read()).layers[0].liveMotionSpans![0].groupPaths).toHaveLength(1);
});

for(const route of ['distance','corner'] as const) test(`ease a selected group on a shared ${route} while its neighbor follows the span clock`,async({page})=>{
  const f=await setup(page,'plain',true,false,route);
  await f.choose();
  await f.d.getByLabel('Group route easing',{exact:true}).selectOption('in');
  await f.apply();
  const expected=structuredClone(f.p), span=expected.layers[0].liveMotionSpans![0];
  span.groupPaths![0].ease='in';
  await expect.poll(f.read).toEqual(expected);
  await f.undo(); await expect.poll(f.read).toEqual(f.p);
  await f.undo(true); await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const shared=createMotionPathSampler({x:0,y:0},{x:80,y:16},span.path!);
  const timeline=page.getByLabel('Timeline frames',{exact:true});
  await timeline.focus();
  for(let frame=1;frame<=6;frame++) {
    await page.keyboard.press('ArrowRight');
    if(frame%2) continue;
    const t=frame/8, point=route==='distance' ? shared(t) : t<=0.5
      ? {x:54*t,y:88*t} : {x:27+(t-0.5)*106,y:44-(t-0.5)*56};
    const probes=[[0,20],[160,120],[280,40]].map(([x,y],index)=>{
      const bank=span.groupPaths![index];
      if (!bank) return [x+point.x+5,y+point.y+4];
      const u=index===0?t*t:t, v=1-u, path=bank.path;
      const cubic=(from:number,to:number,end:number)=>3*v*v*u*from+3*v*u*u*(end+to)+u*u*u*end;
      return [x+point.x-80*t+cubic(path.startX,path.endX,80)+5,
        y+point.y-16*t+cubic(path.startY,path.endY,16)+4];
    });
    await expect.poll(()=>page.getByLabel('Drawing stage',{exact:true}).evaluate((el,points)=>{
      const canvas=el as HTMLCanvasElement, ctx=canvas.getContext('2d')!;
      return points.map(([x,y])=>Array.from(ctx.getImageData(Math.floor(canvas.width/2+(x-200)*devicePixelRatio),
        Math.floor(canvas.height/2+(y-120)*devicePixelRatio),1,1).data));
    },probes)).toEqual([[255,0,0,255],[0,255,0,255],[0,0,255,255]]);
  }
  if(route==='corner'){
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:/^Insert live group tween key/}).click();
    await page.getByLabel('Live group split frame',{exact:true}).fill('5');
    await page.getByRole('button',{name:'Insert preserved live group key',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const split=await f.read();
    expect(split.layers[0].liveMotionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
    await f.undo(); await expect.poll(f.read).toEqual(expected);
    await f.undo(true); await expect.poll(f.read).toEqual(split);
  }
});

for (const shared of [false,true]) test(`group timing with shared path ${shared} recovers poses and Undo/Redo`, async ({page}) => {
  const f = await setup(page,'plain',true,false,shared);
  await f.choose();
  await f.d.getByLabel('Group route easing', {exact:true}).selectOption('custom');
  await f.apply();
  const expected=structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].groupPaths![0].ease={kind:'cubic',x1:0.25,y1:0.1,x2:0.25,y2:1};
  await expect.poll(f.read).toEqual(expected);
  await f.undo();
  await expect.poll(f.read).toEqual(f.p);
  await f.undo(true);
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await page.getByLabel('Timeline frames',{exact:true}).focus();
  for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
  // At the midpoint the default custom curve reaches about 80.24% of the route.
  const probe=()=>page.getByLabel('Drawing stage',{exact:true}).evaluate((el,shared)=>{
    const c=el as HTMLCanvasElement;
    return [[68,17+(shared?30:0)],[204,132+(shared?30:0)]].map(([x,y])=>Array.from(c.getContext('2d')!.getImageData(
      Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2+(y-120)*devicePixelRatio),1,1).data));
  },shared);
  await expect.poll(probe).toEqual([[255,0,0,255],[0,255,0,255]]);

});

for (const distance of [false,true]) test(`insert a preserved key with independent group timing, distance ${distance}`, async ({page}) => {
  const f=await setup(page,'plain',true,false,!distance,distance);
  await f.choose();
  await f.d.getByLabel('Group route easing',{exact:true}).selectOption('in');
  await f.apply();
  const original=await f.read();
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/^Insert live group tween key/,exact:true}).click();
  await page.getByLabel('Live group split frame',{exact:true}).fill('5');
  if (distance) await page.getByLabel('Keep original group distance timing',{exact:true}).check();
  await page.getByRole('button',{name:'Insert preserved live group key',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const split=await f.read(), spans=split.layers[0].liveMotionSpans!;
  expect(spans.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
  if (distance) {
    expect(spans[0].groupPaths![0].restrictedArc?.descriptor.to).toBe(0.25);
    expect(spans[0].groupPaths![1].restrictedArc?.descriptor.to).toBe(0.5);
  } else expect(spans.every(s=>s.groupPaths?.find(row=>row.groupId==='outer')?.spanClockOffset)).toBe(true);
  expect(spans.every(s=>s.groupPaths?.find(row=>row.groupId==='second')?.ease===undefined)).toBe(true);
  await f.undo();
  await expect.poll(f.read).toEqual(original);
  await f.undo(true);
  await expect.poll(f.read).toEqual(split);
  if (distance) {
    await page.reload();
    await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    await expect.poll(f.read).toEqual(split);
    await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    const timeline = page.getByLabel('Timeline frames',{exact:true});
    await timeline.focus();
    for (let i=0; i<4; i++) await page.keyboard.press('ArrowRight');
    const red = () => page.getByLabel('Drawing stage',{exact:true}).evaluate(el => {
      const canvas = el as HTMLCanvasElement;
      return Array.from(canvas.getContext('2d')!.getImageData(
        Math.round(canvas.width/2+(24-200)*devicePixelRatio),
        Math.round(canvas.height/2+(30-120)*devicePixelRatio),1,1).data);
    });
    await expect.poll(red).toEqual([255,0,0,255]);
  }
});

test('edit waypoint timing without replacing the selected path, insert a key and recover', async ({page}) => {
  const f=await setup(page,'plain',true,false,false,false,true);
  await f.choose('outer','timing');
  await f.d.getByLabel('Group route easing',{exact:true}).selectOption('in');
  await f.apply();
  const original=await f.read();
  const expected=structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].groupPaths![0].ease='in';
  expect(original).toEqual(expected);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/^Insert live group tween key/}).click();
  await page.getByLabel('Live group split frame',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Insert preserved live group key',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const split=await f.read();
  const mid=split.layers[0].keys.find(key=>key.frame===4)!.shapes[0];
  expect([mid.x,mid.y]).toEqual([16,36]);
  await f.undo();
  await expect.poll(f.read).toEqual(original);
  await f.undo(true);
  await expect.poll(f.read).toEqual(split);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await expect.poll(f.read).toEqual(split);
});
