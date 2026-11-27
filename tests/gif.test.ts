import {expect,it} from 'vitest';
import {createIndexedGifChunkEncoder,createIndexedGifEncoder,encodeIndexedGif} from '../packages/export-video/src/gif';
const animation=()=>({width:1,height:1,palette:new Uint8Array([255,0,0,0,0,255]),frames:[{pixels:new Uint8Array([1]),delayCentiseconds:3}]});
it('writes deterministic detached GIF89a bytes within the exact output budget',()=>{
  const a=animation(),before=structuredClone(a),bytes=encodeIndexedGif(a);
  expect(new TextDecoder().decode(bytes.slice(0,6))).toBe('GIF89a');expect(bytes.at(-1)).toBe(0x3b);expect(a).toEqual(before);
  expect(encodeIndexedGif(a,bytes.length)).toEqual(bytes);expect(()=>encodeIndexedGif(a,bytes.length-1)).toThrow(/budget/);
  a.palette.fill(0);a.frames[0].pixels.fill(0);expect(bytes).toEqual(encodeIndexedGif(before));
});
it('rejects unsupported dimensions, palette references, timing and output budgets',()=>{
  for(const a of [{...animation(),width:0},{...animation(),height:65536},{...animation(),width:1.5},
    {...animation(),palette:new Uint8Array(5)},{...animation(),transparentIndex:2},{...animation(),frames:[]},
    {...animation(),frames:[{pixels:new Uint8Array([2]),delayCentiseconds:1}]},
    {...animation(),frames:[{pixels:new Uint8Array(2),delayCentiseconds:1}]},
    {...animation(),frames:[{pixels:new Uint8Array(1),delayCentiseconds:0}]},
    {...animation(),frames:[{pixels:new Uint8Array(1),delayCentiseconds:65536}]}])expect(()=>encodeIndexedGif(a)).toThrow();
  for(const budget of [0,-1,NaN,Infinity,1.5])expect(()=>encodeIndexedGif(animation(),budget)).toThrow();
});

it('emits looping only when requested and includes the extension in exact budgets',()=>{
  const a=animation(),once=encodeIndexedGif(a),looped=encodeIndexedGif({...a,loop:true});
  expect(encodeIndexedGif({...a,loop:false})).toEqual(once);
  expect(looped.length).toBe(once.length+19);
  expect(new TextDecoder().decode(looped.slice(784,795))).toBe('NETSCAPE2.0');
  expect(encodeIndexedGif({...a,loop:true},looped.length)).toEqual(looped);
  expect(()=>encodeIndexedGif({...a,loop:true},looped.length-1)).toThrow(/budget/);
  expect(()=>encodeIndexedGif({...a,loop:1 as unknown as boolean})).toThrow(/loop/);
});

it('incrementally encodes detached frames with retryable validation and exact completion',()=>{
  const a={...animation(),loop:true,frames:[animation().frames[0],{pixels:new Uint8Array([0]),delayCentiseconds:7}]};
  const expected=encodeIndexedGif(a),encoder=createIndexedGifEncoder({...a,frameCount:2},expected.length);
  a.palette.fill(0);
  expect(()=>encoder.finish()).toThrow(/all declared/);
  expect(()=>encoder.append({pixels:new Uint8Array([2]),delayCentiseconds:3})).toThrow(/palette/);
  encoder.append(a.frames[0]);a.frames[0].pixels.fill(0);
  expect(()=>encoder.finish()).toThrow(/all declared/);
  encoder.append(a.frames[1]);
  expect(()=>encoder.append(a.frames[1])).toThrow(/remaining/);
  expect(encoder.finish()).toEqual(expected);
  expect(()=>encoder.finish()).toThrow(/finished/);
  expect(()=>encoder.append(a.frames[1])).toThrow(/remaining/);
  for(const frameCount of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])
    expect(()=>createIndexedGifEncoder({...animation(),frameCount})).toThrow();
  expect(()=>createIndexedGifEncoder({...animation(),frameCount:2},expected.length-20)).toThrow(/budget/);
});

