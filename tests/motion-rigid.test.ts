import {createBasicMotionSpan,setRememberedMotionSpin} from '../packages/animation/src/motion-spans';
import { expect, it } from 'vitest';
import {
  clone,
  newProject,
  symbolLayers,
  type Vector,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  generateMotionFrames,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
const rotation = { direction: 'shortest' as const, turns: 0, rigidGroups: true };

it('scales group artwork and offsets independently in source document axes', () => {
  const p = fixture();
  const source = p.layers[0].keys[0].shapes;
  source[1].y = 12;
  source[1].rotation = 90;
  source[1].transform = [1, 0, 0.25, 1];
  const target = p.layers[0].keys[1].shapes;
  target[0].transform = [2, 0, 0, 0.5];
  target[1].x = 94;
  target[1].y = 40;
  target[1].rotation = 180;
  target[1].transform = [0.5, 0, 0.125, 2];
  const before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, axisGroupScale: true },
  );
  for (const frame of [1, 2, 3]) {
    const t = frame / 4,
      sx = 1 + t,
      sy = 1 - 0.5 * t,
      angle = (t * Math.PI) / 2;
    const [a, b] = p.layers[0].keys[frame].shapes;
    expect(b.x - a.x).toBeCloseTo(Math.cos(angle) * 20 * sx - Math.sin(angle) * 12 * sy, 10);
    expect(b.y - a.y).toBeCloseTo(Math.sin(angle) * 20 * sx + Math.cos(angle) * 12 * sy, 10);
    // The member starts rotated 90 degrees: its local axes receive opposite scales.
    expect(b.transform![0]).toBeCloseTo(sy, 12);
    expect(b.transform![2]).toBeCloseTo(0.25 * sy, 12);
    expect(b.transform![3]).toBeCloseTo(sx, 12);
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});

it('rejects incompatible independent group scales and pivots atomically', () => {
  for (const mode of ['affine', 'uniform', 'basis', 'negative'] as const) {
    const p = fixture();
    const target = p.layers[0].keys[1].shapes;
    for (const s of target) s.transform = [2, 0, 0, 0.5];
    target[1].y = 40;
    if (mode === 'basis') target[1].transform![0] = 3;
    if (mode === 'negative') target[0].transform![0] = -2;
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        mode !== 'affine',
        false,
        false,
        undefined,
        false,
        false,
        {
          ...rotation,
          axisGroupScale: true,
          uniformGroupScale: mode === 'uniform',
        },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});

it('applies independent group scales to oblique reflected and skewed member bases', () => {
  const p = fixture();
  const source = p.layers[0].keys[0].shapes,
    target = p.layers[0].keys[1].shapes;
  source[0].rotation = 37;
  source[0].transform = [1, 0.2, 0.3, -1];
  source[1].rotation = -21;
  source[1].transform = [1, 0, 0.25, 1];
  const rotate = (x: number, y: number, degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  };
  source.forEach((shape, i) => {
    target[i].rotation = shape.rotation + 90;
    const basis = shape.transform!;
    target[i].transform = [0, 0, 0, 0];
    for (const column of [0, 2]) {
      const world = rotate(basis[column], basis[column + 1], shape.rotation);
      const local = rotate(2 * world[0], 0.5 * world[1], -shape.rotation);
      target[i].transform![column] = local[0];
      target[i].transform![column + 1] = local[1];
    }
  });
  target[1].y = 40;
  const original = clone(source);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, axisGroupScale: true },
  );
  for (const frame of [1, 2, 3])
    for (const i of [0, 1]) {
      const shape = p.layers[0].keys[frame].shapes[i],
        basis = shape.transform!,
        before = original[i],
        base = before.transform!;
      const world = rotate(base[0] * 3 + base[2] * 5, base[1] * 3 + base[3] * 5, before.rotation);
      const expected = rotate(
        world[0] * (1 + frame / 4),
        world[1] * (1 - frame / 8),
        (90 * frame) / 4,
      );
      const actual = rotate(
        basis[0] * 3 + basis[2] * 5,
        basis[1] * 3 + basis[3] * 5,
        shape.rotation,
      );
      expect(actual[0]).toBeCloseTo(expected[0], 12);
      expect(actual[1]).toBeCloseTo(expected[1], 12);
    }
});
function fixture() {
  const p = newProject();
  p.duration = 5;
  const a: Vector = {
    id: 'a',
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
    groups: ['outer'],
  };
  const b = { ...clone(a), id: 'b', x: 20, groups: ['outer', 'inner'] };
  p.layers[0].keys = [
    { frame: 0, shapes: [a, b] },
    {
      frame: 4,
      shapes: [
        { ...clone(a), x: 100, rotation: 90 },
        { ...clone(b), x: 100, y: 20, rotation: 90 },
      ],
    },
  ];
  return p;
}
it('rotates relative member origins without shrinking and keeps exact endpoint keys', () => {
  const p = fixture(),
    before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    rotation,
  );
  for (const f of [1, 2, 3]) {
    const [a, b] = p.layers[0].keys[f].shapes;
    expect(a.x).toBe(25 * f);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 12);
    expect(b.x).toBeCloseTo(a.x + 20 * Math.cos((f * Math.PI) / 8), 12);
    expect(b.y).toBeCloseTo(20 * Math.sin((f * Math.PI) / 8), 12);
    expect(b.rotation).toBe(22.5 * f);
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});
it('shares leader path and tangent and preserves symbol source isolation', () => {
  const p = fixture();
  const def: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 200,
    height: 200,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 5, keys: p.layers[0].keys.slice(1), layers: [] },
  };
  const before = clone(def);
  const path = { startX: 0, startY: 30, endX: 0, endY: 30, tangent: true };
  const out = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    path,
    false,
    false,
    [def],
    rotation,
  );
  expect(def).toEqual(before);
  const [a, b] = out.timeline!.keys.find((k) => k.frame === 2)!.shapes;
  expect(a.x).toBeCloseTo(50, 12);
  expect(a.y).toBeCloseTo(22.5, 12);
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 12);
  expect(b.rotation).toBeCloseTo(45, 12);
});
it('rejects mismatched member endpoints and incompatible geometry options atomically', () => {
  for (const mode of ['offset', 'angle', 'affine'] as const) {
    const p = fixture();
    if (mode === 'offset') p.layers[0].keys[1].shapes[1].x++;
    if (mode === 'angle') p.layers[0].keys[1].shapes[1].rotation++;
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        mode === 'affine',
        false,
        false,
        undefined,
        false,
        false,
        rotation,
      ),
    ).toThrow(/Rigid|rigid/);
    expect(p).toEqual(before);
  }
});
it('retains full-turn group orbits and independent ungrouped artwork', () => {
  const p = fixture();
  const lone = { ...clone(p.layers[0].keys[0].shapes[0]), id: 'lone', groups: undefined, x: 200 };
  p.layers[0].keys[0].shapes.push(lone);
  p.layers[0].keys[1].shapes.push({ ...clone(lone), x: 300 });
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, direction: 'clockwise', turns: 1 },
  );
  const [a, b, c] = p.layers[0].keys[2].shapes;
  expect(b.x - a.x).toBeCloseTo(-Math.sqrt(200), 12);
  expect(b.y - a.y).toBeCloseTo(-Math.sqrt(200), 12);
  expect(b.rotation).toBe(225);
  expect(c.x).toBe(250);
});

