import type {GifStreamSettings,GifStreamRequest} from './gif-stream';
import type {GifStreamOptions} from './gif-stream-async';
export interface GifChunkSink {write(chunk:Uint8Array,signal:AbortSignal):void|Promise<void>;abort(reason:unknown):void|Promise<void>}
type Result={bytesWritten:number;quantized:boolean};
/** Provisional asynchronous destination writes. Acknowledge chunks only after write resolves.
 * finish returns a verified receipt, never closes/publishes the destination. Caller commits it.
 * On failure dispose awaits abort cleanup and exposes abort errors. Sinks must discard all
 * provisional bytes and prevent late writes after abort; AbortSignal is advisory to the sink.
 */
export async function openGifChunkStream(settings:GifStreamSettings,sink:GifChunkSink,options:GifStreamOptions={}){
  if(typeof sink?.write!=='function'||typeof sink?.abort!=='function')throw new Error('Invalid GIF destination.');
  const write=sink.write.bind(sink),abortSink=sink.abort.bind(sink);
  const {signal,timeoutMs=10000,maxBytes=512*1024*1024,maxIndexedBytes=512*1024*1024}=options;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid GIF stream deadline.');
  if([maxBytes,maxIndexedBytes].some(n=>!Number.isSafeInteger(n)||n<1||n>512*1024*1024))throw new Error('Invalid GIF stream budget.');
  signal?.throwIfAborted();
  const snapshot=structuredClone(settings);
  if(snapshot.compression!==undefined&&snapshot.compression!=='literal'&&snapshot.compression!=='dictionary')throw new Error('Invalid GIF compression option.');
  const worker=new Worker(new URL('./gif-chunk-worker.ts',import.meta.url),{type:'module',name:'Splash GIF stream'});
  let closed=false,reason:unknown,seq=0,phase='init',accepted=0,chunkId=0,writing=false,bytesWritten=0,lastByte=-1;
  const prefix=new Uint8Array(10),writingSignal=new AbortController();
  let cleanup:Promise<void>=Promise.resolve();
  let pending:{resolve:(result:Result|undefined)=>void;reject:(error:unknown)=>void;seq:number;phase:string;accepted:number}|undefined;
  const close=(error:unknown=new Error('GIF stream disposed.'),success=false)=>{
    if(closed)return;closed=true;reason=error;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();
    if(!success){
      writingSignal.abort(error);
      cleanup=Promise.resolve().then(()=>abortSink(error));
      void cleanup.catch(()=>{}); // dispose exposes cleanup failure without unhandled rejection.
    }
    const job=pending;pending=undefined;job?.reject(error);
  };
  const abort=()=>close(signal?.reason??new DOMException('GIF stream cancelled.','AbortError'));
  const timer=setTimeout(()=>close(new Error('GIF stream timed out.')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=event=>{event.preventDefault();close(new Error('GIF stream worker failed.'));};
  worker.onmessageerror=()=>close(new Error('GIF stream response could not be read.'));
  worker.onmessage=event=>{
    const value=event.data,job=pending;
    if(!job){close(new Error('Unexpected GIF stream response.'));return;}
    if(value?.ok!==true){close(new Error(typeof value?.error==='string'?value.error.slice(0,2000):'Invalid GIF stream response.'));return;}
    if(writing){close(new Error('GIF response arrived while destination write is pending.'));return;}
    if(value.kind==='chunk'){
      const bytes=value.bytes;
      if(value.seq!==job.seq||value.chunkId!==chunkId||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>65536||
        bytesWritten+bytes.length>maxBytes||!['index','done'].includes(job.phase)){
        close(new Error('Invalid GIF output chunk.'));return;
      }
      const length=bytes.length,last=bytes[length-1];
      for(let n=0;n<length&&bytesWritten+n<prefix.length;n++)prefix[bytesWritten+n]=bytes[n];
      writing=true;
      void Promise.resolve().then(()=>{if(!closed)return write(bytes,writingSignal.signal);}).then(()=>{
        if(closed)return;
        bytesWritten+=length;lastByte=last;writing=false;
        worker.postMessage({kind:'ack-chunk',seq:job.seq,chunkId:chunkId++});
      }).catch(close);
      return;
    }
    if(value.kind!=='ack'||value.seq!==job.seq||value.phase!==job.phase||value.accepted!==job.accepted||value.bytes!==undefined){close(new Error('Invalid GIF stream acknowledgment.'));return;}
    let result:Result|undefined;
    if(job.phase==='done'){
      if(bytesWritten<14||typeof value.quantized!=='boolean'||lastByte!==59||
        prefix[0]!==71||prefix[1]!==73||prefix[2]!==70||prefix[3]!==56||prefix[4]!==57||prefix[5]!==97||
        prefix[6]+256*prefix[7]!==snapshot.width||prefix[8]+256*prefix[9]!==snapshot.height){close(new Error('Invalid GIF stream output.'));return;}
      result={bytesWritten,quantized:value.quantized};
    }else if(value.quantized!==undefined){close(new Error('Premature GIF stream output.'));return;}
    pending=undefined;seq++;phase=job.phase;accepted=job.accepted;
    if(phase==='done')close(new Error('GIF stream completed.'),true);
    job.resolve(result);
  };
  const request=(message:GifStreamRequest,nextPhase:string,nextAccepted:number,transfer:Transferable[]=[])=>{
    if(closed)return Promise.reject(reason);
    if(pending)return Promise.reject(new Error('GIF stream request already in flight.'));
    return new Promise<Result|undefined>((resolve,reject)=>{
      pending={resolve,reject,seq:message.seq,phase:nextPhase,accepted:nextAccepted};
      try{worker.postMessage(message,transfer);}catch(error){close(error);}
    });
  };
  const frame=async(kind:'analyze'|'index',pixels:Uint8Array|Uint8ClampedArray,transfer=false)=>{
    if(closed)throw reason;
    if(pending)throw new Error('GIF stream request already in flight.');
    if(phase!==(kind==='analyze'?'analyze':'index')||accepted>=snapshot.frameCount)throw new Error('Invalid GIF stream phase or frame count.');
    if(typeof transfer!=='boolean')throw new Error('Invalid GIF transfer option.');
    const transfers:Transferable[]=[];
    if(transfer){
      const tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)!.get!.call(pixels);
      let length=-1;try{length=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!.call(pixels.buffer);}catch{/* Reject shared buffers. */}
      if((tag!=='Uint8Array'&&tag!=='Uint8ClampedArray')||length<=0||pixels.byteOffset!==0||pixels.byteLength!==length)
        throw new Error('GIF transfer requires full nonshared frame buffers.');
      transfers.push(pixels.buffer as ArrayBuffer);
    }
    await request({seq,kind,frame:pixels},phase,accepted+1,transfers);
  };
  if(signal?.aborted){abort();throw reason;}
  try{await request({seq,kind:'init',settings:snapshot,maxBytes,maxIndexedBytes},'analyze',0);}
  catch(error){await cleanup;throw error;}
  return {
    analyze:(pixels:Uint8Array|Uint8ClampedArray,transfer=false)=>frame('analyze',pixels,transfer),
    index:(pixels:Uint8Array|Uint8ClampedArray,transfer=false)=>frame('index',pixels,transfer),
    seal:async()=>{
      if(closed)throw reason;
      if(pending)throw new Error('GIF stream request already in flight.');
      if(phase!=='analyze'||accepted!==snapshot.frameCount)throw new Error('GIF analysis is incomplete.');
      await request({seq,kind:'seal'},'index',0);
    },
    finish:async()=>{
      if(closed)throw reason;
      if(pending)throw new Error('GIF stream request already in flight.');
      if(phase!=='index'||accepted!==snapshot.frameCount)throw new Error('GIF encoding is incomplete.');
      return (await request({seq,kind:'finish'},'done',accepted))!;
    },
    dispose:async()=>{close();await cleanup;},
  };
}
