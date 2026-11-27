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
  type SymbolSampledSelectionPreview,
} from '../apps/editor/src/symbol-sampled-selection-editor';
import {
  createSymbolSampledSelectionScaleDrag,
  type SymbolSelectionScaleDragState,
} from '../apps/editor/src/symbol-sampled-selection-scale-drag';
import { rotationLocal } from '../apps/editor/src/sampled-rotation-handle';
import { sampledSelectionScaleHandles } from '../apps/editor/src/sampled-scale-handles';

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
function fixture(shared?: { x: number; y: number }, clearForeground = false, publisher = true) {
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
  if (clearForeground)
    for (const key of project.layers[0].keys)
      for (const shape of key.shapes) if (['a', 'b'].includes(shape.id)) shape.opacity = 0;
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
  const make = () =>
    createSymbolSampledSelectionContext(
      () => source,
      validateEnclosing,
      validateCandidate,
      sample,
    )!;
  const context = make();
  const state: SymbolSelectionScaleDragState = {
    context,
    requests: [
      { layerId: '@base', shapeId: 'r' },
      { layerId: 'extra', shapeId: 'a' },
    ],
    revision: 0,
    policy: 0,
    enabled: true,
    x: 100,
    y: 100,
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
  const control = createSymbolSampledSelectionScaleDrag({
    canvas: canvas as unknown as HTMLCanvasElement,
    view: () => view,
    state: () => state,
    draft: (x, y) => {
      state.x = x;
      state.y = y;
    },
    preview: (value) => {
      state.preview = value;
    },
    active: (value) => {
      active = value;
    },
    error,
    publish: publisher ? publish : undefined,
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
    offset = { x: 0, y: 0 },
    pick = { handle: 'se' },
    box = { left: 40, top: 10, right: 84, bottom: 112 };
  const layout = () =>
    sampledSelectionScaleHandles(box, pivot, {
      ...view,
      cssWidth: canvas.rect.width,
      cssHeight: canvas.rect.height,
    });
  const start = () => {
    const h = layout().handles.find((h) => h.id === pick.handle)!;
    return rotationLocal(
      { x: h.point.x + offset.x, y: h.point.y + offset.y },
      { ...view, cssWidth: canvas.rect.width, cssHeight: canvas.rect.height },
    );
  };
  const dispatch = (type: string, x = 1, y = 1, fields = {}) => {
    const h = layout().handles.find((h) => h.id === pick.handle)!,
      p = start();
    const at = screen(
      pivot.x + x * (h.anchor.x - pivot.x) + p.x - h.anchor.x,
      pivot.y + y * (h.anchor.y - pivot.y) + p.y - h.anchor.y,
    );
    canvas.dispatchEvent(pointer(type, at.x, at.y, fields));
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
    rejectEnclosing: (value = false) => {
      enclosing = value;
    },
    rejectCandidate: (value = false) => {
      candidateAllowed = value;
    },
    depth: () => depth,
    context,
    make,
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
    box,
    pick,
    layout,
    active: () => active,
  };
}

it('coalesces immutable original scales and freshly prepares history-free release after native cleanup', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 1.2, 0.8);
  f.dispatch('pointermove', 2, 0.5);
  expect([f.state.x, f.state.y]).toEqual([200, 50]);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  const pose = f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'r')!;
  expect(pose).toMatchObject({ x: 18, y: 35.5, transform: [2, 0, 0, 0.5] });
  f.dispatch('pointermove', 1.25, 0.75);
  expect(f.frames.size).toBe(1);
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events.at(-1)).toBe('sample:0');
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect([f.state.x, f.state.y]).toEqual([150, 75]);
  expect(
    f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'r'),
  ).toMatchObject({
    x: 29,
    y: 22.75,
  });
  expect(f.project).toEqual(before);
  expect(f.published).toEqual([]);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
