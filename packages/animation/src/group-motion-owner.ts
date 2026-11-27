import {validateProject,type Project,type Vector,type Point} from '../../document/src';
import {reparentVectors} from '../../document/src/groups';
import {captureRememberedAuthoringFrame} from './motion-owner';
import {promoteSampledMotionFrame,sampleRememberedMotionFrames,refreshBasicMotionSpan} from './motion-spans';
import {translateRememberedEndpoint,rotateRememberedEndpoint,scaleRememberedEndpoint,skewRememberedEndpoint} from './motion-junction';

import {snapshotGroupTrajectoryInputs,admitGroupTrajectory,type GroupTrajectoryRequest,type GroupTrajectoryOptions} from './group-trajectory';
export type {GroupTrajectoryRequest,GroupTrajectoryOptions} from './group-trajectory';
import type {MotionPath} from '../../document/src/motion-path';

export interface GroupAuthoringSource{project:Project;revision:number;frame:number}
function originalNumbers(value:unknown):void{
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Sampled group source contains nonfinite original values.');
 if(value&&typeof value==='object')for(const child of Object.values(value))originalNumbers(child);
}
function signature(source:GroupAuthoringSource){
 if(!source?.project||!Number.isSafeInteger(source.revision)||source.revision<0||!Number.isSafeInteger(source.frame)||source.frame<0||source.frame>=source.project.duration)
  throw new Error('Invalid sampled group source, revision or frame.');
 originalNumbers(source.project);return JSON.stringify(source.project);
}
function groupMembers(shapes:Vector[],groupId:string){
 const members=shapes.filter(shape=>shape.groups?.[0]===groupId);
 if(!members.length)throw new Error('Choose a complete sampled outer group.');
 // Admit original ancestry, unique identities and contiguous authored paint order.
 reparentVectors(structuredClone(shapes),members.map(shape=>shape.id),[],[]);
 return members.map(shape=>({id:shape.id,groups:shape.groups}));
}
/** Private complete-root-group ownership. Scene/choices are detached hints, never
 * admission or replacement artwork. Callers own final live/history publication. */
