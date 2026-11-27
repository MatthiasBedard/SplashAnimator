import { expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Layer,
} from '../packages/document/src';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import { splitLiveGroupMotionLayer as split } from '../packages/animation/src/live-group-motion-split';
import { splitLiveMotionLayer as splitRoot } from '../packages/animation/src/live-motion-split';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { matrix, mapPoint } from '../packages/geometry/src/affine';

function fixture(mode = 'rigid', basis = 'plain', many = true) {
  const f = liveRotationFixture(mode, basis, many);
  for (const key of f.p.layers[0].keys)
    for (const s of key.shapes) {
      s.x += 80;
      s.y += 80;
    }
  return f;
}
function operation(p: Project, at = 4, id = 'right') {
  const layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  return split(p, layer, span, at, id);
}
function equivalent(p: Project, layer: Layer) {
  const original = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
    q = { ...p, layers: [layer] },
    left = createMotionFrameSampler(q, 'track', layer.liveMotionSpans![0]),
    right = createMotionFrameSampler(q, 'track', layer.liveMotionSpans![1]),
    cut = layer.liveMotionSpans![0].end;
  for (let f = 0; f <= 8; f++) {
    const a = original.sample(f),
      b = (f <= cut ? left : right).sample(f);
    expect(sameMotionArtwork(a, b), `frame ${f}`).toBe(true);
    for (let i = 0; i < a.length; i++) {
      const x = mapPoint(matrix(a[i]), { x: 6, y: 5 }),
        y = mapPoint(matrix(b[i]), { x: 6, y: 5 });
      expect(y.x).toBeCloseTo(x.x, 9);
      expect(y.y).toBeCloseTo(x.y, 9);
    }
  }
  original.dispose();
  left.dispose();
  right.dispose();
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const at of [2, 4, 6])
      it(`preserves sparse ${mode}/${basis} groups at ${at}`, () => {
        const { p, b, h } = fixture(mode, basis),
          before = structuredClone(p),
          out = operation(p, at);
        expect(out.keys.map((k) => k.frame)).toEqual([0, at, 8, 10]);
        expect(out.liveMotionSpans!.map((s) => [s.id, s.start, s.end])).toEqual([
          ['live', 0, at],
          ['right', at, 8],
        ]);
        for (const k of before.layers[0].keys)
          expect(out.keys.find((v) => v.frame === k.frame)).toEqual(k);
        expect(out.keys[1].shapes.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'loose']);
        expect(out.liveMotionSpans!.map((s) => s.options)).toEqual([
          before.layers[0].liveMotionSpans![0].options,
          before.layers[0].liveMotionSpans![0].options,
        ]);
        expect(out.liveMotionSpans![1].rotation!.axisGroupShear).toBe(
          mode === 'axes' || mode === 'shear' || mode === 'both' ? true : undefined,
        );
        validateProject({ ...p, layers: [out] });
        equivalent(p, out);
        const view = { ...p, layers: [out] },
          half = out.liveMotionSpans!.find((s) => s.start <= 4 && s.end >= 4)!;
        const sampled = createMotionFrameSampler(view, 'track', half),
          shapes = sampled.sample(4);
        const hm = [(1 + h[0]) / 2, h[1] / 2, h[2] / 2, (1 + h[3]) / 2],
          local = { x: b[0] * 6 + b[2] * 5, y: b[1] * 6 + b[3] * 5 };
        for (let i = 0; i < shapes.length; i++) {
          const loose = i === 4,
            offset = i === 1 || i === 3 ? 40 : 0;
          const u = loose ? local.x : hm[0] * (offset + local.x) + hm[2] * local.y;
          const v = loose ? local.y : hm[1] * (offset + local.x) + hm[3] * local.y;
          const leader =
            i < 2 ? { x: 120, y: 100 } : i < 4 ? { x: 280, y: 200 } : { x: 370, y: 140 };
          const world = mapPoint(matrix(shapes[i]), { x: 6, y: 5 });
          expect(world.x).toBeCloseTo(leader.x + (u - v) / Math.SQRT2, 9);
          expect(world.y).toBeCloseTo(leader.y + (u + v) / Math.SQRT2, 9);
        }
        sampled.dispose();
        expect(p).toEqual(before);
        const reopened = JSON.parse(JSON.stringify(out)) as Layer;
        equivalent(p, reopened);
        out.keys[0].shapes[0].x = 999;
        expect(p).toEqual(before);
      });
for (const ease of [
  'linear',
  'in',
  'out',
  'in-out',
  { kind: 'cubic', x1: 1 / 3, y1: 1 / 6, x2: 2 / 3, y2: 2 / 3 },
] as const)
  it(`restricts group easing ${JSON.stringify(ease)} without baking`, () => {
    const { p } = fixture();
    p.layers[0].liveMotionSpans![0].ease = ease;
    const out = operation(p);
    equivalent(p, out);
    expect(out.keys).toHaveLength(4);
  });
