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
  prepareSymbolSampledSelectionTranslation,
  type SymbolSampledSelectionPreview,
} from '../apps/editor/src/symbol-sampled-selection-editor';
import {
  createSymbolSampledSelectionDrag,
  type SymbolSelectionDragState,
} from '../apps/editor/src/symbol-sampled-selection-drag';

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
  createBasicMotionSpan(project, ['@base'], 0, 8, 'linear');
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear');
  const base = project.layers[0];
  const definition: SymbolDefinition = {
    id: 'sprite',
    name: 'Sprite',
    width: 500,
    height: 290,
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
  const view = { origin: { x: 20, y: 20 }, zoom: 1, width: 540, height: 330 };
  const validateCandidate = (candidate: SymbolDefinition) =>
    validateProject({
      ...project,
      layers: symbolLayers(candidate),
      symbols: source.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
      assets: source.assets,
    });
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
    rect: { left: 10, top: 20, width: 540, height: 330 },
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
      symbols: [candidate],
    };
  });
  const context = createSymbolSampledSelectionContext(
    () => source,
    () => {},
    validateCandidate,
    sample,
  )!;
  const state: SymbolSelectionDragState = {
    context,
    requests: [
      { layerId: '@base', shapeId: 'r' },
      { layerId: 'extra', shapeId: 'a' },
    ],
    revision: 0,
    axes: { x: 0, y: 0 },
    policy: 0,
    enabled: true,
    x: 0,
    y: 0,
    preview: null,
  };
  const frames = new Map<number, () => void>(),
    callbacks: (() => void)[] = [];
  let next = 0,
    active = false;
  let depth = 0;
  const preparing = vi.fn((active: boolean) => {
    depth += active ? 1 : -1;
    expect(depth).toBeGreaterThanOrEqual(0);
  });
  const published: SymbolDefinition[] = [];
  const publish = vi.fn((edit: Parameters<typeof admitSymbolSampledSelectionPublication>[0]) => {
    admitSymbolSampledSelectionPublication(edit);
    validateCandidate(edit.candidate);
    JSON.stringify(edit.candidate);
    edit.validate();
    published.push(edit.candidate);
  });
  const error = vi.fn();
  const control = createSymbolSampledSelectionDrag({
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
    preparing,
    publish,
    error,
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
  const dispatch = (type: string, dx = 0, dy = 0, fields = {}) => {
    const start = screen(46, 16);
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
    publish,
    published,
    error,
    validateCandidate,
    preparing,
    depth: () => depth,
    control,
    screen,
    dispatch,
    flush,
    active: () => active,
  };
}

it('coalesces scratch poses, retains original geometry/history and freshly prepares after cleanup', () => {
  const f = fixture(),
    before = structuredClone(f.project);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 3, 2);
  f.dispatch('pointermove', 10, 6);
  expect([f.state.x, f.state.y]).toEqual([10, 6]);
  expect(f.frames.size).toBe(1);
  expect(f.sample).not.toHaveBeenCalled();
  f.flush();
  expect(f.sample).toHaveBeenCalledTimes(1);
  expect(
    f.state
      .preview!.pose.scene.flatMap((t) => t.key.shapes)
      .filter((s) => s.id === 'r')
      .map((s) => s.x),
  ).toEqual([50, 32]);
  f.dispatch('pointermove', 15, 7);
  expect(f.frames.size).toBe(1);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.dispatch('pointerup', 20, 8);
  expect(f.frames.size).toBe(0);
  expect(f.sample).toHaveBeenCalledTimes(2);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.captures.size).toBe(0);
  expect(f.observers.every((o) => !o.connected)).toBe(true);
  expect([f.state.x, f.state.y]).toEqual([20, 8]);
  expect(
    f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'r')!.x,
  ).toBe(60);
  expect(f.project).toEqual(before);
  expect(() => f.state.preview!.validate()).not.toThrow();
  f.callbacks.forEach((cb) => cb());
  expect(f.sample).toHaveBeenCalledTimes(2);
  f.control.dispose();
});
it('uses independent CSS scales, a frozen pointer offset and document-axis Shift precedence', () => {
  const f = fixture();
  f.canvas.rect.width = 800;
  f.canvas.rect.height = 120;
  f.view.origin = { x: 17, y: 29 };
  f.view.zoom = 2;
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 40, 12, { shiftKey: true });
  // Exact isolated division order: x=40/(2*800/540)=13.5, y=12/(2*120/330)=16.5.
  expect([f.state.x, f.state.y]).toEqual([0, 16.5]);
  f.dispatch('pointerup', 40, 12, { shiftKey: true });
  expect([f.state.x, f.state.y]).toEqual([0, 16.5]);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});
