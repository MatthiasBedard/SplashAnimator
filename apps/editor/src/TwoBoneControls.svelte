<script lang="ts">
  import type { Vector } from '../../../packages/document/src';
  import type { BoneEdit, BoneSpanEdit } from '../../../packages/geometry/src/two-bone-ik';

  let { pair, disabled, apply }: {
    pair: Vector[];
    disabled: boolean;
    apply: (edit: BoneEdit | BoneSpanEdit) => void;
  } = $props();
  let x = $state<number>();
  let y = $state<number>();
  let bend = $state<1 | -1>(1);
  let firstFrame = $state<number>();
  let lastFrame = $state<number>();
  const bound = $derived(pair.some(shape => shape.bone));
  const artwork = $derived(pair.find(shape => !shape.bone && (shape.boneAttachment || bound)));
  const linked = $derived(bound && !artwork && pair[0].bone?.rigId === pair[1]?.bone?.rigId &&
    pair[0].bone?.role !== pair[1]?.bone?.role);
</script>

<fieldset class="bone-controls">
  <legend>Two-bone rig</legend>
  {#if artwork}
    {#if artwork.boneAttachment}
      <button {disabled} onclick={() => apply({ kind: 'detach' })}>Detach artwork</button>
    {:else}
      <button {disabled} onclick={() => apply({ kind: 'attach' })}>Attach artwork to bone</button>
    {/if}
  {:else if !bound}
    <button {disabled} onclick={() => apply({ kind: 'bind', rigId: crypto.randomUUID() })}
      title="The first-selected line is the root. The lines must share one endpoint.">Bind selected lines</button>
  {:else}
    {#if linked}
      <div class="property-grid">
        <label>Tip X<input type="number" step="any" aria-label="Bone tip X" bind:value={x} {disabled} /></label>
        <label>Tip Y<input type="number" step="any" aria-label="Bone tip Y" bind:value={y} {disabled} /></label>
      </div>
      <label>Elbow side<select bind:value={bend} {disabled}>
        <option value={1}>Right of target axis</option><option value={-1}>Left of target axis</option>
      </select></label>
      <button disabled={disabled || !Number.isFinite(x) || !Number.isFinite(y)}
        onclick={() => apply({ kind: 'pose', target: { x: x!, y: y! }, bend })}>Set bone pose</button>
      <details>
        <summary>In-between poses</summary>
        <div class="property-grid">
          <label>First pose frame<input type="number" min="1" step="1" bind:value={firstFrame} {disabled} /></label>
          <label>Last pose frame<input type="number" min="1" step="1" bind:value={lastFrame} {disabled} /></label>
        </div>
        <button disabled={disabled || !Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame)}
          onclick={() => apply({ kind: 'span', start: firstFrame! - 1, end: lastFrame! - 1 })}>Generate in-between poses</button>
      </details>
    {/if}
    <button {disabled} onclick={() => apply({ kind: 'remove' })}>Remove bone bindings</button>
  {/if}
</fieldset>

<style>
  .bone-controls { margin: 0.5rem 0; min-width: 0; }
</style>
