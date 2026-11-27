import type {Layer} from '../../document/src';
import type {MotionPath} from '../../document/src/motion-path';
import type {SampledMotionOwner} from './motion-owner';
import {motionRotationDelta} from './motion-rotation';
import {snapshotTrajectoryPath} from './trajectory-input';

/** Scope must come from private original root ownership, never proposed artwork. */
export function admitRootTrajectory(layer:Layer,owner:SampledMotionOwner,path?:MotionPath){
   const span=layer.motionSpans!.find(span=>span.id===owner.spanId)!;
   if(span.path?.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)
    throw new Error('Root tangent or custom-pivot trajectories require separate orbit admission.');
   for(const key of layer.keys.filter(key=>key.frame>=owner.start&&key.frame<=owner.end))
    if(key.shapes.length!==1||key.shapes[0].id!==owner.shapeId||key.shapes[0].groups?.length)
     throw new Error('Choose one original ungrouped root on a single-root recipe. Shared trajectories require complete-group admission.');
   const first=layer.keys.find(key=>key.frame===owner.start)!.shapes[0],last=layer.keys.find(key=>key.frame===owner.end)!.shapes[0];
   if(!Number.isFinite(last.x-first.x)||!Number.isFinite(last.y-first.y)||motionRotationDelta(first.rotation,last.rotation,span.rotation??{direction:'shortest',turns:0})!==0)
    throw new Error('Root translation trajectories require finite displacement and no orbit rotation.');
   if(path&&JSON.stringify(span.path&&snapshotTrajectoryPath(span.path))===JSON.stringify(path))throw new Error('Root trajectory does not change the original recipe.');
}
