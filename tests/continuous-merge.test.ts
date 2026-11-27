import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { joinRecoloredFills } from '../packages/geometry/src/join-recolored-fills';
import { hit, worldPoint } from '../packages/geometry/src';
import { mergeVectors } from '../packages/geometry/src/merge';
import { pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import { clipPaint, splitPaintSelection } from '../packages/geometry/src/clip-paint';
import { checkPaintEdgeProvenance } from '../packages/geometry/src/paint-edge-provenance';
import { diagonalScribble, pencilWave, sampledStar, starCorners, verticalWave } from './crosshatched-paint-fixture';

const vector: Vector = {
  id: 'paint',
  kind: 'brush',
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  rotation: 0,
  strokeWidth: 40,
  fill: '#1888ff',
  stroke: '#271144',
  points: [],
};
const draw = (shapes: Vector[], points: Point[], fill = vector.fill, size = 40) =>
  prepareBrushPaint(shapes, {
    brush: { ...vector, fill, points, strokeWidth: size },
    mode: 'normal',
    amount: 1,
    optimize: true,
    selected: [],
    at: shapes.length,
    merge: true,
    removeCoveredStrokes: true,
  }).shapes;
const pencil = (shapes: Vector[], coords: number[][]) =>
  preparePencilDrawing(shapes, {
    stroke: {
      ...vector,
      kind: 'path',
      fillEnabled: false,
      strokeWidth: 2,
      points: coords.map(([x, y]) => ({ x, y })),
    },
    mode: 'ink',
    merge: true,
    optimize: false,
  });
const fillFaces = (art: Vector[]) => art.filter((s) => s.fillEnabled !== false);
const strip = () =>
  draw(
    [],
    [
      { x: 40, y: 130 },
      { x: 95, y: 120 },
      { x: 170, y: 135 },
      { x: 235, y: 120 },
    ],
    vector.fill,
    80,
  );

it.each(['ink', 'smooth'] as const)(
  'cuts Brush paint on consecutive densely crossing Pencil sweeps (%s)',
  (mode) => {
    let art = draw([], verticalWave, vector.fill, 20);
    for (let pass = 0; pass < 5; pass++) {
      const points = pencilWave.map((p) => ({
        x: pass % 2 ? 395 - p.x : p.x,
        y: p.y + pass * 9.5,
      }));
      const before = fillFaces(art);
      const cut = preparePencilDrawing(art, {
        stroke: { ...vector, kind: 'path', fillEnabled: false, strokeWidth: 2, points },
        mode,
        optimize: mode === 'smooth',
        merge: true,
      });
      expect(cut.retainedOverlap, `pass ${pass + 1}`).toBeUndefined();
      expect(fillFaces(cut.shapes).length).toBeGreaterThan(before.length + 15);
      art = cut.shapes;
    }
  },
);

it.each(['ink', 'smooth', 'sparse'] as const)(
  'splits the faces of a many-pointed Pencil star across curved paint (%s)',
  (mode) => {
    const original = strip();
    const points = mode === 'sparse' ? starCorners : sampledStar;
    const cut = preparePencilDrawing(original, {
      stroke: { ...vector, kind: 'path', fillEnabled: false, strokeWidth: 2, points },
      mode: mode === 'sparse' ? 'smooth' : mode,
      optimize: mode !== 'ink',
      merge: true,
    });
    expect(cut.retainedOverlap).toBeUndefined();
    expect(fillFaces(cut.shapes).length).toBeGreaterThan(100);
    const faces = fillFaces(cut.shapes);
    checkPaintEdgeProvenance([...original, cut.shape], faces);
    // All of these probes are in the central band of the original Brush.
    // Every bit of paint must belong to exactly one face after the cut.
    for (let x = 33.379; x < 235; x += 5)
      for (let y = 112.713; y < 139; y += 4) {
        const p = { x, y };
        expect(hit(original[0], p, 0)).toBe(true);
        expect(faces.filter((s) => hit(s, p, 0))).toHaveLength(1);
      }
  },
);

it.each([
  [107, 6],
  [120, 4],
])('marquee at x=%s keeps both halves of an ellipse cubic', (x, cubics) => {
  const source: Vector = {
    ...vector,
    id: 'fill',
    kind: 'ellipse',
    x: 30,
    y: 40,
    width: 180,
    height: 100,
    strokeWidth: 0,
    drawingMode: 'merge',
  };
  const clip = {
    eligible: [source.id],
    preserveStrokes: true,
    polygon: [
      { x: 3, y: 5 },
      { x, y: 5 },
      { x, y: 180 },
      { x: 3, y: 180 },
    ],
  };
  const { inside, artwork: outside, counts } = splitPaintSelection([source], clip);
  expect(counts).toEqual([1]);
  const pieces = [inside, outside];
  expect(pieces.map((s) => s.length)).toEqual([1, 1]);
  const commands = pieces.flat().flatMap((s) => pathCommands(s));
  expect(commands.filter((c) => c[0] === 'C')).toHaveLength(cubics);
  expect(pieces.flat().reduce((n, s) => n + s.contours![0].length, 0)).toBe(cubics + 2);
  expect(inside[0].id).not.toEqual(outside[0].id);
});

it('keeps a marquee hole and the original curves through a second cut', () => {
  const source: Vector = {
    ...vector,
    kind: 'ellipse',
    x: 30,
    y: 40,
    width: 180,
    height: 100,
    strokeWidth: 0,
  };
  const hole = [
    { x: 90, y: 70 },
    { x: 150, y: 70 },
    { x: 150, y: 110 },
    { x: 90, y: 110 },
  ];
  const [ring] = clipPaint([source], {
    eligible: [source.id],
    preserveStrokes: true,
    polygon: hole,
    keep: 'outside',
  });
  expect(ring.contours).toHaveLength(2);
  const { inside, artwork: outside } = splitPaintSelection([ring], {
    eligible: [ring.id],
    preserveStrokes: true,
    polygon: [
      { x: 0, y: 0 },
      { x: 115, y: 0 },
      { x: 115, y: 200 },
      { x: 0, y: 200 },
    ],
  });
  expect(inside).toHaveLength(1);
  expect(outside).toHaveLength(1);
  for (const face of [...inside, ...outside]) expect(hit(face, { x: 112, y: 85 }, 0)).toBe(false);
  expect(hit(inside[0], { x: 70, y: 90 }, 0)).toBe(true);
  expect(hit(outside[0], { x: 175, y: 90 }, 0)).toBe(true);
  expect([...inside, ...outside].flatMap(pathCommands).filter((c) => c[0] === 'C')).toHaveLength(6);
});

it('shares retraced Pencil ink once and leaves the uncovered ink editable in its original color', () => {
  const first = pencil(strip(), [[25,125],[225,125]]);
  const stroke: Vector = { ...vector, id:'green', kind:'path', stroke:'#00aa55', fillEnabled:false, strokeWidth:2,
    points:[{x:160,y:40},{x:160,y:125},{x:95,y:125},{x:95,y:200}] };
  const cut = preparePencilDrawing(first.shapes, { stroke, mode:'ink', merge:true });
  expect(cut.retainedOverlap).toBeUndefined();
  const colorsAt = (x: number) => cut.shapes.filter(s=>s.strokeWidth && hit(s,{x,y:125},0)).map(s=>s.stroke);
  expect(colorsAt(60)).toEqual([vector.stroke]);
  expect(colorsAt(129)).toEqual([stroke.stroke]);
  expect(colorsAt(200)).toEqual([vector.stroke]);
  expect(fillFaces(cut.shapes)).toHaveLength(2);
});

it('Bucket authors the four original cubic spans inside an elliptical ink outline', () => {
  const outline: Vector = {
    ...vector,
    kind: 'ellipse',
    x: 45,
    y: 70,
    width: 130,
    height: 80,
    strokeWidth: 2,
    fillEnabled: false,
  };
  const [filled] = mergeVectors([outline], {
    paint: { ...vector, strokeWidth: 0 },
    point: { x: 110, y: 110 },
    gap: 0,
  });
  expect(filled.contours?.[0]).toHaveLength(4);
  const controls = pathCommands(outline).flatMap((c) =>
    c[0] === 'C'
      ? [worldPoint(outline, { x: c[1], y: c[2] }), worldPoint(outline, { x: c[3], y: c[4] })]
      : [],
  );
  expect(controls).toHaveLength(8);
  const saved = filled.contours![0].flatMap((n) =>
    [n.in, n.out].flatMap((p) => (p ? [worldPoint(filled, p)] : [])),
  );
  for (const p of controls)
    expect(saved.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-10)).toBe(true);
});

