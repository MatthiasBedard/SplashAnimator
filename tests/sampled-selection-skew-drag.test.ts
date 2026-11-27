import { afterEach, expect, it, vi } from 'vitest';
import { newProject, keyAt, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  admitSampledSelectionPublication,
  createSampledSelectionContext,
  type SampledSelectionPreview,
} from '../apps/editor/src/sampled-selection-editor';
import {
  createSampledSelectionSkewDrag,
  type SelectionSkewDragState,
} from '../apps/editor/src/sampled-selection-skew-drag';
import { rotationLocal } from '../apps/editor/src/sampled-rotation-handle';
import { sampledSelectionSkewHandles } from '../apps/editor/src/sampled-skew-handles';

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
      layer.id === 'base' ? 8 : 10,
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
  const context = createSampledSelectionContext(
    () => source,
    (p) => structuredClone(p),
    sample,
  )!;
  const state: SelectionSkewDragState = {
    context,
    requests: [
      { layerId: 'base', shapeId: 'r' },
      { layerId: 'extra', shapeId: 'a' },
    ],
    revision: 0,
    policy: 0,
    enabled: true,
    axis: 'x',
    degrees: 0,
    preview: null,
  };
  const frames = new Map<number, () => void>(),
    callbacks: (() => void)[] = [];
  let next = 0,
    active = false;
  const published: (typeof project)[] = [];
  const publish = vi.fn((edit: Parameters<typeof admitSampledSelectionPublication>[0]) => {
    admitSampledSelectionPublication(edit);
    structuredClone(project);
    edit.validate();
    published.push(edit.candidate);
  });
  const error = vi.fn();
  const control = createSampledSelectionSkewDrag({
    canvas: canvas as unknown as HTMLCanvasElement,
    view: () => view,
    state: () => state,
    draft: (axis, degrees) => {
      state.axis = axis;
      state.degrees = degrees;
    },
    preview: (value) => {
      state.preview = value;
    },
    active: (value) => {
      active = value;
    },
    error,
    publish: publisher ? publish : undefined,
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
    pick = { handle: 'skew-s' },
    box = { left: 40, top: 10, right: 84, bottom: 112 };
  const layout = () =>
    sampledSelectionSkewHandles(box, pivot, {
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
  const dispatch = (type: string, degrees = 0, fields = {}) => {
    const h = layout().handles.find((h) => h.id === pick.handle)!,
      p = start(),
      k = Math.tan((degrees * Math.PI) / 180);
    const at = screen(
      h.anchor.x + (h.axis === 'x' ? k * (h.anchor.y - pivot.y) : 0) + p.x - h.anchor.x,
      h.anchor.y + (h.axis === 'y' ? k * (h.anchor.x - pivot.x) : 0) + p.y - h.anchor.y,
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
    box,
    pick,
    layout,
    active: () => active,
  };
}

it('coalesces original immutable shear targets and freshly prepares history-free release after cleanup', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 12);
  f.dispatch('pointermove', 25);
  expect(f.state.degrees).toBeCloseTo(25, 10);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  f.dispatch('pointermove', 20);
  f.dispatch('pointerup', 35);
  expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events.at(-1)).toBe('sample:0');
  const v = f.state.preview!.pose.rendered.find((s) => s.id === 'r')!,
    k = Math.tan((35 * Math.PI) / 180);
  expect(v.x).toBeCloseTo(40 + k * (10 - 61), 10);
  expect(v.y).toBe(10);
  expect(v.transform![2]).toBeCloseTo(k, 10);
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect(f.project).toEqual(before);
  expect(f.published).toEqual([]);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
for (const edge of ['skew-n', 'skew-e', 'skew-s', 'skew-w'])
  for (const shift of [false, true])
    it(
      'owns original edge/axis and keeps Shift single-axis precedence ' + edge + '/' + shift,
      () => {
        const f = fixture(undefined, true);
        f.pick.handle = edge;
        f.dispatch('pointerdown');
        expect(f.captures.size).toBe(1);
        f.dispatch('pointerup', 23, { shiftKey: shift });
        const horizontal = edge === 'skew-n' || edge === 'skew-s',
          angle = shift ? 30 : 23,
          k = Math.tan((angle * Math.PI) / 180),
          v = f.state.preview!.pose.rendered.find((s) => s.id === 'r')!;
        expect(f.state.axis).toBe(horizontal ? 'x' : 'y');
        expect(f.state.degrees).toBeCloseTo(angle, 10);
        expect(v.x).toBeCloseTo(40 + (horizontal ? k * (10 - 61) : 0), 10);
        expect(v.y).toBeCloseTo(10 + (horizontal ? 0 : k * (40 - 62)), 10);
        expect(horizontal ? v.y : v.x).toBe(horizontal ? 10 : 40);
        expect(f.error).not.toHaveBeenCalled();
        f.control.dispose();
      },
    );
it('uses independent CSS scales and original handle offsets instead of composing prior numeric skew', () => {
  const f = fixture();
  f.view.zoom = 0.5;
  f.view.origin = { x: 100, y: 80 };
  f.canvas.rect.width = 300;
  f.canvas.rect.height = 100;
  f.offset.x = 3;
  f.offset.y = -2;
  f.state.axis = 'y';
  f.state.degrees = -17;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  expect([f.state.axis, f.state.degrees]).toEqual(['x', 0]);
  f.dispatch('pointerup', 25);
  expect(f.state.axis).toBe('x');
  expect(f.state.degrees).toBeCloseTo(25, 10);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
function prior(f: ReturnType<typeof fixture>) {
  f.state.axis = 'y';
  f.state.degrees = -17;
  const proposal: SampledSelectionPreview = {
    context: f.context,
    owner: { frame: 4, revision: 1, units: [], tracks: [] },
    pose: { scene: [], rendered: [] },
    validate: () => {
      f.context.validate();
      if (f.state.axis !== 'y' || f.state.degrees !== -17)
        throw Error('original numeric preview changed');
    },
    discard: () => {},
  };
  f.state.preview = proposal;
  return proposal;
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
  'dispose',
  'policy',
])
  it(
    'cleans native/queued work and restores valid independent prior numeric previews ' + kind,
    () => {
      const f = fixture(),
        p = prior(f);
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 20);
      const stale = [...f.callbacks];
      if (kind === 'escape')
        f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
      else if (kind === 'window-blur') f.win.dispatchEvent(new Event('blur'));
      else if (kind === 'resize' || kind === 'scroll') f.win.dispatchEvent(new Event(kind));
      else if (kind === 'observer') {
        f.canvas.rect.left++;
        f.observers.at(-1)!.callback();
      } else if (kind === 'cancel') f.control.cancel();
      else if (kind === 'dispose') f.control.dispose();
      else if (kind === 'policy') {
        f.state.policy += 2;
        f.control.policyChanged();
      } else f.canvas.dispatchEvent(pointer(kind, 0, 0));
      stale.forEach((cb) => cb());
      expect(f.captures.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.observers.every((o) => !o.connected)).toBe(true);
      expect([f.state.axis, f.state.degrees]).toEqual(['y', -17]);
      expect(f.state.preview).toBe(p);
      expect(f.published).toEqual([]);
      f.control.dispose();
    },
  );
for (const moved of [false, true])
  it('restores zero/return without preparing a release split ' + moved, () => {
    const f = fixture(),
      p = prior(f);
    f.dispatch('pointerdown');
    if (moved) {
      f.dispatch('pointermove', 20);
      f.flush();
    }
    f.dispatch('pointerup');
    expect(f.state.preview).toBe(p);
    expect([f.state.axis, f.state.degrees]).toEqual(['y', -17]);
    expect(f.sample).toHaveBeenCalledTimes(moved ? 1 : 0);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
it('invalidates policy-owned proposals without erasing independent numeric previews', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 25);
  const proposal = f.state.preview!;
  f.state.policy += 2;
  expect(() => proposal.validate()).toThrow();
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  const p = prior(f);
  f.state.policy++;
  f.control.policyChanged();
  expect(f.state.preview).toBe(p);
  f.control.dispose();
});
for (const kind of [
  'axis',
  'degrees',
  'revision',
  'requests',
  'policy',
  'context',
  'source',
  'frame',
  'view',
])
  it('rejects movement source/input/view edits while keeping authoritative inputs ' + kind, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 20);
    if (kind === 'axis') {
      f.state.axis = 'y';
      f.state.revision++;
    } else if (kind === 'degrees') {
      f.state.degrees = 37;
      f.state.revision++;
    } else if (kind === 'revision') f.state.revision += 2;
    else if (kind === 'requests') f.state.requests = [...f.state.requests];
    else if (kind === 'policy') f.state.policy += 2;
    else if (kind === 'context') f.state.context = { ...f.state.context };
    else if (kind === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
    else if (kind === 'frame') f.source.frame++;
    else f.view.origin.x++;
    f.dispatch('pointermove', 25);
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.state.preview).toBeNull();
    if (kind === 'axis') expect(f.state.axis).toBe('y');
    if (kind === 'degrees') expect(f.state.degrees).toBe(37);
    expect(f.published).toEqual([]);
    f.control.dispose();
  });
for (const finishing of [false, true])
  it('rejects actual late source changes after detached sampling ' + finishing, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    let complete = false;
    f.sample.mockImplementation((candidate) => {
      complete = candidate.layers.every((l) => l.motionSpans?.length === 2);
      f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
      return { scene: [], rendered: [] };
    });
    f.dispatch(finishing ? 'pointerup' : 'pointermove', 20);
    if (!finishing) f.flush();
    expect(complete).toBe(true);
    expect(f.state.preview).toBeNull();
    expect(f.captures.size).toBe(0);
    expect(f.project.layers[0].motionSpans).toHaveLength(1);
    f.control.dispose();
  });
