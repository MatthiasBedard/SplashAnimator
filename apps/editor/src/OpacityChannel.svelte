<script lang="ts">
  import NumberSlider from './NumberSlider.svelte';
  import type {
    OpacityKey,
    RootOpacityBinding,
  } from '../../../packages/document/src/opacity-bindings';

  let {
    frame,
    duration,
    opacity,
    binding,
    onapply,
  }: {
    frame: number;
    duration: number;
    opacity: number;
    binding?: RootOpacityBinding;
    onapply: (
      original: RootOpacityBinding | null,
      draft: Pick<RootOpacityBinding, 'start' | 'end' | 'keys'> | null,
    ) => void;
  } = $props();

  type Row = {
    frame: number;
    percent: number;
    ease: 'linear' | 'hold' | 'in' | 'out' | 'in-out' | 'custom';
    source?: OpacityKey;
  };
  let rows = $state<Row[]>([]);
  let start = $state(1),
    end = $state(1);
  let message = $state('');

  let original = $state.raw<RootOpacityBinding | null>(null);

  function open(existing?: RootOpacityBinding) {
    original = existing ? $state.snapshot(existing) : null;
    start = (original?.start ?? frame) + 1;
    end = original ? original.end + 1 : duration;
    rows = original
      ? original.keys.map((source) => ({
          frame: source.frame + 1,
          percent: source.opacity * 100,
          source,
          ease: typeof source.ease === 'object' ? 'custom' : (source.ease ?? 'linear'),
        }))
      : [{ frame: start, percent: opacity * 100, ease: 'linear' }];
    message = '';
  }

  function keyFromRow(row: Row): OpacityKey {
    const source = row.source;
    const value =
      source && row.percent === source.opacity * 100 ? source.opacity : row.percent / 100;
    const key: OpacityKey = { ...source, frame: row.frame - 1, opacity: value };
    if (row.ease !== 'custom' && (source?.ease !== undefined || !source || row.ease !== 'linear'))
      key.ease = row.ease;
    return key;
  }

  function apply(remove = false) {
    try {
      onapply(
        original,
        remove ? null : { start: start - 1, end: end - 1, keys: rows.map(keyFromRow) },
      );
      rows = [];
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

{#if !rows.length}
  <button onclick={() => open()}>Add opacity channel</button>
  {#if binding}<button onclick={() => open(binding)}>Edit opacity channel</button>{/if}
{:else}
  <section
    class="property-section"
    aria-label={original ? 'Edit opacity channel' : 'New opacity channel'}
  >
    <h3>Opacity channel</h3>
    <label>First frame<input type="number" min="1" max={duration} bind:value={start} /></label>
    <label>Last frame<input type="number" min="1" max={duration} bind:value={end} /></label>
    {#each rows as row, i}
      <fieldset>
        <legend>Opacity key {i + 1}</legend>
        <label>Frame<input type="number" min={start} max={end} bind:value={row.frame} /></label>
        <NumberSlider
          liveNumber
          label="Opacity (%)"
          value={row.percent}
          min={0}
          max={100}
          numberStep="any"
          emptyValue={NaN}
          scope={row}
          onchange={(value) => (row.percent = value)}
        />
        <label
          >Outgoing easing<select bind:value={row.ease}>
            {#if typeof row.source?.ease === 'object'}<option value="custom"
                >Saved custom curve</option
              >{/if}
            <option value="linear">Linear</option><option value="hold">Hold</option>
            <option value="in">Ease in</option><option value="out">Ease out</option>
            <option value="in-out">Ease in and out</option>
          </select></label
        >
        {#if rows.length > 1}<button onclick={() => rows.splice(i, 1)}>Remove key</button>{/if}
      </fieldset>
    {/each}
    <button
      disabled={!(rows[rows.length - 1].frame < end)}
      onclick={() =>
        rows.push({
          frame: rows[rows.length - 1].frame + 1,
          percent: rows[rows.length - 1].percent,
          ease: 'linear',
        })}>Add opacity key</button
    >
    {#if original}<button onclick={() => apply(true)}>Remove opacity channel</button>{/if}
    <button onclick={() => apply()}>Apply opacity channel</button>
    <button onclick={() => (rows = [])}>Cancel</button>
    {#if message}<p role="alert">{message}</p>{/if}
  </section>
{/if}
