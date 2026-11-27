import { symbolLayers, type Point } from '../../../packages/document/src';
import { hit } from '../../../packages/geometry/src';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import {
  captureSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionRotation,
  type SymbolSampledSelectionContext,
  type SymbolSampledSelectionPose,
  type SymbolSampledSelectionPreview,
  type SymbolSampledSelectionEdit,
} from './symbol-sampled-selection-editor';
import type { SelectionDragView } from './sampled-selection-drag';
import { rotationLocal, sampledSelectionRotationHandle } from './sampled-rotation-handle';
import { createLatestFrameTask } from './latest-frame-task';

export interface SymbolSelectionRotationDragState {
  context: SymbolSampledSelectionContext<SymbolSampledSelectionPose>;
  requests: readonly SampledUnitRequest[];
  revision: number;
  policy: number;
  enabled: boolean;
  authoring?: boolean;
  authorPolicy?: number;
  degrees: number | undefined;
  preview: SymbolSampledSelectionPreview | null;
}
export interface SelectionRotationLayout {
  rect: { width: number; height: number };
  center: Point;
  original: Point;
  proposed: Point;
}
type View = SelectionDragView & { left: number; top: number; cssWidth: number; cssHeight: number };
type Target = Readonly<{ degrees: number }>;
type Drag = {
  generation: number;
  pointer: number;
  state: SymbolSelectionRotationDragState;
  requests: SampledUnitRequest[];
  count: number;
  view: View;
  pivot: Point;
  last: number;
  total: number;
  uncertainty: number;
  target: Target;
  observer?: ResizeObserver;
};

/** Original handles own capture. Only a separately captured authoring policy
 * may send a fresh release through normal isolated local publication. */
