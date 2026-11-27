import { expect, it, vi } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import {
  currentLayerKeys,
  currentLayerPointTracks,
  currentLayerMembers,
  selectCurrentLayers,
  prepareCurrentLayerChange,
} from '../apps/editor/src/cross-layer-selection';
import { multiFrameId } from '../packages/animation/src/multi-frame';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { createLiveMotionSpanSampler } from '../packages/animation/src/live-motion';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { createLiveMovies, liveMovieFixture } from './live-movies-fixture';
import { liveMovieTreesFixture } from './live-movie-trees-fixture';
import { copyCurrentLayers, pasteCurrentLayers } from '../apps/editor/src/cross-layer-clipboard';
import { prepareCurrentLayerGroup } from '../apps/editor/src/cross-layer-group';
const shape = (id = 'same'): Vector => ({
  id,
  kind: 'rectangle',
  x: 20,
  y: 30,
  width: 20,
  height: 20,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture() {
  const p = newProject();
  p.duration = 10;
  p.layers = [newLayer('One'), newLayer('Two'), newLayer('Hidden'), newLayer('Locked')];
  for (const [i, l] of p.layers.entries()) {
    l.id = 'l' + i;
    l.drawingMode = 'object';
    l.keys = [
      { frame: 0, shapes: [shape()] },
      { frame: 8, shapes: [] },
    ];
  }
  p.layers[2].visible = false;
  p.layers[3].locked = true;
  return p;
}
const ids = [multiFrameId('l0', 0, 'same'), multiFrameId('l1', 0, 'same')];
it('admits contained mask members only across their complete held exposure', () => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].locked = false;
  p.layers[3].keys[0].shapes = [{ ...shape(), x: 0, y: 0, width: 60, height: 70 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const selected = [...ids, multiFrameId('l2', 0, 'same')];
  const out = prepareCurrentLayerChange(p, 4, selected, { kind: 'move', x: 5, y: 0 });
  expect(out.layers[2].keys[0].shapes[0].x).toBe(25);
  expect(out.layers[3]).toEqual(p.layers[3]);
  const scaled = prepareCurrentLayerChange(p, 4, selected, {
    kind: 'transform', matrix: [0.5, 0, 0, 0.5, 10, 15],
  });
  expect(scaled.layers[2].keys[0].shapes[0].transform).toEqual([0.5, 0, 0, 0.5]);
  expect(scaled.layerMasks).toEqual(p.layerMasks);
  expect(() => prepareCurrentLayerChange(p, 4, selected, { kind: 'move', x: 30, y: 0 }))
    .toThrow('inside the mask');
  expect(copyCurrentLayers(p, 4, selected).tracks.at(-1)?.maskLayer).toBe('l3');
  p.layers[3].keys.splice(1, 0, { frame: 6, shapes: [] });
  expect(currentLayerKeys(p, 4).map(track => track.layer.id)).toEqual(['l0', 'l1']);
});
it('picks the exact clipped footprint while editing the complete original rectangle', () => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].keys[0].shapes = [{ ...shape(), x: 30, y: 20, width: 15, height: 50 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const id = multiFrameId('l2', 0, 'same'), frame = 4;
  const tracks = currentLayerKeys(p, frame);
  expect(currentLayerPointTracks(tracks, { x: 25, y: 40 }).map(track => track.layer.id)).toEqual(['l0', 'l1']);
  expect(currentLayerPointTracks(tracks, { x: 35, y: 40 }).map(track => track.layer.id)).toEqual(['l0', 'l1', 'l2']);
  expect(selectCurrentLayers(p, frame, [
    { x: 29, y: 29 }, { x: 41, y: 29 }, { x: 41, y: 51 }, { x: 29, y: 51 },
  ], [], 'replace')).toEqual([id]);
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, frame, [id], {
    kind: 'transform', matrix: [2, 0, 0, 1, -1, 0],
  });
  expect(out.layers[2].keys[0].shapes[0]).toEqual({
    ...shape(), x: 39, transform: [2, 0, 0, 1],
  });
  expect(out.layers[3]).toEqual(before.layers[3]);
  expect(() => prepareCurrentLayerChange(p, frame, [...ids, id], { kind: 'move', x: -20, y: 0 }))
    .toThrow('inside the mask');
  expect(copyCurrentLayers(p, frame, [id]).tracks).toEqual([
    { layer: 'l2', maskLayer: 'l3', shapes: [shape()] },
  ]);
  expect(p).toEqual(before);
});

it('resolves a straight polygon mask footprint with a hole and retains authored contours', () => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].keys[0].shapes = [{ ...shape(), x: 30, y: 20, width: 7, height: 50 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const member: Vector = {
    ...shape(), kind: 'polygon', fillRule: 'evenodd',
    contours: [
      [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 20 }],
      [{ x: 11, y: 8 }, { x: 15, y: 8 }, { x: 15, y: 12 }, { x: 11, y: 12 }],
    ],
  };
  p.layers[2].keys[0].shapes = [member];
  const id = multiFrameId('l2', 0, 'same'), frame = 4;
  const tracks = currentLayerKeys(p, frame);
  const pick = (x: number, y: number) =>
    currentLayerPointTracks(tracks, { x, y }).some(track => track.layer.id === 'l2');
  expect(pick(28, 40)).toBe(false);
  expect(pick(34, 40)).toBe(false);
  expect(pick(36, 40)).toBe(true);
  expect(pick(36, 35)).toBe(false);
  expect(selectCurrentLayers(p, frame, [
    { x: 30, y: 35 }, { x: 37, y: 35 }, { x: 37, y: 45 }, { x: 30, y: 45 },
  ], [], 'replace')).toEqual([id]);
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 1, y: 4 });
  expect(out.layers[2].keys[0].shapes).toEqual([{ ...member, x: 21, y: 34 }]);
  expect(out.layers[3]).toEqual(before.layers[3]);
  expect(() => prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 30, y: 0 }))
    .toThrow('inside the mask');
  expect(p).toEqual(before);
  p.layers[3].keys.splice(1, 0, { frame: 6, shapes: [] });
  expect(currentLayerKeys(p, frame).map(track => track.layer.id)).toEqual(['l0', 'l1']);
});

