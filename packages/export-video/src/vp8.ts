import {createIvfWriter,type IvfSettings} from './ivf';
import {createWebmWriter} from './webm';
export interface Vp8Settings extends Omit<IvfSettings,'codec'>{bitrate:number;keyFrameInterval?:number;container?:'ivf'|'webm'}
export interface Vp8Options{signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}
/** Serial opaque RGBA to VP8 in IVF or WebM; all-keyframe by default. No packets publish before finish.
 * Flush per frame bounds the native input queue; this favors bounded ownership
 * over compression throughput. Native cleanup timing remains platform-owned.
 */
export function openVp8Encoder(settings:Vp8Settings,options:Vp8Options={}){
 const {width,height,frameCount,rate,scale,bitrate,keyFrameInterval=1,container='ivf'}=settings;
 const {signal,timeoutMs=10000,maxBytes=128*1024*1024}=options;
 const frameBytes=width*height*4;
 if((container!=='ivf'&&container!=='webm')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||
   !Number.isSafeInteger(bitrate)||bitrate<1||bitrate>100000000||
   !Number.isSafeInteger(keyFrameInterval)||keyFrameInterval<1||keyFrameInterval>300||
   !Number.isSafeInteger(frameBytes)||frameBytes<4||frameBytes*frameCount>128*1024*1024||
   !Number.isFinite(rate/scale)||rate/scale<1||rate/scale>240)
   throw new Error('Invalid VP8 timing, bitrate or RGBA work budget.');
 const chunks:Uint8Array[]=[];let byteLength=0,packetBytes=0;
 const webm=container==='webm'?createWebmWriter({width,height,frameCount,rate,scale},maxBytes):undefined;
 const writer=container==='ivf'?createIvfWriter({codec:'vp8',width,height,frameCount,rate,scale},chunk=>{chunks.push(chunk);byteLength+=chunk.length;},maxBytes):undefined;
 if(signal?.aborted)throw signal.reason??new Error('Video encoding cancelled.');
 if(typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined')throw new Error('WebCodecs video encoding is unavailable.');
 const started=performance.now();
 let encoder:VideoEncoder|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let failure:unknown,closed=false,busy=false,submitted=0,received=0,keyFrames=0,deltaFrames=0;
 let rejectFailure:(e:unknown)=>void=()=>{};
 const failed=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failed.catch(()=>{});
 const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(encoder?.state!=='closed')encoder?.close();}catch{/* already reclaimed */}};
 const fail=(error:unknown)=>{if(closed)return;failure=error??new Error('Video encoding failed.');closed=true;chunks.length=0;writer?.abort();webm?.abort();cleanup();rejectFailure(failure);};
 const abort=()=>fail(signal?.reason??new Error('Video encoding cancelled.'));
 const check=()=>{if(!closed&&performance.now()-started>=timeoutMs)fail(new Error('Video encoding timed out.'));if(closed)throw failure??new Error('Video encoder is closed.');};
 // Integer rational rounding avoids accumulated deltas and floating-product loss.
 const stamp=(i:number)=>Number((BigInt(i)*BigInt(scale)*1000000n*2n+BigInt(rate))/(2n*BigInt(rate)));
 try{
  encoder=new VideoEncoder({error:fail,output:chunk=>{
   if(closed)return;
   try{
    check();if(received>=submitted||chunk.timestamp!==stamp(received)||(chunk.type!=='key'&&chunk.type!=='delta')||(received%keyFrameInterval===0&&chunk.type!=='key'))throw new Error('Unexpected VP8 output order or frame type.');
    if(!Number.isSafeInteger(chunk.byteLength)||chunk.byteLength<1||(container==='webm'?1024+256*frameCount+packetBytes+chunk.byteLength:byteLength+12+chunk.byteLength)>maxBytes)throw new Error('Video output exceeds the byte budget.');
    const packet=new Uint8Array(chunk.byteLength);chunk.copyTo(packet);if(webm)webm.append(packet,chunk.type==='key');else writer!.append(packet);packetBytes+=packet.length;received++;if(chunk.type==='key')keyFrames++;else deltaFrames++;
   }catch(e){fail(e);}
  }});
  encoder.configure({codec:'vp8',width,height,bitrate,framerate:rate/scale,latencyMode:'realtime',alpha:'discard'});
  timer=setTimeout(()=>fail(new Error('Video encoding timed out.')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();check();
 }catch(e){fail(e);throw failure??e;}
 return {
  async append(rgba:Uint8Array){
   check();if(busy)throw new Error('Video encoder already has a pending frame.');
   if(submitted>=frameCount)throw new Error('Video frame count exceeded.');
   if(!(rgba instanceof Uint8Array)||!(rgba.buffer instanceof ArrayBuffer)||rgba.length!==frameBytes)throw new Error('Expected one unshared RGBA frame.');
   for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255)throw new Error('VP8 input must be opaque; composite a matte first.');
   check();busy=true;
   try{
    const frame=new VideoFrame(rgba.slice(),{format:'RGBA',codedWidth:width,codedHeight:height,timestamp:stamp(submitted),duration:stamp(submitted+1)-stamp(submitted)});
    try{check();const keyFrame=submitted%keyFrameInterval===0;submitted++;encoder!.encode(frame,{keyFrame});}finally{frame.close();}
    await Promise.race([encoder!.flush(),failed]);check();
    if(received!==submitted)throw new Error('Video encoder omitted a frame.');
   }catch(e){fail(e);throw failure??e;}finally{busy=false;}
  },
  finish(){
   check();if(busy)throw new Error('Video encoder already has a pending frame.');
   if(submitted!==frameCount)throw new Error('Video frame count is incomplete.');
   try{
    const webmReceipt=webm?.finish(),receipt=webmReceipt??writer!.finish();
    const bytes=webmReceipt?.bytes??new Uint8Array(receipt.byteLength);let offset=0;
    if(!webm)for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}check();
    closed=true;cleanup();chunks.length=0;return {...receipt,bytes,keyFrames,deltaFrames,container};
   }catch(e){fail(e);throw failure??e;}
  },
  dispose(){fail(new Error('Video encoder disposed.'));},
 };
}
