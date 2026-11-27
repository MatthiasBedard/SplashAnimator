import {expect,it} from 'vitest';
import {worldPoint} from '../packages/geometry/src';
import {newProject,MAX_SYMBOL_ARTWORK,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureSymbolRememberedAuthoringFrame,type SymbolAuthoringSource} from '../packages/animation/src/symbol-motion-owner';
function fixture(){
 const p=newProject();p.duration=12;const layer=p.layers[0];
 const ink:Vector={id:'a',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[layer.id],0,8,'linear');
 const overlay=structuredClone(layer);overlay.id='overlay';overlay.motionSpans![0].id='overlay-recipe';
 layer.keys[8].shapes[0].x=160;
 const definition={id:'symbol',name:'Symbol',width:100,height:100,shapes:layer.keys[0].shapes,buttonStates:{up:0,over:3,down:5,hit:10},
 timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:3,frame:4};
 return state;
}
it('keeps presentation and choice mutation separate from private base/additional ownership',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(capture.scene[0].key.shapes[0].x).toBe(80);expect(state.definition.timeline!.keys[3].shapes[0].x).toBe(40);
 capture.scene[0].key.shapes[0].id='forged';capture.scene[0].key.shapes[0].x=999;
 const choices=capture.choices;choices[0].shapeId='forged';expect(()=>capture.resolve('@base','forged')).toThrow();
 expect(capture.resolve('@base','a')).toMatchObject({definitionId:'symbol',layerId:'@base',shapeId:'a',frame:4,revision:3,start:0,end:8,spanId:state.definition.timeline!.motionSpans![0].id});
 expect(capture.resolve('overlay','a').spanId).toBe('overlay-recipe');expect(state).toEqual(before);
 const result=capture.preparePromotion('@base','a');
 expect(result.timeline!.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
 expect(result.timeline!.keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);
 const extra=capture.preparePromotion('overlay','a');expect(extra.timeline!.layers![0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);expect(extra.timeline!.motionSpans).toEqual(state.definition.timeline!.motionSpans);
 expect(result.timeline!.layers).toEqual(state.definition.timeline!.layers);expect(result.buttonStates).toEqual(state.definition.buttonStates);
 expect(result.shapes).toEqual(state.definition.shapes);expect(result.timeline!.keys.find(k=>k.frame===8)).toEqual(state.definition.timeline!.keys.find(k=>k.frame===8));
 result.shapes[0].x=999;expect(capture.preparePromotion('@base','a').shapes[0].x).toBe(0);expect(state).toEqual(before);
 capture.dispose();expect(()=>capture.resolve('@base','a')).toThrow(/disposed/);expect(()=>capture.preparePromotion('@base','a')).toThrow();expect(()=>capture.scene).toThrow();
});
for(const mode of ['revision','frame','definition','library','endpoint','interior','policy','recipe','library-content','nonfinite']as const)it('invalidates capture permanently after '+mode,()=>{
 const state=fixture(),capture=captureSymbolRememberedAuthoringFrame(()=>state),original=structuredClone(state);
 if(mode==='revision')state.revision++;
 if(mode==='frame')state.frame=5;
 if(mode==='definition')state.definition=structuredClone(state.definition);
 if(mode==='library')state.symbols=[...state.symbols];
 if(mode==='endpoint')state.definition.timeline!.keys.find(k=>k.frame===8)!.shapes[0].x++;
 if(mode==='interior')state.definition.timeline!.keys[0].shapes[0].x++;
 if(mode==='policy')state.definition.timeline!.layers![0].locked=true;
 if(mode==='recipe')state.definition.timeline!.motionSpans![0].id='changed';
 if(mode==='library-content')state.symbols[0].name='Changed';
 if(mode==='nonfinite')state.definition.shapes[0].rotation=NaN;
 const changed=structuredClone(state);expect(()=>capture.resolve('@base','a')).toThrow();expect(state).toEqual(changed);
 Object.assign(state,original);expect(()=>capture.preparePromotion('@base','a')).toThrow(/invalidated/);
});
it('excludes endpoints/holds/short intervals and hidden or locked tracks without mutating them',()=>{
 for(const mode of ['endpoint','hold','short','hidden','locked']){
  const state=fixture();if(mode==='endpoint')state.frame=8;if(mode==='hold')state.frame=9;if(mode==='short')state.frame=1;
  if(mode==='hidden')state.definition.timeline!.layers![0].visible=false;if(mode==='locked')state.definition.timeline!.layers![0].locked=true;
  const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state),track=mode==='hidden'||mode==='locked'?'overlay':'@base';
  expect(capture.choices.some(c=>c.layerId===track)).toBe(false);expect(()=>capture.resolve(track,'a')).toThrow();expect(state).toEqual(before);
 }
});
it('rejects stale interiors, ambiguous tracks/library IDs and invalid original values at capture',()=>{
 for(const mode of ['stale','track','library','nan','revision','frame']){
  const state=fixture();
  if(mode==='stale')state.definition.timeline!.keys[0].shapes[0].x++;
  if(mode==='track')state.definition.timeline!.layers![0].id='@base';
  if(mode==='library')state.symbols.push(state.definition);
  if(mode==='nan')state.definition.shapes[0].rotation=NaN;
  if(mode==='revision')state.revision=NaN;if(mode==='frame')state.frame=12;
  const before=structuredClone(state);expect(()=>captureSymbolRememberedAuthoringFrame(()=>state)).toThrow();expect(state).toEqual(before);
 }
});
it('checks aggregate capacity at capture without changing or silently dropping artwork',()=>{
 const state=fixture(),own=18,other={id:'other',name:'Other',width:10,height:10,shapes:Array(MAX_SYMBOL_ARTWORK-own).fill(state.definition.shapes[0])};
 state.symbols.push(other);expect(()=>captureSymbolRememberedAuthoringFrame(()=>state)).not.toThrow();
 other.shapes.push(state.definition.shapes[0]);const before=structuredClone(state);expect(()=>captureSymbolRememberedAuthoringFrame(()=>state)).toThrow(/budget/);expect(state).toEqual(before);
});
it('rechecks the live source before returning a resolved owner or prepared candidate',()=>{
 const state=fixture();let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.revision++;return state;});
 flip=calls+2;expect(()=>capture.resolve('@base','a')).toThrow(/changed/);expect(state.definition.timeline!.motionSpans).toHaveLength(1);
});

