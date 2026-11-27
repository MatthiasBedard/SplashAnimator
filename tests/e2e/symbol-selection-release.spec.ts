import {test,expect,type Page} from '@playwright/test';
import {newProject,symbolLayers,type Project,type Vector,type SymbolDefinition} from '../../packages/document/src';
import {createBasicMotionSpan} from '../../packages/animation/src/motion-spans';
import {objectBounds,worldPoint} from '../../packages/geometry/src';
import {captureSymbolRememberedSelectionAuthoringFrame} from '../../packages/animation/src/symbol-selection-motion-owner';
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
 const original=motionFixture(mode),base=original.layers[0];
 const definition:SymbolDefinition={id:'selection',name:'Selection',width:original.width,height:original.height,shapes:base.keys[0].shapes,timeline:{duration:original.duration,keys:base.keys.slice(1),motionSpans:base.motionSpans,layers:original.layers.slice(1)}};
 if(mode==='foreground'||mode==='locked')definition.timeline!.layers!.push({id:'barrier',name:'Barrier',visible:true,locked:mode==='locked',keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle',x:60,y:60,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]}]}]});
 if(mode==='mapped'){definition.buttonStates={up:0,over:2,down:8,hit:12};definition.multiFramePivot={x:-20,y:35};}
 const p=newProject();p.width=500;p.height=300;p.duration=14;p.symbols=[...(original.symbols??[]),definition];p.assets=original.assets;
 p.layers[0].keys=[{frame:0,shapes:[{id:'instance',kind:'symbol',symbolId:'selection',x:0,y:0,width:500,height:300,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]}]}];return p;
}
function comparable(s:SymbolDefinition){return {...s,timeline:{...s.timeline, motionSpans:s.timeline?.motionSpans?.map(m=>({...m,id:'span'})),layers:s.timeline?.layers?.map(l=>({...l,motionSpans:l.motionSpans?.map(m=>({...m,id:'span'}))}))}};}
async function pixels(page:Page,label:string){return page.getByLabel(label,{exact:true}).evaluate((c:HTMLCanvasElement)=>{const d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let red=0,cx=0,blue=0,cyan=0;for(let i=0;i<d.length;i+=4){if(d[i]>240&&d[i+1]<10&&d[i+2]<10){red++;cx+=(i/4)%c.width;}if(d[i]<10&&d[i+1]<10&&d[i+2]>240)blue++;if(d[i+1]>d[i]+40&&d[i+2]>d[i]+50)cyan++;}return {red,x:cx/red,blue,cyan};});}

