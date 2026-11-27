import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { prepareEditorPaintSelection, splitPaintSelection } from '../packages/geometry/src/clip-paint';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { mergeControlBounds } from '../packages/geometry/src/merge';
import { anotherMergeFailFrame } from './broken-drawing-fixture';

const saved = anotherMergeFailFrame();

function painted(shapes: Vector[], p: Point) {
  return shapes.filter(s => {
    if (s.strokeWidth || s.fillEnabled === false) return false;
    const b = mergeControlBounds(s);
    return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom &&
      worldPaths(s, .01).reduce((inside, ring) => inside !== containsPoint(ring, p), false);
  });
}

// The blue fill crosses the marquee, but its restored curves cannot be
// certified. Move used to leave the whole fill behind, exposing its selected
// part at the old position once the paint above it was lifted.
it.skipIf(!saved)('moves the selected part of a fill whose cut curves cannot be certified', () => {
  const source = saved!, before = structuredClone(source);
  const stray = source.find(s => s.id.startsWith('c7af1829'))!;
  expect(stray.fill).toBe('#6d5efc');
  const [left, top, right, bottom] = [198.3, 176.3, 273.1, 251.1];
  const polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const eligible = source.map(s => s.id);
  const selection = prepareEditorPaintSelection(source, { current: [], polygon, mode: 'replace' }, eligible);
  expect('mask' in selection && selection.footprint.length).toBeTruthy();
  const cut = splitPaintSelection(source, { region: selection.mask, eligible, preserveStrokes: true });
  expect(cut.artwork).not.toContain(stray);
  let lifted = 0;
  for (let x = left + 2.3; x < right - 2; x += 1.7) for (let y = top + 2.1; y < bottom - 2; y += 1.7) {
    const p = { x, y };
    if (!painted([stray], p).length) continue;
    lifted++;
    expect(painted(cut.inside, p).map(s => s.fill)).toContain(stray.fill);
    expect(painted(cut.artwork, p), `paint left at (${x}, ${y})`).toEqual([]);
  }
  expect(lifted).toBeGreaterThan(50);
  expect(source).toStrictEqual(before);
});
