import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  keyAt,
  symbolLayers,
  validateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  admitSymbolSampledSelectionPublication,
  createSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionRotation,
  type SymbolSampledSelectionPreview,
} from '../apps/editor/src/symbol-sampled-selection-editor';
import {
  createSymbolSampledSelectionRotationDrag,
  type SymbolSelectionRotationDragState,
} from '../apps/editor/src/symbol-sampled-selection-rotation-drag';
import {
  sampledSelectionRotationHandle,
  rotationLocal,
} from '../apps/editor/src/sampled-rotation-handle';

afterEach(() => vi.unstubAllGlobals());
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
function fixture(shared?: { x: number; y: number }) {
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
  project.layers = ['@base', 'extra'].map((id, i) => ({
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
  if (shared)
    for (const layer of project.layers)
      for (const key of layer.keys)
        for (const s of key.shapes) s.pivot = { x: shared.x - s.x, y: shared.y - s.y };
  for (const layer of project.layers)
    createBasicMotionSpan(
      project,
      [layer.id],
      0,
      layer.id === '@base' ? 8 : 10,
      'linear',
      { affine: true, ...(shared ? { pivots: true } : {}) },
      undefined,
      {
        direction: 'shortest',
        turns: 0,
        rigidGroups: true,
        axisGroupScale: true,
        axisGroupShear: true,
      },
    );
  const base = project.layers[0];
  const definition: SymbolDefinition = {
    id: 'sprite',
    name: 'Sprite',
    width: 400,
    height: 240,
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: [project.layers[1]],
    },
  };
  const source = {
    definition,
    symbols: [definition],
    assets: project.assets,
    frame: 4,
    revision: 1,
    policy: 0,
    groups: false,
    pick: null,
    prepared: null,
    blocked: false,
  };
  let enclosing = true,
    candidateAllowed = true;
  const validateEnclosing = vi.fn(() => {
    if (!enclosing) throw Error('enclosing changed');
  });
  const validateCandidate = vi.fn((candidate: SymbolDefinition) => {
    if (!candidateAllowed) throw Error('candidate rejected');
    validateProject({
      ...project,
      layers: symbolLayers(candidate),
      symbols: source.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
      assets: source.assets,
    });
  });
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
  const sample = vi.fn((candidate: SymbolDefinition) => {
    events.push('sample:' + captures.size);
    return {
      scene: symbolLayers(candidate).map((l) => ({
        layerId: l.id,
        key: keyAt(l, 4),
        sampled: true,
      })),
      symbols: source.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
    };
  });
  const context = createSymbolSampledSelectionContext(
    () => source,
    validateEnclosing,
    validateCandidate,
    sample,
  )!;
  const state: SymbolSelectionRotationDragState = {
    context,
    requests: [
      { layerId: '@base', shapeId: 'r' },
      { layerId: 'extra', shapeId: 'a' },
    ],
    revision: 0,
    policy: 0,
    enabled: true,
    degrees: 0,
    preview: null,
  };
  const frames = new Map<number, () => void>(),
    callbacks: (() => void)[] = [];
  let next = 0,
    active = false,
    depth = 0;
  const published: SymbolDefinition[] = [];
  const publish = vi.fn((edit: Parameters<typeof admitSymbolSampledSelectionPublication>[0]) => {
    admitSymbolSampledSelectionPublication(edit);
    structuredClone(project);
    edit.validate();
    published.push(edit.candidate);
  });
  const error = vi.fn();
  const control = createSymbolSampledSelectionRotationDrag({
    canvas: canvas as unknown as HTMLCanvasElement,
    view: () => view,
    state: () => state,
    draft: (degrees) => {
      state.degrees = degrees;
    },
    preview: (value) => {
      state.preview = value;
    },
    active: (value) => {
      active = value;
    },
    error,
    publish,
    preparing: (value) => {
      depth += value ? 1 : -1;
    },
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
  const pivot = shared ?? { x: 62, y: 61 },
    offset = { x: 0, y: 0 };
  const start = () => {
    const v = { ...view, cssWidth: canvas.rect.width, cssHeight: canvas.rect.height },
      h = sampledSelectionRotationHandle(pivot, v);
    return rotationLocal({ x: h.knob.x + offset.x, y: h.knob.y + offset.y }, v);
  };
  const dispatch = (type: string, degrees = 0, fields = {}) => {
    const base = start(),
      r = (degrees * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r),
      x = base.x - pivot.x,
      y = base.y - pivot.y,
      p = screen(pivot.x + c * x - s * y, pivot.y + s * x + c * y);
    canvas.dispatchEvent(pointer(type, p.x, p.y, fields));
  };
  const flush = () => {
    const work = [...frames.values()];
    frames.clear();
    work.forEach((cb) => cb());
  };
  return {
    source,
    project,
    definition,
    validateCandidate,
    validateEnclosing,
    rejectEnclosing: () => {
      enclosing = false;
    },
    rejectCandidate: () => {
      candidateAllowed = false;
    },
    depth: () => depth,
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
    published,
    publish,
    screen,
    dispatch,
    flush,
    pivot,
    offset,
    start,
    active: () => active,
  };
}

it('prepares one latest original rotation with actual resources and release cleanup before fresh sampling', () => {
  const f = fixture(),
    before = structuredClone(f.source);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 15);
  f.dispatch('pointermove', 45);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  expect(f.state.preview!.owner.tracks.map((t) => t.shapeIds)).toEqual([['r'], ['b', 'a']]);
  f.dispatch('pointermove', 60);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointerup', 90);
  expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events.at(-1)).toBe('sample:0');
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect(f.depth()).toBe(0);
  const primary = f.state.preview!.pose.scene[0].key.shapes.find((s) => s.id === 'r')!;
  expect(primary.x).toBeCloseTo(113, 9);
  expect(primary.y).toBeCloseTo(39, 9);
  expect(primary.rotation).toBeCloseTo(90, 9);
  expect(f.source).toEqual(before);
  expect(f.publish).not.toHaveBeenCalled();
  f.control.dispose();
});
it('preserves independent CSS scales, contact offsets, numeric angle and Shift delta snapping', () => {
  const f = fixture();
  f.canvas.rect.width = 200;
  f.canvas.rect.height = 480;
  f.offset.x = 3;
  f.offset.y = 2;
  f.state.degrees = 7;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 39, { shiftKey: true });
  f.flush();
  expect(f.state.degrees).toBeCloseTo(52, 9);
  f.dispatch('pointerup', 39, { shiftKey: true });
  expect(f.state.degrees).toBeCloseTo(52, 9);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('retains native coalesced revolutions with one pending pose', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const b = f.start(),
    p = f.pivot;
  const samples = [90, 180, 270, 360].map((degrees) => {
    const r = (degrees * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r),
      at = f.screen(
        p.x + c * (b.x - p.x) - s * (b.y - p.y),
        p.y + s * (b.x - p.x) + c * (b.y - p.y),
      );
    return pointer('pointermove', at.x, at.y);
  });
  f.dispatch('pointermove', 450, { getCoalescedEvents: () => samples });
  expect(f.frames.size).toBe(1);
  expect(f.state.degrees).toBeCloseTo(450, 9);
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  f.dispatch('pointerup', 450);
  expect(f.state.degrees).toBeCloseTo(450, 9);
  f.control.dispose();
});
for (const reason of ['escape', 'pointercancel', 'lost', 'blur', 'scroll', 'view', 'policy'])
  it('defers valid prior restoration after ' + reason, async () => {
    const f = fixture();
    f.state.degrees = 20;
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 20);
    const prior = f.state.preview;
    expect(prior).not.toBeNull();
    const before = f.state.degrees;
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 30);
    f.flush();
    if (reason === 'escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    if (reason === 'pointercancel') f.dispatch('pointercancel', 30);
    if (reason === 'lost') f.canvas.releasePointerCapture(1);
    if (reason === 'blur') f.win.dispatchEvent(new Event('blur'));
    if (reason === 'scroll') f.win.dispatchEvent(new Event('scroll'));
    if (reason === 'view') {
      f.canvas.rect.width++;
      f.control.checkView();
    }
    if (reason === 'policy') {
      f.state.policy += 2;
      f.control.policyChanged();
    }
    expect(f.captures.size).toBe(0);
    expect(f.depth()).toBeGreaterThan(0);
    await Promise.resolve();
    expect(f.depth()).toBe(0);
    // A gesture-owned previous proposal is invalid after a policy change.
    if (reason === 'policy') expect(f.state.preview).toBeNull();
    else expect(f.state.preview).toBe(prior);
    expect(f.state.degrees).toBe(before);
    f.control.dispose();
  });
for (const reason of ['zero', 'return', 'full'])
  it('keeps ' + reason + ' rotation history-free', async () => {
    const f = fixture();
    f.dispatch('pointerdown');
    if (reason === 'return') f.dispatch('pointermove', 45);
    if (reason === 'full') for (const a of [90, 180, 270]) f.dispatch('pointermove', a);
    f.dispatch('pointerup', reason === 'full' ? 360 : 0);
    await Promise.resolve();
    expect(f.state.preview).toBeNull();
    expect(f.state.degrees).toBe(0);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.depth()).toBe(0);
    f.control.dispose();
  });
