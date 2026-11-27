import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,validateProject,type Vector} from '../packages/document/src';
import {validateMotionPath,type MotionPath} from '../packages/document/src/motion-path';
import {createMotionPathSampler,splitPreservedMotionPath,reverseTangentMotionPath} from '../packages/animation/src/motion-path';
import {createBasicMotionSpan,refreshBasicMotionSpan,splitBasicMotionSpan,editSymbolBasicMotionSpan,reverseBasicMotionSpan} from '../packages/animation/src/motion-spans';
const route:MotionPath={startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,
  waypoints:[{x:30,y:30},{x:60,y:10}],tangent:true,headingOffset:10,headingOffsetEnd:30};
function fixture(path=route){
  const p=newProject();p.duration=14;
  const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:90,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  p.layers[0].keys=[{frame:0,shapes:[ink]},{frame:12,shapes:[{...ink,x:90,y:40,rotation:150}]},{frame:13,shapes:[]}];
  createBasicMotionSpan(p,[p.layers[0].id],0,12,'linear',undefined,path);
  return p;
}
for(const reflected of [false,true])for(const corrected of [false,true])for(const at of [4,8])
it(`preserves curved tangent boundary ${at} (reflected ${reflected}, correction ${corrected})`,()=>{
  const sign=reflected?-1:1,path={...route,waypoints:route.waypoints!.map(p=>({x:p.x,y:p.y*sign})),
    ...(corrected?{}:{headingOffset:undefined,headingOffsetEnd:undefined})};
  const p=fixture({...path,waypoints:route.waypoints!});
  if(reflected){
    const layer=p.layers[0],first=layer.keys[0],last=layer.keys[12];
    layer.keys=[first,{...last,shapes:[{...last.shapes[0],y:-40}]},{frame:13,shapes:[]}];delete layer.motionSpans;
    createBasicMotionSpan(p,[layer.id],0,12,'linear',undefined,path);
  }
  const layer=p.layers[0],before=clone(layer.keys);
  expect(Math.abs(before[at].shapes[0].rotation-(90+60*at/12))).toBeGreaterThan(1);
  splitBasicMotionSpan(p,[layer.id],0,12,at,true);
  expect(layer.keys).toEqual(before);expect(layer.motionSpans).toHaveLength(2);
  expect(layer.motionSpans!.some(s=>s.path!.curvedWaypoints && s.path!.headingOffset!==undefined)).toBe(true);
  const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
  for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,[layer.id],span.start,span.end);
  for(let i=0;i<before.length;i++)for(const field of ['x','y','rotation'] as const)
    if(i<13)expect(reopened.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
  expect(reopened.layers[0].keys[13]).toEqual(before[13]);
});
it('retains curved headings between keys in the same lifted branch',()=>{
  const from={x:0,y:0},to={x:90,y:40},progress=1/3,original=createMotionPathSampler(from,to,route),cut=original(progress);
  const halves=splitPreservedMotionPath(from,to,route,progress);
  halves.forEach((path,i)=>{
    const sample=createMotionPathSampler(i?cut:from,i?to:cut,path);
    for(const t of [.05,.2,.45,.7,.95]){
      const actual=sample(t),wanted=original(i?progress+(1-progress)*t:progress*t);
      expect(actual.x).toBeCloseTo(wanted.x,10);expect(actual.y).toBeCloseTo(wanted.y,10);
      expect(actual.tangentAngle!+(i?1-t:t)*cut.tangentAngle!).toBeCloseTo(wanted.tangentAngle!,10);
    }
  });
});
it('requires schema 50 for curved corrections on root, base and additional tracks',()=>{
  for(const kind of ['root','base','additional']){
    const p=fixture(),layer=p.layers[0];
    if(kind!=='root'){
      p.symbols=[{id:'s',name:'s',width:100,height:100,shapes:layer.keys[0].shapes,
        timeline:{duration:p.duration,keys:layer.keys.slice(1),...(kind==='base'?{motionSpans:layer.motionSpans}:{layers:[clone(layer)]})}}];
      delete layer.motionSpans;
    }
    expect(validateProject(p)).toEqual(p);
    for(const schemaVersion of [43,48,49])expect(()=>migrateProject({...p,schemaVersion})).toThrow(/schema 50/);
  }
  const p=fixture({...route,headingOffset:undefined,headingOffsetEnd:undefined});
  // Remove reserved fields rather than declaring them in a legacy recipe.
  delete p.layers[0].motionSpans![0].path!.headingOffset;
  delete p.layers[0].motionSpans![0].path!.headingOffsetEnd;
  expect(migrateProject({...p,schemaVersion:49})).toEqual(p);
});
it('rejects invalid original corrections and stale curved tracks atomically',()=>{
  for(const path of [{...route,distance:true,headingOffset:NaN},{...route,headingOffset:NaN},{...route,headingOffsetEnd:Infinity}])
    expect(()=>validateMotionPath(path)).toThrow(/correction/);
  const p=fixture(),second={...clone(p.layers[0]),id:'second'};p.layers.push(second);
  second.keys[2].shapes[0].x++;
  const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,p.layers.map(l=>l.id),0,12,4,true)).toThrow(/must match the recipe/);
  expect(p).toEqual(before);
});

