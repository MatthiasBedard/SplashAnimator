import { expect, it } from 'vitest';
import { newProject, validateProject, type Vector, type Point } from '../packages/document/src';
import { restorePaintCurves } from '../packages/geometry/src/paint-curves';
import { worldPaths } from '../packages/geometry/src/drawing';
import { inversePoint, mapPoint, matrix } from '../packages/geometry/src/affine';
import { mergeVectors, contains, vectorPolygons } from '../packages/geometry/src/merge';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';
const count = (shapes: Vector[]) =>
  shapes.reduce(
    (n, s) =>
      n + (s.contours?.reduce((a, r) => a + r.length, 0) ?? s.nodes?.length ?? s.points.length),
    0,
  );
const edges = (shapes: Vector[]) =>
  shapes.flatMap((s, shape) =>
    s.contours!.flatMap((ring) =>
      ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length],
          m = matrix(s);
        return { shape, a: mapPoint(m, a), b: mapPoint(m, b), curved: !!(a.out || b.in) };
      }),
    ),
  );
const samePoint = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
function expectSharedBoundaryUnchanged(before: Vector[], after: Vector[]) {
  const original = edges(before),
    result = edges(after),
    shared = original.filter((a) =>
      original.some((b) => a.shape !== b.shape && samePoint(a.a, b.b) && samePoint(a.b, b.a)),
    );
  expect(shared.length).toBeGreaterThan(4);
  for (const edge of shared)
    expect(
      result.some(
        (p) =>
          p.shape === edge.shape && !p.curved && samePoint(p.a, edge.a) && samePoint(p.b, edge.b),
      ),
    ).toBe(true);
}
const brushRing = (radius: number, color: string): Vector => ({
  id: color,
  kind: 'brush',
  x: 100,
  y: 100,
  width: 140,
  height: 140,
  rotation: 0,
  fill: color,
  fillEnabled: true,
  stroke: '#000000',
  strokeWidth: 14,
  points: Array.from({ length: 361 }, (_, i) => ({
    x: 70 + radius * Math.cos((i * Math.PI) / 180),
    y: 70 + radius * Math.sin((i * Math.PI) / 180),
  })),
  brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
});

it('paints the exact optimized Brush outline over a different color and cuts matching curved holes', () => {
  const brush: Vector = { ...brushRing(20, '#ff0000'), points: [{ x: 8, y: 20 }, { x: 30, y: 20 },
    { x: 59, y: 35 }, { x: 89, y: 34 }] };
  const background: Vector = { ...brush, id: 'background', kind: 'rectangle', x: 40, y: 40,
    width: 240, height: 240, points: [], brush: undefined, strokeWidth: 0, fill: '#0000ff' };
  const request = { brush, amount: 1.25, merge: true, mode: 'normal' as const, selected: [], at: 0, optimize: true };
  const [standalone] = commitBrushPaint([], request);
  const [oldPaint, newPaint] = commitBrushPaint([background], { ...request, at: 1 });
  expect(oldPaint.fill).toBe('#0000ff');
  expect(worldPaths(newPaint, 0.002)).toEqual(worldPaths(standalone, 0.002));
  expect(oldPaint.contours).toHaveLength(2);
  expect(oldPaint.contours!.some(r => r.some(n => n.out))).toBe(true);
});
it('default optimized colored strokes keep curves when separate outlines have overlapping bounds', () => {
  const first = commitBrushPaint([], {
      brush: brushRing(60, '#0000ff'),
      amount: 0.5,
      merge: true,
      mode: 'normal',
      selected: [],
      at: 0,
      optimize: true,
    }),
    before = structuredClone(first);
  expect(count(first)).toBeLessThan(25);
  const out = commitBrushPaint(first, {
    brush: brushRing(25, '#ff0000'),
    amount: 0.5,
    merge: true,
    mode: 'normal',
    selected: [],
    at: first.length,
    optimize: true,
  });
  expect(out).toHaveLength(2);
  expect(count(out)).toBeLessThan(50);
  for (const s of out) expect(s.contours?.some((r) => r.some((n) => n.in || n.out))).toBe(true);
  expect(first).toEqual(before);
});

