import {expect,it} from 'vitest';
import {clone,newProject,MAX_SYMBOL_ARTWORK,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {skewSymbolRememberedEndpoint,scaleSymbolRememberedEndpoint,rotateSymbolRememberedEndpoint,skewRememberedEndpoint,scaleRememberedEndpoint,rotateRememberedEndpoint,translateRememberedEndpoint,translateSymbolRememberedEndpoint} from '../packages/animation/src/motion-junction';
function fixture(tangent=false){
 const p=newProject(),a=p.layers[0];p.duration=12;
 const shape:Vector={id:'a',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 a.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape,x:frame*10},{...shape,id:'b',y:20}]}));a.keys.push({frame:10,shapes:[]});
 if(tangent)for(const k of a.keys)k.shapes=k.shapes.slice(0,1);
 createBasicMotionSpan(p,[a.id],0,4,'in');createBasicMotionSpan(p,[a.id],4,8,'linear',undefined,tangent?{startX:10,startY:0,endX:-10,endY:0,tangent:true}:undefined);
 return p;
}
it('regenerates both halves with their own settings; unrelated artwork and outer keys remain exact',()=>{
 const p=fixture(),a=p.layers[0],before=clone(a),outer=[a.keys[0],a.keys[8],a.keys[9]],unselected=a.keys[4].shapes[1];
 translateRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],20,8);
 expect(a.keys[2].shapes[0]).toMatchObject({x:15,y:2});expect(a.keys[4].shapes[0]).toMatchObject({x:60,y:8});expect(a.keys[6].shapes[0]).toMatchObject({x:70,y:4});expect(a.keys[4].shapes[1]).toBe(unselected);
 for(const [i,k] of [0,8,9].entries())expect(a.keys[k]).toBe(outer[i]);
 expect(a.motionSpans!.map(s=>[s.id,s.ease])).toEqual(before.motionSpans!.map(s=>[s.id,s.ease]));
 const reopened=clone(p);for(const [start,end] of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[a.id],start,end);
 expect(reopened.layers[0].keys).toEqual(a.keys);
});
it('publishes nothing when right geometry or either interior on a later track fails',()=>{
 for(const mode of ['geometry','left','right']){
  const p=fixture(true),a=p.layers[0],b=clone(a);b.id='second';p.layers.push(b);
  if(mode!=='geometry')b.keys[mode==='left'?1:6].shapes[0].x=999;
  else a.keys[8].shapes[0].x=120;
  const before=clone(p);expect(()=>translateRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:['a']})),mode==='geometry'?40:10,0)).toThrow(mode==='geometry'?/tangent/:/Generated keys changed/);
  expect(p).toEqual(before);
 }
});
it('rejects missing/stale selection, locks, non-finite inputs and ambiguous junctions',()=>{
 for(const mode of ['missing','locked','nan','duplicate','overlap','frame']){
  const p=fixture(),a=p.layers[0];if(mode==='locked')a.locked=true;if(mode==='overlap')a.motionSpans!.push({...clone(a.motionSpans![0]),id:'extra',end:6});
  const before=clone(p);expect(()=>translateRememberedEndpoint(p,mode==='frame'?3:4,[{layerId:a.id,shapeIds:mode==='missing'?['absent']:mode==='duplicate'?['a','a']:['a']}],mode==='nan'?NaN:1,2)).toThrow();expect(p).toEqual(before);
 }
});

it('translates isolated base and extra tracks without changing original keys or library artwork',()=>{
 const p=fixture(),a=p.layers[0],b=clone(a);b.id='extra';
 const def={id:'sym',name:'Symbol',width:100,height:100,shapes:a.keys[0].shapes,timeline:{duration:12,keys:a.keys.slice(1),motionSpans:a.motionSpans,layers:[b]}};
 const before=clone(def),draft=translateSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a']},{layerId:'extra',shapeIds:['b']}],20,8);
 expect(draft.timeline!.keys[3].shapes[0].x).toBe(60);expect(draft.timeline!.layers![0].keys[4].shapes[1].x).toBe(20);
 expect(draft.timeline!.keys[1].shapes[0].x).toBe(15);expect(draft.timeline!.keys[5].shapes[0].x).toBe(70);
 draft.shapes[0].x=999;expect(def).toEqual(before);
});
it('admits an exact-budget symbol edit and rejects projected growth or stale adjacent keys without publication',()=>{
 const a=fixture().layers[0],def={id:'sym',name:'Symbol',width:100,height:100,shapes:a.keys[0].shapes,timeline:{duration:12,keys:a.keys.slice(1),motionSpans:a.motionSpans}};
 const other={id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-18).fill(a.keys[0].shapes[0])};
 const move=()=>translateSymbolRememberedEndpoint(def,[def,other],4,[{layerId:'@base',shapeIds:['a']}],20,8);
 expect(move().timeline!.keys[3].shapes[0].x).toBe(60);
 // Keep original count at the limit, but regenerating the missing interior artwork would exceed it.
 def.timeline.keys[0].shapes.pop();other.shapes.push(a.keys[0].shapes[0]);const before=clone(def);
 expect(move).toThrow(/artwork budget/);expect(def).toEqual(before);other.shapes.pop();expect(move).toThrow(/Generated keys changed/);expect(def).toEqual(before);
});