it('rejects unresolved reflected correction rounding on a later track before any writes',()=>{
  const p=fixture(),first=p.layers[0],second={...clone(first),id:'reflected'};p.layers.push(second);
  const a={...second.keys[0].shapes[0],rotation:10},b={...second.keys[12].shapes[0],rotation:70,y:-40};
  second.keys=[{frame:0,shapes:[a]},{frame:12,shapes:[b]}];delete second.motionSpans;
  createBasicMotionSpan(p,[second.id],0,12,'linear',undefined,{...route,waypoints:route.waypoints!.map(p=>({...p,y:-p.y}))});
  const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,[first.id,second.id],0,12,4,true)).toThrow(/trajectory numerically/);
  expect(p).toEqual(before);
});

it.each([3,4,6])('splits base and additional symbol tracks in one detached library-aware edit at %i',(at)=>{
  const p=fixture(),base=p.layers[0],start=base.keys[0].shapes[0],end=base.keys[12].shapes[0];
  const definition={id:'curved-symbol',name:'Curved',width:100,height:100,shapes:[start],
    timeline:{duration:14,keys:[{frame:12,shapes:[end]},{frame:13,shapes:[]}],
      layers:[{...clone(base),id:'overlay',motionSpans:undefined,keys:[
        {frame:0,shapes:[{...start,id:'other',x:5}]},{frame:12,shapes:[{...end,id:'other',x:95}]},{frame:13,shapes:[]}]}]}};
  const ids=['@base','overlay'];
  const created=editSymbolBasicMotionSpan(definition,ids,0,12,'create','linear',[definition],undefined,false,undefined,route);
  const original=clone(created);
  const result=editSymbolBasicMotionSpan(created,ids,0,12,'split','linear',[created],undefined,false,
    undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,at,true);
  expect(created).toEqual(original);
  expect(result.shapes).toEqual(original.shapes);
  expect(result.timeline!.keys).toEqual(original.timeline!.keys);
  expect(result.timeline!.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,at],[at,12]]);
  expect(result.timeline!.layers![0].keys).toEqual(original.timeline!.layers![0].keys);
  expect(result.timeline!.layers![0].motionSpans).toHaveLength(2);
});

it('retains prior zero-heading curved cuts inside an existing segment',()=>{
  const p=fixture({startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,
    waypoints:[{x:30,y:0},{x:60,y:0}],tangent:true}),layer=p.layers[0],before=clone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,12,2,true);
  expect(layer.keys).toEqual(before);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  for(const span of loaded.layers[0].motionSpans!)refreshBasicMotionSpan(loaded,[layer.id],span.start,span.end);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
});

