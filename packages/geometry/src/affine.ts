import type { Point, Vector } from '@splash/document';
export type Matrix = [number, number, number, number, number, number];
export function matrix(s: Pick<Vector, 'x' | 'y' | 'rotation' | 'transform'>): Matrix {
  const r = (s.rotation * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r);
  const [a, b, u, d] = s.transform ?? [1, 0, 0, 1];
  return [c * a - n * b, n * a + c * b, c * u - n * d, n * u + c * d, s.x, s.y];
}
export function mapPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function inversePoint(m: Matrix, p: Point): Point {
  const det = m[0] * m[3] - m[1] * m[2],
    x = p.x - m[4],
    y = p.y - m[5];
  return { x: (m[3] * x - m[2] * y) / det, y: (m[0] * y - m[1] * x) / det };
}
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function around(p: Point, a: number, b: number, c: number, d: number): Matrix {
  return [a, b, c, d, p.x - a * p.x - c * p.y, p.y - b * p.x - d * p.y];
}
export function transformedMatrix(shape: Vector, operation: Matrix): Matrix {
  const m = multiply(operation, matrix(shape)).map(n => n === 0 ? 0 : n) as Matrix;
  if (m.some(n => !Number.isFinite(n) || Math.abs(n) > 100000) ||
      Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
    throw new Error('Transform exceeds supported geometry limits.');
  return m;
}

/** Prepare every result before mutating so an invalid transform changes no members. */
export function transformVectors(shapes: Vector[], operation: Matrix) {
  const results = shapes.map(s => transformedMatrix(s, operation));
  shapes.forEach((s, i) => {
    const m = results[i];
    s.x = m[4];
    s.y = m[5];
    s.rotation = 0;
    s.transform = [m[0], m[1], m[2], m[3]];
  });
}
