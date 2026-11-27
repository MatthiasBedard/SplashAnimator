import {test,expect,type Page} from '@playwright/test';
import {newProject,type Project,type Vector} from '../../packages/document/src';
import {createBasicMotionSpan} from '../../packages/animation/src/motion-spans';
import {captureRememberedSelectionAuthoringFrame} from '../../packages/animation/src/selection-motion-owner';
import {worldPoint} from '../../packages/geometry/src';
type FrameGate={armed:boolean;pending:Map<number,FrameRequestCallback>;all:Map<number,FrameRequestCallback>;requests:number;flush():void;late():void};
declare global{interface Window{selectionFrameGate:FrameGate}}
function motionFixture(mode: string) {
  const p = newProject();
  p.width = 500;
  p.height = 300;
  p.duration = 14;
  const layer = p.layers[0];
  layer.id = 'base';
  layer.drawingMode = 'object';
  const ink = (id: string, x: number, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y: 60,
    width: 20,
    height: 20,
    rotation: 0,
    pivot: { x: 3, y: 4 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  });
  const shapes = [
    ink('r', 20),
    ink('b', 70, ['outer', 'inner']),
    ink('a', 100, ['outer']),
    ink('other', 150),
    ink('d', 210, ['second']),
    ink('e', 240, ['second']),
  ];
  if (mode.startsWith('nested-')) {
    p.symbols = [{ id: 'child', name: 'Child', width: 8, height: 8, shapes: [{ ...ink('kid', 0), x: 0, y: 0, width: 8, height: 8, fill: '#0000ff' }] }];
    shapes[2] = { ...shapes[2], kind: 'symbol', symbolId: 'child', width: 8, height: 8, symbolPlayback: { mode: mode.slice(7) as 'loop' | 'once' | 'single' | 'movie', firstFrame: 0 } };
  }
  if (mode === 'affine' || mode === 'reflected')
    for (const s of shapes) {
      s.rotation = 20;
      s.transform = [mode === 'reflected' ? -1.3 : 1.3, 0.2, 0.4, 0.8];
    }
  if (mode === 'compound' || mode === 'aligned')
    for (const s of shapes) {
      s.kind = 'polygon';
      s.closed = true;
      s.fillRule = 'evenodd';
      s.contours = [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        [
          [5, 5],
          [5, 9],
          [9, 5],
        ],
      ].map((r) => r.map(([x, y]) => ({ x, y })));
    }
  const end = (distance: number) =>
    shapes.map((s) => ({
      ...structuredClone(s),
      x: s.x + distance,
      ...(mode === 'aligned'
        ? { contours: [...s.contours!].reverse().map((r) => [r[1], r[0], ...r.slice(2).reverse()]) }
        : {}),
    }));
  layer.keys = [
    { frame: 0, shapes },
    { frame: 8, shapes: end(80) },
    { frame: 12, shapes: [] },
  ];
  const rotation =
    mode === 'aligned'
      ? undefined
      : {
          direction: 'shortest' as const,
          turns: 0,
          rigidGroups: true,
          axisGroupScale: true,
          axisGroupShear: true,
        };
  const correspondence =
    mode === 'aligned' ? { order: [1, 0], start: [1, 1], reverse: [true, true] } : undefined;
  createBasicMotionSpan(
    p,
    ['base'],
    0,
    8,
    'linear',
    { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
    undefined,
    rotation,
    correspondence,
  );
  const extra = {
    ...structuredClone(layer),
    id: 'extra',
    name: 'Extra',
    keys: [
      { frame: 0, shapes: shapes.map((s) => ({ ...structuredClone(s), y: 140, fill: '#0000ff' })) },
      { frame: 10, shapes: end(100).map((s) => ({ ...s, y: 140, fill: '#0000ff' })) },
      { frame: 12, shapes: [] },
    ],
    motionSpans: undefined,
  };
  p.layers.push(extra);
  createBasicMotionSpan(
    p,
    ['extra'],
    0,
    10,
    'linear',
    { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
    undefined,
    rotation,
    correspondence,
  );
  if (mode === 'guard')
    for (const l of p.layers) l.motionSpans![0].rotation!.axisGroupShear = false;
  if (mode === 'fresh')
    for (const l of p.layers)
      for (const s of l.keys.find((k) => k.frame === (l.id === 'base' ? 8 : 10))!.shapes) s.x += 40;
  if (mode === 'children') {
    const child = newProject();
    child.duration = 12;
    const track = child.layers[0],
      blue = { ...ink('blue', 0), x: 0, y: 0, width: 8, height: 8, fill: '#0000ff' };
    track.keys = [
      { frame: 0, shapes: [blue] },
      { frame: 8, shapes: [{ ...blue, x: 8 }] },
    ];
    createBasicMotionSpan(child, [track.id], 0, 8, 'linear');
    track.keys[8].shapes[0].x = 16;
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 30,
        height: 10,
        shapes: track.keys[0].shapes,
        timeline: { duration: 12, keys: track.keys.slice(1), motionSpans: track.motionSpans },
      },
    ];
    p.layers.push({
      id: 'children',
      name: 'Children',
      visible: true,
      locked: false,
      drawingMode: 'object',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              ...blue,
              id: 'instance',
              kind: 'symbol',
              symbolId: 'child',
              x: 350,
              y: 220,
              width: 30,
              height: 10,
              symbolPlayback: { mode: 'loop', firstFrame: 0 },
            },
          ],
        },
      ],
    });
  }
  if (mode === 'default-track') for (const track of p.layers) delete track.drawingMode;
  return p;
}

