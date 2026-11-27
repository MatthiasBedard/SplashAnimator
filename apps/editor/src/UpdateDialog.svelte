<script lang="ts">
  import { onMount } from 'svelte';
  import { showFocusedDialog, wrapDialogTab } from './dialog-focus';
  import {
    checkDesktopUpdate, desktopUpdate, downloadDesktopUpdate, installDesktopUpdate, updateError,
    type DownloadProgress,
  } from './desktop-update';

  let { onclose, getBlock }: { onclose: () => void; getBlock: () => string | undefined } = $props();
  const blocked = $derived(getBlock());
  let dialog: HTMLDialogElement;
  let phase = $state<'downloading' | 'installing'>();
  let progress = $state<DownloadProgress>();
  let problem = $state('');
  onMount(() => {
    void checkDesktopUpdate();
    const focus = showFocusedDialog(dialog);
    return focus.destroy;
  });

  async function update() {
    const ticket = $desktopUpdate.release?.ticket;
    if (!ticket || phase || getBlock() || $desktopUpdate.checking) return;
    phase = 'downloading';
    progress = undefined;
    problem = '';
    try {
      await downloadDesktopUpdate(ticket, value => { progress = value; });
      const block = getBlock();
      if (block || $desktopUpdate.release?.ticket !== ticket || $desktopUpdate.checking) {
        problem = block ?? 'Check for updates again before installing.';
        return;
      }
      phase = 'installing';
      await installDesktopUpdate(ticket);
    } catch (cause) {
      problem = updateError(cause);
    } finally {
      phase = undefined;
    }
  }
</script>

<dialog class="dialog" aria-labelledby="update-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}
  oncancel={event => { if (phase) event.preventDefault(); }}>
  <header>
    <h2 id="update-title">Splash Animator Update</h2>
    <button class="dialog-close" aria-label="Close Update" disabled={!!phase} onclick={() => dialog.close()}>×</button>
  </header>
  <dl>
    <div><dt>Installed version</dt><dd data-testid="installed-version">{$desktopUpdate.installed}</dd></div>
    <div><dt>Latest version</dt><dd data-testid="latest-version">{$desktopUpdate.release?.latest ?? '—'}</dd></div>
  </dl>
  <div class="status" role="status">
    {#if phase === 'downloading'}
      <label for="update-progress">Downloading and verifying the update…</label>
      <progress id="update-progress" max={progress?.total ?? 1} value={progress?.total ? progress.received : undefined}></progress>
    {:else if phase === 'installing'}
      Installing the update. Splash Animator will close.
    {:else if $desktopUpdate.checking}
      Checking for updates…
    {:else if problem || $desktopUpdate.error}
      {problem || $desktopUpdate.error}
    {:else if $desktopUpdate.release?.unavailable}
      {$desktopUpdate.release.unavailable}
    {:else if $desktopUpdate.release?.ticket}
      {blocked ?? 'An update is available. Splash Animator will close to install it.'}
    {:else}
      No newer release is available.
    {/if}
  </div>
  <footer>
    <button disabled={!!phase || $desktopUpdate.checking} onclick={() => { problem = ''; void checkDesktopUpdate(); }}>
      Check again
    </button>
    {#if $desktopUpdate.release?.ticket}
      <button class="install" disabled={!!phase || !!blocked || $desktopUpdate.checking} onclick={update}>Download and install</button>
    {/if}
  </footer>
</dialog>

<style>
  dialog.dialog {
    position: fixed;
    box-sizing: border-box;
    width: min(480px, calc(100vw - 32px));
    color: inherit;
  }
  dialog::backdrop { background: #11151cbf; backdrop-filter: blur(4px); }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  dl > div { padding: 12px; border: 1px solid var(--line); border-radius: 6px; }
  dt { opacity: .75; }
  dd { margin: 6px 0 0; font-weight: 700; font-size: 18px; overflow-wrap: anywhere; }
  .status { min-height: 2.5em; }
  progress { display: block; width: 100%; margin-top: 8px; accent-color: var(--accent); }
  footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .install { border-color: var(--accent); }
</style>
