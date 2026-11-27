export interface WavEncodeOptions {
 /** Complete output, including the 44-byte header. At most 64 MiB. */
 maxBytes?:number;
}
function prepare(channels:readonly Float32Array[],sampleRate:number,options:WavEncodeOptions,signal?:AbortSignal){
 signal?.throwIfAborted();
 const {maxBytes=64*1024*1024}=options;
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Invalid WAV sample rate.');
 if(!Array.isArray(channels)||channels.length<1||channels.length>2)throw new Error('WAV requires mono or stereo channels.');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<44||maxBytes>64*1024*1024)throw new Error('Invalid WAV output budget.');
 const sources=[...channels],tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!;
 const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
 let frames=0;
 for(const source of sources){
  if(tag.call(source)!=='Float32Array'||!source.length)throw new Error('WAV channels must be nonempty Float32 PCM.');
  try{bufferLength.call(source.buffer);}catch{throw new Error('WAV channels require nonshared buffers.');}
  if(frames&&source.length!==frames)throw new Error('WAV channels must have equal lengths.');frames=source.length;
 }
 const count=sources.length,dataBytes=frames*count*2,total=44+dataBytes;
 if(!Number.isSafeInteger(total)||total>maxBytes)throw new Error('WAV output exceeds byte budget.');
 for(const source of sources)for(let i=0;i<frames;i++){
  if(i%16384===0)signal?.throwIfAborted();
  const sample=source[i];if(!Number.isFinite(sample)||sample<-1||sample>1)throw new Error('WAV samples must be finite and normalized.');
 }
 return {sources,frames,count,dataBytes,total};
}
function header(count:number,sampleRate:number,dataBytes:number,total:number){
 const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);
 const ascii=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
 ascii(0,'RIFF');view.setUint32(4,total-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*count*2,true);
 view.setUint16(32,count*2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,dataBytes,true);
 return bytes;
}
function samples(sources:readonly Float32Array[],first:number,last:number,bytes:Uint8Array,offset=0){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let frame=first;frame<last;frame++)for(const source of sources){view.setInt16(offset,Math.min(32767,Math.max(-32768,Math.round(source[frame]*32768))),true);offset+=2;}
}
/** Encode normalized mono/stereo planar PCM as little-endian PCM16 RIFF/WAVE.
 * Quantization is round(sample * 32768), saturated to [-32768,32767]. No dither,
 * resampling, gain, hidden normalization or source mutation. Source buffers must
 * stay stable for this synchronous call. Validate all samples before allocation.
 */
export function encodePcm16Wav(channels:readonly Float32Array[],sampleRate:number,options:WavEncodeOptions={}):Uint8Array{
 const {sources,frames,count,dataBytes,total}=prepare(channels,sampleRate,options);
 const bytes=new Uint8Array(total);bytes.set(header(count,sampleRate,dataBytes,total));
 samples(sources,0,frames,bytes,44);return bytes;
}
export interface WavChunkOptions extends WavEncodeOptions {signal?:AbortSignal;chunkFrames?:number}
/** Emits owned header and interleaved PCM blocks without retaining complete output.
 * All input samples validate before the first write. Input must remain stable until return;
 * sinks may retain/mutate/transfer emitted chunks, but must not mutate the source channels.
 * Sinks must be synchronous and discard all provisional bytes on any failure. Cancellation
 * is checked between validation/encoding blocks; this synchronous function does not yield.
 */
export function writePcm16Wav(channels:readonly Float32Array[],sampleRate:number,write:(chunk:Uint8Array)=>void,options:WavChunkOptions={}){
 if(typeof write!=='function')throw new Error('Invalid WAV chunk writer options.');
 const chunks=createPcm16WavChunks(channels,sampleRate,options);
 try{
  while(true){
   const next=chunks.next();if(next.done)return next.value;
   const result:unknown=write(next.value);
   if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as PromiseLike<unknown>).then==='function'){
    void Promise.resolve(result).catch(()=>{});throw new Error('WAV chunk sinks must be synchronous.');
   }
   options.signal?.throwIfAborted();
  }
 }finally{chunks.return();}
}
/** Validates eagerly, then encodes only the next requested block. Call return() on failure.
 * Source views remain borrowed and must stay stable; a worker must own transferred inputs.
 * The final receipt follows the last chunk only when the caller requests the next result.
 */
export function createPcm16WavChunks(channels:readonly Float32Array[],sampleRate:number,options:WavChunkOptions={}){
 const {signal,chunkFrames=16384}=options;
 if(!Number.isSafeInteger(chunkFrames)||chunkFrames<1||chunkFrames>16384)throw new Error('Invalid WAV chunk writer options.');
 const {sources,frames,count,dataBytes,total}=prepare(channels,sampleRate,options,signal);
 function* generate(){
  try{
   signal?.throwIfAborted();yield header(count,sampleRate,dataBytes,total);
   for(let first=0;first<frames;first+=chunkFrames){
    signal?.throwIfAborted();const last=Math.min(frames,first+chunkFrames),bytes=new Uint8Array((last-first)*count*2);
    samples(sources,first,last,bytes);yield bytes;
   }
   signal?.throwIfAborted();return {bytesWritten:total,frames,sampleRate,channelCount:count};
  }finally{sources.length=0;}
 }
 const iterator=generate();
 return {next:()=>iterator.next(),return:()=>{sources.length=0;return iterator.return(undefined as never);}};
}
