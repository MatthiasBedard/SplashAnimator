import { afterEach, expect, it, vi } from 'vitest';
import {
  captureLiveIndependentGroupCubicControls,
  prepareLiveIndependentGroupCubicControlPositions,
} from '../packages/animation/src/live-independent-group-cubic-controls';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import {
  createLiveIndependentGroupCubicDrag,
  createLiveIndependentGroupCubicAuthoringDrag,
  type LiveGroupCubicDragState,
  type LiveGroupCubicDraft,
} from '../apps/editor/src/live-group-cubic-drag';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(x: number, y: number, extra = {}) {
  return Object.assign(new Event('pointermove', { cancelable: true }), {
    pointerId: 1,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    pointerType: 'pen',
    shiftKey: false,
    ...extra,
  }) as PointerEvent;
}
type Publisher = (
  pick: LiveGroupCubicDragState['pick'],
  target: Readonly<{ x: number; y: number }>,
  validate: () => void,
) => void;
function fixture(
  group = 'outer',
  role: 'start' | 'end' = 'start',
  basis = 'plain',
  publish?: Publisher,
) {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  const span = l.liveMotionSpans![0];
  span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  span.groupPaths = ['outer', 'second'].map((groupId) => ({
    groupId,
    composition: 'additive',
    path: { startX: 25, startY: 40, endX: -25, endY: 40 },
  }));
  const before = structuredClone(p),
    stamp = JSON.stringify(p);
  let frame = 4,
    revision = 1;
  const view = { origin: { x: 100, y: 80 }, zoom: 1, width: 600, height: 400 },
    rect = { left: 10, top: 30, width: 300, height: 600 };
  const captured = new Set<number>(),
    frames = new Map<number, () => void>();
  let ticket = 0;
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const observers: { callback: () => void; connected: boolean }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      row: (typeof observers)[number];
      constructor(callback: () => void) {
        this.row = { callback, connected: false };
        observers.push(this.row);
      }
      observe() {
        this.row.connected = true;
      }
      disconnect() {
        this.row.connected = false;
      }
    },
  );
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: vi.fn(() => rect),
    focus: vi.fn(),
    setPointerCapture: vi.fn((id: number) => {
      captured.add(id);
    }),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => {
      captured.delete(id);
      canvas.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }));
    }),
  });
  const context = {
    readSource: vi.fn(() => ({ project: p, frame, revision })),
    validate: vi.fn(() => {
      if (JSON.stringify(p) !== stamp || frame !== 4 || revision !== 1)
        throw Error('source changed');
    }),
  };
  const state: LiveGroupCubicDragState = {
    context,
    pick: { layerId: l.id, spanId: span.id, groupId: group, role },
    target: { x: -300, y: 800 },
    revision: 0,
    enabled: true,
    policy: 0,
    preview: null,
  };
  const outputs: (LiveGroupCubicDraft | null)[] = [],
    preview = vi.fn((v: LiveGroupCubicDraft | null) => {
      state.preview = v;
      outputs.push(v);
    }),
    error = vi.fn(),
    active = vi.fn(),
    foreground = vi.fn(() => true);
  const options = {
    canvas: canvas as unknown as HTMLCanvasElement,
    state: () => state,
    view: () => view,
    preview,
    error,
    active,
    foreground,
    requestFrame: (cb: () => void) => {
      frames.set(++ticket, cb);
      return ticket;
    },
    cancelFrame: (id: number) => {
      frames.delete(id);
    },
  };
  const drag = publish
    ? createLiveIndependentGroupCubicAuthoringDrag({ ...options, publish })
    : createLiveIndependentGroupCubicDrag(options);
  const leader = l.keys[role === 'start' ? 0 : 1].shapes.find((s) => s.groups?.[0] === group)!,
    bank = span.groupPaths.find((b) => b.groupId === group)!.path,
    point = {
      x: leader.x + (role === 'start' ? bank.startX : bank.endX),
      y: leader.y + (role === 'start' ? bank.startY : bank.endY),
    };
  const hit = {
    x: rect.left + ((point.x + view.origin.x) * rect.width) / view.width,
    y: rect.top + ((point.y + view.origin.y) * rect.height) / view.height,
  };
  const event = (dx = 0, dy = 0, extra = {}) =>
    pointer(
      hit.x + (dx * rect.width) / view.width,
      hit.y + (dy * rect.height) / view.height,
      extra,
    );
  const flush = () => {
    const jobs = [...frames.values()];
    frames.clear();
    jobs.forEach((run) => run());
  };
  return {
    p,
    before,
    span,
    state,
    context,
    view,
    rect,
    canvas,
    captured,
    frames,
    outputs,
    preview,
    error,
    active,
    foreground,
    observers,
    win,
    drag,
    point,
    hit,
    event,
    flush,
    source: (f = 5, r = 2) => {
      frame = f;
      revision = r;
    },
  };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    for (const role of ['start', 'end'] as const)
      it(`drafts only original ${basis}/${group}/${role} bank with detached exact geometry`, () => {
        const f = fixture(group, role, basis);
        expect(f.drag.down(f.event(2, -1))).toBe(true);
        f.drag.move(f.event(22, 9));
        f.flush();
        const q = structuredClone(f.before),
          path = q.layers[0].liveMotionSpans![0].groupPaths!.find((b) => b.groupId === group)!.path;
        if (role === 'start') {
          path.startX += 20;
          path.startY += 10;
        } else {
          path.endX += 20;
          path.endY += 10;
        }
        expect(f.state.preview!.project).toEqual(q);
        expect(f.state.preview!.target).toEqual({ x: f.point.x + 20, y: f.point.y + 10 });
        expect(f.p).toEqual(f.before);
        expect(f.drag.up(f.event(22, 9))).toBe(true);
        expect(f.state.preview!.project).toEqual(q);
        expect(f.captured.size).toBe(0);
        expect(f.observers.every((o) => !o.connected)).toBe(true);
        expect(f.state.target).toEqual({ x: -300, y: 800 });
        f.state.preview!.validate();
        f.drag.dispose();
      });
