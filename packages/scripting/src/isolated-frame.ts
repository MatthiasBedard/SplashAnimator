import { createStageVisibility, hiddenPlacementKeys, hiddenPlacementsKey } from './stage-visibility';
import { createInstanceLookup, type StagePlacement } from './stage-placements';
import { createStageTransforms, placementTransformsKey, readPlacementTransforms, type PlacementBasis } from './stage-transform';
import { createStageSpawns, readSpawnedGraphics, spawnedGraphicsKey } from './stage-spawn';
import { createScriptLibrary, type ScriptLibraryItem } from './stage-library';
import {createScriptSound,readScriptSound,scriptSoundKey,scriptSoundPosition} from './stage-sound';
import { captureScriptStage, type ScriptStageInfo } from './script-stage';
import { cloneScriptState, type ScriptState, createScriptTimeline, createScriptTimelineRuntime, type ScriptTimelineCheckpoint } from './timeline';
import { captureDynamicTextValues, isDynamicTextBinding, isDynamicTextInstanceName } from '../../document/src/dynamic-text';
import { createScriptText, scriptTextStateKey } from './dynamic-text';
import { readFrameLabels, validateFrameLabels } from '../../document/src/frame-labels';
import type { FrameBreakpoint, DebugFunction } from './compile';
import { createDebugLocalReader, debugLocalLimit, decodeDebugLocals, type DebugLocals } from './debug-locals';
import { assertBrowserScriptExecution, scriptFrameFactoryEnd, scriptFrameFactoryStart, scriptLoopLimit, scriptPreparedFrameName, scriptFunctionLimit, scriptFunctionDepth } from './script-execution-host';
import { installFrameAllocationLimits, scriptArraySlotLimit, scriptRepeatedTextLimit } from './frame-allocation';

export class IsolatedFrameError extends Error {
  generatedLocation?:{line:number;column:number};
}
export type DebugStackFrame = FrameBreakpoint & {name:string;locals:DebugLocals};
export type DebugAction = 'resume'|'step'|'into'|'out';
export type FramePause = FrameBreakpoint & {state:ScriptState;locals:DebugLocals;stack:DebugStackFrame[];resume:()=>void;step:()=>void;into?:()=>void;out?:()=>void};
type FrameDebug = {points:readonly FrameBreakpoint[];functions:readonly DebugFunction[];onPause:(pause:FramePause)=>void};
/** Prototype synchronous JavaScript frame body, run in a disposable opaque-origin worker.
 * No editor integration or persistent script heap. Deadline is a wall-clock limit,
 * not a memory quota. This is not a deterministic-JavaScript certification.
 */
