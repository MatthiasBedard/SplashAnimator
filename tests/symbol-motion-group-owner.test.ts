import {expect,it} from 'vitest';
import {newProject,symbolLayers,symbolArtworks,MAX_SYMBOL_ARTWORK,type Vector} from '../packages/document/src';
import {worldPoint,matrix,inversePoint} from '../packages/geometry/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureSymbolRememberedAuthoringFrame,type SymbolAuthoringSource} from '../packages/animation/src/symbol-motion-owner';

function fixture():SymbolAuthoringSource{
 const p=newProject();p.duration=12;const layer=p.layers[0];
 const ink=(id:string,x:number,groups?:string[]):Vector=>({id,kind:'rectangle',x,y:0,width:12,height:12,rotation:0,
  fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}: {})});
 const shapes=[ink('under',-20),ink('b',0,['outer','inner']),ink('a',20,['outer','inner']),ink('c',40,['outer']),ink('over',100)];
 layer.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+80}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});
 const overlay=structuredClone(layer);overlay.id='overlay';overlay.motionSpans![0].id='overlay-recipe';
 const definition={id:'symbol',name:'Group',width:200,height:100,shapes:layer.keys[0].shapes,buttonStates:{up:0,over:3,down:5,hit:10},
  timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]}};
 return {definition,symbols:[definition],revision:2,frame:4} satisfies SymbolAuthoringSource;
}
for(const track of ['@base','overlay'])it('privately resolves the complete outer union in paint order on '+track,()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const owner=capture.resolveGroup(track,'a');expect(owner).toMatchObject({definitionId:'symbol',layerId:track,shapeId:'a',groupId:'outer',shapeIds:['b','a','c'],frame:4,start:0,end:8,revision:2});
 owner.shapeIds.splice(0,3,'over');
 capture.scene.find(s=>s.layerId===track)!.key.shapes.splice(0,5);
 expect(capture.resolveGroup(track,'c').shapeIds).toEqual(['b','a','c']);
 const result=capture.prepareGroupPromotion(track,'b',{x:10,y:6});
 const original=symbolLayers(state.definition).find(l=>l.id===track)!,next=symbolLayers(result).find(l=>l.id===track)!;
 expect(next.keys.find(k=>k.frame===4)!.shapes.map(s=>[s.id,s.x,s.y])).toEqual([
  ['under',20,0],['b',50,6],['a',70,6],['c',90,6],['over',140,0]]);
 for(const frame of [2,6]){
  const shapes=next.keys.find(k=>k.frame===frame)!.shapes;
  expect(shapes.find(s=>s.id==='b')!.x).toBe(frame*10+5);
  expect(shapes.find(s=>s.id==='c')!.y).toBe(3);
 }
 expect(next.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.keys.filter(k=>[0,8,10].includes(k.frame)));
 expect(next.keys[4].shapes.map(s=>s.groups)).toEqual(original.keys[4].shapes.map(s=>s.groups));
 const plain=symbolLayers(capture.prepareGroupPromotion(track,'a')).find(l=>l.id===track)!;
 expect(next.motionSpans!.map(s=>s.rotation)).toEqual(plain.motionSpans!.map(s=>s.rotation));
 const other=track==='@base'?'overlay':'@base';
 expect(symbolLayers(result).find(l=>l.id===other)).toEqual(symbolLayers(state.definition).find(l=>l.id===other));
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(result.timeline!.duration).toBe(12);
 result.shapes[0].x=999;expect(capture.prepareGroupPromotion(track,'c').shapes[0].x).toBe(-20);
 expect(state).toEqual(before);
});
it('keeps single-item ownership explicit and rejects partial rigid movement without broadening it',()=>{
 const state=fixture(),capture=captureSymbolRememberedAuthoringFrame(()=>state),before=structuredClone(state);
 expect(capture.resolve('@base','a').shapeId).toBe('a');
 expect(()=>capture.preparePromotion('@base','a',{x:10,y:6})).toThrow();
 expect(capture.prepareGroupPromotion('@base','a',{x:10,y:6})).toBeDefined();
 expect(()=>capture.resolveGroup('@base','under')).toThrow(/group/);expect(()=>capture.resolveGroup('@base','missing')).toThrow();
 expect(state).toEqual(before);
});
for(const mode of ['missing','ancestry','order','duplicate','stack']as const)it('rejects incomplete/ambiguous group '+mode,()=>{
 const state=fixture(),layer=symbolLayers(state.definition)[0];
 // Corrupt the authored endpoint, leaving the generated baseline untouched.
 const shapes=layer.keys.find(k=>k.frame===8)!.shapes;
 if(mode==='missing')shapes.splice(3,1);
 if(mode==='ancestry')shapes[3].groups=['different'];
 if(mode==='order')[shapes[1],shapes[2]]=[shapes[2],shapes[1]];
 if(mode==='duplicate')shapes[3].id='a';
 if(mode==='stack')[shapes[3],shapes[4]]=[shapes[4],shapes[3]];
 const before=structuredClone(state);
 expect(()=>captureSymbolRememberedAuthoringFrame(()=>state).prepareGroupPromotion('@base','a',{x:10,y:6})).toThrow();
 expect(state).toEqual(before);
});
for(const mode of ['frame','revision','membership','library','reference']as const)it('invalidates every member after source '+mode,()=>{
 const state=fixture(),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 capture.resolveGroup('@base','a');
 if(mode==='frame')state.frame++;
 if(mode==='revision')state.revision++;
 if(mode==='membership')state.definition.shapes[3].groups=['different'];
 if(mode==='library')state.symbols[0].name='Changed';
 if(mode==='reference')state.symbols=[...state.symbols];
 const before=structuredClone(state);
 expect(()=>capture.prepareGroupPromotion('@base','a',{x:10,y:6})).toThrow();
 expect(()=>capture.resolveGroup('@base','b')).toThrow(/invalidated/);expect(state).toEqual(before);
});
for(const offset of [{x:0,y:0},{x:NaN,y:1},{x:1,y:Infinity},{x:Number.MIN_VALUE,y:0},{x:Number.MAX_VALUE,y:0}])
 it('rejects invalid/unrepresentable group movement '+JSON.stringify(offset),()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','a',offset)).toThrow();
 expect(capture.prepareGroupPromotion('@base','a').timeline!.motionSpans).toHaveLength(2);expect(state).toEqual(before);
});
it('rechecks the live source after all detached group preparation',()=>{
 const probe=fixture();let reads=0;
 const counter=captureSymbolRememberedAuthoringFrame(()=>{reads++;return probe;});
 const start=reads;counter.prepareGroupPromotion('@base','a',{x:10,y:6});const cost=reads-start;
 const state=fixture();let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.frame++;return state;});
 flip=calls+cost;
 const before=structuredClone(state.definition);
 expect(()=>capture.prepareGroupPromotion('@base','a',{x:10,y:6})).toThrow(/changed/);
 expect(state.definition).toEqual(before);expect(state.frame).toBe(5);
});
it('disposes group ownership and preparation with the original capture',()=>{
 const state=fixture(),capture=captureSymbolRememberedAuthoringFrame(()=>state);capture.dispose();
 expect(()=>capture.resolveGroup('@base','a')).toThrow(/disposed/);
 expect(()=>capture.prepareGroupPromotion('@base','a')).toThrow(/disposed/);
});

