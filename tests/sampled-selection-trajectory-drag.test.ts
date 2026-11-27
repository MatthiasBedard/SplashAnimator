import { afterEach, expect, it, vi } from 'vitest';
import { newProject, keyAt, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSampledSelectionContext,
  type SampledSelectionPreview,
} from '../apps/editor/src/sampled-selection-editor';
import {
  createSampledSelectionTrajectoryContext,
  resolveSampledSelectionCubicControl,
  prepareSampledSelectionTrajectories,
  admitSampledSelectionTrajectoryPublication,
  type SampledSelectionTrajectoryEdit,
} from '../apps/editor/src/sampled-selection-trajectory-editor';
import {
  createSampledSelectionTrajectoryDrag,
  type TrajectoryDragState,
} from '../apps/editor/src/sampled-selection-trajectory-drag';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(type: string, x: number, y: number, fields = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    pointerType: 'mouse',
    shiftKey: false,
    ...fields,
  });
}
function fixture() {
  const project = newProject();
  project.duration = 14;
  const ink = (id: string, x: number, y: number, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 12,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  });
  project.layers = ['base', 'extra'].map((id, i) => ({
    id,
    name: id,
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [
      {
        frame: 0,
        shapes: [
          ink('r', 0, i ? 100 : 10),
          ink('b', 20, i ? 100 : 10, ['outer']),
          ink('a', 40, i ? 100 : 10, ['outer']),
          ink('other', 150, i ? 100 : 10),
        ],
      },
      {
        frame: i ? 10 : 8,
        shapes: [
          ink('r', 80, i ? 100 : 10),
          ink('b', 100, i ? 100 : 10, ['outer']),
          ink('a', 120, i ? 100 : 10, ['outer']),
          ink('other', 230, i ? 100 : 10),
        ],
      },
    ],
  }));
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear');
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear');
  const source = {
    project,
    signature: JSON.stringify(project),
    frame: 4,
    revision: 1,
    policy: 0,
    groups: false,
    pick: null,
    children: false,
    prepared: null,
    stamp: 'original',
    blocked: false,
  };
  const view = { origin: { x: 0, y: 0 }, zoom: 1, width: 400, height: 240 };
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const observers: { callback: () => void; connected: boolean }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      item: (typeof observers)[number];
      constructor(callback: () => void) {
        this.item = { callback, connected: false };
        observers.push(this.item);
      }
      observe() {
        this.item.connected = true;
      }
      disconnect() {
        this.item.connected = false;
      }
    },
  );
  const captures = new Set<number>(),
    events: string[] = [];
  const nativeCanvas = new EventTarget();
  const canvas = Object.assign(nativeCanvas, {
    rect: { left: 10, top: 20, width: 400, height: 240 },
    getBoundingClientRect() {
      return this.rect;
    },
    focus() {},
    hasPointerCapture: (id: number) => captures.has(id),
    setPointerCapture(id: number) {
      captures.add(id);
      events.push('capture');
    },
    releasePointerCapture(id: number) {
      captures.delete(id);
      events.push('release');
      nativeCanvas.dispatchEvent(pointer('lostpointercapture', 0, 0, { pointerId: id }));
    },
  });
  const sample = vi.fn((candidate: typeof project) => {
    events.push('sample:' + captures.size);
    return {
      scene: candidate.layers.map((l) => ({ layerId: l.id, key: keyAt(l, 4), sampled: true })),
      rendered: candidate.layers.flatMap((l) => keyAt(l, 4).shapes),
    };
  });
  const displayContext = createSampledSelectionContext(
    () => source,
    (p) => structuredClone(p),
    sample,
  )!;
  const context = createSampledSelectionTrajectoryContext(
    () => source,
    (p) => structuredClone(p),
    sample,
  )!;
  const state: TrajectoryDragState = {
    context,
    displayContext,
    requests: ['base', 'extra'].flatMap((layerId) =>
      ['r', 'b', 'other'].map((shapeId) => ({ layerId, shapeId })),
    ),
    revision: 0,
    policy: 0,
    enabled: true,
    layerId: 'base',
    role: 'start',
    controls: [
      { layerId: 'base', startX: 0, startY: 0, endX: 0, endY: 0 },
      { layerId: 'extra', startX: 5, startY: 10, endX: 0, endY: 0 },
    ],
    preview: null,
  };
  const frames = new Map<number, () => void>(),
    callbacks: (() => void)[] = [];
  let next = 0,
    active = false;
  const error = vi.fn();
  let publicationHook: (() => void) | undefined;
  const published: SampledSelectionTrajectoryEdit[] = [];
  const publish = vi.fn((edit: SampledSelectionTrajectoryEdit, finalAdmission: () => void) => {
    events.push('publish:' + captures.size);
    admitSampledSelectionTrajectoryPublication(edit);
    publicationHook?.();
    finalAdmission();
    published.push(edit);
  });
  const control = createSampledSelectionTrajectoryDrag({
    canvas: canvas as unknown as HTMLCanvasElement,
    view: () => view,
    state: () => state,
    draft: (values) => {
      state.controls = values;
    },
    preview: (value) => {
      state.preview = value;
    },
    active: (value) => {
      active = value;
    },
    error,
    publish,
    requestFrame: (callback) => {
      const id = ++next;
      callbacks.push(callback);
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  const screen = (x: number, y: number) => ({
    x: canvas.rect.left + ((x * view.zoom + view.origin.x) * canvas.rect.width) / view.width,
    y: canvas.rect.top + ((y * view.zoom + view.origin.y) * canvas.rect.height) / view.height,
  });
  const originalPoint = resolveSampledSelectionCubicControl(
    context,
    state.requests,
    state.layerId,
    state.role,
    () => {},
  ).point;
  const dispatch = (type: string, dx = 0, dy = 0, fields = {}) => {
    const start = screen(originalPoint.x, originalPoint.y);
    canvas.dispatchEvent(pointer(type, start.x + dx, start.y + dy, fields));
  };
  const flush = () => {
    const work = [...frames.values()];
    frames.clear();
    work.forEach((cb) => cb());
  };
  return {
    source,
    project,
    context,
    view,
    win,
    canvas,
    captures,
    observers,
    events,
    state,
    frames,
    callbacks,
    sample,
    error,
    control,
    screen,
    dispatch,
    flush,
    active: () => active,
    published,
    publish,
    onPublication: (hook: () => void) => (publicationHook = hook),
  };
}

it('coalesces complete-route poses and freshly prepares only after native cleanup', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.dispatch('pointermove', 10, 6);
  f.dispatch('pointermove', 20, 8);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointermove', 25, 9);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointerup', 30, 12);
  expect(f.frames.size).toBe(0);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.captures.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect(f.state.controls[0]).toMatchObject({ startX: 30, startY: 12 });
  expect(f.state.controls[1]).toEqual({
    layerId: 'extra',
    startX: 5,
    startY: 10,
    endX: 0,
    endY: 0,
  });
  expect(f.project).toEqual(before);
  const candidate = f.sample.mock.calls.at(-1)![0];
  for (const layer of candidate.layers) expect(layer.motionSpans).toHaveLength(1);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.callbacks.forEach((cb) => cb());
  expect(f.sample).toHaveBeenCalledTimes(2);
  f.control.dispose();
});
it('freezes click offsets and maps independent CSS scales/Shift in document space', () => {
  const f = fixture();
  f.canvas.rect.width = 800;
  f.canvas.rect.height = 120;
  f.view.origin = { x: 17, y: 29 };
  f.view.zoom = 2;
  const p = f.screen(0, 10);
  f.canvas.dispatchEvent(pointer('pointerdown', p.x + 3, p.y + 2));
  f.canvas.dispatchEvent(pointer('pointermove', p.x + 43, p.y + 14, { shiftKey: true }));
  expect(f.state.controls[0]).toMatchObject({ startX: 0, startY: 12 });
  f.canvas.dispatchEvent(pointer('pointerup', p.x + 43, p.y + 14, { shiftKey: true }));
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
for (const reason of [
  'escape',
  'pointercancel',
  'lost',
  'blur',
  'canvas-blur',
  'resize',
  'scroll',
] as const)
  it('restores valid independent numeric drafts/proposals after ' + reason, () => {
    const f = fixture(),
      prior = f.state.controls;
    const proposal: SampledSelectionPreview = {
      context: f.state.displayContext,
      owner: {} as never,
      pose: { scene: [], rendered: [] },
      validate() {
        if (f.state.controls !== prior) throw Error('prior inputs');
      },
      discard() {},
    };
    f.state.preview = proposal;
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 12, 6);
    f.flush();
    if (reason === 'escape')
      f.win.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
      );
    else if (reason === 'pointercancel') f.dispatch('pointercancel');
    else if (reason === 'lost') f.canvas.releasePointerCapture(1);
    else if (reason === 'canvas-blur') f.canvas.dispatchEvent(new Event('blur'));
    else f.win.dispatchEvent(new Event(reason));
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.state.controls).toBe(prior);
    expect(f.state.preview).toBe(proposal);
    f.control.dispose();
  });
