<script module lang="ts">
  export type CanvasResizeBounds = { width: number; height: number; left: number; top: number };
</script>

<script lang="ts">
  import { inversePoint, mapPoint, type Matrix } from '../../../packages/geometry/src/affine';

  let { bounds, matrix, viewWidth, viewHeight, limit, change }: {
    bounds: CanvasResizeBounds;
    matrix: Matrix;
    viewWidth: number;
    viewHeight: number;
    limit: number;
    change: (bounds: CanvasResizeBounds) => void;
  } = $props();

  const handles = [
    { name: 'top left', x: -1, y: -1 },
    { name: 'top', x: 0, y: -1 },
    { name: 'top right', x: 1, y: -1 },
    { name: 'right', x: 1, y: 0 },
    { name: 'bottom right', x: 1, y: 1 },
    { name: 'bottom', x: 0, y: 1 },
    { name: 'bottom left', x: -1, y: 1 },
    { name: 'left', x: -1, y: 0 },
  ];
  type Handle = typeof handles[number];
  let overlay: HTMLDivElement;
  let drag: {
    pointer: number;
    button: HTMLButtonElement;
    handle: Handle;
    bounds: CanvasResizeBounds;
    rect: DOMRect;
    basis: Matrix;
    x: number;
    y: number;
    viewWidth: number;
    viewHeight: number;
  } | undefined;

  function resize(from: CanvasResizeBounds, handle: Handle, dx: number, dy: number) {
    const width = Math.max(1, Math.min(limit, Math.round(from.width + handle.x * dx)));
    const height = Math.max(1, Math.min(limit, Math.round(from.height + handle.y * dy)));
    change({
      width, height,
      left: from.left + (handle.x < 0 ? from.width - width : 0),
      top: from.top + (handle.y < 0 ? from.height - height : 0),
    });
  }

  function start(event: PointerEvent & { currentTarget: HTMLButtonElement }, handle: Handle) {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = {
      pointer: event.pointerId, button: event.currentTarget, handle, rect, bounds,
      basis: [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0],
      x: event.clientX, y: event.clientY, viewWidth, viewHeight,
    };
  }

  function move(event: PointerEvent) {
    const current = drag;
    if (!current || event.pointerId !== current.pointer) return;
    const rect = overlay.getBoundingClientRect();
    if (rect.left !== current.rect.left || rect.top !== current.rect.top ||
        rect.width !== current.rect.width || rect.height !== current.rect.height ||
        viewWidth !== current.viewWidth || viewHeight !== current.viewHeight ||
        current.basis.slice(0, 4).some((value, index) => value !== matrix[index])) {
      end(event.pointerId, true);
      return;
    }
    const delta = inversePoint(current.basis, {
      x: (event.clientX - current.x) * viewWidth / rect.width,
      y: (event.clientY - current.y) * viewHeight / rect.height,
    });
    if (Number.isFinite(delta.x) && Number.isFinite(delta.y))
      resize(current.bounds, current.handle, delta.x, delta.y);
  }

  function end(pointer: number, cancelled: boolean) {
    const current = drag;
    if (!current || pointer !== current.pointer) return;
    drag = undefined;
    if (current.button.hasPointerCapture(current.pointer)) current.button.releasePointerCapture(current.pointer);
    if (cancelled) change(current.bounds);
  }

  function keys(event: KeyboardEvent, handle: Handle) {
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    if (!drag && !event.altKey && !event.ctrlKey && !event.metaKey && (dx || dy)) {
      event.preventDefault();
      resize(bounds, handle, dx, dy);
    }
  }

  function cursor(handle: Handle) {
    const { x, y } = mapPoint([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0], handle);
    const direction = (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 4;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][direction];
  }
</script>

<svelte:window onblur={() => { if (drag) end(drag.pointer, true); }} />

<div class="resize-overlay" bind:this={overlay} role="group" aria-label="Canvas resize handles">
  <div class="resize-outline" style:width={bounds.width + 'px'} style:height={bounds.height + 'px'}
    style:transform={`matrix(${matrix.join(',')})`} style:--outline-width={1 / Math.hypot(matrix[0], matrix[1]) + 'px'}></div>
  {#each handles as handle (handle.name)}
    {@const position = mapPoint(matrix, { x: (handle.x + 1) * bounds.width / 2, y: (handle.y + 1) * bounds.height / 2 })}
    <button type="button" class="resize-handle" aria-label={`Resize canvas from ${handle.name}`}
      style:left={position.x + 'px'} style:top={position.y + 'px'} style:cursor={cursor(handle)}
      onpointerdown={event => start(event, handle)} onpointermove={move}
      onpointerup={event => { move(event); end(event.pointerId, false); }}
      onpointercancel={event => end(event.pointerId, true)} onlostpointercapture={event => end(event.pointerId, true)}
      onkeydown={event => keys(event, handle)}></button>
  {/each}
</div>

<style>
  .resize-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  .resize-outline {
    position: absolute;
    transform-origin: top left;
    box-sizing: border-box;
    border: var(--outline-width) solid #007eaa;
  }
  .resize-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 12px;
    height: 12px;
    padding: 0;
    border: 2px solid #007eaa;
    border-radius: 2px;
    background: #fff;
    pointer-events: auto;
    touch-action: none;
  }
  .resize-handle:hover, .resize-handle:focus-visible { background: #9ee9ff; }
</style>
