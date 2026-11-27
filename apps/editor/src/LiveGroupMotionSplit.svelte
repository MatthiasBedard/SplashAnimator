<script lang="ts">
  import { untrack } from 'svelte';
  import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
  import { prepareLiveMotionFrameCapture } from '../../../packages/animation/src/live-motion-presentation';
  import { exportPNGFrame } from './export-png';
  import type { Project } from '../../../packages/document/src';
  let {
    snapshot,
    at,
    track,
    apply,
    prepare,
    validate,
    close,
  }: {
    snapshot: Project;
    at: number;
    track: string;
    apply: (
      at: number,
      tracks: readonly string[],
      validate: () => void,
      originalClock?: boolean,
      recursiveClock?: boolean,
    ) => void;
    prepare: (
      at: number,
      tracks: readonly string[],
      validate: () => void,
      originalClock?: boolean,
      recursiveClock?: boolean,
    ) => Project;
    validate: () => void;
    close: () => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, track, apply, prepare, validate, close }));
  const available = original.snapshot.layers.filter(
    (l) =>
      l.visible && !l.locked && l.liveMotionSpans?.some((s) => s.rotation?.rigidGroups === true),
  );
  let requested = $state(original.at + 1),
    chosen = $state<string[]>(
      available.length
        ? [available.find((l) => l.id === original.track)?.id ?? available[0].id]
        : [],
    ),
    message = $state('Choose an interior frame and the live tracks to split.');
  let originalClock = $state(false);
  let policyRevision = 0;
  let recursiveClock = $state(false);
  let recursiveRevision = 0;
  let revision = 0,
    alive = true;
  const tracks = $derived(
    original.snapshot.layers.filter(
      (l) =>
        l.visible &&
        !l.locked &&
        l.liveMotionSpans?.some(
          (s) =>
            s.rotation?.rigidGroups === true &&
            requested - 1 - s.start >= 2 &&
            s.end - (requested - 1) >= 2,
        ),
    ),
  );
  const valid = $derived(
    !(originalClock && recursiveClock) &&
      Number.isSafeInteger(requested) &&
      requested >= 1 &&
      requested <= original.snapshot.duration &&
      chosen.length > 0 &&
      new Set(chosen).size === chosen.length &&
      chosen.every((id) => tracks.some((l) => l.id === id)),
  );
  function change() {
    revision++;
    discard();
    message =
      originalClock && recursiveClock
        ? 'Choose one distance timing option.'
        : 'Ready to insert a preserved key.';
  }
  function inputs() {
    // Capture policy before original source/history/private ownership reads.
    const continuation = recursiveClock,
      continuationPolicy = recursiveRevision,
      clock = originalClock,
      policy = policyRevision,
      input = requested,
      ids = [...chosen],
      owned = revision;
    const validate = () => {
      if (
        !alive ||
        !valid ||
        revision !== owned ||
        policyRevision !== policy ||
        originalClock !== clock ||
        recursiveClock !== continuation ||
        recursiveRevision !== continuationPolicy ||
        !Object.is(input, requested) ||
        JSON.stringify(ids) !== JSON.stringify(chosen)
      )
        throw Error('Live group split choices changed. Try again.');
      original.validate();
    };
    validate();
    return { at: input - 1, ids, validate, originalClock: clock, recursiveClock: continuation };
  }
  let children = $state(false),
    working = $state(false),
    url = $state('');
  let job: AbortController | undefined;
  function discard() {
    job?.abort();
    job = undefined;
    working = false;
    if (url) URL.revokeObjectURL(url);
    url = '';
  }
  function insert() {
    try {
      discard();
      const input = inputs();
      original.apply(
        input.at,
        input.ids,
        input.validate,
        input.originalClock,
        input.recursiveClock,
      );
    } catch (cause) {
      if (alive) message = String(cause);
    }
  }
  async function preview() {
    discard();
    const controller = new AbortController();
    job = controller;
    working = true;
    let next = '';
    try {
      const input = inputs(),
        rememberedChildren = children;
      const active = () => {
        controller.signal.throwIfAborted();
        input.validate();
        if (job !== controller || children !== rememberedChildren)
          throw Error('Group split preview changed.');
      };
      active();
      const candidate = original.prepare(
          input.at,
          input.ids,
          active,
          input.originalClock,
          input.recursiveClock,
        ),
        stamp = selectionTrajectoryStamp(candidate);
      const current = () => {
        active();
        if (selectionTrajectoryStamp(candidate) !== stamp)
          throw Error('Group split preview candidate changed.');
      };
      const view = await prepareLiveMotionFrameCapture(
        () => {
          current();
          return { project: candidate, revision: 0 };
        },
        input.at,
        { signal: controller.signal, validate: current, rememberedChildren },
      );
      current();
      const blob = await exportPNGFrame(view, input.at, controller.signal);
      current();
      next = URL.createObjectURL(blob);
      current();
      url = next;
      next = '';
      message = 'Preserved group split preview. Artwork and history are unchanged.';
    } catch (cause) {
      if (alive && job === controller) message = String(cause);
    } finally {
      if (next) URL.revokeObjectURL(next);
      if (job === controller) {
        job = undefined;
        working = false;
      }
    }
  }
  import { onDestroy } from 'svelte';
  onDestroy(() => {
    alive = false;
    revision++;
    discard();
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
<h2>Insert live group tween key</h2>
<p>
  Insert an editable key and preserve the animation on both sides. Other keys and tween settings
  stay unchanged. Each selected group track inserts its complete recipe artwork, including other
  groups and loose shapes.
</p>
<label
  >Frame<input
    aria-label="Live group split frame"
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
        aria-label={`Split live group track ${layer.name}`}
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
<label
  ><input
    aria-label="Keep original group distance timing"
    type="checkbox"
    checked={originalClock}
    onchange={(event) => {
      originalClock = event.currentTarget.checked;
      policyRevision++;
      change();
    }}
  />Keep original distance timing</label
>
<p>
  Keep the original distance timing as artwork moves and fades along independent curves. Unsupported or
  numerically uncertain splits are rejected; tween options stay unchanged.
</p>
<label
  ><input
    aria-label="Continue saved group distance timing"
    type="checkbox"
    checked={recursiveClock}
    onchange={(event) => {
      recursiveClock = event.currentTarget.checked;
      recursiveRevision++;
      change();
    }}
  />Continue saved distance timing</label
>
<p>
  Use this option when adding another key to a curve already split with original distance timing.
  Choose only one timing option.
</p>
<label
  ><input
    aria-label="Group split remembered children"
    type="checkbox"
    checked={children}
    onchange={(e) => {
      children = e.currentTarget.checked;
      change();
    }}
  />Evaluate remembered child timelines in preview</label
>
<button disabled={!valid || working} onclick={preview}>Preview preserved live group key</button>
{#if url}<img
    src={url}
    alt="Preserved live group split preview"
    style="max-width:100%;width:420px"
  />{/if}
<button disabled={!valid || working} onclick={insert}>Insert preserved live group key</button>
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
