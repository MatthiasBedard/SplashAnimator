import { afterEach, expect, it, vi } from 'vitest';
import { newProject, validateProject, type Project } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { evaluate } from '../packages/animation/src';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import { livePresentationFixture } from './live-motion-presentation-fixture';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const p = livePresentationFixture('movie');
  p.fps = 10;
  p.duration = 12;
  const root = p.layers[1].keys[1].shapes[0];
  p.layers[1].keys = [
    { frame: 0, shapes: [] },
    { frame: 1, shapes: [root] },
    { frame: 3, shapes: [{ ...root, x: 10 }] },
    { frame: 6, shapes: [] },
    { frame: 8, shapes: [structuredClone(root)] },
  ];
  validateProject(p);
  return p;
}
function shifted(p: Project, frame: number, x = 100) {
  const view = structuredClone(p);
  delete view.layers[0].liveMotionSpans;
  const layer = view.layers[1],
    held = layer.keys.filter((k) => k.frame <= frame).at(-1)!;
  layer.keys = layer.keys.filter((k) => k.frame !== frame);
  layer.keys.push({ frame, shapes: held.shapes.map((s) => ({ ...s, x })) });
  layer.keys.sort((a, b) => a.frame - b.frame);
  return view;
}
const id = 'graphic/instance/child';

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
  'replays original lifetime at %i despite a detached current-frame geometry key',
  (frame) => {
    const p = fixture(),
      before = structuredClone(p),
      clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      view = shifted(p, frame),
      pose = clock.capture(view),
      time = clock.replay(pose, frame);
    if (frame === 6 || frame === 7) {
      expect(time.frames).toEqual({});
      expect(time.origins).toEqual({});
    } else {
      const birth = frame < 6 ? 1 : 8,
        age = frame - birth;
      expect(time.frames).toEqual({ [id]: age });
      expect(time.origins).toEqual({ [id]: birth / 10 });
      const blue = evaluate(pose.project, frame, time.frames).find((s) => s.fill === '#0000ff')!;
      expect(blue.x).toBe(100 + [0, 20, 40, 60, 120][(2 + age) % 5]);
      expect(blue.y).toBe(40);
    }
    expect(p).toEqual(before);
    expect(view).toEqual(shifted(p, frame));
    clock.dispose();
  },
);

it('keeps preview age independent through pause/wrap and keeps integer replay independent of preview', () => {
  const p = fixture(),
    clock = captureMoviePoseClock(() => ({ project: p, revision: 2 }));
  const a = clock.capture(shifted(p, 2)),
    b = clock.capture(shifted(p, 3, 140));
  expect(clock.sample(a, 2, 10, 2).frames[id]).toBe(0);
  expect(clock.sample(b, 3, 10.1, 3).frames[id]).toBe(1);
  expect(clock.sample(b, 3, 11, 3).frames[id]).toBe(10);
  expect(clock.replay(b, 3).frames[id]).toBe(2);
  expect(clock.sample(b, 3, 11.1, 3).frames[id]).toBe(11);
  // A full root loop crosses the original blank and reenters at position20.
  expect(clock.sample(b, 9, 12.9, 21).frames[id]).toBe(1);
  expect(clock.sample(a, 2, 13.4, 26).frames[id]).toBe(1);
  clock.reset();
  expect(clock.sample(b, 3, 30, 3).frames[id]).toBe(0);
});

