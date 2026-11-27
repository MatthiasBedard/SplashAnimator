<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    pan,
    width,
    height,
    documentWidth,
    documentHeight,
    zoom,
    controls = 'drawing-stage',
    blocked,
    change,
  }: {
    pan: { x: number; y: number };
    width: number;
    height: number;
    documentWidth: number;
    documentHeight: number;
    zoom: number;
    controls?: string;
    blocked: () => boolean;
    change: (value: { x: number; y: number }) => void;
  } = $props();
  let horizontal = $state<HTMLDivElement>(),
    vertical = $state<HTMLDivElement>();
  const xLimit = $derived(Math.max((documentWidth * zoom + width) / 2, Math.abs(pan.x)));
  const yLimit = $derived(Math.max((documentHeight * zoom + height) / 2, Math.abs(pan.y)));
  const xThumb = $derived(Math.min(width, Math.max(24, (width * width) / (width + 2 * xLimit))));
  const yThumb = $derived(
    Math.min(height, Math.max(24, (height * height) / (height + 2 * yLimit))),
  );
  let drag:
    | {
        axis: 'x' | 'y';
        pointer: number;
        start: number;
        offset: number;
        ratio: number;
        element: HTMLDivElement;
      }
    | undefined;
  function stop() {
    const old = drag;
    drag = undefined;
    if (old?.element.hasPointerCapture(old.pointer)) old.element.releasePointerCapture(old.pointer);
  }
  onDestroy(stop);
  $effect(() => {
    void [width, height, zoom, documentWidth, documentHeight];
    stop();
  });
  function end(e: PointerEvent) {
    if (e.pointerId === drag?.pointer) stop();
  }
  function down(e: PointerEvent, axis: 'x' | 'y') {
    if (e.button !== 0 || blocked() || drag || ![e.clientX, e.clientY].every(Number.isFinite))
      return;
    e.preventDefault();
    e.stopPropagation();
    const element = e.currentTarget as HTMLDivElement,
      rect = element.getBoundingClientRect();
    element.focus({ preventScroll: true });
    const size = axis === 'x' ? width : height,
      thumb = axis === 'x' ? xThumb : yThumb,
      limit = axis === 'x' ? xLimit : yLimit;
    const offset = axis === 'x' ? element.scrollLeft : element.scrollTop;
    const local = axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top,
      position = ((limit - pan[axis]) / (2 * limit)) * (size - thumb);
    if (local < position || local > position + thumb) {
      change({
        ...pan,
        [axis]: Math.max(
          -limit,
          Math.min(limit, pan[axis] + (local < position ? 1 : -1) * size * 0.9),
        ),
      });
      return;
    }
    drag = {
      axis,
      pointer: e.pointerId,
      start: axis === 'x' ? e.clientX : e.clientY,
      offset,
      ratio: (2 * limit) / Math.max(1, size - thumb),
      element,
    };
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      drag = undefined;
    }
  }
  function move(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (!(e.buttons & 1) || blocked()) {
      stop();
      return;
    }
    const value =
      drag.offset + ((drag.axis === 'x' ? e.clientX : e.clientY) - drag.start) * drag.ratio;
    if (drag.axis === 'x') drag.element.scrollLeft = value;
    else drag.element.scrollTop = value;
    scroll(drag.axis);
  }
  let syncedX = NaN,
    syncedY = NaN;
  function sync() {
    if (horizontal) {
      horizontal.scrollLeft = xLimit - pan.x;
      syncedX = horizontal.scrollLeft;
    }
    if (vertical) {
      vertical.scrollTop = yLimit - pan.y;
      syncedY = vertical.scrollTop;
    }
  }
  $effect(() => {
    void [pan.x, pan.y, xLimit, yLimit, width, height, horizontal, vertical];
    sync();
  });
  function scroll(axis: 'x' | 'y') {
    const element = axis === 'x' ? horizontal : vertical;
    // A native scroll can arrive after a frame change has detached its rail.
    if (!element) return;
    const value = axis === 'x' ? element.scrollLeft : element.scrollTop;
    if (value === (axis === 'x' ? syncedX : syncedY)) return;
    if (blocked()) {
      sync();
      return;
    }
    // Both native axes can move before their queued scroll events arrive.
    // Consume them together so synchronizing one axis cannot erase the other.
    const next = { ...pan };
    if (horizontal && horizontal.scrollLeft !== syncedX) next.x = xLimit - horizontal.scrollLeft;
    if (vertical && vertical.scrollTop !== syncedY) next.y = yLimit - vertical.scrollTop;
    change(next);
  }
  function key(e: KeyboardEvent, axis: 'x' | 'y') {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopPropagation();
      stop();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const limit = axis === 'x' ? xLimit : yLimit,
      page = axis === 'x' ? width : height;
    const step =
      e.key === 'Home'
        ? -Infinity
        : e.key === 'End'
          ? Infinity
          : e.key === 'PageDown'
            ? page * 0.9
            : e.key === 'PageUp'
              ? -page * 0.9
              : e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')
                ? 40
                : e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')
                  ? -40
                  : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    if (!blocked()) change({ ...pan, [axis]: Math.max(-limit, Math.min(limit, pan[axis] - step)) });
  }
