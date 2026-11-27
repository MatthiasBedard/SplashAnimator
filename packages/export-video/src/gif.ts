import {writeGifLzw} from './gif-lzw';
/** GIF89a indexed full-frame encoding. Graphics Interchange Format and GIF are
 * CompuServe properties. Format reference: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 * Literal LZW is the default; dictionary compression is explicitly opt-in.
 */
export interface IndexedGifFrame {pixels:Uint8Array;delayCentiseconds:number}
export interface IndexedGifAnimation {
  width:number;height:number;palette:Uint8Array;frames:readonly IndexedGifFrame[];
  transparentIndex?:number;
  /** Repeat indefinitely via the Netscape application extension; absent/false plays once. */
  loop?:boolean;
  compression?:'literal'|'dictionary';
}
/** Synchronous in-memory codec only. No quantization, timing rounding or source execution.
 * All frames cover the logical screen and restore background before the next frame.
 * Looping is opt-in; decoder timing policy still applies.
 */
export function encodeIndexedGif(animation:IndexedGifAnimation,maxBytes=512*1024*1024):Uint8Array {
  if(!Array.isArray(animation.frames)||!animation.frames.length)throw new Error('GIF requires at least one frame.');
  const encoder=createIndexedGifEncoder({...animation,frameCount:animation.frames.length},maxBytes);
  for(const frame of animation.frames)encoder.append(frame);
  return encoder.finish();
}
export interface IndexedGifStream extends Omit<IndexedGifAnimation,'frames'> {frameCount:number}
/** Incremental indexed input, with bounded output storage (dictionary output grows as needed). No partial bytes are exposed.
 * Validation rejection leaves the encoder unchanged; output/sink failures are terminal.
 * Finish requires exactly frameCount frames.
 * Palette/config are detached on creation; appended pixels are encoded immediately, not retained.
 */
export function createIndexedGifEncoder(animation:IndexedGifStream,maxBytes=512*1024*1024){
  const encoder=createIndexedGifOutput(animation,maxBytes);
  return {append:encoder.append,finish:()=>encoder.finish()!};
}
/** Synchronous bounded output chunks. Sink owns each chunk. Partial bytes are provisional:
 * discard/abort the destination on failure; publish only after successful finish.
 * Sinks must not mutate the current frame during append.
 * Async sinks are unsupported: use an acknowledged worker protocol for asynchronous writes.
 */
