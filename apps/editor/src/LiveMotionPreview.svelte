<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Project } from '../../../packages/document/src';
  import { prepareLiveMotionFrameCapture } from '../../../packages/animation/src/live-motion-presentation';
  import { exportPNGFrame } from './export-png';
  let { snapshot, at, validate }: { snapshot: Project; at: number; validate: () => void } =
    $props();
  const original = untrack(() => ({ snapshot, at, validate }));
  let requested = $state(original.at + 1),
    children = $state(false),
    url = $state(''),
    working = $state(false),
    shown = $state<number>(),
    message = $state('Choose a frame and render the live recipes.');
  let revision = 0,
    alive = true,
    controller: AbortController | undefined;
  let renderButton: HTMLButtonElement;
  let clearButton: HTMLButtonElement;
  function discard() {
    if (alive && document.activeElement === clearButton) renderButton.focus();
    revision++;
    controller?.abort();
    controller = undefined;
    working = false;
    shown = undefined;
    if (url) URL.revokeObjectURL(url);
    url = '';
  }
  function change() {
    discard();
    message = 'Ready to render. Artwork and history are unchanged.';
  }
  async function render() {
    discard();
    const job = new AbortController(),
      owned = revision,
      input = requested,
      rememberedChildren = children,
      frame = input - 1;
    controller = job;
    working = true;
    message = 'Preparing live preview…';
    let nextURL = '';
    const active = () => {
      job.signal.throwIfAborted();
      original.validate();
      if (
        !alive ||
        controller !== job ||
        revision !== owned ||
        !Object.is(requested, input) ||
        children !== rememberedChildren
      )
        throw Error('Live preview choices changed. Render again.');
      job.signal.throwIfAborted();
    };
    try {
      active();
      const view = await prepareLiveMotionFrameCapture(
        () => {
          active();
          return { project: original.snapshot, revision: 0 };
        },
        frame,
        { signal: job.signal, validate: active, rememberedChildren },
      );
      active();
      const blob = await exportPNGFrame(view, frame, job.signal);
      active();
      nextURL = URL.createObjectURL(blob);
      active();
      url = nextURL;
      nextURL = '';
      shown = frame;
      message = `Live pose at frame ${frame + 1}. Artwork and history are unchanged.`;
    } catch (cause) {
      if (alive && controller === job) {
        discard();
        message = String(cause);
      }
    } finally {
      if (nextURL) URL.revokeObjectURL(nextURL);
      if (controller === job) {
        controller = undefined;
        working = false;
      }
    }
  }
  onDestroy(() => {
    alive = false;
    discard();
  });
</script>

<h2>Preview live timeline</h2>
<p>
  Samples saved live recipes from their current endpoint keys. This preview is read-only; ordinary
  stage editing and saved keys stay unchanged. Scripts do not run and buttons use Up artwork.
</p>
<label
  >Preview frame<input
    aria-label="Live preview frame"
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
<label
  ><input
    aria-label="Evaluate remembered child timelines"
    type="checkbox"
    checked={children}
    onchange={(event) => {
      children = event.currentTarget.checked;
      change();
    }}
  />Evaluate remembered child timelines</label
>
<p>
  Unchecked uses their stored artwork. Other root tracks keep their stored poses in either mode.
</p>
<button bind:this={renderButton} onclick={render}>Render live pose</button>
<button
  bind:this={clearButton}
  disabled={!working && !url}
  onclick={() => {
    discard();
    message = 'Live preview cleared.';
  }}>Clear live preview</button
>
<p role="status">{message}</p>
{#if url}<figure>
    <figcaption>Live frame {shown! + 1} · unapplied</figcaption>
    <img src={url} alt="Live motion pose" draggable="false" />
  </figure>{/if}

<style>
  label {
    display: block;
    margin: 0.75rem 0;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 55vh;
    object-fit: contain;
  }
</style>
