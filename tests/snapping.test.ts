import { describe, expect, it } from 'vitest';
import { snapAxis, gridLines, snapAngle, snapRay } from '../packages/geometry/src/snapping';
import { newProject, validateProject } from '../packages/document/src';
describe('snapping and guides', () => {
  it('uses the closest edge or center and ignores targets outside the tolerance', () => {
    expect(snapAxis([13, 63, 113], [15, 64, 200], 6)).toEqual({ delta: 1, target: 64 });
    expect(snapAxis([10], [20], 6)).toEqual({ delta: 0, target: undefined });
    expect(snapAxis([10], [10], 6)).toEqual({ delta: 0, target: 10 });
  });
  it('supports negative grid coordinates and a zoom-adjusted screen tolerance', () => {
    expect(snapAxis([-19], [], 6, 20)).toEqual({ delta: -1, target: -20 });
    expect(snapAxis([13], [20], 6 / 0.5).delta).toBe(7);
    expect(snapAxis([13], [20], 6 / 2).target).toBeUndefined();
  });
  it('validates durable guide identities and bounded positions', () => {
    const p = newProject();
    p.guides = [{ id: 'a', axis: 'x', position: -100 }];
    expect(validateProject(p).guides).toEqual(p.guides);
    p.guides.push({ ...p.guides[0] });
    expect(() => validateProject(p)).toThrow('guide');
    p.guides = [{ id: 'a', axis: 'y', position: Infinity }];
    expect(() => validateProject(p)).toThrow('guide');
  });
});

it('bounds visible grid work and keeps rendering aligned with snap coordinates', () => {
  expect(gridLines(31, 179, 30, 1)).toEqual([60, 90, 120, 150]);
  expect(gridLines(-55, 15, 20, 1)).toEqual([-40, -20, 0]);
  for (const [min, max, spacing, zoom] of [
    [0, 1e9, 1, 0.05],
    [-1000, 1000, 1, 0.05],
    [10, 1000, 37, 4],
  ]) {
    const lines = gridLines(min, max, spacing, zoom);
    expect(lines.length).toBeLessThanOrEqual(1024);
    for (const x of lines) {
      expect(x).toBeGreaterThanOrEqual(min);
      expect(x).toBeLessThanOrEqual(max);
      expect(Math.abs(x % spacing)).toBe(0);
      expect(snapAxis([x + 0.2], [], 1, spacing).target).toBe(x);
    }
    if (lines.length > 1) expect((lines[1] - lines[0]) * zoom).toBeGreaterThanOrEqual(4);
  }
  expect(gridLines(10, 0, 20, 1)).toEqual([]);
  expect(gridLines(0, 100, 0, 1)).toEqual([]);
  expect(gridLines(0, Infinity, 20, 1)).toEqual([]);
});

it('constrains signed angles with configurable increments and preserves full turns', () => {
  for (const degrees of [5, 10, 15, 30, 45, 90]) {
    for (const turns of [-2, -1, 0, 1, 2]) {
      for (const sign of [-1, 1]) {
        const angle = ((360 * turns + sign * degrees * 1.2) * Math.PI) / 180;
        expect(snapAngle(angle, degrees)).toBeCloseTo(
          ((360 * turns + sign * degrees) * Math.PI) / 180,
          12,
        );
      }
    }
  }
  for (const invalid of [0, -5, NaN, Infinity, 181]) expect(snapAngle(0.8, invalid)).toBe(0.8);
});

it('constrains a stage-space ray without changing its radius', () => {
  const anchor = { x: 99000, y: -99000 }, pointer = { x: 99031, y: -99024 };
  const result = snapRay(anchor, pointer, 30)!;
  const dx = result.point.x - anchor.x, dy = result.point.y - anchor.y;
  expect(result.angle).toBeCloseTo(-Math.PI / 6, 12);
  expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(31, 24), 9);
  expect(dy / dx).toBeCloseTo(-1 / Math.sqrt(3), 10);
  expect(snapRay(anchor, anchor, 45)).toBeUndefined();
  expect(snapRay(anchor, { x: Infinity, y: 0 }, 45)).toBeUndefined();
  expect(snapRay(anchor, pointer, NaN)).toBeUndefined();
});