for (const phase of ['active', 'release'] as const)
  for (const field of [
    'policy',
    'revision',
    'context',
    'requests',
    'controls',
    'role',
    'layerId',
    'enabled',
    'view',
  ] as const)
    it('rejects ' + phase + ' stale ' + field, () => {
      const f = fixture();
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 12, 6);
      if (field === 'policy' || field === 'revision') f.state[field]++;
      else if (field === 'context') f.state.context = { ...f.state.context };
      else if (field === 'requests') f.state.requests = [...f.state.requests];
      else if (field === 'controls')
        f.state.controls = f.state.controls.map((c) => ({ ...c, startY: 77 }));
      else if (field === 'role') f.state.role = 'end';
      else if (field === 'layerId') f.state.layerId = 'extra';
      else if (field === 'enabled') f.state.enabled = false;
      else f.canvas.rect.left++;
      const values = f.state.controls;
      f.dispatch(phase === 'release' ? 'pointerup' : 'pointermove', 20, 8);
      expect(f.captures.size).toBe(0);
      expect(f.state.preview).toBeNull();
      if (field === 'controls') expect(f.state.controls).toBe(values);
      f.control.dispose();
    });
for (const phase of ['capture', 'move', 'release'] as const)
  it('rejects actual source edits at ' + phase, () => {
    const f = fixture(),
      before = structuredClone(f.project);
    if (phase !== 'capture') {
      f.dispatch('pointerdown');
      if (phase === 'release') f.dispatch('pointermove', 12, 6);
    }
    f.project.name = 'User edit';
    f.dispatch(
      phase === 'capture' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup',
      14,
      7,
    );
    expect(f.captures.size).toBe(0);
    expect(f.state.preview).toBeNull();
    expect(f.project.layers).toEqual(before.layers);
    f.control.dispose();
  });