for (const direction of ['clockwise', 'counterclockwise'] as const)
  for (const turns of [0, 1, 2])
    for (const mode of ['rigid', 'both'])
      it(`preserves shared ${direction} turns ${turns} in ${mode} group recipes`, () => {
        const { p } = fixture(mode, 'reflected');
        Object.assign(p.layers[0].liveMotionSpans![0].rotation!, { direction, turns });
        equivalent(p, operation(p));
      });
for (const many of [false, true])
  for (const advanced of [false, true])
    it(`splits shared group leader paths ${many}/${advanced} while members have different displacements`, () => {
      const { p } = fixture('rigid', 'plain', many),
        span = p.layers[0].liveMotionSpans![0];
      span.path = {
        startX: advanced ? 80 / 3 : 0,
        startY: advanced ? 0 : 40,
        endX: advanced ? -80 / 3 : 0,
        endY: advanced ? 0 : 40,
        ...(advanced
          ? { distance: true, tangent: true, headingOffset: 10, headingOffsetEnd: 20 }
          : {}),
      };
      if (many) {
        const a = p.layers[0].keys[0].shapes.at(-1)!,
          b = p.layers[0].keys[1].shapes.at(-1)!;
        b.x = a.x + 80;
        b.y = a.y;
      }
      const before = structuredClone(p),
        out = operation(p);
      equivalent(p, out);
      expect(p).toEqual(before);
      expect(out.liveMotionSpans!.every((s) => s.path?.distance === span.path?.distance)).toBe(
        true,
      );
    });
it('restricts independent opacity/paint timing and retains exact endpoints/options/library', () => {
  const { p } = fixture(),
    span = p.layers[0].liveMotionSpans![0];
  span.ease = 'in';
  span.opacityEase = 'out';
  span.paintEase = 'linear';
  for (const shape of p.layers[0].keys[0].shapes) {
    shape.opacity = 0;
    shape.fill = '#000000';
  }
  for (const shape of p.layers[0].keys[1].shapes) {
    shape.opacity = 1;
    shape.fill = '#808080';
  }
  const before = structuredClone(p),
    out = operation(p);
  equivalent(p, out);
  expect(p).toEqual(before);
  expect(out.keys[0]).toEqual(before.layers[0].keys[0]);
  expect(out.keys[2]).toEqual(before.layers[0].keys[1]);
});
for (const at of [-1, 0, 1, 7, 8, 9, 2.5, NaN, Infinity])
  it(`rejects split frame ${at} without source writes`, () => {
    const { p } = fixture(),
      before = structuredClone(p);
    expect(() => operation(p, at)).toThrow();
    expect(p).toEqual(before);
  });
for (const id of ['', 'live'])
  it(`rejects missing/colliding identity ${id}`, () => {
    const { p } = fixture(),
      before = structuredClone(p);
    expect(() => operation(p, 4, id)).toThrow();
    expect(p).toEqual(before);
  });
it('keeps legacy root group exclusion and rejects cloned original layer/recipe references', () => {
  const { p } = fixture(),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  expect(() => splitRoot(p, layer, span, 4, 'right')).toThrow(/group/);
  expect(() => split(p, structuredClone(layer), span, 4, 'right')).toThrow(/original/);
  expect(() => split(p, layer, structuredClone(span), 4, 'right')).toThrow(/original/);
  const plain = structuredClone(p);
  for (const k of plain.layers[0].keys) for (const s of k.shapes) delete s.groups;
  delete plain.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
  expect(() => operation(plain)).toThrow(/group/);
});
for (const mode of ['getter', 'nonfinite', 'hierarchy', 'orbit', 'depth'])
  it(`rejects raw original ${mode}`, () => {
    const { p } = fixture();
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(p.layers[0].keys[0].shapes[0], 'groups', {
        enumerable: true,
        get() {
          reads++;
          return ['outer'];
        },
      });
    if (mode === 'nonfinite') p.layers[0].keys[0].shapes[0].x = NaN;
    if (mode === 'hierarchy') p.layers[0].keys[1].shapes[0].groups = ['changed'];
    if (mode === 'orbit') p.layers[0].liveMotionSpans![0].rotation!.savedGroupPivots = true;
    if (mode === 'depth') p.layers[0].liveMotionSpans![0].rotation!.groupDepth = 1;
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });
it('rejects nonshared leader/loose path displacement rather than dropping artwork or baking keys', () => {
  const { p } = fixture(),
    before = structuredClone(p);
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  before.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  expect(() => operation(p)).toThrow(/displacement/);
  expect(p).toEqual(before);
});
it('rejects unshared directed turn counts on the halves', () => {
  const { p } = fixture();
  p.duration = 24;
  p.layers[0].keys[1].frame = 20;
  p.layers[0].keys[2].frame = 22;
  const span = p.layers[0].liveMotionSpans![0];
  span.end = 20;
  Object.assign(span.rotation!, { direction: 'clockwise', turns: 1 });
  p.layers[0].keys[1].shapes.at(-1)!.rotation = 0;
  const before = structuredClone(p);
  expect(() => operation(p, 18)).toThrow(/shared extra-turn/);
  expect(p).toEqual(before);
});
it('rejects a corrupted detached output clone without returning aliased source data', () => {
  const { p } = fixture(),
    before = structuredClone(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (!hit && (v as Layer)?.keys?.length === 4 && (v as Layer).liveMotionSpans?.length === 2) {
      hit = true;
      (out as Layer).keys[0].shapes[0].x++;
    }
    return out;
  });
  try {
    expect(() => operation(p)).toThrow(/clone/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  equivalent(p, operation(p));
});

for (const tangent of [false, true])
  it(`rejects curved distance restriction outside original numeric proof (tangent ${tangent})`, () => {
    const { p } = fixture('rigid', 'plain', false);
    p.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      distance: true,
      tangent,
      ...(tangent ? { headingOffset: 10, headingOffsetEnd: 20 } : {}),
    };
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow(/reproduce/);
    expect(p).toEqual(before);
  });

