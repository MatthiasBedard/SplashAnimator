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
 const p=newProject();p.width=500;p.height=300;p.duration=14;p.symbols=[...(original.symbols??[]),definition];p.assets=original.assets;
 p.layers[0].keys=[{frame:0,shapes:[{id:'instance',kind:'symbol',symbolId:'selection',x:0,y:0,width:500,height:300,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]}]}];return p;
}
function comparable(s:SymbolDefinition){return {...s,timeline:{...s.timeline, motionSpans:s.timeline?.motionSpans?.map(m=>({...m,id:'span'})),layers:s.timeline?.layers?.map(l=>({...l,motionSpans:l.motionSpans?.map(m=>({...m,id:'span'}))}))}};}
async function pixels(page:Page,label:string){return page.getByLabel(label,{exact:true}).evaluate((c:HTMLCanvasElement)=>{const d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let red=0,cx=0,blue=0,cyan=0;for(let i=0;i<d.length;i+=4){if(d[i]>240&&d[i+1]<10&&d[i+2]<10){red++;cx+=(i/4)%c.width;}if(d[i]<10&&d[i+1]<10&&d[i+2]>240)blue++;if(d[i+1]>d[i]+40&&d[i+2]>d[i]+50)cyan++;}return {red,x:cx/red,blue,cyan};});}
for(const mode of ['base','multi','root-root','group-group','affine','reflected','compound','aligned','offview','children','nested-loop','nested-once','nested-single','nested-movie','direct','discard','cancel','retained','retained-group','separate','zero','overflow'])test('isolated sampled selection numeric '+mode,async({page})=>{
 await page.setViewportSize({width:1800,height:1400});await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),fixture(mode));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),source=before.symbols!.find(s=>s.id==='selection')!;
 await page.getByRole('group',{name:'Symbol Selection',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();
 const frame=page.getByLabel('Symbol frame',{exact:true});await frame.fill('5');await frame.press('Tab');await page.getByLabel('Show sampled symbol stage',{exact:true}).check();
 const toggle=page.getByLabel('Select multiple sampled symbol units',{exact:true});await expect(toggle).toBeEnabled();
 if(mode==='retained-group'){
  await page.getByLabel('Select complete sampled symbol groups',{exact:true}).check();await page.getByLabel('Sampled symbol artwork',{exact:true}).selectOption(JSON.stringify(['@base','b']));await page.getByLabel('Drag sampled symbol offsets',{exact:true}).check();await page.getByLabel('Author sampled group drag on release',{exact:true}).check();
 }
 if(mode==='retained'||mode==='separate'){
  await page.getByLabel('Sampled symbol artwork',{exact:true}).selectOption(JSON.stringify(['@base','r']));
  if(mode==='retained'){await page.getByLabel('Drag sampled symbol offsets',{exact:true}).check();await page.getByLabel('Author sampled symbol drag on release',{exact:true}).check();}
  else {await page.getByLabel('Sampled symbol X offset',{exact:true}).fill('7');await page.getByRole('button',{name:'Preview sampled symbol move',exact:true}).click();}
 }
 await toggle.check();const editor=page.getByRole('group',{name:'Sampled symbol selection set'}),stage=page.getByLabel('Sampled symbol stage',{exact:true});
 const picks=mode==='multi'?[['@base','r'],['@base','d'],['extra','b']]:mode==='root-root'?[['@base','r'],['extra','r']]:mode==='group-group'?[['@base','b'],['extra','b']]:[['@base','r'],['@base','b']];
 for(const [layer,id]of picks)await editor.getByLabel('Sampled symbol unit '+layer+'/'+id,{exact:true}).check();
 const x=editor.getByLabel('Sampled symbol selection X offset'),y=editor.getByLabel('Sampled symbol selection Y offset'),commit=editor.getByRole('button',{name:'Commit sampled symbol selection translation',exact:true}),preview=editor.getByRole('button',{name:'Preview sampled symbol selection translation',exact:true});
 await expect(commit).toBeDisabled();const initial=await pixels(page,'Sampled symbol stage');expect(initial.red).toBeGreaterThan(500);
 if(mode==='zero'){await x.fill('0');await y.fill('0');await expect(commit).toBeDisabled();await page.getByRole('button',{name:'Cancel symbol timeline',exact:true}).click();expect(await read()).toEqual(before);return;}
 const offset={x:mode==='offview'?650:mode==='overflow'?1e308:17,y:9};await x.fill(String(offset.x));await y.fill(String(offset.y));
 if(mode==='retained'||mode==='retained-group'){await stage.scrollIntoViewIfNeeded();const b=await stage.boundingBox();await page.mouse.move(b!.x+(mode==='retained-group'?135:80),b!.y+85);await page.mouse.down();expect(await stage.evaluate((c:HTMLCanvasElement)=>c.hasPointerCapture(1))).toBe(false);await page.mouse.move(b!.x+165,b!.y+115);await page.mouse.up();await expect(x).toHaveValue('17');}
 if(mode==='overflow'){await preview.click();await expect(editor.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);return;}
 const cap=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4})),expected=cap.prepareTranslation(picks.map(([layerId,shapeId])=>({layerId,shapeId})),offset),owner=cap.resolveSelection(picks.map(([layerId,shapeId])=>({layerId,shapeId})));cap.dispose();
 if(mode!=='direct'){await preview.click();await expect(editor.getByRole('status',{name:'Sampled symbol selection preview'})).toBeVisible();const proposed=await pixels(page,'Sampled symbol stage');if(mode!=='offview'){
 const t=owner.tracks[0],shape=symbolLayers(expected).find(l=>l.id===t.layerId)!.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id===t.shapeIds[0])!,point=worldPoint(shape,{x:15,y:15});
 const pixel=await stage.evaluate((c:HTMLCanvasElement,p)=>Array.from(c.getContext('2d')!.getImageData(Math.floor(20+p.x*290/300),Math.floor(20+p.y*290/300),1,1).data),point);expect(pixel).toEqual([255,0,0,255]);
 }if(mode==='children'){
  expect(proposed.blue).toBeGreaterThan(20);
  const childPixels=await stage.evaluate((c:HTMLCanvasElement)=>[364,355].map(x=>Array.from(c.getContext('2d')!.getImageData(Math.floor(20+x*290/300),Math.floor(20+224*290/300),1,1).data)));
  expect(childPixels).toEqual([[0,0,255,255],[255,255,255,255]]);
 }expect(await read()).toEqual(before);}
 if(mode==='discard'){await editor.getByRole('button',{name:'Discard sampled symbol selection preview',exact:true}).click();expect((await pixels(page,'Sampled symbol stage')).x).toBeCloseTo(initial.x,2);}
 if(mode==='separate'){
  await toggle.uncheck();await expect(page.getByLabel('Sampled symbol X offset',{exact:true})).toHaveValue('7');await expect(page.getByRole('button',{name:'Discard sampled symbol pose preview',exact:true})).toBeEnabled();
  await toggle.check();for(const [layer,id]of picks)await editor.getByLabel('Sampled symbol unit '+layer+'/'+id,{exact:true}).check();await x.fill('17');await y.fill('9');
 }
 await commit.click();await expect(page.getByLabel('Show sampled symbol stage',{exact:true})).not.toBeChecked();
 const count=owner.tracks.reduce((n,t)=>n+t.shapeIds.length,0);await expect(page.getByText(count+' objects selected. Cyan outlines show',{exact:false})).toBeVisible();
 const authored=await pixels(page,'Symbol timeline preview');if(mode!=='offview'){
  expect(authored.cyan).toBeGreaterThan(30);
  const boxes=owner.tracks.flatMap(t=>symbolLayers(expected).find(l=>l.id===t.layerId)!.keys.find(k=>k.frame===4)!.shapes.filter(s=>t.shapeIds.includes(s.id)).map(s=>({id:t.layerId+'/'+s.id,...objectBounds(s)})));
  const cues=await page.getByLabel('Symbol timeline preview',{exact:true}).evaluate((c:HTMLCanvasElement,boxes)=>{const d=c.getContext('2d')!.getImageData(0,0,540,330).data,scale=290/300;return boxes.map(b=>{let count=0;for(let y=Math.max(0,Math.floor(20+b.top*scale)-2);y<=Math.min(329,Math.ceil(20+b.bottom*scale)+2);y++)for(let x=Math.max(0,Math.floor(20+b.left*scale)-2);x<=Math.min(539,Math.ceil(20+b.right*scale)+2);x++){const i=(y*540+x)*4;if(d[i+1]>d[i]+40&&d[i+2]>d[i]+50)count++;}return {id:b.id,count};});},boxes);
  for(const cue of cues)expect(cue.count,cue.id).toBeGreaterThan(0);
 }expect(await read()).toEqual(before);
 const undo=page.getByRole('button',{name:'Undo symbol timeline change',exact:true}),redo=page.getByRole('button',{name:'Redo symbol timeline change',exact:true});await undo.click();await expect(undo).toBeDisabled();await redo.click();await expect(page.getByText(count+' objects selected. Cyan outlines show',{exact:false})).toBeVisible();
 if(mode==='cancel'){await page.getByRole('button',{name:'Cancel symbol timeline',exact:true}).click();expect(await read()).toEqual(before);return;}
 await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();const result=await read();expect(comparable(result.symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(expected));expect({...result,symbols:before.symbols}).toEqual(before);
 await page.getByLabel('Drawing stage',{exact:true}).focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(comparable((await read()).symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(expected));expect(errors).toEqual([]);
});



