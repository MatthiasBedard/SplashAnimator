<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  const topInset = 32;
  let surface: HTMLElement;
  let viewportWidth = $state(0), viewportHeight = $state(0);
  let position = $state<{ x: number; y: number }>();
  let drag: { pointer: number; x: number; y: number } | undefined;

  function move(x: number, y: number) {
    position = {
      x: Math.max(0, Math.min(x, window.innerWidth - surface.offsetWidth)),
      y: Math.max(topInset, Math.min(y, window.innerHeight - surface.offsetHeight)),
    };
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || drag) return;
    const rect = surface.getBoundingClientRect();
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function follow(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) move(event.clientX - drag.x, event.clientY - drag.y);
  }

  function finish(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) drag = undefined;
  }

  const offsets: Partial<Record<string, [number, number]>> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
  function nudge(event: KeyboardEvent) {
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    move(rect.left + offset[0], rect.top + offset[1]);
  }

  $effect(() => {
    if (viewportWidth && viewportHeight && position && surface) {
      const x = Math.min(position.x, Math.max(0, viewportWidth - surface.offsetWidth));
      const y = Math.min(position.y, Math.max(topInset, viewportHeight - surface.offsetHeight));
      if (x !== position.x || y !== position.y) position = { x, y };
    }
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<div class="floating-script-surface" data-script-panel bind:this={surface} style:--top-inset={topInset + 'px'} style:left={position ? position.x + 'px' : undefined} style:top={position ? position.y + 'px' : undefined}>
  <button type="button" class="titlebar" aria-label="Move script editor window" title="Drag or use arrow keys to move" onpointerdown={start} onpointermove={follow} onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish} onkeydown={nudge}>
    Script Editor
  </button>
  <div class="content">{@render children()}</div>
</div>

<style>
  .floating-script-surface {
    position: fixed;
    z-index: 4;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    left: max(8px, calc((100dvw - 820px) / 2));
    top: max(var(--top-inset), calc((100dvh - 620px) / 2));
    width: min(820px, calc(100dvw - 16px));
    height: min(620px, calc(100dvh - 84px));
    min-width: min(340px, 100dvw);
    min-height: min(220px, calc(100dvh - var(--top-inset)));
    max-width: 100dvw;
    max-height: calc(100dvh - var(--top-inset));
    overflow: hidden;
    resize: both;
    background: #252830;
    border: 1px solid #626979;
    border-radius: 6px;
    box-shadow: 0 12px 40px #0009;
  }

  .titlebar {
    display: block;
    flex: none;
    width: 100%;
    padding: 4px 10px;
    border: 0;
    border-radius: 0;
    color: #e3e8ef;
    background: #343944;
    text-align: left;
    cursor: move;
    touch-action: none;
  }

  .content {
    flex: 1;
    min-height: 0;
  }
</style>