it('aligns independently lifted branches on winding curved waypoint halves',()=>{
  for(const sign of [-1,1])for(const progress of [.1,.3,.4,.5,.6,.7,.8,.9]){
    const from={x:0,y:0},to={x:100,y:0},path:MotionPath={startX:0,startY:0,endX:0,endY:0,
      tangent:true,curvedWaypoints:true,waypoints:[{x:100,y:0},{x:100,y:100*sign},{x:0,y:100*sign},{x:0,y:0}],
      headingOffset:360,headingOffsetEnd:400};
    const sample=createMotionPathSampler(from,to,path),cut=sample(progress);
    const halves=splitPreservedMotionPath(from,to,path,progress);
    halves.forEach((half,i)=>{
      const local=createMotionPathSampler(i?cut:from,i?to:cut,half);
      for(const t of [.03,.17,.39,.73,.97]){
        const actual=local(t),wanted=sample(i?progress+(1-progress)*t:progress*t);
        expect(actual.x).toBeCloseTo(wanted.x,9);expect(actual.y).toBeCloseTo(wanted.y,9);
        expect(actual.tangentAngle!+(i?1-t:t)*cut.tangentAngle!).toBeCloseTo(wanted.tangentAngle!,9);
      }
    });
  }
});

for(const reflected of [false,true])for(const corrected of [false,true])for(const at of [2,3,6,9,10])
it(`preserves a nonzero curved tangent inside a segment (reflected ${reflected}, correction ${corrected}, cut ${at})`,()=>{
  const sign=reflected?-1:1,path={...route,waypoints:route.waypoints!.map(p=>({...p,y:p.y*sign})),
    ...(corrected?{}:{headingOffset:undefined,headingOffsetEnd:undefined})};
  const p=fixture(),layer=p.layers[0],end={...layer.keys[12].shapes[0],y:40*sign};
  layer.keys=[layer.keys[0],{frame:12,shapes:[end]},{frame:13,shapes:[]}];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,12,'linear',undefined,path);
  const before=clone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,12,at,true);expect(layer.keys).toEqual(before);
  expect(layer.motionSpans!.every(s=>s.path!.tangent)).toBe(true);
  const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
  for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,[layer.id],span.start,span.end);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(reopened.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
  expect(reopened.layers[0].keys[13]).toEqual(before[13]);
});
it('rejects a later curved tangent cut exceeding the original uniform subdivision budget atomically',()=>{
  const p=fixture(),first=p.layers[0];p.duration=259;
  first.keys=[first.keys[0],{frame:257,shapes:[{...first.keys[0].shapes[0]}]}];delete first.motionSpans;
  const second={...clone(first),id:'later'};
  second.keys[1].shapes[0]={...second.keys[1].shapes[0],x:90,y:40,rotation:150};p.layers.push(second);
  createBasicMotionSpan(p,[first.id],0,257,'linear');
  createBasicMotionSpan(p,[second.id],0,257,'linear',undefined,route);
  const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,[first.id,second.id],0,257,3,true)).toThrow(/subdivision budget/);
  expect(p).toEqual(before);
});

it.each(['in','out','in-out'] as const)('preserves eased interior curved tangent cuts (%s)',ease=>{
  const p=fixture(),layer=p.layers[0],end=layer.keys[12];
  layer.keys=[layer.keys[0],end,{frame:13,shapes:[]}];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,12,ease,undefined,route);
  const at=ease==='in-out'?6:3,before=clone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,12,at,true);expect(layer.keys).toEqual(before);
  const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
  for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,[layer.id],span.start,span.end);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(reopened.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
});

