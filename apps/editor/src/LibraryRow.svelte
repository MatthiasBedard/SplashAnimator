<script lang="ts">
  import type { Snippet } from 'svelte';
  import LibraryIcon from './LibraryIcon.svelte';
  import { wrapDialogTab } from './dialog-focus';
  type Kind = string;
  let {
    name,
    kind,
    link,
    itemKey,
    selected,
    active,
    renaming = false,
    properties = false,
    error = '',
    pick,
    context,
    edit,
    rename,
    commitName,
    cancelRename,
    closeProperties,
    drag,
    children,
  }: {
    name: string;
    kind: Kind;
    link: string;
    itemKey: string;
    selected: boolean;
    active: boolean;
    renaming?: boolean;
    properties?: boolean;
    error?: string;
    pick: (e: MouseEvent) => void;
    context: (e: MouseEvent) => void;
    edit: () => void;
    rename: () => void;
    commitName: (name: string) => void;
    cancelRename: () => void;
    closeProperties: () => void;
    drag: (e: DragEvent) => void;
    children: Snippet;
  } = $props();
  function focusInput(input: HTMLInputElement) {
    input.focus();
    input.select();
  }
  function openDialog(dialog: HTMLDialogElement) {
    dialog.showModal();
    return { destroy: () => dialog.close() };
  }
</script>

{#if renaming}
  <div class="library-record-row">
    <LibraryIcon {kind} /><input
      aria-label={'Rename library item ' + name}
      value={name}
      maxlength="200"
      use:focusInput
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commitName(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
        }
      }}
      onblur={(e) => {
        if (renaming) commitName(e.currentTarget.value);
      }}
    />
  </div>
{:else}
  <button
    type="button"
    role="option"
    aria-selected={selected}
    aria-label={'Library item ' + name}
    class="library-record-row library-item-row"
    class:library-selected={selected}
    data-library-key={itemKey}
    tabindex={active ? 0 : -1}
    draggable="true"
    ondragstart={drag}
    onclick={pick}
    oncontextmenu={context}
    ondblclick={(e) => {
      if (!['graphic','movie','button','symbol'].includes(kind)&&(e.target as HTMLElement).closest('strong')) rename();
      else edit();
    }}
  >
    <span
      role="img"
      aria-label={kind === 'graphic'
        ? 'Graphic symbol'
        : kind === 'movie'
          ? 'Movie clip'
          : kind === 'button'
            ? 'Button'
            : kind === 'bitmap'
              ? 'Bitmap'
              : 'Audio'}><LibraryIcon {kind} /></span
    >
    <strong>{name}</strong><code title="Link name">{link || '—'}</code>
  </button>
{/if}
{#if properties}
  <dialog
    class="library-properties-dialog"
    aria-label={'Library properties ' + name}
    use:openDialog
    oncancel={(e) => {
      e.preventDefault();
      closeProperties();
    }}
    onkeydown={wrapDialogTab}
    onclick={(e) => {
      if ((e.target as HTMLElement).closest('.library-property-actions button')) closeProperties();
    }}
  >
    <div class="library-properties-title">
      <strong>{name} · Properties</strong><button
        aria-label="Close library properties"
        onclick={closeProperties}>×</button
      >
    </div>
    <div class="library-record-properties library-property-actions">{@render children()}</div>
    {#if error}<p>{error}</p>{/if}
  </dialog>
{/if}

<style>
  .library-item-row {
    width: 100%;
    border: 0;
    border-bottom: 1px solid #454a56;
    border-radius: 0;
    text-align: left;
    color: inherit;
    background: transparent;
    user-select: none;
  }
  .library-item-row:hover {
    background: #393e4b;
  }
  .library-item-row.library-selected {
    background: var(--accent-surface);
    color: white;
  }
  .library-item-row:focus-visible {
    outline: 1px solid var(--accent-text);
    outline-offset: -1px;
  }
  .library-record-row input {
    min-width: 0;
    grid-column: 2 / -1;
  }
  .library-properties-dialog {
    color: #eee;
    background: #242832;
    border: 1px solid var(--accent-divider);
    border-radius: 6px;
    width: min(420px, 90vw);
    max-height: 85vh;
    overflow: auto;
  }
  .library-properties-dialog::backdrop {
    background: #0006;
  }
  .library-properties-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
    gap: 20px;
  }
</style>
