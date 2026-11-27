import type {Point,Vector} from '../../../packages/document/src';
import {rememberedAuthoringPivot} from '../../../packages/animation/src/motion-junction';
import {objectBounds,worldPoint} from '../../../packages/geometry/src';
export type RotationView={origin:Point;zoom:number;width:number;height:number;cssWidth:number;cssHeight:number};
export function rotationLocal(point:Point,view:RotationView):Point{
 return {x:(point.x*view.width/view.cssWidth-view.origin.x)/view.zoom,
 y:(point.y*view.height/view.cssHeight-view.origin.y)/view.zoom};
}
export function sampledRotationHandle(shape:Vector,view:RotationView,degrees=0){
 const box=objectBounds(shape),pivot=shape.pivot?worldPoint(shape,shape.pivot):
 {x:(box.left+box.right)/2,y:(box.top+box.bottom)/2};
 return projectedRotationHandle(pivot,view,degrees);
}
export function sampledGroupRotationHandle(members:Vector[],view:RotationView,degrees=0){
 return projectedRotationHandle(rememberedAuthoringPivot(members),view,degrees);
}
/** The selection capture, rather than public/proposed members, owns this pivot. */
export function sampledSelectionRotationHandle(pivot:Point,view:RotationView,degrees=0){
 return projectedRotationHandle({x:pivot.x,y:pivot.y},view,degrees);
}
function projectedRotationHandle(pivot:Point,view:RotationView,degrees:number){
 if(![view.zoom,view.width,view.height,view.cssWidth,view.cssHeight].every(n=>Number.isFinite(n)&&n>0) ||
 ![view.origin.x,view.origin.y,degrees].every(Number.isFinite))throw new Error('Invalid rotation view.');
 const screen=(p:Point)=>({x:(p.x*view.zoom+view.origin.x)*view.cssWidth/view.width,
 y:(p.y*view.zoom+view.origin.y)*view.cssHeight/view.height});
 const center=screen(pivot),seed={x:center.x,y:center.y+(center.y<40?32:-32)};
 if(![pivot.x,pivot.y,center.x,center.y,seed.x,seed.y].every(Number.isFinite))throw new Error('Invalid rotation pivot.');
 // Relocate only the initial control point when its pivot is outside the view.
 // The authoring pivot and the subsequent orbit/input remain in document space.
 if(center.x<0||center.x>view.cssWidth||center.y<0||center.y>view.cssHeight){
  const insetX=Math.min(12,view.cssWidth/2),insetY=Math.min(12,view.cssHeight/2);
  seed.x=Math.max(insetX,Math.min(view.cssWidth-insetX,seed.x));
  seed.y=Math.max(insetY,Math.min(view.cssHeight-insetY,seed.y));
 }
 const base=rotationLocal(seed,view);
 const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const knob=screen({x:pivot.x+c*(base.x-pivot.x)-s*(base.y-pivot.y),
 y:pivot.y+s*(base.x-pivot.x)+c*(base.y-pivot.y)});
 if(![pivot.x,pivot.y,center.x,center.y,knob.x,knob.y].every(Number.isFinite))throw new Error('Invalid rotation pivot.');
 return {pivot,center,knob};
}
