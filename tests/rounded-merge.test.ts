import { expect, it } from 'vitest';
import { clone, newProject, validateProject, type Vector } from '../packages/document/src';
import {
  mergeDrawingVectors as mergeVectors,
  contains,
  vectorPolygons,
} from '../packages/geometry/src/merge';
import { pathCommands } from '../packages/geometry/src/drawing';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import { mergeVectors as mergePolygons } from '../packages/geometry/src/merge';

const rounded = (strokeWidth = 0): Vector => ({
  id: 'rounded',
  kind: 'rectangle',
  x: 70,
  y: 60,
  width: 180,
  height: 120,
  rotation: 0,
  cornerRadius: 24,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth,
  points: [],
  fillEnabled: true,
});
const nodes = (s: Vector) => s.contours?.flat() ?? s.nodes ?? s.points;
const curves = (s: Vector) => pathCommands(s).filter((c) => c[0] === 'C');
const worldCubics = (s: Vector) => {
  const m = matrix(s),
    result: { x: number; y: number }[][] = [];
  let from = { x: 0, y: 0 };
  for (const c of pathCommands(s)) {
    if (c[0] === 'M' || c[0] === 'L') from = mapPoint(m, { x: c[1], y: c[2] });
    if (c[0] === 'C') {
      const to = mapPoint(m, { x: c[5], y: c[6] });
      const cubic = [
        from,
        mapPoint(m, { x: c[1], y: c[2] }),
        mapPoint(m, { x: c[3], y: c[4] }),
        to,
      ];
      // A straight span may be represented with collinear cubic handles.
      if (
        Math.abs(
          (cubic[1].x - from.x) * (to.y - from.y) - (cubic[1].y - from.y) * (to.x - from.x),
        ) > 1e-8
      )
        result.push(cubic);
      from = to;
    }
  }
  return result;
};

it('keeps polygon preparation available and preserves complete selections through editor curve restoration', () => {
  const source = rounded(2),
    before = clone(source);
  const flat = mergePolygons([source]);
  expect(curves(flat.find((s) => s.fillEnabled !== false)!)).toHaveLength(0);
  const result = mergeSelectedArtwork([source], [source.id], true, true);
  expect(result.selected).toEqual(result.artwork.map((s) => s.id));
  expect(curves(result.artwork.find((s) => s.fillEnabled !== false)!)).toHaveLength(4);
  expect(source).toEqual(before);
});

it('a later distant shape leaves the existing corner controls and stroke geometry exact', () => {
  const first = mergeVectors([rounded(2)]),
    before = clone(first);
  const output = mergeVectors([...first, { ...rounded(), id: 'far', x: 500, y: 400 }]);
  for (const original of before) {
    const oldCubics = worldCubics(original);
    const candidates = output.filter((s) => s.fillEnabled === original.fillEnabled);
    for (const c of oldCubics)
      expect(
        candidates.some((s) =>
          worldCubics(s).some((b) =>
            [b, [...b].reverse()].some((d) =>
              d.every((p, i) => Math.hypot(p.x - c[i].x, p.y - c[i].y) < 1e-9),
            ),
          ),
        ),
      ).toBe(true);
  }
  expect(first).toEqual(before);
});

for (const strokeWidth of [0, 3])
  for (const transform of [undefined, [1.2, 0.25, -0.1, 0.8], [-1, 0.2, 0.3, 1.1]]) {
    it(`keeps four genuine rounded corners, fixed geometry and detached paint/stroke ${strokeWidth}/${transform}`, () => {
      const source = rounded(strokeWidth);
      if (transform) source.transform = transform as [number, number, number, number];
      const before = clone(source),
        output = mergeVectors([source]);
      expect(source).toEqual(before);
      expect(output.filter((s) => s.fillEnabled !== false)).toHaveLength(1);
      const fill = output.find((s) => s.fillEnabled !== false)!;
      expect(curves(fill)).toHaveLength(4);
      expect(nodes(fill)).toHaveLength(8);
      const stroke = output.find((s) => s.fillEnabled === false);
      if (strokeWidth) {
        expect(stroke).toBeDefined();
        expect(worldCubics(stroke!)).toHaveLength(4);
        expect(nodes(stroke!)).toHaveLength(8);
      }
      const originalCurve = worldCubics(source);
      for (const shape of output) {
        for (const cubic of worldCubics(shape)) {
          expect(
            originalCurve.some((c) =>
              [c, [...c].reverse()].some((r) =>
                r.every((q, i) => Math.hypot(q.x - cubic[i].x, q.y - cubic[i].y) < 1e-9),
              ),
            ),
          ).toBe(true);
        }
      }
      const p = newProject();
      p.layers[0].drawingMode = 'merge';
      p.layers[0].keys[0].shapes = output;
      validateProject(p);
      nodes(fill)[0].x++;
      expect(source).toEqual(before);
    });
  }

for (const strokeWidth of [0, 3])
  it(`preserves untouched corners when a new rectangle merges across a straight edge ${strokeWidth}`, () => {
    const source = rounded(strokeWidth),
      before = clone(source),
      extra = { ...rounded(), id: 'extra', cornerRadius: 0, x: 160, y: 90, width: 140, height: 35 };
    const first = mergeVectors([source]);
    const output = mergeVectors([...first, extra]);
    const fills = output.filter((s) => s.fillEnabled !== false);
    expect(fills.reduce((n, s) => n + curves(s).length, 0)).toBe(4);
    expect(fills.reduce((n, s) => n + nodes(s).length, 0)).toBeLessThanOrEqual(16);
    expect(fills.some((s) => contains(vectorPolygons(s), { x: 290, y: 100 }))).toBe(true);
    expect(source).toEqual(before);
  });

it('stroke-only rounded rectangles keep curves without changing straight rectangle geometry', () => {
  const source = { ...rounded(2), fillEnabled: false };
  const output = mergeVectors([source]);
  expect(output).toHaveLength(1);
  expect(worldCubics(output[0])).toHaveLength(4);
  expect(nodes(output[0])).toHaveLength(8);
  const straight = { ...rounded(), cornerRadius: 0 };
  expect(curves(mergeVectors([straight])[0])).toHaveLength(0);
  expect(vectorPolygons(mergeVectors([straight])[0])).toEqual(vectorPolygons(straight));
});

for (const kind of ['rectangle', 'ellipse'] as const)
  for (const reflected of [false, true]) {
    it(`retains adjacent curved corners at maximum radius ${kind}/${reflected}`, () => {
      const source = {
        ...rounded(2),
        kind,
        cornerRadius: 1000,
        transform: reflected
          ? ([-1, 0.2, 0.3, 1.1] as [number, number, number, number])
          : undefined,
      };
      const output = mergeVectors([source]);
      const fill = output.find((s) => s.fillEnabled !== false)!;
      expect(curves(fill)).toHaveLength(4);
      expect(nodes(fill)).toHaveLength(kind === 'ellipse' ? 4 : 6);
      const stroke = output.find((s) => s.fillEnabled === false)!;
      expect(nodes(stroke)).toHaveLength(kind === 'ellipse' ? 4 : 6);
      const before = worldCubics(source);
      for (const shape of output)
        for (const c of worldCubics(shape)) {
          expect(
            before.some((b) =>
              [b, [...b].reverse()].some((d) =>
                d.every((p, i) => Math.hypot(p.x - c[i].x, p.y - c[i].y) < 1e-9),
              ),
            ),
          ).toBe(true);
        }
    });
  }
