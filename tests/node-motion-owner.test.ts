import {expect,it} from 'vitest';
import {newProject,type Vector} from '../packages/document/src';
import {worldPoint} from '../packages/geometry/src';
import {createBasicMotionSpan,promoteSampledMotionFrame,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureRememberedNodeAuthoringFrame} from '../packages/animation/src/node-motion-owner';
import {moveRememberedEndpointNodes} from '../packages/animation/src/motion-junction';
import type {GroupAuthoringSource} from '../packages/animation/src/group-motion-owner';
function fixture(basis='plain',nodes=true):GroupAuthoringSource{
 const project=newProject();project.duration=12;const layer=project.layers[0];layer.id='base';layer.drawingMode='object';
 const shape:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:10,rotation:basis==='plain'?0:30,...(basis==='plain'?{}:{transform:(basis==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:1,points:[],closed:false,nodes:[{x:0,y:0,out:{x:2,y:0}},{x:10,y:0,in:{x:8,y:-2},out:{x:12,y:2}},{x:20,y:10,in:{x:18,y:8}}]};
 layer.keys=[{frame:0,shapes:[shape,{...structuredClone(shape),id:'other',y:50}]},{frame:8,shapes:[{...structuredClone(shape),x:80},{...structuredClone(shape),id:'other',x:80,y:50}]},{frame:10,shapes:[]}];createBasicMotionSpan(project,['base'],0,8,'linear',{nodes,affine:true});
 const extra={...structuredClone(layer),id:'extra'};extra.motionSpans![0].id='extra-recipe';project.layers.push(extra);for(const track of project.layers)for(const shape of track.keys[8].shapes)shape.x+=80;
 return {project,revision:0,frame:4};
}
for(const basis of ['plain','affine','reflected'])for(const track of ['base','extra'])it('prepares a private sampled node through both halves on '+track+', '+basis,()=>{
 const state=fixture(basis),before=structuredClone(state),capture=captureRememberedNodeAuthoringFrame(()=>state),original=capture.scene.find(t=>t.layerId===track)!.key.shapes[0],point=worldPoint(original,{x:14,y:3}),owner=capture.resolveNode(track,'curve',1);
 expect(owner).toMatchObject({layerId:track,shapeId:'curve',frame:4,nodeIndex:1,nodeCount:3,start:0,end:8});owner.nodeIndex=0;owner.nodeCount=999;capture.scene[0].key.shapes[0].nodes!.splice(0);
 const plain=structuredClone(state.project);promoteSampledMotionFrame(plain,[track],0,8,4);for(const span of plain.layers.find(l=>l.id===track)!.motionSpans!)refreshBasicMotionSpan(plain,[track],span.start,span.end);
 const result=capture.prepareNodePosition(track,'curve',1,point),layer=result.layers.find(l=>l.id===track)!,shape=layer.keys[4].shapes[0];expect(worldPoint(shape,shape.nodes![1]).x).toBeCloseTo(point.x,10);expect(worldPoint(shape,shape.nodes![1]).y).toBeCloseTo(point.y,10);
 expect(shape.nodes).toHaveLength(3);expect(shape.nodes![0]).toEqual(original.nodes![0]);expect(shape.nodes![2]).toEqual(original.nodes![2]);expect(shape.nodes![1].in!.x).toBeCloseTo(12,10);expect(shape.nodes![1].in!.y).toBeCloseTo(1,10);expect(shape.nodes![1].out!.x).toBeCloseTo(16,10);expect(shape.nodes![1].out!.y).toBeCloseTo(5,10);
 for(const field of ['id','x','y','rotation','transform','pivot','width','height','closed','fill','stroke','strokeWidth','points']as const)expect(shape[field]).toEqual(original[field]);
 for(const frame of [2,6]){expect(layer.keys[frame].shapes[0].nodes![1].x).toBeCloseTo(12,10);expect(layer.keys[frame].shapes[0].nodes![1].y).toBeCloseTo(1.5,10);}
 expect(layer.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(before.project.layers.find(l=>l.id===track)!.keys.filter(k=>[0,8,10].includes(k.frame)));expect(layer.keys.map(k=>k.shapes[1])).toEqual(plain.layers.find(l=>l.id===track)!.keys.map(k=>k.shapes[1]));expect(layer.motionSpans!.map(s=>s.options)).toEqual([{nodes:true,affine:true},{nodes:true,affine:true}]);expect(result.layers.find(l=>l.id!==track)).toEqual(before.project.layers.find(l=>l.id!==track));
 const reopened=structuredClone(result);for(const span of layer.motionSpans!)refreshBasicMotionSpan(reopened,[track],span.start,span.end);expect(reopened.layers.find(l=>l.id===track)!.keys).toEqual(layer.keys);expect(state).toEqual(before);shape.nodes![1].x=999;expect(capture.prepareNodePosition(track,'curve',1,point).layers.find(l=>l.id===track)!.keys[4].shapes[0].nodes![1].x).not.toBe(999);
});
for(const index of [-1,.5,3,NaN])it('rejects unowned original node index '+index,()=>{const state=fixture(),before=structuredClone(state),capture=captureRememberedNodeAuthoringFrame(()=>state);expect(()=>capture.resolveNode('base','curve',index)).toThrow();expect(()=>capture.prepareNodePosition('base','curve',index,{x:94,y:13})).toThrow();expect(state).toEqual(before);});
for(const position of [{x:NaN,y:0},{x:0,y:Infinity},{x:90,y:10},{x:Number.MAX_VALUE,y:0}])it('rejects invalid/no-op/overflow node target '+JSON.stringify(position),()=>{const state=fixture(),before=structuredClone(state),capture=captureRememberedNodeAuthoringFrame(()=>state);expect(()=>capture.prepareNodePosition('base','curve',1,position)).toThrow();expect(state).toEqual(before);expect(capture.resolveNode('base','curve',1).nodeIndex).toBe(1);});
for(const mode of ['nodes','topology','handle','edited','kind','merge','singular','numeric'])it('retains original node/geometry admission '+mode,()=>{
 const state=fixture('plain',mode!=='nodes');if(mode==='topology')state.project.layers[0].keys[8].shapes[0].nodes!.pop();if(mode==='handle')delete state.project.layers[0].keys[8].shapes[0].nodes![1].in;if(mode==='edited')state.project.layers[0].keys[2].shapes[0].nodes![1].x++;if(mode==='kind')for(const key of state.project.layers[0].keys)for(const shape of key.shapes)shape.kind='rectangle';if(mode==='merge')state.project.layers[0].drawingMode='merge';if(mode==='singular')for(const key of state.project.layers[0].keys)for(const shape of key.shapes)shape.transform=[0,0,0,0];if(mode==='numeric')state.project.layers[0].keys[0].shapes[1].nodes![0].x=NaN;
 const before=structuredClone(state);expect(()=>captureRememberedNodeAuthoringFrame(()=>state).prepareNodePosition('base','curve',1,{x:94,y:13})).toThrow();expect(state).toEqual(before);
});
for(const mode of ['frame','revision','library','reference','node','dispose'])it('rejects stale private node ownership after '+mode,()=>{const state=fixture(),capture=captureRememberedNodeAuthoringFrame(()=>state);capture.resolveNode('base','curve',1);if(mode==='frame')state.frame++;if(mode==='revision')state.revision++;if(mode==='library')state.project.symbols=[{id:'new',name:'New',width:10,height:10,shapes:[]}];if(mode==='reference')state.project=structuredClone(state.project);if(mode==='node')state.project.layers[0].keys[0].shapes[0].nodes!.reverse();if(mode==='dispose')capture.dispose();const before=structuredClone(state);expect(()=>capture.prepareNodePosition('base','curve',1,{x:94,y:13})).toThrow();expect(state).toEqual(before);});
it('snapshots node target values and rejects target-getter source changes',()=>{
 const state=fixture(),capture=captureRememberedNodeAuthoringFrame(()=>state),point={x:94,get y(){this.x=99;return 13;}};expect(capture.prepareNodePosition('base','curve',1,point).layers[0].keys[4].shapes[0].nodes![1]).toMatchObject({x:14,y:3});expect(point.x).toBe(99);const before=structuredClone(state.project);expect(()=>capture.prepareNodePosition('base','curve',1,{get x(){state.frame++;return 94;},y:13})).toThrow(/changed/);expect(state.project).toEqual(before);
});
for(const failure of ['none','index','duplicate','later','numeric'])it('admits all-track node endpoints atomically, '+failure,()=>{
 const state=fixture(),p=structuredClone(state.project);for(const track of p.layers)promoteSampledMotionFrame(p,[track.id],0,8,4);if(failure==='later')p.layers[1].keys[6].shapes[0].nodes![1].x++;if(failure==='numeric')p.layers[1].keys[0].shapes[1].nodes![0].x=NaN;
 const before=structuredClone(p),requests=p.layers.map(layer=>({layerId:layer.id,shapeId:'curve',nodeIndex:failure==='index'&&layer.id==='extra'?9:1,position:{x:94,y:13}}));if(failure==='duplicate')requests.push(requests[0]);
 if(failure==='none'){moveRememberedEndpointNodes(p,4,requests);for(const layer of p.layers)expect(layer.keys[4].shapes[0].nodes![1]).toMatchObject({x:14,y:3});}else{expect(()=>moveRememberedEndpointNodes(p,4,requests)).toThrow();expect(p).toEqual(before);}
});

it('rechecks original numeric artwork after request getters before any endpoint write',()=>{
 const state=fixture(),p=state.project;for(const track of p.layers)promoteSampledMotionFrame(p,[track.id],0,8,4);const before=structuredClone(p);
 expect(()=>moveRememberedEndpointNodes(p,4,[{layerId:'base',shapeId:'curve',nodeIndex:1,position:{get x(){p.layers[1].keys[0].shapes[1].nodes![0].x=NaN;return 94;},y:13}}])).toThrow(/nonfinite/);before.layers[1].keys[0].shapes[1].nodes![0].x=NaN;expect(p).toEqual(before);
});
it('re-resolves the original sampled node after detached two-sided preparation',()=>{
 const probe=fixture();let reads=0;const count=captureRememberedNodeAuthoringFrame(()=>{reads++;return probe;}),start=reads;count.prepareNodePosition('base','curve',1,{x:94,y:13});const cost=reads-start,state=fixture();let calls=0,flip=Infinity;
 const capture=captureRememberedNodeAuthoringFrame(()=>{if(++calls===flip)state.project.layers[0].keys[0].shapes[0].nodes![0].out!.x++;return state;}),before=structuredClone(state.project);flip=calls+cost;expect(()=>capture.prepareNodePosition('base','curve',1,{x:94,y:13})).toThrow(/changed/);before.layers[0].keys[0].shapes[0].nodes![0].out!.x++;expect(state.project).toEqual(before);
});

it('retains original closed-contour correspondence while editing the private sampled node index',()=>{
 const state=fixture();for(const layer of state.project.layers){layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;for(const key of layer.keys)for(const shape of key.shapes){shape.closed=true;for(const node of shape.nodes!){node.in??={x:node.x,y:node.y};node.out??={x:node.x,y:node.y};}}createBasicMotionSpan(state.project,[layer.id],0,8,'linear',{nodes:true,affine:true},undefined,undefined,{start:1,reverse:true,source:{start:2,reverse:false}});}
 const before=structuredClone(state),capture=captureRememberedNodeAuthoringFrame(()=>state),original=capture.scene[0].key.shapes[0],base=original.nodes![1],point=worldPoint(original,{x:base.x+2,y:base.y+3}),result=capture.prepareNodePosition('base','curve',1,point),next=result.layers[0];
 expect(worldPoint(next.keys[4].shapes[0],next.keys[4].shapes[0].nodes![1])).toEqual(point);expect(next.keys[4].shapes[0].nodes).toHaveLength(3);expect(next.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(before.project.layers[0].keys.filter(k=>[0,8,10].includes(k.frame)));expect(next.motionSpans![0].correspondence?.source).toEqual({start:2,reverse:false});expect(next.motionSpans![1].correspondence).toMatchObject({start:1,reverse:true});expect(state).toEqual(before);
});