it('preflights later tracks atomically and rejects absent groups or malformed mode', () => {
  const p = fixture();
  const later = clone(p.layers[0]);
  later.id = 'later';
  later.keys[1].shapes[1].y++;
  p.layers.push(later);
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      rotation,
    ),
  ).toThrow(/Rigid/);
  expect(p).toEqual(before);
  const ungrouped = fixture();
  for (const key of ungrouped.layers[0].keys) for (const s of key.shapes) delete s.groups;
  expect(() =>
    generateMotionFrames(
      ungrouped,
      [ungrouped.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      rotation,
    ),
  ).toThrow(/at least two/);
  expect(() =>
    generateMotionFrames(
      ungrouped,
      [ungrouped.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, rigidGroups: 1 as unknown as boolean },
    ),
  ).toThrow(/mode/);
});

it('moves custom pivots linearly while orbiting all group members', () => {
  const p = fixture(),
    before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, rigidPivot: { x: 10, y: 0 } },
  );
  for (const f of [1, 2, 3]) {
    const [a, b] = p.layers[0].keys[f].shapes;
    const t = f / 4,
      c = Math.cos((t * Math.PI) / 2),
      s = Math.sin((t * Math.PI) / 2);
    const px = 10 * (1 - t) + 100 * t,
      py = 10 * t;
    expect(a.x).toBeCloseTo(px - 10 * c, 12);
    expect(a.y).toBeCloseTo(py - 10 * s, 12);
    expect(b.x).toBeCloseTo(px + 10 * c, 12);
    expect(b.y).toBeCloseTo(py + 10 * s, 12);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(20, 12);
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});
it('rejects malformed or overflowing pivots atomically', () => {
  for (const pivot of [
    { x: NaN, y: 0 },
    { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
  ]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, rigidPivot: pivot },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }

});

it('keeps pure translation exact with a distant custom pivot', () => {
  const p = fixture();
  const [a, b] = p.layers[0].keys[1].shapes;
  a.rotation = b.rotation = 0;
  b.x = 120;
  b.y = 0;
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, rigidPivot: { x: 1e20, y: 1e20 } },
  );
  const [lead, member] = p.layers[0].keys[2].shapes;
  expect(lead.x).toBe(50);
  expect(lead.y).toBe(0);
  expect(member.x).toBe(70);
  expect(member.y).toBe(0);
});

it('scales complete groups around moving pivots with preserved local bases and exact endpoints', () => {
  for (const ratio of [0.5, 2])
    for (const pivot of [0, 10]) {
      const p = fixture();
      const basis: [number, number, number, number] = [1, 0.5, 0.25, -2];
      for (const shape of p.layers[0].keys[0].shapes) shape.transform = [...basis];
      for (const shape of p.layers[0].keys[1].shapes)
        shape.transform = basis.map((v) => v * ratio) as typeof basis;
      p.layers[0].keys[1].shapes[1].y = 20 * ratio;
      const before = clone(p);
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        true,
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, uniformGroupScale: true, rigidPivot: { x: pivot, y: 0 } },
      );
      for (const f of [1, 2, 3]) {
        const t = f / 4,
          scale = 1 + (ratio - 1) * t,
          angle = (t * Math.PI) / 2;
        const [a, b] = p.layers[0].keys[f].shapes;
        expect(a.x).toBeCloseTo(100 * t + pivot * (1 - t) - scale * pivot * Math.cos(angle), 10);
        expect(a.y).toBeCloseTo(ratio * pivot * t - scale * pivot * Math.sin(angle), 10);
        expect(b.x - a.x).toBeCloseTo(20 * scale * Math.cos(angle), 10);
        expect(b.y - a.y).toBeCloseTo(20 * scale * Math.sin(angle), 10);
        expect(a.transform).toEqual(basis.map((v) => v * scale));
        expect(b.transform).toEqual(a.transform);
        expect(a.rotation).toBe(90 * t);
      }
      expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
      expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    }
});
it('rejects inconsistent group scaling and missing affine opt-in without writing keys', () => {
  for (const mode of [
    'basis',
    'member',
    'offset',
    'reflection',
    'disabled',
    'malformed',
  ] as const) {
    const p = fixture();
    for (const shape of p.layers[0].keys[1].shapes) shape.transform = [2, 0, 0, 2];
    p.layers[0].keys[1].shapes[1].y = 40;
    if (mode === 'basis') p.layers[0].keys[1].shapes[0].transform = [2, 0, 0, 3];
    if (mode === 'member') p.layers[0].keys[1].shapes[1].transform = [3, 0, 0, 3];
    if (mode === 'offset') p.layers[0].keys[1].shapes[1].y = 20;
    if (mode === 'reflection') p.layers[0].keys[1].shapes[0].transform = [-2, 0, 0, -2];
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        mode !== 'disabled',
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, uniformGroupScale: mode === 'malformed' ? (1 as unknown as boolean) : true },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});

