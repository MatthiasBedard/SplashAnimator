import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { penPreview, penEndpoint } from '../packages/geometry/src/pen-preview';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
it('previews outgoing and closing tangents with affine endpoint priority and screen-space hit radius', () => {
  const s: Vector = {
    id: 'pen',
    kind: 'bezier',
    x: 200,
    y: 100,
    width: 100,
    height: 100,
    rotation: 25,
    transform: [-1.2, 0.2, 0.3, 1],
    fill: '#000',
    stroke: '#000',
    strokeWidth: 2,
    points: [],
    nodes: [
      { x: 0, y: 0, in: { x: -20, y: 10 } },
      { x: 100, y: 0 },
      { x: 100, y: 100, out: { x: 120, y: 80 } },
    ],
  };
  const before = JSON.stringify(s),
    m = matrix(s),
    first = mapPoint(m, s.nodes![0]),
    last = mapPoint(m, s.nodes![2]);
  const target = { x: 500, y: 400 },
    next = penPreview(s, target, 1)!;
  expect(next).toEqual({
    kind: 'segment',
    from: last,
    out: mapPoint(m, s.nodes![2].out!),
    into: target,
    to: target,
  });
  const close = penPreview(s, { x: first.x + 3, y: first.y }, 2)!;
  expect(close.kind).toBe('close');
  expect(close.to).toEqual(first);
  expect(close.into).toEqual(mapPoint(m, s.nodes![0].in!));
  expect(penPreview(s, { x: first.x + 5, y: first.y }, 2)!.kind).toBe('segment');
  expect(penPreview(s, last, 1)!.kind).toBe('corner');
  const horizontal = penPreview(s, { x: last.x + 80, y: last.y + 27 }, 2, 45)!;
  expect(horizontal.to).toEqual({ x: last.x + Math.hypot(80, 27), y: last.y });
  expect(horizontal.into).toEqual(horizontal.to);
  expect(horizontal.out).toEqual(next.out);
  expect(penPreview(s, { x: first.x + 3, y: first.y }, 2, 45)).toEqual(close);
  expect(penPreview(s, last, 2, 45)!.kind).toBe('corner');
  expect(penPreview(s, target, 0)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.nodes = s.nodes!.slice(0, 2);
  expect(penPreview(s, first, 1)!.kind).toBe('segment');
  s.nodes = [];
  expect(penPreview(s, target, 1)).toBeUndefined();
});

it('picks only open endpoints with affine screen radius and nearest-end priority', () => {
  const s: Vector = {
    id: 'pickup',
    kind: 'bezier',
    x: 30,
    y: 40,
    width: 20,
    height: 10,
    rotation: 30,
    transform: [-2, 0.3, 0.2, 1],
    fill: '#000',
    stroke: '#000',
    strokeWidth: 1,
    points: [],
    nodes: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ],
  };
  const before = JSON.stringify(s),
    m = matrix(s);
  for (const index of [0, 2]) {
    const p = mapPoint(m, s.nodes![index]);
    expect(penEndpoint(s, { x: p.x + 4, y: p.y }, 2)?.index).toBe(index);
    expect(penEndpoint(s, { x: p.x + 5, y: p.y }, 2)).toBeUndefined();
    expect(penEndpoint(s, p, 0.05)?.index).toBe(index);
  }
  expect(penEndpoint(s, mapPoint(m, s.nodes![1]), 2)).toBeUndefined();
  expect(penEndpoint({ ...s, closed: true }, { x: 30, y: 40 }, 1)).toBeUndefined();
  expect(penEndpoint(s, { x: 30, y: 40 }, 0)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
});