for (const reason of [
  'source',
  'enclosing',
  'library',
  'assets',
  'input',
  'policy',
  'view',
  'candidate',
])
  it('rejects late ' + reason + ' without overwriting isolated history', async () => {
    const f = fixture();
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 45);
    if (reason === 'source') f.definition.shapes[0].fill = '#00ff00';
    if (reason === 'enclosing') f.rejectEnclosing();
    if (reason === 'library') f.source.symbols = [...f.source.symbols];
    if (reason === 'assets') f.source.assets = [...f.source.assets];
    if (reason === 'input') {
      f.state.degrees = 123;
      f.state.revision++;
    }
    if (reason === 'policy') f.state.policy += 2;
    if (reason === 'view') f.canvas.rect.left++;
    if (reason === 'candidate') f.rejectCandidate();
    f.flush();
    await Promise.resolve();
    expect(f.captures.size).toBe(0);
    expect(f.state.preview).toBeNull();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.depth()).toBe(0);
    if (reason === 'input') expect(f.state.degrees).toBe(123);
    f.control.dispose();
  });
for (const kind of ['input', 'policy', 'source'])
  it('rejects ' + kind + ' during completed detached sampling after cleanup', async () => {
    const f = fixture();
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 45);
    f.sample.mockImplementationOnce((candidate) => {
      expect(f.captures.size).toBe(0);
      expect(f.depth()).toBeGreaterThan(0);
      expect(
        symbolLayers(candidate).map((l) => keyAt(l, 4).shapes.some((s) => s.rotation !== 0)),
      ).toEqual([true, true]);
      if (kind === 'input') {
        f.state.degrees = 123;
        f.state.revision++;
      }
      if (kind === 'policy') f.state.policy += 2;
      if (kind === 'source') f.definition.shapes[0].fill = '#00ff00';
      return {
        scene: symbolLayers(candidate).map((l) => ({
          layerId: l.id,
          key: keyAt(l, 4),
          sampled: true,
        })),
        symbols: [candidate],
      };
    });
    f.dispatch('pointerup', 90);
    await Promise.resolve();
    expect(f.state.preview).toBeNull();
    expect(f.error).toHaveBeenCalled();
    expect(f.depth()).toBe(0);
    expect(f.publish).not.toHaveBeenCalled();
    if (kind === 'input') expect(f.state.degrees).toBe(123);
    f.control.dispose();
  });
