/** IVF framing follows webmproject/libvpx ivfenc.c. Packets remain opaque:
 * this writer does not certify codec payloads, keyframes or visual fidelity.
 * Sink writes are provisional until finish; discard all bytes on failure.
 */
export interface IvfSettings {
  codec:'vp8'|'vp9';width:number;height:number;frameCount:number;
  rate:number;scale:number;
}
export function createIvfWriter(settings:IvfSettings,sink:(bytes:Uint8Array)=>void,maxBytes=128*1024*1024){
  const {codec,width,height,frameCount,rate,scale}=settings;
  const uint=(n:number,max:number)=>Number.isSafeInteger(n)&&n>0&&n<=max;
  if((codec!=='vp8'&&codec!=='vp9')||!uint(width,65535)||!uint(height,65535)||
    !uint(frameCount,0xffffffff)||!uint(rate,0xffffffff)||!uint(scale,0xffffffff))
    throw new Error('Invalid IVF dimensions, frame count, codec or rational timebase.');
  if(!uint(maxBytes,128*1024*1024)||32+13*frameCount>maxBytes)
    throw new Error('IVF output exceeds the byte budget.');
  if(typeof sink!=='function')throw new Error('IVF requires a synchronous byte sink.');
  let state:'open'|'finished'|'failed'='open',writing=false,count=0,bytes=0;
  const emit=(chunk:Uint8Array)=>{
    bytes+=chunk.byteLength;const result=sink(chunk) as unknown;
    if(result && typeof (result as {then?:unknown}).then==='function'){
      // An accidentally async sink may already have effects; never issue a receipt.
      void Promise.resolve(result).catch(()=>{});
      throw new Error('IVF requires a synchronous byte sink.');
    }
  };
  const header=new Uint8Array(32),view=new DataView(header.buffer);
  header.set([68,75,73,70]);view.setUint16(6,32,true);
  header.set(codec==='vp8'?[86,80,56,48]:[86,80,57,48],8);
  view.setUint16(12,width,true);view.setUint16(14,height,true);
  view.setUint32(16,rate,true);view.setUint32(20,scale,true);view.setUint32(24,frameCount,true);
  emit(header);
  const ready=()=>{if(state!=='open'||writing)throw new Error('IVF writer is closed or writing.');};
  return {
    append(packet:Uint8Array){
      ready();
      if(!(packet instanceof Uint8Array)||!(packet.buffer instanceof ArrayBuffer)||!packet.byteLength)
        throw new Error('IVF requires a nonempty unshared encoded packet.');
      if(count>=frameCount)throw new Error('IVF frame count exceeded.');
      // Reserve a header and at least one byte for every remaining packet.
      if(bytes+12+packet.byteLength+13*(frameCount-count-1)>maxBytes)
        throw new Error('IVF output exceeds the byte budget.');
      const owned=packet.slice(),frame=new Uint8Array(12),v=new DataView(frame.buffer);
      v.setUint32(0,owned.byteLength,true);v.setBigUint64(4,BigInt(count),true);
      writing=true;
      try{emit(frame);emit(owned);count++;}
      catch(e){state='failed';throw e;}
      finally{writing=false;}
    },
    finish(){
      ready();if(count!==frameCount)throw new Error('IVF frame count is incomplete.');
      state='finished';return {frameCount:count,byteLength:bytes,rate,scale};
    },
    abort(){if(writing)throw new Error('IVF writer is writing.');state='failed';},
  };
}