it('admits exact aggregate capacity without dropping group members and rejects excess at capture',()=>{
 const state=fixture(),own=symbolArtworks(state.definition).reduce((n,a)=>n+a.length,0);
 const other={id:'other',name:'Other',width:10,height:10,shapes:Array(MAX_SYMBOL_ARTWORK-own).fill(state.definition.shapes[0])};
 state.symbols.push(other);
 const capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(capture.resolveGroup('@base','a').shapeIds).toEqual(['b','a','c']);capture.dispose();
 other.shapes.push(state.definition.shapes[0]);
 expect(()=>captureSymbolRememberedAuthoringFrame(()=>state)).toThrow(/budget/);
 expect(other.shapes).toHaveLength(MAX_SYMBOL_ARTWORK-own+1);
});
for(const mode of ['loop','movie']as const)it('retains nested '+mode+' timing within the complete group',()=>{
 const state:SymbolAuthoringSource=fixture(),p=newProject();p.duration=12;
 const ink=state.definition.shapes[1],child={id:'child',name:'Child',width:12,height:12,shapes:[{...ink,groups:undefined}],
  timeline:{duration:3,keys:[{frame:1,shapes:[{...ink,groups:undefined,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,groups:undefined,fill:'#0000ff'}]}]}};
 p.symbols=[child];const layer=p.layers[0];
 const shapes=state.definition.shapes.map(s=>s.id==='a'?{...s,kind:'symbol' as const,symbolId:child.id,symbolPlayback:{mode,firstFrame:0}}:s);
 layer.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+80,
  ...(s.symbolId?{symbolPlayback:{mode,firstFrame:mode==='loop'?2:0}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true});
 state.definition.shapes=layer.keys[0].shapes;
 state.definition.timeline={duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans};
 state.symbols=[child,state.definition];const before=structuredClone(state);
 const capture=captureSymbolRememberedAuthoringFrame(()=>state),result=capture.prepareGroupPromotion('@base','c',{x:10,y:6});
 const rotated=capture.prepareGroupPromotion('@base','c',undefined,30);
 const scaled=capture.prepareGroupPromotion('@base','c',undefined,undefined,{x:2,y:.5});
 const sheared=['x','y'].map(axis=>capture.prepareGroupPromotion('@base','c',undefined,undefined,undefined,{axis:axis as 'x'|'y',degrees:30}));
 for(const frame of [0,2,4,6,8]){
  const original=layer.keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='a')!;
  const rotatedChild=symbolLayers(rotated)[0].keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='a')!;
  expect(rotatedChild.symbolPlayback).toEqual(original.symbolPlayback);expect(rotatedChild.symbolId).toBe('child');
  const scaledChild=symbolLayers(scaled)[0].keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='a')!;
  expect(scaledChild.symbolPlayback).toEqual(original.symbolPlayback);expect(scaledChild.symbolId).toBe('child');
  for(const candidate of sheared){
   const nested=symbolLayers(candidate)[0].keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='a')!;
   expect(nested.symbolPlayback).toEqual(original.symbolPlayback);expect(nested.symbolId).toBe('child');
  }
  const actual=symbolLayers(result)[0].keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='a')!;
  expect(actual.symbolPlayback).toEqual(original.symbolPlayback);expect(actual.symbolId).toBe('child');
 }
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(state).toEqual(before);
 child.timeline.keys[0].shapes[0].fill='#ffffff';
 expect(()=>capture.prepareGroupPromotion('@base','a',{x:10,y:6})).toThrow(/changed/);
});

