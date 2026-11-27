import {validateProject,type Project} from '../../document/src';
import type {MotionPath} from '../../document/src/motion-path';
import {captureRememberedAuthoringFrame} from './motion-owner';
import {refreshBasicMotionSpan} from './motion-spans';
import {admitRootTrajectory} from './root-trajectory';
import {snapshotTrajectoryInputs,type TrajectoryRequest,type TrajectoryOptions} from './trajectory-input';
export type {TrajectoryRequest,TrajectoryOptions} from './trajectory-input';

export interface TrajectoryAuthoringSource{project:Project;revision:number;frame:number}
function signature(source:TrajectoryAuthoringSource){
 if(!source?.project||!Number.isSafeInteger(source.revision)||source.revision<0||!Number.isSafeInteger(source.frame)||source.frame<0||source.frame>=source.project.duration)
  throw new Error('Invalid sampled root trajectory source, revision or frame.');
 function finite(value:unknown):void{
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Sampled trajectory source contains nonfinite original values.');
  if(value&&typeof value==='object')for(const child of Object.values(value))finite(child);
 }
 finite(source.project);return JSON.stringify(source.project);
}
/** A whole-route edit owns one original ungrouped root, never a partial shared
 * recipe. Public scenes/choices cannot replace private source artwork. */
export function captureRememberedTrajectoryAuthoringFrame(readSource:()=>TrajectoryAuthoringSource){
 const first=readSource(),initial={project:first.project,revision:first.revision,frame:first.frame},stamp=signature(initial);
 validateProject(initial.project);
 const project=structuredClone(initial.project);
 let dead=false,reading=false,preparing=false,capture:ReturnType<typeof captureRememberedAuthoringFrame>|undefined;
 function current(){
  if(dead)throw new Error('Sampled root trajectory capture is disposed or invalidated.');
  if(reading){dead=true;capture?.dispose();throw new Error('Sampled trajectory source cannot reenter.');}
  reading=true;
  try{
   const live=readSource();
   if(dead||live.project!==initial.project||live.revision!==initial.revision||live.frame!==initial.frame||signature(live)!==stamp)
    throw new Error('Sampled trajectory source changed. Sample the frame again.');
  }catch(error){dead=true;capture?.dispose();throw error;}
  finally{reading=false;}
 }
 try{
  capture=captureRememberedAuthoringFrame(()=>{current();return {project,revision:initial.revision};},initial.frame);
  const owned=capture,roots=structuredClone(owned.scene);
  function resolve(layerId:string,shapeId:string,path?:MotionPath){
   current();const owner=owned.resolve(layerId,shapeId),layer=project.layers.find(layer=>layer.id===owner.layerId)!;
   admitRootTrajectory(layer,owner,path);
   current();return owner;
  }
  function rejectReentry(){if(preparing){dead=true;owned.dispose();throw new Error('Root trajectory preparation cannot reenter its capture.');}}
  /** Snapshot raw controls once. Every track refreshes on a detached candidate;
   * caller owns complete enclosing/input/history publication. No options change.
   * Validators must be synchronous and must not reenter this capture. */
  function prepareTrajectories(requests:readonly TrajectoryRequest[],options:TrajectoryOptions={}){
   rejectReentry();current();preparing=true;
   try{
    const {input,validate}=snapshotTrajectoryInputs(requests,project.layers.length,options);
    const active=()=>{current();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('Root trajectory validation must be synchronous.');}current();};
    active();
    const prepared=input.map(request=>({...request,owner:resolve(request.layerId,request.shapeId,request.path)}));
    active();const candidate=structuredClone(project);
    for(const request of prepared)refreshBasicMotionSpan(candidate,[request.layerId],request.owner.start,request.owner.end,undefined,request.path);
    const output=structuredClone(candidate);validateProject(output);active();return output;
   }catch(error){if(!dead)current();throw error;}
   finally{preparing=false;}
  }
  current();return {
   get scene(){rejectReentry();current();return structuredClone(roots);},
   get choices(){rejectReentry();current();return structuredClone(owned.choices.filter(choice=>{const shapes=roots.find(track=>track.layerId===choice.layerId)!.key.shapes;return shapes.length===1&&!shapes[0].groups?.length;}));},
   resolve(layerId:string,shapeId:string){rejectReentry();return resolve(layerId,shapeId);},
   prepareTrajectories,
   prepareTrajectory(layerId:string,shapeId:string,path:MotionPath,options:TrajectoryOptions={}){return prepareTrajectories([{layerId,shapeId,path}],options);},
   dispose(){dead=true;owned.dispose();},
  };
 }catch(error){dead=true;capture?.dispose();throw error;}
}
