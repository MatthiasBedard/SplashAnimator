import { exportHTML } from '../../packages/export-web/src';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { liveGraphicFixture } from '../live-graphics-fixture';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, mode = 'loop', basis = 'plain', special = '') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const { p } = liveGraphicFixture(mode, basis);
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Graphic';
  for (const key of p.layers[0].keys)
    for (const s of key.shapes) {
      s.x += 60;
      s.y += 20;
    }
  const last = p.layers[0].keys[2].shapes[0];
  if (special === 'clock') last.symbolPlayback!.firstFrame = 2;
  if (special === 'movie')
    for (const key of p.layers[0].keys)
      for (const s of key.shapes) s.symbolPlayback = { mode: 'movie', firstFrame: 1 };
  if (special === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
  if (special === 'group')
    for (const key of p.layers[0].keys) for (const s of key.shapes) s.groups = ['outer'];
  if (special === 'identity') last.id = 'other';
  if (special === 'locked') p.layers[0].locked = true;
  if (special === 'hidden') p.layers[0].visible = false;
  if (special === 'two' || special === 'laterBad') {
    const later = structuredClone(p.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad') later.keys[2].shapes[0].width += 1;
    p.layers.push(later);
  }
  if (special === 'graphic-members' || special.startsWith('orbit-')) {
    for (const key of p.layers[0].keys) {
      const s=key.shapes[0];
      if (!s) continue;
      s.groups=['outer']; s.rotation=0;
      const other={...p.symbols![0].shapes[0],id:'member',x:s.x+10,y:s.y+20,
        groups:['outer'],fill:'#00ff00'};
      key.shapes.push(other,{...other,id:'loose',groups:undefined,x:15,y:15,fill:'#0000ff'});
      delete key.shapes[2].groups;
      if (special.startsWith('orbit-')) {
        if (special !== 'orbit-missing') s.pivot = { x: 12, y: 0 };
        if (key.frame === 10) {
          const scaled = ['orbit-uniform','orbit-axis','orbit-shear','orbit-bad-basis'].includes(special);
          const sx = scaled ? 2 : 1, sy = special === 'orbit-uniform' ? 2 : scaled ? 1.5 : 1;
          const shear = special === 'orbit-shear' || special === 'orbit-bad-basis' ? 0.5 : 0;
          Object.assign(s, { x: 92, y: 50 - 12*sx, rotation: 90 });
          Object.assign(other, { x: s.x - 20*sy + Number(special === 'orbit-drift'),
            y: s.y + 10*sx + 20*shear, rotation:90 });
          if (scaled) {
            s.transform = [sx,0,shear,sy];
            Object.assign(other, { transform:[sx,0,special === 'orbit-bad-basis' ? 0 : shear,sy] });
          }
        }
      }
    }
  }
  if (special === 'orbit-nested') {
    const root = p.symbols![0], ink = structuredClone(root.shapes[0]);
    const leaf = {id:'nested-ink',name:'Nested ink',width:4,height:4,shapes:[ink]};
    p.symbols!.push(leaf);
    const movie = {...structuredClone(root),id:'free-movie',name:'Movie'};
    p.symbols!.push(movie);
    p.layers.push({...p.layers[0],id:'movie-track',name:'Independent movie',keys:[{frame:0,shapes:[
      {...p.layers[0].keys[1].shapes[0],id:'independent',x:200,y:40,symbolId:movie.id,
        groups:[],symbolPlayback:{mode:'movie',firstFrame:0}},
    ]}]});

    for (const shapes of [root.shapes,...root.timeline!.keys.map(k=>k.shapes)]) {
      shapes[0] = {...shapes[0],kind:'symbol',symbolId:leaf.id,symbolPlayback:{mode:'single',firstFrame:0}};
    }
  }
  if (special === 'orbit-child-movie' || special === 'orbit-member-movie') {
    const root=p.symbols![0], ink=structuredClone(root.shapes[0]);
    const movie={id:'movie',name:'Movie',width:4,height:4,shapes:[ink],timeline:{duration:3,
      keys:[{frame:1,shapes:[{...ink,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,fill:'#0000ff'}]}]}};
    p.symbols!.push(movie);
    for(const shapes of [root.shapes,...root.timeline!.keys.map(key=>key.shapes)])
      shapes[0]={...shapes[0],kind:'symbol',symbolId:movie.id,symbolPlayback:{mode:'movie',firstFrame:0}};
    if (special === 'orbit-member-movie') {
      for (const key of p.layers[0].keys) {
        if (!key.shapes.length) continue;
        const member=key.shapes[1];
        Object.assign(member,{kind:'symbol',symbolId:movie.id,symbolPlayback:{mode:'movie',firstFrame:2}});
        if(key.frame===10) for (const s of key.shapes.filter(s=>s.groups?.length)) {s.x+=16; s.y+=8;}
      }
    }
    await page.addInitScript(()=>{
      const clock=Object.assign(window,{movieTime:10000});
      const raf=requestAnimationFrame.bind(window);
      window.requestAnimationFrame=fn=>raf(()=>fn(clock.movieTime));
    });
  }
  if (special === 'mixed')
    for (const key of p.layers[0].keys)
      if (key.shapes.length)
        key.shapes.push({
          id: 'plain',
          kind: 'rectangle',
          x: 200,
          y: 30,
          width: 8,
          height: 8,
          rotation: 0,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('graphic-create-seed')) {
      sessionStorage.setItem('graphic-create-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const open = async () => {
    const b = page.getByRole('button', { name: 'Create live tween…', exact: true });
    if (!(await b.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await b.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Create live tween', exact: true });
  await expect(d.getByLabel('Live tween motion mode')).toHaveValue('plain');
  await expect(d.getByRole('button', { name: 'Create live tween', exact: true })).toBeDisabled();
  await d.getByLabel('Live tween motion mode').selectOption('graphics');
  await d.getByLabel('Live tween start frame').fill('3');
  await d.getByLabel('Live tween end frame').fill('11');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const commit = async () => {
    await d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    await expect(d).toBeHidden();
  };
  const undo = async (redo = false) => {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  };
  return { p, d, read, commit, undo, open, errors };
}
async function point(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (c, { p, x, y }) => {
      const canvas = c as HTMLCanvasElement,
        r = c.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 + ((x - p.width / 2) * r.width) / (canvas.width / devicePixelRatio),
        y:
          r.top +
          r.height / 2 +
          ((y - p.height / 2) * r.height) / (canvas.height / devicePixelRatio),
      };
    },
    { p, x, y },
  );
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.floor(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
            Math.floor(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
for (const mode of ['valid','uniform','axis','shear','bad-basis']) {
test('rotate a graphic group around its authored pivot: '+mode, async ({page}) => {
  const f = await setup(page, 'loop', 'plain', 'orbit-'+mode);
  await f.d.getByLabel('Live tween motion mode').selectOption('group-graphic-orbit');
  if (mode !== 'valid') {
    await f.d.getByLabel(mode === 'uniform' ? 'Live group uniform scaling' : 'Live group independent axis scaling').check();
    if (mode === 'shear' || mode === 'bad-basis') await f.d.getByLabel('Live group shared shear').check();
    const create=f.d.getByRole('button',{name:'Create live tween',exact:true});
    await expect(create).toBeDisabled();
    await f.d.getByText('Interpolation options',{exact:true}).click();
    await f.d.getByLabel('Live tween Scale and skew',{exact:true}).check();
    if (mode === 'bad-basis') {
      await expect(create).toBeDisabled();
      expect(await f.read()).toEqual(f.p);
      return;
    }
  }
  await f.commit();
  const saved = await f.read();
  expect(saved.layers[0].liveMotionSpans![0].rotation?.savedGroupPivots).toBe(true);
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(saved.symbols).toEqual(f.p.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(f.p);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  await page.reload();
  await page.getByRole('button', {name:'Recover changes', exact:true}).click();
  await page.getByRole('combobox', {name:'Zoom', exact:true}).selectOption('1');
  for (const frame of [4, 6, 8]) {
    await page.getByLabel('Timeline frames', {exact:true}).click({position:{x:frame*18+8,y:40}});
    const t = (frame - 2) / 8, angle = Math.PI / 2 * t;
    const sx = mode === 'valid' ? 1 : 1+t;
    const sy = mode === 'uniform' ? sx : mode === 'valid' ? 1 : 1+t/2;
    const probe = (x:number, y:number) => {
      const u = (x-12)*sx + (mode === 'shear' ? t*y/2 : 0), v = y*sy;
      return pixel(page, f.p, 92 + u*Math.cos(angle) - v*Math.sin(angle),
        50 + u*Math.sin(angle) + v*Math.cos(angle));
    };
    await expect.poll(()=>probe(((frame-1)%5)*10+2, 2)).toEqual([255,0,0,255]);
    await expect.poll(()=>probe(12,22)).toEqual([0,255,0,255]);
  }
  if (mode === 'shear') {
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:/^Edit live tween/}).click();
    const d = page.getByRole('dialog',{name:'Edit live tween',exact:true});
    await d.getByLabel('Include graphic live tweens').check();
    await d.getByLabel('Include complete group live tweens').check();
    await d.getByLabel(/^Edit live tween Graphic frames/).check();
    await d.getByLabel('Live trajectory mode').selectOption('replace');
    await d.getByLabel('Live cubic startY',{exact:true}).fill('24');
    await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
    await expect(d).toBeHidden();
    const routed = await f.read();
    await page.getByLabel('Timeline frames',{exact:true}).click({position:{x:6*18+8,y:40}});
    await page.getByRole('button',{name:'Control',exact:true}).click();
    await page.getByRole('button',{name:/^Edit live group curve controls/}).click();
    await page.getByLabel('Drag live group curve controls').check();
    const start = await point(page,f.p,80,74), end = await point(page,f.p,112,74);
    await page.mouse.move(start.x,start.y);
    await page.mouse.down(); await page.mouse.move(end.x,end.y,{steps:6}); await page.mouse.up();
    await expect(page.getByLabel('Live group curve status')).toContainText('Unapplied');
    expect(await f.read()).toEqual(routed);
    await page.getByRole('button',{name:'Use group curve draft target',exact:true}).click();
    const dx = Number(await page.getByLabel('Live group curve document X').inputValue()) - 80;
    expect(dx).toBeCloseTo(32,0);
    await page.getByRole('button',{name:'Commit live group curve control',exact:true}).click();
    const edited = structuredClone(routed);
    edited.layers[0].liveMotionSpans![0].path!.startX = dx;
    await expect.poll(f.read).toEqual(edited);
    await f.undo(); await expect.poll(f.read).toEqual(routed);
    await f.undo(true); await expect.poll(f.read).toEqual(edited);
    await page.reload();
    await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    await page.getByLabel('Timeline frames',{exact:true}).click({position:{x:6*18+8,y:40}});
    // At halfway the cubic adds 3/8 of the two handle offsets to the rotating pose.
    const probe = (x:number,y:number) => {
      const u=(x-12)*1.5+y/4, v=y*1.25;
      return pixel(page,f.p,92+(u-v)*Math.SQRT1_2+3*dx/8,50+(u+v)*Math.SQRT1_2+9);
    };
    await expect.poll(()=>probe(2,2)).toEqual([255,0,0,255]);
    await expect.poll(()=>probe(12,22)).toEqual([0,255,0,255]);
  }
  expect(f.errors).toEqual([]);
});
}
for (const fault of ['missing','drift']) {
  test('reject a graphic group orbit with '+fault+' pivot geometry', async ({page})=>{
    const f=await setup(page,'loop','plain','orbit-'+fault);
    await f.d.getByLabel('Live tween motion mode').selectOption('group-graphic-orbit');
    await expect(f.d.getByRole('button',{name:'Create live tween',exact:true})).toBeDisabled();
    expect(await f.read()).toEqual(f.p);
  });
}

test('create and edit a graphic group route while its child keeps playing',async({page})=>{
  const f=await setup(page,'loop','plain','graphic-members');
  await expect(f.d.getByRole('button',{name:'Create live tween',exact:true})).toBeDisabled();
  await f.d.getByLabel('Live tween motion mode').selectOption('group-graphics');
  await f.commit();
  const created=await f.read();
  expect(created.layers[0].keys).toEqual(f.p.layers[0].keys);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Edit live tween…',exact:true}).click();
  const d=page.getByRole('dialog',{name:'Edit live tween',exact:true});
  await d.getByLabel('Include graphic live tweens').check();
  const row=d.getByLabel('Edit live tween Graphic frames 3–11',{exact:true});
  await expect(row).toBeDisabled();
  await d.getByLabel('Include complete group live tweens').check(); await row.check();
  await d.getByLabel('Independent route group',{exact:true}).selectOption(JSON.stringify([0,'outer']));
  await d.getByLabel('Independent route action',{exact:true}).selectOption('set');
  for(const [field,value] of Object.entries({startX:80,startY:90,endX:160,endY:130}))
    await d.getByLabel('Independent route '+field,{exact:true}).fill(String(value));
  await d.getByRole('button',{name:'Apply live tween changes',exact:true}).click();
  await expect(d).toBeHidden();
  const saved=await f.read();
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(saved.symbols).toEqual(f.p.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(created);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  for(const frame of [4,6]){
    await page.getByLabel('Timeline frames',{exact:true}).click({position:{x:frame*18+8,y:40}});
    const t=(frame-2)/8,v=1-t,x=80+80*(3*v*t*t+t**3),y=50+3*v*v*t*40+3*v*t*t*80+t**3*40;
    await expect.poll(()=>pixel(page,f.p,x+((1+frame-2)%5)*10+2,y+2)).toEqual([255,0,0,255]);
    await expect.poll(()=>pixel(page,f.p,x+12,y+22)).toEqual([0,255,0,255]);
    await expect.poll(()=>pixel(page,f.p,17,17)).toEqual([0,0,255,255]);
  }
  expect(f.errors).toEqual([]);
});

for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`explicit graphic creation ${mode}/${basis} preserves clocks, stage pixels and one history step`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await f.commit();
      const out = await f.read(),
        span = out.layers[0].liveMotionSpans![0];
      expect(out).toEqual({
        ...f.p,
        layers: [
          {
            ...f.p.layers[0],
            liveMotionSpans: [
              { id: span.id, start: 2, end: 10, ease: 'linear', symbolContinuity: 'graphics' },
            ],
          },
        ],
      });
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const clock = mode === 'single' ? 1 : mode === 'once' ? 4 : mode === 'default' ? 4 : 0,
        b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
        u = b[0] * (clock * 10 + 2) + b[2] * 2,
        v = b[1] * (clock * 10 + 2) + b[3] * 2;
      await expect
        .poll(() => pixel(page, f.p, 120 + (u - v) / Math.SQRT2, 70 + (u + v) / Math.SQRT2))
        .toEqual([255, 0, 0, 255]);
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      await f.undo(true);
      expect(await f.read()).toEqual(out);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await f.read()).toEqual(out);
      expect(f.errors).toEqual([]);
    });
for (const special of ['clock', 'movie', 'button', 'group', 'identity', 'locked', 'hidden'])
  test(`graphic creation rejects forged ${special} selection without changing source`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special),
      row = f.d.getByLabel('Create live track Graphic');
    await expect(
      f.d.getByRole('button', { name: 'Create live tween', exact: true }),
    ).toBeDisabled();
    if (!(await row.isChecked())) await expect(row).toBeDisabled();
    await row.evaluate((el) => {
      const e = el as HTMLInputElement;
      e.disabled = false;
      if (!e.checked) e.click();
    });
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).evaluate((el) => {
      const e = el as HTMLButtonElement;
      e.disabled = false;
      e.click();
    });
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const special of ['two', 'laterBad'])
  test(`graphic ${special} tracks prepare atomically with stable IDs and complete selection`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special);
    await f.d.getByLabel('Create live track Later').check();
    await page.evaluate(() => {
      const state = { ids: [] as string[] },
        clone = structuredClone;
      Object.assign(window, { graphicIDs: state });
      window.structuredClone = <T>(v: T) => {
        const out = clone(v);
        if (Array.isArray(v) && v[0]?.span?.symbolContinuity === 'graphics')
          state.ids.push(v[0].span.id);
        return out;
      };
    });
    if (special === 'laterBad') {
      await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
      await expect(f.d.getByRole('status')).toContainText('Error:');
      expect(await f.read()).toEqual(f.p);
      await f.d.getByLabel('Create live track Later').uncheck();
    }
    await f.commit();
    const out = await f.read();
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(out.symbols).toEqual(f.p.symbols);
    if (special === 'two')
      expect(out.layers[0].liveMotionSpans![0].id).not.toBe(out.layers[1].liveMotionSpans![0].id);
    else {
      expect(out.layers[1]).toEqual(f.p.layers[1]);
      const ids = await page.evaluate(
        () => (window as unknown as { graphicIDs: { ids: string[] } }).graphicIDs.ids,
      );
      expect(ids).toEqual([
        out.layers[0].liveMotionSpans![0].id,
        out.layers[0].liveMotionSpans![0].id,
      ]);
    }
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    await f.undo(true);
    expect(await f.read()).toEqual(out);
  });
