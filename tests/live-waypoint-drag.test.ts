import { afterEach, expect, it, vi } from 'vitest';
import { liveSplitFixture } from './live-motion-split-fixture';
import type { Project, Point } from '../packages/document/src';
import {
  captureLiveWaypoints,
  prepareLiveWaypointPositions,
} from '../packages/animation/src/live-waypoints';
import {
  createLiveWaypointDrag,
  type LiveWaypointDraft,
  type LiveWaypointDragState,
} from '../apps/editor/src/live-waypoint-drag';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(x = 28, y = 201, extra = {}) {
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
function fixture(
  setup?: (project: Project) => void,
  at = 4,
  publish?: (
    pick: LiveWaypointDragState['pick'],
    target: Readonly<Point>,
    validate: () => void,
  ) => void,
) {
  const project = liveSplitFixture((_p, s) => {
    s.path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      waypoints: [
        { x: 0, y: 40 },
        { x: 60, y: 20 },
      ],
    };
  });
  setup?.(project);
  let source = project,
    frame = at,
    revision = 1;
  const before = structuredClone(project),
    original = JSON.stringify(project);
  const view = { origin: { x: 20, y: 10 }, zoom: 2, width: 400, height: 200 };
  const rect = { left: 10, top: 30, width: 200, height: 300 };
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
    readSource: vi.fn(() => ({ project: source, frame, revision })),
    validate: vi.fn(() => {
      if (
        source !== project ||
        JSON.stringify(source) !== original ||
        frame !== at ||
        revision !== 1
      )
        throw Error('source changed');
    }),
  };
  const state: LiveWaypointDragState = {
    context,
    pick: { layerId: 'track', spanId: 'live', shapeId: 'art', waypointIndex: 0 },
    target: { x: -300, y: 800 },
    revision: 0,
    enabled: true,
    policy: 0,
    preview: null,
  };
  const outputs: { value: LiveWaypointDraft | null; live: boolean }[] = [];
  const preview = vi.fn((value: LiveWaypointDraft | null, live: boolean) => {
    state.preview = value;
    outputs.push({ value, live });
  });
  const error = vi.fn(),
    active = vi.fn(),
    foreground = vi.fn(() => true);
  const readState = vi.fn(() => state);
  const drag = createLiveWaypointDrag({
    canvas: canvas as unknown as HTMLCanvasElement,
    state: readState,
    view: () => view,
    preview,
    error,
    active,
    foreground,
    publish,
    requestFrame: (callback) => {
      frames.set(++ticket, callback);
      return ticket;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  const flush = () => {
    const rows = [...frames.values()];
    frames.clear();
    rows.forEach((run) => run());
  };
  const prior = (): LiveWaypointDraft => ({
    project: structuredClone(project),
    owner: {} as LiveWaypointDraft['owner'],
    target: { x: 1, y: 2 },
    validate: vi.fn(),
  });
  return {
    project,
    before,
    state,
    readState,
    view,
    rect,
    canvas,
    context,
    frames,
    flush,
    outputs,
    error,
    active,
    foreground,
    captured,
    observers,
    win,
    drag,
    preview,
    prior,
    source: (p = project, f = 4, r = 1) => {
      source = p;
      frame = f;
      revision = r;
    },
  };
}

for (const shift of [false, true])
  it(`coalesces original-waypoint targets with CSS axes, pointer offsets and Shift ${shift}`, () => {
    const f = fixture();
    expect(f.drag.down(pointer(31, 199))).toBe(true);
    const reads = f.context.readSource.mock.calls.length;
    const checks = f.context.validate.mock.calls.length;
    for (let i = 1; i <= 1000; i++)
      f.drag.move(pointer(31 + i / 50, 199 + i * 0.03, { shiftKey: shift }));
    expect(f.context.readSource).toHaveBeenCalledTimes(reads);
    expect(f.context.validate).toHaveBeenCalledTimes(checks);
    expect(f.frames.size).toBe(1);
    expect(f.outputs).toEqual([]);
    f.flush();
    expect(f.outputs).toHaveLength(1);
    const proposal = f.state.preview!;
    expect(proposal.target.x).toBeCloseTo(28, 12);
    expect(proposal.target.y).toBeCloseTo(shift ? 52 : 62, 12);
    const expected = structuredClone(f.before);
    expected.layers[0].liveMotionSpans![0].path!.waypoints![0].x = 20;
    expected.layers[0].liveMotionSpans![0].path!.waypoints![0].y = shift ? 40 : 50;
    expect(proposal.project).toEqual(expected);
    expect(f.project).toEqual(f.before);
    expect(f.state.target).toEqual({ x: -300, y: 800 });
    proposal.validate();
    f.drag.dispose();
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect(() => proposal.validate()).toThrow();
  });

it('cleans capture/observer before fresh release preparation and never writes authored keys', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231));
  f.flush();
  const first = f.state.preview!,
    calls = f.context.readSource.mock.calls.length;
  let cleanupSeen = false;
  f.context.validate.mockImplementation(() => {
    if (!f.captured.size) {
      cleanupSeen = true;
      expect(f.observers.every((o) => !o.connected)).toBe(true);
    }
  });
  f.drag.move(pointer(58, 240));
  const late = [...f.frames.values()][0];
  expect(f.drag.up(pointer(68, 231))).toBe(true);
  expect(cleanupSeen).toBe(true);
  expect(f.context.readSource.mock.calls.length).toBeGreaterThan(calls);
  expect(f.captured.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.outputs.at(-1)!.live).toBe(false);
  const released = f.state.preview!;
  expect(released.target).toEqual({ x: 48, y: 62 });
  expect(released).not.toBe(first);
  expect(() => first.validate()).toThrow();
  const count = f.outputs.length;
  late();
  expect(f.outputs).toHaveLength(count);
  released.validate();
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

for (const mode of ['cancel', 'escape', 'blur', 'lost', 'resize', 'scroll', 'dispose'] as const)
  it(`restores a valid independent numeric preview after ${mode}`, () => {
    const f = fixture(),
      prior = f.prior();
    f.state.preview = prior;
    f.drag.down(pointer());
    f.drag.move(pointer(48, 231));
    f.flush();
    const proposal = f.state.preview!;
    if (mode === 'escape')
      f.win.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
      );
    else if (mode === 'blur') f.win.dispatchEvent(new Event('blur'));
    else if (mode === 'lost') {
      f.captured.clear();
      f.canvas.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 1 }));
    } else if (mode === 'resize' || mode === 'scroll') {
      f.rect.left++;
      if (mode === 'resize') f.observers[0].callback();
      else f.win.dispatchEvent(new Event('scroll'));
    } else if (mode === 'dispose') f.drag.dispose();
    else f.drag.cancel();
    // Numeric previews own world-coordinate inputs, not gesture layout.
    expect(f.state.preview).toBe(prior);
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(() => proposal.validate()).toThrow();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const change of [
  'target',
  'target-restored',
  'pick',
  'waypoint',
  'policy-restored',
  'disabled',
  'view',
  'source',
  'frame',
  'revision',
] as const)
  for (const phase of ['queued', 'release'] as const)
    it(`rejects ${phase} ${change} without stale proposals/history`, () => {
      const f = fixture();
      f.drag.down(pointer());
      f.drag.move(pointer(48, 231));
      if (phase === 'release') f.flush();
      const old = f.state.preview;
      if (change === 'target') f.state.target.x++;
      if (change === 'target-restored') {
        f.state.target.x++;
        f.state.revision++;
        f.state.target.x--;
      }
      if (change === 'pick') f.state.pick = { ...f.state.pick };
      if (change === 'waypoint') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
      if (change === 'policy-restored') {
        f.state.enabled = false;
        f.state.policy += 2;
        f.state.enabled = true;
      }
      if (change === 'disabled') f.state.enabled = false;
      if (change === 'view') f.view.origin.x++;
      if (change === 'source') f.project.width++;
      if (change === 'frame') f.source(f.project, 5);
      if (change === 'revision') f.source(f.project, 4, 2);
      if (phase === 'queued') f.flush();
      else f.drag.up(pointer(48, 231));
      expect(f.error).toHaveBeenCalled();
      expect(f.state.preview).toBeNull();
      if (old) expect(() => old.validate()).toThrow();
      expect(f.captured.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.project).toEqual(
        change === 'source' ? { ...f.before, width: f.before.width + 1 } : f.before,
      );
      f.drag.dispose();
    });