it('combines symbol group scaling with leader paths and rejects a later invalid track atomically', () => {
  const p = fixture();
  for (const shape of p.layers[0].keys[1].shapes) shape.transform = [2, 0, 0, 2];
  p.layers[0].keys[1].shapes[1].y = 40;
  const settings = { ...rotation, uniformGroupScale: true };
  const def: SymbolDefinition = {
    id: 'scale-symbol',
    name: 'Scaled',
    width: 200,
    height: 200,
    shapes: clone(p.layers[0].keys[0].shapes),
    timeline: { duration: 5, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
  };
  const before = clone(def);
  const out = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    { startX: 0, startY: 30, endX: 0, endY: 30, tangent: true },
    false,
    false,
    [def],
    settings,
  );
  const [a, b] = out.timeline!.keys.find((k) => k.frame === 2)!.shapes;
  expect(a.x).toBeCloseTo(50, 12);
  expect(a.y).toBeCloseTo(22.5, 12);
  expect(b.x - a.x).toBeCloseTo(30 / Math.sqrt(2), 12);
  expect(b.y - a.y).toBeCloseTo(30 / Math.sqrt(2), 12);
  expect(b.transform).toEqual([1.5, 0, 0, 1.5]);
  expect(def).toEqual(before);
  const later = clone(p.layers[0]);
  later.id = 'later';
  later.keys[1].shapes[1].y = 20;
  p.layers.push(later);
  const original = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      true,
      false,
      false,
      undefined,
      false,
      false,
      settings,
    ),
  ).toThrow(/Rigid/);
  expect(p).toEqual(original);
});

it('retains small-angle pivot displacement instead of rounding cosine differences to zero', () => {
  for (const ratio of [0.5, 1, 2]) {
    const p = fixture();
    const [a, b] = p.layers[0].keys[1].shapes;
    a.rotation = b.rotation = 1e-8;
    b.x = 100 + 20 * ratio;
    b.y = 20 * ratio * Math.sin((1e-8 * Math.PI) / 180);
    for (const shape of [a, b]) shape.transform = [ratio, 0, 0, ratio];
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      true,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, uniformGroupScale: true, rigidPivot: { x: 1e22, y: 0 } },
    );
    for (const frame of [1, 2, 3]) {
      const lead = p.layers[0].keys[frame].shapes[0],
        t = frame / 4,
        scale = 1 - t + t * ratio;
      // Independent quadratic small-angle series, using the actual angular branch.
      // Higher-order terms contribute less than 1e-17 document units here.
      const delta = ((lead.rotation / t) * Math.PI) / 180;
      const correction = (1e22 * (scale * t * t - t * ratio) * delta * delta) / 2;
      expect(lead.x).toBeCloseTo(100 * t + correction, 8);
    }
  }
});