it('emits bounded owned chunks identical to complete encoding across arbitrary boundaries',()=>{
  const a={...animation(),width:600,loop:true,frames:[{pixels:new Uint8Array(600).fill(1),delayCentiseconds:7},{pixels:new Uint8Array(600),delayCentiseconds:13}]};
  const expected=encodeIndexedGif(a);
  for(const size of [1,7,255,256,1024,65536]){
    const chunks:Uint8Array[]=[],encoder=createIndexedGifChunkEncoder({...a,frameCount:2},chunk=>{chunks.push(chunk);},expected.length,size);
    expect(()=>encoder.append({...a.frames[0],delayCentiseconds:0})).toThrow();
    encoder.append(a.frames[0]);expect(()=>encoder.finish()).toThrow(/all declared/);encoder.append(a.frames[1]);encoder.finish();
    expect(chunks.every(c=>c.length<=size)).toBe(true);expect(new Set(chunks.map(c=>c.buffer)).size).toBe(chunks.length);
    expect(new Uint8Array(chunks.flatMap(c=>Array.from(c)))).toEqual(expected);
  }
});
it('poisons chunk encoding on sink failure and rejects invalid output budgets before writing',()=>{
  let fail=false,writes=0;const encoder=createIndexedGifChunkEncoder({...animation(),frameCount:1},()=>{writes++;if(fail)throw new Error('sink failed');},4096,1);
  fail=true;expect(()=>encoder.append(animation().frames[0])).toThrow(/sink failed/);
  const before=writes;expect(()=>encoder.finish()).toThrow(/failed/);expect(()=>encoder.append(animation().frames[0])).toThrow(/failed/);expect(writes).toBe(before);
  expect(()=>createIndexedGifChunkEncoder({...animation(),frameCount:1},()=>{throw new Error('unexpected write');},1)).toThrow(/budget/);
  for(const size of [0,1.5,1048577])expect(()=>createIndexedGifChunkEncoder({...animation(),frameCount:1},()=>{},4096,size)).toThrow(/size/);
});
it('encodes optional dictionary output with actual-size budgets and owned chunks',()=>{
 const a={...animation(),width:4096,compression:'dictionary' as const,loop:true,frames:[{pixels:new Uint8Array(4096).fill(1),delayCentiseconds:7},{pixels:new Uint8Array(4096),delayCentiseconds:13}]};
 const expected=encodeIndexedGif(a);expect(expected.length).toBeLessThan(encodeIndexedGif({...a,compression:'literal'}).length/4);expect(encodeIndexedGif(a,expected.length)).toEqual(expected);expect(()=>encodeIndexedGif(a,expected.length-1)).toThrow(/budget/);
 for(const size of [1,7,255,65536]){const chunks:Uint8Array[]=[],encoder=createIndexedGifChunkEncoder({...a,frameCount:2},chunk=>{chunks.push(chunk);},expected.length,size);encoder.append(a.frames[0]);encoder.append(a.frames[1]);encoder.finish();expect(new Uint8Array(chunks.flatMap(c=>Array.from(c)))).toEqual(expected);expect(chunks.every(c=>c.length<=size)).toBe(true);expect(new Set(chunks.map(c=>c.buffer)).size).toBe(chunks.length);}
 expect(encodeIndexedGif({...animation(),compression:'literal'})).toEqual(encodeIndexedGif(animation()));for(const compression of [null,1,'bogus'])expect(()=>encodeIndexedGif({...animation(),compression:compression as 'literal'})).toThrow(/compression/);
});
it('keeps dictionary validation retryable but poisons output overflow and sink failures',()=>{
 const a={...animation(),width:4096,compression:'dictionary' as const,frameCount:1};const valid={pixels:new Uint8Array(4096),delayCentiseconds:3};
 const encoder=createIndexedGifEncoder(a,808);expect(()=>encoder.append({...valid,pixels:new Uint8Array(4096).fill(2)})).toThrow(/palette/);expect(()=>encoder.append(valid)).toThrow(/budget/);expect(()=>encoder.finish()).toThrow(/failed/);expect(()=>encoder.append(valid)).toThrow(/failed/);
 let fail=false;const chunked=createIndexedGifChunkEncoder(a,()=>{if(fail)throw new Error('destination failed');},4096,1);fail=true;expect(()=>chunked.append(valid)).toThrow('destination failed');expect(()=>chunked.finish()).toThrow(/failed/);
 expect(()=>createIndexedGifEncoder({...a,width:65535,height:65535})).toThrow(/work/);
});
it('grows complete dictionary output safely beyond the initial allocation',()=>{
 const pixels=new Uint8Array(100000);let seed=12;for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}
 const a={width:500,height:200,palette:new Uint8Array(768),compression:'dictionary' as const,frames:[{pixels,delayCentiseconds:1}]};const bytes=encodeIndexedGif(a);expect(bytes.length).toBeGreaterThan(65536);expect(encodeIndexedGif(a,bytes.length)).toEqual(bytes);const chunks:Uint8Array[]=[];const stream=createIndexedGifChunkEncoder({...a,frameCount:1},c=>{chunks.push(c);},bytes.length,8192);stream.append(a.frames[0]);stream.finish();expect(new Uint8Array(chunks.flatMap(c=>Array.from(c)))).toEqual(bytes);
});
