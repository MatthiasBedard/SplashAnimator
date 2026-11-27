import {expect,it} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {prepareRememberedGIFProject} from '../apps/editor/src/remembered-gif';
function fixture(){
 const p=newProject();p.duration=12;p.width=200;p.height=100;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[p.layers[0].id],0,8,'linear');p.layers[0].keys[8].shapes[0].x=160;
 const child={id:'child',name:'Child',width:200,height:100,shapes:structuredClone(p.layers[0].keys[0].shapes),timeline:{duration:12,keys:structuredClone(p.layers[0].keys.slice(1)),motionSpans:structuredClone(p.layers[0].motionSpans)}};p.symbols=[child];
 p.layers.push({id:'movies',name:'Movies',visible:true,locked:false,keys:[{frame:0,shapes:[{...ink,id:'instance',kind:'symbol',symbolId:child.id,width:200,height:100,symbolPlayback:{mode:'movie',firstFrame:2}}]}]});return p;
}
for(const range of [undefined,{start:4,end:6}])it('evaluates detached GIF root and child artwork '+JSON.stringify(range),async()=>{
 const p=fixture(),before=structuredClone(p),out=await prepareRememberedGIFProject(p,{range,dither:'ordered',compression:'dictionary'});
 expect(out.layers[0].keys[4].shapes[0].x).toBe(80);expect(out.symbols![0].timeline!.keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);expect(out.layers[0].keys[8]).toEqual(p.layers[0].keys[8]);expect(out.layers[0].keys[10]).toEqual(p.layers[0].keys[10]);expect(out.layers[0].motionSpans).toEqual(p.layers[0].motionSpans);expect(out.layers[1]).toEqual(p.layers[1]);expect(p).toEqual(before);out.layers[0].keys[4].shapes[0].x=999;expect(p).toEqual(before);
});
for(const range of [{start:-1,end:4},{start:5,end:4},{start:0,end:12},{start:.5,end:4}])it('rejects GIF range before reconstruction '+JSON.stringify(range),async()=>{const p=fixture();p.layers[0].keys[1].shapes[0].x++;await expect(prepareRememberedGIFProject(p,{range,dither:'none',compression:'literal'})).rejects.toThrow('Invalid GIF frame range');});
for(const mode of ['root','child','numeric','budget','abort','source']as const)it('rejects remembered GIF '+mode+' atomically',async()=>{
 const p=fixture(),controller=new AbortController();let valid=true;
 if(mode==='root')p.layers[0].keys[1].shapes[0].x++;if(mode==='child')p.symbols![0].timeline!.keys[0].shapes[0].x++;if(mode==='numeric')p.layers[0].keys[0].shapes[0].x=NaN;if(mode==='budget')p.width=p.height=4096;
 const before=structuredClone(p),job=prepareRememberedGIFProject(p,{dither:'none',compression:'literal'},{signal:controller.signal,validate:()=>{if(!valid)throw Error('source changed');}});
 if(mode==='abort')controller.abort();if(mode==='source')valid=false;await expect(job).rejects.toThrow();expect(p).toEqual(before);
});
it('shares original codec option admission',async()=>{const p=fixture();await expect(prepareRememberedGIFProject(p,{dither:'bad' as 'none',compression:'literal'})).rejects.toThrow('Invalid GIF dithering');await expect(prepareRememberedGIFProject(p,{dither:'none',compression:'bad' as 'literal'})).rejects.toThrow('Invalid GIF compression');});

it('rejects unsupported GIF timing before reconstruction',async()=>{const p=fixture();p.fps=120;p.layers[0].keys[1].shapes[0].x++;await expect(prepareRememberedGIFProject(p,{dither:'none',compression:'literal'})).rejects.toThrow('100');});
