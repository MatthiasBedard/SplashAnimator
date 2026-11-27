import type {Project} from '@splash/document';
import {captureDimensions,exportHTML} from '../../../packages/export-web/src';

/** Detached, script-free replay. Skipped root frames still advance nested clocks. */
export function createFrameReplay(project:Project,options:{signal?:AbortSignal;timeoutMs?:number}={}){
  const timeout=options.timeoutMs??10000;
  if(!Number.isFinite(timeout)||timeout<=0||timeout>60000)throw new Error('Invalid frame replay deadline.');
  options.signal?.throwIfAborted();
  const {width,height}=captureDimensions(project.width,project.height,1);
  if(width*height*4>128*1024*1024)throw new Error('Frame replay exceeds the 128 MiB raster budget.');
  const duration=project.duration,html=exportHTML(project,'sequence',false,1);
  let host:HTMLIFrameElement|undefined,canvas:HTMLCanvasElement|undefined,cursor=-1,busy=false;
  const lifetime=new AbortController();
  const remove=()=>{if(host){host.onload=host.onerror=null;host.remove();}host=undefined;canvas=undefined;cursor=-1;};
  const dispose=(reason:unknown=new DOMException('Frame replay disposed.','AbortError'))=>{
    lifetime.abort(reason);remove();options.signal?.removeEventListener('abort',abort);
  };
  const abort=()=>dispose(options.signal?.reason);
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted)abort();
  return {dispose,async seek(frame:number):Promise<ImageData>{
    lifetime.signal.throwIfAborted();
    if(!Number.isSafeInteger(frame)||frame<0||frame>=duration)throw new Error('Invalid replay frame.');
    if(busy)throw new Error('Frame replay already has a pending seek.');
    const steps=frame<cursor?frame+1:frame-cursor;
    if(steps>10001)throw new Error('Frame replay seek exceeds 10001 frame steps.');
    busy=true;
    const started=performance.now();
    const timer=setTimeout(()=>dispose(new Error('Frame replay timed out.')),timeout);
    let rejectWait:(reason:unknown)=>void=()=>{};
    const stopped=new Promise<never>((_,reject)=>{rejectWait=reject;});
    void stopped.catch(()=>{});
    const stop=()=>rejectWait(lifetime.signal.reason);
    lifetime.signal.addEventListener('abort',stop,{once:true});
    const wait=async(ms:number)=>{
      lifetime.signal.throwIfAborted();
      await Promise.race([new Promise(resolve=>setTimeout(resolve,ms)),stopped]);
      lifetime.signal.throwIfAborted();
    };
    try{
      if(frame<cursor)remove();
      if(!host){
        host=document.createElement('iframe');host.hidden=true;host.title='Detached frame replay';host.setAttribute('aria-hidden','true');
        const loaded=new Promise<void>((resolve,reject)=>{host!.onload=()=>resolve();host!.onerror=()=>reject(new Error('Frame replay could not load.'));});
        host.srcdoc=html;document.body.append(host);
        await Promise.race([loaded,stopped]);lifetime.signal.throwIfAborted();
        while(true){
          canvas=host?.contentDocument?.querySelector('canvas')??undefined;
          if(canvas?.dataset.capture==='waiting')break;
          if(canvas?.dataset.capture==='error')throw new Error('Frame replay bitmap/font rendering failed.');
          await wait(20);
        }
      }
      for(let index=cursor+1;index<=frame;index++){
        lifetime.signal.throwIfAborted();
        canvas!.dataset.capture='rendering';canvas!.dispatchEvent(new Event('capture-next'));
        if(canvas!.dataset.capture!=='ready'||canvas!.dataset.frame!==String(index))throw new Error('Frame replay failed.');
        cursor=index;
        if((index+1)%32===0)await wait(0);
      }
      const context=canvas!.getContext('2d');if(!context)throw new Error('Frame replay canvas unavailable.');
      const pixels=context.getImageData(0,0,width,height);
      if(performance.now()-started>=timeout)throw new Error('Frame replay timed out.');
      lifetime.signal.throwIfAborted();return pixels;
    }catch(error){dispose(error);throw error;}
    finally{clearTimeout(timer);lifetime.signal.removeEventListener('abort',stop);busy=false;}
  }};
}
