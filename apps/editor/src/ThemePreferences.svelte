<script lang="ts">
  import { onMount } from 'svelte';
  import { chooseThemesFolder, listThemes, setDesktopTheme, themePreference } from './desktop-themes';
  import { desktop } from './storage';
  import { setWebTheme, webThemePreference, webThemes } from './web-themes';

  const saved = desktop ? themePreference() : { folder: null, name: webThemePreference() };
  let folder = $state(saved.folder);
  let name = $state(saved.name);
  let path = $state('');
  let themes = $state<string[]>(desktop ? [] : webThemes);
  let busy = $state(desktop);
  let problem = $state('');

  async function load(nextFolder: string | null, preserveSelection: boolean, reload = false) {
    const catalog = await listThemes(nextFolder);
    const nextName = preserveSelection && name !== null && catalog.themes.includes(name) ? name : null;
    if (nextFolder !== folder || nextName !== name || (reload && nextName !== null)) {
      await setDesktopTheme(nextFolder, nextName);
    }
    folder = nextFolder;
    path = catalog.folder;
    name = nextName;
    themes = catalog.themes;
  }

  async function change(action: () => Promise<void>) {
    busy = true;
    problem = '';
    try {
      await action();
    } catch (error) {
      problem = typeof error === 'string' ? error
        : error instanceof Error ? error.message : 'Could not change the theme.';
    } finally {
      busy = false;
    }
  }

  function choose() {
    return change(async () => {
      const chosen = await chooseThemesFolder();
      if (chosen !== null) await load(chosen, chosen === folder);
    });
  }

  function select(theme: string | null) {
    return change(async () => {
      if (desktop) await setDesktopTheme(folder, theme);
      else await setWebTheme(theme);
      name = theme;
    });
  }

  onMount(() => {
    if (desktop) void change(() => load(folder, true));
  });
</script>

{#if desktop}
  <dl>
    <dt>Themes folder</dt>
    <dd>{path || folder || 'Default themes folder'}</dd>
  </dl>
  <div class="actions">
    <button type="button" disabled={busy} onclick={choose}>Choose folder…</button>
    <button type="button" disabled={busy || folder === null} onclick={() => change(() => load(null, false))}>Use default folder</button>
    <button type="button" disabled={busy} onclick={() => change(() => load(folder, true, true))}>Refresh themes</button>
  </div>
{/if}

<label class="theme-choice">
  Theme
  <select value={name ?? ''} disabled={busy} onchange={event => select(event.currentTarget.value || null)}>
    <option value="">Dark</option>
    {#each themes as theme (theme)}
      <option value={theme}>{theme}</option>
    {/each}
  </select>
</label>
{#if desktop}
  <p>Each theme is a folder containing <code>theme.css</code>. It can include images and fonts referenced by the stylesheet.</p>
{/if}
{#if problem}<p role="alert">{problem}</p>{/if}

<style>
  dl { margin: 0 0 12px; }
  dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .theme-choice { display: flex; align-items: center; gap: 12px; }
  .theme-choice select { min-width: 120px; max-width: 100%; }
</style>
