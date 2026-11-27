import type { Vector, BezierNode } from '../packages/document/src';
import { mergeVectors } from '../packages/geometry/src/merge';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
export function connectedLines(merged = false): Vector[] {
  const base: Vector = {
    id: 'left',
    kind: 'bezier',
    drawingMode: 'merge',
    x: 60,
    y: 120,
    width: 140,
    height: 0,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 4,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 50, y: -15 } },
      { x: 140, y: 0, in: { x: 100, y: -15 } },
    ],
  };
  const lines: Vector[] = [
    base,
    {
      ...structuredClone(base),
      id: 'right',
      x: 200,
      width: 100,
      nodes: [
        { x: 0, y: 0, out: { x: 30, y: 15 } },
        { x: 100, y: 0, in: { x: 70, y: 15 } },
      ],
    },
    {
      ...structuredClone(base),
      id: 'branch',
      x: 200,
      width: 0,
      height: 80,
      nodes: [
        { x: 0, y: 0, out: { x: 0, y: 30 } },
        { x: 0, y: 80, in: { x: 0, y: 60 } },
      ],
    },
  ];
  return merged ? mergeVectors(lines, undefined, true) : lines;
}
export const connectedWorldNodes = (s: Vector) =>
  ((s.contours?.flat() ?? s.nodes ?? s.points) as BezierNode[]).map((n) => ({
    ...mapPoint(matrix(s), n),
    ...(n.in ? { in: mapPoint(matrix(s), n.in) } : {}),
    ...(n.out ? { out: mapPoint(matrix(s), n.out) } : {}),
  }));