it('allows any privately owned member of a complete original group to start capture', () => {
  const f = fixture(),
    point = f.screen(78, 106);
  f.canvas.dispatchEvent(pointer('pointerdown', point.x, point.y));
  expect(f.captures.has(1)).toBe(true);
  f.canvas.dispatchEvent(pointer('pointerup', point.x + 9, point.y + 4));
  expect(f.state.preview!.owner.tracks.map((t) => t.shapeIds)).toEqual([['r'], ['b', 'a']]);
  f.control.dispose();
});
it('keeps detached selected IDs private rather than following later public request mutations', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  (f.state.requests[0] as { shapeId: string }).shapeId = 'other';
  f.dispatch('pointerup', 8, 4);
  expect(f.state.preview!.owner.tracks[0].shapeIds).toEqual(['r']);
  expect(
    f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'other')!.x,
  ).toBe(190);
  f.control.dispose();
});
for (const kind of ['unselected', 'locked', 'transparent'] as const)
  it('uses actual original foreground ownership: ' + kind, () => {
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
              ...f.project.layers[0].keys[4].shapes[0],
              id: 'front',
              ...(kind === 'transparent' ? { opacity: 0 } : {}),
            },
          ],
        },
      ],
    };
    f.project.layers.push(front);
    f.source.definition.timeline!.layers!.push(front);
    // Reopening the fixture through a fresh context is required after source edits.
    const context = createSymbolSampledSelectionContext(
      () => f.source,
      () => {},
      f.validateCandidate,
      f.sample,
    )!;
    f.state.context = context;
    const control = createSymbolSampledSelectionDrag({
      canvas: f.canvas as unknown as HTMLCanvasElement,
      view: () => f.view,
      state: () => f.state,
      draft: (x, y) => {
        f.state.x = x;
        f.state.y = y;
      },
      preview: (p) => {
        f.state.preview = p;
      },
      active: () => {},
      preparing: f.preparing,
      error: f.error,
      requestFrame: () => 1,
      cancelFrame: () => {},
    });
    f.dispatch('pointerdown');
    expect(f.captures.has(1)).toBe(kind === 'transparent');
    control.dispose();
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
  it('cleans native state and restores a valid numeric preview after ' + reason, async () => {
    const f = fixture();
    f.state.x = 7;
    f.state.y = 9;
    const prior = {
      context: f.context,
      owner: {} as never,
      pose: { scene: [], symbols: [] },
      validate: () => {
        if (f.state.x !== 7 || f.state.y !== 9) throw Error('prior targets');
      },
      discard() {},
    };
    f.state.preview = prior;
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
    await Promise.resolve();
    expect(f.depth()).toBe(0);
    expect([f.state.x, f.state.y]).toEqual([7, 9]);
    expect(f.state.preview).toBe(prior);
    expect(f.active()).toBe(false);
    expect(f.captures.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    f.control.dispose();
  });
for (const reason of ['zero', 'return', 'zero-total'] as const)
  it('restores previous drafts without no-op candidates: ' + reason, async () => {
    const f = fixture();
    if (reason === 'zero-total') {
      f.state.x = 7;
      f.state.y = 9;
    }
    const before = [f.state.x, f.state.y];
    f.dispatch('pointerdown');
    if (reason === 'return') f.dispatch('pointermove', 8, 3);
    f.dispatch('pointerup', reason === 'zero-total' ? -7 : 0, reason === 'zero-total' ? -9 : 0);
    await Promise.resolve();
    expect(f.depth()).toBe(0);
    expect([f.state.x, f.state.y]).toEqual(before);
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.state.preview).toBeNull();
    expect(f.captures.size).toBe(0);
    f.control.dispose();
  });
for (const reason of ['input', 'selection', 'policy-restored', 'source', 'view'] as const)
  it('rejects actual late changes before queued preparation: ' + reason, async () => {
    const f = fixture();
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 5, 3);
    if (reason === 'input') {
      f.state.revision++;
      f.state.axes.x++;
      f.state.x = 77;
    }
    if (reason === 'selection') {
      f.state.revision++;
      f.state.requests = [{ layerId: '@base', shapeId: 'other' }];
    }
    if (reason === 'policy-restored') f.state.policy += 2;
    if (reason === 'source') f.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
    if (reason === 'view') f.view.zoom = 2;
    f.flush();
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.captures.size).toBe(0);
    expect(f.error).toHaveBeenCalled();
    if (reason === 'input') expect(f.state.x).toBe(77);
    f.control.dispose();
  });
