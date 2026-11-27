import { expect, it, vi } from 'vitest';
import {
  newProject,
  newLayer,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Vector,
} from '../packages/document/src';
import { prepareAutomaticTimelineTween as convert } from '../apps/editor/src/timeline-tween-automatic';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { expandSymbols, symbolInstance } from '../packages/geometry/src/symbols';
import { matrix, transformVectors, around } from '../packages/geometry/src/affine';
import { prepareTimelineTween } from '../apps/editor/src/timeline-tween';
import { worldPaths } from '../packages/geometry/src/drawing';
import { prepareSymbolScene, finishSymbolScene } from '../apps/editor/src/symbol-scene-scope';
import { prepareTimelineFrameInsertion } from '../apps/editor/src/timeline-keyframe';

function fixture(end = true): Project {
  const p = newProject();
  p.duration = 12;
  p.fps = 4;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    ...(end
      ? [
          { frame: 8, shapes: [{ ...structuredClone(art), x: 100, y: 70 }] },
          { frame: 10, shapes: [] },
        ]
      : []),
  ];
  return p;
}
function geometry(p: Project, frame: number) {
  const layer = p.layers[0],
    span = layer.liveMotionSpans![0],
    sampler = createMotionFrameSampler(p, layer.id, span);
  try {
    return expandSymbols(p, sampler.sample(frame), frame);
  } finally {
    sampler.dispose();
  }
}
it('opens a motion tween on a static symbol and builds editable keys only after explicit insertion', () => {
  const scene = fixture();
  const art = scene.layers[0].keys[0].shapes[0];
  const definition = { id: 'clip', name: 'Clip', width: 100, height: 80, shapes: [art] };
  scene.symbols = [definition];
  const { project, original } = prepareSymbolScene(scene, definition)!;
  const open = convert(project, '@base', 0, 'motion', undefined, undefined, definition.id);
  expect(open.layers[0].keys).toEqual([{ frame: 0, shapes: [art], openMotionTween: { affine: true, ease: 'linear' } }]);
  expect(open.duration).toBe(1);
  expect(finishSymbolScene(definition, original, open)).toEqual({
    ...definition, openMotionTween: { affine: true, ease: 'linear' },
  });
  const result = prepareTimelineFrameInsertion(open, '@base', 3, 'key', undefined, definition.id);
  const authored = finishSymbolScene(definition, original, result);
  expect(project).toEqual(original);
  expect(result.symbols).toEqual(scene.symbols);
  expect(authored.shapes).toEqual([art]);
  expect(authored.timeline?.keys.map(key => key.frame)).toEqual([1, 2, 3]);
  expect(authored.timeline?.keys.at(-1)).toEqual({ frame: 3, shapes: [art] });
  for (const key of authored.timeline!.keys) samePoints(key.shapes, [art]);
  expect(authored.timeline?.motionSpans).toEqual([
    expect.objectContaining({ start: 0, end: 3, autoRefresh: true }),
  ]);
  expect(convert(result, '@base', 1, 'motion', undefined, undefined, definition.id)).toEqual(result);
});
it('rejects a symbol tween whose generated artwork would exceed the aggregate budget', () => {
  const scene = fixture();
  const art = scene.layers[0].keys[0].shapes[0];
  const definition = {
    id: 'clip', name: 'Clip', width: 100, height: 80,
    shapes: Array.from({ length: 11 }, (_, index) => ({ ...art, id: `art-${index}` })),
    timeline: { duration: 10000, keys: [] },
  };
  scene.symbols = [definition];
  const { project, original } = prepareSymbolScene(scene, definition)!;
  const open = convert(project, '@base', 0, 'motion', undefined, undefined, definition.id);
  expect(() => prepareTimelineFrameInsertion(open, '@base', 9999, 'key', undefined, definition.id))
    .toThrow('symbol artwork budget');
  expect(project).toEqual(original);
});
function points(shapes: Vector[]) {
  return shapes.flatMap((s) => worldPaths(s, 0.01).flat());
}
function samePoints(a: Vector[], b: Vector[]) {
  const x = points(a),
    y = points(b);
  expect(y).toHaveLength(x.length);
  x.forEach((p, i) => {
    expect(y[i].x).toBeCloseTo(p.x, 8);
    expect(y[i].y).toBeCloseTo(p.y, 8);
  });
}
for (const mode of ['object', 'merge'] as const)
  it(`automatically wraps ${mode} artwork in one shared symbol with exact endpoint/world motion and detached source`, () => {
    const p = fixture();
    p.layers[0].drawingMode = mode;
    const before = structuredClone(p);
    const q = convert(p, p.layers[0].id, 4, 'motion');
    const keys = q.layers[0].keys,
      a = keys[0].shapes[0],
      b = keys[1].shapes[0];
    expect(p).toEqual(before);
    expect(q.symbols).toHaveLength(1);
    expect(a.kind).toBe('symbol');
    expect(a.symbolPlayback).toEqual({ mode: 'loop', firstFrame: 0 });
    expect(b.symbolPlayback).toEqual(a.symbolPlayback);
    expect(b.symbolId).toBe(a.symbolId);
    expect(b.id).toBe(a.id);
    expect(q.libraryLinks).toHaveLength(1);
    expect(q.layers[0].drawingMode).toBe('object');
    expect(keys[2]).toEqual(p.layers[0].keys[2]);
    samePoints(p.layers[0].keys[0].shapes, geometry(q, 0));
    samePoints(p.layers[0].keys[1].shapes, geometry(q, 8));
    expect(matrix(geometry(q, 4)[0]).slice(4)).toEqual([60, 50]);
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    q.symbols![0].shapes[0].fill = '#0000ff';
    expect(p).toEqual(before);
  });
