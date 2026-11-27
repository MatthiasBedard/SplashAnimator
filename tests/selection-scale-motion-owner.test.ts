import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Project,
  type Point,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  promoteSampledMotionFrame,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledUnitRequest,
} from '../packages/animation/src/selection-motion-owner';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import * as document from '../packages/document/src';
import * as junction from '../packages/animation/src/motion-junction';
import * as motion from '../packages/animation/src/motion-spans';
afterEach(() => vi.restoreAllMocks());
function ink(id: string, x: number, y: number, groups?: string[]): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 12,
    rotation: 0,
    pivot: { x: 3, y: 4 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  };
}
function fixture(mode = 'plain'): GroupAuthoringSource {
  const project = newProject();
  project.duration = 14;
  project.width = 500;
  project.height = 300;
  for (const [i, id] of ['base', 'extra'].entries()) {
    const y = i ? 110 : 10,
      shapes = [
        ink('r', 0, y),
        ink('b', 20, y, ['outer', 'inner']),
        ink('a', 40, y, ['outer', 'inner']),
        ink('c', 60, y, ['outer']),
        ink('other', 100, y),
        ink('d', 130, y, ['second']),
        ink('e', 150, y, ['second']),
      ];
    if (mode === 'absent' || mode === 'defaults') for (const s of shapes) delete s.pivot;
    if (mode === 'affine' || mode === 'reflected' || mode === 'common-reflected')
      for (const s of shapes) {
        s.rotation = 25;
        s.transform = [mode === 'affine' ? 1.3 : -1.3, 0.2, 0.4, 0.8];
      }
    if (['compound', 'aligned', 'asymmetric'].includes(mode))
      for (const s of shapes) {
        s.kind = 'polygon';
        s.closed = true;
        s.fillRule = 'evenodd';
        s.contours = [
          [
            [0, 0],
            [12, 0],
            [12, 12],
            [0, 12],
          ],
          [
            [3, 3],
            [3, 6],
            [6, 3],
          ],
        ].map((r) => r.map(([x, y]) => ({ x, y })));
        if (mode === 'asymmetric' && s.id === 'r')
          s.contours[0] = [
            { x: -8, y: -3 },
            { x: 20, y: -3 },
            { x: 20, y: 13 },
            { x: -8, y: 13 },
          ];
      }
    if (mode === 'asymmetric')
      for (const s of shapes) {
        if (s.id === 'e') {
          s.width = 57;
          s.height = 27;
        }
        if (s.id === 'c') s.height = 41;
        if (s.id === 'r') {
          s.width = 28;
          s.height = 16;
        } else
          s.contours![0] = [
            { x: 0, y: 0 },
            { x: s.width, y: 0 },
            { x: s.width, y: s.height },
            { x: 0, y: s.height },
          ];
      }
    if (['loop', 'once', 'single', 'movie', 'nested-button'].includes(mode)) {
      project.symbols ??= [
        {
          id: 'child',
          name: 'Child',
          width: 12,
          height: 12,
          shapes: [ink('kid', 0, 0)],
          timeline: {
            duration: 3,
            keys: [{ frame: 2, shapes: [{ ...ink('kid', 0, 0), fill: '#0000ff' }] }],
          },
        },
      ];
      shapes[3] = {
        ...shapes[3],
        kind: 'symbol',
        symbolId: 'child',
        symbolPlayback: { mode: mode as 'loop' | 'once' | 'single' | 'movie', firstFrame: 1 },
      };
      if (mode === 'nested-button') {
        const button = {
            ...project.symbols![0],
            id: 'button',
            buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
          },
          container = {
            id: 'container',
            name: 'Container',
            width: 12,
            height: 12,
            shapes: [
              {
                ...ink('button-instance', 0, 0),
                kind: 'symbol' as const,
                symbolId: 'button',
                symbolPlayback: { mode: 'single' as const, firstFrame: 0 },
              },
            ],
          };
        project.symbols = [button, container];
        shapes[3] = {
          ...shapes[3],
          symbolId: 'container',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
        };
      }
    }
    const end = shapes.map((s) => ({ ...structuredClone(s), x: s.x + (i ? 100 : 80) }));
    if (mode === 'aligned')
      for (const s of end)
        s.contours = [...s.contours!].reverse().map((r) => [r[1], r[0], ...r.slice(2).reverse()]);
    if (mode.startsWith('common'))
      for (const s of [...shapes, ...end]) {
        const [a, b, c, d] = basis(s),
          det = a * d - b * c,
          x = 17 - s.x,
          y = -23 - s.y;
        s.pivot = { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
      }
    const layer = {
      id,
      name: id,
      visible: true,
      locked: false,
      drawingMode: 'object' as const,
      keys: [
        { frame: 0, shapes },
        { frame: i ? 10 : 8, shapes: end },
        { frame: 12, shapes: [] },
      ],
    };
    if (i === 0) project.layers = [layer];
    else project.layers.push(layer);
    const rotation =
      mode === 'aligned'
        ? undefined
        : {
            direction: (mode === 'clockwise' || mode === 'counterclockwise' ? mode : 'shortest') as
              'clockwise' | 'counterclockwise' | 'shortest',
            turns: mode === 'clockwise' || mode === 'counterclockwise' ? 1 : 0,
            rigidGroups: true,
            axisGroupScale: true,
            axisGroupShear: true,
            ...(mode === 'orbit' ? { savedGroupPivots: true } : {}),
          };
    createBasicMotionSpan(
      project,
      [id],
      0,
      i ? 10 : 8,
      'linear',
      {
        affine: true,
        ...(mode === 'aligned' ? { nodes: true } : {}),
        ...(mode.startsWith('common') ? { pivots: true } : {}),
        ...(mode === 'defaults' ? { pivots: true, defaultPivots: true } : {}),
      },
      undefined,
      rotation,
      mode === 'aligned' ? { order: [1, 0], start: [1, 1], reverse: [true, true] } : undefined,
    );
  }
  validateProject(project);
  return { project, revision: 2, frame: 4 };
}
function basis(s: Vector) {
  const r = (s.rotation * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r),
    [a, b, u, d] = s.transform ?? [1, 0, 0, 1];
  return [c * a - n * b, n * a + c * b, c * u - n * d, n * u + c * d];
}
function world(s: Vector, p: Point) {
  const [a, b, c, d] = basis(s);
  return { x: s.x + a * p.x + c * p.y, y: s.y + b * p.x + d * p.y };
}
function scale(p: Point, center: Point, sx: number, sy: number) {
  return { x: center.x + sx * (p.x - center.x), y: center.y + sy * (p.y - center.y) };
}
function metadata(s: Vector) {
  return Object.fromEntries(
    Object.entries(s).filter(([key]) => !['x', 'y', 'rotation', 'transform'].includes(key)),
  );
}
function headers(p: Project) {
  return p.layers.map((l) =>
    l.motionSpans?.map(({ baseline: _baseline, id: _id, ...span }) => span),
  );
}
const pick = (layerId: string, shapeId: string) => ({ layerId, shapeId });
const mixed = [pick('extra', 'c'), pick('base', 'e'), pick('base', 'a'), pick('base', 'r')];
function comparable(p: Project) {
  return {
    ...p,
    layers: p.layers.map((l) => ({
      ...l,
      motionSpans: l.motionSpans?.map((s) => ({ ...s, id: 'span' })),
    })),
  };
}
function expectedPivot(shapes: Vector[], mode: string) {
  if (mode.startsWith('common')) return { x: 17, y: -23 };
  const points = shapes.flatMap((s) =>
    [
      { x: 0, y: 0 },
      { x: s.width, y: 0 },
      { x: 0, y: s.height },
      { x: s.width, y: s.height },
    ].map((p) => world(s, p)),
  );
  return {
    x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
    y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
  };
}

function directedFixture(direction: string) {
  const state = fixture(direction);
  state.project.duration = 24;
  state.frame = 2;
  for (const layer of state.project.layers) {
    const end = layer.id === 'base' ? 8 : 10,
      span = layer.motionSpans![0];
    layer.keys = layer.keys
      .filter((k) => [0, end, 12].includes(k.frame))
      .map((k) => ({ ...k, frame: k.frame === end ? end * 2 : k.frame === 12 ? 22 : 0 }));
    delete layer.motionSpans;
    createBasicMotionSpan(
      state.project,
      [layer.id],
      0,
      end * 2,
      'linear',
      span.options,
      undefined,
      span.rotation,
    );
  }
  return state;
}
for (const mode of [
  'plain',
  'absent',
  'defaults',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'asymmetric',
  'common',
  'common-reflected',
  'loop',
  'once',
  'single',
  'movie',
  'nested-button',
  'orbit',
])
  for (const [sx, sy] of [
    [1.5, 0.75],
    [1.25, 1.25],
    [2, 1],
    [1, 1.2],
  ])
    it(
      'prepares private complete-union scaling with saved/default semantics ' +
        mode +
        ' ' +
        sx +
        ',' +
        sy,
      () => {
        const state = fixture(mode),
          before = structuredClone(state),
          cap = captureRememberedSelectionAuthoringFrame(() => state),
          owner = cap.resolveScale(mixed),
          scene = cap.scene;
        expect(owner.units.map((u) => [u.layerId, u.kind, u.shapeId, u.shapeIds])).toEqual([
          ['base', 'root', 'r', ['r']],
          ['base', 'group', 'b', ['b', 'a', 'c']],
          ['base', 'group', 'd', ['d', 'e']],
          ['extra', 'group', 'b', ['b', 'a', 'c']],
        ]);
        const originals = owner.tracks.flatMap((t) =>
            scene
              .find((l) => l.layerId === t.layerId)!
              .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
          ),
          pivot = expectedPivot(originals, mode);
        expect(owner.pivot.x).toBeCloseTo(pivot.x, 9);
        expect(owner.pivot.y).toBeCloseTo(pivot.y, 9);
        const candidate = cap.prepareScale(mixed, sx, sy),
          promoted = structuredClone(state.project);
        for (const t of owner.tracks)
          promoteSampledMotionFrame(promoted, [t.layerId], t.start, t.end, 4);
        const saved = headers(promoted),
          expected = structuredClone(promoted);
        junction.scaleRememberedEndpoint(expected, 4, owner.tracks, sx, sy, owner.pivot);
        expect(comparable(candidate)).toEqual(comparable(expected));
        expect(headers(candidate)).toEqual(saved);
        for (const t of owner.tracks) {
          const old = state.project.layers.find((l) => l.id === t.layerId)!,
            next = candidate.layers.find((l) => l.id === t.layerId)!,
            sample = scene.find((l) => l.layerId === t.layerId)!.key.shapes;
          expect(next.keys.filter((k) => [0, t.end, 12].includes(k.frame))).toEqual(
            old.keys.filter((k) => [0, t.end, 12].includes(k.frame)),
          );
          expect(next.motionSpans![0].id).toBe(old.motionSpans![0].id);
          for (const shape of sample) {
            const got = next.keys
              .find((k) => k.frame === 4)!
              .shapes.find((s) => s.id === shape.id)!;
            if (!t.shapeIds.includes(shape.id)) {
              expect(got).toEqual(shape);
              continue;
            }
            expect(metadata(got)).toEqual(metadata(shape));
            const m = basis(shape),
              n = basis(got);
            expect(n[0]).toBeCloseTo(sx * m[0], 10);
            expect(n[1]).toBeCloseTo(sy * m[1], 10);
            expect(n[2]).toBeCloseTo(sx * m[2], 10);
            expect(n[3]).toBeCloseTo(sy * m[3], 10);
            if (sx === 1) {
              expect(n[0]).toBe(m[0]);
              expect(n[2]).toBe(m[2]);
              expect(got.x).toBe(shape.x);
            }
            if (sy === 1) {
              expect(n[1]).toBe(m[1]);
              expect(n[3]).toBe(m[3]);
              expect(got.y).toBe(shape.y);
            }
            for (const point of [
              { x: 0, y: 0 },
              { x: 7, y: 11 },
              ...(shape.contours ?? []).flat(),
            ]) {
              const wanted = scale(world(shape, point), pivot, sx, sy),
                actual = world(got, point);
              expect(actual.x).toBeCloseTo(wanted.x, 8);
              expect(actual.y).toBeCloseTo(wanted.y, 8);
            }
          }
        }
        validateProject(candidate);
        expect(state).toEqual(before);
        cap.dispose();
      },
    );
for (const requests of [
  [pick('base', 'r')],
  [pick('base', 'a')],
  [pick('base', 'r'), pick('base', 'other')],
  [pick('base', 'c'), pick('base', 'e')],
  [pick('base', 'r'), pick('extra', 'r')],
  [pick('base', 'a'), pick('extra', 'c')],
  mixed,
])
  it('resolves distinct original scaling selections ' + JSON.stringify(requests), () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      owner = cap.resolveScale(requests),
      out = cap.prepareScale(requests, 1.5, 0.75);
    expect(owner.tracks.length).toBe(new Set(requests.map((r) => r.layerId)).size);
    expect(out).not.toEqual(state.project);
    expect(cap.resolveSelection(requests).tracks).toEqual(owner.tracks);
  });
