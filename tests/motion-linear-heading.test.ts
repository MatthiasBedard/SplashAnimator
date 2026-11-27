import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,validateProject,type Vector} from '../packages/document/src';
import {validateMotionPath} from '../packages/document/src/motion-path';
import {createMotionPathSampler,reverseTangentCubicPath,splitPreservedMotionPath} from '../packages/animation/src/motion-path';
import {createBasicMotionSpan,refreshBasicMotionSpan,splitBasicMotionSpan} from '../packages/animation/src/motion-spans';
const path={startX:30,startY:20,endX:-30,endY:20,tangent:true,headingOffset:180,headingOffsetEnd:90};
function fixture(){const p=newProject();p.duration=5;const a:Vector={id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[{...a,x:100}]}];createBasicMotionSpan(p,[p.layers[0].id],0,4,'in',undefined,path);return p;}
it('samples captured endpoint corrections in path progress and keeps authored endpoints',()=>{
 const from={x:0,y:0},to={x:100,y:0},settings={...path},sample=createMotionPathSampler(from,to,settings),base=createMotionPathSampler(from,to,{...path,headingOffset:0,headingOffsetEnd:0});settings.headingOffsetEnd=999;
 for(const t of [0,.1,.25,.5,.9,1]){const a=sample(t),b=base(t);expect(a.x).toBe(b.x);expect(a.y).toBe(b.y);expect(a.tangentAngle!-b.tangentAngle!).toBeCloseTo(180*(1-t)+90*t,10);}
 const p=fixture(),keys=clone(p.layers[0].keys);expect(keys[0].shapes[0].rotation).toBe(0);expect(keys[4].shapes[0].rotation).toBe(0);refreshBasicMotionSpan(p,[p.layers[0].id],0,4);expect(p.layers[0].keys).toEqual(keys);expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
 expect(reverseTangentCubicPath(from,to,path).headingOffsetEnd).toBeDefined();expect(splitPreservedMotionPath(from,to,path,.5)).toHaveLength(2);
});
it('validates original linear correction numbers and requires an explicit valid start',()=>{
 for(const headingOffsetEnd of [NaN,Infinity,null,'90',360001])expect(()=>validateMotionPath({...path,headingOffsetEnd} as typeof path)).toThrow(/correction/);
 expect(()=>validateMotionPath({...path,headingOffset:undefined})).toThrow(/start/);for(const bad of [{tangent:false}])expect(()=>validateMotionPath({...path,...bad})).toThrow(/correction/);
 const p=fixture();p.layers[0].motionSpans![0].path!.headingOffsetEnd=NaN;expect(()=>validateProject(p)).toThrow(/correction/);
});
it('migrates constant schema 44 paths unchanged and rejects unversioned linear fields on every track kind',()=>{
 const p=fixture();expect(()=>migrateProject({...p,schemaVersion:44})).toThrow(/schema 45/);delete p.layers[0].motionSpans![0].path!.headingOffsetEnd;const loaded=migrateProject({...p,schemaVersion:44});expect(loaded.schemaVersion).toBe(59);expect(loaded.layers[0].motionSpans![0].path!.headingOffset).toBe(180);expect(loaded.layers[0].motionSpans![0].path!.headingOffsetEnd).toBeUndefined();
 for(const additional of [false,true]){const q=fixture(),layer=clone(q.layers[0]);q.layers[0].motionSpans=undefined;q.symbols=[{id:'s',name:'s',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:5,keys:layer.keys.slice(1),...(additional?{layers:[{...layer,id:'extra'}]}:{motionSpans:layer.motionSpans})}}];expect(()=>migrateProject({...q,schemaVersion:44})).toThrow(/schema 45/);expect(validateProject(q)).toEqual(q);}
});

it('uses distance progress for angular corrections while the tangent follows the cubic parameter', () => {
 const from={x:0,y:0},to={x:96,y:32};
 const raw={startX:1,startY:60,endX:-60,endY:12,tangent:true,distance:true};
 const uncorrected=createMotionPathSampler(from,to,raw);
 const settings={...raw,headingOffset:-20,headingOffsetEnd:80};
 const corrected=createMotionPathSampler(from,to,settings);
 settings.headingOffsetEnd=200;
 for(const t of [0,.1,.25,.625,.9,1]){
   const a=uncorrected(t),b=corrected(t);
   expect([b.x,b.y]).toEqual([a.x,a.y]);
   expect(b.tangentAngle!-a.tangentAngle!).toBeCloseTo(-20+100*t,11);
 }
});

it('requires schema 48 for distance heading fields on root, base and additional symbol tracks', () => {
 for(const kind of ['root','base','additional']){
   const p=fixture(),layer=p.layers[0];
   layer.motionSpans![0].path!.distance=true;
   if(kind!=='root'){
     p.symbols=[{id:'child',name:'Child',width:100,height:100,shapes:layer.keys[0].shapes,
       timeline:{duration:5,keys:layer.keys.slice(1),...(kind==='base'?{motionSpans:layer.motionSpans}:{layers:[clone(layer)]})}}];
     delete layer.motionSpans;
   }
   expect(validateProject(p)).toEqual(p);
   for(const version of [43,45,46,47])expect(()=>migrateProject({...p,schemaVersion:version})).toThrow(/schema 48/);
 }
 const plain=fixture();plain.layers[0].motionSpans![0].path={startX:2,startY:2,endX:-2,endY:-2,distance:true,tangent:true};
 expect(migrateProject({...plain,schemaVersion:47})).toEqual(plain);
});

