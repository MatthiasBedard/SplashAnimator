import {expect,it} from 'vitest';
import {createIvfWriter} from '../packages/export-video/src/ivf';
const settings={codec:'vp8' as const,width:32,height:16,frameCount:2,rate:30000,scale:1001};
it('writes owned IVF headers, rational timing and exact ordered frame packets',()=>{
 const chunks:Uint8Array[]=[];const options={...settings};const writer=createIvfWriter(options,b=>chunks.push(b),61);options.rate=24;
 const packet=new Uint8Array([1,2,3]);writer.append(packet);packet.fill(9);writer.append(new Uint8Array([4,5]));expect(writer.finish()).toEqual({frameCount:2,byteLength:61,rate:30000,scale:1001});
 const h=new DataView(chunks[0].buffer);expect(Array.from(chunks[0].slice(0,12))).toEqual([68,75,73,70,0,0,32,0,86,80,56,48]);expect([h.getUint16(12,true),h.getUint16(14,true),h.getUint32(16,true),h.getUint32(20,true),h.getUint32(24,true),h.getUint32(28,true)]).toEqual([32,16,30000,1001,2,0]);expect(Array.from(chunks[2])).toEqual([1,2,3]);expect(new DataView(chunks[3].buffer).getBigUint64(4,true)).toBe(1n);expect(()=>writer.append(packet)).toThrow(/closed/);expect(()=>writer.finish()).toThrow(/closed/);
});
it('rejects invalid admission and packets before writing, retaining retryable incomplete work',()=>{
 const chunks:Uint8Array[]=[];for(const bad of [{rate:NaN},{scale:0},{width:65536},{frameCount:1.5},{codec:'av1'}])expect(()=>createIvfWriter({...settings,...bad} as typeof settings,b=>chunks.push(b))).toThrow();expect(chunks).toEqual([]);
 expect(()=>createIvfWriter(settings,b=>chunks.push(b),57)).toThrow(/budget/);const w=createIvfWriter(settings,b=>chunks.push(b),58);expect(()=>w.finish()).toThrow(/incomplete/);expect(()=>w.append(new Uint8Array())).toThrow();expect(()=>w.append(new Uint8Array(new SharedArrayBuffer(1)))).toThrow();expect(()=>w.append(new Uint8Array(2))).toThrow(/budget/);expect(chunks).toHaveLength(1);w.append(new Uint8Array([1]));w.append(new Uint8Array([2]));expect(()=>w.append(new Uint8Array([3]))).toThrow(/count/);expect(w.finish().byteLength).toBe(58);
});
it('makes sink failures terminal and blocks reentrant publication',()=>{
 let fail=false;const w=createIvfWriter(settings,()=>{if(fail)throw Error('sink failure');});fail=true;expect(()=>w.append(new Uint8Array([1]))).toThrow('sink failure');expect(()=>w.finish()).toThrow(/closed/);
 const writer:ReturnType<typeof createIvfWriter>=createIvfWriter({...settings,codec:'vp9',frameCount:1},b=>{if(b.length!==32)expect(()=>writer.finish()).toThrow(/writing/);});writer.append(new Uint8Array([1]));expect(writer.finish().frameCount).toBe(1);
 const aborted=createIvfWriter(settings,()=>{});aborted.abort();expect(()=>aborted.append(new Uint8Array([1]))).toThrow(/closed/);
});

it('rejects asynchronous sinks without issuing a completion receipt',()=>{
 expect(()=>createIvfWriter(settings,async()=>{throw Error('async failure');})).toThrow(/synchronous/);
 let asyncWrite=false;const w=createIvfWriter(settings,()=>asyncWrite?Promise.reject(Error('async failure')):undefined);asyncWrite=true;expect(()=>w.append(new Uint8Array([1]))).toThrow(/synchronous/);expect(()=>w.finish()).toThrow(/closed/);
});
