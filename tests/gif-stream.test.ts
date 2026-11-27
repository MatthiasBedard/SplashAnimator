import {expect,it} from 'vitest';
import {createGifStreamProcessor,type GifStreamRequest} from '../packages/export-video/src/gif-stream';
import {encodeRgbaGif} from '../packages/export-video/src/gif-rgba';
const settings=()=>({width:1,height:1,frameCount:2,fps:24,startFrame:2,matte:[255,255,255] as [number,number,number],transparent:true,loop:true});
const init=():GifStreamRequest=>({seq:0,kind:'init',settings:settings(),maxBytes:4096,maxIndexedBytes:2});
it('encodes ordered two-pass frames with detached configuration and identical timing/bytes',()=>{
  const process=createGifStreamProcessor(),config=init(),frames=[new Uint8Array([255,0,0,255]),new Uint8Array([0,0,255,128])];
  expect(process(config)).toEqual({seq:0,phase:'analyze',accepted:0});
  if(config.kind==='init')config.settings.matte=[0,0,0];
  const reused=frames[0].slice();process({seq:1,kind:'analyze',frame:reused});reused.set(frames[1]);
  process({seq:2,kind:'analyze',frame:reused});reused.fill(0);
  expect(process({seq:3,kind:'seal'})).toEqual({seq:3,phase:'index',accepted:0});
  process({seq:4,kind:'index',frame:frames[0]});process({seq:5,kind:'index',frame:frames[1]});
  const result=process({seq:6,kind:'finish'}),expected=encodeRgbaGif({...settings(),frames});
  expect(result.bytes).toEqual(expected.bytes);expect(result.quantized).toBe(false);
  expect(()=>process({seq:7,kind:'finish'})).toThrow(/closed/);
});
it('rejects bad sequence, phase, count, replay colors and budgets terminally',()=>{
  const red=new Uint8Array([255,0,0,255]);
  const cases:GifStreamRequest[][]=[
    [{seq:1,kind:'seal'}], [init(),{seq:0,kind:'seal'}], [init(),{seq:1,kind:'index',frame:red}],
    [init(),{seq:1,kind:'seal'}], [init(),{seq:1,kind:'analyze',frame:red},{seq:2,kind:'analyze',frame:red},{seq:3,kind:'analyze',frame:red}],
    [init(),{seq:1,kind:'analyze',frame:red},{seq:2,kind:'analyze',frame:red},{seq:3,kind:'seal'},{seq:4,kind:'finish'}],
    [init(),{seq:1,kind:'analyze',frame:red},{seq:2,kind:'analyze',frame:red},{seq:3,kind:'seal'},{seq:4,kind:'index',frame:new Uint8Array([0,255,0,255])}],
    [{...init(),kind:'init',settings:settings(),maxBytes:0,maxIndexedBytes:2}],
  ];
  for(const requests of cases){const process=createGifStreamProcessor();for(const request of requests.slice(0,-1))process(request);
    expect(()=>process(requests.at(-1)!)).toThrow();expect(()=>process(init())).toThrow(/closed/);}
});

it('retains ordered dithering through two-pass settings and indexed scratch reuse',()=>{
  const frame=new Uint8Array(320*4);for(let i=0;i<320;i++)frame.set([i%256,Math.floor(i/256),127,255],i*4);
  const config={...settings(),width:20,height:16,dither:'ordered' as const},process=createGifStreamProcessor();
  process({seq:0,kind:'init',settings:config,maxBytes:10000,maxIndexedBytes:640});
  Object.assign(config,{dither:'none'});
  process({seq:1,kind:'analyze',frame});process({seq:2,kind:'analyze',frame});process({seq:3,kind:'seal'});
  process({seq:4,kind:'index',frame});process({seq:5,kind:'index',frame});
  expect(process({seq:6,kind:'finish'}).bytes).toEqual(encodeRgbaGif({...config,dither:'ordered',frames:[frame,frame]}).bytes);
});
it('propagates detached dictionary compression through RGBA and both stream outputs',()=>{
 const config={...settings(),width:4096,compression:'dictionary' as const},frame=new Uint8Array(4096*4).fill(255),frames=[frame,frame];
 const expected=encodeRgbaGif({...config,frames});expect(expected.bytes.length).toBeLessThan(encodeRgbaGif({...config,compression:'literal',frames}).bytes.length/4);
 for(const chunked of [false,true]){const chunks:Uint8Array[]=[],process=createGifStreamProcessor(chunked?c=>{chunks.push(c);}:undefined),input={...config};process({seq:0,kind:'init',settings:input,maxBytes:expected.bytes.length,maxIndexedBytes:8192});Object.assign(input,{compression:'literal'});process({seq:1,kind:'analyze',frame});process({seq:2,kind:'analyze',frame});process({seq:3,kind:'seal'});process({seq:4,kind:'index',frame});process({seq:5,kind:'index',frame});const result=process({seq:6,kind:'finish'});expect(chunked?new Uint8Array(chunks.flatMap(c=>Array.from(c))):result.bytes).toEqual(expected.bytes);}
 for(const compression of [null,'wrong',1]){expect(()=>encodeRgbaGif({...config,frames,compression:compression as 'literal'})).toThrow(/compression/);const process=createGifStreamProcessor();expect(()=>process({seq:0,kind:'init',settings:{...config,compression:compression as 'literal'},maxBytes:4096,maxIndexedBytes:8192})).toThrow(/compression/);expect(()=>process(init())).toThrow(/closed/);}
});