for (const kind of ['motion', 'shape'] as const)
  it(`converts a held exposure to ${kind} while retaining duration, settings and other layers`, () => {
    const p = fixture(false);
    p.layers.push(newLayer('Other'));
    p.layers[0].outline = true;
    const q = convert(p, p.layers[0].id, 4, kind);
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual(kind === 'motion' ? [0] : [0, 11]);
    expect(q.duration).toBe(12);
    expect(q.layers[1]).toEqual(p.layers[1]);
    expect(q.layers[0].outline).toBe(true);
    if (kind === 'shape') {
      samePoints(p.layers[0].keys[0].shapes, geometry(q, 11));
      expect(q.symbols).toEqual(p.symbols);
      expect(q.layers[0].keys[0]).toEqual(p.layers[0].keys[0]);
      expect(q.layers[0].liveMotionSpans![0].options?.nodes).toBe(true);
    } else {
      expect(q.layers[0].liveMotionSpans).toBeUndefined();
      samePoints(p.layers[0].keys[0].shapes, expandSymbols(q, q.layers[0].keys[0].shapes, 11));
      expect(convert(q, q.layers[0].id, 4, 'motion')).toEqual(q);
    }
  });
for (const kind of ['motion', 'shape'] as const)
  it(`applies the ${kind} duration policy in a one-frame project`, () => {
    const p = fixture(false);
    p.duration = 1;
    p.fps = 24;
    const q = convert(p, p.layers[0].id, 0, kind);
    expect(q.duration).toBe(kind === 'motion' ? 1 : 24);
    expect(q.layers[0].keys.map((k) => k.frame)).toEqual(kind === 'motion' ? [0] : [0, 23]);
    expect(p.duration).toBe(1);
  });
it('leaves a selected held range open without adding start or end keys', () => {
  const p = fixture(false);
  p.layers[0].keys.push({ frame: 10, shapes: [] });
  const q = convert(p, p.layers[0].id, 4, 'motion', { start: 3, end: 8 });
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 10]);
  expect(q.layers[0].keys[0].openMotionTween).toEqual({ affine: true, ease: 'linear' });
  expect(q.layers[0].keys.at(-1)).toEqual(p.layers[0].keys.at(-1));
  expect(q.layers[0].liveMotionSpans).toBeUndefined();
});
it('stops at the frame before a blank key without replacing it', () => {
  const p = fixture(false);
  p.layers[0].keys.push({ frame: 9, shapes: [] });
  const q = convert(p, p.layers[0].id, 4, 'motion');
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 9]);
  expect(q.layers[0].keys.at(-1)).toEqual(p.layers[0].keys.at(-1));
});
for (const reflected of [false, true])
  it(`wraps a complete affine ${reflected ? 'reflected' : 'rotated/skewed'} group without changing either endpoint paint/geometry`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes;
    a[0].groups = ['outer', 'inner'];
    a.push({
      ...structuredClone(a[0]),
      id: 'other',
      kind: 'ellipse',
      x: 100,
      y: 40,
      groups: ['outer'],
      fill: '#0000ff',
    });
    if (reflected) transformVectors(a, around({ x: 30, y: 60 }, -1, 0, 0, 1));
    const end = structuredClone(a);
    transformVectors(end, around({ x: 30, y: 60 }, 0.8, 0.2, 0.3, 1.2));
    p.layers[0].keys[1].shapes = end;
    const q = convert(p, p.layers[0].id, 4, 'motion');
    expect(q.layers[0].keys[0].shapes).toHaveLength(1);
    expect(q.symbols![0].shapes).toHaveLength(2);
    samePoints(a, geometry(q, 0));
    samePoints(end, geometry(q, 8));
  });