// Independent matrix oracle checks the authored rotation, not regenerated output.
it('rotates a shared endpoint about its authoring center and refreshes independent halves',()=>{
 const p=fixture(),a=p.layers[0],before=structuredClone(p),outer=[a.keys[0],a.keys[8],a.keys[9]],sibling=a.keys[4].shapes[1];
 rotateRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],90);
 const joint=a.keys[4].shapes[0];
 expect(joint.x).toBeCloseTo(52);expect(joint.y).toBeCloseTo(0);
 expect(joint.rotation).toBe(90);expect(joint.transform).toBeUndefined();
 expect(a.keys[4].shapes[1]).toBe(sibling);
 for(const [i,k] of [0,8,9].entries())expect(a.keys[k]).toBe(outer[i]);
 expect(a.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(before.layers[0].motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 expect(a.keys[2].shapes[0].x).not.toBe(before.layers[0].keys[2].shapes[0].x);
 expect(a.keys[6].shapes[0].rotation).toBeCloseTo(45);
 const reopened=structuredClone(p);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[a.id],start,end);
 expect(reopened).toEqual(p);
});
it('uses a common saved world pivot for an affine multi-member selection without changing local data',()=>{
 const p=fixture(),a=p.layers[0];
 a.keys=a.keys.filter(k=>[0,4,8,10].includes(k.frame));delete a.motionSpans;
 for(const k of a.keys)if(k.shapes.length){
  k.shapes[0].pivot={x:0,y:0};k.shapes[1].pivot={x:40,y:-20};
  k.shapes.forEach(s=>s.groups=['outer','inner']);k.shapes[0].transform=[2,0,0,1];
 }
 createBasicMotionSpan(p,[a.id],0,4,'in');createBasicMotionSpan(p,[a.id],4,8,'linear');
 const before=structuredClone(a.keys[4].shapes);
 rotateRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['b','a']}],30);
 const c=Math.cos(Math.PI/6),n=Math.sin(Math.PI/6);
 for(let i=0;i<2;i++){
  const original=before[i],actual=a.keys[4].shapes[i],dx=original.x-40,dy=original.y;
  expect(actual.x).toBeCloseTo(40+c*dx-n*dy);expect(actual.y).toBeCloseTo(n*dx+c*dy);
  for(const field of ['id','groups','pivot','points','width','height','fill'] as const)expect(actual[field]).toEqual(original[field]);
 }
 expect(a.keys[4].shapes[0].transform).toEqual([2,0,0,1]);expect(a.keys[4].shapes[0].rotation).toBe(30);
});
for(const side of [1,6])it('rejects stale generated keys on a later rotation track atomically, frame '+side,()=>{
 const p=fixture(),a=p.layers[0],b=structuredClone(a);b.id='second';b.keys[side].shapes[0].x++;
 p.layers.push(b);const before=structuredClone(p);
 expect(()=>rotateRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:['a']})),30)).toThrow(/Generated keys changed/);expect(p).toEqual(before);
});
it('rejects invalid original numbers, input, merge and ambiguous selection without normalization',()=>{
 for(const mode of ['angle','zero','full','pivot','rotation','basis','point','merge','duplicate','missing','frame']){
  const p=fixture(),a=p.layers[0],shape=a.keys[4].shapes[0];
  if(mode==='pivot')shape.pivot={x:NaN,y:0};
  if(mode==='rotation')shape.rotation=NaN;
  if(mode==='basis')shape.transform=[1,0,0,NaN];
  if(mode==='point')shape.points=[{x:Infinity,y:0}];
  if(mode==='merge')a.drawingMode='merge';
  const before=structuredClone(p);
  expect(()=>rotateRememberedEndpoint(p,mode==='frame'?3:4,[{layerId:a.id,shapeIds:mode==='duplicate'?['a','a']:mode==='missing'?['absent']:['a']}],mode==='angle'?Infinity:mode==='zero'?0:mode==='full'?360:30)).toThrow();
  expect(p).toEqual(before);
 }
});

