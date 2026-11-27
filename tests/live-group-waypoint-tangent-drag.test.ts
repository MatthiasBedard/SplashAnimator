import { afterEach, expect, it, vi } from 'vitest';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { MAX_SYMBOL_ARTWORK, type Project, type Point } from '../packages/document/src';
import { validateLiveGraphicData } from '../packages/document/src/live-motion';

import {
  captureLiveGroupWaypointTangents,
  prepareLiveGroupWaypointTangentPositions,
  prepareLiveGroupWaypointTangentPairs,
} from '../packages/animation/src/live-group-waypoint-tangents';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import {
  createLiveGroupWaypointTangentDrag,
  type LiveGroupWaypointTangentDraft,
  type LiveGroupWaypointTangentDragState,
} from '../apps/editor/src/live-group-waypoint-tangent-drag';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(x = 38, y = 216, extra = {}) {
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
  publish?: Parameters<typeof createLiveGroupWaypointTangentDrag>[0]['publish'],
  publishAligned?: Parameters<typeof createLiveGroupWaypointTangentDrag>[0]['publishAligned'],
) {
  const { p: project } = liveRotationFixture('rigid', 'plain', true);
  project.layers[0].liveMotionSpans![0].path = {
    startX: 3,
    startY: 7,
    endX: -2,
    endY: 6,
    curvedWaypoints: true,
    waypoints: [
      { x: 20, y: 30 },
      { x: 60, y: 30 },
    ],
    waypointTangents: [
      { x: 10, y: 5 },
      { x: 10, y: 5 },
      { x: 15, y: -5 },
      { x: 10, y: -5 },
    ],
    waypointIncoming: [
      { x: -20, y: -10 },
      { x: -30, y: 10 },
    ],
  };
  setup?.(project);
  let source = project,
    frame = at,
    revision = 1;
  const before = structuredClone(project),
    original = JSON.stringify(project);
  const view = { origin: { x: 20, y: 10 }, zoom: 2, width: 1200, height: 600 };
  const rect = { left: 10, top: 30, width: 600, height: 900 };
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
      validateLiveGraphicData(source);
      if (
        source !== project ||
        JSON.stringify(source) !== original ||
        frame !== at ||
        revision !== 1
      )
        throw Error('source changed');
    }),
  };
  const state: LiveGroupWaypointTangentDragState = {
    context,
    pick: {
      layerId: 'track',
      spanId: 'live',
      groupId: 'outer',
      waypointIndex: 0,
      role: 'outgoing',
    },
    target: { x: -300, y: 800 },
    revision: 0,
    enabled: true,
    policy: 0,
    preview: null,
  };
  const outputs: { value: LiveGroupWaypointTangentDraft | null; live: boolean }[] = [];
  const preview = vi.fn((value: LiveGroupWaypointTangentDraft | null, live: boolean) => {
    state.preview = value;
    outputs.push({ value, live });
  });
  const error = vi.fn(),
    active = vi.fn(),
    foreground = vi.fn(() => true);
  const readState = vi.fn(() => state);
  const options: Parameters<typeof createLiveGroupWaypointTangentDrag>[0] = {
    publishAligned,
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
  };
  const drag = createLiveGroupWaypointTangentDrag(options);
  const flush = () => {
    const rows = [...frames.values()];
    frames.clear();
    rows.forEach((run) => run());
  };
  const prior = (): LiveGroupWaypointTangentDraft => ({
    project: structuredClone(project),
    owner: {} as LiveGroupWaypointTangentDraft['owner'],
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
    options,
    preview,
    prior,
    source: (p = project, f = at, r = 1) => {
      source = p;
      frame = f;
      revision = r;
    },
  };
}

type Fixture = ReturnType<typeof fixture>;
function control(f: Fixture) {
  const pick = f.state.pick,
    l = f.before.layers.find((l) => l.id === pick.layerId)!,
    span = l.liveMotionSpans!.find((s) => s.id === pick.spanId)!,
    a = l.keys
      .find((k) => k.frame === span.start)!
      .shapes.find((a) => a.groups?.[0] === pick.groupId)!,
    path = span.path!,
    w = path.waypoints![pick.waypointIndex],
    v =
      pick.role === 'incoming'
        ? path.waypointIncoming![pick.waypointIndex]
        : path.waypointTangents![pick.waypointIndex + 1];
  return {
    anchor: { x: a.x + w.x, y: a.y + w.y },
    point: { x: a.x + w.x + v.x, y: a.y + w.y + v.y },
  };
}
function at(f: Fixture, dx = 0, dy = 0, extra = {}, offset = { x: 2, y: -1 }) {
  const p = control(f).point,
    v = f.view,
    r = f.rect;
  return pointer(
    r.left + ((p.x * v.zoom + v.origin.x) * r.width) / v.width + offset.x + dx,
    r.top + ((p.y * v.zoom + v.origin.y) * r.height) / v.height + offset.y + dy,
    extra,
  );
}
function expected(f: Fixture, target: Readonly<Point>) {
  const p = structuredClone(f.before),
    pick = f.state.pick,
    path = p.layers
      .find((l) => l.id === pick.layerId)!
      .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!,
    a = control(f).anchor,
    offset = { x: target.x - a.x, y: target.y - a.y };
  if (pick.role === 'incoming') (path.waypointIncoming as Point[])[pick.waypointIndex] = offset;
  else (path.waypointTangents as Point[])[pick.waypointIndex + 1] = offset;
  return p;
}
for (const shift of [false, true])
  it(`coalesces 1000 independent-CSS movements with frozen handle offsets and Shift ${shift}`, () => {
    const f = fixture(),
      start = control(f).point;
    expect(f.drag.down(at(f))).toBe(true);
    const reads = f.context.readSource.mock.calls.length,
      checks = f.context.validate.mock.calls.length,
      clone = vi.spyOn(globalThis, 'structuredClone');
    for (let i = 1; i <= 1000; i++) f.drag.move(at(f, i / 50, i * 0.03, { shiftKey: shift }));
    expect(f.context.readSource).toHaveBeenCalledTimes(reads);
    expect(f.context.validate).toHaveBeenCalledTimes(checks);
    expect(clone).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(1);
    expect(f.outputs).toEqual([]);
    f.flush();
    const q = { x: start.x + 20, y: start.y + (shift ? 0 : 10) },
      scratch = f.state.preview!;
    expect(scratch.target).toEqual(q);
    expect(scratch.project).toEqual(expected(f, q));
    f.drag.up(at(f, 20, 30, { shiftKey: shift }));
    const out = f.state.preview!;
    expect(out.target).toEqual(q);
    expect(out.project).toEqual(expected(f, q));
    expect(out).not.toBe(scratch);
    expect(out.project).not.toBe(scratch.project);
    expect(() => scratch.validate()).toThrow();
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect(f.project).toEqual(f.before);
    expect(f.outputs.at(-1)!.live).toBe(false);
    expect(f.state.target).toEqual({ x: -300, y: 800 });
    f.drag.dispose();
  });

for (const frame of [0, 1, 4, 7, 8])
  it(`keeps authored original handle at capture frame ${frame}`, () => {
    const f = fixture(undefined, frame),
      q = { x: control(f).point.x + 20, y: control(f).point.y + 10 };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(expected(f, q));
    expect(f.state.preview!.owner.frame).toBe(frame);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const action of [
  'cancel',
  'Escape',
  'lost',
  'resize',
  'scroll',
  'dispose',
  'zero',
  'return',
  'policy',
  'source',
  'target',
  'index',
  'role',
  'root',
  'revision',
  'frame',
  'context',
  'view',
])
  it(`cleans ${action} capture without source/history writes`, () => {
    const f = fixture(),
      down = at(f),
      up = at(f, 20, 30);
    expect(f.drag.down(down)).toBe(true);
    if (!['zero', 'return'].includes(action)) {
      f.drag.move(up);
      f.flush();
    }
    if (action === 'return') {
      f.drag.move(up);
      f.flush();
      f.drag.move(down);
    }
    if (action === 'cancel') f.drag.cancel();
    if (action === 'Escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    if (action === 'lost') f.canvas.releasePointerCapture(1);
    if (action === 'resize') {
      f.rect.width++;
      f.observers[0].callback();
    }
    if (action === 'scroll') {
      f.rect.top++;
      f.win.dispatchEvent(new Event('scroll'));
    }
    if (action === 'dispose') f.drag.dispose();
    if (action === 'policy') {
      f.state.enabled = false;
      f.state.policy += 2;
      f.state.enabled = true;
    }
    if (action === 'source') f.project.name = 'Source change survives';
    if (action === 'target') f.state.target.x++;
    if (action === 'index') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
    if (action === 'role') f.state.pick = { ...f.state.pick, role: 'incoming' };
    if (action === 'root') f.state.pick = { ...f.state.pick, groupId: 'second' };
    if (action === 'revision') f.state.revision++;
    if (action === 'frame') f.source(f.project, 5, 1);
    if (action === 'context') f.state.context = { ...f.context };
    if (action === 'view') f.rect.width++;
    f.drag.up(action === 'zero' || action === 'return' ? down : up);
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    if (action === 'source') expect(f.project.name).toBe('Source change survives');
    else expect(f.project).toEqual(f.before);
    if (!['zero', 'return'].includes(action)) expect(f.state.preview).toBeNull();
    f.drag.dispose();
  });
for (const mode of ['Escape', 'view', 'policy', 'native', 'zero', 'return'])
  it(`restores independent numeric priors for ${mode} with fresh original source admission`, () => {
    const f = fixture(),
      prior = f.prior();
    f.state.preview = prior;
    const a = at(f),
      b = at(f, 20, 30);
    expect(f.drag.down(a)).toBe(true);
    f.drag.move(b);
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    if (mode === 'Escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    if (mode === 'view') {
      f.rect.left++;
      f.drag.changed();
    }
    if (mode === 'policy') {
      f.state.policy += 2;
      f.drag.changed();
    }
    if (mode === 'native') f.canvas.releasePointerCapture(1);
    if (mode === 'zero' || mode === 'return') f.drag.move(a);
    if (mode === 'return') f.drag.up(a);
    if (mode === 'zero') f.drag.cancel();
    expect(f.state.preview).toBe(prior);
    expect(prior.validate).toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['cancel', 'zero'])
  it(`rejects actual source edits inside numeric-prior ${mode} callbacks`, () => {
    const f = fixture(),
      prior = f.prior(),
      a = at(f),
      b = at(f, 20, 30);
    f.state.preview = prior;
    expect(f.drag.down(a)).toBe(true);
    f.drag.move(b);
    f.flush();
    (prior.validate as ReturnType<typeof vi.fn>).mockImplementation(() => {
      f.project.name = 'Prior callback source edit';
    });
    if (mode === 'cancel') f.drag.cancel();
    else f.drag.move(a);
    expect(f.state.preview).toBeNull();
    expect(f.project.name).toBe('Prior callback source edit');
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['target', 'role', 'preview'])
  it(`keeps newer authoritative ${mode} state during cancellation`, () => {
    const f = fixture(),
      prior = f.prior();
    f.state.preview = prior;
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 30));
    f.flush();
    const newer = f.prior();
    if (mode === 'target') {
      f.state.target = { x: 2, y: 3 };
      f.state.revision++;
    }
    if (mode === 'role') {
      f.state.pick = { ...f.state.pick, role: 'incoming' };
      f.state.revision++;
    }
    if (mode === 'preview') f.state.preview = newer;
    f.drag.cancel();
    expect(f.state.preview).toBe(mode === 'preview' ? newer : null);
    if (mode === 'target') expect(f.state.target).toEqual({ x: 2, y: 3 });
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const phase of ['state', 'layout', 'focus', 'foreground'])
  it(`rejects swallowed initial ${phase} reentry and admits a fresh capture`, () => {
    const f = fixture(),
      event = at(f),
      attack = () => {
        expect(f.drag.down(event)).toBe(false);
      };
    if (phase === 'state') {
      const read = f.readState.getMockImplementation()!;
      f.readState.mockImplementationOnce(() => {
        attack();
        return read();
      });
    }
    if (phase === 'layout')
      f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
        attack();
        return f.rect;
      });
    if (phase === 'focus') f.canvas.focus.mockImplementationOnce(attack);
    if (phase === 'foreground')
      f.foreground.mockImplementationOnce(() => {
        attack();
        return true;
      });
    expect(f.drag.down(event)).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    expect(f.drag.down(event)).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview).not.toBeNull();
    f.drag.dispose();
  });
