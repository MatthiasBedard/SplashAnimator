import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  symbolLayers,
  symbolArtworks,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Project,
  type Point,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  promoteSampledMotionFrame,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import { captureRememberedSelectionAuthoringFrame } from '../packages/animation/src/selection-motion-owner';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSelectionAuthoringSource,
} from '../packages/animation/src/symbol-selection-motion-owner';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import * as junction from '../packages/animation/src/motion-junction';
import * as document from '../packages/document/src';
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
function rootFixture(mode = 'plain'): GroupAuthoringSource {
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
function fixture(mode = 'plain'): SymbolSelectionAuthoringSource {
  const { project, revision, frame } = rootFixture(mode),
    [base, ...extra] = project.layers;
  base.id = '@base';
  delete extra[0].drawingMode;
  const definition: SymbolDefinition = {
    id: 'local',
    name: 'Local',
    width: 500,
    height: 300,
    multiFramePivot: { x: -17, y: 91 },
    buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: extra,
    },
  };
  return {
    definition,
    symbols: [definition, ...(project.symbols ?? [])],
    assets: project.assets,
    revision,
    frame,
  };
}
const pick = (layerId: string, shapeId: string) => ({ layerId, shapeId });
const mixed = [pick('extra', 'c'), pick('@base', 'e'), pick('@base', 'a'), pick('@base', 'r')];
function adapter(state: SymbolSelectionAuthoringSource): Project {
  const p = newProject();
  p.duration = 14;
  p.layers = structuredClone(symbolLayers(state.definition)).map((l) => ({
    ...l,
    drawingMode: l.drawingMode ?? 'object',
  }));
  p.symbols = structuredClone([
    ...state.symbols.filter((s) => s.id !== state.definition.id),
    state.definition,
  ]);
  p.assets = structuredClone(state.assets);
  return p;
}
function comparable(d: SymbolDefinition) {
  const out = structuredClone(d);
  for (const l of symbolLayers(out)) for (const span of l.motionSpans ?? []) span.id = 'owned-span';
  return out;
}
function saved(candidate: Project, state: SymbolSelectionAuthoringSource): SymbolDefinition {
  const [base, ...extra] = candidate.layers,
    original = state.definition;
  return {
    ...original,
    shapes: base.keys[0].shapes,
    timeline: {
      ...original.timeline!,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      ...(original.timeline!.layers !== undefined
        ? {
            layers: extra.map((l, i) => {
              const result = { ...l };
              if (original.timeline!.layers![i].drawingMode === undefined) {
                if (Object.hasOwn(original.timeline!.layers![i], 'drawingMode'))
                  result.drawingMode = undefined;
                else delete result.drawingMode;
              }
              return result;
            }),
          }
        : {}),
    },
  };
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
    [1, 1.2],
  ])
    it(`prepares detached isolated common-pivot scaling ${mode} ${sx}/${sy}`, () => {
      const state = fixture(mode),
        before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        owner = cap.resolveScale(mixed),
        scene = cap.scene,
        out = cap.prepareScale(mixed, sx, sy),
        rootProject = adapter(state),
        root = captureRememberedSelectionAuthoringFrame(() => ({
          project: rootProject,
          frame: state.frame,
          revision: state.revision,
        })),
        expected = saved(root.prepareScale(mixed, sx, sy), state);
      expect(owner.definitionId).toBe('local');
      expect(owner.pivot).toEqual(root.resolveScale(mixed).pivot);
      expect(owner.units.map((u) => [u.layerId, u.kind, u.shapeIds])).toEqual([
        ['@base', 'root', ['r']],
        ['@base', 'group', ['b', 'a', 'c']],
        ['@base', 'group', ['d', 'e']],
        ['extra', 'group', ['b', 'a', 'c']],
      ]);
      expect(comparable(out)).toEqual(comparable(expected));
      for (const track of owner.tracks) {
        const sampled = scene.find((l) => l.layerId === track.layerId)!.key.shapes,
          result = symbolLayers(out)
            .find((l) => l.id === track.layerId)!
            .keys.find((k) => k.frame === 4)!.shapes;
        for (const shape of sampled) {
          const actual = result.find((s) => s.id === shape.id)!;
          if (!track.shapeIds.includes(shape.id)) {
            expect(actual).toEqual(shape);
            continue;
          }
          expect(actual.points).toEqual(shape.points);
          expect(actual.contours).toEqual(shape.contours);
          expect(actual.pivot).toEqual(shape.pivot);
          expect(actual.symbolPlayback).toEqual(shape.symbolPlayback);
          expect(actual.groups).toEqual(shape.groups);
          const p = world(shape, { x: 7, y: 11 }),
            q = world(actual, { x: 7, y: 11 });
          expect(q.x).toBeCloseTo(owner.pivot.x + sx * (p.x - owner.pivot.x), 9);
          expect(q.y).toBeCloseTo(owner.pivot.y + sy * (p.y - owner.pivot.y), 9);
        }
      }
      expect(out.buttonStates).toEqual(before.definition.buttonStates);
      expect(out.multiFramePivot).toEqual(before.definition.multiFramePivot);
      expect(Object.hasOwn(out.timeline!.layers![0], 'drawingMode')).toBe(false);
      validateProject(adapter({ ...state, definition: out }));
      expect(state).toEqual(before);
    });