it('does not overwrite authoritative newer numeric inputs or previews on cancellation', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231));
  f.flush();
  const newer = f.prior();
  f.state.target = { x: 100, y: 200 };
  f.state.revision++;
  f.state.preview = newer;
  f.drag.cancel();
  expect(f.state.preview).toBe(newer);
  expect(f.state.target).toEqual({ x: 100, y: 200 });
  f.drag.dispose();
});

it('zero/return restores prior previews without preparing a no-op candidate', () => {
  const f = fixture(),
    prior = f.prior();
  f.state.preview = prior;
  f.drag.down(pointer());
  f.drag.move(pointer());
  expect(f.frames.size).toBe(0);
  expect(f.state.preview).toBe(prior);
  f.drag.move(pointer(48, 231));
  f.flush();
  const proposal = f.state.preview!;
  f.drag.move(pointer());
  expect(f.state.preview).toBe(prior);
  expect(() => proposal.validate()).toThrow();
  f.drag.up(pointer());
  expect(f.state.preview).toBe(prior);
  expect(f.captured.size).toBe(0);
  expect(f.error).not.toHaveBeenCalled();
  f.drag.dispose();
});

it('ignores foreign pointers and rejects proposed markers as initial owners', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231, { pointerId: 2 }));
  f.drag.up(pointer(48, 231, { pointerId: 2 }));
  expect(f.frames.size).toBe(0);
  expect(f.captured.size).toBe(1);
  f.drag.move(pointer(58, 231));
  f.drag.up(pointer(58, 231));
  const released = f.state.preview!;
  expect(f.drag.down(pointer(58, 231))).toBe(false);
  expect(f.captured.size).toBe(0);
  released.validate();
  f.drag.dispose();
});

