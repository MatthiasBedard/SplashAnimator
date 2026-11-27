import { afterEach, expect, it, vi } from 'vitest';
import { createLiveMovieSession, type LiveMovieFrame } from '../apps/editor/src/live-movie-session';
import { liveSplitFixture } from './live-motion-split-fixture';
import { livePresentationFixture } from './live-motion-presentation-fixture';
import { withLayerScene } from '../packages/animation/src/layer-scene';
import { createMaskPreviewSession } from '../apps/editor/src/mask-preview-session';
import { layerPresentationFixture, rect } from './layer-presentation-fixture';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import * as movieModule from '../packages/animation/src/movie-pose-clock';
import * as buttonModule from '../packages/animation/src/button-preview';

const ink = (phase: LiveMovieFrame, color: string) =>
  phase.presentation.layers.flatMap((l) => l.shapes).find((s) => s.fill === color)!;
afterEach(() => vi.restoreAllMocks());

it('samples sparse roots at exact ticks without baking or running saved scripts', () => {
  const p = liveSplitFixture();
  p.fps = 10;
  p.frameScripts = [{ frame: 0, source: "throw new Error('scripts stay inert')" }];
  const before = structuredClone(p),
    s = createLiveMovieSession(p, 0);
  expect(ink(s.current(), '#ff0000').x).toBe(8);
  for (let f = 1; f <= 8; f++) {
    const phase = s.advance(true);
    expect([phase.tick, phase.frame, phase.position, phase.seconds]).toEqual([f, f, f, f / 10]);
    expect(ink(phase, '#ff0000').x).toBe(8 + 10 * f);
  }
  expect(p).toEqual(before);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  s.dispose();
});

it('reuses one admitted phase for native retries and invalidates old/forged scenes', () => {
  const s = createLiveMovieSession(liveSplitFixture(), 0),
    a = s.current();
  const scene = s.scene(a);
  expect(s.current()).toBe(a);
  expect(s.scene(a)).toBe(scene);
  expect(() => s.scene({ ...a })).toThrow();
  expect(withLayerScene(scene, (d) => d.layers[0].shapes[0].x)).toBe(8);
  s.advance(true);
  expect(() => s.assertCurrent(a)).toThrow();
  expect(() => withLayerScene(scene, () => {})).toThrow();
  s.dispose();
  expect(() => s.current()).toThrow();
});

it.each(['graphic', 'movie', 'button'])(
  'preserves original %s clocks while the root pauses',
  (mode) => {
    const p = livePresentationFixture(mode);
    p.fps = 10;
    const before = structuredClone(p),
      s = createLiveMovieSession(p, 0);
    s.current();
    const a = s.advance(true),
      b = s.advance(true),
      c = s.advance(false);
    expect(ink(a, '#0000ff').x).toBe(mode === 'graphic' ? 0 : 40);
    expect(ink(b, '#0000ff').x).toBe(mode === 'graphic' ? 20 : 60);
    expect(ink(c, '#0000ff').x).toBe(mode === 'graphic' ? 20 : 120);
    expect(ink(c, '#ff0000').x).toBe(ink(b, '#ff0000').x);
    expect([c.frame, c.tick, c.seconds]).toEqual([2, 3, 0.3]);
    expect(p).toEqual(before);
    s.dispose();
  },
);

it('cancels captured input on changed placement alpha without resetting the stable button clock', () => {
  const p = livePresentationFixture('button');
  p.opacityBindings = [
    {
      layerId: 'graphic',
      shapeId: 'instance',
      start: 1,
      end: 4,
      keys: [
        { frame: 1, opacity: 0.2 },
        { frame: 4, opacity: 0.8 },
      ],
    },
  ];
  const s = createLiveMovieSession(p, 1),
    a = s.current(),
    token = a.presentation.buttons[0].token;
  s.current({ over: token, down: token });
  const b = s.advance(true, { over: token, down: token });
  expect(b.presentation.buttons[0].token).toBe(token);
  expect(b.input).toEqual({ over: null, down: null });
  expect(ink(b, '#0000ff').x).toBe(60);
  s.dispose();
});

