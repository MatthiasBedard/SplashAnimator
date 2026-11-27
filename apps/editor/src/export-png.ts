import { validateProject, type Project } from '@splash/document';
import { PNGArchive } from './png-archive';
import { captureDimensions, exportHTML } from '../../../packages/export-web/src';
import { validateLiveMotionData } from '../../../packages/document/src/live-motion';
import { prepareLivePNGFrame } from './live-png';

export type PNGFrameRange = { start: number; end: number };

/** Fresh runtime replays every authored frame; no stage interaction state is captured. */
export async function exportPNGFrame(project: Project, frame: number, signal?: AbortSignal, transparent = false, scale = 1, validateLive?: () => void): Promise<Blob> {
  validateLiveMotionData(project);
  if(project.layers.some(layer=>layer.liveMotionSpans?.length)){
    if(typeof transparent!=='boolean')throw Error('Choose an explicit live PNG background policy.');
    const prepared=await prepareLivePNGFrame(project,frame,scale,{signal,validate:validateLive});
    const blob=await capturePNG(prepared.project,frame,signal,undefined,undefined,undefined,transparent,scale,false,0,false,false,undefined,prepared.check);
    prepared.check();return blob;
  }
  return capturePNG(project, frame, signal, undefined, undefined, undefined, transparent, scale);
}

export async function exportPNGSequence(project: Project, signal?: AbortSignal, progress?: (completed: number, total: number) => void, range?: PNGFrameRange, transparent = false, scale = 1, validate?: () => void): Promise<Blob> {
  return capturePNG(project, 'sequence', signal, progress, undefined, range, transparent, scale,false,0,false,false,undefined,validate);
}

export async function exportPNGSequenceToSink(project: Project, sink: (part: Blob) => Promise<void>, signal?: AbortSignal, progress?: (completed: number, total: number) => void, range?: PNGFrameRange, transparent = false, scale = 1, validate?: () => void): Promise<void> {
  await capturePNG(project, 'sequence', signal, progress, sink, range, transparent, scale,false,0,false,false,undefined,validate);
}

/** Sequential detached frame delivery for complete-output packagers. Legacy ZIP bytes stay exact. */
export async function capturePNGSequenceFrames(project: Project, consume: (frame: number, blob: Blob) => Promise<void>, signal?: AbortSignal, range?: PNGFrameRange, transparent = false, scale = 1, validate?: () => void): Promise<void> {
  if(typeof consume !== 'function')throw new Error('PNG frame consumer must be callable.');
  await capturePNG(project,'sequence',signal,undefined,undefined,range,transparent,scale,false,0,false,false,consume,validate);
}

export function pngSheetLayout(width:number,height:number,count:number){
  if(!Number.isSafeInteger(count)||count<1)throw new Error('Sprite sheet needs a positive frame count.');
  const columns=Math.min(count,Math.max(1,Math.ceil(Math.sqrt(count*height/width))));
  const rows=Math.ceil(count/columns);
  const size=captureDimensions(width*columns,height*rows,1);
  return {...size,columns,rows};
}

// Bound a page independently of timeline length; never drop frames to fit a raster.
export function pngSheetPages(width:number,height:number,count:number,padding=0){
  if(!Number.isSafeInteger(padding)||padding<0)throw new Error("Sprite sheet padding must be a nonnegative integer.");
  captureDimensions(width,height,1);
  if(!Number.isSafeInteger(count)||count<1)throw new Error('Sprite sheet needs a positive frame count.');
  const cellWidth=width+2*padding,cellHeight=height+2*padding;
  captureDimensions(cellWidth,cellHeight,1);
  let capacity=Math.min(64,count);
  let layout:ReturnType<typeof pngSheetLayout>|undefined;
  for(;capacity>=1;capacity--){
    try{layout=pngSheetLayout(cellWidth,cellHeight,capacity);break;}catch{ /* Try fewer tiles within the raster budget. */ }
  }
  if(!layout)throw new Error('Sprite sheet frame exceeds the raster budget.');
  const pages=Math.ceil(count/capacity);
  if(pages>65533)throw new Error('Sprite sheets exceed the ZIP entry limit.');
  return {...layout,capacity,pages,padding,cellWidth,cellHeight};
}

