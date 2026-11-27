import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { worldPoint } from '../../packages/geometry/src';
import { pressureHandle } from '../../packages/geometry/src/pressure';
import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { newProject, id, type Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { containsPoint, worldPaths } from '../../packages/geometry/src/drawing';
async function waitForArtwork(page: Page, index = 0) {
  await expect
    .poll(() =>
      page.evaluate((index) => {
        const saved = localStorage.getItem('splash-recovery-v1');
        return saved
          ? !!(JSON.parse(saved).project as Project).layers[0].keys[0].shapes[index]
          : false;
      }, index),
    )
    .toBe(true);
}

function distantPressureFills(count:number) {
  return Array.from({length:count},(_,i)=>({
    id:'distant-'+i,kind:'polygon' as const,x:1100+i*55,y:240,width:40,height:40,rotation:0,
    fill:'#cc2244',stroke:'#000000',strokeWidth:0,points:[],closed:true,fillRule:'evenodd' as const,
    drawingMode:'merge' as const,contours:[Array.from({length:300},(_,n)=>({
      x:+(20+20*Math.cos(n*Math.PI/150)).toFixed(3),y:+(20+20*Math.sin(n*Math.PI/150)).toFixed(3),
    }))],
  }));
}

for (const count of [0,220]) test(`a queued Pencil and cancelled pen stroke keep a variable-width Merge Brush edit recoverable (${count} distant fills)`, async ({page}) => {
  if (count) await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.width = 480;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  const lower = {id:'lower',kind:'rectangle' as const,x:170,y:120,width:70,height:60,rotation:0,
    points:[],fill:'#ff0000',stroke:'#000000',strokeWidth:0,drawingMode:'merge' as const};
  const initial = project.layers[0].keys[0].shapes = [lower,...distantPressureFills(count)];
  await holdGeometry(page);
  await page.addInitScript(project=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
    const workers={created:0,pencil:0};
    Object.assign(window,{queuedPressureWorkers:workers});
    const Native = window.Worker;
    window.Worker = class extends Native {
      readonly number = ++workers.created;
      postMessage(message:unknown,transfer:Transferable[]|StructuredSerializeOptions=[]) {
        if ((message as {pencil?:unknown})?.pencil) workers.pencil=this.number;
        if (Array.isArray(transfer)) super.postMessage(message,transfer);
        else super.postMessage(message,transfer);
      }
    };
  }, project);
  await page.goto('/');
  const open = page.getByRole('button',{name:'Open editor',exact:true});
  const recover = page.getByRole('button',{name:'Recover changes',exact:true});
  await expect(open.or(recover).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await recover.click();
  const brush = page.getByRole('button',{name:'Brush',exact:true});
  await brush.click();
  await expect(page.getByLabel('Pressure controls size',{exact:true})).toBeChecked();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#000000');
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const canvas = page.getByLabel('Drawing stage',{exact:true});
  const box = (await canvas.boundingBox())!;
  const left = Math.round(box.x+box.width/2-240), top = Math.round(box.y+box.height/2-150);
  const read = ():Promise<Project['layers'][number]['keys'][number]['shapes']> => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const pixel = (x:number,y:number) => canvas.evaluate((node,{x,y})=>{
    const c=node as HTMLCanvasElement, bounds=c.getBoundingClientRect();
    return [...c.getContext('2d')!.getImageData(
      (x-bounds.x)*c.width/bounds.width,(y-bounds.y)*c.height/bounds.height,1,1,
    ).data];
  },{x:left+x,y:top+y});
  const black = [0,0,0,255], white = [255,255,255,255];
  const pen = await page.context().newCDPSession(page);
  const workers = () => page.evaluate(()=>(window as unknown as {
    queuedPressureWorkers:{created:number;pencil:number};
  }).queuedPressureWorkers);
  const send = (type:'mousePressed'|'mouseMoved'|'mouseReleased',x:number,y:number,force:number) =>
    pen.send('Input.dispatchMouseEvent',{type,x:left+x,y:top+y,pointerType:'pen',force,
      buttons:type==='mouseReleased'?0:1,button:type==='mouseMoved'?'none':'left'});
  if (count) await canvas.evaluate(node=>node.addEventListener('pointerdown',event=>{
    node.setAttribute('data-profile-pointer',String((event as PointerEvent).pointerId));
  },{once:true}));
  const sample = (from:number,to:number,pressure:number) => canvas.evaluate((node,params)=>{
    const pointerId = Number(node.getAttribute('data-profile-pointer'));
    for (let x=params.from+.25;x<params.to;x+=.25) {
      node.dispatchEvent(new PointerEvent('pointermove',{clientX:params.left+x,clientY:params.top+150,
        pointerId,pointerType:'pen',bubbles:true,buttons:1,button:-1,isPrimary:true,pressure:params.pressure}));
    }
  },{from,to,pressure,left,top});
  await send('mousePressed',100,150,.25);
  if (count) await sample(100,165,.25);
  await send('mouseMoved',165,150,.25);
  await send('mouseMoved',165,150,.8);
  if (count) await sample(165,320,.8);
  await send('mouseMoved',320,150,.8);
  await send('mouseReleased',320,150,0);
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  await expect.poll(()=>pixel(120,157)).toEqual(white);
  await expect.poll(()=>pixel(275,157)).toEqual(black);

  const initialWorkers = (await workers()).created;
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.mouse.move(left+100,top+210);
  await page.mouse.down();
  await page.mouse.move(left+300,top+210,{steps:6});
  await expect.poll(async ()=>(await workers()).created,{timeout:2000}).toBe(initialWorkers+1);
  const follower = (await workers()).created;
  await page.mouse.up();
  const inkPreview = await pixel(180,210);
  expect(inkPreview).not.toEqual(white);
  await brush.click();
  await send('mousePressed',100,245,.8);
  await send('mouseMoved',300,245,.5);
  await expect.poll(()=>pixel(180,245)).toEqual(black);
  await page.keyboard.press('Escape');
  await send('mouseReleased',300,245,0);
  await expect.poll(()=>pixel(180,245)).toEqual(white);
  expect(await read()).toEqual(initial);
  expect(await pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  expect((await workers()).pencil).toBe(follower);
  const painted = await read();
  expect(painted.filter(shape=>shape.fill==='#ff0000')).toHaveLength(2);
  expect(painted.some(shape=>shape.strokeWidth>0)).toBe(false);
  expect(painted.filter(shape=>shape.id.startsWith('distant-'))).toEqual(initial.slice(1));
  const paintOwner = (x:number,y:number) => painted.filter(shape=>!shape.id.startsWith('distant-')).filter(shape=>
    worldPaths(shape,.025).reduce((inside,ring)=>inside!==containsPoint(ring,{x,y}),false))
    .map(shape=>shape.fill);
  expect(paintOwner(200,150)).toEqual(['#000000']);
  expect(paintOwner(200,125)).toEqual(['#ff0000']);
  await expect.poll(()=>pixel(120,157)).toEqual(white);
  await expect.poll(()=>pixel(275,157)).toEqual(black);
  await expect.poll(()=>pixel(180,210)).toEqual(inkPreview);
  await releaseGeometry(page);
  await expect.poll(async ()=>(await read()).some(shape=>shape.strokeWidth>0 && shape.fillEnabled===false)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(painted);
  await expect.poll(()=>pixel(180,210)).toEqual(white);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(initial);
  await expect.poll(()=>pixel(275,157)).toEqual(white);
  await pen.detach();
});

for (const [follower, ending] of [
  ['Pencil', 'release'], ['Pencil', 'cancel'], ['Pencil', 'stale source'],
  ['Pencil', 'capture loss'], ['Brush', 'release'], ['Pencil', 'rapid restart'], ['Pencil', 'suspended frame'],
] as const)
test(`large Brush publication waits for the active ${follower} gesture (${ending})`, async ({page}) => {
  await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.width = 480;
  project.height = 320;
  project.layers[0].drawingMode = 'merge';
  const distant = distantPressureFills(220);
  project.layers[0].keys[0].shapes = distant;
  await holdGeometry(page);
  await page.addInitScript(project=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
    const timing = {brushReplies:0,sourceChecks:0,changeSource:false,release:0,nextFrame:0,restart:0,preview:0};
    Object.assign(window,{brushPublicationTiming:timing});
    const Native = Worker;
    window.Worker = class extends Native {
      brushRequest = false;
      constructor(url:string|URL,options?:WorkerOptions) {
        super(url,options);
        this.addEventListener('message',()=>{
          if (this.brushRequest) timing.brushReplies++;
        },{once:true});
      }
      postMessage(message:unknown, transfer:Transferable[]|StructuredSerializeOptions=[]) {
        this.brushRequest = !!(message as {brushCommit?:unknown})?.brushCommit;
        if (Array.isArray(transfer)) super.postMessage(message,transfer);
        else super.postMessage(message,transfer);
      }
    };
    const stringify = JSON.stringify;
    JSON.stringify = function(...args:unknown[]) {
      const source = args[0] as Partial<Project> | undefined;
      if (timing.brushReplies && source?.id === project.id &&
          source.layers?.[0]?.keys[0]?.shapes.length === project.layers[0].keys[0].shapes.length) {
        timing.sourceChecks++;
        if (timing.changeSource) {
          timing.changeSource = false;
          source.name = 'Edited before deferred Brush publication';
        }
      }
      return Reflect.apply(stringify,JSON,args);
    };
  },project);
  await page.goto('/');
  const open = page.getByRole('button',{name:'Open editor',exact:true});
  const recover = page.getByRole('button',{name:'Recover changes',exact:true});
  await expect(open.or(recover).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await recover.click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#000000');
  const canvas = page.getByLabel('Drawing stage',{exact:true});
  const b = (await canvas.boundingBox())!;
  const x = Math.round(b.x+b.width/2-240), y = Math.round(b.y+b.height/2-160);
  const pixel = (x:number,y:number) => canvas.evaluate((node:HTMLCanvasElement,at)=>{
    const bounds=node.getBoundingClientRect();
    return [...node.getContext('2d')!.getImageData(
      (at.x-bounds.x)*node.width/bounds.width,(at.y-bounds.y)*node.height/bounds.height,1,1,
    ).data];
  },{x,y});
  const white = [255,255,255,255];
  await page.mouse.move(x+85,y+95);
  await page.mouse.down();
  await page.mouse.move(x+325,y+95,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  if (follower === 'Pencil') await page.getByRole('button',{name:follower,exact:true}).click();
  if (ending === 'capture loss') await canvas.evaluate(node=>node.addEventListener('pointerdown',event=>{
    node.setAttribute('data-follower-pointer',String((event as PointerEvent).pointerId));
  },{once:true}));
  await page.mouse.move(x+105,y+205);
  await page.mouse.down();
  await page.mouse.move(x+190,y+205,{steps:5});
  await releaseGeometry(page);
  const timing = () => page.evaluate(()=>(window as unknown as {
    brushPublicationTiming:{brushReplies:number;sourceChecks:number};
  }).brushPublicationTiming);
  await expect.poll(async ()=>(await timing()).brushReplies).toBe(1);
  await page.mouse.move(x+310,y+205,{steps:5});
  await expect.poll(()=>pixel(x+260,y+205)).not.toEqual(white);
  await expect.poll(()=>pixel(x+200,y+95)).toEqual([0,0,0,255]);
  expect((await timing()).sourceChecks).toBe(0);
  const read = ():Promise<Project['layers'][0]['keys'][0]['shapes']> => page.evaluate(()=>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  expect(await read()).toHaveLength(distant.length);
  if (ending === 'stale source') await page.evaluate(()=>{
    (window as unknown as {brushPublicationTiming:{changeSource:boolean}}).brushPublicationTiming.changeSource = true;
  });
  if (ending === 'cancel') await page.keyboard.press('Escape');
  if (ending === 'capture loss') {
    await canvas.evaluate((node:HTMLCanvasElement)=>{
      const pointer = Number(node.getAttribute('data-follower-pointer'));
      if (!node.hasPointerCapture(pointer)) throw Error('Expected native follower capture.');
      node.releasePointerCapture(pointer);
    });
    await page.mouse.move(x+315,y+205);
  }
  if (ending === 'rapid restart') {
    await canvas.evaluate((node:HTMLCanvasElement,probe)=>{
      const timing = (window as unknown as {
        brushPublicationTiming:{release:number;nextFrame:number;restart:number;preview:number};
      }).brushPublicationTiming;
      node.addEventListener('pointerup',()=>{
        timing.release = performance.now();
        requestAnimationFrame(()=>timing.nextFrame = performance.now());
      },{once:true,capture:true});
      node.addEventListener('pointerdown',()=>{
        timing.restart = performance.now();
        const box = node.getBoundingClientRect();
        const cx = (probe.x-box.x)*node.width/box.width, cy = (probe.y-box.y)*node.height/box.height;
        let attempts = 0;
        const samplePreview = () => {
          const pixel = node.getContext('2d')!.getImageData(cx,cy,1,1).data;
          if (pixel[3] === 255 && pixel.slice(0,3).some(channel=>channel<255)) timing.preview = performance.now();
          else if (++attempts < 60) requestAnimationFrame(samplePreview);
        };
        requestAnimationFrame(samplePreview);
      },{once:true,capture:true});
    },{x:x+250,y:y+265});
    const input = await page.context().newCDPSession(page);
    const mouse = (type:'mouseReleased'|'mousePressed'|'mouseMoved',x:number,y:number) =>
      input.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',
        buttons:type==='mouseReleased'?0:1});
    await Promise.all([
      mouse('mouseReleased',x+310,y+205),
      mouse('mousePressed',x+105,y+265),
      mouse('mouseMoved',x+290,y+265),
    ]);
    const getProgress = () => page.evaluate(()=>(window as unknown as {
      brushPublicationTiming:{sourceChecks:number;release:number;nextFrame:number;restart:number;preview:number};
    }).brushPublicationTiming);
    await expect.poll(async ()=>(await getProgress()).preview).toBeGreaterThan(0);
    const progress = await getProgress();
    console.log('Brush reply rapid restart (ms)',{
      nextFrame:Math.round(progress.nextFrame-progress.release),
      restart:Math.round(progress.restart-progress.release),
      visible:Math.round(progress.preview-progress.release),
      downToPreview:Math.round(progress.preview-progress.restart),
      sourceChecks:progress.sourceChecks,
    });
    expect(progress.sourceChecks).toBe(0);
    expect(progress.nextFrame).toBeGreaterThanOrEqual(progress.release);
    expect(progress.restart).toBeGreaterThanOrEqual(progress.release);
    expect(await read()).toHaveLength(distant.length);
    // The original Brush and completed Pencil may publish once the new draft ends.
    await page.keyboard.press('Escape');
    await mouse('mouseReleased',x+290,y+265);
    await input.detach();
  }
  if (ending === 'suspended frame') await page.evaluate(()=>{
    const original = requestAnimationFrame;
    Object.assign(window,{
      resumeTestFrames:()=>window.requestAnimationFrame = original,
      requestAnimationFrame:()=>0,
    });
  });
  await page.mouse.up();
  if (ending === 'stale source') {
    await expect(page.getByRole('alert')).toContainText('Drawing changed before queued geometry finished.');
    await expect(page.getByRole('button',{name:'Switch to Edited before deferred Brush publication'})).toBeVisible();
    expect((await timing()).sourceChecks).toBe(1);
    expect(await pendingGeometry(page)).toBe(0);
    expect(await read()).toEqual(distant);
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.getByRole('button',{name:/^Undo/})).toBeDisabled();
    return;
  }
  if (ending === 'suspended frame') {
    await expect.poll(async ()=>(await timing()).sourceChecks).toBe(1);
    await page.evaluate(()=>(window as unknown as {resumeTestFrames:()=>void}).resumeTestFrames());
  }
  await expect.poll(async ()=>(await read()).length).toBe(distant.length+1);
  expect((await timing()).sourceChecks).toBe(1);
  const painted = await read();
  expect(painted.filter(shape=>shape.id.startsWith('distant-'))).toEqual(distant);
  expect(painted.find(shape=>shape.fill==='#000000')).toMatchObject({kind:'polygon',strokeWidth:0});
  if (ending === 'release' || ending === 'rapid restart' || ending === 'suspended frame') {
    await expect.poll(()=>pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    if (follower === 'Pencil')
      await expect.poll(async ()=>(await read()).some(shape=>shape.fillEnabled===false&&shape.strokeWidth>0)).toBe(true);
    else await expect.poll(async ()=>(await read()).filter(shape=>shape.fill==='#000000'&&shape.kind==='polygon')).toHaveLength(2);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(painted);
    if (ending === 'rapid restart') await expect.poll(()=>pixel(x+250,y+265)).toEqual(white);
  } else {
    expect(await pendingGeometry(page)).toBe(0);
    await expect.poll(()=>pixel(x+260,y+205)).toEqual(white);
  }
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(distant);
});

for (const rootCount of [0,220]) test(`long pressure Brush retains mixed artwork and history (${rootCount} distant fills)`, async ({page}) => {
  await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.layers[0].drawingMode = 'merge';
  const distant = distantPressureFills(rootCount);
  const lower = {id:'lower',kind:'rectangle' as const,x:335,y:162,width:85,height:120,rotation:0,
    fill:'#ee1122',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge' as const};
  const ink = {id:'ink',kind:'path' as const,x:330,y:70,width:130,height:0,rotation:0,
    fill:'#000000',stroke:'#000000',strokeWidth:2,points:[{x:0,y:0},{x:130,y:0}],
    drawingMode:'merge' as const,fillEnabled:false};
  project.layers[0].keys[0].shapes = [lower,ink,...distant];
  await page.addInitScript(project=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
    const measure = {release:0,saved:0,start:0,end:0,references:0,post:0,transfer:0,parse:0,stringify:0,
      beforeRoots:0,sourceChecks:0,sourceCheckTime:0,storage:0};
    const time = () => performance.timeOrigin+performance.now();
    const active = () => !!measure.release && !measure.saved;
    Object.assign(window,{
      pressureReleaseMeasure:measure,
      beginPressureRelease(beforeRoots:number) {
        for (const key of Object.keys(measure) as (keyof typeof measure)[]) measure[key] = 0;
        measure.beforeRoots = beforeRoots;
        measure.release = time();
      },
    });
    const WorkerImpl = window.Worker;
    window.Worker = class extends WorkerImpl {
      constructor(url:string|URL,options?:WorkerOptions) {
        super(url,options);
        this.addEventListener('message',event=>{
          const {brushTiming,result} = event.data;
          if (!brushTiming) return;
          measure.start = brushTiming.geometryStart;
          measure.end = brushTiming.geometryEnd;
          measure.references = result.shapes.filter((shape:unknown)=>typeof shape==='number').length;
        });
      }
      postMessage(message:unknown,transfer:Transferable[]|StructuredSerializeOptions=[]) {
        const packet = message as {brushCommit?:unknown};
        const data = packet?.brushCommit ? {...packet,measureBrush:true} : message;
        const start = time();
        if (Array.isArray(transfer)) super.postMessage(data,transfer);
        else super.postMessage(data,transfer);
        if (packet?.brushCommit) {
          measure.post = start;
          measure.transfer += time()-start;
        }
      }
    };
    const parse=JSON.parse, stringify=JSON.stringify;
    JSON.parse = (...args:Parameters<typeof JSON.parse>) => {
      const isActive = active(), start = isActive ? time() : 0;
      const value = parse(...args);
      if (isActive) measure.parse += time()-start;
      return value;
    };
    JSON.stringify = function(...args:unknown[]) {
      const isActive=active(), start=isActive?time():0;
      const source = args[0] as Partial<Project> | undefined;
      const checkingSource = isActive && !!measure.end && start >= measure.end &&
        source?.id === project.id && source.layers?.[0]?.keys[0]?.shapes.length === measure.beforeRoots;
      const value=Reflect.apply(stringify,JSON,args);
      if (isActive) {
        const elapsed=time()-start;
        measure.stringify += elapsed;
        if (checkingSource) {
          measure.sourceChecks++;
          measure.sourceCheckTime += elapsed;
        }
      }
      return value;
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key:string,value:string) {
      const start = time();
      setItem.call(this,key,value);
      if (active() && key==='splash-recovery-v1') {
        measure.saved = time();
        measure.storage += measure.saved-start;
      }
    };
  },project);
  await page.goto('/');
  const open = page.getByRole('button',{name:'Open editor',exact:true});
  const recover = page.getByRole('button',{name:'Recover changes',exact:true});
  await expect(open.or(recover).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await recover.click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#000000');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const canvas = page.getByLabel('Drawing stage',{exact:true});
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x+box.width/2-400), y = Math.round(box.y+box.height/2-30);
  const pen = await page.context().newCDPSession(page);
  const measure = () => page.evaluate(()=>(window as unknown as {
    pressureReleaseMeasure:{release:number;saved:number;start:number;end:number;references:number;
      post:number;transfer:number;parse:number;stringify:number;sourceChecks:number;sourceCheckTime:number;storage:number};
  }).pressureReleaseMeasure);
  async function drawPressure(y:number, beforeRoots:number, release:'first'|'successive') {
    await canvas.evaluate(c=>c.addEventListener('pointerdown',event=>{
      c.setAttribute('data-profile-pointer',String((event as PointerEvent).pointerId));
    },{once:true}));
    await pen.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,pointerType:'pen',
      buttons:1,button:'left',force:.25});
    const preview = await canvas.evaluate(async (c,{x,y})=>{
      const canvas=c as HTMLCanvasElement, box=canvas.getBoundingClientRect();
      const position = (i:number)=>({clientX:x+i*.64,clientY:y+25*Math.sin(i/47)});
      const id = Number(c.getAttribute('data-profile-pointer'));
      let previewStart = 0;
      for(let i=1;i<1200;i++) {
        if(i===1199) previewStart = performance.now();
        c.dispatchEvent(new PointerEvent('pointermove',{...position(i),pointerId:id,pointerType:'pen',
          bubbles:true,buttons:1,button:-1,isPrimary:true,pressure:.25+i/1800}));
      }
      const end=position(1199);
      for(let frame=0;frame<60;frame++) {
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const color=canvas.getContext('2d')!.getImageData(
          (end.clientX-box.x)*canvas.width/box.width,(end.clientY-box.y)*canvas.height/box.height,1,1,
        ).data;
        if(color[0]===0 && color[1]===0 && color[2]===0 && color[3]===255) return performance.now()-previewStart;
      }
      throw Error('Pen preview did not reach the last sample.');
    },{x,y});
    await page.evaluate(beforeRoots=>
      (window as unknown as {beginPressureRelease:(count:number)=>void}).beginPressureRelease(beforeRoots),beforeRoots);
    await pen.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+1199*.64,y:y+25*Math.sin(1199/47),
      pointerType:'pen',buttons:0,button:'left',force:0});
    await expect.poll(async ()=>(await measure()).saved,{timeout:15000}).toBeGreaterThan(0);
    const timing = await measure();
    expect(timing.end).toBeGreaterThan(timing.start);
    expect(timing.saved).toBeGreaterThan(timing.end);
    expect(timing.sourceChecks).toBe(1);
    console.log('Pressure Brush timing (ms)',rootCount,release,Math.round(preview),
      Math.round(timing.end-timing.start),Math.round(timing.saved-timing.release));
    console.log('Pressure Brush capture, postMessage, worker wait, publication, parse, stringify, source check, storage (ms)',
      rootCount,release,[timing.post-timing.release,timing.transfer,timing.start-timing.post-timing.transfer,
        timing.saved-timing.end,timing.parse,timing.stringify,timing.sourceCheckTime,timing.storage].map(Math.round));
    return timing;
  }
  const timing = await drawPressure(y,project.layers[0].keys[0].shapes.length,'first');
  expect(timing.references).toBe(rootCount);
  const read = ():Promise<Project['layers'][number]['keys'][number]['shapes']> => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const painted = await read();
  expect(painted.filter(s=>s.id.startsWith('distant-'))).toEqual(distant);
  expect(painted.find(s=>s.id==='ink')).toEqual(ink);
  expect(painted.filter(s=>s.fill===lower.fill)).toHaveLength(2);
  expect(painted.some(s=>s.fill==='#000000' && !s.strokeWidth && s.contours?.some(r=>r.some(p=>p.in||p.out)))).toBe(true);
  const paint = painted.filter(s=>!s.strokeWidth && !s.id.startsWith('distant-'));
  const owners = (x:number,y:number) => paint.filter(s=>worldPaths(s,.025)
    .reduce((inside,ring)=>inside!==containsPoint(ring,{x,y}),false)).map(s=>s.fill);
  expect(owners(375,240+25*Math.sin((375-80)/.64/47))).toEqual(['#000000']);
  expect(owners(375,170)).toEqual([lower.fill]);
  if (rootCount) {
    const successive = await drawPressure(y+95,painted.length,'successive');
    expect(successive.references).toBeGreaterThanOrEqual(rootCount);
    const artwork = await read();
    expect(artwork).toHaveLength(painted.length+1);
    const originalIds = new Set(painted.map(shape=>shape.id));
    expect(artwork.filter(shape=>originalIds.has(shape.id))).toEqual(painted);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(painted);
  }
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(project.layers[0].keys[0].shapes);
  await pen.detach();
});

