import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { clipPaint, prepareEditorPaintSelection, selectPaintRegion, splitPaintSelection } from '../packages/geometry/src/clip-paint';
import { worldStrokePolygons } from '../packages/geometry/src/strokes';
import { preparePaintRegionTransform } from '../packages/geometry/src/paint-region-transform';
import { mergeVectors } from '../packages/geometry/src/merge';
import { matrix, mapPoint, worldPoint } from '../packages/geometry/src';
import { around } from '../packages/geometry/src/affine';

function ink(kind: 'line' | 'path' | 'bezier' = 'bezier'): Vector {
  return {
    id: 'ink',
    kind,
    x: 70,
    y: 70,
    width: 160,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 6,
    strokeCap: 'round',
    strokeJoin: 'miter',
    drawingMode: 'merge',
    points:
      kind === 'bezier'
        ? []
        : [
            { x: 0, y: 0 },
            { x: 80, y: 30 },
            { x: 160, y: 60 },
          ],
    ...(kind === 'bezier'
      ? {
          nodes: [
            { x: 0, y: 0, out: { x: 50, y: 0 } },
            { x: 160, y: 60, in: { x: 110, y: 60 } },
          ],
        }
      : {}),
  };
}
const polygon = [
  { x: -500, y: -500 },
  { x: 500, y: -500 },
  { x: 500, y: 500 },
  { x: -500, y: 500 },
];
for (const [kind, join] of [['line', 'miter'], ['path', 'miter'], ['bezier', 'miter'], ['bezier', 'bevel']] as const)
  for (const basis of [
    [1, 0, 0, 1],
    [1, 0.2, 0.4, 1],
    [-1, 0.2, 0.3, 1],
  ] as const)
    it(`retains complete ${kind} ink with ${join} joins under ${basis}`, () => {
      const shape = ink(kind);
      shape.transform = [...basis];
      shape.pivot = { x: -20, y: 75 };
      shape.strokeJoin = join;
      const before = structuredClone(shape);
      const request = { current: [], polygon, mode: 'replace' as const }, eligible = [shape.id];
      const region = selectPaintRegion([shape], request, eligible);
      const editor = prepareEditorPaintSelection([shape], request, eligible);
      for (const mask of [editor.mask, editor.footprint, region]) {
        const cut = splitPaintSelection([shape], { region: mask, eligible, preserveStrokes: true });
        expect(cut.inside).toEqual([shape]);
        expect(cut.inside[0]).not.toBe(shape);
        expect(cut.artwork).toEqual([]);
      }
      const selected = clipPaint([shape], {
        region,
        keep: 'inside',
        eligible: [shape.id],
        preserveStrokes: true,
      });
      expect(selected).toEqual([shape]);
      expect(selected[0]).not.toBe(shape);
      expect(
        clipPaint([shape], {
          region,
          keep: 'outside',
          eligible: [shape.id],
          preserveStrokes: true,
        }),
      ).toEqual([]);
      const operation = around({ x: 100, y: 100 }, 1, 0, 0.4, 1),
        prepared = preparePaintRegionTransform(selected, [], region, operation),
        out = prepared.artwork[0];
      expect(out.kind).toBe(kind);
      expect(out.fillEnabled).toBe(false);
      expect(out.strokeWidth).toBe(6);
      expect(out.points).toEqual(shape.points);
      expect(out.nodes).toEqual(shape.nodes);
      for (const point of shape.nodes ?? shape.points) {
        const expected = mapPoint(operation, worldPoint(shape, point)),
          actual = worldPoint(out, point);
        expect(actual.x).toBeCloseTo(expected.x, 9);
        expect(actual.y).toBeCloseTo(expected.y, 9);
      }
      const merged = mergeVectors(prepared.artwork, undefined, true);
      expect(merged.every((s) => s.fillEnabled === false && s.strokeWidth === 6)).toBe(true);
      expect(shape).toEqual(before);
      selected[0].strokeWidth = 1;
      expect(shape).toEqual(before);
    });
it('leaves legacy omitted/false clipping behavior unchanged', () => {
  const shape = ink(),
    request = { polygon, keep: 'inside' as const, eligible: [shape.id] };
  const a = clipPaint([shape], request),
    b = clipPaint([shape], { ...request, preserveStrokes: false });
  expect(a.map((s) => ({ ...s, id: '' }))).toEqual(b.map((s) => ({ ...s, id: '' })));
  expect(a.every((s) => s.kind === 'polygon' && s.fillEnabled && s.strokeWidth === 0)).toBe(true);
});
it('keeps the complete editable line when a narrow mask owns its entire centerline', () => {
  const shape = ink('line');
  shape.points = [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
  ];
  shape.height = 0;
  shape.strokeWidth = 10;
  const strip = [
    { x: 60, y: 69 },
    { x: 240, y: 69 },
    { x: 240, y: 71 },
    { x: 60, y: 71 },
  ];
  const request = { polygon: strip, eligible: [shape.id], preserveStrokes: true };
  expect(clipPaint([shape], { ...request, keep: 'inside' })).toEqual([shape]);
  expect(clipPaint([shape], { ...request, keep: 'outside' })).toEqual([]);
});

it('keeps a real interior cut between enclosed Bézier endpoints as editable runs', () => {
  const shape = ink();
  const cut = splitPaintSelection([shape], {
    region: [[
      [[60, 50], [240, 50], [240, 150], [60, 150], [60, 50]],
      [[145, 80], [145, 120], [155, 120], [155, 80], [145, 80]],
    ]],
    eligible: [shape.id], preserveStrokes: true,
  });
  expect(cut.inside).toHaveLength(2);
  expect(cut.artwork).toHaveLength(1);
  for (const run of [...cut.inside, ...cut.artwork]) {
    expect(run.kind).toBe('bezier');
    expect(run.strokeWidth).toBe(shape.strokeWidth);
    expect(run.fillEnabled).toBe(false);
    expect(run.nodes).toHaveLength(2);
  }
  expect(worldPoint(cut.artwork[0], cut.artwork[0].nodes![0]).x).toBeCloseTo(145, 6);
  expect(worldPoint(cut.artwork[0], cut.artwork[0].nodes![1]).x).toBeCloseTo(155, 6);
});
it('retains a complete stroke separately when its fill is only partly selected, with distinct IDs and paint bases', () => {
  const shape: Vector = {
    ...ink('line'),
    kind: 'rectangle',
    width: 100,
    height: 80,
    points: [],
    fillEnabled: true,
  };
  const region = worldStrokePolygons(shape),
    before = structuredClone(shape);
  const request = { region, eligible: [shape.id], preserveStrokes: true };
  const inside = clipPaint([shape], { ...request, keep: 'inside' }),
    outside = clipPaint([shape], { ...request, keep: 'outside' });
  const stroke = inside.find((s) => s.fillEnabled === false)!;
  expect(stroke).toBeDefined();
  expect(stroke.kind).toBe('rectangle');
  expect(stroke.strokeWidth).toBe(6);
  expect(matrix(stroke)).toEqual(matrix(shape));
  expect(outside.length).toBeGreaterThan(0);
  expect(new Set([...inside, ...outside].map((s) => s.id)).size).toBe(
    inside.length + outside.length,
  );
  expect(shape).toEqual(before);
});
it('rejects malformed stroke-preservation admission without source edits', () => {
  const shape = ink(),
    before = structuredClone(shape);
  expect(() =>
    clipPaint([shape], {
      polygon,
      keep: 'inside',
      eligible: [shape.id],
      preserveStrokes: 1 as unknown as boolean,
    }),
  ).toThrow(/boolean/);
  expect(shape).toEqual(before);
});
