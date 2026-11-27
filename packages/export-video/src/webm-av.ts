import type {IvfSettings} from './ivf';

export interface OpusTrackSettings {
 /** Mapping family 0, 48 kHz input/output, zero output gain. */
 channels:1|2;preSkip:number;packetCount:number;sampleCount:number;endTrim:number;
}
const join=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const uint=(value:number,size=0)=>{let n=BigInt(value);if(!size){size=1;while(n>=1n<<BigInt(size*8))size++;}const out=new Uint8Array(size);for(let i=size-1;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}return out;};
const vint=(value:number)=>{let size=1;while(BigInt(value)>=(1n<<BigInt(7*size))-1n)size++;const out=uint(value,size);out[0]|=1<<(8-size);return out;};
const element=(id:number,payload:Uint8Array)=>join([uint(id),vint(payload.length),payload]);
const number=(id:number,value:number)=>element(id,uint(value));
const string=(id:number,value:string)=>element(id,new TextEncoder().encode(value));
const master=(id:number,children:Uint8Array[])=>element(id,join(children));
const float=(id:number,value:number)=>{const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value);return element(id,bytes);};
const ticks=(samples:number,factor:bigint)=>Number((BigInt(samples)*factor+24000n)/48000n);
const valid=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const typed=Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLength=Object.getOwnPropertyDescriptor(typed,'byteLength')!.get!;
const buffer=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!;

/** Explicit opaque VP8/Opus packets. Mono/stereo family-0 only; no encoding or
 * codec-payload certification. Equal-timestamp packets share clusters; microsecond timecodes.
 * Audio sample offsets start at decoded sample zero, before pre-skip. Packets
 * must be submitted in timestamp order; rejected calls leave the writer usable.
 * See Matroska A_OPUS mapping, RFC 7845 section 5.1 and WebM container guidance.
 * Silent createWebmWriter remains independent and byte-for-byte unchanged. */