for (const pattern of ['retraces','loops'] as const)
test(`repeated pressure ${pattern} cut lower paint and retain distant curves and exact Undo`, async ({page})=>{
  const project = newProject();
  project.width = 480;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  const lower = {id:'lower',kind:'rectangle' as const,x:154,y:75,width:10,height:150,rotation:0,
    fill:'#2266cc',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge' as const};
  const distant = {id:'distant-curve',kind:'polygon' as const,x:325,y:100,width:20,height:24,rotation:0,
    fill:'#22cc66',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge' as const,
    fillRule:'evenodd' as const,closed:true,contours:[[
      {x:0,y:0,out:{x:7,y:-6}},{x:20,y:0,in:{x:13,y:-6}},{x:10,y:24},
    ]]};
  project.layers[0].keys[0].shapes = [lower,distant];
  await page.addInitScript(project=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
  },project);
  await page.goto('/');
  const open = page.getByRole('button',{name:'Open editor',exact:true});
  const recover = page.getByRole('button',{name:'Recover changes',exact:true});
  await expect(open.or(recover).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await recover.click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#cc4422');
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const canvas = page.getByLabel('Drawing stage',{exact:true});
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x+box.width/2-240), y = Math.round(box.y+box.height/2-150);
  await canvas.evaluate(node=>node.addEventListener('pointerdown',event=>{
    node.setAttribute('data-retrace-pointer',String((event as PointerEvent).pointerId));
  },{once:true}));
  const pen = await page.context().newCDPSession(page);
  const looping = pattern === 'loops';
  const start = {x:x+(looping ? 196 : 147),y:y+150};
  await pen.send('Input.dispatchMouseEvent',{...start,type:'mousePressed',pointerType:'pen',
    buttons:1,button:'left',force:looping ? .45 : .25});
  const last = await canvas.evaluate((node,{x,y,looping,start})=>{
    const pointerId = Number(node.getAttribute('data-retrace-pointer'));
    let last = start;
    for (let i=1;i<=(looping ? 960 : 450);i++) {
      const step = i % 36, distance = step <= 18 ? step : 36-step;
      const angle = (i % 48) * Math.PI / 24;
      last = looping ? {x:x+159+37*Math.cos(angle),y:y+150+38*Math.sin(angle)}
        : {x:x+147+distance,y:y+150+3*Math.sin(distance/5)};
      node.dispatchEvent(new PointerEvent('pointermove',{clientX:last.x,clientY:last.y,
        pointerId,pointerType:'pen',bubbles:true,buttons:1,button:-1,isPrimary:true,
        pressure:looping ? .45+.2*Math.sin(angle) : .25+distance/40}));
    }
    return last;
  },{x,y,looping,start});
  await pen.send('Input.dispatchMouseEvent',{...last,type:'mouseReleased',pointerType:'pen',buttons:0,button:'left'});
  const read = ():Promise<Project['layers'][0]['keys'][0]['shapes']> => page.evaluate(()=>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await expect.poll(async ()=>(await read()).length).toBe(looping ? 5 : 4);
  const artwork = await read();
  expect(artwork.find(shape=>shape.id===distant.id)).toEqual(distant);
  expect(artwork.filter(shape=>shape.fill===lower.fill)).toHaveLength(looping ? 3 : 2);
  const ownersAt = (x:number,y:number) => artwork.filter(shape=>worldPaths(shape,.025)
    .reduce((inside,ring)=>inside!==containsPoint(ring,{x,y}),false)).map(shape=>shape.fill);
  const paintY = looping ? 112 : 150;
  expect(ownersAt(159,paintY)).toEqual(['#cc4422']);
  expect(ownersAt(159,86)).toEqual([lower.fill]);
  expect(ownersAt(159,218)).toEqual([lower.fill]);
  const brush = artwork.find(shape=>shape.fill==='#cc4422');
  expect(brush?.contours?.some(ring=>ring.some(point=>point.in||point.out))).toBe(true);
  if (looping) {
    expect(brush?.contours).toHaveLength(2);
    expect(ownersAt(159,150)).toEqual([lower.fill]);
    expect(ownersAt(159,188)).toEqual(['#cc4422']);
  }
  const pixel = () => canvas.evaluate((node:HTMLCanvasElement,at)=>{
    const bounds = node.getBoundingClientRect();
    return [...node.getContext('2d')!.getImageData(
      (at.x-bounds.x)*node.width/bounds.width,(at.y-bounds.y)*node.height/bounds.height,1,1).data];
  },{x:x+159,y:y+paintY});
  await expect.poll(pixel).toEqual([204,68,34,255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([lower,distant]);
  await expect.poll(pixel).toEqual([34,102,204,255]);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(artwork);
  await pen.detach();
});

test('new Brush pressure ramps stay visible while drawing and through held worker release', async ({ page }) => {
  const project = newProject();
  project.width = 480;
  project.height = 300;
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [{
    id: 'old-ink', kind: 'rectangle', x: 40, y: 35, width: 60, height: 10, rotation: 0,
    points: [], fill: '#ff0000', stroke: '#ff0000', strokeWidth: 0,
  }];
  await holdGeometry(page);
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#000000');
  await page.getByLabel('Pressure controls size', { exact: true }).uncheck();
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const spatial = page.getByLabel('Pen pressure varies opacity while drawing', { exact: true });
  await spatial.check();
  const minimum = page.getByLabel('Minimum pressure opacity', { exact: true });
  await minimum.fill('20');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const rect = (await canvas.boundingBox())!;
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  const read = (): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  const rgb = () => canvas.evaluate((el: HTMLCanvasElement) => [-100, 0, 100].map(dx =>
    el.getContext('2d')!.getImageData(Math.floor(el.width / 2 + dx * devicePixelRatio),
      Math.floor(el.height / 2 + 4 * devicePixelRatio), 1, 1).data[0]));
  const ramp = [153, 102, 51];
  const matchesRamp = (channels: number[]) => channels.every((c, i) => Math.abs(c - ramp[i]) <= 2);
  const backingAreas = await canvas.evaluateHandle(stage => {
    const areas: number[] = [];
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (this.canvas !== stage && this.fillStyle === '#000000') areas.push(width * height);
      return fill.call(this, x, y, width, height);
    };
    return areas;
  });
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: x - 140, y, button: 'left', buttons: 1, clickCount: 1,
    pointerType: 'pen', force: 0.25,
  });
  await expect.poll(() => backingAreas.evaluate(areas => areas.length)).toBeGreaterThan(0);
  const firstBacking = await backingAreas.evaluate(areas => Math.max(...areas));
  console.log('Pressure Brush first backing fill:', firstBacking);
  expect(firstBacking).toBeLessThan(2048);
  const move = (dx: number, force: number) => pen.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x + dx, y, buttons: 1, pointerType: 'pen', force,
  });
  await move(-60, 0.25);
  await minimum.evaluate((el: HTMLInputElement) => {
    el.value = '80';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await move(60, 0.75);
  await move(140, 0.75);
  await expect.poll(async () => matchesRamp(await rgb())).toBe(true);
  expect(await read()).toEqual(project);

  const areas = await canvas.evaluateHandle((stage) => {
    const areas: number[] = [];
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h, settings) {
      if (this.canvas !== stage) areas.push(w * h);
      return read.call(this, x, y, w, h, settings);
    };
    return areas;
  });
  await move(146, 0.75);
  await expect.poll(() => areas.evaluate(a => a.length)).toBeGreaterThan(0);
  expect(await areas.evaluate(a => Math.max(...a))).toBeLessThan(1600);
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + 146, y, button: 'left', buttons: 0, clickCount: 1,
    pointerType: 'pen', force: 0,
  });
  await pen.detach();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await expect.poll(async () => matchesRamp(await rgb())).toBe(true);
  expect(await read()).toEqual(project);
  await releaseGeometry(page);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(2);
  const saved = await read();
  const [old, stroke] = saved.layers[0].keys[0].shapes;
  expect(old).toEqual(project.layers[0].keys[0].shapes[0]);
  expect(stroke.opacity).toBeUndefined();
  expect(stroke.brush?.opacityProfile).toEqual({ minimum: 0.2, response: 1 });
  expect(stroke.points.map(p => p.pressure)).toEqual([0.25, 0.25, 0.75, 0.75, 0.75]);
  await expect.poll(async () => matchesRamp(await rgb())).toBe(true);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const png = await fs.readFile((await (await pending).path())!);
  const pixels = await page.evaluate(async encoded => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + encoded;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [140, 240, 340].map(x => ctx.getImageData(x, 154, 1, 1).data[0]);
  }, png.toString('base64'));
  expect(matchesRamp(pixels)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(project);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(read).toEqual(saved);
});