for (const [sx, sy] of [
  [0, 1],
  [1, 0],
  [1, 1],
  [NaN, 1],
  [1, Infinity],
  [undefined, 1],
  [new Number(2), 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [Number.MIN_VALUE, 1],
  [Number.MAX_VALUE, 1],
])
  it(`rejects invalid/unsupported isolated scale factors ${String(sx)}/${String(sy)}`, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, sx as number, sy as number)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

it('never takes membership or pivot ownership from public hints or previous output', () => {
  const state = fixture('reflected'),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveScale(mixed),
    pivot = structuredClone(owner.pivot),
    scene = cap.scene,
    choices = cap.choices;
  owner.pivot.x = 99999;
  owner.units[0].shapeIds.length = 0;
  owner.tracks.length = 0;
  scene[0].key.shapes.length = 0;
  choices[0].shapeId = 'forged';
  const first = cap.prepareScale(mixed, 1.5, 0.75),
    expected = structuredClone(first);
  first.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x = 9999;
  expect(cap.resolveScale(mixed).pivot).toEqual(pivot);
  expect(comparable(cap.prepareScale(mixed, 1.5, 0.75))).toEqual(comparable(expected));
  expect(state).toEqual(before);
});

for (const change of [
  (s: SymbolSelectionAuthoringSource) => {
    s.revision++;
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.frame++;
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.definition = structuredClone(s.definition);
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.symbols = [...s.symbols];
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.assets = [...s.assets];
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.definition.shapes[0].x++;
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.definition.shapes[1].groups = ['foreign'];
  },
  (s: SymbolSelectionAuthoringSource) => {
    s.assets.push({ id: 'late', path: 'assets/late.bin' });
  },
])
  it('rejects changed original definition/library/assets/frame/revision ownership', () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    change(state);
    const after = structuredClone(state);
    expect(() => cap.resolveScale(mixed)).toThrow();
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(state).toEqual(after);
  });

it('reads request identities and enclosing callback exactly once', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  let layer = 0,
    shape = 0,
    option = 0,
    calls = 0;
  const requests = [
    {
      get layerId() {
        layer++;
        return '@base';
      },
      get shapeId() {
        shape++;
        return 'r';
      },
    },
  ];
  cap.prepareScale(requests, 1.5, 0.75, {
    get validate() {
      option++;
      return () => {
        calls++;
      };
    },
  });
  expect([layer, shape, option]).toEqual([1, 1, 1]);
  expect(calls).toBeGreaterThan(1);
});

for (const at of ['request', 'callback'])
  it(`rejects original source changes during ${at} getter reads`, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state.definition);
    const requests =
      at === 'request'
        ? [
            {
              get layerId() {
                state.revision++;
                return '@base';
              },
              shapeId: 'r',
            },
          ]
        : mixed;
    const options =
      at === 'callback'
        ? {
            get validate() {
              state.revision++;
              return () => {};
            },
          }
        : {};
    expect(() => cap.prepareScale(requests, 1.5, 0.75, options)).toThrow();
    expect(state.definition).toEqual(before);
  });

