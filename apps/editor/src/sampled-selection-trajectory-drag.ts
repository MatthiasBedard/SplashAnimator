import type { Point } from '../../../packages/document/src';
import type { SampledUnitRequest } from '../../../packages/animation/src/selection-motion-owner';
import type { SampledSelectionContext, SampledSelectionPreview } from './sampled-selection-editor';
import {
  resolveSampledSelectionCubicControl,
  prepareSampledSelectionTrajectories,
  sampleSampledSelectionTrajectories,
  admitSampledSelectionTrajectoryPublication,
  type SampledSelectionTrajectoryContext,
  type SampledSelectionCubicControls,
  type SampledSelectionTrajectoryEdit,
} from './sampled-selection-trajectory-editor';
import { createLatestFrameTask } from './latest-frame-task';

export interface TrajectoryDragView {
  origin: Point;
  zoom: number;
  width: number;
  height: number;
}
export interface TrajectoryDragState {
  context: SampledSelectionTrajectoryContext;
  displayContext: SampledSelectionContext;
  requests: readonly SampledUnitRequest[];
  revision: number;
  policy: number;
  enabled: boolean;
  authoring?: boolean;
  authorPolicy?: number;
  layerId: string;
  role: 'start' | 'end';
  controls: readonly SampledSelectionCubicControls[];
  preview: SampledSelectionPreview | null;
}

type View = TrajectoryDragView & { left: number; top: number; cssWidth: number; cssHeight: number };
type Target = readonly Readonly<SampledSelectionCubicControls>[];
type Drag = {
  generation: number;
  pointer: number;
  state: TrajectoryDragState;
  requests: SampledUnitRequest[];
  count: number;
  view: View;
  start: Point;
  target: Target;
  offset: Point;
  prior: readonly SampledSelectionCubicControls[];
  base: Target;
  observer?: ResizeObserver;
};