test('symbol Brush publishes captured pressure ramps only on document Save', async ({ page }) => {
  const p = newProject();
  p.symbols = [{ id: 'pressure-symbol', name: 'Pressure ink', width: 280, height: 180, shapes: [{
    id: 'original-ink', kind: 'rectangle', x: 8, y: 8, width: 60, height: 10, rotation: 0,
    points: [], fill: '#ff0000', stroke: '#ff0000', strokeWidth: 0,
  }] }];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({
    project, folder: null, manifest: null,
  })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('option', { name: 'Library item Pressure ink', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  await page.getByLabel('Symbol canvas tool', { exact: true }).selectOption('brush');
  await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
  await page.getByLabel('Pen pressure varies opacity while drawing', { exact: true }).check();
  await page.getByLabel('Minimum pressure opacity', { exact: true }).fill('20');
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const y = Math.round(rect.y + rect.height * 0.45);
  const x = Math.round(rect.x + rect.width * 0.26), end = Math.round(rect.x + rect.width * 0.55);
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    pointerType: 'pen', force: 0.25,
  });
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: end, y, buttons: 1, pointerType: 'pen', force: 0.75,
  });
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1,
    pointerType: 'pen', force: 0,
  });
  await pen.detach();
  await expect(page.getByLabel('Symbol artwork item', { exact: true }).locator('option')).toHaveCount(2);
  const read = (): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await read()).symbols![0].shapes.length).toBe(2);
  const [old, stroke] = (await read()).symbols![0].shapes;
  expect(old).toEqual(p.symbols[0].shapes[0]);
  expect(stroke.brush?.opacityProfile).toEqual({ minimum: 0.2, response: 1 });
  expect(stroke.points.map(p => p.pressure)).toEqual([0.25, 0.75]);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('advanced symbol Brush retains the coalesced pen points without adding a move summary', async ({ page }) => {
  const project = newProject();
  project.symbols = [{ id: 'symbol-pen', name: 'Batched pen', width: 280, height: 180, shapes: [{
    id: 'original-ink', kind: 'rectangle', x: 8, y: 8, width: 60, height: 10, rotation: 0,
    points: [], fill: '#ff0000', stroke: '#ff0000', strokeWidth: 0,
  }] }];
  await page.addInitScript(source => localStorage.setItem('splash-recovery-v1', JSON.stringify({
    project: source, folder: null, manifest: null,
  })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('option', { name: 'Library item Batched pen', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  await page.getByLabel('Symbol canvas tool', { exact: true }).selectOption('brush');
  await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
  await page.getByLabel('Symbol brush stabilization', { exact: true }).fill('0');
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
  await page.getByLabel('Symbol brush optimize', { exact: true }).uncheck();
  await page.getByLabel('Symbol brush size', { exact: true }).fill('6');
  await page.getByLabel('New symbol drawing fill', { exact: true }).fill('#000000');
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x + box.width * 0.2), y = Math.round(box.y + box.height * 0.4);
  const pixels = () => canvas.evaluate((el: HTMLCanvasElement, { x, y }) => {
    const rect = el.getBoundingClientRect();
    const ctx = el.getContext('2d')!;
    return [[60, 0], [70, 12]].map(([dx, dy]) => [...ctx.getImageData(
      (x + dx - rect.x) * el.width / rect.width, (y + dy - rect.y) * el.height / rect.height, 1, 1,
    ).data]);
  }, { x, y });
  const before = await pixels();
  await canvas.evaluate(el => el.addEventListener('pointerdown', event => {
    el.setAttribute('data-pen-pointer', String((event as PointerEvent).pointerId));
  }, { once: true }));
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1,
    pointerType: 'pen', force: 0.25 });
  await canvas.evaluate((el, { x, y }) => {
    const pointerId = Number(el.getAttribute('data-pen-pointer'));
    const contact = (dx: number, dy: number, pressure: number) => new PointerEvent('pointermove', {
      bubbles: true, pointerId, pointerType: 'pen', isPrimary: true, buttons: 1,
      clientX: x + dx, clientY: y + dy, pressure,
    });
    const summary = contact(70, 12, 1);
    Object.defineProperty(summary, 'getCoalescedEvents', { value: () => [contact(35, 0, 0.5), contact(70, 0, 0.75)] });
    el.dispatchEvent(summary);
  }, { x, y });
  await expect.poll(async () => (await pixels())[0]).toEqual([0, 0, 0, 255]);
  expect((await pixels())[1]).toEqual(before[1]);
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 70, y, button: 'left', buttons: 0,
    pointerType: 'pen', force: 0 });
  await pen.detach();
  const read = (): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  await expect(page.getByLabel('Symbol artwork item', { exact: true }).locator('option')).toHaveCount(2);
  expect(await read()).toEqual(project);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(async () => (await read()).symbols![0].shapes.length).toBe(2);
  const saved = await read();
  const [original, stroke] = saved.symbols![0].shapes;
  expect(original).toEqual(project.symbols[0].shapes[0]);
  expect(stroke.kind).toBe('brush');
  expect(stroke.points.map(point => point.pressure)).toEqual([0.25, 0.5, 0.75]);
  expect(new Set(stroke.points.map(point => point.y)).size).toBe(1);
  const [start, middle, end] = stroke.points;
  expect(end.x).toBeGreaterThan(start.x);
  expect(middle.x).toBeCloseTo((start.x + end.x) / 2, 6);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(read).toEqual(project);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+Shift+z');
  await expect.poll(read).toEqual(saved);
});

