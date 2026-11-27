import type {WavEncodeOptions} from './wav-encode';
export interface WavEncodeWorkerOptions extends WavEncodeOptions {signal?:AbortSignal;timeoutMs?:number;clampDecoded?:boolean}
/** Copies admitted views, not entire backing buffers. Copies and output header checks are
 * synchronous; the shared deadline is checked after copying. Callers retain their buffers. */
export async function encodePcm16WavAsync(channels:readonly Float32Array[],sampleRate:number,job:WavEncodeWorkerOptions={}):Promise<Uint8Array>{
 const {signal,timeoutMs=10000,maxBytes=64*1024*1024,clampDecoded=false}=job,deadline=Date.now()+timeoutMs;
 signal?.throwIfAborted();
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid WAV encoding deadline.');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!Number.isSafeInteger(maxBytes)||maxBytes<44||maxBytes>64*1024*1024)throw new Error('Invalid WAV encoding options.');
 if(!Array.isArray(channels)||channels.length<1||channels.length>2)throw new Error('Invalid WAV channels.');
 const sources=[...channels],tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!,bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
 let frames=0;
 for(const source of sources){if(tag.call(source)!=='Float32Array'||!source.length||(frames&&frames!==source.length))throw new Error('Invalid WAV channel lengths.');bufferLength.call(source.buffer);frames=source.length;}
 const size=44+frames*sources.length*2;
 if(!Number.isSafeInteger(size)||size>maxBytes)throw new Error('WAV output exceeds byte budget.');
 const snapshots=sources.map(source=>new Float32Array(source));
 signal?.throwIfAborted();const left=deadline-Date.now();if(left<1)throw new Error('WAV encoding timed out.');
 return new Promise((resolve,reject)=>{
  let worker:Worker|undefined,finished=false;
  const finish=(error?:unknown,bytes?:Uint8Array)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}if(error!==undefined)reject(error);else resolve(bytes!);};
  const abort=()=>finish(signal?.reason??new DOMException('WAV encoding cancelled.','AbortError'));
  const timer=setTimeout(()=>finish(new Error('WAV encoding timed out.')),left);signal?.addEventListener('abort',abort,{once:true});
  try{
   worker=new Worker(new URL('./wav-encode-worker.ts',import.meta.url),{type:'module',name:'Splash WAV encoder'});
   worker.onmessage=event=>{try{
    if(event.data?.ok!==true)throw new Error(typeof event.data?.error==='string'?event.data.error.slice(0,2000):'Invalid WAV encoding response.');
    const bytes=event.data.bytes;
    if(tag.call(bytes)!=='Uint8Array'||bytes.byteOffset!==0||bytes.byteLength!==size||bufferLength.call(bytes.buffer)!==size)throw new Error('Invalid WAV encoding output.');
    const view=new DataView(bytes.buffer),text=(at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));
    if(text(0,4)!=='RIFF'||text(8,8)!=='WAVEfmt '||text(36,4)!=='data'||view.getUint32(4,true)!==size-8||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(22,true)!==sources.length||view.getUint32(24,true)!==sampleRate||view.getUint32(28,true)!==sampleRate*sources.length*2||view.getUint16(32,true)!==sources.length*2||view.getUint16(34,true)!==16||view.getUint32(40,true)!==size-44)throw new Error('Invalid WAV encoding header.');
    if(Date.now()>=deadline)throw new Error('WAV encoding timed out.');finish(undefined,bytes);
   }catch(error){finish(error);}};
   worker.onerror=e=>{e.preventDefault();finish(new Error('WAV encoder worker failed.'));};worker.onmessageerror=()=>finish(new Error('Unreadable WAV encoder response.'));
   if(signal?.aborted){abort();return;}worker.postMessage({channels:snapshots,sampleRate,options:{maxBytes},clampDecoded},snapshots.map(c=>c.buffer));
  }catch(error){finish(error);}
 });
}
