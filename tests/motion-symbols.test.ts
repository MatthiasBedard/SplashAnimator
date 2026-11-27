import { createMovieTreeClock } from '../packages/animation/src/movie-tree-clock';
import { expect, it } from 'vitest';
import {
  clone,
  newProject,
  symbolLayers,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import { expandSymbols, symbolInstance } from '../packages/geometry/src/symbols';
import {
  generateMotionFrames,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
function fixture(mode: 'loop' | 'once' | 'single' = 'loop') {
  const rect: Vector = {
    id: 'rect',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const inner: SymbolDefinition = {
    id: 'inner',
    name: 'Inner',
    width: 20,
    height: 20,
    shapes: [rect],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...rect, fill: '#00ff00' }] },
        { frame: 2, shapes: [{ ...rect, fill: '#0000ff' }] },
      ],
    },
  };
  const outer: SymbolDefinition = {
    id: 'outer',
    name: 'Outer',
    width: 20,
    height: 20,
    shapes: [symbolInstance(inner, 0, 0)],
    timeline: { duration: 5, keys: [] },
  };
  const p = newProject();
  p.duration = 8;
  p.symbols = [inner, outer];
  const a = symbolInstance(outer, 100, 100);
  a.symbolPlayback = { mode, firstFrame: 1 };
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 6, shapes: [{ ...clone(a), x: 160 }] },
  ];
  return p;
}
it('keeps an instance name over its tween exposure without overwriting the end key name', () => {
  const project = fixture();
  const layer = project.layers[0];
  layer.keys[0].shapes[0].instanceName = 'Start placement';
  layer.keys[1].shapes[0].instanceName = 'End placement';
  generateMotionFrames(project, [layer.id], 0, 6, 'linear');
  expect(layer.keys.map(key => key.shapes[0].instanceName)).toEqual([
    ...Array<string>(6).fill('Start placement'),
    'End placement',
  ]);
});
it('preserves nested graphic exposure ages independently of eased motion and keeps authored endpoints', () => {
  for (const mode of ['loop', 'once', 'single'] as const) {
    const p = fixture(mode),
      before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 6, 'in');
    for (let frame = 1; frame < 6; frame++) {
      const expected = expandSymbols(before, before.layers[0].keys[0].shapes, frame);
      const actual = expandSymbols(p, p.layers[0].keys[frame].shapes, 0);
      expected.forEach((s) => (s.x += 60 * (frame / 6) ** 2));
      actual.forEach((shape, i) => {
        expect(shape.x).toBeCloseTo(expected[i].x, 10);
        expect(shape.y).toBeCloseTo(expected[i].y, 10);
        expect({ ...shape, x: 0, y: 0 }).toEqual({ ...expected[i], x: 0, y: 0 });
      });
    }
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
    expect(p.symbols).toEqual(before.symbols);
  }
});
it('generates detached symbol timelines with graphic clocks and rejects unsupported descendants atomically', () => {
  const p = fixture();
  const def: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 200,
    height: 200,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 8, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def);
  const out = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    6,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    [...p.symbols!, def],
  );
  expect(out.timeline!.keys[0].shapes[0].symbolPlayback).toEqual({ mode: 'loop', firstFrame: 2 });
  expect(def).toEqual(before);
  for (const mode of ['button', 'missing', 'cycle', 'invalid'] as const) {
    const q = fixture();
    const child = q.symbols![1].shapes[0];
    if (mode === 'button') q.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
    if (mode === 'missing') child.symbolId = 'absent';
    if (mode === 'cycle') child.symbolId = 'outer';
    if (mode === 'invalid') child.symbolPlayback = { mode: 'loop', firstFrame: NaN };
    const keys = q.layers[0].keys;
    expect(() => generateMotionFrames(q, [q.layers[0].id], 0, 6, 'linear')).toThrow(/Motion/);
    expect(q.layers[0].keys).toBe(keys);
  }
});

it('rejects unsupported depth and later-track references before writing any track', () => {
  const p = fixture();
  let previous = p.symbols![1];
  for (let i = 0; i < 7; i++) {
    const next: SymbolDefinition = {
      id: 'depth' + i,
      name: 'Depth',
      width: 20,
      height: 20,
      shapes: [symbolInstance(previous, 0, 0)],
    };
    p.symbols!.push(next);
    previous = next;
  }
  const later = clone(p.layers[0]);
  later.id = 'later';
  for (const key of later.keys) key.shapes[0].symbolId = previous.id;
  p.layers.push(later);
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      6,
      'linear',
    ),
  ).toThrow(/depth/);
  expect(p).toEqual(before);
});

