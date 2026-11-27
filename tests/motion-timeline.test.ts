import {expect,it} from 'vitest';
import {clone,newProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {createRememberedTimelineSampler} from '../packages/animation/src/motion-timeline';
function fixture(){
 const p=newProject();p.duration=14;const a:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[{...a,x:40}]},{frame:8,shapes:[{...a,x:80}]},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear');createBasicMotionSpan(p,[p.layers[0].id],4,8,'linear');return p;
}
it('selects adjacent recipes while retaining authored endpoints, held origins, blanks and layer order',()=>{
 const p=fixture(),a=p.layers[0];a.keys.find(k=>k.frame===4)!.shapes[0].x=80;a.locked=true;
 const b=clone(a);b.id='b';b.motionSpans=[];p.layers.push(b);const hidden=clone(a);hidden.id='hidden';hidden.visible=false;p.layers.push(hidden);
 const before=clone(p),plan=createRememberedTimelineSampler(()=>({project:p,revision:0}));
 expect(plan.sample(2).map(pose=>[pose.layerId,pose.key.shapes[0].x,pose.sampled])).toEqual([[a.id,40,true],['b',20,false]]);
 expect(plan.sample(6)[0].key.shapes[0].x).toBe(80);
 for(const frame of [0,4,8])expect(plan.sample(frame)[0]).toEqual({layerId:a.id,key:a.keys.find(k=>k.frame===frame),sampled:false});
 expect(plan.sample(9)[0].key.frame).toBe(8);expect(plan.sample(11)[0].key).toEqual({frame:10,shapes:[]});
 const returned=plan.sample(2);returned[0].key.shapes[0].x=999;expect(p).toEqual(before);plan.dispose();expect(()=>plan.sample(2)).toThrow(/disposed/);
});
it('rebuilds on revision changes and rejects later-track edits without returning a partial scene',()=>{
 const p=fixture(),a=p.layers[0],b=clone(a);b.id='b';p.layers.push(b);let revision=0;
 const plan=createRememberedTimelineSampler(()=>({project:p,revision}));expect(plan.sample(2)).toHaveLength(2);
 a.keys[4].shapes[0].x=120;revision++;expect(plan.sample(2)[0].key.shapes[0].x).toBe(60);
 b.keys[2].shapes[0].x=999;revision++;const before=clone(p);expect(()=>plan.sample(2)).toThrow(/Generated keys changed/);expect(p).toEqual(before);
 b.keys[2].shapes[0].x=20;revision++;expect(plan.sample(2)).toHaveLength(2);
});
it('rejects ambiguous ranges, duplicate layers and source races',()=>{
 for(const mode of ['overlap','identity','race']){
  const p=fixture();let reads=0,revision=0;const plan=createRememberedTimelineSampler(()=>{if(mode==='race'&&++reads===2)revision++;return {project:p,revision}});
  if(mode==='overlap')p.layers[0].motionSpans!.push({...clone(p.layers[0].motionSpans![0]),id:'overlap',start:1,end:5});
  if(mode==='identity')p.layers.push(clone(p.layers[0]));
  expect(()=>plan.sample(2)).toThrow();
 }
});
it('invalidates during source callbacks and preserves valid retry after rejected frames',()=>{
 const p=fixture();let invalidate=false;const plan=createRememberedTimelineSampler(()=>{if(invalidate)plan.invalidate();return {project:p,revision:0}});
 for(const frame of [-1,0.5,14,NaN])expect(()=>plan.sample(frame)).toThrow();expect(plan.sample(2)[0].key.shapes[0].x).toBe(20);
 invalidate=true;expect(()=>plan.sample(2)).toThrow(/invalidated/);invalidate=false;expect(plan.sample(6)[0].key.shapes[0].x).toBe(60);
});

it('carries sampled graphic age once and preserves authored held playback settings',()=>{
 const p=newProject();p.duration=8;const art:Vector={id:'art',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 p.symbols=[{id:'graphic',name:'Graphic',width:20,height:20,shapes:[art],timeline:{duration:3,keys:[]}}];
 const a:Vector={...art,id:'instance',kind:'symbol',symbolId:'graphic',symbolPlayback:{mode:'loop',firstFrame:1}};
 p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[{...a,x:80,symbolPlayback:{mode:'single',firstFrame:2}}]},{frame:6,shapes:[]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear');const plan=createRememberedTimelineSampler(()=>({project:p,revision:0}));
 const sample=plan.sample(2)[0];expect(sample.key.frame).toBe(2);expect(sample.key.shapes[0].symbolPlayback).toEqual({mode:'loop',firstFrame:0});
 const held=plan.sample(5)[0];expect(held.sampled).toBe(false);expect(held.key.frame).toBe(4);expect(held.key.shapes[0].symbolPlayback).toEqual({mode:'single',firstFrame:2});
});
