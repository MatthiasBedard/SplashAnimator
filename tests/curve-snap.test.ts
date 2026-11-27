import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import type { Cubic } from '../packages/geometry/src/curve-fit';
import { splitCubic } from '../packages/geometry/src/curve-fit';
import { cubicTangencies, indexCurveSnapTargets, lineCubicCrossings } from '../packages/geometry/src/curve-snap';
import { cubicCrossings, transverseCubicContacts } from '../packages/geometry/src/cubic-crossings';

const p = (x: number, y: number): Point => ({ x, y });
const wave: Cubic = [p(0, -8), p(10 / 3, 14), p(20 / 3, -14), p(10, 8)];

it('resolves three analytic crossings and clips to the finite line segment', () => {
  const points = lineCubicCrossings(p(0, 0), p(10, 0), wave);
  expect(points).toHaveLength(3);
  for (const [i, x] of [2, 5, 8].entries()) {
    expect(points[i].x).toBeCloseTo(x, 12);
    expect(points[i].y).toBeCloseTo(0, 12);
  }
  const reversed = lineCubicCrossings(p(6, 0), p(4, 0), wave);
  expect(reversed).toHaveLength(1);
  expect(reversed[0].x).toBeCloseTo(5, 12);
});

it('rejects tangent contact, collinearity, collapsed lines and nonfinite input', () => {
  const tangent: Cubic = [p(0, .25), p(1, -1 / 12), p(2, -1 / 12), p(3, .25)];
  expect(lineCubicCrossings(p(0, 0), p(3, 0), tangent)).toEqual([]);
  expect(lineCubicCrossings(p(0, 0), p(3, 0), [p(0, 0), p(1, 0), p(2, 0), p(3, 0)])).toEqual([]);
  expect(lineCubicCrossings(p(1, 0), p(1, 0), wave)).toEqual([]);
  expect(lineCubicCrossings(p(0, NaN), p(3, 0), wave)).toEqual([]);
});

it('indexes detached affine geometry and chooses only nearby actual crossings', () => {
  const basis: Vector = { id: 'curve', kind: 'bezier', x: 220, y: 80, width: 160, height: 100,
    rotation: 0, transform: [-1, .2, .3, 1], fill: '#000000', stroke: '#000000',
    strokeWidth: 2, fillEnabled: false, points: [], nodes: [
      { ...p(0, 0), out: p(30, 100) }, { ...p(160, 0), in: p(130, 100) },
    ] };
  const line: Vector = { ...basis, id: 'edge', kind: 'line', nodes: undefined,
    points: [p(0, 56.25), p(160, 56.25)] };
  const index = indexCurveSnapTargets([basis, line]);
  basis.x = -800;
  const picked = index(p(206, 145), 6);
  expect(picked?.kind).toBe('crossing');
  expect(picked?.point.x).toBeCloseTo(203.4375, 10);
  expect(picked?.point.y).toBeCloseTo(142.9375, 10);
  expect(index(p(206, 145), 2)).toBeUndefined();
  expect(indexCurveSnapTargets([{ ...basis, fillEnabled: undefined, strokeWidth: 0 }, line])(p(206, 145), 6)).toBeUndefined();
  expect(indexCurveSnapTargets([basis, line])(p(206, 145), 6)).toBeUndefined();
});

const parabola: Cubic = [p(0, 0), p(160 / 3, 0), p(320 / 3, 160 / 3), p(160, 160)];
const descending: Cubic = [p(0, 80), p(160 / 3, 80), p(320 / 3, 80 - 160 / 3), p(160, -80)];
it('admits both parameters for cutting only when the entire crossing pair resolves', () => {
  const contacts = transverseCubicContacts(parabola, descending, { remaining: 4096 });
  expect(contacts).toHaveLength(1);
  expect(contacts?.[0].t).toBeCloseTo(.5, 12);
  expect(contacts?.[0].u).toBeCloseTo(.5, 12);
  expect(transverseCubicContacts(parabola, descending, { remaining: 0 })).toBeNull();
  expect(transverseCubicContacts(parabola, [...parabola].reverse() as Cubic, { remaining: 4096 })).toBeNull();
  const tangent: Cubic = [p(0, .25), p(1, -1 / 12), p(2, -1 / 12), p(3, .25)];
  const axis: Cubic = [p(0, 0), p(1, 0), p(2, 0), p(3, 0)];
  expect(transverseCubicContacts(tangent, axis, { remaining: 4096 })).toBeNull();
});

it('separates cubic hulls that touch along a support with distinct endpoint coordinates', () => {
  const left: Cubic = [p(-3, -2), p(-2, -1), p(-1, 0), p(0, 1)];
  const right: Cubic = [p(0, 1 + Number.EPSILON), p(1, .4), p(2, .5), p(4, 0)];
  const budget = { remaining: 1 };
  expect(transverseCubicContacts(left, right, budget, true)).toEqual([]);
  expect(budget.remaining).toBe(0);
  const transpose = (curve: Cubic) => curve.map(({ x, y }) => p(y, x)) as Cubic;
  expect(transverseCubicContacts(transpose(right), transpose(left), { remaining: 1 }, true)).toEqual([]);
  expect(transverseCubicContacts(left, right, { remaining: 0 }, true)).toBeNull();
  const joined: Cubic = [left[3], right[1], right[2], right[3]];
  expect(transverseCubicContacts(left, joined, { remaining: 4096 }, true))
    .toEqual([{ t: 1, u: 0, point: left[3] }]);
  const vertical: Cubic = [p(0, -2), p(0, -1), p(0, 2), p(0, 3)];
  expect(transverseCubicContacts(left, vertical, { remaining: 4096 }, true)).toBeNull();
  const farLeft = left.map(({ y }) => p(-Number.MAX_VALUE, y)) as Cubic;
  const farRight = right.map(({ y }) => p(Number.MAX_VALUE, y)) as Cubic;
  expect(transverseCubicContacts(farLeft, farRight, { remaining: 1 }, true)).toBeNull();
});

