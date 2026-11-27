import {validateProject,type Project,type Point} from '../../../packages/document/src';
import {promoteSampledMotionFrame} from '../../../packages/animation/src/motion-spans';
import {translateRememberedEndpoint,rotateRememberedEndpoint,scaleRememberedEndpoint,skewRememberedEndpoint} from '../../../packages/animation/src/motion-junction';
import type {SampledMotionOwner} from '../../../packages/animation/src/motion-owner';

/** Shared detached preparation for proposed stills and publication. Caller must
 * resolve the pick against the current source, including immediately before commit. */
export function preparePickedMotionCandidate(snapshot:Project,owner:SampledMotionOwner,offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}):Project {
  validateProject(snapshot);
  if(offset && (!Number.isFinite(offset.x)||!Number.isFinite(offset.y)||(!offset.x&&!offset.y)))
    throw new Error('Enter a finite, nonzero offset.');
  if(offset && snapshot.layers.find(track=>track.id===owner.layerId)?.drawingMode==='merge')
    throw new Error('Moving a picked pose requires object-mode artwork.');
  const candidate=structuredClone(snapshot);
  promoteSampledMotionFrame(candidate,[owner.layerId],owner.start,owner.end,owner.frame);
  if(offset)translateRememberedEndpoint(candidate,owner.frame,[{layerId:owner.layerId,shapeIds:[owner.shapeId]}],offset.x,offset.y);
  if(degrees!==undefined)rotateRememberedEndpoint(candidate,owner.frame,[{layerId:owner.layerId,shapeIds:[owner.shapeId]}],degrees);
  if(scale)scaleRememberedEndpoint(candidate,owner.frame,[{layerId:owner.layerId,shapeIds:[owner.shapeId]}],scale.x,scale.y);
  if(skew)skewRememberedEndpoint(candidate,owner.frame,[{layerId:owner.layerId,shapeIds:[owner.shapeId]}],skew.axis,skew.degrees);
  validateProject(candidate);
  return candidate;
}
