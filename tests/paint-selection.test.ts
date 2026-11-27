import { describe, it, expect } from 'vitest';
import { paintKey, selectMatchingPaint } from '../packages/document/src/paint-selection';
import type { Vector } from '../packages/document/src';
const box = (id: string, patch: Partial<Vector> = {}): Vector => ({
  id,
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  points: [],
  fill: '#abcdef',
  stroke: '#123456',
  strokeWidth: 2,
  ...patch,
});
describe('matching paint selection', () => {
  it('normalizes defaults and color case but distinguishes disabled and different paints', () => {
    const source = box('a');
    const shapes = [
      source,
      box('b', { fill: '#ABCDEF', opacity: 1, rotation: 30 }),
      box('c', { fillEnabled: false }),
      box('d', { opacity: 0.5 }),
      box('e', { kind: 'line' }),
    ];
    expect(selectMatchingPaint(shapes, source, 'fill', [])).toEqual(['a', 'b']);
    expect(paintKey(box('f', { kind: 'brush' }), 'stroke')).toBeUndefined();
    expect(paintKey(box('g', { strokeWidth: 0 }), 'stroke')).toBeUndefined();
    expect(paintKey(box('h', { strokeCap: 'butt' }), 'stroke')).not.toBe(
      paintKey(source, 'stroke'),
    );
  });
  it('compares gradient stops including alpha and local coordinates', () => {
    const g = {
      kind: 'linear' as const,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#abcdef' },
        { offset: 1, color: '#123456', opacity: 0.5 },
      ],
    };
    const a = box('a', { gradient: g });
    const b = box('b', { gradient: structuredClone(g), fill: '#000000' });
    expect(paintKey(a, 'fill')).toBe(paintKey(b, 'fill'));
    b.gradient!.stops[1].opacity = 1;
    expect(paintKey(a, 'fill')).not.toBe(paintKey(b, 'fill'));
  });
  it('expands matching groups but stays inside the isolation scope without mutation', () => {
    const a = box('a', { groups: ['outer'] });
    const shapes = [
      a,
      box('b', { groups: ['outer', 'inner'] }),
      box('c', { groups: ['outer', 'inner'], fill: '#ffffff' }),
      box('d', { groups: ['other'] }),
    ];
    const before = structuredClone(shapes);
    expect(selectMatchingPaint(shapes, a, 'fill', ['outer'])).toEqual(['a', 'b', 'c']);
    expect(shapes).toEqual(before);
  });
});
