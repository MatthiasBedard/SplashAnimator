import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { generateMotionFrames } from '../packages/animation/src/motion-frames';
import { validateMotionContourContacts } from '../packages/animation/src/motion-contact';

function curve(): Vector {
  return {
    id: 'curve',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 1, y: 2 } },
      { x: 3, y: 0, in: { x: 2, y: 2 } },
      { x: 3, y: 4, out: { x: 2, y: 2 } },
      { x: 0, y: 4, in: { x: 1, y: 2 } },
    ],
  };
}
it('certifies disjoint curves even when their control hulls touch', () => {
  const a = curve(),
    b = clone(a);
  for (const p of b.nodes!)
    for (const q of [p, p.in, p.out])
      if (q) {
        q.x += 1e12;
        q.y -= 1e12;
      }
  const before = clone([a, b]);
  // At matching x, the two cubic heights are 6u(1-u) and 4-6u(1-u): gap >=1.
  expect(() => validateMotionContourContacts(a, b)).not.toThrow();
  expect([a, b]).toEqual(before);
});
it('rejects transient curved contact despite separated endpoint curves', () => {
  const a = curve(),
    b = clone(a);
  for (const p of b.nodes!.slice(2)) for (const q of [p, p.in, p.out]) if (q) q.y -= 20;
  expect(() => validateMotionContourContacts(a, a)).not.toThrow();
  expect(() => validateMotionContourContacts(b, b)).not.toThrow();
  // At t=1/20 and u=v=1/2, both nonadjacent cubics pass through (1.5,1.5).
  expect(() => validateMotionContourContacts(a, b)).toThrow(/touch|unresolved/);
});
it('includes nonadjacent closed-seam segment pairs and bounds aggregate work', () => {
  const a = curve();
  a.closed = true;
  expect(() => validateMotionContourContacts(a, a)).not.toThrow();
  a.nodes = [
    { x: 0, y: 0, out: { x: 1, y: 0 } },
    { x: 3, y: 0 },
    { x: -1, y: 2 },
    { x: 3, y: 2 },
  ];
  // Closing segment crosses segment 1; it must not be skipped as a seam neighbor.
  expect(() => validateMotionContourContacts(a, a)).toThrow(/touch|unresolved/);
  a.nodes = Array.from({ length: 635 }, (_, i) => ({ x: i, y: 0, out: { x: i + 0.25, y: 0 } }));
  a.closed = false;
  expect(() => validateMotionContourContacts(a, a)).toThrow(/work budget/);
});

it('generates safe curves and rejects a later unsafe track before any writes', () => {
  const p = newProject();
  p.duration = 5;
  p.layers[0].keys = [
    { frame: 0, shapes: [curve()] },
    { frame: 4, shapes: [curve()] },
  ];
  const before = clone(p);
  const run = () =>
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
      'contacts',
    );
  run();
  expect(p.layers[0].keys).toHaveLength(5);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  p.layers = clone(before.layers);
  const bad = clone(p.layers[0]);
  bad.id = 'bad';
  for (const node of bad.keys[1].shapes[0].nodes!.slice(2))
    for (const q of [node, node.in, node.out]) if (q) q.y -= 20;
  p.layers.push(bad);
  const original = clone(p);
  expect(run).toThrow(/touch|unresolved/);
  expect(p).toEqual(original);
});

it('allows shared adjacent endpoints but rejects a transient second contact', () => {
  const a = curve();
  const nodes = (h: number) => [
    { x: 0, y: 0, out: { x: 1, y: 2 } },
    { x: 3, y: 0, in: { x: 2, y: 2 }, out: { x: 2, y: h } },
    { x: 0, y: h, in: { x: 1, y: h } },
  ];
  a.nodes = nodes(4);
  const b = clone(a);
  b.nodes = nodes(-1);
  expect(() => validateMotionContourContacts(a, a)).not.toThrow();
  expect(() => validateMotionContourContacts(b, b)).not.toThrow();
  // At t=16/35, h=12/7. Both curves at parameter 1/2 are (1.5,1.5).
  expect(((4 * (1 - 16 / 35) - 16 / 35) * 7) / 8).toBeCloseTo(1.5, 14);
  expect(() => validateMotionContourContacts(a, b)).toThrow(/touch|unresolved/);
  // Closing seam: rotate the same adjacent pair across the node-array boundary.
  a.closed = b.closed = true;
  a.nodes = [a.nodes[1], a.nodes[2], a.nodes[0]];
  b.nodes = [b.nodes[1], b.nodes[2], b.nodes[0]];
  expect(() => validateMotionContourContacts(a, b)).toThrow(/touch|unresolved/);
});

it('retains safe adjacent joins with widely unequal segment lengths', () => {
  for (const size of [1e-16, 1e-100, 1e100]) {
    const a = curve();
    a.nodes = [
      { x: -3 * size, y: 0, out: { x: -2 * size, y: 0 } },
      { x: 0, y: 0, in: { x: -size, y: 0 }, out: { x: 1, y: 1 } },
      { x: 3, y: 3, in: { x: 2, y: 2 } },
    ];
    // Each segment is straight and both advance strictly in X; only the join coincides.
    expect(() => validateMotionContourContacts(a, a)).not.toThrow();
    const b = clone(a);
    b.nodes![1].out = { x: -1, y: 0 };
    b.nodes![2] = { x: -3, y: 0, in: { x: -2, y: 0 } };
    expect(() => validateMotionContourContacts(b, b)).toThrow(/touch|unresolved/);
  }
});
