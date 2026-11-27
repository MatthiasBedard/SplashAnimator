<script module lang="ts">
  export type { LiveWaypointPick } from './live-waypoint-drag';
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import {
    createLiveWaypointDrag,
    type LiveWaypointPick,
    type LiveWaypointDraft,
  } from './live-waypoint-drag';
  import { createLatestFrameTask } from './latest-frame-task';
  import type { Point, Project } from '../../../packages/document/src';
  import {
    captureLiveWaypoints,
    prepareLiveWaypointPositions,
    type LiveWaypointOwner,
  } from '../../../packages/animation/src/live-waypoints';
  import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
  import { prepareLiveMotionFrameCapture } from '../../../packages/animation/src/live-motion-presentation';
  import { createLiveStagePainter } from './live-stage-paint';
  import type { LiveCubicStageHooks } from './LiveCubicEditor.svelte';
  import type { LiveCubicView } from './live-cubic-drag';
  let {
    snapshot,
    at,
    canvas,
    view,
    validate,
    publish,
    close,
    connect,
    invalidate,
  }: {
    snapshot: Project;
    at: number;
    canvas: HTMLCanvasElement;
    view: () => LiveCubicView;
    validate: () => void;
    publish: (pick: LiveWaypointPick, target: Point, validate: () => void) => void;
    close: () => void;
    connect: (hooks: LiveCubicStageHooks | undefined) => void;
    invalidate: () => void;
  } = $props();
  const original = untrack(() => ({
    snapshot,
    at,
    canvas,
    view,
    validate,
    publish,
    close,
    connect,
    invalidate,
  }));
  const readSource = () => {
    original.validate();
    return { project: original.snapshot, revision: 0, frame: original.at };
  };
  type Scope = ReturnType<typeof captureLiveWaypoints>;
  type Draft = LiveWaypointDraft;
  let choices = $state<Scope['choices']>([]),
    chosen = $state(''),
    number = $state(1),
    x = $state(NaN),
    y = $state(NaN),
    children = $state(false),
    enabled = $state(false),
    authoring = $state(false),
    dragging = $state(false);
  let message = $state('Preparing original waypoints…'),
    selectedOwner = $state.raw<LiveWaypointOwner>(),
    draft = $state.raw<Draft | null>(null);
  let pick: LiveWaypointPick | undefined,
    revision = 0,
    selectionScope: Scope | undefined,
    numericScope: Scope | undefined;
  let policy = 0,
    authoringPolicy = 0;
  const context = { readSource, validate: original.validate };
  const emptyPick: LiveWaypointPick = Object.freeze({
    layerId: '',
    spanId: '',
    shapeId: '',
    waypointIndex: 0,
  });
  let controller: ReturnType<typeof createLiveWaypointDrag> | undefined;
  let base: ReturnType<typeof createLiveStagePainter> | undefined,
    painter: typeof base,
    preparing: typeof base;
  let alive = true,
    serial = 0,
    job: AbortController | undefined;
  function clearPaint() {
    serial++;
    job?.abort();
    job = undefined;
    preparing?.dispose();
    preparing = undefined;
    painter?.dispose();
    painter = undefined;
    original.invalidate();
  }
  function clear() {
    controller?.cancel();
    paintTask.cancel();
    clearPaint();
    numericScope?.dispose();
    numericScope = undefined;
    draft = null;
  }
  const paintTask = createLatestFrameTask<Draft>({
    admit: (value) => value,
    run: (value) => {
      void renderPreview(value);
    },
    onError: (cause) => {
      message = String(cause);
    },
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  });
  function showDraft(value: Draft | null) {
    draft = value;
    paintTask.cancel();
    clearPaint();
    if (value) paintTask.request(value);
  }
  function useDraft() {
    try {
      if (!draft || dragging) return;
      draft.validate();
      const point = { ...draft.target };
      editTarget(point.x, point.y);
    } catch (cause) {
      message = String(cause);
    }
  }
  function editTarget(nx: number, ny: number) {
    x = nx;
    y = ny;
    revision++;
    clear();
    message = 'Target changed. Preview or Commit prepares it freshly.';
  }
  function select(root: string, waypoint: number) {
    revision++;
    clear();
    selectionScope?.dispose();
    selectionScope = undefined;
    selectedOwner = undefined;
    pick = undefined;
    chosen = root;
    number = waypoint;
    x = NaN;
    y = NaN;
    try {
      const index = Number(root),
        hint = choices[index];
      if (!Number.isSafeInteger(index) || String(index) !== root || !hint)
        throw Error('Choose original artwork.');
      if (!Number.isSafeInteger(waypoint) || waypoint < 1)
        throw Error('Enter a whole waypoint number starting at 1.');
      const scope = captureLiveWaypoints(readSource);
      try {
        const owner = scope.resolve(hint.layerId, hint.spanId, hint.shapeId, waypoint - 1);
        original.validate();
        pick = Object.freeze({
          layerId: owner.layerId,
          spanId: owner.spanId,
          shapeId: owner.shapeId,
          waypointIndex: owner.waypointIndex,
        });
        selectedOwner = owner;
        x = owner.point.x;
        y = owner.point.y;
        selectionScope = scope;
      } catch (cause) {
        scope.dispose();
        throw cause;
      }
      message = 'Original waypoint selected. Preview is unapplied; Commit records one edit.';
    } catch (cause) {
      message = String(cause);
    }
    original.invalidate();
  }
  function admitInput() {
    const inputRevision = revision,
      identity = pick,
      owner = selectedOwner,
      root = chosen,
      waypoint = number,
      target = { x, y };
    if (!identity || !owner || !Number.isFinite(x) || !Number.isFinite(y))
      throw Error('Choose an original waypoint and finite document X and Y.');
    const active = () => {
      original.validate();
      if (
        !alive ||
        revision !== inputRevision ||
        pick !== identity ||
        selectedOwner !== owner ||
        chosen !== root ||
        !Object.is(number, waypoint) ||
        !Object.is(x, target.x) ||
        !Object.is(y, target.y)
      )
        throw Error('Live waypoint inputs changed.');
    };
    active();
    return { pick: identity, target, active };
  }
  async function renderPreview(value: Draft) {
    clearPaint();
    const controller = new AbortController(),
      owned = serial,
      remembered = children;
    job = controller;
    const current = () => {
      controller.signal.throwIfAborted();
      original.validate();
      value.validate();
      if (!alive || serial !== owned || draft !== value || children !== remembered)
        throw Error('Live waypoint preview changed.');
    };
    let next: typeof painter;
    try {
      current();
      message = 'Preparing waypoint preview…';
      const project = remembered
        ? await prepareLiveMotionFrameCapture(
            () => {
              current();
              return { project: value.project, revision: 0 };
            },
            original.at,
            { signal: controller.signal, validate: current, rememberedChildren: true },
          )
        : value.project;
      current();
      next = createLiveStagePainter(project, current);
      preparing = next;
      await next.prepare(original.at, current);
      current();
      painter = next;
      preparing = undefined;
      next = undefined;
      message = 'Unapplied live waypoint preview. Commit records one edit.';
      original.invalidate();
    } catch (cause) {
      if (alive && serial === owned) {
        message = String(cause);
        original.invalidate();
      }
    } finally {
      if (preparing === next) preparing = undefined;
      next?.dispose();
    }
  }
  function preview() {
    try {
      clear();
      const input = admitInput(),
        scope = captureLiveWaypoints(readSource);
      numericScope = scope;
      const owner = scope.resolve(
          input.pick.layerId,
          input.pick.spanId,
          input.pick.shapeId,
          input.pick.waypointIndex,
        ),
        target = Object.freeze(input.target);
      const project = prepareLiveWaypointPositions([{ owner, target }], { validate: input.active }),
        stamp = selectionTrajectoryStamp(project);
      const value: Draft = Object.freeze({
        project,
        owner,
        target,
        validate() {
          input.active();
          scope.assertCurrent();
          if (selectionTrajectoryStamp(project) !== stamp)
            throw Error('Live waypoint preview candidate changed.');
        },
      });
      value.validate();
      showDraft(value);
    } catch (cause) {
      message = String(cause);
    }
  }
  function commit() {
    try {
      const input = admitInput();
      original.publish(input.pick, input.target, input.active);
    } catch (cause) {
      message = String(cause);
    }
  }
  function handles(ctx: CanvasRenderingContext2D) {
    let saved = false;
    try {
      if (!selectedOwner || !base) return;
      original.validate();
      selectionScope?.assertCurrent();
      base.check(original.at);
      const v = original.view(),
        r = original.canvas.getBoundingClientRect(),
        dpr = original.canvas.width / v.width;
      const screen = (p: Readonly<Point>) => ({
        x: ((p.x * v.zoom + v.origin.x) * r.width) / v.width,
        y: ((p.y * v.zoom + v.origin.y) * r.height) / v.height,
      });
      ctx.save();
      saved = true;
      ctx.setTransform((dpr * v.width) / r.width, 0, 0, (dpr * v.height) / r.height, 0, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#007eaa';
      ctx.fillStyle = '#ffffff';
      const point = screen(selectedOwner.point);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (draft && painter) {
        draft.validate();
        const proposed = screen(draft.target);
        ctx.fillStyle = '#007eaa';
        ctx.beginPath();
        ctx.arc(proposed.x, proposed.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    } catch {
      /* Stale ownership never supplies a marker. */
    } finally {
      if (saved) ctx.restore();
    }
  }
  $effect(() => {
    original.view();
    untrack(() => controller?.changed());
  });
  onMount(() => {
    let mounted = true;
    controller = createLiveWaypointDrag({
      canvas: original.canvas,
      view: original.view,
      state: () => ({
        context,
        pick: pick ?? emptyPick,
        target: { x, y },
        revision,
        enabled,
        policy,
        authoring,
        authoringPolicy,
        preview: draft,
      }),
      foreground(owner, point) {
        if (!base) return false;
        const front = base.foregroundIdentity(original.at, point, 0);
        return (
          !front || (front.layerId === owner.layerId && owner.shapeIds.includes(front.shapeId))
        );
      },
      preview: (value) => showDraft(value),
      active: (value) => {
        dragging = value;
      },
      error: (cause) => {
        message = String(cause);
      },
      publish: original.publish,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    });
    original.connect({
      down: (e) => {
        controller?.down(e);
        e.preventDefault();
      },
      move: (e) => {
        controller?.move(e);
      },
      up: (e) => {
        controller?.up(e);
      },
      cancel: () => {
        if (dragging) controller?.cancel();
        else {
          clear();
          message = 'Waypoint preview discarded. Numeric inputs remain.';
        }
      },
      handles,
      scene(ctx, outlineWidth) {
        try {
          if (draft && painter) {
            draft.validate();
            painter.paint(ctx, original.at, outlineWidth);
            return true;
          }
        } catch {
          /* Never render stale candidates. */
        }
        return false;
      },
    });
    try {
      const scope = captureLiveWaypoints(readSource);
      choices = scope.choices;
      scope.dispose();
      if (choices.length) select('0', 1);
      else message = 'No original waypoints on visible unlocked root tracks at this frame.';
      const originalPainter = createLiveStagePainter(original.snapshot, original.validate);
      base = originalPainter;
      void originalPainter.prepare(original.at, original.validate).then(
        () => {
          if (mounted) original.invalidate();
        },
        (cause) => {
          if (mounted) message = String(cause);
        },
      );
    } catch (cause) {
      message = String(cause);
    }
    return () => {
      mounted = false;
    };
  });
  onDestroy(() => {
    alive = false;
    controller?.dispose();
    paintTask.dispose();
    clear();
    selectionScope?.dispose();
    base?.dispose();
    original.connect(undefined);
  });
</script>

<section aria-label="Live waypoint positions" class="property-section">
  <h3>LIVE WAYPOINT</h3>
  <label
    >Original artwork<select
      aria-label="Live waypoint root"
      value={chosen}
      onchange={(e) => select(e.currentTarget.value, 1)}
    >
      {#each choices as choice, i}<option value={String(i)}
          >{choice.layerId} / {choice.spanId} / {choice.shapeId}</option
        >{/each}
    </select></label
  >
  <label
    >Waypoint number<input
      aria-label="Live waypoint number"
      type="number"
      min="1"
      max={choices[Number(chosen)]?.waypointCount}
      step="1"
      value={number}
      oninput={(e) => select(chosen, e.currentTarget.valueAsNumber)}
    /></label
  >
  <small>{choices[Number(chosen)]?.waypointCount ?? 0} waypoints in this path.</small>
  <label
    >Document X<input
      aria-label="Live waypoint document X"
      type="number"
      step="any"
      value={x}
      oninput={(e) => editTarget(e.currentTarget.valueAsNumber, y)}
    /></label
  >
  <label
    >Document Y<input
      aria-label="Live waypoint document Y"
      type="number"
      step="any"
      value={y}
      oninput={(e) => editTarget(x, e.currentTarget.valueAsNumber)}
    /></label
  >
  <label
    ><input
      aria-label="Live waypoint remembered children"
      type="checkbox"
      checked={children}
      onchange={(e) => {
        children = e.currentTarget.checked;
        if (draft) void renderPreview(draft);
        else original.invalidate();
      }}
    />Evaluate remembered child timelines</label
  >
  <label
    ><input
      aria-label="Drag live waypoints"
      type="checkbox"
      checked={enabled}
      onchange={(e) => {
        enabled = e.currentTarget.checked;
        policy++;
        controller?.changed();
        original.invalidate();
      }}
    />Drag original waypoint on the stage</label
  >
  <label
    ><input
      aria-label="Author live waypoint on release"
      type="checkbox"
      checked={authoring}
      onchange={(e) => {
        authoring = e.currentTarget.checked;
        authoringPolicy++;
        controller?.changed();
        original.invalidate();
      }}
    />Author live waypoint on release</label
  >
  <button disabled={!selectedOwner || dragging} onclick={preview}>Preview live waypoint</button>
  <button disabled={!draft || dragging} onclick={useDraft}>Use waypoint draft target</button>
  <button disabled={!selectedOwner || dragging} onclick={commit}>Commit live waypoint</button>
  <button
    onclick={() => {
      clear();
      message = 'Waypoint preview discarded. Numeric inputs remain.';
    }}>Discard live waypoint preview</button
  >
  <button onclick={original.close}>Close live waypoint positions</button>
  <p>
    Edits one existing waypoint in the shared path for every root in this tween. Preview is
    unapplied. Dragging normally creates a draft; Use waypoint draft target copies its coordinates
    to the numeric fields. Commit records one edit. Author on release is a separate opt-in.
  </p>
  <p role="status" aria-label="Live waypoint status">{message}</p>
</section>

<style>
  label {
    display: block;
    margin: 0.5rem 0;
  }
  input[type='number'],
  select {
    width: 100%;
  }
  button {
    margin: 0.2rem;
  }
</style>