it('rejects a later track singular transform or invalid unselected original value without publishing earlier rotation',()=>{
 for(const mode of ['singular','unselected']){
  const p=fixture(),a=p.layers[0],b=structuredClone(a);b.id='second';p.layers.push(b);
  if(mode==='singular')b.keys[4].shapes[0].transform=[0,0,0,0];
  else b.keys[4].shapes[1].pivot={x:NaN,y:0};
  const before=structuredClone(p);
  expect(()=>rotateRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:['a']})),30)).toThrow(mode==='singular'?/geometry limits/:/nonfinite original/);
  expect(p).toEqual(before);
 }
});


function scaleFixture(saved=false,group=false){
 const p=fixture(),a=p.layers[0];a.keys=a.keys.filter(k=>[0,4,8,10].includes(k.frame));delete a.motionSpans;
 for(const k of a.keys)if(k.shapes.length){
  if(saved)k.shapes[0].pivot={x:0,y:0};
  if(group){
   k.shapes[1].x=k.shapes[0].x+20;k.shapes.forEach(s=>s.groups=['outer','inner']);
   if(saved)k.shapes[1].pivot={x:-20,y:-20};
  }
 }
 const rotation=group?{direction:'shortest' as const,turns:0,rigidGroups:true,axisGroupScale:true}:undefined;
 createBasicMotionSpan(p,[a.id],0,4,'in',{affine:true},undefined,rotation);
 createBasicMotionSpan(p,[a.id],4,8,'linear',{affine:true},undefined,rotation);
 return p;
}
for(const saved of [false,true])it('scales a shared key about default/saved pivot and refreshes both affine recipes, saved='+saved,()=>{
 const p=scaleFixture(saved),a=p.layers[0],before=structuredClone(p),outer=[a.keys[0],a.keys[8],a.keys[9]],sibling=a.keys[4].shapes[1];
 scaleRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],2,.5);
 expect(a.keys[4].shapes[0]).toMatchObject({x:saved?40:34,y:saved?0:3,transform:[2,0,0,.5],rotation:0});
 expect(a.keys[4].shapes[0].pivot).toEqual(before.layers[0].keys[4].shapes[0].pivot);expect(a.keys[4].shapes[1]).toBe(sibling);
 expect(a.keys[2].shapes[0].transform).toEqual([1.25,0,0,.875]);expect(a.keys[6].shapes[0].transform).toEqual([1.5,0,0,.75]);
 expect(a.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(before.layers[0].motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 for(const [i,k]of [0,8,9].entries())expect(a.keys[k]).toBe(outer[i]);
 const reopened=structuredClone(p);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[a.id],start,end);expect(reopened).toEqual(p);
});
it('scales complete grouped artwork once in document axes around a common saved pivot',()=>{
 const p=scaleFixture(true,true),a=p.layers[0],before=structuredClone(a.keys[4]);
 scaleRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['b','a']}],2,.5);
 expect(a.keys[4].shapes.map(s=>[s.x,s.y])).toEqual([[40,0],[80,10]]);
 for(let i=0;i<2;i++)for(const field of ['id','groups','pivot','width','height','points','fill']as const)expect(a.keys[4].shapes[i][field]).toEqual(before.shapes[i][field]);
});
it('rejects missing affine opt-in on either side without changing recipe settings or any track',()=>{
 for(const side of [0,1]){
  const p=scaleFixture(),a=p.layers[0],b=structuredClone(a);b.id='later';p.layers.push(b);
  b.motionSpans![side].options={affine:false};const before=structuredClone(p);
  expect(()=>scaleRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:['a']})),2,1)).toThrow(/enabled motion properties/);expect(p).toEqual(before);
 }
});
it('rejects stale ownership, orientation changes, singular/overflow input and original invalid values atomically',()=>{
 for(const mode of ['left','right','reflection','zero','nan','huge','tiny','original','merge','noop']){
  const p=scaleFixture(),a=p.layers[0],b=structuredClone(a);b.id='later';p.layers.push(b);
  if(mode==='left'||mode==='right')b.keys[mode==='left'?1:6].shapes[0].x++;
  if(mode==='original')b.keys[4].shapes[1].pivot={x:NaN,y:0};
  if(mode==='merge')b.drawingMode='merge';
  const before=structuredClone(p),sx=mode==='reflection'?-1:mode==='zero'?0:mode==='nan'?NaN:mode==='huge'?1e308:mode==='tiny'?1e-12:mode==='noop'?1:2;
  expect(()=>scaleRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:['a']})),sx,1)).toThrow();expect(p).toEqual(before);
 }
});

