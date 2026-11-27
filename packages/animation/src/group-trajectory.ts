import type {MotionPath} from '../../document/src/motion-path';
import {motionRotationDelta} from './motion-rotation';
import {reparentVectors} from '../../document/src/groups';
import type {Layer,Vector} from '../../document/src';
import type {SampledGroupMotionOwner} from './group-motion-owner';

import {snapshotTrajectoryInputs} from './trajectory-input';

export interface GroupTrajectoryRequest{layerId:string;shapeId:string;path:MotionPath}
export interface GroupTrajectoryOptions{validate?:()=>void}

/** Preserve the complete-group request contract and diagnostics. */
export function snapshotGroupTrajectoryInputs(requests:readonly GroupTrajectoryRequest[],tracks:number,options:GroupTrajectoryOptions){
 return snapshotTrajectoryInputs(requests,tracks,options,'group');
}
function members(shapes:Vector[],groupId:string){
 const items=shapes.filter(shape=>shape.groups?.[0]===groupId);
 if(!items.length)throw new Error('Choose a complete sampled outer group.');
 reparentVectors(structuredClone(shapes),items.map(shape=>shape.id),[],[]);
 return items.map(shape=>({id:shape.id,groups:shape.groups}));
}
/** Only original private layers/owners may authorize a whole shared recipe edit. */
export function admitGroupTrajectory(layer:Layer,owner:SampledGroupMotionOwner,path:MotionPath){
 const span=layer.motionSpans!.find(span=>span.id===owner.spanId)!;
 if(span.path?.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)throw new Error('Group tangent or custom-pivot trajectories require separate orbit admission.');
 const first=layer.keys.find(key=>key.frame===owner.start)!.shapes,last=layer.keys.find(key=>key.frame===owner.end)!.shapes,expected=JSON.stringify(members(first,owner.groupId));
 for(const key of layer.keys.filter(key=>key.frame>=owner.start&&key.frame<=owner.end)){
  if(key.shapes.length!==owner.shapeIds.length||key.shapes.some((shape,i)=>shape.id!==owner.shapeIds[i])||JSON.stringify(members(key.shapes,owner.groupId))!==expected)throw new Error('Shared trajectory would affect artwork outside the complete original group.');
 }
 const dx=last[0].x-first[0].x,dy=last[0].y-first[0].y;
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||first.some((shape,i)=>last[i].x-shape.x!==dx||last[i].y-shape.y!==dy||motionRotationDelta(shape.rotation,last[i].rotation,span.rotation??{direction:'shortest',turns:0})!==0))throw new Error('Group translation trajectories require equal endpoint displacement and no orbit rotation.');
 if(JSON.stringify(span.path)===JSON.stringify(path))throw new Error('Group trajectory does not change the original recipe.');
}
