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
    if (['compound', 'aligned', 'asymmetric', 'curved'].includes(mode))
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
    if (mode === 'curved')
      for (const s of shapes)
        for (const r of s.contours!) {
          r[0].out = { x: 1, y: -0.5 };
          r[r.length - 1].out = { x: r[r.length - 1].x - 0.25, y: r[r.length - 1].y + 0.25 };
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
function sheared(p: Point, center: Point, axis: 'x' | 'y', degrees: number) {
  const k = Math.tan((degrees * Math.PI) / 180);
  return axis === 'x'
    ? { x: p.x + k * (p.y - center.y), y: p.y }
    : { x: p.x, y: p.y + k * (p.x - center.x) };
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
  'curved',
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
  for (const [axis, degrees] of [
    ['x', 18],
    ['y', -12],
  ] as const)
    it(
      'prepares private complete-union shearing with saved/default semantics ' +
        mode +
        ' ' +
        axis +
        ',' +
        degrees,
      () => {
        const state = fixture(mode),
          before = structuredClone(state),
          cap = captureRememberedSelectionAuthoringFrame(() => state),
          owner = cap.resolveSkew(mixed),
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
        const candidate = cap.prepareSkew(mixed, axis, degrees),
          promoted = structuredClone(state.project);
        for (const t of owner.tracks)
          promoteSampledMotionFrame(promoted, [t.layerId], t.start, t.end, 4);
        const saved = headers(promoted),
          expected = structuredClone(promoted);
        junction.skewRememberedEndpoint(expected, 4, owner.tracks, axis, degrees, owner.pivot);
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
            const k = Math.tan((degrees * Math.PI) / 180),
              expected =
                axis === 'x'
                  ? [m[0] + k * m[1], m[1], m[2] + k * m[3], m[3]]
                  : [m[0], m[1] + k * m[0], m[2], m[3] + k * m[2]];
            n.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
            if (axis === 'x') expect(got.y).toBe(shape.y);
            else expect(got.x).toBe(shape.x);
            for (const point of [
              { x: 0, y: 0 },
              { x: 7, y: 11 },
              ...(shape.contours ?? []).flat(),
            ]) {
              const wanted = sheared(world(shape, point), pivot, axis, degrees),
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
  it('resolves distinct original shearing selections ' + JSON.stringify(requests), () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      owner = cap.resolveSkew(requests),
      out = cap.prepareSkew(requests, 'x', 18);
    expect(owner.tracks.length).toBe(new Set(requests.map((r) => r.layerId)).size);
    expect(out).not.toEqual(state.project);
    expect(cap.resolveSelection(requests).tracks).toEqual(owner.tracks);
  });
for (const [axis, degrees] of [
  ['z', 18],
  [new String('x'), 18],
  [undefined, 18],
  ['x', NaN],
  ['x', Infinity],
  ['x', -Infinity],
  ['x', 0],
  ['x', 180],
  ['x', 360],
  ['x', 90],
  ['y', 270],
  ['x', Number.MIN_VALUE],
  ['x', Number.MAX_VALUE],
  ['x', new Number(18)],
  ['x', '18'],
])
  it(
    'rejects invalid/unsupported shear values without source/history writes ' +
      String(axis) +
      ',' +
      String(degrees),
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state);
      expect(() => cap.prepareSkew(mixed, axis as 'x', degrees as number)).toThrow();
      expect(state).toEqual(before);
      expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
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
    'rejects missing/malformed/overlapping original shearing picks ' + JSON.stringify(requests),
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state);
      expect(() => cap.prepareSkew(requests as SampledUnitRequest[], 'x', 18)).toThrow();
      expect(state).toEqual(before);
    },
  );
it('keeps private scale ownership independent of public scenes, pivots, choices and outputs', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveSkew(mixed),
    pivot = { ...owner.pivot };
  owner.pivot.x = 999;
  owner.tracks[0].shapeIds = ['other'];
  owner.units[0].shapeIds = ['other'];
  cap.scene[0].key.shapes[0].x = 999;
  cap.choices[0].shapeId = 'other';
  const out = cap.prepareSkew(mixed, 'x', 18),
    fresh = cap.resolveSkew(mixed);
  expect(fresh.pivot).toEqual(pivot);
  expect(fresh.tracks[0].shapeIds).toContain('r');
  out.layers[0].keys[4].shapes[0].x = 999;
  expect(cap.prepareSkew(mixed, 'x', 18).layers[0].keys[4].shapes[0].x).not.toBe(999);
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
    cap.resolveSkew(mixed);
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
    expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
    expect(() => cap.resolveSkew(mixed)).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });
it('snapshots original shearing request identities and enclosing callbacks once', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    reads = { layer: 0, id: 0, validate: 0 };
  cap.prepareSkew(
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
    'x',
    18,
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
  'legacy-scale',
  'legacy-prepare-scale',
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
          if (method === 'scale') cap.resolveSkew(mixed);
          if (method === 'legacy-scale') cap.resolveScale(mixed);
          if (method === 'legacy-prepare-scale') cap.prepareScale(mixed, 1.2, 1.1);
          if (method === 'translate') cap.prepareTranslation(mixed, { x: 5, y: 4 });
          if (method === 'rotate') cap.prepareRotation(mixed, 37);
          if (method === 'prepare') cap.prepareSkew(mixed, 'x', 18);
          if (method === 'assert') cap.assertCurrent();
          if (method === 'dispose') cap.dispose();
        } catch {}
      };
    expect(() => cap.prepareSkew(mixed, 'x', 18, { validate })).toThrow();
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
    expect(() => cap.prepareSkew(mixed, 'x', 18, { validate: validate as never })).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
  });
for (const field of ['layer', 'id', 'callback', 'factor', 'length'])
  it('rejects real shearing source/input changes from ' + field + ' getters', () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      request = pick('base', 'a'),
      requests = [request],
      options = { validate: () => {} };
    let degrees = 18;
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
      degrees = {
        get factor() {
          state.revision++;
          return 18;
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
    expect(() => cap.prepareSkew(requests, 'x', degrees, options)).toThrow();
    expect(state.project).toEqual(before);
  });
for (const mode of ['source', 'options', 'rotation'])
  it('checks source/options after the complete shared shearing kernel ' + mode, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      scale = junction.skewRememberedEndpoint;
    let seen = false;
    vi.spyOn(junction, 'skewRememberedEndpoint').mockImplementation((...args) => {
      scale(...args);
      expect(args[0].layers.every((l) => l.motionSpans?.length === 2)).toBe(true);
      expect(args[0].layers[0].keys.find((k) => k.frame === 4)!.shapes[0].transform![2]).toBe(
        Math.tan((18 * Math.PI) / 180),
      );
      seen = true;
      if (mode === 'source') state.revision++;
      else if (mode === 'options') args[0].layers[1].motionSpans![0].options!.affine = false;
      else args[0].layers[1].motionSpans![0].rotation!.axisGroupScale = false;
    });
    expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
    expect(seen).toBe(true);
    expect(state.project).toEqual(before.project);
  });
for (const mutation of ['source', 'output'])
  it('admits shearing source and full candidate after completed output cloning ' + mutation, () => {
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
        p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
          Math.tan((18 * Math.PI) / 180)
      ) {
        seen = true;
        if (mutation === 'source') state.revision++;
        else p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
      }
      return out;
    }) as typeof structuredClone);
    expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
    expect(seen).toBe(true);
    expect(state.project).toEqual(before.project);
  });
for (const value of [undefined, false])
  it('requires original group shearing admission without widening ' + value, () => {
    const state = fixture();
    state.project.layers[1].motionSpans![0].rotation!.axisGroupScale = value;
    state.project.layers[1].motionSpans![0].rotation!.axisGroupShear = false;
    state.project.layers[1].motionSpans![0].rotation!.uniformGroupScale = true;
    refreshBasicMotionSpan(state.project, ['extra'], 0, 10);
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareSkew([pick('base', 'r')], 'x', 18)).toBeDefined();
  });