function rotationFixture(saved:boolean,affine=false,mixed=false){
 const state=fixture(),p=newProject(),layer=p.layers[0];p.duration=12;
 layer.keys=structuredClone(symbolLayers(state.definition)[0].keys.filter(k=>[0,8,10].includes(k.frame)));
 for(const key of layer.keys)for(const shape of key.shapes){
  if(!shape.groups)continue;
  if(affine)shape.transform=[2,0,.5,1];
  if(mixed)shape.pivot={x:3,y:4};
  if(saved){
   // Every member maps this local point to the same moving document pivot.
   const offset=shape.id==='b'?0:shape.id==='a'?-20:-40;
   shape.pivot={x:affine?offset/2:offset,y:0};
  }
 }
 createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true},undefined,
  {direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:saved});
 const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-recipe';
 state.definition.shapes=layer.keys[0].shapes;
 state.definition.timeline={duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]};
 return state;
}
for(const track of ['@base','overlay'])for(const pivotMode of ['default','saved','mixed'])for(const affine of [false,true])
it('rotates the full sampled group around a '+pivotMode+' pivot on '+track+', affine='+affine,()=>{
 const saved=pivotMode==='saved',state=rotationFixture(saved,affine,pivotMode==='mixed'),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const plain=capture.prepareGroupPromotion(track,'c'),sample=symbolLayers(plain).find(l=>l.id===track)!.keys[4].shapes;
 const result=capture.prepareGroupPromotion(track,'a',undefined,30),next=symbolLayers(result).find(l=>l.id===track)!;
 // Group box covers the union of transformed authoring boxes, not just the clicked subgroup.
 const pivot=saved?{x:40,y:0}:{x:affine?75:66,y:6},cos=Math.cos(Math.PI/6),sin=Math.sin(Math.PI/6);
 for(const id of ['b','a','c']){
  const original=sample.find(s=>s.id===id)!,actual=next.keys[4].shapes.find(s=>s.id===id)!;
  for(const point of [{x:0,y:0},{x:3,y:5}]){
   const old=worldPoint(original,point),want={x:pivot.x+cos*(old.x-pivot.x)-sin*(old.y-pivot.y),y:pivot.y+sin*(old.x-pivot.x)+cos*(old.y-pivot.y)},got=worldPoint(actual,point);
   expect(got.x).toBeCloseTo(want.x,10);expect(got.y).toBeCloseTo(want.y,10);
  }
  expect(actual.rotation).toBe(30);
  for(const field of ['id','groups','pivot','transform','points','width','height','fill']as const)expect(actual[field]).toEqual(original[field]);
  expect(next.keys[2].shapes.find(s=>s.id===id)!.rotation).toBe(15);
  expect(next.keys[6].shapes.find(s=>s.id===id)!.rotation).toBe(15);
 }
 for(const id of ['under','over'])expect(next.keys[4].shapes.find(s=>s.id===id)).toEqual(sample.find(s=>s.id===id));
 const original=symbolLayers(state.definition).find(l=>l.id===track)!;
 expect(next.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.keys.filter(k=>[0,8,10].includes(k.frame)));
 expect(next.motionSpans!.map(s=>s.rotation)).toEqual(symbolLayers(plain).find(l=>l.id===track)!.motionSpans!.map(s=>s.rotation));
 expect(symbolLayers(result).find(l=>l.id!==track)).toEqual(symbolLayers(state.definition).find(l=>l.id!==track));
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(result.timeline!.duration).toBe(12);expect(state).toEqual(before);
 result.shapes[0].x=999;expect(capture.prepareGroupPromotion(track,'a').shapes[0].x).toBe(-20);
});
for(const angle of [0,360,-720,NaN,Infinity,Number.MAX_VALUE,Number.MIN_VALUE])
it('rejects invalid or numerically empty group rotation '+angle+' without publishing a split',()=>{
 const state=rotationFixture(false),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','a',undefined,angle)).toThrow();
 expect(capture.prepareGroupPromotion('@base','a').timeline!.motionSpans).toHaveLength(2);expect(state).toEqual(before);
});
it('rechecks all source ownership after detached group rotation before returning',()=>{
 const probe=rotationFixture(true);let reads=0;
 const counter=captureSymbolRememberedAuthoringFrame(()=>{reads++;return probe;});const start=reads;
 counter.prepareGroupPromotion('@base','a',undefined,30);const cost=reads-start;
 const state=rotationFixture(true);let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.definition.shapes[3].groups=['changed'];return state;});
 const before=structuredClone(state.definition);flip=calls+cost;
 expect(()=>capture.prepareGroupPromotion('@base','a',undefined,30)).toThrow(/changed/);
 // Only the legitimate external source mutation remains; no split or moved pose is published.
 before.shapes[3].groups=['changed'];expect(state.definition).toEqual(before);
});

