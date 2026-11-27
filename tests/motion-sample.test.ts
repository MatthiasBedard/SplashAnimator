import {expect,it} from 'vitest';
import {clone,newProject,type Vector} from '../packages/document/src';
import {sampleMotionFrame,createMotionFrameSampler,type MotionFrameRecipe} from '../packages/animation/src/motion-frames';
import {createBasicMotionSpan,promoteSampledMotionFrame,setRememberedMotionSpin,refreshBasicMotionSpan,editSymbolBasicMotionSpan,sampleRememberedMotionFrames,createRememberedMotionSampler} from '../packages/animation/src/motion-spans';
import {symbolInstance} from '../packages/geometry/src/symbols';
function fixture(){const p=newProject();p.duration=10;const a:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:1,points:[]};p.layers[0].keys=[{frame:0,shapes:[a]},{frame:8,shapes:[{...clone(a),x:80,y:40,rotation:60}]}];return p;}
function compare(p:ReturnType<typeof fixture>,recipe:MotionFrameRecipe){
 const before=clone(p),baked=clone(p),id=p.layers[0].id;
 createBasicMotionSpan(baked,[id],recipe.start,recipe.end,recipe.ease,recipe.options,recipe.path,recipe.rotation,recipe.correspondence);
 for(let frame=recipe.start;frame<=recipe.end;frame++)expect(sampleMotionFrame(p,id,recipe,frame)).toEqual(baked.layers[0].keys.find(k=>k.frame===frame)!.shapes);
 expect(p).toEqual(before);return baked;
}
it('matches full generation for easing, paint, affine and corrected tangent paths',()=>{
 for(const ease of ['linear','in','out','in-out'] as const){
  compare(fixture(),{start:0,end:8,ease});
  const painted=fixture();painted.layers[0].keys[1].shapes[0].fill='#0000ff';painted.layers[0].keys[1].shapes[0].strokeWidth=3;compare(painted,{start:0,end:8,ease,options:{paint:true,strokeWidth:true}});
  const p=fixture();p.layers[0].keys[1].shapes[0].transform=[2,0,0.25,1.5];compare(p,{start:0,end:8,ease,options:{affine:true}});
  compare(fixture(),{start:0,end:8,ease,path:{startX:30,startY:0,endX:-30,endY:0,tangent:true,headingOffset:20,headingOffsetEnd:-10}});
 }
});
it('preserves source and target contour ordering with aligned node matching',()=>{
 const p=fixture();for(const key of p.layers[0].keys){const shape=key.shapes[0];shape.kind='polygon';shape.contours=[[{x:0,y:0},{x:20,y:0},{x:0,y:20}]];}
 const recipe:MotionFrameRecipe={start:0,end:8,ease:'linear',options:{nodes:true},correspondence:{source:{start:1,reverse:true},start:2,reverse:true,nodes:true}};
 compare(p,recipe);
 const endpoint=sampleMotionFrame(p,p.layers[0].id,recipe,0);expect(endpoint).toEqual(p.layers[0].keys[0].shapes);endpoint[0].contours![0][0].x=999;expect(p.layers[0].keys[0].shapes[0].contours![0][0].x).toBe(0);
});
it('retains graphic exposure age and exact authored endpoint settings',()=>{
 const p=fixture(),definition={id:'graphic',name:'Graphic',width:20,height:20,shapes:clone(p.layers[0].keys[0].shapes),timeline:{duration:3,keys:[]}};p.symbols=[definition];
 const a=symbolInstance(definition,0,0);a.symbolPlayback={mode:'loop',firstFrame:1};const b=clone(a);b.x=80;b.symbolPlayback={mode:'single',firstFrame:2};p.layers[0].keys=[{frame:0,shapes:[a]},{frame:8,shapes:[b]}];compare(p,{start:0,end:8,ease:'linear'});
});
it('evaluates one pose in a long span without adopting edited interior keys',()=>{
 const p=fixture();p.duration=10000;p.layers[0].keys[1].frame=9999;p.layers[0].keys.splice(1,0,{frame:5000,shapes:[{...clone(p.layers[0].keys[0].shapes[0]),x:999}]});const before=clone(p),recipe:MotionFrameRecipe={start:0,end:9999,ease:'linear'};
 const sample=sampleMotionFrame(p,p.layers[0].id,recipe,5000);expect(sample[0].x).toBe(80*(5000/9999));expect(p).toEqual(before);sample[0].x=123;expect(sampleMotionFrame(p,p.layers[0].id,recipe,5000)[0].x).not.toBe(123);
});
it('rejects invalid originals and ranges without mutation even at authored endpoints',()=>{
 for(const mode of ['nan','locked','missing','source','duplicate']){const p=fixture(),recipe:MotionFrameRecipe={start:0,end:8,ease:'linear'};
  if(mode==='nan')p.layers[0].keys[1].shapes[0].x=NaN;if(mode==='locked')p.layers[0].locked=true;if(mode==='missing')p.layers[0].keys.pop();if(mode==='duplicate')p.layers[0].keys.push(p.layers[0].keys[0]);if(mode==='source')recipe.correspondence={source:{start:1}};
  const before=structuredClone(p);expect(()=>sampleMotionFrame(p,p.layers[0].id,recipe,0)).toThrow();expect(p).toEqual(before);
 }
 const p=fixture();for(const frame of [-1,0.5,9,NaN])expect(()=>sampleMotionFrame(p,p.layers[0].id,{start:0,end:8,ease:'linear'},frame)).toThrow();
});

