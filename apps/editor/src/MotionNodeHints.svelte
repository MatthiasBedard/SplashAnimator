<script lang="ts">
  import type { Vector } from '../../../packages/document/src';
  import type { Matrix } from '../../../packages/geometry/src/affine';
  import {
    parseMotionContourStarts,
    parseMotionContourDirections,
    parseMotionContourOrder,
  } from '../../../packages/animation/src/motion-nodes';
  import {
    prepareMotionNodePreview,
    editMotionNodeHint,
    motionNodeDrawing,
  } from './motion-node-preview';
  let {
    source,
    target,
    value = $bindable(''),
    straight,
    curves,
    distance,
    offset,
    offsets,
    reverse,
    directions,
    order,
    label,
    stageBox,
    stageMatrix,
    stageScale = 1,
    stageSide = $bindable(0),
    shapeMatching = false,
  }: {
    source?: Vector;
    target?: Vector;
    value?: string;
    straight: boolean;
    curves: boolean;
    distance: boolean;
    offset: number;
    offsets: string;
    reverse: boolean;
    directions: string;
    order: string;
    label: string;
    stageBox?: { x: number; y: number; width: number; height: number };
    stageMatrix?: Matrix;
    stageScale?: number;
    stageSide?: number;
    shapeMatching?: boolean;
  } = $props();
  let open = $state(false),
    contour = $state(0),
    selected = $state<[number | null, number | null]>([null, null]),
    original = $state<[number, number] | undefined>(),
    error = $state('');
  const preview = $derived.by(() => {
    if (!open && !stageBox) return undefined;
    try {
      if (
        stageBox &&
        (![stageBox.x, stageBox.y, stageBox.width, stageBox.height, stageScale].every(
          Number.isFinite,
        ) ||
          stageBox.width <= 0 ||
          stageBox.height <= 0 ||
          stageScale <= 0)
      )
        throw new Error('Stage hint view is unresolved.');
      const model = prepareMotionNodePreview(
        source,
        target,
        value,
        straight,
        curves,
        distance,
        parseMotionContourStarts(offsets, offset),
        parseMotionContourDirections(directions, reverse),
        parseMotionContourOrder(order),
        shapeMatching,
      );
      const index = Math.min(contour, model.hints.length - 1);
      return {
        model,
        index,
        drawings: model.rings.map((r, side) =>
          motionNodeDrawing(
            r[index],
            model.closed,
            stageBox ? (side === 0 ? model.source : model.target) : undefined,
          ),
        ),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  $effect(() => {
    void preview;
    void stageMatrix;
    cancelPair();
  });
  function cancelPair() {
    original = undefined;
    selected = [null, null];
    error = '';
  }
  function pairKey(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    if (event.key === 'Escape' && original) {
      event.stopPropagation();
      event.preventDefault();
      cancelPair();
    }
  }
  function edit(pair: [number, number], remove = false) {
    if (!preview || !('model' in preview) || !preview.model) return;
    try {
      value = editMotionNodeHint(preview.model, preview.index, pair, remove, remove ? undefined : original);
      cancelPair();
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

{#snippet pairControls(pairs: [number, number][])}
  <button
    aria-label={`${label} ${original ? 'update' : 'add'} node pair`}
    disabled={selected[0] === null || selected[1] === null}
    onclick={() => { if (selected[0] !== null && selected[1] !== null) edit([selected[0],selected[1]]); }}
    onkeydown={pairKey}
  >{original ? 'Update' : 'Add'} {selected[0] ?? '…'}:{selected[1] ?? '…'}</button>
  {#if original || stageBox}
    <button onclick={cancelPair} onkeydown={pairKey}>{original ? 'Cancel pair edit' : 'Clear selection'}</button>
  {/if}
  {#each pairs as pair}
    <button onkeydown={pairKey} aria-label={`${label} edit node pair ${pair[0]}:${pair[1]}`}
      onclick={() => { original = [...pair]; selected = [...pair]; error = ''; }}
    >Edit {pair[0]}:{pair[1]}</button>
    <button onkeydown={pairKey} aria-label={`${label} remove node pair ${pair[0]}:${pair[1]}`}
      onclick={() => edit(pair,true)}>Remove {pair[0]}:{pair[1]}</button>
  {/each}
{/snippet}



{#if stageBox}
  {#if preview?.model}
    {@const drawing = preview.drawings[stageSide]}
    <svg
      class="stage-overlay"
      preserveAspectRatio="none"
      viewBox={`${stageBox.x} ${stageBox.y} ${stageBox.width} ${stageBox.height}`}
      aria-label={`${label} node preview`}
    >
      <g transform={stageMatrix ? `matrix(${stageMatrix.join(' ')})` : undefined}>
      <path
        d={drawing.path}
        fill="none"
        stroke={stageSide === 0 ? '#52baff' : '#ffb347'}
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
      {#each drawing.anchors as p, i}
        {@const interior = i > 0 && (preview.model.closed || i < drawing.anchors.length - 1)}
        {#if interior}
          <g
            role="button"
            tabindex="0"
            aria-label={`${label} ${stageSide === 0 ? 'source' : 'target'} node ${i}`}
            aria-pressed={selected[stageSide] === i}
            onclick={() => (selected[stageSide] = i)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                selected[stageSide] = i;
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelPair();
              }
            }}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={6 / stageScale}
              fill={selected[stageSide] === i ? '#ffb347' : '#ffffff'}
              stroke="#202020"
              vector-effect="non-scaling-stroke"
            />
            <text
              x={p.x + 9 / stageScale}
              y={p.y - 8 / stageScale}
              style={`font-size:${12 / stageScale}px`}>{i}</text
            >
          </g>
        {:else}<circle cx={p.x} cy={p.y} r={3 / stageScale} fill="#52baff" />{/if}
      {/each}
      </g>
    </svg>
  {/if}
  <div class="stage-tools">
    <label
      >Endpoint<select aria-label={`${label} endpoint`} bind:value={stageSide}
        ><option value={0}>Source</option><option value={1}>Target</option></select
      ></label
    >
    {#if preview?.model}
      <label
        >Contour<select
          aria-label={`${label} hint contour`}
          value={preview.index}
          onchange={(e) => (contour = Number(e.currentTarget.value))}
          >{#each preview.model.hints as _, i}<option value={i}>{i}</option>{/each}</select
        ></label
      >
      {@render pairControls(preview.model.hints[preview.index])}
    {:else if preview && 'error' in preview}<small role="status">{preview.error}</small>{/if}
    {#if error}<small role="status">{error}</small>{/if}
  </div>
{:else}
  <details bind:open>
    <summary>Choose node pairs visually</summary>
    <small
      >First artwork of this track, in local coordinates. Each preview fits independently. Target
      numbering includes contour order, start and direction settings. Select an interior anchor on
      each side, then add the pair. These shared hints are checked on every artwork when generating.</small
    >
    {#if preview && 'error' in preview}
      <p role="status">{preview.error}</p>
    {:else if preview?.model}
      <label
        >Contour<select
          aria-label={`${label} hint contour`}
          value={preview.index}
          onchange={(e) => (contour = Number(e.currentTarget.value))}
        >
          {#each preview.model.hints as _, i}<option value={i}>{i}</option>{/each}
        </select></label
      >
      <div class="previews">
        {#each preview.drawings as drawing, side}
          <div>
            <strong>{side === 0 ? 'Source' : 'Target'}</strong>
            <svg
              viewBox="0 0 200 200"
              aria-label={`${label} ${side === 0 ? 'source' : 'target'} node preview`}
            >
              <path d={drawing.path} fill="none" stroke="currentColor" stroke-width="1.5" />
              {#each drawing.anchors as p, i}
                {@const interior =
                  i > 0 && (preview.model.closed || i < drawing.anchors.length - 1)}
                {#if interior}
                  <g
                    role="button"
                    tabindex="0"
                    aria-label={`${label} ${side === 0 ? 'source' : 'target'} node ${i}`}
                    aria-pressed={selected[side] === i}
                    onclick={() => (selected[side] = i)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        selected[side] = i;
                      }
                    }}
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="7"
                      fill={selected[side] === i ? '#ffb347' : '#ffffff'}
                      stroke="#202020"
                    />
                    <text x={p.x + 9} y={p.y - 8}>{i}</text>
                  </g>
                {:else}<circle cx={p.x} cy={p.y} r="3" fill="currentColor" /><text
                    x={p.x + 6}
                    y={p.y - 6}>{i}</text
                  >{/if}
              {/each}
            </svg>
          </div>
        {/each}
      </div>
      {@render pairControls(preview.model.hints[preview.index])}
      {#if error}<p role="status">{error}</p>{/if}
    {/if}
  </details>
{/if}

<style>
  svg.stage-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
  }
  .stage-tools {
    position: absolute;
    bottom: 4px;
    right: 4px;
    z-index: 1;
    max-width: calc(100% - 8px);
    max-height: 35%;
    overflow: auto;
    background: #18202b;
    color: white;
    padding: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .stage-tools label {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .previews {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .previews > div {
    flex: 1;
    min-width: 130px;
  }
  svg {
    width: 100%;
    background: #26303b;
    color: #e4e9ef;
  }
  text {
    fill: currentColor;
    font-size: 10px;
    pointer-events: none;
  }
  g {
    cursor: pointer;
  }
  g:focus circle {
    stroke: #52baff;
    stroke-width: 3px;
  }
  small {
    display: block;
  }
</style>
