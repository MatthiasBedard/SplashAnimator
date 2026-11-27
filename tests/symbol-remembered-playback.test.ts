import {expect,it} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {prepareSymbolRememberedPlayback} from '../packages/animation/src/symbol-remembered-playback';
import type {SymbolAuthoringSource} from '../packages/animation/src/symbol-motion-owner';
function fixture(){
 const p=newProject();p.duration=12;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const layer=p.layers[0];layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[layer.id],0,8,'linear');layer.keys[8].shapes[0].x=160;
 const child={id:'child',name:'Child',width:200,height:60,shapes:layer.keys[0].shapes,timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans}};
 const parent=structuredClone(child);parent.id='parent';parent.name='Parent';
 for(const key of [{shapes:parent.shapes},...parent.timeline.keys])for(const s of key.shapes)s.fill='#0000ff';
 // Regenerate the parent baseline after its paint change, then edit only its authored endpoint.
 const root=newProject();root.duration=12;root.layers[0].keys=[{frame:0,shapes:parent.shapes},{frame:8,shapes:[{...parent.shapes[0],x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(root,[root.layers[0].id],0,8,'linear');root.layers[0].keys[8].shapes[0].x=160;
 parent.shapes=root.layers[0].keys[0].shapes;parent.timeline={duration:12,keys:root.layers[0].keys.slice(1),motionSpans:root.layers[0].motionSpans};
 const movie:Vector={...ink,id:'movie',kind:'symbol',symbolId:child.id,width:200,height:60,y:25,symbolPlayback:{mode:'movie',firstFrame:0}};
 const definition={...parent,timeline:{...parent.timeline,layers:[{id:'overlay',name:'Overlay',visible:true,locked:false,keys:[{frame:0,shapes:[movie]}]}]}};
 const state:SymbolAuthoringSource={definition,symbols:[child,definition],revision:0,frame:4};return {state,child};
}
it('evaluates parent and movie child with independent one-frame clocks without source writes',async()=>{
 const {state}=fixture(),before=structuredClone(state),session=await prepareSymbolRememberedPlayback(()=>state,10,4,4);
 const first=session.sample(4,0,4);expect(first.shapes.map(s=>s.x)).toEqual([80,0]);
 const later=session.sample(4,.4,8);expect(later.shapes.map(s=>s.x)).toEqual([80,80]);expect(Object.values(later.frames)).toEqual([4]);
 later.shapes[0].x=999;expect(session.sample(4,.4,8).shapes[0].x).toBe(80);expect(state).toEqual(before);
 session.dispose();expect(()=>session.sample(4,.5,9)).toThrow('disposed');
 const next=await prepareSymbolRememberedPlayback(()=>state,10,4,4);expect(next.sample(4,0,4).shapes.map(s=>s.x)).toEqual([80,0]);next.dispose();
});
it('keeps exact authored endpoints and outside blanks across a full prepared session',async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedPlayback(()=>state,10,0,11);
 expect(session.sample(0,0,0).shapes.map(s=>s.x)).toEqual([0,0]);
 expect(session.sample(4,.4,4).shapes.map(s=>s.x)).toEqual([80,80]);
 expect(session.sample(8,.8,8).shapes.map(s=>s.x)).toEqual([160,160]);
 expect(session.sample(10,1,10).shapes).toEqual([]);session.dispose();
});
it('preserves graphic exposure ages instead of applying the movie clock',async()=>{
 const {state}=fixture();state.definition.timeline!.layers![0].keys[0].shapes[0].symbolPlayback={mode:'loop',firstFrame:0};
 const session=await prepareSymbolRememberedPlayback(()=>state,10,4,4);
 expect(session.sample(4,0,4).shapes.map(s=>s.x)).toEqual([80,80]);expect(session.sample(4,.4,8).shapes.map(s=>s.x)).toEqual([80,80]);session.dispose();
});
for(const mode of ['parent','child','later']as const)it('atomically rejects edited '+mode+' generated artwork',async()=>{
 const {state,child}=fixture();
 if(mode==='parent')state.definition.timeline!.keys[0].shapes[0].x++;
 else if(mode==='child')child.timeline.keys[0].shapes[0].x++;
 else{const bad=structuredClone(child);bad.id='later';bad.timeline.keys[0].shapes[0].x++;state.symbols.push(bad);state.definition.timeline!.layers!.push({id:'later-reference',name:'Later',visible:true,locked:false,keys:[{frame:0,shapes:[]},{frame:8,shapes:[{...state.definition.timeline!.layers![0].keys[0].shapes[0],symbolId:bad.id}]}]});}
 const before=structuredClone(state);await expect(prepareSymbolRememberedPlayback(()=>state,10,4,4)).rejects.toThrow('Generated keys changed');expect(state).toEqual(before);
});
for(const mode of ['abort','source','library','frame','dispose-context']as const)it('rejects pending playback after '+mode,async()=>{
 const {state}=fixture(),controller=new AbortController();let valid=true;
 const job=prepareSymbolRememberedPlayback(()=>state,10,4,4,{signal:controller.signal,validate:()=>{if(!valid)throw new Error('Context closed.');}});
 if(mode==='abort')controller.abort();if(mode==='source')state.revision++;if(mode==='library')state.symbols[0].name='Changed';if(mode==='frame')state.frame++;if(mode==='dispose-context')valid=false;
 await expect(job).rejects.toThrow();
});
it('checks live source and external admission on every sampled pose',async()=>{
 const {state}=fixture();let valid=true;const session=await prepareSymbolRememberedPlayback(()=>state,10,4,4,{validate:()=>{if(!valid)throw new Error('Enclosing changed.');}});
 session.sample(4,0,4);valid=false;expect(()=>session.sample(4,.1,5)).toThrow('Enclosing changed');valid=true;state.symbols[0].name='Changed';expect(()=>session.sample(4,.1,5)).toThrow('source changed');session.dispose();
});
for(const [first,last]of [[-1,4],[4,12],[5,4],[.5,4]])it('rejects invalid playback range '+first+':'+last,async()=>{
 const {state}=fixture();await expect(prepareSymbolRememberedPlayback(()=>state,10,first,last)).rejects.toThrow('range');
});

for(const fps of [0,-1,121,NaN,Infinity,-Infinity])it('rejects original invalid frame rate '+fps,async()=>{
 const {state}=fixture();await expect(prepareSymbolRememberedPlayback(()=>state,fps,4,4)).rejects.toThrow('frame rate');
});
it('rejects invalid sample coordinates before clock advancement and keeps the valid session usable',async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedPlayback(()=>state,10,4,4);
 for(const [frame,seconds,position]of [[3,0,4],[4,NaN,4],[4,-1,4],[4,0,3],[4,0,Infinity],[4,Infinity,4]])expect(()=>session.sample(frame,seconds,position)).toThrow('frame');
 expect(session.sample(4,0,4).shapes.map(s=>s.x)).toEqual([80,0]);session.dispose();
});
it('restores nested movie lifetime after disappearance and reentry in the prepared parent',async()=>{
 const {state}=fixture(),layer=state.definition.timeline!.layers![0],movie=layer.keys[0].shapes[0];
 layer.keys=[{frame:0,shapes:[movie]},{frame:2,shapes:[]},{frame:4,shapes:[movie]}];
 const session=await prepareSymbolRememberedPlayback(()=>state,10,0,8);
 expect(session.sample(0,0,0).shapes.map(s=>s.x)).toEqual([0,0]);
 expect(session.sample(1,.1,1).shapes.map(s=>s.x)).toEqual([20,20]);
 expect(session.sample(2,.2,2).shapes.map(s=>s.x)).toEqual([40]);
 expect(session.sample(4,.4,4).shapes.map(s=>s.x)).toEqual([80,0]);
 expect(session.sample(5,.5,5).shapes.map(s=>s.x)).toEqual([100,20]);session.dispose();
});