for (const [sx, sy] of [
  [NaN, 1],
  [Infinity, 1],
  [-Infinity, 1],
  [0, 1],
  [1, 0],
  [1, 1],
  [Number.MIN_VALUE, 1],
  [1, Number.MIN_VALUE],
  [Number.MAX_VALUE, 1],
  [1, Number.MAX_VALUE],
  [new Number(2), 1],
  ['2', 1],
  [undefined, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
])
  it(
    'rejects invalid/unsupported scale factors without source/history writes ' + sx + ',' + sy,
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state);
      expect(() => cap.prepareScale(mixed, sx as number, sy as number)).toThrow();
      expect(state).toEqual(before);
      expect(cap.prepareScale(mixed, 1.5, 0.75)).toBeDefined();
    },
  );
for (const requests of [
  null,
  {},
  [],
  [pick('absent', 'r')],
  [pick('base', 'absent')],
  [pick('base', 'a'), pick('base', 'c')],
  [pick('base', 'r'), pick('base', 'r')],
  [{ layerId: new String('base'), shapeId: 'r' }],
])
  it(
    'rejects missing/malformed/overlapping original scaling picks ' + JSON.stringify(requests),
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state);
      expect(() => cap.prepareScale(requests as SampledUnitRequest[], 1.5, 0.75)).toThrow();
      expect(state).toEqual(before);
    },
  );
