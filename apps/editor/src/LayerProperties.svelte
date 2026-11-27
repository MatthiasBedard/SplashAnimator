<script lang="ts">
  import { untrack } from 'svelte';
  import type { Layer } from '../../../packages/document/src';
  import { DEFAULT_LAYER_OUTLINE } from './layer-outline';
  let {
    layer,
    apply,
    cancel,
    mask = false,
    allowMask = true,
    allowGuide = false,
  }: {
    layer: Layer;
    mask?: boolean;
    allowMask?: boolean;
    allowGuide?: boolean;
    apply: (
      values: {
        mask: boolean;
        guide: boolean;
        name: string;
        visible: boolean;
        locked: boolean;
        outline: boolean;
        outlineColor: string;
      },
      admit?: () => void,
    ) => void;
    cancel: () => void;
  } = $props();
  let revision = 0;
  const original = untrack(() => layer);
  let role = $state<boolean | 'guide'>(untrack(() => original.guideLayer ? 'guide' : mask));
  let name = $state(original.name),
    visible = $state(original.visible),
    locked = $state(original.locked);
  let outline = $state(original.outline ?? false),
    outlineColor = $state(original.outlineColor ?? DEFAULT_LAYER_OUTLINE);
</script>

<h2>Layer properties</h2>
<form
  oninput={() => revision++}
  onchange={() => revision++}
  onsubmit={(e) => {
    e.preventDefault();
    const at = revision;
    const input = JSON.stringify([name, visible, locked, outline, outlineColor, role]);
    apply({ name, visible, locked, outline, outlineColor, mask: role === true, guide: role === 'guide' }, () => {
      if (
        revision !== at ||
        JSON.stringify([name, visible, locked, outline, outlineColor, role]) !== input
      )
        throw Error('Layer properties input changed during preparation.');
    });
  }}
>
  <label
    >Type<select aria-label="Layer properties type" bind:value={role}
      ><option value={false}>Normal</option>{#if allowMask}<option value={true}>Mask</option
        >{/if}{#if allowGuide}<option value="guide">Guide</option>{/if}</select
    ></label
  >
  {#if role === true}<p>
      Drag other timeline layers onto this mask or its indented rows to include them in the masked
      group.
    </p>{/if}
  <label>Name<input aria-label="Layer properties name" maxlength="80" bind:value={name} /></label>
  <label
    ><input
      type="checkbox"
      aria-label="Layer properties visible"
      bind:checked={visible}
    />Visible</label
  >
  <label
    ><input
      type="checkbox"
      aria-label="Layer properties locked"
      bind:checked={locked}
    />Locked</label
  >
  <label
    ><input type="checkbox" aria-label="Layer properties outline" bind:checked={outline} />Show
    outlines only</label
  >
  <label
    >Outline color<input
      type="color"
      aria-label="Layer outline color"
      bind:value={outlineColor}
    /></label
  >
  <p>
    Outline mode changes the editing view. Published artwork and exports keep their original colors.
  </p>
  <button type="submit">Apply layer properties</button>
  <button type="button" onclick={cancel}>Cancel</button>
</form>

<style>
  label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.8rem 0;
  }
  input:not([type='checkbox']) {
    margin-left: auto;
  }
  p {
    max-width: 28rem;
  }
  button {
    margin: 0.4rem;
  }
</style>