it('single-axis world scaling composes rotated/skewed artwork without changing its orthogonal coordinates',()=>{
 const p=scaleFixture(),a=p.layers[0];a.keys=a.keys.filter(k=>[0,4,8,10].includes(k.frame));delete a.motionSpans;
 for(const key of a.keys)if(key.shapes.length){key.shapes[0].rotation=30;key.shapes[0].transform=[1,.2,.3,1];}
 createBasicMotionSpan(p,[a.id],0,4,'in',{affine:true});createBasicMotionSpan(p,[a.id],4,8,'linear',{affine:true});
 const original=structuredClone(a.keys[4].shapes[0]),angle=Math.PI/6,c=Math.cos(angle),n=Math.sin(angle);
 const world=(shape:Vector,x:number,y:number)=>{
  const r=shape.rotation*Math.PI/180,co=Math.cos(r),si=Math.sin(r),m=shape.transform!;
  return {x:shape.x+co*(m[0]*x+m[2]*y)-si*(m[1]*x+m[3]*y),y:shape.y+si*(m[0]*x+m[2]*y)+co*(m[1]*x+m[3]*y)};
 };
 const pivotX=original.x+c*(6+.3*6)-n*(.2*6+6);
 scaleRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],2,1);
 for(const [x,y]of [[0,0],[12,0],[12,12],[0,12]]){
  const before=world(original,x,y),after=world(a.keys[4].shapes[0],x,y);
  expect(after.x).toBeCloseTo(2*before.x-pivotX,10);expect(after.y).toBeCloseTo(before.y,10);
 }
});


for(const axis of ['x','y'] as const)for(const saved of [false,true])it('skews a shared key in document '+axis+' with independent halves and saved pivot='+saved,()=>{
 const p=scaleFixture(saved),a=p.layers[0],before=structuredClone(p),sibling=a.keys[4].shapes[1],outer=[a.keys[0],a.keys[8],a.keys[9]],h=Math.tan(Math.PI/6);
 skewRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],axis,30);
 const joint=a.keys[4].shapes[0];
 expect(joint.x).toBeCloseTo(40+(!saved&&axis==='x'?-6*h:0));expect(joint.y).toBeCloseTo(!saved&&axis==='y'?-6*h:0);
 expect(joint.transform).toEqual([1,axis==='y'?h:0,axis==='x'?h:0,1]);expect(joint.pivot).toEqual(before.layers[0].keys[4].shapes[0].pivot);expect(a.keys[4].shapes[1]).toBe(sibling);
 for(const [i,k]of [0,8,9].entries())expect(a.keys[k]).toBe(outer[i]);
 if(axis==='x'){expect(a.keys[2].shapes[0].transform![2]).toBeCloseTo(h*.25,12);expect(a.keys[6].shapes[0].transform![2]).toBeCloseTo(h*.5,12);}
 expect(a.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(before.layers[0].motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 const reopened=structuredClone(p);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[a.id],start,end);expect(reopened).toEqual(p);
});
for(const axis of ['x','y'] as const)it('admits complete group '+axis+' shear using saved settings and pivot',()=>{
 const p=scaleFixture(true,true),a=p.layers[0];
 a.keys=a.keys.filter(k=>[0,4,8,10].includes(k.frame));delete a.motionSpans;
 const rotation={direction:'shortest' as const,turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,savedGroupPivots:true};
 createBasicMotionSpan(p,[a.id],0,4,'in',{affine:true},undefined,rotation);createBasicMotionSpan(p,[a.id],4,8,'linear',{affine:true},undefined,rotation);
 const before=structuredClone(a.keys[4]),h=Math.tan(Math.PI/6);
 skewRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['b','a']}],axis,30);
 expect(a.keys[4].shapes[0].x).toBe(40);expect(a.keys[4].shapes[0].y).toBe(0);
 expect(a.keys[4].shapes[1].x).toBeCloseTo(60+(axis==='x'?20*h:0));expect(a.keys[4].shapes[1].y).toBeCloseTo(20+(axis==='y'?20*h:0));
 for(let i=0;i<2;i++)for(const field of ['id','groups','pivot','width','height','points','fill']as const)expect(a.keys[4].shapes[i][field]).toEqual(before.shapes[i][field]);
});
it('rejects stale or incompatible later tracks before publishing any skew',()=>{
 for(const mode of ['left','right','affine','group']){
  const p=scaleFixture(false,mode==='group'),a=p.layers[0],b=structuredClone(a);b.id='later';p.layers.push(b);
  if(mode==='left'||mode==='right')b.keys[mode==='left'?1:6].shapes[0].x++;
  if(mode==='affine')b.motionSpans![1].options={affine:false};
  const before=structuredClone(p);
  expect(()=>skewRememberedEndpoint(p,4,p.layers.map(l=>({layerId:l.id,shapeIds:mode==='group'?['a','b']:['a']})),'x',30)).toThrow();expect(p).toEqual(before);
 }
});
it('rejects skew no-ops, invalid axes/originals, near right angles, overflow and merge atomically',()=>{
 for(const mode of ['zero','halfturn','nan','right','near','huge','tiny','axis','original','merge']){
  const p=scaleFixture(),a=p.layers[0];
  if(mode==='original')a.keys[4].shapes[1].pivot={x:NaN,y:0};if(mode==='merge')a.drawingMode='merge';
  const before=structuredClone(p),angle=mode==='zero'?0:mode==='halfturn'?180:mode==='nan'?NaN:mode==='right'?90:mode==='near'?90-1e-9:mode==='huge'?1e308:mode==='tiny'?Number.MIN_VALUE:30;
  expect(()=>skewRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],mode==='axis'?'bad' as 'x':'x',angle)).toThrow();expect(p).toEqual(before);
 }
});


