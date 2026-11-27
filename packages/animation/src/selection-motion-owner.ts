import {validateProject,type Project,type Point} from '../../document/src';
import {captureRememberedAuthoringFrame,type SampledMotionOwner} from './motion-owner';
import {captureRememberedGroupAuthoringFrame,type GroupAuthoringSource,type SampledGroupMotionOwner} from './group-motion-owner';
import {promoteSampledMotionFrame,sampleRememberedMotionFrames,refreshBasicMotionSpan} from './motion-spans';
import {translateRememberedEndpoint,rotateRememberedEndpoint,scaleRememberedEndpoint,skewRememberedEndpoint,rememberedAuthoringPivot} from './motion-junction';

import {snapshotTrajectoryInputs,type TrajectoryRequest} from './trajectory-input';
import {admitSelectionTrajectory,selectionTrajectoryStamp} from './selection-trajectory';

export interface SampledUnitRequest {layerId:string;shapeId:string}
export interface SampledSelectionOptions {validate?:()=>void}
export type SampledSelectionUnit =
 | (SampledMotionOwner & {kind:'root';shapeIds:string[]})
 | (SampledGroupMotionOwner & {kind:'group'});
export interface SampledSelectionOwner {
 frame:number;revision:number;units:SampledSelectionUnit[];
 tracks:{layerId:string;spanId:string;start:number;end:number;frame:number;shapeIds:string[]}[];
}
export interface SampledSelectionRotationOwner extends SampledSelectionOwner {pivot:Point}
export interface SampledSelectionScaleOwner extends SampledSelectionOwner {pivot:Point}
export interface SampledSelectionSkewOwner extends SampledSelectionOwner {pivot:Point}
function originalNumbers(value:unknown):void {
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('Sampled selection source contains nonfinite original values.');
 if(value&&typeof value==='object')for(const child of Object.values(value))originalNumbers(child);
}
function signature(source:GroupAuthoringSource):string {
 if(!source?.project||!Number.isSafeInteger(source.revision)||source.revision<0||
    !Number.isSafeInteger(source.frame)||source.frame<0||source.frame>=source.project.duration)
  throw Error('Invalid sampled selection source, revision or frame.');
 originalNumbers(source.project);return JSON.stringify(source.project);
}
function snapshotRequests(requests:readonly SampledUnitRequest[],maximum:number):SampledUnitRequest[] {
 if(!Array.isArray(requests))throw Error('Choose actual sampled unit requests.');
 const length=requests.length;
 if(!Number.isSafeInteger(length)||length<1||length>maximum)throw Error('Choose a nonempty selection within the original eligible artwork.');
 const result:SampledUnitRequest[]=[];
 for(let index=0;index<length;index++){
  const request=requests[index],layerId=request?.layerId,shapeId=request?.shapeId;
  if(typeof layerId!=='string'||!layerId||typeof shapeId!=='string'||!shapeId)
   throw Error('Choose existing sampled track and artwork identities.');
  result.push({layerId,shapeId});
 }
 if(requests.length!==length)throw Error('Sampled selection requests changed while being read.');
 return result;
}
/** One private document/frame owns mixed ungrouped roots and complete outer groups.
 * Public scenes, choices and returned owners are detached hints. Preparation writes
 * only a complete detached candidate; callers retain enclosing/history publication. */