for (const method of [
  'scene',
  'choices',
  'resolveSelection',
  'resolveRotation',
  'resolveScale',
  'prepareTranslation',
  'prepareRotation',
  'prepareScale',
  'assertCurrent',
  'dispose',
] as const)
  it('invalidates swallowed enclosing reentry through ' + method, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    const reenter = () => {
      try {
        if (method === 'scene' || method === 'choices') void cap[method];
        else if (
          method === 'resolveSelection' ||
          method === 'resolveRotation' ||
          method === 'resolveScale'
        )
          cap[method](mixed);
        else if (method === 'prepareTranslation') cap[method](mixed, { x: 1, y: 2 });
        else if (method === 'prepareRotation') cap[method](mixed, 17);
        else if (method === 'prepareScale') cap[method](mixed, 1.1, 1.1);
        else cap[method]();
      } catch {
        /* The outer operation must still reject. */
      }
    };
    expect(() => cap.prepareScale(mixed, 1.5, 0.75, { validate: reenter })).toThrow();
    expect(state).toEqual(before);
    expect(() => cap.assertCurrent()).toThrow();
  });

for (const mutation of ['source', 'target', 'nan', 'budget'] as const)
  it('rejects complete edited-definition clone tampering: ' + mutation, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      clone = structuredClone;
    let seen = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
      const out = clone(value),
        d = out as SymbolDefinition;
      if (
        d?.id === 'local' &&
        d.timeline?.motionSpans?.length === 2 &&
        d.timeline.keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
      ) {
        seen = true;
        if (mutation === 'source') state.assets.push({ id: 'late', path: 'assets/late.bin' });
        else if (mutation === 'budget')
          d.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) =>
            ink('overflow-' + i, 0, 0),
          );
        else
          d.timeline.keys.find((k) => k.frame === 4)!.shapes[0].x = mutation === 'nan' ? NaN : 999;
      }
      return out;
    }) as typeof structuredClone);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(seen).toBe(true);
    expect(state.definition).toEqual(before.definition);
    vi.restoreAllMocks();
    if (mutation !== 'source') expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

for (const mutation of ['target', 'nan', 'budget'] as const)
  it('rejects final enclosing tampering after first output admission: ' + mutation, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      clone = structuredClone;
    let output: SymbolDefinition | undefined,
      callbacks = 0,
      changed = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
      const out = clone(value),
        d = out as SymbolDefinition;
      if (
        d?.id === 'local' &&
        d.timeline?.motionSpans?.length === 2 &&
        d.timeline.keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
      )
        output = d;
      return out;
    }) as typeof structuredClone);
    expect(() =>
      cap.prepareScale(mixed, 1.5, 0.75, {
        validate: () => {
          if (!output || ++callbacks !== 2) return;
          changed = true;
          if (mutation === 'budget')
            output.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) =>
              ink('late-' + i, 0, 0),
            );
          else
            output.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x =
              mutation === 'nan' ? NaN : 777;
        },
      }),
    ).toThrow();
    expect(changed).toBe(true);
    expect(state).toEqual(before);
    vi.restoreAllMocks();
    expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

it('uses real bitmap references and rejects missing resources in original or overlay library', () => {
  const state = fixture();
  state.assets = [
    {
      id: 'bitmap',
      path: 'assets/bitmaps/actual.json',
      bitmap: { name: 'Actual', width: 12, height: 12 },
    },
  ];
  const p = adapter(state);
  for (const l of p.layers) {
    for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === (l.id === '@base' ? 8 : 10)))
      k.shapes[0].bitmap = { assetId: 'bitmap', x: 0, y: 0, width: 12, height: 12, repeat: true };
    refreshBasicMotionSpan(p, [l.id], 0, l.id === '@base' ? 8 : 10);
  }
  state.definition = saved(p, state);
  state.symbols[0] = state.definition;
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareScale(mixed, 1.5, 0.75);
  expect(out.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].bitmap).toEqual(
    state.definition.shapes[0].bitmap,
  );
  state.assets = [];
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
});

it('refreshes and JSON reopens scaling output for later isolated editing', () => {
  const state = fixture('reflected'),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    definition = JSON.parse(JSON.stringify(cap.prepareScale(mixed, 1.5, 0.75))) as SymbolDefinition,
    p = adapter({ ...state, definition }),
    before = structuredClone(p);
  for (const l of p.layers)
    for (const span of [...l.motionSpans!]) refreshBasicMotionSpan(p, [l.id], span.start, span.end);
  expect(p).toEqual(before);
  const reopened = { ...state, definition, symbols: [definition], frame: 2, revision: 0 },
    later = captureSymbolRememberedSelectionAuthoringFrame(() => reopened),
    out = later.prepareScale([pick('@base', 'r'), pick('@base', 'a')], 1.1, 1.1);
  expect(out.timeline!.motionSpans).toHaveLength(3);
  expect(out.buttonStates).toEqual(state.definition.buttonStates);
});