it('uses separate saved leader pivots with local affine and authored rotation', () => {
  const p = fixture();
  for (const key of p.layers[0].keys) {
    for (const shape of key.shapes) {
      shape.rotation += 90;
      shape.transform = [2, 0, 1, 1];
    }
    key.shapes[0].pivot = { x: 5, y: 2 };
    const other = clone(key.shapes);
    other.forEach((s, i) => {
      s.id += 'other';
      s.groups = ['other'];
      s.x += 200;
      delete s.transform;
      if (i === 0) s.pivot = { x: -3, y: 4 };
    });
    key.shapes.push(...other);
  }
  const before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, savedGroupPivots: true },
  );
  for (const f of [1, 2, 3]) {
    const t = f / 4,
      c = Math.cos((t * Math.PI) / 2),
      s = Math.sin((t * Math.PI) / 2);
    for (const [index, px, py, origin] of [
      [0, -2, 12, 0],
      [2, -4, -3, 200],
    ]) {
      const leader = p.layers[0].keys[f].shapes[index],
        member = p.layers[0].keys[f].shapes[index + 1];
      expect(leader.x).toBeCloseTo(
        origin + 100 * t + (1 - t) * px - t * py - (c * px - s * py),
        11,
      );
      expect(leader.y).toBeCloseTo((1 - t) * py + t * px - (s * px + c * py), 11);
      expect(member.x - leader.x).toBeCloseTo(20 * c, 11);
      expect(member.y - leader.y).toBeCloseTo(20 * s, 11);
      expect(leader.pivot).toEqual(before.layers[0].keys[0].shapes[index].pivot);
    }
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});
it('rejects missing or malformed saved pivots and conflicting modes without writing', () => {
  for (const mode of [
    'missing',
    'nan',
    'null',
    'overflow',
    'conflict',
    'disabled',
  ] as const) {
    const p = fixture();
    for (const k of p.layers[0].keys) k.shapes[0].pivot = { x: 10, y: 0 };
    if (mode === 'missing') delete p.layers[0].keys[0].shapes[0].pivot;
    if (mode === 'nan') p.layers[0].keys[0].shapes[0].pivot!.x = NaN;
    if (mode === 'null') p.layers[0].keys[0].shapes[0].pivot = null as unknown as Vector['pivot'];
    if (mode === 'overflow')
      for (const k of p.layers[0].keys) {
        k.shapes[0].pivot = { x: Number.MAX_VALUE, y: 0 };
        for (const s of k.shapes) s.transform = [2, 0, 0, 2];
      }
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        false,
        {
          ...rotation,
          rigidGroups: mode !== 'disabled',
          savedGroupPivots: true,
          rigidPivot: mode === 'conflict' ? { x: 0, y: 0 } : undefined,
        },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('permits zero saved pivot paths and rejects later tracks atomically', () => {
  const p = fixture();
  for (const k of p.layers[0].keys) k.shapes[0].pivot = { x: 0, y: 0 };
  const options = { ...rotation, savedGroupPivots: true };
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    false,
    { startX: 0, startY: 30, endX: 0, endY: 30 },
    false,
    false,
    options,
  );
  expect(p.layers[0].keys[2].shapes[0].y).toBeCloseTo(22.5, 10);
  const bad = fixture();
  for (const k of bad.layers[0].keys) k.shapes[0].pivot = { x: 10, y: 0 };
  bad.layers.push({ ...clone(bad.layers[0]), id: 'other' });
  delete bad.layers[1].keys[0].shapes[0].pivot;
  const before = clone(bad);
  expect(() =>
    generateMotionFrames(
      bad,
      bad.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      options,
    ),
  ).toThrow();
  expect(bad).toEqual(before);
});

function nestedFixture(reusedNames = false) {
  const p = fixture();
  const first = p.layers[0].keys[0].shapes;
  const end = p.layers[0].keys[1].shapes;
  for (const shape of [...first, ...end]) shape.groups = ['outer', 'left'];
  first.push(
    ...first.map((s, i) => ({
      ...clone(s),
      id: `right${i}`,
      x: s.x + 200,
      groups: reusedNames ? ['other', 'left'] : ['outer', 'right'],
    })),
  );
  end.push(
    ...end.map((s, i) => ({
      ...clone(s),
      id: `right${i}`,
      x: 400,
      y: i === 0 ? 0 : -20,
      rotation: -90,
      groups: reusedNames ? ['other', 'left'] : ['outer', 'right'],
    })),
  );
  const lone = { ...clone(first[0]), id: 'parent-only', x: 600, groups: ['outer'] };
  first.push(lone);
  end.push({ ...clone(lone), x: 700 });
  return p;
}
it('moves sibling nested groups independently and scopes repeated subgroup names by ancestry', () => {
  for (const [reused, depth] of [
    [false, 1],
    [true, 1],
    [false, 2],
    [true, 2],
  ] as const) {
    const p = nestedFixture(reused);
    if (depth === 2)
      for (const key of p.layers[0].keys)
        for (const shape of key.shapes) shape.groups = ['scene', ...shape.groups!];
    const before = clone(p);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, groupDepth: depth },
    );
    for (const f of [1, 2, 3]) {
      const [a, b, c, d, lone] = p.layers[0].keys[f].shapes,
        angle = (f * Math.PI) / 8;
      expect(a.x).toBe(25 * f);
      expect(b.x - a.x).toBeCloseTo(20 * Math.cos(angle), 12);
      expect(b.y - a.y).toBeCloseTo(20 * Math.sin(angle), 12);
      expect(c.x).toBe(200 + 50 * f);
      expect(d.x - c.x).toBeCloseTo(20 * Math.cos(angle), 12);
      expect(d.y - c.y).toBeCloseTo(-20 * Math.sin(angle), 12);
      expect(d.rotation).toBe(-22.5 * f);
      expect(lone.x).toBe(600 + 25 * f);
    }
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  }
});
it('retains subgroup-specific positive scales and saved leader pivots', () => {
  const p = nestedFixture();
  const [first, last] = p.layers[0].keys;
  for (let i = 0; i < 4; i++) {
    const scale = i < 2 ? 2 : 0.5;
    last.shapes[i].transform = [scale, 0, 0, scale];
    if (i % 2) last.shapes[i].y *= scale;
    else {
      first.shapes[i].pivot = { x: 10, y: 0 };
      last.shapes[i].pivot = { x: 10, y: 0 };
    }
  }
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, groupDepth: 1, uniformGroupScale: true, savedGroupPivots: true },
  );
  const [a, b, c, d] = p.layers[0].keys[2].shapes;
  const q = Math.SQRT1_2;
  expect(a.x).toBeCloseTo(55 - 15 * q, 12);
  expect(a.y).toBeCloseTo(10 - 15 * q, 12);
  expect(b.x).toBeCloseTo(55 + 15 * q, 12);
  expect(b.y).toBeCloseTo(10 + 15 * q, 12);
  expect(c.x).toBeCloseTo(305 - 7.5 * q, 12);
  expect(c.y).toBeCloseTo(-2.5 + 7.5 * q, 12);
  expect(d.x).toBeCloseTo(305 + 7.5 * q, 12);
  expect(d.y).toBeCloseTo(-2.5 - 7.5 * q, 12);
});
it('rejects invalid depths, absent nested groups and later-track inconsistency atomically', () => {
  for (const groupDepth of [-1, 0.5, NaN, Infinity, 2, Number.MAX_SAFE_INTEGER]) {
    const p = nestedFixture(),
      before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, groupDepth },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
  const p = nestedFixture();
  const later = clone(p.layers[0]);
  later.id = 'later';
  later.keys[1].shapes[3].y++;
  p.layers.push(later);
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, groupDepth: 1 },
    ),
  ).toThrow();
  expect(p).toEqual(before);
  expect(() =>
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, rigidGroups: false, groupDepth: 0 },
    ),
  ).toThrow('nesting level');
});

