<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let { reportError }: { reportError: (error: unknown) => void } = $props();
  const nativeWindow = getCurrentWindow();
  let maximized = $state(false);
  let sizeCheck = 0;
  const sizeAction = $derived(maximized ? 'Restore window' : 'Maximize window');

  async function refreshMaximized() {
    const check = ++sizeCheck;
    const current = await nativeWindow.isMaximized();
    if (check === sizeCheck) maximized = current;
  }

  onMount(() => {
    const refresh = () => void refreshMaximized().catch(reportError);
    refresh();
    window.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      sizeCheck++;
    };
  });

  async function changeSize() {
    await nativeWindow.toggleMaximize();
    await refreshMaximized();
  }
</script>

<div class="window-buttons" role="group" aria-label="Window controls">
  <button
    type="button"
    aria-label="Minimize window"
    title="Minimize window"
    onclick={() => void nativeWindow.minimize().catch(reportError)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11.5h10" /></svg>
  </button>
  <button
    type="button"
    aria-label={sizeAction}
    title={sizeAction}
    onclick={() => void changeSize().catch(reportError)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {#if maximized}<path d="M5.5 4.5v-2h8v8h-2 M2.5 5.5h8v8h-8z" />
      {:else}<path d="M3.5 3.5h9v9h-9z" />{/if}
    </svg>
  </button>
  <button
    class="close-window"
    type="button"
    aria-label="Close window"
    title="Close window"
    onclick={() => void nativeWindow.close().catch(reportError)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>
  </button>
</div>

<style>
  .window-buttons {
    display: flex;
    align-self: stretch;
    flex-shrink: 0;
    margin-left: 8px;
  }
  .window-buttons button {
    display: grid;
    place-items: center;
    width: 42px;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: transparent;
  }
  .window-buttons button:hover {
    background: var(--accent-surface);
  }
  .window-buttons button:focus-visible {
    outline-offset: -2px;
  }
  .window-buttons .close-window:hover {
    background: #b42332;
    color: white;
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
  }
</style>