for (const handle of ['nw', 'ne', 'se', 'sw', 'scale-n', 'scale-e', 'scale-s', 'scale-w'])
  it(
    'owns the nearest original corner/edge and preserves single-axis precedence: ' + handle,
    () => {
      const f = fixture(undefined, true);
      for (const key of f.project.layers[0].keys)
        for (const shape of key.shapes)
          if (['a', 'b'].includes(shape.id)) expect(shape.opacity).toBe(0);
      f.pick.handle = handle;
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 2, 0.5, { shiftKey: true });
      const expected =
        handle === 'scale-e' || handle === 'scale-w'
          ? [200, 100]
          : handle.startsWith('scale-')
            ? [100, 50]
            : [200, 200];
      expect([f.state.x, f.state.y]).toEqual(expected);
      expect(f.state.preview).not.toBeNull();
      expect(f.error).not.toHaveBeenCalled();
      f.control.dispose();
    },
  );
it('maps independent CSS scales and pointer offsets from original geometry rather than composing a numeric draft', () => {
  const f = fixture();
  f.view.zoom = 0.5;
  f.view.origin = { x: 100, y: 80 };
  f.canvas.rect.width = 300;
  f.canvas.rect.height = 100;
  f.offset.x = 3;
  f.offset.y = -2;
  f.state.x = 150;
  f.state.y = 80;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  expect([f.state.x, f.state.y]).toEqual([100, 100]);
  f.dispatch('pointerup', 1.25, 0.8);
  expect(f.state.x).toBeCloseTo(125, 10);
  expect(f.state.y).toBeCloseTo(80, 10);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
function prior(f: ReturnType<typeof fixture>) {
  f.state.x = 140;
  f.state.y = 70;
  const preview: SymbolSampledSelectionPreview = {
    context: f.state.context,
    owner: { frame: 4, revision: 1, units: [], tracks: [], definitionId: 'sprite' },
    pose: { scene: [], symbols: f.source.symbols },
    validate: () =>
      f.state.context.operation(() => {
        f.state.context.validate();
        if (f.state.x !== 140 || f.state.y !== 70) throw Error('original numeric preview changed');
      }),
    discard: () => {},
  };
  f.state.preview = preview;
  return preview;
}
for (const kind of [
  'escape',
  'pointercancel',
  'lostpointercapture',
  'blur',
  'window-blur',
  'resize',
  'scroll',
  'observer',
  'cancel',
  'policy',
])
  it('cleans native/queued work and restores valid prior numeric preview: ' + kind, async () => {
    const f = fixture(),
      preview = prior(f);
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 2, 0.5);
    const stale = [...f.callbacks];
    if (kind === 'escape')
      f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    else if (kind === 'window-blur') f.win.dispatchEvent(new Event('blur'));
    else if (kind === 'resize' || kind === 'scroll') f.win.dispatchEvent(new Event(kind));
    else if (kind === 'observer') {
      f.canvas.rect.left++;
      f.observers.at(-1)!.callback();
    } else if (kind === 'cancel') f.control.cancel();
    else if (kind === 'policy') {
      f.state.policy += 2;
      f.control.policyChanged();
    } else f.canvas.dispatchEvent(pointer(kind, 0, 0));
    await Promise.resolve();
    stale.forEach((cb) => cb());
    expect(f.depth()).toBe(0);
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect([f.state.x, f.state.y]).toEqual([140, 70]);
    expect(f.state.preview).toBe(preview);
    expect(f.published).toEqual([]);
    f.control.dispose();
  });
for (const moved of [false, true])
  it('restores zero travel/return without preparing a release split: ' + moved, async () => {
    const f = fixture(),
      preview = prior(f),
      before = structuredClone(f.project);
    f.dispatch('pointerdown');
    if (moved) {
      f.dispatch('pointermove', 2, 0.5);
      f.flush();
    }
    f.dispatch('pointerup');
    await Promise.resolve();
    expect(f.state.preview).toBe(preview);
    expect([f.state.x, f.state.y]).toEqual([140, 70]);
    expect(f.sample).toHaveBeenCalledTimes(moved ? 1 : 0);
    expect(f.project).toEqual(before);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
it('invalidates gesture-owned proposals separately from an independent numeric preview', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 2, 0.5);
  const proposal = f.state.preview!;
  f.state.policy += 2;
  expect(() => proposal.validate()).toThrow();
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  const preview = prior(f);
  f.state.policy++;
  f.control.policyChanged();
  expect(f.state.preview).toBe(preview);
  f.control.dispose();
});
for (const kind of [
  'x',
  'y',
  'revision',
  'requests',
  'policy',
  'context',
  'source',
  'frame',
  'view',
])
  it(
    'rejects movement-time original input/source/view changes without overwriting authoritative edits: ' +
      kind,
    () => {
      const f = fixture();
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 1.5, 0.75);
      if (kind === 'x') {
        f.state.x = 137;
        f.state.revision++;
      } else if (kind === 'y') {
        f.state.y = 83;
        f.state.revision++;
      } else if (kind === 'revision') f.state.revision += 2;
      else if (kind === 'requests') f.state.requests = [...f.state.requests];
      else if (kind === 'policy') f.state.policy += 2;
      else if (kind === 'context') f.state.context = { ...f.state.context };
      else if (kind === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
      else if (kind === 'frame') f.source.frame++;
      else f.view.origin.x++;
      f.dispatch('pointermove', 2, 0.5);
      expect(f.captures.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.state.preview).toBeNull();
      if (kind === 'x') expect(f.state.x).toBe(137);
      if (kind === 'y') expect(f.state.y).toBe(83);
      expect(f.published).toEqual([]);
      f.control.dispose();
    },
  );
for (const finishing of [false, true])
  it('rechecks actual source after complete detached sampling: ' + finishing, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    let complete = false;
    f.sample.mockImplementation((candidate) => {
      complete = symbolLayers(candidate).every((l) => l.motionSpans?.length === 2);
      f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
      return { scene: [], symbols: f.source.symbols };
    });
    f.dispatch(finishing ? 'pointerup' : 'pointermove', 2, 0.5);
    if (!finishing) f.flush();
    expect(complete).toBe(true);
    expect(f.state.preview).toBeNull();
    expect(f.captures.size).toBe(0);
    expect(f.published).toEqual([]);
    expect(f.project.layers[0].motionSpans).toHaveLength(1);
    f.control.dispose();
  });
