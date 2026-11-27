<script lang="ts">
  import { getContext, untrack, type Snippet } from 'svelte';
  import { PANEL_CONTEXT, type PanelRegistry } from './panel-registry.svelte';
  import type { PanelId } from './panel-layout';
  let {
    id,
    heading,
    blocked = false,
    children,
  }: { id: PanelId; heading: string; blocked?: boolean; children: Snippet } = $props();
  const registry = getContext<PanelRegistry>(PANEL_CONTEXT);
  $effect(() => {
    const panel = { id, heading, blocked, children };
    return untrack(() => registry.register(panel));
  });
</script>
