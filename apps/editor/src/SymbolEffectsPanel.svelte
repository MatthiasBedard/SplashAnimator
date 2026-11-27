<script lang="ts">
  import type { Vector } from '@splash/document';
  import { SYMBOL_EFFECTS, type SymbolEffectPatch } from '../../../packages/document/src/symbol-effects';
  import { blendModes, isBlendMode } from '../../../packages/document/src/blend-modes';
  import NumberSlider from './NumberSlider.svelte';
  import TintControls from './TintControls.svelte';

  let { instance, button, disabled, scope, onchange }: {
    instance: Vector; button: boolean; disabled: boolean; scope: unknown;
    onchange: (patch: SymbolEffectPatch, label: string) => void;
  } = $props();
  const supported = $derived(SYMBOL_EFFECTS.filter(effect => !button || 'buttons' in effect));
  const applied = $derived(supported.filter(effect => instance[effect.field] !== undefined));
  const available = $derived(supported.filter(effect => instance[effect.field] === undefined));

  function add(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const effect = available.find(effect => effect.id === select.value);
    select.value = '';
    if (effect && !disabled) onchange({ [effect.field]: structuredClone(effect.initial) }, `Add ${effect.label.toLowerCase()} effect`);
  }
</script>

<label class="property-line">Add effect
  <select aria-label="Add effect" value="" disabled={disabled || !available.length} onchange={add}>
    <option value="" disabled>{available.length ? 'Choose an effect' : 'All effects added'}</option>
    {#each available as effect (effect.id)}
      <option value={effect.id}>{effect.label}</option>
    {/each}
  </select>
</label>
{#each applied as effect (effect.id)}
  <section class="effect" aria-label={effect.label + ' effect'}>
    <header>
      <strong>{effect.label}</strong>
      <button type="button" aria-label={`Remove ${effect.label.toLowerCase()} effect`}
        {disabled} onclick={() => onchange({ [effect.field]: undefined }, `Remove ${effect.label.toLowerCase()} effect`)}>×</button>
    </header>
    {#if effect.id === 'opacity'}
      <NumberSlider label="Object opacity" caption="Opacity (%)" value={(instance.opacity ?? 1) * 100}
        min={0} max={100} {disabled} {scope} onchange={value => {
          if (Number.isFinite(value) && value >= 0 && value <= 100)
            onchange({ opacity: value / 100 }, 'Change symbol opacity');
        }}/>
    {:else if effect.id === 'tint'}
      <TintControls label="Instance" tint={instance.instanceTint} {disabled} {scope} reset={false}
        onchange={patch => {
          if (patch && instance.instanceTint)
            onchange({ instanceTint: { ...instance.instanceTint, ...patch } }, 'Change instance tint');
        }}/>
    {:else if effect.id === 'blur'}
      <NumberSlider label={instance.symbolPlayback?.mode === 'movie' ? 'Movie clip blur radius' : 'Graphic blur radius'}
        caption="Radius (px)" value={instance.instanceBlur ?? 0} min={0} max={32} {disabled} {scope}
        onchange={value => {
          if (Number.isInteger(value) && value >= 0 && value <= 32)
            onchange({ instanceBlur: value || undefined }, 'Change instance blur');
        }}/>
    {:else if effect.id === 'blend'}
      <label class="property-line">Mode
        <select aria-label="Instance blend mode" value={instance.instanceBlend ?? 'normal'} {disabled}
          onchange={event => {
            const value = event.currentTarget.value;
            if (value === 'normal' || isBlendMode(value))
              onchange({ instanceBlend: value === 'normal' ? undefined : value }, 'Change instance blend mode');
          }}>
          <option value="normal">Normal</option>
          {#each blendModes as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
    {/if}
  </section>
{/each}

<style>
  select { max-width: 100%; min-width: 0; }
  .effect { border-top: 1px solid var(--line); padding-block: 8px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  header button { min-width: 24px; padding: 0 5px; }
</style>
