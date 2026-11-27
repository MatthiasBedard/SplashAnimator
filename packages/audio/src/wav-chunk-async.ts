import type {WavChunkOptions} from './wav-encode';
export interface WavStreamOptions extends WavChunkOptions {timeoutMs?:number}
export interface WavStreamReceipt {bytesWritten:number;frames:number;sampleRate:number;channelCount:number}
/** Copies admitted input views into the worker; acknowledges one validated owned chunk
 * only after the sink settles. Provisional output must be discarded on rejection. The
 * sink receives a job signal but uncooperative sink work can outlive cancellation. */
export async function streamPcm16Wav(channels:readonly Float32Array[],sampleRate:number,write:(bytes:Uint8Array,signal:AbortSignal)=>void|Promise<void>,job:WavStreamOptions={}):Promise<WavStreamReceipt>{
 const {signal,timeoutMs=10000,maxBytes=64*1024*1024,chunkFrames=16384}=job,deadline=Date.now()+timeoutMs;
 signal?.throwIfAborted();
 if(typeof write!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(chunkFrames)||chunkFrames<1||chunkFrames>16384)throw new Error('Invalid WAV stream options.');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!Number.isSafeInteger(maxBytes)||maxBytes<44||maxBytes>64*1024*1024)throw new Error('Invalid WAV encoding options.');
 if(!Array.isArray(channels)||channels.length<1||channels.length>2)throw new Error('Invalid WAV channels.');
 const sources=[...channels],count=sources.length,tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!,bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
 let frames=0;
 for(const source of sources){if(tag.call(source)!=='Float32Array'||!source.length||(frames&&frames!==source.length))throw new Error('Invalid WAV channel lengths.');bufferLength.call(source.buffer);frames=source.length;}
 const total=44+frames*count*2;
 if(!Number.isSafeInteger(total)||total>maxBytes)throw new Error('WAV output exceeds byte budget.');
 const snapshots=sources.map(source=>new Float32Array(source));
 signal?.throwIfAborted();const left=deadline-Date.now();if(left<1)throw new Error('WAV encoding timed out.');
 return new Promise((resolve,reject)=>{
  let worker:Worker|undefined,finished=false,busy=false,sequence=0,written=0;
  const sinkController=new AbortController();
  const finish=(error?:unknown)=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
   if(error!==undefined){sinkController.abort(error);reject(error);}else resolve({bytesWritten:written,frames,sampleRate,channelCount:count});
  };
  const abort=()=>finish(signal?.reason??new Error('WAV stream cancelled.'));
  const timer=setTimeout(()=>finish(new Error('WAV encoding timed out.')),left);signal?.addEventListener('abort',abort,{once:true});
  const active=()=>{if(Date.now()>=deadline)throw new Error('WAV encoding timed out.');sinkController.signal.throwIfAborted();};
  try{
   worker=new Worker(new URL('./wav-chunk-worker.ts',import.meta.url),{type:'module',name:'Splash WAV stream'});
   worker.onmessage=event=>{
    if(finished)return;
    void (async()=>{
     try{
      active();if(busy)throw new Error('Unsolicited WAV chunk response.');
      const message=event.data;
      if(message?.type==='error')throw new Error(typeof message.error==='string'?message.error.slice(0,2000):'WAV worker failed.');
      if(message?.sequence!==sequence)throw new Error('Invalid WAV chunk sequence.');
      if(message.type==='done'){
       const receipt=message.receipt;
       if(written!==total||!receipt||receipt.bytesWritten!==total||receipt.frames!==frames||receipt.sampleRate!==sampleRate||receipt.channelCount!==count)throw new Error('Invalid WAV completion receipt.');
       finish();return;
      }
      if(message.type!=='chunk'||written>=total)throw new Error('Invalid WAV chunk response.');
      const bytes=message.bytes,expected=sequence===0?44:Math.min(chunkFrames*count*2,total-written);
      if(tag.call(bytes)!=='Uint8Array'||bytes.byteOffset!==0||bytes.byteLength!==expected||bufferLength.call(bytes.buffer)!==expected)throw new Error('Invalid WAV chunk envelope.');
      if(sequence===0){
       const view=new DataView(bytes.buffer),text=(at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));
       if(text(0,4)!=='RIFF'||text(8,8)!=='WAVEfmt '||text(36,4)!=='data'||view.getUint32(4,true)!==total-8||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(22,true)!==count||view.getUint32(24,true)!==sampleRate||view.getUint32(28,true)!==sampleRate*count*2||view.getUint16(32,true)!==count*2||view.getUint16(34,true)!==16||view.getUint32(40,true)!==total-44)throw new Error('Invalid WAV encoding header.');
      }
      busy=true;await write(bytes,sinkController.signal);if(finished)return;active();
      written+=expected;const ack=sequence++;busy=false;worker!.postMessage({type:'ack',sequence:ack});
     }catch(error){finish(error??new Error('WAV sink failed.'));}
    })();
   };
   worker.onerror=e=>{e.preventDefault();finish(new Error('WAV stream worker failed.'));};worker.onmessageerror=()=>finish(new Error('Unreadable WAV stream response.'));
   if(signal?.aborted){abort();return;}worker.postMessage({type:'start',channels:snapshots,sampleRate,options:{maxBytes,chunkFrames}},snapshots.map(c=>c.buffer));
  }catch(error){finish(error??new Error('WAV stream failed.'));}
 });
}