export function executeIsolatedFrame(source: string, checkpoint: ScriptTimelineCheckpoint,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ScriptTimelineCheckpoint> {
  return executeIsolatedFrameWithState(source,checkpoint,{},options).then(result=>result.timeline);
}

export function executeIsolatedFrameWithState(source:string,checkpoint:ScriptTimelineCheckpoint,state:ScriptState,
  options:{signal?:AbortSignal;timeoutMs?:number;entryDispatch?:boolean;input?:ScriptState;stage?:ScriptStageInfo;placements?:StagePlacement[];spawnable?:readonly string[];scriptLibrary?:readonly ScriptLibraryItem[];allowSound?:boolean;debug?:FrameDebug;boundedEngine?:boolean;openBoundedEngine?:()=>Worker}={}):Promise<{timeline:ScriptTimelineCheckpoint;state:ScriptState;entryPending?:boolean}>{
  assertBrowserScriptExecution();
  const stage=captureScriptStage(options.stage);
  const placements=options.placements?.map(({id,name,layerId,symbolId,visible,visibilityKey,parentId,authoredTransform,authoredBasis})=>({
    id,name,layerId,symbolId,visible,visibilityKey,parentId,
    ...(authoredTransform ? {authoredTransform:{...authoredTransform}} : {}),
    ...(authoredBasis ? {authoredBasis:[...authoredBasis] as PlacementBasis} : {}),
  }));
  const initialState=cloneScriptState(state),initialInput=cloneScriptState(options.input??{});
  const spawnable = new Set(options.spawnable);
  const scriptLibrary = options.scriptLibrary?.map(item=>({...item})) ?? [];
  const allowSound=options.allowSound===true;
  const soundAssets=new Map(allowSound ? scriptLibrary.filter(item=>item.kind==='audio').map(item=>[item.id,item] as const) : []);
  const oldSound=readScriptSound(initialState[scriptSoundKey],soundAssets);
  const bitmapIds = new Set(scriptLibrary.filter(item=>item.kind==='bitmap' && item.canSpawn).map(item=>item.id));
  const timelineIds = new Set(scriptLibrary.filter(item=>item.kind==='symbol' && item.timed).map(item=>item.id));
  const {signal,timeoutMs=1000,entryDispatch=false,debug,openBoundedEngine}=options;
  const boundedEngine=options.boundedEngine===true;
  if(typeof entryDispatch!=='boolean')throw new Error('Invalid frame dispatch mode.');
  const validator=createScriptTimeline(checkpoint);
  validator.restore(checkpoint);
  const initial=validator.checkpoint();
  if (oldSound && oldSound[1]>initial.tick) throw Error('Invalid script sound origin.');
  const previousSpawns = new Map<string,string>();
  for (const item of readSpawnedGraphics(initialState[spawnedGraphicsKey],spawnable,bitmapIds,timelineIds)) {
    if (item[5] !== 'timeline') continue;
    if (item[6]! > initial.tick || item[7]! >= initial.duration) throw Error('Invalid spawned symbol origin.');
    previousSpawns.set(item[0],JSON.stringify(item));
  }
  if(typeof source!=='string'||source.length>256*1024)throw new Error('Frame source exceeds 256 KiB.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid frame deadline.');
  signal?.throwIfAborted();
  // Only trusted bootstrap text enters srcdoc; source travels through a MessagePort.
  const frameDriver=`
    (function*(data){
    const createTimeline=(${createScriptTimelineRuntime.toString()});
    const readLabels=(${readFrameLabels.toString()});
    const validateLabels=(${validateFrameLabels.toString()});
    const cloneState=(${cloneScriptState.toString()});
    const createText=(${createScriptText.toString()}),validBinding=(${isDynamicTextBinding.toString()}),validInstanceName=(${isDynamicTextInstanceName.toString()});
    const stringify=JSON.stringify.bind(JSON);
      try {
        const debug=data.debug;
        const readLocals=debug?(${createDebugLocalReader.toString()})(${debugLocalLimit}):undefined;
        const lookup=(${createInstanceLookup.toString()})(data.placements??[]);
        const host=createTimeline(data.checkpoint,readLabels,validateLabels);
        host.restore(data.checkpoint);
        const state=cloneState(data.state);
        const symbols=new Set(data.spawnable),bitmaps=new Set(data.bitmapIds),timelines=new Set(data.timelineIds);
        const spawnKey=${JSON.stringify(spawnedGraphicsKey)},readSpawns=(${readSpawnedGraphics.toString()});
        const birth={tick:data.checkpoint.tick+1,frame:data.checkpoint.frame};
        const {spawnBitmap,spawnTimeline,...spawns}=(${createStageSpawns.toString()})(state,spawnKey,symbols,readSpawns,bitmaps,timelines,birth);
        const stage=data.stage && Object.freeze({
          ...data.stage,
          ...(${createStageVisibility.toString()})(lookup,state,${JSON.stringify(hiddenPlacementsKey)},(${hiddenPlacementKeys.toString()})),
          ...(${createStageTransforms.toString()})(lookup,state,${JSON.stringify(placementTransformsKey)},(${readPlacementTransforms.toString()})),
          ...spawns,
          library:(${createScriptLibrary.toString()})(data.scriptLibrary,spawns.spawnGraphic,spawnBitmap,spawnTimeline),
          ...(data.allowSound?{sound:(${createScriptSound.toString()})(state,${JSON.stringify(scriptSoundKey)},new Map(data.scriptLibrary.filter(item=>item.kind==='audio').map(item=>[item.id,item])),data.checkpoint.tick,data.checkpoint.fps,(${readScriptSound.toString()}),(${scriptSoundPosition.toString()}))}:{}),
        });
        const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
        const input=freeze(cloneState(data.input));
        let remainingLoops=${scriptLoopLimit},remainingFunctions=${scriptFunctionLimit},depth=0,workFailure='';
        const assertWorkBudget=()=>{
          if(workFailure)throw Error(workFailure);
        };
        const workStep=kind=>{
          if(kind==='leave'){depth--;return;}
          assertWorkBudget();
          if(kind==='loop'){
            if(--remainingLoops<0)workFailure='Script loop work limit exceeded.';
          }else{
            if(--remainingFunctions<0)workFailure='Script function work limit exceeded.';
            else if(depth>=${scriptFunctionDepth})workFailure='Script function nesting limit exceeded.';
            else depth++;
          }
          assertWorkBudget();
        };
        (${installFrameAllocationLimits.toString()})(${scriptArraySlotLimit},${scriptRepeatedTextLimit},message=>{
          if(!workFailure)workFailure=message;
          assertWorkBudget();
        });
        const factory=typeof preparedFrame==='function'?preparedFrame:new Function('return '+${JSON.stringify(scriptFrameFactoryStart)}+data.source+${JSON.stringify(scriptFrameFactoryEnd)}+'\\n//# sourceURL=splash-frame.js')();
        const run=factory(stage,host.runtime);
        let result=run(host.api,state,input,createText(state,${JSON.stringify(scriptTextStateKey)},validBinding,validInstanceName),workStep);
        if(debug){
          const advance=result.next.bind(result);
          let current=advance(),rootIndex=-1,childIndex=-1,childScope=0,action='step',inside=false;
          if(current.done)throw Error('The source breakpoint was not reached.');
          let rootMarker,rootBindings,childBindings;
          const inspect=(marker,bindings)=>readLocals(bindings,marker[1],marker[2]);
          while(!current.done){
            const marker=current.value;
            const scope=marker?.[4]??0,index=marker?.[0];
            if(scope===0){
              if(index!==rootIndex+1||index>=debug.count)throw Error('Unexpected script suspension.');
              rootIndex=index;rootMarker=marker;childIndex=-1;childScope=0;
              if(index===0)rootBindings=marker[3];
            }else{
              const fn=debug.functions[scope-1];
              if(!fn||!fn.calls.includes(rootIndex)||childScope&&childScope!==scope||index!==childIndex+1||
                index>=fn.count)throw Error('Unexpected script function suspension.');
              childScope=scope;childIndex=index;
              if(index===0)childBindings=marker[3];
            }
            if(action!=='resume'&&(scope===0||inside)){
              assertWorkBudget();
              const paused=stringify(cloneState(state)),position=stringify(host.checkpoint());
              const bindings=scope===0?rootBindings:childBindings;
              const locals=inspect(marker,bindings);
              const caller=scope===0?undefined:rootIndex;
              const callerLocals=scope===0?undefined:inspect(rootMarker,rootBindings);
              assertWorkBudget();
              action=yield {paused:true,scope,index,caller,callerLocals,state:paused,locals};
              inside=action==='into'||action==='step'&&scope!==0;
              if(paused!==stringify(cloneState(state))||position!==stringify(host.checkpoint())||
                locals!==inspect(marker,bindings)||(scope!==0&&callerLocals!==inspect(rootMarker,rootBindings)))
                throw Error('Script state changed while paused.');
            }
            current=advance();
          }
          result=current.value;
        }
        assertWorkBudget();
        if(result&&typeof result.then==='function')throw new Error('Async frame results are unsupported.');
        const entryPending=host.sought||host.api.playing;
        host.advance(data.entryDispatch&&host.sought);
        const completed=host.checkpoint();
        if(state[spawnKey]!==undefined && timelines.size) {
          const entries=readSpawns(state[spawnKey],symbols,bitmaps,timelines);
          for(const item of entries)
            if(item[5]==='timeline' && item[6]===birth.tick) item[7]=completed.frame;
          state[spawnKey]=entries;
        }
        const output=stringify(cloneState(state));
        assertWorkBudget();
        return {ok:true,checkpoint:completed,state:output,entryPending};
      } catch(error) {
        return {ok:false,error:String(error).slice(0,2000),stack:typeof error?.stack==='string'?error.stack.slice(0,8192):undefined};
      }
    })
  `;
  const workerCode=`
    (()=>{
    const send=self.postMessage.bind(self);
    function reserve(name){
      const denied=function(){throw new Error('Frame capability is reserved: '+name);};
      for(let target=self;target;target=Object.getPrototypeOf(target)){
        if(Object.prototype.hasOwnProperty.call(target,name))
          Object.defineProperty(target,name,{value:denied,writable:false,configurable:false});
      }
    }
    self.onmessage=event=>{
      self.onmessage=null;
      const control=event.ports[0];
      try{
        reserve('postMessage');reserve('Worker');reserve('importScripts');
        if(event.data.debug){reserve('setTimeout');reserve('setInterval');reserve('queueMicrotask');}
        const driver=${frameDriver}(event.data),advance=driver.next.bind(driver);
        function deliver(action){
          const next=advance(action);
          if(next.done)control?.close();
          else control.onmessage=event=>{
            if(event.isTrusted&&(event.data==='resume'||event.data==='step'||event.data==='into'||event.data==='out')){
              control.onmessage=null;
              deliver(event.data);
            }
          };
          send(next.value);
        }
        deliver();
      }catch(error){
        control?.close();
        send({ok:false,error:String(error).slice(0,2000)});
      }
    };
    })();
  `;
  const boot=`
    addEventListener('message',function receive(event){
      if(event.source!==parent||!event.ports[0])return;
      removeEventListener('message',receive);
      const port=event.ports[0];
      let worker;
      try{
        const url=URL.createObjectURL(new Blob([${JSON.stringify(workerCode)}],{type:'text/javascript'}));
        worker=new Worker(url);URL.revokeObjectURL(url);
        const control=event.data.debug?new MessageChannel():undefined;
        worker.onmessage=event=>{
          if(event.data?.paused===true&&control){port.postMessage(event.data);return;}
          worker.terminate();control?.port1.close();port.postMessage(event.data);port.close();
        };
        worker.onerror=event=>{worker.terminate();port.postMessage({ok:false,error:String(event.message||'Frame worker failed.').slice(0,2000)});port.close();};
        port.onmessage=message=>{
          if(control&&(message.data==='resume'||message.data==='step'||message.data==='into'||message.data==='out')){control.port1.postMessage(message.data);return;}
          worker.terminate();control?.port1.close();port.close();
        };
        port.start();worker.postMessage(event.data,control?[control.port2]:[]);
      }catch(error){worker?.terminate();port.postMessage({ok:false,error:String(error).slice(0,2000)});port.close();}
    });
  `;
  return new Promise((resolve,reject)=>{
    const frame=boundedEngine?undefined:document.createElement('iframe');
    if(frame){frame.hidden=true;frame.title='Isolated script frame';frame.sandbox.add('allow-scripts');}
    let engine:Worker|undefined;
    const channel=new MessageChannel();
    type PausePosition={scope:number;index:number;caller?:number};
    let expected=(point:PausePosition)=>point.scope===0&&point.index===0&&point.caller===undefined;
    let finished=false,waiting=false,seenPause=false,timer:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:unknown,value?:{timeline:ScriptTimelineCheckpoint;state:ScriptState;entryPending?:boolean})=>{
      if(finished)return;finished=true;
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      channel.port1.postMessage('dispose');channel.port1.close();channel.port2.close();
      if(frame){frame.onload=frame.onerror=null;frame.remove();}
      if(engine){engine.onerror=null;engine.terminate();}
      if(error!==undefined)reject(error);else resolve(value!);
    };
    const abort=()=>finish(signal?.reason??new DOMException('Frame cancelled.','AbortError'));
    const arm=()=>{timer=setTimeout(()=>finish(new Error('Frame execution timed out.')),timeoutMs);};
    arm();
    signal?.addEventListener('abort',abort,{once:true});
    channel.port1.onmessage=event=>{
      try{
        assertBrowserScriptExecution();
        const message=event.data;
        if(message?.paused===true){
          const {scope,index,caller}=message;
          if(!debug||waiting||!Number.isSafeInteger(scope)||scope<0||!Number.isSafeInteger(index)||index<0||
            !expected({scope,index,caller})||typeof message.state!=='string'||message.state.length>65536)
            throw Error('Invalid frame breakpoint response.');
          const fn=scope===0?undefined:debug.functions[scope-1];
          const point=scope===0?debug.points[index]:fn?.points[index];
          if(!point||scope!==0&&(!Number.isSafeInteger(caller)||!fn?.calls.includes(caller)||!debug.points[caller]))
            throw Error('Invalid frame stack response.');
          waiting=true;seenPause=true;
          const state=cloneScriptState(JSON.parse(message.state));
          const locals=decodeDebugLocals(message.locals);
          const stack=[{...point,name:fn?.name??'Frame script',locals}];
          if(fn)stack.push({...debug.points[caller],name:'Frame script',locals:decodeDebugLocals(message.callerLocals)});
          const target=scope===0?debug.functions.findIndex(fn=>fn.calls.includes(index))+1:0;
          clearTimeout(timer);
          timer=setTimeout(()=>finish(new Error('Source breakpoint timed out.')),60000);
          let resumed=false;
          function advance(action:DebugAction){
            if(finished||resumed)return;
            try{assertBrowserScriptExecution();}catch(error){finish(error);return;}
            resumed=true;waiting=false;
            expected=next=>{
              if(action==='resume')return false;
              if(next.scope===0)return next.caller===undefined&&next.index===(scope===0?index:caller)+1;
              if(scope===0)return action==='into'&&next.scope===target&&next.caller===index&&next.index===0;
              return action==='step'&&next.scope===scope&&next.caller===caller&&next.index===index+1;
            };
            clearTimeout(timer);arm();channel.port1.postMessage(action);
          }
          debug.onPause({...point,state,locals,stack,resume:()=>advance('resume'),step:()=>advance('step'),
            ...(target?{into:()=>advance('into')}:{}),...(scope!==0?{out:()=>advance('out')}:{})});
          return;
        }
        if(message?.ok!==true){
          const error=new IsolatedFrameError(typeof message?.error==='string'?message.error.slice(0,2000):'Invalid frame response.');
          const match=typeof message?.stack==='string'&&message.stack.length<=8192?message.stack.match(/splash-frame\.js:(\d+):(\d+)/):undefined;
          // The QuickJS function is compiled directly with a header and strict directive.
          if(match){const line=Number(match[1])-(boundedEngine?2:3),column=Number(match[2]);
            if(Number.isSafeInteger(line)&&line>0&&Number.isSafeInteger(column)&&column>0)error.generatedLocation={line,column};}
          throw error;
        }
        if(debug&&(!seenPause||waiting))throw Error('The source breakpoint did not complete.');
        validator.restore(message.checkpoint);
        const next=validator.checkpoint();
        if(next.tick!==initial.tick+1)throw new Error('Invalid frame tick.');
        if(typeof message.state!=='string'||message.state.length>65536)throw new Error('Invalid script state response.');
        const state=cloneScriptState(JSON.parse(message.state));
        captureDynamicTextValues(state[scriptTextStateKey]);
        const sound=readScriptSound(state[scriptSoundKey],soundAssets);
        if (sound && JSON.stringify(sound)!==JSON.stringify(oldSound) && sound[1]!==next.tick)
          throw Error('Invalid script sound origin.');
        for (const item of readSpawnedGraphics(state[spawnedGraphicsKey],spawnable,bitmapIds,timelineIds))
          if (item[5]==='timeline' && previousSpawns.get(item[0])!==JSON.stringify(item) &&
            (item[6]!==next.tick || item[7]!==next.frame)) throw Error('Invalid spawned symbol origin.');
        const before=new Set(hiddenPlacementKeys(initialState[hiddenPlacementsKey]));
        const after=new Set(hiddenPlacementKeys(state[hiddenPlacementsKey]));
        const allowed=new Set(placements?.map(item=>item.visibilityKey));
        for(const key of new Set([...before,...after]))
          if(before.has(key)!==after.has(key) && !allowed.has(key))throw Error('Unknown script placement visibility target.');
        const transformsBefore = new Map(readPlacementTransforms(initialState[placementTransformsKey])
          .map(entry => [entry[0], JSON.stringify(entry)]));
        const transformsAfter = new Map(readPlacementTransforms(state[placementTransformsKey])
          .map(entry => [entry[0], JSON.stringify(entry)]));
        const transformOwners = new Set(placements?.filter(item => item.authoredTransform).map(item => item.visibilityKey));
        for (const key of new Set([...transformsBefore.keys(), ...transformsAfter.keys()]))
          if (transformsBefore.get(key) !== transformsAfter.get(key) && !transformOwners.has(key))
            throw Error('Unknown script placement transform target.');
        if(entryDispatch&&typeof message.entryPending!=='boolean')throw new Error('Invalid entry dispatch response.');
        finish(undefined,{timeline:next,state,...(entryDispatch?{entryPending:message.entryPending}:{})});
      }catch(error){finish(error);}
    };
    const payload={source,checkpoint:initial,state:initialState,input:initialInput,stage,placements,
      spawnable:[...spawnable],bitmapIds:[...bitmapIds],timelineIds:[...timelineIds],scriptLibrary,allowSound,entryDispatch,
      ...(debug?{debug:{count:debug.points.length,functions:debug.functions.map(fn=>({calls:fn.calls,count:fn.points.length}))}}:{})};
    if(boundedEngine){
      try{
        assertBrowserScriptExecution();
        const wire=JSON.stringify(JSON.stringify({...payload,source:undefined}));
        const frameName=JSON.stringify(scriptPreparedFrameName);
        const program='(()=>{const preparedFrame=globalThis['+frameName+'];delete globalThis['+frameName+'];'+
          'const stringify=JSON.stringify.bind(JSON);const driver='+frameDriver+'(JSON.parse('+wire+'));'+
          'const advance=driver.next.bind(driver);return action=>stringify(advance(action).value)})()';
        engine=openBoundedEngine?openBoundedEngine():new Worker(new URL('./quickjs-frame-worker.ts',import.meta.url),{type:'module',name:'Splash bounded script engine'});
        engine.onerror=event=>{event.preventDefault();finish(Error('Script engine worker failed.'));};
        engine.postMessage({program,source,timeoutMs,debug:!!debug},[channel.port2]);
      }catch(error){finish(error);}
    }else if(frame){
      frame.onload=()=>{
        if(finished)return;
        try{
          assertBrowserScriptExecution();
          frame.contentWindow!.postMessage(payload,'*',[channel.port2]);
        }catch(error){finish(error);}
      };
      frame.onerror=()=>finish(new Error('Isolated frame failed to load.'));
      frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39; &#39;unsafe-eval&#39;; worker-src blob:; connect-src &#39;none&#39;;"><script>'+boot.replace(/<\/script/gi,'<\\/script')+'</script>';
      document.body.append(frame);
    }
    if(signal?.aborted)abort();
  });
}