type Gate={armed:boolean;pending:Map<number,FrameRequestCallback>;all:Map<number,FrameRequestCallback>;requests:number;flush():void;late():void};
declare global {interface Window{symbolSelectionGate:Gate}}
const modes=['base','mapped','nested-loop','nested-movie', 'retained-root', 'retained-group', 'foreground', 'locked', 'multi', 'member', 'affine', 'reflected', 'compound', 'aligned', 'children', 'css', 'shift', 'offset', 'burst', 'second', 'release', 'prior', 'cancel', 'zero', 'return', 'proposed', 'foreign', 'escape', 'lost', 'blur', 'view', 'target', 'selection', 'restored-policy', 'frame', 'close', 'source', 'capture-author', 'prepared-author', 'prepared-target', 'prepared-source', 'release-author', 'release-restored-author', 'release-target', 'release-source', 'publication-author', 'publication-target', 'publication-source', 'publication-view', 'retry-author', 'optout'];
for(const mode of modes)test('isolated selection direct release '+mode,async({page})=>{
 await page.setViewportSize({width:1800,height:1400});
 await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),fixture(mode));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack??e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),source=before.symbols!.find(s=>s.id==='selection')!;
 await page.getByRole('group',{name:'Symbol Selection',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();
 const sourceOnly=async()=>{await expect(page.getByLabel('Symbol duration',{exact:true})).toHaveValue('15');await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();const expected=structuredClone(before);expected.symbols!.find(s=>s.id==='selection')!.timeline!.duration=15;expect(await read()).toEqual(expected);};
 const frame=page.getByLabel('Symbol frame',{exact:true});await frame.fill('5');await frame.press('Tab');await page.getByLabel('Show sampled symbol stage',{exact:true}).check();
 if(mode==='retained-root'||mode==='retained-group'){
  if(mode==='retained-group')await page.getByLabel('Select complete sampled symbol groups',{exact:true}).check();
  await page.getByLabel('Sampled symbol artwork',{exact:true}).selectOption(JSON.stringify(['@base',mode==='retained-group'?'b':'r']));
  await page.getByLabel('Drag sampled symbol offsets',{exact:true}).check();await page.getByLabel(mode==='retained-group'?'Author sampled group drag on release':'Author sampled symbol drag on release',{exact:true}).check();
 }
 await page.getByLabel('Select multiple sampled symbol units',{exact:true}).check();
 const editor=page.getByRole('group',{name:'Sampled symbol selection set'}),stage=page.getByLabel('Sampled symbol stage',{exact:true}),tool=editor.getByLabel('Drag sampled symbol selection offsets'),x=editor.getByLabel('Sampled symbol selection X offset'),y=editor.getByLabel('Sampled symbol selection Y offset'),commit=editor.getByRole('button',{name:'Commit sampled symbol selection translation',exact:true});
 const picks=mode==='multi'?[['@base','r'],['extra','b']]:mode==='member'?[['@base','b'],['extra','b']]:[['@base','r'],['@base','b']];
 for(const [layer,id]of picks)await editor.getByLabel('Sampled symbol unit '+layer+'/'+id,{exact:true}).check();
 const base={x:mode==='prior'||mode.startsWith('prepared-prior-')||mode==='offset'?7:mode==='proposed'?60:0,y:mode==='prior'||mode.startsWith('prepared-prior-')||mode==='offset'?9:mode==='proposed'?30:0};
 if(base.x||base.y){await x.fill(String(base.x));await y.fill(String(base.y));if(mode!=='offset')await editor.getByRole('button',{name:'Preview sampled symbol selection translation',exact:true}).click();}
 await tool.check();const author=editor.getByLabel('Author sampled symbol selection drag on release');await expect(author).not.toBeChecked();await author.check();
 const cap=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4}));
 const shape=cap.scene[0].key.shapes.find(s=>s.id===(mode==='member'?'a':'r'))!,point=worldPoint(shape,{x:14,y:14});cap.dispose();
 if(mode==='css')await stage.evaluate(c=>{c.style.width='700px';c.style.height='240px';});
 const measure=()=>stage.evaluate((c:HTMLCanvasElement,p)=>{const r=c.getBoundingClientRect(),scale=290/300;return{x:r.left+(20+p.x*scale)*r.width/540,y:r.top+(20+p.y*scale)*r.height/330,rx:scale*r.width/540,ry:scale*r.height/330};},point);
 const pixel=(p:{x:number;y:number})=>stage.evaluate((c:HTMLCanvasElement,p)=>Array.from(c.getContext('2d')!.getImageData(Math.floor(20+p.x*290/300),Math.floor(20+p.y*290/300),1,1).data),p);
 await page.evaluate(()=>{const request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);let next=1000000000;
  const g:Gate={armed:false,pending:new Map(),all:new Map(),requests:0,flush(){const work=[...g.pending.values()];g.pending.clear();g.armed=true;try{work.forEach(cb=>cb(performance.now()));}finally{g.armed=false;}},late(){g.all.forEach(cb=>cb(performance.now()));}};
  window.symbolSelectionGate=g;window.requestAnimationFrame=cb=>{if(!g.armed)return request(cb);const id=next++;g.pending.set(id,cb);g.all.set(id,cb);g.requests++;return id;};window.cancelAnimationFrame=id=>{if(g.all.has(id))g.pending.delete(id);else cancel(id);};
 });
 const gate=()=>page.evaluate(()=>({pending:window.symbolSelectionGate.pending.size,requests:window.symbolSelectionGate.requests}));
 let pos=await measure();
 const start=async()=>{await stage.scrollIntoViewIfNeeded();await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));pos=await measure();expect(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('aria-label'),pos)).toBe('Sampled symbol stage');await stage.evaluate(c=>c.addEventListener('pointerdown',e=>c.dataset.down=JSON.stringify({x:(e as PointerEvent).clientX,y:(e as PointerEvent).clientY}),{capture:true,once:true}));await page.mouse.move(pos.x,pos.y);await page.mouse.down();const down=await stage.evaluate(c=>JSON.parse(c.dataset.down!));pos.x=down.x;pos.y=down.y;};
 const hook=async(kind:string)=>page.evaluate(kind=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const out=clone(value,options),s=out as SymbolDefinition;
  if(s?.id==='selection'&&s.timeline&&(kind.startsWith('capture-')||s.timeline.motionSpans?.length===2)){
   window.structuredClone=clone;document.documentElement.dataset.symbolSelectionHook='yes';
   const input=(label:string,value:string,event='input')=>{const e=document.querySelector(`[aria-label="${label}"]`)as HTMLInputElement;e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}));};
   if(kind.endsWith('target'))input('Sampled symbol selection X offset','111');
   else if(kind.endsWith('source'))input('Symbol duration','15','change');
   else {const e=document.querySelector(`[aria-label="${kind.endsWith('author')?'Author sampled symbol selection drag on release':'Drag sampled symbol selection offsets'}"]`)as HTMLInputElement;e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));if(!kind.endsWith('author')||kind.startsWith('capture-')||kind==='release-restored-author'){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}}
  }return out;})as typeof structuredClone;},kind);
 if(mode.startsWith('capture-'))await hook(mode);
 if(mode==='proposed'){await stage.scrollIntoViewIfNeeded();pos=await measure();await page.mouse.move(pos.x+base.x*pos.rx,pos.y+base.y*pos.ry);await page.mouse.down();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();}
 await start();
 if(mode.startsWith('capture-')){expect(await page.evaluate(()=>document.documentElement.dataset.symbolSelectionHook)).toBe('yes');expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();if(mode==='capture-target'){base.x=111;await expect(x).toHaveValue('111');}await start();}
 if(mode==='foreground'||mode==='locked'){expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);
 const move=async(dx:number,dy:number,id=1)=>{const target={x:pos.x+dx*pos.rx,y:pos.y+dy*pos.ry};await stage.evaluate((c,p)=>{window.symbolSelectionGate.armed=true;try{c.dispatchEvent(new PointerEvent('pointermove',{pointerId:p.id,pointerType:'mouse',isPrimary:true,buttons:1,clientX:p.x,clientY:p.y,shiftKey:p.shift,bubbles:true}));}finally{window.symbolSelectionGate.armed=false;}},{...target,id,shift:mode==='shift'});return{x:(target.x-pos.x)/pos.rx,y:(target.y-pos.y)/pos.ry};};
 const release=(dx=24,dy=12)=>stage.dispatchEvent('pointerup',{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,clientX:pos.x+dx*pos.rx,clientY:pos.y+dy*pos.ry,shiftKey:mode==='shift',bubbles:true});
 if(mode==='foreign'){await move(60,20,2);await stage.dispatchEvent('pointercancel',{pointerId:2});expect(await gate()).toEqual({pending:0,requests:0});expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);}
 if(mode==='zero'){await release(0,0);await page.mouse.up();expect(await gate()).toEqual({pending:0,requests:0});expect(await read()).toEqual(before);return;}
 const delta=await move(24,12);if(mode==='shift')delta.y=0;
 const expected={x:base.x+delta.x,y:base.y+delta.y};expect(Number(await x.inputValue())).toBe(expected.x);expect(Number(await y.inputValue())).toBe(expected.y);await expect(commit).toBeDisabled();expect(await gate()).toEqual({pending:1,requests:1});expect(await read()).toEqual(before);
 if(mode==='burst'){await move(8,3);await move(24,12);expect(await gate()).toEqual({pending:1,requests:1});}
 const cancelled=['prior','escape','lost','blur','scroll','view','target','restored-target','selection','policy','restored-policy','frame','close','source','return'];
 if(cancelled.includes(mode)){
  if(mode==='escape'||mode==='prior')await page.keyboard.press('Escape');
  else if(mode==='return')await release(0,0);
  else if(mode==='lost')await stage.evaluate(c=>c.releasePointerCapture(1));
  else if(mode==='blur'||mode==='scroll')await page.evaluate(type=>window.dispatchEvent(new Event(type)),mode);
  else if(mode==='view')await stage.evaluate(c=>c.style.width='600px');
  else if(mode==='target'||mode==='restored-target')await x.evaluate((e:HTMLInputElement,restored)=>{const previous=e.value;e.value='77';e.dispatchEvent(new Event('input',{bubbles:true}));if(restored){e.value=previous;e.dispatchEvent(new Event('input',{bubbles:true}));}},mode==='restored-target');
  else if(mode==='selection')await editor.getByLabel('Sampled symbol unit @base/b',{exact:true}).evaluate((e:HTMLInputElement)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));});
  else if(mode==='policy'||mode==='restored-policy')await tool.evaluate((e:HTMLInputElement,restored)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));if(restored){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}},mode==='restored-policy');
  else if(mode==='frame'||mode==='source')await page.getByLabel(mode==='frame'?'Symbol frame':'Symbol duration',{exact:true}).evaluate((e:HTMLInputElement,mode)=>{e.value=mode==='frame'?'6':'15';e.dispatchEvent(new Event('change',{bubbles:true}));},mode);
  else await page.getByLabel('Show sampled symbol stage',{exact:true}).evaluate((e:HTMLInputElement)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.mouse.up();await page.evaluate(()=>window.symbolSelectionGate.late());expect((await gate()).pending).toBe(0);
  if(!['frame','close','source'].includes(mode))expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);
  if(mode==='frame')await expect(frame).toHaveValue('6');if(mode==='close')await expect(stage).toHaveCount(0);
  if(mode==='target'||mode==='restored-target'){await expect(x).toHaveValue(String(mode==='target'?77:expected.x));await expect(y).toHaveValue(String(base.y));}
  if(mode==='selection')await expect(editor.getByLabel('Sampled symbol selection readout')).toContainText('1 units');
  if(mode==='prior'){await expect(x).toHaveValue('7');await expect(y).toHaveValue('9');await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();}
  if(mode==='restored-policy'){await start();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);await page.keyboard.press('Escape');await page.mouse.up();}
  expect(await read()).toEqual(before);if(mode!=='source')await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeDisabled();else await sourceOnly();expect(errors).toEqual([]);return;
 }
 if(mode.startsWith('prepared-')){await hook(mode);await page.evaluate(()=>window.symbolSelectionGate.flush());expect(await page.evaluate(()=>document.documentElement.dataset.symbolSelectionHook)).toBe('yes');await page.mouse.up();await page.evaluate(()=>window.symbolSelectionGate.late());expect((await gate()).pending).toBe(0);expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(false);if(mode.endsWith('target'))await expect(x).toHaveValue('111');
 if(mode==='prepared-prior-target')await expect(y).toHaveValue('9');
 if(mode==='prepared-prior-policy'){await expect(x).toHaveValue('7');await expect(y).toHaveValue('9');await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();}
 expect(await read()).toEqual(before);
 if(mode==='prepared-source')await sourceOnly();
 if(mode.startsWith('prepared-prior-')){await start();expect(await stage.evaluate(c=>c.hasPointerCapture(1))).toBe(true);await release(3,2);await page.mouse.up();await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();await expect(commit).toBeEnabled();}
 expect(errors).toEqual([]);return;}
 if(mode!=='release'){await page.evaluate(()=>window.symbolSelectionGate.flush());if(!mode.startsWith('capture-'))expect(await pixel({x:point.x+expected.x,y:point.y+expected.y})).toEqual([255,0,0,255]);if(mode==='children'){expect(await pixel({x:364,y:224})).toEqual([0,0,255,255]);expect(await pixel({x:355,y:224})).toEqual([255,255,255,255]);}}
 if(mode==='second'){await move(12,5);expect((await gate()).pending).toBe(1);await page.evaluate(()=>window.symbolSelectionGate.flush());}
 if(mode.startsWith('publication-'))await page.evaluate(kind=>{
 const stringify=JSON.stringify;let sources=0,complete=false;JSON.stringify=((value:unknown,...args:unknown[])=>{const out=stringify(value,...args as [never,never]),s=value as SymbolDefinition;
 if(Array.isArray(value)&&value.length===11&&(value[0]as SymbolDefinition)?.id==='selection'&&value[3]===4&&value[10]===true)sources++;
 const key=s?.timeline?.keys?.find(k=>k.frame===4),r=key?.shapes.find(s=>s.id==='r'),b=key?.shapes.find(s=>s.id==='b'),a=key?.shapes.find(s=>s.id==='a');
 if(sources===1&&s?.id==='selection'&&s.timeline?.motionSpans?.length===2&&r&&b&&a&&r.x!==60&&b.x!==110&&a.x!==140){complete=true;document.documentElement.dataset.symbolSelectionPublicationCandidate='yes';}
 if(sources===2&&complete){JSON.stringify=stringify;document.documentElement.dataset.symbolSelectionPublication='yes';
 const c=document.querySelector('canvas[aria-label="Sampled symbol stage"]')!;if(c.hasPointerCapture(1))throw Error('Local publication retained native capture');
 const input=(label:string,value:string,event='input')=>{const e=document.querySelector(`[aria-label="${label}"]`)as HTMLInputElement;e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}));};
 if(kind==='publication-author'){const e=document.querySelector('[aria-label="Author sampled symbol selection drag on release"]')as HTMLInputElement;e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}
 else if(kind==='publication-target')input('Sampled symbol selection X offset','111');
 else if(kind==='publication-source')input('Symbol duration','15','change');
 else (c as HTMLElement).style.width='700px';
 }return out;})as typeof JSON.stringify;
 },mode);
 if(mode==='optout'){await author.evaluate((e:HTMLInputElement)=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();await start();const retry=await move(24,12);expected.x=base.x+retry.x;expected.y=base.y+retry.y;}
 if(mode.startsWith('release-')||mode==='retry-author')await hook(mode==='retry-author'?'release-author':mode);
 const native=await stage.elementHandle();await release();await page.mouse.up();expect(await native!.evaluate(c=>c.hasPointerCapture(1))).toBe(false);expect((await gate()).pending).toBe(0);await page.evaluate(()=>window.symbolSelectionGate.late());
 if(mode==='retry-author'){
 expect(await page.evaluate(()=>document.documentElement.dataset.symbolSelectionHook)).toBe('yes');expect(await read()).toEqual(before);await expect(author).not.toBeChecked();
 await start();await move(6,3);await release(6,3);await page.mouse.up();expect(await read()).toEqual(before);await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();
 await author.check();const at={x:Number(await x.inputValue()),y:Number(await y.inputValue())};await start();const delta=await move(3,2);await release(3,2);await page.mouse.up();
 const cap=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4})),candidate=cap.prepareTranslation(picks.map(([layerId,shapeId])=>({layerId,shapeId})),{x:at.x+delta.x,y:at.y+delta.y});cap.dispose();
 const undo=page.getByRole('button',{name:'Undo symbol timeline change',exact:true});await undo.click();await expect(undo).toBeDisabled();await page.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();expect(comparable((await read()).symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(candidate));expect(errors).toEqual([]);return;
 }
 if(mode.startsWith('publication-'))expect(await page.evaluate(()=>document.documentElement.dataset.symbolSelectionPublicationCandidate)).toBe('yes');
 if(mode.startsWith('release-')||mode.startsWith('publication-')){expect(await page.evaluate(publication=>publication?document.documentElement.dataset.symbolSelectionPublication:document.documentElement.dataset.symbolSelectionHook,mode.startsWith('publication-'))).toBe('yes');expect(await read()).toEqual(before);if(mode==='release-target')await expect(x).toHaveValue('111');if(mode==='release-restored-author')await expect(author).toBeChecked();if(!mode.endsWith('-source'))await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeDisabled();else await sourceOnly();expect(errors).toEqual([]);return;}
 if(mode==='optout'){expect(await read()).toEqual(before);await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeDisabled();await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();}
 const owner=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4}));const candidate=owner.prepareTranslation(picks.map(([layerId,shapeId])=>({layerId,shapeId})),expected),count=owner.resolveSelection(picks.map(([layerId,shapeId])=>({layerId,shapeId}))).tracks.reduce((n,t)=>n+t.shapeIds.length,0);owner.dispose();
 if(mode==='optout')await commit.click();await expect(page.getByLabel('Show sampled symbol stage',{exact:true})).not.toBeChecked();await expect(page.getByText(count+' objects selected. Cyan outlines show',{exact:false})).toBeVisible();expect((await pixels(page,'Symbol timeline preview')).cyan).toBeGreaterThan(30);
 const selectedIds=picks.map(([layerId,shapeId])=>({layerId,shapeId})),selectionOwner=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4}));
 const boxes=selectionOwner.resolveSelection(selectedIds).tracks.flatMap(t=>symbolLayers(candidate).find(l=>l.id===t.layerId)!.keys.find(k=>k.frame===4)!.shapes.filter(s=>t.shapeIds.includes(s.id)).map(s=>({id:t.layerId+'/'+s.id,...objectBounds(s)})));selectionOwner.dispose();
 const cues=await page.getByLabel('Symbol timeline preview',{exact:true}).evaluate((c:HTMLCanvasElement,boxes)=>{const d=c.getContext('2d')!.getImageData(0,0,540,330).data,scale=290/300;return boxes.map(b=>{let count=0;for(let y=Math.max(0,Math.floor(20+b.top*scale)-2);y<=Math.min(329,Math.ceil(20+b.bottom*scale)+2);y++)for(let x=Math.max(0,Math.floor(20+b.left*scale)-2);x<=Math.min(539,Math.ceil(20+b.right*scale)+2);x++){const i=(y*540+x)*4;if(d[i+1]>d[i]+40&&d[i+2]>d[i]+50)count++;}return{id:b.id,count};});},boxes);for(const cue of cues)expect(cue.count,cue.id).toBeGreaterThan(0);

 const undo=page.getByRole('button',{name:'Undo symbol timeline change',exact:true});await undo.click();await expect(undo).toBeDisabled();await page.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();await expect(page.getByText(count+' objects selected. Cyan outlines show',{exact:false})).toBeVisible();expect(await read()).toEqual(before);
 if(mode==='cancel'){await page.getByRole('button',{name:'Cancel symbol timeline',exact:true}).click();expect(await read()).toEqual(before);return;}
 await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();const after=await read();expect(comparable(after.symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(candidate));expect({...after,symbols:before.symbols}).toEqual(before);
 await page.getByLabel('Drawing stage',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(comparable((await read()).symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(candidate));expect(errors).toEqual([]);
});
