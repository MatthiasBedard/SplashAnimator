import { describe, it, expect } from 'vitest';
import { clone, type Gradient, newProject, validateProject, id } from '../packages/document/src';
import {
  addGradientStop,
  editGradientStop,
  transformGradient,
  shapeGradient,
  resizeGradient,
  gradientAxis,
  gradientStopPoint,
  moveGradientStop,
  moveGradientAxis,
  gradientPoint,
  removeGradientStop,
} from '../packages/geometry/src/gradient';
const gradient = (): Gradient => ({
  kind: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
  stops: [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ],
});
describe('gradient stop editing', () => {
  it('clamps opacity and interpolates new stop opacity without changing originals', () => {
    const g = gradient();
    const transparent = editGradientStop(g, 0, { opacity: -1 });
    expect(transparent.stops[0].opacity).toBe(0);
    expect(g.stops[0].opacity).toBeUndefined();
    expect(addGradientStop(transparent).stops[1].opacity).toBe(0.5);
    expect(editGradientStop(g, 1, { opacity: 2 }).stops[1].opacity).toBe(1);
    expect(() => editGradientStop(g, 0, { opacity: NaN })).toThrow();
  });
  it('inserts interpolated paint in the widest interval without mutating authored stops', () => {
    const g = gradient(),
      before = clone(g),
      out = addGradientStop(g);
    expect(out.stops[1]).toEqual({ offset: 0.5, color: '#808080' });
    expect(g).toEqual(before);
    expect(addGradientStop(out).stops[1]).toEqual({ offset: 0.25, color: '#404040' });
  });
  it('orders crossed stops, clamps bounds and retains deliberate hard transitions', () => {
    const g = addGradientStop(gradient());
    const moved = editGradientStop(g, 1, { offset: 1.4, color: '#ff0000' });
    expect(moved.stops.map((s) => s.offset)).toEqual([0, 1, 1]);
    expect(moved.stops[1].color).toBe('#ff0000');
    expect(() => editGradientStop(g, 1, { offset: NaN })).toThrow();
    expect(() => editGradientStop(g, 1, { color: 'bad' })).toThrow();
  });
  it('enforces two-to-32 stops and survives project validation and JSON roundtrip', () => {
    let g = gradient();
    for (let i = 2; i < 32; i++) g = addGradientStop(g);
    expect(() => addGradientStop(g)).toThrow();
    g = removeGradientStop(g, 5);
    expect(g.stops).toHaveLength(31);
    expect(() => removeGradientStop(gradient(), 0)).toThrow();
    const p = newProject();
    p.layers[0].keys[0].shapes = [
      {
        id: id(),
        kind: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        gradient: g,
      },
    ];
    g.transform = [1, 0, 0.5, 0.5];
    g.stops[0].opacity = 0.25;
    expect(() => validateProject(JSON.parse(JSON.stringify(p)))).not.toThrow();
    g.transform = [1, 0, 0, 0];
    expect(() => validateProject(p)).toThrow();
    g.transform = [1, 0, 0, 1];
    g.stops[0].opacity = 1.1;
    expect(() => validateProject(p)).toThrow();
  });
});

it('transforms gradient paint around its start while preserving stops and source data', () => {
  const g = gradient();
  g.stops[0].opacity = 0.3;
  const before = clone(g);
  const out = transformGradient(g, 10, 20, 90, 2);
  expect(out.from).toEqual({ x: 10, y: 20 });
  expect(out.to.x).toBeCloseTo(10);
  expect(out.to.y).toBeCloseTo(220);
  expect(out.stops).toEqual(g.stops);
  expect(g).toEqual(before);
  expect(() => transformGradient(g, 0, 0, 0, 0)).toThrow();
  expect(() => transformGradient(g, NaN, 0, 0, 1)).toThrow();
  expect(() => transformGradient(g, 100001, 0, 0, 1)).toThrow();
});

it('maps elliptical skewed paint handles and rotates the complete basis', () => {
  const g = shapeGradient(gradient(), 0.5, 30),
    p = { x: 30, y: 40 };
  const mapped = gradientPoint(g, p),
    back = gradientPoint(g, mapped, true);
  expect(back.x).toBeCloseTo(p.x);
  expect(back.y).toBeCloseTo(p.y);
  const rotated = transformGradient(g, 0, 0, 90, 1),
    actual = gradientPoint(rotated, { x: -40, y: 30 });
  expect(actual.x).toBeCloseTo(-mapped.y);
  expect(actual.y).toBeCloseTo(mapped.x);
  expect(() => shapeGradient(g, 0, 0)).toThrow();
  expect(() => shapeGradient(g, 1, 90)).toThrow();
});

it('preserves linear and radial paint parameters through anisotropic resizing', () => {
  for (const kind of ['linear', 'radial'] as const) {
    const g = shapeGradient(
      { ...gradient(), kind, from: { x: 10, y: 20 }, to: { x: 110, y: 70 } },
      0.5,
      30,
    );
    const value = (paint: Gradient, p: { x: number; y: number }) => {
      const q = gradientPoint(paint, p, true),
        dx = paint.to.x - paint.from.x,
        dy = paint.to.y - paint.from.y,
        x = q.x - paint.from.x,
        y = q.y - paint.from.y;
      return kind === 'radial'
        ? Math.hypot(x, y) / Math.hypot(dx, dy)
        : (x * dx + y * dy) / (dx * dx + dy * dy);
    };
    for (const [sx, sy] of [
      [2, 0.5],
      [-1, 3],
      [0.5, 0.5],
    ]) {
      const resized = resizeGradient(g, sx, sy);
      for (const p of [
        { x: 40, y: 45 },
        { x: 120, y: 90 },
      ])
        expect(value(resized, { x: p.x * sx, y: p.y * sy })).toBeCloseTo(value(g, p), 10);
    }
    expect(() => resizeGradient(g, 0, 1)).toThrow();
    expect(() => resizeGradient(g, 1e8, 1)).toThrow();
  }
});

it('moves the secondary axis while preserving the main axis and rejects collapse', () => {
  const g = shapeGradient({ ...gradient(), to: { x: 80, y: 60 } }, 0.5, 20),
    main = gradientPoint(g, g.to);
  const next = moveGradientAxis(g, { x: 10, y: 120 });
  expect(gradientAxis(next).x).toBeCloseTo(10);
  expect(gradientAxis(next).y).toBeCloseTo(120);
  expect(gradientPoint(next, next.to).x).toBeCloseTo(main.x);
  expect(gradientPoint(next, next.to).y).toBeCloseTo(main.y);
  expect(() => moveGradientAxis(g, g.from)).toThrow();
  expect(g.transform).not.toEqual(next.transform);
});

it('moves stops through an affine paint basis with clamping and stable source indices', () => {
  const g = addGradientStop(shapeGradient(gradient(), 0.5, 30));
  g.stops[1].opacity = 0.4;
  const p = gradientPoint(g, { x: 80, y: 0 }),
    out = moveGradientStop(g, 1, p);
  expect(out.stops[1].offset).toBeCloseTo(0.8);
  expect(out.stops[1].opacity).toBe(0.4);
  expect(gradientStopPoint(out, 1).x).toBeCloseTo(p.x);
  expect(g.stops[1].offset).toBe(0.5);
  expect(moveGradientStop(g, 1, { x: 1000, y: 0 }).stops.at(-1)!.offset).toBe(1);
});