it('keeps explicit edits authoritative when cancellation happens inside context.operation', async () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 45);
  f.validateCandidate.mockImplementationOnce(() => {
    f.state.degrees = 77;
    f.state.revision++;
    f.control.cancel();
  });
  f.flush();
  expect(f.depth()).toBeGreaterThan(0);
  await Promise.resolve();
  expect(f.depth()).toBe(0);
  expect(f.state.degrees).toBe(77);
  expect(f.state.preview).toBeNull();
  f.control.dispose();
});
it('does not grab a proposed handle or artwork body', () => {
  const f = fixture();
  f.state.degrees = 90;
  f.dispatch('pointerdown', 90);
  expect(f.captures.size).toBe(0);
  const at = f.screen(45, 16);
  f.canvas.dispatchEvent(pointer('pointerdown', at.x, at.y));
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
for (const fields of [
  { pointerId: 2 },
  { isPrimary: false },
  { pointerType: 'touch' },
  { button: 2 },
])
  it('ignores foreign or unsupported entry ' + JSON.stringify(fields), () => {
    const f = fixture();
    if ('pointerId' in fields) {
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 45, fields);
      expect(f.frames.size).toBe(0);
    } else {
      f.dispatch('pointerdown', 0, fields);
      expect(f.captures.size).toBe(0);
    }
    f.control.dispose();
  });
it('invalidates only gesture-owned proposals on policy changes and allows fresh retries', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 45);
  const old = f.state.preview!;
  f.state.policy += 2;
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  expect(() => old.validate()).toThrow();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 30);
  expect(f.state.preview).not.toBeNull();
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});