it('refreshes/reopens shearing output for later independent private editing', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    output = JSON.parse(JSON.stringify(cap.prepareSkew(mixed, 'x', 18))) as Project,
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
    later.prepareSkew([pick('base', 'r'), pick('base', 'a')], 'y', -12).layers[0].motionSpans,
  ).toHaveLength(3);
});
it('rejects later-track shearing overflow without source writes or stale fallback', () => {
  const state = fixture();
  for (const k of state.project.layers[1].keys.filter((k) => k.frame === 0 || k.frame === 10))
    k.shapes.forEach((s) => (s.x += 9e6));
  refreshBasicMotionSpan(state.project, ['extra'], 0, 10);
  const before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
  expect(state).toEqual(before);
});
for (const direction of ['clockwise', 'counterclockwise'])
  it('retains actual split-derived shearing turn headers ' + direction, () => {
    const state = directedFixture(direction);
    const cap = captureRememberedSelectionAuthoringFrame(() => state),
      owner = cap.resolveSkew(mixed),
      promoted = structuredClone(state.project);
    for (const track of owner.tracks)
      promoteSampledMotionFrame(promoted, [track.layerId], track.start, track.end, owner.frame);
    const saved = headers(promoted),
      out = cap.prepareSkew(mixed, 'x', 18);
    expect(headers(out)).toEqual(saved);
    for (const l of out.layers)
      for (const span of [...l.motionSpans!])
        refreshBasicMotionSpan(out, [l.id], span.start, span.end);
  });
for (const field of ['direction', 'turns'])
  it('rejects late derived shearing recipe header mutation ' + field, () => {
    const state = directedFixture('clockwise');
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      scale = junction.skewRememberedEndpoint;
    vi.spyOn(junction, 'skewRememberedEndpoint').mockImplementation((...args) => {
      scale(...args);
      const rotation = args[0].layers[0].motionSpans![0].rotation!;
      if (field === 'direction') rotation.direction = 'counterclockwise';
      else rotation.turns = rotation.turns === 0 ? 1 : 0;
    });
    expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow(/metadata/);
    expect(state).toEqual(before);
  });
