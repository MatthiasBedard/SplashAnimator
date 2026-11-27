import {MAX_SYMBOL_ARTWORK,newProject,symbolArtworks,symbolLayers,type SymbolDefinition,type Point,type Vector} from '../../document/src';
import {reparentVectors} from '../../document/src/groups';
import {prepareRememberedTimelineCapture} from './motion-capture';
import {captureRememberedAuthoringFrame} from './motion-owner';
import {editSymbolBasicMotionSpan,sampleRememberedMotionFrames} from './motion-spans';
import {translateSymbolRememberedEndpoint,rotateSymbolRememberedEndpoint,scaleSymbolRememberedEndpoint,skewSymbolRememberedEndpoint,moveSymbolRememberedEndpointNodes,moveSymbolRememberedEndpointTangents,setSymbolRememberedEndpointPivots,rememberedAuthoringPivot} from './motion-junction';

import {snapshotGroupTrajectoryInputs,admitGroupTrajectory,type GroupTrajectoryRequest,type GroupTrajectoryOptions} from './group-trajectory';
import type {MotionPath} from '../../document/src/motion-path';
import {snapshotTrajectoryInputs,type TrajectoryRequest,type TrajectoryOptions} from './trajectory-input';
import {admitRootTrajectory} from './root-trajectory';

export interface SymbolAuthoringSource{
 definition:SymbolDefinition;
 symbols:SymbolDefinition[];
 revision:number;
 frame:number;
}
function originalNumbers(value:unknown):void{
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Sampled symbol source contains nonfinite original values.');
 if(value&&typeof value==='object')for(const child of Object.values(value))originalNumbers(child);
}
function signature(source:SymbolAuthoringSource){
 if(!source?.definition||!Array.isArray(source.symbols)||!Number.isSafeInteger(source.revision)||source.revision<0||
 !Number.isSafeInteger(source.frame)||source.frame<0||source.frame>=(source.definition.timeline?.duration??1))
  throw new Error('Invalid sampled symbol source, revision or frame.');
 originalNumbers(source.definition);originalNumbers(source.symbols);
 if(typeof source.definition.id!=='string'||!source.definition.id||source.symbols.some(s=>typeof s.id!=='string'||!s.id)||
 new Set(source.symbols.map(s=>s.id)).size!==source.symbols.length)throw new Error('Ambiguous sampled symbol library identity.');
 return JSON.stringify([source.definition,source.symbols]);
}
function checkBudget(definition:SymbolDefinition,symbols:SymbolDefinition[]){
 const count=[...symbols.filter(s=>s.id!==definition.id),definition].reduce((n,s)=>n+symbolArtworks(s).reduce((m,a)=>m+a.length,0),0);
 if(!Number.isSafeInteger(count)||count>MAX_SYMBOL_ARTWORK)throw new Error('Sampled symbol motion exceeds the project symbol artwork budget.');
}
/** Private ownership over a detached library-aware frame. No draft/history writes.
 * Caller must separately admit any prepared result to its live enclosing project. */