it('does not take group rotation ownership from mutable presentation or returned member IDs',()=>{
 const state=rotationFixture(false),capture=captureSymbolRememberedAuthoringFrame(()=>state),before=structuredClone(state);
 const owner=capture.resolveGroup('@base','a');owner.shapeIds.splice(0,3,'under');
 capture.scene[0].key.shapes.forEach(s=>{s.groups=[];s.x=999;});
 const candidate=capture.prepareGroupPromotion('@base','c',undefined,30);
 expect(candidate.timeline!.keys.find(k=>k.frame===4)!.shapes.filter(s=>s.rotation===30).map(s=>s.id)).toEqual(['b','a','c']);
 expect(state).toEqual(before);
});
it('keeps group rotation and movement detached when prepared together',()=>{
 const state=rotationFixture(true),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const candidate=capture.prepareGroupPromotion('@base','c',{x:10,y:6},30),shapes=candidate.timeline!.keys.find(k=>k.frame===4)!.shapes;
 // The common saved pivot moves with the union before rotation.
 const pivot={x:50,y:6},cos=Math.cos(Math.PI/6),sin=Math.sin(Math.PI/6);
 const original=capture.scene[0].key.shapes.find(s=>s.id==='c')!,actual=shapes.find(s=>s.id==='c')!,old=worldPoint(original,{x:3,y:5}),got=worldPoint(actual,{x:3,y:5});
 expect(got.x).toBeCloseTo(pivot.x+cos*(old.x+10-pivot.x)-sin*(old.y+6-pivot.y),10);
 expect(got.y).toBeCloseTo(pivot.y+sin*(old.x+10-pivot.x)+cos*(old.y+6-pivot.y),10);
 expect(state).toEqual(before);
});
for(const field of ['pivot','basis','unselected']as const)it('rejects original nonfinite '+field+' before group rotation normalization',()=>{
 const state=rotationFixture(true);
 if(field==='pivot')state.definition.shapes[3].pivot={x:NaN,y:0};
 if(field==='basis')state.definition.shapes[3].transform=[1,0,Infinity,1];
 if(field==='unselected')state.definition.shapes[0].points=[{x:NaN,y:0}];
 const before=structuredClone(state);
 expect(()=>captureSymbolRememberedAuthoringFrame(()=>state).prepareGroupPromotion('@base','a',undefined,30)).toThrow(/nonfinite/);
 expect(state).toEqual(before);
});

