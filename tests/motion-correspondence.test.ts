import { expect, it } from 'vitest';
import { newProject, clone, type Vector, type SymbolDefinition } from '../packages/document/src';
import {
  generateMotionFrames,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
import {
  shiftMotionContourStart,
  parseMotionContourStarts,
  parseMotionContourOrder,
  parseMotionContourDirections,
  type MotionContourReverse,
} from '../packages/animation/src/motion-nodes';
function fixture() {
  const p = newProject();
  p.duration = 6;
  const a: Vector = {
    id: 'a',
    kind: 'bezier',
    closed: true,
    x: 0,
    y: 0,
    width: 30,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 10, y: -5 } },
      { x: 30, y: 0, in: { x: 20, y: -5 } },
      { x: 0, y: 20 },
    ],
  };
  const b = clone(a);
  b.nodes = [b.nodes![2], b.nodes![0], b.nodes![1]];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  return p;
}
function generate(p: ReturnType<typeof fixture>, offset: number, nodes = true) {
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    nodes,
    undefined,
    false,
    false,
    undefined,
    false,
    false,
    false,
    true,
    offset,
  );
}
it('matches cyclic end nodes and handles while preserving exact authored keys', () => {
  const p = fixture(),
    before = clone(p);
  generate(p, 1);
  expect(p.layers[0].keys[2].shapes[0].nodes).toEqual(before.layers[0].keys[0].shapes[0].nodes);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  p.layers[0].keys[2].shapes[0].nodes![0].out!.x = 999;
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
});
it('wraps offsets independently for compound contours without reversing winding', () => {
  const shape = fixture().layers[0].keys[0].shapes[0];
  shape.kind = 'polygon';
  shape.contours = [
    shape.nodes!,
    [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ],
  ];
  delete shape.nodes;
  const before = clone(shape),
    shifted = shiftMotionContourStart(shape, 5);
  expect(shifted.contours![0]).toEqual([
    before.contours![0][2],
    ...before.contours![0].slice(0, 2),
  ]);
  expect(shifted.contours![1]).toEqual([...before.contours![1].slice(1), before.contours![1][0]]);
  expect(shape).toEqual(before);
});
it('rejects invalid offsets, missing node interpolation, open paths and repeated closure atomically', () => {
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const p = fixture(),
      before = clone(p);
    expect(() => generate(p, offset)).toThrow(/offset/);
    expect(p).toEqual(before);
  }
  expect(() => generate(fixture(), 1, false)).toThrow(/node interpolation/);
  for (const repeated of [false, true]) {
    const p = fixture(),
      end = p.layers[0].keys[1].shapes[0];
    if (repeated) end.nodes!.push(clone(end.nodes![0]));
    else end.closed = false;
    const before = clone(p);
    expect(() => generate(p, 1)).toThrow(/zero contour start offset|closing anchor/);
    expect(p).toEqual(before);
  }
});
it('uses shifted correspondence for symbol preflight and keeps original definitions detached', () => {
  const p = fixture(),
    keys = p.layers[0].keys;
  const definition: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: keys[0].shapes,
    timeline: { duration: 6, keys: [keys[1]], layers: [] },
  };
  const before = clone(definition);
  const result = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [definition],
    undefined,
    false,
    false,
    false,
    true,
    1,
  );
  expect(result.timeline!.keys[1].shapes[0].nodes).toEqual(definition.shapes[0].nodes);
  expect(result.timeline!.keys[3]).toEqual(keys[1]);
  expect(definition).toEqual(before);
});

it('rolls back all checked tracks when a later contour cannot be shifted', () => {
  const p = fixture();
  const second = clone(p.layers[0]);
  second.id = 'second';
  second.keys[1].shapes[0].closed = false;
  p.layers.push(second);
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
      true,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      true,
      1,
    ),
  ).toThrow(/zero contour start offset/);
  expect(p).toEqual(before);
});

