import type {IvfSettings} from './ivf';
import {prepareAvWebmChunks,type AvWebmPacket,type OpusTrackSettings} from './webm-av';
export interface AvWebmSink {
 write(chunk:Uint8Array,signal:AbortSignal):void|Promise<void>;
 abort(reason:unknown):void|Promise<void>;
}
export interface AvWebmSinkOptions {
 signal?:AbortSignal;timeoutMs?:number;maxBytes?:number;
 /** Original synchronous source admission, checked after preparation and at every write boundary. */
 validate?:()=>void;
}
/** Complete synchronous packet/layout preflight, then one provisional write at a
 * time. A successful exact byte receipt does not close or commit the destination.
 * Failure aborts the write signal, disposes retained output, and awaits captured
 * sink.abort; cleanup errors include the original failure. Sinks must discard
 * provisional bytes and prevent late writes after abort. Signals are advisory:
 * uncooperative writes/abort cleanup can outlive the deadline or delay rejection.
 * No native encoding, worker, project capture or editor integration occurs here.
 */
export async function writeAvWebmChunks(video:Omit<IvfSettings,'codec'>,audio:OpusTrackSettings,packets:readonly AvWebmPacket[],sink:AvWebmSink,options:AvWebmSinkOptions={}){
 const started=performance.now(),write=sink?.write,abortSink=sink?.abort;
 if(typeof write!=='function'||typeof abortSink!=='function')throw Error('Invalid AV WebM sink.');
 const scope=new AbortController();let signal:AbortSignal|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let prepared:ReturnType<typeof prepareAvWebmChunks>|undefined,failed=false,listening=false,reason:unknown;
 let rejectStop:(error:unknown)=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});void stopped.catch(()=>{});
 const fail=(error:unknown)=>{if(!failed){failed=true;reason=error;scope.abort(error);rejectStop(error);}};
 const abort=()=>fail(signal!.reason);
 const release=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}if(listening){signal!.removeEventListener('abort',abort);listening=false;}prepared?.dispose();prepared=undefined;};
 try{
  const {signal:originalSignal,timeoutMs=10000,maxBytes=128*1024*1024,validate}=options;
  if(originalSignal!==undefined&&!(originalSignal instanceof AbortSignal))throw Error('Invalid AV WebM cancellation signal.');
  signal=originalSignal;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>128*1024*1024||(validate!==undefined&&typeof validate!=='function'))throw Error('Invalid AV WebM sink options.');
  const check=()=>{if(!failed&&performance.now()-started>=timeoutMs)fail(Error('AV WebM sink timed out.'));if(failed)throw reason;};
  if(signal){signal.addEventListener('abort',abort,{once:true});listening=true;if(signal.aborted)abort();}check();
  timer=setTimeout(()=>fail(Error('AV WebM sink timed out.')),Math.max(1,Math.ceil(timeoutMs-(performance.now()-started))));
  // Complete private snapshots precede any caller validation/write callbacks.
  prepared=prepareAvWebmChunks(video,audio,packets,maxBytes);
  const active=()=>{check();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('AV WebM sink validation must be synchronous.');}check();};
  active();const {byteLength,frameCount,audioPacketCount,audioSampleCount,durationUs,rate,scale}=prepared;
  let bytesWritten=0,chunkCount=0;
  while(true){
   active();const chunk=prepared.next();check();if(!chunk)break;
   const length=chunk.length;
   if(length<1||length>65536||bytesWritten+length>byteLength)throw Error('Invalid AV WebM prepared chunk receipt.');
   // Capture length before handing ownership to a mutating/transferring sink.
   await Promise.race([Reflect.apply(write,sink,[chunk,scope.signal]),stopped]);
   active();bytesWritten+=length;chunkCount++;
  }
  if(bytesWritten!==byteLength)throw Error('Incomplete AV WebM sink receipt.');
  active();return Object.freeze({bytesWritten,byteLength,chunkCount,frameCount,audioPacketCount,audioSampleCount,durationUs,rate,scale});
 }catch(error){
  fail(error);release();
  try{await Reflect.apply(abortSink,sink,[reason]);}catch(cleanup){throw new AggregateError([reason,cleanup],'AV WebM delivery and sink abort failed.');}
  throw reason;
 }finally{release();}
}