for (const [tool, interrupt] of [['brush', 'pointercancel'], ['pencil', 'capture loss']] as const)
  test(`symbol ${tool} ${interrupt} cancels its draft and preserves the preceding Brush release`, async ({ page }) => {
    const project = newProject();
    project.symbols = [{ id: 'cancel-pen', name: 'Interrupted ink', width: 280, height: 180, shapes: [{
      id: 'old-ink', kind: 'rectangle', x: 8, y: 8, width: 60, height: 10, rotation: 0,
      points: [], fill: '#ff0000', stroke: '#ff0000', strokeWidth: 0,
    }] }];
    await holdGeometry(page);
    await page.addInitScript(source => localStorage.setItem('splash-recovery-v1', JSON.stringify({
      project: source, folder: null, manifest: null,
    })), project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('option', { name: 'Library item Interrupted ink', exact: true }).dblclick();
    await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
    const toolSelect = page.getByLabel('Symbol canvas tool', { exact: true });
    await toolSelect.selectOption('brush');
    await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
    await page.getByLabel('New symbol drawing fill', { exact: true }).fill('#000000');
    const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
    await canvas.scrollIntoViewIfNeeded();
    const rect = (await canvas.boundingBox())!;
    const from = Math.round(rect.x + rect.width * 0.24), to = Math.round(rect.x + rect.width * 0.64);
    const rows = [0.35, 0.55, 0.7].map(fraction => Math.round(rect.y + rect.height * fraction));
    const pixel = (y: number) => canvas.evaluate((el: HTMLCanvasElement, { x, y }) => {
      const bounds = el.getBoundingClientRect();
      return [...el.getContext('2d')!.getImageData((x - bounds.x) * el.width / bounds.width,
        (y - bounds.y) * el.height / bounds.height, 1, 1).data];
    }, { x: (from + to) / 2, y });
    const blank = await Promise.all(rows.map(pixel));
    const stroke = async (y: number) => {
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 6 });
    };
    const read = (): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
    await stroke(rows[0]);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await expect.poll(() => pixel(rows[0])).not.toEqual(blank[0]);
    await toolSelect.selectOption(tool);
    await canvas.evaluate(el => el.addEventListener('pointerdown', e => {
      el.setAttribute('data-test-pointer', String((e as PointerEvent).pointerId));
    }, { once: true }));
    await stroke(rows[1]);
    await expect.poll(() => pixel(rows[1])).not.toEqual(blank[1]);
    const hasCapture = () => canvas.evaluate((el: HTMLCanvasElement) =>
      el.hasPointerCapture(Number(el.getAttribute('data-test-pointer'))));
    expect(await hasCapture()).toBe(true);
    const capturedAfterInterrupt = await canvas.evaluate((el: HTMLCanvasElement, interrupt) => {
      const pointerId = Number(el.getAttribute('data-test-pointer'));
      if (!el.hasPointerCapture(pointerId)) throw Error('The drawing draft never acquired pointer capture');
      if (interrupt === 'pointercancel') el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'mouse', pointerId }));
      else {
        el.addEventListener('lostpointercapture', event => {
          if (event.pointerId === pointerId) el.setAttribute('data-test-capture-lost', 'yes');
        }, { once: true });
        el.releasePointerCapture(pointerId);
      }
      return el.hasPointerCapture(pointerId);
    }, interrupt);
    expect(capturedAfterInterrupt).toBe(false);
    if (interrupt === 'capture loss') {
      await page.mouse.move(to + 2, rows[1]);
      await expect(canvas).toHaveAttribute('data-test-capture-lost', 'yes');
    }
    expect(await hasCapture()).toBe(false);
    await expect.poll(() => pixel(rows[1])).toEqual(blank[1]);
    expect(await pixel(rows[0])).not.toEqual(blank[0]);
    await page.mouse.up();
    expect(await pendingGeometry(page)).toBe(1);
    expect(await read()).toEqual(project);

    await releaseGeometry(page);
    const items = page.getByLabel('Symbol artwork item', { exact: true }).locator('option');
    await expect(items).toHaveCount(2);
    await stroke(rows[2]);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect(items).toHaveCount(3);
    await expect.poll(() => pixel(rows[2])).not.toEqual(blank[2]);
    expect(await pixel(rows[1])).toEqual(blank[1]);
    await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    await expect.poll(async () => (await read()).symbols![0].shapes.length).toBe(3);
    const saved = await read();
    expect(saved.symbols![0].shapes[0]).toEqual(project.symbols[0].shapes[0]);
    const [, previous, next] = saved.symbols![0].shapes;
    expect(previous.kind).toBe('brush');
    expect(previous.points.length).toBeGreaterThanOrEqual(2);
    if (tool === 'brush') expect(next.kind).toBe('brush');
    else expect(next.fillEnabled).toBe(false);
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
    await expect.poll(read).toEqual(project);
    await page.getByLabel('Drawing stage', { exact: true }).press('Control+Shift+z');
    await expect.poll(read).toEqual(saved);
  });

