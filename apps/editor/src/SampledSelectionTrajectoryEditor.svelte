<script lang="ts">
  import {
    createSampledSelectionTrajectoryDrag,
    type TrajectoryDragView,
  } from './sampled-selection-trajectory-drag';
  import type { Point } from '../../../packages/document/src';
  import { untrack } from 'svelte';
  import type {
    SampledUnitRequest,
    SampledSelectionOwner,
  } from '../../../packages/animation/src/selection-motion-owner';
  import type {
    SampledSelectionContext,
    SampledSelectionPreview,
  } from './sampled-selection-editor';
  import {
    resolveSampledSelectionTrajectories,
    resolveSampledSelectionCubicControl,
    prepareSampledSelectionTrajectories,
    sampleSampledSelectionTrajectories,
    type SampledSelectionTrajectoryContext,
    type SampledSelectionTrajectoryEdit,
    type SampledSelectionCubicRoute,
    type SampledSelectionCubicControls,
  } from './sampled-selection-trajectory-editor';
  let {
    context,
    requests,
    scope,
    createContext,
    preview,
    selection,
    publish,
    surface,
    handles,
  }: {
    surface: () => { canvas: HTMLCanvasElement; view: TrajectoryDragView };
    handles: (
      layout: {
        rect: { width: number; height: number };
        anchor: Point;
        original: Point;
        proposed: Point;
      } | null,
    ) => void;
    context: SampledSelectionContext;
    scope: number;
    requests: readonly SampledUnitRequest[];
    createContext: () => SampledSelectionTrajectoryContext | null;
    preview: (value: SampledSelectionPreview | null) => void;
    selection: (owner: SampledSelectionOwner | null) => void;
    publish: (edit: SampledSelectionTrajectoryEdit, finalAdmission?: () => void) => void;
  } = $props();
  type Fields = {
    layerId: string;
    startX: number | undefined;
    startY: number | undefined;
    endX: number | undefined;
    endY: number | undefined;
  };
  const fields = ['startX', 'startY', 'endX', 'endY'] as const;
  const labels = { startX: 'start X', startY: 'start Y', endX: 'end X', endY: 'end Y' };
  let original = $state.raw<SampledSelectionTrajectoryContext | null>(null),
    routes = $state.raw<SampledSelectionCubicRoute[]>([]),
    controls = $state.raw<Fields[]>([]),
    names = $state.raw<Record<string, string>>({});
  let owner = $state.raw<SampledSelectionOwner | null>(null),
    error = $state(''),
    proposed = $state(false);
  let generation = 0,
    revision = 0;
  let currentPreview = $state.raw<SampledSelectionPreview | null>(null),
    dragging = $state(false),
    canvasEnabled = $state(false),
    track = $state(''),
    role = $state<'start' | 'end'>('start'),
    authoring = $state(false);
  let authorPolicy = 0;
  let policy = 0,
    control: ReturnType<typeof createSampledSelectionTrajectoryDrag> | undefined;
  function putPreview(value: SampledSelectionPreview | null, live = false) {
    currentPreview = value;
    preview(value);
    if (!live) proposed = !!value;
  }
  function discard() {
    control?.cancel();
    putPreview(null);
  }
  function gesturePolicy(enabled: boolean) {
    control?.cancel();
    policy++;
    canvasEnabled = enabled;
    control?.policyChanged();
  }
  function changeAuthoring(enabled: boolean) {
    control?.cancel();
    authorPolicy++;
    authoring = enabled;
    control?.policyChanged();
  }
  function chooseTrack(value: string) {
    control?.cancel();
    policy++;
    track = value;
    control?.policyChanged();
  }
  function chooseRole(value: string) {
    control?.cancel();
    policy++;
    role = value === 'end' ? 'end' : 'start';
    control?.policyChanged();
  }
  $effect(() => {
    const canvas = untrack(() => surface().canvas);
    if (!canvas) return;
    const gesture = createSampledSelectionTrajectoryDrag({
      canvas,
      view: () => surface().view,
      state: () => ({
        context: original!,
        displayContext: context,
        requests,
        revision,
        policy,
        authoring,
        authorPolicy,
        enabled: canvasEnabled && !!original && !!owner,
        layerId: track,
        role,
        controls: controls as SampledSelectionCubicControls[],
        preview: currentPreview,
      }),
      draft: (values) => {
        controls = values as Fields[];
      },
      preview: (value, live) => {
        putPreview(value, live);
        if (value && !live) error = '';
      },
      active: (value) => {
        dragging = value;
      },
      error: (cause) => {
        error = String(cause);
      },
      publish: (edit, finalAdmission) => untrack(() => publish(edit, finalAdmission)),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    });
    control = gesture;
    return () => {
      gesture.dispose();
      if (control === gesture) control = undefined;
    };
  });
  let geometryCache:
    | {
        context: SampledSelectionTrajectoryContext;
        requests: readonly SampledUnitRequest[];
        layer: string;
        role: 'start' | 'end';
        scope: number;
        generation: number;
        anchor: Point;
        point: Point;
      }
    | undefined;
  $effect(() => {
    const captured = original,
      selected = requests,
      layer = track,
      part = role,
      enabled = canvasEnabled,
      values = controls,
      job = generation,
      scopeValue = scope,
      inputRevision = revision,
      gesturePolicy = policy;
    const { canvas, view } = surface();
    void [view.origin.x, view.origin.y, view.zoom, view.width, view.height];
    const refresh = () =>
      untrack(() => {
        control?.checkView();
        if (!enabled || !captured || !owner || !canvas) {
          handles(null);
          return;
        }
        try {
          const check = () => {
            if (
              original !== captured ||
              requests !== selected ||
              track !== layer ||
              role !== part ||
              scope !== scopeValue ||
              generation !== job ||
              controls !== values ||
              revision !== inputRevision ||
              policy !== gesturePolicy ||
              canvasEnabled !== enabled
            )
              throw Error('Original cubic display scope changed.');
          };
          if (
            !geometryCache ||
            geometryCache.context !== captured ||
            geometryCache.requests !== selected ||
            geometryCache.layer !== layer ||
            geometryCache.role !== part ||
            geometryCache.scope !== scopeValue ||
            geometryCache.generation !== job
          ) {
            const source = resolveSampledSelectionCubicControl(
              captured,
              selected,
              layer,
              part,
              check,
            );
            geometryCache = {
              context: captured,
              requests: selected,
              layer,
              role: part,
              scope: scopeValue,
              generation: job,
              anchor: { ...source.anchor },
              point: { ...source.point },
            };
          } else captured.validate();
          check();
          const geometry = geometryCache,
            r = canvas.getBoundingClientRect(),
            value = values.find((c) => c.layerId === layer),
            x = value?.[part === 'start' ? 'startX' : 'endX'],
            y = value?.[part === 'start' ? 'startY' : 'endY'];
          if (!Number.isFinite(x) || !Number.isFinite(y) || r.width <= 0 || r.height <= 0)
            throw Error('Enter finite cubic offsets.');
          const project = (p: Point) => ({
            x: ((p.x * view.zoom + view.origin.x) * r.width) / view.width,
            y: ((p.y * view.zoom + view.origin.y) * r.height) / view.height,
          });
          const layout = {
            rect: { width: r.width, height: r.height },
            anchor: project(geometry.anchor),
            original: project(geometry.point),
            proposed: project({ x: geometry.anchor.x + x!, y: geometry.anchor.y + y! }),
          };
          if (
            ![layout.original.x, layout.original.y, layout.proposed.x, layout.proposed.y].every(
              Number.isFinite,
            )
          )
            throw Error('Cubic display overflow.');
          check();
          handles(layout);
        } catch {
          handles(null);
        }
      });
    refresh();
    const observer = new ResizeObserver(refresh);
    if (canvas) observer.observe(canvas);
    return () => {
      observer.disconnect();
      untrack(() => handles(null));
    };
  });
  $effect(() => {
    const source = context,
      selected = requests,
      originalScope = scope;
    untrack(() => {
      control?.cancel();
      const job = ++generation;
      revision++;
      original = null;
      routes = [];
      controls = [];
      owner = null;
      discard();
      selection(null);
      error = '';
      if (!selected.length) return;
      const check = () => {
        if (
          context !== source ||
          requests !== selected ||
          scope !== originalScope ||
          generation !== job
        )
          throw Error('The original trajectory selection changed.');
      };
      try {
        const captured = createContext();
        if (!captured) throw Error('Finish pending edits before choosing trajectories.');
        const hints = resolveSampledSelectionTrajectories(captured, selected, check);
        names = Object.fromEntries(
          captured.snapshot().layers.map((layer) => [layer.id, layer.name]),
        );
        check();
        original = captured;
        routes = hints.routes;
        owner = hints.owner;
        controls = routes.map((route) => ({
          layerId: route.layerId,
          startX: route.path.startX,
          startY: route.path.startY,
          endX: route.path.endX,
          endY: route.path.endY,
        }));
        if (!routes.some((r) => r.layerId === track)) track = routes[0]?.layerId ?? '';
        selection(owner);
      } catch (cause) {
        error = String(cause);
      }
    });
    return () =>
      untrack(() => {
        generation++;
        revision++;
        discard();
        selection(null);
      });
  });
  const valid = $derived(
    !!owner &&
      !!original &&
      controls.length === routes.length &&
      controls.every(
        (value, index) =>
          fields.every((field) => Number.isFinite(value[field])) &&
          fields.some((field) => value[field] !== routes[index].path[field]),
      ),
  );
  function target(layerId: string, field: (typeof fields)[number], value: string) {
    control?.cancel();
    revision++;
    discard();
    controls = controls.map((control) =>
      control.layerId === layerId
        ? { ...control, [field]: value === '' ? undefined : Number(value) }
        : control,
    );
  }
  function prepare() {
    const captured = original,
      source = context,
      selected = requests,
      values = controls,
      job = generation,
      inputRevision = revision,
      originalScope = scope;
    if (!captured || !valid)
      throw Error('Enter finite changed cubic offsets for every selected track.');
    const check = () => {
      if (
        scope !== originalScope ||
        original !== captured ||
        context !== source ||
        requests !== selected ||
        controls !== values ||
        generation !== job ||
        revision !== inputRevision
      )
        throw Error('The original trajectory or numeric controls changed.');
    };
    return prepareSampledSelectionTrajectories(
      captured,
      selected,
      values.map((value) => ({
        ...value,
        startX: value.startX ?? NaN,
        startY: value.startY ?? NaN,
        endX: value.endX ?? NaN,
        endY: value.endY ?? NaN,
      })) satisfies SampledSelectionCubicControls[],
      check,
    );
  }
  function show() {
    try {
      const edit = prepare(),
        pose = sampleSampledSelectionTrajectories(edit);
      edit.validate();
      putPreview({ context, owner: edit.owner, pose, validate: edit.validate, discard });
      error = '';
    } catch (cause) {
      discard();
      error = String(cause);
    }
  }
  function commit() {
    try {
      const edit = prepare();
      publish(edit);
      error = '';
    } catch (cause) {
      discard();
      error = String(cause);
    }
  }