it('retains cubic sine cancellation for distant pivots at tiny signed rotations', () => {
  for (const ratio of [0.5, 1, 2])
    for (const degrees of [1e-8, -1e-8]) {
      const p = fixture();
      const [a, b] = p.layers[0].keys[1].shapes;
      a.rotation = b.rotation = degrees;
      const pivot = ratio === 1 ? 1e32 : 1e12;
      for (const shape of [a, b]) shape.transform = [ratio, 0, 0, ratio];
      b.x = 100 + 20 * ratio;
      b.y = 20 * ratio * Math.sin((degrees * Math.PI) / 180);
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        true,
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, uniformGroupScale: true, rigidPivot: { x: 0, y: pivot } },
      );
      for (const frame of [1, 2, 3]) {
        const lead = p.layers[0].keys[frame].shapes[0],
          t = frame / 4;
        const theta = ((lead.rotation / t) * Math.PI) / 180;
        // sin(theta*t) - t*sin(theta): independent cubic Taylor term.
        // The fifth-order contribution here is below 1e-17 document units.
        const scale = 1 - t + t * ratio;
        const correction =
          pivot *
          (theta * (scale * t - t * ratio) + (theta ** 3 * (t * ratio - scale * t ** 3)) / 6);
        expect(lead.x).toBeCloseTo(100 * t + correction, 8);
      }
    }
});

it('moves custom and saved pivots with independent axis scales using a world-point oracle', () => {
  for (const saved of [false, true]) {
    const p = fixture();
    const [first, last] = p.layers[0].keys;
    first.shapes[0].pivot = { x: 13, y: -7 };
    last.shapes[0].pivot = { x: 13, y: -7 };
    for (const shape of last.shapes) shape.transform = [2, 0, 0, 0.5];
    last.shapes[1].y = 40;
    const before = clone(p);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      true,
      false,
      false,
      undefined,
      false,
      false,
      {
        ...rotation,
        axisGroupScale: true,
        savedGroupPivots: saved,
        rigidPivot: saved ? undefined : { x: 13, y: -7 },
      },
    );
    for (const f of [1, 2, 3]) {
      const t = f / 4,
        angle = (t * Math.PI) / 2;
      // Pivot endpoints are (13,-7) and (103.5,26); transform offsets around that moving pivot.
      const px = 13 * (1 - t) + 103.5 * t,
        py = -7 * (1 - t) + 26 * t;
      for (const i of [0, 1]) {
        const dx = (i * 20 - 13) * (1 + t),
          dy = 7 * (1 - 0.5 * t);
        const shape = p.layers[0].keys[f].shapes[i];
        expect(shape.x).toBeCloseTo(px + dx * Math.cos(angle) - dy * Math.sin(angle), 11);
        expect(shape.y).toBeCloseTo(py + dx * Math.sin(angle) + dy * Math.cos(angle), 11);
      }
    }
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  }
});
it('retains small-angle sine displacement for distant independently scaled pivots', () => {
  for (const ratio of [0.5, 1, 2])
    for (const degrees of [1e-8, -1e-8]) {
      const p = fixture();
      const [a, b] = p.layers[0].keys[1].shapes;
      a.rotation = b.rotation = degrees;
      const pivot = ratio === 1 ? 1e32 : 1e12;
      for (const shape of [a, b]) shape.transform = [0.75, 0, 0, ratio];
      b.x = 100 + 20 * 0.75;
      b.y = 20 * 0.75 * Math.sin((degrees * Math.PI) / 180);
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        true,
        false,
        false,
        undefined,
        false,
        false,
        { ...rotation, axisGroupScale: true, rigidPivot: { x: 0, y: pivot } },
      );
      for (const frame of [1, 2, 3]) {
        const lead = p.layers[0].keys[frame].shapes[0],
          t = frame / 4;
        const theta = ((lead.rotation / t) * Math.PI) / 180;
        // sin(theta*t) - t*sin(theta): independent cubic Taylor term.
        // The fifth-order contribution here is below 1e-17 document units.
        const scale = 1 - t + t * ratio;
        const correction =
          pivot *
          (theta * (scale * t - t * ratio) + (theta ** 3 * (t * ratio - scale * t ** 3)) / 6);
        expect(lead.x).toBeCloseTo(100 * t + correction, 8);
      }
    }
});