for(const mode of ['loop','movie']as const)it('samples and prepares nested '+mode+' settings with the original library',()=>{
 const p=newProject();p.duration=12;const ink=fixture().definition.shapes[0];
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink],timeline:{duration:3,keys:[{frame:1,shapes:[{...ink,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,fill:'#0000ff'}]}]}};
 p.symbols=[child];const track=p.layers[0];
 track.keys=[{frame:0,shapes:[{...ink,id:'nested',kind:'symbol',symbolId:child.id,symbolPlayback:{mode,firstFrame:0}}]},{frame:8,shapes:[{...ink,id:'nested',kind:'symbol',symbolId:child.id,x:80,symbolPlayback:{mode,firstFrame:mode==='loop'?2:0}}]},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true});
 const definition={id:'parent',name:'Parent',width:100,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}};
 const state:SymbolAuthoringSource={definition,symbols:[child,definition],revision:0,frame:4},before=structuredClone(state);
 const capture=captureSymbolRememberedAuthoringFrame(()=>state),candidate=capture.preparePromotion('@base','nested');
 expect(candidate.timeline!.keys.find(k=>k.frame===4)!.shapes).toEqual(track.keys[4].shapes);
 expect(capture.scene[0].key.shapes).toEqual(track.keys[4].shapes);
 expect(candidate.timeline!.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
 const moved=capture.preparePromotion('@base','nested',{x:10,y:5});
 expect(moved.timeline!.keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({x:50,y:5,symbolPlayback:track.keys[4].shapes[0].symbolPlayback});
 const rotated=capture.preparePromotion('@base','nested',undefined,90);
 expect(rotated.timeline!.keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({rotation:90,symbolPlayback:track.keys[4].shapes[0].symbolPlayback});
 const scaled=capture.preparePromotion('@base','nested',undefined,undefined,{x:2,y:.5});
 expect(scaled.timeline!.keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({transform:[2,0,0,.5],symbolPlayback:track.keys[4].shapes[0].symbolPlayback});
 const skewed=capture.preparePromotion('@base','nested',undefined,undefined,undefined,{axis:'x',degrees:30});
 expect(skewed.timeline!.keys.find(k=>k.frame===4)!.shapes[0].symbolPlayback).toEqual(track.keys[4].shapes[0].symbolPlayback);
 expect(state).toEqual(before);
 child.timeline.keys[0].shapes[0].fill='#ffffff';expect(()=>capture.preparePromotion('@base','nested')).toThrow(/changed/);
 const missing={...state,symbols:[definition]};expect(()=>captureSymbolRememberedAuthoringFrame(()=>missing)).toThrow(/missing/);
});
it('rejects an unreconstructable split without changing the sampled definition or recipes',()=>{
 const p=newProject();p.duration=2049;const ink=fixture().definition.shapes[0],track=p.layers[0];
 track.keys=[{frame:0,shapes:[ink]},{frame:2048,shapes:[{...ink,x:64}]}];
 createBasicMotionSpan(p,[track.id],0,2048,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:16,y:16},{x:32,y:32},{x:48,y:16}]});
 const definition={id:'parent',name:'Parent',width:100,height:100,shapes:track.keys[0].shapes,timeline:{duration:p.duration,keys:track.keys.slice(1),motionSpans:track.motionSpans}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:2},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(capture.resolve('@base','a').frame).toBe(2);
 expect(()=>capture.preparePromotion('@base','a')).toThrow(/subdivision budget/);expect(state).toEqual(before);
});
it('rejects reentrant source reads and invalidates the capture permanently',()=>{
 const state=fixture();let callback:()=>void=()=>{};
 const capture=captureSymbolRememberedAuthoringFrame(()=>{callback();return state;});
 callback=()=>{capture.resolve('@base','a');};expect(()=>capture.resolve('@base','a')).toThrow(/reenter/);
 callback=()=>{};expect(()=>capture.preparePromotion('@base','a')).toThrow(/invalidated/);
});

