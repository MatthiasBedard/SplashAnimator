<script lang="ts">
  let {
    label,
    controls,
    vertical = false,
    value,
    max,
    step,
    change,
  }: {
    label: string;
    controls: string;
    vertical?: boolean;
    value: number;
    max: number;
    step: number;
    change: (value: number) => void;
  } = $props();
  const positionId = $derived(`${controls}-scroll-${vertical ? 'layers' : 'frames'}-position`);
  let rail: HTMLDivElement;
  let width = $state(0),
    height = $state(0);
  $effect(() => {
    const offset = Math.max(0, Math.min(max, value)) * step;
    if (rail) {
      if (vertical) rail.scrollTop = offset;
      else rail.scrollLeft = offset;
    }
  });
  function scroll() {
    const next = Math.max(
      0,
      Math.min(max, Math.round((vertical ? rail.scrollTop : rail.scrollLeft) / step)),
    );
    if (next !== value) change(next);
  }
  function keys(event: KeyboardEvent) {
    const page = Math.max(1, Math.floor((vertical ? height : width) / step));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? max
          : event.key === 'PageUp'
            ? value - page
            : event.key === 'PageDown'
              ? value + page
              : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')
                ? value - 1
                : event.key === (vertical ? 'ArrowDown' : 'ArrowRight')
                  ? value + 1
                  : null;
    if (next === null || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    change(Math.max(0, Math.min(max, next)));
  }
</script>

<div
  bind:this={rail}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="timeline-scrollbar"
  class:vertical
  aria-label={label}
  role="scrollbar"
  aria-controls={controls}
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={value}
  aria-describedby={positionId}
  tabindex="0"
  onscroll={scroll}
  onkeydown={keys}
>
  <div
    style:width={`${vertical ? 1 : width + max * step}px`}
    style:height={`${vertical ? height + max * step : 1}px`}
  ></div>
</div>

<span id={positionId} hidden>First visible {vertical ? 'layer row' : 'frame'} {value + 1}</span>

<style>
  .timeline-scrollbar {
    flex: 1;
    min-width: 0;
    height: 17px;
    overflow-x: scroll;
    overflow-y: hidden;
    color-scheme: inherit;
  }
  .timeline-scrollbar.vertical {
    flex: 0 0 17px;
    width: 17px;
    height: 100%;
    overflow-x: hidden;
    overflow-y: scroll;
  }
</style>