it('rejects distance-table drift on a later tangent cubic before promoting any track', () => {
 const p=fixture();p.duration=9;
 const first=p.layers[0], second=clone(first); second.id='second';
 p.layers.push(second);
 for(const layer of p.layers){
   layer.keys=[layer.keys[0],{...layer.keys[4],frame:8}];
   delete layer.motionSpans;
   createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,layer===second?
     {startX:3,startY:63,endX:-57,endY:12,tangent:true,distance:true}:undefined);
 }
 const before=clone(p);
 expect(()=>splitBasicMotionSpan(p,p.layers.map(l=>l.id),0,8,3,true)).toThrow(/trajectory numerically/);
 expect(p).toEqual(before);
});

it('promotes an uncorrected diagonal distance tangent at an unequal cut without changing artwork', () => {
 const p=fixture(),layer=p.layers[0];p.duration=9;
 const first=layer.keys[0].shapes[0];
 layer.keys=[{frame:0,shapes:[first]},{frame:8,shapes:[{...first,x:96,y:96}]}];
 delete layer.motionSpans;
 createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,{startX:32,startY:32,endX:-32,endY:-32,tangent:true,distance:true});
 const authored=clone(layer.keys);
 splitBasicMotionSpan(p,[layer.id],0,8,3,true);
 expect(layer.keys).toEqual(authored);
 expect(layer.motionSpans!.map(s=>[s.path?.headingOffset,s.path?.headingOffsetEnd])).toEqual([[0,-45],[-45,0]]);
 for(const s of layer.motionSpans!)refreshBasicMotionSpan(p,[layer.id],s.start,s.end);
 for(const [i,key] of layer.keys.entries())expect(key.shapes[0].rotation).toBeCloseTo(authored[i].shapes[0].rotation,12);
});

it('reserves straight waypoint corrections for schema 49 on every timeline', () => {
 for(const kind of ['root','base','additional']){
   const p=fixture(),layer=p.layers[0];
   layer.motionSpans![0].path!.waypoints=[{x:20,y:15}];
   if(kind!=='root'){
     p.symbols=[{id:'child',name:'Child',width:100,height:100,shapes:layer.keys[0].shapes,
       timeline:{duration:5,keys:layer.keys.slice(1),...(kind==='base'?{motionSpans:layer.motionSpans}:{layers:[clone(layer)]})}}];
     delete layer.motionSpans;
   }
   expect(validateProject(p)).toEqual(p);
   for(const version of [43,46,48])expect(()=>migrateProject({...p,schemaVersion:version})).toThrow(/schema 49/);
 }
});

for (const distance of [false,true]) for (const at of [2,4,6])
 it(`splits straight tangent segments and their outgoing corner (distance ${distance}, cut ${at})`, () => {
   const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=10;
   const ink=layer.keys[0].shapes[0];
   layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:40,y:40}]},{frame:9,shapes:[]}];
   delete layer.motionSpans;
   const route={startX:0,startY:0,endX:0,endY:0,waypoints:[{x:40,y:0}],distance,tangent:true,headingOffset:10,headingOffsetEnd:30};
   createBasicMotionSpan(p,ids,0,8,'linear',undefined,route);
   const original=clone(layer.keys);
   expect(original[4].shapes[0].rotation).toBe(110);
   splitBasicMotionSpan(p,ids,0,8,at,true);
   expect(layer.keys).toEqual(original);
   expect(layer.motionSpans!.every(s=>s.path?.tangent && !s.path.curvedWaypoints)).toBe(true);
   if(at===4) expect(layer.motionSpans!.map(s=>[s.path!.headingOffset,s.path!.headingOffsetEnd])).toEqual([[10,-90],[-90,30]]);
   const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
   for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,ids,span.start,span.end);
   for(let i=0;i<=8;i++)for(const field of ['x','y','rotation'] as const)
     expect(reopened.layers[0].keys[i].shapes[0][field]).toBeCloseTo(original[i].shapes[0][field],11);
 });

it('rejects an unrepresentable equal-time tangent partition on a later track atomically', () => {
 const p=fixture(),first=p.layers[0];p.duration=258;
 first.keys=[first.keys[0],{...first.keys[4],frame:257}];delete first.motionSpans;
 const second={...clone(first),id:'routed'};p.layers.push(second);
 createBasicMotionSpan(p,[first.id],0,257,'linear');
 createBasicMotionSpan(p,[second.id],0,257,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:20}],tangent:true});
 const before=clone(p);
 expect(()=>splitBasicMotionSpan(p,[first.id,second.id],0,257,3,true)).toThrow(/subdivision budget/);
 expect(p).toEqual(before);
});

it('splits an uncorrected unequal-length distance route inside the outgoing segment', () => {
  const p=fixture(),layer=p.layers[0];p.duration=9;
  const ink=layer.keys[0].shapes[0];
  layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:20,y:-60}]}];
  delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,{
    startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:0}],tangent:true,distance:true,
  });
  const before=clone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,8,4,true);
  expect(layer.keys).toEqual(before);
  expect(layer.keys[4].shapes[0]).toMatchObject({x:20,y:-20,rotation:-90});
  for(const span of layer.motionSpans!)refreshBasicMotionSpan(p,[layer.id],span.start,span.end);
  for(const [i,key] of before.entries())for(const f of ['x','y','rotation'] as const)
    expect(layer.keys[i].shapes[0][f]).toBeCloseTo(key.shapes[0][f],11);
});