const ring = (r: number) => {
  const k = r * 0.5522847498307936;
  return [
    { x: r, y: 0, in: { x: r, y: -k }, out: { x: r, y: k } },
    { x: 0, y: r, in: { x: k, y: r }, out: { x: -k, y: r } },
    { x: -r, y: 0, in: { x: -r, y: k }, out: { x: -r, y: -k } },
    { x: 0, y: -r, in: { x: -k, y: -r }, out: { x: k, y: -r } },
  ];
};
const paint = (color: string, radii: number[]): Vector => ({
  id: color,
  kind: 'polygon',
  x: 150,
  y: 150,
  width: 140,
  height: 140,
  rotation: 0,
  fill: color,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  closed: true,
  fillRule: 'evenodd',
  drawingMode: 'merge',
  contours: radii.map(ring),
  opacity: 0.8,
  pivot: { x: -15, y: 21 },
});
function polygon(source: Vector) {
  const m = matrix(source);
  return {
    ...structuredClone(source),
    contours: worldPaths(source, 0.25).map((r) => {
      const points = [...r];
      while (
        points.length > 1 &&
        points[0].x === points.at(-1)!.x &&
        points[0].y === points.at(-1)!.y
      )
        points.pop();
      return points.map((p) => inversePoint(m, p));
    }),
  };
}
function distance(p: Point, path: Point[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy) || 0),
      );
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}
for (const basis of [undefined, [1, 0.2, 0.3, 1], [-1, 0.2, 0.3, 1]] as const)
  it(`restores separate nested paint with exact prior curves, holes, placement and style ${basis}`, () => {
    const sources = [paint('#0000ff', [70, 45]), paint('#ff0000', [20])];
    if (basis) for (const s of sources) s.transform = [...basis];
    const merged = sources.map(polygon),
      before = structuredClone({ sources, merged }),
      out = restorePaintCurves(merged, sources);
    expect(count(out)).toBe(12);
    for (let i = 0; i < out.length; i++) {
      expect({ ...out[i], contours: undefined }).toEqual({ ...merged[i], contours: undefined });
      const exact = worldPaths(sources[i], 0.001),
        restored = worldPaths(out[i], 0.001);
      expect(restored).toHaveLength(exact.length);
      for (let r = 0; r < exact.length; r++) {
        for (const p of exact[r]) expect(distance(p, restored[r])).toBeLessThan(0.002);
        for (const p of restored[r]) expect(distance(p, exact[r])).toBeLessThan(0.002);
      }
    }
    const m = matrix(out[0]);
    expect(contains(vectorPolygons(out[0]), mapPoint(m, { x: 0, y: 0 }))).toBe(false);
    expect(contains(vectorPolygons(out[0]), mapPoint(m, { x: 55, y: 0 }))).toBe(true);
    expect(contains(vectorPolygons(out[1]), mapPoint(m, { x: 0, y: 0 }))).toBe(true);
    const project = newProject();
    project.layers[0].keys[0].shapes = out;
    validateProject(project);
    expect({ sources, merged }).toEqual(before);
  });
