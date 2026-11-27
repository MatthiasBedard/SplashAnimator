<script lang="ts">
  import { onMount } from 'svelte';
  import { observeCodeEditorPreferences, updateCodeEditorPreferences, type CodeEditorPreferences } from './code-editor-preferences';

  let preferences = $state<CodeEditorPreferences>();
  onMount(() => observeCodeEditorPreferences(value => preferences = value));
</script>

{#if preferences}
  <div class="preference-fields">
    <label>Indent using
      <select value={preferences.indentation}
        onchange={event => updateCodeEditorPreferences({ indentation: event.currentTarget.value === 'tabs' ? 'tabs' : 'spaces' })}>
        <option value="spaces">Spaces</option>
        <option value="tabs">Tabs</option>
      </select>
    </label>
    <label>Indent size
      <select value={preferences.indentSize}
        onchange={event => updateCodeEditorPreferences({ indentSize: Number(event.currentTarget.value) })}>
        {#each Array.from({ length: 16 }, (_, index) => index + 1) as size}
          <option value={size}>{size}</option>
        {/each}
      </select>
    </label>
    <label>Detect indentation from source
      <input type="checkbox" checked={preferences.detectIndentation}
        onchange={event => updateCodeEditorPreferences({ detectIndentation: event.currentTarget.checked })} />
    </label>
    <p class="hint">When detection is enabled, the editor uses these settings if it can’t infer the file’s indentation.</p>
    <label>Font size (px)
      <input type="number" min="10" max="32" step="1" value={preferences.fontSize} onchange={event => {
        const input = event.currentTarget;
        if (input.validity.valid && Number.isInteger(input.valueAsNumber)) {
          updateCodeEditorPreferences({ fontSize: input.valueAsNumber });
        } else {
          input.value = String(preferences?.fontSize ?? 13);
        }
      }} />
    </label>
    <label>Wrap long lines
      <input type="checkbox" checked={preferences.wordWrap}
        onchange={event => updateCodeEditorPreferences({ wordWrap: event.currentTarget.checked })} />
    </label>
    <label>Show line numbers
      <input type="checkbox" checked={preferences.lineNumbers}
        onchange={event => updateCodeEditorPreferences({ lineNumbers: event.currentTarget.checked })} />
    </label>
  </div>
{/if}