for (const phase of ['initial', 'active', 'release'])
  it(`rejects changed-and-restored gesture policy at ${phase} and allows retry`, () => {
    const nativeClone = structuredClone;
    const f = fixture(),
      a = at(f),
      b = at(f, 20, 30),
      change = () => {
        f.state.enabled = false;
        f.state.policy++;
        f.state.enabled = true;
        f.state.policy++;
      };
    if (phase === 'initial')
      f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
        change();
        return f.rect;
      });
    if (phase === 'release') {
      const clone = structuredClone;
      let hit = false;
      vi.stubGlobal('structuredClone', (v: unknown) => {
        const out = clone(v);
        if (
          !hit &&
          (out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30
        ) {
          hit = true;
          change();
        }
        return out;
      });
    }
    const captured = f.drag.down(a);
    if (phase === 'initial') expect(captured).toBe(false);
    else {
      expect(captured).toBe(true);
      if (phase === 'active') change();
      f.drag.up(b);
    }
    expect(f.captured.size).toBe(0);
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    vi.stubGlobal('structuredClone', nativeClone);
    expect(f.drag.down(a)).toBe(true);
    f.drag.up(b);
    expect(f.state.preview).not.toBeNull();
    f.drag.dispose();
  });
for (const field of ['pick', 'target', 'context', 'revision', 'enabled', 'policy', 'preview'])
  it(`rejects raw ${field} accessors before source reads`, () => {
    const f = fixture(),
      a = at(f),
      get = vi.fn(() => {
        throw Error('getter ran');
      });
    Object.defineProperty(f.state, field, { get, enumerable: true });
    expect(f.drag.down(a)).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const field of ['role', 'waypointIndex', 'groupId'])
  it(`rejects raw pick ${field} accessors without getter reads`, () => {
    const f = fixture(),
      a = at(f),
      get = vi.fn(() => {
        throw Error('getter ran');
      });
    Object.defineProperty(f.state.pick, field, { get, enumerable: true });
    expect(f.drag.down(a)).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    f.drag.dispose();
  });
for (const role of ['start', 'end', 'anchor', '', null, 0])
  it(`rejects non-owned explicit role ${String(role)} without reinterpretation`, () => {
    const f = fixture(),
      a = at(f);
    f.state.pick = { ...f.state.pick, role: role as 'incoming' };
    expect(f.drag.down(a)).toBe(false);
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['hidden', 'locked', 'automatic', 'mirrored', 'empty'])
  it(`does not acquire ${mode} original controls`, () => {
    const f = fixture((p) => {
        if (mode === 'hidden') p.layers[0].visible = false;
        if (mode === 'locked') p.layers[0].locked = true;
        if (mode === 'automatic') {
          delete p.layers[0].liveMotionSpans![0].path!.waypointTangents;
          delete p.layers[0].liveMotionSpans![0].path!.waypointIncoming;
        }
        if (mode === 'mirrored') delete p.layers[0].liveMotionSpans![0].path!.waypointIncoming;
        if (mode === 'empty') {
          const path = p.layers[0].liveMotionSpans![0].path!;
          path.waypoints = [];
          path.waypointTangents = [path.waypointTangents![0], path.waypointTangents![3]];
          path.waypointIncoming = [];
        }
      }),
      a = pointer();
    expect(f.drag.down(a)).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

it('uses original handles and foreground, never proposed poses for later picks', () => {
  const f = fixture(),
    a = at(f),
    b = at(f, 30, 30);
  expect(f.drag.down(a)).toBe(true);
  f.drag.up(b);
  const proposal = f.state.preview!;
  expect(f.drag.down(b)).toBe(false);
  expect(f.state.preview).toBe(proposal);
  f.foreground.mockReturnValueOnce(false);
  expect(f.drag.down(a)).toBe(false);
  expect(f.state.preview).toBe(proposal);
  expect(f.drag.down(a)).toBe(true);
  f.drag.cancel();
  expect(f.state.preview).toBe(proposal);
  f.drag.dispose();
});
for (const extra of [
  { pointerType: 'touch' },
  { isPrimary: false },
  { button: 1 },
  { pointerId: NaN },
])
  it(`rejects unsupported pointer ${JSON.stringify(extra)}`, () => {
    const f = fixture();
    expect(f.drag.down(at(f, 0, 0, extra))).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
it('ignores foreign pointer movement/release until original cancellation', () => {
  const f = fixture();
  expect(f.drag.down(at(f))).toBe(true);
  expect(f.drag.move(at(f, 20, 30, { pointerId: 2 }))).toBe(false);
  expect(f.drag.up(at(f, 20, 30, { pointerId: 2 }))).toBe(false);
  expect(f.captured.has(1)).toBe(true);
  expect(f.outputs).toEqual([]);
  f.drag.cancel();
  expect(f.captured.size).toBe(0);
  f.drag.dispose();
});
for (const phase of ['movement', 'release'])
  for (const mutation of ['prototype', 'clock', 'getter', 'target', 'source', 'role'])
    it(`rejects actual ${mutation} after ${phase} detached preparation and permits valid source recovery`, () => {
      const f = fixture(),
        write = f.preview.getMockImplementation()!;
      let hit = false,
        reads = 0;
      f.preview.mockImplementation((value, live) => {
        write(value, live);
        if (value && !hit && live === (phase === 'movement')) {
          hit = true;
          if (mutation === 'prototype')
            Object.setPrototypeOf(value.project.layers[0].keys[0].shapes[0], { forged: true });
          if (mutation === 'clock') value.project.duration++;
          if (mutation === 'getter')
            Object.defineProperty(value.project.layers[0].keys[0].shapes[0], 'width', {
              enumerable: true,
              get() {
                reads++;
                return 20;
              },
            });
          if (mutation === 'target') f.state.target.x++;
          if (mutation === 'role') {
            f.state.pick = { ...f.state.pick, role: 'incoming' };
            f.state.revision++;
          }
          if (mutation === 'source') f.project.name = 'Late source retained';
        }
      });
      const a = at(f),
        b = at(f, 20, 30);
      expect(f.drag.down(a)).toBe(true);
      if (phase === 'movement') {
        f.drag.move(b);
        f.flush();
      } else f.drag.up(b);
      expect(hit).toBe(true);
      expect(reads).toBe(0);
      expect(f.captured.size).toBe(0);
      expect(f.state.preview).toBeNull();
      if (mutation === 'source') expect(f.project.name).toBe('Late source retained');
      else {
        expect(f.project).toEqual(f.before);
        f.preview.mockImplementation(write);
        if (mutation === 'role') f.state.pick = { ...f.state.pick, role: 'outgoing' };
        expect(f.drag.down(at(f))).toBe(true);
        f.drag.up(at(f, 20, 30));
        expect(f.state.preview).not.toBeNull();
      }
      f.drag.dispose();
    });

for (const mutation of ['candidate', 'getter', 'source', 'target', 'view'] as const)
  it(`rejected new foreground capture cannot retain stale released ${mutation} ownership`, () => {
    const f = fixture(),
      a = at(f),
      b = at(f, 20, 30);
    expect(f.drag.down(a)).toBe(true);
    f.drag.up(b);
    const old = f.state.preview!;
    let hit = false,
      reads = 0;
    f.foreground.mockImplementationOnce(() => {
      hit = true;
      if (mutation === 'candidate')
        Object.setPrototypeOf(old.project.layers[0].keys[0].shapes[0], { forged: true });
      if (mutation === 'getter')
        Object.defineProperty(old.project.layers[0].keys[0].shapes[0], 'width', {
          enumerable: true,
          get() {
            reads++;
            return 20;
          },
        });
      if (mutation === 'source') f.project.name = 'Rejected capture source survives';
      if (mutation === 'target') f.state.target.x++;
      if (mutation === 'view') f.rect.left++;
      return false;
    });
    expect(f.drag.down(a)).toBe(false);
    expect(hit).toBe(true);
    expect(reads).toBe(0);
    expect(f.captured.size).toBe(0);
    expect(f.state.preview).toBeNull();
    if (mutation === 'source') expect(f.project.name).toBe('Rejected capture source survives');
    else {
      expect(f.project).toEqual(f.before);
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 30));
      expect(f.state.preview).not.toBeNull();
    }
    f.drag.dispose();
  });

for (const axis of ['y', 'tie'])
  it(`uses document-space Shift ${axis} after independent CSS scaling`, () => {
    const f = fixture(),
      p = control(f).point,
      dx = axis === 'y' ? 5 : 10,
      dy = axis === 'y' ? 60 : 30;
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, dx, dy, { shiftKey: true }));
    const q = axis === 'y' ? { x: p.x, y: p.y + 20 } : { x: p.x + 10, y: p.y };
    expect(f.state.preview!.target).toEqual(q);
    expect(f.state.preview!.project).toEqual(expected(f, q));
    expect(f.state.target).toEqual({ x: -300, y: 800 });
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
it('rechecks actual enclosing source after a current numeric preview validator returns', () => {
  const f = fixture(),
    prior = f.prior();
  f.state.preview = prior;
  expect(f.drag.down(at(f))).toBe(true);
  (prior.validate as ReturnType<typeof vi.fn>).mockImplementation(() => {
    f.project.name = 'Current numeric validator source survives';
  });
  f.drag.changed();
  expect(f.state.preview).toBeNull();
  expect(f.captured.size).toBe(0);
  expect(f.project.name).toBe('Current numeric validator source survives');
  f.drag.dispose();
});
it('rejects asynchronous enclosing admission before capture and allows a synchronous retry', () => {
  const f = fixture();
  f.context.validate.mockImplementationOnce(async () => {});
  expect(f.drag.down(at(f))).toBe(false);
  expect(f.captured.size).toBe(0);
  expect(f.project).toEqual(f.before);
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 30));
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});
for (const action of ['down', 'move', 'up', 'released-down'] as const)
  it(`rejects swallowed ${action} native reentry inside detached proposal delivery`, () => {
    const f = fixture(),
      write = f.preview.getMockImplementation()!;
    let hit = false;
    f.preview.mockImplementation((value, live) => {
      write(value, live);
      if (value && !hit && live === (action !== 'released-down')) {
        hit = true;
        if (action === 'down' || action === 'released-down') expect(f.drag.down(at(f))).toBe(false);
        else expect(f.drag[action](at(f, 20, 30))).toBe(true);
      }
    });
    expect(f.drag.down(at(f))).toBe(true);
    if (action === 'released-down') f.drag.up(at(f, 20, 30));
    else {
      f.drag.move(at(f, 20, 30));
      f.flush();
    }
    expect(hit).toBe(true);
    expect(f.captured.size).toBe(0);
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    f.preview.mockImplementation(write);
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview).not.toBeNull();
    f.drag.dispose();
  });

for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const group of ['outer', 'second'])
      for (const index of [0, 1])
        for (const role of ['incoming', 'outgoing'] as const)
          it(`independent group draft ${mode}/${basis}/${group}/${index}/${role} preserves full shared poses`, () => {
            const f = fixture((p) => {
              const path = p.layers[0].liveMotionSpans![0].path;
              Object.assign(p, liveRotationFixture(mode, basis, true).p);
              p.layers[0].liveMotionSpans![0].path = path;
            });
            f.state.pick = { ...f.state.pick, groupId: group, waypointIndex: index, role };
            const original = control(f),
              q = { x: original.point.x + 20, y: original.point.y + 10 };
            expect(f.drag.down(at(f))).toBe(true);
            f.drag.move(at(f, 20, 30));
            f.flush();
            const scratch = f.state.preview!;
            expect(scratch.owner.groupShapeIds).toEqual(
              group === 'outer' ? ['a', 'b'] : ['c', 'd'],
            );
            expect(scratch.owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
            expect(scratch.owner.anchor).toEqual(original.anchor);
            expect(scratch.project).toEqual(expected(f, q));
            f.drag.up(at(f, 20, 30));
            const out = f.state.preview!;
            expect(out).not.toBe(scratch);
            expect(() => scratch.validate()).toThrow();
            expect(out.project).toEqual(expected(f, q));
            expect(compileMovieClockPlan(out.project)).toEqual(compileMovieClockPlan(f.before));
            const sample = (p: Project) =>
              createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]);
            const before = sample(f.before),
              after = sample(out.project);
            try {
              for (let frame = 0; frame <= 8; frame++) {
                const t = (frame / 8) * 3,
                  segment = Math.floor(t),
                  u = t - segment;
                const weight =
                  frame === 8 || segment !== (role === 'incoming' ? index : index + 1)
                    ? 0
                    : role === 'incoming'
                      ? 3 * (1 - u) * u * u
                      : 3 * (1 - u) * (1 - u) * u;
                const a = before.sample(frame),
                  b = after.sample(frame);
                expect(b.map((s) => s.id)).toEqual(a.map((s) => s.id));
                for (let j = 0; j < a.length; j++) {
                  expect(b[j].x - a[j].x).toBeCloseTo(20 * weight, 9);
                  expect(b[j].y - a[j].y).toBeCloseTo(10 * weight, 9);
                  expect({ ...b[j], x: a[j].x, y: a[j].y }).toEqual(a[j]);
                }
              }
            } finally {
              before.dispose();
              after.dispose();
            }
            expect(f.project).toEqual(f.before);
            expect(f.error).not.toHaveBeenCalled();
            expect(f.captured.size).toBe(0);
            expect(f.frames.size).toBe(0);
            f.drag.dispose();
          });