function avWebmLayout(video:Omit<IvfSettings,'codec'>,audio:OpusTrackSettings,maxBytes:number){
 const {width,height,frameCount,rate,scale}=video;
 const {channels,preSkip,packetCount,sampleCount,endTrim}=audio;
 if(!valid(width,1,65535)||!valid(height,1,65535)||!valid(frameCount,1,10001)||!valid(rate,1,0xffffffff)||!valid(scale,1,0xffffffff)||rate/scale<1||rate/scale>240)throw Error('Invalid AV WebM video settings.');
 if((channels!==1&&channels!==2)||!valid(preSkip,0,65535)||!valid(packetCount,1,Number.MAX_SAFE_INTEGER)||!valid(sampleCount,1,Number.MAX_SAFE_INTEGER)||!valid(endTrim,0,5759)||preSkip+endTrim>=sampleCount||sampleCount%120!==0||sampleCount<packetCount*120||sampleCount>packetCount*5760)throw Error('Invalid family-0 Opus track settings.');
 const minimumFinal=(Math.floor(endTrim/120)+1)*120;
 if(sampleCount<(packetCount-1)*120+minimumFinal)throw Error('Opus final trim leaves no feasible packet sequence.');
 const reserve=1024+256*(frameCount+packetCount);
 if(!valid(maxBytes,1,128*1024*1024)||!Number.isSafeInteger(reserve)||reserve>maxBytes)throw Error('AV WebM byte budget exceeded.');
 const stamp=(i:number)=>Number((BigInt(i)*BigInt(scale)*2000000n+BigInt(rate))/(2n*BigInt(rate)));
 const audioEnd=ticks(sampleCount-preSkip-endTrim,1000000n),duration=Math.max(stamp(frameCount),audioEnd);
 if(!Number.isSafeInteger(duration)||!Number.isSafeInteger(ticks(sampleCount,1000000000n)))throw Error('AV WebM duration exceeds exact timing.');
 const head=new Uint8Array(19),hv=new DataView(head.buffer);head.set(new TextEncoder().encode('OpusHead'));head[8]=1;head[9]=channels;hv.setUint16(10,preSkip,true);hv.setUint32(12,48000,true);
 const header=master(0x1a45dfa3,[number(0x4286,1),number(0x42f7,1),number(0x42f2,4),number(0x42f3,8),string(0x4282,'webm'),number(0x4287,4),number(0x4285,2)]);
 const info=master(0x1549a966,[number(0x2ad7b1,1000),float(0x4489,duration),string(0x4d80,'Splash Animator'),string(0x5741,'Splash Animator')]);
 const tracks=master(0x1654ae6b,[master(0xae,[number(0xd7,1),number(0x73c5,1),number(0x83,1),number(0x9c,0),string(0x86,'V_VP8'),number(0x23e383,Number((BigInt(scale)*2000000000n+BigInt(rate))/(2n*BigInt(rate)))),master(0xe0,[number(0xb0,width),number(0xba,height)])]),master(0xae,[number(0xd7,2),number(0x73c5,2),number(0x83,2),number(0x9c,0),string(0x86,'A_OPUS'),element(0x63a2,head),number(0x56aa,ticks(preSkip,1000000000n)),number(0x56bb,80000000),master(0xe1,[float(0xb5,48000),number(0x9f,channels)])])]);
 const seek=(position:number)=>master(0x114d9b74,[master(0x4dbb,[element(0x53ab,uint(0x1c53bb6b)),element(0x53ac,uint(position,8))])]);
 let blocks:Uint8Array[]=[];
 const clusters:Uint8Array[][]=[],keys:{time:number;offset:number;block:number}[]=[];
 let videos=0,audios=0,samples=0,payloadBytes=0,clusterBytes=0,lastTime=-1,closed=false,writing=false;
 const ready=()=>{if(closed||writing)throw Error('AV WebM writer is closed or writing.');};
 const packetCopy=(packet:Uint8Array)=>{
  if(!(packet instanceof Uint8Array)||!(buffer.call(packet) instanceof ArrayBuffer))throw Error('AV WebM requires an unshared encoded packet.');
  const length=byteLength.call(packet) as number;
  if(!length)throw Error('AV WebM requires a nonempty encoded packet.');
  if(reserve+payloadBytes+length>maxBytes)throw Error('AV WebM byte budget exceeded.');
  const copy=new Uint8Array(length);copy.set(packet);return copy;
 };
 const ordered=(time:number,other:number)=>{if(time<lastTime||time>other)throw Error('Submit AV WebM packets in interleaved timestamp order.');};
 const lengthOf=(parts:Uint8Array[])=>parts.reduce((n,p)=>n+p.length,0);
 const retain=(block:Uint8Array,time:number,length:number,keyFrame:boolean)=>{
  const merging=time===lastTime,nextBlocks=merging?[...blocks,block]:[block],children=[number(0xe7,time),...nextBlocks];
  const cluster=[uint(0x1f43b675),vint(lengthOf(children)),...children],offset=merging?clusterBytes-lengthOf(clusters.at(-1)!):clusterBytes;
  if(keyFrame)keys.push({time,offset,block:nextBlocks.length});
  if(merging)clusters[clusters.length-1]=cluster;else clusters.push(cluster);
  blocks=nextBlocks;clusterBytes=offset+lengthOf(cluster);payloadBytes+=length;lastTime=time;
 };
 return {
  appendVideo(packet:Uint8Array,keyFrame:boolean){
   ready();writing=true;try{
    if(videos===frameCount)throw Error('AV WebM video frame count exceeded.');
    if(typeof keyFrame!=='boolean'||(!videos&&!keyFrame))throw Error('AV WebM requires an initial video keyframe.');
    const time=stamp(videos);ordered(time,audios<packetCount?ticks(samples,1000000n):Infinity);
    const copy=packetCopy(packet),block=element(0xa3,join([new Uint8Array([0x81,0,0,keyFrame?0x80:0]),copy]));
    retain(block,time,copy.length,keyFrame);videos++;
   }finally{writing=false;}
  },
  appendAudio(packet:Uint8Array,durationSamples:number){
   ready();writing=true;try{
    if(audios===packetCount)throw Error('AV WebM audio packet count exceeded.');
    if(!valid(durationSamples,120,5760)||durationSamples%120!==0)throw Error('Invalid Opus decoded packet duration.');
    const next=samples+durationSamples,remaining=packetCount-audios-1;
    if(next>sampleCount||sampleCount-next<(remaining?(remaining-1)*120+minimumFinal:0)||sampleCount-next>remaining*5760||(!remaining&&endTrim>=durationSamples))throw Error('Opus duration does not match declared sample count or final trim.');
    const time=ticks(samples,1000000n);ordered(time,videos<frameCount?stamp(videos):Infinity);
    const copy=packetCopy(packet),padding=endTrim&&!remaining?ticks(endTrim,1000000000n):0;
    // Signed DiscardPadding uses a leading zero to keep positive values positive.
    const trim=padding?element(0x75a2,join([new Uint8Array([0]),uint(padding)])):undefined;
    const block=master(0xa0,[element(0xa1,join([new Uint8Array([0x82,0,0,0]),copy])),number(0x9b,ticks(next,1000000n)-time),...(trim?[trim]:[])]);
    retain(block,time,copy.length,false);samples=next;audios++;
   }finally{writing=false;}
  },
  finishParts(){
   ready();if(videos!==frameCount||audios!==packetCount||samples!==sampleCount)throw Error('AV WebM packet counts are incomplete.');
   writing=true;try{
    const prefix=seek(0).length+info.length+tracks.length;
    const cues=master(0x1c53bb6b,keys.map(k=>master(0xbb,[number(0xb3,k.time),master(0xb7,[number(0xf7,1),number(0xf1,prefix+k.offset),...(k.block>1?[number(0x5378,k.block)]:[])])])));
    const children=[seek(prefix+clusterBytes),info,tracks,...clusters.flat(),cues],size=lengthOf(children);
    const parts=[header,uint(0x18538067),vint(size),...children],byteLength=lengthOf(parts);
    if(byteLength>maxBytes)throw Error('AV WebM byte budget exceeded.');
    closed=true;blocks=[];clusters.length=0;keys.length=0;return {parts,byteLength,frameCount:videos,audioPacketCount:audios,audioSampleCount:samples,durationUs:duration,rate,scale};
   }finally{writing=false;}
  },
  abort(){ready();closed=true;blocks=[];clusters.length=0;keys.length=0;},
 };
}

