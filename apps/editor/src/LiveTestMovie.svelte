<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { Project } from '../../../packages/document/src';
  import { createLiveMovieSession, type LiveMovieFrame } from './live-movie-session';
  import { createLiveMoviePainter } from './live-movie-paint';
  let {
    snapshot,
    at,
    validate,
    close,
  }: {
    snapshot: Project;
    at: number;
    validate: () => void;
    close: () => void;
  } = $props();
  const original = untrack(() => ({ snapshot, at, validate, close }));
  let canvas: HTMLCanvasElement;
  let renderButton: HTMLButtonElement;
  let cancelButton: HTMLButtonElement;
  let phase = $state.raw<LiveMovieFrame>();
  let running = $state(true),
    rootRunning = $state(true),
    working = $state(false),
    shown = $state(false);
  let message = $state('Preparing live movie…'),
    activations = $state(0),
    focused = $state<string | null>(null);
  let session: ReturnType<typeof createLiveMovieSession> | undefined;
  let painter: ReturnType<typeof createLiveMoviePainter> | undefined;
  let alive = true,
    revision = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let over: string | null = null,
    down: string | null = null,
    pointer: number | null = null,
    key: string | null = null;
  let point: { x: number; y: number } | undefined,
    pointerView = '',
    pointerInside = false;
  const buttons = $derived(phase?.presentation.buttons ?? []);
  const focusName = $derived(buttons.find((b) => b.token === focused)?.name ?? 'None');
  function view() {
    const b = canvas.getBoundingClientRect();
    return JSON.stringify([b.x, b.y, b.width, b.height]);
  }
  function release() {
    const captured = pointer;
    pointer = null;
    pointerInside = false;
    key = null;
    down = null;
    if (captured !== null && canvas?.hasPointerCapture(captured))
      canvas.releasePointerCapture(captured);
  }
  function cancelJob() {
    revision++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    painter?.cancel();
    finishWorking();
    shown = false;
  }
  function finishWorking() {
    if (alive && document.activeElement === cancelButton) renderButton.focus({ preventScroll: true });
    working = false;
  }
  function source() {
    original.validate();
    if (!alive) throw Error('Live movie closed.');
  }
  function reconcile(next: LiveMovieFrame) {
    if (down !== next.input.down) release();
    over = next.input.over;
    down = next.input.down;
    if (focused && !next.presentation.buttons.some((b) => b.token === focused)) focused = null;
    if (point && !key) {
      const picked = session!.pick(next, point)?.token ?? null;
      if (pointer !== null && (pointerView !== view() || (pointerInside && down !== picked)))
        release();
      if (over !== picked || down !== next.input.down) {
        over = picked;
        next = session!.current({ over, down });
      }
    }
    return next;
  }
  async function render(action: 'current' | 'advance' | 'restart' = 'current') {
    cancelJob();
    if (!alive || !session || !painter) return;
    const owned = revision,
      started = performance.now(),
      bounds = view();
    working = true;
    message = 'Preparing live movie…';
    const current = () => {
      source();
      if (revision !== owned || view() !== bounds)
        throw Error('Live movie input or view changed. Render again.');
    };
    let ready = false;
    try {
      // Coalesce superseded control/input jobs before entering a synchronous
      // clock/scene owner, including callbacks that retire an in-flight paint.
      await Promise.resolve();
      current();
      const next =
        action === 'restart'
          ? session.restart()
          : action === 'advance'
            ? session.advance(rootRunning, { over, down })
            : session.current({ over, down });
      phase = reconcile(next);
      await painter.prepare(phase, current);
      current();
      painter.publish(canvas, phase);
      current();
      shown = true;
      ready = true;
      message = 'Live movie ready. Scripts are disabled.';
    } catch (cause) {
      if (alive && revision === owned) {
        running = false;
        release();
        over = null;
        shown = false;
        message = String(cause);
      }
    } finally {
      if (revision === owned) finishWorking();
    }
    if (ready && alive && revision === owned && running) {
      const interval = 1000 / original.snapshot.fps,
        elapsed = performance.now() - started;
      const nextTimer = setTimeout(
        () => {
          if (!alive || !running || revision !== owned || timer !== nextTimer) return;
          timer = undefined;
          void render('advance');
        },
        elapsed >= interval ? interval : interval - elapsed,
      );
      timer = nextTimer;
    }
  }
  function toggleClocks() {
    running = !running;
    void render();
  }
  function toggleRoot() {
    rootRunning = !rootRunning;
    release();
    over = null;
    void render();
  }
  function restart() {
    release();
    over = null;
    focused = null;
    point = undefined;
    void render('restart');
  }
  function cancel() {
    running = false;
    release();
    over = null;
    cancelJob();
    message = 'Rendering cancelled. Render retries the retained tick.';
  }
  function viewChanged() {
    if (!alive || !session) return;
    release();
    point = undefined;
    over = null;
    void render();
  }
  function location(e: PointerEvent) {
    const b = canvas.getBoundingClientRect();
    if (!(b.width > 0 && b.height > 0)) throw Error('Live movie view is unavailable.');
    return {
      x: ((e.clientX - b.left) * original.snapshot.width) / b.width,
      y: ((e.clientY - b.top) * original.snapshot.height) / b.height,
    };
  }
  function pick(e: PointerEvent) {
    source();
    if (!phase || !shown || working) return;
    const at = location(e),
      bounds = view(),
      next = session!.pick(phase, at);
    source();
    if (bounds !== view()) throw Error('Live movie pointer view changed.');
    point = at;
    return next;
  }
  function pointerDown(e: PointerEvent) {
    if (e.button !== 0 || !e.isPrimary || pointer !== null || key || working || !shown) return;
    try {
      const b = pick(e);
      if (!b) return;
      e.preventDefault();
      canvas.focus();
      pointer = e.pointerId;
      pointerView = view();
      pointerInside = true;
      over = down = focused = b.token;
      canvas.setPointerCapture(e.pointerId);
      void render();
    } catch (cause) {
      cancel();
      message = String(cause);
    }
  }
  function pointerMove(e: PointerEvent) {
    if ((pointer !== null && pointer !== e.pointerId) || key) return;
    if (working || !shown) {
      if (pointer !== null) {
        point = location(e);
        release();
        over = null;
        void render();
      }
      return;
    }
    try {
      const previous = over;
      over = pick(e)?.token ?? null;
      if (pointer !== null) pointerInside = over === down;
      if (over !== previous) void render();
    } catch (cause) {
      cancel();
      message = String(cause);
    }
  }
  function pointerUp(e: PointerEvent) {
    if (pointer !== e.pointerId) return;
    try {
      const token = !working && shown ? pick(e)?.token : null;
      if (token && token === down && pointerView === view()) activations++;
      release();
      over = token ?? null;
      void render();
    } catch (cause) {
      cancel();
      message = String(cause);
    }
  }
  function captureLost(e: PointerEvent) {
    if (pointer !== e.pointerId) return;
    release();
    over = null;
    void render();
  }
  function pointerLeave() {
    if (pointer === null && !key && over) {
      over = null;
      point = undefined;
      void render();
    }
  }
  function keyEvent(e: KeyboardEvent, up = false) {
    if (![' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      original.close();
      return;
    }
    if (up && key === e.key && (working || !shown)) {
      release();
      over = null;
      void render();
      return;
    }
    if (working || !shown || !phase || !buttons.length) return;
    try {
      source();
      session!.assertCurrent(phase);
      if (up) {
        if (key === e.key) {
          if (buttons.some((b) => b.token === down)) activations++;
          release();
          void render();
        }
        return;
      }
      if (e.repeat || pointer !== null || key) return;
      point = undefined;
      if (e.key.startsWith('Arrow')) {
        const i = buttons.findIndex((b) => b.token === focused);
        focused =
          buttons[
            (Math.max(0, i) + (e.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
          ].token;
        over = focused;
      } else {
        focused ??= buttons[0].token;
        over = down = focused;
        key = e.key;
      }
      void render();
    } catch (cause) {
      cancel();
      message = String(cause);
    }
  }
  onMount(() => {
    // Element scroll events do not bubble. Capture them so the containing
    // dialog also retires pointer/view ownership, even after a restored scroll.
    window.addEventListener('scroll', viewChanged, true);
    // Start after the dialog action opens the modal and the canvas has a layout.
    const start = requestAnimationFrame(() => {
      try {
        source();
        session = createLiveMovieSession(original.snapshot, original.at, { validate: source });
        painter = createLiveMoviePainter(original.snapshot, session, source, () => {
          if (alive) {
            release();
            over = null;
            void render();
          }
        });
        void render();
      } catch (cause) {
        running = false;
        message = String(cause);
      }
    });
    return () => {
      cancelAnimationFrame(start);
      window.removeEventListener('scroll', viewChanged, true);
    };
  });
  onDestroy(() => {
    alive = false;
    release();
    cancelJob();
    painter?.dispose();
    session?.dispose();
  });
</script>

<svelte:window onresize={viewChanged} />
<h2>Test live movie</h2>
<p>Live tweens and stored symbol timelines play without changing artwork. Scripts are disabled.</p>
<div class="surface">
  <canvas
    bind:this={canvas}
    width="1"
    height="1"
    aria-label="Live movie interaction"
    role="button"
    aria-disabled={working || !shown}
    tabindex="0"
    style:aspect-ratio={`${original.snapshot.width}/${original.snapshot.height}`}
    style:opacity={shown ? 1 : 0}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={captureLost}
    onlostpointercapture={captureLost}
    onpointerleave={pointerLeave}
    onkeydown={(e) => keyEvent(e)}
    onkeyup={(e) => keyEvent(e, true)}
    onblur={() => {
      if (pointer !== null || key) {
        release();
        over = null;
        void render();
      }
    }}
  ></canvas>
</div>
<div class="controls">
  <button data-live-movie-clocks onclick={toggleClocks}>{running ? 'Pause preview clocks' : 'Play preview clocks'}</button>
  <button onclick={toggleRoot}>{rootRunning ? 'Pause live root' : 'Play live root'}</button>
  <button
    aria-disabled={running || working}
    onclick={() => {
      if (!running && !working) void render('advance');
    }}>Step live preview</button
  >
  <button bind:this={renderButton} onclick={() => render()}>Render live movie</button>
  <button onclick={restart}>Restart live movie</button>
  <button bind:this={cancelButton} disabled={!working} onclick={cancel}>Cancel live rendering</button>
</div>
<p>
  Pause the root to keep movie clips running independently. Pause preview clocks to hold everything.
</p>
<p aria-label="Live movie position">
  Frame {phase ? phase.frame + 1 : '—'} · Tick {phase?.tick ?? 0} · {rootRunning
    ? 'Root playing'
    : 'Root paused'}
</p>
<p aria-label="Live movie buttons">Button: {focusName} · Activations: {activations}</p>
<p role="status" aria-label="Live movie status">{message}</p>

<style>
  .surface {
    width: 100%;
    overflow: auto;
    background: #ddd;
  }
  canvas {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
  }
  button[aria-disabled='true'] {
    cursor: default;
  }
  button[aria-disabled='true']:not(:focus-visible) {
    opacity: 0.35;
  }
  [aria-label='Live movie status'] {
    min-height: 44px;
  }
  p {
    font-size: 13px;
  }
</style>
