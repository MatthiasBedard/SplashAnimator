import { expect, it } from 'vitest';
import {
  clone,
  newProject,
  symbolLayers,
  type Vector,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  matchStraightMotionNodes,
  parseMotionNodeHints,
} from '../packages/animation/src/motion-resample';
import {
  generateMotionFrames,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
function shape(): Vector {
  return {
    id: 'a',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
}
it('merges edge-length partitions while retaining corners and detached inputs', () => {
  const a = shape(),
    b = clone(a);
  b.nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
  ];
  const before = clone([a, b]);
  const [first, last] = matchStraightMotionNodes(a, b);
  expect(first.nodes).toEqual([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ]);
  expect(last).toEqual(b);
  first.nodes![0].x = 99;
  expect([a, b]).toEqual(before);
  const c = shape();
  c.kind = 'polygon';
  delete c.nodes;
  c.contours = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ];
  const d = clone(c);
  d.contours![0].splice(1, 0, { x: 50, y: 0 });
  const [s, t] = matchStraightMotionNodes(c, d);
  expect(s.contours).toEqual(d.contours);
  expect(t).toEqual(d);
});
it('rejects curved, metadata-bearing, degenerate or mismatched contours', () => {
  for (const mode of [
    'handle',
    'pressure',
    'duplicate',
    'nonfinite',
    'closure',
    'kind',
    'empty',
  ] as const) {
    const a = shape(),
      b = clone(a);
    if (mode === 'handle') b.nodes![0].out = { x: 1, y: 1 };
    if (mode === 'pressure') b.nodes![0].pressure = 0.5;
    if (mode === 'duplicate') b.nodes![1] = { x: 0, y: 0 };
    if (mode === 'nonfinite') b.nodes![1].x = Infinity;
    if (mode === 'closure') b.closed = true;
    if (mode === 'kind') b.kind = 'path';
    if (mode === 'empty') b.nodes = [];
    expect(() => matchStraightMotionNodes(a, b)).toThrow();
  }
});
it('generates matched interior nodes in main and detached symbol timelines with exact endpoints', () => {
  const p = newProject();
  p.duration = 5;
  const a = shape(),
    b = clone(a);
  b.nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
  ];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  const before = clone(p);
  const generate = (project: typeof p, match: boolean) =>
    generateMotionFrames(
      project,
      [project.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      { direction: 'shortest', turns: 0 },
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      false,
      match,
    );
  expect(() => generate(p, false)).toThrow();
  expect(p).toEqual(before);
  generate(p, true);
  expect(p.layers[0].keys[2].shapes[0].nodes).toEqual([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 75, y: 25 },
  ]);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  const def: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 5, keys: [before.layers[0].keys[1]] },
  };
  const original = clone(def);
  const out = generateSymbolMotionFrames(
    def,
    [symbolLayers(def)[0].id],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [def],
    { direction: 'shortest', turns: 0 },
    false,
    false,
    false,
    false,
    0,
    false,
    undefined,
    false,
    true,
  );
  expect(out.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].nodes).toEqual(
    p.layers[0].keys[2].shapes[0].nodes,
  );
  expect(def).toEqual(original);
  const invalid = clone(before);
  const later = clone(invalid.layers[0]);
  later.id = 'later';
  later.keys[1].shapes[0].nodes![0].out = { x: 1, y: 1 };
  invalid.layers.push(later);
  const snapshot = clone(invalid);
  expect(() =>
    generateMotionFrames(
      invalid,
      invalid.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      { direction: 'shortest', turns: 0 },
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      false,
      true,
    ),
  ).toThrow();
  expect(invalid).toEqual(snapshot);
});

it('rejects unresolved length arithmetic and preserves continuous area guards after matching', () => {
  const a = shape(),
    b = clone(a);
  b.nodes = [
    { x: 0, y: 0 },
    { x: 1e20, y: 0 },
    { x: 1e20, y: 1 },
  ];
  expect(() => matchStraightMotionNodes(a, b)).toThrow(/unresolved/);
  const p = newProject();
  p.duration = 5;
  a.kind = 'polygon';
  delete a.nodes;
  a.contours = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ];
  const end = clone(a);
  end.contours = [
    [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
    ],
  ];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [end] },
  ];
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      { direction: 'shortest', turns: 0 },
      false,
      false,
      false,
      true,
      0,
      false,
      undefined,
      false,
      true,
    ),
  ).toThrow(/area/);
  expect(p).toEqual(before);
});

