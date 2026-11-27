<script lang="ts">
  import type { Snippet } from 'svelte';
  import TimelineScrollbar from './TimelineScrollbar.svelte';
  import LayerOptionIcon from './LayerOptionIcon.svelte';
  import { timelineFrameMax, zoomTimeline } from './timeline-zoom';
  import { revealToolbarFocus } from './toolbar-focus';
  let {
    id = 'timeline-panel',
    inert = false,
    width = $bindable(0),
    canvas = $bindable(),
    layerList = $bindable(),
    frame,
    activeLayerName,
    frameLabel,
    frameComment,
    frameScript = false,
    frameSelection,
    duration,
    fps,
    playing = false,
    onion = false,
    height,
    frameStart,
    layerStart,
    cellWidth,
    frameLimit = 100000,
    changeZoom,
    canZoom,
    layerMax,
    first,
    last,
    play,
    toggleOnion,
    keyframe,
    removeKey,
    addLayer,
    deleteLayer,
    shiftLayer,
    deleteDisabled = false,
    blankDisabled = false,
    rows,
    divider,
    extras,
    changeFrameStart,
    changeLayerStart,
    down,
    move,
    up,
    cancel,
    blur,
    keys,
    context,
    layerContext,
    listOver,
    listLeave,
    rootOver,
    rootDrop,
    keyLabel = 'Keyframe',
    blankLabel = 'Blank',
    addLabel = 'Add layer',
  }: {
    id?: string;
    inert?: boolean;
    width?: number;
    canvas?: HTMLCanvasElement;
    layerList?: HTMLDivElement;
    frame: number;
    activeLayerName: string;
    frameLabel?: string;
    frameComment?: string;
    frameScript?: boolean;
    frameSelection?: { start: number; end: number; layers: number };
    duration: number;
    fps: number;
    playing?: boolean;
    onion?: boolean;
    height: number;
    frameStart: number;
    layerStart: number;
    cellWidth: number;
    frameLimit?: number;
    changeZoom: (view: { cellWidth: number; frameStart: number }) => void;
    canZoom: () => boolean;
    layerMax: number;
    first: () => void;
    last: () => void;
    play: () => void;
    toggleOnion?: () => void;
    keyframe: (blank?: boolean) => void;
    removeKey: () => void;
    addLayer: () => void;
    deleteLayer: () => void;
    shiftLayer: (direction: number) => void;
    deleteDisabled?: boolean;
    blankDisabled?: boolean;
    rows: Snippet;
    divider?: Snippet;
    extras?: Snippet;
    changeFrameStart: (n: number) => void;
    changeLayerStart: (n: number) => void;
    down: (e: PointerEvent) => void;
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
    blur: () => void;
    keys: (e: KeyboardEvent) => void;
    context: (e: MouseEvent) => void;
    layerContext?: (e: MouseEvent) => void;
    listOver?: (e: DragEvent) => void;
    listLeave?: (e: DragEvent) => void;
    rootOver?: (e: DragEvent) => void;
    rootDrop?: (e: DragEvent) => void;
    keyLabel?: string;
    blankLabel?: string;
    addLabel?: string;
  } = $props();
  const frameMax = $derived(timelineFrameMax(duration, width, cellWidth, frameLimit));
  let canvasFocused = $state(false);
  const selectionDescription = $derived.by(() => {
    if (!frameSelection) return '';
    const { start, end, layers } = frameSelection;
    if (start === end && layers < 2) return '';
    const frames = start === end ? `Frame ${start + 1}` : `Frames ${start + 1} to ${end + 1}`;
    return ` ${frames} selected${layers > 1 ? ` across ${layers} layers` : ''}.`;
  });
  const position = $derived(
    `Frame ${frame + 1} of ${duration}. Layer ${activeLayerName}.${frameScript ? ' Frame script attached.' : ''}${selectionDescription}`,
  );
  $effect(() => {
    const element = canvas;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (!event.deltaY || !element) return;
      event.preventDefault();
      if (inert || !canZoom()) return;
      const box = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(box.width - 1, event.clientX - box.left));
      const view = zoomTimeline(cellWidth, frameStart, x, event.deltaY, width, duration, frameLimit);
      if (view) changeZoom(view);
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });
</script>