export function captureSymbolRememberedAuthoringFrame(readSource:()=>SymbolAuthoringSource){
 const first=readSource();
 const initial={definition:first.definition,symbols:first.symbols,revision:first.revision,frame:first.frame},stamp=signature(initial);
 checkBudget(initial.definition,initial.symbols);
 const definition=structuredClone(initial.definition),symbols=structuredClone(initial.symbols);
 const library=[...symbols.filter(s=>s.id!==definition.id),definition];
 const view={layers:structuredClone(symbolLayers(definition)),duration:definition.timeline?.duration??1,symbols:library};
 let dead=false,reading=false,preparingTrajectory=false,trajectoryKind:'group'|'root'='group';
 let capture:ReturnType<typeof captureRememberedAuthoringFrame>|undefined;
 function current(){
  if(dead)throw new Error('Sampled symbol capture is disposed or invalidated.');
  if(reading){dead=true;throw new Error('Sampled symbol source cannot reenter.');}
  reading=true;
  try{
   const live=readSource();
   if(dead||live.definition!==initial.definition||live.symbols!==initial.symbols||live.revision!==initial.revision||
    live.frame!==initial.frame||signature(live)!==stamp)throw new Error('Sampled symbol source changed. Sample the frame again.');
  }catch(error){dead=true;capture?.dispose();throw error;}
  finally{reading=false;}
 }
 try{
  capture=captureRememberedAuthoringFrame(()=>{current();return {project:view,revision:initial.revision};},initial.frame);
  const owned=capture;
  // Presentation is public and mutable; group membership never reads it again.
  const groupScene=structuredClone(owned.scene);
  function groupMembers(shapes:Vector[],groupId:string){
   const members=shapes.filter(shape=>shape.groups?.[0]===groupId);
   if(!members.length)throw new Error('Choose a complete sampled outer group.');
   // Same-root admission checks ancestry, contiguous paint order and unique IDs.
   reparentVectors(structuredClone(shapes),members.map(shape=>shape.id),[],[]);
   return members.map(shape=>({id:shape.id,groups:shape.groups}));
  }
  function resolveGroup(layerId:string,shapeId:string){
   current();const owner=owned.resolve(layerId,shapeId);
   const shapes=groupScene.find(track=>track.layerId===layerId)!.key.shapes;
   const groupId=shapes.find(shape=>shape.id===shapeId)?.groups?.[0];
   if(!groupId)throw new Error('Choose a complete sampled outer group.');
   const members=groupMembers(shapes,groupId),membership=JSON.stringify(members);
   const layer=view.layers.find(layer=>layer.id===layerId)!;
   const [pose]=sampleRememberedMotionFrames(view,[layerId],owner.start,owner.end,owner.frame);
   for(const artwork of [pose.shapes,...[owner.start,owner.frame,owner.end].map(frame=>layer.keys.find(key=>key.frame===frame)!.shapes)])
    if(JSON.stringify(groupMembers(artwork,groupId))!==membership)
     throw new Error('Sampled group membership, ancestry or paint order is incomplete.');
   for(const member of members){
    const resolved=owned.resolve(layerId,member.id);
    if(resolved.spanId!==owner.spanId||resolved.start!==owner.start||resolved.end!==owner.end)
     throw new Error('Sampled group members do not share one recipe.');
   }
   current();return {...owner,definitionId:definition.id,groupId,shapeIds:members.map(member=>member.id)};
  }
  function resolveNode(layerId:string,shapeId:string,nodeIndex:number){
   current();const owner=owned.resolve(layerId,shapeId),shape=groupScene.find(track=>track.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(nodeIndex)||nodeIndex<0||shape?.kind!=='bezier'||!shape.nodes?.[nodeIndex])throw new Error('Choose an original sampled Bezier node.');
   current();return {...owner,definitionId:definition.id,nodeIndex,nodeCount:shape.nodes.length};
  }
  function resolveTangent(layerId:string,shapeId:string,nodeIndex:number,part:'in'|'out'){
   const owner=resolveNode(layerId,shapeId,nodeIndex),shape=groupScene.find(track=>track.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!['in','out'].includes(part)||shape?.contours?.length||!shape?.nodes?.[nodeIndex]?.[part])throw new Error('Choose an existing original single-contour Bezier handle.');
   current();return {...owner,part};
  }
  function resolveCompoundNode(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number){
   current();const owner=owned.resolve(layerId,shapeId),shape=groupScene.find(track=>track.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(contourIndex)||contourIndex<0||!Number.isSafeInteger(nodeIndex)||nodeIndex<0||shape?.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.[contourIndex]?.[nodeIndex])throw new Error('Choose an original sampled compound contour node.');
   current();return {...owner,definitionId:definition.id,contourIndex,nodeIndex,nodeCount:shape.contours[contourIndex].length,contourCount:shape.contours.length};
  }
  function resolveCompoundTangent(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,part:'in'|'out'){
   current();const owner=owned.resolve(layerId,shapeId),shape=groupScene.find(track=>track.layerId===layerId)?.key.shapes.find(s=>s.id===shapeId);
   if(!Number.isSafeInteger(contourIndex)||contourIndex<0||!Number.isSafeInteger(nodeIndex)||nodeIndex<0||!['in','out'].includes(part)||shape?.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.[contourIndex]?.[nodeIndex]?.[part])throw new Error('Choose an existing original compound contour and Bezier handle.');
   current();return {...owner,definitionId:definition.id,contourIndex,nodeIndex,part,nodeCount:shape.contours[contourIndex].length,contourCount:shape.contours.length};
  }

  function resolveTrajectory(layerId:string,shapeId:string,path?:MotionPath){
   current();const owner=owned.resolve(layerId,shapeId),layer=view.layers.find(layer=>layer.id===owner.layerId)!;
   admitRootTrajectory(layer,owner,path);current();return {...owner,definitionId:definition.id};
  }
  function rejectTrajectoryReentry(){if(preparingTrajectory){dead=true;owned.dispose();throw new Error(`Symbol ${trajectoryKind} trajectory preparation cannot reenter its capture.`);}}
  /** Library-aware detached route editing; final enclosing assets/history admission remains caller-owned. */
  function prepareTrajectoryRequests(requests:readonly TrajectoryRequest[],options:TrajectoryOptions={},groups=false){
   rejectTrajectoryReentry();current();preparingTrajectory=true;trajectoryKind=groups?'group':'root';
   try{
    const {input,validate}=groups?snapshotGroupTrajectoryInputs(requests,view.layers.length,options):snapshotTrajectoryInputs(requests,view.layers.length,options);
    const active=()=>{current();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error(`Symbol ${trajectoryKind} trajectory validation must be synchronous.`);}current();};
    active();const prepared=input.map(request=>{
     if(groups){const owner=resolveGroup(request.layerId,request.shapeId);admitGroupTrajectory(view.layers.find(layer=>layer.id===owner.layerId)!,owner,request.path);return {...request,owner};}
     return {...request,owner:resolveTrajectory(request.layerId,request.shapeId,request.path)};
    });
    active();let candidate=structuredClone(definition);
    for(const request of prepared)candidate=editSymbolBasicMotionSpan(candidate,[request.layerId],request.owner.start,request.owner.end,'path','linear',library,undefined,false,undefined,request.path);
    // Existing symbol wrappers materialize an empty additional-track array. Keep the original saved default exact.
    if(definition.timeline?.layers===undefined&&candidate.timeline){if(Object.prototype.hasOwnProperty.call(definition.timeline,'layers'))candidate.timeline.layers=undefined;else delete candidate.timeline.layers;}
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   }catch(error){if(!dead)current();throw error;}
   finally{preparingTrajectory=false;trajectoryKind='group';}
  }
  function prepareGroupTrajectories(requests:readonly GroupTrajectoryRequest[],options:GroupTrajectoryOptions={}){return prepareTrajectoryRequests(requests,options,true);}
  current();
  return {
   get scene(){rejectTrajectoryReentry();current();return owned.scene;},
   get choices(){rejectTrajectoryReentry();current();return structuredClone(owned.choices);},
   async preparePresentation(options:{signal?:AbortSignal;validate?:()=>void}={}){
    rejectTrajectoryReentry();
    const active=()=>{options.signal?.throwIfAborted();current();options.validate?.();current();options.signal?.throwIfAborted();};
    active();
    // Discover children from the private displayed roots, never mutable presentation or proposals.
    const project=newProject();project.duration=1;project.symbols=structuredClone(library);
    project.layers=groupScene.map(track=>({...structuredClone(view.layers.find(layer=>layer.id===track.layerId)!),
     keys:[{frame:0,shapes:structuredClone(track.key.shapes)}],motionSpans:undefined}));
    const prepared=await prepareRememberedTimelineCapture(project,{signal:options.signal,validate:active});
    active();return {symbols:prepared.symbols!};
   },
   resolve(layerId:string,shapeId:string){
    rejectTrajectoryReentry();current();const owner=owned.resolve(layerId,shapeId);current();
    return {...owner,definitionId:definition.id};
   },
   resolveGroup(layerId:string,shapeId:string){rejectTrajectoryReentry();return resolveGroup(layerId,shapeId);},
   resolveNode(layerId:string,shapeId:string,nodeIndex:number){rejectTrajectoryReentry();return resolveNode(layerId,shapeId,nodeIndex);},
   resolveTangent(layerId:string,shapeId:string,nodeIndex:number,part:'in'|'out'){rejectTrajectoryReentry();return resolveTangent(layerId,shapeId,nodeIndex,part);},
   resolveCompoundTangent(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,part:'in'|'out'){rejectTrajectoryReentry();return resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part);},
   resolveCompoundNode(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number){rejectTrajectoryReentry();return resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex);},
   resolveTrajectory(layerId:string,shapeId:string){rejectTrajectoryReentry();return resolveTrajectory(layerId,shapeId);},
   prepareTrajectories(requests:readonly TrajectoryRequest[],options:TrajectoryOptions={}){return prepareTrajectoryRequests(requests,options);},
   prepareTrajectory(layerId:string,shapeId:string,path:MotionPath,options:TrajectoryOptions={}){return prepareTrajectoryRequests([{layerId,shapeId,path}],options);},
   prepareGroupTrajectories,
   prepareGroupTrajectory(layerId:string,shapeId:string,path:MotionPath,options:GroupTrajectoryOptions={}){return prepareGroupTrajectories([{layerId,shapeId,path}],options);},
   prepareGroupPivotPosition(layerId:string,shapeId:string,point:Point,options:{validate?:()=>void}={}){
    rejectTrajectoryReentry();const owner=resolveGroup(layerId,shapeId),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{resolveGroup(layerId,shapeId);validate?.();resolveGroup(layerId,shapeId);};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document group pivot coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    const artwork=symbolLayers(candidate).find(layer=>layer.id===layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
    if(JSON.stringify(groupMembers(artwork,owner.groupId))!==JSON.stringify(groupMembers(groupScene.find(track=>track.layerId===layerId)!.key.shapes,owner.groupId)))
     throw new Error('Prepared group no longer contains the complete original unit.');
    const requests=owner.shapeIds.flatMap(id=>{
     const previous=rememberedAuthoringPivot([artwork.find(shape=>shape.id===id)!]);
     return previous.x===position.x&&previous.y===position.y?[]:[{layerId,shapeId:id,position}];
    });
    if(!requests.length)throw new Error('Group pivot position does not change any original member.');
    candidate=setSymbolRememberedEndpointPivots(candidate,library,owner.frame,requests);
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   },
   preparePivotPosition(layerId:string,shapeId:string,point:Point,options:{validate?:()=>void}={}){
    rejectTrajectoryReentry();current();const owner=owned.resolve(layerId,shapeId),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{current();owned.resolve(layerId,shapeId);validate?.();current();owned.resolve(layerId,shapeId);current();};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document pivot coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    candidate=setSymbolRememberedEndpointPivots(candidate,library,owner.frame,[{layerId,shapeId,position}]);
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   },
   prepareCompoundNodePosition(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,point:Point,options:{validate?:()=>void}={}){
    rejectTrajectoryReentry();const owner=resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex);validate?.();resolveCompoundNode(layerId,shapeId,contourIndex,nodeIndex);};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document node coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    candidate=moveSymbolRememberedEndpointNodes(candidate,library,owner.frame,[{layerId,shapeId,contourIndex:owner.contourIndex,nodeIndex:owner.nodeIndex,position}]);
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   },
   prepareCompoundTangentPosition(layerId:string,shapeId:string,contourIndex:number,nodeIndex:number,part:'in'|'out',point:Point,options:{validate?:()=>void;coupled?:boolean}={}){
    rejectTrajectoryReentry();const owner=resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part),position={x:point.x,y:point.y},validate=options.validate,coupled=options.coupled;
    const active=()=>{resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part);validate?.();resolveCompoundTangent(layerId,shapeId,contourIndex,nodeIndex,part);};active();
    if(coupled!==undefined&&typeof coupled!=='boolean')throw new Error('Choose an explicit boolean tangent coupling mode.');
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document tangent coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    candidate=moveSymbolRememberedEndpointTangents(candidate,library,owner.frame,[{layerId,shapeId,contourIndex:owner.contourIndex,nodeIndex:owner.nodeIndex,part:owner.part,position,coupled}]);
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   },
   prepareTangentPosition(layerId:string,shapeId:string,nodeIndex:number,part:'in'|'out',point:Point,options:{validate?:()=>void;coupled?:boolean}={}){
    rejectTrajectoryReentry();const owner=resolveTangent(layerId,shapeId,nodeIndex,part),position={x:point.x,y:point.y},validate=options.validate,coupled=options.coupled;
    const active=()=>{resolveTangent(layerId,shapeId,nodeIndex,part);validate?.();resolveTangent(layerId,shapeId,nodeIndex,part);};active();
    if(coupled!==undefined&&typeof coupled!=='boolean')throw new Error('Choose an explicit boolean tangent coupling mode.');
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document tangent coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    candidate=moveSymbolRememberedEndpointTangents(candidate,library,owner.frame,[{layerId,shapeId,nodeIndex:owner.nodeIndex,part:owner.part,position,coupled}]);
    checkBudget(candidate,symbols);const result=structuredClone(candidate);active();return result;
   },
   prepareNodePosition(layerId:string,shapeId:string,nodeIndex:number,point:Point,options:{validate?:()=>void}={}){
    rejectTrajectoryReentry();const owner=resolveNode(layerId,shapeId,nodeIndex),position={x:point.x,y:point.y},validate=options.validate;
    const active=()=>{current();validate?.();current();};active();
    if(![position.x,position.y].every(Number.isFinite))throw new Error('Enter finite document node coordinates.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    candidate=moveSymbolRememberedEndpointNodes(candidate,library,owner.frame,[{layerId,shapeId,nodeIndex:owner.nodeIndex,position}]);
    checkBudget(candidate,symbols);resolveNode(layerId,shapeId,nodeIndex);const result=structuredClone(candidate);active();return result;
   },
   prepareGroupPromotion(layerId:string,shapeId:string,offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    rejectTrajectoryReentry();const owner=resolveGroup(layerId,shapeId);
    // Snapshot caller input before preparation; caller retains final live-input admission.
    const movement=offset?{x:offset.x,y:offset.y}:undefined,scaling=scale?{x:scale.x,y:scale.y}:undefined,skewing=skew?{axis:skew.axis,degrees:skew.degrees}:undefined;
    if(movement&&(!Number.isFinite(movement.x)||!Number.isFinite(movement.y)||(!movement.x&&!movement.y)))
     throw new Error('Enter a finite, nonzero offset.');
    if(degrees!==undefined&&(!Number.isFinite(degrees)||!degrees||degrees%360===0||
      !Number.isFinite(degrees*Math.PI/180)||degrees*Math.PI/180===0))
     throw new Error('Enter a finite rotation that changes the group pose.');
    if(scaling&&(!Number.isFinite(scaling.x)||!Number.isFinite(scaling.y)||!scaling.x||!scaling.y||
      (scaling.x===1&&scaling.y===1)))throw new Error('Enter finite nonzero scales that change the group pose.');
    if(skewing&&(!['x','y'].includes(skewing.axis)||!Number.isFinite(skewing.degrees)||skewing.degrees%180===0))
     throw new Error('Choose a skew axis and a finite angle that changes the group pose.');
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
     undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    const artwork=symbolLayers(candidate).find(layer=>layer.id===layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
    const members=groupMembers(artwork,owner.groupId);
    if(JSON.stringify(members)!==JSON.stringify(groupMembers(groupScene.find(track=>track.layerId===layerId)!.key.shapes,owner.groupId)))
     throw new Error('Prepared group no longer contains the complete original unit.');
    if(movement){
     for(const id of owner.shapeIds){
      const shape=artwork.find(shape=>shape.id===id)!;
      if(shape.x+movement.x===shape.x&&shape.y+movement.y===shape.y)
       throw new Error('Offset cannot be represented on every group member.');
     }
     candidate=translateSymbolRememberedEndpoint(candidate,library,owner.frame,
      [{layerId,shapeIds:owner.shapeIds}],movement.x,movement.y);
    }
    if(degrees!==undefined)candidate=rotateSymbolRememberedEndpoint(candidate,library,owner.frame,
     [{layerId,shapeIds:owner.shapeIds}],degrees);
    if(scaling)candidate=scaleSymbolRememberedEndpoint(candidate,library,owner.frame,
     [{layerId,shapeIds:owner.shapeIds}],scaling.x,scaling.y);
    if(skewing)candidate=skewSymbolRememberedEndpoint(candidate,library,owner.frame,
     [{layerId,shapeIds:owner.shapeIds}],skewing.axis,skewing.degrees);
    checkBudget(candidate,symbols);resolveGroup(layerId,shapeId);current();
    return structuredClone(candidate);
   },
   preparePromotion(layerId:string,shapeId:string,offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    rejectTrajectoryReentry();current();const owner=owned.resolve(layerId,shapeId);
    if(offset&&(!Number.isFinite(offset.x)||!Number.isFinite(offset.y)||(!offset.x&&!offset.y)))
      throw new Error('Enter a finite, nonzero offset.');
    if(degrees!==undefined&&(!Number.isFinite(degrees)||!degrees||degrees%360===0||degrees*Math.PI/180===0))
      throw new Error('Enter a finite rotation that changes the pose.');
    if(scale&&(!Number.isFinite(scale.x)||!Number.isFinite(scale.y)||!scale.x||!scale.y||(scale.x===1&&scale.y===1)))
      throw new Error('Enter finite nonzero scales that change the pose.');
    // Existing symbol preparation retains aggregate admission and all-pose split guards.
    let candidate=editSymbolBasicMotionSpan(definition,[layerId],owner.start,owner.end,'promote','linear',library,
      undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,owner.frame);
    if(offset){
      const shape=symbolLayers(candidate).find(l=>l.id===layerId)!.keys.find(k=>k.frame===owner.frame)!.shapes.find(s=>s.id===shapeId)!;
      if(shape.x+offset.x===shape.x&&shape.y+offset.y===shape.y)throw new Error('Offset cannot be represented on the selected artwork.');
      candidate=translateSymbolRememberedEndpoint(candidate,library,owner.frame,[{layerId,shapeIds:[shapeId]}],offset.x,offset.y);
    }
    if(degrees!==undefined)candidate=rotateSymbolRememberedEndpoint(candidate,library,owner.frame,[{layerId,shapeIds:[shapeId]}],degrees);
    if(scale)candidate=scaleSymbolRememberedEndpoint(candidate,library,owner.frame,[{layerId,shapeIds:[shapeId]}],scale.x,scale.y);
    if(skew)candidate=skewSymbolRememberedEndpoint(candidate,library,owner.frame,[{layerId,shapeIds:[shapeId]}],skew.axis,skew.degrees);
    checkBudget(candidate,symbols);current();return structuredClone(candidate);
   },
   dispose(){dead=true;owned.dispose();},
  };
 }catch(error){dead=true;capture?.dispose();throw error;}
}
