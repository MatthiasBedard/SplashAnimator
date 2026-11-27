import {expect,it} from 'vitest';
import {newProject,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,refreshBasicMotionSpan,editSymbolBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {subdividePreservedMotionSpan,subdividePreservedSymbolMotionSpan} from '../packages/animation/src/motion-subdivide';
function fixture(){const p=newProject();p.duration=20;const shape:Vector={id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[shape]},{frame:16,shapes:[{...shape,x:64}]}];return p;}
it('subdivides all requested tracks and retains exact artwork through reopen and refresh',()=>{
 const p=fixture();const second=structuredClone(p.layers[0]);second.id='second';p.layers.push(second);const ids=p.layers.map(l=>l.id);
 createBasicMotionSpan(p,ids,0,16,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:32,y:32}]});
 const before=structuredClone(p),cuts=[4,8,12],oldKeys=p.layers.map(l=>l.keys);subdividePreservedMotionSpan(p,ids,0,16,cuts);
 p.layers.forEach((layer,i)=>{expect(layer.keys).toEqual(before.layers[i].keys);expect(layer.keys).not.toBe(oldKeys[i]);expect(layer.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8],[8,12],[12,16]]);});expect(cuts).toEqual([4,8,12]);
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [start,end] of [[0,4],[4,8],[8,12],[12,16]])refreshBasicMotionSpan(loaded,ids,start,end);
 loaded.layers.forEach((layer,i)=>layer.keys.forEach((key,j)=>{expect(key.shapes[0].x).toBeCloseTo(before.layers[i].keys[j].shapes[0].x,11);expect(key.shapes[0].y).toBeCloseTo(before.layers[i].keys[j].shapes[0].y,11);}));expect(p.duration).toBe(20);oldKeys[0][0].shapes[0].x=999;expect(p.layers[0].keys[0].shapes[0].x).toBe(0);
});
it('rejects a later over-budget split without publishing an earlier successful cut',()=>{
 const p=fixture();p.duration=2049;p.layers[0].keys[1].frame=2048;const ids=[p.layers[0].id];
 createBasicMotionSpan(p,ids,0,2048,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:16,y:16},{x:32,y:32},{x:48,y:16}]});
 const before=structuredClone(p),keys=p.layers[0].keys;
 expect(()=>subdividePreservedMotionSpan(p,ids,0,2048,[2,1024])).toThrow(/subdivision budget/);expect(p).toEqual(before);expect(p.layers[0].keys).toBe(keys);
 const definition={id:'symbol',name:'Motion',width:100,height:100,shapes:keys[0].shapes,timeline:{duration:p.duration,keys:keys.slice(1),motionSpans:p.layers[0].motionSpans}};const original=structuredClone(definition);
 expect(()=>subdividePreservedSymbolMotionSpan(definition,['@base'],0,2048,[2,1024])).toThrow(/subdivision budget/);expect(definition).toEqual(original);
});
it('rejects invalid cuts and original invalid geometry without writing any tracks',()=>{
 const p=fixture();createBasicMotionSpan(p,[p.layers[0].id],0,16,'linear');const before=structuredClone(p);
 for(const cuts of [[],[1],[4,4],[8,4],[4,15],[NaN],[4,Infinity]]){expect(()=>subdividePreservedMotionSpan(p,[p.layers[0].id],0,16,cuts)).toThrow();expect(p).toEqual(before);}
 const second=structuredClone(p.layers[0]);second.id='second';second.keys.at(-1)!.shapes[0].x=Infinity;p.layers.push(second);const invalid=structuredClone(p);expect(()=>subdividePreservedMotionSpan(p,p.layers.map(l=>l.id),0,16,[4,8,12])).toThrow();expect(p).toEqual(invalid);
});

it('subdivides isolated symbol tracks without mutating originals and retains capacity guards',()=>{
 const p=fixture(),layer=p.layers[0];const d={id:'symbol',name:'Motion',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:20,keys:layer.keys.slice(1),layers:[{...structuredClone(layer),id:'extra'}]}};
 const original=editSymbolBasicMotionSpan(d,['@base','extra'],0,16,'create','linear',[d],undefined,false,undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:32,y:32}]});const before=structuredClone(original);
 const result=subdividePreservedSymbolMotionSpan(original,['@base','extra'],0,16,[4,8,12]);expect(original).toEqual(before);expect(result.timeline!.keys).toEqual(original.timeline!.keys);expect(result.shapes).toEqual(original.shapes);expect(result.timeline!.layers![0].keys).toEqual(original.timeline!.layers![0].keys);expect(result.timeline!.motionSpans).toHaveLength(4);expect(result.timeline!.layers![0].motionSpans).toHaveLength(4);
 const crowded={...d,id:'crowded',timeline:undefined,shapes:Array(100000).fill(d.shapes[0])};expect(()=>subdividePreservedSymbolMotionSpan(original,['@base'],0,16,[4,8,12],[original,crowded])).toThrow(/budget/);expect(original).toEqual(before);
 const invalid=structuredClone(original);invalid.timeline!.layers![0].keys[8].shapes[0].x=Infinity;const bad=structuredClone(invalid);expect(()=>subdividePreservedSymbolMotionSpan(invalid,['@base','extra'],0,16,[4,8,12])).toThrow();expect(invalid).toEqual(bad);
 result.shapes[0].x=999;expect(original.shapes[0].x).toBe(0);
});

it('preserves and detaches unaffected symbol tracks while cutting only a secondary track',()=>{
 const p=fixture(),layer=p.layers[0],d={id:'symbol',name:'Motion',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:20,keys:layer.keys.slice(1),layers:[{...structuredClone(layer),id:'extra'}]}};
 const original=editSymbolBasicMotionSpan(d,['extra'],0,16,'create');const before=structuredClone(original);
 const result=subdividePreservedSymbolMotionSpan(original,['extra'],0,16,[4,8,12]);expect(original).toEqual(before);expect(result.shapes).toEqual(before.shapes);expect(result.timeline!.keys).toEqual(before.timeline!.keys);expect(result.timeline!.motionSpans).toBeUndefined();expect(result.timeline!.layers![0].motionSpans).toHaveLength(4);
 result.shapes[0].x=999;result.timeline!.keys[0].shapes[0].y=999;expect(original).toEqual(before);
});
