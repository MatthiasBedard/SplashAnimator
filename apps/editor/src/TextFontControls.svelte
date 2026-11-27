<script lang="ts">
  import { describeFontStack } from './font-catalog';
  import { discoverLocalFonts, fontCatalog } from './font-catalog.svelte';

  let { font, label = 'Custom font family', choiceLabel = 'Text font', disabled = false, embedded = [], change }: {
    font?: string;
    label?: string;
    choiceLabel?: string;
    disabled?: boolean;
    embedded?: readonly string[];
    change: (value: string) => void;
  } = $props();

  const presets = [
    ['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Monospace'],
  ] as const;
  const suggestions = $derived(fontCatalog.state === 'ready' ? fontCatalog.families : ['Arial', 'Georgia']);
  const choices = $derived([...presets.map(([name]) => name), ...embedded, ...suggestions]);
  const selected = $derived(choices.find(name => name.toLowerCase() === font?.trim().toLowerCase()) ?? '');
  const resolution = $derived(fontCatalog.state === 'ready' ? describeFontStack(font, [...embedded, ...fontCatalog.families]) : undefined);
</script>

<label class="property-line">
  Font family
  <input aria-label={label} placeholder="Mixed" value={font} {disabled}
    onchange={(event) => change(event.currentTarget.value.trim())} />
</label>
<label class="property-line">
  Choose font
  <select aria-label={choiceLabel} value={selected} {disabled}
    onchange={(event) => { if (event.currentTarget.value) change(event.currentTarget.value); }}>
    <option value="">Choose a family</option>
    <optgroup label="Generic families">
      {#each presets as [value, name] (value)}<option {value}>{name}</option>{/each}
    </optgroup>
    {#if embedded.length}
      <optgroup label="Embedded project fonts">
        {#each embedded as name (name)}<option value={name}>{name}</option>{/each}
      </optgroup>
    {/if}
    {#if suggestions.length}
      <optgroup label={fontCatalog.state === 'ready' ? 'Discovered families' : 'Common families'}>
        {#each suggestions as name (name)}<option value={name}>{name}</option>{/each}
      </optgroup>
    {/if}
  </select>
</label>
<button type="button" onclick={discoverLocalFonts} disabled={fontCatalog.state === 'loading'}>
  Discover installed fonts
</button>
{#if fontCatalog.state !== 'idle'}
  <small role="status" aria-label="Font availability">
    {#if fontCatalog.state === 'loading'}Checking installed fonts…
    {:else if fontCatalog.state === 'denied'}Font access was denied. Use a typed family list or a generic family.
    {:else if fontCatalog.state === 'unavailable'}Font discovery is unavailable on this host. Use a typed family list or a generic family.
    {:else if resolution?.missing.length}
      Unlisted fonts: {resolution.missing.join(', ')}.
      {#if resolution.matched}First matching family: {resolution.matched}.
      {:else}Rendering falls back to sans-serif.{/if}
    {:else}Discovered {fontCatalog.families.length} usable font families.
    {/if}
  </small>
{/if}
