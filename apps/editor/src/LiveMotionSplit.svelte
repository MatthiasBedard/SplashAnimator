<script lang="ts">
  import { untrack } from 'svelte';
  import type { Project } from '../../../packages/document/src';
  let {
    snapshot,
    at,
    track,
    apply,
    close,
  }: {
    snapshot: Project;
    at: number;
    track: string;
    apply: (at: number, tracks: readonly string[], validate: () => void) => void;
    close: () => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, track, apply, close }));
  const available = original.snapshot.layers.filter(
    (l) => l.visible && !l.locked && l.liveMotionSpans?.length,
  );
  let requested = $state(original.at + 1),
    chosen = $state<string[]>(
      available.length
        ? [available.find((l) => l.id === original.track)?.id ?? available[0].id]
        : [],
    ),
    message = $state('Choose an interior frame and the live tracks to split.');
  let revision = 0,
    alive = true;
  const tracks = $derived(
    original.snapshot.layers.filter(
      (l) =>
        l.visible &&
        !l.locked &&
        l.liveMotionSpans?.some(
          (s) => requested - 1 - s.start >= 2 && s.end - (requested - 1) >= 2,
        ),
    ),
  );
  const valid = $derived(
    Number.isSafeInteger(requested) &&
      requested >= 1 &&
      requested <= original.snapshot.duration &&
      chosen.length > 0 &&
      chosen.every((id) => tracks.some((l) => l.id === id)),
  );
  function change() {
    revision++;
    message = 'Ready to insert a preserved key.';
  }
  function insert() {
    const input = requested,
      ids = [...chosen],
      owned = revision;
    const validate = () => {
      if (
        !alive ||
        revision !== owned ||
        !Object.is(input, requested) ||
        JSON.stringify(ids) !== JSON.stringify(chosen)
      )
        throw Error('Live split choices changed. Try again.');
    };
    try {
      validate();
      original.apply(input - 1, ids, validate);
    } catch (cause) {
      if (alive) message = String(cause);
    }
  }
  import { onDestroy } from 'svelte';
  onDestroy(() => {
    alive = false;
    revision++;
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      original.close();
    }
  }}
/>
<h2>Insert live tween key</h2>
<p>
  Insert an editable key and preserve the animation on both sides. Other keys and tween settings
  stay unchanged.
</p>
<label
  >Frame<input
    aria-label="Live split frame"
    type="number"
    min="1"
    max={original.snapshot.duration}
    step="1"
    value={requested}
    oninput={(event) => {
      requested = event.currentTarget.valueAsNumber;
      change();
    }}
  /></label
>
<fieldset>
  <legend>Live tracks</legend>
  {#each original.snapshot.layers.filter((l) => l.liveMotionSpans?.length) as layer}
    <label
      ><input
        type="checkbox"
        aria-label={`Split live track ${layer.name}`}
        checked={chosen.includes(layer.id)}
        disabled={!tracks.some((l) => l.id === layer.id) && !chosen.includes(layer.id)}
        onchange={(event) => {
          chosen = event.currentTarget.checked
            ? [...chosen, layer.id]
            : chosen.filter((id) => id !== layer.id);
          change();
        }}
      />{layer.name}</label
    >
  {/each}
</fieldset>
<p>
  Each side needs at least three frames. Splits that cannot preserve the original poses are
  rejected.
</p>
<button disabled={!valid} onclick={insert}>Insert preserved live key</button>
<p role="status">{message}</p>

<style>
  label {
    display: block;
    margin: 0.75rem 0;
  }
  fieldset {
    margin: 1rem 0;
  }
</style>