it('keeps shared differently colored boundaries exact without preventing a separate isolated curve recovery', () => {
  const blue = paint('#0000ff', [60]),
    red = { ...paint('#ff0000', [60]), id: 'red', x: 195 },
    far = { ...paint('#00ff00', [40]), id: 'far', x: 650 };
  const touching = mergeVectors([blue, red]),
    flat = polygon(far),
    merged = [...touching, flat],
    before = structuredClone(merged);
  const out = restorePaintCurves(merged, [blue, red, far]);
  expectSharedBoundaryUnchanged(touching, out.slice(0, touching.length));
  expect(count([out.at(-1)!])).toBe(4);
  expect(merged).toEqual(before);
});
it('blocks the unsafe interval beside tiny foreign paint without flattening remote original curves', () => {
  const source = paint('#0000ff', [60]),
    flat = polygon(source),
    r = source.contours![0],
    t = 3 / 32,
    u = 1 - t;
  const controls = [r[0], r[0].out!, r[1].in!, r[1]],
    p = mapPoint(matrix(source), {
      x:
        u ** 3 * controls[0].x +
        3 * u * u * t * controls[1].x +
        3 * u * t * t * controls[2].x +
        t ** 3 * controls[3].x,
      y:
        u ** 3 * controls[0].y +
        3 * u * u * t * controls[1].y +
        3 * u * t * t * controls[2].y +
        t ** 3 * controls[3].y,
    });
  expect(distance(p, worldPaths(flat, 0.25)[0])).toBeGreaterThan(0.01);
  const small: Vector = {
    ...paint('#ff0000', []),
    id: 'neighbour',
    x: p.x - 0.002,
    y: p.y - 0.002,
    width: 0.004,
    height: 0.004,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 0.004, y: 0 },
        { x: 0.004, y: 0.004 },
        { x: 0, y: 0.004 },
      ],
    ],
  };
  expect(contains(vectorPolygons(flat), p)).toBe(false);
  expect(contains(vectorPolygons(small), p)).toBe(true);
  const merged = [flat, small],
    out = restorePaintCurves(merged, [source]);
  expect(out[1]).toEqual(small);
  for (const path of worldPaths(out[0], 0.0001)) expect(distance(p, path)).toBeGreaterThan(0.005);
  const far = out[0].contours![0].find((n) => samePoint(n, source.contours![0][2]));
  expect(far).toBeDefined();
  for (const role of ['in', 'out'] as const)
    expect(samePoint(far![role]!, source.contours![0][2][role]!)).toBe(true);
});
it('retains complete artwork beside an unsupported stroked neighbour', () => {
  const source = paint('#0000ff', [60]),
    flat = polygon(source),
    line: Vector = {
      ...source,
      id: 'line',
      kind: 'path',
      fillEnabled: false,
      strokeWidth: 2,
      contours: undefined,
      closed: false,
      points: [
        { x: -80, y: 0 },
        { x: 80, y: 0 },
      ],
    };
  const merged = [flat, line];
  expect(restorePaintCurves(merged, [source])).toEqual(merged);
});

it('preserves exterior curves when fresh paint actually overlaps differently colored old paint', () => {
  const blue = paint('#0000ff', [60]),
    red = { ...paint('#ff0000', [60]), id: 'red', x: 195 },
    merged = mergeVectors([blue, red]),
    before = structuredClone({ blue, red, merged }),
    out = restorePaintCurves(merged, [blue, red]);
  console.log('Actual overlap curve anchors', count(merged), count(out));
  expect(count(out)).toBeLessThan(count(merged) * 0.5);
  expectSharedBoundaryUnchanged(merged, out);
  for (const s of out) expect(s.contours?.some((r) => r.some((n) => n.in || n.out))).toBe(true);
  const anchor = mapPoint(matrix(blue), blue.contours![0][2]);
  const retained = out
    .flatMap((s) => s.contours!.flat().map((n) => ({ s, n })))
    .find(({ s, n }) => {
      const p = mapPoint(matrix(s), n);
      return Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1e-8;
    });
  expect(retained).toBeDefined();
  for (const role of ['in', 'out'] as const) {
    const expected = mapPoint(matrix(blue), blue.contours![0][2][role]!),
      actual = mapPoint(matrix(retained!.s), retained!.n[role]!);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  }
  expect({ blue, red, merged }).toEqual(before);
});

it('keeps earlier exterior curves through repeated overlapping same-color Brush strokes', () => {
  let shapes: Vector[] = [];
  let original: { point: Point; in: Point; out: Point } | undefined;
  for (let i = 0; i < 4; i++) {
    const ink = brushRing(60, '#0000ff');
    ink.id = `overlap-${i}`;
    ink.x += i * 35;
    const input = structuredClone(shapes),
      out = commitBrushPaint(shapes, {
        brush: ink,
        amount: 0.5,
        merge: true,
        mode: 'normal',
        selected: [],
        at: shapes.length,
        optimize: true,
      });
    const candidates = out.flatMap((s) =>
        s.contours!.flat().map((n) => ({ s, n, point: mapPoint(matrix(s), n) })),
      ),
      left = original
        ? candidates.find((p) => samePoint(p.point, original!.point))!
        : candidates.sort((a, b) => a.point.x - b.point.x)[0];
    expect(left).toBeDefined();
    const current = {
      point: left.point,
      in: mapPoint(matrix(left.s), left.n.in!),
      out: mapPoint(matrix(left.s), left.n.out!),
    };
    if (original)
      for (const role of ['point', 'in', 'out'] as const)
        expect(samePoint(current[role], original[role])).toBe(true);
    else original = current;
    expect(shapes).toEqual(input);
    shapes = out;
  }
});

