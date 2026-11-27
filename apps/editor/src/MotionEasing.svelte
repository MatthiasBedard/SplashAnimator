<script lang="ts">
  import type { MotionEase, CubicMotionEase } from '../../../packages/animation/src/motion-frames';
  let { value = $bindable<MotionEase>('linear'), label = 'Motion easing', help = 'Changing these controls affects only the next generation.' }: {
    value?: MotionEase; label?: string; help?: string;
  } = $props();
  function choose(mode: string) {
    value = mode === 'custom'
      ? { kind: 'cubic', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
      : mode as MotionEase;
  }
  function control(key: 'x1' | 'y1' | 'x2' | 'y2', number: number) {
    if (typeof value === 'object') value = { ...value, [key]: number } as CubicMotionEase;
  }
</script>

<label>Easing<select aria-label={label} value={typeof value === 'object' ? 'custom' : value} onchange={(e) => choose(e.currentTarget.value)}>
  <option value="linear">Linear</option><option value="in">Ease in</option><option value="out">Ease out</option><option value="in-out">Ease in and out</option><option value="custom">Custom cubic curve</option>
</select></label>
{#if typeof value === 'object'}
  <fieldset>
    <legend>Custom easing controls</legend>
    {#each ['x1', 'y1', 'x2', 'y2'] as key}
      <label>{key.toUpperCase()}<input type="number" min="0" max="1" step="0.05" aria-label={`${label} ${key.toUpperCase()}`} value={value[key as 'x1' | 'y1' | 'x2' | 'y2']} oninput={(e) => control(key as 'x1' | 'y1' | 'x2' | 'y2', e.currentTarget.valueAsNumber)} /></label>
    {/each}
    <small>X controls time; Y controls progress. Values from 0 to 1 keep motion and opacity within the endpoints. {help}</small>
  </fieldset>
{/if}