for (const shift of [false, true])
  it(`coalesces independent pointer bursts with CSS offsets and Shift ${shift}`, () => {
    const f = fixture();
    f.drag.down(f.event(2, -1));
    const reads = f.context.readSource.mock.calls.length,
      checks = f.context.validate.mock.calls.length;
    for (let i = 1; i <= 1000; i++)
      f.drag.move(f.event(2 + i / 50, -1 + i / 100, { shiftKey: shift }));
    expect(f.context.readSource).toHaveBeenCalledTimes(reads);
    expect(f.context.validate).toHaveBeenCalledTimes(checks);
    expect(f.frames.size).toBe(1);
    expect(f.outputs).toEqual([]);
    f.flush();
    expect(f.state.preview!.target).toEqual({ x: f.point.x + 20, y: f.point.y + (shift ? 0 : 10) });
    f.drag.dispose();
  });
for (const action of ['cancel', 'escape', 'lost', 'blur', 'resize', 'scroll', 'dispose'] as const)
  it(`restores valid numeric prior and cleans native ownership after ${action}`, () => {
    const f = fixture(),
      prior = {
        project: structuredClone(f.p),
        owner: {} as LiveGroupCubicDraft['owner'],
        target: { x: 1, y: 2 },
        validate: vi.fn(),
      };
    f.state.preview = prior;
    f.drag.down(f.event());
    f.drag.move(f.event(20, 10));
    f.flush();
    const draft = f.state.preview!;
    if (action === 'escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    else if (action === 'lost') {
      f.captured.clear();
      f.canvas.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 1 }));
    } else if (action === 'blur') f.win.dispatchEvent(new Event(action));
    else if (action === 'scroll' || action === 'resize') {
      f.rect.left++;
      if (action === 'scroll') f.win.dispatchEvent(new Event('scroll'));
      else f.observers[0].callback();
    } else if (action === 'dispose') f.drag.dispose();
    else f.drag.cancel();
    expect(f.state.preview).toBe(action === 'resize' || action === 'scroll' ? null : prior);
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect(() => draft.validate()).toThrow();
    expect(f.p).toEqual(f.before);
    f.drag.dispose();
  });
for (const action of [
  'target',
  'target-restored',
  'pick',
  'policy-restored',
  'source',
  'frame',
  'view',
] as const)
  for (const phase of ['queued', 'release'])
    it(`rejects ${phase} stale independent ${action} ownership without source writes`, () => {
      const f = fixture();
      f.drag.down(f.event());
      f.drag.move(f.event(20, 10));
      if (action === 'target') {
        f.state.target = { x: 1, y: 2 };
        f.state.revision++;
      }
      if (action === 'target-restored') f.state.revision += 2;
      if (action === 'pick') f.state.pick = { ...f.state.pick, role: 'end' };
      if (action === 'policy-restored') f.state.policy += 2;
      if (action === 'source') f.p.layers[0].name = 'Separate source';
      if (action === 'frame') f.source();
      if (action === 'view') f.view.origin.x++;
      if (phase === 'queued') f.flush();
      else f.drag.up(f.event(20, 10));
      expect(f.state.preview).toBeNull();
      expect(f.captured.size).toBe(0);
      expect(f.frames.size).toBe(0);
      if (action !== 'source') expect(f.p).toEqual(f.before);
      else expect(f.p.layers[0].liveMotionSpans).toEqual(f.before.layers[0].liveMotionSpans);
      f.drag.dispose();
    });
