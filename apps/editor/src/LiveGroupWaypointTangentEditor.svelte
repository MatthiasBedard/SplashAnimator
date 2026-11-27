<script module lang="ts">
  export type LiveGroupWaypointTangentPick = Readonly<{
    layerId: string;
    spanId: string;
    groupId: string;
    waypointIndex: number;
    role: 'incoming' | 'outgoing';
  }>;
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import {
    createLiveGroupWaypointTangentDrag,
    type LiveGroupWaypointTangentDraft,
  } from './live-group-waypoint-tangent-drag';
  import { createLatestFrameTask } from './latest-frame-task';
  import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
  import type { Point, Project } from '../../../packages/document/src';
  import {
    captureLiveGroupWaypointTangents,
    prepareLiveGroupWaypointTangentPositions,
    prepareLiveGroupWaypointTangentPairs,
    type LiveGroupWaypointTangentOwner,
    type LiveGroupWaypointTangentRole,
  } from '../../../packages/animation/src/live-group-waypoint-tangents';
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
    publish: (
      pick: LiveGroupWaypointTangentPick,
      target: Point,
      validate: () => void,
      coupling?: 'independent' | 'aligned',
    ) => void;
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
  type Scope = ReturnType<typeof captureLiveGroupWaypointTangents>;
  type Draft = LiveGroupWaypointTangentDraft & { readonly opposite?: Readonly<Point> };
  let coupling = $state<'independent' | 'aligned'>('independent');
  let couplingRevision = 0;
  let selectedOpposite = $state.raw<LiveGroupWaypointTangentOwner>();
  let choices = $state<Scope['choices']>([]),
    chosen = $state(''),
    number = $state(1),
    role = $state<LiveGroupWaypointTangentRole>('outgoing'),
    x = $state(NaN),
    y = $state(NaN),
    children = $state(false),
    enabled = $state(false),
    alignedEnabled = $state(false),
    authoring = $state(false),
    alignedAuthoring = $state(false),
    dragging = $state(false);
  let message = $state('Preparing original waypoints…'),
    selectedOwner = $state.raw<LiveGroupWaypointTangentOwner>(),
    draft = $state.raw<Draft | null>(null);
  let pick: LiveGroupWaypointTangentPick | undefined,
    revision = 0,
    preparation = 0,
    selectionScope: Scope | undefined,
    numericScope: Scope | undefined;
  let policy = 0,
    alignedPolicy = 0,
    authoringPolicy = 0,
    alignedAuthoringPolicy = 0;
  const context = { readSource, validate: original.validate };
  const emptyPick: LiveGroupWaypointTangentPick = Object.freeze({
    layerId: '',
    spanId: '',
    groupId: '',
    waypointIndex: 0,
    role: 'outgoing',
  });
  let controller: ReturnType<typeof createLiveGroupWaypointTangentDrag> | undefined;
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
    preparation++;
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
      const value = draft;
      if (!value || dragging) return;
      value.validate();
      const point = { ...value.target };
      value.validate();
      if (draft !== value) throw Error('Group waypoint handle draft changed.');
      editTarget(point.x, point.y);
    } catch (cause) {
      message = String(cause);
    }
  }
  function editCoupling(value: string) {
    coupling = value as typeof coupling;
    couplingRevision++;
    revision++;
    clear();
    selectedOpposite = undefined;
    const owned = revision;
    try {
      if (coupling !== 'independent' && coupling !== 'aligned')
        throw Error('Choose independent or aligned waypoint controls.');
      if (coupling === 'aligned' && pick && selectionScope) {
        const identity = pick,
          scope = selectionScope;
        scope.assertCurrent();
        const opposite = scope.resolve(
          identity.layerId,
          identity.spanId,
          identity.groupId,
          identity.waypointIndex,
          identity.role === 'incoming' ? 'outgoing' : 'incoming',
        );
        original.validate();
        if (revision !== owned || pick !== identity || selectionScope !== scope)
          throw Error('Original group handle coupling changed.');
        selectedOpposite = opposite;
      }
      if (revision === owned) message = 'Coupling changed. Preview or Commit prepares it freshly.';
    } catch (cause) {
      if (revision === owned) message = String(cause);
    }
    original.invalidate();
  }
  function editTarget(nx: number, ny: number) {
    x = nx;
    y = ny;
    revision++;
    clear();
    message = 'Target changed. Preview or Commit prepares it freshly.';
  }
  function select(root: string, waypoint: number, nextRole: LiveGroupWaypointTangentRole = role) {
    revision++;
    clear();
    selectionScope?.dispose();
    selectionScope = undefined;
    selectedOwner = undefined;
    selectedOpposite = undefined;
    pick = undefined;
    chosen = root;
    number = waypoint;
    role = nextRole;
    const selectionRevision = revision;
    const assertSelection = () => {
      original.validate();
      if (
        revision !== selectionRevision ||
        chosen !== root ||
        !Object.is(number, waypoint) ||
        role !== nextRole
      )
        throw Error('Original group handle selection changed during preparation.');
    };
    x = NaN;
    y = NaN;
    try {
      const index = Number(root),
        hint = choices[index];
      if (!Number.isSafeInteger(index) || String(index) !== root || !hint)
        throw Error('Choose original artwork.');
      if (!Number.isSafeInteger(waypoint) || waypoint < 1)
        throw Error('Enter a whole waypoint number starting at 1.');
      const scope = captureLiveGroupWaypointTangents(readSource);
      try {
        const owner = scope.resolve(
          hint.layerId,
          hint.spanId,
          hint.groupId,
          waypoint - 1,
          nextRole,
        );
        const opposite =
          coupling === 'aligned'
            ? scope.resolve(
                hint.layerId,
                hint.spanId,
                hint.groupId,
                waypoint - 1,
                nextRole === 'incoming' ? 'outgoing' : 'incoming',
              )
            : undefined;
        assertSelection();
        selectedOpposite = opposite;
        pick = Object.freeze({
          layerId: owner.layerId,
          spanId: owner.spanId,
          groupId: owner.groupId,
          waypointIndex: owner.waypointIndex,
          role: owner.role,
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
      if (revision === selectionRevision) message = String(cause);
    }
    if (revision === selectionRevision) original.invalidate();
  }
  function admitInput() {
    const inputRevision = revision,
      identity = pick,
      owner = selectedOwner,
      root = chosen,
      waypoint = number,
      selectedRole = role,
      mode = coupling,
      modeRevision = couplingRevision,
      opposite = selectedOpposite,
      target = { x, y };
    if (!identity || !owner || !Number.isFinite(x) || !Number.isFinite(y))
      throw Error('Choose an original waypoint and finite document X and Y.');
    if ((mode !== 'independent' && mode !== 'aligned') || (mode === 'aligned' && !opposite))
      throw Error('Choose supported original group handle coupling.');
    const active = () => {
      original.validate();
      if (
        !alive ||
        revision !== inputRevision ||
        pick !== identity ||
        selectedOwner !== owner ||
        chosen !== root ||
        !Object.is(number, waypoint) ||
        role !== selectedRole ||
        coupling !== mode ||
        couplingRevision !== modeRevision ||
        selectedOpposite !== opposite ||
        !Object.is(x, target.x) ||
        !Object.is(y, target.y)
      )
        throw Error('Live group waypoint handle inputs changed.');
    };
    active();
    return { pick: identity, target, active, coupling: mode };
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
        throw Error('Live group waypoint handle preview changed.');
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
      message = 'Unapplied live group waypoint handle preview. Commit records one edit.';
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
    clear();
    const ticket = preparation;
    let pending: Scope | undefined;
    try {
      const input = admitInput();
      const active = () => {
        input.active();
        if (!alive || ticket !== preparation)
          throw Error('Group waypoint preview preparation was superseded.');
      };
      active();
      const scope = captureLiveGroupWaypointTangents(readSource);
      pending = scope;
      active();
      const owner = scope.resolve(
          input.pick.layerId,
          input.pick.spanId,
          input.pick.groupId,
          input.pick.waypointIndex,
          input.pick.role,
        ),
        target = Object.freeze(input.target);
      const project =
        input.coupling === 'aligned'
          ? prepareLiveGroupWaypointTangentPairs([{ owner, target }], {
              coupling: 'aligned',
              validate: active,
            })
          : prepareLiveGroupWaypointTangentPositions([{ owner, target }], { validate: active });
      const stamp = selectionTrajectoryStamp(project);
      let opposite: Readonly<Point> | undefined;
      if (input.coupling === 'aligned') {
        const path = project.layers
          .find((l) => l.id === owner.layerId)!
          .liveMotionSpans!.find((s) => s.id === owner.spanId)!.path!;
        const control =
          owner.role === 'incoming'
            ? path.waypointTangents![owner.waypointIndex + 1]
            : path.waypointIncoming![owner.waypointIndex];
        opposite = Object.freeze({ x: owner.anchor.x + control.x, y: owner.anchor.y + control.y });
      }
      const value: Draft = Object.freeze({
        project,
        owner,
        target,
        opposite,
        validate() {
          active();
          scope.assertCurrent();
          validateLiveGraphicData(project);
          if (selectionTrajectoryStamp(project) !== stamp)
            throw Error('Live group waypoint handle preview candidate changed.');
          active();
        },
      });
      value.validate();
      numericScope = scope;
      pending = undefined;
      draft = value;
      void renderPreview(value);
    } catch (cause) {
      if (alive && ticket === preparation) message = String(cause);
    } finally {
      pending?.dispose();
    }
  }
  function commit() {
    try {
      const input = admitInput();
      original.publish(input.pick, input.target, input.active, input.coupling);
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
      const point = screen(selectedOwner.point),
        anchor = screen(selectedOwner.anchor);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.fillRect(anchor.x - 2, anchor.y - 2, 4, 4);
      ctx.strokeRect(anchor.x - 2, anchor.y - 2, 4, 4);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (coupling === 'aligned' && selectedOpposite) {
        const opposite = screen(selectedOpposite.point);
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(opposite.x, opposite.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(opposite.x, opposite.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
      if (draft && painter) {
        draft.validate();
        if (draft.opposite) {
          const opposite = screen(draft.opposite);
          ctx.fillStyle = '#007eaa';
          ctx.beginPath();
          ctx.moveTo(anchor.x, anchor.y);
          ctx.lineTo(opposite.x, opposite.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(opposite.x, opposite.y, 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
        const proposed = screen(draft.target);
        ctx.fillStyle = '#007eaa';
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(proposed.x, proposed.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(proposed.x, proposed.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        if (coupling === 'aligned' && selectedOpposite) {
          const opposite = screen(selectedOpposite.point);
          ctx.beginPath();
          ctx.arc(opposite.x, opposite.y, 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
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
    controller = createLiveGroupWaypointTangentDrag({
      canvas: original.canvas,
      view: original.view,
      state: () => ({
        context,
        pick: pick ?? emptyPick,
        target: { x, y },
        revision,
        enabled: coupling === 'aligned' ? alignedEnabled : enabled,
        policy: coupling === 'aligned' ? alignedPolicy : policy,
        ...(coupling === 'aligned'
          ? { coupling, couplingRevision, alignedAuthoring, alignedAuthoringPolicy }
          : {}),
        authoring: authoring && coupling === 'independent',
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
      publish: original.publish,
      publishAligned: (pick, target, validate) =>
        original.publish(pick, target, validate, 'aligned'),
      preview: (value) => showDraft(value),
      active: (value) => {
        dragging = value;
      },
      error: (cause) => {
        message = String(cause);
      },
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
      const scope = captureLiveGroupWaypointTangents(readSource);
      choices = scope.choices;
      scope.dispose();
      if (choices.length) select('0', 1);
      else
        message =
          'No original explicit waypoint handles on visible unlocked rigid outer groups at this frame.';
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

<section aria-label="Live group waypoint handle positions" class="property-section">
  <h3>LIVE GROUP WAYPOINT HANDLE</h3>
  {#if selectedOwner}<small
      >{selectedOwner.groupShapeIds.length} group members; {selectedOwner.shapeIds.length} artwork items
      share this path.</small
    >{/if}
  <label
    >Original group<select
      aria-label="Live group waypoint handle group"
      value={chosen}
      onchange={(e) => select(e.currentTarget.value, 1)}
    >
      {#each choices as choice, i}<option value={String(i)}
          >{choice.layerId} / {choice.spanId} / {choice.groupId}</option
        >{/each}
    </select></label
  >
  <label
    >Waypoint number<input
      aria-label="Live group waypoint handle number"
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
    >Handle role<select
      aria-label="Live group waypoint handle role"
      value={role}
      onchange={(e) =>
        select(chosen, number, e.currentTarget.value as LiveGroupWaypointTangentRole)}
      ><option value="outgoing">Outgoing</option><option value="incoming">Incoming</option></select
    ></label
  >
  <label
    >Handle coupling<select
      aria-label="Live group waypoint handle coupling"
      value={coupling}
      onchange={(e) => editCoupling(e.currentTarget.value)}
    >
      <option value="independent">Independent</option><option value="aligned"
        >Align opposite handle</option
      >
    </select></label
  >
  <label
    >Document X<input
      aria-label="Live group waypoint handle document X"
      type="number"
      step="any"
      value={x}
      oninput={(e) => editTarget(e.currentTarget.valueAsNumber, y)}
    /></label
  >
  <label
    >Document Y<input
      aria-label="Live group waypoint handle document Y"
      type="number"
      step="any"
      value={y}
      oninput={(e) => editTarget(x, e.currentTarget.valueAsNumber)}
    /></label
  >
  <label
    ><input
      aria-label="Live group waypoint handle remembered children"
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
      aria-label="Drag live group waypoint handles"
      type="checkbox"
      disabled={coupling !== 'independent'}
      checked={enabled}
      onchange={(e) => {
        enabled = e.currentTarget.checked;
        policy++;
        controller?.changed();
        original.invalidate();
      }}
    />Drag original group waypoint handles</label
  >
  <label
    ><input
      aria-label="Drag aligned live group waypoint handles"
      type="checkbox"
      disabled={coupling !== 'aligned'}
      checked={alignedEnabled}
      onchange={(e) => {
        alignedEnabled = e.currentTarget.checked;
        alignedPolicy++;
        controller?.changed();
        original.invalidate();
      }}
    />Drag aligned original group waypoint handles</label
  >
  <label
    ><input
      aria-label="Author live group waypoint handle on release"
      type="checkbox"
      disabled={coupling !== 'independent'}
      checked={authoring}
      onchange={(e) => {
        authoring = e.currentTarget.checked;
        authoringPolicy++;
        controller?.changed();
        original.invalidate();
      }}
    />Author live group waypoint handle on release</label
  >
  <label
    ><input
      aria-label="Author aligned live group waypoint handles on release"
      type="checkbox"
      disabled={coupling !== 'aligned'}
      checked={alignedAuthoring}
      onchange={(event) => {
        alignedAuthoring = event.currentTarget.checked;
        alignedAuthoringPolicy++;
        controller?.changed();
        original.invalidate();
      }}
    />Author aligned group waypoint handles on release</label
  >
  <button disabled={!selectedOwner || dragging} onclick={preview}
    >Preview live group waypoint handle</button
  >
  <button disabled={!draft || dragging} onclick={useDraft}
    >Use group waypoint handle draft target</button
  >
  <button disabled={!selectedOwner || dragging} onclick={commit}
    >Commit live group waypoint handle</button
  >
  <button
    onclick={() => {
      clear();
      message = 'Waypoint preview discarded. Numeric inputs remain.';
    }}>Discard live group waypoint handle preview</button
  >
  <button onclick={original.close}>Close live group waypoint handle positions</button>
  <p>
    Edits one existing explicit incoming or outgoing control in the shared curved path for every
    group and loose artwork item in this tween. The original first group member supplies the
    reference point. Dragging creates an unapplied draft; Use group waypoint handle draft target
    copies its coordinates to the numeric fields. Preview is unapplied; Commit records one edit.
    Author on release is a separate independent-mode opt-in. Aligned edits preserve the original
    opposite handle radius. Aligned dragging has a separate opt-in and always releases an unapplied
    draft; Use target and Commit save it explicitly.
  </p>
  <p role="status" aria-label="Live group waypoint handle status">{message}</p>
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
