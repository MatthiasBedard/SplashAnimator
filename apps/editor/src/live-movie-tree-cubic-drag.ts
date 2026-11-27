import type { Point, Project } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import type { LiveAuthoringSource } from '../../../packages/animation/src/live-motion-owner';
import {
  captureLiveMovieTreeCubicControls,
  prepareLiveMovieTreeCubicControlPositions,
  type LiveMovieTreeCubicControlOwner,
  type LiveMovieTreeCubicRole,
} from '../../../packages/animation/src/live-movie-tree-cubic-controls';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { createLatestFrameTask } from './latest-frame-task';

export type LiveMovieTreeCubicPick = Readonly<{
  layerId: string;
  spanId: string;
  shapeId: string;
  role: LiveMovieTreeCubicRole;
}>;
export interface LiveMovieTreeCubicDraft {
  readonly project: Project;
  readonly owner: LiveMovieTreeCubicControlOwner;
  readonly target: Readonly<Point>;
  validate(): void;
}
export interface LiveMovieTreeCubicDragState {
  context: { readSource(): LiveAuthoringSource; validate(): void };
  pick: LiveMovieTreeCubicPick;
  target: Point;
  revision: number;
  enabled: boolean;
  policy: number;
  /** Omitted pair retains exact draft-only legacy behavior. */
  authoring?: boolean;
  authoringPolicy?: number;
  preview: LiveMovieTreeCubicDraft | null;
}
export type LiveMovieTreeCubicView = { origin: Point; zoom: number; width: number; height: number };
type View = LiveMovieTreeCubicView & {
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
};
type Base = Omit<LiveMovieTreeCubicDragState, 'preview' | 'authoring' | 'authoringPolicy'> & {
  authoring: boolean;
  authoringPolicy: number;
  pickStamp: string;
  readSource: LiveMovieTreeCubicDragState['context']['readSource'];
  validateSource: () => void;
};
type Scope = ReturnType<typeof captureLiveMovieTreeCubicControls>;
type Gesture = {
  epoch: number;
  base: Base;
  view: View;
  pointer: number;
  start: Point;
  scope: Scope;
  owner: LiveMovieTreeCubicControlOwner;
  target: Readonly<Point>;
  prior: LiveMovieTreeCubicDraft | null;
  preview: LiveMovieTreeCubicDraft | null;
  observer?: ResizeObserver;
  expire?: () => void;
};

function field(value: object, key: string) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !('value' in d))
    throw Error('Nested movie curve inputs require original enumerable data fields.');
  return d.value;
}
function synchronous(run: () => void) {
  const result = run() as unknown;
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Nested movie curve admission must be synchronous.');
  }
}

/** Native capture and coalesced scratch preparation. Explicit author-on-release
 * uses a separately captured policy and synchronous original publisher; that
 * publisher must freshly resolve/prepare and admit one complete document edit. */
