import type {OpusTrackSettings} from './webm-av';
export interface OpusNative {Encoder:typeof AudioEncoder;Data:typeof AudioData}
export interface OpusOptions {signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}
const int=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
/** Timing/framing only, not entropy decoding. RFC 6716 section 3. */
export function opusPacketSamples(bytes:Uint8Array){
 if(!bytes.length)throw Error('Missing Opus TOC.');
 const config=bytes[0]>>3,code=bytes[0]&3,frame=config<12?[480,960,1920,2880][config%4]:config<16?[480,960][config%2]:[120,240,480,960][config%4];
 let at=1,end=bytes.length,count=code===0?1:2;
 const size=()=>{if(at>=end)throw Error('Truncated Opus size.');const a=bytes[at++];if(a<252)return a;if(at>=end)throw Error('Truncated Opus size.');return a+4*bytes[at++];};
 if(code===3){
  if(at>=end)throw Error('Missing Opus frame count.');const control=bytes[at++];count=control&63;if(!count||frame*count>5760)throw Error('Invalid Opus frame count.');
  if(control&64){let pad=0,b:number;do{if(at>=end)throw Error('Truncated Opus padding.');b=bytes[at++];pad+=b===255?254:b;}while(b===255);end-=pad;if(end<at)throw Error('Invalid Opus padding.');}
  if(control&128){let used=0;for(let i=1;i<count;i++){const n=size();if(n>1275)throw Error('Oversized Opus frame.');used+=n;}const last=end-at-used;if(last<0||last>1275)throw Error('Invalid Opus VBR lengths.');}
  else if((end-at)%count||(end-at)/count>1275)throw Error('Invalid Opus CBR lengths.');
 }else if(code===2){const first=size(),last=end-at-first;if(first>1275||last<0||last>1275)throw Error('Invalid Opus VBR lengths.');}
 else if((end-at)%count||(end-at)/count>1275)throw Error('Invalid Opus frame lengths.');
 if(frame*count>5760)throw Error('Opus packet exceeds 120 ms.');return frame*count;
}
/** One detached normalized 48 kHz planar PCM job, one native input and final flush.
 * Explicit 20 ms packets; original PCM, snapshot and native storage may coexist.
 * Native identification/timing must match before complete packet publication.
 */