for (const extra of [
  { button: 2 },
  { isPrimary: false },
  { pointerType: 'touch' },
  { clientX: NaN },
  { clientY: Infinity },
])
  it(`rejects invalid native entry ${JSON.stringify(extra)}`, () => {
    const f = fixture();
    expect(f.drag.down(pointer(28, 201, extra))).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.context.readSource).not.toHaveBeenCalled();
    f.drag.dispose();
  });

it('captures initial policy revision before source reads and allows source-valid fresh retry', () => {
  const f = fixture(),
    read = f.context.readSource.getMockImplementation()!;
  f.context.readSource.mockImplementationOnce(() => {
    f.state.policy += 2;
    return read();
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  expect(f.state.preview!.target).toEqual({ x: 28, y: 62 });
  f.drag.dispose();
});

it('does not let a public hint or numeric target replace private original control hits', () => {
  const f = fixture();
  f.state.target = { x: 500, y: 700 };
  expect(f.drag.down(pointer(150, 100))).toBe(false);
  expect(f.captured.size).toBe(0);
  f.state.pick = { ...f.state.pick, shapeId: 'invented' };
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.captured.size).toBe(0);
  f.drag.dispose();
});

it('admits original foreground only and rechecks after native capture hooks', () => {
  const f = fixture();
  f.foreground.mockReturnValueOnce(false);
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.captured.size).toBe(0);
  f.canvas.setPointerCapture.mockImplementationOnce((id) => {
    f.captured.add(id);
    f.state.policy++;
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.dispose();
});

it('retains a valid history-free release as the next gesture prior', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.up(pointer(48, 231));
  const prior = f.state.preview!;
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.move(pointer(58, 240));
  f.flush();
  f.drag.cancel();
  expect(f.state.preview).toBe(prior);
  prior.validate();
  f.drag.dispose();
});

it('rejects callback mutation of a complete prepared candidate and preserves the original', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.preview.mockImplementationOnce((value) => {
    f.state.preview = value;
    value!.project.layers[0].liveMotionSpans![0].path!.endY++;
  });
  f.drag.up(pointer(48, 231));
  expect(f.error).toHaveBeenCalled();
  expect(f.state.preview).toBeNull();
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('defers restoration until cancelled private preparation has unwound', () => {
  const f = fixture(),
    prior = f.prior();
  f.state.preview = prior;
  f.drag.down(pointer());
  let invoked = false;
  const validate = f.context.validate.getMockImplementation()!;
  f.context.validate.mockImplementation(() => {
    validate();
    if (!invoked) {
      invoked = true;
      f.drag.cancel();
    }
  });
  f.drag.move(pointer(48, 231));
  f.flush();
  expect(invoked).toBe(true);
  expect(f.state.preview).toBe(prior);
  expect(f.captured.size).toBe(0);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('rejects initial source-reader reentry and permits a fresh capture', () => {
  const f = fixture(),
    read = f.context.readSource.getMockImplementation()!;
  f.context.readSource.mockImplementationOnce(() => {
    f.drag.down(pointer());
    return read();
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});

for (const entry of ['down', 'move', 'up'] as const)
  it(`invalidates swallowed ${entry} reentry during preparation`, () => {
    const f = fixture();
    f.drag.down(pointer());
    let invoked = false;
    f.context.validate.mockImplementation(() => {
      if (!invoked) {
        invoked = true;
        f.drag[entry](pointer(48, 231));
      }
    });
    f.drag.move(pointer(48, 231));
    f.flush();
    expect(invoked).toBe(true);
    expect(f.state.preview).toBeNull();
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

it('a missed pick does not expire a valid released proposal on an unrelated scroll', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.up(pointer(48, 231));
  const prior = f.state.preview!;
  expect(f.drag.down(pointer(180, 60))).toBe(false);
  f.win.dispatchEvent(new Event('scroll'));
  expect(f.state.preview).toBe(prior);
  prior.validate();
  f.drag.dispose();
});

for (const raw of ['target', 'pick', 'view', 'context'] as const)
  it(`rejects ${raw} accessors before evaluating them`, () => {
    const f = fixture();
    let reads = 0;
    const getter = {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    };
    if (raw === 'target') Object.defineProperty(f.state.target, 'x', getter);
    if (raw === 'pick') Object.defineProperty(f.state.pick, 'shapeId', getter);
    if (raw === 'view') Object.defineProperty(f.view.origin, 'x', getter);
    if (raw === 'context') Object.defineProperty(f.context, 'readSource', getter);
    expect(f.drag.down(pointer())).toBe(false);
    expect(reads).toBe(0);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

it('does not overwrite a newer independent preview even without a numeric change', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231));
  f.flush();
  const newer = f.prior();
  f.state.preview = newer;
  f.drag.move(pointer(58, 240));
  expect(f.state.preview).toBe(newer);
  expect(f.captured.size).toBe(0);
  f.drag.dispose();
});

it('continues cleanup when an active-state callback throws', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231));
  f.flush();
  f.active.mockImplementation(() => {
    throw Error('active observer failed');
  });
  expect(() => f.drag.cancel()).not.toThrow();
  expect(f.captured.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.state.preview).toBeNull();
  f.drag.dispose();
});

for (const change of [
  'nan-target',
  'infinite-target',
  'unknown-target',
  'hidden-target',
  'inherited-target',
  'nan-revision',
  'fractional-policy',
  'forged-policy',
] as const)
  it(`rejects raw ${change} without reading original source`, () => {
    const f = fixture();
    if (change === 'nan-target') f.state.target.x = NaN;
    if (change === 'infinite-target') f.state.target.y = Infinity;
    if (change === 'unknown-target') Object.assign(f.state.target, { z: 3 });
    if (change === 'hidden-target')
      Object.defineProperty(f.state.target, 'x', { value: 3, enumerable: false });
    if (change === 'inherited-target') f.state.target = Object.create({ x: 3, y: 4 });
    if (change === 'nan-revision') f.state.revision = NaN;
    if (change === 'fractional-policy') f.state.policy = 0.5;
    if (change === 'forged-policy') Object.assign(f.state, { enabled: 'true' });
    expect(f.drag.down(pointer())).toBe(false);
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

it('captures the policy revision before layout callbacks', () => {
  const f = fixture();
  f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
    f.state.policy += 2;
    return f.rect;
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.dispose();
});

it('admits finite off-view release targets without clamping or history writes', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.up(pointer(-500, 231));
  expect(f.state.preview!.target).toEqual({ x: -520, y: 62 });
  expect(f.state.preview!.project.layers[0].liveMotionSpans![0].path!.waypoints![0].x).toBe(-528);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('rejects a nonfinite movement and preserves the source and valid prior preview', () => {
  const f = fixture(),
    prior = f.prior();
  f.state.preview = prior;
  f.drag.down(pointer());
  f.drag.move(pointer(Infinity, 231));
  expect(f.error).toHaveBeenCalled();
  expect(f.state.preview).toBe(prior);
  expect(f.captured.size).toBe(0);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('retained detached candidates detect later public mutation without changing the source', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.up(pointer(48, 231));
  const proposal = f.state.preview!;
  expect(Object.isFrozen(proposal.target)).toBe(true);
  proposal.project.layers[0].keys[0].shapes[0].x++;
  expect(() => proposal.validate()).toThrow(/candidate/);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('foreign capture-loss events leave the original pointer active', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.canvas.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 2 }));
  expect(f.captured.size).toBe(1);
  f.drag.up(pointer(48, 231));
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});

for (const index of [0, 1])
  for (const at of [0, 1, 4, 7, 8])
    it(`owns original waypoint ${index} at authored/interior frame ${at}`, () => {
      const f = fixture(undefined, at);
      f.state.pick = { ...f.state.pick, waypointIndex: index };
      const x = 28 + index * 60,
        y = 201 - index * 60;
      expect(f.drag.down(pointer(x, y))).toBe(true);
      f.drag.up(pointer(x + 20, y + 30));
      const expected = structuredClone(f.before);
      (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[index] = {
        x: index * 60 + 20,
        y: 50 - index * 20,
      };
      expect(f.state.preview!.project).toEqual(expected);
      expect(f.state.preview!.owner.waypointIndex).toBe(index);
      expect(f.state.target).toEqual({ x: -300, y: 800 });
      expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });

for (const mode of [
  'straight',
  'curved',
  'custom',
  'distance',
  'curved-distance',
  'tangent',
  'custom-tangent',
])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`preserves complete ${basis}/${mode} route and membership while moving only a selected slot`, () => {
      const f = fixture((p) => {
        const path = p.layers[0].liveMotionSpans![0].path!;
        Object.assign(path, { startX: -20, startY: 20 });
        if (mode !== 'straight' && mode !== 'distance') path.curvedWaypoints = true;
        if (mode.includes('distance')) path.distance = true;
        if (mode.includes('custom')) {
          path.waypointTangents = [
            { x: 10, y: 5 },
            { x: 10, y: 5 },
            { x: 15, y: -5 },
            { x: 10, y: -5 },
          ];
          path.waypointIncoming = [
            { x: -20, y: -10 },
            { x: -30, y: 10 },
          ];
        }
        if (mode.includes('tangent'))
          Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
        for (const key of p.layers[0].keys.slice(0, 2)) {
          if (basis !== 'plain')
            Object.assign(key.shapes[0], {
              rotation: 25,
              transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
              pivot: { x: -100, y: 200 },
            });
          key.shapes.push({
            ...structuredClone(key.shapes[0]),
            id: 'second',
            x: key.shapes[0].x + 40,
          });
        }
      });
      expect(f.drag.down(pointer())).toBe(true);
      expect(f.drag.up(pointer(48, 231))).toBe(true);
      const expected = structuredClone(f.before);
      (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 20, y: 50 };
      expect(f.state.preview!.project).toEqual(expected);
      expect(f.state.preview!.owner.shapeIds).toEqual(['art', 'second']);
      expect(f.state.preview!.target).toEqual({ x: 28, y: 62 });
      expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });

for (const index of [-1, 0.5, NaN, Infinity, 2])
  it(`rejects invalid or missing original waypoint ${index} without capture`, () => {
    const f = fixture();
    f.state.pick = { ...f.state.pick, waypointIndex: index };
    expect(f.drag.down(pointer())).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    if (index !== 2) expect(f.context.readSource).not.toHaveBeenCalled();
    f.drag.dispose();
  });

it('rejects an accessor waypoint index without reading it or the source', () => {
  const f = fixture(),
    getter = vi.fn(() => 0);
  Object.defineProperty(f.state.pick, 'waypointIndex', { enumerable: true, get: getter });
  expect(f.drag.down(pointer())).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(f.context.readSource).not.toHaveBeenCalled();
  f.drag.dispose();
});

it('requires explicit gesture enablement and ignores retained author-on-release preferences', () => {
  const f = fixture();
  Object.assign(f.state, { enabled: false, curveAuthoring: true, curveAuthoringPolicy: 100 });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  f.state.enabled = true;
  f.state.policy++;
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  expect(f.state.preview!.target).toEqual({ x: 28, y: 62 });
  expect(f.project).toEqual(f.before);
  expect(f.outputs.at(-1)!.live).toBe(false);
  f.drag.dispose();
});

for (const phase of ['layout', 'focus'] as const)
  it(`rejects swallowed initial reentry during ${phase}, then admits fresh capture`, () => {
    const f = fixture();
    if (phase === 'layout')
      f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
        f.drag.down(pointer());
        return f.rect;
      });
    else
      f.canvas.focus.mockImplementationOnce(() => {
        f.drag.down(pointer());
      });
    expect(f.drag.down(pointer())).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.drag.down(pointer())).toBe(true);
    f.drag.up(pointer(48, 231));
    expect(f.state.preview).not.toBeNull();
    f.drag.dispose();
  });

for (const change of ['source', 'target', 'index', 'policy'] as const)
  it(`rejects late ${change} after complete detached waypoint assignment and native cleanup`, () => {
    const f = fixture();
    f.drag.down(pointer());
    const clone = structuredClone;
    let hit = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
      const out = clone(value),
        p = value as Project;
      if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 20) {
        hit = true;
        expect(f.captured.size).toBe(0);
        expect(f.observers.every((o) => !o.connected)).toBe(true);
        if (change === 'source') f.project.width++;
        if (change === 'target') {
          f.state.target.x++;
          f.state.revision++;
        }
        if (change === 'index') {
          f.state.pick = { ...f.state.pick, waypointIndex: 1 };
          f.state.revision++;
        }
        if (change === 'policy') f.state.policy += 2;
      }
      return out;
    });
    f.drag.up(pointer(48, 231));
    expect(hit).toBe(true);
    expect(f.state.preview).toBeNull();
    expect(f.error).toHaveBeenCalled();
    expect(f.project).toEqual(
      change === 'source' ? { ...f.before, width: f.before.width + 1 } : f.before,
    );
    f.drag.dispose();
  });