it.each(['loop', 'once', 'single'] as const)(
  'retains pure nested %s graphic exposure origins beneath an independently moving movie',
  (mode) => {
    const p = newProject();
    p.fps = 10;
    p.duration = 12;
    p.layers[0].id = 'root';
    const ink = { ...livePresentationFixture().symbols![0].shapes[0], id: 'ink' };
    const leaf = {
      id: 'leaf',
      name: 'Leaf',
      width: 160,
      height: 20,
      shapes: [ink],
      timeline: {
        duration: 4,
        keys: [1, 2, 3].map((frame) => ({
          frame,
          shapes: [{ ...ink, x: 10 * frame }],
        })),
      },
    };
    const child = {
      ...symbolInstance(leaf, 0, 0),
      id: 'nested',
      symbolPlayback: { mode, firstFrame: 1 },
    };
    const parent = {
      id: 'parent',
      name: 'Parent',
      width: 160,
      height: 20,
      shapes: [child],
      timeline: {
        duration: 6,
        keys: [
          { frame: 2, shapes: [] },
          { frame: 4, shapes: [child] },
        ],
      },
    };
    p.symbols = [parent, leaf];
    const root = {
      ...symbolInstance(parent, 0, 40),
      id: 'movie',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 1 },
    };
    p.layers[0].keys = [{ frame: 0, shapes: [root] }];
    const clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
    for (let frame = 0; frame < 12; frame++) {
      const view = structuredClone(p);
      // Insert only within the timeline and retain the original lifetime.
      view.layers[0].keys = [
        { frame: 0, shapes: [root] },
        ...(frame ? [{ frame, shapes: [{ ...root, x: 100 + frame }] }] : []),
      ];
      const pose = clock.capture(view),
        time = clock.replay(pose, frame),
        art = evaluate(pose.project, frame, time.frames),
        local = (1 + frame) % 6;
      expect(time.frames['root/movie/parent']).toBe(frame);
      expect(time.origins['root/movie/parent']).toBe(0);
      if (local === 2 || local === 3) expect(art).toHaveLength(0);
      else {
        const age = local >= 4 ? local - 4 : local;
        const childFrame =
          mode === 'single' ? 1 : mode === 'once' ? Math.min(1 + age, 3) : (1 + age) % 4;
        expect(art[0].x).toBe((frame ? 100 + frame : 0) + 10 * childFrame);
        expect(art[0].y).toBe(40);
      }
    }
  },
);

it.each([
  'first',
  'identity',
  'definition',
  'birth',
  'blank',
  'visibility',
  'duration',
  'fps',
  'library',
])('rejects detached %s topology changes before consuming valid clock state', (kind) => {
  const p = fixture(),
    clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
    good = clock.capture(shifted(p, 3));
  clock.sample(good, 3, 1, 3);
  const bad = shifted(p, 3),
    layer = bad.layers[1];
  if (kind === 'first') layer.keys[1].shapes[0].symbolPlayback!.firstFrame++;
  if (kind === 'identity') layer.keys[1].shapes[0].id += 'other';
  if (kind === 'definition') layer.keys[1].shapes[0].symbolId = 'missing';
  if (kind === 'birth') layer.keys[1].frame = 2;
  if (kind === 'blank') layer.keys = layer.keys.filter((k) => k.frame !== 6);
  if (kind === 'visibility') layer.visible = false;
  if (kind === 'duration') bad.duration++;
  if (kind === 'fps') bad.fps++;
  if (kind === 'library') bad.symbols![0].timeline!.keys[0].shapes[0].x++;
  expect(() => clock.capture(bad)).toThrow();
  expect(clock.sample(good, 3, 1.1, 3).frames[id]).toBe(1);
});

it('detaches source poses and results and rejects forged, cross-owner, mutated and disposed handles', () => {
  const p = fixture(),
    reader = () => ({ project: p, revision: 0 }),
    clock = captureMoviePoseClock(reader),
    other = captureMoviePoseClock(reader),
    view = shifted(p, 3),
    pose = clock.capture(view);
  view.layers[1].keys[2].shapes[0].x++;
  expect(pose.project.layers[1].keys[2].shapes[0].x).toBe(100);
  expect(() => clock.sample({ ...pose }, 3, 0, 3)).toThrow();
  expect(() => other.sample(pose, 3, 0, 3)).toThrow();
  const time = clock.sample(pose, 3, 0, 3);
  expect(Object.isFrozen(time.frames) && Object.isFrozen(time.origins)).toBe(true);
  pose.project.layers[1].keys[2].shapes[0].x++;
  expect(() => clock.sample(pose, 3, 0.1, 3)).toThrow();
  clock.dispose();
  expect(() => clock.reset()).toThrow();
  expect(() => clock.capture(shifted(p, 3))).toThrow();
});

it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects raw frame/position %s without advancing the preview clock',
  (bad) => {
    const p = fixture(),
      clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      pose = clock.capture(shifted(p, 3));
    clock.sample(pose, 3, 0, 3);
    expect(() => clock.sample(pose, bad, 0.1, 3)).toThrow();
    expect(() => clock.sample(pose, 3, 0.1, bad)).toThrow();
    expect(() => clock.replay(pose, bad)).toThrow();
    expect(clock.sample(pose, 3, 0.1, 3).frames[id]).toBe(1);
  },
);

