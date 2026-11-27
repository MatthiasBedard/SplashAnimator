import {expect,it} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {worldPoint} from '../packages/geometry/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {prepareSymbolRememberedButton} from '../packages/animation/src/symbol-remembered-button';
import type {SymbolAuthoringSource} from '../packages/animation/src/symbol-motion-owner';
function fixture(affine=false){
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:affine?30:0,transform:affine?[1,0,Math.tan(20*Math.PI/180),1]:undefined,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const make=(id:string)=>{
  const p=newProject();p.duration=12;p.layers[0].keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];
  createBasicMotionSpan(p,[p.layers[0].id],0,8,'linear',{affine:true});p.layers[0].keys[8].shapes[0].x=160;
  return {id,name:id,width:200,height:100,shapes:p.layers[0].keys[0].shapes,timeline:{duration:12,keys:p.layers[0].keys.slice(1),motionSpans:p.layers[0].motionSpans,layers:[] as typeof p.layers}};
 };
 const child=make('child'),parent=make('parent');
 const movie:Vector={...ink,id:'movie',kind:'symbol',rotation:0,transform:undefined,symbolId:child.id,width:200,height:100,y:25,symbolPlayback:{mode:'movie',firstFrame:0}};
 parent.timeline.layers=[{id:'movies',name:'Movies',visible:true,locked:false,keys:[{frame:0,shapes:[movie,{...movie,id:'sibling',y:50,symbolPlayback:{mode:'movie',firstFrame:2}}]}]}];
 const definition={...parent,buttonStates:{up:2,over:2,down:6,hit:4}};
 const state:SymbolAuthoringSource={definition,symbols:[child,definition],revision:0,frame:0};return {state,child};
}
it('evaluates remembered mapped poses and independent state movies without publishing source writes',async()=>{
 const {state}=fixture(),before=structuredClone(state),session=await prepareSymbolRememberedButton(()=>state,10);
 expect(session.mapping).toEqual({up:2,over:2,down:6,hit:4});
 expect(session.sample('up',100).shapes.map(s=>s.x)).toEqual([40,0,40]);
 expect(session.sample('over',100.4).shapes.map(s=>s.x)).toEqual([40,80,120]);
 expect(Object.values(session.origins())).toEqual([100,100]);
 expect(session.sample('down',100.4).shapes.map(s=>s.x)).toEqual([120,0,40]);
 expect(Object.values(session.origins())).toEqual([100.4,100.4]);
 expect(session.sample('down',100.6).shapes.map(s=>s.x)).toEqual([120,40,80]);
 expect(session.sample('up',101).shapes.map(s=>s.x)).toEqual([40,0,40]);expect(state).toEqual(before);session.dispose();
});
it('freezes evaluated Hit and child movie authoring poses while display clocks advance',async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedButton(()=>state,10),frozen=session.hitArtwork();
 expect(frozen.map(s=>s.x)).toEqual([80,0,40]);expect(session.contains({x:82,y:2})).toBe(true);expect(session.contains({x:42,y:2})).toBe(false);
 expect(session.contains({x:2,y:27})).toBe(true);expect(session.contains({x:82,y:27})).toBe(false);
 session.sample('up',0);session.sample('over',.4);session.sample('down',.5);session.sample('down',.9);
 expect(session.hitArtwork()).toEqual(frozen);expect(session.contains({x:2,y:27})).toBe(true);expect(session.contains({x:82,y:27})).toBe(false);session.dispose();
});
it('returns detached mappings, poses, origins, frame maps and frozen geometry',async()=>{
 const {state}=fixture(),before=structuredClone(state),session=await prepareSymbolRememberedButton(()=>state,10);
 const mapping=session.mapping;mapping.hit=0;session.hitArtwork()[0].x=999;
 const pose=session.sample('up',100);pose.shapes[0].x=999;for(const key of Object.keys(pose.frames))pose.frames[key]=999;
 const origins=session.origins();for(const key of Object.keys(origins))origins[key]=999;
 expect(session.mapping.hit).toBe(4);expect(session.hitArtwork()[0].x).toBe(80);expect(session.sample('up',100).shapes.map(s=>s.x)).toEqual([40,0,40]);expect(Object.values(session.origins())).toEqual([100,100]);expect(state).toEqual(before);session.dispose();
});
it('keeps separate sessions and fresh state lifetimes independent',async()=>{
 const {state}=fixture(),a=await prepareSymbolRememberedButton(()=>state,10),b=await prepareSymbolRememberedButton(()=>state,10);
 a.sample('up',100);expect(a.sample('over',100.4).shapes[1].x).toBe(80);expect(b.sample('up',100.4).shapes[1].x).toBe(0);
 expect(a.sample('up',90).shapes[1].x).toBe(0);expect(Object.values(a.origins())).toEqual([90,90]);a.dispose();expect(()=>a.hitArtwork()).toThrow('disposed');expect(b.sample('up',100.5).shapes[1].x).toBe(20);b.dispose();
});
it('retains affine Hit placement and rejects the untransformed bounds corner',async()=>{
 const {state}=fixture(true),session=await prepareSymbolRememberedButton(()=>state,10),root={...state.definition.shapes[0],x:80};
 const center=worldPoint(root,{x:6,y:6});expect(center.x).toBeCloseTo(80+6*Math.cos(Math.PI/6)+6*(Math.tan(Math.PI/9)*Math.cos(Math.PI/6)-.5),12);expect(session.contains(center)).toBe(true);expect(session.contains({x:91,y:1})).toBe(false);
 const [shape]=session.hitArtwork();expect(worldPoint(shape,{x:6,y:6}).x).toBeCloseTo(center.x,12);expect(worldPoint(shape,{x:6,y:6}).y).toBeCloseTo(center.y,12);session.dispose();
});
it('uses legacy default mappings without adding them to the source',async()=>{
 const {state}=fixture();delete state.definition.buttonStates;const before=structuredClone(state),session=await prepareSymbolRememberedButton(()=>state,10);
 expect(session.mapping).toEqual({up:0,over:1,down:2,hit:3});expect(session.sample('up',0).shapes[0].x).toBe(0);expect(session.sample('over',.4).shapes.map(s=>s.x)).toEqual([20,0,40]);expect(state).toEqual(before);session.dispose();
});
it('retains exact authored endpoint mappings and admits an empty frozen Hit',async()=>{
 const {state}=fixture();state.definition.buttonStates={up:0,over:8,down:8,hit:10};state.definition.timeline!.layers![0].keys.push({frame:10,shapes:[]});
 const session=await prepareSymbolRememberedButton(()=>state,10);expect(session.sample('over',0).shapes[0].x).toBe(160);expect(session.hitArtwork()).toEqual([]);expect(session.contains({x:1,y:1})).toBe(false);session.dispose();
});
for(const mode of ['hidden','unused','locked']as const)it('preserves '+mode+' child data and read-only admission',async()=>{
 const {state,child}=fixture();
 if(mode==='hidden'){child.timeline.layers=[{...structuredClone(state.definition.timeline!.layers![0]),id:'hidden',visible:false,keys:structuredClone([{frame:0,shapes:child.shapes},...child.timeline.keys]),motionSpans:structuredClone(child.timeline.motionSpans)}];child.timeline.layers[0].keys[1].shapes[0].x++;}
 if(mode==='unused'){const unused=structuredClone(child);unused.id='unused';unused.timeline.keys[0].shapes[0].x++;state.symbols.push(unused);}
 if(mode==='locked')child.timeline.layers=[{id:'locked',name:'Locked',visible:true,locked:true,keys:structuredClone([{frame:0,shapes:child.shapes},...child.timeline.keys]),motionSpans:structuredClone(child.timeline.motionSpans)}];
 const before=structuredClone(state),session=await prepareSymbolRememberedButton(()=>state,10);expect(session.sample('up',0).shapes[0].x).toBe(40);expect(state).toEqual(before);session.dispose();
});
for(const mode of ['parent','child','later-track','later-reference']as const)it('rejects edited '+mode+' atomically before returning state or Hit',async()=>{
 const {state,child}=fixture();
 if(mode==='parent')state.definition.timeline!.keys[0].shapes[0].x++;
 if(mode==='child')child.timeline.keys[0].shapes[0].x++;
 if(mode==='later-track'){child.timeline.layers=[{id:'later',name:'Later',visible:true,locked:false,keys:structuredClone([{frame:0,shapes:child.shapes},...child.timeline.keys]),motionSpans:structuredClone(child.timeline.motionSpans)}];child.timeline.layers[0].keys[1].shapes[0].x++;}
 if(mode==='later-reference'){const bad=structuredClone(child);bad.id='bad';bad.timeline.keys[0].shapes[0].x++;state.symbols.push(bad);state.definition.timeline!.layers!.push({id:'late',name:'Late',visible:true,locked:false,keys:[{frame:0,shapes:[]},{frame:8,shapes:[{...state.definition.timeline!.layers![0].keys[0].shapes[0],symbolId:bad.id}]}]});}
 const before=structuredClone(state);await expect(prepareSymbolRememberedButton(()=>state,10)).rejects.toThrow('Generated keys changed');expect(state).toEqual(before);
});
for(const name of ['up','over','down','hit']as const)for(const value of [-1,12,.5,NaN,Infinity])it('rejects original invalid '+name+' mapping '+value,async()=>{
 const {state}=fixture();state.definition.buttonStates![name]=value;await expect(prepareSymbolRememberedButton(()=>state,10)).rejects.toThrow();
});
it('rejects fallback mappings when the definition is shorter than four frames',async()=>{
 const {state}=fixture();state.definition={...state.definition,timeline:{duration:3,keys:[]}};delete state.definition.buttonStates;state.symbols=[state.definition];await expect(prepareSymbolRememberedButton(()=>state,10)).rejects.toThrow('mapping');
});
it('rejects invalid public pose, time and Hit inputs without changing clock continuity',async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedButton(()=>state,10);session.sample('up',100);
 for(const pose of ['hit','UP','',null])expect(()=>session.sample(pose as 'up',100.4)).toThrow('display state');
 for(const seconds of [-1,NaN,Infinity])expect(()=>session.sample('up',seconds)).toThrow('time');
 for(const point of [{x:NaN,y:0},{x:0,y:Infinity},null])expect(()=>session.contains(point!)).toThrow('Hit point');
 expect(session.sample('over',100.4).shapes[1].x).toBe(80);session.dispose();
});
for(const mode of ['abort','revision','library','definition-reference','library-reference','frame','mapping','context']as const)it('rejects pending state preparation after '+mode,async()=>{
 const {state}=fixture(),controller=new AbortController();let valid=true;
 const job=prepareSymbolRememberedButton(()=>state,10,{signal:controller.signal,validate:()=>{if(!valid)throw new Error('Context closed.');}});
 if(mode==='abort')controller.abort();if(mode==='revision')state.revision++;if(mode==='library')state.symbols[0].name='Changed';if(mode==='definition-reference')state.definition=structuredClone(state.definition);if(mode==='library-reference')state.symbols=[...state.symbols];if(mode==='frame')state.frame++;if(mode==='mapping')state.definition.buttonStates!.hit=3;if(mode==='context')valid=false;
 await expect(job).rejects.toThrow();
});
for(const mode of ['sample','mapping','hit','contains','origins']as const)it('validates live source before returning '+mode,async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedButton(()=>state,10);session.sample('up',0);state.symbols[0].name='Changed';
 const read=()=>mode==='sample'?session.sample('up',.1):mode==='mapping'?session.mapping:mode==='hit'?session.hitArtwork():mode==='contains'?session.contains({x:82,y:2}):session.origins();expect(read).toThrow('source changed');session.dispose();
});
it('rejects a source edit forced during detached Hit readout',async()=>{
 const {state}=fixture(),session=await prepareSymbolRememberedButton(()=>state,10),original=globalThis.structuredClone;
 try{globalThis.structuredClone=((value:unknown)=>{const copy=original(value);state.revision++;return copy;}) as typeof structuredClone;expect(()=>session.hitArtwork()).toThrow('source changed');}
 finally{globalThis.structuredClone=original;session.dispose();}
});
for(const fps of [0,121,NaN])it('retains original timing admission at '+fps,async()=>{const {state}=fixture();await expect(prepareSymbolRememberedButton(()=>state,fps)).rejects.toThrow('frame rate');});