for (const mode of ['zero', 'return'])
  it('keeps ' + mode + ' travel history-free and restores prior fields', () => {
    const f = fixture(),
      prior = f.state.controls;
    f.dispatch('pointerdown');
    if (mode === 'return') {
      f.dispatch('pointermove', 12, 6);
      f.flush();
    }
    f.dispatch('pointerup');
    expect(f.state.controls).toBe(prior);
    expect(f.state.preview).toBeNull();
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
it('does not let public hint coordinates or proposed markers own picks', () => {
  const f = fixture(),
    hint = resolveSampledSelectionCubicControl(
      f.context,
      f.state.requests,
      'base',
      'start',
      () => {},
    );
  hint.point = { x: 100, y: 50 };
  f.canvas.dispatchEvent(
    pointer('pointerdown', ...(Object.values(f.screen(100, 50)) as [number, number])),
  );
  expect(f.captures.size).toBe(0);
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.control.cancel();
  f.control.dispose();
});
it('keeps unchanged additional tracks rejected rather than silently rewriting them', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.state.controls = f.state.controls.map((c) => ({ ...c, startX: 0, startY: 0 }));
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 12, 6);
  expect(f.captures.size).toBe(0);
  expect(f.state.preview).toBeNull();
  expect(f.error).toHaveBeenCalled();
  expect(f.project).toEqual(before);
  f.control.dispose();
});
it('ignores foreign pointers, touch and nonprimary entry', () => {
  const f = fixture();
  for (const fields of [{ pointerType: 'touch' }, { isPrimary: false }, { button: 1 }])
    f.dispatch('pointerdown', 0, 0, fields);
  expect(f.captures.size).toBe(0);
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 12, 6, { pointerId: 99 });
  expect(f.captures.size).toBe(1);
  f.control.cancel();
  f.control.dispose();
});
it('clears only policy-owned proposals while retaining independent numeric previews', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 12, 6);
  expect(f.state.preview).not.toBeNull();
  f.state.policy++;
  expect(() => f.state.preview!.validate()).toThrow();
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  f.control.dispose();
});
it('private geometry retains canonical document origins for either role', () => {
  const f = fixture();
  for (const [role, anchor] of [
    ['start', { x: 0, y: 10 }],
    ['end', { x: 80, y: 10 }],
  ] as const) {
    const h = resolveSampledSelectionCubicControl(
      f.context,
      f.state.requests,
      'base',
      role,
      () => {},
    );
    expect(h.anchor).toEqual(anchor);
    expect(h.point).toEqual(anchor);
    expect(h.shapeId).toBe('r');
    expect(h.requests).toEqual(f.state.requests);
    h.anchor.x = 999;
    expect(
      resolveSampledSelectionCubicControl(f.context, f.state.requests, 'base', role, () => {})
        .anchor,
    ).toEqual(anchor);
  }
  f.control.dispose();
});

