import { afterEach, expect, it, vi } from 'vitest';
import { newProject, keyAt, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  admitSampledSelectionPublication,
  createSampledSelectionContext,
  type SampledSelectionPreview,
} from '../apps/editor/src/sampled-selection-editor';
import {
  createSampledSelectionRotationDrag,
  type SelectionRotationDragState,
} from '../apps/editor/src/sampled-selection-rotation-drag';
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
  const state: SelectionRotationDragState = {
    context,
    requests: [
      { layerId: 'base', shapeId: 'r' },
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
    active = false;
  const published: (typeof project)[] = [];
  const publish = vi.fn((edit: Parameters<typeof admitSampledSelectionPublication>[0]) => {
    admitSampledSelectionPublication(edit);
    structuredClone(project);
    edit.validate();
    published.push(edit.candidate);
  });
  const error = vi.fn();
  const control = createSampledSelectionRotationDrag({
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

it('coalesces original-pivot rotations and freshly prepares after native cleanup without history', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 15);
  f.dispatch('pointermove', 45);
  expect(f.state.degrees).toBeCloseTo(45, 10);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  expect(f.state.preview!.owner.tracks.map((t) => t.shapeIds)).toEqual([['r'], ['b', 'a']]);
  f.dispatch('pointermove', 60);
  expect(f.frames.size).toBe(1);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointerup', 90);
  expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events.at(-1)).toBe('sample:0');
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect(f.state.degrees).toBeCloseTo(90, 10);
  const primary = f.state.preview!.pose.rendered.find((s) => s.id === 'r')!;
  expect(primary.x).toBeCloseTo(113, 9);
  expect(primary.y).toBeCloseTo(39, 9);
  expect(primary.rotation).toBeCloseTo(90, 9);
  expect(f.project).toEqual(before);
  expect(f.published).toEqual([]);
  f.control.dispose();
});
it('preserves independent CSS scales, pointer-angle offsets and unapplied numeric base angles', () => {
  const f = fixture();
  f.view.zoom = 0.5;
  f.view.origin = { x: 100, y: 80 };
  f.canvas.rect.width = 300;
  f.canvas.rect.height = 100;
  f.offset.x = 3;
  f.offset.y = -2;
  f.state.degrees = 30;
  f.dispatch('pointerdown');
  expect(f.captures.has(1)).toBe(true);
  f.dispatch('pointerup', 45);
  expect(f.state.degrees).toBeCloseTo(75, 10);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
it('snaps the document-space angular change without replacing a numeric base angle', () => {
  const f = fixture();
  f.state.degrees = 7;
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 38, { shiftKey: true });
  expect(f.state.degrees).toBe(52);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
it('retains private original IDs when detached public requests mutate', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  (f.state.requests[0] as { shapeId: string }).shapeId = 'other';
  f.dispatch('pointerup', 90);
  expect(f.state.preview!.owner.tracks[0].shapeIds).toEqual(['r']);
  expect(f.state.preview!.pose.rendered.find((s) => s.id === 'other')!.rotation).toBe(0);
  f.control.dispose();
});
for (const kind of ['unselected', 'locked', 'transparent', 'hidden'])
  it('protects actual original foreground ownership ' + kind, () => {
    const f = fixture(),
      point = f.start();
    f.control.dispose();
    f.project.layers.push({
      id: 'front',
      name: 'Front',
      visible: kind !== 'hidden',
      locked: kind === 'locked',
      drawingMode: 'object',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              id: 'foreground',
              kind: 'rectangle',
              x: point.x - 5,
              y: point.y - 5,
              width: 10,
              height: 10,
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
    const control = createSampledSelectionRotationDrag({
      canvas: f.canvas as unknown as HTMLCanvasElement,
      view: () => f.view,
      state: () => f.state,
      draft: (degrees) => {
        f.state.degrees = degrees;
      },
      preview: (p) => {
        f.state.preview = p;
      },
      active: () => {},
      error: f.error,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    f.dispatch('pointerdown');
    expect(f.captures.has(1)).toBe(kind === 'transparent' || kind === 'hidden');
    control.dispose();
  });
it('rejects distant proposed handles and original artwork bodies as picks', () => {
  const f = fixture();
  f.state.degrees = 90;
  const v = { ...f.view, cssWidth: 400, cssHeight: 240 },
    proposed = sampledSelectionRotationHandle(f.pivot, v, 90),
    p = f.screen(rotationLocal(proposed.knob, v).x, rotationLocal(proposed.knob, v).y);
  f.canvas.dispatchEvent(pointer('pointerdown', p.x, p.y));
  expect(f.captures.size).toBe(0);
  const body = f.screen(46, 16);
  f.canvas.dispatchEvent(pointer('pointerdown', body.x, body.y));
  expect(f.captures.size).toBe(0);
  f.dispatch('pointerdown');
  expect(f.captures.has(1)).toBe(true);
  f.control.dispose();
});
for (const reason of ['escape', 'pointercancel', 'lost', 'blur', 'canvas-blur', 'resize', 'scroll'])
  it(
    'cleans native capture/observer/frames and restores a valid prior numeric preview ' + reason,
    () => {
      const f = fixture();
      f.state.degrees = 30;
      const prior: SampledSelectionPreview = {
        context: f.context,
        owner: {} as never,
        pose: { scene: [], rendered: [] },
        validate() {
          if (f.state.degrees !== 30) throw Error('prior angle');
        },
        discard() {},
      };
      f.state.preview = prior;
      f.dispatch('pointerdown');
      f.dispatch('pointermove', 40);
      f.flush();
      if (reason === 'escape')
        f.win.dispatchEvent(
          Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
        );
      else if (reason === 'pointercancel') f.dispatch('pointercancel');
      else if (reason === 'lost') f.canvas.releasePointerCapture(1);
      else if (reason === 'canvas-blur') f.canvas.dispatchEvent(new Event('blur'));
      else f.win.dispatchEvent(new Event(reason));
      expect(f.state.degrees).toBe(30);
      expect(f.state.preview).toBe(prior);
      expect(f.captures.size).toBe(0);
      expect(f.frames.size).toBe(0);
      expect(f.observers.every((o) => !o.connected)).toBe(true);
      expect(f.active()).toBe(false);
      f.control.dispose();
    },
  );
for (const reason of ['zero', 'return', 'zero-total', 'full-turn'])
  it('does not create no-op rotation poses ' + reason, () => {
    const f = fixture();
    if (reason === 'zero-total') f.state.degrees = 30;
    const before = f.state.degrees;
    f.dispatch('pointerdown');
    if (reason === 'return') f.dispatch('pointermove', 45);
    if (reason === 'full-turn') for (const a of [90, 180, 270, 360]) f.dispatch('pointermove', a);
    f.dispatch('pointerup', reason === 'zero-total' ? -30 : reason === 'full-turn' ? 360 : 0);
    expect(f.state.degrees).toBe(before);
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.state.preview).toBeNull();
    expect(f.frames.size).toBe(0);
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
it('unwraps multiple revolutions into a finite changed numeric angle', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  for (const a of [90, 180, 270, 360]) f.dispatch('pointermove', a);
  f.dispatch('pointerup', 450);
  expect(f.state.degrees).toBeCloseTo(450, 8);
  expect(f.state.preview).not.toBeNull();
  f.control.dispose();
});
it('preserves coalesced revolutions without repeated geometry preparation', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const sample = (angle: number) => {
    const start = f.start(),
      r = (angle * Math.PI) / 180,
      x = start.x - f.pivot.x,
      y = start.y - f.pivot.y,
      p = f.screen(
        f.pivot.x + Math.cos(r) * x - Math.sin(r) * y,
        f.pivot.y + Math.sin(r) * x + Math.cos(r) * y,
      );
    return pointer('pointermove', p.x, p.y);
  };
  const event = sample(450);
  Object.defineProperty(event, 'getCoalescedEvents', {
    value: () => [90, 180, 270, 360].map(sample),
  });
  f.canvas.dispatchEvent(event);
  expect(f.state.degrees).toBeCloseTo(450, 8);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  f.dispatch('pointerup', 450);
  expect(f.state.degrees).toBeCloseTo(450, 8);
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
it('keeps numeric edits delivered by a raw pointer getter authoritative', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  const event = pointer('pointermove', 1, 2);
  Object.defineProperty(event, 'clientX', {
    get() {
      f.state.revision++;
      f.state.degrees = 77;
      return 1;
    },
  });
  f.canvas.dispatchEvent(event);
  expect(f.state.degrees).toBe(77);
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
  expect(f.sample).not.toHaveBeenCalled();
  f.control.dispose();
});
it('does not overwrite a newer capture reentered through an original request getter', () => {
  const f = fixture();
  let armed = true;
  Object.defineProperty(f.state.requests[0], 'shapeId', {
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
  f.dispatch('pointerup', 90);
  expect(f.state.preview).not.toBeNull();
  expect(f.captures.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  f.control.dispose();
});
for (const reason of ['input', 'selection', 'policy-restored', 'source', 'view'])
  it('rejects actual late ownership changes before a queued pose ' + reason, () => {
    const f = fixture();
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 30);
    if (reason === 'input') {
      f.state.degrees = 77;
      f.state.revision += 2;
    }
    if (reason === 'selection') f.state.requests = [{ layerId: 'base', shapeId: 'other' }];
    if (reason === 'policy-restored') f.state.policy += 2;
    if (reason === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
    if (reason === 'view') f.view.width++;
    f.flush();
    expect(f.state.preview).toBeNull();
    expect(f.captures.size).toBe(0);
    expect(f.sample).not.toHaveBeenCalled();
    if (reason === 'input') expect(f.state.degrees).toBe(77);
    f.control.dispose();
  });
for (const phase of ['layout', 'source'])
  for (const kind of ['policy', 'input'])
    it('captures policy/targets before original admission ' + phase + ' ' + kind, () => {
      const f = fixture();
      let armed = true;
      const change = () => {
        if (!armed) return;
        armed = false;
        if (kind === 'policy') f.state.policy += 2;
        else {
          f.state.degrees = 42;
          f.state.revision += 2;
        }
      };
      if (phase === 'layout') {
        const bounds = f.canvas.getBoundingClientRect;
        f.canvas.getBoundingClientRect = function () {
          const out = bounds.call(this);
          change();
          return out;
        };
      } else {
        const snapshot = f.context.snapshot;
        f.context.snapshot = () => {
          const out = snapshot();
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
for (const kind of ['policy', 'input', 'view', 'source'])
  it('admits release changes after native cleanup ' + kind, () => {
    const f = fixture(),
      release = f.canvas.releasePointerCapture;
    f.canvas.releasePointerCapture = function (id) {
      release.call(this, id);
      if (kind === 'policy') f.state.policy += 2;
      if (kind === 'input') {
        f.state.degrees = 77;
        f.state.revision++;
      }
      if (kind === 'view') f.canvas.rect.top++;
      if (kind === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
    };
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 90);
    expect(f.captures.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    expect(f.state.preview).toBeNull();
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalled();
    if (kind === 'input') expect(f.state.degrees).toBe(77);
    f.control.dispose();
  });
it('invalidates gesture-owned proposals while retaining independent numeric previews', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 90);
  const owned = f.state.preview!;
  f.state.policy += 2;
  expect(() => owned.validate()).toThrow();
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  const numeric: SampledSelectionPreview = {
    context: f.context,
    owner: {} as never,
    pose: { scene: [], rendered: [] },
    validate() {},
    discard() {},
  };
  f.state.preview = numeric;
  f.state.policy++;
  f.control.policyChanged();
  expect(f.state.preview).toBe(numeric);
  f.control.dispose();
});
it('retains a completed world pose after view changes and restores it on later cancellation', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 30);
  const prior = f.state.preview;
  f.canvas.rect.top += 40;
  expect(() => prior!.validate()).not.toThrow();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 20);
  f.flush();
  f.control.cancel();
  expect(f.state.degrees).toBeCloseTo(30, 10);
  expect(f.state.preview).toBe(prior);
  expect(() => prior!.validate()).not.toThrow();
  f.control.dispose();
});
it('keeps superseded immutable angle work unpublished and prepares only the latest target', () => {
  const f = fixture(),
    snapshot = f.context.snapshot;
  let armed = false;
  f.context.snapshot = () => {
    const out = snapshot();
    if (armed) {
      armed = false;
      f.dispatch('pointermove', 60);
    }
    return out;
  };
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 20);
  armed = true;
  f.flush();
  expect(f.state.preview).toBeNull();
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(f.state.degrees).toBeCloseTo(60, 10);
  expect(f.state.preview!.pose.rendered.find((s) => s.id === 'r')!.rotation).toBeCloseTo(60, 10);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('ignores foreign/nonprimary/touch/secondary pointers and late disposed work', () => {
  const f = fixture();
  for (const fields of [{ isPrimary: false }, { pointerType: 'touch' }, { button: 2 }])
    f.dispatch('pointerdown', 0, fields);
  expect(f.captures.size).toBe(0);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 90, { pointerId: 2 });
  f.dispatch('pointercancel', 0, { pointerId: 2 });
  expect(f.captures.has(1)).toBe(true);
  f.dispatch('pointermove', 30);
  f.control.dispose();
  f.callbacks.forEach((cb) => cb());
  expect(f.sample).not.toHaveBeenCalled();
  expect(f.captures.size).toBe(0);
  expect(f.frames.size).toBe(0);
});
for (const point of [
  { x: -2000, y: -2000 },
  { x: 2000, y: 2000 },
])
  it(
    'retains an off-view original saved pivot without clamping geometry ' + JSON.stringify(point),
    () => {
      const f = fixture(point),
        before = structuredClone(f.project);
      f.dispatch('pointerdown');
      expect(f.captures.has(1)).toBe(true);
      f.dispatch('pointerup', 30);
      expect(f.state.degrees).toBeCloseTo(30, 9);
      expect(
        (f.state.preview!.owner as unknown as { pivot: { x: number; y: number } }).pivot,
      ).toEqual(point);
      expect(f.project).toEqual(before);
      f.control.dispose();
    },
  );
it('rejects a pointer at the pivot and malformed numeric/view inputs without partial publication', () => {
  const f = fixture();
  f.state.degrees = NaN;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  f.state.degrees = Number.MAX_VALUE;
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  f.state.degrees = 0;
  const initial = f.screen(f.start().x, f.start().y);
  f.view.zoom = 0;
  f.canvas.dispatchEvent(pointer('pointerdown', initial.x, initial.y));
  expect(f.captures.size).toBe(0);
  f.view.zoom = 1;
  f.dispatch('pointerdown');
  const p = f.screen(f.pivot.x, f.pivot.y);
  f.canvas.dispatchEvent(pointer('pointerup', p.x, p.y));
  expect(f.state.preview).toBeNull();
  expect(f.captures.size).toBe(0);
  expect(f.published).toEqual([]);
  f.control.dispose();
});

it('authors one explicitly opted-in fresh rotation after cleanup through normal final admission', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 45);
  f.flush();
  expect(f.publish).not.toHaveBeenCalled();
  f.dispatch('pointerup', 90);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.published).toHaveLength(1);
  const primary = keyAt(f.published[0].layers[0], 4).shapes.find((s) => s.id === 'r')!;
  expect(primary.x).toBeCloseTo(113, 9);
  expect(primary.y).toBeCloseTo(39, 9);
  expect(primary.rotation).toBeCloseTo(90, 9);
  expect(f.project).toEqual(before);
  expect(f.captures.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  f.callbacks.forEach((cb) => cb());
  expect(f.published).toHaveLength(1);
  f.control.dispose();
});
for (const phase of ['initial', 'queued', 'release', 'publication'] as const)
  for (const kind of ['author', 'gesture', 'target', 'source', 'view'] as const)
    it('rejects ' + phase + ' late ' + kind + ' before rotation release history', () => {
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
          f.dispatch('pointermove', 45);
          mutate();
          f.flush();
        } else if (phase === 'release') {
          f.sample.mockImplementation((candidate) => {
            expect(f.captures.size).toBe(0);
            expect(
              candidate.layers.every((l) => keyAt(l, 4).shapes.some((s) => s.rotation !== 0)),
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
          f.dispatch('pointerup', 90);
        } else {
          f.publish.mockImplementation((edit) => {
            admitSampledSelectionPublication(edit);
            expect(f.captures.size).toBe(0);
            mutate();
            edit.validate();
            f.published.push(edit.candidate);
          });
          f.dispatch('pointerup', 90);
        }
      }
      expect(f.published).toHaveLength(0);
      expect(f.captures.size).toBe(0);
      expect(f.error).toHaveBeenCalled();
      f.control.dispose();
    });
it('permits fresh opted-out drafts and restored-authoring capture after policy rejection', () => {
  const f = fixture();
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  f.dispatch('pointerdown');
  f.state.authoring = false;
  f.state.authorPolicy++;
  f.control.policyChanged();
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
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
