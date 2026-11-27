import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { connectedStrokeSelection as select } from '../packages/geometry/src/connected-strokes';
import { transformVectors, around } from '../packages/geometry/src';

function line(id: string, x: number, y: number, dx: number, dy: number): Vector {
  return {
    id,
    kind: 'line',
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 4,
    fillEnabled: false,
    points: [
      { x: 0, y: 0 },
      { x: dx, y: dy },
    ],
  };
}
function network() {
  return [
    line('a', 20, 20, 100, 0),
    line('b', 120, 20, 0, 80),
    line('c', 120, 100, 60, 0),
    line('apart', 230, 20, 50, 0),
  ];
}
it('finds a transitive multi-color attached line network without editing source', () => {
  const art = network();
  art[1].stroke = '#0000ff';
  const before = structuredClone(art);
  expect(select(art, 'a', { x: 60, y: 20 })).toEqual(['a', 'b', 'c']);
  expect(art).toEqual(before);
});
it('includes crossing strokes even when their endpoints are distinct', () => {
  const art = [
    line('a', 20, 20, 100, 0),
    line('cross', 70, -20, 0, 80),
    line('apart', 230, 20, 50, 0),
  ];
  expect(select(art, 'a', { x: 40, y: 20 })).toEqual(['a', 'cross']);
});
it('does not let filled paint bridge separate stroke networks', () => {
  const art = network();
  art.push({
    ...line('fill', 170, 10, 100, 110),
    kind: 'rectangle',
    points: [],
    fillEnabled: true,
    strokeWidth: 0,
  });
  expect(select(art, 'a', { x: 60, y: 20 })).toEqual(['a', 'b', 'c']);
});
for (const kind of ['text', 'symbol', 'group'] as const)
  it(`retains a protected ${kind} stack boundary`, () => {
    const art = network();
    art.splice(1, 0, {
      ...line('protected', 300, 0, 20, 20),
      ...(kind === 'group' ? { groups: ['g'] } : { kind }),
    } as Vector);
    expect(select(art, 'a', { x: 60, y: 20 })).toEqual(['a']);
  });
for (const sign of [1, -1])
  it(`uses actual affine/reflected stroke geometry under ${sign}`, () => {
    const art = network(),
      point = { x: 60, y: 20 },
      op = around({ x: 0, y: 0 }, sign * 1.1, 0.2, 0.3, 0.9);
    transformVectors(art, op);
    const pick = {
      x: op[0] * point.x + op[2] * point.y + op[4],
      y: op[1] * point.x + op[3] * point.y + op[5],
    };
    expect(select(art, 'a', pick)).toEqual(['a', 'b', 'c']);
  });
it('does not traverse a disconnected contour of the picked compound object', () => {
  const compound: Vector = {
    ...line('rings', 0, 0, 0, 0),
    kind: 'polygon',
    points: [],
    fillRule: 'evenodd',
    contours: [
      [
        { x: 20, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 100 },
        { x: 20, y: 100 },
      ],
      [
        { x: 200, y: 20 },
        { x: 260, y: 20 },
        { x: 260, y: 80 },
        { x: 200, y: 80 },
      ],
    ],
  };
  const attached = line('near', 100, 60, 40, 0),
    other = line('far', 260, 60, 40, 0),
    art = [compound, attached, other];
  expect(select(art, 'rings', { x: 60, y: 20 })).toEqual(['rings', 'near']);
  expect(select(art, 'rings', { x: 230, y: 20 })).toEqual(['rings', 'far']);
});
it('does not treat a gap outside the stroke caps as attached', () => {
  const art = [line('a', 20, 20, 100, 0), line('gap', 125, 20, 50, 0)];
  expect(select(art, 'a', { x: 60, y: 20 })).toEqual(['a']);
});
it('rejects nonfinite original data before any clone can normalize it', () => {
  const art = network();
  art[1].points[0].x = NaN;
  const before = structuredClone(art);
  expect(() => select(art, 'a', { x: 60, y: 20 })).toThrow(/finite/);
  expect(art).toEqual(before);
});
it('rejects duplicate ownership and invalid picks, and ignores an absent seed', () => {
  const art = network();
  expect(select(art, 'absent', { x: 60, y: 20 })).toEqual([]);
  expect(() => select(art, 'a', { x: NaN, y: 20 })).toThrow();
  art[1].id = 'a';
  expect(() => select(art, 'a', { x: 60, y: 20 })).toThrow(/distinct/);
});