it('keeps private scale ownership independent of public scenes, pivots, choices and outputs', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveScale(mixed),
    pivot = { ...owner.pivot };
  owner.pivot.x = 999;
  owner.tracks[0].shapeIds = ['other'];
  owner.units[0].shapeIds = ['other'];
  cap.scene[0].key.shapes[0].x = 999;
  cap.choices[0].shapeId = 'other';
  const out = cap.prepareScale(mixed, 1.5, 0.75),
    fresh = cap.resolveScale(mixed);
  expect(fresh.pivot).toEqual(pivot);
  expect(fresh.tracks[0].shapeIds).toContain('r');
  out.layers[0].keys[4].shapes[0].x = 999;
  expect(cap.prepareScale(mixed, 1.5, 0.75).layers[0].keys[4].shapes[0].x).not.toBe(999);
  expect(state).toEqual(before);
});
for (const mode of [
  'project',
  'revision',
  'frame',
  'membership',
  'library',
  'lock',
  'recipe',
  'interior',
  'numeric',
])
  it('rejects stale scale original ownership ' + mode, () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    cap.resolveScale(mixed);
    if (mode === 'project') state.project = structuredClone(state.project);
    if (mode === 'revision') state.revision++;
    if (mode === 'frame') state.frame++;
    if (mode === 'membership') state.project.layers[1].keys[0].shapes[1].groups = ['changed'];
    if (mode === 'library')
      state.project.symbols = [{ id: 'new', name: 'New', width: 1, height: 1, shapes: [] }];
    if (mode === 'lock') state.project.layers[1].locked = true;
    if (mode === 'recipe') state.project.layers[1].motionSpans![0].id = 'changed';
    if (mode === 'interior') state.project.layers[1].keys[1].shapes[0].x++;
    if (mode === 'numeric') state.project.layers[1].keys[0].shapes[0].x = NaN;
    const before = structuredClone(state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(() => cap.resolveScale(mixed)).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });
