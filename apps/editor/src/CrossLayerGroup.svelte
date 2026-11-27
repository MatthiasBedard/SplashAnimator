<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Project } from '../../../packages/document/src';
  import { keyAt } from '../../../packages/document/src';
  import { multiFrameId } from '../../../packages/animation/src/multi-frame';
  import type { CrossLayerGroupCommand } from './cross-layer-group';
  import { crossLayerMaskTracks, currentLayerKeys } from './cross-layer-selection';
  import { focusDialogFooter, showFocusedDialog, wrapDialogTab } from './dialog-focus';
  let {
    project,
    frame,
    preferred,
    selection,
    maskedLayer,
    apply,
    cancel,
  }: {
    project: Project;
    frame: number;
    preferred: string;
    selection: string[];
    maskedLayer?: string;
    apply: (request: CrossLayerGroupCommand, admit: () => void) => Promise<void>;
    cancel: () => void;
  } = $props();
  const original = untrack(() => ({ project, frame, preferred, selection, maskedLayer, apply, cancel }));
  const protectedTracks = crossLayerMaskTracks(original.project);
  const layers = currentLayerKeys(original.project, original.frame)
    .map(({ layer }) => layer)
    .filter(layer => original.maskedLayer
      ? layer.id === original.maskedLayer
      : layer.drawingMode !== 'merge' && !protectedTracks.has(layer.id));
  let target = $state(
      original.maskedLayer ?? (layers.some((l) => l.id === original.preferred) ? original.preferred : '@new'),
    ),
    path = $state('[]'),
    message = $state(''),
    pending = $state(false);
  let revision = 0,
    alive = true,
    dialog: HTMLDialogElement;
  const groups = $derived.by(() => {
    const paths = new SvelteMap<string, string>([['[]', 'Layer root']]),
      layer = layers.find((l) => l.id === target);
    if (layer && !original.maskedLayer)
      for (const s of keyAt(layer, original.frame).shapes)
        for (let i = 1; i <= (s.groups?.length ?? 0); i++) {
          const p = s.groups!.slice(0, i);
          paths.set(JSON.stringify(p), p.join(' / '));
        }
    return [...paths].map(([value, label]) => ({ value, label }));
  });
  const bounds = original.project.layers.flatMap((layer) => {
    const key = keyAt(layer, original.frame);
    return key.shapes.some((s) =>
      original.selection.includes(multiFrameId(layer.id, key.frame, s.id)),
    )
      ? [
          {
            start: key.frame,
            end: layer.keys.find((k) => k.frame > key.frame)?.frame ?? original.project.duration,
          },
        ]
      : [];
  });
  const range = $derived.by(() => {
    const layer = layers.find((l) => l.id === target),
      key = layer ? keyAt(layer, original.frame) : undefined;
    return {
      start: Math.max(...bounds.map((b) => b.start), key?.frame ?? 0),
      end: Math.min(
        ...bounds.map((b) => b.end),
        layer
          ? (layer.keys.find((k) => k.frame > (key?.frame ?? 0))?.frame ??
              original.project.duration)
          : original.project.duration,
      ),
    };
  });
  async function submit() {
    if (pending) return;
    const input = revision,
      layer = target,
      group = path;
    const admit = () => {
      if (!alive || revision !== input || target !== layer || path !== group)
        throw Error('Group destination changed. Review the current destination and try again.');
    };
    pending = true;
    message = '';
    try {
      await original.apply(
        { kind: 'group', layer: layer === '@new' ? null : layer, groups: JSON.parse(group) },
        admit,
      );
    } catch (cause) {
      if (alive) message = String(cause);
    } finally {
      if (alive) {
        pending = false;
        await focusDialogFooter(dialog);
      }
    }
  }
  onDestroy(() => {
    alive = false;
    revision++;
  });
</script>

<dialog
  bind:this={dialog}
  use:showFocusedDialog={'select'}
  aria-label="Group artwork across layers"
  onkeydown={wrapDialogTab}
  oncancel={(e) => {
    e.preventDefault();
    if (!pending) original.cancel();
  }}
>
  <h2>Group artwork across layers</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <label
      >Destination layer<select
        aria-label="Group destination layer"
        value={target}
        oninput={(e) => {
          revision++;
          target = e.currentTarget.value;
          path = '[]';
        }}
        >{#if !original.maskedLayer}<option value="@new">New object layer</option>{/if}{#each layers as layer}<option
            value={layer.id}>{layer.name}</option
          >{/each}</select
      ></label
    >
    <label
      >Destination group<select
        aria-label="Group destination group"
        value={path}
        oninput={(e) => {
          revision++;
          path = e.currentTarget.value;
        }}
        >{#each groups as group}<option value={group.value}>{group.label}</option>{/each}</select
      ></label
    >
    {#if !original.maskedLayer}<p>
      Moves complete selected units into one group. Original coordinates and nested groups stay
      fixed. Moving into the destination stack can change overlaps with unselected artwork. Source
      and destination can have different keys. Groups frames {range.start + 1}–{range.end} only; boundary
      keys keep other exposures unchanged.
    </p>{/if}
    {#if message}<p role="alert">{message}</p>{/if}
    <footer>
      <button type="submit" disabled={pending}>Group selected artwork</button><button
        type="button"
        disabled={pending}
        onclick={original.cancel}>Cancel grouping</button
      >
    </footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(480px, 90vw);
    max-height: 90vh;
    background: #262833;
    color: #f0f0f5;
    border: 1px solid #626575;
    border-radius: 5px;
    padding: 20px;
  }
  dialog::backdrop {
    background: #0008;
  }
  h2 {
    font-size: 17px;
    margin: 0 0 16px;
  }
  label {
    display: grid;
    gap: 5px;
    margin: 10px 0;
  }
  select,
  button {
    background: #343744;
    color: inherit;
    border: 1px solid #626575;
    border-radius: 3px;
    padding: 7px;
  }
  p {
    font-size: 12px;
    line-height: 1.5;
    color: #b9bfce;
  }
  p[role='alert'] {
    color: #ffb4b4;
  }
  footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
</style>
