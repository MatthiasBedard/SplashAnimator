import { afterEach, expect, it, vi } from 'vitest';
import { liveSplitFixture } from './live-motion-split-fixture';
import { MAX_SYMBOL_ARTWORK, type Project, type Point } from '../packages/document/src';
import { validateLiveGraphicData } from '../packages/document/src/live-motion';
import {
  captureLiveWaypointTangents,
  prepareLiveWaypointTangentPositions,
  prepareLiveWaypointTangentPairs,
} from '../packages/animation/src/live-waypoint-tangents';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import {
  createLiveWaypointTangentDrag,
  type LiveWaypointTangentDraft,
  type LiveWaypointTangentDragState,
} from '../apps/editor/src/live-waypoint-tangent-drag';
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
  publish?: Parameters<typeof createLiveWaypointTangentDrag>[0]['publish'],
  publishAligned?: Parameters<typeof createLiveWaypointTangentDrag>[0]['publishAligned'],
) {
  const project = liveSplitFixture((_p, s) => {
    s.path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      curvedWaypoints: true,
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
      waypoints: [
        { x: 0, y: 40 },
        { x: 60, y: 20 },
      ],
    };
    for (const key of _p.layers[0].keys.slice(0, 2))
      key.shapes.push({
        ...structuredClone(key.shapes[0]),
        id: 'second',
        x: key.shapes[0].x + 40,
        y: key.shapes[0].y + 30,
      });
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
  const state: LiveWaypointTangentDragState = {
    context,
    pick: { layerId: 'track', spanId: 'live', shapeId: 'art', waypointIndex: 0, role: 'outgoing' },
    target: { x: -300, y: 800 },
    revision: 0,
    enabled: true,
    policy: 0,
    preview: null,
  };
  const outputs: { value: LiveWaypointTangentDraft | null; live: boolean }[] = [];
  const preview = vi.fn((value: LiveWaypointTangentDraft | null, live: boolean) => {
    state.preview = value;
    outputs.push({ value, live });
  });
  const error = vi.fn(),
    active = vi.fn(),
    foreground = vi.fn(() => true);
  const readState = vi.fn(() => state);
  const options: Parameters<typeof createLiveWaypointTangentDrag>[0] = {
    canvas: canvas as unknown as HTMLCanvasElement,
    state: readState,
    view: () => view,
    preview,
    error,
    active,
    foreground,
    publish,
    publishAligned,
    requestFrame: (callback) => {
      frames.set(++ticket, callback);
      return ticket;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  };
  const drag = createLiveWaypointTangentDrag(options);
  const flush = () => {
    const rows = [...frames.values()];
    frames.clear();
    rows.forEach((run) => run());
  };
  const prior = (): LiveWaypointTangentDraft => ({
    project: structuredClone(project),
    owner: {} as LiveWaypointTangentDraft['owner'],
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
    a = l.keys.find((k) => k.frame === span.start)!.shapes.find((a) => a.id === pick.shapeId)!,
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
function curve(p: Project, frame: number, root = 0) {
  const l = p.layers[0],
    span = l.liveMotionSpans![0],
    path = span.path!,
    a = l.keys[0].shapes[root],
    b = l.keys[1].shapes[root],
    points = [
      { x: a.x, y: a.y },
      ...path.waypoints!.map((w) => ({ x: a.x + w.x, y: a.y + w.y })),
      { x: b.x, y: b.y },
    ];
  const t = (frame / 8) * 3,
    i = Math.min(2, Math.floor(t)),
    u = t - i,
    v = 1 - u,
    x = points[i],
    y = points[i + 1],
    out = path.waypointTangents![i],
    inc =
      i < 2
        ? path.waypointIncoming![i]
        : { x: -path.waypointTangents![3].x, y: -path.waypointTangents![3].y };
  return {
    x:
      v * v * v * x.x +
      3 * v * v * u * (x.x + out.x) +
      3 * v * u * u * (y.x + inc.x) +
      u * u * u * y.x,
    y:
      v * v * v * x.y +
      3 * v * v * u * (x.y + out.y) +
      3 * v * u * u * (y.y + inc.y) +
      u * u * u * y.y,
  };
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
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shape of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        it(`prepares fresh signed ${basis}/${shape}/${index}/${role} controls and independent curve poses`, () => {
          const f = fixture((p) => {
            if (basis !== 'plain') {
              p.layers[0].liveMotionSpans![0].options = { affine: true };
              for (const k of p.layers[0].keys.slice(0, 2))
                for (const a of k.shapes)
                  Object.assign(a, {
                    rotation: 25,
                    transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
                    pivot: { x: -100, y: 200 },
                  });
            }
          });
          f.state.pick = { ...f.state.pick, shapeId: shape, waypointIndex: index, role };
          const original = control(f),
            q = { x: original.point.x + 20, y: original.point.y + 10 };
          expect(f.drag.down(at(f))).toBe(true);
          f.drag.move(at(f, 20, 30));
          f.flush();
          const scratch = f.state.preview!;
          expect(scratch.owner.anchor).toEqual(original.anchor);
          expect(scratch.owner.point).toEqual(original.point);
          expect(scratch.project).toEqual(expected(f, q));
          f.drag.up(at(f, 20, 30));
          const out = f.state.preview!;
          expect(out.project).toEqual(expected(f, q));
          expect(compileMovieClockPlan(out.project)).toEqual(compileMovieClockPlan(f.before));
          const sampler = createMotionFrameSampler(
            out.project,
            'track',
            out.project.layers[0].liveMotionSpans![0],
          );
          for (const frame of [0, 1, 2, 4, 6, 7, 8])
            for (const root of [0, 1]) {
              const pose = sampler.sample(frame)[root],
                wanted = curve(expected(f, q), frame, root);
              expect(pose.x).toBeCloseTo(wanted.x, 9);
              expect(pose.y).toBeCloseTo(wanted.y, 9);
            }
          sampler.dispose();
          expect(f.project).toEqual(f.before);
          expect(f.error).not.toHaveBeenCalled();
          f.drag.dispose();
        });
for (const basis of ['plain', 'affine', 'reflected'])
  it(`retains aligned compound ${basis} geometry/correspondence and exact handles`, () => {
    const f = fixture((p) => {
      const s = p.layers[0].liveMotionSpans![0];
      for (const [i, k] of p.layers[0].keys.slice(0, 2).entries())
        for (const a of k.shapes) {
          const rings = [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 4, y: 4 },
              { x: 10, y: 4 },
              { x: 7, y: 10 },
            ],
          ];
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: i ? rings.reverse() : rings,
          });
          if (basis !== 'plain')
            Object.assign(a, {
              rotation: 25,
              transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
            });
        }
      s.options = { affine: true, nodes: true };
      s.correspondence = { order: [1, 0] };
    });
    const q = { x: control(f).point.x + 20, y: control(f).point.y + 10 };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(expected(f, q));
    expect(f.state.preview!.project.layers[0].keys).toEqual(f.before.layers[0].keys);
    expect(f.project).toEqual(f.before);
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
    if (action === 'root') f.state.pick = { ...f.state.pick, shapeId: 'second' };
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
for (const field of ['role', 'waypointIndex', 'shapeId'])
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
it('retains explicit opt-in and cannot consume retained authoring preferences or publishers', () => {
  const f = fixture(),
    publish = vi.fn();
  Object.assign(f.state, {
    enabled: false,
    nodeAuthoring: true,
    tangentAuthoringPolicy: 99,
    publish,
  });
  expect(f.drag.down(at(f))).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  f.state.enabled = true;
  f.state.policy++;
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 30));
  expect(f.state.preview).not.toBeNull();
  expect(publish).not.toHaveBeenCalled();
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
for (const mode of ['tangent', 'distance-tangent'])
  it(`keeps ${mode} join rejection and original-bearing radius retry`, () => {
    const f = fixture((p) => {
      const path = p.layers[0].liveMotionSpans![0].path!;
      path.tangent = true;
      if (mode.includes('distance')) path.distance = true;
    });
    const a = at(f);
    expect(f.drag.down(a)).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.state.preview).toBeNull();
    expect(f.project).toEqual(f.before);
    expect(f.drag.down(a)).toBe(true);
    f.drag.up(at(f, -10, -15));
    expect(f.state.preview).toBeNull();
    expect(String(f.error.mock.calls.at(-1)![0])).toMatch(/stationary|tangent|direction/i);
    expect(f.project).toEqual(f.before);
    expect(f.drag.down(a)).toBe(true);
    f.drag.up(at(f, 10, 15));
    expect(f.state.preview).not.toBeNull();
    expect(f.project).toEqual(f.before);
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
for (const layer of ['track', 'later'])
  it(`keeps ${layer} original track ownership and other tracks exact`, () => {
    const f = fixture((p) => {
      const l = structuredClone(p.layers[0]);
      l.id = 'later';
      for (const k of l.keys) for (const a of k.shapes) a.x += 50;
      p.layers.push(l);
    });
    f.state.pick = { ...f.state.pick, layerId: layer };
    const p = control(f).point,
      q = { x: p.x + 20, y: p.y + 10 };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 30));
    expect(f.state.preview!.project).toEqual(expected(f, q));
    expect(f.state.preview!.owner.layerId).toBe(layer);
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

for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        for (const shift of [false, true])
          it(`release authoring ${basis}/${root}/${index}/${role}/Shift${shift} freshly prepares exact controls after cleanup`, () => {
            const candidates: Project[] = [];
            const publish = vi.fn(
              (
                pick: LiveWaypointTangentDragState['pick'],
                target: Readonly<Point>,
                admit: () => void,
              ) => {
                expect(f.captured.size).toBe(0);
                expect(f.frames.size).toBe(0);
                expect(f.observers.every((o) => !o.connected)).toBe(true);
                admit();
                const scope = captureLiveWaypointTangents(f.context.readSource);
                try {
                  const owner = scope.resolve(
                    pick.layerId,
                    pick.spanId,
                    pick.shapeId,
                    pick.waypointIndex,
                    pick.role,
                  );
                  const candidate = prepareLiveWaypointTangentPositions([{ owner, target }], {
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
                if (basis !== 'plain') {
                  p.layers[0].liveMotionSpans![0].options = { affine: true };
                  for (const key of p.layers[0].keys.slice(0, 2))
                    for (const a of key.shapes)
                      Object.assign(a, {
                        rotation: 25,
                        transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
                        pivot: { x: -100, y: 200 },
                      });
                }
              },
              4,
              publish,
            );
            Object.assign(f.state, { authoring: true, authoringPolicy: 0 });
            f.state.pick = { ...f.state.pick, shapeId: root, waypointIndex: index, role };
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
] as const)
  it(`release authoring rejects late ${mutation} after detached signed controls exist`, () => {
    let commits = 0,
      prepared: Project | undefined;
    const publish = vi.fn(
      (pick: LiveWaypointTangentDragState['pick'], target: Readonly<Point>, admit: () => void) => {
        const scope = captureLiveWaypointTangents(f.context.readSource);
        try {
          prepared = prepareLiveWaypointTangentPositions(
            [
              {
                owner: scope.resolve(
                  pick.layerId,
                  pick.spanId,
                  pick.shapeId,
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
    expect(() => createLiveWaypointTangentDrag(options)).toThrow(/publisher/);
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

function assertAlignedDraft(f: Fixture, value: LiveWaypointTangentDraft, q: Readonly<Point>) {
  value.validate();
  expect(value.target).toEqual(q);
  const pick = f.state.pick,
    before = f.before.layers
      .find((l) => l.id === pick.layerId)!
      .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!,
    after = value.project.layers
      .find((l) => l.id === pick.layerId)!
      .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!,
    a = control(f).anchor,
    dx = q.x - a.x,
    dy = q.y - a.y,
    v =
      pick.role === 'incoming'
        ? after.waypointTangents![pick.waypointIndex + 1]
        : after.waypointIncoming![pick.waypointIndex],
    old =
      pick.role === 'incoming'
        ? before.waypointTangents![pick.waypointIndex + 1]
        : before.waypointIncoming![pick.waypointIndex],
    radius = Math.hypot(old.x, old.y);
  expect(value.opposite).toEqual({ x: a.x + v.x, y: a.y + v.y });
  expect(Object.isFrozen(value.opposite)).toBe(true);
  expect(Math.hypot(v.x, v.y)).toBeCloseTo(radius, 12);
  if (radius > 0) {
    const n = Math.hypot(dx, dy);
    expect(Math.abs(((dx / n) * v.y) / radius - ((dy / n) * v.x) / radius)).toBeLessThan(2e-15);
    expect(((dx / n) * v.x) / radius + ((dy / n) * v.y) / radius).toBeLessThan(0);
  }
  const wanted = expected(f, q),
    path = wanted.layers
      .find((l) => l.id === pick.layerId)!
      .liveMotionSpans!.find((s) => s.id === pick.spanId)!.path!;
  if (pick.role === 'incoming')
    (path.waypointTangents as Point[])[pick.waypointIndex + 1] = { ...v };
  else (path.waypointIncoming as Point[])[pick.waypointIndex] = { ...v };
  expect(value.project).toEqual(wanted);
  expect(compileMovieClockPlan(value.project)).toEqual(compileMovieClockPlan(f.before));
  return wanted;
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        for (const shift of [false, true])
          it(`aligned draft ${basis}/${root}/${index}/${role}/Shift${shift} prepares exact coupled poses and fresh history-free release`, () => {
            const publish = vi.fn(),
              f = fixture(
                (p) => {
                  if (basis !== 'plain') {
                    p.layers[0].liveMotionSpans![0].options = { affine: true };
                    for (const key of p.layers[0].keys.slice(0, 2))
                      for (const a of key.shapes)
                        Object.assign(a, {
                          rotation: 25,
                          transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
                          pivot: { x: -100, y: 200 },
                        });
                  }
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
            f.state.pick = { ...f.state.pick, shapeId: root, waypointIndex: index, role };
            const original = control(f),
              q = { x: original.point.x + 20, y: original.point.y + (shift ? 0 : 20) };
            expect(f.drag.down(at(f))).toBe(true);
            f.drag.move(at(f, 20, 60, { shiftKey: shift }));
            f.flush();
            const scratch = f.state.preview!,
              wanted = assertAlignedDraft(f, scratch, q);
            expect(scratch.owner.point).toEqual(original.point);
            expect(scratch.owner.anchor).toEqual(original.anchor);
            f.drag.up(at(f, 20, 60, { shiftKey: shift }));
            const out = f.state.preview!;
            assertAlignedDraft(f, out, q);
            expect(out).not.toBe(scratch);
            expect(out.project).not.toBe(scratch.project);
            expect(() => scratch.validate()).toThrow();
            expect(publish).not.toHaveBeenCalled();
            expect(f.project).toEqual(f.before);
            expect(f.captured.size).toBe(0);
            expect(f.observers.every((o) => !o.connected)).toBe(true);
            expect(f.frames.size).toBe(0);
            expect(f.state.target).toEqual({ x: -300, y: 800 });
            const sampler = createMotionFrameSampler(
              out.project,
              'track',
              out.project.layers[0].liveMotionSpans![0],
            );
            for (const frame of [0, 1, 2, 4, 6, 7, 8])
              for (const r of [0, 1]) {
                const actual = sampler.sample(frame)[r],
                  p = curve(wanted, frame, r);
                expect(actual.x).toBeCloseTo(p.x, 9);
                expect(actual.y).toBeCloseTo(p.y, 9);
              }
            sampler.dispose();
            expect(f.error).not.toHaveBeenCalled();
            f.drag.dispose();
          });
for (const shift of [false, true])
  it(`aligned draft coalesces 1000 native movements with frozen CSS/offset/Shift${shift} and no per-move source transport`, () => {
    const f = fixture();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    const native = structuredClone;
    let clones = 0;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      clones++;
      return native(value);
    });
    expect(f.drag.down(at(f))).toBe(true);
    const reads = f.context.readSource.mock.calls.length,
      checks = f.context.validate.mock.calls.length,
      copies = clones;
    for (let i = 1; i <= 1000; i++)
      f.drag.move(at(f, (20 * i) / 1000, (60 * i) / 1000, { shiftKey: shift }));
    expect(f.context.readSource).toHaveBeenCalledTimes(reads);
    expect(f.context.validate).toHaveBeenCalledTimes(checks);
    expect(clones).toBe(copies);
    expect(f.frames.size).toBe(1);
    expect(f.state.preview).toBeNull();
    f.flush();
    const q = { x: control(f).point.x + 20, y: control(f).point.y + (shift ? 0 : 20) };
    assertAlignedDraft(f, f.state.preview!, q);
    f.drag.up(at(f, 20, 60, { shiftKey: shift }));
    assertAlignedDraft(f, f.state.preview!, q);
    expect(f.outputs.at(-1)!.live).toBe(false);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const role of ['incoming', 'outgoing'] as const)
  for (const index of [0, 1])
    for (const distance of [false, true])
      it(`aligned draft tangent-bearing ${role}/${index}/distance${distance} admits coupled turning`, () => {
        const f = fixture((p) => {
          Object.assign(p.layers[0].liveMotionSpans![0].path!, {
            tangent: true,
            ...(distance ? { distance: true } : {}),
          });
        });
        Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
        f.state.pick = { ...f.state.pick, role, waypointIndex: index };
        expect(f.drag.down(at(f))).toBe(true);
        f.drag.move(at(f, 20, 60));
        f.flush();
        expect(f.state.preview).not.toBeNull();
        f.drag.up(at(f, 20, 60));
        assertAlignedDraft(f, f.state.preview!, {
          x: control(f).point.x + 20,
          y: control(f).point.y + 20,
        });
        expect(f.error).not.toHaveBeenCalled();
        f.drag.dispose();
      });
for (const phase of ['initial', 'active', 'delivery', 'release', 'retained'] as const)
  for (const mode of ['changed', 'restored'] as const)
    it(`aligned draft coupling ${mode} in ${phase} rejects stale ownership and permits retries`, () => {
      const f = fixture();
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      const change = () => {
        f.state.coupling = 'independent';
        f.state.couplingRevision!++;
        if (mode === 'restored') {
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
        const native = f.preview.getMockImplementation()!;
        f.preview.mockImplementationOnce((value, live) => {
          native(value, live);
          change();
        });
      }
      const hit = f.drag.down(at(f));
      if (phase === 'initial') expect(hit).toBe(false);
      else {
        expect(hit).toBe(true);
        f.drag.move(at(f, 20, 60));
        if (phase === 'active') change();
        if (phase === 'delivery') f.flush();
        if (phase === 'release')
          f.canvas.getBoundingClientRect.mockImplementationOnce(() => {
            change();
            return f.rect;
          });
        f.drag.up(at(f, 20, 60));
        if (phase === 'retained') change();
      }
      expect(f.captured.size).toBe(0);
      expect(f.project).toEqual(f.before);
      expect(f.state.preview).toBeNull();
      Object.assign(f.state, {
        coupling: 'aligned',
        couplingRevision: (f.state.couplingRevision ?? 0) + 1,
      });
      expect(f.drag.down(at(f))).toBe(true);
      f.drag.up(at(f, 20, 60));
      assertAlignedDraft(f, f.state.preview!, {
        x: control(f).point.x + 20,
        y: control(f).point.y + 20,
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
] as const)
  it(`aligned draft rejects ${mode} coupling data before source reads`, () => {
    const f = fixture(),
      getter = vi.fn(() => 0);
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    if (mode === 'missing revision') delete f.state.couplingRevision;
    if (mode === 'missing mode') delete f.state.coupling;
    if (mode === 'unknown') Object.assign(f.state, { coupling: 'mirrored' });
    if (mode === 'negative') f.state.couplingRevision = -1;
    if (mode === 'NaN') f.state.couplingRevision = NaN;
    if (mode === 'getter mode' || mode === 'getter revision')
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
for (const mode of ['none', 'retained true', 'extra paired preference'] as const)
  it(`aligned draft ${mode} cannot authorize release publication without a new dedicated policy`, () => {
    const publish = mode === 'none' ? undefined : vi.fn(),
      f = fixture(undefined, 4, publish);
    Object.assign(f.state, {
      coupling: 'aligned',
      couplingRevision: 0,
      authoring: true,
      authoringPolicy: 77,
      ...(mode === 'extra paired preference'
        ? { pairedAuthoring: true, pairedAuthoringPolicy: 99 }
        : {}),
    });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.state.preview).not.toBeNull();
    if (publish) expect(publish).not.toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const mode of [
  'Escape',
  'loss',
  'view',
  'gesture-policy',
  'coupling-policy',
  'zero',
  'return',
] as const)
  it(`aligned draft ${mode} restores only an independent valid numeric prior`, () => {
    const f = fixture(),
      prior = f.prior();
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0, preview: prior });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 60));
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    if (mode === 'Escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    if (mode === 'loss') f.canvas.releasePointerCapture(1);
    if (mode === 'view') {
      f.rect.width++;
      f.drag.changed();
    }
    if (mode === 'gesture-policy') {
      f.state.policy++;
      f.drag.changed();
    }
    if (mode === 'coupling-policy') {
      f.state.couplingRevision!++;
      f.drag.changed();
    }
    if (mode === 'zero' || mode === 'return') f.drag.move(at(f));
    if (mode === 'return') f.drag.up(at(f));
    else f.drag.cancel();
    expect(f.state.preview).toBe(prior);
    expect(prior.validate).toHaveBeenCalled();
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const phase of ['movement', 'release'] as const)
  for (const mode of [
    'source',
    'target',
    'role',
    'candidate',
    'clock',
    'getter',
    'reentry',
  ] as const)
    it(`aligned draft late ${phase}/${mode} rejects without source writes`, () => {
      const f = fixture(),
        native = structuredClone,
        getter = vi.fn(() => 20);
      Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
      expect(f.drag.down(at(f))).toBe(true);
      let hit = false;
      vi.stubGlobal('structuredClone', (value: unknown) => {
        const out = native(value),
          p = out as Project;
        if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30) {
          hit = true;
          if (mode === 'source') f.project.name = 'Independent late aligned source';
          if (mode === 'target') f.state.target.x++;
          if (mode === 'role') f.state.pick = { ...f.state.pick, role: 'incoming' };
          if (mode === 'candidate')
            Object.setPrototypeOf(p.layers[0].keys[0].shapes[0], { forged: true });
          if (mode === 'clock') p.duration++;
          if (mode === 'getter')
            Object.defineProperty(p.layers[0].keys[0].shapes[0], 'width', {
              enumerable: true,
              get: getter,
            });
          if (mode === 'reentry')
            try {
              f.drag.up(at(f, 20, 60));
            } catch {}
        }
        return out;
      });
      if (phase === 'movement') {
        f.drag.move(at(f, 20, 60));
        f.flush();
      } else f.drag.up(at(f, 20, 60));
      expect(hit).toBe(true);
      expect(getter).not.toHaveBeenCalled();
      expect(f.captured.size).toBe(0);
      if (mode === 'source') expect(f.project.name).toBe('Independent late aligned source');
      else expect(f.project).toEqual(f.before);
      f.drag.dispose();
    });
for (const role of ['incoming', 'outgoing'] as const)
  it(`aligned draft ${role} preserves original zero opposite coordinates and detached display metadata`, () => {
    const f = fixture((p) =>
      Object.assign(
        role === 'incoming'
          ? p.layers[0].liveMotionSpans![0].path!.waypointTangents![1]
          : p.layers[0].liveMotionSpans![0].path!.waypointIncoming![0],
        { x: 0, y: 0 },
      ),
    );
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    f.state.pick = { ...f.state.pick, role };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    const value = f.state.preview!;
    expect(value.opposite).toEqual(value.owner.anchor);
    expect(() => Object.assign(value.opposite!, { x: 999 })).toThrow();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

for (const basis of ['plain', 'affine', 'reflected'])
  it(`aligned draft compound ${basis} geometry/correspondence and exact handles`, () => {
    const f = fixture((p) => {
      const s = p.layers[0].liveMotionSpans![0];
      for (const [i, k] of p.layers[0].keys.slice(0, 2).entries())
        for (const a of k.shapes) {
          const rings = [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 4, y: 4 },
              { x: 10, y: 4 },
              { x: 7, y: 10 },
            ],
          ];
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: i ? rings.reverse() : rings,
          });
          if (basis !== 'plain')
            Object.assign(a, {
              rotation: 25,
              transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
            });
        }
      s.options = { affine: true, nodes: true };
      s.correspondence = { order: [1, 0] };
    });
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    const q = { x: control(f).point.x + 20, y: control(f).point.y + 20 };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    assertAlignedDraft(f, f.state.preview!, q);
    expect(f.state.preview!.project.layers[0].keys).toEqual(f.before.layers[0].keys);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
it('aligned draft compatibility retains original independent output keys and explicit defaults', () => {
  const f = fixture();
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  const original = f.state.preview!;
  expect(Object.hasOwn(original, 'opposite')).toBe(false);
  const project = original.project;
  f.drag.cancel();
  Object.assign(f.state, { coupling: 'independent', couplingRevision: 0 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  expect(f.state.preview!.project).toEqual(project);
  expect(Object.keys(f.state.preview!)).toEqual(Object.keys(original));
  expect(Object.hasOwn(f.state.preview!, 'opposite')).toBe(false);
  f.drag.dispose();
});
for (const mutation of ['none', 'prototype', 'getter'] as const)
  it(`aligned draft retained proposed pick/${mutation} cannot steal ownership or retain corrupt data`, () => {
    const f = fixture(),
      getter = vi.fn(() => 20);
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    const value = f.state.preview!;
    if (mutation === 'prototype')
      Object.setPrototypeOf(value.project.layers[0].keys[0].shapes[0], { forged: true });
    if (mutation === 'getter')
      Object.defineProperty(value.project.layers[0].keys[0].shapes[0], 'width', {
        get: getter,
        enumerable: true,
      });
    expect(f.drag.down(at(f, 20, 60))).toBe(false);
    expect(f.captured.size).toBe(0);
    expect(getter).not.toHaveBeenCalled();
    if (mutation === 'none') {
      expect(f.state.preview).toBe(value);
      value.validate();
    } else {
      f.drag.changed();
      expect(() => value.validate()).toThrow();
      expect(f.state.preview).toBeNull();
    }
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
it('aligned draft tiny opposite radius comes from original stored data rather than rounded public coordinates', () => {
  const f = fixture((p) =>
    Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointIncoming![0], {
      x: -2e-150,
      y: -1e-150,
    }),
  );
  Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  const value = f.state.preview!,
    radius = Math.hypot(2e-150, 1e-150),
    opposite = value.project.layers[0].liveMotionSpans![0].path!.waypointIncoming![0];
  expect(Math.abs(Math.hypot(opposite.x, opposite.y) - radius) / radius).toBeLessThan(2e-15);
  expect(value.opposite).toEqual(value.owner.anchor);
  assertAlignedDraft(f, value, { x: control(f).point.x + 20, y: control(f).point.y + 20 });
  f.drag.dispose();
});
for (const mode of ['radius overflow', 'subnormal uncertainty'] as const)
  it(`aligned draft numerical ${mode} rejects before emitting a candidate`, () => {
    const f = fixture((p) =>
      Object.assign(
        p.layers[0].liveMotionSpans![0].path!.waypointIncoming![0],
        mode === 'radius overflow'
          ? { x: Number.MAX_VALUE, y: Number.MAX_VALUE }
          : { x: Number.MIN_VALUE, y: 0 },
      ),
    );
    Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.state.preview).toBeNull();
    expect(f.captured.size).toBe(0);
    expect(f.error).toHaveBeenCalled();
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
it('aligned draft actual replacement aggregate overflow rejects without consuming a fresh source-valid capture', () => {
  const f = fixture(),
    native = structuredClone;
  Object.assign(f.state, { coupling: 'aligned', couplingRevision: 0 });
  expect(f.drag.down(at(f))).toBe(true);
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value),
      p = out as Project;
    if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 30) {
      hit = true;
      const shape = {
        id: 'v',
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
      };
      p.symbols = [
        {
          id: 'capacity',
          name: 'Capacity',
          width: 1,
          height: 1,
          shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
            ...shape,
            id: 'v' + i,
          })),
        },
      ];
    }
    return out;
  });
  f.drag.up(at(f, 20, 60));
  expect(hit).toBe(true);
  expect(f.state.preview).toBeNull();
  expect(f.captured.size).toBe(0);
  expect(f.project).toEqual(f.before);
  vi.stubGlobal('structuredClone', native);
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  assertAlignedDraft(f, f.state.preview!, {
    x: control(f).point.x + 20,
    y: control(f).point.y + 20,
  });
  f.drag.dispose();
});

for (const mode of ['independent', 'aligned'] as const)
  it(`aligned draft prior callback keeps a newer independent numeric preview authoritative in ${mode}`, () => {
    const f = fixture(),
      prior = f.prior(),
      newer = f.prior();
    Object.assign(f.state, { coupling: mode, couplingRevision: 0, preview: prior });
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.move(at(f, 20, 60));
    f.flush();
    expect(f.state.preview).not.toBe(prior);
    vi.mocked(prior.validate).mockImplementation(() => {
      f.state.preview = newer;
    });
    f.drag.cancel();
    expect(f.state.preview).toBe(newer);
    expect(f.captured.size).toBe(0);
    expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });

function alignedRelease(setup?: (p: Project) => void) {
  let hook: ((candidate: Project) => void) | undefined;
  const commits: Project[] = [],
    independent = vi.fn(),
    publisher = vi.fn(
      (pick: LiveWaypointTangentDragState['pick'], target: Readonly<Point>, admit: () => void) => {
        expect(f.captured.size).toBe(0);
        expect(f.frames.size).toBe(0);
        expect(f.observers.every((o) => !o.connected)).toBe(true);
        admit();
        const scope = captureLiveWaypointTangents(f.context.readSource);
        try {
          const owner = scope.resolve(
              pick.layerId,
              pick.spanId,
              pick.shapeId,
              pick.waypointIndex,
              pick.role,
            ),
            opposite = scope.resolve(
              pick.layerId,
              pick.spanId,
              pick.shapeId,
              pick.waypointIndex,
              pick.role === 'incoming' ? 'outgoing' : 'incoming',
            ),
            candidate = prepareLiveWaypointTangentPairs([{ owner, target }], {
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
          assertAlignedDraft(
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
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        it(`aligned release ${basis}/${root}/${index}/${role} freshly prepares both original controls after cleanup`, () => {
          const f = alignedRelease((p) => {
            if (basis !== 'plain') {
              p.layers[0].liveMotionSpans![0].options = { affine: true };
              for (const key of p.layers[0].keys.slice(0, 2))
                for (const s of key.shapes)
                  Object.assign(s, {
                    rotation: 25,
                    transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
                    pivot: { x: -20, y: 70 },
                  });
            }
          });
          f.state.pick = { ...f.state.pick, shapeId: root, waypointIndex: index, role };
          expect(f.drag.down(at(f))).toBe(true);
          f.drag.move(at(f, 20, 60));
          f.flush();
          const scratch = f.state.preview!;
          assertAlignedDraft(f, scratch, {
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
  it(`aligned release CSS/Shift${shift} keeps original offsets with no intermediate task delivery`, () => {
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
  it(`aligned release ${mode} keeps default draft-only release despite captured publishers`, () => {
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
  it(`aligned release malformed ${mode} rejects before source reads`, () => {
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
  it(`aligned release publisher ${kind} rejects without invoking accessor or source`, () => {
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
    expect(() => createLiveWaypointTangentDrag(f.options)).toThrow(/publisher/);
    expect(get).not.toHaveBeenCalled();
    expect(f.context.readSource).not.toHaveBeenCalled();
  });
it('aligned release requires its own publisher rather than the independent callback', () => {
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
it('aligned release preference cannot authorize an independent gesture', () => {
  const f = alignedRelease();
  Object.assign(f.state, { coupling: 'independent', couplingRevision: 1 });
  expect(f.drag.down(at(f))).toBe(true);
  f.drag.up(at(f, 20, 60));
  expect(f.publisher).not.toHaveBeenCalled();
  expect(f.independent).not.toHaveBeenCalled();
  expect(f.state.preview).not.toBeNull();
  f.drag.dispose();
});
it('aligned release captures its original publisher before later options replacement', () => {
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
    it(`aligned release restored ${mode}/${phase} rejects stale work and permits fresh opted-out drafts`, () => {
      const f = alignedRelease(),
        change = () => {
          if (mode === 'author') f.state.alignedAuthoringPolicy! += 2;
          if (mode === 'coupling') f.state.couplingRevision! += 2;
          if (mode === 'gesture') f.state.policy += 2;
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
  'frame',
  'view',
  'revision',
  'close',
  'author-restored',
  'coupling-restored',
  'gesture-restored',
] as const)
  it(`aligned release late ${action} after detached paired controls rejects before writes`, () => {
    const f = alignedRelease();
    let hit = false;
    f.hook(() => {
      hit = true;
      if (action === 'target') f.state.target.x++;
      if (action === 'role') f.state.pick = { ...f.state.pick, role: 'incoming' };
      if (action === 'index') f.state.pick = { ...f.state.pick, waypointIndex: 1 };
      if (action === 'root') f.state.pick = { ...f.state.pick, shapeId: 'second' };
      if (action === 'source') f.project.name = 'Independent late source';
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
    else expect(f.project).toEqual(f.before);
    f.drag.dispose();
  });
for (const method of ['down', 'move', 'up'] as const)
  it(`aligned release swallowed publisher ${method} reentry poisons final admission`, () => {
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
  it(`aligned release never publishes ${mode} input`, () => {
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
it('aligned release inherited publisher does not confer original publication ownership', () => {
  const f = alignedRelease();
  f.drag.dispose();
  delete f.options.publishAligned;
  Object.setPrototypeOf(f.options, { publishAligned: f.publisher });
  const drag = createLiveWaypointTangentDrag(f.options);
  expect(drag.down(at(f))).toBe(false);
  expect(f.context.readSource).not.toHaveBeenCalled();
  expect(f.publisher).not.toHaveBeenCalled();
  drag.dispose();
});
it('aligned release asynchronous publisher rejects without a draft or independent fallback', () => {
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
  it(`aligned release completed clone ${action} rejects before committing any paired output`, () => {
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
it('aligned release actual replacement aggregate overflow rejects without consuming source-valid retry', () => {
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
  it(`aligned release ${mode} keeps tangent-bearing recipe admission exact`, () => {
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
for (const basis of ['plain', 'affine', 'reflected'])
  it(`aligned release compound ${basis} preserves original correspondence and full artwork`, () => {
    const f = alignedRelease((p) => {
      p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
      p.layers[0].liveMotionSpans![0].correspondence = { order: [1, 0] };
      for (const [i, key] of p.layers[0].keys.slice(0, 2).entries())
        for (const a of key.shapes) {
          const rings = [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 4, y: 4 },
              { x: 10, y: 4 },
              { x: 7, y: 10 },
            ],
          ];
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: i ? rings.reverse() : rings,
          });
          if (basis !== 'plain')
            Object.assign(a, {
              rotation: 25,
              transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
              pivot: { x: -20, y: 80 },
            });
        }
    });
    f.state.pick = { ...f.state.pick, shapeId: 'second', waypointIndex: 1, role: 'incoming' };
    expect(f.drag.down(at(f))).toBe(true);
    f.drag.up(at(f, 20, 60));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].layers[0].keys).toEqual(f.before.layers[0].keys);
    f.drag.dispose();
  });
for (const action of ['cancel', 'author opt-out', 'zero', 'return'] as const)
  it(`aligned release ${action} restores independently owned numeric prior without publishing`, () => {
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
