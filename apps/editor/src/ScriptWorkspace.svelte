<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import LibraryIcon from './LibraryIcon.svelte';
  import ProjectFileView from './ProjectFileView.svelte';
  import ProjectCode from './ProjectCode.svelte';
  import ScriptCheck from './ScriptCheck.svelte';
  import WorkspaceDivider from './WorkspaceDivider.svelte';
  import { isScriptPath } from '../../../packages/document/src/script-path';
  import {
    defaultScriptExplorerWidth,
    isScriptSaveShortcut,
    type FileOperation,
    type FrameScriptFile,
    type ScriptWorkspace,
    type ScriptTab,
  } from './script-workspace';
  let {
    workspace = $bindable(),
    operate,
    frameFiles,
    primary,
    children,
    flushPrimary,
    primaryComposing,
    discardPrimary,
  }: {
    workspace: ScriptWorkspace;
    operate: FileOperation;
    frameFiles: FrameScriptFile[];
    primary: string;
    children: Snippet;
    flushPrimary: () => Promise<boolean> | boolean;
    primaryComposing: () => boolean;
    discardPrimary: () => void;
  } = $props();
  let activeFrameEditor = $state.raw<ReturnType<typeof ScriptCheck>>();
  export function flush() {
    return active ? (activeFrameEditor?.flush() ?? true) : flushPrimary();
  }
  export function discardFrameDraft() {
    if (active) activeFrameEditor?.discardDraft();
    else discardPrimary();
  }
  const fileInputId = $props.id();
  let tabList = $state<HTMLDivElement>();
  let focusedTab = $state<string>();
  const tabId = (path: string) => fileInputId + '-tab-' + encodeURIComponent(path);
  const panelId = (path: string) => fileInputId + '-panel-' + encodeURIComponent(path);
  let paths = $state<string[]>([]),
    message = $state(''),
    explorerMessage = $state(''),
    loading = $state(false),
    opening = $state(''),
    newFileInput = $state<HTMLInputElement>(),
    newFileButton = $state<HTMLButtonElement>(),
    name = $state(''),
    creating = $state(false),
    saving = $state(false);
  const minExplorerWidth = 156;
  const maxExplorerWidth = 440;
  const compositionMessage = 'Finish entering text in the frame editor before switching files.';
  let explorer = $derived(workspace.explorer);
  let query = $derived(explorer.search.trim().toLowerCase());
  let splitWidth = $state(0);
  let compact = $derived(splitWidth > 0 && splitWidth < 460);
  let compactFiles = $state(false);
  let compactCodeButton = $state<HTMLButtonElement>();
  let resizePreview = $state<number | null>(null);
  let filterDisclosure = $state<{ query: string; collapsed: string[] }>({
    query: '',
    collapsed: [],
  });
  let availableWidth = $derived(
    Math.max(minExplorerWidth, Math.min(maxExplorerWidth, splitWidth - 176)),
  );
  let visibleWidth = $derived(Math.min(resizePreview ?? explorer.width, availableWidth));
  let fileList = $state<HTMLElement>();
  let focusedPath = $state('');
  let createTrigger: HTMLButtonElement | undefined;
  let alive = true,
    selection = 0;
  const pendingFrameSaves = new WeakMap<ScriptTab, { text: string; done: Promise<void> }>();
  const pendingFileSaves = new SvelteMap<ScriptTab, string>();
  let active = $derived(workspace.tabs.find((t) => t.path === workspace.active));
  let activePath = $derived(active?.path ?? primary);
  let drafts = $derived(
    new Set(workspace.tabs.filter((tab) => tab.text !== tab.original).map((tab) => tab.path)),
  );
  const sectionLabels = {
    scripts: 'TypeScript files',
    frames: 'Frame scripts',
    data: 'Project data',
  };
  type Row = [path: string, folder: boolean];
  const symbolLabels = $derived(new Map(frameFiles.flatMap(({ path, symbolName }) =>
    symbolName ? [[path.slice(0, path.lastIndexOf('/')), symbolName] as const] : [],
  )));
  const displayPath = (path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/'));
    const symbol = symbolLabels.get(parent);
    return symbol ? symbol + ' / ' + leaf(path) : symbolLabels.get(path) ?? path;
  };
  let sections = $derived.by(() => {
    const childrenByFolder = new SvelteMap<string, SvelteMap<string, boolean>>();
    for (const path of new Set([
      ...paths,
      ...frameFiles.map(({ path }) => path),
      ...(primary === 'Scratchpad' ? [primary] : []),
      ...workspace.tabs.filter((t) => !t.path.startsWith('Frames/')).map((t) => t.path),
    ])) {
      if (!displayPath(path).toLowerCase().includes(query)) continue;
      const parts = path.split('/');
      let parent = '';
      for (let i = 0; i < parts.length; i++) {
        const entry = parent ? parent + '/' + parts[i] : parts[i];
        const siblings = childrenByFolder.get(parent) ?? new SvelteMap<string, boolean>();
        siblings.set(entry, i < parts.length - 1);
        childrenByFolder.set(parent, siblings);
        parent = entry;
      }
    }
    if (!query && !childrenByFolder.get('')?.has('scripts')) {
      const roots = childrenByFolder.get('') ?? new SvelteMap<string, boolean>();
      roots.set('scripts', true);
      childrenByFolder.set('', roots);
    }
    const rows: Record<keyof typeof sectionLabels, Row[]> = { scripts: [], frames: [], data: [] };
    function append(parent: string) {
      const siblings = [...(childrenByFolder.get(parent) ?? [])].sort(
        ([a, folderA], [b, folderB]) =>
          Number(folderB) - Number(folderA) || displayPath(a).localeCompare(displayPath(b), undefined, { numeric: true }),
      );
      for (const row of siblings) {
        const [path, folder] = row;
        const root = path.split('/', 1)[0];
        if (root === 'scripts') rows.scripts.push(row);
        else if (root === 'Frames' || root === 'Scratchpad') rows.frames.push(row);
        else rows.data.push(row);
        if (folder && isExpanded(path)) append(path);
      }
    }
    append('');
    return [
      { label: sectionLabels.scripts, rows: rows.scripts },
      { label: sectionLabels.frames, rows: rows.frames },
      { label: sectionLabels.data, rows: rows.data },
    ];
  });
  let tree = $derived(sections.flatMap(({ rows }) => rows));
  let hasScriptFiles = $derived(
    paths.some((path) => path.startsWith('scripts/')) ||
      workspace.tabs.some((tab) => tab.path.startsWith('scripts/')),
  );
  let tabStop = $derived(
    tree.find(([path]) => path === focusedPath)?.[0] ??
      tree.find(([path]) => path === activePath)?.[0] ??
      tree[0]?.[0],
  );
  const leaf = (path: string) => path.split('/').at(-1) ?? path;
  const parentFolder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  function isExpanded(path: string) {
    return query
      ? filterDisclosure.query !== query || !filterDisclosure.collapsed.includes(path)
      : !explorer.collapsed.includes(path);
  }
  function setExpanded(path: string, expanded: boolean) {
    const collapsed = query
      ? filterDisclosure.query === query
        ? filterDisclosure.collapsed
        : []
      : explorer.collapsed;
    const next = expanded ? collapsed.filter((folder) => folder !== path) : [...collapsed, path];
    if (query) filterDisclosure = { query, collapsed: next };
    else explorer.collapsed = next;
  }
  function reveal(path: string) {
    explorer.collapsed = explorer.collapsed.filter((folder) => !path.startsWith(folder + '/'));
  }
  function fileRow(path: string) {
    return fileList?.querySelector<HTMLButtonElement>(`[data-path="${CSS.escape(path)}"]`);
  }
  function focusRow(path: string) {
    fileRow(path)?.focus();
  }
  async function openTab(path: string) {
    await open(path);
    if (activePath !== path || compact || !explorer.visible) return;
    if (query && !displayPath(path).toLowerCase().includes(query)) explorer.search = '';
    await tick();
    const row = fileRow(path);
    if (!row || !fileList) return;
    // Keep the selected row in view without scrolling the enclosing dock or editor.
    const bounds = fileList.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) fileList.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) fileList.scrollTop += item.bottom - bounds.bottom;
  }
  async function revealActive() {
    const path = activePath;
    explorer.search = '';
    reveal(path);
    await tick();
    focusRow(path);
  }
  function rowKeys(event: KeyboardEvent, path: string, folder: boolean) {
    const index = tree.findIndex(([entry]) => entry === path);
    let next: string | undefined;
    const expanded = isExpanded(path);
    switch (event.key) {
      case 'ArrowDown':
        next = tree[index + 1]?.[0];
        break;
      case 'ArrowUp':
        next = tree[index - 1]?.[0];
        break;
      case 'Home':
        next = tree[0]?.[0];
        break;
      case 'End':
        next = tree.at(-1)?.[0];
        break;
      case 'ArrowRight':
        if (folder && !expanded) setExpanded(path, true);
        else if (folder && parentFolder(tree[index + 1]?.[0] ?? '') === path)
          next = tree[index + 1]?.[0];
        break;
      case 'ArrowLeft':
        if (folder && expanded) setExpanded(path, false);
        else next = parentFolder(path);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next) focusRow(next);
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    explorerMessage = '';
    try {
      const result = await operate({ op: 'list' });
      if (!Array.isArray(result)) throw Error('The file list was unavailable.');
      if (alive) paths = result;
    } catch (err) {
      if (alive) explorerMessage = 'Could not list project files. ' + String(err);
    } finally {
      if (alive) loading = false;
    }
  }
  onMount(() => {
    void refresh();
    return () => {
      alive = false;
    };
  });
  async function showCode() {
    if (!compact || !compactFiles) return;
    compactFiles = false;
    await tick();
    compactCodeButton?.focus();
  }
  export function isComposing() {
    return active ? activeFrameEditor?.isComposing() ?? false : primaryComposing();
  }
  export function compositionBlocksSwitch(notice = compositionMessage) {
    if (!isComposing()) return false;
    message = notice;
    return true;
  }
  function activate(path: string) {
    if (path !== activePath) {
      if (compositionBlocksSwitch()) return;
      void flush();
    }
    workspace.active = path === primary ? '' : path;
    reveal(path);
    void showCode();
  }
  async function open(path: string) {
    const ticket = ++selection;
    opening = '';
    message = '';
    explorerMessage = '';
    if (path === primary || workspace.tabs.some((t) => t.path === path)) {
      activate(path);
      return;
    }
    if (path.endsWith('.json')) {
      workspace.tabs.push({ path, text: '', original: '' });
      activate(path);
      return;
    }
    opening = path;
    try {
      const value = await operate({ op: 'read', path });
      if (!alive || ticket !== selection) return;
      if (typeof value !== 'string') throw Error('The file contents were unavailable.');
      workspace.tabs.push({ path, text: value, original: value });
      activate(path);
    } catch (err) {
      if (alive && ticket === selection)
        explorerMessage = 'Could not open ' + leaf(path) + '. ' + String(err);
    } finally {
      if (alive && ticket === selection) opening = '';
    }
  }
  async function startCreate(folder?: string, trigger = newFileButton) {
    const selected = tree.find(([path]) => path === focusedPath);
    const parent = folder ?? (selected?.[1] ? selected[0] : parentFolder(selected?.[0] ?? activePath));
    createTrigger = trigger;
    name = parent.startsWith('scripts/') ? parent.slice('scripts/'.length) + '/' : '';
    explorerMessage = '';
    creating = true;
    await tick();
    newFileInput?.focus();
    newFileInput?.setSelectionRange(name.length, name.length);
  }
  async function cancelCreate() {
    creating = false;
    explorerMessage = '';
    name = '';
    await tick();
    (createTrigger ?? newFileButton)?.focus();
    createTrigger = undefined;
  }
  async function create() {
    if (compositionBlocksSwitch()) return;
    const input = name.trim().replace(/^scripts\//, '');
    const path = 'scripts/' + (input.endsWith('.ts') ? input : input + '.ts');
    if (!input || input.endsWith('/') || !isScriptPath(path)) {
      explorerMessage = 'Enter a TypeScript filename, such as player/movement.ts.';
      return;
    }
    const key = path.toLowerCase();
    const existing = [...paths, ...workspace.tabs.map((t) => t.path)].map((p) => p.toLowerCase());
    if (existing.includes(key)) {
      explorerMessage = 'That filename is already in use.';
      return;
    }
    if (existing.some((p) => p.startsWith(key + '/') || key.startsWith(p + '/'))) {
      explorerMessage = 'A file and a folder cannot share the same path.';
      return;
    }
    selection++;
    opening = '';
    void flush();
    workspace.tabs.push({ path, text: '', original: null });
    workspace.active = path;
    creating = false;
    createTrigger = undefined;
    name = '';
    message = '';
    explorerMessage = '';
    explorer.search = '';
    reveal(path);
    await tick();
    if (compact) void showCode();
    else focusRow(path);
  }
  async function closeTab(tab: ScriptTab) {
    if (active === tab && compositionBlocksSwitch()) return;
    if (active === tab && tab.path.startsWith('Frames/')) await flush();
    await pendingFrameSaves.get(tab)?.done.catch(() => {});
    if (active === tab && compositionBlocksSwitch()) return;
    if (
      tab.original !== tab.text &&
      !window.confirm('Discard unsaved changes to ' + tab.path + '?')
    )
      return;
    selection++;
    opening = '';
    const index = workspace.tabs.indexOf(tab);
    if (index === -1) return;
    if (message === compositionMessage) message = '';
    workspace.tabs.splice(index, 1);
    if (workspace.active === tab.path)
      workspace.active = workspace.tabs[Math.min(index, workspace.tabs.length - 1)]?.path ?? '';
    await tick();
    document.getElementById(tabId(workspace.active || primary))?.focus();
  }
  async function saveFile(tab: ScriptTab) {
    if (!saving && tab.text === tab.original) return;
    // Capture only explicitly saved text. Edits during a write can remain drafts.
    pendingFileSaves.set(tab, tab.text);
    if (saving) return;
    const write = operate;
    saving = true;
    message = '';
    try {
      for (const [file, text] of pendingFileSaves) {
        pendingFileSaves.delete(file);
        if (file.original === text) continue;
        try {
          await write({ op: 'save', path: file.path, expected: file.original, text });
          file.original = text;
          if (alive && !paths.includes(file.path)) paths.push(file.path);
        } catch (err) {
          if (alive) message = String(err);
        }
      }
    } finally {
      saving = false;
    }
  }
  function persistFrame(tab: ScriptTab, text: string) {
    const previous = pendingFrameSaves.get(tab);
    if (previous?.text === text) return previous.done;
    if (!previous && tab.original === text) return;
    const write = operate;
    const save = (expected: string | null) => write({ op: 'save', path: tab.path, expected, text });
    const done = save(previous?.text ?? tab.original).catch(async error => {
      if (!previous) throw error;
      try { await previous.done; }
      catch {
        if (alive && pendingFrameSaves.get(tab)?.done === done) {
          await save(tab.original);
          return;
        }
      }
      throw error;
    }).then(() => { tab.original = text; }).finally(() => {
      if (pendingFrameSaves.get(tab)?.done === done) pendingFrameSaves.delete(tab);
    });
    pendingFrameSaves.set(tab, { text, done });
    return done;
  }
  async function removeFrame(tab: ScriptTab) {
    await pendingFrameSaves.get(tab)?.done.catch(() => {});
    await operate({ op: 'remove', path: tab.path, expected: tab.original });
    tab.original = null;
    tab.text = '';
  }
  function leaveTabList(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node) || !tabList?.contains(event.relatedTarget))
      focusedTab = undefined;
  }
  function tabKeys(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !(event.target instanceof HTMLButtonElement)) return;
    const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = tabs.indexOf(event.target);
    if (index === -1) return;
    const tab = tabs[index];
    if (event.key === 'Delete') {
      const item = workspace.tabs.find(item => item.path === tab.dataset.scriptTab);
      if (!item || saving) return;
      event.preventDefault();
      event.stopPropagation();
      void closeTab(item);
      return;
    }
    let next: HTMLButtonElement;
    switch (event.key) {
      case 'ArrowLeft': next = tabs[(index + tabs.length - 1) % tabs.length]; break;
      case 'ArrowRight': next = tabs[(index + 1) % tabs.length]; break;
      case 'Home': next = tabs[0]; break;
      case 'End': next = tabs[tabs.length - 1]; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    next.focus();
  }
  export function saveShortcut(e: KeyboardEvent) {
    if (isScriptSaveShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat && !e.isComposing) {
        if (!active || active.path.startsWith('Frames/')) void flush();
        else if (!active.path.endsWith('.json')) void saveFile(active);
      }
    }
  }