for (const gap of [0, 0.0001, 0.02])
  it(`preserves remote original handles beside a point contact or near miss (${gap})`, () => {
    const blue = paint('#0000ff', [60]),
      red = { ...paint('#ff0000', [60]), id: 'nearby', x: blue.x + 120 + gap },
      merged = mergeVectors([blue, red]),
      before = structuredClone({ blue, red, merged }),
      out = restorePaintCurves(merged, [blue, red]);
    const original = blue.contours![0][2],
      at = mapPoint(matrix(blue), original),
      retained = out
        .flatMap((s) => s.contours!.flat().map((n) => ({ s, n })))
        .find(({ s, n }) => samePoint(mapPoint(matrix(s), n), at));
    expect(retained).toBeDefined();
    for (const role of ['in', 'out'] as const) {
      expect(retained!.n[role]).toBeDefined();
      expect(
        samePoint(
          mapPoint(matrix(retained!.s), retained!.n[role]!),
          mapPoint(matrix(blue), original[role]!),
        ),
      ).toBe(true);
    }
    expect({ blue, red, merged }).toEqual(before);
  });

it('keeps original curves in a large disconnected paint compound during an unrelated merge', () => {
  const source = paint('#0000ff', []);
  source.contours = Array.from({ length: 80 }, (_, i) =>
    ring(60).map((n) => ({
      x: n.x + i * 150,
      y: n.y,
      in: { x: n.in.x + i * 150, y: n.in.y },
      out: { x: n.out.x + i * 150, y: n.out.y },
    })),
  );
  const flat = polygon(source),
    out = restorePaintCurves([flat], [source]);
  expect(count(out)).toBe(320);
  expect(out[0].contours!.every((r) => r.length === 4 && r.every((n) => n.in && n.out))).toBe(true);
});

it('matches long surviving original spans without exhausting work on every suffix', () => {
  const source = paint('#0000ff', [60000]),
    flat = polygon(source),
    out = restorePaintCurves([flat], [source]);
  expect(count([flat])).toBeGreaterThan(1000);
  expect(count(out)).toBe(4);
});

for (const optimize of [false, true])
  for (const at of [0, 1])
    it(`leaves a disconnected old contact component byte-exact (${optimize}, insertion ${at})`, () => {
      const source = paint('#0000ff', [60]);
      source.contours!.push(
        ring(60).map((n) => ({
          ...n,
          x: n.x + 120,
          in: { x: n.in.x + 120, y: n.in.y },
          out: { x: n.out.x + 120, y: n.out.y },
        })),
      );
      const ink = {
          ...brushRing(0, '#ff0000'),
          id: 'nearby-new-ink',
          x: 200,
          y: 215,
          width: 20,
          height: 0,
          strokeWidth: 8,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
        },
        before = structuredClone(source),
        out = commitBrushPaint([source], {
          brush: ink,
          merge: true,
          mode: 'normal',
          amount: 0.5,
          selected: [],
          at,
          optimize,
        }),
        retained = out.find((s) => s.id === source.id);
      // Only one document unit below the complete old control hull. Existing
      // point contacts inside that component must not trigger a new Boolean.
      expect(retained).toEqual(before);
      expect(retained).not.toBe(source);
      retained!.contours![0][0].x++;
      expect(source).toEqual(before);
    });

it('does not flatten a separate old stroke when another region cannot certify', () => {
  const source = paint('#0000ff', [60]),
    flat = polygon(source),
    contact = { ...paint('#ff0000', [60, 60]), id: 'contact', x: 500 },
    unresolved = polygon(contact),
    out = restorePaintCurves([flat, unresolved], [source, contact]);
  expect(out[1]).toEqual(unresolved);
  expect(count([out[0]])).toBe(4);
});

