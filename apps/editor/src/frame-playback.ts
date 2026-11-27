import type { Project } from '@splash/document';
import { createFrameReplay } from './frame-replay';

/** Present every integer frame in order; slow rendering slows playback, never skips clocks. */
export async function playFrameRange(project:Project,start:number,end:number,options:{
  signal:AbortSignal; validate:()=>void; present:(pixels:ImageData,frame:number)=>void;
}):Promise<number>{
  const {signal,validate,present}=options;
  function active(){signal.throwIfAborted();validate();signal.throwIfAborted();}
  active();
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=project.duration||
      !Number.isFinite(project.fps)||project.fps<=0||project.fps>240)
    throw new Error('Choose a valid playback range and frame rate.');
  const replay=createFrameReplay(project,{signal});
  const interval=1000/project.fps;
  let count=0;
  try{
    for(let frame=start;frame<=end;frame++){
      active();const began=performance.now();
      const pixels=await replay.seek(frame);active();present(pixels,frame);active();count++;
      if(frame<end){
        const delay=Math.max(0,interval-(performance.now()-began));
        await new Promise<void>((resolve,reject)=>{
          const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason)};
          const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},delay);
          signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        });
      }
    }
    active();return count;
  }finally{replay.dispose();}
}