it('rechecks source after detached promotion preparation before returning it',()=>{
 const state=fixture();let calls=0,flip=Infinity;
 const capture=captureSymbolRememberedAuthoringFrame(()=>{if(++calls===flip)state.frame++;return state;});
 // The last source read follows preparation and final aggregate admission.
 const probe=fixture();let probeCalls=0;const counter=captureSymbolRememberedAuthoringFrame(()=>{probeCalls++;return probe;});
 const start=probeCalls;counter.preparePromotion('@base','a');flip=calls+(probeCalls-start);
 expect(()=>capture.preparePromotion('@base','a')).toThrow(/changed/);expect(state.definition.timeline!.motionSpans).toHaveLength(1);
});

for(const track of ['@base','overlay'])it('prepares promotion and two-sided translation on '+track+' without publishing the split',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.preparePromotion(track,'a',{x:10,y:6});
 const keys=track==='@base'?[{frame:0,shapes:result.shapes},...result.timeline!.keys]:result.timeline!.layers![0].keys;
 const start=track==='@base'?80:40;
 expect(keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({id:'a',x:start+10,y:6,width:12,height:12});
 expect(keys.find(k=>k.frame===2)!.shapes[0]).toMatchObject({x:(start+10)/2,y:3});
 expect(keys.find(k=>k.frame===6)!.shapes[0].y).toBe(3);
 const original=track==='@base'?[{frame:0,shapes:state.definition.shapes},...state.definition.timeline!.keys]:state.definition.timeline!.layers![0].keys;
 expect(keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.filter(k=>[0,8,10].includes(k.frame)));
 expect(result.buttonStates).toEqual(state.definition.buttonStates);expect(result.timeline!.duration).toBe(12);
 if(track==='@base')expect(result.timeline!.layers).toEqual(state.definition.timeline!.layers);
 else{expect(result.shapes).toEqual(state.definition.shapes);expect(result.timeline!.keys).toEqual(state.definition.timeline!.keys);}
 expect(state).toEqual(before);
 const plain=capture.preparePromotion(track,'a'),plainKeys=track==='@base'?plain.timeline!.keys:plain.timeline!.layers![0].keys;
 expect(plainKeys.find(k=>k.frame===4)!.shapes[0].x).toBe(start);
});
it('rejects invalid or unrepresentable movement without publishing promotion or losing plain promotion',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 for(const offset of [{x:0,y:0},{x:NaN,y:1},{x:1,y:Infinity},{x:Number.MIN_VALUE,y:0}]){
  expect(()=>capture.preparePromotion('@base','a',offset)).toThrow();expect(state).toEqual(before);
 }
 expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});