</script>

<div
  class="horizontal"
  bind:this={horizontal}
  role="scrollbar"
  tabindex="0"
  aria-label="Canvas horizontal scrollbar"
  aria-orientation="horizontal"
  aria-controls={controls}
  aria-valuemin="0"
  aria-valuemax={2 * xLimit}
  aria-valuenow={xLimit - pan.x}
  onpointerdown={(e) => down(e, 'x')}
  onpointermove={move}
  onpointerup={(e) => {
    if (e.pointerId === drag?.pointer) stop();
  }}
  onpointercancel={end}
  onlostpointercapture={end}
  onscroll={() => scroll('x')}
  onkeydown={(e) => key(e, 'x')}
>
  <div style:width={`${Math.max(1, width) + 2 * xLimit}px`} style:height="1px"></div>
  <div
    class="thumb horizontal-thumb"
    style:width={`${xThumb}px`}
    style:left={`${xLimit - pan.x + ((xLimit - pan.x) / (2 * xLimit)) * (width - xThumb)}px`}
  ></div>
</div>
<div
  class="vertical"
  bind:this={vertical}
  role="scrollbar"
  tabindex="0"
  aria-label="Canvas vertical scrollbar"
  aria-orientation="vertical"
  aria-controls={controls}
  aria-valuemin="0"
  aria-valuemax={2 * yLimit}
  aria-valuenow={yLimit - pan.y}
  onpointerdown={(e) => down(e, 'y')}
  onpointermove={move}
  onpointerup={(e) => {
    if (e.pointerId === drag?.pointer) stop();
  }}
  onpointercancel={end}
  onlostpointercapture={end}
  onscroll={() => scroll('y')}
  onkeydown={(e) => key(e, 'y')}
>
  <div style:height={`${Math.max(1, height) + 2 * yLimit}px`} style:width="1px"></div>
  <div
    class="thumb vertical-thumb"
    style:height={`${yThumb}px`}
    style:top={`${yLimit - pan.y + ((yLimit - pan.y) / (2 * yLimit)) * (height - yThumb)}px`}
  ></div>
</div>
<div class="corner"></div>

<svelte:window onblur={stop} />

<style>
  .horizontal,
  .vertical {
    scrollbar-width: none;
    touch-action: none;
  }
  .horizontal::-webkit-scrollbar,
  .vertical::-webkit-scrollbar {
    display: none;
  }
  .thumb {
    position: absolute;
    background: var(--canvas-scroll-thumb, #8a92a3);
    border: 1px solid var(--canvas-scroll-thumb-border, #a4acbb);
    border-radius: 7px;
  }
  .horizontal-thumb {
    top: 3px;
    height: 10px;
  }
  .vertical-thumb {
    left: 3px;
    width: 10px;
  }
  .horizontal,
  .vertical,
  .corner {
    position: absolute;
    background: var(--canvas-scroll-track, #252830);
  }
  .horizontal {
    left: 0;
    right: 16px;
    bottom: 0;
    height: 16px;
    overflow-x: scroll;
    overflow-y: hidden;
  }
  .vertical {
    top: 0;
    bottom: 16px;
    right: 0;
    width: 16px;
    overflow-y: scroll;
    overflow-x: hidden;
  }
  .corner {
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
  }
  div:focus-visible {
    outline: 1px solid #98b9ff;
    outline-offset: -1px;
  }
</style>