export function captureRememberedSelectionAuthoringFrame(readSource:()=>GroupAuthoringSource) {
 const first=readSource(),initial={project:first.project,revision:first.revision,frame:first.frame},stamp=signature(initial);
 let dead=false,reading=false,working=false;
 let roots:ReturnType<typeof captureRememberedAuthoringFrame>|undefined;
 let groups:ReturnType<typeof captureRememberedGroupAuthoringFrame>|undefined;
 function dispose(){dead=true;roots?.dispose();groups?.dispose();}
 function current(expectedDataStamp?:string){
  if(dead)throw Error('Sampled selection capture is disposed or invalidated.');
  if(reading){dispose();throw Error('Sampled selection source cannot reenter.');}
  reading=true;
  try{
   const raw=readSource(),live={project:raw.project,revision:raw.revision,frame:raw.frame};
   if(dead||live.project!==initial.project||live.revision!==initial.revision||live.frame!==initial.frame||signature(live)!==stamp||expectedDataStamp!==undefined&&selectionTrajectoryStamp(live.project)!==expectedDataStamp)
    throw Error('Sampled selection source changed. Sample the frame again.');
  }catch(error){dispose();throw error;}finally{reading=false;}
 }
 function operation<T>(run:()=>T):T {
  if(working){dispose();throw Error('Sampled selection preparation cannot reenter.');}
  current();working=true;
  try{return run();}catch(error){if(!dead)current();throw error;}finally{working=false;}
 }
 try{
  validateProject(initial.project);current();
  const project=structuredClone(initial.project);current();validateProject(project);current();
  const readPrivate=()=>{current();return {project,revision:initial.revision,frame:initial.frame};};
  roots=captureRememberedAuthoringFrame(readPrivate,initial.frame);
  const owned=roots,scene=structuredClone(owned.scene);current();
  const layerOrder=new Map(project.layers.map((layer,index)=>[layer.id,index]));
  function active(validate?:()=>void){
   current();const result=validate?.() as unknown;
   if(result&&typeof(result as PromiseLike<unknown>).then==='function'){
    void Promise.resolve(result).catch(()=>{});throw Error('Sampled selection validation must be synchronous.');
   }
   current();
  }
  function snapshotOptions(options:SampledSelectionOptions){
   if(!options||typeof options!=='object')throw Error('Invalid sampled selection options.');
   const validate=options.validate;
   if(validate!==undefined&&typeof validate!=='function')throw Error('Sampled selection validation must be callable.');
   return validate;
  }
  function resolve(input:readonly SampledUnitRequest[],validate?:()=>void):SampledSelectionOwner {
   active(validate);
   const units:SampledSelectionUnit[]=[],used=new Set<string>();
   for(const request of input){
    const layer=project.layers.find(layer=>layer.id===request.layerId);
    if(!layer||!layer.visible||layer.locked||layer.drawingMode==='merge')
     throw Error('Sampled selection requires visible unlocked object tracks.');
    const root=owned.resolve(request.layerId,request.shapeId),shapes=scene.find(track=>track.layerId===root.layerId)!.key.shapes;
    const shape=shapes.find(shape=>shape.id===root.shapeId)!,groupId=shape.groups?.[0];
    let unit:SampledSelectionUnit;
    if(groupId){
     groups??=captureRememberedGroupAuthoringFrame(readPrivate);
     const owner=groups.resolveGroup(root.layerId,root.shapeId);
     unit={...owner,kind:'group',shapeId:owner.shapeIds[0],shapeIds:[...owner.shapeIds]};
    }else{
     const [sample]=sampleRememberedMotionFrames(project,[root.layerId],root.start,root.end,root.frame);
     for(const artwork of [sample.shapes,...[root.start,root.frame,root.end].map(frame=>layer.keys.find(key=>key.frame===frame)!.shapes)])
      if(artwork.find(shape=>shape.id===root.shapeId)?.groups?.length)
       throw Error('The sampled root does not retain its original ungrouped scope.');
     unit={...root,kind:'root',shapeIds:[root.shapeId]};
    }
    for(const id of unit.shapeIds){
     const key=JSON.stringify([unit.layerId,id]);if(used.has(key))throw Error('Sampled selection units overlap or repeat.');used.add(key);
    }
    units.push(unit);active(validate);
   }
   units.sort((a,b)=>layerOrder.get(a.layerId)!-layerOrder.get(b.layerId)!||
    scene.find(track=>track.layerId===a.layerId)!.key.shapes.findIndex(shape=>shape.id===a.shapeId)-
    scene.find(track=>track.layerId===b.layerId)!.key.shapes.findIndex(shape=>shape.id===b.shapeId));
   const tracks:SampledSelectionOwner['tracks']=[];
   for(const layer of project.layers){
    const members=units.filter(unit=>unit.layerId===layer.id);if(!members.length)continue;
    const first=members[0];
    if(members.some(unit=>unit.spanId!==first.spanId||unit.start!==first.start||unit.end!==first.end))
     throw Error('Selected track units no longer share one original recipe.');
    const ids=new Set(members.flatMap(unit=>unit.shapeIds));
    tracks.push({layerId:layer.id,spanId:first.spanId,start:first.start,end:first.end,frame:first.frame,
     shapeIds:scene.find(track=>track.layerId===layer.id)!.key.shapes.filter(shape=>ids.has(shape.id)).map(shape=>shape.id)});
   }
   active(validate);return {frame:initial.frame,revision:initial.revision,units,tracks};
  }
  function admitSavedOptions(candidate:Project,owner:SampledSelectionOwner){
   const guards=['rigidGroups','uniformGroupScale','axisGroupScale','axisGroupShear','savedGroupPivots'] as const;
   for(const track of owner.tracks){
    const original=project.layers.find(layer=>layer.id===track.layerId)!.motionSpans!.find(span=>span.id===track.spanId)!;
    const halves=candidate.layers.find(layer=>layer.id===track.layerId)!.motionSpans!.filter(span=>span.start===track.start&&span.end===owner.frame||span.start===owner.frame&&span.end===track.end);
    if(halves.length!==2||halves.some(span=>JSON.stringify(span.options)!==JSON.stringify(original.options)||guards.some(name=>span.rotation?.[name]!==original.rotation?.[name])))
     throw Error('Saved recipe options must already admit complete selection promotion.');
   }
  }
  function transformOwner(input:readonly SampledUnitRequest[],validate?:()=>void):SampledSelectionOwner&{pivot:Point}{
   const owner=resolve(input,validate);
   const members=owner.tracks.flatMap(track=>scene.find(item=>item.layerId===track.layerId)!.key.shapes.filter(shape=>track.shapeIds.includes(shape.id)));
   const pivot=rememberedAuthoringPivot(members);active(validate);
   return {...owner,pivot};
  }
  function recipeSettings(candidate:Project,owner:SampledSelectionOwner){
   return JSON.stringify(owner.tracks.map(track=>candidate.layers.find(layer=>layer.id===track.layerId)!.motionSpans?.map(span=>
    Object.fromEntries(Object.entries(span).filter(([key])=>key!=='baseline')))));
  }
  function detachedOwner<Owner extends SampledSelectionOwner>(owner:Owner,validate?:()=>void){const output=structuredClone(owner);active(validate);return output;}
  current();return {
   get scene(){return operation(()=>{const output=structuredClone(scene);current();return output;});},
   get choices(){return operation(()=>{
    const hints:SampledUnitRequest[]=[],seen=new Set<string>();
    for(const choice of owned.choices){
     const layer=project.layers.find(layer=>layer.id===choice.layerId)!;if(layer.drawingMode==='merge')continue;
     const shapes=scene.find(track=>track.layerId===choice.layerId)!.key.shapes,shape=shapes.find(shape=>shape.id===choice.shapeId)!;
     const groupId=shape.groups?.[0],shapeId=groupId?shapes.find(shape=>shape.groups?.[0]===groupId)!.id:shape.id;
     const key=JSON.stringify([choice.layerId,shapeId]);if(!seen.has(key)){seen.add(key);hints.push({layerId:choice.layerId,shapeId});}
    }
    const output=structuredClone(hints);current();return output;
   });},
   resolveSelection(requests:readonly SampledUnitRequest[],options:SampledSelectionOptions={}){
    return operation(()=>{const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);active(validate);return detachedOwner(resolve(input,validate),validate);});
   },
   /** Replace complete original recipes without promoting the sampled frame.
    * Select original units separately from one canonical leader/path per track.
    * Returned projects are detached; callers own enclosing/history publication. */
   prepareTrajectories(requests:readonly SampledUnitRequest[],trajectories:readonly TrajectoryRequest[],options:SampledSelectionOptions={}):Project{
    return operation(()=>{
     const originalStamp=selectionTrajectoryStamp(project);current(originalStamp);
     const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);
     const paths=snapshotTrajectoryInputs(trajectories,project.layers.length,{validate},'selection').input;
     active(validate);
     const owner=resolve(input,validate);
     if(paths.length!==owner.tracks.length)throw Error('Choose one explicit path for every selected original track.');
     // Admit every original track before writing even the detached candidate.
     const prepared=owner.tracks.map(track=>{
      const request=paths.find(path=>path.layerId===track.layerId);
      if(!request||request.shapeId!==track.shapeIds[0])throw Error('Choose the original canonical recipe leader for each selection path.');
      const layer=project.layers.find(layer=>layer.id===track.layerId)!;
      admitSelectionTrajectory(layer,track,request.path);
      return {...request,track};
     });
     active(validate);
     const candidate=structuredClone(project);
     originalNumbers(candidate);validateProject(candidate);
     if(selectionTrajectoryStamp(candidate)!==originalStamp)throw Error('Original selection trajectory candidate changed during cloning.');
     active(validate);originalNumbers(candidate);
     if(selectionTrajectoryStamp(candidate)!==originalStamp)throw Error('Original selection trajectory candidate changed during enclosing admission.');
     for(const request of prepared)refreshBasicMotionSpan(candidate,[request.layerId],request.track.start,request.track.end,undefined,request.path);
     originalNumbers(candidate);validateProject(candidate);
     const outputStamp=selectionTrajectoryStamp(candidate);active(validate);originalNumbers(candidate);
     if(selectionTrajectoryStamp(candidate)!==outputStamp)throw Error('Prepared selection trajectories changed during enclosing admission.');
     const output=structuredClone(candidate);active(validate);
     originalNumbers(output);validateProject(output);
     if(selectionTrajectoryStamp(output)!==outputStamp)throw Error('Prepared selection trajectories changed during final cloning.');
     const finalOwner=resolve(input,validate);
     if(JSON.stringify(finalOwner)!==JSON.stringify(owner))throw Error('The original complete trajectory selection changed during preparation.');
     active(validate);
     originalNumbers(output);validateProject(output);current(originalStamp);originalNumbers(output);
     if(selectionTrajectoryStamp(output)!==outputStamp)throw Error('Prepared selection trajectories changed during final ownership admission.');
     return output;
    });
   },
   resolveRotation(requests:readonly SampledUnitRequest[],options:SampledSelectionOptions={}):SampledSelectionRotationOwner{
    return operation(()=>{const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);active(validate);return detachedOwner(transformOwner(input,validate),validate);});
   },
   prepareRotation(requests:readonly SampledUnitRequest[],degrees:number,options:SampledSelectionOptions={}):Project{
    return operation(()=>{
     const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);
     active(validate);
     if(!Number.isFinite(degrees)||!degrees||degrees%360===0||!Number.isFinite(degrees*Math.PI/180)||degrees*Math.PI/180===0)
      throw Error('Enter a finite rotation that changes the sampled selection.');
     const owner=transformOwner(input,validate),candidate=structuredClone(project);active(validate);
     for(const track of owner.tracks)promoteSampledMotionFrame(candidate,[track.layerId],track.start,track.end,owner.frame);
     admitSavedOptions(candidate,owner);
     // A split may legitimately repartition extra turns. Freeze its actual
     // derived headers rather than copying original turn counts into both halves.
     const settings=recipeSettings(candidate,owner);
     for(const unit of owner.units){
      const artwork=candidate.layers.find(layer=>layer.id===unit.layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
      const members=artwork.filter(shape=>unit.shapeIds.includes(shape.id));
      if(members.length!==unit.shapeIds.length||members.some((shape,index)=>shape.id!==unit.shapeIds[index]))
       throw Error('Prepared rotation no longer owns its complete original artwork order.');
      for(const shape of members){const original=scene.find(track=>track.layerId===unit.layerId)!.key.shapes.find(original=>original.id===shape.id)!;
       if(JSON.stringify(shape.groups)!==JSON.stringify(original.groups))throw Error('Prepared rotation ancestry changed.');}
     }
     active(validate);
     rotateRememberedEndpoint(candidate,owner.frame,owner.tracks,degrees,owner.pivot);
     validateProject(candidate);admitSavedOptions(candidate,owner);active(validate);
     if(recipeSettings(candidate,owner)!==settings)throw Error('Saved rotation recipe metadata changed during preparation.');
     const outputStamp=JSON.stringify(candidate),output=structuredClone(candidate);active(validate);
     validateProject(output);admitSavedOptions(output,owner);
     if(recipeSettings(output,owner)!==settings)throw Error('Saved rotation recipe metadata changed during final cloning.');
     if(JSON.stringify(output)!==outputStamp)throw Error('Prepared rotation changed during final cloning.');
     const finalOwner=transformOwner(input,validate);
     if(JSON.stringify(finalOwner)!==JSON.stringify(owner))throw Error('The original sampled rotation selection changed during preparation.');
     active(validate);return output;
    });
   },
   resolveScale(requests:readonly SampledUnitRequest[],options:SampledSelectionOptions={}):SampledSelectionScaleOwner{
    return operation(()=>{const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);active(validate);return detachedOwner(transformOwner(input,validate),validate);});
   },
   prepareScale(requests:readonly SampledUnitRequest[],scaleX:number,scaleY:number,options:SampledSelectionOptions={}):Project{
    return operation(()=>{
     const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);
     active(validate);
     if(![scaleX,scaleY].every(Number.isFinite)||!scaleX||!scaleY||(scaleX===1&&scaleY===1))
      throw Error('Enter finite nonzero scales that change the sampled selection.');
     const owner=transformOwner(input,validate),candidate=structuredClone(project);active(validate);
     for(const track of owner.tracks)promoteSampledMotionFrame(candidate,[track.layerId],track.start,track.end,owner.frame);
     admitSavedOptions(candidate,owner);
     // A split may legitimately repartition extra turns. Freeze its actual
     // derived headers rather than copying original turn counts into both halves.
     const settings=recipeSettings(candidate,owner);
     for(const unit of owner.units){
      const artwork=candidate.layers.find(layer=>layer.id===unit.layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
      const members=artwork.filter(shape=>unit.shapeIds.includes(shape.id));
      if(members.length!==unit.shapeIds.length||members.some((shape,index)=>shape.id!==unit.shapeIds[index]))
       throw Error('Prepared scaling no longer owns its complete original artwork order.');
      for(const shape of members){const original=scene.find(track=>track.layerId===unit.layerId)!.key.shapes.find(original=>original.id===shape.id)!;
       if(JSON.stringify(shape.groups)!==JSON.stringify(original.groups))throw Error('Prepared scaling ancestry changed.');}
     }
     active(validate);
     scaleRememberedEndpoint(candidate,owner.frame,owner.tracks,scaleX,scaleY,owner.pivot);
     validateProject(candidate);admitSavedOptions(candidate,owner);active(validate);
     if(recipeSettings(candidate,owner)!==settings)throw Error('Saved scaling recipe metadata changed during preparation.');
     const outputStamp=JSON.stringify(candidate),output=structuredClone(candidate);active(validate);
     validateProject(output);admitSavedOptions(output,owner);
     if(recipeSettings(output,owner)!==settings)throw Error('Saved scaling recipe metadata changed during final cloning.');
     if(JSON.stringify(output)!==outputStamp)throw Error('Prepared scaling changed during final cloning.');
     const finalOwner=transformOwner(input,validate);
     if(JSON.stringify(finalOwner)!==JSON.stringify(owner))throw Error('The original sampled scaling selection changed during preparation.');
     active(validate);
     // Final ownership/enclosing callbacks must not alter the detached output
     // after its first clone admission. Validate/hash after the last callback.
     originalNumbers(output);validateProject(output);admitSavedOptions(output,owner);
     current();
     if(recipeSettings(output,owner)!==settings||JSON.stringify(output)!==outputStamp)
      throw Error('Prepared scaling changed during final ownership admission.');
     return output;
    });
   },
   resolveSkew(requests:readonly SampledUnitRequest[],options:SampledSelectionOptions={}):SampledSelectionSkewOwner{
    return operation(()=>{const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);active(validate);return detachedOwner(transformOwner(input,validate),validate);});
   },
   prepareSkew(requests:readonly SampledUnitRequest[],axis:'x'|'y',degrees:number,options:SampledSelectionOptions={}):Project{
    return operation(()=>{
     const input=snapshotRequests(requests,owned.choices.length),validate=snapshotOptions(options);
     active(validate);
     if(!['x','y'].includes(axis)||!Number.isFinite(degrees)||degrees%180===0)
      throw Error('Choose a skew axis and a finite angle that changes the sampled selection.');
     const radians=degrees*Math.PI/180;
     if(!Number.isFinite(radians)||Math.abs(Math.cos(radians))<1e-8||!Number.isFinite(Math.tan(radians))||Math.tan(radians)===0)
      throw Error('Skew exceeds resolvable finite angles.');
     const owner=transformOwner(input,validate),candidate=structuredClone(project);active(validate);
     for(const track of owner.tracks)promoteSampledMotionFrame(candidate,[track.layerId],track.start,track.end,owner.frame);
     admitSavedOptions(candidate,owner);
     // A split may legitimately repartition extra turns. Freeze its actual
     // derived headers rather than copying original turn counts into both halves.
     const settings=recipeSettings(candidate,owner);
     for(const unit of owner.units){
      const artwork=candidate.layers.find(layer=>layer.id===unit.layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
      const members=artwork.filter(shape=>unit.shapeIds.includes(shape.id));
      if(members.length!==unit.shapeIds.length||members.some((shape,index)=>shape.id!==unit.shapeIds[index]))
       throw Error('Prepared shearing no longer owns its complete original artwork order.');
      for(const shape of members){const original=scene.find(track=>track.layerId===unit.layerId)!.key.shapes.find(original=>original.id===shape.id)!;
       if(JSON.stringify(shape.groups)!==JSON.stringify(original.groups))throw Error('Prepared shearing ancestry changed.');}
     }
     active(validate);
     skewRememberedEndpoint(candidate,owner.frame,owner.tracks,axis,degrees,owner.pivot);
     validateProject(candidate);admitSavedOptions(candidate,owner);active(validate);
     if(recipeSettings(candidate,owner)!==settings)throw Error('Saved shearing recipe metadata changed during preparation.');
     const outputStamp=JSON.stringify(candidate),output=structuredClone(candidate);active(validate);
     validateProject(output);admitSavedOptions(output,owner);
     if(recipeSettings(output,owner)!==settings)throw Error('Saved shearing recipe metadata changed during final cloning.');
     if(JSON.stringify(output)!==outputStamp)throw Error('Prepared shearing changed during final cloning.');
     const finalOwner=transformOwner(input,validate);
     if(JSON.stringify(finalOwner)!==JSON.stringify(owner))throw Error('The original sampled shearing selection changed during preparation.');
     active(validate);
     // Final ownership/enclosing callbacks must not alter the detached output
     // after its first clone admission. Validate/hash after the last callback.
     originalNumbers(output);validateProject(output);admitSavedOptions(output,owner);
     current();
     originalNumbers(output);
     if(recipeSettings(output,owner)!==settings||JSON.stringify(output)!==outputStamp)
      throw Error('Prepared shearing changed during final ownership admission.');
     return output;
    });
   },
   prepareTranslation(requests:readonly SampledUnitRequest[],offset:Point,options:SampledSelectionOptions={}):Project {
    return operation(()=>{
     const input=snapshotRequests(requests,owned.choices.length),x=offset?.x,y=offset?.y,validate=snapshotOptions(options);
     active(validate);
     if(!Number.isFinite(x)||!Number.isFinite(y)||(!x&&!y))throw Error('Enter a finite nonzero document offset.');
     const owner=resolve(input,validate),candidate=structuredClone(project);active(validate);
     // Each original track is promoted once, even when it owns several selected units.
     for(const track of owner.tracks)promoteSampledMotionFrame(candidate,[track.layerId],track.start,track.end,owner.frame);
     admitSavedOptions(candidate,owner);
     for(const unit of owner.units){
      const artwork=candidate.layers.find(layer=>layer.id===unit.layerId)!.keys.find(key=>key.frame===owner.frame)!.shapes;
      const members=artwork.filter(shape=>unit.shapeIds.includes(shape.id));
      if(members.length!==unit.shapeIds.length||members.some((shape,index)=>shape.id!==unit.shapeIds[index]))
       throw Error('Prepared selection no longer owns its original artwork order.');
      for(const shape of members){
       const original=scene.find(track=>track.layerId===unit.layerId)!.key.shapes.find(original=>original.id===shape.id)!;
       if(JSON.stringify(shape.groups)!==JSON.stringify(original.groups))throw Error('Prepared selection ancestry changed.');
       if(shape.x+x===shape.x&&shape.y+y===shape.y)throw Error('Offset cannot be represented on every selected member.');
      }
     }
     active(validate);
     translateRememberedEndpoint(candidate,owner.frame,owner.tracks.map(track=>({layerId:track.layerId,shapeIds:track.shapeIds})),x,y);
     validateProject(candidate);admitSavedOptions(candidate,owner);active(validate);
     const finalOwner=resolve(input,validate);
     if(JSON.stringify(finalOwner)!==JSON.stringify(owner))throw Error('The original sampled selection changed during preparation.');
     active(validate);return candidate;
    });
   },
   assertCurrent(){operation(current);},
   dispose,
  };
 }catch(error){dispose();throw error;}
}
