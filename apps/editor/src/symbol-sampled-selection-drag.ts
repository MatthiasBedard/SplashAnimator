import type { Point } from '../../../packages/document/src';
import { hit } from '../../../packages/geometry/src';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import {
  captureSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionTranslation,
  type SymbolSampledSelectionContext,
  type SymbolSampledSelectionPose,
  type SymbolSampledSelectionPreview,
  type SymbolSampledSelectionEdit,
} from './symbol-sampled-selection-editor';
import { createLatestFrameTask } from './latest-frame-task';

import type { SelectionDragView } from './sampled-selection-drag';

export interface SymbolSelectionDragState {
  context: SymbolSampledSelectionContext<SymbolSampledSelectionPose>;
  requests: readonly SampledUnitRequest[];
  revision: number;
  axes: { x: number; y: number };
  policy: number;
  enabled: boolean;
  authoring?: boolean;
  authorPolicy?: number;
  x: number | undefined;
  y: number | undefined;
  preview: SymbolSampledSelectionPreview | null;
}
type View = SelectionDragView & { left: number; top: number; cssWidth: number; cssHeight: number };
type Target = Readonly<Point>;
type Drag = {
  generation: number;
  pointer: number;
  state: SymbolSelectionDragState;
  requests: SampledUnitRequest[];
  count: number;
  view: View;
  start: Point;
  target: Target;
  x: number;
  y: number;
  observer?: ResizeObserver;
};

/** Scratch by default; a separately captured release policy may send a fresh
 * candidate through the existing complete isolated local publisher. */
