<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { Layer } from '../../../packages/document/src';
  let {
    layers,
    selectedTracks,
    duration,
    authoredDuration,
    frame,
    layerId,
    start,
    end,
    disabled,
    select,
    exposure,
    frameScripts,
    contextScript,
    command,
    transfer,
  }: {
    layers: Layer[];
    selectedTracks: string[];
    duration: number;
    authoredDuration?:number;
    frame: number;
    layerId: string;
    start: number;
    end: number;
    disabled: boolean;
    select: (layer: string, frame: number, extend: boolean) => void;
    exposure: (layer: string, frame: number) => void;
    frameScripts?: readonly { frame: number }[];
    contextScript?: (event: MouseEvent, layer: string, frame: number) => void;
    transfer: (
      source: string,
      start: number,
      end: number,
      destination: string,
      at: number,
      sources: string[],
      destinations: string[],
    ) => void;
    command: (
      action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'clear' | 'remove' | 'undo' | 'redo',
    ) => void;
  } = $props();
  const scriptDescriptionId = $props.id();
  let dragPage = $state<number | undefined>();
  const first = $derived(dragPage ?? Math.floor(frame / 64) * 64);
  const frames = $derived(
    Array.from({ length: Math.min(64, duration - first) }, (_, i) => first + i),
  );
  const scripted = $derived(new Set(frameScripts?.map((entry) => entry.frame)));
  const rows = $derived(
    [...layers].reverse().map((layer) => {
      let held = 0;
      while (held + 1 < layer.keys.length && layer.keys[held + 1].frame <= first) held++;
      return {
        layer,
        cells: frames.map((f) => {
          while (held + 1 < layer.keys.length && layer.keys[held + 1].frame <= f) held++;
          const key = layer.keys[held];
          const outside=f>=(authoredDuration??duration);
          return { frame: f, key: !outside&&key.frame === f, blank: outside||!key.shapes.length, outside };
        }),
      };
    }),
  );
  let scroller: HTMLDivElement;
  let gesture = $state<{
    pointer: number;
    track: string;
    anchor: number;
    target: number;
    element: HTMLElement;
    moving: boolean;
    targetTrack: string;
    rangeStart: number;
    rangeEnd: number;
    offset: number;
    sources: string[];
    selection: string;
  } | null>(null);
  let scrollTimer: ReturnType<typeof setInterval> | undefined;
  let pointerX = 0,
    pointerY = 0;
  async function scrollGesture() {
    if (
      !gesture ||
      disabled ||
      gestureContext !== layers ||
      gesture.selection !== selectedTracks.join('|')
    ) {
      cancelGesture();
      return;
    }
    const bounds = scroller.getBoundingClientRect();
    if (
      pointerX < bounds.left + 140 ||
      pointerX > bounds.right ||
      pointerY < bounds.top + 24 ||
      pointerY > bounds.bottom
    )
      return;
    const dx = pointerX > bounds.right - 28 ? 28 : pointerX < bounds.left + 168 ? -28 : 0;
    const dy = gesture.moving
      ? pointerY > bounds.bottom - 28
        ? 28
        : pointerY < bounds.top + 52
          ? -28
          : 0
      : 0;
    const oldGesture = gesture;
    const page = first;
    const atEdge =
      dx > 0
        ? scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1
        : dx < 0 && scroller.scrollLeft <= 0;
    const nextPage = page + Math.sign(dx) * 64;
    if (atEdge && nextPage >= 0 && nextPage < duration && dx) {
      // Keep ordinary clicks on their button; transfer capture only before removing it.
      gesture.element = scroller;
      scroller.setPointerCapture(gesture.pointer);
      dragPage = nextPage;
      await tick();
      if (gesture !== oldGesture) return;
      scroller.scrollLeft = dx > 0 ? 0 : scroller.scrollWidth;
    } else scroller.scrollLeft += dx;
    scroller.scrollTop += dy;
    const target = cellAt({ clientX: pointerX, clientY: pointerY });
    if (target) {
      gesture.target = target.frame;
      gesture.targetTrack = target.track;
    }
  }
  onDestroy(cancelGesture);
  let suppressClick = false;
  let gestureContext: Layer[];
  function routes(source: string, target: string, sources: string[]) {
    const offset =
      layers.findIndex((l) => l.id === target) - layers.findIndex((l) => l.id === source);
    return sources.map((id) => layers[layers.findIndex((l) => l.id === id) + offset]?.id);
  }
  const selectionTracks = $derived(
    gesture?.moving
      ? routes(gesture.track, gesture.targetTrack, gesture.sources).filter((id) => id !== undefined)
      : [gesture?.targetTrack ?? layerId],
  );
  const selectionStart = $derived(
    gesture
      ? gesture.moving
        ? gesture.target - gesture.offset
        : Math.min(gesture.anchor, gesture.target)
      : start,
  );
  const selectionEnd = $derived(
    gesture
      ? gesture.moving
        ? selectionStart + gesture.rangeEnd - gesture.rangeStart
        : Math.max(gesture.anchor, gesture.target)
      : end,
  );
  function cancelGesture() {
    clearInterval(scrollTimer);
    scrollTimer = undefined;
    const old = gesture;
    gesture = null;
    dragPage = undefined;
    if (old?.element.hasPointerCapture(old.pointer)) old.element.releasePointerCapture(old.pointer);
  }
  function begin(e: PointerEvent, track: string, target: number) {
    if (disabled || e.button !== 0 || gesture) return;
    if (
      e.altKey &&
      ((track !== layerId && !selectedTracks.includes(track)) || target < start || target > end)
    )
      return;
    suppressClick = true;
    const element = e.currentTarget as HTMLButtonElement;
    element.focus({ preventScroll: true });
    element.setPointerCapture(e.pointerId);
    gestureContext = layers;
    pointerX = e.clientX;
    pointerY = e.clientY;
    scrollTimer = setInterval(scrollGesture, 80);
    gesture = {
      sources: e.altKey && selectedTracks.includes(track) ? [...selectedTracks] : [track],
      selection: selectedTracks.join('|'),
      moving: e.altKey,
      targetTrack: track,
      rangeStart: start,
      rangeEnd: end,
      offset: target - start,
      pointer: e.pointerId,
      track,
      target,
      element,
      anchor: e.shiftKey && track === layerId ? (frame === start ? end : start) : target,
    };
  }
  function cellAt(e: Pick<PointerEvent, 'clientX' | 'clientY'>) {
    const cell = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLButtonElement>('button[data-symbol-frame]');
    return cell &&
      scroller.contains(cell) &&
      (gesture?.moving || cell.dataset.symbolTrack === gesture?.track)
      ? { frame: Number(cell.dataset.symbolFrame), track: cell.dataset.symbolTrack! }
      : undefined;
  }
  function move(e: PointerEvent) {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    const target = cellAt(e);
    if (target !== undefined) {
      gesture.target = target.frame;
      gesture.targetTrack = target.track;
    }
  }
  async function finish(e: PointerEvent) {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    const target = cellAt(e),
      old = gesture;
    cancelGesture();
    if (
      disabled ||
      target === undefined ||
      gestureContext !== layers ||
      old.selection !== selectedTracks.join('|')
    )
      return;
    if (old.moving) {
      const at = target.frame - old.offset;
      const destinations = routes(old.track, target.track, old.sources);
      if (destinations.some((id) => id === undefined)) return;
      if (target.track !== old.track || at !== old.rangeStart)
        transfer(
          old.track,
          old.rangeStart,
          old.rangeEnd,
          target.track,
          at,
          old.sources,
          destinations as string[],
        );
    } else {
      select(old.track, old.anchor, false);
      select(old.track, target.frame, true);
    }
    await tick();
    scroller
      .querySelector<HTMLButtonElement>('button[aria-current="true"]')
      ?.focus({ preventScroll: true });
  }
  function escapeGesture(e: KeyboardEvent) {
    if (!gesture) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelGesture();
    }
  }
  $effect(() => {
    if (disabled) cancelGesture();
  });
  async function keyboard(e: KeyboardEvent, id: string, f: number) {
    if (disabled || gesture || e.altKey) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || (key === 'y' && !e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) command(key === 'y' || e.shiftKey ? 'redo' : 'undo');
      await tick();
      scroller.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.focus();
      return;
    }
    const action =
      (e.ctrlKey || e.metaKey) && !e.shiftKey
        ? ({ c: 'copy', x: 'cut', v: 'paste', d: 'duplicate' } as const)[
            key as 'c' | 'x' | 'v' | 'd'
          ]
        : !e.ctrlKey && !e.metaKey && e.key === 'Delete'
          ? e.shiftKey
            ? 'remove'
            : 'clear'
          : undefined;
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) command(action);
      await tick();
      scroller.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.focus();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    let target = f,
      track = id;
    const row = rows.findIndex((r) => r.layer.id === id);
    if (e.key === 'ArrowLeft') target--;
    else if (e.key === 'ArrowRight') target++;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = duration - 1;
    else if (e.key === 'ArrowUp') track = rows[Math.max(0, row - 1)].layer.id;
    else if (e.key === 'ArrowDown') track = rows[Math.min(rows.length - 1, row + 1)].layer.id;
    else return;
    e.preventDefault();
    e.stopPropagation();
    select(track, Math.max(0, Math.min(duration - 1, target)), e.shiftKey && track === id);
    await tick();
    scroller.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.focus();
  }
  $effect(() => {
    const column = frame - first;
    if (scroller && !gesture) {
      const left = column * 28,
        right = left + 28,
        width = scroller.clientWidth - 140;
      if (left < scroller.scrollLeft) scroller.scrollLeft = left;
      else if (right > scroller.scrollLeft + width)
        scroller.scrollLeft = Math.max(0, right - width);
    }
  });