for (const kind of ['pointer', 'coordinate', 'array'])
  it('rejects malformed coalesced events atomically ' + kind, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    const p = f.screen(100, 100),
      sample = pointer(
        'pointermove',
        p.x,
        p.y,
        kind === 'pointer' ? { pointerId: 2 } : kind === 'coordinate' ? { clientX: NaN } : {},
      );
    f.dispatch('pointermove', 20, { getCoalescedEvents: () => (kind === 'array' ? {} : [sample]) });
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.state.preview).toBeNull();
    f.control.dispose();
  });
it('ignores foreign pointers and retained legacy release preferences cannot publish', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  Object.assign(f.state, { authoring: true, scaleAuthoring: true, rotationAuthoring: true });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 20, { pointerId: 2 });
  f.dispatch('pointerup', 20, { pointerId: 2 });
  expect(f.captures.size).toBe(1);
  expect(f.state.degrees).toBe(0);
  f.dispatch('pointerup', 20);
  expect(f.state.preview).not.toBeNull();
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.project).toEqual(before);
  f.control.dispose();
});
it('never captures distant proposed handles or consumes numeric targets', () => {
  const f = fixture();
  f.state.degrees = 35;
  f.dispatch('pointerdown', 35);
  expect(f.captures.size).toBe(0);
  expect(f.state.degrees).toBe(35);
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(1);
  f.dispatch('pointerup', 20);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
for (const action of ['policy', 'degrees', 'source', 'view'])
  it(
    'rejects initial admission getter changes and permits source-valid fresh retries ' + action,
    () => {
      const f = fixture(),
        read = f.canvas.getBoundingClientRect.bind(f.canvas);
      let armed = true;
      f.canvas.getBoundingClientRect = () => {
        if (armed) {
          armed = false;
          if (action === 'policy') f.state.policy += 2;
          else if (action === 'degrees') {
            f.state.degrees = 37;
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
        f.dispatch('pointerup', 20);
        expect(f.state.preview).not.toBeNull();
      }
      f.control.dispose();
    },
  );
for (const field of ['policy', 'revision'] as const)
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE])
    it('rejects unsafe original ' + field + ' ' + String(value), () => {
      const f = fixture();
      f.state[field] = value;
      f.dispatch('pointerdown');
      expect(f.captures.size).toBe(0);
      f.control.dispose();
    });
for (const kind of ['opaque', 'locked', 'transparent', 'hidden'])
  it('uses original visible foreground ownership ' + kind, () => {
    const f = fixture();
    f.project.layers.push({
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
              x: 58,
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
    f.source.signature = JSON.stringify(f.project);
    f.state.context = createSampledSelectionContext(
      () => f.source,
      (p) => structuredClone(p),
      f.sample,
    )!;
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(kind === 'transparent' || kind === 'hidden' ? 1 : 0);
    f.control.dispose();
  });
it('rejects native touch/secondary/disabled and undisplayed invalid-angle entry', () => {
  const f = fixture();
  for (const fields of [{ pointerType: 'touch' }, { button: 2 }, { isPrimary: false }]) {
    f.dispatch('pointerdown', 0, fields);
    expect(f.captures.size).toBe(0);
  }
  f.state.degrees = 90;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  f.state.degrees = 0;
  f.state.enabled = false;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});

it('canceled queued callbacks cannot affect a fresh capture', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 15);
  const old = [...f.callbacks];
  f.control.cancel();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 25);
  old.forEach((cb) => cb());
  expect(f.state.degrees).toBeCloseTo(25, 10);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  expect(f.captures.size).toBe(1);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
it('a newer target delivered from an older raw sample getter stays authoritative', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  let armed = true;
  f.dispatch('pointermove', 15, {
    getCoalescedEvents: () => {
      if (armed) {
        armed = false;
        f.dispatch('pointermove', 25);
      }
      return [];
    },
  });
  expect(f.state.degrees).toBeCloseTo(25, 10);
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(f.state.preview).not.toBeNull();
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('superseded sampling never publishes an older pose or cancels the latest target', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const sample = f.sample.getMockImplementation()!;
  let armed = true;
  f.sample.mockImplementation((candidate) => {
    if (armed) {
      armed = false;
      f.dispatch('pointermove', 25);
    }
    return sample(candidate);
  });
  f.dispatch('pointermove', 15);
  f.flush();
  expect(f.state.preview).toBeNull();
  expect(f.state.degrees).toBeCloseTo(25, 10);
  expect(f.captures.size).toBe(1);
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(f.state.preview).not.toBeNull();
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('authors one explicitly opted-in fresh skew after cleanup through normal final admission', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.state.skewAuthoring = true;
  f.state.skewAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 20);
  f.flush();
  expect(f.publish).not.toHaveBeenCalled();
  f.dispatch('pointerup', 35);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.published).toHaveLength(1);
  const primary = keyAt(f.published[0].layers[0], 4).shapes.find((s) => s.id === 'r')!;
  const k = Math.tan((35 * Math.PI) / 180);
  expect(primary.x).toBeCloseTo(40 + k * (10 - 61), 10);
  expect(primary.y).toBe(10);
  expect(primary.transform![2]).toBeCloseTo(k, 10);
  expect(f.project).toEqual(before);
  expect(f.captures.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  f.callbacks.forEach((cb) => cb());
  expect(f.published).toHaveLength(1);
  f.control.dispose();
});
for (const phase of ['initial', 'queued', 'release', 'publication'] as const)
  for (const kind of ['author', 'gesture', 'target', 'source', 'view'] as const)
    it('rejects ' + phase + ' late ' + kind + ' before skew release history', () => {
      const f = fixture();
      f.state.skewAuthoring = true;
      f.state.skewAuthorPolicy = 0;
      let armed = true;
      const mutate = () => {
        if (!armed) return;
        armed = false;
        if (kind === 'author') f.state.skewAuthorPolicy! += 2;
        else if (kind === 'gesture') f.state.policy += 2;
        else if (kind === 'target') {
          f.state.revision += 2;
          f.state.degrees = 37;
        } else if (kind === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
        else f.canvas.rect.top++;
      };
      if (phase === 'initial') {
        if (kind === 'view') {
          const snapshot = f.context.snapshot;
          f.context.snapshot = () => {
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
          f.dispatch('pointermove', 20);
          mutate();
          f.flush();
        } else if (phase === 'release') {
          f.sample.mockImplementation((candidate) => {
            expect(f.captures.size).toBe(0);
            expect(
              candidate.layers.every((l) =>
                keyAt(l, 4).shapes.some(
                  (s) => Math.abs((s.transform?.[2] ?? 0) - Math.tan((35 * Math.PI) / 180)) < 1e-12,
                ),
              ),
            ).toBe(true);
            mutate();
            return {
              scene: candidate.layers.map((l) => ({
                layerId: l.id,
                key: keyAt(l, 4),
                sampled: true,
              })),
              rendered: [],
            };
          });
          f.dispatch('pointerup', 35);
        } else {
          f.publish.mockImplementation((edit) => {
            admitSampledSelectionPublication(edit);
            expect(f.captures.size).toBe(0);
            expect(edit.shearing!.axis).toBe('x');
            expect(edit.shearing!.degrees).toBeCloseTo(35, 10);
            expect(edit.shearing!.pivot).toEqual({ x: 62, y: 61 });
            mutate();
            edit.validate();
            f.published.push(edit.candidate);
          });
          f.dispatch('pointerup', 35);
        }
      }
      expect(armed).toBe(false);
      expect(f.published).toHaveLength(0);
      expect(f.captures.size).toBe(0);
      expect(f.error).toHaveBeenCalled();
      f.control.dispose();
    });
it('permits fresh opted-out drafts and restored skew authoring after dedicated policy rejection', () => {
  const f = fixture();
  f.state.skewAuthoring = true;
  f.state.skewAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.state.skewAuthoring = false;
  f.state.skewAuthorPolicy++;
  f.control.policyChanged();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 25);
  expect(f.state.preview).not.toBeNull();
  expect(f.published).toHaveLength(0);
  f.state.skewAuthoring = true;
  f.state.skewAuthorPolicy++;
  f.control.policyChanged();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 25);
  expect(f.published).toHaveLength(1);
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
for (const value of [undefined, NaN, Infinity, -1, Number.MAX_VALUE, 0.5])
  it('rejects an invalid dedicated authoring revision without consuming a retry: ' + value, () => {
    const f = fixture();
    f.state.skewAuthoring = true;
    f.state.skewAuthorPolicy = value;
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.sample).not.toHaveBeenCalled();
    f.state.skewAuthorPolicy = 0;
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 25);
    expect(f.published).toHaveLength(1);
    f.control.dispose();
  });
for (const value of [0, 1, 'true', null])
  it('does not coerce a raw skew-authoring preference: ' + value, () => {
    const f = fixture();
    Object.assign(f.state, { skewAuthoring: value, skewAuthorPolicy: 0 });
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    expect(f.published).toHaveLength(0);
    f.control.dispose();
  });
it('rejects an opted-in release without a publisher and restores a valid prior preview', () => {
  const f = fixture(undefined, false, false),
    preview = prior(f);
  f.state.skewAuthoring = true;
  f.state.skewAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 25);
  expect(f.published).toHaveLength(0);
  expect(f.captures.size).toBe(0);
  expect(f.state.preview).toBe(preview);
  expect([f.state.axis, f.state.degrees]).toEqual(['y', -17]);
  expect(f.error).toHaveBeenCalled();
  f.control.dispose();
});
for (const moved of [false, true])
  it('never authors an opted-in zero/returned original skew: ' + moved, () => {
    const f = fixture(),
      preview = prior(f);
    f.state.skewAuthoring = true;
    f.state.skewAuthorPolicy = 0;
    f.dispatch('pointerdown');
    if (moved) {
      f.dispatch('pointermove', 20);
      f.flush();
    }
    f.dispatch('pointerup', 0);
    expect(f.published).toHaveLength(0);
    expect(f.state.preview).toBe(preview);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });

for (const authoring of [false, true])
  for (const phase of authoring ? ['sample', 'publication'] : ['sample'])
    for (const action of ['cancel', 'dispose', 'escape'] as const)
      it('keeps cleaned-up release cancelable ' + authoring + '/' + phase + '/' + action, () => {
        const f = fixture(),
          original = prior(f),
          before = structuredClone(f.project);
        f.state.skewAuthoring = authoring;
        f.state.skewAuthorPolicy = 0;
        f.dispatch('pointerdown');
        let reached = false;
        const interrupt = () => {
          reached = true;
          expect(f.captures.size).toBe(0);
          if (action === 'escape')
            f.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
          else f.control[action]();
        };
        if (phase === 'publication') {
          if (!authoring) {
            f.control.dispose();
            return;
          }
          f.publish.mockImplementation((edit) => {
            admitSampledSelectionPublication(edit);
            interrupt();
            edit.validate();
            f.published.push(edit.candidate);
          });
        } else {
          const sample = f.sample.getMockImplementation()!;
          f.sample.mockImplementation((candidate) => {
            interrupt();
            return sample(candidate);
          });
        }
        f.dispatch('pointerup', 35);
        expect(reached).toBe(true);
        expect(f.published).toEqual([]);
        expect(f.project).toEqual(before);
        expect(f.captures.size).toBe(0);
        expect(f.frames.size).toBe(0);
        expect(f.state.preview).toBe(original);
        expect([f.state.axis, f.state.degrees]).toEqual(['y', -17]);
        f.control.dispose();
      });
it('cannot reenter a fresh capture during cleaned-up skew release sampling', () => {
  const f = fixture(),
    sample = f.sample.getMockImplementation()!;
  f.state.skewAuthoring = true;
  f.state.skewAuthorPolicy = 0;
  f.dispatch('pointerdown');
  f.sample.mockImplementation((candidate) => {
    f.dispatch('pointerdown');
    expect(f.captures.size).toBe(0);
    return sample(candidate);
  });
  f.dispatch('pointerup', 35);
  expect(f.published).toHaveLength(1);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});

for (const kind of ['candidate', 'owner', 'metadata', 'replacement', 'raw-number'] as const)
  it('rejects complete skew release output changed by the publisher ' + kind, () => {
    const f = fixture();
    if (kind === 'raw-number') Object.assign(f.project, { customRelease: null });
    if (kind === 'raw-number') f.source.signature = JSON.stringify(f.project);
    const before = structuredClone(f.project);
    f.state.skewAuthoring = true;
    f.state.skewAuthorPolicy = 0;
    f.dispatch('pointerdown');
    f.publish.mockImplementation((edit) => {
      if (kind === 'candidate')
        edit.candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
      else if (kind === 'owner') edit.owner.tracks[0].shapeIds.pop();
      else if (kind === 'metadata') edit.shearing!.degrees++;
      else if (kind === 'replacement') edit.candidate = structuredClone(edit.candidate);
      else Object.assign(edit.candidate, { customRelease: NaN });
      admitSampledSelectionPublication(edit);
      edit.validate();
      f.published.push(edit.candidate);
    });
    f.dispatch('pointerup', 35);
    expect(f.published).toEqual([]);
    expect(f.captures.size).toBe(0);
    expect(f.error).toHaveBeenCalled();
    expect(f.project).toEqual(before);
    f.control.dispose();
  });
for (const raw of [false, true])
  it('rejects sampled skew release candidates changed before publication ' + raw, () => {
    const f = fixture();
    Object.assign(f.project, { customRelease: null });
    f.source.signature = JSON.stringify(f.project);
    f.state.skewAuthoring = true;
    f.state.skewAuthorPolicy = 0;
    f.dispatch('pointerdown');
    const sample = f.sample.getMockImplementation()!;
    f.sample.mockImplementation((candidate) => {
      if (raw) Object.assign(candidate, { customRelease: NaN });
      else candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
      return sample(candidate);
    });
    f.dispatch('pointerup', 35);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.published).toEqual([]);
    expect(f.error).toHaveBeenCalled();
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