it('keeps Hit poses frozen while button artwork advances and same-tick input retries stay exact', () => {
  const s = createLiveMovieSession(livePresentationFixture('button'), 0);
  s.current();
  const a = s.advance(true),
    pick = s.pick(a, { x: 45, y: 45 })!;
  expect(pick).toBeDefined();
  const hovered = s.current({ over: pick.token, down: null });
  expect(hovered.tick).toBe(1);
  expect(s.current({ over: pick.token, down: null })).toBe(hovered);
  const b = s.advance(true, hovered.input);
  expect(ink(b, '#0000ff').x).toBe(60);
  expect(s.pick(b, { x: 45, y: 45 })?.token).toBe(pick.token);
  expect(s.pick(b, { x: 65, y: 45 })).toBeUndefined();
  s.dispose();
});

it('blocks a button behind the actual sampled foreground instead of its held endpoint', () => {
  const p = livePresentationFixture('button');
  for (const key of p.layers[0].keys) for (const shape of key.shapes) shape.y = 40;
  p.layers.reverse();
  const s = createLiveMovieSession(p, 0);
  s.current();
  const a = s.advance(true);
  expect(s.pick(a, { x: 45, y: 45 })).toBeDefined();
  const b = s.advance(true);
  expect(ink(b, '#ff0000').x).toBe(40);
  expect(s.pick(b, { x: 45, y: 45 })).toBeUndefined();
  expect(b.presentation.buttons[0].token).toBe(a.presentation.buttons[0].token);
  s.dispose();
});

it('prunes vanished button exposures and clears captured input', () => {
  const p = livePresentationFixture('button');
  p.layers[1].keys.push({ frame: 3, shapes: [] });
  const s = createLiveMovieSession(p, 0);
  s.current();
  const a = s.advance(true),
    token = a.presentation.buttons[0].token;
  const b = s.advance(true, { over: token, down: token });
  expect(b.input).toEqual({ over: token, down: token });
  const c = s.advance(true, b.input);
  expect(c.input).toEqual({ over: null, down: null });
  expect(c.presentation.buttons).toEqual([]);
  s.dispose();
});

it.each(['endpoint', 'hold', 'blank', 'hidden', 'transparent'])(
  'keeps live %s foreground consistent with visible root artwork',
  (mode) => {
    const p = livePresentationFixture('button');
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.y = 40;
        if (mode === 'transparent') shape.opacity = 0;
      }
    p.layers[1].keys[1].shapes[0].x = 40;
    if (mode === 'hidden') p.layers[0].visible = false;
    p.layers.reverse();
    const s = createLiveMovieSession(p, mode === 'hold' ? 7 : mode === 'blank' ? 8 : 4),
      a = s.current();
    expect(s.pick(a, { x: 85, y: 45 }) === undefined).toBe(mode === 'endpoint' || mode === 'hold');
    s.dispose();
  },
);

it('rejects forged/getter input before clocks advance and snapshots raw pointer data', () => {
  const s = createLiveMovieSession(liveSplitFixture(), 0),
    a = s.current();
  expect(() => s.advance(true, { over: 'forged', down: null })).toThrow();
  let reads = 0;
  const input = {
    get over() {
      reads++;
      return null;
    },
    down: null,
  };
  expect(() => s.advance(true, input)).toThrow();
  expect(() =>
    s.pick(a, {
      get x() {
        reads++;
        return 0;
      },
      y: 0,
    }),
  ).toThrow();
  expect(reads).toBe(0);
  expect(s.current()).toBe(a);
  expect(s.advance(true).tick).toBe(1);
  s.dispose();
});

it('permanently closes after original source mutation even when restored', () => {
  const p = liveSplitFixture(),
    s = createLiveMovieSession(p, 0);
  s.current();
  p.layers[0].keys[0].shapes[0].x++;
  expect(() => s.advance(true)).toThrow();
  p.layers[0].keys[0].shapes[0].x--;
  expect(() => s.restart()).toThrow();
});

it('rejects original clone corruption before constructing clocks', () => {
  const p = liveSplitFixture(),
    clone = structuredClone;
  let changed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const output = clone(value, options);
    if (value === p) {
      (output as typeof p).layers[0].keys[0].shapes[0].x++;
      changed = true;
    }
    return output;
  });
  expect(() => createLiveMovieSession(p, 0)).toThrow();
  expect(changed).toBe(true);
});