it.each([
  { kind: 'ellipse' as const },
  { kind: 'rectangle' as const, cornerRadius: 10 },
])('uses an interior curved fill witness and keeps the original $kind geometry', (curve) => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].keys[0].shapes = [{ ...shape(), x: 24, y: 20, width: 12, height: 40 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const member = { ...shape(), ...curve, x: 40, transform: [-1, 0, 0, 1] as [number, number, number, number] };
  p.layers[2].keys[0].shapes = [member];
  const id = multiFrameId('l2', 0, 'same'), frame = 4;
  const tracks = currentLayerKeys(p, frame);
  const pick = (x: number, y: number) =>
    currentLayerPointTracks(tracks, { x, y }).some(track => track.layer.id === 'l2');
  expect(pick(25, 31)).toBe(false);
  expect(pick(38, 40)).toBe(false);
  expect(pick(26, 40)).toBe(true);
  expect(selectCurrentLayers(p, frame, [
    { x: 24, y: 30 }, { x: 36, y: 30 }, { x: 36, y: 50 }, { x: 24, y: 50 },
  ], [], 'replace')).toEqual([id]);
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 2, y: 4 });
  expect(out.layers[2].keys[0].shapes).toEqual([{ ...member, x: 42, y: 34 }]);
  expect(() => prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 16, y: 0 }))
    .toThrow('inside the mask');
  expect(p).toEqual(before);
});

it('uses the polygon mask fill and holes for selection and final visibility', () => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].keys[0].shapes = [{
    ...shape(), kind: 'polygon', x: 0, y: 0, width: 100, height: 100, fillRule: 'evenodd',
    contours: [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
      [{ x: 24, y: 35 }, { x: 32, y: 35 }, { x: 32, y: 45 }, { x: 24, y: 45 }],
    ],
  }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const id = multiFrameId('l2', 0, 'same'), frame = 4;
  const tracks = currentLayerKeys(p, frame);
  const pick = (x: number, y: number) =>
    currentLayerPointTracks(tracks, { x, y }).some(track => track.layer.id === 'l2');
  expect(pick(26, 39)).toBe(false);
  expect(pick(35, 39)).toBe(true);
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 30, y: 0 });
  const expected = structuredClone(p);
  expected.layers[2].keys[0].shapes[0].x = 50;
  expect(out).toEqual(expected);
  expect(() => prepareCurrentLayerChange(p, frame, [...ids, id], { kind: 'move', x: 52, y: 0 }))
    .toThrow('inside the mask');
  expect(copyCurrentLayers(p, frame, [id]).tracks[0].maskLayer).toBe('l3');
  expect(p).toEqual(before);
});