it('allows authored target clocks to continue or stop graphic playback without changing interiors', () => {
  for (const mode of ['loop', 'once', 'single'] as const) {
    const p = fixture();
    p.layers[0].keys[1].shapes[0].symbolPlayback = { mode, firstFrame: 2 };
    const before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear');
    for (let f = 1; f < 6; f++)
      expect(p.layers[0].keys[f].shapes[0].symbolPlayback).toEqual({
        mode: 'loop',
        firstFrame: (1 + f) % 5,
      });
    expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
    const rendered = expandSymbols(p, p.layers[0].keys[6].shapes, 1);
    expect(rendered[0].fill).toBe(mode === 'single' ? '#0000ff' : '#ff0000');
    const def: SymbolDefinition = {
      id: 'parent',
      name: 'Parent',
      width: 200,
      height: 200,
      shapes: before.layers[0].keys[0].shapes,
      timeline: { duration: 8, keys: before.layers[0].keys.slice(1) },
    };
    const out = generateSymbolMotionFrames(
      def,
      [symbolLayers(def)[0].id],
      0,
      6,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      [...p.symbols!, def],
    );
    expect(out.timeline!.keys.find((k) => k.frame === 6)).toEqual(before.layers[0].keys[1]);
    expect(out.timeline!.keys[0].shapes[0].symbolPlayback).toEqual({ mode: 'loop', firstFrame: 2 });
  }
});
it('validates original target playback and rejects symbol swaps atomically', () => {
  for (const mode of ['nan', 'null', 'invalid mode', 'swap'] as const) {
    const p = fixture();
    const end = p.layers[0].keys[1].shapes[0];
    if (mode === 'nan') end.symbolPlayback = { mode: 'loop', firstFrame: NaN };
    if (mode === 'null') end.symbolPlayback = null as unknown as Vector['symbolPlayback'];
    if (mode === 'invalid mode') end.symbolPlayback = { mode: 'invalid' as 'movie', firstFrame: 0 };
    if (mode === 'swap') end.symbolId = 'inner';
    const keys = p.layers[0].keys;
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear')).toThrow();
    expect(p.layers[0].keys).toBe(keys);
  }
});

it('keeps movie clocks continuous across generated keys, authored endpoints, holds and root wraps', () => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    key.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
  const before = clone(p);
  generateMotionFrames(p, [p.layers[0].id], 0, 6, 'in');
  const originalClock = createMovieTreeClock(),
    generatedClock = createMovieTreeClock();
  for (const position of [0, 1, 2, 4, 6, 7, 8, 9, 16, 25]) {
    const actual = generatedClock.sample(p, position % 8, position / p.fps, position);
    expect(actual).toEqual(originalClock.sample(before, position % 8, position / p.fps, position));
    expect(Object.values(actual)).toEqual([position]);
  }
  // Holding the parent frame does not stop the independent movie clock.
  expect(Object.values(generatedClock.sample(p, 1, 30 / p.fps, 25))).toEqual([30]);
  for (let f = 1; f < 6; f++) {
    expect(p.layers[0].keys[f].shapes[0].symbolPlayback).toEqual({ mode: 'movie', firstFrame: 1 });
    expect(p.layers[0].keys[f].shapes[0].x).toBeCloseTo(100 + 60 * (f / 6) ** 2, 10);
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
  expect(p.symbols).toEqual(before.symbols);
});
it('keeps generated movie settings detached in symbol timelines', () => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    key.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 9 };
  const def: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 200,
    height: 200,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 8, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def);
  const out = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    6,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    [...p.symbols!, def],
  );
  const first = out.timeline!.keys.find((k) => k.frame === 1)!.shapes[0];
  const next = out.timeline!.keys.find((k) => k.frame === 2)!.shapes[0];
  expect(first.symbolPlayback).toEqual({ mode: 'movie', firstFrame: 9 });
  first.symbolPlayback!.firstFrame = 0;
  expect(next.symbolPlayback!.firstFrame).toBe(9);
  expect(def).toEqual(before);
});
it('rejects movie mapping changes and later-track movie descendants atomically', () => {
  for (const change of [
    'invalid offset',
    'invalid mode',
    'invalid descendant',
    'button',
  ] as const) {
    const p = fixture();
    for (const key of p.layers[0].keys)
      key.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
    const later = clone(p.layers[0]);
    later.id = 'later';
    if (change === 'invalid offset') later.keys[1].shapes[0].symbolPlayback!.firstFrame = -1;
    if (change === 'invalid mode')
      later.keys[1].shapes[0].symbolPlayback!.mode = 'invalid' as 'movie';
    if (change === 'invalid descendant')
      p.symbols![1].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: -1 };
    if (change === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    p.layers.push(later);
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        6,
        'linear',
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});

it('preserves nested movie clocks directly and through graphic intermediaries', () => {
  for (const throughGraphic of [false, true]) {
    const p = fixture();
    for (const key of p.layers[0].keys)
      key.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
    p.symbols![1].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 2 };
    if (throughGraphic) {
      const wrapper: SymbolDefinition = {
        id: 'wrapper',
        name: 'Wrapper',
        width: 20,
        height: 20,
        shapes: [clone(p.symbols![1].shapes[0])],
        timeline: { duration: 7, keys: [] },
      };
      p.symbols!.push(wrapper);
      p.symbols![1].shapes = [symbolInstance(wrapper, 0, 0)];
    }
    const before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear');
    const originalClock = createMovieTreeClock(),
      generatedClock = createMovieTreeClock();
    for (const position of [0, 1, 2, 4, 6, 7, 8, 9, 16, 25]) {
      const actual = generatedClock.sample(p, position % 8, position / p.fps, position);
      expect(actual).toEqual(
        originalClock.sample(before, position % 8, position / p.fps, position),
      );
      expect(generatedClock.origins()).toEqual(originalClock.origins());
      expect(Object.keys(actual)).toHaveLength(2);
    }
    expect(p.symbols).toEqual(before.symbols);
  }
});

