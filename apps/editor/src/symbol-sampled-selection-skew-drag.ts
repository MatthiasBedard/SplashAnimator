import { symbolLayers, type Point } from '../../../packages/document/src';
import { hit } from '../../../packages/geometry/src';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import {
  captureSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionSkew,
  type SymbolSampledSelectionContext,
  type SymbolSampledSelectionPreview,
  type SymbolSampledSelectionPose,
  type SymbolSampledSelectionEdit,
} from './symbol-sampled-selection-editor';
import type { SelectionDragView } from './sampled-selection-drag';
import { rotationLocal } from './sampled-rotation-handle';
import { sampledSelectionScaleBounds } from './sampled-scale-handles';
import { sampledSelectionSkewHandles, sampledSkewAngle } from './sampled-skew-handles';
import { createLatestFrameTask } from './latest-frame-task';

export interface SymbolSelectionSkewDragState {
  context: SymbolSampledSelectionContext<SymbolSampledSelectionPose>;
  requests: readonly SampledUnitRequest[];
  revision: number;
  policy: number;
  enabled: boolean;
  skewAuthoring?: boolean;
  skewAuthorPolicy?: number;
  axis: 'x' | 'y';
  degrees: number | undefined;
  preview: SymbolSampledSelectionPreview | null;
}
export interface SelectionSkewLayout {
  rect: { width: number; height: number };
  original: { id: string; point: Point }[];
  proposed: { id: string; point: Point }[];
  outline: Point[];
}
type View = SelectionDragView & { left: number; top: number; cssWidth: number; cssHeight: number };
type Target = Readonly<{ axis: 'x' | 'y'; degrees: number }>;
type Drag = {
  generation: number;
  pointer: number;
  state: SymbolSelectionSkewDragState;
  requests: SampledUnitRequest[];
  count: number;
  view: View;
  pivot: Point;
  box: ReturnType<typeof sampledSelectionScaleBounds>;
  handle: string;
  start: Point;
  offset: Point;
  target: Target;
  observer?: ResizeObserver;
};

/** Original handles own capture. Only the dedicated captured skew-authoring
 * policy may publish a fresh release through normal isolated admission. */
