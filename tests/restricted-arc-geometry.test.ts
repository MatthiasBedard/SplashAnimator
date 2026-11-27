import { afterEach, expect, it, vi } from 'vitest';
import {
  bindRestrictedArcGeometry as bind,
  splitRestrictedArcGeometry as split,
  type RestrictedArcGeometry,
} from '../packages/animation/src/restricted-arc-geometry';
import { createCubicDistanceCorrespondence } from '../packages/animation/src/motion-path';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(scale = 1, reflection = 1): RestrictedArcGeometry {
  const cubic: RestrictedArcGeometry['cubic'] = [
    { x: 0, y: 0 },
    { x: 32 * scale * reflection, y: -40 * scale },
    { x: 64 * scale * reflection, y: 0 },
    { x: 96 * scale * reflection, y: 24 * scale },
  ];
  return { descriptor: { version: 1, cubic, from: 0, to: 1 }, origin: { x: 0, y: 0 }, cubic };
}
function polynomial(g: RestrictedArcGeometry, progress: number) {
  const map = createCubicDistanceCorrespondence([g.descriptor.cubic]),
    t = map.parameter(progress),
    u = 1 - t;
  return {
    x:
      u ** 3 * g.cubic[0].x +
      3 * u * u * t * g.cubic[1].x +
      3 * u * t * t * g.cubic[2].x +
      t ** 3 * g.cubic[3].x,
    y:
      u ** 3 * g.cubic[0].y +
      3 * u * u * t * g.cubic[1].y +
      3 * u * t * t * g.cubic[2].y +
      t ** 3 * g.cubic[3].y,
  };
}
for (const progress of [0.25, 0.5, 0.75])
  for (const reflection of [1, -1])
    it(`binds asymmetric actual halves at ${progress} with reflection ${reflection}`, () => {
      const g = fixture(1, reflection),
        source = bind(g),
        before = structuredClone(g);
      const halves = split({ geometry: g, progress, middle: source.sample(progress) }).map((h) =>
        bind(JSON.parse(JSON.stringify(h))),
      );
      for (let i = 0; i <= 128; i++) {
        const t = i / 128,
          expected = polynomial(g, t),
          actual =
            t <= progress
              ? halves[0].sample(t / progress)
              : halves[1].sample((t - progress) / (1 - progress));
        expect(actual.x).toBeCloseTo(expected.x, 11);
        expect(actual.y).toBeCloseTo(expected.y, 11);
      }
      expect(g).toEqual(before);
      expect(halves[0].geometry.cubic[0]).toEqual({ x: 0, y: 0 });
      expect(halves[1].geometry.cubic[0]).toEqual({ x: 0, y: 0 });
    });
it('recursively binds reopened halves to the same original cubic instead of fitting fresh timing', () => {
  const g = fixture(),
    halves = split({ geometry: g, progress: 0.5, middle: bind(g).sample(0.5) });
  for (let side = 0; side < 2; side++) {
    const h = JSON.parse(JSON.stringify(halves[side])) as RestrictedArcGeometry;
    const quarters = split({ geometry: h, progress: 0.5, middle: bind(h).sample(0.5) });
    for (let j = 0; j < 2; j++) {
      expect(quarters[j].descriptor.cubic).toEqual(g.cubic);
      const map = bind(quarters[j]);
      for (let i = 0; i <= 32; i++) {
        const absolute = side * 0.5 + j * 0.25 + i / 128;
        const wanted = polynomial(g, absolute),
          actual = map.sample(i / 32);
        expect(actual.x).toBeCloseTo(wanted.x, 11);
        expect(actual.y).toBeCloseTo(wanted.y, 11);
      }
    }
  }
});
for (const scale of [0.001, 1000])
  it(`retains relative numerics at scale ${scale}`, () => {
    const g = fixture(scale),
      middle = bind(g).sample(0.5);
    const h = split({ geometry: g, progress: 0.5, middle });
    expect(sameMotionArtwork(bind(h[1]).sample(0.5), bind(g).sample(0.75))).toBe(true);
  });
it('samples remain detached from input, returned public geometry and later edits', () => {
  const g = fixture(),
    captured = bind(g),
    wanted = captured.sample(0.4);
  g.cubic[1].y++;
  captured.geometry.cubic[1].y += 10;
  captured.geometry.origin.x++;
  expect(captured.sample(0.4)).toEqual(wanted);
});
it('retains the stationary cubic timing convention and exact zero geometry on both sides', () => {
  const g = fixture();
  g.cubic.forEach((p) => {
    p.x = 0;
    p.y = 0;
  });
  const halves = split({ geometry: g, progress: 0.25, middle: { x: 0, y: 0 } });
  for (const half of halves) expect(bind(half).sample(0.75)).toEqual({ x: 0, y: 0 });
});
for (const part of [0, 1, 2, 3])
  it(`rejects changed actual control ${part}`, () => {
    const g = structuredClone(fixture());
    g.cubic = structuredClone(g.cubic);
    g.cubic[part].x++;
    expect(() => bind(g)).toThrow();
  });
it('rejects a changed authored origin and an independently forged promoted endpoint', () => {
  const g = fixture();
  g.origin.y = 0.01;
  expect(() => bind(g)).toThrow(/origin/);
  g.origin.y = 0;
  expect(() => split({ geometry: g, progress: 0.5, middle: { x: 48, y: 12 } })).toThrow(/middle/);
});
for (const progress of [NaN, Infinity, 0, 1, -0.5])
  it(`rejects raw split progress ${progress}`, () => {
    expect(() => split({ geometry: fixture(), progress, middle: { x: 0, y: 0 } })).toThrow();
  });
it('rejects getters before cloning or reading their values', () => {
  const g = fixture();
  let reads = 0;
  Object.defineProperty(g.origin, 'x', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() => bind(g)).toThrow();
  expect(reads).toBe(0);
});
for (const action of ['source', 'clone', 'alias'] as const)
  it(`rejects ${action} capture corruption`, () => {
    const g = fixture(),
      clone = structuredClone;
    vi.stubGlobal('structuredClone', (value: RestrictedArcGeometry) => {
      if (action === 'alias') return value;
      const result = clone(value);
      (action === 'source' ? value : result).origin.x++;
      return result;
    });
    expect(() => bind(g)).toThrow();
  });
it('rechecks both admitted halves after a later half clone mutates the first', () => {
  const g = fixture(),
    clone = structuredClone;
  let first: RestrictedArcGeometry | undefined,
    fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value),
      candidate = value as RestrictedArcGeometry;
    if (candidate?.descriptor?.from === 0 && candidate.descriptor.to === 0.5 && candidate.cubic)
      first = candidate;
    if (first && candidate?.descriptor?.from === 0.5 && candidate.cubic && !fired) {
      first.cubic[1].y++;
      fired = true;
    }
    return out;
  });
  expect(() => split({ geometry: g, progress: 0.5, middle: bind(g).sample(0.5) })).toThrow(
    /changed/,
  );
  expect(fired).toBe(true);
});
