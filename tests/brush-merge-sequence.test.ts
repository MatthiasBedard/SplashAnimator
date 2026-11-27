import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { mergeVectors, vectorPolygons, contains } from '../packages/geometry/src/merge';
it('retains topmost paint through the repeated crossing sequence that overflowed ring recursion', () => {
  let shapes: Vector[] = [];
  const paints: { fill: string; polygons: ReturnType<typeof vectorPolygons> }[] = [];
  for (let i = 0; i < 24; i++) {
    const stroke: Vector = {
      id: 'stroke-' + i,
      kind: 'brush',
      x: 0,
      y: 0,
      width: 800,
      height: 200,
      rotation: 0,
      fill: i % 2 ? '#cc4411' : '#224488',
      stroke: '#000000',
      strokeWidth: 24,
      brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
      points: Array.from({ length: 81 }, (_, j) => ({
        x: 20 + j * 9,
        y: 100 + Math.sin(j / 10 + i * 0.4) * 60,
        pressure: 0.35 + j / 130,
      })),
    };
    const input = [...shapes, stroke],
      before = JSON.stringify(input);
    paints.push({ fill: stroke.fill, polygons: vectorPolygons(stroke) });
    shapes = mergeVectors(input);
    expect(JSON.stringify(input)).toBe(before);
    const regions = shapes.map((s) => ({ fill: s.fill, polygons: vectorPolygons(s) }));
    for (const point of stroke.points.filter((_, j) => j % 20 === 0)) {
      const expected = [...paints].reverse().find((p) => contains(p.polygons, point));
      const actual = regions.find((p) => contains(p.polygons, point));
      expect(actual?.fill).toBe(expected?.fill);
    }
    expect(shapes.every((s) => s.kind === 'polygon' && s.strokeWidth === 0)).toBe(true);
  }
}, 15000);