export function captureRememberedGroupAuthoringFrame(readSource:()=>GroupAuthoringSource){
 const first=readSource(),initial={project:first.project,revision:first.revision,frame:first.frame},stamp=signature(initial);
 validateProject(initial.project);
 const project=structuredClone(initial.project);
 let dead=false,reading=false,preparingTrajectory=false,capture:ReturnType<typeof captureRememberedAuthoringFrame>|undefined;
 function current(){
  if(dead)throw new Error('Sampled group capture is disposed or invalidated.');
  if(reading){dead=true;capture?.dispose();throw new Error('Sampled group source cannot reenter.');}
  reading=true;
  try{
   const live=readSource();
   if(dead||live.project!==initial.project||live.revision!==initial.revision||live.frame!==initial.frame||signature(live)!==stamp)
    throw new Error('Sampled group source changed. Sample the frame again.');
  }catch(error){dead=true;capture?.dispose();throw error;}
  finally{reading=false;}
 }
 try{
  capture=captureRememberedAuthoringFrame(()=>{current();return {project,revision:initial.revision};},initial.frame);
  const owned=capture,privateScene=structuredClone(owned.scene);
  function resolveGroup(layerId:string,shapeId:string){
   current();const owner=owned.resolve(layerId,shapeId),shapes=privateScene.find(track=>track.layerId===layerId)!.key.shapes;
   const groupId=shapes.find(shape=>shape.id===shapeId)?.groups?.[0];
   if(!groupId)throw new Error('Choose a complete sampled outer group.');
   const members=groupMembers(shapes,groupId),membership=JSON.stringify(members),layer=project.layers.find(layer=>layer.id===layerId)!;
   const [pose]=sampleRememberedMotionFrames(project,[layerId],owner.start,owner.end,owner.frame);
   for(const artwork of [pose.shapes,...[owner.start,owner.frame,owner.end].map(frame=>layer.keys.find(key=>key.frame===frame)!.shapes)])
    if(JSON.stringify(groupMembers(artwork,groupId))!==membership)throw new Error('Sampled group membership, ancestry or paint order is incomplete.');
   for(const member of members){
    const resolved=owned.resolve(layerId,member.id);
    if(resolved.spanId!==owner.spanId||resolved.start!==owner.start||resolved.end!==owner.end)throw new Error('Sampled group members do not share one recipe.');
   }
   current();return {...owner,groupId,shapeIds:members.map(member=>member.id)};
  }
  function rejectTrajectoryReentry(){if(preparingTrajectory){dead=true;owned.dispose();throw new Error('Group trajectory preparation cannot reenter its capture.');}}
  /** Replace only explicit path controls and generated baselines on complete
   * original group-owned recipes. Existing leader-relative MotionPath offsets
   * are retained; this does not rebase to a group box or promote a junction.
   * All requested tracks prepare on one detached project before return.
   * Validators may inspect enclosing state, but must not reenter this capture.
   * Caller owns final live/history publication; no recipe option is enabled here. */
  function prepareGroupTrajectories(requests:readonly GroupTrajectoryRequest[],options:GroupTrajectoryOptions={}){
   rejectTrajectoryReentry();current();preparingTrajectory=true;
   try{
    const {input,validate}=snapshotGroupTrajectoryInputs(requests,project.layers.length,options);
    const active=()=>{current();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('Group trajectory validation must be synchronous.');}current();};
    active();
    const prepared=input.map(request=>{
     const owner=resolveGroup(request.layerId,request.shapeId),layer=project.layers.find(layer=>layer.id===owner.layerId)!;
     admitGroupTrajectory(layer,owner,request.path);
     return {...request,owner};
    });
    active();const candidate=structuredClone(project);
    for(const request of prepared)refreshBasicMotionSpan(candidate,[request.layerId],request.owner.start,request.owner.end,undefined,request.path);
    validateProject(candidate);active();return candidate;
   }catch(error){if(!dead)current();throw error;}
   finally{preparingTrajectory=false;}
  }
  current();return {
   get scene(){rejectTrajectoryReentry();current();return owned.scene;},
   get choices(){rejectTrajectoryReentry();current();return structuredClone(owned.choices.filter(choice=>privateScene.find(track=>track.layerId===choice.layerId)!.key.shapes.find(shape=>shape.id===choice.shapeId)?.groups?.[0]));},
   resolveGroup(layerId:string,shapeId:string){rejectTrajectoryReentry();return resolveGroup(layerId,shapeId);},
   prepareGroupTrajectories,
   prepareGroupTrajectory(layerId:string,shapeId:string,path:MotionPath,options:GroupTrajectoryOptions={}){return prepareGroupTrajectories([{layerId,shapeId,path}],options);},
   prepareGroupPromotion(layerId:string,shapeId:string,offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    rejectTrajectoryReentry();const owner=resolveGroup(layerId,shapeId),movement=offset?{x:offset.x,y:offset.y}:undefined,scaling=scale?{x:scale.x,y:scale.y}:undefined,skewing=skew?{axis:skew.axis,degrees:skew.degrees}:undefined;
    if(movement&&(!Number.isFinite(movement.x)||!Number.isFinite(movement.y)||(!movement.x&&!movement.y)))throw new Error('Enter a finite, nonzero offset.');
    if(degrees!==undefined&&(!Number.isFinite(degrees)||!degrees||degrees%360===0||!Number.isFinite(degrees*Math.PI/180)||degrees*Math.PI/180===0))
     throw new Error('Enter a finite rotation that changes the group pose.');
    if(scaling&&(!Number.isFinite(scaling.x)||!Number.isFinite(scaling.y)||!scaling.x||!scaling.y||(scaling.x===1&&scaling.y===1)))
     throw new Error('Enter finite nonzero scales that change the group pose.');
    if(skewing&&(!['x','y'].includes(skewing.axis)||!Number.isFinite(skewing.degrees)||skewing.degrees%180===0))
     throw new Error('Choose a skew axis and a finite angle that changes the group pose.');
    const candidate=structuredClone(project);
    promoteSampledMotionFrame(candidate,[layerId],owner.start,owner.end,owner.frame);
    const artwork=candidate.layers.find(layer=>layer.id===layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
    if(JSON.stringify(groupMembers(artwork,owner.groupId))!==JSON.stringify(groupMembers(privateScene.find(track=>track.layerId===layerId)!.key.shapes,owner.groupId)))
     throw new Error('Prepared group no longer contains the complete original unit.');
    if(movement){
     for(const id of owner.shapeIds){const shape=artwork.find(shape=>shape.id===id)!;
      if(shape.x+movement.x===shape.x&&shape.y+movement.y===shape.y)throw new Error('Offset cannot be represented on every group member.');
     }
     translateRememberedEndpoint(candidate,owner.frame,[{layerId,shapeIds:owner.shapeIds}],movement.x,movement.y);
    }
    // Existing common-pivot rotation keeps local bases/pivots and saved recipe admission.
    if(degrees!==undefined)rotateRememberedEndpoint(candidate,owner.frame,[{layerId,shapeIds:owner.shapeIds}],degrees);
    if(scaling)scaleRememberedEndpoint(candidate,owner.frame,[{layerId,shapeIds:owner.shapeIds}],scaling.x,scaling.y);
    if(skewing)skewRememberedEndpoint(candidate,owner.frame,[{layerId,shapeIds:owner.shapeIds}],skewing.axis,skewing.degrees);
    validateProject(candidate);resolveGroup(layerId,shapeId);current();return candidate;
   },
   dispose(){dead=true;owned.dispose();},
  };
 }catch(error){dead=true;capture?.dispose();throw error;}
}
export type SampledGroupMotionOwner=ReturnType<ReturnType<typeof captureRememberedGroupAuthoringFrame>['resolveGroup']>;
