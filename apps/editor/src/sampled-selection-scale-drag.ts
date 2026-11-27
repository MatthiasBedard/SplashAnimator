import type { Point } from '../../../packages/document/src';
import { hit } from '../../../packages/geometry/src';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import {
  captureSampledSelectionContext,
  prepareSampledSelectionScale,
  type SampledSelectionContext,
  type SampledSelectionPreview,
  type SampledSelectionEdit,
} from './sampled-selection-editor';
import type { SelectionDragView } from './sampled-selection-drag';
import { rotationLocal } from './sampled-rotation-handle';
import {
  sampledSelectionScaleBounds,
  sampledSelectionScaleHandles,
  sampledScaleFactors,
} from './sampled-scale-handles';
import { createLatestFrameTask } from './latest-frame-task';

export interface SelectionScaleDragState {
  context: SampledSelectionContext;
  requests: readonly SampledUnitRequest[];
  revision: number;
  policy: number;
  enabled: boolean;
  scaleAuthoring?: boolean;
  scaleAuthorPolicy?: number;
  x: number | undefined;
  y: number | undefined;
  preview: SampledSelectionPreview | null;
}
export interface SelectionScaleLayout {
  rect: { width: number; height: number };
  original: { id: string; point: Point }[];
  proposed: { id: string; point: Point }[];
}
type View = SelectionDragView & { left: number; top: number; cssWidth: number; cssHeight: number };
type Target = Readonly<{ x: number; y: number }>;
type Drag = {
  generation: number;
  pointer: number;
  state: SelectionScaleDragState;
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

/** Original handles own capture. A separately captured scale-authoring policy
 * alone may publish a fresh release through normal document admission. */
export function createSampledSelectionScaleDrag(options: {
  canvas: HTMLCanvasElement;
  view(): SelectionDragView;
  state(): SelectionScaleDragState;
  draft(x: number | undefined, y: number | undefined): void;
  preview(value: SampledSelectionPreview | null, live: boolean): void;
  active(value: boolean): void;
  publish?(edit: SampledSelectionEdit): void;
  error(cause: unknown): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}) {
  const { canvas } = options;
  let drag: Drag | undefined,
    generation = 0,
    disposed = false;
  let ownedProposal: SampledSelectionPreview | null = null;
  const state = () => ({ ...options.state() });
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
      throw Error('Invalid sampled selection scale view.');
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
      current.x !== target.x ||
      current.y !== target.y ||
      (policy &&
        (!current.enabled ||
          current.policy !== original.policy ||
          current.scaleAuthoring !== original.scaleAuthoring ||
          current.scaleAuthorPolicy !== original.scaleAuthorPolicy))
    )
      throw Error('The original selection scale inputs changed.');
  }
  function assert(g: Drag, target: Target, active = true) {
    const check = () => {
      if (
        generation !== g.generation ||
        (active && (drag !== g || !canvas.hasPointerCapture(g.pointer))) ||
        viewStamp(view()) !== viewStamp(g.view)
      )
        throw Error('The selection scale capture or view changed.');
      inputs(g, target);
    };
    check();
    g.state.context.validate();
    check();
  }
  function cleanup(g: Drag) {
    task.cancel();
    if (drag === g) drag = undefined;
    g.observer?.disconnect();
    if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
    options.active(false);
  }
  function restore(g: Drag) {
    try {
      inputs(g, g.target, false);
      g.state.context.validate();
      inputs(g, g.target, false);
      options.draft(g.state.x, g.state.y);
      g.state.preview?.validate();
      options.preview(g.state.preview, false);
    } catch {
      options.preview(null, false);
    }
  }
  function cancel() {
    const g = drag;
    if (!g) return;
    generation++;
    cleanup(g);
    restore(g);
  }
  function failed(error: unknown, g: Drag) {
    if (drag !== g) return;
    cancel();
    options.error(error);
  }
  function pose(g: Drag, target: Target, active: boolean, current: () => boolean = () => true) {
    const validate = () => {
      if (!current()) throw Error('The selection scale target was superseded.');
      assert(g, target, active);
      if (active && g.target !== target) throw Error('The selection scale target changed.');
    };
    validate();
    const edit = prepareSampledSelectionScale(
      g.state.context,
      g.requests,
      target.x / 100,
      target.y / 100,
      validate,
    );
    const prepared = g.state.context.sample(edit.candidate);
    edit.validate();
    validate();
    return { edit, prepared };
  }
  const task = createLatestFrameTask<{ gesture: Drag; target: Target }>({
    admit(value) {
      assert(value.gesture, value.target);
      return { ...value };
    },
    run({ gesture: g, target }, current) {
      const { edit, prepared } = pose(g, target, true, current);
      const proposal: SampledSelectionPreview = {
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
        throw Error('The selection scale target was superseded.');
      options.preview(proposal, true);
    },
    onError(error, { gesture: g }) {
      failed(error, g);
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });
  function down(e: PointerEvent) {
    if (disposed || drag || e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return;
    const admission = ++generation;
    // Policy and numeric input precede layout, getters and private capture.
    let original: SelectionScaleDragState;
    try {
      original = state();
    } catch (error) {
      options.error(error);
      return;
    }
    const count = Array.isArray(original.requests) ? original.requests.length : 0;
    if (
      !original.enabled ||
      !count ||
      !Number.isSafeInteger(original.policy) ||
      original.policy < 0 ||
      !Number.isSafeInteger(original.revision) ||
      original.revision < 0 ||
      (original.scaleAuthoring !== undefined && typeof original.scaleAuthoring !== 'boolean') ||
      ((original.scaleAuthoring === true || original.scaleAuthorPolicy !== undefined) &&
        (!Number.isSafeInteger(original.scaleAuthorPolicy) || original.scaleAuthorPolicy! < 0)) ||
      !Number.isFinite(original.x) ||
      !Number.isFinite(original.y) ||
      !original.x ||
      !original.y
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
      target: Object.freeze({ x: original.x!, y: original.y! }),
    };
    const check = () => {
      if (generation !== admission || drag) throw Error('The scale admission was superseded.');
      inputs(g, g.target);
      g.state.context.validate();
      inputs(g, g.target);
      if (viewStamp(view()) !== viewStamp(g.view))
        throw Error('The original selection scale view changed.');
    };
    try {
      check();
      const at = { x: e.clientX - g.view.left, y: e.clientY - g.view.top };
      if (at.x < 0 || at.y < 0 || at.x >= g.view.cssWidth || at.y >= g.view.cssHeight) return;
      const point = rotationLocal(at, g.view);
      if (![point.x, point.y].every(Number.isFinite))
        throw Error('Invalid selection scale pointer.');
      const { capture, snapshot, active } = captureSampledSelectionContext(original.context, check);
      let picked = true;
      try {
        if (!Array.isArray(original.requests) || !g.count || g.count > capture.choices.length)
          throw Error('Choose actual original sampled scale units.');
        for (let i = 0; i < g.count; i++) {
          const request = original.requests[i];
          g.requests.push({ layerId: request?.layerId, shapeId: request?.shapeId });
        }
        active();
        const owner = capture.resolveScale(g.requests, { validate: active });
        g.pivot = { ...owner.pivot };
        const scene = capture.scene;
        const members = owner.tracks.flatMap((t) =>
          scene
            .find((l) => l.layerId === t.layerId)!
            .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
        );
        g.box = sampledSelectionScaleBounds(members);
        const handles = sampledSelectionScaleHandles(g.box, g.pivot, g.view).handles;
        const handle = handles
          .map((h) => ({ h, distance: Math.hypot(at.x - h.point.x, at.y - h.point.y) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!handle || handle.distance > 8) return;
        g.handle = handle.h.id;
        g.start = { ...handle.h.anchor };
        g.offset = { x: point.x - g.start.x, y: point.y - g.start.y };
        outer: for (let i = scene.length - 1; i >= 0; i--) {
          if (!snapshot.layers.find((l) => l.id === scene[i].layerId)?.visible) continue;
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
      g.target = Object.freeze({ x: 100, y: 100 });
      options.draft(100, 100);
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
      if (!Array.isArray(samples)) throw Error('Invalid coalesced scale samples.');
      let target: Target = g.target;
      const shift = e.shiftKey;
      // Linear scaling has no angular winding. Validate every native sample,
      // then keep only the immutable latest target for detached preparation.
      for (const sample of [...samples, e]) {
        if (sample.pointerId !== g.pointer) throw Error('A scale sample changed pointer.');
        const client = { x: sample.clientX, y: sample.clientY };
        const point = rotationLocal(
          { x: client.x - g.view.left, y: client.y - g.view.top },
          g.view,
        );
        if (![point.x, point.y].every(Number.isFinite))
          throw Error('Invalid selection scale pointer.');
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
          if (!Number.isFinite(noise)) throw Error('The scale pointer cannot be resolved safely.');
          // Resolve presentation round-trip noise only; numeric/kernel tolerances stay exact.
          if (Math.abs(end[axis] - g.start[axis]) <= noise) end[axis] = g.start[axis];
        }
        const factors = sampledScaleFactors(g.box, g.pivot, g.start, end, shift, g.handle);
        target = Object.freeze({ x: factors.x * 100, y: factors.y * 100 });
        if (![target.x, target.y].every(Number.isFinite))
          throw Error('Invalid selection scale factors.');
      }
      if (g.target !== previous) return;
      assert(g, previous);
      g.target = target;
      options.draft(target.x, target.y);
      assert(g, target);
      e.preventDefault();
      if (target.x === 100 && target.y === 100) {
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
      const { edit, prepared } = pose(g, target, false);
      if (g.state.scaleAuthoring === true) {
        if (!options.publish)
          throw Error('No sampled selection scale release publisher is available.');
        const validate = () => {
          edit.validate();
          assert(g, target, false);
        };
        validate();
        // Normal full candidate/owner/readout admission precedes final original
        // source/library/history/view/input/gesture/scale-authoring checks.
        options.publish({ ...edit, validate });
        ownedProposal = null;
        g.state.preview = null;
        return;
      }
      const proposal: SampledSelectionPreview = {
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
    }
  }
  const move = (e: PointerEvent) => update(e, false),
    up = (e: PointerEvent) => update(e, true);
  const loss = (e: PointerEvent) => {
    if (drag?.pointer === e.pointerId) cancel();
  };
  const escape = (e: KeyboardEvent) => {
    if (drag && e.key === 'Escape') {
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