it('moves complete visible masked groups while keeping hidden or incomplete units protected', () => {
  const p = fixture(), track = p.layers[2];
  track.visible = true;
  p.layers[3].keys[0].shapes = [{ ...shape(), x: 30, y: 20, width: 20, height: 70 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  track.keys[0].shapes = [
    { ...shape(), groups: ['complete'] },
    { ...shape('peer'), x: 40, y: 55, groups: ['complete'] },
    { ...shape('partial'), x: 35, y: 65, groups: ['incomplete'] },
    { ...shape('clipped'), x: 55, groups: ['incomplete'] },
    { ...shape('hidden'), x: 70 },
  ];
  const id = multiFrameId(track.id, 0, 'same'), frame = 4;
  const tracks = currentLayerKeys(p, frame);
  expect(tracks.find(entry => entry.layer.id === track.id)!.keys[0].shapes.map(s => s.id))
    .toEqual(['same', 'peer']);
  expect(currentLayerPointTracks(tracks, { x: 32, y: 40 })
    .find(entry => entry.layer.id === track.id)!.pointIds).toEqual(new Set(['same']));
  const before = structuredClone(p);
  const expected = structuredClone(p);
  for (const shape of expected.layers[2].keys[0].shapes.slice(0, 2)) shape.x += 3;
  expect(prepareCurrentLayerChange(p, frame, [id], { kind: 'move', x: 3, y: 0 })).toEqual(expected);
  expect(() => prepareCurrentLayerChange(p, frame, [...ids, id], { kind: 'move', x: 11, y: 0 }))
    .toThrow(/inside the mask/);
  expect(() => prepareCurrentLayerChange(p, frame, [multiFrameId(track.id, 0, 'partial')], {
    kind: 'move', x: 3, y: 0,
  })).toThrow(/selection changed/);
  const deleted = structuredClone(p);
  deleted.layers[0].keys[0].shapes.shift();
  deleted.layers[2].keys[0].shapes.splice(0, 2);
  expect(prepareCurrentLayerChange(p, frame, [ids[0], id], { kind: 'delete' })).toEqual(deleted);
  for (const protectedId of [multiFrameId(track.id, 0, 'partial'), multiFrameId('l3', 0, 'same')])
    expect(() => prepareCurrentLayerChange(p, frame, [ids[0], id, protectedId], { kind: 'delete' }))
      .toThrow(/selection changed/);
  expect(p).toEqual(before);
});

it('preserves mask groups while admitting ordinary source and destination tracks', async () => {
  const p = fixture();
  p.layers[2].visible = true;
  p.layers[3].locked = false;
  p.layers[3].keys[0].shapes[0].cornerRadius = 2;
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: ['l2'] }];
  const before = structuredClone(p);
  const moved = prepareCurrentLayerChange(p, 4, ids, { kind: 'move', x: 10, y: 0 });
  expect(moved.layers[0].keys[0].shapes[0].x).toBe(30);
  expect(moved.layers.slice(2)).toEqual(before.layers.slice(2));
  expect(moved.layerMasks).toEqual(before.layerMasks);
  const clip = copyCurrentLayers(p, 4, ids);
  for (const layer of ['l2', 'l3']) {
    const protectedId = multiFrameId(layer, 0, 'same');
    expect(() => prepareCurrentLayerChange(p, 4, [ids[0], protectedId], { kind: 'delete' }))
      .toThrow('Original cross-layer selection changed');
    expect(() => prepareCurrentLayerGroup(p, 4, ids, { kind: 'group', layer, groups: [] }))
      .toThrow('outside mask groups');
    await expect(pasteCurrentLayers(p, 4, { ...clip, tracks: [{ ...clip.tracks[0], layer }] }, true, { rebuild: vi.fn() }))
      .rejects.toThrow('mask groups');
  }
  expect(p).toEqual(before);
});
it('selects both original visible unlocked layers without aliasing equal shape IDs', () => {
  const p = fixture();
  expect(currentLayerKeys(p, 4).map((t) => t.layer.id)).toEqual(['l0', 'l1']);
  expect(
    selectCurrentLayers(
      p,
      4,
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 70 },
        { x: 0, y: 70 },
      ],
      [],
      'replace',
    ),
  ).toEqual(ids);
  expect(currentLayerMembers(p, 4, ids)).toHaveLength(2);
});
it('moves both held exposures atomically, preserving keys, protected layers and source', () => {
  const p = fixture(),
    before = structuredClone(p),
    out = prepareCurrentLayerChange(p, 4, ids, { kind: 'move', x: 10, y: -5 });
  for (const l of out.layers.slice(0, 2)) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(l.keys[0].shapes[0]).toEqual({ ...shape(), x: 30, y: 25 });
  }
  expect(out.layers.slice(2)).toEqual(p.layers.slice(2));
  expect(p).toEqual(before);
});
it('expands only complete groups on each original track', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes = [
    { ...shape('a'), groups: ['g'] },
    { ...shape('b'), x: 80, groups: ['g'] },
  ];
  const out = prepareCurrentLayerChange(p, 0, [multiFrameId('l0', 0, 'a')], {
    kind: 'move',
    x: 5,
    y: 0,
  });
  expect(out.layers[0].keys[0].shapes.map((s) => s.x)).toEqual([25, 85]);
  expect(out.layers[1]).toEqual(p.layers[1]);
});
it('deletes complete selected groups without adding restoration or blank keys', () => {
  const p = fixture(),
    out = prepareCurrentLayerChange(p, 4, ids, { kind: 'delete' });
  expect(out.layers.slice(0, 2).map((l) => l.keys)).toEqual([
    [
      { frame: 0, shapes: [] },
      { frame: 8, shapes: [] },
    ],
    [
      { frame: 0, shapes: [] },
      { frame: 8, shapes: [] },
    ],
  ]);
});
for (const request of [
  { kind: 'move', x: Infinity, y: 0 },
  { kind: 'transform', matrix: [1, 0, 0, 0, 0, 0] },
  { kind: 'move', x: 1e8, y: 0 },
] as const)
  it('rejects numeric/overflow failure without changing any track', () => {
    const p = fixture();
    const before = structuredClone(p);
    expect(() => prepareCurrentLayerChange(p, 4, ids, request as never)).toThrow();
    expect(p).toEqual(before);
  });