test('initial pen pressure sets a separate brush opacity through preview, PNG and recovery', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const contact = page.getByLabel('Initial pen pressure controls opacity', { exact: true });
  await expect(contact).toBeDisabled();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Pressure controls size', { exact: true }).uncheck();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#000000');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const read = (): Promise<Project | null> => page.evaluate(() => {
    const stored = localStorage.getItem('splash-recovery-v1');
    return stored ? JSON.parse(stored).project as Project : null;
  });
  const shapes = async () => (await read())?.layers.flatMap(layer => layer.keys[0].shapes) ?? [];
  await page.mouse.move(x - 100, y - 75);
  await page.mouse.down();
  await page.mouse.move(x + 100, y - 75);
  await page.mouse.up();
  await expect.poll(async () => (await shapes()).length).toBe(1);
  const previous = (await read())!;
  await contact.check();
  const minimum = page.getByLabel('Minimum pressure opacity', { exact: true });
  await minimum.fill('20');
  await page.getByLabel('Pressure opacity response', { exact: true }).fill('2');
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: x - 100, y, button: 'left', buttons: 1, clickCount: 1,
    pointerType: 'pen', force: 0.25,
  });
  await minimum.evaluate((el: HTMLInputElement) => {
    el.value = '80';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(minimum).toHaveValue('80');
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x + 100, y, buttons: 1, pointerType: 'pen', force: 0.75,
  });
  const stagePixel = () => canvas.evaluate((el: HTMLCanvasElement) =>
    el.getContext('2d')!.getImageData(
      Math.floor(el.width / 2), Math.floor(el.height / 2 + 4 * devicePixelRatio), 1, 1,
    ).data[0]);
  await expect.poll(async () => Math.abs((await stagePixel()) - 191)).toBeLessThanOrEqual(1);
  expect(await read()).toEqual(previous);
  await pen.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + 100, y, button: 'left', buttons: 0, clickCount: 1,
    pointerType: 'pen', force: 0,
  });
  await pen.detach();
  await expect.poll(async () => (await shapes()).length).toBe(2);
  const painted = await read();
  const [old, fresh] = await shapes();
  expect(old).toEqual(previous.layers.flatMap(layer => layer.keys[0].shapes)[0]);
  expect(fresh.opacity).toBe(0.25);
  expect(fresh.points[0].pressure).toBe(0.25);
  expect(fresh.points.at(-1)!.pressure).toBe(0.75);
  await expect.poll(async () => Math.abs((await stagePixel()) - 191)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const png = await fs.readFile((await (await download).path())!);
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + encoded;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [0, -75].map(offset => Array.from(ctx.getImageData(
      image.width / 2, image.height / 2 + offset, 1, 1,
    ).data));
  }, png.toString('base64'));
  expect(pixels[0].slice(0, 3).every(value => Math.abs(value - 191) <= 1)).toBe(true);
  expect(pixels[0][3]).toBe(255);
  expect(pixels[1]).toEqual([0, 0, 0, 255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(previous);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(painted);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect.poll(read).toEqual(painted);
});

