import {expect,it,vi} from 'vitest';
vi.mock('../apps/editor/src/frame-replay',()=>({createFrameReplay:vi.fn()}));
import {newProject} from '../packages/document/src';
import {createFrameReplay} from '../apps/editor/src/frame-replay';
import {exportIVF,videoTimebase} from '../apps/editor/src/export-ivf';
it('maps common authored rates without accumulated delta rounding',()=>{
 expect(videoTimebase(24)).toEqual({rate:24,scale:1});expect(videoTimebase(29.97)).toEqual({rate:2997,scale:100});expect(videoTimebase(30000/1001)).toEqual({rate:30000,scale:1001});expect(videoTimebase(240)).toEqual({rate:240,scale:1});
});
it('rejects invalid and unrepresentable rates instead of silently rounding',()=>{
 for(const fps of [NaN,Infinity,0,241,1.0000000000000002])expect(()=>videoTimebase(fps)).toThrow();
});

it('rejects invalid ranges and capture work before allocating a renderer',async()=>{
 const p=newProject();for(const options of [{range:{start:2,end:1}},{range:{start:0,end:10001}},{timeoutMs:0}])await expect(exportIVF(p,new AbortController().signal,options)).rejects.toThrow();
 p.width=p.height=4096;p.duration=3;await expect(exportIVF(p,new AbortController().signal)).rejects.toThrow(/capture budget/);expect(createFrameReplay).not.toHaveBeenCalled();
});