</script>

<div class="workspace" role="region" aria-label="Script workspace">
  {#if compact}
    <div class="compact-switch" role="group" aria-label="Script workspace view">
      <button
        type="button"
        aria-pressed={!compactFiles}
        aria-controls={fileInputId + '-code'}
        bind:this={compactCodeButton}
        onclick={() => (compactFiles = false)}>Code</button
      >
      <button
        type="button"
        aria-pressed={compactFiles}
        aria-controls={fileInputId + '-explorer'}
        onclick={() => { void flush(); compactFiles = true; }}>Project Explorer</button
      >
    </div>
  {/if}
  <div class="split" class:compact bind:clientWidth={splitWidth}>
    <section id={fileInputId + '-code'} aria-label="Code editor" hidden={compact && compactFiles}>
      <div class="tabs" role="tablist" aria-label="Open scripts" bind:this={tabList} onfocusout={leaveTabList}>
        <button role="tab" aria-selected={!active} title={primary} id={tabId(primary)}
          aria-controls={panelId(primary)} tabindex={(focusedTab ?? activePath) === primary ? 0 : -1}
          onfocus={() => focusedTab = primary} onkeydown={tabKeys} onclick={() => openTab(primary)}
          >{leaf(primary)}</button
        >
        {#each workspace.tabs as tab (tab.path)}
          <div class="tab" role="presentation" class:current={tab.path === workspace.active}>
            <button
              role="tab"
              aria-selected={tab.path === workspace.active}
              id={tabId(tab.path)}
              aria-controls={panelId(tab.path)}
              aria-keyshortcuts="Delete"
              data-script-tab={tab.path}
              tabindex={(focusedTab ?? activePath) === tab.path ? 0 : -1}
              onfocus={() => focusedTab = tab.path}
              onkeydown={tabKeys}
              title={displayPath(tab.path)}
              onclick={() => openTab(tab.path)}
              >{symbolLabels.has(parentFolder(tab.path)) ? displayPath(tab.path) : leaf(tab.path)}{tab.text !== tab.original ? ' •' : ''}</button
            >
            <button
              class="close"
              aria-label={'Close ' + tab.path}
              disabled={saving}
              tabindex={-1}
              onclick={() => closeTab(tab)}>×</button
            >
          </div>
        {/each}
      </div>
      <div class="primary" role="tabpanel" id={panelId(primary)} aria-labelledby={tabId(primary)} hidden={!!active}>{@render children()}</div>
      {#each workspace.tabs as tab (tab.path)}
        <div class="document" role="tabpanel" id={panelId(tab.path)} aria-labelledby={tabId(tab.path)} hidden={workspace.active !== tab.path}>
          {#if tab.path.startsWith('Frames/')}
            {#if workspace.active === tab.path}
              <ScriptCheck
                panel
                bind:this={activeFrameEditor}
                bind:source={tab.text}
                savedSource={tab.original ?? ''}
                shouldFocus={() => !tabList?.contains(document.activeElement)}
                frameNumber={Number(leaf(tab.path).match(/\d+/)?.[0])}
                persist={text => persistFrame(tab, text)}
                apply={text => persistFrame(tab, text)}
                remove={tab.original === null ? undefined : () => removeFrame(tab)}
              />{/if}
          {:else if tab.path.endsWith('.json')}
            {#if workspace.active === tab.path}<ProjectFileView path={tab.path} {operate} />{/if}
          {:else}
            <div class="file-bar">
              <span title={tab.path}>{tab.path}</span><button
                disabled={saving || tab.original === tab.text}
                aria-keyshortcuts="Control+S Meta+S"
                title="Save file (Ctrl+S or Cmd+S)"
                onclick={() => saveFile(tab)}>Save file</button
              >
            </div>
            <div class="surface"><ProjectCode {tab} /></div>
          {/if}
        </div>
      {/each}
      {#if message}<div class="message" role="status">{message}</div>{/if}
    </section>
    {#if explorer.visible && !compact}
      <WorkspaceDivider
        label="Resize Project Explorer"
        controls={fileInputId + '-explorer'}
        reverse
        value={visibleWidth}
        min={minExplorerWidth}
        max={availableWidth}
        defaultValue={defaultScriptExplorerWidth}
        context={String(splitWidth)}
        preview={(value) => (resizePreview = value)}
        commit={(value) => (explorer.width = value)}
      />
    {/if}
    <aside
      id={fileInputId + '-explorer'}
      class="project-explorer"
      class:folded={!compact && !explorer.visible}
      hidden={compact && !compactFiles}
      style:--explorer-width={visibleWidth + 'px'}
      aria-label="Project Explorer"
    >
      <div class="explorer-heading">
        {#if compact}
          <span class="explorer-title">Project files</span>
        {:else}
          <button
            type="button"
            class="explorer-toggle"
            aria-expanded={explorer.visible}
            aria-label="Project Explorer"
            title={explorer.visible ? 'Hide Project Explorer' : 'Show Project Explorer'}
            onclick={() => (explorer.visible = !explorer.visible)}
          >
            <span class="disclosure" aria-hidden="true">{explorer.visible ? '▾' : '‹'}</span>
            {#if explorer.visible}<span class="explorer-title">Project Explorer</span>{/if}
          </button>
        {/if}
        {#if compact || explorer.visible}
          <button
            type="button"
            class="explorer-action"
            bind:this={newFileButton}
            title="New TypeScript file in the selected script folder"
            aria-label="New TypeScript file"
            onclick={() => startCreate()}
            disabled={creating}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M9 2H3v12h10v-3M10 2v6m-3-3h6" />
            </svg>
          </button>
          <button
            type="button"
            class="explorer-action"
            title="Refresh project files"
            aria-label="Refresh project files"
            disabled={loading}
            onclick={refresh}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M13 6a5.25 5.25 0 1 0 0 4m0-8v4H9" />
            </svg>
          </button>
        {/if}
      </div>
      {#if compact || explorer.visible}
        <div class="explorer-search" hidden={creating}>
          <input
            type="search"
            aria-label="Filter project files"
            placeholder="Filter files…"
            bind:value={explorer.search}
            oninput={() => (filterDisclosure = { query: '', collapsed: [] })}
            onkeydown={(event) => {
              if (event.key === 'ArrowDown' && tabStop) {
                event.preventDefault();
                focusRow(tabStop);
              } else if (event.key === 'Enter' && query) {
                const matches = tree.filter(([, folder]) => !folder);
                const match = matches.find(([path]) => path === tabStop) ?? matches[0];
                if (match) {
                  event.preventDefault();
                  focusRow(match[0]);
                  void open(match[0]);
                }
              } else if (event.key === 'Escape' && explorer.search) {
                event.preventDefault();
                explorer.search = '';
              }
            }}
          />
          <button
            type="button"
            class="explorer-action"
            title="Reveal the active file"
            aria-label="Reveal active file"
            onclick={revealActive}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="8" cy="8" r="4.5" />
              <path d="M8 1v4m0 6v4M1 8h4m6 0h4" />
            </svg>
          </button>
        </div>
        {#if creating}
          <div class="create-viewport">
            <form
              class="explorer-create"
              onsubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <label for={fileInputId}>New TypeScript file</label>
              <input
                id={fileInputId}
                bind:this={newFileInput}
                bind:value={name}
                aria-label="New file path"
                placeholder="folder/file.ts"
                autocomplete="off"
                spellcheck="false"
                onkeydown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    cancelCreate();
                  }
                }}
              />
              <div class="create-actions">
                <button type="button" onclick={cancelCreate}>Cancel</button>
                <button type="submit" disabled={!name.trim() || loading}>Create</button>
              </div>
              {#if explorerMessage}<p class="explorer-status" role="status">
                  {explorerMessage}
                </p>{/if}
            </form>
          </div>
        {/if}
        <nav aria-label="Project files" aria-busy={loading} bind:this={fileList} hidden={creating}>
          {#if explorerMessage && !creating}<p class="explorer-status explorer-error" role="status">
              {explorerMessage}
            </p>{:else if opening && !creating}<p class="explorer-status" role="status">
              Opening {leaf(opening)}…
            </p>{/if}
          {#each sections as { label, rows } (label)}
            {#if rows.length || label === sectionLabels.frames}
              <section class="tree-section" aria-label={label}>
                <h3>{label}</h3>
                {#if !rows.length}<p class="explorer-status">{query ? 'No matching frame scripts.' : 'No frame scripts attached.'}</p>{/if}
                {#each rows as [path, folder] (path)}
                  <div class="tree-entry">
                    <button
                      type="button"
                      class="tree-row"
                      data-path={path}
                      title={path}
                      aria-current={!folder && path === activePath ? 'true' : undefined}
                      aria-expanded={folder ? isExpanded(path) : undefined}
                      aria-busy={opening === path ? true : undefined}
                      tabindex={path === tabStop ? 0 : -1}
                      style:--tree-depth={path.split('/').length - 1}
                      class:folder
                      class:folder-selected={folder && path === tabStop && path === focusedPath}
                      class:draft={drafts.has(path)}
                      class:opening={opening === path}
                      onfocus={() => (focusedPath = path)}
                      onclick={() => (folder ? setExpanded(path, !isExpanded(path)) : open(path))}
                      onkeydown={(event) => rowKeys(event, path, folder)}
                    >
                      <span class="disclosure" aria-hidden="true"
                        >{folder ? (isExpanded(path) ? '▾' : '▸') : ''}</span
                      >
                      <span
                        class="tree-icon"
                        class:typescript={path.endsWith('.ts') && !folder}
                        aria-hidden="true"
                      >
                        {#if folder}<LibraryIcon
                            kind="folder"
                          />{:else if path.endsWith('.ts')}TS{:else if path.endsWith('.json')}{'{}'}{:else}ƒ{/if}
                      </span>
                      <span class="tree-name">{symbolLabels.get(path) ?? leaf(path)}</span>
                      <span class="draft-marker" aria-hidden="true"></span>
                    </button>
                    {#if folder && (path === 'scripts' || path.startsWith('scripts/'))}
                      <button
                        type="button"
                        class="folder-action"
                        aria-label={'New file in ' + path}
                        title={'New TypeScript file in ' + path}
                        tabindex={path === tabStop ? 0 : -1}
                        onclick={(event) => startCreate(path, event.currentTarget)}
                      >+</button>
                    {/if}
                  </div>
                {/each}
                {#if label === sectionLabels.scripts && !query && isExpanded('scripts') && !hasScriptFiles && !explorerMessage}
                  {#if loading}
                    <p class="explorer-status">Loading files…</p>
                  {:else}
                    <button class="empty-scripts" type="button" onclick={(event) => startCreate('scripts', event.currentTarget)}>Create a TypeScript file</button>
                  {/if}
                {/if}
              </section>
            {/if}
          {/each}
          {#if !tree.length && !explorerMessage}
            <p class="explorer-status">{loading ? 'Loading files…' : 'No matching files.'}</p>
          {/if}
        </nav>
      {/if}
    </aside>
  </div>
</div>

<style>
  .workspace,
  .primary,
  .document,
  section,
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .workspace,
  .primary,
  .document,
  .surface {
    flex: 1;
  }
  [hidden] {
    display: none !important;
  }
  .tabs,
  .tab,
  .file-bar {
    display: flex;
    align-items: center;
  }
  .tabs {
    overflow: auto;
    flex: none;
    border-bottom: 1px solid var(--script-panel-border, #424750);
    background: var(--script-tabs-background, #202229);
  }
  button {
    white-space: nowrap;
  }
  .tabs button,
  nav button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
  }
  .tabs button {
    padding: 5px 8px;
  }
  .tab {
    flex: none;
  }
  .tab.current,
  .tabs > button[aria-selected='true'],
  .tree-row[aria-current] {
    background: var(--script-tab-selection, #393f4b);
  }
  .tabs .close {
    padding: 3px 5px;
  }
  .split {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .split > section {
    flex: 1;
    overflow: hidden;
  }
  .compact-switch {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 2px 4px;
    border-bottom: 1px solid var(--accent-divider);
    background: var(--surface-dark);
  }
  .compact-switch button {
    padding: 4px 8px;
  }
  .compact-switch button[aria-pressed='true'] {
    background: var(--accent-surface);
    color: var(--accent-text);
  }
  .compact .project-explorer {
    flex: 1;
    border-left: 0;
  }
  .surface {
    position: relative;
    min-height: 50px;
  }
  .project-explorer {
    flex: 0 0 var(--explorer-width);
    background: var(--surface-dark);
    color: var(--surface-text);
    border-left: 1px solid var(--accent-divider, #424750);
    overflow: hidden;
  }
  .project-explorer.folded {
    flex-basis: 34px;
  }
  .folded .explorer-heading {
    grid-template-columns: 1fr;
  }
  .folded .explorer-toggle {
    justify-content: center;
  }
  .explorer-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 2px;
    align-items: center;
    flex: none;
    min-height: 32px;
    padding: 2px 5px;
    background: var(--accent-subtle);
    border-bottom: 1px solid var(--accent-divider, #424750);
  }
  .explorer-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 4px 2px;
    text-align: left;
  }
  .explorer-title,
  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .explorer-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--surface-text);
  }
  .explorer-action {
    width: 25px;
    height: 24px;
    padding: 0;
    color: var(--accent-text);
  }
  .explorer-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 5px 6px;
    border-bottom: 1px solid var(--accent-divider, #424750);
  }
  .explorer-action svg {
    display: block;
    width: 15px;
    margin: auto;
    stroke-width: 1.25;
  }
  .create-viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .explorer-create {
    display: grid;
    gap: 6px;
    padding: 8px;
  }
  .explorer-create label {
    font-weight: 600;
  }
  .explorer-create .explorer-status {
    padding: 0;
    color: var(--script-warning-text, #f2c88b);
  }
  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
  .create-actions button {
    padding: 3px 6px;
  }
  .create-actions button[type='submit'] {
    background: var(--accent-wash);
    border-color: var(--accent-border);
  }
  nav {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 3px 5px 6px;
    scrollbar-gutter: stable;
  }
  .tree-section + .tree-section {
    border-top: 1px solid var(--accent-divider, #424750);
    margin-top: 6px;
    padding-top: 3px;
  }
  .tree-section h3 {
    margin: 5px 7px 3px;
    color: var(--accent-muted, #a1b6d2);
    font-size: 11px;
    font-weight: 650;
  }
  .tree-entry {
    display: flex;
    align-items: center;
    border-radius: 4px;
  }
  .tree-entry:focus-within,
  .tree-entry:hover {
    background: var(--accent-subtle, #303641);
  }
  .tree-entry .folder-action {
    display: grid;
    flex: 0 0 24px;
    place-items: center;
    height: 24px;
    padding: 0;
    color: var(--accent-text);
    border-radius: 4px;
    font-size: 16px;
    opacity: .65;
  }
  .tree-entry .folder-action:hover,
  .tree-entry .folder-action:focus-visible {
    background: var(--accent-surface);
    opacity: 1;
  }
  nav .empty-scripts {
    align-self: flex-start;
    padding: 5px 6px;
    margin-left: 18px;
    color: var(--accent-text);
    font-size: 11px;
    text-align: left;
    white-space: normal;
  }
  nav .empty-scripts:hover {
    background: var(--accent-subtle);
  }
  .tree-row {
    display: grid;
    grid-template-columns: 11px 15px minmax(0, 1fr) 6px;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    min-height: 26px;
    padding: 3px 5px;
    padding-left: calc(3px + min(var(--tree-depth), 5) * 10px);
    text-align: left;
    font-size: 12px;
    border-radius: 3px;
  }
  .tree-row.folder {
    font-weight: 600;
  }
  .tree-row.folder-selected {
    background: var(--accent-subtle, #303641);
  }
  .draft .draft-marker {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent-text);
  }
  .tree-row:hover {
    background: var(--accent-subtle, #303641);
  }
  .tree-row.opening {
    color: var(--accent-text);
    cursor: progress;
  }
  .tree-row[aria-current] {
    background: var(--accent-surface, #393f4b);
    box-shadow: inset 2px 0 var(--accent);
  }
  .tree-row:focus-visible {
    outline-offset: -2px;
  }
  .disclosure {
    width: 11px;
    flex: none;
    color: var(--script-secondary-text, #a3aab9);
  }
  .tree-icon {
    display: grid;
    place-items: center;
    color: var(--script-secondary-text, #83b8ce);
    font: 10px monospace;
  }
  .tree-icon.typescript {
    border-radius: 2px;
    background: var(--script-tab-selection, #2b4a65);
    color: var(--script-icon-text, #c6e4ff);
  }
  .tree-icon :global(svg) {
    width: 14px;
    height: 14px;
    color: var(--script-warning-text, #d6b77b);
  }
  input {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .explorer-status {
    margin: 0;
    padding: 6px 8px;
    font-size: 11px;
    color: var(--script-secondary-text, #b5bfce);
    overflow-wrap: anywhere;
  }
  .explorer-error {
    color: var(--script-warning-text, #f2c88b);
  }
  .file-bar {
    justify-content: space-between;
    gap: 6px;
    padding: 4px 8px;
    color: var(--script-secondary-text, #b5bfce);
    font-size: 11px;
  }
  .file-bar span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message {
    padding: 3px 8px;
    color: var(--script-warning-text, #f2c88b);
  }
</style>
