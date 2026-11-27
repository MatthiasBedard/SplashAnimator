import {expect,it} from 'vitest';
import {createGifChunkStreamProcessor} from '../packages/export-video/src/gif-chunk-stream';
import {encodeRgbaGif} from '../packages/export-video/src/gif-rgba';
const settings=(width=60000)=>({width,height:1,frameCount:1,fps:24,matte:[0,0,0] as const,transparent:false});
it('withholds operation completion until all owned chunks are acknowledged',()=>{
  const process=createGifChunkStreamProcessor(),s=settings(),frame=new Uint8Array(s.width*4).fill(255),chunks:Uint8Array[]=[];
  process({seq:0,kind:'init',settings:s,maxBytes:200000,maxIndexedBytes:60000});
  process({seq:1,kind:'analyze',frame});process({seq:2,kind:'seal'});
  for(const request of [{seq:3,kind:'index' as const,frame},{seq:4,kind:'finish' as const}]){
    let result=process(request);
    while(result.kind==='chunk'){chunks.push(result.bytes);result=process({kind:'ack-chunk',seq:result.seq,chunkId:result.chunkId});}
    expect(result.seq).toBe(request.seq);expect(result.phase).toBe(request.kind==='finish'?'done':'index');
  }
  expect(chunks.length).toBeGreaterThan(1);expect(chunks.every(c=>c.length<=65536)).toBe(true);
  expect(new Uint8Array(chunks.flatMap(c=>Array.from(c)))).toEqual(encodeRgbaGif({...s,frames:[frame]}).bytes);
  expect(()=>process({seq:5,kind:'finish'})).toThrow(/closed/);
});
it('rejects skipped acknowledgments and pending byte overflow terminally',()=>{
  for(const overflow of [false,true]){
    const process=createGifChunkStreamProcessor(65536),s={...settings(60000),height:overflow?2:1},frame=new Uint8Array(s.width*s.height*4).fill(255);
    process({seq:0,kind:'init',settings:s,maxBytes:300000,maxIndexedBytes:120000});process({seq:1,kind:'analyze',frame});process({seq:2,kind:'seal'});
    if(overflow)expect(()=>process({seq:3,kind:'index',frame})).toThrow(/budget/);
    else{expect(process({seq:3,kind:'index',frame}).kind).toBe('chunk');expect(()=>process({seq:4,kind:'finish'})).toThrow(/acknowledgment/);}
    expect(()=>process({seq:4,kind:'finish'})).toThrow(/closed/);
  }
});