it('samples remembered tracks in requested order with detached results and refreshed endpoint intent',()=>{
 const p=fixture(),a=p.layers[0];createBasicMotionSpan(p,[a.id],0,8,'linear');
 const b=clone(a);b.id='second';p.layers.push(b);a.keys[8].shapes[0].x=160;
 const before=clone(p),result=sampleRememberedMotionFrames(p,[b.id,a.id,b.id],0,8,4);
 expect(result.map(r=>r.layerId)).toEqual([b.id,a.id]);expect(result.map(r=>r.shapes[0].x)).toEqual([40,80]);
 result[0].shapes[0].x=999;expect(p).toEqual(before);
 for(const frame of [0,8])expect(sampleRememberedMotionFrames(p,[a.id],0,8,frame)[0].shapes).toEqual(a.keys[frame].shapes);
});
it('rejects edited, inserted, removed and retimed interiors on later tracks without adoption',()=>{
 for(const mode of ['edited','inserted','removed','retimed']){
  const p=fixture(),a=p.layers[0];createBasicMotionSpan(p,[a.id],0,8,'linear');const b=clone(a);b.id='second';p.layers.push(b);
  if(mode==='edited')b.keys[3].shapes[0].x+=1;if(mode==='inserted')b.keys.splice(3,0,clone(b.keys[3]));if(mode==='removed')b.keys.splice(3,1);if(mode==='retimed')b.keys[3].frame=3.5;
  const before=clone(p);expect(()=>sampleRememberedMotionFrames(p,[a.id,b.id],0,8,4)).toThrow(/Generated keys changed/);expect(p).toEqual(before);
 }
});
it('rejects ambiguous recipes, invalid endpoints, invalid originals and forged sparse baselines',()=>{
 for(const mode of ['span','layer','endpoint','nan','sparse','locked','missing']){
  const p=fixture(),a=p.layers[0];createBasicMotionSpan(p,[a.id],0,8,'linear');
  if(mode==='span')a.motionSpans!.push(clone(a.motionSpans![0]));if(mode==='layer')p.layers.push(clone(a));if(mode==='endpoint')a.keys[8].shapes[0].x=NaN;
  if(mode==='nan'){a.keys[3].shapes[0].x=NaN;a.motionSpans![0].baseline=JSON.stringify(a.keys.slice(1,-1));}
  if(mode==='sparse'){a.keys.splice(3,1);a.motionSpans![0].baseline=JSON.stringify(a.keys.slice(1,-1));}
  if(mode==='locked')a.locked=true;if(mode==='missing')a.motionSpans=[];
  const before=structuredClone(p);expect(()=>sampleRememberedMotionFrames(p,[a.id],0,8,4)).toThrow();expect(p).toEqual(before);
 }
});
it('checks remembered sample ranges and selection before returning artwork',()=>{
 const p=fixture(),id=p.layers[0].id;createBasicMotionSpan(p,[id],0,8,'linear');
 for(const frame of [-1,0.5,9,NaN])expect(()=>sampleRememberedMotionFrames(p,[id],0,8,frame)).toThrow();
 expect(()=>sampleRememberedMotionFrames(p,[],0,8,4)).toThrow();expect(()=>sampleRememberedMotionFrames(p,['missing'],0,8,4)).toThrow();
 expect(()=>sampleRememberedMotionFrames(p,[id],0,10,4)).toThrow();
});

