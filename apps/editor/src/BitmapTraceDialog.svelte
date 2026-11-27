<script lang="ts">
  import { onDestroy } from 'svelte';
  import { BITMAP_TRACE_DETAILS, type BitmapTraceDetail } from '../../../packages/geometry/src/bitmap-trace';
  import type { BitmapTrace } from './bitmap-trace';

  let { prepare, apply, cancel }: {
    prepare: (detail: BitmapTraceDetail, signal: AbortSignal) => Promise<BitmapTrace>;
    apply: (trace: BitmapTrace) => void;
    cancel: () => void;
  } = $props();
  let detail = $state<BitmapTraceDetail>(256);
  let result = $state.raw<BitmapTrace | null>(null);
  let job = $state.raw<AbortController | null>(null);
  let failure = $state('');
  let canvas: HTMLCanvasElement | undefined = $state();

  function clear() {
    job?.abort();
    job = null;
    result = null;
    failure = '';
  }

  async function preview() {
    if (job) return;
    clear();
    const active = new AbortController();
    job = active;
    try {
      const prepared = await prepare(detail, active.signal);
      if (job === active) result = prepared;
    } catch (error) {
      if (job === active) failure = String(error);
    } finally {
      if (job === active) job = null;
    }
  }

  function publish() {
    if (!result || job) return;
    try { apply(result); }
    catch (error) { result = null; failure = String(error); }
  }

  $effect(() => {
    if (!canvas || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, result.width, result.height);
    for (const paint of result.paint) {
      ctx.fillStyle = paint.fill;
      ctx.globalAlpha = paint.opacity;
      ctx.beginPath();
      for (const ring of paint.contours) {
        ctx.moveTo(ring[0].x, ring[0].y);
        for (const point of ring.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  });
  onDestroy(() => job?.abort());
</script>

<h2>Trace bitmap</h2>
<p>Replace the placed bitmap with editable vectors. The original image stays in the Library.</p>
<label>Trace detail
  <select aria-label="Trace detail" bind:value={detail} onchange={clear}>
    {#each BITMAP_TRACE_DETAILS as size}<option value={size}>{size} pixels</option>{/each}
  </select>
</label>
{#if result}
  <canvas bind:this={canvas} width={result.width} height={result.height} aria-label="Bitmap trace preview"></canvas>
  <p>{result.paint.length} editable color {result.paint.length === 1 ? 'shape' : 'shapes'}</p>
{/if}
{#if failure}<p role="alert">{failure}</p>{/if}
<div class="trace-actions">
  <button type="button" aria-disabled={!!job} onclick={preview}>{job ? 'Tracing…' : 'Preview'}</button>
  <button type="button" disabled={!result || !!job} onclick={publish}>Apply</button>
  <button type="button" onclick={cancel}>Cancel</button>
</div>

<style>
  canvas { display: block; width: min(100%, 20rem); max-height: 45vh; object-fit: contain; margin-top: 0.75rem;
    background: repeating-conic-gradient(#d7dae0 0 25%, #f6f7f9 0 50%) 0 / 16px 16px; }
  .trace-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
</style>
