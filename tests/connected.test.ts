import { describe, it, expect } from 'vitest';
import { id, clone, type Vector } from '../packages/document/src';
import { symbolStrokeCandidates } from '../packages/geometry/src/symbol-artwork';
import { connectedPaint } from '../packages/geometry/src/connected';
import { transformVectors, around } from '../packages/geometry/src';
const box = (x: number, y = 0): Vector => ({
  id: id(),
  kind: 'rectangle',
  x,
  y,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});

it('does not bridge disjoint tiny diagonal paint merely because their edge cross products are small', () => {
  for (const scale of [1, 10, 1000]) {
    const triangle = (shift: number): Vector => ({
      ...box(shift * scale, shift * scale),
      kind: 'polygon',
      width: 0.001 * scale,
      height: 0.001 * scale,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 0.001 * scale, y: 0 },
          { x: 0, y: 0.001 * scale },
        ],
      ],
    });
    const a = triangle(0),
      b = triangle(0.0006);
    const before = clone([a, b]);
    expect(connectedPaint([a, b], a.id).map((s) => s.id)).toEqual([a.id]);
    expect(connectedPaint([a, b], b.id).map((s) => s.id)).toEqual([b.id]);
    expect([a, b]).toEqual(before);
  }
});

it('uses document-space distance consistently for tiny diagonal boundary contacts', () => {
  const triangle = (shift: number): Vector => ({
    ...box(shift, shift),
    kind: 'polygon',
    width: 0.001,
    height: 0.001,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0, y: 0.001 },
      ],
    ],
  });
  const a = triangle(0),
    touching = triangle(0.0005),
    near = triangle(0.0005 + 0.25e-6),
    far = triangle(0.0005 + 2e-6);
  expect(connectedPaint([a, touching], a.id).map((s) => s.id)).toEqual([a.id, touching.id]);
  expect(connectedPaint([a, near], a.id).map((s) => s.id)).toEqual([a.id, near.id]);
  expect(connectedPaint([a, far], a.id).map((s) => s.id)).toEqual([a.id]);
});
describe('connected paint selection', () => {
  it('traverses touching faces and excludes disconnected paint without changing IDs', () => {
    const shapes = [box(0), box(100), box(200), box(400)],
      before = clone(shapes);
    expect(connectedPaint(shapes, shapes[0].id)).toEqual(shapes.slice(0, 3));
    expect(shapes).toEqual(before);
  });
  it('connects crossing transformed stroke paint rather than only its endpoints', () => {
    const a: Vector = {
      ...box(0),
      kind: 'line',
      fillEnabled: false,
      strokeWidth: 12,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    transformVectors([a], around({ x: 0, y: 0 }, 2, 0, 0.5, 2));
    const b: Vector = {
      ...a,
      id: id(),
      transform: undefined,
      x: 50,
      y: -50,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    };
    const c = box(500);
    expect(connectedPaint([a, b, c], a.id).map((s) => s.id)).toEqual([a.id, b.id]);
  });
  it('does not connect paint across an empty hole', () => {
    const ring: Vector = {
      ...box(0),
      kind: 'polygon',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
      ],
      fillRule: 'evenodd',
    };
    const island = { ...box(40, 40), width: 20, height: 20 };
    expect(connectedPaint([ring, island], ring.id)).toEqual([ring]);
    expect(connectedPaint([ring, island], 'missing')).toEqual([]);
  });
});

it('selects touching paint in a layer beyond 4096 outline segments', () => {
  const shapes = Array.from({ length: 1200 }, (_, i) => box(i * 200));
  shapes[1].x = 100;
  const before = clone(shapes);
  expect(connectedPaint(shapes, shapes[0].id)).toEqual(shapes.slice(0, 2));
  expect(shapes).toEqual(before);
});

it('symbol connected Ink follows strokes without fill bridges or protected stack crossings', () => {
  const line = (name: string, x: number, width: number): Vector => ({
    ...box(x, 20),
    id: name,
    kind: 'line',
    width,
    height: 0,
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
    ],
  });
  const artwork = [
    { ...box(0), id: 'fill', strokeWidth: 2 },
    line('a', 20, 20),
    line('b', 40, 20),
    line('disconnected', 70, 10),
    { ...box(0), groups: ['protected'] },
    line('beyond', 60, 10),
  ];
  const before = clone(artwork);
  const candidates = symbolStrokeCandidates(artwork, 'a');
  expect(connectedPaint(candidates, 'a').map((s) => s.id)).toEqual(['a', 'b']);
  expect(symbolStrokeCandidates(artwork, artwork[4].id)).toEqual([]);
  expect(symbolStrokeCandidates(artwork, 'missing')).toEqual([]);
  expect(artwork).toEqual(before);
});

it('traverses a long touching chain while preserving source stack order and detached islands', () => {
  const chain = Array.from({ length: 600 }, (_, i) => box(i * 100));
  const islands = Array.from({ length: 600 }, (_, i) => box(i * 100, 300));
  const shapes = chain.flatMap((shape, i) => [islands[i], shape]).reverse();
  const before = clone(shapes);
  expect(connectedPaint(shapes, chain[300].id)).toEqual([...chain].reverse());
  expect(shapes).toEqual(before);
});
it('finds a boundary-only contact between densely segmented contours without connecting a nearby gap', () => {
  const polygon = (x: number): Vector => ({
    ...box(x),
    kind: 'polygon',
    contours: [
      [
        ...Array.from({ length: 1501 }, (_, i) => ({ x: i / 15, y: i % 2 ? 0.01 : 0 })),
        ...Array.from({ length: 1501 }, (_, i) => ({ x: 100 - i / 15, y: i % 2 ? 99.99 : 100 })),
      ],
    ],
  });
  const a = polygon(0),
    b = polygon(100),
    c = polygon(201);
  const before = clone([a, b, c]);
  expect(connectedPaint([a, b, c], a.id).map((s) => s.id)).toEqual([a.id, b.id]);
  expect([a, b, c]).toEqual(before);
});

it('keeps tiny gaps between disconnected multi-ring nonzero shapes', () => {
  const triangle = (offset: number) => [
    { x: offset, y: offset },
    { x: offset + 0.001, y: offset },
    { x: offset, y: offset + 0.001 },
  ];
  const a: Vector = {
    ...box(0),
    kind: 'polygon',
    fillRule: 'nonzero',
    contours: [triangle(0), triangle(10)],
  };
  const b: Vector = { ...a, id: id(), x: 0.0006, y: 0.0006 };
  const before = clone([a, b]);
  expect(connectedPaint([a, b], a.id).map((s) => s.id)).toEqual([a.id]);
  expect(connectedPaint([a, b], b.id).map((s) => s.id)).toEqual([b.id]);
  expect([a, b]).toEqual(before);
});