for(const mode of ['target','restored-target','selection','policy','restored-policy','source','frame','close','retry-restored-target','retry-restored-policy'])test('isolated sampled selection late admission '+mode,async({page})=>{
 await page.setViewportSize({width:1800,height:1400});await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),fixture('base'));const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();
 await page.getByRole('group',{name:'Symbol Selection',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();const frame=page.getByLabel('Symbol frame',{exact:true});await frame.fill('5');await frame.press('Tab');await page.getByLabel('Show sampled symbol stage',{exact:true}).check();await page.getByLabel('Select multiple sampled symbol units',{exact:true}).check();
 const editor=page.getByRole('group',{name:'Sampled symbol selection set'});for(const id of ['r','b'])await editor.getByLabel('Sampled symbol unit @base/'+id,{exact:true}).check();await editor.getByLabel('Sampled symbol selection X offset').fill('17');await editor.getByLabel('Sampled symbol selection Y offset').fill('9');
 await page.evaluate(mode=>{
  const original=JSON.stringify; (window as unknown as {selectionHook:boolean}).selectionHook=false;
  JSON.stringify=((value:unknown,...args:unknown[])=>{const out=original(value,...args as [never,never]);const candidate=value as SymbolDefinition;
   if(candidate?.id==='selection'&&candidate.timeline?.motionSpans?.length===2){JSON.stringify=original;(window as unknown as {selectionHook:boolean}).selectionHook=true;
    const input=(label:string,value:string,event='input')=>{const e=document.querySelector(`[aria-label="${label}"]`)as HTMLInputElement;e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}));};
    const check=(label:string,checked:boolean)=>{const e=document.querySelector(`[aria-label="${label}"]`)as HTMLInputElement;e.checked=checked;e.dispatchEvent(new Event('change',{bubbles:true}));};
    if(mode==='target'||mode==='restored-target'){input('Sampled symbol selection X offset','31');if(mode==='restored-target')input('Sampled symbol selection X offset','17');}
    else if(mode==='selection')check('Sampled symbol unit @base/b',false);
    else if(mode==='policy'||mode==='restored-policy'){check('Select multiple sampled symbol units',false);if(mode==='restored-policy')check('Select multiple sampled symbol units',true);}
    else if(mode==='source')input('Symbol duration','15','change');
    else if(mode==='frame')input('Symbol frame','6','change');
    else check('Show sampled symbol stage',false);
   }return out;})as typeof JSON.stringify;
 },mode.replace('retry-',''));
 await editor.getByRole('button',{name:'Commit sampled symbol selection translation',exact:true}).click();expect(await page.evaluate(()=>(window as unknown as {selectionHook:boolean}).selectionHook)).toBe(true);expect(await read()).toEqual(before);
 if(mode.startsWith('retry-')){
  const retry=page.getByRole('group',{name:'Sampled symbol selection set'});for(const id of ['r','b'])await retry.getByLabel('Sampled symbol unit @base/'+id,{exact:true}).check();await retry.getByLabel('Sampled symbol selection X offset').fill('17');await retry.getByLabel('Sampled symbol selection Y offset').fill('9');
  await retry.getByRole('button',{name:'Commit sampled symbol selection translation',exact:true}).click();await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeEnabled();
  const source=before.symbols!.find(s=>s.id==='selection')!,cap=captureSymbolRememberedSelectionAuthoringFrame(()=>({definition:source,symbols:before.symbols!,assets:before.assets,revision:0,frame:4})),expected=cap.prepareTranslation([{layerId:'@base',shapeId:'r'},{layerId:'@base',shapeId:'b'}],{x:17,y:9});cap.dispose();
  await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();expect(comparable((await read()).symbols!.find(s=>s.id==='selection')!)).toEqual(comparable(expected));expect(errors).toEqual([]);return;
 }
 if(mode!=='source')await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();const after=await read();const expected=structuredClone(before);if(mode==='source')expected.symbols!.find(s=>s.id==='selection')!.timeline!.duration=15;
 expect(after).toEqual(expected);expect(errors).toEqual([]);
});

