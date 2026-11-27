import type { Point } from '../packages/document/src';

// Pixel-rounded pointer samples include multiway crossings, a T junction
// at an existing mouse sample and a short collinear retrace.
export const starCorners = Array.from({ length: 30 }, (_, i) => {
  const angle = 2 * Math.PI * ((i * 14) % 31) / 31;
  return { x: Math.round(132 + 138 * Math.cos(angle)), y: Math.round(125 + 81 * Math.sin(angle)) };
});

export const sampledStar = starCorners.flatMap((end, i) => {
  if (i === 0) return [end];
  const start = starCorners[i - 1];
  const steps = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 7);
  return Array.from({ length: steps }, (_, step) => ({
    x: Math.round(start.x + (end.x - start.x) * (step + 1) / steps),
    y: Math.round(start.y + (end.y - start.y) * (step + 1) / steps),
  }));
});

// Reconstruct the vertical Brush wave, self-crossing diagonal Brush scribble
// and horizontal Pencil sweeps visible in the user's two stacking orders.
export const verticalWave = Array.from({length: 157}, (_, i) => ({
  x: 86 + 236*i/156 + 6*Math.sin(i/14), y: 148 - 114*Math.sin(i*Math.PI/19.5 + .4),
}));
export const pencilWave = Array.from({length: 153}, (_, i) => ({
  x: 198 - 146*Math.cos(i*Math.PI/19), y: 71 + i*.85 + 5*Math.sin(i*Math.PI/19),
}));
const corners = [[54,195],[77,110],[104,68],[129,51],[140,71],[131,105],[98,167],
  [53,233],[104,219],[252,105],[338,57],[355,55],[329,81],[194,183],[111,221],
  [38,231],[111,219],[318,221],[373,211],[296,198],[54,188],[22,185],[99,177],
  [286,179],[260,148],[235,104],[234,50],[229,105],[217,190],[214,222]];
export const diagonalScribble: Point[] = corners.flatMap(([x,y],i) => {
  if (!i) return [{x,y}];
  const [a,b] = corners[i-1], count = Math.ceil(Math.hypot(x-a,y-b)/5);
  return Array.from({length:count}, (_, j) => ({x:a+(x-a)*(j+1)/count, y:b+(y-b)*(j+1)/count}));
});