for (const layerId of ['base', 'extra'])
  it(
    'edits the original closing control for ' + layerId + ' without rewriting other fields',
    () => {
      const f = fixture();
      f.state.layerId = layerId;
      f.state.role = 'end';
      f.state.controls = f.state.controls.map((c) => ({ ...c, startX: 8, startY: 5 }));
      const before = f.state.controls,
        point = resolveSampledSelectionCubicControl(
          f.context,
          f.state.requests,
          layerId,
          'end',
          () => {},
        ).point,
        start = f.screen(point.x, point.y);
      f.canvas.dispatchEvent(pointer('pointerdown', start.x, start.y));
      f.canvas.dispatchEvent(pointer('pointerup', start.x + 17, start.y - 6));
      expect(f.error).not.toHaveBeenCalled();
      expect(f.state.controls.find((c) => c.layerId === layerId)).toMatchObject({
        startX: 8,
        startY: 5,
        endX: 17,
        endY: -6,
      });
      expect(f.state.controls.find((c) => c.layerId !== layerId)).toEqual(
        before.find((c) => c.layerId !== layerId),
      );
      expect(f.state.preview).not.toBeNull();
      f.control.dispose();
    },
  );
for (const kind of ['unselected', 'locked', 'transparent'])
  it('admits only the original foreground at a control: ' + kind, () => {
    const f = fixture();
    f.control.dispose();
    const front = {
      ...structuredClone(f.project.layers[0]),
      id: 'front',
      locked: kind === 'locked',
      motionSpans: undefined,
      keys: [
        {
          frame: 0,
          shapes: [
            {
              ...f.project.layers[0].keys[0].shapes[0],
              id: 'front',
              ...(kind === 'transparent' ? { opacity: 0 } : {}),
            },
          ],
        },
      ],
    };
    f.project.layers.push(front);
    f.source.signature = JSON.stringify(f.project);
    const context = createSampledSelectionTrajectoryContext(
      () => f.source,
      (p) => structuredClone(p),
      f.sample,
    )!;
    const data = resolveSampledSelectionCubicControl(
      context,
      f.state.requests,
      'base',
      'start',
      () => {},
      { x: 0, y: 10 },
    );
    expect(data.available).toBe(kind === 'transparent');
  });
it('snapshots original unit identity getters only once during private pointer admission', () => {
  const f = fixture();
  let layers = 0,
    ids = 0;
  f.state.requests = f.state.requests.map((r) => ({
    get layerId() {
      layers++;
      return r.layerId;
    },
    get shapeId() {
      ids++;
      return r.shapeId;
    },
  }));
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  expect([layers, ids]).toEqual([6, 6]);
  f.control.cancel();
  f.control.dispose();
});
for (const action of ['policy', 'restored-policy', 'target'])
  it('rejects initial clone-time ' + action + ' and allows a fresh capture', () => {
    const f = fixture(),
      native = structuredClone;
    let once = true;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if (once && (value as { layers?: unknown }).layers) {
        once = false;
        if (action === 'target') {
          f.state.revision++;
          f.state.controls = f.state.controls.map((c) => ({ ...c, startY: 44 }));
        } else {
          f.state.policy++;
          if (action === 'restored-policy') {
            f.state.enabled = false;
            f.state.enabled = true;
            f.state.policy++;
          }
        }
      }
      return out;
    });
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(once).toBe(false);
    vi.stubGlobal('structuredClone', native);
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(1);
    f.dispatch('pointerup', 8, 4);
    expect(f.state.preview).not.toBeNull();
    f.control.dispose();
  });