it('rejects nonfinite/accessor original inputs without reading getters', () => {
  const p = fixture();
  let reads = 0;
  const clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
  const view = shifted(p, 3);
  Object.defineProperty(view.layers[1].keys[2].shapes[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 100;
    },
  });
  expect(() => clock.capture(view)).toThrow();
  expect(reads).toBe(0);
  expect(() =>
    captureMoviePoseClock(() => ({
      get project() {
        reads++;
        return p;
      },
      revision: 0,
    })),
  ).toThrow();
  expect(reads).toBe(0);
  const invalid = shifted(p, 3);
  invalid.layers[1].keys[2].shapes[0].x = NaN;
  expect(() => clock.capture(invalid)).toThrow();
});

it.each(['revision', 'source', 'library'])('rejects stale original %s ownership', (kind) => {
  const p = fixture();
  let revision = 0,
    source = p;
  const clock = captureMoviePoseClock(() => ({ project: source, revision })),
    pose = clock.capture(shifted(p, 3));
  if (kind === 'revision') revision++;
  if (kind === 'source') source = structuredClone(p);
  if (kind === 'library') p.symbols![0].shapes[0].x++;
  expect(() => clock.sample(pose, 3, 0, 3)).toThrow();
  expect(() => clock.replay(pose, 3)).toThrow();
});

it.each(['source', 'pose', 'output'])(
  'rejects late %s changes during detached pose cloning',
  (kind) => {
    const p = fixture(),
      clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      view = shifted(p, 3),
      clone = structuredClone;
    let hit = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      if (value === view) {
        hit = true;
        if (kind === 'source') p.layers[1].keys[1].shapes[0].x++;
        else (kind === 'pose' ? view : (out as Project)).layers[1].keys[2].shapes[0].x++;
      }
      return out;
    });
    expect(() => clock.capture(view)).toThrow();
    expect(hit).toBe(true);
  },
);

it('rejects swallowed first-reader reentry and later reentry, then permits a fresh capture', () => {
  const p = fixture();
  let armed = true;
  const reader = () => {
    if (armed) expect(() => captureMoviePoseClock(reader)).toThrow();
    return { project: p, revision: 0 };
  };
  expect(() => captureMoviePoseClock(reader)).toThrow();
  armed = false;
  const clock = captureMoviePoseClock(reader),
    pose = clock.capture(shifted(p, 3));
  armed = true;
  expect(() => clock.replay(pose, 3)).toThrow();
  armed = false;
  expect(clock.replay(pose, 3).frames[id]).toBe(2);
});

it('keeps both unmarked and graphics-marker movie authoring requests rejected', () => {
  const p = fixture();
  p.layers[1].keys = [
    p.layers[1].keys[1],
    { frame: 5, shapes: structuredClone(p.layers[1].keys[1].shapes) },
  ];
  p.layers[1].keys.unshift({ frame: 0, shapes: [] });
  for (const symbolContinuity of [undefined, 'graphics'] as const)
    expect(() =>
      prepareCreateLiveMotionSpans(p, [
        {
          layerId: 'graphic',
          span: {
            id: 'movie-live',
            start: 1,
            end: 5,
            ease: 'linear',
            symbolContinuity,
          },
        },
      ]),
    ).toThrow();
});

it.each(['plain', 'affine', 'reflected'])(
  'moves detached %s movie geometry while original age drives independently calculated world points',
  (basis) => {
    const p = fixture(),
      clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      view = shifted(p, 4, -120),
      root = view.layers[1].keys.find((k) => k.frame === 4)!.shapes[0];
    root.rotation = 30;
    root.width = 320;
    root.height = 40;
    const a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
      b = basis === 'plain' ? 0 : 0.25,
      c = basis === 'plain' ? 0 : 0.5,
      d = basis === 'plain' ? 1 : 3;
    root.transform = [a, b, c, d];
    const pose = clock.capture(view),
      time = clock.replay(pose, 4),
      blue = evaluate(pose.project, 4, time.frames).find((s) => s.fill === '#0000ff')!;
    expect(time.frames[id]).toBe(3);
    // (first2 + age3) wraps to child0. Double definition-to-instance scale,
    // then the independent authored shear/reflection and30-degree rotation.
    const x = 3 * 2,
      y = 7 * 2,
      r = Math.PI / 6,
      actual = mapPoint(matrix(blue), { x: 3, y: 7 });
    expect(actual.x).toBeCloseTo(
      -120 + Math.cos(r) * (a * x + c * y) - Math.sin(r) * (b * x + d * y),
      10,
    );
    expect(actual.y).toBeCloseTo(
      40 + Math.sin(r) * (a * x + c * y) + Math.cos(r) * (b * x + d * y),
      10,
    );
  },
);