export function createIndexedGifChunkEncoder(animation:IndexedGifStream,write:(chunk:Uint8Array)=>void,maxBytes=512*1024*1024,chunkBytes=65536){
  if(typeof write!=='function'||!Number.isInteger(chunkBytes)||chunkBytes<1||chunkBytes>1024*1024)throw new Error('Invalid GIF chunk sink or size.');
  const encoder=createIndexedGifOutput(animation,maxBytes,write,chunkBytes);
  return {append:encoder.append,finish:()=>{encoder.finish();}};
}
function createIndexedGifOutput(animation:IndexedGifStream,maxBytes:number,sink?:(chunk:Uint8Array)=>void,chunkBytes=65536){
  const {width,height,palette,frameCount,transparentIndex,loop,compression}=animation;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535)
    throw new Error('GIF dimensions must be integers from 1 to 65535.');
  if(!(palette instanceof Uint8Array)||palette.length<6||palette.length>768||palette.length%3)
    throw new Error('GIF requires 2 to 256 RGB palette entries.');
  if(loop!==undefined&&typeof loop!=='boolean')throw new Error('Invalid GIF loop option.');
  if(compression!==undefined&&compression!=='literal'&&compression!=='dictionary')throw new Error('Invalid GIF compression option.');
  const compressed=compression==='dictionary';
  const colors=palette.length/3;
  if(transparentIndex!==undefined&&(!Number.isInteger(transparentIndex)||transparentIndex<0||transparentIndex>=colors))
    throw new Error('Invalid GIF transparent palette index.');
  if(!Number.isSafeInteger(frameCount)||frameCount<1)throw new Error('GIF requires a positive safe frame count.');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid GIF output budget.');
  const count=width*height;
  const packedBytes=Math.ceil((count+Math.ceil(count/254)+1)*9/8);
  const frameBytes=8+10+1+packedBytes+Math.ceil(packedBytes/255)+1;
  const total=13+768+frameBytes*frameCount+1+(loop?19:0);
  const minimum=13+768+25*frameCount+1+(loop?19:0);
  if(!Number.isSafeInteger(total)||(!compressed&&total>maxBytes)||(compressed&&minimum>maxBytes))throw new Error('GIF exceeds the output byte budget.');
  // Preserve a finite aggregate raster-work admission even for highly compressible input.
  if(compressed&&total>512*1024*1024)throw new Error('GIF dictionary raster work exceeds the 512 MiB literal-size budget.');
  const capacity=compressed?maxBytes:total;
  const validate=(frame:IndexedGifFrame)=>{
    if(!frame||!(frame.pixels instanceof Uint8Array)||frame.pixels.length!==count||(compressed&&!(frame.pixels.buffer instanceof ArrayBuffer)))
      throw new Error('GIF frame pixels must cover the full logical screen.');
    if(!Number.isInteger(frame.delayCentiseconds)||frame.delayCentiseconds<1||frame.delayCentiseconds>65535)
      throw new Error('GIF frame delays must be 1 to 65535 centiseconds.');
    for(const pixel of frame.pixels)if(pixel>=colors)throw new Error('GIF pixel references a missing palette entry.');
  };
  const paletteSnapshot=palette.slice();
  let out=new Uint8Array(sink?Math.min(chunkBytes,capacity):compressed?Math.min(65536,capacity):capacity),at=0,used=0,failed=false,busy=false;
  const flush=()=>{
    if(!sink||used===0)return;
    const chunk=used===out.length?out:out.slice(0,used);
    const result:unknown=sink(chunk);
    if(result&&typeof (result as {then?:unknown}).then==='function')throw new Error('GIF chunk sinks must be synchronous.');
    out=new Uint8Array(Math.min(chunkBytes,capacity-at));used=0;
  };
  const byte=(n:number)=>{
    if(at>=capacity)throw new Error('GIF exceeds the output byte budget.');
    if(!sink&&used===out.length){const grown=new Uint8Array(Math.min(capacity,Math.max(out.length+1,out.length*2)));grown.set(out);out=grown;}
    out[used++]=n;at++;if(sink&&used===out.length)flush();
  };
  const word=(n:number)=>{byte(n&255);byte(n>>>8);};
  for(const c of 'GIF89a')byte(c.charCodeAt(0));
  word(width);word(height);byte(0xf7);byte(transparentIndex??0);byte(0);
  for(let i=0;i<768;i++)byte(paletteSnapshot[i]??0);
  if(loop){
    byte(0x21);byte(0xff);byte(11);
    for(const c of 'NETSCAPE2.0')byte(c.charCodeAt(0));
    byte(3);byte(1);word(0);byte(0);
  }
  let accepted=0,finished=false;
  const append=(frame:IndexedGifFrame)=>{
    if(failed||busy)throw new Error('GIF encoder is failed or busy.');
    if(finished||accepted===frameCount)throw new Error('GIF encoder has no remaining frames.');
    validate(frame);
    busy=true;
    try{
    byte(0x21);byte(0xf9);byte(4);byte(8|(transparentIndex===undefined?0:1));
    word(frame.delayCentiseconds);byte(transparentIndex??0);byte(0);
    byte(0x2c);word(0);word(0);word(width);word(height);byte(0);
    if(compressed){writeGifLzw(frame.pixels,chunk=>{for(const value of chunk)byte(value);},Math.max(1,capacity-at));}
    else {
    byte(8);
    let bits=0,held=0,remaining=0;
    const packed=(n:number)=>{
      if(!remaining){remaining=Math.min(255,packedBytes-held);byte(remaining);}
      byte(n);remaining--;held++;
    };
    let accumulator=0;
    const code=(n:number)=>{accumulator|=n<<bits;bits+=9;while(bits>=8){packed(accumulator&255);accumulator>>>=8;bits-=8;}};
    for(let i=0;i<count;i++){
      if(i%254===0)code(256);
      code(frame.pixels[i]);
    }
    code(257);if(bits)packed(accumulator&255);byte(0);
    }
    accepted++;
    }catch(error){failed=true;throw error;}finally{busy=false;}
  };
  const finish=()=>{
    if(failed||busy)throw new Error('GIF encoder is failed or busy.');
    if(finished)throw new Error('GIF encoder is already finished.');
    if(accepted!==frameCount)throw new Error('GIF encoder requires all declared frames.');
    busy=true;
    try{
    byte(0x3b);
    flush();
    if(!compressed&&at!==total)throw new Error('GIF output size mismatch.');
    finished=true;
    return sink?undefined:compressed?out.slice(0,at):out;
    }catch(error){failed=true;throw error;}finally{busy=false;}
  };
  return {append,finish};
}
