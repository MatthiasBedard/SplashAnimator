import { captureLiveCubicControls } from '../packages/animation/src/live-cubic-controls';
import { expect, it, vi } from 'vitest';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';
import {
  captureLiveGraphicMotionAuthoringFrame as capture,
  prepareSplitLiveGraphicMotionSpans as split,
  type LiveGraphicOwner,
  type LiveGraphicSplitRequest,
} from '../packages/animation/src/live-graphic-motion-owner';
import {
  captureLiveMotionAuthoringFrame as rootCapture,
  prepareSplitLiveMotionSpans as rootSplit,
  type LiveRootOwner,
} from '../packages/animation/src/live-motion-owner';
import {
  captureLiveGroupMotionAuthoringFrame as groupCapture,
  prepareSplitLiveGroupMotionSpans as groupSplit,
  type LiveGroupOwner,
} from '../packages/animation/src/live-group-motion-owner';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import { liveSplitFixture } from './live-motion-split-fixture';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { MAX_SYMBOL_ARTWORK, validateProject, type Project } from '../packages/document/src';
function fixture(mode = 'loop', basis = 'plain') {
  const { p, span } = liveGraphicFixture(mode, basis);
  return createLiveGraphics(p, span);
}
function operation(p = fixture(), frame = 6, shape = 'instance') {
  const view = capture(() => ({ project: p, revision: 7, frame }));
  return { view, requests: [{ owner: view.resolve('track', shape), rightSpanId: 'right' }] };
}
function equivalent(a: Project, b: Project) {
  const x = captureLiveMotionTimeline(() => ({ project: a, revision: 0 })),
    y = captureLiveMotionTimeline(() => ({ project: b, revision: 0 }));
  try {
    for (let f = 0; f < a.duration; f++) {
      const from = x.sample(f),
        to = y.sample(f);
      expect(to.map((t) => t.layerId)).toEqual(from.map((t) => t.layerId));
      from.forEach((v, i) =>
        expect(sameMotionArtwork(v.key.shapes, to[i].key.shapes), `frame ${f}`).toBe(true),
      );
    }
  } finally {
    x.dispose();
    y.dispose();
  }
}
function addCompanions(p: Project) {
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const other = structuredClone(key.shapes[0]);
      other.id = 'other';
      other.y += 20;
      other.symbolPlayback!.firstFrame = key.frame === 2 ? 2 : 0;
      key.shapes.push(other, {
        id: 'plain',
        kind: 'rectangle',
        x: 100,
        y: 100,
        width: 4,
        height: 4,
        rotation: 0,
        fill: '#0000ff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      });
    }
}
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const frame of [4, 8])
      it(`prepares private ${mode}/${basis} graphic ownership at ${frame}`, () => {
        const p = fixture(mode, basis),
          before = structuredClone(p),
          { view, requests } = operation(p, frame),
          owner = requests[0].owner;
        expect(owner).toMatchObject({
          layerId: 'track',
          shapeId: 'instance',
          symbolId: 'graphic',
          spanId: 'live',
          start: 2,
          end: 10,
          frame,
          revision: 7,
          shapeIds: ['instance'],
        });
        expect(Object.isFrozen(owner)).toBe(true);
        expect(Object.isFrozen(owner.shapeIds)).toBe(true);
        const out = split(requests);
        validateProject(out);
        equivalent(p, out);
        expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, frame, 10, 12]);
        expect(out.layers[0].keys.find((k) => k.frame === frame)!.shapes).toEqual(
          view.scene[0].key.shapes,
        );
        for (const key of before.layers[0].keys)
          expect(out.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
        expect({ ...out, layers: [] }).toEqual({ ...before, layers: [] });
        expect(p).toEqual(before);
        out.layers[0].keys[1].shapes[0].x++;
        expect(p).toEqual(before);
        view.dispose();
        expect(() => split(requests)).toThrow(/disposed/);
      });
