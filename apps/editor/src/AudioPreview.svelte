<script lang="ts">
  import {onDestroy,tick} from 'svelte';
  import { license } from './license.svelte';
  import {createAudioPlayback} from '../../../packages/audio/src/playback';
  import type {Project} from '../../../packages/document/src';
  import type {mixTimelinePcm} from '../../../packages/audio/src/pcm';
  let {fps,duration,presentationProject,savedProject,loadSaved,followFrame,releaseFrame}:{fps:number;duration:number;presentationProject?:Project;savedProject?:Project;loadSaved?:(path:string,signal:AbortSignal)=>Promise<Blob>;followFrame?:(frame:number)=>void;releaseFrame?:()=>void}=$props();
  let rangeFirst=$state(1),rangeLast=$state(1),preparedFirst=$state(1),preparedLast=$state(1),rangeInitialized=false;
  $effect(()=>{if(!rangeInitialized){rangeLast=duration;preparedLast=duration;rangeInitialized=true;}});
  let targetRate=$state('source'),conversionNote=$state('');
  let fadeInMs=$state(0),fadeOutMs=$state(0);
  let outputChannels=$state<'source'|'mono'|'stereo'>('source');
  let useFolder=$state(false),followRoot=$state(false);
  let showPresentation=$state(false),presentationFrame=$state<number|null>(null);
  let presentationCanvas=$state<HTMLCanvasElement>();
  let presentation:ReturnType<typeof import('./frame-presentation').createFramePresentation>|undefined,presentationVersion=0;
  let presentationLoading=false,presentationActive=$state(false);
  function clearPresentation(){presentationVersion++;presentationLoading=false;presentationActive=false;presentation?.dispose();presentation=undefined;presentationFrame=null;if(presentationCanvas){presentationCanvas.width=1;presentationCanvas.height=1;}}
  async function renderPresentation(){
    if(!showPresentation||!result||!presentationProject)return;
    const token=presentationVersion;
    try{
      if(!presentation){
        if(presentationLoading)return;presentationLoading=true;presentationActive=true;
        const {createFramePresentation}=await import('./frame-presentation');
        if(!alive||!showPresentation||token!==presentationVersion)return;
        presentation=createFramePresentation($state.snapshot(presentationProject),(frame,pixels)=>{
          if(!alive||!showPresentation||token!==presentationVersion||!presentationCanvas)return;
          const canvas=presentationCanvas;canvas.width=pixels.width;canvas.height=pixels.height;
          const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Presentation canvas unavailable.');ctx.putImageData(pixels,0,0);presentationFrame=frame+1;
        },failure=>{if(alive&&token===presentationVersion){clearPresentation();showPresentation=false;error=String(failure);}});
        presentationLoading=false;
      }
      presentation.request(currentFrame-1);
    }catch(failure){if(alive&&token===presentationVersion){clearPresentation();showPresentation=false;error=String(failure);}}
  }
  const publishFrame=()=>{if(followRoot)followFrame?.(currentFrame-1);void renderPresentation();};
  const referenced=$derived(savedProject?.assets.filter(asset=>savedProject.audioClips?.some(clip=>clip.assetId===asset.id))??[]);
  let files=$state.raw<Record<string,File>>({});
  let file=$state<File|null>(null),start=$state(1),gain=$state(1),busy=$state(false),playing=$state(false),status=$state('Choose a PCM16 WAV file.'),error=$state('');
  const ready=$derived(savedProject?referenced.length>0&&((useFolder&&!!loadSaved)||referenced.every(a=>files[a.path])):!!file);
  let result=$state.raw<ReturnType<typeof mixTimelinePcm>|null>(null);
  let job:AbortController|undefined,context:AudioContext|undefined,playback:ReturnType<typeof createAudioPlayback>|undefined,version=0,alive=true,animation:number|undefined;
  let seekFrame=$state(1),currentFrame=$state(1),hasPlayback=$state(false);
  let prepareButton:HTMLButtonElement,cancelButton:HTMLButtonElement,playButton:HTMLButtonElement,
    pauseButton:HTMLButtonElement,stopButton:HTMLButtonElement;
  function followAction(from:HTMLButtonElement,to:HTMLButtonElement){
    if(!alive||document.activeElement!==from)return;
    void tick().then(()=>{
      const active=document.activeElement;
      if(alive&&to.isConnected&&!to.disabled&&(active===from||active===document.body||active===to.closest('dialog')))
        to.focus();
    });
  }
  function stop(){
    followAction(pauseButton,playButton);followAction(stopButton,playButton);
    version++;playing=false;releaseFrame?.();clearPresentation();
    if(animation!==undefined)cancelAnimationFrame(animation);animation=undefined;playback?.dispose();playback=undefined;hasPlayback=false;seekFrame=preparedFirst;currentFrame=preparedFirst;
    const old=context;context=undefined;if(old)void old.close().catch(e=>{if(alive)error=String(e);});
  }
  let exporting=$state(false);let exportJob:AbortController|undefined;
  function invalidate(){if(!committing){exportJob?.abort(new Error('Audio export cancelled.'));exportJob=undefined;exporting=false;}job?.abort(new Error('Audio preparation cancelled.'));job=undefined;busy=false;stop();result=null;conversionNote='';error='';}
  function select(event:Event){invalidate();file=(event.currentTarget as HTMLInputElement).files?.[0]??null;status=file?'Ready to prepare.':'Choose a PCM16 WAV file.';}
  function selectAsset(path:string,event:Event){invalidate();const selected=(event.currentTarget as HTMLInputElement).files?.[0];const next={...files};if(selected)next[path]=selected;else delete next[path];files=next;status='Select the referenced files, then prepare saved clips.';}
  function cancel(){job?.abort(new Error('Audio preparation cancelled.'));}
  async function prepare(){
    if(committing)return;
    invalidate();const selected=file,selectedFiles={...files},folderLoader=useFolder?loadSaved:undefined;if(!ready)return;
    if(!Number.isSafeInteger(rangeFirst)||!Number.isSafeInteger(rangeLast)||rangeFirst<1||rangeLast<rangeFirst||rangeLast>duration){error='Choose a valid audio range inside the document.';return;}
    const from=rangeFirst-1,to=rangeLast,channelCount=outputChannels==='mono'?1:outputChannels==='stereo'?2:undefined;
    if(!savedProject&&(!Number.isInteger(start)||start<1||start>duration||!Number.isFinite(gain)||gain<0||gain>4)){error='Choose a valid start frame and gain from 0 to 4.';return;}
    if(!savedProject&&selected&&(selected.size<12||selected.size>64*1024*1024)){error='WAV file must be between 12 bytes and 64 MiB.';return;}
    if(!savedProject&&(!Number.isFinite(fadeInMs)||!Number.isFinite(fadeOutMs)||fadeInMs<0||fadeOutMs<0)){error='Choose nonnegative finite fade durations.';return;}
    const rate=targetRate==='source'?undefined:Number(targetRate);
    if(rate!==undefined&&![8000,16000,44100,48000,96000].includes(rate)){error='Choose a supported output rate.';return;}
    let conversion='';
    const fadeIn=fadeInMs,fadeOut=fadeOutMs;
    const at=start-1,level=gain,controller=new AbortController();job=controller;busy=true;status='Preparing audio...';
    followAction(prepareButton,cancelButton);
    const deadline=Date.now()+10000,timer=setTimeout(()=>controller.abort(new Error('Audio preparation timed out.')),10000);
    let rejectWait:(reason:unknown)=>void=()=>{};
    const stopped=new Promise<never>((_,reject)=>{rejectWait=reject;}),abort=()=>rejectWait(controller.signal.reason);
    controller.signal.addEventListener('abort',abort,{once:true});
    const active=()=>{controller.signal.throwIfAborted();if(!alive||job!==controller)throw new Error('Stale audio preparation.');};
    const work=async()=>{
      if(savedProject){const snapshot=$state.snapshot(savedProject);const {prepareProjectAudio}=await import('../../../packages/audio/src/project-preview');active();const prepared=await prepareProjectAudio(snapshot,async(path,signal)=>{if(folderLoader){const blob=await folderLoader(path,signal);active();return blob;}const asset=selectedFiles[path];if(!asset)throw new Error(`Select WAV for ${path}`);return asset;},{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now()),startFrame:from,endFrame:to,channelCount,sampleRate:rate});active();
        if(prepared.resampling.assets)conversion=`Resampled ${prepared.resampling.assets} saved assets to ${prepared.sampleRate} Hz. Filter peak ${prepared.resampling.peak.toFixed(3)}; ${prepared.resampling.clippedSamples} clipped samples before mixing.`;return prepared;}

      const [{decodePcm16WavAsync},{mixTimelinePcmAsync},buffer]=await Promise.all([import('../../../packages/audio/src/wav-async'),import('../../../packages/audio/src/pcm-async'),selected!.arrayBuffer()]);active();
      const decoded=await decodePcm16WavAsync(new Uint8Array(buffer),{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now())});active();
      let channels=decoded.channels,sampleRate=decoded.sampleRate;
      const inSamples=Math.round(fadeIn*sampleRate/1000),outSamples=Math.round(fadeOut*sampleRate/1000);
      if(!Number.isSafeInteger(inSamples)||!Number.isSafeInteger(outSamples)||inSamples>decoded.frames||outSamples>decoded.frames)throw new Error('Invalid audio clip fade lengths.');
      if(rate!==undefined&&rate!==sampleRate){
        const {resamplePcm}=await import('../../../packages/audio/src/resample');active();
        const converted=await resamplePcm(channels,sampleRate,rate,{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now())});active();
        channels=converted.channels;sampleRate=converted.sampleRate;conversion=`Resampled ${decoded.sampleRate} to ${sampleRate} Hz. Filter peak ${converted.peak.toFixed(3)}; ${converted.clippedSamples} clipped samples before mixing.`;
      }
      const mixed=await mixTimelinePcmAsync([{startFrame:at,gain:level,fadeInSamples:Math.round(inSamples*sampleRate/decoded.sampleRate),fadeOutSamples:Math.round(outSamples*sampleRate/decoded.sampleRate),sampleRate,channels}],{startFrame:from,endFrame:to,fps,sampleRate,channelCount:channels.length as 1|2},{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now())});active();return mixed;
    };
    try{const mixed=await Promise.race([work(),stopped]);active();preparedFirst=from+1;preparedLast=to;seekFrame=preparedFirst;currentFrame=preparedFirst;result=mixed;conversionNote=conversion;void renderPresentation();status='Audio prepared. Playback starts only when you press Play.';}
    catch(e){if(alive&&job===controller){status=controller.signal.aborted?'Audio preparation cancelled.':'Preparation failed.';error=String(e);}}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);if(job===controller){job=undefined;busy=false;followAction(cancelButton,result?playButton:prepareButton);}}
  }
  const savePicker=(window as unknown as {showSaveFilePicker?:(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<{createWritable:()=>Promise<WritableStream<Uint8Array>>}>}).showSaveFilePicker;
  let committing=$state(false);
  async function download(save=false){
    const prepared=result;if(!license.canSaveNow()||!prepared||busy||exporting||(save&&!savePicker))return;
    const controller=new AbortController();exportJob=controller;exporting=true;error='';status='Encoding WAV...';
    let destination:ReturnType<typeof import('../../../packages/export-video/src/media-destination').createMediaWritableDestination>|undefined;
    let deadline=0,timer:ReturnType<typeof setTimeout>|undefined;
    let rejectWait:(reason:unknown)=>void=()=>{};const stopped=new Promise<never>((_,reject)=>{rejectWait=reject;});void stopped.catch(()=>{});const abort=()=>rejectWait(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});
    const active=()=>{controller.signal.throwIfAborted();license.assertOutputAllowed();if(!alive||exportJob!==controller||result!==prepared)throw new Error('Stale audio export.');};
    try{
      const handle=save?await savePicker!.call(window,{suggestedName:'splash-audio.wav',types:[{description:'PCM16 WAV audio',accept:{'audio/wav':['.wav']}}]}):undefined;active();
      deadline=Date.now()+10000;timer=setTimeout(()=>controller.abort(new Error('Audio export timed out.')),10000);
      if(handle){
        const [{createMediaWritableDestination},{streamPcm16Wav}]=await Promise.all([import('../../../packages/export-video/src/media-destination'),import('../../../packages/audio/src/wav-chunk-async')]);active();
        destination=createMediaWritableDestination(await handle.createWritable(),64*1024*1024);active();
        const sink=destination;status='Streaming WAV file...';
        const receipt=await streamPcm16Wav(prepared.channels,prepared.sampleRate,async(bytes,signal)=>{
          active();await sink.write(bytes,signal);active();
        },{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now())});active();
        clearTimeout(timer);committing=true;status='Finishing WAV file...';
        await destination.commit(receipt,controller.signal);destination=undefined;
        if(alive&&exportJob===controller)status='WAV file saved. PCM16 quantization; no dithering.';
        return;
      }
      const work=async()=>{const {encodePcm16WavAsync}=await import('../../../packages/audio/src/wav-encode-async');active();return encodePcm16WavAsync(prepared.channels,prepared.sampleRate,{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now())});};
      const bytes=await Promise.race([work(),stopped]);active();if(Date.now()>=deadline)throw new Error('Audio export timed out.');
      const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
      try{const link=document.createElement('a');link.href=url;link.download='splash-audio.wav';link.click();status='WAV download started. PCM16 quantization; no dithering.';}
      finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch(e){if(alive&&exportJob===controller){error=String(e);status=save?'Audio export did not save.':'Audio export did not download.';}}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);try{await destination?.abort(new Error('Audio export did not commit.'));}catch(cleanup){if(alive&&exportJob===controller)error=`Audio destination cleanup failed: ${String(cleanup)}`;}if(exportJob===controller){exportJob=undefined;exporting=false;committing=false;}}
  }
  function monitor(){
    if(!alive||!playback||!playing)return;
    try{const position=playback.position();currentFrame=position.frame+1;publishFrame();if(position.ended){stop();status='Playback ended.';return;}animation=requestAnimationFrame(monitor);}
    catch(e){stop();error=String(e);status='Playback failed.';}
  }
  function pause(){
    try{if(!playback)return;const position=playback.pause();version++;playing=false;currentFrame=position.frame+1;publishFrame();if(animation!==undefined)cancelAnimationFrame(animation);animation=undefined;status='Audio paused. Play resumes this position.';followAction(pauseButton,playButton);}
    catch(e){stop();error=String(e);}
  }
  function seek(){
    try{if(!result||!Number.isSafeInteger(seekFrame)||seekFrame<preparedFirst||seekFrame>preparedLast)throw new Error('Choose a frame inside the prepared range.');
      if(playback)playback.seek(seekFrame-1);version++;playing=false;currentFrame=seekFrame;publishFrame();if(animation!==undefined)cancelAnimationFrame(animation);animation=undefined;status='Audio seeked and paused.';
    }catch(e){error=String(e);}
  }
  async function play(){
    const prepared=result;if(!prepared||busy||playing)return;error='';const token=++version;
    try{
      if(!playback){const audio=new AudioContext({sampleRate:prepared.sampleRate});context=audio;playback=createAudioPlayback(audio,prepared.channels,{startFrame:preparedFirst-1,endFrame:preparedLast,fps,sampleRate:prepared.sampleRate});playback.seek(currentFrame-1);hasPlayback=true;}
      const activePlayback=playback;playing=true;status='Starting audio...';followAction(playButton,pauseButton);const position=await activePlayback.play();
      if(!alive||version!==token||playback!==activePlayback||!position)return;
      currentFrame=position.frame+1;publishFrame();status='Playing audio.';monitor();
    }catch(e){if(alive&&version===token){stop();error=String(e);status='Playback failed.';}}
  }
  onDestroy(()=>{alive=false;invalidate();});