it('snapshots original scaling request identities and enclosing callbacks once', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    reads = { layer: 0, id: 0, validate: 0 };
  cap.prepareScale(
    [
      {
        get layerId() {
          reads.layer++;
          return 'base';
        },
        get shapeId() {
          reads.id++;
          return 'a';
        },
      },
    ],
    1.5,
    0.75,
    {
      get validate() {
        reads.validate++;
        return () => {};
      },
    },
  );
  expect(reads).toEqual({ layer: 1, id: 1, validate: 1 });
});
for (const method of [
  'scene',
  'choices',
  'selection',
  'rotation',
  'scale',
  'translate',
  'rotate',
  'prepare',
  'assert',
  'dispose',
])
  it('rejects scale enclosing reentry ' + method, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      validate = () => {
        try {
          if (method === 'scene') void cap.scene;
          if (method === 'choices') void cap.choices;
          if (method === 'selection') cap.resolveSelection(mixed);
          if (method === 'rotation') cap.resolveRotation(mixed);
          if (method === 'scale') cap.resolveScale(mixed);
          if (method === 'translate') cap.prepareTranslation(mixed, { x: 5, y: 4 });
          if (method === 'rotate') cap.prepareRotation(mixed, 37);
          if (method === 'prepare') cap.prepareScale(mixed, 1.5, 0.75);
          if (method === 'assert') cap.assertCurrent();
          if (method === 'dispose') cap.dispose();
        } catch {}
      };
    expect(() => cap.prepareScale(mixed, 1.5, 0.75, { validate })).toThrow();
    expect(() => cap.assertCurrent()).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });
