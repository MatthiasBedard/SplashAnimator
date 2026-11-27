<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { SceneCatalog, SceneCommand } from '../../../packages/document/src/scenes';
  import { showFocusedDialog, wrapDialogTab } from './dialog-focus';

  let { catalog, change, add, close, error }: {
    catalog: SceneCatalog;
    change: (command: Exclude<SceneCommand, {kind: 'add'}>) => boolean;
    add: () => boolean;
    close: () => void;
    error: string;
  } = $props();
  let selected = $state(untrack(() => catalog.activeId));
  let name = $state(untrack(() => catalog.entries.find(entry => entry.id === selected)!.name));
  let confirmation = $state(false);
  let list: HTMLSelectElement;
  let confirmButton = $state<HTMLButtonElement>();
  const at = $derived(catalog.entries.findIndex(entry => entry.id === selected));

  function selectScene(id: string) {
    selected = id;
    name = catalog.entries.find(entry => entry.id === id)!.name;
    confirmation = false;
  }

  async function returnToList() {
    await tick();
    selectScene(catalog.activeId);
    list?.focus();
  }

  async function moveScene(direction: -1 | 1) {
    if (!change({ kind: 'move', id: selected, direction })) return;
    await tick();
    if (at === (direction < 0 ? 0 : catalog.entries.length - 1)) list?.focus();
  }
</script>

<dialog class="dialog scene-manager" aria-labelledby="scenes-title"
  use:showFocusedDialog={'select'} onkeydown={wrapDialogTab}
  oncancel={event => { event.preventDefault(); if (confirmation) { confirmation = false; list.focus(); } else close(); }}>
  <button class="dialog-close" type="button" aria-label="Close Scenes" onclick={close}>×</button>
  <h2 id="scenes-title">Scenes</h2>
  <select bind:this={list} aria-label="Project scenes" size="6" value={selected}
    onchange={event => selectScene(event.currentTarget.value)}
    onkeydown={event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (change({ kind: 'open', id: selected })) close();
      }
    }}>
    {#each catalog.entries as scene (scene.id)}
      <option value={scene.id}>{scene.name}{scene.id === catalog.activeId ? ' (open)' : ''}</option>
    {/each}
  </select>
  <div class="actions">
    <button onclick={() => { if (add()) void returnToList(); }}>Add scene</button>
    <button disabled={selected === catalog.activeId} onclick={() => { if (change({ kind: 'open', id: selected })) close(); }}>Open scene</button>
    <button disabled={at <= 0} onclick={() => void moveScene(-1)}>Move up</button>
    <button disabled={at >= catalog.entries.length - 1} onclick={() => void moveScene(1)}>Move down</button>
  </div>
  <form onsubmit={event => { event.preventDefault(); if (change({ kind: 'rename', id: selected, name })) name = name.trim(); }}>
    <label>Scene name <input bind:value={name} maxlength="200" required /></label>
    <button type="submit">Rename scene</button>
  </form>
  {#if confirmation}
    <p>Delete “{catalog.entries[at]?.name}” and its timeline? You can undo this change.</p>
    <div class="actions">
      <button bind:this={confirmButton} onclick={() => { if (change({ kind: 'delete', id: selected })) void returnToList(); }}>Confirm delete</button>
      <button onclick={() => { confirmation = false; list.focus(); }}>Keep scene</button>
    </div>
  {:else}
    <button disabled={catalog.entries.length <= 1} onclick={async () => { confirmation = true; await tick(); confirmButton?.focus(); }}>Delete scene</button>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <p class="hint">Playback and animation exports use the open scene. The Library and document settings are shared.</p>
</dialog>

<style>
  .scene-manager { width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
  select { display: block; width: 100%; margin-bottom: 10px; }
  .actions, form { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  form label { display: flex; align-items: center; gap: 8px; }
  form input { min-width: 0; }
</style>
