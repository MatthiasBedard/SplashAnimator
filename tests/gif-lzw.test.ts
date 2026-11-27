import {expect,it} from 'vitest';
import {writeGifLzw} from '../packages/export-video/src/gif-lzw';
function encode(pixels:Uint8Array,budget?:number){const chunks:Uint8Array[]=[];const count=writeGifLzw(pixels,c=>{chunks.push(c);},budget);return {chunks,count,bytes:new Uint8Array(chunks.flatMap(c=>Array.from(c)))};}
it('compresses repeated indices into bounded owned sub-blocks with exact byte accounting',()=>{
 const pixels=new Uint8Array(65536).fill(127),a=encode(pixels);expect(a.count).toBe(a.bytes.length);expect(a.count).toBeLessThan(1000);expect(a.bytes[0]).toBe(8);expect(a.bytes.at(-1)).toBe(0);
 expect(a.chunks.every(c=>c.length<=256)).toBe(true);expect(new Set(a.chunks.map(c=>c.buffer)).size).toBe(a.chunks.length);expect(encode(pixels,a.count).bytes).toEqual(a.bytes);expect(()=>encode(pixels,a.count-1)).toThrow(/budget/);expect(pixels.every(p=>p===127)).toBe(true);
 let at=1;while(a.bytes[at])at+=a.bytes[at]+1;expect(at).toBe(a.bytes.length-1);
});
it('validates admission and stops immediately when a sink fails',()=>{
 const write=()=>{throw new Error('should not write');};for(const budget of [0,-1,NaN,1.5,Infinity])expect(()=>writeGifLzw(new Uint8Array([0]),write,budget)).toThrow(/budget/);
 expect(()=>writeGifLzw(new Uint8Array(),write)).toThrow(/indices/);expect(()=>writeGifLzw(new Uint8Array(new SharedArrayBuffer(2)),write)).toThrow(/indices/);
 let calls=0;expect(()=>writeGifLzw(new Uint8Array(40000),()=>{calls++;throw new Error('sink failed');})).toThrow('sink failed');expect(calls).toBe(1);
 expect(()=>writeGifLzw(new Uint8Array([0]),async()=>{})).toThrow(/synchronous/);
});