it('pairs explicit interior anchors and distributes remaining corners between them', () => {
  const a = shape(),
    b = clone(a);
  a.nodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  b.nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const [first, last] = matchStraightMotionNodes(a, b, [[[1, 1]]]);
  expect(first.nodes!.length).toBe(4);
  expect(first.nodes![1]).toEqual({ x: 100, y: 0 });
  expect(last.nodes![1]).toEqual({ x: 50, y: 0 });
  expect(first.nodes![2].x).toBe(100);
  expect(first.nodes![2].y).toBeCloseTo(100 / 3, 10);
  expect(last.nodes).toEqual(b.nodes);
  expect(parseMotionNodeHints('1:2, 3:4; ', true)).toEqual({
    hints: [
      [
        [1, 2],
        [3, 4],
      ],
      [],
    ],
  });
  expect(parseMotionNodeHints('', false)).toBe(false);
  expect(() => parseMotionNodeHints('1:2', false)).toThrow();
  expect(() => parseMotionNodeHints('1.5:2', true)).toThrow();
});
it('rejects invalid or crossing hints without changing either endpoint', () => {
  const a = shape(),
    b = clone(a);
  a.nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ];
  b.nodes = [
    { x: 0, y: 0 },
    { x: 25, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ];
  const before = clone([a, b]);
  for (const hints of [
    [],
    [[[0, 1]]],
    [[[1, 0]]],
    [[[2, 1]]],
    [[[1, 3]]],
    [
      [
        [1, 2],
        [1, 1],
      ],
    ],
    [[[NaN, 1]]],
  ]) {
    expect(() => matchStraightMotionNodes(a, b, hints as [number, number][][])).toThrow();
    expect([a, b]).toEqual(before);
  }
});

it('applies separate hints to closed compound contours without changing their seam anchors', () => {
  const a = shape();
  a.kind = 'polygon';
  delete a.nodes;
  const ring = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  a.contours = [ring, ring.map((p) => ({ x: p.x + 200, y: p.y }))];
  const b = clone(a);
  b.contours!.forEach((r) => r.splice(1, 0, { x: r[0].x + 50, y: 0 }));
  const [first, last] = matchStraightMotionNodes(a, b, [[[1, 1]], []]);
  expect(first.contours![0][1]).toEqual({ x: 100, y: 0 });
  expect(last.contours![0][1]).toEqual({ x: 50, y: 0 });
  expect(first.contours![0][0]).toEqual(a.contours[0][0]);
  expect(first.contours![1][0]).toEqual(a.contours[1][0]);
  const plain = matchStraightMotionNodes(a, b);
  expect(first.contours![1]).toEqual(plain[0].contours![1]);
  expect(last.contours![1]).toEqual(plain[1].contours![1]);
});