it('captures dedicated policy before layout/source admission and permits a fresh source-valid retry', () => {
  const f = fixture(),
    rect = f.canvas.getBoundingClientRect;
  let armed = true;
  f.canvas.getBoundingClientRect = () => {
    if (armed) {
      armed = false;
      f.state.policy += 2;
    }
    return rect.call(f.canvas);
  };
  f.dispatch('pointerdown');
  expect(f.captures.size).toBe(0);
  expect(f.error).toHaveBeenCalled();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 6, 2);
  expect(f.state.preview).not.toBeNull();
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
it('rejects release-time source/input changes after native cleanup and preserves explicit values', () => {
  const f = fixture();
  let armed = false;
  f.sample.mockImplementation((candidate) => {
    expect(f.captures.size).toBe(0);
    if (armed) {
      f.state.revision++;
      f.state.axes.x++;
      f.state.x = 99;
    }
    return {
      scene: symbolLayers(candidate).map((l) => ({
        layerId: l.id,
        key: keyAt(l, 4),
        sampled: true,
      })),
      symbols: [],
    };
  });
  f.dispatch('pointerdown');
  armed = true;
  f.dispatch('pointerup', 10, 6);
  expect(f.state.x).toBe(99);
  expect(f.state.preview).toBeNull();
  expect(f.error).toHaveBeenCalled();
  expect(f.captures.size).toBe(0);
  f.control.dispose();
});
it('invalidates released gesture proposals separately from independent numeric previews', () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 10, 6);
  f.state.policy++;
  f.control.policyChanged();
  expect(f.state.preview).toBeNull();
  expect([f.state.x, f.state.y]).toEqual([10, 6]);
  const numeric: SymbolSampledSelectionPreview = {
    context: f.context,
    owner: {} as never,
    pose: { scene: [], symbols: [] },
    validate() {},
    discard() {},
  };
  f.state.preview = numeric;
  f.state.policy++;
  f.control.policyChanged();
  expect(f.state.preview).toBe(numeric);
  f.control.dispose();
});
it('ignores foreign pointers, nonprimary/touch/secondary entry and late disposed callbacks', () => {
  const f = fixture();
  for (const fields of [{ isPrimary: false }, { pointerType: 'touch' }, { button: 2 }])
    f.dispatch('pointerdown', 0, 0, fields);
  expect(f.captures.size).toBe(0);
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 10, 2, { pointerId: 2 });
  f.dispatch('pointercancel', 0, 0, { pointerId: 2 });
  expect(f.captures.has(1)).toBe(true);
  f.dispatch('pointermove', 7, 2);
  f.control.dispose();
  f.callbacks.forEach((cb) => cb());
  expect(f.sample).not.toHaveBeenCalled();
  expect(f.captures.size).toBe(0);
});
it('keeps completed world-pose previews valid after layout changes and restores them on a later cancellation', async () => {
  const f = fixture();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 10, 6);
  const prior = f.state.preview;
  f.canvas.rect.top += 40;
  expect(() => prior!.validate()).not.toThrow();
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 5, 2);
  f.flush();
  f.control.cancel();
  await Promise.resolve();
  expect(f.state.preview).toBe(prior);
  expect([f.state.x, f.state.y]).toEqual([10, 6]);
  expect(() => prior!.validate()).not.toThrow();
  f.control.dispose();
});
it('rejects a real view change caused by native release before fresh preparation', () => {
  const f = fixture(),
    release = f.canvas.releasePointerCapture;
  f.canvas.releasePointerCapture = function (id) {
    release.call(this, id);
    this.rect.top++;
  };
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 10, 6);
  expect(f.captures.size).toBe(0);
  expect(f.sample).not.toHaveBeenCalled();
  expect(f.state.preview).toBeNull();
  expect([f.state.x, f.state.y]).toEqual([0, 0]);
  expect(f.error).toHaveBeenCalled();
  f.control.dispose();
});
it('does not publish superseded preparation when source reads deliver a newer immutable target', () => {
  const f = fixture(),
    clone = f.context.source;
  let armed = false;
  f.context.source = () => {
    const out = clone();
    if (armed) {
      armed = false;
      f.dispatch('pointermove', 20, 5);
    }
    return out;
  };
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 5, 2);
  armed = true;
  f.flush();
  expect(f.state.preview).toBeNull();
  expect(f.frames.size).toBe(1);
  f.flush();
  expect(
    f.state.preview!.pose.scene.flatMap((t) => t.key.shapes).find((s) => s.id === 'r')!.x,
  ).toBe(60);
  expect(f.error).not.toHaveBeenCalled();
  f.control.dispose();
});

