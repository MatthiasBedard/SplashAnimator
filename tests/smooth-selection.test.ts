import { fitCompoundContours } from '../packages/geometry/src/compound-fit';
import { worldPaths } from '../packages/geometry/src/drawing';
import { expect, it } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { prepareSmoothSelection as smooth } from '../packages/geometry/src/smooth-selection';
import { worldPoint } from '../packages/geometry/src';
import { contains, vectorPolygons, mergeVectors } from '../packages/geometry/src/merge';

export function smoothingFixture(kind: 'path' | 'brush' | 'polygon' = 'path'): Vector {
  const shape: Vector = {
    id: 'art',
    kind,
    x: 80,
    y: 80,
    width: 180,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: kind === 'polygon' ? 0 : 8,
    fillEnabled: kind !== 'path',
    points: [],
  };
  if (kind === 'brush')
    shape.brush = { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
  if (kind === 'polygon') {
    shape.fillRule = 'evenodd';
    shape.contours = [
      Array.from({ length: 120 }, (_, i) => {
        const a = (i / 120) * Math.PI * 2,
          r = 50 + Math.sin(i * 1.7) * 0.15;
        return { x: 60 + Math.cos(a) * r, y: 60 + Math.sin(a) * r };
      }),
    ];
  } else
    shape.points = Array.from({ length: 121 }, (_, i) => ({
      x: i * 1.5,
      y: 30 + Math.sin(i / 18) * 20 + (i % 2 ? 2 : -2),
      pressure: i / 120,
      tiltX: 20,
      tiltY: -10,
      twist: 30,
    }));
  return shape;
}
function valid(shapes: Vector[]) {
  const p = newProject();
  p.layers[0].keys[0].shapes = shapes;
  validateProject(p);
}

for (const kind of ['path', 'brush', 'polygon'] as const)
  it(`smooths selected ${kind}, preserves paint/selection/unselected data and stays editable`, () => {
    const source = smoothingFixture(kind),
      other = { ...smoothingFixture(), id: 'other', x: 350 };
    const before = structuredClone([source, other]);
    const out = smooth([source, other], { selected: ['art'] });
    expect(out.changed).toBe(1);
    expect(out.selected).toEqual(['art']);
    expect(out.artwork[1]).toEqual(other);
    expect([source, other]).toEqual(before);
    expect(out.artwork[0].fill).toBe(source.fill);
    expect(out.artwork[0].strokeWidth).toBe(source.strokeWidth);
    valid(out.artwork);
    if (kind === 'path') {
      expect(out.artwork[0].kind).toBe('bezier');
      expect(out.artwork[0].nodes!.length).toBeLessThan(30);
    }
    if (kind === 'polygon') {
      expect(out.artwork[0].contours![0].length).toBeLessThan(40);
      expect(out.artwork[0].contours![0].some((n) => n.out)).toBe(true);
    }
  });

for (const basis of [
  [1, 0.2, 0.3, 1],
  [-1, 0.2, 0.3, 1],
] as const)
  it(`preserves affine endpoint positions, pen data and independent paint/pivot basis ${basis[0]}`, () => {
    const s = smoothingFixture();
    s.transform = [...basis];
    s.pivot = { x: -25, y: 200 };
    s.gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 20 },
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    const out = smooth([s], { selected: [s.id] }).artwork[0];
    expect(out.transform).toEqual(s.transform);
    expect(out.gradient).toEqual(s.gradient);
    expect(out.pivot).toEqual(s.pivot);
    expect([out.x, out.y, out.width, out.height]).toEqual([s.x, s.y, s.width, s.height]);
    for (const [p, q] of [
      [s.points[0], out.nodes![0]],
      [s.points.at(-1)!, out.nodes!.at(-1)!],
    ]) {
      expect(worldPoint(out, q)).toEqual(worldPoint(s, p));
      expect(q.pressure).toBe(p.pressure);
      expect(q.tiltX).toBe(p.tiltX);
    }
    valid([out]);
  });

it('keeps a compound hole and repeated smoothing editable', () => {
  const s = smoothingFixture('polygon');
  s.contours!.push(s.contours![0].map((p) => ({ x: 60 + (p.x - 60) / 3, y: 60 + (p.y - 60) / 3 })));
  const once = smooth([s], { selected: [s.id] }).artwork;
  const twice = smooth(once, { selected: [s.id] }).artwork;
  expect(twice[0].contours).toHaveLength(2);
  expect(contains(vectorPolygons(twice[0]), { x: 140, y: 140 })).toBe(false);
  expect(contains(vectorPolygons(twice[0]), { x: 175, y: 140 })).toBe(true);
  valid(twice);
});

it('keeps stationary Brush pressure runs and exact endpoints', () => {
  const s = smoothingFixture('brush');
  s.points.splice(40, 0, { ...s.points[39], pressure: 0.9 });
  const q = smooth([s], { selected: [s.id] }).artwork[0];
  expect(q.points[39]).toEqual(s.points[39]);
  expect(q.points[40]).toEqual(s.points[40]);
  expect(q.points[0]).toEqual(s.points[0]);
  expect(q.points.at(-1)).toEqual(s.points.at(-1));
});

it('has no geometry/history change to make for already-smooth primitives or unsupported text', () => {
  for (const kind of ['line', 'rectangle', 'ellipse', 'text', 'symbol'] as const) {
    const s = { ...smoothingFixture(), kind };
    const out = smooth([s], { selected: [s.id] });
    expect(out.changed).toBe(0);
    expect(out.artwork).toEqual([s]);
  }
});

