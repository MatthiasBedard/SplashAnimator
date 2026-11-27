<script lang="ts">
  import { onMount } from 'svelte';
  export type ContextAction = { label: string; disabled?: boolean; run: () => void };
  let { x, y, items, close }: { x: number; y: number; items: ContextAction[]; close: () => void } =
    $props();
  let element: HTMLDivElement;
  let left = $state(0),
    top = $state(0);
  const buttons = () => [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  onMount(() => {
    const box = element.getBoundingClientRect();
    left = Math.max(4, Math.min(x, innerWidth - box.width - 4));
    top = Math.max(4, Math.min(y, innerHeight - box.height - 4));
    (buttons()[0] ?? element).focus();
  });
  function keys(e: KeyboardEvent) {
    e.stopPropagation();
    const list = buttons(),
      current = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      // Closing restores the invoking control before native Tab navigation.
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!list.length) return;
      const index =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? list.length - 1
            : (current + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[index]?.focus();
    }
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (!element?.contains(e.target as Node)) close();
  }}
  onresize={close}
  onblur={close}
/>
<div
  bind:this={element}
  class="context-menu"
  role="menu"
  aria-label="Editing actions"
  tabindex="-1"
  style:left={left + 'px'}
  style:top={top + 'px'}
  onkeydown={keys}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item}<button
      role="menuitem"
      tabindex="-1"
      disabled={item.disabled}
      onclick={() => {
        close();
        item.run();
      }}>{item.label}</button
    >{/each}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 205px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    padding: 5px;
    border: 1px solid #515565;
    border-radius: 6px;
    background: #242731;
    box-shadow: 0 8px 28px #0008;
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
    color: #eee;
    background: transparent;
    border: 0;
    padding: 7px 12px;
    border-radius: 3px;
    font: inherit;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    background: #505276;
    outline: none;
  }
  button:disabled {
    color: #858895;
  }
  @media (forced-colors: active) {
    button:focus-visible {
      forced-color-adjust: none;
      background: Highlight;
      color: HighlightText;
      outline: 1px solid HighlightText;
      outline-offset: -2px;
    }
  }
</style>