for (const change of ['cancel', 'target', 'restored-target', 'policy'] as const)
  it('defers prior restoration until complete-candidate operations return: ' + change, async () => {
    const f = fixture();
    f.state.x = 7;
    f.state.y = 9;
    const edit = prepareSymbolSampledSelectionTranslation(
      f.context,
      f.state.requests,
      { x: 7, y: 9 },
      () => {
        if (f.state.x !== 7 || f.state.y !== 9) throw Error('numeric authority');
      },
    );
    const prior: SymbolSampledSelectionPreview = {
      context: f.context,
      owner: edit.owner,
      pose: f.context.sample(edit.candidate),
      validate: edit.validate,
      discard() {},
    };
    f.state.preview = prior;
    f.sample.mockClear();
    const validate = f.context.validateCandidate;
    let fired = false;
    f.context.validateCandidate = (candidate) => {
      validate(candidate);
      if (!fired) {
        fired = true;
        expect(f.depth()).toBeGreaterThan(0);
        f.control.cancel();
        expect(f.captures.size).toBe(0);
        if (change.includes('target')) {
          f.state.axes.x++;
          f.state.revision++;
          f.state.x = 111;
          if (change === 'restored-target') {
            f.state.axes.x++;
            f.state.revision++;
            f.state.x = 12;
          }
        }
        if (change === 'policy') {
          f.state.policy += 2;
          f.control.policyChanged();
        }
        // Still inside context.operation: never validate the retained numeric edit here.
        expect(f.depth()).toBeGreaterThan(0);
      }
    };
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 5, 3);
    f.flush();
    expect(fired).toBe(true);
    expect(f.captures.size).toBe(0);
    await Promise.resolve();
    expect(f.depth()).toBe(0);
    expect(f.state.y).toBe(9);
    expect(f.state.x).toBe(change === 'target' ? 111 : change === 'restored-target' ? 12 : 7);
    expect(() => f.context.validate()).not.toThrow();
    expect(f.state.preview).toBe(change.includes('target') ? null : prior);
    // A source-valid cancelled operation cannot poison the isolated reentry guard.
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 9, 4);
    expect(f.state.preview).not.toBeNull();
    expect(f.depth()).toBe(0);
    f.control.dispose();
  });
for (const field of ['assets', 'symbols', 'enclosing'] as const)
  it('rejects real isolated source boundaries during native capture: ' + field, async () => {
    const f = fixture(),
      before = structuredClone(f.source.definition);
    f.dispatch('pointerdown');
    f.dispatch('pointermove', 5, 3);
    if (field === 'assets') f.source.assets.push({ id: 'bad' } as never);
    else if (field === 'symbols')
      f.source.symbols.push({ id: 'child', name: 'Child', width: 1, height: 1, shapes: [] });
    else
      f.context.validate = () => {
        throw Error('enclosing owner changed');
      };
    f.flush();
    expect(f.captures.size).toBe(0);
    await Promise.resolve();
    expect(f.depth()).toBe(0);
    expect(f.source.definition).toEqual(before);
    expect(f.state.preview).toBeNull();
    expect(f.sample).not.toHaveBeenCalled();
    f.control.dispose();
  });