/** Original complete routes only; a separate captured policy can authorize release. */
export function createSampledSelectionTrajectoryDrag(options: {
  canvas: HTMLCanvasElement;
  view(): TrajectoryDragView;
  state(): TrajectoryDragState;
  draft(controls: readonly SampledSelectionCubicControls[]): void;
  preview(value: SampledSelectionPreview | null, live: boolean): void;
  active(value: boolean): void;
  publish?(edit: SampledSelectionTrajectoryEdit, finalAdmission: () => void): void;
  error(cause: unknown): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}) {
  const { canvas } = options;
  let drag: Drag | undefined,
    releasing: Drag | undefined,
    generation = 0,
    disposed = false,
    capturing = false;
  let preparing = 0,
    deferredRestore: Drag | undefined;
  let ownedProposal: SampledSelectionPreview | null = null;
  const state = () => ({ ...options.state() });
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
      throw Error('Invalid sampled selection view.');
    return result;
  }
  const viewStamp = (v: View) => JSON.stringify(v);
  function inputs(g: Drag, target: Target, policy = true) {
    const current = state(),
      original = g.state;
    if (
      disposed ||
      current.context !== original.context ||
      current.displayContext !== original.displayContext ||
      current.requests !== original.requests ||
      current.revision !== original.revision ||
      current.requests.length !== g.count ||
      current.controls !== target ||
      current.layerId !== original.layerId ||
      current.role !== original.role ||
      (policy &&
        (!current.enabled ||
          current.policy !== original.policy ||
          current.authoring !== original.authoring ||
          current.authorPolicy !== original.authorPolicy))
    )
      throw Error('The original trajectory selection or canvas inputs changed.');
  }
  function assert(g: Drag, target: Target, active = true, source = true) {
    const check = () => {
      if (
        generation !== g.generation ||
        (active && (drag !== g || !canvas.hasPointerCapture(g.pointer))) ||
        (!active && g.state.authoring === true && releasing !== g) ||
        viewStamp(view()) !== viewStamp(g.view)
      )
        throw Error('The sampled selection capture or view changed.');
      inputs(g, target);
    };
    check();
    if (source) g.state.context.validate();
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
      options.draft(g.prior);
      g.state.preview?.validate();
      options.preview(g.state.preview, false);
    } catch {
      // Explicit input/source changes own their values; never overwrite them.
      options.preview(null, false);
    }
  }
  function cancel() {
    const current = drag ?? releasing;
    if (!current) return;
    generation++;
    cleanup(current);
    if (preparing) deferredRestore = current;
    else restore(current);
  }
  function failed(cause: unknown, g: Drag) {
    if (drag !== g) return;
    cancel();
    options.error(cause);
  }
  function work<T>(run: () => T): T {
    preparing++;
    try {
      return run();
    } finally {
      if (!--preparing && deferredRestore) {
        const saved = deferredRestore;
        deferredRestore = undefined;
        restore(saved);
      }
    }
  }
  function pose(g: Drag, target: Target, active: boolean, current: () => boolean = () => true) {
    return work(() => {
      const validate = () => {
        if (!current()) throw Error('The sampled selection target was superseded.');
        assert(g, target, active, false);
        if (active && g.target !== target) throw Error('The sampled selection target changed.');
      };
      validate();
      const edit = prepareSampledSelectionTrajectories(
        g.state.context,
        g.requests,
        target,
        validate,
      );
      const prepared = sampleSampledSelectionTrajectories(edit);
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
      const proposal: SampledSelectionPreview = {
        context: g.state.displayContext,
        owner: edit.owner,
        pose: prepared,
        // Keep the last admitted geometry while a newer target awaits its frame.
        // Its world pose is baked into prepared keys, never inferred from inputs.
        validate: () => {
          assert(g, g.target);
        },
        discard: cancel,
      };
      proposal.validate();
      assert(g, target);
      if (!current() || g.target !== target)
        throw Error('The sampled selection target was superseded.');
      options.preview(proposal, true);
    },
    onError(cause, { gesture: g }) {
      failed(cause, g);
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });
  function down(e: PointerEvent) {
    if (capturing) {
      generation++;
      return;
    }
    if (
      disposed ||
      drag ||
      releasing ||
      e.button !== 0 ||
      !e.isPrimary ||
      e.pointerType === 'touch'
    )
      return;
    capturing = true;
    try {
      begin(e);
    } catch (cause) {
      options.error(cause);
    } finally {
      capturing = false;
    }
  }
  function begin(e: PointerEvent) {
    // Read policy/inputs before layout, source getters or private ownership work.
    const original = state();
    if (typeof original.enabled !== 'boolean')
      throw Error('Choose a boolean cubic gesture policy.');
    if (
      !original.enabled ||
      !original.requests.length ||
      !Array.isArray(original.controls) ||
      !original.controls.length
    ) {
      capturing = false;
      return;
    }
    if (
      (original.authoring !== undefined && typeof original.authoring !== 'boolean') ||
      ((original.authoring === true || original.authorPolicy !== undefined) &&
        (!Number.isSafeInteger(original.authorPolicy) || original.authorPolicy! < 0))
    )
      throw Error('Choose an original boolean trajectory authoring policy and revision.');
    const at = { x: e.clientX, y: e.clientY };
    let initialView: View;
    try {
      initialView = view();
    } catch (cause) {
      capturing = false;
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
      target: original.controls,
      prior: original.controls,
      base: [],
      offset: { x: 0, y: 0 },
    };
    const check = () => {
      if (generation !== g.generation) throw Error('The cubic capture changed.');
      inputs(g, g.target);
      if (viewStamp(view()) !== viewStamp(g.view))
        throw Error('The original sampled selection view changed.');
    };
    try {
      if (
        !Number.isSafeInteger(original.policy) ||
        original.policy < 0 ||
        !Number.isSafeInteger(original.revision) ||
        original.revision < 0
      )
        throw Error('Choose an original gesture policy.');
      g.state.context.validate();
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
        throw Error('Invalid sampled selection pointer.');
      if (!Array.isArray(original.requests) || !g.count)
        throw Error('Choose actual original trajectory units.');
      const geometry = resolveSampledSelectionCubicControl(
        original.context,
        original.requests,
        original.layerId,
        original.role,
        check,
        point,
      );
      const screen = {
        x: ((geometry.point.x * g.view.zoom + g.view.origin.x) * g.view.cssWidth) / g.view.width,
        y: ((geometry.point.y * g.view.zoom + g.view.origin.y) * g.view.cssHeight) / g.view.height,
      };
      if (Math.hypot(at.x - g.view.left - screen.x, at.y - g.view.top - screen.y) > 9) return;
      if (!geometry.available) throw Error('Foreground artwork owns this cubic control position.');
      g.requests = geometry.requests.map((r) => ({ ...r }));
      const count = original.controls.length;
      if (count !== geometry.trackIds.length)
        throw Error('Enter controls for every original track.');
      g.offset = { ...geometry.offset };
      const captured: Readonly<SampledSelectionCubicControls>[] = [],
        seen = new Set<string>();
      for (let i = 0; i < count; i++) {
        const raw = original.controls[i];
        if (
          !raw ||
          typeof raw !== 'object' ||
          Reflect.ownKeys(raw).some(
            (k) => !['layerId', 'startX', 'startY', 'endX', 'endY'].includes(k as string),
          )
        )
          throw Error('Choose only explicit cubic offsets.');
        const layerId = raw.layerId,
          startX = raw.startX,
          startY = raw.startY,
          endX = raw.endX,
          endY = raw.endY;
        if (
          typeof layerId !== 'string' ||
          seen.has(layerId) ||
          !geometry.trackIds.includes(layerId) ||
          ![startX, startY, endX, endY].every(Number.isFinite)
        )
          throw Error('Enter finite controls for every original track.');
        seen.add(layerId);
        const value = { layerId, startX, startY, endX, endY };
        captured.push(
          Object.freeze(
            layerId === original.layerId
              ? {
                  ...value,
                  [original.role + 'X']: geometry.offset.x,
                  [original.role + 'Y']: geometry.offset.y,
                }
              : value,
          ),
        );
      }
      if (original.controls.length !== count)
        throw Error('Original cubic controls changed while being read.');
      g.base = Object.freeze(captured);
      original.context.validate();
      check();
      canvas.focus({ preventScroll: true });
      original.context.validate();
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
      g.target = g.base;
      options.draft(g.target);
      assert(g, g.target);
      options.active(true);
      e.preventDefault();
    } catch (cause) {
      if (drag === g) cancel();
      options.error(cause);
    } finally {
      capturing = false;
    }
  }
  function update(e: PointerEvent, finishing: boolean) {
    const g = drag;
    if (!g || e.pointerId !== g.pointer) return;
    try {
      assert(g, g.target);
      let dx = ((e.clientX - g.start.x) * g.view.width) / g.view.cssWidth / g.view.zoom;
      let dy = ((e.clientY - g.start.y) * g.view.height) / g.view.cssHeight / g.view.zoom;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const x = g.offset.x + dx,
        y = g.offset.y + dy;
      if (![dx, dy, x, y].every(Number.isFinite)) throw Error('Invalid cubic control offset.');
      const target: Target = Object.freeze(
        g.base.map((c) =>
          c.layerId === g.state.layerId
            ? Object.freeze({ ...c, [g.state.role + 'X']: x, [g.state.role + 'Y']: y })
            : c,
        ),
      );
      if (!dx && !dy) {
        task.cancel();
        if (finishing) cancel();
        else {
          g.target = target;
          options.draft(target);
          options.preview(null, true);
        }
        return;
      }
      g.target = target;
      options.draft(target);
      assert(g, target);
      if (!finishing) {
        task.request({ gesture: g, target });
        return;
      }
      // Keep cancellation ownership through fresh preparation and final publication.
      cleanup(g);
      releasing = g;
      const { edit, prepared } = pose(g, target, false);
      if (g.state.authoring === true) {
        if (!options.publish) throw Error('No complete trajectory release publisher is available.');
        const finalAdmission = () => {
          assert(g, target, false);
          admitSampledSelectionTrajectoryPublication(edit);
          assert(g, target, false, false);
        };
        return work(() => {
          finalAdmission();
          options.publish!(edit, finalAdmission);
          ownedProposal = null;
          g.state.preview = null;
        });
      }
      const proposal: SampledSelectionPreview = {
        context: g.state.displayContext,
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
        restore(g);
        options.error(cause);
      }
    } finally {
      if (releasing === g) releasing = undefined;
    }
  }
  const move = (e: PointerEvent) => update(e, false);
  const up = (e: PointerEvent) => update(e, true);
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