for (const kind of ['pointer', 'coordinate', 'array'])
  it('rejects malformed coalesced samples atomically: ' + kind, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    const p = f.screen(100, 100),
      sample = pointer(
        'pointermove',
        p.x,
        p.y,
        kind === 'pointer' ? { pointerId: 2 } : kind === 'coordinate' ? { clientX: NaN } : {},
      );
    f.dispatch('pointermove', 2, 0.5, {
      getCoalescedEvents: () => (kind === 'array' ? {} : [sample]),
    });
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.state.preview).toBeNull();
    f.control.dispose();
  });
for (const fields of [{ pointerType: 'touch' }, { isPrimary: false }, { button: 2 }])
  it(
    'leaves ineligible native entries untouched and permits a fresh mouse capture: ' +
      JSON.stringify(fields),
    () => {
      const f = fixture(),
        preview = prior(f),
        before = structuredClone(f.source);
      f.dispatch('pointerdown', 1, 1, fields);
      expect(f.captures.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.depth()).toBe(0);
      expect(f.state.preview).toBe(preview);
      expect([f.state.x, f.state.y]).toEqual([140, 70]);
      expect(f.sample).not.toHaveBeenCalled();
      expect(f.validateCandidate).not.toHaveBeenCalled();
      expect(f.source).toEqual(before);
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 1.5, 0.75);
      expect(f.state.preview).not.toBe(preview);
      expect(f.state.preview).not.toBeNull();
      expect(f.published).toEqual([]);
      expect(f.depth()).toBe(0);
      expect(() => f.context.validate()).not.toThrow();
      f.control.dispose();
    },
  );