for (const mutation of ['finite', 'numeric', 'budget'])
  it(
    'rejects output mutations from final skew ownership callbacks after first clone admission ' +
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
          p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
            Math.tan((18 * Math.PI) / 180)
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
        cap.prepareSkew(mixed, 'x', 18, {
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
      expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
    },
  );

it('promotes each original shearing track once for a complete mixed selection', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    spy = vi.spyOn(motion, 'promoteSampledMotionFrame');
  cap.prepareSkew(mixed, 'x', 18);
  expect(spy.mock.calls.map((call) => call[1])).toEqual([['base'], ['extra']]);
});
it('admits actual aggregate symbol capacity through complete detached shearing', () => {
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
    out = cap.prepareSkew([pick('base', 'r')], 'x', 18);
  expect(out.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(out.symbols).toEqual(state.project.symbols);
  cap.dispose();
}, 60000);
it('rejects original aggregate overflow before skew ownership capture', () => {
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
it('rejects detached sheared-output aggregate overflow after complete cloning', () => {
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
      p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
        Math.tan((18 * Math.PI) / 180)
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
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow(/symbol artwork budget/);
  expect(seen).toBe(true);
  expect(state).toEqual(before);
  vi.restoreAllMocks();
  expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
});

it('retains disabled shear admission without enabling saved options', () => {
  const state = fixture();
  for (const l of state.project.layers) {
    const span = l.motionSpans![0];
    span.rotation!.axisGroupShear = false;
    span.rotation!.uniformGroupScale = true;
    span.rotation!.axisGroupScale = false;
    refreshBasicMotionSpan(state.project, [l.id], span.start, span.end);
  }
  const before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
  expect(state).toEqual(before);
  expect(cap.prepareTranslation(mixed, { x: 2, y: 1 })).toBeDefined();
});
it('keeps an original far off-view common saved shearing pivot unclamped', () => {
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
    owner = cap.resolveSkew(mixed),
    scene = cap.scene,
    out = cap.prepareSkew(mixed, 'x', 0.001);
  expect(owner.pivot).toEqual({ x: 1000000, y: -2000000 });
  for (const track of owner.tracks)
    for (const shape of scene
      .find((l) => l.layerId === track.layerId)!
      .key.shapes.filter((s) => track.shapeIds.includes(s.id))) {
      const got = out.layers
          .find((l) => l.id === track.layerId)!
          .keys.find((k) => k.frame === 4)!
          .shapes.find((s) => s.id === shape.id)!,
        expected = sheared(world(shape, { x: 7, y: 11 }), owner.pivot, 'x', 0.001),
        actual = world(got, { x: 7, y: 11 });
      expect(metadata(got)).toEqual(metadata(shape));
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
  expect(state).toEqual(before);
});
for (const origin of [0, 10000, -10000])
  it('retains small local private shearing geometry at origin ' + origin, () => {
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
      owner = cap.resolveSkew(mixed),
      scene = cap.scene,
      out = cap.prepareSkew(mixed, 'x', 18);
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
            expected = sheared(world(shape, point), owner.pivot, 'x', 18);
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      }
    expect(state).toEqual(before);
  });

it('rechecks original source after final sheared-output validation', () => {
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
      p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
        Math.tan((18 * Math.PI) / 180)
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
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
  expect(seen).toBe(true);
  expect(reads).toBe(2);
  expect(state.project).toEqual(before);
  expect(() => cap.assertCurrent()).toThrow(/invalidated/);
});

it('rejects nonfinite output hidden behind an original null after final source callbacks', () => {
  const state = fixture();
  Object.assign(state.project, { audit: null });
  const before = structuredClone(state);
  let output: Project | undefined,
    reads = 0,
    seen = false;
  const cap = captureRememberedSelectionAuthoringFrame(() => {
    if (output && reads >= 2 && !seen) {
      seen = true;
      Object.assign(output, { audit: NaN });
    }
    return state;
  });
  const clone = structuredClone,
    validate = document.validateProject;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value),
      p = out as Project;
    if (
      p?.layers?.every((l) => l.motionSpans?.length === 2) &&
      p.layers[0].keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
        Math.tan((18 * Math.PI) / 180)
    )
      output = p;
    return out;
  }) as typeof structuredClone);
  vi.spyOn(document, 'validateProject').mockImplementation((value) => {
    const result = validate(value);
    if (value === output && output) reads++;
    return result;
  });
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow(/nonfinite/);
  expect(seen).toBe(true);
  expect(state).toEqual(before);
  vi.restoreAllMocks();
  expect(() => cap.assertCurrent()).not.toThrow();
  expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
});
it('rejects detached nonwritable track publication without consuming original ownership', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    promote = motion.promoteSampledMotionFrame;
  let seen = false;
  vi.spyOn(motion, 'promoteSampledMotionFrame').mockImplementation((...args) => {
    if (!seen) {
      seen = true;
      expect(args[0]).not.toBe(state.project);
      expect(args[0].layers[1]).not.toBe(state.project.layers[1]);
      Object.freeze(args[0].layers[1]);
    }
    return promote(...args);
  });
  expect(() => cap.prepareSkew(mixed, 'x', 18)).toThrow();
  expect(seen).toBe(true);
  expect(state).toEqual(before);
  vi.restoreAllMocks();
  expect(() => cap.assertCurrent()).not.toThrow();
  expect(cap.prepareSkew(mixed, 'x', 18)).toBeDefined();
});
