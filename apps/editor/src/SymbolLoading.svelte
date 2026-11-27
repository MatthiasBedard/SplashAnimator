<script lang="ts">
  import { showFocusedDialog, wrapDialogTab } from './dialog-focus';
  let { cancel, failed = false }: { cancel: () => void; failed?: boolean } = $props();

</script>

<dialog
  use:showFocusedDialog={'button'}
  onkeydown={wrapDialogTab}
  aria-label="Loading symbol tools"
  oncancel={(event) => {
    event.preventDefault();
    cancel();
  }}
>
  {#if failed}
    <p role="alert">
      Could not load symbol tools. Close this dialog, save your work, then reload and try again.
    </p>
  {:else}
    <p role="status">Loading symbol tools…</p>
  {/if}
  <button onclick={cancel}>Cancel symbol loading</button>
</dialog>

<style>
  dialog {
    max-width: min(420px, 90vw);
    background: var(--surface-dark);
    color: var(--surface-text);
    border: 1px solid #777;
    border-radius: 8px;
    padding: 20px;
  }
  dialog::backdrop {
    background: #0009;
  }
  button {
    padding: 8px;
  }
</style>