it('ignores foreign native pointers and never publishes from retained legacy release preferences', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  Object.assign(f.state, { authoring: true, authorPolicy: 17 });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 2, 0.5, { pointerId: 2 });
  f.dispatch('pointerup', 2, 0.5, { pointerId: 2 });
  expect(f.captures.size).toBe(1);
  expect([f.state.x, f.state.y]).toEqual([100, 100]);
  f.dispatch('pointerup', 2, 0.5);
  expect(f.state.preview).not.toBeNull();
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.published).toEqual([]);
  expect(f.project).toEqual(before);
  f.control.dispose();
});
it('does not capture a distant proposed handle or consume numeric drafts', () => {
  const f = fixture();
  f.state.x = 200;
  f.state.y = 50;
  f.dispatch('pointerdown', 2, 0.5);
  expect(f.captures.size).toBe(0);
  expect([f.state.x, f.state.y]).toEqual([200, 50]);
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
for (const action of ['policy', 'x', 'source', 'view'])
  it('rejects initial admission getter changes and allows source-valid retries: ' + action, () => {
    const f = fixture(),
      read = f.canvas.getBoundingClientRect.bind(f.canvas);
    let armed = true;
    f.canvas.getBoundingClientRect = () => {
      if (armed) {
        armed = false;
        if (action === 'policy') f.state.policy += 2;
        else if (action === 'x') {
          f.state.x = 137;
          f.state.revision++;
        } else if (action === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
        else f.view.origin.x++;
      }
      return read();
    };
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    if (action !== 'source') {
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 1.5, 0.75);
      expect(f.state.preview).not.toBeNull();
    }
    f.control.dispose();
  });
for (const kind of ['opaque', 'locked', 'transparent', 'hidden'])
  it('uses original visible foreground ownership: ' + kind, () => {
    const f = fixture();
    f.definition.timeline!.layers!.push({
      id: 'cover',
      name: 'Cover',
      visible: kind !== 'hidden',
      locked: kind === 'locked',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              id: 'cover',
              kind: 'rectangle',
              x: 80,
              y: 108,
              width: 12,
              height: 12,
              rotation: 0,
              fill: '#000000',
              stroke: '#000000',
              strokeWidth: 0,
              points: [],
              ...(kind === 'transparent' ? { opacity: 0 } : {}),
            },
          ],
        },
      ],
    });
    f.state.context = f.make();
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(kind === 'transparent' || kind === 'hidden' ? 1 : 0);
    f.control.dispose();
  });

for (const handle of ['ne', 'scale-n'])
  it('rejects a naturally overlapping unselected foreground at ' + handle, () => {
    const f = fixture();
    f.pick.handle = handle;
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.error).not.toHaveBeenCalled();
    f.control.dispose();
  });
for (const field of ['policy', 'revision'] as const)
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE])
    it(`rejects an invalid initial ${field} revision ${value} without consuming a retry`, () => {
      const f = fixture();
      f.state[field] = value;
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(0);
      f.state[field] = 0;
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 1.5, 0.75);
      expect(f.state.preview).not.toBeNull();
      f.control.dispose();
    });
it('keeps coalesced native input immutable and validates its latest target before draft writes', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const at = f.screen(100, 100),
    sample = pointer('pointermove', at.x, at.y);
  Object.defineProperty(sample, 'clientX', {
    get() {
      f.state.x = 137;
      f.state.revision++;
      return at.x;
    },
  });
  f.dispatch('pointermove', 2, 0.5, { getCoalescedEvents: () => [sample] });
  expect(f.state.x).toBe(137);
  expect(f.captures.size).toBe(0);
  expect(f.state.preview).toBeNull();
  expect(f.frames.size).toBe(0);
  f.control.dispose();
});
it('does not publish a superseded queued pose or let canceled callbacks affect a fresh capture', async () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 2, 0.5);
  const old = [...f.callbacks];
  f.control.cancel();
  await Promise.resolve();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 1.5, 0.75);
  old.forEach((cb) => cb());
  expect(f.state.preview).toBeNull();
  expect(f.captures.size).toBe(1);
  f.flush();
  expect(f.state.preview).not.toBeNull();
  expect([f.state.x, f.state.y]).toEqual([150, 75]);
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.published).toEqual([]);
  f.control.dispose();
});

it('keeps a newer pointer target delivered while an older raw sample getter runs', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const p = f.screen(100, 100),
    sample = pointer('pointermove', p.x, p.y);
  let armed = true;
  Object.defineProperty(sample, 'clientX', {
    get() {
      if (armed) {
        armed = false;
        f.dispatch('pointermove', 1.25, 0.8);
      }
      return p.x;
    },
  });
  f.dispatch('pointermove', 2, 0.5, { getCoalescedEvents: () => [sample] });
  expect(f.state.x).toBeCloseTo(125, 10);
  expect(f.state.y).toBeCloseTo(80, 10);
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(f.state.preview).not.toBeNull();
  expect(f.captures.size).toBe(1);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('discards an older sampled pose when sampling delivers a newer pointer target', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  let armed = true;
  f.sample.mockImplementation((candidate) => {
    if (armed) {
      armed = false;
      f.dispatch('pointermove', 1.25, 0.8);
    }
    return {
      scene: symbolLayers(candidate).map((l) => ({
        layerId: l.id,
        key: keyAt(l, 4),
        sampled: true,
      })),
      symbols: f.source.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
    };
  });
  f.dispatch('pointermove', 2, 0.5);
  f.flush();
  expect(f.state.preview).toBeNull();
  expect(f.frames.size).toBe(1);
  expect(f.captures.size).toBe(1);
  f.flush();
  expect(
    f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'r')!.x,
  ).toBeCloseTo(34.5, 10);
  expect(f.frames.size).toBe(0);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});