export async function exportPNGSheet(project:Project,signal?:AbortSignal,progress?:(completed:number,total:number)=>void,range?:PNGFrameRange,transparent=false,scale=1,padding=0,extrude=false,trim=false,validate?:()=>void):Promise<Blob>{
  return capturePNG(project,'sequence',signal,progress,undefined,range,transparent,scale,true,padding,extrude,trim,undefined,validate);
}

export async function exportPNGSheetToSink(project:Project,sink:(part:Blob)=>Promise<void>,signal?:AbortSignal,progress?:(completed:number,total:number)=>void,range?:PNGFrameRange,transparent=false,scale=1,padding=0,extrude=false,trim=false,validate?:()=>void):Promise<void>{
  await capturePNG(project,'sequence',signal,progress,sink,range,transparent,scale,true,padding,extrude,trim,undefined,validate);
}

async function capturePNG(project: Project, frame: number | 'sequence', signal?: AbortSignal, progress?: (completed: number, total: number) => void, sink?: (part: Blob) => Promise<void>, range?: PNGFrameRange, transparent = false, scale = 1, sheet = false, padding = 0, extrude = false, trim = false, frameSink?: (frame: number, blob: Blob) => Promise<void>, admit?:()=>void): Promise<Blob> {
  const active=()=>{signal?.throwIfAborted();admit?.();signal?.throwIfAborted();};
  active();
  const live=frame==='sequence'&&project.layers.some(layer=>layer.liveMotionSpans?.length);
  const source=live?structuredClone(validateProject(project)):project;
  if(live&&typeof transparent!=='boolean')throw Error('Choose an explicit live PNG background policy.');
  const start=range?.start??0,end=range?.end??source.duration-1;
  if(range && (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=source.duration))
    throw new Error('PNG range must be within the existing timeline.');
  const count=end-start+1;
  signal?.throwIfAborted();
  const output=captureDimensions(source.width,source.height,scale);
  const layout=sheet?pngSheetPages(output.width,output.height,count,padding):undefined;
  const sheetName=(page:number)=>layout?.pages===1?'sheet.png':`sheet-${String(page+1).padStart(6,'0')}.png`;
  const html = live?undefined:exportHTML(project, frame, transparent, scale);
  active();
  let host:HTMLIFrameElement|undefined,atlas:HTMLCanvasElement|undefined;
  // Each browser callback has a deadline, including toBlob, which may never settle.
  async function wait<T>(operation: Promise<T>, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      active();
      const result=await Promise.race([operation, new Promise<never>((_, reject) => {
        abort = () => reject(signal?.reason ?? new DOMException('PNG export cancelled.', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        timer = setTimeout(() => reject(new Error(message)), 60000);
      })]);
      active();return result;
    } catch(cause){
      void Promise.resolve(operation).catch(()=>{});throw cause;
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }
  async function loadAuthoredCanvas(html:string) {
    const renderer=document.createElement('iframe');
    host=renderer;
    renderer.hidden=true;
    renderer.setAttribute('aria-hidden','true');
    renderer.title='PNG frame renderer';
    const loaded = new Promise<void>((resolve, reject) => {
      renderer.onload = () => resolve();
      renderer.onerror = () => reject(new Error('PNG renderer could not load.'));
    });
    renderer.srcdoc = html;
    document.body.append(renderer);
    await wait(loaded, 'PNG renderer could not load.');
    const deadline = performance.now() + 60000;
    while (true) {
      active();
      const canvas=renderer.contentDocument?.querySelector('canvas');
      if (canvas?.dataset.capture === (frame === 'sequence' ? 'waiting' : 'ready')) return canvas;
      if (canvas?.dataset.capture === 'error') throw new Error('PNG rendering or bitmap decoding failed.');
      if (performance.now() > deadline) throw new Error('PNG rendering timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function* authoredFrames(canvas:HTMLCanvasElement) {
    let sliceStarted=performance.now();
    for(let index=0;index<=end;index++){
      active();
      canvas.dataset.capture='rendering';
      canvas.dispatchEvent(new Event('capture-next'));
      if(canvas.dataset.capture!=='ready'||canvas.dataset.frame!==String(index))
        throw Error('PNG sequence rendering failed.');
      // Skipped exposures still determine nested playback age.
      if(index>=start)yield {frame:index,canvas};
      // A timer for every skipped frame throttles late-range exports even
      // when replay takes little CPU. Bound the work before yielding to UI.
      else if((index+1)%32===0||performance.now()-sliceStarted>=8){
        await new Promise(resolve=>setTimeout(resolve,0));
        sliceStarted=performance.now();
      }
    }
  }
  async function* liveFrames() {
    const {streamProjectCanvasFrames}=await wait(import('./desktop-png'),'PNG renderer could not load.');
    const controller=new AbortController();
    const iterator=streamProjectCanvasFrames(source,{start,end},scale,transparent,controller.signal,active);
    try{
      while(true){
        const next=await wait(iterator.next(),'PNG rendering timed out.');
        if(next.done)return;
        yield next.value;
      }
    }finally{
      controller.abort();
      await iterator.return(undefined);
    }
  }
  try {
    const authoredCanvas=html===undefined?undefined:await loadAuthoredCanvas(html);
    const encode = (source:HTMLCanvasElement) => wait(new Promise<Blob>((resolve, reject) => source.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png',
    )), 'PNG encoding timed out.');
    if (frame !== 'sequence') return await encode(authoredCanvas!);
    atlas=layout?document.createElement('canvas'):undefined;
    if(atlas){atlas.width=layout!.width;atlas.height=layout!.height;}
    const atlasContext=atlas?.getContext('2d');
    if(atlas&&!atlasContext)throw new Error('Sprite sheet canvas could not be allocated.');
    const archive = sink ? new PNGArchive(Number.MAX_SAFE_INTEGER, sink, true) : new PNGArchive();
    const manifest={
      fps: source.fps, frames: count, width: output.width, height: output.height, documentWidth:source.width, documentHeight:source.height, scale,
      ...(layout?{
        trimmed:trim,padding:layout.padding,extrude:extrude&&layout.padding>0,sheet:layout.pages===1?'sheet.png':undefined,sheetWidth:trim?0:layout.width,sheetHeight:trim?0:layout.height,columns:layout.columns,rows:layout.rows,
        sheets:Array.from({length:layout.pages},(_,page)=>({file:sheetName(page),width:layout.width,height:layout.height,firstFrame:start+page*layout.capacity+1,frames:Math.min(layout.capacity,count-page*layout.capacity)})),
        tiles:Array.from({length:count},(_,i)=>({frame:start+i+1,sheet:sheetName(Math.floor(i/layout.capacity)),x:((i%layout.capacity)%layout.columns)*layout.cellWidth+layout.padding,y:Math.floor((i%layout.capacity)/layout.columns)*layout.cellHeight+layout.padding,width:output.width,height:output.height,sourceX:0,sourceY:0,sourceWidth:output.width,sourceHeight:output.height,empty:false}))
      }:{}),
      firstFrame: start+1, lastFrame: end+1, timelineFrames: source.duration, pattern: sheet?undefined:`frame-${String(start+1).padStart(6,'0')}.png`, buttons: 'Up', background: transparent ? 'transparent' : source.background,
    };
    const writeManifest=()=>wait(archive.add('sequence.json',new Blob([JSON.stringify(manifest,null,2)]),signal),'PNG archive timed out.');
    if(!frameSink&&(!sheet||!trim))await writeManifest();
    let rowX=0,rowY=0,rowHeight=0,usedWidth=0,usedHeight=0;
    let held: { exposure: string; blob: Blob } | undefined;
    for await (const {frame:index,canvas} of live?liveFrames():authoredFrames(authoredCanvas!)) {
      active();
      if(atlasContext){
        const tile=(index-start)%layout!.capacity;
        let x=(tile%layout!.columns)*layout!.cellWidth+layout!.padding,y=Math.floor(tile/layout!.columns)*layout!.cellHeight+layout!.padding;
        let sx=0,sy=0,w=output.width,h=output.height,empty=false;
        if(trim){
          const context=canvas.getContext('2d')!;
          let left=output.width,top=output.height,right=-1,bottom=-1;
          // Read bounded strips so alpha inspection does not duplicate a full raster.
          for(let row=0;row<output.height;row+=32){
            active();
            const rows=Math.min(32,output.height-row),pixels=context.getImageData(0,row,output.width,rows).data;
            for(let yy=0;yy<rows;yy++)for(let xx=0;xx<output.width;xx++){
              if(pixels[(yy*output.width+xx)*4+3]===0)continue;
              left=Math.min(left,xx);right=Math.max(right,xx);top=Math.min(top,row+yy);bottom=Math.max(bottom,row+yy);
            }
            await new Promise(resolve=>setTimeout(resolve,0));
          }
          empty=right<0;
          sx=empty?0:left;sy=empty?0:top;w=empty?1:right-left+1;h=empty?1:bottom-top+1;
          // Keep frame order and the bounded column count, but remove wasted cell space.
          if(tile>0&&tile%layout!.columns===0){rowX=0;rowY+=rowHeight;rowHeight=0;}
          x=rowX+padding;y=rowY+padding;
          rowX+=w+2*padding;rowHeight=Math.max(rowHeight,h+2*padding);
          usedWidth=Math.max(usedWidth,rowX);usedHeight=Math.max(usedHeight,rowY+rowHeight);
          Object.assign(manifest.tiles![index-start],{x,y,sourceX:sx,sourceY:sy,width:w,height:h,empty});
        }
        if(!empty)atlasContext.drawImage(canvas,sx,sy,w,h,x,y,w,h);
        if(extrude&&padding>0&&!empty){
          // Repeat the outermost output pixels, including corner alpha, without filtering.
          atlasContext.save();
          atlasContext.imageSmoothingEnabled=false;
          atlasContext.drawImage(canvas,sx,sy,w,1,x,y-padding,w,padding);
          atlasContext.drawImage(canvas,sx,sy+h-1,w,1,x,y+h,w,padding);
          atlasContext.drawImage(canvas,sx,sy,1,h,x-padding,y,padding,h);
          atlasContext.drawImage(canvas,sx+w-1,sy,1,h,x+w,y,padding,h);
          for(const [cx,dx] of [[sx,x-padding],[sx+w-1,x+w]])
            for(const [cy,dy] of [[sy,y-padding],[sy+h-1,y+h]])
              atlasContext.drawImage(canvas,cx,cy,1,1,dx,dy,padding,padding);
          atlasContext.restore();
        }
        if(tile===layout!.capacity-1||index===end){
          const page=Math.floor((index-start)/layout!.capacity);
          let cropped:HTMLCanvasElement|undefined;
          try{
            if(trim){
              cropped=document.createElement('canvas');cropped.width=usedWidth;cropped.height=usedHeight;
              const context=cropped.getContext('2d');
              if(!context)throw new Error('Trimmed sprite page could not be allocated.');
              context.drawImage(atlas!,0,0,usedWidth,usedHeight,0,0,usedWidth,usedHeight);
              Object.assign(manifest.sheets![page],{width:usedWidth,height:usedHeight});
              manifest.sheetWidth=Math.max(manifest.sheetWidth!,usedWidth);manifest.sheetHeight=Math.max(manifest.sheetHeight!,usedHeight);
            }
            await wait(archive.add(sheetName(page),await encode(cropped??atlas!),signal),'PNG archive timed out.');
          }finally{if(cropped){cropped.width=0;cropped.height=0;}}
          rowX=rowY=rowHeight=usedWidth=usedHeight=0;
          atlasContext.clearRect(0,0,atlas!.width,atlas!.height);
        }
      }else{
        // This token exists only when visible paint depends solely on held
        // keys. Keep a single immutable encode for the current exposure.
        const exposure = sink && !frameSink && !live ? canvas.dataset.pngExposure : undefined;
        const blob = held && exposure === held.exposure ? held.blob : await encode(canvas);
        held = exposure === undefined ? undefined : { exposure, blob };
        if(frameSink)await wait(frameSink(index,blob),'PNG frame delivery timed out.');
        else await wait(archive.add(`frame-${String(index + 1).padStart(6, '0')}.png`, blob, signal, exposure !== undefined), 'PNG archive timed out.');
      }
      progress?.(index-start+1, count);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    active();
    if(frameSink)return new Blob([]);
    if(sheet&&trim)await writeManifest();
    if (sink) { await wait(archive.finishToSink(signal), 'PNG archive timed out.'); return new Blob([]); }
    return archive.finish();
  } finally {
    if(host){
      host.onload=host.onerror=null;
      const canvas=host.contentDocument?.querySelector('canvas');
      if(canvas)canvas.width=canvas.height=0;
      host.remove();
    }
    if(atlas)atlas.width=atlas.height=0;
  }
}
