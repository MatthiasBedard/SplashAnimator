import {validateProject,type Project} from '@splash/document';
import {validateLiveMotionData} from '../../../packages/document/src/live-motion';
import {exportHTML} from '../../../packages/export-web/src';
import {gifCaptureSettings} from './gif-settings';
import {openGifStream} from '../../../packages/export-video/src/gif-stream-async';
import {openGifChunkStream,type GifChunkSink} from '../../../packages/export-video/src/gif-chunk-async';
/** Two fresh exact-frame replays: shared palette analysis, then incremental encoding. */
export async function exportGIF(project:Project,signal:AbortSignal,transparent=false,range?:{start:number;end:number},progress?:(done:number,total:number)=>void,loop=false,dither:'none'|'ordered'='none',compression:'literal'|'dictionary'='literal'){
  const result=await renderGIF(project,signal,transparent,range,progress,loop,dither,compression);
  if(!('bytes' in result))throw new Error('Missing GIF output.');
  return {blob:new Blob([result.bytes as Uint8Array<ArrayBuffer>],{type:'image/gif'}),quantized:result.quantized,count:result.count};
}
export async function exportGIFToSink(project:Project,sink:GifChunkSink,signal:AbortSignal,transparent=false,range?:{start:number;end:number},progress?:(done:number,total:number)=>void,loop=false,dither:'none'|'ordered'='none',compression:'literal'|'dictionary'='literal'){
  const result=await renderGIF(project,signal,transparent,range,progress,loop,dither,compression,sink);
  if(!('bytesWritten' in result))throw new Error('Missing GIF destination receipt.');
  return result;
}
async function renderGIF(project:Project,signal:AbortSignal,transparent:boolean,range:{start:number;end:number}|undefined,progress:((done:number,total:number)=>void)|undefined,loop:boolean,dither:'none'|'ordered',compression:'literal'|'dictionary',sink?:GifChunkSink){
  signal.throwIfAborted();
  validateLiveMotionData(project);
  const {start,end,count,width,height}=gifCaptureSettings(project,range,dither,compression);
  const digests=new Uint8Array(count*32);
  const live=project.layers.some(layer=>layer.liveMotionSpans?.length);
  const snapshot=live?structuredClone(validateProject(project)):project;
  const html=live?undefined:exportHTML(project,'sequence',transparent,1),controller=new AbortController();
  const abort=()=>controller.abort(signal.reason??new DOMException('GIF export cancelled.','AbortError'));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new Error('GIF export timed out.')),60000);
  const active=controller.signal;
  let stream:Awaited<ReturnType<typeof openGifStream>>|Awaited<ReturnType<typeof openGifChunkStream>>|undefined;
  let rejectWait:(reason:unknown)=>void=()=>{};
  const stop=()=>rejectWait(active.reason);
  const stopped=new Promise<never>((_,reject)=>{rejectWait=reject;});
  active.addEventListener('abort',stop,{once:true});
  const emit=async(pass:'analyze'|'index',index:number,pixels:Uint8ClampedArray<ArrayBuffer>,current:()=>void)=>{
    const digest=new Uint8Array(await Promise.race([crypto.subtle.digest('SHA-256',pixels),stopped]));
    current();
    const offset=(index-start)*32;
    if(pass==='analyze')digests.set(digest,offset);
    else if(digest.some((byte,n)=>byte!==digests[offset+n]))throw new Error(`GIF frame ${index+1} changed between rendering passes. Export cancelled.`);
    await stream![pass](pixels,true);
    progress?.((pass==='index'?count:0)+index-start+1,count*2);
  };
  const replay=async(pass:'analyze'|'index')=>{
    active.throwIfAborted();
    if(live){
      const {captureProjectCanvasFrames}=await import('./desktop-png');
      active.throwIfAborted();
      await captureProjectCanvasFrames(snapshot,{start,end},1,transparent,active,()=>{},async(index,canvas,current)=>{
        const context=canvas.getContext('2d');
        if(!context)throw new Error('GIF canvas is unavailable.');
        await emit(pass,index,context.getImageData(0,0,width,height).data,current);
      });
      return;
    }
    const host=document.createElement('iframe');host.hidden=true;host.title='GIF frame renderer';host.setAttribute('aria-hidden','true');
    try{
      const loaded=new Promise<void>((resolve,reject)=>{host.onload=()=>resolve();host.onerror=()=>reject(new Error('GIF renderer could not load.'));});
      host.srcdoc=html!;document.body.append(host);await Promise.race([loaded,stopped]);
      let canvas:HTMLCanvasElement|null=null;
      while(true){
        active.throwIfAborted();canvas=host.contentDocument?.querySelector('canvas')??null;
        if(canvas?.dataset.capture==='waiting')break;
        if(canvas?.dataset.capture==='error')throw new Error('GIF bitmap/font rendering failed.');
        await Promise.race([new Promise(resolve=>setTimeout(resolve,20)),stopped]);
      }
      const context=canvas.getContext('2d');if(!context)throw new Error('GIF canvas is unavailable.');
      for(let index=0;index<=end;index++){
        active.throwIfAborted();canvas.dataset.capture='rendering';canvas.dispatchEvent(new Event('capture-next'));
        if(canvas.dataset.capture!=='ready'||canvas.dataset.frame!==String(index))throw new Error('GIF frame replay failed.');
        if(index>=start){
          await emit(pass,index,context.getImageData(0,0,width,height).data,()=>active.throwIfAborted());
        }
        await Promise.race([new Promise(resolve=>setTimeout(resolve,0)),stopped]);
      }
    }finally{host.onload=host.onerror=null;host.remove();}
  };
  const work=async()=>{
    active.throwIfAborted();
    const settings={width,height,frameCount:count,fps:snapshot.fps,startFrame:start,matte:[255,255,255] as const,transparent,loop,dither,compression},options={signal:active,timeoutMs:60000};
    stream=sink?await openGifChunkStream(settings,sink,options):await openGifStream(settings,options);
    await replay('analyze');await stream.seal();await replay('index');
    const result=await stream.finish();active.throwIfAborted();
    return {...result,count};
  };
  try{return await Promise.race([work(),stopped]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);active.removeEventListener('abort',stop);controller.abort();await stream?.dispose();}
}
