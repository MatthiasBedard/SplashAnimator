<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Project } from '../../../packages/document/src';
  import { createMotionFrameSampler } from '../../../packages/animation/src/motion-frames';
  import { shapeHintEndpoints } from '../../../packages/animation/src/motion-shape-morph';
  import { hit } from '../../../packages/geometry/src';
  import { drawShape } from '../../../packages/stage/src';
  import { prepareTimelineTween, type TimelineTweenInput } from './timeline-tween';
  import MotionNodeHints from './MotionNodeHints.svelte';

  import type { Matrix } from '../../../packages/geometry/src/affine';
  let {source, apply, cancel, stage, view}: {
    stage: HTMLCanvasElement;
    view: {width:number; height:number; matrix:Matrix; zoom:number};
    source: {project: Project; track: string; spanId: string; validate: () => void};
    apply: (input: TimelineTweenInput, validate: () => void) => void;
    cancel: () => void;
  } = $props();
  const owner = untrack(() => source);
  const layer = owner.project.layers.find(l => l.id === owner.track)!;
  const span = layer.liveMotionSpans!.find(s => s.id === owner.spanId)!;
  const matching = span.correspondence?.nodes;
  const keys = [span.start,span.end].map(f=>layer.keys.find(k=>k.frame===f)!);
  const count = Math.min(keys[0].shapes.length,keys[1].shapes.length);
  const scoped = keys.some(k=>k.shapes.length !== 1) || !!(typeof matching === 'object' && matching.artworkHints);
  let index = $state(0);
  function initialText(i:number) {
    if (typeof matching !== 'object') return '';
    const entry = matching.artworkHints?.find(e=>e.sourceId===keys[0].shapes[i].id && e.targetId===keys[1].shapes[i].id);
    const hints = entry ? entry.hints : matching.hints;
    return hints?.map(r=>r.map(p=>p.join(':')).join(', ')).join('; ') ?? '';
  }
  const at = Math.floor((span.start + span.end)/2);
  const endpoints = $derived.by(() => {
    try {
      const from = keys[0].shapes[index], to = keys[1].shapes[index];
      const entry = typeof matching === 'object' && matching.artworkHints?.find(e=>e.sourceId===from.id && e.targetId===to.id);
      return shapeHintEndpoints(from,to,entry ? entry.contourOwners : undefined);
    }
    catch (error) { return String(error); }
  });
  let text = $state(initialText(0)), revision = 0, alive = true;
  let canvas = $state<HTMLCanvasElement>();
  let ready = $state(false), error = $state('');
  const scale = Math.min(400/owner.project.width, 220/owner.project.height);
  onDestroy(() => { alive = false; revision++; });
  function change(value: string) {
    text = value; revision++; ready = false; error = '';
  }
  let pickArtwork = $state(false), sourceCanvas = $state<HTMLCanvasElement>();
  $effect(() => {
    const ctx = sourceCanvas?.getContext('2d');
    if (!ctx || !sourceCanvas) return;
    ctx.setTransform(scale,0,0,scale,0,0);
    ctx.clearRect(0,0,sourceCanvas.width/scale,sourceCanvas.height/scale);
    for (const shape of keys[0].shapes) drawShape(ctx,shape,owner.project.assets);
  });
  let stagePicking = $state(false), side = $state(0);
  let stageBounds = $state<DOMRect>(), backdrop = $state<HTMLCanvasElement>();
  let returnButton = $state<HTMLButtonElement>(), pickButton = $state<HTMLButtonElement>();
  $effect(() => {
    if (stagePicking) returnButton?.focus({ preventScroll: true });
  });
  export function leaveStagePicking() {
    if (!stagePicking) return false;
    stagePicking = false;
    void tick().then(() => { if (alive) pickButton?.focus(); });
    return true;
  }
  $effect(() => {
    if (!stagePicking) return;
    const measure = () => { stageBounds = stage.getBoundingClientRect(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('scroll', measure, true); };
  });
  $effect(() => {
    const ctx = backdrop?.getContext('2d');
    if (!ctx || !backdrop) return;
    ctx.resetTransform();
    ctx.clearRect(0,0,backdrop.width,backdrop.height);
    ctx.setTransform(...view.matrix);
    ctx.fillStyle = owner.project.background;
    ctx.fillRect(0,0,owner.project.width,owner.project.height);
    for (const shape of keys[side].shapes) drawShape(ctx,shape,owner.project.assets);
  });
  function selectArtwork(next:number) {
    if (next !== index) { index = next; change(initialText(index)); }
  }
  function pick(event: PointerEvent) {
    if (event.button !== 0 || !sourceCanvas) return;
    const bounds = sourceCanvas.getBoundingClientRect();
    const point = {
      x:(event.clientX-bounds.left)*sourceCanvas.width/(bounds.width*scale),
      y:(event.clientY-bounds.top)*sourceCanvas.height/(bounds.height*scale),
    };
    for (let i=keys[0].shapes.length-1;i>=0;i--) {
      if (!hit(keys[0].shapes[i],point,0)) continue;
      if (i < count) { selectArtwork(i); pickArtwork = false; }
      break;
    }
  }
  function run(commit: boolean) {
    const captured = revision;
    const validate = () => {
      owner.validate();
      if (!alive || revision !== captured) throw Error('Shape hints changed. Preview again.');
    };
    try {
      validate();
      const input: TimelineTweenInput = { start:span.start, end:span.end, kind:'shape',
        ease:span.ease, affine:!!span.options?.affine, createEndpoints:false,
        shapeHints:{spanId:span.id,text,...(scoped ? {pair:{sourceId:keys[0].shapes[index].id,targetId:keys[1].shapes[index].id}} : {})} };
      if (commit) {
        if (ready) apply(input,validate);
        return;
      }
      const candidate = prepareTimelineTween(owner.project,owner.track,input,validate);
      const recipe = candidate.layers.find(l=>l.id===owner.track)!.liveMotionSpans!.find(s=>s.id===span.id)!;
      const plan = createMotionFrameSampler(candidate,owner.track,recipe);
      try {
        const shapes = plan.sample(at);
        if (!canvas) throw Error('Preview canvas is unavailable.');
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(scale,0,0,scale,0,0);
        ctx.clearRect(0,0,canvas.width/scale,canvas.height/scale);
        for (const shape of shapes) drawShape(ctx,shape,candidate.assets);
      } finally { plan.dispose(); }
      validate(); ready = true; error = '';
    } catch (cause) { ready = false; error = String(cause); }
  }
</script>

{#if stagePicking}
  {#if stageBounds && typeof endpoints !== 'string'}
    <div class="endpoint-stage" style:left={stageBounds.left+'px'} style:top={stageBounds.top+'px'}
      style:width={stageBounds.width+'px'} style:height={stageBounds.height+'px'}>
      <canvas bind:this={backdrop} width={view.width} height={view.height} aria-label="Shape hint endpoint artwork"></canvas>
      <MotionNodeHints source={endpoints[0]} target={endpoints[1]} bind:value={()=>text,change}
        stageBox={{x:0,y:0,width:view.width,height:view.height}} stageMatrix={view.matrix} stageScale={view.zoom}
        bind:stageSide={side} shapeMatching straight={false} curves={true} distance={typeof matching==='object' && !!matching.distance}
        offset={0} offsets="" reverse={false} directions="" order="" label="Live stage hint" />
      <button class="back" bind:this={returnButton} onclick={leaveStagePicking}>Return to shape hints</button>
    </div>
  {/if}
{:else}
<h2>Edit shape hints</h2>
<p>{layer.name} &middot; Frames {span.start+1}-{span.end+1}</p>
{#if scoped}
  <label>Artwork pair <select aria-label="Shape tween artwork pair" value={index}
    onchange={event=>selectArtwork(Number(event.currentTarget.value))}>
    {#each keys[0].shapes.slice(0,count) as shape,i}
      <option value={i}>{i+1}. {shape.kind} ({shape.id}) to {keys[1].shapes[i].kind} ({keys[1].shapes[i].id})</option>
    {/each}
  </select></label>
  <button aria-pressed={pickArtwork} onclick={()=>pickArtwork=!pickArtwork}>Pick from start frame</button>
  {#if pickArtwork}
    <canvas bind:this={sourceCanvas} aria-label="Start frame artwork" onpointerup={pick}
      width={Math.max(1,Math.ceil(owner.project.width*scale))}
      height={Math.max(1,Math.ceil(owner.project.height*scale))}></canvas>
  {/if}
{/if}
{#if typeof endpoints === 'string'}
  <p role="alert">{endpoints}</p>
{:else}
  <button bind:this={pickButton} onclick={()=>{change(text); side=0; stagePicking=true;}}>Pick anchors on stage</button>
  <label>Node pairs <input aria-label="Shape tween node pairs" value={text}
    oninput={e=>change(e.currentTarget.value)} placeholder="1:2, 3:4" /></label>
  <MotionNodeHints source={endpoints[0]} target={endpoints[1]} bind:value={()=>text,change}
    shapeMatching straight={false} curves={true} distance={typeof matching==='object' && !!matching.distance}
    offset={0} offsets="" reverse={false} directions="" order="" label="Shape tween" />
  <button onclick={()=>run(false)}>Preview shape hints</button>
  <figure hidden={!ready}><figcaption>Frame {at+1}</figcaption>
    <canvas bind:this={canvas} aria-label="Shape tween midpoint" width={Math.max(1,Math.ceil(owner.project.width*scale))}
      height={Math.max(1,Math.ceil(owner.project.height*scale))}></canvas>
  </figure>
  {#if error}<p role="alert">{error}</p>{/if}
  <button disabled={!ready} onclick={()=>run(true)}>Apply shape hints</button>
{/if}
<button onclick={cancel}>Cancel</button>

{/if}

<style>
  :global(.shape-hint-dialog:has(.endpoint-stage)) {
    position: fixed;
    inset: 0;
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }
  :global(.dialog:has(.endpoint-stage) > .dialog-close) { display:none; }
  .endpoint-stage { position:fixed; overflow:hidden; background:#414550; }
  .endpoint-stage canvas { width:100%; height:100%; background:transparent; }
  .back { position:absolute; top:4px; right:4px; }
  figure { margin: .5rem 0; }
  canvas { display:block; max-width:100%; background:#eee; }
</style>
