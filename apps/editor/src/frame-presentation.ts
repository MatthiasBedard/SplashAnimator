import type {Project} from '@splash/document';
import {createFrameReplay} from './frame-replay';

/** Owns one replay session and at most one queued target, never a frame queue. */
export function createFramePresentation(project:Project,publish:(frame:number,pixels:ImageData)=>void,onError:(error:unknown)=>void){
  const duration=project.duration,replay=createFrameReplay(project);
  let target:number|undefined,lastPublished:number|undefined,running=false,disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;target=undefined;replay.dispose();};
  const drain=async()=>{
    running=true;
    try{
      while(!disposed&&target!==undefined){
        const frame=target;
        const pixels=await replay.seek(frame);
        if(disposed)return;
        // A newer clock position or seek supersedes this completed render.
        if(target!==frame)continue;
        target=undefined;lastPublished=frame;
        publish(frame,pixels);
      }
    }catch(error){
      if(!disposed){dispose();onError(error);}
    }finally{running=false;}
  };
  return {dispose,request(frame:number){
    if(disposed)throw new Error('Frame presentation is disposed.');
    if(!Number.isSafeInteger(frame)||frame<0||frame>=duration)throw new Error('Invalid presentation frame.');
    if(target===frame||(!running&&lastPublished===frame))return;
    target=frame;
    // Consumers report failures synchronously; contain a throwing error callback too.
    if(!running)void drain().catch(()=>{});
  }};
}
