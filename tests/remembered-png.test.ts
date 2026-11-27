import {expect,it} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {prepareRememberedPNGProject} from '../apps/editor/src/remembered-png';
function fixture(){
 const p=newProject();p.duration=12;p.width=200;p.height=100;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[p.layers[0].id],0,8,'linear');p.layers[0].keys[8].shapes[0].x=160;
 const child={id:'child',name:'Child',width:200,height:100,shapes:structuredClone(p.layers[0].keys[0].shapes),timeline:{duration:12,keys:structuredClone(p.layers[0].keys.slice(1)),motionSpans:structuredClone(p.layers[0].motionSpans)}};p.symbols=[child];
 p.layers.push({id:'movies',name:'Movies',visible:true,locked:false,keys:[{frame:0,shapes:[{...ink,id:'instance',kind:'symbol',symbolId:child.id,width:200,height:100,symbolPlayback:{mode:'movie',firstFrame:2}}]}]});return p;
}
for(const frame of [4,'sequence']as const)it('prepares evaluated PNG '+frame+' artwork without changing authoring data',async()=>{
 const p=fixture(),before=structuredClone(p),out=await prepareRememberedPNGProject(p,{frame,scale:2,range:frame==='sequence'?{start:4,end:6}:undefined});
 expect(out.layers[0].keys[4].shapes[0].x).toBe(80);expect(out.symbols![0].timeline!.keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);
 expect(out.layers[0].keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(p.layers[0].keys.filter(k=>[0,8,10].includes(k.frame)));expect(out.layers[0].motionSpans).toEqual(p.layers[0].motionSpans);expect(out.layers[1].keys).toEqual(p.layers[1].keys);expect(p).toEqual(before);
 out.layers[0].keys[4].shapes[0].x=999;expect(p.layers[0].keys[4].shapes[0].x).toBe(40);
});
for(const request of [
 {frame:-1,scale:1},{frame:12,scale:1},{frame:.5,scale:1},{frame:'sequence' as const,scale:0},
 {frame:'sequence' as const,scale:1,range:{start:5,end:4}}, {frame:'sequence' as const,scale:1,range:{start:0,end:12}},
 {frame:'sequence' as const,scale:1,sheet:true,padding:-1},
])it('admits original PNG options before recipe reconstruction '+JSON.stringify(request),async()=>{
 const p=fixture();p.layers[0].keys[1].shapes[0].x++;await expect(prepareRememberedPNGProject(p,request)).rejects.not.toThrow('Generated keys changed');
});
it('preserves existing raster budgets before evaluating geometry',async()=>{
 const p=fixture();p.width=p.height=8192;p.layers[0].keys[1].shapes[0].x++;await expect(prepareRememberedPNGProject(p,{frame:'sequence',scale:2,sheet:true,padding:0})).rejects.toThrow('PNG output exceeds');
});
for(const mode of ['root','child']as const)it('rejects edited '+mode+' before returning a capture project',async()=>{
 const p=fixture();if(mode==='root')p.layers[0].keys[1].shapes[0].x++;else p.symbols![0].timeline!.keys[0].shapes[0].x++;const before=structuredClone(p);await expect(prepareRememberedPNGProject(p,{frame:4,scale:1})).rejects.toThrow('Generated keys changed');expect(p).toEqual(before);
});
for(const mode of ['abort','source']as const)it('rejects pending PNG preparation after '+mode,async()=>{
 const p=fixture(),controller=new AbortController();let valid=true;const before=structuredClone(p),job=prepareRememberedPNGProject(p,{frame:'sequence',scale:1},{signal:controller.signal,validate:()=>{if(!valid)throw new Error('source changed');}});
 if(mode==='abort')controller.abort();else valid=false;await expect(job).rejects.toThrow();expect(p).toEqual(before);
});
it('validates original numeric artwork before document serialization',async()=>{const p=fixture();p.layers[0].keys[0].shapes[0].x=NaN;await expect(prepareRememberedPNGProject(p,{frame:4,scale:1})).rejects.toThrow('Invalid project');});