</script>
<h2>{savedProject?'Preview saved audio':'Preview audio'}</h2>
<fieldset disabled={committing} class="preview-controls">
{#if savedProject}
<p>Preview {savedProject.audioClips?.length} saved clips over {duration} frames at {fps} fps. Select the WAV for each reference. Timing, sample offsets and gains come from the project; metadata must match. Preparation is silent and playback is independent of the stage. File selections are temporary.</p>
<label>Audio output channels <select bind:value={outputChannels} onchange={()=>{invalidate();status='Prepare the changed output channels.';}}><option value="source">Keep matching source channels</option><option value="mono">Mono (average stereo)</option><option value="stereo">Stereo (duplicate mono)</option></select></label>
<p>Conversion applies to preview and WAV download only. Keep source rate requires matching rates; choose an output rate to convert mixed-rate assets.</p>
{#if loadSaved}<label><input type="checkbox" bind:checked={useFolder} onchange={()=>{invalidate();status='Prepare audio to load the chosen source.';}}/>Use project folder WAV files</label>{/if}
{#if !useFolder}{#each referenced as asset (asset.id)}<label>WAV for {asset.path}<input type="file" accept=".wav,audio/wav" onchange={(event)=>selectAsset(asset.path,event)}/></label>{/each}{/if}
{:else}
<p>Temporary WAV preview over {duration} frames at {fps} fps. Audio is not saved in the project. Prepare is silent; playback is independent of the stage.</p>
<label>PCM16 WAV file <input type="file" accept=".wav,audio/wav" onchange={select}/></label>
<label>Audio start frame <input type="number" min="1" max={duration} step="1" disabled={busy} bind:value={start} onchange={()=>{invalidate();status='Prepare the changed settings.';}}/></label>
<label>Audio gain <input type="number" min="0" max="4" step="0.1" disabled={busy} bind:value={gain} onchange={()=>{invalidate();status='Prepare the changed settings.';}}/></label>
<label>Audio fade in (ms) <input type="number" min="0" step="1" bind:value={fadeInMs} onchange={()=>{invalidate();status='Prepare the changed fades.';}}/></label>
<label>Audio fade out (ms) <input type="number" min="0" step="1" bind:value={fadeOutMs} onchange={()=>{invalidate();status='Prepare the changed fades.';}}/></label>
<p>Linear fades use the source WAV endpoints, rounded to the nearest sample. Zero disables a fade; overlapping fades multiply. Each fade must fit the source duration.</p>
{/if}
<label>Audio output sample rate <select bind:value={targetRate} onchange={()=>{invalidate();status='Prepare the changed sample rate.';}}><option value="source">Keep source rate</option>{#each [8000,16000,44100,48000,96000] as rate}<option value={String(rate)}>{rate} Hz</option>{/each}</select></label>
<p>Optional browser resampling affects preview and WAV download. Cancel discards results; native rendering may finish in the background before another conversion can start.</p>
<fieldset><legend>Audio range (inclusive document frames)</legend>
<label>Audio range first frame <input type="number" min="1" max={duration} step="1" bind:value={rangeFirst} onchange={()=>{invalidate();status='Prepare the changed range.';}}/></label>
<label>Audio range last frame <input type="number" min="1" max={duration} step="1" bind:value={rangeLast} onchange={()=>{invalidate();status='Prepare the changed range.';}}/></label>
</fieldset>
{#if followFrame}<label><input type="checkbox" bind:checked={followRoot} onchange={()=>{if(!followRoot)releaseFrame?.();else if(result){try{publishFrame();}catch(e){stop();error=String(e);}}}}/>Follow audio on root timeline</label><p>Opt-in root frame preview only. Stop, source changes or closing restores the prior stage frame. Nested movie clocks are not synchronized to audio.</p>{/if}
{#if presentationProject}
<label><input type="checkbox" bind:checked={showPresentation} onchange={()=>{clearPresentation();if(showPresentation)void renderPresentation();}}/>Show animation with audio</label>
{#if showPresentation}<p>Detached animation follows the audio frame, including nested movies. Buttons stay Up and scripts do not run. Rendering may lag playback.</p><canvas bind:this={presentationCanvas} aria-label="Audio animation preview" width="1" height="1"></canvas><p aria-label="Audio animation frame">{presentationFrame===null?'No animation frame displayed.':`Animation frame ${presentationFrame}`}</p>{/if}
{/if}
<div class="actions">
  <button bind:this={prepareButton} disabled={!ready||busy} onclick={prepare}>Prepare audio</button>
  <button bind:this={cancelButton} disabled={!busy} onclick={cancel}>Cancel audio preparation</button>
  <button disabled={!license.savingAllowed||!result||busy||exporting} onclick={()=>download()}>Download prepared WAV</button>
  <button disabled={!license.savingAllowed||!result||busy||exporting||!savePicker} onclick={()=>download(true)}>Save prepared WAV to file...</button>
  {#if exporting&&!committing}<button onclick={()=>exportJob?.abort(new Error('Audio export cancelled.'))}>Cancel WAV export</button>{/if}
  <button bind:this={playButton} disabled={!result||busy||playing} onclick={play}>Play audio</button>
  <button bind:this={pauseButton} disabled={!playing} onclick={pause}>Pause audio</button>
  <button bind:this={stopButton} disabled={!hasPlayback&&!presentationActive} onclick={()=>{stop();status='Audio stopped.';}}>Stop audio</button>
</div>
<label>Audio seek frame <input type="number" min={preparedFirst} max={preparedLast} step="1" disabled={!result||busy} bind:value={seekFrame}/></label>
<button disabled={!result||busy} onclick={seek}>Seek audio and pause</button>
{#if result}<p aria-label="Audio playback position">Audio frame {currentFrame} of {duration}</p>{/if}
<p role="status">{status}</p>
{#if conversionNote}<p>{conversionNote}</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
{#if result}<p>{result.channels.length} channels · {result.sampleRate} Hz · {result.channels[0].length} samples · Peak {result.peak.toFixed(3)} · {result.clippedSamples} clipped samples</p>{/if}
</fieldset>
<style>
  .preview-controls{border:0;padding:0;margin:0;min-width:0}
  canvas{max-width:100%;max-height:300px;object-fit:contain}label{display:block;margin:12px 0}input{margin-left:8px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}p{max-width:560px}
</style>