it('requires explicit restart after a swallowed admission reentry', () => {
  let armed = false;
  const s = createLiveMovieSession(liveSplitFixture(), 0, {
    validate() {
      if (armed) {
        try {
          s.current();
        } catch {
          /* outer admission must still fail */
        }
      }
    },
  });
  s.current();
  armed = true;
  expect(() => s.advance(true)).toThrow();
  armed = false;
  expect(() => s.current()).toThrow();
  expect(s.restart().tick).toBe(0);
  s.dispose();
});

it('captures the validator once and rejects asynchronous admission', () => {
  let reads = 0;
  const s = createLiveMovieSession(liveSplitFixture(), 0, {
    get validate() {
      reads++;
      return () => {};
    },
  });
  s.current();
  s.advance(true);
  expect(reads).toBe(1);
  s.dispose();
  expect(() =>
    createLiveMovieSession(liveSplitFixture(), 0, { validate: async () => {} }),
  ).toThrow();
});

it.each(['graphic', 'movie', 'button'])(
  'composes %s root opacity exactly once without restarting clocks',
  (mode) => {
    const p = livePresentationFixture(mode);
    p.opacityBindings = [
      {
        layerId: 'graphic',
        shapeId: 'instance',
        start: 1,
        end: 4,
        keys: [
          { frame: 1, opacity: 0.2 },
          { frame: 4, opacity: 0.8 },
        ],
      },
    ];
    const before = structuredClone(p),
      s = createLiveMovieSession(p, 0);
    s.current();
    const a = s.advance(true),
      b = s.advance(true);
    expect(ink(a, '#0000ff').opacity).toBeCloseTo(0.2);
    expect(ink(b, '#0000ff').opacity).toBeCloseTo(0.4);
    expect(ink(b, '#0000ff').x).toBe(mode === 'graphic' ? 20 : 60);
    expect(p).toEqual(before);
    s.dispose();
  },
);

it.each(['hidden', 'locked'])(
  'retains %s root visibility/placement without authoring or clock changes',
  (mode) => {
    const p = livePresentationFixture('button');
    if (mode === 'hidden') p.layers[0].visible = false;
    else p.layers[0].locked = true;
    const before = structuredClone(p),
      s = createLiveMovieSession(p, 2),
      a = s.current();
    expect(ink(a, '#ff0000')?.x).toBe(mode === 'hidden' ? undefined : 40);
    expect(ink(a, '#0000ff').x).toBe(40);
    expect(p).toEqual(before);
    s.dispose();
  },
);

it('matches existing nested ancestry/namespaces/mapping/origin lifetimes across three root loops', () => {
  const p = layerPresentationFixture(),
    legacy = createMaskPreviewSession(structuredClone(p), 0);
  const sparse = liveSplitFixture().layers[0];
  sparse.id = 'live';
  sparse.keys = [
    { frame: 0, shapes: [rect('live-art', '#ff00ff')] },
    { frame: 7, shapes: [{ ...rect('live-art', '#ff00ff'), x: 70 }] },
  ];
  delete sparse.liveMotionSpans;
  p.layers.push(sparse);
  const source = prepareCreateLiveMotionSpans(p, [
      { layerId: 'live', span: { id: 'live-span', start: 0, end: 7, ease: 'linear' } },
    ]),
    before = structuredClone(source),
    live = createLiveMovieSession(source, 0);
  for (let tick = 0; tick < 25; tick++) {
    const a = tick ? live.advance(true) : live.current();
    const b = tick ? legacy.step() : legacy.current();
    expect(a.presentation.layers.filter((l) => l.layerId !== 'live')).toEqual(
      b.presentation.layers,
    );
    expect(a.presentation.buttons).toEqual(b.presentation.buttons);
    expect(ink(a, '#ff00ff').x).toBe((tick % 8) * 10);
  }
  expect(source).toEqual(before);
  live.dispose();
  legacy.dispose();
});

