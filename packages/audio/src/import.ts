import {id,validateProject,type Project,type AudioAsset} from '../../document/src';
import type {AudioAssetStore} from '../../document/src/storage';
import {decodePcm16WavAsync} from './wav-async';
import {audioImportFormat} from './import-formats';
export interface PreparedAudioImport {
 baseSignature:string;nextProject:Project;assetId:string;path:string;payload:Blob;
}
const admittedImports=new WeakMap<PreparedAudioImport,{signature:string;candidate:string;assetId:string;path:string;payload:Blob}>();
/** Once storage has been invoked, an error cannot promise that no asset was created. */
export class AudioImportPersistenceError extends Error {
 readonly assetMayExist=true;
 constructor(readonly path:string,cause:unknown){super(`Audio import was not published; an unreferenced asset may exist at ${path}.`,{cause});this.name='AudioImportPersistenceError';}
}
/** Persists only a genuine, unmodified preparation, once. Returns a detached candidate;
 * the caller must check baseSignature again when synchronously publishing through history.
 * Store errors/cancellation after write invocation are uncertain outcomes, never rollback.
 */
export async function persistAudioImport(prepared:PreparedAudioImport,store:Pick<AudioAssetStore,'writeNewAudio'>,current:()=>Project,signal?:AbortSignal){
 signal?.throwIfAborted();
 const admitted=admittedImports.get(prepared);
 if(!admitted)throw new Error('Audio import preparation is unknown or already consumed.');
 const check=()=>{
  signal?.throwIfAborted();
  if(prepared.baseSignature!==admitted.signature||prepared.assetId!==admitted.assetId||prepared.path!==admitted.path||prepared.payload!==admitted.payload||JSON.stringify(validateProject(prepared.nextProject))!==admitted.candidate)throw new Error('Audio import preparation changed.');
  if(JSON.stringify(validateProject(current()))!==admitted.signature)throw new Error('Audio import project changed.');
 };
 check();
 const bytes=new Uint8Array(await admitted.payload.arrayBuffer());
 check();
 // Another invocation may have consumed this preparation while bytes were loading.
 if(!admittedImports.delete(prepared))throw new Error('Audio import preparation is already consumed.');
 try{
  await store.writeNewAudio(admitted.path,bytes,signal);
  check();
  return {baseSignature:admitted.signature,path:admitted.path,nextProject:validateProject(JSON.parse(admitted.candidate))};
 }catch(cause){throw new AudioImportPersistenceError(admitted.path,cause);}
}
export interface AudioImportOptions {
 signal?:AbortSignal;timeoutMs?:number;
 /** Omit to import only the asset. No implicit clip or playback is created. */
 clip?:{startFrame:number;offsetSamples:number;gain:number};
}
/** Prepares an immutable WAV payload and detached candidate document. No writes or live
 * mutations. Caller must verify baseSignature and persist the payload before publishing.
 */
export async function prepareAudioImport(project:Project,file:Blob,name:string,options:AudioImportOptions={}){
 const {signal,timeoutMs=10000}=options;signal?.throwIfAborted();
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid audio import deadline.');
 const candidate=validateProject(project),baseSignature=JSON.stringify(candidate);
 if(typeof name!=='string'||!name.length||name.length>200)throw new Error('Invalid audio asset name.');
 if(candidate.assets.length>=10000)throw new Error('Audio import exceeds asset count.');
 const clip=options.clip===undefined?undefined:{...options.clip};
 if(clip&&(!Number.isSafeInteger(clip.startFrame)||clip.startFrame<0||clip.startFrame>=candidate.duration||!Number.isSafeInteger(clip.offsetSamples)||clip.offsetSamples<0||!Number.isFinite(clip.gain)||Math.abs(clip.gain)>16))throw new Error('Invalid imported audio clip.');
 if(clip&&(candidate.audioClips?.length??0)>=10000)throw new Error('Audio import exceeds clip count.');
 const remainingPcm=128*1024*1024-candidate.assets.reduce((sum,a)=>sum+(a.audio?a.audio.frames*a.audio.channels*4:0),0);
 if(remainingPcm<4)throw new Error('Audio project PCM budget exhausted.');
 const size=file.size;
 if(!Number.isSafeInteger(size)||size<12||size>64*1024*1024)throw new Error('Audio import requires a file between 12 bytes and 64 MiB.');
 const format=audioImportFormat(name);
 const controller=new AbortController(),deadline=Date.now()+timeoutMs;
 const abort=()=>controller.abort(signal?.reason??new DOMException('Audio import cancelled.','AbortError'));
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new Error('Audio import timed out.')),timeoutMs);
 const wait=<T>(work:Promise<T>)=>new Promise<T>((resolve,reject)=>{
  const stop=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});
  work.then(value=>{controller.signal.removeEventListener('abort',stop);if(controller.signal.aborted)reject(controller.signal.reason);else resolve(value);},error=>{controller.signal.removeEventListener('abort',stop);reject(error);});
  if(controller.signal.aborted)stop();
 });
 try{
  if(signal?.aborted)abort();controller.signal.throwIfAborted();
  const buffer=await wait(file.arrayBuffer());
  if(buffer.byteLength!==size)throw new Error('Audio import file size changed.');
  let preparedAudio:{payload:Blob;sampleRate:number;channels:1|2;frames:number};
  if(format==='mp3'||format==='opus'){
   const {transcodeCompressedAudio}=await wait(import('./compressed-audio-async'));
   // Do not transfer a caller's retained input buffer.
   preparedAudio=await wait(transcodeCompressedAudio(buffer.slice(0),format,remainingPcm,deadline,controller.signal));
  }else{
   // Blob snapshots bytes independently of a loader's retained ArrayBuffer.
   const payload=new Blob([buffer],{type:'audio/wav'});
   const bytes=new Uint8Array(await wait(payload.arrayBuffer()));
   const left=deadline-Date.now();if(left<1)throw new Error('Audio import timed out.');
   const decoded=await wait(decodePcm16WavAsync(bytes,{signal:controller.signal,timeoutMs:left,maxPcmBytes:remainingPcm}));
   preparedAudio={payload,sampleRate:decoded.sampleRate,channels:decoded.channels.length as 1|2,frames:decoded.frames};
  }
  const {payload,sampleRate,channels,frames}=preparedAudio;
  const assetId=id(),path=`assets/audio/${assetId}.wav`;
  const audio:AudioAsset={name,format:'pcm16-wav',sampleRate,channels,frames};
  candidate.assets.push({id:assetId,path,audio});
  if(clip)candidate.audioClips=[...(candidate.audioClips??[]),{id:id(),assetId,...clip}];
  const nextProject=validateProject(candidate);controller.signal.throwIfAborted();
  if(Date.now()>=deadline)throw new Error('Audio import timed out.');
  const prepared={baseSignature,nextProject,assetId,path,payload};
  admittedImports.set(prepared,{signature:baseSignature,candidate:JSON.stringify(nextProject),assetId,path,payload});
  return prepared;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