it('rejects stale, protected and duplicate original picks', () => {
  const p = fixture();
  for (const chosen of [
    [multiFrameId('l2', 0, 'same')],
    [ids[0], ids[0]],
    [multiFrameId('l0', 4, 'same')],
  ])
    expect(() => prepareCurrentLayerChange(p, 4, chosen, { kind: 'delete' })).toThrow();
});
it('later unsupported merge ownership rejects earlier valid tracks atomically', () => {
  const p = fixture();
  p.layers[1].drawingMode = 'merge';
  const before = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 4, ids, { kind: 'move', x: 10, y: 0 })).toThrow(
    /merged paint/,
  );
  expect(p).toEqual(before);
});
it('validates raw original values before reading source accessors', () => {
  const p = fixture(),
    get = vi.fn(() => 20);
  Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', { enumerable: true, get });
  expect(() => prepareCurrentLayerChange(p, 4, ids, { kind: 'delete' })).toThrow();
  expect(get).not.toHaveBeenCalled();
});
it('ordinary current-frame selection does not inherit the multi-frame 10000-shape cap', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes = Array.from({ length: 10001 }, (_, i) => shape('s' + i));
  expect(currentLayerMembers(p, 4, [multiFrameId('l0', 0, 's10000')])).toHaveLength(1);
  expect(
    prepareCurrentLayerChange(p, 4, [multiFrameId('l0', 0, 's10000')], {
      kind: 'move',
      x: 1,
      y: 0,
    }).layers[0].keys[0].shapes.at(-1)!.x,
  ).toBe(21);
});
for (const kind of ['move', 'delete'] as const)
  it(`preserves unselected aliased layer/key/shape storage during ${kind}`, () => {
    const p = fixture();
    p.layers[1].keys = p.layers[0].keys;
    const before = structuredClone(p),
      out = prepareCurrentLayerChange(
        p,
        4,
        [ids[0]],
        kind === 'move' ? { kind, x: 5, y: 0 } : { kind },
      );
    expect(out.layers[1]).toEqual(before.layers[1]);
    expect(p).toEqual(before);
    expect(out.layers[0].keys[0].shapes).toHaveLength(kind === 'move' ? 1 : 0);
    if (kind === 'move') expect(out.layers[0].keys[0].shapes[0].x).toBe(25);
  });
