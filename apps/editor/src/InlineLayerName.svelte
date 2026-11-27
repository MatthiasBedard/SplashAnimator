<script lang="ts">
  import { onMount, untrack } from 'svelte';
  let {
    name,
    commit,
    cancel,
  }: {
    name: string;
    commit: (name: string, restoreFocus: boolean) => void;
    cancel: (restoreFocus: boolean) => void;
  } = $props();
  const original = untrack(() => name);
  let draft = $state(original),
    input: HTMLInputElement;
  let closed = false;
  onMount(() => {
    input.focus();
    input.select();
  });
  function save(restoreFocus: boolean) {
    if (closed) return;
    closed = true;
    const next = draft.trim();
    if (!next || draft === original) cancel(restoreFocus);
    else commit(next, restoreFocus);
  }
  function dismiss() {
    if (closed) return;
    closed = true;
    cancel(true);
  }
</script>

<input
  class="rename-layer-input"
  aria-label="Rename layer"
  title="Enter to save; Escape to cancel"
  maxlength="80"
  bind:this={input}
  bind:value={draft}
  onblur={() => save(false)}
  onkeydown={(e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      save(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }}
  oncontextmenu={(e) => e.stopPropagation()}
/>

<style>
  .rename-layer-input {
    flex: 1;
    width: 0;
    min-width: 0;
    height: 23px;
    margin: 0 3px;
    padding: 2px 5px;
    font-size: 11px;
  }
</style>