it('shears group member spacing and rotated artwork in source document axes', () => {
  const p = fixture();
  const [first, last] = p.layers[0].keys;
  first.shapes[1].y = 12;
  first.shapes[1].rotation = 90;
  last.shapes[0].transform = [2, 0, 0.75, 0.5];
  last.shapes[1].transform = [0.5, -0.75, 0, 2];
  last.shapes[1].rotation = 180;
  last.shapes[1].x = 94;
  last.shapes[1].y = 49;
  const before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, axisGroupScale: true, axisGroupShear: true },
  );
  for (const f of [1, 2, 3]) {
    const t = f / 4,
      a = (t * Math.PI) / 2,
      c = Math.cos(a),
      s = Math.sin(a);
    const [lead, member] = p.layers[0].keys[f].shapes;
    const dx = 20 * (1 + t) + 12 * 0.75 * t,
      dy = 12 * (1 - 0.5 * t);
    expect(member.x - lead.x).toBeCloseTo(c * dx - s * dy, 11);
    expect(member.y - lead.y).toBeCloseTo(s * dx + c * dy, 11);
    // Local (3,5) starts at world (-5,3), then receives X/Y scale and X shear.
    const x = -5 * (1 + t) + 3 * 0.75 * t,
      y = 3 * (1 - 0.5 * t);
    const basis = member.transform!,
      r = (member.rotation * Math.PI) / 180;
    const lx = basis[0] * 3 + basis[2] * 5,
      ly = basis[1] * 3 + basis[3] * 5;
    expect(lx * Math.cos(r) - ly * Math.sin(r)).toBeCloseTo(c * x - s * y, 11);
    expect(lx * Math.sin(r) + ly * Math.cos(r)).toBeCloseTo(s * x + c * y, 11);
  }
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});
it('rejects incompatible shear bases and missing axis mode atomically', () => {
  for (const mode of ['basis', 'axis'] as const) {
    const p = fixture();
    for (const shape of p.layers[0].keys[1].shapes) shape.transform = [2, 0, 0.75, 0.5];
    p.layers[0].keys[1].shapes[1].y = 40;
    if (mode === 'basis') p.layers[0].keys[1].shapes[1].transform![1] = 0.2;
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        true,
        false,
        false,
        undefined,
        false,
        false,
        {
          ...rotation,
          axisGroupScale: mode !== 'axis',
          axisGroupShear: true,
        },
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('applies shared X shear to oblique reflected and skewed group bases', () => {
  const p = fixture();
  const source = p.layers[0].keys[0].shapes,
    target = p.layers[0].keys[1].shapes;
  source[0].rotation = 37;
  source[0].transform = [1, 0.2, 0.3, -1];
  source[1].rotation = -21;
  source[1].transform = [1, 0, 0.25, 1];
  const rotate = (x: number, y: number, degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  };
  source.forEach((shape, i) => {
    target[i].rotation = shape.rotation + 90;
    const basis = shape.transform!;
    target[i].transform = [0, 0, 0, 0];
    for (const column of [0, 2]) {
      const world = rotate(basis[column], basis[column + 1], shape.rotation);
      const local = rotate(2 * world[0] + 0.6 * world[1], 0.5 * world[1], -shape.rotation);
      target[i].transform![column] = local[0];
      target[i].transform![column + 1] = local[1];
    }
  });
  target[1].y = 40;
  const original = clone(source);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    true,
    false,
    false,
    undefined,
    false,
    false,
    { ...rotation, axisGroupScale: true, axisGroupShear: true },
  );
  for (const frame of [1, 2, 3])
    for (const i of [0, 1]) {
      const shape = p.layers[0].keys[frame].shapes[i],
        basis = shape.transform!,
        before = original[i],
        base = before.transform!;
      const world = rotate(base[0] * 3 + base[2] * 5, base[1] * 3 + base[3] * 5, before.rotation);
      const expected = rotate(
        world[0] * (1 + frame / 4) + (world[1] * 0.6 * frame) / 4,
        world[1] * (1 - frame / 8),
        (90 * frame) / 4,
      );
      const actual = rotate(
        basis[0] * 3 + basis[2] * 5,
        basis[1] * 3 + basis[3] * 5,
        shape.rotation,
      );
      expect(actual[0]).toBeCloseTo(expected[0], 12);
      expect(actual[1]).toBeCloseTo(expected[1], 12);
    }
});

it('moves two-coordinate custom and saved pivots through scaled and sheared endpoint offsets', () => {
  for (const saved of [false, true])
    for (const h of [-0.75, 0.75]) {
      const p = fixture();
      const [first, last] = p.layers[0].keys;
      first.shapes[0].pivot = last.shapes[0].pivot = { x: 13, y: -7 };
      for (const shape of last.shapes) shape.transform = [2, 0, h, 0.5];
      last.shapes[1].y = 40;
      const before = clone(p);
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        true,
        false,
        false,
        undefined,
        false,
        false,
        {
          ...rotation,
          axisGroupScale: true,
          axisGroupShear: true,
          savedGroupPivots: saved,
          rigidPivot: saved ? undefined : { x: 13, y: -7 },
        },
      );
      for (const f of [1, 2, 3]) {
        const t = f / 4,
          a = (t * Math.PI) / 2,
          c = Math.cos(a),
          s = Math.sin(a);
        const px = 13 * (1 - t) + 103.5 * t,
          py = -7 * (1 - t) + (26 - 7 * h) * t;
        for (const i of [0, 1]) {
          const dx = (i * 20 - 13) * (1 + t) + 7 * h * t,
            dy = 7 * (1 - 0.5 * t);
          const shape = p.layers[0].keys[f].shapes[i];
          expect(shape.x).toBeCloseTo(px + c * dx - s * dy, 11);
          expect(shape.y).toBeCloseTo(py + s * dx + c * dy, 11);
        }
      }
      expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
      expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    }
});
it('retains distant shear-pivot translation and tiny-angle displacement', () => {
  for (const degrees of [0, 1e-8, -1e-8]) {
    const p = fixture();
    const [a, b] = p.layers[0].keys[1].shapes;
    a.rotation = b.rotation = degrees;
    a.transform = b.transform = [1, 0, 0.75, 1];
    const theta = (degrees * Math.PI) / 180;
    b.x = 120;
    b.y = 20 * Math.sin(theta);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      true,
      false,
      false,
      undefined,
      false,
      false,
      { ...rotation, axisGroupScale: true, axisGroupShear: true, rigidPivot: { x: 0, y: 1e22 } },
    );
    for (const f of [1, 2, 3]) {
      const t = f / 4,
        actual = p.layers[0].keys[f].shapes[0];
      const resolvedTheta = ((actual.rotation / t) * Math.PI) / 180;
      // Quadratic cosine and linear/cubic sine differences, with negligible higher terms.
      const x =
        100 * t +
        1e22 *
          ((resolvedTheta ** 3 * (t - t ** 3)) / 6 -
            (0.75 * t * resolvedTheta ** 2 * (1 - t * t)) / 2);
      const y =
        1e22 *
        ((resolvedTheta ** 2 * (t * t - t)) / 2 +
          0.75 * t * (resolvedTheta * (1 - t) - (resolvedTheta ** 3 * (1 - t ** 3)) / 6));
      expect(actual.x).toBeCloseTo(x, 3);
      expect(Math.abs(actual.y - y)).toBeLessThan(Math.max(1e-5, Math.abs(y) * 1e-14));
    }
  }
});