it('rejects a tangent-incompatible translated promotion while retaining plain promotion',()=>{
 const state=fixture(),p=newProject(),track=p.layers[0],ink=state.definition.shapes[0];p.duration=12;
 track.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',undefined,{startX:16,startY:0,endX:-16,endY:0,tangent:true});
 state.definition={id:'tangent',name:'Tangent',width:200,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}};state.symbols=[state.definition];
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.preparePromotion('@base','a',{x:40,y:0})).toThrow(/tangent/);expect(state).toEqual(before);
 expect(capture.preparePromotion('@base','a').timeline!.keys).toEqual(state.definition.timeline!.keys);
});

for(const trackId of ['@base','overlay'])for(const saved of [false,true])it('prepares sampled rotation about '+(saved?'saved':'default')+' pivots on '+trackId,()=>{
 const p=newProject();p.duration=12;const layer=p.layers[0],ink={...fixture().definition.shapes[0],width:20,height:10,y:10,...(saved?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[layer.id],0,8,'linear');
 const overlay={...structuredClone(layer),id:'overlay'};
 const definition={id:'rotation',name:'Rotation',width:200,height:100,shapes:layer.keys[0].shapes,buttonStates:{up:0,over:3,down:5,hit:10},timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.preparePromotion(trackId,'a',undefined,90),keys=trackId==='@base'?[{frame:0,shapes:result.shapes},...result.timeline!.keys]:result.timeline!.layers![0].keys;
 expect(keys[4].shapes[0].x).toBeCloseTo(saved?40:55,10);expect(keys[4].shapes[0].y).toBeCloseTo(saved?10:5,10);expect(keys[4].shapes[0].rotation).toBe(90);expect(keys[4].shapes[0].pivot).toEqual(ink.pivot);
 expect(keys[2].shapes[0].rotation).toBeCloseTo(45,10);expect(keys[6].shapes[0].rotation).toBeCloseTo(45,10);
 expect(keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(layer.keys.filter(k=>[0,8,10].includes(k.frame)));expect(result.buttonStates).toEqual(definition.buttonStates);expect(result.timeline!.duration).toBe(12);
 if(trackId==='@base')expect(result.timeline!.layers).toEqual(definition.timeline!.layers);else{expect(result.shapes).toEqual(definition.shapes);expect(result.timeline!.keys).toEqual(definition.timeline!.keys);}
 expect(state).toEqual(before);
});
it('rejects invalid or underflowed angles without publishing or losing plain promotion',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 for(const angle of [0,360,-360,NaN,Infinity,Number.MIN_VALUE,Number.MAX_VALUE]){
  expect(()=>capture.preparePromotion('@base','a',undefined,angle)).toThrow();expect(state).toEqual(before);
 }
 expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});

for(const trackId of ['@base','overlay'])for(const saved of [false,true])it('prepares sampled scale about '+(saved?'saved':'default')+' pivots on '+trackId,()=>{
 const p=newProject();p.duration=12;const layer=p.layers[0],ink={...fixture().definition.shapes[0],width:20,height:10,y:10,...(saved?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true});
 const overlay={...structuredClone(layer),id:'overlay'},definition={id:'scaling',name:'Scaling',width:200,height:100,shapes:layer.keys[0].shapes,buttonStates:{up:0,over:3,down:5,hit:10},timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const result=capture.preparePromotion(trackId,'a',undefined,undefined,{x:1.5,y:.5}),keys=trackId==='@base'?[{frame:0,shapes:result.shapes},...result.timeline!.keys]:result.timeline!.layers![0].keys;
 expect(keys[4].shapes[0]).toMatchObject({x:saved?40:35,y:saved?10:12.5,rotation:0,transform:[1.5,0,0,.5]});expect(keys[4].shapes[0].pivot).toEqual(ink.pivot);
 for(const frame of [2,6])expect(keys[frame].shapes[0].transform).toEqual([1.25,0,0,.75]);
 expect(keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(layer.keys.filter(k=>[0,8,10].includes(k.frame)));expect(result.buttonStates).toEqual(definition.buttonStates);expect(result.timeline!.duration).toBe(12);
 const spans=trackId==='@base'?result.timeline!.motionSpans!:result.timeline!.layers![0].motionSpans!;expect(spans.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);
 if(trackId==='@base')expect(result.timeline!.layers).toEqual(definition.timeline!.layers);else{expect(result.shapes).toEqual(definition.shapes);expect(result.timeline!.keys).toEqual(definition.timeline!.keys);}
 expect(state).toEqual(before);
});
it('rejects sampled scale without saved affine admission and retains plain promotion',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.preparePromotion('@base','a',undefined,undefined,{x:2,y:1})).toThrow(/enabled motion properties/);expect(state).toEqual(before);expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});
it('rejects invalid identity singular and orientation-changing scale without publication',()=>{
 const p=newProject();p.duration=12;const layer=p.layers[0],ink=fixture().definition.shapes[0];layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]}];createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true});
 const definition={id:'scale',name:'Scale',width:200,height:100,shapes:layer.keys[0].shapes,timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 for(const scale of [{x:1,y:1},{x:0,y:2},{x:NaN,y:1},{x:1,y:Infinity},{x:-1,y:1},{x:Number.MIN_VALUE,y:1},{x:Number.MAX_VALUE,y:1}]){
  expect(()=>capture.preparePromotion('@base','a',undefined,undefined,scale),JSON.stringify(scale)).toThrow();expect(state).toEqual(before);
 }
 const flipped=capture.preparePromotion('@base','a',undefined,undefined,{x:-1,y:-1}).timeline!.keys.find(k=>k.frame===4)!.shapes[0];
 const original=capture.scene[0].key.shapes[0];
 for(const local of [{x:0,y:0},{x:1,y:0},{x:0,y:1}]){const a=worldPoint(original,local),b=worldPoint(flipped,local);expect(b.x).toBeCloseTo(92-a.x,10);expect(b.y).toBeCloseTo(12-a.y,10);}
 expect(state).toEqual(before);expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});