for (const validate of [
  null,
  3,
  () => Promise.resolve(),
  () => {
    throw Error('enclosing');
  },
])
  it('rejects invalid/async scale enclosing validation with source-valid retries', () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75, { validate: validate as never })).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareScale(mixed, 1.5, 0.75)).toBeDefined();
  });
for (const field of ['layer', 'id', 'callback', 'factor', 'length'])
  it('rejects real scaling source/input changes from ' + field + ' getters', () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      request = pick('base', 'a'),
      requests = [request],
      options = { validate: () => {} };
    let sx = 1.5;
    if (field === 'layer' || field === 'id')
      Object.defineProperty(request, field === 'layer' ? 'layerId' : 'shapeId', {
        get() {
          state.revision++;
          return field === 'layer' ? 'base' : 'a';
        },
      });
    if (field === 'callback')
      Object.defineProperty(options, 'validate', {
        get() {
          state.revision++;
          return () => {};
        },
      });
    if (field === 'factor')
      sx = {
        get factor() {
          state.revision++;
          return 1.5;
        },
      }.factor;
    if (field === 'length')
      Object.defineProperty(requests, 0, {
        get() {
          requests.push(pick('base', 'other'));
          return request;
        },
      });
    const before = structuredClone(state.project);
    expect(() => cap.prepareScale(requests, sx, 0.75, options)).toThrow();
    expect(state.project).toEqual(before);
  });
for (const mode of ['source', 'options', 'rotation'])
  it('checks source/options after the complete shared scaling kernel ' + mode, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      scale = junction.scaleRememberedEndpoint;
    let seen = false;
    vi.spyOn(junction, 'scaleRememberedEndpoint').mockImplementation((...args) => {
      scale(...args);
      expect(args[0].layers.every((l) => l.motionSpans?.length === 2)).toBe(true);
      expect(args[0].layers[0].keys.find((k) => k.frame === 4)!.shapes[0].transform![0]).toBe(1.5);
      seen = true;
      if (mode === 'source') state.revision++;
      else if (mode === 'options') args[0].layers[1].motionSpans![0].options!.affine = false;
      else args[0].layers[1].motionSpans![0].rotation!.axisGroupScale = false;
    });
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(seen).toBe(true);
    expect(state.project).toEqual(before.project);
  });
