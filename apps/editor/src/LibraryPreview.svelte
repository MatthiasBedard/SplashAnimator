<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Project, SymbolDefinition } from '../../../packages/document/src';
  import { symbolInstance } from '../../../packages/geometry/src/symbols';
  import { expandSymbols } from '../../../packages/geometry/src/symbols';
  import { objectBounds } from '../../../packages/geometry/src';
  import { drawShape } from '../../../packages/stage/src';
  let {
    symbol,
    assets,
    symbols,
  }: { symbol: SymbolDefinition; assets: Project['assets']; symbols: Project['symbols'] } =
    $props();
  let canvas: HTMLCanvasElement,
    alive = true;
  let unavailable = $state(false);
  onDestroy(() => (alive = false));
  function paint() {
    if (!canvas || !alive) return;
    const ctx = canvas.getContext('2d')!;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      const art = expandSymbols({ symbols }, [symbolInstance(symbol, 0, 0)], 0),
        bounds = art.map(objectBounds);
      const left = Math.min(0, ...bounds.map((b) => b.left)),
        top = Math.min(0, ...bounds.map((b) => b.top));
      const right = Math.max(symbol.width, ...bounds.map((b) => b.right)),
        bottom = Math.max(symbol.height, ...bounds.map((b) => b.bottom));
      const scale = Math.min(
        (canvas.width - 12) / Math.max(1, right - left),
        (canvas.height - 12) / Math.max(1, bottom - top),
      );
      ctx.translate(
        (canvas.width - (right - left) * scale) / 2 - left * scale,
        (canvas.height - (bottom - top) * scale) / 2 - top * scale,
      );
      ctx.scale(scale, scale);
      for (const shape of art) drawShape(ctx, shape, assets, paint);
      unavailable = false;
    } catch {
      unavailable = true;
    }
  }
  $effect(() => {
    void symbol;
    void assets;
    void symbols;
    paint();
  });
</script>

<canvas bind:this={canvas} width="300" height="120" aria-label={'Library preview ' + symbol.name}
></canvas>
{#if unavailable}<span>Preview unavailable</span>{/if}

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100px;
    object-fit: contain;
    background: repeating-conic-gradient(#303440 0% 25%, #393e49 0% 50%) 0 0/16px 16px;
  }
</style>