for(const reflected of [false,true])for(const correction of ['none','constant','linear'] as const)
it(`reverses curved tangent recipes with exact artwork (reflected ${reflected}, correction ${correction})`,()=>{
  const sign=reflected?-1:1,path={...route,waypoints:route.waypoints!.map(p=>({...p,y:p.y*sign})),
    ...(correction==='none'?{headingOffset:undefined,headingOffsetEnd:undefined}:
      correction==='constant'?{headingOffsetEnd:undefined}:{})};
  const p=fixture(),layer=p.layers[0],last={...layer.keys[12].shapes[0],y:40*sign};
  layer.keys=[layer.keys[0],{frame:12,shapes:[last]},{frame:13,shapes:[]}];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,12,'in',undefined,path);
  const before=clone(layer.keys),recipeId=layer.motionSpans![0].id;
  reverseBasicMotionSpan(p,[layer.id],0,12);
  expect(layer.motionSpans![0].id).toBe(recipeId);expect(layer.motionSpans![0].ease).toBe('out');
  for(let i=0;i<=12;i++)expect(layer.keys[12-i].shapes).toEqual(before[i].shapes);
  expect(layer.keys[13]).toEqual(before[13]);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,[layer.id],0,12);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[12-i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
});
it('reverses curved lifted headings at complementary progress across winding branches',()=>{
  for(const sign of [-1,1])for(const scale of [1e-8,1,1e8]){
    const from={x:10*scale,y:-20*scale},to={x:110*scale,y:-20*scale};
    const path:MotionPath={startX:0,startY:0,endX:0,endY:0,tangent:true,curvedWaypoints:true,
      waypoints:[{x:100*scale,y:0},{x:100*scale,y:100*sign*scale},{x:0,y:100*sign*scale},{x:0,y:0}],
      headingOffset:12.25,headingOffsetEnd:47.5};
    const before=clone(path),result=reverseTangentMotionPath(from,to,path),
      reversed={...result.path,headingOffset:result.headingOffset,headingOffsetEnd:result.headingOffsetEnd};
    const original=createMotionPathSampler(from,to,path),sample=createMotionPathSampler(to,from,reversed);
    expect(reversed.curvedWaypoints).toBe(true);
    expect(reversed.headingOffsetEnd!-reversed.headingOffset).toBe(12.25-47.5);
    for(const t of [0,.03,.1,.2,.39,.4,.5,.6,.81,.99,1]){
      const a=original(1-t),b=sample(t);
      expect((b.x-a.x)/scale).toBeCloseTo(0,9);expect((b.y-a.y)/scale).toBeCloseTo(0,9);
      expect(b.tangentAngle).toBeCloseTo(a.tangentAngle!,9);
    }
    const twice=reverseTangentMotionPath(to,from,reversed);
    expect([twice.headingOffset,twice.headingOffsetEnd]).toEqual([12.25,47.5]);
    expect(path).toEqual(before);
  }
});
it('rejects composed curved correction overflow before publishing',()=>{
  const shift=reverseTangentMotionPath({x:0,y:0},{x:90,y:40},{...route,headingOffset:undefined,headingOffsetEnd:undefined}).headingOffset;
  const p=fixture(),layer=p.layers[0],end=layer.keys[12];
  layer.keys=[layer.keys[0],end];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,12,'linear',undefined,{...route,headingOffset:Math.sign(shift)*360000,headingOffsetEnd:0});
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[layer.id],0,12)).toThrow(/correction/);
  expect(p).toEqual(before);
});
it('rejects a stale later curved route before reversing any track',()=>{
  const p=fixture(),first=p.layers[0],second={...clone(first),id:'later'};p.layers.push(second);
  second.keys[3].shapes[0].rotation++;
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,12)).toThrow(/unchanged/);
  expect(p).toEqual(before);
});