for (const mutation of ['source', 'output'])
  it('admits scaling source and full candidate after completed output cloning ' + mutation, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      clone = structuredClone;
    let seen = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
      const out = clone(value),
        p = out as Project;
      if (
        p?.layers?.every((l) => l.motionSpans?.length === 2) &&
        p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
      ) {
        seen = true;
        if (mutation === 'source') state.revision++;
        else p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
      }
      return out;
    }) as typeof structuredClone);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(seen).toBe(true);
    expect(state.project).toEqual(before.project);
  });
for (const value of [undefined, false])
  it('requires original group scaling admission without widening ' + value, () => {
    const state = fixture();
    state.project.layers[1].motionSpans![0].rotation!.axisGroupScale = value;
    state.project.layers[1].motionSpans![0].rotation!.axisGroupShear = false;
    state.project.layers[1].motionSpans![0].rotation!.uniformGroupScale = true;
    refreshBasicMotionSpan(state.project, ['extra'], 0, 10);
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareScale([pick('base', 'r')], 1.5, 0.75)).toBeDefined();
  });
it('refreshes/reopens scaling output for later independent private editing', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    output = JSON.parse(JSON.stringify(cap.prepareScale(mixed, 1.5, 0.75))) as Project,
    copy = structuredClone(output);
  for (const l of output.layers)
    for (const span of [...l.motionSpans!])
      refreshBasicMotionSpan(output, [l.id], span.start, span.end);
  expect(output).toEqual(copy);
  const later = captureRememberedSelectionAuthoringFrame(() => ({
    project: output,
    revision: 0,
    frame: 2,
  }));
  expect(
    later.prepareScale([pick('base', 'r'), pick('base', 'a')], 1.1, 0.9).layers[0].motionSpans,
  ).toHaveLength(3);
});
it('rejects later-track scaling overflow without source writes or stale fallback', () => {
  const state = fixture();
  for (const k of state.project.layers[1].keys.filter((k) => k.frame === 0 || k.frame === 10))
    k.shapes.forEach((s) => (s.x += 9e6));
  refreshBasicMotionSpan(state.project, ['extra'], 0, 10);
  const before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
  expect(state).toEqual(before);
});
for (const direction of ['clockwise', 'counterclockwise'])
  it('retains actual split-derived scaling turn headers ' + direction, () => {
    const state = directedFixture(direction);
    const cap = captureRememberedSelectionAuthoringFrame(() => state),
      owner = cap.resolveScale(mixed),
      promoted = structuredClone(state.project);
    for (const track of owner.tracks)
      promoteSampledMotionFrame(promoted, [track.layerId], track.start, track.end, owner.frame);
    const saved = headers(promoted),
      out = cap.prepareScale(mixed, 1.5, 0.75);
    expect(headers(out)).toEqual(saved);
    for (const l of out.layers)
      for (const span of [...l.motionSpans!])
        refreshBasicMotionSpan(out, [l.id], span.start, span.end);
  });
for (const field of ['direction', 'turns'])
  it('rejects late derived scaling recipe header mutation ' + field, () => {
    const state = directedFixture('clockwise');
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      scale = junction.scaleRememberedEndpoint;
    vi.spyOn(junction, 'scaleRememberedEndpoint').mockImplementation((...args) => {
      scale(...args);
      const rotation = args[0].layers[0].motionSpans![0].rotation!;
      if (field === 'direction') rotation.direction = 'counterclockwise';
      else rotation.turns = rotation.turns === 0 ? 1 : 0;
    });
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow(/metadata/);
    expect(state).toEqual(before);
  });
