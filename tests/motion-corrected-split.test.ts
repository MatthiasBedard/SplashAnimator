import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,reverseBasicMotionSpan,splitBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {createMotionPathSampler,splitPreservedMotionPath} from '../packages/animation/src/motion-path';
it('preserves corrected zero-heading cubic cuts and validates progress',()=>{
 const from={x:0,y:0},to={x:100,y:100},path={startX:30,startY:30,endX:-30,endY:-30,tangent:true,headingOffset:-45},original=createMotionPathSampler(from,to,path);
 const halves=splitPreservedMotionPath(from,to,path,.5),cut=original(.5);for(const [i,half] of halves.entries()){const sample=createMotionPathSampler(i?cut:from,i?to:cut,half);for(let j=1;j<20;j++){const t=j/20,a=sample(t),b=original((i+t)/2);expect(a.x).toBeCloseTo(b.x,11);expect(a.y).toBeCloseTo(b.y,11);expect(a.tangentAngle).toBeCloseTo(b.tangentAngle!,11);}}
 expect(()=>splitPreservedMotionPath(from,to,path,NaN)).toThrow(/interior/);expect(path.headingOffset).toBe(-45);
});
it('subdivides reversed tangent recipes without changing any keys and refreshes both saved halves',()=>{
 const p=newProject();p.duration=9;const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,x:100}]}];const ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,8,'linear',undefined,{startX:30,startY:20,endX:-30,endY:20,tangent:true});reverseBasicMotionSpan(p,ids,0,8);const reversed=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,8,4,true)).toThrow(/unchanged/);expect(p).toEqual(reversed);refreshBasicMotionSpan(p,ids,0,8);const before=clone(p.layers[0].keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(p.layers[0].keys).toEqual(before);expect(p.layers[0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [a,b] of [[0,4],[4,8]])refreshBasicMotionSpan(loaded,ids,a,b);for(let i=0;i<9;i++){expect(loaded.layers[0].keys[i].shapes[0].x).toBeCloseTo(before[i].shapes[0].x,10);expect(loaded.layers[0].keys[i].shapes[0].rotation).toBeCloseTo(before[i].shapes[0].rotation,10);}
});
it('rejects a later stale track without publishing the earlier prepared split',()=>{
 const p=newProject();p.duration=9;const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,x:100,y:100}]}];p.layers.push({...clone(p.layers[0]),id:'later'});p.layers[1].keys[1].shapes[0].y=0;const ids=p.layers.map(l=>l.id);createBasicMotionSpan(p,ids,0,8,'linear',undefined,{startX:30,startY:30,endX:-30,endY:-30,tangent:true,headingOffset:-45});p.layers[1].keys[1].shapes[0].rotation+=1;const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,8,4,true)).toThrow(/must match the recipe/);expect(p).toEqual(before);
});

it('rebases nonzero and linear corrected headings over unequal cubic restrictions',()=>{
 const from={x:0,y:0},to={x:96,y:48};
 for(const correction of [{},{headingOffset:12},{headingOffset:-25,headingOffsetEnd:60}])for(const u of [.25,.5,.75]){
  const path={startX:24,startY:48,endX:-24,endY:24,tangent:true,...correction},before=clone(path),original=createMotionPathSampler(from,to,path),cut=original(u),halves=splitPreservedMotionPath(from,to,path,u);
  for(const [i,half] of halves.entries()){const sample=createMotionPathSampler(i?cut:from,i?to:cut,half);for(let j=1;j<20;j++){
   const t=j/20,a=sample(t),b=original(i?u+(1-u)*t:u*t);
   expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);
   expect(a.tangentAngle!+cut.tangentAngle!*(i?1-t:t)).toBeCloseTo(b.tangentAngle!,10);
  }}expect(path).toEqual(before);
 }
});
it('preserves exact keys and persisted refresh after nonzero linear-correction splits',()=>{
 for(const ease of ['linear','in','out'] as const){
  const p=newProject();p.duration=9;const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  p.layers[0].keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,x:96,y:96}]}];const ids=[p.layers[0].id];
  createBasicMotionSpan(p,ids,0,8,ease,undefined,{startX:32,startY:32,endX:-32,endY:-32,tangent:true,headingOffset:10,headingOffsetEnd:30});
  const before=clone(p.layers[0].keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(p.layers[0].keys).toEqual(before);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [a,b] of [[0,4],[4,8]])refreshBasicMotionSpan(loaded,ids,a,b);
  for(let i=0;i<9;i++)expect(loaded.layers[0].keys[i].shapes[0].rotation).toBeCloseTo(before[i].shapes[0].rotation,10);
 }
});

it('retains lifted branches across winding restrictions and rejects invalid original corrections',()=>{
 for(const reflection of [-1,1])for(const u of [.25,.5,.75]){
  const from={x:0,y:0},to={x:20,y:100*reflection},path={startX:280,startY:10*reflection,endX:-280,endY:-10*reflection,tangent:true,headingOffset:360,headingOffsetEnd:400};
  const original=createMotionPathSampler(from,to,path),cut=original(u),halves=splitPreservedMotionPath(from,to,path,u);
  for(const [i,half] of halves.entries()){const sample=createMotionPathSampler(i?cut:from,i?to:cut,half);for(let j=1;j<100;j++){const t=j/100;expect(sample(t).tangentAngle!+cut.tangentAngle!*(i?1-t:t)).toBeCloseTo(original(i?u+(1-u)*t:u*t).tangentAngle!,9);}}
 }
 const path={startX:30,startY:20,endX:-30,endY:20,tangent:true,headingOffset:NaN};expect(()=>splitPreservedMotionPath({x:0,y:0},{x:100,y:0},path,.5)).toThrow(/correction/);
});
