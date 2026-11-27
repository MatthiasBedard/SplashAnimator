<script lang="ts">
  import type { Layer } from '../../../packages/document/src';
  import InlineLayerName from './InlineLayerName.svelte';
  import LayerOptionIcon from './LayerOptionIcon.svelte';
  import { DEFAULT_LAYER_OUTLINE } from './layer-outline';
  let {
    layer,
    current,
    label = layer.name,
    icon = '▱',
    tween = '',
    renaming = false,
    name = layer.name,
    select,
    rename,
    commit,
    cancel,
    toggle,
  }: {
    layer: Layer;
    current: boolean;
    label?: string;
    icon?: string;
    tween?: string;
    renaming?: boolean;
    name?: string;
    select: () => void;
    rename: () => void;
    commit: (name: string, restore: boolean) => void;
    cancel: (restore: boolean) => void;
    toggle: (kind: 'outline' | 'visible' | 'locked') => void;
  } = $props();

  function renameKey(event: KeyboardEvent) {
    if (event.key !== 'F2' || event.defaultPrevented || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) rename();
  }
</script>

{#if renaming}<InlineLayerName {name} {commit} {cancel} />{:else}<button
    class="layer-name"
    aria-current={current || undefined}
    aria-keyshortcuts="F2"
    onkeydown={renameKey}
    ondblclick={rename}
    onclick={select}>{icon} <span>{label}</span></button
  >{/if}
{#if tween}<small aria-label={`${tween} layer`} title={tween}
    >{tween === 'Shape tween' ? 'S' : tween === 'Motion tween' ? 'M' : 'M/S'}</small
  >{/if}
<button
  class="layer-option"
  aria-label={`Toggle outline ${layer.name}`}
  title={layer.outline ? 'Show layer artwork' : 'Show layer outlines'}
  aria-pressed={layer.outline ?? false}
  style:color={layer.outlineColor ?? DEFAULT_LAYER_OUTLINE}
  onclick={() => toggle('outline')}
  ><LayerOptionIcon kind="outline" active={layer.outline ?? false} /></button
>
<button
  class="layer-option"
  aria-label={`Toggle visibility ${layer.name}`}
  aria-pressed={!layer.visible}
  title="Toggle visibility"
  onclick={() => toggle('visible')}><LayerOptionIcon kind="hide" active={layer.visible} /></button
>
<button
  class="layer-option"
  aria-label={`Toggle lock ${layer.name}`}
  aria-pressed={layer.locked}
  title="Toggle lock"
  onclick={() => toggle('locked')}><LayerOptionIcon kind="lock" active={layer.locked} /></button
>