for (const mode of ['single', 'loop', 'once', 'movie'] as const)
  it(`reuses an existing ${mode} symbol and authors its matching endpoint with the correct clock`, () => {
    const p = fixture(false),
      def = {
        id: 'def',
        name: 'Existing',
        width: 40,
        height: 40,
        shapes: p.layers[0].keys[0].shapes,
        timeline: { duration: 4, keys: [] },
      };
    p.symbols = [def];
    const instance = symbolInstance(def, 20, 30);
    instance.symbolPlayback = { mode, firstFrame: 1 };
    p.layers[0].keys[0].shapes = [instance];
    const open = convert(p, p.layers[0].id, 0, 'motion');
    expect(open.symbols).toEqual(p.symbols);
    expect(open.layers[0].keys[0].shapes).toEqual(p.layers[0].keys[0].shapes);
    expect(open.layers[0].keys).toHaveLength(1);
    const q = prepareTimelineFrameInsertion(open, p.layers[0].id, 11, 'key');
    expect(q.layers[0].keys[1].shapes[0]).toMatchObject({
      id: instance.id,
      symbolId: 'def',
      symbolPlayback: {
        mode,
        firstFrame: mode === 'single' || mode === 'movie' ? 1 : mode === 'once' ? 3 : 0,
      },
    });
  });
