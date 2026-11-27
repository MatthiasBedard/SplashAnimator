import type {Project} from '@splash/document';
import {openVp8Encoder} from '../../../packages/export-video/src/vp8';
import {createVideoFrameReplay} from './video-frame-replay';

export {videoTimebase} from './video-settings';
export type {VideoCaptureOptions} from './video-settings';
import {videoCaptureSettings,type VideoCaptureOptions} from './video-settings';

type Vp8CaptureOptions = VideoCaptureOptions & { validate?: () => void };

export function exportIVF(project:Project,signal:AbortSignal,options:Vp8CaptureOptions={}){return exportVideo(project,signal,'ivf',options);}
export function exportWebM(project:Project,signal:AbortSignal,options:Vp8CaptureOptions={}){return exportVideo(project,signal,'webm',options);}
/** Detached, script-free full or inclusive-range VP8 capture. No download side effects. */
async function exportVideo(project:Project,signal:AbortSignal,container:'ivf'|'webm',options:Vp8CaptureOptions){
 signal.throwIfAborted();
 const {validate}=options;
 const {bitrate,keyFrameInterval,timeoutMs,maxBytes,progress,start,end,count,width,height,rate,scale}=videoCaptureSettings(project,container,options);
 const begun=performance.now(),controller=new AbortController();
 const abort=()=>controller.abort(signal.reason??new Error('Video export cancelled.'));
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new Error('Video export timed out.')),timeoutMs);
 const deadline=()=>{if(performance.now()-begun>=timeoutMs)controller.abort(new Error('Video export timed out.'));controller.signal.throwIfAborted();};
 const check=()=>{deadline();validate?.();deadline();};
 let encoder:ReturnType<typeof openVp8Encoder>|undefined,replay:Awaited<ReturnType<typeof createVideoFrameReplay>>|undefined;
 try{
  check();
  encoder=openVp8Encoder({width,height,frameCount:count,rate,scale,bitrate,keyFrameInterval,container},{signal:controller.signal,timeoutMs,maxBytes});
  // Compilation snapshots project artwork before the first await. Skipped root
  // frames still advance nested movie clocks, with button Up and scripts inert.
  replay=await createVideoFrameReplay(project,{start,end},{signal:controller.signal,timeoutMs,validate:check});check();
  for(let frame=start;frame<=end;frame++){
   const image=await replay.seek(frame);check();
   await encoder.append(new Uint8Array(image.data));check();
   progress?.(frame-start+1,count);check();
  }
  const result=encoder.finish();check();return {...result,start,end,width,height};
 }finally{encoder?.dispose();clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();await replay?.dispose();}
}
