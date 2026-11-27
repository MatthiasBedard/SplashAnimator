<script lang="ts">
  import { onMount } from 'svelte';
  import { choosePluginFolder, pluginFolder, setPluginFolder } from './desktop-plugins';

  let folder = $state<string | null>(null);
  let busy = $state(false);
  let problem = $state('');

  onMount(() => {
    try { folder = pluginFolder(); }
    catch { problem = 'Could not read the plugin folder preference.'; }
  });

  async function choose() {
    busy = true;
    problem = '';
    try {
      const chosen = await choosePluginFolder();
      if (chosen !== null) {
        setPluginFolder(chosen);
        folder = chosen;
      }
    } catch (error) {
      problem = typeof error === 'string' ? error : 'Could not change the plugin folder.';
    } finally {
      busy = false;
    }
  }

  function reset() {
    problem = '';
    try {
      setPluginFolder(null);
      folder = null;
    } catch {
      problem = 'Could not reset the plugin folder.';
    }
  }
</script>

<dl>
  <dt>Plugin folder</dt>
  <dd>{folder ?? 'plugins beside the executable'}</dd>
</dl>
<div class="actions">
  <button type="button" disabled={busy} onclick={choose}>Choose folder…</button>
  <button type="button" disabled={busy || folder === null} onclick={reset}>Use default</button>
</div>
{#if problem}<p role="alert">{problem}</p>{/if}

<style>
  dl { margin: 0 0 12px; }
  dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