it('repeated conversion of an existing automatic tween is an exact history-free candidate', () => {
  const p = fixture(),
    q = convert(p, p.layers[0].id, 3, 'motion');
  expect(convert(q, q.layers[0].id, 3, 'motion')).toEqual(q);
});
it('reuses a static symbol with implicit default playback without changing its Library definition', () => {
  const p = fixture(false),
    def = {
      id: 'static',
      name: 'Static',
      width: 40,
      height: 40,
      shapes: p.layers[0].keys[0].shapes,
    };
  p.symbols = [def];
  p.layers[0].keys[0].shapes = [symbolInstance(def, 20, 30)];
  const q = convert(p, p.layers[0].id, 0, 'motion');
  expect(q.symbols).toEqual(p.symbols);
  expect(q.layers[0].keys[0].shapes).toEqual(p.layers[0].keys[0].shapes);
});
it('keeps mixed Pencil/Brush/compound artwork and hole/handle/pressure metadata inside the new symbol', () => {
  const p = fixture(false),
    base = p.layers[0].keys[0].shapes[0];
  p.layers[0].keys[0].shapes = [
    {
      ...base,
      kind: 'bezier',
      strokeWidth: 2,
      fillEnabled: false,
      nodes: [
        { x: 0, y: 0, out: { x: 10, y: 20 } },
        { x: 40, y: 0, in: { x: 30, y: 20 } },
      ],
    },
    {
      ...base,
      id: 'brush',
      kind: 'brush',
      strokeWidth: 8,
      brush: { pressure: true, minimum: 0.1, aspect: 1, angle: 0, tilt: false },
      points: [
        { x: 0, y: 0, pressure: 0.3 },
        { x: 15, y: 20, pressure: 0.7 },
        { x: 40, y: 0, pressure: 0.5 },
      ],
    },
    {
      ...base,
      id: 'paint',
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
        [
          { x: 10, y: 10 },
          { x: 10, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 10 },
        ],
      ],
    },
  ];
  const q = convert(p, p.layers[0].id, 0, 'motion');
  expect(q.symbols![0].shapes).toHaveLength(3);
  samePoints(p.layers[0].keys[0].shapes, expandSymbols(q, q.layers[0].keys[0].shapes, 11));
  expect(q.symbols![0].shapes[1].points).toEqual(p.layers[0].keys[0].shapes[1].points);
  expect(q.symbols![0].shapes[2].contours).toEqual(p.layers[0].keys[0].shapes[2].contours);
});
it('shape conversion retains editable vector endpoints and interpolates geometry and paint', () => {
  const p = fixture();
  Object.assign(p.layers[0].keys[1].shapes[0], { width: 80, height: 60, fill: '#0000ff' });
  const q = convert(p, p.layers[0].id, 3, 'shape');
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  expect(geometry(q, 4)[0]).toMatchObject({ width: 60, height: 50, fill: '#800080' });
});
it('retains existing false/omitted affine and paint admission when upgrading a raw live motion recipe', () => {
  const p = fixture(),
    q = prepareTimelineTween(p, p.layers[0].id, {
      start: 0,
      end: 8,
      kind: 'motion',
      affine: false,
      createEndpoints: true,
      ease: 'linear',
    });
  delete q.layers[0].liveMotionSpans![0].options!.affine;
  q.layers[0].liveMotionSpans![0].options!.paint = false;
  const result = convert(q, q.layers[0].id, 3, 'motion');
  expect(result.layers[0].liveMotionSpans![0].options).toMatchObject({
    affine: false,
    paint: false,
  });
  expect(result.layers[0].liveMotionSpans![0].id).toBe(q.layers[0].liveMotionSpans![0].id);
});
it('rejects a new symbol at the original aggregate artwork budget without touching source or keys', () => {
  const p = fixture(),
    art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'full',
      name: 'Full',
      width: 40,
      height: 40,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...art, id: 'budget' + i })),
    },
  ];
  expect(() => convert(p, p.layers[0].id, 0, 'motion')).toThrow(/budget/i);
  expect(p.symbols).toHaveLength(1);
  expect(p.symbols[0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  expect(p.layers[0].liveMotionSpans).toBeUndefined();
}, 60000);
for (const target of ['project', 'held', 'symbol'] as const)
  it(`rejects a changed ${target} clone before publishing automatic artwork`, () => {
    const p = fixture(target === 'symbol'),
      native = globalThis.structuredClone,
      before = native(p);
    let hit = 0;
    const hook = vi
      .spyOn(globalThis, 'structuredClone')
      .mockImplementation(<T>(value: T, options?: StructuredSerializeOptions): T => {
        const out = native(value, options),
          project = out as Project,
          key = out as { frame?: number; shapes?: Vector[] },
          shape = out as Vector;
        if (!hit) {
          if (target === 'project' && project?.layers) {
            hit++;
            project.name = 'Changed clone';
          }
          if (target === 'held' && key?.frame === 0 && key.shapes?.length) {
            hit++;
            key.shapes[0].x += 10;
          }
          if (target === 'symbol' && shape?.kind === 'symbol') {
            hit++;
            shape.width += 1;
          }
        }
        return out;
      });
    try {
      expect(() => target === 'held'
        ? prepareTimelineTween(p, p.layers[0].id, {
          start: 0, end: 11, kind: 'motion', ease: 'linear', affine: true, createEndpoints: true, symbolize: true,
        })
        : convert(p, p.layers[0].id, 0, 'motion')).toThrow();
      expect(hit).toBe(1);
      expect(p).toEqual(before);
    } finally {
      hook.mockRestore();
    }
  });
it('rejects changed artwork from the document converter JSON clone', () => {
  const p = fixture(false),
    before = structuredClone(p),
    native = JSON.parse;
  let hit = 0;
  const hook = vi
    .spyOn(JSON, 'parse')
    .mockImplementation((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
      const out = native(text, reviver);
      if (!hit && Array.isArray(out) && out[0]?.kind === 'rectangle') {
        hit++;
        out[0].fill = '#0000ff';
      }
      return out;
    });
  try {
    expect(() => convert(p, p.layers[0].id, 0, 'motion')).toThrow();
    expect(hit).toBe(1);
    expect(p).toEqual(before);
  } finally {
    hook.mockRestore();
  }
});
it('keeps valid omitted/undefined optional paint and handle fields compatible with document cloning', () => {
  const p = fixture(false),
    art = p.layers[0].keys[0].shapes[0];
  art.gradient = undefined;
  art.transform = undefined;
  art.pivot = undefined;
  const q = convert(p, p.layers[0].id, 0, 'motion');
  samePoints([art], expandSymbols(q, q.layers[0].keys[0].shapes, 0));
  expect(q.symbols).toHaveLength(1);
});