export function createSymbolSampledSelectionDrag(options: {
  canvas: HTMLCanvasElement;
  view(): SelectionDragView;
  state(): SymbolSelectionDragState;
  draft(x: number | undefined, y: number | undefined): void;
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
  const state = () => {
    const current = options.state();
    return { ...current, axes: { ...current.axes } };
  };
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
      height = source.height;
    const rect = canvas.getBoundingClientRect();
    const result = {
      origin,
      zoom,
      width,
      height,
      left: rect.left,
      top: rect.top,
      cssWidth: rect.width,
      cssHeight: rect.height,
    };
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
      throw Error('Invalid sampled symbol selection view.');
    return result;
  }
  const viewStamp = (v: View) => JSON.stringify(v);
  function inputs(g: Drag, target: Point, policy = true) {
    const current = state(),
      original = g.state;
    if (
      disposed ||
      current.context !== original.context ||
      current.requests !== original.requests ||
      current.revision !== original.revision ||
      current.requests.length !== g.count ||
      current.x !== target.x ||
      current.y !== target.y ||
      (policy &&
        (!current.enabled ||
          current.policy !== original.policy ||
          current.authoring !== original.authoring ||
          current.authorPolicy !== original.authorPolicy))
    )
      throw Error('The original sampled symbol selection or canvas inputs changed.');
  }
  function assert(g: Drag, target: Target, active = true) {
    const check = () => {
      if (
        generation !== g.generation ||
        (active && (drag !== g || !canvas.hasPointerCapture(g.pointer))) ||
        viewStamp(view()) !== viewStamp(g.view)
      )
        throw Error('The sampled symbol selection capture or view changed.');
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
      const metadata = () => {
        const live = state();
        if (
          disposed ||
          live.context !== g.state.context ||
          live.requests !== g.state.requests ||
          live.requests.length !== g.count
        )
          throw Error('The original isolated selection changed.');
        return live;
      };
      metadata();
      g.state.context.validate();
      const live = metadata();
      const ownX = live.axes.x === g.state.axes.x,
        ownY = live.axes.y === g.state.axes.y;
      if (live.revision !== g.state.revision && ownX && ownY)
        throw Error('The isolated numeric inputs changed.');
      if ((ownX && live.x !== g.x) || (ownY && live.y !== g.y))
        throw Error('A newer numeric target owns the draft.');
      options.draft(ownX ? g.state.x : live.x, ownY ? g.state.y : live.y);
      g.state.preview?.validate();
      options.preview(g.state.preview, false);
    } catch {
      options.preview(null, false);
    }
  }
  function cancel() {
    const current = drag;
    if (!current) return;
    const epoch = ++generation;
    settling++;
    options.preparing(true);
    try {
      cleanup(current);
    } finally {
      // Enclosing/source/candidate callbacks may still own context.operation.
      // Keep painting/publication paused until their synchronous stack returns.
      queueMicrotask(() => {
        try {
          if (!disposed && generation === epoch && !drag) work(() => restore(current));
        } finally {
          settling--;
          options.preparing(false);
        }
      });
    }
  }
  function failed(cause: unknown, g: Drag) {
    if (drag !== g) return;
    cancel();
    options.error(cause);
  }
  function pose(g: Drag, target: Target, active: boolean, current: () => boolean = () => true) {
    return work(() => {
      const validate = () => {
        if (!current()) throw Error('The sampled symbol selection target was superseded.');
        assert(g, target, active);
        if (active && g.target !== target)
          throw Error('The sampled symbol selection target changed.');
      };
      validate();
      const edit = prepareSymbolSampledSelectionTranslation(
        g.state.context,
        g.requests,
        target,
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
        // Keep the last admitted geometry while a newer target awaits its frame.
        // Its world pose is baked into prepared keys, never inferred from inputs.
        validate: () => {
          g.state.context.validate();
          assert(g, g.target);
        },
        discard: cancel,
      };
      proposal.validate();
      assert(g, target);
      if (!current() || g.target !== target)
        throw Error('The sampled symbol selection target was superseded.');
      options.preview(proposal, true);
    },
    onError(cause, { gesture: g }) {
      failed(cause, g);
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
    // Read policy/inputs before layout, source getters or private ownership work.
    const original = state();
    if (
      !original.enabled ||
      !original.requests.length ||
      !Number.isFinite(original.x) ||
      !Number.isFinite(original.y)
    )
      return;
    const at = { x: e.clientX, y: e.clientY };
    let initialView: View;
    try {
      initialView = view();
    } catch (cause) {
      options.error(cause);
      return;
    }
    const g: Drag = {
      generation: ++generation,
      pointer: e.pointerId,
      state: original,
      requests: [],
      count: original.requests.length,
      view: initialView,
      start: at,
      target: { x: original.x!, y: original.y! },
      x: original.x!,
      y: original.y!,
    };
    const check = () => {
      inputs(g, g.target);
      g.state.context.validate();
      inputs(g, g.target);
      if (viewStamp(view()) !== viewStamp(g.view))
        throw Error('The original sampled symbol selection view changed.');
    };
    try {
      check();
      if (
        at.x < g.view.left ||
        at.y < g.view.top ||
        at.x >= g.view.left + g.view.cssWidth ||
        at.y >= g.view.top + g.view.cssHeight
      )
        return;
      const point = {
        x:
          (((at.x - g.view.left) * g.view.width) / g.view.cssWidth - g.view.origin.x) / g.view.zoom,
        y:
          (((at.y - g.view.top) * g.view.height) / g.view.cssHeight - g.view.origin.y) /
          g.view.zoom,
      };
      if (![point.x, point.y].every(Number.isFinite))
        throw Error('Invalid sampled symbol selection pointer.');
      const { capture, active } = captureSymbolSampledSelectionContext(original.context, check);
      let picked = false;
      try {
        if (!Array.isArray(original.requests) || !g.count || g.count > capture.choices.length)
          throw Error('Choose actual original sampled units.');
        for (let i = 0; i < g.count; i++) {
          const request = original.requests[i];
          g.requests.push({ layerId: request?.layerId, shapeId: request?.shapeId });
        }
        active();
        const owner = capture.resolveSelection(g.requests, { validate: active }),
          scene = capture.scene;
        outer: for (let i = scene.length - 1; i >= 0; i--)
          for (let j = scene[i].key.shapes.length - 1; j >= 0; j--) {
            const shape = scene[i].key.shapes[j];
            if (shape.opacity === 0 || !hit(shape, point, 0)) continue;
            picked = owner.tracks.some(
              (t) => t.layerId === scene[i].layerId && t.shapeIds.includes(shape.id),
            );
            break outer;
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
      options.active(true);
      e.preventDefault();
    } catch (cause) {
      if (drag === g) cancel();
      options.error(cause);
    }
  }
  function update(e: PointerEvent, finishing: boolean) {
    const g = drag;
    if (!g || e.pointerId !== g.pointer) return;
    try {
      assert(g, g.target);
      let dx = (e.clientX - g.start.x) / ((g.view.zoom * g.view.cssWidth) / g.view.width);
      let dy = (e.clientY - g.start.y) / ((g.view.zoom * g.view.cssHeight) / g.view.height);
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const target = Object.freeze({ x: g.state.x! + dx, y: g.state.y! + dy });
      if (![dx, dy, target.x, target.y].every(Number.isFinite))
        throw Error('Invalid sampled symbol selection drag offset.');
      if ((!dx && !dy) || (!target.x && !target.y)) {
        task.cancel();
        if (finishing) cancel();
        else {
          g.target = target;
          g.x = target.x;
          g.y = target.y;
          options.draft(g.x, g.y);
          options.preview(null, true);
        }
        return;
      }
      g.target = target;
      g.x = target.x;
      g.y = target.y;
      options.draft(g.x, g.y);
      assert(g, target);
      if (!finishing) {
        task.request({ gesture: g, target });
        return;
      }
      // Release native state before freshly preparing the numeric proposal.
      cleanup(g);
      const { edit, prepared } = pose(g, target, false);
      if (g.state.authoring === true) {
        work(() => {
          if (!options.publish)
            throw Error('No isolated selection release publisher is available.');
          const validate = () => {
            edit.validate();
            assert(g, target, false);
          };
          validate();
          // Keep parent painting deferred throughout candidate/enclosing reads.
          // Normal local edit checks precede the final release admission.
          options.publish({ ...edit, validate });
        });
        ownedProposal = null;
        g.state.preview = null;
        return;
      }
      const proposal: SymbolSampledSelectionPreview = {
        context: g.state.context,
        owner: edit.owner,
        pose: prepared,
        // Cleanup is complete. The unapplied world pose may be repainted in a
        // new layout; numeric Commit will independently prepare/validate again.
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
      // A completed proposal must not retain a chain of earlier scratch poses.
      g.state.preview = null;
    } catch (cause) {
      if (drag === g) failed(cause, g);
      else if (generation === g.generation && !drag) {
        work(() => restore(g));
        options.error(cause);
      }
    }
  }
  const move = (e: PointerEvent) => update(e, false);
  const up = (e: PointerEvent) => update(e, true);
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