it('rejects retained release authoring preferences and allows a fresh draft-only retry', () => {
  const f = fixture();
  f.state.authoring = true;
  f.state.authoringPolicy = 1;
  expect(f.drag.down(f.event())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  f.state.authoring = false;
  f.state.authoringPolicy++;
  expect(f.drag.down(f.event())).toBe(true);
  f.drag.up(f.event(20, 10));
  expect(f.state.preview).not.toBeNull();
  expect(f.p).toEqual(f.before);
  f.drag.dispose();
});
it('proposed and shared controls cannot own an independent pick; foreign pointers cannot move it', () => {
  const f = fixture();
  expect(f.drag.down(f.event(-25, 0))).toBe(false);
  f.drag.down(f.event());
  expect(f.drag.move(f.event(40, 10, { pointerId: 2 }))).toBe(false);
  f.drag.up(f.event(40, 10));
  const proposal = f.state.preview!;
  expect(f.drag.down(f.event(40, 10))).toBe(false);
  proposal.validate();
  expect(f.p).toEqual(f.before);
  f.drag.dispose();
});
it('rejects foreground artwork outside original group and admits a fresh original pick', () => {
  const f = fixture();
  f.foreground.mockReturnValue(false);
  expect(f.drag.down(f.event())).toBe(false);
  expect(f.captured.size).toBe(0);
  f.foreground.mockReturnValue(true);
  expect(f.drag.down(f.event())).toBe(true);
  f.drag.up(f.event(20, 10));
  expect(f.state.preview!.owner.groupShapeIds).toEqual(['a', 'b']);
  f.drag.dispose();
});
it('retained independent proposals reject mutated public candidates without altering source', () => {
  const f = fixture();
  f.drag.down(f.event());
  f.drag.up(f.event(20, 10));
  f.state.preview!.project.layers[0].keys[0].shapes[0].x++;
  expect(() => f.state.preview!.validate()).toThrow();
  expect(f.p).toEqual(f.before);
  f.drag.dispose();
});
it('zero and return-to-origin do not prepare unchanged candidates', () => {
  const f = fixture();
  f.drag.down(f.event());
  f.drag.move(f.event(20, 10));
  f.flush();
  f.drag.move(f.event());
  expect(f.state.preview).toBeNull();
  f.drag.up(f.event());
  expect(f.state.preview).toBeNull();
  expect(f.error).not.toHaveBeenCalled();
  expect(f.p).toEqual(f.before);
  f.drag.dispose();
});
for (const field of ['pick', 'target'] as const)
  it(`rejects raw ${field} getters without reading them`, () => {
    const f = fixture(),
      getter = vi.fn(() => ({}));
    Object.defineProperty(f.state, field, { get: getter, enumerable: true });
    expect(f.drag.down(f.event())).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    f.drag.dispose();
  });

it('retains finite off-view independent targets without clamping or source/history writes', () => {
  const f = fixture();
  expect(f.drag.down(f.event())).toBe(true);
  expect(f.drag.up(f.event(-2000, 1000))).toBe(true);
  expect(f.state.preview!.target).toEqual({ x: f.point.x - 2000, y: f.point.y + 1000 });
  expect(f.state.preview!.project.layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(
    -1975,
  );
  expect(f.p).toEqual(f.before);
  expect(f.captured.size).toBe(0);
  f.drag.dispose();
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    for (const role of ['start', 'end'] as const)
      it(`direct independent ${basis}/${group}/${role} release freshly prepares one admitted bank after cleanup`, () => {
        let candidate: ReturnType<typeof fixture>['p'] | undefined;
        const publish = vi.fn<Publisher>((pick, target, admit) => {
          expect(f.captured.size).toBe(0);
          expect(f.observers.every((o) => !o.connected)).toBe(true);
          admit();
          const scope = captureLiveIndependentGroupCubicControls(f.context.readSource);
          try {
            const owner = scope.resolve(pick.layerId, pick.spanId, pick.groupId, pick.role);
            candidate = prepareLiveIndependentGroupCubicControlPositions([{ owner, target }], {
              validate: admit,
            });
            admit();
          } finally {
            scope.dispose();
          }
        });
        const f = fixture(group, role, basis, publish);
        f.state.independentAuthoring = true;
        f.state.independentAuthoringPolicy = 1;
        expect(f.drag.down(f.event(2, -1))).toBe(true);
        f.drag.move(f.event(22, 9));
        f.flush();
        expect(publish).not.toHaveBeenCalled();
        f.drag.up(f.event(22, 9));
        expect(publish).toHaveBeenCalledTimes(1);
        const q = structuredClone(f.before),
          p = q.layers[0].liveMotionSpans![0].groupPaths!.find((v) => v.groupId === group)!.path;
        if (role === 'start') {
          p.startX += 20;
          p.startY += 10;
        } else {
          p.endX += 20;
          p.endY += 10;
        }
        expect(candidate).toEqual(q);
        expect(f.p).toEqual(f.before);
        expect(f.frames.size).toBe(0);
        f.drag.dispose();
      });
for (const mode of ['omitted', 'disabled', 'retained-shared'] as const)
  it(`independent ${mode} release stays history-free despite an available original publisher`, () => {
    const publish = vi.fn<Publisher>();
    const f = fixture('outer', 'start', 'plain', publish);
    if (mode === 'disabled') {
      f.state.independentAuthoring = false;
      f.state.independentAuthoringPolicy = 4;
    }
    if (mode === 'retained-shared') {
      f.state.authoring = true;
      f.state.authoringPolicy = 99;
    }
    expect(f.drag.down(f.event())).toBe(true);
    f.drag.up(f.event(20, 10));
    expect(publish).not.toHaveBeenCalled();
    expect(f.state.preview).not.toBeNull();
    expect(f.p).toEqual(f.before);
    f.drag.dispose();
  });
for (const policy of ['policy', 'independentAuthoringPolicy'] as const)
  for (const phase of ['initial', 'queued', 'release'])
    it(`dedicated release rejects ${phase} restored ${policy} and permits a source-valid authoring retry`, () => {
      const publish = vi.fn<Publisher>((_pick, _target, admit) => admit());
      const f = fixture('outer', 'start', 'plain', publish);
      f.state.independentAuthoring = true;
      f.state.independentAuthoringPolicy = 0;
      if (phase === 'initial')
        f.context.readSource.mockImplementationOnce(() => {
          f.state[policy]! += 2;
          return { project: f.p, frame: 4, revision: 1 };
        });
      expect(f.drag.down(f.event())).toBe(phase !== 'initial');
      if (phase !== 'initial') {
        f.drag.move(f.event(20, 10));
        f.state[policy]! += 2;
        if (phase === 'queued') f.flush();
        else f.drag.up(f.event(20, 10));
      }
      expect(publish).not.toHaveBeenCalled();
      expect(f.captured.size).toBe(0);
      expect(f.p).toEqual(f.before);
      expect(f.drag.down(f.event())).toBe(true);
      f.drag.up(f.event(20, 10));
      expect(publish).toHaveBeenCalledTimes(1);
      f.drag.dispose();
    });
for (const action of ['target', 'author-policy', 'gesture-policy', 'source', 'view'] as const)
  it(`independent original publisher rejects actual late ${action} after entering fresh release preparation`, () => {
    const committed = vi.fn();
    const publish = vi.fn<Publisher>((_pick, _target, admit) => {
      admit();
      if (action === 'target') f.state.revision += 2;
      if (action === 'author-policy') f.state.independentAuthoringPolicy! += 2;
      if (action === 'gesture-policy') f.state.policy += 2;
      if (action === 'source') f.p.layers[0].name = 'Separate source';
      if (action === 'view') f.view.origin.x++;
      admit();
      committed();
    });
    const f = fixture('outer', 'start', 'plain', publish);
    f.state.independentAuthoring = true;
    f.state.independentAuthoringPolicy = 0;
    f.drag.down(f.event());
    f.drag.up(f.event(20, 10));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(committed).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    expect(f.p.layers[0].liveMotionSpans).toEqual(f.before.layers[0].liveMotionSpans);
    f.drag.dispose();
  });
for (const raw of ['missing', 'numeric', 'getter'] as const)
  it(`dedicated independent ${raw} authoring policy rejects before original source reads`, () => {
    const f = fixture('outer', 'start', 'plain', vi.fn<Publisher>()),
      getter = vi.fn(() => true);
    f.state.independentAuthoring = true;
    if (raw === 'numeric')
      Object.assign(f.state, { independentAuthoring: 'true', independentAuthoringPolicy: 0 });
    if (raw === 'getter') {
      f.state.independentAuthoringPolicy = 0;
      Object.defineProperty(f.state, 'independentAuthoring', { get: getter, enumerable: true });
    }
    expect(f.drag.down(f.event())).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
