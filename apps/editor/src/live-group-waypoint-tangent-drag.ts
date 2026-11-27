import type { Point, Project } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import type { LiveAuthoringSource } from '../../../packages/animation/src/live-motion-owner';
import {
  captureLiveGroupWaypointTangents,
  prepareLiveGroupWaypointTangentPositions,
  prepareLiveGroupWaypointTangentPairs,
  type LiveGroupWaypointTangentOwner,
} from '../../../packages/animation/src/live-group-waypoint-tangents';
import { selectionTrajectoryStamp } from '../../../packages/animation/src/selection-trajectory';
import { createLatestFrameTask } from './latest-frame-task';

export type LiveGroupWaypointTangentPick = Readonly<{
  layerId: string;
  spanId: string;
  groupId: string;
  waypointIndex: number;
  role: 'incoming' | 'outgoing';
}>;
export interface LiveGroupWaypointTangentDraft {
  readonly project: Project;
  readonly owner: LiveGroupWaypointTangentOwner;
  readonly target: Readonly<Point>;
  readonly opposite?: Readonly<Point>;
  validate(): void;
}
export interface LiveGroupWaypointTangentDragState {
  context: { readSource(): LiveAuthoringSource; validate(): void };
  pick: LiveGroupWaypointTangentPick;
  target: Point;
  revision: number;
  enabled: boolean;
  policy: number;
  /** Omitted pair preserves history-free group-handle release. */
  authoring?: boolean;
  authoringPolicy?: number;
  /** Omitted pair preserves history-free aligned release. */
  alignedAuthoring?: boolean;
  alignedAuthoringPolicy?: number;
  /** Omitted pair retains the original independent request. Aligned release requires its own policy. */
  coupling?: 'independent' | 'aligned';
  couplingRevision?: number;
  preview: LiveGroupWaypointTangentDraft | null;
}
export type LiveGroupWaypointTangentView = {
  origin: Point;
  zoom: number;
  width: number;
  height: number;
};
type View = LiveGroupWaypointTangentView & {
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
};
type Base = Omit<
  LiveGroupWaypointTangentDragState,
  | 'preview'
  | 'authoring'
  | 'authoringPolicy'
  | 'alignedAuthoring'
  | 'alignedAuthoringPolicy'
  | 'coupling'
  | 'couplingRevision'
> & {
  authoring: boolean;
  authoringPolicy: number;
  alignedAuthoring: boolean;
  alignedAuthoringPolicy: number;
  coupling: 'independent' | 'aligned';
  couplingRevision: number;
  pickStamp: string;
  readSource: LiveGroupWaypointTangentDragState['context']['readSource'];
  validateSource: () => void;
};
type Scope = ReturnType<typeof captureLiveGroupWaypointTangents>;
type Gesture = {
  epoch: number;
  base: Base;
  view: View;
  pointer: number;
  start: Point;
  scope: Scope;
  owner: LiveGroupWaypointTangentOwner;
  oppositeOwner?: LiveGroupWaypointTangentOwner;
  target: Readonly<Point>;
  prior: LiveGroupWaypointTangentDraft | null;
  preview: LiveGroupWaypointTangentDraft | null;
  observer?: ResizeObserver;
  expire?: () => void;
};

function field(value: object, key: string) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !('value' in d))
    throw Error('Group waypoint handle inputs require original enumerable data fields.');
  return d.value;
}
function synchronous(run: () => void) {
  const result = run() as unknown;
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw Error('Group waypoint handle admission must be synchronous.');
  }
}

/** Original complete-group handle drafts. Omitted coupling retains independent behavior.
 * Dedicated independent publication requires its own captured policy and publisher;
 * aligned drafts require their separate original publisher and policy. */
