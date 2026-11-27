<script module lang="ts">
  import type { LiveCubicStageHooks } from './LiveCubicEditor.svelte';
  export type LiveGroupCubicStageHooks = LiveCubicStageHooks;
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { Point, Project } from '../../../packages/document/src';
  import {
    captureLiveGroupCubicControls,
    prepareLiveGroupCubicControlPositions,
    type LiveGroupCubicControlOwner,
  } from '../../../packages/animation/src/live-group-cubic-controls';
  import {
    captureLiveIndependentGroupCubicControls,
    prepareLiveIndependentGroupCubicControlPositions,
  } from '../../../packages/animation/src/live-independent-group-cubic-controls';
  import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
  import { prepareLiveMotionFrameCapture } from '../../../packages/animation/src/live-motion-presentation';
  import {
    createLiveGroupCubicDrag,
    createLiveIndependentGroupCubicAuthoringDrag,
    type LiveGroupCubicDraft,
    type LiveGroupCubicDragState,
    type LiveGroupCubicPick,
    type LiveGroupCubicView,
  } from './live-group-cubic-drag';
  import { createLiveStagePainter } from './live-stage-paint';
  import { createLatestFrameTask } from './latest-frame-task';
  let {
    independent = false,
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
    independent?: boolean;
    snapshot: Project;
    at: number;
    canvas: HTMLCanvasElement;
    view: () => LiveGroupCubicView;
    validate: () => void;
    publish: (pick: LiveGroupCubicPick, target: Point, validate: () => void) => void;
    close: () => void;
    connect: (hooks: LiveGroupCubicStageHooks | undefined) => void;
    invalidate: () => void;
  } = $props();
  const original = untrack(() => ({
    independent,
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
  const captureControls = original.independent
    ? captureLiveIndependentGroupCubicControls
    : captureLiveGroupCubicControls;
  const prepareControls = original.independent
    ? prepareLiveIndependentGroupCubicControlPositions
    : prepareLiveGroupCubicControlPositions;
  const fieldPrefix = original.independent ? 'Independent group curve' : 'Live group curve';
  const actionPrefix = original.independent ? 'independent group curve' : 'live group curve';
  const context = {
    readSource: () => {
      original.validate();
      return { project: original.snapshot, revision: 0, frame: original.at };
    },
    validate: original.validate,
  };
  let choices = $state<ReturnType<typeof captureLiveGroupCubicControls>['choices']>([]),
    chosen = $state('');
  let x = $state(NaN),
    y = $state(NaN),
    enabled = $state(false),
    authoring = $state(false),
    children = $state(false),
    dragging = $state(false);
  let message = $state('Preparing original curve handles…'),
    draft = $state.raw<LiveGroupCubicDraft | null>(null);
  let selectedOwner = $state.raw<LiveGroupCubicControlOwner>();
  const inputs: LiveGroupCubicDragState = {
    context,
    pick: { layerId: '', spanId: '', groupId: '', role: 'start' },
    target: { x: NaN, y: NaN },
    revision: 0,
    policy: 0,
    enabled: false,
    authoring: false,
    authoringPolicy: 0,
    independentAuthoring: false,
    independentAuthoringPolicy: 0,
    preview: null,
  };
  let controller: ReturnType<typeof createLiveGroupCubicDrag> | undefined;
  let selectionScope: ReturnType<typeof captureLiveGroupCubicControls> | undefined;
  let numericScope: ReturnType<typeof captureLiveGroupCubicControls> | undefined;
  let base: ReturnType<typeof createLiveStagePainter> | undefined;
  let painter: ReturnType<typeof createLiveStagePainter> | undefined;
  let preparing: ReturnType<typeof createLiveStagePainter> | undefined;
  let alive = true,
    serial = 0,
    renderJob: AbortController | undefined;
  function clearPaint() {
    serial++;
    renderJob?.abort();
    renderJob = undefined;
    preparing?.dispose();
    preparing = undefined;
    painter?.dispose();
    painter = undefined;
    original.invalidate();
  }
  const paintTask = createLatestFrameTask<LiveGroupCubicDraft>({
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
  async function renderPreview(value: LiveGroupCubicDraft) {
    clearPaint();
    const job = new AbortController(),
      owned = serial,
      rememberedChildren = children;
    renderJob = job;
    const current = () => {
      job.signal.throwIfAborted();
      original.validate();
      value.validate();
      if (!alive || owned !== serial || draft !== value || rememberedChildren !== children)
        throw Error('Live group curve render changed.');
    };
    let next: ReturnType<typeof createLiveStagePainter> | undefined;
    try {
      current();
      const project = rememberedChildren
        ? await prepareLiveMotionFrameCapture(
            () => {
              current();
              return { project: value.project, revision: 0 };
            },
            original.at,
            { signal: job.signal, validate: current, rememberedChildren: true },
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
      message = original.independent
        ? 'Unapplied independent group curve preview. Commit keeps the current frame.'
        : 'Unapplied live group curve preview. Use numeric Commit to author it.';
      original.invalidate();
    } catch (cause) {
      if (alive && owned === serial) {
        message = String(cause);
        original.invalidate();
      }
    } finally {
      if (preparing === next) preparing = undefined;
      next?.dispose();
    }
  }
  function preview(value: LiveGroupCubicDraft | null) {
    inputs.preview = value;
    draft = value;
    paintTask.cancel();
    clearPaint();
    if (value) paintTask.request(value);
  }
  function clear() {
    controller?.cancel();
    numericScope?.dispose();
    numericScope = undefined;
    preview(null);
  }
  function editTarget(nx: number, ny: number) {
    x = nx;
    y = ny;
    inputs.target = { x, y };
    inputs.revision++;
    clear();
    message = 'Numeric target changed. Preview or Commit prepares it freshly.';
  }
  function pick(value: string) {
    const index = Number(value),
      hint = choices[index];
    if (!Number.isSafeInteger(index) || String(index) !== value || !hint) {
      message = 'Choose an original live group curve control.';
      return;
    }
    inputs.revision++;
    clear();
    selectionScope?.dispose();
    selectedOwner = undefined;
    inputs.pick = { layerId: '', spanId: '', groupId: '', role: 'start' };
    try {
      original.validate();
      const scope = captureControls(context.readSource);
      try {
        const owner = scope.resolve(hint.layerId, hint.spanId, hint.groupId, hint.role);
        original.validate();
        inputs.pick = Object.freeze({
          layerId: owner.layerId,
          spanId: owner.spanId,
          groupId: owner.groupId,
          role: owner.role,
        });
        inputs.target = { ...owner.point };
        x = owner.point.x;
        y = owner.point.y;
        selectedOwner = owner;
        chosen = value;
        selectionScope = scope;
      } catch (cause) {
        scope.dispose();
        throw cause;
      }
      message = original.independent
        ? 'Original independent control selected. Preview leaves the document unchanged.'
        : 'Original control selected. Dragging and authoring on release are separate opt-ins.';
    } catch (cause) {
      message = String(cause);
    }
    original.invalidate();
  }
  function admitInput() {
    const revision = inputs.revision,
      pick = inputs.pick,
      target = { x, y };
    if (!selectedOwner || !Number.isFinite(x) || !Number.isFinite(y))
      throw Error('Enter finite document X and Y.');
    const active = () => {
      original.validate();
      if (
        !alive ||
        inputs.revision !== revision ||
        inputs.pick !== pick ||
        !Object.is(x, target.x) ||
        !Object.is(y, target.y)
      )
        throw Error('Live group curve numeric inputs changed.');
    };
    active();
    return { pick, target, active };
  }
  function numericPreview() {
    try {
      controller?.cancel();
      numericScope?.dispose();
      preview(null);
      const input = admitInput(),
        scope = captureControls(context.readSource);
      numericScope = scope;
      const owner = scope.resolve(
        input.pick.layerId,
        input.pick.spanId,
        input.pick.groupId,
        input.pick.role,
      );
      const target = Object.freeze(input.target);
      const project = prepareControls([{ owner, target }], {
        validate: input.active,
      });
      const stamp = selectionTrajectoryStamp(project);
      const value: LiveGroupCubicDraft = Object.freeze({
        project,
        owner,
        target,
        validate: () => {
          input.active();
          scope.assertCurrent();
          if (selectionTrajectoryStamp(project) !== stamp)
            throw Error('Live group curve preview candidate changed.');
        },
      });
      value.validate();
      preview(value);
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
  function screen(p: Readonly<Point>, v: LiveGroupCubicView, r: DOMRect) {
    return {
      x: ((p.x * v.zoom + v.origin.x) * r.width) / v.width,
      y: ((p.y * v.zoom + v.origin.y) * r.height) / v.height,
    };
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
        owner = selectedOwner;
      const span = original.snapshot.layers
        .find((l) => l.id === owner.layerId)!
        .liveMotionSpans!.find((s) => s.id === owner.spanId)!;
      const shape = original.snapshot.layers
        .find((l) => l.id === owner.layerId)!
        .keys.find((k) => k.frame === (owner.role === 'start' ? span.start : span.end))!
        .shapes.find((s) => s.id === owner.shapeId)!;
      const anchor = screen(shape, v, r),
        point = screen(owner.point, v, r);
      ctx.save();
      saved = true;
      const dpr = original.canvas.width / v.width;
      ctx.setTransform((dpr * v.width) / r.width, 0, 0, (dpr * v.height) / r.height, 0, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#007eaa';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (draft && painter) {
        draft.validate();
        const proposed = screen(draft.target, v, r);
        ctx.fillStyle = '#007eaa';
        ctx.beginPath();
        ctx.arc(proposed.x, proposed.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    } catch {
      /* Source changes remove ownership; parent lifetime closes the mode. */
    } finally {
      if (saved) ctx.restore();
    }
  }
  onMount(() => {
    let mounted = true;
    controller = (
      original.independent ? createLiveIndependentGroupCubicAuthoringDrag : createLiveGroupCubicDrag
    )({
      canvas: original.canvas,
      view: original.view,
      state: () => inputs,
      foreground(owner, point) {
        if (!base) return false;
        const foreground = base.foregroundIdentity(original.at, point, 0);
        return (
          !foreground ||
          (foreground.layerId === owner.layerId &&
            (original.independent ? owner.groupShapeIds : owner.shapeIds).includes(
              foreground.shapeId,
            ))
        );
      },
      preview: (value) => preview(value),
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
      },
      move: (e) => {
        controller?.move(e);
      },
      up: (e) => {
        controller?.up(e);
      },
      cancel: () => {
        const cancelled = controller?.cancel();
        if (original.independent && !cancelled) {
          clear();
          message = 'Independent curve preview discarded. Numeric inputs remain.';
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
          /* Never paint stale drafts. */
        }
        return false;
      },
    });
    try {
      const scope = captureControls(context.readSource);
      choices = scope.choices;
      scope.dispose();
      if (choices.length) pick('0');
      else message = 'No original single-cubic controls on visible unlocked tracks at this frame.';
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
    clearPaint();
    selectionScope?.dispose();
    numericScope?.dispose();
    base?.dispose();
    original.connect(undefined);
  });
</script>

<section aria-label={`${fieldPrefix} controls`} class="property-section">
  <h3>{original.independent ? 'INDEPENDENT GROUP CURVE CONTROL' : 'LIVE GROUP CURVE CONTROL'}</h3>
  <label
    >Original control<select
      aria-label={`${fieldPrefix} control`}
      value={chosen}
      onchange={(e) => pick(e.currentTarget.value)}
      disabled={dragging}
    >
      {#each choices as choice, i}<option value={String(i)}
          >{choice.layerId} / {choice.spanId} / {choice.groupId} / {choice.role}</option
        >{/each}
    </select></label
  >
  <label
    ><input
      aria-label={`Drag ${actionPrefix} controls`}
      type="checkbox"
      checked={enabled}
      onchange={(e) => {
        enabled = e.currentTarget.checked;
        inputs.enabled = enabled;
        inputs.policy++;
        controller?.changed();
        original.invalidate();
      }}
    />Drag original handles on the stage</label
  >
  <label
    ><input
      aria-label={`Author ${actionPrefix} on release`}
      type="checkbox"
      checked={authoring}
      onchange={(e) => {
        authoring = e.currentTarget.checked;
        if (original.independent) {
          inputs.independentAuthoring = authoring;
          inputs.independentAuthoringPolicy!++;
        } else {
          inputs.authoring = authoring;
          inputs.authoringPolicy!++;
        }
        controller?.changed();
        original.invalidate();
      }}
    />Author {actionPrefix} on release</label
  >
  <label
    >Document X<input
      aria-label={`${fieldPrefix} document X`}
      type="number"
      step="any"
      value={x}
      oninput={(e) => editTarget(e.currentTarget.valueAsNumber, y)}
    /></label
  >
  <label
    >Document Y<input
      aria-label={`${fieldPrefix} document Y`}
      type="number"
      step="any"
      value={y}
      oninput={(e) => editTarget(x, e.currentTarget.valueAsNumber)}
    /></label
  >
  <label
    ><input
      aria-label={`${fieldPrefix} remembered children`}
      type="checkbox"
      checked={children}
      onchange={(e) => {
        children = e.currentTarget.checked;
        inputs.revision++;
        clear();
      }}
    />Evaluate remembered child timelines</label
  >
  <button disabled={!selectedOwner || dragging} onclick={numericPreview}
    >Preview {actionPrefix} control</button
  >
  <button
    disabled={!draft || dragging}
    onclick={() => {
      const point = draft!.target;
      editTarget(point.x, point.y);
    }}>Use {original.independent ? 'independent ' : ''}group curve draft target</button
  >
  <button disabled={!selectedOwner || dragging} onclick={commit}
    >Commit {actionPrefix} control</button
  >
  <button
    onclick={() => {
      clear();
      message = 'Curve preview discarded. Numeric inputs remain.';
    }}>Discard {actionPrefix} preview</button
  >
  <button onclick={original.close}>Close {actionPrefix} controls</button>
  {#if original.independent}<p>
      Original authored leader endpoints define this independent path's controls. Preview moves only
      the selected group and leaves the document unchanged. Commit freshly prepares one undoable
      edit at the current frame. Shared routes and other groups stay intact. Opt-in dragging creates
      history-free drafts; Use draft copies the target to numeric fields before a fresh Commit.
      Author on release separately opts into one edit when a valid drag ends.
    </p>{:else}<p>
      Drags normally create unapplied previews. Use draft copies its target to the numeric fields;
      Commit freshly prepares one undoable edit. Author on release opts into that edit when a drag
      ends. The original first member references shared offsets for every group and loose shape in
      this tween. Other curve settings stay intact.
    </p>{/if}
  <p role="status" aria-label={`${fieldPrefix} status`}>{message}</p>
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