</script>

<fieldset aria-label="Sampled selection trajectories">
  <legend>Whole-track trajectories</legend>
  <label
    ><input
      type="checkbox"
      aria-label="Drag selection trajectory controls"
      checked={canvasEnabled}
      disabled={!owner}
      onchange={(event) => gesturePolicy(event.currentTarget.checked)}
    />Drag original cubic controls</label
  >
  <label
    ><input
      type="checkbox"
      aria-label="Author selection trajectory on release"
      checked={authoring}
      onchange={(event) => changeAuthoring(event.currentTarget.checked)}
    />Author complete trajectories on release</label
  >
  <label
    >Track<select
      aria-label="Selection trajectory gesture track"
      value={track}
      onchange={(event) => chooseTrack(event.currentTarget.value)}
      >{#each routes as route}<option value={route.layerId}
          >{names[route.layerId] ?? route.layerId}</option
        >{/each}</select
    ></label
  >
  <label
    >Control<select
      aria-label="Selection trajectory control role"
      value={role}
      onchange={(event) => chooseRole(event.currentTarget.value)}
      ><option value="start">Start</option><option value="end">End</option></select
    ></label
  >
  {#if canvasEnabled}<small
      >Drag the original circle. Shift constrains a document axis. Release keeps an unapplied draft
      unless authoring is enabled; Commit is also explicit. Every selected track needs changed
      controls.</small
    >{/if}
  <small
    >Select every root or complete group in each affected track. Offsets use document coordinates;
    endpoints stay fixed.</small
  >
  {#if owner}<output aria-label="Trajectory selection readout"
      >{owner.units.length} units · {owner.tracks.length} tracks · {owner.tracks.reduce(
        (n, track) => n + track.shapeIds.length,
        0,
      )} artwork members</output
    >{/if}
  {#each controls as control (control.layerId)}
    <fieldset aria-label={'Trajectory track ' + control.layerId}>
      <legend>{names[control.layerId] ?? control.layerId}</legend>
      {#each fields as field}<label
          >{labels[field]}<input
            aria-label={'Selection trajectory ' + control.layerId + ' ' + labels[field]}
            type="number"
            step="any"
            value={control[field] ?? ''}
            oninput={(event) => target(control.layerId, field, event.currentTarget.value)}
          /></label
        >{/each}
    </fieldset>
  {/each}
  <button disabled={!valid || dragging} onclick={show}>Preview selection trajectories</button>
  <button disabled={!valid || dragging} onclick={commit}>Commit selection trajectories</button>
  {#if proposed}<output aria-label="Selection trajectory proposal"
      >Proposed whole-track trajectories</output
    ><button onclick={discard}>Discard selection trajectory preview</button>{/if}
  {#if !requests.length}<small>Choose original units to edit complete tracks.</small>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid #705361;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  input {
    width: 6rem;
  }
  small,
  output {
    flex-basis: 100%;
  }
</style>
