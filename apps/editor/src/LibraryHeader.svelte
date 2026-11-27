<script lang="ts">
  import { onMount } from 'svelte';
  import LibraryIcon from './LibraryIcon.svelte';
  let {
    search = $bindable(''),
    kind = $bindable('all'),
    sort = $bindable('name'),
    descending = $bindable(false),
    name = $bindable('Symbol'),
    blocked = false,
    audioAvailable = false,
    create,
    folder,
    files,
    audio,
    convert,
    canConvert = false,
  }: {
    search?: string;
    kind?: string;
    sort?: string;
    descending?: boolean;
    name?: string;
    blocked?: boolean;
    audioAvailable?: boolean;
    create: (kind: 'graphic' | 'movie' | 'button') => void;
    folder: (name: string) => void;
    files: (files: File[]) => void;
    audio: () => void;
    convert: () => void;
    canConvert?: boolean;
  } = $props();
  let root: HTMLDivElement,
    filterMenu: HTMLDetailsElement,
    newMenu: HTMLDetailsElement,
    folderMenu: HTMLDetailsElement,
    folderName = $state('New folder');
  function newItem(kind: 'graphic' | 'movie' | 'button') {
    newMenu.open = false;
    create(kind);
  }
  function close() {
    for (const menu of [filterMenu, newMenu, folderMenu]) if (menu) menu.open = false;
  }
  function opened(menu: HTMLDetailsElement) {
    if (menu.open)
      for (const other of [filterMenu, newMenu, folderMenu])
        if (other && other !== menu) other.open = false;
  }
  onMount(() => {
    const pointer = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close();
    };
    const menus = [filterMenu, newMenu, folderMenu];
    const focus = (event: FocusEvent) => {
      for (const menu of menus) {
        if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const menu = menus.find(menu => menu?.open && menu.contains(event.target as Node));
      if (!menu) return;
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      menu.querySelector('summary')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('focusin', focus);
    root.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('focusin', focus);
      root.removeEventListener('keydown', key);
    };
  });
</script>

<div class="library-toolbar" bind:this={root}>
  <input
    aria-label="Search library"
    type="search"
    bind:value={search}
    placeholder="Search library"
  />
  <details class="library-popup filters" bind:this={filterMenu} ontoggle={() => opened(filterMenu)}>
    <summary aria-label="Library filters" title="Sort and filter"
      ><LibraryIcon kind="filter" /></summary
    >
    <div class="library-popup-body">
      <label
        >Show<select aria-label="Library item type" bind:value={kind}
          ><option value="all">All items</option><option value="symbol">All symbols</option><option
            value="graphic">Graphics</option
          ><option value="movie">Movie clips</option><option value="button">Buttons</option><option
            value="bitmap">Bitmaps</option
          ><option value="audio">Audio</option></select
        ></label
      >
      <label
        >Sort<select aria-label="Sort library" bind:value={sort}
          ><option value="name">Name</option><option value="type">Type, then name</option><option
            value="link">Link name</option
          ></select
        ></label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Descending library order"
          bind:checked={descending}
        />Descending</label
      >
    </div>
  </details>
  <details bind:this={newMenu} class="library-popup new" ontoggle={() => opened(newMenu)}>
    <summary aria-label="New library item" title="Create or import">＋ New</summary>
    <div class="library-popup-body">
      <label>Name<input aria-label="New symbol name" maxlength="200" bind:value={name} /></label>
      <button disabled={blocked} onclick={() => newItem('graphic')}>New symbol</button>
      <button disabled={blocked} onclick={() => newItem('movie')}>New movie clip</button>
      <button disabled={blocked} onclick={() => newItem('button')}>New button</button>
      <button
        disabled={blocked || !canConvert}
        onclick={() => {
          newMenu.open = false;
          convert();
        }}>Convert selection to symbol</button
      >
      <label class="library-file"
        >Import images…<input
          aria-label="Import bitmap"
          title="Import PNG, JPEG, WebP, SVG or SVGZ"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,.svgz"
          disabled={blocked}
          onchange={(e) => {
            const selected = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            newMenu.open = false;
            if (selected.length) files(selected);
          }}
        /></label
      >
      <button
        disabled={blocked || !audioAvailable}
        title={audioAvailable
          ? 'Import audio'
          : 'WAV import requires a saved project in the local development browser'}
        onclick={() => {
          newMenu.open = false;
          audio();
        }}>Import audio…</button
      >
      <p class="hint">Images: PNG, JPEG, WebP. You can also drop files into the Library.</p>
    </div>
  </details>
  <details bind:this={folderMenu} class="library-popup folder" ontoggle={() => opened(folderMenu)}>
    <summary aria-label="New folder" title="New folder"
      ><LibraryIcon kind="folder" /><span>＋</span></summary
    >
    <div class="library-popup-body">
      <label
        >Folder name<input
          aria-label="New library folder name"
          maxlength="200"
          bind:value={folderName}
        /></label
      ><button
        disabled={blocked}
        onclick={() => {
          folder(folderName);
          folderMenu.open = false;
        }}>New library folder</button
      >
    </div>
  </details>
</div>

<style>
  .library-toolbar {
    display: flex;
    align-items: center;
    gap: 5px;
    position: relative;
    margin-bottom: 8px;
  }
  .library-toolbar > input {
    flex: 1;
    min-width: 30px;
    width: 0;
  }
  summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 5px;
    border: 1px solid #515661;
    border-radius: 4px;
    white-space: nowrap;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  details[open] > summary {
    background: var(--accent-subtle);
  }
  .library-popup-body {
    position: absolute;
    z-index: 30;
    right: 0;
    top: 100%;
    width: min(240px, 100%);
    padding: 10px;
    background: #30343e;
    border: 1px solid var(--accent-divider);
    box-shadow: 0 8px 20px #0008;
    display: grid;
    gap: 7px;
    border-radius: 4px;
  }
  .library-popup-body label {
    display: grid;
    gap: 4px;
  }
  .library-popup-body input,
  .library-popup-body select {
    min-width: 0;
    max-width: 100%;
  }
  .library-popup-body button {
    text-align: left;
  }
  .folder summary span {
    font-size: 12px;
    margin-left: -6px;
  }
  .library-file {
    padding: 6px;
    background: #414651;
    border-radius: 3px;
  }
  .library-file input {
    font-size: 10px;
  }
</style>