function fixture(mode:string){
  const p=motionFixture(mode);
  if(mode==='foreground'){
    const cap=captureRememberedSelectionAuthoringFrame(()=>({project:p,revision:0,frame:4}));
    const shape=structuredClone(cap.scene[0].key.shapes.find(s=>s.id==='r')!);cap.dispose();
    p.layers.push({id:'block',name:'Locked foreground',visible:true,locked:true,keys:[{frame:0,shapes:[{...shape,id:'block',fill:'#00ff00'}]}]});
  }
  return p;
}
function comparable(p:Project){return {...p,layers:p.layers.map(l=>({...l,motionSpans:l.motionSpans?.map(s=>({...s,id:'span'}))}))};}
async function frames(page:Page){return page.evaluate(()=>({pending:window.selectionFrameGate.pending.size,requests:window.selectionFrameGate.requests}));}
const modes=['base','multi','member','affine','reflected','compound','aligned','css','shift','offset','children','burst','second-pose','prepared-target','prepared-policy','prepared-source','release','zero','return','escape','pointercancel','lost','blur','canvas-blur','scroll','view','target','restored-target','selection','policy','restored-policy','source','frame','close','foreground','proposed','prior','prior-view','retained','capture-policy','capture-target','capture-restored-target','release-policy','release-target','release-restored-target','release-source','wrong-pointer','touch','secondary','zero-total'];
for(const mode of modes)test('main sampled selection canvas drafts '+mode,async({page})=>{
  await page.setViewportSize({width:1800,height:1800});
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),fixture(mode));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack??e.message));
  await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();
  await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage',{exact:true});
  if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(region.getByLabel('Sampled stage artwork')).toBeEnabled();}
  if(mode==='retained'){await region.getByLabel('Sampled stage artwork').selectOption(JSON.stringify(['base','r']));await region.getByLabel('Author sampled pose by dragging',{exact:true}).check();}
  await region.getByLabel('Select multiple sampled units').check();
  const editor=region.getByRole('group',{name:'Sampled selection set'}),x=editor.getByLabel('Sampled selection X offset'),y=editor.getByLabel('Sampled selection Y offset'),tool=editor.getByLabel('Drag sampled selection offsets'),commit=editor.getByRole('button',{name:'Commit sampled selection translation',exact:true});
  const picks=mode==='multi'?[['base','r'],['extra','b']]:mode==='member'?[['base','b'],['extra','b']]:[['base','r'],['base','b']];
  for(const [l,id]of picks)await editor.getByLabel('Sampled unit '+l+'/'+id,{exact:true}).check();
  const base={x:['prior','prior-view','offset'].includes(mode)?7:mode==='proposed'?50:mode==='zero-total'?-24:0,y:['prior','prior-view','offset'].includes(mode)?9:mode==='proposed'?30:0};
  if(base.x||base.y){await x.fill(String(base.x));await y.fill(String(base.y));if(mode!=='zero-total'&&mode!=='offset')await editor.getByRole('button',{name:'Preview sampled selection translation',exact:true}).click();}
  await tool.check();
  const cap=captureRememberedSelectionAuthoringFrame(()=>({project:before,revision:0,frame:4})),track=cap.scene.find(t=>t.layerId==='base')!,shape=track.key.shapes.find(s=>s.id===(mode==='member'?'a':'r'))!,point=worldPoint(shape,{x:14,y:14});cap.dispose();
  if(mode==='css')await stage.evaluate(el=>{el.style.width='700px';el.style.height='360px';});
  await stage.scrollIntoViewIfNeeded();await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {x:r.left+(w/2+p.x-250)*r.width/w,y:r.top+(h/2+p.y-150)*r.height/h,rx:r.width/w,ry:r.height/h,ux:w/r.width,uy:h/r.height,w,h,cw:r.width,ch:r.height};},point);
  let pos=await measure();
  if(mode==='zero-total'){base.x=-24*pos.w/pos.cw;base.y=0;await x.fill(String(base.x));await y.fill(String(base.y));}
  await page.evaluate(()=>{
    const request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);let next=1000000000;
    const g:FrameGate={armed:false,pending:new Map(),all:new Map(),requests:0,flush(){const work=[...g.pending.values()];g.pending.clear();g.armed=true;try{work.forEach(cb=>cb(performance.now()));}finally{g.armed=false;}},late(){g.all.forEach(cb=>cb(performance.now()));}};
    window.selectionFrameGate=g;
    window.requestAnimationFrame=cb=>{if(!g.armed)return request(cb);const id=next++;g.pending.set(id,cb);g.all.set(id,cb);g.requests++;return id;};
    window.cancelAnimationFrame=id=>{if(g.all.has(id))g.pending.delete(id);else cancel(id);};
  });
  const pixel=(p:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return Array.from(c.getContext('2d')!.getImageData(Math.round(c.width/2+(p.x-250)*devicePixelRatio),Math.round(c.height/2+(p.y-150)*devicePixelRatio),1,1).data);},p);
  const hook=async(kind:string)=>page.evaluate(kind=>{
    const clone=structuredClone;
    window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{
      const out=clone(value,options);
      if((value as Project)?.layers&&(value as Project).id){
        window.structuredClone=clone;document.documentElement.dataset.selectionHook='yes';
        if(kind.endsWith('target')){const e=document.querySelector('input[aria-label="Sampled selection X offset"]')as HTMLInputElement;const previous=e.value;e.value='111';e.dispatchEvent(new Event('input',{bubbles:true}));if(kind.includes('restored-target')){e.value=previous;e.dispatchEvent(new Event('input',{bubbles:true}));}}
        else if(kind.endsWith('source'))(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();
        else {const e=document.querySelector('input[aria-label="Drag sampled selection offsets"]')as HTMLInputElement;e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));if(kind==='capture-policy'){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}}
      }
      return out;
    })as typeof structuredClone;
  },kind);
  if(mode.startsWith('capture-'))await hook(mode);
  const start=async()=>{await stage.scrollIntoViewIfNeeded();await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));pos=await measure();expect(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('aria-label'),pos)).toBe('Drawing stage');await page.mouse.move(pos.x,pos.y);await page.mouse.down();};
  if(mode==='proposed'){await page.mouse.move(pos.x+base.x*pos.rx,pos.y+base.y*pos.ry);await page.mouse.down();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();}
  if(mode==='touch'||mode==='secondary'){await stage.dispatchEvent('pointerdown',{pointerId:9,pointerType:mode==='touch'?'touch':'mouse',isPrimary:true,button:mode==='secondary'?2:0,clientX:pos.x,clientY:pos.y,bubbles:true});expect(await stage.evaluate(c=>c.hasPointerCapture(9))).toBe(false);expect(await read()).toEqual(before);return;}
  await stage.evaluate(c=>c.addEventListener('pointerdown',e=>{c.dataset.selectionDown=JSON.stringify({x:(e as PointerEvent).clientX,y:(e as PointerEvent).clientY});},true));
  await start();
  if(mode==='foreground'){expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);return;}
  if(mode.startsWith('capture-')){expect(await page.evaluate(()=>document.documentElement.dataset.selectionHook)).toBe('yes');expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();if(mode==='capture-target'){base.x=111;await expect(x).toHaveValue('111');}await start();}
  expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);
  const down=await stage.evaluate(c=>JSON.parse(c.dataset.selectionDown!)as{x:number;y:number});pos.x=down.x;pos.y=down.y;
  const move=async(dx:number,dy:number,id=1)=>{
    const target={x:pos.x+dx*(mode==='zero-total'?1:pos.rx),y:pos.y+(mode==='zero-total'?0:dy*pos.ry)};
    await stage.evaluate((c,p)=>{window.selectionFrameGate.armed=true;try{c.dispatchEvent(new PointerEvent('pointermove',{pointerId:p.id,pointerType:'mouse',isPrimary:true,buttons:1,clientX:p.x,clientY:p.y,shiftKey:p.shift,bubbles:true}));}finally{window.selectionFrameGate.armed=false;}},{...target,id,shift:mode==='shift'});
    return {x:(target.x-pos.x)*pos.w/pos.cw,y:(target.y-pos.y)*pos.h/pos.ch};
  };
  const release=(dx=24,dy=12)=>stage.dispatchEvent('pointerup',{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,clientX:pos.x+dx*(mode==='zero-total'?1:pos.rx),clientY:pos.y+(mode==='zero-total'?0:dy*pos.ry),shiftKey:mode==='shift',bubbles:true});
  if(mode==='wrong-pointer'){await move(60,20,2);await stage.dispatchEvent('pointercancel',{pointerId:2});expect(await frames(page)).toEqual({pending:0,requests:0});expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);}
  if(mode==='zero'){await release(0,0);await page.mouse.up();expect(await frames(page)).toEqual({pending:0,requests:0});expect(await read()).toEqual(before);return;}
  const delta=await move(24,12);if(mode==='shift')delta.y=0;
  const expected={x:base.x+delta.x,y:base.y+delta.y};
  expect(Number(await x.inputValue())).toBe(expected.x);expect(Number(await y.inputValue())).toBe(expected.y);
  await expect(commit).toBeDisabled();expect(await frames(page)).toEqual({pending:mode==='zero-total'?0:1,requests:mode==='zero-total'?0:1});expect(await read()).toEqual(before);
  if(mode==='burst'){await move(8,3);await move(24,12);expect(await frames(page)).toEqual({pending:1,requests:1});}
  if(mode==='return'||mode==='zero-total'){await release(mode==='return'?0:24,mode==='return'?0:12);await page.mouse.up();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await expect(x).toHaveValue(String(base.x));await expect(y).toHaveValue(String(base.y));expect((await frames(page)).pending).toBe(0);expect(await read()).toEqual(before);return;}
  const cancelled=['escape','pointercancel','lost','blur','canvas-blur','scroll','view','target','restored-target','selection','policy','restored-policy','source','frame','close','prior','prior-view'];
  if(cancelled.includes(mode)){
    if(mode==='escape'||mode==='prior')await page.keyboard.press('Escape');
    else if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
    else if(mode==='lost')await stage.evaluate(c=>c.releasePointerCapture(1));
    else if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else if(mode==='canvas-blur')await stage.dispatchEvent('blur');
    else if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
    else if(mode==='view'||mode==='prior-view')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('2');
    else if(mode==='target')await x.fill('77');
    else if(mode==='restored-target')await x.evaluate((e:HTMLInputElement)=>{const previous=e.value;e.value='77';e.dispatchEvent(new Event('input',{bubbles:true}));e.value=previous;e.dispatchEvent(new Event('input',{bubbles:true}));});
    else if(mode==='selection'){await editor.getByLabel('Sampled unit base/b',{exact:true}).evaluate((e:HTMLInputElement)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));});await expect(editor.getByLabel('Sampled selection readout')).toContainText('1 units · 1 tracks · 1 artwork members');}
    else if(mode==='policy'||mode==='restored-policy'){await tool.evaluate((e:HTMLInputElement,restored)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));if(restored){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}},mode==='restored-policy');if(mode==='restored-policy')await expect(tool).toBeChecked();else await expect(tool).not.toBeChecked();}
    else if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate((e:HTMLButtonElement)=>e.click());
    else if(mode==='frame'){await page.getByRole('button',{name:'Next frame',exact:true}).evaluate((e:HTMLButtonElement)=>e.click());await expect(region.getByText('Sampled motion · Frame 6',{exact:true})).toBeVisible();}
    else {await region.getByRole('button',{name:'Return to authored stage',exact:true}).evaluate((e:HTMLButtonElement)=>e.click());await expect(region).toHaveCount(0);}
    await page.mouse.up();await page.evaluate(()=>window.selectionFrameGate.late());
    expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);expect((await frames(page)).pending).toBe(0);
    if(mode==='target'){await expect(x).toHaveValue('77');await expect(y).toHaveValue(String(base.y));}
    if(mode==='restored-target'){await expect(x).toHaveValue(String(expected.x));await expect(y).toHaveValue(String(base.y));}
    if(mode==='policy'||mode==='restored-policy'){await start();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(mode==='restored-policy');await page.keyboard.press('Escape');await page.mouse.up();}
    if(mode==='prior'||mode==='prior-view'){await expect(x).toHaveValue('7');await expect(y).toHaveValue('9');await expect(editor.getByRole('status',{name:'Sampled selection preview',exact:true})).toBeVisible();}
    if(mode!=='source')expect(await read()).toEqual(before);else expect((await read()).layers.length).toBe(before.layers.length+1);
    expect(errors).toEqual([]);return;
  }
  if(mode.startsWith('prepared-')){
    await page.evaluate(kind=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const out=clone(value,options),key=out as {frame?:number;shapes?:Vector[]},r=key?.shapes?.find(s=>s.id==='r'),b=key?.shapes?.find(s=>s.id==='b'),a=key?.shapes?.find(s=>s.id==='a');
      if(key?.frame===4&&r&&b&&a&&r.x!==60&&b.x!==110&&a.x!==140){window.structuredClone=clone;document.documentElement.dataset.selectionPrepared='yes';
        if(kind==='prepared-target'){const e=document.querySelector('input[aria-label="Sampled selection X offset"]')as HTMLInputElement;e.value='111';e.dispatchEvent(new Event('input',{bubbles:true}));}
        else if(kind==='prepared-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();
        else {const e=document.querySelector('input[aria-label="Drag sampled selection offsets"]')as HTMLInputElement;e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}
      }return out;})as typeof structuredClone;},mode);
    await page.evaluate(()=>window.selectionFrameGate.flush());expect(await page.evaluate(()=>document.documentElement.dataset.selectionPrepared)).toBe('yes');await page.mouse.up();
    expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);expect((await frames(page)).pending).toBe(0);await page.evaluate(()=>window.selectionFrameGate.late());
    if(mode==='prepared-target')await expect(x).toHaveValue('111');
    if(mode!=='prepared-source')expect(await read()).toEqual(before);else expect((await read()).layers.length).toBe(before.layers.length+1);
    expect(errors).toEqual([]);return;
  }
  if(mode!=='release'){
    await page.evaluate(()=>window.selectionFrameGate.flush());
    if(mode!=='capture-target')expect(await pixel({x:point.x+expected.x,y:point.y+expected.y})).toEqual([255,0,0,255]);
    if(mode==='children'){expect(await pixel({x:364,y:224})).toEqual([0,0,255,255]);expect(await pixel({x:355,y:224})).toEqual([255,255,255,255]);}
  }
  if(mode==='second-pose'){await move(12,5);expect((await frames(page)).pending).toBe(1);await page.evaluate(()=>window.selectionFrameGate.flush());}
  if(mode.startsWith('release-'))await hook(mode);
  await release();await page.mouse.up();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);expect((await frames(page)).pending).toBe(0);
  if(mode.startsWith('release-')){
    expect(await page.evaluate(()=>document.documentElement.dataset.selectionHook)).toBe('yes');
    if(mode==='release-target')await expect(x).toHaveValue('111');
    if(mode==='release-restored-target'){expect(Number(await x.inputValue())).toBe(expected.x);await expect(editor.getByRole('status',{name:'Sampled selection preview',exact:true})).toHaveCount(0);}
    await page.evaluate(()=>window.selectionFrameGate.late());
    if(mode!=='release-source')expect(await read()).toEqual(before);else expect((await read()).layers.length).toBe(before.layers.length+1);
    expect(errors).toEqual([]);return;
  }
  expect(await read()).toEqual(before);
  await expect(editor.getByRole('status',{name:'Sampled selection preview',exact:true})).toBeVisible();await expect(commit).toBeEnabled();
  expect(Number(await x.inputValue())).toBe(expected.x);expect(Number(await y.inputValue())).toBe(expected.y);
  const owner=captureRememberedSelectionAuthoringFrame(()=>({project:before,revision:0,frame:4}));
  const candidate=owner.prepareTranslation(picks.map(([layerId,shapeId])=>({layerId,shapeId})),expected);owner.dispose();
  await page.evaluate(()=>window.selectionFrameGate.late());await commit.click();expect(comparable(await read())).toEqual(comparable(candidate));
  await page.getByLabel('Drawing stage',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(comparable(await read())).toEqual(comparable(candidate));expect(errors).toEqual([]);
});
