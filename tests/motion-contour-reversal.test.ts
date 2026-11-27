import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,reverseBasicMotionSpan,refreshBasicMotionSpan,editSymbolBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {shiftMotionContourStart,inverseMotionContourAlignment} from '../packages/animation/src/motion-nodes';
function fixture(){const p=newProject();p.duration=8;const a:Vector={id:'a',kind:'polygon',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],contours:[[{x:0,y:0},{x:20,y:0},{x:0,y:20}],[{x:3,y:3},{x:6,y:3},{x:6,y:6},{x:3,y:6}]]};const target=shiftMotionContourStart(a,[1,2],[true,false],[1,0]);const inverse=inverseMotionContourAlignment(a,[1,2],[true,false],[1,0]);target.x=100;p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[target]}];return {p,inverse};}
it('reverses compound target and two-sided alignment with exact keys, double reversal and persisted refresh',()=>{
 for(const ease of ['linear','in','out'] as const)for(const source of [undefined,{start:1,reverse:true}]){
  const {p,inverse}=fixture(),ids=[p.layers[0].id],correspondence={...inverse,...(source?{source}:{})};
  createBasicMotionSpan(p,ids,0,4,ease,{nodes:true},undefined,undefined,correspondence);const before=clone(p.layers[0]);reverseBasicMotionSpan(p,ids,0,4);
  expect(p.layers[0].motionSpans![0].correspondence).toEqual({...source,source:inverse});expect(p.layers[0].motionSpans![0].id).toBe(before.motionSpans![0].id);
  for(const key of before.keys)expect(p.layers[0].keys.find(k=>k.frame===4-key.frame)!.shapes).toEqual(key.shapes);
  expect(p.layers[0].keys.find(k=>k.frame===5)!.shapes).toEqual(before.keys.at(-1)!.shapes);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);for(let i=1;i<4;i++)expect(loaded.layers[0].keys[i].shapes).toEqual(before.keys[4-i].shapes);
  reverseBasicMotionSpan(p,ids,0,4);expect(p.layers[0].motionSpans![0].correspondence).toEqual(correspondence);for(const key of before.keys)expect(p.layers[0].keys.find(k=>k.frame===key.frame)!.shapes).toEqual(key.shapes);
 }
});
it('reverses open Bezier handle alignment and isolated symbol base/additional tracks',()=>{
 const {p}=fixture(),a=p.layers[0].keys[0].shapes[0];a.kind='bezier';a.closed=false;a.nodes=[{x:0,y:0,out:{x:5,y:2}},{x:20,y:10,in:{x:15,y:8}}];delete a.contours;p.layers[0].keys[1].shapes=[{...shiftMotionContourStart(a,0,true),x:100}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',{nodes:true},undefined,undefined,{reverse:true});const layer=p.layers[0],symbol={id:'s',name:'s',width:100,height:100,shapes:clone(layer.keys[0].shapes),timeline:{duration:8,keys:clone(layer.keys.slice(1)),motionSpans:clone(layer.motionSpans),layers:[{...clone(layer),id:'extra'}]}};const before=clone(symbol),result=editSymbolBasicMotionSpan(symbol,['@base','extra'],0,4,'reverse');expect(symbol).toEqual(before);expect(result.timeline!.motionSpans![0].correspondence).toEqual({source:{reverse:true}});for(const k of layer.keys)expect(result.timeline!.layers![0].keys.find(v=>v.frame===4-k.frame)!.shapes).toEqual(k.shapes);
});
it('rejects stale later tracks and invalid later hints before publishing any track',()=>{
 const {p,inverse}=fixture();p.layers.push({...clone(p.layers[0]),id:'later'});const ids=p.layers.map(l=>l.id);createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,inverse);p.layers[1].keys[2].shapes[0].x++;let before=clone(p);expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
 p.layers[1].keys[2].shapes[0].x--;p.layers[1].motionSpans![0].correspondence!.nodes={hints:[[[99,99]],[]]};before=clone(p);expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/hint/i);expect(p).toEqual(before);
});
