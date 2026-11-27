<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { wrapDialogTab } from './dialog-focus';

  let {
    kind, name = $bindable(), folders, desktop, copy, busy, error, save, open, close,
  }: {
    kind: 'open' | 'save';
    name: string;
    folders: string[];
    desktop: boolean;
    copy: boolean;
    busy: boolean;
    error: string;
    save: () => Promise<void>;
    open: (folder: string) => Promise<unknown>;
    close: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let nameInput = $state<HTMLInputElement>();
  let progress = $state<HTMLElement>();

  onMount(() => {
    const element = dialog;
    element.showModal();
    const initial = kind === 'save' ? nameInput : element.querySelector<HTMLButtonElement>('.project-list button');
    initial?.focus();
    return () => { if (element.open) element.close(); };
  });

  async function run(action: () => Promise<unknown>) {
    const element = dialog;
    const origin = document.activeElement;
    const pending = action();
    await tick();
    if (busy && element.open && element.isConnected) progress?.focus({ preventScroll: true });
    await pending;
    await tick();
    if (element.open && element.isConnected && origin instanceof HTMLElement &&
        element.contains(origin) && !origin.matches(':disabled')) origin.focus();
  }

</script>

<dialog
  bind:this={dialog}
  class="dialog file-dialog"
  aria-label={kind === 'save' ? 'Save project' : 'Open project'}
  onkeydown={wrapDialogTab}
  oncancel={(event) => { event.preventDefault(); if (!busy) close(); }}
>
  <button type="button" class="dialog-close" aria-label="Close dialog" disabled={busy} onclick={close}>×</button>
  {#if kind === 'save'}
    <span class="eyebrow">PROJECT DIRECTORY</span>
    <h2>{copy ? 'Save a new copy' : 'Give your project a home'}</h2>
    <p>All editable vectors and project data stay together in a real <strong>.spl folder</strong>.</p>
    <form onsubmit={(event) => { event.preventDefault(); void run(save); }}>
      <label>Project name<input class="name-input" bind:this={nameInput} bind:value={name} disabled={busy} /></label>
      <p class="hint">
        {desktop ? 'Choose a parent folder in the next dialog.' : 'Stored in the local development projects directory.'}
        Existing folders are never overwritten.
      </p>
      <button type="submit" class="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save project folder'}</button>
    </form>
  {:else}
    <span class="eyebrow">LOCAL PROJECTS</span>
    <h2>Open a project</h2>
    {#if !folders.length}<p>No saved .spl folders yet. Save a project to get started.</p>{/if}
    <div class="project-list">
      {#each folders as folder}
        <button type="button" disabled={busy} onclick={() => void run(() => open(folder))}>
          ▣ <span>{folder}</span><span>→</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if busy}
    <p role="status" tabindex="-1" bind:this={progress}>{kind === 'save' ? 'Saving project…' : 'Opening project…'}</p>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</dialog>

<style>
  dialog.file-dialog {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    color: inherit;
  }
  dialog::backdrop {
    background: #11151cbf;
    backdrop-filter: blur(4px);
  }
</style>
