import { afterEach, expect, it, vi } from 'vitest';
import {
  openRestrictedArcCorrespondence as open,
  type RestrictedArcCorrespondence,
} from '../packages/animation/src/restricted-arc-correspondence';
import { createCubicDistanceCorrespondence } from '../packages/animation/src/motion-path';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const fixture = (): RestrictedArcCorrespondence => ({
  version: 1,
  cubic: [
    { x: 0, y: 0 },
    { x: 32, y: -40 },
    { x: 64, y: 0 },
    { x: 96, y: 24 },
  ],
  from: 0,
  to: 1,
});

for (const window of [
  [0, 1],
  [0, 0.25],
  [0.25, 0.75],
  [0.75, 1],
] as const)
  it(`retains the original asymmetric table continuously through JSON window ${window}`, () => {
    const input = fixture(),
      original = createCubicDistanceCorrespondence([input.cubic]);
    const restricted = open(input).restrict(window[0], window[1]);
    const map = open(JSON.parse(JSON.stringify(restricted)));
    const first = original.parameter(window[0]),
      last = original.parameter(window[1]);
    for (let i = 0; i <= 1024; i++) {
      const t = i / 1024;
      const wanted = original.parameter(window[0] + (window[1] - window[0]) * t);
      expect(first + (last - first) * map.parameter(t)).toBeCloseTo(wanted, 13);
      expect(map.fraction(map.parameter(t))).toBeCloseTo(t, 12);
    }
    expect(map.parameter(0)).toBe(0);
    expect(map.parameter(1)).toBe(1);
    expect(input).toEqual(fixture());
  });

it('composes recursive absolute windows without fitting a new half table', () => {
  const first = open(fixture()).restrict(0.25, 0.75);
  const nested = open(JSON.parse(JSON.stringify(first))).restrict(0.25, 0.75);
  expect(nested.from).toBe(0.375);
  expect(nested.to).toBe(0.625);
  expect(nested.cubic).toEqual(fixture().cubic);
  const direct = open({ ...fixture(), from: 0.375, to: 0.625 }),
    reopened = open(nested);
  for (let i = 0; i <= 128; i++)
    expect(reopened.parameter(i / 128)).toBe(direct.parameter(i / 128));
});

it('detaches and freezes source points, including after source edits', () => {
  const input = fixture(),
    map = open(input),
    before = map.parameter(0.4);
  input.cubic[1].y = 999;
  input.from = 0.2;
  expect(map.parameter(0.4)).toBe(before);
  expect(map.descriptor.cubic[1].y).toBe(-40);
  expect(Object.isFrozen(map.descriptor)).toBe(true);
  expect(Object.isFrozen(map.descriptor.cubic)).toBe(true);
  expect(Object.isFrozen(map.descriptor.cubic[1])).toBe(true);
});

it('keeps the stationary original convention over a restricted window', () => {
  const input = fixture();
  input.cubic.forEach((p) => {
    p.x = 0;
    p.y = 0;
  });
  const map = open(open(input).restrict(0.25, 0.75));
  expect(map.parameter(0.5)).toBe(0.5);
  expect(map.fraction(0.5)).toBe(0.5);
});

for (const value of [NaN, Infinity, -0.01, 1.01])
  it(`rejects invalid progress ${value} on every entry`, () => {
    const map = open(fixture());
    expect(() => map.parameter(value)).toThrow();
    expect(() => map.fraction(value)).toThrow();
    expect(() => map.restrict(value, 1)).toThrow();
    expect(() => map.restrict(0, value)).toThrow();
    expect(() => open({ ...fixture(), from: value })).toThrow();
  });

for (const window of [
  [1, 0],
  [0.5, 0.5],
  [1, 1],
] as const)
  it(`rejects empty or reversed window ${window}`, () => {
    expect(() => open({ ...fixture(), from: window[0], to: window[1] })).toThrow();
    expect(() => open(fixture()).restrict(window[0], window[1])).toThrow();
  });

for (const mutate of [
  (v: RestrictedArcCorrespondence) => {
    Object.assign(v, { extra: true });
  },
  (v: RestrictedArcCorrespondence) => {
    Object.assign(v, { version: 2 });
  },
  (v: RestrictedArcCorrespondence) => {
    Reflect.deleteProperty(v.cubic, '1');
  },
  (v: RestrictedArcCorrespondence) => {
    Object.defineProperty(v.cubic, 'length', { value: 3 });
  },
  (v: RestrictedArcCorrespondence) => {
    v.cubic[0].x = 1;
  },
  (v: RestrictedArcCorrespondence) => {
    v.cubic[1].x = Infinity;
  },
  (v: RestrictedArcCorrespondence) => {
    Object.assign(v.cubic[1], { extra: 0 });
  },
] as const)
  it('rejects malformed original descriptors before they can become timing', () => {
    const input = fixture();
    mutate(input);
    expect(() => open(input)).toThrow();
  });