it('prepares multiple objects together and never returns partial work on a bad ring', () => {
  const a = smoothingFixture(),
    b = smoothingFixture('polygon');
  b.id = 'bad';
  b.contours = [
    [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 20, y: 0 },
    ],
  ];
  const before = structuredClone([a, b]);
  expect(() => smooth([a, b], { selected: [a.id, b.id] })).toThrow();
  expect([a, b]).toEqual(before);
});

it('rejects missing/duplicate picks and raw getters/nonfinite values without mutation', () => {
  const s = smoothingFixture();
  expect(() => smooth([s], { selected: ['missing'] })).toThrow();
  expect(() => smooth([s], { selected: [s.id, s.id] })).toThrow();
  let reads = 0;
  Object.defineProperty(s.points[10], 'x', {
    get() {
      reads++;
      return 10;
    },
    enumerable: true,
  });
  expect(() => smooth([s], { selected: [s.id] })).toThrow();
  expect(reads).toBe(0);
  const bad = smoothingFixture();
  bad.points[1].x = NaN;
  expect(() => smooth([bad], { selected: [bad.id] })).toThrow();
});

it('smooths a paint-region fragment while protecting outside pixels and the region boundary', () => {
  const s = smoothingFixture('polygon');
  const region = [
    [
      [
        [135, 70],
        [210, 70],
        [210, 210],
        [135, 210],
        [135, 70],
      ],
    ],
  ] as [number, number][][][];
  const out = smooth([s], { selected: [], region, eligible: [s.id] });
  expect(out.changed).toBeGreaterThan(0);
  expect(out.selected.length).toBeGreaterThan(0);
  for (let x = 85; x < 134; x += 3)
    for (let y = 85; y < 195; y += 3)
      expect(out.artwork.some((q) => contains(vectorPolygons(q), { x, y }))).toBe(
        contains(vectorPolygons(s), { x, y }),
      );
  valid(out.artwork);
});

it('smooths actual merged Brush footprint contours rather than only raw Brush samples', () => {
  const s = smoothingFixture('brush');
  s.brush!.pressure = false;
  s.strokeWidth = 16;
  s.points = Array.from({ length: 61 }, (_, i) => ({ x: i * 3, y: 40 + 12 * Math.sin(i / 12) }));
  const paint = mergeVectors([s]);
  expect(paint.every((p) => p.kind === 'polygon' && p.contours?.length)).toBe(true);
  const before = structuredClone(paint);
  const result = smooth(paint, { selected: paint.map((p) => p.id) });
  expect(result.changed).toBeGreaterThan(0);
  expect(result.artwork.some((p) => p.contours?.some((r) => r.some((n) => n.in || n.out)))).toBe(
    true,
  );
  expect(paint).toEqual(before);
  valid(result.artwork);
});

for (const k of [6, 7, 8, 9, 10, 14, 17, 18])
  for (const basis of ['plain', 'translated', 'reflected'])
    it(`smooths the formerly rejected merged Brush join ${k}/${basis} without changing paint or other artwork`, () => {
      const s = smoothingFixture('brush');
      s.x = 0;
      s.y = 0;
      s.brush!.pressure = false;
      s.strokeWidth = 4 + k;
      s.points = Array.from({ length: 61 }, (_, i) => ({
        x: i * 3,
        y: 50 + 20 * Math.sin((i * k) / 60),
      }));
      const paint = mergeVectors([s])[0];
      if (basis === 'translated') {
        paint.x += 1000;
        paint.y -= 2000;
      }
      if (basis === 'reflected') paint.transform = [-1, 0, 0, 1];
      const paths = worldPaths(paint, 0.1);
      if (basis === 'plain')
        expect(() => fitCompoundContours(paths, 0.25, 0)).toThrow(
          'Fitted join cannot be separated',
        );
      const before = structuredClone(paint),
        other = { ...s, id: 'other' },
        result = smooth([paint, other], { selected: [paint.id] }),
        out = result.artwork[0];
      expect(result.changed).toBe(1);
      expect(result.selected).toEqual([paint.id]);
      expect(result.artwork[1]).toEqual(other);
      expect(paint).toEqual(before);
      expect({ ...out, contours: undefined }).toEqual({ ...paint, contours: undefined });
      expect(out.contours!.reduce((n, r) => n + r.length, 0)).toBeLessThan(
        paint.contours!.reduce((n, r) => n + r.length, 0),
      );
      expect(out.contours!.some((r) => r.some((n) => n.in || n.out))).toBe(true);
      valid(result.artwork);
      const fit = fitCompoundContours(paths, 0.25, 0, true);
      expect(fit.rings.every((r) => r.maxError <= 0.25)).toBe(true);
    });

it('smooths a mixed selection containing the formerly rejected brush footprint and pencil artwork atomically',()=>{
 const brush=smoothingFixture('brush');brush.brush!.pressure=false;brush.strokeWidth=10;brush.points=Array.from({length:61},(_,i)=>({x:i*3,y:50+20*Math.sin(i/10)}));const paint=mergeVectors([brush])[0],line={...smoothingFixture('path'),id:'line'},before=structuredClone([paint,line]);
 const result=smooth([paint,line],{selected:[paint.id,line.id]});expect(result.changed).toBe(2);expect(result.selected).toEqual([paint.id,line.id]);expect([paint,line]).toEqual(before);valid(result.artwork);
});