</script>

<svelte:window
  onpointermove={move}
  onpointerup={finish}
  onpointercancel={cancelGesture}
  onblur={cancelGesture}
  onkeydown={escapeGesture}
/>
<section aria-label="Symbol frame grid">
  <div class="pages">
    <button
      disabled={disabled || first === 0}
      onclick={() => select(layerId, Math.max(0, frame - 64), false)}>Earlier symbol frames</button
    >
    <span>Frames {first + 1}–{first + frames.length} of {duration}</span>
    <button
      disabled={disabled || first + 64 >= duration}
      onclick={() => select(layerId, Math.min(duration - 1, frame + 64), false)}
      >Later symbol frames</button
    >
  </div>
  <div
    class="scroll"
    bind:this={scroller}
    onlostpointercapture={(e) => {
      if (e.target === gesture?.element) cancelGesture();
    }}
  >
    <span id={scriptDescriptionId} hidden>Frame script attached</span>
    <table>
      <thead
        ><tr
          ><th scope="col">Layer / frame</th>{#each frames as f}<th scope="col">{f + 1}</th
            >{/each}</tr
        ></thead
      >
      <tbody
        >{#each rows as row, rowIndex (row.layer.id)}
          <tr class:muted={!row.layer.visible}>
            <th scope="row"
              >{row.layer.name}{row.layer.locked ? ' 🔒' : ''}{!row.layer.visible
                ? ' (hidden)'
                : ''}</th
            >
            {#each row.cells as cell (cell.frame)}
              {@const hasScript = rowIndex === 0 && scripted.has(cell.frame)}
              <td
                ><button
                  {disabled}
                  aria-label={`${row.layer.name}, frame ${cell.frame + 1}, ${cell.outside?'empty':cell.key ? (cell.blank ? 'blank key' : 'key') : cell.blank ? 'blank hold' : 'hold'}`}
                  aria-describedby={hasScript ? scriptDescriptionId : undefined}
                  class:outside={cell.outside}
                  aria-current={row.layer.id === layerId && cell.frame === frame
                    ? 'true'
                    : undefined}
                  aria-pressed={selectionTracks.includes(row.layer.id) &&
                    cell.frame >= selectionStart &&
                    cell.frame <= selectionEnd}
                  tabindex={row.layer.id === layerId && cell.frame === frame ? 0 : -1}
                  class:selected={selectionTracks.includes(row.layer.id) &&
                    cell.frame >= selectionStart &&
                    cell.frame <= selectionEnd}
                  class:current={cell.frame === frame}
                  data-symbol-track={row.layer.id}
                  data-symbol-frame={cell.frame}
                  onpointerdown={(e) => begin(e, row.layer.id, cell.frame)}
                  onclick={(e) => {
                    if (!suppressClick || e.detail === 0)
                      select(row.layer.id, cell.frame, e.shiftKey);
                    suppressClick = false;
                  }}
                  ondblclick={() => exposure(row.layer.id, cell.frame)}
                  oncontextmenu={(event) => contextScript?.(event, row.layer.id, cell.frame)}
                  onkeydown={(e) => keyboard(e, row.layer.id, cell.frame)}
                  >{cell.key ? (cell.blank ? '○' : '●') : cell.blank ? '·' : '—'}{#if hasScript}<span class="script-badge" title="Frame script" aria-hidden="true">S</span>{/if}</button
                ></td
              >
            {/each}
          </tr>
        {/each}</tbody
      >
    </table>
  </div>
  <p>
    Alt-drag inside the selected range to move it to blank time on this or another layer. Starting
    on a checked track moves all checked tracks with the same frame and row offset. Drag across
    frames on one layer to select a range; hold near the grid edge to scroll across frame pages.
    Alt-drag also scrolls vertically between tracks; Shift extends from the existing anchor. Escape
    or releasing outside that row cancels. Click a frame; Shift-click also selects a range.
    Double-click selects its whole held exposure. Arrow keys navigate; Shift+Left/Right extends.
    Home/End jumps to the first/last frame. Ctrl/Cmd+C/X/V copies, cuts or inserts at the cursor;
    Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. Ctrl/Cmd+D duplicates. These commands
    use all checked tracks when the active track is checked; paste uses the most recently copied
    single-track or multi-track clipboard. Delete clears; Shift+Delete removes time. ● key · ○ blank
    key
  </p>
</section>

<style>
  section {
    margin: 12px 0;
    border: 1px solid #63738b;
    padding: 8px;
  }
  .pages {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .scroll {
    overflow: auto;
    max-height: 240px;
    margin-top: 6px;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  th {
    font-size: 11px;
    min-width: 28px;
    height: 24px;
    background: #243148;
    color: #eef3ff;
  }
  th:first-child {
    position: sticky;
    left: 0;
    min-width: 140px;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    z-index: 1;
    text-align: left;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  thead th:first-child {
    z-index: 3;
  }
  td {
    padding: 0;
  }
  td button {
    position: relative;
    touch-action: none;
    user-select: none;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    min-width: 28px;
    margin: 0;
    padding: 0;
    border: 1px solid #526078;
    border-radius: 0;
    background: #303e54;
    color: #edf2ff;
  }
  .script-badge {
    position: absolute;
    inset-block-start: 2px;
    inset-inline-start: 50%;
    transform: translateX(-50%);
    width: 7px;
    background: #164e63;
    color: #ecfeff;
    font: bold 8px/9px monospace;
    text-align: center;
  }
  td button.selected {
    background: #346591;
  }
  td button.outside{background:#22252b;color:#777e8c;}
  td button.current {
    border-left: 2px solid #ffbc54;
  }
  td button[aria-current='true'] {
    box-shadow: inset 0 0 0 2px #ffbc54;
  }
  td button:focus-visible {
    outline: 2px solid white;
    outline-offset: -3px;
  }
  .muted {
    opacity: 0.6;
  }
  p {
    font-size: 12px;
  }
</style>
