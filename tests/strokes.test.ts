import { describe, it, expect } from 'vitest';
import { id, clone, type Vector } from '../packages/document/src';
import { polygonVectors, strokeToFill } from '../packages/geometry/src/strokes';
import { eraseVectors } from '../packages/geometry/src/erase';
import { hit, worldPoint, transformVectors, around } from '../packages/geometry/src';
const line = (): Vector => ({
  id: id(),
  kind: 'path',
  x: 10,
  y: 20,
  width: 100,
  height: 0,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#00ff00',
  strokeWidth: 20,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  fillEnabled: false,
});
const painted = (shapes: Vector[], p: { x: number; y: number }) => shapes.some((s) => hit(s, p, 0));
describe('stroke paint outlines', () => {
  it('keeps independent affine paint metadata when one source produces several new contours', () => {
    const source: Vector = {
      ...line(), kind: 'polygon', height: 40, strokeWidth: 0, fillEnabled: true, points: [],
      contours: [[{ x: 0, y: 0 }, { x: 100, y: 0, out: { x: 100, y: 30 } }, { x: 80, y: 40 }, { x: 0, y: 40 }]],
      groups: ['paint-group'], pivot: { x: 50, y: 20 },
      gradient: {
        kind: 'linear', from: { x: 0, y: 0 }, to: { x: 100, y: 40 },
        stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#7f0000' }],
      },
    };
    transformVectors([source], around({ x: 0, y: 0 }, -2, 0.25, 0.5, 1));
    const original = clone(source);
    const [first, second] = polygonVectors(source, [
      [[[5, 5], [35, 5], [35, 35], [5, 35], [5, 5]]],
      [[[65, 5], [95, 5], [95, 35], [65, 35], [65, 5]]],
    ]);
    const secondBefore = clone(second);
    expect(first.id).toBe(source.id);
    expect(second.id).not.toBe(source.id);
    expect(worldPoint(first, first.gradient!.from)).toEqual(worldPoint(source, source.gradient!.from));
    expect(worldPoint(second, second.pivot!)).toEqual(worldPoint(source, source.pivot!));
    expect(first.contours?.[0]).toHaveLength(4);
    expect(second.contours?.[0]).toHaveLength(4);
    first.gradient!.stops[0].color = '#0000ff';
    first.groups!.push('child');
    first.contours![0][0].x = 18;
    expect(source).toEqual(original);
    expect(second).toEqual(secondBefore);
  });

  it('preserves round, butt and square cap coverage as editable fills', () => {
    for (const cap of ['round', 'butt', 'square'] as const) {
      const s = line();
      s.strokeCap = cap;
      const out = strokeToFill(s);
      expect(out[0].strokeWidth).toBe(0);
      expect(out[0].fill).toBe('#00ff00');
      expect(painted(out, { x: 5, y: 20 })).toBe(cap !== 'butt');
      expect(painted(out, { x: 1, y: 29 })).toBe(cap === 'square');
      expect(painted(out, { x: 60, y: 29 })).toBe(true);
    }
  });
  it('expands closed strokes into a ring without painting their interior', () => {
    const s: Vector = {
      ...line(),
      kind: 'rectangle',
      width: 100,
      height: 100,
      points: [],
      strokeJoin: 'miter',
    };
    const result = strokeToFill(s);
    expect(painted(result, { x: 60, y: 70 })).toBe(false);
    expect(painted(result, { x: 10, y: 70 })).toBe(true);
    expect(painted(result, { x: 1, y: 11 })).toBe(true);
    s.strokeJoin = 'bevel';
    expect(painted(strokeToFill(s), { x: 1, y: 11 })).toBe(false);
  });
  it('unions tangent round joins without trigonometric near-zero failures', () => {
    const s: Vector = {
      ...line(),
      kind: 'rectangle',
      width: 270,
      height: 160,
      points: [],
      strokeWidth: 50,
      strokeJoin: 'round',
    };
    const result = strokeToFill(s);
    expect(painted(result, worldPoint(s, { x: 135, y: 20 }))).toBe(true);
    expect(painted(result, worldPoint(s, { x: 135, y: 80 }))).toBe(false);
  });
  it('retains the original fill, group, transform and independent stroke paint', () => {
    const s = {
      ...line(),
      kind: 'rectangle' as const,
      width: 100,
      height: 50,
      points: [],
      fillEnabled: true,
      groups: ['group'],
    };
    transformVectors([s], around({ x: 0, y: 0 }, -2, 0.3, 0.4, 1));
    const before = clone(s),
      result = strokeToFill(s);
    expect(s).toEqual(before);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].fill).toBe('#ff0000');
    expect(result[1].fill).toBe('#00ff00');
    expect(result.every((v) => v.groups?.[0] === 'group' && v.transform)).toBe(true);
    expect(painted(result, worldPoint(s, { x: 50, y: 25 }))).toBe(true);
    expect(new Set(result.map((v) => v.id)).size).toBe(result.length);
  });
  it('cuts editable runs of a wide affine stroke when the eraser hits its painted edge', () => {
    const s = line();
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0, 0.5, 2));
    const before = clone(s),
      cut = worldPoint(s, { x: 50, y: 8 });
    const result = eraseVectors([s], [cut], 4, 'strokes');
    expect(result[0]).not.toBe(s);
    expect(s).toEqual(before);
    expect(painted(result, cut)).toBe(false);
    expect(painted(result, worldPoint(s, { x: 50, y: 0 }))).toBe(true);
    expect(painted(result, worldPoint(s, { x: 25, y: 0 }))).toBe(true);
    expect(result).toHaveLength(2);
    expect(result.every(v => v.fillEnabled === false && v.strokeWidth === s.strokeWidth &&
      v.stroke === s.stroke && JSON.stringify(v.transform) === JSON.stringify(s.transform))).toBe(true);
  });
  it('leaves untouched paint and fills-only stroke data unchanged', () => {
    const s = line();
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0, 0, 1));
    expect(eraseVectors([s], [{ x: 1000, y: 1000 }], 5, 'strokes')[0]).toBe(s);
    expect(eraseVectors([s], [worldPoint(s, { x: 50, y: 0 })], 5, 'fills')[0]).toBe(s);
  });
});
