<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { type Project } from '../../../packages/document/src';
  import { createRememberedMotionCaptureCache,prepareRememberedTimelineCapture } from '../../../packages/animation/src/motion-capture';
  import { preparePickedMotionCandidate } from './picked-motion-candidate';
  import { exportPNGFrame } from './export-png';
  import { captureRememberedAuthoringFrame, type SampledMotionOwner } from '../../../packages/animation/src/motion-owner';
  import { pickPreviewRoot, previewDocumentPoint } from './motion-preview-hit';
  import { playFrameRange } from './frame-playback';
  let { snapshot, ids, start, end, validate, promote, timeline=false }: {snapshot:Project;promote?:(owner:SampledMotionOwner,offset?:{x:number;y:number})=>void;timeline?:boolean;ids:string[];start:number;end:number;validate:()=>void}=$props();
  let requested=$state<number|undefined>(), status=$state('Choose a frame and render the remembered recipe.'), url=$state(''), working=$state(false);
  let controller:AbortController|undefined, alive=true;
  let renderButton:HTMLButtonElement,playButton:HTMLButtonElement;
  let cancelButton=$state<HTMLButtonElement>();
  function followAction(from:HTMLButtonElement|undefined,target:()=>HTMLButtonElement|undefined){
    if(!from||document.activeElement!==from)return;
    void tick().then(()=>{
      const button=target(),active=document.activeElement;
      if(alive&&button?.isConnected&&!button.disabled&&(active===from||active===document.body||active===button.closest('dialog')))
        button.focus();
    });
  }
  let playback=$state(false), shownFrame=$state<number|undefined>();
  let canvas:HTMLCanvasElement;
  let capture:ReturnType<typeof createRememberedMotionCaptureCache>|undefined;
  let authoring:ReturnType<typeof captureRememberedAuthoringFrame>|undefined;
  let choices=$state.raw<{layerId:string;shapeId:string}[]>([]), pick=$state(''), pickFrame:number|undefined;
  let moveX=$state(0),moveY=$state(0);
  const movablePick=$derived(choices.some(item=>JSON.stringify([item.layerId,item.shapeId])===pick &&
    snapshot.layers.find(layer=>layer.id===item.layerId)?.drawingMode!=='merge'));
  type Drag = {id:number;image:HTMLImageElement;box:DOMRect;pick:string;url:string;frame:number;owner:typeof authoring;
    x:number;y:number;scale:number;moved:boolean;beforeX:number;beforeY:number;observer:ResizeObserver};
  let drag=$state.raw<Drag>();
  function stopDrag(restore=true){
    const d=drag;if(!d)return;drag=undefined;
    d.observer.disconnect();window.removeEventListener('keydown',dragKey,true);window.removeEventListener('resize',cancelDrag);
    window.removeEventListener('blur',cancelDrag);window.removeEventListener('scroll',checkDragView,true);
    if(d.image.hasPointerCapture(d.id))d.image.releasePointerCapture(d.id);
    if(restore){moveX=d.beforeX;moveY=d.beforeY;}
  }
  function cancelDrag(){stopDrag();}
  function dragKey(event:KeyboardEvent){
    if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();stopDrag();}
  }
  function checkDragView(){
    const d=drag;if(!d)return;
    const now=d.image.getBoundingClientRect();
    if(now.left!==d.box.left||now.top!==d.box.top||now.width!==d.box.width||now.height!==d.box.height)stopDrag();
  }
  function startDrag(event:PointerEvent,image:HTMLImageElement,box:DOMRect){
    const observer=new ResizeObserver(checkDragView);
    image.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,image,box,pick,url,frame:pickFrame!,owner:authoring,x:event.clientX,y:event.clientY,
      scale:Math.min(box.width/snapshot.width,box.height/snapshot.height),moved:false,beforeX:moveX,beforeY:moveY,observer};
    observer.observe(image);window.addEventListener('keydown',dragKey,true);window.addEventListener('resize',cancelDrag);
    window.addEventListener('blur',cancelDrag);window.addEventListener('scroll',checkDragView,true);event.preventDefault();
  }
  function updateDrag(event:PointerEvent,finish=false){
    const d=drag;if(!d||d.id!==event.pointerId)return;
    checkDragView();if(!drag)return;
    if(!alive||working||authoring!==d.owner||pick!==d.pick||url!==d.url||d.frame!==(requested??start+1)-1){stopDrag();return;}
    try{validate();}catch(error){clearPick();status=error instanceof Error?error.message:String(error);return;}
    const x=(event.clientX-d.x)/d.scale,y=(event.clientY-d.y)/d.scale;
    if(!Number.isFinite(x)||!Number.isFinite(y)){stopDrag();return;}
    if(x||y||d.moved){d.moved=true;moveX=x;moveY=y;}
    if(finish)stopDrag(false);
  }
  function pointerCancelled(event:PointerEvent){if(drag?.id===event.pointerId)stopDrag();}
  type Proposal = {job:AbortController;pick:string;frame:number;x:number;y:number;sourceUrl:string;imageUrl:string};
  let proposal=$state.raw<Proposal>();
  function discardProposal(){
    const old=proposal;proposal=undefined;
    if(old){old.job.abort();if(old.imageUrl)URL.revokeObjectURL(old.imageUrl);}
  }
  function matchesProposal(p:Proposal){
    return alive&&!drag&&!working&&url===p.sourceUrl&&pick===p.pick&&pickFrame===p.frame&&
      (requested??start+1)-1===p.frame&&moveX===p.x&&moveY===p.y;
  }
  $effect(()=>{if(proposal&&!matchesProposal(proposal))discardProposal();});
  async function previewMove(){
    if(!authoring||!movablePick||drag||working||pickFrame===undefined||!url)return;
    discardProposal();
    const p:Proposal={job:new AbortController(),pick,frame:pickFrame,x:moveX,y:moveY,sourceUrl:url,imageUrl:''};
    proposal=p;
    function active(){
      p.job.signal.throwIfAborted();validate();
      if(proposal?.job!==p.job||!matchesProposal(p))throw new Error('Proposed pose changed.');
    }
    try{
      active();
      const item=choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===p.pick)!;
      const owner=authoring.resolve(item.layerId,item.shapeId);
      const candidate=preparePickedMotionCandidate(snapshot,owner,{x:p.x,y:p.y});
      // Other remembered root and symbol poses must match whole-timeline presentation.
      const display=await prepareRememberedTimelineCapture(candidate,{signal:p.job.signal,validate:active});
      active();const blob=await exportPNGFrame(display,p.frame,p.job.signal);active();
      proposal={...p,imageUrl:URL.createObjectURL(blob)};
    }catch(error){
      if(proposal?.job===p.job){discardProposal();status=error instanceof Error?error.message:String(error);}
    }
  }
  function resetOffset(){moveX=0;moveY=0;}
  function clearPick(){discardProposal();stopDrag();resetOffset();authoring?.dispose();authoring=undefined;choices=[];pick='';pickFrame=undefined;}
  $effect(()=>{
    if(!choices.length)return;
    try{validate();}catch(error){
      clearPick();status=error instanceof Error?error.message:String(error);
    }
  });
  function pointPick(event:PointerEvent){
    if(drag||!event.isPrimary||event.button!==0||working||!timeline||!authoring||!url)return;
    const previous=pick;
    try{
      validate();
      const bounds=(event.currentTarget as HTMLImageElement).getBoundingClientRect();
      const point=previewDocumentPoint({x:event.clientX,y:event.clientY},bounds,snapshot.width,snapshot.height);
      const result=point?pickPreviewRoot(authoring,point):{kind:'empty'} as const;
      if(result.kind==='pick'){
        pick=JSON.stringify([result.owner.layerId,result.owner.shapeId]);
        if(pick!==previous){resetOffset();status='Selected root artwork: '+result.owner.shapeId;}
        else if(snapshot.layers.find(layer=>layer.id===result.owner.layerId)?.drawingMode!=='merge')
          startDrag(event,event.currentTarget as HTMLImageElement,bounds);
      }else {pick='';resetOffset();status=result.kind==='blocked'?'The top artwork at this point cannot be promoted.':'No root artwork at this point.';}
    }catch(error){clearPick();status=error instanceof Error?error.message:String(error);}
  }
  function promotePick(move=false){
    try{
      const target=choices.find(item=>JSON.stringify([item.layerId,item.shapeId])===pick);
      if(drag||working||!url||!promote||!authoring||!target||pickFrame!==(requested??start+1)-1)throw new Error('Render this frame and choose its artwork again.');
      validate();promote(authoring.resolve(target.layerId,target.shapeId),move?{x:moveX,y:moveY}:undefined);
    }catch(error){clearPick();status=error instanceof Error?error.message:String(error);}
  }
  function clearImage(){clearPick();if(url)URL.revokeObjectURL(url);url='';shownFrame=undefined}
  onDestroy(()=>{alive=false;controller?.abort();capture?.dispose();capture=undefined;clearImage()});
  async function play(){
    if(working)return;
    const frame=(requested??start+1)-1;
    working=true;playback=true;clearImage();const job=new AbortController();controller=job;
    followAction(playButton,()=>cancelButton);
    try{
      validate();
      if(!Number.isSafeInteger(frame)||frame<start||frame>end)throw new Error('Sample frame must be an integer inside the motion range.');
      capture??=createRememberedMotionCaptureCache(snapshot,ids,start,end,validate,timeline?'timeline':'range');
      const draft=await capture.get(job.signal,(completed,total)=>{status=`Preparing remembered range: ${completed} / ${total}`});
      const count=await playFrameRange(draft,frame,end,{signal:job.signal,validate,present:(pixels,current)=>{
        if(!alive)throw new Error('Motion preview closed.');
        canvas.width=pixels.width;canvas.height=pixels.height;
        const context=canvas.getContext('2d');if(!context)throw new Error('Preview canvas unavailable.');
        context.putImageData(pixels,0,0);shownFrame=current;
        status=`Playing remembered frame ${current+1} of ${end+1}.`;
      }});
      if(alive)status=`Played ${count} remembered frames. Document artwork and history unchanged.`;
    }catch(error){
      capture?.invalidate();
      if(alive)status=job.signal.aborted?'Remembered playback stopped.':error instanceof Error?error.message:String(error);
    }finally{if(controller===job){followAction(cancelButton,()=>playButton);controller=undefined;working=false;playback=false}}
  }
  async function render(){
    if(working)return;
    const frame=(requested??start+1)-1;
    working=true;clearImage();const job=new AbortController();controller=job;
    followAction(renderButton,()=>cancelButton);
    try{
      validate();
      if(!Number.isSafeInteger(frame)||frame<start||frame>end)throw new Error('Sample frame must be an integer inside the motion range.');
      capture??=createRememberedMotionCaptureCache(snapshot,ids,start,end,validate,timeline?'timeline':'range');
      const draft=await capture.get(job.signal,(completed,total)=>{status=`Preparing remembered range: ${completed} / ${total}`});
      status='Rendering detached motion pose…';
      const blob=await exportPNGFrame(draft,frame,job.signal);
      job.signal.throwIfAborted();validate();if(!alive)return;
      if(timeline&&promote){
        authoring=captureRememberedAuthoringFrame(()=>{validate();return {project:snapshot,revision:0}},frame);
        choices=authoring.choices;pickFrame=frame;
      }
      url=URL.createObjectURL(blob);status=`Remembered pose at frame ${frame+1}. Document artwork and history unchanged.`;
    }catch(error){
      capture?.invalidate();
      if(alive)status=job.signal.aborted?'Motion preview cancelled.':error instanceof Error?error.message:String(error);
    }finally{if(controller===job){followAction(cancelButton,()=>renderButton);controller=undefined;working=false}}
  }
