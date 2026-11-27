import {validateProject,type Project} from '../../../packages/document/src';
import {prepareProjectAudio} from '../../../packages/audio/src/project-preview';
import {audioSampleRange} from '../../../packages/audio/src/pcm';
import {encodeAvWebm,encodeAvWebmToSink,type AvFrameSource,type AvNative} from '../../../packages/export-video/src/av-webm';
import type {AvWebmSink} from '../../../packages/export-video/src/webm-av-sink';
import type {Vp8PacketSettings} from '../../../packages/export-video/src/vp8-packets';
import type {Vp8Options} from '../../../packages/export-video/src/vp8';
import {createVideoFrameReplay} from './video-frame-replay';
import {prepareRememberedVideoProject} from './remembered-video';
import {videoCaptureSettings,type VideoCaptureOptions} from './video-settings';
export interface AvCaptureOptions extends VideoCaptureOptions {audioBitrate?:number;audioChannels?:1|2;remembered?:boolean;validate?:()=>void}
type ProjectAvBatch={settings:Vp8PacketSettings;channels:readonly Float32Array[];audioBitrate:number;readFrame:AvFrameSource;options:Vp8Options;native:AvNative;active:()=>void;abort:(reason:unknown)=>Promise<void>};
/** Shared detached project/WAV/replay lifetime. Delivery chooses complete bytes
 * or provisional chunks; no complete export is called by the sink path. */
async function withProjectAvCapture<T extends object>(project:Project,load:(path:string,signal:AbortSignal)=>Promise<Blob>,signal:AbortSignal,options:AvCaptureOptions,deliver:(batch:ProjectAvBatch)=>Promise<T>,ownsDeliveryCleanup=false,begun=performance.now()){
 const {range,bitrate,keyFrameInterval,timeoutMs,maxBytes,progress,audioBitrate=128000,audioChannels,remembered=false,validate}=options;
 const capturedRange=range===undefined?undefined:{start:range?.start,end:range?.end};
 if((range!==undefined&&(!range||typeof range!=='object'))||typeof load!=='function'||typeof remembered!=='boolean'||(audioChannels!==undefined&&audioChannels!==1&&audioChannels!==2)||!Number.isSafeInteger(audioBitrate)||audioBitrate<6000||audioBitrate>510000||(validate!==undefined&&typeof validate!=='function')||(progress!==undefined&&typeof progress!=='function'))throw Error('Invalid project AV options.');
 const native={audio:{Encoder:globalThis.AudioEncoder,Data:globalThis.AudioData},video:{Encoder:globalThis.VideoEncoder,Frame:globalThis.VideoFrame}};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,replay:Awaited<ReturnType<typeof createVideoFrameReplay>>|undefined;
 const disposeReplay=async()=>{const owned=replay;replay=undefined;await owned?.dispose();};
 const abort=()=>controller.abort(signal.reason??Error('Project AV capture cancelled.'));
 const active=()=>{controller.signal.throwIfAborted();if(timer!==undefined&&performance.now()-begun>=capture.timeoutMs)controller.abort(Error('Project AV capture timed out.'));controller.signal.throwIfAborted();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('Project AV validation must be synchronous.');}if(timer!==undefined&&performance.now()-begun>=capture.timeoutMs)controller.abort(Error('Project AV capture timed out.'));controller.signal.throwIfAborted();};
 signal.throwIfAborted();const snapshot=validateProject(project),capture=videoCaptureSettings(snapshot,'webm',{range:capturedRange as VideoCaptureOptions['range'],bitrate,keyFrameInterval,timeoutMs,maxBytes,progress});
 if(!snapshot.audioClips?.length)throw Error('Project has no audio clips for AV capture.');
 if(typeof native.audio.Encoder!=='function'||typeof native.audio.Data!=='function'||typeof native.video.Encoder!=='function'||typeof native.video.Frame!=='function')throw Error('WebCodecs AV encoding is unavailable.');
 const remaining=()=>{active();return Math.max(1,Math.ceil(capture.timeoutMs-(performance.now()-begun)));};
 let stop:(e:unknown)=>void=()=>{};const stopped=new Promise<never>((_,reject)=>{stop=reject;});void stopped.catch(()=>{});const reject=()=>stop(controller.signal.reason);
 try{
  signal.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',reject,{once:true});if(signal.aborted)abort();timer=setTimeout(()=>controller.abort(Error('Project AV capture timed out.')),remaining());active();
  const frames=remembered?await Promise.race([prepareRememberedVideoProject(snapshot,'webm',{range:capturedRange as VideoCaptureOptions['range'],bitrate,keyFrameInterval,maxBytes},{signal:controller.signal,validate:active}),stopped]):snapshot;active();
  const opening=createVideoFrameReplay(frames,{start:capture.start,end:capture.end},{signal:controller.signal,timeoutMs:remaining(),validate:active});
  replay=opening instanceof Promise?await Promise.race([opening,stopped]):opening;active();
  const mixed=await Promise.race([prepareProjectAudio(snapshot,async(path,scope)=>{active();const blob=await Promise.race([load(path,scope),stopped]);active();return blob;},{signal:controller.signal,timeoutMs:remaining(),startFrame:capture.start,endFrame:capture.end+1,sampleRate:48000,channelCount:audioChannels}),stopped]);active();
  const expected=audioSampleRange(capture.start,capture.end+1,snapshot.fps,48000);
  if(mixed.sampleRate!==48000||mixed.startSample!==expected.start||mixed.endSample!==expected.end||mixed.channels.some(c=>c.length!==expected.end-expected.start))throw Error('Project AV mixed audio timing changed.');
  const delivery=deliver({settings:{width:capture.width,height:capture.height,frameCount:capture.count,rate:capture.rate,scale:capture.scale,bitrate:capture.bitrate,keyFrameInterval:capture.keyFrameInterval},channels:mixed.channels,audioBitrate,readFrame:async(index)=>{
   active();const image=await replay!.seek(capture.start+index);active();progress?.(index+1,capture.count);active();return new Uint8Array(image.data);
  },options:{signal:controller.signal,timeoutMs:remaining(),maxBytes:capture.maxBytes},native,active,abort:async(reason)=>{controller.abort(reason);if(timer!==undefined){clearTimeout(timer);timer=undefined;}await disposeReplay();}});
  // The sink branch must await delivery's abort cleanup, even after our deadline.
  const result=ownsDeliveryCleanup?await delivery:await Promise.race([delivery,stopped]);active();
  return {...result,start:capture.start,end:capture.end,width:capture.width,height:capture.height,remembered,audioStartSample:expected.start,audioEndSample:expected.end,audioPeak:mixed.peak,audioClippedSamples:mixed.clippedSamples,resampling:mixed.resampling};
 }finally{if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',reject);controller.abort();await disposeReplay();}
}

