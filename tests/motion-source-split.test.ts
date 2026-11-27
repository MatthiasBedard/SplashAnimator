import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,splitBasicMotionSpan,refreshBasicMotionSpan,editSymbolBasicMotionSpan} from '../packages/animation/src/motion-spans';
const alignment={start:[1,2],reverse:[true,false],order:[1,0]};
function fixture(){const p=newProject();p.duration=8;const a:Vector={id:'a',kind:'polygon',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],contours:[[{x:0,y:0},{x:20,y:0},{x:0,y:20}],[{x:3,y:3},{x:6,y:3},{x:6,y:6},{x:3,y:6}]]};const b=clone(a);b.x=100;b.contours=b.contours!.map(r=>r.map(n=>({x:n.x*2,y:n.y*2})));p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[b]},{frame:7,shapes:[]}];return p;}
it('preserves compound source alignment only on the left and target alignment only on the right',()=>{
 for(const ease of ['linear','in','out'] as const){const p=fixture(),ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,4,ease,{nodes:true},undefined,undefined,{source:alignment,...alignment});const before=clone(p.layers[0].keys);splitBasicMotionSpan(p,ids,0,4,2,true);expect(p.layers[0].keys).toEqual(before);expect(p.layers[0].motionSpans!.map(s=>s.correspondence)).toEqual([{source:alignment},alignment]);
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [start,end] of [[0,2],[2,4]])refreshBasicMotionSpan(loaded,ids,start,end);for(let i=0;i<before.length;i++){const shapes=loaded.layers[0].keys[i].shapes;expect(shapes.length).toBe(before[i].shapes.length);for(let j=0;j<shapes.length;j++){const a=shapes[j],b=before[i].shapes[j];expect(a.x).toBeCloseTo(b.x,12);expect(a.contours!.map(r=>r.length)).toEqual(b.contours!.map(r=>r.length));a.contours!.forEach((r,k)=>r.forEach((n,m)=>{expect(n.x).toBeCloseTo(b.contours![k][m].x,12);expect(n.y).toBeCloseTo(b.contours![k][m].y,12);}));}}
 }
});
it('preserves open Bezier source reversal through isolated symbol base and additional-track splits',()=>{
 const p=fixture();for(const key of p.layers[0].keys.filter(k=>k.frame<=4)){const a=key.shapes[0];a.kind='bezier';a.closed=false;a.nodes=[{x:0,y:0,out:{x:5,y:2}},{x:20,y:10,in:{x:15,y:8}}];delete a.contours;}
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',{nodes:true},undefined,undefined,{source:{reverse:true},reverse:true});const layer=p.layers[0],symbol={id:'s',name:'s',width:100,height:100,shapes:clone(layer.keys[0].shapes),timeline:{duration:8,keys:clone(layer.keys.slice(1)),motionSpans:clone(layer.motionSpans),layers:[{...clone(layer),id:'extra'}]}};const before=clone(symbol),result=editSymbolBasicMotionSpan(symbol,['@base','extra'],0,4,'split','linear',[symbol],undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,2,true);expect(symbol).toEqual(before);expect(result.timeline!.keys).toEqual(before.timeline.keys);expect(result.timeline!.layers![0].keys).toEqual(before.timeline.layers[0].keys);expect(result.timeline!.motionSpans!.map(s=>s.correspondence)).toEqual([{source:{reverse:true}},{reverse:true}]);
});
it('rejects stale later tracks without partial publication',()=>{
 const p=fixture();p.layers.push({...clone(p.layers[0]),id:'later'});const ids=p.layers.map(l=>l.id);createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{source:alignment,...alignment});p.layers[1].keys[1].shapes[0].x++;const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/match the recipe/);expect(p).toEqual(before);
});

it('reauthors around an edited aligned key without realigning it or changing outside exposures',()=>{
 const p=fixture(),ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{source:alignment,...alignment});const layer=p.layers[0];layer.keys[2].shapes[0].x=70;layer.keys[2].shapes[0].contours![0][0].x+=8;const before=clone(layer.keys),edited=before[2].shapes;
 splitBasicMotionSpan(p,ids,0,4,2,false);expect(layer.keys[2].shapes).toEqual(edited);for(const frame of [0,4,7])expect(layer.keys.find(k=>k.frame===frame)).toEqual(before.find(k=>k.frame===frame));expect(layer.keys[1].shapes[0].x).toBe(35);expect(layer.keys[3].shapes[0].x).toBe(85);expect(layer.motionSpans!.map(s=>s.correspondence)).toEqual([{source:alignment},alignment]);
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [a,b] of [[0,2],[2,4]])refreshBasicMotionSpan(loaded,ids,a,b);expect(loaded).toEqual(p);
});
it('rejects an incompatible edited later contour before publishing any reauthored track',()=>{
 const p=fixture();p.layers.push({...clone(p.layers[0]),id:'later'});const ids=p.layers.map(l=>l.id);createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{source:alignment,...alignment});p.layers[0].keys[2].shapes[0].x=70;p.layers[1].keys[2].shapes[0].contours![0].pop();const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,false)).toThrow();expect(p).toEqual(before);
});
