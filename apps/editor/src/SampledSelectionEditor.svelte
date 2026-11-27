<script lang="ts">
  import { untrack } from 'svelte';
  import SampledSelectionTrajectoryEditor from './SampledSelectionTrajectoryEditor.svelte';
  import type {
    SampledSelectionTrajectoryContext,
    SampledSelectionTrajectoryEdit,
  } from './sampled-selection-trajectory-editor';
  import {
    createSampledSelectionSkewDrag,
    type SelectionSkewLayout,
  } from './sampled-selection-skew-drag';
  import { sampledSelectionSkewHandles } from './sampled-skew-handles';
  import {
    createSampledSelectionScaleDrag,
    type SelectionScaleLayout,
  } from './sampled-selection-scale-drag';
  import {
    sampledSelectionScaleBounds,
    sampledSelectionScaleHandles,
  } from './sampled-scale-handles';
  import {
    createSampledSelectionRotationDrag,
    type SelectionRotationLayout,
  } from './sampled-selection-rotation-drag';
  import { sampledSelectionRotationHandle } from './sampled-rotation-handle';
  import { createSampledSelectionDrag, type SelectionDragView } from './sampled-selection-drag';
  import type {
    SampledSelectionOwner,
    SampledSelectionRotationOwner,
    SampledSelectionScaleOwner,
    SampledSelectionSkewOwner,
    SampledUnitRequest,
  } from '../../../packages/animation/src/selection-motion-owner';
  import {
    captureSampledSelectionContext,
    prepareSampledSelectionTranslation,
    prepareSampledSelectionRotation,
    prepareSampledSelectionScale,
    prepareSampledSelectionSkew,
    type SampledSelectionContext,
    type SampledSelectionEdit,
    type SampledSelectionPreview,
  } from './sampled-selection-editor';
  let {
    context,
    preview,
    selection,
    publish,
    surface,
    rotationHandle,
    scaleHandles,
    skewHandles,
    trajectoryContext,
    publishTrajectories,
    trajectoryHandles,
  }: {
    trajectoryHandles: (
      layout: {
        rect: { width: number; height: number };
        anchor: { x: number; y: number };
        original: { x: number; y: number };
        proposed: { x: number; y: number };
      } | null,
    ) => void;
    trajectoryContext: () => SampledSelectionTrajectoryContext | null;
    publishTrajectories: (
      edit: SampledSelectionTrajectoryEdit,
      finalAdmission?: () => void,
    ) => void;
    skewHandles: (layout: SelectionSkewLayout | null) => void;
    rotationHandle: (layout: SelectionRotationLayout | null) => void;
    scaleHandles: (layout: SelectionScaleLayout | null) => void;
    surface: () => { canvas: HTMLCanvasElement; view: SelectionDragView };
    context: SampledSelectionContext;
    preview: (value: SampledSelectionPreview | null) => void;
    selection: (owner: SampledSelectionOwner | null) => void;
    publish: (edit: SampledSelectionEdit) => void;
  } = $props();
  let routing = $state(false);
  function changeRouting(enabled: boolean) {
    cancelGestures();
    inputRevision++;
    discard();
    routing = enabled;
    error = '';
    if (!enabled) resolveOwner();
    else selection(null);
  }
  let choices = $state<SampledUnitRequest[]>([]),
    requests = $state.raw<SampledUnitRequest[]>([]);
  let owner = $state.raw<SampledSelectionOwner | null>(null);
  let rotationOwner = $state.raw<SampledSelectionRotationOwner | null>(null);
  let scaleOwner = $state.raw<SampledSelectionScaleOwner | null>(null);
  let skewOwner = $state.raw<SampledSelectionSkewOwner | null>(null);
  let skewBounds = $state.raw<ReturnType<typeof sampledSelectionScaleBounds> | null>(null);
  let skewCanvas = $state(false),
    skewPolicy = 0;
  let skewAuthoring = $state(false),
    skewAuthorPolicy = 0;
  function changeSkewAuthoring(enabled: boolean) {
    cancelGestures();
    skewAuthorPolicy++;
    skewAuthoring = enabled;
    skewControl?.policyChanged();
  }
  let skewControl: ReturnType<typeof createSampledSelectionSkewDrag> | undefined;
  function changeSkewCanvas(enabled: boolean) {
    cancelGestures();
    skewPolicy++;
    skewCanvas = enabled && shearing;
    skewControl?.policyChanged();
  }
  let shearing = $state(false),
    skewAxis = $state<'x' | 'y'>('x'),
    skewDegrees = $state<number | undefined>(0);
  let scaleBounds = $state.raw<ReturnType<typeof sampledSelectionScaleBounds> | null>(null);
  let scaleCanvas = $state(false),
    scalePolicy = 0;
  let scaleAuthoring = $state(false),
    scaleAuthorPolicy = 0;
  function changeScaleAuthoring(enabled: boolean) {
    cancelGestures();
    scaleAuthorPolicy++;
    scaleAuthoring = enabled;
    scaleControl?.policyChanged();
  }
  let scaleControl: ReturnType<typeof createSampledSelectionScaleDrag> | undefined;
  function changeScaleCanvas(enabled: boolean) {
    cancelGestures();
    scalePolicy++;
    scaleCanvas = enabled && scaling;
    scaleControl?.policyChanged();
  }
  let scaling = $state(false),
    scaleX = $state<number | undefined>(100),
    scaleY = $state<number | undefined>(100);
  let rotating = $state(false),
    degrees = $state<number | undefined>(0);
  let x = $state<number | undefined>(0),
    y = $state<number | undefined>(0),
    error = $state('');
  let proposed = $state(false),
    inputRevision = $state(0);
  let canvasEnabled = $state(false),
    dragging = $state(false),
    canvasPolicy = 0;
  let authoring = $state(false),
    authorPolicy = 0;
  let rotationCanvas = $state(false),
    rotationPolicy = 0;
  let rotationAuthoring = $state(false),
    rotationAuthorPolicy = 0;
  function changeRotationAuthoring(enabled: boolean) {
    cancelGestures();
    rotationAuthorPolicy++;
    rotationAuthoring = enabled;
    rotationControl?.policyChanged();
  }
  let rotationControl: ReturnType<typeof createSampledSelectionRotationDrag> | undefined;
  function cancelGestures() {
    dragControl?.cancel();
    rotationControl?.cancel();
    scaleControl?.cancel();
    skewControl?.cancel();
  }
  function changeRotationCanvas(enabled: boolean) {
    cancelGestures();
    rotationPolicy++;
    rotationCanvas = enabled && rotating;
    rotationControl?.policyChanged();
  }
  let currentPreview: SampledSelectionPreview | null = null;
  let dragControl: ReturnType<typeof createSampledSelectionDrag> | undefined;
  function putPreview(value: SampledSelectionPreview | null, live = false) {
    currentPreview = value;
    preview(value);
    if (!live) {
      proposed = !!value;
      if (value) error = '';
    }
  }
  function changeCanvas(enabled: boolean) {
    cancelGestures();
    canvasPolicy++;
    canvasEnabled = enabled && !rotating && !scaling && !shearing;
    dragControl?.policyChanged();
  }
  function changeAuthoring(enabled: boolean) {
    cancelGestures();
    authorPolicy++;
    authoring = enabled;
    dragControl?.policyChanged();
  }
  $effect(() => {
    const canvas = untrack(() => surface().canvas);
    if (!canvas) return;
    const control = untrack(() =>
      createSampledSelectionDrag({
        canvas,
        view: () => surface().view,
        state: () => ({
          context,
          requests,
          revision: inputRevision,
          policy: canvasPolicy,
          enabled: !routing && canvasEnabled && !rotating && !scaling && !shearing,
          authoring,
          authorPolicy,
          x,
          y,
          preview: currentPreview,
        }),
        draft: (dx, dy) => {
          x = dx;
          y = dy;
        },
        preview: putPreview,
        active: (value) => (dragging = value),
        error: (cause) => (error = String(cause)),
        publish: (edit) => {
          publish(edit);
          error = '';
        },
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
      }),
    );
    dragControl = control;
    return () => {
      control.dispose();
      if (dragControl === control) dragControl = undefined;
    };
  });
  $effect(() => {
    const v = surface().view;
    void [v.origin.x, v.origin.y, v.zoom, v.width, v.height];
    untrack(() => dragControl?.checkView());
  });
  $effect(() => {
    const canvas = untrack(() => surface().canvas);
    if (!canvas) return;
    const control = untrack(() =>
      createSampledSelectionRotationDrag({
        canvas,
        view: () => surface().view,
        state: () => ({
          context,
          requests,
          revision: inputRevision,
          policy: rotationPolicy,
          authoring: rotationAuthoring,
          authorPolicy: rotationAuthorPolicy,
          enabled: !routing && rotating && rotationCanvas && !shearing,
          degrees,
          preview: currentPreview,
        }),
        draft: (value) =>
          untrack(() => {
            degrees = value;
          }),
        preview: (value, live) => untrack(() => putPreview(value, live)),
        active: (value) =>
          untrack(() => {
            dragging = value;
          }),
        error: (cause) =>
          untrack(() => {
            error = String(cause);
          }),
        publish: (edit) =>
          untrack(() => {
            publish(edit);
            error = '';
          }),
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
      }),
    );
    rotationControl = control;
    return () => {
      control.dispose();
      if (rotationControl === control) rotationControl = undefined;
    };
  });
  $effect(() => {
    const original = context,
      selected = rotationOwner,
      value = degrees,
      enabled = !routing && rotating && rotationCanvas && !shearing;
    const { canvas, view } = surface();
    const { origin, zoom, width, height } = view;
    void [origin.x, origin.y, zoom, width, height];
    let active = true;
    const refresh = () =>
      untrack(() => {
        if (!active) return;
        rotationControl?.checkView();
        try {
          if (!enabled || !selected || !Number.isFinite(value)) {
            rotationHandle(null);
            return;
          }
          original.validate();
          const rect = canvas.getBoundingClientRect(),
            v = { ...view, cssWidth: rect.width, cssHeight: rect.height };
          const base = sampledSelectionRotationHandle(selected.pivot, v),
            proposed = sampledSelectionRotationHandle(selected.pivot, v, value);
          original.validate();
          rotationHandle({
            rect: { width: rect.width, height: rect.height },
            center: base.center,
            original: base.knob,
            proposed: proposed.knob,
          });
        } catch {
          rotationHandle(null);
        }
      });
    refresh();
    const observer = new ResizeObserver(refresh);
    if (canvas) observer.observe(canvas);
    return () => {
      active = false;
      observer.disconnect();
      untrack(() => rotationHandle(null));
    };
  });
  $effect(() => {
    const canvas = untrack(() => surface().canvas);
    if (!canvas) return;
    const control = untrack(() =>
      createSampledSelectionScaleDrag({
        canvas,
        view: () => surface().view,
        state: () => ({
          context,
          requests,
          revision: inputRevision,
          policy: scalePolicy,
          scaleAuthoring,
          scaleAuthorPolicy,
          enabled: !routing && scaling && scaleCanvas && !shearing,
          x: scaleX,
          y: scaleY,
          preview: currentPreview,
        }),
        draft: (x, y) =>
          untrack(() => {
            scaleX = x;
            scaleY = y;
          }),
        preview: (value, live) => untrack(() => putPreview(value, live)),
        active: (value) =>
          untrack(() => {
            dragging = value;
          }),
        error: (cause) =>
          untrack(() => {
            error = String(cause);
          }),
        publish: (edit) =>
          untrack(() => {
            publish(edit);
            error = '';
          }),
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
      }),
    );
    scaleControl = control;
    return () => {
      control.dispose();
      if (scaleControl === control) scaleControl = undefined;
    };
  });
  $effect(() => {
    const original = context,
      selected = scaleOwner,
      box = scaleBounds,
      sx = scaleX,
      sy = scaleY,
      enabled = !routing && scaling && scaleCanvas && !shearing;
    const { canvas, view } = surface();
    const { origin, zoom, width, height } = view;
    void [origin.x, origin.y, zoom, width, height];
    let active = true;
    const refresh = () =>
      untrack(() => {
        if (!active) return;
        scaleControl?.checkView();
        try {
          if (!enabled || !selected || !box || !Number.isFinite(sx) || !Number.isFinite(sy)) {
            scaleHandles(null);
            return;
          }
          original.validate();
          const rect = canvas.getBoundingClientRect(),
            v = { ...view, cssWidth: rect.width, cssHeight: rect.height };
          const base = sampledSelectionScaleHandles(box, selected.pivot, v),
            proposed = sampledSelectionScaleHandles(box, selected.pivot, v, {
              x: sx! / 100,
              y: sy! / 100,
            });
          original.validate();
          scaleHandles({
            rect: { width: rect.width, height: rect.height },
            original: base.handles,
            proposed: proposed.handles,
          });
        } catch {
          scaleHandles(null);
        }
      });
    refresh();
    const observer = new ResizeObserver(refresh);
    if (canvas) observer.observe(canvas);
    return () => {
      active = false;
      observer.disconnect();
      untrack(() => scaleHandles(null));
    };
  });
  $effect(() => {
    const canvas = untrack(() => surface().canvas);
    if (!canvas) return;
    const control = untrack(() =>
      createSampledSelectionSkewDrag({
        canvas,
        view: () => surface().view,
        state: () => ({
          context,
          requests,
          revision: inputRevision,
          policy: skewPolicy,
          skewAuthoring,
          skewAuthorPolicy,
          enabled: !routing && shearing && skewCanvas,
          axis: skewAxis,
          degrees: skewDegrees,
          preview: currentPreview,
        }),
        draft: (axis, value) =>
          untrack(() => {
            skewAxis = axis;
            skewDegrees = value;
          }),
        preview: (value, live) => untrack(() => putPreview(value, live)),
        active: (value) =>
          untrack(() => {
            dragging = value;
          }),
        error: (cause) =>
          untrack(() => {
            error = String(cause);
          }),
        publish: (edit) =>
          untrack(() => {
            publish(edit);
            error = '';
          }),
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
      }),
    );
    skewControl = control;
    return () => {
      control.dispose();
      if (skewControl === control) skewControl = undefined;
    };
  });
  $effect(() => {
    const original = context,
      selected = skewOwner,
      box = skewBounds,
      axis = skewAxis,
      value = skewDegrees,
      enabled = !routing && shearing && skewCanvas;
    const { canvas, view } = surface(),
      { origin, zoom, width, height } = view;
    void [origin.x, origin.y, zoom, width, height];
    let active = true;
    const refresh = () =>
      untrack(() => {
        if (!active) return;
        skewControl?.checkView();
        try {
          if (!enabled || !selected || !box || !Number.isFinite(value)) {
            skewHandles(null);
            return;
          }
          original.validate();
          const rect = canvas.getBoundingClientRect(),
            v = { ...view, cssWidth: rect.width, cssHeight: rect.height };
          const base = sampledSelectionSkewHandles(box, selected.pivot, v),
            proposed = sampledSelectionSkewHandles(box, selected.pivot, v, axis, value);
          original.validate();
          skewHandles({
            rect: { width: rect.width, height: rect.height },
            original: base.handles,
            proposed: proposed.handles,
            outline: proposed.outline,
          });
        } catch {
          skewHandles(null);
        }
      });
    refresh();
    const observer = new ResizeObserver(refresh);
    if (canvas) observer.observe(canvas);
    return () => {
      active = false;
      observer.disconnect();
      untrack(() => skewHandles(null));
    };
  });
  const valid = $derived(!!owner && Number.isFinite(x) && Number.isFinite(y) && (!!x || !!y));
  const rotationValid = $derived(
    !!rotationOwner && Number.isFinite(degrees) && !!degrees && degrees % 360 !== 0,
  );
  const scaleValid = $derived(
    !!scaleOwner &&
      Number.isFinite(scaleX) &&
      Number.isFinite(scaleY) &&
      !!scaleX &&
      !!scaleY &&
      (scaleX !== 100 || scaleY !== 100),
  );
  const skewValid = $derived(
    !!skewOwner && Number.isFinite(skewDegrees) && !!skewDegrees && skewDegrees % 180 !== 0,
  );
  function discard() {
    cancelGestures();
    putPreview(null);
  }
  $effect(() => {
    const original = context;
    untrack(() => {
      cancelGestures();
      inputRevision++;
      requests = [];
      owner = null;
      rotationOwner = null;
      scaleOwner = null;
      skewOwner = null;
      skewBounds = null;
      skewAxis = 'x';
      skewDegrees = 0;
      scaleBounds = null;
      scaleX = scaleY = 100;
      degrees = 0;
      x = y = 0;
      error = '';
      discard();
      selection(null);
      try {
        const { capture, active } = captureSampledSelectionContext(original);
        try {
          choices = capture.choices;
          active();
        } finally {
          capture.dispose();
        }
      } catch (cause) {
        choices = [];
        error = String(cause);
      }
    });
    return () => {
      cancelGestures();
      putPreview(null);
      selection(null);
    };
  });
  function choose(choice: SampledUnitRequest, checked: boolean) {
    cancelGestures();
    inputRevision++;
    discard();
    requests = checked
      ? [...requests, { ...choice }]
      : requests.filter((r) => r.layerId !== choice.layerId || r.shapeId !== choice.shapeId);
    if (!routing) resolveOwner();
    else selection(null);
  }
  function resolveOwner() {
    owner = null;
    rotationOwner = null;
    scaleOwner = null;
    skewOwner = null;
    skewBounds = null;
    scaleBounds = null;
    selection(null);
    error = '';
    if (!requests.length) return;
    try {
      const original = context,
        revision = inputRevision,
        input = requests,
        mode = shearing ? 'skew' : scaling ? 'scale' : rotating ? 'rotation' : 'translation';
      const check = () => {
        if (
          context !== original ||
          revision !== inputRevision ||
          requests !== input ||
          (shearing ? 'skew' : scaling ? 'scale' : rotating ? 'rotation' : 'translation') !== mode
        )
          throw Error('The sampled selection changed.');
      };
      const { capture, active } = captureSampledSelectionContext(original, check);
      try {
        const resolved =
          mode === 'skew'
            ? capture.resolveSkew(input, { validate: active })
            : mode === 'scale'
              ? capture.resolveScale(input, { validate: active })
              : mode === 'rotation'
                ? capture.resolveRotation(input, { validate: active })
                : capture.resolveSelection(input, { validate: active });
        active();
        owner = resolved;
        rotationOwner = mode === 'rotation' ? (resolved as SampledSelectionRotationOwner) : null;
        scaleOwner = mode === 'scale' ? (resolved as SampledSelectionScaleOwner) : null;
        skewOwner = mode === 'skew' ? (resolved as SampledSelectionSkewOwner) : null;
        if (scaleOwner || skewOwner) {
          const scene = capture.scene;
          const bounds = sampledSelectionScaleBounds(
            (scaleOwner ?? skewOwner)!.tracks.flatMap((t) =>
              scene
                .find((l) => l.layerId === t.layerId)!
                .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
            ),
          );
          if (scaleOwner) scaleBounds = bounds;
          else skewBounds = bounds;
          active();
        }
        selection(resolved);
      } finally {
        capture.dispose();
      }
    } catch (cause) {
      error = String(cause);
    }
  }
  function changeRotation(enabled: boolean) {
    cancelGestures();
    inputRevision++;
    discard();
    rotating = enabled;
    if (enabled) {
      shearing = false;
      changeSkewCanvas(false);
      scaling = false;
      changeScaleCanvas(false);
    }
    rotationControl?.policyChanged();
    if (enabled) changeCanvas(false);
    resolveOwner();
  }
  function changeScale(enabled: boolean) {
    cancelGestures();
    inputRevision++;
    discard();
    scaling = enabled;
    if (!enabled) changeScaleCanvas(false);
    if (enabled) {
      shearing = false;
      changeSkewCanvas(false);
      rotating = false;
      changeCanvas(false);
      changeRotationCanvas(false);
    }
    resolveOwner();
  }
  function changeSkew(enabled: boolean) {
    cancelGestures();
    inputRevision++;
    discard();
    shearing = enabled;
    if (!enabled) changeSkewCanvas(false);
    if (enabled) {
      rotating = scaling = false;
      changeCanvas(false);
      changeRotationCanvas(false);
      changeScaleCanvas(false);
    }
    resolveOwner();
  }
  function skewTarget(axis: 'x' | 'y', value: string) {
    cancelGestures();
    inputRevision++;
    discard();
    skewAxis = axis;
    skewDegrees = value === '' ? undefined : Number(value);
  }
  function scaleTarget(axis: 'x' | 'y', value: string) {
    cancelGestures();
    inputRevision++;
    discard();
    if (axis === 'x') scaleX = value === '' ? undefined : Number(value);
    else scaleY = value === '' ? undefined : Number(value);
  }
  function angle(value: string) {
    cancelGestures();
    inputRevision++;
    discard();
    degrees = value === '' ? undefined : Number(value);
  }
  function target(axis: 'x' | 'y', value: string) {
    cancelGestures();
    inputRevision++;
    discard();
    if (axis === 'x') x = value === '' ? undefined : Number(value);
    else y = value === '' ? undefined : Number(value);
  }
  function prepare() {
    const original = context,
      revision = inputRevision,
      input = requests,
      dx = x,
      dy = y;
    const check = () => {
      if (
        context !== original ||
        shearing ||
        rotating ||
        scaling ||
        dragging ||
        inputRevision !== revision ||
        requests !== input ||
        x !== dx ||
        y !== dy
      )
        throw Error('The original sampled selection or offsets changed.');
    };
    return prepareSampledSelectionTranslation(
      original,
      input,
      { x: dx ?? NaN, y: dy ?? NaN },
      check,
    );
  }
  function prepareRotation() {
    const original = context,
      revision = inputRevision,
      input = requests,
      value = degrees;
    const check = () => {
      if (
        context !== original ||
        !rotating ||
        shearing ||
        scaling ||
        dragging ||
        inputRevision !== revision ||
        requests !== input ||
        degrees !== value
      )
        throw Error('The original sampled selection or rotation changed.');
    };
    return prepareSampledSelectionRotation(original, input, value ?? NaN, check);
  }
  function prepareScale() {
    const original = context,
      revision = inputRevision,
      input = requests,
      sx = scaleX,
      sy = scaleY;
    const check = () => {
      if (
        context !== original ||
        !scaling ||
        shearing ||
        rotating ||
        dragging ||
        inputRevision !== revision ||
        requests !== input ||
        scaleX !== sx ||
        scaleY !== sy
      )
        throw Error('The original sampled selection or scale changed.');
    };
    return prepareSampledSelectionScale(
      original,
      input,
      (sx ?? NaN) / 100,
      (sy ?? NaN) / 100,
      check,
    );
  }
  function prepareSkew() {
    const original = context,
      revision = inputRevision,
      input = requests,
      axis = skewAxis,
      value = skewDegrees;
    const check = () => {
      if (
        context !== original ||
        !shearing ||
        scaling ||
        rotating ||
        dragging ||
        inputRevision !== revision ||
        requests !== input ||
        skewAxis !== axis ||
        skewDegrees !== value
      )
        throw Error('The original sampled selection or skew changed.');
    };
    return prepareSampledSelectionSkew(original, input, axis, value ?? NaN, check);
  }
  function show() {
    if (dragging) return;
    try {
      const edit = shearing
          ? prepareSkew()
          : scaling
            ? prepareScale()
            : rotating
              ? prepareRotation()
              : prepare(),
        original = context,
        pose = original.sample(edit.candidate);
      edit.validate();
      putPreview({ context: original, owner: edit.owner, pose, validate: edit.validate, discard });
      proposed = true;
      error = '';
    } catch (cause) {
      discard();
      error = String(cause);
    }
  }
  function commit() {
    if (dragging) return;
    try {
      publish(
        shearing
          ? prepareSkew()
          : scaling
            ? prepareScale()
            : rotating
              ? prepareRotation()
              : prepare(),
      );
      error = '';
    } catch (cause) {
      discard();
      error = String(cause);
    }
  }
