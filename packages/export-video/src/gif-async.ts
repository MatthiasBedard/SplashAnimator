import type {RgbaGifInput} from './gif-rgba';
export interface GifEncodeOptions {signal?:AbortSignal;timeoutMs?:number;maxBytes?:number;maxIndexedBytes?:number;transferFrames?:boolean}
/** Disposable trusted codec worker. Inputs clone by default. transferFrames explicitly consumes full owned frame buffers,
 * including on later worker failure/cancellation; callers must not reuse those buffers.
 * Transfer/copy cost is synchronous; the deadline is not a memory quota.
 */
export async function encodeRgbaGifAsync(input:RgbaGifInput,options:GifEncodeOptions={}):Promise<{bytes:Uint8Array;quantized:boolean}>{
  const {signal,timeoutMs=10000,maxBytes=512*1024*1024,maxIndexedBytes=512*1024*1024,transferFrames=false}=options;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid GIF worker deadline.');
  if([maxBytes,maxIndexedBytes].some(n=>!Number.isSafeInteger(n)||n<1||n>512*1024*1024))throw new Error('Invalid GIF worker byte budget.');
  if(typeof transferFrames!=='boolean')throw new Error('Invalid GIF frame transfer option.');
  signal?.throwIfAborted();
  const width=input.width,height=input.height;
  const transfers:ArrayBuffer[]=[];
  if(transferFrames){
    if(!Array.isArray(input.frames)||!input.frames.length)throw new Error('GIF transfer requires owned frames.');
    const seen=new Set<ArrayBuffer>();
    const typedArrayTag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)!.get!;
    const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
    for(const frame of input.frames){
      // Intrinsic brands accept detached-renderer realms without accepting shared buffers.
      const tag=typedArrayTag.call(frame);
      let owned=false;
      try{owned=bufferLength.call(frame.buffer)===frame.byteLength;}catch{/* Shared/non-buffer values reject below. */}
      if((tag!=='Uint8Array'&&tag!=='Uint8ClampedArray')||!owned||
        frame.byteLength===0||frame.byteOffset!==0||frame.byteLength!==frame.buffer.byteLength)
        throw new Error('GIF transfer requires full nonshared frame buffers.');
      if(!seen.has(frame.buffer)){seen.add(frame.buffer);transfers.push(frame.buffer);}
    }
  }
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,finished=false;
    const finish=(error?:unknown,result?:{bytes:Uint8Array;quantized:boolean})=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      if(error!==undefined)reject(error);else resolve(result!);
    };
    const abort=()=>finish(signal?.reason??new DOMException('GIF encoding cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('GIF encoding timed out.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      worker=new Worker(new URL('./gif-worker.ts',import.meta.url),{type:'module',name:'Splash GIF encoder'});
      worker.onmessage=event=>{
        const value=event.data;
        if(value?.ok!==true){finish(new Error(typeof value?.error==='string'?value.error.slice(0,2000):'Invalid GIF worker response.'));return;}
        const bytes=value.bytes;
        if(!(bytes instanceof Uint8Array)||bytes.length<14||bytes.length>maxBytes||typeof value.quantized!=='boolean'||
          bytes[0]!==71||bytes[1]!==73||bytes[2]!==70||bytes[3]!==56||bytes[4]!==57||bytes[5]!==97||bytes.at(-1)!==59||
          bytes[6]+256*bytes[7]!==width||bytes[8]+256*bytes[9]!==height){finish(new Error('Invalid or oversized GIF worker output.'));return;}
        finish(undefined,{bytes,quantized:value.quantized});
      };
      worker.onerror=event=>{event.preventDefault();finish(new Error('GIF encoder worker failed.'));};
      worker.onmessageerror=()=>finish(new Error('GIF worker response could not be read.'));
      if(signal?.aborted){abort();return;}
      if(transferFrames)worker.postMessage({input,maxBytes,maxIndexedBytes},transfers);
      else worker.postMessage({input,maxBytes,maxIndexedBytes});
    }catch(error){finish(error);}
  });
}