it('rechecks actual original source after completed cloning without writing a track', () => {
  const p = fixture(),
    before = structuredClone(p),
    clone = structuredClone;
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value);
    if (value === p) p.background = '#ffff00';
    return out;
  }) as typeof structuredClone);
  try {
    expect(() => prepareCurrentLayerChange(p, 4, ids, { kind: 'move', x: 1, y: 0 })).toThrow(
      /changed/,
    );
    expect(p.layers).toEqual(before.layers);
    expect(p.background).toBe('#ffff00');
  } finally {
    spy.mockRestore();
  }
});
it('moves a shared authored live endpoint while retaining both sparse recipes', () => {
  const p = fixture(), layer = p.layers[1];
  layer.keys.splice(1, 0, { frame: 4, shapes: [{ ...shape(), x: 60 }] });
  layer.keys[2].shapes = [{ ...shape(), x: 100 }];
  layer.liveMotionSpans = [
    { id: 'left', start: 0, end: 4, ease: 'linear' },
    { id: 'right', start: 4, end: 8, ease: 'linear' },
  ];
  const before = structuredClone(p);
  const selection = [ids[0], multiFrameId('l1', 4, 'same')];
  const out = prepareCurrentLayerChange(p, 4, selection, { kind: 'move', x: 10, y: 0 });
  const expected = structuredClone(before);
  expected.layers[0].keys[0].shapes[0].x = 30;
  expected.layers[1].keys[1].shapes[0].x = 70;
  expect(out).toEqual(expected);
  for (const [i, at, x] of [[0, 2, 45], [1, 6, 85]]) {
    const sampler = createLiveMotionSpanSampler(out, layer.id, layer.liveMotionSpans[i]);
    try {
      expect(sampler.sample(at)[0].x).toBe(x);
    } finally { sampler.dispose(); }
  }
  expect(() => prepareCurrentLayerChange(p, 5, selection, { kind: 'move', x: 10, y: 0 }))
    .toThrow(/tween/);
  expect(() => copyCurrentLayers(p, 4, selection)).toThrow(/tween/);
  expect(() => prepareCurrentLayerChange(p, 4, selection, { kind: 'delete' })).toThrow(/tween/);
  expect(p).toEqual(before);

  layer.keys[2].shapes[0].kind = 'ellipse';
  const incompatible = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 4, selection, { kind: 'move', x: 10, y: 0 }))
    .toThrow(/motion|interpolation/i);
  expect(p).toEqual(incompatible);
});

it('qualifies both live recipes before transforming a shared endpoint across layers', () => {
  const p = fixture(), layer = p.layers[1];
  layer.keys.splice(1, 0, { frame: 4, shapes: [{ ...shape(), x: 60 }] });
  layer.keys[2].shapes = [{ ...shape(), x: 100 }];
  const left = { id: 'left', start: 0, end: 4, ease: 'linear' as const, options: { affine: true } };
  const right = { id: 'right', start: 4, end: 8, ease: 'linear' as const };
  layer.liveMotionSpans = [left, right];
  const selection = [ids[0], multiFrameId('l1', 4, 'same')];
  const scale = { kind: 'transform' as const, matrix: [2, 0, 0, 1.5, 0, 0] as [number, number, number, number, number, number] };
  const restricted = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 4, selection, scale)).toThrow(/enabled motion properties/);
  expect(p).toEqual(restricted);

  layer.liveMotionSpans[1] = { ...right, options: { affine: true } };
  const before = structuredClone(p);
  const expected = structuredClone(p);
  Object.assign(expected.layers[0].keys[0].shapes[0], { x: 40, y: 45, transform: [2, 0, 0, 1.5] });
  Object.assign(expected.layers[1].keys[1].shapes[0], { x: 120, y: 45, transform: [2, 0, 0, 1.5] });
  const out = prepareCurrentLayerChange(p, 4, selection, scale);
  expect(out).toEqual(expected);
  for (const [index, sampleAt, x] of [[0, 2, 70], [1, 6, 110]]) {
    const sampler = createLiveMotionSpanSampler(out, layer.id, out.layers[1].liveMotionSpans![index]);
    try {
      expect(sampler.sample(sampleAt)[0]).toMatchObject({ x, y: 37.5, transform: [1.5, 0, 0, 1.25] });
    } finally { sampler.dispose(); }
  }
  expect(() => prepareCurrentLayerChange(p, 4, selection, {
    kind: 'transform', matrix: [-1, 0, 0, 1, 0, 0],
  })).toThrow(/reflect|sign|singular/i);
  expect(p).toEqual(before);
});

