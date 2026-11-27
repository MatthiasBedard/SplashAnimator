import type {Vp8Options,Vp8Settings} from './vp8';
export type Vp8PacketSettings=Omit<Vp8Settings,'container'>;
export interface Vp8Packet {bytes:Uint8Array;keyFrame:boolean;timestampUs:number;durationUs:number}
const valid=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const typed=Object.getPrototypeOf(Uint8Array.prototype) as object;
const length=Object.getOwnPropertyDescriptor(typed,'byteLength')!.get!,buffer=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!;
/** Separate raw-packet host. No container parsing/re-encoding or early publication.
 * Native dependencies/settings snapshot at open; one detached opaque frame is
 * submitted/flushed at a time. Existing IVF/WebM entry point stays independent.
 */
export interface Vp8Native {Encoder:typeof VideoEncoder;Frame:typeof VideoFrame}
/** Shared original-value admission used before an AV job starts asynchronous work. */
export function prepareVp8PacketSettings(settings:Vp8PacketSettings,maxBytes=128*1024*1024){
 const {width,height,frameCount,rate,scale,bitrate,keyFrameInterval=1}=settings;
 if(!valid(width,1,65535)||!valid(height,1,65535)||!valid(frameCount,1,10001)||!valid(rate,1,0xffffffff)||!valid(scale,1,0xffffffff)||rate/scale<1||rate/scale>240||!valid(bitrate,1,100000000)||!valid(keyFrameInterval,1,300)||!valid(maxBytes,1,128*1024*1024))throw Error('Invalid VP8 packet settings or work/byte budget.');
 const frameBytes=width*height*4,reserve=1024+256*frameCount;
 if(frameBytes*frameCount>128*1024*1024||reserve+frameCount>maxBytes)throw Error('Invalid VP8 packet work/byte budget.');
 return {width,height,frameCount,rate,scale,bitrate,keyFrameInterval};
}
export function openVp8PacketEncoder(settings:Vp8PacketSettings,options:Vp8Options={},native?:Vp8Native){
 const {signal,timeoutMs=10000,maxBytes=128*1024*1024}=options,started=performance.now();
 if(!valid(timeoutMs,1,60000))throw Error('Invalid VP8 packet deadline.');
 const {width,height,frameCount,rate,scale,bitrate,keyFrameInterval}=prepareVp8PacketSettings(settings,maxBytes),frameBytes=width*height*4,reserve=1024+256*frameCount;
 const {Encoder:Native,Frame}=native??{Encoder:globalThis.VideoEncoder,Frame:globalThis.VideoFrame};
 signal?.throwIfAborted();if(typeof Native!=='function'||typeof Frame!=='function')throw Error('WebCodecs video encoding is unavailable.');
 const packets:Vp8Packet[]=[];let encoder:VideoEncoder|undefined,timer:ReturnType<typeof setTimeout>|undefined,failure:unknown,closed=false,busy=false,outputting=false,submitted=0,received=0,byteLength=0,keyFrames=0,deltaFrames=0;
 let rejectFailure:(e:unknown)=>void=()=>{};const failed=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failed.catch(()=>{});
 const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(encoder?.state!=='closed')encoder?.close();}catch{/* already reclaimed */}};
 const fail=(e:unknown)=>{if(closed)return;failure=e??Error('VP8 packet encoding failed.');closed=true;packets.length=0;cleanup();rejectFailure(failure);};
 const abort=()=>fail(signal?.reason??Error('Video encoding cancelled.'));
 const check=()=>{if(!closed&&performance.now()-started>=timeoutMs)fail(Error('Video encoding timed out.'));if(closed)throw failure??Error('Video packet encoder is closed.');};
 const stamp=(i:number)=>Number((BigInt(i)*BigInt(scale)*2000000n+BigInt(rate))/(2n*BigInt(rate)));
 try{
  timer=setTimeout(()=>fail(Error('Video encoding timed out.')),Math.max(1,timeoutMs-(performance.now()-started)));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();check();
  encoder=new Native({error:fail,output:(chunk,metadata)=>{
   if(closed)return;if(outputting){fail(Error('Reentrant VP8 output.'));return;}outputting=true;
   try{
    check();const {timestamp,duration,type,byteLength:size,copyTo}=chunk,dc=metadata?.decoderConfig;
    if(dc){const {codec,codedWidth,codedHeight,description}=dc;if(codec!=='vp8'||(codedWidth!==undefined&&codedWidth!==width)||(codedHeight!==undefined&&codedHeight!==height)||description!==undefined)throw Error('Unexpected VP8 decoder configuration.');}
    check();if(received>=submitted||timestamp!==stamp(received)||(duration!==null&&duration!==undefined&&duration!==stamp(received+1)-stamp(received))||(type!=='key'&&type!=='delta')||(received%keyFrameInterval===0&&type!=='key'))throw Error('Unexpected VP8 packet order, duration or type.');
    if(!valid(size,1,maxBytes)||reserve+byteLength+size+(frameCount-received-1)>maxBytes||typeof copyTo!=='function')throw Error('Video packet output exceeds byte budget.');
    const bytes=new Uint8Array(size);copyTo.call(chunk,bytes);check();packets.push({bytes,keyFrame:type==='key',timestampUs:stamp(received),durationUs:stamp(received+1)-stamp(received)});byteLength+=size;received++;if(type==='key')keyFrames++;else deltaFrames++;
   }catch(e){fail(e);}finally{outputting=false;}
  }});check();encoder.configure({codec:'vp8',width,height,bitrate,framerate:rate/scale,latencyMode:'realtime',alpha:'discard'});check();
 }catch(e){fail(e);cleanup();throw failure??e;}
 return {
  async append(rgba:Uint8Array){
   check();if(busy)throw Error('Video encoder already has a pending frame.');if(submitted>=frameCount)throw Error('Video frame count exceeded.');busy=true;let entered=false;
   try{
    if(!(rgba instanceof Uint8Array)||!(buffer.call(rgba) instanceof ArrayBuffer)||length.call(rgba)!==frameBytes)throw Error('Expected one unshared RGBA frame.');
    for(let i=3;i<frameBytes;i+=4){if((i&65535)===3)check();if(rgba[i]!==255)throw Error('VP8 input must be opaque; composite a matte first.');}
    const owned=new Uint8Array(frameBytes);owned.set(rgba);check();entered=true;
    const frame=new Frame(owned,{format:'RGBA',codedWidth:width,codedHeight:height,timestamp:stamp(submitted),duration:stamp(submitted+1)-stamp(submitted)});
    try{check();const keyFrame=submitted%keyFrameInterval===0;submitted++;encoder!.encode(frame,{keyFrame});}finally{frame.close();}
    await Promise.race([encoder!.flush(),failed]);check();if(received!==submitted)throw Error('Video encoder omitted a frame.');
   }catch(e){if(entered)fail(e);throw failure??e;}finally{busy=false;}
  },
  finish(){
   check();if(busy)throw Error('Video encoder already has a pending frame.');if(submitted!==frameCount||received!==frameCount)throw Error('Video packet frame count is incomplete.');
   const result={packets:packets.slice(),byteLength,frameCount,rate,scale,width,height,keyFrames,deltaFrames};closed=true;cleanup();packets.length=0;return result;
  },
  dispose(){fail(Error('Video packet encoder disposed.'));},
 };
}