for (const many of [false, true])
  it(`preserves cubic tangent heading metadata without distance approximation ${many}`, () => {
    const { p } = fixture('rigid', 'reflected', many);
    p.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 40,
      endX: 0,
      endY: 40,
      tangent: true,
      headingOffset: 10,
      headingOffsetEnd: 20,
    };
    if (many) {
      const a = p.layers[0].keys[0].shapes.at(-1)!,
        b = p.layers[0].keys[1].shapes.at(-1)!;
      b.x = a.x + 80;
      b.y = a.y;
    }
    const before = structuredClone(p),
      out = operation(p);
    equivalent(p, out);
    expect(p).toEqual(before);
    expect(out.liveMotionSpans!.every((s) => s.path!.tangent)).toBe(true);
  });
it('retains explicit false shear on the left and derives right-half shear without enabling interpolation options', () => {
  const { p } = fixture('axes', 'reflected');
  p.layers[0].liveMotionSpans![0].rotation!.axisGroupShear = false;
  const before = structuredClone(p),
    out = operation(p);
  equivalent(p, out);
  expect(out.liveMotionSpans![0].rotation!.axisGroupShear).toBe(false);
  expect(out.liveMotionSpans![1].rotation!.axisGroupShear).toBe(true);
  for (const s of out.liveMotionSpans!)
    expect(s.options).toEqual(before.layers[0].liveMotionSpans![0].options);
  expect(p).toEqual(before);
});
for (const mode of ['matrix', 'path'])
  it(`rejects original finite ${mode} overflow atomically`, () => {
    const { p } = fixture();
    if (mode === 'matrix') {
      for (const key of p.layers[0].keys.slice(0, 2))
        key.shapes[0].transform = [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE];
    } else
      p.layers[0].liveMotionSpans![0].path = {
        startX: Number.MAX_VALUE,
        startY: Number.MAX_VALUE,
        endX: Number.MAX_VALUE,
        endY: Number.MAX_VALUE,
      };
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow();
    expect(p).toEqual(before);
  });
it('admits the original aggregate artwork budget and rejects overflow without a lower split cap', () => {
  const { p } = fixture(),
    art = p.symbols![0].shapes[0];
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: 'saved' + i,
    points: [],
  }));
  const out = operation(p);
  expect(out.keys).toHaveLength(4);
  expect(p.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 30000);

for (const [origin, unit] of [
  [0, 1e-6],
  [10000, 0.001],
  [0, 1000],
] as const)
  it(`preserves relative group splits at ${origin}/${unit}`, () => {
    const { p } = fixture('both', 'reflected');
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.x = origin + shape.x * unit;
        shape.y = origin + shape.y * unit;
        shape.width *= unit;
        shape.height *= unit;
      }
    const before = structuredClone(p),
      out = operation(p);
    equivalent(p, out);
    expect(p).toEqual(before);
  });
it('rejects a continuously singular two-axis group path despite finite positive endpoint determinants', () => {
  const { p } = fixture('both', 'plain'),
    first = p.layers[0].keys[0].shapes,
    last = p.layers[0].keys[1].shapes;
  for (let i = 0; i < last.length; i++)
    if (first[i].groups?.length) {
      const leader = first.find((s) => s.groups?.[0] === first[i].groups![0])!,
        dx = first[i].x - leader.x,
        dy = first[i].y - leader.y;
      last[i].x = leader.x + 80 - dx + 2 * dy;
      last[i].y = leader.y - 2 * dx + dy;
      last[i].transform = [-2, 1, 1, -2];
    }
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow(/orientation|collapse|singular/);
  expect(p).toEqual(before);
});
it('preserves compound artwork and saved/absent pivots without normalizing topology', () => {
  const { p } = fixture('rigid', 'reflected');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    Object.assign(key.shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 20 },
        ],
        [
          { x: 4, y: 4 },
          { x: 6, y: 4 },
          { x: 5, y: 6 },
        ],
      ],
    });
    delete key.shapes[0].pivot;
  }
  const before = structuredClone(p),
    out = operation(p);
  equivalent(p, out);
  expect(out.keys[0]).toEqual(before.layers[0].keys[0]);
  expect(out.keys[2]).toEqual(before.layers[0].keys[1]);
  expect(p).toEqual(before);
});
