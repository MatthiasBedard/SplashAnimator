import { hiddenPlacementsKey, hiddenPlacementKeys } from './stage-visibility';
import { placementTransformsKey } from './stage-transform';
import { readPlacementTransforms, replayTransformByteLimit, type TransformEntry } from '../../animation/src/placement-transform';
import { readSpawnedGraphics, replaySpawnByteLimit, spawnedGraphicsKey, type SpawnedGraphic } from '../../animation/src/spawn-artwork';
import type { StagePlacements } from './stage-placements';
import { captureScriptStage, type ScriptStageInfo } from './script-stage';
import {cloneScriptState,createScriptTimeline,type ScriptState,type ScriptTimelineConfig,type ScriptTimelineCheckpoint} from './timeline';
import {executeIsolatedFrameWithState,IsolatedFrameError,type FramePause} from './isolated-frame';
import type {FrameBreakpoint,DebugFunction} from './compile';
import {captureScriptTextInput,prepareScriptTextInputState,type ScriptTextInput} from './input-text';
import {MAX_SCRIPT_SOUND_CUES,scriptSoundKey,type ScriptSoundCue} from './stage-sound';
import type {NestedGraphics,NestedGraphicState,NestedMovieParents} from './nested-graphics';
import {copyScriptButtonHover,copyScriptButtonHoverInput,type ScriptButtonHoverCheckpoint,type ScriptButtonHoverInput} from './button-input';
import {captureDynamicTextValues} from '../../document/src/dynamic-text';
import {scriptTextStateKey} from './dynamic-text';

export interface ScriptFrameSource {frame:number;source:string}
/** Explicit host input, applied before the body at this absolute host tick. */
export interface ScriptSeekInput {tick:number;frame:number;playing:boolean}
/** Applied before dispatch without creating a new frame entry. */
export interface ScriptPlaybackInput {tick:number;playing:boolean}
export interface ScriptDataInput {tick:number;data:ScriptState;textInput?:ScriptTextInput}
export type ScriptStateComparison = 'lt'|'lte'|'gt'|'gte';
export type ScriptStateStop = {path:readonly string[];equals:null|boolean|number|string;comparison?:never;value?:never;changed?:never}
  | {path:readonly string[];comparison:ScriptStateComparison;value:number;equals?:never;changed?:never}
  | {path:readonly string[];changed:true;equals?:never;comparison?:never;value?:never};
/** Separate from script JSON. Only the preview host supplies snapshot-verified pointers. */
export interface ScriptHostButtonInput {tick:number;pointer:ScriptButtonHoverInput}
export type ScriptPause = FramePause & {frame:number;tick:number};
export type ScriptBreakpoint = {frame:number;line:number;seek?:true;onPause:(pause:ScriptPause)=>void};
type PreparedBreakpoint = {frame:number;source:string;points:readonly FrameBreakpoint[];functions:readonly DebugFunction[];onPause:ScriptBreakpoint['onPause']};
export interface ScriptRunOptions {signal?:AbortSignal;timeoutMs?:number;seeks?:readonly ScriptSeekInput[];events?:readonly ScriptDataInput[];playback?:readonly ScriptPlaybackInput[];stopAtFrames?:readonly number[];stopWhenState?:readonly ScriptStateStop[];hostButtons?:readonly ScriptHostButtonInput[];breakpoint?:ScriptBreakpoint}
/** Data-only primitive predicates against validated JSON state; never evaluates source.
 * Missing values differ from null. Array paths use canonical numeric indices only. */