it('reverses end correspondence around the selected anchor and swaps asymmetric handles', () => {
  const p = fixture();
  const a = p.layers[0].keys[0].shapes[0];
  const b = clone(a);
  b.nodes = [a.nodes![1], a.nodes![0], a.nodes![2]].map((node) => {
    const result = {
      x: node.x,
      y: node.y,
      ...(node.out ? { in: { ...node.out } } : {}),
      ...(node.in ? { out: { ...node.in } } : {}),
    };
    return result;
  });
  p.layers[0].keys[1].shapes = [b];
  const before = clone(p);
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
    undefined,
    false,
    false,
    false,
    true,
    1,
    true,
  );
  expect(p.layers[0].keys[2].shapes[0].nodes).toEqual(a.nodes);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  const definition: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 6, keys: [before.layers[0].keys[1]], layers: [] },
  };
  const original = clone(definition);
  const result = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [definition],
    undefined,
    false,
    false,
    false,
    true,
    1,
    true,
  );
  expect(result.timeline!.keys[1].shapes[0].nodes).toEqual(a.nodes);
  expect(definition).toEqual(original);
});
it('reverses compound contours consistently and requires zero offset for open paths', () => {
  const a = fixture().layers[0].keys[0].shapes[0];
  a.kind = 'polygon';
  a.contours = [
    a.nodes!,
    [
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 4, y: 2 },
    ],
  ];
  delete a.nodes;
  const original = clone(a);
  const reversed = shiftMotionContourStart(a, 0, true);
  expect(reversed.contours![1]).toEqual([a.contours[1][0], a.contours[1][2], a.contours[1][1]]);
  expect(shiftMotionContourStart(reversed, 0, true)).toEqual(a);
  expect(a).toEqual(original);
  expect(() =>
    shiftMotionContourStart({ ...fixture().layers[0].keys[0].shapes[0], closed: false }, 1, true),
  ).toThrow(/zero contour start offset/);
});

it('matches reversed open paths without wrapping their endpoints or losing unused handles', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  a.closed = false;
  a.nodes![0].in = { x: -3, y: 2 };
  a.nodes![2].out = { x: 7, y: 24 };
  const b = clone(a);
  b.nodes = [...a.nodes!].reverse().map((n) => ({
    x: n.x,
    y: n.y,
    ...(n.out ? { in: { ...n.out } } : {}),
    ...(n.in ? { out: { ...n.in } } : {}),
  }));
  p.layers[0].keys[1].shapes = [b];
  const before = clone(p);
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
    undefined,
    false,
    false,
    false,
    true,
    0,
    true,
  );
  for (const key of p.layers[0].keys.slice(1, 4)) expect(key.shapes[0].nodes).toEqual(a.nodes);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(shiftMotionContourStart(b, 0, true)).toEqual(a);
});

it('rejects nonfinite original symbol node coordinates before JSON cloning', () => {
  for (const bad of [NaN, Infinity, -Infinity])
    for (const part of ['anchor', 'handle'] as const)
      for (const axis of ['x', 'y'] as const)
        for (const endpoint of [0, 1])
          for (const polygon of [false, true]) {
            const first = fixture().layers[0].keys[0].shapes[0],
              last = clone(first);
            const pair = [first, last];
            const node = pair[endpoint].nodes![0];
            (part === 'anchor' ? node : node.out!)[axis] = bad;
            if (polygon)
              for (const shape of pair) {
                shape.kind = 'polygon';
                shape.contours = [shape.nodes!];
                delete shape.nodes;
              }
            const definition: SymbolDefinition = {
              id: 's',
              name: 'S',
              width: 100,
              height: 100,
              shapes: [first],
              timeline: { duration: 6, keys: [{ frame: 4, shapes: [last] }], layers: [] },
            };
            const before = structuredClone(definition);
            expect(() =>
              generateSymbolMotionFrames(definition, ['@base'], 0, 4, 'linear', false, false, true),
            ).toThrow(/finite coordinates/);
            expect(definition).toEqual(before);
          }
});
it('rejects malformed later-track node data atomically without inspecting unselected tracks', () => {
  const p = fixture(),
    second = clone(p.layers[0]);
  second.id = 'second';
  second.keys[1].shapes[0].nodes![0].x = NaN;
  p.layers.push(second);
  const before = structuredClone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
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
      1,
    ),
  ).toThrow(/finite coordinates/);
  expect(p).toEqual(before);
  generate(p, 1);
  expect(p.layers[1]).toEqual(before.layers[1]);
});

it('rejects original nonfinite symbol poses before cloning with default motion options', () => {
  for (const bad of [NaN, Infinity, -Infinity])
    for (const field of ['x', 'y', 'rotation', 'opacity'] as const)
      for (const endpoint of [0, 1]) {
        const first = fixture().layers[0].keys[0].shapes[0],
          last = clone(first);
        [first, last][endpoint][field] = bad;
        const definition: SymbolDefinition = {
          id: 's',
          name: 'S',
          width: 100,
          height: 100,
          shapes: [first],
          timeline: { duration: 6, keys: [{ frame: 4, shapes: [last] }], layers: [] },
        };
        const before = structuredClone(definition);
        expect(() => generateSymbolMotionFrames(definition, ['@base'], 0, 4, 'linear')).toThrow(
          /finite/,
        );
        expect(definition).toEqual(before);
      }
});

