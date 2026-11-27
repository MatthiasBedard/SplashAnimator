<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    label,
    controls,
    orientation = 'vertical',
    reverse = false,
    offset = 0,
    value,
    min,
    max,
    defaultValue,
    context = '',
    canStart = () => true,
    preview,
    commit,
  }: {
    label: string;
    controls: string;
    orientation?: 'vertical' | 'horizontal';
    reverse?: boolean;
    offset?: number;
    value: number;
    min: number;
    max: number;
    defaultValue: number;
    context?: string;
    canStart?: () => boolean;
    preview: (value: number | null) => void;
    commit: (value: number) => void;
  } = $props();
  let element: HTMLDivElement;
  let drag = $state<{
    pointer: number;
    coordinate: number;
    value: number;
    current: number;
    context: string;
  } | null>(null);
  const clamp = (n: number) => Math.round(Math.max(min, Math.min(max, n)));
  function clear() {
    const active = drag;
    drag = null;
    if (active && element?.hasPointerCapture(active.pointer))
      element.releasePointerCapture(active.pointer);
    preview(null);
  }
  function start(event: PointerEvent) {
    if (drag || event.button !== 0 || !event.isPrimary || !canStart()) return;
    const coordinate = orientation === 'vertical' ? event.clientX : event.clientY;
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault();
    event.stopPropagation();
    element.focus({ preventScroll: true });
    drag = { pointer: event.pointerId, coordinate, value, current: value, context };
    try {
      element.setPointerCapture(event.pointerId);
      preview(value);
    } catch {
      clear();
    }
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.context !== context || !canStart()) {
      clear();
      return;
    }
    const coordinate = orientation === 'vertical' ? event.clientX : event.clientY;
    if (!Number.isFinite(coordinate)) {
      clear();
      return;
    }
    drag.current = clamp(drag.value + (coordinate - drag.coordinate) * (reverse ? -1 : 1));
    preview(drag.current);
  }
  function finish(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    move(event);
    if (!drag) return;
    const next = drag.current,
      original = drag.value;
    clear();
    if (next !== original && canStart()) commit(next);
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      event.stopPropagation();
      clear();
      return;
    }
    if (drag || !canStart()) return;
    const step = event.shiftKey ? 50 : 10;
    let next: number | undefined;
    if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'PageUp') next = value + 50;
    else if (event.key === 'PageDown') next = value - 50;
    else if (event.key === (orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'))
      next = value + step * (reverse ? -1 : 1);
    else if (event.key === (orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'))
      next = value - step * (reverse ? -1 : 1);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const bounded = clamp(next);
    if (bounded !== value) commit(bounded);
  }
  $effect(() => {
    if (drag && drag.context !== context) clear();
  });
  onDestroy(clear);
</script>

<svelte:window onblur={clear} />
<!-- Focusable separator widgets expose numeric values and keyboard movement:
     https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/ -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={element}
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-controls={controls}
  aria-orientation={orientation}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={Math.round(value)}
  aria-valuetext={`${Math.round(value)} pixels`}
  title={`${label}. Drag or use arrow keys; double-click to reset.`}
  class="workspace-divider"
  class:vertical={orientation === 'vertical'}
  class:horizontal={orientation === 'horizontal'}
  class:resizing={!!drag}
  style:left={orientation === 'vertical' && !reverse ? `${offset + value - 3}px` : undefined}
  style:right={orientation === 'vertical' && reverse ? `${value - 3}px` : undefined}
  onpointerdown={start}
  onpointermove={move}
  onpointerup={finish}
  onpointercancel={(e) => {
    if (drag?.pointer === e.pointerId) clear();
  }}
  onlostpointercapture={(e) => {
    if (drag?.pointer === e.pointerId) clear();
  }}
  onkeydown={key}
  ondblclick={() => {
    if (!drag && canStart()) commit(clamp(defaultValue));
  }}
></div>

<style>
  .workspace-divider {
    position: absolute;
    z-index: 8;
    touch-action: none;
    user-select: none;
  }
  .vertical {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .horizontal {
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
  }
  .workspace-divider:hover,
  .workspace-divider:focus-visible,
  .resizing {
    background: var(--accent-divider-hover);
    outline: none;
  }
</style>
