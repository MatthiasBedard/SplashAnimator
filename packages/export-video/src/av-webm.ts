import {encodeOpus,type OpusNative} from './opus';
import {openVp8PacketEncoder,prepareVp8PacketSettings,type Vp8PacketSettings,type Vp8Native} from './vp8-packets';
import {createAvWebmWriter,type AvWebmPacket} from './webm-av';
import {writeAvWebmChunks,type AvWebmSink,type AvWebmSinkOptions} from './webm-av-sink';
import type {Vp8Options} from './vp8';
export interface AvNative {audio:OpusNative;video:Vp8Native}
export type AvFrameSource=(index:number,signal:AbortSignal)=>Uint8Array|Promise<Uint8Array>;
type AudioPackets=Awaited<ReturnType<typeof encodeOpus>>;
type VideoPackets=ReturnType<ReturnType<typeof openVp8PacketEncoder>['finish']>;
type AvBatch={video:ReturnType<typeof prepareVp8PacketSettings>;audio:AudioPackets;frames:VideoPackets;packets:AvWebmPacket[];signal:AbortSignal;maxBytes:number;check:()=>void;remaining:()=>number};
/** Private shared codec lifetime. No joined container is created by this stage. */
async function withAvPackets<T>(settings:Vp8PacketSettings,channels:readonly Float32Array[],audioBitrate:number,readFrame:AvFrameSource,options:Vp8Options,native:AvNative|undefined,deliver:(batch:AvBatch)=>T|Promise<T>,validate?:()=>void,started=performance.now()){
 const {signal,timeoutMs=10000,maxBytes=128*1024*1024}=options;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof readFrame!=='function'||(validate!==undefined&&typeof validate!=='function'))throw Error('Invalid AV deadline, validation or frame source.');
 const video=prepareVp8PacketSettings(settings,maxBytes);
 const {audio:audioSource,video:videoSource}=native??{audio:{Encoder:globalThis.AudioEncoder,Data:globalThis.AudioData},video:{Encoder:globalThis.VideoEncoder,Frame:globalThis.VideoFrame}};
 const audioNative={Encoder:audioSource.Encoder,Data:audioSource.Data},videoNative={Encoder:videoSource.Encoder,Frame:videoSource.Frame};
 if(typeof audioNative.Encoder!=='function'||typeof audioNative.Data!=='function'||typeof videoNative.Encoder!=='function'||typeof videoNative.Frame!=='function')throw Error('WebCodecs AV encoding is unavailable.');
 const scope=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,host:ReturnType<typeof openVp8PacketEncoder>|undefined;
 let audio:AudioPackets|undefined,frames:VideoPackets|undefined,delivering=false;
 const packets:AvWebmPacket[]=[];
 let rejectFailure:(e:unknown)=>void=()=>{};const failed=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failed.catch(()=>{});
 const stop=(reason:unknown)=>{if(!scope.signal.aborted){scope.abort(reason??Error('AV encoding cancelled.'));rejectFailure(scope.signal.reason);}};
 const abort=()=>stop(signal?.reason??Error('AV encoding cancelled.'));
 const check=(admit=true)=>{if(performance.now()-started>=timeoutMs)stop(Error('AV encoding timed out.'));scope.signal.throwIfAborted();if(admit){const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('AV encoding validation must be synchronous.');}if(performance.now()-started>=timeoutMs)stop(Error('AV encoding timed out.'));scope.signal.throwIfAborted();}};
 const remaining=()=>{check();return Math.max(1,Math.ceil(timeoutMs-(performance.now()-started)));};
 try{
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();check(false);timer=setTimeout(()=>stop(Error('AV encoding timed out.')),Math.max(1,Math.ceil(timeoutMs-(performance.now()-started))));
  // Snapshot PCM before caller validation or awaiting native capability support.
  const audioLimit=maxBytes-257*video.frameCount;
  const preparing=encodeOpus(channels,audioBitrate,{signal:scope.signal,timeoutMs:Math.max(1,Math.ceil(timeoutMs-(performance.now()-started))),maxBytes:audioLimit},audioNative);void preparing.catch(()=>{});check();
  audio=await Promise.race([preparing,failed]);check();
  const videoLimit=maxBytes-audio.byteLength-256*audio.track.packetCount;
  host=openVp8PacketEncoder(video,{signal:scope.signal,timeoutMs:remaining(),maxBytes:videoLimit},videoNative);check();
  for(let i=0;i<video.frameCount;i++){
   check();const next=readFrame(i,scope.signal);check();
   if(next instanceof Uint8Array)await Promise.race([host.append(next),failed]);
   else await Promise.race([Promise.resolve(next).then(rgba=>{check();return host!.append(rgba);}),failed]);check();
  }
  frames=host.finish();check();
  if(1024+256*(video.frameCount+audio.track.packetCount)+frames.byteLength+audio.byteLength>maxBytes)throw Error('Combined AV output exceeds byte budget.');
  let vi=0,ai=0;
  while(vi<frames.packets.length||ai<audio.packets.length){
   check();if(vi<frames.packets.length&&(ai===audio.packets.length||frames.packets[vi].timestampUs<=audio.packets[ai].timestampUs)){const p=frames.packets[vi++];packets.push({kind:'video',bytes:p.bytes,keyFrame:p.keyFrame});}else{const p=audio.packets[ai++];packets.push({kind:'audio',bytes:p.bytes,durationSamples:p.durationSamples});}
  }
  // Sink delivery owns awaited abort cleanup; never race it against failed.
  delivering=true;const result=await deliver({video,audio,frames,packets,signal:scope.signal,maxBytes,check,remaining});check();return result;
 }catch(e){stop(e);if(delivering||e instanceof AggregateError)throw e;throw scope.signal.reason??e;}
 finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);host?.dispose();if(audio)audio.packets.length=0;if(frames)frames.packets.length=0;packets.length=0;}
}
/** Existing complete-only AV API. Silent exports and complete WebM bytes stay exact. */
export function encodeAvWebm(settings:Vp8PacketSettings,channels:readonly Float32Array[],audioBitrate:number,readFrame:AvFrameSource,options:Vp8Options={},native?:AvNative){
 return withAvPackets(settings,channels,audioBitrate,readFrame,options,native,({video,audio,frames,packets,maxBytes,check})=>{
  const mux=createAvWebmWriter(video,audio.track,maxBytes);
  try{for(const p of packets){check();if(p.kind==='video')mux.appendVideo(p.bytes,p.keyFrame);else mux.appendAudio(p.bytes,p.durationSamples);}const receipt=mux.finish();check();return {...receipt,keyFrames:frames.keyFrames,deltaFrames:frames.deltaFrames,audioTrack:{...audio.track},audioInputSampleCount:audio.inputSampleCount};}
  catch(e){try{mux.abort();}catch{/* completed or rejected writer */}throw e;}
 });
}
/** Explicit native AV to provisional chunks. Complete encoded packets remain
 * retained, but no joined container is allocated. One deadline includes codecs
 * and serial writes. Caller owns source consistency and final sink commit. */