it('rejects raw coordinate accessors without reading or cloning', () => {
  const input = fixture(),
    clone = structuredClone;
  let reads = 0,
    clones = 0;
  Object.defineProperty(input.cubic[1], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 32;
    },
  });
  vi.stubGlobal('structuredClone', (v: unknown) => {
    clones++;
    return clone(v);
  });
  expect(() => open(input)).toThrow();
  expect(reads).toBe(0);
  expect(clones).toBe(0);
});

for (const target of ['source', 'clone'])
  it(`rejects ${target} mutation inside detached capture and permits a clean retry`, () => {
    const input = fixture(),
      clone = structuredClone;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      (target === 'source' ? input : (out as RestrictedArcCorrespondence)).cubic[1].y++;
      return out;
    });
    expect(() => open(input)).toThrow(/changed/);
    vi.unstubAllGlobals();
    expect(open(input).descriptor.cubic).toEqual(input.cubic);
  });

it('retains the original finite-overflow and depth/work admission', () => {
  const input = fixture();
  input.cubic[1].x = Number.MAX_VALUE;
  input.cubic[2].x = -Number.MAX_VALUE;
  expect(() => open(input)).toThrow(/numeric limits/);
});

for (const target of ['source', 'detached'])
  it(`rejects ${target} changes while rebuilding the original arc table`, () => {
    const input = fixture(),
      clone = structuredClone,
      hypot = Math.hypot;
    let detached: RestrictedArcCorrespondence | undefined,
      fired = false;
    vi.stubGlobal('structuredClone', (v: RestrictedArcCorrespondence) => {
      detached = clone(v);
      return detached;
    });
    vi.spyOn(Math, 'hypot').mockImplementation((...args: number[]) => {
      if (!fired) {
        fired = true;
        (target === 'source' ? input : detached!).cubic[1].y++;
      }
      return hypot(...args);
    });
    expect(() => open(input)).toThrow(/changed/);
    expect(fired).toBe(true);
  });

it('rejects a window with no representable interior progress', () => {
  expect(() => open({ ...fixture(), from: 1 - Number.EPSILON / 2, to: 1 })).toThrow(/unresolved/);
});

it('keeps exact descriptor identity when restricting the complete window', () => {
  const input = { ...fixture(), from: 0.125, to: 0.875 };
  expect(open(input).restrict(0, 1)).toEqual(input);
});

it('rejects extra array fields and inherited records without hiding them in JSON', () => {
  const input = fixture();
  Object.assign(input.cubic, { extra: 1 });
  expect(() => open(input)).toThrow();
  expect(() => open(Object.assign(Object.create({ extra: 1 }), fixture()))).toThrow();
});

for (const scale of [0.001, 1, 1000])
  for (const reflect of [-1, 1])
    it(`matches independent restricted Bernstein geometry at scale ${scale}, reflection ${reflect}`, () => {
      const input = fixture();
      input.cubic.forEach((p) => {
        p.x *= scale * reflect;
        p.y *= scale;
      });
      const original = createCubicDistanceCorrespondence([input.cubic]);
      const map = open(open(input).restrict(0.125, 0.875));
      const a = map.first,
        b = map.last,
        width = b - a;
      for (const axis of ['x', 'y'] as const) {
        const c = input.cubic.map((p) => p[axis]);
        const position = (t: number) =>
          (1 - t) ** 3 * c[0] +
          3 * (1 - t) ** 2 * t * c[1] +
          3 * (1 - t) * t * t * c[2] +
          t ** 3 * c[3];
        const derivative = (t: number) =>
          3 * (1 - t) ** 2 * (c[1] - c[0]) +
          6 * (1 - t) * t * (c[2] - c[1]) +
          3 * t * t * (c[3] - c[2]);
        const q = [
          position(a),
          position(a) + (width * derivative(a)) / 3,
          position(b) - (width * derivative(b)) / 3,
          position(b),
        ];
        for (let i = 0; i <= 128; i++) {
          const t = i / 128,
            u = map.parameter(t),
            v = 1 - u;
          const actual =
            v ** 3 * q[0] + 3 * v * v * u * q[1] + 3 * v * u * u * q[2] + u ** 3 * q[3];
          expect(Math.abs(actual - position(original.parameter(0.125 + 0.75 * t)))).toBeLessThan(
            scale * 1e-11,
          );
        }
      }
    });
