import { it, expect } from 'vitest';
import type { Vector } from '../packages/document/src';
import { mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import { vectorPolygons } from '../packages/geometry/src/merge';
import { objectBounds } from '../packages/geometry/src/layout';
import { regionContains } from '../packages/geometry/src/paint-region';
import { worldStrokePolygons } from '../packages/geometry/src/strokes';
const selectedPaint = (out: ReturnType<typeof mergeSelectedArtwork>) =>
  out.artwork
    .filter((s) => out.selected.includes(s.id))
    .flatMap((s) => [...vectorPolygons(s), ...worldStrokePolygons(s)]);

const rect = (id: string, x = 20, y = 30, fill = '#ff0000'): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y,
  width: 100,
  height: 80,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
it('preserves the exact normal merged artwork while returning rebuilt fill selection', () => {
  const source = [rect('picked'), rect('remote', 200)],
    before = structuredClone(source),
    out = mergeSelectedArtwork(source, ['picked']);
  expect(out.selected.length).toBeGreaterThan(0);
  expect(regionContains(selectedPaint(out), { x: 60, y: 60 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 230, y: 60 })).toBe(false);
  expect(source).toEqual(before);
  // Nothing meets either rectangle, so the rebuild leaves both exactly as they were.
  expect(out.artwork).toEqual(source);
  expect(out.selected).toEqual(['picked']);
});
it('keeps stable merged stroke IDs and avoids replacing them with different geometry', () => {
  const s: Vector = {
    ...rect('line'),
    kind: 'path',
    drawingMode: 'merge',
    fillEnabled: false,
    strokeWidth: 4,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 30 },
    ],
  };
  const out = mergeSelectedArtwork([s], ['line'], true);
  expect(out.selected).toEqual(['line']);
  expect(out.artwork).toEqual([s]);
});
it('selected rebuilt pieces exclude unselected foreground paint but includes uncovered selected ink', () => {
  const out = mergeSelectedArtwork([rect('picked'), rect('above', 70, 30, '#0000ff')], ['picked']);
  expect(regionContains(selectedPaint(out), { x: 40, y: 50 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 90, y: 50 })).toBe(false);
});
it('multiple selected members remain selected without selecting a separate island', () => {
  const out = mergeSelectedArtwork([rect('a'), rect('b', 180), rect('other', 360)], ['a', 'b']);
  expect(regionContains(selectedPaint(out), { x: 40, y: 60 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 200, y: 60 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 380, y: 60 })).toBe(false);
});
it('preserves contour holes in the selected rebuilt paint', () => {
  const s = {
    ...rect('ring'),
    kind: 'path' as const,
    fillRule: 'evenodd' as const,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 0, y: 80 },
      ],
      [
        { x: 30, y: 20 },
        { x: 30, y: 60 },
        { x: 70, y: 60 },
        { x: 70, y: 20 },
      ],
    ],
  };
  const out = mergeSelectedArtwork([s], ['ring']);
  expect(regionContains(selectedPaint(out), { x: 30, y: 40 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 70, y: 70 })).toBe(false);
});
it('regenerated stroke selection includes the stroke width rather than only its center line', () => {
  const s: Vector = {
    ...rect('stroke'),
    kind: 'path',
    fillEnabled: false,
    strokeWidth: 8,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
  const out = mergeSelectedArtwork([s], ['stroke']);
  expect(regionContains(selectedPaint(out), { x: 60, y: 32 })).toBe(true);
  expect(regionContains(selectedPaint(out), { x: 60, y: 40 })).toBe(false);
});
for (const selected of [[], ['missing'], ['a', 'a']])
  it(`rejects invalid selection ${selected} atomically`, () => {
    const shapes = [rect('a')],
      before = structuredClone(shapes);
    expect(() => mergeSelectedArtwork(shapes, selected)).toThrow();
    expect(shapes).toEqual(before);
  });

it('tracks filled ownership through the arrangement when an unselected stroke crosses it', () => {
  const fill = rect('fill'),
    line: Vector = {
      ...rect('line'),
      kind: 'path',
      fillEnabled: false,
      stroke: '#0000ff',
      strokeWidth: 4,
      points: [
        { x: 0, y: 40 },
        { x: 100, y: 40 },
      ],
    };
  const out = mergeSelectedArtwork([fill, line], ['fill']);
  expect(out.selected.length).toBeGreaterThan(0);
  expect(
    out.artwork
      .filter((s) => out.selected.includes(s.id))
      .every((s) => s.strokeWidth === 0 && s.fill === '#ff0000'),
  ).toBe(true);
  expect(
    out.artwork.filter((s) => s.strokeWidth > 0).every((s) => !out.selected.includes(s.id)),
  ).toBe(true);
});

it('keeps a rebuilt joined stroke selected when it contains selected source ink', () => {
  const a: Vector = {
      ...rect('a', 0, 0),
      kind: 'path',
      fillEnabled: false,
      strokeWidth: 4,
      points: [
        { x: 20, y: 40 },
        { x: 120, y: 40 },
      ],
    },
    b = {
      ...structuredClone(a),
      id: 'b',
      points: [
        { x: 120, y: 40 },
        { x: 220, y: 40 },
      ],
    },
    remote = {
      ...structuredClone(a),
      id: 'remote',
      points: [
        { x: 20, y: 140 },
        { x: 120, y: 140 },
      ],
    };
  const out = mergeSelectedArtwork([a, b, remote], ['a']);
  expect(out.selected).toHaveLength(1);
  const selected = out.artwork.find((s) => out.selected.includes(s.id))!;
  const box = objectBounds(selected);
  expect(box.right - box.left).toBe(200);
  expect(box.top).toBe(40);
  expect(out.artwork.find((s) => objectBounds(s).top === 140)?.id).not.toBe(selected.id);
});