for (const mutation of ['finite', 'numeric', 'budget'])
  it(
    'rejects output mutations from final scale ownership callbacks after first clone admission ' +
      mutation,
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state),
        clone = structuredClone,
        stringify = JSON.stringify;
      let output: Project | undefined,
        checked = false,
        seen = false;
      vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
        const out = clone(value),
          p = out as Project;
        if (
          p?.layers?.every((l) => l.motionSpans?.length === 2) &&
          p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
        )
          output = p;
        return out;
      }) as typeof structuredClone);
      vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: unknown[]) => {
        const out = stringify(value, ...(args as [never, never]));
        if (value === output && output) checked = true;
        return out;
      }) as typeof JSON.stringify);
      expect(() =>
        cap.prepareScale(mixed, 1.5, 0.75, {
          validate: () => {
            if (checked && !seen && output) {
              seen = true;
              if (mutation === 'finite')
                output.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
              else if (mutation === 'numeric')
                output.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x = NaN;
              else
                output.symbols = [
                  {
                    id: 'late-budget',
                    name: 'Late',
                    width: 1,
                    height: 1,
                    shapes: Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0, 0)),
                  },
                ];
            }
          },
        }),
      ).toThrow();
      expect(seen).toBe(true);
      expect(state).toEqual(before);
      vi.restoreAllMocks();
      expect(cap.prepareScale(mixed, 1.5, 0.75)).toBeDefined();
    },
  );

for (const direction of ['clockwise', 'counterclockwise'])
  it('retains positive-axis rejection for directed half-turn scaling ' + direction, () => {
    const state = fixture(direction),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow(/positive/);
    expect(state).toEqual(before);
    expect(cap.prepareTranslation(mixed, { x: 1, y: 2 })).toBeDefined();
  });
it('promotes each original scaling track once for a complete mixed selection', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    spy = vi.spyOn(motion, 'promoteSampledMotionFrame');
  cap.prepareScale(mixed, 1.5, 0.75);
  expect(spy.mock.calls.map((call) => call[1])).toEqual([['base'], ['extra']]);
});
it('admits actual aggregate symbol capacity through complete detached scaling', () => {
  const state = fixture();
  state.project.symbols = [
    {
      id: 'large',
      name: 'Large',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
        ...ink(String(i), 0, 0),
        width: 1,
        height: 1,
      })),
    },
  ];
  const cap = captureRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareScale([pick('base', 'r')], 1.5, 0.75);
  expect(out.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(out.symbols).toEqual(state.project.symbols);
  cap.dispose();
}, 60000);
it('rejects original aggregate overflow before scale ownership capture', () => {
  const state = fixture();
  state.project.symbols = [
    {
      id: 'large',
      name: 'Large',
      width: 1,
      height: 1,
      shapes: Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0, 0)),
    },
  ];
  expect(() => captureRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
});
it('rejects detached scaled-output aggregate overflow after complete cloning', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let seen = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value),
      p = out as Project;
    if (
      p?.layers?.every((l) => l.motionSpans?.length === 2) &&
      p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
    ) {
      seen = true;
      p.symbols = [
        {
          id: 'large',
          name: 'Large',
          width: 1,
          height: 1,
          shapes: Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0, 0)),
        },
      ];
    }
    return out;
  }) as typeof structuredClone);
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow(/symbol artwork budget/);
  expect(seen).toBe(true);
  expect(state).toEqual(before);
  vi.restoreAllMocks();
  expect(cap.prepareScale(mixed, 1.5, 0.75)).toBeDefined();
});

it('admits existing uniform-only group scaling without enabling independent axes', () => {
  const state = fixture();
  for (const layer of state.project.layers) {
    const r = layer.motionSpans![0].rotation!;
    r.axisGroupScale = false;
    r.axisGroupShear = false;
    r.uniformGroupScale = true;
    refreshBasicMotionSpan(state.project, [layer.id], 0, layer.id === 'base' ? 8 : 10);
  }
  const before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareScale(mixed, 1.25, 1.25);
  expect(
    out.layers.every((l) =>
      l.motionSpans!.every(
        (s) =>
          s.rotation!.uniformGroupScale === true &&
          s.rotation!.axisGroupScale === false &&
          s.rotation!.axisGroupShear === false,
      ),
    ),
  ).toBe(true);
  expect(state).toEqual(before);
});