/** Existing complete-file API; encoded packet admission and bytes are unchanged. */
export function createAvWebmWriter(video:Omit<IvfSettings,'codec'>,audio:OpusTrackSettings,maxBytes=128*1024*1024){
 const layout=avWebmLayout(video,audio,maxBytes);
 return {appendVideo:layout.appendVideo,appendAudio:layout.appendAudio,abort:layout.abort,
  finish(){const {parts,...receipt}=layout.finishParts();return {bytes:join(parts),...receipt};}};
}

export type AvWebmPacket=
 | {kind:'video';bytes:Uint8Array;keyFrame:boolean}
 | {kind:'audio';bytes:Uint8Array;durationSamples:number};
/** Preflight a complete interleaved sequence before exposing output. Packets are
 * opaque and copied; no encoding or codec certification occurs here. The layout
 * retains packet blocks and metadata, not a joined container. Each next() returns
 * fresh transferable storage of at most 64 KiB. Consumers must treat chunks as
 * provisional until the full byte receipt is written; this API never commits a sink.
 * Preparation/scans/copies are synchronous; this is not a streaming codec host.
 */
export function prepareAvWebmChunks(video:Omit<IvfSettings,'codec'>,audio:OpusTrackSettings,packets:readonly AvWebmPacket[],maxBytes=128*1024*1024){
 // Resolve original settings before reading packet getters. Counts cannot be
 // supplied by proposed/public packet data, nor reread after caller callbacks.
 const v={width:video.width,height:video.height,frameCount:video.frameCount,rate:video.rate,scale:video.scale};
 const a={channels:audio.channels,preSkip:audio.preSkip,packetCount:audio.packetCount,sampleCount:audio.sampleCount,endTrim:audio.endTrim};
 const layout=avWebmLayout(v,a,maxBytes);
 try{
  if(!Array.isArray(packets))throw Error('AV WebM packet counts are incomplete.');
  const count=packets.length;
  if(count!==v.frameCount+a.packetCount)throw Error('AV WebM packet counts are incomplete.');
  for(let i=0;i<count;i++){
   const packet=packets[i];if(!packet)throw Error('Missing AV WebM packet.');
   const kind=packet.kind,bytes=packet.bytes;
   if(kind==='video'){const keyFrame=packet.keyFrame;layout.appendVideo(bytes,keyFrame);}
   else if(kind==='audio'){const durationSamples=packet.durationSamples;layout.appendAudio(bytes,durationSamples);}
   else throw Error('Invalid AV WebM packet kind.');
  }
  const {parts,...receipt}=layout.finishParts();
  let index=0,offset=0,remaining=receipt.byteLength,disposed=false;
  return Object.freeze({...receipt,
   next():Uint8Array|undefined{
    if(disposed)throw Error('Prepared AV WebM output is disposed.');
    if(!remaining)return undefined;
    const out=new Uint8Array(Math.min(65536,remaining));let at=0;
    while(at<out.length){const part=parts[index],size=Math.min(part.length-offset,out.length-at);out.set(part.subarray(offset,offset+size),at);at+=size;offset+=size;if(offset===part.length){parts[index]=new Uint8Array(0);index++;offset=0;}}
    remaining-=out.length;return out;
   },
   dispose(){disposed=true;parts.length=0;remaining=0;},
  });
 }catch(e){try{layout.abort();}catch{/* completed private layout has no external owner */}throw e;}
}