it('retains negative document-axis skew without normalizing its direction',()=>{
 for(const axis of ['x','y']as const){
  const p=scaleFixture(),a=p.layers[0],h=Math.tan(-Math.PI/6);
  skewRememberedEndpoint(p,4,[{layerId:a.id,shapeIds:['a']}],axis,-30);
  const shape=a.keys[4].shapes[0];expect(shape.transform).toEqual([1,axis==='y'?h:0,axis==='x'?h:0,1]);
  expect(shape.x).toBeCloseTo(40+(axis==='x'?-6*h:0),12);expect(shape.y).toBeCloseTo(axis==='y'?-6*h:0,12);
 }
});


function symbolRotationFixture(saved=false){
 const p=fixture(),base=p.layers[0],extra=structuredClone(base);extra.id='overlay';
 if(saved)for(const layer of [base,extra]){
  layer.keys=layer.keys.filter(k=>[0,4,8,10].includes(k.frame));delete layer.motionSpans;
  for(const k of layer.keys)if(k.shapes.length)k.shapes[0].pivot={x:0,y:0};
  createBasicMotionSpan({...p,layers:[layer]},[layer.id],0,4,'in');createBasicMotionSpan({...p,layers:[layer]},[layer.id],4,8,'linear');
 }
 const def={id:'rotation-symbol',name:'Rotation',width:100,height:100,shapes:base.keys[0].shapes,buttonStates:{up:0,over:4,down:8,hit:10},
 timeline:{duration:12,keys:base.keys.slice(1),motionSpans:base.motionSpans,layers:[extra]}};
 return {def,p};
}
for(const saved of [false,true])it('rotates detached base/additional symbol junctions with fixed mappings and saved pivot='+saved,()=>{
 const {def}=symbolRotationFixture(saved),before=structuredClone(def);
 const result=rotateSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],90);
 const base=result.timeline!.keys.find(k=>k.frame===4)!.shapes[0],extra=result.timeline!.layers![0].keys[4].shapes[0];
 for(const s of [base,extra]){expect(s.rotation).toBe(90);expect(s.x).toBeCloseTo(saved?40:52);expect(s.y).toBeCloseTo(0);}
 expect(result.buttonStates).toEqual(def.buttonStates);expect(result.timeline!.duration).toBe(12);
 expect(result.shapes).toEqual(def.shapes);expect(result.timeline!.keys.find(k=>k.frame===8)).toEqual(def.timeline.keys.find(k=>k.frame===8));
 expect(result.timeline!.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(def.timeline.motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 result.shapes[0].x=999;expect(def).toEqual(before);
});
it('rejects later symbol track stale ownership and nonfinite original/library values without publication',()=>{
 for(const mode of ['left','right','original','library','duplicate']){
  const {def}=symbolRotationFixture(),other={id:'other',name:'Other',width:20,height:20,shapes:structuredClone(def.shapes)};
  if(mode==='left'||mode==='right')def.timeline.layers[0].keys[mode==='left'?1:6].shapes[0].x++;
  if(mode==='original')def.timeline.keys[3].shapes[1].pivot={x:NaN,y:0};
  if(mode==='library')other.shapes[0].rotation=NaN;
  const library=mode==='duplicate'?[def,other,other]:[def,other],before=structuredClone({def,library});
  expect(()=>rotateSymbolRememberedEndpoint(def,library,4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],30)).toThrow();
  expect({def,library}).toEqual(before);
 }
});
it('admits exact aggregate capacity and rejects projected growth before allocating rotated interiors',()=>{
 const {def}=symbolRotationFixture(),own=36,other={id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-own).fill(def.shapes[0])};
 const rotate=()=>rotateSymbolRememberedEndpoint(def,[def,other],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],30);
 expect(rotate().timeline!.layers![0].keys[4].shapes[0].rotation).toBe(30);
 def.timeline.layers[0].keys[1].shapes.pop();other.shapes.push(def.shapes[0]);const before=structuredClone(def);
 expect(rotate).toThrow(/artwork budget/);expect(def).toEqual(before);
 other.shapes.pop();expect(rotate).toThrow(/Generated keys changed/);expect(def).toEqual(before);
});


