<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { focusDialogFooter, showFocusedDialog, wrapDialogTab } from './dialog-focus';
  let {
    save = false,
    finalizing = false,
    assets,
    automatic,
    summary,
    working,
    message,
    failure,
    start,
    cancel,
    close,
  }: {
    save?: boolean;
    finalizing?: boolean;
    assets: { path: string; name: string }[];
    automatic: boolean;
    summary: string;
    working: boolean;
    message: string;
    failure: string;
    start: (files: Map<string, File>, audio: boolean, validate: () => void) => Promise<void>;
    cancel: () => void;
    close: () => void;
  } = $props();
  let audio = $state(false),
    files = $state<Record<string, File>>({});
  let revision = 0;
  let dialog: HTMLDialogElement;
  const release = untrack(() => close);
  onDestroy(() => release());
  const ready = $derived(
    !audio || (assets.length > 0 && assets.every((a) => automatic || files[a.path])),
  );
  async function run() {
    const originalRevision = revision,
      includeAudio = audio;
    const selected = new Map(Object.entries(files));
    const job = start(selected, includeAudio, () => {
      if (revision !== originalRevision || audio !== includeAudio)
        throw Error('FFmpeg bundle controls changed. Output was not published.');
    });
    void focusDialogFooter(dialog);
    try { await job; }
    finally { await focusDialogFooter(dialog); }
  }
</script>

  <dialog
    bind:this={dialog}
    use:showFocusedDialog
    class="panel"
    aria-label={`${save ? 'Save' : 'Export'} FFmpeg input bundle`}
    onkeydown={wrapDialogTab}
    oncancel={(event) => { event.preventDefault(); close(); }}
  >
    <header>
      <h2>{save ? 'Save' : 'Export'} FFmpeg input bundle</h2>
      <button aria-label="Close FFmpeg bundle" onclick={close}>Close</button>
    </header>
    <p>{summary}</p>
    <p>
      ZIP of PNG frames and a data-only FFmpeg job manifest. Extract to an empty folder and use your
      own FFmpeg installation. No video is encoded by this command.
    </p>
    <label
      ><input
        aria-label="Include project audio in FFmpeg bundle"
        type="checkbox"
        checked={audio}
        disabled={working || !assets.length}
        onchange={(e) => {
          revision++;
          audio = e.currentTarget.checked;
        }}
      />Include mixed 48 kHz PCM WAV</label
    >
    {#if audio}<p>
        {automatic
          ? 'Saved WAVs will load; optional files override them for this bundle.'
          : 'Choose every referenced WAV. Files stay separate from project artwork and are validated against saved metadata.'}
      </p>
      {#each assets as asset}<label
          >{asset.name}<small>{asset.path}</small><input
            type="file"
            accept=".wav,audio/wav"
            aria-label={'FFmpeg WAV for ' + asset.path}
            disabled={working}
            onchange={(e) => {
              revision++;
              const file = e.currentTarget.files?.[0];
              if (file) files[asset.path] = file;
              else delete files[asset.path];
            }}
          /></label
        >{/each}{/if}
    {#if failure}<p role="alert">{failure}</p>{/if}
    <p role="status">{message}</p>
    <footer>
      {#if finalizing}<span>Finishing file. Saving continues if you close this dialog.</span
        >{:else if working}<button onclick={cancel}>Cancel FFmpeg bundle</button>{:else}<button
          disabled={!ready}
          onclick={run}>{save ? 'Save' : 'Export'} FFmpeg input ZIP</button
        >{/if}
    </footer>
  </dialog>

<style>
  .panel::backdrop {
    background: #0009;
  }
  .panel {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    background: #25272d;
    color: #eee;
    border: 1px solid #60636d;
    border-radius: 8px;
    padding: 20px;
    width: min(642px, calc(100vw - 32px));
    max-height: 85vh;
    overflow: auto;
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
  }
  h2 {
    font-size: 18px;
    margin: 0;
  }
  p,
  label {
    font-size: 13px;
    line-height: 1.5;
  }
  label {
    display: block;
    margin: 14px 0;
  }
  small {
    display: block;
    color: #b9bdc8;
    margin: 4px 0;
  }
  input[type='file'] {
    display: block;
    max-width: 100%;
  }
  button {
    background: #393c46;
    color: #fff;
    border: 1px solid #777c8b;
    border-radius: 4px;
    padding: 7px 12px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  [role='alert'] {
    color: #ffb8aa;
  }
</style>
