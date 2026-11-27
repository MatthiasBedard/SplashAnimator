<script lang="ts">
  import Workspace from './ScriptWorkspace.svelte';
  import { frameScriptPath, type ScriptWorkspace, type FileOperation, type FrameScriptFile } from './script-workspace';
  import ScriptCheck from './ScriptCheck.svelte';
  let {
    workspace = $bindable(),
    operate,
    frameFiles,
    timelineName = 'main',
    source = $bindable(''),
    frameNumber,
    savedSource,
    selection,
    location,
    popOut,
    popOutAlwaysOnTop,
    browserPopup = false,
    alwaysOnTop = false,
    error = '',
    move,
    close,
    apply,
    remove,
  }: {
    workspace: ScriptWorkspace;
    operate: FileOperation;
    frameFiles: FrameScriptFile[];
    timelineName?: string;
    source: string;
    frameNumber?: number;
    savedSource?: string;
    selection?: { source: string; line: number; column: number };
    location: 'canvas' | 'timeline' | 'floating';
    popOut?: () => void;
    popOutAlwaysOnTop?: () => void;
    browserPopup?: boolean;
    alwaysOnTop?: boolean;
    error?: string;
    move: (location: 'canvas' | 'timeline' | 'floating') => void;
    close: () => void;
    apply?: (text: string) => void | Promise<void>;
    remove?: () => void | Promise<void>;
  } = $props();
  let primaryEditor = $state.raw<ReturnType<typeof ScriptCheck>>();
  let editorWorkspace = $state.raw<ReturnType<typeof Workspace>>();
  export function flush() { return editorWorkspace?.flush() ?? true; }
  export function isComposing() { return editorWorkspace?.isComposing() ?? false; }
  export function compositionBlocksSwitch(notice?: string) { return editorWorkspace?.compositionBlocksSwitch(notice) ?? false; }
  let blockedTarget = $state<string>(), closing = $state(false);
  const target = $derived(workspace.active || String(frameNumber ?? ''));
  async function closeAfterSave() {
    if (closing) return;
    closing = true;
    const ownedTarget = target;
    try {
      const saved = await flush();
      if (target !== ownedTarget) return;
      if (saved) close();
      else blockedTarget = ownedTarget;
    } finally { closing = false; }
  }
  function discardAndClose() {
    editorWorkspace?.discardFrameDraft();
    close();
  }
  const activeFrame = $derived(frameFiles.find(({ path }) => path === workspace.active));
  const activeTitle = $derived(activeFrame?.symbolName
    ? activeFrame.symbolName + ' · ' + workspace.active.split('/').at(-1)
    : workspace.active);
</script>

<div
  class="script-panel"
  role="dialog"
  aria-label={frameNumber === undefined ? 'Check frame TypeScript' : 'Edit frame source'}
  data-script-panel
  onkeydowncapture={(event) => editorWorkspace?.saveShortcut(event)}
>
  <header>
    <h2 title={activeTitle || undefined}>
      {activeTitle ||
        (frameNumber === undefined
          ? 'TypeScript scratchpad'
          : 'TypeScript for ' + timelineName + ' frame ' + frameNumber)}
    </h2>
    <select
      aria-label="Script editor location"
      value={location}
      onchange={(e) => {
        const where = e.currentTarget.value as typeof location;
        e.currentTarget.value = location;
        move(where);
      }}
    >
      <option value="canvas">Canvas dock</option><option value="timeline">Timeline dock</option
      ><option value="floating">{alwaysOnTop ? 'Always-on-top window' : browserPopup ? 'Pop-out window' : 'Floating window'}</option>
    </select>
    {#if popOut}<button type="button" title="Open Script Editor in a separate browser window" onclick={popOut}>Pop Out</button>{/if}
    {#if popOutAlwaysOnTop}<button type="button" title="Pop out without a browser address bar" onclick={popOutAlwaysOnTop}>Always on Top</button>{/if}
    <button aria-label="Close dialog" title="Close script editor" disabled={closing} onclick={closeAfterSave}>×</button>
  </header>
  {#if error}<p class="window-error" role="alert">{error}</p>{/if}
  {#if blockedTarget === target}
    <div class="close-error">
      <p role="alert">Frame changes still need to be saved. Retry closing or discard this draft.</p>
      <button type="button" disabled={closing} onclick={discardAndClose}>Discard frame draft and close</button>
    </div>
  {/if}
  <Workspace
    bind:workspace
    bind:this={editorWorkspace}
    flushPrimary={() => primaryEditor?.flush() ?? true}
    primaryComposing={() => primaryEditor?.isComposing() ?? false}
    discardPrimary={() => primaryEditor?.discardDraft()}
    {operate}
    {frameFiles}
    primary={frameNumber === undefined ? 'Scratchpad' : frameScriptPath(frameNumber - 1)}
  >
    <div class="script-panel-body">
      <ScriptCheck panel bind:this={primaryEditor} bind:source {frameNumber} {savedSource} {selection} {apply} persist={apply} {remove} />
    </div>
  </Workspace>
</div>

<style>
  .script-panel {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--script-panel-background, #252830);
    color: var(--script-panel-text, #e3e8ef);
  }
  .close-error { padding: 4px 8px; }
  .close-error p { margin: 0 0 4px; }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    border-bottom: 1px solid var(--script-panel-border, #424750);
    padding: 3px 8px;
  }
  header h2 {
    font-size: 13px;
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header select {
    width: auto;
    max-width: 52%;
  }
  header button[aria-label='Close dialog'] {
    font-size: 17px;
  }
  .window-error {
    margin: 0;
    padding: 5px 8px;
    color: var(--script-warning-text, #f2c88b);
    overflow-wrap: anywhere;
  }
  .script-panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 4px 10px;
    gap: 4px;
  }
  .script-panel-body :global(.code-editor) {
    flex: 1 0 55px;
    min-height: 55px;
    height: auto;
    margin: 0;
  }
  .script-panel-body :global(.actions) {
    margin: 0;
    flex-wrap: wrap;
  }
  .script-panel-body :global(p),
  .script-panel-body :global(ul) {
    margin: 0;
  }
  .script-panel-body :global(p:empty),
  .script-panel-body :global(ul:empty) {
    display: none;
  }
</style>