for (const change of ['view', 'policy'] as const)
  it(`expires a released gesture proposal after ${change} without expiring its independent numeric prior`, () => {
    const f = fixture(),
      prior = f.prior();
    f.state.preview = prior;
    f.drag.down(pointer());
    f.drag.up(pointer(48, 231));
    const proposal = f.state.preview!;
    if (change === 'view') f.rect.width++;
    else f.state.policy += 2;
    f.drag.changed();
    expect(f.state.preview).toBe(prior);
    expect(() => proposal.validate()).toThrow();
    expect(prior.validate).toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

it('does not restore a gesture-owned prior after its own view expires', () => {
  const f = fixture();
  f.drag.down(pointer());
  f.drag.up(pointer(48, 231));
  const first = f.state.preview!;
  f.drag.down(pointer());
  f.drag.move(pointer(58, 240));
  f.flush();
  f.rect.left++;
  f.drag.changed();
  expect(f.state.preview).toBeNull();
  expect(() => first.validate()).toThrow();
  f.drag.dispose();
});

it('prepares later-track slots without changing earlier recipes or artwork', () => {
  const f = fixture((p) => p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' }));
  f.state.pick = { ...f.state.pick, layerId: 'later' };
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  const expected = structuredClone(f.before);
  (expected.layers[1].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 20, y: 50 };
  expect(f.state.preview!.project).toEqual(expected);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

it('rejects swallowed state-reader reentry before layout and private ownership', () => {
  const f = fixture();
  f.readState.mockImplementationOnce(() => {
    expect(f.drag.down(pointer())).toBe(false);
    return f.state;
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});

it('requires synchronous source admission before original ownership', () => {
  const f = fixture();
  f.context.validate.mockImplementationOnce(() => Promise.resolve());
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.dispose();
});

it('never restores an asynchronously admitted prior as a valid numeric preview', () => {
  const f = fixture(),
    prior = f.prior();
  f.state.preview = prior;
  f.drag.down(pointer());
  f.drag.move(pointer(48, 231));
  f.flush();
  (prior.validate as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());
  f.drag.cancel();
  expect(f.state.preview).toBeNull();
  expect(f.captured.size).toBe(0);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

for (const mode of ['omitted', 'opted out', 'retained other preferences'] as const)
  it(`retains history-free release for ${mode} despite an available publisher`, () => {
    const publish = vi.fn(),
      f = fixture(undefined, 4, publish);
    if (mode !== 'omitted') Object.assign(f.state, { authoring: false, authoringPolicy: 0 });
    if (mode === 'retained other preferences')
      Object.assign(f.state, { groupAuthoring: true, nestedAuthoring: true, releasePolicy: 999 });
    f.drag.down(pointer());
    f.drag.up(pointer(48, 231));
    expect(publish).not.toHaveBeenCalled();
    expect(f.state.preview).not.toBeNull();
    expect(f.project).toEqual(f.before);
  });
for (const phase of ['initial', 'active', 'publisher'] as const)
  for (const policy of ['gesture', 'authoring'] as const)
    it(`rejects ${phase} changed-and-restored ${policy} release ownership and permits fresh retry`, () => {
      let commits = 0,
        hook = () => {};
      const publish = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => {
        hook();
        admit();
        commits++;
      });
      const f = fixture(undefined, 4, publish);
      Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
      const change = () => {
        if (policy === 'gesture') {
          f.state.enabled = false;
          f.state.policy++;
          f.state.enabled = true;
          f.state.policy++;
        } else {
          f.state.authoring = false;
          f.state.authoringPolicy!++;
          f.state.authoring = true;
          f.state.authoringPolicy!++;
        }
        f.drag.changed();
      };
      if (phase === 'initial')
        f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
          change();
          return f.rect;
        });
      const captured = f.drag.down(pointer());
      if (phase === 'initial') expect(captured).toBe(false);
      else {
        expect(captured).toBe(true);
        f.drag.move(pointer(48, 231));
        if (phase === 'active') change();
        else hook = change;
        f.drag.up(pointer(48, 231));
      }
      expect(commits).toBe(0);
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      hook = () => {};
      expect(f.drag.down(pointer())).toBe(true);
      f.drag.up(pointer(48, 231));
      expect(commits).toBe(1);
    });
for (const change of ['target', 'pick', 'frame', 'source', 'view', 'revision', 'close'] as const)
  it(`rejects actual ${change} after entering the original publisher without document writes`, () => {
    let commits = 0;
    const publish = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => {
      if (change === 'target') f.state.target.x++;
      if (change === 'pick') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
      if (change === 'frame') f.source(f.project, 5, 1);
      if (change === 'source') f.project.name = 'user edit retained';
      if (change === 'view') f.rect.width++;
      if (change === 'revision') f.state.revision++;
      if (change === 'close') f.drag.dispose();
      admit();
      commits++;
    });
    const f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(pointer())).toBe(true);
    f.drag.up(pointer(48, 231));
    expect(commits).toBe(0);
    expect(f.captured.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    if (change === 'source') expect(f.project.name).toBe('user edit retained');
    else expect(f.project).toEqual(f.before);
  });
for (const mode of ['zero', 'return', 'cancel', 'lost', 'foreign', 'disabled'] as const)
  it(`never publishes waypoint ${mode} gestures even when authoring is enabled`, () => {
    const publish = vi.fn(),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    if (mode === 'disabled') f.state.enabled = false;
    f.drag.down(pointer());
    if (mode === 'return') {
      f.drag.move(pointer(48, 231));
      f.flush();
    }
    if (mode === 'cancel') f.drag.cancel();
    if (mode === 'lost') f.canvas.releasePointerCapture(1);
    f.drag.up(
      mode === 'foreign'
        ? pointer(48, 231, { pointerId: 2 })
        : mode === 'disabled'
          ? pointer(48, 231)
          : pointer(),
    );
    expect(publish).not.toHaveBeenCalled();
    f.drag.cancel();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
  });
for (const mode of [
  'missing publisher',
  'async publisher',
  'missing pair',
  'invalid revision',
  'getter policy',
] as const)
  it(`rejects ${mode} authoring without promoting fallback preferences`, () => {
    const publish = mode === 'missing publisher' ? undefined : vi.fn(async () => {}),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    if (mode === 'missing pair') delete f.state.authoringPolicy;
    if (mode === 'invalid revision') f.state.authoringPolicy = NaN;
    if (mode === 'getter policy')
      Object.defineProperty(f.state, 'authoringPolicy', {
        get() {
          throw Error('must reject descriptor');
        },
        enumerable: true,
      });
    const captured = f.drag.down(pointer());
    if (mode === 'async publisher') {
      expect(captured).toBe(true);
      f.drag.up(pointer(48, 231));
    } else expect(captured).toBe(false);
    expect(f.error).toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
  });

for (const basis of ['plain', 'affine', 'reflected'])
  for (const index of [0, 1])
    for (const shift of [false, true])
      it(`authors original waypoint ${basis}/${index}/Shift${shift} with fresh complete preparation after cleanup`, () => {
        const candidates: Project[] = [];
        const publish = vi.fn(
          (pick: LiveWaypointDragState['pick'], target: Readonly<Point>, admit: () => void) => {
            expect(f.captured.size).toBe(0);
            expect(f.frames.size).toBe(0);
            expect(f.observers.every((o) => !o.connected)).toBe(true);
            admit();
            const scope = captureLiveWaypoints(f.context.readSource);
            try {
              const owner = scope.resolve(
                pick.layerId,
                pick.spanId,
                pick.shapeId,
                pick.waypointIndex,
              );
              const candidate = prepareLiveWaypointPositions([{ owner, target }], {
                validate: admit,
              });
              admit();
              candidates.push(candidate);
            } finally {
              scope.dispose();
            }
          },
        );
        const f = fixture(
          (p) => {
            if (basis !== 'plain') {
              p.layers[0].liveMotionSpans![0].options = { affine: true };
              for (const key of p.layers[0].keys.slice(0, 2))
                Object.assign(key.shapes[0], {
                  rotation: 25,
                  transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
                  pivot: { x: -100, y: 200 },
                });
            }
            for (const key of p.layers[0].keys.slice(0, 2))
              key.shapes.push({
                ...structuredClone(key.shapes[0]),
                id: 'second',
                x: key.shapes[0].x + 40,
              });
          },
          4,
          publish,
        );
        Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
        f.state.pick = { ...f.state.pick, waypointIndex: index };
        const x = 31 + index * 60,
          y = 199 - index * 60;
        expect(f.drag.down(pointer(x, y))).toBe(true);
        f.drag.move(pointer(x + 20, y + 30, { shiftKey: shift }));
        f.flush();
        const scratch = f.state.preview!;
        f.drag.up(pointer(x + 20, y + 30, { shiftKey: shift }));
        expect(publish).toHaveBeenCalledTimes(1);
        expect(candidates).toHaveLength(1);
        const expected = structuredClone(f.before);
        expected.layers[0].liveMotionSpans![0].path!.waypoints =
          expected.layers[0].liveMotionSpans![0].path!.waypoints!.map((q, i) =>
            i === index ? { x: q.x + 20, y: q.y + (shift ? 0 : 10) } : q,
          );
        expect(candidates[0]).toEqual(expected);
        expect(candidates[0]).not.toBe(scratch.project);
        expect(f.project).toEqual(f.before);
        expect(f.error).not.toHaveBeenCalled();
        expect(() => scratch.validate()).toThrow();
        f.drag.dispose();
      });
it('captures the waypoint authoring revision before layout reads and permits a fresh capture', () => {
  const publish = vi.fn(),
    f = fixture(undefined, 4, publish);
  Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
  f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
    f.state.authoringPolicy! += 2;
    return f.rect;
  });
  expect(f.drag.down(pointer())).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  expect(f.drag.down(pointer())).toBe(true);
  f.drag.up(pointer(48, 231));
  expect(publish).toHaveBeenCalledTimes(1);
  f.drag.dispose();
});
it('rejects a waypoint authoring-policy accessor with zero getter/source reads', () => {
  const f = fixture(undefined, 4, vi.fn()),
    getter = vi.fn(() => 0);
  Object.assign(f.state, { authoring: true });
  Object.defineProperty(f.state, 'authoringPolicy', { enumerable: true, get: getter });
  expect(f.drag.down(pointer())).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  f.drag.dispose();
});
