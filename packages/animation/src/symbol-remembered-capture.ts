import {newProject,type SymbolDefinition} from '../../document/src';
import {symbolInstance} from '../../geometry/src/symbols';
import {captureSymbolRememberedAuthoringFrame,type SymbolAuthoringSource} from './symbol-motion-owner';
import {prepareRememberedTimelineCapture} from './motion-capture';

export type RememberedSymbolCaptureOptions={signal?:AbortSignal;validate?:()=>void};

/** Internal render-only capture. Borrowed definitions never escape the owning session. */
export async function prepareSymbolRememberedCapture(
 readSource:()=>SymbolAuthoringSource,fps:number,
 admit:(definition:SymbolDefinition,symbols:SymbolDefinition[])=>void,
 options:RememberedSymbolCaptureOptions={},
){
 const owner=captureSymbolRememberedAuthoringFrame(readSource);
 let disposed=false;
 const active=()=>{
  options.signal?.throwIfAborted();
  if(disposed)throw new Error('Remembered symbol capture is disposed.');
  void owner.scene;options.validate?.();void owner.scene;options.signal?.throwIfAborted();
 };
 const dispose=()=>{disposed=true;owner.dispose();};
 try{
  active();
  if(!Number.isFinite(fps)||fps<1||fps>120)throw new Error('Invalid remembered symbol playback frame rate.');
  const source=readSource(),definition=structuredClone(source.definition);
  const symbols=[...structuredClone(source.symbols).filter(s=>s.id!==definition.id),definition];
  admit(definition,symbols);active();
  const project=newProject();project.fps=fps;project.duration=definition.timeline?.duration??1;project.symbols=symbols;
  const instance=symbolInstance(definition,0,0);instance.id='preview';
  project.layers[0].id='root';project.layers[0].keys=[{frame:0,shapes:[instance]}];
  const prepared=await prepareRememberedTimelineCapture(project,{signal:options.signal,validate:active});
  active();
  return {project:prepared,definition:prepared.symbols!.find(s=>s.id===definition.id)!,instance,active,dispose};
 }catch(error){dispose();throw error;}
}
