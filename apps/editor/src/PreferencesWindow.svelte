<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { showFocusedDialog, wrapDialogTab } from './dialog-focus';

  const categories = ['General', 'Touch', 'Pen & Brush', 'Pencil', 'Workspace', 'Code Editor', 'Keyboard Shortcuts', 'Plugins'] as const;
  let page = $state<(typeof categories)[number]>('General');
  const compact = new MediaQuery('(max-width: 480px)');
  let { general, touch, pen, pencil, workspace, codeEditor, shortcuts, plugins, showPlugins, close }: {
    general: Snippet;
    touch: Snippet;
    pen: Snippet;
    pencil: Snippet;
    workspace: Snippet;
    codeEditor: Snippet;
    shortcuts: Snippet;
    plugins: Snippet;
    showPlugins: boolean;
    close: () => void;
  } = $props();
  const pages = $derived(categories.filter(category => category !== 'Plugins' || showPlugins));
  const content = $derived(({ General: general, Touch: touch, 'Pen & Brush': pen, Pencil: pencil,
    Workspace: workspace, 'Code Editor': codeEditor, 'Keyboard Shortcuts': shortcuts, Plugins: plugins })[page]);

  function categoryKeys(event: KeyboardEvent & { currentTarget: HTMLButtonElement }, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const previous = compact.current ? 'ArrowLeft' : 'ArrowUp';
    const next = compact.current ? 'ArrowRight' : 'ArrowDown';
    const last = pages.length - 1;
    let target: number;
    switch (event.key) {
      case 'Home': target = 0; break;
      case 'End': target = last; break;
      case previous: target = index === 0 ? last : index - 1; break;
      case next: target = index === last ? 0 : index + 1; break;
      default: return;
    }
    event.preventDefault();
    page = pages[target];
    (event.currentTarget.parentElement?.children[target] as HTMLButtonElement | undefined)?.focus();
  }
</script>

<dialog class="dialog preferences" aria-labelledby="preferences-title" use:showFocusedDialog={'[data-preference-page]'}
  onkeydown={wrapDialogTab} oncancel={event => { event.preventDefault(); close(); }}>
  <header>
    <h2 id="preferences-title">Preferences</h2>
    <button type="button" class="close" aria-label="Close Preferences" onclick={close}>×</button>
  </header>
  <div class="body">
    <div class="categories" role="tablist" aria-label="Preference categories"
      aria-orientation={compact.current ? 'horizontal' : 'vertical'}>
      {#each pages as category, index}
        <button type="button" role="tab" id={'preference-tab-' + index} data-preference-page
          aria-selected={page === category} tabindex={page === category ? 0 : -1}
          aria-controls={'preference-panel-' + index} onclick={() => page = category}
          onkeydown={event => categoryKeys(event, index)}>{category}</button>
      {/each}
    </div>
    {#each pages as category, index}
      <div class="preference-page" id={'preference-panel-' + index} role="tabpanel" aria-labelledby={'preference-tab-' + index}
        hidden={page !== category}>
        {#if page === category}
          <h3>{category}</h3>
          {@render content()}
        {/if}
      </div>
    {/each}
  </div>
  <footer>
    <span>Changes apply immediately.</span>
    <button class="primary-button" type="button" onclick={close}>Done</button>
  </footer>
</dialog>

<style>
  .preferences {
    width: min(740px, calc(100vw - 24px));
    height: min(600px, calc(100dvh - 24px));
    max-height: calc(100dvh - 24px);
    padding: 0;
    overflow: hidden;
  }
  .preferences[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
  .preferences::backdrop { background: #1012189c; backdrop-filter: blur(4px); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; }
  header { border-bottom: 1px solid var(--accent-divider); }
  h2 { margin: 0; font-size: 19px; }
  .close { min-width: 34px; min-height: 34px; font-size: 20px; }
  .body { display: grid; grid-template-columns: minmax(150px, 26%) minmax(0, 1fr); min-height: 0; }
  .categories {
    display: flex; flex-direction: column; gap: 4px; padding: 12px 8px;
    background: var(--surface-dark, #202228); border-right: 1px solid var(--accent-divider); overflow: auto;
  }
  .categories button { background: transparent; text-align: left; min-height: 38px; padding: 8px 12px; border: 1px solid transparent; }
  .categories button[aria-selected='true'] { background: var(--accent-surface, #3c4450); border-color: var(--accent-divider); color: var(--accent-text); }
  .preference-page { min-width: 0; padding: 16px 20px; overflow: auto; }
  h3 { font-size: 15px; font-weight: 650; margin: 0 0 14px; }
  .preference-page :global(.preference-fields) { display: grid; gap: 4px; margin: 0; padding: 0; border: 0; min-width: 0; }
  .preference-page :global(.preference-fields label) { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 36px; }
  .preference-page :global(.preference-fields input[type='number']) { width: 80px; }
  .preference-page :global(.preference-fields p) { margin: 4px 0 12px; }
  footer { border-top: 1px solid var(--accent-divider); }
  footer span { color: #c5c9d5; }
  footer button { min-height: 36px; padding-inline: 18px; }
  @media (max-width: 480px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .categories { flex-direction: row; border-right: 0; border-bottom: 1px solid var(--accent-divider); padding: 6px; }
    .categories button { white-space: nowrap; }
    .preference-page { padding: 12px; }
  }
</style>