for (const kind of ['enclosing', 'candidate', 'assets', 'library', 'definition-reference'])
  it(
    'retains actual resource/enclosing admission and fresh source-valid retries: ' + kind,
    async () => {
      const f = fixture(),
        before = structuredClone(f.source.definition);
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 1.5, 0.75);
      if (kind === 'enclosing') f.rejectEnclosing();
      else if (kind === 'candidate') f.rejectCandidate();
      else if (kind === 'assets') f.source.assets.push({ id: 'added', path: 'assets/added.bin' });
      else if (kind === 'library')
        f.source.symbols.push({
          id: 'added',
          name: 'Added',
          width: 1,
          height: 1,
          shapes: [{ ...f.definition.shapes[0], id: 'added-art', x: 0, y: 0, width: 1, height: 1 }],
        });
      else f.source.definition = structuredClone(f.source.definition);
      f.flush();
      await Promise.resolve();
      expect(f.captures.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.state.preview).toBeNull();
      expect(f.depth()).toBe(0);
      expect(f.source.definition).toEqual(before);
      expect(f.published).toEqual([]);
      if (kind === 'enclosing') f.rejectEnclosing(true);
      else if (kind === 'candidate') f.rejectCandidate(true);
      else f.state.context = f.make();
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(1);
      f.dispatch('pointerup', 1.5, 0.75);
      expect(f.state.preview).not.toBeNull();
      expect(f.depth()).toBe(0);
      f.control.dispose();
    },
  );

for (const phase of ['candidate', 'sample'])
  it(
    'defers prior operation-owned restoration until cancellation inside ' +
      phase +
      ' admission returns',
    async () => {
      const f = fixture(),
        preview = prior(f),
        validate = f.validateCandidate.getMockImplementation()!;
      let seen = false;
      if (phase === 'candidate')
        f.validateCandidate.mockImplementation((candidate) => {
          validate(candidate);
          seen = true;
          f.control.cancel();
        });
      else
        f.sample.mockImplementation((candidate) => {
          seen = true;
          f.control.cancel();
          return {
            scene: symbolLayers(candidate).map((l) => ({
              layerId: l.id,
              key: keyAt(l, 4),
              sampled: true,
            })),
            symbols: f.source.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
          };
        });
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 2, 0.5);
      f.flush();
      expect(seen).toBe(true);
      expect(f.captures.size).toBe(0);
      expect(f.depth()).toBeGreaterThan(0);
      await Promise.resolve();
      expect(f.depth()).toBe(0);
      expect(f.state.preview).toBe(preview);
      expect([f.state.x, f.state.y]).toEqual([140, 70]);
      expect(() => f.context.validate()).not.toThrow();
      expect(f.published).toEqual([]);
      f.control.dispose();
    },
  );

it('keeps an explicit newer factor authoritative when cancellation happens inside private sampling', async () => {
  const f = fixture();
  prior(f);
  f.dispatch('pointerdown');
  let seen = false;
  f.sample.mockImplementation((candidate) => {
    seen = true;
    f.state.x = 137;
    f.state.revision++;
    f.control.cancel();
    return {
      scene: symbolLayers(candidate).map((l) => ({
        layerId: l.id,
        key: keyAt(l, 4),
        sampled: true,
      })),
      symbols: f.source.symbols,
    };
  });
  f.dispatch('pointermove', 2, 0.5);
  f.flush();
  await Promise.resolve();
  expect(seen).toBe(true);
  expect(f.state.x).toBe(137);
  expect(f.state.preview).toBeNull();
  expect(f.depth()).toBe(0);
  expect(() => f.context.validate()).not.toThrow();
  f.control.dispose();
});

