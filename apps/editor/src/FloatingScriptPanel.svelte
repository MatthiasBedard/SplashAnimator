<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import ScriptPanel from './ScriptPanel.svelte';
  import { emptyWorkspace, type FileOperation, type FrameScriptFile } from './script-workspace';
  let workspace = $state(emptyWorkspace());
  const fileCalls = new SvelteMap<
    number,
    { resolve: (value: string[] | string | null) => void; reject: (error: Error) => void }
  >();
  const operate: FileOperation = (command) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      fileCalls.set(id, { resolve, reject });
      channel.postMessage({ type: 'file', id, command });
    });
  let { session }: { session: string } = $props();
  let ready = $state(false),
    browserPopup = $state(false),
    alwaysOnTop = $state(false),
    source = $state(''),
    savedSource = $state<string>(),
    frameFiles = $state.raw<FrameScriptFile[]>([]),
    timelineName = $state<string>(),
    frameNumber = $state<number>(),
    selection = $state<{ source: string; line: number; column: number }>();
  const channel = new BroadcastChannel('splash-script-' + untrack(() => session));
  let sequence = 0;
  const pending = new SvelteMap<number, { resolve: () => void; reject: (e: Error) => void; text: string | null }>();
  function commit(text: string | null) {
    return new Promise<void>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject, text });
      channel.postMessage({ type: 'commit', id, text, source });
    });
  }
  let panel = $state.raw<ReturnType<typeof ScriptPanel>>();
  let transferring = $state(false), returnPending = $state(false);
  async function dock(where: 'canvas' | 'timeline' | 'floating') {
    if (where === 'floating' || transferring || returnPending) return;
    transferring = true;
    try {
      const saved = await panel?.flush();
      if (ready && !returnPending && saved !== false)
        channel.postMessage({ type: 'dock', where, source, workspace: $state.snapshot(workspace) });
    } finally { transferring = false; }
  }
  function returnDraft() {
    if (!ready) return;
    void panel?.flush();
    sendFinalDraft();
  }
  function sendFinalDraft() {
    channel.postMessage({ type: 'closed', source, workspace: $state.snapshot(workspace) });
  }
  $effect(() => {
    if (ready)
      channel.postMessage({
        type: 'draft',
        source,
        workspace: $state.snapshot(workspace),
      });
  });
  onMount(() => {
    channel.onmessage = ({ data }) => {
      if (data.type === 'init' && !ready) {
        workspace = data.workspace;
        frameFiles = data.frameFiles;
        timelineName = data.timelineName;
        source = data.source;
        savedSource = data.savedSource;
        frameNumber = data.frameNumber;
        selection = data.selection;
        browserPopup = data.kind === 'popup';
        alwaysOnTop = data.kind === 'picture-in-picture';
        ready = true;
      }
      if (data.type === 'return') {
        returnPending = true;
        panel?.compositionBlocksSwitch('Finish entering text to return to the workspace.');
      }
      if (data.type === 'frameFiles' && ready) frameFiles = data.frameFiles;
      if (data.type === 'fileResult') {
        const call = fileCalls.get(data.id);
        fileCalls.delete(data.id);
        if (data.error) call?.reject(Error(data.error));
        else call?.resolve(data.value);
      }
      if (data.type === 'result') {
        const call = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) call?.reject(Error(data.error));
        else if (call) { savedSource = call.text ?? ''; call.resolve(); }
      }
      if (data.type === 'shutdown') {
        ready = false;
        if (window === window.top) window.close();
      }
    };
    channel.postMessage({ type: 'ready' });
    window.addEventListener('pagehide', returnDraft);
    return () => {
      window.removeEventListener('pagehide', returnDraft);
      channel.close();
    };
  });
  $effect(() => {
    if (!ready || !returnPending || transferring || !panel || panel.isComposing()) return;
    const editor = panel;
    void untrack(() => returnAfterFrameSave(editor));
  });
  async function returnAfterFrameSave(editor: NonNullable<typeof panel>) {
    transferring = true;
    try {
      // Keep the draft on return even if the original frame can no longer be saved.
      await editor.flush();
      if (!ready || panel !== editor || editor.isComposing()) return;
      returnPending = false;
      sendFinalDraft();
    } finally { transferring = false; }
  }
</script>

{#if ready}<ScriptPanel
    bind:this={panel}
    bind:workspace
    {operate}
    {frameFiles}
    {timelineName}
    bind:source
    {frameNumber}
    {savedSource}
    {selection}
    {browserPopup}
    {alwaysOnTop}
    location="floating"
    move={dock}
    close={sendFinalDraft}
    apply={frameNumber === undefined ? undefined : commit}
    remove={frameNumber === undefined ? undefined : () => commit(null)}
  />{/if}

<style>
  :global(html),
  :global(body),
  :global(#app) {
    height: 100%;
    margin: 0;
  }
</style>
