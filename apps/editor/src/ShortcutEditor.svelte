<script lang="ts">
  import { onMount } from 'svelte';
  import { wrapDialogTab } from './dialog-focus';
  import { bindingFromKey, changeShortcut, EDITOR_SHORTCUTS, exportShortcuts,
    importShortcuts, shortcutDisplay, type ShortcutAction, type ShortcutOverrides } from './editor-shortcuts';
  let { bindings, mac, change, onclose, embedded = false }: {
    bindings: ShortcutOverrides;
    mac: boolean;
    change: (value: ShortcutOverrides) => void;
    onclose?: () => void;
    embedded?: boolean;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let actionPicker: HTMLSelectElement;
  let recordButton: HTMLButtonElement;
  let importFile: HTMLInputElement;
  let action = $state<ShortcutAction>('open');
  let recording = $state(false);
  let importing = $state(false);
  let error = $state('');
  let status = $state('');
  let binding = $derived(shortcutDisplay(bindings, action, mac));
  let mounted = false;
  onMount(() => {
    mounted = true;
    if (!embedded) { dialog?.showModal(); actionPicker.focus(); }
    return () => { mounted = false; };
  });

  function update(value: ShortcutOverrides, message: string) {
    try {
      change(value);
      error = '';
      status = message;
      return true;
    } catch (cause) {
      status = '';
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function assign(value: string | null) {
    error = status = '';
    try {
      return update(changeShortcut(bindings, action, value), value ? 'Shortcut saved.' : 'Shortcut removed.');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function capture(event: KeyboardEvent) {
    if (!recording || event.isComposing || event.repeat) return;
    if (event.key === 'Tab') {
      recording = false;
      return;
    }
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    recording = false;
    if (event.key === 'Escape') return;
    const result = bindingFromKey(event);
    if (result) assign(result);
    else { status = ''; error = 'That key is reserved or cannot be assigned.'; }
  }

  async function importFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || importing) return;
    importing = true;
    error = status = '';
    try {
      if (file.size > 64 * 1024) throw Error('Shortcut file is too large.');
      const text = await file.text();
      if (mounted && (embedded || dialog?.open)) update(importShortcuts(text), 'Shortcuts imported.');
    } catch (cause) {
      if (mounted && (embedded || dialog?.open)) error = cause instanceof Error ? cause.message : String(cause);
    } finally { importing = false; }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([exportShortcuts(bindings)], { type: 'application/json' }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'splash-shortcuts.json';
      link.click();
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
</script>

{#snippet controls()}
  <label>Command
    <select bind:this={actionPicker} bind:value={action} disabled={importing}
      onchange={() => { recording = false; error = status = ''; }}>
      {#each EDITOR_SHORTCUTS as item (item.id)}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
  </label>
  <p>Current shortcut <kbd>{binding || 'Unassigned'}</kbd></p>
  <div class="shortcut-actions">
    <button type="button" bind:this={recordButton} disabled={importing} onclick={() => { recording = !recording; error = status = ''; }}
      onkeydown={capture} onblur={() => recording = false}>{recording ? 'Press a shortcut…' : 'Change shortcut'}</button>
    <button type="button" disabled={!binding || importing} onclick={() => {
      if (assign(null)) recordButton.focus({ preventScroll: true });
    }}>Clear shortcut</button>
  </div>
  <p>Copy, Cut, Paste and drawing gesture keys are fixed. Escape cancels recording.</p>
  <div class="shortcut-actions">
    <input type="file" aria-label="Shortcut mapping file" accept=".json,application/json" hidden
      bind:this={importFile} onchange={importFileChange} />
    <button type="button" aria-disabled={importing} onclick={() => { if (!importing) importFile.click(); }}>Import shortcuts…</button>
    <button type="button" onclick={download}>Export shortcuts</button>
    <button type="button" disabled={importing} onclick={() => update({}, 'Default shortcuts restored.')}>Reset defaults</button>
  </div>
  {#if error}<p role="alert">{error}</p>{:else if importing || status}<p role="status">{importing ? 'Importing shortcuts…' : status}</p>{/if}
{/snippet}

{#if embedded}
  {@render controls()}
{:else}
  <dialog class="dialog shortcut-editor" aria-labelledby="shortcut-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}>
    <button class="dialog-close" aria-label="Close Keyboard Shortcuts" onclick={() => dialog?.close()}>×</button>
    <h2 id="shortcut-title">Keyboard Shortcuts</h2>
    {@render controls()}
  </dialog>
{/if}

<style>
  .shortcut-editor { box-sizing: border-box; width: min(510px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; color: inherit; }
  .shortcut-editor::backdrop { background: #1012189c; backdrop-filter: blur(4px); }
  label { display: grid; gap: 6px; }
  .shortcut-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button[aria-disabled="true"] { opacity: .45; cursor: default; }
  kbd { margin-left: 6px; }
</style>
