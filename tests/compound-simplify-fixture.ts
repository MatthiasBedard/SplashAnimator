import type { Vector } from '../packages/document/src';

export function compoundBrushPaint(): Vector {
  return {
    id: 'compound-brush', kind: 'polygon', x: 80, y: 80, width: 120, height: 120,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0,
    drawingMode: 'merge', closed: true, fillEnabled: true, fillRule: 'evenodd', points: [],
    contours: [
      [
        { x: 60, y: 0, in: { x: 27, y: 0 } },
        ...Array.from({ length: 1200 }, (_, i) => {
          const t = (i + 1) / 1201;
          return { x: 60 + 60 * Math.sin(Math.PI * t) + 0.15 * Math.sin(300 * t), y: 120 * t };
        }),
        { x: 60, y: 120, out: { x: 27, y: 120 } },
        { x: 0, y: 60, in: { x: 0, y: 93 }, out: { x: 0, y: 27 } },
      ],
      [{ x: 20, y: 60 }, { x: 40, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 80 }],
    ],
  };
}
