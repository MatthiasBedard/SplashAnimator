import type {GifStreamSettings,GifStreamRequest} from './gif-stream';
export interface GifStreamOptions {signal?:AbortSignal;timeoutMs?:number;maxBytes?:number;maxIndexedBytes?:number}
type Result={bytes:Uint8Array;quantized:boolean};
/** One request in flight; shared deadline includes idle/capture time. Explicit transfer consumes
 * full owned frame buffers even if later work fails. Default frame submission copies.
 */
export async function openGifStream(settings:GifStreamSettings,options:GifStreamOptions={}){
  const {signal,timeoutMs=10000,maxBytes=512*1024*1024,maxIndexedBytes=512*1024*1024}=options;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid GIF stream deadline.');
  if([maxBytes,maxIndexedBytes].some(n=>!Number.isSafeInteger(n)||n<1||n>512*1024*1024))throw new Error('Invalid GIF stream budget.');
  signal?.throwIfAborted();
  const snapshot=structuredClone(settings);
  if(snapshot.compression!==undefined&&snapshot.compression!=='literal'&&snapshot.compression!=='dictionary')throw new Error('Invalid GIF compression option.');
  const worker=new Worker(new URL('./gif-stream-worker.ts',import.meta.url),{type:'module',name:'Splash GIF stream'});
  let closed=false,reason:unknown,seq=0,phase='init',accepted=0;
  let pending:{resolve:(result:Result|undefined)=>void;reject:(error:unknown)=>void;seq:number;phase:string;accepted:number}|undefined;
  const close=(error:unknown=new Error('GIF stream disposed.'))=>{
    if(closed)return;closed=true;reason=error;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();
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
    if(value.seq!==job.seq||value.phase!==job.phase||value.accepted!==job.accepted){close(new Error('Invalid GIF stream acknowledgment.'));return;}
    let result:Result|undefined;
    if(job.phase==='done'){
      const b=value.bytes;
      if(!(b instanceof Uint8Array)||b.length<14||b.length>maxBytes||typeof value.quantized!=='boolean'||
        b[0]!==71||b[1]!==73||b[2]!==70||b[3]!==56||b[4]!==57||b[5]!==97||b.at(-1)!==59||
        b[6]+256*b[7]!==snapshot.width||b[8]+256*b[9]!==snapshot.height){close(new Error('Invalid GIF stream output.'));return;}
      result={bytes:b,quantized:value.quantized};
    }else if(value.bytes!==undefined||value.quantized!==undefined){close(new Error('Premature GIF stream output.'));return;}
    pending=undefined;seq++;phase=job.phase;accepted=job.accepted;
    if(phase==='done')close(new Error('GIF stream completed.'));
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
  await request({seq,kind:'init',settings:snapshot,maxBytes,maxIndexedBytes},'analyze',0);
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
    dispose:()=>close(),
  };
}