for(const track of ['@base','overlay'])for(const pivotMode of ['default','saved','mixed'])for(const affine of [false,true])
it('scales the complete sampled union about '+pivotMode+' pivot on '+track+', affine='+affine,()=>{
 const saved=pivotMode==='saved',state=rotationFixture(saved,affine,pivotMode==='mixed'),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const plain=capture.prepareGroupPromotion(track,'c'),sample=symbolLayers(plain).find(l=>l.id===track)!.keys[4].shapes;
 const result=capture.prepareGroupPromotion(track,'a',undefined,undefined,{x:2,y:.5}),next=symbolLayers(result).find(l=>l.id===track)!;
 const pivot=saved?{x:40,y:0}:{x:affine?75:66,y:6};
 for(const id of ['b','a','c']){
  const original=sample.find(s=>s.id===id)!,actual=next.keys[4].shapes.find(s=>s.id===id)!;
  for(const point of [{x:0,y:0},{x:3,y:5}]){
   const old=worldPoint(original,point),got=worldPoint(actual,point);
   expect(got.x).toBeCloseTo(pivot.x+2*(old.x-pivot.x),10);expect(got.y).toBeCloseTo(pivot.y+.5*(old.y-pivot.y),10);
  }
  for(const field of ['id','groups','pivot','points','width','height','fill']as const)expect(actual[field]).toEqual(original[field]);
  for(const frame of [2,6]){const pose=next.keys[frame].shapes.find(s=>s.id===id)!;expect(pose.transform).toEqual(affine?[3,0,.75,.75]:[1.5,0,0,.75]);}
 }
 for(const id of ['under','over'])expect(next.keys[4].shapes.find(s=>s.id===id)).toEqual(sample.find(s=>s.id===id));
 const original=symbolLayers(state.definition).find(l=>l.id===track)!,plainLayer=symbolLayers(plain).find(l=>l.id===track)!;
 expect(next.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.keys.filter(k=>[0,8,10].includes(k.frame)));
 expect(next.motionSpans!.map(s=>[s.options,s.rotation])).toEqual(plainLayer.motionSpans!.map(s=>[s.options,s.rotation]));
 expect(symbolLayers(result).find(l=>l.id!==track)).toEqual(symbolLayers(state.definition).find(l=>l.id!==track));
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(result.timeline!.duration).toBe(12);expect(state).toEqual(before);
 result.shapes[0].x=999;expect(capture.prepareGroupPromotion(track,'a').shapes[0].x).toBe(-20);
});
for(const scale of [{x:1,y:1},{x:0,y:2},{x:NaN,y:1},{x:1,y:Infinity},{x:-1,y:1},{x:Number.MIN_VALUE,y:1},{x:Number.MAX_VALUE,y:1}])
it('rejects invalid or collapsing complete-group scale '+JSON.stringify(scale)+' without a split',()=>{
 const state=rotationFixture(false),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','c',undefined,undefined,scale)).toThrow();
 expect(capture.prepareGroupPromotion('@base','c').timeline!.motionSpans).toHaveLength(2);expect(state).toEqual(before);
});
it('does not enable missing affine/group scale properties to admit a sampled union',()=>{
 const state=rotationFixture(false);
 for(const layer of symbolLayers(state.definition))for(const span of layer.motionSpans!){span.options={affine:false};delete span.rotation!.axisGroupScale;}
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','c',undefined,undefined,{x:2,y:.5})).toThrow();
 expect(state).toEqual(before);expect(capture.prepareGroupPromotion('@base','c').timeline!.motionSpans).toHaveLength(2);
});
it('rejects late source membership changes after detached complete-group scaling',()=>{
 const probe=rotationFixture(true);let reads=0;const counter=captureSymbolRememberedAuthoringFrame(()=>{reads++;return probe;}),start=reads;
 counter.prepareGroupPromotion('@base','a',undefined,undefined,{x:2,y:.5});const cost=reads-start;
 const state=rotationFixture(true);let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.definition.shapes[3].groups=['changed'];return state;});
 const before=structuredClone(state.definition);flip=calls+cost;
 expect(()=>capture.prepareGroupPromotion('@base','a',undefined,undefined,{x:2,y:.5})).toThrow(/changed/);
 before.shapes[3].groups=['changed'];expect(state.definition).toEqual(before);
});

