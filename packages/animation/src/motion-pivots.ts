import type {Point,Vector} from '../../document/src';
import {matrix,objectBounds,inversePoint} from '../../geometry/src';

/** Resolve an explicitly admitted default from the stage authoring box, before
 * contour alignment/resampling can change the representation. Never mutate it. */
export function motionLocalPivot(shape:Vector,defaults=false):Point{
 if(typeof defaults!=='boolean')throw new Error('Choose an explicit default pivot policy.');
 const finite=(value:unknown):void=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Default pivot contains nonfinite original values.');if(value&&typeof value==='object')for(const child of Object.values(value))finite(child);};if(defaults)finite(shape);
 if(shape.pivot!==undefined){
  if(!shape.pivot||![shape.pivot.x,shape.pivot.y].every(Number.isFinite))throw new Error('Saved artwork pivots must have finite coordinates.');
  return {x:shape.pivot.x,y:shape.pivot.y};
 }
 if(!defaults)throw new Error('Saved artwork pivots must have finite coordinates.');
 const basis=matrix(shape),det=basis[0]*basis[3]-basis[1]*basis[2];
 if(![shape.width,shape.height,...basis,det].every(Number.isFinite)||det===0)throw new Error('Default pivot requires a finite invertible authoring box.');
 const box=objectBounds(shape),world={x:(box.left+box.right)/2,y:(box.top+box.bottom)/2};
 const local=inversePoint(basis,world);
 if(![...Object.values(box),world.x,world.y,local.x,local.y].every(Number.isFinite))throw new Error('Default pivot exceeds finite coordinates.');
 return local;
}