it('preserves movie lifetimes under loop, once and single graphic roots including reentry', () => {
  for (const mode of ['loop', 'once', 'single'] as const) {
    for (const intermittent of [false, true]) {
      const p = fixture(mode);
      const child = p.symbols![1].shapes[0];
      child.symbolPlayback = { mode: 'movie', firstFrame: 2 };
      if (intermittent)
        p.symbols![1].timeline!.keys = [
          { frame: 2, shapes: [] },
          { frame: 4, shapes: [clone(child)] },
        ];
      const before = clone(p);
      generateMotionFrames(p, [p.layers[0].id], 0, 6, 'in');
      const originalClock = createMovieTreeClock(),
        generatedClock = createMovieTreeClock();
      for (let position = 0; position <= 25; position++) {
        const actual = generatedClock.sample(p, position % 8, position / p.fps, position);
        expect(actual).toEqual(
          originalClock.sample(before, position % 8, position / p.fps, position),
        );
        expect(generatedClock.origins()).toEqual(originalClock.origins());
        if (!intermittent) expect(Object.values(actual)).toEqual([position]);
      }
      expect(p.symbols).toEqual(before.symbols);
      expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
    }
  }
});

it('keeps authored movie endpoint offsets and elapsed clocks independent', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
  p.layers[0].keys[1].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 4 };
  p.symbols![1].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 2 };
  const before = clone(p);
  generateMotionFrames(p, [p.layers[0].id], 0, 6, 'in');
  const originalClock = createMovieTreeClock(),
    generatedClock = createMovieTreeClock();
  for (let position = 0; position <= 25; position++) {
    const actual = generatedClock.sample(p, position % 8, position / p.fps, position);
    expect(actual).toEqual(originalClock.sample(before, position % 8, position / p.fps, position));
    expect(generatedClock.origins()).toEqual(originalClock.origins());
    expect(Object.values(actual)[0]).toBe(position);
  }
  for (let frame = 1; frame < 6; frame++)
    expect(p.layers[0].keys[frame].shapes[0].symbolPlayback).toEqual({
      mode: 'movie',
      firstFrame: 1,
    });
  expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
  expect(p.symbols).toEqual(before.symbols);
});

it('preserves authored movie-graphic transitions and nested lifetime boundaries', () => {
  for (const graphic of ['loop', 'once', 'single'] as const) {
    for (const enterMovie of [false, true]) {
      const p = fixture();
      p.layers[0].keys[0].shapes[0].symbolPlayback = {
        mode: enterMovie ? graphic : 'movie',
        firstFrame: 1,
      };
      p.layers[0].keys[1].shapes[0].symbolPlayback = {
        mode: enterMovie ? 'movie' : graphic,
        firstFrame: 2,
      };
      p.symbols![1].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
      const before = clone(p);
      generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear');
      for (const samples of [[...Array(26).keys()], [0, 5, 7, 9, 15, 17, 25]]) {
        const originalClock = createMovieTreeClock(),
          generatedClock = createMovieTreeClock();
        for (const position of samples) {
          const actual = generatedClock.sample(p, position % 8, position / p.fps, position);
          expect(actual).toEqual(
            originalClock.sample(before, position % 8, position / p.fps, position),
          );
          expect(generatedClock.origins()).toEqual(originalClock.origins());
        }
      }
      for (let frame = 1; frame < 6; frame++)
        expect(p.layers[0].keys[frame].shapes[0].symbolPlayback!.mode).toBe(
          enterMovie ? graphic : 'movie',
        );
      expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
      expect(p.symbols).toEqual(before.symbols);
    }
  }
});

