import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,reverseBasicMotionSpan,refreshBasicMotionSpan,editSymbolBasicMotionSpan} from '../packages/animation/src/motion-spans';
function fixture(){const p=newProject();p.duration=8;const a:Vector={id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[{...a,x:100,rotation:40}]}];return p;}
const path={startX:30,startY:20,endX:-30,endY:20,tangent:true};
it('reverses tangent recipes with exact authored/generated keys, outside hold and refresh after reopen',()=>{
 for(const ease of ['linear','in','out'] as const)for(const correction of [{},{headingOffset:12.25},{headingOffset:10,headingOffsetEnd:30}]){
  const p=fixture(),ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,4,ease,undefined,{...path,...correction});const before=clone(p.layers[0]),id=before.motionSpans![0].id;
  reverseBasicMotionSpan(p,ids,0,4);const layer=p.layers[0];expect(layer.motionSpans![0].id).toBe(id);expect(layer.motionSpans![0].path!.headingOffset).toBeDefined();for(const k of before.keys)expect(layer.keys.find(v=>v.frame===4-k.frame)!.shapes).toEqual(k.shapes);expect(layer.keys.find(k=>k.frame===5)!.shapes).toEqual(before.keys.at(-1)!.shapes);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);for(let i=1;i<4;i++)expect(loaded.layers[0].keys[i].shapes[0].rotation).toBeCloseTo(before.keys[4-i].shapes[0].rotation,10);
  reverseBasicMotionSpan(p,ids,0,4);for(const key of before.keys)expect(p.layers[0].keys.find(k=>k.frame===key.frame)!.shapes).toEqual(key.shapes);
 }
});
it('rejects stale later tracks in equal-time and distance tangent reversal without publishing',()=>{
 for(const distance of [false,true]){const p=fixture();p.layers.push({...clone(p.layers[0]),id:'later'});const ids=p.layers.map(l=>l.id);createBasicMotionSpan(p,ids,0,4,'linear',undefined,{...path,...(distance?{distance:true}:{})});p.layers[1].keys[2].shapes[0].rotation++;const before=clone(p);expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/unchanged/);expect(p).toEqual(before);}
});
it('prepares isolated symbol base and extra-track reversal without changing its input',()=>{
 const p=fixture(),ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,4,'linear',undefined,{...path,headingOffset:10,headingOffsetEnd:30});const layer=p.layers[0],definition={id:'s',name:'s',width:100,height:100,shapes:clone(layer.keys[0].shapes),timeline:{duration:8,keys:clone(layer.keys.slice(1)),motionSpans:clone(layer.motionSpans),layers:[{...clone(layer),id:'extra'}]}};const before=clone(definition);const result=editSymbolBasicMotionSpan(definition,['@base','extra'],0,4,'reverse');expect(definition).toEqual(before);expect(result.shapes).toEqual(before.timeline.keys.at(-1)!.shapes);expect(result.timeline!.layers![0].keys[0].shapes).toEqual(before.timeline.layers[0].keys.at(-1)!.shapes);expect(result.timeline!.motionSpans![0].path!.headingOffset).toBeDefined();
});

it('rejects later linear correction overflow without publishing an earlier reversal',()=>{
 const p=fixture();p.layers.push({...clone(p.layers[0]),id:'later'});
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',undefined,{...path,headingOffset:10,headingOffsetEnd:30});
 // This forward cubic needs -180 degrees when reversed.
 createBasicMotionSpan(p,['later'],0,4,'linear',undefined,{...path,headingOffset:-360000,headingOffsetEnd:0});
 const before=clone(p);expect(()=>reverseBasicMotionSpan(p,p.layers.map(l=>l.id),0,4)).toThrow(/correction/);expect(p).toEqual(before);
});