export function createSymbolSampledSelectionRotationDrag(options: {
  canvas: HTMLCanvasElement;
  view(): SelectionDragView;
  state(): SymbolSelectionRotationDragState;
  draft(degrees: number | undefined): void;
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
      throw Error('Invalid sampled selection rotation view.');
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
  function projectionUncertainty(g: Drag, point: Point, client: Point) {
    const v = g.view,
      ux = v.width / v.cssWidth / v.zoom,
      uy = v.height / v.cssHeight / v.zoom;
    const scale =
      (Math.abs(client.x) + Math.abs(v.left)) * ux +
      (Math.abs(client.y) + Math.abs(v.top)) * uy +
      Math.abs(v.origin.x / v.zoom) +
      Math.abs(v.origin.y / v.zoom) +
      Math.abs(g.pivot.x) +
      Math.abs(g.pivot.y);
    const noise =
      (((8 * Number.EPSILON * scale) / Math.hypot(point.x - g.pivot.x, point.y - g.pivot.y)) *
        180) /
      Math.PI;
    if (!Number.isFinite(noise)) throw Error('The rotation pointer cannot be resolved safely.');
    return noise;
  }
  function inputs(g: Drag, target: Target, policy = true) {
    const current = state(),
      original = g.state;
    if (
      disposed ||
      current.context !== original.context ||
      current.requests !== original.requests ||
      current.requests.length !== g.count ||
      current.revision !== original.revision ||
      current.degrees !== target.degrees ||
      (policy &&
        (!current.enabled ||
          current.policy !== original.policy ||
          current.authoring !== original.authoring ||
          current.authorPolicy !== original.authorPolicy))
    )
      throw Error('The original selection rotation inputs changed.');
  }
  function assert(g: Drag, target: Target, active = true) {
    const check = () => {
      if (
        generation !== g.generation ||
        (active && (drag !== g || !canvas.hasPointerCapture(g.pointer))) ||
        viewStamp(view()) !== viewStamp(g.view)
      )
        throw Error('The selection rotation capture or view changed.');
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
      options.draft(g.state.degrees);
      g.state.preview?.validate();
      options.preview(g.state.preview, false);
    } catch {
      options.preview(null, false);
    }
  }
  function cancel() {
    const g = drag;
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
        if (!current()) throw Error('The selection rotation target was superseded.');
        assert(g, target, active);
        if (active && g.target !== target) throw Error('The selection rotation target changed.');
      };
      validate();
      const edit = prepareSymbolSampledSelectionRotation(
        g.state.context,
        g.requests,
        target.degrees,
        validate,
      );
      const prepared = g.state.context.sample(edit.candidate);
      edit.validate();
      validate();
      return { edit, prepared };
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
        throw Error('The selection rotation target was superseded.');
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
    if (disposed || settling || drag || e.button !== 0 || !e.isPrimary || e.pointerType === 'touch')
      return;
    const admission = ++generation;
    // Policy and numeric input precede layout, getters and private capture.
    let original: SymbolSelectionRotationDragState;
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
      !Number.isFinite(original.degrees) ||
      !Number.isFinite((original.degrees! * Math.PI) / 180)
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
      last: 0,
      total: 0,
      uncertainty: 0,
      target: Object.freeze({ degrees: original.degrees! }),
    };
    const check = () => {
      if (generation !== admission || drag) throw Error('The rotation admission was superseded.');
      inputs(g, g.target);
      g.state.context.validate();
      inputs(g, g.target);
      if (viewStamp(view()) !== viewStamp(g.view))
        throw Error('The original selection rotation view changed.');
    };
    try {
      check();
      const at = { x: e.clientX - g.view.left, y: e.clientY - g.view.top };
      if (at.x < 0 || at.y < 0 || at.x >= g.view.cssWidth || at.y >= g.view.cssHeight) return;
      const point = rotationLocal(at, g.view);
      if (![point.x, point.y].every(Number.isFinite))
        throw Error('Invalid selection rotation pointer.');
      const { capture, active } = captureSymbolSampledSelectionContext(original.context, check);
      let picked = true;
      try {
        if (!Array.isArray(original.requests) || !g.count || g.count > capture.choices.length)
          throw Error('Choose actual original sampled rotation units.');
        for (let i = 0; i < g.count; i++) {
          const request = original.requests[i];
          g.requests.push({ layerId: request?.layerId, shapeId: request?.shapeId });
        }
        active();
        const owner = capture.resolveRotation(g.requests, { validate: active });
        g.pivot = { ...owner.pivot };
        const handle = sampledSelectionRotationHandle(g.pivot, g.view);
        if (Math.hypot(at.x - handle.knob.x, at.y - handle.knob.y) > 8) return;
        const scene = capture.scene,
          snapshot = original.context.source().definition;
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
        if (Math.hypot(point.x - g.pivot.x, point.y - g.pivot.y) < 1e-6) return;
        g.last = Math.atan2(point.y - g.pivot.y, point.x - g.pivot.x);
        g.uncertainty = projectionUncertainty(g, point, {
          x: at.x + g.view.left,
          y: at.y + g.view.top,
        });
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
      if (!Array.isArray(samples)) throw Error('Invalid coalesced rotation samples.');
      let last = g.last,
        total = g.total,
        pointerUncertainty = g.uncertainty;
      // Preserve native angular samples while preparing only one final pose.
      for (const sample of [...samples, e]) {
        if (sample.pointerId !== g.pointer) throw Error('A rotation sample changed pointer.');
        const client = { x: sample.clientX, y: sample.clientY };
        const point = rotationLocal(
          { x: client.x - g.view.left, y: client.y - g.view.top },
          g.view,
        );
        if (
          ![point.x, point.y].every(Number.isFinite) ||
          Math.hypot(point.x - g.pivot.x, point.y - g.pivot.y) < 1e-6
        )
          throw Error('Keep the rotation pointer away from the original pivot.');
        const angle = Math.atan2(point.y - g.pivot.y, point.x - g.pivot.x),
          delta = angle - last;
        pointerUncertainty += projectionUncertainty(g, point, client);
        total += Math.atan2(Math.sin(delta), Math.cos(delta));
        last = angle;
      }
      const raw = (total * 180) / Math.PI,
        change = e.shiftKey ? Math.round(raw / 15) * 15 : raw;
      const target = Object.freeze({ degrees: g.state.degrees! + change });
      if (![last, total, change, target.degrees].every(Number.isFinite))
        throw Error('Invalid selection rotation angle.');
      // A trigonometric round trip that cancels a numeric draft must not
      // manufacture a tiny authored angle. This only rejects uncertain canvas
      // targets; explicit numeric preparation and geometry tolerances stay exact.
      const uncertainty =
        pointerUncertainty +
        8 *
          Number.EPSILON *
          Math.max(Math.abs(g.state.degrees!), Math.abs(change), Math.abs(target.degrees));
      const periodicNoop =
        Math.abs(target.degrees - Math.round(target.degrees / 360) * 360) <= uncertainty;
      if (g.target !== previous) return;
      // Recheck raw pointer reads before writing a draft: input getters can
      // deliver explicit numeric edits or a newer immutable pointer target.
      assert(g, previous);
      g.last = last;
      g.total = total;
      g.uncertainty = pointerUncertainty;
      g.target = target;
      options.draft(target.degrees);
      assert(g, target);
      e.preventDefault();
      if (!change || periodicNoop) {
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
      if (g.state.authoring === true) {
        if (!options.publish) throw Error('No isolated rotation release publisher is available.');
        const validate = () => {
          edit.validate();
          assert(g, target, false);
        };
        validate();
        // update() already holds work(): keep painting/publication preparation
        // deferred while normal local candidate/metadata checks precede final
        // source/library/assets/enclosing/view/input/both-policy admission.
        options.publish({ ...edit, validate });
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
    }
  }
  const move = (e: PointerEvent) => work(() => update(e, false)),
    up = (e: PointerEvent) => work(() => update(e, true));
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