it('captures reusable recipe preparation independently of sources and returned poses',()=>{
 const p=fixture(),id=p.layers[0].id,recipe:MotionFrameRecipe={start:0,end:8,ease:'in',path:{startX:30,startY:0,endX:-30,endY:0,tangent:true,headingOffset:20,headingOffsetEnd:-10}};
 const expected=Array.from({length:9},(_,frame)=>sampleMotionFrame(p,id,recipe,frame));
 const plan=createMotionFrameSampler(p,id,recipe);
 recipe.path!.headingOffset=999;recipe.ease='out';p.layers[0].keys[1].shapes[0].x=1234;p.duration=1;p.layers=[];
 for(const frame of [8,4,0,7,1,4]){const result=plan.sample(frame);expect(result).toEqual(expected[frame]);result[0].x=999;}
 expect(()=>plan.sample(NaN)).toThrow();expect(plan.sample(4)).toEqual(expected[4]);
 plan.dispose();plan.dispose();expect(()=>plan.sample(4)).toThrow(/disposed/);
});
it('captures remembered ownership once and requires recreation to adopt later source edits',()=>{
 const p=fixture(),a=p.layers[0];createBasicMotionSpan(p,[a.id],0,8,'linear');const b=clone(a);b.id='second';p.layers.push(b);
 const plan=createRememberedMotionSampler(p,[a.id,b.id],0,8),expected=plan.sample(4);
 a.keys[3].shapes[0].x=999;b.keys[8].shapes[0].x=160;b.motionSpans![0].ease='out';
 expect(plan.sample(4)).toEqual(expected);expect(()=>createRememberedMotionSampler(p,[a.id,b.id],0,8)).toThrow(/Generated keys changed/);
 plan.dispose();expect(()=>plan.sample(4)).toThrow(/disposed/);
});
it('captures symbol clock metadata and rejects invalid originals during preparation',()=>{
 const p=fixture(),definition={id:'graphic',name:'Graphic',width:20,height:20,shapes:clone(p.layers[0].keys[0].shapes),timeline:{duration:3,keys:[]}};p.symbols=[definition];
 const a=symbolInstance(definition,0,0),b=clone(a);b.x=80;p.layers[0].keys=[{frame:0,shapes:[a]},{frame:8,shapes:[b]}];
 const plan=createMotionFrameSampler(p,p.layers[0].id,{start:0,end:8,ease:'linear'});definition.timeline.duration=1;a.symbolPlayback={mode:'single',firstFrame:0};
 expect(plan.sample(4)[0].symbolPlayback).toEqual({mode:'loop',firstFrame:1});plan.dispose();
 b.x=NaN;expect(()=>createMotionFrameSampler(p,p.layers[0].id,{start:0,end:8,ease:'linear'})).toThrow();
});

it('re-eases selected recipes atomically without adopting later-track edits',()=>{
 const p=fixture(),a=p.layers[0];a.keys.push({frame:9,shapes:[]});createBasicMotionSpan(p,[a.id],0,8,'linear',{paint:true});
 const b=clone(a);b.id='second';p.layers.push(b);const before=clone(p);
 const ease={kind:'cubic' as const,x1:0.3,y1:0,x2:0.9,y2:0.4};
 refreshBasicMotionSpan(p,[a.id,b.id],0,8,ease);
 for(const [i,layer] of p.layers.entries()){
  const original=before.layers[i];expect(layer.motionSpans![0]).toMatchObject({id:original.motionSpans![0].id,ease,options:{paint:true}});
  expect(layer.keys[4].shapes[0].x).toBeLessThan(original.keys[4].shapes[0].x);expect(layer.keys.slice(8)).toEqual(original.keys.slice(8));expect(layer.keys[0]).toEqual(original.keys[0]);
 }
 ease.x1=1;expect(a.motionSpans![0].ease).not.toEqual(ease);
 b.keys[3].shapes[0].x=123;const edited=clone(p);expect(()=>refreshBasicMotionSpan(p,[a.id,b.id],0,8,'out')).toThrow(/Generated keys changed/);expect(p).toEqual(edited);
 expect(()=>refreshBasicMotionSpan(p,[a.id],0,8,{...ease,x1:NaN})).toThrow();expect(p).toEqual(edited);
});
it('re-eases an isolated symbol draft without changing the source definition',()=>{
 const a=fixture().layers[0];const def={id:'child',name:'Child',width:100,height:100,shapes:a.keys[0].shapes,timeline:{duration:10,keys:a.keys.slice(1)}};
 const owned=editSymbolBasicMotionSpan(def,['@base'],0,8,'create'),before=clone(owned);
 const result=editSymbolBasicMotionSpan(owned,['@base'],0,8,'ease','in');
 expect(result.timeline!.motionSpans![0]).toMatchObject({id:before.timeline!.motionSpans![0].id,ease:'in'});expect(result.timeline!.keys[3].shapes[0].x).toBeLessThan(before.timeline!.keys[3].shapes[0].x);expect(owned).toEqual(before);
});