it('shares complete frozen IDs across graphic references and never owns plain companions', () => {
  const p = fixture();
  addCompanions(p);
  const { view, requests } = operation(p),
    other = view.resolve('track', 'other');
  expect(view.choices).toEqual([
    { layerId: 'track', spanId: 'live', shapeId: 'instance', symbolId: 'graphic' },
    { layerId: 'track', spanId: 'live', shapeId: 'other', symbolId: 'graphic' },
  ]);
  expect(other.shapeIds).toBe(requests[0].owner.shapeIds);
  expect(other.shapeIds).toEqual(['instance', 'other', 'plain']);
  expect(() => view.resolve('track', 'plain')).toThrow();
  const out = split([{ owner: other, rightSpanId: 'right' }]);
  equivalent(p, out);
  expect(() => split([requests[0], { owner: other, rightSpanId: 'another' }])).toThrow(/once/);
  view.dispose();
});
it('detaches public scenes/choices and ignores replaced public properties/methods', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p),
    scene = view.scene,
    hints = view.choices;
  scene[0].key.shapes[0].symbolId = 'forged';
  scene[0].key.shapes[0].x = 999;
  hints[0].shapeId = 'forged';
  expect(() => view.resolve('track', 'forged')).toThrow();
  Object.defineProperty(view, 'scene', { value: scene });
  const out = split(requests);
  equivalent(p, out);
  expect(p).toEqual(before);
  view.resolve = () => ({ ...requests[0].owner });
  expect(() => split([{ owner: view.resolve('track', 'instance'), rightSpanId: 'right' }])).toThrow(
    /private/,
  );
  view.dispose();
});
for (const frame of [0, 1, 2, 3, 9, 10, 11, 12])
  it(`excludes insufficient graphic split space ${frame}`, () => {
    const p = fixture(),
      view = capture(() => ({ project: p, revision: 0, frame }));
    expect(view.choices).toEqual([]);
    expect(() => view.resolve('track', 'instance')).toThrow();
    view.dispose();
  });
for (const field of ['locked', 'visible'] as const)
  it(`excludes graphic ${field} contexts`, () => {
    const p = fixture();
    p.layers[0][field] = field === 'locked';
    const view = capture(() => ({ project: p, revision: 0, frame: 6 }));
    expect(view.choices).toEqual([]);
    view.dispose();
  });
for (const shape of [undefined, 1, {}, 'plain', 'missing', 'art', 'graphic'])
  it(`rejects non-original graphic pick ${JSON.stringify(shape)}`, () => {
    const { view } = operation();
    expect(() => view.resolve('track', shape as string)).toThrow();
    view.dispose();
  });
for (const failure of ['clock', 'button', 'NaN', 'overflow'])
  it(`rejects original graphic ${failure} before creating handles`, () => {
    const p = fixture();
    if (failure === 'clock') p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (failure === 'NaN') p.symbols![0].width = NaN;
    if (failure === 'overflow') {
      p.layers[0].keys[1].shapes[0].x = 1e308;
      p.layers[0].keys[2].shapes[0].x = -1e308;
    }
    expect(() => capture(() => ({ project: p, revision: 0, frame: 6 }))).toThrow();
  });
for (const key of ['project', 'revision', 'frame'])
  it(`rejects original source ${key} accessors without reads`, () => {
    const value = { project: fixture(), revision: 0, frame: 6 };
    let reads = 0;
    Object.defineProperty(value, key, {
      enumerable: true,
      get() {
        reads++;
        return undefined;
      },
    });
    expect(() => capture(() => value)).toThrow();
    expect(reads).toBe(0);
  });
for (const field of ['frame', 'revision', 'library', 'endpoint', 'replacement'])
  it(`invalidates changed original ${field}`, () => {
    const p = fixture();
    let state = { project: p, revision: 0, frame: 6 };
    const view = capture(() => state),
      requests = [{ owner: view.resolve('track', 'instance'), rightSpanId: 'right' }];
    if (field === 'frame') state.frame = 8;
    if (field === 'revision') state.revision++;
    if (field === 'library') p.symbols![0].name = 'Edited';
    if (field === 'endpoint') p.layers[0].keys[2].shapes[0].x++;
    if (field === 'replacement') state = { ...state, project: structuredClone(p) };
    expect(() => split(requests)).toThrow();
    expect(() => view.resolve('track', 'instance')).toThrow();
    view.dispose();
  });