<section {id} {inert} class="timeline" aria-label="Timeline" data-timeline-implementation="shared">
  {#if divider}{@render divider()}{/if}
  <div class="panel-heading" onfocusin={revealToolbarFocus}>
    <strong>TIMELINE</strong><span class="frame-readout"
      >Frame {frame + 1} <span>/ {duration}</span></span
    >
    {#if frameLabel}<span title={frameLabel} aria-label="Current frame label" style="color:#ffd277;max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{frameLabel}</span>{/if}
    {#if frameComment}<span class="frame-comment" title={frameComment} aria-label="Current frame comment">{frameComment}</span>{/if}
    <div class="top-spacer"></div>
    <button aria-label="First frame" title="First frame" onclick={first}>⏮</button><button
      aria-label={playing ? 'Stop playback' : 'Play animation'}
      class:active={playing}
      onclick={play}>{playing ? 'Ⅱ' : '▶'}</button
    ><button aria-label="Last frame" title="Last frame" onclick={last}>⏭</button>
    <span class="separator"></span>{#if toggleOnion}<button
        class:active={onion}
        aria-label="Onion skin"
        aria-pressed={onion}
        title="Toggle onion skin"
        onclick={toggleOnion}>▧</button
      >{/if}<span>{(frame / fps).toFixed(2)} s</span>
    <button aria-label={keyLabel} onclick={() => keyframe()}>Keyframe</button><button
      aria-label={blankLabel}
      disabled={blankDisabled}
      onclick={() => keyframe(true)}>Blank</button
    ><button disabled={!frame} onclick={removeKey} aria-label="Remove keyframe" title="Remove keyframe">− Key</button>
    {#if extras}{@render extras()}{/if}
  </div>
  <span class="timeline-accessible-text" id={`${id}-keyboard`}>
    Use Left and Right to move between frames, Home and End to go to the first or last frame,
    and Up and Down to change layers.
  </span>
  <span class="timeline-accessible-text" id={`${id}-position`} role="status"
    aria-live={canvasFocused && !playing && !inert ? 'polite' : 'off'} aria-atomic="true">{position}</span>
  <div class="timeline-content" style:height={`${height}px`}>
    <div
      class="layer-list"
      role="group"
      aria-label="Timeline layers"
      bind:this={layerList}
      oncontextmenu={(e) => { if (e.target === e.currentTarget) layerContext?.(e); }}
      ondragover={listOver}
      ondragleave={listLeave}
    >
      <div
        class="layer-header"
        role="group"
        aria-label="Root layer organization"
        ondragover={rootOver}
        ondrop={rootDrop}
      >
        <span>Layer</span><span class="layer-option-headings">
          <span role="img" aria-label="Outline" title="Outline"
            ><LayerOptionIcon kind="outline" /></span
          ><span role="img" aria-label="Hide" title="Hide"><LayerOptionIcon kind="hide" /></span
          ><span role="img" aria-label="Lock" title="Lock"><LayerOptionIcon kind="lock" /></span
          ></span
        >
      </div>
      {@render rows()}
    </div>
    <div class="frames" bind:clientWidth={width}>
      <canvas
        bind:this={canvas}
        style={`width:100%;height:${height}px;touch-action:none`}
        aria-label="Timeline frames"
        aria-describedby={`${id}-position ${id}-keyboard`}
        data-context="timeline"
        tabindex="0"
        oncontextmenu={context}
        onkeydown={keys}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={cancel}
        onlostpointercapture={cancel}
        onfocus={() => { canvasFocused = true; }}
        onblur={() => { canvasFocused = false; blur(); }}
      ></canvas>
    </div>
    <TimelineScrollbar
      label="Timeline layer scroll"
      controls={id}
      vertical
      value={layerStart}
      max={layerMax}
      step={28}
      change={changeLayerStart}
    />
  </div>
  <div class="timeline-bottom">
    <div class="layer-actions">
      <button title="Add layer" aria-label={addLabel} onclick={addLayer}>＋</button><button
        title="Delete layer"
        aria-label="Delete layer"
        disabled={deleteDisabled}
        onclick={deleteLayer}>−</button
      ><button aria-label="Move layer up" title="Move layer up" onclick={() => shiftLayer(1)}>↑</button><button
        aria-label="Move layer down" title="Move layer down"
        onclick={() => shiftLayer(-1)}>↓</button
      >
    </div>
    <TimelineScrollbar
      label="Timeline scroll"
      controls={id}
      value={frameStart}
      max={frameMax}
      step={cellWidth}
      change={changeFrameStart}
    /><span class="timeline-scroll-corner"></span>
  </div>
</section>

<style>
  .frame-comment {
    color: #70d9ef;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
