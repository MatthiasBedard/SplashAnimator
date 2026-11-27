import type {Point,Vector} from '../../../packages/document/src';
import {objectBounds} from '../../../packages/geometry/src';
import {rangeHandleTransform} from '../../../packages/geometry/src/range-handles';
import {sampledRotationHandle,sampledGroupRotationHandle,type RotationView} from './sampled-rotation-handle';
export function sampledScaleHandles(shape:Vector,view:RotationView,factors:Point={x:1,y:1}){
 const {pivot}=sampledRotationHandle(shape,view),box=objectBounds(shape);
 return projectedScaleHandles(box,pivot,view,factors);
}
export function sampledGroupScaleHandles(members:Vector[],view:RotationView,factors:Point={x:1,y:1}){
 const {pivot,box}=sampledGroupTransformBounds(members,view);
 return projectedScaleHandles(box,pivot,view,factors);
}
/** Original complete-selection geometry; the capture owns membership and pivot. */
export function sampledSelectionScaleBounds(members:readonly Vector[]){
 if(!members.length)throw new Error('Choose original selection members.');
 const box={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
 for(const member of members){const b=objectBounds(member);
  box.left=Math.min(box.left,b.left);box.top=Math.min(box.top,b.top);
  box.right=Math.max(box.right,b.right);box.bottom=Math.max(box.bottom,b.bottom);
 }
 if(!Object.values(box).every(Number.isFinite))throw new Error('Invalid selection scaling bounds.');
 return box;
}
export function sampledSelectionScaleHandles(box:ReturnType<typeof objectBounds>,pivot:Point,view:RotationView,factors:Point={x:1,y:1}){
 if(![...Object.values(box),pivot.x,pivot.y].every(Number.isFinite))throw new Error('Invalid original selection scale geometry.');
 if(![view.origin.x,view.origin.y,view.zoom,view.width,view.height,view.cssWidth,view.cssHeight].every(Number.isFinite)||
  Math.min(view.zoom,view.width,view.height,view.cssWidth,view.cssHeight)<=0)throw new Error('Invalid selection scale view.');
 const result=projectedScaleHandles(box,pivot,view,factors);
 return {...result,handles:result.handles.map(h=>{
  const edge=h.id.startsWith('scale-')?h.id.slice(6):null;
  const anchor=edge?{x:edge==='e'?box.right:edge==='w'?box.left:(box.left+box.right)/2,
   y:edge==='n'?box.top:edge==='s'?box.bottom:(box.top+box.bottom)/2}:
   {x:h.id.includes('w')?box.left:box.right,y:h.id.includes('n')?box.top:box.bottom};
  return {...h,anchor};
 })};
}
export function sampledGroupTransformBounds(members:Vector[],view:RotationView){
 const {pivot}=sampledGroupRotationHandle(members,view),boxes=members.map(objectBounds);
 const box={left:Math.min(...boxes.map(b=>b.left)),top:Math.min(...boxes.map(b=>b.top)),
  right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))};
 return {pivot,box};
}
function projectedScaleHandles(box:ReturnType<typeof objectBounds>,pivot:Point,view:RotationView,factors:Point){
 if(![factors.x,factors.y].every(Number.isFinite))throw new Error('Enter finite scale factors.');
 const corners=[{id:'nw',x:box.left,y:box.top},{id:'ne',x:box.right,y:box.top},
 {id:'se',x:box.right,y:box.bottom},{id:'sw',x:box.left,y:box.bottom},
 {id:'scale-n',x:(box.left+box.right)/2,y:box.top},{id:'scale-e',x:box.right,y:(box.top+box.bottom)/2},
 {id:'scale-s',x:(box.left+box.right)/2,y:box.bottom},{id:'scale-w',x:box.left,y:(box.top+box.bottom)/2}];
 const handles=corners.filter(p=>{
  if(p.id==='scale-e'||p.id==='scale-w')return Math.abs(p.x-pivot.x)>=1e-8;
  if(p.id==='scale-n'||p.id==='scale-s')return Math.abs(p.y-pivot.y)>=1e-8;
  return Math.abs(p.x-pivot.x)>=1e-8&&Math.abs(p.y-pivot.y)>=1e-8;
 }).map(p=>{
  const x=pivot.x+(p.x-pivot.x)*factors.x,y=pivot.y+(p.y-pivot.y)*factors.y;
  const point={x:(x*view.zoom+view.origin.x)*view.cssWidth/view.width,
  y:(y*view.zoom+view.origin.y)*view.cssHeight/view.height};
  if(![point.x,point.y].every(Number.isFinite))throw new Error('Scale handle exceeds finite coordinates.');
  return {id:p.id,point};
 });
 return {pivot,box,handles};
}
export function sampledScaleFactors(box:ReturnType<typeof objectBounds>,pivot:Point,start:Point,end:Point,shift:boolean,handle='se'):Point{
 if(![...Object.values(box),pivot.x,pivot.y,start.x,start.y,end.x,end.y].every(Number.isFinite))
  throw new Error('Enter finite scaling coordinates.');
 if(!['nw','ne','se','sw','scale-n','scale-e','scale-s','scale-w'].includes(handle))throw new Error('Choose a valid scale handle.');
 // Always use the frozen saved/default pivot. Reuse existing corner constraints
 // and signed minimum-scale protection; remembered recipe admission follows.
 const operation=rangeHandleTransform(handle,box,pivot,start,end,shift,true);
 if(!operation.every(Number.isFinite))throw new Error('Scaling exceeds finite numerics.');
 return {x:operation[0],y:operation[3]};
}
