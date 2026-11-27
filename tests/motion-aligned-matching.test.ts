import {expect,it} from 'vitest';
import {newProject,clone,migrateProject,type Vector} from '../packages/document/src';
import {createBasicMotionSpan,splitBasicMotionSpan,refreshBasicMotionSpan,reverseBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {shiftMotionContourStart} from '../packages/animation/src/motion-nodes';
function fixture(curves:boolean){const p=newProject();p.duration=9;const a:Vector={id:'a',kind:'bezier',closed:false,x:0,y:0,width:40,height:30,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[{x:0,y:0},{x:20,y:curves?20:0},{x:40,y:0}]};const b={...clone(a),nodes:[{x:0,y:0},{x:10,y:curves?20:0},{x:20,y:curves?30:0},{x:30,y:curves?20:0},{x:40,y:0}]};p.layers[0].keys=[{frame:0,shapes:[a]},{frame:8,shapes:[b]}];return p;}
it('matches in aligned index space and preserves hints through splitting and reopen',()=>{
 for(const curves of [false,true]){const p=fixture(curves),ids=[p.layers[0].id],before=clone(p),nodes={curves,hints:[[[1,2] as const]]},correspondence={source:{reverse:true},reverse:true,nodes};
 const reference=clone(p);for(const key of reference.layers[0].keys)key.shapes=key.shapes.map(s=>shiftMotionContourStart(s,0,true));
 createBasicMotionSpan(reference,ids,0,8,'in',{nodes:true},undefined,undefined,{nodes});createBasicMotionSpan(p,ids,0,8,'in',{nodes:true},undefined,undefined,correspondence);
 expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);expect(p.layers[0].keys[8]).toEqual(before.layers[0].keys[1]);expect(p.layers[0].keys.slice(1,-1)).toEqual(reference.layers[0].keys.slice(1,-1));
 const generated=clone(p.layers[0].keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(p.layers[0].keys).toEqual(generated);
 expect(p.layers[0].motionSpans!.map(s=>s.correspondence)).toEqual([{source:{reverse:true},nodes:{curves,hints:[[[1,2]]]}},{reverse:true,nodes:{curves,hints:[[[2,2]]]}}]);
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));for(const [a,b] of [[0,4],[4,8]])refreshBasicMotionSpan(loaded,ids,a,b);for(let i=0;i<9;i++){const a=loaded.layers[0].keys[i].shapes[0].nodes!,b=generated[i].shapes[0].nodes!;expect(a.length).toBe(b.length);a.forEach((n,j)=>{expect(n.x).toBeCloseTo(b[j].x,11);expect(n.y).toBeCloseTo(b[j].y,11);});}
 }
});
it('retains unhinted source matching on both generated halves',()=>{
 const p=fixture(false),ids=[p.layers[0].id];createBasicMotionSpan(p,ids,0,8,'linear',{nodes:true},undefined,undefined,{source:{reverse:true},reverse:true,nodes:true});const before=clone(p.layers[0].keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(p.layers[0].keys).toEqual(before);expect(p.layers[0].motionSpans!.every(s=>s.correspondence?.nodes===true)).toBe(true);
});
it('rejects invalid later aligned hints atomically and reverses reconstructable unhinted matching',()=>{
 const p=fixture(true);p.layers.push({...clone(p.layers[0]),id:'later'});p.layers[1].keys[0].shapes[0].nodes!.splice(1,1);const ids=p.layers.map(l=>l.id),before=clone(p);expect(()=>createBasicMotionSpan(p,ids,0,8,'linear',{nodes:true},undefined,undefined,{source:{reverse:true},reverse:true,nodes:{curves:true,hints:[[[1,2]]]}})).toThrow(/hint/i);expect(p).toEqual(before);
 p.layers.pop();createBasicMotionSpan(p,[ids[0]],0,8,'linear',{nodes:true},undefined,undefined,{source:{reverse:true},reverse:true,nodes:true});const saved=clone(p);reverseBasicMotionSpan(p,[ids[0]],0,8);for(const key of saved.layers[0].keys)expect(p.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);
});

it('reverses and splits aligned curved-distance matching with handles and optional hints',()=>{
 for(const hinted of [false,true]){const p=fixture(true),ids=[p.layers[0].id],nodes=[{x:0,y:0,out:{x:8,y:16}},{x:24,y:0,in:{x:16,y:16},out:{x:32,y:-16}},{x:48,y:0,in:{x:40,y:-16}}];for(const key of p.layers[0].keys)key.shapes[0].nodes=clone(nodes);
 const matching={curves:true,distance:true,...(hinted?{hints:[[[1,1] as const]]}:{})};createBasicMotionSpan(p,ids,0,8,'linear',{nodes:true},undefined,undefined,{source:{reverse:true},reverse:true,nodes:matching});const before=clone(p.layers[0].keys);reverseBasicMotionSpan(p,ids,0,8);for(const key of before)expect(p.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);reverseBasicMotionSpan(p,ids,0,8);splitBasicMotionSpan(p,ids,0,8,4,true);expect(p.layers[0].keys).toEqual(before);const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);expect(loaded.layers[0].keys).toEqual(before);
 }
});

it('reverses aligned hinted straight and curved matching with exact keys and persisted refresh',()=>{
 for(const curves of [false,true])for(const ease of ['linear','in','out'] as const)for(const side of ['source','target','both']){const p=fixture(curves),ids=[p.layers[0].id];p.duration=12;createBasicMotionSpan(p,ids,0,8,ease,{nodes:true},undefined,undefined,{...(side!=='target'?{source:{reverse:true}}:{}),...(side!=='source'?{reverse:true}:{}),nodes:{curves,hints:[[[1,2]]]}});const before=clone(p.layers[0]);reverseBasicMotionSpan(p,ids,0,8);expect(p.layers[0].motionSpans![0].correspondence).toEqual({...(side!=='source'?{source:{reverse:true}}:{}),...(side!=='target'?{reverse:true}:{}),nodes:{curves,hints:[[[2,1]]]}});for(const key of before.keys)expect(p.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);expect(p.layers[0].keys.find(k=>k.frame===9)!.shapes).toEqual(before.keys.at(-1)!.shapes);
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,8);for(let i=1;i<8;i++){const a=loaded.layers[0].keys[i].shapes[0].nodes!,b=before.keys[8-i].shapes[0].nodes!;expect(a.length).toBe(b.length);a.forEach((n,j)=>{expect(n.x).toBeCloseTo(b[j].x,11);expect(n.y).toBeCloseTo(b[j].y,11);});}
 reverseBasicMotionSpan(p,ids,0,8);for(const key of before.keys)expect(p.layers[0].keys.find(k=>k.frame===key.frame)!.shapes).toEqual(key.shapes);
 }
});
