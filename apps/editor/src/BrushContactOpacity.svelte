<script lang="ts">
  let {
    available,
    alongAvailable,
    enabled = $bindable(false),
    along = $bindable(false),
    minimum = $bindable(10),
    response = $bindable(1),
  }: { available: boolean; alongAvailable: boolean; enabled?: boolean; along?: boolean; minimum?: number; response?: number } = $props();
</script>

<label title="For separate brush objects in Normal or Behind mode. Initial pen pressure sets the opacity of the whole stroke.">
  <input type="checkbox" aria-label="Initial pen pressure controls opacity" checked={enabled} disabled={!available}
    onchange={e => { enabled = e.currentTarget.checked; if (enabled) along = false; }} />
  Initial pen pressure controls opacity
</label>
<label title="Vary opacity continuously for separate Brush objects in Normal or Behind mode, with a fixed nib.">
  <input type="checkbox" aria-label="Pen pressure varies opacity while drawing" checked={along} disabled={!alongAvailable}
    onchange={e => { along = e.currentTarget.checked; if (along) enabled = false; }} />
  Pen pressure varies opacity while drawing
</label>
{#if enabled && available || along && alongAvailable}
  <label>Minimum opacity %<input
    aria-label="Minimum pressure opacity"
    type="number" min="0" max="100" step="1" bind:value={minimum}
  /></label>
  <label>Opacity response<input
    aria-label="Pressure opacity response"
    type="number" min="0.25" max="4" step="0.25" bind:value={response}
  /></label>
{/if}