it.each(['sample', 'replay'] as const)(
  'rejects a pose changed by the final source callback during %s',
  (method) => {
    const p = fixture();
    let armed = false,
      calls = 0;
    const reader = () => {
      if (armed && ++calls === 3) pose.project.layers[1].keys[2].shapes[0].x++;
      return { project: p, revision: 0 };
    };
    const clock = captureMoviePoseClock(reader),
      pose = clock.capture(shifted(p, 3));
    armed = true;
    expect(() =>
      method === 'sample' ? clock.sample(pose, 3, 0, 3) : clock.replay(pose, 3),
    ).toThrow();
    expect(calls).toBe(3);
    armed = false;
    pose.project.layers[1].keys[2].shapes[0].x--;
    if (method === 'sample') {
      expect(() => clock.sample(pose, 3, 0.1, 3)).toThrow();
      clock.reset();
    }
    expect(clock.replay(pose, 3).frames[id]).toBe(2);
    expect(clock.sample(pose, 3, 5, 3).frames[id]).toBe(0);
  },
);

it('rejects input changed by the final source callback after complete pose construction', () => {
  const p = fixture(),
    view = shifted(p, 3);
  let armed = false,
    calls = 0;
  const clock = captureMoviePoseClock(() => {
    if (armed && ++calls === 4) view.layers[1].keys[2].shapes[0].x++;
    return { project: p, revision: 0 };
  });
  armed = true;
  expect(() => clock.capture(view)).toThrow();
  expect(calls).toBe(4);
  armed = false;
  expect(clock.replay(clock.capture(view), 3).frames[id]).toBe(2);
});

it.each([NaN, Infinity, -1, Number.MAX_VALUE])(
  'rejects invalid or overflowing clock seconds %s',
  (seconds) => {
    const p = fixture(),
      clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      pose = clock.capture(shifted(p, 3));
    expect(() => clock.sample(pose, 3, seconds, 3)).toThrow();
    expect(() => clock.sample(pose, 3, 0, 2)).toThrow();
    expect(clock.sample(pose, 3, 0, 3).frames[id]).toBe(0);
  },
);

it('rejects original clone corruption before constructing a reusable owner', () => {
  const p = fixture(),
    clone = structuredClone;
  let hit = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const output = clone(value, options);
    if (value === p) {
      hit = true;
      (output as Project).symbols![0].shapes[0].x++;
    }
    return output;
  });
  expect(() => captureMoviePoseClock(() => ({ project: p, revision: 0 }))).toThrow();
  expect(hit).toBe(true);
});

it('rejects later-track lifetime changes atomically without consuming earlier valid clocks', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[1]), id: 'later' });
  const clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
    good = clock.capture(shifted(p, 3)),
    bad = shifted(p, 3);
  clock.sample(good, 3, 0, 3);
  bad.layers[2].keys[1].shapes[0].symbolPlayback!.firstFrame++;
  expect(() => clock.capture(bad)).toThrow();
  expect(clock.sample(good, 3, 0.1, 3).frames).toEqual({ [id]: 1, 'later/instance/child': 1 });
});

it.each(['missing', 'cycle', 'aggregate'])(
  'retains original %s library rejection before owner construction',
  (kind) => {
    const p = fixture();
    if (kind === 'missing') p.layers[1].keys[1].shapes[0].symbolId = 'missing';
    if (kind === 'cycle') p.symbols![0].shapes.push(symbolInstance(p.symbols![0], 0, 0));
    if (kind === 'aggregate')
      p.symbols!.push({
        id: 'overflow',
        name: 'Overflow',
        width: 1,
        height: 1,
        shapes: Array(100000).fill(p.symbols![0].shapes[0]),
      });
    expect(() => captureMoviePoseClock(() => ({ project: p, revision: 0 }))).toThrow(
      kind === 'aggregate' ? /symbol artwork budget/ : undefined,
    );
  },
);