test('an editable Brush pressure-opacity profile paints light and firm sections in PNG and recovery', async ({ page }) => {
  const p = newProject();
  p.width = 360;
  p.height = 240;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [{
    id: 'opacity-ink', kind: 'brush', x: 80, y: 100, width: 200, height: 0, rotation: 0,
    fill: '#000000', stroke: '#000000', strokeWidth: 24,
    brush: { pressure: false, minimum: 1, aspect: 1, tilt: false, angle: 0 },
    points: [[0, 0.25], [100, 0.25], [130, 0.8], [200, 0.8], [175, 0.25]]
      .map(([x, pressure]) => ({ x, y: 0, pressure })),
  }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 16);
  const read = (): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  const sample = () => canvas.evaluate((el: HTMLCanvasElement) => {
    const d = devicePixelRatio;
    return [-60, 15, 90].map(offset => el.getContext('2d')!.getImageData(
      Math.floor(el.width / 2 + offset * d), Math.floor(el.height / 2 - 16 * d), 1, 1,
    ).data[0]);
  });
  const toggle = page.getByLabel('Pressure varies opacity along stroke', { exact: true });
  await toggle.check();
  const active = await read();
  const expected = structuredClone(p);
  expected.layers[0].keys[0].shapes[0].brush!.opacityProfile = { minimum: 0.2, response: 1 };
  expect(active).toEqual(expected);
  await canvas.press('Escape');
  const near = (actual: number[]) => actual.every((value, index) => Math.abs(value - [153, 97, 41][index]) <= 2);
  await expect.poll(async () => near(await sample())).toBe(true);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const png = await fs.readFile((await (await pending).path())!);
  const pngPixels = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [120, 195, 270].map(x => ctx.getImageData(x, 104, 1, 1).data[0]);
  }, png.toString('base64'));
  expect(near(pngPixels)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await expect.poll(async () => near(await sample())).toBe(true);
});

