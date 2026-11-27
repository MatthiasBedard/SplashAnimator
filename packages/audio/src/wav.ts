export interface WavDecodeOptions {maxInputBytes?:number;maxPcmBytes?:number;maxChunks?:number}
/** Strict little-endian RIFF/WAVE PCM16 admission. No platform decoder, resampling or playback.
 * Unsupported encodings reject; unknown RIFF chunks are skipped with validated sizes/padding.
 * Signed samples use a uniform 32768 divisor (positive full scale is 32767/32768).
 * Source buffers must remain stable during this synchronous call. Output owns planar PCM.
 */
export function decodePcm16Wav(bytes:Uint8Array,options:WavDecodeOptions={}){
  const {maxInputBytes=64*1024*1024,maxPcmBytes=128*1024*1024,maxChunks=10000}=options;
  for(const [value,limit] of [[maxInputBytes,64*1024*1024],[maxPcmBytes,128*1024*1024],[maxChunks,10000]])
    if(!Number.isSafeInteger(value)||value<1||value>limit)throw new Error('Invalid WAV decode budget.');
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>maxInputBytes)throw new Error('Invalid or oversized WAV input.');
  try{Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!.call(bytes.buffer);}catch{throw new Error('WAV input must use a nonshared buffer.');}
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text=(at:number)=>String.fromCharCode(bytes[at],bytes[at+1],bytes[at+2],bytes[at+3]);
  if(text(0)!=='RIFF'||text(8)!=='WAVE'||view.getUint32(4,true)!==bytes.length-8)throw new Error('Invalid WAV RIFF header or file length.');
  let format:{channels:number;sampleRate:number;blockAlign:number}|undefined,data:{at:number;size:number}|undefined,chunks=0;
  for(let at=12;at<bytes.length;){
    if(++chunks>maxChunks)throw new Error('WAV exceeds the chunk budget.');
    if(bytes.length-at<8)throw new Error('Truncated WAV chunk header.');
    const kind=text(at),size=view.getUint32(at+4,true),start=at+8,end=start+size,next=end+(size%2);
    if(end>bytes.length||next>bytes.length)throw new Error('Truncated WAV chunk or padding.');
    if(kind==='fmt '){
      if(format)throw new Error('Duplicate WAV format chunk.');
      if(size!==16&&size!==18)throw new Error('Unsupported WAV format extension.');
      const tag=view.getUint16(start,true),channels=view.getUint16(start+2,true),sampleRate=view.getUint32(start+4,true),rate=view.getUint32(start+8,true),blockAlign=view.getUint16(start+12,true),bits=view.getUint16(start+14,true);
      if(tag!==1||bits!==16||(size===18&&view.getUint16(start+16,true)!==0))throw new Error('Only PCM16 WAV encoding is supported.');
      if((channels!==1&&channels!==2)||sampleRate<8000||sampleRate>192000||blockAlign!==channels*2||rate!==sampleRate*blockAlign)throw new Error('Invalid WAV channels, sample rate or alignment.');
      format={channels,sampleRate,blockAlign};
    }else if(kind==='data'){
      if(data)throw new Error('Duplicate WAV data chunk.');
      data={at:start,size};
    }
    at=next;
  }
  if(!format||!data||!data.size||data.size%format.blockAlign)throw new Error('Missing, empty or unaligned WAV audio data.');
  const frames=data.size/format.blockAlign;
  if(frames*format.channels*4>maxPcmBytes)throw new Error('WAV decoded PCM exceeds the byte budget.');
  const channels=Array.from({length:format.channels},()=>new Float32Array(frames));
  for(let i=0;i<frames;i++)for(let c=0;c<format.channels;c++)channels[c][i]=view.getInt16(data.at+i*format.blockAlign+c*2,true)/32768;
  return {channels,sampleRate:format.sampleRate,frames};
}