it('supports shared Y shear with rotated members and moving custom or saved pivots', () => {
  for (const saved of [false, true]) for (const h of [-0.75, 0.75]) {
    const p = fixture();
    const [first, last] = p.layers[0].keys;
    first.shapes[0].pivot = last.shapes[0].pivot = { x: 13, y: -7 };
    first.shapes[1].y = 12;
    first.shapes[1].rotation = 90;
    last.shapes[0].transform = [2, h, 0, 0.5];
    last.shapes[1].transform = [0.5, 0, -h, 2];
    last.shapes[1].rotation = 180;
    last.shapes[1].x = 100 - 20 * h - 6;
    last.shapes[1].y = 40;
    const before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', true, false, false,
      undefined, false, false, { ...rotation, axisGroupScale: true, axisGroupShear: true,
        savedGroupPivots: saved, rigidPivot: saved ? undefined : { x: 13, y: -7 } });
    for (const f of [1, 2, 3]) {
      const t = f / 4, c = Math.cos(t * Math.PI / 2), s = Math.sin(t * Math.PI / 2);
      const px = 13 * (1 - t) + (103.5 - 13 * h) * t;
      const py = -7 * (1 - t) + 26 * t;
      for (const i of [0, 1]) {
        const dx = (20 * i - 13) * (1 + t);
        const dy = (12 * i + 7) * (1 - 0.5 * t) + (20 * i - 13) * h * t;
        const shape = p.layers[0].keys[f].shapes[i];
        expect(shape.x).toBeCloseTo(px + c * dx - s * dy, 11);
        expect(shape.y).toBeCloseTo(py + s * dx + c * dy, 11);
      }
      const member = p.layers[0].keys[f].shapes[1];
      const [a,b,d,e] = member.transform!, angle = member.rotation * Math.PI / 180;
      const lx = a * 3 + d * 5, ly = b * 3 + e * 5;
      const x = -5 * (1 + t), y = 3 * (1 - 0.5 * t) - 5 * h * t;
      expect(lx * Math.cos(angle) - ly * Math.sin(angle)).toBeCloseTo(c * x - s * y, 11);
      expect(lx * Math.sin(angle) + ly * Math.cos(angle)).toBeCloseTo(s * x + c * y, 11);
    }
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  }
});
it('rejects inconsistent simultaneous X and Y member offsets atomically', () => {
  const p = fixture();
  for (const shape of p.layers[0].keys[1].shapes) shape.transform = [2, 0.3, 0.4, 0.5];
  const before = clone(p);
  expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', true, false, false,
    undefined, false, false, { ...rotation, axisGroupScale: true, axisGroupShear: true })).toThrow();
  expect(p).toEqual(before);
});

it('retains distant Y-shear pivot displacement at tiny signed rotations', () => {
  for (const degrees of [0, 1e-8, -1e-8]) {
    const p = fixture(), [a, b] = p.layers[0].keys[1].shapes;
    a.rotation = b.rotation = degrees;
    a.transform = b.transform = [1, 0.75, 0, 1];
    const theta = degrees * Math.PI / 180;
    b.x = 100 + 20 * Math.cos(theta) - 15 * Math.sin(theta);
    b.y = 20 * Math.sin(theta) + 15 * Math.cos(theta);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', true, false, false,
      undefined, false, false, { ...rotation, axisGroupScale: true, axisGroupShear: true,
        rigidPivot: { x: 1e22, y: 0 } });
    for (const f of [1, 2, 3]) {
      const t = f / 4, actual = p.layers[0].keys[f].shapes[0];
      const angle = actual.rotation / t * Math.PI / 180;
      const x = 100 * t + 1e22 * (angle ** 2 * (t*t-t)/2 -
        0.75*t*(angle*(1-t)-angle**3*(1-t**3)/6));
      const y = 1e22 * (angle**3*(t-t**3)/6 - 0.75*t*angle**2*(1-t*t)/2);
      expect(Math.abs(actual.x-x)).toBeLessThan(Math.max(1e-5, Math.abs(x)*1e-14));
      expect(actual.y).toBeCloseTo(y, 3);
    }
  }
});