it('retained Pencil ink divides new Brush paint and follows its original cubic centerline', () => {
  const ink = preparePencilDrawing([], {
    stroke: {
      ...vector,
      id: 'pencil',
      kind: 'path',
      fillEnabled: false,
      strokeWidth: 2,
      points: Array.from({ length: 51 }, (_, i) => ({
        x: 30 + i * 5,
        y: 110 + 35 * Math.sin(i / 12),
      })),
    },
    mode: 'smooth',
    optimize: true,
    merge: true,
  }).shapes[0];
  expect(ink.kind).toBe('bezier');
  const result = prepareBrushPaint([ink], {
    brush: {
      ...vector,
      points: [
        { x: 155, y: 65 },
        { x: 150, y: 185 },
      ],
    },
    merge: true,
    mode: 'normal',
    removeCoveredStrokes: false,
    amount: 1,
    optimize: true,
    at: 1,
    selected: [],
  });
  expect(result.retainedOverlap).toBeUndefined();
  const lines = result.shapes.filter((s) => s.fillEnabled === false);
  expect(fillFaces(result.shapes)).toHaveLength(2);
  // The kept line divides the new paint and stays one line, exactly as drawn.
  expect(lines).toHaveLength(1);
  expect(lines.every((s) => s.kind === 'bezier' && s.nodes?.some((n) => n.in || n.out))).toBe(true);
  const [expected] = worldPaths(ink, 0.001),
    actual = lines.map((s) => worldPaths(s, 0.001)[0]);
  const distance = (p: Point, paths: Point[][]) =>
    Math.min(
      ...paths.flatMap((path) =>
        path.slice(1).map((b, i) => {
          const a = path[i],
            dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
          );
          return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
        }),
      ),
    );
  for (const p of expected) expect(distance(p, actual)).toBeLessThan(0.002);
  for (const p of actual.flat()) expect(distance(p, [expected])).toBeLessThan(0.002);
});