/** Existing complete-only capture: no edits/downloads/scripts or silent fallback. */
export function exportProjectAvWebm(project:Project,load:(path:string,signal:AbortSignal)=>Promise<Blob>,signal:AbortSignal,options:AvCaptureOptions={}){
 return withProjectAvCapture(project,load,signal,options,({settings,channels,audioBitrate,readFrame,options,native})=>encodeAvWebm(settings,channels,audioBitrate,readFrame,options,native));
}
/** Explicit detached capture to a provisional sink. Original range/WAV/mix/replay
 * and native dependencies snapshot before async loading. Receipt never commits;
 * callers must perform final source admission and commit a transactional sink.
 * Cleanup may outlive the deadline when a destination ignores cancellation. */
export async function exportProjectAvWebmToSink(project:Project,load:(path:string,signal:AbortSignal)=>Promise<Blob>,signal:AbortSignal,sink:AvWebmSink,options:AvCaptureOptions={}){
 const begun=performance.now(),write=sink?.write,abort=sink?.abort;
 if(typeof write!=='function'||typeof abort!=='function')throw Error('Invalid project AV sink.');
 let cleanup:Promise<void>|undefined,stopCapture:((reason:unknown)=>Promise<void>)|undefined;
 const abortSink=(reason:unknown)=>{
  if(!cleanup){
   cleanup=Promise.resolve().then(async()=>{
    try{await stopCapture?.(reason);}
    finally{await Reflect.apply(abort,sink,[reason]);}
   });
   void cleanup.catch(()=>{});
  }
  return cleanup;
 };
 try{
  if(!(signal instanceof AbortSignal))throw Error('Invalid project AV cancellation signal.');
  return await withProjectAvCapture(project,load,signal,options,({settings,channels,audioBitrate,readFrame,options,native,active,abort})=>{stopCapture=abort;return encodeAvWebmToSink(settings,channels,audioBitrate,readFrame,{write:(chunk,scope)=>Reflect.apply(write,sink,[chunk,scope]),abort:abortSink},{...options,validate:active},native);},true,begun);
 }catch(e){
  if(cleanup){try{await cleanup;}catch{/* codec/sink delivery already includes cleanup failure */}throw e;}
  try{await abortSink(e);}catch(error){throw new AggregateError([e,error],'Project AV capture and sink abort failed.');}throw e;
 }
}
