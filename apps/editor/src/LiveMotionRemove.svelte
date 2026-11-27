<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import type { Project } from '../../../packages/document/src';
  import type { RemoveLiveMotionRequest } from '../../../packages/animation/src/live-motion';
  let {
    snapshot,
    at,
    track,
    apply,
  }: {
    snapshot: Project;
    at: number;
    track: string;
    apply: (requests: readonly RemoveLiveMotionRequest[], validate: () => void) => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, track, apply }));
  const records = original.snapshot.layers.flatMap((layer) =>
    (layer.liveMotionSpans ?? []).map((span) => ({
      layerId: layer.id,
      spanId: span.id,
      name: layer.name,
      start: span.start,
      end: span.end,
      enabled: layer.visible && !layer.locked,
    })),
  );
  const initial =
    records.find(
      (r) =>
        r.enabled && r.layerId === original.track && r.start <= original.at && r.end >= original.at,
    ) ??
    records.find((r) => r.enabled && r.layerId === original.track) ??
    records.find((r) => r.enabled);
  let chosen = $state<number[]>(initial ? [records.indexOf(initial)] : []);
  let message = $state('Choose the live tween records to remove.'),
    removing = $state(false);
  let revision = 0,
    alive = true;
  function remove() {
    if (removing) return;
    const owned = revision,
      stamp = JSON.stringify(chosen);
    const requests = chosen.map((i) => ({
      layerId: records[i].layerId,
      spanId: records[i].spanId,
    }));
    const validate = () => {
      if (!alive || revision !== owned || JSON.stringify(chosen) !== stamp)
        throw Error('Live tween removal choices changed. Try again.');
    };
    removing = true;
    try {
      validate();
      original.apply(requests, validate);
    } catch (cause) {
      if (alive) message = String(cause);
    } finally {
      removing = false;
    }
  }
  onDestroy(() => {
    alive = false;
    revision++;
  });
</script>

<h2>Remove live tween</h2>
<p>
  Remove selected tween recipes. Every authored key and its artwork stays unchanged. Interior frames
  return to their authored held poses; no keys are baked.
</p>
<fieldset>
  <legend>Existing live tweens</legend>
  {#each records as record, i}
    <label
      ><input
        type="checkbox"
        aria-label={`Remove live tween ${record.name} frames ${record.start + 1}–${record.end + 1}`}
        checked={chosen.includes(i)}
        disabled={!record.enabled}
        onchange={(e) => {
          chosen = e.currentTarget.checked ? [...chosen, i] : chosen.filter((n) => n !== i);
          revision++;
          message = 'Ready to remove. Authored artwork stays unchanged.';
        }}
      />{record.name}: frames {record.start + 1}–{record.end + 1}
      {#if !record.enabled}<small>Show and unlock this track before removing its tween.</small>{/if}
    </label>
  {/each}
</fieldset>
<p>
  Failing tween geometry can be removed without sampling it. Only the selected recipes are removed.
</p>
<button disabled={!chosen.length || removing} onclick={remove}>Remove live tween</button>
<p role="status">{message}</p>

<style>
  label {
    display: block;
    margin: 0.6rem 0;
  }
  fieldset {
    margin: 1rem 0;
  }
  small {
    display: block;
    font-size: 12px;
  }
</style>