it('rejects artwork requiring different reversed curved controls atomically',()=>{
  const p=fixture(),layer=p.layers[0],first=layer.keys[0],last=layer.keys[12];
  first.shapes.push({...first.shapes[0],id:'other',x:10});
  last.shapes.push({...last.shapes[0],id:'other',x:110});
  layer.keys=[first,last];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,12,'linear',undefined,route);
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[layer.id],0,12)).toThrow(/shared route/);
  expect(p).toEqual(before);
});
it('reverses base and additional curved tangent symbol tracks in a detached edit',()=>{
  const p=fixture(),base=p.layers[0],start=base.keys[0].shapes[0],end=base.keys[12].shapes[0];
  const definition={id:'reversed-curves',name:'Curves',width:100,height:100,shapes:[start],
    timeline:{duration:14,keys:[{frame:12,shapes:[end]},{frame:13,shapes:[]}],
      layers:[{...clone(base),id:'overlay',motionSpans:undefined,keys:[
        {frame:0,shapes:[{...start,id:'other',x:5}]},{frame:12,shapes:[{...end,id:'other',x:95}]},{frame:13,shapes:[]}]}]}};
  const ids=['@base','overlay'];
  const created=editSymbolBasicMotionSpan(definition,ids,0,12,'create','in',[definition],undefined,false,undefined,route);
  const before=clone(created);
  const result=editSymbolBasicMotionSpan(created,ids,0,12,'reverse','linear',[created]);
  expect(created).toEqual(before);
  for(let frame=1;frame<12;frame++){
    expect(result.timeline!.keys.find(k=>k.frame===12-frame)!.shapes).toEqual(before.timeline!.keys.find(k=>k.frame===frame)!.shapes);
    expect(result.timeline!.layers![0].keys.find(k=>k.frame===12-frame)!.shapes).toEqual(before.timeline!.layers![0].keys.find(k=>k.frame===frame)!.shapes);
  }
  expect(result.timeline!.motionSpans![0].ease).toBe('out');
  expect(result.timeline!.layers![0].motionSpans![0].ease).toBe('out');
  expect(result.timeline!.keys.at(-1)).toEqual(before.timeline!.keys.at(-1));
});

