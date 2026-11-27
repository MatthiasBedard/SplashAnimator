import type { Vector } from '../packages/document/src';
import { mergeVectors } from '../packages/geometry/src/merge';
export function regionMoveArtwork(seed = 0, origin = 0) {
  let art: Vector[] = [];
  for (let j = 0; j < 4; j++) {
    const brush: Vector = {
      id: `b${j}`,
      kind: 'brush',
      x: 120,
      y: 110,
      width: 300,
      height: 150,
      rotation: 0,
      fill: j % 2 ? '#ff0000' : '#0066cc',
      stroke: '#000000',
      strokeWidth: 12,
      points: Array.from({ length: 41 }, (_, i) => ({
        x: i * 6.7,
        y: 50 + 30 * Math.sin(i * 0.16 + j * 0.8 + seed * 0.01),
        pressure: 1,
      })),
    };
    art = mergeVectors([...art, brush]);
  }
  art.push({
    id: 'pencil',
    kind: 'path',
    x: 0,
    y: 0,
    width: 600,
    height: 300,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#202020',
    strokeWidth: 2,
    points: [
      { x: 450, y: 0 },
      { x: 450, y: 300 },
    ],
  });
  art = art.map((s) => ({ ...s, x: s.x + origin, y: s.y + origin }));
  const polygon = [
      { x: 180 + seed * 0.23, y: 110 },
      { x: 310, y: 110 },
      { x: 310, y: 220 },
      { x: 180 + seed * 0.23, y: 220 },
    ],
    eligible = art.map((s) => s.id);
  return { art, polygon: polygon.map((p) => ({ x: p.x + origin, y: p.y + origin })), eligible };
}