</script>

<fieldset aria-label="Sampled selection set">
  <legend>Original sampled units</legend>
  <label
    ><input
      type="checkbox"
      aria-label="Edit sampled selection trajectories"
      checked={routing}
      onchange={(event) => changeRouting(event.currentTarget.checked)}
    />Edit whole-track trajectories</label
  >
  <fieldset disabled={routing} aria-label="Sampled selection transform modes">
    <label
      ><input
        type="checkbox"
        aria-label="Skew sampled selection"
        checked={shearing}
        onchange={(event) => changeSkew(event.currentTarget.checked)}
      />Skew around the original selection pivot</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Scale sampled selection"
        checked={scaling}
        onchange={(event) => changeScale(event.currentTarget.checked)}
      />Scale around the original selection pivot</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Rotate sampled selection"
        checked={rotating}
        onchange={(event) => changeRotation(event.currentTarget.checked)}
      />Rotate around the original selection pivot</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Drag sampled selection offsets"
        checked={canvasEnabled}
        disabled={rotating || scaling || shearing}
        onchange={(event) => changeCanvas(event.currentTarget.checked)}
      />Drag the original selected artwork to set offsets</label
    >
    {#if canvasEnabled}<small
        >Original selected artwork owns picks. Shift constrains the document axis. Release keeps an
        unapplied draft unless selection-set release authoring is enabled.</small
      >{/if}
    <label
      ><input
        type="checkbox"
        aria-label="Author sampled selection drag on release"
        checked={authoring}
        disabled={rotating || scaling || shearing}
        onchange={(event) => changeAuthoring(event.currentTarget.checked)}
      />Author this selection on release</label
    >
  </fieldset>
  <small>Choose roots or complete outer groups. Numeric changes stay unapplied until Commit.</small>
  {#each choices as choice (JSON.stringify([choice.layerId, choice.shapeId]))}
    <label
      ><input
        type="checkbox"
        aria-label={'Sampled unit ' + choice.layerId + '/' + choice.shapeId}
        checked={requests.some((r) => r.layerId === choice.layerId && r.shapeId === choice.shapeId)}
        onchange={(event) => choose(choice, event.currentTarget.checked)}
      />{choice.layerId} · {choice.shapeId}</label
    >
  {/each}
  {#if !choices.length}<small>No eligible sampled units at this frame.</small>{/if}
  {#if owner && !routing}<output aria-label="Sampled selection readout"
      >{owner.units.length} units · {owner.tracks.length} tracks · {owner.tracks.reduce(
        (n, t) => n + t.shapeIds.length,
        0,
      )} artwork members</output
    >{/if}
  {#if routing}
    <SampledSelectionTrajectoryEditor
      {surface}
      handles={trajectoryHandles}
      scope={inputRevision}
      {context}
      {requests}
      createContext={trajectoryContext}
      preview={(value) => {
        if (routing) putPreview(value, true);
      }}
      selection={(value) => {
        if (routing) selection(value);
      }}
      publish={publishTrajectories}
    />
  {:else}
    {#if shearing}
      <label
        ><input
          type="checkbox"
          aria-label="Drag sampled selection skew"
          checked={skewCanvas}
          onchange={(event) => changeSkewCanvas(event.currentTarget.checked)}
        />Drag original skew handles</label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Author sampled selection skew on release"
          checked={skewAuthoring}
          onchange={(event) => changeSkewAuthoring(event.currentTarget.checked)}
        />Author skew on release</label
      >
      {#if skewCanvas}<small
          >Original handles own picks. Shift snaps the skew angle to 15°. Release keeps an unapplied
          draft unless skew release authoring is enabled.</small
        >{/if}
      {#if skewOwner}<output aria-label="Sampled selection skew pivot"
          >Original pivot · {skewOwner.pivot.x.toFixed(2)}, {skewOwner.pivot.y.toFixed(2)}</output
        >{/if}
      <label
        >Skew axis<select
          aria-label="Sampled selection skew axis"
          value={skewAxis}
          onchange={(event) =>
            skewTarget(
              event.currentTarget.value as 'x' | 'y',
              skewDegrees === undefined ? '' : String(skewDegrees),
            )}
        >
          <option value="x">X</option><option value="y">Y</option></select
        ></label
      >
      <label
        >Skew (degrees)<input
          aria-label="Sampled selection skew degrees"
          type="number"
          step="any"
          value={skewDegrees ?? ''}
          oninput={(event) => skewTarget(skewAxis, event.currentTarget.value)}
        /></label
      >
      <button disabled={!skewValid || dragging} onclick={show}
        >Preview sampled selection skew</button
      >
      <button disabled={!skewValid || dragging} onclick={commit}
        >Commit sampled selection skew</button
      >
    {:else if scaling}
      <label
        ><input
          type="checkbox"
          aria-label="Drag sampled selection scale"
          checked={scaleCanvas}
          onchange={(event) => changeScaleCanvas(event.currentTarget.checked)}
        />Drag original scale handles</label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Author sampled selection scale on release"
          checked={scaleAuthoring}
          onchange={(event) => changeScaleAuthoring(event.currentTarget.checked)}
        />Author scale on release</label
      >
      {#if scaleCanvas}<small
          >Original handles own picks. Shift keeps corner proportions; edge handles keep one axis.
          Release stays unapplied until Commit unless scale release authoring is enabled.</small
        >{/if}
      {#if scaleOwner}<output aria-label="Sampled selection scale pivot"
          >Original pivot · {scaleOwner.pivot.x.toFixed(2)}, {scaleOwner.pivot.y.toFixed(2)}</output
        >{/if}
      <label
        >X scale (%)<input
          aria-label="Sampled selection X scale"
          type="number"
          step="any"
          value={scaleX ?? ''}
          oninput={(event) => scaleTarget('x', event.currentTarget.value)}
        /></label
      >
      <label
        >Y scale (%)<input
          aria-label="Sampled selection Y scale"
          type="number"
          step="any"
          value={scaleY ?? ''}
          oninput={(event) => scaleTarget('y', event.currentTarget.value)}
        /></label
      >
      <button disabled={!scaleValid || dragging} onclick={show}
        >Preview sampled selection scale</button
      >
      <button disabled={!scaleValid || dragging} onclick={commit}
        >Commit sampled selection scale</button
      >
    {:else if rotating}
      <label
        ><input
          type="checkbox"
          aria-label="Drag sampled selection rotation"
          checked={rotationCanvas}
          onchange={(event) => changeRotationCanvas(event.currentTarget.checked)}
        />Drag the original rotation handle</label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Author sampled selection rotation on release"
          checked={rotationAuthoring}
          disabled={!rotationCanvas}
          onchange={(event) => changeRotationAuthoring(event.currentTarget.checked)}
        />Author rotation on release</label
      >
      {#if rotationCanvas}<small
          >Shift snaps the rotation change to 15°. Release keeps an unapplied proposal unless Author
          rotation on release is enabled.</small
        >{/if}
      {#if rotationOwner}<output aria-label="Sampled selection rotation pivot"
          >Original pivot · {rotationOwner.pivot.x.toFixed(2)}, {rotationOwner.pivot.y.toFixed(
            2,
          )}</output
        >{/if}
      <label
        >Rotation (degrees)<input
          aria-label="Sampled selection rotation degrees"
          type="number"
          step="any"
          value={degrees ?? ''}
          oninput={(event) => angle(event.currentTarget.value)}
        /></label
      >
      <button disabled={!rotationValid || dragging} onclick={show}
        >Preview sampled selection rotation</button
      >
      <button disabled={!rotationValid || dragging} onclick={commit}
        >Commit sampled selection rotation</button
      >
    {:else}
      <label
        >X offset<input
          aria-label="Sampled selection X offset"
          type="number"
          step="any"
          value={x ?? ''}
          oninput={(event) => target('x', event.currentTarget.value)}
        /></label
      >
      <label
        >Y offset<input
          aria-label="Sampled selection Y offset"
          type="number"
          step="any"
          value={y ?? ''}
          oninput={(event) => target('y', event.currentTarget.value)}
        /></label
      >
      <button disabled={!valid || dragging} onclick={show}
        >Preview sampled selection translation</button
      >
      <button disabled={!valid || dragging} onclick={commit}
        >Commit sampled selection translation</button
      >
    {/if}
    {#if proposed}<p role="status" aria-label="Sampled selection preview">
        {shearing
          ? `Proposed selection skew · ${skewAxis.toUpperCase()} · ${skewDegrees}°`
          : scaling
            ? `Proposed selection scale · ${scaleX}%, ${scaleY}%`
            : rotating
              ? `Proposed selection rotation · ${degrees}°`
              : `Proposed selection translation · ${x}, ${y}`}
      </p>
      <button onclick={discard}>Discard sampled selection preview</button>{/if}
  {/if}
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
  input[type='number'] {
    width: 6rem;
  }
  small,
  output {
    flex-basis: 100%;
  }
</style>
