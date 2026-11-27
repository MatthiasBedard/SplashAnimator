import type {decodePcm16Wav,WavDecodeOptions} from './wav';
export interface WavWorkerOptions extends WavDecodeOptions {signal?:AbortSignal;timeoutMs?:number}
type WavResult=ReturnType<typeof decodePcm16Wav>;
/** Copies only the admitted view into an owned buffer, then transfers that snapshot to a
 * disposable trusted worker. Caller buffers never detach. Copy and output scans are synchronous.
 */
export async function decodePcm16WavAsync(bytes:Uint8Array,job:WavWorkerOptions={}):Promise<WavResult>{
  const {signal,timeoutMs=10000,maxInputBytes=64*1024*1024,maxPcmBytes=128*1024*1024,maxChunks=10000}=job;
  signal?.throwIfAborted();
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid WAV worker deadline.');
  for(const [value,limit] of [[maxInputBytes,64*1024*1024],[maxPcmBytes,128*1024*1024],[maxChunks,10000]])
    if(!Number.isSafeInteger(value)||value<1||value>limit)throw new Error('Invalid WAV worker budget.');
  const tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)!.get!;
  const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
  if(tag.call(bytes)!=='Uint8Array'||bytes.length<12||bytes.length>maxInputBytes)throw new Error('Invalid or oversized WAV input.');
  try{bufferLength.call(bytes.buffer);}catch{throw new Error('WAV input must use a nonshared buffer.');}
  const snapshot=new Uint8Array(bytes.length);snapshot.set(bytes);
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,finished=false;
    const finish=(error?:unknown,result?:WavResult)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      if(error!==undefined)reject(error);else resolve(result!);
    };
    const abort=()=>finish(signal?.reason??new DOMException('WAV decoding cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('WAV decoding timed out.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      worker=new Worker(new URL('./wav-worker.ts',import.meta.url),{type:'module',name:'Splash WAV decoder'});
      worker.onmessage=event=>{
        try{
          const value=event.data;
          if(value?.ok!==true)throw new Error(typeof value?.error==='string'?value.error.slice(0,2000):'Invalid WAV worker response.');
          const result=value.result as WavResult;
          if(!result||!Number.isInteger(result.sampleRate)||result.sampleRate<8000||result.sampleRate>192000||!Number.isSafeInteger(result.frames)||result.frames<1||
            !Array.isArray(result.channels)||(result.channels.length!==1&&result.channels.length!==2)||result.frames*result.channels.length*4>maxPcmBytes)
            throw new Error('Invalid WAV worker output.');
          for(const channel of result.channels){
            if(!(channel instanceof Float32Array)||channel.length!==result.frames||channel.byteOffset!==0||bufferLength.call(channel.buffer)!==channel.byteLength)throw new Error('Invalid WAV worker channel.');
            for(const sample of channel)if(!Number.isFinite(sample)||sample< -1||sample>32767/32768)throw new Error('Invalid WAV worker samples.');
          }
          finish(undefined,result);
        }catch(error){finish(error);}
      };
      worker.onerror=event=>{event.preventDefault();finish(new Error('WAV decoder worker failed.'));};
      worker.onmessageerror=()=>finish(new Error('WAV worker response could not be read.'));
      if(signal?.aborted){abort();return;}
      worker.postMessage({bytes:snapshot,options:{maxInputBytes,maxPcmBytes,maxChunks}},[snapshot.buffer]);
    }catch(error){finish(error);}
  });
}