for (const value of [undefined, false])
  it('retains uniform-only original group admission without enabling axes: ' + value, () => {
    const state = fixture(),
      p = adapter(state);
    for (const l of p.layers) {
      l.motionSpans![0].rotation!.axisGroupScale = value;
      l.motionSpans![0].rotation!.axisGroupShear = false;
      l.motionSpans![0].rotation!.uniformGroupScale = true;
      refreshBasicMotionSpan(p, [l.id], 0, l.id === '@base' ? 8 : 10);
    }
    state.definition = saved(p, state);
    state.symbols[0] = state.definition;
    const before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    const out = cap.prepareScale(mixed, 1.25, 1.25);
    expect(
      symbolLayers(out).every((l) =>
        l.motionSpans!.every(
          (s) => s.rotation!.axisGroupScale === value && s.rotation!.uniformGroupScale,
        ),
      ),
    ).toBe(true);
    expect(state).toEqual(before);
  });

for (const kind of ['source', 'options', 'later-track'])
  it('rejects complete all-track kernel changes without local writes: ' + kind, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      scale = junction.scaleRememberedEndpoint;
    let complete = false;
    vi.spyOn(junction, 'scaleRememberedEndpoint').mockImplementation((...args) => {
      scale(...args);
      complete = args[0].layers.every((l) => l.motionSpans?.length === 2);
      if (kind === 'source') state.definition.name = 'actual source edit';
      else if (kind === 'options')
        args[0].layers[1].motionSpans![1].rotation!.axisGroupShear = false;
      else args[0].layers[1].keys.find((k) => k.frame === 4)!.shapes[0].x = Infinity;
    });
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
    expect(complete).toBe(true);
    if (kind !== 'source') expect(state).toEqual(before);
    else expect(state.definition.shapes).toEqual(before.definition.shapes);
    vi.restoreAllMocks();
    if (kind !== 'source') expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

for (const requests of [
  [],
  [pick('@base', 'missing')],
  [pick('missing', 'r')],
  [pick('@base', 'a'), pick('@base', 'b')],
])
  it('rejects absent/overlapping original unit identities', () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(requests, 1.5, 0.75)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

for (const validate of [
  false,
  () => Promise.resolve(),
  () => {
    throw Error('enclosing rejected');
  },
])
  it('rejects invalid/asynchronous/failed enclosing validation with a source-valid retry', () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() =>
      cap.prepareScale(mixed, 1.5, 0.75, { validate: validate as () => void }),
    ).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareScale(mixed, 1.25, 1.25)).toBeDefined();
  });

it('retains individual legacy translation and rotation preparation after isolated scaling', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    translated = cap.prepareTranslation(mixed, { x: 2, y: 3 }),
    rotated = cap.prepareRotation(mixed, 17);
  cap.prepareScale(mixed, 1.5, 0.75);
  expect(comparable(cap.prepareTranslation(mixed, { x: 2, y: 3 }))).toEqual(comparable(translated));
  expect(comparable(cap.prepareRotation(mixed, 17))).toEqual(comparable(rotated));
});

it('rechecks original resource ownership after last replacement validation', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone,
    validate = document.validateProject;
  let output: SymbolDefinition | undefined,
    validations = 0,
    seen = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value),
      d = out as SymbolDefinition;
    if (
      d?.id === 'local' &&
      d.timeline?.motionSpans?.length === 2 &&
      d.timeline.keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
    )
      output = d;
    return out;
  }) as typeof structuredClone);
  vi.spyOn(document, 'validateProject').mockImplementation((p) => {
    const result = validate(p),
      candidate = p as Project;
    if (output && candidate.symbols?.includes(output) && ++validations === 2) {
      seen = true;
      state.assets.push({ id: 'late-final', path: 'assets/final.bin' });
    }
    return result;
  });
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
  expect(seen).toBe(true);
  expect(state.assets.at(-1)!.id).toBe('late-final');
  expect(() => cap.assertCurrent()).toThrow();
});

