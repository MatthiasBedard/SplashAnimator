import type {Point,Vector} from '../../../packages/document/src';
import {objectBounds} from '../../../packages/geometry/src';
import {rangeHandleTransform} from '../../../packages/geometry/src/range-handles';
import {sampledGroupTransformBounds} from './sampled-scale-handles';
import {sampledRotationHandle,type RotationView} from './sampled-rotation-handle';
export function sampledSkewHandles(shape:Vector,view:RotationView,axis:'x'|'y'='x',degrees=0){
 const {pivot}=sampledRotationHandle(shape,view),box=objectBounds(shape);
 return projectedSkewHandles(box,pivot,view,axis,degrees);
}
export function sampledGroupSkewHandles(members:Vector[],view:RotationView,axis:'x'|'y'='x',degrees=0){
 const {pivot,box}=sampledGroupTransformBounds(members,view);
 return projectedSkewHandles(box,pivot,view,axis,degrees);
}
function projectedSkewHandles(box:ReturnType<typeof objectBounds>,pivot:Point,view:RotationView,axis:'x'|'y',degrees:number){
 const r=degrees*Math.PI/180,shear=Math.tan(r);
 if(!['x','y'].includes(axis)||!Number.isFinite(r)||Math.abs(Math.cos(r))<1e-8||!Number.isFinite(shear))throw new Error('Invalid skew angle.');
 const project=(p:Point)=>{
  const x=p.x+(axis==='x'?(p.y-pivot.y)*shear:0),y=p.y+(axis==='y'?(p.x-pivot.x)*shear:0);
  const point={x:(x*view.zoom+view.origin.x)*view.cssWidth/view.width,y:(y*view.zoom+view.origin.y)*view.cssHeight/view.height};
  if(![point.x,point.y].every(Number.isFinite))throw new Error('Skew handle exceeds finite coordinates.');
  return point;
 };
 const handles=[{id:'skew-n',x:(box.left+box.right)/2,y:box.top},{id:'skew-e',x:box.right,y:(box.top+box.bottom)/2},
 {id:'skew-s',x:(box.left+box.right)/2,y:box.bottom},{id:'skew-w',x:box.left,y:(box.top+box.bottom)/2}]
 .filter(p=>Math.abs((p.id==='skew-n'||p.id==='skew-s'?p.y-pivot.y:p.x-pivot.x))>=1e-8)
 .map(p=>({id:p.id,point:project(p)}));
 const outline=[{x:box.left,y:box.top},{x:box.right,y:box.top},{x:box.right,y:box.bottom},{x:box.left,y:box.bottom}].map(project);
 return {pivot,box,handles,outline};
}
export function sampledSkewAngle(edge:string,box:ReturnType<typeof objectBounds>,pivot:Point,start:Point,end:Point,shift:boolean){
 if(!['skew-n','skew-e','skew-s','skew-w'].includes(edge))throw new Error('Choose a valid skew edge.');
 if(![...Object.values(box),pivot.x,pivot.y,start.x,start.y,end.x,end.y].every(Number.isFinite))throw new Error('Enter finite skew coordinates.');
 const operation=rangeHandleTransform(edge,box,pivot,start,end,shift,true),axis=edge==='skew-n'||edge==='skew-s'?'x':'y';
 if(!operation.every(Number.isFinite))throw new Error('Skew exceeds finite numerics.');
 return {axis:axis as 'x'|'y',degrees:Math.atan(axis==='x'?operation[2]:operation[1])*180/Math.PI};
}

/** Private capture supplies the complete original union and shared document pivot.
 * Reuse legacy skew edge viability/angle arithmetic without inventing anchors.
 */
export function sampledSelectionSkewHandles(box:ReturnType<typeof objectBounds>,pivot:Point,view:RotationView,axis:'x'|'y'='x',degrees=0){
 if(![...Object.values(box),pivot.x,pivot.y,degrees].every(Number.isFinite))throw Error('Invalid original selection skew geometry.');
 if(![view.origin.x,view.origin.y,view.zoom,view.width,view.height,view.cssWidth,view.cssHeight].every(Number.isFinite)||
  Math.min(view.zoom,view.width,view.height,view.cssWidth,view.cssHeight)<=0)throw Error('Invalid selection skew view.');
 const result=projectedSkewHandles(box,pivot,view,axis,degrees);
 return {...result,handles:result.handles.map(h=>({ ...h,
  anchor:{x:h.id==='skew-e'?box.right:h.id==='skew-w'?box.left:(box.left+box.right)/2,
    y:h.id==='skew-n'?box.top:h.id==='skew-s'?box.bottom:(box.top+box.bottom)/2},
  axis:(h.id==='skew-n'||h.id==='skew-s'?'x':'y') as 'x'|'y'
 }))};
}
