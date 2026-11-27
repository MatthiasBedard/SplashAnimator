<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { createMaskPreviewSession, type MaskSessionFrame } from './mask-preview-session';
  import type { Project } from '../../../packages/document/src';
  import { captureLayerMasks } from '../../../packages/document/src/layer-masks';
  import {
    prepareLayerScene,
    disposeLayerScene,
    type PreparedLayerScene,
  } from '../../../packages/animation/src/layer-scene';
  import { evaluateLayers } from '../../../packages/animation/src';
  import { rootButtons, rootButtonProject } from '../../../packages/animation/src/button-preview';
  import { createStageOpacityView } from '../../../packages/animation/src/stage-opacity';
  import { admitMaskRaster } from '../../../packages/stage/src/mask-budget';
  import {
    createMaskResourceBank,
    type MaskResourceBank,
  } from '../../../packages/stage/src/mask-resources';
  import {
    prepareMaskedLayerPainter,
    type MaskedLayerPainter,
  } from '../../../packages/stage/src/masked-layers';

  let { snapshot, at, validate }: { snapshot: Project; at: number; validate: () => void } =
    $props();
  let source = $state(''),
    first = $state(''),
    message = $state('Choose a source and the first layer in its target run.'),
    working = $state(false),
    shown = $state(false),
    stepping = $state(false),
    playing = $state(false);
  let playbackRevision = 0;
  let playbackTimer: ReturnType<typeof setTimeout> | undefined;
  function stopPlayback() {
    playbackRevision++;
    if (playbackTimer !== undefined) clearTimeout(playbackTimer);
    playbackTimer = undefined;
    playing = false;
  }
  function playbackActive(epoch: number) {
    return alive && stepping && playing && playbackRevision === epoch;
  }
  function pausePlayback() {
    stopPlayback();
    if (working) discard();
    message = 'Mask playback paused. The sampled tick is retained; Render or Play retries it.';
  }
  async function advancePlayback(epoch: number, action: 'current' | 'step') {
    if (!playbackActive(epoch)) return;
    const started = performance.now();
    const ready = await renderPreview(action, epoch);
    if (!playbackActive(epoch)) return;
    if (!ready) {
      stopPlayback();
      return;
    }
    const interval = 1000 / snapshot.fps,
      elapsed = performance.now() - started;
    // One completed job schedules at most one successor. A missed interval
    // starts a new cadence instead of queueing skipped/catch-up clock phases.
    const timer = setTimeout(
      () => {
        if (!playbackActive(epoch) || playbackTimer !== timer) return;
        playbackTimer = undefined;
        void advancePlayback(epoch, 'step');
      },
      elapsed >= interval ? interval : interval - elapsed,
    );
    playbackTimer = timer;
    if (!playbackActive(epoch)) {
      clearTimeout(timer);
      if (playbackTimer === timer) playbackTimer = undefined;
    }
  }
  function startPlayback() {
    stopPlayback();
    if (!alive || !stepping || !source || !first) return;
    playing = true;
    void advancePlayback(playbackRevision, 'current');
  }
  let session: ReturnType<typeof createMaskPreviewSession> | undefined;
  let phase = $state.raw<MaskSessionFrame>();
  let sessionRevision = 0;
  let surface: HTMLDivElement;
  let canvas: HTMLCanvasElement | undefined;
  let revision = 0,
    alive = true,
    controller: AbortController | undefined;
  let scene: PreparedLayerScene | undefined, painter: MaskedLayerPainter | undefined;
  let resources = $state.raw<MaskResourceBank>();
  let resourceRevision = 0;
  // The source lifetime outlives individual jobs, choices and presentation ticks.
  // A cancelled frame releases its lease without invalidating ready resources.
  const validateSource = untrack(() => validate);
  function releaseResources() {
    resourceRevision++;
    resources?.dispose();
    resources = undefined;
  }
  function resourceBank() {
    if (resources && !resources.disposed) return resources;
    const epoch = resourceRevision;
    const current = () => {
      validateSource();
      if (!alive || resourceRevision !== epoch)
        throw Error('Mask preview resources were cleared. Render again.');
    };
    const prepared = createMaskResourceBank(snapshot, { validate: current });
    try {
      current();
      resources = prepared;
      return prepared;
    } catch (cause) {
      prepared.dispose();
      throw cause;
    }
  }
  const index = $derived(snapshot.layers.findIndex((layer) => layer.id === source));
  const targets = $derived.by(() => {
    if (index < 1) return [];
    let start = index;
    while (start > 0 && snapshot.layers[start - 1].folderId === snapshot.layers[index].folderId)
      start--;
    return snapshot.layers.slice(start, index);
  });
  function discard() {
    revision++;
    controller?.abort();
    controller = undefined;
    painter?.dispose();
    painter = undefined;
    if (scene) disposeLayerScene(scene);
    scene = undefined;
    working = false;
    shown = false;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      canvas = undefined;
    }
  }
  function chooseSource(value: string) {
    stopPlayback();
    discard();
    source = value;
    first = '';
    message =
      'Choose the first target layer. All layers through the one below the source are included.';
  }
  function chooseFirst(value: string) {
    stopPlayback();
    discard();
    first = value;
    message = 'Ready to render. These choices are temporary.';
  }
  function chooseStepping(value: boolean) {
    stopPlayback();
    discard();
    sessionRevision++;
    session?.dispose();
    session = undefined;
    phase = undefined;
    stepping = value;
    message = value
      ? 'A fresh session starts at the editor frame. Step advances one tick; Render retries the current tick.'
      : 'Fixed-frame preview restored. Movie poses stay at their start.';
  }
  async function renderPreview(
    action: 'current' | 'step' | 'restart' = 'current',
    playback?: number,
  ): Promise<boolean> {
    if (playback === undefined) stopPlayback();
    else if (!playbackActive(playback)) return false;
    discard();
    const job = new AbortController(),
      owned = revision,
      sourceId = source,
      firstId = first,
      mode = stepping;
    let owner = session,
      ownedPhase = phase;
    controller = job;
    working = true;
    message = 'Preparing mask preview…';
    let nextScene: PreparedLayerScene | undefined,
      nextPainter: MaskedLayerPainter | undefined,
      output: HTMLCanvasElement | undefined;
    const active = () => {
      job.signal.throwIfAborted();
      validate();
      if (
        !alive ||
        (playback !== undefined && !playbackActive(playback)) ||
        controller !== job ||
        revision !== owned ||
        source !== sourceId ||
        first !== firstId ||
        stepping !== mode ||
        session !== owner ||
        phase !== ownedPhase
      )
        throw Error('Mask preview choices changed. Render again.');
    };
    try {
      active();
      // Reject oversized views before allocating any display/backing canvas.
      admitMaskRaster(snapshot.width, snapshot.height);
      const start = snapshot.layers.findIndex((layer) => layer.id === firstId),
        end = snapshot.layers.findIndex((layer) => layer.id === sourceId);
      if (start < 0 || end <= start) throw Error('Choose a source above a nonempty target run.');
      const masks = captureLayerMasks(snapshot.layers, [
        {
          maskLayerId: sourceId,
          layerIds: snapshot.layers.slice(start, end).map((layer) => layer.id),
        },
      ]);
      active();
      if (mode) {
        if (!owner) {
          const epoch = sessionRevision;
          const prepared = createMaskPreviewSession(snapshot, at, {
            validate: () => {
              validate();
              if (!alive || sessionRevision !== epoch)
                throw Error('Mask presentation session changed.');
            },
          });
          try {
            active();
            session = owner = prepared;
          } catch (cause) {
            prepared.dispose();
            throw cause;
          }
        }
        const next =
          action === 'step'
            ? owner.step()
            : action === 'restart'
              ? owner.restart()
              : owner.current();
        // Valid synchronous clock work survives a mask-choice cancellation;
        // reflect its actual phase without publishing the cancelled raster.
        if (alive && session === owner && stepping === mode) phase = ownedPhase = next;
        active();
      }
      const presentedFrame = mode ? ownedPhase!.frame : at;
      nextScene = prepareLayerScene(
        snapshot,
        presentedFrame,
        masks,
        (plain, frame) => {
          if (mode)
            return ownedPhase!.presentation.layers.map((layer) => ({
              layerId: layer.layerId,
              shapes: structuredClone([...layer.shapes]),
            }));
          const opacity = createStageOpacityView(plain)(frame);
          return evaluateLayers(
            rootButtonProject(opacity, frame, rootButtons(opacity, frame), null, null),
            frame,
          );
        },
        { validate: active },
      );
      const bank = resourceBank();
      active();
      nextPainter = await prepareMaskedLayerPainter(nextScene, {
        signal: job.signal,
        resources: bank,
      });
      active();
      output = document.createElement('canvas');
      output.width = snapshot.width;
      output.height = snapshot.height;
      const ctx = output.getContext('2d')!;
      nextPainter.paint(ctx, active);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = snapshot.background;
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.globalCompositeOperation = 'source-over';
      active();
      // The complete detached raster is admitted before the visible canvas changes.
      output.setAttribute('aria-label', 'Layer mask preview');
      output.style.cssText = 'display:block;max-width:100%;max-height:55vh;object-fit:contain';
      active();
      // Svelte owns the empty host only; this lifetime owns its complete raster child.
      // eslint-disable-next-line svelte/no-dom-manipulating
      surface.replaceChildren(output);
      canvas = output;
      output = undefined;
      scene = nextScene;
      nextScene = undefined;
      painter = nextPainter;
      nextPainter = undefined;
      shown = true;
      message = mode
        ? `Mask preview ready at tick ${ownedPhase!.tick}. Artwork and history are unchanged.`
        : 'Mask preview ready. Artwork and history are unchanged.';
      return true;
    } catch (cause) {
      if (alive && controller === job) {
        discard();
        message = String(cause);
      }
      return false;
    } finally {
      nextPainter?.dispose();
      if (nextScene) disposeLayerScene(nextScene);
      if (output) {
        output.width = 0;
        output.height = 0;
      }
      if (controller === job) working = false;
    }
  }
  onMount(() => {
    const visibility = () => {
      if (document.hidden && playing) pausePlayback();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  });
  onDestroy(() => {
    stopPlayback();
    alive = false;
    discard();
    releaseResources();
    sessionRevision++;
    session?.dispose();
    session = undefined;
    phase = undefined;
  });
</script>

<h2>Preview layer mask</h2>
<p>
  Temporary alpha mask at frame {at + 1}. Targets run up to the layer directly below the source.
  Buttons use Up artwork. Fixed mode keeps movie starting poses; stepped mode uses a fresh
  independent session. No scripts run.
</p>
<label
  >Mask source layer <select
    aria-label="Mask source layer"
    value={source}
    onchange={(e) => chooseSource(e.currentTarget.value)}
    ><option value="">Choose source…</option>{#each snapshot.layers as layer, i}{#if i > 0}<option
          value={layer.id}>{layer.name}{layer.visible ? '' : ' (hidden)'}</option
        >{/if}{/each}</select
  ></label
>
<label
  >First mask target layer <select
    aria-label="First mask target layer"
    value={first}
    onchange={(e) => chooseFirst(e.currentTarget.value)}
    disabled={!source}
    ><option value="">Choose first target…</option>{#each targets as layer}<option value={layer.id}
        >{layer.name}{layer.visible ? '' : ' (hidden)'}</option
      >{/each}</select
  ></label
>
<p>All target layers are in the source’s folder. A hidden or empty source hides its targets.</p>
<label
  ><input
    type="checkbox"
    aria-label="Use stepped mask session"
    checked={stepping}
    onchange={(e) => chooseStepping(e.currentTarget.checked)}
  />Use stepped mask session</label
>
{#if stepping}
  <p>
    Render retries the current tick. Clear and layer choices keep its clocks; Restart starts this
    session again. Playback follows the project frame rate when ready; slow frames wait without
    skipping ticks. Hiding the tab pauses playback.
  </p>
  <output aria-label="Mask presentation tick"
    >Tick {phase?.tick ?? 0} · Frame {(phase?.frame ?? at) + 1} · {(phase?.seconds ?? 0).toFixed(3)} s</output
  >
  <button disabled={!source || !first} onclick={() => (playing ? pausePlayback() : startPlayback())}
    >{playing ? 'Pause mask playback' : 'Play mask preview'}</button
  >
  <button disabled={!source || !first} onclick={() => renderPreview('step')}
    >Step mask presentation</button
  >
  <button disabled={!source || !first} onclick={() => renderPreview('restart')}
    >Restart mask session</button
  >
{/if}
<button disabled={!source || !first} onclick={() => renderPreview()}
  >{working ? 'Restart mask preview' : 'Render mask preview'}</button
>
<button
  disabled={!working && !shown && !resources}
  onclick={() => {
    stopPlayback();
    discard();
    releaseResources();
    message = 'Preview cleared. Choose layers and render again.';
  }}>Clear mask preview</button
>
<p role="status">{message}</p>
<div bind:this={surface} class:shown></div>

<style>
  label {
    display: block;
    margin: 0.6rem 0;
  }
  select {
    max-width: 100%;
  }
  div {
    display: none;
  }
  div.shown {
    display: block;
  }
</style>
