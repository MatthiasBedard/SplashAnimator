import {it,expect} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureRememberedAuthoringFrame} from '../packages/animation/src/motion-owner';
import {preparePickedMotionCandidate} from '../apps/editor/src/picked-motion-candidate';
function fixture(saved=false,affine=false){
 const p=newProject(),l=p.layers[0];p.duration=10;
 const ink:Vector={id:'picked',kind:'rectangle',x:0,y:10,width:40,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(saved?{pivot:{x:0,y:0}}:{})};
 l.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[l.id],0,8,'linear',affine?{affine:true}:undefined);l.keys[8].shapes[0].x=160;
 const capture=captureRememberedAuthoringFrame(()=>({project:p,revision:0}),4);
 const owner=capture.resolve(l.id,'picked');capture.dispose();
 return {p,l,owner};
}
for(const saved of [false,true])it('promotes and rotates the freshly evaluated pose without mutating source, saved='+saved,()=>{
 const {p,l,owner}=fixture(saved),before=structuredClone(p);
 const result=preparePickedMotionCandidate(p,owner,undefined,90),track=result.layers[0],joint=track.keys[4].shapes[0];
 expect(p).toEqual(before);expect(joint.rotation).toBe(90);
 expect(joint.x).toBeCloseTo(80+(saved?0:26));expect(joint.y).toBeCloseTo(10+(saved?0:-14));
 expect(joint.pivot).toEqual(l.keys[0].shapes[0].pivot);
 expect(track.keys[2].shapes[0].rotation).toBeCloseTo(45);expect(track.keys[6].shapes[0].rotation).toBeCloseTo(45);
 expect(track.keys[4].shapes[1]).toEqual(before.layers[0].keys[4].shapes[1]);
 expect(track.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([l.keys[0],l.keys[8],l.keys[9]]);
 const reopened=structuredClone(result);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[l.id],start,end);
 expect(reopened).toEqual(result);
});
it('rejects invalid originals, invalid angles and merge rotation with no source split',()=>{
 for(const mode of ['nan','zero','whole','overflow','original','merge']){
  const {p,owner}=fixture();if(mode==='original')p.layers[0].keys[4].shapes[0].rotation=NaN;
  if(mode==='merge')p.layers[0].drawingMode='merge';
  const before=structuredClone(p),angle=mode==='nan'?NaN:mode==='zero'?0:mode==='whole'?360:mode==='overflow'?1e308:90;
  expect(()=>preparePickedMotionCandidate(p,owner,undefined,angle)).toThrow();expect(p).toEqual(before);
 }
});


for(const saved of [false,true])it('promotes and scales the fresh pose with detached ownership and unchanged recipe options, saved='+saved,()=>{
 const {p,l,owner}=fixture(saved,true),before=structuredClone(p);
 const result=preparePickedMotionCandidate(p,owner,undefined,undefined,{x:2,y:.5}),track=result.layers[0],joint=track.keys[4].shapes[0];
 expect(p).toEqual(before);expect(joint.x).toBeCloseTo(saved?80:60);expect(joint.y).toBeCloseTo(saved?10:13);
 expect(joint.transform).toEqual([2,0,0,.5]);expect(joint.pivot).toEqual(l.keys[0].shapes[0].pivot);
 expect(track.keys[2].shapes[0].transform).toEqual([1.5,0,0,.75]);expect(track.keys[6].shapes[0].transform).toEqual([1.5,0,0,.75]);
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);
 expect(track.keys[4].shapes[1]).toEqual(l.keys[4].shapes[1]);
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([l.keys[0],l.keys[8],l.keys[9]]);
 const reopened=structuredClone(result);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[l.id],start,end);expect(reopened).toEqual(result);
});
it('single-axis picked scaling leaves the other axis unchanged',()=>{
 const {p,owner}=fixture(false,true),result=preparePickedMotionCandidate(p,owner,undefined,undefined,{x:2,y:1});
 const joint=result.layers[0].keys[4].shapes[0];expect(joint.x).toBe(60);expect(joint.y).toBe(10);expect(joint.transform).toEqual([2,0,0,1]);
});
it('rejects scale without affine opt-in, invalid factors/originals, orientation changes and merge without splitting the source',()=>{
 for(const mode of ['optin','nan','zero','noop','overflow','tiny','original','reflection','merge']){
  const {p,owner}=fixture(false,mode!=='optin');
  if(mode==='original')p.layers[0].keys[4].shapes[1].pivot={x:NaN,y:0};
  if(mode==='merge')p.layers[0].drawingMode='merge';
  const before=structuredClone(p),x=mode==='nan'?NaN:mode==='zero'?0:mode==='noop'?1:mode==='overflow'?1e308:mode==='tiny'?1e-12:mode==='reflection'?-1:2;
  expect(()=>preparePickedMotionCandidate(p,owner,undefined,undefined,{x,y:1})).toThrow();expect(p).toEqual(before);
 }
});


for(const axis of ['x','y'] as const)for(const saved of [false,true])it('promotes and skews a fresh picked pose on '+axis+' with saved pivot='+saved,()=>{
 const {p,l,owner}=fixture(saved,true),before=structuredClone(p),h=Math.tan(Math.PI/6);
 const result=preparePickedMotionCandidate(p,owner,undefined,undefined,undefined,{axis,degrees:30}),track=result.layers[0],joint=track.keys[4].shapes[0];
 expect(p).toEqual(before);expect(joint.x).toBeCloseTo(80+(!saved&&axis==='x'?-6*h:0),12);expect(joint.y).toBeCloseTo(10+(!saved&&axis==='y'?-20*h:0),12);
 expect(joint.transform).toEqual([1,axis==='y'?h:0,axis==='x'?h:0,1]);expect(joint.pivot).toEqual(l.keys[0].shapes[0].pivot);
 if(axis==='x'){expect(track.keys[2].shapes[0].transform![2]).toBeCloseTo(h*.5,12);expect(track.keys[6].shapes[0].transform![2]).toBeCloseTo(h*.5,12);}
 expect(track.keys[4].shapes[1]).toEqual(l.keys[4].shapes[1]);expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([l.keys[0],l.keys[8],l.keys[9]]);
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);
 const reopened=structuredClone(result);for(const [start,end]of [[0,4],[4,8]])refreshBasicMotionSpan(reopened,[l.id],start,end);expect(reopened).toEqual(result);
});
it('rejects invalid original or skew settings and missing opt-in without publishing a promotion',()=>{
 for(const mode of ['optin','axis','zero','nan','right','near','huge','tiny','original','merge']){
  const {p,owner}=fixture(false,mode!=='optin');if(mode==='original')p.layers[0].keys[4].shapes[1].pivot={x:NaN,y:0};if(mode==='merge')p.layers[0].drawingMode='merge';
  const before=structuredClone(p),degrees=mode==='zero'?0:mode==='nan'?NaN:mode==='right'?90:mode==='near'?90-1e-9:mode==='huge'?1e308:mode==='tiny'?Number.MIN_VALUE:30;
  expect(()=>preparePickedMotionCandidate(p,owner,undefined,undefined,undefined,{axis:mode==='axis'?'bad'as'x':'x',degrees})).toThrow();expect(p).toEqual(before);
 }
});
