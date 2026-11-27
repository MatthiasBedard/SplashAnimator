import type {IvfSettings} from './ivf';

const join=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const uint=(value:number,size=0)=>{let n=BigInt(value);if(!size){size=1;while(n>=1n<<BigInt(size*8))size++;}const out=new Uint8Array(size);for(let i=size-1;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}return out;};
const vint=(value:number)=>{let size=1;while(BigInt(value)>=(1n<<BigInt(7*size))-1n)size++;const out=uint(value,size);out[0]|=1<<(8-size);return out;};
const element=(id:number,payload:Uint8Array)=>join([uint(id),vint(payload.length),payload]);
const number=(id:number,value:number)=>element(id,uint(value));
const string=(id:number,value:string)=>element(id,new TextEncoder().encode(value));
const master=(id:number,children:Uint8Array[])=>element(id,join(children));

/** Silent VP8 WebM, one frame per cluster. Cues identify keyframes only.
 * See webmproject.org/docs/container/ and matroska.org/technical/elements.html.
 * Packets are opaque; codec validity is the caller's responsibility.
 */
export function createWebmWriter(settings:Omit<IvfSettings,'codec'>,maxBytes=128*1024*1024){
 const {width,height,frameCount,rate,scale}=settings;
 const valid=(n:number,max:number)=>Number.isSafeInteger(n)&&n>0&&n<=max;
 if(!valid(width,65535)||!valid(height,65535)||!valid(frameCount,10001)||!valid(rate,0xffffffff)||!valid(scale,0xffffffff)||rate/scale<1||rate/scale>240)throw Error('Invalid WebM settings.');
 // Reserve metadata and worst-case per-frame framing/cue overhead before retaining packets.
 if(!valid(maxBytes,128*1024*1024)||1024+256*frameCount>maxBytes)throw Error('WebM byte budget exceeded.');
 const stamp=(i:number)=>Number((BigInt(i)*BigInt(scale)*2000000n+BigInt(rate))/(2n*BigInt(rate)));
 const header=master(0x1a45dfa3,[number(0x4286,1),number(0x42f7,1),number(0x42f2,4),number(0x42f3,8),string(0x4282,'webm'),number(0x4287,2),number(0x4285,2)]);
 const duration=new Uint8Array(8);new DataView(duration.buffer).setFloat64(0,stamp(frameCount));
 const info=master(0x1549a966,[number(0x2ad7b1,1000),element(0x4489,duration),string(0x4d80,'Splash Animator'),string(0x5741,'Splash Animator')]);
 const tracks=master(0x1654ae6b,[master(0xae,[number(0xd7,1),number(0x73c5,1),number(0x83,1),number(0x9c,0),string(0x86,'V_VP8'),master(0xe0,[number(0xb0,width),number(0xba,height)])])]);
 const seek=(position:number)=>master(0x114d9b74,[master(0x4dbb,[element(0x53ab,uint(0x1c53bb6b)),element(0x53ac,uint(position,8))])]);
 const clusters:Uint8Array[]=[],keys:{time:number;offset:number}[]=[];let payloadBytes=0,clusterBytes=0,count=0,closed=false;
 const ready=()=>{if(closed)throw Error('WebM writer is closed.');};
 return {
  append(packet:Uint8Array,keyFrame:boolean){
   ready();if(count>=frameCount)throw Error('WebM frame count exceeded.');
   if(!(packet instanceof Uint8Array)||!(packet.buffer instanceof ArrayBuffer)||!packet.length||typeof keyFrame!=='boolean'||(!count&&!keyFrame))throw Error('WebM requires an owned-compatible packet and an initial keyframe.');
   if(1024+256*frameCount+payloadBytes+packet.length>maxBytes)throw Error('WebM byte budget exceeded.');
   const time=stamp(count),cluster=master(0x1f43b675,[number(0xe7,time),element(0xa3,join([new Uint8Array([0x81,0,0,keyFrame?0x80:0]),packet]))]);
   if(keyFrame)keys.push({time,offset:clusterBytes});clusters.push(cluster);clusterBytes+=cluster.length;payloadBytes+=packet.length;count++;
  },
  finish(){
   ready();if(count!==frameCount)throw Error('WebM frame count is incomplete.');
   try{
    const prefix=seek(0).length+info.length+tracks.length;
    const cues=master(0x1c53bb6b,keys.map(k=>master(0xbb,[number(0xb3,k.time),master(0xb7,[number(0xf7,1),number(0xf1,prefix+k.offset)])])));
    const bytes=join([header,master(0x18538067,[seek(prefix+clusterBytes),info,tracks,...clusters,cues])]);
    if(bytes.length>maxBytes)throw Error('WebM byte budget exceeded.');
    return {bytes,byteLength:bytes.length,frameCount:count,rate,scale};
   }finally{closed=true;clusters.length=0;keys.length=0;}
  },
  abort(){closed=true;clusters.length=0;keys.length=0;},
 };
}