export async function encodeAvWebmToSink(settings:Vp8PacketSettings,channels:readonly Float32Array[],audioBitrate:number,readFrame:AvFrameSource,sink:AvWebmSink,options:AvWebmSinkOptions={},native?:AvNative){
 const started=performance.now(),write=sink?.write,abort=sink?.abort;
 if(typeof write!=='function'||typeof abort!=='function')throw Error('Invalid AV WebM sink.');
 let cleanup:Promise<void>|undefined;
 const abortSink=(reason:unknown)=>{if(!cleanup){cleanup=Promise.resolve().then(()=>Reflect.apply(abort,sink,[reason]));void cleanup.catch(()=>{});}return cleanup;};
 try{
  const {signal,timeoutMs=10000,maxBytes=128*1024*1024,validate}=options;
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Invalid AV WebM cancellation signal.');
  return await withAvPackets(settings,channels,audioBitrate,readFrame,{signal,timeoutMs,maxBytes},native,async({video,audio,frames,packets,signal,maxBytes,check,remaining})=>{
   const receipt=await writeAvWebmChunks(video,audio.track,packets,{write:(chunk,writeSignal)=>Reflect.apply(write,sink,[chunk,writeSignal]),abort:abortSink},{signal,timeoutMs:remaining(),maxBytes,validate:check});check();
   return Object.freeze({...receipt,keyFrames:frames.keyFrames,deltaFrames:frames.deltaFrames,audioTrack:Object.freeze({...audio.track}),audioInputSampleCount:audio.inputSampleCount});
  },validate,started);
 }catch(e){
  if(cleanup){try{await cleanup;}catch{/* delivery already includes cleanup failure */}throw e;}
  try{await abortSink(e);}catch(error){throw new AggregateError([e,error],'AV encoding and sink abort failed.');}throw e;
 }
}