it('rejects derived overflow atomically while keeping all original artwork', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  f.dispatch('pointerup', Number.MAX_VALUE, 1);
  expect(f.error).toHaveBeenCalled();
  expect(f.captures.size).toBe(0);
  expect(f.project).toEqual(before);
  expect(f.state.preview).toBeNull();
  f.control.dispose();
});
for (const field of ['policy', 'revision'] as const)
  for (const value of [NaN, Infinity, -1])
    it('rejects invalid ' + field + '/' + value + ' before native capture', () => {
      const f = fixture();
      f.state[field] = value;
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(0);
      expect(f.error).toHaveBeenCalled();
      f.control.dispose();
    });

it('defers numeric preview restoration until a canceled private preparation has unwound', () => {
  const f = fixture();
  f.state.controls = f.state.controls.map((c) => ({ ...c, startX: 17, startY: 20 }));
  const prior = f.state.controls,
    edit = prepareSampledSelectionTrajectories(f.context, f.state.requests, prior, () => {}),
    preview: SampledSelectionPreview = {
      context: f.state.displayContext,
      owner: edit.owner,
      pose: { scene: [], rendered: [] },
      validate: edit.validate,
      discard() {},
    };
  f.state.preview = preview;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 12, 6);
  const native = structuredClone;
  let once = true;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value);
    if (once && (value as { layers?: unknown }).layers) {
      once = false;
      f.canvas.releasePointerCapture(1);
    }
    return out;
  });
  f.flush();
  vi.stubGlobal('structuredClone', native);
  expect(once).toBe(false);
  expect(f.captures.size).toBe(0);
  expect(f.state.controls).toBe(prior);
  expect(f.state.preview).toBe(preview);
  expect(() => f.context.validate()).not.toThrow();
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.control.cancel();
  f.control.dispose();
});

it('snapshots every raw numeric control field once before native capture', () => {
  const f = fixture(),
    reads: Record<string, number> = {};
  f.state.controls = f.state.controls.map(
    (c) => Object.fromEntries(Object.entries(c).map(([key, value]) => [key, value])) as typeof c,
  );
  f.state.controls = f.state.controls.map((c) => {
    const raw = {} as typeof c;
    for (const key of ['layerId', 'startX', 'startY', 'endX', 'endY'] as const)
      Object.defineProperty(raw, key, {
        enumerable: true,
        get() {
          reads[key] = (reads[key] ?? 0) + 1;
          return c[key];
        },
      });
    return raw;
  });
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  expect(reads).toEqual({ layerId: 2, startX: 2, startY: 2, endX: 2, endY: 2 });
  f.control.cancel();
  f.control.dispose();
});
it('rejects extra control data rather than silently discarding it', () => {
  const f = fixture();
  f.state.controls = f.state.controls.map((c) => ({ ...c, waypoints: [{ x: 1, y: 2 }] }));
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  expect(f.error).toHaveBeenCalled();
  f.control.dispose();
});

for (const role of ['start', 'end'] as const)
  for (const layerId of ['base', 'extra'])
    it('authors one freshly admitted complete route after cleanup ' + layerId + '/' + role, () => {
      const f = fixture(),
        before = structuredClone(f.project);
      f.state.authoring = true;
      f.state.authorPolicy = 0;
      f.state.role = role;
      f.state.layerId = layerId;
      if (layerId === 'extra')
        f.state.controls = f.state.controls.map((c) =>
          c.layerId === 'base' ? { ...c, startX: 5 } : c,
        );
      const point = resolveSampledSelectionCubicControl(
          f.context,
          f.state.requests,
          layerId,
          role,
          () => {},
        ).point,
        p = f.screen(point.x, point.y);
      f.canvas.dispatchEvent(pointer('pointerdown', p.x, p.y));
      expect(f.captures.size).toBe(1);
      f.canvas.dispatchEvent(pointer('pointerup', p.x + 18, p.y + 9));
      expect(f.captures.size).toBe(0);
      expect(f.published).toHaveLength(1);
      expect(f.events).toContain('publish:0');
      expect(f.state.preview).toBeNull();
      expect(f.project).toEqual(before);
      expect(f.published[0].candidate.layers.every((l) => l.motionSpans?.length === 1)).toBe(true);
      f.control.dispose();
    });
