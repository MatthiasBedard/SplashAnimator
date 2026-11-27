<script lang="ts">
  import { onMount } from 'svelte';
  import { focusDialogFooter, showFocusedDialog, wrapDialogTab } from './dialog-focus';

  import { discoverPlugins, enabledPlugins, setPluginEnabled, type PluginCatalog } from './desktop-plugins';

  let { onclose }: { onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let catalog = $state<PluginCatalog>();
  let busy = $state(false);
  let enabled = $state<string[]>([]);
  let settingsProblem = $state('');
  let problem = $state('');

  async function refresh() {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      const discovered = await discoverPlugins();
      enabled = enabledPlugins(discovered.folder);
      catalog = discovered;
    } catch (error) {
      catalog = undefined;
      problem = typeof error === 'string' ? error : 'Could not scan the plugin folders.';
    } finally {
      busy = false;
      void focusDialogFooter(dialog);
    }
  }

  function toggle(event: Event & { currentTarget: HTMLInputElement }, id: string) {
    if (!catalog) return;
    settingsProblem = '';
    try { enabled = setPluginEnabled(catalog.folder, id, event.currentTarget.checked); }
    catch {
      event.currentTarget.checked = enabled.includes(id);
      settingsProblem = 'Could not save the plugin setting.';
    }
  }

  onMount(() => {
    void refresh();
    const focus = showFocusedDialog(dialog);
    return focus.destroy;
  });
</script>

<dialog class="dialog" aria-labelledby="plugins-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}>
  <header>
    <h2 id="plugins-title">Plugins</h2>
    <button class="dialog-close" aria-label="Close Plugins" onclick={() => dialog.close()}>×</button>
  </header>
  <p role="status">
    {#if busy}Scanning plugin folders…
    {:else if problem}{problem}
    {:else if catalog?.plugins.length}Found {catalog.plugins.length} {catalog.plugins.length === 1 ? 'package' : 'packages'}. Plugin execution is unavailable in this build.
    {:else}No plugin packages found.
    {/if}
  </p>
  {#if settingsProblem}<p role="alert">{settingsProblem}</p>{/if}
  {#if catalog}
    {#if catalog.plugins.length}
      <ul class="packages" aria-label="Discovered packages">
        {#each catalog.plugins as plugin (plugin.id)}
          <li>
            <label>
              <input type="checkbox" checked={enabled.includes(plugin.id)} disabled={busy}
                onchange={event => toggle(event, plugin.id)} aria-label={`Enable ${plugin.name}`} />
              <strong>{plugin.name}</strong> <span>{plugin.version}</span>
            </label>
            <code>{plugin.id}</code>
            {#if plugin.description}<p>{plugin.description}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <h3>Plugin folder</h3>
    <p><code>{catalog.folder}</code></p>
    {#if catalog.issues.length}
      <details>
        <summary>Scan issues ({catalog.issues.length})</summary>
        <ul>{#each catalog.issues as issue}<li>{issue}</li>{/each}</ul>
      </details>
    {/if}
  {/if}
  <footer><button disabled={busy} onclick={refresh}>Scan again</button></footer>
</dialog>

<style>
  dialog.dialog {
    position: fixed;
    box-sizing: border-box;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
    overflow-wrap: anywhere;
    color: inherit;
  }
  dialog::backdrop { background: #11151cbf; backdrop-filter: blur(4px); }
  h3 { margin-bottom: 6px; font-size: inherit; }
  ul { margin: 0 0 12px; padding-inline-start: 22px; }
  .packages { padding: 0; list-style: none; }
  .packages li { padding: 10px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 6px; }
  .packages code { display: block; margin-top: 4px; }
  .packages p { margin: 4px 0 0; }
  summary { cursor: pointer; }
  footer { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
