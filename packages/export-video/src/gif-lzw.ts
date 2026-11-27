/** GIF89a Appendix F, 8-bit indices, 9..12-bit LZW codes.
 * Emits owned data sub-blocks including the minimum code size and terminator.
 * Output is provisional until return; synchronous sinks must discard on failure
 * and must not mutate the input during this call. No full output is retained.
 * https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */
export function writeGifLzw(pixels:Uint8Array,write:(chunk:Uint8Array)=>void,maxBytes=128*1024*1024):number{
  if(!(pixels instanceof Uint8Array)||!(pixels.buffer instanceof ArrayBuffer)||!pixels.length)throw new Error('GIF LZW requires nonempty unshared indices.');
  if(typeof write!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid GIF LZW sink or budget.');
  // Open-addressed prefix/byte dictionary, at most 3838 entries in 8192 slots.
  const keys=new Int32Array(8192).fill(-1),values=new Uint16Array(8192);
  let next=258,width=9,decoderNext=258,previous=false,bits=0,accumulator=0,used=0,total=0;
  let block=new Uint8Array(256);
  const emit=(chunk:Uint8Array)=>{
    if(total+chunk.length>maxBytes)throw new Error('GIF LZW exceeds output budget.');
    total+=chunk.length;
    const result:unknown=write(chunk);
    if(result&&typeof (result as {then?:unknown}).then==='function')throw new Error('GIF LZW sinks must be synchronous.');
  };
  const flush=()=>{if(!used)return;block[0]=used;emit(block.slice(0,used+1));block=new Uint8Array(256);used=0;};
  const byte=(value:number)=>{block[++used]=value;if(used===255)flush();};
  const code=(value:number)=>{accumulator|=value<<bits;bits+=width;while(bits>=8){byte(accumulator&255);accumulator>>>=8;bits-=8;}};
  const data=(value:number)=>{
    code(value);
    // Track decoder growth rather than encoder insertion (one phrase ahead).
    if(previous&&decoderNext<4096){decoderNext++;if(decoderNext===(1<<width)&&width<12)width++;}
    previous=true;
  };
  const reset=()=>{keys.fill(-1);next=258;width=9;decoderNext=258;previous=false;};
  emit(new Uint8Array([8]));code(256);
  let prefix=pixels[0];
  for(let i=1;i<pixels.length;i++){
    const pixel=pixels[i],key=prefix*256+pixel;
    let slot=Math.imul(key,0x9e3779b1)>>>19;
    while(keys[slot]!==-1&&keys[slot]!==key)slot=(slot+1)&8191;
    if(keys[slot]===key){prefix=values[slot];continue;}
    data(prefix);
    if(next<4096){keys[slot]=key;values[slot]=next++;}
    else {code(256);reset();}
    prefix=pixel;
  }
  data(prefix);code(257);if(bits)byte(accumulator&255);flush();emit(new Uint8Array([0]));
  return total;
}