it('preserves referenced buttons beneath movie roots in main and detached symbol motion', () => {
  const p = fixture();
  p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
  for (const k of p.layers[0].keys) k.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
  const before = clone(p);
  generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear');
  for (const k of p.layers[0].keys)
    expect(k.shapes[0].symbolPlayback).toEqual({ mode: 'movie', firstFrame: 1 });
  expect(p.symbols).toEqual(before.symbols);
  const def: SymbolDefinition = {
    id: 'container',
    name: 'Container',
    width: 200,
    height: 200,
    shapes: before.layers[0].keys[0].shapes,
    timeline: { duration: 8, keys: before.layers[0].keys.slice(1) },
  };
  const saved = clone(def);
  const result = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    6,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    [...p.symbols!, def],
  );
  expect(result.timeline!.keys).toHaveLength(6);
  expect(def).toEqual(saved);
});
it('rejects direct buttons, graphic-root cache reuse, changed root mode and malformed mappings atomically', () => {
  for (const mode of ['direct', 'cache', 'direct-cache', 'target', 'mapping'] as const) {
    const p = fixture();
    p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
    for (const k of p.layers[0].keys) k.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 1 };
    if (mode === 'direct') for (const k of p.layers[0].keys) k.shapes[0].symbolId = 'inner';
    if (mode === 'target') p.layers[0].keys[1].shapes[0].symbolPlayback!.mode = 'loop';
    if (mode === 'mapping') p.symbols![0].buttonStates!.hit = 3;
    if (mode === 'cache' || mode === 'direct-cache') {
      const layer = clone(p.layers[0]);
      layer.id = 'later';
      for (const k of layer.keys) {
        if (mode === 'cache') k.shapes[0].symbolPlayback!.mode = 'loop';
        else k.shapes[0].symbolId = 'inner';
      }
      p.layers.push(layer);
    }
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        6,
        'linear',
      ),
    ).toThrow(/button/i);
    expect(p).toEqual(before);
  }
});

it('keeps nested movie origins beneath graphic motion roots with button descendants', () => {
  for (const mode of ['loop', 'once', 'single'] as const) {
    const p = fixture(mode);
    p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
    const movie: SymbolDefinition = {
      id: 'boundary',
      name: 'Boundary',
      width: 20,
      height: 20,
      shapes: [clone(p.symbols![1].shapes[0])],
    };
    p.symbols!.push(movie);
    p.symbols![1].shapes = [
      { ...symbolInstance(movie, 0, 0), symbolPlayback: { mode: 'movie', firstFrame: 0 } },
    ];
    p.symbols![1].timeline!.keys = [
      { frame: 2, shapes: [] },
      { frame: 3, shapes: clone(p.symbols![1].shapes) },
    ];
    const before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear');
    for (const samples of [[...Array(26).keys()], [0, 5, 7, 9, 15, 17, 25]]) {
      const original = createMovieTreeClock(),
        generated = createMovieTreeClock();
      for (const position of samples) {
        expect(generated.sample(p, position % 8, position / p.fps, position)).toEqual(
          original.sample(before, position % 8, position / p.fps, position),
        );
        expect(generated.origins()).toEqual(original.origins());
      }
    }
    expect(p.symbols).toEqual(before.symbols);
    expect(p.layers[0].keys[6]).toEqual(before.layers[0].keys[1]);
  }
});
it('does not treat a movie flag on a button as a containing movie or leak sibling permissions', () => {
  for (const sibling of [false, true]) {
    const p = fixture();
    p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
    const child = p.symbols![1].shapes[0];
    child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    if (sibling) {
      const movie: SymbolDefinition = {
        id: 'boundary',
        name: 'Boundary',
        width: 20,
        height: 20,
        shapes: [clone(child)],
      };
      p.symbols!.push(movie);
      p.symbols![1].shapes.unshift({
        ...symbolInstance(movie, 0, 0),
        symbolPlayback: { mode: 'movie', firstFrame: 0 },
      });
    }
    const before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 6, 'linear')).toThrow(/button/i);
    expect(p).toEqual(before);
  }
});
