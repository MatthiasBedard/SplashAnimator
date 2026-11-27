<script lang="ts">
  import type {Layer,Project} from '../../../packages/document/src';
  import {captureArtworkVisibility,hiddenPlacementsKey,lastHiddenButtons} from '../../../packages/scripting/src/stage-visibility';
  import {parseScriptStateStop} from '../../../packages/scripting/src/stop-state';
  import {parseScriptStopFrames} from '../../../packages/scripting/src/stop-frames';
  import type {PresentationPose} from '../../../packages/export-web/src';
  import {replayTextByteLimit,type ReplayTextChange} from '../../../packages/export-web/src/replay-text';
  import {onDestroy,onMount,untrack} from 'svelte';
  import {SvelteMap,SvelteSet} from 'svelte/reactivity';
  import {cloneScriptState,type ScriptTimelineConfig,type ScriptState} from '../../../packages/scripting/src/timeline';
  import {applyStagePresentation,placementTransformsKey} from '../../../packages/scripting/src/stage-transform';
  import {replayTransformByteLimit,replayTransformSize} from '../../../packages/animation/src/placement-transform';
  import {spawnedGraphicsKey} from '../../../packages/scripting/src/stage-spawn';
  import {replaySpawnByteLimit,replaySpawnSize} from '../../../packages/animation/src/spawn-artwork';
  import {MAX_SCRIPT_SOUND_CUES,type ScriptSoundCue} from '../../../packages/scripting/src/stage-sound';
  import {createScriptSoundPreview,type ScriptSoundLoader,type ScriptSoundSource} from './script-sound-preview';
  import {scriptTextStateKey} from '../../../packages/scripting/src/dynamic-text';
  import {captureScriptTextInput,type ScriptTextInput} from '../../../packages/scripting/src/input-text';
  import ScriptInputText from './ScriptInputText.svelte';
  import {scriptFieldPlacement,scriptTextFields,type ScriptArtworkSize} from './script-text-fields';
  import type {ScriptPresentationSample,ScriptFrameSource,ScriptSeekInput,ScriptDataInput,ScriptPlaybackInput,ScriptStateStop,ScriptPause} from '../../../packages/scripting/src/session';
  import type {prepareScriptPreview,ScriptPreviewCheckpoint} from '../../../packages/scripting/src/preview';
  import type {DebugAction} from '../../../packages/scripting/src/isolated-frame';
  import {advanceScriptButtonHover,type ScriptButtonHoverInput,type ScriptButtonHoverCheckpoint} from '../../../packages/scripting/src/button-input';
  import type {SymbolArtworkDelivery,SymbolArtworkHistory,SymbolArtworkTargetQuery} from './symbol-script-artwork';
  import type {ProgramDiagnostic} from '../../../packages/scripting/src/compile-program';
  import {license} from './license.svelte';
  let {artwork,inputLayers,config,sources,validate,openSource,scope='main',preparePreview,renderArtwork,queryArtwork,artworkHistory,continueArtwork,hoverArtwork,pressArtwork,qualifyArtwork,publishArtworkDelivery,loadScriptSound,soundSource,subscribeSoundDisposal}:{artwork?:Project;inputLayers?:readonly Layer[];config:ScriptTimelineConfig;sources:ScriptFrameSource[];validate:()=>void;openSource:(frame:number,location?:{line:number;column:number})=>void;scope?:'main'|'symbol';loadScriptSound?:ScriptSoundLoader;soundSource?:ScriptSoundSource;subscribeSoundDisposal?:(dispose:()=>void)=>()=>void;qualifyArtwork?:(image:Blob,query:SymbolArtworkTargetQuery,input:Pick<ScriptButtonHoverInput,'type'|'pointerId'|'button'>)=>SymbolArtworkDelivery;publishArtworkDelivery?:(delivery:SymbolArtworkDelivery,pose:PresentationPose,signal:AbortSignal,validateInput:()=>void,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;pressArtwork?:(image:Blob,query:SymbolArtworkTargetQuery,input:Pick<ScriptButtonHoverInput,'type'|'pointerId'|'button'>,pose:PresentationPose,signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;continueArtwork?:(image:Blob,poses:readonly PresentationPose[],signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;hoverArtwork?:(image:Blob,query:SymbolArtworkTargetQuery,state:'up'|'over',pose:PresentationPose,signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;artworkHistory?:{capture:(image:Blob)=>SymbolArtworkHistory;restore:(history:SymbolArtworkHistory,signal:AbortSignal)=>Promise<Blob>};queryArtwork?:(image:Blob,points:readonly {x:number;y:number}[],signal:AbortSignal)=>Promise<SymbolArtworkTargetQuery>;renderArtwork?:(poses:readonly PresentationPose[],signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;preparePreview?:(state:ScriptState,options:{signal?:AbortSignal;timeoutMs?:number;allowSound?:boolean;boundedEngine?:boolean})=>ReturnType<typeof prepareScriptPreview>}=$props();
  const capturedPrepare=untrack(()=>preparePreview),validateCurrent=untrack(()=>validate),openCapturedSource=untrack(()=>openSource),renderCapturedArtwork=untrack(()=>renderArtwork),queryCapturedArtwork=untrack(()=>queryArtwork),capturedArtworkHistory=untrack(()=>artworkHistory),continueCapturedArtwork=untrack(()=>continueArtwork),hoverCapturedArtwork=untrack(()=>hoverArtwork),pressCapturedArtwork=untrack(()=>pressArtwork),qualifyCapturedArtwork=untrack(()=>qualifyArtwork),publishCapturedDelivery=untrack(()=>publishArtworkDelivery);
  const interactiveArtwork=$derived(scope==='main'&&!!artwork);
  const pointerArtwork=$derived(interactiveArtwork||(scope==='symbol'&&!!renderCapturedArtwork&&!!queryCapturedArtwork));
  const artworkAvailable=$derived(interactiveArtwork||(scope==='symbol'&&!!renderCapturedArtwork));
  let preview:Awaited<ReturnType<typeof prepareScriptPreview>>['preview'];
  let initial:ScriptPreviewCheckpoint|undefined,controller:AbortController|undefined;
  let busy=$state(false),status=$state(''),snapshot=$state<ScriptPreviewCheckpoint|undefined>();
  let showArtwork=$state(false);
  let inputReset=$state(0);
  const fieldLayers=$derived(inputLayers??artwork?.layers??[]);
  let artworkImage=$state<HTMLImageElement>();
  let artworkSize=$state.raw<ScriptArtworkSize>();
  const textFields=$derived(snapshot?scriptTextFields(fieldLayers,snapshot.session.timeline.frame,
    showArtwork&&!artwork?.layerMasks?.length&&!artwork?.opacityBindings?.length):[]);
  const presentedFields=$derived(textFields.map(field=>({...field,placement:scriptFieldPlacement(field.overlay,artworkSize)})));
  const overlayFields=$derived(presentedFields.filter(field=>field.placement!==undefined));
  const inspectorFields=$derived(presentedFields.filter(field=>field.placement===undefined));
  function measureArtwork() {
    const image=artworkImage;
    if(!image?.complete||image.src!==imageUrl||!image.naturalWidth||!image.naturalHeight)return;
    const {width,height}=image.getBoundingClientRect();
    if(width<=0||height<=0)return;
    artworkSize={width,height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};
  }
  $effect(()=>{
    const image=artworkImage;
    if(!image){artworkSize=undefined;return;}
    const observer=new ResizeObserver(measureArtwork);
    observer.observe(image);
    return ()=>observer.disconnect();
  });
  function fieldValue(binding:string, authored:string, state?:ScriptState) {
    const values=state?.[scriptTextStateKey];
    if(!values||typeof values!=='object'||Array.isArray(values))return authored;
    const value=values[binding];
    return typeof value==='string'?value:authored;
  }
  let bookmark=$state<ScriptPreviewCheckpoint|undefined>();
  const currentSource=$derived.by(()=>{
    const frame=snapshot?.session.timeline.frame;
    return frame===undefined?undefined:sources.find(entry=>entry.frame===frame)?.source;
  });
  let failedLocation=$state<{line:number;column:number}|undefined>();
  let diagnostics=$state<ProgramDiagnostic[]>([]),failedFrame=$state<number|undefined>();
  let imageUrl=$state(''),localHover=$state(false),localPress=$state(false),localActivation=$state(false);
  let stopFrame=$state<number|undefined>(1),stopBudget=$state<number|undefined>(100);
  let selectedBreakpointFrame=$state<number|undefined>();
  const breakpointLines=new SvelteMap<number,number|undefined>();
  const breakpointFrame=$derived(selectedBreakpointFrame??snapshot?.session.timeline.frame??0);
  const breakpointLine=$derived(breakpointLines.has(breakpointFrame)?breakpointLines.get(breakpointFrame):1);
  let paused=$state.raw<ScriptPause>();
  let selectedStackFrame=$state(0);
  const visibleStackFrame=$derived(paused?.stack[selectedStackFrame]);
  const breakpointSource=$derived(sources.find(item=>item.frame===breakpointFrame));
  const canDebug=$derived(!!snapshot&&!!breakpointSource&&(selectedBreakpointFrame!==undefined||snapshot.session.entryPending===true));
  const pausedSourceLine=$derived.by(()=>{
    const point=visibleStackFrame,frame=paused?.frame;
    return point?sources.find(item=>item.frame===frame)?.source.split(/\r\n|[\r\n\u2028\u2029]/)[point.line-1]:undefined;
  });
  let additionalStops=$state('');
  let stateComparison=$state<'equals'|'changed'|'lt'|'lte'|'gt'|'gte'>('equals');
  let statePath=$state('["score"]'),stateValue=$state('1'),stateBudget=$state<number|undefined>(100);
  let seekFrame=$state<number|undefined>(1),inputs=$state<ScriptSeekInput[]>([]);
  let bookmarkInputs:ScriptSeekInput[]=[];
  let playback=$state<ScriptPlaybackInput[]>([]);
  let bookmarkPlayback:ScriptPlaybackInput[]=[];
  type PreviewInput=ScriptDataInput&{buttonInput?:ScriptButtonHoverInput};
  let inputDraft=$state('{}'),events=$state<PreviewInput[]>([]);
  let bookmarkEvents:PreviewInput[]=[];
  let buttonState=$state<ScriptButtonHoverCheckpoint>({version:1,press:{version:1,pressed:null},hover:null});
  const buttonPress=$derived(buttonState.press);
  let captureHover=$state(false);
  let captureKeys=$state(false),capturePointers=$state(false),includePointerTarget=$state(false);
  let capturedQueue=$state<{kind:'key'|'pointer';data:ScriptState;targetImage?:string;targetBlob?:Blob;targetWidth?:number;targetHeight?:number}[]>([]);
  const keyQueue=$derived(capturedQueue.filter(event=>event.kind==='key').map(event=>event.data));
  const pointerQueue=$derived(capturedQueue.filter(event=>event.kind==='pointer').map(event=>event.data));
  let pointerHost=$state<HTMLDivElement|undefined>();
  const capturedPointers=new SvelteSet<number>();
  function releasePointers(){
    for(const id of capturedPointers)if(pointerHost?.hasPointerCapture(id))pointerHost.releasePointerCapture(id);
    capturedPointers.clear();
  }
  function capturePointer(event:PointerEvent){
    if(event.type==='pointerup'||event.type==='pointercancel')capturedPointers.delete(event.pointerId);
    if(!capturePointers||busy||!snapshot)return;
    if(event.type==='pointerleave'&&event.relatedTarget instanceof HTMLElement&&
      pointerHost?.parentElement?.contains(event.relatedTarget))return;
    if((event.type==='pointermove'||event.type==='pointerleave')&&!captureHover)return;
    event.preventDefault();event.stopPropagation();
    if(pointerQueue.length>=64){capturePointers=false;releasePointers();status='Pointer queue is full (64 events). Capture stopped; deliver or clear queued pointers.';return;}
    const image=pointerHost?.querySelector('img'),rect=image?.getBoundingClientRect();
    if(!rect||rect.width<=0||rect.height<=0)return;
    const width=scope==='symbol'?image?.naturalWidth:artwork?.width,height=scope==='symbol'?image?.naturalHeight:artwork?.height;
    if(!width||!height||(scope==='symbol'&&(!imageBlob||image?.src!==imageUrl||!image.complete)))return;
    if(scope==='symbol'){try{validateCurrent();}catch(error){status=String(error);return;}}
    const x=(event.clientX-rect.left)/rect.width*width,y=(event.clientY-rect.top)/rect.height*height;
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    capturedQueue=[...capturedQueue,{kind:'pointer',...((includePointerTarget||captureHover||(scope==='symbol'&&localPress))?{targetImage:imageUrl,...(scope==='symbol'?{targetBlob:imageBlob,targetWidth:width,targetHeight:height}:{})}:{}),data:{type:event.type,x,y,pointerId:event.pointerId,pointerType:event.pointerType,button:event.button,buttons:event.buttons,
      pressure:event.pressure,tiltX:event.tiltX,tiltY:event.tiltY,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey}}];
    if(event.type==='pointerdown'){
      try{pointerHost?.setPointerCapture(event.pointerId);capturedPointers.add(event.pointerId);}
      catch{status='Pointer capture unavailable; releases outside artwork may not be recorded.';}
    }
  }
  function captureKey(event:KeyboardEvent){
    if(!captureKeys||busy||!snapshot||event.key==='Tab')return;
    event.preventDefault();event.stopPropagation();
    if(event.repeat||event.isComposing)return;
    if(keyQueue.length>=64){captureKeys=false;status='Keyboard queue is full (64 events). Capture stopped; deliver or clear queued keys.';return;}
    if(event.key.length>128||event.code.length>128){captureKeys=false;status='Unsupported keyboard key/code length. Capture stopped.';return;}
    capturedQueue=[...capturedQueue,{kind:'key',data:{type:event.type,key:event.key,code:event.code,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey}}];
  }
  const copyEvents=(values:PreviewInput[])=>values.map(value=>({tick:value.tick,data:cloneScriptState(value.data),
    ...(value.textInput?{textInput:captureScriptTextInput($state.snapshot(value.textInput))}:{}),
    ...(value.buttonInput?{buttonInput:cloneScriptState(value.buttonInput) as unknown as ScriptButtonHoverInput}:{})}));
  function retireHiddenPress(state: ScriptButtonHoverCheckpoint, hidden: readonly string[]) {
    const pressed=state.press.pressed, hover=state.hover;
    const cancel=pressed && hidden.includes(pressed.target.token);
    const leave=hover && hidden.includes(hover.target.token);
    if (!cancel && !leave) return state;
    return {...state, press:cancel ? {...state.press,pressed:null} : state.press, hover:leave ? null : hover};
  }
  type ScriptPose=PresentationPose&{retiredMovieButtons?:readonly string[];replayTransformBytes?:number;replaySpawnBytes?:number};
  function replayButtonPress(values:PreviewInput[], history: readonly ScriptPose[]){
    let next:ScriptButtonHoverCheckpoint={version:1,press:{version:1,pressed:null},hover:null};
    let index=0,hidden:readonly string[]=[];
    const present=(pose:ScriptPose)=>{
      hidden=pose.hiddenButtons??hidden;
      next=retirePresentedPress(next,pose.frame,hidden,pose.retiredMovieButtons);
    };
    for(const value of values)if(value.buttonInput){
      while(index<history.length&&history[index].tick<=value.tick)present(history[index++]);
      const step=advanceScriptButtonHover(next,value.buttonInput);
      if(JSON.stringify(step.activation)!==JSON.stringify(value.data.buttonActivation))throw new Error('Button activation history differs.');
      next=step.checkpoint;
    }
    while(index<history.length)present(history[index++]);
    return next;
  }
  function retirePresentedPress(state:ScriptButtonHoverCheckpoint,frame:number,hidden:readonly string[],retired?:readonly string[]){
    const visible=retireHiddenPress(state,retired?[...hidden,...retired]:hidden);
    return preview?.retireButtonTargets(visible,frame,hidden)??visible;
  }
  function pressedPose(pose:ScriptPose,state:ScriptButtonHoverCheckpoint):ScriptPose{
    const over=state.hover?.target,down=state.press.pressed?.target;
    if(!over)return {...pose};
    const {instanceId,symbolId,lifetime}=over;
    return {...pose,buttonState:{instanceId,symbolId,lifetime,state:down&&down.instanceId===instanceId&&down.symbolId===symbolId&&down.lifetime===lifetime?'down':'over'}};
  }
  let resolveVisibility: ReturnType<typeof captureArtworkVisibility> | undefined;
  function appendPreviewPoses(
    history: ScriptPose[],
    samples: readonly ScriptPresentationSample[],
    press: ScriptButtonHoverCheckpoint,
    applyPointer?: (tick:number,state:ScriptButtonHoverCheckpoint)=>ScriptButtonHoverCheckpoint,
  ) {
    let hidden=lastHiddenButtons(history);
    let hiddenGraphics:readonly string[]=[];
    for(let i=history.length-1;i>=0;i--){
      const recorded=history[i].hiddenGraphics;
      if(recorded!==undefined){hiddenGraphics=recorded;break;}
    }
    const appended: ScriptPose[]=[];
    let transformBytes=0;
    if(interactiveArtwork&&samples.some(sample=>sample.placementTransforms!==undefined)){
      for(let i=history.length-1;i>=0;i--){
        const bytes=history[i].replayTransformBytes;
        if(bytes!==undefined){transformBytes=bytes;break;}
      }
    }
    let spawnBytes=0;
    if(interactiveArtwork&&samples.some(sample=>sample.spawnedGraphics!==undefined)){
      for(let i=history.length-1;i>=0;i--){
        const bytes=history[i].replaySpawnBytes;
        if(bytes!==undefined){spawnBytes=bytes;break;}
      }
    }
    for(const {hiddenPlacements,placementTransforms,spawnedGraphics,...sample} of samples){
      delete sample.textValues;
      if(applyPointer)press=applyPointer(sample.tick-1,press);
      let visibility: string[] | undefined;
      let graphicVisibility: string[] | undefined;
      if(interactiveArtwork && artwork && hiddenPlacements!==undefined){
        resolveVisibility ??= captureArtworkVisibility($state.snapshot(artwork));
        const {buttons,graphics}=resolveVisibility(hiddenPlacements);
        if(JSON.stringify(hidden)!==JSON.stringify(buttons)){hidden=buttons;visibility=buttons;}
        if(JSON.stringify(hiddenGraphics)!==JSON.stringify(graphics)){hiddenGraphics=graphics;graphicVisibility=graphics;}
      }
      press=retirePresentedPress(press,sample.frame,hidden,sample.retiredMovieButtons);
      if(interactiveArtwork&&placementTransforms!==undefined){
        transformBytes+=replayTransformSize(placementTransforms);
        if(transformBytes>replayTransformByteLimit)throw Error('Replay transforms exceed the 64 MiB artwork limit.');
      }
      if(interactiveArtwork&&spawnedGraphics!==undefined){
        spawnBytes+=replaySpawnSize(spawnedGraphics);
        if(spawnBytes>replaySpawnByteLimit)throw Error('Replay spawned artwork exceeds the 64 MiB artwork limit.');
      }
      appended.push({...pressedPose(sample,press),...(visibility!==undefined?{hiddenButtons:visibility}:{}),
        ...(graphicVisibility!==undefined?{hiddenGraphics:graphicVisibility}:{}),
        ...(interactiveArtwork&&placementTransforms!==undefined?{placementTransforms,replayTransformBytes:transformBytes}:{}),
        ...(interactiveArtwork&&spawnedGraphics!==undefined?{spawnedGraphics,replaySpawnBytes:spawnBytes}:{})});
    }
    return {appended,press};
  }
  const eventBytes=(values:PreviewInput[],includeButtons=false)=>{
    const encoder=new TextEncoder();
    return values.reduce((sum,value)=>sum+encoder.encode(
      JSON.stringify(value.textInput?{...value.data,textInput:value.textInput}:value.data)).byteLength+
      (includeButtons&&value.buttonInput?encoder.encode(JSON.stringify(value.buttonInput)).byteLength:0),0);
  };
  let poses:ScriptPose[]=[{frame:0,tick:0}],bookmarkPoses:ScriptPose[]=[];
  type RecordedText={change:ReplayTextChange;bytes:number};
  let replayText:readonly RecordedText[]=[],bookmarkText:readonly RecordedText[]=[];
  function appendReplayText(history:readonly RecordedText[],samples:readonly ScriptPresentationSample[]){
    let prior=history.at(-1);
    let previous=JSON.stringify(prior?.change.values??null);
    const added:RecordedText[]=[];
    const encoder=new TextEncoder();
    for(const {tick,textValues} of samples){
      if(textValues===undefined)continue;
      const stamp=JSON.stringify(textValues);
      if(stamp===previous)continue;
      const change={tick,values:textValues};
      const bytes=(prior?.bytes??2)+encoder.encode(JSON.stringify(change)).byteLength+(prior?1:0);
      if(bytes>replayTextByteLimit)throw Error('Replay text exceeds the 64 MiB artwork limit.');
      prior={change,bytes};previous=stamp;
      added.push(prior);
    }
    return added.length?[...history,...added]:history;
  }
  let imageBlob:Blob|undefined;
  let imageHistory:SymbolArtworkHistory|undefined,initialHistory:SymbolArtworkHistory|undefined,bookmarkHistory:SymbolArtworkHistory|undefined;
  function prepareImage(blob?:Blob){
    if(scope==='symbol'&&blob&&!capturedArtworkHistory)throw Error('No qualified local artwork history.');
    const history=scope==='symbol'&&blob?capturedArtworkHistory!.capture(blob):undefined;
    let pendingUrl=blob?URL.createObjectURL(blob):'';
    return {
      publish(){
        const old=imageUrl;
        imageHistory=history;imageUrl=pendingUrl;imageBlob=blob;pendingUrl='';
        if(scope==='symbol'&&old)capturedQueue=capturedQueue.map(event=>event.targetBlob?{...event,targetBlob:undefined}:event);
        if(old)URL.revokeObjectURL(old);
      },
      discard(){if(pendingUrl)URL.revokeObjectURL(pendingUrl);},
    };
  }
  function replaceImage(blob?:Blob){prepareImage(blob).publish();}
  type LocalVisualChange={delivery:SymbolArtworkDelivery;validate:()=>void}|{query:SymbolArtworkTargetQuery;state:'up'|'over'}|{query:SymbolArtworkTargetQuery;input:Pick<ScriptButtonHoverInput,'type'|'pointerId'|'button'>};
  async function render(next:PresentationPose[],signal:AbortSignal,state?:ScriptState,history?:SymbolArtworkHistory,hover?:LocalVisualChange,continueLocal=false){
    if(!showArtwork)return undefined;
    if(scope==='symbol'){
      if(!renderCapturedArtwork)throw new Error('No qualified local artwork presentation.');
      validateCurrent();let blob:Blob;const textValues=state?.[scriptTextStateKey],hiddenPlacements=state?.[hiddenPlacementsKey],placementTransforms=state?.[placementTransformsKey],spawnedGraphics=state?.[spawnedGraphicsKey];
      if(history&&capturedArtworkHistory)blob=await capturedArtworkHistory.restore(history,signal);
      else if(continueLocal){
        if(!imageBlob||!continueCapturedArtwork||!hoverCapturedArtwork)throw new Error('No qualified local hover presentation.');
        const appended=$state.snapshot(next).slice(poses.length).map(({frame,tick})=>({frame,tick}));
        if(hover){if(appended.length!==1)throw new Error('Pointer delivery requires one local host tick.');if('delivery' in hover){if(!publishCapturedDelivery)throw new Error('No qualified local activation publication.');blob=await publishCapturedDelivery(hover.delivery,appended[0],signal,hover.validate,textValues,hiddenPlacements,placementTransforms,spawnedGraphics);}else if('input' in hover){if(!pressCapturedArtwork)throw new Error('No qualified local press presentation.');blob=await pressCapturedArtwork(imageBlob,hover.query,hover.input,appended[0],signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics);}else blob=await hoverCapturedArtwork(imageBlob,hover.query,hover.state,appended[0],signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics);}
        else blob=await continueCapturedArtwork(imageBlob,appended,signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics);
      }else blob=await renderCapturedArtwork($state.snapshot(next).map(({frame,tick})=>({frame,tick})),signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics);
      signal.throwIfAborted();validateCurrent();return blob;
    }
    if(!artworkAvailable||!artwork)throw new Error('No qualified artwork presentation in this inspector.');
    const {renderScriptArtwork}=await import('./script-artwork');signal.throwIfAborted();
    return renderScriptArtwork(applyStagePresentation($state.snapshot(artwork),state,new Set(),next.at(-1)),$state.snapshot(next),signal,state?.[scriptTextStateKey]);
  }
  const cancelledStatus='Preview operation cancelled; completed state retained.';
  function cancel(){controller?.abort();}
  const soundLoader=untrack(()=>loadScriptSound);
  let nestedGraphicsEnabled=$state(false);
  const nestedGraphicsAvailable=$derived(scope==='main'&&artwork?.symbols?.some(symbol=>symbol.timeline?.frameScripts?.length));
  const ownedSoundSource=untrack(()=>soundSource);
  const subscribeSound=untrack(()=>subscribeSoundDisposal);
  let soundEnabled=$state(false),soundFiles=$state.raw<Record<string,File>>({});
  type PreparedSound={output:ReturnType<typeof createScriptSoundPreview>;close:()=>void};
  let soundSession:PreparedSound|undefined;
  let soundHistory:ScriptSoundCue[]=[],bookmarkSounds:ScriptSoundCue[]=[];
  const previewSoundSource=$derived(artwork??ownedSoundSource);
  const soundLinks = $derived(previewSoundSource?.libraryLinks?.flatMap(link=>{
    const asset=link.kind==='audio' && previewSoundSource?.assets.find(item=>item.id===link.id&&item.audio);
    return asset ? [{name:link.name,path:asset.path}] : [];
  })??[]);
  function chooseSound(path:string,event:Event){
    const file=(event.currentTarget as HTMLInputElement).files?.[0],files={...soundFiles};
    if(file)files[path]=file;else delete files[path];
    soundFiles=files;
  }
  function closeSound(){
    const previous=soundSession;soundSession=undefined;
    previous?.close();
  }
  async function prepareSound(signal:AbortSignal):Promise<PreparedSound|undefined>{
    const source=previewSoundSource;
    if(!soundEnabled||!soundLinks.length||!source)return;
    const files=soundFiles;
    const load:ScriptSoundLoader=soundLoader??(async path=>{
      const file=files[path];
      if(!file)throw Error('Select a WAV file for this script sound link.');
      return file;
    });
    const context=new AudioContext();
    let rejectStop:(reason:unknown)=>void=()=>{};
    const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
    const abort=()=>rejectStop(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Script sound could not start.')),10000);});
    try{
      await Promise.race([context.resume(),stopped,deadline]);
      signal.throwIfAborted();
      if(context.state!=='running')throw Error('Script sound could not start.');
      const output=createScriptSoundPreview(context,$state.snapshot(source),load);
      return {output,close(){output.stop();void context.close().catch(()=>{});}};
    }catch(error){
      void context.close().catch(()=>{});
      throw error;
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  onMount(()=>subscribeSound?.(()=>{cancel();closeSound();}));
  onDestroy(()=>{releasePointers();cancel();controller=undefined;preview?.dispose();closeSound();imageHistory=initialHistory=bookmarkHistory=undefined;if(imageUrl)URL.revokeObjectURL(imageUrl);});
  async function prepareLocal(){
    if(busy)return;
    const previous=preview,job=new AbortController();controller=job;busy=true;status='Preparing saved scripts…';
    let candidate:typeof preview,candidateSound:PreparedSound|undefined;
    try{
      validateCurrent();if(!capturedPrepare)throw new Error('A qualified local program factory is required.');
      candidateSound=await prepareSound(job.signal);
      job.signal.throwIfAborted();validateCurrent();
      const output=await capturedPrepare({}, {signal:job.signal,allowSound:!!candidateSound,boundedEngine:true});candidate=output.preview;
      job.signal.throwIfAborted();validateCurrent();if(controller!==job)return;
      if(!candidate){diagnostics=output.diagnostics;status='Fix the saved source diagnostics before running.';return;}
      const trajectory=[{frame:0,tick:0}],blob=await render(trajectory,job.signal),checkpoint=candidate.checkpoint();
      job.signal.throwIfAborted();validateCurrent();if(controller!==job)return;
      replaceImage(blob);previous?.dispose();preview=candidate;candidate=undefined;
      closeSound();soundSession=candidateSound;candidateSound=undefined;soundHistory=[];bookmarkSounds=[];
      initial=checkpoint;snapshot=checkpoint;inputReset++;initialHistory=imageHistory;bookmarkHistory=undefined;bookmark=undefined;diagnostics=[];failedFrame=undefined;failedLocation=undefined;
      poses=trajectory;bookmarkPoses=[];inputs=[];bookmarkInputs=[];playback=[];bookmarkPlayback=[];events=[];bookmarkEvents=[];
      buttonState={version:1,press:{version:1,pressed:null},hover:null};capturedQueue=[];captureKeys=false;capturePointers=false;captureHover=false;includePointerTarget=false;releasePointers();
      status='Ready. No scripts have run.';
    }catch(error){if(controller===job)status=String(error);}
    finally{candidate?.dispose();candidateSound?.close();if(controller===job){controller=undefined;busy=false;}}
  }
  async function prepare(){
    if(scope==='symbol')return prepareLocal();
    soundHistory=[];bookmarkSounds=[];
    replayText=[];bookmarkText=[];
    cancel();closeSound();preview?.dispose();preview=undefined;snapshot=undefined;initial=undefined;bookmark=undefined;diagnostics=[];failedFrame=undefined;failedLocation=undefined;poses=[{frame:0,tick:0}];bookmarkPoses=[];inputs=[];bookmarkInputs=[];playback=[];bookmarkPlayback=[];events=[];bookmarkEvents=[];buttonState={version:1,press:{version:1,pressed:null},hover:null};capturedQueue=[];captureKeys=false;capturePointers=false;captureHover=false;includePointerTarget=false;releasePointers();replaceImage();
    const job=new AbortController();controller=job;busy=true;status='Preparing saved scripts…';
    let candidateSound:PreparedSound|undefined;
    try{
      validateCurrent();candidateSound=await prepareSound(job.signal);const api=await import('../../../packages/scripting/src/preview');
      if(job.signal.aborted)return;
      const output=capturedPrepare?await capturedPrepare({}, {signal:job.signal,allowSound:!!candidateSound,boundedEngine:true}):await api.prepareScriptPreview(config,sources,{}, {signal:job.signal,artwork,allowDirectButtons:true,allowSound:!!candidateSound,allowNestedGraphics:nestedGraphicsEnabled,boundedEngine:true,validateSource:validateCurrent,stage:artwork?{width:artwork.width,height:artwork.height,layerCount:artwork.layers.length}:undefined});
      if(controller!==job){output.preview?.dispose();return;}
      try{validateCurrent();}catch(error){output.preview?.dispose();throw error;}
      diagnostics=output.diagnostics;preview=output.preview;
      if(preview){
        const blob=await render(poses,job.signal);job.signal.throwIfAborted();validateCurrent();
        if(controller!==job)return;replaceImage(blob);
      }
      initial=preview?.checkpoint();snapshot=initial;
      if(preview){soundSession=candidateSound;candidateSound=undefined;}
      status=preview?'Ready. No scripts have run.':'Fix the saved source diagnostics before running.';
    }catch(error){if(controller===job){preview?.dispose();preview=undefined;closeSound();status=String(error);}}
    finally{candidateSound?.close();if(controller===job){controller=undefined;busy=false;}}
  }
  type FieldDelivery={key:string; input:ScriptTextInput};
  function advanceBreakpoint(action:DebugAction){
    if(!paused||!controller)return;
    try{
      validateCurrent();controller.signal.throwIfAborted();
      paused[action]?.();paused=undefined;
      status={into:'Stepping into function…',out:'Stepping out of function…',step:'Stepping over statement…',resume:'Continuing saved script…'}[action];
    }
    catch(error){controller.abort(error);}
  }
  async function run(ticks:number,playing?:boolean,sendInput:boolean|'key'|'pointer'|'cancelPress'|FieldDelivery=false,transport?:boolean,runToFrame=false,runToState=false,debug=false){
    if(!preview||busy)return;
    const runtime=preview;let before:ScriptPreviewCheckpoint;try{validateCurrent();before=runtime.checkpoint();}catch(error){status=String(error);return;}
    const job=new AbortController();controller=job;busy=true;failedFrame=undefined;failedLocation=undefined;status='Running isolated scripts…';
    try{validateCurrent();
      const line=breakpointLine,frame=breakpointFrame,explicitSource=selectedBreakpointFrame!==undefined;
      if(debug&&(!Number.isSafeInteger(line)||line!<1))
        throw Error('Enter the source line of an executable statement.');
      if(debug&&explicitSource&&(frame!==before.session.timeline.frame||!before.session.entryPending)&&inputs.length>=10000)
        throw Error('Preview supports at most 10000 seek inputs. Reset to continue.');
      let stopAtFrames:number[]|undefined,stopWhenState:ScriptStateStop[]|undefined;
      if(runToState){
        if(!Number.isSafeInteger(stateBudget)||stateBudget!<1||stateBudget!>1000)throw new Error('Choose a state tick budget between 1 and 1000.');
        ticks=stateBudget!;stopWhenState=[parseScriptStateStop(statePath,stateValue,stateComparison)];
      }
      if(runToFrame){
        if(!Number.isSafeInteger(stopFrame)||stopFrame!<1||stopFrame!>config.duration)
          throw new Error('Choose a whole stop frame within this timeline.');
        if(!Number.isSafeInteger(stopBudget)||stopBudget!<1||stopBudget!>1000)
          throw new Error('Choose a tick budget between 1 and 1000.');
        ticks=stopBudget!;stopAtFrames=[...new Set([stopFrame!-1,...parseScriptStopFrames(additionalStops,config.duration)])];
      }
      if(showArtwork&&poses.length+ticks>10001)throw new Error('Artwork preview supports at most 10000 ticks. Reset to continue.');
      let commands:ScriptPlaybackInput[]=[];
      if(transport!==undefined){
        if(playback.length>=10000)throw new Error('Preview supports at most 10000 playback inputs. Reset to continue.');
        commands=[{tick:before.session.timeline.tick,playing:transport}];
      }
      let seeks:ScriptSeekInput[]=[];
      if(playing!==undefined){
        if(!Number.isSafeInteger(seekFrame)||seekFrame!<1||seekFrame!>config.duration)throw new Error('Choose a whole frame within this timeline.');
        if(inputs.length>=10000)throw new Error('Preview supports at most 10000 seek inputs. Reset to continue.');
        seeks=[{tick:before.session.timeline.tick,frame:seekFrame!-1,playing}];
      }
      let localHoverChange:LocalVisualChange|undefined;
      let delivered:ScriptDataInput[]=[],preparedButton:ScriptButtonHoverInput|undefined;
      let nextButtonPress=buttonState;
      if(sendInput){
        let data:ScriptState;
        let textInput:ScriptTextInput|undefined;
        if((sendInput==='pointer'||sendInput==='key')&&capturedQueue[0]?.kind!==sendInput)throw new Error('Deliver the oldest captured input first, or explicitly clear it.');
        if(sendInput==='cancelPress'){
          if(!buttonPress.pressed)throw new Error('No button press is active.');
          data={type:'pointercancel',pointerId:buttonPress.pressed.pointerId,button:-1,buttonTarget:null};
        }else if(sendInput==='pointer'){
          if(!pointerQueue.length)throw new Error('No pointer input is queued.');
          data=cloneScriptState(pointerQueue[0]);
          const captured=capturedQueue[0];
          if(captured.targetImage!==undefined){
            if(!pointerArtwork||!showArtwork||!imageUrl||captured.targetImage!==imageUrl)throw new Error('Captured pointer target is stale. Clear queued pointers and capture against the current artwork.');
            if(scope==='symbol'){
              if(!queryCapturedArtwork||!imageBlob||captured.targetBlob!==imageBlob||pointerHost?.querySelector('img')?.src!==imageUrl)throw new Error('Captured local artwork image is stale.');
              const blob=imageBlob,target=await queryCapturedArtwork(blob,[{x:data.x as number,y:data.y as number}],job.signal);
              job.signal.throwIfAborted();validateCurrent();
              if(controller!==job||captured.targetImage!==imageUrl||imageBlob!==blob||capturedQueue[0]!==captured||pointerHost?.querySelector('img')?.src!==imageUrl||target.width!==captured.targetWidth||target.height!==captured.targetHeight)throw new Error('Captured local target changed during lookup.');
              if(localPress&&localActivation){
                if(!qualifyCapturedArtwork)throw new Error('No qualified local activation delivery.');
                const delivery=qualifyCapturedArtwork(blob,target,{type:data.type as ScriptButtonHoverInput['type'],pointerId:data.pointerId as number,button:data.button as number});
                const verifyInput=()=>{validateCurrent();if(controller!==job||captured.targetImage!==imageUrl||imageBlob!==blob||capturedQueue[0]!==captured||pointerHost?.querySelector('img')?.src!==imageUrl)throw new Error('Qualified local input or displayed image changed.');};
                data=cloneScriptState({...data,...delivery.input()});verifyInput();localHoverChange={delivery,validate:verifyInput};
              }else if(localPress)localHoverChange={query:target,input:{type:data.type as ScriptButtonHoverInput['type'],pointerId:data.pointerId as number,button:data.button as number}};
              else if(localHover&&(data.type==='pointermove'||data.type==='pointerleave'))localHoverChange={query:target,state:data.type==='pointerleave'||!target.targets[0]?'up':'over'};
              data=cloneScriptState({...data,buttonTarget:target.targets[0],targetFrame:target.frame,targetTick:target.tick,targetScope:'symbol-local',targetNamespace:target.namespace,targetImageId:target.imageId});
            }else{
              if(!artwork)throw new Error('No root artwork snapshot.');
              const {queryScriptArtworkTargets}=await import('./script-artwork');job.signal.throwIfAborted();
              const target=await queryScriptArtworkTargets(applyStagePresentation($state.snapshot(artwork),before.session.state,new Set(),poses.at(-1)),$state.snapshot(poses),[{x:data.x as number,y:data.y as number}],{signal:job.signal,textValues:before.session.state[scriptTextStateKey]});
              job.signal.throwIfAborted();validateCurrent();
              if(controller!==job||captured.targetImage!==imageUrl)throw new Error('Captured pointer target changed during lookup.');
              data=cloneScriptState({...data,buttonTarget:target.targets[0],targetFrame:target.frame,targetTick:target.tick});
            }
          }
        }else if(sendInput==='key'){
          if(!keyQueue.length)throw new Error('No keyboard input is queued.');
          data=cloneScriptState(keyQueue[0]);
        }else if(typeof sendInput==='object'){
          const input=captureScriptTextInput(sendInput.input);
          if(!scriptTextFields(fieldLayers,before.session.timeline.frame)
            .some(field=>field.key===sendInput.key&&field.binding===input.binding))
            throw Error('The preview text field is no longer available.');
          textInput=input;
          data={};
        }else{
          if(inputDraft.length>65536||new TextEncoder().encode(inputDraft).byteLength>65536)throw new Error('Input JSON text exceeds 64 KiB.');
          data=cloneScriptState(JSON.parse(inputDraft));
        }
        if(interactiveArtwork&&(sendInput==='cancelPress'||(sendInput==='pointer'&&(capturedQueue[0].targetImage!==undefined||buttonPress.pressed)))){
          preparedButton={type:data.type as ScriptButtonHoverInput['type'],pointerId:data.pointerId as number,button:data.button as number,
            target:(data.buttonTarget??null) as unknown as ScriptButtonHoverInput['target']};
          const transition=advanceScriptButtonHover(buttonState,preparedButton);nextButtonPress=transition.checkpoint;
          data=cloneScriptState({...data,buttonActivation:transition.activation});
        }
        delivered=[{tick:before.session.timeline.tick,data,...(textInput?{textInput}:{})}];
        const withButton=preparedButton?{...delivered[0],buttonInput:preparedButton}:delivered[0];
        const countButtons=!!before.session.nestedButtons;
        if(events.length>=10000||eventBytes(events,countButtons)+eventBytes([withButton],countButtons)>256*1024)
          throw new Error('Retained input history exceeds 10000 events or 256 KiB. Reset to continue.');
      }
      const next=await runtime.runWithPresentation(ticks,{signal:job.signal,seeks,events:delivered,playback:commands,stopAtFrames,stopWhenState,
        ...(debug?{timeoutMs:60000,breakpoint:{frame,line:line!,...(explicitSource?{seek:true as const}:{}),onPause(pause:ScriptPause){
          job.signal.throwIfAborted();validateCurrent();
          if(controller!==job)throw Error('The script breakpoint is stale.');
          selectedStackFrame=0;paused=pause;status=`Paused before ${scope==='symbol'?'local ':''}frame ${pause.frame+1}, line ${pause.line}, column ${pause.column}.`;
        }}}:{}),
        ...(preparedButton?{hostButtons:[{tick:before.session.timeline.tick,pointer:preparedButton}]}:{})});
      job.signal.throwIfAborted();validateCurrent();
      const completed=next.checkpoint.session.timeline.tick-before.session.timeline.tick;
      const completion=next.stoppedOnState.length
        ? `State condition matched at frame ${next.checkpoint.session.timeline.frame+1} after ${completed} script tick${completed===1?'':'s'}.`
        : next.stoppedAt===undefined
        ? `Completed ${completed} script tick${completed===1?'':'s'}.`+(runToFrame||runToState?' Tick budget exhausted before target.':'')
        : `Stopped at frame ${next.stoppedAt+1} after ${completed} script tick${completed===1?'':'s'}.`;
      if(!completed){if(controller===job){snapshot=next.checkpoint;status=completion;}return;}
      const prepared=showArtwork ? appendPreviewPoses(poses,next.presentation.slice(1),nextButtonPress) : undefined;
      const trajectory=prepared ? [...poses,...prepared.appended] : poses;
      const nextText=interactiveArtwork&&showArtwork?appendReplayText(replayText,next.presentation):replayText;
      if(prepared)nextButtonPress=prepared.press;
      const cues=next.soundCues??[];
      if(soundHistory.length+cues.length>10000)throw Error('Retained script sound cue budget exceeded. Reset to continue.');
      const publishSound=soundSession&&cues.length
        ? await soundSession.output.prepare(cues,config.fps,job.signal) : undefined;
      const blob=await render(trajectory,job.signal,next.checkpoint.session.state,undefined,localHoverChange,scope==='symbol'&&(localHover||localPress));job.signal.throwIfAborted();validateCurrent();
      if(controller===job){
        const image=prepareImage(blob);
        try{job.signal.throwIfAborted();validateCurrent();if(controller!==job)return;publishSound?.();image.publish();}
        finally{image.discard();}
        soundHistory.push(...cues);poses=trajectory;replayText=nextText;inputs=[...inputs,...next.seeks];playback=[...playback,...next.playback];events=[...events,...next.events.map(value=>({...value,...(preparedButton?{buttonInput:preparedButton}:{})}))];buttonState=nextButtonPress;if(next.events.length&&(sendInput==='key'||sendInput==='pointer'))capturedQueue=capturedQueue.slice(1);snapshot=next.checkpoint;status=completion;
      }
    }catch(error){
      try{runtime.restore(before);}catch{/* Closed previews have already been disposed. */}
      const {ScriptFrameExecutionError}=await import('../../../packages/scripting/src/session');
      if(controller===job){status=String(error);failedFrame=error instanceof ScriptFrameExecutionError?error.frame:undefined;failedLocation=error instanceof ScriptFrameExecutionError?error.sourceLocation:undefined;}
    }
    finally{if(controller===job){controller=undefined;busy=false;paused=undefined;}}
  }
  async function replayHistory(output:'preview'|'html'|'video'='preview'){
    if(busy||!preview||!initial)return;
    const exporting=output!=='preview';
    const runtime=preview;let before:ScriptPreviewCheckpoint;try{validateCurrent();before=runtime.checkpoint();}catch(error){status=String(error);return;}const ticks=before.session.timeline.tick;
    if(ticks>10000){status='Replay supports at most 10000 ticks. Reset to start a shorter history.';return;}
    if(exporting){
      try{
        license.assertOutputAllowed();
        if(scope!=='main'||!showArtwork||!artwork||!ticks)throw Error('Complete a scene script preview with detached artwork before exporting.');
      }catch(error){status=String(error);return;}
    }
    const retainedHistory=imageHistory,retained=inputs.map(p=>({...p})),retainedEvents=copyEvents(events),retainedPlayback=playback.map(p=>({...p})),job=new AbortController();
    controller=job;busy=true;failedFrame=undefined;failedLocation=undefined;status=exporting?'Verifying script replay for export…':'Re-executing retained history…';
    let timer=setTimeout(()=>job.abort(new Error('Script history replay timed out.')),10000);
    try{
      validateCurrent();if(scope==='symbol'&&showArtwork&&!retainedHistory)throw new Error('No qualified local artwork history.');const replayedPress=replayButtonPress(retainedEvents,poses);
      if(JSON.stringify(replayedPress)!==JSON.stringify(buttonState))throw new Error('Button press replay differs.');
      runtime.restore(initial);
      const trajectory:ScriptPose[]=[{frame:0,tick:0}];
      let visualPress:ScriptButtonHoverCheckpoint={version:1,press:{version:1,pressed:null},hover:null};
      const pointerEvents=new Map(retainedEvents.filter(e=>e.buttonInput).map(e=>[e.tick,e.buttonInput!]));
      const replayedSounds:ScriptSoundCue[]=[];
      let replayedText:readonly RecordedText[]=[];
      // Keep export replay cancellable at each consumed tick.
      const batchSize=exporting?1:soundSession?MAX_SCRIPT_SOUND_CUES:1000;
      function indexInputs<T extends {tick:number}>(values:readonly T[]){
        const byTick=new SvelteMap<number,T[]>();
        if(exporting)for(const value of values){
          const group=byTick.get(value.tick);
          if(group)group.push(value);else byTick.set(value.tick,[value]);
        }
        return (start:number,count:number)=>exporting?byTick.get(start)??[]:
          values.filter(value=>value.tick>=start&&value.tick<start+count);
      }
      const eventsIn=indexInputs(retainedEvents),seeksIn=indexInputs(retained),playbackIn=indexInputs(retainedPlayback);
      for(let start=0;start<ticks;start+=batchSize){
        job.signal.throwIfAborted();
        const count=Math.min(batchSize,ticks-start);
        const batchEvents=eventsIn(start,count);
        const next=await runtime.runWithPresentation(count,{signal:job.signal,seeks:seeksIn(start,count),events:batchEvents,playback:playbackIn(start,count),
          hostButtons:batchEvents.flatMap(p=>p.buttonInput?[{tick:p.tick,pointer:p.buttonInput}]:[])});
        if(interactiveArtwork&&showArtwork)replayedText=appendReplayText(replayedText,next.presentation);
        if(next.soundCues)replayedSounds.push(...next.soundCues);
        if(showArtwork){
          const prepared=appendPreviewPoses(trajectory,next.presentation.slice(1),visualPress,(tick,press)=>{
            const pointer=pointerEvents.get(tick);
            return pointer ? advanceScriptButtonHover(press,pointer).checkpoint : press;
          });
          visualPress=prepared.press;
          trajectory.push(...prepared.appended);
        }
      }
      job.signal.throwIfAborted();validateCurrent();
      const replayed=runtime.checkpoint();
      if(JSON.stringify(replayed)!==JSON.stringify(before)||(showArtwork&&JSON.stringify(trajectory)!==JSON.stringify(poses)))
        throw new Error('Replay differed from retained state or trajectory. Previous preview retained.');
      if(JSON.stringify(replayedSounds)!==JSON.stringify(soundHistory))
        throw new Error('Replay differed from retained sound cues. Previous preview retained.');
      if(replayedText.length!==replayText.length||replayedText.some(({change},index)=>
        JSON.stringify(change)!==JSON.stringify(replayText[index].change)))
        throw Error('Replay differed from retained text. Previous preview retained.');
      if(exporting){
        const source=$state.snapshot(artwork!);
        const admit=()=>{
          job.signal.throwIfAborted();validateCurrent();license.assertOutputAllowed();
          if(controller!==job||preview!==runtime)throw Error('Script preview changed during export.');
        };
        if(output==='video'){
          clearTimeout(timer);timer=setTimeout(()=>job.abort(Error('Script replay video timed out.')),60000);
          status='Encoding recorded script replay…';
        }
        let replayWave:Uint8Array|undefined;
        if(replayedSounds.length){
          if(!soundSession)throw Error('The recorded sound source is no longer available.');
          replayWave=await soundSession.output.bakeReplay(replayedSounds,source.fps,ticks,job.signal,output==='video'?48000:undefined);
          admit();
        }
        const replayChanges=replayedText.map(entry=>entry.change);
        let blob:Blob;
        if(output==='video'){
          const {encodeScriptReplayVideo}=await import('./script-replay-video');
          blob=await encodeScriptReplayVideo(source,trajectory,replayChanges,replayWave,job.signal,admit);
        }else{
          const {compileScriptArtwork}=await import('./script-artwork-compile');
          const html=await compileScriptArtwork(source,trajectory,{signal:job.signal,playback:true,replayText:replayChanges,replayWave});
          const {verifyScriptReplayAssets}=await import('./script-artwork');
          await verifyScriptReplayAssets(html,job.signal);
          blob=new Blob([html],{type:'text/html'});
        }
        admit();
        const url=URL.createObjectURL(blob);
        try{
          const link=document.createElement('a');link.href=url;
          link.download=(source.name.replace(/[^a-zA-Z0-9 _-]/g,'_')||'Splash')+`-script-replay.${output==='video'?'webm':'html'}`;
          admit();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(error){URL.revokeObjectURL(url);throw error;}
        status=`Downloaded script replay ${output==='video'?'WebM':'HTML'} with ${ticks} recorded ticks.`;
        return;
      }
      const blob=await render(trajectory,job.signal,replayed.session.state,retainedHistory);job.signal.throwIfAborted();validateCurrent();
      if(controller===job){soundSession?.output.stop();replaceImage(blob);snapshot=replayed;inputReset++;poses=trajectory;status=`Replay matched ${ticks} ticks and ${retained.length} seek inputs.${retainedEvents.length?` ${retainedEvents.length} JSON inputs replayed.`:""}${retainedPlayback.length?` ${retainedPlayback.length} playback inputs replayed.`:""}`;}
    }catch(error){
      try{runtime.restore(before);}catch{/* A closed preview is disposed. */}
      const {ScriptFrameExecutionError}=await import('../../../packages/scripting/src/session');
      if(controller===job){status=String(error);failedFrame=error instanceof ScriptFrameExecutionError?error.frame:undefined;failedLocation=error instanceof ScriptFrameExecutionError?error.sourceLocation:undefined;}
    }finally{clearTimeout(timer);if(controller===job){controller=undefined;busy=false;}}
  }
  async function downloadInteractiveHTML(){
    if(busy||scope!=='main'||!artwork||!sources.length)return;
    const job=new AbortController();
    controller=job;busy=true;status='Preparing interactive script HTML…';
    const active=()=>{
      job.signal.throwIfAborted();validateCurrent();license.assertOutputAllowed();
      if(controller!==job)throw Error('Script preview changed during export.');
    };
    const timer=setTimeout(()=>job.abort(Error('Interactive HTML export timed out.')),60000);
    try{
      active();
      const source=$state.snapshot(artwork);
      const {buildInteractiveScriptHTML}=await import('./standalone-script-export');
      const html=await buildInteractiveScriptHTML(source,job.signal,active);
      active();
      const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
      try{
        const link=document.createElement('a');link.href=url;
        link.download=(source.name.replace(/[^a-zA-Z0-9 _-]/g,'_')||'Splash')+'-interactive.html';
        active();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(error){URL.revokeObjectURL(url);throw error;}
      status='Downloaded interactive script HTML.';
    }catch(error){
      if(controller===job)status=job.signal.reason?.name==='AbortError'?cancelledStatus:String(error);
      job.abort(error);
    }finally{clearTimeout(timer);if(controller===job){controller=undefined;busy=false;}}
  }
  function captureCheckpoint(){
    if(busy)return;
    try{validateCurrent();if(preview){const target=preview.checkpoint(),trajectory=poses.map(p=>({...p})),seeks=inputs.map(p=>({...p})),transport=playback.map(p=>({...p})),data=copyEvents(events),history=scope==='symbol'&&imageBlob?capturedArtworkHistory?.capture(imageBlob):undefined;validateCurrent();bookmark=target;bookmarkPoses=trajectory;bookmarkText=replayText;bookmarkInputs=seeks;bookmarkPlayback=transport;bookmarkEvents=data;bookmarkSounds=soundHistory.slice();bookmarkHistory=history;status='Checkpoint captured for this prepared source snapshot.';}}
    catch(error){status=String(error);}
  }
  async function restore(target:ScriptPreviewCheckpoint|undefined,trajectory:ScriptPose[],retainedInputs:ScriptSeekInput[],retainedEvents:PreviewInput[],retainedPlayback:ScriptPlaybackInput[],retainedSounds:ScriptSoundCue[],message:string,history?:SymbolArtworkHistory,text:readonly RecordedText[]=[]){
    if(busy||!preview||!target)return;
    const runtime=preview;let before:ScriptPreviewCheckpoint;try{validateCurrent();before=runtime.checkpoint();}catch(error){status=String(error);return;}
    const job=new AbortController();controller=job;busy=true;
    try{validateCurrent();if(scope==='symbol'&&showArtwork&&!history)throw new Error('No qualified local artwork history.');const restoredPress=replayButtonPress(retainedEvents,trajectory);runtime.restore(target);const restored=runtime.checkpoint();const blob=await render(trajectory,job.signal,restored.session.state,history);job.signal.throwIfAborted();validateCurrent();
      if(controller===job){soundSession?.output.stop();replaceImage(blob);snapshot=restored;inputReset++;poses=trajectory.map(p=>({...p}));replayText=text;inputs=retainedInputs.map(p=>({...p}));playback=retainedPlayback.map(p=>({...p}));events=copyEvents(retainedEvents);soundHistory=retainedSounds.slice();buttonState=restoredPress;capturedQueue=[];captureKeys=false;capturePointers=false;captureHover=false;includePointerTarget=false;releasePointers();failedFrame=undefined;failedLocation=undefined;status=message;}
    }catch(error){try{runtime.restore(before);}catch{/* Closed or invalidated local previews cannot restore. */}if(controller===job)status=String(error);}
    finally{if(controller===job){controller=undefined;busy=false;}}
  }
  function restoreCheckpoint(){return restore(bookmark,bookmarkPoses,bookmarkInputs,bookmarkEvents,bookmarkPlayback,bookmarkSounds,'Checkpoint restored. Use Step or Run to replay.',bookmarkHistory,bookmarkText);}
  function openFailure(){try{validateCurrent();if(failedFrame!==undefined)openCapturedSource(failedFrame,failedLocation);}catch(error){status=String(error);}}
  function openPausedSource(){
    const point=visibleStackFrame,current=paused;
    if(!point||!current)return;
    try{validateCurrent();openCapturedSource(current.frame,{line:point.line,column:point.column});}
    catch(error){status=String(error);}
  }
  function openBreakpointSource(){
    const source=breakpointSource,line=breakpointLine;
    if(!source||busy)return;
    try{validateCurrent();openCapturedSource(source.frame,line!==undefined&&Number.isSafeInteger(line)&&line>0?{line,column:1}:undefined);}
    catch(error){status=String(error);}
  }
  function openCurrentSource(){
    if(busy||!snapshot)return;
    try{validateCurrent();openCapturedSource(snapshot.session.timeline.frame);}catch(error){status=String(error);}
  }
  function openDiagnostic(d:ProgramDiagnostic){try{validateCurrent();openCapturedSource(d.frame,{line:d.line,column:d.column});}catch(error){status=String(error);}}
  function reset(){return restore(initial,[{frame:0,tick:0}],[],[],[],[],'Reset to the initial preview state.',initialHistory);}

</script>
<h2>{scope==='symbol'?'Inspect local timeline scripts':'Preview saved scripts'}</h2>
{#if scope==='symbol'}<p>Runs only this symbol's captured {sources.length} local-frame bodies in isolated browser workers. Prepare checks source; Step and Run execute it. State starts empty at local frame 1. Main and descendant scripts do not run, and this inspector does not change the symbol draft or document. Normal playback, Test Movie and exports remain script-free.</p>{:else}
<p>Runs the captured {sources.length} main-frame bodies in isolated browser workers. Prepare checks saved source; Step and Run execute it. State starts empty at frame 1. This inspector does not change your document.</p>{/if}
{#if scope==='symbol'}<p>Local timeline: {config.duration} frames · {config.fps} fps · Seed {config.seed}.</p>{/if}
<p>Stopped entries run once. Script-authored seeks dispatch on the next tick. Runs have a 10-second batch deadline and a one-second frame deadline.</p>
<p>Each script dispatch has a 16 MiB guest heap limit.</p>
{#if nestedGraphicsAvailable}
  <label><input type="checkbox" bind:checked={nestedGraphicsEnabled} disabled={busy||!!snapshot} /> Run placed symbol frame scripts</label>
  {#if nestedGraphicsEnabled}<p>Direct Buttons run the saved Up, Over, and Down frame scripts. A matching primary release provides buttonActivation to that Button’s Over script.</p>{/if}
{/if}
{#if soundLinks.length}
  <label><input type="checkbox" bind:checked={soundEnabled} disabled={busy||!!snapshot} /> Enable scripted sound</label>
  {#if soundEnabled&&!soundLoader}
    {#each soundLinks as link (link.path)}
      <label>WAV for {link.name} <input type="file" accept=".wav,audio/wav" disabled={busy||!!snapshot} onchange={event=>chooseSound(link.path,event)} /></label>
    {/each}
  {/if}
{/if}
{#if artworkAvailable}<label><input type="checkbox" bind:checked={showArtwork} disabled={busy||!!snapshot} /> Render detached artwork</label>
{#if scope==='symbol'&&showArtwork&&hoverCapturedArtwork&&continueCapturedArtwork}<label><input type="checkbox" bind:checked={localHover} disabled={busy||!!snapshot} /> Preview delivered local hover states</label>{/if}
{#if scope==='symbol'&&showArtwork&&pressCapturedArtwork&&continueCapturedArtwork}<label><input type="checkbox" bind:checked={localPress} disabled={busy||!!snapshot} /> Preview delivered local press states</label>{/if}
{#if scope==='symbol'&&showArtwork&&localPress&&qualifyCapturedArtwork&&publishCapturedDelivery}<label><input type="checkbox" bind:checked={localActivation} disabled={busy||!!snapshot} /> Deliver qualified local button activation</label>{/if}
{#if scope==='symbol'}<p>Images show this local timeline and its nested artwork over host ticks. {#if localPress}Explicitly delivered primary presses show Down, releases show Over on a hit or Up outside, and cancel clears Up. Later ticks retain private pointer ownership.{:else if localHover}Explicitly delivered hover movement can show Over; misses/leaves clear Up. Other ticks preserve the qualified visual history.{:else}Buttons stay in Up.{/if} Descendant sources do not run. Pointer input is delivered explicitly to this local body. {#if localPress&&localActivation}Matching primary releases deliver namespaced buttonActivation to this local body; other qualified pointers deliver null.{:else}Generated press activation is unavailable.{/if} Descendant handlers are unavailable.</p>{:else}<p>Artwork mode replays up to 10000 ticks. Accepted presses display Down while their target lifetime survives; cancel or an outside release returns to Up. State movies advance on host ticks and restart when their state frame changes. Optional hover capture records move/leave for explicit delivery; matching release retains Over until a delivered leave or miss.</p>{/if}
{#if imageUrl}
  <div class="script-artwork">
    <div bind:this={pointerHost} role="application"
      aria-label={scope==='symbol'?'Local script pointer target':'Script pointer target'}
      onpointerdown={capturePointer} onpointerup={capturePointer} onpointercancel={capturePointer}
      onpointermove={capturePointer} onpointerleave={capturePointer}
      onlostpointercapture={event=>capturedPointers.delete(event.pointerId)}
      style:touch-action={capturePointers?'none':'auto'}>
      <img bind:this={artworkImage} onload={measureArtwork}
        src={imageUrl} alt={scope==='symbol'?'Local script preview artwork':'Script preview artwork'}
        draggable="false" style="display:block;max-width:100%;max-height:280px" />
    </div>
    {#each overlayFields as field (field.key)}
      <ScriptInputText binding={field.binding} value={fieldValue(field.binding,field.content,snapshot?.session.state)}
        placement={field.placement} reset={inputReset} {busy} deliver={input=>run(1,undefined,{key:field.key,input})} />
    {/each}
  </div>
{/if}
{/if}
<button disabled={busy} onclick={prepare}>Prepare script preview</button>
<button disabled={busy||!snapshot} onclick={()=>run(1)}>Step script tick</button>
<button disabled={busy||!snapshot} onclick={()=>run(10)}>Run 10 script ticks</button>
{#if sources.length}
  <fieldset disabled={busy}>
    <legend>Source breakpoint</legend>
    <label>Breakpoint source
      <select aria-label="Breakpoint source" bind:value={selectedBreakpointFrame}>
        <option value={undefined}>Current frame</option>
        {#each sources as source (source.frame)}
          <option value={source.frame}>{scope==='symbol'?'Local frame':'Frame'} {source.frame+1}</option>
        {/each}
      </select>
    </label>
    <label>Breakpoint line
      <input type="number" min="1" step="1" disabled={!breakpointSource} value={breakpointLine??''}
        oninput={event=>{
          const value=event.currentTarget.valueAsNumber;
          breakpointLines.set(breakpointFrame,Number.isNaN(value)?undefined:value);
        }} />
    </label>
    <button disabled={!canDebug} onclick={()=>run(1,undefined,false,undefined,false,false,true)}>Debug script tick</button>
    <button disabled={!breakpointSource} onclick={openBreakpointSource}>Open breakpoint source</button>
    {#if selectedBreakpointFrame!==undefined&&breakpointSource}
      <details>
        <summary>View selected source</summary>
        <pre aria-label="Selected breakpoint source">{breakpointSource.source}</pre>
      </details>
    {/if}
  </fieldset>
  {#if paused && visibleStackFrame}
    {#if paused.stack.length>1}
      <section aria-label="Call stack">
        <h3>Call stack</h3>
        <ol>
          {#each paused.stack as frame,index (index)}
            <li><button aria-pressed={selectedStackFrame===index} onclick={()=>selectedStackFrame=index}>{frame.name} · Line {frame.line}</button></li>
          {/each}
        </ol>
      </section>
    {/if}
    <pre aria-label="Paused source line">{visibleStackFrame.line}  {pausedSourceLine?.slice(0,visibleStackFrame.column-1)}<mark>{pausedSourceLine?.slice(visibleStackFrame.column-1)}</mark></pre>
    <button onclick={openPausedSource}>Stop and open paused source</button>
    <section aria-label="Paused local variables">
      <h3>Locals</h3>
      {#if visibleStackFrame.locals.values.length}
        <dl class="paused-locals">
          {#each visibleStackFrame.locals.values as local (local.name)}
            <dt><code>{local.name}</code></dt>
            <dd><code>{local.value}</code></dd>
          {/each}
        </dl>
      {:else}
        <p>No inspected locals at this statement.</p>
      {/if}
      {#if visibleStackFrame.locals.omitted}<p>{visibleStackFrame.locals.omitted} locals exceed the inspection limit.</p>{/if}
    </section>
    <pre aria-label="Paused script state">{JSON.stringify(paused.state,null,2)}</pre>
    <button onclick={()=>advanceBreakpoint('step')}>Step Over</button>
    {#if paused.into}<button onclick={()=>advanceBreakpoint('into')}>Step Into</button>{/if}
    {#if paused.out}<button onclick={()=>advanceBreakpoint('out')}>Step Out</button>{/if}
    <button onclick={()=>advanceBreakpoint('resume')}>Continue script</button>
  {/if}
{/if}
<fieldset disabled={busy||!snapshot}>
  <legend>Run to frame</legend>
  <label>Stop at frame <input type="number" min="1" max={config.duration} step="1" bind:value={stopFrame} /></label>
  <label>Additional stop frames <input type="text" maxlength="16000" bind:value={additionalStops} placeholder="e.g. 5, 12, 30" /></label>
  <label>Run-to-frame tick budget <input type="number" min="1" max="1000" step="1" bind:value={stopBudget} /></label>
  <button onclick={()=>run(0,undefined,false,undefined,true)}>Run to script frame</button>
  <p>Stops at the first matching committed host pose, including the current pose. Additional frames are one-based, comma-separated (up to 999). Does not interrupt a body or deliver queued input. Step or ordinary Run resumes past a target; playback state stays unchanged.</p>
</fieldset>
<fieldset disabled={busy||!snapshot}>
  <legend>Run to state value</legend>
  <label>State condition path <input type="text" maxlength="16384" bind:value={statePath} /></label>
  <label>State comparison <select aria-label="State comparison" bind:value={stateComparison}><option value="equals">Equals (literal)</option><option value="changed">Changes during this run</option><option value="lt">Less than</option><option value="lte">Less than or equal</option><option value="gt">Greater than</option><option value="gte">Greater than or equal</option></select></label>
  {#if stateComparison!=='changed'}<label>State condition value <input type="text" maxlength="8192" bind:value={stateValue} /></label>{:else}<p>Stops when this primitive value or its presence changes from the start of this run. An initial object or array is unsupported. Each new run captures a fresh baseline.</p>{/if}
  <label>Run-to-state tick budget <input type="number" min="1" max="1000" step="1" bind:value={stateBudget} /></label>
  <button onclick={()=>run(0,undefined,false,undefined,false,true)}>Run to state value</button>
  <p>Path is a JSON string array, such as ["player", "score"] or ["items", "0"]. Equality accepts a JSON number, quoted string, boolean or null. Ordered comparisons require finite JSON numbers on both sides; strings and missing keys do not match. Missing keys do not match null. Stops at a matching host boundary, including the current state; does not interrupt a body or deliver queued input. Step or ordinary Run resumes.</p>
</fieldset>
<fieldset disabled={busy||!snapshot}>
  <legend>{scope==='symbol'?'Local playback':'Root playback'}</legend>
  <button onclick={()=>run(1,undefined,false,false)}>{scope==='symbol'?'Pause local and step':'Pause root and step'}</button>
  <button onclick={()=>run(1,undefined,false,true)}>{scope==='symbol'?'Resume local and step':'Resume root and step'}</button>
  {#if scope==='symbol'}<p>Changes this inspected local timeline and advances one host tick. Resume does not repeat a completed stopped entry. Descendant and button scripts do not run; authoring playback does not start.</p>{:else}<p>Changes root playback and advances one host tick. Resume does not repeat a completed stopped entry. Pending entries still run and script commands take precedence. Nested movies keep advancing; this does not start automatic playback.</p>{/if}
  <p aria-label="Retained script playback inputs">{playback.length} playback inputs retained (maximum 10000). Reset clears them; checkpoint restore and replay include them.</p>
</fieldset>
<fieldset disabled={busy||!snapshot}>
  <legend>Seek and execute one tick</legend>
  <label>Seek target frame <input type="number" min="1" max={config.duration} step="1" bind:value={seekFrame} /></label>
  <button onclick={()=>run(1,false)}>Seek stopped and step</button>
  <button onclick={()=>run(1,true)}>Seek playing and step</button>
  <p>The destination body runs immediately, even for a stopped or same-frame seek. Its commands take precedence. Playing advances afterward unless the script stops or seeks.</p>
</fieldset>
<p aria-label="Retained script seek inputs">{inputs.length} seek inputs retained. Reset clears them; checkpoint restore returns to its captured inputs and artwork trajectory.</p>
{#if inspectorFields.length}
  <fieldset>
    <legend>Input text fields</legend>
    {#each inspectorFields as field (field.key)}
      <ScriptInputText binding={field.binding} value={fieldValue(field.binding,field.content,snapshot?.session.state)}
        reset={inputReset} {busy} deliver={input=>run(1,undefined,{key:field.key,input})} />
    {/each}
  </fieldset>
{/if}
<fieldset disabled={busy||!snapshot}>
  <legend>Send JSON input</legend>
  <label>Script input JSON <textarea rows="3" bind:value={inputDraft} spellcheck="false"></textarea></label>
  <button onclick={()=>run(1,undefined,true)}>Send input and step</button>
  <p>Send one JSON object as read-only input to the current frame body, even while stopped. It runs for one tick. Text is limited to 64 KiB; retained payloads total at most 256 KiB.</p>
</fieldset>
<fieldset disabled={busy||!snapshot}>
  <legend>Keyboard input</legend>
  <label><input type="checkbox" bind:checked={captureKeys} /> Capture keys in target</label>
  <button onkeydown={captureKey} onkeyup={captureKey}>Keyboard capture target</button>
  <p>Enable capture, focus the target and press/release keys. Only that target captures keydown/keyup; Tab moves focus, repeats and composition are ignored. Focus changes do not synthesize releases. Nothing runs until delivery.</p>
  <p aria-label="Queued keyboard inputs">{keyQueue.length} keyboard events queued (maximum 64).</p>
  {#if keyQueue.length}<pre aria-label="Next keyboard input">{JSON.stringify(keyQueue[0],null,2)}</pre>{/if}
  <button disabled={capturedQueue[0]?.kind!=='key'} onclick={()=>run(1,undefined,'key')}>Deliver next key and step</button>
  <button disabled={!keyQueue.length} onclick={()=>{capturedQueue=capturedQueue.filter(event=>event.kind!=='key');}}>Clear queued keys</button>
  <p>Delivery is FIFO, one event per tick. Failures retain the queued event. Reset, checkpoint restore and reprepare clear undelivered keys; delivered keys replay as JSON input.</p>
</fieldset>
{#if pointerArtwork}<fieldset disabled={busy||!snapshot||!showArtwork}>
  <legend>Pointer input on artwork</legend>
  <label><input type="checkbox" bind:checked={capturePointers} onchange={()=>{if(!capturePointers)releasePointers();}} /> Capture pointers on artwork</label>
  <label><input type="checkbox" bind:checked={includePointerTarget} /> Include button target for new pointers</label>
  {#if interactiveArtwork||(scope==='symbol'&&(localHover||localPress))}<label><input type="checkbox" bind:checked={captureHover} /> Capture hover movement for new pointers</label>{/if}
  {#if interactiveArtwork}<p>Targeted events include buttonTarget (or null), targetFrame and targetTick from the displayed artwork. Any subsequent image update makes pending targeted events stale, even after a stopped tick or replay. Clear and recapture them. The current root body receives buttonActivation on a matching primary release, or null. Accepted presses display Down; delivered hover movement displays Over or clears it on a miss/leave. </p>{:else}<p>Target lookup uses the exact displayed local image. Inputs include namespaced buttonTarget (or null), targetFrame, targetTick, targetScope, targetNamespace and targetImageId. Any image update makes queued targeted events stale; clear and recapture them. {#if localPress&&localActivation}Matching qualified primary releases provide buttonActivation; other qualified events provide null. It reaches only this selected local body.{:else}Local pointers do not generate buttonActivation.{/if} {#if localPress}Primary presses own one pointer/target lifetime. Foreign pointers and secondary buttons cannot steal it. A matching primary release clears the press; outside release or cancel clears Up. Optional delivered movement updates hover while preserving that ownership.{:else if localHover}Delivered move/leave events show Over or clear Up using the original displayed-image hit. Down/up/cancel do not press buttons; later ticks retain the admitted hover state.{:else}Artwork stays Up; enable local hover or press preview before Prepare to show delivered visual states.{/if} Nested handlers remain unavailable.</p>{/if}
  <p>Capture down/up/cancel on the preview image, then deliver explicitly. Coordinates use document units; captured releases outside the image keep outside coordinates. {#if interactiveArtwork||(scope==='symbol'&&(localHover||localPress))}Opt-in hover adds move/leave, always with snapshot-bound button targeting. {/if}No coalescing occurs; 64 queued pointers stop capture. Wheel events are not recorded.</p>
  <p aria-label="Queued pointer inputs">{pointerQueue.length} pointer events queued (maximum 64).</p>
  {#if pointerQueue.length}<pre aria-label="Next pointer input">{JSON.stringify(pointerQueue[0],null,2)}</pre>{/if}
  <button disabled={capturedQueue[0]?.kind!=='pointer'} onclick={()=>run(1,undefined,'pointer')}>Deliver next pointer and step</button>
  <button disabled={!pointerQueue.length} onclick={()=>{capturedQueue=capturedQueue.filter(event=>event.kind!=='pointer');releasePointers();}}>Clear queued pointers</button>
  <p>Failure retains the queued event. Reset/checkpoint restore clears undelivered input. Captured keyboard and pointer events share arrival order. Device delivery cannot skip an older event from the other device; clearing a device explicitly discards its pending events.</p>
</fieldset>
{/if}
<button disabled={busy||!snapshot||!capturedQueue.length} onclick={()=>run(1,undefined,capturedQueue[0].kind)}>Deliver oldest captured input and step</button>
<p aria-label="Captured input order">{capturedQueue.length} captured events pending. Next: {capturedQueue[0]?.kind??'none'}. Each delivery advances one host tick; capture timestamps do not schedule playback. Manual JSON, seeks and Step remain explicit independent commands.</p>
{#if interactiveArtwork}<p aria-label="Script button press">{buttonPress.pressed?`Pressed: ${buttonPress.pressed.target.name} (pointer ${buttonPress.pressed.pointerId}, lifetime ${buttonPress.pressed.target.lifetime})`:'No button press active.'}</p>
<button disabled={busy||!snapshot||!buttonPress.pressed} onclick={()=>run(1,undefined,'cancelPress')}>Cancel button press and step</button>
<p>Only delivered pointers change the press. Clearing queued input leaves an accepted press intact; use Cancel button press to end it. Reset clears it, and checkpoint restore/replay includes it. Untargeted releases cancel without activation.</p>
{/if}
<p aria-label="Retained script JSON inputs">{events.length} JSON inputs retained. Checkpoints include this history; Reset clears it.</p>
<button disabled={busy||!snapshot} onclick={()=>replayHistory()}>Replay retained script history</button>
{#if scope==='main'&&sources.length}
  <button disabled={busy||!license.savingAllowed||import.meta.env.DEV}
    title={import.meta.env.DEV?'Requires a built editor':'Download interactive HTML for saved scripts using timeline, runtime, state and JSON input'}
    onclick={downloadInteractiveHTML}>Download interactive script HTML</button>
{/if}
{#if scope==='main'&&showArtwork}
  <button disabled={busy||!snapshot?.session.timeline.tick||!license.savingAllowed}
    title="Download timeline and Button artwork from the verified visual replay"
    onclick={()=>replayHistory('html')}>Download script replay HTML</button>
  <button disabled={busy||!snapshot?.session.timeline.tick||!license.savingAllowed||typeof VideoEncoder!=='function'}
    title="Download the recorded artwork and sound as an offline WebM video"
    onclick={()=>replayHistory('video')}>Download script replay WebM</button>
{/if}
<p>Replay re-executes up to 10000 ticks from the prepared initial state within 10 seconds, including rendering. It checks final state and, in artwork mode, the visited trajectory. Failure or mismatch retains the previous preview; arbitrary JavaScript is not guaranteed to replay identically.</p>
<button disabled={busy||!snapshot} onclick={reset}>Reset script preview</button>
<button disabled={busy||!snapshot} onclick={captureCheckpoint}>Capture script checkpoint</button>
<button disabled={busy||!bookmark} onclick={restoreCheckpoint}>Restore script checkpoint</button>
{#if bookmark}<p>Checkpoint: frame {bookmark.session.timeline.frame+1}, tick {bookmark.session.timeline.tick}. Capturing replaces it; preparing again or closing discards it. It stores timeline, seeded random state and JSON state, not a JavaScript heap.</p>{/if}
{#if busy}<button onclick={()=>{cancel();status=cancelledStatus;}}>Cancel script preview</button>{/if}
<p role="status">{status}</p>
{#if failedFrame!==undefined}<button disabled={busy} onclick={openFailure}>{scope==='symbol'?'Edit failing local frame':'Edit failing frame'} {failedFrame+1} source</button><p>The batch was rolled back. The reported frame and tick identify the failed dispatch; source locations, when available, are advisory browser-stack mappings.</p>{/if}
{#if snapshot}
  <p>{scope==='symbol'?'Local frame':'Frame'} {snapshot.session.timeline.frame+1} · Tick {snapshot.session.timeline.tick} · {snapshot.session.timeline.playing?'Playing':'Stopped'} · Entry {snapshot.session.entryPending?'pending':'complete'}</p>
  <details>
    <summary>{scope==='symbol'?'Current local frame source':'Current frame source'}</summary>
    <p>This is the authored source captured for {scope==='symbol'?'local frame':'frame'} {snapshot.session.timeline.frame+1}. Entry {snapshot.session.entryPending?'is pending; this pose does not mean its body has run':'is complete'}. Opening the editor ends this preview session; Apply is required to change saved source.</p>
    {#if currentSource!==undefined}<pre aria-label="Current preview frame source">{currentSource}</pre>
    {:else}<p aria-label="Current preview frame source">No authored source at this frame.</p>{/if}
    <button disabled={busy} onclick={openCurrentSource}>{scope==='symbol'?'Edit current local frame source':'Edit current preview frame source'}</button>
  </details>
  <pre aria-label="Script preview state">{JSON.stringify(snapshot.session.state,null,2)}</pre>
  {#if snapshot.session.nestedGraphics}
    <pre aria-label="Placed symbol script states">{JSON.stringify(snapshot.session.nestedGraphics.map(({layerId,shapeId,symbolId,frame,state,originTick,buttonVisual})=>({layerId,shapeId,symbolId,frame,state,...(originTick===undefined?{}:{mode:'movie'}),...(buttonVisual?{mode:'button',buttonVisual}:{})})),null,2)}</pre>
  {/if}
{/if}
{#if diagnostics.length}<ul>{#each diagnostics as d,index (index)}<li>{#if scope==='symbol'}<button disabled={busy} onclick={()=>openDiagnostic(d)}>Local frame {d.frame+1}, line {d.line}, column {d.column}: {d.message}</button>{:else}Frame {d.frame+1}, line {d.line}, column {d.column}: {d.message}{/if}</li>{/each}</ul>{/if}
<style>
  .paused-locals { display:grid; grid-template-columns:minmax(0,max-content) minmax(0,1fr); gap:4px 12px; max-height:12rem; overflow:auto; }
  .paused-locals dt,.paused-locals dd { margin:0; overflow-wrap:anywhere; }
  .script-artwork { position: relative; width: fit-content; max-width: 100%; }
  textarea { display: block; width: 100%; box-sizing: border-box; }
  p { font-size: 13px; }
  pre, ul { max-height: 260px; overflow: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