it('two successive Pencil strokes that meet inside Brush paint complete one cut', () => {
  const original = strip();
  const first = pencil(original, [
    [120, 30],
    [130, 130],
  ]);
  expect(fillFaces(first.shapes)).toHaveLength(1);
  const second = pencil(first.shapes, [
    [130, 130],
    [141, 220],
  ]);
  expect(fillFaces(second.shapes)).toHaveLength(2);
  expect(second.retainedOverlap).toBeUndefined();
  expect(fillFaces(second.shapes).filter((s) => hit(s, { x: 80, y: 120 }, 0))).toHaveLength(1);
  expect(fillFaces(second.shapes).find((s) => hit(s, { x: 80, y: 120 }, 0))?.id).not.toBe(
    fillFaces(second.shapes).find((s) => hit(s, { x: 190, y: 120 }, 0))?.id,
  );
});

it('follows earlier connected Pencil segments beyond the bounds of the finishing stroke', () => {
  let art = strip();
  for (const segment of [
    [
      [110, 20],
      [118, 111],
    ],
    [
      [118, 111],
      [137, 137],
    ],
    [
      [137, 137],
      [145, 220],
    ],
  ])
    art = pencil(art, segment).shapes;
  expect(fillFaces(art)).toHaveLength(2);
  for (const p of [
    { x: 65, y: 129 },
    { x: 195, y: 129 },
  ])
    expect(fillFaces(art).filter((s) => hit(s, p, 0))).toHaveLength(1);
});

it('a self-crossing Pencil makes independently editable paint regions without faceting the Brush', () => {
  const original = strip();
  const result = pencil(original, [
    [60, 60],
    [195, 161],
    [60, 158],
    [195, 61],
  ]);
  expect(result.retainedOverlap).toBeUndefined();
  expect(fillFaces(result.shapes).length).toBeGreaterThanOrEqual(3);
  const savedHandles = (s: Vector) =>
    (s.contours ?? []).flatMap((r) =>
      r.flatMap((n) => [n.in, n.out].flatMap((p) => (p ? [worldPoint(s, p)] : []))),
    );
  const old = savedHandles(original[0]).filter((p) => p.x < 50 || p.x > 211);
  expect(old.length).toBeGreaterThan(2);
  const actual = fillFaces(result.shapes).flatMap(savedHandles);
  for (const p of old)
    expect(actual.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-10)).toBe(true);
});

it('recoloring a compound Brush crossing joins all contacting sections of the other color', () => {
  const bottom = draw([], verticalWave, vector.fill, 9);
  const topColor = '#ee5577';
  const crossed = draw(bottom, diagonalScribble, topColor, 9);
  const top = crossed.find((s) => s.fill === topColor)!;
  expect(crossed.length).toBeGreaterThan(9);
  const joined = joinRecoloredFills(
    crossed.map((s) => (s === top ? { ...s, fill: vector.fill } : s)),
    [top.id],
  );
  expect(joined).toHaveLength(1);
  // Count both directions of each original edge in document space. Only
  // the exterior occurs once. Every internal seam must disappear in full.
  const edges = (s: Vector) =>
    s.contours!.flatMap((r) =>
      r.map((a, i) => {
        const b = r[(i + 1) % r.length];
        const controls = [a, a.out ?? a, b.in ?? b, b].map((p) => {
          const { x, y } = worldPoint(s, p);
          return [x.toFixed(8), y.toFixed(8)].join(',');
        });
        return [controls.join(':'), controls.reverse().join(':')].sort()[0];
      }),
    );
  const occurrences = new Map<string, number>();
  for (const edge of crossed.flatMap(edges))
    occurrences.set(edge, (occurrences.get(edge) ?? 0) + 1);
  expect(Math.max(...occurrences.values())).toBe(2);
  expect(edges(joined[0]).sort()).toEqual(
    [...occurrences]
      .filter(([, n]) => n === 1)
      .map(([edge]) => edge)
      .sort(),
  );
  const cutAgain = pencil(joined, [
    [-5, 94],
    [395, 99],
  ]);
  expect(cutAgain.retainedOverlap).toBeUndefined();
  expect(fillFaces(cutAgain.shapes).length).toBeGreaterThan(2);
});