it('resolves an analytic cubic crossing on a subdivision seam after affine placement', () => {
  const place = ({ x, y }: Point) => p(99000 - x + .5 * y, -99000 + .25 * x + y);
  const roots = cubicCrossings(parabola.map(place) as Cubic, descending.map(place) as Cubic);
  expect(roots).toHaveLength(1);
  const expected = place(p(80, 40));
  expect(roots?.[0].x).toBeCloseTo(expected.x, 8);
  expect(roots?.[0].y).toBeCloseTo(expected.y, 8);
});

it('separates multiple cubic crossings and rejects grazing, overlap and exhausted work', () => {
  const second = parabola.map((point, i) => p(point.x, point.y + wave[i].y)) as Cubic;
  const roots = cubicCrossings(parabola, second);
  expect(roots).toHaveLength(3);
  for (const [i, t] of [.2, .5, .8].entries()) {
    expect(roots?.[i].x).toBeCloseTo(160 * t, 10);
    expect(roots?.[i].y).toBeCloseTo(160 * t * t, 10);
  }
  const grazing = parabola.map((point, i) => p(point.x, point.y + [15, -5, -5, 15][i])) as Cubic;
  expect(cubicCrossings(parabola, grazing, { remaining: 16000 })).toEqual([]);
  expect(cubicCrossings(parabola, [...parabola].reverse() as Cubic)).toEqual([]);
  expect(cubicCrossings(parabola, splitCubic(parabola, .5)[1], { remaining: 16 })).toBeNull();
  expect(cubicCrossings(parabola, descending, { remaining: 1 })).toBeNull();
});
it('finds both analytic tangent points after reflection, shear and translation', () => {
  const place = ({ x, y }: Point) => p(99000 - x + .5 * y, -99000 + .25 * x + y);
  const targets = cubicTangencies(place(p(80, 30)), parabola.map(place) as Cubic);
  expect(targets).toHaveLength(2);
  for (const [i, expected] of [p(40, 10), p(120, 90)].map(place).entries()) {
    expect(targets[i].x).toBeCloseTo(expected.x, 8);
    expect(targets[i].y).toBeCloseTo(expected.y, 8);
  }
});

it('leaves endpoint, stationary, coincident or nonfinite tangencies unresolved', () => {
  expect(cubicTangencies(p(0, 0), parabola)).toEqual([]);
  expect(cubicTangencies(p(1, 2), [p(1, 0), p(-1 / 3, 0), p(-1 / 3, 0), p(1, 0)])).toEqual([]);
  expect(cubicTangencies(p(0, 0), [p(0, 0), p(1, 0), p(2, 0), p(3, 0)])).toEqual([]);
  expect(cubicTangencies(p(Infinity, 0), parabola)).toEqual([]);
});

it('keeps cached tangencies detached and invalidates them when the Pen anchor changes', () => {
  const [a, b, c, d] = parabola;
  const source: Vector = { id: 'curve', kind: 'bezier', x: 0, y: 0, width: 160, height: 160,
    rotation: 0, fill: '#000000', stroke: '#000000', strokeWidth: 2, points: [],
    nodes: [{ ...a, out: b }, { ...d, in: c }] };
  const index = indexCurveSnapTargets([source]);
  const anchor = p(80, 30), pointer = p(43, 13);
  const first = index(pointer, 6, anchor);
  expect(first?.kind).toBe('tangent');
  expect(first?.point.x).toBeCloseTo(40, 10);
  first!.point.x = 500;
  expect(index(pointer, 6, anchor)?.point.x).toBeCloseTo(40, 10);
  anchor.y = 0;
  expect(index(pointer, 6, anchor)).toBeUndefined();
});

it('can still pick a tangent when overlapping cubics exhaust crossing work', () => {
  const source = ([a, b, c, d]: Cubic, id: string): Vector => ({
    id, kind: 'bezier', x: 0, y: 0, width: 160, height: 160, rotation: 0,
    fill: '#000000', stroke: '#000000', strokeWidth: 2, points: [],
    nodes: [{ ...a, out: b }, { ...d, in: c }],
  });
  const half = splitCubic(parabola, .5)[0];
  expect(cubicCrossings(parabola, half)).toBeNull();
  const index = indexCurveSnapTargets([source(parabola, 'whole'), source(half, 'half')]);
  for (let query = 0; query < 2; query++) {
    const picked = index(p(43 + query, 13), 6, p(80, 30));
    expect(picked?.kind).toBe('tangent');
    expect(picked?.point.x).toBeCloseTo(40, 10);
    expect(picked?.point.y).toBeCloseTo(10, 10);
  }
});

it('retains relative accuracy with a large origin and small scale', () => {
  const place = ({x, y}: Point) => p(99000 + x / 100, -99000 + y / 100);
  const points = lineCubicCrossings(place(p(0, 0)), place(p(10, 0)), wave.map(place) as Cubic);
  expect(points).toHaveLength(3);
  for (const [i, x] of [2, 5, 8].entries()) {
    expect(points[i].x).toBeCloseTo(99000 + x / 100, 9);
    expect(points[i].y).toBeCloseTo(-99000, 9);
  }
});