export function createSymbolSampledSelectionSkewDrag(options: {
  canvas: HTMLCanvasElement;
  view(): SelectionDragView;
  state(): SymbolSelectionSkewDragState;
  draft(axis: 'x' | 'y', degrees: number | undefined): void;
  preview(value: SymbolSampledSelectionPreview | null, live: boolean): void;
  active(value: boolean): void;
  preparing(value: boolean): void;
  publish?(edit: SymbolSampledSelectionEdit): void;
  error(cause: unknown): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}) {
  const { canvas } = options;
  let drag: Drag | undefined,
    releasing: Drag | undefined,
    generation = 0,
    disposed = false;
  let ownedProposal: SymbolSampledSelectionPreview | null = null;
  const state = () => ({ ...options.state() });
  let settling = 0;
  function work<T>(run: () => T): T {
    options.preparing(true);
    try {
      return run();
    } finally {
      options.preparing(false);
    }
  }
  function view(): View {
    const source = options.view(),
      origin = { x: source.origin.x, y: source.origin.y };
    const zoom = source.zoom,
      width = source.width,
      height = source.height,
      rect = canvas.getBoundingClientRect();
    if (
      ![
        origin.x,
        origin.y,
        zoom,
        width,
        height,
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      ].every(Number.isFinite) ||
      Math.min(zoom, width, height, rect.width, rect.height) <= 0
    )
      throw Error('Invalid sampled selection skew view.');
    return {
      origin,
      zoom,
      width,
      height,
      left: rect.left,
      top: rect.top,
      cssWidth: rect.width,
      cssHeight: rect.height,
    };
  }
  const viewStamp = (v: View) => JSON.stringify(v);
  function inputs(g: Drag, target: Target, policy = true) {
    const current = state(),
      original = g.state;
    if (
      disposed ||
      current.context !== original.context ||
      current.requests !== original.requests ||
      current.requests.length !== g.count ||
      current.revision !== original.revision ||
      current.axis !== target.axis ||
      current.degrees !== target.degrees ||
      (policy &&
        (current.enabled !== true ||
          current.policy !== original.policy ||
          current.skewAuthoring !== original.skewAuthoring ||
          current.skewAuthorPolicy !== original.skewAuthorPolicy))
    )
      throw Error('The original selection skew inputs changed.');
  }
  function assert(g: Drag, target: Target, active = true) {
    const check = () => {
      if (
        generation !== g.generation ||
        (active && (drag !== g || !canvas.hasPointerCapture(g.pointer))) ||
        viewStamp(view()) !== viewStamp(g.view)
      )
        throw Error('The selection skew capture or view changed.');
      inputs(g, target);
    };
    check();
    g.state.context.validate();
    check();
  }
  function cleanup(g: Drag) {
    task.cancel();
    if (drag === g) drag = undefined;
    if (releasing === g) releasing = undefined;
    g.observer?.disconnect();
    if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
    options.active(false);
  }
  function restore(g: Drag) {
    try {
      inputs(g, g.target, false);
      g.state.context.validate();
      inputs(g, g.target, false);
      options.draft(g.state.axis, g.state.degrees);
      g.state.preview?.validate();
      options.preview(g.state.preview, false);
    } catch {
      options.preview(null, false);
    }
  }
  function cancel() {
    const g = drag ?? releasing;
    if (!g) return;
    const epoch = ++generation;
    settling++;
    options.preparing(true);
    try {
      cleanup(g);
    } finally {
      // A source/candidate callback can still own the isolated context.operation.
      // Restore only after its synchronous stack returns, with painting paused.
      queueMicrotask(() => {
        try {
          if (!disposed && generation === epoch && !drag) work(() => restore(g));
        } finally {
          settling--;
          options.preparing(false);
        }
      });
    }
  }
  function failed(error: unknown, g: Drag) {
    if (drag !== g) return;
    cancel();
    options.error(error);
  }
  function pose(g: Drag, target: Target, active: boolean, current: () => boolean = () => true) {
    return work(() => {
      const validate = () => {
        if (!current()) throw Error('The selection skew target was superseded.');
        assert(g, target, active);
        if (active && g.target !== target) throw Error('The selection skew target changed.');
      };
      validate();
      const edit = prepareSymbolSampledSelectionSkew(
        g.state.context,
        g.requests,
        target.axis,
        target.degrees,
        validate,
      );
      // The new release publisher owns this complete detached output, separately
      // from source/input ownership. Sampling and publication callbacks may hold it.
      const authoredRelease = !active && g.state.skewAuthoring === true;
      const content = (value: SymbolSampledSelectionEdit) =>
        JSON.stringify([
          value.candidate,
          value.owner,
          value.shearing,
          value.rotation,
          value.scaling,
        ]);
      const stamp = authoredRelease ? content(edit) : '';
      const finite = (value: unknown): void => {
        if (typeof value === 'number' && !Number.isFinite(value))
          throw Error('Invalid raw skew release number.');
        if (value && typeof value === 'object')
          for (const member of Object.values(value)) finite(member);
      };
      const admit = (value: SymbolSampledSelectionEdit) => {
        if (!authoredRelease) return;
        if (
          value.candidate !== edit.candidate ||
          value.owner !== edit.owner ||
          value.shearing !== edit.shearing ||
          value.rotation !== edit.rotation ||
          value.scaling !== edit.scaling
        )
          throw Error('The prepared skew release ownership changed.');
        finite([value.candidate, value.owner, value.shearing]);
        if (content(value) !== stamp)
          throw Error('The prepared skew release candidate or metadata changed.');
      };
      const prepared = g.state.context.sample(edit.candidate);
      edit.validate();
      validate();
      admit(edit);
      return { edit, prepared, admit };
    });
  }
  const task = createLatestFrameTask<{ gesture: Drag; target: Target }>({
    admit(value) {
      assert(value.gesture, value.target);
      return { ...value };
    },
    run({ gesture: g, target }, current) {
      const { edit, prepared } = pose(g, target, true, current);
      const proposal: SymbolSampledSelectionPreview = {
        context: g.state.context,
        owner: edit.owner,
        pose: prepared,
        validate: () => {
          g.state.context.validate();
          assert(g, g.target);
        },
        discard: cancel,
      };
      proposal.validate();
      assert(g, target);
      if (!current() || g.target !== target)
        throw Error('The selection skew target was superseded.');
      options.preview(proposal, true);
    },
    onError(error, { gesture: g }) {
      failed(error, g);
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });
  function down(e: PointerEvent) {
    work(() => begin(e));
  }
  function begin(e: PointerEvent) {
    if (
      disposed ||
      settling ||
      releasing ||
      drag ||
      e.button !== 0 ||
      !e.isPrimary ||
      e.pointerType === 'touch'
    )
      return;
    const admission = ++generation;
    // Policy and numeric input precede layout, getters and private capture.
    let original: SymbolSelectionSkewDragState;
    try {
      original = state();
    } catch (error) {
      options.error(error);
      return;
    }
    const count = Array.isArray(original.requests) ? original.requests.length : 0;
    if (
      original.enabled !== true ||
      !count ||
      !Number.isSafeInteger(original.policy) ||
      original.policy < 0 ||
      !Number.isSafeInteger(original.revision) ||
      original.revision < 0 ||
      (original.skewAuthoring !== undefined && typeof original.skewAuthoring !== 'boolean') ||
      ((original.skewAuthoring === true || original.skewAuthorPolicy !== undefined) &&
        (!Number.isSafeInteger(original.skewAuthorPolicy) || original.skewAuthorPolicy! < 0)) ||
      !['x', 'y'].includes(original.axis) ||
      !Number.isFinite(original.degrees)
    )
      return;
    let initialView: View;
    try {
      initialView = view();
    } catch (error) {
      options.error(error);
      return;
    }
    const g: Drag = {
      generation: admission,
      pointer: e.pointerId,
      state: original,
      requests: [],
      count,
      view: initialView,
      pivot: { x: 0, y: 0 },
      box: { left: 0, top: 0, right: 0, bottom: 0 },
      handle: '',
      start: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      target: Object.freeze({ axis: original.axis, degrees: original.degrees! }),
    };
    const check = () => {
      if (generation !== admission || drag) throw Error('The skew admission was superseded.');
      inputs(g, g.target);
      g.state.context.validate();
      inputs(g, g.target);
      if (viewStamp(view()) !== viewStamp(g.view))
        throw Error('The original selection skew view changed.');
    };
    try {
      check();
      const at = { x: e.clientX - g.view.left, y: e.clientY - g.view.top };
      if (at.x < 0 || at.y < 0 || at.x >= g.view.cssWidth || at.y >= g.view.cssHeight) return;
      const point = rotationLocal(at, g.view);
      if (![point.x, point.y].every(Number.isFinite))
        throw Error('Invalid selection skew pointer.');
      const { capture, active } = captureSymbolSampledSelectionContext(original.context, check);
      let picked = true;
      try {
        if (!Array.isArray(original.requests) || !g.count || g.count > capture.choices.length)
          throw Error('Choose actual original sampled skew units.');
        for (let i = 0; i < g.count; i++) {
          const request = original.requests[i];
          g.requests.push({ layerId: request?.layerId, shapeId: request?.shapeId });
        }
        active();
        const owner = capture.resolveSkew(g.requests, { validate: active });
        g.pivot = { ...owner.pivot };
        const scene = capture.scene,
          snapshot = original.context.source().definition;
        const members = owner.tracks.flatMap((t) =>
          scene
            .find((l) => l.layerId === t.layerId)!
            .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
        );
        g.box = sampledSelectionScaleBounds(members);
        sampledSelectionSkewHandles(g.box, g.pivot, g.view, original.axis, original.degrees!);
        const handles = sampledSelectionSkewHandles(g.box, g.pivot, g.view).handles;
        const handle = handles
          .map((h) => ({ h, distance: Math.hypot(at.x - h.point.x, at.y - h.point.y) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!handle || handle.distance > 8) return;
        g.handle = handle.h.id;
        g.start = { ...handle.h.anchor };
        g.offset = { x: point.x - g.start.x, y: point.y - g.start.y };
        outer: for (let i = scene.length - 1; i >= 0; i--) {
          if (!symbolLayers(snapshot).find((l) => l.id === scene[i].layerId)?.visible) continue;
          for (let j = scene[i].key.shapes.length - 1; j >= 0; j--) {
            const shape = scene[i].key.shapes[j];
            if (shape.opacity === 0 || !hit(shape, point, 0)) continue;
            picked = owner.tracks.some(
              (t) => t.layerId === scene[i].layerId && t.shapeIds.includes(shape.id),
            );
            break outer;
          }
        }
        active();
        check();
      } finally {
        capture.dispose();
      }
      if (!picked) return;
      canvas.focus({ preventScroll: true });
      check();
      g.observer = new ResizeObserver(() => {
        if (drag === g) {
          try {
            assert(g, g.target);
          } catch {
            cancel();
          }
        }
      });
      drag = g;
      canvas.setPointerCapture(g.pointer);
      g.observer.observe(canvas);
      assert(g, g.target);
      g.target = Object.freeze({
        axis: g.handle === 'skew-n' || g.handle === 'skew-s' ? 'x' : 'y',
        degrees: 0,
      });
      options.draft(g.target.axis, 0);
      assert(g, g.target);
      options.active(true);
      e.preventDefault();
    } catch (error) {
      const current = generation === g.generation;
      if (drag === g) cancel();
      if (current) options.error(error);
    }
  }
  function update(e: PointerEvent, finishing: boolean) {
    const g = drag;
    if (!g || e.pointerId !== g.pointer) return;
    try {
      const previous = g.target;
      assert(g, previous);
      const samples = e.getCoalescedEvents?.() ?? [];
      if (!Array.isArray(samples)) throw Error('Invalid coalesced skew samples.');
      let target: Target = g.target;
      const shift = e.shiftKey;
      // A single-axis shear has no angular winding. Validate every native sample,
      // then keep only the immutable latest target for detached preparation.
      for (const sample of [...samples, e]) {
        if (sample.pointerId !== g.pointer) throw Error('A skew sample changed pointer.');
        const client = { x: sample.clientX, y: sample.clientY };
        const point = rotationLocal(
          { x: client.x - g.view.left, y: client.y - g.view.top },
          g.view,
        );
        if (![point.x, point.y].every(Number.isFinite))
          throw Error('Invalid selection skew pointer.');
        const end = { x: point.x - g.offset.x, y: point.y - g.offset.y };
        for (const axis of ['x', 'y'] as const) {
          const horizontal = axis === 'x',
            v = g.view;
          const units = (horizontal ? v.width / v.cssWidth : v.height / v.cssHeight) / v.zoom;
          const noise =
            16 *
            Number.EPSILON *
            ((Math.abs(client[axis]) + Math.abs(horizontal ? v.left : v.top)) * units +
              Math.abs(v.origin[axis] / v.zoom) +
              Math.abs(g.offset[axis]) +
              Math.abs(g.start[axis]));
          if (!Number.isFinite(noise)) throw Error('The skew pointer cannot be resolved safely.');
          // Resolve presentation round-trip noise only; numeric/kernel tolerances stay exact.
          if (Math.abs(end[axis] - g.start[axis]) <= noise) end[axis] = g.start[axis];
        }
        target = Object.freeze(sampledSkewAngle(g.handle, g.box, g.pivot, g.start, end, shift));
        if (!Number.isFinite(target.degrees)) throw Error('Invalid selection skew angle.');
      }
      if (g.target !== previous) return;
      assert(g, previous);
      g.target = target;
      options.draft(target.axis, target.degrees);
      assert(g, target);
      e.preventDefault();
      if (target.degrees === 0) {
        task.cancel();
        if (finishing) cancel();
        else options.preview(null, true);
        return;
      }
      if (!finishing) {
        task.request({ gesture: g, target });
        return;
      }
      cleanup(g);
      // Native capture ends before private release preparation. Keep that
      // synchronous operation cancelable through final proposal or publication admission.
      releasing = g;
      const { edit, prepared, admit } = pose(g, target, false);
      if (g.state.skewAuthoring === true) {
        if (!options.publish)
          throw Error('No isolated sampled selection skew release publisher is available.');
        const publication: SymbolSampledSelectionEdit = {
          ...edit,
          validate: () => {
            edit.validate();
            admit(publication);
            assert(g, target, false);
            admit(publication);
          },
        };
        publication.validate();
        // Normal complete candidate/owner/shearing admission precedes final
        // source/library/history/input/view and both captured policy checks.
        options.publish(publication);
        ownedProposal = null;
        g.state.preview = null;
        return;
      }

      const proposal: SymbolSampledSelectionPreview = {
        context: g.state.context,
        owner: edit.owner,
        pose: prepared,
        validate: () => {
          inputs(g, target);
          g.state.context.validate();
          inputs(g, target);
        },
        discard: () => options.preview(null, false),
      };
      proposal.validate();
      assert(g, target, false);
      ownedProposal = proposal;
      options.preview(proposal, false);
      g.state.preview = null;
    } catch (error) {
      if (drag === g) failed(error, g);
      else if (generation === g.generation && !drag) {
        restore(g);
        options.error(error);
      }
    } finally {
      if (releasing === g) releasing = undefined;
    }
  }
  const move = (e: PointerEvent) => work(() => update(e, false)),
    up = (e: PointerEvent) => work(() => update(e, true));
  const loss = (e: PointerEvent) => {
    if ((drag ?? releasing)?.pointer === e.pointerId) cancel();
  };
  const escape = (e: KeyboardEvent) => {
    if ((drag || releasing) && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', loss);
  canvas.addEventListener('lostpointercapture', loss);
  canvas.addEventListener('blur', cancel);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('scroll', cancel, true);
  return {
    cancel,
    checkView() {
      const g = drag;
      if (g) {
        try {
          assert(g, g.target);
        } catch {
          cancel();
        }
      }
    },
    policyChanged() {
      cancel();
      if (ownedProposal && state().preview === ownedProposal) options.preview(null, false);
      ownedProposal = null;
    },
    dispose() {
      cancel();
      if (ownedProposal && state().preview === ownedProposal) options.preview(null, false);
      ownedProposal = null;
      disposed = true;
      task.dispose();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', loss);
      canvas.removeEventListener('lostpointercapture', loss);
      canvas.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
    },
  };
}
