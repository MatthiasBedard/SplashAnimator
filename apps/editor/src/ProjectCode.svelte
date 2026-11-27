<script lang="ts">
  import { onMount } from 'svelte';
  import type { ScriptTab } from './script-workspace';
  import { applyCodeEditorPreferences } from './code-editor-preferences';
  import { followMonacoTheme, monacoTheme } from './monaco-theme';
  let { tab, readOnly = false }: { tab: ScriptTab; readOnly?: boolean } = $props();
  let host: HTMLDivElement;
  let status = $state<'loading' | 'ready' | 'failed' | 'retrying'>('loading');
  let retry = $state<HTMLButtonElement>();
  let mountEditor: (() => Promise<void>) | undefined;
  onMount(() => {
    let alive = true;
    const disposers: (() => void)[] = [];
    const dispose = () => {
      while (disposers.length) disposers.pop()!();
    };
    mountEditor = async () => {
      const restoreFocus = host.ownerDocument.activeElement === retry;
      if (status === 'failed') status = 'retrying';
      try {
        const monaco = await import('monaco-editor/editor/editor.api');
        await Promise.all([
          import('monaco-editor/languages/definitions/typescript/register'),
          import('monaco-editor/features/find/register'),
        ]);
        if (!alive) return;
        const model = monaco.editor.createModel(
          tab.text,
          readOnly ? 'json' : 'typescript',
          monaco.Uri.from({
            scheme: 'inmemory',
            authority: crypto.randomUUID(),
            path: '/' + tab.path,
          }),
        );
        disposers.push(() => model.dispose());
        const editor = monaco.editor.create(host, {
          model,
          automaticLayout: true,
          theme: monacoTheme(),
          ariaLabel: tab.path,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          editContext: false,
          readOnly,
          domReadOnly: readOnly,
        });
        disposers.push(() => editor.dispose());
        disposers.push(followMonacoTheme(monaco.editor.setTheme));
        disposers.push(applyCodeEditorPreferences(editor, model));
        const change = model.onDidChangeContent(() => {
          tab.text = model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true);
        });
        disposers.push(() => change.dispose());
        status = 'ready';
        if (restoreFocus && host.ownerDocument.activeElement === retry) editor.focus();
      } catch {
        dispose();
        if (alive) status = 'failed';
      }
    };
    void mountEditor();
    return () => {
      alive = false;
      mountEditor = undefined;
      dispose();
    };
  });
</script>

<div class="editor" bind:this={host}></div>
{#if status !== 'ready'}
  <div class="loading">
    <p role="status">{status === 'failed' ? 'Monaco could not load. Your file is still open.' : 'Loading Monaco…'}</p>
    {#if status === 'retrying' || status === 'failed'}
      <button type="button" bind:this={retry} aria-disabled={status === 'retrying'}
        onclick={() => { if (status === 'failed') void mountEditor?.(); }}>Retry code editor</button>
    {/if}
  </div>
{/if}

<style>
  .editor {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .loading {
    position: absolute;
    inset: 0;
    margin: 8px;
  }
  p { margin: 0 0 8px; }
</style>
