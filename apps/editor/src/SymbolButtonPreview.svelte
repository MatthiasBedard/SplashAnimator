<script lang="ts">
  import { createButtonStateClock } from '../../../packages/animation/src/button-state-clock';
  import {prepareSymbolRememberedButton} from '../../../packages/animation/src/symbol-remembered-button';
  import { onMount } from 'svelte';
  import { wrapDialogTab } from './dialog-focus';
  import type { Project, SymbolDefinition, Vector } from '../../../packages/document/src';
  import { expandSymbols, symbolInstance } from '../../../packages/geometry/src/symbols';
  import { hit } from '../../../packages/geometry/src';
  import { drawShape } from '../../../packages/stage/src';

  let {definition,assets,symbols,fps,close,validateSource=()=>{}}:{
    definition:SymbolDefinition;assets:Project['assets'];symbols:SymbolDefinition[];fps:number;close:()=>void;validateSource?:()=>void;
  }=$props();
  let dialog:HTMLDialogElement,canvas:HTMLCanvasElement;
  let inside=$state(false),pointer=$state<number|null>(null),keyboard=$state<string|null>(null),activations=$state(0);
  const pose=$derived(keyboard||(pointer!==null&&inside)?'Down':inside?'Over':'Up');
  const scale=$derived(Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)));
  const project=$derived({symbols:[...symbols.filter(s=>s.id!==definition.id),definition]});
  const frames=$derived(definition.buttonStates??{up:0,over:1,down:2,hit:3});
  let movieClock:ReturnType<typeof createButtonStateClock>|undefined;
  let remembered=$state(false),pending=$state(false),failure=$state(''),status=$state('');
  let session=$state.raw<Awaited<ReturnType<typeof prepareSymbolRememberedButton>>>();
  let job:AbortController|undefined,validateRemembered:(()=>void)|undefined,alive=false,signature='';
  function stamp(){return JSON.stringify([definition,symbols,assets,fps]);}
  function clearCanvas(){
    if(!canvas)return;
    const c=canvas.getContext('2d')!;c.setTransform(1,0,0,1,0,0);c.fillStyle='#fff';c.fillRect(0,0,540,330);
  }
  function reset(){
    const captured=pointer;pointer=null;keyboard=null;inside=false;
    if(captured!==null&&canvas?.hasPointerCapture(captured))canvas.releasePointerCapture(captured);
  }
  function release(){
    reset();job?.abort();job=undefined;session?.dispose();session=undefined;validateRemembered=undefined;pending=false;signature='';
  }
  function fail(cause:unknown){release();failure=String(cause);status='';clearCanvas();}
  function dismiss(){release();dialog.close();close();}
  function togglePreparation(){
    if(!pending){void prepare();return;}
    release();status='Remembered preparation cancelled.';clearCanvas();
  }
  function usable(){
    if(!alive||(remembered&&(pending||!!failure||!session)))return false;
    if(remembered)try{validateRemembered!();}catch(cause){fail(cause);return false;}
    return true;
  }
  async function prepare(){
    release();failure='';status='';
    if(!alive||!remembered)return;
    pending=true;const current=new AbortController();job=current;
    try{
      validateSource();
      const originalDefinition=definition,originalSymbols=symbols,originalAssets=assets,expected=stamp();
      const active=()=>{
        current.signal.throwIfAborted();validateSource();
        if(!alive||!remembered||job!==current||definition!==originalDefinition||symbols!==originalSymbols||assets!==originalAssets||stamp()!==expected)
          throw new Error('Button test source changed. Close and reopen the test.');
      };
      validateRemembered=active;
      const source={definition:structuredClone($state.snapshot(definition)),symbols:structuredClone($state.snapshot(symbols)),revision:0,frame:0};
      clearCanvas();
      const ready=await prepareSymbolRememberedButton(()=>source,fps,{signal:current.signal,validate:active});
      try{active();}catch(cause){ready.dispose();throw cause;}
      session=ready;pending=false;status='Remembered button states ready.';paint();
    }catch(cause){if(job===current&&!current.signal.aborted)fail(cause);}
  }
  function changeMode(){
    release();failure='';status='';
    if(remembered)void prepare();
    else{movieClock=createButtonStateClock(definition,project.symbols,fps);paint();}
  }
  function artwork(frame:number,movies?:Record<string,number>){
    return expandSymbols(project,[{...symbolInstance(definition,0,0),id:'preview',symbolPlayback:{mode:'single',firstFrame:frame}}],0,
      shape=>movies?.['root/'+shape.id+'/'+shape.symbolId]??0);
  }
  function paint(force=true){
    if(!canvas)return;
    if(remembered&&!usable()){clearCanvas();return;}
    try{
      const display=pose==='Down'?frames.down:pose==='Over'?frames.over:frames.up;
      let shapes:Vector[]|undefined,movies:Record<string,number>|undefined;
      if(remembered){const result=session!.sample(pose==='Down'?'down':pose==='Over'?'over':'up',performance.now()/1000);movies=result.frames;shapes=result.shapes;}
      else movies=movieClock?.sample(display,performance.now()/1000);
      const next=JSON.stringify([remembered,display,movies]);
      if(!force&&next===signature)return;
      signature=next;clearCanvas();const c=canvas.getContext('2d')!;c.translate(20,20);c.scale(scale,scale);
      for(const shape of shapes??artwork(display,movies))drawShape(c,shape,assets,paint);
    }catch(cause){fail(cause);}
  }
  function contains(e:PointerEvent){
    if(!usable())return false;
    const rect=canvas.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return false;
    const point={x:((e.clientX-rect.left)*540/rect.width-20)/scale,y:((e.clientY-rect.top)*330/rect.height-20)/scale};
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
    try{return remembered?session!.contains(point):artwork(frames.hit).some(shape=>hit(shape,point,0));}
    catch(cause){fail(cause);return false;}
  }
  function down(e:PointerEvent){
    if(!usable()||e.button!==0||pointer!==null||keyboard)return;
    inside=contains(e);if(!inside)return;
    e.preventDefault();canvas.focus();pointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
  }
  function move(e:PointerEvent){if(!usable())return;if(pointer===null||pointer===e.pointerId)inside=contains(e);}
  function up(e:PointerEvent){
    if(pointer!==e.pointerId||!usable())return;
    inside=contains(e);if(!usable())return;
    if(inside)activations++;pointer=null;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  }
  function lost(e:PointerEvent){if(pointer===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))reset();}
  function keydown(e:KeyboardEvent){
    if(!usable()||![' ','Enter'].includes(e.key))return;
    e.preventDefault();if(!e.repeat&&pointer===null&&!keyboard)keyboard=e.key;
  }
  function keyup(e:KeyboardEvent){
    if(keyboard!==e.key||!usable())return;
    e.preventDefault();keyboard=null;activations++;
  }
  $effect(()=>{paint();});
  onMount(()=>{
    alive=true;movieClock=createButtonStateClock(definition,project.symbols,fps);dialog.showModal();canvas.focus();
    let raf=0;
    const tick=()=>{paint(false);raf=requestAnimationFrame(tick);};tick();
    window.addEventListener('blur',reset);
    return()=>{alive=false;release();window.removeEventListener('blur',reset);cancelAnimationFrame(raf);};
  });