it('rejects nonfinite original symbol corner radii before primitive interpolation', () => {
  for (const bad of [NaN, Infinity, -Infinity])
    for (const endpoint of [0, 1]) {
      const first = fixture().layers[0].keys[0].shapes[0];
      first.kind = 'rectangle';
      delete first.nodes;
      first.cornerRadius = 4;
      const last = clone(first);
      [first, last][endpoint].cornerRadius = bad;
      const definition: SymbolDefinition = {
        id: 's',
        name: 'S',
        width: 100,
        height: 100,
        shapes: [first],
        timeline: { duration: 6, keys: [{ frame: 4, shapes: [last] }], layers: [] },
      };
      const before = structuredClone(definition);
      expect(() =>
        generateSymbolMotionFrames(
          definition,
          ['@base'],
          0,
          4,
          'linear',
          false,
          false,
          false,
          undefined,
          true,
        ),
      ).toThrow(/finite/);
      expect(definition).toEqual(before);
    }
});

it('pairs compound contour starts independently in main and symbol motion', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  a.kind = 'polygon';
  delete a.nodes;
  a.contours = [
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 30 },
    ],
    [
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 3 },
    ],
  ];
  const b = clone(a);
  b.contours = [
    [b.contours![0][2], ...b.contours![0].slice(0, 2)],
    [...b.contours![1].slice(2), ...b.contours![1].slice(0, 2)],
  ];
  p.layers[0].keys[1].shapes = [b];
  const before = clone(p);
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
    undefined,
    false,
    false,
    false,
    true,
    [1, 2],
  );
  expect(p.layers[0].keys[2].shapes[0].contours).toEqual(a.contours);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  const d: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 6, keys: [before.layers[0].keys[1]], layers: [] },
  };
  const original = clone(d);
  const result = generateSymbolMotionFrames(
    d,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [d],
    undefined,
    false,
    false,
    false,
    true,
    [1, 2],
  );
  expect(result.timeline!.keys[1].shapes[0].contours).toEqual(a.contours);
  expect(d).toEqual(original);
});
it('parses explicit contour hints and rejects malformed or mismatched lists', () => {
  expect(parseMotionContourStarts(' ', 4)).toBe(4);
  expect(parseMotionContourStarts(' 1, 2, 0 ', 4)).toEqual([1, 2, 0]);
  for (const text of ['1,', ',2', '1,,2', '-1', '0.5', '1e2', 'NaN', '9007199254740992'])
    expect(() => parseMotionContourStarts(text, 0)).toThrow(/offset/);
  const shape = fixture().layers[0].keys[0].shapes[0];
  for (const list of [[], [0, 1], [NaN]])
    expect(() => shiftMotionContourStart(shape, list)).toThrow(/offset/);
  const open = { ...shape, closed: false };
  expect(shiftMotionContourStart(open, [0])).toEqual(open);
  expect(shiftMotionContourStart(open, [0], true)).toEqual(shiftMotionContourStart(open, 0, true));
});

it('reorders compound end contours before independent offsets in main and symbol motion', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  a.kind = 'polygon';
  delete a.nodes;
  a.contours = [
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 30 },
    ],
    [
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 3 },
    ],
  ];
  const b = clone(a);
  b.contours = [
    [b.contours![0][2], ...b.contours![0].slice(0, 2)],
    [...b.contours![1].slice(2), ...b.contours![1].slice(0, 2)],
  ];
  b.contours.reverse();
  p.layers[0].keys[1].shapes = [b];
  const before = clone(p);
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
    undefined,
    false,
    false,
    false,
    true,
    [1, 2],
    false,
    [1, 0],
  );
  expect(p.layers[0].keys[2].shapes[0].contours).toEqual(a.contours);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  const d: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 6, keys: [before.layers[0].keys[1]], layers: [] },
  };
  const original = clone(d);
  const result = generateSymbolMotionFrames(
    d,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [d],
    undefined,
    false,
    false,
    false,
    true,
    [1, 2],
    false,
    [1, 0],
  );
  expect(result.timeline!.keys[1].shapes[0].contours).toEqual(a.contours);
  expect(d).toEqual(original);
});

it('rejects invalid contour order permutations without mutating selected motion', () => {
  expect(parseMotionContourOrder(' ')).toBeUndefined();
  expect(parseMotionContourOrder(' 1, 0 ')).toEqual([1, 0]);
  for (const text of ['0,0', '1', '-1', '0,2', '0,', '0.5', '9007199254740992'])
    expect(() => parseMotionContourOrder(text)).toThrow(/order/);
  for (const order of [[], [0, 0], [1, 0], [NaN], [-1]]) {
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
        true,
        undefined,
        false,
        false,
        undefined,
        false,
        false,
        false,
        true,
        0,
        false,
        order,
      ),
    ).toThrow(/order/);
    expect(p).toEqual(before);
  }
});