for(const action of ['move','plain'])for(const restored of [false,true])test('isolated selection mode rejects pending legacy authoring '+action+' '+restored,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1800,height:1400});await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),fixture('base'));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();
 await page.getByRole('group',{name:'Symbol Selection',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();const frame=page.getByLabel('Symbol frame',{exact:true});await frame.fill('5');await frame.press('Tab');await page.getByLabel('Show sampled symbol stage',{exact:true}).check();await page.getByLabel('Sampled symbol artwork',{exact:true}).selectOption(JSON.stringify(['@base','r']));await page.getByLabel('Sampled symbol X offset',{exact:true}).fill('17');await page.getByLabel('Sampled symbol Y offset',{exact:true}).fill('9');
 await page.evaluate(restored=>{const original=JSON.stringify;(window as unknown as {legacyHook:boolean}).legacyHook=false;JSON.stringify=((value:unknown,...args:unknown[])=>{const out=original(value,...args as [never,never]),s=value as SymbolDefinition;if(s?.id==='selection'&&s.timeline?.motionSpans?.length===2){JSON.stringify=original;(window as unknown as {legacyHook:boolean}).legacyHook=true;const e=document.querySelector('input[aria-label="Select multiple sampled symbol units"]')as HTMLInputElement;e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));if(restored){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}}return out;})as typeof JSON.stringify;},restored);
 await page.getByRole('button',{name:action==='plain'?'Promote sampled symbol pose':'Promote and move sampled symbol pose',exact:true}).click();expect(await page.evaluate(()=>(window as unknown as {legacyHook:boolean}).legacyHook)).toBe(true);await expect(page.getByRole('button',{name:'Undo symbol timeline change',exact:true})).toBeDisabled();
 await page.getByLabel('Select multiple sampled symbol units',{exact:true}).check();const panel=page.getByRole('group',{name:'Sampled symbol selection set'});await panel.getByLabel('Sampled symbol unit @base/r',{exact:true}).check();await panel.getByLabel('Sampled symbol selection X offset').fill('5');await panel.getByLabel('Sampled symbol selection Y offset').fill('3');await panel.getByRole('button',{name:'Commit sampled symbol selection translation',exact:true}).click();
 const undo=page.getByRole('button',{name:'Undo symbol timeline change',exact:true});await expect(undo).toBeEnabled();await undo.click();await expect(undo).toBeDisabled();
 await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();expect(await read()).toEqual(before);expect(errors).toEqual([]);
});
