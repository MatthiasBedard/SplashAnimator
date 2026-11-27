import type { Project, Layer } from '../../document/src';
import { captureStagePlacements } from './stage-placements';
import type { ScriptLibrarySource } from './stage-library';
import {prepareNestedGraphics} from './nested-graphics';
import type {ScriptButtonHoverCheckpoint} from './button-input';
import { captureScriptStage, type ScriptStageInfo } from './script-stage';
import {compileScriptProgram,type ProgramDiagnostic} from './compile-program';
import {compileFrameSourceAsync} from './compile-async';
import type {DebugAction} from './isolated-frame';
import {assertBrowserScriptExecution} from './script-execution-host';
import {originalFrameLocation,type DebugSourceOrigin} from './source-location';
import {createScriptSession,ScriptFrameExecutionError,type ScriptFrameSource,type ScriptSessionCheckpoint,type ScriptRunOptions} from './session';
import {cloneScriptState,type ScriptState,type ScriptTimelineConfig} from './timeline';

export interface ScriptPreviewCheckpoint {version:1;sourceIdentity:string;session:ScriptSessionCheckpoint}

/** Preparation compiles but never executes. Only explicit run calls enter isolated workers.
 * The original TypeScript identity also binds checkpoints when different sources emit identical JS.
 */
export async function prepareScriptPreview(config:ScriptTimelineConfig,sources:readonly ScriptFrameSource[],
  state:ScriptState={},options:{signal?:AbortSignal;timeoutMs?:number;namespace?:string;stage?:ScriptStageInfo;layers?:readonly Layer[];artwork?:ScriptLibrarySource & Pick<Project,'layers'|'layerMasks'|'opacityBindings'>;validateSource?:()=>void;allowDirectButtons?:boolean;allowSound?:boolean;allowNestedGraphics?:boolean;boundedEngine?:boolean}={}){
  const {namespace,validateSource}=options;
  const boundedEngine=options.boundedEngine===true;
  let admitting=false;
  const admit=()=>{
    assertBrowserScriptExecution();
    if(!validateSource)return;if(admitting)throw new Error('Script preview admission reentered.');admitting=true;
    try{const result=validateSource() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('Script source admission must be synchronous.');}}finally{admitting=false;}
    assertBrowserScriptExecution();
  };
  if(namespace!==undefined&&(typeof namespace!=='string'||!namespace.length||new TextEncoder().encode(namespace).byteLength>256*1024))throw new Error('Invalid script program namespace.');
  admit();
  const stage=captureScriptStage(options.stage);
  const initialState=cloneScriptState(state);
  admit();
  const [result,placements]=await Promise.all([
    compileScriptProgram(config,sources,options),
    options.artwork ? captureStagePlacements(options.artwork.layers,options.artwork,options.allowDirectButtons,config.duration,options.allowNestedGraphics) : options.layers ? captureStagePlacements(options.layers) : undefined,
  ]);
  options.signal?.throwIfAborted();
  admit();
  if(!result.program)return {diagnostics:result.diagnostics,preview:undefined};
  const {config:settings,frames}=result.program;
  const original=JSON.parse(result.program.sourceIdentity).sources as ScriptFrameSource[];
  const nested=options.allowNestedGraphics===true&&options.artwork
    ? await prepareNestedGraphics(options.artwork,settings.fps,settings.seed,
      {signal:options.signal,timeoutMs:options.timeoutMs,allowDirectButtons:options.allowDirectButtons,boundedEngine},
      {duration:settings.duration,buttons:placements?.animatedButtonSpans()??[]})
    : undefined;
  if(nested){options.signal?.throwIfAborted();admit();}
  const sourceIdentity=namespace===undefined&&!boundedEngine?result.program.sourceIdentity:JSON.stringify({namespace,sourceIdentity:result.program.sourceIdentity,...(boundedEngine?{boundedEngine}:{})});
  const session=createScriptSession(settings,frames,initialState,'entry',namespace,stage,placements,options.allowSound===true,nested,boundedEngine);
  let disposed=false,active:AbortController|undefined;
  const ready=()=>{if(disposed)throw new Error('Script preview is disposed.');admit();};
  const checkpoint=():ScriptPreviewCheckpoint=>({version:1,sourceIdentity,session:session.checkpoint()});
  async function runBatch(ticks:number,options:ScriptRunOptions={}){
      ready();if(active)throw new Error('Script preview is busy.');
      const controller=new AbortController();active=controller;
      let signal:AbortSignal|undefined,timer:ReturnType<typeof setTimeout>|undefined;
      let debugMap:{frame:number;sourceMap:string;origin:DebugSourceOrigin}|undefined;
      const abort=()=>controller.abort(signal?.reason);
      try{
        const {signal:originalSignal,timeoutMs=10000,seeks,events,playback,stopAtFrames,stopWhenState,hostButtons,breakpoint}=options;
        signal=originalSignal;
        if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid preview deadline.');
        signal?.throwIfAborted();
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
        timer=setTimeout(()=>controller.abort(new Error('Script preview batch timed out.')),timeoutMs);
        let prepared,previewSeeks=seeks;
        if(breakpoint){
          const {frame,line,onPause,seek}=breakpoint,state=session.checkpoint();
          const input=original.find(source=>source.frame===frame);
          const pending=frame===state.timeline.frame&&state.entryPending;
          if(ticks!==1||seeks?.length||events?.length||playback?.length||stopAtFrames?.length||stopWhenState?.length||
            hostButtons?.length||!pending&&seek!==true||!input||typeof onPause!=='function')
            throw Error('A source breakpoint requires a pending saved frame body.');
          // The host seek and the selected body belong to one uncommitted tick.
          if(!pending)previewSeeks=[{tick:state.timeline.tick,frame,playing:false}];
          const compiled=await compileFrameSourceAsync(input.source,{signal:controller.signal,breakpointLine:line});
          ready();controller.signal.throwIfAborted();
          if(!compiled.body||!compiled.statementLocations)throw Error(compiled.diagnostics[0]?.message??'Invalid source breakpoint.');
          if(compiled.sourceMap&&compiled.debugSourceSpans)debugMap={frame,sourceMap:compiled.sourceMap,
            origin:{source:input.source,spans:compiled.debugSourceSpans}};
          prepared={frame,source:compiled.body,points:compiled.statementLocations,functions:compiled.debugFunctions??[],
            onPause(pause:Parameters<typeof onPause>[0]){
              function advance(action:DebugAction){
                try{ready();controller.signal.throwIfAborted();pause[action]?.();}
                catch(error){controller.abort(error);}
              }
              onPause({...pause,resume:()=>advance('resume'),step:()=>advance('step'),
                ...(pause.into?{into:()=>advance('into')}:{}),...(pause.out?{out:()=>advance('out')}:{})});
            }};
        }
        const output=await session.runWithPresentation(ticks,{signal:controller.signal,timeoutMs:Math.min(1000,timeoutMs),seeks:previewSeeks,events,playback,stopAtFrames,stopWhenState,hostButtons},admit,prepared);
        return {checkpoint:checkpoint(),presentation:output.presentation,seeks:output.seeks,events:output.events,playback:output.playback,stoppedAt:output.stoppedAt,stoppedOnState:output.stoppedOnState,
          ...(output.soundCues?{soundCues:output.soundCues}:{})};
      }catch(error){
        if(controller.signal.aborted)throw controller.signal.reason;
        if(error instanceof ScriptFrameExecutionError&&error.generatedLocation){
          const {line,column}=error.generatedLocation;
          if(error.instrumented){
            if(debugMap?.frame===error.frame)
              error.sourceLocation=originalFrameLocation(debugMap.sourceMap,line,column,1,debugMap.origin);
          }else{
            const map=result.program!.maps.find(map=>map.frame===error.frame);
            if(map)error.sourceLocation=originalFrameLocation(map.sourceMap,line,column,map.sourceLineOffset);
          }
          if(error.sourceLocation)error.message+=` (source line ${error.sourceLocation.line}, column ${error.sourceLocation.column}; advisory)`;
        }
        throw error;
      }
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active=undefined;}
  }
  return {diagnostics:[] as ProgramDiagnostic[],preview:Object.freeze({
    checkpoint(){ready();return checkpoint();},
    restore(value:ScriptPreviewCheckpoint){
      ready();if(active)throw new Error('Script preview is busy.');
      if(!value||value.version!==1||value.sourceIdentity!==sourceIdentity)
        throw new Error('Checkpoint belongs to different authored source.');
      session.restore(value.session,validateSource?admit:undefined);
    },
    async run(ticks:number,options:ScriptRunOptions={}){
      return (await runBatch(ticks,options)).checkpoint;
    },
    runWithPresentation:runBatch,
    retireButtonTargets(buttons:ScriptButtonHoverCheckpoint,frame:number,hidden:readonly string[]){
      return nested?.retireButtonTargets(buttons,frame,hidden)??buttons;
    },
    dispose(){disposed=true;active?.abort(new Error('Script preview disposed.'));},
  })};
}
