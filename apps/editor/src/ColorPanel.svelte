<script lang="ts">
  import { loadSwatches, normalizeSwatch, STARTER_SWATCHES, SWATCH_KEY, type ColorTarget } from './color-swatches';

  let { targets, scope, projectColors }: {
    targets: ColorTarget[];
    scope: string;
    projectColors: () => string[];
  } = $props();
  let palette = $state(loadSwatches(localStorage));
  let choice = $state('');
  let editing = $state(false);
  let slot = $state(0);
  let projectOpen = $state(false);
  let search = $state('');
  let visibleCount = $state(64);
  const target = $derived(targets.find(item => item.id === choice) ?? targets[0]);
  const targetColor = $derived(normalizeSwatch(target.color) ?? '#000000');
  const current = $derived(editing ? palette[slot] ?? targetColor : targetColor);
  const projectPalette = $derived(projectOpen ? projectColors() : []);
  const hits = $derived(projectPalette.filter(color => color.includes(search.trim().toLowerCase())));
  let invalid = $state(false);

  function save(next: string[]) {
    palette = next;
    try { localStorage.setItem(SWATCH_KEY, JSON.stringify(next)); }
    catch { /* Keep session swatches available when storage is unavailable. */ }
  }
  function apply(raw: string) {
    const color = normalizeSwatch(raw);
    invalid = !color;
    if (!color || color === current) return;
    if (!editing) { target.apply?.(color); return; }
    const replaced = palette.length ? palette.map((item, index) => index === slot ? color : item) : [color];
    const next = [...new Set(replaced)];
    save(next);
    slot = next.indexOf(color);
  }
</script>

<div class="color-panel" role="group" aria-label="Color controls">
  <label class="target">Edit color for
    <select aria-label="Color target" value={target.id} disabled={editing} onchange={event => {
      choice = event.currentTarget.value;
      invalid = false;
    }}>
      {#each targets as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
    </select>
  </label>
  {#key `${scope}/${target.id}/${editing}/${slot}/${current}`}
    <div class="color-entry">
      <input type="color" aria-label={editing ? 'Palette swatch color' : 'Paint color'} value={current}
        disabled={!editing && !target.apply} onchange={event => apply(event.currentTarget.value)} />
      <label>Hex
        <input type="text" aria-label={editing ? 'Palette swatch hex' : 'Paint hex'} value={current.toUpperCase()}
          disabled={!editing && !target.apply} spellcheck="false" maxlength="7"
          oninput={() => invalid = false} onkeydown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          onchange={event => { apply(event.currentTarget.value); }} />
      </label>
    </div>
  {/key}
  {#if invalid}<p class="color-error" role="status">Enter a hex color such as #2389ED.</p>{/if}

  <div class="swatch-header">
    <span>Palette</span>
    <button type="button" aria-pressed={editing} onclick={() => { editing = !editing; invalid = false; }}>
      {editing ? 'Done editing' : 'Edit swatches'}
    </button>
  </div>
  <div class="swatches" role="group" aria-label="Palette swatches">
    {#each palette as color, index (color)}
      <button type="button" class="swatch" style:--swatch={color} title={color.toUpperCase()}
        aria-label={`Palette ${color.toUpperCase()}`} aria-pressed={editing ? slot === index : current === color}
        disabled={!editing && !target.apply} onclick={() => { if (editing) { slot = index; invalid = false; } else apply(color); }}></button>
    {/each}
  </div>
  <div class="palette-actions">
    {#if editing}
      <button type="button" disabled={!palette.length} onclick={() => {
        save(palette.filter((_, index) => index !== slot));
        slot = Math.max(0, Math.min(slot, palette.length - 1));
      }}>Remove swatch</button>
      <button type="button" onclick={() => { save([...STARTER_SWATCHES]); slot = 0; }}>Reset palette</button>
    {:else}
      <button type="button" disabled={palette.includes(current)} onclick={() => save([...palette, current])}>Add current color</button>
    {/if}
  </div>

  <details ontoggle={event => projectOpen = event.currentTarget.open}>
    <summary>Project colors</summary>
    {#if projectOpen}
      <input type="search" aria-label="Search project colors" placeholder="Search hex colors" bind:value={search}
        oninput={() => visibleCount = 64} />
      <div class="swatches" role="group" aria-label="Project swatches">
        {#each hits.slice(0, visibleCount) as color (color)}
          <button type="button" class="swatch" style:--swatch={color} title={color.toUpperCase()}
            aria-label={`Project ${color.toUpperCase()}`} aria-pressed={current === color}
            disabled={!editing && !target.apply} onclick={() => apply(color)}></button>
        {:else}<p class="color-error">{search ? 'No matching colors.' : 'No project colors yet.'}</p>{/each}
      </div>
      {#if hits.length > visibleCount}<button type="button" onclick={() => visibleCount += 64}>Show more colors</button>{/if}
    {/if}
  </details>
</div>

<style>
  .color-panel, .target { display: grid; gap: .4rem; min-width: 0; }
  .color-panel label { min-width: 0; }
  .target select, input[type='search'] { width: 100%; min-width: 0; }
  .color-entry { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr); gap: .55rem; align-items: end; }
  .color-entry label { display: grid; gap: .2rem; }
  .color-entry input { min-width: 0; width: 100%; height: 1.8rem; }
  .color-entry input[type='text'] { font-family: ui-monospace, monospace; }
  .swatch-header, .palette-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
  .swatch-header { justify-content: space-between; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(19px, 1fr)); gap: 4px; }
  button.swatch { min-width: 0; aspect-ratio: 1.16; padding: 0; border: 1px solid #8888; border-radius: 2px; background: var(--swatch); }
  button.swatch:hover:not(:disabled) { background: var(--swatch); border-color: #fff; }
  button.swatch[aria-pressed='true'] { outline: 1px solid currentColor; outline-offset: 1px; }
  button.swatch:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  details > :not(summary) { margin-top: .4rem; }
  .color-error { margin: 0; grid-column: 1 / -1; }
</style>