for(const sign of [-1,1])for(const correction of ['none','constant','linear'] as const)
it(`reverses distance curved tangent poses (reflection ${sign}, correction ${correction})`,()=>{
  const settings={...route,distance:true,waypoints:[{x:48,y:32*sign}],
    waypointTangents:[{x:16,y:32*sign},{x:16,y:0},{x:16,y:-32*sign}],
    ...(correction==='none'?{headingOffset:undefined,headingOffsetEnd:undefined}:
      correction==='constant'?{headingOffsetEnd:undefined}:{})};
  const p=fixture(),layer=p.layers[0],last={...layer.keys[12].shapes[0],x:96,y:0};p.duration=10;
  layer.keys=[layer.keys[0],{frame:8,shapes:[last]},{frame:9,shapes:[]}];delete layer.motionSpans;
  createBasicMotionSpan(p,[layer.id],0,8,'in',undefined,settings);
  const before=clone(layer.keys),spanId=layer.motionSpans![0].id;
  reverseBasicMotionSpan(p,[layer.id],0,8);
  expect(layer.motionSpans![0].path!.distance).toBe(true);expect(layer.motionSpans![0].id).toBe(spanId);
  for(let i=0;i<=8;i++)expect(layer.keys[8-i].shapes).toEqual(before[i].shapes);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,[layer.id],0,8);
  for(let i=0;i<=8;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[8-i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
  expect(loaded.layers[0].keys[9]).toEqual(before[9]);
});
it('samples distance curved corrections in distance progress and reverses at complementary distances',()=>{
  const from={x:0,y:0},to={x:100,y:0},settings:MotionPath={...route,
    waypoints:[{x:20,y:60},{x:90,y:70}],distance:true,headingOffset:12.25,headingOffsetEnd:47.5};
  const raw={...settings,headingOffset:undefined,headingOffsetEnd:undefined},
    a=createMotionPathSampler(from,to,raw),b=createMotionPathSampler(from,to,settings),
    timed=createMotionPathSampler(from,to,{...raw,distance:false}),result=reverseTangentMotionPath(from,to,settings),
    reversed={...result.path,headingOffset:result.headingOffset,headingOffsetEnd:result.headingOffsetEnd},
    back=createMotionPathSampler(to,from,reversed);
  expect(Math.hypot(a(.25).x-timed(.25).x,a(.25).y-timed(.25).y)).toBeGreaterThan(.1);
  settings.headingOffsetEnd=999;
  for(const t of [0,.01,.1,.25,.49,.5,.8,.99,1]){
    expect(b(t).tangentAngle!-a(t).tangentAngle!).toBeCloseTo(12.25*(1-t)+47.5*t,10);
    const wanted=b(1-t),actual=back(t);
    for(const field of ['x','y','tangentAngle'] as const)expect(actual[field]).toBeCloseTo(wanted[field]!,9);
  }
  const twice=reverseTangentMotionPath(to,from,reversed);
  expect([twice.headingOffset,twice.headingOffsetEnd]).toEqual([12.25,47.5]);
});
it('requires schema 51 for distance curved corrections on each track kind',()=>{
  for(const kind of ['root','base','additional']){
    const p=fixture({...route,distance:true}),layer=p.layers[0];
    if(kind!=='root'){
      p.symbols=[{id:'distance',name:'Distance',width:100,height:100,shapes:layer.keys[0].shapes,
        timeline:{duration:p.duration,keys:layer.keys.slice(1),...(kind==='base'?{motionSpans:layer.motionSpans}:{layers:[clone(layer)]})}}];
      delete layer.motionSpans;
    }
    expect(validateProject(p)).toEqual(p);
    for(const schemaVersion of [43,48,49,50])expect(()=>migrateProject({...p,schemaVersion})).toThrow(/schema 51/);
  }
  const p=fixture({...route,distance:true,headingOffset:undefined,headingOffsetEnd:undefined});
  delete p.layers[0].motionSpans![0].path!.headingOffset;
  delete p.layers[0].motionSpans![0].path!.headingOffsetEnd;
  expect(migrateProject({...p,schemaVersion:50})).toEqual(p);
});

it('rejects later rebuilt curved distance-table drift before reversing any track',()=>{
  const p=fixture(),second={...clone(p.layers[0]),id:'drift'};p.layers.push(second);
  const first=p.layers[0];
  first.keys=[first.keys[0],{frame:12,shapes:[{...first.keys[12].shapes[0],x:96,y:0}]}];delete first.motionSpans;
  createBasicMotionSpan(p,[first.id],0,12,'linear');
  second.keys=[second.keys[0],second.keys[12]];delete second.motionSpans;
  createBasicMotionSpan(p,[second.id],0,12,'in',undefined,{...route,distance:true});
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,12)).toThrow(/reconstruct/);
  expect(p).toEqual(before);
});
it('reverses distance curved base and additional symbol tracks in one detached edit',()=>{
  const p=fixture(),start=p.layers[0].keys[0].shapes[0],end={...p.layers[0].keys[12].shapes[0],x:96,y:0};
  const definition={id:'distance-symbol',name:'Distance',width:100,height:100,shapes:[start],
    timeline:{duration:10,keys:[{frame:8,shapes:[end]},{frame:9,shapes:[]}],
      layers:[{...clone(p.layers[0]),id:'overlay',motionSpans:undefined,keys:[
        {frame:0,shapes:[{...start,id:'other',x:5}]},{frame:8,shapes:[{...end,id:'other',x:101}]},{frame:9,shapes:[]}]}]}};
  const ids=['@base','overlay'],settings={...route,distance:true,
    waypoints:[{x:48,y:32}],waypointTangents:[{x:16,y:32},{x:16,y:0},{x:16,y:-32}]};
  const created=editSymbolBasicMotionSpan(definition,ids,0,8,'create','in',[definition],undefined,false,undefined,settings);
  const before=clone(created),result=editSymbolBasicMotionSpan(created,ids,0,8,'reverse','linear',[created]);
  expect(created).toEqual(before);
  for(let frame=1;frame<8;frame++){
    expect(result.timeline!.keys.find(k=>k.frame===8-frame)!.shapes).toEqual(before.timeline!.keys.find(k=>k.frame===frame)!.shapes);
    expect(result.timeline!.layers![0].keys.find(k=>k.frame===8-frame)!.shapes).toEqual(before.timeline!.layers![0].keys.find(k=>k.frame===frame)!.shapes);
  }
  expect(result.timeline!.motionSpans![0].path!.distance).toBe(true);
  expect(result.timeline!.layers![0].motionSpans![0].path!.distance).toBe(true);
});