for (const phase of ['capture', 'movement', 'release', 'publication'] as const)
  for (const action of ['author', 'restored-author', 'restored-gesture'])
    it('rejects ' + phase + ' ' + action + ' and allows a fresh history-free retry', () => {
      const f = fixture();
      f.state.authoring = true;
      f.state.authorPolicy = 0;
      const change = () => {
        if (action === 'author') {
          f.state.authoring = false;
          f.state.authorPolicy!++;
        } else if (action === 'restored-author') {
          f.state.authoring = false;
          f.state.authorPolicy!++;
          f.state.authoring = true;
          f.state.authorPolicy!++;
        } else f.state.policy += 2;
      };
      if (phase === 'publication') {
        f.dispatch('pointerdown');
        f.onPublication(change);
        f.dispatch('pointerup', 18, 9);
      } else if (phase === 'capture') {
        const clone = structuredClone;
        let used = false;
        vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
          const out = clone(value);
          if (!used) {
            used = true;
            change();
          }
          return out;
        }) as typeof structuredClone);
        f.dispatch('pointerdown');
        vi.restoreAllMocks();
        expect(used).toBe(true);
      } else {
        f.dispatch('pointerdown');
        change();
        f.dispatch(phase === 'movement' ? 'pointermove' : 'pointerup', 18, 9);
      }
      expect(f.published).toHaveLength(0);
      expect(f.captures.size).toBe(0);
      f.state.authoring = false;
      f.state.authorPolicy!++;
      f.onPublication(() => {});
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 17, 8);
      expect(f.state.preview).not.toBeNull();
      expect(f.published).toHaveLength(0);
      f.control.dispose();
    });
for (const action of ['source', 'target', 'view', 'cancel', 'output'])
  it('rejects final complete edited publication ' + action, () => {
    const f = fixture();
    f.state.authoring = true;
    f.state.authorPolicy = 0;
    f.onPublication(() => {
      if (action === 'source') f.project.name = 'Late edit';
      else if (action === 'target') f.state.revision++;
      else if (action === 'view') f.canvas.rect.left++;
      else if (action === 'cancel') f.control.cancel();
      else {
        const candidate = f.sample.mock.calls.at(-1)![0];
        candidate.layers[0].keys[4].shapes[0].x++;
      }
    });
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 18, 9);
    expect(f.published).toHaveLength(0);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
for (const value of [NaN, Infinity, -1, undefined])
  it('rejects opted-in invalid authoring revision ' + value, () => {
    const f = fixture();
    f.state.authoring = true;
    f.state.authorPolicy = value;
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.published).toHaveLength(0);
    f.control.dispose();
  });
for (const mode of ['zero', 'return'])
  it('keeps opted-in ' + mode + ' travel history-free', () => {
    const f = fixture();
    f.state.authoring = true;
    f.state.authorPolicy = 0;
    f.dispatch('pointerdown');
    if (mode === 'return') {
      f.dispatch('pointermove', 18, 9);
      f.flush();
    }
    f.dispatch('pointerup');
    expect(f.published).toHaveLength(0);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });

for (const field of ['validate', 'candidate'] as const)
  it('retains private final release authority after public ' + field + ' replacement', () => {
    const f = fixture();
    f.state.authoring = true;
    f.state.authorPolicy = 0;
    f.onPublication(() => {
      const edit = f.publish.mock.calls.at(-1)![0];
      if (field === 'validate') edit.validate = () => {};
      else Object.defineProperty(edit, 'candidate', { get: () => edit.snapshot });
    });
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 18, 9);
    expect(f.published).toHaveLength(0);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