it('retained unrelated authoring and aligned preferences cannot publish group handles', () => {
  const f = fixture(),
    publish = vi.fn();
  Object.assign(f.state, {
    rootAuthoring: true,
    rootAuthoringPolicy: 99,
    rootAlignedAuthoring: true,
    rootAlignedAuthoringPolicy: 99,
    coupling: 'aligned',
    couplingRevision: 99,
    publish,
  });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 30));
  expect(f.state.preview!.project).toEqual(
    expected(f, { x: control(f).point.x + 20, y: control(f).point.y + 10 }),
  );
  expect(publish).not.toHaveBeenCalled();
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});

for (const phase of ['initial', 'movement', 'release'] as const)
  for (const mutation of ['source', 'target', 'library'] as const)
    it(`rejects ${phase} ${mutation} during actual detached cloning`, () => {
      const f = fixture(),
        a = at(f),
        b = at(f, 20, 30),
        clone = structuredClone;
      let hit = false,
        getterReads = 0;
      const install = () =>
        vi.stubGlobal('structuredClone', (value: unknown) => {
          const out = clone(value);
          if (!hit && (out as Project)?.layers?.[0]?.liveMotionSpans?.[0]) {
            hit = true;
            if (mutation === 'source') f.project.name = 'Source edit retained';
            if (mutation === 'target') {
              f.state.target.x++;
              f.state.revision++;
            }
            if (mutation === 'library')
              Object.defineProperty(out as Project, 'symbols', {
                enumerable: true,
                get() {
                  getterReads++;
                  throw Error('getter must not run');
                },
              });
          }
          return out;
        });
      if (phase === 'initial') install();
      const captured = f.drag.down(a);
      if (phase !== 'initial') {
        expect(captured).toBe(true);
        install();
        if (phase === 'movement') {
          f.drag.move(b);
          f.flush();
        } else f.drag.up(b);
      } else expect(captured).toBe(false);
      expect(hit).toBe(true);
      expect(getterReads).toBe(0);
      expect(f.state.preview).toBeNull();
      expect(f.captured.size).toBe(0);
      expect(f.frames.size).toBe(0);
      if (mutation === 'source') expect(f.project.name).toBe('Source edit retained');
      else {
        expect(f.project).toEqual(f.before);
        vi.stubGlobal('structuredClone', clone);
        expect(f.drag.down(at(f))).toBe(true);
        f.drag.up(at(f, 20, 30));
        expect(f.state.preview).not.toBeNull();
      }
      f.drag.dispose();
    });

