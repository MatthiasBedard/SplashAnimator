import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const floating = createRequire(new URL('../packages/geometry/package.json', import.meta.url))(
  'polygon-clipping',
) as Record<'union' | 'difference' | 'intersection', (...args: unknown[]) => unknown>;
import { combinePaintRegion, clipPaint } from '../packages/geometry/src/clip-paint';
import { regionContains, translateRegion } from '../packages/geometry/src/paint-region';
import { type Vector } from '../packages/document/src';
import { hit } from '../packages/geometry/src';
const box = (x = 0, y = 0, w = 100, h = 100) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
describe('paint region set operations', () => {
  it('combines disjoint areas, subtracts holes and intersects without changing input', () => {
    const a = combinePaintRegion({ current: [], polygon: box(), mode: 'replace' }),
      before = JSON.stringify(a);
    const union = combinePaintRegion({ current: a, polygon: box(200), mode: 'add' });
    expect(union.length).toBe(2);
    expect(regionContains(union, { x: 250, y: 50 })).toBe(true);
    const hole = combinePaintRegion({
      current: union,
      polygon: box(25, 25, 50, 50),
      mode: 'subtract',
    });
    expect(regionContains(hole, { x: 50, y: 50 })).toBe(false);
    expect(regionContains(hole, { x: 10, y: 50 })).toBe(true);
    const intersect = combinePaintRegion({
      current: hole,
      polygon: box(0, 0, 150, 100),
      mode: 'intersect',
    });
    expect(intersect.length).toBe(1);
    expect(regionContains(intersect, { x: 250, y: 50 })).toBe(false);
    expect(JSON.stringify(a)).toBe(before);
    const moved = translateRegion(hole, { x: 30, y: 40 });
    expect(regionContains(moved, { x: 80, y: 90 })).toBe(false);
    expect(regionContains(moved, { x: 40, y: 90 })).toBe(true);
  });
  it('clips paint against a region hole and preserves empty-set semantics', () => {
    const a = combinePaintRegion({ current: [], polygon: box(), mode: 'replace' });
    const region = combinePaintRegion({
      current: a,
      polygon: box(25, 25, 50, 50),
      mode: 'subtract',
    });
    const shape: Vector = {
      id: 's',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const parts = clipPaint([shape], { region, keep: 'inside', eligible: ['s'] });
    expect(parts[0].contours!.length).toBe(2);
    expect(combinePaintRegion({ current: [], polygon: box(), mode: 'intersect' })).toEqual([]);
    expect(combinePaintRegion({ current: a, polygon: box(), mode: 'subtract' })).toEqual([]);
    expect(clipPaint([shape], { region: [], keep: 'outside', eligible: ['s'] })).toEqual([shape]);
  });
  it('rejects nonfinite input and combined-region coordinates', () => {
    expect(() =>
      combinePaintRegion({ current: [[[[NaN, 0]]]], polygon: box(), mode: 'add' }),
    ).toThrow('finite');
    expect(() =>
      combinePaintRegion({
        current: [],
        polygon: [...box(), { x: Infinity, y: 0 }],
        mode: 'replace',
      }),
    ).toThrow('finite');
    expect(() =>
      combinePaintRegion({ current: [], polygon: box().slice(0, 2), mode: 'replace' }),
    ).toThrow('three');
  });
  it('combines and clips dense rings beyond the former input and total-vertex caps', () => {
    const circle = (count: number, x: number, r: number) =>
      Array.from({ length: count }, (_, i) => ({
        x: x + r * Math.cos((i * 2 * Math.PI) / count),
        y: r * Math.sin((i * 2 * Math.PI) / count),
      }));
    const outer = circle(9000, 0, 100),
      hole = circle(4500, 0, 25),
      island = circle(4500, 300, 30);
    const original = JSON.stringify([outer, hole, island]);
    const solid = combinePaintRegion({ current: [], polygon: outer, mode: 'replace' });
    const ring = combinePaintRegion({ current: solid, polygon: hole, mode: 'subtract' });
    const before = JSON.stringify(ring);
    const region = combinePaintRegion({ current: ring, polygon: island, mode: 'add' });
    expect(region.flat(2).length).toBeGreaterThan(16000);
    expect(regionContains(region, { x: 0, y: 0 })).toBe(false);
    expect(regionContains(region, { x: 50, y: 0 })).toBe(true);
    expect(regionContains(region, { x: 300, y: 0 })).toBe(true);
    expect(regionContains(region, { x: 200, y: 0 })).toBe(false);
    const shape: Vector = {
      id: 'paint',
      kind: 'rectangle',
      x: -110,
      y: -110,
      width: 450,
      height: 220,
      rotation: 0,
      fill: '#123456',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const saved = JSON.stringify(shape);
    const parts = clipPaint([shape], { region, keep: 'inside', eligible: ['paint'] });
    expect(
      parts.reduce((count, s) => count + (s.contours?.flat().length ?? s.points.length), 0),
    ).toBeGreaterThan(16000);
    expect(parts.every((s) => s.fill === shape.fill)).toBe(true);
    expect(JSON.stringify(shape)).toBe(saved);
    expect(JSON.stringify(ring)).toBe(before);
    expect(JSON.stringify([outer, hole, island])).toBe(original);
  });
});
it('uses even-odd membership for self-crossing paint selection outlines', () => {
  for (const origin of [0, -99900, 99900]) {
    const polygon = [
      [0, -10],
      [6, 8],
      [-10, -3],
      [10, -3],
      [-6, 8],
    ].map(([x, y]) => ({ x: origin + x, y: origin + y }));
    const before = structuredClone(polygon);
    const region = combinePaintRegion({ current: [], polygon, mode: 'replace' });
    expect(regionContains(region, { x: origin, y: origin })).toBe(false);
    expect(regionContains(region, { x: origin, y: origin - 7 })).toBe(true);
    expect(regionContains(region, { x: origin + 9, y: origin + 9 })).toBe(false);
    expect(polygon).toEqual(before);
  }
});
it('applies parity before region set operations and rejects fully retraced masks atomically', () => {
  const polygon = [
    [0, -10],
    [6, 8],
    [-10, -3],
    [10, -3],
    [-6, 8],
  ].map(([x, y]) => ({ x, y }));
  const current = combinePaintRegion({
    current: [],
    polygon: box(-20, -20, 40, 40),
    mode: 'replace',
  });
  const before = structuredClone(current);
  for (const mode of ['replace', 'add', 'subtract', 'intersect'] as const) {
    const region = combinePaintRegion({ current, polygon, mode });
    expect(regionContains(region, { x: 0, y: 0 })).toBe(mode === 'add' || mode === 'subtract');
    expect(regionContains(region, { x: 0, y: -7 })).toBe(mode !== 'subtract');
    expect(current).toEqual(before);
  }
  const square = [...box(), box()[0]];
  expect(() =>
    combinePaintRegion({ current, polygon: [...square, ...square], mode: 'replace' }),
  ).toThrow('no area');
  expect(current).toEqual(before);
});
it('retains region set and clipped paint ownership when floating operations fail', () => {
  const current = combinePaintRegion({ current: [], polygon: box(0, 0, 20, 20), mode: 'replace' });
  const polygon = box(10, 10, 20, 20);
  const before = structuredClone({ current, polygon });
  for (const [mode, operation] of [
    ['add', 'union'],
    ['subtract', 'difference'],
    ['intersect', 'intersection'],
  ] as const) {
    const spy = vi.spyOn(floating, operation).mockImplementationOnce(() => {
      throw new Error('Unable to find segment');
    });
    try {
      const region = combinePaintRegion({ current, polygon, mode });
      for (const x of [5, 15, 25])
        for (const y of [5, 15, 25]) {
          const a = x < 20 && y < 20,
            b = x > 10 && y > 10;
          expect(regionContains(region, { x, y })).toBe(
            mode === 'add' ? a || b : mode === 'subtract' ? a && !b : a && b,
          );
        }
      expect({ current, polygon }).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  }
  const shape: Vector = {
    id: 'source',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const original = structuredClone(shape);
  for (const keep of ['inside', 'outside'] as const) {
    const intersection = vi.spyOn(floating, 'intersection').mockImplementation(() => {
      throw new Error('SweepLine failure');
    });
    const difference = vi.spyOn(floating, 'difference').mockImplementation(() => {
      throw new Error('Unable to complete output ring');
    });
    try {
      const pieces = clipPaint([shape], { polygon, keep, eligible: ['source'] });
      for (const x of [5, 15, 25])
        for (const y of [5, 15, 25]) {
          const insideSource = x < 20 && y < 20,
            insideMask = x > 10 && y > 10;
          expect(pieces.some((s) => hit(s, { x, y }, 0))).toBe(
            insideSource && (keep === 'inside' ? insideMask : !insideMask),
          );
        }
      expect(shape).toEqual(original);
    } finally {
      intersection.mockRestore();
      difference.mockRestore();
    }
  }
});