it('samples one root clock and one complete prune per phase and none for native cache retries', () => {
  const makeMovie = movieModule.captureMoviePoseClock,
    makeButtons = buttonModule.createRootButtonMoviePlayback;
  const root: number[] = [],
    final: number[] = [];
  vi.spyOn(movieModule, 'captureMoviePoseClock').mockImplementation((...input) => {
    const clock = makeMovie(...input),
      sample = clock.sample;
    clock.sample = (...args) => {
      root.push(args[2]);
      return sample(...args);
    };
    return clock;
  });
  vi.spyOn(buttonModule, 'createRootButtonMoviePlayback').mockImplementation(() => {
    const clock = makeButtons(),
      sample = clock.sample;
    clock.sample = (...args) => {
      if (args[5] !== false) final.push(args[4]);
      return sample(...args);
    };
    return clock;
  });
  const p = livePresentationFixture('button');
  p.fps = 10;
  const s = createLiveMovieSession(p, 0);
  s.current();
  s.current();
  s.advance(true);
  s.current();
  s.advance(false);
  s.current();
  expect(root).toEqual([0, 0.1, 0.2]);
  expect(final).toEqual(root);
  s.dispose();
});

it('requires restart after later-track sampled overflow without returning a partial scene', () => {
  const p = liveSplitFixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  p.layers[1].liveMotionSpans![0].path = { startX: 0, startY: 50000000, endX: 0, endY: -50000000 };
  const before = structuredClone(p),
    s = createLiveMovieSession(p, 0),
    old = s.current();
  expect(() => s.advance(true)).toThrow();
  expect(() => s.assertCurrent(old)).toThrow();
  expect(() => s.current()).toThrow(/Restart/);
  expect(s.restart().tick).toBe(0);
  expect(p).toEqual(before);
  s.dispose();
});

it.each([-1, 0.5, 12, NaN, Infinity])('rejects raw starting frame %s', (frame) => {
  expect(() => createLiveMovieSession(liveSplitFixture(), frame)).toThrow();
});

it.each([NaN, Infinity, -Infinity])(
  'rejects raw nonfinite source %s without JSON normalization',
  (value) => {
    const p = liveSplitFixture();
    p.layers[0].keys[0].shapes[0].x = value;
    expect(() => createLiveMovieSession(p, 0)).toThrow();
  },
);

it('rejects raw source getters without invoking them', () => {
  const p = liveSplitFixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 8;
    },
  });
  expect(() => createLiveMovieSession(p, 0)).toThrow();
  expect(reads).toBe(0);
});

it.each(['source', 'dispose', 'input'])(
  'rejects actual late %s after the complete scene presentation is cloned',
  (change) => {
    const p = liveSplitFixture(),
      s = createLiveMovieSession(p, 0);
    s.current();
    const input = { over: null, down: null },
      clone = structuredClone;
    let changed = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      // Layer-scene output is the complete array of posed layers, after root and clock work.
      if (
        !changed &&
        Array.isArray(value) &&
        value[0]?.layerId === 'track' &&
        value[0]?.shapes?.[0]?.x === 18
      ) {
        changed = true;
        if (change === 'source') p.layers[0].keys[0].shapes[0].fill = '#00ff00';
        else if (change === 'dispose') s.dispose();
        else Object.assign(input, { down: 'forged' });
      }
      return out;
    });
    expect(() => s.advance(true, input)).toThrow();
    expect(changed).toBe(true);
    s.dispose();
  },
);

it.each(['source', 'pointer'])(
  'rejects late %s after privately picked button detachment',
  (change) => {
    const p = livePresentationFixture('button'),
      s = createLiveMovieSession(p, 1),
      a = s.current();
    const point = { x: 45, y: 45 },
      clone = structuredClone;
    let changed = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      if (
        !changed &&
        value &&
        typeof value === 'object' &&
        'token' in value &&
        value.token === a.presentation.buttons[0].token
      ) {
        changed = true;
        if (change === 'source') p.layers[0].keys[0].shapes[0].fill = '#00ff00';
        else point.x++;
      }
      return out;
    });
    expect(() => s.pick(a, point)).toThrow();
    expect(changed).toBe(true);
    s.dispose();
  },
);