it('keeps an original far off-view common saved scaling pivot unclamped', () => {
  const state = fixture();
  for (const layer of state.project.layers) {
    const end = layer.id === 'base' ? 8 : 10;
    for (const key of layer.keys.filter((k) => k.frame === 0 || k.frame === end))
      for (const shape of key.shapes) {
        const [a, b, c, d] = basis(shape),
          det = a * d - b * c,
          x = 1000000 - shape.x,
          y = -2000000 - shape.y;
        shape.pivot = { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
      }
    layer.motionSpans![0].options!.pivots = true;
    refreshBasicMotionSpan(state.project, [layer.id], 0, end);
  }
  const before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveScale(mixed),
    scene = cap.scene,
    out = cap.prepareScale(mixed, 1.0001, 0.9999);
  expect(owner.pivot).toEqual({ x: 1000000, y: -2000000 });
  for (const track of owner.tracks)
    for (const shape of scene
      .find((l) => l.layerId === track.layerId)!
      .key.shapes.filter((s) => track.shapeIds.includes(s.id))) {
      const got = out.layers
          .find((l) => l.id === track.layerId)!
          .keys.find((k) => k.frame === 4)!
          .shapes.find((s) => s.id === shape.id)!,
        expected = scale(world(shape, { x: 7, y: 11 }), owner.pivot, 1.0001, 0.9999),
        actual = world(got, { x: 7, y: 11 });
      expect(metadata(got)).toEqual(metadata(shape));
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
  expect(state).toEqual(before);
});
for (const origin of [0, 10000, -10000])
  it('retains small local private scaling geometry at origin ' + origin, () => {
    const state = fixture('compound');
    for (const layer of state.project.layers) {
      const end = layer.id === 'base' ? 8 : 10,
        span = layer.motionSpans![0];
      layer.keys = layer.keys.filter((k) => [0, end, 12].includes(k.frame));
      delete layer.motionSpans;
      for (const key of layer.keys)
        for (const shape of key.shapes) {
          shape.x = origin + shape.x * 0.001;
          shape.y = origin + shape.y * 0.001;
          shape.width *= 1e-6;
          shape.height *= 1e-6;
          shape.contours = shape.contours!.map((r) =>
            r.map((n) => ({ x: n.x * 1e-6, y: n.y * 1e-6 })),
          );
          shape.pivot = { x: 3e-6, y: 4e-6 };
        }
      createBasicMotionSpan(
        state.project,
        [layer.id],
        0,
        end,
        'linear',
        span.options,
        undefined,
        span.rotation,
      );
    }
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      owner = cap.resolveScale(mixed),
      scene = cap.scene,
      out = cap.prepareScale(mixed, 1.5, 0.75);
    for (const track of owner.tracks)
      for (const shape of scene
        .find((l) => l.layerId === track.layerId)!
        .key.shapes.filter((s) => track.shapeIds.includes(s.id))) {
        const got = out.layers
          .find((l) => l.id === track.layerId)!
          .keys.find((k) => k.frame === 4)!
          .shapes.find((s) => s.id === shape.id)!;
        expect(metadata(got)).toEqual(metadata(shape));
        for (const point of shape.contours!.flat()) {
          const actual = world(got, point),
            expected = scale(world(shape, point), owner.pivot, 1.5, 0.75);
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      }
    expect(state).toEqual(before);
  });

it('rechecks original source after final scaled-output validation', () => {
  const state = fixture(),
    before = structuredClone(state.project),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone,
    validate = document.validateProject;
  let output: Project | undefined,
    reads = 0,
    seen = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value),
      p = out as Project;
    if (
      p?.layers?.every((l) => l.motionSpans?.length === 2) &&
      p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
    )
      output = p;
    return out;
  }) as typeof structuredClone);
  vi.spyOn(document, 'validateProject').mockImplementation((value) => {
    const result = validate(value);
    if (value === output && output && ++reads === 2) {
      seen = true;
      state.revision++;
    }
    return result;
  });
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
  expect(seen).toBe(true);
  expect(reads).toBe(2);
  expect(state.project).toEqual(before);
  expect(() => cap.assertCurrent()).toThrow(/invalidated/);
});
