import type {Point} from '../../document/src';
import {validateMotionPath,type MotionPath} from '../../document/src/motion-path';

export interface TrajectoryRequest{layerId:string;shapeId:string;path:MotionPath}
export interface TrajectoryOptions{validate?:()=>void}

/** Read raw controls once, rejecting malformed arrays before JSON/clone can hide them. */
export function snapshotTrajectoryPath(path:MotionPath,scope:"group"|"root"|"selection"="root"):MotionPath{
 const title=scope==='group'?'Group':scope==='selection'?'Selection':'Root';
 if(!path||typeof path!=='object')throw new Error('Choose an explicit motion path.');
 const fields=['startX','startY','endX','endY','waypoints','curvedWaypoints','waypointTangents','waypointIncoming','distance','tangent','headingOffset','headingOffsetEnd'] as const;
 if(Reflect.ownKeys(path).some(key=>typeof key!=='string'||!fields.includes(key as typeof fields[number])))throw new Error(`Unsupported ${scope} trajectory field.`);
 const value:Record<string,unknown>={};
 for(const field of fields){const raw=path[field];if(raw===undefined)continue;
  if(field==='waypoints'||field==='waypointTangents'||field==='waypointIncoming'){
   if(!Array.isArray(raw))throw new Error(`${title} trajectory controls require arrays.`);
   const length=raw.length;if(!Number.isSafeInteger(length)||length<1)throw new Error(`${title} trajectory controls require finite points.`);
   const points:Point[]=[];for(let i=0;i<length;i++){const p=raw[i];if(!p||typeof p!=='object')throw new Error(`Missing ${scope} trajectory control.`);const x=p.x,y=p.y;if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`${title} trajectory controls must be finite.`);points.push({x,y});}if(scope==='selection'&&raw.length!==length)throw new Error('Selection trajectory controls changed while being read.');value[field]=points;
  }else value[field]=raw;
 }
 const result=value as unknown as MotionPath;validateMotionPath(result);if(result.tangent)throw new Error(`${title} tangent trajectories require separate orbit admission.`);return result;
}

/** Internal shared snapshot contract; controls retain original leader-relative meaning. */
export function snapshotTrajectoryInputs(requests:readonly TrajectoryRequest[],tracks:number,options:TrajectoryOptions,scope:"group"|"root"|"selection"="root"){
 if(!Array.isArray(requests))throw new Error(`Choose ${scope} trajectory requests.`);
 const count=requests.length;if(!Number.isSafeInteger(count)||count<1||count>tracks)throw new Error(`Choose one ${scope} trajectory per original track.`);
 const validate=options.validate;if(validate!==undefined&&typeof validate!=='function')throw new Error(`Choose a synchronous ${scope} trajectory validator.`);
 const input:TrajectoryRequest[]=[],seen=new Set<string>();
 for(let i=0;i<count;i++){
  const raw=requests[i];if(!raw)throw new Error(`Missing ${scope} trajectory request.`);
  const layerId=raw.layerId,shapeId=raw.shapeId,path=raw.path;
  if(typeof layerId!=='string'||typeof shapeId!=='string'||!layerId||!shapeId||seen.has(layerId))throw new Error(`Choose one original ${scope==='group'?'complete group':scope==='selection'?'recipe leader':'root'} per track.`);
  seen.add(layerId);input.push({layerId,shapeId,path:snapshotTrajectoryPath(path,scope)});
 }
 if(scope==='selection'&&requests.length!==count)throw new Error('Selection trajectory requests changed while being read.');
 return {input,validate};
}