export async function encodeOpus(channels:readonly Float32Array[],bitrate:number,options:OpusOptions={},native?:OpusNative){
 const {signal,timeoutMs=10000,maxBytes=128*1024*1024}=options,started=performance.now();
 const {Encoder:Native,Data}=native??{Encoder:globalThis.AudioEncoder,Data:globalThis.AudioData};
 if(!int(bitrate,6000,510000)||!int(timeoutMs,1,60000)||!int(maxBytes,1,128*1024*1024)||!Array.isArray(channels)||channels.length<1||channels.length>2)throw Error('Invalid Opus configuration.');
 if(typeof Native!=='function'||typeof Data!=='function')throw Error('WebCodecs audio encoding is unavailable.');
 const checkInput=()=>{signal?.throwIfAborted();if(performance.now()-started>=timeoutMs)throw Error('Opus encoding timed out.');};checkInput();
 const sources=[...channels],typed=Object.getPrototypeOf(Float32Array.prototype) as object,len=Object.getOwnPropertyDescriptor(typed,'length')!.get!,buffer=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!,tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag)!.get!;
 const lengths=sources.map(s=>{if(tag.call(s)!=='Float32Array'||!(buffer.call(s) instanceof ArrayBuffer))throw Error('Expected unshared Float32 PCM.');return len.call(s) as number;});
 const frames=lengths[0],count=sources.length as 1|2;
 if(!int(frames,1,0xffffffff)||lengths.some(n=>n!==frames)||frames*count*4>128*1024*1024)throw Error('Invalid Opus PCM dimensions or work budget.');
 if(1024+257*Math.ceil(frames/960)>maxBytes)throw Error('Opus output exceeds byte budget.');
 const pcm=new Float32Array(frames*count);
 for(let c=0;c<count;c++)for(let i=0;i<frames;i++){if(i%16384===0)checkInput();const n=sources[c][i];if(!Number.isFinite(n)||n< -1||n>1)throw Error('Opus PCM must be finite and normalized.');pcm[c*frames+i]=n;}
 const config:AudioEncoderConfig=Object.freeze({codec:'opus',sampleRate:48000,numberOfChannels:count,bitrate,opus:Object.freeze({format:'opus' as const,frameDuration:20000})});
 const packets:{bytes:Uint8Array;durationSamples:number;timestampUs:number}[]=[];let head:Uint8Array|undefined,preSkip=0,total=0,payload=0,encoder:AudioEncoder|undefined,closed=false,outputting=false,failure:unknown;
 let rejectFailure:(e:unknown)=>void=()=>{};const failed=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failed.catch(()=>{});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(encoder?.state!=='closed')encoder?.close();}catch{/* already reclaimed */}};
 const fail=(e:unknown)=>{if(closed)return;failure=e??Error('Opus encoding failed.');closed=true;packets.length=0;head=undefined;cleanup();rejectFailure(failure);};
 const abort=()=>fail(signal?.reason??Error('Opus encoding cancelled.'));
 const check=()=>{if(closed)throw failure??Error('Opus encoder closed.');checkInput();};
 try{
  timer=setTimeout(()=>fail(Error('Opus encoding timed out.')),Math.max(1,timeoutMs-(performance.now()-started)));signal?.addEventListener('abort',abort,{once:true});check();
  const supported=await Promise.race([Native.isConfigSupported(config),failed]);check();
  if(!supported.supported||supported.config?.codec!=='opus'||supported.config.sampleRate!==48000||supported.config.numberOfChannels!==count||supported.config.bitrate!==bitrate||supported.config?.opus?.format!=='opus'||supported.config.opus.frameDuration!==20000)throw Error('Requested Opus configuration is unsupported.');
  check();encoder=new Native({error:fail,output:(chunk,metadata)=>{
   if(closed)return;if(outputting){fail(Error('Reentrant Opus output.'));return;}outputting=true;
   try{
    check();const {type,timestamp,duration,byteLength,copyTo}=chunk;const dc=metadata?.decoderConfig;
    if(dc){
     const {codec,sampleRate,numberOfChannels,description}=dc;check();
     if(codec!=='opus'||sampleRate!==48000||numberOfChannels!==count||!description)throw Error('Unexpected Opus decoder configuration.');
     const d=description;if(!(d instanceof ArrayBuffer)&&!ArrayBuffer.isView(d))throw Error('Invalid Opus description buffer.');
     const b=ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(d);
     if(b.length!==19||!(b.buffer instanceof ArrayBuffer)||new TextDecoder().decode(b.subarray(0,8))!=='OpusHead'||b[8]!==1||b[9]!==count||b[18]!==0)throw Error('Invalid family-0 OpusHead.');
     const h=new Uint8Array(b),v=new DataView(h.buffer);if(v.getUint32(12,true)!==48000||v.getInt16(16,true)!==0)throw Error('Unsupported OpusHead rate or gain.');
     if(head&&h.some((n,i)=>n!==head![i]))throw Error('Opus configuration changed.');head=h;preSkip=v.getUint16(10,true);
    }
    // Chromium can truncate a later integral packet timestamp by one microsecond.
    const expectedTime=packets.length*20000;
    const timestampMatches=timestamp===expectedTime||(expectedTime>0&&timestamp===expectedTime-1);
    check();if(!head||type!=='key'||!timestampMatches||duration!==20000||!int(byteLength,1,maxBytes)||typeof copyTo!=='function')throw Error('Unexpected Opus packet metadata.');
    const expected=Math.ceil((frames+preSkip)/960);if(packets.length>=expected||1024+256*expected+payload+byteLength>maxBytes)throw Error('Opus output exceeds count or byte budget.');
    const bytes=new Uint8Array(byteLength);copyTo.call(chunk,bytes);check();if(opusPacketSamples(bytes)!==960)throw Error('Unexpected Opus packet duration.');
    packets.push({bytes,durationSamples:960,timestampUs:expectedTime});total+=960;payload+=bytes.length;
   }catch(e){fail(e);}finally{outputting=false;}
  }});check();encoder.configure(config);check();
  const data=new Data({format:'f32-planar',sampleRate:48000,numberOfChannels:count,numberOfFrames:frames,timestamp:0,data:pcm});try{check();encoder.encode(data);}finally{data.close();}
  await Promise.race([encoder.flush(),failed]);check();
  const endTrim=total-preSkip-frames;if(!head||!packets.length||!int(endTrim,0,959))throw Error('Incomplete Opus output or priming/padding mismatch.');
  const track:OpusTrackSettings={channels:count,preSkip,packetCount:packets.length,sampleCount:total,endTrim};closed=true;cleanup();return {packets,track,description:head,byteLength:payload,inputSampleCount:frames};
 }catch(e){fail(e);cleanup();throw failure??e;}
}