it('keeps proof-only splits out of old paint beside a disjoint point-contact group', () => {
  const blue = paint('#0000ff', [60]),
    red = paint('#ff0000', [0.5]);
  red.x = 197;
  red.y = 108;
  red.contours!.push(
    ring(0.5).map((n) => ({
      ...n,
      x: n.x + 1,
      in: { x: n.in.x + 1, y: n.in.y },
      out: { x: n.out.x + 1, y: n.out.y },
    })),
  );
  const merged = [polygon(blue), polygon(red)],
    out = restorePaintCurves(merged, [blue, red]);
  expect(count([out[0]])).toBe(4);
  for (const original of blue.contours![0]) {
    const p = mapPoint(matrix(blue), original),
      n = out[0].contours![0].find((n) => samePoint(mapPoint(matrix(out[0]), n), p));
    expect(n).toBeDefined();
    for (const role of ['in', 'out'] as const)
      expect(
        samePoint(mapPoint(matrix(out[0]), n![role]!), mapPoint(matrix(blue), original[role]!)),
      ).toBe(true);
  }
});

for (const basis of [undefined, [1, 0.2, 0.3, 1], [-1, 0.2, 0.3, 1]] as const)
  it(`retains remote original curves within a single point-touching paint compound (${basis})`, () => {
    const source = paint('#0000ff', [60]);
    source.contours!.push(
      ring(60).map((n) => ({
        ...n,
        x: n.x + 120,
        in: { x: n.in.x + 120, y: n.in.y },
        out: { x: n.out.x + 120, y: n.out.y },
      })),
    );
    if (basis) source.transform = [...basis];
    const flat = polygon(source),
      before = structuredClone({ source, flat }),
      out = restorePaintCurves([flat], [source]),
      old = source.contours![0][2],
      at = mapPoint(matrix(source), old),
      retained = out[0].contours!.flat().find((n) => samePoint(mapPoint(matrix(out[0]), n), at));
    expect(retained).toBeDefined();
    for (const role of ['in', 'out'] as const) {
      expect(retained![role]).toBeDefined();
      expect(
        samePoint(mapPoint(matrix(out[0]), retained![role]!), mapPoint(matrix(source), old[role]!)),
      ).toBe(true);
    }
    // The original shared point remains present on BOTH original rings.
    const joint = mapPoint(matrix(source), { x: 60, y: 0 });
    for (const contour of out[0].contours!)
      expect(contour.some((n) => samePoint(mapPoint(matrix(out[0]), n), joint))).toBe(true);
    expect(count(out)).toBeLessThan(count([flat]) / 2);
    expect({ source, flat }).toEqual(before);
  });

it('retains untouched small original cubic handles even when they tessellate to one edge', () => {
  const source = paint('#0000ff', [0.2]),
    flat = polygon(source),
    out = restorePaintCurves([flat], [source]);
  expect(flat.contours![0]).toHaveLength(4);
  expect(out[0].contours![0]).toHaveLength(4);
  for (const original of source.contours![0]) {
    const node = out[0].contours![0].find((n) => samePoint(n, original));
    expect(node).toBeDefined();
    for (const role of ['in', 'out'] as const) {
      expect(node![role]).toBeDefined();
      expect(samePoint(node![role]!, original[role]!)).toBe(true);
    }
  }
});

