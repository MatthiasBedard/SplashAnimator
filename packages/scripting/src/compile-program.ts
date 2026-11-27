import {compileFrameSourceAsync} from './compile-async';
import type {FrameDiagnostic} from './compile';
import {createScriptTimeline,type ScriptTimelineConfig} from './timeline';
import type {ScriptFrameSource} from './session';

export interface ProgramDiagnostic extends FrameDiagnostic {frame:number}
export type CompiledScriptProgram = {
  sourceIdentity:string;
  config:ScriptTimelineConfig;
  frames:ScriptFrameSource[];
  maps:{frame:number;sourceMap:string;sourceLineOffset:number}[];
};
export type ProgramCompilation = {
  diagnostics:ProgramDiagnostic[];
  checkedFrames:number;
  totalFrames:number;
  program?:CompiledScriptProgram;
};

/** Snapshot and compile serially. No executable table is returned unless every body succeeds. */
export async function compileScriptProgram(config:ScriptTimelineConfig,frames:readonly ScriptFrameSource[],
  options:{signal?:AbortSignal;timeoutMs?:number;standalone?:true}={}):Promise<ProgramCompilation>{
  const {signal,timeoutMs=30000,standalone}=options;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid program deadline.');
  signal?.throwIfAborted();
  const initial=createScriptTimeline(config).checkpoint();
  const settings={duration:initial.duration,fps:initial.fps,seed:initial.seed,
    ...(initial.frameLabels ? { frameLabels: initial.frameLabels } : {})};
  if(!Array.isArray(frames)||frames.length>10000)throw new Error('Invalid program source table.');
  const bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
  let previous=-1,sourceBytes=0;
  const sources=frames.map(entry=>{
    if(!entry||Array.isArray(entry)||!Number.isSafeInteger(entry.frame)||entry.frame<=previous||entry.frame>=settings.duration||
      typeof entry.source!=='string'||entry.source.length>256*1024)throw new Error('Invalid program source.');
    sourceBytes+=bytes(entry.source);
    if(sourceBytes>256*1024)throw new Error('Program source exceeds 256 KiB.');
    previous=entry.frame;
    return {frame:entry.frame,source:entry.source};
  });
  const sourceIdentity=JSON.stringify({version:1,...settings,sources});
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new Error('Program compilation timed out.')),timeoutMs);
  const diagnostics:ProgramDiagnostic[]=[],compiled:ScriptFrameSource[]=[],maps:CompiledScriptProgram['maps']=[];
  let checkedFrames=0,mapBytes=0,compiledBytes=0;
  try{
    for(const entry of sources){
      controller.signal.throwIfAborted();
      const result=await compileFrameSourceAsync(entry.source,{signal:controller.signal,timeoutMs,standalone});
      controller.signal.throwIfAborted();checkedFrames++;
      for(const diagnostic of result.diagnostics){
        if(diagnostics.length===100)break;
        diagnostics.push({...diagnostic,frame:entry.frame});
      }
      if(diagnostics.length===100)break;
      if(result.body!==undefined){
        compiledBytes+=bytes(JSON.stringify({frame:entry.frame,source:result.body}));
        mapBytes+=bytes(result.sourceMap??'');
        if(compiledBytes>256*1024||mapBytes>4*1024*1024)
          throw new Error(`Compiled program exceeds output budget at frame ${entry.frame+1}.`);
        compiled.push({frame:entry.frame,source:result.body});
        maps.push({frame:entry.frame,sourceMap:result.sourceMap!,sourceLineOffset:result.sourceLineOffset});
      }
    }
    controller.signal.throwIfAborted();
    if(diagnostics.length)return {diagnostics,checkedFrames,totalFrames:sources.length};
    // Match the entry-session identity budget, including JSON/configuration overhead.
    if(bytes(JSON.stringify({version:1,...settings,sources:compiled,dispatch:'entry'}))>256*1024)
      throw new Error('Compiled program exceeds session budget.');
    return {diagnostics,checkedFrames,totalFrames:sources.length,program:{sourceIdentity,config:settings,frames:compiled,maps}};
  }catch(error){
    if(controller.signal.aborted)throw controller.signal.reason;
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