it('retains exact reversed distance keys and refreshes their composed headings after reopen', () => {
 const p=fixture(),layer=p.layers[0],ids=[layer.id];
 const route={...path,distance:true,headingOffset:10,headingOffsetEnd:30};
 createBasicMotionSpan(p,ids,0,4,'in',undefined,route);
 const before=clone(layer);
 reverseBasicMotionSpan(p,ids,0,4);
 const span=layer.motionSpans![0];
 expect(span).toMatchObject({id:before.motionSpans![0].id,ease:'out',path:{distance:true,tangent:true}});
 expect(span.path!.headingOffsetEnd!-span.path!.headingOffset!).toBe(-20);
 expect(layer.keys.find(k=>k.frame===5)!.shapes).toEqual(before.keys[4].shapes);
 const reopened=migrateProject(JSON.parse(JSON.stringify(p)));
 refreshBasicMotionSpan(reopened,ids,0,4);
 for(const key of before.keys){
   expect(layer.keys[4-key.frame].shapes).toEqual(key.shapes);
   for(const field of ['x','y','rotation'] as const)
     expect(reopened.layers[0].keys[4-key.frame].shapes[0][field]).toBeCloseTo(key.shapes[0][field],11);
 }
 const stored=clone(p);
 expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/unchanged/);
 expect(p).toEqual(stored);
 reverseBasicMotionSpan(reopened,ids,0,4);
 for(const key of before.keys)for(const field of ['x','y','rotation'] as const)
   expect(reopened.layers[0].keys[key.frame].shapes[0][field]).toBeCloseTo(key.shapes[0][field],11);
});

it('discards an earlier prepared reversal when a later distance table misses a generated pose', () => {
 const p=fixture(),first=p.layers[0],second=clone(first);
 p.duration=34;first.keys[1].frame=32;second.id='winding';second.keys[1].frame=32;
 Object.assign(second.keys[1].shapes[0],{x:20,y:100});
 p.layers.push(second);
 createBasicMotionSpan(p,[first.id],0,32,'linear');
 createBasicMotionSpan(p,[second.id],0,32,'in',undefined,{
   startX:280,startY:10,endX:-280,endY:-10,distance:true,tangent:true,
 });
 const before=clone(p);
 expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,32)).toThrow(/reconstruct/);
 expect(p).toEqual(before);
});

it('rejects an exact interior waypoint corner on a later track before writing either reversal', () => {
  const p=fixture(), first=p.layers[0], second={...clone(first),id:'corner'};
  p.layers.push(second);
  createBasicMotionSpan(p,[first.id],0,4,'linear');
  createBasicMotionSpan(p,[second.id],0,4,'linear',undefined,{
    startX:0,startY:0,endX:0,endY:0,waypoints:[{x:50,y:30}],tangent:true,
  });
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,4)).toThrow(/reconstruct/);
  expect(p).toEqual(before);
});

it('rejects incompatible waypoint controls across artwork on one track', () => {
  const p=fixture(),layer=p.layers[0];
  for (const key of layer.keys) key.shapes.push({...key.shapes[0],id:'other',x:key.frame?80:0});
  createBasicMotionSpan(p,[layer.id],0,4,'in',undefined,{
    startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:15}],tangent:true,
  });
  const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[layer.id],0,4)).toThrow(/shared/);
  expect(p).toEqual(before);
});

it('reverses an uncorrected right-angle route whose corner falls between generated frames', () => {
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  layer.keys[1].frame=5;
  Object.assign(layer.keys[1].shapes[0],{x:40,y:40});
  const path={startX:0,startY:0,endX:0,endY:0,waypoints:[{x:40,y:0}],tangent:true};
  createBasicMotionSpan(p,ids,0,5,'linear',undefined,path);
  const original=clone(layer);
  reverseBasicMotionSpan(p,ids,0,5);
  expect(layer.motionSpans![0]).toMatchObject({id:original.motionSpans![0].id,path:{waypoints:[{x:0,y:-40}]}});
  expect(Math.abs(layer.motionSpans![0].path!.headingOffset!)%360).toBe(180);
  expect(layer.motionSpans![0].path!.headingOffsetEnd).toBeUndefined();
  for (const key of original.keys) expect(layer.keys[5-key.frame].shapes).toEqual(key.shapes);
  const retained=clone(layer.keys);
  refreshBasicMotionSpan(p,ids,0,5);
  for (const key of retained)
    for (const field of ['x','y','rotation'] as const)
      expect(layer.keys[key.frame].shapes[0][field]).toBeCloseTo(key.shapes[0][field],11);
});