it('suppresses disposed restoration while releasing all preparation locks after a private callback', async () => {
  const f = fixture(),
    before = structuredClone(f.source),
    validate = f.validateCandidate.getMockImplementation()!;
  let seen = false;
  f.validateCandidate.mockImplementation((candidate) => {
    validate(candidate);
    seen = true;
    f.control.dispose();
  });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 2, 0.5);
  f.flush();
  await Promise.resolve();
  f.callbacks.forEach((cb) => cb());
  expect(seen).toBe(true);
  expect(f.depth()).toBe(0);
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.sample).not.toHaveBeenCalled();
  expect(f.source).toEqual(before);
  expect(f.published).toEqual([]);
  expect(() => f.context.validate()).not.toThrow();
});

it('does not allow a fresh capture to overtake deferred restoration but admits it after settlement', async () => {
  const f = fixture();
  prior(f);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 2, 0.5);
  f.control.cancel();
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  await Promise.resolve();
  expect(f.depth()).toBe(0);
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});

it('authors one explicitly opted-in fresh scale after cleanup through normal final admission', () => {
  const f = fixture(),
    before = structuredClone(f.source);
  f.state.scaleAuthoring = true;
  f.state.scaleAuthorPolicy = 0;
  const publish = f.publish.getMockImplementation()!;
  f.publish.mockImplementation((edit) => {
    expect(f.depth()).toBeGreaterThan(0);
    publish(edit);
  });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 1.5, 0.75);
  f.flush();
  expect(f.publish).not.toHaveBeenCalled();
  f.dispatch('pointerup', 2, 0.5);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.published).toHaveLength(1);
  expect(f.depth()).toBe(0);
  const primary = keyAt(symbolLayers(f.published[0])[0], 4).shapes.find((s) => s.id === 'r')!;
  expect(primary).toMatchObject({ x: 18, y: 35.5, transform: [2, 0, 0, 0.5] });
  expect(f.source).toEqual(before);
  expect(f.captures.size).toBe(0);
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
      'rejects isolated ' + phase + ' late ' + kind + ' before scale release history',
      async () => {
        const f = fixture();
        f.state.scaleAuthoring = true;
        f.state.scaleAuthorPolicy = 0;
        let armed = true;
        const mutate = () => {
          if (!armed) return;
          armed = false;
          if (kind === 'author') f.state.scaleAuthorPolicy! += 2;
          else if (kind === 'gesture') f.state.policy += 2;
          else if (kind === 'target') {
            f.state.revision += 2;
            f.state.x = 137;
          } else if (kind === 'source') f.definition.shapes[0].fill = '#00ff00';
          else if (kind === 'view') f.canvas.rect.top++;
          else if (kind === 'enclosing') f.rejectEnclosing();
          else if (kind === 'library') f.source.symbols = [...f.source.symbols];
          else f.source.assets = [...f.source.assets];
        };
        if (phase === 'initial') {
          if (kind === 'view') {
            const snapshot = f.context.source;
            f.context.source = () => {
              const out = snapshot();
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
            f.dispatch('pointermove', 1.5, 0.75);
            mutate();
            f.flush();
          } else if (phase === 'release') {
            f.sample.mockImplementation((candidate) => {
              expect(f.captures.size).toBe(0);
              expect(
                symbolLayers(candidate).every((l) =>
                  keyAt(l, 4).shapes.some((s) => s.transform?.[0] === 2),
                ),
              ).toBe(true);
              mutate();
              return {
                scene: symbolLayers(candidate).map((l) => ({
                  layerId: l.id,
                  key: keyAt(l, 4),
                  sampled: true,
                })),
                symbols: f.source.symbols,
              };
            });
            f.dispatch('pointerup', 2, 0.5);
          } else {
            f.publish.mockImplementation((edit) => {
              admitSymbolSampledSelectionPublication(edit);
              expect(f.captures.size).toBe(0);
              expect(edit.scaling).toEqual({ x: 2, y: 0.5, pivot: { x: 62, y: 61 } });
              mutate();
              edit.validate();
              f.published.push(edit.candidate);
            });
            f.dispatch('pointerup', 2, 0.5);
          }
        }
        await Promise.resolve();
        expect(f.depth()).toBe(0);
        expect(armed).toBe(false);
        expect(f.published).toHaveLength(0);
        expect(f.captures.size).toBe(0);
        expect(f.error).toHaveBeenCalled();
        f.control.dispose();
      },
    );