for(const mode of ['loop','movie'] as const)it('retains nested '+mode+' timing during symbol junction rotation with original library admission',()=>{
 const p=newProject();p.duration=12;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const child={id:'clock-child',name:'Clock',width:12,height:12,shapes:[ink],timeline:{duration:3,keys:[{frame:1,shapes:[{...ink,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,fill:'#0000ff'}]}]}};
 p.symbols=[child];const track=p.layers[0];
 track.keys=[0,4,8].map(frame=>({frame,shapes:[{...ink,id:'nested',kind:'symbol' as const,symbolId:child.id,x:frame*10,symbolPlayback:{mode,firstFrame:mode==='loop'?frame%3:0}}]}));track.keys.push({frame:10,shapes:[]});
 createBasicMotionSpan(p,[track.id],0,4,'in');createBasicMotionSpan(p,[track.id],4,8,'linear');
 const def={id:'parent',name:'Parent',width:100,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}},before=structuredClone({def,child});
 const result=rotateSymbolRememberedEndpoint(def,[child,def],4,[{layerId:'@base',shapeIds:['nested']}],30);
 expect(result.timeline!.keys.map(k=>k.shapes[0]?.symbolPlayback)).toEqual(def.timeline.keys.map(k=>k.shapes[0]?.symbolPlayback));
 expect({def,child}).toEqual(before);
 expect(()=>rotateSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['nested']}],30)).toThrow(/missing/);expect({def,child}).toEqual(before);
});


function symbolScaleFixture(saved=false,group=false){
 const p=scaleFixture(saved,group),base=p.layers[0],overlay=structuredClone(base);overlay.id='overlay';
 const def={id:'scaling-symbol',name:'Scaling',width:100,height:100,shapes:base.keys[0].shapes,buttonStates:{up:0,over:4,down:8,hit:10},
 timeline:{duration:12,keys:base.keys.slice(1),motionSpans:base.motionSpans,layers:[overlay]}};
 return def;
}
for(const saved of [false,true])it('scales detached base/additional junctions with original settings and saved pivot='+saved,()=>{
 const def=symbolScaleFixture(saved),before=structuredClone(def);
 const result=scaleSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],2,.5);
 for(const keys of [result.timeline!.keys,result.timeline!.layers![0].keys]){
  expect(keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({x:saved?40:34,y:saved?0:3,transform:[2,0,0,.5]});
  expect(keys.find(k=>k.frame===2)!.shapes[0].transform).toEqual([1.25,0,0,.875]);expect(keys.find(k=>k.frame===6)!.shapes[0].transform).toEqual([1.5,0,0,.75]);
 }
 expect(result.buttonStates).toEqual(def.buttonStates);expect(result.timeline!.duration).toBe(12);expect(result.shapes).toEqual(def.shapes);
 expect(result.timeline!.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(def.timeline.motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 result.shapes[0].x=999;expect(def).toEqual(before);
});
it('scales complete saved-pivot groups without changing local geometry or ancestry',()=>{
 const def=symbolScaleFixture(true,true),before=structuredClone(def);
 const result=scaleSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a','b']}],2,.5),key=result.timeline!.keys.find(k=>k.frame===4)!;
 expect(key.shapes.map(s=>[s.x,s.y])).toEqual([[40,0],[80,10]]);
 for(let i=0;i<2;i++)for(const field of ['id','groups','pivot','points','width','height','fill']as const)expect(key.shapes[i][field]).toEqual(def.timeline.keys.find(k=>k.frame===4)!.shapes[i][field]);
 expect(def).toEqual(before);
});
it('rejects later-track stale/opt-in/numeric/orientation conflicts without any symbol mutation',()=>{
 for(const mode of ['left','right','optin','reflection','zero','tiny','huge','original','library','duplicate']){
  const def=symbolScaleFixture(),other={id:'other',name:'Other',width:20,height:20,shapes:structuredClone(def.shapes)};
  if(mode==='left'||mode==='right')def.timeline.layers[0].keys[mode==='left'?1:6].shapes[0].x++;
  if(mode==='optin')def.timeline.layers[0].motionSpans![1].options={affine:false};
  if(mode==='original')def.timeline.keys[3].shapes[1].pivot={x:NaN,y:0};
  if(mode==='library')other.shapes[0].rotation=NaN;
  const library=mode==='duplicate'?[def,other,other]:[def,other],before=structuredClone({def,library}),sx=mode==='reflection'?-1:mode==='zero'?0:mode==='tiny'?1e-12:mode==='huge'?1e308:2;
  expect(()=>scaleSymbolRememberedEndpoint(def,library,4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],sx,1)).toThrow();expect({def,library}).toEqual(before);
 }
});
it('admits exact symbol scale capacity and rejects projected expansion before regeneration',()=>{
 const def=symbolScaleFixture(),other={id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-36).fill(def.shapes[0])};
 const scale=()=>scaleSymbolRememberedEndpoint(def,[def,other],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],2,.5);
 expect(scale().timeline!.layers![0].keys[4].shapes[0].transform).toEqual([2,0,0,.5]);
 def.timeline.layers[0].keys[1].shapes.pop();other.shapes.push(def.shapes[0]);const before=structuredClone(def);
 expect(scale).toThrow(/artwork budget/);expect(def).toEqual(before);other.shapes.pop();expect(scale).toThrow(/Generated keys changed/);expect(def).toEqual(before);
});