for (const phase of ['layout', 'source'])
  for (const kind of ['input', 'policy'])
    it('captures ' + kind + ' before ' + phase + ' admission and permits a fresh retry', () => {
      const f = fixture();
      let armed = true;
      const change = () => {
        if (!armed) return;
        armed = false;
        if (kind === 'input') {
          f.state.degrees = 42;
          f.state.revision += 2;
        } else f.state.policy += 2;
      };
      if (phase === 'layout') {
        const bounds = f.canvas.getBoundingClientRect;
        f.canvas.getBoundingClientRect = function () {
          const out = bounds.call(this);
          change();
          return out;
        };
      } else {
        const read = f.context.source;
        f.context.source = () => {
          const out = read();
          change();
          return out;
        };
      }
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(0);
      expect(f.sample).not.toHaveBeenCalled();
      expect(f.error).toHaveBeenCalled();
      if (kind === 'input') expect(f.state.degrees).toBe(42);
      f.dispatch('pointerdown');
      expect(f.captures.has(1)).toBe(true);
      f.control.dispose();
    });
it('protects immutable angular work against a newer target delivered by a source getter', () => {
  const f = fixture();
  let armed = false;
  const read = f.context.source;
  f.context.source = () => {
    const out = read();
    if (armed) {
      armed = false;
      f.dispatch('pointermove', 60);
    }
    return out;
  };
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 30);
  armed = true;
  f.flush();
  expect(f.state.preview).toBeNull();
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(f.state.degrees).toBeCloseTo(60, 9);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
it('restores an independent numeric preview across a changed gesture policy', async () => {
  const f = fixture();
  const edit = prepareSymbolSampledSelectionRotation(f.context, f.state.requests, 25, () => {});
  f.state.degrees = 25;
  const numeric: SymbolSampledSelectionPreview = {
    context: f.context,
    owner: edit.owner,
    pose: f.context.sample(edit.candidate),
    validate: edit.validate,
    discard: () => {},
  };
  f.state.preview = numeric;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 30);
  f.flush();
  f.state.policy += 2;
  f.control.policyChanged();
  await Promise.resolve();
  expect(f.state.preview).toBe(numeric);
  expect(f.state.degrees).toBe(25);
  expect(() => numeric.validate()).not.toThrow();
  f.control.dispose();
});
it('does not restore disposed or superseded pending cancellation work', async () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 45);
  f.control.cancel();
  f.state.degrees = 77;
  f.state.revision++;
  f.control.dispose();
  await Promise.resolve();
  for (const cb of f.callbacks) cb();
  expect(f.state.degrees).toBe(77);
  expect(f.depth()).toBe(0);
  expect(f.state.preview).toBeNull();
  expect(f.observers.every((o) => !o.connected)).toBe(true);
});
for (const x of [-2000, 2000])
  it('preserves an unclamped saved off-view common pivot ' + x, () => {
    const f = fixture({ x, y: 61 }),
      before = structuredClone(f.source);
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 30);
    f.dispatch('pointerup', 30);
    expect(f.state.preview).not.toBeNull();
    expect(f.state.degrees).toBeCloseTo(30, 8);
    expect(f.source).toEqual(before);
    expect(f.error).not.toHaveBeenCalled();
    f.control.dispose();
  });