it('composes curved reference paths and tangent headings with custom or saved group pivots', () => {
  for (const saved of [false, true]) for (const tangent of [false, true]) for (const axis of ['none', 'x', 'y', 'both', 'negative', 'zero']) {
    const p = fixture(), source = p.layers[0].keys[0].shapes, target = p.layers[0].keys[1].shapes;
    const sx = axis === 'negative' ? -1 : axis === 'zero' ? 0 : axis === 'none' ? 1 : 2, sy = axis === 'negative' ? -1 : axis === 'zero' ? 0 : axis === 'none' ? 1 : 0.5;
    const hx = axis === 'negative' || axis === 'zero' ? -2 : axis === 'x' || axis === 'both' ? 0.75 : 0, hy = axis === 'negative' || axis === 'zero' ? 2 : axis === 'y' || axis === 'both' ? -0.5 : 0;
    for (const shape of source) shape.pivot = { x: 10, y: 6 };
    for (let i = 0; i < target.length; i++) {
      target[i].pivot = { x: 10, y: 6 };
      if (axis !== 'none') target[i].transform = [sx, hy, hx, sy];
      target[i].x = 100 - hy * source[i].x;
      target[i].y = sx * source[i].x;
    }
    const before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', axis !== 'none', false, false,
      { startX: 20, startY: -30, endX: -20, endY: -30, tangent }, false, false,
      { ...rotation, axisGroupScale: axis !== 'none', axisGroupShear: axis !== 'none',
        savedGroupPivots: saved, rigidPivot: saved ? undefined : { x: 10, y: 6 } });
    for (const frame of [1, 2, 3]) {
      const t = frame / 4, u = 1-t;
      const pathX = 3*u*u*t*20 + 3*u*t*t*80 + t*t*t*100;
      const pathY = -90*u*t;
      const heading = tangent ? Math.atan2(-30*u*u+30*t*t,20*u*u+120*u*t+20*t*t) : 0;
      const angle = t*Math.PI/2 + heading;
      // Independently construct the moving pivot, then transform each member offset.
      const px = pathX + u*10 - t*(sy*6+hy*10);
      const py = pathY + u*6 + t*(sx*10+hx*6);
      for (let i=0;i<2;i++) {
        const dx = (source[i].x-10)*(u+t*sx) - 6*t*hx;
        const dy = -6*(u+t*sy) + (source[i].x-10)*t*hy;
        const shape = p.layers[0].keys[frame].shapes[i];
        expect(shape.x).toBeCloseTo(px+Math.cos(angle)*dx-Math.sin(angle)*dy,10);
        expect(shape.y).toBeCloseTo(py+Math.sin(angle)*dx+Math.cos(angle)*dy,10);
      }
    }
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  }
});


it('rejects collapsing or reflecting shared two-axis shear before writing any track', () => {
  for(const h of [1,2]) {
    const p=fixture();
    for(const shape of p.layers[0].keys[1].shapes) shape.transform=[1,h,1,1];
    p.layers[0].keys[1].shapes[1].x=100-20*h;
    const before=clone(p);
    expect(()=>generateMotionFrames(p,[p.layers[0].id],0,4,'linear',true,false,false,
      undefined,false,false,{...rotation,axisGroupScale:true,axisGroupShear:true})).toThrow();
    expect(p).toEqual(before);
  }
});

it('rejects interior matrix collapse even with positive endpoint determinant and no sampled zero', () => {
  for (const [hx, hy] of [[1, 0.2], [1e-7, -1e-7]]) {
    const p = fixture();
    for (const shape of p.layers[0].keys[1].shapes) shape.transform = [-2, hy, hx, -2];
    p.layers[0].keys[1].shapes[1].x = 100 - 20*hy;
    p.layers[0].keys[1].shapes[1].y = -40;
    const before = clone(p);
    expect(() => generateMotionFrames(p,[p.layers[0].id],0,4,'linear',true,false,false,
      undefined,false,false,{...rotation,axisGroupScale:true,axisGroupShear:true})).toThrow(/throughout/);
    expect(p).toEqual(before);
  }
});

it('keeps separate custom pivots when editing directed turns on multiple remembered groups',()=>{
 const p=fixture(),a=p.layers[0],b=clone(a);b.id='other';p.layers.push(b);
 for(const [i,layer] of p.layers.entries())createBasicMotionSpan(p,[layer.id],0,4,'linear',undefined,undefined,{...rotation,rigidPivot:{x:10+i*5,y:0}});
 const original=clone(p);
 setRememberedMotionSpin(p,[a.id,b.id],0,4,{direction:'clockwise',turns:1});
 for(const [i,layer] of p.layers.entries()){
  const pivot=10+i*5;expect(layer.motionSpans![0].rotation).toEqual({...rotation,direction:'clockwise',turns:1,rigidPivot:{x:pivot,y:0}});
  const mid=layer.keys[2].shapes[0];const angle=(90+360)*Math.PI/360;
  expect(mid.x).toBeCloseTo((pivot+100)/2-pivot*Math.cos(angle));expect(mid.y).toBeCloseTo(pivot/2-pivot*Math.sin(angle));
  expect(layer.keys[0]).toEqual(original.layers[i].keys[0]);expect(layer.keys[4]).toEqual(original.layers[i].keys[4]);
 }
});