it('replaces and clears a saved path without adopting other controls or interior edits',()=>{
 const p=fixture(),a=p.layers[0];a.keys.push({frame:9,shapes:[]});createBasicMotionSpan(p,[a.id],0,8,'in',{nodes:true},undefined,undefined,{start:0});
 const original=clone(a),path={startX:0,startY:50,endX:0,endY:50};refreshBasicMotionSpan(p,[a.id],0,8,undefined,path);
 const span=a.motionSpans![0];expect(span).toMatchObject({id:original.motionSpans![0].id,ease:'in',options:{nodes:true},correspondence:{start:0},path});expect(a.keys[4].shapes[0].y).toBeGreaterThan(original.keys[4].shapes[0].y);
 expect(a.keys[0]).toEqual(original.keys[0]);expect(a.keys.slice(8)).toEqual(original.keys.slice(8));path.startY=999;expect(span.path!.startY).toBe(50);
 refreshBasicMotionSpan(p,[a.id],0,8,undefined,null);expect(a).toEqual(original);
 const b=clone(a);b.id='second';p.layers.push(b);b.keys[8].shapes[0].x=0;b.keys[8].shapes[0].y=0;const before=clone(p);
 expect(()=>refreshBasicMotionSpan(p,[a.id,b.id],0,8,undefined,{startX:10,startY:0,endX:-10,endY:0,tangent:true})).toThrow(/tangent/);expect(p).toEqual(before);
 expect(()=>refreshBasicMotionSpan(p,[a.id],0,8,undefined,{...path,startX:NaN})).toThrow();expect(p).toEqual(before);
});

it('changes only directed turns across tracks and rejects invalid turns and edited interiors atomically',()=>{
 const p=fixture(),a=p.layers[0];a.keys.push({frame:9,shapes:[]});createBasicMotionSpan(p,[a.id],0,8,'in',{paint:true},{startX:0,startY:20,endX:0,endY:20});
 const b=clone(a);b.id='second';p.layers.push(b);const before=clone(p),spin={direction:'clockwise' as const,turns:2};
 setRememberedMotionSpin(p,[a.id,b.id],0,8,spin);
 for(const [i,layer] of p.layers.entries()){
  const orig=before.layers[i];expect(layer.keys[4].shapes[0].rotation-orig.keys[4].shapes[0].rotation).toBeCloseTo(180);
  expect(layer.keys.slice(8)).toEqual(orig.keys.slice(8));expect(layer.keys[0]).toEqual(orig.keys[0]);
  expect(layer.motionSpans![0]).toMatchObject({rotation:spin,id:orig.motionSpans![0].id,path:orig.motionSpans![0].path,ease:'in',options:{paint:true}});
 }
 spin.turns=5;expect(a.motionSpans![0].rotation!.turns).toBe(2);b.keys[1].shapes[0].x=999;const edited=clone(p);
 expect(()=>setRememberedMotionSpin(p,[a.id,b.id],0,8,{direction:'counterclockwise',turns:0})).toThrow(/Generated keys changed/);
 for(const turns of [NaN,-1,0.5,1])expect(()=>setRememberedMotionSpin(p,[a.id],0,8,{direction:'shortest',turns})).toThrow();
 expect(p).toEqual(edited);
});

it('promotes the refreshed pose and retains exact authored endpoints and outside keys',()=>{
 const p=fixture(),a=p.layers[0];a.keys.push({frame:9,shapes:[]});createBasicMotionSpan(p,[a.id],0,8,'linear');
 const id=a.motionSpans![0].id;a.keys[8].shapes[0].x=160;const end=a.keys[8],outside=a.keys[9],start=a.keys[0];
 const expected=clone(p);refreshBasicMotionSpan(expected,[a.id],0,8);promoteSampledMotionFrame(p,[a.id],0,8,4);
 expect(a.keys).toEqual(expected.layers[0].keys);expect(a.keys[4].shapes[0].x).toBe(80);
 expect(a.keys[0]).toBe(start);expect(a.keys[8]).toBe(end);expect(a.keys[9]).toBe(outside);
 expect(a.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);expect(a.motionSpans![0].id).toBe(id);
 const reopened=clone(p);for(const [lo,hi] of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[a.id],lo,hi);
 expect(reopened.layers[0].keys).toEqual(a.keys);
});
it('never publishes a refresh when a later selected track fails split or has an edited cut key',()=>{
 for(const mode of ['split','edited']){
  const p=fixture(),a=p.layers[0],b=clone(a);b.id='second';p.layers.push(b);
  createBasicMotionSpan(p,[a.id],0,8,'linear');createBasicMotionSpan(p,[b.id],0,8,mode==='split'?'in-out':'linear');
  a.keys[8].shapes[0].x=160;b.keys[8].shapes[0].x=240;if(mode==='edited')b.keys[2].shapes[0].x=999;
  const before=clone(p);expect(()=>promoteSampledMotionFrame(p,[a.id,b.id],0,8,2)).toThrow();expect(p).toEqual(before);
 }
});