// Independent Bernstein evaluation, deliberately separate from subdivision.
function curvePoint(nodes: NonNullable<Vector['nodes']>, u: number, closed = false) {
  const n = nodes.length - (closed ? 0 : 1),
    v = u * n,
    i = Math.min(n - 1, Math.floor(v)),
    t = v - i,
    q = 1 - t;
  const a = nodes[i],
    b = nodes[(i + 1) % nodes.length],
    c = a.out ?? a,
    d = b.in ?? b;
  return {
    x: q * q * q * a.x + 3 * q * q * t * c.x + 3 * q * t * t * d.x + t * t * t * b.x,
    y: q * q * q * a.y + 3 * q * q * t * c.y + 3 * q * t * t * d.y + t * t * t * b.y,
  };
}
it('preserves unequal curved segment geometry through subdivision, including closed seams', () => {
  for (const closed of [false, true]) {
    const a = shape(),
      b = shape();
    a.closed = b.closed = closed;
    a.nodes = [
      { x: 0, y: 0, out: { x: 0, y: 80 }, in: { x: -10, y: 20 } },
      { x: 100, y: 0, in: { x: 100, y: 80 }, out: { x: 110, y: 20 } },
      { x: 50, y: -40, in: { x: 80, y: -60 }, out: { x: 20, y: -60 } },
    ];
    b.nodes = [
      { x: 0, y: 0, out: { x: 0, y: 30 } },
      { x: 30, y: 30, in: { x: 10, y: 30 } },
      { x: 60, y: 0, out: { x: 70, y: -20 } },
      { x: 100, y: 0, in: { x: 90, y: -20 } },
    ];
    const before = clone([a, b]);
    const matched = matchStraightMotionNodes(a, b, undefined, true);
    const knots = [
      ...new Set([
        ...Array.from(
          { length: a.nodes.length + (closed ? 1 : 0) },
          (_, i) => i / (a.nodes!.length - (closed ? 0 : 1)),
        ),
        ...Array.from(
          { length: b.nodes.length + (closed ? 1 : 0) },
          (_, i) => i / (b.nodes!.length - (closed ? 0 : 1)),
        ),
      ]),
    ].sort((x, y) => x - y);
    for (let j = 0; j < 2; j++)
      for (let k = 0; k <= 300; k++) {
        const u = k / 300,
          i = Math.min(
            knots.length - 2,
            knots.findIndex((v) => v > u) - 1 < 0
              ? knots.length - 2
              : knots.findIndex((v) => v > u) - 1,
          );
        const local = (u - knots[i]) / (knots[i + 1] - knots[i]);
        const actual = curvePoint(matched[j].nodes!, (i + local) / (knots.length - 1), closed);
        const expected = curvePoint(before[j].nodes!, u, closed);
        expect(actual.x).toBeCloseTo(expected.x, 10);
        expect(actual.y).toBeCloseTo(expected.y, 10);
      }
    for (const shape of matched)
      for (const n of shape.nodes!) {
        expect(Object.keys(n.in!).sort()).toEqual(['x', 'y']);
        expect(Object.keys(n.out!).sort()).toEqual(['x', 'y']);
      }
    expect([a, b]).toEqual(before);
    matched[0].nodes![0].out!.x = 999;
    expect([a, b]).toEqual(before);
  }
});
it('supports curved hints and rejects conflicting modes and unsupported metadata', () => {
  expect(parseMotionNodeHints('', false, true)).toEqual({ curves: true });
  expect(parseMotionNodeHints('1:1', false, true)).toEqual({ curves: true, hints: [[[1, 1]]] });
  expect(() => parseMotionNodeHints('', true, true)).toThrow(/either/);
  const a = shape(),
    b = shape();
  a.nodes = [
    { x: 0, y: 0, out: { x: 0, y: 50 } },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
  ];
  b.nodes = [
    { x: 0, y: 0 },
    { x: 20, y: 20 },
    { x: 60, y: 40 },
    { x: 100, y: 0 },
  ];
  const [x, y] = matchStraightMotionNodes(a, b, [[[1, 1]]], true);
  expect(x.nodes![1]).toMatchObject({ x: 50, y: 50 });
  expect(y.nodes![1]).toMatchObject({ x: 20, y: 20 });
  for (const invalid of [
    { ...a, kind: 'polygon' as const },
    { ...a, nodes: a.nodes.map((n) => ({ ...n, pressure: 0.5 })) },
    {
      ...a,
      nodes: [
        { x: 0, y: 0, out: { x: NaN, y: 0 } },
        { x: 100, y: 0 },
      ],
    },
  ])
    expect(() => matchStraightMotionNodes(invalid, b, undefined, true)).toThrow();
});
it('generates curved matches atomically with exact authored keys', () => {
  const p = newProject();
  p.duration = 5;
  const a = shape(),
    b = shape();
  a.nodes![0].out = { x: 0, y: 80 };
  a.nodes![1].in = { x: 100, y: 80 };
  b.nodes = [
    { x: 0, y: 0, out: { x: 0, y: 20 } },
    { x: 50, y: 30, in: { x: 25, y: 30 }, out: { x: 75, y: 30 } },
    { x: 100, y: 0, in: { x: 100, y: 20 } },
  ];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  const original = clone(p);
  const run = (project: typeof p) =>
    generateMotionFrames(
      project,
      project.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      false,
      { curves: true },
    );
  const invalid = clone(p);
  invalid.layers.push({ ...clone(invalid.layers[0]), id: 'bad' });
  invalid.layers[1].keys[1].shapes[0].nodes![1].out!.x = NaN;
  const before = structuredClone(invalid);
  expect(() => run(invalid)).toThrow();
  expect(invalid).toEqual(before);
  run(p);
  expect(p.layers[0].keys[2].shapes[0].nodes![1]).toMatchObject({ x: 50, y: 45 });
  expect(p.layers[0].keys[0]).toEqual(original.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(original.layers[0].keys[1]);
});

it('matches curved anchor fractions against independent dense arc length with exact subdivision', () => {
  const a = shape(),
    b = shape();
  a.nodes = [
    { x: 0, y: 0, out: { x: 0, y: 80 } },
    { x: 100, y: 0, in: { x: 100, y: 80 } },
  ];
  b.nodes = [
    { x: 0, y: 0 },
    { x: 25, y: 0 },
    { x: 100, y: 0 },
  ];
  const plain = matchStraightMotionNodes(a, b, undefined, true);
  const [first, last] = matchStraightMotionNodes(a, b, undefined, true, true);
  expect(plain[0].nodes![1].x).toBe(50);
  const n = 20000,
    lengths = [0];
  let previous = curvePoint(a.nodes, 0);
  for (let i = 1; i <= n; i++) {
    const p = curvePoint(a.nodes, i / n);
    lengths.push(lengths[i - 1] + Math.hypot(p.x - previous.x, p.y - previous.y));
    previous = p;
  }
  const wanted = lengths[n] / 4;
  let i = 1;
  while (lengths[i] < wanted) i++;
  const t = (i - 1 + (wanted - lengths[i - 1]) / (lengths[i] - lengths[i - 1])) / n;
  const expected = curvePoint(a.nodes, t);
  expect(first.nodes![1].x).toBeCloseTo(expected.x, 3);
  expect(first.nodes![1].y).toBeCloseTo(expected.y, 3);
  expect(last.nodes![1]).toMatchObject({ x: 25, y: 0 });
  // Recovered split parameter from the first control's Y, which is 80*t.
  const actualT = first.nodes![0].out!.y / 80;
  for (let j = 0; j <= 100; j++) {
    const u = j / 100,
      original = u <= 0.5 ? 2 * u * actualT : actualT + (2 * u - 1) * (1 - actualT);
    const actual = curvePoint(first.nodes!, u),
      ref = curvePoint(a.nodes, original);
    expect(actual.x).toBeCloseTo(ref.x, 10);
    expect(actual.y).toBeCloseTo(ref.y, 10);
  }
});
it('retains curved hints in distance mode and rejects zero-length and invalid modes atomically', () => {
  const a = shape(),
    b = shape();
  a.nodes = [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { x: 100, y: 0 },
  ];
  b.nodes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 100, y: 0 },
  ];
  const [first, last] = matchStraightMotionNodes(a, b, [[[1, 1]]], true, true);
  expect(first.nodes![1]).toMatchObject({ x: 30, y: 40 });
  expect(last.nodes![1]).toMatchObject({ x: 10, y: 0 });
  expect(parseMotionNodeHints('', false, true, true)).toEqual({ curves: true, distance: true });
  expect(() => parseMotionNodeHints('', true, false, true)).toThrow(/requires curved/);
  const zero = clone(a);
  zero.nodes![1] = { ...zero.nodes![0] };
  const before = clone(zero);
  expect(() => matchStraightMotionNodes(zero, b, undefined, true, true)).toThrow(
    /degenerate|unresolved/,
  );
  expect(zero).toEqual(before);
  expect(() => matchStraightMotionNodes(a, b, undefined, false, true)).toThrow(/requires curved/);
});
it('rejects sparse node-hint pairs instead of silently ignoring them', () => {
  const a = shape(),
    b = shape();
  a.nodes!.splice(1, 0, { x: 30, y: 0 });
  b.nodes!.splice(1, 0, { x: 70, y: 0 });
  const before = clone([a, b]);
  for (const pair of [
    Array(2),
    Object.assign(Array(2), { 0: 1 }),
    Object.assign(Array(2), { 1: 1 }),
  ]) {
    expect(() => matchStraightMotionNodes(a, b, [[pair]] as [number, number][][])).toThrow(
      /interior anchors/,
    );
    expect([a, b]).toEqual(before);
  }
});
