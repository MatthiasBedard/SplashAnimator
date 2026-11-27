import { expect, it } from 'vitest';
import { clone, newProject, validateProject, type Vector } from '../packages/document/src';
import { prepareContourFit, prepareContourFits, prepareSmallerBrushContourFit } from '../packages/geometry/src/contour-fit';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { fitCompoundContours } from '../packages/geometry/src/compound-fit';
const circle = (r: number) =>
  Array.from({ length: 64 }, (_, i) => ({
    x: r * Math.cos((i * Math.PI) / 32),
    y: r * Math.sin((i * Math.PI) / 32),
  }));
const source = (): Vector => ({
  id: 'fit',
  kind: 'polygon',
  x: 80,
  y: 90,
  width: 200,
  height: 200,
  rotation: 24,
  transform: [-2, 0.2, 0.4, 1.3],
  fill: '#123456',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  closed: true,
  fillRule: 'evenodd',
  contours: [circle(100), circle(50), circle(20)],
  gradient: {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 50 },
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  },
});
it('prepares independent schema-valid fitted artwork with unchanged paint and placement', () => {
  const s = source(),
    before = clone(s),
    result = prepareContourFit(s, 0.1);
  expect(result.fittedAnchors).toBeLessThan(result.sourceAnchors);
  expect(result.parents).toEqual([-1, 0, 1]);
  expect(result.maxError).toBeLessThanOrEqual(0.1);
  expect({ ...result.shape, contours: [] }).toEqual({ ...s, contours: [] });
  const p = newProject();
  p.layers[0].keys[0].shapes = [result.shape];
  expect(validateProject(p)).toEqual(p);
  result.shape.gradient!.stops[0].color = '#ff0000';
  expect(s).toEqual(before);
});
it('maps every fitted world handle back through reflection, skew and rotation', () => {
  const s = source(),
    m = matrix(s),
    result = prepareContourFit(s, 0.1);
  const world = fitCompoundContours(
    s.contours!.map((r) => r.map((p) => mapPoint(m, p))),
    0.1,
  );
  expect(result.joins.issues.length).toBeGreaterThan(0);
  for (const issue of result.joins.issues) {
    const anchor = mapPoint(m, result.shape.contours![issue.ring][issue.index]);
    expect(anchor.x).toBeCloseTo(issue.point.x, 8);
    expect(anchor.y).toBeCloseTo(issue.point.y, 8);
  }
  result.shape.contours!.forEach((r, i) =>
    r.forEach((n, j) => {
      for (const [actual, expected] of [
        [n, world.rings[i].nodes[j]],
        [n.in!, world.rings[i].nodes[j].in!],
        [n.out!, world.rings[i].nodes[j].out!],
      ]) {
        const p = mapPoint(m, actual);
        expect(p.x).toBeCloseTo(expected.x, 8);
        expect(p.y).toBeCloseTo(expected.y, 8);
      }
    }),
  );
});
it('rejects unsupported, repeated and ambiguous fits without modifying artwork', () => {
  const s = source(),
    before = clone(s);
  expect(() => prepareContourFit({ ...s, strokeWidth: 1 })).toThrow('fill-only');
  expect(() => prepareContourFit({ ...s, transform: [0, 0, 0, 0] })).toThrow('invertible');
  expect(() => prepareContourFit(prepareContourFit(s, 0.1).shape)).toThrow('straight');
  expect(() => prepareContourFit({ ...s, contours: [circle(100), circle(100)] })).toThrow();
  expect(s).toEqual(before);
});

it('materializes only improving Brush fits and keeps the same compound proof for candidates that can win', () => {
  const s = source(), expected = prepareContourFit(s, 0.1, 0);
  let copies = 0;
  Object.defineProperty(s, 'id', { enumerable: true, get: () => { copies++; return 'fit'; } });
  expect(prepareSmallerBrushContourFit(s, 0.1, expected.fittedAnchors)).toBeUndefined();
  expect(copies).toBe(0);
  expect(prepareSmallerBrushContourFit(s, 0.1, expected.fittedAnchors + 1)).toEqual({
    shape: expected.shape, fittedAnchors: expected.fittedAnchors,
  });
  expect(copies).toBe(1);
  const overlapping = { ...source(), contours: [circle(100), circle(100)] };
  expect(prepareSmallerBrushContourFit(overlapping, 0.1, 1)).toBeUndefined();
  expect(() => prepareSmallerBrushContourFit(overlapping, 0.1, 1000)).toThrow();
});

it('prepares a bounded selection atomically and preserves unselected artwork', () => {
  const a = source(),
    b = { ...source(), id: 'other', strokeWidth: 2 },
    before = clone([a, b]);
  const result = prepareContourFits([a, b], ['fit'], 0.1);
  expect(result.shapes[1]).toEqual(b);
  expect(result.fits).toHaveLength(1);
  expect(() => prepareContourFits([a, b], ['fit', 'other'])).toThrow('fill-only');
  expect(() => prepareContourFits([a], ['missing'])).toThrow('missing');
  expect(() => prepareContourFits([a], ['fit', 'fit'])).toThrow('selection');
  expect(() => prepareContourFits([a], [])).toThrow('selection');
  const many = Array.from({ length: 65 }, (_, i) => ({ ...a, id: String(i) }));
  expect(() =>
    prepareContourFits(
      many,
      many.map((s) => s.id),
    ),
  ).toThrow('work limits');
  expect([a, b]).toEqual(before);
});