for (const raw of ['getter', 'inherited', 'hidden', 'sparse', 'extra', 'prototype'])
  it(`rejects raw ${raw} right-ID requests without getters`, () => {
    const { view, requests } = operation();
    let reads = 0;
    let input: unknown = requests;
    if (raw === 'getter')
      Object.defineProperty(requests[0], 'rightSpanId', {
        enumerable: true,
        get() {
          reads++;
          return 'right';
        },
      });
    if (raw === 'inherited') {
      delete (requests[0] as Partial<LiveGraphicSplitRequest>).rightSpanId;
      Object.setPrototypeOf(requests[0], {
        get rightSpanId() {
          reads++;
          return 'right';
        },
      });
    }
    if (raw === 'hidden') Object.defineProperty(requests[0], 'rightSpanId', { enumerable: false });
    if (raw === 'sparse') input = Array(1);
    if (raw === 'extra') Object.assign(requests, { extra: true });
    if (raw === 'prototype') Object.setPrototypeOf(requests, {});
    expect(() => split(input as LiveGraphicSplitRequest[])).toThrow();
    expect(reads).toBe(0);
    view.dispose();
  });
for (const raw of ['getter', 'inherited', 'hidden', 'async'])
  it(`rejects ${raw} enclosing admission before history writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, requests } = operation(p);
    let reads = 0;
    const options: { validate?: () => void } = {};
    if (raw === 'getter')
      Object.defineProperty(options, 'validate', {
        enumerable: true,
        get() {
          reads++;
          return () => {};
        },
      });
    if (raw === 'inherited')
      Object.setPrototypeOf(options, {
        get validate() {
          reads++;
          return () => {};
        },
      });
    if (raw === 'hidden')
      Object.defineProperty(options, 'validate', { value: () => {}, enumerable: false });
    if (raw === 'async') options.validate = async () => {};
    expect(() => split(requests, options)).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
    view.dispose();
  });
it('requires one original capture and rejects detached/copied brands', () => {
  const p = fixture(),
    a = operation(p),
    b = operation(p);
  expect(() => split([{ owner: { ...a.requests[0].owner }, rightSpanId: 'right' }])).toThrow(
    /private/,
  );
  expect(() => split([a.requests[0], b.requests[0]])).toThrow(/capture scopes/);
  a.view.dispose();
  b.view.dispose();
});
it('keeps actual root and group handles cross-branded in both directions', () => {
  const rootProject = liveSplitFixture(),
    root = rootCapture(() => ({ project: rootProject, revision: 0, frame: 4 })),
    rootOwner = root.resolve('track', 'art');
  const { p } = liveRotationFixture('rigid', 'plain', true),
    group = groupCapture(() => ({ project: p, revision: 0, frame: 4 })),
    groupOwner = group.resolve('track', 'outer'),
    graphic = operation();
  for (const owner of [rootOwner, groupOwner])
    expect(() =>
      split([{ owner: owner as unknown as LiveGraphicOwner, rightSpanId: 'right' }]),
    ).toThrow(/private/);
  expect(() =>
    rootSplit([
      { owner: graphic.requests[0].owner as unknown as LiveRootOwner, rightSpanId: 'right' },
    ]),
  ).toThrow(/private/);
  expect(() =>
    groupSplit([
      { owner: graphic.requests[0].owner as unknown as LiveGroupOwner, rightSpanId: 'right' },
    ]),
  ).toThrow(/private/);
  root.dispose();
  group.dispose();
  graphic.view.dispose();
});
it('prepares all original tracks together and preserves unrequested layers', () => {
  const p = fixture(),
    later = structuredClone(p.layers[0]);
  later.id = 'later';
  p.layers.push(later);
  const { view, requests } = operation(p),
    before = structuredClone(p),
    b = { owner: view.resolve('later', 'instance'), rightSpanId: 'right-b' },
    out = split([...requests, b]);
  equivalent(p, out);
  expect(out.layers.map((l) => l.keys.map((k) => k.frame))).toEqual([
    [0, 2, 6, 10, 12],
    [0, 2, 6, 10, 12],
  ]);
  expect(out.layers[0].liveMotionSpans![1].id).toBe('right');
  expect(out.layers[1].liveMotionSpans![1].id).toBe('right-b');
  expect(p).toEqual(before);
  const only = split(requests);
  expect(only.layers[1]).toEqual(p.layers[1]);
  view.dispose();
});
it('rejects a later unresolved route atomically and permits the valid original subset', () => {
  const p = fixture(),
    later = structuredClone(p.layers[0]);
  later.id = 'later';
  later.liveMotionSpans![0].path = { startX: 0, startY: 80, endX: 0, endY: -40, distance: true };
  p.layers.push(later);
  const before = structuredClone(p),
    { view, requests } = operation(p);
  expect(() =>
    split([...requests, { owner: view.resolve('later', 'instance'), rightSpanId: 'right-b' }]),
  ).toThrow(/reproduce|unresolved/);
  expect(p).toEqual(before);
  const out = split(requests);
  expect(out.layers[1]).toEqual(before.layers[1]);
  view.dispose();
});
it('supports reopened later sparse editing without restoring old graphic offsets', () => {
  const p = fixture(),
    a = operation(p, 6),
    out = JSON.parse(JSON.stringify(split(a.requests))) as Project;
  a.view.dispose();
  const b = operation(out, 4);
  b.requests[0].rightSpanId = 'third';
  const again = split(b.requests);
  equivalent(p, again);
  expect(again.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 10, 12]);
  b.view.dispose();
});
for (const holes of [false, true])
  it(`retains private nested exposure origins ${holes}`, () => {
    const { p, span, definition } = liveGraphicFixture(),
      child = {
        ...symbolInstance(definition, 0, 0),
        id: 'child',
        symbolPlayback: { mode: 'once' as const, firstFrame: 2 },
      };
    p.symbols!.push({
      id: 'wrapper',
      name: 'Wrapper',
      width: 60,
      height: 10,
      shapes: [child],
      timeline: {
        duration: 3,
        keys: holes
          ? [
              { frame: 1, shapes: [] },
              { frame: 2, shapes: [structuredClone(child)] },
            ]
          : [],
      },
    });
    for (const key of p.layers[0].keys) for (const s of key.shapes) s.symbolId = 'wrapper';
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
    const source = createLiveGraphics(p, span),
      { view, requests } = operation(source, 4),
      out = split(requests);
    expect(out.symbols).toEqual(source.symbols);
    equivalent(source, out);
    view.dispose();
  });
for (const stage of ['source', 'output', 'candidate', 'input'])
  it(`rejects late ${stage} changes after complete detached preparation`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, requests } = operation(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Project;
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.length === 2) {
        hit = true;
        if (stage === 'source') p.symbols![0].name = 'Separate source edit';
        if (stage === 'input') requests[0].rightSpanId = 'changed';
        if (stage === 'output') (out as Project).layers[0].keys[2].shapes[0].x++;
        if (stage === 'candidate') q.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame++;
      }
      return out;
    });
    try {
      expect(() => split(requests)).toThrow();
      expect(hit).toBe(true);
      if (stage === 'source') before.symbols![0].name = 'Separate source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
    view.dispose();
  });
for (const call of [1, 2])
  it(`rejects request mutation from original source admission ${call}`, () => {
    const p = fixture();
    let arm = false,
      reads = 0;
    let requests: LiveGraphicSplitRequest[] = [];
    const view = capture(() => {
      if (arm && ++reads === call) requests[0].rightSpanId = 'changed';
      return { project: p, revision: 0, frame: 6 };
    });
    requests = [{ owner: view.resolve('track', 'instance'), rightSpanId: 'right' }];
    arm = true;
    expect(() => split(requests)).toThrow(/requests changed/);
    arm = false;
    requests[0].rightSpanId = 'right';
    equivalent(p, split(requests));
    view.dispose();
  });
it('guards reentry before the very first original source callback', () => {
  const p = fixture();
  let arm = false,
    hit = false;
  let requests: LiveGraphicSplitRequest[] = [];
  const view = capture(() => {
    if (arm) {
      arm = false;
      hit = true;
      try {
        split(requests);
      } catch {
        /* Outer preparation must still reject. */
      }
    }
    return { project: p, revision: 0, frame: 6 };
  });
  requests = [{ owner: view.resolve('track', 'instance'), rightSpanId: 'right' }];
  arm = true;
  expect(() => split(requests)).toThrow(/reenter/);
  expect(hit).toBe(true);
  equivalent(p, split(requests));
  view.dispose();
});
it('fingerprints complete edited candidates before project validation serialization', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
    const text = stringify(...args),
      q = args[0] as Project,
      stack = new Error().stack ?? '';
    if (
      !hit &&
      q?.layers?.[0]?.liveMotionSpans?.length === 2 &&
      stack.includes('prepareSplitLiveGraphicMotionSpans') &&
      !stack.includes('splitLiveGraphicMotionLayer')
    ) {
      hit = true;
      q.layers[0].keys[2].shapes[0].x++;
    }
    return text;
  }) as typeof stringify);
  try {
    expect(() => split(requests)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
  equivalent(p, split(requests));
  view.dispose();
});
it('rejects aggregate overflow injected into completed output before publication', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = v as Project;
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.length === 2) {
      hit = true;
      const target = out as Project,
        art = target.symbols![0].shapes[0];
      target.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
        ...art,
        id: 'overflow' + i,
      }));
    }
    return out;
  });
  try {
    expect(() => split(requests)).toThrow(/budget/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  equivalent(p, split(requests));
  view.dispose();
});
it('admits the actual original aggregate capacity and rejects overflow with no lower owner cap', () => {
  const p = fixture(),
    art = p.symbols![0].shapes[0];
  p.symbols!.push({
    id: 'capacity',
    name: 'Capacity',
    width: 4,
    height: 4,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - 5 }, (_, i) => ({
      ...art,
      id: 'art' + i,
      points: [],
    })),
  });
  const { view, requests } = operation(p),
    out = split(requests);
  expect(out.symbols).toEqual(p.symbols);
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
  view.dispose();
  p.symbols![1].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 180000);

for (const field of ['frame', 'revision'] as const)
  for (const value of [-1, 0.5, NaN, Infinity])
    it(`rejects source ${field} ${value} without handles`, () => {
      const state = { project: fixture(), revision: 0, frame: 6 };
      state[field] = value;
      expect(() => capture(() => state)).toThrow();
    });
for (const inherited of [false, true])
  it(`rejects original library duration access before reads, inherited ${inherited}`, () => {
    const p = fixture();
    let reads = 0;
    const timeline = p.symbols![0].timeline!;
    if (inherited) {
      delete (timeline as { duration?: number }).duration;
      Object.setPrototypeOf(timeline, {
        get duration() {
          reads++;
          return 5;
        },
      });
    } else
      Object.defineProperty(timeline, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 5;
        },
      });
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });
for (const id of [undefined, null, 1, {}, '', 'live'])
  it(`rejects raw right identity ${JSON.stringify(id)}`, () => {
    const { view, requests } = operation();
    (requests[0] as { rightSpanId: unknown }).rightSpanId = id;
    expect(() => split(requests)).toThrow();
    view.dispose();
  });
it('keeps frozen complete IDs shared across a broad graphic choice set with linear public hints', () => {
  const p = fixture(),
    count = 1200;
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const original = key.shapes[0];
      key.shapes = Array.from({ length: count }, (_, i) => ({
        ...original,
        id: 'instance' + i,
        points: [],
      }));
    }
  const { view } = operation(p, 6, 'instance0'),
    a = view.resolve('track', 'instance0'),
    b = view.resolve('track', 'instance1199');
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds.length).toBe(count);
  expect(view.choices.length).toBe(count);
  expect(JSON.stringify(view.choices).length).toBeLessThan(count * 150);
  view.dispose();
});
it('rejects an actual cubic brand and leaves original cubic ownership valid', () => {
  const p = liveSplitFixture();
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 10, endX: 0, endY: 10 };
  const curve = captureLiveCubicControls(() => ({ project: p, revision: 0, frame: 4 })),
    owner = curve.resolve('track', 'live', 'art', 'start');
  expect(() =>
    split([{ owner: owner as unknown as LiveGraphicOwner, rightSpanId: 'right' }]),
  ).toThrow(/private/);
  curve.dispose();
});
it('protects enclosing callback reentry and preserves a source-valid retry', () => {
  const p = fixture(),
    { view, requests } = operation(p);
  let hit = false;
  expect(() =>
    split(requests, {
      validate: () => {
        if (!hit) {
          hit = true;
          try {
            split(requests);
          } catch {
            /* Outer attempt must reject. */
          }
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(hit).toBe(true);
  equivalent(p, split(requests));
  view.dispose();
});