it('composes contour ordering with reversal and rejects a later incompatible track atomically', () => {
  const p = fixture(),
    shape = p.layers[0].keys[0].shapes[0];
  shape.kind = 'polygon';
  shape.contours = [shape.nodes!, shape.nodes!.map((n) => ({ ...n, x: n.x + 50 }))];
  delete shape.nodes;
  const before = clone(shape);
  const paired = shiftMotionContourStart(shape, [1, 1], true, [1, 0]);
  expect(shiftMotionContourStart(paired, [1, 1], true, [1, 0])).toEqual(before);
  expect(shape).toEqual(before);
  p.layers[0].keys[1].shapes = [clone(shape)];
  const other = clone(p.layers[0]);
  other.id = 'other';
  for (const key of other.keys) key.shapes[0].contours!.pop();
  p.layers.push(other);
  const original = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
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
      [1, 0],
    ),
  ).toThrow(/order count/);
  expect(p).toEqual(original);
});

it('matches independent contour directions after ordering and offsets with exact main and symbol endpoints', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  a.kind = 'polygon';
  a.fillRule = 'evenodd';
  a.contours = [
    a.nodes!,
    [
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 2 },
    ],
  ];
  delete a.nodes;
  const b = clone(a);
  // End stores hole first, backwards from anchor 2; exterior starts at anchor 2.
  const hole = b.contours![1],
    outer = b.contours![0];
  b.contours = [
    [hole[2], hole[1], hole[0], hole[3]],
    [outer[2], outer[0], outer[1]],
  ];
  p.layers[0].keys[1].shapes = [b];
  const before = clone(p);
  const d: SymbolDefinition = {
    id: 's',
    name: 'S',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 6, keys: [{ frame: 4, shapes: [b] }], layers: [] },
  };
  const original = clone(d);
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
    undefined,
    false,
    false,
    false,
    'edges',
    [1, 2],
    [false, true],
    [1, 0],
  );
  const result = generateSymbolMotionFrames(
    d,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    [d],
    undefined,
    false,
    false,
    false,
    'edges',
    [1, 2],
    [false, true],
    [1, 0],
  );
  expect(d).toEqual(original);
  for (const key of p.layers[0].keys.slice(1, 4))
    expect(key.shapes[0].contours).toEqual(a.contours);
  for (const key of result.timeline!.keys.filter((k) => k.frame < 4))
    expect(key.shapes[0].contours).toEqual(a.contours);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  expect(result.timeline!.keys.at(-1)!.shapes).toEqual([b]);
  // Independent reversal swaps asymmetric handles on only the chosen contour.
  const shifted = shiftMotionContourStart(a, 0, [true, false]);
  expect(shifted.contours![0][0].in).toEqual(a.contours![0][0].out);
  expect(shifted.contours![0][0].out).toBeUndefined();
  expect(shifted.contours![1]).toEqual(a.contours![1]);
  expect(shiftMotionContourStart(shifted, 0, [true, false])).toEqual(a);
});

it('validates contour direction lists and rejects later mismatched tracks atomically', () => {
  expect(parseMotionContourDirections(' ', true)).toBe(true);
  expect(parseMotionContourDirections(' Forward, REVERSE ', false)).toEqual([false, true]);
  for (const text of ['true', '0', 'forward,', 'backward'])
    expect(() => parseMotionContourDirections(text, false)).toThrow(/directions/);
  const run = (p: ReturnType<typeof fixture>, reverse: MotionContourReverse, nodes = true) =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      nodes,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      false,
      1,
      reverse,
    );
  for (const reverse of [[], [false, true], [1] as unknown as boolean[]]) {
    const p = fixture(),
      before = clone(p);
    expect(() => run(p, reverse)).toThrow(/direction/);
    expect(p).toEqual(before);
  }
  expect(() => run(fixture(), [false], false)).toThrow(/node interpolation/);
  const p = fixture(),
    other = clone(p.layers[0]);
  other.id = 'later';
  for (const key of other.keys) {
    const shape = key.shapes[0];
    shape.kind = 'polygon';
    shape.contours = [shape.nodes!, clone(shape.nodes!)];
    delete shape.nodes;
  }
  p.layers.push(other);
  const before = clone(p);
  expect(() => run(p, [false])).toThrow(/direction count/);
  expect(p).toEqual(before);
  const open = fixture().layers[0].keys[0].shapes[0];
  open.closed = false;
  expect(shiftMotionContourStart(open, 0, [true])).toEqual(shiftMotionContourStart(open, 0, true));
});
