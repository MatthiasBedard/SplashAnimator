import type { Vector } from '../packages/document/src';

/** A long triangle with real area and no representable interior y coordinate. */
export function narrowArrangementOutline(origin = 50000, length = 50000): Vector {
  const bits = new DataView(new ArrayBuffer(8));
  const next = (n: number, delta: bigint) => {
    bits.setFloat64(0, n);
    bits.setBigUint64(0, bits.getBigUint64(0) + delta);
    return bits.getFloat64(0);
  };
  let y = next(origin + 0.0000005, -4n);
  for (let i = 0; i < 8; i++) {
    const upper = next(y, 1n);
    if (Math.round(y * 1e6) !== Math.round(upper * 1e6))
      return {
        id: 'narrow-outline',
        kind: 'path',
        x: 0,
        y,
        width: length,
        height: upper - y,
        rotation: 0,
        fill: '#ffffff',
        fillEnabled: false,
        stroke: '#1840aa',
        strokeWidth: 2,
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: length, y: 0 },
          { x: length / 2, y: upper - y },
        ],
      };
    y = upper;
  }
  throw Error('Expected adjacent floats across the arrangement vertex grid.');
}

export function narrowFixtureBrush(y = 100): Vector {
  return {
    id: 'new-brush',
    kind: 'brush',
    x: 90,
    y,
    width: 0,
    height: 0,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: 12,
    points: [
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 64, y: 0 },
    ],
  };
}