for (const hook of ['clone', 'serialize'])
  for (const action of ['mode', 'target', 'source', 'close'])
    test(`graphic ${hook} rejects actual late ${action} after complete marked candidates exist`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { graphicCreateHook: state });
          const fire = (value: unknown) => {
            if (
              state.hit ||
              (value as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity !== 'graphics'
            )
              return;
            state.hit = true;
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
            else if (action === 'mode') {
              const e = document.querySelector(
                '[aria-label="Live tween motion mode"]',
              ) as HTMLSelectElement;
              for (const v of ['plain', 'graphics']) {
                e.value = v;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } else {
              const e = document.querySelector(
                '[aria-label="Live tween end frame"]',
              ) as HTMLInputElement;
              for (const v of ['10', '11']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(v: T) => {
              const out = clone(v);
              fire(v);
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
          () =>
            (window as unknown as { graphicCreateHook: { hit: boolean } }).graphicCreateHook.hit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Independent source edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Live tween motion mode').selectOption('graphics');
      await f.commit();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('graphic creation retains complete mixed artwork selection and exports the actual sparse frame', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'mixed');
  await f.d.getByLabel('Live tween motion mode').selectOption('groups');
  await f.d.getByLabel('Live group uniform scaling').check();
  await f.d.getByLabel('Live tween motion mode').selectOption('graphics');
  await f.commit();
  const out = await f.read();
  await expect(page.getByText('2 objects', { exact: true })).toBeVisible();
  expect(out.layers[0].liveMotionSpans![0].rotation).toBeUndefined();
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(out.symbols).toEqual(f.p.symbols);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status')).toContainText('read-only');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  if (!process.env.SPLASH_TEST_LICENSE) {
    await expect(page.getByRole('button', { name: /Export current frame PNG/ })).toBeDisabled();
    expect(await f.read()).toEqual(out);
    return;
  }
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  const pixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const x = c.getContext('2d')!;
    x.drawImage(image, 0, 0);
    return [
      [120, 70 + Math.SQRT2 * 2],
      [204, 34],
    ].map(([a, b]) => Array.from(x.getImageData(Math.floor(a), Math.floor(b), 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(await f.read()).toEqual(out);
});

for (const action of ['mode', 'source', 'candidate', 'reentry'])
  test(`graphic final recovery ${action} cannot bypass complete history staging`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { graphicFinal: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          v = args[0] as { project?: Project; folder?: unknown };
        if (
          !state.hit &&
          Object.hasOwn(v ?? {}, 'folder') &&
          v?.project?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'graphics'
        ) {
          state.hit = true;
          if (action === 'candidate') v.project.layers[0].keys[2].shapes[0].x++;
          else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final independent edit';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (action === 'mode') {
            const e = document.querySelector(
              '[aria-label="Live tween motion mode"]',
            ) as HTMLSelectElement;
            for (const value of ['plain', 'graphics']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else
            Array.from(document.querySelectorAll('button'))
              .find((e) => e.textContent?.trim() === 'Create live tween')!
              .click();
        }
        return out;
      }) as typeof stringify;
    }, action);
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { graphicFinal: { hit: boolean } }).graphicFinal.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      const out = await f.read();
      expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else {
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Final independent edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.d.getByLabel('Live tween motion mode').selectOption('graphics');
      await f.commit();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('insert a sparse F6 key in a pivoted group with a nested graphic',async({page})=>{
  const f = await setup(page,'loop','plain','orbit-nested');
  await f.d.getByLabel('Live tween motion mode').selectOption('group-graphic-orbit');
  await f.commit();
  const before = await f.read(), timeline = page.getByLabel('Timeline frames',{exact:true});
  const seek = (at:number)=>timeline.click({position:{x:at*18+8,y:68}});
  const check = async(at:number)=>{
    const angle = (at-2)*Math.PI/16, x=((at-1)%5)*10+2-12;
    await seek(at);
    await expect.poll(()=>pixel(page,f.p,92+x*Math.cos(angle)-2*Math.sin(angle),
      50+x*Math.sin(angle)+2*Math.cos(angle))).toEqual([255,0,0,255]);
  };
  for(const at of [4,6,8]) await check(at);
  await seek(6); await page.keyboard.press('F6');
  await expect.poll(async()=>(await f.read()).layers[0].keys.map(k=>k.frame)).toEqual([0,2,6,10,12]);
  const saved=await f.read();
  expect(saved.symbols).toEqual(before.symbols);
  expect(saved.layers[0].keys.filter(k=>k.frame!==6)).toEqual(before.layers[0].keys);
  expect(saved.layers[0].liveMotionSpans?.map(s=>[s.start,s.end,s.symbolContinuity])).toEqual([[2,6,'graphics'],[6,10,'graphics']]);
  await f.undo(); await expect.poll(f.read).toEqual(before);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  for(const at of [4,6,8]) await check(at);
  const output=await page.context().newPage();
  try {
    await output.evaluate(()=>{
      const clock=Object.assign(window,{previewTime:0});
      const raf=requestAnimationFrame.bind(window);
      window.requestAnimationFrame=fn=>raf(()=>fn(clock.previewTime));
    });
    await output.setContent(exportHTML(saved));
    const canvas=output.locator('canvas').first();
    for(let at=0;at<=10;at++) {
      await output.evaluate(at=>{ Object.assign(window,{previewTime:at*1000}); },at);
      const points=[[202+(at%5)*10,42]];
      if(at>=2){
        const angle=(at-2)*Math.PI/16, x=((at-1)%5)*10+2-12;
        points.push([92+x*Math.cos(angle)-2*Math.sin(angle),50+x*Math.sin(angle)+2*Math.cos(angle)]);
      }
      await expect.poll(()=>canvas.evaluate((el:HTMLCanvasElement,points)=>points.map(([x,y])=>
        Array.from(el.getContext('2d')!.getImageData(Math.floor(x),Math.floor(y),1,1).data)),points),
        {message:'HTML playback at frame '+at}).toEqual(points.map(()=>[255,0,0,255]));
    }
  } finally { await output.close(); }

});

for (const direct of [false,true]) test('nested movie keeps its age through a pivoted graphic loop and F6: '+(direct?'direct member':'descendant'),async({page})=>{
  const f=await setup(page,'loop','plain',direct?'orbit-member-movie':'orbit-child-movie');
  await f.d.getByLabel('Live tween motion mode').selectOption('group-graphic-orbit');
  const create=f.d.getByRole('button',{name:'Create live tween',exact:true});
  await expect(create).toBeDisabled();
  await f.d.getByLabel('Play nested movie clips independently').check();
  if (direct) {
    await expect(create).toBeDisabled();
    await f.d.getByLabel('Include movie clips placed directly in the group').check();
  }
  await f.commit();
  const before=await f.read();
  expect(before.layers[0].liveMotionSpans![0].nestedGraphicMovies).toBe(direct?'members-and-descendants':true);
  const timeline=page.getByLabel('Timeline frames',{exact:true}), stage=page.getByLabel('Drawing stage',{exact:true});
  const seek=(at:number)=>timeline.click({position:{x:at*18+8,y:40}});
  await seek(6); await page.keyboard.press('F6');
  await expect.poll(async()=>(await f.read()).layers[0].keys.map(k=>k.frame)).toEqual([0,2,6,10,12]);
  const saved=await f.read();
  expect(saved.layers[0].liveMotionSpans!.every(s=>s.nestedGraphicMovies)).toBe(true);
  if (direct) expect(saved.layers[0].keys.find(k=>k.frame===6)!.shapes[1].symbolPlayback)
    .toEqual({mode:'movie',firstFrame:2});
  expect(saved.symbols).toEqual(before.symbols);
  await f.undo(); await expect.poll(f.read).toEqual(before);
  await f.undo(true); await expect.poll(f.read).toEqual(saved);
  for(const mode of ['stage','preview','html']){
    if(mode==='preview'){
      await page.reload();
      await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    }
    await timeline.click({position:{x:8,y:12}});
    const output=mode==='html'?await page.context().newPage():page;
    const origin=mode==='stage'?10000:mode==='preview'?30000:0;
    if(mode==='html'){
      await output.evaluate(()=>{
        const clock=Object.assign(window,{movieTime:0}),raf=requestAnimationFrame.bind(window);
        window.requestAnimationFrame=fn=>raf(()=>fn(clock.movieTime));
      });
      await output.setContent(exportHTML(saved));
    } else {
      await page.evaluate(ms=>{Object.assign(window,{movieTime:ms});},origin);
      await stage.press(mode==='stage'?'Enter':'Control+Enter');
    }
    const canvas=mode==='stage'?stage:mode==='preview'?page.getByLabel('Live movie interaction'):output.locator('canvas').first();
    await expect(canvas).toBeVisible();
    if(mode==='preview') {
      await page.getByRole('button',{name:'Pause preview clocks'}).click();
      await page.getByRole('button',{name:'Restart live movie'}).click();
      await expect(page.getByLabel('Live movie position')).toContainText('Frame 1 · Tick 0');
    }
    let previous=0;

    for(const at of [0,2,3,5,6,7,9,10]){
      await output.evaluate(ms=>{Object.assign(window,{movieTime:ms});},origin+at*1000);
      if(mode==='preview') {
        for(;previous<at;previous++) {
          await page.getByRole('button',{name:'Step live preview'}).click();
          await expect(page.getByLabel('Live movie status')).toContainText('ready');
        }
      }
      const angle=(at-2)*Math.PI/16, u=((at-1)%5)*10+2-12;
      const px=92+(direct?(at-2)*2:0), py=50+(direct?at-2:0);
      const x=px+u*Math.cos(angle)-2*Math.sin(angle), y=py+u*Math.sin(angle)+2*Math.cos(angle);
      const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255]];
      await expect.poll(()=>mode==='stage'?pixel(page,f.p,x,y):
        canvas.evaluate((el:HTMLCanvasElement,p)=>Array.from(el.getContext('2d')!.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data),{x,y}),
        {message:mode+' frame '+at}).toEqual(at===0?[255,255,255,255]:colors[(at-2)%3]);
      if (direct && at>=2) {
        const x=px-22*Math.sin(angle), y=py+22*Math.cos(angle);
        await expect.poll(()=>mode==='stage'?pixel(page,f.p,x,y):
          canvas.evaluate((el:HTMLCanvasElement,p)=>Array.from(el.getContext('2d')!.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data),{x,y}),
          {message:mode+' direct movie frame '+at}).toEqual(colors[at%3]);
      }
    }
    if(mode==='stage')await stage.press('Enter');
    else if(mode==='preview')await page.keyboard.press('Escape');
    else await output.close();
  }
});