it('admits exact aggregate capacity and rejects original/local overlay overflow without discarding artwork', () => {
  const state = fixture(),
    count = symbolArtworks(state.definition).reduce((n, a) => n + a.length, 0);
  state.symbols.push({
    id: 'spare',
    name: 'Spare',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count }, (_, i) => ({
      ...ink('art-' + i, 0, 0),
      width: 1,
      height: 1,
    })),
  });
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareScale([pick('@base', 'r')], 1.5, 0.75);
  expect(symbolArtworks(out).reduce((n, a) => n + a.length, 0)).toBe(count);
  cap.dispose();
  const original = state.definition;
  state.definition = structuredClone(original);
  state.definition.shapes.push(ink('overlay-overflow', 0, 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
  state.definition = original;
  state.symbols[1].shapes.push(ink('overflow', 0, 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
}, 60000);

for (const value of ['absent', 'undefined', 'empty'])
  it('preserves optional additional-layer representation: ' + value, () => {
    const state = fixture();
    if (value === 'absent') delete state.definition.timeline!.layers;
    else state.definition.timeline!.layers = value === 'empty' ? [] : undefined;
    const before = structuredClone(state),
      out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareScale(
        [pick('@base', 'r')],
        1.5,
        0.75,
      );
    expect(Object.hasOwn(out.timeline!, 'layers')).toBe(
      Object.hasOwn(state.definition.timeline!, 'layers'),
    );
    expect(out.timeline!.layers).toStrictEqual(state.definition.timeline!.layers);
    expect(state).toEqual(before);
  });
for (const value of [undefined, 'object'] as const)
  it('preserves explicit optional additional drawing mode: ' + value, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].drawingMode = value;
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareScale(
      mixed,
      1.5,
      0.75,
    );
    expect(Object.hasOwn(out.timeline!.layers![0], 'drawingMode')).toBe(true);
    expect(out.timeline!.layers![0].drawingMode).toBe(value);
  });
for (const size of [0, 0.25, 200000])
  it('preserves original symbol dimensions outside root-stage constraints: ' + size, () => {
    const state = fixture();
    state.definition.width = size;
    state.definition.height = size;
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareScale(
      mixed,
      1.5,
      0.75,
    );
    expect([out.width, out.height]).toEqual([size, size]);
  });

it('rejects later-track geometry overflow atomically without invalidating source-valid recovery', () => {
  const state = fixture(),
    p = adapter(state);
  for (const key of p.layers[1].keys.filter((k) => k.frame === 0 || k.frame === 10))
    for (const shape of key.shapes) shape.x += 9e6;
  refreshBasicMotionSpan(p, ['extra'], 0, 10);
  state.definition = saved(p, state);
  state.symbols[0] = state.definition;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow();
  expect(state).toEqual(before);
  expect(cap.prepareScale([pick('@base', 'r')], 1.5, 0.75)).toBeDefined();
});

for (const direction of ['clockwise', 'counterclockwise']) {
  it('preserves directed half-turn positive-axis rejection: ' + direction, () => {
    const state = fixture(direction),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareScale(mixed, 1.5, 0.75)).toThrow(/positive/);
    expect(state).toEqual(before);
    expect(cap.prepareTranslation(mixed, { x: 1, y: 2 })).toBeDefined();
  });
  it(
    'preserves actual split-derived directional headers at an admitted early frame: ' + direction,
    () => {
      const state = fixture(direction),
        p = adapter(state);
      p.duration = 24;
      state.frame = 2;
      for (const l of p.layers) {
        const end = l.id === '@base' ? 8 : 10,
          span = l.motionSpans![0];
        l.keys = l.keys
          .filter((k) => [0, end, 12].includes(k.frame))
          .map((k) => ({ ...k, frame: k.frame === end ? end * 2 : k.frame === 12 ? 22 : 0 }));
        delete l.motionSpans;
        createBasicMotionSpan(
          p,
          [l.id],
          0,
          end * 2,
          'linear',
          span.options,
          undefined,
          span.rotation,
        );
      }
      state.definition = saved(p, state);
      state.definition.timeline!.duration = 24;
      state.symbols[0] = state.definition;
      const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        owner = cap.resolveScale(mixed),
        promoted = structuredClone(p);
      for (const t of owner.tracks)
        promoteSampledMotionFrame(promoted, [t.layerId], t.start, t.end, 2);
      const headers = (layers: Project['layers']) =>
        layers.map((l) =>
          l.motionSpans!.map((s) => ({
            ...Object.fromEntries(
              Object.entries(s).filter(([k]) => k !== 'id' && k !== 'baseline'),
            ),
          })),
        );
      const out = cap.prepareScale(mixed, 1.5, 0.75);
      expect(headers(symbolLayers(out))).toEqual(headers(promoted.layers));
      expect(out.buttonStates).toEqual(state.definition.buttonStates);
    },
  );
}