for(const sign of [-1,1])for(const corrected of [false,true])for(const at of [2,4,6])
it(`splits a distance curved tangent (reflection ${sign}, correction ${corrected}, cut ${at})`,()=>{
  const p=fixture(),layer=p.layers[0],last={...layer.keys[12].shapes[0],x:96,y:96*sign};p.duration=10;
  layer.keys=[layer.keys[0],{frame:8,shapes:[last]},{frame:9,shapes:[]}];delete layer.motionSpans;
  const path={...route,distance:true,waypoints:[{x:48,y:48*sign}],
    waypointTangents:[{x:16-1/4096,y:(16+1/4096)*sign},{x:16-1/4096,y:(16+1/4096)*sign},{x:16-1/4096,y:(16+1/4096)*sign}],
    ...(corrected?{}:{headingOffset:undefined,headingOffsetEnd:undefined})};
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,path);
  const before=clone(layer.keys);
  expect(Math.abs(before[at].shapes[0].rotation-(90+60*at/8))).toBeGreaterThan(1);
  splitBasicMotionSpan(p,[layer.id],0,8,at,true);expect(layer.keys).toEqual(before);
  expect(layer.motionSpans!.every(s=>s.path!.tangent && s.path!.distance)).toBe(true);
  const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
  for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,[layer.id],span.start,span.end);
  for(let i=0;i<=8;i++)for(const field of ['x','y','rotation'] as const)
    expect(reopened.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
  expect(reopened.layers[0].keys[9]).toEqual(before[9]);
});

it('rejects an unresolved rebuilt curved join on a later track without publishing either half',()=>{
  const p=fixture(),first=p.layers[0],second={...clone(first),id:'deep'};p.layers.push(second);p.duration=10;
  for(const layer of p.layers){
    layer.keys=[layer.keys[0],{frame:8,shapes:[{...layer.keys[12].shapes[0],x:96,y:layer===first?96:0}]}];delete layer.motionSpans;
    const settings=layer===first?{waypoints:[{x:48,y:48}],waypointTangents:[
      {x:16-1/4096,y:16+1/4096},{x:16-1/4096,y:16+1/4096},{x:16-1/4096,y:16+1/4096}]}:
      {waypoints:[{x:48,y:0}],waypointTangents:[{x:16,y:16},{x:16,y:16},{x:16,y:16}]};
    createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,{...route,...settings,distance:true});
  }
  const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,[first.id,second.id],0,8,4,true)).toThrow(/join|trajectory numerically/);
  expect(p).toEqual(before);
});

it.each([2,4,6])('subdivides distance curved base/additional symbol tracks in a detached edit at %i',at=>{
  const p=fixture(),start=p.layers[0].keys[0].shapes[0],end={...p.layers[0].keys[12].shapes[0],x:96,y:96};
  const definition={id:'split-distance-symbol',name:'Split distance',width:100,height:100,shapes:[start],
    timeline:{duration:10,keys:[{frame:8,shapes:[end]},{frame:9,shapes:[]}],
      layers:[{...clone(p.layers[0]),id:'overlay',motionSpans:undefined,keys:[
        {frame:0,shapes:[{...start,id:'other',x:5}]},{frame:8,shapes:[{...end,id:'other',x:101}]},{frame:9,shapes:[]}]}]}};
  const ids=['@base','overlay'],bend=1/4096,settings={...route,distance:true,
    waypoints:[{x:48,y:48}],waypointTangents:[{x:16-bend,y:16+bend},{x:16-bend,y:16+bend},{x:16-bend,y:16+bend}]};
  const created=editSymbolBasicMotionSpan(definition,ids,0,8,'create','linear',[definition],undefined,false,undefined,settings),
    before=clone(created),result=editSymbolBasicMotionSpan(created,ids,0,8,'split','linear',[created],
      undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,at,true);
  expect(created).toEqual(before);
  expect(result.timeline!.keys).toEqual(before.timeline!.keys);
  expect(result.timeline!.layers![0].keys).toEqual(before.timeline!.layers![0].keys);
  expect(result.timeline!.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,at],[at,8]]);
  expect(result.timeline!.layers![0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,at],[at,8]]);
});