test('pressure profiles alter exported brush width, preserve geometry and undo sample edits', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('50');
  await page.getByLabel('Brush optimize', { exact: true }).uncheck();
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
  await page.getByLabel('Drawing fill', { exact: true }).fill('#000000');
  await page.mouse.move(b.x + 300, b.y + 220);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 220, { steps: 20 });
  await page.mouse.up();
  await waitForArtwork(page);
  const original = await read();
  await page.getByRole('button', { name: 'Apply pressure profile', exact: true }).click();
  const tapered = await read();
  expect(tapered.points[0].pressure).toBe(0);
  expect(tapered.points.at(-1)!.pressure).toBe(0);
  expect(Math.max(...tapered.points.map(p => p.pressure ?? 0))).toBeGreaterThan(0.9);
  expect(tapered.points.map(({ x, y }) => ({ x, y }))).toEqual(
    original.points.map(({ x, y }) => ({ x, y })),
  );
  await page.getByLabel('Sample pressure', { exact: true }).fill('50');
  await page.getByLabel('Sample pressure', { exact: true }).press('Tab');
  expect((await read()).points[0].pressure).toBe(0.5);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(tapered);
  const downloading = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await downloading);
  const out = await page.context().newPage();
  await openWebExport(out, files);
  const start = worldPoint(tapered, tapered.points[0]);
  const end = worldPoint(tapered, tapered.points.at(-1)!);
  expect(end.x - start.x).toBeGreaterThan(50);
  const columns = [0.1, 0.5, 0.9].map(t => Math.round(start.x + (end.x - start.x) * t));
  const widths = await out.locator('canvas').evaluate((element, columns) => {
    const c = element as HTMLCanvasElement,
      ctx = c.getContext('2d')!;
    return columns.map((x) => {
      const data = ctx.getImageData(x, 0, 1, c.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) n++;
      return n;
    });
  }, columns);
  expect(widths[1]).toBeGreaterThan(widths[0] * 2);
  expect(widths[1]).toBeGreaterThan(widths[2] * 2);
  await out.close();
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(original);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('canvas brush width edits, profile reverse and uniform reset support undo and cancellation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('70');
  await page.mouse.move(b.x + 300, b.y + 230);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 250, { steps: 12 });
  await page.mouse.up();
  await waitForArtwork(page);
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByLabel('Transform skew X', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
  const before = await read(),
    index = Math.floor(before.points.length / 2);
  await page.getByLabel('Pressure sample', { exact: true }).fill(String(index + 1));
  await page.getByRole('button', { name: 'Edit width on canvas', exact: true }).click();
  const z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue()),
    o = { x: b.x + (b.width - 960 * z) / 2, y: b.y + (b.height - 540 * z) / 2 },
    h = pressureHandle(before, index),
    start = worldPoint(before, h),
    p = before.points[index],
    r =
      (before.strokeWidth / 2) *
      ((before.brush?.minimum ?? 0.1) + (1 - (before.brush?.minimum ?? 0.1)) * 0.25),
    end = worldPoint(before, { x: p.x + Math.cos(h.angle) * r, y: p.y + Math.sin(h.angle) * r });
  async function drag() {
    await page.mouse.move(o.x + start.x * z, o.y + start.y * z);
    await page.mouse.down();
    await page.mouse.move(o.x + end.x * z, o.y + end.y * z, { steps: 6 });
  }
  await drag();
  await page.mouse.up();
  const changed = await read();
  expect(changed.points[index].pressure).toBeCloseTo(0.25, 2);
  expect(changed.points.map((p) => [p.x, p.y])).toEqual(before.points.map((p) => [p.x, p.y]));
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+a');
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(before);
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('Profile start pressure').fill('0');
  await page.getByLabel('Profile middle pressure').fill('50');
  await page.getByLabel('Profile end pressure').fill('100');
  await page.getByRole('button', { name: 'Apply pressure profile', exact: true }).click();
  const profile = await read();
  await page.getByRole('button', { name: 'Reverse pressure profile', exact: true }).click();
  expect((await read()).points[0].pressure).toBe(1);
  expect((await read()).points.at(-1)!.pressure).toBe(0);
  await page.getByRole('button', { name: 'Uniform pressure', exact: true }).click();
  expect((await read()).points.every((p) => p.pressure === 1)).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(profile);
});

test('brush response presets retain raw samples and change exported widths', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('80');
  await page.getByLabel('New brush pressure response').fill('2');
  await page.getByLabel('Drawing fill').fill('#000000');
  await page.mouse.move(b.x + 300, b.y + 230);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 230, { steps: 12 });
  await page.mouse.up();
  await waitForArtwork(page);
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  expect((await read()).brush!.response).toBe(2);
  for (const name of ['start', 'middle', 'end'])
    await page.getByLabel(`Profile ${name} pressure`).fill('50');
  await page.getByRole('button', { name: 'Apply pressure profile', exact: true }).click();
  const original = await read();
  async function width() {
    const d = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const out = await page.context().newPage();
    await openWebExport(out, await readWebDownload(await d));
    const n = await out.locator('canvas').evaluate((c, s) => {
      const canvas = c as HTMLCanvasElement,
        ctx = canvas.getContext('2d')!,
        pixels = ctx.getImageData(Math.floor(s.x + s.width / 2), 0, 1, canvas.height).data;
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) n++;
      return n;
    }, original);
    await out.close();
    return n;
  }
  const firm = await width();
  await page.getByRole('button', { name: 'Soft response', exact: true }).click();
  const soft = await width(),
    softShape = await read();
  expect(soft).toBeGreaterThan(firm * 1.7);
  expect(softShape.points).toEqual(original.points);
  await page.getByRole('button', { name: 'Linear response', exact: true }).click();
  const linear = await width();
  expect(linear).toBeGreaterThan(firm);
  expect(linear).toBeLessThan(soft);
  expect((await read()).points).toEqual(original.points);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(softShape);
});

test('selected nib twist changes exported width without changing saved pen samples', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [
    {
      id: id(),
      kind: 'brush',
      x: 200,
      y: 200,
      width: 240,
      height: 0,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 80,
      points: [
        { x: 0, y: 0, pressure: 1, twist: 90 },
        { x: 240, y: 0, pressure: 1, twist: 90 },
      ],
      brush: { pressure: true, minimum: 0.1, aspect: 0.25, angle: 0, tilt: false },
    },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage');
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  async function width() {
    const d = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const out = await page.context().newPage();
    await openWebExport(out, await readWebDownload(await d));
    const n = await out.locator('canvas').evaluate((c) => {
      const canvas = c as HTMLCanvasElement,
        data = canvas.getContext('2d')!.getImageData(320, 0, 1, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 128) n++;
      return n;
    });
    await out.close();
    return n;
  }
  const initial = await width();
  await page.getByLabel('Selected nib twist').check();
  const twisted = await read();
  expect(twisted.points).toEqual(project.layers[0].keys[0].shapes[0].points);
  expect(await width()).toBeGreaterThan(initial * 3);
  await page.getByLabel('Selected nib angle').fill('90');
  await page.getByLabel('Selected nib angle').press('Tab');
  expect(await width()).toBeLessThan(initial * 1.2);
  await page.getByRole('button', { name: 'Reset nib', exact: true }).click();
  expect((await read()).brush).toMatchObject({ aspect: 1, angle: 0, twist: false, tilt: false });
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(twisted);
});

test('brush stabilization catches the release point and smoothing preserves metadata with undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByLabel('Drawing mode').selectOption('object');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush optimize in Properties', { exact: true }).uncheck();
  await page.getByLabel('Brush stabilizer distance').fill('30');
  await page.getByLabel('Brush finish simplify').fill('0');
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const z = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue()),
    o = { x: b.x + (b.width - 960 * z) / 2, y: b.y + (b.height - 540 * z) / 2 };
  await page.mouse.move(b.x + 300, b.y + 220);
  await page.mouse.down();
  for (const [x, y] of [
    [350, 220],
    [400, 260],
    [450, 210],
    [500, 260],
    [550, 220],
  ])
    await page.mouse.move(b.x + x, b.y + y);
  await page.mouse.up();
  await waitForArtwork(page);
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const original = await read();
  expect(original.points[1].x - original.points[0].x).toBeCloseTo(50 / z - 30, 1);
  const start = worldPoint(original, original.points[0]),
    end = worldPoint(original, original.points.at(-1)!);
  expect(end.x).toBeCloseTo((b.x + 550 - o.x) / z, 1);
  expect(end.y).toBeCloseTo((b.y + 220 - o.y) / z, 1);
  await page.getByLabel('Selected brush smoothing').fill('100');
  await page.getByRole('button', { name: 'Smooth selected brush', exact: true }).click();
  const smoothed = await read();
  expect(smoothed.points).not.toEqual(original.points);
  expect(worldPoint(smoothed, smoothed.points[0])).toEqual(start);
  expect(worldPoint(smoothed, smoothed.points.at(-1)!)).toEqual(end);
  expect(smoothed.points.map(({ x: _x, y: _y, ...metadata }) => metadata)).toEqual(
    original.points.map(({ x: _x, y: _y, ...metadata }) => metadata),
  );
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(original);
  await page.getByLabel('Brush finish simplify').fill('100');
  await page.mouse.move(b.x + 300, b.y + 350);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + 400);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(original);
  await page.mouse.move(b.x + 300, b.y + 340);
  await page.mouse.down();
  for (const [x, y] of [
    [350, 340],
    [400, 380],
    [450, 330],
    [500, 380],
    [550, 340],
  ])
    await page.mouse.move(b.x + x, b.y + y);
  await page.mouse.up();
  await waitForArtwork(page, 1);
  const finished = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0]
        .shapes[1],
  );
  expect(finished.points).toHaveLength(smoothed.points.length);
  finished.points.forEach((p, i) => {
    const actual = worldPoint(finished, p),
      expected = worldPoint(smoothed, smoothed.points[i]);
    expect(actual.x).toBeCloseTo(expected.x, 4);
    expect(actual.y - 120 / z).toBeCloseTo(expected.y, 4);
  });
});