it('keeps the orthogonal document axis during sampled scaling of rotated skewed artwork',()=>{
 const p=newProject();p.duration=12;const track=p.layers[0],ink:Vector={...fixture().definition.shapes[0],rotation:30,transform:[2,.5,1,3],pivot:{x:0,y:0},y:10};
 track.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]}];createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true});
 const definition={id:'affine',name:'Affine',width:200,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state),original=capture.scene[0].key.shapes[0];
 const candidate=capture.preparePromotion('@base','a',undefined,undefined,{x:2,y:1}),actual=candidate.timeline!.keys.find(k=>k.frame===4)!.shapes[0];
 for(const local of [{x:0,y:0},{x:1,y:0},{x:0,y:1}]){
  const a=worldPoint(original,local),b=worldPoint(actual,local);expect(b.x).toBeCloseTo(40+2*(a.x-40),10);expect(b.y).toBeCloseTo(a.y,10);
 }
 expect(actual.pivot).toEqual(original.pivot);expect(state).toEqual(before);
});

for(const trackId of ['@base','overlay'])for(const axis of ['x','y']as const)for(const saved of [false,true])it('prepares sampled '+axis+' skew with '+(saved?'saved':'default')+' pivot on '+trackId,()=>{
 const p=newProject();p.duration=12;const track=p.layers[0],ink={...fixture().definition.shapes[0],width:20,height:10,y:10,...(saved?{pivot:{x:0,y:0}}:{})};
 track.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true});
 const overlay={...structuredClone(track),id:'overlay'},definition={id:'shear',name:'Shear',width:200,height:100,shapes:track.keys[0].shapes,buttonStates:{up:0,over:3,down:5,hit:10},timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans,layers:[overlay]}};
 const state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const original=capture.scene.find(t=>t.layerId===trackId)!.key.shapes[0],result=capture.preparePromotion(trackId,'a',undefined,undefined,undefined,{axis,degrees:30}),keys=trackId==='@base'?[{frame:0,shapes:result.shapes},...result.timeline!.keys]:result.timeline!.layers![0].keys;
 const pivot=saved?{x:40,y:10}:{x:50,y:15},h=Math.tan(Math.PI/6);
 for(const point of [{x:0,y:0},{x:1,y:0},{x:0,y:1}]){
  const a=worldPoint(original,point),b=worldPoint(keys[4].shapes[0],point);expect(b.x).toBeCloseTo(a.x+(axis==='x'?h*(a.y-pivot.y):0),10);expect(b.y).toBeCloseTo(a.y+(axis==='y'?h*(a.x-pivot.x):0),10);
 }
 expect(keys[4].shapes[0].pivot).toEqual(ink.pivot);expect(keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(track.keys.filter(k=>[0,8,10].includes(k.frame)));
 const spans=trackId==='@base'?result.timeline!.motionSpans!:result.timeline!.layers![0].motionSpans!;expect(spans.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);expect(result.buttonStates).toEqual(definition.buttonStates);expect(result.timeline!.duration).toBe(12);
 if(trackId==='@base')expect(result.timeline!.layers).toEqual(definition.timeline!.layers);else{expect(result.shapes).toEqual(definition.shapes);expect(result.timeline!.keys).toEqual(definition.timeline!.keys);}expect(state).toEqual(before);
});
it('rejects invalid sampled skew axes and angles atomically while retaining plain promotion',()=>{
 const p=newProject();p.duration=12;const track=p.layers[0],ink=fixture().definition.shapes[0];track.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]}];createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true});
 const definition={id:'skew-guards',name:'Guards',width:200,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}},state:SymbolAuthoringSource={definition,symbols:[definition],revision:0,frame:4},before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 for(const degrees of [0,180,NaN,Infinity,90,-90,90-1e-10,Number.MIN_VALUE,Number.MAX_VALUE]){
  expect(()=>capture.preparePromotion('@base','a',undefined,undefined,undefined,{axis:'x',degrees})).toThrow();expect(state).toEqual(before);
 }
 expect(()=>capture.preparePromotion('@base','a',undefined,undefined,undefined,{axis:'z' as 'x',degrees:30})).toThrow();expect(state).toEqual(before);expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});
it('rejects sampled skew without affine opt-in before publishing a split',()=>{
 const state=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 expect(()=>capture.preparePromotion('@base','a',undefined,undefined,undefined,{axis:'y',degrees:30})).toThrow(/enabled motion properties/);expect(state).toEqual(before);expect(capture.preparePromotion('@base','a').timeline!.motionSpans).toHaveLength(2);
});