export function createLiveGroupWaypointTangentDrag(options: {
  canvas: HTMLCanvasElement;
  state(): LiveGroupWaypointTangentDragState;
  view(): LiveGroupWaypointTangentView;
  foreground(owner: LiveGroupWaypointTangentOwner, point: Readonly<Point>): boolean;
  preview(value: LiveGroupWaypointTangentDraft | null, live: boolean): void;
  active(value: boolean): void;
  error(cause: unknown): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  publish?(pick: LiveGroupWaypointTangentPick, target: Readonly<Point>, validate: () => void): void;
  publishAligned?(
    pick: LiveGroupWaypointTangentPick,
    target: Readonly<Point>,
    validate: () => void,
  ): void;
}) {
  const { canvas, state, view: readView, foreground, preview, active, error } = options;
  const descriptor = Object.getOwnPropertyDescriptor(options, 'publish');
  if (
    descriptor &&
    (!descriptor.enumerable ||
      !('value' in descriptor) ||
      (descriptor.value !== undefined && typeof descriptor.value !== 'function'))
  )
    throw Error('Group waypoint handle authoring requires an original publisher data field.');
  const publish = descriptor?.value as typeof options.publish;
  const alignedDescriptor = Object.getOwnPropertyDescriptor(options, 'publishAligned');
  if (
    alignedDescriptor &&
    (!alignedDescriptor.enumerable ||
      !('value' in alignedDescriptor) ||
      (alignedDescriptor.value !== undefined && typeof alignedDescriptor.value !== 'function'))
  )
    throw Error(
      'Aligned group waypoint handle authoring requires an original publisher data field.',
    );
  const publishAligned = alignedDescriptor?.value as typeof options.publishAligned;

  let drag: Gesture | undefined, released: Gesture | undefined;
  let epoch = 0,
    capturing = false,
    disposed = false,
    depth = 0;
  let deferred: Gesture | undefined;
  function read() {
    const raw = state();
    if (!raw || typeof raw !== 'object')
      throw Error('Choose original group waypoint handle inputs.');
    const context = field(raw, 'context'),
      pick = field(raw, 'pick'),
      target = field(raw, 'target');
    const revision = field(raw, 'revision'),
      enabled = field(raw, 'enabled'),
      policy = field(raw, 'policy');
    const hasAuthoring = Object.hasOwn(raw, 'authoring'),
      hasPolicy = Object.hasOwn(raw, 'authoringPolicy');
    if (hasAuthoring !== hasPolicy)
      throw Error('Choose an explicit group handle authoring policy pair.');
    const authoring = hasAuthoring ? field(raw, 'authoring') : false,
      authoringPolicy = hasPolicy ? field(raw, 'authoringPolicy') : 0;
    const hasAlignedAuthoring = Object.hasOwn(raw, 'alignedAuthoring'),
      hasAlignedPolicy = Object.hasOwn(raw, 'alignedAuthoringPolicy');
    if (hasAlignedAuthoring !== hasAlignedPolicy)
      throw Error('Choose an explicit aligned group handle authoring policy pair.');
    const alignedAuthoring = hasAlignedAuthoring ? field(raw, 'alignedAuthoring') : false,
      alignedAuthoringPolicy = hasAlignedPolicy ? field(raw, 'alignedAuthoringPolicy') : 0;
    const hasCoupling = Object.hasOwn(raw, 'coupling'),
      hasRevision = Object.hasOwn(raw, 'couplingRevision');
    if (hasCoupling !== hasRevision)
      throw Error('Choose an explicit group handle coupling/revision pair.');
    const coupling = hasCoupling ? field(raw, 'coupling') : 'independent',
      couplingRevision = hasRevision ? field(raw, 'couplingRevision') : 0;
    const previous = field(raw, 'preview') as LiveGroupWaypointTangentDraft | null;
    validateLiveGraphicData({
      pick,
      target,
      revision,
      enabled,
      policy,
      authoring,
      authoringPolicy,
      alignedAuthoring,
      alignedAuthoringPolicy,
      coupling,
      couplingRevision,
    });
    if (
      !context ||
      typeof context !== 'object' ||
      !pick ||
      !target ||
      Reflect.ownKeys(pick).some(
        (k) => !['layerId', 'spanId', 'groupId', 'waypointIndex', 'role'].includes(k as string),
      ) ||
      Reflect.ownKeys(target).some((k) => !['x', 'y'].includes(k as string)) ||
      !['layerId', 'spanId', 'groupId'].every(
        (k) => typeof field(pick, k) === 'string' && field(pick, k).length,
      ) ||
      !Number.isSafeInteger(field(pick, 'waypointIndex')) ||
      field(pick, 'waypointIndex') < 0 ||
      !['incoming', 'outgoing'].includes(field(pick, 'role')) ||
      ![field(target, 'x'), field(target, 'y')].every(Number.isFinite) ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !Number.isSafeInteger(policy) ||
      policy < 0 ||
      !['independent', 'aligned'].includes(coupling) ||
      !Number.isSafeInteger(couplingRevision) ||
      couplingRevision < 0 ||
      typeof enabled !== 'boolean' ||
      typeof authoring !== 'boolean' ||
      !Number.isSafeInteger(authoringPolicy) ||
      authoringPolicy < 0 ||
      typeof alignedAuthoring !== 'boolean' ||
      !Number.isSafeInteger(alignedAuthoringPolicy) ||
      alignedAuthoringPolicy < 0 ||
      (previous !== null && typeof previous !== 'object')
    )
      throw Error('Choose finite original group waypoint handle inputs and policy revisions.');
    const readSource = field(context, 'readSource'),
      validateSource = field(context, 'validate');
    if (typeof readSource !== 'function' || typeof validateSource !== 'function')
      throw Error('Choose original group waypoint handle source callbacks.');
    const base: Base = {
      context,
      pick,
      target: { x: target.x, y: target.y },
      revision,
      enabled,
      policy,
      authoring,
      authoringPolicy,
      alignedAuthoring,
      alignedAuthoringPolicy,
      coupling,
      couplingRevision,
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
      throw Error('Invalid group waypoint handle canvas view.');
    return out;
  }
  function inputs(b: Base, v: View, policy = true, layout = true) {
    const now = read().base;
    if (
      disposed ||
      now.context !== b.context ||
      now.readSource !== b.readSource ||
      now.validateSource !== b.validateSource ||
      now.pick !== b.pick ||
      now.pickStamp !== b.pickStamp ||
      now.revision !== b.revision ||
      now.coupling !== b.coupling ||
      now.couplingRevision !== b.couplingRevision ||
      now.target.x !== b.target.x ||
      now.target.y !== b.target.y ||
      (policy &&
        (!now.enabled ||
          now.policy !== b.policy ||
          now.authoring !== b.authoring ||
          now.authoringPolicy !== b.authoringPolicy ||
          now.alignedAuthoring !== b.alignedAuthoring ||
          now.alignedAuthoringPolicy !== b.alignedAuthoringPolicy)) ||
      (layout && JSON.stringify(view()) !== JSON.stringify(v))
    )
      throw Error('The original group waypoint handle inputs, policy or view changed.');
  }
  function assert(g: Gesture, captured = true, source = true) {
    const check = () => {
      inputs(g.base, g.view);
      if (
        (captured && g.epoch !== epoch) ||
        read().previous !== g.preview ||
        (captured ? drag !== g || !canvas.hasPointerCapture(g.pointer) : released !== g)
      )
        throw Error('The group waypoint handle capture changed.');
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
      // Independent numeric previews do not inherit this gesture's layout or
      // policy. Gesture-owned priors still enforce their own captured lifetime.
      inputs(g.base, g.view, false, false);
      synchronous(g.base.validateSource);
      synchronous(() => g.prior?.validate());
      // Prior admission is a callback boundary: it cannot publish a numeric
      // preview after changing the original source, even on cancellation.
      synchronous(g.base.validateSource);
      inputs(g.base, g.view, false, false);
      if (!shown()) return; // Prior validation may publish a newer numeric preview.
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
          throw Error('Group waypoint handle target was superseded.');
        assert(g, captured);
      };
      admit();
      const project =
        g.base.coupling === 'aligned'
          ? prepareLiveGroupWaypointTangentPairs([{ owner: g.owner, target }], {
              coupling: 'aligned',
              validate: admit,
            })
          : prepareLiveGroupWaypointTangentPositions([{ owner: g.owner, target }], {
              validate: admit,
            });
      const stamp = selectionTrajectoryStamp(project);
      admit();
      let opposite: Readonly<Point> | undefined;
      if (g.base.coupling === 'aligned') {
        const r = g.oppositeOwner!,
          path = project.layers
            .find((l) => l.id === r.layerId)!
            .liveMotionSpans!.find((s) => s.id === r.spanId)!.path!;
        const point =
          r.role === 'incoming'
            ? path.waypointIncoming![r.waypointIndex]
            : path.waypointTangents![r.waypointIndex + 1];
        opposite = Object.freeze({ x: r.anchor.x + point.x, y: r.anchor.y + point.y });
      }
      // A retained draft owns its source/inputs and candidate, never a public
      // proposed point. Keep this closure free of prior-preview chains.
      const { base, view: frozenView, scope, owner } = g;
      let valid = true;
      const proposal: LiveGroupWaypointTangentDraft = Object.freeze({
        project,
        owner,
        target,
        ...(opposite ? { opposite } : {}),
        validate() {
          if (!valid) throw Error('Group waypoint handle draft was discarded.');
          inputs(base, frozenView);
          synchronous(base.validateSource);
          scope.assertCurrent();
          inputs(base, frozenView);
          validateLiveGraphicData(project);
          if (!valid || selectionTrajectoryStamp(project) !== stamp)
            throw Error('The group waypoint handle draft candidate changed.');
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
        throw Error('Group waypoint handle preview publication changed.');
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
      const owned = ++epoch;
      const { base, previous } = read();
      if (!base.enabled) return false;
      if (base.coupling === 'independent' && base.authoring && typeof publish !== 'function')
        throw Error('Group waypoint handle authoring requires its original publisher.');
      if (
        base.coupling === 'aligned' &&
        base.alignedAuthoring &&
        typeof publishAligned !== 'function'
      )
        throw Error('Aligned group waypoint handle authoring requires its original publisher.');
      const v = view();
      let initial = true;
      const check = () => {
        if (initial && owned !== epoch)
          throw Error('Group waypoint handle initial capture changed.');
        inputs(base, v);
        synchronous(base.validateSource);
        inputs(base, v);
      };
      check();
      if (
        ![e.clientX, e.clientY, e.pointerId].every(Number.isFinite) ||
        !Number.isSafeInteger(e.pointerId)
      )
        throw Error('Invalid group waypoint handle pointer.');
      if (
        e.clientX < v.left ||
        e.clientX >= v.left + v.cssWidth ||
        e.clientY < v.top ||
        e.clientY >= v.top + v.cssHeight
      )
        return false;
      scope = captureLiveGroupWaypointTangents(() => {
        check();
        const source = base.readSource();
        check();
        return source;
      });
      const owner = scope.resolve(
        base.pick.layerId,
        base.pick.spanId,
        base.pick.groupId,
        base.pick.waypointIndex,
        base.pick.role,
      );
      const oppositeOwner =
        base.coupling === 'aligned'
          ? scope.resolve(
              owner.layerId,
              owner.spanId,
              owner.groupId,
              owner.waypointIndex,
              owner.role === 'incoming' ? 'outgoing' : 'incoming',
            )
          : undefined;
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
        throw Error('Foreground artwork owns this group waypoint handle.');
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
        oppositeOwner,
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
      // A rejected initial pick does not own an older released proposal.
      // Retain it only after its own source/input/view admission; a newly
      // acquired gesture still cancels/restores through the normal lifetime.
      if (drag) cancel();
      else changed();
      report(cause);
      return false;
    } finally {
      scope?.dispose();
      capturing = false;
    }
  }
  function update(e: PointerEvent, finishing: boolean): boolean {
    // Capture has already cleared during synchronous release publication.
    // Reentrant delivery from the owned pointer still invalidates that work.
    if (depth && released?.pointer === e.pointerId) {
      cancel();
      return true;
    }
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
        throw Error('Group waypoint handle pointer target overflows.');
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
        const publisher =
          g.base.coupling === 'aligned'
            ? g.base.alignedAuthoring && publishAligned
            : g.base.authoring && publish;
        if (publisher) {
          work(() => {
            const admit = () => assert(g, false);
            admit();
            // The original publisher freshly owns membership/slot/role and the
            // complete transaction; scratch geometry never owns source writes.
            synchronous(() => publisher(g.base.pick, target, admit));
            g.expire?.();
            if (released === g) released = undefined;
            g.scope.dispose();
          });
        } else offer(g, target, false);
      } else if (zero) {
        task.cancel();
        g.expire?.();
        if (read().previous === g.preview) {
          synchronous(() => g.prior?.validate());
          assert(g);
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
      synchronous(() => g.preview?.validate());
      // Preview admission is a callback boundary; retention also requires
      // fresh enclosing source/input/native ownership after it returns.
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