for (const degrees of [90, 180])
  it(`keeps a ${degrees}-degree turn in the rotation channel instead of collapsing its affine basis`, () => {
    const p = fixture();
    p.layers[0].keys[1].shapes = structuredClone(p.layers[0].keys[0].shapes);
    p.layers[0].keys[1].shapes[0].rotation = degrees;
    const q = convert(p, p.layers[0].id, 0, 'motion');
    samePoints(p.layers[0].keys[1].shapes, geometry(q, 8));
    const m = matrix(geometry(q, 4)[0]);
    expect((Math.atan2(m[1], m[0]) * 180) / Math.PI).toBeCloseTo(
      degrees === 180 ? -90 : degrees / 2,
      8,
    );
  });
it('preserves the determinant guard on a reflection that would collapse between endpoints', () => {
  const p = fixture();
  transformVectors(p.layers[0].keys[1].shapes, around({ x: 0, y: 0 }, -1, 0, 0, 1));
  const before = structuredClone(p);
  expect(() => convert(p, p.layers[0].id, 0, 'motion')).toThrow();
  expect(p).toEqual(before);
});
it('accepts editable merged-paint shape tween endpoints without making a symbol', () => {
  const p = fixture(false);
  p.layers[0].drawingMode = 'merge';
  const q = convert(p, p.layers[0].id, 0, 'shape');
  expect(q.symbols).toEqual(p.symbols);
  samePoints(p.layers[0].keys[0].shapes, geometry(q, 11));
});
for (const failure of [
  'paint',
  'geometry',
  'independent',
  'locked',
  'hidden',
  'interior',
  'budget',
  'NaN',
] as const)
  it(`rejects ${failure} without source/library changes or partial endpoint creation`, () => {
    const p = fixture();
    if (failure === 'paint') p.layers[0].keys[1].shapes[0].fill = '#0000ff';
    if (failure === 'geometry') p.layers[0].keys[1].shapes[0].width = 80;
    if (failure === 'independent') {
      p.layers[0].keys[0].shapes.push({
        ...structuredClone(p.layers[0].keys[0].shapes[0]),
        id: 'b',
      });
      p.layers[0].keys[1].shapes.push({
        ...structuredClone(p.layers[0].keys[0].shapes[1]),
        x: 300,
      });
    }
    if (failure === 'locked') p.layers[0].locked = true;
    if (failure === 'hidden') p.layers[0].visible = false;
    if (failure === 'interior')
      p.layers[0].keys.splice(1, 0, {
        frame: 4,
        shapes: structuredClone(p.layers[0].keys[0].shapes),
      });
    if (failure === 'budget')
      p.symbols = Array.from({ length: 128 }, (_, i) => ({
        id: 'def' + i,
        name: 'Def' + i,
        width: 40,
        height: 40,
        shapes: [],
      }));
    const before = structuredClone(p);
    expect(() =>
      convert(
        p,
        p.layers[0].id,
        failure === 'NaN' ? NaN : 3,
        'motion',
        failure === 'interior' ? { start: 0, end: 8 } : undefined,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  });
for (const action of ['source', 'range', 'reentry', 'async'] as const)
  it(`rejects late ${action} admission and preserves independent edits`, () => {
    const p = fixture(),
      range = { start: 0, end: 8 };
    let hit = false;
    expect(() =>
      convert(p, p.layers[0].id, 0, 'motion', range, () => {
        if (hit) return;
        hit = true;
        if (action === 'source') p.name = 'User edit';
        if (action === 'range') range.end = 7;
        if (action === 'reentry')
          try {
            convert(p, p.layers[0].id, 0, 'motion');
          } catch {}
        if (action === 'async') return Promise.resolve();
      }),
    ).toThrow();
    expect(p.symbols ?? []).toEqual([]);
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    if (action === 'source') expect(p.name).toBe('User edit');
  });