for(const mode of ['loop','movie']as const)it('retains nested '+mode+' timing through symbol shared-key scale',()=>{
 const p=newProject();p.duration=12;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const child={id:'scale-clock',name:'Clock',width:12,height:12,shapes:[ink],timeline:{duration:3,keys:[{frame:1,shapes:[{...ink,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,fill:'#0000ff'}]}]}};
 p.symbols=[child];const track=p.layers[0];
 track.keys=[0,4,8].map(frame=>({frame,shapes:[{...ink,id:'nested',kind:'symbol' as const,symbolId:child.id,x:frame*10,symbolPlayback:{mode,firstFrame:mode==='loop'?frame%3:0}}]}));track.keys.push({frame:10,shapes:[]});
 createBasicMotionSpan(p,[track.id],0,4,'in',{affine:true});createBasicMotionSpan(p,[track.id],4,8,'linear',{affine:true});
 const def={id:'scale-parent',name:'Parent',width:100,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}},before=structuredClone({def,child});
 const result=scaleSymbolRememberedEndpoint(def,[child,def],4,[{layerId:'@base',shapeIds:['nested']}],2,.5);
 expect(result.timeline!.keys.map(k=>k.shapes[0]?.symbolPlayback)).toEqual(def.timeline.keys.map(k=>k.shapes[0]?.symbolPlayback));expect({def,child}).toEqual(before);
 expect(()=>scaleSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['nested']}],2,.5)).toThrow(/missing/);expect({def,child}).toEqual(before);
});


