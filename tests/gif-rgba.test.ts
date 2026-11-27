import {encodeIndexedGif} from '../packages/export-video/src/gif';
import {expect,it} from 'vitest';
import {createGifPaletteAnalyzer,encodeRgbaGif,gifFrameDelays,prepareRgbaGif,type RgbaGifInput} from '../packages/export-video/src/gif-rgba';
const input=():RgbaGifInput=>({width:3,height:1,frames:[new Uint8Array([255,0,0,255,0,0,255,128,99,88,77,0])],fps:24,matte:[255,255,255],transparent:true});
it('preserves exact colors, explicit partial-alpha matte and zero-alpha transparency without mutating pixels',()=>{
  const source=input(),before=structuredClone(source),result=prepareRgbaGif(source);
  expect(result.quantized).toBe(false);expect(Array.from(result.animation.palette)).toEqual([0,0,0,255,0,0,127,127,255]);
  expect(Array.from(result.animation.frames[0].pixels)).toEqual([1,2,0]);expect(source).toEqual(before);
  source.frames[0].fill(0);expect(Array.from(result.animation.frames[0].pixels)).toEqual([1,2,0]);
  const opaque=prepareRgbaGif({...before,transparent:false});expect(opaque.animation.transparentIndex).toBeUndefined();
  expect(Array.from(opaque.animation.palette).slice(-3)).toEqual([255,255,255]);
});
it('uses one deterministic bounded cube when shared animation colors exceed capacity',()=>{
  const frame=new Uint8Array(300*4);for(let i=0;i<300;i++)frame.set([i%256,Math.floor(i/256),127,255],i*4);
  const source={...input(),width:300,frames:[frame]};const a=prepareRgbaGif(source),b=prepareRgbaGif(source);
  expect(a).toEqual(b);expect(a.quantized).toBe(true);expect(a.animation.palette.length).toBe(217*3);
  expect(Math.max(...a.animation.frames[0].pixels)).toBeLessThan(217);
});
it('distributes fractional frame timing by absolute boundaries including selected ranges',()=>{
  const delays=gifFrameDelays(240,24);expect(delays.reduce((a,b)=>a+b,0)).toBe(1000);expect(new Set(delays)).toEqual(new Set([4,5]));
  expect(gifFrameDelays(50,29.97,17)).toEqual(gifFrameDelays(67,29.97).slice(17));
  expect(gifFrameDelays(100,100).every(n=>n===1)).toBe(true);
  for(const fps of [0,NaN,Infinity,101,0.00001])expect(()=>gifFrameDelays(1,fps)).toThrow();
  expect(()=>gifFrameDelays(2,24,Number.MAX_SAFE_INTEGER)).toThrow();
});
it('rejects malformed RGBA/matte and allocation overflow before conversion',()=>{
  for(const source of [{...input(),width:0},{...input(),frames:[]},{...input(),frames:[new Uint8Array(3)]},
    {...input(),matte:[-1,0,0] as const},{...input(),matte:[1.5,0,0] as const}])expect(()=>prepareRgbaGif(source)).toThrow();
  expect(()=>prepareRgbaGif(input(),2)).toThrow(/budget/);expect(prepareRgbaGif(input(),3).animation.frames[0].pixels.length).toBe(3);
});

it('encodes through one indexed scratch frame with byte-identical exact and reduced palettes',()=>{
  const rich=new Uint8Array(300*4);for(let i=0;i<300;i++)rich.set([i%256,Math.floor(i/256),127,i%3?255:128],i*4);
  for(const transparent of [true,false])for(const loop of [true,false])for(const frames of [input().frames,[rich,rich.slice().reverse()]]){
    const source={...input(),width:frames[0].length/4,frames:[...frames,...frames],transparent,loop,startFrame:17,fps:29.97};
    const before=structuredClone(source),prepared=prepareRgbaGif(source),expected=encodeIndexedGif(prepared.animation);
    expect(encodeRgbaGif(source,expected.length)).toEqual({bytes:expected,quantized:prepared.quantized});
    expect(source).toEqual(before);
    expect(()=>encodeRgbaGif(source,expected.length-1)).toThrow(/budget/);
    expect(()=>encodeRgbaGif(source,expected.length,source.width*source.frames.length-1)).toThrow(/budget/);
  }
});

it('analyzes discarded/reused frames incrementally with frozen configuration and guarded replay',()=>{
  const source=input(),saved=source.frames[0].slice(),analyzer=createGifPaletteAnalyzer(source,2,6);
  analyzer.append(source.frames[0]);source.frames[0].fill(0);
  expect(()=>analyzer.finish()).toThrow(/all declared/);
  expect(()=>analyzer.append(new Uint8Array(1))).toThrow(/full logical/);
  analyzer.append(saved);
  const plan=analyzer.finish(),scratch=new Uint8Array(3).fill(99);
  expect(plan.palette).toEqual(prepareRgbaGif({...input(),frames:[saved,saved]}).animation.palette);
  expect(plan.index(saved,scratch)).toBe(scratch);expect(Array.from(scratch)).toEqual([1,2,0]);
  const changed=saved.slice();changed.set([0,255,0,255],4);scratch.fill(99);
  expect(()=>plan.index(changed,scratch)).toThrow(/absent/);expect(Array.from(scratch)).toEqual([99,99,99]);
  expect(()=>plan.index(saved,new Uint8Array(saved.buffer,0,3))).toThrow(/overlapping/);
  expect(()=>analyzer.append(saved)).toThrow(/remaining/);expect(()=>analyzer.finish()).toThrow(/finished/);
  const matte=[255,255,255] as [number,number,number],frozen=createGifPaletteAnalyzer({...input(),matte},1);
  matte.fill(0);frozen.append(saved);const result=frozen.finish();
  expect(result.index(saved)).toEqual(new Uint8Array([1,2,0]));
  expect(Array.from(result.palette).slice(-3)).toEqual([127,127,255]);
});

it('ordered dithering is opt-in, detached, repeatable and preserves exact colors and transparency',()=>{
  const exact=input();expect(prepareRgbaGif({...exact,dither:'ordered'})).toEqual(prepareRgbaGif(exact));
  const rich=new Uint8Array(320*4);for(let i=0;i<320;i++)rich.set([i%256,Math.floor(i/256),127,255],i*4);
  const gray=new Uint8Array(320*4);for(let i=0;i<320;i++)gray.set([127,127,127,255],i*4);gray[3]=0;
  const config={...input(),width:20,height:16,frames:[rich,gray],dither:'ordered' as const};
  const ordered=prepareRgbaGif(config),plain=prepareRgbaGif({...config,dither:'none'});
  expect(ordered.quantized).toBe(true);expect(ordered.animation.palette).toEqual(plain.animation.palette);
  expect(ordered.animation.frames[1].pixels[0]).toBe(0);
  const levels=new Set(Array.from(ordered.animation.frames[1].pixels.slice(1)));expect(levels).toEqual(new Set([87,130]));
  expect(ordered.animation.frames[1].pixels).not.toEqual(plain.animation.frames[1].pixels);
  const analyzer=createGifPaletteAnalyzer(config,2);analyzer.append(rich);analyzer.append(gray);
  Object.assign(config,{dither:'none'});const plan=analyzer.finish();
  expect(plan.index(gray)).toEqual(ordered.animation.frames[1].pixels);
  expect(plan.index(gray)).toEqual(plan.index(gray));
  expect(()=>createGifPaletteAnalyzer({...config,dither:'random' as 'none'},2)).toThrow(/dithering/);
});