for(const axis of ['x','y']as const)it('keeps the orthogonal world axis while scaling rotated skewed complete groups, '+axis,()=>{
 const p=newProject(),layer=p.layers[0];p.duration=12;const state=fixture();
 const shapes=state.definition.shapes.map(s=>s.groups?{...s,rotation:30,transform:[2,.5,1,3] as [number,number,number,number]}:s);
 layer.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+80}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true},undefined,
 {direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true});
 state.definition.shapes=layer.keys[0].shapes;state.definition.timeline={duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans};
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state),factor=axis==='x'?{x:2,y:1}:{x:1,y:.5};
 const result=capture.prepareGroupPromotion('@base','a',undefined,undefined,factor);
 for(const id of ['b','a','c']){
  const original=capture.scene[0].key.shapes.find(s=>s.id===id)!,actual=result.timeline!.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id===id)!;
  const old=[worldPoint(original,{x:0,y:0}),worldPoint(original,{x:3,y:5})],next=[worldPoint(actual,{x:0,y:0}),worldPoint(actual,{x:3,y:5})];
  for(const [i,point]of old.entries())expect(next[i][axis==='x'?'y':'x']).toBeCloseTo(point[axis==='x'?'y':'x'],10);
  expect(next[1].x-next[0].x).toBeCloseTo((old[1].x-old[0].x)*factor.x,10);
  expect(next[1].y-next[0].y).toBeCloseTo((old[1].y-old[0].y)*factor.y,10);
  expect(actual.groups).toEqual(original.groups);
 }
 expect(state).toEqual(before);
});
it('keeps movement rotation and scaling on one detached complete-group candidate',()=>{
 const state=rotationFixture(true);
 for(const layer of symbolLayers(state.definition))for(const span of layer.motionSpans!)span.rotation!.axisGroupShear=true;
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.prepareGroupPromotion('@base','c',{x:10,y:6},30,{x:2,y:.5});
 const actual=result.timeline!.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id==='c')!,original=capture.scene[0].key.shapes.find(s=>s.id==='c')!;
 const old=worldPoint(original,{x:3,y:5}),got=worldPoint(actual,{x:3,y:5}),c=Math.cos(Math.PI/6),n=Math.sin(Math.PI/6),dx=old.x+10-50,dy=old.y+6-6;
 expect(got.x).toBeCloseTo(50+2*(c*dx-n*dy),10);expect(got.y).toBeCloseTo(6+.5*(n*dx+c*dy),10);
 expect(state).toEqual(before);
});