for (const layer of ['track', 'later'])
  it(`edits only the selected ${layer} shared bank across tracks`, () => {
    const f = fixture((p) => secondRotationTrack(p));
    f.state.pick = { ...f.state.pick, layerId: layer };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(
      expected(f, { x: control(f).point.x + 20, y: control(f).point.y + 10 }),
    );
    expect(f.state.preview!.project.layers.find((l) => l.id !== layer)).toEqual(
      f.before.layers.find((l) => l.id !== layer),
    );
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const option of ['nodes', 'contours'])
  it(`does not widen rigid group ${option} admission`, () => {
    const f = fixture((p) => {
      p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
      if (option === 'contours') p.layers[0].liveMotionSpans![0].correspondence = { order: [0] };
    });
    expect(f.drag.down(at(f))).toBe(false);
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

for (const basis of ['plain', 'affine', 'reflected'])
  it(`keeps fixed compound rings and nested membership exact for ${basis} drafts`, () => {
    const f = fixture((p) => {
      const path = p.layers[0].liveMotionSpans![0].path;
      Object.assign(p, liveRotationFixture('rigid', basis, true).p);
      p.layers[0].liveMotionSpans![0].path = path;
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const a of key.shapes)
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: [
              [
                { x: 0, y: 0 },
                { x: 24, y: 0 },
                { x: 24, y: 20 },
                { x: 0, y: 20 },
              ],
              [
                { x: 3, y: 4 },
                { x: 8, y: 9 },
                { x: 13, y: 4 },
              ],
            ],
          });
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    const q = { x: control(f).point.x + 20, y: control(f).point.y + 10 };
    expect(f.state.preview!.project).toEqual(expected(f, q));
    expect(f.state.preview!.project.layers[0].keys).toEqual(f.before.layers[0].keys);
    expect(f.state.preview!.owner.groupShapeIds).toEqual(['a', 'b']);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['outer', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        for (const shift of [false, true])
          it(`release authoring ${basis}/${root}/${index}/${role}/Shift${shift} freshly prepares exact controls after cleanup`, () => {
            const candidates: Project[] = [];
            const publish = vi.fn(
              (
                pick: LiveGroupWaypointTangentDragState['pick'],
                target: Readonly<Point>,
                admit: () => void,
              ) => {
                expect(f.captured.size).toBe(0);
                expect(f.frames.size).toBe(0);
                expect(f.observers.every((o) => !o.connected)).toBe(true);
                admit();
                const scope = captureLiveGroupWaypointTangents(f.context.readSource);
                try {
                  const owner = scope.resolve(
                    pick.layerId,
                    pick.spanId,
                    pick.groupId,
                    pick.waypointIndex,
                    pick.role,
                  );
                  const candidate = prepareLiveGroupWaypointTangentPositions([{ owner, target }], {
                    validate: admit,
                  });
                  admit();
                  candidates.push(candidate);
                  f.source(candidate); // Successful replacement must not reassert the old source afterward.
                } finally {
                  scope.dispose();
                }
              },
            );
            const f = fixture(
              (p) => {
                const path = p.layers[0].liveMotionSpans![0].path;
                Object.assign(p, liveRotationFixture('rigid', basis, true).p);
                p.layers[0].liveMotionSpans![0].path = path;
              },
              4,
              publish,
            );
            Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
            f.state.pick = { ...f.state.pick, groupId: root, waypointIndex: index, role };
            const start = control(f).point;
            expect(f.drag.down(at(f))).toBe(true);
            f.drag.move(at(f, 20, 30, { shiftKey: shift }));
            f.flush();
            const scratch = f.state.preview!;
            f.drag.up(at(f, 20, 30, { shiftKey: shift }));
            expect(publish).toHaveBeenCalledTimes(1);
            expect(candidates).toEqual([
              expected(f, { x: start.x + 20, y: start.y + (shift ? 0 : 10) }),
            ]);
            expect(candidates[0]).not.toBe(scratch.project);
            expect(() => scratch.validate()).toThrow();
            expect(f.error).not.toHaveBeenCalled();
            f.drag.dispose();
          });
for (const phase of ['initial', 'active', 'publisher'] as const)
  for (const policy of ['gesture', 'authoring'] as const)
    it(`release authoring rejects restored ${policy} policy in ${phase} and permits a fresh retry`, () => {
      let hook = () => {},
        commits = 0;
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
      const captured = f.drag.down(at(f));
      if (phase === 'initial') expect(captured).toBe(false);
      else {
        expect(captured).toBe(true);
        f.drag.move(at(f, 20, 30));
        if (phase === 'active') change();
        else hook = change;
        f.drag.up(at(f, 20, 30));
      }
      expect(commits).toBe(0);
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      hook = () => {};
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 30));
      expect(commits).toBe(1);
      f.drag.dispose();
    });
for (const mutation of [
  'target',
  'role',
  'pick',
  'frame',
  'source',
  'view',
  'revision',
  'close',
  'author-policy',
  'group',
  'membership',
] as const)
  it(`release authoring rejects late ${mutation} after detached signed controls exist`, () => {
    let commits = 0,
      prepared: Project | undefined;
    const publish = vi.fn(
      (
        pick: LiveGroupWaypointTangentDragState['pick'],
        target: Readonly<Point>,
        admit: () => void,
      ) => {
        const scope = captureLiveGroupWaypointTangents(f.context.readSource);
        try {
          prepared = prepareLiveGroupWaypointTangentPositions(
            [
              {
                owner: scope.resolve(
                  pick.layerId,
                  pick.spanId,
                  pick.groupId,
                  pick.waypointIndex,
                  pick.role,
                ),
                target,
              },
            ],
            { validate: admit },
          );
        } finally {
          scope.dispose();
        }
        expect(prepared).toEqual(expected(f, target));
        if (mutation === 'target') f.state.target.x++;
        if (mutation === 'group') f.state.pick = { ...f.state.pick, groupId: 'second' };
        if (mutation === 'membership')
          f.project.layers[0].keys[0].shapes[0].groups!.push('new-user-group');
        if (mutation === 'role') f.state.pick = { ...f.state.pick, role: 'incoming' };
        if (mutation === 'pick') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
        if (mutation === 'frame') f.source(f.project, 5, 1);
        if (mutation === 'source') f.project.name = 'User source edit';
        if (mutation === 'view') f.rect.width++;
        if (mutation === 'revision') f.state.revision++;
        if (mutation === 'close') f.drag.dispose();
        if (mutation === 'author-policy') f.state.authoringPolicy! += 2;
        admit();
        commits++;
      },
    );
    const f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(prepared).toBeDefined();
    expect(commits).toBe(0);
    expect(f.captured.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    if (mutation === 'source') expect(f.project.name).toBe('User source edit');
    else if (mutation === 'membership')
      expect(f.project.layers[0].keys[0].shapes[0].groups).toEqual([
        'outer',
        'inner',
        'new-user-group',
      ]);
    else expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const mode of ['zero', 'return', 'cancel', 'loss', 'foreign', 'disabled'] as const)
  it(`release authoring never publishes ${mode} input`, () => {
    const publish = vi.fn(),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    if (mode === 'disabled') f.state.enabled = false;
    f.drag.down(at(f));
    if (mode === 'return') {
      f.drag.move(at(f, 20, 30));
      f.flush();
    }
    if (mode === 'cancel') f.drag.cancel();
    if (mode === 'loss') f.canvas.releasePointerCapture(1);
    f.drag.up(
      mode === 'foreign'
        ? at(f, 20, 30, { pointerId: 2 })
        : mode === 'disabled'
          ? at(f, 20, 30)
          : at(f),
    );
    expect(publish).not.toHaveBeenCalled();
    f.drag.dispose();
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
  it(`release authoring rejects ${mode} with no history fallback`, () => {
    const publish = mode === 'missing publisher' ? undefined : vi.fn(async () => {}),
      f = fixture(undefined, 4, publish),
      getter = vi.fn(() => 0);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    if (mode === 'missing pair') delete f.state.authoringPolicy;
    if (mode === 'invalid revision') f.state.authoringPolicy = NaN;
    if (mode === 'getter policy')
      Object.defineProperty(f.state, 'authoringPolicy', { enumerable: true, get: getter });
    const hit = f.drag.down(at(f));
    if (mode === 'async publisher') {
      expect(hit).toBe(true);
      f.drag.up(at(f, 20, 30));
      expect(publish).toHaveBeenCalledTimes(1);
    } else expect(hit).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

for (const mode of ['accessor', 'nonenumerable', 'nonfunction'] as const)
  it(`release publisher ${mode} rejects before invoking public data`, () => {
    const f = fixture(),
      getter = vi.fn(() => vi.fn()),
      options = {
        canvas: f.canvas as unknown as HTMLCanvasElement,
        state: () => f.state,
        view: () => f.view,
        foreground: () => true,
        preview: () => {},
        active: () => {},
        error: () => {},
        requestFrame: () => 1,
        cancelFrame: () => {},
      };
    if (mode === 'accessor')
      Object.defineProperty(options, 'publish', { enumerable: true, get: getter });
    else
      Object.defineProperty(options, 'publish', {
        enumerable: mode !== 'nonenumerable',
        value: mode === 'nonfunction' ? 42 : vi.fn(),
      });
    expect(() => createLiveGroupWaypointTangentDrag(options)).toThrow(/publisher/);
    expect(getter).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    f.drag.dispose();
  });

for (const action of ['author-policy', 'zero', 'return', 'cancel'] as const)
  it(`release authoring ${action} preserves an independent numeric prior without publishing`, () => {
    const publish = vi.fn(),
      f = fixture(undefined, 4, publish),
      prior = f.prior();
    Object.assign(f.state, { authoring: true, authoringPolicy: 0, preview: prior });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 30));
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    if (action === 'author-policy') {
      f.state.authoring = false;
      f.state.authoringPolicy!++;
      f.drag.changed();
    }
    if (action === 'zero' || action === 'return') f.drag.move(at(f));
    if (action === 'return') f.drag.up(at(f));
    else f.drag.cancel();
    expect(f.state.preview).toBe(prior);
    expect(prior.validate).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

for (const method of ['down', 'move', 'up'] as const)
  it(`release original publisher swallowed ${method} reentry rejects before any document commit`, () => {
    let commits = 0;
    const publish = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => {
      try {
        f.drag[method](at(f, 20, 30));
      } catch {}
      admit();
      commits++;
    });
    const f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(commits).toBe(0);
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const mode of ['omitted', 'explicit-false'] as const)
  it(`group release ${mode} policy keeps original draft-only behavior with an available publisher`, () => {
    const publish = vi.fn(),
      f = fixture(undefined, 4, publish);
    if (mode === 'explicit-false') Object.assign(f.state, { authoring: false, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(
      expected(f, { x: control(f).point.x + 20, y: control(f).point.y + 10 }),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

it('group release captures the original publisher before later option replacement', () => {
  const original = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => admit()),
    foreign = vi.fn(),
    f = fixture(undefined, 4, original);
  f.options.publish = foreign;
  Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 30));
  expect(original).toHaveBeenCalledTimes(1);
  expect(foreign).not.toHaveBeenCalled();
  expect(f.error).not.toHaveBeenCalled();
  f.drag.dispose();
});

it('inherited group publisher getters do not confer original publication ownership', () => {
  const f = fixture(),
    getter = vi.fn(() => vi.fn());
  f.drag.dispose();
  delete f.options.publish;
  Object.setPrototypeOf(
    f.options,
    Object.defineProperty({}, 'publish', { enumerable: true, get: getter }),
  );
  const drag = createLiveGroupWaypointTangentDrag(f.options);
  Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
  expect(drag.down(at(f))).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.captured.size).toBe(0);
  drag.dispose();
});

for (const field of ['authoring', 'authoringPolicy'])
  for (const mode of ['accessor', 'nonenumerable'])
    it(`original ${field} ${mode} rejects before source/layout or getter reads`, () => {
      const f = fixture(undefined, 4, vi.fn()),
        get = vi.fn(() => 0);
      Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
      Object.defineProperty(
        f.state,
        field,
        mode === 'accessor'
          ? { enumerable: true, get }
          : { enumerable: false, value: field === 'authoring' ? true : 0 },
      );
      expect(f.drag.down(at(f))).toBe(false);
      expect(get).not.toHaveBeenCalled();
      expect(f.context.readSource).not.toHaveBeenCalled();
      expect(f.canvas.getBoundingClientRect).not.toHaveBeenCalled();
      expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });

for (const method of ['move', 'up'] as const)
  it(`foreign pointer ${method} during synchronous group publication does not own or poison release`, () => {
    let commits = 0;
    const publish = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => {
        expect(f.drag[method](at(f, 20, 30, { pointerId: 2 }))).toBe(false);
        admit();
        commits++;
      }),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(commits).toBe(1);
    expect(f.error).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

function releaseCandidate(
  f: Fixture,
  pick: LiveGroupWaypointTangentDragState['pick'],
  target: Readonly<Point>,
  admit: () => void,
) {
  expect(f.captured.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  const scope = captureLiveGroupWaypointTangents(f.context.readSource);
  try {
    const owner = scope.resolve(
        pick.layerId,
        pick.spanId,
        pick.groupId,
        pick.waypointIndex,
        pick.role,
      ),
      candidate = prepareLiveGroupWaypointTangentPositions([{ owner, target }], {
        validate: admit,
      });
    expect(candidate).toEqual(expected(f, target));
    expect(compileMovieClockPlan(candidate)).toEqual(compileMovieClockPlan(f.before));
    admit();
    return candidate;
  } finally {
    scope.dispose();
  }
}
for (const mode of ['uniform', 'axes', 'shear', 'both'])
  for (const group of ['outer', 'second'])
    it(`dedicated release retains ${mode}/${group} affine/reflected group settings`, () => {
      let committed: Project | undefined;
      const publish = vi.fn(
          (
            pick: LiveGroupWaypointTangentDragState['pick'],
            target: Readonly<Point>,
            admit: () => void,
          ) => {
            committed = releaseCandidate(f, pick, target, admit);
            f.source(committed);
          },
        ),
        f = fixture(
          (p) => {
            const path = p.layers[0].liveMotionSpans![0].path;
            Object.assign(
              p,
              liveRotationFixture(mode, group === 'outer' ? 'affine' : 'reflected', true).p,
            );
            p.layers[0].liveMotionSpans![0].path = path;
          },
          4,
          publish,
        );
      f.state.pick = { ...f.state.pick, groupId: group };
      Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 30));
      expect(committed).toBeDefined();
      expect(f.error).not.toHaveBeenCalled();
      expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });
for (const layer of ['track', 'later'])
  it(`dedicated ${layer} release preserves every other track atomically`, () => {
    let committed: Project | undefined;
    const publish = vi.fn(
        (
          pick: LiveGroupWaypointTangentDragState['pick'],
          target: Readonly<Point>,
          admit: () => void,
        ) => {
          committed = releaseCandidate(f, pick, target, admit);
          f.source(committed);
        },
      ),
      f = fixture((p) => secondRotationTrack(p), 4, publish);
    f.state.pick = { ...f.state.pick, layerId: layer };
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(committed!.layers.find((l) => l.id !== layer)).toEqual(
      f.before.layers.find((l) => l.id !== layer),
    );
    expect(f.error).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const basis of ['plain', 'affine', 'reflected'])
  it(`dedicated release preserves fixed compound rings and nested membership for ${basis}`, () => {
    let committed: Project | undefined;
    const publish = vi.fn(
        (
          pick: LiveGroupWaypointTangentDragState['pick'],
          target: Readonly<Point>,
          admit: () => void,
        ) => {
          committed = releaseCandidate(f, pick, target, admit);
          f.source(committed);
        },
      ),
      f = fixture(
        (p) => {
          const path = p.layers[0].liveMotionSpans![0].path;
          Object.assign(p, liveRotationFixture('rigid', basis, true).p);
          p.layers[0].liveMotionSpans![0].path = path;
          for (const key of p.layers[0].keys.slice(0, 2))
            for (const a of key.shapes)
              Object.assign(a, {
                kind: 'polygon',
                fillRule: 'evenodd',
                points: [],
                contours: [
                  [
                    { x: 0, y: 0 },
                    { x: 24, y: 0 },
                    { x: 24, y: 20 },
                    { x: 0, y: 20 },
                  ],
                  [
                    { x: 3, y: 4 },
                    { x: 8, y: 9 },
                    { x: 13, y: 4 },
                  ],
                ],
              });
        },
        4,
        publish,
      );
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(committed!.layers[0].keys).toEqual(f.before.layers[0].keys);
    expect(f.error).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const phase of ['initial', 'active', 'publisher'] as const)
  it(`source-valid ${phase} author-policy rejection permits opted-out drafts then restored authoring`, () => {
    let attack = phase === 'publisher',
      commits = 0;
    const publish = vi.fn((_pick: unknown, _target: unknown, admit: () => void) => {
        if (attack) {
          f.state.authoringPolicy! += 2;
          f.drag.changed();
        }
        admit();
        commits++;
      }),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
    if (phase === 'initial')
      f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
        f.state.authoringPolicy! += 2;
        return f.rect;
      });
    const down = f.drag.down(at(f));
    if (phase === 'initial') expect(down).toBe(false);
    else {
      expect(down).toBe(true);
      if (phase === 'active') {
        f.state.authoringPolicy! += 2;
        f.drag.changed();
      }
      f.drag.up(at(f, 20, 30));
    }
    expect(commits).toBe(0);
    expect(f.captured.size).toBe(0);
    attack = false;
    f.state.authoring = false;
    f.state.authoringPolicy!++;
    f.drag.changed();
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(
      expected(f, { x: control(f).point.x + 20, y: control(f).point.y + 10 }),
    );
    expect(commits).toBe(0);
    expect(f.project).toEqual(f.before);
    f.state.authoring = true;
    f.state.authoringPolicy!++;
    f.drag.changed();
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(commits).toBe(1);
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

function alignedGroupExpected(
  f: Fixture,
  value: LiveGroupWaypointTangentDraft,
  target: Readonly<Point>,
) {
  const wanted = expected(f, target),
    pick = f.state.pick;
  const old = f.before.layers
    .find((l) => l.id === pick.layerId)!
    .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!;
  const path = wanted.layers
    .find((l) => l.id === pick.layerId)!
    .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!;
  const actual = value.project.layers
    .find((l) => l.id === pick.layerId)!
    .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!;
  const opposite =
    pick.role === 'incoming'
      ? old.waypointTangents![pick.waypointIndex + 1]
      : old.waypointIncoming![pick.waypointIndex];
  const got =
    pick.role === 'incoming'
      ? actual.waypointTangents![pick.waypointIndex + 1]
      : actual.waypointIncoming![pick.waypointIndex];
  const anchor = control(f).anchor,
    dx = target.x - anchor.x,
    dy = target.y - anchor.y,
    r = Math.hypot(opposite.x, opposite.y);
  expect(got.x).toBeCloseTo((-dx / Math.hypot(dx, dy)) * r, 10);
  expect(got.y).toBeCloseTo((-dy / Math.hypot(dx, dy)) * r, 10);
  expect(Math.hypot(got.x, got.y)).toBeCloseTo(r, 10);
  Object.assign(
    pick.role === 'incoming'
      ? path.waypointTangents![pick.waypointIndex + 1]
      : path.waypointIncoming![pick.waypointIndex],
    got,
  );
  expect(value.project).toEqual(wanted);
  expect(value.target).toEqual(target);
  expect(value.opposite).toEqual({ x: anchor.x + got.x, y: anchor.y + got.y });
  expect(Object.isFrozen(value.opposite)).toBe(true);
  expect(compileMovieClockPlan(value.project)).toEqual(compileMovieClockPlan(f.before));
  value.validate();
  return wanted;
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const group of ['outer', 'second'])
      for (const slot of [0, 1])
        for (const role of ['incoming', 'outgoing'] as const)
          it(`private aligned group draft ${mode}/${basis}/${group}/${slot}/${role} preserves radius and every original root pose`, () => {
            const publish = vi.fn(),
              f = fixture(
                (p) => {
                  const replacement = liveRotationFixture(mode, basis, true).p;
                  replacement.layers[0].liveMotionSpans![0].path =
                    p.layers[0].liveMotionSpans![0].path;
                  Object.assign(p, replacement);
                },
                4,
                publish,
              );
            Object.assign(f.state, {
              coupling: 'aligned',
              couplingRevision: 0,
              authoring: true,
              authoringPolicy: 0,
            });
            f.state.pick = { ...f.state.pick, groupId: group, waypointIndex: slot, role };
            const start = control(f).point,
              q = { x: start.x + 20, y: start.y + 20 };
            expect(f.drag.down(at(f))).toBe(true);
            f.drag.move(at(f, 20, 60));
            f.flush();
            const scratch = f.state.preview!;
            alignedGroupExpected(f, scratch, q);
            f.drag.up(at(f, 20, 60));
            const value = f.state.preview!;
            const wanted = alignedGroupExpected(f, value, q);
            expect(value).not.toBe(scratch);
            expect(value.project).not.toBe(scratch.project);
            expect(() => scratch.validate()).toThrow();
            expect(publish).not.toHaveBeenCalled();
            const before = f.before.layers[0].liveMotionSpans![0],
              after = wanted.layers[0].liveMotionSpans![0];
            const a = createMotionFrameSampler(f.before, 'track', before),
              b = createMotionFrameSampler(wanted, 'track', after);
            const oldIn = before.path!.waypointIncoming![slot],
              newIn = after.path!.waypointIncoming![slot];
            const oldOut = before.path!.waypointTangents![slot + 1],
              newOut = after.path!.waypointTangents![slot + 1];
            for (let frame = 0; frame <= 8; frame++) {
              const t = (frame / 8) * 3,
                segment = Math.min(2, Math.floor(t)),
                u = t - segment;
              const incoming = segment === slot ? 3 * (1 - u) * u * u : 0,
                outgoing = segment === slot + 1 ? 3 * (1 - u) * (1 - u) * u : 0;
              const dx = incoming * (newIn.x - oldIn.x) + outgoing * (newOut.x - oldOut.x),
                dy = incoming * (newIn.y - oldIn.y) + outgoing * (newOut.y - oldOut.y);
              const old = a.sample(frame),
                next = b.sample(frame);
              expect(next.map((s) => s.id)).toEqual(old.map((s) => s.id));
              for (let i = 0; i < old.length; i++) {
                expect(next[i].x - old[i].x).toBeCloseTo(dx, 9);
                expect(next[i].y - old[i].y).toBeCloseTo(dy, 9);
              }
            }
            a.dispose();
            b.dispose();
            expect(f.project).toEqual(f.before);
            expect(f.captured.size).toBe(0);
            expect(f.frames.size).toBe(0);
            expect(f.observers.every((o) => !o.connected)).toBe(true);
            expect(f.error).not.toHaveBeenCalled();
            f.drag.dispose();
          });
for (const shift of [false, true])
  it(`private aligned group draft coalesces1000 CSS movements Shift${shift} without source transport`, () => {
    const f = fixture();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    const reads = f.context.readSource.mock.calls.length,
      checks = f.context.validate.mock.calls.length,
      clone = vi.spyOn(globalThis, 'structuredClone');
    for (let i = 1; i <= 1000; i++) f.drag.move(at(f, i / 50, i * 0.03, { shiftKey: shift }));
    expect(f.context.readSource).toHaveBeenCalledTimes(reads);
    expect(f.context.validate).toHaveBeenCalledTimes(checks);
    expect(clone).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(1);
    f.flush();
    const start = control(f).point;
    alignedGroupExpected(f, f.state.preview!, { x: start.x + 20, y: start.y + (shift ? 0 : 10) });
    f.drag.up(at(f, 20, 30, { shiftKey: shift }));
    alignedGroupExpected(f, f.state.preview!, { x: start.x + 20, y: start.y + (shift ? 0 : 10) });
    f.drag.dispose();
  });
for (const phase of ['initial', 'active', 'delivery', 'release', 'retained'])
  for (const restored of [false, true])
    it(`private aligned group coupling ${phase}/restored${restored} rejects stale work and recovers`, () => {
      const f = fixture();
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      const change = () => {
        f.state.coupling = 'independent';
        f.state.couplingRevision!++;
        if (restored) {
          f.state.coupling = 'aligned';
          f.state.couplingRevision!++;
        }
        f.drag.changed();
      };
      if (phase === 'initial')
        f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
          change();
          return f.rect;
        });
      if (phase === 'delivery') {
        const original = f.preview.getMockImplementation()!;
        f.preview.mockImplementationOnce((value, live) => {
          original(value, live);
          change();
        });
      }
      const hit = f.drag.down(at(f));
      if (phase === 'initial') expect(hit).toBe(false);
      else {
        expect(hit).toBe(true);
        f.drag.move(at(f, 20, 30));
        if (phase === 'active') change();
        if (phase === 'delivery') f.flush();
        if (phase === 'release')
          f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
            change();
            return f.rect;
          });
        f.drag.up(at(f, 20, 30));
        if (phase === 'retained') change();
      }
      expect(f.state.preview).toBeNull();
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      Object.assign(f.state, {
        coupling: 'aligned',
        couplingRevision: f.state.couplingRevision! + 1,
      });
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 30));
      alignedGroupExpected(f, f.state.preview!, {
        x: control(f).point.x + 20,
        y: control(f).point.y + 10,
      });
      f.drag.dispose();
    });
for (const mode of [
  'missing revision',
  'missing mode',
  'unknown',
  'negative',
  'NaN',
  'getter mode',
  'getter revision',
])
  it(`private aligned group rejects ${mode} coupling before source reads`, () => {
    const f = fixture(),
      getter = vi.fn(() => 0);
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    if (mode === 'missing revision') delete f.state.couplingRevision;
    if (mode === 'missing mode') delete f.state.coupling;
    if (mode === 'unknown') Object.assign(f.state, { coupling: 'mirrored' });
    if (mode === 'negative') f.state.couplingRevision = -1;
    if (mode === 'NaN') f.state.couplingRevision = NaN;
    if (mode.startsWith('getter'))
      Object.defineProperty(f.state, mode === 'getter mode' ? 'coupling' : 'couplingRevision', {
        enumerable: true,
        get: getter,
      });
    expect(f.drag.down(at(f))).toBe(false);
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const mode of ['none', 'retained true', 'forged paired preference'])
  it(`private aligned group ${mode} cannot inherit independent release publication`, () => {
    const publish = mode === 'none' ? undefined : vi.fn(),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, {
      coupling: 'aligned',
      couplingRevision: 0,
      authoring: true,
      authoringPolicy: 77,
      ...(mode === 'forged paired preference'
        ? { pairedAuthoring: true, pairedAuthoringPolicy: 99 }
        : {}),
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    alignedGroupExpected(f, f.state.preview!, {
      x: control(f).point.x + 20,
      y: control(f).point.y + 10,
    });
    if (publish) expect(publish).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['Escape', 'loss', 'view', 'policy', 'zero', 'return', 'coupling'])
  it(`private aligned group ${mode} restores only valid independent numeric priors`, () => {
    const f = fixture(),
      prior = f.prior();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0, preview: prior });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 30));
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    if (mode === 'Escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    if (mode === 'loss') f.canvas.releasePointerCapture(1);
    if (mode === 'view') {
      f.rect.width++;
      f.drag.changed();
    }
    if (mode === 'policy') {
      f.state.policy += 2;
      f.drag.changed();
    }
    if (mode === 'coupling') {
      f.state.couplingRevision! += 2;
      f.drag.changed();
    }
    if (mode === 'zero' || mode === 'return') {
      f.drag.move(at(f));
      if (mode === 'zero') f.drag.cancel();
      else f.drag.up(at(f));
    }
    expect(f.state.preview).toBe(mode === 'coupling' ? null : prior);
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });

for (const phase of ['movement', 'release'])
  for (const action of [
    'source',
    'library',
    'target',
    'coupling',
    'group',
    'frame',
    'owned reentry',
    'newer preview',
  ])
    it(`private aligned group ${phase} rejects actual late ${action} after both detached controls exist`, () => {
      const f = fixture(),
        native = structuredClone,
        newer = f.prior();
      let hits = 0;
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      expect(f.drag.down(at(f))).toBe(true);
      vi.stubGlobal('structuredClone', (v: unknown) => {
        const out = native(v),
          path = (out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path;
        if (
          !hits &&
          path?.waypointTangents?.[1]?.x === 30 &&
          path?.waypointIncoming?.[0]?.x !== -20
        ) {
          hits++;
          expect(f.captured.size).toBe(phase === 'release' ? 0 : 1);
          if (action === 'source') f.project.name = 'Preserved actual source edit';
          if (action === 'library') f.project.symbols![0].name = 'Preserved library edit';
          if (action === 'target') f.state.target = { x: 44, y: 55 };
          if (action === 'coupling') f.state.couplingRevision! += 2;
          if (action === 'group') f.state.pick = { ...f.state.pick, groupId: 'second' };
          if (action === 'frame') f.source(f.project, 5, 1);
          if (action === 'owned reentry') expect(f.drag.down(at(f))).toBe(false);
          if (action === 'newer preview') f.state.preview = newer;
        }
        return out;
      });
      if (phase === 'movement') {
        f.drag.move(at(f, 20, 60));
        f.flush();
      } else f.drag.up(at(f, 20, 60));
      expect(hits).toBe(1);
      expect(f.state.preview).toBe(action === 'newer preview' ? newer : null);
      expect(f.captured.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.observers.every((o) => !o.connected)).toBe(true);
      const preserved = native(f.before);
      if (action === 'source') preserved.name = 'Preserved actual source edit';
      if (action === 'library') preserved.symbols![0].name = 'Preserved library edit';
      expect(f.project).toEqual(preserved);
      f.drag.dispose();
    });
for (const axis of ['x', 'y'])
  for (const bad of [NaN, Infinity, -Infinity])
    it(`private aligned group ${axis}/${bad} pointer rejects without authoring`, () => {
      const f = fixture(),
        publish = vi.fn();
      f.options.publish = publish;
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 60, { [axis === 'x' ? 'clientX' : 'clientY']: bad }));
      expect(f.state.preview).toBeNull();
      expect(f.project).toEqual(f.before);
      expect(f.captured.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
      f.drag.dispose();
    });
for (const action of ['raw NaN', 'opposite metadata', 'clock', 'prototype', 'getter'])
  it(`private aligned group rejects retained ${action} candidate mutation`, () => {
    const f = fixture();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    const value = f.state.preview!;
    const path = value.project.layers[0].liveMotionSpans![0].path!;
    if (action === 'raw NaN') path.waypointIncoming![0].x = NaN;
    if (action === 'opposite metadata') Object.assign(path.waypointIncoming![0], { pressure: 0.5 });
    if (action === 'clock') value.project.symbols![0].name = 'Mutated candidate library';
    if (action === 'prototype') Object.setPrototypeOf(value.project.layers[0], { foreign: true });
    const getter = vi.fn(() => 30);
    if (action === 'getter')
      Object.defineProperty(path.waypointTangents![1], 'x', { get: getter, enumerable: true });
    expect(() => value.validate()).toThrow();
    expect(getter).not.toHaveBeenCalled();
    f.drag.changed();
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

it('private aligned group retains an original zero opposite radius and signed components', () => {
  const f = fixture((p) => {
    Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointIncoming![0], { x: 0, y: -0 });
  });
  Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  const value = f.state.preview!,
    opposite = value.project.layers[0].liveMotionSpans![0].path!.waypointIncoming![0];
  expect(Object.is(opposite.x, 0)).toBe(true);
  expect(Object.is(opposite.y, -0)).toBe(true);
  alignedGroupExpected(f, value, { x: control(f).point.x + 20, y: control(f).point.y + 20 });
  f.drag.dispose();
});
for (const phase of ['movement', 'release'])
  it(`private aligned group ${phase} zero selected direction rejects then permits a fresh original retry`, () => {
    const f = fixture();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    f.state.pick = { ...f.state.pick, role: 'incoming' };
    expect(f.drag.down(at(f))).toBe(true);
    if (phase === 'movement') {
      f.drag.move(at(f, 20, 30));
      f.flush();
    } else f.drag.up(at(f, 20, 30));
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    alignedGroupExpected(f, f.state.preview!, {
      x: control(f).point.x + 20,
      y: control(f).point.y + 20,
    });
    f.drag.dispose();
  });

for (const phase of ['movement', 'release'])
  for (const event of ['owned move', 'owned up', 'foreign move'])
    it(`private aligned group ${phase} post-control ${event} honors pointer ownership`, () => {
      const f = fixture(),
        native = structuredClone;
      let hits = 0;
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      expect(f.drag.down(at(f))).toBe(true);
      vi.stubGlobal('structuredClone', (v: unknown) => {
        const out = native(v),
          path = (out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path;
        if (
          !hits &&
          path?.waypointTangents?.[1]?.x === 30 &&
          path?.waypointIncoming?.[0]?.x !== -20
        ) {
          hits++;
          expect(f.captured.size).toBe(phase === 'release' ? 0 : 1);
          if (event === 'owned up') expect(f.drag.up(at(f, 40, 90))).toBe(true);
          else
            expect(
              f.drag.move(at(f, 40, 90, event === 'foreign move' ? { pointerId: 99 } : {})),
            ).toBe(event !== 'foreign move');
        }
        return out;
      });
      if (phase === 'movement') {
        f.drag.move(at(f, 20, 60));
        f.flush();
      } else f.drag.up(at(f, 20, 60));
      expect(hits).toBe(1);
      if (event === 'foreign move') {
        if (phase === 'movement') f.drag.up(at(f, 20, 60));
        alignedGroupExpected(f, f.state.preview!, {
          x: control(f).point.x + 20,
          y: control(f).point.y + 20,
        });
      } else expect(f.state.preview).toBeNull();
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });

function alignedRelease(setup?: (p: Project) => void) {
  let hook: ((candidate: Project) => void) | undefined;
  const commits: Project[] = [],
    independent = vi.fn(),
    publisher = vi.fn(
      (
        pick: LiveGroupWaypointTangentDragState['pick'],
        target: Readonly<Point>,
        admit: () => void,
      ) => {
        expect(f.captured.size).toBe(0);
        expect(f.frames.size).toBe(0);
        expect(f.observers.every((o) => !o.connected)).toBe(true);
        admit();
        const scope = captureLiveGroupWaypointTangents(f.context.readSource);
        try {
          const owner = scope.resolve(
              pick.layerId,
              pick.spanId,
              pick.groupId,
              pick.waypointIndex,
              pick.role,
            ),
            opposite = scope.resolve(
              pick.layerId,
              pick.spanId,
              pick.groupId,
              pick.waypointIndex,
              pick.role === 'incoming' ? 'outgoing' : 'incoming',
            ),
            candidate = prepareLiveGroupWaypointTangentPairs([{ owner, target }], {
              coupling: 'aligned',
              validate: admit,
            }),
            path = candidate.layers
              .find((l) => l.id === pick.layerId)!
              .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!,
            v =
              pick.role === 'incoming'
                ? path.waypointTangents![pick.waypointIndex + 1]
                : path.waypointIncoming![pick.waypointIndex];
          alignedGroupExpected(
            f,
            {
              project: candidate,
              owner,
              target,
              opposite: Object.freeze({ x: opposite.anchor.x + v.x, y: opposite.anchor.y + v.y }),
              validate: () => {},
            },
            target,
          );
          hook?.(candidate);
          admit();
          commits.push(candidate);
          f.source(candidate);
        } finally {
          scope.dispose();
        }
      },
    );
  const f: Fixture = fixture(setup, 4, independent, publisher);
  Object.assign(f.state, {
    coupling: 'aligned',
    couplingRevision: 0,
    alignedAuthoring: true,
    alignedAuthoringPolicy: 0,
  });
  return Object.assign(f, {
    commits,
    independent,
    publisher,
    hook: (run?: typeof hook) => {
      hook = run;
    },
  });
}
for (const layer of ['track', 'later'])
  it(`aligned group release ${layer} preserves every other original track`, () => {
    const f = alignedRelease((p) => secondRotationTrack(p));
    f.state.pick = {
      ...f.state.pick,
      layerId: layer,
      groupId: 'second',
      waypointIndex: 1,
      role: 'incoming',
    };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].layers.find((l) => l.id !== layer)).toEqual(
      f.before.layers.find((l) => l.id !== layer),
    );
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const basis of ['plain', 'affine', 'reflected'])
  it(`aligned group release fixed compound ${basis} preserves rings and nested membership`, () => {
    const f = alignedRelease((p) => {
      const path = p.layers[0].liveMotionSpans![0].path;
      Object.assign(p, liveRotationFixture('rigid', basis, true).p);
      p.layers[0].liveMotionSpans![0].path = path;
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const a of key.shapes)
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: [
              [
                { x: 0, y: 0 },
                { x: 24, y: 0 },
                { x: 24, y: 20 },
                { x: 0, y: 20 },
              ],
              [
                { x: 3, y: 4 },
                { x: 8, y: 9 },
                { x: 13, y: 4 },
              ],
            ],
          });
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].layers[0].keys).toEqual(f.before.layers[0].keys);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const root of ['outer', 'second'])
      for (const index of [0, 1])
        for (const role of ['incoming', 'outgoing'] as const)
          it(`aligned group release ${mode}/${basis}/${root}/${index}/${role} freshly prepares both original controls after cleanup`, () => {
            const f = alignedRelease((p) => {
              const replacement = liveRotationFixture(mode, basis, true).p;
              replacement.layers[0].liveMotionSpans![0].path = p.layers[0].liveMotionSpans![0].path;
              Object.assign(p, replacement);
            });
            f.state.pick = { ...f.state.pick, groupId: root, waypointIndex: index, role };
            expect(f.drag.down(at(f))).toBe(true);
            f.drag.move(at(f, 20, 60));
            f.flush();
            const scratch = f.state.preview!;
            alignedGroupExpected(f, scratch, {
              x: control(f).point.x + 20,
              y: control(f).point.y + 20,
            });
            f.drag.up(at(f, 20, 60));
            expect(f.publisher).toHaveBeenCalledTimes(1);
            expect(f.independent).not.toHaveBeenCalled();
            expect(f.commits).toHaveLength(1);
            expect(f.commits[0]).toEqual(scratch.project);
            expect(f.commits[0]).not.toBe(scratch.project);
            expect(() => scratch.validate()).toThrow();
            expect(f.project).toEqual(f.before);
            expect(f.captured.size).toBe(0);
            f.drag.dispose();
          });
for (const shift of [false, true])
  it(`aligned group release CSS/Shift${shift} keeps original offsets with no intermediate task delivery`, () => {
    const f = alignedRelease(),
      p = control(f).point;
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 60, { shiftKey: shift }));
    expect(f.frames.size).toBe(1);
    f.drag.up(at(f, 20, 60, { shiftKey: shift }));
    expect(f.commits).toHaveLength(1);
    expect(f.publisher.mock.calls[0][1]).toEqual({ x: p.x + 20, y: p.y + (shift ? 0 : 20) });
    expect(f.frames.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['absent', 'false', 'independent only', 'extra preference'] as const)
  it(`aligned group release ${mode} keeps default draft-only release despite captured publishers`, () => {
    const f = alignedRelease();
    delete f.state.alignedAuthoring;
    delete f.state.alignedAuthoringPolicy;
    if (mode === 'false')
      Object.assign(f.state, { alignedAuthoring: false, alignedAuthoringPolicy: 42 });
    if (mode === 'independent only')
      Object.assign(f.state, { authoring: true, authoringPolicy: 12 });
    if (mode === 'extra preference')
      Object.assign(f.state, { pairedAuthoring: true, pairedAuthoringPolicy: 5 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.publisher).not.toHaveBeenCalled();
    expect(f.independent).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(0);
    expect(f.state.preview).not.toBeNull();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const mode of [
  'missing flag',
  'missing revision',
  'NaN',
  'negative',
  'fractional',
  'wrong flag',
  'getter flag',
  'getter revision',
] as const)
  it(`aligned group release malformed ${mode} rejects before source reads`, () => {
    const f = alignedRelease(),
      get = vi.fn(() => 0);
    if (mode === 'missing flag') delete f.state.alignedAuthoring;
    if (mode === 'missing revision') delete f.state.alignedAuthoringPolicy;
    if (mode === 'NaN') f.state.alignedAuthoringPolicy = NaN;
    if (mode === 'negative') f.state.alignedAuthoringPolicy = -1;
    if (mode === 'fractional') f.state.alignedAuthoringPolicy = 0.5;
    if (mode === 'wrong flag') Object.assign(f.state, { alignedAuthoring: 1 });
    if (mode.startsWith('getter'))
      Object.defineProperty(
        f.state,
        mode === 'getter flag' ? 'alignedAuthoring' : 'alignedAuthoringPolicy',
        { get, enumerable: true },
      );
    expect(f.drag.down(at(f))).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
    expect(f.publisher).not.toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const kind of ['getter', 'nonenumerable', 'wrong type'] as const)
  it(`aligned group release publisher ${kind} rejects without invoking accessor or source`, () => {
    const f = alignedRelease(),
      get = vi.fn(() => f.publisher);
    f.drag.dispose();
    f.context.readSource.mockClear();
    Object.defineProperty(
      f.options,
      'publishAligned',
      kind === 'getter'
        ? { get, enumerable: true }
        : { value: kind === 'wrong type' ? {} : f.publisher, enumerable: kind === 'wrong type' },
    );
    expect(() => createLiveGroupWaypointTangentDrag(f.options)).toThrow(/publisher/);
    expect(get).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
  });
it('aligned group release requires its own publisher rather than the independent callback', () => {
  const independent = vi.fn(),
    f = fixture(undefined, 4, independent);
  Object.assign(f.state, {
    coupling: 'aligned',
    couplingRevision: 0,
    authoring: true,
    authoringPolicy: 0,
    alignedAuthoring: true,
    alignedAuthoringPolicy: 0,
  });
  expect(f.drag.down(at(f))).toBe(false);
  expect(independent).not.toHaveBeenCalled();
  expect(f.context.readSource).not.toHaveBeenCalled();
  f.drag.dispose();
});
it('aligned group release preference cannot authorize an independent gesture', () => {
  const f = alignedRelease();
  Object.assign(f.state, { coupling: 'independent', couplingRevision: 1 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  expect(f.publisher).not.toHaveBeenCalled();
  expect(f.independent).not.toHaveBeenCalled();
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});
it('aligned group release captures its original publisher before later options replacement', () => {
  const f = alignedRelease(),
    replacement = vi.fn();
  expect(f.drag.down(at(f))).toBe(true);
  f.options.publishAligned = replacement;
  f.drag.up(at(f, 20, 60));
  expect(f.publisher).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
  expect(f.commits).toHaveLength(1);
  f.drag.dispose();
});
for (const phase of ['initial', 'active', 'publisher'] as const)
  for (const mode of ['author', 'coupling', 'gesture'] as const)
    it(`aligned group release restored ${mode}/${phase} rejects stale work and permits fresh opted-out drafts`, () => {
      const f = alignedRelease(),
        change = () => {
          if (mode === 'author') {
            f.state.alignedAuthoring = false;
            f.state.alignedAuthoringPolicy!++;
            f.state.alignedAuthoring = true;
            f.state.alignedAuthoringPolicy!++;
          }
          if (mode === 'coupling') {
            f.state.coupling = 'independent';
            f.state.couplingRevision!++;
            f.state.coupling = 'aligned';
            f.state.couplingRevision!++;
          }
          if (mode === 'gesture') {
            f.state.enabled = false;
            f.state.policy++;
            f.state.enabled = true;
            f.state.policy++;
          }
        };
      if (phase === 'initial') f.context.validate.mockImplementationOnce(change);
      const captured = f.drag.down(at(f));
      if (phase === 'initial') expect(captured).toBe(false);
      else {
        expect(captured).toBe(true);
        f.drag.move(at(f, 20, 60));
        if (phase === 'active') change();
        else f.hook(change);
        f.drag.up(at(f, 20, 60));
      }
      expect(f.commits).toHaveLength(0);
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      f.hook();
      f.state.alignedAuthoring = false;
      f.state.alignedAuthoringPolicy!++;
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 60));
      expect(f.state.preview).not.toBeNull();
      expect(f.commits).toHaveLength(0);
      f.state.alignedAuthoring = true;
      f.state.alignedAuthoringPolicy!++;
      f.drag.changed();
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 60));
      expect(f.commits).toHaveLength(1);
      f.drag.dispose();
    });
for (const action of [
  'target',
  'role',
  'index',
  'root',
  'source',
  'library',
  'membership',
  'frame',
  'view',
  'revision',
  'close',
  'author-restored',
  'coupling-restored',
  'gesture-restored',
] as const)
  it(`aligned group release late ${action} after detached paired controls rejects before writes`, () => {
    const f = alignedRelease();
    let hit = false;
    f.hook(() => {
      hit = true;
      if (action === 'target') f.state.target.x++;
      if (action === 'role') f.state.pick = { ...f.state.pick, role: 'incoming' };
      if (action === 'index') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
      if (action === 'root') f.state.pick = { ...f.state.pick, groupId: 'second' };
      if (action === 'source') f.project.name = 'Independent late source';
      if (action === 'library') f.project.symbols![0].name = 'Independent late library';
      if (action === 'membership')
        f.project.layers[0].keys[0].shapes[0].groups = ['independent-late-group'];
      if (action === 'frame') f.source(f.project, 5, 1);
      if (action === 'view') f.rect.width++;
      if (action === 'revision') f.state.revision++;
      if (action === 'close') f.drag.dispose();
      if (action === 'author-restored') f.state.alignedAuthoringPolicy! += 2;
      if (action === 'coupling-restored') f.state.couplingRevision! += 2;
      if (action === 'gesture-restored') f.state.policy += 2;
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(hit).toBe(true);
    expect(f.commits).toHaveLength(0);
    expect(f.captured.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    if (action === 'source') expect(f.project.name).toBe('Independent late source');
    else if (action === 'library')
      expect(f.project.symbols![0].name).toBe('Independent late library');
    else if (action === 'membership')
      expect(f.project.layers[0].keys[0].shapes[0].groups).toEqual(['independent-late-group']);
    else expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const method of ['down', 'move', 'up'] as const)
  it(`aligned group release swallowed publisher ${method} reentry poisons final admission`, () => {
    const f = alignedRelease();
    f.hook(() => {
      try {
        f.drag[method](at(f, 20, 60));
      } catch {}
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.publisher).toHaveBeenCalledTimes(1);
    expect(f.commits).toHaveLength(0);
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
for (const mode of ['zero', 'return', 'cancel', 'loss', 'foreign', 'disabled'] as const)
  it(`aligned group release never publishes ${mode} input`, () => {
    const f = alignedRelease();
    if (mode === 'disabled') f.state.enabled = false;
    f.drag.down(at(f));
    if (mode === 'return') {
      f.drag.move(at(f, 20, 60));
      f.flush();
    }
    if (mode === 'cancel') f.drag.cancel();
    if (mode === 'loss') f.canvas.releasePointerCapture(1);
    f.drag.up(
      mode === 'foreign'
        ? at(f, 20, 60, { pointerId: 2 })
        : mode === 'disabled'
          ? at(f, 20, 60)
          : at(f),
    );
    expect(f.publisher).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(0);
    f.drag.dispose();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
  });
it('aligned group release inherited publisher does not confer original publication ownership', () => {
  const f = alignedRelease();
  f.drag.dispose();
  delete f.options.publishAligned;
  Object.setPrototypeOf(f.options, { publishAligned: f.publisher });
  const drag = createLiveGroupWaypointTangentDrag(f.options);
  expect(drag.down(at(f))).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.publisher).not.toHaveBeenCalled();
  drag.dispose();
});
it('aligned group release asynchronous publisher rejects without a draft or independent fallback', () => {
  const independent = vi.fn(),
    publishAligned = vi.fn(async (_pick: unknown, _target: unknown, admit: () => void) => {
      admit();
    }),
    f = fixture(undefined, 4, independent, publishAligned);
  Object.assign(f.state, {
    coupling: 'aligned',
    couplingRevision: 0,
    alignedAuthoring: true,
    alignedAuthoringPolicy: 0,
    authoring: true,
    authoringPolicy: 0,
  });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  expect(publishAligned).toHaveBeenCalledTimes(1);
  expect(independent).not.toHaveBeenCalled();
  expect(f.state.preview).toBeNull();
  expect(String(f.error.mock.calls.at(-1)![0])).toMatch(/synchronous/);
  expect(f.project).toEqual(f.before);
  f.drag.dispose();
});
for (const action of [
  'getter',
  'prototype',
  'clock',
  'later target',
  'source',
  'reenter-down',
  'reenter-move',
  'reenter-up',
] as const)
  it(`aligned group release completed clone ${action} rejects before committing any paired output`, () => {
    const f = alignedRelease(),
      native = structuredClone,
      getter = vi.fn(() => 20);
    expect(f.drag.down(at(f))).toBe(true);
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        p = out as Project;
      if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30) {
        hit = true;
        expect(f.captured.size).toBe(0);
        expect(f.observers.every((o) => !o.connected)).toBe(true);
        if (action === 'getter')
          Object.defineProperty(p.layers[0].keys[0].shapes[0], 'width', {
            get: getter,
            enumerable: true,
          });
        if (action === 'prototype')
          Object.setPrototypeOf(p.layers[0].keys[0].shapes[0], { forged: true });
        if (action === 'clock') p.duration++;
        if (action === 'later target')
          (p.layers[0].liveMotionSpans![0].path!.waypointIncoming as Point[])[1].x = NaN;
        if (action === 'source') f.project.name = 'Clone-time original source survives';
        if (action.startsWith('reenter')) {
          try {
            f.drag[action.slice(8) as 'down' | 'move' | 'up'](at(f, 20, 60));
          } catch {}
        }
      }
      return out;
    });
    f.drag.up(at(f, 20, 60));
    expect(hit).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(0);
    expect(f.publisher).toHaveBeenCalledTimes(1);
    expect(f.captured.size).toBe(0);
    if (action === 'source') expect(f.project.name).toBe('Clone-time original source survives');
    else expect(f.project).toEqual(f.before);
    vi.stubGlobal('structuredClone', native);
    if (action !== 'source') {
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 60));
      expect(f.commits).toHaveLength(1);
    }
    f.drag.dispose();
  });
it('aligned group release actual replacement aggregate overflow rejects without consuming source-valid retry', () => {
  const f = alignedRelease(),
    native = structuredClone;
  expect(f.drag.down(at(f))).toBe(true);
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value),
      p = out as Project;
    if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30) {
      hit = true;
      expect(f.captured.size).toBe(0);
      p.symbols = [
        {
          id: 'capacity',
          name: 'Capacity',
          width: 1,
          height: 1,
          shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
            id: 'v' + i,
            kind: 'rectangle' as const,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            rotation: 0,
            fill: '#000000',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          })),
        },
      ];
    }
    return out;
  });
  f.drag.up(at(f, 20, 60));
  expect(hit).toBe(true);
  expect(f.commits).toHaveLength(0);
  expect(f.project).toEqual(f.before);
  expect(f.captured.size).toBe(0);
  vi.stubGlobal('structuredClone', native);
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  expect(f.commits).toHaveLength(1);
  f.drag.dispose();
});
for (const mode of ['tangent', 'distance tangent'])
  it(`aligned group release ${mode} keeps tangent-bearing recipe admission exact`, () => {
    const f = alignedRelease((p) =>
      Object.assign(p.layers[0].liveMotionSpans![0].path!, {
        tangent: true,
        headingOffset: 10,
        headingOffsetEnd: 20,
        ...(mode === 'distance tangent' ? { distance: true } : {}),
      }),
    );
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].layers[0].liveMotionSpans![0].options).toEqual(
      f.before.layers[0].liveMotionSpans![0].options,
    );
    f.drag.dispose();
  });
for (const action of ['cancel', 'author opt-out', 'zero', 'return'] as const)
  it(`aligned group release ${action} restores independently owned numeric prior without publishing`, () => {
    const f = alignedRelease(),
      prior = f.prior();
    f.state.preview = prior;
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 60));
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    if (action === 'author opt-out') {
      f.state.alignedAuthoring = false;
      f.state.alignedAuthoringPolicy!++;
      f.drag.changed();
    }
    if (action === 'zero' || action === 'return') f.drag.move(at(f));
    if (action === 'return') f.drag.up(at(f));
    else f.drag.cancel();
    expect(f.state.preview).toBe(prior);
    expect(prior.validate).toHaveBeenCalled();
    expect(f.publisher).not.toHaveBeenCalled();
    expect(f.commits).toHaveLength(0);
    expect(f.project).toEqual(f.before);
    expect(f.captured.size).toBe(0);
    f.drag.dispose();
  });