for (const kind of ['visible', 'locked', 'transparent', 'hidden'])
  it('keeps original foreground ownership ' + kind, () => {
    const f = fixture(),
      point = f.start();
    f.definition.timeline!.layers!.push({
      id: 'front',
      name: 'Front',
      visible: kind !== 'hidden',
      locked: kind === 'locked',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              id: 'cover',
              kind: 'rectangle',
              x: point.x - 5,
              y: point.y - 5,
              width: 10,
              height: 10,
              rotation: 0,
              fill: '#00ff00',
              stroke: '#000000',
              strokeWidth: 0,
              points: [],
              ...(kind === 'transparent' ? { opacity: 0 } : {}),
            },
          ],
        },
      ],
    });
    f.state.context = createSymbolSampledSelectionContext(
      () => f.source,
      f.validateEnclosing,
      f.validateCandidate,
      f.sample,
    )!;
    f.dispatch('pointerdown');
    expect(f.captures.has(1)).toBe(kind === 'transparent' || kind === 'hidden');
    expect(f.error).not.toHaveBeenCalled();
    f.control.dispose();
  });
it('does not leak observers or replace a newer capture from a request getter', () => {
  const f = fixture(),
    request = f.state.requests[0];
  let armed = true;
  Object.defineProperty(request, 'shapeId', {
    configurable: true,
    get() {
      if (armed) {
        armed = false;
        f.dispatch('pointerdown');
      }
      return 'r';
    },
  });
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  expect(f.observers.filter((o) => o.connected)).toHaveLength(1);
  expect(f.error).not.toHaveBeenCalled();
  f.dispatch('pointerup', 45);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});

it('authors one explicitly opted-in isolated rotation with preparation held through normal local admission', () => {
  const f = fixture(),
    before = structuredClone(f.source);
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  f.publish.mockImplementation((edit) => {
    expect(f.depth()).toBeGreaterThan(0);
    expect(f.captures.size).toBe(0);
    admitSymbolSampledSelectionPublication(edit);
    edit.validate();
    f.published.push(edit.candidate);
  });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 45);
  f.flush();
  expect(f.publish).not.toHaveBeenCalled();
  f.dispatch('pointerup', 90);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.published).toHaveLength(1);
  expect(f.depth()).toBe(0);
  const primary = keyAt(symbolLayers(f.published[0])[0], 4).shapes.find((s) => s.id === 'r')!;
  expect(primary.x).toBeCloseTo(113, 9);
  expect(primary.y).toBeCloseTo(39, 9);
  expect(primary.rotation).toBeCloseTo(90, 9);
  expect(f.source).toEqual(before);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  f.callbacks.forEach((cb) => cb());
  expect(f.published).toHaveLength(1);
  f.control.dispose();
});
for (const phase of ['initial', 'queued', 'release', 'publication'] as const)
  for (const kind of [
    'author',
    'gesture',
    'target',
    'source',
    'view',
    'enclosing',
    'library',
    'assets',
  ] as const)
    it(
      'rejects isolated ' + phase + ' late ' + kind + ' before rotation release history',
      async () => {
        const f = fixture();
        f.state.authoring = true;
        f.state.authorPolicy = 0;
        let armed = true;
        const mutate = () => {
          if (!armed) return;
          armed = false;
          if (kind === 'author') f.state.authorPolicy! += 2;
          else if (kind === 'gesture') f.state.policy += 2;
          else if (kind === 'target') {
            f.state.revision += 2;
            f.state.degrees = 111;
          } else if (kind === 'source') f.definition.shapes[0].fill = '#00ff00';
          else if (kind === 'view') f.canvas.rect.top++;
          else if (kind === 'enclosing') f.rejectEnclosing();
          else if (kind === 'library') f.source.symbols = [...f.source.symbols];
          else f.source.assets = [...f.source.assets];
        };
        if (phase === 'initial') {
          if (kind === 'view') {
            const source = f.context.source;
            f.context.source = () => {
              const out = source();
              mutate();
              return out;
            };
          } else {
            const rect = f.canvas.getBoundingClientRect;
            f.canvas.getBoundingClientRect = () => {
              mutate();
              return rect.call(f.canvas);
            };
          }
          f.dispatch('pointerdown');
        } else {
          f.dispatch('pointerdown');
          if (phase === 'queued') {
            f.dispatch('pointermove', 45);
            mutate();
            f.flush();
          } else if (phase === 'release') {
            f.sample.mockImplementation((candidate) => {
              expect(f.captures.size).toBe(0);
              expect(
                symbolLayers(candidate).every((l) =>
                  keyAt(l, 4).shapes.some((s) => s.rotation !== 0),
                ),
              ).toBe(true);
              mutate();
              return {
                scene: symbolLayers(candidate).map((l) => ({
                  layerId: l.id,
                  key: keyAt(l, 4),
                  sampled: true,
                })),
                symbols: [candidate],
              };
            });
            f.dispatch('pointerup', 90);
          } else {
            f.publish.mockImplementation((edit) => {
              expect(f.depth()).toBeGreaterThan(0);
              admitSymbolSampledSelectionPublication(edit);
              mutate();
              edit.validate();
              f.published.push(edit.candidate);
            });
            f.dispatch('pointerup', 90);
          }
        }
        await Promise.resolve();
        expect(f.published).toHaveLength(0);
        expect(f.captures.size).toBe(0);
        expect(f.depth()).toBe(0);
        expect(f.error).toHaveBeenCalled();
        if (kind === 'target') expect(f.state.degrees).toBe(111);
        f.control.dispose();
      },
    );
