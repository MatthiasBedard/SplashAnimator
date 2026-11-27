<script lang="ts">
  import { onMount } from 'svelte';
  import { wrapDialogTab } from './dialog-focus';
  import type { PanelLayout } from './panel-layout';
  import { addWorkspace, builtinWorkspace, BUILTIN_WORKSPACES, loadSavedWorkspaces,
    workspaceSnapshot, WORKSPACES_KEY, type SavedWorkspace } from './workspace-presets';

  let { layout, change, onclose, embedded = false }: {
    layout: PanelLayout;
    change: (next: PanelLayout) => void;
    onclose?: () => void;
    embedded?: boolean;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let chooser: HTMLSelectElement;
  let saved = $state.raw(loadSavedWorkspaces());
  let selected = $state('builtin:Standard');
  let name = $state('');
  let error = $state('');
  let status = $state('');
  const custom = (name: string) => 'saved:' + name;
  const selectedCustom = $derived(saved.find(workspace => custom(workspace.name) === selected));
  const selectedBuiltin = $derived(BUILTIN_WORKSPACES.find(workspace => 'builtin:' + workspace === selected));
  onMount(() => {
    if (!embedded) { dialog?.showModal(); chooser.focus(); }
  });

  function persist(next: SavedWorkspace[]) {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next));
    saved = next;
  }
  function manage(action: 'save' | 'replace' | 'remove') {
    error = status = '';
    try {
      if (action === 'save') {
        const next = addWorkspace(saved, name, layout);
        persist(next);
        const workspace = next.at(-1)!;
        selected = custom(workspace.name);
        name = '';
        status = 'Saved ' + workspace.name;
      } else if (selectedCustom) {
        const chosen = selectedCustom;
        if (action === 'replace') {
          persist(saved.map(workspace => workspace === chosen
            ? { ...workspace, layout: workspaceSnapshot(layout) } : workspace));
          status = 'Updated ' + chosen.name;
        } else {
          persist(saved.filter(workspace => workspace !== chosen));
          selected = 'builtin:Standard';
          status = 'Removed ' + chosen.name;
          chooser.focus();
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The workspace could not be saved.';
    }
  }
  function apply() {
    const next = selectedCustom ? workspaceSnapshot(selectedCustom.layout)
      : selectedBuiltin ? builtinWorkspace(selectedBuiltin) : undefined;
    if (!next) return;
    change(next);
    if (embedded) status = 'Workspace applied.';
    else dialog?.close();
  }
</script>

{#snippet controls()}
  <label>Workspace
    <select bind:this={chooser} bind:value={selected}>
      <optgroup label="Built-in">
        {#each BUILTIN_WORKSPACES as workspace}
          <option value={'builtin:' + workspace}>{workspace}</option>
        {/each}
      </optgroup>
      {#if saved.length}
        <optgroup label="Saved">
          {#each saved as workspace (workspace.name)}
            <option value={custom(workspace.name)}>{workspace.name}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
  </label>
  <div class="button-row">
    <button class="primary-button" onclick={apply}>Apply workspace</button>
    {#if selectedCustom}
      <button onclick={() => manage('replace')}>Replace with current layout</button>
      <button onclick={() => manage('remove')}>Remove saved workspace</button>
    {/if}
  </div>
  <label>Properties dock
    <select value={layout.sidebarDock ?? 'right'}
      onchange={event => change({ ...layout, sidebarDock: event.currentTarget.value === 'left' ? 'left' : 'right' })}>
      <option value="right">Right of stage</option>
      <option value="left">Left of stage</option>
    </select>
  </label>
  <form onsubmit={event => { event.preventDefault(); manage('save'); }}>
    <label>Workspace name<input maxlength="80" bind:value={name} required /></label>
    <button type="submit">Save current layout</button>
  </form>
  {#if error}<p role="alert">{error}</p>{:else if status}<p role="status">{status}</p>{/if}
{/snippet}
{#if embedded}
  <div class="workspaces embedded">{@render controls()}</div>
{:else}
  <dialog class="dialog workspaces" aria-labelledby="workspaces-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}>
    <button class="dialog-close" aria-label="Close Workspaces" onclick={() => dialog?.close()}>×</button>
    <h2 id="workspaces-title">Workspaces</h2>
    {@render controls()}
  </dialog>
{/if}

<style>
  .workspaces {
    box-sizing: border-box;
    width: min(480px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    overflow: auto;
    color: inherit;
  }
  .workspaces label { display: grid; gap: 5px; margin-bottom: 10px; }
  .workspaces.embedded { width: auto; max-height: none; }
  .workspaces select, .workspaces input { width: 100%; }
  .workspaces::backdrop { background: #1012189c; backdrop-filter: blur(4px); }
  .workspaces form { margin-top: 12px; }
  .workspaces .button-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
</style>