function captureStateStops(input:readonly ScriptStateStop[]|undefined):ScriptStateStop[]{
 if(input===undefined)return [];
 if(!Array.isArray(input))throw new Error('Invalid script state stops.');
 const count=input.length;
 if(!Number.isSafeInteger(count)||count<0||count>32)throw new Error('Invalid script state stops.');
 const result:ScriptStateStop[]=[];
 for(let i=0;i<count;i++){
  const condition=input[i];
  if(!condition||typeof condition!=='object'||Array.isArray(condition))throw new Error('Invalid script state stop.');
  const keys=Reflect.ownKeys(condition),ordered=keys.includes('comparison'),changed=keys.includes('changed');
  if(keys.length!==3&&ordered||keys.length!==2&&!ordered||keys.some(key=>!['path',...(ordered?['comparison','value']:changed?['changed']:['equals'])].includes(key as string)))throw new Error('Invalid script state stop.');
  const path=condition.path;
  if(!Array.isArray(path))throw new Error('Invalid script state stop path.');
  const length=path.length;
  if(!Number.isSafeInteger(length)||length<1||length>16)throw new Error('Invalid script state stop path.');
  const owned:string[]=[];
  for(let j=0;j<length;j++){
   const key=path[j];
   if(typeof key!=='string'||key.length>128||['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid script state stop path.');
   owned.push(key);
  }
  if(changed){
   if(condition.changed!==true||ordered)throw new Error('Invalid changed script state stop.');
   result.push({path:owned,changed:true});
  }else if(ordered){
   const {comparison,value}=condition;
   if(!['lt','lte','gt','gte'].includes(comparison as string)||typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid numeric script state stop.');
   result.push({path:owned,comparison:comparison as ScriptStateComparison,value});
  }else{
   const {equals}=condition;
   if(!(equals===null||typeof equals==='boolean'||typeof equals==='number'&&Number.isFinite(equals)||typeof equals==='string'&&equals.length<=1024))throw new Error('Invalid script state stop value.');
   result.push({path:owned,equals});
  }
 }
 return result;
}
// One run owns one primitive/presence baseline. Missing differs from JSON null;
// containers are never serialized repeatedly or compared by mutable identity.
const missingStateValue=Symbol('missing script state value');
function stateStopValue(state:ScriptState,path:readonly string[]):unknown{
 let value:unknown=state;
 for(const key of path){
  if(value===null||typeof value!=='object'||Array.isArray(value)&&!/^(0|[1-9][0-9]*)$/.test(key)||!Object.prototype.hasOwnProperty.call(value,key))return missingStateValue;
  value=(value as Record<string,unknown>)[key];
 }
 return value;
}
function matchingStateStops(state:ScriptState,conditions:readonly ScriptStateStop[],baselines:readonly unknown[]){
 const matches:number[]=[];
 conditions.forEach((condition,index)=>{
  const value=stateStopValue(state,condition.path);
  if(condition.changed===true){
   if(value!==baselines[index])matches.push(index);
  }else if(value===missingStateValue)return;
  else if(condition.comparison!==undefined){
   if(typeof value!=='number'||!Number.isFinite(value))return;
   const target=condition.value,op=condition.comparison;
   if(op==='lt'?value<target:op==='lte'?value<=target:op==='gt'?value>target:value>=target)matches.push(index);
  }else if(value===condition.equals)matches.push(index);
 });
 return matches;
}
/** Host-owned location of a failed dispatch, before any script seek or state changes.
 * Frames and ticks are zero-based; messages use one-based frame labels for the editor.
 * This is not a source line/column or an assertion that the script itself caused the failure.
 */
export class ScriptFrameExecutionError extends Error {
  generatedLocation?:{line:number;column:number};
  sourceLocation?:{line:number;column:number};
  constructor(readonly frame:number,readonly tick:number,error:unknown,readonly instrumented=false){
    const detail=(error instanceof Error?error.message:typeof error==='string'?error:'Unknown execution failure').slice(0,2000);
    super(`Frame ${frame+1}, tick ${tick}: ${detail}`);
    this.name='ScriptFrameExecutionError';
    if(error instanceof IsolatedFrameError)this.generatedLocation=error.generatedLocation;
  }
}
export interface ScriptPresentationSample {frame:number;tick:number;playing:boolean;entryPending?:boolean;hiddenPlacements?:string[];retiredMovieButtons?:string[];textValues?:Record<string,string>|null;placementTransforms?:TransformEntry[];spawnedGraphics?:SpawnedGraphic[]}
export interface ScriptSessionCheckpoint {
  version:1;
  /** Exact canonical source/config identity, not a collision-prone hash. */
  program:string;
  timeline:ScriptTimelineCheckpoint;
  state:ScriptState;
  /** Present only for opt-in entry dispatch; persisted to avoid repeating stopped bodies. */
  entryPending?:boolean;
  nestedGraphics?:NestedGraphicState;
  nestedButtons?:ScriptButtonHoverCheckpoint;
  nestedMovieParents?:NestedMovieParents;
}

/** Tick mode preserves the original repeat-on-stopped-tick contract. Opt-in entry mode
 * runs once per arrival; seeks defer destination dispatch until the next host tick,
 * including same-frame seeks. Stopped ticks do not repeat a completed entry.
 * Neither mode recursively dispatches seeks or guarantees arbitrary-JS determinism.
 */
export function createScriptSession(config:ScriptTimelineConfig,frames:readonly ScriptFrameSource[],state:ScriptState={},dispatch:'tick'|'entry'='tick',namespace?:string,stageInfo?:ScriptStageInfo,placements?:StagePlacements,allowSound=false,nested?:NestedGraphics,boundedEngine=false,openBoundedEngine?:()=>Worker){
  if(nested&&nested.boundedEngine!==boundedEngine)throw Error('Placed scripts must use the preview execution mode.');
  const stage=captureScriptStage(stageInfo);
  if(namespace!==undefined&&(typeof namespace!=='string'||!namespace.length))throw new Error('Invalid script program namespace.');
  if(dispatch!=='tick'&&dispatch!=='entry')throw new Error('Invalid script dispatch mode.');
  const timeline=createScriptTimeline(config).checkpoint();
  if(!Array.isArray(frames)||frames.length>10000)throw new Error('Invalid script frame table.');
  const sources=frames.map(entry=>{
    if(!entry||!Number.isSafeInteger(entry.frame)||entry.frame<0||entry.frame>=timeline.duration||typeof entry.source!=='string')
      throw new Error('Invalid script frame source.');
    return {frame:entry.frame,source:entry.source};
  }).sort((a,b)=>a.frame-b.frame);
  if(sources.some((entry,index)=>index>0&&entry.frame===sources[index-1].frame))
    throw new Error('Duplicate script frame source.');
  const program=JSON.stringify({version:1,duration:timeline.duration,fps:timeline.fps,seed:timeline.seed,
    ...(timeline.frameLabels ? { frameLabels: timeline.frameLabels } : {}),
    sources,...(placements?{placements:placements.identity}:{}),...(stage?{stage}:{}),...(dispatch==='entry'?{dispatch}:{}),...(namespace!==undefined?{namespace}:{}),...(allowSound?{allowSound}:{}),...(nested?{nested:nested.identity}:{}),...(boundedEngine?{boundedEngine}:{})});
  if(new TextEncoder().encode(program).byteLength>256*1024)throw new Error('Script program exceeds 256 KiB.');
  const table=new Map(sources.map(entry=>[entry.frame,entry.source]));
  let current:ScriptSessionCheckpoint={version:1,program,timeline,state:cloneScriptState(state),...(dispatch==='entry'?{entryPending:true}:{}),...(nested?{nestedGraphics:[]}:{}),
    ...(nested?.hasButtons?{nestedButtons:{version:1,press:{version:1,pressed:null},hover:null}}:{}),
    ...(nested?.hasMovieParents?{nestedMovieParents:[]}:{})};
  let running=false;
  function copy(value:ScriptSessionCheckpoint):ScriptSessionCheckpoint{
    if(!value||value.version!==1||value.program!==program)throw new Error('Checkpoint belongs to a different script program.');
    if(dispatch==='entry'?typeof value.entryPending!=='boolean':value.entryPending!==undefined)
      throw new Error('Invalid script entry checkpoint.');
    const validator=createScriptTimeline(timeline);
    validator.restore(value.timeline);
    if(dispatch==='entry'&&!value.entryPending&&validator.api.playing)
      throw new Error('Playing entry checkpoint must have a pending entry.');
    const nestedField=Object.getOwnPropertyDescriptor(value,'nestedGraphics');
    if(!nested&&nestedField)throw Error('Unexpected nested graphic checkpoint.');
    if(nested&&(!nestedField?.enumerable||!('value' in nestedField)))throw Error('Invalid nested graphic checkpoint.');
    const buttonField=Object.getOwnPropertyDescriptor(value,'nestedButtons');
    if(!nested?.hasButtons&&buttonField)throw Error('Unexpected nested button checkpoint.');
    if(nested?.hasButtons&&(!buttonField?.enumerable||!('value' in buttonField)))throw Error('Invalid nested button checkpoint.');
    const parentField=Object.getOwnPropertyDescriptor(value,'nestedMovieParents');
    if(!nested?.hasMovieParents&&parentField)throw Error('Unexpected Movie parent checkpoint.');
    if(nested?.hasMovieParents&&(!parentField?.enumerable||!('value' in parentField)))throw Error('Invalid Movie parent checkpoint.');
    const position=validator.checkpoint();
    return {version:1,program,timeline:position,state:cloneScriptState(value.state),...(dispatch==='entry'?{entryPending:value.entryPending}:{}),
      ...(nested?{nestedGraphics:nested.copy(nestedField?.value,position.tick)}:{}),
      ...(nested?.hasButtons?{nestedButtons:copyScriptButtonHover(buttonField?.value)}:{}),
      ...(nested?.hasMovieParents?{nestedMovieParents:nested.copyMovieParents(parentField?.value,position.tick)}:{})};
  }
  async function runBatch(ticks:number,options:ScriptRunOptions={},validateSource?:()=>void,breakpoint?:PreparedBreakpoint){
      const admit=()=>{if(validateSource){const result=validateSource() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('Script source admission must be synchronous.');}}};
      if(running)throw new Error('Script session is busy.');
      if(!Number.isSafeInteger(ticks)||ticks<0||ticks>1000)throw new Error('Run between zero and 1000 script ticks.');
      if(breakpoint&&(ticks!==1||!table.has(breakpoint.frame)))
        throw Error('A source breakpoint requires a pending saved frame body.');
      running=true;
      try{
      const stops=options.stopAtFrames===undefined?[]:options.stopAtFrames;
      if(!Array.isArray(stops)||stops.length>1000||Array.from(stops).some(frame=>!Number.isSafeInteger(frame)||frame<0||frame>=timeline.duration))
        throw new Error('Invalid script stop frames.');
      const stopFrames=new Set(stops),stateStops=captureStateStops(options.stopWhenState);
      const execution={signal:options.signal,timeoutMs:options.timeoutMs};
      execution.signal?.throwIfAborted();
      const input=options.seeks??[];
      if(!Array.isArray(input)||input.length>1000)throw new Error('Invalid script seek inputs.');
      // Capture and validate the complete input batch before any execution or yield.
      // Reject duplicate/out-of-order ticks instead of inventing ordering.
      const seeks=input.map(value=>{
        if(!value)throw new Error('Invalid script seek input.');
        const {tick,frame,playing}=value;
        if(!Number.isSafeInteger(tick)||tick<current.timeline.tick||tick-current.timeline.tick>=ticks||
          !Number.isSafeInteger(frame)||frame<0||frame>=timeline.duration||typeof playing!=='boolean')
          throw new Error('Invalid script seek input.');
        return {tick,frame,playing};
      });
      if(seeks.some((value,index)=>index>0&&value.tick<=seeks[index-1].tick))throw new Error('Script seek ticks must be unique and ordered.');
      if(breakpoint){
        const seek=seeks[0];
        const matches=seek?seeks.length===1&&seek.tick===current.timeline.tick&&
          seek.frame===breakpoint.frame&&seek.playing===false:
          breakpoint.frame===current.timeline.frame&&(dispatch!=='entry'||current.entryPending);
        if(!matches)throw Error('A source breakpoint requires a matching saved frame body.');
      }
      const incoming=options.events??[];
      if(!Array.isArray(incoming)||incoming.length>1000)throw new Error('Invalid script input events.');
      let inputBytes=0;
      const events=incoming.map(value=>{
        if(!value)throw new Error('Invalid script input event.');
        const {tick}=value;
        if(!Number.isSafeInteger(tick)||tick<current.timeline.tick||tick-current.timeline.tick>=ticks)throw new Error('Invalid script input tick.');
        const data=cloneScriptState(value.data);
        const descriptor=Object.getOwnPropertyDescriptor(value,'textInput');
        if(descriptor&&(!descriptor.enumerable||!('value' in descriptor)))
          throw Error('Input text requires explicit event data.');
        const textInput=descriptor?captureScriptTextInput(descriptor.value):undefined;
        if(Object.hasOwn(data,'textInput'))throw Error('Input text is reserved for field events.');
        const bodyInput=textInput?cloneScriptState({...data,textInput}):data;
        inputBytes+=new TextEncoder().encode(JSON.stringify(bodyInput)).byteLength;
        if(inputBytes>256*1024)throw new Error('Script input batch exceeds 256 KiB.');
        return {tick,data,bodyInput,...(textInput?{textInput}:{})};
      });
      if(events.some((value,index)=>index>0&&value.tick<=events[index-1].tick))throw new Error('Script input ticks must be unique and ordered.');
      const pointers=new Map<number,ScriptButtonHoverInput>();
      if(nested?.hasButtons&&options.hostButtons!==undefined){
        const buttons=options.hostButtons;
        if(!Array.isArray(buttons)||buttons.length>events.length)throw Error('Invalid host button inputs.');
        const eventTicks=new Set(events.map(event=>event.tick));
        for(const entry of buttons){
          const descriptor=entry&&Object.getOwnPropertyDescriptor(entry,'pointer');
          if(!descriptor?.enumerable||!('value' in descriptor)||!eventTicks.has(entry.tick)||pointers.has(entry.tick))
            throw Error('Invalid host button input tick.');
          const pointer=copyScriptButtonHoverInput(descriptor.value);
          inputBytes+=new TextEncoder().encode(JSON.stringify(pointer)).byteLength;
          if(inputBytes>256*1024)throw Error('Script input batch exceeds 256 KiB.');
          pointers.set(entry.tick,pointer);
        }
      }
      const commands=options.playback??[];
      if(!Array.isArray(commands)||commands.length>1000)throw new Error('Invalid script playback inputs.');
      const playback=commands.map(value=>{
        if(!value)throw new Error('Invalid script playback input.');
        const {tick,playing}=value;
        if(!Number.isSafeInteger(tick)||tick<current.timeline.tick||tick-current.timeline.tick>=ticks||typeof playing!=='boolean')
          throw new Error('Invalid script playback input.');
        return {tick,playing};
      });
      if(playback.some((value,index)=>index>0&&value.tick<=playback[index-1].tick))throw new Error('Script playback ticks must be unique and ordered.');
      const seekTicks=new Set(seeks.map(value=>value.tick));
      if(playback.some(value=>seekTicks.has(value.tick)))throw new Error('A tick cannot contain both seek and playback commands.');
        let next=copy(current);
        const stateBaselines=stateStops.map(condition=>{
          if(condition.changed!==true)return undefined;
          const value=stateStopValue(next.state,condition.path);
          if(value!==null&&typeof value==='object')throw new Error('Changed state stops require an initial primitive or missing value.');
          return value;
        });
        let visibilityStamp: string | undefined,textStamp:string|undefined,transformStamp:string|undefined,spawnStamp:string|undefined;
        let visibilityBytes = 0;
        let textBytes=0;
        let transformBytes=0;
        let spawnBytes=0;
        let spawnLibrary:{symbols:Set<string>;bitmaps:Set<string>;timelines:Set<string>}|undefined;
        const encoder=new TextEncoder();
        const sample=():ScriptPresentationSample=>{
          const hidden = next.state[hiddenPlacementsKey];
          const stamp = hidden === undefined ? undefined : JSON.stringify(hidden);
          const changed = stamp !== visibilityStamp;
          visibilityStamp = stamp;
          if (changed && stamp !== undefined) {
            visibilityBytes += encoder.encode(stamp).byteLength;
            if (visibilityBytes > 64 * 1024 * 1024) throw Error('Script button visibility exceeds the artwork compiler limit.');
          }
          const rawText=next.state[scriptTextStateKey];
          const currentText=rawText===undefined?undefined:JSON.stringify(rawText);
          const changedText=currentText!==textStamp;
          textStamp=currentText;
          if(changedText&&currentText!==undefined){
            textBytes+=encoder.encode(currentText).byteLength;
            if(textBytes>64*1024*1024)throw Error('Replay text exceeds the 64 MiB artwork limit.');
          }
          const rawTransforms=next.state[placementTransformsKey];
          const currentTransforms=rawTransforms===undefined?undefined:JSON.stringify(rawTransforms);
          const changedTransforms=currentTransforms!==transformStamp;
          transformStamp=currentTransforms;
          if(changedTransforms&&currentTransforms!==undefined){
            transformBytes+=encoder.encode(currentTransforms).byteLength;
            if(transformBytes>replayTransformByteLimit)throw Error('Replay transforms exceed the 64 MiB artwork limit.');
          }
          const rawSpawns=next.state[spawnedGraphicsKey];
          const currentSpawns=rawSpawns===undefined?undefined:JSON.stringify(rawSpawns);
          const changedSpawns=currentSpawns!==spawnStamp;
          spawnStamp=currentSpawns;
          let spawnedGraphics:SpawnedGraphic[]|undefined;
          if(changedSpawns){
            spawnLibrary??={
              symbols:new Set(placements?.spawnable),
              bitmaps:new Set(placements?.scriptLibrary.filter(item=>item.kind==='bitmap'&&item.canSpawn).map(item=>item.id)),
              timelines:new Set(placements?.scriptLibrary.filter(item=>item.kind==='symbol'&&item.timed).map(item=>item.id)),
            };
            spawnBytes+=encoder.encode(currentSpawns??'[]').byteLength;
            if(spawnBytes>replaySpawnByteLimit)throw Error('Replay spawned artwork exceeds the 64 MiB artwork limit.');
            spawnedGraphics=readSpawnedGraphics(rawSpawns,spawnLibrary.symbols,spawnLibrary.bitmaps,spawnLibrary.timelines);
          }
          return {frame:next.timeline.frame,tick:next.timeline.tick,playing:next.timeline.playing,
            ...(dispatch==='entry'?{entryPending:next.entryPending}:{}),
            ...(changed?{hiddenPlacements:hiddenPlacementKeys(hidden)}:{}),
            ...(changedText?{textValues:captureDynamicTextValues(rawText)??null}:{}),
            ...(changedTransforms?{placementTransforms:readPlacementTransforms(rawTransforms)}:{}),
            ...(spawnedGraphics!==undefined?{spawnedGraphics}:{})};
        };
        // Initial pose plus every committed host tick, including stopped idle ticks.
        // Do not infer crossed root frames for seeks. Keep visibility and text changes sparse.
        const presentation=[sample()],soundCues:ScriptSoundCue[]=[];
        const present=(previousButtons?:ScriptButtonHoverCheckpoint,pointer?:ScriptButtonHoverInput)=>{
          let retired:string[]|undefined;
          if(nested&&(next.nestedButtons||nested.hasChildren)){
            const {retiredMovieButtons,...finish}=nested.finishPresentation(next.nestedGraphics!,next.nestedButtons,next.timeline.frame,next.state,
              next.timeline.tick,next.nestedMovieParents,previousButtons,pointer);
            retired=retiredMovieButtons;
            next={...next,...finish};
          }
          presentation.push({...sample(),...(retired?{retiredMovieButtons:retired}:{})});
        };
        let soundStamp=allowSound ? JSON.stringify(next.state[scriptSoundKey]) : undefined;
        admit();
        let inputIndex=0,eventIndex=0,playbackIndex=0;
        for(let tick=0;tick<ticks;tick++){
          // Stop at committed host boundaries, before consuming this tick's inputs.
          // A seek within a tick still follows the existing dispatch contract.
          if(stopFrames.has(next.timeline.frame)||matchingStateStops(next.state,stateStops,stateBaselines).length)break;
          // Let cancellation/deadline events run even across long source-free stretches.
          if(tick>0&&tick%32===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
          execution.signal?.throwIfAborted();admit();
          const previousFrame=next.timeline.frame;
          const previousButtons=next.nestedButtons,pointer=pointers.get(next.timeline.tick);
          const seek=seeks[inputIndex];
          if(seek?.tick===next.timeline.tick){
            const host=createScriptTimeline(timeline);host.restore(next.timeline);
            if(seek.playing)host.api.gotoAndPlay(seek.frame);else host.api.gotoAndStop(seek.frame);
            next={...next,timeline:host.checkpoint(),...(dispatch==='entry'?{entryPending:true}:{})};
            inputIndex++;
          }
          const command=playback[playbackIndex];
          if(command?.tick===next.timeline.tick){
            const host=createScriptTimeline(timeline);host.restore(next.timeline);
            if(command.playing)host.api.play();else host.api.stop();
            next={...next,timeline:host.checkpoint()};playbackIndex++;
          }
          const event=events[eventIndex]?.tick===next.timeline.tick?events[eventIndex++]:undefined;
          if(event?.textInput){
            try{next={...next,state:prepareScriptTextInputState(next.state,event.textInput)};}
            catch(error){throw new ScriptFrameExecutionError(next.timeline.frame,next.timeline.tick,error);}
          }
          if(event&&dispatch==='entry')next={...next,entryPending:true};
          if(nested){
            const placements=await nested.advance(next.nestedGraphics!,next.timeline.frame,next.timeline.tick,
              execution.signal,execution.timeoutMs,admit,next.nestedButtons,pointer,next.state,previousFrame,next.nestedMovieParents);
            execution.signal?.throwIfAborted();admit();
            next={...next,...placements};
          }
          if((dispatch==='entry'&&!next.entryPending)||!table.has(next.timeline.frame)){
            try{
              if(execution.timeoutMs!==undefined&&(!Number.isInteger(execution.timeoutMs)||execution.timeoutMs<1||execution.timeoutMs>60000))
                throw new Error('Invalid frame deadline.');
              const host=createScriptTimeline(timeline);host.restore(next.timeline);host.advance();
              next={...next,timeline:host.checkpoint(),...(dispatch==='entry'?{entryPending:host.api.playing}:{})};
            }catch(error){throw new ScriptFrameExecutionError(next.timeline.frame,next.timeline.tick,error);}
            present(previousButtons,pointer);continue;
          }
          let output:Awaited<ReturnType<typeof executeIsolatedFrameWithState>>;
          // Capture attribution in the host, never from script-controlled error text.
          const frame=next.timeline.frame,hostTick=next.timeline.tick;
          admit();
          if(breakpoint&&breakpoint.frame!==frame)throw Error('Script breakpoint no longer matches the source frame.');
          try{
            output=await executeIsolatedFrameWithState(breakpoint?.source??table.get(frame)??'',next.timeline,next.state,{...execution,stage,placements:placements?.at(frame),spawnable:placements?.spawnable,scriptLibrary:placements?.scriptLibrary,allowSound,entryDispatch:dispatch==='entry',input:event?.bodyInput,
              ...(boundedEngine?{boundedEngine,openBoundedEngine}:{}),
              ...(breakpoint?{debug:{points:breakpoint.points,functions:breakpoint.functions,onPause(pause:FramePause){
                admit();execution.signal?.throwIfAborted();
                breakpoint.onPause({...pause,frame,tick:hostTick});
              }}}:{})});
          }catch(error){
            execution.signal?.throwIfAborted();
            throw new ScriptFrameExecutionError(frame,hostTick,error,!!breakpoint);
          }
          execution.signal?.throwIfAborted();
          admit();
          next={...next,...output};present(previousButtons,pointer);
          if(allowSound){
            const value=next.state[scriptSoundKey],stamp=JSON.stringify(value);
            if(stamp!==soundStamp){
              if(soundCues.length>=MAX_SCRIPT_SOUND_CUES)throw Error('Script sound cue budget exceeded.');
              soundCues.push({tick:next.timeline.tick,value:cloneScriptState({value:value??null}).value});soundStamp=stamp;
            }
          }
        }
        execution.signal?.throwIfAborted();
        const completed=validateSource?copy(next):undefined;admit();
        current=next;
        return {checkpoint:completed??copy(current),presentation,seeks:seeks.slice(0,inputIndex),
          ...(soundCues.length?{soundCues}:{}),
          events:events.slice(0,eventIndex).map(({tick,data,textInput})=>({tick,data,...(textInput?{textInput}:{})})),
          playback:playback.slice(0,playbackIndex),
          stoppedAt:stopFrames.has(current.timeline.frame)?current.timeline.frame:undefined,
          stoppedOnState:matchingStateStops(current.state,stateStops,stateBaselines)};
      }finally{running=false;}
  }
  return Object.freeze({
    checkpoint(){return copy(current);},
    restore(value:ScriptSessionCheckpoint,validateSource?:()=>void){
      if(running)throw new Error('Script session is busy.');
      const next=copy(value);
      if(validateSource){const result=validateSource() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw new Error('Script source admission must be synchronous.');}}
      current=next;
    },
    async run(ticks:number,options:ScriptRunOptions={}){
      return (await runBatch(ticks,options)).checkpoint;
    },
    /** At most 1001 detached poses, published only when the entire batch commits. */
    runWithPresentation:runBatch,
  });
}