it('permits fresh opted-out drafts and restored scale authoring after dedicated policy rejection', async () => {
  const f = fixture();
  f.state.scaleAuthoring = true;
  f.state.scaleAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.state.scaleAuthoring = false;
  f.state.scaleAuthorPolicy++;
  f.control.policyChanged();
  await Promise.resolve();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.state.preview).not.toBeNull();
  expect(f.published).toHaveLength(0);
  f.state.scaleAuthoring = true;
  f.state.scaleAuthorPolicy++;
  f.control.policyChanged();
  await Promise.resolve();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.published).toHaveLength(1);
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
for (const value of [undefined, NaN, Infinity, -1, Number.MAX_VALUE, 0.5])
  it('rejects an invalid dedicated authoring revision without consuming a retry: ' + value, () => {
    const f = fixture();
    f.state.scaleAuthoring = true;
    f.state.scaleAuthorPolicy = value;
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.sample).not.toHaveBeenCalled();
    f.state.scaleAuthorPolicy = 0;
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 1.5, 0.75);
    expect(f.published).toHaveLength(1);
    f.control.dispose();
  });
for (const value of [0, 1, 'true', null])
  it('does not coerce a raw scale-authoring preference: ' + value, () => {
    const f = fixture();
    Object.assign(f.state, { scaleAuthoring: value, scaleAuthorPolicy: 0 });
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.published).toHaveLength(0);
    f.control.dispose();
  });
it('rejects an opted-in release without a publisher and restores a valid prior preview', () => {
  const f = fixture(undefined, false, false),
    preview = prior(f);
  f.state.scaleAuthoring = true;
  f.state.scaleAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 1.5, 0.75);
  expect(f.published).toHaveLength(0);
  expect(f.captures.size).toBe(0);
  expect(f.state.preview).toBe(preview);
  expect([f.state.x, f.state.y]).toEqual([140, 70]);
  expect(f.error).toHaveBeenCalled();
  f.control.dispose();
});
for (const moved of [false, true])
  it('never authors an opted-in zero/returned original scale: ' + moved, async () => {
    const f = fixture(),
      preview = prior(f);
    f.state.scaleAuthoring = true;
    f.state.scaleAuthorPolicy = 0;
    f.dispatch('pointerdown');
    if (moved) {
      f.dispatch('pointermove', 1.5, 0.75);
      f.flush();
    }
    f.dispatch('pointerup', 1, 1);
    await Promise.resolve();
    expect(f.published).toHaveLength(0);
    expect(f.state.preview).toBe(preview);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });

for (const kind of ['author', 'target'] as const)
  it(
    'restores only valid numeric ownership after isolated scale publication ' + kind + ' rejection',
    async () => {
      const f = fixture(),
        preview = prior(f);
      f.state.scaleAuthoring = true;
      f.state.scaleAuthorPolicy = 0;
      f.publish.mockImplementation((edit) => {
        expect(f.depth()).toBeGreaterThan(0);
        admitSymbolSampledSelectionPublication(edit);
        if (kind === 'author') f.state.scaleAuthorPolicy! += 2;
        else {
          f.state.x = 137;
          f.state.revision += 2;
        }
        edit.validate();
        f.published.push(edit.candidate);
      });
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 1.5, 0.75);
      f.flush();
      f.dispatch('pointerup', 2, 0.5);
      await Promise.resolve();
      expect(f.published).toHaveLength(0);
      expect(f.captures.size).toBe(0);
      expect(f.depth()).toBe(0);
      if (kind === 'author') {
        expect([f.state.x, f.state.y]).toEqual([140, 70]);
        expect(f.state.preview).toBe(preview);
        expect(() => preview.validate()).not.toThrow();
      } else {
        expect(f.state.x).toBe(137);
        expect(f.state.preview).toBeNull();
      }
      expect(() => f.context.validate()).not.toThrow();
      f.publish.mockImplementation((edit) => {
        admitSymbolSampledSelectionPublication(edit);
        edit.validate();
        f.published.push(edit.candidate);
      });
      f.dispatch('pointerdown');
      f.dispatch('pointerup', 1.25, 0.8);
      expect(f.published).toHaveLength(1);
      expect(f.depth()).toBe(0);
      f.control.dispose();
    },
  );