it('rejects a complete-group double-axis flip through the existing positive-axis recipe guard',()=>{
 const state=rotationFixture(false),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','a',undefined,undefined,{x:-1,y:-1})).toThrow(/Group axis scales must be finite and positive/);
 expect(capture.prepareGroupPromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
 expect(capture.prepareGroupPromotion('@base','a',{x:10,y:6})).toBeDefined();expect(state).toEqual(before);
});

function skewFixture(saved=false,affine=false,mixed=false){
 const state=rotationFixture(saved,affine,mixed);
 for(const layer of symbolLayers(state.definition))for(const span of layer.motionSpans!)span.rotation!.axisGroupShear=true;
 return state;
}
for(const track of ['@base','overlay'])for(const pivotMode of ['default','saved','mixed'])for(const affine of [false,true])for(const axis of ['x','y']as const)
it('skews the complete sampled union in '+axis+' about '+pivotMode+' pivot on '+track+', affine='+affine,()=>{
 const saved=pivotMode==='saved',state=skewFixture(saved,affine,pivotMode==='mixed'),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const plain=capture.prepareGroupPromotion(track,'c'),sample=symbolLayers(plain).find(l=>l.id===track)!.keys[4].shapes;
 const result=capture.prepareGroupPromotion(track,'a',undefined,undefined,undefined,{axis,degrees:30}),next=symbolLayers(result).find(l=>l.id===track)!;
 const pivot=saved?{x:40,y:0}:{x:affine?75:66,y:6},shear=Math.tan(Math.PI/6);
 for(const id of ['b','a','c']){
  const original=sample.find(s=>s.id===id)!,actual=next.keys[4].shapes.find(s=>s.id===id)!;
  for(const point of [{x:0,y:0},{x:3,y:5}]){
   const old=worldPoint(original,point),got=worldPoint(actual,point);
   expect(got.x).toBeCloseTo(old.x+(axis==='x'?shear*(old.y-pivot.y):0),10);
   expect(got.y).toBeCloseTo(old.y+(axis==='y'?shear*(old.x-pivot.x):0),10);
  }
  for(const field of ['id','groups','pivot','points','width','height','fill']as const)expect(actual[field]).toEqual(original[field]);
 }
 for(const id of ['under','over'])expect(next.keys[4].shapes.find(s=>s.id===id)).toEqual(sample.find(s=>s.id===id));
 const original=symbolLayers(state.definition).find(l=>l.id===track)!,plainLayer=symbolLayers(plain).find(l=>l.id===track)!;
 expect(next.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.keys.filter(k=>[0,8,10].includes(k.frame)));
 expect(next.motionSpans!.map(s=>[s.options,s.rotation])).toEqual(plainLayer.motionSpans!.map(s=>[s.options,s.rotation]));
 expect(symbolLayers(result).find(l=>l.id!==track)).toEqual(symbolLayers(state.definition).find(l=>l.id!==track));
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(result.timeline!.duration).toBe(12);expect(state).toEqual(before);
 result.shapes[0].x=999;expect(capture.prepareGroupPromotion(track,'a').shapes[0].x).toBe(-20);
});
for(const degrees of [0,180,90,270,NaN,Infinity,Number.MIN_VALUE,Number.MAX_VALUE])
it('rejects invalid unresolved group skew angle '+degrees+' without a split',()=>{
 const state=skewFixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.prepareGroupPromotion('@base','c',undefined,undefined,undefined,{axis:'x',degrees})).toThrow();
 expect(capture.prepareGroupPromotion('@base','c').timeline!.motionSpans).toHaveLength(2);expect(state).toEqual(before);
});
it('rejects an invalid group skew axis and missing affine/group admission without changing options',()=>{
 for(const mode of ['axis','options','group']as const){
  const state=skewFixture();
  if(mode==='group')for(const layer of symbolLayers(state.definition))for(const span of layer.motionSpans!)delete span.rotation!.axisGroupShear;
  if(mode==='options')for(const layer of symbolLayers(state.definition))for(const span of layer.motionSpans!){span.options={affine:false};delete span.rotation!.axisGroupScale;delete span.rotation!.axisGroupShear;}
  const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
  expect(()=>capture.prepareGroupPromotion('@base','c',undefined,undefined,undefined,{axis:mode==='axis'?'bad' as 'x':mode==='group'?'y':'x',degrees:30})).toThrow();
  expect(state).toEqual(before);expect(capture.prepareGroupPromotion('@base','c').timeline!.motionSpans).toHaveLength(2);
 }
});
it('rejects late complete-group membership mutation after detached shear preparation',()=>{
 const probe=skewFixture(true);let reads=0;const counter=captureSymbolRememberedAuthoringFrame(()=>{reads++;return probe;}),start=reads;
 counter.prepareGroupPromotion('@base','a',undefined,undefined,undefined,{axis:'y',degrees:30});const cost=reads-start;
 const state=skewFixture(true);let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.definition.shapes[3].groups=['changed'];return state;});
 const before=structuredClone(state.definition);flip=calls+cost;
 expect(()=>capture.prepareGroupPromotion('@base','a',undefined,undefined,undefined,{axis:'y',degrees:30})).toThrow(/changed/);
 before.shapes[3].groups=['changed'];expect(state.definition).toEqual(before);
});