</script>

<dialog
  bind:this={dialog}
  aria-label="Button state test"
  onkeydown={wrapDialogTab}
  oncancel={(e) => {
    e.preventDefault();
    dismiss();
  }}
>
  <h2>Button state test: {definition.name}</h2>
  <p>
    Frames {frames.up + 1} / {frames.over + 1} / {frames.down + 1} display Up / Over / Down. Frame {frames.hit +
      1} supplies invisible vector Hit geometry. Press and release inside to activate; dragging out cancels
    activation. Space or Enter activates the focused preview. Movies play independently. Changing the
    mapped display frame restarts its movies; states sharing a frame preserve continuity. Hit artwork
    stays frozen.
  </p>
  <label><input type="checkbox" aria-label="Use remembered button states" bind:checked={remembered} onchange={changeMode}/>Evaluate remembered button artwork and nested children</label>
  {#if remembered}
    <button onclick={togglePreparation}>{pending ? 'Cancel remembered button preparation' : 'Restart remembered button test'}</button>
    <p role="status">{pending ? 'Preparing remembered button states.' : status}</p>
  {/if}
  {#if failure}<p role="alert">{failure}</p>{/if}
  <canvas
    bind:this={canvas}
    width="540"
    height="330"
    role="button"
    tabindex="0"
    aria-label="Test symbol button"
    aria-pressed={pose === 'Down'}
    aria-disabled={remembered&&(pending||!!failure||!session)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointerleave={() => {
      inside = false;
    }}
    onpointercancel={reset}
    onlostpointercapture={lost}
    onblur={reset}
    onkeydown={keydown}
    onkeyup={keyup}
  ></canvas>
  <p aria-live="polite">State: {pose} · Activations: {activations}</p>
  <button onclick={dismiss}>Close button test</button>
</dialog>

<style>
  dialog {
    width: 600px;
    max-width: 90vw;
  }
  canvas {
    display: block;
    width: 540px;
    max-width: 100%;
    touch-action: none;
  }
  canvas:focus-visible {
    outline: 2px solid #6366f1;
  }
</style>