for(const mode of ['root','child','hidden']as const)it('rejects nonfinite original '+mode+' values before snapshot conversion',async()=>{
 const {state,child}=fixture();
 if(mode==='root')state.definition.shapes[0].x=NaN;
 if(mode==='child')child.width=Infinity;
 if(mode==='hidden')state.definition.timeline!.layers!.push({id:'hidden',name:'Hidden',visible:false,locked:false,keys:[{frame:0,shapes:[{...state.definition.shapes[0],x:NaN}]}]});
 await expect(prepareSymbolRememberedButton(()=>state,10)).rejects.toThrow('nonfinite original');
});
for(const mode of ['missing','cycle','duplicate']as const)it('rejects original '+mode+' reachable identities before returning a session',async()=>{
 const {state,child}=fixture();
 if(mode==='missing')state.definition.timeline!.layers![0].keys[0].shapes[0].symbolId='missing';
 if(mode==='cycle')child.timeline.layers=[{id:'cycle',name:'Cycle',visible:true,locked:false,keys:[{frame:0,shapes:[{...state.definition.timeline!.layers![0].keys[0].shapes[0],symbolId:state.definition.id}]}]}];
 if(mode==='duplicate')state.symbols.push(structuredClone(child));
 const before=structuredClone(state);await expect(prepareSymbolRememberedButton(()=>state,10)).rejects.toThrow();expect(state).toEqual(before);
});