for(const axis of ['x','y']as const)for(const saved of [false,true])it('shears detached symbol base/additional tracks on '+axis+' with saved pivot='+saved,()=>{
 const def=symbolScaleFixture(saved),before=structuredClone(def),h=Math.tan(Math.PI/6);
 const result=skewSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],axis,30);
 for(const keys of [result.timeline!.keys,result.timeline!.layers![0].keys]){
  const joint=keys.find(k=>k.frame===4)!.shapes[0];
  expect(joint.x).toBeCloseTo(40+(!saved&&axis==='x'?-6*h:0),12);expect(joint.y).toBeCloseTo(!saved&&axis==='y'?-6*h:0,12);
  expect(joint.transform).toEqual([1,axis==='y'?h:0,axis==='x'?h:0,1]);
 }
 expect(result.shapes).toEqual(def.shapes);expect(result.buttonStates).toEqual(def.buttonStates);expect(result.timeline!.duration).toBe(12);
 expect(result.timeline!.motionSpans!.map(({baseline:_baseline,...settings})=>settings)).toEqual(def.timeline.motionSpans!.map(({baseline:_baseline,...settings})=>settings));
 expect(result.timeline!.keys.find(k=>k.frame===8)).toEqual(def.timeline.keys.find(k=>k.frame===8));expect(def).toEqual(before);
});
it('admits complete group shear through original group options and saved pivots',()=>{
 for(const axis of ['x','y']as const){
  const def=symbolScaleFixture(true,true);for(const spans of [def.timeline.motionSpans!,def.timeline.layers[0].motionSpans!])for(const s of spans)s.rotation={...s.rotation!,axisGroupShear:true};
  const before=structuredClone(def),h=Math.tan(Math.PI/6);
  const result=skewSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['a','b']}],axis,30),key=result.timeline!.keys.find(k=>k.frame===4)!;
  expect(key.shapes[0].x).toBe(40);expect(key.shapes[0].y).toBe(0);
  expect(key.shapes[1].x).toBeCloseTo(60+(axis==='x'?20*h:0),12);expect(key.shapes[1].y).toBeCloseTo(20+(axis==='y'?20*h:0),12);
  for(let i=0;i<2;i++)for(const field of ['id','groups','pivot','width','height','points','fill']as const)expect(key.shapes[i][field]).toEqual(def.timeline.keys.find(k=>k.frame===4)!.shapes[i][field]);
  expect(def).toEqual(before);
 }
});
it('rejects stale later tracks, incompatible options, invalid originals and angles before symbol writes',()=>{
 for(const mode of ['left','right','optin','zero','right-angle','near','huge','tiny','axis','original','library','duplicate']){
  const def=symbolScaleFixture(),other={id:'other',name:'Other',width:20,height:20,shapes:structuredClone(def.shapes)};
  if(mode==='left'||mode==='right')def.timeline.layers[0].keys[mode==='left'?1:6].shapes[0].x++;
  if(mode==='optin')def.timeline.layers[0].motionSpans![1].options={affine:false};
  if(mode==='original')def.timeline.keys[3].shapes[1].pivot={x:NaN,y:0};if(mode==='library')other.shapes[0].rotation=NaN;
  const library=mode==='duplicate'?[def,other,other]:[def,other],before=structuredClone({def,library}),angle=mode==='zero'?0:mode==='right-angle'?90:mode==='near'?90-1e-9:mode==='huge'?1e308:mode==='tiny'?Number.MIN_VALUE:30;
  expect(()=>skewSymbolRememberedEndpoint(def,library,4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],mode==='axis'?'bad'as'x':'x',angle)).toThrow();expect({def,library}).toEqual(before);
 }
});
it('admits exact aggregate symbol skew capacity and rejects projected growth or stale intervals',()=>{
 const def=symbolScaleFixture(),other={id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-36).fill(def.shapes[0])};
 const skew=()=>skewSymbolRememberedEndpoint(def,[def,other],4,[{layerId:'@base',shapeIds:['a']},{layerId:'overlay',shapeIds:['a']}],'x',30);
 expect(skew().timeline!.layers![0].keys[4].shapes[0].transform![2]).toBeCloseTo(Math.tan(Math.PI/6),12);
 def.timeline.layers[0].keys[1].shapes.pop();other.shapes.push(def.shapes[0]);const before=structuredClone(def);
 expect(skew).toThrow(/artwork budget/);expect(def).toEqual(before);other.shapes.pop();expect(skew).toThrow(/Generated keys changed/);expect(def).toEqual(before);
});

for(const mode of ['loop','movie']as const)it('retains nested '+mode+' timing through symbol shared-key skew',()=>{
 const p=newProject();p.duration=12;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 const child={id:'skew-clock',name:'Clock',width:12,height:12,shapes:[ink],timeline:{duration:3,keys:[{frame:1,shapes:[{...ink,fill:'#00ff00'}]},{frame:2,shapes:[{...ink,fill:'#0000ff'}]}]}};
 p.symbols=[child];const track=p.layers[0];
 track.keys=[0,4,8].map(frame=>({frame,shapes:[{...ink,id:'nested',kind:'symbol' as const,symbolId:child.id,x:frame*10,symbolPlayback:{mode,firstFrame:mode==='loop'?frame%3:0}}]}));track.keys.push({frame:10,shapes:[]});
 createBasicMotionSpan(p,[track.id],0,4,'in',{affine:true});createBasicMotionSpan(p,[track.id],4,8,'linear',{affine:true});
 const def={id:'skew-parent',name:'Parent',width:100,height:100,shapes:track.keys[0].shapes,timeline:{duration:12,keys:track.keys.slice(1),motionSpans:track.motionSpans}},before=structuredClone({def,child});
 const result=skewSymbolRememberedEndpoint(def,[child,def],4,[{layerId:'@base',shapeIds:['nested']}],'x',30);
 expect(result.timeline!.keys.map(k=>k.shapes[0]?.symbolPlayback)).toEqual(def.timeline.keys.map(k=>k.shapes[0]?.symbolPlayback));expect({def,child}).toEqual(before);
 expect(()=>skewSymbolRememberedEndpoint(def,[def],4,[{layerId:'@base',shapeIds:['nested']}],'x',30)).toThrow(/missing/);expect({def,child}).toEqual(before);
});