it('moves a live movie endpoint without changing the independent clock plan', () => {
  const source = liveMovieFixture(1), p = createLiveMovies(source.p, source.span);
  const ordinary = newLayer('Ordinary');
  ordinary.drawingMode = 'object';
  ordinary.keys[0].shapes = [shape()];
  p.layers.push(ordinary);
  const selection = [multiFrameId('track', 2, 'instance'), multiFrameId(ordinary.id, 0, 'same')];
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, 2, selection, { kind: 'move', x: 15, y: 10 });
  const expected = structuredClone(p);
  Object.assign(expected.layers[0].keys[1].shapes[0], { x: 35, y: 40 });
  Object.assign(expected.layers[1].keys[0].shapes[0], { x: 35, y: 40 });
  expect(out).toEqual(expected);
  expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
  expect(p).toEqual(before);
  expect(() => prepareCurrentLayerChange(p, 3, selection, { kind: 'move', x: 15, y: 10 }))
    .toThrow(/tween/);
  expect(() => prepareCurrentLayerChange(p, 2, selection, {
    kind: 'transform', matrix: [1, 0, 0, 1, 15, 10],
  })).toThrow(/tween/);
  expect(() => copyCurrentLayers(p, 2, selection)).toThrow(/tween/);
  expect(p).toEqual(before);

  p.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  const incompatible = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 2, selection, { kind: 'move', x: 15, y: 10 }))
    .toThrow(/button/);
  expect(p).toEqual(incompatible);
});

it('translates an authored nested live endpoint and preserves descendant clock topology', () => {
  const p = liveMovieTreesFixture('reflected', 'loop');
  const ordinary = newLayer('Ordinary');
  ordinary.drawingMode = 'object';
  ordinary.keys[0].shapes = [shape()];
  p.layers.push(ordinary);
  const selection = [multiFrameId('track', 2, 'instance'), multiFrameId(ordinary.id, 0, 'same')];
  const before = structuredClone(p);
  const out = prepareCurrentLayerChange(p, 2, selection, { kind: 'move', x: 15, y: 10 });
  const expected = structuredClone(p);
  Object.assign(expected.layers[0].keys[1].shapes[0], { x: 175, y: 110 });
  Object.assign(expected.layers[1].keys[0].shapes[0], { x: 35, y: 40 });
  expect(out).toEqual(expected);
  const clock = compileMovieClockPlan(out);
  expect(clock).toEqual(compileMovieClockPlan(p));
  expect(clock.definitions.graphic.layers[0].keys.some(key => !key.shapes.length)).toBe(true);
  expect(() => prepareCurrentLayerChange(p, 2, selection, {
    kind: 'transform', matrix: [2, 0, 0, 1, 0, 0],
  })).toThrow(/tween/);
  expect(p).toEqual(before);

  const leaf = p.symbols!.find(symbol => symbol.id === 'leaf')!;
  leaf.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  const incompatible = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 2, selection, { kind: 'move', x: 15, y: 10 }))
    .toThrow(/button/);
  expect(p).toEqual(incompatible);
});