test('smoothing affine brush samples preserves stationary nib changes through undo and recovery', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [
    {
      id: 'stationary-nib',
      kind: 'brush',
      x: 400,
      y: 220,
      width: 240,
      height: 80,
      rotation: 17,
      transform: [-1.2, 0.2, 0.35, 1.1],
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 30,
      brush: { pressure: true, minimum: 0.1, tilt: true, twist: true, aspect: 0.3, angle: 10 },
      points: [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 40, y: 80, pressure: 0.3 },
        { x: 100, y: 0, pressure: 0.4, twist: 0 },
        { x: 100, y: 0, pressure: 0.8, tiltX: 30, twist: 90 },
        { x: 100, y: 0, pressure: 0.5, tiltY: 20, twist: 180 },
        { x: 160, y: 80, pressure: 0.3 },
        { x: 240, y: 0, pressure: 0.2 },
      ],
    },
  ];
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage');
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const original = await read();
  await page.getByLabel('Selected brush smoothing').fill('100');
  await page.getByRole('button', { name: 'Smooth selected brush', exact: true }).click();
  const smoothed = await read();
  expect(smoothed.points).toHaveLength(original.points.length);
  for (const i of [0, 2, 3, 4, 6]) {
    const expected = worldPoint(original, original.points[i]),
      actual = worldPoint(smoothed, smoothed.points[i]);
    expect(actual.x).toBeCloseTo(expected.x, 8);
    expect(actual.y).toBeCloseTo(expected.y, 8);
  }
  expect(worldPoint(smoothed, smoothed.points[1])).not.toEqual(
    worldPoint(original, original.points[1]),
  );
  expect(smoothed.points.map(({ x: _x, y: _y, ...metadata }) => metadata)).toEqual(
    original.points.map(({ x: _x, y: _y, ...metadata }) => metadata),
  );
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(smoothed);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await expect.poll(read).toEqual(smoothed);
});

test('pen release defaults preserve contact orientation and stabilized endpoint', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush stabilizer distance').fill('20');
  const canvas = page.getByLabel('Drawing stage'),
    box = (await canvas.boundingBox())!;
  const zoom = Number(await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue());
  const origin = {
    x: box.x + (box.width - 960 * zoom) / 2,
    y: box.y + (box.height - 540 * zoom) / 2,
  };
  // Establish real pointer capture, then inject deterministic pen contact/release
  // events for the same pointer. This is handler coverage, not stylus hardware QA.
  await canvas.evaluate((c) =>
    c.addEventListener(
      'pointerdown',
      (event) => {
        (window as unknown as { brushPointer: number }).brushPointer = (
          event as PointerEvent
        ).pointerId;
      },
      { once: true },
    ),
  );
  await page.mouse.move(box.x + 280, box.y + 230);
  await page.mouse.down();
  await canvas.evaluate((c) => {
    const box = c.getBoundingClientRect(),
      pointerId = (window as unknown as { brushPointer: number }).brushPointer;
    for (const x of [340, 400])
      c.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId,
          pointerType: 'pen',
          buttons: 1,
          clientX: box.x + x,
          clientY: box.y + 230,
          pressure: 0.8,
          tiltX: 30,
          tiltY: -20,
          twist: 270,
        }),
      );
    c.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId,
        pointerType: 'pen',
        buttons: 0,
        clientX: box.x + 420,
        clientY: box.y + 230,
        pressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
      }),
    );
  });
  await page.mouse.up();
  await waitForArtwork(page);
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await expect.poll(async () => (await read()).length).toBe(1);
  const result = await read(),
    shape = result[0],
    end = shape.points.at(-1)!;
  expect(end).toMatchObject({ tiltX: 30, tiltY: -20, twist: 270 });
  expect(end.pressure).toBeCloseTo(0.8, 6);
  const position = worldPoint(shape, end);
  expect(position.x).toBeCloseTo((box.x + 420 - origin.x) / zoom, 6);
  expect(position.y).toBeCloseTo((box.y + 230 - origin.y) / zoom, 6);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(result);
});

for (const [tool, stabilization] of [
  ['Brush', 0],
  ['Brush', 20],
  ['Pencil', 0],
] as const)
  test(`${tool} retains a subpixel release endpoint with stabilization ${stabilization}`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByLabel('Drawing mode').selectOption('object');
    await page.getByRole('button', { name: tool, exact: true }).click();
    if (tool === 'Brush') {
      await page.getByLabel('Separate brush objects', { exact: true }).check();
      await page.getByLabel('Brush stabilizer distance').fill(String(stabilization));
      await page.getByLabel('Brush finish simplify').fill('100');
    }
    const canvas = page.getByLabel('Drawing stage'),
      box = (await canvas.boundingBox())!;
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (event) => {
          (window as unknown as { endpointPointer: number }).endpointPointer = (
            event as PointerEvent
          ).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + 280, box.y + 230);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 230);
    await canvas.evaluate((c) => {
      const box = c.getBoundingClientRect();
      c.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: (window as unknown as { endpointPointer: number }).endpointPointer,
          pointerType: 'mouse',
          buttons: 0,
          clientX: box.x + 400.0625,
          clientY: box.y + 230.03125,
        }),
      );
    });
    await page.mouse.up();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    await expect.poll(async () => (await read()).length).toBe(1);
    const result = await read(),
      shape = result[0],
      end = worldPoint(
        shape,
        shape.kind === 'bezier' ? shape.nodes!.at(-1)! : shape.points.at(-1)!,
      );
    expect(shape.kind).toBe(tool === 'Pencil' ? 'bezier' : 'brush');
    expect(end.x).toBeCloseTo(400.0625 - (box.width - 960) / 2, 6);
    expect(end.y).toBeCloseTo(230.03125 - (box.height - 540) / 2, 6);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(result);
  });

test('selected brush smoothing retains uneven straight pressure landmarks under affine transforms', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [
    {
      id: 'uneven-pressure',
      kind: 'brush',
      x: 400,
      y: 220,
      width: 240,
      height: 80,
      rotation: 17,
      transform: [-1.2, 0.2, 0.35, 1.1],
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 30,
      brush: { pressure: true, minimum: 0.1, tilt: true, twist: true, aspect: 0.3, angle: 10 },
      points: [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 1, y: 0, pressure: 0.9, twist: 30 },
        { x: 9, y: 0, pressure: 0.3, tiltX: 20 },
        { x: 50, y: 0, pressure: 0.8, twist: 90 },
        { x: 150, y: 0, pressure: 0.2 },
        { x: 200, y: 80, pressure: 0.9 },
        { x: 240, y: 0, pressure: 0.2 },
      ],
    },
  ];
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage');
  await canvas.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  const original = await read();
  await page.getByLabel('Selected brush smoothing').fill('100');
  await page.getByRole('button', { name: 'Smooth selected brush', exact: true }).click();
  const smoothed = await read();
  for (const i of [0, 1, 2, 3, 6]) {
    const expected = worldPoint(original, original.points[i]),
      actual = worldPoint(smoothed, smoothed.points[i]);
    expect(actual.x).toBeCloseTo(expected.x, 8);
    expect(actual.y).toBeCloseTo(expected.y, 8);
  }
  expect(worldPoint(smoothed, smoothed.points[5])).not.toEqual(
    worldPoint(original, original.points[5]),
  );
  expect(smoothed.points.map(({ x: _x, y: _y, ...metadata }) => metadata)).toEqual(
    original.points.map(({ x: _x, y: _y, ...metadata }) => metadata),
  );
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(smoothed);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await expect.poll(read).toEqual(smoothed);
});