for (const optimize of [false, true])
  for (const symbol of [false, true])
    for (const gap of [-2, 0.02])
      it(`Brush keeps remote old handles independently of new optimization (${optimize}, symbol ${symbol}, gap ${gap})`, () => {
        const source = paint('#0000ff', [60]),
          ink = {
            ...brushRing(0, '#ff0000'),
            id: 'incoming',
            x: symbol ? 0 : 214 + gap,
            y: symbol ? 0 : 150,
            width: 20,
            height: 8,
            strokeWidth: 8,
            points: [
              { x: symbol ? 214 + gap : 0, y: symbol ? 150 : 0 },
              { x: symbol ? 234 + gap : 20, y: symbol ? 158 : 8 },
            ],
          },
          before = structuredClone({ source, ink }),
          out = commitBrushPaint([source], {
            brush: ink,
            merge: true,
            mode: 'normal',
            amount: 0.5,
            selected: [],
            at: 1,
            optimize,
            symbol,
          }),
          old = source.contours![0][2],
          at = mapPoint(matrix(source), old),
          retained = out
            .flatMap((s) => s.contours!.flat().map((n) => ({ s, n })))
            .find(({ s, n }) => samePoint(mapPoint(matrix(s), n), at));
        expect(retained).toBeDefined();
        for (const role of ['in', 'out'] as const) {
          expect(retained!.n[role]).toBeDefined();
          expect(
            samePoint(
              mapPoint(matrix(retained!.s), retained!.n[role]!),
              mapPoint(matrix(source), old[role]!),
            ),
          ).toBe(true);
        }
        expect({ source, ink }).toEqual(before);
      });

for (const optimize of [false, true])
  for (const symbol of [false, true])
    it(`proof subdivision beside disjoint overlapping hulls never becomes authored vertices (${optimize}, symbol ${symbol})`, () => {
      const source = paint('#0000ff', [60]),
        ink = {
          ...brushRing(0, '#ff0000'),
          id: 'near-corner',
          x: symbol ? 0 : 201,
          y: symbol ? 0 : 99,
          width: 30,
          height: 0,
          strokeWidth: 16,
          points: symbol
            ? [
                { x: 201, y: 99 },
                { x: 231, y: 99 },
              ]
            : [
                { x: 0, y: 0 },
                { x: 30, y: 0 },
              ],
        },
        out = commitBrushPaint([source], {
          brush: ink,
          merge: true,
          mode: 'normal',
          amount: 0,
          selected: [],
          at: 1,
          optimize,
          symbol,
        }),
        old = out.filter((s) => s.fill === source.fill);
      expect(count(old)).toBe(4);
      for (const n of source.contours![0]) {
        const p = mapPoint(matrix(source), n),
          q = old
            .flatMap((s) => s.contours!.flat().map((node) => ({ s, node })))
            .find((v) => samePoint(mapPoint(matrix(v.s), v.node), p));
        expect(q).toBeDefined();
        for (const role of ['in', 'out'] as const) {
          expect(q!.node[role]).toBeDefined();
          expect(
            samePoint(mapPoint(matrix(q!.s), q!.node[role]!), mapPoint(matrix(source), n[role]!)),
          ).toBe(true);
        }
      }
    });

it('checks tiny foreign paint against exterior curve patches even in an existing shared-boundary group', () => {
  const blue = paint('#0000ff', [60]),
    red = { ...paint('#ff0000', [60]), id: 'red', x: 195 },
    flat = polygon(blue),
    ring = blue.contours![0],
    t = 3 / 32,
    u = 1 - t,
    c = [ring[2], ring[2].out!, ring[3].in!, ring[3]],
    p = mapPoint(matrix(blue), {
      x: u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x,
      y: u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y,
    });
  expect(distance(p, worldPaths(flat, 0.001)[0])).toBeGreaterThan(0.01);
  const small: Vector = {
    ...paint('#ffff00', []),
    id: 'obstacle',
    x: p.x - 0.002,
    y: p.y - 0.002,
    width: 0.004,
    height: 0.004,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 0.004, y: 0 },
        { x: 0.004, y: 0.004 },
        { x: 0, y: 0.004 },
      ],
    ],
  };
  const merged = mergeVectors([blue, red, small]),
    out = restorePaintCurves(merged, [blue, red, small]),
    restored = out.filter((s) => s.fill === blue.fill);
  expect(restored.some((s) => s.contours!.flat().some((n) => n.in || n.out))).toBe(true);
  for (const s of restored)
    for (const path of worldPaths(s, 0.0001)) expect(distance(p, path)).toBeGreaterThan(0.005);
  expect(out.filter((s) => s.fill === small.fill)).toEqual(
    merged.filter((s) => s.fill === small.fill),
  );
  expectSharedBoundaryUnchanged(merged, out);
});
