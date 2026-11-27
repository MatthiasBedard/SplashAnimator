import {newProject,validateProject} from '../../document/src';
import {captureRememberedAuthoringFrame} from './motion-owner';
import {captureRememberedGroupAuthoringFrame,type GroupAuthoringSource} from './group-motion-owner';
import {prepareRememberedTimelineCapture} from './motion-capture';

function signature(source:GroupAuthoringSource){
 if(!source?.project||!Number.isSafeInteger(source.revision)||source.revision<0||!Number.isSafeInteger(source.frame)||source.frame<0||source.frame>=source.project.duration)
  throw new Error('Invalid sampled root presentation source, revision or frame.');
 function finite(value:unknown):void{
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Sampled root presentation contains nonfinite original values.');
  if(value&&typeof value==='object')for(const child of Object.values(value))finite(child);
 }
 finite(source.project);return JSON.stringify(source.project);
}
/** Private original root ownership plus detached reachable-child render preparation.
 * Prepared symbols must never become authoring input; callers own UI publication. */
export function captureRememberedRootPresentation(readSource:()=>GroupAuthoringSource,groups=false){
 const first=readSource(),initial={project:first.project,revision:first.revision,frame:first.frame},stamp=signature(initial);
 validateProject(initial.project);
 const snapshot=structuredClone(initial.project);
 let dead=false,reading=false;
 let capture:ReturnType<typeof captureRememberedAuthoringFrame>|ReturnType<typeof captureRememberedGroupAuthoringFrame>|undefined;
 function current(){
  if(dead)throw new Error('Sampled root presentation is disposed or invalidated.');
  if(reading){dead=true;capture?.dispose();throw new Error('Sampled root presentation source cannot reenter.');}
  reading=true;
  try{
   const live=readSource();
   if(dead||live.project!==initial.project||live.revision!==initial.revision||live.frame!==initial.frame||signature(live)!==stamp)
    throw new Error('Sampled root presentation source changed. Sample the frame again.');
  }catch(error){dead=true;capture?.dispose();throw error;}
  finally{reading=false;}
 }
 try{
  const read=()=>{current();return {project:snapshot,revision:initial.revision,frame:initial.frame};};
  capture=groups?captureRememberedGroupAuthoringFrame(read):captureRememberedAuthoringFrame(read,initial.frame);
  const owned=capture,roots=structuredClone(owned.scene);
  current();return {
   get scene(){current();return structuredClone(roots);},
   get choices(){current();return structuredClone(owned.choices);},
   resolve(layerId:string,shapeId:string){current();const owner='resolveGroup' in owned?owned.resolveGroup(layerId,shapeId):owned.resolve(layerId,shapeId);current();return owner;},
   async preparePresentation(options:{signal?:AbortSignal;validate?:()=>void}={}){
    const {signal,validate}=options;
    const active=()=>{signal?.throwIfAborted();current();validate?.();current();signal?.throwIfAborted();};
    active();
    // A synthetic discovery frame must not replace the original root exposure ages.
    const project=newProject();project.duration=1;project.symbols=structuredClone(snapshot.symbols??[]);
    project.layers=roots.map(track=>({...structuredClone(snapshot.layers.find(layer=>layer.id===track.layerId)!),
     keys:[{frame:0,shapes:structuredClone(track.key.shapes)}],motionSpans:undefined}));
    const prepared=await prepareRememberedTimelineCapture(project,{signal,validate:active});
    validateProject(prepared);active();return {symbols:prepared.symbols??[]};
   },
   dispose(){dead=true;owned.dispose();},
  };
 }catch(error){dead=true;capture?.dispose();throw error;}
}
