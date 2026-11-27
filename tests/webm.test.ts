import {expect,it} from 'vitest';
import {createWebmWriter} from '../packages/export-video/src/webm';
const settings={width:32,height:32,frameCount:2,rate:30000,scale:1001};
it('snapshots packets/settings and produces a closed complete WebM with keyframe cues',()=>{
 const options={...settings},w=createWebmWriter(options);options.width=99;const p=new Uint8Array([7,8,9]);w.append(p,true);p.fill(0);w.append(new Uint8Array([4,5]),false);const r=w.finish();expect(Array.from(r.bytes.slice(0,4))).toEqual([26,69,223,163]);expect(r.byteLength).toBe(r.bytes.length);expect(r.frameCount).toBe(2);expect(new TextDecoder().decode(r.bytes)).toContain('V_VP8');expect(Array.from(r.bytes).join(',')).toContain('7,8,9');expect(()=>w.finish()).toThrow(/closed/);expect(()=>w.append(p,true)).toThrow(/closed/);
});
it('rejects original invalid settings, incomplete/count/packet/budget inputs and supports abort',()=>{
 for(const bad of [{width:0},{rate:NaN},{scale:0},{frameCount:10002},{rate:241,scale:1}])expect(()=>createWebmWriter({...settings,...bad})).toThrow();
 expect(()=>createWebmWriter(settings,100)).toThrow(/budget/);const w=createWebmWriter(settings,1538);expect(()=>w.finish()).toThrow(/incomplete/);expect(()=>w.append(new Uint8Array([1]),false)).toThrow(/keyframe/);expect(()=>w.append(new Uint8Array(new SharedArrayBuffer(1)),true)).toThrow();expect(()=>w.append(new Uint8Array(3),true)).toThrow(/budget/);w.append(new Uint8Array([1]),true);w.append(new Uint8Array([2]),false);expect(()=>w.append(new Uint8Array([3]),true)).toThrow(/count/);expect(w.finish().byteLength).toBeLessThan(1538);const a=createWebmWriter(settings);a.abort();expect(()=>a.finish()).toThrow(/closed/);
});
it('stores exact rational microsecond boundaries and cue offsets that address cluster IDs',()=>{
 const w=createWebmWriter({...settings,frameCount:3});for(let i=0;i<3;i++)w.append(new Uint8Array([i+1]),i!==1);const {bytes}=w.finish();
 const read=(start:number,end:number)=>{const nodes:{id:number;start:number;data:number;end:number}[]=[];let at=start;while(at<end){const begin=at;let size=1;while(!(bytes[at]&(128>>(size-1))))size++;let id=0;for(let i=0;i<size;i++)id=id*256+bytes[at++];size=1;while(!(bytes[at]&(128>>(size-1))))size++;let length=bytes[at++]&((1<<(8-size))-1);for(let i=1;i<size;i++)length=length*256+bytes[at++];nodes.push({id,start:begin,data:at,end:at+length});at+=length;}expect(at).toBe(end);return nodes;};
 const value=(n:{data:number;end:number})=>bytes.slice(n.data,n.end).reduce((v,b)=>v*256+b,0);
 const segment=read(0,bytes.length)[1],children=read(segment.data,segment.end),clusters=children.filter(n=>n.id===0x1f43b675);expect(clusters.map(c=>value(read(c.data,c.end)[0]))).toEqual([0,33367,66733]);
 const info=children.find(n=>n.id===0x1549a966)!,duration=read(info.data,info.end).find(n=>n.id===0x4489)!;expect(new DataView(bytes.buffer).getFloat64(duration.data)).toBe(100100);
 const cues=children.find(n=>n.id===0x1c53bb6b)!;const offsets=read(cues.data,cues.end).map(c=>{const positions=read(c.data,c.end)[1];return value(read(positions.data,positions.end)[1]);});expect(offsets).toEqual([clusters[0].start-segment.data,clusters[2].start-segment.data]);
 const seek=children[0],entry=read(seek.data,seek.end)[0];expect(value(read(entry.data,entry.end)[1])).toBe(cues.start-segment.data);
});