it('permits fresh isolated opted-out drafts and restored-authoring capture after settlement', async () => {
  const f = fixture();
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  f.dispatch('pointerdown');
  f.state.authoring = false;
  f.state.authorPolicy++;
  f.control.policyChanged();
  await Promise.resolve();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 45);
  expect(f.state.preview).not.toBeNull();
  expect(f.published).toHaveLength(0);
  f.state.authoring = true;
  f.state.authorPolicy++;
  f.control.policyChanged();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 45);
  expect(f.published).toHaveLength(1);
  expect(f.depth()).toBe(0);
  f.control.dispose();
});

for (const kind of ['author', 'target'])
  it(
    'restores only valid numeric ownership after isolated final rotation ' + kind + ' rejection',
    async () => {
      const f = fixture(),
        edit = prepareSymbolSampledSelectionRotation(f.context, f.state.requests, 25, () => {});
      const prior: SymbolSampledSelectionPreview = {
        context: f.context,
        owner: edit.owner,
        pose: f.context.sample(edit.candidate),
        validate: edit.validate,
        discard: () => {},
      };
      f.state.degrees = 25;
      f.state.preview = prior;
      f.state.authoring = true;
      f.state.authorPolicy = 0;
      f.publish.mockImplementation((release) => {
        admitSymbolSampledSelectionPublication(release);
        if (kind === 'author') f.state.authorPolicy! += 2;
        else {
          f.state.degrees = 111;
          f.state.revision += 2;
        }
        release.validate();
        f.published.push(release.candidate);
      });
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 45);
      f.flush();
      f.dispatch('pointerup', 60);
      await Promise.resolve();
      expect(f.published).toHaveLength(0);
      expect(f.depth()).toBe(0);
      expect(f.captures.size).toBe(0);
      if (kind === 'author') {
        expect(f.state.degrees).toBe(25);
        expect(f.state.preview).toBe(prior);
        expect(() => prior.validate()).not.toThrow();
      } else {
        expect(f.state.degrees).toBe(111);
        expect(f.state.preview).toBeNull();
      }
      f.publish.mockImplementation((release) => {
        admitSymbolSampledSelectionPublication(release);
        release.validate();
        f.published.push(release.candidate);
      });
      f.dispatch('pointerdown');
      f.dispatch('pointerup', 15);
      expect(f.published).toHaveLength(1);
      expect(f.depth()).toBe(0);
      f.control.dispose();
    },
  );