it('moves an authored remembered junction and rebuilds both owned interiors atomically', () => {
  const p = fixture(), layer = p.layers[1];
  layer.keys.splice(1, 0, { frame: 4, shapes: [{ ...shape(), x: 60 }] });
  layer.keys[2].shapes = [{ ...shape(), x: 100 }];
  createBasicMotionSpan(p, [layer.id], 0, 4, 'linear');
  createBasicMotionSpan(p, [layer.id], 4, 8, 'linear', { affine: true });
  const before = structuredClone(p);
  const selection = [ids[0], multiFrameId('l1', 4, 'same')];
  const out = prepareCurrentLayerChange(p, 4, selection, { kind: 'move', x: 20, y: 0 });
  const keys = out.layers[1].keys;
  expect(keys.map(k => k.shapes[0].x)).toEqual([20, 35, 50, 65, 80, 85, 90, 95, 100]);
  expect(keys[0]).toEqual(layer.keys[0]);
  expect(keys[8]).toEqual(layer.keys[8]);
  expect(out.layers[0].keys[0].shapes[0].x).toBe(40);
  for (const [i, span] of out.layers[1].motionSpans!.entries()) {
    expect(span).toEqual({
      ...layer.motionSpans![i],
      baseline: JSON.stringify(keys.filter(k => k.frame > span.start && k.frame < span.end)),
    });
  }
  expect(p).toEqual(before);
  expect(() => copyCurrentLayers(p, 4, selection)).toThrow(/tween/);
  layer.keys[6].shapes[0].x++;
  const incompatible = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 4, selection, { kind: 'move', x: 20, y: 0 }))
    .toThrow(/Generated keys changed/);
  expect(p).toEqual(incompatible);
});

it('regenerates both remembered spans after a qualified shared-endpoint scale', () => {
  const p = fixture(), layer = p.layers[1];
  layer.keys.splice(1, 0, { frame: 4, shapes: [{ ...shape(), x: 60 }] });
  layer.keys[2].shapes = [{ ...shape(), x: 100 }];
  createBasicMotionSpan(p, [layer.id], 0, 4, 'linear', { affine: true });
  createBasicMotionSpan(p, [layer.id], 4, 8, 'linear');
  const selection = [ids[0], multiFrameId('l1', 4, 'same')];
  const scale = { kind: 'transform' as const, matrix: [2, 0, 0, 1.5, 0, 0] as [number, number, number, number, number, number] };
  const restricted = structuredClone(p);
  expect(() => prepareCurrentLayerChange(p, 4, selection, scale)).toThrow(/enabled motion properties/);
  expect(p).toEqual(restricted);

  layer.motionSpans![1].options = { affine: true };
  const original = structuredClone(p);
  const result = prepareCurrentLayerChange(p, 4, selection, scale);
  const keys = result.layers[1].keys;
  expect(keys.map(key => key.shapes[0].x)).toEqual([20, 45, 70, 95, 120, 115, 110, 105, 100]);
  for (const frame of [2, 6])
    expect(keys[frame].shapes[0]).toMatchObject({ y: 37.5, transform: [1.5, 0, 0, 1.25] });
  expect(keys[0]).toEqual(layer.keys[0]);
  expect(keys[8]).toEqual(layer.keys[8]);
  expect(result.layers[0].keys[0].shapes[0]).toMatchObject({ x: 40, y: 45, transform: [2, 0, 0, 1.5] });
  expect(p).toEqual(original);
  expect(() => prepareCurrentLayerChange(p, 4, selection, {
    kind: 'transform', matrix: [-1, 0, 0, 1, 0, 0],
  })).toThrow(/reflect|sign|singular/i);
  expect(p).toEqual(original);
});

it('later selected tween-owned keys reject every track without enabling options', () => {
  const p = fixture();
  p.layers[1].keys[1].shapes = [{ ...shape(), x: 80 }];
  createBasicMotionSpan(p, ['l1'], 0, 8, 'linear', { affine: true });
  const before = structuredClone(p);
  expect(() =>
    prepareCurrentLayerChange(p, 4, [ids[0], multiFrameId('l1', 4, 'same')], {
      kind: 'move',
      x: 1,
      y: 0,
    }),
  ).toThrow(/tween/);
  expect(p).toEqual(before);
});
it('retains original own-undefined paint and pivot metadata on detached prepared artwork', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].gradient = undefined;
  p.layers[1].keys[0].shapes[0].pivot = undefined;
  const out = prepareCurrentLayerChange(p, 4, ids, { kind: 'move', x: 1, y: 0 });
  expect(Object.hasOwn(out.layers[0].keys[0].shapes[0], 'gradient')).toBe(true);
  expect(Object.hasOwn(out.layers[1].keys[0].shapes[0], 'pivot')).toBe(true);
  expect(p.layers[0].keys[0].shapes[0].x).toBe(20);
});