it('authors one fresh complete isolated release after cleanup with publication painting held', () => {
  const f = fixture(),
    before = structuredClone(f.source);
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  const publish = f.publish.getMockImplementation()!;
  f.publish.mockImplementation((edit) => {
    expect(f.depth()).toBeGreaterThan(0);
    expect(f.captures.size).toBe(0);
    expect(f.observers.every((o) => !o.connected)).toBe(true);
    publish(edit);
  });
  f.dispatch('pointerdown');
  f.dispatch('pointermove', 5, 2);
  f.flush();
  expect(f.published).toHaveLength(0);
  f.dispatch('pointermove', 10, 6);
  f.dispatch('pointerup', 20, 8);
  expect(f.events).toEqual(['capture', 'sample:1', 'release', 'sample:0']);
  expect(f.published).toHaveLength(1);
  expect(f.depth()).toBe(0);
  expect(
    symbolLayers(f.published[0]).map((l) => keyAt(l, 4).shapes.map((s) => [s.id, s.x, s.y])),
  ).toEqual([
    [
      ['r', 60, 18],
      ['b', 60, 10],
      ['a', 80, 10],
      ['other', 190, 10],
    ],
    [
      ['r', 32, 100],
      ['b', 72, 108],
      ['a', 92, 108],
      ['other', 182, 100],
    ],
  ]);
  expect(f.source).toEqual(before);
  f.callbacks.forEach((cb) => cb());
  expect(f.published).toHaveLength(1);
  f.control.dispose();
});
for (const phase of ['initial', 'queued', 'release', 'publication'] as const)
  for (const change of ['author', 'gesture', 'target', 'source', 'view', 'library'] as const)
    it('rejects isolated ' + phase + ' late ' + change + ' before release history', async () => {
      const f = fixture();
      f.state.authoring = true;
      f.state.authorPolicy = 0;
      let armed = true;
      const mutate = () => {
        if (!armed) return;
        armed = false;
        if (change === 'author') f.state.authorPolicy! += 2;
        else if (change === 'gesture') f.state.policy += 2;
        else if (change === 'target') {
          f.state.revision += 2;
          f.state.axes.x++;
          f.state.x = 111;
        } else if (change === 'source') f.source.definition.name = 'Changed';
        else if (change === 'library')
          f.source.symbols.push({ id: 'child', name: 'Child', width: 1, height: 1, shapes: [] });
        else f.canvas.rect.top++;
      };
      if (phase === 'initial') {
        if (change === 'view') {
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
          f.dispatch('pointermove', 5, 2);
          mutate();
          f.flush();
        } else if (phase === 'release') {
          f.sample.mockImplementation((candidate) => {
            expect(f.captures.size).toBe(0);
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
          f.dispatch('pointerup', 10, 6);
        } else {
          f.publish.mockImplementation((edit) => {
            admitSymbolSampledSelectionPublication(edit);
            mutate();
            edit.validate();
            f.published.push(edit.candidate);
          });
          f.dispatch('pointerup', 10, 6);
        }
      }
      expect(f.published).toHaveLength(0);
      expect(f.captures.size).toBe(0);
      expect(f.error).toHaveBeenCalled();
      await Promise.resolve();
      expect(f.depth()).toBe(0);
      f.control.dispose();
    });
it('permits source-valid isolated opt-out drafts and fresh restored authoring after settlement', async () => {
  const f = fixture();
  f.state.authoring = true;
  f.state.authorPolicy = 0;
  f.dispatch('pointerdown');
  f.state.authoring = false;
  f.state.authorPolicy++;
  f.control.policyChanged();
  await Promise.resolve();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 10, 6);
  expect(f.state.preview).not.toBeNull();
  expect(f.published).toHaveLength(0);
  f.state.authoring = true;
  f.state.authorPolicy++;
  f.control.policyChanged();
  f.dispatch('pointerdown');
  f.dispatch('pointerup', 5, 2);
  expect(f.published).toHaveLength(1);
  expect(f.depth()).toBe(0);
  f.control.dispose();
});

for (const change of ['author', 'target'] as const)
  it('restores only admitted numeric ownership after late isolated publication ' + change, () => {
    const f = fixture();
    f.state.x = 7;
    f.state.y = 9;
    const edit = prepareSymbolSampledSelectionTranslation(
      f.context,
      f.state.requests,
      { x: 7, y: 9 },
      () => {
        if (f.state.x !== 7 || f.state.y !== 9) throw Error('numeric authority');
      },
    );
    const prior: SymbolSampledSelectionPreview = {
      context: f.context,
      owner: edit.owner,
      pose: f.context.sample(edit.candidate),
      validate: edit.validate,
      discard() {},
    };
    f.state.preview = prior;
    f.state.authoring = true;
    f.state.authorPolicy = 0;
    const publish = f.publish.getMockImplementation()!;
    f.publish.mockImplementation((candidate) => {
      admitSymbolSampledSelectionPublication(candidate);
      expect(f.depth()).toBeGreaterThan(0);
      if (change === 'author') f.state.authorPolicy! += 2;
      else {
        f.state.axes.x++;
        f.state.revision++;
        f.state.x = 111;
      }
      candidate.validate();
      f.published.push(candidate.candidate);
    });
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 5, 3);
    expect(f.published).toHaveLength(0);
    expect(f.captures.size).toBe(0);
    expect(f.depth()).toBe(0);
    expect(() => f.context.validate()).not.toThrow();
    expect(f.state.y).toBe(9);
    expect(f.state.x).toBe(change === 'author' ? 7 : 111);
    expect(f.state.preview).toBe(change === 'author' ? prior : null);
    f.publish.mockImplementation(publish);
    f.dispatch('pointerdown');
    f.dispatch('pointerup', 3, 2);
    expect(f.published).toHaveLength(1);
    expect(f.depth()).toBe(0);
    f.control.dispose();
  });