</script>
<h2>{timeline?'Preview remembered timeline':'Preview remembered motion'}</h2>
{#if timeline}<p>Evaluates independent remembered spans on every visible track, including locked tracks. Authored keys, blank frames and held exposures stay unchanged. Reachable symbol definitions are evaluated too; unused library definitions and hidden tracks retain captured artwork.</p>{/if}
<p>Samples the captured recipes from their current authored endpoints. Edited interior keys reject. Every frame of the selected range is sampled before replay. Other tracks and frames outside the range retain captured artwork; scripts do not run and buttons use Up states.</p>
<label>Preview frame<input aria-label="Remembered preview frame" type="number" min={start+1} max={end+1} step="1" placeholder={String(start+1)} bind:value={requested} oninput={clearPick} disabled={working}/></label>
<button bind:this={renderButton} onclick={render} disabled={working}>Render remembered pose</button>
<button bind:this={playButton} onclick={play} disabled={working}>Play remembered range</button>
<small>Plays from the requested frame through the selected range once. Slow rendering slows playback; frames are not skipped.</small>
{#if working}<button bind:this={cancelButton} onclick={()=>controller?.abort()}>{playback?'Stop remembered playback':'Cancel motion preview'}</button>{/if}
<p role="status">{status}</p>
<canvas bind:this={canvas} aria-label="Remembered playback artwork" hidden={shownFrame===undefined}></canvas>
{#if shownFrame!==undefined}<p aria-label="Remembered playback frame">Frame {shownFrame+1}</p>{/if}
{#if url && choices.length}
  <small>Click the still or choose artwork from the list. Locked or authored artwork on top blocks clicks through it. Text and symbol instances use their root bounds.</small>
  <label>Sampled root artwork<select aria-label="Sampled root artwork" bind:value={pick} disabled={!!drag} onchange={resetOffset}>
    <option value="">Choose artwork</option>
    {#each choices as item}<option value={JSON.stringify([item.layerId,item.shapeId])}>{snapshot.layers.find(l=>l.id===item.layerId)?.name} · {item.shapeId}</option>{/each}
  </select></label>
  <button disabled={!pick||working||!!drag} onclick={()=>promotePick()}>Promote picked pose to shared key</button>
  {#if movablePick}
    <fieldset disabled={!!drag}><legend>Move picked artwork on the new key</legend>
      <label>X offset<input aria-label="Picked pose X offset" type="number" step="any" bind:value={moveX} /></label>
      <label>Y offset<input aria-label="Picked pose Y offset" type="number" step="any" bind:value={moveY} /></label>
      <button disabled={working||!Number.isFinite(moveX)||!Number.isFinite(moveY)||(!moveX&&!moveY)||!!proposal} onclick={previewMove}>Preview proposed move</button>
      <button disabled={working||!Number.isFinite(moveX)||!Number.isFinite(moveY)||(!moveX&&!moveY)} onclick={()=>promotePick(true)}>Promote and move picked artwork</button>
      <small>Drag the selected artwork on the still or enter document-space offsets. Release sets the offsets; Escape cancels the drag. Both adjacent spans update in the same undo step.</small>
    </fieldset>
  {/if}
  <small>Refreshes and splits the chosen track at this frame. The shared key contains the whole track’s artwork. Other tracks are unchanged.</small>
{/if}
{#if url}<img src={url} alt="Remembered motion pose" class:pickable={timeline && choices.length>0} onpointerdown={pointPick} onpointermove={e=>updateDrag(e)} onpointerup={e=>updateDrag(e,true)} onpointercancel={pointerCancelled} onlostpointercapture={pointerCancelled} draggable="false" />{/if}
{#if proposal}
  {#if proposal.imageUrl}
    <figure><figcaption>Proposed pose · frame {proposal.frame+1} · offset ({proposal.x}, {proposal.y}) · unapplied</figcaption>
      <img src={proposal.imageUrl} alt="Proposed moved pose" /></figure>
    <button onclick={discardProposal}>Dismiss proposed pose</button>
  {:else}<p>Preparing proposed pose…</p><button onclick={discardProposal}>Cancel proposed pose</button>{/if}
{/if}
<style>img{padding:0;border:0;object-position:center}.pickable{cursor:crosshair;touch-action:none;user-select:none}img,canvas{display:block;max-width:100%;max-height:55vh;object-fit:contain}canvas[hidden]{display:none}label{display:block;margin:1rem 0}</style>