export function createLiveMovieTreeCubicDrag(options: {
  canvas: HTMLCanvasElement;
  state(): LiveMovieTreeCubicDragState;
  view(): LiveMovieTreeCubicView;
  foreground(owner: LiveMovieTreeCubicControlOwner, point: Readonly<Point>): boolean;
  preview(value: LiveMovieTreeCubicDraft | null, live: boolean): void;
  active(value: boolean): void;
  error(cause: unknown): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  publish?(pick: LiveMovieTreeCubicPick, target: Readonly<Point>, validate: () => void): void;
}) {
  const { canvas, state, view: readView, foreground, preview, active, error, publish } = options;
  let drag: Gesture | undefined, released: Gesture | undefined;
  let epoch = 0,
    capturing = false,
    disposed = false,
    depth = 0;
  let deferred: Gesture | undefined;
  function read() {
    const raw = state();
    if (!raw || typeof raw !== 'object') throw Error('Choose original nested movie curve inputs.');
    const context = field(raw, 'context'),
      pick = field(raw, 'pick'),
      target = field(raw, 'target');
    const revision = field(raw, 'revision'),
      enabled = field(raw, 'enabled'),
      policy = field(raw, 'policy');
    const hasAuthoring = Object.hasOwn(raw, 'authoring'),
      hasAuthoringPolicy = Object.hasOwn(raw, 'authoringPolicy');
    if (hasAuthoring !== hasAuthoringPolicy)
      throw Error('Choose an explicit nested authoring policy pair.');
    const authoring = hasAuthoring ? field(raw, 'authoring') : false,
      authoringPolicy = hasAuthoringPolicy ? field(raw, 'authoringPolicy') : 0;
    const previous = field(raw, 'preview') as LiveMovieTreeCubicDraft | null;
    validateLiveGraphicData({
      pick,
      target,
      revision,
      enabled,
      policy,
      authoring,
      authoringPolicy,
    });
    if (
      !context ||
      typeof context !== 'object' ||
      !pick ||
      !target ||
      Reflect.ownKeys(pick).some(
        (k) => !['layerId', 'spanId', 'shapeId', 'role'].includes(k as string),
      ) ||
      Reflect.ownKeys(target).some((k) => !['x', 'y'].includes(k as string)) ||
      !['layerId', 'spanId', 'shapeId'].every(
        (k) => typeof field(pick, k) === 'string' && field(pick, k).length,
      ) ||
      !['start', 'end'].includes(field(pick, 'role')) ||
      ![field(target, 'x'), field(target, 'y')].every(Number.isFinite) ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !Number.isSafeInteger(policy) ||
      policy < 0 ||
      typeof enabled !== 'boolean' ||
      typeof authoring !== 'boolean' ||
      !Number.isSafeInteger(authoringPolicy) ||
      authoringPolicy < 0 ||
      (previous !== null && typeof previous !== 'object')
    )
      throw Error('Choose finite original nested movie curve inputs and policy revisions.');
    const readSource = field(context, 'readSource'),
      validateSource = field(context, 'validate');
    if (typeof readSource !== 'function' || typeof validateSource !== 'function')
      throw Error('Choose original nested movie curve source callbacks.');
    const base: Base = {
      context,
      pick,
      target: { x: target.x, y: target.y },
      revision,
      enabled,
      policy,
      authoring,
      authoringPolicy,
      pickStamp: selectionTrajectoryStamp(pick),
      readSource,
      validateSource,
    };
    return { base, previous };
  }
  function view(): View {
    const v = readView();
    validateLiveGraphicData(v);
    const origin = field(v, 'origin');
    const r = canvas.getBoundingClientRect();
    const out = {
      origin: { x: field(origin, 'x'), y: field(origin, 'y') },
      zoom: field(v, 'zoom'),
      width: field(v, 'width'),
      height: field(v, 'height'),
      left: r.left,
      top: r.top,
      cssWidth: r.width,
      cssHeight: r.height,
    };
    validateLiveGraphicData(out);
    if (Math.min(out.zoom, out.width, out.height, out.cssWidth, out.cssHeight) <= 0)
      throw Error('Invalid nested movie curve canvas view.');
    return out;
  }
  function inputs(b: Base, v: View, policy = true) {
    const now = read().base;
    if (
      disposed ||
      now.context !== b.context ||
      now.readSource !== b.readSource ||
      now.validateSource !== b.validateSource ||
      now.pick !== b.pick ||
      now.pickStamp !== b.pickStamp ||
      now.revision !== b.revision ||
      now.target.x !== b.target.x ||
      now.target.y !== b.target.y ||
      (policy &&
        (!now.enabled ||
          now.policy !== b.policy ||
          now.authoring !== b.authoring ||
          now.authoringPolicy !== b.authoringPolicy)) ||
      JSON.stringify(view()) !== JSON.stringify(v)
    )
      throw Error('The original nested movie curve inputs, policy or view changed.');
  }
  function assert(g: Gesture, captured = true, source = true) {
    const check = () => {
      inputs(g.base, g.view);
      if (
        (captured && g.epoch !== epoch) ||
        read().previous !== g.preview ||
        (captured ? drag !== g || !canvas.hasPointerCapture(g.pointer) : released !== g)
      )
        throw Error('The nested movie curve capture changed.');
    };
    check();
    if (source) {
      synchronous(g.base.validateSource);
      g.scope.assertCurrent();
    }
    check();
  }
  function report(cause: unknown) {
    try {
      error(cause);
    } catch {
      /* Cleanup already ran. */
    }
  }
  function restore(g: Gesture) {
    const shown = () => {
      try {
        return read().previous === g.preview;
      } catch {
        return false;
      }
    };
    try {
      if (!shown()) return; // A newer independent preview owns the display.
      inputs(g.base, g.view, false);
      synchronous(g.base.validateSource);
      g.prior?.validate();
      inputs(g.base, g.view, false);
      preview(g.prior, false);
    } catch {
      if (shown()) preview(null, false);
    } finally {
      g.scope.dispose();
    }
  }
  function cleanup(g: Gesture) {
    task.cancel();
    if (drag === g) drag = undefined;
    if (released === g) released = undefined;
    g.observer?.disconnect();
    if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
    try {
      active(false);
    } catch (cause) {
      report(cause);
    }
  }
  function cancel() {
    epoch++;
    const g = drag ?? released;
    if (!g) return;
    g.expire?.();
    cleanup(g);
    if (depth) deferred = g;
    else restore(g);
  }
  function work<T>(run: () => T) {
    depth++;
    try {
      return run();
    } finally {
      if (!--depth && deferred) {
        const g = deferred;
        deferred = undefined;
        restore(g);
      }
    }
  }
  function fail(g: Gesture, cause: unknown) {
    if (drag === g || released === g) cancel();
    report(cause);
  }
  function offer(g: Gesture, target: Readonly<Point>, captured: boolean, current = () => true) {
    work(() => {
      const admit = () => {
        if (!current() || g.target !== target)
          throw Error('Nested movie curve target was superseded.');
        assert(g, captured);
      };
      admit();
      const project = prepareLiveMovieTreeCubicControlPositions([{ owner: g.owner, target }], {
        validate: admit,
      });
      const stamp = selectionTrajectoryStamp(project);
      admit();
      // A retained draft owns its source/inputs and candidate, never a public
      // proposed point. Keep this closure free of prior-preview chains.
      const { base, view: frozenView, scope, owner } = g;
      let valid = true;
      const proposal: LiveMovieTreeCubicDraft = Object.freeze({
        project,
        owner,
        target,
        validate() {
          if (!valid) throw Error('Nested movie curve draft was discarded.');
          inputs(base, frozenView);
          synchronous(base.validateSource);
          scope.assertCurrent();
          inputs(base, frozenView);
          validateLiveGraphicData(project);
          if (!valid || selectionTrajectoryStamp(project) !== stamp)
            throw Error('The nested movie curve draft candidate changed.');
        },
      });
      proposal.validate();
      admit();
      g.expire?.();
      g.expire = () => {
        valid = false;
      };
      g.preview = proposal;
      preview(proposal, captured);
      admit();
      proposal.validate();
      if (read().previous !== proposal)
        throw Error('Nested movie curve preview publication changed.');
    });
  }
  const task = createLatestFrameTask<{ gesture: Gesture; target: Readonly<Point> }>({
    // Native events do not stamp/clone/compile the whole source. Original
    // source admission happens in the one latest-target task and on release.
    admit(value) {
      assert(value.gesture, true, false);
      return { ...value };
    },
    run({ gesture, target }, current) {
      offer(gesture, target, true, current);
    },
    onError(cause, { gesture }) {
      fail(gesture, cause);
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });
  function down(e: PointerEvent): boolean {
    if (capturing || depth) {
      epoch++;
      if (depth) cancel();
      return false;
    }
    if (disposed || drag || e.button !== 0 || !e.isPrimary || e.pointerType === 'touch')
      return false;
    capturing = true;
    let scope: Scope | undefined;
    try {
      // Policy/target/pick revisions precede layout and private source reads.
      const { base, previous } = read();
      if (!base.enabled) return false;
      if (base.authoring && typeof publish !== 'function')
        throw Error('Nested movie curve authoring requires an original publisher.');
      const v = view(),
        owned = ++epoch;
      let initial = true;
      const check = () => {
        if (initial && owned !== epoch) throw Error('Nested movie curve initial capture changed.');
        inputs(base, v);
        synchronous(base.validateSource);
        inputs(base, v);
      };
      check();
      if (
        ![e.clientX, e.clientY, e.pointerId].every(Number.isFinite) ||
        !Number.isSafeInteger(e.pointerId)
      )
        throw Error('Invalid nested movie curve pointer.');
      if (
        e.clientX < v.left ||
        e.clientX >= v.left + v.cssWidth ||
        e.clientY < v.top ||
        e.clientY >= v.top + v.cssHeight
      )
        return false;
      scope = captureLiveMovieTreeCubicControls(() => {
        check();
        const source = base.readSource();
        check();
        return source;
      });
      const owner = scope.resolve(
        base.pick.layerId,
        base.pick.spanId,
        base.pick.shapeId,
        base.pick.role,
      );
      const screen = {
        x: v.left + ((owner.point.x * v.zoom + v.origin.x) * v.cssWidth) / v.width,
        y: v.top + ((owner.point.y * v.zoom + v.origin.y) * v.cssHeight) / v.height,
      };
      if (Math.hypot(e.clientX - screen.x, e.clientY - screen.y) > 9) return false;
      const point = Object.freeze({
        x: (((e.clientX - v.left) * v.width) / v.cssWidth - v.origin.x) / v.zoom,
        y: (((e.clientY - v.top) * v.height) / v.cssHeight - v.origin.y) / v.zoom,
      });
      if (foreground(owner, point) !== true)
        throw Error('Foreground artwork owns this nested movie curve handle.');
      check();
      scope.assertCurrent();
      check();
      const g: Gesture = {
        epoch: owned,
        base,
        view: v,
        pointer: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        scope,
        owner,
        target: owner.point,
        prior: previous,
        preview: previous,
      };
      canvas.focus({ preventScroll: true });
      check();
      released = undefined;
      drag = g;
      scope = undefined;
      canvas.setPointerCapture(g.pointer);
      assert(g);
      g.observer = new ResizeObserver(changed);
      g.observer.observe(canvas);
      active(true);
      assert(g);
      initial = false;
      e.preventDefault();
      return true;
    } catch (cause) {
      cancel();
      report(cause);
      return false;
    } finally {
      scope?.dispose();
      capturing = false;
    }
  }
  function update(e: PointerEvent, finishing: boolean): boolean {
    const g = drag;
    if (!g || e.pointerId !== g.pointer) return false;
    if (depth) {
      cancel();
      return true;
    }
    try {
      assert(g, true, false);
      let dx = ((e.clientX - g.start.x) * g.view.width) / g.view.cssWidth / g.view.zoom;
      let dy = ((e.clientY - g.start.y) * g.view.height) / g.view.cssHeight / g.view.zoom;
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const target = Object.freeze({ x: g.owner.point.x + dx, y: g.owner.point.y + dy });
      if (![target.x, target.y, dx, dy].every(Number.isFinite))
        throw Error('Nested movie curve pointer target overflows.');
      g.target = target;
      const zero = target.x === g.owner.point.x && target.y === g.owner.point.y;
      if (finishing) {
        // Clear native ownership before any fresh all-request preparation.
        cleanup(g);
        released = g;
        if (zero) {
          cancel();
          return true;
        }
        assert(g, false);
        if (g.base.authoring) {
          work(() => {
            const admit = () => assert(g, false);
            admit();
            // The parent resolves original role ownership and prepares again;
            // neither a public preview nor its candidate owns this publication.
            synchronous(() => publish!(g.base.pick, target, admit));
            g.expire?.();
            if (released === g) released = undefined;
            g.scope.dispose();
          });
        } else offer(g, target, false);
      } else if (zero) {
        task.cancel();
        g.expire?.();
        if (read().previous === g.preview) {
          g.prior?.validate();
          preview(g.prior, true);
          g.preview = g.prior;
        }
      } else task.request({ gesture: g, target });
      e.preventDefault();
      return true;
    } catch (cause) {
      fail(g, cause);
      return true;
    }
  }
  function changed() {
    const g = drag ?? released;
    if (!g) return;
    try {
      assert(g, !!drag);
    } catch {
      cancel();
    }
  }
  const lost = (e: PointerEvent) => {
    if (drag?.pointer === e.pointerId) cancel();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      cancel();
    }
  };
  canvas.addEventListener('lostpointercapture', lost);
  window.addEventListener('scroll', changed, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key);
  return {
    down,
    move: (e: PointerEvent) => update(e, false),
    up: (e: PointerEvent) => update(e, true),
    cancel,
    changed,
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      task.dispose();
      canvas.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('scroll', changed, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
    },
  };
}