for(const axis of ['x','y']as const)it('keeps original single-axis group shear precedence with rotated skewed bases, '+axis,()=>{
 const p=newProject(),layer=p.layers[0];p.duration=12;const state=fixture();
 layer.keys=structuredClone(symbolLayers(state.definition)[0].keys.filter(k=>[0,8,10].includes(k.frame)));
 for(const key of layer.keys)for(const shape of key.shapes)if(shape.groups){
  shape.rotation=30;shape.transform=[2,.5,1,3];
  shape.pivot=inversePoint(matrix(shape),{x:key.frame===8?80:0,y:0});
 }
 createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true},undefined,
 {direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,savedGroupPivots:true});
 state.definition.shapes=layer.keys[0].shapes;state.definition.timeline={duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans};
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.prepareGroupPromotion('@base','c',undefined,undefined,undefined,{axis,degrees:-30}),k=Math.tan(-Math.PI/6);
 for(const id of ['b','a','c']){
  const original=capture.scene[0].key.shapes.find(s=>s.id===id)!,actual=result.timeline!.keys.find(key=>key.frame===4)!.shapes.find(s=>s.id===id)!;
  for(const point of [{x:0,y:0},{x:3,y:5}]){
   const old=worldPoint(original,point),got=worldPoint(actual,point);
   expect(got.x).toBeCloseTo(old.x+(axis==='x'?k*old.y:0),10);
   expect(got.y).toBeCloseTo(old.y+(axis==='y'?k*(old.x-40):0),10);
  }
  expect(actual.pivot).toEqual(original.pivot);
 }
 expect(state).toEqual(before);
});
it('keeps movement rotation scale and shear on one detached complete-group candidate',()=>{
 const state=skewFixture(true),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.prepareGroupPromotion('@base','c',{x:10,y:6},30,{x:2,y:.5},{axis:'x',degrees:30});
 const original=capture.scene[0].key.shapes.find(s=>s.id==='c')!,actual=result.timeline!.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id==='c')!;
 const old=worldPoint(original,{x:3,y:5}),got=worldPoint(actual,{x:3,y:5}),c=Math.cos(Math.PI/6),n=Math.sin(Math.PI/6),dx=old.x-40,dy=old.y;
 const x=50+2*(c*dx-n*dy),y=6+.5*(n*dx+c*dy);
 expect(got.x).toBeCloseTo(x+Math.tan(Math.PI/6)*(y-6),10);expect(got.y).toBeCloseTo(y,10);
 expect(state).toEqual(before);
});
